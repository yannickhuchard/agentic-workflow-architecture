/**
 * Changing a workflow while runs are in flight (specification section 25): versions on a host,
 * plans and their refusals, and what replay, telemetry, evidence and measures see of a migrated run.
 * The conformance cases in spec/conformance/versioning cover the main paths; these cover the rest.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { randomUUID } from 'crypto';
import { AddressInfo } from 'net';
import { Server } from 'http';
import { AwaRuntime, InMemoryRuntimeStore, add_definition, open_runtime_directory } from '../src/runtime/runtime';
import { Workflow } from '../src/types';
import { parse_document } from '../src/validator';
import { Actor } from '../src/runtime/actors/actor';
import { InMemoryJournalStore, JournalEvent } from '../src/runtime/journal';
import { WorkflowState } from '../src/runtime/persistence';
import { as_migrated, check_assignments, compare_semver, compare_versions, plan_migration, rest_positions } from '../src/runtime/migration';
import { counterfactual_replay } from '../src/runtime/counterfactual';
import { run_spans } from '../src/runtime/telemetry';
import { compute_evidence } from '../src/runtime/evidence';
import { compute_measures } from '../src/runtime/kpi';
import { PostgresRuntimeStore, open_runtime_store } from '../src/runtime/postgres_store';
import { postgres_unavailable, start_postgres, TestPostgres } from './postgres';
import { createServer } from '../src/server';
import { set_journey_runtime } from '../src/server/routes/journeys';
import { silent_logger } from './helpers';

const ID = '7d1f0c3e-5b8a-4e6f-9a2b-0c1d2e3f4a5b';
const ROLE = '7d1f0c3e-5b8a-4e6f-9a2b-0c1d2e3f4a00';
let counter = 0;
const ids = new Map<string, string>();
/** The same name gives the same id in every version, as a kept node does */
const id = (name: string) => {
    if (!ids.has(name)) ids.set(name, `7d1f0c3e-5b8a-4e6f-9a2b-${String(++counter).padStart(12, '0')}`);
    return ids.get(name)!;
};

type Node = { name: string; actor?: string; event?: Record<string, unknown>; join?: boolean; a2a?: boolean };
/** A workflow of nodes in sequence (or as the edges say) */
function workflow(version: string, nodes: Node[], edges?: [string, string][]): Workflow {
    const pairs = edges || nodes.slice(1).map((n, i) => [nodes[i].name, n.name] as [string, string]);
    return parse_document({
        id: ID, name: 'Claim', version, awa_version: '1.1',
        activities: nodes.filter(n => !n.event).map(n => ({
            id: id(n.name), name: n.name, role_id: ROLE, actor_type: n.actor || 'application',
            ...(n.join ? { join: 'all' } : {}), ...(n.a2a ? { a2a: { agent_card: 'https://agents.example/card.json' } } : {}),
        })),
        events: nodes.filter(n => n.event).map(n => ({ id: id(n.name), name: n.name, ...n.event, ...(n.join ? { join: 'all' } : {}) })),
        edges: pairs.map(([a, b]) => ({ id: id(`${a}->${b}`), source_id: id(a), target_id: id(b) })),
    });
}

class Script implements Actor {
    visited: string[] = [];
    constructor(private outputs: Record<string, Record<string, unknown>> = {}) { }
    async execute(activity: { name: string; actor_type: string }): Promise<Record<string, unknown>> {
        this.visited.push(activity.name);
        if (activity.actor_type === 'human') return { _requires_human_action: true, _human_task_id: `task:${activity.name}` };
        return this.outputs[activity.name] || {};
    }
}
const engine_options = (actor: Actor, journal = new InMemoryJournalStore()) => ({
    actors: { application: actor, ai_agent: actor, human: actor, robot: actor }, journal, execution_logger: silent_logger, sleep: async () => { }, wait_for_human_tasks: true,
});

const v1 = workflow('1.0.0', [{ name: 'Register' }, { name: 'Review', actor: 'human' }, { name: 'Settle' }]);
const v2 = workflow('2.0.0', [{ name: 'Register' }, { name: 'Review', actor: 'human' }, { name: 'Settle' }, { name: 'Notify' }]);

/** A state of v1 with one token as given */
function state_of(workflow: Workflow, token: Partial<WorkflowState['tokens'][number]> & { node: string }, status = 'waiting_human'): WorkflowState {
    return {
        version: '1.0', workflow_id: workflow.id, workflow_name: workflow.name, workflow_version: workflow.version, engine_status: status, contexts: {}, checkpoint_at: '2026-05-04T09:00:00.000Z',
        tokens: [{ id: randomUUID(), activity_id: id(token.node), status: token.status || 'waiting', context_data: token.context_data || {}, created_at: '', updated_at: '' }],
        metadata: { run_id: 'r' },
    };
}

describe('Versions on a host (spec 25.1)', () => {
    it('starts new runs on the newest version, whatever the order of registration, unless a version is pinned', async () => {
        expect(compare_semver('1.10.0', '1.9.3')).toBeGreaterThan(0);
        const runtime = new AwaRuntime({ engine: engine_options(new Script()) });
        runtime.register_workflow(v2).register_workflow(v1);
        expect(runtime.workflow_versions(ID)).toEqual(['1.0.0', '2.0.0']);
        expect(runtime.get_workflow(ID)!.version).toBe('2.0.0');
        expect((await runtime.start(ID)).getWorkflow().version).toBe('2.0.0');
        expect((await runtime.start(ID, {}, undefined, { version: '1.0.0' })).getWorkflow().version).toBe('1.0.0');
        await expect(runtime.start(ID, {}, undefined, { version: '9.9.9' })).rejects.toThrow(/no registered version 9.9.9/);

        const pinned = new AwaRuntime({ engine: engine_options(new Script()), pinned_versions: { [ID]: '1.0.0' } });
        pinned.register_workflow(v1).register_workflow(v2);
        expect((await pinned.start(ID)).getWorkflow().version).toBe('1.0.0');
    });

    it('keeps every version in a runtime directory, and refuses to start without one a run needs', async () => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'awa-versions-'));
        // A directory written by an earlier SDK names a workflow's file by its id alone
        fs.mkdirSync(path.join(dir, 'definitions'));
        fs.writeFileSync(path.join(dir, 'definitions', `workflow-${ID}.json`), JSON.stringify(v1));
        const actor = new Script();
        let runtime = await open_runtime_directory(dir, { engine: engine_options(actor) });
        const run = await runtime.start(ID);
        await runtime.close();

        await add_definition(dir, v1 as unknown as Record<string, unknown>);
        await add_definition(dir, v2 as unknown as Record<string, unknown>);
        expect(fs.readdirSync(path.join(dir, 'definitions')).sort()).toEqual([`workflow-${ID}@1.0.0.json`, `workflow-${ID}@2.0.0.json`]);

        runtime = await open_runtime_directory(dir, { engine: engine_options(actor) });
        expect(runtime.get_run(run.getRunId())!.getWorkflow().version).toBe('1.0.0');
        expect((await runtime.start(ID)).getWorkflow().version).toBe('2.0.0');
        await runtime.close();

        const saved = fs.readFileSync(path.join(dir, 'runtime.json'), 'utf-8');
        fs.rmSync(path.join(dir, 'definitions', `workflow-${ID}@1.0.0.json`));
        await expect(open_runtime_directory(dir, { engine: engine_options(actor) })).rejects.toThrow(new RegExp(`run ${run.getRunId()} needs workflow ${ID} version 1.0.0, which is not registered`));
        expect(fs.readFileSync(path.join(dir, 'runtime.json'), 'utf-8')).toBe(saved);
    });
});

describe('Plans (spec 25.3)', () => {
    it('refuses a run of another workflow, and checks each assignment', () => {
        const other = { ...v2, id: '7d1f0c3e-5b8a-4e6f-9a2b-ffffffffffff' } as Workflow;
        expect(plan_migration(v1, other, state_of(v1, { node: 'Review' }), {}).refusals.map(r => r.code)).toEqual(['different_workflow']);
        expect(plan_migration(v1, v2, state_of(v1, { node: 'Review' }), { workflow_id: other.id }).refusals.map(r => r.code)).toEqual(['different_workflow']);
        expect(check_assignments([{ set: 'a', remove: 'b' }, { set: 'x.y' }, { set: 'a', value: 1, from: 'b' }, { remove: 'not a path' }, { set: 'a.b._c', value: 1 }, { set: 'ok', value: 1, when: '' }])).toHaveLength(7);
        expect(check_assignments([{ set: 'a.b', value: 1 }, { remove: 'c' }, { set: 'd', from: 'e.f', when: 'g == 1' }])).toEqual([]);
    });

    it('sets nested properties and leaves the data of a refused plan untouched', () => {
        const state = state_of(v1, { node: 'Review', context_data: { customer: { tier: 'gold' } } });
        const result = plan_migration(v1, v2, state, { data: [{ set: 'customer.address.city', value: 'Lyon' }, { set: 'gold', expression: 'customer.tier == gold' }] });
        expect(result.refusals).toEqual([]);
        expect(result.state!.tokens[0].context_data).toMatchObject({ customer: { tier: 'gold', address: { city: 'Lyon' } }, gold: true });
        expect(state.tokens[0].context_data).toEqual({ customer: { tier: 'gold' } });
    });

    it('keeps a wait for an event only where the same event, with the same correlation, is awaited', () => {
        const docs = (name: string, correlation_key?: string) => ({ event_type: 'message', event_definition: { name, ...(correlation_key ? { correlation_key } : {}) } });
        const a = workflow('1.0.0', [{ name: 'Register' }, { name: 'Documents', event: docs('documents.uploaded', 'claim_id') }, { name: 'Settle' }]);
        const token = { node: 'Documents', context_data: { _awaiting_event: { node_id: id('Documents'), name: 'documents.uploaded', correlation_key: 'claim_id', correlation_value: 'C-1' } } };
        for (const [event, reason] of [[docs('documents.uploaded', 'customer_id'), /correlates on "customer_id"/], [docs('papers.uploaded', 'claim_id'), /waits for "papers.uploaded"/],
            [{ event_type: 'signal', event_definition: { name: 'documents.uploaded' } }, /signal event/], [{ event_type: 'timer', event_definition: { duration: 'PT1H' } }, /does not wait for a business event/]] as const) {
            const b = workflow('2.0.0', [{ name: 'Register' }, { name: 'Documents', event }, { name: 'Settle' }]);
            const result = plan_migration(a, b, state_of(a, token, 'waiting_event'), {});
            expect(result.refusals.map(r => r.code)).toEqual(['wait_incompatible']);
            expect(result.refusals[0].message).toMatch(reason);
        }
        const kept = plan_migration(a, workflow('2.0.0', [{ name: 'Register' }, { name: 'Documents', event: docs('documents.uploaded', 'claim_id') }, { name: 'Settle' }]), state_of(a, token, 'waiting_event'), {});
        expect(kept.refusals).toEqual([]);
        expect(kept.state!.tokens[0].context_data._awaiting_event).toMatchObject({ correlation_value: 'C-1', node_id: id('Documents') });
    });

    it('keeps a token at a join only where the new version joins on the edge it came by; a restart withdraws it', () => {
        const nodes: Node[] = [{ name: 'Split' }, { name: 'Left' }, { name: 'Right' }, { name: 'Join', join: true }];
        const edges: [string, string][] = [['Split', 'Left'], ['Split', 'Right'], ['Left', 'Join'], ['Right', 'Join']];
        const a = workflow('1.0.0', nodes, edges);
        const token = { node: 'Join', status: 'joining' as const, context_data: { _arrived_edge: id('Left->Join') } };
        expect(plan_migration(a, workflow('2.0.0', nodes, edges), state_of(a, token, 'running'), {}).refusals).toEqual([]);
        const rewired = workflow('2.0.0', [...nodes, { name: 'Middle' }], [['Split', 'Middle'], ['Middle', 'Left'], ['Split', 'Right'], ['Left', 'Right'], ['Right', 'Join'], ['Middle', 'Join']]);
        const refused = plan_migration(a, rewired, state_of(a, token, 'running'), {});
        expect(refused.refusals.map(r => r.code)).toEqual(['wait_incompatible']);
        const restarted = plan_migration(a, rewired, state_of(a, token, 'running'), { restart: [id('Join')] });
        expect(restarted.tokens[0].outcome).toBe('restarted');
        expect(restarted.state!.tokens[0]).toMatchObject({ status: 'active', context_data: {} });
        expect(restarted.status).toBe('running');
    });

    it("keeps a person's task only at an activity a person performs, and an agent's request only at one over A2A", () => {
        const a = workflow('1.0.0', [{ name: 'Register' }, { name: 'Ask', actor: 'ai_agent', a2a: true }, { name: 'Settle' }]);
        const token = { node: 'Ask', context_data: { _awaiting_agent_input: { agent: 'x', task_id: 't' } } };
        expect(plan_migration(a, workflow('2.0.0', [{ name: 'Register' }, { name: 'Ask', actor: 'ai_agent' }, { name: 'Settle' }]), state_of(a, token), {}).refusals[0].message).toMatch(/not performed by an agent over A2A/);
        expect(plan_migration(a, workflow('2.0.0', [{ name: 'Register' }, { name: 'Ask', actor: 'human' }, { name: 'Settle' }]), state_of(a, token), {}).refusals[0].message).toMatch(/performed by human, not ai_agent/);
        expect(plan_migration(v1, workflow('2.0.0', [{ name: 'Register' }, { name: 'Settle' }, { name: 'Review', event: { event_type: 'timer', event_definition: { duration: 'PT1H' } } }]), state_of(v1, { node: 'Review' }), {})
            .refusals[0].message).toMatch(/is not an activity/);
    });

    it('lists the positions at rest of a workflow, and maps completed work for compensation', () => {
        const a = workflow('1.0.0', [{ name: 'Register' }, { name: 'Ask', actor: 'ai_agent', a2a: true }, { name: 'Review', actor: 'human' }, { name: 'Wait', event: { event_type: 'timer', event_definition: { duration: 'PT1H' } } }]);
        expect(rest_positions(a).map(p => `${p.node_name}:${p.wait}`)).toEqual(['Ask:agent', 'Review:human', 'Wait:timer']);
        const state = state_of(v1, { node: 'Review' });
        state.metadata = { ...state.metadata, completed_activities: [{ activity_id: id('Register'), token_id: 't', output: {} }] };
        const b = workflow('2.0.0', [{ name: 'Intake' }, { name: 'Review', actor: 'human' }, { name: 'Settle' }]);
        const result = plan_migration(v1, b, state, { nodes: { [id('Register')]: id('Intake') } });
        expect(result.completed_work).toEqual([{ from_node_id: id('Register'), to_node_id: id('Intake') }]);
        expect((result.state!.metadata as { completed_activities: { activity_id: string }[] }).completed_activities[0].activity_id).toBe(id('Intake'));
        expect(compare_versions(v1, b).removed.map(n => n.node_name)).toEqual(['Register']);
        expect(compare_versions(v1, b).added.map(n => n.node_name)).toEqual(['Intake']);
    });
});

/** A run of v1 waiting at Review, moved to a v2 that replaced Review by Check (an application) with a restart */
async function migrated_run() {
    const journal = new InMemoryJournalStore();
    const actor = new Script({ Register: { output: { claim_id: 'CLM-1' } }, Check: { output: { approved: true } } });
    const runtime = new AwaRuntime({ store: new InMemoryRuntimeStore(), engine: engine_options(actor, journal) });
    const b = workflow('2.0.0', [{ name: 'Register' }, { name: 'Check' }, { name: 'Settle' }, { name: 'Notify' }]);
    runtime.register_workflow(v1);
    const run = await runtime.start(ID);
    runtime.register_workflow(b);
    const result = await runtime.migrate(run.getRunId(), { nodes: { [id('Review')]: id('Check') }, restart: [id('Review')], data: [{ set: 'currency', value: 'EUR' }] });
    expect(result).toMatchObject({ applied: true, status: 'completed' });
    return { events: await runtime.get_run(run.getRunId())!.getEvents(), b, runtime, run_id: run.getRunId() };
}

describe('What other parts see of a migrated run (spec 25.5)', () => {
    it('replay matches the recorded run node by node as the migration mapped it', async () => {
        const { events, b } = await migrated_run();
        const mapped = as_migrated(events);
        expect(mapped.find(e => e.type === 'activity.started' && e.node_name === 'Review')!.node_id).toBe(id('Check'));
        expect(as_migrated(events.filter(e => e.type !== 'run.migrated'))).toEqual([...events.filter(e => e.type !== 'run.migrated')].sort((x, y) => x.seq - y.seq));
        const { report } = await counterfactual_replay(b, events, { ai: 'recorded', engine: { execution_logger: silent_logger } });
        expect(report.candidate.status).toBe('completed');
        expect(report.unrecorded).toEqual([]);
        expect(report.regressions).toEqual([]);
    });

    it('telemetry has the migration as a span event of the run, and ends the spans of a withdrawn wait', async () => {
        const { events, b } = await migrated_run();
        const spans = run_spans(b, events);
        const run = spans.find(s => !s.parent_span_id)!;
        expect(run.attributes['awa.workflow.version']).toBe('1.0.0');
        const event = run.events.find(e => e.name === 'run.migrated')!;
        expect(event.attributes).toMatchObject({ 'awa.data.from_version': '1.0.0', 'awa.data.to_version': '2.0.0' });
        const wait = spans.find(s => s.name.startsWith('wait '))!;
        expect(wait.attributes['awa.wait.outcome']).toBe('withdrawn');
        expect(wait.end_ms).toBe(Date.parse(events.find(e => e.type === 'run.migrated')!.time));
    });

    it('evidence states each migration and lists both versions in scope; measures count the run once', async () => {
        const { events, b, run_id } = await migrated_run();
        const report = compute_evidence({ workflows: [b], runs: [{ run_id, workflow_id: ID, events }] });
        const operation = report.parts.find(p => p.id === 'operation')!;
        const migration = operation.statements.find(s => s.kind === 'migration')!;
        expect(migration.facts).toEqual({ run_id, from_version: '1.0.0', to_version: '2.0.0', tokens_kept: 0, tokens_restarted: 1, data_changes: 1, principal: null });
        expect(migration.citations).toEqual([{ run_id, seq: [events.find(e => e.type === 'run.migrated')!.seq] }]);
        expect(operation.summary).toMatchObject({ runs: 1, migrations: 1, workflows: [{ workflow_id: ID, versions: ['1.0.0', '2.0.0'], runs: 1 }] });
        expect(operation.statements.find(s => s.kind === 'run')!.facts).toMatchObject({ workflow_version: '1.0.0', status: 'completed' });

        const measures = compute_measures({ workflows: [b], runs: [{ run_id, workflow_id: ID, events } as never] });
        expect(measures.workflows).toHaveLength(1);
        expect(measures.workflows[0].measures['workflow.runs'].value).toBe(1);
        expect(measures.workflows[0].measures['workflow.success_rate'].value).toBe(1);
    });

    it('a journal written with payloads hashed hashes the values a migration changed', async () => {
        const runtime = new AwaRuntime({ engine: { ...engine_options(new Script()), journal_payloads: 'hash' } });
        runtime.register_workflow(v1);
        const run = await runtime.start(ID);
        runtime.register_workflow(v2);
        await runtime.migrate(run.getRunId(), { data: [{ set: 'secret', value: 'S-1' }] });
        const migrated = (await runtime.get_run(run.getRunId())!.getEvents()).find((e: JournalEvent) => e.type === 'run.migrated')!;
        expect((migrated.data.data_changes as { value: unknown }[])[0].value).toHaveProperty('sha256');
    });
});

describe('Migration over HTTP', () => {
    let server: Server, base: string;
    const runtime = new AwaRuntime({ engine: engine_options(new Script()) });
    const call = async (method: string, route: string, body?: unknown) => {
        const response = await fetch(`${base}/api/v1/journeys${route}`, { method, headers: { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
        return { status: response.status, body: await response.json() as any };
    };
    beforeAll(async () => {
        set_journey_runtime(runtime);
        server = createServer({ request_logging: false }).listen(0);
        await new Promise(resolve => server.once('listening', resolve));
        base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    });
    afterAll(async () => { set_journey_runtime(undefined); await new Promise(resolve => server.close(resolve)); });

    it('lists versions, checks, plans and applies a migration', async () => {
        runtime.register_workflow(v1);
        const run = await runtime.start(ID);
        expect((await call('POST', '/definitions', v2)).status).toBe(201);
        expect((await call('GET', `/workflows/${ID}/versions`)).body).toEqual({ workflow_id: ID, newest: '2.0.0', versions: [{ version: '1.0.0', live_runs: [run.getRunId()] }, { version: '2.0.0', live_runs: [] }] });
        expect((await call('GET', '/workflows/nope/versions')).status).toBe(404);
        const check = (await call('POST', '/migrations/check', { workflow_id: ID })).body;
        expect(check).toMatchObject({ to_version: '2.0.0', comparisons: [{ from_version: '1.0.0', automatic: true }], runs: [{ run_id: run.getRunId(), migratable: true }] });
        expect((await call('POST', '/migrations/check', {})).status).toBe(400);
        const dry = await call('POST', `/runs/${run.getRunId()}/migrate?dry_run=true`, {});
        expect(dry).toMatchObject({ status: 200, body: { applied: false, dry_run: true } });
        expect((await call('POST', `/runs/${run.getRunId()}/migrate`, { to_version: '7.0.0' })).status).toBe(409);
        expect((await call('POST', '/runs/nope/migrate', {})).status).toBe(404);
        expect(await call('POST', `/runs/${run.getRunId()}/migrate`, {})).toMatchObject({ status: 200, body: { applied: true, to_version: '2.0.0' } });
        expect(runtime.get_run(run.getRunId())!.getWorkflow().version).toBe('2.0.0');
    });
});

const unavailable = postgres_unavailable();
(unavailable ? describe.skip : describe)('Versions on a shared store (spec 25.1, 29)', () => {
    let server: TestPostgres;
    beforeAll(async () => { server = await start_postgres(); }, 60_000);
    afterAll(async () => { await server?.stop(); });

    it('keeps every version, takes up a run on its own, migrates it in one operation, and refuses a host without a version a run needs', async () => {
        const url = await server.database();
        const store = await PostgresRuntimeStore.open(url);
        await store.add_definition(v1 as unknown as Record<string, unknown>);
        const actor = new Script();
        const first = await open_runtime_store(url, { engine: engine_options(actor) });
        const run = await first.start(ID);
        await store.add_definition(v2 as unknown as Record<string, unknown>);
        await store.add_definition(v2 as unknown as Record<string, unknown>);     // the same version again replaces it
        expect((await store.definitions()).map(d => d.version)).toEqual(['1.0.0', '2.0.0']);
        await first.close();

        const second = await open_runtime_store(url, { engine: engine_options(actor) });
        expect(second.workflow_versions(ID)).toEqual(['1.0.0', '2.0.0']);
        expect((await second.start(ID)).getWorkflow().version).toBe('2.0.0');
        const check = await second.check_migration(ID);
        expect(check.runs.map(r => [r.run_id, r.version, r.migratable])).toEqual([[run.getRunId(), '1.0.0', true]]);
        expect(await second.migrate(run.getRunId(), {})).toMatchObject({ applied: true, status: 'waiting_human' });
        await second.close();

        const third = await open_runtime_store(url, { engine: engine_options(actor) });
        await third.refresh();
        const taken = third.get_run(run.getRunId())!;
        expect(taken.getWorkflow().version).toBe('2.0.0');
        expect(await third.resume(run.getRunId(), taken.getTokens()[0].id, {})).toBe(true);
        await third.refresh();
        const events = await third.get_run(run.getRunId())!.getEvents();
        expect(events.map(e => e.seq)).toEqual(events.map((_, i) => i + 1));
        expect(events.map(e => e.type)).toContain('run.migrated');
        expect(actor.visited).toContain('Notify');

        // A host that has only the newest version cannot take up a run that is still on the oldest
        const lagging = await open_runtime_store(url, { engine: engine_options(actor) });
        const old = await lagging.start(ID, {}, undefined, { version: '1.0.0' });
        await lagging.close();
        const { Client } = await import('pg');
        const client = new Client({ connectionString: url });
        await client.connect();
        await client.query(`DELETE FROM awa_runtime.definitions WHERE version = '1.0.0'`);
        await client.end();
        await expect(open_runtime_store(url, { engine: engine_options(actor) })).rejects.toThrow(new RegExp(`workflow ${ID} version 1.0.0, which this host has not registered`));
        expect(old.getWorkflow().version).toBe('1.0.0');
        await store.close();
    }, 60_000);
});
