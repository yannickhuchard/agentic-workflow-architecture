/**
 * Hosts that share a store (specification section 29)
 *
 * A host of journeys and runs (AwaRuntime) can keep its state in a store that
 * several hosts use at once. The store divides what it keeps into partitions:
 * one per subject (every journey instance of a subject, and the runs started
 * for them) and one per run that belongs to no journey. Each operation of a
 * host is one unit of work in the store: it holds the partitions it reads or
 * changes, loads them as last kept, does its work on them alone, and keeps
 * what it changed, all or nothing. An event id is recorded as accepted in the
 * same unit, so that no event is ever taken twice.
 *
 * This file holds the contract a store meets (SharedRuntimeStore, StoreUnit)
 * and what a host does with it (SharedOperation). PostgresRuntimeStore in
 * postgres_store.ts is one such store.
 */

import { Workflow } from '../types';
import { BusinessEvent } from './business_event';
import { parse_iso_duration } from './duration_utils';
import { resolve_path } from './expression';
import { JournalEvent, JournalStore } from './journal';
import { JourneyDefinition, JourneyInstance } from './journey';
import { WorkflowState } from './persistence';
import { WorkflowEngine } from './workflow_engine';
import { is_child_state, nested_states } from './subworkflow';

/** Run statuses after which a run never changes again */
export const SETTLED_STATUSES = ['completed', 'failed', 'cancelled'];

/** A journey instance as a store keeps it */
export interface StoredInstance {
    instance: JourneyInstance;
    /** The partition it belongs to: its subject's */
    partition: string;
    /** When time next acts on it (a stage that may outlast its limit), in milliseconds; null when never */
    due_at: number | null;
    /** The version that was loaded; 0 for an instance this operation created */
    version: number;
    /** How many of its journey events were already kept */
    kept_events: number;
}

/** A run as a store keeps it: the state it can be continued from (10.3), and what the host needs to find it */
export interface StoredRun {
    run_id: string;
    workflow_id: string;
    journey_instance_id?: string;
    state: WorkflowState;
    /** Events the run published that were not yet accepted */
    outbox: BusinessEvent[];
    partition: string;
    /** When time next acts on it (a wait that may time out, a service level to check), in milliseconds; null when never */
    due_at: number | null;
    /** The business event types its waiting tokens wait for */
    waits_for: string[];
    /** What each waiting token waits for, with its correlation (18.3) */
    waits: RunWait[];
    version: number;
}

/** What one waiting token of a run waits for */
export interface RunWait { name: string; correlation_key?: string; correlation_value?: unknown }

/**
 * One operation of one host, as the store sees it. Everything it does is kept
 * when the operation ends well, and nothing of it otherwise.
 */
export interface StoreUnit {
    /** Record the event as accepted. False when its id is already on record: the event is not taken again. */
    accept(event: BusinessEvent): Promise<boolean>;
    /** Hold these partitions until the operation ends, waiting while another operation holds one */
    hold(partitions: string[]): Promise<void>;
    /** Hold this partition if no other operation does; false, at once, when one does */
    try_hold(partition: string): Promise<boolean>;
    /**
     * Hold these wait keys until the operation ends: shared by operations that look for the runs an event
     * may reach, exclusive for one that keeps a run newly waiting. So an event and a new wait for it are
     * never both unseen by one another (29.3).
     */
    lock_waits(keys: string[], mode: 'shared' | 'exclusive'): Promise<void>;
    /** The runs that wait for an event of this type: their partitions and what they wait for */
    waiting_for(type: string): Promise<{ partition: string; waits: RunWait[] }[]>;
    /** The partitions in which time acts at or before this instant */
    due(now: number): Promise<string[]>;
    /** The partition of a run, if the store knows it */
    partition_of_run(run_id: string): Promise<string | undefined>;
    /** What is kept in these partitions: their journey instances, and their runs that have not settled */
    load(partitions: string[]): Promise<{ instances: StoredInstance[]; runs: StoredRun[] }>;
    /** The journals of runs, written as part of the operation */
    journal: JournalStore;
    /** Keep these instances and runs. A version that is not the one on record means someone changed it meanwhile: the store refuses. */
    write(instances: StoredInstance[], runs: StoredRun[]): Promise<void>;
}

/** A store that several hosts may use at once (spec 29.1) */
export interface SharedRuntimeStore {
    /** Who this host is, in what the store records */
    readonly host_id: string;
    /** Do one operation as one unit. An operation that met another host's is begun again from the start. */
    operation<T>(work: (unit: StoreUnit) => Promise<T>): Promise<T>;
    /** Everything kept, as last kept, for reading. Nothing is held. */
    read_all(): Promise<{ instances: JourneyInstance[]; runs: StoredRun[] }>;
    /** The journals as kept, for reading */
    journal: JournalStore;
    /** The workflows and journeys that what is kept needs: a host that lacks one must not start (19.10) */
    required_definitions(): Promise<{ workflows: string[]; journeys: string[]; instances: number; runs: number; workflow_versions?: { id: string; version: string }[] }>;
    /** The workflow and journey documents kept in the store, workflows first */
    definitions(): Promise<Record<string, unknown>[]>;
    /** Keep a workflow or journey document in the store, replacing a journey with the same id or a workflow with the same id and version (spec 25.1) */
    add_definition(document: Record<string, unknown>): Promise<{ kind: 'workflow' | 'journey'; id: string; name: string }>;
    close(): Promise<void>;
}

/** A store refused to keep what an operation changed, because another changed it meanwhile. The operation is begun again. */
export class StoreConflict extends Error {
    constructor(message: string) { super(message); this.name = 'StoreConflict'; }
}

export const subject_partition = (subject_key: string): string => `subject:${subject_key}`;
export const run_partition = (run_id: string): string => `run:${run_id}`;

type SavedToken = { status?: string; activity_id?: string; context_data?: Record<string, unknown> };
type Awaited = { name?: string; due_at?: string; correlation_key?: string; correlation_value?: unknown };
const awaited = (token: SavedToken) => (token.status === 'waiting' ? token.context_data?._awaiting_event as Awaited | undefined : undefined);

/** The tokens of a run and of the child runs it holds (24.8): what the run waits for is what they wait for */
const all_tokens = (state: WorkflowState): SavedToken[] => [state, ...nested_states(state)].flatMap(s => s.tokens as SavedToken[]);

/** What a run's waiting tokens wait for, and its child runs' */
export function run_waits(state: WorkflowState): RunWait[] {
    return all_tokens(state).map(awaited).filter((a): a is Awaited & { name: string } => !!a?.name)
        .map(a => ({ name: a.name, ...(a.correlation_key ? { correlation_key: a.correlation_key, correlation_value: a.correlation_value } : {}) }));
}

/** The business event types a run's waiting tokens wait for */
export function run_waits_for(state: WorkflowState): string[] {
    return [...new Set(run_waits(state).map(w => w.name))].sort();
}

/** The key that orders a wait against the events that may reach it: its type, and its correlation if it has one */
export function wait_key(wait: RunWait): string {
    return wait.correlation_key ? `wait:${wait.name}:${wait.correlation_key}=${String(wait.correlation_value)}` : `wait:${wait.name}`;
}

/** The wait keys of every wait an event may reach, given the correlation keys the workflows use for its type */
export function event_wait_keys(event: BusinessEvent, workflows: Iterable<Workflow>): string[] {
    const keys = new Set([`wait:${event.type}`]);
    for (const workflow of workflows) {
        for (const node of workflow.events || []) {
            const definition = node.event_definition as { name?: string; correlation_key?: string } | undefined;
            if (node.event_type === 'message' && definition?.name === event.type && definition.correlation_key) {
                keys.add(wait_key({ name: event.type, correlation_key: definition.correlation_key, correlation_value: resolve_path(event.data || {}, definition.correlation_key) }));
            }
        }
    }
    return [...keys].sort();
}

/** Whether an event may reach a waiting token: as the engine decides it (18.3) */
export function may_reach(wait: RunWait, event: BusinessEvent): boolean {
    if (wait.name !== event.type) return false;
    return !wait.correlation_key || String(resolve_path(event.data || {}, wait.correlation_key)) === String(wait.correlation_value);
}

/**
 * When time next acts on a run. A run whose work is held to a service level is
 * due at every tick while it has not settled: the store reports it as due from
 * the epoch on.
 */
export function run_due(workflow: Workflow | undefined, state: WorkflowState, workflows?: Map<string, Workflow>): number | null {
    if (SETTLED_STATUSES.includes(String(state.engine_status))) return null;
    const tokens = all_tokens(state);
    if (tokens.some(t => t.status === 'active')) return 0;     // left in the middle of an activity: continued at the next tick
    const held = [workflow, ...nested_states(state).map(s => workflows?.get(s.workflow_id))];
    if (held.some(w => w && (w.sla || w.activities.some(a => a.sla)))) return 0;
    const deadlines = tokens.map(t => awaited(t)?.due_at).filter((d): d is string => !!d).map(d => Date.parse(d)).filter(d => !isNaN(d));
    return deadlines.length ? Math.min(...deadlines) : null;
}

/** When a journey instance's stage outlasts its limit, if it can */
export function instance_due(definition: JourneyDefinition | undefined, instance: JourneyInstance): number | null {
    if (!definition || instance.status !== 'active' || instance.stalled) return null;
    const stage = definition.stages.find(s => s.id === instance.stage_id);
    if (!stage?.max_duration) return null;
    try { return Date.parse(instance.stage_entered_at) + parse_iso_duration(stage.max_duration); } catch { return null; }
}

/** What a host lends an operation: its definitions, the maps of its working set, and how it rebuilds a run */
export interface HostView {
    workflows: Map<string, Workflow>;
    journeys: Map<string, JourneyDefinition>;
    /** journey id -> the event types that concern it (19.5) */
    concerns: Map<string, Set<string>>;
    instances: Map<string, JourneyInstance>;
    runs: Map<string, WorkflowEngine>;
    run_journey: Map<string, string>;
    outbox: Map<string, BusinessEvent[]>;
    /** Whether the host has registered this version of a workflow (the newest when none is named) (spec 25.1) */
    has_workflow?(id: string, version?: string): boolean;
    /** Every version of every workflow registered: their waits may all be live */
    all_workflows?(): Workflow[];
    /** Rebuild a kept run as part of the working set, journalling into the operation */
    adopt(saved: StoredRun): WorkflowEngine;
}

const run_text = (state: WorkflowState, outbox: BusinessEvent[]) => JSON.stringify({ ...state, checkpoint_at: undefined, outbox });

/**
 * One operation of a host on a shared store. The host's maps hold only the
 * partitions the operation holds; what the host reads, it has loaded fresh
 * under its hold, and what it changed is written back when the operation ends.
 */
export class SharedOperation {
    private held = new Set<string>();
    private kept_instances = new Map<string, { text: string; events: number; version: number }>();
    private kept_runs = new Map<string, { text: string; version: number; waits: string[] }>();

    constructor(readonly unit: StoreUnit, private view: HostView) { }

    /** How many journey events each instance held when it was loaded: what follows them is what this operation added */
    loaded_events(): Map<string, number> {
        return new Map([...this.kept_instances].map(([id, kept]) => [id, kept.events]));
    }

    /** Hold the partitions and load what they keep into the working set */
    async hold(partitions: string[]): Promise<void> {
        const wanted = [...new Set(partitions)].filter(p => !this.held.has(p)).sort();
        if (!wanted.length) return;
        // Always in the same order, so that two operations wanting the same partitions do not wait for one another
        await this.unit.hold(wanted);
        await this.load(wanted);
    }

    private async load(partitions: string[]): Promise<void> {
        partitions.forEach(p => this.held.add(p));
        const { instances, runs } = await this.unit.load(partitions);
        for (const kept of instances) {
            if (!this.view.journeys.has(kept.instance.journey_id)) throw new Error(`Journey instance ${kept.instance.id} needs journey ${kept.instance.journey_id}, which is not registered on this host. Nothing was changed.`);
            this.view.instances.set(kept.instance.id, kept.instance);
            this.kept_instances.set(kept.instance.id, { text: JSON.stringify(kept.instance), events: kept.instance.events.length, version: kept.version });
        }
        for (const kept of runs) {
            const version = kept.state.workflow_version;
            if (!(this.view.has_workflow ? this.view.has_workflow(kept.workflow_id, version) : this.view.workflows.has(kept.workflow_id))) {
                throw new Error(`Run ${kept.run_id} needs workflow ${kept.workflow_id}${version ? ` version ${version}` : ''}, which is not registered on this host. Nothing was changed.`);
            }
            this.kept_runs.set(kept.run_id, { text: run_text(kept.state, kept.outbox), version: kept.version, waits: kept.waits.map(wait_key) });
            // A child run is taken up with the run that holds it, never on its own (24.8)
            if (is_child_state(kept.state)) continue;
            if (kept.outbox.length) this.view.outbox.set(kept.run_id, [...kept.outbox]);
            if (kept.journey_instance_id) this.view.run_journey.set(kept.run_id, kept.journey_instance_id);
            this.view.runs.set(kept.run_id, this.view.adopt(kept));
        }
    }

    /**
     * Accept an event: record its id, then hold every partition it can touch:
     * the subject of each journey it concerns, and every run waiting for its type.
     * False when the event was accepted before, by this host or another.
     */
    async accept(event: BusinessEvent): Promise<boolean> {
        if (!(await this.unit.accept(event))) return false;
        const data = event.data || {};
        const subjects: string[] = [];
        for (const definition of this.view.journeys.values()) {
            if (!this.view.concerns.get(definition.id)?.has(event.type)) continue;
            const key = resolve_path(data, definition.subject.key) ?? event.subject;
            if (key !== undefined && key !== null) subjects.push(subject_partition(String(key)));
        }
        await this.hold(subjects);
        // No operation may keep a new wait this event could reach until this one has looked for the waits there are
        await this.unit.lock_waits(event_wait_keys(event, this.view.all_workflows ? this.view.all_workflows() : this.view.workflows.values()), 'shared');
        // A run may start waiting in a partition not yet held while this one waited: ask again until nothing new appears.
        // Only runs whose correlation the event matches are held, so that events about different subjects do not wait for one another.
        for (; ;) {
            const more = (await this.unit.waiting_for(event.type)).filter(r => r.waits.some(w => may_reach(w, event))).map(r => r.partition).filter(p => !this.held.has(p));
            if (!more.length) return true;
            await this.hold(more);
        }
    }

    /** Hold the partitions in which time acts by now, leaving those another operation holds to it or to a later tick */
    async hold_due(now: number): Promise<void> {
        for (const partition of (await this.unit.due(now)).filter(p => !this.held.has(p)).sort()) {
            if (await this.unit.try_hold(partition)) await this.load([partition]);
        }
    }

    /** Hold the partition of a run, to work on it */
    async hold_run(run_id: string): Promise<void> {
        const partition = await this.unit.partition_of_run(run_id);
        if (partition) await this.hold([partition]);
    }

    /** Write back what the operation changed. Journals first: they are part of the same unit. */
    async write(): Promise<void> {
        await Promise.all([...this.view.runs.values()].map(engine => engine.flush()));
        const instances: StoredInstance[] = [];
        for (const instance of this.view.instances.values()) {
            const text = JSON.stringify(instance), kept = this.kept_instances.get(instance.id);
            if (kept?.text === text) continue;
            const partition = subject_partition(instance.subject_key);
            if (!this.held.has(partition)) throw new Error(`Journey instance ${instance.id} was changed outside the partitions this operation holds`);
            instances.push({ instance, partition, due_at: instance_due(this.view.journeys.get(instance.journey_id), instance), version: kept?.version ?? 0, kept_events: kept?.events ?? 0 });
        }
        const runs: StoredRun[] = [];
        for (const [run_id, engine] of this.view.runs) {
            const state = engine.snapshot(), outbox = this.view.outbox.get(run_id) || [];
            const kept = this.kept_runs.get(run_id);
            if (kept?.text === run_text(state, outbox)) continue;
            const instance = this.view.instances.get(this.view.run_journey.get(run_id) || '');
            const partition = instance ? subject_partition(instance.subject_key) : run_partition(run_id);
            if (kept && !this.held.has(partition)) throw new Error(`Run ${run_id} was changed outside the partitions this operation holds`);
            const workflow = this.view.workflows.get(state.workflow_id);
            runs.push({
                run_id, workflow_id: state.workflow_id, ...(instance ? { journey_instance_id: instance.id } : {}), state, outbox, partition,
                due_at: run_due(workflow, state, this.view.workflows), waits_for: run_waits_for(state), waits: run_waits(state), version: kept?.version ?? 0,
            });
            // Each child run is kept as a run of its own, in the partition of the run that holds it; its waits are that run's (24.8)
            for (const held of engine.subworkflowStates()) {
                const kept_child = this.kept_runs.get(held.run_id);
                if (kept_child?.text === run_text(held.state, [])) continue;
                runs.push({
                    run_id: held.run_id, workflow_id: held.workflow_id, ...(instance ? { journey_instance_id: instance.id } : {}), state: held.state, outbox: [], partition,
                    due_at: null, waits_for: [], waits: [], version: kept_child?.version ?? 0,
                });
            }
        }
        // A wait that is new must not be kept while an event that could reach it is being accepted unseen (29.3)
        const new_waits = runs.flatMap(r => r.waits.map(wait_key).filter(k => !this.kept_runs.get(r.run_id)?.waits.includes(k)));
        if (new_waits.length) await this.unit.lock_waits([...new Set(new_waits)].sort(), 'exclusive');
        await this.unit.write(instances, runs);
    }
}

/**
 * The journal a host's runs write to on a shared store: within an operation it
 * is the operation's, so that journal and state are kept together; outside one
 * it reads what is kept.
 */
export class SharedJournal implements JournalStore {
    constructor(private store: SharedRuntimeStore, private current: () => SharedOperation | undefined) { }
    async append(event: JournalEvent): Promise<void> {
        const operation = this.current();
        if (!operation) throw new Error('On a shared store a run journals only within an operation of its host');
        await operation.unit.journal.append(event);
    }
    async read(run_id: string, after_seq = 0): Promise<JournalEvent[]> {
        return (this.current()?.unit.journal || this.store.journal).read(run_id, after_seq);
    }
}
