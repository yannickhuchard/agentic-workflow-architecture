// What the tools compute from AWA documents: validation in plain words, the
// data-oriented picture of a workflow, the summary of a simulated run, and the
// story of journeys. Pure functions of their arguments; nothing is kept.
import { LIMITS } from './limits.js';
import { load_sdk, story_builder } from './sdk.js';

export class DocumentError extends Error {
    constructor(message, problems = []) { super(message); this.name = 'DocumentError'; this.problems = problems; }
}

const text = (value, max = 200) => { const s = String(value ?? ''); return s.length > max ? `${s.slice(0, max - 1)}…` : s; };
const unwrap = document => (document && typeof document === 'object' && document.workflow && !('activities' in document) ? document.workflow : document);

/** "workflow", "journey" or "unknown", from the shape of the document */
export async function document_kind(document) {
    const { is_journey_document } = await load_sdk();
    if (is_journey_document(document)) return 'journey';
    const inner = unwrap(document);
    if (inner && typeof inner === 'object' && (Array.isArray(inner.activities) || Array.isArray(inner.edges))) return 'workflow';
    return 'unknown';
}

// ------------------------------------------------------------------ problems in plain words
const COLLECTION_WORD = { activities: 'activity', edges: 'edge', events: 'event', decision_nodes: 'decision', roles: 'role', contexts: 'context', stages: 'stage', triggers: 'trigger', goals: 'goal', touchpoints: 'touchpoint', artefacts: 'artefact', tools: 'tool', inputs: 'input', outputs: 'output', rules: 'rule', exits: 'exit' };

/** Where a schema problem is, said with the names in the document rather than array positions */
function where(document, path) {
    const parts = String(path || '').split('.').filter(Boolean);
    if (!parts.length) return 'The document';
    const out = [];
    let here = document, collection;
    for (const part of parts) {
        const index = /^\d+$/.test(part) ? Number(part) : undefined;
        if (index !== undefined && Array.isArray(here)) {
            const item = here[index], word = COLLECTION_WORD[collection] || 'item';
            const name = item && typeof item === 'object' ? item.name ?? item.id ?? item.event : undefined;
            out[out.length - 1] = name !== undefined && typeof name !== 'object' ? `${word} "${text(name, 60)}"` : `${word} ${index + 1}`;
            here = item;
        } else {
            out.push(part); collection = part;
            here = here && typeof here === 'object' ? here[part] : undefined;
        }
    }
    return out.join(', ');
}

function plain(message) {
    let m;
    if ((m = /^Invalid input: expected (\w+), received undefined$/.exec(message))) return `is missing (expected ${m[1] === 'string' ? 'text' : `a${/^[aeio]/.test(m[1]) ? 'n' : ''} ${m[1]}`})`;
    if ((m = /^Invalid input: expected (\w+), received (\w+)$/.exec(message))) return `has the wrong type: expected ${m[1]}, found ${m[2]}`;
    if (/^Invalid (GUID|UUID)$/i.test(message)) return 'must be a UUID, for example "3f2b1c9e-8a4d-4c1b-9e2f-0a1b2c3d4e5f"';
    if ((m = /^Invalid option: expected one of (.+)$/.exec(message))) return `must be one of ${m[1].replace(/\|/g, ', ')}`;
    if ((m = /^Invalid string: must match pattern (.+)$/.exec(message))) return `does not have the required form (pattern ${m[1]})`;
    if ((m = /^Unrecognized keys?: (.+)$/.exec(message))) return `has properties the schema does not know: ${m[1]}`;
    return message.replace(/^Invalid input: /, '');
}

/** Replace identifiers in an integrity message by the names they stand for, where the document gives one */
function with_names(message, names) {
    return message.replace(/'([0-9a-fA-F-]{36})'/g, (all, id) => (names.has(id) ? `"${names.get(id)}" (${id.slice(0, 8)})` : all));
}

function names_of(document) {
    const names = new Map();
    const inner = unwrap(document) || {};
    for (const key of ['activities', 'events', 'decision_nodes', 'roles', 'contexts', 'stages']) {
        for (const item of Array.isArray(inner[key]) ? inner[key] : []) if (item && typeof item.id === 'string' && typeof item.name === 'string') names.set(item.id, text(item.name, 60));
    }
    return names;
}

/**
 * Validate one document: its schema, then its integrity (references, expressions, durations).
 * @param related_workflows  parsed workflows a journey may refer to
 */
export async function validate_document(document, related_workflows = []) {
    const sdk = await load_sdk();
    const kind = await document_kind(document);
    const names = names_of(document);
    const problems = [], warnings = [];
    const add = (list, at, message, code) => list.push({ where: at, problem: message, code });

    if (kind === 'unknown') {
        add(problems, 'The document', 'is neither a workflow (it has no "activities" and "edges") nor a journey (it has no "stages" and "subject").', 'unknown_document');
        return { kind, valid: false, name: undefined, version: undefined, problems, warnings };
    }

    let parsed;
    if (kind === 'workflow') {
        const inner = unwrap(document);
        const schema = sdk.validate_workflow(inner);
        for (const e of schema.errors) add(problems, where(inner, e.path), plain(e.message), e.code);
        if (schema.valid) {
            parsed = sdk.parse_document(document);
            for (const e of sdk.validate_workflow_integrity(parsed).errors) add(problems, with_names(e.path.replace(/\[([0-9a-fA-F-]{36})\]/g, (all, id) => (names.has(id) ? ` "${names.get(id)}"` : all)), names), with_names(e.message, names), e.code);
            const role_ids = new Set(parsed.roles.map(r => r.id));
            for (const a of parsed.activities) if (!role_ids.has(a.role_id)) add(warnings, `activity "${text(a.name, 60)}"`, 'refers to a role that the workflow does not define.', 'unknown_role');
            const targets = new Set(parsed.edges.map(e => e.target_id)), sources = new Set(parsed.edges.map(e => e.source_id));
            const handlers = new Set(parsed.activities.map(a => a.compensation?.activity_id).filter(Boolean));
            const has_start = parsed.events.some(e => e.event_type === 'start');
            for (const a of parsed.activities) {
                if (!targets.has(a.id) && !sources.has(a.id) && !handlers.has(a.id) && parsed.activities.length > 1) add(warnings, `activity "${text(a.name, 60)}"`, 'is not connected to any other node.', 'unconnected_node');
            }
            if (!has_start && parsed.activities.filter(a => !targets.has(a.id) && !handlers.has(a.id)).length > 1) add(warnings, 'The workflow', 'has no start event and more than one activity without an incoming edge; a run starts at the first of them.', 'ambiguous_start');
            if (!parsed.awa_version) add(warnings, 'The workflow', 'does not state "awa_version".', 'no_awa_version');
        }
    } else {
        const schema = sdk.JourneyDefinitionSchema.safeParse(document);
        if (!schema.success) for (const issue of schema.error.issues) add(problems, where(document, issue.path.join('.')), plain(issue.message), issue.code);
        else {
            parsed = schema.data;
            const ids = new Set(related_workflows.map(w => w.id));
            for (const e of sdk.validate_journey(parsed, ids, false)) add(problems, e.path, with_names(e.message, new Map(related_workflows.map(w => [w.id, w.name]))), e.code);
            if (!related_workflows.length) {
                const referred = new Set([...parsed.stages.flatMap(s => [...s.workflows, s.on_enter?.start_workflow]), ...parsed.triggers.map(t => t.start_workflow)].filter(Boolean));
                if (referred.size) add(warnings, 'The journey', `refers to ${referred.size} workflow(s) that were not given, so those references were not checked.`, 'workflows_not_given');
            }
        }
    }
    const inner = unwrap(document) || {};
    return {
        kind, valid: problems.length === 0,
        name: typeof inner.name === 'string' ? text(inner.name, 120) : undefined,
        version: typeof inner.version === 'string' ? text(inner.version, 20) : undefined,
        problems: problems.slice(0, LIMITS.problems), warnings: warnings.slice(0, LIMITS.problems),
        ...(problems.length > LIMITS.problems ? { more_problems: problems.length - LIMITS.problems } : {}),
        parsed,
    };
}

/** Parse a workflow or throw a DocumentError that says what is wrong in plain words */
export async function require_workflow(document, label = 'The workflow') {
    const result = await validate_document(document);
    if (result.kind !== 'workflow') throw new DocumentError(`${label} is not an AWA workflow document: it needs "activities" and "edges".`, result.problems);
    if (!result.valid) throw new DocumentError(`${label} is not valid: ${sentences(result.problems, 5)}`, result.problems);
    return result.parsed;
}

export async function require_journey(document, workflows, label = 'The journey') {
    const result = await validate_document(document, workflows);
    if (result.kind !== 'journey') throw new DocumentError(`${label} is not an AWA journey document: it needs "stages" and "subject".`, result.problems);
    if (!result.valid) throw new DocumentError(`${label} is not valid: ${sentences(result.problems, 5)}`, result.problems);
    return result.parsed;
}

export const sentences = (problems, max = 8) => problems.slice(0, max).map(p => `${p.where} ${p.problem}`.replace(/\.?$/, '.')).join(' ') + (problems.length > max ? ` And ${problems.length - max} more.` : '');

// ------------------------------------------------------------------ the data-oriented picture of a workflow
const binding_text = b => (b.kind === 'http' ? `${b.method || 'GET'} ${b.url}` : b.kind === 'command' ? `command ${b.command}` : b.kind === 'jsonrpc' ? `${b.endpoint}#${b.method}`
    : b.kind === 'grpc' ? `gRPC ${b.service}/${b.method}` : b.kind === 'mcp' ? `MCP ${b.server}/${b.tool}` : `function ${b.name}`);

/**
 * What moves through a workflow: who does each activity, what it takes in and
 * gives out, which contexts it reads and writes, and what access it needs.
 */
export function workflow_data_view(workflow) {
    const roles = new Map(workflow.roles.map(r => [r.id, r])), contexts = new Map(workflow.contexts.map(c => [c.id, c]));
    const node_name = new Map([...workflow.activities, ...workflow.events, ...workflow.decision_nodes].map(n => [n.id, n.name]));
    const activities = workflow.activities.map(a => ({
        id: a.id, name: text(a.name, 120), actor_type: a.actor_type, role: roles.get(a.role_id)?.name ? text(roles.get(a.role_id).name, 80) : undefined,
        description: a.description ? text(a.description, 300) : undefined,
        inputs: a.inputs.map(d => ({ name: text(d.name, 80), required: d.required !== false, description: d.description ? text(d.description, 160) : undefined })),
        outputs: a.outputs.map(d => ({ name: text(d.name, 80), required: d.required !== false, description: d.description ? text(d.description, 160) : undefined })),
        contexts: a.context_bindings.map(b => ({ context: text(contexts.get(b.context_id)?.name ?? b.context_id, 80), access: b.access_mode, required: b.required !== false })),
        access: a.access_rights.map(r => ({ name: text(r.name, 80), direction: r.direction, resource_type: r.resource_type, resource: r.resource_id ? text(r.resource_id, 80) : undefined, permission: r.permission, scope: r.scope ? text(r.scope, 80) : undefined })),
        tools: a.tools.map(t => ({ name: t.name, kind: t.binding.kind, runs: text(binding_text(t.binding), 160) })),
        programs: a.programs.map(p => ({ name: text(p.name, 80), language: p.language })),
        outcome_contract: a.outcome_contract ? { required_outputs: (a.outcome_contract.output_schema?.required || []).map(r => text(r, 60)).slice(0, 20), postconditions: a.outcome_contract.postconditions.map(p => text(p.expression, 160)) } : undefined,
    }));
    const data = new Map();
    const item = name => { if (!data.has(name)) data.set(name, { name, produced_by: [], consumed_by: [] }); return data.get(name); };
    for (const a of activities) {
        // What an activity gives out: its declared outputs, and the fields its outcome contract requires of it
        for (const name of new Set([...a.outputs.map(o => o.name), ...(a.outcome_contract?.required_outputs || [])])) item(name).produced_by.push(a.name);
        for (const i of a.inputs) item(i.name).consumed_by.push(a.name);
    }
    // A decision table reads data too
    for (const d of workflow.decision_nodes) for (const input of d.decision_table?.inputs || []) {
        const name = text(input.expression ?? input.name ?? '', 80);
        if (/^[A-Za-z_$][\w$.]*$/.test(name)) item(name).consumed_by.push(`decision ${text(d.name, 100)}`);
    }
    return {
        workflow: { id: workflow.id, name: text(workflow.name, 120), version: workflow.version, awa_version: workflow.awa_version, description: workflow.description ? text(workflow.description, 400) : undefined },
        counts: { activities: workflow.activities.length, decisions: workflow.decision_nodes.length, events: workflow.events.length, edges: workflow.edges.length, roles: workflow.roles.length, contexts: workflow.contexts.length },
        roles: workflow.roles.map(r => ({ name: text(r.name, 80), actor_type: r.actor_type, description: r.description ? text(r.description, 200) : undefined, model: r.ai_model_config?.model_id ? text(r.ai_model_config.model_id, 80) : undefined, activities: workflow.activities.filter(a => a.role_id === r.id).map(a => text(a.name, 120)) })),
        actor_types: Object.fromEntries(['human', 'ai_agent', 'robot', 'application'].map(t => [t, workflow.activities.filter(a => a.actor_type === t).length]).filter(([, n]) => n)),
        activities,
        decisions: workflow.decision_nodes.map(d => ({
            name: text(d.name, 120), decided_by: [d.decision_table && 'decision table', d.decision_engine && 'external engine (not called in simulation)', d.decision_model && 'model (simulated)'].filter(Boolean),
            inputs: (d.decision_table?.inputs || []).map(i => text(i.name ?? i.expression ?? '', 80)), rules: d.decision_table?.rules.length || 0,
            options: (d.decision_model?.options || []).map(o => text(o.id, 60)),
        })),
        events: workflow.events.map(e => ({ name: text(e.name, 120), type: text(e.event_type, 40), business_event: typeof e.event_definition?.name === 'string' ? text(e.event_definition.name, 80) : undefined, mode: typeof e.event_definition?.mode === 'string' ? text(e.event_definition.mode, 20) : undefined, duration: typeof e.event_definition?.duration === 'string' ? text(e.event_definition.duration, 40) : undefined, timeout: typeof e.event_definition?.timeout === 'string' ? text(e.event_definition.timeout, 40) : undefined })),
        contexts: workflow.contexts.map(c => ({
            name: text(c.name, 80), type: c.type, sync_pattern: c.sync_pattern, visibility: c.visibility, description: c.description ? text(c.description, 200) : undefined,
            read_by: workflow.activities.filter(a => a.context_bindings.some(b => b.context_id === c.id && /read/.test(b.access_mode))).map(a => text(a.name, 120)),
            written_by: workflow.activities.filter(a => a.context_bindings.some(b => b.context_id === c.id && /write/.test(b.access_mode))).map(a => text(a.name, 120)),
        })),
        data: [...data.values()],
        edges: workflow.edges.map(e => ({ from: text(node_name.get(e.source_id) ?? '?', 120), to: text(node_name.get(e.target_id) ?? '?', 120), condition: e.condition ? text(e.condition, 160) : undefined, label: e.label ? text(e.label, 80) : undefined, default: e.is_default || undefined })),
    };
}

// ------------------------------------------------------------------ the summary of a run
/** What a simulated run did, from its journal alone */
export function run_summary(workflow, run) {
    const events = run.events;
    const of = type => events.filter(e => e.type === type);
    const end = events.findLast(e => ['run.completed', 'run.failed', 'run.cancelled'].includes(e.type));
    const path = [];
    for (const e of events) {
        const name = e.node_name;
        if (!name) continue;
        if (e.type === 'activity.completed' || e.type === 'decision.evaluated' || e.type === 'event.received' || e.type === 'event.published' || e.type === 'timer.fired' || e.type === 'event.timed_out') path.push(text(name, 120));
    }
    const failures = of('token.failed').map(e => ({ at: text(e.node_name ?? '', 120), code: text(e.data?.error?.code ?? '', 40), message: text(e.data?.error?.message ?? '', 400) }));
    const failed_attempts = of('activity.failed').length;
    const waiting = run.status === 'waiting_event' || run.status === 'waiting_human'
        ? of('event.waiting').filter(w => !events.some(e => e.seq > w.seq && e.node_id === w.node_id && ['event.received', 'event.timed_out'].includes(e.type))).map(w => ({ at: text(w.node_name, 120), event: text(w.data?.name ?? '', 80), due_at: w.data?.due_at }))
        : [];
    const cost = run.priced && end?.data && (end.data.cost !== undefined || end.data.execution_cost !== undefined) ? { amount: end.data.cost ?? end.data.execution_cost, currency: end.data.currency } : undefined;
    const needs_outputs = failures.some(f => f.code === 'NO_ROUTE' || f.code === 'CONTRACT_VIOLATION');
    return {
        simulated: true, workflow: text(workflow.name, 120), status: run.status, steps: run.steps,
        journal_events: events.length, ...(run.truncated ? { journal_truncated: true } : {}),
        path,
        decisions: of('decision.evaluated').map(e => ({
            decision: text(e.node_name, 120), method: e.data?.method ? text(e.data.method, 20) : undefined,
            rule: Array.isArray(e.data?.matched_rules) && e.data.matched_rules.length ? text(e.data.matched_rules.map(r => r.description || `rule ${r.index}`).join('; '), 200) : undefined,
            option: e.data?.option ? text(e.data.option, 80) : undefined, used_default: e.data?.used_default || undefined,
            reason: e.data?.no_decision_reason ? text(e.data.no_decision_reason, 200) : undefined, outputs: e.data?.outputs,
        })),
        tool_calls: of('tool.invoked').map(e => ({ activity: text(e.node_name, 120), tool: text(e.data?.tool, 80), simulated: e.data?.simulated === true })),
        waits: [...of('event.waiting').map(e => ({ at: text(e.node_name, 120), kind: 'event', event: text(e.data?.name ?? '', 80), due_at: e.data?.due_at })), ...of('timer.started').map(e => ({ at: text(e.node_name, 120), kind: 'timer', duration: e.data?.duration }))],
        waiting_for: waiting,
        events_delivered: run.delivered, events_not_taken: run.undelivered, waits_timed_out: run.timed_out,
        failures, ...(failed_attempts ? { failed_attempts } : {}),
        duration_ms: end?.data?.duration_ms,
        tokens: end?.data ? { input: end.data.input_tokens || 0, output: end.data.output_tokens || 0 } : undefined,
        cost,
        ...(run.stopped ? { stopped: run.stopped } : {}),
        ...(run.commands_not_called.length ? { commands_not_called: run.commands_not_called } : {}),
        ...(needs_outputs ? { hint: 'Simulated activities return no business data unless you supply it. Pass simulated_outputs: { "<activity name>": { "output": { ... } } } with the fields the conditions, decision tables or outcome contracts read, then simulate again.' } : {}),
    };
}

// ------------------------------------------------------------------ the story of journeys
/** Check that a value has the shape of AwaRuntime.export_portfolio() before the builder reads it */
export function require_portfolio(portfolio) {
    const fail = message => { throw new DocumentError(`This is not a journey portfolio export (the file written by "awa journey export"): ${message}`); };
    if (!portfolio || typeof portfolio !== 'object' || Array.isArray(portfolio)) fail('it is not an object.');
    if (!Array.isArray(portfolio.journeys)) fail('it has no "journeys" list.');
    if (!Array.isArray(portfolio.workflows)) fail('it has no "workflows" list.');
    if (portfolio.journeys.length > LIMITS.journeys * 4) fail(`it holds more than ${LIMITS.journeys * 4} journeys.`);
    for (const [i, j] of portfolio.journeys.entries()) {
        if (!j || typeof j !== 'object' || !j.definition || typeof j.definition !== 'object' || !Array.isArray(j.definition.stages)) fail(`journey ${i + 1} has no definition with stages.`);
        if (!Array.isArray(j.instances)) fail(`journey ${i + 1} has no "instances" list.`);
        for (const [k, entry] of j.instances.entries()) {
            const instance = entry?.instance;
            if (!instance || typeof instance !== 'object' || typeof instance.subject_key !== 'string' || !Array.isArray(instance.events) || !Array.isArray(instance.runs) || typeof instance.data !== 'object' || !instance.data) fail(`instance ${k + 1} of journey ${i + 1} is not a journey record.`);
            if (!Array.isArray(entry.runs)) fail(`instance ${k + 1} of journey ${i + 1} has no "runs" list.`);
        }
    }
    return portfolio;
}

/** Build the story the journey view plays, and a summary a model can read */
export function build_story(portfolio) {
    let story;
    try { story = story_builder()(portfolio); }
    catch (error) { throw new DocumentError(`The journey records could not be read: ${error.message}`); }
    return story;
}

export function story_summary(story) {
    return {
        journeys: (story.journeys || []).map(j => ({
            name: text(j.name, 120), stages: (j.stages || []).map(s => text(s.name ?? s, 80)),
            customers: (j.instances || []).map(c => ({
                name: text(c.name, 80), outcome: text(c.ending?.label ?? '', 80), moments: (c.beats || []).length, runs: (c.runs || []).length,
                mood_start: c.mood_start ?? null, mood_end: c.mood_end ?? null,
            })),
        })),
    };
}
