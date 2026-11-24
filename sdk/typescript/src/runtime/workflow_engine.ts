/**
 * AWA Workflow Engine
 * Executes AWA workflow definitions with full actor and decision support
 */

import { randomUUID } from 'crypto';
import { UUID, Workflow, Activity, Edge, Role, DecisionNode, Event as WorkflowEvent, Context } from '../types';
import { Token } from './token';
import { ContextManager, ContextError } from './context_manager';
import { DEFAULT_AI_MODEL_ID } from './model_config';
import { ExecutionLogger, ExecutionMetrics, get_execution_logger } from './execution_logger';
import { validate_workflow_integrity } from '../validator';
import { Actor } from './actors/actor';
import { SoftwareAgent } from './actors/software_agent';
import { AIAgent } from './actors/ai_agent';
import { RobotAgent, RobotConfig } from './actors/robot_agent';
import { HumanAgent } from './actors/human_agent';
import { DecisionEvaluator, evaluate_decision } from './decision_evaluator';
import { DecisionEngine } from './decision_engine';
import { calculate_duration, parse_iso_duration } from './duration_utils';
import { WasteCategory, Analytics, VerificationRecord, ActivityRetry } from '../types';
import { VerificationEngine } from './verification_engine';
import { evaluate_expression } from './expression';
import {
    InMemoryJournalStore, JournalEvent, JournalEventInput, JournalListener,
    JournalStore, JournalWriter, PayloadMode, public_payload, hash_payload,
} from './journal';
import { check_contract, contract_feedback, outcome_of } from './outcome_contract';
import { PersistenceAdapter, WorkflowState, serialize_token, deserialize_token } from './persistence';
import { RetryConfig, DEFAULT_RETRY_CONFIG, calculate_retry_delay, DeadLetterQueue } from './retry';
import { Logger } from '../server/logger';
import { ModelProvider, ModelRegistry, ModelRouter, GoogleModelProvider, RouteAttempt } from './models';
import { ToolOptions, ToolRunner } from './tools';
import { ToolSessions } from './protocols/sessions';
import { A2AActor, A2AOptions, A2ARunState, a2a_binding } from './protocols/a2a';
import { decide_with_model } from './decision_model';
import { ActorContext } from './actors/actor';
import { BusinessEvent, EventSink } from './business_event';
import { resolve_path } from './expression';
import { KnowledgeBase, guidance } from './knowledge';
import { RunTelemetry, TelemetrySetting, open_run_telemetry } from './telemetry_export';

export type EngineStatus = 'running' | 'paused' | 'completed' | 'failed' | 'idle' | 'waiting_human' | 'waiting_event' | 'cancelled';

export interface WorkflowEngineOptions {
    /** Gemini API key for AI agents */
    gemini_api_key?: string;
    /** @deprecated Use gemini_api_key instead */
    geminiApiKey?: string;
    /** Default model ID for AI agents */
    default_ai_model_id?: string;
    /** Role definitions */
    roles?: Role[];
    /** Robot configuration */
    robot_config?: RobotConfig;
    /** Wait for human tasks to complete before proceeding */
    wait_for_human_tasks?: boolean;
    /** Enable verbose logging */
    verbose?: boolean;
    /** Execution logger instance */
    execution_logger?: ExecutionLogger;
    /** Pricing configuration for cost calculation */
    pricing_config?: {
        input_token_cost_per_1k?: number;
        output_token_cost_per_1k?: number;
        currency: string;
        human_cost_per_hour?: number;
        robot_cost_per_hour?: number;
        software_cost_per_execution?: number;
    };
    /** User ID triggering the execution */
    user_id?: string;
    /** Enable verification globally (can be overridden per activity) */
    verification_enabled?: boolean;
    /** Override verification judge model ID */
    verification_model_id?: string;
    /** Run in simulation mode (mocks AI and Human interactions) */
    simulate?: boolean;
    /**
     * In simulation mode, what each activity returns, by activity name. Each
     * entry gives `output`, or `error` (with an optional `code`), or `attempts`:
     * a list of those, one per execution, the last repeating. Activities not
     * listed use the built-in mocks, which return no business data.
     */
    simulated_outputs?: Record<string, SimulatedOutput>;
    /** Custom actor implementations per actor type. Overrides the built-in actors. */
    actors?: Partial<Record<Activity['actor_type'], Actor>>;
    /** Identifier of this run. Generated if absent. */
    run_id?: UUID;
    /** Where the execution journal is stored. In memory if absent. */
    journal?: JournalStore;
    /** How activity inputs and outputs are written to the journal. Default 'full'. */
    journal_payloads?: PayloadMode;
    /** If set, the run state is checkpointed here after every step, keyed by run id. */
    checkpoint?: PersistenceAdapter;
    /** Default retry policy for activities that do not declare their own. Default: no retries. */
    retry?: Partial<RetryConfig>;
    /** Receives activities whose retries are exhausted. */
    dead_letter_queue?: DeadLetterQueue;
    /** Model providers available to AI agents and judges, in addition to Google when gemini_api_key is set. */
    model_providers?: ModelProvider[];
    /** Provider used for model references that name none. Default: the first registered. */
    default_model_provider?: string;
    /** Capability tiers mapped to model references, e.g. { fast: 'ollama:gemma3:1b' }. Standard tiers not mapped here take the models of TIER_PRESETS for the providers registered */
    model_tiers?: Record<string, string | string[]>;
    /** Receives the business events the workflow publishes. Without one they are recorded in the journal only. */
    event_sink?: EventSink;
    /** On restore: the highest sequence number already in the journal of the run, when it is beyond the checkpoint's. Set by WorkflowEngine.recover. */
    journal_tail_seq?: number;
    /** The current time in milliseconds. Tests replace it to move time forward. */
    now?: () => number;
    /**
     * Supplies a model decision without calling a model. Counterfactual replay uses it
     * to replay recorded decisions. Returning undefined lets the model decide.
     */
    model_decision_override?: (decision: DecisionNode) => { option?: string; confidence?: number } | undefined;
    /** External decision engines that decision nodes may consult, by name */
    decision_engines?: Record<string, DecisionEngine>;
    /** How the tools declared on activities are executed, and what they are allowed to do */
    tools?: ToolOptions;
    /** How agents reached over A2A are called, and which hosts they may be reached at (spec 28) */
    a2a?: A2AOptions;
    /** Knowledge base that activities with a `knowledge` binding draw on. */
    knowledge?: KnowledgeBase;
    /** If true, the run's journal is distilled into the knowledge base when the run ends. */
    learn?: boolean;
    /** Replaces the delay between retries. Tests use this to avoid real waiting. */
    sleep?: (ms: number) => Promise<void>;
    /** Where the run's spans go as its journal is written (spec 26): an exporter, or `{ endpoint, headers, payloads }`. Telemetry never holds up the run. */
    telemetry?: TelemetrySetting;
}

export interface SimulatedOutput {
    output?: Record<string, unknown>;
    /** What the activity writes to contexts, by context name (spec 22.3). It needs a binding that allows writing, as any activity does. */
    contexts?: Record<string, unknown>;
    error?: string;
    code?: string;
    attempts?: SimulatedOutput[];
}

/** What a message or signal event's event_definition holds */
interface EventDefinition {
    name?: string;
    /** "wait" (default): hold the token until the event arrives. "publish": emit the event and continue. */
    mode?: 'wait' | 'publish';
    /** For a wait: the property that must be equal in the token's data and in the event's data */
    correlation_key?: string;
    /** For a wait: how long to wait */
    timeout?: string;
    /** For a wait: the edge taken when the wait times out */
    timeout_edge_id?: UUID;
    /** For a publish: the token data properties sent as the event's data */
    data?: string[];
}

interface AwaitedEvent {
    node_id: UUID;
    name: string;
    correlation_key?: string;
    correlation_value?: unknown;
    due_at?: string;
    timeout_edge_id?: UUID;
    broadcast: boolean;
}

/** Error codes that are never retried, whatever the retry policy says */
const NEVER_RETRIED = new Set(['VERIFICATION_FAILED', 'CONTRACT_VIOLATION', 'NO_ROUTE', 'SLA_BREACH', 'CONTEXT_MISSING', 'CONTEXT_ACCESS_DENIED', 'CONTEXT_INVALID', 'CONTEXT_NOT_FOUND', 'AGENT_UNSUPPORTED', 'PERMISSION_DENIED']);
/** Access modes that let an activity read a context, and those that let it write (22.2) */
const CAN_READ = new Set(['read', 'read_write', 'subscribe']);
const CAN_WRITE = new Set(['write', 'read_write', 'publish']);

class ActivityError extends Error {
    constructor(message: string, public readonly code: string, public readonly details?: Record<string, unknown>) {
        super(message);
        this.name = 'ActivityError';
    }
}

/**
 * The fields of an object-valued `output`, so that an outcome's properties are
 * addressable directly by conditions and decision tables (spec 5.2).
 */
function outcome_fields(result: Record<string, unknown>): Record<string, unknown> {
    const output = result.output;
    if (output === null || typeof output !== 'object' || Array.isArray(output)) return {};
    return Object.fromEntries(Object.entries(output).filter(([key]) => !key.startsWith('_') && key !== 'activities'));
}

function error_info(error: unknown): { message: string; code?: string; stack?: string } {
    if (error instanceof Error) {
        const code = (error as { code?: unknown }).code;
        return { message: error.message, code: typeof code === 'string' ? code : undefined, stack: error.stack };
    }
    return { message: String(error) };
}

export class WorkflowEngine {
    private workflow: Workflow;
    private tokens: Token[];
    private contextManager: ContextManager;
    private status: EngineStatus;
    private activityMap: Map<UUID, Activity>;
    private edgeMap: Map<UUID, Edge[]>; // Source ID -> Edges
    private decisionNodeMap: Map<UUID, DecisionNode>;
    private eventMap: Map<UUID, WorkflowEvent> = new Map();
    private incomingEdges: Map<UUID, Edge[]> = new Map(); // Target ID -> Edges
    /** Activities whose outcome was accepted, in order of completion. Drives compensation. */
    /** Service level warnings and breaches already recorded, so that each is recorded once */
    private slaRecorded = new Set<string>();
    private completedActivities: { activity_id: UUID; token_id: UUID; output: Record<string, unknown> }[] = [];
    /** Ids of the business events this run has consumed, so that a redelivery is ignored */
    private deliveredEvents = new Set<string>();
    /** Connections the run's tools keep open (MCP servers, gRPC channels), closed when the run ends or waits (17.7) */
    private toolSessions = new ToolSessions();
    /** The cards of the A2A agents this run has read (28.2) */
    private a2aState: A2ARunState = { cards: new Map() };
    private options: WorkflowEngineOptions;
    private roleMap: Map<UUID, Role>;
    private decisionEvaluator: DecisionEvaluator;
    private executionLogger: ExecutionLogger;
    private verificationEngine: VerificationEngine;
    private defaultAIModelId: string;
    private simulate: boolean;
    private runId: UUID;
    private journal: JournalWriter;
    private telemetry?: RunTelemetry;
    private journalStore: JournalStore;
    private deadLetterQueue: DeadLetterQueue;
    private sleep: (ms: number) => Promise<void>;
    private models: ModelRegistry;
    private router: ModelRouter;
    private executionStats: {
        startTime: Date;
        stepsCount: number;
        inputTokens: number;
        outputTokens: number;
        cost: number;
        verificationTokens: number;
    };

    constructor(workflowDef: Workflow, options: WorkflowEngineOptions = {}) {
        // Validate workflow integrity
        const validation = validate_workflow_integrity(workflowDef);
        if (!validation.valid) {
            throw new Error(`Invalid workflow definition: ${validation.errors.map(e => e.message).join(', ')}`);
        }

        this.workflow = workflowDef;
        this.options = {
            ...options,
            // Support legacy option name
            gemini_api_key: options.gemini_api_key || options.geminiApiKey
        };
        // The configured default model (src/config.json), unless the caller names another (12.3)
        this.defaultAIModelId = options.default_ai_model_id || DEFAULT_AI_MODEL_ID;
        this.simulate = options.simulate || false;
        this.runId = options.run_id || randomUUID();
        this.journalStore = options.journal || new InMemoryJournalStore();
        this.journal = new JournalWriter(this.runId, workflowDef.id, this.journalStore, options.journal_payloads || 'full', 0, options.now);
        this.telemetry = open_run_telemetry(workflowDef, options.telemetry, () => this.journalStore.read(this.runId));
        this.telemetry?.watch(this.journal);
        this.deadLetterQueue = options.dead_letter_queue || new DeadLetterQueue(new Logger({ output: () => { } }));
        this.sleep = options.sleep || (ms => new Promise(resolve => setTimeout(resolve, ms)));
        this.tokens = [];
        this.contextManager = new ContextManager();
        this.status = 'idle';
        this.activityMap = new Map();
        this.edgeMap = new Map();
        this.decisionNodeMap = new Map();
        this.roleMap = new Map();
        this.decisionEvaluator = new DecisionEvaluator(workflowDef.decision_nodes);
        this.executionLogger = options.execution_logger || get_execution_logger();
        this.models = new ModelRegistry();
        if (this.options.gemini_api_key) this.models.register(new GoogleModelProvider(this.options.gemini_api_key));
        for (const provider of options.model_providers || []) this.models.register(provider);
        if (options.default_model_provider) this.models.set_default_provider(options.default_model_provider);
        for (const [tier, ref] of Object.entries(options.model_tiers || {})) this.models.set_tier(tier, ref);
        this.models.fill_standard_tiers();

        this.router = new ModelRouter(this.models);

        this.verificationEngine = new VerificationEngine({
            models: this.models,
            gemini_api_key: this.options.gemini_api_key,
            default_model_id: this.options.verification_model_id || this.defaultAIModelId,
            verbose: this.options.verbose,
            simulate: this.simulate,
        });

        this.executionStats = {
            startTime: new Date(this.now()),
            stepsCount: 0,
            inputTokens: 0,
            outputTokens: 0,
            cost: 0,
            verificationTokens: 0
        };

        this.initializeMaps();
        this.initializeContexts();
    }

    private initializeMaps(): void {
        for (const activity of this.workflow.activities) {
            this.activityMap.set(activity.id, activity);
        }

        for (const edge of this.workflow.edges) {
            if (!this.edgeMap.has(edge.source_id)) {
                this.edgeMap.set(edge.source_id, []);
            }
            this.edgeMap.get(edge.source_id)?.push(edge);

            if (!this.incomingEdges.has(edge.target_id)) {
                this.incomingEdges.set(edge.target_id, []);
            }
            this.incomingEdges.get(edge.target_id)?.push(edge);
        }

        for (const event of this.workflow.events) {
            this.eventMap.set(event.id, event);
        }

        for (const decisionNode of this.workflow.decision_nodes) {
            this.decisionNodeMap.set(decisionNode.id, decisionNode);
        }

        // Roles defined in the document, then roles supplied by the deployment (which win)
        for (const role of this.workflow.roles || []) {
            this.roleMap.set(role.id, role);
        }
        if (this.options.roles) {
            for (const role of this.options.roles) {
                this.roleMap.set(role.id, role);
            }
        }
    }

    private initializeContexts(): void {
        for (const context of this.workflow.contexts) {
            this.contextManager.register(context);
        }
    }

    private log(message: string): void {
        if (this.options.verbose) {
            console.log(`[WorkflowEngine] ${message}`);
        }
    }

    public async start(initialData: Record<string, unknown> = {}): Promise<UUID> {
        if (this.status === 'running') {
            throw new Error('Workflow is already running');
        }

        if (this.workflow.activities.length === 0) {
            throw new Error('Workflow has no activities');
        }

        const startNodeId = this.findStartNode();

        // Add workflow metadata to initial data
        const tokenData = {
            ...initialData,
            _workflow_id: this.workflow.id,
            _workflow_name: this.workflow.name,
            _started_at: new Date(this.now()).toISOString()
        };

        const token = new Token(startNodeId, tokenData, undefined, this.workflow.id);
        this.tokens.push(token);
        this.status = 'running';

        this.record({
            type: 'run.started',
            data: {
                workflow_name: this.workflow.name,
                workflow_version: this.workflow.version,
                input: this.journal.payload(initialData),
                simulate: this.simulate,
            },
        });
        this.record({ type: 'token.created', token_id: token.id, ...this.nodeRef(startNodeId), data: {} });

        this.log(`Started workflow "${this.workflow.name}" with token ${token.id}`);

        this.executionStats.startTime = new Date(this.now()); // Reset start time on actual start
        return token.id;
    }

    /**
     * The node a run starts at (spec: "Start"):
     * the first start event; otherwise the first activity that no edge targets
     * and that is not a compensation handler; otherwise the first activity.
     */
    private findStartNode(): UUID {
        const startEvent = this.workflow.events.find(e => e.event_type === 'start');
        if (startEvent) return startEvent.id;

        const handlers = new Set(this.workflow.activities.map(a => a.compensation?.activity_id).filter(Boolean));
        const entry = this.workflow.activities.find(a => !this.incomingEdges.has(a.id) && !handlers.has(a.id));
        return (entry || this.workflow.activities[0]).id;
    }

    public async runStep(): Promise<void> {
        if (this.status !== 'running' && this.status !== 'waiting_human' && this.status !== 'waiting_event') return;

        const activeTokens = this.tokens.filter(t => t.status === 'active');

        if (activeTokens.length === 0) {
            await this.settle();
            return;
        }

        // Tokens on parallel branches make progress concurrently
        await Promise.all(activeTokens.map(token => this.processToken(token)));

        await this.settle();
        await this.saveCheckpoint();
    }

    /**
     * Derive the run status from token states (spec: "Run outcome").
     * A run is `completed` only if every token completed. Any failed token
     * makes the run `failed` once no token is still active or waiting.
     */
    private async settle(): Promise<void> {
        const has = (status: Token['status']) => this.tokens.some(t => t.status === status);

        // A join that can no longer be satisfied is a failure, not a wait
        if (!has('active') && !has('waiting') && has('joining')) {
            for (const token of this.tokens.filter(t => t.status === 'joining')) {
                this.failToken(token, new ActivityError(
                    'Join can never complete: no token can still arrive on the remaining incoming edges', 'JOIN_DEADLOCK'));
            }
        }

        // Fail fast: once a token has failed, the rest of the run is withdrawn
        if (has('failed')) {
            for (const token of this.tokens.filter(t => ['active', 'waiting', 'joining'].includes(t.status))) {
                token.updateStatus('cancelled');
                this.record({ type: 'token.cancelled', token_id: token.id, ...this.nodeRef(token.activityId), data: { reason: 'run_failed' } });
            }
        }

        if (has('active')) return;

        const previous = this.status;

        if (has('waiting')) {
            const waiting = this.tokens.filter(t => t.status === 'waiting');
            // Waiting on a person takes precedence in the status; otherwise the run waits on events
            this.status = waiting.some(t => !t.getData('_awaiting_event')) ? 'waiting_human' : 'waiting_event';
            if (previous !== this.status) {
                this.record({ type: 'run.waiting', data: { waiting_for: this.status === 'waiting_human' ? 'human' : 'event', waiting_tokens: waiting.map(t => t.id) } });
            }
            await this.toolSessions.close();
            return;
        }

        const failed = has('failed');
        await this.toolSessions.close();
        if (previous === 'completed' || previous === 'failed' || previous === 'cancelled') return;

        const compensation = failed ? await this.compensate() : undefined;
        this.status = failed ? 'failed' : 'completed';

        const durationMs = this.now() - this.executionStats.startTime.getTime();
        // A run that ended late is recorded as late; what it did is not undone (23.3)
        this.serviceLevel('workflow', this.workflow.sla, durationMs, {}, 'workflow');
        this.record({
            type: failed ? 'run.failed' : 'run.completed',
            data: {
                duration_ms: durationMs,
                steps: this.executionStats.stepsCount,
                input_tokens: this.executionStats.inputTokens,
                output_tokens: this.executionStats.outputTokens,
                cost: this.executionStats.cost,
                currency: this.options.pricing_config?.currency || 'USD',
                ...(failed
                    ? {
                        errors: this.tokens.filter(t => t.status === 'failed').map(t => ({ token_id: t.id, node_id: t.activityId, message: t.getData('_error') })),
                        compensation,
                    }
                    : {}),
            },
        });
        await this.finalizeExecution();
        await this.journal.flush();

        if (this.options.learn && this.options.knowledge) {
            this.options.knowledge.ingest(this.workflow, await this.journalStore.read(this.runId));
        }
    }

    /**
     * Undo completed work after a failure (spec: "Compensation").
     * Every completed activity that names a compensation handler is
     * compensated, most recently completed first. A handler that fails does
     * not stop the others.
     */
    private async compensate(): Promise<{ attempted: number; succeeded: number }> {
        let attempted = 0;
        let succeeded = 0;

        for (const done of [...this.completedActivities].reverse()) {
            const activity = this.activityMap.get(done.activity_id);
            const handler = activity?.compensation ? this.activityMap.get(activity.compensation.activity_id) : undefined;
            if (!activity || !handler) continue;

            attempted++;
            const ref = { token_id: done.token_id, ...this.nodeRef(handler.id) };
            const failure = this.tokens.find(t => t.status === 'failed');
            try {
                const actor = this.createActor(handler);
                if (!actor) throw new Error(`No actor for compensation handler "${handler.name}"`);
                const result = await actor.execute(handler, {
                    ...done.output,
                    _compensating: { activity_id: activity.id, activity_name: activity.name, output: done.output },
                    _failure: { message: failure?.getData('_error'), code: failure?.getData('_error_code') },
                    _run_id: this.runId,
                    _idempotency_key: `${this.runId}:${done.token_id}:${handler.id}:compensation`,
                });
                succeeded++;
                this.record({
                    type: 'activity.compensated', ...ref,
                    data: { compensates_activity_id: activity.id, compensates_activity_name: activity.name, output: this.journal.payload(public_payload(result)) },
                });
            } catch (error: unknown) {
                const info = error_info(error);
                this.record({
                    type: 'activity.compensation_failed', ...ref,
                    data: { compensates_activity_id: activity.id, compensates_activity_name: activity.name, error: { message: info.message, code: info.code } },
                });
            }
        }

        return { attempted, succeeded };
    }

    // ------------------------------------------------------------------
    // Journal, checkpoints and recovery
    // ------------------------------------------------------------------

    private record(input: JournalEventInput): JournalEvent {
        return this.journal.record(input);
    }

    private nodeRef(nodeId: UUID): { node_id: UUID; node_name?: string } {
        const name = this.activityMap.get(nodeId)?.name
            || this.decisionNodeMap.get(nodeId)?.name
            || this.eventMap.get(nodeId)?.name;
        return { node_id: nodeId, ...(name ? { node_name: name } : {}) };
    }

    /** Identifier of this run. Journal events and checkpoints are keyed by it. */
    public getRunId(): UUID {
        return this.runId;
    }

    /** Subscribe to journal events as they are recorded. Returns an unsubscribe function. */
    public onEvent(listener: JournalListener): () => void {
        return this.journal.subscribe(listener);
    }

    /** The journal of this run so far, in sequence order */
    public async getEvents(afterSeq = 0): Promise<JournalEvent[]> {
        await this.journal.flush();
        return this.journalStore.read(this.runId, afterSeq);
    }

    public getDeadLetterQueue(): DeadLetterQueue {
        return this.deadLetterQueue;
    }

    /** Snapshot of the run, sufficient to continue it in another process */
    public snapshot(): WorkflowState {
        return {
            version: '1.0',
            workflow_id: this.workflow.id,
            workflow_name: this.workflow.name,
            workflow_version: this.workflow.version,
            engine_status: this.status,
            tokens: this.tokens.map(serialize_token),
            contexts: this.contextManager.snapshot(),
            checkpoint_at: new Date(this.now()).toISOString(),
            metadata: {
                run_id: this.runId,
                journal_seq: this.journal.last_seq,
                completed_activities: this.completedActivities,
                delivered_events: [...this.deliveredEvents],
                sla_recorded: [...this.slaRecorded],
                context_times: this.contextManager.snapshot_times(),
                stats: { ...this.executionStats, startTime: this.executionStats.startTime.toISOString() },
            },
        };
    }

    /** Wait until every journal event recorded so far has reached the journal store */
    public async flush(): Promise<void> {
        await this.journal.flush();
    }

    private async saveCheckpoint(): Promise<void> {
        if (!this.options.checkpoint) return;
        await this.journal.flush();
        await this.options.checkpoint.save(this.runId, this.snapshot());
    }

    /**
     * Continue a run from a checkpoint (spec: "Recovery").
     * Tokens that were active when the checkpoint was taken execute their
     * current activity again, so activities are executed at least once.
     */
    public static restore(workflowDef: Workflow, state: WorkflowState, options: WorkflowEngineOptions = {}, record_resumed = true): WorkflowEngine {
        if (state.workflow_id !== workflowDef.id) {
            throw new Error(`Checkpoint belongs to workflow ${state.workflow_id}, not ${workflowDef.id}`);
        }
        const meta = (state.metadata || {}) as {
            run_id?: UUID; journal_seq?: number; stats?: Record<string, unknown>;
            completed_activities?: WorkflowEngine['completedActivities'];
            delivered_events?: string[];
            sla_recorded?: string[];
            context_times?: Record<string, number>;
        };
        const engine = new WorkflowEngine(workflowDef, { ...options, run_id: meta.run_id || options.run_id });
        engine.journal = new JournalWriter(
            engine.runId, workflowDef.id, engine.journalStore, options.journal_payloads || 'full', Math.max(meta.journal_seq || 0, options.journal_tail_seq || 0), options.now);
        engine.telemetry?.watch(engine.journal);
        engine.tokens = state.tokens.map(t => deserialize_token(t, state.workflow_id));
        engine.contextManager.restore(state.contexts, meta.context_times);
        engine.slaRecorded = new Set(meta.sla_recorded || []);
        engine.completedActivities = meta.completed_activities || [];
        engine.deliveredEvents = new Set(meta.delivered_events || []);
        if (meta.stats) {
            // Written by this SDK as text; by another implementation of the same store perhaps as milliseconds (spec 29.6)
            const raw = meta.stats.startTime ?? meta.stats.started_at;
            const started = typeof raw === 'number' ? new Date(raw) : new Date(String(raw));
            engine.executionStats = { ...engine.executionStats, ...meta.stats, startTime: isNaN(started.getTime()) ? engine.executionStats.startTime : started };
        }
        engine.status = engine.tokens.some(t => t.status === 'active') ? 'running'
            : engine.tokens.some(t => t.status === 'waiting' && !t.getData('_awaiting_event')) ? 'waiting_human'
                : engine.tokens.some(t => t.status === 'waiting') ? 'waiting_event'
                : (state.engine_status as EngineStatus);
        // A run another host left at rest is taken up, not resumed: nothing was interrupted (spec 29.2)
        if (record_resumed) engine.record({
            type: 'run.resumed',
            data: { from_checkpoint_at: state.checkpoint_at, from_seq: meta.journal_seq || 0, active_tokens: engine.tokens.filter(t => t.status === 'active').length },
        });
        return engine;
    }

    /**
     * Continue a run from a checkpoint and from its journal as it stands. A process
     * that stopped in the middle of an activity had already journalled events after
     * its last checkpoint; numbering continues after the last event on record, so no
     * sequence number is ever used twice (spec 10.3). Prefer this to restore().
     */
    public static async recover(workflowDef: Workflow, state: WorkflowState, options: WorkflowEngineOptions = {}): Promise<WorkflowEngine> {
        const run_id = ((state.metadata || {}) as { run_id?: UUID }).run_id || options.run_id;
        const on_record = options.journal && run_id ? await options.journal.read(run_id) : [];
        return WorkflowEngine.restore(workflowDef, state, { ...options, journal_tail_seq: on_record.reduce((max, e) => Math.max(max, e.seq), 0) });
    }

    /**
     * Run workflow to completion (or until paused/failed)
     */
    public async run(maxSteps: number = 1000): Promise<EngineStatus> {
        let steps = 0;
        while (this.status === 'running' && steps < maxSteps) {
            await this.runStep();
            steps++;
        }
        this.log(`Workflow completed after ${steps} steps with status: ${this.status}`);
        return this.status;
    }

    private async processToken(token: Token): Promise<void> {
        const currentNodeId = token.activityId;

        const decisionNode = this.decisionNodeMap.get(currentNodeId);
        if (decisionNode) {
            await this.processDecisionNode(token, decisionNode);
            return;
        }

        const event = this.eventMap.get(currentNodeId);
        if (event) {
            await this.processEvent(token, event);
            return;
        }

        const activity = this.activityMap.get(currentNodeId);
        if (!activity) {
            this.failToken(token, new ActivityError(`Node not found: ${currentNodeId}`, 'NOT_FOUND'));
            return;
        }

        const startTime = new Date(this.now());

        try {
            const actor = this.createActor(activity);
            if (!actor) {
                await this.advanceToken(token, currentNodeId);
                return;
            }

            const visit = token.history.filter(h => h.nodeId === activity.id && h.action === 'entered').length;
            const inputs = {
                ...token.contextData,
                _token_id: token.id,
                _run_id: this.runId,
                _workflow_id: this.workflow.id,
                _activity_id: activity.id,
                _activity_name: activity.name,
                // Stable across retries and recovery, so actors can deduplicate side effects
                _idempotency_key: `${this.runId}:${token.id}:${activity.id}:${visit}`,
            };
            // The input given to an agent that asked for it is for this execution only (28.6)
            if (token.getData('_agent_continuation') !== undefined) delete token.contextData._agent_continuation;

            // The service level of an activity counts from the moment the token reaches it, waits and retries included
            const enteredKey = `_entered_at:${activity.id}`;
            if (!token.getData(enteredKey)) token.setData(enteredKey, new Date(this.now()).toISOString());

            // An activity is given the contexts it is bound to read, and no other (spec 22.2)
            const given = this.readContexts(token, activity);
            if (given) (inputs as Record<string, unknown>)._contexts = given;

            // Knowledge from earlier runs, if the activity asks for it (spec 15.4)
            if (this.options.knowledge && activity.knowledge) {
                const entries = this.options.knowledge.retrieve(this.workflow, activity, activity.knowledge);
                if (entries.length > 0) {
                    (inputs as Record<string, unknown>)._knowledge = entries.map(e => ({ id: e.id, type: e.type, title: e.title, guidance: guidance(e) }));
                    this.record({
                        type: 'knowledge.retrieved', token_id: token.id, ...this.nodeRef(activity.id),
                        data: { entries: entries.map(e => ({ id: e.id, type: e.type, title: e.title, status: e.status, observations: e.observations })) },
                    });
                }
            }

            this.log(`Executing activity "${activity.name}" with ${activity.actor_type} actor`);

            const { output, verificationRecords, attempts } = await this.executeActivity(token, actor, activity, inputs);

            const endTime = new Date(this.now());
            const processTime = calculate_duration(startTime, endTime);
            const analytics: Analytics = {
                process_time: processTime,
                cycle_time: processTime,
                lead_time: processTime,
                value_added: activity.analytics?.value_added ?? true,
                waste_categories: attempts > 1 ? ['defects' as WasteCategory] : [],
            };

            // An agent that asks for input parks the token until the host gives it (28.6)
            if (output._awaiting_agent_input) {
                this.parkForAgent(token, activity, output._awaiting_agent_input as Record<string, unknown>, analytics, endTime);
                return;
            }

            // A human task that has not been completed yet parks the token
            if (output._requires_human_action && this.options.wait_for_human_tasks) {
                analytics.waste_categories?.push('waiting' as WasteCategory);
                token.updateStatus('waiting', analytics);
                delete output._contexts;
                token.mergeActivityOutput(activity.id, { ...output, _waiting_since: endTime.toISOString() });
                this.record({
                    type: 'token.waiting', token_id: token.id, ...this.nodeRef(activity.id),
                    data: { reason: 'human_task', human_task_id: output._human_task_id },
                });
                this.log(`Token paused waiting for human task ${output._human_task_id}`);
                return;
            }

            // What the activity wrote to contexts is checked against its bindings before anything else counts
            this.writeContexts(token, activity, output);
            delete output._context_writes;
            delete output._contexts;                     // an actor that echoes its input must not carry contexts into the token's data
            this.closeServiceLevel(token, activity);

            token.mergeActivityOutput(activity.id, {
                ...output,
                ...outcome_fields(output),
                _last_actor_id: activity.id,
                _last_actor_type: activity.actor_type,
                ...(verificationRecords.length > 0 ? { _verification_records: verificationRecords } : {}),
            });

            const durationMs = endTime.getTime() - startTime.getTime();
            this.trackCost(activity, output, durationMs);
            this.executionStats.stepsCount++;

            this.record({
                type: 'activity.completed', token_id: token.id, ...this.nodeRef(activity.id), attempt: attempts,
                data: {
                    actor_type: activity.actor_type,
                    output: this.journal.payload(public_payload(output)),
                    duration_ms: durationMs,
                    attempts,
                    ...(output.usage ? { usage: output.usage } : {}),
                },
            });

            this.completedActivities.push({ activity_id: activity.id, token_id: token.id, output: public_payload(output) });

            await this.advanceToken(token, currentNodeId, analytics);
        } catch (error: unknown) {
            const analytics: Analytics = {
                process_time: calculate_duration(startTime, new Date(this.now())),
                waste_categories: ['defects' as WasteCategory],
                error_rate: 1,
            };
            this.failToken(token, error, analytics);
        }
    }

    /**
     * Process an event node (spec: "Events").
     * start and intermediate events pass the token on; end events complete it;
     * timer events hold it for a duration. Other event types are not executable
     * and fail the token rather than letting it through unexamined.
     */
    private async processEvent(token: Token, event: WorkflowEvent): Promise<void> {
        const ref = { token_id: token.id, ...this.nodeRef(event.id) };

        switch (event.event_type) {
            case 'start':
            case 'intermediate':
                await this.advanceToken(token, event.id);
                return;

            case 'end':
                token.updateStatus('completed');
                this.record({ type: 'token.completed', ...ref, data: { end_event: true } });
                return;

            case 'timer': {
                const dueKey = `_timer_due:${event.id}`;
                const due = token.getData(dueKey) as string | undefined;

                if (!due) {
                    // First visit: note when the timer is due and yield, so the
                    // deadline is checkpointed before the engine waits on it.
                    let durationMs: number;
                    try {
                        durationMs = parse_iso_duration(String(event.event_definition?.duration));
                    } catch (error) {
                        this.failToken(token, new ActivityError(`Timer "${event.name}": ${error_info(error).message}`, 'VALIDATION_ERROR'));
                        return;
                    }
                    const dueAt = new Date(this.now() + durationMs).toISOString();
                    token.setData(dueKey, dueAt);
                    this.record({ type: 'timer.started', ...ref, data: { duration: event.event_definition?.duration, duration_ms: durationMs, due_at: dueAt } });
                    return;
                }

                const remaining = new Date(due).getTime() - this.now();
                if (remaining > 0) await this.sleep(remaining);
                const { [dueKey]: _fired, ...rest } = token.contextData;
                token.contextData = rest;
                this.record({ type: 'timer.fired', ...ref, data: { due_at: due } });
                await this.advanceToken(token, event.id);
                return;
            }

            case 'message':
            case 'signal': {
                const definition = (event.event_definition || {}) as EventDefinition;
                if (!definition.name) {
                    this.failToken(token, new ActivityError(`Event "${event.name}" has no event_definition.name`, 'VALIDATION_ERROR'));
                    return;
                }

                if (definition.mode === 'publish') {
                    // The journal is the outbox: the event is recorded first, with an id that is
                    // the same on every retry, then handed to the sink. A consumer deduplicates by id.
                    const visit = token.history.filter(h => h.nodeId === event.id && h.action === 'entered').length;
                    const published: BusinessEvent = {
                        specversion: '1.0',
                        id: `${this.runId}:${event.id}:${visit}`,
                        source: `urn:awa:run:${this.runId}`,
                        type: definition.name,
                        time: new Date(this.now()).toISOString(),
                        datacontenttype: 'application/json',
                        data: Object.fromEntries((definition.data || []).map(key => [key, resolve_path(token.contextData, key)])),
                    };
                    this.record({ type: 'event.published', ...ref, data: { event_id: published.id, name: published.type, source: published.source, data: this.journal.payload(published.data), delivered: !!this.options.event_sink } });
                    try {
                        await this.options.event_sink?.(published);
                    } catch (error) {
                        this.failToken(token, new ActivityError(`Event "${definition.name}" could not be published: ${error_info(error).message}`, 'EVENT_PUBLISH_FAILED'));
                        return;
                    }
                    await this.advanceToken(token, event.id);
                    return;
                }

                // Wait for the event. The deadline is fixed now and survives a restart.
                let dueAt: string | undefined;
                if (definition.timeout) {
                    try {
                        dueAt = new Date(this.now() + parse_iso_duration(definition.timeout)).toISOString();
                    } catch (error) {
                        this.failToken(token, new ActivityError(`Event "${event.name}": ${error_info(error).message}`, 'VALIDATION_ERROR'));
                        return;
                    }
                }
                const correlation = event.event_type === 'message' ? definition.correlation_key : undefined;
                const awaiting = {
                    node_id: event.id,
                    name: definition.name,
                    ...(correlation ? { correlation_key: correlation, correlation_value: resolve_path(token.contextData, correlation) } : {}),
                    ...(dueAt ? { due_at: dueAt } : {}),
                    ...(definition.timeout_edge_id ? { timeout_edge_id: definition.timeout_edge_id } : {}),
                    broadcast: event.event_type === 'signal',
                };
                token.setData('_awaiting_event', awaiting);
                token.updateStatus('waiting');
                this.record({ type: 'event.waiting', ...ref, data: { name: awaiting.name, correlation_key: correlation, correlation_value: awaiting.correlation_value, due_at: dueAt } });
                return;
            }

            default:
                this.failToken(token, new ActivityError(
                    `Event "${event.name}" has type "${event.event_type}", which this engine cannot execute`, 'UNSUPPORTED_EVENT'));
        }
    }

    private now(): number {
        return this.options.now ? this.options.now() : Date.now();
    }

    private awaiting(token: Token): AwaitedEvent | undefined {
        return token.status === 'waiting' ? token.getData('_awaiting_event') as AwaitedEvent | undefined : undefined;
    }

    /**
     * Give the run a business event (spec 18.2). Tokens waiting for an event of
     * this type, whose correlation matches, take its data and continue. A message
     * is consumed by one token; a signal by every token waiting for it. An event
     * id the run has already seen is ignored, so redelivery is harmless.
     * Returns how many tokens continued. Call run() afterwards.
     */
    public async deliverEvent(event: BusinessEvent): Promise<number> {
        if (this.deliveredEvents.has(event.id)) return 0;
        let resumed = 0;

        for (const token of this.tokens) {
            const awaited = this.awaiting(token);
            if (!awaited || awaited.name !== event.type) continue;
            if (awaited.correlation_key
                && String(resolve_path(event.data || {}, awaited.correlation_key)) !== String(awaited.correlation_value)) continue;

            const ref = { token_id: token.id, ...this.nodeRef(awaited.node_id) };
            const { _awaiting_event, ...rest } = token.contextData;
            token.contextData = rest;
            token.mergeData(public_payload(event.data || {}));
            token.updateStatus('active');
            this.record({
                type: 'event.received', ...ref,
                data: { event_id: event.id, name: event.type, source: event.source, data: this.journal.payload(event.data || {}) },
            });
            resumed++;
            await this.advanceToken(token, awaited.node_id);
            if (!awaited.broadcast) break;
        }

        if (resumed > 0) {
            this.deliveredEvents.add(event.id);
            if (this.status === 'waiting_event' || this.status === 'waiting_human') this.status = 'running';
            await this.settle();
            await this.saveCheckpoint();
        }
        return resumed;
    }

    /**
     * Withdraw the run (spec 5.8): the work is no longer wanted. Tokens that have
     * not finished are cancelled, completed activities that name a compensation
     * handler are undone, and the run is `cancelled`. A run that already reached
     * an outcome is left as it is. Returns whether the run was cancelled.
     */
    public async cancel(reason: string): Promise<boolean> {
        if (['completed', 'failed', 'cancelled', 'idle'].includes(this.status)) return false;
        for (const token of this.tokens.filter(t => ['active', 'waiting', 'joining'].includes(t.status))) {
            token.updateStatus('cancelled');
            this.record({ type: 'token.cancelled', token_id: token.id, ...this.nodeRef(token.activityId), data: { reason: 'run_cancelled' } });
        }
        const compensation = await this.compensate();
        this.status = 'cancelled';
        this.record({ type: 'run.cancelled', data: { reason, ...(compensation ? { compensation } : {}) } });
        await this.toolSessions.close();
        await this.saveCheckpoint();
        return true;
    }

    /** The earliest time at which a waiting token's event wait runs out, in milliseconds */
    public nextEventDeadline(): number | undefined {
        const due = this.tokens.map(t => this.awaiting(t)?.due_at).filter((d): d is string => !!d).map(d => new Date(d).getTime());
        return due.length ? Math.min(...due) : undefined;
    }

    // ---------------------------------------------------------------- contexts (spec 22)

    /** The contexts an activity is bound to read, by name. Fails the activity when a required one has no value. */
    private readContexts(token: Token, activity: Activity): Record<string, unknown> | undefined {
        const bindings = activity.context_bindings || [];
        if (bindings.length === 0) return undefined;
        const given: Record<string, unknown> = {};
        const seen: Record<string, unknown>[] = [];
        for (const binding of bindings) {
            if (!CAN_READ.has(binding.access_mode)) continue;
            const context = this.contextManager.getContextDefinition(binding.context_id);
            if (!context) throw new ActivityError(`Activity "${activity.name}" binds a context the workflow does not declare (${binding.context_id})`, 'CONTEXT_NOT_FOUND');
            let value = this.contextManager.get(binding.context_id, this.now());
            if (value !== undefined && value !== null && binding.transforms?.on_read) value = resolve_path(value, binding.transforms.on_read);
            const present = value !== undefined && value !== null;
            seen.push({ context_id: context.id, context_name: context.name, access_mode: binding.access_mode, present, ...(present ? { value_hash: hash_payload(value) } : {}) });
            if (!present && binding.required !== false) {
                this.record({ type: 'context.read', token_id: token.id, ...this.nodeRef(activity.id), data: { contexts: seen } });
                throw new ActivityError(`Activity "${activity.name}" requires context "${context.name}", which has no value`, 'CONTEXT_MISSING');
            }
            if (present) given[context.name] = JSON.parse(JSON.stringify(value));
        }
        if (seen.length > 0) this.record({ type: 'context.read', token_id: token.id, ...this.nodeRef(activity.id), data: { contexts: seen } });
        return given;
    }

    /**
     * Apply what an activity wrote to contexts (`_context_writes` in its output, by context name).
     * Every write needs a binding that allows writing; one that does not, or a value the
     * context's schema refuses, fails the activity and nothing is written.
     */
    private writeContexts(token: Token, activity: Activity, output: Record<string, unknown>): void {
        const writes = output._context_writes;
        if (writes === undefined) return;
        const ref = { token_id: token.id, ...this.nodeRef(activity.id) };
        if (typeof writes !== 'object' || writes === null || Array.isArray(writes)) {
            throw new ActivityError(`Activity "${activity.name}" returned _context_writes that is not an object keyed by context name`, 'CONTEXT_INVALID');
        }
        const by_name = new Map(this.contextManager.list().map(c => [c.name, c]));
        const plan: { context: Context; binding: Activity['context_bindings'][number]; value: unknown }[] = [];
        for (const [name, value] of Object.entries(writes as Record<string, unknown>)) {
            const context = by_name.get(name);
            const binding = context && (activity.context_bindings || []).find(b => b.context_id === context.id && CAN_WRITE.has(b.access_mode));
            if (!context || !binding) {
                const reason = !context ? 'the workflow declares no such context' : 'the activity has no binding that allows writing to it';
                this.record({ type: 'context.denied', ...ref, data: { context_name: name, ...(context ? { context_id: context.id } : {}), reason } });
                throw new ActivityError(`Activity "${activity.name}" wrote to context "${name}": ${reason}`, 'CONTEXT_ACCESS_DENIED');
            }
            plan.push({ context, binding, value });
        }
        const before = this.contextManager.snapshot();
        const before_times = this.contextManager.snapshot_times();
        const written: Record<string, unknown>[] = [];
        try {
            for (const { context, binding, value } of plan) {
                let next = value;
                if (binding.transforms?.on_write) {
                    // The value is placed at a path within the context's value
                    const whole = JSON.parse(JSON.stringify(this.contextManager.get(context.id, this.now()) ?? {}));
                    if (typeof whole !== 'object' || whole === null || Array.isArray(whole)) throw new ContextError(`Context "${context.name}" does not hold an object: nothing can be written at "${binding.transforms.on_write}"`, 'CONTEXT_INVALID');
                    const parts = binding.transforms.on_write.split('.');
                    let at = whole as Record<string, unknown>;
                    for (const part of parts.slice(0, -1)) {
                        if (typeof at[part] !== 'object' || at[part] === null) at[part] = {};
                        at = at[part] as Record<string, unknown>;
                    }
                    at[parts[parts.length - 1]] = value;
                    this.contextManager.set(context.id, whole, this.now());
                    next = whole;
                } else {
                    next = this.contextManager.write(context.id, value, this.now());
                }
                written.push({ context_id: context.id, context_name: context.name, sync_pattern: context.sync_pattern, access_mode: binding.access_mode, value_hash: hash_payload(next) });
            }
        } catch (error) {
            this.contextManager.replace(before, before_times);              // all of an activity's writes, or none
            if (error instanceof ContextError) {
                this.record({ type: 'context.denied', ...ref, data: { reason: error.message } });
                throw new ActivityError(error.message, error.code);
            }
            throw error;
        }
        for (const data of written) this.record({ type: 'context.written', ...ref, data });
    }

    // ---------------------------------------------------------------- service levels (spec 23)

    /**
     * Compare the time taken with a service level and record, once each, a warning and a breach.
     * Returns 'breached' when the longest time allowed has passed.
     */
    private serviceLevel(scope: 'activity' | 'workflow', sla: Activity['sla'], elapsedMs: number, ref: Record<string, unknown>, key: string): { state: 'ok' | 'warning' | 'breached'; action: string; recorded: number } {
        const nothing = { state: 'ok' as const, action: 'record', recorded: 0 };
        if (!sla) return nothing;
        const duration = (text?: string) => { if (!text) return undefined; try { return parse_iso_duration(text); } catch { return undefined; } };
        const max = duration(sla.max_time);
        const policy = sla.escalation_policy;
        const warn_text = policy?.warning_threshold || sla.target_time;
        const warn = duration(warn_text);
        const action = policy?.breach_action || 'record';
        const notify = policy?.notify_roles?.length ? { notify_roles: policy.notify_roles } : {};
        const named = sla.name ? { name: sla.name } : {};
        let recorded = 0;
        const once = (kind: string, event: () => void) => { if (!this.slaRecorded.has(`${key}:${kind}`)) { this.slaRecorded.add(`${key}:${kind}`); event(); recorded++; } };
        if (warn !== undefined && elapsedMs > warn && (max === undefined || elapsedMs <= max)) {
            once('warning', () => this.record({ type: 'sla.warning', ...ref, data: { scope, ...named, elapsed_ms: elapsedMs, threshold: warn_text, threshold_ms: warn, ...(policy?.warning_action ? { action: policy.warning_action } : {}), ...notify } }));
        }
        if (max !== undefined && elapsedMs > max) {
            once('breached', () => this.record({ type: 'sla.breached', ...ref, data: { scope, ...named, elapsed_ms: elapsedMs, max_time: sla.max_time, max_time_ms: max, action, ...notify } }));
            return { state: 'breached', action, recorded };
        }
        return { state: recorded ? 'warning' : 'ok', action, recorded };
    }

    private activityElapsed(token: Token, activity: Activity, now = this.now()): { elapsed: number; key: string } {
        const entered = token.getData(`_entered_at:${activity.id}`) as string | undefined;
        return { elapsed: entered ? now - new Date(entered).getTime() : 0, key: `activity:${token.id}:${activity.id}:${entered || ''}` };
    }

    /** The activity is done: record how it stood against its service level. Work that finished late stands. */
    private closeServiceLevel(token: Token, activity: Activity): void {
        const { elapsed, key } = this.activityElapsed(token, activity);
        this.serviceLevel('activity', activity.sla, elapsed, { token_id: token.id, ...this.nodeRef(activity.id) }, key);
        const { [`_entered_at:${activity.id}`]: _entered, ...rest } = token.contextData;
        token.contextData = rest;
    }

    /** Before another attempt: an activity past its longest time, whose breach action is `fail`, is not tried again */
    private failIfOverdue(token: Token, activity: Activity): void {
        const { elapsed, key } = this.activityElapsed(token, activity);
        const level = this.serviceLevel('activity', activity.sla, elapsed, { token_id: token.id, ...this.nodeRef(activity.id) }, key);
        if (level.state === 'breached' && level.action === 'fail') {
            throw new ActivityError(`Activity "${activity.name}" passed its service level of ${activity.sla?.max_time} and is not tried again`, 'SLA_BREACH');
        }
    }

    /**
     * Compare work that is waiting with its service levels (spec 23.2): activities waiting for a
     * person, and the run as a whole. Warnings and breaches are recorded once. Where the breach
     * action is `fail`, the waiting token fails with SLA_BREACH. Call run() afterwards when
     * `failed` is not zero. A host calls this on its schedule, as it calls expireEvents.
     */
    public async checkServiceLevels(now: number = this.now()): Promise<{ warnings: number; breaches: number; failed: number }> {
        const result = { warnings: 0, breaches: 0, failed: 0 };
        if (['completed', 'failed', 'cancelled', 'idle'].includes(this.status)) return result;
        const before = this.slaRecorded.size;
        const count = (level: { state: string; recorded: number }) => { if (level.state === 'breached' && level.recorded) result.breaches++; };
        for (const token of this.tokens.filter(t => t.status === 'waiting')) {
            const activity = this.activityMap.get(token.activityId);
            if (!activity?.sla) continue;
            const { elapsed, key } = this.activityElapsed(token, activity, now);
            const level = this.serviceLevel('activity', activity.sla, elapsed, { token_id: token.id, ...this.nodeRef(activity.id) }, key);
            count(level);
            if (level.state === 'breached' && level.action === 'fail') {
                this.failToken(token, new ActivityError(`Activity "${activity.name}" passed its service level of ${activity.sla.max_time} while waiting`, 'SLA_BREACH'));
                result.failed++;
            }
        }
        const run = this.serviceLevel('workflow', this.workflow.sla, now - this.executionStats.startTime.getTime(), {}, 'workflow');
        count(run);
        if (run.state === 'breached' && run.action === 'fail' && result.failed === 0) {
            const open = this.tokens.find(t => t.status === 'waiting' || t.status === 'active' || t.status === 'joining');
            if (open) {
                this.failToken(open, new ActivityError(`The run passed its service level of ${this.workflow.sla?.max_time}`, 'SLA_BREACH'));
                result.failed++;
            }
        }
        result.warnings = this.slaRecorded.size - before - result.breaches;
        if (result.failed > 0) {
            if (this.status === 'waiting_event' || this.status === 'waiting_human') this.status = 'running';
            await this.settle();
        }
        if (this.slaRecorded.size !== before || result.failed > 0) await this.saveCheckpoint();
        return result;
    }

    /**
     * Time out the event waits whose deadline has passed (spec 18.3). The token
     * takes the event's timeout edge; an event without one fails the token.
     * Returns how many tokens timed out. Call run() afterwards.
     */
    public async expireEvents(now: number = this.now()): Promise<number> {
        let expired = 0;
        for (const token of this.tokens) {
            const awaited = this.awaiting(token);
            if (!awaited?.due_at || new Date(awaited.due_at).getTime() > now) continue;

            const ref = { token_id: token.id, ...this.nodeRef(awaited.node_id) };
            const { _awaiting_event, ...rest } = token.contextData;
            token.contextData = rest;
            token.updateStatus('active');
            this.record({ type: 'event.timed_out', ...ref, data: { name: awaited.name, due_at: awaited.due_at } });
            expired++;

            const target = awaited.timeout_edge_id ? this.getEdgeTarget(awaited.timeout_edge_id) : undefined;
            if (awaited.timeout_edge_id && target) {
                this.moveToken(token, awaited.timeout_edge_id, target, 'timeout');
            } else {
                this.failToken(token, new ActivityError(`No "${awaited.name}" event arrived before ${awaited.due_at}, and the event has no timeout edge`, 'EVENT_TIMEOUT'));
            }
        }
        if (expired > 0) {
            if (this.status === 'waiting_event' || this.status === 'waiting_human') this.status = 'running';
            await this.settle();
            await this.saveCheckpoint();
        }
        return expired;
    }

    /** Mark a token failed and record why, in its data and in the journal */
    private failToken(token: Token, error: unknown, analytics?: Analytics): void {
        const info = error_info(error);
        const details = error instanceof ActivityError ? error.details : undefined;
        this.log(`Token ${token.id} failed: ${info.message}`);
        token.updateStatus('failed', analytics);
        token.mergeData({
            _error: info.message,
            ...(info.code ? { _error_code: info.code } : {}),
            ...(info.stack && !(error instanceof ActivityError) ? { _stack: info.stack } : {}),
            ...(details || {}),
        });
        // Whatever the failure carried, contexts are not part of the run's data (22.2)
        const { _contexts: _given, _context_writes: _written, ...kept } = token.contextData;
        token.contextData = kept;
        this.record({
            type: 'token.failed', token_id: token.id, ...this.nodeRef(token.activityId),
            data: { error: { message: info.message, code: info.code } },
        });
    }

    /** The retry policy that applies to an activity: its own, else the engine default, else none */
    private retryPolicy(activity: Activity): RetryConfig {
        const declared = (activity as Activity & { retry?: ActivityRetry }).retry;
        const base: RetryConfig = { ...DEFAULT_RETRY_CONFIG, max_retries: 0, ...(this.options.retry || {}) };
        if (!declared) return base;
        return {
            ...base,
            max_retries: Math.max(0, (declared.max_attempts ?? base.max_retries + 1) - 1),
            initial_delay_ms: declared.initial_delay ? parse_iso_duration(declared.initial_delay) : base.initial_delay_ms,
            max_delay_ms: declared.max_delay ? parse_iso_duration(declared.max_delay) : base.max_delay_ms,
            backoff_multiplier: declared.backoff_multiplier ?? base.backoff_multiplier,
            jitter: declared.jitter ?? base.jitter,
            non_retryable_errors: declared.non_retryable_errors ?? base.non_retryable_errors,
        };
    }

    /**
     * Execute an activity until an attempt is accepted or no further attempt
     * is allowed (spec: "Attempts"). Every execution of the actor is one
     * attempt. An attempt ends in one of three ways:
     *  - accepted: the actor returned, the outcome contract holds and verification, if any, passed
     *  - rejected: the contract or verification did not pass; an ai_agent is re-executed with feedback if allowed
     *  - errored:  the actor raised or timed out; retried with backoff if the retry policy allows
     * Checks run cheapest first: contract (deterministic), then verification (may call a model),
     * then, if the contract says so, escalation to a human.
     */
    private async executeActivity(
        token: Token,
        actor: Actor,
        activity: Activity,
        inputs: Record<string, unknown>
    ): Promise<{ output: Record<string, unknown>; verificationRecords: VerificationRecord[]; attempts: number }> {
        const policy = activity.verification;
        const verify = !!policy && policy.enabled && this.options.verification_enabled !== false;
        const maxVerifications = verify ? policy!.max_retries + 1 : 1;
        const contract = activity.outcome_contract;
        const budgets = contract?.budgets;
        const hardCap = budgets?.max_attempts ?? Infinity;
        const violationCap = budgets?.max_attempts ?? 3;
        const timeoutMs = budgets?.max_duration ? parse_iso_duration(budgets.max_duration) : undefined;
        const retry = this.retryPolicy(activity);
        const ref = { token_id: token.id, ...this.nodeRef(activity.id) };

        const verificationRecords: VerificationRecord[] = [];
        let currentInputs = { ...inputs };
        let attempt = 0;
        let errors = 0;
        let rejections = 0;
        let tokensUsed = 0;

        for (;;) {
            attempt++;
            const attemptStart = this.now();
            this.record({
                type: 'activity.started', ...ref, attempt,
                data: {
                    actor_type: activity.actor_type,
                    role_id: activity.role_id,
                    input: this.journal.payload(public_payload(currentInputs)),
                    ...(currentInputs._verification_feedback ? { feedback: currentInputs._verification_feedback } : {}),
                },
            });

            // --- execute -------------------------------------------------
            let output: Record<string, unknown>;
            try {
                const context: ActorContext = {
                    record: event => this.record({ ...event, ...ref, attempt }),
                    payload: value => this.journal.payload(value),
                };
                if ((activity.tools || []).length > 0) {
                    context.tools = new ToolRunner(
                        activity.tools,
                        { ...(this.options.tools || {}), sessions: this.toolSessions },
                        event => this.record({ ...event, ...ref, attempt }),
                        value => this.journal.payload(value),
                        { max_calls: budgets?.max_tool_calls ?? 16, simulate: this.simulate },
                    );
                }
                const raw = await this.withTimeout(
                    actor.execute(activity, { ...currentInputs, _attempt: attempt }, context), timeoutMs, activity.name);
                output = this.extractTraces(raw, ref, attempt);
                // An actor that echoes what it was given must not carry contexts anywhere a result goes:
                // not into the token's data, and not into the details of a rejected outcome
                delete output._contexts;
            } catch (error: unknown) {
                errors++;
                const info = error_info(error);
                const retryable = errors <= retry.max_retries
                    && attempt < hardCap
                    && !NEVER_RETRIED.has(info.code || '')
                    && !(info.code && retry.non_retryable_errors?.includes(info.code));
                this.record({
                    type: 'activity.failed', ...ref, attempt,
                    data: { error: { message: info.message, code: info.code }, retryable, duration_ms: this.now() - attemptStart },
                });

                if (!retryable) {
                    if (retry.max_retries > 0) {
                        this.deadLetterQueue.add(token, this.workflow.id, activity.id,
                            error instanceof Error ? error : new Error(info.message),
                            { attempt, started_at: attemptStart, last_error: error instanceof Error ? error : undefined });
                        this.record({ type: 'activity.dead_lettered', ...ref, attempt, data: { error: { message: info.message, code: info.code }, attempts: attempt } });
                    }
                    throw error;
                }

                this.failIfOverdue(token, activity);
                const delay = calculate_retry_delay(retry, errors - 1);
                this.record({ type: 'activity.retry_scheduled', ...ref, attempt, data: { delay_ms: delay, next_attempt: attempt + 1 } });
                this.record({
                    type: 'meta.recorded', level: 'meta', ...ref, attempt,
                    data: {
                        subject: 'retry',
                        decision: `Retry after ${delay} ms`,
                        rationale: `Attempt ${attempt} raised "${info.message}"${info.code ? ` (${info.code})` : ''}. `
                            + `The error is retryable and ${retry.max_retries - errors + 1} of ${retry.max_retries} retries remained.`,
                    },
                });
                await this.sleep(delay);
                // The delay counts too: an activity whose longest time ran out while it waited to be tried again is not tried
                this.failIfOverdue(token, activity);
                continue;
            }

            // A human task that is still pending is not an outcome yet. The token is
            // parked, and the contract is checked when the answer arrives (resumeToken).
            if (output._requires_human_action && this.options.wait_for_human_tasks) {
                return { output, verificationRecords, attempts: attempt };
            }
            // Nor is a task in which the agent asks for input (28.6)
            if (output._awaiting_agent_input) {
                return { output, verificationRecords, attempts: attempt };
            }

            const usage = output.usage as { input_tokens?: number; output_tokens?: number } | undefined;
            tokensUsed += (usage?.input_tokens || 0) + (usage?.output_tokens || 0);
            const outcome = outcome_of(output);
            const reject = (code: string, message: string, details: Record<string, unknown>) =>
                this.rejectOutcome(token, activity, inputs, output, code, message, details, verificationRecords, attempt);

            // --- outcome contract (deterministic) ------------------------
            if (contract) {
                const violations = check_contract(contract, outcome);
                if (budgets?.max_tokens !== undefined && tokensUsed > budgets.max_tokens) {
                    violations.push({ kind: 'budget', name: 'max_tokens', message: `max_tokens: ${tokensUsed} tokens used, the budget is ${budgets.max_tokens}` });
                }
                this.record({
                    type: 'contract.checked', ...ref, attempt,
                    data: { passed: violations.length === 0, violations, tokens_used: tokensUsed, output_hash: hash_payload(outcome) },
                });

                if (violations.length > 0) {
                    const message = `Outcome contract violated: ${violations.map(v => v.message).join('; ')}`;
                    const overBudget = violations.some(v => v.kind === 'budget');
                    const canRetry = !overBudget && activity.actor_type === 'ai_agent' && attempt < violationCap;
                    this.record({
                        type: 'activity.failed', ...ref, attempt,
                        data: { error: { message, code: 'CONTRACT_VIOLATION' }, retryable: canRetry, duration_ms: this.now() - attemptStart },
                    });
                    if (!canRetry) {
                        return reject('CONTRACT_VIOLATION', message, { _contract_violations: violations });
                    }
                    currentInputs = { ...inputs, _verification_feedback: contract_feedback(violations), _verification_attempt: attempt + 1 };
                    this.record({
                        type: 'meta.recorded', level: 'meta', ...ref, attempt,
                        data: {
                            subject: 'contract_retry',
                            decision: 'Re-execute with the violated contract terms as feedback',
                            rationale: `${violations.length} contract term(s) did not hold and ${violationCap - attempt} of ${violationCap} attempts remained.`,
                            violations: violations.map(v => v.name),
                        },
                    });
                    continue;
                }
            }

            if (!verify) {
                return { output, verificationRecords, attempts: attempt };
            }

            // --- verification (may call a model) -------------------------
            let verification: VerificationRecord;
            try {
                verification = await this.verificationEngine.verify(activity, currentInputs, outcome, rejections + 1);
            } catch (verificationError: unknown) {
                // Fail closed: an output that could not be verified is not accepted
                verification = {
                    id: randomUUID(),
                    activity_id: activity.id,
                    attempt: rejections + 1,
                    verdict: 'error',
                    criteria_results: [],
                    overall_score: 0,
                    feedback: `Verification engine error: ${error_info(verificationError).message}`,
                    verified_at: new Date(this.now()).toISOString(),
                    duration_ms: 0,
                    output_hash: this.verificationEngine.compute_output_hash(outcome),
                };
            }
            verificationRecords.push(verification);

            if (verification.judge_tokens) {
                const judged = verification.judge_tokens.input + verification.judge_tokens.output;
                tokensUsed += judged;
                this.executionStats.verificationTokens += judged;
                this.executionStats.inputTokens += verification.judge_tokens.input;
                this.executionStats.outputTokens += verification.judge_tokens.output;
            }

            this.record({
                type: 'verification.completed', ...ref, attempt,
                data: {
                    mode: policy!.mode,
                    verdict: verification.verdict,
                    score: verification.overall_score,
                    pass_threshold: policy!.pass_threshold,
                    criteria: verification.criteria_results,
                    feedback: verification.feedback,
                    output_hash: verification.output_hash,
                    output: this.journal.payload(outcome),
                },
            });

            // The token budget covers the judge as well (spec 11.4): check it again now
            if (budgets?.max_tokens !== undefined && tokensUsed > budgets.max_tokens) {
                const violation = { kind: 'budget' as const, name: 'max_tokens', message: `max_tokens: ${tokensUsed} tokens used including verification, the budget is ${budgets.max_tokens}` };
                const message = `Outcome contract violated: ${violation.message}`;
                this.record({ type: 'contract.checked', ...ref, attempt, data: { passed: false, violations: [violation], tokens_used: tokensUsed, output_hash: hash_payload(outcome) } });
                this.record({ type: 'activity.failed', ...ref, attempt, data: { error: { message, code: 'CONTRACT_VIOLATION' }, retryable: false, duration_ms: this.now() - attemptStart } });
                return reject('CONTRACT_VIOLATION', message, { _contract_violations: [violation] });
            }

            if (verification.verdict === 'pass') {
                this.log(`Activity "${activity.name}" passed verification (attempt ${attempt})`);
                return { output, verificationRecords, attempts: attempt };
            }

            rejections++;
            const canRetry = verification.verdict === 'fail'
                && activity.actor_type === 'ai_agent'
                && policy!.retry_with_feedback
                && rejections < maxVerifications
                && attempt < hardCap;
            const message = `Verification ${verification.verdict}: ${verification.feedback || 'criteria not met'}`;

            this.record({
                type: 'activity.failed', ...ref, attempt,
                data: { error: { message, code: 'VERIFICATION_FAILED' }, retryable: canRetry, duration_ms: this.now() - attemptStart },
            });

            if (!canRetry) {
                return reject('VERIFICATION_FAILED', `Verification failed: ${verification.feedback || verification.verdict}`, {});
            }

            const feedback = this.verificationEngine.generate_corrective_feedback(verification);
            currentInputs = { ...inputs, _verification_feedback: feedback, _verification_attempt: rejections + 1 };
            this.record({
                type: 'meta.recorded', level: 'meta', ...ref, attempt,
                data: {
                    subject: 'verification_retry',
                    decision: 'Re-execute with corrective feedback',
                    rationale: `The output scored ${(verification.overall_score * 100).toFixed(0)}% against a threshold of `
                        + `${(policy!.pass_threshold * 100).toFixed(0)}%. ${maxVerifications - rejections} verification attempt(s) remained.`,
                    failed_criteria: verification.criteria_results.filter(c => !c.passed).map(c => c.criterion_name),
                },
            });
        }
    }

    /** Fail an attempt that takes longer than the contract's duration budget */
    private async withTimeout<T>(work: Promise<T>, timeoutMs: number | undefined, name: string): Promise<T> {
        if (timeoutMs === undefined) return work;
        let timer: ReturnType<typeof setTimeout> | undefined;
        const timeout = new Promise<never>((_, reject) => {
            timer = setTimeout(
                () => reject(new ActivityError(`Activity "${name}" exceeded its duration budget of ${timeoutMs} ms`, 'TIMEOUT')),
                timeoutMs);
        });
        try {
            return await Promise.race([work, timeout]);
        } finally {
            clearTimeout(timer);
        }
    }

    /**
     * An outcome was rejected and no further automatic attempt is allowed.
     * Either the activity fails, or, if the contract says so, a human decides.
     */
    private async rejectOutcome(
        token: Token,
        activity: Activity,
        inputs: Record<string, unknown>,
        rejected: Record<string, unknown>,
        code: string,
        message: string,
        details: Record<string, unknown>,
        verificationRecords: VerificationRecord[],
        attempts: number
    ): Promise<{ output: Record<string, unknown>; verificationRecords: VerificationRecord[]; attempts: number }> {
        const contract = activity.outcome_contract;
        const failure = () => new ActivityError(message, code, {
            ...rejected, ...details,
            ...(verificationRecords.length > 0 ? { _verification_records: verificationRecords } : {}),
        });

        if (contract?.on_violation !== 'escalate_human' || activity.actor_type === 'human') {
            throw failure();
        }

        const ref = { token_id: token.id, ...this.nodeRef(activity.id) };
        this.record({
            type: 'contract.escalated', ...ref, attempt: attempts,
            data: { code, message, rejected_output: this.journal.payload(outcome_of(rejected)), ...details },
        });
        this.record({
            type: 'meta.recorded', level: 'meta', ...ref, attempt: attempts,
            data: {
                subject: 'escalation',
                decision: 'Hand the activity to a human',
                rationale: `After ${attempts} attempt(s) the outcome was still rejected (${code}) and the contract's on_violation is "escalate_human".`,
            },
        });

        const human = this.options.actors?.human
            || new HumanAgent({ wait_for_completion: false, simulate: this.simulate && !this.options.wait_for_human_tasks });
        const result = this.extractTraces(await human.execute(activity, {
            ...inputs,
            _escalation: { code, message, rejected_outcome: outcome_of(rejected), ...details },
        }), ref, attempts);

        if (result._requires_human_action) {
            if (!this.options.wait_for_human_tasks) {
                // Fail closed: a pending task is not an answer
                throw new ActivityError(`${message}. Escalated to a human, but the engine is not configured to wait for human tasks.`, code, details);
            }
            return { output: { ...result, _escalated: true }, verificationRecords, attempts };
        }

        // A human answered at once. The deterministic terms still bind.
        const violations = check_contract(contract, outcome_of(result));
        this.record({
            type: 'contract.checked', ...ref, attempt: attempts,
            data: { passed: violations.length === 0, violations, decided_by: 'human', output_hash: hash_payload(outcome_of(result)) },
        });
        if (violations.length > 0) {
            throw new ActivityError(
                `Outcome contract violated by the human decision: ${violations.map(v => v.message).join('; ')}`,
                'CONTRACT_VIOLATION', { _contract_violations: violations });
        }
        return { output: { ...result, _escalated: true }, verificationRecords, attempts };
    }

    /**
     * Move an actor's self-reported traces out of its result and into the
     * journal. `_reasoning` is the actor's account of how it worked;
     * `_model` says which model served the attempt and why it was chosen.
     */
    private extractTraces(
        result: Record<string, unknown>,
        ref: { token_id: UUID; node_id: UUID; node_name?: string },
        attempt: number
    ): Record<string, unknown> {
        const { _reasoning, _model, ...output } = result;

        if (_model && typeof _model === 'object') {
            const model = _model as { id?: string; provider?: string; source?: string; temperature?: number; tier?: string; route?: RouteAttempt[] };
            this.record({
                type: 'meta.recorded', level: 'meta', ...ref, attempt,
                data: {
                    subject: 'model_selection',
                    decision: `Use model ${model.provider ? `${model.provider}:` : ''}${model.id}`,
                    rationale: (model.source === 'role'
                        ? 'The role assigned to this activity names this model.'
                        : 'The role names no model, so the engine default applies.')
                        + (model.tier ? ` The reference is the capability tier "${model.tier}", which this deployment maps to that model.` : ''),
                    model,
                },
            });
            this.recordRoute(model.route, ref, attempt);
        }

        if (_reasoning && typeof _reasoning === 'object') {
            this.record({ type: 'reasoning.recorded', level: 'reasoning', ...ref, attempt, data: { source: 'actor', ...(_reasoning as object) } });
        }

        return output;
    }

    /** Journal a model route that was not simply "first candidate used": a skip or a fallback happened */
    private recordRoute(route: RouteAttempt[] | undefined, ref: { token_id: UUID; node_id: UUID; node_name?: string }, attempt?: number): void {
        // Nothing to say when the first candidate served; a single candidate that failed is a route worth recording too (12.5)
        if (!route || !route.some(r => r.outcome !== 'used')) return;
        const used = route.find(r => r.outcome === 'used');
        this.record({
            type: 'meta.recorded', level: 'meta', ...ref, ...(attempt ? { attempt } : {}),
            data: {
                subject: 'model_route',
                decision: used ? `Route to ${used.ref}` : 'No model could serve the request',
                rationale: route.filter(r => r.outcome !== 'used')
                    .map(r => `${r.ref} was ${r.outcome === 'skipped' ? 'skipped' : 'tried and failed'}${r.reason ? `: ${r.reason}` : ''}`).join('. ') + '.',
                route,
            },
        });
    }

    /**
     * Process a decision node
     */
    private async processDecisionNode(token: Token, decision: DecisionNode): Promise<void> {
        this.log(`Evaluating decision node "${decision.name}"`);

        const ref = { token_id: token.id, ...this.nodeRef(decision.id) };
        const table = decision.decision_table;
        const model = decision.decision_model;
        const external = decision.decision_engine;
        const strategy = model ? (model.strategy || (table || external ? 'table_first' : 'model')) : external ? 'engine' : 'table';

        // --- decision table (deterministic, native) ----------------------
        let result: ReturnType<typeof evaluate_decision> | undefined;
        try {
            result = table && strategy !== 'model' ? evaluate_decision(decision, token.contextData) : undefined;
        } catch (error: unknown) {
            // The matching rules contradict the hit policy: a defect in the table.
            // Taking the default edge would hide it, so the token fails.
            this.record({ type: 'decision.evaluated', ...ref, data: { method: 'none', strategy, hit_policy: table?.hit_policy, matched: false, conflict: error_info(error).message } });
            this.failToken(token, error);
            return;
        }
        let edgeId = result?.matched ? result.output_edge_id : undefined;
        let method: 'table' | 'engine' | 'model' | 'default' | 'none' = edgeId ? 'table' : 'none';
        let outputs: Record<string, unknown> = result?.matched ? result.outputs : {};
        let modelData: Record<string, unknown> = {};
        let engineData: Record<string, unknown> | undefined;
        /** What the decision adds to the token's data, so that later nodes can use it */
        let dataOutputs: Record<string, unknown> | undefined;

        // --- external decision engine ------------------------------------
        if (external && strategy !== 'model') {
            const engine = this.options.decision_engines?.[external.name];
            if (!engine) {
                this.failToken(token, new ActivityError(
                    `Decision "${decision.name}" needs the decision engine "${external.name}", which is not registered in this deployment`, 'VALIDATION_ERROR'));
                return;
            }
            const facts = external.inputs
                ? Object.fromEntries(external.inputs.map(name => [name, token.contextData[name]]))
                : public_payload(token.contextData);
            const started = this.now();
            engineData = { name: external.name, ruleset: external.ruleset };
            try {
                const decided = await engine.decide({
                    node_id: decision.id, node_name: decision.name, ruleset: external.ruleset,
                    options: external.options.map(o => ({ id: o.id, description: o.description })), inputs: facts, config: external.config,
                });
                const option = external.options.find(o => o.id === decided.option);
                engineData = {
                    ...engineData, option: decided.option, fired_rules: decided.fired_rules, explanation: decided.explanation, duration_ms: this.now() - started,
                    ...(decided.option && !option ? { no_decision_reason: `"${decided.option}" is not one of the options` } : {}),
                    ...(!decided.option ? { no_decision_reason: 'the engine returned no option' } : {}),
                };
                if (option) {
                    edgeId = option.output_edge_id;
                    method = 'engine';
                    outputs = { ...(decided.outputs || {}) };
                }
            } catch (error: unknown) {
                engineData = { ...engineData, no_decision_reason: `the engine failed: ${error_info(error).message}`, duration_ms: this.now() - started };
            }
        }

        // --- decision model ----------------------------------------------
        if (!edgeId && model) {
            const scripted = (this.simulate ? this.options.simulated_outputs?.[decision.name]?.output : undefined)
                ?? (this.options.model_decision_override?.(decision) as Record<string, unknown> | undefined);
            const decided = scripted
                ? {
                    option: model.options.find(o => o.id === scripted.option)?.id,
                    edge_id: model.options.find(o => o.id === scripted.option)?.output_edge_id,
                    confidence: scripted.confidence as number | undefined,
                    rationale: this.simulate ? 'Simulated decision' : 'Decision supplied without calling a model',
                    reason: model.options.some(o => o.id === scripted.option) ? undefined : `"${scripted.option}" is not one of the options`,
                    votes: [], route: [] as RouteAttempt[], usage: { input_tokens: 0, output_tokens: 0 }, model: undefined,
                }
                : this.simulate
                    ? { reason: 'simulation mode supplies no model decision', votes: [], route: [] as RouteAttempt[], usage: { input_tokens: 0, output_tokens: 0 }, option: undefined, edge_id: undefined, confidence: undefined, rationale: undefined, model: undefined }
                    : await decide_with_model(decision, token.contextData, this.router, this.defaultAIModelId);

            this.executionStats.inputTokens += decided.usage.input_tokens;
            this.executionStats.outputTokens += decided.usage.output_tokens;

            if (decided.model) {
                this.record({
                    type: 'meta.recorded', level: 'meta', ...ref,
                    data: {
                        subject: 'model_selection',
                        decision: `Use model ${decided.model.provider}:${decided.model.id}`,
                        rationale: (model.model ? 'The decision names this model.' : 'The decision names no model, so the engine default applies.')
                            + (decided.model.tier ? ` The reference is the capability tier "${decided.model.tier}", which this deployment maps to that model.` : ''),
                        model: decided.model,
                    },
                });
            }
            this.recordRoute(decided.route, ref);
            if (decided.rationale) {
                this.record({
                    type: 'reasoning.recorded', level: 'reasoning', ...ref,
                    data: { source: 'decision_model', rationale: decided.rationale, confidence: decided.confidence, plan: [], option: decided.option },
                });
            }

            modelData = {
                option: decided.option,
                confidence: decided.confidence,
                min_confidence: model.min_confidence,
                votes: decided.votes.map(v => ({ option: v.option, confidence: v.confidence, invalid: v.invalid })),
                ...(decided.reason ? { no_decision_reason: decided.reason } : {}),
                usage: decided.usage,
            };
            if (decided.edge_id) {
                edgeId = decided.edge_id;
                method = 'model';
                outputs = { option: decided.option, confidence: decided.confidence };
                if (model.output) dataOutputs = { [model.output]: decided.option };
            }
        }

        if (!edgeId && decision.default_output_edge_id) {
            edgeId = decision.default_output_edge_id;
            method = 'default';
        }

        const inputs = table
            ? Object.fromEntries(table.inputs.map(column => [column.name, token.contextData[column.name]]))
            : Object.fromEntries((model?.inputs || []).map(name => [name, token.contextData[name]]));

        const decided = method === 'table' || method === 'engine' || method === 'model';
        // The outputs become token data, so a later decision or condition can use them
        const added = Object.fromEntries(Object.entries(dataOutputs ?? (method === 'model' ? {} : outputs))
            .filter(([key]) => !key.startsWith('_') && key !== 'activities' && key !== 'decisions'));
        const record = (token.getData('decisions') || {}) as Record<string, unknown>;
        token.mergeData({
            ...added,
            decisions: { ...record, [decision.id]: { name: decision.name, method, outputs } },
            _decision_node_id: decision.id,
            _decision_matched: decided,
            _decision_method: method,
            _decision_outputs: outputs,
        });

        this.record({
            type: 'decision.evaluated', ...ref,
            data: {
                method,
                strategy,
                ...(table ? { hit_policy: table.hit_policy } : {}),
                inputs: this.journal.payload(inputs),
                matched: decided,
                matched_rules: (result?.matched_rules || []).map(rule => ({
                    index: table!.rules.indexOf(rule),
                    input_entries: rule.input_entries,
                    description: rule.description,
                })),
                outputs,
                edge_id: edgeId,
                used_default: method === 'default',
                ...(engineData ? { engine: engineData } : {}),
                ...(model && (method === 'model' || method === 'default' || method === 'none') ? { model: modelData } : {}),
            },
        });

        const target = edgeId ? this.getEdgeTarget(edgeId) : undefined;
        if (!edgeId || !target) {
            this.failToken(token, new ActivityError(
                `No matching decision rule and no default path${modelData.no_decision_reason ? ` (model: ${modelData.no_decision_reason})` : ''}`, 'NO_ROUTE'));
            return;
        }

        this.moveToken(token, edgeId, target, 'decision');
    }

    /**
     * Get the target node ID for an edge ID
     */
    private getEdgeTarget(edgeId: UUID): UUID | undefined {
        return this.workflow.edges.find(edge => edge.id === edgeId)?.target_id;
    }

    private moveToken(token: Token, edgeId: UUID, targetId: UUID, reason: string, analytics?: Analytics, condition?: string): void {
        const from = token.activityId;
        token.move(targetId, analytics);
        this.record({
            type: 'token.moved', token_id: token.id, ...this.nodeRef(targetId),
            data: { from_node_id: from, to_node_id: targetId, edge_id: edgeId, reason, ...(condition ? { condition } : {}) },
        });
        this.log(`Token ${token.id} moved to ${targetId}`);

        const join = this.activityMap.get(targetId)?.join || this.eventMap.get(targetId)?.join;
        if (join === 'all' && (this.incomingEdges.get(targetId) || []).length > 1) {
            token.setData('_arrived_edge', edgeId);
            token.updateStatus('joining');
            this.tryJoin(targetId);
        }
    }

    /**
     * Synchronising join (spec: "Join"). When a token has arrived over every
     * incoming edge of the node, the tokens are merged into one, which then
     * executes the node once.
     */
    private tryJoin(nodeId: UUID): void {
        const incoming = this.incomingEdges.get(nodeId) || [];
        const parked = this.tokens.filter(t => t.status === 'joining' && t.activityId === nodeId);
        const arrivals = incoming.map(edge => parked.find(t => t.getData('_arrived_edge') === edge.id));
        if (arrivals.some(t => !t)) return;

        const tokens = arrivals as Token[];
        const survivor = tokens[0];
        let merged: Record<string, unknown> = {};
        let archive: Record<string, unknown> = {};
        // Merge in the document order of the incoming edges; later branches win on conflict
        for (const token of tokens) {
            archive = { ...archive, ...((token.contextData.activities as Record<string, unknown>) || {}) };
            merged = { ...merged, ...token.contextData };
        }
        const { _arrived_edge, ...data } = merged;
        survivor.contextData = { ...data, activities: archive };

        for (const token of tokens.slice(1)) {
            token.updateStatus('joined');
        }
        survivor.updateStatus('active');
        this.record({
            type: 'token.joined', token_id: survivor.id, ...this.nodeRef(nodeId),
            data: { merged_token_ids: tokens.slice(1).map(t => t.id), incoming_edge_ids: incoming.map(e => e.id) },
        });
    }

    /**
     * Advance token to next node(s) based on outgoing edges
     */
    private async advanceToken(token: Token, currentNodeId: UUID, analytics?: Analytics): Promise<void> {
        // An event's timeout edge is taken only when its wait times out, never by ordinary routing
        const timeoutEdge = (this.eventMap.get(currentNodeId)?.event_definition as { timeout_edge_id?: UUID } | undefined)?.timeout_edge_id;
        const outgoingEdges = (this.edgeMap.get(currentNodeId) || []).filter(edge => edge.id !== timeoutEdge);

        if (outgoingEdges.length === 0) {
            token.updateStatus('completed', analytics);
            this.record({ type: 'token.completed', token_id: token.id, ...this.nodeRef(currentNodeId), data: {} });
            this.log(`Token ${token.id} completed (no outgoing edges)`);
            return;
        }

        let selected: { edges: Edge[]; reason: string };
        try {
            selected = this.selectNextEdges(outgoingEdges, token.contextData);
        } catch (error: unknown) {
            this.failToken(token, error, analytics);
            return;
        }

        if (selected.edges.length === 0) {
            this.failToken(token,
                new ActivityError('No route: no edge condition matched and no default edge is defined', 'NO_ROUTE'), analytics);
            return;
        }

        // Parallel split: the token follows the first edge, and a new token,
        // carrying a copy of its data, follows each of the others.
        const [first, ...others] = selected.edges;
        const siblings = others.map(edge => {
            const sibling = new Token(currentNodeId, JSON.parse(JSON.stringify(token.contextData)), token.id, this.workflow.id);
            this.tokens.push(sibling);
            this.record({
                type: 'token.created', token_id: sibling.id, ...this.nodeRef(currentNodeId),
                data: { parent_token_id: token.id, reason: 'parallel_split' },
            });
            return { sibling, edge };
        });

        this.moveToken(token, first.id, first.target_id, selected.reason, analytics, first.condition);
        for (const { sibling, edge } of siblings) {
            this.moveToken(sibling, edge.id, edge.target_id, selected.reason);
        }
    }

    /**
     * Select the outgoing edges to follow (spec: "Routing").
     * 1. Conditional edges are evaluated in document order; the first true one is taken, alone.
     * 2. Otherwise the edge marked `is_default` is taken, alone.
     * 3. Otherwise every unconditional edge is taken: one is a sequence, several are a parallel split.
     * 4. Otherwise there is no route and the token fails. An engine never guesses.
     */
    private selectNextEdges(edges: Edge[], context: Record<string, unknown>): { edges: Edge[]; reason: string } {
        for (const edge of edges) {
            if (edge.condition && evaluate_expression(edge.condition, context)) {
                return { edges: [edge], reason: 'condition' };
            }
        }

        const defaultEdge = edges.find(e => e.is_default);
        if (defaultEdge) return { edges: [defaultEdge], reason: 'default' };

        const unconditional = edges.filter(e => !e.condition);
        return { edges: unconditional, reason: unconditional.length > 1 ? 'parallel_split' : 'unconditional' };
    }

    /**
     * Create the appropriate actor for an activity
     */
    private createActor(activity: Activity): Actor | undefined {
        // An activity whose role, or which itself, names an agent over A2A is performed by that agent (28.1)
        const agent = a2a_binding(activity, this.roleMap.get(activity.role_id));
        if (agent) {
            return new A2AActor(agent, this.options.a2a || {}, this.a2aState, {
                simulate: this.simulate, scripted: this.scriptedActor(activity),
                tools_allowed_hosts: this.options.tools?.allowed_hosts, tools_secrets: this.options.tools?.secrets,
            });
        }

        const custom = this.options.actors?.[activity.actor_type];
        if (custom) return custom;

        const scripted = this.scriptedActor(activity);
        if (scripted) return scripted;

        return this.builtInActor(activity);
    }

    /** In simulation, the actor that returns what the deployment scripted for the activity, if it scripted anything */
    private scriptedActor(activity: Activity): Actor | undefined {
        const scripted = this.simulate ? this.options.simulated_outputs?.[activity.name] : undefined;
        if (scripted) {
            return {
                execute: async (_activity, inputs) => {
                    const attempt = Number(inputs._attempt) || 1;
                    const step = scripted.attempts ? scripted.attempts[Math.min(attempt, scripted.attempts.length) - 1] : scripted;
                    if (step.error) throw Object.assign(new Error(step.error), step.code ? { code: step.code } : {});
                    return { ...(step.output || {}), ...(step.contexts ? { _context_writes: step.contexts } : {}), _simulated: true };
                },
            };
        }
        return undefined;
    }

    private builtInActor(activity: Activity): Actor | undefined {
        switch (activity.actor_type) {
            case 'application':
                return new SoftwareAgent();

            case 'ai_agent': {
                if (!this.models.has_providers() && !this.simulate) {
                    throw new Error('Gemini API Key required for AI Agent. Set gemini_api_key in options, or register a model provider.');
                }
                const role = this.roleMap.get(activity.role_id);
                return new AIAgent(this.options.gemini_api_key || '', role, this.defaultAIModelId, this.simulate, this.models);
            }

            case 'robot':
                return new RobotAgent(this.options.robot_config);

            case 'human':
                return new HumanAgent({
                    wait_for_completion: false, // Engine will handle waiting state
                    simulate: this.simulate && !this.options.wait_for_human_tasks
                });

            default:
                this.log(`Unknown actor type: ${activity.actor_type}`);
                return undefined;
        }
    }

    /** Park a token whose agent asks for input (28.6) */
    private parkForAgent(token: Token, activity: Activity, awaiting: Record<string, unknown>, analytics: Analytics, since: Date): void {
        analytics.waste_categories?.push('waiting' as WasteCategory);
        token.updateStatus('waiting', analytics);
        token.setData('_awaiting_agent_input', awaiting);
        token.setData('_waiting_since', since.toISOString());
        this.record({
            type: 'token.waiting', token_id: token.id, ...this.nodeRef(activity.id),
            data: {
                reason: 'agent_input', agent: awaiting.agent, task_id: awaiting.task_id,
                ...(awaiting.context_id ? { context_id: awaiting.context_id } : {}),
                request: this.journal.payload(awaiting.request ?? null),
            },
        });
        this.log(`Token waits for the input agent ${awaiting.agent} asks for`);
    }

    /** The tokens waiting for input an agent asked for, with what it asked (28.6) */
    public getAgentRequests(): { token_id: UUID; node_id: UUID; agent: string; task_id: string; context_id?: string; request: unknown }[] {
        return this.tokens.filter(t => t.status === 'waiting' && t.getData('_awaiting_agent_input')).map(t => {
            const awaiting = t.getData('_awaiting_agent_input') as { agent: string; task_id: string; context_id?: string; request: unknown };
            return { token_id: t.id, node_id: t.activityId, ...awaiting };
        });
    }

    /**
     * Give an agent the input it asked for (28.6). The token's activity is performed again: the input is
     * sent on the agent's task, which is then followed as before. Call run() afterwards.
     * Returns whether the token was waiting for an agent's input.
     */
    public async answerAgent(tokenId: UUID, input: Record<string, unknown> | string): Promise<boolean> {
        const token = this.tokens.find(t => t.id === tokenId);
        const awaiting = token?.status === 'waiting' ? token.getData('_awaiting_agent_input') as { task_id: string; context_id?: string } | undefined : undefined;
        if (!token || !awaiting) return false;
        const since = token.getData('_waiting_since');
        const waitedMs = since ? this.now() - new Date(since as string).getTime() : undefined;
        delete token.contextData._awaiting_agent_input;
        delete token.contextData._waiting_since;
        token.setData('_agent_continuation', { task_id: awaiting.task_id, context_id: awaiting.context_id, input });
        token.updateStatus('active', since ? { wait_time: calculate_duration(new Date(since as string), new Date(this.now())), waste_categories: ['waiting' as WasteCategory] } : undefined);
        this.record({ type: 'token.resumed', token_id: token.id, ...this.nodeRef(token.activityId), data: { reason: 'agent_input', waited_ms: waitedMs } });
        if (this.status === 'waiting_event' || this.status === 'waiting_human') this.status = 'running';
        await this.saveCheckpoint();
        return true;
    }

    public async resumeToken(tokenId: UUID, output: Record<string, unknown>): Promise<boolean> {
        const token = this.tokens.find(t => t.id === tokenId);
        // A token waiting for an agent's input is answered with answerAgent, not resumed with an outcome (28.6)
        if (!token || token.status !== 'waiting' || token.getData('_awaiting_agent_input')) {
            return false;
        }

        const waitingSince = token.getData('_waiting_since');
        let analytics: Analytics | undefined;
        let waitedMs: number | undefined;

        if (waitingSince) {
            const since = new Date(waitingSince as string);
            waitedMs = this.now() - since.getTime();
            analytics = { wait_time: calculate_duration(since, new Date(this.now())), waste_categories: ['waiting' as WasteCategory] };
        }

        const resumed = this.activityMap.get(token.activityId);
        const ref = { token_id: token.id, ...this.nodeRef(token.activityId) };
        token.updateStatus('active', analytics);
        this.record({ type: 'token.resumed', ...ref, data: { waited_ms: waitedMs } });
        output = { ...output };
        const context_writes = output._context_writes;
        delete output._context_writes;
        delete output._contexts;
        token.mergeActivityOutput(token.activityId, output);
        token.mergeData({ _human_task_status: 'completed', _requires_human_action: false });

        // The deterministic terms of an outcome contract bind human decisions too
        const contract = this.activityMap.get(token.activityId)?.outcome_contract;
        if (contract) {
            const violations = check_contract(contract, outcome_of(output));
            this.record({
                type: 'contract.checked', ...ref,
                data: { passed: violations.length === 0, violations, decided_by: 'human', output_hash: hash_payload(outcome_of(output)) },
            });
            if (violations.length > 0) {
                this.failToken(token, new ActivityError(
                    `Outcome contract violated by the human decision: ${violations.map(v => v.message).join('; ')}`,
                    'CONTRACT_VIOLATION', { _contract_violations: violations }));
                await this.settle();
                await this.saveCheckpoint();
                return false;
            }
        }
        // A person's answer may write to contexts under the same bindings as any actor's, once it is accepted (22.3)
        if (resumed) {
            try {
                if (context_writes !== undefined) this.writeContexts(token, resumed, { _context_writes: context_writes });
                this.closeServiceLevel(token, resumed);
            } catch (error) {
                this.failToken(token, error);
                await this.settle();
                await this.saveCheckpoint();
                return false;
            }
        }
        this.record({
            type: 'activity.completed', ...ref,
            data: {
                actor_type: this.activityMap.get(token.activityId)?.actor_type || 'human',
                output: this.journal.payload(public_payload(output)),
                waited_ms: waitedMs,
            },
        });

        if (this.status === 'waiting_human') {
            this.status = 'running';
        }

        // The activity is now complete: if the run fails later, its effects are undone like any other's
        this.completedActivities.push({ activity_id: token.activityId, token_id: token.id, output: public_payload(output) });

        await this.advanceToken(token, token.activityId);
        await this.saveCheckpoint();
        return (token.status as string) !== 'failed';
    }

    public getStatus(): EngineStatus {
        return this.status;
    }

    public getContext(contextId: UUID): unknown {
        return this.contextManager.get(contextId, this.now());
    }

    /** The value of every context that has one, by context name */
    public getContexts(): Record<string, unknown> {
        const now = this.now();
        return Object.fromEntries(this.contextManager.list().map(c => [c.name, this.contextManager.get(c.id, now)] as const).filter(([, value]) => value !== undefined));
    }

    public getTokens(): Token[] {
        return this.tokens;
    }

    public getWorkflow(): Workflow {
        return this.workflow;
    }

    private trackCost(activity: Activity, output: Record<string, unknown>, durationMs?: number) {
        if (!this.options.pricing_config) return;

        let cost = 0;

        // 1. AI Costs (Token based)
        const usage = output.usage as any;
        if (activity.actor_type === 'ai_agent' && usage) {
            this.executionStats.inputTokens += usage.input_tokens || 0;
            this.executionStats.outputTokens += usage.output_tokens || 0;

            const inputCost = ((usage.input_tokens || 0) / 1000) * (this.options.pricing_config.input_token_cost_per_1k || 0);
            const outputCost = ((usage.output_tokens || 0) / 1000) * (this.options.pricing_config.output_token_cost_per_1k || 0);
            cost += inputCost + outputCost;
        }

        // 2. Human Costs (Time based)
        if (activity.actor_type === 'human' && this.options.pricing_config.human_cost_per_hour && durationMs) {
            const hours = durationMs / (1000 * 60 * 60);
            cost += hours * this.options.pricing_config.human_cost_per_hour;
        }

        // 3. Robot Costs (Time based)
        if (activity.actor_type === 'robot' && this.options.pricing_config.robot_cost_per_hour && durationMs) {
            const hours = durationMs / (1000 * 60 * 60);
            cost += hours * this.options.pricing_config.robot_cost_per_hour;
        }

        // 4. Software/App Costs (Per execution)
        if (activity.actor_type === 'application' && this.options.pricing_config.software_cost_per_execution) {
            cost += this.options.pricing_config.software_cost_per_execution;
        }

        this.executionStats.cost += cost;
    }

    private async finalizeExecution() {
        if (this.status === 'completed' || this.status === 'failed') {
            const endTime = new Date(this.now());
            const durationMs = endTime.getTime() - this.executionStats.startTime.getTime();

            const metrics: ExecutionMetrics = {
                workflow_id: this.workflow.id,
                workflow_name: this.workflow.name,
                status: this.status,
                started_at: this.executionStats.startTime,
                completed_at: endTime,
                duration_ms: durationMs,
                input_tokens: this.executionStats.inputTokens,
                output_tokens: this.executionStats.outputTokens,
                total_tokens: this.executionStats.inputTokens + this.executionStats.outputTokens,
                execution_cost: this.executionStats.cost,
                currency: this.options.pricing_config?.currency || 'USD',
                steps_count: this.executionStats.stepsCount,
                user_id: this.options.user_id
            };

            await this.executionLogger.log_execution(metrics);
        }
    }
}
