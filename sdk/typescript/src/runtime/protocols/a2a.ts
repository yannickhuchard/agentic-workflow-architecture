/**
 * Agents over A2A (specification section 28): the client side.
 *
 * An activity whose role, or which itself, names an agent by its agent card
 * is performed by that agent over the Agent2Agent protocol, version 1.0, on
 * its JSON-RPC binding. The engine sends the activity's inputs as a message,
 * follows the task the agent opens until it ends, and turns the reply into
 * the activity's output, which is then checked as any actor's is. Every
 * exchange is journalled. Nothing is called in simulation.
 *
 * The client is written here, with no dependency.
 */

import { randomUUID } from 'crypto';
import { A2AAgent, Activity, Role } from '../../types';
import { Actor, ActorContext } from '../actors/actor';
import { ToolError, check_host, web_url, with_secrets } from './errors';
import { bounded_fetch } from '../tools';

/** The A2A specification version this engine implements */
export const A2A_PROTOCOL_VERSION = '1.0';

export const TASK_STATES = {
    SUBMITTED: 'TASK_STATE_SUBMITTED',
    WORKING: 'TASK_STATE_WORKING',
    COMPLETED: 'TASK_STATE_COMPLETED',
    FAILED: 'TASK_STATE_FAILED',
    CANCELED: 'TASK_STATE_CANCELED',
    INPUT_REQUIRED: 'TASK_STATE_INPUT_REQUIRED',
    REJECTED: 'TASK_STATE_REJECTED',
    AUTH_REQUIRED: 'TASK_STATE_AUTH_REQUIRED',
} as const;

export interface A2APart { text?: string; data?: unknown; url?: string; raw?: string; mediaType?: string; filename?: string; metadata?: Record<string, unknown> }
export interface A2AMessage { messageId: string; role: string; parts: A2APart[]; contextId?: string; taskId?: string; metadata?: Record<string, unknown> }
export interface A2AArtifact { artifactId?: string; name?: string; description?: string; parts: A2APart[]; metadata?: Record<string, unknown> }
export interface A2ATask { id: string; contextId?: string; status: { state: string; message?: A2AMessage; timestamp?: string }; artifacts?: A2AArtifact[]; history?: A2AMessage[]; metadata?: Record<string, unknown> }
export interface AgentCard {
    name: string; description?: string; version?: string;
    supportedInterfaces?: { url: string; protocolBinding: string; protocolVersion?: string; tenant?: string }[];
    capabilities?: { streaming?: boolean; pushNotifications?: boolean };
    defaultInputModes?: string[]; defaultOutputModes?: string[];
    skills?: { id: string; name: string; description?: string; tags?: string[] }[];
    [key: string]: unknown;
}

export interface A2AHttpRequest { method: 'GET' | 'POST'; url: string; headers: Record<string, string>; body?: string }
export interface A2AHttpResponse { status: number; body: string }
/** How requests reach an agent. The default uses HTTP; a test or a conformance runner may stand in for the agent. */
export type A2ATransport = (request: A2AHttpRequest, signal?: AbortSignal) => Promise<A2AHttpResponse>;

export interface A2AOptions {
    /** Hosts agents may be reached at, redirects included. Default: the tools' allowed_hosts (17.4); absent, any. */
    allowed_hosts?: string[];
    /** Values for {{secret:NAME}} in a binding's headers. Default: the tools' secrets. */
    secrets?: Record<string, string>;
    /** How often a task that is still working is asked about. Default 1000 ms. */
    poll_interval_ms?: number;
    /** The longest the engine follows a task before it cancels it and the attempt fails with TIMEOUT. Default 10 minutes. */
    max_wait_ms?: number;
    /** The most a reply may hold, in bytes. Default 4 MiB. */
    max_output_bytes?: number;
    /** Replaces HTTP. The deployment's permissions are applied before it is called. */
    transport?: A2ATransport;
}

/** The agent that performs an activity: the activity's own binding, else its role's (28.1) */
export function a2a_binding(activity: Activity, role?: Role): A2AAgent | undefined {
    return activity.a2a || role?.a2a;
}

/** What the engine and the actor share for one run: the cards already read */
export interface A2ARunState {
    cards: Map<string, { card: AgentCard; url: string }>;
}

const default_transport = (options: A2AOptions, allowed: string[] | undefined): A2ATransport => async (request, signal) => {
    const response = await bounded_fetch(request.url, { method: request.method, headers: request.headers, body: request.body },
        { signal: signal || new AbortController().signal, allowed_hosts: allowed, max_output_bytes: options.max_output_bytes });
    return { status: response.status, body: response.text };
};

/** The value of an artifact (28.5) */
function artifact_value(parts: A2APart[]): unknown {
    if (parts.length === 1 && parts[0] && 'data' in parts[0]) return parts[0].data;
    if (parts.length > 0 && parts.every(p => typeof p?.text === 'string')) return parts.map(p => p.text).join('\n');
    return parts;
}

/** The output built from a reply's artifacts, in order (28.5) */
export function a2a_output(artifacts: { name?: string; parts?: A2APart[] }[]): Record<string, unknown> {
    const output: Record<string, unknown> = {};
    for (const artifact of artifacts) {
        const value = artifact_value(artifact.parts || []);
        if (value !== null && typeof value === 'object' && !Array.isArray(value)) Object.assign(output, value);
        else output[artifact.name || 'result'] = value;
    }
    return output;
}

function text_of(message?: A2AMessage): string {
    return (message?.parts || []).filter(p => typeof p.text === 'string').map(p => p.text).join('\n');
}

const FAILURES: Record<string, string> = {
    [TASK_STATES.FAILED]: 'AGENT_FAILED',
    [TASK_STATES.REJECTED]: 'AGENT_REJECTED',
    [TASK_STATES.CANCELED]: 'AGENT_CANCELED',
    [TASK_STATES.AUTH_REQUIRED]: 'AGENT_AUTH_REQUIRED',
};
const FOLLOWED = new Set<string>([TASK_STATES.SUBMITTED, TASK_STATES.WORKING, 'TASK_STATE_UNSPECIFIED']);

/**
 * The actor of an activity performed by a remote agent. One instance serves
 * the attempts of one visit to the activity, so that every message after the
 * first is sent in the context the agent answered with.
 */
export class A2AActor implements Actor {
    private context_id?: string;
    private continued = false;

    constructor(
        private binding: A2AAgent,
        private options: A2AOptions,
        private state: A2ARunState,
        private settings: { simulate: boolean; scripted?: Actor; tools_allowed_hosts?: string[]; tools_secrets?: Record<string, string> },
    ) { }

    private get allowed(): string[] | undefined {
        return this.options.allowed_hosts ?? this.settings.tools_allowed_hosts;
    }

    async execute(activity: Activity, inputs: Record<string, unknown>, context: ActorContext = {}): Promise<Record<string, unknown>> {
        const record = context.record || (() => { });
        const payload = context.payload || ((value: unknown) => value);
        const agent = this.binding.agent_card;
        const continuation = inputs._agent_continuation as { task_id: string; context_id?: string; input: unknown } | undefined;
        // The input a host gave for a task that asked for it is sent once, on that task (28.6)
        const used_continuation = !!continuation && !this.continued;
        this.continued = true;
        const message: A2AMessage = {
            messageId: randomUUID(),
            role: 'ROLE_USER',
            parts: used_continuation ? input_parts(continuation!.input) : this.parts(activity, inputs),
            ...(used_continuation ? { taskId: continuation!.task_id } : {}),
            ...((used_continuation ? continuation!.context_id : this.context_id) ? { contextId: used_continuation ? continuation!.context_id : this.context_id } : {}),
            metadata: {
                awa: {
                    run_id: inputs._run_id, activity_id: activity.id, activity: activity.name, attempt: inputs._attempt,
                    idempotency_key: inputs._idempotency_key, ...(this.binding.skill ? { skill: this.binding.skill } : {}),
                },
            },
        };
        const sent = (link: string, simulated?: boolean) => record({
            type: 'agent.message_sent',
            data: {
                agent, link, message_id: message.messageId,
                ...(message.contextId ? { context_id: message.contextId } : {}),
                ...(message.taskId ? { task_id: message.taskId } : {}),
                parts: payload(message.parts),
                ...(simulated ? { simulated: true } : {}),
            },
        });

        // In simulation nothing is called (28.7)
        if (this.settings.simulate) {
            sent(agent, true);
            return this.settings.scripted ? this.settings.scripted.execute(activity, inputs, context) : { _simulated: true };
        }

        const secrets = this.options.secrets || this.settings.tools_secrets || {};
        const headers: Record<string, string> = { 'a2a-version': A2A_PROTOCOL_VERSION, accept: 'application/json' };
        for (const [name, value] of Object.entries(this.binding.headers || {})) headers[name.toLowerCase()] = with_secrets(value, secrets);
        const transport = this.options.transport || default_transport(this.options, this.allowed);

        const { url } = await this.card(transport, headers);
        let rpc_id = 0;
        const call = async (method: string, params: unknown): Promise<any> => {
            check_host(web_url(url).host, this.allowed, 'requests');
            let response: A2AHttpResponse;
            try {
                response = await transport({ method: 'POST', url, headers: { ...headers, 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: `${message.messageId}-${++rpc_id}`, method, params }) });
            } catch (error) {
                if (error instanceof ToolError) throw agent_error(error);
                throw new ToolError(`Agent ${agent} could not be reached: ${(error as Error).message}`, 'AGENT_ERROR');
            }
            let body: { result?: unknown; error?: { code?: number; message?: string } };
            try { body = JSON.parse(response.body); } catch { throw new ToolError(`Agent ${agent} answered ${method} with HTTP ${response.status} and no JSON-RPC reply`, 'AGENT_ERROR', { status: response.status }); }
            if (body?.error) throw new ToolError(`Agent ${agent} answered ${method} with error ${body.error.code}: ${body.error.message}`, 'AGENT_ERROR', { status: body.error.code });
            if (response.status < 200 || response.status >= 300) throw new ToolError(`Agent ${agent} answered ${method} with HTTP ${response.status}`, 'AGENT_ERROR', { status: response.status });
            if (body?.result === undefined || body.result === null || typeof body.result !== 'object') throw new ToolError(`Agent ${agent} answered ${method} without a result`, 'AGENT_ERROR');
            return body.result;
        };

        const started = Date.now();
        sent(url);
        const reply = await call('SendMessage', { message });
        let last_state: string | undefined;
        const updated = (data: Record<string, unknown>) => record({ type: 'agent.task_updated', data: { agent, ...data, duration_ms: Date.now() - started } });

        // A message is the agent's reply
        const reply_message: A2AMessage | undefined = reply.message || (reply.messageId && reply.parts ? reply : undefined);
        if (reply_message) {
            if (reply_message.contextId) this.context_id = reply_message.contextId;
            updated({ state: 'message', ...(reply_message.contextId ? { context_id: reply_message.contextId } : {}), reply: payload(reply_message.parts || []) });
            return a2a_output([{ parts: reply_message.parts || [] }]);
        }
        let task: A2ATask | undefined = reply.task || (reply.id && reply.status ? reply : undefined);
        if (!task || typeof task.id !== 'string' || !task.status) throw new ToolError(`Agent ${agent} answered SendMessage with neither a task nor a message`, 'AGENT_ERROR');

        // The task is followed until its state is neither submitted nor working (28.4)
        const interval = this.options.poll_interval_ms ?? 1000;
        const max_wait = this.options.max_wait_ms ?? 600000;
        for (; ;) {
            if (task.contextId) this.context_id = task.contextId;
            const state = String(task.status?.state || 'TASK_STATE_UNSPECIFIED');
            const ends = !FOLLOWED.has(state);
            if (state !== last_state) {
                last_state = state;
                updated({
                    task_id: task.id, ...(task.contextId ? { context_id: task.contextId } : {}), state,
                    ...(ends ? { reply: payload(state === TASK_STATES.COMPLETED ? (task.artifacts || []) : (task.status.message ? task.status.message.parts : [])) } : {}),
                });
            }
            if (ends) break;
            if (Date.now() - started >= max_wait) {
                await call('CancelTask', { id: task.id }).catch(() => undefined);
                throw new ToolError(`Agent ${agent} did not finish task ${task.id} within ${max_wait} ms`, 'TIMEOUT');
            }
            if (interval > 0) await new Promise(resolve => setTimeout(resolve, interval));
            const next = await call('GetTask', { id: task.id });
            task = next.task || next;
            if (!task || typeof task.id !== 'string' || !task.status) throw new ToolError(`Agent ${agent} answered GetTask without a task`, 'AGENT_ERROR');
        }

        const state = task.status.state;
        if (state === TASK_STATES.COMPLETED) {
            const artifacts = task.artifacts && task.artifacts.length > 0 ? task.artifacts : (task.status.message ? [{ parts: task.status.message.parts || [] }] : []);
            return a2a_output(artifacts);
        }
        if (state === TASK_STATES.INPUT_REQUIRED) {
            if (this.binding.on_input_required === 'fail') {
                throw new ToolError(`Agent ${agent} asks for input${text_of(task.status.message) ? `: ${text_of(task.status.message)}` : ''}`, 'AGENT_INPUT_REQUIRED');
            }
            // The token waits for the host to give the input (28.6)
            return { _awaiting_agent_input: { agent, task_id: task.id, context_id: task.contextId, request: task.status.message || null } };
        }
        const code = FAILURES[state] || 'AGENT_ERROR';
        throw new ToolError(text_of(task.status.message) || `Agent ${agent} ended task ${task.id} in state ${state}`, code);
    }

    /** The parts of the first message of an attempt (28.3) */
    private parts(activity: Activity, inputs: Record<string, unknown>): A2APart[] {
        const feedback = inputs._verification_feedback;
        const text = [activity.name, activity.description, activity.procedure,
            feedback === undefined ? undefined : typeof feedback === 'string' ? feedback : JSON.stringify(feedback)]
            .filter(t => typeof t === 'string' && t.length > 0).join('\n\n');
        const data = Object.fromEntries(Object.entries(inputs).filter(([key]) => !key.startsWith('_')));
        const parts: A2APart[] = [{ text }, { data, mediaType: 'application/json' }];
        if (inputs._contexts && typeof inputs._contexts === 'object') parts.push({ data: inputs._contexts, mediaType: 'application/json', metadata: { awa: 'contexts' } });
        return parts;
    }

    /** The card, read once per run, and the JSON-RPC interface it offers (28.2) */
    private async card(transport: A2ATransport, headers: Record<string, string>): Promise<{ card: AgentCard; url: string }> {
        const address = this.binding.agent_card;
        const known = this.state.cards.get(address);
        if (known) return known;
        check_host(web_url(address).host, this.allowed, 'requests');
        let response: A2AHttpResponse;
        try {
            response = await transport({ method: 'GET', url: address, headers });
        } catch (error) {
            if (error instanceof ToolError) throw agent_error(error);
            throw new ToolError(`The card of agent ${address} could not be read: ${(error as Error).message}`, 'AGENT_ERROR');
        }
        if (response.status < 200 || response.status >= 300) throw new ToolError(`The card of agent ${address} could not be read: HTTP ${response.status}`, 'AGENT_ERROR', { status: response.status });
        let card: AgentCard;
        try { card = JSON.parse(response.body); } catch { throw new ToolError(`The card of agent ${address} is not JSON`, 'AGENT_ERROR'); }
        const entry = (card?.supportedInterfaces || []).find(i => i?.protocolBinding === 'JSONRPC' && (!i.protocolVersion || /^1(\.|$)/.test(String(i.protocolVersion))));
        if (!entry || typeof entry.url !== 'string') {
            throw new ToolError(`Agent ${address} offers no JSON-RPC interface of A2A ${A2A_PROTOCOL_VERSION}`, 'AGENT_UNSUPPORTED');
        }
        const url = new URL(entry.url, address).toString();
        check_host(web_url(url).host, this.allowed, 'requests');
        const known_card = { card, url };
        this.state.cards.set(address, known_card);
        return known_card;
    }
}

/** A refusal keeps its code; any other transport failure is the agent's */
function agent_error(error: ToolError): ToolError {
    if (error.code === 'PERMISSION_DENIED' || error.code === 'VALIDATION_ERROR') return error;
    return new ToolError(error.message, 'AGENT_ERROR', { status: (error as { status?: unknown }).status });
}

/** The input a host gives an agent that asked for it: an object as data, anything else as text (28.6) */
function input_parts(input: unknown): A2APart[] {
    if (input !== null && typeof input === 'object' && !Array.isArray(input)) return [{ data: input, mediaType: 'application/json' }];
    return [{ text: typeof input === 'string' ? input : JSON.stringify(input) }];
}
