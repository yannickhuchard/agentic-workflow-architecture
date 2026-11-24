import { Command } from 'commander';
import fs from 'fs/promises';
import path from 'path';
import { business_event } from '../../runtime/business_event';
import { AwaRuntime, add_definition, open_runtime_directory } from '../../runtime/runtime';
import { PostgresRuntimeStore, RUNTIME_STORE_VARIABLE, open_runtime_store } from '../../runtime/postgres_store';
import { JourneyInstance } from '../../runtime/journey';

/**
 * awa journey: journeys that outlive the command that touches them. Every
 * subcommand opens the runtime directory, or the shared runtime store named by
 * --store or AWA_RUNTIME_STORE, does one thing, and leaves the state there for
 * the next (specification 19.10 and 29).
 */
const read_json = async (file: string) => JSON.parse(await fs.readFile(path.resolve(process.cwd(), file), 'utf-8'));
const fail = (error: unknown): never => { console.error(error instanceof Error ? error.message : String(error)); process.exit(1); };

type Where = { dir: string; store?: string };
/** The shared store the command works on, if any: --store, or else AWA_RUNTIME_STORE */
const store_url = (options: Where) => options.store || process.env[RUNTIME_STORE_VARIABLE] || undefined;

async function open(options: Where & { simulate?: boolean; outputs?: string }, reading = false): Promise<AwaRuntime> {
    const engine = {
        simulate: options.simulate, simulated_outputs: options.outputs ? await read_json(options.outputs) : undefined,
        wait_for_human_tasks: true, execution_logger: { log_execution: async () => { } },
    };
    const url = store_url(options);
    if (!url) return open_runtime_directory(path.resolve(process.cwd(), options.dir), { engine });
    const runtime = await open_runtime_store(url, { engine });
    // A command that reports reads the whole store, as other hosts have left it
    if (reading) await runtime.refresh();
    return runtime;
}
const line = (i: JourneyInstance, journey: string) =>
    `${i.subject_key.padEnd(16)} ${journey.padEnd(20)} ${(i.stalled && i.status === 'active' ? 'stalled' : i.status).padEnd(10)} stage ${i.stage_id.padEnd(14)} ${i.sentiment === undefined ? '' : `mood ${i.sentiment}`}  ${i.id}`;

const STORE_HELP = 'A PostgreSQL runtime store shared by several hosts, as a URL (default: $AWA_RUNTIME_STORE). When given, --dir is not used';
const with_engine = (command: Command) => command
    .option('--dir <dir>', 'The runtime directory', '.awa')
    .option('--store <url>', STORE_HELP)
    .option('-s, --simulate', 'Simulate activities instead of calling models and tools')
    .option('--outputs <file>', 'With --simulate: JSON file giving what each activity returns, by activity name');

export const journeyCommand = new Command('journey').description('Run and inspect journeys kept in a runtime directory or a shared runtime store');

journeyCommand.command('add <files...>').description('Add workflows and journeys to the runtime directory or store')
    .option('--dir <dir>', 'The runtime directory', '.awa')
    .option('--store <url>', STORE_HELP)
    .action(async (files: string[], options) => {
        try {
            const documents = await Promise.all(files.map(read_json));
            const url = store_url(options);
            const store = url ? await PostgresRuntimeStore.open(url) : undefined;
            try {
                // Workflows first, so that a journey added in the same command finds them
                for (const document of [...documents.filter(d => !Array.isArray(d.stages)), ...documents.filter(d => Array.isArray(d.stages))]) {
                    const added = store ? await store.add_definition(document) : await add_definition(path.resolve(process.cwd(), options.dir), document);
                    console.log(`added ${added.kind} "${added.name}" (${added.id})`);
                }
            } finally { await store?.close(); }
            await (await open(options)).close();       // checks that every journey finds its workflows
        } catch (error) { fail(error); }
    });

with_engine(journeyCommand.command('publish <type>').description('Take in a business event: it wakes waiting runs, starts journeys and moves them on'))
    .option('-d, --data <json>', 'The event data, as a JSON object', '{}')
    .option('--source <source>', 'Who produced the event', '/cli')
    .option('--id <id>', 'The event id. Publishing the same id twice has no further effect')
    .action(async (type: string, options) => {
        try {
            const runtime = await open(options);
            const result = await runtime.publish(business_event(type, JSON.parse(options.data), { source: options.source, ...(options.id ? { id: options.id } : {}) }));
            if (!result.accepted) { await runtime.close(); return console.log('already taken in: nothing done'); }
            console.log(`resumed ${result.resumed_runs.length} run(s), started ${result.started_runs.length}, concerned ${result.journeys.length} journey(s)`);
            for (const id of result.journeys) { const i = runtime.get_journey_instance(id)!; console.log(line(i, runtime.list_journeys().find(j => j.id === i.journey_id)!.name)); }
            await runtime.close();
        } catch (error) { fail(error); }
    });

with_engine(journeyCommand.command('tick').description('Let time pass: deadlines that have run out take effect and journeys that have outstayed a stage are marked stalled'))
    .option('--at <time>', 'Act as if it were this time (ISO 8601). Default: now')
    .action(async options => {
        try {
            const runtime = await open(options);
            const result = await runtime.tick(options.at ? Date.parse(options.at) : undefined);
            console.log(`${result.timed_out_runs.length} wait(s) timed out, ${result.stalled_journeys.length} journey(s) newly stalled`);
            await runtime.close();
        } catch (error) { fail(error); }
    });

with_engine(journeyCommand.command('resume <run_id> <token_id>').description('Complete a task a run is waiting on a person for'))
    .option('-d, --data <json>', 'What the person decided, as a JSON object', '{}')
    .action(async (run_id: string, token_id: string, options) => {
        try {
            const runtime = await open(options);
            console.log(await runtime.resume(run_id, token_id, JSON.parse(options.data)) ? 'resumed' : 'no such waiting task');
            await runtime.close();
        } catch (error) { fail(error); }
    });

journeyCommand.command('list').description('List journey instances')
    .option('--dir <dir>', 'The runtime directory', '.awa')
    .option('--store <url>', STORE_HELP)
    .option('--stalled', 'Only those that need someone to act')
    .action(async options => {
        try {
            const runtime = await open(options, true);
            const names = new Map(runtime.list_journeys().map(j => [j.id, j.name]));
            const instances = runtime.list_journey_instances().filter(i => !options.stalled || (i.stalled && i.status === 'active'));
            await runtime.close();
            if (!instances.length) return console.log('no journeys');
            for (const i of instances) console.log(line(i, names.get(i.journey_id) || ''));
        } catch (error) { fail(error); }
    });

journeyCommand.command('show <subject>').description('The record of a subject\'s journeys, in order: subject key or instance id')
    .option('--dir <dir>', 'The runtime directory', '.awa')
    .option('--store <url>', STORE_HELP)
    .option('--json', 'Write the full record as JSON')
    .action(async (subject: string, options) => {
        try {
            const runtime = await open(options, true);
            const instances = runtime.list_journey_instances().filter(i => i.subject_key === subject || i.id === subject).sort((a, b) => a.started_at.localeCompare(b.started_at));
            if (!instances.length) throw new Error(`No journey for "${subject}"`);
            if (options.json) { const bundles = []; for (const i of instances) bundles.push(await runtime.export_journey(i.id)); await runtime.close(); return console.log(JSON.stringify(bundles, null, 2)); }
            await runtime.close();
            for (const i of instances) {
                console.log(`\n${runtime.list_journeys().find(j => j.id === i.journey_id)!.name}: ${i.status}${i.stalled && i.status === 'active' ? ' (stalled)' : ''}, goals reached: ${i.goals_reached.join(', ') || 'none'}`);
                for (const e of i.events) {
                    const d = e.data as Record<string, unknown>;
                    const what = d.name ?? d.stage_name ?? d.workflow_name ?? d.goal_name ?? d.reason ?? '';
                    const text = e.type === 'journey.sentiment_changed' ? `${d.previous} -> ${d.value} (${d.basis}${d.reason ? `: ${d.reason}` : ''})` : `${what}${d.status ? ` ${d.status}` : ''}`;
                    console.log(`  ${e.time.slice(0, 16).replace('T', ' ')}  ${e.type.replace('journey.', '').padEnd(18)} ${text}`);
                }
            }
        } catch (error) { fail(error); }
    });

journeyCommand.command('analytics').description('The funnel of each journey, and how subjects move between journeys')
    .option('--dir <dir>', 'The runtime directory', '.awa')
    .option('--store <url>', STORE_HELP)
    .action(async options => {
        try {
            const runtime = await open(options, true);
            await runtime.close();
            for (const journey of runtime.list_journeys()) {
                const a = runtime.analytics(journey.id);
                console.log(`\n${journey.name}: ${a.total} journeys, ${a.completed} completed, ${a.active} active, ${a.abandoned} abandoned`);
                for (const s of a.stages) console.log(`  ${s.stage_name.padEnd(24)} entered ${s.entered}, moved on ${s.completed}, here ${s.active}, stalled ${s.stalled}, left ${s.abandoned}`);
                for (const [goal, n] of Object.entries(a.goals)) console.log(`  goal ${goal}: ${n} of ${a.total}`);
            }
            const names = new Map(runtime.list_journeys().map(j => [j.id, j.name]));
            for (const t of runtime.transitions()) console.log(`\n${names.get(t.from)} -> ${names.get(t.to)}: ${t.count}`);
        } catch (error) { fail(error); }
    });

journeyCommand.command('export').description('Everything recorded, in one file: what tools/visualization/journey.html loads')
    .option('--dir <dir>', 'The runtime directory', '.awa')
    .option('--store <url>', STORE_HELP)
    .option('-o, --output <file>', 'Write to this file instead of standard output')
    .action(async options => {
        try {
            const runtime = await open(options);
            const text = JSON.stringify(await runtime.export_portfolio());
            await runtime.close();
            if (options.output) { await fs.writeFile(path.resolve(process.cwd(), options.output), text); console.log(`wrote ${options.output}`); } else console.log(text);
        } catch (error) { fail(error); }
    });
