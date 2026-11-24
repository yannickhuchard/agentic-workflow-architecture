/**
 * AWA to BPMN 2.0 (specification 27.2 to 27.7).
 *
 * The exporter writes each workflow as a BPMN process using BPMN's own elements wherever
 * BPMN can say the same thing, then reads that process back natively and keeps in the awa:
 * namespace exactly what the BPMN elements did not give back: the residual. Reading the
 * export gives the original documents again, or the export fails.
 */
import {
    AWA_INTERCHANGE_NAMESPACE, AWA_EXPRESSION_LANGUAGE, AWA_DECISION_ROUTE_LANGUAGE, FEEL_LANGUAGE, DMN13_NAMESPACE,
    InterchangeError, type InterchangeWarning, xml_id, residual, residual_extensions, json_equal, clone, is_object,
    type JsonObject, type Residual,
} from './common';
import { awa_condition_to_feel } from './expressions';
import { bpmn_moddle, add_extensions } from './moddle';
import { write_dmn } from './dmn';
import { import_bpmn } from './bpmn_import';
import { lay_out } from './bpmn_layout';
import { validate_workflow, validate_workflow_integrity, parse_workflow } from '../validator';

export interface ExportBpmnOptions {
    /** Write a diagram (BPMNDI) so that modelling tools can draw the process. Default true */
    diagram?: boolean;
}

export interface ExportBpmnResult {
    bpmn: string;
    /** The decision tables, when a workflow has any. Business rule tasks name their decisions in it */
    dmn?: string;
    warnings: InterchangeWarning[];
}

const DEFAULT_ACTOR: Record<string, string> = { 'bpmn:UserTask': 'human', 'bpmn:ServiceTask': 'application', 'bpmn:CallActivity': 'application' };
const COLLECTIONS = ['roles', 'activities', 'events', 'decision_nodes', 'edges'];

export const unwrap_document = (document: JsonObject): JsonObject =>
    (is_object(document.workflow) && !('activities' in document) ? document.workflow : document) as JsonObject;

/** Refuse a document that is not valid: only valid documents have a meaning to carry over */
export function check_document(document: JsonObject, what = 'workflow'): void {
    const workflow = unwrap_document(document);
    const schema = validate_workflow(workflow);
    const problems = schema.valid ? validate_workflow_integrity(parse_workflow(workflow)).errors : schema.errors;
    if (problems.length) {
        throw new InterchangeError(`The ${what} "${workflow.name ?? ''}" is not a valid AWA document, so it is not exported: ${problems.slice(0, 5).map(p => `${p.path ? `${p.path}: ` : ''}${p.message}`).join('; ')}`);
    }
}

interface NodeShape { el: any; entry: any; exit: any; timeout_exit?: any }

interface Built {
    definitions: any;
    /** BPMN elements by the AWA identifier of what they carry */
    elements: Map<string, any>;
    processes: Map<string, any>;
}

function documentation(moddle: any, text: unknown): any[] | undefined {
    return typeof text === 'string' && text.length ? [moddle.create('bpmn:Documentation', { text })] : undefined;
}

function build(moddle: any, workflows: JsonObject[]): Built {
    const first = workflows[0];
    const definitions = moddle.create('bpmn:Definitions', {
        id: `Definitions_${first.id}`, targetNamespace: `https://awa.io/workflows/${first.id}`,
        exporter: 'AWA', exporterVersion: '1.1', rootElements: [],
    });
    definitions.$attrs['xmlns:awa'] = AWA_INTERCHANGE_NAMESPACE;
    const elements = new Map<string, any>();
    const processes = new Map<string, any>();
    const shared = new Map<string, any>();
    const shared_list: any[] = [];
    const shared_ref = (kind: 'Message' | 'Signal' | 'Error', name: string) => {
        const key = `${kind}:${name}`;
        if (!shared.has(key)) {
            const index = shared_list.filter(e => e.$type === `bpmn:${kind}`).length + 1;
            const el = moddle.create(`bpmn:${kind}`, { id: `${kind}_${index}`, name });
            if (kind === 'Error') el.errorCode = name;
            shared.set(key, el);
            shared_list.push(el);
        }
        return shared.get(key);
    };
    const collaboration = moddle.create('bpmn:Collaboration', { id: `Collaboration_${first.id}`, participants: [] });

    for (const w of workflows) {
        const wid = String(w.id);
        const process = moddle.create('bpmn:Process', { id: xml_id(wid), name: w.name, isExecutable: true, flowElements: [], artifacts: [], laneSets: [] });
        const doc = documentation(moddle, w.description);
        if (doc) process.documentation = doc;
        processes.set(wid, process);
        elements.set(wid, process);
        collaboration.participants.push(moddle.create('bpmn:Participant', { id: `Participant_${wid}`, name: w.name, processRef: process }));

        const roles = (w.roles as JsonObject[]) || [];
        const lanes = new Map<string, any>();
        if (roles.length) {
            const set = moddle.create('bpmn:LaneSet', { id: `LaneSet_${wid}`, lanes: [] });
            for (const role of roles) {
                const lane = moddle.create('bpmn:Lane', { id: xml_id(String(role.id)), name: role.name, flowNodeRef: [] });
                const d = documentation(moddle, role.description);
                if (d) lane.documentation = d;
                if (typeof role.actor_type === 'string') lane.$attrs['awa:actorType'] = role.actor_type;
                set.lanes.push(lane);
                lanes.set(String(role.id), lane);
                elements.set(String(role.id), lane);
            }
            process.laneSets.push(set);
        }

        const activities = (w.activities as JsonObject[]) || [];
        const events = (w.events as JsonObject[]) || [];
        const decisions = (w.decision_nodes as JsonObject[]) || [];
        const edges = (w.edges as JsonObject[]) || [];
        const shapes = new Map<string, NodeShape>();
        const outgoing = (id: string) => edges.filter(e => e.source_id === id);
        const incoming = (id: string) => edges.filter(e => e.target_id === id);
        const synthetic_nodes: any[] = [];
        const synthetic_flows: any[] = [];
        const flow = (id: string, source: any, target: any) => {
            const f = moddle.create('bpmn:SequenceFlow', { id, sourceRef: source, targetRef: target });
            synthetic_flows.push(f);
            return f;
        };

        for (const a of activities) {
            const type = a.is_expandable === true ? 'bpmn:CallActivity' : a.actor_type === 'human' ? 'bpmn:UserTask' : 'bpmn:ServiceTask';
            const el = moddle.create(type, { id: xml_id(String(a.id)), name: a.name });
            const d = documentation(moddle, a.description);
            if (d) el.documentation = d;
            if (a.actor_type !== DEFAULT_ACTOR[type]) el.$attrs['awa:actorType'] = a.actor_type;
            if (type === 'bpmn:CallActivity' && typeof a.expansion_workflow_id === 'string') el.calledElement = xml_id(a.expansion_workflow_id);
            const data = (list: unknown) => (Array.isArray(list) && list.length && list.every(i => is_object(i) && typeof i.name === 'string') ? list as JsonObject[] : undefined);
            const inputs = data(a.inputs), outputs = data(a.outputs);
            if (inputs || outputs) {
                const io = moddle.create('bpmn:InputOutputSpecification', { id: `IO_${a.id}`, dataInputs: [], dataOutputs: [], inputSets: [], outputSets: [] });
                (inputs || []).forEach((item, i) => {
                    const di = moddle.create('bpmn:DataInput', { id: `DataInput_${a.id}_${i + 1}`, name: item.name });
                    const dd = documentation(moddle, item.description);
                    if (dd) di.documentation = dd;
                    io.dataInputs.push(di);
                });
                (outputs || []).forEach((item, i) => {
                    const dout = moddle.create('bpmn:DataOutput', { id: `DataOutput_${a.id}_${i + 1}`, name: item.name });
                    const dd = documentation(moddle, item.description);
                    if (dd) dout.documentation = dd;
                    io.dataOutputs.push(dout);
                });
                io.inputSets.push(moddle.create('bpmn:InputSet', { id: `InputSet_${a.id}`, dataInputRefs: [...io.dataInputs] }));
                io.outputSets.push(moddle.create('bpmn:OutputSet', { id: `OutputSet_${a.id}`, dataOutputRefs: [...io.dataOutputs] }));
                el.ioSpecification = io;
            }
            lanes.get(String(a.role_id))?.flowNodeRef.push(el);
            process.flowElements.push(el);
            elements.set(String(a.id), el);
            shapes.set(String(a.id), { el, entry: el, exit: el });
        }
        for (const a of activities) {
            const handler = is_object(a.compensation) ? shapes.get(String(a.compensation.activity_id)) : undefined;
            if (!handler) continue;
            const host = shapes.get(String(a.id))!.el;
            const boundary = moddle.create('bpmn:BoundaryEvent', {
                id: `Compensation_${a.id}`, attachedToRef: host,
                eventDefinitions: [moddle.create('bpmn:CompensateEventDefinition', { id: `CompensateEventDefinition_${a.id}` })],
            });
            handler.el.isForCompensation = true;
            process.flowElements.push(boundary);
            process.artifacts.push(moddle.create('bpmn:Association', { id: `Association_${a.id}`, sourceRef: boundary, targetRef: handler.el, associationDirection: 'One' }));
        }

        for (const e of events) {
            const id = String(e.id);
            const def = is_object(e.event_definition) ? e.event_definition : {};
            const name = typeof def.name === 'string' ? def.name : undefined;
            let el: any;
            const make = (type: string, definitions: any[] = []) => moddle.create(type, { id: xml_id(id), name: e.name, eventDefinitions: definitions });
            const message_def = () => moddle.create('bpmn:MessageEventDefinition', { id: `MessageEventDefinition_${id}`, ...(name ? { messageRef: shared_ref('Message', name) } : {}) });
            const signal_def = () => moddle.create('bpmn:SignalEventDefinition', { id: `SignalEventDefinition_${id}`, ...(name ? { signalRef: shared_ref('Signal', name) } : {}) });
            let shape: NodeShape | undefined;
            switch (e.event_type) {
                case 'start': el = make('bpmn:StartEvent', name ? [message_def()] : []); break;
                case 'end': el = make('bpmn:EndEvent'); break;
                case 'timer':
                    el = make('bpmn:IntermediateCatchEvent', [moddle.create('bpmn:TimerEventDefinition', {
                        id: `TimerEventDefinition_${id}`, timeDuration: moddle.create('bpmn:FormalExpression', { body: String(def.duration ?? '') }),
                    })]);
                    break;
                case 'message': case 'signal': {
                    const definition = e.event_type === 'message' ? message_def() : signal_def();
                    if (def.mode === 'publish') { el = make('bpmn:IntermediateThrowEvent', [definition]); break; }
                    el = make('bpmn:IntermediateCatchEvent', [definition]);
                    const timeout_edge = outgoing(id).find(x => x.id === def.timeout_edge_id);
                    if (typeof def.timeout === 'string' && timeout_edge) {
                        const gateway = moddle.create('bpmn:EventBasedGateway', { id: `Wait_${id}` });
                        const timer = moddle.create('bpmn:IntermediateCatchEvent', {
                            id: `Timeout_${id}`, name: `${e.name}: no event within ${def.timeout}`,
                            eventDefinitions: [moddle.create('bpmn:TimerEventDefinition', { id: `TimerEventDefinition_Timeout_${id}`, timeDuration: moddle.create('bpmn:FormalExpression', { body: def.timeout }) })],
                        });
                        synthetic_nodes.push(gateway, timer);
                        flow(`Wait_${id}_event`, gateway, el);
                        flow(`Wait_${id}_timeout`, gateway, timer);
                        shape = { el, entry: gateway, exit: el, timeout_exit: timer };
                    }
                    break;
                }
                case 'error':
                    el = make('bpmn:EndEvent', [moddle.create('bpmn:ErrorEventDefinition', { id: `ErrorEventDefinition_${id}`, ...(name ? { errorRef: shared_ref('Error', name) } : {}) })]);
                    break;
                case 'conditional':
                    el = make('bpmn:IntermediateCatchEvent', [moddle.create('bpmn:ConditionalEventDefinition', {
                        id: `ConditionalEventDefinition_${id}`,
                        ...(typeof def.condition === 'string' ? { condition: moddle.create('bpmn:FormalExpression', { body: def.condition }) } : {}),
                    })]);
                    break;
                default: el = make('bpmn:IntermediateThrowEvent');
            }
            const d = documentation(moddle, e.description);
            if (d) el.documentation = d;
            process.flowElements.push(el);
            elements.set(id, el);
            shapes.set(id, shape || { el, entry: el, exit: el });
        }

        for (const n of decisions) {
            const id = String(n.id);
            const el = moddle.create('bpmn:BusinessRuleTask', { id: xml_id(id), name: n.name });
            const d = documentation(moddle, n.description);
            if (d) el.documentation = d;
            if (is_object(n.decision_table)) {
                el.implementation = DMN13_NAMESPACE;
                el.$attrs['awa:decisionRef'] = xml_id(id);
            }
            process.flowElements.push(el);
            elements.set(id, el);
            shapes.set(id, { el, entry: el, exit: el });
        }

        // A join "all" waits at a parallel gateway
        for (const node of [...activities, ...events]) {
            const id = String(node.id);
            if (node.join !== 'all' || incoming(id).length < 2) continue;
            const shape = shapes.get(id)!;
            const gateway = moddle.create('bpmn:ParallelGateway', { id: `Join_${id}`, gatewayDirection: 'Converging' });
            synthetic_nodes.push(gateway);
            flow(`Join_${id}_out`, gateway, shape.entry);
            shape.entry = gateway;
        }

        // Conditional and default edges leave an exclusive gateway; a decision's edges leave one too
        const route_exit = new Map<string, any>();
        const route_default = new Map<string, any>();
        for (const node of [...activities, ...events, ...decisions]) {
            const id = String(node.id);
            const shape = shapes.get(id)!;
            const timeout_id = is_object(node.event_definition) ? node.event_definition.timeout_edge_id : undefined;
            const out = outgoing(id).filter(e => !(shape.timeout_exit && e.id === timeout_id));
            const is_decision = decisions.includes(node);
            const needs = is_decision ? out.length > 1 : out.some(e => typeof e.condition === 'string' || e.is_default === true);
            if (!needs) continue;
            const gateway = moddle.create('bpmn:ExclusiveGateway', { id: `Route_${id}`, gatewayDirection: 'Diverging' });
            synthetic_nodes.push(gateway);
            flow(`Route_${id}_in`, shape.exit, gateway);
            route_exit.set(id, gateway);
            route_default.set(id, is_decision ? out.find(e => e.id === node.default_output_edge_id) : out.find(e => e.is_default === true));
        }

        const flows: any[] = [];
        for (const e of edges) {
            const source = String(e.source_id), target = String(e.target_id);
            const shape = shapes.get(source)!;
            const timeout_id = (events.find(x => x.id === source)?.event_definition as JsonObject | undefined)?.timeout_edge_id;
            const from = shape.timeout_exit && e.id === timeout_id ? shape.timeout_exit : route_exit.get(source) || shape.exit;
            const f = moddle.create('bpmn:SequenceFlow', { id: xml_id(String(e.id)), sourceRef: from, targetRef: shapes.get(target)!.entry });
            if (typeof e.label === 'string') f.name = e.label;
            const gateway = route_exit.get(source);
            const is_decision_source = decisions.some(x => x.id === source);
            if (gateway && route_default.get(source) === e) gateway.default = f;
            else if (gateway && is_decision_source) {
                f.conditionExpression = moddle.create('bpmn:FormalExpression', { language: AWA_DECISION_ROUTE_LANGUAGE, body: decision_route(decisions.find(x => x.id === source)!, String(e.id)) });
            } else if (gateway && typeof e.condition === 'string') {
                const feel = awa_condition_to_feel(e.condition);
                f.conditionExpression = moddle.create('bpmn:FormalExpression', feel ? { language: FEEL_LANGUAGE, body: feel } : { language: AWA_EXPRESSION_LANGUAGE, body: e.condition });
            }
            flows.push(f);
            elements.set(String(e.id), f);
        }
        process.flowElements.push(...synthetic_nodes, ...flows, ...synthetic_flows);
    }
    definitions.rootElements.push(...shared_list, collaboration, ...processes.values());
    return { definitions, elements, processes };
}

/** What chooses an edge leaving a decision, in words: written as the condition of its flow, never read */
function decision_route(node: JsonObject, edge_id: string): string {
    const parts: string[] = [];
    const rules = ((node.decision_table as JsonObject | undefined)?.rules as JsonObject[] | undefined) || [];
    const numbers = rules.map((r, i) => (r.output_edge_id === edge_id ? i + 1 : 0)).filter(Boolean);
    if (numbers.length) parts.push(`${numbers.length === 1 ? 'rule' : 'rules'} ${numbers.join(', ')}`);
    for (const source of [node.decision_model, node.decision_engine]) {
        const options = ((source as JsonObject | undefined)?.options as JsonObject[] | undefined) || [];
        for (const option of options) if (option.output_edge_id === edge_id) parts.push(`option ${option.id}`);
    }
    return parts.length ? `chosen by ${parts.join(', ')}` : 'not chosen by a rule';
}

function attach(moddle: any, element: any, r: Residual) {
    if (element) add_extensions(moddle, element, 'bpmn', residual_extensions(r));
}

/**
 * Write workflows as one BPMN 2.0 document, one process each, and their decision tables as
 * one DMN document. Reading them back with import_bpmn gives the same documents.
 */
export async function export_bpmn(documents: JsonObject[], options: ExportBpmnOptions = {}): Promise<ExportBpmnResult> {
    if (!documents.length) throw new InterchangeError('There is no workflow to export');
    documents.forEach(d => check_document(d));
    const workflows = documents.map(d => clone(unwrap_document(d)));
    const ids = new Set<string>();
    for (const w of workflows) {
        if (ids.has(String(w.id))) throw new InterchangeError(`Two workflows have the identifier ${w.id}; a BPMN document holds each process once`);
        ids.add(String(w.id));
    }
    const decision_nodes = workflows.flatMap(w => ((w.decision_nodes as JsonObject[]) || []).filter(n => is_object(n.decision_table)));
    const dmn = decision_nodes.length ? await write_dmn(decision_nodes, { definitions: { id: String(workflows[0].id), name: String(workflows[0].name) } }) : undefined;
    const dmn_list = dmn ? [dmn] : [];

    const moddle = await bpmn_moddle();
    const built = build(moddle, workflows);
    const draft = (await moddle.toXML(built.definitions, { format: true })).xml as string;
    const native = await import_bpmn(draft, { native: true, dmn: dmn_list });

    for (const original of workflows) {
        const back = native.documents.find(d => d.id === original.id);
        if (!back) throw new InterchangeError(`The workflow "${original.name}" was not read back from the BPMN written for it; this is a defect of the exporter`);
        const level: JsonObject = {}, native_level: JsonObject = {};
        for (const key of Object.keys(original)) if (!COLLECTIONS.includes(key)) level[key] = original[key];
        for (const key of Object.keys(back)) if (!COLLECTIONS.includes(key)) native_level[key] = back[key];
        for (const key of COLLECTIONS) {
            const mine = original[key] as JsonObject[] | undefined, theirs = back[key] as JsonObject[] | undefined;
            const same_ids = Array.isArray(mine) && Array.isArray(theirs) && mine.length === theirs.length && mine.every((item, i) => item.id === theirs[i].id);
            if (same_ids) {
                mine!.forEach((item, i) => attach(moddle, built.elements.get(String(item.id)), residual(item, theirs![i])));
            } else {
                if (mine !== undefined) level[key] = mine;
                if (theirs !== undefined) native_level[key] = theirs;
            }
        }
        attach(moddle, built.processes.get(String(original.id)), residual(level, native_level));
    }
    documents.forEach((document, i) => {
        if (document === unwrap_document(document)) return;
        const envelope: JsonObject = { ...document };
        delete envelope.workflow;
        add_extensions(moddle, built.processes.get(String(workflows[i].id)), 'bpmn', [{ name: 'envelope', body: JSON.stringify(envelope) }]);
    });
    if (options.diagram !== false) lay_out(moddle, built.definitions);
    const bpmn = (await moddle.toXML(built.definitions, { format: true })).xml as string;

    // The export is lossless or it is a defect
    const back = await import_bpmn(bpmn, { dmn: dmn_list });
    documents.forEach((document, i) => {
        if (!json_equal(back.documents[i], document)) {
            throw new InterchangeError(`The workflow "${workflows[i].name}" does not read back from BPMN as it was written; this is a defect of the exporter`);
        }
    });
    return { bpmn, dmn, warnings: [] };
}
