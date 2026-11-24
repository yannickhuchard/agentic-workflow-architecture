/**
 * AWA Telemetry (specification section 26)
 *
 * The journal and the journey record projected onto OpenTelemetry traces.
 * Everything here is a pure function of the record: the same events give the
 * same trace and span identifiers, names, times, attributes and links in every
 * implementation, whether the spans are sent while a run proceeds or exported
 * from its journal afterwards.
 *
 * Encoding follows OTLP (opentelemetry-proto 1.9.0), written by hand so that
 * the SDK needs no OpenTelemetry package and so that the bytes do not depend
 * on one. Attribute names follow the generative AI semantic conventions as
 * published in @opentelemetry/semantic-conventions 1.45.0.
 */

import { createHash } from 'crypto';
import { JOURNAL_SPEC_VERSION, JournalEvent, canonical_json } from './journal';
import type { JourneyEvent } from './journey';

/** The versions this mapping follows (spec 26) */
export const TELEMETRY_CONVENTIONS = {
    otlp: '1.9.0',
    semantic_conventions: '1.45.0',
} as const;

/**
 * The semantic convention attribute names used, copied from
 * @opentelemetry/semantic-conventions 1.45.0 as that package recommends for
 * incubating names. A test checks them against the package.
 */
export const GEN_AI = {
    OPERATION_NAME: 'gen_ai.operation.name',
    PROVIDER_NAME: 'gen_ai.provider.name',
    REQUEST_MODEL: 'gen_ai.request.model',
    RESPONSE_MODEL: 'gen_ai.response.model',
    REQUEST_TEMPERATURE: 'gen_ai.request.temperature',
    USAGE_INPUT_TOKENS: 'gen_ai.usage.input_tokens',
    USAGE_OUTPUT_TOKENS: 'gen_ai.usage.output_tokens',
    TOOL_NAME: 'gen_ai.tool.name',
    TOOL_CALL_ID: 'gen_ai.tool.call.id',
    TOOL_CALL_ARGUMENTS: 'gen_ai.tool.call.arguments',
    TOOL_CALL_RESULT: 'gen_ai.tool.call.result',
    AGENT_NAME: 'gen_ai.agent.name',
    AGENT_ID: 'gen_ai.agent.id',
    WORKFLOW_NAME: 'gen_ai.workflow.name',
    ERROR_TYPE: 'error.type',
    SERVICE_NAME: 'service.name',
} as const;

/** Values of gen_ai.operation.name used */
export const GEN_AI_OPERATIONS = {
    INVOKE_WORKFLOW: 'invoke_workflow',
    INVOKE_AGENT: 'invoke_agent',
    EXECUTE_TOOL: 'execute_tool',
    CHAT: 'chat',
} as const;

/** AWA provider ids (12.4) whose value in the conventions differs */
const PROVIDER_NAMES: Record<string, string> = { google: 'gcp.gemini' };

/** An attribute value. A number with no fractional part is an integer attribute; any other is a double. */
export type TelemetryValue = string | number | boolean | TelemetryValue[];
export type TelemetryAttributes = Record<string, TelemetryValue>;

export type SpanKind = 'internal' | 'client';
export type SpanStatusCode = 'unset' | 'ok' | 'error';

export interface TelemetrySpanEvent {
    name: string;
    /** Milliseconds since the Unix epoch */
    time_ms: number;
    attributes: TelemetryAttributes;
}

export interface TelemetryLink {
    trace_id: string;
    span_id: string;
    attributes?: TelemetryAttributes;
}

/** One span, ready to encode. Times are milliseconds since the Unix epoch (26.2). */
export interface TelemetrySpan {
    trace_id: string;
    span_id: string;
    parent_span_id?: string;
    name: string;
    kind: SpanKind;
    start_ms: number;
    end_ms: number;
    attributes: TelemetryAttributes;
    events: TelemetrySpanEvent[];
    links: TelemetryLink[];
    status: { code: SpanStatusCode; message?: string };
}

export interface TraceOptions {
    /** The deployment opts in to payloads on spans (26.6). Default false. */
    payloads?: boolean;
}

/** What a run's mapping needs to know about the workflow: which nodes are decision nodes */
export interface TraceWorkflow {
    decision_nodes?: { id: string }[];
}

// ---------------------------------------------------------------------------
// Identifiers (26.1)
// ---------------------------------------------------------------------------

function digest(text: string, bytes: number): string {
    const raw = createHash('sha256').update(text, 'utf8').digest().subarray(0, bytes);
    if (raw.every(b => b === 0)) raw[bytes - 1] = 1;
    return Buffer.from(raw).toString('hex');
}

export function run_trace_id(run_id: string): string {
    return digest(`awa:run:${run_id}`, 16);
}

export function run_span_id(run_id: string, seq: number): string {
    return digest(`awa:run:${run_id}:${seq}`, 8);
}

export function journey_trace_id(instance_id: string): string {
    return digest(`awa:journey:${instance_id}`, 16);
}

export function journey_span_id(instance_id: string, seq: number): string {
    return digest(`awa:journey:${instance_id}:${seq}`, 8);
}

/** Milliseconds since the epoch of an RFC 3339 time; finer precision is discarded (26.2) */
export function time_ms(time: string): number {
    const ms = Date.parse(time);
    if (!Number.isFinite(ms)) throw new Error(`Not an RFC 3339 time: "${time}"`);
    return ms;
}

// ---------------------------------------------------------------------------
// Attribute values (26.3)
// ---------------------------------------------------------------------------

/** An attribute value from a record value: strings, numbers and booleans as they are, anything else as canonical JSON */
export function attribute_value(value: unknown): TelemetryValue | undefined {
    if (value === null || value === undefined) return undefined;
    if (typeof value === 'string' || typeof value === 'boolean') return value;
    if (typeof value === 'number') return Number.isFinite(value) ? value : String(value);
    return canonical_json(value);
}

function put(attributes: TelemetryAttributes, key: string, value: unknown): void {
    const v = attribute_value(value);
    if (v !== undefined) attributes[key] = v;
}

/** Payload properties of span events (26.6) */
const PAYLOAD_PROPERTIES = new Set(['input', 'inputs', 'output', 'arguments', 'result', 'rejected_output', 'data', 'correlation_value', 'subject_key']);

function data_attributes(attributes: TelemetryAttributes, data: Record<string, unknown> | undefined, payloads: boolean): void {
    for (const [key, value] of Object.entries(data || {})) {
        if (!payloads && PAYLOAD_PROPERTIES.has(key)) continue;
        put(attributes, `awa.data.${key}`, value);
    }
}

const record_of = (value: unknown): Record<string, unknown> =>
    value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};

function error_of(data: Record<string, unknown>): { message?: string; code?: string } {
    const error = data.error;
    if (typeof error === 'string') return { message: error };
    const e = record_of(error);
    return { message: typeof e.message === 'string' ? e.message : undefined, code: typeof e.code === 'string' ? e.code : undefined };
}

// ---------------------------------------------------------------------------
// A run's trace (26.2 to 26.6)
// ---------------------------------------------------------------------------

type OpenKind = 'run' | 'attempt' | 'tool' | 'decision' | 'wait';

interface OpenSpan {
    kind: OpenKind;
    span: TelemetrySpan;
    token?: string;
    node?: string;
    attempt?: number;
    call_id?: string;
    wait?: 'human' | 'event' | 'timer';
    /** Model calls recorded under this attempt or decision, sent when it ends (26.5) */
    models: { span: TelemetrySpan }[];
}

const WAIT_END: Record<string, { kind: 'human' | 'event' | 'timer'; outcome: string; status: SpanStatusCode }> = {
    'token.resumed': { kind: 'human', outcome: 'resumed', status: 'ok' },
    'event.received': { kind: 'event', outcome: 'received', status: 'ok' },
    'event.timed_out': { kind: 'event', outcome: 'timed_out', status: 'unset' },
    'timer.fired': { kind: 'timer', outcome: 'fired', status: 'ok' },
};
const WAIT_START: Record<string, 'human' | 'event' | 'timer'> = { 'token.waiting': 'human', 'event.waiting': 'event', 'timer.started': 'timer' };

/**
 * Turns the events of one run's journal into spans, one event at a time. push()
 * returns the spans that the event ends; finish() ends what is still open, as an
 * export of an unfinished record does (26.8). A live exporter and a recorded
 * export use the same mapper, so they give the same spans.
 */
export class RunTraceMapper {
    private open: OpenSpan[] = [];
    private run?: OpenSpan;
    private run_id?: string;
    private trace_id?: string;
    private last_ms?: number;
    private decision_nodes: Set<string>;
    private payloads: boolean;
    private ended = false;

    constructor(workflow: TraceWorkflow, options: TraceOptions = {}) {
        this.decision_nodes = new Set((workflow.decision_nodes || []).map(d => d.id));
        this.payloads = options.payloads === true;
    }

    /** The spans this event ends, innermost first */
    push(event: JournalEvent): TelemetrySpan[] {
        const out: TelemetrySpan[] = [];
        if (!this.run_id) {
            this.run_id = event.run_id;
            this.trace_id = run_trace_id(event.run_id);
        }
        const at = time_ms(event.time);
        this.last_ms = at;
        const data = record_of(event.data);

        switch (event.type) {
            case 'run.started':
                if (this.run || this.ended) break;
                this.run = this.start('run', event, `${GEN_AI_OPERATIONS.INVOKE_WORKFLOW} ${typeof data.workflow_name === 'string' ? data.workflow_name : event.workflow_id}`, 'internal', undefined);
                this.run_attributes(this.run.span.attributes, event, data);
                return out;
            case 'run.completed': case 'run.failed': case 'run.cancelled': {
                if (!this.run) break;
                while (this.open.length) this.finish_span(this.open[this.open.length - 1], at, { code: 'unset' }, {}, out);
                const status = event.type.slice(4);
                const attributes = this.run.span.attributes;
                put(attributes, 'awa.run.status', status);
                put(attributes, 'awa.run.steps', data.steps);
                put(attributes, 'awa.run.input_tokens', data.input_tokens);
                put(attributes, 'awa.run.output_tokens', data.output_tokens);
                put(attributes, 'awa.run.cost', data.cost);
                put(attributes, 'awa.run.currency', data.currency);
                if (event.type === 'run.cancelled') put(attributes, 'awa.run.cancel_reason', data.reason);
                const first = Array.isArray(data.errors) ? record_of(data.errors[0]) : {};
                const code: SpanStatusCode = event.type === 'run.completed' ? 'ok' : event.type === 'run.failed' ? 'error' : 'unset';
                this.end(this.run, at, code === 'error' ? { code, message: typeof first.message === 'string' ? first.message : 'run failed' } : { code }, out);
                this.run = undefined;
                this.ended = true;
                return out;
            }
            case 'activity.started': {
                if (!this.run) break;
                const ai = data.actor_type === 'ai_agent';
                const name = `${ai ? GEN_AI_OPERATIONS.INVOKE_AGENT : 'activity'} ${event.node_name || event.node_id}`;
                const span = this.start('attempt', event, name, 'internal', this.run.span.span_id);
                const a = span.span.attributes;
                put(a, 'awa.actor.type', data.actor_type);
                put(a, 'awa.role.id', data.role_id);
                if (ai) {
                    a[GEN_AI.OPERATION_NAME] = GEN_AI_OPERATIONS.INVOKE_AGENT;
                    put(a, GEN_AI.AGENT_NAME, event.node_name);
                    put(a, GEN_AI.AGENT_ID, event.node_id);
                }
                if (this.payloads) put(a, 'awa.input', data.input);
                this.open.push(span);
                return out;
            }
            case 'activity.completed': case 'activity.failed': {
                const span = this.find(s => s.kind === 'attempt' && s.token === event.token_id && s.node === event.node_id
                    && (event.attempt === undefined || s.attempt === event.attempt));
                if (!span) break;
                const extra: TelemetryAttributes = {};
                if (event.type === 'activity.completed') {
                    if (this.payloads) put(extra, 'awa.output', data.output);
                    const usage = record_of(data.usage);
                    this.finish_span(span, at, { code: 'ok' }, extra, out, usage);
                } else {
                    const error = error_of(data);
                    extra[GEN_AI.ERROR_TYPE] = error.code || '_OTHER';
                    put(extra, 'awa.error.retryable', data.retryable);
                    this.finish_span(span, at, { code: 'error', ...(error.message !== undefined ? { message: error.message } : {}) }, extra, out);
                }
                return out;
            }
            case 'tool.invoked': {
                if (!this.run) break;
                this.open.push(this.tool_span(event, data));
                return out;
            }
            case 'tool.completed': case 'tool.failed': {
                let span = this.find(s => s.kind === 'tool' && s.call_id === data.call_id);
                if (!span) {
                    if (event.type === 'tool.completed' || !this.run) break;
                    span = this.tool_span(event, data);         // refused before it ran: a span of no duration
                    this.open.push(span);
                }
                const extra: TelemetryAttributes = {};
                put(extra, 'awa.tool.status', data.status);
                if (event.type === 'tool.completed') {
                    if (this.payloads) put(extra, GEN_AI.TOOL_CALL_RESULT, data.result);
                    this.finish_span(span, at, { code: 'ok' }, extra, out);
                } else {
                    const error = error_of(data);
                    put(extra, 'awa.tool.invoked', data.invoked);
                    extra[GEN_AI.ERROR_TYPE] = error.code || '_OTHER';
                    this.finish_span(span, at, { code: 'error', ...(error.message !== undefined ? { message: error.message } : {}) }, extra, out);
                }
                return out;
            }
            case 'meta.recorded': {
                const model = record_of(data.model);
                if (data.subject !== 'model_selection' || typeof model.id !== 'string') break;
                const parent = this.find(s => (s.kind === 'attempt' && s.token === event.token_id && s.node === event.node_id
                    && (event.attempt === undefined || s.attempt === event.attempt))
                    || (s.kind === 'decision' && s.token === event.token_id && s.node === event.node_id));
                if (!parent) break;
                const span = this.base_span(event, `${GEN_AI_OPERATIONS.CHAT} ${model.id}`, 'client', parent.span.span_id);
                span.start_ms = parent.span.start_ms;
                span.end_ms = at;
                span.status = { code: 'ok' };
                const a = span.attributes;
                a[GEN_AI.OPERATION_NAME] = GEN_AI_OPERATIONS.CHAT;
                if (typeof model.provider === 'string') a[GEN_AI.PROVIDER_NAME] = PROVIDER_NAMES[model.provider] || model.provider;
                a[GEN_AI.REQUEST_MODEL] = model.id;
                a[GEN_AI.RESPONSE_MODEL] = model.id;
                if (typeof model.temperature === 'number') a[GEN_AI.REQUEST_TEMPERATURE] = model.temperature;
                put(a, 'awa.model.provider', model.provider);
                put(a, 'awa.model.requested', model.requested);
                put(a, 'awa.model.tier', model.tier);
                put(a, 'awa.model.source', model.source);
                parent.models.push({ span });
                return out;
            }
            case 'decision.evaluated': {
                const span = this.find(s => s.kind === 'decision' && s.token === event.token_id && s.node === event.node_id);
                if (!span) break;
                const extra: TelemetryAttributes = {};
                put(extra, 'awa.decision.method', data.method);
                put(extra, 'awa.decision.strategy', data.strategy);
                put(extra, 'awa.decision.hit_policy', data.hit_policy);
                put(extra, 'awa.decision.edge_id', data.edge_id);
                put(extra, 'awa.decision.used_default', data.used_default);
                if (Array.isArray(data.matched_rules)) {
                    extra['awa.decision.matched_rules'] = data.matched_rules.map(r => record_of(r).index).filter((i): i is number => typeof i === 'number');
                }
                put(extra, 'awa.decision.outputs', data.outputs);
                const model = record_of(data.model);
                put(extra, 'awa.decision.option', model.option);
                put(extra, 'awa.decision.confidence', model.confidence);
                if (this.payloads) put(extra, 'awa.decision.inputs', data.inputs);
                const none = data.method === 'none';
                this.finish_span(span, at, none ? { code: 'error', message: typeof data.conflict === 'string' ? data.conflict : 'no decision' } : { code: 'ok' },
                    extra, out, record_of(model.usage));
                return out;
            }
            case 'token.waiting': case 'event.waiting': case 'timer.started': {
                if (!this.run) break;
                const parent = this.find(s => s.kind === 'attempt' && s.token === event.token_id && s.node === event.node_id) || this.run;
                const span = this.start('wait', event, `wait ${event.node_name || event.node_id}`, 'internal', parent.span.span_id);
                span.wait = WAIT_START[event.type];
                const a = span.span.attributes;
                a['awa.wait.kind'] = span.wait;
                if (event.type === 'token.waiting') {
                    put(a, 'awa.wait.reason', data.reason);
                    put(a, 'awa.human_task.id', data.human_task_id);
                } else if (event.type === 'event.waiting') {
                    put(a, 'awa.business_event.name', data.name);
                    put(a, 'awa.business_event.correlation_key', data.correlation_key);
                    if (this.payloads) put(a, 'awa.business_event.correlation_value', data.correlation_value);
                    put(a, 'awa.business_event.due_at', data.due_at);
                } else {
                    put(a, 'awa.timer.duration', data.duration);
                    put(a, 'awa.timer.due_at', data.due_at);
                }
                this.open.push(span);
                return out;
            }
            case 'token.resumed': case 'event.received': case 'event.timed_out': case 'timer.fired': {
                const end = WAIT_END[event.type];
                const span = this.find(s => s.kind === 'wait' && s.wait === end.kind && s.token === event.token_id);
                if (!span) break;
                const extra: TelemetryAttributes = { 'awa.wait.outcome': end.outcome };
                if (event.type === 'token.resumed') put(extra, 'awa.wait.waited_ms', data.waited_ms);
                if (event.type === 'event.received') {
                    put(extra, 'awa.business_event.id', data.event_id);
                    put(extra, 'awa.business_event.source', data.source);
                    if (this.payloads) put(extra, 'awa.business_event.data', data.data);
                }
                this.finish_span(span, at, { code: end.status }, extra, out);
                return out;
            }
            case 'token.created': case 'token.moved': case 'token.joined':
                this.span_event(event, data);
                if (this.run && event.token_id && event.node_id && this.decision_nodes.has(event.node_id)) {
                    this.open.push(this.start('decision', event, `decision ${event.node_name || event.node_id}`, 'internal', this.run.span.span_id));
                }
                return out;
            case 'run.migrated': {
                // A span event of the run (26.4). A wait the migration withdrew ends with it (spec 25.5)
                this.span_event(event, data);
                for (const moved of Array.isArray(data.tokens) ? data.tokens : []) {
                    const token = record_of(moved);
                    if (token.outcome !== 'restarted') continue;
                    for (let i = this.open.length - 1; i >= 0; i--) {
                        if (i >= this.open.length) continue;
                        const span = this.open[i];
                        if (span.token === token.token_id) this.finish_span(span, at, { code: 'unset' }, span.kind === 'wait' ? { 'awa.wait.outcome': 'withdrawn' } : {}, out);
                    }
                }
                return out;
            }
            case 'token.failed': case 'token.cancelled': {
                this.span_event(event, data);
                const error = error_of(data);
                const status: TelemetrySpan['status'] = event.type === 'token.failed'
                    ? { code: 'error', ...(error.message !== undefined ? { message: error.message } : {}) } : { code: 'unset' };
                for (let i = this.open.length - 1; i >= 0; i--) {
                    if (i < this.open.length && this.open[i].token === event.token_id) this.finish_span(this.open[i], at, status, {}, out);
                }
                return out;
            }
        }
        this.span_event(event, data);
        return out;
    }

    /** End every span still open at the time of the last event, as an export of an unfinished record does (26.8) */
    finish(): TelemetrySpan[] {
        const out: TelemetrySpan[] = [];
        if (this.last_ms === undefined) return out;
        const incomplete = { 'awa.incomplete': true };
        while (this.open.length) this.finish_span(this.open[this.open.length - 1], this.last_ms, { code: 'unset' }, incomplete, out);
        if (this.run) {
            Object.assign(this.run.span.attributes, incomplete);
            this.end(this.run, this.last_ms, { code: 'unset' }, out);
            this.run = undefined;
        }
        return out;
    }

    private base_span(event: JournalEvent, name: string, kind: SpanKind, parent: string | undefined): TelemetrySpan {
        const at = time_ms(event.time);
        const attributes: TelemetryAttributes = { 'awa.run.id': event.run_id };
        put(attributes, 'awa.node.id', event.node_id);
        put(attributes, 'awa.node.name', event.node_name);
        put(attributes, 'awa.token.id', event.token_id);
        put(attributes, 'awa.attempt', event.attempt);
        return {
            trace_id: this.trace_id!, span_id: run_span_id(event.run_id, event.seq),
            ...(parent ? { parent_span_id: parent } : {}),
            name, kind, start_ms: at, end_ms: at, attributes, events: [], links: [], status: { code: 'unset' },
        };
    }

    private start(kind: OpenKind, event: JournalEvent, name: string, span_kind: SpanKind, parent: string | undefined): OpenSpan {
        return {
            kind, span: this.base_span(event, name, span_kind, parent),
            token: event.token_id, node: event.node_id, attempt: event.attempt, models: [],
        };
    }

    private tool_span(event: JournalEvent, data: Record<string, unknown>): OpenSpan {
        const parent = this.find(s => s.kind === 'attempt' && s.token === event.token_id && s.node === event.node_id
            && (event.attempt === undefined || s.attempt === event.attempt)) || this.run!;
        const span = this.start('tool', event, `${GEN_AI_OPERATIONS.EXECUTE_TOOL} ${String(data.tool)}`, 'internal', parent.span.span_id);
        span.call_id = typeof data.call_id === 'string' ? data.call_id : undefined;
        const a = span.span.attributes;
        a[GEN_AI.OPERATION_NAME] = GEN_AI_OPERATIONS.EXECUTE_TOOL;
        put(a, GEN_AI.TOOL_NAME, data.tool);
        put(a, GEN_AI.TOOL_CALL_ID, data.call_id);
        put(a, 'awa.tool.link', data.link);
        put(a, 'awa.tool.binding', record_of(data.binding).kind);
        if (event.type === 'tool.invoked') {
            a['awa.tool.invoked'] = true;
            if (this.payloads) put(a, GEN_AI.TOOL_CALL_ARGUMENTS, data.arguments);
        }
        return span;
    }

    private run_attributes(a: TelemetryAttributes, event: JournalEvent, data: Record<string, unknown>): void {
        a[GEN_AI.OPERATION_NAME] = GEN_AI_OPERATIONS.INVOKE_WORKFLOW;
        put(a, GEN_AI.WORKFLOW_NAME, data.workflow_name);
        put(a, 'awa.workflow.id', event.workflow_id);
        put(a, 'awa.workflow.version', data.workflow_version);
        put(a, 'awa.run.simulated', data.simulate);
        if (this.payloads) put(a, 'awa.run.input', data.input);
    }

    /** The most recently opened span still open that matches */
    private find(match: (s: OpenSpan) => boolean): OpenSpan | undefined {
        for (let i = this.open.length - 1; i >= 0; i--) if (match(this.open[i])) return this.open[i];
        return undefined;
    }

    private span_event(event: JournalEvent, data: Record<string, unknown>): void {
        if (!this.run) return;
        const holder = this.find(s => s.kind !== 'tool' && s.token === event.token_id && s.node === event.node_id
            && (event.attempt === undefined || s.attempt === undefined || s.attempt === event.attempt)
            && event.token_id !== undefined) || this.run;
        const attributes: TelemetryAttributes = { 'awa.journal.seq': event.seq, 'awa.journal.level': event.level };
        put(attributes, 'awa.token.id', event.token_id);
        put(attributes, 'awa.node.id', event.node_id);
        put(attributes, 'awa.node.name', event.node_name);
        put(attributes, 'awa.attempt', event.attempt);
        data_attributes(attributes, data, this.payloads);
        holder.span.events.push({ name: event.type, time_ms: time_ms(event.time), attributes });
    }

    /** End an open span other than the run: its model calls first, then the span itself */
    private finish_span(span: OpenSpan, at: number, status: TelemetrySpan['status'], extra: TelemetryAttributes, out: TelemetrySpan[], usage?: Record<string, unknown>): void {
        this.open.splice(this.open.indexOf(span), 1);
        Object.assign(span.span.attributes, extra);
        const last = span.models[span.models.length - 1];
        if (last && usage) {
            put(last.span.attributes, GEN_AI.USAGE_INPUT_TOKENS, usage.input_tokens);
            put(last.span.attributes, GEN_AI.USAGE_OUTPUT_TOKENS, usage.output_tokens);
        }
        for (const model of span.models) out.push(model.span);
        this.end(span, at, status, out);
    }

    private end(span: OpenSpan, at: number, status: TelemetrySpan['status'], out: TelemetrySpan[]): void {
        span.span.end_ms = at;
        span.span.status = status;
        out.push(span.span);
    }
}

/** Every span of one run's journal, in the order a live exporter sends them, then those still open (26.8) */
export function run_spans(workflow: TraceWorkflow, events: JournalEvent[], options: TraceOptions = {}): TelemetrySpan[] {
    const mapper = new RunTraceMapper(workflow, options);
    const spans: TelemetrySpan[] = [];
    for (const event of [...events].sort((a, b) => a.seq - b.seq)) spans.push(...mapper.push(event));
    spans.push(...mapper.finish());
    return spans;
}

// ---------------------------------------------------------------------------
// A journey's trace (26.7)
// ---------------------------------------------------------------------------

interface OpenJourneySpan {
    kind: 'journey' | 'stage' | 'run';
    span: TelemetrySpan;
    stage_id?: string;
    run_id?: string;
}

/** Turns the record of one journey instance into spans, one journey event at a time */
export class JourneyTraceMapper {
    private journey?: OpenJourneySpan;
    private open: OpenJourneySpan[] = [];
    private last_ms?: number;
    private ended = false;
    private payloads: boolean;

    constructor(options: TraceOptions = {}) {
        this.payloads = options.payloads === true;
    }

    push(event: JourneyEvent): TelemetrySpan[] {
        const out: TelemetrySpan[] = [];
        const at = time_ms(event.time);
        this.last_ms = at;
        const data = record_of(event.data);
        switch (event.type) {
            case 'journey.started': {
                if (this.journey || this.ended) break;
                const span = this.start('journey', event, `journey ${typeof data.journey_name === 'string' ? data.journey_name : event.journey_id}`, undefined);
                const a = span.span.attributes;
                put(a, 'awa.journey.id', event.journey_id);
                put(a, 'awa.journey.name', data.journey_name);
                put(a, 'awa.journey.subject', data.subject);
                if (this.payloads) put(a, 'awa.journey.subject_key', data.subject_key);
                this.journey = span;
                return out;
            }
            case 'journey.completed': case 'journey.abandoned': {
                if (!this.journey) break;
                while (this.open.length) this.close(this.open[this.open.length - 1], at, { code: 'unset' }, this.open[this.open.length - 1].kind === 'stage' ? { 'awa.journey.stage.outcome': 'left' } : {}, out);
                const status = event.type.slice(8);
                const a = this.journey.span.attributes;
                a['awa.journey.status'] = status;
                put(a, 'awa.journey.reason', data.reason);
                this.journey.span.end_ms = at;
                this.journey.span.status = { code: status === 'completed' ? 'ok' : 'unset' };
                out.push(this.journey.span);
                this.journey = undefined;
                this.ended = true;
                return out;
            }
            case 'journey.stage_entered': {
                if (!this.journey) break;
                for (const stage of this.open.filter(s => s.kind === 'stage').reverse()) this.close(stage, at, { code: 'unset' }, { 'awa.journey.stage.outcome': 'left' }, out);
                const span = this.start('stage', event, `stage ${typeof data.stage_name === 'string' ? data.stage_name : event.stage_id}`, this.journey.span.span_id);
                span.stage_id = event.stage_id;
                put(span.span.attributes, 'awa.journey.stage.id', event.stage_id);
                put(span.span.attributes, 'awa.journey.stage.name', data.stage_name);
                this.open.push(span);
                return out;
            }
            case 'journey.stage_completed': {
                const stage = this.find(s => s.kind === 'stage' && s.stage_id === event.stage_id);
                if (!stage) break;
                this.close(stage, at, { code: 'ok' }, { 'awa.journey.stage.outcome': 'completed' }, out);
                return out;
            }
            case 'journey.run_started': {
                if (!this.journey || !event.run_id) break;
                const parent = this.find(s => s.kind === 'stage' && s.stage_id === event.stage_id) || this.journey;
                const span = this.start('run', event, `run ${typeof data.workflow_name === 'string' ? data.workflow_name : data.workflow_id}`, parent.span.span_id);
                span.run_id = event.run_id;
                const a = span.span.attributes;
                a['awa.run.id'] = event.run_id;
                put(a, 'awa.workflow.id', data.workflow_id);
                put(a, 'awa.workflow.name', data.workflow_name);
                put(a, 'awa.journey.stage.id', event.stage_id);
                put(a, 'awa.business_event.id', data.caused_by_event);
                span.span.links.push({ trace_id: run_trace_id(event.run_id), span_id: run_span_id(event.run_id, 1) });
                this.open.push(span);
                return out;
            }
            case 'journey.run_ended': {
                const run = this.find(s => s.kind === 'run' && s.run_id === event.run_id);
                if (!run) break;
                const status = data.status;
                this.close(run, at, status === 'completed' ? { code: 'ok' }
                    : status === 'failed' ? { code: 'error', message: typeof data.error === 'string' ? data.error : 'run failed' } : { code: 'unset' },
                    attribute_value(status) !== undefined ? { 'awa.run.status': attribute_value(status)! } : {}, out);
                return out;
            }
        }
        this.span_event(event, data);
        return out;
    }

    finish(): TelemetrySpan[] {
        const out: TelemetrySpan[] = [];
        if (this.last_ms === undefined) return out;
        while (this.open.length) this.close(this.open[this.open.length - 1], this.last_ms, { code: 'unset' }, { 'awa.incomplete': true }, out);
        if (this.journey) {
            this.journey.span.attributes['awa.incomplete'] = true;
            this.journey.span.end_ms = this.last_ms;
            this.journey.span.status = { code: 'unset' };
            out.push(this.journey.span);
            this.journey = undefined;
        }
        return out;
    }

    private start(kind: OpenJourneySpan['kind'], event: JourneyEvent, name: string, parent: string | undefined): OpenJourneySpan {
        const at = time_ms(event.time);
        return {
            kind,
            span: {
                trace_id: journey_trace_id(event.journey_instance_id), span_id: journey_span_id(event.journey_instance_id, event.seq),
                ...(parent ? { parent_span_id: parent } : {}),
                name, kind: 'internal', start_ms: at, end_ms: at,
                attributes: { 'awa.journey.instance_id': event.journey_instance_id }, events: [], links: [], status: { code: 'unset' },
            },
        };
    }

    private find(match: (s: OpenJourneySpan) => boolean): OpenJourneySpan | undefined {
        for (let i = this.open.length - 1; i >= 0; i--) if (match(this.open[i])) return this.open[i];
        return undefined;
    }

    private close(span: OpenJourneySpan, at: number, status: TelemetrySpan['status'], extra: TelemetryAttributes, out: TelemetrySpan[]): void {
        this.open.splice(this.open.indexOf(span), 1);
        Object.assign(span.span.attributes, extra);
        span.span.end_ms = at;
        span.span.status = status;
        out.push(span.span);
    }

    private span_event(event: JourneyEvent, data: Record<string, unknown>): void {
        if (!this.journey) return;
        const holder = (event.run_id ? this.find(s => s.kind === 'run' && s.run_id === event.run_id) : undefined)
            || (event.stage_id ? this.find(s => s.kind === 'stage' && s.stage_id === event.stage_id) : undefined)
            || this.journey;
        const attributes: TelemetryAttributes = { 'awa.journey.seq': event.seq };
        put(attributes, 'awa.journey.stage.id', event.stage_id);
        put(attributes, 'awa.run.id', event.run_id);
        data_attributes(attributes, data, this.payloads);
        holder.span.events.push({ name: event.type, time_ms: time_ms(event.time), attributes });
    }
}

/** Every span of one journey instance's record */
export function journey_spans(events: JourneyEvent[], options: TraceOptions = {}): TelemetrySpan[] {
    const mapper = new JourneyTraceMapper(options);
    const spans: TelemetrySpan[] = [];
    for (const event of [...events].sort((a, b) => a.seq - b.seq)) spans.push(...mapper.push(event));
    spans.push(...mapper.finish());
    return spans;
}

// ---------------------------------------------------------------------------
// OTLP encoding (26.9)
// ---------------------------------------------------------------------------

/** The resource spans are sent with: service.name `awa` unless another is given, then whatever the deployment adds */
export function telemetry_resource(attributes: TelemetryAttributes = {}, service_name?: string): TelemetryAttributes {
    return { [GEN_AI.SERVICE_NAME]: service_name || (typeof attributes[GEN_AI.SERVICE_NAME] === 'string' ? attributes[GEN_AI.SERVICE_NAME] : 'awa'), ...Object.fromEntries(Object.entries(attributes).filter(([k]) => k !== GEN_AI.SERVICE_NAME)) };
}

export const TELEMETRY_SCOPE = { name: 'awa', version: JOURNAL_SPEC_VERSION } as const;

const KIND_CODE: Record<SpanKind, number> = { internal: 1, client: 3 };
const STATUS_CODE: Record<SpanStatusCode, number> = { unset: 0, ok: 1, error: 2 };

export type OtlpAnyValue =
    | { stringValue: string } | { boolValue: boolean } | { intValue: string } | { doubleValue: number }
    | { arrayValue: { values: OtlpAnyValue[] } };
export interface OtlpKeyValue { key: string; value: OtlpAnyValue }

function any_value(value: TelemetryValue): OtlpAnyValue {
    if (Array.isArray(value)) return { arrayValue: { values: value.map(any_value) } };
    if (typeof value === 'string') return { stringValue: value };
    if (typeof value === 'boolean') return { boolValue: value };
    return Number.isInteger(value) ? { intValue: String(value) } : { doubleValue: value };
}

export function otlp_attributes(attributes: TelemetryAttributes): OtlpKeyValue[] {
    return Object.entries(attributes).map(([key, value]) => ({ key, value: any_value(value) }));
}

const nanos = (ms: number): string => (BigInt(ms) * 1_000_000n).toString();

/** An ExportTraceServiceRequest in OTLP/JSON */
export function spans_to_otlp_json(spans: TelemetrySpan[], resource: TelemetryAttributes = telemetry_resource()): Record<string, unknown> {
    return {
        resourceSpans: [{
            resource: { attributes: otlp_attributes(resource) },
            scopeSpans: [{
                scope: { name: TELEMETRY_SCOPE.name, version: TELEMETRY_SCOPE.version },
                spans: spans.map(span => ({
                    traceId: span.trace_id,
                    spanId: span.span_id,
                    ...(span.parent_span_id ? { parentSpanId: span.parent_span_id } : {}),
                    name: span.name,
                    kind: KIND_CODE[span.kind],
                    startTimeUnixNano: nanos(span.start_ms),
                    endTimeUnixNano: nanos(span.end_ms),
                    attributes: otlp_attributes(span.attributes),
                    events: span.events.map(e => ({ timeUnixNano: nanos(e.time_ms), name: e.name, attributes: otlp_attributes(e.attributes) })),
                    links: span.links.map(l => ({ traceId: l.trace_id, spanId: l.span_id, attributes: otlp_attributes(l.attributes || {}) })),
                    status: { code: STATUS_CODE[span.status.code], ...(span.status.message !== undefined ? { message: span.status.message } : {}) },
                })),
            }],
        }],
    };
}

/** A minimal protobuf writer: just what the OTLP messages need */
class ProtoWriter {
    private chunks: Buffer[] = [];
    private size = 0;

    private push(buffer: Buffer): void { this.chunks.push(buffer); this.size += buffer.length; }

    private varint(value: bigint): void {
        const bytes: number[] = [];
        let v = BigInt.asUintN(64, value);
        while (v >= 0x80n) { bytes.push(Number(v & 0x7fn) | 0x80); v >>= 7n; }
        bytes.push(Number(v));
        this.push(Buffer.from(bytes));
    }

    private tag(field: number, wire: number): void { this.varint(BigInt((field << 3) | wire)); }

    uint(field: number, value: number | bigint): this {
        if (value === 0 || value === 0n) return this;
        this.tag(field, 0); this.varint(BigInt(value)); return this;
    }
    bool(field: number, value: boolean): this { this.tag(field, 0); this.varint(value ? 1n : 0n); return this; }
    int64(field: number, value: number): this { this.tag(field, 0); this.varint(BigInt(value)); return this; }
    fixed64(field: number, value: bigint): this {
        const b = Buffer.alloc(8); b.writeBigUInt64LE(BigInt.asUintN(64, value)); this.tag(field, 1); this.push(b); return this;
    }
    double(field: number, value: number): this { const b = Buffer.alloc(8); b.writeDoubleLE(value); this.tag(field, 1); this.push(b); return this; }
    bytes(field: number, value: Buffer): this { this.tag(field, 2); this.varint(BigInt(value.length)); this.push(value); return this; }
    string(field: number, value: string): this { return this.bytes(field, Buffer.from(value, 'utf8')); }
    /** A string field, left out when empty as proto3 does */
    text(field: number, value: string | undefined): this { return value ? this.string(field, value) : this; }
    message(field: number, write: (w: ProtoWriter) => void): this {
        const inner = new ProtoWriter(); write(inner); return this.bytes(field, inner.finish());
    }
    finish(): Buffer { return Buffer.concat(this.chunks, this.size); }
}

function write_any(w: ProtoWriter, value: TelemetryValue): void {
    if (Array.isArray(value)) w.message(5, a => { for (const v of value) a.message(1, x => write_any(x, v)); });
    else if (typeof value === 'string') w.string(1, value);
    else if (typeof value === 'boolean') w.bool(2, value);
    else if (Number.isInteger(value)) w.int64(3, value);
    else w.double(4, value);
}

function write_attributes(w: ProtoWriter, field: number, attributes: TelemetryAttributes): void {
    for (const [key, value] of Object.entries(attributes)) w.message(field, kv => { kv.string(1, key); kv.message(2, v => write_any(v, value)); });
}

const ns = (ms: number): bigint => BigInt(ms) * 1_000_000n;
const hex = (id: string): Buffer => Buffer.from(id, 'hex');

/** An ExportTraceServiceRequest in OTLP protobuf */
export function spans_to_otlp_protobuf(spans: TelemetrySpan[], resource: TelemetryAttributes = telemetry_resource()): Uint8Array {
    const w = new ProtoWriter();
    w.message(1, rs => {
        rs.message(1, r => write_attributes(r, 1, resource));
        rs.message(2, ss => {
            ss.message(1, scope => { scope.string(1, TELEMETRY_SCOPE.name); scope.string(2, TELEMETRY_SCOPE.version); });
            for (const span of spans) {
                ss.message(2, s => {
                    s.bytes(1, hex(span.trace_id));
                    s.bytes(2, hex(span.span_id));
                    if (span.parent_span_id) s.bytes(4, hex(span.parent_span_id));
                    s.string(5, span.name);
                    s.uint(6, KIND_CODE[span.kind]);
                    s.fixed64(7, ns(span.start_ms));
                    s.fixed64(8, ns(span.end_ms));
                    write_attributes(s, 9, span.attributes);
                    for (const e of span.events) s.message(11, ev => { ev.fixed64(1, ns(e.time_ms)); ev.string(2, e.name); write_attributes(ev, 3, e.attributes); });
                    for (const l of span.links) s.message(13, link => { link.bytes(1, hex(l.trace_id)); link.bytes(2, hex(l.span_id)); write_attributes(link, 4, l.attributes || {}); });
                    s.message(15, st => { st.text(2, span.status.message); st.uint(3, STATUS_CODE[span.status.code]); });
                });
            }
        });
    });
    return new Uint8Array(w.finish());
}

// ---------------------------------------------------------------------------
// Measures as OpenTelemetry metrics (26.12)
// ---------------------------------------------------------------------------

/** The part of a measure report (section 21) that becomes metrics */
export interface MeasureReportLike {
    as_of: string;
    period: { from: string | null; to: string | null };
    currency: string | null;
    journeys: { name: string; measures: Record<string, { value: number | null }>; stages: { name: string; measures: Record<string, { value: number | null }> }[] }[];
    workflows: { name: string; measures: Record<string, { value: number | null }>; activities: { name: string; measures: Record<string, { value: number | null }> }[] }[];
}

export interface TelemetryGauge {
    name: string;
    description: string;
    unit: string;
    points: { attributes: TelemetryAttributes; value: number }[];
}

/**
 * Each measure with a value as a data point of a gauge named `awa.<id>`, with the
 * labels of the OpenMetrics exposition (21.6) as attributes. Gauges come in the
 * order of the definitions given.
 */
export function measures_to_gauges(report: MeasureReportLike, definitions: { id: string; name: string; unit: string; definition: string }[]): TelemetryGauge[] {
    const points = new Map<string, TelemetryGauge['points']>();
    const add = (id: string, attributes: TelemetryAttributes, value: number | null) => {
        if (value === null || !Number.isFinite(value)) return;
        if (!points.has(id)) points.set(id, []);
        points.get(id)!.push({ attributes, value });
    };
    for (const j of report.journeys) {
        for (const [id, m] of Object.entries(j.measures)) add(id, { journey: j.name }, m.value);
        for (const s of j.stages) for (const [id, m] of Object.entries(s.measures)) add(id, { journey: j.name, stage: s.name }, m.value);
    }
    for (const w of report.workflows) {
        for (const [id, m] of Object.entries(w.measures)) add(id, { workflow: w.name }, m.value);
        for (const a of w.activities) for (const [id, m] of Object.entries(a.measures)) add(id, { workflow: w.name, activity: a.name }, m.value);
    }
    const unit = (u: string) => u === 'ms' ? 'ms' : u === 'tokens' ? '{token}' : u === 'currency' ? (report.currency ? `{${report.currency}}` : '1') : '1';
    return definitions.filter(d => points.has(d.id)).map(d => ({
        name: `awa.${d.id}`, description: `${d.name}. ${d.definition}`, unit: unit(d.unit), points: points.get(d.id)!,
    }));
}

/** An ExportMetricsServiceRequest in OTLP/JSON */
export function gauges_to_otlp_json(gauges: TelemetryGauge[], report: { as_of: string; period: { from: string | null } }, resource: TelemetryAttributes = telemetry_resource()): Record<string, unknown> {
    const time = nanos(time_ms(report.as_of));
    const start = report.period.from ? nanos(time_ms(report.period.from)) : undefined;
    return {
        resourceMetrics: [{
            resource: { attributes: otlp_attributes(resource) },
            scopeMetrics: [{
                scope: { name: TELEMETRY_SCOPE.name, version: TELEMETRY_SCOPE.version },
                metrics: gauges.map(g => ({
                    name: g.name, description: g.description, unit: g.unit,
                    gauge: { dataPoints: g.points.map(p => ({ attributes: otlp_attributes(p.attributes), ...(start ? { startTimeUnixNano: start } : {}), timeUnixNano: time, asDouble: p.value })) },
                })),
            }],
        }],
    };
}

/** An ExportMetricsServiceRequest in OTLP protobuf */
export function gauges_to_otlp_protobuf(gauges: TelemetryGauge[], report: { as_of: string; period: { from: string | null } }, resource: TelemetryAttributes = telemetry_resource()): Uint8Array {
    const time = ns(time_ms(report.as_of));
    const start = report.period.from ? ns(time_ms(report.period.from)) : undefined;
    const w = new ProtoWriter();
    w.message(1, rm => {
        rm.message(1, r => write_attributes(r, 1, resource));
        rm.message(2, sm => {
            sm.message(1, scope => { scope.string(1, TELEMETRY_SCOPE.name); scope.string(2, TELEMETRY_SCOPE.version); });
            for (const g of gauges) {
                sm.message(2, m => {
                    m.string(1, g.name); m.text(2, g.description); m.text(3, g.unit);
                    m.message(5, gauge => {
                        for (const p of g.points) {
                            gauge.message(1, dp => {
                                if (start !== undefined) dp.fixed64(2, start);
                                dp.fixed64(3, time);
                                dp.double(4, p.value);
                                write_attributes(dp, 7, p.attributes);
                            });
                        }
                    });
                });
            }
        });
    });
    return new Uint8Array(w.finish());
}
