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
        expect(report.parts.map(p => p.id)).toEqual(['operation', 'models', 'oversight', 'outcomes', 'refusals', 'failures', 'compensations', 'service_levels', 'tools', 'data', 'retention']);
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
