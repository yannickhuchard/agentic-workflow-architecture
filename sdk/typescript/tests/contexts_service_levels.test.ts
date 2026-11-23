/**
 * Contexts (specification section 22) and service levels (section 23): what the
 * conformance cases cannot reach.
 */
import { describe, it, expect } from 'vitest';
import { randomUUID } from 'crypto';
import { WorkflowEngine } from '../src/runtime/workflow_engine';
import { parse_document } from '../src/validator';
import { AwaRuntime } from '../src/runtime/runtime';
import { compute_measures } from '../src/runtime/kpi';
import { silent_logger } from './helpers';

const HOUR = 3600_000;
const role = randomUUID();
const activity = (name: string, extra: Record<string, unknown> = {}) => ({ id: randomUUID(), name, role_id: role, actor_type: 'application', ...extra });
const edge = (a: { id: string }, b: { id: string }) => ({ id: randomUUID(), source_id: a.id, target_id: b.id });
const context = (name: string, extra: Record<string, unknown> = {}) => ({ id: randomUUID(), name, type: 'data', sync_pattern: 'shared_state', ...extra });
const workflow = (activities: any[], edges: any[], extra: Record<string, unknown> = {}) => parse_document({ id: randomUUID(), name: 'Test', version: '1.0.0', awa_version: '1.1', activities, edges, ...extra });

function clocked(scripts: Record<string, { takes?: number; output?: Record<string, unknown>; writes?: Record<string, unknown> }> = {}) {
    const clock = { now: Date.parse('2026-01-05T09:00:00Z') };
    const given: Record<string, unknown> = {};
    const actor = {
        execute: async (a: { name: string }, inputs?: Record<string, unknown>) => {
            given[a.name] = inputs?._contexts;
            const script = scripts[a.name] || {};
            clock.now += script.takes || 0;
            return { ...(script.output || {}), ...(script.writes ? { _context_writes: script.writes } : {}) };
        },
    };
    const options = { actors: { application: actor, ai_agent: actor, robot: actor }, execution_logger: silent_logger, now: () => clock.now, sleep: async () => { } };
    return { clock, given, options };
}

describe('Contexts', () => {
    it('forgets a transient context once its time to live has passed', async () => {
        const note = context('Note', { lifecycle: 'transient', ttl: 'PT1H' });
        const a = activity('Write', { context_bindings: [{ context_id: note.id, access_mode: 'write' }] });
        const b = activity('Wait');
        const c = activity('Read', { context_bindings: [{ context_id: note.id, access_mode: 'read', required: false }] });
        const { given, options } = clocked({ Write: { writes: { Note: 'call back' } }, Wait: { takes: 2 * HOUR } });
        const engine = new WorkflowEngine(workflow([a, b, c], [edge(a, b), edge(b, c)], { contexts: [note] }), options);
        await engine.start();
        expect(await engine.run()).toBe('completed');
        expect(given.Read).toEqual({});
        expect(engine.getContexts()).toEqual({});
    });

    it('gives the part a binding selects, and writes at the path a binding names', async () => {
        const order = context('Order', { initial_value: { customer: { name: 'Ada', card: '4111' }, lines: 2 } });
        const a = activity('Greet', { context_bindings: [{ context_id: order.id, access_mode: 'read', transforms: { on_read: 'customer.name' } }] });
        const b = activity('Price', { context_bindings: [{ context_id: order.id, access_mode: 'write', transforms: { on_write: 'totals.gross' } }] });
        const { given, options } = clocked({ Price: { writes: { Order: 240 } } });
        const engine = new WorkflowEngine(workflow([a, b], [edge(a, b)], { contexts: [order] }), options);
        await engine.start();
        expect(await engine.run()).toBe('completed');
        expect(given.Greet).toEqual({ Order: 'Ada' });                    // not the card
        expect(given.Price).toEqual({});                                  // bound to write only: given nothing to read
        expect(engine.getContexts()).toEqual({ Order: { customer: { name: 'Ada', card: '4111' }, lines: 2, totals: { gross: 240 } } });
    });

    it('keeps contexts out of the data of the run and out of the journal payloads', async () => {
        const secret = context('Secret', { initial_value: { key: 'do-not-leak' } });
        const a = activity('Use', { context_bindings: [{ context_id: secret.id, access_mode: 'read' }] });
        const { options } = clocked();
        // An actor that echoes everything it was given
        options.actors.application = { execute: async (_a: unknown, inputs?: Record<string, unknown>) => ({ ...inputs }) } as any;
        const engine = new WorkflowEngine(workflow([a], [], { contexts: [secret] }), options);
        await engine.start();
        expect(await engine.run()).toBe('completed');
        expect(JSON.stringify(engine.getTokens().map(t => t.contextData))).not.toContain('do-not-leak');
        const events = await engine.getEvents();
        expect(JSON.stringify(events.filter(e => e.type !== 'activity.started' && e.type !== 'context.read'))).not.toContain('do-not-leak');
        expect(JSON.stringify(events.find(e => e.type === 'context.read'))).not.toContain('do-not-leak');     // a hash, not the value
    });

    it('does not leave contexts in a failed token when a rejected result echoed them', async () => {
        const secret = context('Secret', { initial_value: { key: 'do-not-leak' } });
        const a = activity('Use', { context_bindings: [{ context_id: secret.id, access_mode: 'read' }], outcome_contract: { postconditions: [{ name: 'Done', expression: 'done == true' }], budgets: { max_attempts: 1 } } });
        const { options } = clocked();
        options.actors.application = { execute: async (_a: unknown, inputs?: Record<string, unknown>) => ({ ...inputs, done: false }) } as any;
        const engine = new WorkflowEngine(workflow([a], [], { contexts: [secret] }), options);
        await engine.start();
        expect(await engine.run()).toBe('failed');
        expect(JSON.stringify(engine.getTokens().map(t => t.contextData))).not.toContain('do-not-leak');
        expect(JSON.stringify(engine.snapshot().tokens)).not.toContain('do-not-leak');
    });

    it('keeps context values and service level records across a checkpoint', async () => {
        const order = context('Order');
        const a = activity('Write', { context_bindings: [{ context_id: order.id, access_mode: 'write' }] });
        const { options } = clocked({ Write: { writes: { Order: { total: 5 } } } });
        const document = workflow([a], [], { contexts: [order] });
        const engine = new WorkflowEngine(document, options);
        await engine.start(); await engine.run();
        const restored = await WorkflowEngine.restore(document, engine.snapshot(), options);
        expect(restored.getContexts()).toEqual({ Order: { total: 5 } });
    });
});

describe('Service levels', () => {
    const human = (sla: Record<string, unknown>) => activity('Approve', { actor_type: 'human', sla });

    it('warns, then records a breach, for a task a person has not done, and fails it when told to', async () => {
        const a = human({ target_time: 'PT4H', max_time: 'P1D', escalation_policy: { breach_action: 'fail' } });
        const { clock, options } = clocked();
        const engine = new WorkflowEngine(workflow([a], []), { ...options, wait_for_human_tasks: true });
        await engine.start();
        expect(await engine.run()).toBe('waiting_human');
        expect(await engine.checkServiceLevels()).toEqual({ warnings: 0, breaches: 0, failed: 0 });
        clock.now += 5 * HOUR;
        expect(await engine.checkServiceLevels()).toEqual({ warnings: 1, breaches: 0, failed: 0 });
        expect(await engine.checkServiceLevels()).toEqual({ warnings: 0, breaches: 0, failed: 0 });       // once
        clock.now += 24 * HOUR;
        expect(await engine.checkServiceLevels()).toEqual({ warnings: 0, breaches: 1, failed: 1 });
        expect(await engine.run()).toBe('failed');
        const events = await engine.getEvents();
        expect(events.filter(e => e.type.startsWith('sla.')).map(e => e.type)).toEqual(['sla.warning', 'sla.breached']);
        expect(events.find(e => e.type === 'token.failed')?.data).toMatchObject({ error: { code: 'SLA_BREACH' } });
    });

    it('counts the delay before a retry: an activity whose time ran out while waiting to be tried again is not tried', async () => {
        const a = activity('Call', { sla: { max_time: 'PT1H', escalation_policy: { breach_action: 'fail' } }, retry: { max_attempts: 3, initial_delay: 'PT2H' } });
        const { clock, options } = clocked();
        let calls = 0;
        options.actors.application = { execute: async () => { calls++; clock.now += 10 * 60_000; throw new Error('upstream unavailable'); } } as any;
        const engine = new WorkflowEngine(workflow([a], []), { ...options, sleep: async () => { clock.now += 2 * HOUR; } });
        await engine.start();
        expect(await engine.run()).toBe('failed');
        expect(calls).toBe(1);
        expect((await engine.getEvents()).find(e => e.type === 'token.failed')?.data).toMatchObject({ error: { code: 'SLA_BREACH' } });
    });

    it('lets a person finish late when the breach action is not fail, and records it', async () => {
        const a = human({ max_time: 'PT1H' });
        const { clock, options } = clocked();
        const engine = new WorkflowEngine(workflow([a], []), { ...options, wait_for_human_tasks: true });
        await engine.start();
        expect(await engine.run()).toBe('waiting_human');
        clock.now += 3 * HOUR;
        const token = engine.getTokens()[0];
        expect(await engine.resumeToken(token.id, { approved: true })).toBe(true);
        expect(await engine.run()).toBe('completed');
        const breach = (await engine.getEvents()).find(e => e.type === 'sla.breached');
        expect(breach?.data).toMatchObject({ scope: 'activity', elapsed_ms: 3 * HOUR, action: 'record' });
    });

    it('is checked by a host each time it lets time pass, and counted by the measures', async () => {
        let now = Date.parse('2026-01-05T09:00:00Z');
        const a = human({ max_time: 'PT1H', escalation_policy: { breach_action: 'fail' } });
        const document = workflow([a], []);
        const runtime = new AwaRuntime({ now: () => now, engine: { execution_logger: silent_logger, wait_for_human_tasks: true, now: () => now } });
        runtime.register_workflow(document);
        const run = (await runtime.start(document.id, {})).getRunId();
        now += 2 * HOUR;
        await runtime.tick();
        const engine = runtime.get_run(run)!;
        expect(engine.getStatus()).toBe('failed');
        const events = await engine.getEvents();
        const report = compute_measures({ workflows: [{ id: document.id, name: 'Test' }], runs: [{ run_id: run, workflow_id: document.id, events }] });
        expect(report.workflows[0].measures['workflow.sla_breaches']).toEqual({ value: 1, n: 1 });
        expect(report.workflows[0].measures['workflow.failure_rate'].value).toBe(1);
    });
});

describe('An AI agent and contexts', () => {
    it('shows the model the contexts it is bound to read, and passes what the model writes to the engine', async () => {
        const { FunctionModelProvider } = await import('../src/runtime/models');
        const policy = context('Policy', { initial_value: { excess: 250 } });
        const notes = context('Notes', { sync_pattern: 'blackboard' });
        const secret = context('Secret', { initial_value: { key: 'not for the model' } });
        const a = activity('Assess', { actor_type: 'ai_agent', context_bindings: [{ context_id: policy.id, access_mode: 'read' }, { context_id: notes.id, access_mode: 'write' }] });
        const prompts: string[] = [];
        const provider = new FunctionModelProvider('test', request => {
            prompts.push(request.prompt || JSON.stringify(request.messages));
            return JSON.stringify({ reasoning: { rationale: 'excess applies' }, output: { payable: 950 }, _context_writes: { Notes: { assessed: true } } });
        });
        const engine = new WorkflowEngine(workflow([a], [], { contexts: [policy, notes, secret] }), { model_providers: [provider], execution_logger: silent_logger });
        await engine.start({ claim: 1200 });
        expect(await engine.run()).toBe('completed');
        expect(prompts[0]).toContain('Shared contexts');
        expect(prompts[0]).toContain('"excess": 250');
        expect(prompts[0]).not.toContain('not for the model');
        expect(engine.getContexts()).toMatchObject({ Notes: { assessed: true } });
        expect(engine.getTokens()[0].contextData.payable).toBe(950);
    });
});
