/**
 * AWA Structured Logger
 * Production-ready logging with JSON output, log levels, and correlation IDs
 */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface LogEntry {
    timestamp: string;
    level: LogLevel;
    message: string;
    correlation_id?: string;
    workflow_id?: string;
    activity_id?: string;
    token_id?: string;
    duration_ms?: number;
    error?: {
        message: string;
        stack?: string;
        code?: string;
    };
    metadata?: Record<string, unknown>;
}

export interface LoggerConfig {
    /** Minimum log level to output */
    level: LogLevel;
    /** Output format: 'json' for structured, 'text' for human-readable */
    format: 'json' | 'text';
    /** Include timestamps */
    timestamps: boolean;
    /** Custom output function (defaults to console) */
    output?: (entry: LogEntry) => void;
}

const LOG_LEVEL_PRIORITY: Record<LogLevel, number> = {
    debug: 0,
    info: 1,
    warn: 2,
    error: 3
};

const LOG_LEVEL_COLORS: Record<LogLevel, string> = {
    debug: '\x1b[36m',  // Cyan
    info: '\x1b[32m',   // Green
    warn: '\x1b[33m',   // Yellow
    error: '\x1b[31m'   // Red
};

const RESET_COLOR = '\x1b[0m';

/**
 * Structured Logger for AWA
 */
export class Logger {
    private config: LoggerConfig;
    private correlation_id?: string;
    private context: Record<string, unknown> = {};

    constructor(config: Partial<LoggerConfig> = {}) {
        this.config = {
            level: config.level ?? 'info',
            format: config.format ?? 'json',
            timestamps: config.timestamps ?? true,
            output: config.output
        };
    }

    /**
     * Create a child logger with additional context
     */
    child(context: Record<string, unknown>): Logger {
        const child = new Logger(this.config);
        child.context = { ...this.context, ...context };
        child.correlation_id = this.correlation_id;
        return child;
    }

    /**
     * Set correlation ID for request tracing
     */
    set_correlation_id(id: string): void {
        this.correlation_id = id;
    }

    /**
     * Get current correlation ID
     */
    get_correlation_id(): string | undefined {
        return this.correlation_id;
    }

    /**
     * Generate new correlation ID
     */
    generate_correlation_id(): string {
        this.correlation_id = `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
        return this.correlation_id;
    }

    /**
     * Check if a log level should be output
     */
    private should_log(level: LogLevel): boolean {
        return LOG_LEVEL_PRIORITY[level] >= LOG_LEVEL_PRIORITY[this.config.level];
    }

    /**
     * Format and output a log entry
     */
    private log(level: LogLevel, message: string, metadata?: Record<string, unknown>): void {
        if (!this.should_log(level)) return;

        const entry: LogEntry = {
            timestamp: this.config.timestamps ? new Date().toISOString() : '',
            level,
            message,
            correlation_id: this.correlation_id,
            ...this.context,
            metadata
        };

        if (this.config.output) {
            this.config.output(entry);
            return;
        }

        if (this.config.format === 'json') {
            // Clean up empty fields
            const clean_entry = Object.fromEntries(
                Object.entries(entry).filter(([_, v]) => v !== undefined && v !== '')
            );
            console.log(JSON.stringify(clean_entry));
        } else {
            this.log_text(entry);
        }
    }

    /**
     * Human-readable text format
     */
    private log_text(entry: LogEntry): void {
        const color = LOG_LEVEL_COLORS[entry.level];
        const parts: string[] = [];

        if (entry.timestamp) {
            parts.push(`[${entry.timestamp}]`);
        }

        parts.push(`${color}${entry.level.toUpperCase().padEnd(5)}${RESET_COLOR}`);

        if (entry.correlation_id) {
            parts.push(`[${entry.correlation_id}]`);
        }

        parts.push(entry.message);

        if (entry.metadata && Object.keys(entry.metadata).length > 0) {
            parts.push(JSON.stringify(entry.metadata));
        }

        console.log(parts.join(' '));

        if (entry.error?.stack) {
            console.log(entry.error.stack);
        }
    }

    // Log level methods
    debug(message: string, metadata?: Record<string, unknown>): void {
        this.log('debug', message, metadata);
    }

    info(message: string, metadata?: Record<string, unknown>): void {
        this.log('info', message, metadata);
    }

    warn(message: string, metadata?: Record<string, unknown>): void {
        this.log('warn', message, metadata);
    }

    error(message: string, error?: Error | unknown, metadata?: Record<string, unknown>): void {
        const error_info = error instanceof Error ? {
            message: error.message,
            stack: error.stack,
            code: (error as any).code
        } : error ? { message: String(error) } : undefined;

        this.log('error', message, {
            ...metadata,
            error: error_info
        });
    }

    /**
     * Log workflow event
     */
    workflow(event: string, workflow_id: string, metadata?: Record<string, unknown>): void {
        this.info(`[Workflow] ${event}`, { workflow_id, ...metadata });
    }

    /**
     * Log activity event
     */
    activity(event: string, activity_id: string, metadata?: Record<string, unknown>): void {
        this.info(`[Activity] ${event}`, { activity_id, ...metadata });
    }

    /**
     * Log with timing
     */
    timed<T>(label: string, fn: () => T): T {
        const start = Date.now();
        try {
            const result = fn();
            this.debug(`${label} completed`, { duration_ms: Date.now() - start });
            return result;
        } catch (error) {
            this.error(`${label} failed`, error, { duration_ms: Date.now() - start });
            throw error;
        }
    }

    /**
     * Async version of timed
     */
    async timed_async<T>(label: string, fn: () => Promise<T>): Promise<T> {
        const start = Date.now();
        try {
            const result = await fn();
            this.debug(`${label} completed`, { duration_ms: Date.now() - start });
            return result;
        } catch (error) {
            this.error(`${label} failed`, error, { duration_ms: Date.now() - start });
            throw error;
        }
    }
}

// Global logger instance
let global_logger: Logger | undefined;

/**
 * Get the global logger instance
 */
export function get_logger(): Logger {
    if (!global_logger) {
        global_logger = new Logger({
            level: (process.env.LOG_LEVEL as LogLevel) || 'info',
            format: process.env.LOG_FORMAT === 'text' ? 'text' : 'json'
        });
    }
    return global_logger;
}

/**
 * Set the global logger instance
 */
export function set_logger(logger: Logger): void {
    global_logger = logger;
}

/**
 * Create a logger from environment config
 */
export function create_logger_from_env(): Logger {
    return new Logger({
        level: (process.env.LOG_LEVEL as LogLevel) || 'info',
        format: process.env.LOG_FORMAT === 'text' ? 'text' : 'json',
        timestamps: process.env.LOG_TIMESTAMPS !== 'false'
    });
}
