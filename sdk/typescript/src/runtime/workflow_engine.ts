import { UUID, Workflow, Activity, Edge, Role } from '../types';
import { Token } from './token';
import { ContextManager } from './context_manager';
import { validate_workflow_integrity } from '../validator';
import { Actor } from './actors/actor';
import { SoftwareAgent } from './actors/software_agent';
import { AIAgent } from './actors/ai_agent';

export type EngineStatus = 'running' | 'paused' | 'completed' | 'failed' | 'idle';

export interface WorkflowEngineOptions {
    geminiApiKey?: string;
    roles?: Role[];
}

export class WorkflowEngine {
    private workflow: Workflow;
    private tokens: Token[];
    private contextManager: ContextManager;
    private status: EngineStatus;
    private activityMap: Map<UUID, Activity>;
    private edgeMap: Map<UUID, Edge[]>; // Source ID -> Edges
    private options: WorkflowEngineOptions;
    private roleMap: Map<UUID, Role>;

    constructor(workflowDef: Workflow, options: WorkflowEngineOptions = {}) {
        // Validate workflow integrity
        const validation = validate_workflow_integrity(workflowDef);
        if (!validation.valid) {
            throw new Error(`Invalid workflow definition: ${validation.errors.map(e => e.message).join(', ')}`);
        }

        this.workflow = workflowDef;
        this.options = options;
        this.tokens = [];
        this.contextManager = new ContextManager();
        this.status = 'idle';
        this.activityMap = new Map();
        this.edgeMap = new Map();
        this.roleMap = new Map();

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

        try {
            // Determine Actor
            let actor: Actor | undefined;

            switch (activity.actor_type) {
                case 'application':
                    actor = new SoftwareAgent();
                    break;
                case 'ai_agent':
                    if (!this.options.geminiApiKey) {
                        console.warn('Skipping AI Agent execution: No Gemini API Key provided.');
                        // Fallback or fail? For now fail or strict mock check.
                        // Assuming environment might provide it if option is missing?
                        // But best to require it.
                        throw new Error("Gemini API Key required for AI Agent");
                    }
                    const role = this.roleMap.get(activity.role_id);
                    actor = new AIAgent(this.options.geminiApiKey, role);
                    break;
                case 'human':
                    // TODO: Implement Human Task Queuing
                    console.log('Human actor not yet implemented - pausing token');
                    // For now, we might auto-complete or pause. 
                    // Let's just log and auto-complete for loop testing unless we want to block.
                    break;
            }

            if (actor) {
                // Prepare Inputs
                // Filter token.data based on activity.inputs definitions?
                // For now pass all data as context.
                const inputs = token.contextData;
                const output = await actor.execute(activity, inputs);

                // Merge output back to token data
                // In AWA, outputs should map to Context or Token Data. 
                // We'll merge top-level keys.
                token.mergeData(output);
            }

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

        } catch (error: any) {
            console.error(`Error processing activity ${activity.name}:`, error);
            token.updateStatus('failed');
            token.mergeData({ _error: error.message, _stack: error.stack });
        }
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
