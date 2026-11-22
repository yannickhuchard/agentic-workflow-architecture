import { Command } from 'commander';
import fs from 'fs/promises';
import path from 'path';
import { business_event } from '../../runtime/business_event';
import { AwaRuntime, add_definition, open_runtime_directory } from '../../runtime/runtime';
import { JourneyInstance } from '../../runtime/journey';

/**
 * awa journey: journeys that outlive the command that touches them. Every
 * subcommand opens the runtime directory, does one thing, and leaves the state
 * on disk for the next (specification 19.10).
 */
const read_json = async (file: string) => JSON.parse(await fs.readFile(path.resolve(process.cwd(), file), 'utf-8'));
const fail = (error: unknown): never => { console.error(error instanceof Error ? error.message : String(error)); process.exit(1); };

async function open(options: { dir: string; simulate?: boolean; outputs?: string }): Promise<AwaRuntime> {
    return open_runtime_directory(path.resolve(process.cwd(), options.dir), {
        engine: {
            simulate: options.simulate, simulated_outputs: options.outputs ? await read_json(options.outputs) : undefined,
            wait_for_human_tasks: true, execution_logger: { log_execution: async () => { } },
        },
    });
}
const line = (i: JourneyInstance, journey: string) =>
    `${i.subject_key.padEnd(16)} ${journey.padEnd(20)} ${(i.stalled && i.status === 'active' ? 'stalled' : i.status).padEnd(10)} stage ${i.stage_id.padEnd(14)} ${i.sentiment === undefined ? '' : `mood ${i.sentiment}`}  ${i.id}`;

const with_engine = (command: Command) => command
    .option('--dir <dir>', 'The runtime directory', '.awa')
    .option('-s, --simulate', 'Simulate activities instead of calling models and tools')
    .option('--outputs <file>', 'With --simulate: JSON file giving what each activity returns, by activity name');

export const journeyCommand = new Command('journey').description('Run and inspect journeys kept in a runtime directory');

journeyCommand.command('add <files...>').description('Add workflows and journeys to the runtime directory')
    .option('--dir <dir>', 'The runtime directory', '.awa')
    .action(async (files: string[], options) => {
        try {
            const documents = await Promise.all(files.map(read_json));
            // Workflows first, so that a journey added in the same command finds them
            for (const document of [...documents.filter(d => !Array.isArray(d.stages)), ...documents.filter(d => Array.isArray(d.stages))]) {
                const added = await add_definition(path.resolve(process.cwd(), options.dir), document);
                console.log(`added ${added.kind} "${added.name}" (${added.id})`);
            }
            await open({ dir: options.dir });       // checks that every journey finds its workflows
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
            if (!result.accepted) return console.log('already taken in: nothing done');
            console.log(`resumed ${result.resumed_runs.length} run(s), started ${result.started_runs.length}, concerned ${result.journeys.length} journey(s)`);
            for (const id of result.journeys) { const i = runtime.get_journey_instance(id)!; console.log(line(i, runtime.list_journeys().find(j => j.id === i.journey_id)!.name)); }
        } catch (error) { fail(error); }
    });

with_engine(journeyCommand.command('tick').description('Let time pass: deadlines that have run out take effect and journeys that have outstayed a stage are marked stalled'))
    .option('--at <time>', 'Act as if it were this time (ISO 8601). Default: now')
    .action(async options => {
        try {
            const runtime = await open(options);
            const result = await runtime.tick(options.at ? Date.parse(options.at) : undefined);
            console.log(`${result.timed_out_runs.length} wait(s) timed out, ${result.stalled_journeys.length} journey(s) newly stalled`);
        } catch (error) { fail(error); }
    });

with_engine(journeyCommand.command('resume <run_id> <token_id>').description('Complete a task a run is waiting on a person for'))
    .option('-d, --data <json>', 'What the person decided, as a JSON object', '{}')
    .action(async (run_id: string, token_id: string, options) => {
        try {
            const runtime = await open(options);
            console.log(await runtime.resume(run_id, token_id, JSON.parse(options.data)) ? 'resumed' : 'no such waiting task');
        } catch (error) { fail(error); }
    });

journeyCommand.command('list').description('List journey instances')
    .option('--dir <dir>', 'The runtime directory', '.awa')
    .option('--stalled', 'Only those that need someone to act')
    .action(async options => {
        try {
            const runtime = await open(options);
            const names = new Map(runtime.list_journeys().map(j => [j.id, j.name]));
            const instances = runtime.list_journey_instances().filter(i => !options.stalled || (i.stalled && i.status === 'active'));
            if (!instances.length) return console.log('no journeys');
            for (const i of instances) console.log(line(i, names.get(i.journey_id) || ''));
        } catch (error) { fail(error); }
    });

journeyCommand.command('show <subject>').description('The record of a subject\'s journeys, in order: subject key or instance id')
    .option('--dir <dir>', 'The runtime directory', '.awa')
    .option('--json', 'Write the full record as JSON')
    .action(async (subject: string, options) => {
        try {
            const runtime = await open(options);
            const instances = runtime.list_journey_instances().filter(i => i.subject_key === subject || i.id === subject).sort((a, b) => a.started_at.localeCompare(b.started_at));
            if (!instances.length) throw new Error(`No journey for "${subject}"`);
            if (options.json) return console.log(JSON.stringify(await Promise.all(instances.map(i => runtime.export_journey(i.id))), null, 2));
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
    .action(async options => {
        try {
            const runtime = await open(options);
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
    .option('-o, --output <file>', 'Write to this file instead of standard output')
    .action(async options => {
        try {
            const text = JSON.stringify(await (await open(options)).export_portfolio());
            if (options.output) { await fs.writeFile(path.resolve(process.cwd(), options.output), text); console.log(`wrote ${options.output}`); } else console.log(text);
        } catch (error) { fail(error); }
    });
