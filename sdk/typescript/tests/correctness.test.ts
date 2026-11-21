import { describe, it, expect } from 'vitest';
import { v4 as uuidv4 } from 'uuid';
import { WorkflowEngine } from '../src/runtime/workflow_engine';
import { evaluate_expression, ExpressionError } from '../src/runtime/expression';
import { activity, edge, workflow, scripted, silent_logger } from './helpers';

const criterion = (expression?: string) => ({
    id: uuidv4(), name: 'c', description: 'd', type: 'format' as const, expression, weight: 1, required: true,
});
const policy = (mode: 'ai_judge' | 'schema_only' | 'custom', expression?: string) => ({
    enabled: true, mode, criteria: [criterion(expression)], max_retries: 0, retry_with_feedback: true,
    judge_model_id: 'gemini-3-flash-preview', judge_temperature: 0.1, pass_threshold: 0.9,
});

describe('Run outcome', () => {
    it('reports failed, not completed, when an activity throws', async () => {
        const a = activity('A');
        const { actors } = scripted({ A: new Error('boom') });
        const engine = new WorkflowEngine(workflow([a], []), { actors, execution_logger: silent_logger });
        await engine.start();
        expect(await engine.run()).toBe('failed');
        expect(engine.getTokens()[0].getData('_error')).toBe('boom');
    });

    it('reports completed when every token completes', async () => {
        const a = activity('A'); const b = activity('B');
        const { actors } = scripted();
        const engine = new WorkflowEngine(workflow([a, b], [edge(a, b)]), { actors, execution_logger: silent_logger });
        await engine.start();
        expect(await engine.run()).toBe('completed');
    });
});

describe('Routing', () => {
    const build = (output: Record<string, unknown>, withDefault: boolean) => {
        const a = activity('A'); const b = activity('B'); const c = activity('C');
        const { actor, actors } = scripted({ A: output });
        const edges = [
            edge(a, b, { condition: 'approved == true' }),
            edge(a, c, withDefault ? { is_default: true } : { condition: 'approved == false' }),
        ];
        const engine = new WorkflowEngine(workflow([a, b, c], edges), { actors, execution_logger: silent_logger });
        return { engine, actor };
    };

    it('takes the first edge whose condition is true', async () => {
        const { engine, actor } = build({ approved: true }, false);
        await engine.start();
        expect(await engine.run()).toBe('completed');
        expect(actor.calls.map(c => c.activity)).toEqual(['A', 'B']);
    });

    it('takes the default edge when no condition matches', async () => {
        const { engine, actor } = build({ approved: 'maybe' }, true);
        await engine.start();
        expect(await engine.run()).toBe('completed');
        expect(actor.calls.map(c => c.activity)).toEqual(['A', 'C']);
    });

    it('fails instead of guessing when nothing matches and there is no default', async () => {
        const { engine, actor } = build({ approved: 'maybe' }, false);
        await engine.start();
        expect(await engine.run()).toBe('failed');
        expect(actor.calls.map(c => c.activity)).toEqual(['A']);
        expect(String(engine.getTokens()[0].getData('_error'))).toMatch(/No route/);
    });

    it('rejects a workflow whose condition is not a valid expression', () => {
        const a = activity('A'); const b = activity('B');
        expect(() => new WorkflowEngine(workflow([a, b], [edge(a, b, { condition: 'approved === yes ???' })])))
            .toThrow(/Invalid expression/);
    });
});

describe('Verification fails closed', () => {
    const run = async (verification: ReturnType<typeof policy>, options = {}) => {
        const a = activity('A', { verification });
        const b = activity('B');
        const { actor, actors } = scripted({ A: { result: 1 } });
        const engine = new WorkflowEngine(workflow([a, b], [edge(a, b)]),
            { actors, execution_logger: silent_logger, ...options });
        await engine.start();
        return { status: await engine.run(), actor };
    };

    it('rejects the output when the judge cannot run', async () => {
        // ai_judge without an API key makes the verifier itself error
        const { status, actor } = await run(policy('ai_judge'));
        expect(status).toBe('failed');
        expect(actor.count('B')).toBe(0);
    });

    it('rejects the output for an unregistered custom verifier', async () => {
        expect((await run(policy('custom', 'result exists'))).status).toBe('failed');
    });

    it('rejects a schema_only criterion that has nothing to evaluate', async () => {
        expect((await run(policy('schema_only'))).status).toBe('failed');
    });

    it('accepts an output that passes a deterministic criterion', async () => {
        expect((await run(policy('schema_only', 'result == 1'))).status).toBe('completed');
    });
});

describe('Condition expressions', () => {
    const data = { amount: 120, status: 'approved', ok: true, nested: { score: 0.2 }, empty: null };
    const cases: [string, boolean][] = [
        ['amount > 100', true], ['amount <= 100', false], ['amount == 120', true],
        ['status == approved', true], ['status == "approved"', true], ["status != 'rejected'", true],
        ['status != approved', false], ['ok == true', true], ['ok', true], ['!ok', false],
        ['nested.score < 0.3', true], ['missing == 1', false], ['missing != 1', true],
        ['missing exists', false], ['empty exists', true], ['empty == null', true],
        ['typeof amount == number', true], ['typeof status == string', true],
        ['ok && amount > 100', true], ['ok && amount > 500', false],
        ['amount > 500 || status == approved', true], ['!(ok && amount > 500)', true],
        ['missing > 1', false],
    ];
    for (const [expr, expected] of cases) {
        it(`${expr} -> ${expected}`, () => expect(evaluate_expression(expr, data)).toBe(expected));
    }

    it('throws on invalid syntax instead of returning a value', () => {
        for (const bad of ['', 'amount >', '== 3', 'amount > 1 &&', 'a ? b', '(ok']) {
            expect(() => evaluate_expression(bad, data)).toThrow(ExpressionError);
        }
    });
});
