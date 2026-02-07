/**
 * AWA Retry Logic and Error Recovery
 * Exponential backoff, dead letter queue, and error handling
 */

import { UUID } from '../types';
import { Token } from '../runtime/token';
import { get_logger, Logger } from '../server/logger';

export interface RetryConfig {
    /** Maximum number of retry attempts */
    max_retries: number;
    /** Initial delay in milliseconds */
    initial_delay_ms: number;
    /** Maximum delay in milliseconds */
    max_delay_ms: number;
    /** Backoff multiplier (e.g., 2 for doubling) */
    backoff_multiplier: number;
    /** Add random jitter to prevent thundering herd */
    jitter: boolean;
    /** Errors that should not trigger retry */
    non_retryable_errors?: string[];
}

export interface RetryState {
    attempt: number;
    last_error?: Error;
    next_retry_at?: number;
    started_at: number;
}

export interface DeadLetterEntry {
    id: UUID;
    token: Token;
    workflow_id: UUID;
    activity_id: UUID;
    error: {
        message: string;
        stack?: string;
        code?: string;
    };
    retry_state: RetryState;
    created_at: string;
    metadata?: Record<string, unknown>;
}

/**
 * Default retry configuration
 */
export const DEFAULT_RETRY_CONFIG: RetryConfig = {
    max_retries: 3,
    initial_delay_ms: 1000,
    max_delay_ms: 30000,
    backoff_multiplier: 2,
    jitter: true,
    non_retryable_errors: [
        'VALIDATION_ERROR',
        'AUTHENTICATION_ERROR',
        'PERMISSION_DENIED',
        'NOT_FOUND'
    ]
};

/**
 * Calculate delay for next retry attempt with exponential backoff
 */
export function calculate_retry_delay(config: RetryConfig, attempt: number): number {
    // Exponential backoff: initial * multiplier^attempt
    let delay = config.initial_delay_ms * Math.pow(config.backoff_multiplier, attempt);

    // Cap at maximum delay
    delay = Math.min(delay, config.max_delay_ms);

    // Add jitter (±25%)
    if (config.jitter) {
        const jitter_range = delay * 0.25;
        delay += (Math.random() * jitter_range * 2) - jitter_range;
    }

    return Math.round(delay);
}

/**
 * Check if an error is retryable
 */
export function is_retryable_error(error: Error, config: RetryConfig): boolean {
    const error_code = (error as any).code;

    // Check against non-retryable error codes
    if (error_code && config.non_retryable_errors?.includes(error_code)) {
        return false;
    }

    // Check against non-retryable error messages
    const non_retryable_patterns = [
        /validation/i,
        /invalid/i,
        /unauthorized/i,
        /forbidden/i,
        /not found/i,
        /permission/i
    ];

    for (const pattern of non_retryable_patterns) {
        if (pattern.test(error.message)) {
            return false;
        }
    }

    return true;
}

/**
 * Sleep utility for retry delays
 */
export function sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Retry a function with exponential backoff
 */
export async function with_retry<T>(
    fn: () => Promise<T>,
    config: Partial<RetryConfig> = {},
    logger?: Logger
): Promise<T> {
    const full_config = { ...DEFAULT_RETRY_CONFIG, ...config };
    const log = logger || get_logger();

    let last_error: Error | undefined;

    for (let attempt = 0; attempt <= full_config.max_retries; attempt++) {
        try {
            return await fn();
        } catch (error) {
            last_error = error instanceof Error ? error : new Error(String(error));

            // Check if we should retry
            if (attempt >= full_config.max_retries) {
                log.error(`All ${full_config.max_retries} retry attempts exhausted`, last_error, { attempt });
                throw last_error;
            }

            if (!is_retryable_error(last_error, full_config)) {
                log.warn('Error is not retryable', { error: last_error.message });
                throw last_error;
            }

            const delay = calculate_retry_delay(full_config, attempt);
            log.warn(`Retry attempt ${attempt + 1}/${full_config.max_retries} after ${delay}ms`, {
                error: last_error.message,
                attempt: attempt + 1,
                delay_ms: delay
            });

            await sleep(delay);
        }
    }

    throw last_error;
}

/**
 * Dead Letter Queue for failed tokens
 */
export class DeadLetterQueue {
    private entries: Map<UUID, DeadLetterEntry> = new Map();
    private logger: Logger;

    constructor(logger?: Logger) {
        this.logger = logger || get_logger();
    }

    /**
     * Add a failed token to the dead letter queue
     */
    add(
        token: Token,
        workflow_id: UUID,
        activity_id: UUID,
        error: Error,
        retry_state: RetryState,
        metadata?: Record<string, unknown>
    ): DeadLetterEntry {
        const entry: DeadLetterEntry = {
            id: token.id,
            token,
            workflow_id,
            activity_id,
            error: {
                message: error.message,
                stack: error.stack,
                code: (error as any).code
            },
            retry_state,
            created_at: new Date().toISOString(),
            metadata
        };

        this.entries.set(token.id, entry);
        this.logger.error('Token added to dead letter queue', error, {
            token_id: token.id,
            workflow_id,
            activity_id,
            attempts: retry_state.attempt
        });

        return entry;
    }

    /**
     * Get an entry by token ID
     */
    get(token_id: UUID): DeadLetterEntry | undefined {
        return this.entries.get(token_id);
    }

    /**
     * List all entries
     */
    list(): DeadLetterEntry[] {
        return Array.from(this.entries.values());
    }

    /**
     * List entries by workflow
     */
    list_by_workflow(workflow_id: UUID): DeadLetterEntry[] {
        return this.list().filter(e => e.workflow_id === workflow_id);
    }

    /**
     * Remove an entry (e.g., after manual resolution)
     */
    remove(token_id: UUID): boolean {
        const removed = this.entries.delete(token_id);
        if (removed) {
            this.logger.info('Token removed from dead letter queue', { token_id });
        }
        return removed;
    }

    /**
     * Clear all entries
     */
    clear(): number {
        const count = this.entries.size;
        this.entries.clear();
        this.logger.info('Dead letter queue cleared', { count });
        return count;
    }

    /**
     * Get queue statistics
     */
    stats(): { total: number; by_workflow: Record<UUID, number> } {
        const by_workflow: Record<UUID, number> = {};
        for (const entry of this.entries.values()) {
            by_workflow[entry.workflow_id] = (by_workflow[entry.workflow_id] || 0) + 1;
        }
        return { total: this.entries.size, by_workflow };
    }
}

// Global dead letter queue
let global_dlq: DeadLetterQueue | undefined;

/**
 * Get the global dead letter queue
 */
export function get_dead_letter_queue(): DeadLetterQueue {
    if (!global_dlq) {
        global_dlq = new DeadLetterQueue();
    }
    return global_dlq;
}

/**
 * Set a custom dead letter queue
 */
export function set_dead_letter_queue(dlq: DeadLetterQueue): void {
    global_dlq = dlq;
}

/**
 * Create a retryable wrapper for an activity executor
 */
export function create_retryable_executor<T>(
    executor: () => Promise<T>,
    config?: Partial<RetryConfig>,
    on_retry?: (attempt: number, error: Error) => void
): () => Promise<T> {
    return async () => {
        const full_config = { ...DEFAULT_RETRY_CONFIG, ...config };
        const logger = get_logger();

        let last_error: Error | undefined;

        for (let attempt = 0; attempt <= full_config.max_retries; attempt++) {
            try {
                return await executor();
            } catch (error) {
                last_error = error instanceof Error ? error : new Error(String(error));

                if (attempt >= full_config.max_retries || !is_retryable_error(last_error, full_config)) {
                    throw last_error;
                }

                if (on_retry) {
                    on_retry(attempt + 1, last_error);
                }

                const delay = calculate_retry_delay(full_config, attempt);
                logger.debug(`Retry ${attempt + 1}/${full_config.max_retries}`, { delay_ms: delay });
                await sleep(delay);
            }
        }

        throw last_error;
    };
}
