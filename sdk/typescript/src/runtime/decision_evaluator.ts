/**
 * AWA Decision Node Evaluator
 * Evaluates DMN-inspired decision tables with FEEL-like expression support
 */

import { DecisionNode, DecisionRule, DecisionTable, HitPolicy, UUID } from '../types';
import { evaluate_unary_tests } from './unary_test';
import { canonical_json } from './journal';

/**
 * Result of decision evaluation
 */
export interface DecisionResult {
    matched: boolean;
    output_edge_id?: UUID;
    outputs: Record<string, unknown>;
    matched_rules: DecisionRule[];
}

/**
 * Context for decision evaluation
 */
export type DecisionContext = Record<string, unknown>;

/** Raised when the rules that match contradict the table's hit policy. A defect in the table, not a routing outcome. */
export class DecisionConflictError extends Error {
    public readonly code = 'DECISION_CONFLICT';
    constructor(message: string) {
        super(message);
        this.name = 'DecisionConflictError';
    }
}

function evaluate_feel_expression(expression: string, value: unknown): boolean {
    return evaluate_unary_tests(expression, value);
}

/**
 * Evaluate a single rule against the decision context
 */
function evaluate_rule(
    rule: DecisionRule,
    table: DecisionTable,
    context: DecisionContext
): boolean {
    for (let i = 0; i < table.inputs.length; i++) {
        const input_col = table.inputs[i];
        const expression = rule.input_entries[i] || '-';
        const value = context[input_col.name];

        if (!evaluate_feel_expression(expression, value)) {
            return false;
        }
    }
    return true;
}

/**
 * Extract output values from a matched rule
 */
function extract_outputs(
    rule: DecisionRule,
    table: DecisionTable
): Record<string, unknown> {
    const outputs: Record<string, unknown> = {};
    for (let i = 0; i < table.outputs.length; i++) {
        const output_col = table.outputs[i];
        outputs[output_col.name] = rule.output_entries[i];
    }
    return outputs;
}

/**
 * Evaluate a decision node and return the result
 */
export function evaluate_decision(
    node: DecisionNode,
    context: DecisionContext
): DecisionResult {
    const table = node.decision_table;
    const matched_rules: DecisionRule[] = [];

    // A node decided by a model alone has no table: nothing matches
    if (!table) {
        return { matched: false, output_edge_id: node.default_output_edge_id, outputs: {}, matched_rules: [] };
    }

    // Every rule is evaluated: which one decides depends on the hit policy,
    // and "unique" and "any" must see all the matches to detect a conflict.
    for (const rule of table.rules) {
        if (evaluate_rule(rule, table, context)) {
            matched_rules.push(rule);
            if (table.hit_policy === 'first') break;
        }
    }

    if (matched_rules.length === 0) {
        // No rules matched - use default edge if available
        return {
            matched: false,
            output_edge_id: node.default_output_edge_id,
            outputs: {},
            matched_rules: []
        };
    }

    let result_outputs: Record<string, unknown> = {};
    let result_edge_id: UUID | undefined;

    const rule_number = (rule: DecisionRule) => table.rules.indexOf(rule) + 1;
    let deciding = matched_rules[0];

    switch (table.hit_policy) {
        case 'unique':
            if (matched_rules.length > 1) {
                throw new DecisionConflictError(
                    `Decision "${node.name}" has hit policy "unique" but rules ${matched_rules.map(rule_number).join(' and ')} both match`);
            }
            break;

        case 'any': {
            const signature = (rule: DecisionRule) => canonical_json([rule.output_entries, rule.output_edge_id ?? null]);
            const differing = matched_rules.find(rule => signature(rule) !== signature(matched_rules[0]));
            if (differing) {
                throw new DecisionConflictError(
                    `Decision "${node.name}" has hit policy "any" but rules ${rule_number(matched_rules[0])} and ${rule_number(differing)} match with different results`);
            }
            break;
        }

        case 'priority':
            // Highest priority wins; among equals, the earlier rule
            deciding = matched_rules.reduce((best, rule) => ((rule.priority ?? 0) > (best.priority ?? 0) ? rule : best), matched_rules[0]);
            break;

        default:
            break;
    }

    if (table.hit_policy === 'collect' || table.hit_policy === 'rule_order') {
        // Multiple-hit policies: each output is the list of the matching rules' values, in rule order
        table.outputs.forEach((column, index) => {
            result_outputs[column.name] = matched_rules.map(rule => rule.output_entries[index]);
        });
        result_edge_id = matched_rules.find(rule => rule.output_edge_id)?.output_edge_id;
    } else {
        result_outputs = extract_outputs(deciding, table);
        result_edge_id = deciding.output_edge_id;
    }

    return {
        matched: true,
        output_edge_id: result_edge_id || node.default_output_edge_id,
        outputs: result_outputs,
        matched_rules: table.hit_policy === 'collect' || table.hit_policy === 'rule_order' ? matched_rules : [deciding]
    };
}

/**
 * DecisionEvaluator class for stateful decision evaluation
 */
export class DecisionEvaluator {
    private decision_nodes: Map<UUID, DecisionNode> = new Map();

    constructor(nodes?: DecisionNode[]) {
        if (nodes) {
            for (const node of nodes) {
                this.register(node);
            }
        }
    }

    /**
     * Register a decision node
     */
    register(node: DecisionNode): void {
        this.decision_nodes.set(node.id, node);
    }

    /**
     * Get a decision node by ID
     */
    get(node_id: UUID): DecisionNode | undefined {
        return this.decision_nodes.get(node_id);
    }

    /**
     * Evaluate a decision node by ID
     */
    evaluate(node_id: UUID, context: DecisionContext): DecisionResult {
        const node = this.decision_nodes.get(node_id);
        if (!node) {
            throw new Error(`Decision node not found: ${node_id}`);
        }
        return evaluate_decision(node, context);
    }

    /**
     * Get the next edge ID for a decision node given a context
     */
    get_next_edge(node_id: UUID, context: DecisionContext): UUID | undefined {
        return this.evaluate(node_id, context).output_edge_id;
    }
}
