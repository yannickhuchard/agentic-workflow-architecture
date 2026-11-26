/**
 * Evidence (specification section 32): the claims-journey example turned into
 * an evidence report, sources read from files and directories, the command and
 * the HTTP route.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { AddressInfo } from 'net';
import Ajv2020 from 'ajv/dist/2020';
import addFormats from 'ajv-formats';
import { compute_evidence, render_evidence_html, render_evidence_markdown, unresolved_citations, EVIDENCE_FRAMEWORKS, EvidenceInput } from '../src/runtime/evidence';
import { read_evidence_input, read_journals } from '../src/runtime/evidence_sources';
import { AwaRuntime, add_definition, open_runtime_directory } from '../src/runtime/runtime';
import { WorkflowEngine } from '../src/runtime/workflow_engine';
import { parse_document } from '../src/validator';
import { FileJournalStore } from '../src/runtime/journal';
import { createServer } from '../src/server';
import { set_journey_runtime } from '../src/server/routes/journeys';
import { evidenceCommand } from '../src/cli/commands/evidence';
import { activity, edge, silent_logger, workflow } from './helpers';

const ROOT = path.resolve(__dirname, '../../..');
const EXAMPLE = path.join(ROOT, 'examples/claims-journey');
const portfolio: EvidenceInput = JSON.parse(fs.readFileSync(path.join(EXAMPLE, 'journeys.json'), 'utf-8'));
const ajv = new Ajv2020({ strict: false, allErrors: true }); addFormats(ajv);
const schema = ajv.compile(JSON.parse(fs.readFileSync(path.join(ROOT, 'spec/json-schema/evidence-report.schema.json'), 'utf-8')));

describe('Evidence from the claims-journey example', () => {
    const report = compute_evidence(portfolio);

    it('has the form the schema fixes', () => {
        expect(schema(JSON.parse(JSON.stringify(report))), JSON.stringify(schema.errors?.slice(0, 3))).toBe(true);
        // The twelfth part comes last: the eleven before it keep their places (32.1)
        expect(report.parts.map(p => p.id)).toEqual(['operation', 'models', 'oversight', 'outcomes', 'refusals', 'failures', 'compensations', 'service_levels', 'tools', 'data', 'retention', 'guardrails']);
    });

    it('cites, for every statement, journal and journey records that exist', () => {
        // Built here from the example itself, independently of unresolved_citations
        const records = new Map<string, Map<number, { type: string; node_name?: string }>>();
        for (const j of portfolio.journeys!) for (const row of j.instances) {
            records.set(`journey:${row.instance.id}`, new Map((row.instance.events || []).map(e => [e.seq, e])));
            for (const r of row.runs) records.set(`run:${r.run_id}`, new Map(r.events.map(e => [e.seq, e])));
        }
        let citations = 0;
        for (const part of report.parts) for (const statement of part.statements) {
            expect(statement.citations.length, `${part.id}/${statement.kind} cites nothing`).toBeGreaterThan(0);
            for (const c of statement.citations) {
                const held = records.get('run_id' in c ? `run:${c.run_id}` : `journey:${c.journey_instance_id}`);
                expect(held, JSON.stringify(c)).toBeDefined();
                for (const seq of c.seq) { expect(held!.has(seq), `${part.id}/${statement.kind} cites ${JSON.stringify(c)}`).toBe(true); citations++; }
            }
        }
        expect(citations).toBeGreaterThan(400);
        expect(unresolved_citations(report, portfolio)).toEqual([]);
    });

    it('cites the very records a statement is about', () => {
        const runs = new Map(portfolio.journeys!.flatMap(j => j.instances.flatMap(i => i.runs)).map(r => [r.run_id, r]));
        const record = (run_id: string, seq: number) => runs.get(run_id)!.events.find(e => e.seq === seq)!;
        for (const s of report.parts.find(p => p.id === 'outcomes')!.statements) {
            const [c] = s.citations as { run_id: string; seq: number[] }[];
            expect(record(c.run_id, c.seq[0]).type).toBe(s.kind === 'contract' ? 'contract.checked' : 'verification.completed');
            expect(record(c.run_id, c.seq[0]).node_name).toBe(s.facts.node_name);
        }
        for (const s of report.parts.find(p => p.id === 'models')!.statements.filter(x => x.kind === 'model')) {
            const cited = s.citations.flatMap(c => ('run_id' in c ? c.seq.map(seq => record(c.run_id, seq)) : []));
            expect(cited.length).toBe(s.facts.uses);
            for (const e of cited) expect(e.data).toMatchObject({ subject: 'model_selection', model: { id: s.facts.model, provider: s.facts.provider } });
        }
    });

    it('states what the example shows', () => {
        const part = (id: string) => report.parts.find(p => p.id === id)!;
        expect(part('operation').summary).toMatchObject({ runs: 25, completed: 22, failed: 1, cancelled: 2, journeys: 18 });
        expect(part('models').summary.models).toEqual(['acme:assessor-large', 'acme:classifier-small', 'acme:writer-medium']);
        expect(part('oversight').summary).toMatchObject({ human_decisions: 2, cancellations: 2 });
        expect(part('compensations').statements[0].facts).toMatchObject({ compensates: 'Reserve funds', succeeded: true });
        expect(part('failures').summary).toMatchObject({ runs_failed: 1, journeys_stalled: 2, dead_letters: 1 });
        expect(part('data').summary.runs_by_mode).toEqual({ full: 25, hash: 0, none: 0, mixed: 0 });
        expect(part('retention').summary).toMatchObject({ runs: 25, runs_with_gaps: 0, oldest_record: '2026-03-02T09:00:00.000Z' });
        // Every part names what it can serve, from the frameworks the report lists
        const known = new Set(EVIDENCE_FRAMEWORKS.flatMap(f => f.references.map(r => r.id)));
        for (const p of report.parts) for (const id of p.serves) expect(known.has(id), id).toBe(true);
    });

    it('reads as Markdown and as HTML, and says it is not a certification', () => {
        const md = render_evidence_markdown(report);
        expect(md).toContain('# Evidence report');
        expect(md).toContain('It is not a certification');
        expect(md).toContain('EU AI Act Art. 12(1)');
        expect(md).toContain('NIST AI RMF');
        expect(md).toContain('ISO/IEC 42001');
        const html = render_evidence_html(report);
        expect(html.startsWith('<!doctype html>')).toBe(true);
        expect(html).toContain('It is not a certification');
        expect(html).not.toMatch(/<script/);
    });

    it('keeps a period and a set of workflows', () => {
        const settlement = portfolio.workflows!.find(w => w.name === 'Motor Claim Settlement')!;
        const narrowed = compute_evidence(portfolio, { workflow_ids: [settlement.id] });
        expect(narrowed.scope.workflows.map(w => w.name)).toEqual(['Motor Claim Settlement']);
        expect(narrowed.parts[0].summary.runs).toBe(4);
        const september = compute_evidence(portfolio, { from: '2026-09-01T00:00:00Z', to: '2026-10-01T00:00:00Z' });
        expect(september.parts[0].summary.runs).toBe(13);
        expect(september.scope.journeys.map(j => j.name)).toEqual(['Motor Claim']);
        expect(compute_evidence(portfolio, { from: '2030-01-01T00:00:00Z' }).parts.every(p => p.id === 'operation' || p.statements.length === 0)).toBe(true);
    });
});

// A run that exercises sections 24, 30 and 31 at once: a guardrail redacts and another warns,
// a call activity starts a child run whose agent's output is redacted too, and a person's
// approval needs two distinct approvers under a four-eyes rule
const u = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const CHILD = parse_document({
    id: u(100), name: 'Check', version: '2.0.0', awa_version: '1.1',
    activities: [{ id: u(101), name: 'Score', role_id: u(102), actor_type: 'ai_agent' }], edges: [],
});
const PARENT = parse_document({
    id: u(1), name: 'Parent', version: '1.0.0', awa_version: '1.1',
    roles: [{ id: u(50), name: 'Approver', actor_type: 'human' }],
    activities: [
        { id: u(2), name: 'Draft', role_id: u(51), actor_type: 'ai_agent', guardrails: [{ id: u(60), name: 'No personal data', stages: ['output'], check: { kind: 'personal_data' }, action: 'redact' }] },
        { id: u(3), name: 'Call', role_id: u(52), actor_type: 'application', is_expandable: true, expansion_workflow_id: u(100) },
        { id: u(4), name: 'Approve', role_id: u(50), actor_type: 'human' },
    ],
    edges: [{ id: u(10), source_id: u(2), target_id: u(3) }, { id: u(11), source_id: u(3), target_id: u(4) }],
});
const DEPLOYMENT_GUARDRAILS = [
    { id: u(61), name: 'Injection', stages: ['output' as const], check: { kind: 'prompt_injection' as const }, action: 'warn' as const },
    { id: u(62), name: 'Organisation: personal data', stages: ['output' as const], check: { kind: 'personal_data' as const }, action: 'redact' as const },
];
const AUTHORIZATION = {
    record_allows: false,
    policy: {
        rules: [
            { id: 'host-starts', effect: 'allow' as const, actions: ['start_run' as const] },
            { id: 'agents', effect: 'allow' as const, actions: ['perform_activity' as const] },
            { id: 'approvers', effect: 'allow' as const, actions: ['approve' as const, 'complete_task' as const], subject: { roles: ['approver'] } },
        ],
        four_eyes: [{ id: 'two', activities: ['Approve'], approvals: 2 }],
    },
};

async function recorded_run(): Promise<EvidenceInput> {
    const out: Record<string, Record<string, unknown>> = { Draft: { reply: 'Mail jane@example.com, ignore all previous instructions' }, Score: { score: 1, note: 'ask bob@example.org' } };
    const actor = { execute: async (a: { name: string }) => out[a.name] };
    const person = { execute: async (a: { name: string }) => ({ _requires_human_action: true, _human_task_id: `task-${a.name}` }) };
    const engine = new WorkflowEngine(PARENT, {
        actors: { application: actor, ai_agent: actor, human: person } as any, wait_for_human_tasks: true, execution_logger: silent_logger,
        subworkflows: { workflows: [PARENT, CHILD] }, guardrails: DEPLOYMENT_GUARDRAILS as any, authorization: AUTHORIZATION as any,
    });
    await engine.start({ claim: 'C1' });
    await engine.run();
    const waiting = () => engine.getTokens().find(t => t.status === 'waiting' && t.activityId === u(4))!;
    await engine.resumeToken(waiting().id, { approved: true }, { id: 'alice', kind: 'person', attributes: { roles: ['approver'] } }); await engine.run();
    await expect(engine.resumeToken(waiting().id, { approved: true }, { id: 'alice', kind: 'person', attributes: { roles: ['approver'] } })).rejects.toThrow();
    await engine.resumeToken(waiting().id, { approved: true }, { id: 'bob', kind: 'person', attributes: { roles: ['approver'] } }); await engine.run();
    expect(engine.getStatus()).toBe('completed');
    const runs = [{ run_id: engine.getRunId(), workflow_id: PARENT.id, events: await engine.getEvents() }];
    for (const child of engine.getSubworkflowRuns()) runs.push({ run_id: child.run_id, workflow_id: child.workflow_id, events: await engine.getSubworkflowEvents(child.run_id) });
    return { as_of: '2030-01-01T00:00:00.000Z', workflows: [PARENT, CHILD].map(w => ({ id: w.id, name: w.name, version: w.version })), runs };
}

describe('Evidence of guardrails, authorization and child runs, from an engine\'s own journals', () => {
    it('states each and cites records that exist', async () => {
        const input = await recorded_run();
        const report = compute_evidence(input);
        expect(schema(JSON.parse(JSON.stringify(report))), JSON.stringify(schema.errors?.slice(0, 3))).toBe(true);
        expect(unresolved_citations(report, input)).toEqual([]);
        const part = (id: string) => report.parts.find(p => p.id === id)!;
        const [parent, child] = input.runs!;
        expect(part('operation').summary).toMatchObject({ runs: 2, child_runs: 1, completed: 2, authorizations_allowed: 2 });
        expect(part('operation').statements.find(s => s.kind === 'run' && s.facts.run_id === child.run_id)!.facts)
            .toMatchObject({ depth: 1, parent_run_id: parent.run_id, root_run_id: parent.run_id, principal: { id: 'host', kind: 'service' } });
        expect(report.scope.workflows.find(w => w.workflow_id === CHILD.id)).toMatchObject({ runs: 1, child_runs: 1 });
        expect(part('guardrails').summary).toMatchObject({ triggered: 3, by_action: { redact: 2, warn: 1, block: 0 }, by_stage: { output: 3 }, by_category: { email: 2, ignore_instructions: 1 } });
        // The child run's guardrail is cited from the child's own journal
        const in_child = part('guardrails').statements.find(s => s.facts.node_name === 'Score')!;
        expect(in_child.citations).toEqual([{ run_id: child.run_id, seq: [expect.any(Number)] }]);
        const decision = part('oversight').statements.find(s => s.kind === 'human_decision')!;
        expect(decision.facts).toMatchObject({ principal: { id: 'bob', kind: 'person' }, approvals: [{ id: 'alice' }, { id: 'bob' }], approvers: 2, approvals_required: 2 });
        const cited = (decision.citations[0] as { seq: number[] }).seq.map(seq => parent.events.find(e => e.seq === seq)!.type);
        expect(cited.filter(t => t === 'authorization.decided')).toHaveLength(2);
        expect(part('oversight').summary).toMatchObject({ four_eyes: 1, separation_of_duties: 1 });
        expect(part('refusals').summary).toMatchObject({ authorization: 1, authorization_by_reason: { four_eyes: 1 } });
        // What the guardrails matched is in no statement: the journal never held it
        const text = JSON.stringify(report);
        expect(text).not.toContain('jane@example.com');
        expect(text).not.toContain('bob@example.org');
    });

    it('renders the new statements as Markdown and HTML', async () => {
        const report = compute_evidence(await recorded_run());
        const md = render_evidence_markdown(report);
        expect(md).toContain('## 12. Guardrails');
        expect(md).toContain('| Workflow | Versions | Runs | Of which child runs |');
        // The deployment's guardrail runs first and redacts; the activity's then finds nothing, and is not recorded (31.6, 31.7)
        expect(md).toMatch(/Guardrail "Organisation: personal data" \(personal_data\) found email \(1 finding\) in the output of "Draft" at attempt 1 in run \w+, and redacted what it found\./);
        expect(md).not.toContain('"No personal data"');
        expect(md).toMatch(/A person decided "Approve" in run \w+ at [^|]+ \(bob\), approved by alice and bob \(2 distinct approvers of 2 required\)/);
        expect(md).toMatch(/alice \(person\) was refused the action approve at "Approve" in run \w+: the four-eyes rule two/);
        expect(md).toMatch(/a child run of run \w+ at depth 1/);
        expect(md).toContain('EU AI Act Art. 12(2), Art. 14(4), Art. 15(4), Art. 15(5)');
        expect(md).toContain('Art. 15(5): Cybersecurity');
        const html = render_evidence_html(report);
        expect(html).toContain('<section id="guardrails">');
        expect(html).toContain('<h2>12. Guardrails</h2>');
        expect(html).toContain('Guardrail &quot;Injection&quot; (prompt_injection) found ignore_instructions');
        expect(html).toContain('<th>Of which child runs</th>');
        expect(html).not.toMatch(/<script/);
    });
});

describe('The worked example in examples/claims-settlement/evidence', () => {
    const dir = path.join(ROOT, 'examples/claims-settlement/evidence');
    it('is the report this SDK makes from its journals', async () => {
        const input = await read_evidence_input([path.join(dir, 'journals')]);
        input.as_of = '2026-11-26T09:00:00.000Z';
        const report = compute_evidence(input);
        expect(JSON.parse(JSON.stringify(report))).toEqual(JSON.parse(fs.readFileSync(path.join(dir, 'evidence-report.json'), 'utf-8')));
        expect(render_evidence_markdown(report)).toBe(fs.readFileSync(path.join(dir, 'evidence-report.md'), 'utf-8'));
        expect(render_evidence_html(report)).toBe(fs.readFileSync(path.join(dir, 'evidence-report.html'), 'utf-8'));
        expect(unresolved_citations(report, input)).toEqual([]);
        const part = (id: string) => report.parts.find(p => p.id === id)!;
        expect(part('guardrails').summary).toMatchObject({ by_action: { redact: 2, escalate: 2 }, by_stage: { input: 2, output: 2 } });
        expect(part('oversight').summary).toMatchObject({ four_eyes: 1, separation_of_duties: 2, guardrail_escalations: 2 });
        expect(part('refusals').summary.authorization_by_reason).toEqual({ four_eyes: 1, separation_of_duties: 1 });
    });
});

describe('Evidence sources', () => {
    const temporary = () => fs.mkdtempSync(path.join(os.tmpdir(), 'awa-evidence-'));

    it('reads journal files, directories of journals and runtime directories alike', async () => {
        const dir = temporary();
        const a = activity('Do', { actor_type: 'ai_agent' }), b = activity('Check', { actor_type: 'human' });
        const w = workflow([a, b], [edge(a, b)]);
        const actor = { execute: async () => ({ done: true }) };
        const engine = new WorkflowEngine(w, { journal: new FileJournalStore(path.join(dir, 'journals')), actors: { ai_agent: actor, human: actor }, execution_logger: silent_logger });
        await engine.start({ x: 1 });
        await engine.run();
        const file = path.join(dir, 'journals', `${engine.getRunId()}.journal.jsonl`);

        for (const source of [file, path.join(dir, 'journals'), dir]) {
            const input = await read_evidence_input([source]);
            const report = compute_evidence(input);
            expect(report.parts[0].summary.runs, source).toBe(1);
            expect(report.parts.find(p => p.id === 'oversight')!.summary.human_decisions).toBe(1);
            expect(unresolved_citations(report, input)).toEqual([]);
        }
        expect((await read_journals([dir])).length).toBe((await engine.getEvents()).length);
        await expect(read_evidence_input([path.join(dir, 'missing.json')])).rejects.toThrow();
        fs.writeFileSync(path.join(dir, 'other.json'), '{"name": "not a record"}');
        await expect(read_evidence_input([path.join(dir, 'other.json')])).rejects.toThrow(/neither a portfolio/);
    });

    it('reads a runtime directory without opening it as a host', async () => {
        const dir = temporary();
        await add_definition(dir, JSON.parse(fs.readFileSync(path.join(EXAMPLE, 'policy-purchase.awa.json'), 'utf-8')));
        await add_definition(dir, JSON.parse(fs.readFileSync(path.join(EXAMPLE, 'policy-purchase.journey.json'), 'utf-8')));
        const host = await open_runtime_directory(dir, { engine: { simulate: true, simulated_outputs: JSON.parse(fs.readFileSync(path.join(EXAMPLE, 'simulation.json'), 'utf-8')), execution_logger: silent_logger, sleep: async () => { } } });
        await host.publish({ specversion: '1.0', id: 'e1', source: '/test', type: 'quote.requested', data: { customer_id: 'c-1', vehicle: 'estate' } });
        // The host still holds the directory: evidence is read from its files all the same
        const input = await read_evidence_input([dir]);
        await host.close();
        const report = compute_evidence(input);
        expect(report.scope.journeys).toEqual([{ journey_id: expect.any(String), name: 'Policy Purchase', instances: 1 }]);
        expect(report.parts[0].statements.find(s => s.kind === 'run')!.facts.journey_instance_id).toBe(input.journeys![0].instances[0].instance.id);
        expect(unresolved_citations(report, input)).toEqual([]);
    });
});

describe('awa evidence', () => {
    afterEach(() => vi.restoreAllMocks());
    const run = async (...args: string[]) => {
        let out = '', err = '';
        vi.spyOn(process.stdout, 'write').mockImplementation(((chunk: string) => { out += chunk; return true; }) as typeof process.stdout.write);
        vi.spyOn(console, 'error').mockImplementation((...parts: unknown[]) => { err += parts.join(' ') + '\n'; });
        const exit = vi.spyOn(process, 'exit').mockImplementation(((code?: number) => { throw new Error(`exit ${code}`); }) as typeof process.exit);
        try { await evidenceCommand.parseAsync(args, { from: 'user' }); } catch (error) { if (!String(error).includes('exit')) throw error; }
        const code = exit.mock.calls[0]?.[0];
        vi.restoreAllMocks();
        return { out, err, code };
    };

    it('writes the report as JSON, Markdown and HTML', async () => {
        const json = await run(path.join(EXAMPLE, 'journeys.json'), '--format', 'json', '--workflow', 'Motor Claim Settlement', '--as-of', '2027-04-01T00:00:00Z');
        const report = JSON.parse(json.out);
        expect(report.as_of).toBe('2027-04-01T00:00:00Z');
        expect(report.scope.workflows.map((w: any) => w.name)).toEqual(['Motor Claim Settlement']);
        expect((await run(path.join(EXAMPLE, 'journeys.json'))).out).toContain('# Evidence report');
        const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'awa-evidence-')), 'evidence.html');
        const html = await run(path.join(EXAMPLE, 'journeys.json'), '--format', 'html', '-o', file);
        expect(html.err).toContain('25 run(s)');
        expect(fs.readFileSync(file, 'utf-8')).toContain('<h1>Evidence report</h1>');
    });

    it('refuses what it cannot read', async () => {
        expect((await run(path.join(EXAMPLE, 'journeys.json'), '--format', 'pdf')).code).toBe(1);
        expect((await run(path.join(EXAMPLE, 'journeys.json'), '--from', 'yesterday')).err).toContain('Not an instant');
        expect((await run(path.join(EXAMPLE, 'no-such-file.jsonl'))).code).toBe(1);
    });
});

describe('GET /api/v1/evidence', () => {
    it('reports on what the host recorded, journeys and loose runs alike', async () => {
        const host = new AwaRuntime({ engine: { simulate: true, simulated_outputs: JSON.parse(fs.readFileSync(path.join(EXAMPLE, 'simulation.json'), 'utf-8')), execution_logger: silent_logger, sleep: async () => { } } });
        host.register_workflow(JSON.parse(fs.readFileSync(path.join(EXAMPLE, 'policy-purchase.awa.json'), 'utf-8')));
        const a = activity('Standalone');
        const loose = workflow([a], []);
        host.register_workflow(loose);
        await host.start(loose.id, {});
        set_journey_runtime(host);
        const server = createServer({ request_logging: false }).listen(0);
        await new Promise(resolve => server.once('listening', resolve));
        const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/v1/evidence`;
        try {
            const json = await (await fetch(base)).json() as any;
            expect(json.report).toBe('evidence');
            expect(json.parts[0].summary.runs).toBe(1);
            expect((await fetch(`${base}?workflow_id=${loose.id}&format=md`)).headers.get('content-type')).toContain('text/markdown');
            expect(await (await fetch(`${base}?format=html`)).text()).toContain('<h1>Evidence report</h1>');
            expect((await fetch(`${base}?from=soon`)).status).toBe(400);
            expect((await fetch(`${base}?format=pdf`)).status).toBe(400);
            expect((await (await fetch(`${base}?workflow_id=none`)).json() as any).parts[0].summary.runs).toBe(0);
        } finally {
            set_journey_runtime(undefined);
            await new Promise(resolve => server.close(resolve));
        }
    });
});

describe('GET /api/v1/evidence over runs with child runs', () => {
    it('reports the child runs of runs outside journeys, kept with their run of depth 0', async () => {
        const host = new AwaRuntime({ engine: { simulate: true, execution_logger: silent_logger, sleep: async () => { } } });
        host.register_workflow(JSON.parse(JSON.stringify(CHILD)));
        host.register_workflow(JSON.parse(JSON.stringify({ ...PARENT, activities: PARENT.activities.slice(0, 2), edges: PARENT.edges.slice(0, 1) })));
        await host.start(PARENT.id, {});
        set_journey_runtime(host);
        const server = createServer({ request_logging: false }).listen(0);
        await new Promise(resolve => server.once('listening', resolve));
        const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/v1/evidence`;
        try {
            const json = await (await fetch(base)).json() as any;
            expect(json.parts[0].summary).toMatchObject({ runs: 2, child_runs: 1 });
            const child = json.parts[0].statements.find((s: any) => s.kind === 'run' && s.facts.depth === 1);
            expect(child.facts.workflow_id).toBe(CHILD.id);
            expect(child.citations[0].run_id).toBe(child.facts.run_id);
            // Narrowed to the parent's workflow, its child run is kept with it
            const narrowed = await (await fetch(`${base}?workflow_id=${PARENT.id}`)).json() as any;
            expect(narrowed.parts[0].summary).toMatchObject({ runs: 2, child_runs: 1 });
            expect(narrowed.scope.workflows.map((w: any) => w.workflow_id).sort()).toEqual([PARENT.id, CHILD.id].sort());
            expect(await (await fetch(`${base}?format=md`)).text()).toContain('## 12. Guardrails');
        } finally {
            set_journey_runtime(undefined);
            await new Promise(resolve => server.close(resolve));
        }
    });
});

describe('Evidence of a revisited activity and of any category name (spec 32.3)', () => {
    // A token visits "Draft" twice: an output guardrail escalates on the first visit, an input guardrail on the second
    const at = (seq: number) => `2026-05-04T09:00:${String(seq).padStart(2, '0')}.000Z`;
    const base = (seq: number, type: string, extra: Record<string, unknown> = {}) =>
        ({ spec_version: '1.1', id: `r-${seq}`, run_id: 'r', seq, time: at(seq), type, level: 'execution', workflow_id: 'w', ...extra });
    const on = (node: string) => ({ token_id: 't1', node_id: node, node_name: node === 'draft' ? 'Draft' : 'Review' });
    const guardrail = (stage: string, category: string) => ({
        guardrail_id: '6a0c1e0e-0000-4000-8000-000000000009', name: 'Check', source: 'workflow', stage, check: 'deny_list', action: 'escalate',
        categories: [category], findings: [{ category, path: '/text', start: 0, end: 4 }],
    });
    const events = [
        base(1, 'run.started', { data: { workflow_name: 'Letters', workflow_version: '1.0.0', input: {} } }),
        base(2, 'token.moved', { ...on('draft'), data: { to_node_id: 'draft' } }),
        base(3, 'activity.started', { ...on('draft'), attempt: 1, data: { actor_type: 'ai_agent' } }),
        base(4, 'guardrail.triggered', { ...on('draft'), attempt: 1, data: guardrail('output', 'constructor') }),
        base(5, 'token.waiting', { ...on('draft'), data: { reason: 'human_task' } }),
        base(6, 'token.resumed', { ...on('draft'), data: { waited_ms: 1000 } }),
        base(7, 'activity.completed', { ...on('draft'), data: { actor_type: 'ai_agent', principal: { id: 'alice', kind: 'person' } } }),
        base(8, 'token.moved', { ...on('review'), data: { to_node_id: 'review' } }),
        base(9, 'activity.started', { ...on('review'), attempt: 1, data: { actor_type: 'application' } }),
        base(10, 'activity.completed', { ...on('review'), data: { actor_type: 'application' } }),
        base(11, 'token.moved', { ...on('draft'), data: { to_node_id: 'draft' } }),
        base(12, 'guardrail.triggered', { ...on('draft'), data: guardrail('input', '__proto__') }),
        base(13, 'token.waiting', { ...on('draft'), data: { reason: 'human_task' } }),
        base(14, 'token.resumed', { ...on('draft'), data: { waited_ms: 1000 } }),
        base(15, 'activity.completed', { ...on('draft'), data: { actor_type: 'ai_agent', principal: { id: 'bob', kind: 'person' } } }),
        base(16, 'run.completed', { data: {} }),
    ];
    const report = compute_evidence({ as_of: '2026-05-20T09:00:00.000Z', workflows: [{ id: 'w', name: 'Letters', version: '1.0.0' }], runs: [{ run_id: 'r', workflow_id: 'w', events }] } as unknown as EvidenceInput);
    const part = (id: string) => report.parts.find(p => p.id === id)!;

    it('bounds each human decision to its own visit, so the second decision cites the input guardrail of that visit', () => {
        const decisions = part('oversight').statements.filter(s => s.kind === 'human_decision');
        expect(decisions.map(d => d.facts.principal)).toEqual([{ id: 'alice', kind: 'person' }, { id: 'bob', kind: 'person' }]);
        expect(part('oversight').summary.overrides).toBe(1);
        const cited = (s: typeof decisions[number]) => s.citations.flatMap(c => c.seq);
        expect(cited(decisions[0])).toContain(4);
        expect(cited(decisions[1])).toContain(12);
        expect(cited(decisions[1])).not.toContain(4);
    });

    it('counts a category whatever its name, constructor and __proto__ included', () => {
        expect(part('guardrails').summary.by_category).toEqual(JSON.parse('{"__proto__": 1, "constructor": 1}'));
        const facts = part('guardrails').statements.map(s => s.facts.by_category);
        expect(facts).toEqual([{ constructor: 1 }, JSON.parse('{"__proto__": 1}')]);
    });
});
