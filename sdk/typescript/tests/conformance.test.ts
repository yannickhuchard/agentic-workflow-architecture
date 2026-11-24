/**
 * AWA conformance runner (TypeScript reference implementation).
 * Runs the language-neutral cases in spec/conformance against this SDK.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'fs';
import path from 'path';
import Ajv2020 from 'ajv/dist/2020';
import addFormats from 'ajv-formats';
import { WorkflowEngine, WorkflowEngineOptions } from '../src/runtime/workflow_engine';
import { parse_document, validate_workflow_integrity } from '../src/validator';
import { Activity } from '../src/types';
import { Actor } from '../src/runtime/actors/actor';
import { silent_logger } from './helpers';
import { business_event } from '../src/runtime/business_event';
import { evaluate_unary_tests, validate_unary_tests } from '../src/runtime/unary_test';
import { evaluate_expression, validate_expression, resolve_path } from '../src/runtime/expression';
import { parse_iso_duration } from '../src/runtime/duration_utils';
import { FunctionModelProvider } from '../src/runtime/models';
import { AwaRuntime, InMemoryRuntimeStore } from '../src/runtime/runtime';
import { JourneyDefinitionSchema } from '../src/runtime/journey';
import { compute_measures, MEASURES } from '../src/runtime/kpi';
import { gauges_to_otlp_json, journey_spans, measures_to_gauges, run_spans, spans_to_otlp_json } from '../src/runtime/telemetry';
import { InMemoryJournalStore } from '../src/runtime/journal';
import { counterfactual_replay } from '../src/runtime/counterfactual';
import { KnowledgeBase, KnowledgeEntry } from '../src/runtime/knowledge';
import { compute_evidence, unresolved_citations } from '../src/runtime/evidence';
import { build_dataset, evaluate_dataset } from '../src/runtime/evaluation';
import { A2ATransport } from '../src/runtime/protocols/a2a';
import { PostgresRuntimeStore } from '../src/runtime/postgres_store';
import { postgres_unavailable, start_postgres, TestPostgres } from './postgres';
import { import_bpmn, export_bpmn, import_dmn, export_serverless_workflow } from '../src/interchange';
import { feel_unary_to_awa, awa_unary_to_feel, feel_condition_to_awa, awa_condition_to_feel } from '../src/interchange/expressions';
import { json_equal } from '../src/interchange/common';
import { AuthorizationError } from '../src/runtime/authorization';
import { WorkflowState } from '../src/runtime/persistence';
import { plan_migration } from '../src/runtime/migration';

const ROOT = path.resolve(__dirname, '../../..');
const CONFORMANCE = path.join(ROOT, 'spec/conformance');
const SCHEMAS = path.join(ROOT, 'spec/json-schema');

/** Conformance levels this implementation claims. */
const CLAIMED_LEVELS = new Set(['guardrails', 'versioning', 'core', 'decision', 'verified', 'resilient', 'recorded', 'contract', 'flow', 'events', 'tools', 'model_decision', 'journeys', 'replay', 'routing', 'knowledge', 'measures', 'contexts', 'service_levels', 'telemetry', 'interchange', 'shared_store', 'evidence', 'evaluation', 'a2a', 'authorization']);

const read = (file: string) => JSON.parse(fs.readFileSync(file, 'utf-8'));
const list = (dir: string) => fs.readdirSync(dir).filter(f => f.endsWith('.json')).sort().map(f => path.join(dir, f));

const ajv = new Ajv2020({ allErrors: true, strict: false });
addFormats(ajv);
for (const file of list(SCHEMAS)) ajv.addSchema(read(file));
const validate_schema = ajv.getSchema('https://awa.io/schema/workflow.schema.json')!;
const validate_event = ajv.getSchema('https://awa.io/schema/journal-event.schema.json')!;

const unwrap = (doc: any) => (doc && doc.workflow && !doc.activities ? doc.workflow : doc);

type ActorScript = {
    output?: Record<string, unknown>; error?: string; code?: string; delay_ms?: number; attempts?: ActorScript[];
    /** Tool calls the actor makes, in order, before it returns */
    calls?: { tool: string; arguments?: Record<string, unknown> }[];
    /** How long the activity takes on the case's clock, as a duration */
    takes?: string;
    /** What the actor writes to contexts, by context name */
    contexts?: Record<string, unknown>;
    /** The actor's own account of how it worked, reported with its result */
    reasoning?: Record<string, unknown>;
    /** A person who has not answered yet: the token waits for them (5.6) */
    waits?: boolean;
};

class ConformanceActor implements Actor {
    public visited: string[] = [];
    /** The ids of the knowledge entries the actor was handed, one list per execution */
    public given: { activity: string; ids: string[] }[] = [];
    /** The contexts the actor was handed at its last execution of each activity; null when it was handed none */
    public contexts: Record<string, unknown> = {};
    /** The input the actor was given at its last execution of each activity, without what is reserved to the engine */
    public inputs: Record<string, Record<string, unknown>> = {};
    private counts = new Map<string, number>();
    constructor(private scripts: Record<string, ActorScript> = {}, private spend: (ms: number) => void = () => { }) { }

    async execute(activity: Activity, inputs?: Record<string, unknown>, context?: { tools?: { call: (name: string, args: Record<string, unknown>) => Promise<unknown> } }): Promise<Record<string, unknown>> {
        this.visited.push(activity.name);
        this.given.push({ activity: activity.name, ids: ((inputs?._knowledge as { id: string }[] | undefined) || []).map(k => k.id) });
        this.contexts[activity.name] = inputs?._contexts === undefined ? null : JSON.parse(JSON.stringify(inputs._contexts));
        this.inputs[activity.name] = JSON.parse(JSON.stringify(Object.fromEntries(Object.entries(inputs || {}).filter(([key]) => !key.startsWith('_') && key !== 'activities'))));
        const n = (this.counts.get(activity.name) || 0) + 1;
        this.counts.set(activity.name, n);
        let script = this.scripts[activity.name] || {};
        if (script.attempts) script = script.attempts[Math.min(n, script.attempts.length) - 1];
        if (script.delay_ms) await new Promise(r => setTimeout(r, script.delay_ms));
        if (script.takes) this.spend(parse_iso_duration(script.takes));
        for (const call of script.calls || []) await context!.tools!.call(call.tool, call.arguments || {});
        if (script.error) throw Object.assign(new Error(script.error), script.code ? { code: script.code } : {});
        if (script.waits) return { _requires_human_action: true, _human_task_id: `task:${activity.name}` };
        return { ...(script.output || {}), ...(script.reasoning ? { _reasoning: script.reasoning } : {}), ...(script.contexts ? { _context_writes: script.contexts } : {}) };
    }
}

type ModelReply = { option?: string; confidence?: number; rationale?: string; text?: string; error?: string; code?: string };
type ModelScript = {
    replies?: ModelReply[];
    providers?: { id: string; replies?: ModelReply[]; error?: string; code?: string }[];
    tiers?: Record<string, string[]>;
};

/**
 * Scripted model providers. Each call to a provider takes its next reply; the
 * last repeats. A provider scripted with an `error` fails every call.
 * The short form, `replies` alone, is one provider that every standard tier maps to.
 */
function scripted_models(script: ModelScript) {
    const calls: Record<string, number> = {};
    const provider = (id: string, replies: ModelReply[]) => {
        calls[id] = 0;
        return new FunctionModelProvider(id, () => {
            const reply = replies[Math.min(calls[id]++, replies.length - 1)];
            if (!reply) throw new Error(`the case scripts no reply for provider "${id}"`);
            if (reply.error) throw Object.assign(new Error(reply.error), reply.code ? { code: reply.code } : {});
            return reply.text ?? JSON.stringify(reply);
        });
    };
    const options: Pick<WorkflowEngineOptions, 'model_providers' | 'default_model_provider' | 'model_tiers'> = script.providers
        ? {
            model_providers: script.providers.map(p => provider(p.id, p.error ? [{ error: p.error, code: p.code }] : p.replies || [])),
            default_model_provider: script.providers[0].id,
            model_tiers: script.tiers || {},
        }
        : { model_providers: [provider('conformance', script.replies || [])], model_tiers: { fast: 'conformance:model', balanced: 'conformance:model', reasoning: 'conformance:model' } };
    return { options, calls, total: () => Object.values(calls).reduce((a, b) => a + b, 0) };
}

type AgentScript = { card: Record<string, any>; replies: Record<string, unknown>[] };

/**
 * Stands in for the agents a case scripts (level a2a): a GET of a card's URL answers with the card,
 * and each JSON-RPC request to the interface the card names takes the agent's next reply, the last repeating.
 * Any other address cannot be reached.
 */
function scripted_agents(agents: Record<string, AgentScript> = {}) {
    const requests: { agent: string; method: string; params: unknown }[] = [];
    let card_reads = 0;
    const served = new Map<string, number>();
    const transport: A2ATransport = async request => {
        if (request.method === 'GET' && agents[request.url]) {
            card_reads++;
            return { status: 200, body: JSON.stringify(agents[request.url].card) };
        }
        const agent = Object.keys(agents).find(url => (agents[url].card.supportedInterfaces || []).some((i: { url: string }) => i.url === request.url));
        if (request.method !== 'POST' || !agent) throw new Error(`connection refused: ${request.url}`);
        const body = JSON.parse(request.body || '{}');
        requests.push({ agent, method: body.method, params: body.params });
        const n = served.get(agent) || 0;
        served.set(agent, n + 1);
        const replies = agents[agent].replies;
        const reply = replies[Math.min(n, replies.length - 1)];
        return { status: 200, body: JSON.stringify({ jsonrpc: '2.0', id: body.id, ...reply }) };
    };
    return { transport, requests, card_reads: () => card_reads };
}

function is_subset(expected: unknown, actual: unknown): boolean {
    if (expected === null || typeof expected !== 'object') return expected === actual;
    if (actual === null || typeof actual !== 'object') return false;
    return Object.entries(expected as object).every(([k, v]) => is_subset(v, (actual as any)[k]));
}

describe('Conformance: documents', () => {
    for (const file of list(path.join(CONFORMANCE, 'documents'))) {
        const c = read(file);
        // A document case of a level other than `document` runs when that level is claimed
        const run = !c.level || CLAIMED_LEVELS.has(c.level) ? it : it.skip;
        run(`${c.id}: ${c.description}`, () => {
            const doc = unwrap(c.document);
            const schema_ok = validate_schema(doc) as boolean;
            if (c.valid) {
                expect(validate_schema.errors || []).toEqual([]);
                expect(validate_workflow_integrity(parse_document(c.document)).errors).toEqual([]);
            } else if (c.stage === 'schema') {
                expect(schema_ok).toBe(false);
                expect(() => parse_document(c.document)).toThrow();
            } else {
                expect(schema_ok).toBe(true);
                const result = validate_workflow_integrity(parse_document(c.document));
                expect(result.valid).toBe(false);
                expect(result.errors.map(e => e.code)).toContain(c.error_code);
            }
        });
    }
});

describe('Conformance: condition expressions', () => {
    const suite = read(path.join(CONFORMANCE, 'expressions.json'));
    for (const c of suite.cases) {
        it(`${c.expression} -> ${c.expect}`, () => expect(evaluate_expression(c.expression, suite.data)).toBe(c.expect));
    }
    for (const expression of suite.invalid) {
        it(`${JSON.stringify(expression)} is rejected`, () => expect(validate_expression(expression).valid).toBe(false));
    }
});

describe('Conformance: decision table entries', () => {
    const suite = read(path.join(CONFORMANCE, 'unary-tests.json'));
    for (const c of suite.cases) {
        const shown = c.missing ? 'missing' : JSON.stringify(c.value);
        it(`${JSON.stringify(c.entry)} with ${shown} -> ${c.expect}`, () => {
            expect(evaluate_unary_tests(c.entry, c.missing ? undefined : c.value)).toBe(c.expect);
        });
    }
    for (const entry of suite.invalid) {
        it(`${JSON.stringify(entry)} is rejected`, () => {
            expect(validate_unary_tests(entry).valid).toBe(false);
        });
    }
});

describe('Conformance: execution', () => {
    for (const file of list(path.join(CONFORMANCE, 'execution'))) {
        const c = read(file);
        const run = CLAIMED_LEVELS.has(c.level) ? it : it.skip;
        run(`[${c.level}] ${c.id}: ${c.description}`, async () => {
            expect(validate_schema(c.workflow), JSON.stringify(validate_schema.errors)).toBe(true);
            // A case with a clock runs on it: actors spend time on it and the host moves it
            let clock = c.clock ? Date.parse(c.clock) : 0;
            const actor = new ConformanceActor(c.actors, ms => { clock += ms; });
            const models = scripted_models(c.model || {});
            const agents = scripted_agents(c.agents);
            const options: WorkflowEngineOptions = {
                actors: { application: actor, ai_agent: actor, human: actor, robot: actor },
                a2a: { transport: agents.transport, poll_interval_ms: 0 },
                execution_logger: silent_logger,
                ...(c.tools ? { tools: { handlers: Object.fromEntries(Object.entries(c.tools as Record<string, { result?: unknown; error?: string }>).map(([name, script]) => [name, () => { if (script.error) throw new Error(script.error); return script.result; }])) } } : {}),
                ...(c.model ? models.options : {}),
                // Classifiers that guardrails call (31.8): each gives the case's verdict
                ...(c.classifiers ? { guardrail_classifiers: Object.fromEntries(Object.entries(c.classifiers as Record<string, { flagged: boolean; categories?: string[] }>).map(([name, verdict]) => [name, () => verdict])) } : {}),
                ...(c.clock ? { now: () => clock, sleep: async () => { } } : {}),
                ...(c.options || {}),
            };
            const engine = new WorkflowEngine(parse_document(c.workflow), options);
            await engine.start(c.input || {});
            let status = await engine.run();

            // Steps performed while the run waits: deliver a business event, or let its waits time out
            for (const step of c.deliver || []) {
                if (step.advance) {
                    clock += parse_iso_duration(step.advance);
                    continue;
                } else if (step.check_service_levels) {
                    expect(await engine.checkServiceLevels(), 'service levels checked').toMatchObject(step.expect || {});
                } else if (step.expire) {
                    await engine.expireEvents(Number.MAX_SAFE_INTEGER);
                } else if (step.agent_input !== undefined) {
                    // The host gives every agent that asked for input what the case says (28.6)
                    let resumed = 0;
                    for (const request of engine.getAgentRequests()) if (await engine.answerAgent(request.token_id, step.agent_input)) resumed++;
                    if (step.resumes !== undefined) expect(resumed, 'tokens given agent input').toBe(step.resumes);
                } else {
                    const resumed = await engine.deliverEvent({ specversion: '1.0', id: step.event.id || `evt-${Math.random()}`, source: '/conformance', type: step.event.type, data: step.event.data || {} });
                    if (step.resumes !== undefined) expect(resumed, `tokens resumed by ${step.event.type}`).toBe(step.resumes);
                }
                status = await engine.run();
            }

            expect(status).toBe(c.expect.status);
            if (c.expect.visited) expect(actor.visited).toEqual(c.expect.visited);
            if (c.expect.visited_unordered) expect([...actor.visited].sort()).toEqual([...c.expect.visited_unordered].sort());
            if (c.expect.not_visited) for (const name of c.expect.not_visited) expect(actor.visited).not.toContain(name);
            for (const [name, given] of Object.entries(c.expect.given_contexts || {})) expect(actor.contexts[name], `contexts given to ${name}`).toEqual(given);
            if (c.expect.contexts) expect(engine.getContexts()).toEqual(c.expect.contexts);
            for (const [name, given] of Object.entries(c.expect.given_inputs || {})) expect(is_subset(given, actor.inputs[name]), `input given to ${name}: ${JSON.stringify(actor.inputs[name])}`).toBe(true);
            if (c.expect.data) {
                expect(engine.getTokens().some(t => is_subset(c.expect.data, t.contextData))).toBe(true);
            }

            // Every implementation that journals must journal validly: schema-valid
            // events, numbered from 1 without gaps.
            const events = await engine.getEvents();
            events.forEach((event, i) => {
                expect(validate_event(event), JSON.stringify(validate_event.errors)).toBe(true);
                expect(event.seq).toBe(i + 1);
            });
            if (c.expect.journal) {
                // The expected types must appear in this order; other events may be interleaved
                let cursor = 0;
                for (const event of events) if (event.type === c.expect.journal[cursor]) cursor++;
                expect(c.expect.journal.slice(cursor), `journal was: ${events.map(e => e.type).join(', ')}`).toEqual([]);
            }
            for (const wanted of c.expect.journal_contains || []) {
                expect(events.some(e => is_subset(wanted, e)), `no event matches ${JSON.stringify(wanted)}`).toBe(true);
            }
            for (const type of c.expect.journal_excludes || []) expect(events.map(e => e.type)).not.toContain(type);
            // Text that no event may hold, whatever its field: what a guardrail matched is never journalled (31.7)
            for (const text of c.expect.journal_excludes_text || []) expect(events.filter(e => JSON.stringify(e).includes(text)).map(e => e.type), `events holding "${text}"`).toEqual([]);
            if (c.expect.guardrail_sources) expect(events.filter(e => e.type === 'guardrail.triggered').map(e => e.data.source)).toEqual(c.expect.guardrail_sources);
            for (const [type, n] of Object.entries(c.expect.journal_count || {})) expect(events.filter(e => e.type === type).length, `count of ${type}`).toBe(n);
            for (const wanted of c.expect.journal_mentions || []) {
                expect(events.some(e => is_subset(wanted.event, e) && wanted.mentions.every((text: string) => JSON.stringify(e.data).includes(text))),
                    `no event matching ${JSON.stringify(wanted.event)} mentions ${wanted.mentions.join(', ')}`).toBe(true);
            }
            if (c.expect.model_calls !== undefined) expect(models.total(), 'calls to the model').toBe(c.expect.model_calls);
            if (c.expect.agent_card_reads !== undefined) expect(agents.card_reads(), 'agent cards read').toBe(c.expect.agent_card_reads);
            if (c.expect.agent_requests) expect(agents.requests.map(r => r.method), 'requests to agents').toEqual(c.expect.agent_requests);
            for (const wanted of c.expect.agent_requests_contain || []) {
                expect(agents.requests.some(r => is_subset(wanted, r)), `no request to an agent matches ${JSON.stringify(wanted)}: ${JSON.stringify(agents.requests)}`).toBe(true);
            }
            for (const [id, n] of Object.entries(c.expect.provider_calls || {})) expect(models.calls[id], `calls to provider ${id}`).toBe(n);
            if (c.expect.error_matches) {
                const errors = engine.getTokens().map(t => String(t.getData('_error') || ''));
                expect(errors.some(e => new RegExp(c.expect.error_matches).test(e)), errors.join(' | ')).toBe(true);
            }
        });
    }
});

/** Event types must appear in this order; others may come between */
function in_order(wanted: string[], actual: string[]): string[] {
    let cursor = 0;
    for (const type of actual) if (type === wanted[cursor]) cursor++;
    return wanted.slice(cursor);
}

/** What a journey case expects of the journeys a host has recorded (Appendix A). Shared by the journey and shared store cases. */
async function expect_journeys(runtime: AwaRuntime, expected: any): Promise<void> {
    const validate_journey_event = ajv.getSchema('https://awa.io/schema/journey-event.schema.json')!;
    const names = new Map(runtime.list_journeys().map(j => [j.id, j.name]));
    const all = runtime.list_journey_instances();
    if (expected.instance_count !== undefined) expect(all.length).toBe(expected.instance_count);
    for (const wanted of expected.instances || []) {
        const found = all.filter(i => names.get(i.journey_id) === wanted.journey && (!wanted.subject_key || i.subject_key === wanted.subject_key));
        expect(found.length, `instances of ${wanted.journey} ${wanted.subject_key || ''}`).toBe(1);
        const i = found[0], types = i.events.map(e => e.type);
        // Every implementation that records journeys must record validly: schema-valid events, numbered from 1 without gaps
        i.events.forEach((event, n) => {
            expect(validate_journey_event(event), JSON.stringify(validate_journey_event.errors)).toBe(true);
            expect(event.seq).toBe(n + 1);
        });
        for (const key of ['status', 'stage_id', 'stalled', 'sentiment'] as const) if (wanted[key] !== undefined) expect(i[key], key).toBe(wanted[key]);
        if (wanted.goals_reached) expect(i.goals_reached).toEqual(wanted.goals_reached);
        if (wanted.runs) expect(i.runs.map(r => r.status)).toEqual(wanted.runs);
        if (wanted.data) expect(is_subset(wanted.data, i.data), JSON.stringify(i.data)).toBe(true);
        if (wanted.events) expect(in_order(wanted.events, types), `record was: ${types.join(', ')}`).toEqual([]);
        if (wanted.events_exact) expect(types).toEqual(wanted.events_exact);
        for (const [type, n] of Object.entries(wanted.events_count || {})) expect(types.filter(t => t === type).length, `count of ${type}`).toBe(n);
        for (const part of wanted.events_contain || []) {
            const { has, ...rest } = part;
            expect(i.events.some(e => is_subset(rest, e) && (has || []).every((p: string) => resolve_path(e, p) !== undefined)), `no journey event matches ${JSON.stringify(part)}`).toBe(true);
        }
        if (wanted.run_journal || wanted.run_journal_excludes) {
            const events = (await runtime.export_journey(i.id)).runs[0].events;
            expect(events.map(e => e.seq)).toEqual(events.map((_, n) => n + 1));
            if (wanted.run_journal) expect(in_order(wanted.run_journal, events.map(e => e.type)), `journal was: ${events.map(e => e.type).join(', ')}`).toEqual([]);
            for (const type of wanted.run_journal_excludes || []) expect(events.map(e => e.type), `journal was: ${events.map(e => e.type).join(', ')}`).not.toContain(type);
        }
    }
    if (expected.transitions) {
        expect(runtime.transitions().map(t => ({ from: names.get(t.from), to: names.get(t.to), count: t.count }))).toEqual(expected.transitions);
    }
}

describe('Conformance: journeys', () => {
    const validate_journey_schema = ajv.getSchema('https://awa.io/schema/journey.schema.json')!;
    for (const file of list(path.join(CONFORMANCE, 'journeys'))) {
        const c = read(file);
        const run = CLAIMED_LEVELS.has(c.level) ? it : it.skip;
        run(`[${c.level}] ${c.id}: ${c.description}`, async () => {
            let now = Date.parse(c.start);
            const store = new InMemoryRuntimeStore(), journal = new InMemoryJournalStore();
            const actor = new ConformanceActor(c.actors, ms => { now += ms; });
            const host = async (recover: boolean) => {
                const runtime = new AwaRuntime({
                    now: () => now, store,
                    engine: { actors: { application: actor, ai_agent: actor, human: actor, robot: actor }, journal, execution_logger: silent_logger, sleep: async () => { } },
                });
                for (const workflow of c.workflows) runtime.register_workflow(parse_document(workflow));
                for (const journey of c.journeys) {
                    expect(validate_journey_schema(journey), JSON.stringify(validate_journey_schema.errors)).toBe(true);
                    runtime.register_journey(JourneyDefinitionSchema.parse(journey));
                }
                if (recover) await runtime.recover();
                return runtime;
            };
            let runtime = await host(false);

            for (const step of c.steps) {
                if (step.advance) now += parse_iso_duration(step.advance);
                else if (step.restart) runtime = await host(true);
                else if (step.tick) {
                    const result = await runtime.tick();
                    if (step.expect?.timed_out_runs !== undefined) expect(result.timed_out_runs.length, 'runs timed out').toBe(step.expect.timed_out_runs);
                } else {
                    const e = step.publish;
                    const result = await runtime.publish({ specversion: '1.0', id: e.id || `evt-${Math.random()}`, source: e.source || '/conformance', type: e.type, data: e.data || {} });
                    if (step.expect?.accepted !== undefined) expect(result.accepted, `accepted ${e.type}`).toBe(step.expect.accepted);
                }
            }

            await expect_journeys(runtime, c.expect);
        });
    }
});

/**
 * Several hosts on one store (section 29). Every host of a case is an AwaRuntime on its own
 * connections to one PostgreSQL database; steps marked `together` are performed at once.
 */
describe('Conformance: shared store', () => {
    const unavailable = postgres_unavailable();
    if (unavailable) console.warn(`Shared store cases skipped: ${unavailable}`);
    let server: TestPostgres | undefined;
    beforeAll(async () => { if (!unavailable) server = await start_postgres(); }, 60_000);
    afterAll(async () => { await server?.stop(); });

    for (const file of list(path.join(CONFORMANCE, 'shared-store'))) {
        const c = read(file);
        const run = CLAIMED_LEVELS.has(c.level) && !unavailable ? it : it.skip;
        run(`[${c.level}] ${c.id}: ${c.description}`, async () => {
            const url = await server!.database();
            let now = Date.parse(c.start);
            const actor = new ConformanceActor(c.actors, ms => { now += ms; });
            const stores: PostgresRuntimeStore[] = [];
            const open_host = async (name: string) => {
                const stopping = { now: false };
                const store = await PostgresRuntimeStore.open(url, { host_id: name, before_commit: () => { if (stopping.now) throw new Error(`host ${name} stopped`); } });
                stores.push(store);
                const runtime = new AwaRuntime({ now: () => now, shared: store, engine: { actors: { application: actor, ai_agent: actor, human: actor, robot: actor }, execution_logger: silent_logger, sleep: async () => { } } });
                for (const workflow of c.workflows) runtime.register_workflow(parse_document(workflow));
                for (const journey of c.journeys) runtime.register_journey(JourneyDefinitionSchema.parse(journey));
                await runtime.recover();
                return { runtime, store, stopping };
            };
            const hosts = new Map<string, Awaited<ReturnType<typeof open_host>>>();
            for (const name of c.hosts) hosts.set(name, await open_host(name));
            const stop = async (name: string) => { await hosts.get(name)!.store.close(); hosts.delete(name); };
            /** One host's step; what it counts towards the step's expectations */
            const perform = async (step: any): Promise<{ accepted?: boolean; timed_out_runs?: number; stalled_journeys?: number }> => {
                const host = hosts.get(step.host);
                if (!host) throw new Error(`the case uses host ${step.host}, which is stopped`);
                if (step.tick) { const r = await host.runtime.tick(); return { timed_out_runs: r.timed_out_runs.length, stalled_journeys: r.stalled_journeys.length }; }
                const e = step.publish;
                const event = { specversion: '1.0' as const, id: e.id || `evt-${Math.random()}`, source: '/conformance', type: e.type, data: e.data || {} };
                if (step.stops_before_keeping) {
                    host.stopping.now = true;
                    await expect(host.runtime.publish(event)).rejects.toThrow(/stopped/);
                    await stop(step.host);
                    return {};
                }
                return { accepted: (await host.runtime.publish(event)).accepted };
            };
            const check = (wanted: any, results: Awaited<ReturnType<typeof perform>>[]) => {
                if (!wanted) return;
                const sum = (key: 'timed_out_runs' | 'stalled_journeys') => results.reduce((n, r) => n + (r[key] || 0), 0);
                if (wanted.accepted !== undefined) expect(typeof wanted.accepted === 'boolean' ? results[0].accepted : results.filter(r => r.accepted).length, 'accepted').toBe(wanted.accepted);
                if (wanted.timed_out_runs !== undefined) expect(sum('timed_out_runs'), 'runs timed out').toBe(wanted.timed_out_runs);
                if (wanted.stalled_journeys !== undefined) expect(sum('stalled_journeys'), 'journeys newly stalled').toBe(wanted.stalled_journeys);
            };
            try {
                for (const step of c.steps) {
                    if (step.advance) now += parse_iso_duration(step.advance);
                    else if (step.stop) await stop(step.stop);
                    else if (step.start) hosts.set(step.start, await open_host(step.start));
                    else if (step.together) check(step.expect, await Promise.all(step.together.map(perform)));
                    else check(step.expect, [await perform(step)]);
                }
                // What the store keeps, read by a host that took no part
                const reader = await open_host('reader');
                await reader.runtime.refresh();
                const stats = await reader.store.stats();
                if (c.expect.accepted_events !== undefined) expect(stats.accepted_events, 'events accepted').toBe(c.expect.accepted_events);
                if (c.expect.run_count !== undefined) expect(stats.runs, 'runs kept').toBe(c.expect.run_count);
                // Every journal is numbered from 1 without a gap, whichever host wrote which part
                for (const engine of reader.runtime.list_runs()) {
                    const events = await engine.getEvents();
                    expect(events.map(e => e.seq), `journal of ${engine.getRunId()}`).toEqual(events.map((_, n) => n + 1));
                }
                await expect_journeys(reader.runtime, c.expect);
            } finally {
                for (const store of stores) await store.close();
            }
        }, 60_000);
    }
});

describe('Conformance: counterfactual replay', () => {
    for (const file of list(path.join(CONFORMANCE, 'replay'))) {
        const c = read(file);
        const run = CLAIMED_LEVELS.has(c.level) ? it : it.skip;
        run(`[${c.level}] ${c.id}: ${c.description}`, async () => {
            const quiet = { execution_logger: silent_logger, sleep: async () => { } };
            const actor = new ConformanceActor(c.actors);
            const workflow = parse_document(c.workflow);
            const baseline = new WorkflowEngine(workflow, { actors: { application: actor, ai_agent: actor, human: actor, robot: actor }, ...quiet });
            await baseline.start(c.input || {});
            expect(await baseline.run()).toBe(c.expect.baseline_status);

            // In the replay nothing but the candidate's AI agents may run: every other actor is the recording
            const live = new ConformanceActor(c.candidate_actors);
            const { report, status, events } = await counterfactual_replay(workflow, await baseline.getEvents(), {
                candidate: c.candidate ? parse_document(c.candidate) : undefined, ai: c.ai,
                engine: { ...quiet, ...(c.ai === 'live' ? { actors: { ai_agent: live } } : {}) },
            });
            expect(status).toBe(c.expect.candidate_status);
            if (c.expect.same_path !== undefined) expect(report.same_path).toBe(c.expect.same_path);
            for (const [name, verdict] of Object.entries(c.expect.verdicts || {})) {
                expect(report.nodes.find(n => n.node_name === name)?.verdict, `verdict for ${name}`).toBe(verdict);
            }
            if (c.expect.regressions !== undefined) expect(report.regressions.length, report.regressions.join('; ')).toBe(c.expect.regressions);
            if (c.expect.regressions_at_least !== undefined) expect(report.regressions.length).toBeGreaterThanOrEqual(c.expect.regressions_at_least);
            if (c.expect.unrecorded !== undefined) expect(report.unrecorded.length, report.unrecorded.join('; ')).toBe(c.expect.unrecorded);
            if (c.expect.divergence_after) expect(report.divergence?.after).toBe(c.expect.divergence_after);
            if (c.expect.error_matches) expect(events.some(e => new RegExp(c.expect.error_matches).test(JSON.stringify(e.data))), 'no event carries the expected error').toBe(true);
        });
    }
});

describe('Conformance: knowledge', () => {
    type Wanted = { type?: string; node?: string; status?: string; observations?: number; sources?: number; reviewed_by?: string; count?: number };
    const matches = (wanted: Wanted, entry: KnowledgeEntry | undefined) => !!entry
        && (wanted.type === undefined || entry.type === wanted.type)
        && (wanted.node === undefined || entry.scope.node_name === wanted.node)
        && (wanted.status === undefined || entry.status === wanted.status)
        && (wanted.observations === undefined || entry.observations === wanted.observations)
        && (wanted.sources === undefined || entry.sources.length === wanted.sources)
        && (wanted.reviewed_by === undefined || (entry.reviewed_by === wanted.reviewed_by && !!entry.reviewed_at));
    const shown = (entries: (KnowledgeEntry | undefined)[]) => JSON.stringify(entries.map(e => e && { type: e.type, node: e.scope.node_name, status: e.status, observations: e.observations, sources: e.sources.length }));

    for (const file of list(path.join(CONFORMANCE, 'knowledge'))) {
        const c = read(file);
        const run = CLAIMED_LEVELS.has(c.level) ? it : it.skip;
        run(`[${c.level}] ${c.id}: ${c.description}`, async () => {
            expect(validate_schema(c.workflow), JSON.stringify(validate_schema.errors)).toBe(true);
            const workflow = parse_document(c.workflow);
            const knowledge = new KnowledgeBase();
            const journals = new Map<string, Awaited<ReturnType<WorkflowEngine['getEvents']>>>();
            /** The one entry a step names */
            const one = (wanted: Wanted) => {
                const found = knowledge.list().filter(e => matches(wanted, e));
                expect(found.length, `entries matching ${JSON.stringify(wanted)} among ${shown(knowledge.list())}`).toBe(1);
                return found[0];
            };

            for (const step of c.steps) {
                if (step.ingest) {
                    expect(journals.has(step.ingest), `run "${step.ingest}" has been performed`).toBe(true);
                    knowledge.ingest(workflow, journals.get(step.ingest)!);
                } else if (step.review) {
                    knowledge.review(one(step.review).id, step.by);
                } else if (step.deprecate) {
                    knowledge.deprecate(one(step.deprecate).id);
                } else {
                    // A run draws on the knowledge base as it stands; it is not ingested until a step says so
                    const actor = new ConformanceActor(step.actors);
                    const engine = new WorkflowEngine(workflow, {
                        actors: { application: actor, ai_agent: actor, human: actor, robot: actor },
                        knowledge, execution_logger: silent_logger, sleep: async () => { },
                    });
                    await engine.start(step.input || {});
                    expect(await engine.run(), `status of run "${step.run}"`).toBe(step.expect.status);
                    const events = await engine.getEvents();
                    journals.set(step.run, events);
                    for (const [name, wanted] of Object.entries((step.expect.given || {}) as Record<string, Wanted[]>)) {
                        const executions = actor.given.filter(g => g.activity === name);
                        expect(executions.length, `executions of ${name} in run "${step.run}"`).toBeGreaterThan(0);
                        for (const execution of executions) {
                            const entries = execution.ids.map(id => knowledge.get(id));
                            expect(entries.length === wanted.length && wanted.every((w, i) => matches(w, entries[i])),
                                `${name} in run "${step.run}" was given ${shown(entries)}, expected ${JSON.stringify(wanted)}`).toBe(true);
                        }
                    }
                    for (const wanted of step.expect.journal_contains || []) {
                        expect(events.some(e => is_subset(wanted, e)), `no event of run "${step.run}" matches ${JSON.stringify(wanted)}`).toBe(true);
                    }
                }
            }

            const all = knowledge.list();
            if (c.expect.entry_count !== undefined) expect(all.length, shown(all)).toBe(c.expect.entry_count);
            for (const wanted of (c.expect.entries || []) as Wanted[]) {
                expect(all.filter(e => matches(wanted, e)).length, `entries matching ${JSON.stringify(wanted)} among ${shown(all)}`).toBe(wanted.count ?? 1);
            }
            // Every entry is traceable: each source names a run that was ingested and events of its journal (15.2)
            for (const entry of all) for (const source of entry.sources) {
                const journal = [...journals.values()].find(events => events[0]?.run_id === source.run_id);
                expect(journal, `${entry.id} cites run ${source.run_id}`).toBeDefined();
                expect(source.event_seqs.length, `${entry.id} cites events`).toBeGreaterThan(0);
                for (const seq of source.event_seqs) expect(journal!.some(e => e.seq === seq), `${entry.id} cites event ${seq}`).toBe(true);
            }
        });
    }
});

describe('Conformance: measures', () => {
    const ajv = new Ajv2020({ strict: false, allErrors: true }); addFormats(ajv);
    const report_schema = ajv.compile(JSON.parse(fs.readFileSync(path.join(ROOT, 'spec/json-schema/measure-report.schema.json'), 'utf-8')));
    const dir = path.join(CONFORMANCE, 'measures');
    const same = (got: unknown, want: unknown) => (want === null ? got === null : typeof got === 'number' && Math.abs(got - (want as number)) < 1e-9);
    for (const file of fs.readdirSync(dir).filter(f => f.endsWith('.json')).sort()) {
        const c = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf-8'));
        const run = CLAIMED_LEVELS.has(c.level) ? it : it.skip;
        run(`${c.id}: ${c.description}`, () => {
            const report = compute_measures(c.recorded, c.options) as any;
            // The report has the form the schema fixes
            const valid = report_schema(JSON.parse(JSON.stringify(report)));
            expect(valid, JSON.stringify(report_schema.errors?.slice(0, 3))).toBe(true);
            const measures = (where: string, got: Record<string, { value: number | null }>, want: Record<string, number | null>) => {
                for (const [id, value] of Object.entries(want)) expect(same(got[id]?.value, value), `${where} ${id}: got ${got[id]?.value}, expected ${value}`).toBe(true);
            };
            if (c.expect.currency) expect(report.currency).toBe(c.expect.currency);
            for (const j of c.expect.journeys || []) {
                const got = report.journeys.find((x: any) => x.name === j.name);
                expect(got, `journey ${j.name}`).toBeDefined();
                measures(j.name, got.measures, j.measures || {});
                for (const s of j.stages || []) {
                    const stage = got.stages.find((x: any) => x.stage_id === s.stage_id);
                    expect(stage, `stage ${s.stage_id}`).toBeDefined();
                    if ('owner' in s) expect(stage.owner).toBe(s.owner);
                    measures(`${j.name} / ${s.stage_id}`, stage.measures, s.measures);
                }
                if (j.channels) expect(got.channels).toEqual(j.channels);
                if (j.artefacts) expect(got.artefacts).toEqual(j.artefacts);
            }
            for (const w of c.expect.workflows || []) {
                const got = report.workflows.find((x: any) => x.name === w.name);
                expect(got, `workflow ${w.name}`).toBeDefined();
                measures(w.name, got.measures, w.measures || {});
                for (const a of w.activities || []) measures(`${w.name} / ${a.name}`, got.activities.find((x: any) => x.name === a.name).measures, a.measures);
            }
            if (c.expect.attention) {
                expect(report.attention).toHaveLength(c.expect.attention.length);
                c.expect.attention.forEach((want: any, i: number) => expect(report.attention[i]).toMatchObject(want));
            }
        });
    }
});

describe('Conformance: telemetry', () => {
    const dir = path.join(CONFORMANCE, 'telemetry');
    /** Attribute lists in any order: sorted by key at every depth */
    const normalise = (value: any): any => {
        if (Array.isArray(value)) return value.map(normalise);
        if (!value || typeof value !== 'object') return value;
        const out: any = {};
        for (const [k, v] of Object.entries(value)) {
            out[k] = k === 'attributes' && Array.isArray(v) ? [...v].sort((a: any, b: any) => a.key.localeCompare(b.key)).map(normalise) : normalise(v);
        }
        return out;
    };
    for (const file of fs.readdirSync(dir).filter(f => f.endsWith('.json')).sort()) {
        const c = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf-8'));
        const run = CLAIMED_LEVELS.has(c.level) ? it : it.skip;
        run(`${c.id}: ${c.description}`, () => {
            if (c.report) {
                const gauges = measures_to_gauges(c.report, MEASURES);
                const request = gauges_to_otlp_json(gauges, c.report) as any;
                const metrics = request.resourceMetrics[0].scopeMetrics[0].metrics;
                expect(metrics).toHaveLength(c.expect.metric_count);
                for (const name of c.expect.absent || []) expect(metrics.find((m: any) => m.name === name), name).toBeUndefined();
                for (const want of c.expect.metrics) {
                    const got = metrics.find((m: any) => m.name === want.name);
                    expect(got, want.name).toBeDefined();
                    expect(got.unit, `${want.name} unit`).toBe(want.unit);
                    const points = got.gauge.dataPoints.map((p: any) => ({
                        attributes: Object.fromEntries(p.attributes.map((a: any) => [a.key, a.value.stringValue])), value: p.asDouble,
                    }));
                    expect(points, want.name).toEqual(want.points);
                    for (const p of got.gauge.dataPoints) {
                        expect(p.timeUnixNano).toBe(String(BigInt(Date.parse(c.expect.time)) * 1_000_000n));
                        expect(p.startTimeUnixNano).toBe(String(BigInt(Date.parse(c.expect.start_time)) * 1_000_000n));
                    }
                }
                return;
            }
            const spans = c.journal
                ? run_spans({ decision_nodes: c.decision_nodes.map((id: string) => ({ id })) }, c.journal, c.options)
                : journey_spans(c.journey, c.options);
            expect(spans, 'span count').toHaveLength(c.expect.span_count);
            for (const s of spans) expect(s.trace_id).toBe(c.expect.trace_id);
            if (c.expect.otlp_json) {
                expect(normalise(spans_to_otlp_json(spans))).toEqual(normalise(c.expect.otlp_json));
            }
            for (const want of c.expect.spans || []) {
                const matching = spans.filter(s => s.span_id === want.span_id);
                expect(matching, `span ${want.span_id}`).toHaveLength(1);
                const got = matching[0];
                const where = `${got.name} (${got.span_id})`;
                if ('parent_span_id' in want) expect(got.parent_span_id ?? null, `${where} parent`).toBe(want.parent_span_id);
                if (want.name) expect(got.name).toBe(want.name);
                if (want.kind) expect(got.kind, `${where} kind`).toBe(want.kind);
                if (want.start) expect(got.start_ms, `${where} start`).toBe(Date.parse(want.start));
                if (want.end) expect(got.end_ms, `${where} end`).toBe(Date.parse(want.end));
                if (want.status) expect(got.status.code, `${where} status`).toBe(want.status);
                if ('status_message' in want) expect(got.status.message, `${where} status message`).toBe(want.status_message);
                for (const [key, value] of Object.entries(want.attributes || {})) expect(got.attributes[key], `${where} ${key}`).toEqual(value);
                for (const key of want.absent || []) expect(got.attributes[key], `${where} has ${key}`).toBeUndefined();
                if (want.events) expect(got.events.map(e => e.name), `${where} events`).toEqual(want.events);
                for (const e of want.events_contain || []) {
                    const found = got.events.filter(x => x.name === e.name
                        && Object.entries(e.attributes || {}).every(([k, v]) => JSON.stringify(x.attributes[k]) === JSON.stringify(v))
                        && (e.absent || []).every((k: string) => x.attributes[k] === undefined));
                    expect(found.length, `${where}: an event ${JSON.stringify(e)} among ${JSON.stringify(got.events)}`).toBeGreaterThan(0);
                }
                if (want.links) expect(got.links.map(l => ({ trace_id: l.trace_id, span_id: l.span_id })), `${where} links`).toEqual(want.links);
            }
        });
    }
});

describe('Conformance: evidence', () => {
    const ajv = new Ajv2020({ strict: false, allErrors: true }); addFormats(ajv);
    const report_schema = ajv.compile(read(path.join(SCHEMAS, 'evidence-report.schema.json')));
    const sorted = (citations: any[]) => [...citations].map(c => JSON.stringify(c)).sort();
    for (const file of list(path.join(CONFORMANCE, 'evidence'))) {
        const c = read(file);
        const run = CLAIMED_LEVELS.has(c.level) ? it : it.skip;
        run(`[${c.level}] ${c.id}: ${c.description}`, () => {
            const report = compute_evidence(c.recorded, c.options) as any;
            expect(report_schema(JSON.parse(JSON.stringify(report))), JSON.stringify(report_schema.errors?.slice(0, 3))).toBe(true);
            // Every statement rests on records that exist (32.2)
            expect(unresolved_citations(report, c.recorded)).toEqual([]);
            const part = (id: string) => report.parts.find((p: any) => p.id === id);
            for (const [id, summary] of Object.entries(c.expect.summaries || {})) {
                expect(is_subset(summary, part(id).summary), `summary of ${id}: ${JSON.stringify(part(id).summary)}`).toBe(true);
            }
            for (const want of c.expect.statements || []) {
                const found = part(want.part).statements.filter((s: any) => s.kind === want.kind && is_subset(want.facts, s.facts));
                expect(found.length, `${want.part}/${want.kind} ${JSON.stringify(want.facts)} among ${JSON.stringify(part(want.part).statements.map((s: any) => s.facts))}`).toBe(1);
                if (want.citations) expect(sorted(found[0].citations), `citations of ${want.part}/${want.kind} ${JSON.stringify(want.facts)}`).toEqual(sorted(want.citations));
            }
            for (const want of c.expect.absent || []) {
                expect(part(want.part).statements.filter((s: any) => s.kind === want.kind && is_subset(want.facts, s.facts)), `${want.part}/${want.kind} ${JSON.stringify(want.facts)} must be absent`).toEqual([]);
            }
            if (c.expect.cited_runs) {
                const cited = new Set<string>(report.parts.flatMap((p: any) => p.statements.flatMap((s: any) => s.citations.filter((x: any) => x.run_id).map((x: any) => x.run_id))));
                expect([...cited].sort()).toEqual([...c.expect.cited_runs].sort());
            }
        });
    }
});

describe('Conformance: evaluation', () => {
    const ajv = new Ajv2020({ strict: false, allErrors: true }); addFormats(ajv);
    const case_schema = ajv.compile(read(path.join(SCHEMAS, 'evaluation-case.schema.json')));
    const report_schema = ajv.compile(read(path.join(SCHEMAS, 'evaluation-report.schema.json')));
    const same = (got: unknown, want: unknown) => (want === null ? got === null : typeof want === 'number' ? typeof got === 'number' && Math.abs(got - want) < 1e-9 : JSON.stringify(got) === JSON.stringify(want));
    for (const file of list(path.join(CONFORMANCE, 'evaluation'))) {
        const c = read(file);
        const run = CLAIMED_LEVELS.has(c.level) ? it : it.skip;
        run(`[${c.level}] ${c.id}: ${c.description}`, async () => {
            if (c.kind === 'build') {
                const { cases, skipped } = build_dataset(c.journals);
                for (const k of cases) expect(case_schema(k), JSON.stringify(case_schema.errors)).toBe(true);
                expect(cases.length, JSON.stringify(cases.map(k => k.id))).toBe(c.expect.case_count);
                expect(skipped.length, JSON.stringify(skipped)).toBe(c.expect.skipped);
                for (const want of c.expect.cases) {
                    const got = cases.find(k => k.id === want.id);
                    expect(got, `case ${want.id}`).toBeDefined();
                    for (const [key, value] of Object.entries(want)) expect((got as any)[key], `${want.id}.${key}`).toEqual(value);
                }
                return;
            }
            const workflow = parse_document(c.workflow);
            const report = await evaluate_dataset(workflow, c.dataset, {
                candidate: c.candidate ? parse_document(c.candidate) : undefined,
                engine: { execution_logger: silent_logger, sleep: async () => { } },
                // The candidate's agent, scripted per activity, and per case where the case says so
                engine_for_case: k => {
                    const scripts: Record<string, ActorScript> = {};
                    for (const [name, script] of Object.entries(c.candidate_actors as Record<string, any>)) scripts[name] = script.cases?.[k.id] ?? script;
                    return { actors: { ai_agent: new ConformanceActor(scripts) } };
                },
            });
            expect(report_schema(JSON.parse(JSON.stringify(report))), JSON.stringify(report_schema.errors?.slice(0, 3))).toBe(true);
            const e = c.expect;
            if (e.evaluated !== undefined) expect(report.evaluated).toBe(e.evaluated);
            if (e.skipped !== undefined) expect(report.skipped.length, JSON.stringify(report.skipped)).toBe(e.skipped);
            if (e.regressions !== undefined) expect(report.regressions.length, JSON.stringify(report.regressions)).toBe(e.regressions);
            if (e.improvements !== undefined) expect(report.improvements.length, JSON.stringify(report.improvements)).toBe(e.improvements);
            for (const [name, want] of Object.entries(e.activities || {}) as [string, any][]) {
                const got = report.activities.find(a => a.activity_name === name) as any;
                expect(got, `activity ${name}`).toBeDefined();
                for (const [key, value] of Object.entries(want)) {
                    const actual = got[key] && typeof got[key] === 'object' && 'value' in got[key] ? got[key].value : got[key];
                    expect(same(actual, value), `${name}.${key}: got ${JSON.stringify(actual)}, expected ${JSON.stringify(value)}`).toBe(true);
                }
            }
            for (const [id, want] of Object.entries(e.results || {}) as [string, any][]) {
                const got = report.results.find(r => r.case_id === id) as any;
                expect(got, `result of ${id}`).toBeDefined();
                for (const [key, value] of Object.entries(want)) {
                    const actual = key === 'unrecorded' ? got.unrecorded.length : got[key];
                    expect(actual, `${id}.${key}`).toEqual(value);
                }
            }
        });
    }
});

describe('Conformance: interchange', () => {
    for (const file of list(path.join(CONFORMANCE, 'interchange'))) {
        const c = read(file);
        const run = CLAIMED_LEVELS.has(c.level) ? it : it.skip;
        run(`${c.id}: ${c.description}`, async () => {
            if (c.expect.error_matches) {
                const attempt = c.kind === 'import_dmn' ? import_dmn(c.dmn) : import_bpmn(c.bpmn, { dmn: c.dmn || [] });
                await expect(attempt).rejects.toThrow(new RegExp(c.expect.error_matches));
                return;
            }
            if (c.kind === 'import_bpmn') {
                const result = await import_bpmn(c.bpmn, { dmn: c.dmn || [] });
                expect(result.documents).toEqual(c.expect.documents);
            } else if (c.kind === 'import_dmn') {
                expect((await import_dmn(c.dmn)).decisions).toEqual(c.expect.decisions);
            } else if (c.kind === 'round_trip') {
                const exported = await export_bpmn([c.workflow]);
                const back = await import_bpmn(exported.bpmn, { dmn: exported.dmn ? [exported.dmn] : [] });
                expect(back.documents[0]).toEqual(c.workflow);
                expect(json_equal(back.documents[0], c.workflow)).toBe(true);
            } else if (c.kind === 'export_serverless_workflow') {
                const result = await export_serverless_workflow(c.workflow);
                expect(result.document).toEqual(c.expect.document);
                expect(result.not_mapped).toEqual(c.expect.not_mapped);
            } else {
                throw new Error(`unknown kind ${c.kind}`);
            }
        });
    }
    const feel = read(path.join(CONFORMANCE, 'feel.json'));
    const run = CLAIMED_LEVELS.has('interchange') ? it : it.skip;
    for (const t of feel.unary) run(`FEEL ${JSON.stringify(t.feel)} is the entry ${JSON.stringify(t.awa)}`, () => expect(feel_unary_to_awa(t.feel)).toBe(t.awa));
    for (const t of feel.unary_invalid) run(`FEEL ${JSON.stringify(t)} is refused as an entry`, () => expect(() => feel_unary_to_awa(t)).toThrow(/FEEL/));
    for (const t of feel.unary_export) run(`the entry ${JSON.stringify(t.awa)} is FEEL ${JSON.stringify(t.feel)}`, () => expect(awa_unary_to_feel(t.awa, t.type)).toBe(t.feel));
    for (const t of feel.conditions) run(`the condition ${JSON.stringify(t.bpmn)} is ${JSON.stringify(t.awa)}`, () => expect(feel_condition_to_awa(t.bpmn)).toBe(t.awa));
    for (const t of feel.conditions_invalid) run(`the condition ${JSON.stringify(t)} is refused`, () => expect(() => feel_condition_to_awa(t)).toThrow(/cannot be read/));
    for (const t of feel.conditions_export) run(`${JSON.stringify(t.awa)} in FEEL is ${JSON.stringify(t.feel)}`, () => expect(awa_condition_to_feel(t.awa) ?? null).toBe(t.feel));
});

describe('Conformance: authorization', () => {
    for (const file of list(path.join(CONFORMANCE, 'authorization'))) {
        const c = read(file);
        const run = CLAIMED_LEVELS.has(c.level) ? it : it.skip;
        run(`[${c.level}] ${c.id}: ${c.description}`, async () => {
            expect(validate_schema(c.workflow), JSON.stringify(validate_schema.errors)).toBe(true);
            const workflow = parse_document(c.workflow);
            // Activities of human actors wait for a person; the others follow the case's scripts
            const actor = new ConformanceActor(c.actors);
            const person: Actor = { execute: async activity => ({ _requires_human_action: true, _human_task_id: `task-${activity.name}` }) };
            const agents = scripted_agents(c.agents);
            let engine: WorkflowEngine | undefined;
            const outcome = async (work: () => Promise<unknown>) => {
                try { await work(); return { allowed: true } as { allowed: boolean; code?: string; reason?: string }; } catch (error) {
                    if (!(error instanceof AuthorizationError)) throw error;
                    return { allowed: false, code: error.code, reason: error.decision.reason };
                }
            };
            for (const step of c.steps) {
                let result: { allowed: boolean; code?: string; reason?: string };
                if (step.start) {
                    engine = new WorkflowEngine(workflow, {
                        actors: { application: actor, ai_agent: actor, robot: actor, human: person },
                        wait_for_human_tasks: true,
                        a2a: { transport: agents.transport, poll_interval_ms: 0 },
                        execution_logger: silent_logger,
                        authorization: c.authorization,
                        ...(step.start.principal ? { principal: step.start.principal } : {}),
                        ...(c.tools ? { tools: { handlers: Object.fromEntries(Object.entries(c.tools as Record<string, { result?: unknown; error?: string }>).map(([name, script]) => [name, () => { if (script.error) throw new Error(script.error); return script.result; }])) } } : {}),
                    });
                    const started = engine;
                    result = await outcome(() => started.start(step.start.input || {}));
                    if (result.allowed) await engine.run();
                } else {
                    const name = step.complete.activity;
                    const id = workflow.activities.find(a => a.name === name)!.id;
                    const token = engine!.getTokens().find(t => t.status === 'waiting' && t.activityId === id);
                    expect(token, `a token waits at ${name}`).toBeDefined();
                    const current = engine!;
                    result = await outcome(async () => { expect(await current.resumeToken(token!.id, step.complete.output || {}, step.complete.principal)).toBe(true); });
                    await engine!.run();
                }
                expect(result.allowed, `step ${JSON.stringify(step)}`).toBe(step.expect.allowed);
                if (step.expect.code) expect(result.code).toBe(step.expect.code);
                if (step.expect.reason) expect(result.reason).toBe(step.expect.reason);
                if (step.expect.status) expect(engine!.getStatus(), 'status after the step').toBe(step.expect.status);
            }

            const events = engine ? await engine.getEvents() : [];
            if (c.expect.started === false) {
                expect(events, 'a refused start leaves no journal').toEqual([]);
                return;
            }
            expect(engine!.getStatus()).toBe(c.expect.status);
            events.forEach((event, i) => {
                expect(validate_event(event), JSON.stringify(validate_event.errors)).toBe(true);
                expect(event.seq).toBe(i + 1);
            });
            const decisions = events.filter(e => e.type === 'authorization.decided').map(e => e.data);
            if (c.expect.decisions) {
                expect(decisions.length, `decisions were ${JSON.stringify(decisions)}`).toBe(c.expect.decisions.length);
                c.expect.decisions.forEach((wanted: unknown, i: number) => expect(is_subset(wanted, decisions[i]), `decision ${i}: ${JSON.stringify(decisions[i])}`).toBe(true));
            }
            if (c.expect.visited) expect(actor.visited).toEqual(c.expect.visited);
            if (c.expect.data) expect(engine!.getTokens().some(t => is_subset(c.expect.data, t.contextData)), 'data').toBe(true);
            if (c.expect.journal) expect(in_order(c.expect.journal, events.map(e => e.type)), `journal was: ${events.map(e => e.type).join(', ')}`).toEqual([]);
            for (const wanted of c.expect.journal_contains || []) expect(events.some(e => is_subset(wanted, e)), `no event matches ${JSON.stringify(wanted)}`).toBe(true);
            for (const type of c.expect.journal_excludes || []) expect(events.map(e => e.type)).not.toContain(type);
            for (const [type, n] of Object.entries(c.expect.journal_count || {})) expect(events.filter(e => e.type === type).length, `count of ${type}`).toBe(n);
            if (c.expect.agent_card_reads !== undefined) expect(agents.card_reads(), 'agent cards read').toBe(c.expect.agent_card_reads);
            if (c.expect.agent_requests) expect(agents.requests.map(r => r.method), 'requests to agents').toEqual(c.expect.agent_requests);
        });
    }
});

describe('Conformance: published examples', () => {
    const examples = fs.readdirSync(path.join(ROOT, 'examples'))
        .flatMap(dir => list(path.join(ROOT, 'examples', dir)).filter(f => f.endsWith('.awa.json')))
        .concat(path.join(ROOT, 'workflow.awa.json'));

    for (const file of examples) {
        it(`${path.relative(ROOT, file)} is a valid AWA document`, () => {
            const raw = read(file);
            expect(validate_schema(unwrap(raw)), JSON.stringify(validate_schema.errors?.slice(0, 3))).toBe(true);
            expect(validate_workflow_integrity(parse_document(raw)).errors).toEqual([]);
        });
    }
});

describe('Published examples run in simulation', () => {
    // Simulated actors return no business data, so an example whose routing
    // depends on data ships a simulation.json saying what each activity returns.
    const dirs = fs.readdirSync(path.join(ROOT, 'examples'))
        .map(dir => path.join(ROOT, 'examples', dir))
        .filter(dir => list(dir).some(f => f.endsWith('.awa.json')));

    for (const dir of dirs) for (const file of list(dir).filter(f => f.endsWith('.awa.json'))) {
        it(`${path.relative(ROOT, file)} completes`, async () => {
            const fixture = path.join(dir, 'simulation.json');
            // Business events a workflow waits for (spec 18.3), delivered while it waits
            const events_file = path.join(dir, 'simulation-events.json');
            const events: Array<{ type: string; data?: Record<string, unknown> }> = fs.existsSync(events_file) ? read(events_file) : [];
            const engine = new WorkflowEngine(parse_document(read(file)), {
                simulate: true,
                simulated_outputs: fs.existsSync(fixture) ? read(fixture) : undefined,
                execution_logger: silent_logger,
                sleep: async () => { },
            });
            await engine.start();
            let status = await engine.run();
            for (let round = 0; status === 'waiting_event' && round < 10; round++) {
                let resumed = 0;
                for (const event of events) resumed += await engine.deliverEvent(business_event(event.type, event.data || {}, { id: `sim-${round}-${event.type}` }));
                if (!resumed && !(await engine.expireEvents(Number.MAX_SAFE_INTEGER))) break;
                status = await engine.run();
            }
            expect(status).toBe('completed');
        }, 30000);
    }
});

/**
 * Changing a workflow while runs are in flight (section 25). A host plays the steps; a case that
 * gives a run's `state` instead has its plan checked against that state, without a host.
 */
describe('Conformance: versioning', () => {
    for (const file of list(path.join(CONFORMANCE, 'versioning'))) {
        const c = read(file);
        const run = CLAIMED_LEVELS.has(c.level) ? it : it.skip;
        run(`[${c.level}] ${c.id}: ${c.description}`, async () => {
            const versions = new Map<string, any>(c.workflows.map((w: any) => [w.version, parse_document(w)]));
            const names = new Map<string, string>();
            for (const w of versions.values()) for (const n of [...w.activities, ...w.events, ...w.decision_nodes]) names.set(n.id, n.name);
            const token_view = (t: any) => ({ from: names.get(t.from_node_id), to: names.get(t.to_node_id), wait: t.wait, outcome: t.outcome });
            const codes = (refusals: { code: string }[]) => refusals.map(r => r.code).sort();

            if (c.state) {
                // A run's state as recorded, in the form this implementation keeps it (10.3)
                const from = versions.get(c.state.version), to = versions.get(c.migrate.plan.to_version);
                const by_name = (name: string) => [...from.activities, ...from.events].find((n: any) => n.name === name).id;
                const state: WorkflowState = {
                    version: '1.0', workflow_id: from.id, workflow_name: from.name, workflow_version: from.version, engine_status: c.state.status, contexts: {}, checkpoint_at: c.start,
                    tokens: c.state.tokens.map((t: any) => {
                        const node = by_name(t.node);
                        const waits = t.waits || {};
                        const data = { ...t.data, ...(waits.kind === 'timer' ? { [`_timer_due:${node}`]: waits.due_at } : {}),
                            ...(waits.kind === 'human' ? { _requires_human_action: true, _human_task_id: 'task' } : {}),
                            ...(waits.kind === 'event' ? { _awaiting_event: { node_id: node, name: waits.name, correlation_key: waits.correlation_key, correlation_value: waits.correlation_value } } : {}) };
                        return { id: t.id, activity_id: node, status: t.status, context_data: data, created_at: c.start, updated_at: c.start };
                    }),
                    metadata: { run_id: 'recorded-run' },
                };
                const result = plan_migration(from, to, state, c.migrate.plan);
                expect(codes(result.refusals), JSON.stringify(result.refusals)).toEqual([...c.expect.refusals].sort());
                if (c.expect.refused_tokens) expect(result.refusals.map(r => r.token_id)).toEqual(c.expect.refused_tokens);
                if (c.expect.tokens) expect(result.tokens.filter(t => t.wait).map(token_view)).toEqual(c.expect.tokens);
                for (const [token_id, due] of Object.entries(c.expect.timers || {})) {
                    const token = result.state!.tokens.find(t => t.id === token_id)!;
                    expect(token.context_data[`_timer_due:${token.activity_id}`]).toBe(due);
                }
                return;
            }

            let now = Date.parse(c.start);
            const store = new InMemoryRuntimeStore(), journal = new InMemoryJournalStore();
            const actor = new ConformanceActor(c.actors, ms => { now += ms; });
            let registered: string[] = [];
            const runs = new Map<string, string>();
            const host = (with_versions: string[]) => {
                const runtime = new AwaRuntime({
                    now: () => now, store,
                    engine: { actors: { application: actor, ai_agent: actor, human: actor, robot: actor }, journal, execution_logger: silent_logger, sleep: async () => { }, wait_for_human_tasks: true },
                });
                for (const version of with_versions) runtime.register_workflow(versions.get(version));
                if (with_versions.length) for (const journey of c.journeys || []) runtime.register_journey(JourneyDefinitionSchema.parse(journey));
                return runtime;
            };
            let runtime = host([]);
            const engine_of = (name: string) => runtime.get_run(runs.get(name)!)!;
            const check_run = (name: string, wanted: any) => {
                if (!wanted) return;
                const engine = engine_of(name);
                if (wanted.version) expect(engine.getWorkflow().version, `version of ${name}`).toBe(wanted.version);
                if (wanted.status) expect(engine.getStatus(), `status of ${name}`).toBe(wanted.status);
            };

            for (const step of c.steps) {
                if (step.register) {
                    runtime.register_workflow(versions.get(step.register));
                    if (!registered.length) for (const journey of c.journeys || []) runtime.register_journey(JourneyDefinitionSchema.parse(journey));
                    registered.push(step.register);
                } else if (step.restart) {
                    const with_versions = step.restart.versions || registered;
                    const next = host(with_versions);
                    if (step.expect?.refused) {
                        await expect(next.recover(), 'a host without a version a run needs').rejects.toThrow(/not registered/);
                        continue;
                    }
                    await next.recover();
                    runtime = next;
                    registered = [...with_versions];
                } else if (step.advance) now += parse_iso_duration(step.advance);
                else if (step.tick) await runtime.tick();
                else if (step.publish) {
                    const e = step.publish;
                    const result = await runtime.publish({ specversion: '1.0', id: e.id || `evt-${Math.random()}`, source: '/conformance', type: e.type, data: e.data || {} });
                    if (step.as) runs.set(step.as, result.started_runs[0]);
                    check_run(step.as, step.expect);
                } else if (step.start) {
                    const engine = await runtime.start(versions.get(registered[0]).id, step.start.input || {}, undefined, { version: step.start.version });
                    runs.set(step.as, engine.getRunId());
                    check_run(step.as, step.expect);
                } else if (step.complete) {
                    const engine = engine_of(step.complete.run);
                    const token = engine.getTokens().find(t => t.status === 'waiting' && names.get(t.activityId) === step.complete.node);
                    expect(token, `a token of ${step.complete.run} waiting at ${step.complete.node}`).toBeDefined();
                    expect(await runtime.resume(engine.getRunId(), token!.id, step.complete.output || {})).toBe(true);
                } else if (step.migrate) {
                    const result = await runtime.migrate(runs.get(step.migrate.run)!, step.migrate.plan, { dry_run: !!step.migrate.dry_run });
                    const wanted = step.expect || {};
                    expect(codes(result.refusals), JSON.stringify(result.refusals)).toEqual([...(wanted.refusals || [])].sort());
                    for (const key of ['applied', 'dry_run', 'status'] as const) if (wanted[key] !== undefined) expect(result[key], key).toBe(wanted[key]);
                    if (wanted.tokens) expect(result.tokens.filter(t => t.wait).map(token_view)).toEqual(wanted.tokens);
                    if (wanted.data_changes) {
                        expect(result.data_changes.length, JSON.stringify(result.data_changes)).toBe(wanted.data_changes.length);
                        wanted.data_changes.forEach((change: any, i: number) => expect(is_subset(change, result.data_changes[i]), JSON.stringify(result.data_changes[i])).toBe(true));
                    }
                    const engine = engine_of(step.migrate.run);
                    if (wanted.run_version) expect(engine.getWorkflow().version, 'the version the run is on').toBe(wanted.run_version);
                    if (wanted.run_status) expect(engine.getStatus(), 'the status of the run').toBe(wanted.run_status);
                } else if (step.check) {
                    const report = await runtime.check_migration(versions.get(registered[0]).id, { to_version: step.check.to_version, from_version: step.check.from_version, plan: step.check.plan });
                    const wanted = step.expect || {};
                    const positions = report.comparisons.flatMap(r => r.positions);
                    if (wanted.automatic !== undefined) expect(report.comparisons.every(r => r.automatic), 'automatic').toBe(wanted.automatic);
                    if (wanted.positions) {
                        expect(positions.length, JSON.stringify(positions)).toBe(wanted.positions.length);
                        wanted.positions.forEach((p: any, i: number) => {
                            const got = positions[i];
                            expect({ node: got.node_name, wait: got.wait, class: got.class, ...(p.to ? { to: got.to_node_name } : {}), ...(p.outcome ? { outcome: got.outcome } : {}),
                                ...(p.candidates ? { candidates: (got.candidates || []).map(n => n.node_name) } : {}) }).toEqual(p);
                        });
                    }
                    for (const r of wanted.runs || []) {
                        const got = report.runs.find(x => x.run_id === runs.get(r.run));
                        expect(got, `run ${r.run} in the check`).toBeDefined();
                        expect(got!.migratable, `${r.run} migratable`).toBe(r.migratable);
                    }
                }
            }

            if (c.expect.visited) expect(actor.visited).toEqual(c.expect.visited);
            for (const [name, wanted] of Object.entries<any>(c.expect.runs || {})) {
                check_run(name, wanted);
                const engine = engine_of(name);
                if (wanted.data) expect(engine.getTokens().some(t => is_subset(wanted.data, t.contextData)), JSON.stringify(engine.getTokens().map(t => t.contextData))).toBe(true);
                for (const key of wanted.data_absent || []) expect(engine.getTokens().every(t => resolve_path(t.contextData, key) === undefined), `${key} absent`).toBe(true);
                const events = await engine.getEvents();
                events.forEach((event, i) => {
                    expect(validate_event(event), JSON.stringify(validate_event.errors)).toBe(true);
                    expect(event.seq).toBe(i + 1);
                });
                const types = events.map(e => e.type);
                if (wanted.journal) expect(in_order(wanted.journal, types), `journal was: ${types.join(', ')}`).toEqual([]);
                for (const type of wanted.journal_excludes || []) expect(types).not.toContain(type);
                for (const [type, n] of Object.entries(wanted.journal_count || {})) expect(types.filter(t => t === type).length, `count of ${type}`).toBe(n);
                for (const part of wanted.journal_contains || []) expect(events.some(e => is_subset(part, e)), `no event matches ${JSON.stringify(part)}`).toBe(true);
            }
        });
    }
});
