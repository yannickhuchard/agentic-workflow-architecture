/**
 * Hosts that share a store (specification section 29): the PostgreSQL runtime
 * store, under several host objects in this process and several processes.
 *
 * The tests start a throwaway PostgreSQL (tests/postgres.ts) and are skipped,
 * saying why, where PostgreSQL is not installed.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { ChildProcess, execFileSync, spawn, spawnSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { AwaRuntime } from '../src/runtime/runtime';
import { BusinessEvent } from '../src/runtime/business_event';
import { JourneyDefinitionSchema } from '../src/runtime/journey';
import { parse_document } from '../src/validator';
import { PostgresRuntimeStore, PostgresRuntimeStoreOptions, RUNTIME_STORE_BOOTSTRAP, RUNTIME_STORE_MIGRATIONS, open_runtime_store } from '../src/runtime/postgres_store';
import { StoreConflict } from '../src/runtime/shared_store';
import { Actor } from '../src/runtime/actors/actor';
import { postgres_unavailable, start_postgres, TestPostgres } from './postgres';
import { CLAIM_WORKFLOW_ID, LoadActor, claim_journey, claim_workflow, deal, event, phase } from './fixtures/shared_store_load';

const SDK = path.resolve(__dirname, '..');
const ROOT = path.resolve(SDK, '../..');
const unavailable = postgres_unavailable();
if (unavailable) console.warn(`Shared store tests skipped: ${unavailable}`);
const suite = unavailable ? describe.skip : describe;
const quiet = { execution_logger: { log_execution: async () => { } }, sleep: async () => { } };
const actors = (actor: Actor) => ({ actors: { application: actor, ai_agent: actor, human: actor, robot: actor }, ...quiet });

/** Bundle a script of the tests so that a process of its own can run it */
function bundle(entry: string, name: string): string {
    const out = path.join(SDK, 'node_modules/.cache/awa-shared-store-test', name);
    execFileSync(path.join(SDK, 'node_modules/.bin/esbuild'), [path.join(SDK, entry), '--bundle', '--platform=node', '--format=cjs', '--packages=external', `--outfile=${out}`, '--log-level=error']);
    return out;
}

/** A host on the store, with the claim workflow and journey */
async function host(url: string, actor: Actor = new LoadActor(), options: PostgresRuntimeStoreOptions = {}): Promise<AwaRuntime> {
    return open_runtime_store(url, { engine: actors(actor) }, options);
}

async function with_definitions(url: string): Promise<void> {
    const store = await PostgresRuntimeStore.open(url);
    await store.add_definition(claim_workflow);
    await store.add_definition(claim_journey);
    await store.close();
}

/**
 * What every run of the store must satisfy whichever host wrote it: each event
 * id accepted once, recorded at most once on a journey, and every journal and
 * journey record numbered from 1 without a gap. Returns what it counted.
 */
async function audit(url: string) {
    const { Client } = await import('pg');
    const client = new Client({ connectionString: url });
    await client.connect();
    try {
        const q = async (sql: string) => (await client.query(sql)).rows;
        const gaps = await q(`SELECT run_id FROM awa_runtime.journal_events GROUP BY run_id HAVING MAX(seq) <> COUNT(*) OR MIN(seq) <> 1`);
        const journey_gaps = await q(`SELECT journey_instance_id FROM awa_runtime.journey_events GROUP BY journey_instance_id HAVING MAX(seq) <> COUNT(*) OR MIN(seq) <> 1`);
        // The rows of journey events and the record each instance keeps must say the same
        const projection = await q(`SELECT i.id FROM awa_runtime.journey_instances i
            WHERE jsonb_array_length(i.document->'events') <> (SELECT COUNT(*) FROM awa_runtime.journey_events e WHERE e.journey_instance_id = i.id)`);
        const recorded_twice = await q(`SELECT journey_instance_id, data->>'event_id' AS event_id, COUNT(*) FROM awa_runtime.journey_events
            WHERE type = 'journey.event_received' GROUP BY 1, 2 HAVING COUNT(*) > 1`);
        const delivered_twice = await q(`SELECT run_id, data->>'event_id', COUNT(*) FROM awa_runtime.journal_events WHERE type = 'event.received' GROUP BY 1, 2 HAVING COUNT(*) > 1`);
        const two_active = await q(`SELECT journey_id, subject_key FROM awa_runtime.journey_instances WHERE status = 'active' GROUP BY 1, 2 HAVING COUNT(*) > 1`);
        const counts = (await q(`SELECT (SELECT COUNT(*) FROM awa_runtime.business_events)::int AS accepted, (SELECT COUNT(*) FROM awa_runtime.journal_events)::int AS journal_events,
            (SELECT COUNT(*) FROM awa_runtime.journey_events)::int AS journey_events, (SELECT COUNT(*) FROM awa_runtime.runs)::int AS runs`))[0];
        expect(gaps, 'journals with a gap').toEqual([]);
        expect(journey_gaps, 'journey records with a gap').toEqual([]);
        expect(projection, 'journey records whose rows differ from the instance').toEqual([]);
        expect(recorded_twice, 'events recorded twice on a journey').toEqual([]);
        expect(delivered_twice, 'events delivered twice to a run').toEqual([]);
        expect(two_active, 'subjects with two active instances of one journey').toEqual([]);
        return { ...counts, duplicates: recorded_twice.length + delivered_twice.length };
    } finally { await client.end(); }
}

/** The journey record of every subject, as the store keeps it */
async function records(url: string) {
    const reader = await host(url);
    await reader.refresh();
    const instances = reader.list_journey_instances();
    await reader.close();
    return instances;
}

suite('PostgreSQL runtime store (spec 29)', () => {
    let server: TestPostgres;
    beforeAll(async () => { server = await start_postgres(); }, 60_000);
    afterAll(async () => { await server?.stop(); });

    it('creates its tables by migrations, once, and refuses a store migrated by a newer SDK', async () => {
        const url = await server.database();
        await (await PostgresRuntimeStore.open(url)).close();
        // Several hosts starting at once migrate once between them
        await Promise.all([1, 2, 3].map(async () => (await PostgresRuntimeStore.open(url)).close()));
        const { Client } = await import('pg');
        const client = new Client({ connectionString: url });
        await client.connect();
        expect((await client.query('SELECT version FROM awa_runtime.migrations')).rows).toEqual([{ version: 1 }]);
        await client.query(`INSERT INTO awa_runtime.migrations (version, description, applied_by) VALUES (99, 'from the future', 'test')`);
        await client.end();
        await expect(PostgresRuntimeStore.open(url)).rejects.toThrow(/version 99, newer than this SDK knows/);
    });

    it('has the tables of spec/ddl/awa.postgresql.sql, statement for statement', () => {
        const normal = (sql: string) => sql.replace(/--[^\n]*/g, '').replace(/\s+/g, ' ').trim();
        const ddl = normal(fs.readFileSync(path.join(ROOT, 'spec/ddl/awa.postgresql.sql'), 'utf-8'));
        const statements = [RUNTIME_STORE_BOOTSTRAP, ...RUNTIME_STORE_MIGRATIONS.map(m => m.sql)].flatMap(sql => sql.split(';')).map(normal).filter(Boolean);
        for (const statement of statements) expect(ddl, statement).toContain(statement);
    });

    it('refuses a URL that is not PostgreSQL, and a host that lacks a definition the store needs', async () => {
        await expect(open_runtime_store('/var/lib/awa')).rejects.toThrow(/PostgreSQL URL/);
        const url = await server.database();
        await with_definitions(url);
        const first = await host(url);
        await first.publish(event('claim.submitted', 'c-1', 'e-1'));
        await first.close();

        const store = await PostgresRuntimeStore.open(url);
        const lacking = new AwaRuntime({ shared: store, engine: quiet });
        await expect(lacking.recover()).rejects.toThrow(/needs workflow .*journey .*which this host has not registered/);
        // A host that skipped the check still does not touch what it cannot continue: nothing is kept
        await expect(lacking.publish(event('documents.uploaded', 'c-1', 'e-2'))).rejects.toThrow(/not registered on this host/);
        expect((await store.stats()).accepted_events).toBe(1);
        await store.close();
    });

    it('refuses to keep a row another host changed meanwhile, and begins the operation again', async () => {
        const url = await server.database();
        await with_definitions(url);
        const a = await host(url);
        await a.publish(event('claim.submitted', 'c-1', 'e-1'));
        const { Client } = await import('pg');
        const meddler = new Client({ connectionString: url });
        await meddler.connect();
        /** A store whose operations find the subject's instance changed by someone else once, right after loading it */
        const meddled_store = async (attempts?: number) => {
            const store = await PostgresRuntimeStore.open(url, { attempts });
            let meddled = false;
            const operation = store.operation.bind(store);
            store.operation = work => operation(async unit => {
                const load = unit.load.bind(unit);
                unit.load = async partitions => {
                    const loaded = await load(partitions);
                    if (!meddled) { meddled = true; await meddler.query('UPDATE awa_runtime.journey_instances SET version = version + 1'); }
                    return loaded;
                };
                return work(unit);
            });
            const runtime = new AwaRuntime({ shared: store, engine: actors(new LoadActor()) });
            runtime.register_workflow(parse_document(claim_workflow)).register_journey(JourneyDefinitionSchema.parse(claim_journey));
            return { store, runtime };
        };
        // Without trying again, an operation that finds its row changed under it fails with StoreConflict, keeping nothing
        const strict = await meddled_store(1);
        await expect(strict.runtime.publish(event('note.added', 'c-1', 'e-2'))).rejects.toBeInstanceOf(StoreConflict);
        // By default it is begun again, and the second attempt loads what is there
        const patient = await meddled_store();
        expect((await patient.runtime.publish(event('note.added', 'c-1', 'e-3'))).accepted).toBe(true);
        await meddler.end(); await strict.store.close(); await patient.store.close(); await a.close();
        const [claim] = await records(url);
        expect(claim.events.filter(e => e.type === 'journey.event_received').map(e => (e.data as { event_id: string }).event_id)).toEqual(['e-1', 'e-3']);
        await audit(url);
    });

    it('several host objects take a burst of events and ticks at once: each event applied once, every record without a gap', async () => {
        const url = await server.database();
        await with_definitions(url);
        const HOSTS = 6, SUBJECTS = 24, NOTES = 4;
        const hosts = await Promise.all(Array.from({ length: HOSTS }, (_, n) => host(url, new LoadActor(), { host_id: `host-${n}`, max_connections: 2 })));
        let given = 0, accepted = 0, refused = 0;
        const run_phase = async (events: BusinessEvent[]) => {
            const queues = deal(events, HOSTS, 3);
            given += queues.flat().length;
            await Promise.all(queues.map(async (queue, h) => {
                for (const [n, e] of queue.entries()) {
                    if ((await hosts[h].publish(e)).accepted) accepted++; else refused++;
                    if (n % 5 === 0) await hosts[h].tick();
                }
            }));
        };
        await run_phase(phase('submit', SUBJECTS, NOTES));
        await run_phase(phase('notes', SUBJECTS, NOTES));
        await run_phase(phase('documents', SUBJECTS, NOTES));
        await Promise.all(hosts.map(h => h.tick()));
        await Promise.all(hosts.map(h => h.close()));

        const distinct = SUBJECTS * (2 + NOTES);
        expect(accepted).toBe(distinct);
        expect(refused).toBe(given - distinct);
        const counts = await audit(url);
        expect(counts.accepted).toBe(distinct);
        const instances = await records(url);
        expect(instances).toHaveLength(SUBJECTS);
        for (const i of instances) {
            const types = i.events.map(e => e.type);
            expect(types.filter(t => t === 'journey.started')).toHaveLength(1);
            expect(types.filter(t => t === 'journey.event_received')).toHaveLength(2 + NOTES);
            expect(types.filter(t => t === 'journey.touchpoint')).toHaveLength(NOTES);
            expect(types.filter(t => t === 'journey.stalled').length).toBeLessThanOrEqual(1);
            expect(i.status).toBe('completed');
            expect(i.runs.map(r => r.status)).toEqual(['completed']);
        }
        console.log(`[shared store, one process] ${HOSTS} hosts, ${given} deliveries of ${distinct} events (${given - distinct} duplicates), ${accepted} accepted, ${counts.journal_events} journal events, ${counts.journey_events} journey events, ${counts.duplicates} applied twice`);
    }, 120_000);

    it('several processes take a burst of events and ticks at once: each event applied once, every record without a gap', async () => {
        const url = await server.database();
        await with_definitions(url);
        const worker = bundle('tests/fixtures/shared_store_worker.ts', 'worker.cjs');
        const PROCESSES = 4, SUBJECTS = 30, NOTES = 3;
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'awa-shared-'));
        const outcomes: { accepted: string[]; refused: string[]; failures: unknown[]; timed_out: number }[] = [];
        let given = 0;
        for (const name of ['submit', 'notes', 'documents'] as const) {
            const queues = deal(phase(name, SUBJECTS, NOTES), PROCESSES, 2);
            given += queues.flat().length;
            outcomes.push(...await Promise.all(queues.map((queue, n) => {
                const plan = path.join(dir, `${name}-${n}.json`);
                fs.writeFileSync(plan, JSON.stringify({ url, host_id: `process-${n}`, queue, tick_every: 4 }));
                return new Promise<typeof outcomes[number]>((resolve, reject) => {
                    const child = spawn(process.execPath, [worker, plan], { cwd: SDK });
                    let out = '', err = '';
                    child.stdout.on('data', d => { out += d; });
                    child.stderr.on('data', d => { err += d; });
                    child.on('exit', code => code === 0 ? resolve(JSON.parse(out.trim().split('\n').pop()!)) : reject(new Error(`worker ${n} exited ${code}: ${err}`)));
                });
            })));
        }
        fs.rmSync(dir, { recursive: true, force: true });
        const accepted = outcomes.flatMap(o => o.accepted);
        const distinct = SUBJECTS * (2 + NOTES);
        expect(outcomes.flatMap(o => o.failures)).toEqual([]);
        expect(new Set(accepted).size).toBe(accepted.length);       // no event accepted by two processes
        expect(accepted).toHaveLength(distinct);
        const counts = await audit(url);
        expect(counts.accepted).toBe(distinct);
        const instances = await records(url);
        expect(instances).toHaveLength(SUBJECTS);
        for (const i of instances) {
            expect(i.events.filter(e => e.type === 'journey.event_received')).toHaveLength(2 + NOTES);
            expect(i.status).toBe('completed');
        }
        console.log(`[shared store, ${PROCESSES} processes] ${given} deliveries of ${distinct} events (${given - distinct} duplicates), ${accepted.length} accepted, ${counts.journal_events} journal events, ${counts.duplicates} applied twice`);
    }, 120_000);

    it('a process killed in the middle of an operation keeps nothing, releases its subject at once, and another host takes the work over', async () => {
        const url = await server.database();
        await with_definitions(url);
        const worker = bundle('tests/fixtures/shared_store_worker.ts', 'worker.cjs');
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'awa-shared-'));
        const plan = path.join(dir, 'plan.json');
        fs.writeFileSync(plan, JSON.stringify({ url, host_id: 'doomed', queue: [event('claim.submitted', 'c-1', 'submit-1')], slow: { Register: 60_000 } }));
        const child: ChildProcess = spawn(process.execPath, [worker, plan], { cwd: SDK });
        // Wait until the doomed host is in the middle of its operation, holding the subject
        await new Promise<void>((resolve, reject) => {
            child.stdout!.on('data', d => { if (String(d).includes('HOLDING')) resolve(); });
            child.on('exit', code => reject(new Error(`worker exited ${code} before it held anything`)));
        });
        const survivor = await host(url, new LoadActor(), { host_id: 'survivor' });
        const started = Date.now();
        const waiting = survivor.publish(event('note.added', 'c-1', 'note-1'));
        await new Promise(resolve => setTimeout(resolve, 300));
        child.kill('SIGKILL');
        await waiting;
        const waited = Date.now() - started;
        expect(waited).toBeLessThan(10_000);
        // The doomed host's event was never acknowledged: the producer gives it again, to the survivor
        expect((await survivor.publish(event('claim.submitted', 'c-1', 'submit-1'))).accepted).toBe(true);
        expect((await survivor.publish(event('documents.uploaded', 'c-1', 'documents-1'))).accepted).toBe(true);
        await survivor.close();
        fs.rmSync(dir, { recursive: true, force: true });
        const counts = await audit(url);
        expect(counts).toMatchObject({ accepted: 3, runs: 1 });
        const [claim] = await records(url);
        expect(claim.status).toBe('completed');
        expect(claim.events.filter(e => e.type === 'journey.started')).toHaveLength(1);
        console.log(`[shared store, killed process] the survivor waited ${waited} ms for the killed host's subject; 3 events accepted once each`);
    }, 60_000);

    it('a host that hangs loses its partitions when its lease runs out, and keeps nothing', async () => {
        const url = await server.database();
        await with_definitions(url);
        const hanging = await host(url, new LoadActor({ Register: 4000 }), { host_id: 'hanging', lease_ms: 1000 });
        const other = await host(url, new LoadActor(), { host_id: 'other' });
        const stuck = hanging.publish(event('claim.submitted', 'c-1', 'submit-1'));
        const failed = stuck.then(() => 'kept', () => 'failed');
        await new Promise(resolve => setTimeout(resolve, 200));
        const started = Date.now();
        expect((await other.publish(event('note.added', 'c-1', 'note-1'))).accepted).toBe(true);
        expect(Date.now() - started).toBeLessThan(3500);
        expect(await failed).toBe('failed');
        expect((await other.publish(event('claim.submitted', 'c-1', 'submit-1'))).accepted).toBe(true);
        await hanging.close(); await other.close();
        expect(await audit(url)).toMatchObject({ accepted: 2, runs: 1 });
    }, 30_000);

    it('a person completes on one host a task a run waits for on another', async () => {
        const url = await server.database();
        const review = {
            id: '7d1e2f3a-4b5c-4d6e-8f70-81a2b3c4d5e6', name: 'Review', version: '1.0.0', awa_version: '1.1',
            activities: [{ id: '7d1e2f3a-4b5c-4d6e-8f70-000000000001', name: 'Approve', role_id: '7d1e2f3a-4b5c-4d6e-8f70-000000000009', actor_type: 'human' }], edges: [],
        };
        const journey = { ...claim_journey, id: '7d1e2f3a-4b5c-4d6e-8f70-000000000002', name: 'Review', stages: [{ id: 'open', name: 'Open', workflows: [review.id], complete_when: 'approved == true', transitions: [] }], triggers: [{ event: 'review.requested', starts_journey: true, start_workflow: review.id }], touchpoints: [] };
        const store = await PostgresRuntimeStore.open(url);
        await store.add_definition(review); await store.add_definition(journey); await store.close();
        const person: Actor = { execute: async () => ({ _requires_human_action: true, _human_task_id: 'task-1' }) };
        const a = await open_runtime_store(url, { engine: { ...actors(person), wait_for_human_tasks: true } });
        const b = await open_runtime_store(url, { engine: { ...actors(person), wait_for_human_tasks: true } });
        const result = await a.publish(event('review.requested', 'c-9', 'r-1'));
        const run_id = result.started_runs[0];
        await b.refresh();
        const token = b.get_run(run_id)!.getTokens().find(t => t.status === 'waiting')!;
        expect(await b.resume(run_id, token.id, { approved: true })).toBe(true);
        expect(await b.resume(run_id, token.id, { approved: true })).toBe(false);
        expect(await b.resume('no-such-run', token.id, {})).toBe(false);
        await a.close(); await b.close();
        const instances = await records(url);
        expect(instances.find(i => i.subject_key === 'c-9')).toMatchObject({ status: 'completed', data: { approved: true } });
        await audit(url);
    });

    it('awa journey works on the store named by --store or AWA_RUNTIME_STORE', async () => {
        const url = await server.database();
        const cli = bundle('src/cli/index.ts', 'cli.cjs');
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'awa-shared-cli-'));
        fs.writeFileSync(path.join(dir, 'workflow.json'), JSON.stringify(claim_workflow));
        fs.writeFileSync(path.join(dir, 'journey.json'), JSON.stringify(claim_journey));
        const awa = (args: string[], env: Record<string, string> = {}) => {
            const r = spawnSync(process.execPath, [cli, ...args], { cwd: dir, encoding: 'utf-8', env: { ...process.env, AWA_RUNTIME_STORE: '', ...env } });
            if (r.status !== 0) throw new Error(`awa ${args.join(' ')} failed: ${r.stderr}`);
            return r.stdout;
        };
        expect(awa(['journey', 'add', 'workflow.json', 'journey.json', '--store', url])).toMatch(/added workflow "Claim"[\s\S]*added journey "Claim"/);
        expect(awa(['journey', 'publish', 'claim.submitted', '-d', '{"customer_id":"c-1"}', '--id', 'cli-1', '--simulate'], { AWA_RUNTIME_STORE: url })).toMatch(/started 1/);
        expect(awa(['journey', 'publish', 'claim.submitted', '-d', '{"customer_id":"c-1"}', '--id', 'cli-1', '--store', url])).toMatch(/already taken in/);
        expect(awa(['journey', 'list'], { AWA_RUNTIME_STORE: url })).toMatch(/c-1\s+Claim\s+active/);
        expect(fs.existsSync(path.join(dir, '.awa'))).toBe(false);       // the runtime directory was not used
        fs.rmSync(dir, { recursive: true, force: true });
        expect(CLAIM_WORKFLOW_ID).toBe(claim_workflow.id);
    }, 60_000);
});
