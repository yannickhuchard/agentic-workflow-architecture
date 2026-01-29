/**
 * AWA Query - Queryable traversal of workflow elements
 */

import type {
    Workflow,
    Activity,
    Context,
    ContextBinding,
    AccessRight,
    ActorType,
    AccessMode,
    Permission,
    ResourceType,
} from '../types';

export class WorkflowQuery {
    constructor(private workflow: Workflow) { }

    /**
     * Query activities
     */
    activities(): ActivityQuery {
        return new ActivityQuery(this.workflow.activities);
    }

    /**
     * Query contexts
     */
    contexts(): ContextQuery {
        return new ContextQuery(this.workflow.contexts);
    }

    /**
     * Query all access rights across activities
     */
    access_rights(): AccessRightQuery {
        const allRights = this.workflow.activities.flatMap(a => a.access_rights);
        return new AccessRightQuery(allRights);
    }

    /**
     * Query context bindings across activities
     */
    context_bindings(): ContextBindingQuery {
        const allBindings = this.workflow.activities.flatMap(a => a.context_bindings);
        return new ContextBindingQuery(allBindings);
    }
}

export class ActivityQuery {
    constructor(private activities: Activity[]) { }

    /**
     * Filter by actor type
     */
    by_actor_type(type: ActorType): this {
        this.activities = this.activities.filter(a => a.actor_type === type);
        return this;
    }

    /**
     * Filter by system
     */
    by_system(system_id: string): this {
        this.activities = this.activities.filter(a => a.system_id === system_id);
        return this;
    }

    /**
     * Filter by role
     */
    by_role(role_id: string): this {
        this.activities = this.activities.filter(a => a.role_id === role_id);
        return this;
    }

    /**
     * Filter activities that have access rights
     */
    with_access_rights(): this {
        this.activities = this.activities.filter(a => a.access_rights.length > 0);
        return this;
    }

    /**
     * Filter activities bound to a specific context
     */
    bound_to_context(context_id: string): this {
        this.activities = this.activities.filter(a =>
            a.context_bindings.some(b => b.context_id === context_id)
        );
        return this;
    }

    /**
     * Custom filter
     */
    where(predicate: (activity: Activity) => boolean): this {
        this.activities = this.activities.filter(predicate);
        return this;
    }

    /**
     * Get first result
     */
    first(): Activity | undefined {
        return this.activities[0];
    }

    /**
     * Get all results
     */
    list(): Activity[] {
        return [...this.activities];
    }

    /**
     * Count results
     */
    count(): number {
        return this.activities.length;
    }
}

export class ContextQuery {
    constructor(private contexts: Context[]) { }

    /**
     * Filter by type
     */
    by_type(type: Context['type']): this {
        this.contexts = this.contexts.filter(c => c.type === type);
        return this;
    }

    /**
     * Filter by sync pattern
     */
    by_sync_pattern(pattern: Context['sync_pattern']): this {
        this.contexts = this.contexts.filter(c => c.sync_pattern === pattern);
        return this;
    }

    /**
     * Filter by visibility
     */
    by_visibility(visibility: Context['visibility']): this {
        this.contexts = this.contexts.filter(c => c.visibility === visibility);
        return this;
    }

    /**
     * Custom filter
     */
    where(predicate: (context: Context) => boolean): this {
        this.contexts = this.contexts.filter(predicate);
        return this;
    }

    /**
     * Get first result
     */
    first(): Context | undefined {
        return this.contexts[0];
    }

    /**
     * Get all results
     */
    list(): Context[] {
        return [...this.contexts];
    }

    /**
     * Count results
     */
    count(): number {
        return this.contexts.length;
    }
}

export class AccessRightQuery {
    constructor(private rights: AccessRight[]) { }

    /**
     * Filter by permission
     */
    by_permission(permission: Permission): this {
        this.rights = this.rights.filter(r => r.permission === permission);
        return this;
    }

    /**
     * Filter by resource type
     */
    by_resource_type(type: ResourceType): this {
        this.rights = this.rights.filter(r => r.resource_type === type);
        return this;
    }

    /**
     * Filter by direction (requires/provisions)
     */
    by_direction(direction: 'requires' | 'provisions'): this {
        this.rights = this.rights.filter(r => r.direction === direction);
        return this;
    }

    /**
     * Filter by resource ID
     */
    by_resource_id(resource_id: string): this {
        this.rights = this.rights.filter(r => r.resource_id === resource_id);
        return this;
    }

    /**
     * Custom filter
     */
    where(predicate: (right: AccessRight) => boolean): this {
        this.rights = this.rights.filter(predicate);
        return this;
    }

    /**
     * Get first result
     */
    first(): AccessRight | undefined {
        return this.rights[0];
    }

    /**
     * Get all results
     */
    list(): AccessRight[] {
        return [...this.rights];
    }

    /**
     * Count results
     */
    count(): number {
        return this.rights.length;
    }
}

export class ContextBindingQuery {
    constructor(private bindings: ContextBinding[]) { }

    /**
     * Filter by access mode
     */
    by_access_mode(mode: AccessMode): this {
        this.bindings = this.bindings.filter(b => b.access_mode === mode);
        return this;
    }

    /**
     * Filter by context
     */
    by_context(context_id: string): this {
        this.bindings = this.bindings.filter(b => b.context_id === context_id);
        return this;
    }

    /**
     * Custom filter
     */
    where(predicate: (binding: ContextBinding) => boolean): this {
        this.bindings = this.bindings.filter(predicate);
        return this;
    }

    /**
     * Get first result
     */
    first(): ContextBinding | undefined {
        return this.bindings[0];
    }

    /**
     * Get all results
     */
    list(): ContextBinding[] {
        return [...this.bindings];
    }

    /**
     * Count results
     */
    count(): number {
        return this.bindings.length;
    }
}

/**
 * Create a query for a workflow
 */
export function query(workflow: Workflow): WorkflowQuery {
    return new WorkflowQuery(workflow);
}
