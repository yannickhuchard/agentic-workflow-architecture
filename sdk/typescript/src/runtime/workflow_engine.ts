import { UUID, Workflow, Activity, Edge } from '../types';
import { Token } from './token';
import { ContextManager } from './context_manager';
import { validate_workflow_integrity } from '../validator';

export type EngineStatus = 'running' | 'paused' | 'completed' | 'failed' | 'idle';

export class WorkflowEngine {
    private workflow: Workflow;
    private tokens: Token[];
    private contextManager: ContextManager;
    private status: EngineStatus;
    private activityMap: Map<UUID, Activity>;
    private edgeMap: Map<UUID, Edge[]>; // Source ID -> Edges

    constructor(workflowDef: Workflow) {
        // Validate workflow integrity
        const validation = validate_workflow_integrity(workflowDef);
        if (!validation.valid) {
            throw new Error(`Invalid workflow definition: ${validation.errors.map(e => e.message).join(', ')}`);
        }

        this.workflow = workflowDef;
        this.tokens = [];
        this.contextManager = new ContextManager();
        this.status = 'idle';
        this.activityMap = new Map();
        this.edgeMap = new Map();

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
    }

    private initializeContexts(): void {
        for (const context of this.workflow.contexts) {
            this.contextManager.register(context);
        }
    }

    public async start(initialData: Record<string, any> = {}): Promise<UUID> {
        if (this.status === 'running') {
            throw new Error('Workflow is already running');
        }

        if (this.workflow.activities.length === 0) {
            throw new Error('Workflow has no activities');
        }

        // Strategy: Find node with no incoming edges from Activities (ignoring events for now unless they start)
        // Or if explicit start event exists, follow it.
        // For Phase 1: Simple entry point detection.

        let startNodeId: UUID | undefined;

        const targetIds = new Set(this.workflow.edges.map(e => e.target_id));
        const startActivities = this.workflow.activities.filter(a => !targetIds.has(a.id));

        if (startActivities.length > 0) {
            startNodeId = startActivities[0].id;
        } else {
            // Cycle or just pick first
            startNodeId = this.workflow.activities[0].id;
        }

        const token = new Token(startNodeId, initialData, undefined, this.workflow.id);
        this.tokens.push(token);
        this.status = 'running';

        return token.id;
    }

    public async runStep(): Promise<void> {
        if (this.status !== 'running') return;

        const activeTokens = this.tokens.filter(t => t.status === 'active');

        if (activeTokens.length === 0) {
            this.status = 'completed';
            return;
        }

        for (const token of activeTokens) {
            await this.processToken(token);
        }

        // Re-check status
        if (this.tokens.every(t => t.status === 'completed' || t.status === 'failed' || t.status === 'cancelled')) {
            this.status = 'completed';
        }
    }

    private async processToken(token: Token): Promise<void> {
        const currentActivityId = token.activityId;
        const activity = this.activityMap.get(currentActivityId);

        if (!activity) {
            token.updateStatus('failed');
            return;
        }

        // TODO: Execute Activity Logic (Context binding, Scripts, etc.)
        // This is where we would invoke the agent, tool, or script.
        // For Phase 1, we assume instant execution or just moving forward.

        // Move to next
        const outgoingEdges = this.edgeMap.get(currentActivityId) || [];

        if (outgoingEdges.length === 0) {
            token.updateStatus('completed');
            return;
        }

        // Simple sequential flow for now - take first edge
        // TODO: Evaluate conditions for branching

        const nextEdge = outgoingEdges[0];
        token.move(nextEdge.target_id);
    }

    public getStatus(): EngineStatus {
        return this.status;
    }

    public getContext(contextId: UUID): any {
        return this.contextManager.get(contextId);
    }

    public getTokens(): Token[] {
        return this.tokens;
    }
}
