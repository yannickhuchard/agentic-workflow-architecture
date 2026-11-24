/**
 * Identity and authorization (specification section 30): what the conformance cases cannot reach.
 * Policy validation, JWT claims, an external decider and its failures, credentials, recovery of
 * separation of duties and four-eyes approvals, the runtime host, and the HTTP routes.
 */
import { describe, it, expect, afterAll } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { AddressInfo } from 'net';
import { Server } from 'http';
import { WorkflowEngine } from '../src/runtime/workflow_engine';
import { AwaRuntime } from '../src/runtime/runtime';
import { Workflow, ToolBinding } from '../src/types';
import { Actor } from '../src/runtime/actors/actor';
import {
    AuthorizationError, AuthorizationOptions, PolicyDecider, load_authorization, principal_from_claims, validate_policy,
} from '../src/runtime/authorization';
import { load_deployment } from '../src/cli/deployment';
import { createServer, create_jwt } from '../src/server';
import { set_journey_runtime } from '../src/server/routes/journeys';
import { silent_logger } from './helpers';
import { parse_document } from '../src/validator';

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const ROLE = id(90);

function workflow(activities: { name: string; actor_type: string; tools?: unknown[]; a2a?: unknown }[]): Workflow {
    return parse_document({
        id: id(1), name: 'Claims', version: '1.0.0', awa_version: '1.1',
        roles: [{ id: ROLE, name: 'Clerk', actor_type: 'human' }],
        activities: activities.map((a, i) => ({ id: id(10 + i), role_id: ROLE, ...a })),
        edges: activities.slice(1).map((_, i) => ({ id: id(50 + i), source_id: id(10 + i), target_id: id(11 + i) })),
    });
}

const person: Actor = { execute: async activity => ({ _requires_human_action: true, _human_task_id: `task-${activity.name}` }) };
const app: Actor = { execute: async () => ({ done: true }) };
const alice = { id: 'alice', kind: 'person' as const, attributes: { roles: ['clerk'] } };
const bob = { id: 'bob', kind: 'person' as const, attributes: { roles: ['clerk'] } };

function engine(wf: Workflow, authorization: AuthorizationOptions, extra: Record<string, unknown> = {}) {
    return new WorkflowEngine(wf, {
        actors: { human: person, application: app, ai_agent: app, robot: app }, wait_for_human_tasks: true,
        execution_logger: silent_logger, authorization, ...extra,
    });
}
const waiting = (e: WorkflowEngine) => e.getTokens().find(t => t.status === 'waiting')!;
const decided = async (e: WorkflowEngine) => (await e.getEvents()).filter(ev => ev.type === 'authorization.decided').map(ev => ev.data);

const open = { rules: [{ id: 'all', effect: 'allow' as const, actions: ['*' as const] }] };

describe('Authorization: the policy', () => {
    it('refuses a policy that is not valid, naming every problem', () => {
        const errors = validate_policy({
            rules: [
                { id: 'a', effect: 'permit', actions: ['fly'] },
                { id: 'a', effect: 'allow', actions: ['start_run'], condition: 'amount >' },
                { id: 'b', effect: 'allow', actions: ['start_run'], subject: { kinds: ['alien'] }, extra: 1 },
            ],
            separation_of_duties: [{ id: 's', activities: ['Only'] }],
            four_eyes: [{ id: 'f', activities: ['Approve'], approvals: 1 }],
            other: [],
        });
        for (const fragment of ['unknown property "other"', '"effect" must be', 'unknown action "fly"', 'id "a" is used twice', 'condition', 'unknown kind "alien"',
            'unknown property "extra"', 'at least two activities', 'at least 2']) {
            expect(errors.some(e => e.includes(fragment)), `${fragment} in ${errors.join(' | ')}`).toBe(true);
        }
        expect(validate_policy(open)).toEqual([]);
        expect(() => load_authorization({ policy: { rules: [{ id: 'x', effect: 'allow', actions: [] }] } })).toThrow(/Invalid authorization/);
        expect(() => load_authorization({ principals: [{ id: 'p', kind: 'robot', acts_for: { teams: [] } }] })).toThrow(/acts_for: unknown property "teams"/);
        expect(() => load_authorization({ decider: {} })).toThrow(/unknown property "decider"/);
    });

    it('reads the authorization section of a deployment file, and refuses an invalid one', () => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'awa-authz-'));
        const file = path.join(dir, 'deployment.json');
        fs.writeFileSync(file, JSON.stringify({ tools: {}, authorization: { policy: open, record_allows: true } }));
        expect(load_deployment(file).authorization).toMatchObject({ record_allows: true });
        fs.writeFileSync(file, JSON.stringify({ authorization: { policy: { rules: [{ id: 'x', effect: 'allow', actions: ['nope'] }] } } }));
        expect(() => load_deployment(file)).toThrow(/unknown action "nope"/);
    });

    it('takes a principal from the claims of a JWT', () => {
        expect(principal_from_claims({ sub: 'u-1', iat: 1, exp: 2, role: 'operator', roles: ['approver'], groups: ['claims'], clearance: 3, name: 'Ann' }))
            .toEqual({ id: 'u-1', kind: 'person', name: 'Ann', attributes: { roles: ['approver', 'operator'], groups: ['claims'], clearance: 3 } });
        expect(principal_from_claims({ sub: 'svc', kind: 'service' }).kind).toBe('service');
        expect(principal_from_claims({ sub: 'x', kind: 'wizard' }).kind).toBe('person');
    });

    it('matches attributes by any of the values a rule lists', () => {
        const decider = new PolicyDecider({ rules: [{ id: 'eu', effect: 'allow', actions: ['start_run'], subject: { attributes: { region: ['eu', 'uk'] } } }] });
        const ask = (region: unknown) => decider.decide({ action: 'start_run', principal: { id: 'p', kind: 'person', attributes: { region } }, resource: {}, run: {}, history: { performed: [] } }).decision;
        expect(ask('uk')).toBe('allow');
        expect(ask(['us', 'eu'])).toBe('allow');
        expect(ask('us')).toBe('deny');
    });
});

describe('Authorization: a policy given in code', () => {
    it('is refused when the engine is made, as one read from a file is', () => {
        expect(() => engine(workflow([{ name: 'Review', actor_type: 'human' }]), { policy: { rules: [{ id: 'x', effect: 'allow', actions: ['fly' as never] }] } }))
            .toThrow(/unknown action "fly"/);
    });
});

describe('Authorization: the decider', () => {
    const wf = workflow([{ name: 'Review', actor_type: 'human' }]);

    it('lets an external decider decide, and records its decisions the same way', async () => {
        const asked: string[] = [];
        const e = engine(wf, { decider: { decide: async request => { asked.push(request.action); return request.principal.id === 'bob' ? { decision: 'allow', rule: 'opa:allow', reason: 'rule' } : { decision: 'deny', rule: 'opa:deny', reason: 'rule', message: 'not bob' }; } } }, { principal: bob });
        await e.start({});
        await e.run();
        await expect(e.resumeToken(waiting(e).id, {}, alice)).rejects.toMatchObject({ code: 'FORBIDDEN', decision: { rule: 'opa:deny' } });
        expect(await e.resumeToken(waiting(e).id, { ok: true }, bob)).toBe(true);
        await e.run();
        expect(e.getStatus()).toBe('completed');
        expect(asked).toEqual(['start_run', 'complete_task', 'complete_task']);
        expect(await decided(e)).toEqual([expect.objectContaining({ action: 'complete_task', decision: 'deny', rule: 'opa:deny', message: 'not bob' })]);
    });

    it('fails closed when the decider throws or gives no decision', async () => {
        for (const decide of [async () => { throw new Error('policy engine unreachable'); }, async () => ({ verdict: 'yes' })]) {
            const e = engine(wf, { decider: { decide: decide as never } });
            await expect(e.start({})).rejects.toMatchObject({ code: 'FORBIDDEN', decision: { reason: 'decider_error' } });
            expect(await e.getEvents()).toEqual([]);
        }
    });
});

describe('Authorization: credentials of an identity', () => {
    it('sends the identity\'s credentials with its HTTP tool calls, in place of the binding\'s header of the same name', async () => {
        const seen: Record<string, string>[] = [];
        const wf = workflow([{
            name: 'Look up', actor_type: 'ai_agent',
            tools: [{ name: 'policy', description: 'Find a policy', binding: { kind: 'http', method: 'GET', url: 'https://api.example/policies', headers: { Authorization: 'Bearer from-document', 'X-Trace': '1' } } }],
        }]);
        const caller: Actor = { execute: async (_a, _i, context) => { await context!.tools!.call('policy', {}); return {}; } };
        const e = new WorkflowEngine(wf, {
            actors: { ai_agent: caller }, execution_logger: silent_logger,
            tools: {
                secrets: { BOT_TOKEN: 's3cret' },
                executors: { http: async (binding: ToolBinding) => { seen.push({ ...(binding as { headers: Record<string, string> }).headers }); return { status: 200, result: {} }; } },
            },
            authorization: { principals: [{ id: 'agent:bot', kind: 'ai_agent', acts_for: { activities: ['Look up'] }, credentials: { Authorization: 'Bearer {{secret:BOT_TOKEN}}' } }] },
        });
        await e.start({});
        expect(await e.run()).toBe('completed');
        expect(seen).toEqual([{ authorization: 'Bearer {{secret:BOT_TOKEN}}', 'x-trace': '1' }]);
        expect(JSON.stringify(await e.getEvents())).not.toContain('BOT_TOKEN');
    });

    it('sends the identity\'s credentials to an agent over A2A', async () => {
        const CARD = 'https://agents.example/.well-known/agent-card.json';
        const headers: Record<string, string>[] = [];
        const wf = workflow([{ name: 'Assess', actor_type: 'ai_agent', a2a: { agent_card: CARD } }]);
        const e = new WorkflowEngine(wf, {
            execution_logger: silent_logger,
            a2a: {
                secrets: { PARTNER: 'p-key' }, poll_interval_ms: 0,
                transport: async request => {
                    headers.push(request.headers);
                    if (request.method === 'GET') return { status: 200, body: JSON.stringify({ name: 'A', supportedInterfaces: [{ url: 'https://agents.example/rpc', protocolBinding: 'JSONRPC', protocolVersion: '1.0' }] }) };
                    const body = JSON.parse(request.body!);
                    return { status: 200, body: JSON.stringify({ jsonrpc: '2.0', id: body.id, result: { message: { messageId: 'm', role: 'ROLE_AGENT', parts: [{ data: { ok: true } }] } } }) };
                },
            },
            authorization: { principals: [{ id: 'agent:partner', kind: 'ai_agent', acts_for: { agents: [CARD] }, credentials: { 'X-Api-Key': '{{secret:PARTNER}}' } }] },
        });
        await e.start({});
        expect(await e.run()).toBe('completed');
        expect(headers.at(-1)).toMatchObject({ 'x-api-key': 'p-key' });
        expect((await e.getEvents()).find(ev => ev.type === 'activity.started')!.data.principal).toEqual({ id: 'agent:partner', kind: 'ai_agent' });
    });
});

describe('Authorization: a run that is recovered', () => {
    it('keeps who performed what, and the approvals already given, across a checkpoint', async () => {
        const wf = workflow([{ name: 'Submit', actor_type: 'human' }, { name: 'Approve', actor_type: 'human' }]);
        const authorization: AuthorizationOptions = {
            policy: {
                rules: [{ id: 'clerks', effect: 'allow', actions: ['start_run', 'complete_task', 'approve'], subject: { roles: ['clerk'] } }],
                separation_of_duties: [{ id: 'sod', activities: ['Submit', 'Approve'] }],
                four_eyes: [{ id: 'two', activities: ['Approve'], approvals: 2 }],
            },
            principals: [{ id: 'carol', kind: 'person', attributes: { roles: ['clerk'] } }],
        };
        const first = engine(wf, authorization, { principal: bob });
        await first.start({});
        await first.run();
        await first.resumeToken(waiting(first).id, { amount: 5 }, alice);
        await first.run();
        await first.resumeToken(waiting(first).id, { approved: true }, bob);
        expect(first.getStatus()).toBe('waiting_human');

        const restored = WorkflowEngine.restore(wf, JSON.parse(JSON.stringify(first.snapshot())), {
            actors: { human: person }, wait_for_human_tasks: true, execution_logger: silent_logger, authorization, journal: undefined,
        });
        await expect(restored.resumeToken(waiting(restored).id, {}, alice)).rejects.toMatchObject({ decision: { reason: 'separation_of_duties' } });
        await expect(restored.resumeToken(waiting(restored).id, {}, bob)).rejects.toMatchObject({ decision: { reason: 'four_eyes' } });
        expect(await restored.resumeToken(waiting(restored).id, { approved: true }, { id: 'carol', kind: 'person', attributes: { roles: ['clerk'] } })).toBe(true);
        await restored.run();
        expect(restored.getStatus()).toBe('completed');
        const completed = (await restored.getEvents()).find(ev => ev.type === 'activity.completed')!;
        expect(completed.data).toMatchObject({ principal: { id: 'carol' }, approvals: [{ id: 'bob', kind: 'person' }, { id: 'carol', kind: 'person' }] });
    });
});

describe('Authorization: the runtime host', () => {
    const wf = workflow([{ name: 'Review', actor_type: 'human' }]);
    const policy = { rules: [{ id: 'clerks', effect: 'allow' as const, actions: ['start_run' as const, 'complete_task' as const], subject: { roles: ['clerk'] } }] };

    it('leaves no run behind when a start is refused, and keeps a task waiting when an answer is', async () => {
        const runtime = new AwaRuntime({ engine: { actors: { human: person }, wait_for_human_tasks: true, execution_logger: silent_logger, authorization: { policy } } });
        runtime.register_workflow(wf);
        await expect(runtime.start(wf.id, {})).rejects.toBeInstanceOf(AuthorizationError);   // the host itself is not allowed
        expect(runtime.list_runs()).toEqual([]);
        const run = await runtime.start(wf.id, {}, undefined, alice);
        const token = waiting(run).id;
        await expect(runtime.resume(run.getRunId(), token, {}, { id: 'mallory', kind: 'person' })).rejects.toMatchObject({ code: 'FORBIDDEN' });
        expect(run.getStatus()).toBe('waiting_human');
        expect(await runtime.resume(run.getRunId(), token, { ok: true }, bob)).toBe(true);
        expect(run.getStatus()).toBe('completed');
    });
});

describe('Authorization: the Operational API', () => {
    const secret = 'test-secret';
    const policy = {
        rules: [
            { id: 'clerks', effect: 'allow' as const, actions: ['start_run' as const, 'complete_task' as const, 'read_journal' as const], subject: { roles: ['clerk'] } },
            { id: 'host', effect: 'allow' as const, actions: ['start_run' as const], subject: { ids: ['host'] } },
        ],
    };
    let server: Server | undefined;
    afterAll(async () => { set_journey_runtime(undefined); if (server) await new Promise(resolve => server!.close(resolve)); });

    it('answers 403 FORBIDDEN where the policy says no, and takes the principal from the JWT', async () => {
        const wf = workflow([{ name: 'Review', actor_type: 'human' }]);
        const runtime = new AwaRuntime({ engine: { actors: { human: person }, wait_for_human_tasks: true, execution_logger: silent_logger, authorization: { policy } } });
        runtime.register_workflow(wf);
        set_journey_runtime(runtime);
        server = createServer({ request_logging: false, auth: { enabled: true, jwt_secret: secret, public_paths: ['/health'] }, authorization: { policy } }).listen(0);
        await new Promise(resolve => server!.once('listening', resolve));
        const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
        const token = (sub: string, roles: string[]) => create_jwt({ sub, role: 'operator', permissions: [], roles } as never, secret);
        const call = async (route: string, bearer: string, body: unknown = {}) => {
            const response = await fetch(`${base}${route}`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${bearer}` }, body: JSON.stringify(body) });
            return { status: response.status, body: await response.json() as any };
        };

        const run = await runtime.start(wf.id, {});
        const waiter = waiting(run).id;
        const refused = await call(`/api/v1/journeys/runs/${run.getRunId()}/tokens/${waiter}/resume`, token('mallory', ['visitor']), { ok: true });
        expect(refused.status).toBe(403);
        expect(refused.body).toMatchObject({ code: 'FORBIDDEN', decision: { action: 'complete_task', decision: 'deny', reason: 'no_rule', principal: { id: 'mallory', kind: 'person' } } });
        expect(run.getStatus()).toBe('waiting_human');
        const allowed = await call(`/api/v1/journeys/runs/${run.getRunId()}/tokens/${waiter}/resume`, token('ann', ['clerk']), { ok: true });
        expect(allowed).toMatchObject({ status: 200, body: { resumed: true } });
        expect((await run.getEvents()).find(ev => ev.type === 'activity.completed')!.data.principal).toEqual({ id: 'ann', kind: 'person' });

        // Publishing an event is an action of its own, which this policy allows nobody
        expect((await call('/api/v1/journeys/events', token('ann', ['clerk']), { type: 'claim.filed', data: {} })).status).toBe(403);
        // Starting a run from a file: refused for a visitor before anything runs
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'awa-authz-wf-'));
        fs.writeFileSync(path.join(dir, 'claims.json'), JSON.stringify(wf));
        const before = process.env.AWA_WORKFLOWS_DIR;
        process.env.AWA_WORKFLOWS_DIR = dir;
        try {
            const started = await call('/api/v1/workflows/run', token('mallory', ['visitor']), { filePath: 'claims.json', simulate: true });
            expect(started).toMatchObject({ status: 403, body: { code: 'FORBIDDEN', decision: { action: 'start_run' } } });
        } finally {
            if (before === undefined) delete process.env.AWA_WORKFLOWS_DIR; else process.env.AWA_WORKFLOWS_DIR = before;
        }
    });
});
