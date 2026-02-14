import { PrismaClient } from '@prisma/client';
import { UUID } from '../types';

export interface ExecutionMetrics {
    workflow_id: UUID;
    workflow_name: string;
    status: 'completed' | 'failed';
    started_at: Date;
    completed_at: Date;
    duration_ms: number;
    input_tokens: number;
    output_tokens: number;
    total_tokens: number;
    execution_cost: number;
    currency: string;
    steps_count: number;
    user_id?: string;
    metadata?: Record<string, unknown>;
}

export interface ExecutionLogger {
    log_execution(metrics: ExecutionMetrics): Promise<void>;
}

export class PrismaExecutionLogger implements ExecutionLogger {
    private prisma: PrismaClient;

    constructor() {
        this.prisma = new PrismaClient();
    }

    async log_execution(metrics: ExecutionMetrics): Promise<void> {
        try {
            await this.prisma.workflowExecution.create({
                data: {
                    workflow_id: metrics.workflow_id,
                    workflow_name: metrics.workflow_name,
                    status: metrics.status,
                    started_at: metrics.started_at,
                    completed_at: metrics.completed_at,
                    duration_ms: metrics.duration_ms,
                    input_tokens: metrics.input_tokens,
                    output_tokens: metrics.output_tokens,
                    total_tokens: metrics.total_tokens,
                    execution_cost: metrics.execution_cost,
                    currency: metrics.currency,
                    steps_count: metrics.steps_count,
                    user_id: metrics.user_id,
                    metadata: metrics.metadata ? JSON.stringify(metrics.metadata) : undefined
                }
            });
        } catch (error) {
            console.error('[ExecutionLogger] Failed to log execution metrics:', error);
            // We don't want to throw here to avoid failing the workflow execution just because logging failed
        }
    }
}

export class ConsoleExecutionLogger implements ExecutionLogger {
    async log_execution(metrics: ExecutionMetrics): Promise<void> {
        console.log('--- Workflow Execution Metrics ---');
        console.log(`Workflow: ${metrics.workflow_name} (${metrics.workflow_id})`);
        console.log(`Status: ${metrics.status}`);
        console.log(`Duration: ${metrics.duration_ms}ms`);
        console.log(`Steps: ${metrics.steps_count}`);
        console.log(`Tokens: ${metrics.total_tokens} (In: ${metrics.input_tokens}, Out: ${metrics.output_tokens})`);
        console.log(`Cost: ${metrics.currency} ${metrics.execution_cost.toFixed(6)}`);
        console.log('----------------------------------');
    }
}

let global_execution_logger: ExecutionLogger | undefined;

export function get_execution_logger(): ExecutionLogger {
    if (!global_execution_logger) {
        global_execution_logger = new ConsoleExecutionLogger();
    }
    return global_execution_logger;
}
