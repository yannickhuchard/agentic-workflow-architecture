/**
 * Shadow runs (specification section 33.5): a candidate model beside
 * production. The shadow sees the same input and events, never runs a tool,
 * and its journal is compared with production's as runs end.
 */
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { AwaRuntime } from '../src/runtime/runtime';
import { FunctionModelProvider, ModelRequest } from '../src/runtime/models';
import { WorkflowEngine, WorkflowEngineOptions } from '../src/runtime/workflow_engine';
import { activity, edge, silent_logger, workflow } from './helpers';

const prompt = (request: ModelRequest) => [request.system, request.prompt, ...(request.messages || []).map(m => m.content)].join('\n');
const answered = (request: ModelRequest) => (request.messages || []).some(m => m.role === 'tool');

/** A workflow whose agent writes a note to a file with a command-line tool, then is routed by its score */
function setting() {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'awa-shadow-'));
    const note = path.join(dir, 'notes.txt');
    const prepare = activity('Prepare', {
        actor_type: 'ai_agent',
        tools: [{
            name: 'write_note', description: 'Writes a note to a file', parameters: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] },
            binding: { kind: 'command', command: process.execPath, args: ['-e', "require('fs').appendFileSync(process.argv[1], 'written\\n')", '{path}'] },
        }],
    } as never);
    const pay = activity('Pay'), review = activity('Review', { actor_type: 'human' });
    const w = workflow([prepare, pay, review], [edge(prepare, pay, { condition: 'score >= 5' }), edge(prepare, review, { is_default: true })]);
    return { dir, note, w };
}

/** A model that writes the note, then gives a score: 7 in production, and in the candidate 7 for claim A and 3 otherwise */
function model(id: string, score: (claim: string) => number, path_for: (claim: string, note: string) => string, note: string) {
    return new FunctionModelProvider(id, request => {
        const claim = /"claim":\s*"([A-Z])"/.exec(prompt(request))?.[1] || '?';
        if (!answered(request)) return { text: '', tool_calls: [{ id: 'n1', name: 'write_note', arguments: { path: path_for(claim, note) } }] };
        return JSON.stringify({ reasoning: { plan: ['note', 'score'], rationale: 'scripted', confidence: 1 }, output: { score: score(claim) } });
    });
}
const models = (provider: FunctionModelProvider): WorkflowEngineOptions => ({
    model_providers: [provider], default_model_provider: provider.id, model_tiers: { balanced: `${provider.id}:m`, fast: `${provider.id}:m`, reasoning: `${provider.id}:m` },
});
const human = { execute: async () => ({ reviewed: true }) };

describe('Shadow runs', () => {
    it('never calls a tool, and compares each run with production as it ends', async () => {
        const { dir, note, w } = setting();
        let executor_called = false;
        const runtime = new AwaRuntime({
            engine: { ...models(model('production', () => 7, (_c, n) => n, note)), tools: { allow_commands: true }, actors: { human }, execution_logger: silent_logger, sleep: async () => { } },
            shadow: {
                engine: {
                    ...models(model('candidate', claim => (claim === 'A' ? 7 : 3), (claim, n) => (claim === 'A' ? n : path.join(dir, 'other.txt')), note)),
                    // A shadow takes no tools, no actors other than the AI agent, and no event sink, whatever it is given
                    tools: { allow_commands: true, executors: { command: async () => { executor_called = true; return { result: 'ran' }; } } },
                    actors: { human: { execute: async () => { throw new Error('a person was asked'); } } },
                    event_sink: async () => { throw new Error('an event was published'); },
                },
            },
        });
        runtime.register_workflow(w);
        const a = await runtime.start(w.id, { claim: 'A' });
        const b = await runtime.start(w.id, { claim: 'B' });
        expect(a.getStatus()).toBe('completed');
        expect(b.getStatus()).toBe('completed');

        // Production wrote one note per run; the shadows wrote nothing, not even where they asked for another file
        expect(fs.readFileSync(note, 'utf-8')).toBe('written\nwritten\n');
        expect(fs.existsSync(path.join(dir, 'other.txt'))).toBe(false);
        expect(executor_called).toBe(false);

        const [first, second] = runtime.shadow!.comparisons();
        expect(first).toMatchObject({ production_run_id: a.getRunId(), production_status: 'completed', shadow_status: 'completed', parted: false });
        expect(second).toMatchObject({ production_run_id: b.getRunId(), production_status: 'completed', shadow_status: 'failed', parted: true });
        expect(second.report!.divergence).toEqual({ after: 'Prepare', baseline_next: 'Pay', candidate_next: 'Review' });
        // The tool call with production's arguments was answered from the record; the other could not be
        expect(first.report!.unrecorded).toEqual([]);
        expect(second.report!.unrecorded).toEqual(expect.arrayContaining([expect.stringContaining('write_note'), 'activity "Review"']));
        // The shadow journal records the call as made, but nothing ran
        const shadow = runtime.shadow!.shadow_journal(a.getRunId())!;
        expect(shadow.find(e => e.type === 'tool.completed')!.data.result).toEqual((await a.getEvents()).find(e => e.type === 'tool.completed')!.data.result);
        expect(shadow[0].run_id).not.toBe(a.getRunId());

        const report = runtime.shadow!.report();
        expect(report.parted).toEqual([b.getRunId()]);
        expect(report.workflows).toHaveLength(1);
        expect(report.workflows[0]).toMatchObject({ runs: 2, parted: 1 });
        expect(report.workflows[0].production['workflow.success_rate']).toEqual({ value: 1, n: 2 });
        expect(report.workflows[0].shadow['workflow.success_rate']).toEqual({ value: 0.5, n: 2 });
        expect(report.workflows[0].production['workflow.tool_calls']).toEqual(report.workflows[0].shadow['workflow.tool_calls']);
        expect(report.runs.find(r => r.production_run_id === b.getRunId())!.regressions.length).toBeGreaterThan(0);

        // Each run is shadowed once, however often the host looks at it again
        await runtime.tick();
        expect(runtime.shadow!.comparisons()).toHaveLength(2);
    });

    it('records a shadow that cannot run without touching production, and leaves cancelled and unselected runs alone', async () => {
        const { note, w } = setting();
        const other = workflow([activity('Elsewhere')], []);
        const seen: string[] = [];
        const runtime = new AwaRuntime({
            engine: { ...models(model('production', () => 7, (_c, n) => n, note)), tools: { allow_commands: true }, journal_payloads: 'hash', execution_logger: silent_logger, sleep: async () => { } },
            shadow: { candidates: { [w.id]: w }, engine: models(model('candidate', () => 7, (_c, n) => n, note)), on_comparison: c => { seen.push(c.production_run_id); throw new Error('a listener that fails'); } },
        });
        runtime.register_workflow(w).register_workflow(other);
        const run = await runtime.start(w.id, { claim: 'A' });
        expect(run.getStatus()).toBe('completed');
        const [comparison] = runtime.shadow!.comparisons();
        expect(comparison).toMatchObject({ shadow_status: 'not_run', parted: true, report: null });
        expect(comparison.error).toMatch(/payload mode/);
        expect(seen).toEqual([run.getRunId()]);

        await runtime.start(other.id, {});
        expect(runtime.shadow!.shadows(other.id)).toBe(false);
        expect(runtime.shadow!.comparisons()).toHaveLength(1);
        expect(runtime.shadow!.report().runs[0].error).toMatch(/payload mode/);

        // A run withdrawn from outside is not shadowed: a shadow cannot be told what withdrew it
        const withdrawn = new WorkflowEngine(w, { execution_logger: silent_logger });
        await withdrawn.start({ claim: 'C' });
        expect(await withdrawn.cancel('the customer left')).toBe(true);
        expect(await runtime.shadow!.settled(withdrawn)).toBeUndefined();
        expect(runtime.shadow!.comparisons()).toHaveLength(1);
    });
});
