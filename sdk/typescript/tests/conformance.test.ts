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
import { compute_measures } from '../src/runtime/kpi';
import { InMemoryJournalStore } from '../src/runtime/journal';
import { counterfactual_replay } from '../src/runtime/counterfactual';
import { KnowledgeBase, KnowledgeEntry } from '../src/runtime/knowledge';
import { PostgresRuntimeStore } from '../src/runtime/postgres_store';
import { postgres_unavailable, start_postgres, TestPostgres } from './postgres';

const ROOT = path.resolve(__dirname, '../../..');
const CONFORMANCE = path.join(ROOT, 'spec/conformance');
const SCHEMAS = path.join(ROOT, 'spec/json-schema');

/** Conformance levels this implementation claims. */
const CLAIMED_LEVELS = new Set(['core', 'decision', 'verified', 'resilient', 'recorded', 'contract', 'flow', 'events', 'tools', 'model_decision', 'journeys', 'replay', 'routing', 'knowledge', 'measures', 'contexts', 'service_levels', 'shared_store']);

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
};

class ConformanceActor implements Actor {
    public visited: string[] = [];
    /** The ids of the knowledge entries the actor was handed, one list per execution */
    public given: { activity: string; ids: string[] }[] = [];
    /** The contexts the actor was handed at its last execution of each activity; null when it was handed none */
    public contexts: Record<string, unknown> = {};
    private counts = new Map<string, number>();
    constructor(private scripts: Record<string, ActorScript> = {}, private spend: (ms: number) => void = () => { }) { }

    async execute(activity: Activity, inputs?: Record<string, unknown>, context?: { tools?: { call: (name: string, args: Record<string, unknown>) => Promise<unknown> } }): Promise<Record<string, unknown>> {
        this.visited.push(activity.name);
        this.given.push({ activity: activity.name, ids: ((inputs?._knowledge as { id: string }[] | undefined) || []).map(k => k.id) });
        this.contexts[activity.name] = inputs?._contexts === undefined ? null : JSON.parse(JSON.stringify(inputs._contexts));
        const n = (this.counts.get(activity.name) || 0) + 1;
        this.counts.set(activity.name, n);
        let script = this.scripts[activity.name] || {};
        if (script.attempts) script = script.attempts[Math.min(n, script.attempts.length) - 1];
        if (script.delay_ms) await new Promise(r => setTimeout(r, script.delay_ms));
        if (script.takes) this.spend(parse_iso_duration(script.takes));
        for (const call of script.calls || []) await context!.tools!.call(call.tool, call.arguments || {});
        if (script.error) throw Object.assign(new Error(script.error), script.code ? { code: script.code } : {});
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

function is_subset(expected: unknown, actual: unknown): boolean {
    if (expected === null || typeof expected !== 'object') return expected === actual;
    if (actual === null || typeof actual !== 'object') return false;
    return Object.entries(expected as object).every(([k, v]) => is_subset(v, (actual as any)[k]));
}

describe('Conformance: documents', () => {
    for (const file of list(path.join(CONFORMANCE, 'documents'))) {
        const c = read(file);
        it(`${c.id}: ${c.description}`, () => {
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
            const options: WorkflowEngineOptions = {
                actors: { application: actor, ai_agent: actor, human: actor, robot: actor },
                execution_logger: silent_logger,
                ...(c.tools ? { tools: { handlers: Object.fromEntries(Object.entries(c.tools as Record<string, { result?: unknown; error?: string }>).map(([name, script]) => [name, () => { if (script.error) throw new Error(script.error); return script.result; }])) } } : {}),
                ...(c.model ? models.options : {}),
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
            for (const [type, n] of Object.entries(c.expect.journal_count || {})) expect(events.filter(e => e.type === type).length, `count of ${type}`).toBe(n);
            for (const wanted of c.expect.journal_mentions || []) {
                expect(events.some(e => is_subset(wanted.event, e) && wanted.mentions.every((text: string) => JSON.stringify(e.data).includes(text))),
                    `no event matching ${JSON.stringify(wanted.event)} mentions ${wanted.mentions.join(', ')}`).toBe(true);
            }
            if (c.expect.model_calls !== undefined) expect(models.total(), 'calls to the model').toBe(c.expect.model_calls);
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
