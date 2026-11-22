/**
 * AWA Decision Evaluator Tests
 * Tests for FEEL expression parsing and DMN hit policies
 */

import { describe, it, expect } from 'vitest';
import {
    evaluate_decision,
    DecisionEvaluator
} from '../src/runtime/decision_evaluator';
import { DecisionNode, DecisionTable, DecisionModelSchema, DecisionNodeSchema } from '../src/types';
import { randomUUID as uuidv4 } from 'crypto';

// Helper to create a decision node
function createDecisionNode(
    table: Partial<DecisionTable>,
    defaultEdgeId?: string
): DecisionNode {
    return {
        id: uuidv4(),
        name: 'Test Decision',
        decision_table: {
            hit_policy: 'first',
            inputs: [{ name: 'score', type: 'number' }],
            outputs: [{ name: 'result', type: 'string' }],
            rules: [],
            ...table
        },
        default_output_edge_id: defaultEdgeId
    };
}

describe('Decision Evaluator - FEEL Expressions', () => {

    it('should match empty/wildcard expressions', () => {
        const node = createDecisionNode({
            rules: [
                { input_entries: ['-'], output_entries: ['matched'], output_edge_id: uuidv4() }
            ]
        });

        const result = evaluate_decision(node, { score: 50 });
        expect(result.matched).toBe(true);
        expect(result.outputs.result).toBe('matched');
    });

    it('should match exact number', () => {
        const node = createDecisionNode({
            rules: [
                { input_entries: ['100'], output_entries: ['century'], output_edge_id: uuidv4() }
            ]
        });

        expect(evaluate_decision(node, { score: 100 }).matched).toBe(true);
        expect(evaluate_decision(node, { score: 99 }).matched).toBe(false);
    });

    it('should match comparison operators (>=, <=, >, <)', () => {
        const edgeId = uuidv4();
        const node = createDecisionNode({
            rules: [
                { input_entries: ['>=80'], output_entries: ['high'], output_edge_id: edgeId }
            ]
        });

        expect(evaluate_decision(node, { score: 80 }).outputs.result).toBe('high');
        expect(evaluate_decision(node, { score: 90 }).outputs.result).toBe('high');
        expect(evaluate_decision(node, { score: 79 }).matched).toBe(false);
    });

    it('should match range expressions [a..b]', () => {
        const node = createDecisionNode({
            rules: [
                { input_entries: ['[50..70]'], output_entries: ['medium'], output_edge_id: uuidv4() }
            ]
        });

        expect(evaluate_decision(node, { score: 50 }).matched).toBe(true);
        expect(evaluate_decision(node, { score: 60 }).matched).toBe(true);
        expect(evaluate_decision(node, { score: 70 }).matched).toBe(true);
        expect(evaluate_decision(node, { score: 49 }).matched).toBe(false);
        expect(evaluate_decision(node, { score: 71 }).matched).toBe(false);
    });

    it('should match exclusive range (a..b)', () => {
        const node = createDecisionNode({
            rules: [
                { input_entries: ['(50..70)'], output_entries: ['medium'], output_edge_id: uuidv4() }
            ]
        });

        expect(evaluate_decision(node, { score: 50 }).matched).toBe(false);
        expect(evaluate_decision(node, { score: 51 }).matched).toBe(true);
        expect(evaluate_decision(node, { score: 69 }).matched).toBe(true);
        expect(evaluate_decision(node, { score: 70 }).matched).toBe(false);
    });

    it('should match string literals', () => {
        const node = createDecisionNode({
            inputs: [{ name: 'status', type: 'string' }],
            rules: [
                { input_entries: ['"approved"'], output_entries: ['pass'], output_edge_id: uuidv4() }
            ]
        });

        expect(evaluate_decision(node, { status: 'approved' }).matched).toBe(true);
        expect(evaluate_decision(node, { status: 'rejected' }).matched).toBe(false);
    });

    it('should match boolean values', () => {
        const node = createDecisionNode({
            inputs: [{ name: 'is_valid', type: 'boolean' }],
            rules: [
                { input_entries: ['true'], output_entries: ['valid'], output_edge_id: uuidv4() }
            ]
        });

        expect(evaluate_decision(node, { is_valid: true }).matched).toBe(true);
        expect(evaluate_decision(node, { is_valid: false }).matched).toBe(false);
    });

    it('should match list membership with in()', () => {
        const node = createDecisionNode({
            inputs: [{ name: 'color', type: 'string' }],
            rules: [
                { input_entries: ['in("red", "green", "blue")'], output_entries: ['primary'], output_edge_id: uuidv4() }
            ]
        });

        expect(evaluate_decision(node, { color: 'red' }).matched).toBe(true);
        expect(evaluate_decision(node, { color: 'green' }).matched).toBe(true);
        expect(evaluate_decision(node, { color: 'yellow' }).matched).toBe(false);
    });

    it('should match not in list', () => {
        const node = createDecisionNode({
            inputs: [{ name: 'country', type: 'string' }],
            rules: [
                { input_entries: ['not in("US", "CA")'], output_entries: ['international'], output_edge_id: uuidv4() }
            ]
        });

        expect(evaluate_decision(node, { country: 'UK' }).matched).toBe(true);
        expect(evaluate_decision(node, { country: 'US' }).matched).toBe(false);
    });

    it('should match null check', () => {
        const node = createDecisionNode({
            inputs: [{ name: 'value', type: 'string' }],
            rules: [
                { input_entries: ['null'], output_entries: ['missing'], output_edge_id: uuidv4() }
            ]
        });

        expect(evaluate_decision(node, { value: null }).matched).toBe(true);
        expect(evaluate_decision(node, { value: undefined }).matched).toBe(true);
        expect(evaluate_decision(node, { other: 'x' }).matched).toBe(true);
        expect(evaluate_decision(node, { value: 'present' }).matched).toBe(false);
    });
});

describe('Decision Evaluator - Hit Policies', () => {

    it('should respect "first" hit policy (stop at first match)', () => {
        const node = createDecisionNode({
            hit_policy: 'first',
            rules: [
                { input_entries: ['>=80'], output_entries: ['A'], output_edge_id: uuidv4() },
                { input_entries: ['>=70'], output_entries: ['B'], output_edge_id: uuidv4() },
                { input_entries: ['>=60'], output_entries: ['C'], output_edge_id: uuidv4() }
            ]
        });

        const result = evaluate_decision(node, { score: 85 });
        expect(result.outputs.result).toBe('A');
        expect(result.matched_rules.length).toBe(1);
    });

    it('should respect "collect" hit policy (return all matches)', () => {
        const node = createDecisionNode({
            hit_policy: 'collect',
            inputs: [{ name: 'tags', type: 'string' }],
            rules: [
                { input_entries: ['-'], output_entries: ['tag1'], output_edge_id: uuidv4() },
                { input_entries: ['-'], output_entries: ['tag2'], output_edge_id: uuidv4() },
                { input_entries: ['-'], output_entries: ['tag3'], output_edge_id: uuidv4() }
            ]
        });

        const result = evaluate_decision(node, { tags: 'any' });
        expect(result.outputs.result).toEqual(['tag1', 'tag2', 'tag3']);
        expect(result.matched_rules.length).toBe(3);
    });

    it('should use default edge when no rules match', () => {
        const defaultEdgeId = uuidv4();
        const node = createDecisionNode({
            rules: [
                { input_entries: ['>=100'], output_entries: ['high'], output_edge_id: uuidv4() }
            ]
        }, defaultEdgeId);

        const result = evaluate_decision(node, { score: 50 });
        expect(result.matched).toBe(false);
        expect(result.output_edge_id).toBe(defaultEdgeId);
    });
});

describe('Decision Evaluator - Multiple Inputs', () => {

    it('should evaluate multiple input columns (AND logic)', () => {
        const edgeId = uuidv4();
        const node: DecisionNode = {
            id: uuidv4(),
            name: 'Multi-Input Decision',
            decision_table: {
                hit_policy: 'first',
                inputs: [
                    { name: 'credit_score', type: 'number' },
                    { name: 'income', type: 'number' }
                ],
                outputs: [{ name: 'approval', type: 'string' }],
                rules: [
                    {
                        input_entries: ['>=700', '>=50000'],
                        output_entries: ['approved'],
                        output_edge_id: edgeId
                    },
                    {
                        input_entries: ['>=600', '>=75000'],
                        output_entries: ['approved'],
                        output_edge_id: edgeId
                    },
                    {
                        input_entries: ['-', '-'],
                        output_entries: ['manual_review'],
                        output_edge_id: uuidv4()
                    }
                ]
            }
        };

        // Both conditions met
        expect(evaluate_decision(node, { credit_score: 750, income: 60000 }).outputs.approval).toBe('approved');

        // Alternative path
        expect(evaluate_decision(node, { credit_score: 620, income: 80000 }).outputs.approval).toBe('approved');

        // Neither met - falls to default
        expect(evaluate_decision(node, { credit_score: 550, income: 40000 }).outputs.approval).toBe('manual_review');
    });
});

describe('DecisionEvaluator Class', () => {

    it('should register and evaluate decisions by ID', () => {
        const evaluator = new DecisionEvaluator();
        const edgeId = uuidv4();

        const node = createDecisionNode({
            rules: [
                { input_entries: ['>=50'], output_entries: ['pass'], output_edge_id: edgeId }
            ]
        });

        evaluator.register(node);

        const result = evaluator.evaluate(node.id, { score: 75 });
        expect(result.matched).toBe(true);
        expect(result.output_edge_id).toBe(edgeId);
    });

    it('should throw for unknown decision ID', () => {
        const evaluator = new DecisionEvaluator();
        expect(() => evaluator.evaluate(uuidv4(), {})).toThrow(/not found/);
    });

    it('should get next edge ID', () => {
        const edgeId = uuidv4();
        const node = createDecisionNode({
            rules: [
                { input_entries: ['-'], output_entries: ['any'], output_edge_id: edgeId }
            ]
        });

        const evaluator = new DecisionEvaluator([node]);
        expect(evaluator.get_next_edge(node.id, { score: 50 })).toBe(edgeId);
    });
});

// ---------------------------------------------------------------------------
// Native engine extensions and the external engine plug-in
// ---------------------------------------------------------------------------
import { WorkflowEngine } from '../src/runtime/workflow_engine';
import { DecisionConflictError } from '../src/runtime/decision_evaluator';
import { DecisionEngine, DecisionEngineRequest } from '../src/runtime/decision_engine';
import { FunctionModelProvider } from '../src/runtime/models';
import { compile_recipe } from '../src/runtime/recipe';
import { validate_workflow_integrity } from '../src/validator';
import { activity, edge, workflow, scripted, silent_logger } from './helpers';

describe('Hit policy conflicts', () => {
    const node = (hit_policy: string, rules: unknown[]) => ({
        id: uuidv4(), name: 'D',
        decision_table: { hit_policy, inputs: [{ name: 'x', type: 'number' }], outputs: [{ name: 'r', type: 'string' }], rules },
    }) as DecisionNode;

    it('unique raises when two rules match, and names them', () => {
        const d = node('unique', [{ input_entries: ['> 0'], output_entries: ['a'] }, { input_entries: ['< 100'], output_entries: ['b'] }]);
        expect(() => evaluate_decision(d, { x: 5 })).toThrow(DecisionConflictError);
        expect(() => evaluate_decision(d, { x: 5 })).toThrow(/rules 1 and 2 both match/);
        expect(evaluate_decision(d, { x: 500 }).outputs).toEqual({ r: 'a' });
    });

    it('any accepts agreeing rules and raises on disagreeing ones', () => {
        const agree = node('any', [{ input_entries: ['> 0'], output_entries: ['a'] }, { input_entries: ['< 100'], output_entries: ['a'] }]);
        expect(evaluate_decision(agree, { x: 5 }).outputs).toEqual({ r: 'a' });
        const differ = node('any', [{ input_entries: ['> 0'], output_entries: ['a'] }, { input_entries: ['< 100'], output_entries: ['b'] }]);
        expect(() => evaluate_decision(differ, { x: 5 })).toThrow(/different results/);
    });

    it('priority takes the highest priority among the matches', () => {
        const d = node('priority', [
            { input_entries: ['-'], output_entries: ['low'], priority: 1 },
            { input_entries: ['> 10'], output_entries: ['high'], priority: 7 },
        ]);
        expect(evaluate_decision(d, { x: 50 }).outputs).toEqual({ r: 'high' });
        expect(evaluate_decision(d, { x: 5 }).outputs).toEqual({ r: 'low' });
    });

    it('rejects a table whose rule has the wrong number of entries, or an entry that does not parse', () => {
        const a = activity('A');
        const bad = node('first', [{ input_entries: ['> 1', '> 2'], output_entries: ['a'] }, { input_entries: ['[1..'], output_entries: ['b'] }]);
        const codes = validate_workflow_integrity(workflow([a], [edge(a, bad)], { decision_nodes: [bad] })).errors.map(e => e.code);
        expect(codes).toEqual(['invalid_rule', 'invalid_expression']);
    });
});

describe('External decision engine', () => {
    const quiet = { sleep: async () => { }, execution_logger: silent_logger };

    function build(extra: Record<string, unknown> = {}) {
        const intake = activity('Intake'); const pay = activity('Pay'); const review = activity('Review'); const manual = activity('Manual');
        const id = uuidv4();
        const toPay = edge({ id }, pay); const toReview = edge({ id }, review); const toManual = edge({ id }, manual);
        const node = {
            id, name: 'Triage',
            decision_engine: {
                name: 'rules', ruleset: 'claims-triage@3', inputs: ['amount'],
                options: [{ id: 'pay', output_edge_id: toPay.id }, { id: 'review', output_edge_id: toReview.id }],
            },
            default_output_edge_id: toManual.id,
            ...extra,
        } as unknown as DecisionNode;
        return { wf: workflow([intake, pay, review, manual], [edge(intake, { id }), toPay, toReview, toManual], { decision_nodes: [node] }), toPay, toReview };
    }

    async function run(wf: ReturnType<typeof build>['wf'], engine: DecisionEngine | undefined, options = {}) {
        const s = scripted({ Intake: { amount: 900, secret: 'x' } });
        const e = new WorkflowEngine(wf, { actors: s.actors, ...(engine ? { decision_engines: { rules: engine } } : {}), ...quiet, ...options });
        await e.start();
        const status = await e.run();
        const events = await e.getEvents();
        return { status, visited: s.actor.calls.map(c => c.activity), events, data: e.getTokens()[0].contextData, decision: events.find(x => x.type === 'decision.evaluated')?.data as Record<string, any> };
    }

    it('routes along the option the engine returns, gives it only the selected facts, and records what fired', async () => {
        const seen: DecisionEngineRequest[] = [];
        const engine: DecisionEngine = {
            decide: request => { seen.push(request); return { option: 'review', outputs: { risk_band: 'B' }, fired_rules: ['large-claim'], explanation: 'Amount over 500' }; },
        };
        const r = await run(build().wf, engine);
        expect(r.visited).toEqual(['Intake', 'Review']);
        expect(seen[0]).toMatchObject({ node_name: 'Triage', ruleset: 'claims-triage@3', inputs: { amount: 900 }, options: [{ id: 'pay' }, { id: 'review' }] });
        expect(seen[0].inputs).not.toHaveProperty('secret');
        expect(r.decision).toMatchObject({ method: 'engine', strategy: 'engine', engine: { name: 'rules', ruleset: 'claims-triage@3', option: 'review', fired_rules: ['large-claim'], explanation: 'Amount over 500' } });
        expect(r.data.risk_band).toBe('B'); // engine outputs become token data
    });

    it('treats an option that was not offered, no option, or an engine failure as no decision', async () => {
        for (const engine of [
            { decide: () => ({ option: 'approve-all' }) },
            { decide: () => ({}) },
            { decide: () => { throw new Error('rule base unavailable'); } },
        ] as DecisionEngine[]) {
            const r = await run(build().wf, engine);
            expect(r.visited).toEqual(['Intake', 'Manual']);
            expect(r.decision.method).toBe('default');
            expect(r.decision.engine.no_decision_reason).toBeTruthy();
        }
    });

    it('fails the token when the engine the node names is not registered', async () => {
        const r = await run(build().wf, undefined);
        expect(r.status).toBe('failed');
        expect(r.visited).toEqual(['Intake']);
        expect(String(r.data._error)).toMatch(/decision engine "rules", which is not registered/);
    });

    it('lets a model decide what the engine could not', async () => {
        const { wf, toPay, toReview } = build();
        (wf.decision_nodes[0] as any).decision_model = DecisionModelSchema.parse({
            instructions: 'Decide.', output: 'triage',
            options: [{ id: 'pay', description: 'p', output_edge_id: toPay.id }, { id: 'review', description: 'r', output_edge_id: toReview.id }],
        });
        const provider = new FunctionModelProvider('acme', () => '{"option":"pay","confidence":0.9,"rationale":"small"}');
        const r = await run(wf, { decide: () => ({}) }, { model_providers: [provider] });
        expect(r.visited).toEqual(['Intake', 'Pay']);
        expect(r.decision).toMatchObject({ method: 'model', strategy: 'table_first' });
        expect(r.data.triage).toBe('pay'); // the model's choice, under the property the node names
        expect(provider.requests).toHaveLength(1);
    });

    it('does not allow a table and an engine on the same node', () => {
        expect(() => DecisionNodeSchema.parse({
            id: uuidv4(), name: 'D',
            decision_table: { hit_policy: 'first', inputs: [{ name: 'x', type: 'number' }], outputs: [{ name: 'r', type: 'string' }], rules: [] },
            decision_engine: { name: 'rules', options: [{ id: 'a', output_edge_id: uuidv4() }] },
        })).toThrow(/not both/);
    });

    it('journals a hit-policy conflict and fails rather than taking the default edge', async () => {
        const a = activity('A'); const b = activity('B'); const c = activity('C');
        const id = uuidv4(); const toB = edge({ id }, b); const toC = edge({ id }, c);
        const node = {
            id, name: 'D', default_output_edge_id: toC.id,
            decision_table: {
                hit_policy: 'unique', inputs: [{ name: 'x', type: 'number' }], outputs: [{ name: 'r', type: 'string' }],
                rules: [{ input_entries: ['> 0'], output_entries: ['a'], output_edge_id: toB.id }, { input_entries: ['< 9'], output_entries: ['b'], output_edge_id: toB.id }],
            },
        } as DecisionNode;
        const wf = workflow([a, b, c], [edge(a, { id }), toB, toC], { decision_nodes: [node] });
        const s = scripted({ A: { x: 5 } });
        const e = new WorkflowEngine(wf, { actors: s.actors, ...quiet });
        await e.start();
        expect(await e.run()).toBe('failed');
        expect(e.getTokens()[0].getData('_error_code')).toBe('DECISION_CONFLICT');
        const event = (await e.getEvents()).find(x => x.type === 'decision.evaluated')!;
        expect(String(event.data.conflict)).toMatch(/rules 1 and 2 both match/);
        expect(compile_recipe(wf, await e.getEvents())).toContain('The run failed at **D**');
    });
});
