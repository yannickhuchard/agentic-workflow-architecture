/**
 * Telemetry (specification section 26): what the conformance cases cannot reach.
 * Live export to a receiver on localhost, in JSON and in protobuf decoded with the
 * OpenTelemetry proto definitions; failures that must not touch the run; recovery;
 * the environment; journeys hosted live; the official OpenTelemetry SDK; and the
 * claims-settlement example, whose export is shared with the Python SDK.
 */
import { describe, it, expect, afterEach } from 'vitest';
import http from 'http';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { gunzipSync } from 'zlib';
import { AddressInfo } from 'net';
import protobuf from 'protobufjs';
import * as semconv from '@opentelemetry/semantic-conventions';
import * as incubating from '@opentelemetry/semantic-conventions/incubating';
import { InMemorySpanExporter } from '@opentelemetry/sdk-trace';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { WorkflowEngine } from '../src/runtime/workflow_engine';
import { parse_document } from '../src/validator';
import { InMemoryJournalStore, JournalEvent, parse_journal } from '../src/runtime/journal';
import { AwaRuntime, InMemoryRuntimeStore } from '../src/runtime/runtime';
import { JourneyDefinitionSchema } from '../src/runtime/journey';
import { business_event } from '../src/runtime/business_event';
import { compute_measures, MEASURES } from '../src/runtime/kpi';
import {
    GEN_AI, GEN_AI_OPERATIONS, TelemetrySpan, gauges_to_otlp_json, gauges_to_otlp_protobuf, journey_spans, measures_to_gauges, run_span_id, run_spans,
    run_trace_id, spans_to_otlp_json, spans_to_otlp_protobuf,
} from '../src/runtime/telemetry';
import {
    OtlpHttpExporter, SpanExporter, from_opentelemetry_exporter, signal_url, telemetry_from_env,
} from '../src/runtime/telemetry_export';
import { activity, edge, silent_logger } from './helpers';
import { Workflow } from '../src/types';

const ROOT = path.resolve(__dirname, '../../..');
const EXAMPLE = path.join(ROOT, 'examples/claims-settlement');
const PROTOS = path.join(__dirname, 'fixtures/opentelemetry-proto');
const claims = () => parse_document(JSON.parse(fs.readFileSync(path.join(EXAMPLE, 'claims-settlement.awa.json'), 'utf-8')));
const journal_of = (name: string) => parse_journal(fs.readFileSync(path.join(EXAMPLE, 'runs', `${name}.journal.jsonl`), 'utf-8'));
const RUNS = ['completed', 'failed-and-compensated', 'model-decision'];

// ---------------------------------------------------------------------------
// A receiver on localhost
// ---------------------------------------------------------------------------

interface Received { path: string; headers: http.IncomingHttpHeaders; body: Buffer }

async function receiver(answer: (request: Received, index: number) => { status: number; headers?: Record<string, string>; delay_ms?: number } = () => ({ status: 200 })) {
    const received: Received[] = [];
    const server = http.createServer((req, res) => {
        const chunks: Buffer[] = [];
        req.on('data', c => chunks.push(c));
        req.on('end', () => {
            let body = Buffer.concat(chunks);
            if (req.headers['content-encoding'] === 'gzip') body = gunzipSync(body);
            const request = { path: req.url || '', headers: req.headers, body };
            const reply = answer(request, received.length);
            received.push(request);
            setTimeout(() => { res.writeHead(reply.status, reply.headers || {}); res.end('{}'); }, reply.delay_ms || 0);
        });
    });
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    servers.push(server);
    return { url, received, close: () => new Promise<void>(resolve => server.close(() => resolve())) };
}
const servers: http.Server[] = [];
afterEach(async () => {
    for (const s of servers.splice(0)) { s.closeAllConnections?.(); await new Promise(resolve => s.close(resolve)); }
});

// ---------------------------------------------------------------------------
// The OpenTelemetry proto definitions
// ---------------------------------------------------------------------------

const proto = (() => {
    const root = new protobuf.Root();
    root.resolvePath = (_origin, target) => path.join(PROTOS, target);
    root.loadSync([
        'opentelemetry/proto/collector/trace/v1/trace_service.proto',
        'opentelemetry/proto/collector/metrics/v1/metrics_service.proto',
    ]);
    return {
        traces: root.lookupType('opentelemetry.proto.collector.trace.v1.ExportTraceServiceRequest'),
        metrics: root.lookupType('opentelemetry.proto.collector.metrics.v1.ExportMetricsServiceRequest'),
    };
})();

const ID_FIELDS = new Set(['traceId', 'spanId', 'parentSpanId']);
/** A decoded protobuf message, or OTLP/JSON, in one comparable form: ids in hex, defaults and attribute order left out */
function comparable(value: any, key = ''): any {
    if (Array.isArray(value)) {
        const items = value.map(v => comparable(v));
        return key === 'attributes' ? items.sort((a, b) => a.key.localeCompare(b.key)) : items;
    }
    if (ID_FIELDS.has(key) && typeof value === 'string' && !/^[0-9a-f]*$/.test(value)) return Buffer.from(value, 'base64').toString('hex');
    if (!value || typeof value !== 'object') return value;
    const out: any = {};
    for (const [k, v] of Object.entries(value)) {
        const c = comparable(v, k);
        if (Array.isArray(c) && c.length === 0) continue;
        if (c && typeof c === 'object' && !Array.isArray(c) && Object.keys(c).length === 0) continue;
        if (k === 'code' && c === 0) continue;
        out[k] = c;
    }
    return out;
}
const decode_traces = (bytes: Uint8Array) => comparable(proto.traces.toObject(proto.traces.decode(bytes), { longs: String, bytes: String, enums: Number, arrays: true }));
const decode_metrics = (bytes: Uint8Array) => comparable(proto.metrics.toObject(proto.metrics.decode(bytes), { longs: String, bytes: String, enums: Number, arrays: true }));
const spans_in = (request: any): any[] => request.resourceSpans.flatMap((r: any) => r.scopeSpans.flatMap((s: any) => s.spans));

/** Run a workflow to its end */
async function run_to_end(engine: WorkflowEngine, input: Record<string, unknown> = {}): Promise<string> {
    await engine.start(input);
    while (engine.getStatus() === 'running') await engine.runStep();
    return engine.getStatus();
}
const simulation = () => JSON.parse(fs.readFileSync(path.join(EXAMPLE, 'simulation.json'), 'utf-8'));
const until = async (check: () => boolean, ms = 5000) => {
    const end = Date.now() + ms;
    while (!check() && Date.now() < end) await new Promise(r => setTimeout(r, 10));
};

/** Collects spans in memory: the simplest exporter a host can attach */
class Collect implements SpanExporter {
    spans: TelemetrySpan[] = [];
    export(spans: TelemetrySpan[]): void { this.spans.push(...spans); }
}

function two_step(): Workflow {
    const a = activity('Draft');
    const b = activity('Send');
    return { id: '9f0e4a52-6b8e-4c41-9a51-1f9c9f3f0a01', name: 'Two steps', version: '1.0.0', description: '', activities: [a, b], edges: [edge(a, b)], contexts: [], decision_nodes: [], events: [] } as unknown as Workflow;
}

// ---------------------------------------------------------------------------

describe('Semantic conventions', () => {
    it(`are the names of @opentelemetry/semantic-conventions 1.45.0`, () => {
        const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, "../node_modules/@opentelemetry/semantic-conventions/package.json"), 'utf-8'));
        expect(pkg.version).toBe('1.45.0');
        const i = incubating as unknown as Record<string, string>;
        expect(GEN_AI).toEqual({
            OPERATION_NAME: i.ATTR_GEN_AI_OPERATION_NAME, PROVIDER_NAME: i.ATTR_GEN_AI_PROVIDER_NAME,
            REQUEST_MODEL: i.ATTR_GEN_AI_REQUEST_MODEL, RESPONSE_MODEL: i.ATTR_GEN_AI_RESPONSE_MODEL, REQUEST_TEMPERATURE: i.ATTR_GEN_AI_REQUEST_TEMPERATURE,
            USAGE_INPUT_TOKENS: i.ATTR_GEN_AI_USAGE_INPUT_TOKENS, USAGE_OUTPUT_TOKENS: i.ATTR_GEN_AI_USAGE_OUTPUT_TOKENS,
            TOOL_NAME: i.ATTR_GEN_AI_TOOL_NAME, TOOL_CALL_ID: i.ATTR_GEN_AI_TOOL_CALL_ID,
            TOOL_CALL_ARGUMENTS: i.ATTR_GEN_AI_TOOL_CALL_ARGUMENTS, TOOL_CALL_RESULT: i.ATTR_GEN_AI_TOOL_CALL_RESULT,
            AGENT_NAME: i.ATTR_GEN_AI_AGENT_NAME, AGENT_ID: i.ATTR_GEN_AI_AGENT_ID, WORKFLOW_NAME: i.ATTR_GEN_AI_WORKFLOW_NAME,
            ERROR_TYPE: semconv.ATTR_ERROR_TYPE, SERVICE_NAME: semconv.ATTR_SERVICE_NAME,
        });
        expect(GEN_AI_OPERATIONS).toEqual({
            INVOKE_WORKFLOW: i.GEN_AI_OPERATION_NAME_VALUE_INVOKE_WORKFLOW, INVOKE_AGENT: i.GEN_AI_OPERATION_NAME_VALUE_INVOKE_AGENT,
            EXECUTE_TOOL: i.GEN_AI_OPERATION_NAME_VALUE_EXECUTE_TOOL, CHAT: i.GEN_AI_OPERATION_NAME_VALUE_CHAT,
        });
        expect(i.GEN_AI_PROVIDER_NAME_VALUE_GCP_GEMINI).toBe('gcp.gemini');
    });
});

describe('Protobuf encoding', () => {
    it('decodes with the OpenTelemetry proto definitions to the same request as the JSON encoding', () => {
        for (const name of RUNS) {
            const spans = run_spans(claims(), journal_of(name), { payloads: true });
            expect(decode_traces(spans_to_otlp_protobuf(spans)), name).toEqual(comparable(spans_to_otlp_json(spans)));
        }
    });

    it('encodes every kind of attribute value, links, and identifiers of a journey', () => {
        const events = [
            { spec_version: '1.1', journey_instance_id: 'i-1', journey_id: 'j', seq: 1, time: '2026-01-01T00:00:00.000Z', type: 'journey.started', data: { journey_name: 'Ünïcode ✓' } },
            { spec_version: '1.1', journey_instance_id: 'i-1', journey_id: 'j', seq: 2, time: '2026-01-01T00:00:00.001Z', type: 'journey.run_started', run_id: 'r-1', data: { workflow_name: 'W' } },
            { spec_version: '1.1', journey_instance_id: 'i-1', journey_id: 'j', seq: 3, time: '2026-01-01T00:00:01.000Z', type: 'journey.goal_reached', data: { big: 2 ** 40, negative: -3, ratio: 0.125, list: [1, 'a'], yes: false } },
        ] as any[];
        const spans = journey_spans(events);
        const decoded = decode_traces(spans_to_otlp_protobuf(spans));
        expect(decoded).toEqual(comparable(spans_to_otlp_json(spans)));
        const run = spans_in(decoded).find((s: any) => s.name === 'run W');
        expect(run.links).toEqual([{ traceId: run_trace_id('r-1'), spanId: run_span_id('r-1', 1) }]);
    });

    it('encodes measures as gauges that decode with the metrics definitions', () => {
        const input = JSON.parse(fs.readFileSync(path.join(ROOT, 'spec/conformance/measures', fs.readdirSync(path.join(ROOT, 'spec/conformance/measures'))[0]), 'utf-8'));
        const report = compute_measures(input.recorded, input.options);
        const gauges = measures_to_gauges(report, MEASURES);
        expect(gauges.length).toBeGreaterThan(5);
        expect(decode_metrics(gauges_to_otlp_protobuf(gauges, report))).toEqual(comparable(gauges_to_otlp_json(gauges, report)));
    });
});

describe('Live export to a receiver', () => {
    for (const protocol of ['http/json', 'http/protobuf'] as const) {
        it(`sends a run's spans as it proceeds (${protocol}), the same spans a recorded export gives`, async () => {
            const collector = await receiver();
            const exporter = new OtlpHttpExporter({ traces_url: `${collector.url}/v1/traces`, protocol, schedule_delay_ms: 5, headers: { 'x-tenant': 'claims' } });
            const workflow = claims();
            const journal = new InMemoryJournalStore();
            const engine = new WorkflowEngine(workflow, {
                simulate: true, simulated_outputs: simulation(), journal, execution_logger: silent_logger, telemetry: { exporter, payloads: true },
            });
            expect(await run_to_end(engine, { claimant: 'J. Moreau' })).toBe('completed');
            await exporter.flush();

            const received = collector.received.map(r => {
                expect(r.path).toBe('/v1/traces');
                expect(r.headers['x-tenant']).toBe('claims');
                expect(r.headers['content-type']).toBe(protocol === 'http/json' ? 'application/json' : 'application/x-protobuf');
                return protocol === 'http/json' ? comparable(JSON.parse(r.body.toString('utf-8'))) : decode_traces(r.body);
            });
            const sent = received.flatMap(spans_in);
            const recorded = spans_in(comparable(spans_to_otlp_json(run_spans(workflow, await engine.getEvents(), { payloads: true }))));
            expect(sent).toEqual(recorded);
            expect(new Set(sent.map((s: any) => s.traceId))).toEqual(new Set([run_trace_id(engine.getRunId())]));
            const names = sent.map((s: any) => s.name);
            expect(names).toContain('invoke_workflow Motor Claim Settlement');
            expect(names).toContain('decision Settlement route');
            expect(names).toContain('wait Bank cut-off');
            expect(names.filter((n: string) => n.startsWith('activity ') || n.startsWith('invoke_agent ')).length).toBeGreaterThan(6);
            expect(exporter.stats()).toMatchObject({ queued: 0, dropped: 0, failed_requests: 0, exported: sent.length });
        }, 20_000);
    }

    it('compresses with gzip when asked', async () => {
        const collector = await receiver();
        const exporter = new OtlpHttpExporter({ traces_url: `${collector.url}/v1/traces`, compression: 'gzip', schedule_delay_ms: 5 });
        exporter.export(run_spans(claims(), journal_of('completed')));
        await exporter.flush();
        expect(collector.received[0].headers['content-encoding']).toBe('gzip');
        expect(spans_in(decode_traces(collector.received[0].body))).toHaveLength(21);
    });

    it('sends in batches no larger than the batch size', async () => {
        const collector = await receiver();
        const exporter = new OtlpHttpExporter({ traces_url: `${collector.url}/v1/traces`, protocol: 'http/json', max_batch_size: 8, schedule_delay_ms: 5 });
        exporter.export(run_spans(claims(), journal_of('completed')));
        await exporter.flush();
        expect(collector.received.map(r => spans_in(JSON.parse(r.body.toString())).length)).toEqual([8, 8, 5]);
    });
});

describe('Telemetry never fails a run', () => {
    it('retries 503 and 429, honouring Retry-After, and then delivers', async () => {
        const collector = await receiver((_r, i) => (i === 0 ? { status: 503 } : i === 1 ? { status: 429, headers: { 'retry-after': '0' } } : { status: 200 }));
        const exporter = new OtlpHttpExporter({ traces_url: `${collector.url}/v1/traces`, retry_delay_ms: 5, schedule_delay_ms: 5, on_warning: () => { } });
        exporter.export(run_spans(claims(), journal_of('completed')));
        await exporter.flush();
        expect(collector.received).toHaveLength(3);
        expect(exporter.stats()).toMatchObject({ exported: 21, dropped: 0, failed_requests: 0 });
    });

    it('does not retry a request the receiver refuses, drops its spans and says so once', async () => {
        const collector = await receiver(() => ({ status: 400 }));
        const warnings: string[] = [];
        const exporter = new OtlpHttpExporter({ traces_url: `${collector.url}/v1/traces`, retry_delay_ms: 5, schedule_delay_ms: 5, on_warning: w => warnings.push(w) });
        const engine = new WorkflowEngine(two_step(), { simulate: true, execution_logger: silent_logger, telemetry: exporter });
        expect(await run_to_end(engine)).toBe('completed');
        await exporter.flush();
        expect(collector.received).toHaveLength(1);
        expect(exporter.stats()).toMatchObject({ exported: 0, dropped: 3, failed_requests: 1 });
        expect(warnings).toHaveLength(1);
        expect(warnings[0]).toMatch(/HTTP 400.*3 span\(s\) dropped.*awa telemetry export/);
    });

    it('completes a run whose receiver cannot be reached, without waiting for it', async () => {
        const closed = await receiver();
        await closed.close();
        const warnings: string[] = [];
        const exporter = new OtlpHttpExporter({ traces_url: `${closed.url}/v1/traces`, retry_delay_ms: 20, max_attempts: 3, schedule_delay_ms: 0, on_warning: w => warnings.push(w) });
        const engine = new WorkflowEngine(two_step(), { simulate: true, execution_logger: silent_logger, telemetry: exporter });
        expect(await run_to_end(engine)).toBe('completed');
        await exporter.flush();
        expect(exporter.stats()).toMatchObject({ exported: 0, dropped: 3, failed_requests: 1 });
        expect(warnings[0]).toMatch(/could not be sent/);
    });

    it('does not hold the run while a slow receiver answers', async () => {
        const collector = await receiver(() => ({ status: 200, delay_ms: 1500 }));
        const exporter = new OtlpHttpExporter({ traces_url: `${collector.url}/v1/traces`, schedule_delay_ms: 0, max_batch_size: 1 });
        const started = Date.now();
        const engine = new WorkflowEngine(two_step(), { simulate: true, execution_logger: silent_logger, telemetry: exporter });
        expect(await run_to_end(engine)).toBe('completed');
        expect(Date.now() - started).toBeLessThan(1000);
        expect(exporter.stats().exported).toBe(0);
        await exporter.flush();
        expect(exporter.stats().exported).toBe(3);
    }, 15_000);

    it('drops what does not fit in the queue and counts it', () => {
        const warnings: string[] = [];
        const exporter = new OtlpHttpExporter({ traces_url: 'http://127.0.0.1:9/v1/traces', max_queue_size: 5, schedule_delay_ms: 60_000, on_warning: w => warnings.push(w) });
        exporter.export(run_spans(claims(), journal_of('completed')));
        expect(exporter.stats()).toMatchObject({ queued: 5, dropped: 16 });
        expect(warnings[0]).toMatch(/16 span\(s\) dropped: the queue is full/);
    });

    it('completes a run whose exporter throws, and one configured with an endpoint that is not a URL', async () => {
        const throwing: SpanExporter = { export: () => { throw new Error('broken exporter'); } };
        const warn = console.warn;
        const said: string[] = [];
        console.warn = (m: string) => said.push(m);
        try {
            expect(await run_to_end(new WorkflowEngine(two_step(), { simulate: true, execution_logger: silent_logger, telemetry: throwing }))).toBe('completed');
            expect(await run_to_end(new WorkflowEngine(two_step(), { simulate: true, execution_logger: silent_logger, telemetry: { endpoint: 'not a url' } }))).toBe('completed');
        } finally { console.warn = warn; }
        expect(said.some(m => /broken exporter/.test(m))).toBe(true);
        expect(said.some(m => /not sending telemetry/.test(m))).toBe(true);
    });

    it('refuses gRPC rather than sending to the wrong place', () => {
        expect(() => new OtlpHttpExporter({ traces_url: 'http://127.0.0.1:4317', protocol: 'grpc' as any })).toThrow(/not supported/);
    });

    it('drops spans handed to an exporter that has been shut down', async () => {
        const exporter = new OtlpHttpExporter({ traces_url: 'http://127.0.0.1:9/v1/traces', on_warning: () => { } });
        await exporter.shutdown();
        exporter.export(run_spans(claims(), journal_of('completed')).slice(0, 2));
        expect(exporter.stats()).toMatchObject({ queued: 0, dropped: 2 });
    });
});

describe('A run resumed in another process', () => {
    it('keeps the identifiers and start of the spans opened before the restart', async () => {
        const human = activity('Approve', { actor_type: 'human' });
        const after = activity('Archive');
        const workflow = { id: '0a4b9f9e-08a5-4b7e-8c3e-0b8f0c6a1d11', name: 'Approve', version: '1.0.0', description: '', activities: [human, after], edges: [edge(human, after)], contexts: [], decision_nodes: [], events: [] } as unknown as Workflow;
        const journal = new InMemoryJournalStore();
        const first = new Collect();
        const engine = new WorkflowEngine(workflow, { journal, wait_for_human_tasks: true, execution_logger: silent_logger, telemetry: first });
        expect(await run_to_end(engine)).toBe('waiting_human');
        const state = engine.snapshot();
        await engine.flush();
        expect(first.spans).toHaveLength(0);              // nothing has ended yet

        const second = new Collect();
        const resumed = await WorkflowEngine.recover(workflow, state, { journal, wait_for_human_tasks: true, execution_logger: silent_logger, telemetry: second });
        const token = resumed.getTokens().find(t => t.status === 'waiting')!;
        await resumed.resumeToken(token.id, { approved: true });
        while (resumed.getStatus() === 'running') await resumed.runStep();
        await until(() => second.spans.some(s => s.name.startsWith('invoke_workflow')));
        expect(resumed.getStatus()).toBe('completed');

        const recorded = run_spans(workflow, await resumed.getEvents());
        expect(second.spans).toEqual(recorded);
        const events = await resumed.getEvents();
        const run = second.spans.find(s => s.name === 'invoke_workflow Approve')!;
        expect(run.span_id).toBe(run_span_id(engine.getRunId(), 1));
        expect(run.start_ms).toBe(Date.parse(events[0].time));
        const wait = second.spans.find(s => s.name === 'wait Approve')!;
        expect(wait.start_ms).toBe(Date.parse(events.find(e => e.type === 'token.waiting')!.time));
        expect(wait.status.code).toBe('ok');
    });
});

describe('Journeys hosted live', () => {
    const intake = activity('Register');
    const workflow = { id: 'd3c5f1c2-6a39-4a8f-8f2e-3c9d6b1a7e21', name: 'Intake', version: '1.0.0', description: '', activities: [intake], edges: [], contexts: [], decision_nodes: [], events: [] } as unknown as Workflow;
    const journey = JourneyDefinitionSchema.parse({
        id: 'f1e2d3c4-b5a6-4978-8877-665544332211', name: 'Claim', version: '1.0.0',
        subject: { name: 'customer', key: 'customer_id' },
        stages: [{ id: 'intake', name: 'Intake', workflows: [workflow.id], complete_when: 'registered == true' }],
        triggers: [{ event: 'claim.submitted', starts_journey: true, start_workflow: workflow.id }],
        exits: [], goals: [],
    });

    it('sends the journey trace, whose run spans link to the runs\' traces, and does not send it again after a restart', async () => {
        const store = new InMemoryRuntimeStore();
        const exported = new Collect();
        const options = { store, telemetry: exported, engine: { simulate: true, simulated_outputs: { Register: { output: { registered: true } } }, execution_logger: silent_logger } };
        const runtime = new AwaRuntime(options);
        runtime.register_workflow(workflow).register_journey(journey);
        await runtime.publish(business_event('claim.submitted', { customer_id: 'C-9' }, { source: '/test', id: 'e-1' }));
        await until(() => exported.spans.some(s => s.name === 'journey Claim'));

        const instance = runtime.list_journey_instances(journey.id)[0];
        expect(instance.status).toBe('completed');
        const run_id = instance.runs[0].run_id;
        const journey_trace = exported.spans.filter(s => s.attributes['awa.journey.instance_id'] === instance.id);
        expect(journey_trace.map(s => s.name).sort()).toEqual(['journey Claim', 'run Intake', 'stage Intake']);
        expect(journey_trace).toEqual(journey_spans(instance.events));
        expect(journey_trace.find(s => s.name === 'run Intake')!.links).toEqual([{ trace_id: run_trace_id(run_id), span_id: run_span_id(run_id, 1) }]);
        // The run's own trace went out too, through the same exporter
        expect(exported.spans.some(s => s.trace_id === run_trace_id(run_id) && s.span_id === run_span_id(run_id, 1))).toBe(true);

        const count = exported.spans.length;
        const again = new AwaRuntime(options);
        again.register_workflow(workflow).register_journey(journey);
        await again.recover();
        await again.save();
        expect(exported.spans).toHaveLength(count);
    });
});

describe('The official OpenTelemetry SDK', () => {
    it('receives AWA spans as ReadableSpans, through any SpanExporter', async () => {
        const memory = new InMemorySpanExporter();
        const exporter = from_opentelemetry_exporter(memory);
        const spans = run_spans(claims(), journal_of('model-decision'));
        exporter.export(spans);
        await exporter.flush!();
        const finished = memory.getFinishedSpans();
        expect(finished.map(s => [s.spanContext().traceId, s.spanContext().spanId, s.parentSpanContext?.spanId, s.name]))
            .toEqual(spans.map(s => [s.trace_id, s.span_id, s.parent_span_id, s.name]));
        const chat = finished.find(s => s.name === 'chat classifier-small' && s.parentSpanContext?.spanId === spans.find(x => x.name === 'decision Settlement route')!.span_id)!;
        expect(chat.attributes[GEN_AI.USAGE_INPUT_TOKENS]).toBe(203);
        expect(chat.kind).toBe(2);                                    // SpanKind.CLIENT
        await exporter.shutdown!();
    });

    it('sends through the official OTLP exporter the same identifiers, names, times and attributes', async () => {
        const collector = await receiver();
        const exporter = from_opentelemetry_exporter(new OTLPTraceExporter({ url: `${collector.url}/v1/traces` }));
        const spans = run_spans(claims(), journal_of('completed'));
        exporter.export(spans);
        await exporter.flush!();
        await exporter.shutdown!();
        const theirs = collector.received.flatMap(r => spans_in(JSON.parse(r.body.toString('utf-8'))));
        const ours = spans_in(spans_to_otlp_json(spans));
        const shape = (s: any) => ({
            traceId: s.traceId, spanId: s.spanId, parentSpanId: s.parentSpanId || undefined, name: s.name, kind: s.kind,
            start: String(s.startTimeUnixNano), end: String(s.endTimeUnixNano), status: s.status?.code || 0,
            attributes: Object.fromEntries(s.attributes.map((a: any) => [a.key, JSON.stringify(Object.values(a.value)[0]).replace(/"(-?\d+)"/g, '$1')])),
            events: s.events.map((e: any) => e.name),
        });
        expect(theirs.map(shape)).toEqual(ours.map(shape));
    });
});

describe('Configuration from the environment', () => {
    it('sends nothing unless an endpoint is named, or when disabled', () => {
        expect(telemetry_from_env({})).toBeUndefined();
        expect(telemetry_from_env({ OTEL_EXPORTER_OTLP_ENDPOINT: 'http://c:4318', OTEL_SDK_DISABLED: 'true' })).toBeUndefined();
        expect(telemetry_from_env({ OTEL_EXPORTER_OTLP_ENDPOINT: 'http://c:4318', OTEL_TRACES_EXPORTER: 'none' })).toBeUndefined();
    });

    it('reads the endpoint, headers, protocol, timeout, compression, resource and batching', () => {
        const config = telemetry_from_env({
            OTEL_EXPORTER_OTLP_ENDPOINT: 'http://collector:4318',
            OTEL_EXPORTER_OTLP_TRACES_ENDPOINT: 'http://collector:4318/custom/traces',
            OTEL_EXPORTER_OTLP_HEADERS: 'authorization=Bearer%20abc,x-a=1',
            OTEL_EXPORTER_OTLP_TRACES_HEADERS: 'x-a=2',
            OTEL_EXPORTER_OTLP_PROTOCOL: 'http/json',
            OTEL_EXPORTER_OTLP_TRACES_TIMEOUT: '2500',
            OTEL_EXPORTER_OTLP_COMPRESSION: 'gzip',
            OTEL_SERVICE_NAME: 'claims-host',
            OTEL_RESOURCE_ATTRIBUTES: 'deployment.environment.name=prod,service.namespace=insurance',
            OTEL_BSP_MAX_EXPORT_BATCH_SIZE: '100',
            AWA_TELEMETRY_PAYLOADS: 'true',
        })!;
        expect(config).toMatchObject({
            traces_endpoint: 'http://collector:4318/custom/traces', endpoint: 'http://collector:4318',
            headers: { authorization: 'Bearer abc', 'x-a': '2' }, protocol: 'http/json', timeout_ms: 2500, compression: 'gzip',
            service_name: 'claims-host', resource: { 'deployment.environment.name': 'prod', 'service.namespace': 'insurance' },
            max_batch_size: 100, payloads: true,
        });
    });

    it('refuses gRPC and unknown exporters, and says why', () => {
        const warnings: string[] = [];
        expect(telemetry_from_env({ OTEL_EXPORTER_OTLP_ENDPOINT: 'http://c:4317', OTEL_EXPORTER_OTLP_PROTOCOL: 'grpc' }, warnings)).toBeUndefined();
        expect(telemetry_from_env({ OTEL_EXPORTER_OTLP_ENDPOINT: 'http://c:4318', OTEL_TRACES_EXPORTER: 'zipkin' }, warnings)).toBeUndefined();
        expect(warnings).toHaveLength(2);
        expect(warnings[0]).toMatch(/grpc.*not supported/);
    });

    it('appends the signal path to an endpoint unless it is there', () => {
        expect(signal_url('http://c:4318', 'traces')).toBe('http://c:4318/v1/traces');
        expect(signal_url('http://c:4318/otlp/', 'metrics')).toBe('http://c:4318/otlp/v1/metrics');
        expect(signal_url('http://c:4318/v1/traces', 'traces')).toBe('http://c:4318/v1/traces');
        expect(signal_url('http://c:4318/v1/traces', 'metrics')).toBe('http://c:4318/v1/metrics');
    });

    it('sends measures as gauges to /v1/metrics', async () => {
        const collector = await receiver();
        const input = JSON.parse(fs.readFileSync(path.join(ROOT, 'spec/conformance/measures', fs.readdirSync(path.join(ROOT, 'spec/conformance/measures'))[0]), 'utf-8'));
        const report = compute_measures(input.recorded, input.options);
        const exporter = new OtlpHttpExporter({ traces_url: `${collector.url}/v1/traces` });
        expect(await exporter.export_metrics(measures_to_gauges(report, MEASURES), report)).toBe(true);
        expect(collector.received[0].path).toBe('/v1/metrics');
        const metrics = decode_metrics(collector.received[0].body).resourceMetrics[0].scopeMetrics[0].metrics;
        expect(metrics.map((m: any) => m.name)).toContain('awa.workflow.success_rate');
    });
});

describe('The claims-settlement example', () => {
    it('exports each recorded run exactly as its committed OTLP file, which the Python SDK also reproduces', () => {
        const workflow = claims();
        for (const name of RUNS) {
            const events: JournalEvent[] = journal_of(name);
            const exported = spans_to_otlp_json(run_spans(workflow, events));
            const committed = JSON.parse(fs.readFileSync(path.join(EXAMPLE, 'telemetry', `${name}.otlp.json`), 'utf-8'));
            expect(exported, name).toEqual(committed);
        }
    });

    it('shows the run as operations would want it: model calls with usage, tool calls, retries and the failure', () => {
        const spans = run_spans(claims(), journal_of('failed-and-compensated'));
        const run = spans.find(s => s.name.startsWith('invoke_workflow'))!;
        expect(run.status).toEqual({ code: 'error', message: expect.stringMatching(/Bank rejected the transfer/) });
        expect(run.events.map(e => e.name)).toContain('activity.compensated');
        const chats = spans.filter(s => s.name.startsWith('chat '));
        expect(chats.map(s => s.attributes[GEN_AI.USAGE_INPUT_TOKENS])).toEqual([undefined, 2010, 950]);
        expect(spans.find(s => s.name === 'execute_tool transfer')!.status.code).toBe('error');
        for (const s of spans) expect(s.trace_id).toBe(run_trace_id(events_run('failed-and-compensated')));
    });
});

const events_run = (name: string) => journal_of(name)[0].run_id;

describe('awa telemetry export', () => {
    it('writes OTLP JSON to a file and sends to an endpoint', { timeout: 30_000 }, async () => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'awa-telemetry-'));
        const out = path.join(dir, 'run.json');
        const { telemetryCommand } = await import('../src/cli/commands/telemetry');
        const log = console.log;
        const said: string[] = [];
        console.log = (m: string) => said.push(m);
        try {
            await telemetryCommand.parseAsync(['export', path.join(EXAMPLE, 'claims-settlement.awa.json'), path.join(EXAMPLE, 'runs/completed.journal.jsonl'), '--file', out], { from: 'user' });
            expect(JSON.parse(fs.readFileSync(out, 'utf-8'))).toEqual(JSON.parse(fs.readFileSync(path.join(EXAMPLE, 'telemetry/completed.otlp.json'), 'utf-8')));
            const collector = await receiver();
            await telemetryCommand.parseAsync(['export', path.join(EXAMPLE, 'claims-settlement.awa.json'), path.join(EXAMPLE, 'runs/completed.journal.jsonl'),
                '--endpoint', collector.url, '--protocol', 'http/json', '--header', 'x-key=k1', '--payloads'], { from: 'user' });
            expect(collector.received[0].headers['x-key']).toBe('k1');
            const sent = spans_in(JSON.parse(collector.received[0].body.toString()));
            expect(sent).toHaveLength(21);
            expect(sent.some((s: any) => s.attributes.some((a: any) => a.key === 'gen_ai.tool.call.arguments'))).toBe(true);
        } finally { console.log = log; }
        expect(said.join('\n')).toMatch(/wrote 21 span\(s\)[\s\S]*sent 21 span\(s\)/);
    });
});
