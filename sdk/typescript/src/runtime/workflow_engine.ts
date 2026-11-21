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
import { calculate_duration } from './duration_utils';
import { WasteCategory, Analytics, VerificationRecord } from '../types';
import { VerificationEngine } from './verification_engine';
import { evaluate_expression } from './expression';

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
        this.tokens = [];
        this.contextManager = new ContextManager();
        this.status = 'idle';
        this.activityMap = new Map();
        this.edgeMap = new Map();
        this.decisionNodeMap = new Map();
        this.roleMap = new Map();
        this.decisionEvaluator = new DecisionEvaluator(workflowDef.decision_nodes);
        this.executionLogger = options.execution_logger || get_execution_logger();
        this.verificationEngine = new VerificationEngine({
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
    }

    /**
     * Derive the run status from token states (spec: "Run outcome").
     * A run is `completed` only if every token completed. Any failed token
     * makes the run `failed` once no token is still active or waiting.
     */
    private async settle(): Promise<void> {
        if (this.tokens.some(t => t.status === 'active')) return;

        if (this.tokens.some(t => t.status === 'waiting')) {
            this.status = 'waiting_human';
            return;
        }

        const previous = this.status;
        this.status = this.tokens.some(t => t.status === 'failed') ? 'failed' : 'completed';
        if (previous !== this.status) {
            await this.finalizeExecution();
        }
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

        // Check if this is a decision node
        const decisionNode = this.decisionNodeMap.get(currentNodeId);
        if (decisionNode) {
            await this.processDecisionNode(token, decisionNode);
            return;
        }

        // Process as activity
        const activity = this.activityMap.get(currentNodeId);
        if (!activity) {
            this.log(`Activity not found: ${currentNodeId}`);
            token.updateStatus('failed');
            return;
        }

        const startTime = new Date();

        try {
            // Create appropriate actor
            const actor = this.createActor(activity);

            if (actor) {
                // Add token metadata to inputs
                const inputs = {
                    ...token.contextData,
                    _token_id: token.id,
                    _workflow_id: this.workflow.id,
                    _activity_id: activity.id,
                    _activity_name: activity.name
                };

                this.log(`Executing activity "${activity.name}" with ${activity.actor_type} actor`);

                // Execute with verification loop
                const { output, verificationRecords } = await this.executeWithVerification(
                    actor, activity, inputs
                );

                const endTime = new Date();
                const processTime = calculate_duration(startTime, endTime);
                const analytics: Analytics = {
                    process_time: processTime,
                    cycle_time: processTime,
                    lead_time: processTime,
                    value_added: activity.analytics?.value_added ?? true,
                    waste_categories: []
                };

                // Fail closed: anything other than an explicit pass fails the activity
                if (verificationRecords.length > 0) {
                    const lastRecord = verificationRecords[verificationRecords.length - 1];
                    if (lastRecord.verdict !== 'pass') {
                        this.log(`Activity "${activity.name}" failed verification after ${verificationRecords.length} attempt(s)`);
                        analytics.waste_categories?.push('defects' as WasteCategory);
                        analytics.error_rate = 1;
                        token.updateStatus('failed', analytics);
                        token.mergeActivityOutput(activity.id, {
                            ...output,
                            _error: `Verification failed: ${lastRecord.feedback}`,
                            _verification_records: verificationRecords,
                        });
                        return;
                    }
                }

                // Check if human task requires waiting
                if (output._requires_human_action && this.options.wait_for_human_tasks) {
                    analytics.waste_categories?.push('waiting' as WasteCategory);
                    token.updateStatus('waiting', analytics);
                    token.mergeActivityOutput(activity.id, {
                        ...output,
                        _waiting_since: endTime.toISOString()
                    });
                    this.log(`Token paused waiting for human task ${output._human_task_id}`);
                    return;
                }

                token.mergeActivityOutput(activity.id, {
                    ...output,
                    _last_actor_id: activity.id,
                    _last_actor_type: activity.actor_type,
                    ...(verificationRecords.length > 0 ? { _verification_records: verificationRecords } : {})
                });

                // Track usage and cost
                const durationMs = endTime.getTime() - startTime.getTime();
                this.trackCost(activity, output, durationMs);

                this.executionStats.stepsCount++;

                // Determine next node(s)
                await this.advanceToken(token, currentNodeId, analytics);

            } else {
                // No actor - just advance
                await this.advanceToken(token, currentNodeId);
            }

        } catch (error: unknown) {
            const endTime = new Date();
            const errorMessage = error instanceof Error ? error.message : String(error);
            const errorStack = error instanceof Error ? error.stack : undefined;
            console.error(`Error processing activity ${activity.name}:`, error);

            const analytics: Analytics = {
                process_time: calculate_duration(startTime, endTime),
                waste_categories: ['defects' as WasteCategory],
                error_rate: 1
            };

            token.updateStatus('failed', analytics);
            token.mergeData({ _error: errorMessage, _stack: errorStack });
        }
    }

    /**
     * Process a decision node
     */
    private async processDecisionNode(token: Token, decision: DecisionNode): Promise<void> {
        this.log(`Evaluating decision node "${decision.name}"`);

        const result = evaluate_decision(decision, token.contextData);

        this.log(`Decision result: matched=${result.matched}, outputs=${JSON.stringify(result.outputs)}`);

        // Merge decision outputs into token
        token.mergeData({
            _decision_node_id: decision.id,
            _decision_matched: result.matched,
            _decision_outputs: result.outputs
        });

        if (result.output_edge_id) {
            // Follow the specific edge from decision
            token.move(this.getEdgeTarget(result.output_edge_id) || result.output_edge_id);
        } else {
            // No matching edge - use default or fail
            if (decision.default_output_edge_id) {
                token.move(this.getEdgeTarget(decision.default_output_edge_id) || decision.default_output_edge_id);
            } else {
                this.log(`No matching rule and no default edge for decision "${decision.name}"`);
                token.updateStatus('failed');
                token.mergeData({ _error: 'No matching decision rule and no default path' });
            }
        }
    }

    /**
     * Get the target node ID for an edge ID
     */
    private getEdgeTarget(edgeId: UUID): UUID | undefined {
        for (const edge of this.workflow.edges) {
            if (edge.id === edgeId) {
                return edge.target_id;
            }
        }
        return undefined;
    }

    /**
     * Advance token to next node(s) based on outgoing edges
     */
    private async advanceToken(token: Token, currentNodeId: UUID, analytics?: Analytics): Promise<void> {
        const outgoingEdges = this.edgeMap.get(currentNodeId) || [];

        if (outgoingEdges.length === 0) {
            token.updateStatus('completed', analytics);
            this.log(`Token ${token.id} completed (no outgoing edges)`);
            return;
        }

        let nextEdge: Edge | undefined;
        try {
            nextEdge = this.selectNextEdge(outgoingEdges, token.contextData);
        } catch (error: unknown) {
            token.updateStatus('failed', analytics);
            token.mergeData({ _error: error instanceof Error ? error.message : String(error) });
            return;
        }

        if (nextEdge) {
            token.move(nextEdge.target_id, analytics);
            this.log(`Token ${token.id} moved to ${nextEdge.target_id}`);
        } else {
            // No valid edge found
            token.updateStatus('failed', analytics);
            token.mergeData({ _error: 'No route: no edge condition matched and no default edge is defined' });
        }
    }

    /**
     * Select the next edge (spec: "Routing").
     * 1. Conditional edges are evaluated in document order; the first true one wins.
     * 2. Otherwise the edge marked `is_default` is taken.
     * 3. Otherwise the first unconditional edge is taken.
     * 4. Otherwise there is no route and the token fails. An engine never guesses.
     */
    private selectNextEdge(edges: Edge[], context: Record<string, unknown>): Edge | undefined {
        for (const edge of edges) {
            if (edge.condition && evaluate_expression(edge.condition, context)) {
                return edge;
            }
        }

        const defaultEdge = edges.find(e => e.is_default);
        if (defaultEdge) {
            return defaultEdge;
        }

        return edges.find(e => !e.condition);
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
                if (!this.options.gemini_api_key && !this.simulate) {
                    throw new Error('Gemini API Key required for AI Agent. Set gemini_api_key in options.');
                }
                const role = this.roleMap.get(activity.role_id);
                return new AIAgent(this.options.gemini_api_key || '', role, this.defaultAIModelId, this.simulate);

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

    /**
     * Execute an activity with optional verification-and-retry loop.
     * If the activity has a verification policy, the output is verified
     * after each execution. On failure, AI agents are retried with
     * corrective feedback. Non-AI actors are verified but not retried.
     */
    private async executeWithVerification(
        actor: Actor,
        activity: Activity,
        inputs: Record<string, unknown>
    ): Promise<{ output: Record<string, unknown>; verificationRecords: VerificationRecord[] }> {
        const policy = activity.verification;
        const globalEnabled = this.options.verification_enabled !== false;
        const hasVerification = policy && policy.enabled && globalEnabled;

        if (!hasVerification) {
            // No verification — execute once and return
            const output = await actor.execute(activity, inputs);
            return { output, verificationRecords: [] };
        }

        const maxAttempts = policy.max_retries + 1; // +1 for the initial attempt
        const verificationRecords: VerificationRecord[] = [];
        let currentInputs = { ...inputs };
        let lastOutput: Record<string, unknown> = {};

        for (let attempt = 1; attempt <= maxAttempts; attempt++) {
            this.log(`Verification attempt ${attempt}/${maxAttempts} for "${activity.name}"`);

            // Execute the activity
            lastOutput = await actor.execute(activity, currentInputs);

            // Verify the output
            try {
                const record = await this.verificationEngine.verify(
                    activity, currentInputs, lastOutput, attempt
                );
                verificationRecords.push(record);

                // Track verification token usage
                if (record.judge_tokens) {
                    this.executionStats.verificationTokens +=
                        record.judge_tokens.input + record.judge_tokens.output;
                    this.executionStats.inputTokens += record.judge_tokens.input;
                    this.executionStats.outputTokens += record.judge_tokens.output;
                }

                if (record.verdict === 'pass') {
                    this.log(`Activity "${activity.name}" passed verification (attempt ${attempt}, score: ${(record.overall_score * 100).toFixed(0)}%)`);
                    return { output: lastOutput, verificationRecords };
                }

                // Verification failed — decide whether to retry
                this.log(`Activity "${activity.name}" failed verification (attempt ${attempt}, score: ${(record.overall_score * 100).toFixed(0)}%)`);

                // Only AI agents support automatic retry with feedback
                if (activity.actor_type !== 'ai_agent' || !policy.retry_with_feedback) {
                    this.log(`No retry for actor_type="${activity.actor_type}" — recording failure`);
                    return { output: lastOutput, verificationRecords };
                }

                // Inject corrective feedback for the next attempt
                if (attempt < maxAttempts) {
                    const feedback = this.verificationEngine.generate_corrective_feedback(record);
                    currentInputs = {
                        ...inputs,
                        _verification_feedback: feedback,
                        _verification_attempt: attempt + 1,
                    };
                    this.log(`Injecting corrective feedback for retry attempt ${attempt + 1}`);
                }

            } catch (verificationError: unknown) {
                const message = verificationError instanceof Error
                    ? verificationError.message : String(verificationError);
                this.log(`Verification error: ${message}`);

                // Fail closed: an output that could not be verified is not accepted
                verificationRecords.push({
                    id: randomUUID(),
                    activity_id: activity.id,
                    attempt,
                    verdict: 'error',
                    criteria_results: [],
                    overall_score: 0,
                    feedback: `Verification engine error: ${message}`,
                    verified_at: new Date().toISOString(),
                    duration_ms: 0,
                    output_hash: this.verificationEngine.compute_output_hash(lastOutput),
                });
                return { output: lastOutput, verificationRecords };
            }
        }

        // All retries exhausted — return with the last failed records
        return { output: lastOutput, verificationRecords };
    }

    public async resumeToken(tokenId: UUID, output: Record<string, unknown>): Promise<boolean> {
        const token = this.tokens.find(t => t.id === tokenId);
        if (!token || token.status !== 'waiting') {
            return false;
        }

        const waitingSince = token.getData('_waiting_since');
        let analytics: Analytics | undefined;

        if (waitingSince) {
            const waitTime = calculate_duration(new Date(waitingSince as string), new Date());
            analytics = {
                wait_time: waitTime,
                waste_categories: ['waiting' as WasteCategory]
            };
        }

        token.mergeActivityOutput(token.activityId, output);
        token.mergeData({ _human_task_status: 'completed', _requires_human_action: false });
        token.updateStatus('active', analytics);

        if (this.status === 'waiting_human') {
            this.status = 'running';
        }

        // Advance the token to the next node in the graph
        try {
            await this.advanceToken(token, token.activityId);
            return true;
        } catch (err) {
            this.log(`Failed to advance token on resume: ${err instanceof Error ? err.message : String(err)}`);
            token.updateStatus('failed');
            return false;
        }
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
