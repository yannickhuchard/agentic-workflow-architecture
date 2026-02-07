/**
 * AWA Decision Evaluator Tests
 * Tests for FEEL expression parsing and DMN hit policies
 */

import { describe, it, expect } from 'vitest';
import {
    evaluate_decision,
    DecisionEvaluator
} from '../src/runtime/decision_evaluator';
import { DecisionNode, DecisionTable } from '../src/types';
import { v4 as uuidv4 } from 'uuid';

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
