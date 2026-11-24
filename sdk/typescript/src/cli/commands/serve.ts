import { Command } from 'commander';
import fs from 'fs';
import path from 'path';
import { createServer, AuthConfig } from '../../server';
import { parse_document } from '../../validator';
import { FileJournalStore } from '../../runtime/journal';
import { load_deployment } from '../deployment';
import { Workflow } from '../../types';

export const serveCommand = new Command('serve')
    .description('Start the AWA Operational API Server')
    .option('-p, --port <port>', 'Port to listen on', '3000')
    .option('--jwt-secret <secret>', 'JWT secret for authentication (or use JWT_SECRET env var)')
    .option('--api-key <key>', 'API key for authentication (format: key:role, can be repeated)', collectApiKeys, {})
    .option('--rate-limit <max>', 'Max requests per minute (0 to disable)', '0')
    .option('--no-auth', 'Disable authentication')
    .option('--a2a <file>', 'Offer this workflow to other agents over A2A (can be repeated)', (value: string, previous: string[]) => [...previous, value], [] as string[])
    .option('--public-url <url>', 'The address callers reach this server at, written in agent cards. Default: taken from each request')
    .option('--deployment <file>', 'JSON file saying what the workflows may reach: tools.allow_commands, tools.allowed_hosts, tools.mcp_servers, tools.grpc, a2a')
    .option('--store <url>', 'Keep journeys and runs in this PostgreSQL runtime store, which several servers may share (default: $AWA_RUNTIME_STORE)')
    .action(async (options) => {
        try {
            // The routes read the store from the environment, as a server started without this option would
            if (options.store) process.env.AWA_RUNTIME_STORE = options.store;
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

            // Workflows offered over A2A run under the deployment's permissions, like any other run
            const deployment = options.deployment ? load_deployment(path.resolve(process.cwd(), options.deployment)) : undefined;
            const offered: Workflow[] = (options.a2a as string[]).map(file => parse_document(JSON.parse(fs.readFileSync(path.resolve(process.cwd(), file), 'utf-8'))));

            const app = createServer({
                auth: authConfig.enabled ? authConfig as AuthConfig : undefined,
                rate_limit: rateLimit > 0 ? { window_ms: 60000, max_requests: rateLimit } : undefined,
                request_logging: true,
                a2a: offered.length ? {
                    workflows: offered,
                    options: {
                        public_url: options.publicUrl,
                        engine: () => ({
                            gemini_api_key: process.env.GEMINI_API_KEY,
                            ...(deployment ? { tools: deployment.tools, a2a: deployment.a2a } : {}),
                            journal: process.env.AWA_JOURNAL_DIR ? new FileJournalStore(process.env.AWA_JOURNAL_DIR) : undefined,
                        }),
                    },
                } : undefined,
            });

            app.listen(port, () => {
                console.log(`AWA Operational API running on http://localhost:${port}`);
                if (authConfig.enabled) {
                    console.log(`  Authentication: ${jwtSecret ? 'JWT' : ''} ${Object.keys(options.apiKey).length > 0 ? 'API Keys' : ''}`.trim());
                }
                if (process.env.AWA_RUNTIME_STORE) console.log('  Journeys: kept in the shared runtime store');
                if (rateLimit > 0) {
                    console.log(`  Rate limit: ${rateLimit} requests/minute`);
                }
                for (const workflow of offered) {
                    console.log(`  A2A agent "${workflow.name}": ${options.publicUrl || `http://localhost:${port}`}/a2a/${workflow.id}/.well-known/agent-card.json`);
                }
            });
        } catch (error: unknown) {
            const message = error instanceof Error ? error.message : String(error);
            console.error('Failed to start server:', message);
            process.exit(1);
        }
    });

// Helper to collect multiple --api-key options
function collectApiKeys(value: string, previous: Record<string, unknown>): Record<string, unknown> {
    const [key, roleStr] = value.split(':');
    const role = roleStr || 'user';
    return {
        ...previous,
        [key]: { id: `cli-user-${Object.keys(previous).length + 1}`, role, permissions: role === 'admin' ? ['*'] : [] }
    };
}
