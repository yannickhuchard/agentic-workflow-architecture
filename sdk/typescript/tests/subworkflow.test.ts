/**
 * Sub-workflows (specification section 24): what the conformance cases cannot
 * reach. Child runs at several depths, refusals, a parent restored with a child
 * that waits, replay and the recipe, a journey whose run calls workflows, and
 * the same journey on a runtime directory and on a PostgreSQL store shared by
 * two hosts.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'crypto';
import { spawnSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { Activity, Workflow } from '../src/types';
import { parse_document } from '../src/validator';
import { Actor } from '../src/runtime/actors/actor';
import { WorkflowEngine, WorkflowEngineOptions } from '../src/runtime/workflow_engine';
import { InMemoryJournalStore, JournalEvent } from '../src/runtime/journal';
import { AwaRuntime, add_definition, open_runtime_directory } from '../src/runtime/runtime';
import { open_runtime_store, PostgresRuntimeStore } from '../src/runtime/postgres_store';
import { counterfactual_replay } from '../src/runtime/counterfactual';
import { compile_recipe } from '../src/runtime/recipe';
import { run_spans, run_span_id, run_trace_id } from '../src/runtime/telemetry';
import { BusinessEvent } from '../src/runtime/business_event';
import { postgres_unavailable, start_postgres, TestPostgres } from './postgres';

const ROLE = '7d1c0e55-0000-4000-8000-000000000001';

/** A workflow from a list of activity names in sequence; `{ call: <workflow> }` makes a call activity, `human` a person's activity */
function workflow(name: string, steps: (string | { name: string; call?: Workflow; human?: boolean; wait?: string; extra?: Partial<Activity> })[], id: string = randomUUID()): Workflow {
    const activities: Record<string, unknown>[] = [];
    const events: Record<string, unknown>[] = [];
    const nodes: string[] = [];
    for (const step of steps) {
        const s = typeof step === 'string' ? { name: step } : step;
        const node = randomUUID();
        nodes.push(node);
        if (s.wait) {
            events.push({ id: node, name: s.name, event_type: 'message', event_definition: { name: s.wait, correlation_key: 'claim_id' } });
            continue;
        }
        activities.push({
            id: node, name: s.name, role_id: ROLE, actor_type: s.human ? 'human' : 'application',
            ...(s.call ? { is_expandable: true, expansion_workflow_id: s.call.id } : {}), ...(s.extra || {}),
        });
    }
    const edges = nodes.slice(1).map((target, i) => ({ id: randomUUID(), source_id: nodes[i], target_id: target }));
    return parse_document({ id, name, version: '1.0.0', awa_version: '1.1', activities, events, edges });
}

/** Returns what is scripted by activity name; a person's activity becomes a task that waits */
class Scripted implements Actor {
    public visited: string[] = [];
    constructor(private outputs: Record<string, Record<string, unknown>> = {}) { }
    async execute(activity: Activity): Promise<Record<string, unknown>> {
        this.visited.push(activity.name);
        if (activity.actor_type === 'human') return { _requires_human_action: true, _human_task_id: `task-${activity.name}` };
        return { ...(this.outputs[activity.name] || {}) };
    }
}

const quiet = { execution_logger: { log_execution: async () => { } }, sleep: async () => { } };
const with_actor = (actor: Actor, extra: WorkflowEngineOptions = {}): WorkflowEngineOptions =>
    ({ actors: { application: actor, ai_agent: actor, human: actor, robot: actor }, wait_for_human_tasks: true, ...quiet, ...extra });
const event = (type: string, claim_id: string, id: string, data: Record<string, unknown> = {}): BusinessEvent =>
    ({ specversion: '1.0', id, source: '/test', type, data: { claim_id, ...data } });
const numbered = (events: JournalEvent[]) => events.every((e, i) => e.seq === i + 1);

// The claim: documents are collected by one workflow, approval given in another
const COLLECT = workflow('Collect documents', ['Request', { name: 'Documents received', wait: 'documents.received' }, 'File']);
const APPROVAL = workflow('Approval', [{ name: 'Review', human: true }, 'Record']);
const CLAIM = workflow('Claim', ['Open', { name: 'Collect', call: COLLECT }, { name: 'Approve', call: APPROVAL }, 'Pay']);
const CLAIM_WORKFLOWS = [CLAIM, COLLECT, APPROVAL];
const outputs = { File: { filed: true }, Record: { recorded: true }, Pay: { paid: true } };

/** The token of a run that waits for a person at that activity, from its journal */
const task_of = (events: JournalEvent[], activity: string) =>
    events.find(e => e.type === 'token.waiting' && e.node_name === activity && e.data.reason === 'human_task')!.token_id!;

describe('Sub-workflows: the engine', () => {
    it('lists the child runs at every depth, in the order they started, each linked to its parent', async () => {
        const c = workflow('C', ['Deepest']);
        const b = workflow('B', ['Middle', { name: 'Call C', call: c }]);
        const a = workflow('A', ['Top', { name: 'Call B', call: b }]);
        const journal = new InMemoryJournalStore();
        const engine = new WorkflowEngine(a, with_actor(new Scripted({ Deepest: { depth_reached: 2 } }), { journal, subworkflows: { workflows: [a, b, c] } }));
        await engine.start({});
        expect(await engine.run()).toBe('completed');
        const runs = engine.getSubworkflowRuns();
        expect(runs.map(r => [r.workflow_name, r.depth, r.status])).toEqual([['B', 1, 'completed'], ['C', 2, 'completed']]);
        expect(runs[1].parent_run_id).toBe(runs[0].run_id);
        const deepest = await engine.getSubworkflowEvents(runs[1].run_id);
        expect(deepest[0].data).toMatchObject({ depth: 2, parent: { run_id: runs[0].run_id, root_run_id: engine.getRunId() } });
        expect(engine.getTokens()[0].contextData).toMatchObject({ depth_reached: 2 });
        expect(engine.hasSubworkflowRun(runs[1].run_id)).toBe(true);
        expect(await engine.getSubworkflowEvents(randomUUID())).toEqual([]);
    });

    it('takes the depth limit from the deployment', async () => {
        const loop = workflow('Loop', ['Step', { name: 'Again', call: undefined }]);
        (loop.activities[1] as Activity).is_expandable = true;
        (loop.activities[1] as Activity).expansion_workflow_id = loop.id;
        const engine = new WorkflowEngine(loop, with_actor(new Scripted(), { subworkflows: { workflows: [loop], max_depth: 2 } }));
        await engine.start({});
        expect(await engine.run()).toBe('failed');
        expect(engine.getSubworkflowRuns().map(r => r.depth)).toEqual([1, 2]);
        const deepest = await engine.getSubworkflowEvents(engine.getSubworkflowRuns()[1].run_id);
        expect(deepest.find(e => e.type === 'activity.failed')?.data.error).toMatchObject({ code: 'SUBWORKFLOW_DEPTH_EXCEEDED' });
    });

    it('does not let a token waiting on a child be resumed as if a person had answered, nor a task of another run', async () => {
        const engine = new WorkflowEngine(CLAIM, with_actor(new Scripted(outputs), { subworkflows: { workflows: CLAIM_WORKFLOWS } }));
        await engine.start({ claim_id: 'CL-1' });
        expect(await engine.run()).toBe('waiting_event');
        const parent_token = engine.getTokens()[0];
        expect(parent_token.status).toBe('waiting');
        expect(await engine.resumeToken(parent_token.id, { approved: true })).toBe(false);
        expect(await engine.resumeToken(randomUUID(), {})).toBe(false);
        expect(engine.getStatus()).toBe('waiting_event');
        expect(engine.nextEventDeadline()).toBeUndefined();
    });

    it('restores a parent waiting on a child, and each journal goes on after what it holds', async () => {
        const journal = new InMemoryJournalStore();
        const actor = new Scripted(outputs);
        const options = with_actor(actor, { journal, subworkflows: { workflows: CLAIM_WORKFLOWS } });
        const first = new WorkflowEngine(CLAIM, options);
        await first.start({ claim_id: 'CL-1' });
        expect(await first.run()).toBe('waiting_event');
        const state = JSON.parse(JSON.stringify(first.snapshot()));
        expect(state.metadata.subworkflows.live).toHaveLength(1);
        const child_id = state.metadata.subworkflows.live[0].run_id;
        expect(state.metadata.subworkflows.live[0].state.metadata.subworkflows.parent.run_id).toBe(first.getRunId());

        // Another process: the parent and its child are continued from the state
        const second = await WorkflowEngine.recover(CLAIM, state, options);
        expect(second.getStatus()).toBe('waiting_event');
        expect(await second.deliverEvent(event('documents.received', 'CL-1', 'evt-1'))).toBe(1);
        expect(await second.run()).toBe('waiting_human');
        const approval = second.getSubworkflowRuns().find(r => r.workflow_name === 'Approval')!;
        const token = task_of(await journal.read(approval.run_id), 'Review');

        const third = await WorkflowEngine.recover(CLAIM, JSON.parse(JSON.stringify(second.snapshot())), options);
        expect(await third.resumeToken(token, { approved: true })).toBe(true);
        expect(await third.run()).toBe('completed');
        expect(third.getTokens()[0].contextData).toMatchObject({ filed: true, approved: true, recorded: true, paid: true });
        for (const run_id of [first.getRunId(), child_id, approval.run_id]) {
            const events = await journal.read(run_id);
            expect(numbered(events), `journal of ${run_id}`).toBe(true);
            expect(events.some(e => e.type === 'run.resumed')).toBe(true);
        }
    });

    it('refuses to restore a parent whose child runs a workflow that is not registered', async () => {
        const engine = new WorkflowEngine(CLAIM, with_actor(new Scripted(), { subworkflows: { workflows: CLAIM_WORKFLOWS } }));
        await engine.start({ claim_id: 'CL-1' });
        await engine.run();
        expect(() => WorkflowEngine.restore(CLAIM, engine.snapshot(), with_actor(new Scripted(), { subworkflows: { workflows: [CLAIM] } })))
            .toThrow(/not registered/);
    });

    it('cancels the child when the parent token fails while waiting, by its service level', async () => {
        let now = Date.parse('2026-01-05T09:00:00Z');
        const collect = workflow('Collect documents', ['Request', { name: 'Documents received', wait: 'documents.received' }, 'File']);
        const claim = workflow('Claim', [{ name: 'Collect', call: collect, extra: { sla: { max_time: 'PT1H', escalation_policy: { breach_action: 'fail' } } as Activity['sla'] } }]);
        const journal = new InMemoryJournalStore();
        const engine = new WorkflowEngine(claim, with_actor(new Scripted(), { journal, now: () => now, subworkflows: { workflows: [claim, collect] } }));
        await engine.start({ claim_id: 'CL-1' });
        expect(await engine.run()).toBe('waiting_event');
        now += 2 * 3600_000;
        expect((await engine.checkServiceLevels()).failed).toBe(1);
        expect(await engine.run()).toBe('failed');
        const child = engine.getSubworkflowRuns()[0];
        expect(child.status).toBe('cancelled');
        expect((await journal.read(child.run_id)).find(e => e.type === 'run.cancelled')?.data.reason).toBe('parent_failed');
    });

    it('in a replay holds the call activity as recorded and starts no child run', async () => {
        const journal = new InMemoryJournalStore();
        const engine = new WorkflowEngine(CLAIM, with_actor(new Scripted(outputs), { journal, subworkflows: { workflows: CLAIM_WORKFLOWS } }));
        await engine.start({ claim_id: 'CL-1' });
        await engine.run();
        await engine.deliverEvent(event('documents.received', 'CL-1', 'evt-1'));
        await engine.run();
        const approval = engine.getSubworkflowRuns().find(r => r.workflow_name === 'Approval')!;
        await engine.resumeToken(task_of(await journal.read(approval.run_id), 'Review'), { approved: true });
        expect(await engine.run()).toBe('completed');

        const { report, events } = await counterfactual_replay(CLAIM, await engine.getEvents(), { ai: 'recorded', engine: { subworkflows: { workflows: CLAIM_WORKFLOWS } } });
        expect(report.candidate.status).toBe('completed');
        expect(events.some(e => e.type.startsWith('subworkflow.'))).toBe(false);
        expect(report.nodes.find(n => n.node_name === 'Approve')?.verdict).toBe('same');
    });

    it('explains a parent with the child runs of each attempt, and gives the child its own trace linked to the parent', async () => {
        const journal = new InMemoryJournalStore();
        const engine = new WorkflowEngine(CLAIM, with_actor(new Scripted(outputs), { journal, subworkflows: { workflows: CLAIM_WORKFLOWS } }));
        await engine.start({ claim_id: 'CL-1' });
        await engine.run();
        const child = engine.getSubworkflowRuns()[0];
        const recipe = compile_recipe(CLAIM, await engine.getEvents());
        expect(recipe).toContain(`started child run \`${child.run_id}\` of Collect documents`);
        expect(recipe).toContain('`subworkflows`');
        expect(recipe).toContain('Performed by a child run');

        const started = (await engine.getEvents()).find(e => e.type === 'activity.started' && e.node_name === 'Collect')!;
        const spans = run_spans(COLLECT, await journal.read(child.run_id));
        const root = spans.find(s => s.parent_span_id === undefined || s.parent_span_id === null)!;
        expect(root.links).toEqual([{ trace_id: run_trace_id(engine.getRunId()), span_id: run_span_id(engine.getRunId(), started.seq) }]);
        expect(root.attributes['awa.run.parent_run_id']).toBe(engine.getRunId());
    });
});

describe('Sub-workflows: interchange', () => {
    it('keeps a call activity and its mapping through BPMN, and says Serverless Workflow does not take the mapping', async () => {
        const { export_bpmn, import_bpmn, export_serverless_workflow } = await import('../src/interchange');
        const { json_equal } = await import('../src/interchange/common');
        const c = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../../../spec/conformance/execution/subworkflow-output-becomes-the-outcome.json'), 'utf-8'));
        const exported = await export_bpmn([c.workflow]);
        expect(exported.bpmn).toContain('callActivity');
        const back = await import_bpmn(exported.bpmn, exported.dmn ? { dmn: [exported.dmn] } : {});
        expect(json_equal(back.documents[0], c.workflow)).toBe(true);
        const sw = await export_serverless_workflow(c.workflow);
        expect(sw.not_mapped.some(n => JSON.stringify(n).includes('subworkflow'))).toBe(true);
    });
});

// ---------------------------------------------------------------------------------------- hosts

const JOURNEY = {
    id: '5f2c9d1e-3b4a-4f6e-8c7d-000000000024', name: 'Claims', version: '1.0.0', subject: { name: 'claim', key: 'claim_id' },
    stages: [{ id: 'open', name: 'Open', workflows: [CLAIM.id], complete_when: 'paid == true', transitions: [] }],
    triggers: [{ event: 'claim.opened', starts_journey: true, start_workflow: CLAIM.id }],
    touchpoints: [{ id: 'filed', name: 'Documents filed', direction: 'outbound', channel: 'email', on: { activity: 'File' } }],
};

/** What a journey must show of a run that called two workflows */
function expect_journey_of_children(instance: { runs: { run_id: string; parent_run_id?: string; status: string; workflow_name: string }[]; events: { type: string; run_id?: string; data: Record<string, unknown> }[]; status: string }) {
    expect(instance.status).toBe('completed');
    const root = instance.runs.find(r => !r.parent_run_id)!;
    const children = instance.runs.filter(r => r.parent_run_id);
    expect(children.map(r => [r.workflow_name, r.status, r.parent_run_id])).toEqual([['Collect documents', 'completed', root.run_id], ['Approval', 'completed', root.run_id]]);
    const runs = instance.events.filter(e => e.type === 'journey.run_started' || e.type === 'journey.run_ended').map(e => [e.type.slice(12), e.run_id]);
    expect(runs).toEqual([
        ['started', root.run_id], ['started', children[0].run_id], ['ended', children[0].run_id],
        ['started', children[1].run_id], ['ended', children[1].run_id], ['ended', root.run_id],
    ]);
    // An activity of a child run realises the journey's touchpoint, carrying that run's id
    expect(instance.events.find(e => e.type === 'journey.touchpoint')).toMatchObject({ run_id: children[0].run_id });
    // The child's wait is the journey's: the event that resumed it is on the journey's record
    expect(instance.events.some(e => e.type === 'journey.event_received' && e.data.name === 'documents.received')).toBe(true);
}

describe('Sub-workflows: a runtime directory', () => {
    it('keeps a parent with its waiting child across restarts, and completes a task of the child by the child run id', async () => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'awa-subworkflows-'));
        try {
            for (const document of [...CLAIM_WORKFLOWS, JOURNEY]) await add_definition(dir, JSON.parse(JSON.stringify(document)));
            const engine = with_actor(new Scripted(outputs));
            let host = await open_runtime_directory(dir, { engine });
            await host.publish(event('claim.opened', 'CL-1', 'open-1'));
            const state = JSON.parse(fs.readFileSync(path.join(dir, 'runtime.json'), 'utf-8'));
            expect(state.runs, 'only runs of depth 0 are kept in runtime.json').toHaveLength(1);
            expect(state.runs[0].state.metadata.subworkflows.live).toHaveLength(1);
            await host.close();

            host = await open_runtime_directory(dir, { engine });
            await host.publish(event('documents.received', 'CL-1', 'docs-1', { pages: 2 }));
            await host.close();

            host = await open_runtime_directory(dir, { engine });
            const instance = host.list_journey_instances()[0];
            const approval = instance.runs.find(r => r.workflow_name === 'Approval')!;
            expect(approval.status).toBe('waiting_human');
            const bundle = await host.export_journey(instance.id);
            const token = task_of(bundle.runs.find(r => r.run_id === approval.run_id)!.events, 'Review');
            expect(await host.resume(randomUUID(), token, {})).toBe(false);
            expect(await host.resume(approval.run_id, token, { approved: true })).toBe(true);
            expect_journey_of_children(host.get_journey_instance(instance.id)!);
            for (const run of instance.runs) {
                const events = (await host.export_journey(instance.id)).runs.find(r => r.run_id === run.run_id)!.events;
                expect(events.length, `journal of ${run.workflow_name}`).toBeGreaterThan(0);
                expect(numbered(events)).toBe(true);
                expect(fs.existsSync(path.join(dir, 'journals', `${run.run_id}.journal.jsonl`))).toBe(true);
            }
            await host.close();
        } finally {
            fs.rmSync(dir, { recursive: true, force: true });
        }
    });

    it('refuses to start when a waiting child needs a workflow that is no longer registered', async () => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'awa-subworkflows-'));
        try {
            for (const document of [...CLAIM_WORKFLOWS, JOURNEY]) await add_definition(dir, JSON.parse(JSON.stringify(document)));
            const host = await open_runtime_directory(dir, { engine: with_actor(new Scripted(outputs)) });
            await host.publish(event('claim.opened', 'CL-1', 'open-1'));
            await host.close();
            fs.rmSync(path.join(dir, 'definitions', `workflow-${COLLECT.id}.json`));
            // The journey needs the parent only; the child's workflow is what is missing
            await expect(open_runtime_directory(dir, { engine: with_actor(new Scripted(outputs)) })).rejects.toThrow(/not registered/);
        } finally {
            fs.rmSync(dir, { recursive: true, force: true });
        }
    });
});

const unavailable = postgres_unavailable();
if (unavailable) console.warn(`Sub-workflow shared store tests skipped: ${unavailable}`);
(unavailable ? describe.skip : describe)('Sub-workflows: a shared store', () => {
    let pg: TestPostgres;
    beforeAll(async () => { pg = await start_postgres(); }, 60_000);
    afterAll(async () => { await pg?.stop(); });

    it('keeps each child run in the partition of its parent, and any host continues the parent through it', async () => {
        const url = await pg.database();
        const store = await PostgresRuntimeStore.open(url);
        for (const document of [...CLAIM_WORKFLOWS, JOURNEY]) await store.add_definition(JSON.parse(JSON.stringify(document)));
        await store.close();
        const hosts: AwaRuntime[] = [];
        const open = async () => { const h = await open_runtime_store(url, { engine: with_actor(new Scripted(outputs)) }); hosts.push(h); return h; };
        try {
            const a = await open(), b = await open();
            await a.publish(event('claim.opened', 'CL-1', 'open-1'));
            // Another host takes the event the child waits for: the store finds the child's wait through its parent
            expect((await b.publish(event('documents.received', 'CL-1', 'docs-1'))).resumed_runs).toHaveLength(1);
            await a.refresh();
            const instance = a.list_journey_instances()[0];
            const approval = instance.runs.find(r => r.workflow_name === 'Approval')!;
            const token = task_of((await a.export_journey(instance.id)).runs.find(r => r.run_id === approval.run_id)!.events, 'Review');
            expect(await a.resume(approval.run_id, token, { approved: true })).toBe(true);

            await b.refresh();
            expect_journey_of_children(b.get_journey_instance(instance.id)!);
            const { Client } = await import('pg');
            const client = new Client({ connectionString: url });
            await client.connect();
            try {
                const rows = (await client.query(`SELECT id, status, partition_key, checkpoint->'metadata'->'subworkflows'->'parent'->>'run_id' AS parent FROM awa_runtime.runs ORDER BY position`)).rows;
                expect(rows.map(r => [r.status, r.partition_key])).toEqual([['completed', 'subject:CL-1'], ['completed', 'subject:CL-1'], ['completed', 'subject:CL-1']]);
                expect(rows.slice(1).every(r => r.parent === rows[0].id)).toBe(true);
                const gaps = (await client.query(`SELECT run_id FROM awa_runtime.journal_events GROUP BY run_id HAVING MAX(seq) <> COUNT(*) OR MIN(seq) <> 1`)).rows;
                expect(gaps).toEqual([]);
                expect((await client.query(`SELECT DISTINCT run_id FROM awa_runtime.journal_events`)).rowCount).toBe(3);
            } finally {
                await client.end();
            }
        } finally {
            for (const h of hosts) await h.close();
        }
    }, 60_000);

    // A Python host and a TypeScript host on one store: each takes up the parent, with its child, that the other left (24.8, 29.5)
    const python_env = (() => { const env: NodeJS.ProcessEnv = { ...process.env, PYTHONPATH: path.resolve(__dirname, '../../python') }; delete env.AWA_DATABASE_URL; return env; })();
    const python_ready = spawnSync('python3', ['-c', 'import awa.runtime.postgres_store, psycopg'], { env: python_env, cwd: os.tmpdir() }).status === 0;
    (python_ready ? it : it.skip)('a Python host continues a parent and its child that a TypeScript host left, and the other way round', async () => {
        const url = await pg.database();
        const store = await PostgresRuntimeStore.open(url);
        for (const document of [...CLAIM_WORKFLOWS, JOURNEY]) await store.add_definition(JSON.parse(JSON.stringify(document)));
        await store.close();
        const host = await open_runtime_store(url, { engine: with_actor(new Scripted(outputs)) });
        try {
            await host.publish(event('claim.opened', 'CL-1', 'open-1'));
            const script = [
                'import json, sys',
                'from awa.runtime.postgres_store import open_runtime_store',
                'from awa.types import ActorType',
                'class Actor:',
                '    def execute(self, activity, token):',
                '        if activity.actor_type == ActorType.human:',
                '            return {"_requires_human_action": True, "_human_task_id": "task-" + activity.name}',
                '        return {"filed": True} if activity.name == "File" else {}',
                'host = open_runtime_store(sys.argv[1], engine={"actors": {t: Actor() for t in ActorType}, "sleep": lambda ms: None, "log_execution": False, "wait_for_human_tasks": True})',
                'print(json.dumps(host.publish({"specversion": "1.0", "id": "docs-1", "source": "/python", "type": "documents.received", "data": {"claim_id": "CL-1"}})))',
                'host.close()',
            ].join('\n');
            const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'awa-python-host-'));
            const python = spawnSync('python3', ['-c', script, url], { env: python_env, cwd, encoding: 'utf-8' });
            fs.rmSync(cwd, { recursive: true, force: true });
            expect(python.status, python.stderr).toBe(0);
            expect(JSON.parse(python.stdout.trim().split('\n').pop()!).resumed_runs).toHaveLength(1);

            await host.refresh();
            const instance = host.list_journey_instances()[0];
            const approval = instance.runs.find(r => r.workflow_name === 'Approval')!;
            expect(approval.status).toBe('waiting_human');
            const token = task_of((await host.export_journey(instance.id)).runs.find(r => r.run_id === approval.run_id)!.events, 'Review');
            expect(await host.resume(approval.run_id, token, { approved: true })).toBe(true);
            await host.refresh();
            expect_journey_of_children(host.get_journey_instance(instance.id)!);
        } finally {
            await host.close();
        }
    }, 60_000);
});
