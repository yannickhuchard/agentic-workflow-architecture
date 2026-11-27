// Plays the scenarios of this example on one AWA host, one after the other, with scripted actors and the
// reference adapters in this process, and writes what they produced:
//
//   runs/<scenario>.journal.jsonl        the journal of each onboarding run (specification 9)
//   runs/<scenario>.grid-export.journal.jsonl   the journal of its child run, for a home with generation (24)
//   journeys.json                        every journey with its runs, the form `awa journey export` writes:
//                                        tools/visualization/journey.html?data= and dashboard.html?data= open it
//   evidence/evidence-report.{json,md,html}   the evidence report (32), made with `awa evidence`
//   bpmn/electricity-onboarding.{bpmn,dmn}    both workflows as BPMN 2.0 and their decision tables as DMN (27),
//                                        made with `awa export bpmn`
//
//   cd sdk/typescript && npm install && npm run build
//   node examples/electricity-onboarding/make-runs.mjs
//
// No model, no API key and no network: the agents' answers are scripted (scenarios/actors.json), and the tools
// are called through the engine's tool runner, which hands them to adapters/mock-server.mjs in this process.
// The clock, the identifiers and the jitter of retries are fixed before the SDK is loaded, so running this
// again writes the same files, byte for byte.

import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { syncBuiltinESMExports } from 'module';
import { execFileSync } from 'child_process';
import { fileURLToPath } from 'url';

const here = path.dirname(fileURLToPath(import.meta.url));
const sdk_dir = path.resolve(here, '../../sdk/typescript');

// --- A fixed clock and fixed identifiers ---------------------------------------------------
let clock = Date.parse('2026-11-02T09:00:00.000Z');
const RealDate = Date;
globalThis.Date = class extends RealDate {
    constructor(...args) { super(...(args.length ? args : [clock])); }
    static now() { return clock; }
};
let ids = 0;
crypto.randomUUID = () => `${(++ids).toString(16).padStart(8, '0')}-0000-4000-8000-000000000000`;
syncBuiltinESMExports();
let seed = 11;
Math.random = () => ((seed = (seed * 48271) % 2147483647) / 2147483647);

const sdk = await import(path.join(sdk_dir, 'dist/index.mjs'));
const { load_example, scripted_actors, scripted_decisions, in_process_executors, watching_journal, play, check_expectations, DEMO_SECRETS } = await import('./scenarios/play.mjs');
const { create_adapters } = await import('./adapters/mock-server.mjs');

const example = load_example();
const onboarding = sdk.parse_document(example.onboarding);
const grid = sdk.parse_document(example.grid);
const by_application = new Map(example.scenarios.map(s => [s.application.application_id, s]));
const spend = ms => { clock += ms; };
const today = () => new Date(clock).toISOString().slice(0, 10);
const journal = watching_journal(new sdk.InMemoryJournalStore());

const runtime = new sdk.AwaRuntime({
    now: () => clock,
    engine: {
        actors: scripted_actors({ scripts: example.scripts, scenario_of: id => by_application.get(id), spend, today }),
        wait_for_human_tasks: true,
        journal,
        now: () => (clock += 250),
        sleep: async ms => { clock += ms; },
        execution_logger: { log_execution: async () => { } },
        pricing_config: { input_token_cost_per_1k: 0.003, output_token_cost_per_1k: 0.015, currency: 'EUR', software_cost_per_execution: 0.001 },
        // What the deployment lets the tools reach, and the secrets their headers name; the calls go to the adapters in this process
        tools: { ...example.deployment.tools, secrets: DEMO_SECRETS, executors: in_process_executors(sdk, create_adapters()) },
        authorization: sdk.load_authorization(example.deployment.authorization),
        guardrails: example.deployment.guardrails,
        // The energy advisor behind tier:fast, scripted
        model_providers: [new sdk.FunctionModelProvider('scripted', scripted_decisions({ scripts: example.scripts, spend }))],
        model_tiers: { fast: 'scripted:fast-model', balanced: 'scripted:balanced-model', reasoning: 'scripted:reasoning-model' },
    },
});
runtime.register_workflow(grid).register_workflow(onboarding).register_journey(sdk.JourneyDefinitionSchema.parse(example.journey));

// --- The scenarios, one after the other, each beginning on a working morning ---------------------
const runs_dir = path.join(here, 'runs');
fs.rmSync(runs_dir, { recursive: true, force: true });
fs.mkdirSync(runs_dir, { recursive: true });
const jsonl = events => events.map(e => JSON.stringify(e)).join('\n') + '\n';
let failed = false;
for (const scenario of example.scenarios) {
    const morning = new RealDate(clock);
    morning.setUTCDate(morning.getUTCDate() + 1);
    morning.setUTCHours(9, 0, 0, 0);
    clock = morning.getTime();
    const instance = await play(sdk, runtime, journal, example, scenario, { advance: spend, today });
    const bundle = await runtime.export_journey(instance.id);
    const problems = check_expectations(scenario, instance, bundle.runs, onboarding.id);
    for (const ref of instance.runs) {
        const events = bundle.runs.find(r => r.run_id === ref.run_id).events;
        fs.writeFileSync(path.join(runs_dir, `${scenario.name}${ref.parent_run_id ? '.grid-export' : ''}.journal.jsonl`), jsonl(events));
    }
    const main = instance.runs.find(r => !r.parent_run_id);
    console.log(`${scenario.name.padEnd(22)} run ${main.status.padEnd(9)} journey ${instance.status.padEnd(9)} stage ${instance.stage_id.padEnd(14)} runs ${instance.runs.length}  ${problems.length ? 'PROBLEMS: ' + problems.join('; ') : 'as expected'}`);
    if (problems.length) failed = true;
}
if (failed) process.exit(1);

// --- The record, as `awa journey export` writes it -------------------------------------------
const portfolio = await runtime.export_portfolio();
const record = path.join(here, 'journeys.json');
fs.writeFileSync(record, JSON.stringify(portfolio, null, 1) + '\n');
console.log(`journeys.json: ${portfolio.journeys[0].instances.length} journeys, as of ${portfolio.as_of}`);

// --- The evidence report and the BPMN export, with the commands a deployer would use ------------
const awa = (...args) => execFileSync(process.execPath, [path.join(sdk_dir, 'dist/cli/index.js'), ...args], { stdio: ['ignore', 'inherit', 'inherit'] });
fs.mkdirSync(path.join(here, 'evidence'), { recursive: true });
for (const format of ['json', 'md', 'html']) awa('evidence', record, '--as-of', portfolio.as_of, '--format', format, '-o', path.join(here, 'evidence', `evidence-report.${format}`));
fs.mkdirSync(path.join(here, 'bpmn'), { recursive: true });
awa('export', 'bpmn', path.join(here, 'electricity-onboarding.awa.json'), path.join(here, 'grid-export-registration.awa.json'), '-o', path.join(here, 'bpmn', 'electricity-onboarding.bpmn'));
