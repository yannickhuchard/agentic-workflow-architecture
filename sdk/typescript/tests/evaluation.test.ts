/**
 * Evaluation from journals (specification section 33): datasets built from the
 * claims-settlement runs, and a candidate model that does better on one
 * activity and worse on another. Offline and deterministic: the candidate's
 * model is a function.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import Ajv2020 from 'ajv/dist/2020';
import addFormats from 'ajv-formats';
import { build_dataset, dataset_to_jsonl, evaluate_dataset, parse_dataset, render_evaluation_report, EvaluationCase } from '../src/runtime/evaluation';
import { FunctionModelProvider, ModelRequest } from '../src/runtime/models';
import { JournalEvent, parse_journal } from '../src/runtime/journal';
import { WorkflowEngine, WorkflowEngineOptions } from '../src/runtime/workflow_engine';
import { parse_document } from '../src/validator';
import { evalCommand } from '../src/cli/commands/eval';
import { silent_logger } from './helpers';

const ROOT = path.resolve(__dirname, '../../..');
const EXAMPLE = path.join(ROOT, 'examples/claims-settlement');
const workflow = parse_document(JSON.parse(fs.readFileSync(path.join(EXAMPLE, 'claims-settlement.awa.json'), 'utf-8')));
const recorded = fs.readdirSync(path.join(EXAMPLE, 'runs')).filter(f => f.endsWith('.jsonl')).sort()
    .flatMap(f => parse_journal(fs.readFileSync(path.join(EXAMPLE, 'runs', f), 'utf-8')));
const ajv = new Ajv2020({ strict: false, allErrors: true }); addFormats(ajv);
const case_schema = ajv.compile(JSON.parse(fs.readFileSync(path.join(ROOT, 'spec/json-schema/evaluation-case.schema.json'), 'utf-8')));
const report_schema = ajv.compile(JSON.parse(fs.readFileSync(path.join(ROOT, 'spec/json-schema/evaluation-report.schema.json'), 'utf-8')));

/** One more run, in which the fraud check never produced a probability: a rejected case */
async function run_with_rejected_fraud_check(): Promise<JournalEvent[]> {
    const outputs = JSON.parse(fs.readFileSync(path.join(EXAMPLE, 'simulation.json'), 'utf-8'));
    outputs['Check fraud signals'] = { output: { output: { fraud_score: 3 } } };
    const engine = new WorkflowEngine(workflow, { simulate: true, simulated_outputs: outputs, execution_logger: silent_logger, sleep: async () => { } });
    const started = recorded.find(e => e.type === 'run.started')!;
    await engine.start(started.data.input as Record<string, unknown>);
    expect(await engine.run()).toBe('failed');
    return engine.getEvents();
}

const text_of = (request: ModelRequest) => [request.system, request.prompt, ...(request.messages || []).map(m => m.content)].join('\n');
const has_tool_results = (request: ModelRequest) => (request.messages || []).some(m => m.role === 'tool');
const reply = (output: unknown) => JSON.stringify({ reasoning: { plan: ['answer'], rationale: 'scripted', confidence: 0.9 }, output });

/** The candidate: assesses as before, checks fraud better, writes to the claimant worse */
function candidate_model(calls: string[] = []) {
    return new FunctionModelProvider('candidate', request => {
        const text = text_of(request);
        if (text.includes('"Assess damage"')) {
            calls.push('Assess damage');
            if (!has_tool_results(request)) {
                return { text: '', tool_calls: [{ id: 'p1', name: 'price_part', arguments: { part: 'rear bumper', vehicle: '2021 hatchback' } }, { id: 'p2', name: 'price_part', arguments: { part: 'tailgate', vehicle: '2021 hatchback' } }] };
            }
            return reply({ estimated_cost: 3200, severity: 'moderate', summary: 'Low-speed rear-end collision; bumper and tailgate to replace.', parts: [{ part: 'rear bumper', cost: 1150 }, { part: 'tailgate', cost: 1400 }, { part: 'labour and paint', cost: 650 }] });
        }
        if (text.includes('"Check fraud signals"')) { calls.push('Check fraud signals'); return reply({ fraud_score: 0.1, signals: [] }); }
        if (text.includes('"Notify claimant"')) { calls.push('Notify claimant'); return reply({ text: 'Your claim is settled.' }); }
        throw new Error('the candidate was asked about an activity it does not know');
    });
}
const candidate_engine = (calls?: string[]): WorkflowEngineOptions => ({
    model_providers: [candidate_model(calls)], default_model_provider: 'candidate',
    model_tiers: { reasoning: 'candidate:m', balanced: 'candidate:m', fast: 'candidate:m' },
    execution_logger: silent_logger, sleep: async () => { },
});

describe('Datasets from the claims-settlement runs', () => {
    it('makes a case of every visit to an AI activity, accepted or rejected', async () => {
        const { cases, skipped } = build_dataset([...recorded, ...await run_with_rejected_fraud_check()]);
        for (const c of cases) expect(case_schema(c), JSON.stringify(case_schema.errors)).toBe(true);
        expect(skipped).toEqual([]);
        const by = (name: string) => cases.filter(c => c.activity_name === name);
        expect(by('Assess damage').map(c => c.accepted_by)).toEqual(['verification', 'verification', 'verification', 'verification']);
        expect(by('Check fraud signals').map(c => c.label)).toEqual(['accepted', 'accepted', 'accepted', 'rejected']);
        expect(by('Check fraud signals')[3]).toMatchObject({ rejected_by: 'contract', attempts: 3, rejections: [{ terms: ['Score is a probability'] }, {}, {}] });
        expect(by('Notify claimant')).toHaveLength(2);
        // No case of an application, a person or a decision
        expect(new Set(cases.map(c => c.activity_name))).toEqual(new Set(['Assess damage', 'Check fraud signals', 'Notify claimant']));
        // The first assessment was rejected by its contract, then accepted with the parts priced by the tool
        const first = by('Assess damage')[0];
        expect(first.rejections[0]).toMatchObject({ attempt: 1, code: 'CONTRACT_VIOLATION' });
        expect(first.tool_calls.map(t => t.arguments)).toEqual([{ part: 'rear bumper', vehicle: '2021 hatchback' }, { part: 'tailgate', vehicle: '2021 hatchback' }]);
        // Each case cites journal records of its run
        for (const c of cases) {
            const journal = [...recorded].filter(e => e.run_id === c.run_id);
            if (journal.length) for (const seq of c.sources) expect(journal.some(e => e.seq === seq)).toBe(true);
        }
        expect(parse_dataset(dataset_to_jsonl(cases))).toEqual(cases);
    });

    it('leaves out what the journal does not hold', async () => {
        const engine = new WorkflowEngine(workflow, {
            simulate: true, simulated_outputs: JSON.parse(fs.readFileSync(path.join(EXAMPLE, 'simulation.json'), 'utf-8')),
            journal_payloads: 'hash', execution_logger: silent_logger, sleep: async () => { },
        });
        await engine.start({ claimant: 'x' });
        await engine.run();
        const { cases, skipped } = build_dataset(await engine.getEvents());
        expect(cases).toEqual([]);
        expect(skipped.length).toBeGreaterThan(0);
        expect(skipped[0].reason).toContain('payload mode');
    });
});

describe('Evaluating a candidate against the dataset', () => {
    it('shows the activity it improves and the activity it worsens', async () => {
        const extra = await run_with_rejected_fraud_check();
        const { cases } = build_dataset([...recorded, ...extra]);
        const calls: string[] = [];
        const report = await evaluate_dataset(workflow, cases, { engine: candidate_engine(calls) });
        expect(report_schema(JSON.parse(JSON.stringify(report))), JSON.stringify(report_schema.errors?.slice(0, 3))).toBe(true);
        expect(report.evaluated).toBe(10);
        const activity = (name: string) => report.activities.find(a => a.activity_name === name)!;

        // Improved: the rejected fraud check is now accepted
        expect(activity('Check fraud signals')).toMatchObject({ cases: 4, recorded_rate: { value: 0.75, n: 4 }, pass_rate: { value: 1, n: 4 }, contract_pass_rate: { value: 1, n: 4 }, regressions: [] });
        expect(activity('Check fraud signals').improvements).toEqual([cases.find(c => c.label === 'rejected')!.id]);
        // Worsened: neither notification has a message any more
        expect(activity('Notify claimant')).toMatchObject({ cases: 2, recorded_rate: { value: 1, n: 2 }, pass_rate: { value: 0, n: 2 }, contract_pass_rate: { value: 0, n: 2 } });
        expect(activity('Notify claimant').regressions).toHaveLength(2);
        // Unchanged: the assessment passes its contract and its verification, as recorded
        expect(activity('Assess damage')).toMatchObject({ cases: 4, pass_rate: { value: 1, n: 4 }, verification_pass_rate: { value: 1, n: 4 }, regressions: [], improvements: [] });

        expect(report.regressions.map(r => r.activity_name)).toEqual(['Notify claimant', 'Notify claimant']);
        expect(report.regressions[0].reason).toContain('CONTRACT_VIOLATION');
        expect(report.improvements.map(r => r.activity_name)).toEqual(['Check fraud signals']);

        // The tools answered from the recording: the cases that recorded the calls found them; the one that did not, did not
        const assess = report.results.filter(r => r.activity_name === 'Assess damage');
        expect(assess.filter(r => r.unrecorded.length === 0)).toHaveLength(3);
        expect(assess.find(r => r.unrecorded.length)!.unrecorded).toHaveLength(2);
        expect(calls.filter(c => c === 'Notify claimant')).toHaveLength(6);    // three attempts for each of the two cases

        const md = render_evaluation_report(report);
        expect(md).toContain('## Regressions');
        expect(md).toContain('## Improvements');
        expect(md).toMatch(/\| Check fraud signals \| 4 \| 75% of 4 \| 100% of 4 \|/);
        expect(md).toMatch(/\| Notify claimant \| 2 \| 100% of 2 \| 0% of 2 \|/);

        // Deterministic: the same dataset and the same candidate give the same report
        expect(await evaluate_dataset(workflow, cases, { engine: candidate_engine() })).toEqual(report);
    });

    it('holds a candidate workflow to its own terms, and skips what it cannot match', async () => {
        const { cases } = build_dataset(recorded);
        const stricter = JSON.parse(JSON.stringify(workflow));
        const notify = stricter.activities.find((a: any) => a.name === 'Notify claimant');
        notify.outcome_contract.output_schema = { type: 'object', properties: { message: { type: 'string', maxLength: 10 } } };
        stricter.activities = stricter.activities.filter((a: any) => a.name !== 'Check fraud signals');
        const report = await evaluate_dataset(workflow, cases, {
            candidate: parse_document(stricter),
            engine: { ...candidate_engine(), actors: { ai_agent: { execute: async (activity) => (activity.name === 'Notify claimant' ? { message: 'This message is too long to pass' } : { estimated_cost: 1, severity: 'minor', summary: 'A scratch on the rear bumper, nothing more.', parts: ['bumper'] }) } } },
        });
        expect(report.skipped.map(s => s.reason)).toEqual(Array(3).fill(expect.stringContaining('the candidate has no activity')));
        expect(report.activities.find(a => a.activity_name === 'Notify claimant')).toMatchObject({ pass_rate: { value: 0, n: 2 }, contract_pass_rate: { value: 0, n: 2 } });
        expect(report.activities.find(a => a.activity_name === 'Assess damage')).toMatchObject({ pass_rate: { value: 1, n: 3 }, same_outcome_rate: { value: 0, n: 3 } });
    });

    it('rejects a case whose candidate model fails, and runs nothing else', async () => {
        const { cases } = build_dataset(recorded);
        const failing = new FunctionModelProvider('down', () => { throw Object.assign(new Error('unavailable'), { code: 'UNAVAILABLE' }); });
        const one: EvaluationCase[] = [cases.find(c => c.activity_name === 'Notify claimant')!];
        const report = await evaluate_dataset(workflow, one, { engine: { model_providers: [failing], default_model_provider: 'down', model_tiers: { balanced: 'down:m', fast: 'down:m', reasoning: 'down:m' }, execution_logger: silent_logger, sleep: async () => { } } });
        expect(report.results[0]).toMatchObject({ recorded: 'accepted', candidate: 'rejected', change: 'regressed' });
        expect(report.results[0].error).toMatch(/unavailable/);
    });
});

describe('awa eval', () => {
    afterEach(() => vi.restoreAllMocks());
    const run = async (...args: string[]) => {
        let out = '', err = '';
        vi.spyOn(process.stdout, 'write').mockImplementation(((chunk: string) => { out += chunk; return true; }) as typeof process.stdout.write);
        vi.spyOn(console, 'error').mockImplementation((...parts: unknown[]) => { err += parts.join(' ') + '\n'; });
        const exit = vi.spyOn(process, 'exit').mockImplementation(((code?: number) => { throw new Error(`exit ${code}`); }) as typeof process.exit);
        try { await evalCommand.parseAsync(args, { from: 'user' }); } catch (error) { if (!String(error).includes('exit')) throw error; }
        const code = exit.mock.calls[0]?.[0];
        vi.restoreAllMocks();
        return { out, err, code };
    };

    it('builds a dataset from journals', async () => {
        const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'awa-eval-')), 'dataset.jsonl');
        const result = await run('build', path.join(EXAMPLE, 'runs'), '-o', file);
        expect(result.code).toBeUndefined();
        expect(result.err).toContain('8 case(s)');
        const cases = parse_dataset(fs.readFileSync(file, 'utf-8'));
        expect(cases).toHaveLength(8);
        for (const c of cases) expect(case_schema(c)).toBe(true);
    });

    it('refuses to evaluate without a model to run the candidate', async () => {
        const saved = process.env.GEMINI_API_KEY;
        delete process.env.GEMINI_API_KEY;
        try {
            const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'awa-eval-'));
            fs.writeFileSync(path.join(dir, 'dataset.jsonl'), dataset_to_jsonl(build_dataset(recorded).cases));
            const result = await run('run', path.join(EXAMPLE, 'claims-settlement.awa.json'), path.join(dir, 'dataset.jsonl'));
            expect(result.code).toBe(1);
            expect(result.err).toContain('--providers');
            expect((await run('run', path.join(EXAMPLE, 'claims-settlement.awa.json'), path.join(dir, 'dataset.jsonl'), '--providers', 'nobody')).err).toContain('Unknown provider');
        } finally { if (saved !== undefined) process.env.GEMINI_API_KEY = saved; }
    });
});
