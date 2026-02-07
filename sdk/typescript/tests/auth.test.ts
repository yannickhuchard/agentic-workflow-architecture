/**
 * AWA Auth and Logger Tests
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
    create_jwt,
    verify_jwt,
    create_auth_middleware,
    require_role,
    require_permission,
    create_rate_limiter,
    AuthConfig,
    AuthUser
} from '../src/server/auth';
import {
    Logger,
    get_logger,
    set_logger,
    LogLevel
} from '../src/server/logger';

describe('JWT', () => {
    const secret = 'test-secret-key-12345';

    it('should create and verify a valid JWT', () => {
        const payload = {
            sub: 'user-123',
            role: 'admin',
            permissions: ['read', 'write']
        };

        const token = create_jwt(payload, secret);
        expect(token).toBeDefined();
        expect(token.split('.')).toHaveLength(3);

        const verified = verify_jwt(token, secret);
        expect(verified).not.toBeNull();
        expect(verified?.sub).toBe('user-123');
        expect(verified?.role).toBe('admin');
        expect(verified?.permissions).toEqual(['read', 'write']);
    });

    it('should reject token with wrong secret', () => {
        const token = create_jwt({ sub: 'user', role: 'admin', permissions: [] }, secret);
        const verified = verify_jwt(token, 'wrong-secret');
        expect(verified).toBeNull();
    });

    it('should reject expired token', () => {
        const token = create_jwt(
            { sub: 'user', role: 'admin', permissions: [] },
            secret,
            -1000 // Already expired
        );
        const verified = verify_jwt(token, secret);
        expect(verified).toBeNull();
    });

    it('should reject malformed token', () => {
        expect(verify_jwt('not.a.valid.token', secret)).toBeNull();
        expect(verify_jwt('invalid', secret)).toBeNull();
        expect(verify_jwt('', secret)).toBeNull();
    });
});

describe('Auth Middleware', () => {
    const create_mock_request = (overrides: any = {}) => ({
        headers: {},
        path: '/api/test',
        ...overrides
    });

    const create_mock_response = () => {
        const res: any = {
            statusCode: 200,
            headers: {},
            status: vi.fn().mockReturnThis(),
            json: vi.fn().mockReturnThis(),
            setHeader: vi.fn()
        };
        return res;
    };

    it('should skip auth when disabled', () => {
        const middleware = create_auth_middleware({ enabled: false });
        const req = create_mock_request();
        const res = create_mock_response();
        const next = vi.fn();

        middleware(req as any, res as any, next);

        expect(next).toHaveBeenCalled();
        expect(res.status).not.toHaveBeenCalled();
    });

    it('should allow public paths', () => {
        const config: AuthConfig = {
            enabled: true,
            public_paths: ['/health', '/api/public']
        };
        const middleware = create_auth_middleware(config);

        const req = create_mock_request({ path: '/health' });
        const res = create_mock_response();
        const next = vi.fn();

        middleware(req as any, res as any, next);
        expect(next).toHaveBeenCalled();
    });

    it('should authenticate with API key', () => {
        const config: AuthConfig = {
            enabled: true,
            api_keys: {
                'valid-key': { id: 'user-1', role: 'admin', permissions: ['*'] }
            }
        };
        const middleware = create_auth_middleware(config);

        const req = create_mock_request({
            headers: { 'x-api-key': 'valid-key' }
        });
        const res = create_mock_response();
        const next = vi.fn();

        middleware(req as any, res as any, next);

        expect(next).toHaveBeenCalled();
        expect(req.user).toBeDefined();
        expect(req.user.id).toBe('user-1');
    });

    it('should reject invalid API key', () => {
        const config: AuthConfig = {
            enabled: true,
            api_keys: {
                'valid-key': { id: 'user-1', role: 'admin', permissions: [] }
            }
        };
        const middleware = create_auth_middleware(config);

        const req = create_mock_request({
            headers: { 'x-api-key': 'invalid-key' }
        });
        const res = create_mock_response();
        const next = vi.fn();

        middleware(req as any, res as any, next);

        expect(next).not.toHaveBeenCalled();
        expect(res.status).toHaveBeenCalledWith(401);
    });
});

describe('RBAC Middleware', () => {
    it('should allow matching role', () => {
        const middleware = require_role('admin', 'operator');
        const req: any = { user: { id: 'u1', role: 'admin', permissions: [] } };
        const res: any = { status: vi.fn().mockReturnThis(), json: vi.fn() };
        const next = vi.fn();

        middleware(req, res, next);
        expect(next).toHaveBeenCalled();
    });

    it('should reject non-matching role', () => {
        const middleware = require_role('admin');
        const req: any = { user: { id: 'u1', role: 'viewer', permissions: [] } };
        const res: any = { status: vi.fn().mockReturnThis(), json: vi.fn() };
        const next = vi.fn();

        middleware(req, res, next);
        expect(res.status).toHaveBeenCalledWith(403);
    });
});

describe('Permission Middleware', () => {
    it('should allow with matching permissions', () => {
        const middleware = require_permission('workflows:read', 'workflows:write');
        const req: any = {
            user: { id: 'u1', role: 'admin', permissions: ['workflows:read', 'workflows:write'] }
        };
        const res: any = { status: vi.fn().mockReturnThis(), json: vi.fn() };
        const next = vi.fn();

        middleware(req, res, next);
        expect(next).toHaveBeenCalled();
    });

    it('should allow wildcard permission', () => {
        const middleware = require_permission('anything:read');
        const req: any = {
            user: { id: 'u1', role: 'admin', permissions: ['*'] }
        };
        const res: any = { status: vi.fn().mockReturnThis(), json: vi.fn() };
        const next = vi.fn();

        middleware(req, res, next);
        expect(next).toHaveBeenCalled();
    });
});

describe('Logger', () => {
    it('should create logger with defaults', () => {
        const logger = new Logger();
        expect(logger).toBeDefined();
    });

    it('should respect log levels', () => {
        const output = vi.fn();
        const logger = new Logger({ level: 'warn', output });

        logger.debug('should not log');
        logger.info('should not log');
        logger.warn('should log');
        logger.error('should log');

        expect(output).toHaveBeenCalledTimes(2);
    });

    it('should generate correlation IDs', () => {
        const logger = new Logger();
        const id = logger.generate_correlation_id();

        expect(id).toBeDefined();
        expect(logger.get_correlation_id()).toBe(id);
    });

    it('should create child loggers with context', () => {
        const output = vi.fn();
        const parent = new Logger({ level: 'info', output });
        parent.set_correlation_id('corr-123');

        const child = parent.child({ workflow_id: 'wf-1' });
        child.info('test');

        expect(output).toHaveBeenCalledWith(expect.objectContaining({
            correlation_id: 'corr-123',
            workflow_id: 'wf-1',
            message: 'test'
        }));
    });
});

describe('Rate Limiter', () => {
    it('should allow requests under limit', () => {
        const limiter = create_rate_limiter({ window_ms: 60000, max_requests: 5 });
        const req: any = { user: { id: 'user1' }, ip: '127.0.0.1' };
        const res: any = { setHeader: vi.fn(), status: vi.fn().mockReturnThis(), json: vi.fn() };
        const next = vi.fn();

        for (let i = 0; i < 5; i++) {
            limiter(req, res, next);
        }

        expect(next).toHaveBeenCalledTimes(5);
        expect(res.status).not.toHaveBeenCalled();
    });

    it('should block requests over limit', () => {
        const limiter = create_rate_limiter({ window_ms: 60000, max_requests: 2 });
        const req: any = { user: { id: 'user2' }, ip: '127.0.0.2' };
        const res: any = { setHeader: vi.fn(), status: vi.fn().mockReturnThis(), json: vi.fn() };
        const next = vi.fn();

        limiter(req, res, next);
        limiter(req, res, next);
        limiter(req, res, next); // Should be blocked

        expect(next).toHaveBeenCalledTimes(2);
        expect(res.status).toHaveBeenCalledWith(429);
    });
});
