/**
 * Where features meet: sub-workflows (24) with changing a workflow in flight (25),
 * identity and authorization (30), the shared store (29) and A2A (28.8). Each
 * feature is tested on its own elsewhere; these tests fix how they behave together.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';
import http from 'http';
import { AddressInfo } from 'net';
import { Activity, Workflow } from '../src/types';
import { parse_document } from '../src/validator';
import { Actor } from '../src/runtime/actors/actor';
import { WorkflowEngine, WorkflowEngineOptions } from '../src/runtime/workflow_engine';
import { InMemoryJournalStore, JournalEvent } from '../src/runtime/journal';
import { AwaRuntime, add_definition, open_runtime_directory } from '../src/runtime/runtime';
import { open_runtime_store, PostgresRuntimeStore } from '../src/runtime/postgres_store';
import { AuthorizationOptions, AuthorizationPolicy, Principal } from '../src/runtime/authorization';
import { createServer, create_jwt } from '../src/server';
import { set_journey_runtime } from '../src/server/routes/journeys';
import { postgres_unavailable, start_postgres, TestPostgres } from './postgres';

const ROLE = '7d1c0e55-0000-4000-8000-000000000002';
type Step = string | { name: string; call?: string; human?: boolean };

/** A workflow of activities in sequence, with node ids given by name so that versions can share them */
function workflow(name: string, steps: Step[], options: { id?: string; version?: string; ids?: Record<string, string> } = {}): Workflow {
    const ids = options.ids || {};
    const activities = steps.map(step => {
        const s = typeof step === 'string' ? { name: step } : step;
        ids[s.name] ??= randomUUID();
        return {
            id: ids[s.name], name: s.name, role_id: ROLE, actor_type: s.human ? 'human' : 'application',
            ...(s.call ? { is_expandable: true, expansion_workflow_id: s.call } : {}),
        };
    });
    const edges = activities.slice(1).map((a, i) => ({ id: randomUUID(), source_id: activities[i].id, target_id: a.id }));
    return parse_document({ id: options.id || randomUUID(), name, version: options.version || '1.0.0', awa_version: '1.1', activities, edges });
}

/** A person's activity waits for a task; any other returns its name */
class Scripted implements Actor {
    async execute(activity: Activity): Promise<Record<string, unknown>> {
        if (activity.actor_type === 'human') return { _requires_human_action: true, _human_task_id: `task-${activity.name}` };
        return { [activity.name.toLowerCase()]: true };
    }
}

const quiet = { execution_logger: { log_execution: async () => { } }, sleep: async () => { } };
const engine_options = (extra: WorkflowEngineOptions = {}): WorkflowEngineOptions => {
    const actor = new Scripted();
    return { actors: { application: actor, ai_agent: actor, human: actor, robot: actor }, wait_for_human_tasks: true, ...quiet, ...extra };
};
const person = (id: string): Principal => ({ id, kind: 'person' });
const waiting_at = (events: JournalEvent[], name: string) =>
    events.filter(e => e.type === 'token.waiting' && e.node_name === name && e.data.reason === 'human_task').pop()!.token_id!;

/** People may do anything; the applications may perform activities; the one who submits may not review */
const POLICY: AuthorizationPolicy = {
    rules: [
        { id: 'people', effect: 'allow', actions: ['*'], subject: { kinds: ['person'] } },
        { id: 'applications', effect: 'allow', actions: ['perform_activity'], subject: { kinds: ['application'] } },
    ],
    separation_of_duties: [{ id: 'submit-review', activities: ['Submit', 'Review'] }],
};

describe('Authorization in child runs (spec 24, 30)', () => {
    const APPROVAL = workflow('Approval', [{ name: 'Review', human: true }, 'Record']);
    const CLAIM = workflow('Claim', [{ name: 'Submit', human: true }, { name: 'Approve', call: APPROVAL.id }, 'Pay']);

    async function claim(authorization: AuthorizationOptions = { policy: POLICY }) {
        const journal = new InMemoryJournalStore();
        const engine = new WorkflowEngine(CLAIM, engine_options({ journal, subworkflows: { workflows: [APPROVAL] }, principal: person('alice'), authorization }));
        await engine.start({});
        await engine.run();
        await engine.resumeToken(waiting_at(await engine.getEvents(), 'Submit'), { submitted: true }, person('alice'));
        await engine.run();
        const child = engine.getSubworkflowRuns()[0];
        return { engine, journal, child, review: waiting_at(await journal.read(child.run_id), 'Review') };
    }

    it('holds the person who completes a task of a child run, through the parent, to the policy, and records them in the child', async () => {
        const { engine, journal, child, review } = await claim();
        await expect(engine.resumeToken(review, { approved: true }, person('bob'))).resolves.toBe(true);
        await engine.run();
        expect(engine.getStatus()).toBe('completed');
        const events = await journal.read(child.run_id);
        expect(events.find(e => e.type === 'token.resumed')!.data.principal).toEqual(person('bob'));
        expect(events.find(e => e.type === 'activity.completed' && e.node_name === 'Review')!.data.principal).toEqual(person('bob'));
    });

    it('decides separation of duties in a child run on the record of its parent: who submitted in the parent may not review in the child', async () => {
        const { engine, journal, child, review } = await claim();
        await expect(engine.resumeToken(review, { approved: true }, person('alice'))).rejects.toMatchObject({ code: 'FORBIDDEN' });
        expect(engine.getStatus()).toBe('waiting_human');
        const denied = (await journal.read(child.run_id)).find(e => e.type === 'authorization.decided')!;
        expect(denied.data).toMatchObject({ action: 'complete_task', decision: 'deny', reason: 'separation_of_duties', rule: 'submit-review', principal: person('alice') });
    });

    it('keeps what a child run did on the record of its parent once the child has ended, across a checkpoint', async () => {
        // Submitted in a child run; reviewed in the parent, after the child ended
        const INTAKE = workflow('Intake', [{ name: 'Submit', human: true }]);
        const CASE = workflow('Case', [{ name: 'Take in', call: INTAKE.id }, { name: 'Review', human: true }]);
        const journal = new InMemoryJournalStore();
        const options = engine_options({ journal, subworkflows: { workflows: [INTAKE] }, authorization: { policy: POLICY } });
        const engine = new WorkflowEngine(CASE, { ...options, principal: person('carol') });
        await engine.start({});
        await engine.run();
        const intake = engine.getSubworkflowRuns()[0];
        await engine.resumeToken(waiting_at(await journal.read(intake.run_id), 'Submit'), { submitted: true }, person('alice'));
        await engine.run();
        const restored = WorkflowEngine.restore(CASE, JSON.parse(JSON.stringify(engine.snapshot())), options, false);
        const review = waiting_at(await restored.getEvents(), 'Review');
        await expect(restored.resumeToken(review, {}, person('alice'))).rejects.toMatchObject({ code: 'FORBIDDEN' });
        await expect(restored.resumeToken(review, {}, person('bob'))).resolves.toBe(true);
        await restored.run();
        expect(restored.getStatus()).toBe('completed');
    });

    it('starts a child run without deciding start_run, as whoever started the run of depth 0, also after the parent was restored', async () => {
        // The policy lets clerks start claims and nothing else: a child run is not a start of its own
        const policy: AuthorizationPolicy = {
            rules: [
                { id: 'start-claims', effect: 'allow', actions: ['start_run'], resource: { workflows: ['Claim'] } },
                { id: 'people', effect: 'allow', actions: ['complete_task'], subject: { kinds: ['person'] } },
                { id: 'applications', effect: 'allow', actions: ['perform_activity'], subject: { kinds: ['application'] } },
            ],
        };
        const journal = new InMemoryJournalStore();
        const options = engine_options({ journal, subworkflows: { workflows: [APPROVAL] }, authorization: { policy } });
        const engine = new WorkflowEngine(CLAIM, { ...options, principal: person('alice') });
        await engine.start({});
        await engine.run();
        // The host restores the run without knowing who started it: the run knows
        const restored = WorkflowEngine.restore(CLAIM, JSON.parse(JSON.stringify(engine.snapshot())), options, false);
        await restored.resumeToken(waiting_at(await restored.getEvents(), 'Submit'), {}, person('alice'));
        await restored.run();
        const child = restored.getSubworkflowRuns()[0];
        const started = (await journal.read(child.run_id))[0];
        expect(started.type).toBe('run.started');
        expect(started.data.principal).toEqual(person('alice'));
        expect((await journal.read(restored.getRunId())).filter(e => e.type === 'authorization.decided')).toEqual([]);
        expect(restored.getStatus()).toBe('waiting_human');
    });
});

describe('Versions of a called workflow (spec 24, 25.1)', () => {
    const APPROVAL_ID = randomUUID(), CLAIM_ID = randomUUID();
    const ids: Record<string, string> = {};
    const V1 = workflow('Approval', [{ name: 'Review', human: true }, 'Record'], { id: APPROVAL_ID, version: '1.0.0', ids });
    // Version 2 adds a step after the same two
    const V2 = workflow('Approval', [{ name: 'Review', human: true }, 'Record', 'Audit'], { id: APPROVAL_ID, version: '2.0.0', ids });
    const CLAIM = workflow('Claim', ['Open', { name: 'Approve', call: APPROVAL_ID }, 'Pay'], { id: CLAIM_ID });
    const json = (w: Workflow) => JSON.parse(JSON.stringify(w));

    it('keeps a waiting child run on its version when a newer one is registered and the host restarts', async () => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'awa-seams-'));
        try {
            for (const document of [CLAIM, V1]) await add_definition(dir, json(document));
            let host = await open_runtime_directory(dir, { engine: engine_options() });
            const run = await host.start(CLAIM_ID);
            const child = run.getSubworkflowRuns()[0];
            const review = waiting_at(await run.getSubworkflowEvents(child.run_id), 'Review');
            await host.close();
            await add_definition(dir, json(V2));
            host = await open_runtime_directory(dir, { engine: engine_options() });
            expect(await host.resume(run.getRunId(), review, { approved: true })).toBe(true);
            const parent = host.get_run(run.getRunId())!;
            expect(parent.getStatus()).toBe('completed');
            expect((await parent.getSubworkflowEvents(child.run_id)).map(e => e.node_name)).not.toContain('Audit');
            // A new child run starts on the newest version
            const next = await host.start(CLAIM_ID);
            const started = (await next.getEvents()).find(e => e.type === 'subworkflow.started')!;
            expect(started.data.workflow_version).toBe('2.0.0');
            await host.close();
        } finally {
            fs.rmSync(dir, { recursive: true, force: true });
        }
    });

    it('refuses to start when a waiting child run needs a version that is no longer registered, though another is', async () => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'awa-seams-'));
        try {
            for (const document of [CLAIM, V1]) await add_definition(dir, json(document));
            const host = await open_runtime_directory(dir, { engine: engine_options() });
            await host.start(CLAIM_ID);
            await host.close();
            fs.rmSync(path.join(dir, 'definitions', `workflow-${APPROVAL_ID}@1.0.0.json`));
            await add_definition(dir, json(V2));
            await expect(open_runtime_directory(dir, { engine: engine_options() })).rejects.toThrow(/version 1\.0\.0, which is not registered/);
        } finally {
            fs.rmSync(dir, { recursive: true, force: true });
        }
    });

    it('starts a child run on the version the host pins', async () => {
        const host = new AwaRuntime({ engine: engine_options(), pinned_versions: { [APPROVAL_ID]: '1.0.0' } });
        for (const document of [CLAIM, V1, V2]) host.register_workflow(document);
        const run = await host.start(CLAIM_ID);
        expect((await run.getEvents()).find(e => e.type === 'subworkflow.started')!.data.workflow_version).toBe('1.0.0');
    });
});

describe('Moving a run that keeps a record of who did what (spec 25.3, 30)', () => {
    it('keeps the approvals given under a four-eyes rule, and who started the run, when the run moves to another version', async () => {
        const ids: Record<string, string> = {};
        const id = randomUUID();
        const V1 = workflow('Payment', [{ name: 'Approve', human: true }, 'Pay'], { id, version: '1.0.0', ids });
        const V2 = workflow('Payment', [{ name: 'Approve', human: true }, 'Pay', 'Notify'], { id, version: '2.0.0', ids });
        const policy: AuthorizationPolicy = {
            ...POLICY,
            separation_of_duties: [{ id: 'not-the-requester', activities: ['Approve'], includes_starter: true }],
            four_eyes: [{ id: 'two', activities: ['Approve'], approvals: 2 }],
        };
        const host = new AwaRuntime({ engine: engine_options({ authorization: { policy } }) });
        host.register_workflow(V1).register_workflow(V2);
        const run = await host.start(id, {}, undefined, { principal: person('requester'), version: '1.0.0' });
        const approve = waiting_at(await run.getEvents(), 'Approve');
        expect(await host.resume(run.getRunId(), approve, { ok: true }, person('ann'))).toBe(true);
        const moved = await host.migrate(run.getRunId(), { to_version: '2.0.0' }, { principal: person('operator') });
        expect(moved.refusals).toEqual([]);
        expect(moved.applied).toBe(true);
        const after = host.get_run(run.getRunId())!;
        expect((await after.getEvents()).find(e => e.type === 'run.migrated')!.data.principal).toEqual(person('operator'));
        await expect(host.resume(run.getRunId(), approve, { ok: true }, person('ann'))).rejects.toMatchObject({ code: 'FORBIDDEN' });
        await expect(host.resume(run.getRunId(), approve, { ok: true }, person('requester'))).rejects.toMatchObject({ code: 'FORBIDDEN' });
        expect(await host.resume(run.getRunId(), approve, { ok: true }, person('ben'))).toBe(true);
        expect(after.getStatus()).toBe('completed');
        expect((await after.getEvents()).find(e => e.type === 'activity.completed' && e.node_name === 'Approve')!.data.approvals).toEqual([person('ann'), person('ben')]);
    });
});

describe('Routes where authorization meets migration and A2A (spec 25.6, 28.8, 30.4)', () => {
    const secret = 'seams-secret';
    const token = (sub: string, roles: string[]) => create_jwt({ sub, role: roles[0], permissions: [], roles } as never, secret);
    let server: http.Server | undefined;
    let base = '';
    const listen = async (app: http.RequestListener) => {
        server = http.createServer(app).listen(0, '127.0.0.1');
        await new Promise(resolve => server!.once('listening', resolve));
        base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    };
    const post = async (route: string, bearer: string, body: unknown = {}) => {
        const response = await fetch(`${base}${route}`, { method: 'POST', headers: { 'content-type': 'application/json', 'a2a-version': '1.0', authorization: `Bearer ${bearer}` }, body: JSON.stringify(body) });
        return { status: response.status, body: await response.json() as any };
    };
    afterAll(async () => {
        set_journey_runtime(undefined);
        if (server) await new Promise(resolve => server!.close(resolve));
        server = undefined;
    });

    it('asks the policy before a run is moved over HTTP, and records who moved it', async () => {
        const ids: Record<string, string> = {};
        const id = randomUUID();
        const V1 = workflow('Payment', [{ name: 'Approve', human: true }, 'Pay'], { id, version: '1.0.0', ids });
        const V2 = workflow('Payment', [{ name: 'Approve', human: true }, 'Pay', 'Notify'], { id, version: '2.0.0', ids });
        const policy: AuthorizationPolicy = {
            rules: [
                { id: 'operators', effect: 'allow', actions: ['migrate_run'], subject: { roles: ['operator'] } },
                { id: 'host', effect: 'allow', actions: ['start_run'], subject: { ids: ['host'] } },
            ],
        };
        const host = new AwaRuntime({ engine: engine_options({ authorization: { policy } }) });
        host.register_workflow(V1).register_workflow(V2);
        set_journey_runtime(host);
        await listen(createServer({ request_logging: false, auth: { enabled: true, jwt_secret: secret, public_paths: ['/health'] }, authorization: { policy } }) as unknown as http.RequestListener);
        const run = await host.start(id, {}, undefined, { version: '1.0.0' });
        const route = `/api/v1/journeys/runs/${run.getRunId()}/migrate`;

        const refused = await post(route, token('mallory', ['clerk']), { to_version: '2.0.0' });
        expect(refused.status).toBe(403);
        expect(refused.body).toMatchObject({ code: 'FORBIDDEN', decision: { action: 'migrate_run', decision: 'deny', principal: { id: 'mallory', kind: 'person' } } });
        expect(host.get_run(run.getRunId())!.getWorkflow().version).toBe('1.0.0');
        expect((await post(`${route}?dry_run=true`, token('mallory', ['clerk']), { to_version: '2.0.0' })).status).toBe(403);

        const moved = await post(route, token('olga', ['operator']), { to_version: '2.0.0' });
        expect(moved).toMatchObject({ status: 200, body: { applied: true } });
        const migrated = (await host.get_run(run.getRunId())!.getEvents()).find(e => e.type === 'run.migrated')!;
        expect(migrated.data.principal).toEqual({ id: 'olga', kind: 'person' });
        await new Promise(resolve => server!.close(resolve));
        server = undefined;
        set_journey_runtime(undefined);
    });

    it('starts the run of a workflow offered over A2A as the caller, and asks the policy before starting or cancelling it', async () => {
        const offered = workflow('Triage', [{ name: 'Assess', human: true }]);
        const policy: AuthorizationPolicy = {
            rules: [
                { id: 'agents-start', effect: 'allow', actions: ['start_run'], subject: { roles: ['partner'] } },
                // Runs the host starts are allowed: an A2A caller must not pass for the host
                { id: 'host', effect: 'allow', actions: ['start_run', 'cancel_run'], subject: { ids: ['host'] } },
            ],
        };
        await listen(createServer({
            request_logging: false, auth: { enabled: true, jwt_secret: secret, public_paths: ['/health'] }, authorization: { policy },
            a2a: { workflows: [offered], options: { engine: () => engine_options({ authorization: { policy } }) } },
        }) as unknown as http.RequestListener);
        const send = (bearer: string) => post(`/a2a/${offered.id}`, bearer, { jsonrpc: '2.0', id: 1, method: 'SendMessage', params: { message: { role: 'ROLE_USER', messageId: randomUUID(), parts: [{ data: { claim: 1 } }] } } });

        const refused = await send(token('mallory', ['visitor']));
        expect(refused.status).toBe(403);
        expect(refused.body).toMatchObject({ code: 'FORBIDDEN', decision: { action: 'start_run', principal: { id: 'mallory', kind: 'person' } } });

        const started = await send(token('pat', ['partner']));
        expect(started.status).toBe(200);
        const task = started.body.result.task;
        expect(task.status.state).toBe('TASK_STATE_WORKING');
        const cancelled = await post(`/a2a/${offered.id}`, token('pat', ['partner']), { jsonrpc: '2.0', id: 2, method: 'CancelTask', params: { id: task.id } });
        expect(cancelled.status).toBe(403);
        expect(cancelled.body).toMatchObject({ code: 'FORBIDDEN', decision: { action: 'cancel_run' } });
    });
});

const unavailable = postgres_unavailable();
if (unavailable) console.warn(`Shared store seam tests skipped: ${unavailable}`);
(unavailable ? describe.skip : describe)('A child run on a shared store (spec 24.8, 25.1, 29, 30)', () => {
    let pg: TestPostgres;
    beforeAll(async () => { pg = await start_postgres(); }, 60_000);
    afterAll(async () => { await pg?.stop(); });

    it('keeps a child run on its version on another host, which decides separation of duties on the parent\'s record', async () => {
        const APPROVAL_ID = randomUUID(), CLAIM_ID = randomUUID();
        const ids: Record<string, string> = {};
        const V1 = workflow('Approval', [{ name: 'Review', human: true }, 'Record'], { id: APPROVAL_ID, version: '1.0.0', ids });
        const V2 = workflow('Approval', [{ name: 'Review', human: true }, 'Record', 'Audit'], { id: APPROVAL_ID, version: '2.0.0', ids });
        const CLAIM = workflow('Claim', [{ name: 'Submit', human: true }, { name: 'Approve', call: APPROVAL_ID }, 'Pay'], { id: CLAIM_ID });
        const url = await pg.database();
        const store = await PostgresRuntimeStore.open(url);
        for (const document of [CLAIM, V1]) await store.add_definition(JSON.parse(JSON.stringify(document)));
        await store.close();
        const engine = engine_options({ authorization: { policy: POLICY } });
        const a = await open_runtime_store(url, { engine });
        const b = await open_runtime_store(url, { engine });
        try {
            const run = await a.start(CLAIM_ID, {}, undefined, { principal: person('alice') });
            await a.resume(run.getRunId(), waiting_at(await run.getEvents(), 'Submit'), {}, person('alice'));
            await a.refresh();
            const child = a.get_run(run.getRunId())!.getSubworkflowRuns()[0];
            const review = waiting_at(await a.get_run(run.getRunId())!.getSubworkflowEvents(child.run_id), 'Review');
            // Version 2 is registered on the other host while the child waits
            b.register_workflow(V2);
            await expect(b.resume(child.run_id, review, {}, person('alice'))).rejects.toMatchObject({ code: 'FORBIDDEN' });
            expect(await b.resume(child.run_id, review, {}, person('bob'))).toBe(true);
            await b.refresh();
            const parent = b.get_run(run.getRunId())!;
            expect(parent.getStatus()).toBe('completed');
            expect((await parent.getSubworkflowEvents(child.run_id)).map(e => e.node_name)).not.toContain('Audit');
        } finally {
            await a.close();
            await b.close();
        }
    }, 60_000);
});
