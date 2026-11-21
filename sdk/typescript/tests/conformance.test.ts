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

const ROOT = path.resolve(__dirname, '../../..');
const CONFORMANCE = path.join(ROOT, 'spec/conformance');
const SCHEMAS = path.join(ROOT, 'spec/json-schema');

/** Conformance levels this implementation claims. */
const CLAIMED_LEVELS = new Set(['core', 'decision', 'verified', 'resilient', 'recorded', 'contract', 'flow']);

const read = (file: string) => JSON.parse(fs.readFileSync(file, 'utf-8'));
const list = (dir: string) => fs.readdirSync(dir).filter(f => f.endsWith('.json')).sort().map(f => path.join(dir, f));

const ajv = new Ajv2020({ allErrors: true, strict: false });
addFormats(ajv);
for (const file of list(SCHEMAS)) ajv.addSchema(read(file));
const validate_schema = ajv.getSchema('https://awa.io/schema/workflow.schema.json')!;
const validate_event = ajv.getSchema('https://awa.io/schema/journal-event.schema.json')!;

const unwrap = (doc: any) => (doc && doc.workflow && !doc.activities ? doc.workflow : doc);

type ActorScript = { output?: Record<string, unknown>; error?: string; code?: string; delay_ms?: number; attempts?: ActorScript[] };

class ConformanceActor implements Actor {
    public visited: string[] = [];
    private counts = new Map<string, number>();
    constructor(private scripts: Record<string, ActorScript> = {}) { }

    async execute(activity: Activity): Promise<Record<string, unknown>> {
        this.visited.push(activity.name);
        const n = (this.counts.get(activity.name) || 0) + 1;
        this.counts.set(activity.name, n);
        let script = this.scripts[activity.name] || {};
        if (script.attempts) script = script.attempts[Math.min(n, script.attempts.length) - 1];
        if (script.delay_ms) await new Promise(r => setTimeout(r, script.delay_ms));
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

describe('Conformance: execution', () => {
    for (const file of list(path.join(CONFORMANCE, 'execution'))) {
        const c = read(file);
        const run = CLAIMED_LEVELS.has(c.level) ? it : it.skip;
        run(`[${c.level}] ${c.id}: ${c.description}`, async () => {
            expect(validate_schema(c.workflow), JSON.stringify(validate_schema.errors)).toBe(true);
            const actor = new ConformanceActor(c.actors);
            const options: WorkflowEngineOptions = {
                actors: { application: actor, ai_agent: actor, human: actor, robot: actor },
                execution_logger: silent_logger,
                ...(c.options || {}),
            };
            const engine = new WorkflowEngine(parse_document(c.workflow), options);
            await engine.start(c.input || {});
            const status = await engine.run();

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
            if (c.expect.error_matches) {
                const errors = engine.getTokens().map(t => String(t.getData('_error') || ''));
                expect(errors.some(e => new RegExp(c.expect.error_matches).test(e)), errors.join(' | ')).toBe(true);
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

    for (const dir of dirs) {
        const file = list(dir).find(f => f.endsWith('.awa.json'))!;
        it(`${path.relative(ROOT, file)} completes`, async () => {
            const fixture = path.join(dir, 'simulation.json');
            const engine = new WorkflowEngine(parse_document(read(file)), {
                simulate: true,
                simulated_outputs: fs.existsSync(fixture) ? read(fixture) : undefined,
                execution_logger: silent_logger,
                sleep: async () => { },
            });
            await engine.start();
            expect(await engine.run()).toBe('completed');
        }, 30000);
    }
});
