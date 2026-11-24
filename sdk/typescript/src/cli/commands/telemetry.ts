import { Command } from 'commander';
import fs from 'fs/promises';
import path from 'path';
import { parse_document } from '../../validator';
import { JournalEvent, parse_journal } from '../../runtime/journal';
import { open_runtime_directory } from '../../runtime/runtime';
import { compute_measures, MEASURES, MeasureInput } from '../../runtime/kpi';
import {
    TelemetrySpan, TraceWorkflow, gauges_to_otlp_json, journey_spans, measures_to_gauges, run_spans, spans_to_otlp_json, telemetry_resource,
} from '../../runtime/telemetry';
import { OtlpProtocol, TelemetryConfig, otlp_exporter, telemetry_from_env } from '../../runtime/telemetry_export';

/**
 * awa telemetry: the record of runs and journeys as OpenTelemetry (specification 26).
 * Each subcommand writes OTLP JSON to a file, or sends OTLP to an endpoint: the one
 * given, else the one the OTEL_EXPORTER_OTLP_* variables name.
 */
const fail = (error: unknown): never => { console.error(error instanceof Error ? error.message : String(error)); process.exit(1); };
const read = async (file: string) => fs.readFile(path.resolve(process.cwd(), file), 'utf-8');

const collect = (value: string, previous: string[]) => [...previous, value];

const destination = (command: Command) => command
    .option('--endpoint <url>', 'Send OTLP over HTTP to this endpoint (/v1/traces or /v1/metrics is appended unless present)')
    .option('--file <out.json>', 'Write OTLP JSON to this file instead of sending it')
    .option('--protocol <protocol>', 'http/protobuf (default) or http/json')
    .option('--header <key=value>', 'A request header; may be repeated', collect, [])
    .option('--service-name <name>', 'The service.name of the resource', undefined)
    .option('--payloads', 'Put inputs, outputs and tool arguments on spans, as the journal holds them (26.6)');

interface DestinationOptions { endpoint?: string; file?: string; protocol?: string; header: string[]; serviceName?: string; payloads?: boolean }

/** Where to send: the options given, else the environment. Undefined when writing a file. */
function config_of(options: DestinationOptions): TelemetryConfig | undefined {
    if (options.file) return undefined;
    const warnings: string[] = [];
    const env = options.endpoint ? undefined : telemetry_from_env(process.env, warnings);
    for (const warning of warnings) console.error(warning);
    if (!options.endpoint && !env) throw new Error('Say where the telemetry goes: --endpoint <url>, --file <out.json>, or OTEL_EXPORTER_OTLP_ENDPOINT');
    const headers = Object.fromEntries(options.header.map(h => { const at = h.indexOf('='); if (at <= 0) throw new Error(`A header is key=value, not "${h}"`); return [h.slice(0, at).trim(), h.slice(at + 1).trim()]; }));
    const protocol = (options.protocol || env?.protocol || 'http/protobuf') as OtlpProtocol;
    if (protocol !== 'http/protobuf' && protocol !== 'http/json') throw new Error(`Protocol "${protocol}" is not supported: use http/protobuf or http/json`);
    return {
        ...(env || {}),
        ...(options.endpoint ? { endpoint: options.endpoint, traces_endpoint: undefined, metrics_endpoint: undefined } : {}),
        headers: { ...(env?.headers || {}), ...headers },
        protocol,
        ...(options.serviceName ? { service_name: options.serviceName } : {}),
    };
}

const payloads_of = (options: DestinationOptions) => options.payloads === true || (!options.payloads && process.env.AWA_TELEMETRY_PAYLOADS?.trim().toLowerCase() === 'true');

async function deliver_spans(spans: TelemetrySpan[], options: DestinationOptions, what: string): Promise<void> {
    const config = config_of(options);
    if (!config) {
        const resource = telemetry_resource({}, options.serviceName);
        await fs.writeFile(path.resolve(process.cwd(), options.file!), JSON.stringify(spans_to_otlp_json(spans, resource), null, 2) + '\n');
        console.log(`wrote ${spans.length} span(s) of ${what} to ${options.file}`);
        return;
    }
    const exporter = otlp_exporter(config, { on_warning: message => console.error(message), max_queue_size: Math.max(2048, spans.length) })!;
    exporter.export(spans);
    await exporter.shutdown();
    const stats = exporter.stats();
    if (stats.dropped) throw new Error(`${stats.dropped} of ${spans.length} span(s) could not be sent`);
    console.log(`sent ${stats.exported} span(s) of ${what}`);
}

/** The runs in a journal file, each with its events in order */
function runs_in(events: JournalEvent[]): Map<string, JournalEvent[]> {
    const runs = new Map<string, JournalEvent[]>();
    for (const event of events) {
        if (!runs.has(event.run_id)) runs.set(event.run_id, []);
        runs.get(event.run_id)!.push(event);
    }
    return runs;
}

export const telemetryCommand = new Command('telemetry').description('The record of runs and journeys as OpenTelemetry traces and metrics (specification 26)');

destination(telemetryCommand.command('export <workflow> <journal>')
    .description('Export the run(s) recorded in a journal as OpenTelemetry traces'))
    .action(async (workflow_file: string, journal_file: string, options: DestinationOptions) => {
        try {
            const workflow = parse_document(JSON.parse(await read(workflow_file)));
            const events = parse_journal(await read(journal_file));
            const runs = [...runs_in(events).entries()].filter(([, e]) => e[0]?.workflow_id === workflow.id);
            if (!runs.length) throw new Error(`The journal holds no run of workflow ${workflow.id}`);
            const spans = runs.flatMap(([, e]) => run_spans(workflow, e, { payloads: payloads_of(options) }));
            await deliver_spans(spans, options, runs.length === 1 ? `run ${runs[0][0]}` : `${runs.length} runs`);
        } catch (error) { fail(error); }
    });

const portfolio_source = (command: Command) => command
    .option('--dir <dir>', 'The runtime directory', '.awa')
    .option('--portfolio <file>', 'Read a portfolio exported with "awa journey export" instead of a runtime directory');

async function portfolio(options: { dir: string; portfolio?: string }): Promise<MeasureInput> {
    if (options.portfolio) return JSON.parse(await read(options.portfolio));
    const runtime = await open_runtime_directory(path.resolve(process.cwd(), options.dir), { engine: { execution_logger: { log_execution: async () => { } } } });
    try { return await runtime.export_portfolio() as unknown as MeasureInput; } finally { await runtime.close(); }
}

destination(portfolio_source(telemetryCommand.command('journeys')
    .description('Export every journey instance, and every run done for one, as OpenTelemetry traces')))
    .action(async (options: DestinationOptions & { dir: string; portfolio?: string }) => {
        try {
            const input = await portfolio(options) as unknown as {
                workflows: (TraceWorkflow & { id: string })[];
                journeys: { instances: { instance: { events: Parameters<typeof journey_spans>[0] }; runs: { run_id: string; workflow_id: string; events: JournalEvent[] }[] }[] }[];
            };
            const workflows = new Map(input.workflows.map(w => [w.id, w]));
            const payloads = payloads_of(options);
            const spans: TelemetrySpan[] = [];
            let instances = 0, runs = 0;
            for (const journey of input.journeys) {
                for (const { instance, runs: done } of journey.instances) {
                    instances++;
                    spans.push(...journey_spans(instance.events, { payloads }));
                    for (const run of done) {
                        if (!run.events.length) continue;
                        runs++;
                        spans.push(...run_spans(workflows.get(run.workflow_id) || {}, run.events, { payloads }));
                    }
                }
            }
            await deliver_spans(spans, options, `${instances} journey instance(s) and ${runs} run(s)`);
        } catch (error) { fail(error); }
    });

destination(portfolio_source(telemetryCommand.command('measures')
    .description('Send the measures of journeys and workflows as OpenTelemetry gauges (26.12)')))
    .option('--from <instant>', 'Keep what started at or after this instant')
    .option('--to <instant>', 'Keep what started before this instant')
    .action(async (options: DestinationOptions & { dir: string; portfolio?: string; from?: string; to?: string }) => {
        try {
            const report = compute_measures(await portfolio(options), { from: options.from, to: options.to });
            const gauges = measures_to_gauges(report, MEASURES);
            const points = gauges.reduce((n, g) => n + g.points.length, 0);
            const config = config_of(options);
            if (!config) {
                await fs.writeFile(path.resolve(process.cwd(), options.file!), JSON.stringify(gauges_to_otlp_json(gauges, report, telemetry_resource({}, options.serviceName)), null, 2) + '\n');
                console.log(`wrote ${gauges.length} gauge(s), ${points} data point(s), to ${options.file}`);
                return;
            }
            const exporter = otlp_exporter(config, { on_warning: message => console.error(message) })!;
            if (!await exporter.export_metrics(gauges, report)) throw new Error('The measures could not be sent');
            console.log(`sent ${gauges.length} gauge(s), ${points} data point(s)`);
        } catch (error) { fail(error); }
    });
