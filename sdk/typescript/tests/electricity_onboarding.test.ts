/**
 * The electricity onboarding example (examples/electricity-onboarding): every document validates, every
 * scenario runs to its end with the scripted actors and the reference adapters, the files make-runs.mjs
 * committed are what this SDK computes, and the live demonstration serves a run as it happens. Also: a
 * compensation handler calls the tools it declares through the tool runner (13.6, 17.3), and the package
 * exports the HTTP server for a program that hosts its own runtime.
 *
 * The Python SDK plays the same scenario files: sdk/python/tests/test_electricity_onboarding.py.
 */
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { spawn } from 'child_process';
import * as sdk from '../src/index';
import { check_documents } from '../src/cli/commands/validate';
import { load_deployment } from '../src/cli/deployment';
import { read_evidence_input } from '../src/runtime/evidence_sources';
import { JournalEvent } from '../src/runtime/journal';

const EXAMPLE = path.resolve(__dirname, '../../../examples/electricity-onboarding');
const file = (name: string) => path.join(EXAMPLE, name);
const read = (name: string) => JSON.parse(fs.readFileSync(file(name), 'utf-8'));

/* eslint-disable @typescript-eslint/no-explicit-any */
type Play = typeof import('../../../examples/electricity-onboarding/scenarios/play.mjs');
const load = async () => ({
    play: await import(file('scenarios/play.mjs')) as Play,
    adapters: await import(file('adapters/mock-server.mjs')) as any,
});

/** One host for one scenario, its tools handed to the reference adapters in this process */
async function host() {
    const { play, adapters } = await load();
    const example = play.load_example();
    let clock = Date.parse('2026-11-02T09:00:00.000Z');
    const spend = (ms: number) => { clock += ms; };
    const today = () => new Date(clock).toISOString().slice(0, 10);
    const journal = play.watching_journal(new sdk.InMemoryJournalStore());
    const by_application = new Map(example.scenarios.map((s: any) => [s.application.application_id, s]));
    const runtime = new sdk.AwaRuntime({
        now: () => clock,
        engine: {
            actors: play.scripted_actors({ scripts: example.scripts, scenario_of: (id: string) => by_application.get(id), spend, today }) as any,
            wait_for_human_tasks: true, journal, now: () => (clock += 250), sleep: async (ms: number) => { clock += ms; },
            execution_logger: { log_execution: async () => { } },
            tools: { ...example.deployment.tools, secrets: play.DEMO_SECRETS, executors: play.in_process_executors(sdk, adapters.create_adapters()) as any },
            authorization: sdk.load_authorization(example.deployment.authorization),
            guardrails: example.deployment.guardrails,
            model_providers: [new sdk.FunctionModelProvider('scripted', play.scripted_decisions({ scripts: example.scripts, spend }) as any)],
            model_tiers: { fast: 'scripted:fast-model', balanced: 'scripted:balanced-model', reasoning: 'scripted:reasoning-model' },
        },
    });
    const onboarding = sdk.parse_document(example.onboarding), grid = sdk.parse_document(example.grid);
    runtime.register_workflow(grid).register_workflow(onboarding).register_journey(sdk.JourneyDefinitionSchema.parse(example.journey));
    return { play, example, runtime, journal, onboarding, grid, spend, today };
}

const SCENARIOS = fs.readdirSync(file('scenarios')).filter(f => /^[a-z]-.*\.json$/.test(f)).sort().map(f => read(`scenarios/${f}`));

describe('The electricity onboarding example: documents', () => {
    it('validates every document, the journey with its workflows', async () => {
        const { results, journey_references_checked } = await check_documents([
            file('electricity-onboarding.awa.json'), file('grid-export-registration.awa.json'), file('new-customer-onboarding.journey.json'),
        ]);
        expect(journey_references_checked).toBe(true);
        expect(results.map(r => [r.kind, r.valid, r.errors])).toEqual([['workflow', true, []], ['workflow', true, []], ['journey', true, []]]);
        // The deployment loads: principals, a policy with a separation of duties and a four-eyes rule, two guardrails
        const deployment = load_deployment(file('deployment.json'));
        expect(deployment.authorization!.policy!.four_eyes![0].activities).toEqual(['Grid operator approval, two engineers']);
        expect(deployment.guardrails).toHaveLength(2);
        expect(deployment.tools.allowed_hosts).toEqual(['localhost:4545']);
    });

    it('scripts only activities and tools the workflows have, and names no model', async () => {
        const workflows = [read('electricity-onboarding.awa.json'), read('grid-export-registration.awa.json')];
        const activities = new Map<string, any>(workflows.flatMap(w => w.activities.map((a: any) => [a.name, a])));
        const scripts = read('scenarios/actors.json');
        for (const [name, script] of Object.entries<any>(scripts.activities)) {
            expect(activities.has(name), name).toBe(true);
            for (const call of script.calls || []) expect(activities.get(name).tools.map((t: any) => t.name), `${name} calls ${call.tool}`).toContain(call.tool);
        }
        for (const scenario of SCENARIOS) {
            for (const name of Object.keys(scenario.actors || {})) expect(activities.has(name), `${scenario.name}: ${name}`).toBe(true);
            for (const step of scenario.steps.filter((s: any) => s.complete)) expect(activities.has(step.complete), `${scenario.name}: ${step.complete}`).toBe(true);
        }
        // Roles name model tiers, never a model
        for (const role of workflows.flatMap(w => w.roles).filter((r: any) => r.ai_model_config)) expect(role.ai_model_config.model_id).toMatch(/^tier:(reasoning|balanced|fast)$/);
        // Every tool points at the reference adapters, and every http tool that needs a key names a secret
        for (const tool of [...activities.values()].flatMap(a => a.tools || [])) {
            expect(tool.binding.url || tool.binding.endpoint).toMatch(/^http:\/\/localhost:4545\//);
            if (tool.binding.kind === 'http') expect(Object.values(tool.binding.headers || {}).join(' ')).toMatch(/\{\{secret:[A-Z_]+\}\}/);
        }
    });
});

describe('The electricity onboarding example: scenarios', () => {
    it.each(SCENARIOS.map(s => [s.name, s]))('%s runs to its end', async (_name, scenario) => {
        const { play, example, runtime, journal, onboarding, grid, spend, today } = await host();
        const instance = await play.play(sdk, runtime, journal, example, scenario, { advance: spend, today });
        const bundle = await runtime.export_journey(instance.id);
        expect(play.check_expectations(scenario, instance, bundle.runs, onboarding.id)).toEqual([]);
        const events: JournalEvent[] = bundle.runs.flatMap(r => r.events);
        const of = (type: string, node?: string) => events.filter(e => e.type === type && (!node || e.node_name === node));

        // A home with generation registers its export in a child run; the others start none
        const child = instance.runs.find(r => r.parent_run_id);
        if (scenario.application.has_generation) {
            expect(of('subworkflow.started', 'Register grid export')).toHaveLength(1);
            expect(child).toMatchObject({ workflow_id: grid.id, status: 'completed' });
            expect(bundle.runs.find(r => r.run_id === child!.run_id)!.events[0].data).toMatchObject({ depth: 1, parent: { workflow_id: onboarding.id } });
        } else {
            expect(of('subworkflow.started')).toEqual([]);
        }
        // Every tool call goes through the runner: invoked, then completed or failed, with the adapter's address as its link
        const invoked = of('tool.invoked');
        expect(invoked.length).toBeGreaterThan(5);
        for (const call of invoked) {
            expect((call.data as any).link).toMatch(/^http:\/\/localhost:4545\//);
            expect(events.some(e => (e.type === 'tool.completed' || e.type === 'tool.failed') && (e.data as any).call_id === (call.data as any).call_id)).toBe(true);
        }
        // Who did what, by name
        if (scenario.name === 'solar-prosumer') {
            expect(of('activity.completed', 'Grid operator approval').map(e => (e.data as any).principal.id)).toEqual(['gabriel']);
            expect(of('activity.completed', 'Verify installation documents').map(e => (e.data as any).principal.id)).toEqual(['hana']);
        }
        if (scenario.name === 'chp-four-eyes') {
            expect((of('activity.completed', 'Grid operator approval, two engineers')[0].data as any).approvals.map((a: any) => a.id)).toEqual(['gabriel', 'hana']);
        }
        if (scenario.name === 'documents-late') {
            expect(of('activity.completed', 'Send document reminder')).toHaveLength(1);
            expect(of('sla.breached', 'Verify documents')).toHaveLength(1);
        }
        if (scenario.name === 'declined') {
            expect((of('activity.completed', 'Write decline letter')[0].data as any).output.output.reason_given).toBe(true);
            expect(instance.events.at(-1)).toMatchObject({ type: 'journey.abandoned', data: { reason: 'Declined on eligibility' } });
        }
    });
});

describe('The electricity onboarding example: what make-runs.mjs committed', () => {
    it('the evidence report is what this SDK makes of journeys.json', async () => {
        const input = await read_evidence_input([file('journeys.json')]);
        const report = sdk.compute_evidence(input);
        expect(JSON.parse(JSON.stringify(report))).toEqual(read('evidence/evidence-report.json'));
        expect(sdk.render_evidence_markdown(report)).toBe(fs.readFileSync(file('evidence/evidence-report.md'), 'utf-8'));
        expect(sdk.render_evidence_html(report)).toBe(fs.readFileSync(file('evidence/evidence-report.html'), 'utf-8'));
        expect(sdk.unresolved_citations(report, input)).toEqual([]);
    });

    it('the journals are the runs of the portfolio, which holds every scenario', () => {
        const portfolio = read('journeys.json');
        expect(Object.keys(portfolio).sort()).toEqual(['as_of', 'journeys', 'transitions', 'workflows']);
        const instances = portfolio.journeys[0].instances;
        expect(instances.map((i: any) => i.instance.subject_key)).toEqual(SCENARIOS.map(s => s.application.application_id));
        const runs = new Map<string, JournalEvent[]>(instances.flatMap((i: any) => i.runs.map((r: any) => [r.run_id, r.events])));
        const files = fs.readdirSync(file('runs')).filter(f => f.endsWith('.journal.jsonl'));
        expect(files).toHaveLength(runs.size);
        for (const name of files) {
            const events = sdk.parse_journal(fs.readFileSync(file(`runs/${name}`), 'utf-8'));
            expect(events, name).toEqual(runs.get(events[0].run_id));
        }
        // The measures page computes from it as it would from a live host
        const report = sdk.compute_measures(portfolio);
        expect(report.journeys[0].measures['journey.completion_rate']).toEqual({ value: 6 / 8, n: 8 });
    });

    it('the BPMN and DMN documents are what awa export bpmn writes', async () => {
        const result = await sdk.export_bpmn([read('electricity-onboarding.awa.json'), read('grid-export-registration.awa.json')]);
        expect(result.bpmn).toBe(fs.readFileSync(file('bpmn/electricity-onboarding.bpmn'), 'utf-8'));
        expect(result.dmn).toBe(fs.readFileSync(file('bpmn/electricity-onboarding.dmn'), 'utf-8'));
    });
});

describe('A compensation handler calls the tools it declares (13.6, 17.3)', () => {
    it('through the tool runner, journalled between the failure and activity.compensated', async () => {
        const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
        const workflow = sdk.parse_document({
            id: id(1), name: 'Book and fail', version: '1.0.0', awa_version: '1.1',
            roles: [{ id: id(2), name: 'System', actor_type: 'application' }],
            activities: [
                { id: id(3), name: 'Book', role_id: id(2), actor_type: 'application', compensation: { activity_id: id(5) } },
                { id: id(4), name: 'Fail', role_id: id(2), actor_type: 'application' },
                { id: id(5), name: 'Cancel booking', role_id: id(2), actor_type: 'application',
                    tools: [{ name: 'cancel', description: 'Cancel a booking', parameters: { type: 'object', required: ['booking'], properties: { booking: { type: 'string' } } }, binding: { kind: 'function', name: 'cancel' } }] },
            ],
            edges: [{ id: id(6), source_id: id(3), target_id: id(4) }],
        });
        const cancelled: unknown[] = [];
        const actor = {
            execute: async (activity: any, inputs: any, context: any) => {
                if (activity.name === 'Book') return { booking: 'B-1' };
                if (activity.name === 'Fail') throw Object.assign(new Error('Nothing more can be done'), { code: 'VALIDATION_ERROR' });
                const call = await context.tools.call('cancel', { booking: inputs.booking });
                return { cancelled: call.ok };
            },
        };
        const engine = new sdk.WorkflowEngine(workflow, { actors: { application: actor }, tools: { handlers: { cancel: (args: unknown) => { cancelled.push(args); return { ok: true }; } } }, execution_logger: { log_execution: async () => { } } });
        await engine.start({});
        await engine.run();
        expect(engine.getStatus()).toBe('failed');
        expect(cancelled).toEqual([{ booking: 'B-1' }]);
        const events = await engine.getEvents();
        const types = events.filter(e => e.node_name === 'Cancel booking').map(e => e.type);
        expect(types).toEqual(['tool.invoked', 'tool.completed', 'activity.compensated']);
        expect(events.find(e => e.type === 'tool.completed')).toMatchObject({ attempt: 1, data: { tool: 'cancel', link: 'function:cancel' } });
        expect(events.find(e => e.type === 'activity.compensated')!.data).toMatchObject({ output: { cancelled: true } });
        expect(events.at(-1)!.data).toMatchObject({ compensation: { attempted: 1, succeeded: 1 } });
    });
});

describe('The live demonstration (demo/live.mjs)', () => {
    it('plays the prosumer onboarding and serves its runs as they happen, over the SDK server', async () => {
        expect(typeof sdk.createServer).toBe('function');
        expect(typeof sdk.set_journey_runtime).toBe('function');
        const { start_demo } = await import(file('demo/live.mjs')) as any;
        const lines: any[] = [];
        const demo = await start_demo({ sdk, port: 0, adapters_port: 0, speed: 400, scenario: 'solar-prosumer', out: (line: any) => lines.push(line) });
        try {
            const result = await demo.done;
            expect(lines[0]).toMatchObject({ kind: 'ready' });
            expect(lines.at(-1)).toMatchObject({ kind: 'done', run_id: result.run_id, instance_id: result.instance_id });
            expect(lines.every(l => typeof l.t === 'number' && ['ready', 'action', 'event', 'done'].includes(l.kind))).toBe(true);
            expect(lines.filter(l => l.kind === 'action').map(l => l.text)).toContain('Gabriel, grid engineer, approves an export of 6.0 kW');
            expect(lines.some(l => l.kind === 'event' && /^Refused: hana/.test(l.text))).toBe(true);
            expect(result.urls.replay).toContain(`/views/replay.html?run=${encodeURIComponent(`${demo.base}/api/v1/workflows/runs/${result.run_id}`)}`);

            // The journal of the run as Server-Sent Events, replayed from the start
            const controller = new AbortController();
            const response = await fetch(`${demo.base}/api/v1/workflows/runs/${result.run_id}/events/stream`, { signal: controller.signal });
            expect(response.headers.get('content-type')).toContain('text/event-stream');
            const reader = response.body!.getReader();
            let text = '';
            while (!text.includes('event: run.completed')) text += new TextDecoder().decode((await reader.read()).value);
            controller.abort();
            expect(text.startsWith('id: 1\nevent: run.started\ndata: ')).toBe(true);
            // A child run is served the same way
            const child = await (await fetch(`${demo.base}/api/v1/workflows/runs/${result.child_run_id}/workflow`)).json();
            expect(child.name).toBe('Grid Export Registration');
            const events = await (await fetch(`${demo.base}/api/v1/workflows/runs/${result.child_run_id}/events`)).json();
            expect(events.at(-1).type).toBe('run.completed');

            // The SDK's routes over the same host
            const portfolio = await (await fetch(`${demo.base}/api/v1/journeys/portfolio`)).json();
            expect(portfolio.journeys[0].instances[0].instance.status).toBe('completed');
            expect(portfolio.journeys[0].instances[0].instance.goals_reached).toEqual(['active-customer']);
            expect((await fetch(`${demo.base}/views/replay.html`)).status).toBe(200);
            expect((await fetch(`${demo.base}/views/journey.html`)).status).toBe(200);
        } finally {
            await demo.stop();
        }
    }, 30000);

    // As a command it runs on the built package; CI runs these tests before building it
    it.skipIf(!fs.existsSync(path.resolve(__dirname, '../dist/index.mjs')))('as a command, ends cleanly on SIGINT', async () => {
        const child = spawn(process.execPath, [file('demo/live.mjs'), '--port', '0', '--adapters-port', '0', '--speed', '50'], { stdio: ['ignore', 'pipe', 'inherit'] });
        let text = '';
        await new Promise<void>(resolve => child.stdout.on('data', chunk => { text += chunk; if (text.includes('"kind":"action"')) resolve(); }));
        expect(JSON.parse(text.split('\n')[0])).toMatchObject({ kind: 'ready' });
        const exit = new Promise<number | null>(resolve => child.on('exit', code => resolve(code)));
        child.kill('SIGINT');
        expect(await exit).toBe(0);
    }, 30000);
});
