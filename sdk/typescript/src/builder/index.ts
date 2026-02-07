/**
 * AWA Workflow Builder - Fluent API for constructing workflows
 */

import { v4 as uuidv4 } from 'uuid';
import type {
    Workflow,
    Activity,
    Edge,
    Context,
    ContextBinding,
    AccessRight,
    ActorType,
    AccessMode,
    SyncPattern,
    ContextType,
    Permission,
    ResourceType,
    AccessDirection,
    SLA,
    Analytics,
} from '../types';

export interface ActivityConfig {
    name: string;
    description?: string;
    role_id: string;
    actor_type: ActorType;
    system_id?: string;
    machine_id?: string;
    endpoint_id?: string;
    organization_id?: string;
    contexts?: Array<{ id: string; access_mode: AccessMode; required?: boolean }>;
    access_rights?: Array<{
        name: string;
        resource_type: ResourceType;
        resource_id?: string;
        permission: Permission;
        direction?: AccessDirection;
        scope?: string;
    }>;
    sla?: SLA;
    analytics?: Analytics;
}

export interface ContextConfig {
    name: string;
    type: ContextType;
    sync_pattern: SyncPattern;
    description?: string;
    schema?: Record<string, unknown>;
    initial_value?: unknown;
    visibility?: 'private' | 'workflow' | 'collection' | 'global';
}

export class WorkflowBuilder {
    private workflow: Partial<Workflow>;
    private activityMap: Map<string, Activity> = new Map();
    private contextMap: Map<string, Context> = new Map();

    constructor(name: string, version: string = '1.0.0') {
        this.workflow = {
            id: uuidv4(),
            name,
            version,
            activities: [],
            edges: [],
            events: [],
            decision_nodes: [],
            contexts: [],
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
        };
    }

    /**
     * Set workflow description
     */
    description(description: string): this {
        this.workflow.description = description;
        return this;
    }

    /**
     * Set workflow owner
     */
    owner(owner_id: string): this {
        this.workflow.owner_id = owner_id;
        return this;
    }

    /**
     * Set owning organization
     */
    organization(organization_id: string): this {
        this.workflow.organization_id = organization_id;
        return this;
    }

    /**
     * Add a context for agent collaboration
     */
    context(name: string, config: Omit<ContextConfig, 'name'>): this {
        const context: Context = {
            id: uuidv4(),
            name,
            type: config.type,
            sync_pattern: config.sync_pattern,
            description: config.description,
            schema: config.schema,
            initial_value: config.initial_value,
            visibility: config.visibility || 'workflow',
            owner_workflow_id: this.workflow.id,
            lifecycle: 'persistent',
        };
        this.contextMap.set(name, context);
        this.workflow.contexts!.push(context);
        return this;
    }

    /**
     * Add an activity to the workflow
     */
    activity(name: string, config: Omit<ActivityConfig, 'name'>): this {
        const activityId = uuidv4();

        const contextBindings: ContextBinding[] = (config.contexts || []).map(ctx => {
            const contextObj = this.contextMap.get(ctx.id);
            return {
                id: uuidv4(),
                context_id: contextObj?.id || ctx.id,
                activity_id: activityId,
                access_mode: ctx.access_mode,
                required: ctx.required ?? true,
            };
        });

        const accessRights: AccessRight[] = (config.access_rights || []).map(ar => ({
            id: uuidv4(),
            name: ar.name,
            activity_id: activityId,
            direction: ar.direction || 'requires',
            resource_type: ar.resource_type,
            resource_id: ar.resource_id,
            permission: ar.permission,
            scope: ar.scope,
        }));

        const activity: Activity = {
            id: activityId,
            name,
            description: config.description,
            role_id: config.role_id,
            actor_type: config.actor_type,
            system_id: config.system_id,
            machine_id: config.machine_id,
            endpoint_id: config.endpoint_id,
            organization_id: config.organization_id,
            inputs: [],
            outputs: [],
            context_bindings: contextBindings,
            access_rights: accessRights,
            programs: [],
            controls: [],
            sla: config.sla,
            analytics: config.analytics,
            is_expandable: false,
            skills: [],
            tool_requirements: [],
        };

        this.activityMap.set(name, activity);
        this.workflow.activities!.push(activity);
        return this;
    }

    /**
     * Add an edge between two activities
     */
    edge(sourceName: string, targetName: string, options?: { condition?: string; label?: string }): this {
        const source = this.activityMap.get(sourceName);
        const target = this.activityMap.get(targetName);

        if (!source) {
            throw new Error(`Source activity '${sourceName}' not found`);
        }
        if (!target) {
            throw new Error(`Target activity '${targetName}' not found`);
        }

        const edge: Edge = {
            id: uuidv4(),
            source_id: source.id,
            target_id: target.id,
            source_type: 'activity',
            target_type: 'activity',
            condition: options?.condition,
            label: options?.label,
            is_default: false,
            skills: [],
            tool_requirements: [],
        };

        this.workflow.edges!.push(edge);
        return this;
    }

    /**
     * Set workflow-level SLA
     */
    sla(sla: SLA): this {
        this.workflow.sla = sla;
        return this;
    }

    /**
     * Set workflow-level analytics
     */
    analytics(analytics: Analytics): this {
        this.workflow.analytics = analytics;
        return this;
    }

    /**
     * Add metadata
     */
    metadata(key: string, value: unknown): this {
        if (!this.workflow.metadata) {
            this.workflow.metadata = {};
        }
        this.workflow.metadata[key] = value;
        return this;
    }

    /**
     * Build and return the workflow
     */
    build(): Workflow {
        this.workflow.updated_at = new Date().toISOString();
        return this.workflow as Workflow;
    }

    /**
     * Get activity by name
     */
    getActivity(name: string): Activity | undefined {
        return this.activityMap.get(name);
    }

    /**
     * Get context by name
     */
    getContext(name: string): Context | undefined {
        return this.contextMap.get(name);
    }
}

/**
 * Create a new workflow builder
 */
export function workflow(name: string, version?: string): WorkflowBuilder {
    return new WorkflowBuilder(name, version);
}
