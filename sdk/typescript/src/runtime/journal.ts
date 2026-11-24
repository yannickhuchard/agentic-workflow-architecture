/**
 * AWA Execution Journal
 *
 * The append-only record of a run (specification section 9). Everything else
 * that explains a run is derived from it: live and replayed visualisation,
 * recovery after a crash, the recipe document, and distilled knowledge.
 */

import { createHash, randomUUID } from 'crypto';
import { UUID } from '../types';

export const JOURNAL_SPEC_VERSION = '1.1';

/**
 * Trace level of an event.
 * - execution: what happened
 * - reasoning: why an actor did what it did (its plan, rationale, alternatives)
 * - meta: why the engine handled the work the way it did (model choice,
 *   retries, escalation, routing)
 */
export type TraceLevel = 'execution' | 'reasoning' | 'meta';

export type JournalEventType =
    | 'run.started' | 'run.completed' | 'run.failed' | 'run.cancelled' | 'run.waiting' | 'run.resumed' | 'run.migrated'
    | 'token.created' | 'token.moved' | 'token.completed' | 'token.failed'
    | 'token.waiting' | 'token.resumed' | 'token.joined' | 'token.cancelled'
    | 'activity.started' | 'activity.completed' | 'activity.failed'
    | 'activity.retry_scheduled' | 'activity.dead_lettered'
    | 'activity.compensated' | 'activity.compensation_failed'
    | 'decision.evaluated'
    | 'tool.invoked' | 'tool.completed' | 'tool.failed'
    | 'agent.message_sent' | 'agent.task_updated'
    | 'verification.completed'
    | 'contract.checked' | 'contract.escalated'
    | 'timer.started' | 'timer.fired'
    | 'event.waiting' | 'event.received' | 'event.timed_out' | 'event.published'
    | 'reasoning.recorded'
    | 'meta.recorded'
    | 'knowledge.retrieved'
    | 'context.read' | 'context.written' | 'context.denied'
    | 'sla.warning' | 'sla.breached'
    | 'checkpoint.saved';

export interface JournalEvent {
    /** Version of the AWA specification the event conforms to */
    spec_version: string;
    /** Unique identifier of the event */
    id: UUID;
    /** The run this event belongs to */
    run_id: UUID;
    /** Position in the run, starting at 1, with no gaps */
    seq: number;
    /** When the event was recorded (RFC 3339, UTC) */
    time: string;
    type: JournalEventType;
    level: TraceLevel;
    workflow_id: UUID;
    token_id?: UUID;
    /** The activity, event or decision node concerned */
    node_id?: UUID;
    node_name?: string;
    /** Attempt number of the activity, starting at 1 */
    attempt?: number;
    /** Event-specific payload */
    data: Record<string, unknown>;
}

export type JournalEventInput = Omit<JournalEvent, 'spec_version' | 'id' | 'run_id' | 'seq' | 'time' | 'workflow_id' | 'level' | 'data'>
    & { level?: TraceLevel; data?: Record<string, unknown> };

export interface JournalStore {
    append(event: JournalEvent): Promise<void>;
    /** Events of a run in sequence order. `after_seq` returns only later events. */
    read(run_id: UUID, after_seq?: number): Promise<JournalEvent[]>;
}

export class InMemoryJournalStore implements JournalStore {
    private runs = new Map<UUID, JournalEvent[]>();

    async append(event: JournalEvent): Promise<void> {
        if (!this.runs.has(event.run_id)) this.runs.set(event.run_id, []);
        this.runs.get(event.run_id)!.push(event);
    }

    async read(run_id: UUID, after_seq = 0): Promise<JournalEvent[]> {
        return (this.runs.get(run_id) || []).filter(e => e.seq > after_seq);
    }
}

/**
 * Journal stored as JSON Lines: one event per line, appended in order.
 * This is the portable interchange format for journals (`*.journal.jsonl`).
 * With a directory, each run is written to `<run_id>.journal.jsonl`.
 * With a path ending in `.jsonl`, all events go to that one file.
 */
export class FileJournalStore implements JournalStore {
    constructor(private location: string) { }

    private file_for(run_id: UUID): string {
        return this.location.endsWith('.jsonl') ? this.location : `${this.location}/${run_id}.journal.jsonl`;
    }

    async append(event: JournalEvent): Promise<void> {
        const fs = await import('fs/promises');
        const path = await import('path');
        const file = this.file_for(event.run_id);
        await fs.mkdir(path.dirname(file), { recursive: true });
        await fs.appendFile(file, JSON.stringify(event) + '\n', 'utf-8');
    }

    async read(run_id: UUID, after_seq = 0): Promise<JournalEvent[]> {
        const fs = await import('fs/promises');
        try {
            const content = await fs.readFile(this.file_for(run_id), 'utf-8');
            return parse_journal(content).filter(e => e.run_id === run_id && e.seq > after_seq);
        } catch (error) {
            if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
            throw error;
        }
    }
}

/** Parse JSON Lines journal content. Blank lines are ignored. */
export function parse_journal(content: string): JournalEvent[] {
    return content.split('\n').filter(line => line.trim() !== '').map(line => JSON.parse(line) as JournalEvent);
}

/** How activity inputs and outputs are written to the journal */
export type PayloadMode = 'full' | 'hash' | 'none';

export function hash_payload(value: unknown): string {
    return createHash('sha256').update(canonical_json(value)).digest('hex');
}

/** JSON with object keys sorted at every depth, so equal values hash equally */
export function canonical_json(value: unknown): string {
    if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
    if (Array.isArray(value)) return `[${value.map(canonical_json).join(',')}]`;
    const entries = Object.keys(value as object).sort()
        .filter(k => (value as Record<string, unknown>)[k] !== undefined)
        .map(k => `${JSON.stringify(k)}:${canonical_json((value as Record<string, unknown>)[k])}`);
    return `{${entries.join(',')}}`;
}

/** Remove engine-reserved properties (prefixed with `_`) and the per-activity archive */
export function public_payload(data: Record<string, unknown>): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(data)) {
        if (!key.startsWith('_') && key !== 'activities') out[key] = value;
    }
    return out;
}

export type JournalListener = (event: JournalEvent) => void;

/**
 * Writes the journal of one run: assigns sequence numbers, applies the
 * payload mode, persists to the store and notifies live listeners.
 */
export class JournalWriter {
    private seq: number;
    private listeners = new Set<JournalListener>();
    private pending: Promise<void> = Promise.resolve();

    constructor(
        public readonly run_id: UUID,
        private workflow_id: UUID,
        private store: JournalStore,
        private payload_mode: PayloadMode = 'full',
        start_seq = 0,
        /** The clock events are stamped with. Defaults to the system clock. */
        private now: () => number = Date.now,
    ) {
        this.seq = start_seq;
    }

    get last_seq(): number { return this.seq; }

    subscribe(listener: JournalListener): () => void {
        this.listeners.add(listener);
        return () => this.listeners.delete(listener);
    }

    /** Represent a payload according to the configured payload mode */
    payload(value: unknown): unknown {
        if (this.payload_mode === 'full') return value;
        if (this.payload_mode === 'hash') return { sha256: hash_payload(value) };
        return undefined;
    }

    record(input: JournalEventInput): JournalEvent {
        const event: JournalEvent = {
            spec_version: JOURNAL_SPEC_VERSION,
            id: randomUUID(),
            run_id: this.run_id,
            seq: ++this.seq,
            time: new Date(this.now()).toISOString(),
            type: input.type,
            level: input.level || 'execution',
            workflow_id: this.workflow_id,
            ...(input.token_id ? { token_id: input.token_id } : {}),
            ...(input.node_id ? { node_id: input.node_id } : {}),
            ...(input.node_name ? { node_name: input.node_name } : {}),
            ...(input.attempt ? { attempt: input.attempt } : {}),
            data: input.data || {},
        };
        // Appends are chained so the store always sees events in sequence order
        this.pending = this.pending.then(() => this.store.append(event)).catch(error => {
            console.error('[Journal] Failed to persist event', event.seq, error);
        });
        for (const listener of this.listeners) {
            try { listener(event); } catch { /* a listener must not break the run */ }
        }
        return event;
    }

    /** Resolves when every recorded event has reached the store */
    async flush(): Promise<void> {
        await this.pending;
    }
}
