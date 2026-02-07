/**
 * AWA Human Agent Actor
 * Handles human task activities with pause/resume and task queue
 */

import { Activity, UUID } from '../../types';
import { Actor } from './actor';
import { v4 as uuidv4 } from 'uuid';

/**
 * Human task status
 */
export type HumanTaskStatus = 'pending' | 'assigned' | 'in_progress' | 'completed' | 'rejected' | 'expired';

/**
 * Human task priority
 */
export type HumanTaskPriority = 'low' | 'normal' | 'high' | 'critical';

/**
 * Human task record
 */
export interface HumanTask {
    id: UUID;
    activity_id: UUID;
    activity_name: string;
    token_id: UUID;
    workflow_id: UUID;
    status: HumanTaskStatus;
    priority: HumanTaskPriority;
    assignee_id?: string;
    role_id: UUID;
    inputs: Record<string, unknown>;
    outputs?: Record<string, unknown>;
    created_at: string;
    updated_at: string;
    due_at?: string;
    completed_at?: string;
    description?: string;
    form_schema?: Record<string, unknown>;
}

/**
 * Task queue for managing pending human tasks
 */
export class HumanTaskQueue {
    private tasks: Map<UUID, HumanTask> = new Map();
    private task_listeners: Map<string, (task: HumanTask) => void> = new Map();

    /**
     * Add a new task to the queue
     */
    enqueue(task: Omit<HumanTask, 'id' | 'created_at' | 'updated_at' | 'status'>): HumanTask {
        const now = new Date().toISOString();
        const full_task: HumanTask = {
            id: uuidv4(),
            status: 'pending',
            created_at: now,
            updated_at: now,
            ...task
        };

        this.tasks.set(full_task.id, full_task);
        console.log(`[HumanTaskQueue] Task created: ${full_task.id} for activity "${full_task.activity_name}"`);

        return full_task;
    }

    /**
     * Get a task by ID
     */
    get(task_id: UUID): HumanTask | undefined {
        return this.tasks.get(task_id);
    }

    /**
     * Get tasks by token ID
     */
    get_by_token(token_id: UUID): HumanTask[] {
        return Array.from(this.tasks.values()).filter(t => t.token_id === token_id);
    }

    /**
     * Get all pending tasks for a role
     */
    get_pending_by_role(role_id: UUID): HumanTask[] {
        return Array.from(this.tasks.values())
            .filter(t => t.role_id === role_id && t.status === 'pending')
            .sort((a, b) => {
                // Sort by priority, then by creation time
                const priority_order = { critical: 0, high: 1, normal: 2, low: 3 };
                const priority_diff = priority_order[a.priority] - priority_order[b.priority];
                if (priority_diff !== 0) return priority_diff;
                return new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
            });
    }

    /**
     * Get all tasks with a specific status
     */
    get_by_status(status: HumanTaskStatus): HumanTask[] {
        return Array.from(this.tasks.values()).filter(t => t.status === status);
    }

    /**
     * Assign a task to a user
     */
    assign(task_id: UUID, assignee_id: string): HumanTask | undefined {
        const task = this.tasks.get(task_id);
        if (!task) return undefined;

        task.assignee_id = assignee_id;
        task.status = 'assigned';
        task.updated_at = new Date().toISOString();

        console.log(`[HumanTaskQueue] Task ${task_id} assigned to ${assignee_id}`);
        return task;
    }

    /**
     * Start working on a task
     */
    start(task_id: UUID): HumanTask | undefined {
        const task = this.tasks.get(task_id);
        if (!task) return undefined;

        task.status = 'in_progress';
        task.updated_at = new Date().toISOString();

        console.log(`[HumanTaskQueue] Task ${task_id} started`);
        return task;
    }

    /**
     * Complete a task with outputs
     */
    complete(task_id: UUID, outputs: Record<string, unknown>): HumanTask | undefined {
        const task = this.tasks.get(task_id);
        if (!task) return undefined;

        const now = new Date().toISOString();
        task.status = 'completed';
        task.outputs = outputs;
        task.updated_at = now;
        task.completed_at = now;

        console.log(`[HumanTaskQueue] Task ${task_id} completed`);

        // Notify listeners
        const listener = this.task_listeners.get(task_id);
        if (listener) {
            listener(task);
            this.task_listeners.delete(task_id);
        }

        return task;
    }

    /**
     * Reject a task
     */
    reject(task_id: UUID, reason?: string): HumanTask | undefined {
        const task = this.tasks.get(task_id);
        if (!task) return undefined;

        task.status = 'rejected';
        task.updated_at = new Date().toISOString();
        if (reason) {
            task.outputs = { rejection_reason: reason };
        }

        console.log(`[HumanTaskQueue] Task ${task_id} rejected: ${reason || 'no reason'}`);

        // Notify listeners
        const listener = this.task_listeners.get(task_id);
        if (listener) {
            listener(task);
            this.task_listeners.delete(task_id);
        }

        return task;
    }

    /**
     * Wait for a task to be completed
     */
    wait_for_completion(task_id: UUID): Promise<HumanTask> {
        return new Promise((resolve) => {
            const task = this.tasks.get(task_id);
            if (task && (task.status === 'completed' || task.status === 'rejected')) {
                resolve(task);
                return;
            }

            this.task_listeners.set(task_id, resolve);
        });
    }

    /**
     * Get queue statistics
     */
    get_stats(): { pending: number; assigned: number; in_progress: number; completed: number; rejected: number } {
        const stats = { pending: 0, assigned: 0, in_progress: 0, completed: 0, rejected: 0, expired: 0 };
        for (const task of this.tasks.values()) {
            stats[task.status]++;
        }
        return stats;
    }

    /**
     * Get all tasks
     */
    list(): HumanTask[] {
        return Array.from(this.tasks.values());
    }

    /**
     * Clear completed/rejected tasks
     */
    clear_completed(): number {
        let cleared = 0;
        for (const [id, task] of this.tasks.entries()) {
            if (task.status === 'completed' || task.status === 'rejected') {
                this.tasks.delete(id);
                cleared++;
            }
        }
        return cleared;
    }
}

// Global task queue singleton
let global_task_queue: HumanTaskQueue | undefined;

/**
 * Get the global human task queue
 */
export function get_task_queue(): HumanTaskQueue {
    if (!global_task_queue) {
        global_task_queue = new HumanTaskQueue();
    }
    return global_task_queue;
}

/**
 * Set a custom task queue (useful for testing or custom implementations)
 */
export function set_task_queue(queue: HumanTaskQueue): void {
    global_task_queue = queue;
}

/**
 * Human Agent Actor
 * Creates tasks in the queue and optionally waits for completion
 */
export class HumanAgent implements Actor {
    private task_queue: HumanTaskQueue;
    private wait_for_completion: boolean;
    private default_priority: HumanTaskPriority;

    constructor(options: {
        task_queue?: HumanTaskQueue;
        wait_for_completion?: boolean;
        default_priority?: HumanTaskPriority;
    } = {}) {
        this.task_queue = options.task_queue || get_task_queue();
        this.wait_for_completion = options.wait_for_completion ?? false;
        this.default_priority = options.default_priority ?? 'normal';
    }

    async execute(activity: Activity, inputs: Record<string, unknown>): Promise<Record<string, unknown>> {
        console.log(`[HumanAgent] Creating task for activity: ${activity.name} (${activity.id})`);

        // Extract token and workflow IDs from inputs if available
        const token_id = (inputs._token_id as UUID) || uuidv4();
        const workflow_id = (inputs._workflow_id as UUID) || uuidv4();

        // Determine priority from SLA or default
        let priority: HumanTaskPriority = this.default_priority;
        if (activity.sla?.escalation_policy) {
            priority = 'high';
        }

        // Create the human task
        const task = this.task_queue.enqueue({
            activity_id: activity.id,
            activity_name: activity.name,
            token_id,
            workflow_id,
            priority,
            role_id: activity.role_id,
            inputs,
            description: activity.description,
            due_at: this.calculate_due_date(activity)
        });

        // If configured to wait, block until task is completed
        if (this.wait_for_completion) {
            console.log(`[HumanAgent] Waiting for task ${task.id} completion...`);
            const completed_task = await this.task_queue.wait_for_completion(task.id);

            if (completed_task.status === 'rejected') {
                throw new Error(`Human task rejected: ${completed_task.outputs?.rejection_reason || 'No reason provided'}`);
            }

            return {
                ...inputs,
                ...completed_task.outputs,
                _human_task_id: task.id,
                _human_task_status: 'completed'
            };
        }

        // Return immediately with task reference (non-blocking mode)
        return {
            ...inputs,
            _human_task_id: task.id,
            _human_task_status: 'pending',
            _requires_human_action: true
        };
    }

    /**
     * Calculate due date from activity SLA
     */
    private calculate_due_date(activity: Activity): string | undefined {
        if (!activity.sla?.max_time) {
            return undefined;
        }

        // Parse ISO 8601 duration (simplified)
        const duration = activity.sla.max_time;
        const match = duration.match(/PT?(\d+)([HMSD])/);
        if (!match) return undefined;

        const [, value, unit] = match;
        const ms_multipliers: Record<string, number> = {
            'S': 1000,
            'M': 60 * 1000,
            'H': 60 * 60 * 1000,
            'D': 24 * 60 * 60 * 1000
        };

        const offset_ms = parseInt(value) * (ms_multipliers[unit] || 0);
        return new Date(Date.now() + offset_ms).toISOString();
    }
}
