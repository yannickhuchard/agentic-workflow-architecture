// The recommendation engine of the journey view (tools/visualization/awa-recommendations.js) on the
// electricity and life insurance examples: the rules of the design brief, their numbers, the ranking,
// the journeys' own domain recommendations, configurable thresholds and safe conditions.
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const root = path.resolve(__dirname, '../../..');
const engine = require(path.join(root, 'tools/visualization/awa-recommendations.js'));
const load = (example: string) => {
    const dir = path.join(root, 'examples', example);
    const record = JSON.parse(fs.readFileSync(path.join(dir, 'journeys.json'), 'utf8'));
    const options = JSON.parse(fs.readFileSync(path.join(dir, 'views/story-options.json'), 'utf8'));
    // the options name the replay reports by a path relative to the options file, as a page reads them
    const rec = options.recommendations || {};
    if (typeof rec.replays === 'string') rec.replays = JSON.parse(fs.readFileSync(path.join(dir, 'views', rec.replays), 'utf8'));
    return { record, options };
};

describe('recommendations: the electricity example', () => {
    const { record, options } = load('electricity-onboarding');
    const result = engine.compute(record, options);
    const recs = result.journeys[0].recommendations;
    const by = (id: string) => recs.find((r: { id: string }) => r.id === id);

    it('gives the eight recommendations of the design, in its order', () => {
        expect(recs.map((r: { id: string }) => r.id)).toEqual([
            'silence-switch', 'handover-first-failure', 'routing-allowed', 'wait-plan-confirmed',
            'remind-earlier', 'chase-switch-completed', 'payment-plan', 'cost-verify-documents',
        ]);
        expect(recs.map((r: { title: string }) => r.title)).toEqual([
            'Tell customers where their switch stands',
            'Hand an unreadable document to a person at the first failure',
            'Send each task to someone allowed to decide it',
            'Call before the plan offer lapses, on day 7',
            'Remind on day 3, not day 7',
            'Chase the registry before the switch times out',
            'Offer a payment plan before declining',
            'Try a lighter model for clear document checks',
        ]);
    });

    it('computes impact, effort and priority by the brief\'s formula', () => {
        const rows = recs.map((r: { kind: string; customers: unknown[]; impact: number; effort: number; priority: number }) => [r.kind, r.customers.length, r.impact, r.effort, r.priority]);
        expect(rows).toEqual([
            ['experience', 7, 1.75, 2, 0.88], ['quality', 2, 0.5, 1, 0.5], ['trust', 3, 0.38, 1, 0.38], ['speed', 1, 0.25, 1, 0.25],
            ['experience', 1, 0.25, 1, 0.25], ['speed', 1, 0.38, 2, 0.19], ['experience', 1, 0.38, 3, 0.13], ['cost', 8, 0.25, 2, 0.13],
        ]);
        expect(recs.map((r: { rules: string[] }) => r.rules.join(','))).toEqual(['R10,R6,R12', 'R2,R3,R9', 'R4', 'R1,R6,R11', 'R5,R6', 'R1,R11,R12', 'R8,domain', 'R7']);
    });

    it('fires R10 on 7 of 7 silent in Switch, median 14 days, longest 21', () => {
        const f = by('silence-switch').findings.find((x: { rule: string }) => x.rule === 'R10');
        expect([f.count, f.of, Math.round(f.median_days), Math.round(f.longest_days)]).toEqual([7, 7, 14, 21]);
        expect(f.text).toContain('longest 21, Sofia');
        expect(by('silence-switch').owner).toBe('Switching team');
    });

    it('fires R7 on Verify documents: 49,070 of 91,459 tokens, 53.7%', () => {
        const f = by('cost-verify-documents').findings[0];
        expect([f.rule, f.count, f.of]).toEqual(['R7', 49070, 91459]);
        expect(f.text).toBe('Verify documents: 49,070 of 91,459 tokens (53.7%)');
    });

    it('states the other rules\' numbers with their denominators', () => {
        const all = result.journeys[0].findings.map((f: { rule: string; text: string }) => `${f.rule} ${f.text}`);
        expect(all).toContain('R1 Energy choices: 1 of 7 outlasted the stage\'s time (14%)');
        expect(all).toContain('R1 Switch: 1 of 7 outlasted the stage\'s time (14%)');
        expect(all).toContain('R2 Verify documents: 1 of 8 runs handed to a person by the outcome contract (13%)');
        expect(all).toContain('R2 Verify installation documents: 1 of 3 runs handed to a person by the outcome contract (33%)');
        expect(all).toContain('R5 1 of 8 journeys needed a reminder (12.5%)');
        expect(all).toContain('R8 Application: 1 of 8 left here (12.5%)');
        expect(all).toContain('R9 Electricity Customer Onboarding: right first time 6 of 8 runs (75%)');
        expect(all).toContain('R9 Grid Export Registration: right first time 2 of 3 runs (67%)');
        expect(all.filter((t: string) => t.startsWith('R4')).length).toBe(3);
        expect(all.filter((t: string) => t.startsWith('R11')).length).toBe(3);
        expect(all.find((t: string) => t.startsWith('R12'))).toContain('3 of 8 runs slipped (38%)');
    });

    it('names the customers, with the run and the journal record behind each', () => {
        const c = by('handover-first-failure').customers;
        expect(c.map((x: { name: string }) => x.name)).toEqual(['Joaquim Ferreira', 'Tomás Reyes']);
        expect(c.map((x: { run_short: string; seq: number }) => `${x.run_short}#${x.seq}`)).toEqual(['0308#58', '00f7#33']);
        const silent = by('silence-switch').customers.find((x: { first: string }) => x.first === 'Sofia');
        expect(silent.silent_days).toBeGreaterThanOrEqual(21);
        expect(typeof silent.journey_seq).toBe('number');
    });

    it('says how each effect is known: the handover measured by replay, the rest estimate, pilot or replay not run', () => {
        expect(recs.map((r: { effect: { method: string } }) => r.effect.method)).toEqual(['estimate', 'replay', 'estimate', 'estimate', 'estimate', 'estimate', 'pilot', 'replay-live']);
        const e = by('handover-first-failure').effect;
        expect(e.before['Attempts at the step']).toBe('4');
        expect(e.after['Attempts at the step']).toBe('2');
        expect(e.before['Agent time on the failed attempts']).toBe('14 min');
        expect(e.after['Agent time on the failed attempts']).toBe('7 min');
        expect(e.before['Outcome contracts met']).toBe('33 of 37');
        expect(e.after['Outcome contracts met']).toBe('33 of 35');
        expect(e.replay.regressions).toEqual([]);
        expect(by('wait-plan-confirmed').effect.text).toContain('14.2 → about 7.2 days');
    });

    it('carries the domain recommendation of the options, which takes the place of R8', () => {
        const p = by('payment-plan');
        expect(p.origin).toBe('domain');
        expect(p.customers.map((x: { name: string }) => x.name)).toEqual(['Daniel Brooks']);
        expect(recs.some((r: { id: string }) => r.id === 'leave-application')).toBe(false);
    });

    it('is deterministic', () => {
        expect(JSON.stringify(engine.compute(record, options))).toBe(JSON.stringify(result));
    });

    it('takes thresholds from the options', () => {
        const strict = engine.compute(record, { ...options, recommendations: { ...options.recommendations, thresholds: { R10: 'P30D', R7: 0.6 } } });
        const ids = strict.journeys[0].recommendations.map((r: { id: string }) => r.id);
        expect(ids).not.toContain('silence-switch');
        expect(ids).not.toContain('cost-verify-documents');
        expect(strict.thresholds.R10.days).toBe(30);
    });

    it('records for each stage what every stage rule checked, for an empty state', () => {
        const contract = result.journeys[0].checks.contract;
        expect(contract.checks.map((c: { rule: string }) => c.rule)).toEqual(['R1', 'R2', 'R5', 'R6', 'R8', 'R10', 'R11']);
        expect(contract.checks.every((c: { fired: boolean }) => !c.fired)).toBe(true);
        expect(contract.checks.find((c: { rule: string }) => c.rule === 'R11').value).toContain('contract.signed always came');
    });
});

describe('recommendations: the life insurance example', () => {
    const { record, options } = load('life-insurance-savings');
    const recs = engine.compute(record, options).journeys[0].recommendations;
    it('proposes a top-up to the member below the Art. 111bis ceiling', () => {
        const t = recs.find((r: { id: string }) => r.id === 'top-up-before-year-end');
        expect(t.customers.map((x: { first: string }) => x.first)).toEqual(['Tom']);
        expect(t.owner).toBe('Valoria tax desk');
    });
    it('a rule on the journey\'s measures concerns the customers its named rule found', () => {
        const f = recs.find((r: { id: string }) => r.id === 'invitation-follow-up');
        expect(f.customers.map((x: { first: string }) => x.first)).toEqual(['Nina']);
        expect(recs.some((r: { id: string }) => r.id === 'leave-invitation')).toBe(false);
    });
    it('measures the handover by replay there too', () => {
        expect(recs.find((r: { id: string }) => r.id === 'handover-first-failure').effect.method).toBe('replay');
    });
});

describe('recommendations: conditions are data', () => {
    it('evaluates all, any, not and the six comparisons without running code', () => {
        const get = (t: { field?: string }) => ({ a: 3, b: 'x', c: null } as Record<string, unknown>)[t.field || ''];
        expect(engine.holds({ all: [{ field: 'a', gt: 2 }, { field: 'b', eq: 'x' }] }, get)).toBe(true);
        expect(engine.holds({ any: [{ field: 'a', lt: 2 }, { field: 'b', in: ['y', 'x'] }] }, get)).toBe(true);
        expect(engine.holds({ not: { field: 'c', exists: true } }, get)).toBe(true);
        expect(engine.holds({ field: 'a', gte: '2' }, get)).toBe(false);
        expect(engine.holds('a > 2', get)).toBe(false);
        expect(engine.holds({ field: 'constructor.constructor', eq: 'x' }, get)).toBe(false);
    });
    it('says why a malformed condition is left out', () => {
        expect(engine.conditionProblems({ field: 'a' })[0]).toMatch(/one of eq/);
        expect(engine.conditionProblems('x > 1')[0]).toMatch(/object/);
        const { record } = load('electricity-onboarding');
        const out = engine.compute(record, { recommendations: { rules: [{ id: 'bad', title: 'Bad', when: { field: 'x' } }] } });
        expect(out.journeys[0].problems[0]).toMatch(/^bad:/);
    });
});
