import express from 'express';
import cors from 'cors';
import { workflowRouter } from './routes/workflows';
import { humanTaskRouter } from './routes/human_tasks';
import { journeyRouter, measuresRouter } from './routes/journeys';
import {
    create_auth_middleware,
    create_rate_limiter,
    AuthConfig
} from './auth';
import { Logger, get_logger, create_logger_from_env } from './logger';
import { view_directory } from '../runtime/views';

export interface ServerConfig {
    /** Authentication configuration */
    auth?: AuthConfig;
    /** Enable rate limiting */
    rate_limit?: {
        window_ms: number;
        max_requests: number;
    };
    /** Custom logger */
    logger?: Logger;
    /** Enable request logging */
    request_logging?: boolean;
}

export const createServer = (config: ServerConfig = {}) => {
    const app = express();
    const logger = config.logger || create_logger_from_env();

    app.use(cors());
    app.use(express.json());

    // Add correlation ID and request logging
    if (config.request_logging !== false) {
        app.use((req, res, next) => {
            const correlation_id = req.headers['x-correlation-id'] as string ||
                `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
            req.correlation_id = correlation_id;
            res.setHeader('X-Correlation-ID', correlation_id);

            const start = Date.now();
            res.on('finish', () => {
                logger.info(`${req.method} ${req.path}`, {
                    status: res.statusCode,
                    duration_ms: Date.now() - start,
                    correlation_id
                });
            });
            next();
        });
    }

    // Add authentication middleware
    if (config.auth) {
        app.use(create_auth_middleware(config.auth));
    }

    // Add rate limiting
    if (config.rate_limit) {
        app.use(create_rate_limiter(config.rate_limit));
    }

    // API routes
    app.use('/api/v1/workflows', workflowRouter);
    app.use('/api/v1/tasks', humanTaskRouter);
    app.use('/api/v1/journeys', journeyRouter);
    app.use('/api/v1/measures', measuresRouter);

    // The views that come with the SDK: /views/dashboard.html?live=<this server> and /views/journey.html?live=<this server>
    try {
        app.use('/views', express.static(view_directory(), { index: false, setHeaders: res => { res.setHeader('X-Content-Type-Options', 'nosniff'); res.setHeader('Cache-Control', 'no-cache'); } }));
    } catch { /* this copy of the SDK was built without them */ }

    // Health check (always public)
    app.get('/health', (req, res) => {
        res.json({ status: 'ok', timestamp: new Date().toISOString() });
    });

    return app;
};

// Re-export auth utilities
export * from './auth';
export * from './logger';
