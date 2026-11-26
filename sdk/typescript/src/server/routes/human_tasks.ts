/**
 * AWA Human Tasks API Routes
 * REST API for managing human tasks in the workflow queue
 */

import { Router } from 'express';
import { TaskService } from '../../runtime/services/task_service';
import { Request, Response } from 'express';
import { authorize_request, named_principal, request_principal, server_authorization, task_resource } from '../authorization';

export const humanTaskRouter = Router();

/**
 * Under a policy, whether the caller may answer the task (complete_task, spec 30.4). The queue does not host the run:
 * the task's inputs are the run's data, and separation of duties and four-eyes rules apply where the run is hosted.
 */
async function may_answer(req: Request, res: Response): Promise<boolean> {
    if (!server_authorization()) return true;
    const current = await TaskService.get(String(req.params.id));
    if (!current) { res.status(404).json({ error: 'Task not found' }); return false; }
    return authorize_request(req, res, 'complete_task', task_resource(current), current.inputs);
}

/**
 * GET /api/v1/tasks
 * List all pending human tasks
 */
humanTaskRouter.get('/', async (req, res) => {
    try {
        const role_id = req.query.role_id as string | undefined;
        const assignee = req.query.assignee as string | undefined;
        const status = req.query.status as string | undefined;
        const workflow_id = req.query.workflow_id as string | undefined;

        const tasks = await TaskService.list({
            role_id,
            assignee_id: assignee,
            status,
            workflow_id
        });

        res.json({
            tasks,
            total: tasks.length
        });
    } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        res.status(500).json({ error: message });
    }
});

/**
 * GET /api/v1/tasks/pending
 * Get pending tasks, optionally filtered by role
 */
humanTaskRouter.get('/pending', async (req, res) => {
    try {
        const role_id = req.query.role_id as string;

        let tasks;
        if (role_id) {
            tasks = await TaskService.get_pending_by_role(role_id);
        } else {
            tasks = await TaskService.list({ status: 'pending' });
        }

        res.json({
            tasks,
            total: tasks.length
        });
    } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        res.status(500).json({ error: message });
    }
});

/**
 * GET /api/v1/tasks/:id
 * Get a specific task by ID
 */
humanTaskRouter.get('/:id', async (req, res) => {
    try {
        const task = await TaskService.get(req.params.id);

        if (!task) {
            return res.status(404).json({ error: 'Task not found' });
        }

        res.json(task);
    } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        res.status(500).json({ error: message });
    }
});

/**
 * POST /api/v1/tasks/:id/assign
 * Assign a task to a user
 */
humanTaskRouter.post('/:id/assign', async (req, res) => {
    try {
        const { user_id, assigner_id, assigner_type } = req.body;

        if (!user_id) {
            return res.status(400).json({ error: 'user_id is required' });
        }
        // The assignee must be allowed to claim the task; a caller who assigns it to someone else, to assign it (spec 30.4)
        if (server_authorization()) {
            const current = await TaskService.get(req.params.id);
            if (!current) return res.status(404).json({ error: 'Task not found' });
            const caller = request_principal(req);
            const assignee = caller.id === user_id ? caller : named_principal(user_id);
            if (!await authorize_request(req, res, 'claim_task', task_resource(current), current.inputs, assignee)) return;
            if (assignee !== caller && !await authorize_request(req, res, 'assign_task', task_resource(current), current.inputs, caller)) return;
        }

        const task = await TaskService.assign(req.params.id, user_id, assigner_id, assigner_type);
        res.json({
            message: 'Task assigned',
            task
        });
    } catch (error: unknown) {
        // Prisma error handling could be better (e.g. record not found)
        const message = error instanceof Error ? error.message : String(error);
        res.status(400).json({ error: message });
    }
});

/**
 * POST /api/v1/tasks/:id/complete
 * Complete a task with result data
 */
humanTaskRouter.post('/:id/complete', async (req, res) => {
    try {
        const { result } = req.body;
        if (!await may_answer(req, res)) return;

        const task = await TaskService.complete(req.params.id, result || {});
        res.json({
            message: 'Task completed',
            task
        });
    } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        res.status(400).json({ error: message });
    }
});

/**
 * POST /api/v1/tasks/:id/reject
 * Reject a task with a reason
 */
humanTaskRouter.post('/:id/reject', async (req, res) => {
    try {
        const { reason } = req.body;
        // Rejecting a task is answering it (spec 30.2)
        if (!await may_answer(req, res)) return;

        const task = await TaskService.reject(req.params.id, reason || 'Rejected by user');
        res.json({
            message: 'Task rejected',
            task
        });
    } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        res.status(400).json({ error: message });
    }
});

/**
 * GET /api/v1/tasks/queue/stats
 * Get queue statistics
 */
humanTaskRouter.get('/queue/stats', async (req, res) => {
    try {
        const all = await TaskService.list();

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
    } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        res.status(500).json({ error: message });
    }
});
