import { Command } from 'commander';
import fs from 'fs/promises';
import path from 'path';
import { parse_document } from '../../validator';
import { build_dataset, dataset_to_jsonl, evaluate_dataset, parse_dataset, render_evaluation_report } from '../../runtime/evaluation';
import { read_journals } from '../../runtime/evidence_sources';
import { EmbeddedModelProvider, ModelProvider, OpenAIModelProvider, ollama_provider, tier_fallbacks } from '../../runtime/models';

const read = async (file: string) => fs.readFile(path.resolve(process.cwd(), file), 'utf-8');

const buildCommand = new Command('build')
    .description('Build an evaluation dataset from recorded runs: for each visit to an AI activity, its input and the outcome that was accepted, or that it was rejected')
    .argument('<journals...>', 'Journal files (.jsonl), or directories holding them')
    .requiredOption('-o, --output <file>', 'The dataset to write, one case per line (.jsonl)')
    .action(async (journals: string[], options) => {
        try {
            const { cases, skipped } = build_dataset(await read_journals(journals.map(j => path.resolve(process.cwd(), j))));
            await fs.writeFile(path.resolve(process.cwd(), options.output), dataset_to_jsonl(cases), 'utf-8');
            const accepted = cases.filter(c => c.label === 'accepted').length;
            console.error(`${cases.length} case(s) written to ${options.output}: ${accepted} accepted, ${cases.length - accepted} rejected`);
            for (const s of skipped) console.error(`  left out: "${s.activity_name}" in run ${s.run_id}: ${s.reason}`);
        } catch (error) {
            console.error('Error:', error instanceof Error ? error.message : String(error));
            process.exit(1);
        }
    });

const runCommand = new Command('run')
    .description('Perform every case of a dataset again under a candidate and report pass rates against outcome contracts and verification, per activity, with the regressions. Exits with 2 when there is a regression')
    .argument('<workflow>', 'The workflow the cases were recorded with (.awa.json)')
    .argument('<dataset>', 'The dataset (.jsonl), from "awa eval build"')
    .option('--candidate <file>', 'A changed version of the workflow to evaluate (keep activity ids)')
    .option('-p, --providers <list>', 'Model providers for the candidate, in order of preference: google, openai, ollama, embedded')
    .option('-k, --key <key>', 'Gemini API key')
    .option('-o, --output <file>', 'Write the report to this file instead of standard output')
    .option('--json', 'Write the report as JSON instead of Markdown')
    .action(async (workflowFile, datasetFile, options) => {
        try {
            const workflow = parse_document(JSON.parse(await read(workflowFile)));
            const candidate = options.candidate ? parse_document(JSON.parse(await read(options.candidate))) : undefined;
            const cases = parse_dataset(await read(datasetFile));
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
            if (!names.length && !apiKey) throw new Error('An evaluation runs the candidate\'s AI agents: give --providers, or GEMINI_API_KEY or --key');

            const report = await evaluate_dataset(workflow, cases, {
                candidate,
                engine: {
                    gemini_api_key: names.length && !names.includes('google') ? undefined : apiKey,
                    ...(names.length ? { model_providers: providers, default_model_provider: names[0], model_tiers: tier_fallbacks(names), default_ai_model_id: 'tier:balanced' } : {}),
                },
            });
            const text = options.json ? JSON.stringify(report, null, 2) : render_evaluation_report(report);
            if (options.output) {
                await fs.writeFile(path.resolve(process.cwd(), options.output), text + '\n', 'utf-8');
                console.error(`Report written to ${options.output}`);
            } else process.stdout.write(text + '\n');
            if (report.regressions.length > 0) process.exit(2);
        } catch (error) {
            console.error('Error:', error instanceof Error ? error.message : String(error));
            process.exit(1);
        }
    });

export const evalCommand = new Command('eval')
    .description('Evaluation from journals (specification section 33): build datasets from recorded runs, and score a candidate against them')
    .addCommand(buildCommand)
    .addCommand(runCommand);
