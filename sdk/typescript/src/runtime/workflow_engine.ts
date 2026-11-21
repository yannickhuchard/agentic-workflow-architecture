/**
 * AWA Workflow Engine
 * Executes AWA workflow definitions with full actor and decision support
 */

import { randomUUID } from 'crypto';
import { UUID, Workflow, Activity, Edge, Role, DecisionNode } from '../types';
import { Token } from './token';
import { ContextManager } from './context_manager';
import { ExecutionLogger, ExecutionMetrics, get_execution_logger } from './execution_logger';
import { validate_workflow_integrity } from '../validator';
import { Actor } from './actors/actor';
import { SoftwareAgent } from './actors/software_agent';
import { AIAgent } from './actors/ai_agent';
import { RobotAgent, RobotConfig } from './actors/robot_agent';
import { HumanAgent } from './actors/human_agent';
import { DecisionEvaluator, evaluate_decision } from './decision_evaluator';
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
import { ModelProvider, ModelRegistry, GoogleModelProvider } from './models';

export type EngineStatus = 'running' | 'paused' | 'completed' | 'failed' | 'idle' | 'waiting_human';

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
    /** Capability tiers mapped to model references, e.g. { fast: 'google:gemini-3.1-flash-lite' } */
    model_tiers?: Record<string, string>;
    /** Replaces the delay between retries. Tests use this to avoid real waiting. */
    sleep?: (ms: number) => Promise<void>;
}

/** Error codes that are never retried, whatever the retry policy says */
const NEVER_RETRIED = new Set(['VERIFICATION_FAILED', 'CONTRACT_VIOLATION', 'NO_ROUTE']);

class ActivityError extends Error {
    constructor(message: string, public readonly code: string, public readonly details?: Record<string, unknown>) {
        super(message);
        this.name = 'ActivityError';
    }
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
    private options: WorkflowEngineOptions;
    private roleMap: Map<UUID, Role>;
    private decisionEvaluator: DecisionEvaluator;
    private executionLogger: ExecutionLogger;
    private verificationEngine: VerificationEngine;
    private defaultAIModelId: string;
    private simulate: boolean;
    private runId: UUID;
    private journal: JournalWriter;
    private journalStore: JournalStore;
    private deadLetterQueue: DeadLetterQueue;
    private sleep: (ms: number) => Promise<void>;
    private models: ModelRegistry;
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
        this.defaultAIModelId = options.default_ai_model_id || 'gemini-3-flash-preview';
        this.simulate = options.simulate || false;
        this.runId = options.run_id || randomUUID();
        this.journalStore = options.journal || new InMemoryJournalStore();
        this.journal = new JournalWriter(this.runId, workflowDef.id, this.journalStore, options.journal_payloads || 'full');
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

        this.verificationEngine = new VerificationEngine({
            models: this.models,
            gemini_api_key: this.options.gemini_api_key,
            default_model_id: this.options.verification_model_id || this.defaultAIModelId,
            verbose: this.options.verbose,
            simulate: this.simulate,
        });

        this.executionStats = {
            startTime: new Date(),
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
        }

        for (const decisionNode of this.workflow.decision_nodes) {
            this.decisionNodeMap.set(decisionNode.id, decisionNode);
        }

        // Load roles from options and workflow
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

        // Strategy: Find node with no incoming edges from Activities
        let startNodeId: UUID | undefined;

        const targetIds = new Set(this.workflow.edges.map(e => e.target_id));
        const startActivities = this.workflow.activities.filter(a => !targetIds.has(a.id));

        if (startActivities.length > 0) {
            startNodeId = startActivities[0].id;
        } else {
            // Cycle or just pick first
            startNodeId = this.workflow.activities[0].id;
        }

        // Add workflow metadata to initial data
        const tokenData = {
            ...initialData,
            _workflow_id: this.workflow.id,
            _workflow_name: this.workflow.name,
            _started_at: new Date().toISOString()
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

        this.executionStats.startTime = new Date(); // Reset start time on actual start
        return token.id;
    }

    public async runStep(): Promise<void> {
        if (this.status !== 'running' && this.status !== 'waiting_human') return;

        const activeTokens = this.tokens.filter(t => t.status === 'active');

        if (activeTokens.length === 0) {
            await this.settle();
            return;
        }

        for (const token of activeTokens) {
            await this.processToken(token);
        }

        await this.settle();
        await this.saveCheckpoint();
    }

    /**
     * Derive the run status from token states (spec: "Run outcome").
     * A run is `completed` only if every token completed. Any failed token
     * makes the run `failed` once no token is still active or waiting.
     */
    private async settle(): Promise<void> {
        if (this.tokens.some(t => t.status === 'active')) return;

        const previous = this.status;

        if (this.tokens.some(t => t.status === 'waiting')) {
            this.status = 'waiting_human';
            if (previous !== this.status) {
                this.record({ type: 'run.waiting', data: { waiting_tokens: this.tokens.filter(t => t.status === 'waiting').map(t => t.id) } });
            }
            return;
        }

        this.status = this.tokens.some(t => t.status === 'failed') ? 'failed' : 'completed';
        if (previous !== this.status) {
            const durationMs = Date.now() - this.executionStats.startTime.getTime();
            this.record({
                type: this.status === 'completed' ? 'run.completed' : 'run.failed',
                data: {
                    duration_ms: durationMs,
                    steps: this.executionStats.stepsCount,
                    input_tokens: this.executionStats.inputTokens,
                    output_tokens: this.executionStats.outputTokens,
                    cost: this.executionStats.cost,
                    currency: this.options.pricing_config?.currency || 'USD',
                    ...(this.status === 'failed'
                        ? { errors: this.tokens.filter(t => t.status === 'failed').map(t => ({ token_id: t.id, node_id: t.activityId, message: t.getData('_error') })) }
                        : {}),
                },
            });
            await this.finalizeExecution();
            await this.journal.flush();
        }
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
            || this.workflow.events.find(e => e.id === nodeId)?.name;
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
            checkpoint_at: new Date().toISOString(),
            metadata: {
                run_id: this.runId,
                journal_seq: this.journal.last_seq,
                stats: { ...this.executionStats, startTime: this.executionStats.startTime.toISOString() },
            },
        };
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
    public static restore(workflowDef: Workflow, state: WorkflowState, options: WorkflowEngineOptions = {}): WorkflowEngine {
        if (state.workflow_id !== workflowDef.id) {
            throw new Error(`Checkpoint belongs to workflow ${state.workflow_id}, not ${workflowDef.id}`);
        }
        const meta = (state.metadata || {}) as { run_id?: UUID; journal_seq?: number; stats?: Record<string, unknown> };
        const engine = new WorkflowEngine(workflowDef, { ...options, run_id: meta.run_id || options.run_id });
        engine.journal = new JournalWriter(
            engine.runId, workflowDef.id, engine.journalStore, options.journal_payloads || 'full', meta.journal_seq || 0);
        engine.tokens = state.tokens.map(t => deserialize_token(t, state.workflow_id));
        engine.contextManager.restore(state.contexts);
        if (meta.stats) {
            engine.executionStats = { ...engine.executionStats, ...meta.stats, startTime: new Date(String(meta.stats.startTime)) };
        }
        engine.status = engine.tokens.some(t => t.status === 'active') ? 'running'
            : engine.tokens.some(t => t.status === 'waiting') ? 'waiting_human'
                : (state.engine_status as EngineStatus);
        engine.record({
            type: 'run.resumed',
            data: { from_checkpoint_at: state.checkpoint_at, from_seq: meta.journal_seq || 0, active_tokens: engine.tokens.filter(t => t.status === 'active').length },
        });
        return engine;
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

        const activity = this.activityMap.get(currentNodeId);
        if (!activity) {
            this.failToken(token, new ActivityError(`Node not found: ${currentNodeId}`, 'NOT_FOUND'));
            return;
        }

        const startTime = new Date();

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

            this.log(`Executing activity "${activity.name}" with ${activity.actor_type} actor`);

            const { output, verificationRecords, attempts } = await this.executeActivity(token, actor, activity, inputs);

            const endTime = new Date();
            const processTime = calculate_duration(startTime, endTime);
            const analytics: Analytics = {
                process_time: processTime,
                cycle_time: processTime,
                lead_time: processTime,
                value_added: activity.analytics?.value_added ?? true,
                waste_categories: attempts > 1 ? ['defects' as WasteCategory] : [],
            };

            // A human task that has not been completed yet parks the token
            if (output._requires_human_action && this.options.wait_for_human_tasks) {
                analytics.waste_categories?.push('waiting' as WasteCategory);
                token.updateStatus('waiting', analytics);
                token.mergeActivityOutput(activity.id, { ...output, _waiting_since: endTime.toISOString() });
                this.record({
                    type: 'token.waiting', token_id: token.id, ...this.nodeRef(activity.id),
                    data: { reason: 'human_task', human_task_id: output._human_task_id },
                });
                this.log(`Token paused waiting for human task ${output._human_task_id}`);
                return;
            }

            token.mergeActivityOutput(activity.id, {
                ...output,
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

            await this.advanceToken(token, currentNodeId, analytics);
        } catch (error: unknown) {
            const analytics: Analytics = {
                process_time: calculate_duration(startTime, new Date()),
                waste_categories: ['defects' as WasteCategory],
                error_rate: 1,
            };
            this.failToken(token, error, analytics);
        }
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
            const attemptStart = Date.now();
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
                const raw = await this.withTimeout(
                    actor.execute(activity, { ...currentInputs, _attempt: attempt }), timeoutMs, activity.name);
                output = this.extractTraces(raw, ref, attempt);
            } catch (error: unknown) {
                errors++;
                const info = error_info(error);
                const retryable = errors <= retry.max_retries
                    && attempt < hardCap
                    && !NEVER_RETRIED.has(info.code || '')
                    && !(info.code && retry.non_retryable_errors?.includes(info.code));
                this.record({
                    type: 'activity.failed', ...ref, attempt,
                    data: { error: { message: info.message, code: info.code }, retryable, duration_ms: Date.now() - attemptStart },
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
                continue;
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
                        data: { error: { message, code: 'CONTRACT_VIOLATION' }, retryable: canRetry, duration_ms: Date.now() - attemptStart },
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
                    verified_at: new Date().toISOString(),
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
                data: { error: { message, code: 'VERIFICATION_FAILED' }, retryable: canRetry, duration_ms: Date.now() - attemptStart },
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
            const model = _model as { id?: string; provider?: string; source?: string; temperature?: number; tier?: string };
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
        }

        if (_reasoning && typeof _reasoning === 'object') {
            this.record({ type: 'reasoning.recorded', level: 'reasoning', ...ref, attempt, data: { source: 'actor', ...(_reasoning as object) } });
        }

        return output;
    }

    /**
     * Process a decision node
     */
    private async processDecisionNode(token: Token, decision: DecisionNode): Promise<void> {
        this.log(`Evaluating decision node "${decision.name}"`);

        const result = evaluate_decision(decision, token.contextData);
        const edgeId = result.output_edge_id || decision.default_output_edge_id;
        const inputs = Object.fromEntries(
            decision.decision_table.inputs.map(column => [column.name, token.contextData[column.name]]));

        token.mergeData({
            _decision_node_id: decision.id,
            _decision_matched: result.matched,
            _decision_outputs: result.outputs,
        });

        this.record({
            type: 'decision.evaluated', token_id: token.id, ...this.nodeRef(decision.id),
            data: {
                hit_policy: decision.decision_table.hit_policy,
                inputs: this.journal.payload(inputs),
                matched: result.matched,
                matched_rules: result.matched_rules.map(rule => ({
                    index: decision.decision_table.rules.indexOf(rule),
                    input_entries: rule.input_entries,
                    description: rule.description,
                })),
                outputs: result.outputs,
                edge_id: edgeId,
                used_default: !result.matched || !result.output_edge_id,
            },
        });

        const target = edgeId ? this.getEdgeTarget(edgeId) : undefined;
        if (!edgeId || !target) {
            this.failToken(token, new ActivityError('No matching decision rule and no default path', 'NO_ROUTE'));
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
    }

    /**
     * Advance token to next node(s) based on outgoing edges
     */
    private async advanceToken(token: Token, currentNodeId: UUID, analytics?: Analytics): Promise<void> {
        const outgoingEdges = this.edgeMap.get(currentNodeId) || [];

        if (outgoingEdges.length === 0) {
            token.updateStatus('completed', analytics);
            this.record({ type: 'token.completed', token_id: token.id, ...this.nodeRef(currentNodeId), data: {} });
            this.log(`Token ${token.id} completed (no outgoing edges)`);
            return;
        }

        let selected: { edge: Edge; reason: string } | undefined;
        try {
            selected = this.selectNextEdge(outgoingEdges, token.contextData);
        } catch (error: unknown) {
            this.failToken(token, error, analytics);
            return;
        }

        if (!selected) {
            this.failToken(token,
                new ActivityError('No route: no edge condition matched and no default edge is defined', 'NO_ROUTE'), analytics);
            return;
        }

        this.moveToken(token, selected.edge.id, selected.edge.target_id, selected.reason, analytics, selected.edge.condition);
    }

    /**
     * Select the next edge (spec: "Routing").
     * 1. Conditional edges are evaluated in document order; the first true one wins.
     * 2. Otherwise the edge marked `is_default` is taken.
     * 3. Otherwise the first unconditional edge is taken.
     * 4. Otherwise there is no route and the token fails. An engine never guesses.
     */
    private selectNextEdge(edges: Edge[], context: Record<string, unknown>): { edge: Edge; reason: string } | undefined {
        for (const edge of edges) {
            if (edge.condition && evaluate_expression(edge.condition, context)) {
                return { edge, reason: 'condition' };
            }
        }

        const defaultEdge = edges.find(e => e.is_default);
        if (defaultEdge) return { edge: defaultEdge, reason: 'default' };

        const unconditional = edges.find(e => !e.condition);
        return unconditional ? { edge: unconditional, reason: 'unconditional' } : undefined;
    }

    /**
     * Create the appropriate actor for an activity
     */
    private createActor(activity: Activity): Actor | undefined {
        const custom = this.options.actors?.[activity.actor_type];
        if (custom) return custom;

        switch (activity.actor_type) {
            case 'application':
                return new SoftwareAgent();

            case 'ai_agent':
                if (!this.models.has_providers() && !this.simulate) {
                    throw new Error('Gemini API Key required for AI Agent. Set gemini_api_key in options, or register a model provider.');
                }
                const role = this.roleMap.get(activity.role_id);
                return new AIAgent(this.options.gemini_api_key || '', role, this.defaultAIModelId, this.simulate, this.models);

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

    public async resumeToken(tokenId: UUID, output: Record<string, unknown>): Promise<boolean> {
        const token = this.tokens.find(t => t.id === tokenId);
        if (!token || token.status !== 'waiting') {
            return false;
        }

        const waitingSince = token.getData('_waiting_since');
        let analytics: Analytics | undefined;
        let waitedMs: number | undefined;

        if (waitingSince) {
            const since = new Date(waitingSince as string);
            waitedMs = Date.now() - since.getTime();
            analytics = { wait_time: calculate_duration(since, new Date()), waste_categories: ['waiting' as WasteCategory] };
        }

        token.mergeActivityOutput(token.activityId, output);
        token.mergeData({ _human_task_status: 'completed', _requires_human_action: false });
        token.updateStatus('active', analytics);

        const ref = { token_id: token.id, ...this.nodeRef(token.activityId) };
        this.record({ type: 'token.resumed', ...ref, data: { waited_ms: waitedMs } });

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

        await this.advanceToken(token, token.activityId);
        await this.saveCheckpoint();
        return (token.status as string) !== 'failed';
    }

    public getStatus(): EngineStatus {
        return this.status;
    }

    public getContext(contextId: UUID): unknown {
        return this.contextManager.get(contextId);
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
            const endTime = new Date();
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
