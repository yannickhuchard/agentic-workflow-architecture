import { describe, it, expect } from 'vitest';
import { v4 as uuidv4 } from 'uuid';
import { WorkflowEngine } from '../src/runtime/workflow_engine';
import { InMemoryPersistenceAdapter } from '../src/runtime/persistence';
import { InMemoryJournalStore } from '../src/runtime/journal';
import { validate_workflow_integrity } from '../src/validator';
import { activity, edge, workflow, scripted, silent_logger } from './helpers';

const quiet = { execution_logger: silent_logger };
const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

describe('Parallel branches', () => {
    it('run concurrently, not one after another', async () => {
        const a = activity('A'); const b = activity('B'); const c = activity('C'); const d = activity('D', { join: 'all' });
        const spans: Record<string, [number, number]> = {};
        const slow = (name: string) => async () => {
            const start = Date.now();
            await wait(80);
            spans[name] = [start, Date.now()];
            return { [name]: true };
        };
        const { actors } = scripted({ B: slow('B'), C: slow('C') });
        const engine = new WorkflowEngine(workflow([a, b, c, d], [edge(a, b), edge(a, c), edge(b, d), edge(c, d)]), { actors, ...quiet });
        await engine.start();
        expect(await engine.run()).toBe('completed');
        expect(spans.C[0]).toBeLessThan(spans.B[1]); // C started before B finished
        expect(spans.B[0]).toBeLessThan(spans.C[1]);
    });

    it('give each branch its own copy of the data and merge them at the join', async () => {
        const a = activity('A'); const b = activity('B'); const c = activity('C'); const d = activity('D', { join: 'all' });
        const { actor, actors } = scripted({ A: { base: 1 }, B: { left: 'l', shared: 'from-b' }, C: { right: 'r', shared: 'from-c' } });
        const engine = new WorkflowEngine(workflow([a, b, c, d], [edge(a, b), edge(a, c), edge(b, d), edge(c, d)]), { actors, ...quiet });
        await engine.start();
        await engine.run();

        const seenByD = actor.calls.find(call => call.activity === 'D')!.inputs;
        // Later incoming edge (C -> D) wins a conflict
        expect(seenByD).toMatchObject({ base: 1, left: 'l', right: 'r', shared: 'from-c' });
        // Neither branch's own result is lost
        const archive = seenByD.activities as Record<string, { output: Record<string, unknown> }>;
        expect(archive[b.id].output.shared).toBe('from-b');
        expect(archive[c.id].output.shared).toBe('from-c');

        expect(engine.getTokens().map(t => t.status).sort()).toEqual(['completed', 'joined']);
    });

    it('survive a checkpoint taken while one branch waits at the join', async () => {
        const a = activity('A'); const b = activity('B'); const c1 = activity('C1'); const c2 = activity('C2'); const d = activity('D', { join: 'all' });
        const wf = workflow([a, b, c1, c2, d], [edge(a, b), edge(a, c1), edge(c1, c2), edge(b, d), edge(c2, d)]);
        const checkpoint = new InMemoryPersistenceAdapter(); const journal = new InMemoryJournalStore();
        const first = new WorkflowEngine(wf, { ...scripted(), ...quiet, checkpoint, journal });
        await first.start();
        await first.runStep(); // A
        await first.runStep(); // B and C1; B's token now parked at D
        expect(first.getTokens().map(t => t.status).sort()).toEqual(['active', 'joining']);

        const second = WorkflowEngine.restore(wf, (await checkpoint.load(first.getRunId()))!, { ...scripted(), ...quiet, checkpoint, journal });
        expect(await second.run()).toBe('completed');
        expect((await second.getEvents()).filter(e => e.type === 'token.joined')).toHaveLength(1);
    });
});

describe('Timers', () => {
    const timerWorkflow = (duration: string) => {
        const a = activity('A'); const b = activity('B');
        const timer = { id: uuidv4(), name: 'Cool off', event_type: 'timer', event_definition: { duration } };
        return workflow([a, b], [edge(a, timer), edge(timer, b)], { events: [timer] });
    };

    it('wait for the stated duration', async () => {
        const slept: number[] = [];
        const engine = new WorkflowEngine(timerWorkflow('PT2H'), { ...scripted(), ...quiet, sleep: async ms => { slept.push(ms); } });
        await engine.start();
        expect(await engine.run()).toBe('completed');
        expect(slept).toHaveLength(1);
        expect(slept[0]).toBeGreaterThan(2 * 3600 * 1000 - 5000);
        expect(slept[0]).toBeLessThanOrEqual(2 * 3600 * 1000);
    });

    it('keep their deadline across a restart instead of starting again', async () => {
        const wf = timerWorkflow('PT1H');
        const checkpoint = new InMemoryPersistenceAdapter(); const journal = new InMemoryJournalStore();
        const first = new WorkflowEngine(wf, { ...scripted(), ...quiet, checkpoint, journal, sleep: async () => { } });
        await first.start();
        await first.runStep(); // A
        await first.runStep(); // timer started, deadline recorded
        const state = (await checkpoint.load(first.getRunId()))!;

        await wait(60); // time passes while the engine is down
        const slept: number[] = [];
        const second = WorkflowEngine.restore(wf, state, { ...scripted(), ...quiet, checkpoint, journal, sleep: async ms => { slept.push(ms); } });
        expect(await second.run()).toBe('completed');
        expect(slept[0]).toBeLessThan(3600 * 1000 - 50); // only the remainder
        expect((await second.getEvents()).filter(e => e.type === 'timer.started')).toHaveLength(1);
    });
});

describe('Compensation', () => {
    it('gives the handler the output of the activity it undoes, and the failure', async () => {
        const release = activity('Release');
        const reserve = activity('Reserve', { compensation: { activity_id: release.id } });
        const ship = activity('Ship');
        const { actor, actors } = scripted({ Reserve: { reservation_id: 'r-9' }, Ship: new Error('carrier down') });
        const engine = new WorkflowEngine(workflow([reserve, ship, release], [edge(reserve, ship)]), { actors, ...quiet });
        await engine.start();
        expect(await engine.run()).toBe('failed');

        const inputs = actor.calls.find(call => call.activity === 'Release')!.inputs;
        expect(inputs.reservation_id).toBe('r-9');
        expect(inputs._compensating).toMatchObject({ activity_name: 'Reserve', output: { reservation_id: 'r-9' } });
        expect(inputs._failure).toMatchObject({ message: 'carrier down' });
        expect(String(inputs._idempotency_key)).toMatch(/:compensation$/);
    });

    it('never starts a run at a compensation handler', async () => {
        const undo = activity('Undo'); // listed first and has no incoming edge
        const a = activity('A', { compensation: { activity_id: undo.id } });
        const { actor, actors } = scripted();
        const engine = new WorkflowEngine(workflow([undo, a], []), { actors, ...quiet });
        await engine.start();
        expect(await engine.run()).toBe('completed');
        expect(actor.calls.map(call => call.activity)).toEqual(['A']);
    });

    it('is rejected at validation when the handler is missing', () => {
        const a = activity('A', { compensation: { activity_id: uuidv4() } });
        expect(validate_workflow_integrity(workflow([a], [])).errors.map(e => e.code)).toEqual(['invalid_reference']);
    });
});
