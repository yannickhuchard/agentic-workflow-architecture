/**
 * AWA Human Agent and Task Queue Tests
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
    HumanAgent,
    HumanTaskQueue,
    HumanTask,
    get_task_queue,
    set_task_queue
} from '../src/runtime/actors/human_agent';
import { Activity } from '../src/types';
import { v4 as uuidv4 } from 'uuid';

// Helper to create a mock activity
function createMockActivity(name: string, roleId?: string): Activity {
    return {
        id: uuidv4(),
        name,
        role_id: roleId || uuidv4(),
        actor_type: 'human',
        inputs: [],
        outputs: [],
        context_bindings: [],
        access_rights: [],
        programs: [],
        controls: [],
        is_expandable: false,
        skills: [],
        tool_requirements: []
    };
}

describe('HumanTaskQueue', () => {
    let queue: HumanTaskQueue;

    beforeEach(() => {
        queue = new HumanTaskQueue();
    });

    it('should enqueue a new task', () => {
        const task = queue.enqueue({
            activity_id: uuidv4(),
            activity_name: 'Approve Request',
            token_id: uuidv4(),
            workflow_id: uuidv4(),
            priority: 'normal',
            role_id: uuidv4(),
            inputs: { amount: 5000 }
        });

        expect(task.id).toBeDefined();
        expect(task.status).toBe('pending');
        expect(task.created_at).toBeDefined();
    });

    it('should retrieve task by ID', () => {
        const task = queue.enqueue({
            activity_id: uuidv4(),
            activity_name: 'Review Document',
            token_id: uuidv4(),
            workflow_id: uuidv4(),
            priority: 'high',
            role_id: uuidv4(),
            inputs: {}
        });

        const retrieved = queue.get(task.id);
        expect(retrieved).toBeDefined();
        expect(retrieved?.activity_name).toBe('Review Document');
    });

    it('should get pending tasks by role, sorted by priority', () => {
        const roleId = uuidv4();

        queue.enqueue({
            activity_id: uuidv4(),
            activity_name: 'Low Priority Task',
            token_id: uuidv4(),
            workflow_id: uuidv4(),
            priority: 'low',
            role_id: roleId,
            inputs: {}
        });

        queue.enqueue({
            activity_id: uuidv4(),
            activity_name: 'Critical Task',
            token_id: uuidv4(),
            workflow_id: uuidv4(),
            priority: 'critical',
            role_id: roleId,
            inputs: {}
        });

        queue.enqueue({
            activity_id: uuidv4(),
            activity_name: 'Normal Task',
            token_id: uuidv4(),
            workflow_id: uuidv4(),
            priority: 'normal',
            role_id: roleId,
            inputs: {}
        });

        const tasks = queue.get_pending_by_role(roleId);
        expect(tasks.length).toBe(3);
        expect(tasks[0].priority).toBe('critical');
        expect(tasks[1].priority).toBe('normal');
        expect(tasks[2].priority).toBe('low');
    });

    it('should assign task to user', () => {
        const task = queue.enqueue({
            activity_id: uuidv4(),
            activity_name: 'Process Order',
            token_id: uuidv4(),
            workflow_id: uuidv4(),
            priority: 'normal',
            role_id: uuidv4(),
            inputs: {}
        });

        const assigned = queue.assign(task.id, 'user-123');
        expect(assigned?.status).toBe('assigned');
        expect(assigned?.assignee_id).toBe('user-123');
    });

    it('should start working on task', () => {
        const task = queue.enqueue({
            activity_id: uuidv4(),
            activity_name: 'Review',
            token_id: uuidv4(),
            workflow_id: uuidv4(),
            priority: 'normal',
            role_id: uuidv4(),
            inputs: {}
        });

        queue.assign(task.id, 'user-456');
        const started = queue.start(task.id);
        expect(started?.status).toBe('in_progress');
    });

    it('should complete task with outputs', () => {
        const task = queue.enqueue({
            activity_id: uuidv4(),
            activity_name: 'Approve',
            token_id: uuidv4(),
            workflow_id: uuidv4(),
            priority: 'normal',
            role_id: uuidv4(),
            inputs: { amount: 1000 }
        });

        const completed = queue.complete(task.id, { approved: true, comments: 'Looks good' });
        expect(completed?.status).toBe('completed');
        expect(completed?.outputs?.approved).toBe(true);
        expect(completed?.completed_at).toBeDefined();
    });

    it('should reject task with reason', () => {
        const task = queue.enqueue({
            activity_id: uuidv4(),
            activity_name: 'Verify',
            token_id: uuidv4(),
            workflow_id: uuidv4(),
            priority: 'normal',
            role_id: uuidv4(),
            inputs: {}
        });

        const rejected = queue.reject(task.id, 'Missing documentation');
        expect(rejected?.status).toBe('rejected');
        expect(rejected?.outputs?.rejection_reason).toBe('Missing documentation');
    });

    it('should track task statistics', () => {
        const roleId = uuidv4();

        // Add various tasks
        const t1 = queue.enqueue({ activity_id: uuidv4(), activity_name: 'T1', token_id: uuidv4(), workflow_id: uuidv4(), priority: 'normal', role_id: roleId, inputs: {} });
        const t2 = queue.enqueue({ activity_id: uuidv4(), activity_name: 'T2', token_id: uuidv4(), workflow_id: uuidv4(), priority: 'normal', role_id: roleId, inputs: {} });
        const t3 = queue.enqueue({ activity_id: uuidv4(), activity_name: 'T3', token_id: uuidv4(), workflow_id: uuidv4(), priority: 'normal', role_id: roleId, inputs: {} });

        queue.assign(t1.id, 'user1');
        queue.complete(t2.id, {});
        queue.reject(t3.id, 'reason');

        const stats = queue.get_stats();
        expect(stats.assigned).toBe(1);
        expect(stats.completed).toBe(1);
        expect(stats.rejected).toBe(1);
    });

    it('should wait for task completion (async)', async () => {
        const task = queue.enqueue({
            activity_id: uuidv4(),
            activity_name: 'Async Task',
            token_id: uuidv4(),
            workflow_id: uuidv4(),
            priority: 'normal',
            role_id: uuidv4(),
            inputs: {}
        });

        // Complete the task after a short delay
        setTimeout(() => {
            queue.complete(task.id, { result: 'done' });
        }, 50);

        const completed = await queue.wait_for_completion(task.id);
        expect(completed.status).toBe('completed');
        expect(completed.outputs?.result).toBe('done');
    });

    it('should clear completed and rejected tasks', () => {
        const roleId = uuidv4();

        const t1 = queue.enqueue({ activity_id: uuidv4(), activity_name: 'T1', token_id: uuidv4(), workflow_id: uuidv4(), priority: 'normal', role_id: roleId, inputs: {} });
        const t2 = queue.enqueue({ activity_id: uuidv4(), activity_name: 'T2', token_id: uuidv4(), workflow_id: uuidv4(), priority: 'normal', role_id: roleId, inputs: {} });
        const t3 = queue.enqueue({ activity_id: uuidv4(), activity_name: 'T3', token_id: uuidv4(), workflow_id: uuidv4(), priority: 'normal', role_id: roleId, inputs: {} });

        queue.complete(t1.id, {});
        queue.reject(t2.id, 'no');

        const cleared = queue.clear_completed();
        expect(cleared).toBe(2);
        expect(queue.list().length).toBe(1);
        expect(queue.list()[0].id).toBe(t3.id);
    });
});

describe('HumanAgent', () => {
    let queue: HumanTaskQueue;

    beforeEach(() => {
        queue = new HumanTaskQueue();
    });

    it('should create a human task when executing', async () => {
        const agent = new HumanAgent({ task_queue: queue, wait_for_completion: false });
        const activity = createMockActivity('Manual Approval');

        const result = await agent.execute(activity, { order_id: 'ORD-123' });

        expect(result._human_task_id).toBeDefined();
        expect(result._human_task_status).toBe('pending');
        expect(result._requires_human_action).toBe(true);

        const tasks = queue.list();
        expect(tasks.length).toBe(1);
        expect(tasks[0].inputs.order_id).toBe('ORD-123');
    });

    it('should wait for task completion when configured', async () => {
        const agent = new HumanAgent({ task_queue: queue, wait_for_completion: true });
        const activity = createMockActivity('Review Document');

        // Complete the task after a short delay
        setTimeout(() => {
            const tasks = queue.list();
            if (tasks.length > 0) {
                queue.complete(tasks[0].id, { reviewed: true });
            }
        }, 50);

        const result = await agent.execute(activity, { doc_id: 'DOC-456' });

        expect(result._human_task_status).toBe('completed');
        expect(result.reviewed).toBe(true);
    });

    it('should throw when task is rejected in wait mode', async () => {
        const agent = new HumanAgent({ task_queue: queue, wait_for_completion: true });
        const activity = createMockActivity('Approve Expense');

        // Reject the task after a short delay
        setTimeout(() => {
            const tasks = queue.list();
            if (tasks.length > 0) {
                queue.reject(tasks[0].id, 'Exceeds budget');
            }
        }, 50);

        await expect(agent.execute(activity, { amount: 10000 }))
            .rejects.toThrow('Human task rejected');
    });

    it('should use default priority from options', async () => {
        const agent = new HumanAgent({
            task_queue: queue,
            wait_for_completion: false,
            default_priority: 'high'
        });
        const activity = createMockActivity('Urgent Task');

        await agent.execute(activity, {});

        const tasks = queue.list();
        expect(tasks[0].priority).toBe('high');
    });
});

describe('Global Task Queue', () => {
    it('should return same instance', () => {
        const q1 = get_task_queue();
        const q2 = get_task_queue();
        expect(q1).toBe(q2);
    });

    it('should allow setting custom queue', () => {
        const custom = new HumanTaskQueue();
        set_task_queue(custom);
        expect(get_task_queue()).toBe(custom);
    });
});
