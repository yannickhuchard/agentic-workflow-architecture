import { Command } from 'commander';
import fs from 'fs/promises';
import path from 'path';
import { WorkflowEngine } from '../../runtime/workflow_engine';
import { parse_workflow } from '../../validator';
import { Workflow, Context } from '../../types';

export const runCommand = new Command('run')
    .description('Run a workflow file')
    .argument('<file>', 'Path to the .awa.json file')
    .option('-v, --verbose', 'Enable verbose output')
    .option('-k, --key <key>', 'Gemini API Key')
    .action(async (file, options) => {
        try {
            const filePath = path.resolve(process.cwd(), file);
            const content = await fs.readFile(filePath, 'utf-8');
            const workflowRaw = JSON.parse(content);

            // Validate/Parse
            // We use parse_workflow which validates schema
            const workflow = parse_workflow(workflowRaw);

            if (!workflow) {
                console.error("Failed to parse workflow.");
                process.exit(1);
            }

            console.log(`Starting workflow: ${workflow.name} (${workflow.id})`);

            const apiKey = options.key || process.env.GEMINI_API_KEY;

            const engine = new WorkflowEngine(workflow, {
                geminiApiKey: apiKey
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

        } catch (error: any) {
            console.error('Error running workflow:', error.message);
            if (options.verbose && error.stack) {
                console.error(error.stack);
            }
            process.exit(1);
        }
    });
