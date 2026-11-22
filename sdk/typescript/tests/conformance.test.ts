/**
 * AWA conformance runner (TypeScript reference implementation).
 * Runs the language-neutral cases in spec/conformance against this SDK.
 */
import { describe, it, expect } from 'vitest';
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
import { InMemoryJournalStore } from '../src/runtime/journal';
import { counterfactual_replay } from '../src/runtime/counterfactual';

const ROOT = path.resolve(__dirname, '../../..');
const CONFORMANCE = path.join(ROOT, 'spec/conformance');
const SCHEMAS = path.join(ROOT, 'spec/json-schema');

/** Conformance levels this implementation claims. */
const CLAIMED_LEVELS = new Set(['core', 'decision', 'verified', 'resilient', 'recorded', 'contract', 'flow', 'events', 'tools', 'model_decision', 'journeys', 'replay']);

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
};

class ConformanceActor implements Actor {
    public visited: string[] = [];
    private counts = new Map<string, number>();
    constructor(private scripts: Record<string, ActorScript> = {}, private spend: (ms: number) => void = () => { }) { }

    async execute(activity: Activity, _inputs?: Record<string, unknown>, context?: { tools?: { call: (name: string, args: Record<string, unknown>) => Promise<unknown> } }): Promise<Record<string, unknown>> {
        this.visited.push(activity.name);
        const n = (this.counts.get(activity.name) || 0) + 1;
        this.counts.set(activity.name, n);
        let script = this.scripts[activity.name] || {};
        if (script.attempts) script = script.attempts[Math.min(n, script.attempts.length) - 1];
        if (script.delay_ms) await new Promise(r => setTimeout(r, script.delay_ms));
        if (script.takes) this.spend(parse_iso_duration(script.takes));
        for (const call of script.calls || []) await context!.tools!.call(call.tool, call.arguments || {});
        if (script.error) throw Object.assign(new Error(script.error), script.code ? { code: script.code } : {});
        return script.output || {};
    }
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
            const actor = new ConformanceActor(c.actors);
            // A scripted model: each call takes the next reply; the last repeats
            let model_calls = 0;
            const replies: { option?: string; confidence?: number; rationale?: string; text?: string; error?: string }[] = c.model?.replies || [];
            const model = new FunctionModelProvider('conformance', () => {
                const reply = replies[Math.min(model_calls++, replies.length - 1)];
                if (reply.error) throw new Error(reply.error);
                return reply.text ?? JSON.stringify(reply);
            });
            const options: WorkflowEngineOptions = {
                actors: { application: actor, ai_agent: actor, human: actor, robot: actor },
                execution_logger: silent_logger,
                ...(c.tools ? { tools: { handlers: Object.fromEntries(Object.entries(c.tools as Record<string, { result?: unknown; error?: string }>).map(([name, script]) => [name, () => { if (script.error) throw new Error(script.error); return script.result; }])) } } : {}),
                ...(c.model ? { model_providers: [model], model_tiers: { fast: 'conformance:model', balanced: 'conformance:model', reasoning: 'conformance:model' } } : {}),
                ...(c.options || {}),
            };
            const engine = new WorkflowEngine(parse_document(c.workflow), options);
            await engine.start(c.input || {});
            let status = await engine.run();

            // Steps performed while the run waits: deliver a business event, or let its waits time out
            for (const step of c.deliver || []) {
                if (step.expire) {
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
            if (c.expect.model_calls !== undefined) expect(model_calls, 'calls to the model').toBe(c.expect.model_calls);
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

describe('Conformance: journeys', () => {
    const validate_journey_schema = ajv.getSchema('https://awa.io/schema/journey.schema.json')!;
    const validate_journey_event = ajv.getSchema('https://awa.io/schema/journey-event.schema.json')!;
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

            const names = new Map(runtime.list_journeys().map(j => [j.id, j.name]));
            const all = runtime.list_journey_instances();
            if (c.expect.instance_count !== undefined) expect(all.length).toBe(c.expect.instance_count);
            for (const wanted of c.expect.instances || []) {
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
                if (wanted.run_journal) {
                    const events = (await runtime.export_journey(i.id)).runs[0].events;
                    expect(events.map(e => e.seq)).toEqual(events.map((_, n) => n + 1));
                    expect(in_order(wanted.run_journal, events.map(e => e.type)), `journal was: ${events.map(e => e.type).join(', ')}`).toEqual([]);
                }
            }
            if (c.expect.transitions) {
                expect(runtime.transitions().map(t => ({ from: names.get(t.from), to: names.get(t.to), count: t.count }))).toEqual(c.expect.transitions);
            }
        });
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
