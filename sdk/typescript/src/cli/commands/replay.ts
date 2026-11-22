import { Command } from 'commander';
import fs from 'fs/promises';
import path from 'path';
import { parse_document } from '../../validator';
import { parse_journal } from '../../runtime/journal';
import { counterfactual_replay, render_counterfactual_report } from '../../runtime/counterfactual';
import { EmbeddedModelProvider, ModelProvider, OpenAIModelProvider, ollama_provider, tier_fallbacks } from '../../runtime/models';

export const replayCommand = new Command('replay')
    .description('Counterfactual replay: re-run a recorded run with a different model or workflow, holding everything else as recorded, and compare')
    .argument('<workflow>', 'The workflow the journal was recorded with (.awa.json)')
    .argument('<journal>', 'The recorded run (.jsonl)')
    .option('--candidate <file>', 'A changed version of the workflow to run instead (keep node ids for nodes that are the same)')
    .option('--ai <mode>', 'live: AI agents run again. recorded: their recorded outputs are replayed, to test changed contracts or rules without a model', 'live')
    .option('-p, --providers <list>', 'Model providers for the candidate, in order of preference: google, openai, ollama, embedded')
    .option('-k, --key <key>', 'Gemini API key')
    .option('-o, --output <file>', 'Write the report to this file instead of standard output')
    .option('--json', 'Write the report as JSON instead of Markdown')
    .option('--journal-out <file>', 'Also write the candidate run\'s journal to this .jsonl file')
    .action(async (workflowFile, journalFile, options) => {
        try {
            const read = async (file: string) => fs.readFile(path.resolve(process.cwd(), file), 'utf-8');
            const workflow = parse_document(JSON.parse(await read(workflowFile)));
            const all = parse_journal(await read(journalFile)).filter(e => e.workflow_id === workflow.id);
            const runs = [...new Set(all.map(e => e.run_id))];
            if (runs.length === 0) throw new Error(`The journal holds no run of workflow ${workflow.id}`);
            const baseline = all.filter(e => e.run_id === runs[runs.length - 1]);
            const candidate = options.candidate ? parse_document(JSON.parse(await read(options.candidate))) : undefined;
            if (options.ai !== 'live' && options.ai !== 'recorded') throw new Error('--ai must be "live" or "recorded"');

            const apiKey = options.key || process.env.GEMINI_API_KEY;
            const names: string[] = options.providers ? String(options.providers).split(',').map((n: string) => n.trim()).filter(Boolean) : [];
            const providers: ModelProvider[] = [];
            for (const name of names) {
                if (name === 'openai') {
                    if (!process.env.OPENAI_API_KEY) throw new Error('Provider "openai" needs OPENAI_API_KEY');
                    providers.push(new OpenAIModelProvider({ api_key: process.env.OPENAI_API_KEY }));
                } else if (name === 'ollama') providers.push(ollama_provider({ base_url: process.env.OLLAMA_BASE_URL }));
                else if (name === 'embedded') providers.push(new EmbeddedModelProvider({ local_path: process.env.AWA_EMBEDDED_MODELS, default_model: process.env.AWA_EMBEDDED_MODEL }));
                else if (name !== 'google') throw new Error(`Unknown provider "${name}". Use google, openai, ollama or embedded`);
                else if (!apiKey) throw new Error('Provider "google" needs GEMINI_API_KEY or --key');
            }

            const { report, events } = await counterfactual_replay(workflow, baseline, {
                candidate, ai: options.ai,
                engine: {
                    gemini_api_key: names.length && !names.includes('google') ? undefined : apiKey,
                    ...(names.length ? { model_providers: providers, default_model_provider: names[0], model_tiers: tier_fallbacks(names), default_ai_model_id: 'tier:balanced' } : {}),
                },
            });

            const text = options.json ? JSON.stringify(report, null, 2) : render_counterfactual_report(report);
            if (options.output) {
                await fs.writeFile(path.resolve(process.cwd(), options.output), text + '\n', 'utf-8');
                console.error(`Report written to ${options.output}`);
            } else {
                process.stdout.write(text + '\n');
            }
            if (options.journalOut) {
                await fs.writeFile(path.resolve(process.cwd(), options.journalOut), events.map(e => JSON.stringify(e)).join('\n') + '\n', 'utf-8');
            }
            // A regression is a failure, so the command can gate a change in CI
            if (report.regressions.length > 0) process.exit(2);
        } catch (error: unknown) {
            console.error('Error:', error instanceof Error ? error.message : String(error));
            process.exit(1);
        }
    });
