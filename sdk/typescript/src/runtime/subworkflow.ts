/**
 * Sub-workflows (specification section 24)
 *
 * An activity with `is_expandable: true` and an `expansion_workflow_id` is a
 * call activity: a child run of the named workflow performs it. The child run
 * has its own run id and journal; its `run.started` names its parent, and the
 * parent's journal names the child (`subworkflow.*`). From the parent's side
 * the child is an actor: its output is the attempt's result, held to the
 * activity's contract and verification; its failure is the attempt's failure,
 * retried under the activity's retry policy with a new child run each time.
 * A child that waits leaves the parent's token waiting, and everything the
 * host does to the parent (events, people's tasks, time, cancellation) reaches
 * the child. The parent's state holds the state of the children it waits on,
 * so the two are saved and restored together.
 *
 * This file holds that logic; the engine calls it from a few places.
 */

import { randomUUID } from 'crypto';
import { Activity, UUID, Workflow } from '../types';
import type { Actor, ActorContext } from './actors/actor';
import { resolve_path } from './expression';
import { JourneyInstance, JourneyRunRef, record_journey_event } from './journey';
import { public_payload } from './journal';
import type { JournalEvent, JournalEventInput, JournalListener, JournalStore } from './journal';
import type { WorkflowState } from './persistence';
import type { Token } from './token';
import type { WorkflowEngine, WorkflowEngineOptions } from './workflow_engine';

/** How deep child runs may nest unless the deployment says otherwise (24.1) */
export const DEFAULT_SUBWORKFLOW_DEPTH = 8;

export const SUBWORKFLOW_NOT_FOUND = 'SUBWORKFLOW_NOT_FOUND';
export const SUBWORKFLOW_DEPTH_EXCEEDED = 'SUBWORKFLOW_DEPTH_EXCEEDED';
export const SUBWORKFLOW_FAILED = 'SUBWORKFLOW_FAILED';

/** Who started a child run (24.2) */
export interface SubworkflowParent {
    run_id: UUID;
    workflow_id: UUID;
    node_id: UUID;
    token_id: UUID;
    attempt: number;
    /** The `seq` of the attempt's `activity.started` in the parent's journal */
    seq?: number;
    /** The run of depth 0 above the child */
    root_run_id: UUID;
}

/** One child run, as the result of a run lists it (24.7) */
export interface SubworkflowRun {
    run_id: UUID;
    parent_run_id: UUID;
    workflow_id: UUID;
    workflow_name: string;
    node_id: UUID;
    token_id: UUID;
    attempt: number;
    depth: number;
    status: string;
    started_at: string;
    ended_at?: string;
}

export interface SubworkflowOptions {
    /** The workflows activities may call, by id. A host gives the workflows registered with it. */
    workflows?: Workflow[] | Map<string, Workflow>;
    /** How deep child runs may nest. Default 8 */
    max_depth?: number;
    /** Performs every call activity instead of a child run. Counterfactual replay holds them as recorded (24.7). */
    actor?: Actor;
    /** Keep the final state of each child run that settles until subworkflowStates() is read: for stores that keep each run (24.8) */
    record_settled?: boolean;
    /** Set by an engine on the child runs it starts */
    parent?: SubworkflowParent;
    /** Set by an engine on the child runs it starts */
    depth?: number;
    /** On recovery: the last `seq` on record of each child run's journal, by run id */
    journal_tails?: Record<string, number>;
}

/** `metadata.subworkflows` of a run's state (24.8) */
export interface SubworkflowState {
    depth?: number;
    parent?: SubworkflowParent;
    runs?: SubworkflowRun[];
    live?: { run_id: UUID; workflow_id: UUID; state: WorkflowState }[];
}

/** What the parent's token holds while it waits on a child */
interface AwaitedChild { run_id: UUID; workflow_id: UUID; waiting_for: 'human' | 'event' }

/** What an engine lends the calls it makes */
export interface CallingEngine {
    run_id(): UUID;
    workflow(): Workflow;
    options(): WorkflowEngineOptions;
    journal(): JournalStore;
    record(input: JournalEventInput): JournalEvent;
    node_ref(node_id: UUID): { node_id: UUID; node_name?: string };
    now(): number;
    tokens(): Token[];
    make(workflow: Workflow, options: WorkflowEngineOptions): WorkflowEngine;
    restore(workflow: Workflow, state: WorkflowState, options: WorkflowEngineOptions, resumed: boolean): WorkflowEngine;
}

/** Whether an activity is performed by a child run (24.1) */
export function is_call_activity(activity: Activity): boolean {
    return activity.is_expandable === true && typeof activity.expansion_workflow_id === 'string' && activity.expansion_workflow_id.length > 0;
}

const WAITING = new Set(['waiting_human', 'waiting_event']);
const SETTLED = new Set(['completed', 'failed', 'cancelled']);

function failure(message: string, code: string): Error {
    return Object.assign(new Error(message), { code });
}

function copy<T>(value: T): T {
    return value === undefined ? value : JSON.parse(JSON.stringify(value));
}

/** The properties a mapping names, each read at its path; a path that leads nowhere gives nothing (24.1) */
function mapped(mapping: Record<string, string>, source: Record<string, unknown>): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    for (const [property, path] of Object.entries(mapping)) {
        const value = resolve_path(source, path);
        if (value !== undefined) out[property] = copy(value);
    }
    return out;
}

/** A run's business data: without engine properties and without the records of activities and decisions (28.8) */
function business(data: Record<string, unknown>): Record<string, unknown> {
    const rest = copy(public_payload(data));
    delete rest.decisions;
    return rest;
}

/** The output of a run that completed: the data of its completed tokens, merged in the order they were created (24.3) */
export function run_output(engine: WorkflowEngine): Record<string, unknown> {
    let output: Record<string, unknown> = {};
    for (const token of engine.getTokens().filter(t => t.status === 'completed')) output = { ...output, ...business(token.contextData) };
    return output;
}

/** The workflows a set of workflows calls, directly or not, among those registered */
export function called_workflows(ids: Iterable<string>, registry: Map<string, Workflow>): Workflow[] {
    const found = new Map<string, Workflow>();
    const visit = (id: string) => {
        const workflow = registry.get(id);
        if (!workflow) return;
        for (const activity of workflow.activities) {
            if (!is_call_activity(activity) || found.has(activity.expansion_workflow_id!)) continue;
            const called = registry.get(activity.expansion_workflow_id!);
            if (!called) continue;
            found.set(called.id, called);
            visit(called.id);
        }
    };
    for (const id of ids) visit(id);
    return [...found.values()];
}

/**
 * The last `seq` on record of the journal of every child run a state holds, at any depth, so that a
 * run recovered with its children continues each journal after what it holds (10.3).
 */
export async function subworkflow_journal_tails(state: WorkflowState, journal: JournalStore | undefined): Promise<Record<string, number>> {
    const tails: Record<string, number> = {};
    if (!journal) return tails;
    const walk = async (s: WorkflowState) => {
        for (const live of ((s.metadata?.subworkflows as SubworkflowState | undefined)?.live || [])) {
            tails[live.run_id] = (await journal.read(live.run_id)).reduce((max, e) => Math.max(max, e.seq), 0);
            await walk(live.state);
        }
    };
    await walk(state);
    return tails;
}

/** The states of a run's children at every depth, as a state holds them */
export function nested_states(state: WorkflowState): WorkflowState[] {
    const out: WorkflowState[] = [];
    for (const live of ((state.metadata?.subworkflows as SubworkflowState | undefined)?.live || [])) out.push(live.state, ...nested_states(live.state));
    return out;
}

/** Whether a state is that of a child run, which is taken up only with its parent (24.8) */
export function is_child_state(state: WorkflowState): boolean {
    return !!(state.metadata?.subworkflows as SubworkflowState | undefined)?.parent;
}

/**
 * The child runs of one engine: those it waits on, and the record of every
 * child it started, with their own children's.
 */
export class SubworkflowCalls {
    readonly depth: number;
    readonly parent?: SubworkflowParent;
    private registry = new Map<string, Workflow>();
    private runs: SubworkflowRun[] = [];
    private live = new Map<UUID, WorkflowEngine>();
    private listeners = new Set<JournalListener>();
    private settled: { run_id: UUID; workflow_id: UUID; state: WorkflowState }[] = [];

    constructor(private engine: CallingEngine) {
        const options = engine.options().subworkflows || {};
        this.depth = options.depth ?? 0;
        this.parent = options.parent;
        const workflows = options.workflows instanceof Map ? [...options.workflows.values()] : options.workflows || [];
        for (const workflow of workflows) this.registry.set(workflow.id, workflow);
    }

    private get max_depth(): number {
        return this.engine.options().subworkflows?.max_depth ?? DEFAULT_SUBWORKFLOW_DEPTH;
    }

    /** What a child run's `run.started` adds (24.2) */
    started_data(): Record<string, unknown> {
        return this.parent ? { depth: this.depth, parent: this.parent } : {};
    }

    /** The actor of a call activity; undefined for any other activity */
    actor(activity: Activity): Actor | undefined {
        if (!is_call_activity(activity)) return undefined;
        return this.engine.options().subworkflows?.actor
            ?? { execute: (called, inputs, context) => this.perform(called, inputs, context || {}) };
    }

    // ------------------------------------------------------------------ performing a call

    private async perform(activity: Activity, inputs: Record<string, unknown>, context: ActorContext): Promise<Record<string, unknown>> {
        // The attempt after a child that waited takes that child's outcome; any later attempt starts a new child (24.4)
        const continued = inputs._subworkflow_continuation as { run_id?: UUID } | undefined;
        if (continued?.run_id && this.live.has(continued.run_id)) return this.conclude(continued.run_id, activity, context);

        const workflow = this.registry.get(activity.expansion_workflow_id!);
        if (!workflow) {
            throw failure(`Activity "${activity.name}" calls workflow ${activity.expansion_workflow_id}, which is not registered with this engine`, SUBWORKFLOW_NOT_FOUND);
        }
        if (this.depth + 1 > this.max_depth) {
            throw failure(`Activity "${activity.name}" would start a run of "${workflow.name}" at depth ${this.depth + 1}, beyond the limit of ${this.max_depth}`, SUBWORKFLOW_DEPTH_EXCEEDED);
        }

        const input = activity.subworkflow?.input
            ? mapped(activity.subworkflow.input, Object.fromEntries(Object.entries(inputs).filter(([key]) => !key.startsWith('_'))))
            : business(inputs);
        const run_id = randomUUID();
        const parent: SubworkflowParent = {
            run_id: this.engine.run_id(), workflow_id: this.engine.workflow().id, node_id: activity.id,
            token_id: String(inputs._token_id), attempt: Number(inputs._attempt) || 1,
            ...(context.attempt_seq ? { seq: context.attempt_seq } : {}),
            root_run_id: this.parent?.root_run_id ?? this.engine.run_id(),
        };
        context.record?.({
            type: 'subworkflow.started',
            data: {
                run_id, workflow_id: workflow.id, workflow_name: workflow.name, workflow_version: workflow.version,
                depth: this.depth + 1, input: context.payload ? context.payload(input) : input,
            },
        });
        const child = this.engine.make(workflow, this.child_options(run_id, parent, this.depth + 1));
        this.adopt(child);
        this.runs.push({
            run_id, parent_run_id: parent.run_id, workflow_id: workflow.id, workflow_name: workflow.name, node_id: activity.id,
            token_id: parent.token_id, attempt: parent.attempt, depth: this.depth + 1, status: 'running', started_at: new Date(this.engine.now()).toISOString(),
        });
        await child.start(input);
        await child.run();
        return this.conclude(run_id, activity, context);
    }

    /** The attempt's result from a child run as it stands: waiting, completed or failed (24.3, 24.4) */
    private async conclude(run_id: UUID, activity: Activity, context: ActorContext): Promise<Record<string, unknown>> {
        const child = this.live.get(run_id)!;
        const workflow = child.getWorkflow();
        let status = child.getStatus();
        if (WAITING.has(status)) {
            this.refresh(child);
            const awaiting: AwaitedChild = { run_id, workflow_id: workflow.id, waiting_for: status === 'waiting_human' ? 'human' : 'event' };
            return { _awaiting_subworkflow: awaiting };
        }
        // A child that neither settled nor waits (it ran out of steps) is not left behind
        if (!SETTLED.has(status)) {
            await child.cancel('parent_failed');
            status = child.getStatus();
        }
        this.release(run_id);
        const record = this.runs.find(r => r.run_id === run_id);
        if (status === 'completed') {
            const outcome = activity.subworkflow?.output ? mapped(activity.subworkflow.output, run_output(child)) : run_output(child);
            const started = record ? Date.parse(record.started_at) : this.engine.now();
            const ended = record?.ended_at ? Date.parse(record.ended_at) : this.engine.now();
            context.record?.({
                type: 'subworkflow.completed',
                data: { run_id, workflow_id: workflow.id, duration_ms: ended - started, output: context.payload ? context.payload(outcome) : outcome },
            });
            return { output: outcome };
        }
        const failed = child.getTokens().find(t => t.status === 'failed');
        const code = failed?.getData('_error_code');
        const error = {
            message: String(failed?.getData('_error') ?? (status === 'cancelled' ? 'the run was cancelled' : `the run ended with status ${status}`)),
            ...(typeof code === 'string' ? { code } : {}),
        };
        context.record?.({ type: 'subworkflow.failed', data: { run_id, workflow_id: workflow.id, error } });
        throw failure(`Sub-workflow "${workflow.name}" (run ${run_id}) failed: ${error.message}`, SUBWORKFLOW_FAILED);
    }

    private child_options(run_id: UUID, parent: SubworkflowParent, depth: number): WorkflowEngineOptions {
        const options = this.engine.options();
        const own = options.subworkflows || {};
        return {
            ...options,
            run_id,
            journal: this.engine.journal(),
            // A child is saved with its parent, never on its own (24.8)
            checkpoint: undefined,
            journal_tail_seq: undefined,
            subworkflows: { ...own, workflows: this.registry, parent, depth },
        };
    }

    private adopt(child: WorkflowEngine): void {
        for (const listener of this.listeners) child.onEvent(listener);
        this.live.set(child.getRunId(), child);
    }

    /** The child no longer needs to be kept with the parent */
    private release(run_id: UUID): void {
        const child = this.live.get(run_id);
        if (!child) return;
        this.refresh(child);
        this.live.delete(run_id);
        if (this.engine.options().subworkflows?.record_settled) {
            this.settled.push({ run_id, workflow_id: child.getWorkflow().id, state: child.snapshot() }, ...child.subworkflowStates());
        }
    }

    /** Bring the record of a child, and of its own children, up to date */
    private refresh(child: WorkflowEngine): void {
        const status = child.getStatus();
        const record = this.runs.find(r => r.run_id === child.getRunId());
        if (record && record.status !== status) {
            record.status = status;
            if (SETTLED.has(status)) record.ended_at = new Date(this.engine.now()).toISOString();
        }
        for (const descendant of child.getSubworkflowRuns()) {
            const at = this.runs.findIndex(r => r.run_id === descendant.run_id);
            if (at >= 0) this.runs[at] = descendant; else this.runs.push(descendant);
        }
    }

    // ------------------------------------------------------------------ waiting

    /** Park the parent's token on a child that waits (24.4) */
    park(token: Token, activity: Activity, awaiting: AwaitedChild, since: Date): void {
        token.setData('_awaiting_subworkflow', awaiting);
        token.setData('_waiting_since', since.toISOString());
        this.engine.record({
            type: 'token.waiting', token_id: token.id, ...this.engine.node_ref(activity.id),
            data: { reason: 'subworkflow', run_id: awaiting.run_id, workflow_id: awaiting.workflow_id, waiting_for: awaiting.waiting_for },
        });
    }

    /** Whether a waiting token waits on a child that waits only for business events */
    waits_for_event(token: Token): boolean {
        return (token.getData('_awaiting_subworkflow') as AwaitedChild | undefined)?.waiting_for === 'event';
    }

    /**
     * After a child made progress: a token whose child reached an outcome becomes active again,
     * to take that outcome; one whose child still waits keeps waiting, for what the child now waits for.
     */
    private wake(): number {
        let woken = 0;
        for (const token of this.engine.tokens()) {
            const awaiting = token.status === 'waiting' ? token.getData('_awaiting_subworkflow') as AwaitedChild | undefined : undefined;
            const child = awaiting ? this.live.get(awaiting.run_id) : undefined;
            if (!awaiting || !child) continue;
            this.refresh(child);
            const status = child.getStatus();
            if (WAITING.has(status)) {
                token.setData('_awaiting_subworkflow', { ...awaiting, waiting_for: status === 'waiting_human' ? 'human' : 'event' });
                continue;
            }
            delete token.contextData._awaiting_subworkflow;
            delete token.contextData._waiting_since;
            token.setData('_subworkflow_continuation', { run_id: awaiting.run_id });
            token.updateStatus('active');
            this.engine.record({
                type: 'token.resumed', token_id: token.id, ...this.engine.node_ref(token.activityId),
                data: { reason: 'subworkflow', run_id: awaiting.run_id, status },
            });
            woken++;
        }
        return woken;
    }

    private waiting_children(): WorkflowEngine[] {
        return [...this.live.values()].filter(child => WAITING.has(child.getStatus()));
    }

    /** Deliver a business event to the children that wait (18.3). Returns how many of their tokens it released. */
    async deliver(event: Parameters<WorkflowEngine['deliverEvent']>[0]): Promise<{ released: number; woken: number }> {
        let released = 0;
        for (const child of this.waiting_children()) {
            const n = await child.deliverEvent(event);
            if (n > 0) { released += n; await child.run(); }
        }
        return { released, woken: released ? this.wake() : 0 };
    }

    /** Complete a person's task in a child run (5.6). Undefined when no child holds the token. */
    async resume(token_id: UUID, output: Record<string, unknown>): Promise<{ resumed: boolean; woken: number } | undefined> {
        for (const child of this.live.values()) {
            if (!child.ownsToken(token_id)) continue;
            const resumed = await child.resumeToken(token_id, output);
            await child.run();
            return { resumed, woken: this.wake() };
        }
        return undefined;
    }

    /** What the agents of the children's activities ask for (28.6) */
    agent_requests(): ReturnType<WorkflowEngine['getAgentRequests']> {
        return [...this.live.values()].flatMap(child => child.getAgentRequests());
    }

    /** Give an agent of a child's activity the input it asked for (28.6). Undefined when no child holds the token. */
    async answer_agent(token_id: UUID, input: Record<string, unknown> | string): Promise<{ answered: boolean; woken: number } | undefined> {
        for (const child of this.live.values()) {
            if (!child.ownsToken(token_id)) continue;
            const answered = await child.answerAgent(token_id, input);
            await child.run();
            return { answered, woken: this.wake() };
        }
        return undefined;
    }

    /** Let the children's event waits run out (18.3). Returns how many timed out. */
    async expire(now: number): Promise<{ expired: number; woken: number }> {
        let expired = 0;
        for (const child of this.waiting_children()) {
            const n = await child.expireEvents(now);
            if (n > 0) { expired += n; await child.run(); }
        }
        return { expired, woken: expired ? this.wake() : 0 };
    }

    /** Check the service levels of the work the children wait on (23.2) */
    async check_service_levels(now: number): Promise<{ warnings: number; breaches: number; failed: number; woken: number }> {
        const total = { warnings: 0, breaches: 0, failed: 0, woken: 0 };
        for (const child of this.waiting_children()) {
            const levels = await child.checkServiceLevels(now);
            total.warnings += levels.warnings; total.breaches += levels.breaches; total.failed += levels.failed;
            if (levels.failed > 0) await child.run();
        }
        if (total.failed > 0) total.woken = this.wake();
        return total;
    }

    /** The earliest deadline of the children's event waits */
    deadline(): number | undefined {
        const due = [...this.live.values()].map(child => child.nextEventDeadline()).filter((d): d is number => d !== undefined);
        return due.length ? Math.min(...due) : undefined;
    }

    owns_token(token_id: UUID): boolean {
        return [...this.live.values()].some(child => child.ownsToken(token_id));
    }

    has_run(run_id: UUID): boolean {
        return this.runs.some(r => r.run_id === run_id) || this.live.has(run_id);
    }

    // ------------------------------------------------------------------ cancellation

    /** Cancel every child the run still keeps (24.5) */
    async cancel_all(reason: 'parent_cancelled' | 'parent_failed'): Promise<void> {
        for (const run_id of [...this.live.keys()]) await this.cancel_child(run_id, reason);
    }

    /** Cancel the children whose parent token no longer waits on them or is about to take their outcome */
    async reap(): Promise<void> {
        for (const run_id of [...this.live.keys()]) {
            const holder = this.holder(run_id);
            if (!holder || (holder.status !== 'waiting' && holder.status !== 'active')) await this.cancel_child(run_id, 'parent_failed');
        }
    }

    private holder(run_id: UUID): Token | undefined {
        return this.engine.tokens().find(t => (t.getData('_awaiting_subworkflow') as AwaitedChild | undefined)?.run_id === run_id
            || (t.getData('_subworkflow_continuation') as { run_id?: UUID } | undefined)?.run_id === run_id);
    }

    private async cancel_child(run_id: UUID, reason: 'parent_cancelled' | 'parent_failed'): Promise<void> {
        const child = this.live.get(run_id);
        if (!child) return;
        const cancelled = await child.cancel(reason);
        const holder = this.holder(run_id);
        if (cancelled) {
            const record = this.runs.find(r => r.run_id === run_id);
            this.engine.record({
                type: 'subworkflow.cancelled',
                ...(holder ? { token_id: holder.id, ...this.engine.node_ref(holder.activityId) } : record ? this.engine.node_ref(record.node_id) : {}),
                ...(record ? { attempt: record.attempt } : {}),
                data: { run_id, workflow_id: child.getWorkflow().id, reason },
            });
        }
        if (holder) {
            delete holder.contextData._awaiting_subworkflow;
            delete holder.contextData._subworkflow_continuation;
        }
        this.release(run_id);
    }

    // ------------------------------------------------------------------ listeners, record, state

    subscribe(listener: JournalListener): () => void {
        this.listeners.add(listener);
        const off = [...this.live.values()].map(child => child.onEvent(listener));
        return () => { this.listeners.delete(listener); off.forEach(f => f()); };
    }

    /** Every child run started by this run or its children, in the order they started (24.7) */
    list(): SubworkflowRun[] {
        for (const child of this.live.values()) this.refresh(child);
        return this.runs.map(r => ({ ...r }));
    }

    /** The journal of a child run at any depth */
    async events(run_id: UUID): Promise<JournalEvent[]> {
        return this.has_run(run_id) ? this.engine.journal().read(run_id) : [];
    }

    /** The states of the children kept, at any depth, and of those that settled since last asked (24.8) */
    states(): { run_id: UUID; workflow_id: UUID; state: WorkflowState }[] {
        const out = this.settled.splice(0);
        for (const child of this.live.values()) {
            out.push({ run_id: child.getRunId(), workflow_id: child.getWorkflow().id, state: child.snapshot() }, ...child.subworkflowStates());
        }
        return out;
    }

    /** `metadata.subworkflows` of the run's state, when it has anything to say (24.8) */
    snapshot(): SubworkflowState | undefined {
        const live = [...this.live.values()].map(child => ({ run_id: child.getRunId(), workflow_id: child.getWorkflow().id, state: child.snapshot() }));
        if (!this.parent && !this.runs.length && !live.length) return undefined;
        return { depth: this.depth, ...(this.parent ? { parent: this.parent } : {}), runs: this.list(), live };
    }

    /** Rebuild the children a saved state holds, each from its own state, under the same deployment (24.8) */
    restore(saved: SubworkflowState | undefined, resumed: boolean): void {
        if (!saved) return;
        this.runs = (saved.runs || []).map(r => ({ ...r }));
        const tails = this.engine.options().subworkflows?.journal_tails || {};
        for (const live of saved.live || []) {
            const workflow = this.registry.get(live.workflow_id);
            if (!workflow) throw new Error(`Run ${this.engine.run_id()} waits on child run ${live.run_id} of workflow ${live.workflow_id}, which is not registered. Nothing was changed.`);
            const own = (live.state.metadata?.subworkflows || {}) as SubworkflowState;
            const options = this.child_options(live.run_id, own.parent!, own.depth ?? this.depth + 1);
            const child = this.engine.restore(workflow, live.state, { ...options, ...(tails[live.run_id] ? { journal_tail_seq: tails[live.run_id] } : {}) }, resumed);
            this.adopt(child);
        }
    }
}

/**
 * A journey sees the child runs of its runs as its own (24.7): each is listed in the instance's runs with
 * the run that started it, and its start and end are recorded, before the end of the run that started it.
 */
export function record_child_runs(engine: WorkflowEngine, instance: JourneyInstance, parent: JourneyRunRef, time: string): void {
    for (const run of engine.getSubworkflowRuns()) {
        let ref = instance.runs.find(r => r.run_id === run.run_id);
        if (!ref) {
            ref = {
                run_id: run.run_id, workflow_id: run.workflow_id, workflow_name: run.workflow_name, stage_id: parent.stage_id,
                status: 'running', started_at: run.started_at, parent_run_id: run.parent_run_id,
            };
            instance.runs.push(ref);
            record_journey_event(instance, 'journey.run_started', time,
                { workflow_id: run.workflow_id, workflow_name: run.workflow_name, parent_run_id: run.parent_run_id }, { run_id: run.run_id, stage_id: ref.stage_id });
        }
        if (ref.status === run.status || SETTLED.has(ref.status)) continue;
        ref.status = run.status;
        if (!SETTLED.has(run.status)) continue;
        ref.ended_at = time;
        record_journey_event(instance, 'journey.run_ended', time,
            { workflow_name: run.workflow_name, status: run.status, parent_run_id: run.parent_run_id }, { run_id: run.run_id, stage_id: ref.stage_id });
    }
}
