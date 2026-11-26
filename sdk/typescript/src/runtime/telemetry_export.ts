/**
 * AWA Telemetry export (specification 26.9 to 26.11)
 *
 * Sends the spans of section 26 as OTLP over HTTP, in protobuf or JSON,
 * attaches to runs and journey hosts so that spans leave as the record is
 * written, and reads the standard OpenTelemetry environment variables.
 *
 * Telemetry never delays, blocks or fails a run: spans are queued and sent in
 * the background, failures are retried within a bound, and what cannot be sent
 * is dropped and counted. The journal remains the record; a recorded export can
 * send again what was dropped, with the same identifiers.
 */

import { gzipSync } from 'zlib';
import { JournalEvent, JournalListener } from './journal';
import type { JourneyInstance } from './journey';
import {
    JourneyTraceMapper, RunTraceMapper, TELEMETRY_SCOPE, TelemetryAttributes, TelemetryGauge, TelemetrySpan, TraceWorkflow,
    gauges_to_otlp_json, gauges_to_otlp_protobuf, spans_to_otlp_json, spans_to_otlp_protobuf, telemetry_resource,
} from './telemetry';

/** Receives spans as they end. export() MUST return at once; sending happens elsewhere. */
export interface SpanExporter {
    export(spans: TelemetrySpan[]): void;
    flush?(): Promise<void>;
    shutdown?(): Promise<void>;
}

export type OtlpProtocol = 'http/protobuf' | 'http/json';

/** How a deployment sends telemetry: an exporter of its own, or where to send OTLP */
export interface TelemetryConfig {
    /** An exporter to hand spans to. Takes precedence over `endpoint`. */
    exporter?: SpanExporter;
    /** The OTLP endpoint. `/v1/traces` is appended unless the path already ends with it. */
    endpoint?: string;
    /** The exact URL for traces, used as given (OTEL_EXPORTER_OTLP_TRACES_ENDPOINT) */
    traces_endpoint?: string;
    /** The exact URL for metrics, used as given (OTEL_EXPORTER_OTLP_METRICS_ENDPOINT) */
    metrics_endpoint?: string;
    headers?: Record<string, string>;
    /** Default http/protobuf */
    protocol?: OtlpProtocol;
    /** The deployment opts in to payloads on spans (26.6). Default false. */
    payloads?: boolean;
    service_name?: string;
    resource?: TelemetryAttributes;
    timeout_ms?: number;
    compression?: 'gzip' | 'none';
    max_queue_size?: number;
    max_batch_size?: number;
    schedule_delay_ms?: number;
}

/** An engine's or a runtime's `telemetry` option: an exporter, or a configuration */
export type TelemetrySetting = SpanExporter | TelemetryConfig;

export interface TelemetryStats {
    /** Spans waiting to be sent */
    queued: number;
    /** Spans the receiver accepted */
    exported: number;
    /** Spans that were dropped: the queue was full, or their batch could not be sent */
    dropped: number;
    /** Requests that failed for good, after any retries */
    failed_requests: number;
}

export interface OtlpExporterOptions {
    /** Where traces are posted, in full */
    traces_url: string;
    /** Where metrics are posted, in full. Derived from traces_url when absent. */
    metrics_url?: string;
    headers?: Record<string, string>;
    protocol?: OtlpProtocol;
    timeout_ms?: number;
    compression?: 'gzip' | 'none';
    resource?: TelemetryAttributes;
    max_queue_size?: number;
    max_batch_size?: number;
    schedule_delay_ms?: number;
    /** First delay before a retry; it doubles with each further attempt. Default 1000. */
    retry_delay_ms?: number;
    /** Attempts per request, the first included. Default 5. */
    max_attempts?: number;
    /** Where warnings go. Default: the console, at most once a minute. */
    on_warning?: (message: string) => void;
}

const RETRYABLE = new Set([429, 502, 503, 504]);

/** The URL of a signal under an OTLP endpoint (26.9) */
export function signal_url(endpoint: string, signal: 'traces' | 'metrics'): string {
    const url = new URL(endpoint);
    const path = url.pathname.replace(/\/+$/, '');
    if (/\/v1\/(traces|metrics)$/.test(path)) url.pathname = path.replace(/(traces|metrics)$/, signal);
    else url.pathname = `${path}/v1/${signal}`;
    return url.toString();
}

/** Exporters still holding spans, flushed once before the process would exit */
const live_exporters = new Set<OtlpHttpExporter>();
let exit_hook = false;
function watch_exit(exporter: OtlpHttpExporter): void {
    live_exporters.add(exporter);
    if (exit_hook || typeof process === 'undefined' || typeof process.once !== 'function') return;
    exit_hook = true;
    process.once('beforeExit', () => {
        exit_hook = false;
        void Promise.all([...live_exporters].map(e => e.flush().catch(() => undefined)));
    });
}

/**
 * Sends spans as OTLP over HTTP. export() queues and returns; batches leave in
 * the background when full or after the schedule delay. A failed request is
 * retried on a network error or HTTP 429, 502, 503 or 504, honouring
 * Retry-After, within the timeout; after that its spans are dropped and counted.
 */
export class OtlpHttpExporter implements SpanExporter {
    private queue: TelemetrySpan[] = [];
    private timer?: ReturnType<typeof setTimeout>;
    private sending: Promise<void> = Promise.resolve();
    private counts = { exported: 0, dropped: 0, failed_requests: 0 };
    private closed = false;
    private last_warning = -Infinity;
    private readonly options: Required<Omit<OtlpExporterOptions, 'on_warning' | 'metrics_url'>> & Pick<OtlpExporterOptions, 'on_warning' | 'metrics_url'>;

    constructor(options: OtlpExporterOptions) {
        new URL(options.traces_url);                    // an invalid endpoint is refused here, not when the first span ends
        if (options.protocol && options.protocol !== 'http/protobuf' && options.protocol !== 'http/json') {
            throw new Error(`OTLP protocol "${options.protocol}" is not supported: use http/protobuf or http/json`);
        }
        this.options = {
            headers: {}, protocol: 'http/protobuf', timeout_ms: 10_000, compression: 'none', resource: telemetry_resource(),
            max_queue_size: 2048, max_batch_size: 512, schedule_delay_ms: 1000, retry_delay_ms: 1000, max_attempts: 5,
            ...Object.fromEntries(Object.entries(options).filter(([, v]) => v !== undefined)) as OtlpExporterOptions,
        };
    }

    export(spans: TelemetrySpan[]): void {
        let dropped = 0;
        for (const span of spans) {
            if (this.closed || this.queue.length >= this.options.max_queue_size) { dropped++; continue; }
            this.queue.push(span);
        }
        if (dropped) {
            this.counts.dropped += dropped;
            this.warn(`${dropped} span(s) dropped: ${this.closed ? 'the exporter is shut down' : 'the queue is full'}`);
        }
        if (!this.queue.length) return;
        watch_exit(this);
        if (this.queue.length >= this.options.max_batch_size) void this.drain();
        else if (!this.timer) {
            this.timer = setTimeout(() => { this.timer = undefined; void this.drain(); }, this.options.schedule_delay_ms);
            (this.timer as { unref?: () => void }).unref?.();
        }
    }

    /** Send everything queued. Resolves when it has been sent or dropped; never rejects. */
    async flush(): Promise<void> {
        if (this.timer) { clearTimeout(this.timer); this.timer = undefined; }
        await this.drain();
    }

    /** Flush, then refuse further spans */
    async shutdown(): Promise<void> {
        await this.flush();
        this.closed = true;
        live_exporters.delete(this);
    }

    stats(): TelemetryStats {
        return { queued: this.queue.length, ...this.counts };
    }

    /** Send gauges (26.12) at once. Resolves true when the receiver accepted them. */
    async export_metrics(gauges: TelemetryGauge[], report: { as_of: string; period: { from: string | null } }): Promise<boolean> {
        if (!gauges.length) return true;
        const url = this.options.metrics_url || signal_url(this.options.traces_url, 'metrics');
        const body = this.options.protocol === 'http/json'
            ? JSON.stringify(gauges_to_otlp_json(gauges, report, this.options.resource))
            : gauges_to_otlp_protobuf(gauges, report, this.options.resource);
        return this.post(url, body, 0);
    }

    private drain(): Promise<void> {
        this.sending = this.sending.then(async () => {
            while (this.queue.length) {
                const batch = this.queue.splice(0, this.options.max_batch_size);
                const body = this.options.protocol === 'http/json'
                    ? JSON.stringify(spans_to_otlp_json(batch, this.options.resource))
                    : spans_to_otlp_protobuf(batch, this.options.resource);
                if (await this.post(this.options.traces_url, body, batch.length)) this.counts.exported += batch.length;
            }
            if (!this.queue.length) live_exporters.delete(this);
        }).catch(error => this.warn(`telemetry export failed: ${error instanceof Error ? error.message : String(error)}`));
        return this.sending;
    }

    private async post(url: string, body: string | Uint8Array, spans: number): Promise<boolean> {
        const deadline = Date.now() + this.options.timeout_ms;
        const headers: Record<string, string> = {
            ...this.options.headers,
            'Content-Type': this.options.protocol === 'http/json' ? 'application/json' : 'application/x-protobuf',
        };
        let payload: Uint8Array = typeof body === 'string' ? Buffer.from(body, 'utf8') : body;
        if (this.options.compression === 'gzip') {
            payload = gzipSync(payload);
            headers['Content-Encoding'] = 'gzip';
        }
        let delay = this.options.retry_delay_ms;
        for (let attempt = 1; ; attempt++) {
            let reason: string;
            let retry_after: number | undefined;
            let retryable = true;
            try {
                const remaining = Math.max(1, deadline - Date.now());
                const response = await fetch(url, { method: 'POST', headers, body: payload, signal: AbortSignal.timeout(remaining) });
                await response.arrayBuffer().catch(() => undefined);
                if (response.ok) return true;
                reason = `HTTP ${response.status}`;
                retryable = RETRYABLE.has(response.status);
                const header = response.headers.get('retry-after');
                if (header) {
                    const seconds = Number(header);
                    retry_after = Number.isFinite(seconds) ? seconds * 1000 : Math.max(0, Date.parse(header) - Date.now());
                }
            } catch (error) {
                reason = error instanceof Error ? (error.cause instanceof Error ? error.cause.message : error.message) : String(error);
            }
            const wait = retry_after ?? delay;
            if (!retryable || attempt >= this.options.max_attempts || Date.now() + wait >= deadline) {
                this.counts.failed_requests++;
                this.counts.dropped += spans;
                this.warn(`telemetry could not be sent to ${url} (${reason})${spans ? `: ${spans} span(s) dropped` : ''}. The journal keeps the record; "awa telemetry export" can send it again`);
                return false;
            }
            await new Promise(resolve => setTimeout(resolve, wait));
            delay *= 2;
        }
    }

    private warn(message: string): void {
        if (this.options.on_warning) { this.options.on_warning(message); return; }
        const now = Date.now();
        if (now - this.last_warning < 60_000) return;
        this.last_warning = now;
        console.warn(`[awa telemetry] ${message} (${this.counts.dropped} dropped so far)`);
    }
}

/** An OTLP exporter for a configuration, or undefined when it names nowhere to send to */
export function otlp_exporter(config: TelemetryConfig, extra: Partial<OtlpExporterOptions> = {}): OtlpHttpExporter | undefined {
    const traces_url = config.traces_endpoint || (config.endpoint ? signal_url(config.endpoint, 'traces') : undefined);
    if (!traces_url) return undefined;
    return new OtlpHttpExporter({
        traces_url,
        metrics_url: config.metrics_endpoint || (config.endpoint ? signal_url(config.endpoint, 'metrics') : undefined),
        headers: config.headers, protocol: config.protocol, timeout_ms: config.timeout_ms, compression: config.compression,
        resource: telemetry_resource(config.resource, config.service_name),
        ...(config.max_queue_size ? { max_queue_size: config.max_queue_size } : {}),
        ...(config.max_batch_size ? { max_batch_size: config.max_batch_size } : {}),
        ...(config.schedule_delay_ms !== undefined ? { schedule_delay_ms: config.schedule_delay_ms } : {}),
        ...extra,
    });
}

const shared_exporters = new Map<string, OtlpHttpExporter>();

/** An exporter and whether payloads go on spans, from an engine's or a runtime's option; undefined for none */
export function resolve_telemetry(setting: TelemetrySetting | undefined): { exporter: SpanExporter; payloads: boolean } | undefined {
    if (!setting) return undefined;
    if (typeof (setting as SpanExporter).export === 'function') return { exporter: setting as SpanExporter, payloads: false };
    const config = setting as TelemetryConfig;
    if (config.exporter) return { exporter: config.exporter, payloads: config.payloads === true };
    // Runs configured alike share one exporter, so that their spans share batches
    const key = JSON.stringify({ ...config, payloads: undefined });
    let exporter = shared_exporters.get(key);
    if (!exporter) {
        try {
            exporter = otlp_exporter(config);
        } catch (error) {
            console.warn(`[awa telemetry] not sending telemetry: ${error instanceof Error ? error.message : String(error)}`);
            return undefined;
        }
        if (!exporter) return undefined;
        shared_exporters.set(key, exporter);
    }
    return { exporter, payloads: config.payloads === true };
}

function hand_over(exporter: SpanExporter, spans: TelemetrySpan[]): void {
    if (!spans.length) return;
    try { exporter.export(spans); } catch (error) {
        console.warn(`[awa telemetry] the exporter refused spans: ${error instanceof Error ? error.message : String(error)}`);
    }
}

/**
 * The telemetry of one run: maps its journal events to spans as they are
 * recorded and hands each span to the exporter when it ends. A run resumed in
 * another process first reads the journal it continues, so that spans opened
 * before the restart end with their own start and identifiers.
 */
export class RunTelemetry {
    private mapper: RunTraceMapper;
    private unsubscribe?: () => void;
    private seen = 0;
    private waiting?: JournalEvent[];

    constructor(workflow: TraceWorkflow, private readonly exporter: SpanExporter, payloads: boolean, private readonly earlier: () => Promise<JournalEvent[]>) {
        this.mapper = new RunTraceMapper(workflow, { payloads });
    }

    /** Follow a journal writer. Calling it again follows another writer instead. */
    watch(journal: { subscribe(listener: JournalListener): () => void }): void {
        this.unsubscribe?.();
        this.unsubscribe = journal.subscribe(event => this.on_event(event));
    }

    private on_event(event: JournalEvent): void {
        try {
            if (this.waiting) { this.waiting.push(event); return; }
            if (this.seen === 0 && event.seq > 1) {
                this.waiting = [event];
                this.earlier()
                    .then(events => { for (const e of [...events].sort((a, b) => a.seq - b.seq)) if (e.seq < event.seq) this.mapper.push(e); })
                    .catch(() => undefined)
                    .finally(() => {
                        const held = this.waiting || [];
                        this.waiting = undefined;
                        for (const e of held) this.take(e);
                    });
                return;
            }
            this.take(event);
        } catch (error) {
            console.warn(`[awa telemetry] ${error instanceof Error ? error.message : String(error)}`);
        }
    }

    private take(event: JournalEvent): void {
        this.seen++;
        try { hand_over(this.exporter, this.mapper.push(event)); } catch (error) {
            console.warn(`[awa telemetry] ${error instanceof Error ? error.message : String(error)}`);
        }
    }
}

/** Telemetry for a run from its engine option, or undefined when there is none */
export function open_run_telemetry(workflow: TraceWorkflow, setting: TelemetrySetting | undefined, earlier: () => Promise<JournalEvent[]>): RunTelemetry | undefined {
    const resolved = resolve_telemetry(setting);
    return resolved ? new RunTelemetry(workflow, resolved.exporter, resolved.payloads, earlier) : undefined;
}

/**
 * The telemetry of a host of journeys: each journey instance is a trace (26.7).
 * observe() takes what each record gained since it last looked.
 */
export class JourneyTelemetry {
    /** Per instance, the last journey event taken in, and the mapper while the journey is under way */
    private mappers = new Map<string, { mapper?: JourneyTraceMapper; seen: number }>();

    constructor(private readonly exporter: SpanExporter, private readonly payloads: boolean) { }

    /** Take in records already sent by an earlier process, without sending them again */
    prime(instances: Iterable<JourneyInstance>): void {
        this.take(instances, false);
    }

    observe(instances: Iterable<JourneyInstance>): void {
        try { this.take(instances, true); } catch (error) {
            console.warn(`[awa telemetry] ${error instanceof Error ? error.message : String(error)}`);
        }
    }

    private take(instances: Iterable<JourneyInstance>, send: boolean): void {
        for (const instance of instances) {
            let state = this.mappers.get(instance.id);
            if (!state) { state = { mapper: new JourneyTraceMapper({ payloads: this.payloads }), seen: 0 }; this.mappers.set(instance.id, state); }
            const fresh = instance.events.filter(e => e.seq > state!.seen).sort((a, b) => a.seq - b.seq);
            for (const event of fresh) {
                state.seen = event.seq;
                const spans = state.mapper?.push(event) || [];
                if (send) hand_over(this.exporter, spans);
            }
            // An ended journey keeps only how far it was read, so that nothing is sent twice
            if (instance.status !== 'active') state.mapper = undefined;
        }
    }
}

export function open_journey_telemetry(setting: TelemetrySetting | undefined): JourneyTelemetry | undefined {
    const resolved = resolve_telemetry(setting);
    return resolved ? new JourneyTelemetry(resolved.exporter, resolved.payloads) : undefined;
}

// ---------------------------------------------------------------------------
// Environment (26.11)
// ---------------------------------------------------------------------------

function parse_pairs(text: string | undefined): Record<string, string> {
    const out: Record<string, string> = {};
    for (const part of (text || '').split(',')) {
        const at = part.indexOf('=');
        if (at <= 0) continue;
        const key = part.slice(0, at).trim();
        const raw = part.slice(at + 1).trim();
        let value = raw;
        try { value = decodeURIComponent(raw); } catch { /* kept as written */ }
        if (key) out[key] = value;
    }
    return out;
}

/**
 * Telemetry configured by the standard OpenTelemetry environment variables, or
 * undefined when they say to send nothing or name nowhere to send to. What
 * cannot be honoured is reported in `warnings`.
 */
export function telemetry_from_env(env: Record<string, string | undefined> = process.env, warnings: string[] = []): TelemetryConfig | undefined {
    const get = (name: string) => env[`OTEL_EXPORTER_OTLP_TRACES_${name}`] ?? env[`OTEL_EXPORTER_OTLP_${name}`];
    if ((env.OTEL_SDK_DISABLED || '').trim().toLowerCase() === 'true') return undefined;
    const exporters = (env.OTEL_TRACES_EXPORTER || 'otlp').split(',').map(e => e.trim().toLowerCase());
    if (exporters.includes('none')) return undefined;
    if (!exporters.includes('otlp')) {
        warnings.push(`OTEL_TRACES_EXPORTER=${env.OTEL_TRACES_EXPORTER} is not supported: only otlp is. No telemetry is sent.`);
        return undefined;
    }
    const traces_endpoint = env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT?.trim();
    const endpoint = env.OTEL_EXPORTER_OTLP_ENDPOINT?.trim();
    if (!traces_endpoint && !endpoint) return undefined;
    const protocol = (get('PROTOCOL') || 'http/protobuf').trim();
    if (protocol !== 'http/protobuf' && protocol !== 'http/json') {
        warnings.push(`OTLP protocol "${protocol}" is not supported: use http/protobuf or http/json. No telemetry is sent.`);
        return undefined;
    }
    for (const url of [traces_endpoint, endpoint]) {
        if (!url) continue;
        try { new URL(url); } catch {
            warnings.push(`"${url}" is not a URL. No telemetry is sent.`);
            return undefined;
        }
    }
    const number = (text: string | undefined) => (text && Number.isFinite(Number(text)) && Number(text) > 0 ? Number(text) : undefined);
    const compression = (get('COMPRESSION') || 'none').trim().toLowerCase();
    if (compression !== 'gzip' && compression !== 'none') warnings.push(`OTLP compression "${compression}" is not supported; sending uncompressed.`);
    const resource: TelemetryAttributes = parse_pairs(env.OTEL_RESOURCE_ATTRIBUTES);
    return {
        ...(traces_endpoint ? { traces_endpoint } : {}),
        ...(endpoint ? { endpoint } : {}),
        ...(env.OTEL_EXPORTER_OTLP_METRICS_ENDPOINT ? { metrics_endpoint: env.OTEL_EXPORTER_OTLP_METRICS_ENDPOINT.trim() } : {}),
        headers: { ...parse_pairs(env.OTEL_EXPORTER_OTLP_HEADERS), ...parse_pairs(env.OTEL_EXPORTER_OTLP_TRACES_HEADERS) },
        protocol,
        timeout_ms: number(get('TIMEOUT')) ?? 10_000,
        compression: compression === 'gzip' ? 'gzip' : 'none',
        ...(env.OTEL_SERVICE_NAME ? { service_name: env.OTEL_SERVICE_NAME } : {}),
        resource,
        payloads: (env.AWA_TELEMETRY_PAYLOADS || '').trim().toLowerCase() === 'true',
        ...(number(env.OTEL_BSP_SCHEDULE_DELAY) !== undefined ? { schedule_delay_ms: number(env.OTEL_BSP_SCHEDULE_DELAY) } : {}),
        ...(number(env.OTEL_BSP_MAX_QUEUE_SIZE) !== undefined ? { max_queue_size: number(env.OTEL_BSP_MAX_QUEUE_SIZE) } : {}),
        ...(number(env.OTEL_BSP_MAX_EXPORT_BATCH_SIZE) !== undefined ? { max_batch_size: number(env.OTEL_BSP_MAX_EXPORT_BATCH_SIZE) } : {}),
    };
}

let env_telemetry: { setting?: TelemetryConfig } | undefined;

/**
 * The telemetry a command or a server takes from its environment, resolved once
 * per process so that every run shares one exporter. Warnings are printed once.
 */
export function shared_telemetry_from_env(): TelemetryConfig | undefined {
    if (!env_telemetry) {
        const warnings: string[] = [];
        const config = telemetry_from_env(process.env, warnings);
        for (const warning of warnings) console.warn(`[awa telemetry] ${warning}`);
        const resolved = config ? resolve_telemetry(config) : undefined;
        env_telemetry = { setting: resolved ? { exporter: resolved.exporter, payloads: resolved.payloads } : undefined };
    }
    return env_telemetry.setting;
}

// ---------------------------------------------------------------------------
// The official OpenTelemetry SDK
// ---------------------------------------------------------------------------

/** What an OpenTelemetry JS SpanExporter (from @opentelemetry/sdk-trace-base) offers */
export interface OpenTelemetrySpanExporterLike {
    export(spans: unknown[], resultCallback: (result: { code: number; error?: Error }) => void): void;
    shutdown(): Promise<void>;
    forceFlush?(): Promise<void>;
}

const OTEL_KIND = { internal: 0, client: 2 } as const;
const OTEL_STATUS = { unset: 0, ok: 1, error: 2 } as const;
const hrtime = (ms: number): [number, number] => [Math.floor(ms / 1000), (ms % 1000) * 1_000_000];

/**
 * A span as an OpenTelemetry JS ReadableSpan, so that an exporter of the official
 * SDK can send it. Needs no OpenTelemetry package.
 */
export function to_readable_span(span: TelemetrySpan, resource: TelemetryAttributes = telemetry_resource()): Record<string, unknown> {
    const context = (trace_id: string, span_id: string) => ({ traceId: trace_id, spanId: span_id, traceFlags: 1, isRemote: false });
    const otel_resource = {
        attributes: resource, asyncAttributesPending: false,
        waitForAsyncAttributes: async () => undefined,
        getRawAttributes: () => Object.entries(resource),
        merge() { return otel_resource; },
    };
    const scope = { name: TELEMETRY_SCOPE.name, version: TELEMETRY_SCOPE.version };
    return {
        name: span.name,
        kind: OTEL_KIND[span.kind],
        spanContext: () => context(span.trace_id, span.span_id),
        parentSpanContext: span.parent_span_id ? context(span.trace_id, span.parent_span_id) : undefined,
        parentSpanId: span.parent_span_id,
        startTime: hrtime(span.start_ms),
        endTime: hrtime(span.end_ms),
        duration: hrtime(span.end_ms - span.start_ms),
        status: { code: OTEL_STATUS[span.status.code], ...(span.status.message !== undefined ? { message: span.status.message } : {}) },
        attributes: span.attributes,
        links: span.links.map(l => ({ context: context(l.trace_id, l.span_id), attributes: l.attributes || {} })),
        events: span.events.map(e => ({ name: e.name, time: hrtime(e.time_ms), attributes: e.attributes })),
        ended: true,
        resource: otel_resource,
        instrumentationScope: scope,
        instrumentationLibrary: scope,
        droppedAttributesCount: 0, droppedEventsCount: 0, droppedLinksCount: 0,
    };
}

/** Hand AWA's spans to an exporter of the official OpenTelemetry SDK */
export function from_opentelemetry_exporter(exporter: OpenTelemetrySpanExporterLike, resource: TelemetryAttributes = telemetry_resource()): SpanExporter {
    let pending: Promise<void> = Promise.resolve();
    return {
        export(spans) {
            const readable = spans.map(s => to_readable_span(s, resource));
            pending = pending.then(() => new Promise<void>(resolve => {
                try { exporter.export(readable, () => resolve()); } catch { resolve(); }
            }));
        },
        async flush() { await pending; await exporter.forceFlush?.(); },
        async shutdown() { await pending; await exporter.shutdown(); },
    };
}
