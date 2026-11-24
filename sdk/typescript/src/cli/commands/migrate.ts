import { Command } from 'commander';
import fs from 'fs/promises';
import path from 'path';
import { AwaRuntime, MigrationCheck, open_runtime_directory } from '../../runtime/runtime';
import { RUNTIME_STORE_VARIABLE, open_runtime_store } from '../../runtime/postgres_store';
import { MigrationPlan, MigrationResult } from '../../runtime/migration';

/**
 * awa migrate: move runs that are at rest to another version of their workflow
 * (specification section 25). Works on a runtime directory, or on the shared
 * runtime store named by --store or AWA_RUNTIME_STORE, as `awa journey` does.
 *
 *   awa migrate check <workflow_id>   how each position of the older versions fares, and which runs can move
 *   awa migrate plan <run_id>         what moving the run would do (a dry run); changes nothing
 *   awa migrate apply <run_id...>     move the runs
 *
 * plan and apply exit with status 2 when a migration is refused.
 */
const fail = (error: unknown): never => { console.error(error instanceof Error ? error.message : String(error)); process.exit(1); };
const STORE_HELP = 'A PostgreSQL runtime store shared by several hosts, as a URL (default: $AWA_RUNTIME_STORE). When given, --dir is not used';

type Options = { dir: string; store?: string; plan?: string; to?: string; from?: string; json?: boolean };

async function open(options: Options): Promise<AwaRuntime> {
    const engine = { wait_for_human_tasks: true, execution_logger: { log_execution: async () => { } } };
    const url = options.store || process.env[RUNTIME_STORE_VARIABLE] || undefined;
    return url ? open_runtime_store(url, { engine }) : open_runtime_directory(path.resolve(process.cwd(), options.dir), { engine });
}

/** The plan: the file --plan names (a JSON object, section 25.3), with --to and --from over it */
async function read_plan(options: Options): Promise<MigrationPlan> {
    const plan: MigrationPlan = options.plan ? JSON.parse(await fs.readFile(path.resolve(process.cwd(), options.plan), 'utf-8')) : {};
    if (!plan || typeof plan !== 'object' || Array.isArray(plan)) throw new Error(`${options.plan} does not hold a migration plan (a JSON object)`);
    if (options.to) plan.to_version = options.to;
    if (options.from) plan.from_version = options.from;
    return plan;
}

const where = (command: Command) => command
    .option('--dir <dir>', 'The runtime directory', '.awa')
    .option('--store <url>', STORE_HELP)
    .option('--plan <file>', 'A migration plan: a JSON object with to_version, nodes (old node id -> new node id), restart and data')
    .option('--to <version>', 'The version to move to (default: the plan\'s to_version, or the newest registered)')
    .option('--json', 'Write the result as JSON');

function print_result(result: MigrationResult): void {
    const verb = result.applied ? 'moved' : result.refusals.length ? 'refused' : 'would move';
    console.log(`run ${result.run_id}: ${verb}${result.from_version ? ` from ${result.from_version}` : ''}${result.to_version ? ` to ${result.to_version}` : ''}${result.status && !result.refusals.length ? ` (${result.status})` : ''}`);
    for (const r of result.refusals) console.log(`  refused (${r.code}): ${r.message}`);
    for (const t of result.tokens.filter(t => t.wait)) console.log(`  token ${t.token_id}: ${t.from_node_name ?? t.from_node_id} -> ${t.to_node_name ?? t.to_node_id}, waits for ${t.wait}, ${t.outcome}`);
    for (const c of result.data_changes) console.log(`  data ${c.path}: ${c.change === 'removed' ? 'removed' : `set to ${JSON.stringify(c.value)}`}`);
}

function print_check(check: MigrationCheck): void {
    if (!check.comparisons.length) console.log(`No run of workflow ${check.workflow_id} is on a version other than ${check.to_version}.`);
    for (const c of check.comparisons) {
        console.log(`${c.from_version} -> ${c.to_version}: ${c.automatic ? 'every position is compatible' : 'some positions need a decision'}`);
        for (const p of c.positions) {
            const detail = p.class === 'compatible' ? `-> ${p.to_node_name} (${p.outcome})` : p.class === 'needs_mapping' ? `map it to one of: ${(p.candidates || []).map(n => n.node_name).join(', ')}` : `${p.reason}; only a restart can move a run here`;
            console.log(`  ${p.node_name.padEnd(24)} waits for ${p.wait.padEnd(6)} ${p.class.padEnd(14)} ${detail}`);
        }
    }
    for (const r of check.runs) {
        console.log(`run ${r.run_id} (${r.version}, ${r.status}): ${r.migratable ? 'can be moved' : `cannot be moved: ${r.refusals.map(x => x.code).join(', ')}`}`);
    }
}

export const migrateCommand = new Command('migrate').description('Move runs that are at rest to another version of their workflow (specification section 25)');

where(migrateCommand.command('check <workflow_id>').description('Compare the versions with live runs against the version to move to, position by position, and say which runs can move'))
    .option('--from <version>', 'Only runs on this version')
    .action(async (workflow_id: string, options: Options) => {
        try {
            const runtime = await open(options);
            try {
                const plan = await read_plan({ ...options, from: undefined });
                const check = await runtime.check_migration(workflow_id, { from_version: options.from, to_version: plan.to_version, plan });
                if (options.json) console.log(JSON.stringify(check, null, 2)); else print_check(check);
            } finally { await runtime.close(); }
        } catch (error) { fail(error); }
    });

where(migrateCommand.command('plan <run_id>').description('What moving the run would do: a dry run that changes nothing'))
    .action(async (run_id: string, options: Options) => {
        try {
            const runtime = await open(options);
            let result: MigrationResult;
            try { result = await runtime.migrate(run_id, await read_plan(options), { dry_run: true }); } finally { await runtime.close(); }
            if (options.json) console.log(JSON.stringify(result, null, 2)); else print_result(result);
            if (result.refusals.length) process.exitCode = 2;
        } catch (error) { fail(error); }
    });

where(migrateCommand.command('apply <run_ids...>').description('Move the runs, each as one change recorded in its journal as run.migrated'))
    .action(async (run_ids: string[], options: Options) => {
        try {
            const runtime = await open(options);
            const results: MigrationResult[] = [];
            try {
                const plan = await read_plan(options);
                for (const run_id of run_ids) results.push(await runtime.migrate(run_id, plan));
            } finally { await runtime.close(); }
            if (options.json) console.log(JSON.stringify(results.length === 1 ? results[0] : results, null, 2)); else results.forEach(print_result);
            if (results.some(r => r.refusals.length)) process.exitCode = 2;
        } catch (error) { fail(error); }
    });
