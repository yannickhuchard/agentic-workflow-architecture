/**
 * Agents over A2A (specification section 28), against agents the tests start on localhost:
 * an agent built with the reference A2A SDK (@a2a-js/sdk), this SDK's own host offering a
 * workflow, and, when Python and its web packages are installed, the Python SDK's host.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import express from 'express';
import http from 'http';
import path from 'path';
import fs from 'fs';
import os from 'os';
import { ChildProcess, spawn, spawnSync } from 'child_process';
import { AddressInfo } from 'net';
import { AgentEvent, DefaultRequestHandler, InMemoryTaskStore, RequestContext, ExecutionEventBus } from '@a2a-js/sdk/server';
import { jsonRpcHandler, agentCardHandler, UserBuilder } from '@a2a-js/sdk/server/express';
import { ClientFactory } from '@a2a-js/sdk/client';
import { TaskState, Role } from '@a2a-js/sdk';
import { WorkflowEngine, WorkflowEngineOptions } from '../src/runtime/workflow_engine';
import { parse_document } from '../src/validator';
import { createServer } from '../src/server';
import { Workflow } from '../src/types';
import { silent_logger } from './helpers';

const TRIAGE = path.join(__dirname, 'fixtures/protocols/triage.awa.json');
const PYTHON_SDK = path.resolve(__dirname, '../../python');

const listen = (app: express.Express | http.RequestListener) => new Promise<{ server: http.Server; base: string; port: number }>(resolve => {
    const server = http.createServer(app as http.RequestListener).listen(0, '127.0.0.1', () => {
        const port = (server.address() as AddressInfo).port;
        resolve({ server, base: `http://127.0.0.1:${port}`, port });
    });
});

/** A workflow with one activity that the agent at `card` performs */
function delegating(card: string, extra: Record<string, unknown> = {}): Workflow {
    return parse_document({
        id: 'a2a00000-0000-4000-8000-000000000001', name: 'Delegate', version: '1.0.0', awa_version: '1.1',
        activities: [
            { id: 'a2a00000-0000-4000-8000-000000000010', name: 'Assess', description: 'Assess the claim', role_id: 'a2a00000-0000-4000-8000-000000000090', actor_type: 'ai_agent', a2a: { agent_card: card, ...extra } },
        ],
        edges: [],
    });
}

async function run(workflow: Workflow, input: Record<string, unknown>, options: WorkflowEngineOptions = {}) {
    const engine = new WorkflowEngine(workflow, { execution_logger: silent_logger, ...options, a2a: { poll_interval_ms: 20, ...(options.a2a || {}) } });
    await engine.start(input);
    const status = await engine.run();
    return { engine, status, events: await engine.getEvents() };
}

// --- an agent built with the reference SDK ------------------------------------

const part = (value: unknown) => ({ content: { $case: 'data', value }, mediaType: 'application/json', filename: '', metadata: undefined });
const data_of = (message: any): Record<string, any> => Object.assign({}, ...(message?.parts || []).filter((p: any) => p.content?.$case === 'data').map((p: any) => p.content.value));

let reference: { server: http.Server; base: string; port: number };
let reference_requests = 0;

beforeAll(async () => {
    const card: any = {
        name: 'Reference assessor', description: 'An agent built with @a2a-js/sdk', version: '1.0.0',
        supportedInterfaces: [], capabilities: { streaming: false, pushNotifications: false, extensions: [] },
        securitySchemes: {}, securityRequirements: [], defaultInputModes: ['application/json', 'text/plain'], defaultOutputModes: ['application/json'],
        skills: [{ id: 'assess', name: 'Assess', description: 'Assess a claim', tags: ['claims'], examples: [], inputModes: [], outputModes: [], securityRequirements: [] }], signatures: [],
    };
    const executor = {
        async execute(context: RequestContext, bus: ExecutionEventBus) {
            const input = data_of(context.userMessage);
            const task = (state: TaskState, extra: Record<string, unknown> = {}) => ({
                id: context.taskId, contextId: context.contextId, status: { state, message: undefined, timestamp: undefined },
                artifacts: [], history: [], metadata: undefined, ...extra,
            });
            if (input.policy_needed && !context.task) {
                bus.publish(AgentEvent.task(task(TaskState.TASK_STATE_INPUT_REQUIRED, {
                    status: { state: TaskState.TASK_STATE_INPUT_REQUIRED, timestamp: undefined, message: { messageId: 'q1', contextId: context.contextId, taskId: context.taskId, role: Role.ROLE_AGENT, parts: [{ content: { $case: 'text', value: 'Which policy?' }, mediaType: '', filename: '', metadata: undefined }], metadata: undefined, extensions: [], referenceTaskIds: [] } },
                }) as any));
                bus.finished();
                return;
            }
            const answer = context.task ? { decision: 'approve', policy: input.policy } : { decision: Number(input.amount) < 1000 ? 'approve' : 'refer', seen: input };
            bus.publish(AgentEvent.task(task(TaskState.TASK_STATE_COMPLETED, {
                artifacts: [{ artifactId: 'out', name: 'assessment', description: '', parts: [part(answer)], metadata: undefined, extensions: [] }],
            }) as any));
            bus.finished();
        },
        async cancelTask() { },
    };
    const app = express();
    app.use((_req, _res, next) => { reference_requests++; next(); });
    reference = await listen(app);
    card.supportedInterfaces = [{ url: `${reference.base}/a2a`, protocolBinding: 'JSONRPC', protocolVersion: '1.0', tenant: '' }];
    const handler = new DefaultRequestHandler(card, new InMemoryTaskStore(), executor as any);
    app.use('/.well-known/agent-card.json', agentCardHandler({ agentCardProvider: handler }));
    app.use('/a2a', express.json(), jsonRpcHandler({ requestHandler: handler, userBuilder: UserBuilder.noAuthentication }));
});
afterAll(() => { reference?.server.close(); });

describe('An agent built with the reference A2A SDK performs an activity', () => {
    const card = () => `${reference.base}/.well-known/agent-card.json`;

    it('sends the data, follows the task and takes the artifacts as output', async () => {
        const { status, engine, events } = await run(delegating(card()), { claim_id: 'C-1', amount: 400, _private: 'not sent' });
        expect(status).toBe('completed');
        expect(engine.getTokens()[0].contextData).toMatchObject({ decision: 'approve', seen: { claim_id: 'C-1', amount: 400 } });
        expect((engine.getTokens()[0].contextData.seen as Record<string, unknown>)._private).toBeUndefined();
        expect(events.find(e => e.type === 'agent.message_sent')!.data).toMatchObject({ agent: card(), link: `${reference.base}/a2a` });
        expect(events.find(e => e.type === 'agent.task_updated')!.data).toMatchObject({ state: 'TASK_STATE_COMPLETED' });
    });

    it('waits for the input the agent asks for and sends it on the same task', async () => {
        const { status, engine, events } = await run(delegating(card()), { claim_id: 'C-2', policy_needed: true });
        expect(status).toBe('waiting_human');
        const [request] = engine.getAgentRequests();
        expect(request.request).toMatchObject({ parts: [{ text: 'Which policy?' }] });
        expect(events.find(e => e.type === 'token.waiting')!.data).toMatchObject({ reason: 'agent_input', task_id: request.task_id });
        expect(await engine.answerAgent(request.token_id, { policy: 'P-9' })).toBe(true);
        expect(await engine.run()).toBe('completed');
        expect(engine.getTokens()[0].contextData).toMatchObject({ decision: 'approve', policy: 'P-9' });
        const after = await engine.getEvents();
        expect(after.filter(e => e.type === 'agent.message_sent').at(-1)!.data).toMatchObject({ task_id: request.task_id });
    });

    it('refuses an agent at a host the deployment does not allow, reaching nothing', async () => {
        const before = reference_requests;
        const { status, events } = await run(delegating(card()), { amount: 1 }, { a2a: { allowed_hosts: ['agents.example.com'] } });
        expect(status).toBe('failed');
        expect(events.find(e => e.type === 'activity.failed')!.data).toMatchObject({ error: { code: 'PERMISSION_DENIED' } });
        expect(reference_requests).toBe(before);
        // The tools' list of hosts applies to agents when the deployment gives them none of their own
        const tools = await run(delegating(card()), { amount: 1 }, { tools: { allowed_hosts: ['agents.example.com'] } });
        expect(tools.status).toBe('failed');
        expect(reference_requests).toBe(before);
    });

    it('calls nothing in simulation', async () => {
        const before = reference_requests;
        const { status, events, engine } = await run(delegating(card()), { amount: 1 }, { simulate: true, simulated_outputs: { Assess: { output: { decision: 'simulated' } } } });
        expect(status).toBe('completed');
        expect(engine.getTokens()[0].contextData).toMatchObject({ decision: 'simulated' });
        expect(events.find(e => e.type === 'agent.message_sent')!.data).toMatchObject({ simulated: true });
        expect(reference_requests).toBe(before);
    });
});

describe('The operational API gives an agent the input it asked for', () => {
    it('lists what agents ask and sends the answer on their task', async () => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'awa-a2a-'));
        fs.writeFileSync(path.join(dir, 'delegate.awa.json'), JSON.stringify(delegating(`${reference.base}/.well-known/agent-card.json`)));
        const previous = process.env.AWA_WORKFLOWS_DIR;
        process.env.AWA_WORKFLOWS_DIR = dir;
        const api = await listen(createServer({ request_logging: false }));
        try {
            const post = (url: string, body: unknown) => fetch(`${api.base}${url}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
            const { runId } = await (await post('/api/v1/workflows/run', { filePath: 'delegate.awa.json', input: { policy_needed: true } })).json() as { runId: string };
            let requests: any[] = [];
            for (let i = 0; i < 100 && requests.length === 0; i++) {
                await new Promise(r => setTimeout(r, 50));
                requests = await (await fetch(`${api.base}/api/v1/workflows/runs/${runId}/agent-requests`)).json() as any[];
            }
            expect(requests[0].request).toMatchObject({ parts: [{ text: 'Which policy?' }] });
            expect((await post(`/api/v1/workflows/runs/${runId}/tokens/nope/agent-input`, { input: 'P-1' })).status).toBe(409);
            expect((await post(`/api/v1/workflows/runs/${runId}/tokens/${requests[0].token_id}/agent-input`, { input: { policy: 'P-4' } })).status).toBe(200);
            let status = '';
            for (let i = 0; i < 100 && status !== 'completed'; i++) {
                await new Promise(r => setTimeout(r, 50));
                status = ((await (await fetch(`${api.base}/api/v1/workflows/runs/${runId}`)).json()) as { status: string }).status;
            }
            expect(status).toBe('completed');
        } finally {
            api.server.close();
            if (previous === undefined) delete process.env.AWA_WORKFLOWS_DIR; else process.env.AWA_WORKFLOWS_DIR = previous;
        }
    });
});

describe('A redirect is held to the allowed hosts', () => {
    it('refuses a card that redirects to a host not on the list', async () => {
        let reached = 0;
        const elsewhere = await listen((_req, res) => { reached++; res.end('{}'); });
        const redirecting = await listen((_req, res) => { res.writeHead(302, { location: `${elsewhere.base}/card.json` }); res.end(); });
        const { status, events } = await run(delegating(`${redirecting.base}/.well-known/agent-card.json`), {}, { a2a: { allowed_hosts: [`127.0.0.1:${redirecting.port}`] } });
        expect(status).toBe('failed');
        expect(events.find(e => e.type === 'activity.failed')!.data).toMatchObject({ error: { code: 'PERMISSION_DENIED' } });
        expect(reached).toBe(0);
        redirecting.server.close();
        elsewhere.server.close();
    });
});

describe('awa serve offers a workflow as an A2A agent', () => {
    let host: { server: http.Server; base: string; port: number };
    const triage = parse_document(JSON.parse(fs.readFileSync(TRIAGE, 'utf-8')));

    beforeAll(async () => {
        host = await listen(createServer({ request_logging: false, a2a: { workflows: [triage] } }));
    });
    afterAll(() => { host?.server.close(); });

    const rpc = async (method: string, params: unknown, headers: Record<string, string> = {}) => {
        const response = await fetch(`${host.base}/a2a/${triage.id}`, { method: 'POST', headers: { 'content-type': 'application/json', 'a2a-version': '1.0', ...headers }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) });
        return response.json() as Promise<{ result?: any; error?: { code: number; message: string } }>;
    };

    it('serves its card at the workflow\'s address and, being the only one, at the root', async () => {
        for (const url of [`${host.base}/a2a/${triage.id}/.well-known/agent-card.json`, `${host.base}/.well-known/agent-card.json`]) {
            const card = await (await fetch(url)).json();
            expect(card).toMatchObject({
                name: 'Claim triage', version: '1.2.0',
                supportedInterfaces: [{ url: `${host.base}/a2a/${triage.id}`, protocolBinding: 'JSONRPC', protocolVersion: '1.0' }],
                capabilities: { streaming: false, pushNotifications: false },
                skills: [{ id: triage.id }],
            });
        }
    });

    it('answers the reference SDK\'s client: a message runs the workflow, the task carries its output', async () => {
        const client = await new ClientFactory().createFromUrl(host.base);
        const result: any = await client.sendMessage({
            message: { messageId: 'm1', role: Role.ROLE_USER, parts: [part({ amount: 2500, claim: 'C-9' }) as any], contextId: '', taskId: '', metadata: undefined, extensions: [], referenceTaskIds: [] },
        } as any);
        const task = result.id ? result : result.task ?? result;
        expect(task.status.state).toBe(TaskState.TASK_STATE_COMPLETED);
        const output = task.artifacts[0].parts[0].content.value;
        expect(output).toMatchObject({ amount: 2500, claim: 'C-9', tier: 'large' });
        const again: any = await client.getTask({ id: task.id, tenant: '' } as any);
        expect(again.status.state).toBe(TaskState.TASK_STATE_COMPLETED);
    });

    it('is an agent this SDK\'s engine can delegate to', async () => {
        const { status, engine, events } = await run(delegating(`${host.base}/.well-known/agent-card.json`), { amount: 300 });
        expect(status).toBe('completed');
        expect(engine.getTokens()[0].contextData).toMatchObject({ tier: 'small', amount: 300 });
        expect(events.filter(e => e.type === 'agent.task_updated').map(e => e.data.state)).toEqual(['TASK_STATE_COMPLETED']);
    });

    it('answers with the errors A2A defines', async () => {
        expect((await rpc('GetTask', { id: 'nope' })).error?.code).toBe(-32001);
        expect((await rpc('SendStreamingMessage', {})).error?.code).toBe(-32004);
        expect((await rpc('Unknown', {})).error?.code).toBe(-32601);
        expect((await rpc('GetTask', { id: 'x' }, { 'a2a-version': '0.3' })).error?.code).toBe(-32009);
        const done = await rpc('SendMessage', { message: { messageId: 'm', role: 'ROLE_USER', parts: [{ data: { amount: 1 } }] } });
        expect(done.result.task.status.state).toBe('TASK_STATE_COMPLETED');
        expect((await rpc('CancelTask', { id: done.result.task.id })).error?.code).toBe(-32002);
        expect((await rpc('SendMessage', { message: { messageId: 'm2', role: 'ROLE_USER', taskId: done.result.task.id, parts: [{ text: 'more' }] } })).error?.code).toBe(-32004);
    });

    it('starts a run from text parts too, and can answer at once', async () => {
        const reply = await rpc('SendMessage', { message: { messageId: 'm3', role: 'ROLE_USER', contextId: 'ctx-7', parts: [{ text: 'hello' }, { data: { amount: 5 } }] }, configuration: { returnImmediately: true } });
        expect(reply.result.task.contextId).toBe('ctx-7');
        let task = reply.result.task;
        for (let i = 0; i < 50 && task.status.state !== 'TASK_STATE_COMPLETED'; i++) {
            await new Promise(r => setTimeout(r, 20));
            task = (await rpc('GetTask', { id: task.id })).result;
        }
        expect(task.artifacts[0].parts[0].data).toMatchObject({ text: 'hello', amount: 5, tier: 'small' });
    });
});

// --- across SDKs: this SDK's client against the Python SDK's host ---------------

// The Python SDK keeps its own database: it is given a fresh file, not the one these tests use
const PYTHON_ENV = { ...process.env, AWA_DATABASE_URL: path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'awa-py-')), 'awa.db') };
const python_ready = spawnSync('python3', ['-c', 'import awa.server, uvicorn'], { cwd: PYTHON_SDK, env: PYTHON_ENV }).status === 0;

describe.skipIf(!python_ready)('this SDK\'s client against the Python SDK\'s awa serve', () => {
    let child: ChildProcess;
    let base = '';

    beforeAll(async () => {
        const port = await new Promise<number>(resolve => { const s = http.createServer().listen(0, '127.0.0.1', () => { const p = (s.address() as AddressInfo).port; s.close(() => resolve(p)); }); });
        base = `http://127.0.0.1:${port}`;
        child = spawn('python3', ['-m', 'awa.cli', 'serve', '--host', '127.0.0.1', '--port', String(port), '--a2a', TRIAGE], { cwd: PYTHON_SDK, env: PYTHON_ENV, stdio: 'ignore' });
        for (let i = 0; i < 100; i++) {
            try { if ((await fetch(`${base}/.well-known/agent-card.json`)).ok) return; } catch { /* not up yet */ }
            await new Promise(r => setTimeout(r, 100));
        }
        throw new Error('the Python host did not start');
    }, 20000);
    afterAll(() => { child?.kill(); });

    it('delegates an activity to a workflow the Python SDK serves', async () => {
        const { status, engine, events } = await run(delegating(`${base}/.well-known/agent-card.json`), { amount: 4200, claim: 'C-3' });
        expect(status).toBe('completed');
        expect(engine.getTokens()[0].contextData).toMatchObject({ tier: 'large', claim: 'C-3' });
        expect(events.find(e => e.type === 'agent.message_sent')!.data.link).toMatch(/\/a2a\//);
    });
});
