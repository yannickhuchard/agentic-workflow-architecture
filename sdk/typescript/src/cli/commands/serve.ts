import { Command } from 'commander';
import { createServer, AuthConfig } from '../../server';

export const serveCommand = new Command('serve')
    .description('Start the AWA Operational API Server')
    .option('-p, --port <port>', 'Port to listen on', '3000')
    .option('--jwt-secret <secret>', 'JWT secret for authentication (or use JWT_SECRET env var)')
    .option('--api-key <key>', 'API key for authentication (format: key:role, can be repeated)', collectApiKeys, {})
    .option('--rate-limit <max>', 'Max requests per minute (0 to disable)', '0')
    .option('--no-auth', 'Disable authentication')
    .action(async (options) => {
        try {
            const port = parseInt(options.port, 10);
            const jwtSecret = options.jwtSecret || process.env.JWT_SECRET;
            const rateLimit = parseInt(options.rateLimit, 10);

            // Import DB to ensure connection (lazy init, but we can log)
            // In a real scenario we might want to run migrations here or check connection
            console.log('Initializing database connection...');
            // The db instance is imported in the routes/services, so it will be initialized when needed.
            // For now, we trust the lazy connection.

            // Build auth config
            const authConfig: Partial<AuthConfig> = {
                enabled: options.auth !== false && (!!jwtSecret || Object.keys(options.apiKey).length > 0),
                jwt_secret: jwtSecret,
                api_keys: options.apiKey,
                public_paths: ['/health']
            };

            const app = createServer({
                auth: authConfig.enabled ? authConfig as AuthConfig : undefined,
                rate_limit: rateLimit > 0 ? { window_ms: 60000, max_requests: rateLimit } : undefined,
                request_logging: true
            });

            app.listen(port, () => {
                console.log(`AWA Operational API running on http://localhost:${port}`);
                if (authConfig.enabled) {
                    console.log(`  Authentication: ${jwtSecret ? 'JWT' : ''} ${Object.keys(options.apiKey).length > 0 ? 'API Keys' : ''}`.trim());
                }
                if (rateLimit > 0) {
                    console.log(`  Rate limit: ${rateLimit} requests/minute`);
                }
            });
        } catch (error: any) {
            console.error('Failed to start server:', error.message);
            process.exit(1);
        }
    });

// Helper to collect multiple --api-key options
function collectApiKeys(value: string, previous: Record<string, any>): Record<string, any> {
    const [key, roleStr] = value.split(':');
    const role = roleStr || 'user';
    return {
        ...previous,
        [key]: { id: `cli-user-${Object.keys(previous).length + 1}`, role, permissions: role === 'admin' ? ['*'] : [] }
    };
}
