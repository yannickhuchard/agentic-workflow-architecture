/**
 * Changing a workflow while runs are in flight (specification section 25)
 *
 * A run is bound to the version of its workflow it started on. A host keeps
 * running it on that version when a newer one is registered; new runs take
 * the newest. A run that is at rest (waiting for a person, an event, an
 * agent's input, a timer or the other branches of a join) can be moved to
 * another version by an explicit plan: where each token goes, what data
 * changes, and which waits are withdrawn. The plan is checked in full before
 * anything changes, and refused with named reasons when it would leave a
 * token nowhere, or a wait without meaning. Applied, it is one change of the
 * run's state with one journal event, `run.migrated`.
 *
 * Everything here is pure: it reads two workflow documents and a run's state
 * and says what follows. AwaRuntime.migrate applies it to a run it hosts.
 */

import { Activity, Edge, Workflow } from '../types';
import { evaluate_expression, resolve_path, validate_expression } from './expression';
import { JournalEvent } from './journal';
import { SerializedToken, WorkflowState } from './persistence';

/** What a token at rest is waiting for */
export type WaitKind = 'human' | 'agent' | 'event' | 'timer' | 'join';

/** A change to a token's data, applied to every live token in order (25.3) */
export interface MigrationAssignment {
    /** The property to set, a path of names (6.1). Names beginning with "_" are the engine's and cannot be set */
    set?: string;
    /** The property to remove */
    remove?: string;
    /** The value to set */
    value?: unknown;
    /** A path in the token's data whose value is copied. Missing: the assignment changes nothing */
    from?: string;
    /** A condition expression (section 6) whose result, true or false, is set */
    expression?: string;
    /** A condition expression: the assignment applies only to tokens whose data satisfies it */
    when?: string;
}

/** How to move runs from one version of a workflow to another */
export interface MigrationPlan {
    /** The workflow. Where given, it must be the run's */
    workflow_id?: string;
    /** The version the run must be on. Where given, a run on another is refused */
    from_version?: string;
    /** The version to move to. Default: the newest registered */
    to_version?: string;
    /** Old node id -> new node id. A node not listed keeps its id (the identity mapping) */
    nodes?: Record<string, string>;
    /** Old node ids whose tokens give up what they wait for and start afresh at the node they are mapped to */
    restart?: string[];
    /** Changes to the data of every live token, in order */
    data?: MigrationAssignment[];
}

export type MigrationRefusalCode =
    | 'not_found' | 'unknown_version' | 'different_workflow' | 'wrong_version' | 'same_version' | 'run_ended' | 'run_in_activity'
    | 'unknown_source' | 'unknown_target' | 'unmapped_token' | 'wait_incompatible' | 'invalid_assignment' | 'child_run_in_flight';

export interface MigrationRefusal {
    code: MigrationRefusalCode;
    message: string;
    token_id?: string;
    node_id?: string;
    node_name?: string;
}

/** What happens, or would happen, to one token */
export interface TokenMigration {
    token_id: string;
    status: string;
    from_node_id: string;
    from_node_name?: string;
    to_node_id: string;
    to_node_name?: string;
    /** What the token waited for before the migration; null for a token that has ended */
    wait: WaitKind | null;
    /** kept: it waits on at its new node. restarted: its wait is withdrawn and it starts afresh at its new node. unchanged: it had ended */
    outcome: 'kept' | 'restarted' | 'unchanged';
}

/** A change to a token's data that a plan makes */
export interface DataChange {
    token_id: string;
    path: string;
    change: 'set' | 'removed';
    value?: unknown;
    previous?: unknown;
}

export interface MigrationResult {
    run_id: string;
    workflow_id: string;
    from_version: string;
    to_version: string;
    /** True when the run was moved; false for a dry run and for a refusal */
    applied: boolean;
    dry_run: boolean;
    /** Why the plan cannot be applied. Empty when it can */
    refusals: MigrationRefusal[];
    tokens: TokenMigration[];
    data_changes: DataChange[];
    /** Completed work whose node the plan maps elsewhere, so that its compensation (13.6) is the new node's */
    completed_work: { from_node_id: string; to_node_id: string }[];
    /** The run's status after the migration: still waiting, or running when a token was restarted */
    status?: string;
}

const RESERVED = /(^|\.)_/;
const PATH = /^[A-Za-z_$][\w$-]*(\.[A-Za-z_$][\w$-]*)*$/;

type Node = { kind: 'activity'; activity: Activity; name: string } | { kind: 'event'; event: Workflow['events'][number]; name: string } | { kind: 'decision'; name: string };

function node_map(workflow: Workflow): Map<string, Node> {
    const nodes = new Map<string, Node>();
    for (const activity of workflow.activities) nodes.set(activity.id, { kind: 'activity', activity, name: activity.name });
    for (const event of workflow.events || []) nodes.set(event.id, { kind: 'event', event, name: event.name });
    for (const decision of workflow.decision_nodes || []) nodes.set(decision.id, { kind: 'decision', name: decision.name });
    return nodes;
}

const definition_of = (node: Node | undefined) => (node?.kind === 'event' ? (node.event.event_definition || {}) as { name?: string; mode?: string; correlation_key?: string } : {});
const incoming = (workflow: Workflow, id: string): Edge[] => workflow.edges.filter(e => e.target_id === id);
const is_join = (workflow: Workflow, node: Node | undefined, id: string) =>
    !!node && (node.kind === 'activity' ? node.activity.join : node.kind === 'event' ? node.event.join : undefined) === 'all' && incoming(workflow, id).length > 1;
const is_waiting_event = (node: Node | undefined) =>
    node?.kind === 'event' && (node.event.event_type === 'message' || node.event.event_type === 'signal') && definition_of(node).mode !== 'publish';

/** Whether the activity is performed by an agent reached over A2A (28.1), directly or through its role */
function over_a2a(workflow: Workflow, activity: Activity): boolean {
    return !!activity.a2a || !!(workflow.roles || []).find(r => r.id === activity.role_id)?.a2a;
}

/** Live tokens: those that may still move. The others have ended and are left as they are */
const LIVE = new Set(['active', 'waiting', 'joining']);

/** What a token of a run at rest waits for; undefined for a token that is in the middle of work */
export function token_wait(workflow: Workflow, token: SerializedToken): WaitKind | undefined {
    const data = token.context_data || {};
    if (token.status === 'waiting') return data._awaiting_event ? 'event' : data._awaiting_agent_input ? 'agent' : 'human';
    if (token.status === 'joining') return 'join';
    if (token.status === 'active') {
        const node = node_map(workflow).get(token.activity_id);
        // A token at a timer whose due time is fixed is waiting for time to pass (13.5)
        if (node?.kind === 'event' && node.event.event_type === 'timer' && data[`_timer_due:${token.activity_id}`]) return 'timer';
    }
    return undefined;
}

/**
 * Whether a wait keeps its meaning at a node of the new version. Returns why
 * not, or undefined when it does.
 */
function wait_problem(wait: WaitKind, from: Workflow, from_id: string, to: Workflow, to_id: string, token?: SerializedToken): string | undefined {
    const source = node_map(from).get(from_id), target = node_map(to).get(to_id);
    if (!target) return `version ${to.version} has no node ${to_id}`;
    const named = `"${target.name}"`;
    switch (wait) {
        case 'human': case 'agent': {
            const actor = source?.kind === 'activity' ? source.activity.actor_type : (wait === 'human' ? 'human' : 'ai_agent');
            if (target.kind !== 'activity') return `${named} is not an activity, so the ${wait === 'human' ? 'task a person was given' : "agent's request for input"} would have nothing to return to`;
            if (target.activity.actor_type !== actor) return `${named} is performed by ${target.activity.actor_type}, not ${actor}: the ${wait === 'human' ? 'task a person was given' : "agent's request"} would not fit it`;
            if (wait === 'agent' && !over_a2a(to, target.activity)) return `${named} is not performed by an agent over A2A, which the token waits for`;
            return undefined;
        }
        case 'event': {
            const awaited = (token?.context_data?._awaiting_event || {}) as { name?: string; correlation_key?: string };
            const name = awaited.name ?? definition_of(source).name;
            const key = token ? awaited.correlation_key : definition_of(source).correlation_key;
            if (!is_waiting_event(target)) return `${named} does not wait for a business event`;
            if (target.kind === 'event' && source?.kind === 'event' && target.event.event_type !== source.event.event_type) return `${named} is a ${target.event.event_type} event, not a ${source.event.event_type} event`;
            if (definition_of(target).name !== name) return `${named} waits for "${definition_of(target).name}", not "${name}"`;
            const target_key = target.kind === 'event' && target.event.event_type === 'message' ? definition_of(target).correlation_key : undefined;
            if ((target_key || undefined) !== (key || undefined)) return `${named} correlates on ${target_key ? `"${target_key}"` : 'nothing'}, not ${key ? `"${key}"` : 'nothing'}`;
            return undefined;
        }
        case 'timer':
            return target.kind === 'event' && target.event.event_type === 'timer' ? undefined : `${named} is not a timer`;
        case 'join': {
            if (!is_join(to, target, to_id)) return `${named} is not a join`;
            const arrived = token?.context_data?._arrived_edge as string | undefined;
            if (arrived && !incoming(to, to_id).some(e => e.id === arrived)) return `the edge the token arrived by (${arrived}) does not lead to ${named}`;
            return undefined;
        }
    }
}

function clone<T>(value: T): T {
    return value === undefined ? value : JSON.parse(JSON.stringify(value));
}

function set_path(data: Record<string, unknown>, path: string, value: unknown): void {
    const segments = path.split('.');
    let current = data;
    for (const segment of segments.slice(0, -1)) {
        if (!current[segment] || typeof current[segment] !== 'object' || Array.isArray(current[segment])) current[segment] = {};
        current = current[segment] as Record<string, unknown>;
    }
    current[segments[segments.length - 1]] = value;
}

function remove_path(data: Record<string, unknown>, path: string): boolean {
    const segments = path.split('.');
    let current: unknown = data;
    for (const segment of segments.slice(0, -1)) {
        if (!current || typeof current !== 'object') return false;
        current = (current as Record<string, unknown>)[segment];
    }
    if (!current || typeof current !== 'object' || !(segments[segments.length - 1] in (current as object))) return false;
    delete (current as Record<string, unknown>)[segments[segments.length - 1]];
    return true;
}

/** Problems with a plan's data assignments, each as a message */
export function check_assignments(assignments: MigrationAssignment[] = []): string[] {
    const problems: string[] = [];
    assignments.forEach((a, i) => {
        const at = `assignment ${i + 1}`;
        const target = a.set ?? a.remove;
        if ((a.set === undefined) === (a.remove === undefined)) problems.push(`${at} must have exactly one of "set" and "remove"`);
        else if (typeof target !== 'string' || !PATH.test(target)) problems.push(`${at}: "${target}" is not a path`);
        else if (RESERVED.test(target)) problems.push(`${at}: "${target}" names a property reserved to the engine (5.2)`);
        if (a.set !== undefined) {
            const sources = ['value', 'from', 'expression'].filter(k => k in a);
            if (sources.length !== 1) problems.push(`${at} must have exactly one of "value", "from" and "expression"`);
            if (a.from !== undefined && (typeof a.from !== 'string' || !PATH.test(a.from))) problems.push(`${at}: "from" is not a path`);
        }
        for (const key of ['expression', 'when'] as const) {
            if (a[key] === undefined) continue;
            const check = typeof a[key] === 'string' ? validate_expression(a[key]!) : { valid: false, error: 'not text' };
            if (!check.valid) problems.push(`${at}: "${key}" is not a condition expression: ${check.error}`);
        }
    });
    return problems;
}

/** Apply a plan's assignments to one token's data. Returns the changes made. */
export function apply_assignments(token_id: string, data: Record<string, unknown>, assignments: MigrationAssignment[] = []): DataChange[] {
    const changes: DataChange[] = [];
    for (const a of assignments) {
        if (a.when !== undefined && !evaluate_expression(a.when, data)) continue;
        if (a.remove !== undefined) {
            const previous = clone(resolve_path(data, a.remove));
            if (remove_path(data, a.remove)) changes.push({ token_id, path: a.remove, change: 'removed', previous });
            continue;
        }
        let value: unknown;
        if ('value' in a) value = clone(a.value);
        else if (a.from !== undefined) {
            value = clone(resolve_path(data, a.from));
            if (value === undefined) continue;
        } else value = evaluate_expression(a.expression!, data);
        const previous = clone(resolve_path(data, a.set!));
        set_path(data, a.set!, value);
        changes.push({ token_id, path: a.set!, change: 'set', value, ...(previous !== undefined ? { previous } : {}) });
    }
    return changes;
}

/** The data a token gives up when its wait is withdrawn */
function withdraw(data: Record<string, unknown>, from_id: string): Record<string, unknown> {
    const rest = { ...data };
    for (const key of ['_awaiting_event', '_awaiting_agent_input', '_requires_human_action', '_human_task_id', '_waiting_since', '_arrived_edge', `_timer_due:${from_id}`]) delete rest[key];
    return rest;
}

const ENDED = new Set(['completed', 'failed', 'cancelled']);

/**
 * Check a plan against a run's state and work out what it does, without
 * changing anything. With no refusal, `state` is the run's state on the new
 * version, ready to be continued (10.3).
 */
export function plan_migration(from: Workflow, to: Workflow, state: WorkflowState, plan: MigrationPlan = {}, run_id?: string): MigrationResult & { state?: WorkflowState } {
    const id = run_id ?? ((state.metadata || {}) as { run_id?: string }).run_id ?? '';
    const from_version = state.workflow_version ?? from.version;
    const result: MigrationResult & { state?: WorkflowState } = {
        run_id: id, workflow_id: state.workflow_id, from_version, to_version: to.version,
        applied: false, dry_run: true, refusals: [], tokens: [], data_changes: [], completed_work: [],
    };
    const refuse = (code: MigrationRefusalCode, message: string, extra: Partial<MigrationRefusal> = {}) => result.refusals.push({ code, message, ...extra });
    const old_nodes = node_map(from), new_nodes = node_map(to);
    const mapping = plan.nodes || {};
    const restart = new Set(plan.restart || []);

    // The run and the versions
    if (to.id !== state.workflow_id || (plan.workflow_id && plan.workflow_id !== state.workflow_id)) {
        refuse('different_workflow', `Run ${id} is a run of workflow ${state.workflow_id}; a migration moves a run between versions of its own workflow, not to workflow ${plan.workflow_id && plan.workflow_id !== state.workflow_id ? plan.workflow_id : to.id}.`);
    }
    if (from.version !== from_version) refuse('wrong_version', `Run ${id} is on version ${from_version}, but the workflow given as its version is ${from.version}.`);
    if (plan.from_version && plan.from_version !== from_version) refuse('wrong_version', `The plan moves runs from version ${plan.from_version}; run ${id} is on version ${from_version}.`);
    if (to.version === from_version) refuse('same_version', `Run ${id} is already on version ${to.version}.`);
    if (ENDED.has(String(state.engine_status))) refuse('run_ended', `Run ${id} has ended (${state.engine_status}): there is nothing left to move.`);

    // The plan itself
    for (const [source, target] of Object.entries(mapping)) {
        if (!old_nodes.has(source)) refuse('unknown_source', `The plan maps node ${source}, which version ${from.version} does not have.`, { node_id: source });
        if (!new_nodes.has(target)) refuse('unknown_target', `The plan maps node ${old_nodes.get(source)?.name ?? source} to ${target}, which version ${to.version} does not have.`, { node_id: source, node_name: old_nodes.get(source)?.name });
    }
    for (const source of restart) {
        if (!old_nodes.has(source)) refuse('unknown_source', `The plan restarts tokens at node ${source}, which version ${from.version} does not have.`, { node_id: source });
    }
    for (const problem of check_assignments(plan.data)) refuse('invalid_assignment', `The plan's data changes cannot be applied: ${problem}.`);

    // Each token
    const tokens = clone(state.tokens) as SerializedToken[];
    for (const token of tokens) {
        const from_id = token.activity_id, source = old_nodes.get(from_id);
        const entry: TokenMigration = { token_id: token.id, status: token.status, from_node_id: from_id, ...(source ? { from_node_name: source.name } : {}), to_node_id: from_id, wait: null, outcome: 'unchanged' };
        if (!LIVE.has(token.status)) { result.tokens.push(entry); continue; }
        const ref = { token_id: token.id, node_id: from_id, ...(source ? { node_name: source.name } : {}) };
        const wait = token_wait(from, token);
        if (!wait) {
            refuse('run_in_activity', `Token ${token.id} is in the middle of "${source?.name ?? from_id}": a run can be moved only while it is at rest. Let the step finish, then migrate.`, ref);
            result.tokens.push(entry);
            continue;
        }
        // A token waiting on a child run (24.4): the child's state names nodes of this version, so the run stays where it is
        if (token.context_data?._awaiting_subworkflow || token.context_data?._subworkflow_continuation) {
            refuse('child_run_in_flight', `Token ${token.id} at "${source?.name ?? from_id}" waits on a child run (section 24). A run can be moved only once its child runs have ended.`, ref);
            result.tokens.push(entry);
            continue;
        }
        entry.wait = wait;
        const to_id = mapping[from_id] ?? from_id;
        const target = new_nodes.get(to_id);
        entry.to_node_id = to_id;
        if (target) entry.to_node_name = target.name;
        if (!target) {
            if (!mapping[from_id]) {
                refuse('unmapped_token', `Token ${token.id} ${wait === 'join' ? 'waits at the join' : 'waits at'} "${source?.name ?? from_id}", which version ${to.version} does not have, and the plan does not say where it goes.`, ref);
            }
            result.tokens.push(entry);
            continue;
        }
        if (restart.has(from_id)) {
            entry.outcome = 'restarted';
            token.activity_id = to_id;
            token.context_data = withdraw(token.context_data, from_id);
            token.status = 'active';
        } else {
            const problem = wait_problem(wait, from, from_id, to, to_id, token);
            if (problem) {
                const what = { human: 'a person', agent: "an agent's input", event: 'a business event', timer: 'a timer', join: 'the other branches of a join' }[wait];
                refuse('wait_incompatible', `Token ${token.id} waits for ${what} at "${source?.name ?? from_id}", but at its new node ${problem}. Map it to a node where the wait keeps its meaning, or restart it.`, ref);
                result.tokens.push(entry);
                continue;
            }
            entry.outcome = 'kept';
            token.activity_id = to_id;
            const data = token.context_data;
            if (wait === 'event') {
                // The deadline fixed when the wait began is kept; what follows it is the new node's (18.3)
                const awaited: Record<string, unknown> = { ...(data._awaiting_event as Record<string, unknown>), node_id: to_id };
                const timeout_edge = target.kind === 'event' ? (target.event.event_definition as { timeout_edge_id?: string } | undefined)?.timeout_edge_id : undefined;
                if (timeout_edge) awaited.timeout_edge_id = timeout_edge; else delete awaited.timeout_edge_id;
                data._awaiting_event = awaited;
            }
            if (wait === 'timer' && to_id !== from_id) {
                data[`_timer_due:${to_id}`] = data[`_timer_due:${from_id}`];
                delete data[`_timer_due:${from_id}`];
            }
        }
        result.tokens.push(entry);
    }

    // Changes to data, once every token is known to have a place
    if (!result.refusals.length) {
        for (const token of tokens.filter(t => LIVE.has(t.status))) {
            try { result.data_changes.push(...apply_assignments(token.id, token.context_data, plan.data)); } catch (error) {
                refuse('invalid_assignment', `The plan's data changes cannot be applied to token ${token.id}: ${error instanceof Error ? error.message : String(error)}.`, { token_id: token.id });
            }
        }
    }
    if (result.refusals.length) return result;

    // Completed work is compensated, if the run later fails, by the handler of the node it is mapped to (13.6)
    const meta = clone(state.metadata || {}) as { completed_activities?: { activity_id: string }[] };
    for (const done of meta.completed_activities || []) {
        const target = mapping[done.activity_id];
        if (target && target !== done.activity_id) {
            result.completed_work.push({ from_node_id: done.activity_id, to_node_id: target });
            done.activity_id = target;
        }
    }
    const waiting = tokens.filter(t => t.status === 'waiting');
    const status = tokens.some(t => t.status === 'active') ? 'running' : waiting.some(t => !t.context_data?._awaiting_event) ? 'waiting_human' : waiting.length ? 'waiting_event' : String(state.engine_status);
    result.status = status;
    result.state = {
        ...state, workflow_name: to.name, workflow_version: to.version, engine_status: status, tokens, metadata: meta as Record<string, unknown>,
    };
    return result;
}

/** How one position at which a run can be at rest fares under a change of version */
export interface PositionCompatibility {
    node_id: string;
    node_name: string;
    wait: WaitKind;
    /**
     * compatible: a run at rest here can be moved as the plan (or the identity mapping) says.
     * needs_mapping: it cannot as things stand, but the new version has nodes where its wait keeps its meaning: map it to one.
     * impossible: no node of the new version keeps this wait. Only a plan that restarts the token can move such a run.
     */
    class: 'compatible' | 'needs_mapping' | 'impossible';
    /** Where a run here goes, when it is compatible */
    to_node_id?: string;
    to_node_name?: string;
    outcome?: 'kept' | 'restarted';
    /** Nodes of the new version where the wait keeps its meaning, when it needs a mapping */
    candidates?: { node_id: string; node_name: string }[];
    reason?: string;
}

export interface VersionComparison {
    workflow_id: string;
    from_version: string;
    to_version: string;
    /** True when every position is compatible: every run at rest can be moved without an operator's decision */
    automatic: boolean;
    positions: PositionCompatibility[];
    /** Nodes of the old version the new one does not have, and nodes the new one adds */
    removed: { node_id: string; node_name: string }[];
    added: { node_id: string; node_name: string }[];
}

/** The positions at which a run of a workflow can be at rest, with what it waits for there */
export function rest_positions(workflow: Workflow): { node_id: string; node_name: string; wait: WaitKind }[] {
    const positions: { node_id: string; node_name: string; wait: WaitKind }[] = [];
    for (const [id, node] of node_map(workflow)) {
        if (node.kind === 'activity') {
            if (over_a2a(workflow, node.activity)) positions.push({ node_id: id, node_name: node.name, wait: 'agent' });
            if (node.activity.actor_type === 'human' || node.activity.outcome_contract?.on_violation === 'escalate_human') positions.push({ node_id: id, node_name: node.name, wait: 'human' });
        }
        if (is_waiting_event(node)) positions.push({ node_id: id, node_name: node.name, wait: 'event' });
        if (node.kind === 'event' && node.event.event_type === 'timer') positions.push({ node_id: id, node_name: node.name, wait: 'timer' });
        if (is_join(workflow, node, id)) positions.push({ node_id: id, node_name: node.name, wait: 'join' });
    }
    return positions;
}

/**
 * Compare two versions of a workflow position by position (25.4): for every
 * node where a run of the old version can be at rest, whether a run there can
 * be moved to the new version as the plan says (the identity mapping when
 * there is no plan), needs a mapping, or cannot keep its wait at all.
 */
export function compare_versions(from: Workflow, to: Workflow, plan: MigrationPlan = {}): VersionComparison {
    const mapping = plan.nodes || {};
    const restart = new Set(plan.restart || []);
    const old_nodes = node_map(from), new_nodes = node_map(to);
    const positions: PositionCompatibility[] = [];
    for (const position of rest_positions(from)) {
        const to_id = mapping[position.node_id] ?? position.node_id;
        const target = new_nodes.get(to_id);
        const entry: PositionCompatibility = { ...position, class: 'compatible' };
        if (target && restart.has(position.node_id)) {
            positions.push({ ...entry, to_node_id: to_id, to_node_name: target.name, outcome: 'restarted' });
            continue;
        }
        const problem = target ? wait_problem(position.wait, from, position.node_id, to, to_id) : `version ${to.version} has no node ${position.node_name === to_id ? to_id : `"${position.node_name}"`}`;
        if (!problem) {
            positions.push({ ...entry, to_node_id: to_id, to_node_name: target!.name, outcome: 'kept' });
            continue;
        }
        const candidates = [...new_nodes].filter(([id]) => !wait_problem(position.wait, from, position.node_id, to, id)).map(([id, node]) => ({ node_id: id, node_name: node.name }));
        positions.push({ ...entry, class: candidates.length ? 'needs_mapping' : 'impossible', reason: problem, ...(candidates.length ? { candidates } : {}) });
    }
    return {
        workflow_id: from.id, from_version: from.version, to_version: to.version,
        automatic: positions.every(p => p.class === 'compatible'),
        positions,
        removed: [...old_nodes].filter(([id]) => !new_nodes.has(id)).map(([id, n]) => ({ node_id: id, node_name: n.name })),
        added: [...new_nodes].filter(([id]) => !old_nodes.has(id)).map(([id, n]) => ({ node_id: id, node_name: n.name })),
    };
}

/** Compare two semantic versions: negative when a is older */
export function compare_semver(a: string, b: string): number {
    const pa = a.split('.').map(Number), pb = b.split('.').map(Number);
    for (let i = 0; i < 3; i++) if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) - (pb[i] || 0);
    return 0;
}

/**
 * The journal of a migrated run with the node ids recorded before each
 * migration read as the plan mapped them: what a replay of the run (20.1)
 * matches against the version it ended on.
 */
export function as_migrated(events: JournalEvent[]): JournalEvent[] {
    const sorted = [...events].sort((a, b) => a.seq - b.seq);
    const migrations = sorted.filter(e => e.type === 'run.migrated');
    if (!migrations.length) return sorted;
    return sorted.map(event => {
        let node = event.node_id, from = event.data?.from_node_id as string | undefined, to = event.data?.to_node_id as string | undefined;
        for (const migration of migrations) {
            if (migration.seq <= event.seq) continue;
            const nodes = (migration.data?.nodes || {}) as Record<string, string>;
            if (node && nodes[node]) node = nodes[node];
            if (from && nodes[from]) from = nodes[from];
            if (to && nodes[to]) to = nodes[to];
        }
        if (node === event.node_id && from === event.data?.from_node_id && to === event.data?.to_node_id) return event;
        return {
            ...event, ...(node ? { node_id: node } : {}),
            data: { ...event.data, ...(from !== undefined ? { from_node_id: from } : {}), ...(to !== undefined ? { to_node_id: to } : {}) },
        };
    });
}
