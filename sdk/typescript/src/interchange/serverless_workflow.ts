/**
 * AWA to CNCF Serverless Workflow 1.0 (specification 27.11). An export of what maps, with
 * the list of what does not.
 */
import { InterchangeError, is_object, type JsonObject, type Json } from './common';
import { awa_condition_to_jq, unary_tests_to_jq, jq_path } from './expressions';
import { check_document, unwrap_document } from './bpmn_export';
import { serverless_workflow_sdk } from './moddle';

/** Something of the workflow the export does not carry, and why */
export interface NotMapped { node?: string; property?: string; reason: string }

export interface ServerlessWorkflowExport { document: JsonObject; not_mapped: NotMapped[] }

export const SW_DSL_VERSION = '1.0.0';
export const SW_EVENT_SOURCE = 'https://awa.io';
export const SW_ERROR_BASE = 'https://awa.io/errors';

/** Properties that have no Serverless Workflow counterpart, with the reason given for each */
const NODE_PROPERTIES: Record<string, string> = {
    verification: 'Serverless Workflow has no acceptance verification of a task\'s output (section 7)',
    outcome_contract: 'Serverless Workflow has no outcome contract (section 11)',
    tools: 'Serverless Workflow tasks do not hand tools to an actor (section 17)',
    knowledge: 'Serverless Workflow has no knowledge given to actors (section 15)',
    context_bindings: 'Serverless Workflow has no shared contexts with bindings (section 22)',
    compensation: 'Serverless Workflow has no compensation of completed tasks (13.6)',
    sla: 'Serverless Workflow has timeouts that fail a task, not service levels that are measured (section 23)',
    skills: 'skills required of the actor are descriptive',
    tool_requirements: 'tool requirements of the actor are descriptive',
    access_rights: 'access rights are descriptive',
    controls: 'controls are descriptive',
    programs: 'programs are not called: the activity is requested from whoever performs it',
    analytics: 'value stream metrics are descriptive',
    subworkflow: 'the mapping of a child run\'s input and output (24.1) is not exported; a run task would express it as jq input and output expressions',
};
const WORKFLOW_PROPERTIES: Record<string, string> = {
    roles: 'Serverless Workflow has no roles; the role of each activity is carried in the event that requests it',
    contexts: 'Serverless Workflow has no shared contexts (section 22)',
    sla: 'Serverless Workflow has a workflow timeout that fails the run, not a service level that is measured (section 23)',
    analytics: 'value stream metrics are descriptive',
};

function slug(text: string, max = 63): string {
    const s = text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, max).replace(/-+$/g, '');
    return s || 'task';
}

type Task = Record<string, JsonObject>;

interface Scope { join?: JsonObject; in_branch: boolean; owner: string }

class Exporter {
    private names = new Map<string, string>();
    private used = new Set<string>();
    private emitted = new Set<string>();
    private owner = new Map<string, string>();
    not_mapped: NotMapped[] = [];
    private nodes = new Map<string, JsonObject>();
    private kind = new Map<string, 'activity' | 'event' | 'decision'>();
    private edges: JsonObject[];
    private extra_tasks: Task[] = [];

    constructor(private w: JsonObject) {
        for (const a of (w.activities as JsonObject[]) || []) { this.nodes.set(String(a.id), a); this.kind.set(String(a.id), 'activity'); }
        for (const e of (w.events as JsonObject[]) || []) { this.nodes.set(String(e.id), e); this.kind.set(String(e.id), 'event'); }
        for (const d of (w.decision_nodes as JsonObject[]) || []) { this.nodes.set(String(d.id), d); this.kind.set(String(d.id), 'decision'); }
        this.edges = (w.edges as JsonObject[]) || [];
    }

    private name(node: JsonObject): string {
        const id = String(node.id);
        if (!this.names.has(id)) this.names.set(id, this.unique(slug(String(node.name))));
        return this.names.get(id)!;
    }
    private unique(base: string): string {
        let name = base, i = 2;
        while (this.used.has(name)) name = `${base.slice(0, 60)}-${i++}`;
        this.used.add(name);
        return name;
    }
    private out(id: string) { return this.edges.filter(e => e.source_id === id); }
    private inc(id: string) { return this.edges.filter(e => e.target_id === id); }
    private note(node: JsonObject | undefined, property: string | undefined, reason: string) {
        const item: NotMapped = { reason };
        if (node) item.node = String(node.name);
        if (property) item.property = property;
        this.not_mapped.push(item);
    }
    private timeout_edge(node: JsonObject): string | undefined {
        const def = is_object(node.event_definition) ? node.event_definition : undefined;
        return def && typeof def.timeout === 'string' && typeof def.timeout_edge_id === 'string' ? def.timeout_edge_id : undefined;
    }
    private routed(node: JsonObject) {
        const t = this.timeout_edge(node);
        return this.out(String(node.id)).filter(e => e.id !== t);
    }

    /** A start or intermediate event with one plain way on is not a task */
    private elided(node: JsonObject): boolean {
        if (this.kind.get(String(node.id)) !== 'event' || !['start', 'intermediate'].includes(String(node.event_type))) return false;
        const out = this.routed(node);
        return out.length === 1 && typeof out[0].condition !== 'string' && out[0].is_default !== true && node.join !== 'all';
    }

    /** The task a flow goes to, or a flow directive */
    ref(id: string, scope: Scope, seen = new Set<string>()): string {
        const node = this.nodes.get(id)!;
        if (scope.join && id === scope.join.id) return 'exit';
        if (node.event_type === 'end' && this.kind.get(id) === 'event') return scope.in_branch ? 'exit' : 'end';
        if (this.elided(node)) {
            if (seen.has(id)) throw new InterchangeError(`Events "${node.name}" and those after it lead to each other and to nothing else`);
            seen.add(id);
            return this.ref(String(this.routed(node)[0].target_id), scope, seen);
        }
        return this.name(node);
    }

    /** The tasks of one list: the whole workflow, or one branch of a parallel split */
    scope(starts: string[], scope: Scope): Task[] {
        const list: Task[] = [];
        const queue = [...starts];
        while (queue.length) {
            const id = queue.shift()!;
            const node = this.nodes.get(id)!;
            if (this.emitted.has(id) || (scope.join && id === scope.join.id)) continue;
            if (this.kind.get(id) === 'event' && node.event_type === 'end') continue;
            const owner = this.owner.get(id);
            if (owner && owner !== scope.owner) {
                throw new InterchangeError(`"${node.name}" is reached both from inside a parallel branch and from outside it, which Serverless Workflow's nested branches cannot express`);
            }
            this.owner.set(id, scope.owner);
            if (this.elided(node)) { queue.push(String(this.routed(node)[0].target_id)); this.emitted.add(id); continue; }
            this.emitted.add(id);
            const { tasks, next } = this.node_tasks(node, scope);
            list.push(...tasks);
            queue.push(...next);
        }
        return list;
    }

    private node_tasks(node: JsonObject, scope: Scope): { tasks: Task[]; next: string[] } {
        const id = String(node.id);
        const kind = this.kind.get(id)!;
        const name = this.name(node);
        const tasks: Task[] = [];
        let body: JsonObject;
        if (kind === 'activity') body = this.activity(node);
        else if (kind === 'event') body = this.event(node, scope);
        else return this.decision(node, scope);
        if (node.join === 'all' && !this.is_fork_join(id)) {
            this.note(node, 'join', 'the parallel branches that reach this node do not start at one split, so its join "all" cannot be a fork; it runs once per arrival');
        }
        const routing = this.routing(node, scope);
        if (routing.then) body.then = routing.then;
        tasks.push({ [name]: body }, ...routing.tasks);
        return { tasks, next: routing.next };
    }

    private is_fork_join(id: string): boolean { return this.fork_joins.has(id); }
    private fork_joins = new Set<string>();

    private activity(a: JsonObject): JsonObject {
        for (const [key, reason] of Object.entries(NODE_PROPERTIES)) if (a[key] !== undefined && !(Array.isArray(a[key]) && !(a[key] as Json[]).length)) this.note(a, key, reason);
        if (a.is_expandable === true && typeof a.expansion_workflow_id === 'string') {
            this.note(a, 'expansion_workflow_id', 'the sub-workflow is named by its AWA identifier, as workflow "awa-<id>" version "latest"; export it as well under that name');
            return { run: { workflow: { namespace: 'awa', name: `awa-${a.expansion_workflow_id}`, version: 'latest' } } };
        }
        const data: JsonObject = { activity_id: String(a.id), activity: String(a.name), actor_type: String(a.actor_type) };
        if (a.role_id !== undefined) data.role_id = a.role_id as Json;
        if (typeof a.description === 'string') data.description = a.description;
        const steps: Task[] = [
            { request: { emit: { event: { with: { source: SW_EVENT_SOURCE, type: 'io.awa.activity.requested', subject: String(a.id), data } } } } },
            { complete: { listen: { to: { one: { with: { type: 'io.awa.activity.completed', subject: String(a.id) } } } }, output: { as: '${ $input + (.[0].data // .[0] // {}) }' } } },
        ];
        if (is_object(a.retry)) {
            const r = a.retry;
            return {
                try: steps as unknown as Json,
                catch: { retry: { delay: String(r.initial_delay ?? 'PT1S'), backoff: { exponential: {} }, limit: { attempt: { count: Number(r.max_attempts ?? 1) } } } },
            };
        }
        return { do: steps as unknown as Json };
    }

    private event(e: JsonObject, scope: Scope): JsonObject {
        const def = is_object(e.event_definition) ? e.event_definition : {};
        const type = String(e.event_type);
        if (e['bpmn:gateway'] !== undefined || type === 'start' || type === 'intermediate') {
            return { wait: 'PT0S' };
        }
        if (type === 'timer') return { wait: String(def.duration) };
        if (type === 'message' || type === 'signal') {
            if (def.mode === 'publish') {
                const fields = Array.isArray(def.data) ? (def.data as string[]) : undefined;
                const data = fields ? `\${ {${fields.map(f => `${JSON.stringify(f)}: ${jq_path(f)}`).join(', ')}} }` : '${ . }';
                return { emit: { event: { with: { source: SW_EVENT_SOURCE, type: String(def.name), data } } } };
            }
            const filter: JsonObject = { with: { type: String(def.name) } };
            if (typeof def.correlation_key === 'string') filter.correlate = { key: { from: `\${ .data.${def.correlation_key} }`, expect: `\${ ${jq_path(def.correlation_key)} }` } };
            const task: JsonObject = { listen: { to: { one: filter } }, output: { as: '${ $input + (.[0].data // .[0] // {}) }' } };
            if (typeof def.timeout === 'string') {
                task.timeout = { after: def.timeout };
                if (this.timeout_edge(e)) this.note(e, 'event_definition.timeout_edge_id', 'when the wait runs out the task fails with a timeout error; the path the timeout edge takes is not followed');
            }
            return task;
        }
        if (type === 'error') return { raise: { error: { type: `${SW_ERROR_BASE}/${slug(String(def.name ?? e.name))}`, status: 500, title: String(e.name) } } };
        this.note(e, 'event_type', `AWA ${type} events are reserved (13.4); the export raises an error where one is reached`);
        void scope;
        return { raise: { error: { type: `${SW_ERROR_BASE}/unsupported-event`, status: 500, title: String(e.name) } } };
    }

    private no_route(node: JsonObject): string {
        const name = this.unique(`${this.name(node)}-no-route`);
        this.extra_tasks.push({ [name]: { raise: { error: { type: `${SW_ERROR_BASE}/no-route`, status: 500, title: `No route from ${node.name}` } }, then: 'end' } });
        return name;
    }

    /** How the token leaves a node: a plain then, a switch, or a fork */
    private routing(node: JsonObject, scope: Scope): { then?: string; tasks: Task[]; next: string[] } {
        const out = this.routed(node);
        const t = this.timeout_edge(node);
        const next = out.map(e => String(e.target_id));
        if (t) next.push(String(this.edges.find(e => e.id === t)!.target_id));
        if (!out.length) return { then: scope.in_branch ? 'exit' : 'end', tasks: [], next };
        const conditional = out.filter(e => typeof e.condition === 'string');
        const fallback = out.find(e => e.is_default === true);
        const plain = out.filter(e => typeof e.condition !== 'string' && e.is_default !== true);
        if (!conditional.length && !fallback) {
            if (plain.length === 1) return { then: this.ref(String(plain[0].target_id), scope), tasks: [], next };
            return this.fork(node, plain, scope);
        }
        const cases: JsonObject[] = conditional.map((e, i) => ({ [e.label ? slug(String(e.label)) : `when-${i + 1}`]: { when: `\${ ${awa_condition_to_jq(String(e.condition))} }`, then: this.ref(String(e.target_id), scope) } }));
        if (fallback) cases.push({ default: { then: this.ref(String(fallback.target_id), scope) } });
        else if (plain.length === 1) cases.push({ default: { then: this.ref(String(plain[0].target_id), scope) } });
        else {
            if (plain.length > 1) this.note(node, 'edges', 'when no condition holds the token would split over several edges, which a switch cannot do; the export raises an error instead');
            cases.push({ default: { then: this.no_route(node) } });
        }
        const router = this.unique(`${this.name(node)}-route`);
        return { then: router, tasks: [{ [router]: { switch: cases as unknown as Json } }], next };
    }

    private fork(node: JsonObject, edges: JsonObject[], scope: Scope): { then?: string; tasks: Task[]; next: string[] } {
        const targets = edges.map(e => String(e.target_id));
        const reach = (start: string, stop?: string): string[] => {
            const seen: string[] = [];
            const queue = [start];
            while (queue.length) {
                const id = queue.shift()!;
                if (id === stop || seen.includes(id)) continue;
                seen.push(id);
                for (const e of this.out(id)) queue.push(String(e.target_id));
            }
            return seen;
        };
        const candidates = reach(targets[0]).filter(id => this.nodes.get(id)!.join === 'all' && targets.every(t => reach(t).includes(id)));
        const join = candidates.length ? this.nodes.get(candidates[0]) : undefined;
        const sets = targets.map(t => reach(t, join ? String(join.id) : undefined));
        sets.forEach((set, i) => sets.forEach((other, j) => {
            if (i < j && set.some(id => other.includes(id))) throw new InterchangeError(`The parallel branches after "${node.name}" meet before they reach a join, which Serverless Workflow's nested branches cannot express`);
        }));
        if (join) this.fork_joins.add(String(join.id));
        const branches = targets.map((target, i) => {
            const owner = `${node.id}#${i}`;
            const inner: Scope = { join, in_branch: true, owner };
            const first = this.ref(target, inner);
            const tasks = this.scope([target], inner);
            if (!tasks.length || first === 'exit' || first === 'end') tasks.unshift({ [this.unique(`${this.name(node)}-branch-${i + 1}-empty`)]: { wait: 'PT0S', then: first === 'end' ? 'exit' : first } });
            check_then(tasks, `a branch after "${node.name}"`);
            const label = edges[i].label ? slug(String(edges[i].label)) : `branch-${i + 1}`;
            return { [label]: { do: tasks as unknown as Json } };
        });
        const split = this.unique(`${this.name(node)}-split`);
        const after = join ? this.ref(String(join.id), scope) : scope.in_branch ? 'exit' : 'end';
        return { then: split, tasks: [{ [split]: { fork: { branches: branches as unknown as Json, compete: false }, then: after } }], next: join ? [String(join.id)] : [] };
    }

    private decision(d: JsonObject, scope: Scope): { tasks: Task[]; next: string[] } {
        const name = this.name(d);
        const table = is_object(d.decision_table) ? d.decision_table : undefined;
        const next = this.out(String(d.id)).map(e => String(e.target_id));
        if (d.decision_model) this.note(d, 'decision_model', table ? 'the model that decides when no rule matches is not called; the default edge is taken instead' : 'a model decides here, which Serverless Workflow cannot express; the export raises an error');
        if (d.decision_engine) this.note(d, 'decision_engine', 'an external decision engine decides here, which Serverless Workflow cannot express; the export raises an error');
        const policy = table ? String(table.hit_policy) : '';
        if (!table || !['first', 'unique', 'any'].includes(policy)) {
            if (table) this.note(d, 'decision_table.hit_policy', `hit policy ${policy} cannot be written as a switch; the export raises an error`);
            return { tasks: [{ [name]: { raise: { error: { type: `${SW_ERROR_BASE}/decision-not-mapped`, status: 500, title: String(d.name) } }, then: 'end' } }], next };
        }
        if (policy !== 'first') this.note(d, 'decision_table.hit_policy', `hit policy ${policy} is written as first: a conflict between rules is not detected`);
        this.note(d, 'decision_table.outputs', 'the outputs of the deciding rule are not merged into the data; only the route is kept');
        const inputs = (table.inputs as JsonObject[]) || [];
        const default_target = typeof d.default_output_edge_id === 'string' ? this.edges.find(e => e.id === d.default_output_edge_id)?.target_id : undefined;
        const cases: JsonObject[] = ((table.rules as JsonObject[]) || []).map((rule, i) => {
            const tests = ((rule.input_entries as string[]) || []).map((entry, j) => unary_tests_to_jq(entry, String(inputs[j]?.name))).filter(t => t !== 'true');
            const target = rule.output_edge_id ? this.edges.find(e => e.id === rule.output_edge_id)?.target_id : default_target;
            return { [`rule-${i + 1}`]: { when: `\${ ${tests.length ? tests.join(' and ') : 'true'} }`, then: target ? this.ref(String(target), scope) : this.no_route(d) } };
        });
        cases.push({ default: { then: default_target ? this.ref(String(default_target), scope) : this.no_route(d) } });
        return { tasks: [{ [name]: { switch: cases as unknown as Json } }], next };
    }

    build(): Task[] {
        const events = (this.w.events as JsonObject[]) || [];
        const activities = (this.w.activities as JsonObject[]) || [];
        const start = events.find(e => e.event_type === 'start')
            || activities.find(a => !this.inc(String(a.id)).length && !this.is_handler(a))
            || activities[0];
        const top: Scope = { in_branch: false, owner: 'top' };
        const tasks = start ? this.scope([String(start.id)], top) : [];
        // Nodes no flow reaches from the start come after, so that nothing is lost
        for (const [id, node] of this.nodes) if (!this.emitted.has(id) && !this.is_handler(node)) tasks.push(...this.scope([id], top));
        for (const a of activities) if (this.is_handler(a)) this.note(a, undefined, 'a compensation handler runs only when a run fails (13.6), which the export does not express');
        tasks.push(...this.extra_tasks);
        return tasks;
    }
    private is_handler(a: JsonObject): boolean {
        return ((this.w.activities as JsonObject[]) || []).some(x => is_object(x.compensation) && x.compensation.activity_id === a.id);
    }
}

/** Every then in a list names a task of that list or a flow directive */
function check_then(tasks: Task[], where: string) {
    const names = new Set(tasks.map(t => Object.keys(t)[0]));
    const directives = new Set(['continue', 'exit', 'end']);
    const visit = (value: unknown) => {
        if (Array.isArray(value)) { value.forEach(visit); return; }
        if (!is_object(value)) return;
        for (const [key, inner] of Object.entries(value)) {
            if (key === 'then' && typeof inner === 'string' && !names.has(inner) && !directives.has(inner)) {
                throw new InterchangeError(`In ${where}, "${inner}" is reached from a list of tasks it is not in, which Serverless Workflow's nested branches cannot express`);
            }
            if (key !== 'do' && key !== 'fork' && key !== 'try') visit(inner);
        }
    };
    for (const task of tasks) visit(Object.values(task)[0]);
}

/**
 * Export a workflow as a CNCF Serverless Workflow 1.0 document, and list what of it the
 * export does not carry. The document is checked with the Serverless Workflow SDK when it
 * is installed, unless `validate` is false.
 */
export async function export_serverless_workflow(document: JsonObject, options: { validate?: boolean } = {}): Promise<ServerlessWorkflowExport> {
    check_document(document);
    const w = unwrap_document(document);
    const exporter = new Exporter(w);
    const tasks = exporter.build();
    check_then(tasks, `workflow "${w.name}"`);
    const header: JsonObject = { dsl: SW_DSL_VERSION, namespace: 'awa', name: slug(String(w.name)), version: String(w.version), title: String(w.name) };
    if (typeof w.description === 'string') header.summary = w.description;
    header.metadata = { awa_workflow_id: String(w.id), ...(w.awa_version ? { awa_version: String(w.awa_version) } : {}) };
    const sw: JsonObject = { document: header };
    const start = ((w.events as JsonObject[]) || []).find(e => e.event_type === 'start');
    const start_name = is_object(start?.event_definition) ? start!.event_definition.name : undefined;
    if (typeof start_name === 'string') sw.schedule = { on: { one: { with: { type: start_name } } } };
    sw.do = tasks as unknown as Json;
    for (const [key, reason] of Object.entries(WORKFLOW_PROPERTIES).reverse()) {
        if (w[key] !== undefined && !(Array.isArray(w[key]) && !(w[key] as Json[]).length)) exporter.not_mapped.unshift({ property: key, reason });
    }
    if (options.validate !== false) {
        const sdk = await serverless_workflow_sdk();
        try { sdk.validate('Workflow', sw); } catch (error) {
            throw new InterchangeError(`The Serverless Workflow document written for "${w.name}" is not valid; this is a defect of the exporter: ${(error as Error).message.split('\n').slice(0, 3).join(' ')}`);
        }
    }
    return { document: sw, not_mapped: exporter.not_mapped };
}
