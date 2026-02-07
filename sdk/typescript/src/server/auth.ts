/**
 * AWA Authentication Middleware
 * JWT and API key authentication for the REST API
 */

import { Request, Response, NextFunction } from 'express';
import crypto from 'crypto';
import { get_logger } from './logger';

const logger = get_logger();

export interface AuthUser {
    id: string;
    role: 'admin' | 'operator' | 'viewer';
    permissions: string[];
}

export interface AuthConfig {
    /** Enable authentication (default: false for development) */
    enabled: boolean;
    /** JWT secret for token verification */
    jwt_secret?: string;
    /** Valid API keys (key -> user mapping) */
    api_keys?: Record<string, AuthUser>;
    /** Allow unauthenticated access to specific paths */
    public_paths?: string[];
}

// Simple JWT implementation (production should use jsonwebtoken package)
interface JWTPayload {
    sub: string;      // Subject (user ID)
    role: string;     // User role
    permissions: string[];
    iat: number;      // Issued at
    exp: number;      // Expiration
}

/**
 * Create a simple JWT token
 */
export function create_jwt(payload: Omit<JWTPayload, 'iat' | 'exp'>, secret: string, expires_in_ms: number = 3600000): string {
    const now = Date.now();
    const full_payload: JWTPayload = {
        ...payload,
        iat: now,
        exp: now + expires_in_ms
    };

    const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
    const body = Buffer.from(JSON.stringify(full_payload)).toString('base64url');
    const signature = crypto
        .createHmac('sha256', secret)
        .update(`${header}.${body}`)
        .digest('base64url');

    return `${header}.${body}.${signature}`;
}

/**
 * Verify and decode a JWT token
 */
export function verify_jwt(token: string, secret: string): JWTPayload | null {
    try {
        const parts = token.split('.');
        if (parts.length !== 3) return null;

        const [header, body, signature] = parts;

        // Verify signature
        const expected_signature = crypto
            .createHmac('sha256', secret)
            .update(`${header}.${body}`)
            .digest('base64url');

        if (signature !== expected_signature) {
            logger.warn('JWT signature verification failed');
            return null;
        }

        const payload: JWTPayload = JSON.parse(Buffer.from(body, 'base64url').toString());

        // Check expiration
        if (payload.exp && payload.exp < Date.now()) {
            logger.warn('JWT token expired', { sub: payload.sub, exp: payload.exp });
            return null;
        }

        return payload;
    } catch (error) {
        logger.error('JWT verification error', error);
        return null;
    }
}

/**
 * Extend Express Request with auth info
 */
declare global {
    namespace Express {
        interface Request {
            user?: AuthUser;
            correlation_id?: string;
        }
    }
}

/**
 * Create authentication middleware
 */
export function create_auth_middleware(config: AuthConfig) {
    return (req: Request, res: Response, next: NextFunction) => {
        // Generate correlation ID for request tracing
        req.correlation_id = req.headers['x-correlation-id'] as string ||
            `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

        // Skip auth if disabled
        if (!config.enabled) {
            return next();
        }

        // Check if path is public
        if (config.public_paths?.some(p => req.path.startsWith(p))) {
            return next();
        }

        // Try API key authentication first
        const api_key = req.headers['x-api-key'] as string;
        if (api_key && config.api_keys) {
            const user = config.api_keys[api_key];
            if (user) {
                req.user = user;
                logger.debug('API key authentication successful', { user_id: user.id });
                return next();
            }
        }

        // Try JWT authentication
        const auth_header = req.headers.authorization;
        if (auth_header?.startsWith('Bearer ')) {
            const token = auth_header.slice(7);

            if (!config.jwt_secret) {
                logger.error('JWT secret not configured');
                return res.status(500).json({ error: 'Authentication not properly configured' });
            }

            const payload = verify_jwt(token, config.jwt_secret);
            if (payload) {
                req.user = {
                    id: payload.sub,
                    role: payload.role as AuthUser['role'],
                    permissions: payload.permissions
                };
                logger.debug('JWT authentication successful', { user_id: payload.sub });
                return next();
            }
        }

        // No valid auth found
        logger.warn('Authentication failed', {
            path: req.path,
            has_api_key: !!api_key,
            has_auth_header: !!auth_header
        });

        return res.status(401).json({
            error: 'Unauthorized',
            message: 'Valid API key or JWT token required'
        });
    };
}

/**
 * Create RBAC (Role-Based Access Control) middleware
 */
export function require_role(...allowed_roles: AuthUser['role'][]) {
    return (req: Request, res: Response, next: NextFunction) => {
        if (!req.user) {
            return res.status(401).json({ error: 'Unauthorized' });
        }

        if (!allowed_roles.includes(req.user.role)) {
            logger.warn('Access denied - insufficient role', {
                user_id: req.user.id,
                user_role: req.user.role,
                required_roles: allowed_roles
            });
            return res.status(403).json({
                error: 'Forbidden',
                message: `Required role: ${allowed_roles.join(' or ')}`
            });
        }

        next();
    };
}

/**
 * Create permission check middleware
 */
export function require_permission(...required_permissions: string[]) {
    return (req: Request, res: Response, next: NextFunction) => {
        if (!req.user) {
            return res.status(401).json({ error: 'Unauthorized' });
        }

        const has_all = required_permissions.every(p =>
            req.user!.permissions.includes(p) || req.user!.permissions.includes('*')
        );

        if (!has_all) {
            logger.warn('Access denied - insufficient permissions', {
                user_id: req.user.id,
                user_permissions: req.user.permissions,
                required_permissions
            });
            return res.status(403).json({
                error: 'Forbidden',
                message: `Required permissions: ${required_permissions.join(', ')}`
            });
        }

        next();
    };
}

/**
 * Rate limiting middleware
 */
export function create_rate_limiter(options: {
    window_ms: number;
    max_requests: number;
}) {
    const requests = new Map<string, { count: number; reset_at: number }>();

    return (req: Request, res: Response, next: NextFunction) => {
        const key = req.user?.id || req.ip || 'anonymous';
        const now = Date.now();

        let record = requests.get(key);
        if (!record || record.reset_at < now) {
            record = { count: 0, reset_at: now + options.window_ms };
            requests.set(key, record);
        }

        record.count++;

        res.setHeader('X-RateLimit-Limit', options.max_requests);
        res.setHeader('X-RateLimit-Remaining', Math.max(0, options.max_requests - record.count));
        res.setHeader('X-RateLimit-Reset', record.reset_at);

        if (record.count > options.max_requests) {
            logger.warn('Rate limit exceeded', { key, count: record.count });
            return res.status(429).json({
                error: 'Too Many Requests',
                retry_after: Math.ceil((record.reset_at - now) / 1000)
            });
        }

        next();
    };
}
