/**
 * AWA Human Agent Actor
 * Handles human task activities with pause/resume and persistent task queue using TaskService
 */

import { Activity, UUID, HumanTaskPriority } from '../../types';
import { Actor } from './actor';
import { v4 as uuidv4 } from 'uuid';
import { TaskService } from '../services/task_service';

/**
 * Human Agent Actor
 * Creates tasks in the persistent queue and optionally waits for completion
 */
export class HumanAgent implements Actor {
    private wait_for_completion: boolean;
    private default_priority: HumanTaskPriority;

    constructor(options: {
        wait_for_completion?: boolean;
        default_priority?: HumanTaskPriority;
    } = {}) {
        this.wait_for_completion = options.wait_for_completion ?? false;
        this.default_priority = options.default_priority ?? 'normal';
    }

    async execute(activity: Activity, inputs: Record<string, unknown>): Promise<Record<string, unknown>> {
        console.log(`[HumanAgent] Creating persistent task for activity: ${activity.name} (${activity.id})`);

        // Extract token and workflow IDs from inputs if available
        const token_id = (inputs._token_id as string) || uuidv4();
        const workflow_id = (inputs._workflow_id as string) || uuidv4();

        // Determine priority from SLA or default
        let priority: HumanTaskPriority = this.default_priority;
        if (activity.sla?.escalation_policy) {
            priority = 'high';
        }

        // Create the human task in DB
        const task = await TaskService.create({
            activity_id: activity.id,
            activity_name: activity.name,
            token_id,
            workflow_id,
            priority,
            role_id: activity.role_id || 'user', // Ensure role_id exists
            creator_id: (inputs._last_actor_id as string) || 'system',
            creator_type: (inputs._last_actor_type as any) || 'application',
            inputs,
            description: activity.description,
            due_at: this.calculate_due_date(activity) ? new Date(this.calculate_due_date(activity)!) : undefined,
            tags: []
        });

        console.log(`[HumanAgent] Task created in DB: ${task.id}`);

        // If configured to wait, block until task is completed
        // polling implementation for now
        if (this.wait_for_completion) {
            console.log(`[HumanAgent] Waiting for task ${task.id} completion...`);
            const completed_task = await this.wait_for_task_completion(task.id);

            if (completed_task.status === 'rejected') {
                const outputs = completed_task.outputs ? JSON.parse(completed_task.outputs) : {};
                throw new Error(`Human task rejected: ${outputs.rejection_reason || 'No reason provided'}`);
            }

            const outputs = completed_task.outputs ? JSON.parse(completed_task.outputs) : {};
            return {
                ...inputs,
                ...outputs,
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
     * Poll for task completion
     */
    private async wait_for_task_completion(task_id: string): Promise<any> {
        return new Promise((resolve) => {
            const check = async () => {
                const task = await TaskService.get(task_id);
                if (task && (task.status === 'completed' || task.status === 'rejected')) {
                    resolve(task);
                } else {
                    setTimeout(check, 2000); // Poll every 2 seconds
                }
            };
            check();
        });
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

// Export a getter for the queue is no longer relevant, but for backward compatibility we might need to adjust imports
// or just remove it if we sure. The prompt asked to replace the file content.
