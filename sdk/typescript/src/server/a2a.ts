/**
 * A workflow offered to other agents as an A2A agent (specification 28.8).
 *
 * Each workflow is served at `/a2a/<workflow id>`: its agent card at
 * `/a2a/<workflow id>/.well-known/agent-card.json`, and the A2A 1.0 JSON-RPC
 * methods SendMessage, GetTask and CancelTask at `/a2a/<workflow id>`. When one
 * workflow is offered, its card is also at `/.well-known/agent-card.json`.
 * A message starts a run; the task is the run.
 */

import { randomUUID } from 'crypto';
import { Request, Response, Router } from 'express';
import { Workflow } from '../types';
import { WorkflowEngine, WorkflowEngineOptions } from '../runtime/workflow_engine';
import { A2A_PROTOCOL_VERSION, A2APart, A2ATask, AgentCard, TASK_STATES } from '../runtime/protocols/a2a';

export interface A2AServeOptions {
    /** Options of the engines that perform the runs: the deployment's tools, agents, journal, model providers */
    engine?: () => Partial<WorkflowEngineOptions>;
    /** The address callers reach this host at, e.g. https://agents.example.com. Default: taken from each request. */
    public_url?: string;
    /** Whether the host requires authentication, which the card then declares */
    authenticated?: boolean;
    /** How many tasks are kept. Default 500; the oldest ended ones are forgotten first. */
    max_tasks?: number;
}

interface Served {
    engine: WorkflowEngine;
    workflow_id: string;
    context_id: string;
    running: Promise<unknown>;
}

const ERRORS = {
    parse: -32700, invalid_request: -32600, method_not_found: -32601, invalid_params: -32602, internal: -32603,
    task_not_found: -32001, task_not_cancelable: -32002, unsupported: -32004, version: -32009,
};
/** A2A methods this host does not offer: answered with UnsupportedOperation, not MethodNotFound */
const UNSUPPORTED = new Set(['SendStreamingMessage', 'SubscribeToTask', 'ListTasks', 'CreateTaskPushNotificationConfig', 'GetTaskPushNotificationConfig',
    'ListTaskPushNotificationConfigs', 'DeleteTaskPushNotificationConfig', 'GetExtendedAgentCard']);

/** The card of a workflow offered at `base` */
export function workflow_agent_card(workflow: Workflow, base: string, authenticated = false): AgentCard {
    return {
        name: workflow.name,
        description: workflow.description || `The AWA workflow "${workflow.name}"`,
        version: workflow.version,
        supportedInterfaces: [{ url: base, protocolBinding: 'JSONRPC', protocolVersion: A2A_PROTOCOL_VERSION }],
        capabilities: { streaming: false, pushNotifications: false },
        defaultInputModes: ['application/json', 'text/plain'],
        defaultOutputModes: ['application/json'],
        skills: [{ id: workflow.id, name: workflow.name, description: workflow.description || `Runs the workflow "${workflow.name}"`, tags: ['awa', 'workflow'] }],
        ...(authenticated ? {
            securitySchemes: {
                bearer: { httpAuthSecurityScheme: { scheme: 'Bearer', bearerFormat: 'JWT' } },
                apiKey: { apiKeySecurityScheme: { location: 'header', name: 'X-API-Key' } },
            },
            securityRequirements: [{ schemes: { bearer: { list: [] } } }, { schemes: { apiKey: { list: [] } } }],
        } : {}),
    };
}

/** The input of a run started by a message: its object data parts merged, its texts as `text` (28.8) */
export function message_input(parts: A2APart[]): Record<string, unknown> {
    const input: Record<string, unknown> = {};
    const texts: string[] = [];
    for (const part of parts || []) {
        if (part && typeof part.text === 'string') texts.push(part.text);
        else if (part && part.data !== null && typeof part.data === 'object' && !Array.isArray(part.data)) Object.assign(input, part.data);
    }
    if (texts.length > 0) input.text = texts.join('\n');
    return input;
}

/** What the engine keeps in a token's data for itself: the archive of each activity's output and of each decision */
const RESERVED = new Set(['activities', 'decisions']);

/** What a run produced: the data of its completed tokens merged, without what the engine keeps for itself */
export function run_output(engine: WorkflowEngine): Record<string, unknown> {
    const output: Record<string, unknown> = {};
    for (const token of engine.getTokens().filter(t => t.status === 'completed')) {
        for (const [key, value] of Object.entries(token.contextData)) if (!key.startsWith('_') && !RESERVED.has(key)) output[key] = value;
    }
    return output;
}

function task_of(id: string, served: Served): A2ATask {
    const status = served.engine.getStatus();
    const timestamp = new Date().toISOString();
    const base = { id, contextId: served.context_id };
    if (status === 'completed') {
        return { ...base, status: { state: TASK_STATES.COMPLETED, timestamp }, artifacts: [{ artifactId: `${id}-output`, name: 'output', parts: [{ data: run_output(served.engine), mediaType: 'application/json' }] }] };
    }
    if (status === 'failed') {
        const errors = served.engine.getTokens().filter(t => t.status === 'failed').map(t => String(t.getData('_error') || 'failed'));
        return { ...base, status: { state: TASK_STATES.FAILED, timestamp, message: { messageId: randomUUID(), role: 'ROLE_AGENT', parts: [{ text: errors.join('\n') || 'The run failed' }], contextId: served.context_id, taskId: id } } };
    }
    if (status === 'cancelled') return { ...base, status: { state: TASK_STATES.CANCELED, timestamp } };
    if (status === 'idle') return { ...base, status: { state: TASK_STATES.SUBMITTED, timestamp } };
    // running, waiting for a person or for an event: what the run waits for is the host's to handle
    return { ...base, status: { state: TASK_STATES.WORKING, timestamp } };
}

const ENDED = new Set(['completed', 'failed', 'cancelled']);

/**
 * Routes that offer workflows as A2A agents. `cards` needs no authentication and is mounted
 * before the host's authentication; `rpc` is mounted after it.
 */
export function a2a_routes(workflows: Workflow[], options: A2AServeOptions = {}): { cards: Router; rpc: Router } {
    const by_id = new Map(workflows.map(w => [w.id, w]));
    const tasks = new Map<string, Served>();
    const max_tasks = options.max_tasks ?? 500;
    const base_of = (req: Request, id: string) => `${(options.public_url || `${req.protocol}://${req.get('host')}`).replace(/\/+$/, '')}/a2a/${id}`;

    const cards = Router();
    const send_card = (req: Request, res: Response, workflow: Workflow | undefined) => {
        if (!workflow) return res.status(404).json({ error: 'No such agent' });
        res.json(workflow_agent_card(workflow, base_of(req, workflow.id), options.authenticated));
    };
    cards.get('/a2a/:id/.well-known/agent-card.json', (req, res) => send_card(req, res, by_id.get(String(req.params.id))));
    if (workflows.length === 1) cards.get('/.well-known/agent-card.json', (req, res) => send_card(req, res, workflows[0]));

    const keep = (id: string, served: Served) => {
        tasks.set(id, served);
        if (tasks.size <= max_tasks) return;
        for (const [old, entry] of tasks) {
            if (ENDED.has(entry.engine.getStatus())) { tasks.delete(old); if (tasks.size <= max_tasks) return; }
        }
    };

    const rpc = Router();
    rpc.post('/a2a/:id', async (req, res) => {
        const body = req.body;
        const reply = (result: unknown) => res.json({ jsonrpc: '2.0', id: body?.id ?? null, result });
        const fail = (code: number, message: string) => res.json({ jsonrpc: '2.0', id: body?.id ?? null, error: { code, message } });
        const workflow = by_id.get(String(req.params.id));
        if (!workflow) return res.status(404).json({ jsonrpc: '2.0', id: body?.id ?? null, error: { code: ERRORS.method_not_found, message: 'No such agent' } });
        if (!body || body.jsonrpc !== '2.0' || typeof body.method !== 'string') return fail(ERRORS.invalid_request, 'Not a JSON-RPC 2.0 request');
        const version = req.get('a2a-version');
        if (version && !/^1(\.|$)/.test(version)) return fail(ERRORS.version, `A2A version ${version} is not supported; this agent speaks ${A2A_PROTOCOL_VERSION}`);
        const params = body.params || {};

        try {
            switch (body.method) {
                case 'SendMessage': {
                    const message = params.message;
                    if (!message || !Array.isArray(message.parts)) return fail(ERRORS.invalid_params, 'SendMessage needs a message with parts');
                    // A run takes no further input over A2A once started
                    if (message.taskId) return fail(ERRORS.unsupported, 'A task of this agent takes no further messages: each message starts a new run');
                    const engine = new WorkflowEngine(workflow, { ...(options.engine?.() || {}) });
                    await engine.start(message_input(message.parts));
                    const id = engine.getRunId();
                    const served: Served = { engine, workflow_id: workflow.id, context_id: typeof message.contextId === 'string' && message.contextId ? message.contextId : randomUUID(), running: Promise.resolve() };
                    served.running = engine.run().catch(error => console.error(`Run ${id} failed:`, error));
                    keep(id, served);
                    if (!params.configuration?.returnImmediately) await served.running;
                    return reply({ task: task_of(id, served) });
                }
                case 'GetTask': {
                    const served = tasks.get(String(params.id));
                    if (!served || served.workflow_id !== workflow.id) return fail(ERRORS.task_not_found, `Task ${params.id} was not found`);
                    return reply(task_of(String(params.id), served));
                }
                case 'CancelTask': {
                    const served = tasks.get(String(params.id));
                    if (!served || served.workflow_id !== workflow.id) return fail(ERRORS.task_not_found, `Task ${params.id} was not found`);
                    if (ENDED.has(served.engine.getStatus())) return fail(ERRORS.task_not_cancelable, `Task ${params.id} has ended`);
                    await served.engine.cancel('Cancelled by the caller over A2A');
                    return reply(task_of(String(params.id), served));
                }
                default:
                    if (UNSUPPORTED.has(body.method)) return fail(ERRORS.unsupported, `${body.method} is not supported by this agent`);
                    return fail(ERRORS.method_not_found, `Unknown method ${body.method}`);
            }
        } catch (error) {
            return fail(ERRORS.internal, error instanceof Error ? error.message : String(error));
        }
    });
    return { cards, rpc };
}
