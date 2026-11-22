import { describe, it, expect } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import type { AddressInfo } from 'net';
import { WorkflowEngine } from '../src/runtime/workflow_engine';
import { FileJournalStore, InMemoryJournalStore, JournalEvent, canonical_json, hash_payload } from '../src/runtime/journal';
import { FilePersistenceAdapter, InMemoryPersistenceAdapter } from '../src/runtime/persistence';
import { createServer } from '../src/server';
import { activity, edge, workflow, scripted, silent_logger } from './helpers';

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'awa-'));
const types = (events: JournalEvent[]) => events.map(e => e.type);
const no_wait = { sleep: async () => { }, execution_logger: silent_logger };

describe('Execution journal', () => {
    it('numbers events from 1 without gaps and ties them to the run', async () => {
        const a = activity('A'); const b = activity('B');
        const engine = new WorkflowEngine(workflow([a, b], [edge(a, b)]), { ...scripted(), ...no_wait });
        await engine.start({ order: 7 });
        await engine.run();
        const events = await engine.getEvents();
        expect(events.map(e => e.seq)).toEqual(events.map((_, i) => i + 1));
        expect(new Set(events.map(e => e.run_id))).toEqual(new Set([engine.getRunId()]));
        expect(types(events)[0]).toBe('run.started');
        expect(types(events).at(-1)).toBe('run.completed');
    });

    it('delivers events to live listeners as they are recorded', async () => {
        const a = activity('A');
        const engine = new WorkflowEngine(workflow([a], []), { ...scripted(), ...no_wait });
        const seen: string[] = [];
        engine.onEvent(e => seen.push(e.type));
        await engine.start();
        await engine.run();
        expect(seen).toEqual(types(await engine.getEvents()));
    });

    it('persists as JSON Lines and reads back identically', async () => {
        const file = path.join(tmp(), 'run.journal.jsonl');
        const a = activity('A');
        const engine = new WorkflowEngine(workflow([a], []), { ...scripted({ A: { total: 3 } }), ...no_wait, journal: new FileJournalStore(file) });
        await engine.start();
        await engine.run();
        const lines = fs.readFileSync(file, 'utf-8').trim().split('\n').map(l => JSON.parse(l));
        expect(lines).toEqual(await engine.getEvents());
        expect(lines.find(e => e.type === 'activity.completed').data.output).toEqual({ total: 3 });
    });

    it('can journal payload hashes instead of payloads', async () => {
        const a = activity('A');
        const engine = new WorkflowEngine(workflow([a], []),
            { ...scripted({ A: { secret: 'iban' } }), ...no_wait, journal_payloads: 'hash' });
        await engine.start({ customer: 'x' });
        await engine.run();
        const events = await engine.getEvents();
        expect(JSON.stringify(events)).not.toContain('iban');
        expect(events.find(e => e.type === 'activity.completed')!.data.output).toEqual({ sha256: hash_payload({ secret: 'iban' }) });
    });

    it('hashes equal values equally regardless of key order', () => {
        expect(canonical_json({ b: 1, a: { d: 2, c: 3 } })).toBe('{"a":{"c":3,"d":2},"b":1}');
        expect(hash_payload({ a: 1, b: 2 })).toBe(hash_payload({ b: 2, a: 1 }));
    });

    it('records an actor\'s reasoning and the model choice as separate trace levels', async () => {
        const a = activity('A', { actor_type: 'ai_agent' });
        const { actors } = scripted({
            A: {
                output: { decision: 'approve' },
                _reasoning: { plan: ['read claim', 'check policy'], rationale: 'Within limits', confidence: 0.9 },
                _model: { id: 'model-x', provider: 'acme', source: 'role' },
            },
        });
        const engine = new WorkflowEngine(workflow([a], []), { actors, ...no_wait });
        await engine.start();
        await engine.run();
        const events = await engine.getEvents();

        const reasoning = events.find(e => e.type === 'reasoning.recorded')!;
        expect(reasoning.level).toBe('reasoning');
        expect(reasoning.data).toMatchObject({ rationale: 'Within limits', plan: ['read claim', 'check policy'] });

        const meta = events.find(e => e.type === 'meta.recorded')!;
        expect(meta.level).toBe('meta');
        expect(meta.data).toMatchObject({ subject: 'model_selection', decision: 'Use model acme:model-x' });

        // Traces are not workflow data: they must not leak downstream
        const data = engine.getTokens()[0].contextData;
        expect(data._reasoning).toBeUndefined();
        expect(data.output).toEqual({ decision: 'approve' });
    });

    it('records which decision rule matched', async () => {
        const a = activity('A'); const low = activity('Low'); const high = activity('High');
        const d = '11111111-1111-4111-8111-111111111111';
        const eLow = edge({ id: d }, low); const eHigh = edge({ id: d }, high);
        const wf = workflow([a, low, high], [edge(a, { id: d }), eLow, eHigh], {
            decision_nodes: [{
                id: d, name: 'Risk',
                decision_table: {
                    hit_policy: 'first',
                    inputs: [{ name: 'amount', type: 'number' }], outputs: [{ name: 'route', type: 'string' }],
                    rules: [
                        { input_entries: ['< 100'], output_entries: ['low'], output_edge_id: eLow.id },
                        { input_entries: ['>= 100'], output_entries: ['high'], output_edge_id: eHigh.id },
                    ],
                },
            }],
        });
        const engine = new WorkflowEngine(wf, { ...scripted({ A: { amount: 500 } }), ...no_wait });
        await engine.start();
        expect(await engine.run()).toBe('completed');
        const event = (await engine.getEvents()).find(e => e.type === 'decision.evaluated')!;
        expect(event.data).toMatchObject({ matched: true, inputs: { amount: 500 }, edge_id: eHigh.id });
        expect((event.data.matched_rules as { index: number }[])[0].index).toBe(1);
    });
});

describe('Retry and dead-lettering', () => {
    const retry = { max_attempts: 3, initial_delay: 'PT1S', jitter: false };

    it('backs off exponentially between attempts', async () => {
        const a = activity('A', { retry });
        const delays: number[] = [];
        const { actor, actors } = scripted({ A: [new Error('timeout'), new Error('timeout'), { ok: true }] });
        const engine = new WorkflowEngine(workflow([a], []),
            { actors, execution_logger: silent_logger, sleep: async ms => { delays.push(ms); } });
        await engine.start();
        expect(await engine.run()).toBe('completed');
        expect(actor.count('A')).toBe(3);
        expect(delays).toEqual([1000, 2000]);
    });

    it('gives every attempt the same idempotency key', async () => {
        const a = activity('A', { retry });
        const { actor, actors } = scripted({ A: [new Error('timeout'), { ok: true }] });
        const engine = new WorkflowEngine(workflow([a], []), { actors, ...no_wait });
        await engine.start();
        await engine.run();
        const keys = actor.calls.map(c => c.inputs._idempotency_key);
        expect(keys[0]).toBeTruthy();
        expect(keys[0]).toBe(keys[1]);
        expect(actor.calls.map(c => c.inputs._attempt)).toEqual([1, 2]);
    });

    it('dead-letters an activity whose retries are exhausted and explains each retry', async () => {
        const a = activity('A', { retry });
        const engine = new WorkflowEngine(workflow([a], []), { ...scripted({ A: new Error('down') }), ...no_wait });
        await engine.start();
        expect(await engine.run()).toBe('failed');
        expect(engine.getDeadLetterQueue().list()).toHaveLength(1);
        const events = await engine.getEvents();
        expect(events.filter(e => e.type === 'activity.retry_scheduled')).toHaveLength(2);
        const meta = events.filter(e => e.type === 'meta.recorded' && e.data.subject === 'retry');
        expect(meta).toHaveLength(2);
        expect(String(meta[0].data.rationale)).toMatch(/down/);
    });

    it('applies the engine default policy to activities without their own', async () => {
        const a = activity('A');
        const { actor, actors } = scripted({ A: [new Error('timeout'), { ok: true }] });
        const engine = new WorkflowEngine(workflow([a], []), { actors, ...no_wait, retry: { max_retries: 1 } });
        await engine.start();
        expect(await engine.run()).toBe('completed');
        expect(actor.count('A')).toBe(2);
    });
});

describe('Checkpoint and recovery', () => {
    it('continues a run in a new engine with no gap in the journal', async () => {
        const dir = tmp();
        const journal = new FileJournalStore(dir);
        const checkpoint = new FilePersistenceAdapter(dir);
        const a = activity('A'); const b = activity('B'); const c = activity('C');
        const wf = workflow([a, b, c], [edge(a, b), edge(b, c)]);

        // First process: runs A, then "crashes"
        const first = new WorkflowEngine(wf, { ...scripted({ A: { step: 'a' } }), ...no_wait, journal, checkpoint });
        await first.start({ order: 1 });
        await first.runStep();
        const runId = first.getRunId();

        // Second process: knows only the run id
        const state = await checkpoint.load(runId);
        expect(state).not.toBeNull();
        const { actor, actors } = scripted({ B: { step: 'b' } });
        const second = WorkflowEngine.restore(wf, state!, { actors, ...no_wait, journal, checkpoint });
        expect(second.getRunId()).toBe(runId);
        expect(await second.run()).toBe('completed');

        expect(actor.calls.map(c => c.activity)).toEqual(['B', 'C']); // A is not repeated
        expect(second.getTokens()[0].contextData).toMatchObject({ order: 1, step: 'b' });

        const events = await second.getEvents();
        expect(events.map(e => e.seq)).toEqual(events.map((_, i) => i + 1));
        expect(types(events)).toContain('run.resumed');
        expect(types(events).at(-1)).toBe('run.completed');
    });

    it('re-executes the activity that was in flight (at least once)', async () => {
        const checkpoint = new InMemoryPersistenceAdapter();
        const journal = new InMemoryJournalStore();
        const a = activity('A'); const b = activity('B');
        const wf = workflow([a, b], [edge(a, b)]);
        const first = new WorkflowEngine(wf, { ...scripted(), ...no_wait, journal, checkpoint });
        await first.start();
        await first.runStep(); // A done, token now at B; crash before B finishes

        const { actor, actors } = scripted();
        const second = WorkflowEngine.restore(wf, (await checkpoint.load(first.getRunId()))!, { actors, ...no_wait, journal, checkpoint });
        await second.run();
        expect(actor.calls.map(c => c.activity)).toEqual(['B']);
    });

    it('refuses a checkpoint that belongs to another workflow', async () => {
        const a = activity('A');
        const engine = new WorkflowEngine(workflow([a], []), { ...scripted(), ...no_wait });
        await engine.start();
        expect(() => WorkflowEngine.restore(workflow([activity('X')], []), engine.snapshot())).toThrow(/belongs to workflow/);
    });
});

describe('Live event stream', () => {
    it('serves run status, the journal, and a Server-Sent Events stream', async () => {
        const dir = tmp();
        const a = '22222222-2222-4222-8222-222222222222';
        fs.writeFileSync(path.join(dir, 'wf.awa.json'), JSON.stringify({
            id: '33333333-3333-4333-8333-333333333333', name: 'Live', version: '1.0.0',
            activities: [{ id: a, name: 'A', role_id: a, actor_type: 'application' }], edges: [],
        }));
        process.env.AWA_WORKFLOWS_DIR = dir;
        const server = createServer({ request_logging: false }).listen(0);
        const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/v1/workflows`;
        try {
            const started = await (await fetch(`${base}/run`, {
                method: 'POST', headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ filePath: 'wf.awa.json' }),
            })).json() as { runId: string };

            // Read the SSE stream until the run-completed event arrives
            const response = await fetch(`${base}/runs/${started.runId}/events/stream`);
            expect(response.headers.get('content-type')).toContain('text/event-stream');
            const reader = response.body!.getReader();
            let text = '';
            while (!text.includes('event: run.completed')) {
                const { value, done } = await reader.read();
                if (done) break;
                text += new TextDecoder().decode(value);
            }
            await reader.cancel();
            const streamed = text.split('\n').filter(l => l.startsWith('event: ')).map(l => l.slice(7));
            expect(streamed[0]).toBe('run.started');
            expect(streamed.at(-1)).toBe('run.completed');

            const status = await (await fetch(`${base}/runs/${started.runId}`)).json() as { status: string };
            expect(status.status).toBe('completed');

            const events = await (await fetch(`${base}/runs/${started.runId}/events`)).json() as JournalEvent[];
            expect(events.map(e => e.type)).toEqual(streamed);

            const outside = await fetch(`${base}/run`, {
                method: 'POST', headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ filePath: '../../etc/passwd' }),
            });
            expect(outside.status).toBe(400);
        } finally {
            server.close();
            delete process.env.AWA_WORKFLOWS_DIR;
        }
    });
});
