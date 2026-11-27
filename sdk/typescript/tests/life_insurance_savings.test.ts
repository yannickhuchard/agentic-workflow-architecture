/**
 * The workplace pension savings example (examples/life-insurance-savings): every document validates, every
 * scenario runs to its end with the scripted actors and the reference adapters, the files make-runs.mjs
 * committed are what this SDK computes, and the live demonstration serves a run as it happens.
 *
 * The Python SDK plays the same scenario files: sdk/python/tests/test_life_insurance_savings.py.
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

const EXAMPLE = path.resolve(__dirname, '../../../examples/life-insurance-savings');
const file = (name: string) => path.join(EXAMPLE, name);
const read = (name: string) => JSON.parse(fs.readFileSync(file(name), 'utf-8'));

/* eslint-disable @typescript-eslint/no-explicit-any */
type Play = typeof import('../../../examples/life-insurance-savings/scenarios/play.mjs');
const load = async () => ({
    play: await import(file('scenarios/play.mjs')) as Play,
    adapters: await import(file('adapters/mock-server.mjs')) as any,
});

/** One host for one scenario, its tools handed to the reference adapters in this process, its clock at the scenario's start */
async function host(scenario: any, extra: any[] = []) {
    const { play, adapters } = await load();
    const example = play.load_example();
    example.scenarios.push(...extra);
    let clock = Date.parse(scenario.starts);
    const spend = (ms: number) => { clock += ms; };
    const today = () => new Date(clock).toISOString().slice(0, 10);
    const journal = play.watching_journal(new sdk.InMemoryJournalStore());
    const by_enrolment = new Map(example.scenarios.map((s: any) => [s.invitation.enrolment_id, s]));
    const runtime = new sdk.AwaRuntime({
        now: () => clock,
        engine: {
            actors: play.scripted_actors({ scripts: example.scripts, scenario_of: (id: string) => by_enrolment.get(id), spend, today }) as any,
            wait_for_human_tasks: true, journal, now: () => (clock += 250), sleep: async (ms: number) => { clock += ms; },
            execution_logger: { log_execution: async () => { } },
            tools: { ...example.deployment.tools, secrets: play.DEMO_SECRETS, executors: play.in_process_executors(sdk, adapters.create_adapters()) as any },
            authorization: sdk.load_authorization(example.deployment.authorization),
            guardrails: example.deployment.guardrails,
            model_tiers: { fast: 'scripted:fast-model', balanced: 'scripted:balanced-model', reasoning: 'scripted:reasoning-model' },
        },
    });
    for (const workflow of example.workflows) runtime.register_workflow(sdk.parse_document(workflow));
    runtime.register_journey(sdk.JourneyDefinitionSchema.parse(example.journey));
    return { play, example, runtime, journal, spend, today };
}

const SCENARIOS = fs.readdirSync(file('scenarios')).filter(f => /^[a-z]-.*\.json$/.test(f)).sort().map(f => read(`scenarios/${f}`));
const WORKFLOW_FILES = ['identity-aml-and-tax-residence.awa.json', 'plan-invitation-and-advice.awa.json', 'savings-plan-subscription.awa.json',
    'payroll-contributions.awa.json', 'self-service-change.awa.json', 'year-end-tax.awa.json', 'annual-review.awa.json'];

describe('The life insurance savings example: documents', () => {
    it('validates every document, the journey with its workflows', async () => {
        const { results, journey_references_checked } = await check_documents([...WORKFLOW_FILES.map(file), file('workplace-pension-savings.journey.json')]);
        expect(journey_references_checked).toBe(true);
        expect(results.map(r => [r.kind, r.valid, r.errors])).toEqual([...WORKFLOW_FILES.map(() => ['workflow', true, []]), ['journey', true, []]]);
        // The deployment loads: principals, a policy with two separations of duties and a four-eyes rule, three guardrails
        const deployment = load_deployment(file('deployment.json'));
        expect(deployment.authorization!.policy!.four_eyes![0].activities).toEqual(['Approve PEP relationship']);
        expect(deployment.authorization!.policy!.separation_of_duties!.map((s: any) => s.activities)).toEqual([
            ['Resolve compliance alert', 'Approve PEP relationship'], ['Discuss the risk with an adviser', 'Approve choice above profile']]);
        expect(deployment.guardrails).toHaveLength(3);
        expect(deployment.tools.allowed_hosts).toEqual(['localhost:4560']);
    });

    it('scripts only activities and tools the workflows have, and names no model', async () => {
        const workflows = WORKFLOW_FILES.map(read);
        const activities = new Map<string, any>(workflows.flatMap(w => w.activities.map((a: any) => [a.name, a])));
        const scripts = read('scenarios/actors.json');
        for (const [name, script] of Object.entries<any>(scripts.activities)) {
            expect(activities.has(name), name).toBe(true);
            for (const call of script.calls || []) expect(activities.get(name).tools.map((t: any) => t.name), `${name} calls ${call.tool}`).toContain(call.tool);
        }
        // Every activity a scripted actor performs has a script; people answer in the scenarios' steps
        for (const [name, activity] of activities) if (activity.actor_type !== 'human' && !activity.is_expandable) expect(scripts.activities[name], name).toBeDefined();
        for (const scenario of SCENARIOS) {
            for (const [name, own] of Object.entries<any>(scenario.actors || {})) {
                expect(activities.has(name), `${scenario.name}: ${name}`).toBe(true);
                for (const call of own.calls || []) expect(activities.get(name).tools.map((t: any) => t.name), `${scenario.name}: ${name} calls ${call.tool}`).toContain(call.tool);
            }
            for (const step of scenario.steps.filter((s: any) => s.complete)) expect(activities.has(step.complete), `${scenario.name}: ${step.complete}`).toBe(true);
        }
        // Roles name model tiers, never a model
        for (const role of workflows.flatMap(w => w.roles).filter((r: any) => r.ai_model_config)) expect(role.ai_model_config.model_id).toMatch(/^tier:(reasoning|balanced|fast)$/);
        // Every tool points at the reference adapters, and every http tool names a secret
        for (const tool of [...activities.values()].flatMap(a => a.tools || [])) {
            expect(tool.binding.url || tool.binding.endpoint).toMatch(/^http:\/\/localhost:4560\//);
            if (tool.binding.kind === 'http') expect(Object.values(tool.binding.headers || {}).join(' ')).toMatch(/\{\{secret:[A-Z_]+\}\}/);
        }
    });

    it('keeps the tax ceilings as data in a decision table', () => {
        const tax = read('year-end-tax.awa.json');
        const rules = tax.decision_nodes.find((d: any) => d.name === 'Deduction rules').decision_table.rules;
        expect(rules.map((r: any) => [r.output_entries[0], r.output_entries[1]])).toEqual([['111bis', 4500], ['111bis', 3200], ['111', 672], ['110', 1200]]);
    });

    it('gives the journey view a glossary, a brand, bands and a layout of every workflow', () => {
        const options = read('views/story-options.json');
        const workflows = WORKFLOW_FILES.map(read);
        expect(options.subject_name).toEqual(['employee.first_name', 'employee.last_name']);
        expect(options.brand).toBe('../../../tools/visualization/brands/valoria-life.DESIGN.md');
        for (const workflow of workflows) {
            const layout = options.layouts[workflow.name];
            const nodes = [...workflow.events, ...workflow.activities, ...(workflow.decision_nodes || [])].map((n: any) => n.name);
            expect(Object.keys(layout).sort(), workflow.name).toEqual([...nodes].sort());
            const cells = Object.values<number[]>(layout).map(c => c.join(','));
            expect(new Set(cells).size, `${workflow.name}: two nodes in one cell`).toBe(cells.length);
        }
        const ids = options.glossary.map((g: any) => g.id);
        expect(new Set(ids).size).toBe(ids.length);
        for (const entry of options.glossary) {
            expect(entry.term && entry.definition, entry.id).toBeTruthy();
            // `see` is an official page, over https, or a short reference into the example
            if (entry.see && /^[a-z]+:/.test(entry.see)) expect(entry.see).toMatch(/^https:\/\//);
        }
    });
});

describe('The life insurance savings example: scenarios', () => {
    it.each(SCENARIOS.map(s => [s.name, s]))('%s runs to its end', async (_name, scenario) => {
        const { play, example, runtime, journal, spend, today } = await host(scenario);
        const instance = await play.play(sdk, runtime, journal, example, scenario, { advance: spend, today });
        const bundle = await runtime.export_journey(instance.id);
        expect(play.check_expectations(scenario, instance, bundle.runs)).toEqual([]);
        const events: JournalEvent[] = bundle.runs.flatMap(r => r.events);
        const of = (type: string, node?: string) => events.filter(e => e.type === type && (!node || e.node_name === node));

        // Due diligence runs as a child run of the subscription, linked both ways
        const child = instance.runs.find(r => r.parent_run_id);
        if (instance.runs.some(r => r.workflow_name === 'Savings Plan Subscription')) {
            expect(child).toMatchObject({ workflow_name: 'Identity, AML and Tax Residence Checks', status: 'completed' });
            expect(bundle.runs.find(r => r.run_id === child!.run_id)!.events[0].data).toMatchObject({ depth: 1, parent: { run_id: child!.parent_run_id } });
            expect(of('subworkflow.started', 'Run identity and AML checks')).toHaveLength(1);
        } else {
            expect(child).toBeUndefined();
        }
        // Every tool call goes through the runner: invoked, then completed or failed, with the adapter's address as its link
        for (const call of of('tool.invoked')) {
            expect((call.data as any).link).toMatch(/^http:\/\/localhost:4560\//);
            expect(events.some(e => (e.type === 'tool.completed' || e.type === 'tool.failed') && (e.data as any).call_id === (call.data as any).call_id)).toBe(true);
        }
        // What each story says, by name
        if (scenario.name === 'lea-full-year') {
            expect(of('activity.completed', 'Invest contribution').map(e => (e.data as any).output.premiums_paid_eur)).toEqual([750, 1125, 1500, 1875, 2250, 2625, 3000, 3375, 3750, 4125, 4500]);
            expect(instance.events.filter(e => e.type === 'journey.stage_entered').map(e => (e.data as any).stage_name)).toEqual([
                'Invitation', 'Discovery and advice', 'Needs and profile', 'Investments', 'Subscription', 'Cooling-off and issue', 'Saving', 'Year-end tax', 'Annual review']);
        }
        if (scenario.name === 'marc-cancels') {
            // Undone in reverse order of completion, each through its own tools
            expect(of('activity.compensated').map(e => e.node_name)).toEqual(['Redeem units and refund premium', 'Stop payroll deduction', 'Cancel policy']);
            expect(of('tool.completed').filter(e => ['redeem_units', 'refund_premium', 'stop_payroll_deduction', 'cancel_policy'].includes((e.data as any).tool)).map(e => (e.data as any).tool))
                .toEqual(['redeem_units', 'refund_premium', 'stop_payroll_deduction', 'cancel_policy']);
        }
        if (scenario.name === 'sara-pep') {
            const approvals = of('authorization.decided', 'Approve PEP relationship').map(e => [(e.data as any).principal.id, (e.data as any).decision, (e.data as any).reason]);
            expect(approvals).toEqual([['ines', 'deny', 'separation_of_duties'], ['jonas', 'allow', 'rule'], ['jonas', 'deny', 'four_eyes'], ['claire', 'allow', 'rule']]);
        }
        if (scenario.name === 'eva-guarantee-blocked') {
            // The guarantee never reaches Eva, nor the journal; the phone number is redacted
            const text = JSON.stringify(events);
            expect(text).not.toMatch(/guarantees a 3% annual return/);
            expect(text).not.toMatch(/621 555 018/);
            expect((of('activity.completed', 'Recommend changes')[0].data as any).output.output.recommendation_text).toContain('[REDACTED:phone]');
        }
    });
});

describe('The life insurance savings example: a choice above the profile that the employee keeps', () => {
    // Tom, but he keeps his choice: Mireille, who advised him on it, may not also approve it
    const tom = SCENARIOS.find(s => s.name === 'tom-above-profile');
    const keeps = {
        ...structuredClone(tom), name: 'tom-keeps-choice',
        invitation: { ...structuredClone(tom.invitation), enrolment_id: 'ENR-26902' },
        steps: [
            ...tom.steps.slice(0, 3),
            { at: '2026-01-14T07:45:00Z', say: 'Tom keeps his choice and asks to talk to an adviser', publish: 'investments.reconsidered', data: { reconsider_decision: 'keep' } },
            { at: '2026-01-14T15:00:00Z', say: 'Mireille, licensed adviser, talks the risk through with Tom', complete: 'Discuss the risk with an adviser', by: 'mireille',
                output: { acknowledgement_recorded: true, note: 'Tom understands he could lose more than his profile allows, and accepts it in writing.' } },
            { at: '2026-01-14T15:10:00Z', say: 'Mireille, who is also a compliance officer, tries to approve the choice, and is refused', complete: 'Approve choice above profile', by: 'mireille',
                output: { approved: true, allocation_confirmed: true }, refused: 'separation_of_duties' },
            { at: '2026-01-15T09:00:00Z', say: 'Jonas, compliance officer, approves the choice above the profile', complete: 'Approve choice above profile', by: 'jonas',
                output: { approved: true, allocation_confirmed: true, note: 'Insistent customer, informed and acknowledged.' } },
        ],
        expect: {
            runs: { 'Savings Plan Subscription': ['waiting_event'] }, journey_status: 'active', journey_stage: 'subscription',
            records: [
                { type: 'authorization.decided', node_name: 'Approve choice above profile', data: { decision: 'deny', reason: 'separation_of_duties', principal: { id: 'mireille' } } },
                { type: 'activity.completed', node_name: 'Approve choice above profile', data: { principal: { id: 'jonas' } } },
                { type: 'event.published', node_name: 'Investments confirmed' },
            ],
        },
    };

    it('is approved by a compliance officer who did not advise on it', async () => {
        const { play, example, runtime, journal, spend, today } = await host(keeps, [keeps]);
        const instance = await play.play(sdk, runtime, journal, example, keeps, { advance: spend, today });
        const bundle = await runtime.export_journey(instance.id);
        expect(play.check_expectations(keeps, instance, bundle.runs)).toEqual([]);
    });
});

describe('The life insurance savings example: what make-runs.mjs committed', () => {
    it('the evidence report is what this SDK makes of journeys.json', async () => {
        const input = await read_evidence_input([file('journeys.json')]);
        const report = sdk.compute_evidence(input);
        expect(JSON.parse(JSON.stringify(report))).toEqual(read('evidence/evidence-report.json'));
        expect(sdk.render_evidence_markdown(report)).toBe(fs.readFileSync(file('evidence/evidence-report.md'), 'utf-8'));
        expect(sdk.render_evidence_html(report)).toBe(fs.readFileSync(file('evidence/evidence-report.html'), 'utf-8'));
        expect(sdk.unresolved_citations(report, input)).toEqual([]);
    });

    it('the journals are the runs of the portfolio, which holds every scenario on one calendar', () => {
        const portfolio = read('journeys.json');
        expect(Object.keys(portfolio).sort()).toEqual(['as_of', 'journeys', 'transitions', 'workflows']);
        const instances = portfolio.journeys[0].instances;
        expect(instances.map((i: any) => i.instance.subject_key).sort()).toEqual(SCENARIOS.map(s => s.invitation.enrolment_id).sort());
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
        expect(report.journeys[0].measures['journey.goal_attainment']).toEqual({ value: 6 / 8, n: 8 });
    });

    it('the BPMN and DMN documents are what awa export bpmn writes', async () => {
        const result = await sdk.export_bpmn(WORKFLOW_FILES.map(read));
        expect(result.bpmn).toBe(fs.readFileSync(file('bpmn/life-insurance-savings.bpmn'), 'utf-8'));
        expect(result.dmn).toBe(fs.readFileSync(file('bpmn/life-insurance-savings.dmn'), 'utf-8'));
    });
});

describe('The live demonstration (demo/live.mjs)', () => {
    it("plays Léa's year and serves its runs as they happen, over the SDK server", async () => {
        const { start_demo } = await import(file('demo/live.mjs')) as any;
        const lines: any[] = [];
        const demo = await start_demo({ sdk, port: 0, adapters_port: 0, speed: 2000, scenario: 'lea-full-year', out: (line: any) => lines.push(line) });
        try {
            const result = await demo.done;
            expect(lines[0]).toMatchObject({ kind: 'ready' });
            expect(lines.at(-1)).toMatchObject({ kind: 'done', run_id: result.run_id, instance_id: result.instance_id });
            const told = lines.filter(l => l.kind === 'action' || l.kind === 'event');
            expect(told.every(l => ['customer', 'system', 'agent', 'person', 'guardrail', 'refused', 'journey'].includes(l.actor) && /[.]$/.test(l.text) && !/https?:|->/.test(l.text))).toBe(true);
            expect(told.find(l => l.text === 'Hugo, licensed adviser, advises Léa by video call.')).toMatchObject({ kind: 'action', actor: 'person' });
            expect(told.find(l => l.text === 'Léa opens the invitation in the HR portal.')).toMatchObject({ actor: 'customer' });
            expect(told.filter(l => l.event === 'journey.stage_entered').map(l => l.stage)).toEqual([
                'Invitation', 'Discovery and advice', 'Needs and profile', 'Investments', 'Subscription', 'Cooling-off and issue', 'Saving', 'Year-end tax', 'Annual review']);
            expect(told.some(l => l.event === 'tool.completed' && /issues the 2026 tax certificate/.test(l.text))).toBe(true);
            expect(result.urls.replay).toContain(`/views/replay.html?run=${encodeURIComponent(`${demo.base}/api/v1/workflows/runs/${result.run_id}`)}`);
            // A run, and its journal, over the script's routes
            const workflow = await (await fetch(`${demo.base}/api/v1/workflows/runs/${result.run_id}/workflow`)).json();
            expect(workflow.name).toBe('Plan Invitation and Advice');
            const events = await (await fetch(`${demo.base}/api/v1/workflows/runs/${result.run_id}/events`)).json();
            expect(events.at(-1).type).toBe('run.completed');
            const portfolio = await (await fetch(`${demo.base}/api/v1/journeys/portfolio`)).json();
            expect(portfolio.journeys[0].instances[0].instance.status).toBe('completed');
        } finally {
            await demo.stop();
        }
    }, 60000);

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
