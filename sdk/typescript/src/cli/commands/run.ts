import { Command } from 'commander';
import fs from 'fs/promises';
import path from 'path';
import { WorkflowEngine } from '../../runtime/workflow_engine';
import { PrismaExecutionLogger, ConsoleExecutionLogger } from '../../runtime/execution_logger';
import { parse_document } from '../../validator';
import { Workflow, Context } from '../../types';

export const runCommand = new Command('run')
    .description('Run a workflow file')
    .argument('<file>', 'Path to the .awa.json file')
    .option('-v, --verbose', 'Enable verbose output')
    .option('-k, --key <key>', 'Gemini API Key')
    .option('--db', 'Log execution to database')
    .option('-s, --simulate', 'Run in simulation mode (no real API calls)')
    .action(async (file, options) => {
        try {
            const filePath = path.resolve(process.cwd(), file);
            const content = await fs.readFile(filePath, 'utf-8');
            const workflowRaw = JSON.parse(content);

            // Validate/Parse
            // We use parse_workflow which validates schema
            const workflow = parse_document(workflowRaw);

            if (!workflow) {
                console.error("Failed to parse workflow.");
                process.exit(1);
            }

            console.log(`Starting workflow: ${workflow.name} (${workflow.id})`);
            if (options.simulate) {
                console.log('🧪 Running in SIMULATION MODE. No real API calls will be made.');
            }

            const apiKey = options.key || process.env.GEMINI_API_KEY;

            // Initialize logger based on options
            const executionLogger = options.db
                ? new PrismaExecutionLogger()
                : new ConsoleExecutionLogger();

            const engine = new WorkflowEngine(workflow, {
                gemini_api_key: apiKey,
                simulate: options.simulate,
                execution_logger: executionLogger,
                pricing_config: {
                    input_token_cost_per_1k: 0.0001, // Example rate
                    output_token_cost_per_1k: 0.0004, // Example rate
                    currency: 'USD'
                }
            });

            const execute = async () => {
                const runId = await engine.start();
                console.log(`Workflow started (Run ID: ${runId})`);

                let steps = 0;
                while (engine.getStatus() === 'running') {
                    await engine.runStep();
                    steps++;
                    if (options.verbose) {
                        console.log(`Step ${steps} completed.`);
                        const tokens = engine.getTokens();
                        console.log(`Active tokens: ${tokens.filter(t => t.status === 'active').length}`);
                    }
                    // Prevent infinite loop if something goes wrong, or just wait? 
                    // For now, we rely on engine changing status.
                    // A small delay might be nice if we were polling async tasks, but runStep is async.
                    await new Promise(resolve => setTimeout(resolve, 100));
                }

                return engine.getStatus();
            };

            const status = await execute();
            console.log(`Workflow finished with status: ${status}`);

            if (status === 'failed') {
                console.error("Workflow failed.");
                process.exit(1);
            }

        } catch (error: unknown) {
            const message = error instanceof Error ? error.message : String(error);
            const stack = error instanceof Error ? error.stack : undefined;
            console.error('Error running workflow:', message);
            if (options.verbose && stack) {
                console.error(stack);
            }
            process.exit(1);
        }
    });
