import { Command } from 'commander';
import { TaskService } from '../../runtime/services/task_service';

export const taskCommand = new Command('task')
    .description('Manage human tasks');

taskCommand.command('list')
    .description('List tasks')
    .option('-s, --status <status>', 'Filter by status (pending, assigned, in_progress, completed, rejected)', 'pending')
    .option('-r, --role <role>', 'Filter by role')
    .option('-a, --assignee <assignee>', 'Filter by assignee')
    .action(async (options) => {
        try {
            const tasks = await TaskService.list({
                status: options.status,
                role_id: options.role,
                assignee_id: options.assignee
            });

            if (tasks.length === 0) {
                console.log('No tasks found.');
                return;
            }

            console.table(tasks.map(t => ({
                ID: t.id,
                Activity: t.activity_name,
                Status: t.status,
                Priority: t.priority,
                Created: new Date(t.created_at).toLocaleString()
            })));
        } catch (error: any) {
            console.error('Error listing tasks:', error.message);
        }
    });

taskCommand.command('show <id>')
    .description('Show task details')
    .action(async (id) => {
        try {
            const task = await TaskService.get(id);
            if (!task) {
                console.error(`Task ${id} not found.`);
                return;
            }

            console.log('Task Details:');
            console.log('----------------------------------------');
            console.log(`ID:        ${task.id}`);
            console.log(`Activity:  ${task.activity_name}`);
            console.log(`Status:    ${task.status}`);
            console.log(`Priority:  ${task.priority}`);
            console.log(`Queue:     ${task.role_id}`);
            console.log(`Created:   ${new Date(task.created_at).toLocaleString()}`);
            if (task.assignee_id) console.log(`Assignee:  ${task.assignee_id}`);
            if (task.description) console.log(`Desc:      ${task.description}`);
            console.log('----------------------------------------');
            console.log('Inputs:');
            console.log(JSON.stringify(task.inputs, null, 2));
            if (task.outputs) {
                console.log('----------------------------------------');
                console.log('Outputs:');
                console.log(JSON.stringify(task.outputs, null, 2));
            }
        } catch (error: any) {
            console.error('Error fetching task:', error.message);
        }
    });

taskCommand.command('assign <id> <user_id>')
    .description('Assign a task to a user')
    .action(async (id, user_id) => {
        try {
            const task = await TaskService.assign(id, user_id);
            console.log(`Task ${id} assigned to ${user_id}`);
            console.log(`New Status: ${task.status}`);
        } catch (error: any) {
            console.error('Error assigning task:', error.message);
        }
    });

taskCommand.command('complete <id> [json_outputs]')
    .description('Complete a task with optional JSON outputs')
    .action(async (id, json_outputs) => {
        try {
            let outputs = {};
            if (json_outputs) {
                try {
                    outputs = JSON.parse(json_outputs);
                } catch (e) {
                    console.error('Invalid JSON outputs');
                    return;
                }
            }

            const task = await TaskService.complete(id, outputs);
            console.log(`Task ${id} completed.`);
        } catch (error: any) {
            console.error('Error completing task:', error.message);
        }
    });

taskCommand.command('reject <id> [reason]')
    .description('Reject a task')
    .action(async (id, reason) => {
        try {
            const task = await TaskService.reject(id, reason);
            console.log(`Task ${id} rejected.`);
        } catch (error: any) {
            console.error('Error rejecting task:', error.message);
        }
    });
