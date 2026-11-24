/**
 * BPMN 2.0 to AWA (specification 27.2 to 27.8).
 *
 * The importer reads a BPMN document into a graph of nodes and flows, folds the shapes an
 * AWA export writes (and that mean the same in BPMN) back into the node they came from,
 * encodes what AWA expresses differently (inclusive gateways), refuses what AWA cannot
 * express, and writes one AWA workflow per process and per embedded subprocess.
 */
import {
    AWA_EXPRESSION_LANGUAGE, AWA_DECISION_ROUTE_LANGUAGE, InterchangeError, type InterchangeWarning,
    awa_id, read_residual, apply_residual, is_object, clone, token_name, type JsonObject, type Json,
} from './common';
import { feel_condition_to_awa } from './expressions';
import { bpmn_moddle, read_xml, awa_extensions, awa_attribute, foreign_attribute } from './moddle';
import { read_dmn } from './dmn';
import { validate_expression } from '../runtime/expression';
import { parse_iso_duration } from '../runtime/duration_utils';
import { validate_workflow, validate_workflow_integrity, parse_workflow } from '../validator';

const ACTOR_TYPES = ['human', 'ai_agent', 'robot', 'application'];
const DEFAULT_ACTOR: Record<string, string> = {
    task: 'human', userTask: 'human', manualTask: 'human',
    serviceTask: 'application', scriptTask: 'application', callActivity: 'application', subProcess: 'application',
};
const ROLE_NAMES: Record<string, string> = { human: 'Human', ai_agent: 'AI agent', robot: 'Robot', application: 'Application' };
const PROGRAM_LANGUAGES: Record<string, string> = {
    python: 'python', typescript: 'typescript', ts: 'typescript', javascript: 'javascript', js: 'javascript', ecmascript: 'javascript',
    java: 'java', sql: 'sql', shell: 'shell', sh: 'shell', bash: 'shell', graphql: 'graphql',
};
const ACTIVITY_TYPES = new Set(['task', 'userTask', 'manualTask', 'serviceTask', 'scriptTask', 'businessRuleTask', 'sendTask', 'receiveTask', 'callActivity', 'subProcess']);
const EVENT_TYPES = new Set(['startEvent', 'endEvent', 'intermediateThrowEvent', 'intermediateCatchEvent']);
const GATEWAY_TYPES = new Set(['exclusiveGateway', 'parallelGateway', 'inclusiveGateway', 'eventBasedGateway']);
const DATA_TYPES = new Set(['dataObject', 'dataObjectReference', 'dataStoreReference']);
/** Why a construct is not imported (27.8) */
const REFUSED: Record<string, string> = {
    complexGateway: 'a complex gateway\'s activation rule has no AWA counterpart',
    transaction: 'AWA has no transactions: compensation (13.6) undoes completed work when a run fails, but nothing is rolled back atomically',
    adHocSubProcess: 'AWA has no ad hoc ordering of activities: every activity is reached by an edge',
    callChoreography: 'choreographies describe exchanges between participants, not a process AWA can run',
    choreographyTask: 'choreographies describe exchanges between participants, not a process AWA can run',
    subChoreography: 'choreographies describe exchanges between participants, not a process AWA can run',
    implicitThrowEvent: 'it is not a BPMN process element',
};

type Kind = 'activity' | 'event' | 'decision' | 'gateway' | 'synthetic';

interface GNode {
    id: string;
    el?: any;
    type: string;
    kind: Kind;
    order: number;
    awa_id: string;
    incoming: GFlow[];
    outgoing: GFlow[];
    join?: 'all';
    default_flow?: GFlow;
    timeout?: { duration: string; flow: GFlow };
    compensation?: GNode;
    folded?: boolean;
    removed?: boolean;
    /** A node the importer made (inclusive gateways), written as it stands */
    awa?: JsonObject;
}

interface GFlow {
    id: string;
    el?: any;
    source: GNode;
    target: GNode;
    order: number;
    awa_id: string;
    condition?: string;
    route?: boolean;
    is_default?: boolean;
    removed?: boolean;
}

export interface ImportBpmnOptions {
    /** DMN documents holding the decision tables that business rule tasks name */
    dmn?: string[];
    /** Leave out the awa: residual: what the BPMN elements alone say. Used by the exporter */
    native?: boolean;
}

export interface ImportBpmnResult {
    /** The workflows, as documents: the first process first, then the others, then subprocesses */
    documents: JsonObject[];
    warnings: InterchangeWarning[];
}

const local = (type: string) => type.replace(/^bpmn:/, '').replace(/^./, c => c.toLowerCase());
const describe_el = (el: any) => `${local(el.$type)} "${el.id}"${el.name ? ` (${el.name})` : ''}`;

function documentation(el: any): string | undefined {
    const texts = (el?.documentation || []).map((d: any) => d.text).filter((t: unknown) => typeof t === 'string' && t.length);
    return texts.length ? texts.join('\n\n') : undefined;
}

interface Ctx {
    doc_id: string;
    definitions: any;
    native: boolean;
    warnings: InterchangeWarning[];
    decisions: Map<string, JsonObject>;
    process_ids: Map<string, string>;
    documents: JsonObject[];
    /** Innermost lane of each flow node, by BPMN id */
    lane_of: Map<string, any>;
    lanes: any[];
}

function warn(ctx: Ctx, el: any, message: string) {
    ctx.warnings.push({ element: el?.id, message: el ? `${describe_el(el)}: ${message}` : message });
}

function refuse(el: any, reason: string): never {
    throw new InterchangeError(`${describe_el(el)} is not imported: ${reason}`);
}

// ---------------------------------------------------------------------------
// Reading of parts
// ---------------------------------------------------------------------------

function flow_condition(flow: any, ctx: Ctx): { condition?: string; route?: boolean } {
    const expression = flow.conditionExpression;
    if (!expression) return {};
    const body = typeof expression.body === 'string' ? expression.body.trim() : '';
    if (!body) return {};
    const language = expression.language || ctx.definitions.expressionLanguage;
    if (language === AWA_DECISION_ROUTE_LANGUAGE) return { route: true };
    if (language === AWA_EXPRESSION_LANGUAGE) {
        const check = validate_expression(body);
        if (!check.valid) throw new InterchangeError(`${describe_el(flow)}: ${check.error}`);
        return { condition: body };
    }
    try {
        return { condition: feel_condition_to_awa(body) };
    } catch (error) {
        throw new InterchangeError(`${describe_el(flow)}: ${(error as Error).message}. AWA conditions compare a property with a value and join comparisons with and, or and not (section 6)`);
    }
}

function event_definition(el: any): any | undefined {
    const defs = el.eventDefinitions || [];
    if (defs.length > 1) refuse(el, 'it has several event definitions; AWA events have one');
    if (el.eventDefinitionRefs?.length) refuse(el, 'it refers to shared event definitions; define the event on the element');
    return defs[0];
}

function message_name(ref: any, el: any, ctx: Ctx, what = 'message'): string {
    if (ref) return ref.name || ref.id;
    warn(ctx, el, `it names no ${what}; the business event is named after the element`);
    return el.name || el.id;
}

function duration_of(el: any, definition: any): string {
    if (definition.timeDate) refuse(el, 'a timer at a date has no AWA counterpart: AWA timers wait for a duration (13.5)');
    if (definition.timeCycle) refuse(el, 'a repeating timer has no AWA counterpart: AWA timers wait once, for a duration (13.5)');
    const body = definition.timeDuration?.body?.trim();
    if (!body) refuse(el, 'the timer has no duration');
    try { parse_iso_duration(body); } catch {
        refuse(el, `the timer duration "${body}" is not an ISO 8601 duration of weeks, days, hours, minutes and seconds (13.5)`);
    }
    return body;
}

function actor_type_of(el: any, type: string): string {
    const declared = awa_attribute(el, 'actorType');
    if (declared !== undefined) {
        if (!ACTOR_TYPES.includes(declared)) throw new InterchangeError(`${describe_el(el)}: awa:actorType "${declared}" is not one of ${ACTOR_TYPES.join(', ')}`);
        return declared;
    }
    return DEFAULT_ACTOR[type] || 'application';
}

function data_objects(el: any): { inputs: JsonObject[]; outputs: JsonObject[] } {
    const inputs: JsonObject[] = [];
    const outputs: JsonObject[] = [];
    const add = (list: JsonObject[], item: any) => {
        const name = item?.name || item?.dataObjectRef?.name || item?.dataStoreRef?.name || item?.id;
        if (!name || list.some(d => d.name === name)) return;
        const data: JsonObject = { name };
        const doc = documentation(item);
        if (doc) data.description = doc;
        list.push(data);
    };
    for (const input of el.ioSpecification?.dataInputs || []) add(inputs, input);
    for (const output of el.ioSpecification?.dataOutputs || []) add(outputs, output);
    for (const association of el.dataInputAssociations || []) {
        for (const source of association.sourceRef || []) if (source && /dataObjectReference|dataStoreReference/i.test(source.$type)) add(inputs, source);
    }
    for (const association of el.dataOutputAssociations || []) {
        const target = association.targetRef;
        if (target && /dataObjectReference|dataStoreReference/i.test(target.$type)) add(outputs, target);
    }
    return { inputs, outputs };
}

// ---------------------------------------------------------------------------
// The graph
// ---------------------------------------------------------------------------

class Graph {
    nodes: GNode[] = [];
    flows: GFlow[] = [];
    by_id = new Map<string, GNode>();
    private synthetic = 0;

    add_node(node: GNode) { this.nodes.push(node); this.by_id.set(node.id, node); return node; }
    connect(flow: GFlow) { flow.source.outgoing.push(flow); flow.target.incoming.push(flow); this.flows.push(flow); return flow; }
    remove_flow(flow: GFlow) {
        flow.removed = true;
        flow.source.outgoing = flow.source.outgoing.filter(f => f !== flow);
        flow.target.incoming = flow.target.incoming.filter(f => f !== flow);
    }
    remove_node(node: GNode) { node.removed = true; }
    retarget(flow: GFlow, target: GNode) {
        flow.target.incoming = flow.target.incoming.filter(f => f !== flow);
        flow.target = target;
        target.incoming.push(flow);
    }
    resource(flow: GFlow, source: GNode) {
        flow.source.outgoing = flow.source.outgoing.filter(f => f !== flow);
        flow.source = source;
        source.outgoing.push(flow);
    }
    next_order(after: number) { this.synthetic += 1; return after + this.synthetic / 10000; }
    live_nodes() { return this.nodes.filter(n => !n.removed); }
}

// ---------------------------------------------------------------------------
// A process or embedded subprocess becomes a workflow
// ---------------------------------------------------------------------------

interface Scope { process_id: string; top: any }

function build_workflow(container: any, ctx: Ctx, head: JsonObject, scope: Scope): JsonObject {
    const top_level = scope.top;
    const g = new Graph();
    const boundary_flows = new Map<any, { boundary: any; target: GNode }>();
    const elements: any[] = container.flowElements || [];
    const boundaries: any[] = [];
    const flows: any[] = [];

    elements.forEach((el, index) => {
        const type = local(el.$type);
        if (type === 'sequenceFlow') { flows.push(el); return; }
        if (REFUSED[type]) refuse(el, REFUSED[type]);
        if (type === 'subProcess' && el.triggeredByEvent) refuse(el, 'an event subprocess starts when an event occurs anywhere in its process; AWA has no handler of that kind');
        if (type === 'boundaryEvent') { boundaries.push(el); return; }
        if (DATA_TYPES.has(type)) return;
        if (type === 'complexGateway') refuse(el, REFUSED.complexGateway);
        let kind: Kind;
        if (ACTIVITY_TYPES.has(type)) {
            if (el.loopCharacteristics) {
                refuse(el, `${local(el.loopCharacteristics.$type) === 'standardLoopCharacteristics' ? 'a loop' : 'multiple instances'} of one activity have no AWA counterpart; draw the repetition as an edge back to the activity, with a condition`);
            }
            kind = type === 'businessRuleTask' ? 'decision' : type === 'sendTask' || type === 'receiveTask' ? 'event' : 'activity';
        } else if (EVENT_TYPES.has(type)) kind = 'event';
        else if (GATEWAY_TYPES.has(type)) kind = 'gateway';
        else refuse(el, 'AWA has no element of this kind');
        g.add_node({ id: el.id, el, type, kind, order: index, awa_id: awa_id(el.id, ctx.doc_id), incoming: [], outgoing: [] });
    });
    for (const el of flows) {
        const source = g.by_id.get(el.sourceRef?.id), target = g.by_id.get(el.targetRef?.id);
        if (!source || !target) {
            const boundary = boundaries.find(b => b.id === el.sourceRef?.id);
            if (boundary && target) { boundary_flows.set(el, { boundary, target }); continue; }
            throw new InterchangeError(`${describe_el(el)} joins elements that are not in the same process`);
        }
        g.connect({ id: el.id, el, source, target, order: elements.indexOf(el), awa_id: awa_id(el.id, ctx.doc_id), ...flow_condition(el, ctx) });
    }
    for (const node of g.nodes) {
        if (node.el?.default) {
            const flow = g.flows.find(f => f.el === node.el.default);
            if (flow) { node.default_flow = flow; flow.is_default = true; }
        }
    }

    // Boundary events: compensation handlers, and a timer on a receive task
    for (const b of boundaries) {
        const host = g.by_id.get(b.attachedToRef?.id);
        if (!host) refuse(b, 'it is not attached to an activity of this process');
        const definition = event_definition(b);
        const outgoing = [...boundary_flows.entries()].filter(([, v]) => v.boundary === b);
        const type = definition ? local(definition.$type) : 'none';
        if (type === 'compensateEventDefinition') {
            const association = [...(container.artifacts || []), ...(top_level.artifacts || [])].find((a: any) => local(a.$type) === 'association' && (a.sourceRef?.id === b.id || a.targetRef?.id === b.id));
            const handler_el = association ? (association.sourceRef?.id === b.id ? association.targetRef : association.sourceRef) : undefined;
            const handler = handler_el ? g.by_id.get(handler_el.id) : undefined;
            if (!handler || handler.kind !== 'activity') refuse(b, 'a compensation boundary event needs an association to the activity that compensates');
            host.compensation = handler;
            continue;
        }
        if (type === 'timerEventDefinition' && host.type === 'receiveTask') {
            if (b.cancelActivity === false) refuse(b, 'a timer that does not interrupt the wait has no AWA counterpart');
            if (outgoing.length !== 1) refuse(b, 'the timer must have exactly one outgoing flow, the path taken when the wait runs out');
            if (host.timeout) refuse(b, 'the receive task already has a timer');
            const [flow_el, { target }] = outgoing[0];
            const flow = g.connect({ id: flow_el.id, el: flow_el, source: host, target, order: elements.indexOf(flow_el), awa_id: awa_id(flow_el.id, ctx.doc_id), ...flow_condition(flow_el, ctx) });
            host.timeout = { duration: duration_of(b, definition), flow };
            continue;
        }
        const reasons: Record<string, string> = {
            errorEventDefinition: 'AWA has no error routing: an activity that raises an error fails its token and the run (5.7); state the alternative as a condition on the activity\'s result, or undo the work with a compensation handler (13.6)',
            timerEventDefinition: 'AWA interrupts an activity only through its outcome contract budget (11.4) or service level (23.3), which fail it rather than take another path; a timer boundary is imported only on a receive task',
            messageEventDefinition: 'AWA activities are not interrupted by messages; wait for the message with a message event instead (18.3)',
            signalEventDefinition: 'AWA activities are not interrupted by signals; wait for the signal with a signal event instead (18.3)',
            escalationEventDefinition: 'AWA has no escalation events; an outcome contract can escalate to a person (11.5)',
            conditionalEventDefinition: 'AWA activities are not interrupted by conditions',
            cancelEventDefinition: 'AWA has no transactions to cancel',
        };
        refuse(b, reasons[type] || 'this boundary event has no AWA counterpart');
    }

    for (const artifact of container.artifacts || []) {
        const type = local(artifact.$type);
        if (type === 'association' && boundaries.some(b => b.id === artifact.sourceRef?.id || b.id === artifact.targetRef?.id)) continue;
        if (!ctx.native) warn(ctx, artifact, `${type === 'textAnnotation' ? 'text annotations' : type === 'group' ? 'groups' : 'associations'} are not imported`);
    }

    collapse_event_based(g, ctx);
    fold_parallel_joins(g);
    fold_exclusive_splits(g);
    encode_inclusive(g, ctx);
    check_routing(g, ctx);
    return emit(g, container, ctx, head, scope);
}

/** An event-based gateway before one message or signal wait and at most one timer is one AWA wait with a timeout (27.5) */
function collapse_event_based(g: Graph, ctx: Ctx) {
    for (const gw of g.live_nodes().filter(n => n.type === 'eventBasedGateway')) {
        const targets = gw.outgoing.map(f => f.target);
        const definition_type = (n: GNode) => (n.type === 'receiveTask' ? 'messageEventDefinition' : n.type === 'intermediateCatchEvent' ? local(event_definition(n.el)?.$type || '') : '');
        const waits = targets.filter(n => ['messageEventDefinition', 'signalEventDefinition'].includes(definition_type(n)));
        const timers = targets.filter(n => definition_type(n) === 'timerEventDefinition');
        if (waits.length !== 1 || timers.length > 1 || waits.length + timers.length !== targets.length) {
            refuse(gw.el, 'AWA waits for one business event, with an optional timeout (18.3); an event-based gateway is imported only before one message or signal event and at most one timer');
        }
        if (targets.some(t => t.incoming.length !== 1)) refuse(gw.el, 'the events after an event-based gateway must be reached only from it');
        const wait = waits[0];
        if (wait.timeout) refuse(gw.el, `${describe_el(wait.el)} already has a timer`);
        for (const f of [...gw.incoming]) g.retarget(f, wait);
        for (const f of [...gw.outgoing]) g.remove_flow(f);
        if (timers[0]) {
            const timer = timers[0];
            if (timer.outgoing.length !== 1) refuse(timer.el, 'the timer after an event-based gateway must have exactly one outgoing flow');
            const flow = timer.outgoing[0];
            g.resource(flow, wait);
            wait.timeout = { duration: duration_of(timer.el, event_definition(timer.el)), flow };
            g.remove_node(timer);
        }
        g.remove_node(gw);
        void ctx;
    }
}

const can_join = (n: GNode) => !n.removed && (n.kind === 'activity' || n.kind === 'event' || (n.kind === 'gateway' && n.type !== 'eventBasedGateway'));

/** A converging parallel gateway whose one outgoing flow leads to a node reached only from it is that node's join "all" */
function fold_parallel_joins(g: Graph) {
    for (const gw of g.live_nodes().filter(n => n.type === 'parallelGateway')) {
        if (gw.incoming.length < 2 || gw.outgoing.length !== 1) continue;
        const flow = gw.outgoing[0];
        const target = flow.target;
        if (!can_join(target) || target.type === 'parallelGateway' || target.incoming.length !== 1 || target.join) continue;
        for (const f of [...gw.incoming]) g.retarget(f, target);
        g.remove_flow(flow);
        g.remove_node(gw);
        target.join = 'all';
    }
}

/** A diverging exclusive gateway right after a node, and reached only from it, routes that node's token (27.4) */
function fold_exclusive_splits(g: Graph) {
    for (const gw of g.live_nodes().filter(n => n.type === 'exclusiveGateway')) {
        if (gw.incoming.length !== 1) continue;
        const flow = gw.incoming[0];
        const source = flow.source;
        if (source.removed || source.kind === 'gateway' || source.kind === 'synthetic') continue;
        const others = source.outgoing.filter(f => f !== flow && f !== source.timeout?.flow);
        if (others.length || source.default_flow) continue;
        if (source.kind === 'decision' && !gw.outgoing.every(f => f.route || f === gw.default_flow || (!f.condition && gw.outgoing.length === 1))) continue;
        if (source.kind !== 'decision' && gw.outgoing.some(f => f.route)) continue;
        for (const f of [...gw.outgoing]) g.resource(f, source);
        if (gw.default_flow) source.default_flow = gw.default_flow;
        g.remove_flow(flow);
        g.remove_node(gw);
        source.folded = true;
    }
}

function reach(start: GNode, stop?: GNode): GNode[] {
    const seen = new Set<GNode>();
    const order: GNode[] = [];
    const queue = [start];
    while (queue.length) {
        const n = queue.shift()!;
        if (n === stop || seen.has(n)) continue;
        seen.add(n);
        order.push(n);
        for (const f of n.outgoing) queue.push(f.target);
    }
    return order;
}

/**
 * An inclusive gateway takes every outgoing flow whose condition holds, and its matching
 * join waits for the branches taken. AWA routing takes one conditional edge, so the split
 * becomes a parallel split into guards, each of which takes its branch or skips it, and
 * every branch meets the join through a merge (27.4).
 */
function encode_inclusive(g: Graph, ctx: Ctx) {
    const inclusive = g.live_nodes().filter(n => n.type === 'inclusiveGateway');
    const matched = new Set<GNode>();
    for (const gw of inclusive) {
        if (gw.incoming.length > 1 && gw.outgoing.length > 1) refuse(gw.el, 'an inclusive gateway that both joins and splits has no AWA counterpart; draw a converging and a diverging gateway');
        if (gw.outgoing.length < 2 && !gw.outgoing.some(f => f.condition)) continue;
        const branches = [...gw.outgoing].sort((a, b) => a.order - b.order);
        const conditional = branches.filter(f => f.condition);
        const plain = branches.filter(f => !f.condition && f !== gw.default_flow);
        if (gw.default_flow && plain.length) refuse(gw.el, 'its default flow can never be taken, since a flow without a condition is always taken');
        const name = gw.el.name || gw.el.id;

        // The matching join: the first converging inclusive gateway every branch reaches
        const reached = branches.map(f => reach(f.target).filter(n => n.type === 'inclusiveGateway' && n.incoming.length > 1 && n !== gw));
        const join = reached[0].find(j => reached.every(list => list.includes(j)));
        const merges = new Map<GFlow, GNode>();
        let skip_end: GNode | undefined;
        if (join) {
            const sets = branches.map(f => new Set(f.target === join ? [] : reach(f.target, join)));
            for (const incoming of [...join.incoming]) {
                const owners = branches.filter((f, i) => f === incoming || sets[i].has(incoming.source));
                if (owners.length !== 1) refuse(gw.el, `its branches do not each reach ${describe_el(join.el)} by their own flows, so which branches were taken cannot be known there`);
            }
            branches.forEach((f, i) => {
                const merge = synthetic_event(g, ctx, join, `#merge:${f.id}`, `${join.el.name || join.el.id}: ${f.el?.name || f.id}`, 'intermediate');
                merges.set(f, merge);
                for (const incoming of [...join.incoming]) {
                    if (incoming === f || sets[i].has(incoming.source)) g.retarget(incoming, merge);
                }
                g.connect({ id: `${join.id}#merged:${f.id}`, source: merge, target: join, order: Number.MAX_SAFE_INTEGER, awa_id: awa_id(join.id, ctx.doc_id, `#merged:${f.id}`) });
            });
            join.join = 'all';
            matched.add(join);
        }
        const skip_target = (f: GFlow): GNode => {
            if (join) return merges.get(f)!;
            if (!skip_end) skip_end = synthetic_event(g, ctx, gw, '#skip-end', `${name}: no branch`, 'end');
            return skip_end;
        };
        const guarded = branches.filter(f => f.condition || f === gw.default_flow);
        for (const f of guarded) {
            const guard = synthetic_event(g, ctx, gw, `#guard:${f.id}`, `${name}: ${f.el?.name || f.id}`, 'intermediate');
            g.connect({ id: `${gw.id}#branch:${f.id}`, source: gw, target: guard, order: Number.MAX_SAFE_INTEGER, awa_id: awa_id(gw.id, ctx.doc_id, `#branch:${f.id}`) });
            g.resource(f, guard);
            if (f === gw.default_flow) {
                f.condition = conditional.map(c => `!(${c.condition})`).join(' && ');
                f.is_default = false;
            }
            g.connect({ id: `${gw.id}#skip:${f.id}`, source: guard, target: skip_target(f), order: Number.MAX_SAFE_INTEGER, awa_id: awa_id(gw.id, ctx.doc_id, `#skip:${f.id}`), is_default: true });
            guard.default_flow = guard.outgoing[guard.outgoing.length - 1];
        }
        gw.default_flow = undefined;
    }
    for (const gw of inclusive) {
        if (gw.incoming.length > 1 && !matched.has(gw)) refuse(gw.el, 'a converging inclusive gateway is imported only as the join of an inclusive split whose branches each reach it; AWA joins wait for every incoming edge (13.2)');
    }
}

function synthetic_event(g: Graph, ctx: Ctx, near: GNode, suffix: string, name: string, event_type: string): GNode {
    const id = awa_id(near.id, ctx.doc_id, suffix);
    return g.add_node({
        id: `${near.id}${suffix}`, type: 'synthetic', kind: 'synthetic', order: g.next_order(near.order), awa_id: id, incoming: [], outgoing: [],
        awa: { id, name, event_type },
    });
}

/** Conditions on flows that leave a task or an event directly mean something else in BPMN than in AWA */
function check_routing(g: Graph, ctx: Ctx) {
    for (const node of g.live_nodes()) {
        const out = node.outgoing.filter(f => f !== node.timeout?.flow);
        if (node.type === 'parallelGateway' && out.some(f => f.condition)) {
            warn(ctx, node.el, 'conditions on the flows of a parallel gateway are ignored, as BPMN ignores them');
            for (const f of out) f.condition = undefined;
        }
        if (node.kind === 'decision' && !node.folded && out.length > 1) {
            refuse(node.el, 'a business rule task with several outgoing flows splits the token in BPMN, and an AWA decision takes one edge; put an exclusive gateway after it');
        }
        if ((node.kind === 'activity' || node.kind === 'event') && !node.folded) {
            const conditional = out.filter(f => f.condition);
            if (conditional.length && (conditional.length > 1 || out.some(f => !f.condition && f !== node.default_flow))) {
                refuse(node.el, 'BPMN takes every conditional flow leaving an activity whose condition holds, and AWA takes one; put an exclusive or inclusive gateway after it');
            }
        }
    }
}

// ---------------------------------------------------------------------------
// Writing the workflow
// ---------------------------------------------------------------------------

function role_of(node: GNode, actor_type: string, ctx: Ctx, process_id: string, roles: Map<string, JsonObject>): string {
    const lane = ctx.lane_of.get(node.id);
    if (lane) {
        const id = awa_id(lane.id, ctx.doc_id);
        if (!roles.has(id)) roles.set(id, lane_role(lane, ctx));
        return id;
    }
    const id = awa_id(process_id, ctx.doc_id, `#role:${actor_type}`);
    if (!roles.has(id)) roles.set(id, { id, name: ROLE_NAMES[actor_type], actor_type });
    return id;
}

function lane_role(lane: any, ctx: Ctx): JsonObject {
    const role: JsonObject = { id: awa_id(lane.id, ctx.doc_id), name: lane.name || lane.id };
    const description = documentation(lane);
    if (description) role.description = description;
    const declared = awa_attribute(lane, 'actorType');
    if (declared !== undefined && !ACTOR_TYPES.includes(declared)) throw new InterchangeError(`${describe_el(lane)}: awa:actorType "${declared}" is not one of ${ACTOR_TYPES.join(', ')}`);
    let actor = declared;
    if (!actor) {
        const first = (lane.flowNodeRef || []).find((n: any) => ctx.lane_of.get(n.id) === lane && DEFAULT_ACTOR[local(n.$type)] !== undefined);
        actor = first ? actor_type_of(first, local(first.$type)) : 'human';
    }
    role.actor_type = actor;
    if (!ctx.native) apply_residual(role, read_residual(awa_extensions(lane), describe_el(lane)));
    return role;
}

function residual_of(node: GNode | GFlow, target: JsonObject, ctx: Ctx) {
    if (ctx.native || !node.el) return;
    apply_residual(target, read_residual(awa_extensions(node.el), describe_el(node.el)));
}

function emit(g: Graph, container: any, ctx: Ctx, head: JsonObject, scope: Scope): JsonObject {
    const process_id = scope.process_id;
    const activities: JsonObject[] = [];
    const events: JsonObject[] = [];
    const decisions: JsonObject[] = [];
    const roles = new Map<string, JsonObject>();
    // Lane roles keep the order of the lanes
    for (const lane of ctx.lanes) {
        if ((lane.flowNodeRef || []).some((n: any) => g.by_id.has(n.id) && ctx.lane_of.get(n.id) === lane) || container === scope.top) {
            roles.set(awa_id(lane.id, ctx.doc_id), lane_role(lane, ctx));
        }
    }
    const live = g.live_nodes().sort((a, b) => a.order - b.order);
    const start_events = live.filter(n => n.type === 'startEvent');
    if (start_events.length > 1) {
        refuse(start_events[1].el, 'a run starts at one node (5.3), and this process has several start events; start the other paths from one start event with a gateway');
    }

    for (const node of live) {
        const el = node.el;
        if (node.kind === 'synthetic') { events.push(clone(node.awa!)); continue; }
        if (node.kind === 'activity') {
            const actor_type = actor_type_of(el, node.type);
            const a: JsonObject = { id: node.awa_id, name: el.name || el.id };
            const description = documentation(el);
            if (description) a.description = description;
            a.role_id = role_of(node, actor_type, ctx, process_id, roles);
            a.actor_type = actor_type;
            const { inputs, outputs } = data_objects(el);
            if (inputs.length) a.inputs = inputs;
            if (outputs.length) a.outputs = outputs;
            if (node.type === 'callActivity') {
                a.is_expandable = true;
                const called = el.calledElement;
                if (called) {
                    if (ctx.process_ids.has(called)) a.expansion_workflow_id = ctx.process_ids.get(called)!;
                    else if (/^_[0-9a-fA-F-]{36}$/.test(called)) a.expansion_workflow_id = called.slice(1);
                    else warn(ctx, el, `the called element "${called}" is not a process of this document, so the activity names no sub-workflow`);
                }
            }
            if (node.type === 'subProcess') {
                a.is_expandable = true;
                const sub_id = awa_id(el.id, ctx.doc_id, '#workflow');
                a.expansion_workflow_id = sub_id;
                const sub_head: JsonObject = { id: sub_id, name: el.name || el.id, parent_workflow_id: String(head.id), expansion_activity_id: node.awa_id };
                ctx.documents.push(build_workflow(el, ctx, sub_head, scope));
            }
            if (node.type === 'scriptTask' && typeof el.script === 'string' && el.script.trim()) {
                const language = PROGRAM_LANGUAGES[String(el.scriptFormat || '').toLowerCase().replace(/^(text|application)\//, '')];
                if (language) a.programs = [{ id: awa_id(el.id, ctx.doc_id, '#script'), name: el.name || el.id, language, code: el.script }];
                else {
                    a.procedure = el.script;
                    warn(ctx, el, `the script format "${el.scriptFormat || 'unspecified'}" is not a program language AWA names, so the script is kept as the activity's procedure`);
                }
            }
            if (node.join) a.join = node.join;
            if (node.compensation) a.compensation = { activity_id: node.compensation.awa_id };
            residual_of(node, a, ctx);
            activities.push(a);
            continue;
        }
        if (node.kind === 'decision') {
            const d: JsonObject = { id: node.awa_id, name: el.name || el.id };
            const description = documentation(el);
            if (description) d.description = description;
            const ref = awa_attribute(el, 'decisionRef') ?? foreign_attribute(el, 'decisionRef');
            const table = ref ? ctx.decisions.get(ref) : undefined;
            const out = node.outgoing;
            if (table) d.decision_table = clone(table.decision_table as JsonObject);
            else {
                if (!ctx.native) warn(ctx, el, ref ? `the decision "${ref}" is not in the DMN documents given, so an external decision engine named "dmn" decides (5.5.4)` : 'it names no DMN decision, so an external decision engine named "dmn" decides (5.5.4)');
                d.decision_engine = {
                    name: 'dmn', ruleset: ref || (el.implementation && el.implementation !== '##unspecified' ? el.implementation : el.name || el.id),
                    options: out.map(f => ({ id: token_name(f.id), output_edge_id: f.awa_id })),
                };
            }
            if (node.default_flow) d.default_output_edge_id = node.default_flow.awa_id;
            else if (out.length === 1) d.default_output_edge_id = out[0].awa_id;
            residual_of(node, d, ctx);
            decisions.push(d);
            continue;
        }
        // Events, send and receive tasks, and gateways
        const e: JsonObject = { id: node.awa_id, name: el.name || el.id };
        const description = documentation(el);
        if (description) e.description = description;
        Object.assign(e, event_fields(node, ctx));
        if (node.join) e.join = node.join;
        residual_of(node, e, ctx);
        events.push(e);
    }

    const edges: JsonObject[] = g.flows.filter(f => !f.removed).sort((a, b) => a.order - b.order).map(f => {
        const edge: JsonObject = { id: f.awa_id, source_id: f.source.awa_id, target_id: f.target.awa_id };
        if (f.condition) edge.condition = f.condition;
        if (f.is_default && f.source.kind !== 'decision') edge.is_default = true;
        if (f.el?.name) edge.label = f.el.name;
        residual_of(f, edge, ctx);
        return edge;
    });

    const workflow: JsonObject = { id: head.id, name: head.name, version: '1.0.0', awa_version: '1.1' };
    for (const key of ['description', 'parent_workflow_id', 'expansion_activity_id']) if (head[key] !== undefined) workflow[key] = head[key];
    if (roles.size) workflow.roles = [...roles.values()];
    workflow.activities = activities;
    workflow.edges = edges;
    if (events.length) workflow.events = events;
    if (decisions.length) workflow.decision_nodes = decisions;
    return workflow;
}

function event_fields(node: GNode, ctx: Ctx): JsonObject {
    const el = node.el;
    const out: JsonObject = {};
    const with_timeout = (definition: JsonObject) => {
        if (node.timeout) { definition.timeout = node.timeout.duration; definition.timeout_edge_id = node.timeout.flow.awa_id; }
        return definition;
    };
    if (node.kind === 'gateway') {
        out.event_type = 'intermediate';
        if (node.type === 'parallelGateway' && node.incoming.length > 1) node.join = 'all';
        out['bpmn:gateway'] = node.type.replace('Gateway', '');
        return out;
    }
    if (node.type === 'sendTask') return { event_type: 'message', event_definition: { name: message_name(el.messageRef, el, ctx), mode: 'publish' } };
    if (node.type === 'receiveTask') return { event_type: 'message', event_definition: with_timeout({ name: message_name(el.messageRef, el, ctx) }) };
    const definition = event_definition(el);
    const type = definition ? local(definition.$type) : 'none';
    const unsupported = (reason: string): never => refuse(el, reason);
    switch (node.type) {
        case 'startEvent':
            if (type === 'messageEventDefinition') return { event_type: 'start', event_definition: { name: message_name(definition.messageRef, el, ctx) } };
            if (type === 'signalEventDefinition') return { event_type: 'start', event_definition: { name: message_name(definition.signalRef, el, ctx, 'signal') } };
            if (type === 'timerEventDefinition' || type === 'conditionalEventDefinition') {
                warn(ctx, el, `a ${type === 'timerEventDefinition' ? 'timer' : 'conditional'} start event is imported as a start event: when to start a run is the host's decision`);
            } else if (type !== 'none') unsupported('this kind of start event has no AWA counterpart');
            return { event_type: 'start' };
        case 'endEvent':
            if (type === 'none') return { event_type: 'end' };
            if (type === 'messageEventDefinition') return { event_type: 'message', event_definition: { name: message_name(definition.messageRef, el, ctx), mode: 'publish' } };
            if (type === 'signalEventDefinition') return { event_type: 'signal', event_definition: { name: message_name(definition.signalRef, el, ctx, 'signal'), mode: 'publish' } };
            if (type === 'errorEventDefinition') {
                if (!ctx.native) warn(ctx, el, 'an error end event is imported as an AWA error event, which fails the token that reaches it (13.4)');
                const ref = definition.errorRef;
                return ref ? { event_type: 'error', event_definition: { name: ref.errorCode || ref.name || ref.id } } : { event_type: 'error' };
            }
            if (type === 'terminateEventDefinition') unsupported('a terminate end event ends every branch of the run, and an AWA end event completes one token (13.4)');
            if (type === 'compensateEventDefinition') unsupported('AWA compensates when a run fails (13.6); it has no event that starts compensation');
            if (type === 'escalationEventDefinition') unsupported('AWA has no escalation events; an outcome contract can escalate to a person (11.5)');
            if (type === 'cancelEventDefinition') unsupported('AWA has no transactions to cancel');
            return unsupported('this kind of end event has no AWA counterpart');
        case 'intermediateThrowEvent':
            if (type === 'none') return { event_type: 'intermediate' };
            if (type === 'messageEventDefinition') return { event_type: 'message', event_definition: { name: message_name(definition.messageRef, el, ctx), mode: 'publish' } };
            if (type === 'signalEventDefinition') return { event_type: 'signal', event_definition: { name: message_name(definition.signalRef, el, ctx, 'signal'), mode: 'publish' } };
            if (type === 'compensateEventDefinition') unsupported('AWA compensates when a run fails (13.6); it has no event that starts compensation');
            if (type === 'linkEventDefinition') unsupported('link events are a drawing aid; draw the sequence flow they stand for');
            if (type === 'escalationEventDefinition') unsupported('AWA has no escalation events; an outcome contract can escalate to a person (11.5)');
            return unsupported('this kind of intermediate event has no AWA counterpart');
        case 'intermediateCatchEvent':
            if (type === 'timerEventDefinition') return { event_type: 'timer', event_definition: { duration: duration_of(el, definition) } };
            if (type === 'messageEventDefinition') return { event_type: 'message', event_definition: with_timeout({ name: message_name(definition.messageRef, el, ctx) }) };
            if (type === 'signalEventDefinition') return { event_type: 'signal', event_definition: with_timeout({ name: message_name(definition.signalRef, el, ctx, 'signal') }) };
            if (type === 'conditionalEventDefinition') {
                if (!ctx.native) warn(ctx, el, 'a conditional event is imported as an AWA conditional event, which is reserved and fails the token that reaches it (13.4)');
                const body = definition.condition?.body?.trim();
                return body ? { event_type: 'conditional', event_definition: { condition: body } } : { event_type: 'conditional' };
            }
            if (type === 'linkEventDefinition') unsupported('link events are a drawing aid; draw the sequence flow they stand for');
            return unsupported('this kind of intermediate event has no AWA counterpart');
    }
    return unsupported('AWA has no element of this kind');
}

// ---------------------------------------------------------------------------
// The document
// ---------------------------------------------------------------------------

function collect_lanes(container: any, ctx: Ctx) {
    const visit = (lanes: any[]) => {
        for (const lane of lanes || []) {
            ctx.lanes.push(lane);
            for (const node of lane.flowNodeRef || []) ctx.lane_of.set(node.id, lane);
            if (lane.childLaneSet) visit(lane.childLaneSet.lanes);
        }
    };
    for (const set of container.laneSets || []) visit(set.lanes);
}

/** Read a BPMN 2.0 document into AWA workflow documents */
export async function import_bpmn(xml: string, options: ImportBpmnOptions = {}): Promise<ImportBpmnResult> {
    const moddle = await bpmn_moddle();
    const definitions = await read_xml(moddle, xml, 'BPMN');
    if (definitions.$type !== 'bpmn:Definitions') throw new InterchangeError('The BPMN document does not start with <definitions>');
    const warnings: InterchangeWarning[] = [];
    const decisions = new Map<string, JsonObject>();
    for (const dmn of options.dmn || []) {
        const read = await read_dmn(dmn);
        warnings.push(...read.warnings);
        for (const [id, node] of read.decisions) decisions.set(id, node);
    }
    const doc_id = definitions.id || 'definitions';
    const roots: any[] = definitions.rootElements || [];
    const processes = roots.filter(r => r.$type === 'bpmn:Process');
    if (!processes.length) throw new InterchangeError('The BPMN document has no process');
    const participants = roots.filter(r => r.$type === 'bpmn:Collaboration').flatMap(c => c.participants || []);
    const ctx: Ctx = {
        doc_id, definitions, native: !!options.native, warnings, decisions,
        process_ids: new Map(processes.map(p => [p.id, awa_id(p.id, doc_id)])),
        documents: [], lane_of: new Map(), lanes: [],
    };
    if (roots.some(r => r.$type === 'bpmn:Collaboration' && (r.messageFlows || []).length)) {
        warnings.push({ message: 'Message flows between pools are not imported: the message events at either end name the business events that carry them (section 18)' });
    }
    const top_documents: JsonObject[] = [];
    for (const process of processes) {
        ctx.lane_of = new Map();
        ctx.lanes = [];
        collect_lanes(process, ctx);
        const participant = participants.find((p: any) => p.processRef?.id === process.id);
        const head: JsonObject = { id: ctx.process_ids.get(process.id)!, name: process.name || participant?.name || process.id };
        const description = documentation(process);
        if (description) head.description = description;
        const workflow = build_workflow(process, ctx, head, { process_id: process.id, top: process });
        let document: JsonObject = workflow;
        if (!ctx.native) {
            const extensions = awa_extensions(process);
            apply_residual(workflow, read_residual(extensions, describe_el(process)));
            const envelope = extensions.find(e => e.name === 'envelope');
            if (envelope) {
                let value: unknown;
                try { value = JSON.parse(envelope.body); } catch { throw new InterchangeError(`${describe_el(process)}: the content of awa:envelope is not JSON`); }
                if (!is_object(value)) throw new InterchangeError(`${describe_el(process)}: awa:envelope must hold a JSON object`);
                document = { ...value, workflow: workflow as Json };
            }
        }
        top_documents.push(document);
    }
    const documents = [...top_documents, ...ctx.documents];
    if (!options.native) for (const document of documents) check_imported(document);
    return { documents, warnings };
}

/** What an import gives is a valid AWA document, or the import fails */
function check_imported(document: JsonObject) {
    const workflow = (is_object(document.workflow) && !document.activities ? document.workflow : document) as JsonObject;
    const schema = validate_workflow(workflow);
    const problems = schema.valid ? validate_workflow_integrity(parse_workflow(workflow)).errors : schema.errors;
    if (problems.length) {
        throw new InterchangeError(`The workflow "${workflow.name}" read from BPMN is not a valid AWA document: ${problems.slice(0, 5).map(p => `${p.path ? `${p.path}: ` : ''}${p.message}`).join('; ')}`);
    }
}
