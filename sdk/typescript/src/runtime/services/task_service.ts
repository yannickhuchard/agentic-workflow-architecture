import { db } from '../persistence/db';
import { HumanTask as PrismaTask, Prisma } from '@prisma/client';
import { HumanTask } from '../../types';

export class TaskService {
    /**
     * Map Prisma Task to Domain Task
     */
    private static mapToDomain(task: PrismaTask): HumanTask {
        return {
            ...task,
            status: task.status as any, // Cast to enum
            priority: task.priority as any, // Cast to enum
            assignee_id: task.assignee_id || undefined,
            creator_id: task.creator_id || undefined,
            creator_type: task.creator_type as any || undefined,
            assigner_id: task.assigner_id || undefined,
            assigner_type: task.assigner_type as any || undefined,
            description: task.description || undefined,
            inputs: JSON.parse(task.inputs),
            outputs: task.outputs ? JSON.parse(task.outputs) : undefined,
            tags: task.tags ? JSON.parse(task.tags) : undefined,
            form_schema: task.form_schema ? JSON.parse(task.form_schema) : undefined,
            created_at: task.created_at.toISOString(),
            updated_at: task.updated_at.toISOString(),
            due_at: task.due_at?.toISOString(),
            completed_at: task.completed_at?.toISOString()
        };
    }

    /**
     * Create a new task
     */
    static async create(data: Omit<Prisma.HumanTaskCreateInput, 'inputs' | 'outputs' | 'tags' | 'form_schema'> & {
        inputs: Record<string, any>,
        outputs?: Record<string, any>,
        tags?: string[],
        form_schema?: Record<string, any>
    }): Promise<HumanTask> {
        const task = await db.humanTask.create({
            data: {
                ...data,
                inputs: JSON.stringify(data.inputs),
                outputs: data.outputs ? JSON.stringify(data.outputs) : undefined,
                tags: data.tags ? JSON.stringify(data.tags) : undefined,
                form_schema: data.form_schema ? JSON.stringify(data.form_schema) : undefined
            }
        });
        return this.mapToDomain(task);
    }

    /**
     * Get a task by ID
     */
    static async get(id: string): Promise<HumanTask | null> {
        const task = await db.humanTask.findUnique({
            where: { id }
        });
        return task ? this.mapToDomain(task) : null;
    }

    /**
     * List tasks with optional filters
     */
    static async list(filters?: {
        assignee_id?: string;
        role_id?: string;
        status?: string;
        workflow_id?: string;
    }): Promise<HumanTask[]> {
        const where: Prisma.HumanTaskWhereInput = {};

        if (filters?.assignee_id) where.assignee_id = filters.assignee_id;
        if (filters?.role_id) where.role_id = filters.role_id;
        if (filters?.status) where.status = filters.status;
        if (filters?.workflow_id) where.workflow_id = filters.workflow_id;

        const tasks = await db.humanTask.findMany({
            where,
            orderBy: { created_at: 'desc' }
        });

        return tasks.map(this.mapToDomain);
    }

    /**
     * Assign a task
     */
    static async assign(id: string, assignee_id: string, assigner_id?: string, assigner_type?: string): Promise<HumanTask> {
        const task = await db.humanTask.update({
            where: { id },
            data: {
                assignee_id,
                assigner_id,
                assigner_type,
                status: 'assigned',
                updated_at: new Date()
            }
        });
        return this.mapToDomain(task);
    }

    /**
     * Start a task
     */
    static async start(id: string): Promise<HumanTask> {
        const task = await db.humanTask.update({
            where: { id },
            data: {
                status: 'in_progress',
                updated_at: new Date()
            }
        });
        return this.mapToDomain(task);
    }

    /**
     * Complete a task
     */
    static async complete(id: string, outputs: Record<string, any>): Promise<HumanTask> {
        const task = await db.humanTask.update({
            where: { id },
            data: {
                status: 'completed',
                outputs: JSON.stringify(outputs),
                completed_at: new Date(),
                updated_at: new Date()
            }
        });
        return this.mapToDomain(task);
    }

    /**
     * Reject a task
     */
    static async reject(id: string, reason?: string): Promise<HumanTask> {
        const task = await db.humanTask.update({
            where: { id },
            data: {
                status: 'rejected',
                outputs: reason ? JSON.stringify({ rejection_reason: reason }) : undefined,
                updated_at: new Date()
            }
        });
        return this.mapToDomain(task);
    }

    /**
     * Get pending tasks by role (Sorted by Priority)
     */
    static async get_pending_by_role(role_id: string): Promise<HumanTask[]> {
        const tasks = await db.humanTask.findMany({
            where: {
                role_id,
                status: 'pending'
            }
        });

        // Sort in memory: Critical > High > Normal > Low, then Oldest first
        const priorityOrder: Record<string, number> = {
            'critical': 0,
            'high': 1,
            'normal': 2,
            'low': 3
        };

        const sortedTasks = tasks.sort((a, b) => {
            const pA = priorityOrder[a.priority] ?? 2;
            const pB = priorityOrder[b.priority] ?? 2;
            if (pA !== pB) return pA - pB;
            return a.created_at.getTime() - b.created_at.getTime();
        });

        return sortedTasks.map(this.mapToDomain);
    }
}
