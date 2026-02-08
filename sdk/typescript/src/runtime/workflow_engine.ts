/**
 * AWA Workflow Engine
 * Executes AWA workflow definitions with full actor and decision support
 */

import { UUID, Workflow, Activity, Edge, Role, DecisionNode } from '../types';
import { Token } from './token';
import { ContextManager } from './context_manager';
import { validate_workflow_integrity } from '../validator';
import { Actor } from './actors/actor';
import { SoftwareAgent } from './actors/software_agent';
import { AIAgent } from './actors/ai_agent';
import { RobotAgent, RobotConfig } from './actors/robot_agent';
import { HumanAgent } from './actors/human_agent';
import { DecisionEvaluator, evaluate_decision } from './decision_evaluator';
import { calculate_duration } from './duration_utils';
import { WasteCategory, Analytics } from '../types';

export type EngineStatus = 'running' | 'paused' | 'completed' | 'failed' | 'idle' | 'waiting_human';

export interface WorkflowEngineOptions {
    /** Gemini API key for AI agents */
    gemini_api_key?: string;
    /** @deprecated Use gemini_api_key instead */
    geminiApiKey?: string;
    /** Role definitions */
    roles?: Role[];
    /** Robot configuration */
    robot_config?: RobotConfig;
    /** Wait for human tasks to complete before proceeding */
    wait_for_human_tasks?: boolean;
    /** Enable verbose logging */
    verbose?: boolean;
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
        this.tokens = [];
        this.contextManager = new ContextManager();
        this.status = 'idle';
        this.activityMap = new Map();
        this.edgeMap = new Map();
        this.decisionNodeMap = new Map();
        this.roleMap = new Map();
        this.decisionEvaluator = new DecisionEvaluator(workflowDef.decision_nodes);

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

        return token.id;
    }

    public async runStep(): Promise<void> {
        if (this.status !== 'running' && this.status !== 'waiting_human') return;

        const activeTokens = this.tokens.filter(t => t.status === 'active');

        if (activeTokens.length === 0) {
            // Check if any tokens are waiting for human input
            const waitingTokens = this.tokens.filter(t => t.status === 'waiting');
            if (waitingTokens.length > 0) {
                this.status = 'waiting_human';
                return;
            }
            this.status = 'completed';
            return;
        }

        for (const token of activeTokens) {
            await this.processToken(token);
        }

        // Re-check status
        const allDone = this.tokens.every(t =>
            t.status === 'completed' || t.status === 'failed' || t.status === 'cancelled'
        );
        if (allDone) {
            this.status = 'completed';
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

                const output = await actor.execute(activity, inputs);

                const endTime = new Date();
                const processTime = calculate_duration(startTime, endTime);
                const analytics: Analytics = {
                    process_time: processTime,
                    cycle_time: processTime,
                    lead_time: processTime,
                    value_added: activity.analytics?.value_added ?? true,
                    waste_categories: []
                };

                // Check if human task requires waiting
                if (output._requires_human_action && this.options.wait_for_human_tasks) {
                    analytics.waste_categories?.push('waiting' as WasteCategory);
                    token.updateStatus('waiting', analytics);
                    token.mergeData({
                        ...output,
                        _waiting_since: endTime.toISOString()
                    });
                    this.log(`Token paused waiting for human task ${output._human_task_id}`);
                    return;
                }

                // Merge output back to token data
                token.mergeData(output);

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

        // Evaluate edge conditions to find the next edge
        const nextEdge = this.selectNextEdge(outgoingEdges, token.contextData);

        if (nextEdge) {
            token.move(nextEdge.target_id, analytics);
            this.log(`Token ${token.id} moved to ${nextEdge.target_id}`);
        } else {
            // No valid edge found
            token.updateStatus('failed', analytics);
            token.mergeData({ _error: 'No valid outgoing edge found' });
        }
    }

    /**
     * Select the next edge based on conditions
     */
    private selectNextEdge(edges: Edge[], context: Record<string, unknown>): Edge | undefined {
        // First, check for conditional edges
        for (const edge of edges) {
            if (edge.condition) {
                if (this.evaluateEdgeCondition(edge.condition, context)) {
                    return edge;
                }
            }
        }

        // Then, check for default edge
        const defaultEdge = edges.find(e => e.is_default);
        if (defaultEdge) {
            return defaultEdge;
        }

        // Finally, take first edge if no conditions match
        return edges[0];
    }

    /**
     * Evaluate a simple edge condition
     * Supports: property == value, property != value, property (truthy check)
     */
    private evaluateEdgeCondition(condition: string, context: Record<string, unknown>): boolean {
        try {
            // Handle equality check: property == value
            const eqMatch = condition.match(/^(\w+)\s*==\s*(.+)$/);
            if (eqMatch) {
                const [, prop, val] = eqMatch;
                const contextVal = context[prop];
                const compareVal = val.trim().replace(/^["']|["']$/g, '');
                return String(contextVal) === compareVal || contextVal === JSON.parse(val);
            }

            // Handle inequality check: property != value
            const neqMatch = condition.match(/^(\w+)\s*!=\s*(.+)$/);
            if (neqMatch) {
                const [, prop, val] = neqMatch;
                const contextVal = context[prop];
                const compareVal = val.trim().replace(/^["']|["']$/g, '');
                return String(contextVal) !== compareVal && contextVal !== JSON.parse(val);
            }

            // Handle greater than: property > value
            const gtMatch = condition.match(/^(\w+)\s*>\s*(\d+(?:\.\d+)?)$/);
            if (gtMatch) {
                const [, prop, val] = gtMatch;
                return Number(context[prop]) > Number(val);
            }

            // Handle less than: property < value
            const ltMatch = condition.match(/^(\w+)\s*<\s*(\d+(?:\.\d+)?)$/);
            if (ltMatch) {
                const [, prop, val] = ltMatch;
                return Number(context[prop]) < Number(val);
            }

            // Handle truthy check: just property name
            if (/^\w+$/.test(condition)) {
                return Boolean(context[condition]);
            }

            // Default: evaluate as-is (unsafe, but matches original TODO behavior)
            return Boolean(context[condition]);
        } catch {
            return false;
        }
    }

    /**
     * Create the appropriate actor for an activity
     */
    private createActor(activity: Activity): Actor | undefined {
        switch (activity.actor_type) {
            case 'application':
                return new SoftwareAgent();

            case 'ai_agent':
                if (!this.options.gemini_api_key) {
                    throw new Error('Gemini API Key required for AI Agent. Set gemini_api_key in options.');
                }
                const role = this.roleMap.get(activity.role_id);
                return new AIAgent(this.options.gemini_api_key, role);

            case 'robot':
                return new RobotAgent(this.options.robot_config);

            case 'human':
                return new HumanAgent({
                    wait_for_completion: false // Engine will handle waiting state
                });

            default:
                this.log(`Unknown actor type: ${activity.actor_type}`);
                return undefined;
        }
    }

    /**
     * Resume a token that was waiting for human input
     */
    public resumeToken(tokenId: UUID, output: Record<string, unknown>): boolean {
        const token = this.tokens.find(t => t.id === tokenId);
        if (!token || token.status !== 'waiting') {
            return false;
        }

        const waitingSince = token.getData('_waiting_since');
        let analytics: Analytics | undefined;

        if (waitingSince) {
            const waitTime = calculate_duration(new Date(waitingSince), new Date());
            analytics = {
                wait_time: waitTime,
                waste_categories: ['waiting' as WasteCategory]
            };
        }

        token.mergeData(output);
        token.updateStatus('active', analytics);

        if (this.status === 'waiting_human') {
            this.status = 'running';
        }

        return true;
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
}
