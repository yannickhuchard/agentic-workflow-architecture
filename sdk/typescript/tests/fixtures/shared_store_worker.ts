/**
 * One host in a process of its own, for the shared store tests. Bundled and
 * started by tests/shared_store.test.ts as: node worker.cjs <plan.json>
 *
 * The plan names the store, the host, the events it is given in order, how
 * often it lets time pass, and which activities are slow. When a slow
 * activity begins the worker writes "HOLDING" on a line, so that the test can
 * stop it in the middle of that operation. At the end it writes one line of
 * JSON: what it accepted, what failed, and what its ticks did.
 */
import fs from 'fs';
import { open_runtime_store } from '../../src/runtime/postgres_store';
import { BusinessEvent } from '../../src/runtime/business_event';
import { LoadActor } from './shared_store_load';

interface Plan { url: string; host_id: string; queue: BusinessEvent[]; tick_every?: number; slow?: Record<string, number>; lease_ms?: number }

async function main(): Promise<void> {
    const plan = JSON.parse(fs.readFileSync(process.argv[2], 'utf-8')) as Plan;
    const actor = new LoadActor(plan.slow, () => process.stdout.write('HOLDING\n'));
    const runtime = await open_runtime_store(plan.url, {
        engine: { actors: { application: actor, ai_agent: actor, human: actor, robot: actor }, execution_logger: { log_execution: async () => { } }, sleep: async () => { } },
    }, { host_id: plan.host_id, lease_ms: plan.lease_ms });
    const accepted: string[] = [], refused: string[] = [], failures: { id: string; error: string }[] = [];
    let timed_out = 0, stalled = 0;
    for (const [n, event] of plan.queue.entries()) {
        try {
            if ((await runtime.publish(event)).accepted) accepted.push(event.id); else refused.push(event.id);
        } catch (error) {
            failures.push({ id: event.id, error: error instanceof Error ? error.message : String(error) });
        }
        if (plan.tick_every && n % plan.tick_every === 0) {
            const result = await runtime.tick();
            timed_out += result.timed_out_runs.length;
            stalled += result.stalled_journeys.length;
        }
    }
    await runtime.close();
    process.stdout.write(JSON.stringify({ host_id: plan.host_id, accepted, refused, failures, timed_out, stalled }) + '\n');
}

main().catch(error => { process.stderr.write(String(error?.stack || error) + '\n'); process.exit(1); });
