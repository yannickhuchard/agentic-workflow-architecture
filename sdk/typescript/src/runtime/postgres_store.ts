/**
 * A runtime store in PostgreSQL (specification section 29)
 *
 * Several hosts, in several processes or on several machines, keep their
 * journeys and runs in one database. The store meets the contract of
 * shared_store.ts this way:
 *
 * - an operation is one transaction; what it changed is committed together
 *   with the journal events its runs recorded, or rolled back with them;
 * - a partition is held with a transaction-scoped advisory lock, so that a
 *   host that stops, or whose connection is lost, releases what it held at
 *   once; one that hangs releases it when its lease (an idle transaction
 *   timeout) runs out;
 * - an event is accepted by inserting its id, the primary key of
 *   business_events, in the operation's transaction: the same id inserted by
 *   another host waits for that host's transaction and is then refused;
 * - a row is written back only at the version that was loaded;
 * - deadlines are found by due_at, and their partitions held with
 *   pg_try_advisory_xact_lock, skipping those another operation holds.
 *
 * The tables are those of spec/ddl/awa.postgresql.sql, section "Runtime
 * store", created in schema awa_runtime by the migrations below.
 *
 * Needs the optional dependency `pg` (npm install pg).
 */

import os from 'os';
import { randomUUID } from 'crypto';
import { BusinessEvent } from './business_event';
import { JournalEvent, JournalStore } from './journal';
import { JourneyDefinitionSchema, JourneyInstance } from './journey';
import { AwaRuntime, RuntimeOptions, is_journey_document } from './runtime';
import { RunWait, SharedRuntimeStore, StoreConflict, StoreUnit, StoredInstance, StoredRun, SETTLED_STATUSES } from './shared_store';

/** The environment variable naming the shared runtime store. AWA_DATABASE_URL is another thing: the human task database. */
export const RUNTIME_STORE_VARIABLE = 'AWA_RUNTIME_STORE';

/**
 * The migrations the store runs, in order. Each is recorded in
 * awa_runtime.migrations once applied. The same statements are in
 * spec/ddl/awa.postgresql.sql, and the Python SDK runs the same ones.
 */
export const RUNTIME_STORE_MIGRATIONS: { version: number; description: string; sql: string }[] = [
    {
        version: 1,
        description: 'Runtime store: definitions, accepted events, journey instances and events, runs and journals',
        sql: `
CREATE TABLE awa_runtime.definitions (
    kind TEXT NOT NULL CHECK (kind IN ('workflow', 'journey')),
    id TEXT NOT NULL,
    name TEXT NOT NULL,
    version TEXT,
    document JSONB NOT NULL,
    added_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (kind, id)
);

CREATE TABLE awa_runtime.business_events (
    id TEXT PRIMARY KEY,
    source TEXT NOT NULL,
    type TEXT NOT NULL,
    subject TEXT,
    time TIMESTAMPTZ,
    data JSONB NOT NULL DEFAULT '{}',
    accepted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    accepted_by TEXT NOT NULL
);
CREATE INDEX business_events_type ON awa_runtime.business_events (type, accepted_at);

CREATE TABLE awa_runtime.journey_instances (
    id TEXT PRIMARY KEY,
    journey_id TEXT NOT NULL,
    subject_key TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('active', 'completed', 'abandoned')),
    stage_id TEXT NOT NULL,
    stalled BOOLEAN NOT NULL DEFAULT FALSE,
    started_at TIMESTAMPTZ NOT NULL,
    ended_at TIMESTAMPTZ,
    partition_key TEXT NOT NULL,
    due_at TIMESTAMPTZ,
    position BIGSERIAL NOT NULL,
    version INTEGER NOT NULL DEFAULT 1,
    document JSONB NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_by TEXT NOT NULL
);
CREATE UNIQUE INDEX journey_instances_active ON awa_runtime.journey_instances (journey_id, subject_key) WHERE status = 'active';
CREATE INDEX journey_instances_partition ON awa_runtime.journey_instances (partition_key);
CREATE INDEX journey_instances_due ON awa_runtime.journey_instances (due_at) WHERE due_at IS NOT NULL;

CREATE TABLE awa_runtime.journey_events (
    journey_instance_id TEXT NOT NULL REFERENCES awa_runtime.journey_instances(id) DEFERRABLE INITIALLY DEFERRED,
    seq INTEGER NOT NULL CHECK (seq >= 1),
    spec_version TEXT NOT NULL,
    journey_id TEXT NOT NULL,
    time TIMESTAMPTZ NOT NULL,
    type TEXT NOT NULL,
    stage_id TEXT,
    run_id TEXT,
    data JSONB NOT NULL DEFAULT '{}',
    PRIMARY KEY (journey_instance_id, seq)
);
CREATE INDEX journey_events_type ON awa_runtime.journey_events (journey_id, type, time);

CREATE TABLE awa_runtime.runs (
    id TEXT PRIMARY KEY,
    workflow_id TEXT NOT NULL,
    workflow_version TEXT,
    status TEXT NOT NULL,
    journey_instance_id TEXT REFERENCES awa_runtime.journey_instances(id) DEFERRABLE INITIALLY DEFERRED,
    partition_key TEXT NOT NULL,
    due_at TIMESTAMPTZ,
    waits_for TEXT[] NOT NULL DEFAULT '{}',
    waits JSONB NOT NULL DEFAULT '[]',
    outbox JSONB NOT NULL DEFAULT '[]',
    checkpoint JSONB NOT NULL,
    checkpoint_at TIMESTAMPTZ NOT NULL,
    started_at TIMESTAMPTZ NOT NULL,
    ended_at TIMESTAMPTZ,
    position BIGSERIAL NOT NULL,
    version INTEGER NOT NULL DEFAULT 1,
    updated_by TEXT NOT NULL
);
CREATE INDEX runs_partition ON awa_runtime.runs (partition_key) WHERE status NOT IN ('completed', 'failed', 'cancelled');
CREATE INDEX runs_waits_for ON awa_runtime.runs USING GIN (waits_for);
CREATE INDEX runs_due ON awa_runtime.runs (due_at) WHERE due_at IS NOT NULL;

CREATE TABLE awa_runtime.journal_events (
    run_id TEXT NOT NULL REFERENCES awa_runtime.runs(id) DEFERRABLE INITIALLY DEFERRED,
    seq INTEGER NOT NULL CHECK (seq >= 1),
    id TEXT NOT NULL UNIQUE,
    spec_version TEXT NOT NULL,
    time TIMESTAMPTZ NOT NULL,
    type TEXT NOT NULL,
    level TEXT NOT NULL DEFAULT 'execution' CHECK (level IN ('execution', 'reasoning', 'meta')),
    workflow_id TEXT NOT NULL,
    token_id TEXT,
    node_id TEXT,
    node_name TEXT,
    attempt INTEGER CHECK (attempt >= 1),
    data JSONB NOT NULL DEFAULT '{}',
    PRIMARY KEY (run_id, seq)
);
CREATE INDEX journal_events_type ON awa_runtime.journal_events (type);
`,
    },
    {
        version: 2,
        description: 'Every version of a workflow is kept, for the runs that started on it',
        sql: `
ALTER TABLE awa_runtime.definitions DROP CONSTRAINT definitions_pkey;
UPDATE awa_runtime.definitions SET version = '' WHERE version IS NULL OR kind = 'journey';
ALTER TABLE awa_runtime.definitions ALTER COLUMN version SET DEFAULT '';
ALTER TABLE awa_runtime.definitions ALTER COLUMN version SET NOT NULL;
ALTER TABLE awa_runtime.definitions ADD PRIMARY KEY (kind, id, version);
`,
    },
];

/** The statements that come before any migration: the schema and the record of migrations */
export const RUNTIME_STORE_BOOTSTRAP = `
CREATE SCHEMA IF NOT EXISTS awa_runtime;
CREATE TABLE IF NOT EXISTS awa_runtime.migrations (
    version INTEGER PRIMARY KEY,
    description TEXT NOT NULL,
    applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    applied_by TEXT NOT NULL
);
`;

export interface PostgresRuntimeStoreOptions {
    /** Who this host is, in what the store records. Default: host name, process id and a random suffix. */
    host_id?: string;
    /**
     * How long an operation may keep its partitions while the store hears nothing from it, in
     * milliseconds. Past it, the database ends the operation and releases them, and nothing the
     * operation did is kept. Default five minutes: longer than any one activity should take.
     */
    lease_ms?: number;
    /** How many times an operation that met another host's is begun again before it fails. Default 30. */
    attempts?: number;
    /** Connections this host keeps open. Default 4. */
    max_connections?: number;
    /** Called just before an operation is kept. Tests use it to stop a host in the middle of an operation. */
    before_commit?: () => Promise<void> | void;
}

interface Client {
    query(text: string, values?: unknown[]): Promise<{ rows: Record<string, unknown>[]; rowCount: number | null }>;
    release(destroy?: boolean | Error): void;
    on(event: 'error', listener: (error: Error) => void): void;
    off(event: 'error', listener: (error: Error) => void): void;
}
/** A connection the server ends while in use fails the query under way; it must not also end the process */
const ignore = () => { };
async function connect(pool: Pool): Promise<Client> {
    const client = await pool.connect();
    client.on('error', ignore);
    return client;
}
function release(client: Client, destroy = false): void {
    client.off('error', ignore);
    client.release(destroy);
}
interface Pool {
    connect(): Promise<Client>;
    query(text: string, values?: unknown[]): Promise<{ rows: Record<string, unknown>[]; rowCount: number | null }>;
    end(): Promise<void>;
    on(event: string, listener: (...args: unknown[]) => void): void;
}

/** Errors after which an operation is begun again: it met another host's operation */
const RETRYABLE = new Set(['40001', '40P01', '23505', '55P03']);
const iso = (ms: number | null) => (ms === null ? null : new Date(ms).toISOString());
const time_text = (column: string) => `to_char(${column} AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`;
const valid_time = (text: unknown) => (typeof text === 'string' && !isNaN(Date.parse(text)) ? new Date(Date.parse(text)).toISOString() : null);

const JOURNAL_COLUMNS = `run_id, seq, id, spec_version, ${time_text('time')} AS time, type, level, workflow_id, token_id, node_id, node_name, attempt, data`;
function journal_event(row: Record<string, unknown>): JournalEvent {
    const event: Record<string, unknown> = {
        spec_version: row.spec_version, id: row.id, run_id: row.run_id, seq: Number(row.seq), time: row.time, type: row.type, level: row.level, workflow_id: row.workflow_id,
    };
    for (const key of ['token_id', 'node_id', 'node_name']) if (row[key] !== null && row[key] !== undefined) event[key] = row[key];
    if (row.attempt !== null && row.attempt !== undefined) event.attempt = Number(row.attempt);
    event.data = row.data ?? {};
    return event as unknown as JournalEvent;
}

async function read_journal(client: Pick<Client, 'query'>, run_id: string, after_seq: number): Promise<JournalEvent[]> {
    const { rows } = await client.query(`SELECT ${JOURNAL_COLUMNS} FROM awa_runtime.journal_events WHERE run_id = $1 AND seq > $2 ORDER BY seq`, [run_id, after_seq]);
    return rows.map(journal_event);
}

function stored_run(row: Record<string, unknown>): StoredRun {
    return {
        run_id: String(row.id), workflow_id: String(row.workflow_id), ...(row.journey_instance_id ? { journey_instance_id: String(row.journey_instance_id) } : {}),
        state: row.checkpoint as StoredRun['state'], outbox: (row.outbox as BusinessEvent[]) || [], partition: String(row.partition_key),
        due_at: row.due_at ? new Date(row.due_at as string).getTime() : null, waits_for: (row.waits_for as string[]) || [], waits: (row.waits as RunWait[]) || [], version: Number(row.version),
    };
}

/** One operation: one transaction on one connection */
class PostgresUnit implements StoreUnit {
    /** A journal write that failed. The operation is not kept. */
    failure?: unknown;
    constructor(private client: Client, private host_id: string) { }

    async accept(event: BusinessEvent): Promise<boolean> {
        const result = await this.client.query(
            `INSERT INTO awa_runtime.business_events (id, source, type, subject, time, data, accepted_by) VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7) ON CONFLICT (id) DO NOTHING`,
            [event.id, event.source || '', event.type, event.subject ?? null, valid_time(event.time), JSON.stringify(event.data ?? {}), this.host_id]);
        return result.rowCount === 1;
    }

    async hold(partitions: string[]): Promise<void> {
        for (const partition of partitions) await this.client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [`awa:${partition}`]);
    }

    async try_hold(partition: string): Promise<boolean> {
        const { rows } = await this.client.query('SELECT pg_try_advisory_xact_lock(hashtextextended($1, 0)) AS held', [`awa:${partition}`]);
        return rows[0].held === true;
    }

    async lock_waits(keys: string[], mode: 'shared' | 'exclusive'): Promise<void> {
        const lock = mode === 'shared' ? 'pg_advisory_xact_lock_shared' : 'pg_advisory_xact_lock';
        for (const key of keys) await this.client.query(`SELECT ${lock}(hashtextextended($1, 0))`, [`awa:${key}`]);
    }

    async waiting_for(type: string): Promise<{ partition: string; waits: RunWait[] }[]> {
        const { rows } = await this.client.query('SELECT partition_key, waits FROM awa_runtime.runs WHERE waits_for @> ARRAY[$1]::text[]', [type]);
        return rows.map(r => ({ partition: String(r.partition_key), waits: (r.waits as RunWait[]) || [] }));
    }

    async due(now: number): Promise<string[]> {
        const { rows } = await this.client.query(
            `SELECT partition_key FROM awa_runtime.runs WHERE due_at <= $1 UNION SELECT partition_key FROM awa_runtime.journey_instances WHERE due_at <= $1`, [new Date(now).toISOString()]);
        return rows.map(r => String(r.partition_key));
    }

    async partition_of_run(run_id: string): Promise<string | undefined> {
        const { rows } = await this.client.query('SELECT partition_key FROM awa_runtime.runs WHERE id = $1', [run_id]);
        return rows[0] ? String(rows[0].partition_key) : undefined;
    }

    async load(partitions: string[]): Promise<{ instances: StoredInstance[]; runs: StoredRun[] }> {
        const instances = await this.client.query('SELECT document, version, partition_key FROM awa_runtime.journey_instances WHERE partition_key = ANY($1) ORDER BY position', [partitions]);
        const runs = await this.client.query(
            `SELECT * FROM awa_runtime.runs WHERE partition_key = ANY($1) AND status NOT IN ('completed', 'failed', 'cancelled') ORDER BY position`, [partitions]);
        return {
            instances: instances.rows.map(r => {
                const instance = r.document as JourneyInstance;
                return { instance, partition: String(r.partition_key), due_at: null, version: Number(r.version), kept_events: instance.events.length };
            }),
            runs: runs.rows.map(stored_run),
        };
    }

    journal: JournalStore = {
        append: async (event: JournalEvent) => {
            try {
                await this.client.query(
                    `INSERT INTO awa_runtime.journal_events (run_id, seq, id, spec_version, time, type, level, workflow_id, token_id, node_id, node_name, attempt, data)
                     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13::jsonb)`,
                    [event.run_id, event.seq, event.id, event.spec_version, event.time, event.type, event.level, event.workflow_id,
                    event.token_id ?? null, event.node_id ?? null, event.node_name ?? null, event.attempt ?? null, JSON.stringify(event.data ?? {})]);
            } catch (error) {
                this.failure ??= error;
                throw error;
            }
        },
        read: (run_id: string, after_seq = 0) => read_journal(this.client, run_id, after_seq),
    };

    async write(instances: StoredInstance[], runs: StoredRun[]): Promise<void> {
        if (this.failure) throw this.failure;
        for (const kept of instances) {
            const i = kept.instance;
            const values = [i.id, i.journey_id, i.subject_key, i.status, i.stage_id, !!i.stalled, i.started_at, i.ended_at ?? null, kept.partition, iso(kept.due_at), JSON.stringify(i), this.host_id];
            if (kept.version === 0) {
                await this.client.query(
                    `INSERT INTO awa_runtime.journey_instances (id, journey_id, subject_key, status, stage_id, stalled, started_at, ended_at, partition_key, due_at, document, updated_by)
                     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::jsonb, $12)`, values);
            } else {
                const result = await this.client.query(
                    `UPDATE awa_runtime.journey_instances SET journey_id = $2, subject_key = $3, status = $4, stage_id = $5, stalled = $6, started_at = $7, ended_at = $8,
                     partition_key = $9, due_at = $10, document = $11::jsonb, updated_by = $12, updated_at = NOW(), version = version + 1 WHERE id = $1 AND version = $13`, [...values, kept.version]);
                if (result.rowCount !== 1) throw new StoreConflict(`Journey instance ${i.id} was changed by another host`);
            }
            for (const e of i.events.slice(kept.kept_events)) {
                await this.client.query(
                    `INSERT INTO awa_runtime.journey_events (journey_instance_id, seq, spec_version, journey_id, time, type, stage_id, run_id, data) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb)`,
                    [i.id, e.seq, e.spec_version, e.journey_id, e.time, e.type, e.stage_id ?? null, e.run_id ?? null, JSON.stringify(e.data ?? {})]);
            }
        }
        for (const run of runs) {
            const status = String(run.state.engine_status);
            const settled = SETTLED_STATUSES.includes(status);
            const stats = (run.state.metadata as { stats?: { startTime?: string } } | undefined)?.stats;
            const started = valid_time(stats?.startTime) ?? run.state.checkpoint_at;
            const values = [run.run_id, run.workflow_id, run.state.workflow_version ?? null, status, run.journey_instance_id ?? null, run.partition, iso(run.due_at), run.waits_for,
            JSON.stringify(run.outbox), JSON.stringify(run.state), run.state.checkpoint_at, settled ? run.state.checkpoint_at : null, this.host_id, JSON.stringify(run.waits)];
            if (run.version === 0) {
                await this.client.query(
                    `INSERT INTO awa_runtime.runs (id, workflow_id, workflow_version, status, journey_instance_id, partition_key, due_at, waits_for, outbox, checkpoint, checkpoint_at, ended_at, updated_by, waits, started_at)
                     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10::jsonb, $11, $12, $13, $14::jsonb, $15)`, [...values, started]);
            } else {
                const result = await this.client.query(
                    `UPDATE awa_runtime.runs SET workflow_id = $2, workflow_version = $3, status = $4, journey_instance_id = $5, partition_key = $6, due_at = $7, waits_for = $8,
                     outbox = $9::jsonb, checkpoint = $10::jsonb, checkpoint_at = $11, ended_at = $12, updated_by = $13, waits = $14::jsonb, version = version + 1 WHERE id = $1 AND version = $15`, [...values, run.version]);
                if (result.rowCount !== 1) throw new StoreConflict(`Run ${run.run_id} was changed by another host`);
            }
        }
    }
}

/**
 * Journeys and runs kept in PostgreSQL, for several hosts at once (spec 29).
 * Open it with PostgresRuntimeStore.open(url), which runs the migrations, and
 * give it to a host as `shared`, or use open_runtime_store(url).
 */
export class PostgresRuntimeStore implements SharedRuntimeStore {
    readonly host_id: string;
    private attempts: number;
    /** How many operations were begun again because they met another host's: a measure of contention */
    retries = 0;

    private constructor(private pool: Pool, private options: PostgresRuntimeStoreOptions) {
        this.host_id = options.host_id || `${os.hostname()}:${process.pid}:${randomUUID().slice(0, 8)}`;
        this.attempts = options.attempts ?? 30;
    }

    /** Connect to the database and bring its awa_runtime schema up to date */
    static async open(url: string, options: PostgresRuntimeStoreOptions = {}): Promise<PostgresRuntimeStore> {
        let pg: { Pool?: new (config: Record<string, unknown>) => Pool; default?: { Pool: new (config: Record<string, unknown>) => Pool } };
        try {
            pg = await import('pg') as typeof pg;
        } catch {
            throw new Error('The PostgreSQL runtime store needs the "pg" package, an optional dependency of this SDK: npm install pg');
        }
        const PoolClass = pg.default?.Pool ?? pg.Pool!;
        const lease = Math.max(1000, Math.round(options.lease_ms ?? 300_000));
        const pool = new PoolClass({ connectionString: url, max: options.max_connections ?? 4, options: `-c idle_in_transaction_session_timeout=${lease}` });
        // A connection the server ends while idle (the database restarting) must not end the host: the next operation reconnects
        pool.on('error', () => { });
        const store = new PostgresRuntimeStore(pool, options);
        try { await store.migrate(); } catch (error) { await pool.end(); throw error; }
        return store;
    }

    /** Apply the migrations not yet applied, one host at a time */
    private async migrate(): Promise<void> {
        const client = await connect(this.pool);
        try {
            await client.query(`SELECT pg_advisory_lock(hashtextextended('awa_runtime:migrations', 0))`);
            try {
                await client.query(RUNTIME_STORE_BOOTSTRAP);
                const applied = new Set((await client.query('SELECT version FROM awa_runtime.migrations')).rows.map(r => Number(r.version)));
                const known = Math.max(...RUNTIME_STORE_MIGRATIONS.map(m => m.version));
                const newest = Math.max(0, ...applied);
                if (newest > known) throw new Error(`The runtime store is at version ${newest}, newer than this SDK knows (${known}). Upgrade the SDK.`);
                for (const migration of RUNTIME_STORE_MIGRATIONS.filter(m => !applied.has(m.version))) {
                    await client.query('BEGIN');
                    try {
                        await client.query(migration.sql);
                        await client.query('INSERT INTO awa_runtime.migrations (version, description, applied_by) VALUES ($1, $2, $3)', [migration.version, migration.description, this.host_id]);
                        await client.query('COMMIT');
                    } catch (error) { await client.query('ROLLBACK'); throw error; }
                }
            } finally {
                await client.query(`SELECT pg_advisory_unlock(hashtextextended('awa_runtime:migrations', 0))`);
            }
        } finally { release(client); }
    }

    async operation<T>(work: (unit: StoreUnit) => Promise<T>): Promise<T> {
        for (let attempt = 1; ; attempt++) {
            const client = await connect(this.pool);
            let broken = false;
            try {
                await client.query('BEGIN');
                const unit = new PostgresUnit(client, this.host_id);
                const result = await work(unit);
                if (unit.failure) throw unit.failure;
                await this.options.before_commit?.();
                await client.query('COMMIT');
                return result;
            } catch (error) {
                try { await client.query('ROLLBACK'); } catch { broken = true; }
                const code = (error as { code?: string }).code;
                if (attempt < this.attempts && (error instanceof StoreConflict || (code && RETRYABLE.has(code)))) {
                    // Another host's operation was in the way: begin again, a little later, from what it kept
                    this.retries++;
                    await new Promise(resolve => setTimeout(resolve, Math.min(200, 5 * attempt) * Math.random()));
                    continue;
                }
                throw error;
            } finally {
                release(client, broken);
            }
        }
    }

    async read_all(): Promise<{ instances: JourneyInstance[]; runs: StoredRun[] }> {
        const instances = await this.pool.query('SELECT document FROM awa_runtime.journey_instances ORDER BY position');
        const runs = await this.pool.query('SELECT * FROM awa_runtime.runs ORDER BY position');
        return { instances: instances.rows.map(r => r.document as JourneyInstance), runs: runs.rows.map(stored_run) };
    }

    journal: JournalStore = {
        append: async () => { throw new Error('The journal of a shared store is written within operations only'); },
        read: (run_id: string, after_seq = 0) => read_journal(this.pool, run_id, after_seq),
    };

    async required_definitions(): Promise<{ workflows: string[]; journeys: string[]; instances: number; runs: number; workflow_versions: { id: string; version: string }[] }> {
        const workflows = await this.pool.query(`SELECT DISTINCT workflow_id FROM awa_runtime.runs WHERE status NOT IN ('completed', 'failed', 'cancelled') ORDER BY workflow_id`);
        // Each version a run not yet settled is on (spec 25.1)
        const versions = await this.pool.query(
            `SELECT DISTINCT workflow_id, workflow_version FROM awa_runtime.runs WHERE status NOT IN ('completed', 'failed', 'cancelled') AND workflow_version IS NOT NULL ORDER BY workflow_id, workflow_version`);
        const journeys = await this.pool.query('SELECT DISTINCT journey_id FROM awa_runtime.journey_instances ORDER BY journey_id');
        const counts = await this.pool.query('SELECT (SELECT COUNT(*) FROM awa_runtime.journey_instances) AS instances, (SELECT COUNT(*) FROM awa_runtime.runs) AS runs');
        return {
            workflows: workflows.rows.map(r => String(r.workflow_id)), journeys: journeys.rows.map(r => String(r.journey_id)),
            workflow_versions: versions.rows.map(r => ({ id: String(r.workflow_id), version: String(r.workflow_version) })),
            instances: Number(counts.rows[0].instances), runs: Number(counts.rows[0].runs),
        };
    }

    async definitions(): Promise<Record<string, unknown>[]> {
        const { rows } = await this.pool.query(`SELECT document FROM awa_runtime.definitions ORDER BY CASE kind WHEN 'workflow' THEN 0 ELSE 1 END, added_at, id`);
        return rows.map(r => r.document as Record<string, unknown>);
    }

    async add_definition(document: Record<string, unknown>): Promise<{ kind: 'workflow' | 'journey'; id: string; name: string }> {
        const { parse_document } = await import('../validator');
        const journey = is_journey_document(document);
        const parsed = journey ? JourneyDefinitionSchema.parse(document) : parse_document(document);
        const kind = journey ? 'journey' : 'workflow';
        // Every version of a workflow is kept, for the runs that started on it; a journey is kept once (spec 25.1)
        await this.pool.query(
            `INSERT INTO awa_runtime.definitions (kind, id, name, version, document) VALUES ($1, $2, $3, $4, $5::jsonb)
             ON CONFLICT (kind, id, version) DO UPDATE SET name = EXCLUDED.name, document = EXCLUDED.document`,
            [kind, parsed.id, parsed.name, journey ? '' : (parsed as { version?: string }).version ?? '', JSON.stringify(document)]);
        return { kind, id: parsed.id, name: parsed.name };
    }

    /** How much the store holds: for operators and tests */
    async stats(): Promise<{ accepted_events: number; instances: number; runs: number; journal_events: number; journey_events: number }> {
        const { rows } = await this.pool.query(`SELECT
            (SELECT COUNT(*) FROM awa_runtime.business_events) AS accepted_events,
            (SELECT COUNT(*) FROM awa_runtime.journey_instances) AS instances,
            (SELECT COUNT(*) FROM awa_runtime.runs) AS runs,
            (SELECT COUNT(*) FROM awa_runtime.journal_events) AS journal_events,
            (SELECT COUNT(*) FROM awa_runtime.journey_events) AS journey_events`);
        const r = rows[0];
        return { accepted_events: Number(r.accepted_events), instances: Number(r.instances), runs: Number(r.runs), journal_events: Number(r.journal_events), journey_events: Number(r.journey_events) };
    }

    private closed = false;
    async close(): Promise<void> {
        if (this.closed) return;
        this.closed = true;
        await this.pool.end();
    }
}

/**
 * A host on a shared PostgreSQL store, with the workflows and journeys the store
 * keeps registered (spec 29). Raises, and changes nothing, when the store keeps
 * work this host could not continue. Call close() on the host to release its
 * connections. Read methods show what the host's last operation held: call
 * refresh() first to read the whole store.
 */
export async function open_runtime_store(url: string, options: RuntimeOptions = {}, store_options: PostgresRuntimeStoreOptions = {}): Promise<AwaRuntime> {
    if (!/^postgres(ql)?:\/\//.test(url)) throw new Error(`A shared runtime store is a PostgreSQL URL (postgres://...), not "${url}"`);
    const { parse_document } = await import('../validator');
    const store = await PostgresRuntimeStore.open(url, store_options);
    try {
        const runtime = new AwaRuntime({ ...options, shared: store });
        const documents = await store.definitions();
        // Workflows first: a journey is checked against the workflows it names
        for (const document of documents.filter(d => !is_journey_document(d))) runtime.register_workflow(parse_document(document));
        for (const document of documents.filter(is_journey_document)) runtime.register_journey(JourneyDefinitionSchema.parse(document));
        await runtime.recover();
        runtime.close = () => store.close();
        return runtime;
    } catch (error) {
        await store.close();
        throw error;
    }
}
