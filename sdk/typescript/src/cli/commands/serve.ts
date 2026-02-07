import { Command } from 'commander';
import { createServer } from '../../server';

export const serveCommand = new Command('serve')
    .description('Start the AWA Operational API Server')
    .option('-p, --port <port>', 'Port to listen on', '3000')
    .action(async (options) => {
        try {
            const port = parseInt(options.port, 10);
            const app = createServer();

            app.listen(port, () => {
                console.log(`AWA Operational API running on http://localhost:${port}`);
            });
        } catch (error: any) {
            console.error('Failed to start server:', error.message);
            process.exit(1);
        }
    });
