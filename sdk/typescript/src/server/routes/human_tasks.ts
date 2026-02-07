/**
 * AWA Human Tasks API Routes
 * REST API for managing human tasks in the workflow queue
 */

import { Router } from 'express';
import { get_task_queue } from '../../runtime/actors/human_agent';
import { require_role, require_permission } from '../auth';

export const humanTaskRouter = Router();

/**
 * GET /api/v1/tasks
 * List all pending human tasks
 */
humanTaskRouter.get('/', (req, res) => {
    const queue = get_task_queue();
    const role_id = req.query.role_id as string | undefined;
    const assignee = req.query.assignee as string | undefined;

    let tasks = queue.list();

    if (role_id) {
        tasks = tasks.filter(t => t.role_id === role_id);
    }

    if (assignee) {
        tasks = tasks.filter(t => t.assignee_id === assignee);
    }

    res.json({
        tasks,
        total: tasks.length
    });
});

/**
 * GET /api/v1/tasks/pending
 * Get pending tasks, optionally filtered by role
 */
humanTaskRouter.get('/pending', (req, res) => {
    const queue = get_task_queue();
    const role_id = req.query.role_id as string;

    const tasks = role_id
        ? queue.get_pending_by_role(role_id)
        : queue.list().filter(t => t.status === 'pending');

    res.json({
        tasks,
        total: tasks.length
    });
});

/**
 * GET /api/v1/tasks/:id
 * Get a specific task by ID
 */
humanTaskRouter.get('/:id', (req, res) => {
    const queue = get_task_queue();
    const task = queue.get(req.params.id);

    if (!task) {
        return res.status(404).json({ error: 'Task not found' });
    }

    res.json(task);
});

/**
 * POST /api/v1/tasks/:id/assign
 * Assign a task to a user
 */
humanTaskRouter.post('/:id/assign', (req, res) => {
    const queue = get_task_queue();
    const { user_id } = req.body;

    if (!user_id) {
        return res.status(400).json({ error: 'user_id is required' });
    }

    try {
        const task = queue.assign(req.params.id, user_id);
        res.json({
            message: 'Task assigned',
            task
        });
    } catch (error: any) {
        res.status(400).json({ error: error.message });
    }
});

/**
 * POST /api/v1/tasks/:id/complete
 * Complete a task with result data
 */
humanTaskRouter.post('/:id/complete', (req, res) => {
    const queue = get_task_queue();
    const { result } = req.body;

    try {
        const task = queue.complete(req.params.id, result || {});
        res.json({
            message: 'Task completed',
            task
        });
    } catch (error: any) {
        res.status(400).json({ error: error.message });
    }
});

/**
 * POST /api/v1/tasks/:id/reject
 * Reject a task with a reason
 */
humanTaskRouter.post('/:id/reject', (req, res) => {
    const queue = get_task_queue();
    const { reason } = req.body;

    try {
        const task = queue.reject(req.params.id, reason || 'Rejected by user');
        res.json({
            message: 'Task rejected',
            task
        });
    } catch (error: any) {
        res.status(400).json({ error: error.message });
    }
});

/**
 * GET /api/v1/tasks/stats
 * Get queue statistics
 */
humanTaskRouter.get('/queue/stats', (req, res) => {
    const queue = get_task_queue();
    const all = queue.list();

    const stats = {
        total: all.length,
        by_status: {
            pending: all.filter(t => t.status === 'pending').length,
            assigned: all.filter(t => t.status === 'assigned').length,
            in_progress: all.filter(t => t.status === 'in_progress').length,
            completed: all.filter(t => t.status === 'completed').length,
            rejected: all.filter(t => t.status === 'rejected').length
        },
        by_priority: {
            critical: all.filter(t => t.priority === 'critical').length,
            high: all.filter(t => t.priority === 'high').length,
            normal: all.filter(t => t.priority === 'normal').length,
            low: all.filter(t => t.priority === 'low').length
        }
    };

    res.json(stats);
});
