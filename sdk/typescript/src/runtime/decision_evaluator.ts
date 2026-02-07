/**
 * AWA Decision Node Evaluator
 * Evaluates DMN-inspired decision tables with FEEL-like expression support
 */

import { DecisionNode, DecisionRule, DecisionTable, HitPolicy, UUID } from '../types';

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

/**
 * Expression evaluation operators
 */
type ComparisonOperator = '==' | '!=' | '<' | '<=' | '>' | '>=' | 'in' | 'not in' | 'between' | 'matches';

/**
 * Parse a FEEL-like expression and evaluate it against a value
 * Supports: ==, !=, <, <=, >, >=, [a..b] (range), -, "value" (literal)
 */
function evaluate_feel_expression(expression: string, value: unknown): boolean {
    const expr = expression.trim();

    // Empty expression or wildcard matches anything
    if (expr === '' || expr === '-' || expr === '*') {
        return true;
    }

    // Boolean literal
    if (expr === 'true') return value === true;
    if (expr === 'false') return value === false;

    // Null check
    if (expr === 'null') return value === null || value === undefined;
    if (expr === 'not null') return value !== null && value !== undefined;

    // String literal (quoted)
    if ((expr.startsWith('"') && expr.endsWith('"')) ||
        (expr.startsWith("'") && expr.endsWith("'"))) {
        const literal = expr.slice(1, -1);
        return String(value) === literal;
    }

    // Range expression: [a..b] or (a..b) or [a..b) etc.
    const range_match = expr.match(/^([\[\(])([^.]+)\.\.([^.\])]+)([\]\)])$/);
    if (range_match) {
        const [, start_bracket, start_val, end_val, end_bracket] = range_match;
        const num_value = Number(value);
        const start_num = Number(start_val);
        const end_num = Number(end_val);

        if (isNaN(num_value)) return false;

        const start_inclusive = start_bracket === '[';
        const end_inclusive = end_bracket === ']';

        const above_start = start_inclusive ? num_value >= start_num : num_value > start_num;
        const below_end = end_inclusive ? num_value <= end_num : num_value < end_num;

        return above_start && below_end;
    }

    // Comparison operators
    if (expr.startsWith('>=')) {
        return Number(value) >= Number(expr.slice(2).trim());
    }
    if (expr.startsWith('<=')) {
        return Number(value) <= Number(expr.slice(2).trim());
    }
    if (expr.startsWith('!=') || expr.startsWith('<>')) {
        const compare_val = expr.slice(2).trim();
        return String(value) !== compare_val && Number(value) !== Number(compare_val);
    }
    if (expr.startsWith('==')) {
        const compare_val = expr.slice(2).trim();
        return String(value) === compare_val || Number(value) === Number(compare_val);
    }
    if (expr.startsWith('>')) {
        return Number(value) > Number(expr.slice(1).trim());
    }
    if (expr.startsWith('<')) {
        return Number(value) < Number(expr.slice(1).trim());
    }
    if (expr.startsWith('=')) {
        const compare_val = expr.slice(1).trim();
        return String(value) === compare_val || Number(value) === Number(compare_val);
    }

    // List membership: value in (a, b, c)
    if (expr.toLowerCase().startsWith('in ') || expr.startsWith('in(')) {
        const list_match = expr.match(/in\s*\(([^)]+)\)/i);
        if (list_match) {
            const items = list_match[1].split(',').map(s => s.trim().replace(/^["']|["']$/g, ''));
            return items.includes(String(value));
        }
    }

    // Not in list
    if (expr.toLowerCase().startsWith('not in ') || expr.toLowerCase().startsWith('not in(')) {
        const list_match = expr.match(/not\s+in\s*\(([^)]+)\)/i);
        if (list_match) {
            const items = list_match[1].split(',').map(s => s.trim().replace(/^["']|["']$/g, ''));
            return !items.includes(String(value));
        }
    }

    // Contains (for strings)
    if (expr.toLowerCase().startsWith('contains(')) {
        const match = expr.match(/contains\s*\(\s*["']([^"']+)["']\s*\)/i);
        if (match) {
            return String(value).includes(match[1]);
        }
    }

    // Starts with
    if (expr.toLowerCase().startsWith('starts with ')) {
        const pattern = expr.slice(12).trim().replace(/^["']|["']$/g, '');
        return String(value).startsWith(pattern);
    }

    // Ends with
    if (expr.toLowerCase().startsWith('ends with ')) {
        const pattern = expr.slice(10).trim().replace(/^["']|["']$/g, '');
        return String(value).endsWith(pattern);
    }

    // Regex matches
    if (expr.toLowerCase().startsWith('matches(')) {
        const match = expr.match(/matches\s*\(\s*["']([^"']+)["']\s*\)/i);
        if (match) {
            try {
                const regex = new RegExp(match[1]);
                return regex.test(String(value));
            } catch {
                return false;
            }
        }
    }

    // Direct value comparison (number or string)
    const num_expr = Number(expr);
    if (!isNaN(num_expr)) {
        return Number(value) === num_expr;
    }

    // String equality
    return String(value) === expr;
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

    // Collect all matching rules
    for (const rule of table.rules) {
        if (evaluate_rule(rule, table, context)) {
            matched_rules.push(rule);

            // For 'first' hit policy, stop at first match
            if (table.hit_policy === 'first' || table.hit_policy === 'unique') {
                break;
            }
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

    switch (table.hit_policy) {
        case 'unique':
        case 'first':
            // Return first match
            result_outputs = extract_outputs(matched_rules[0], table);
            result_edge_id = matched_rules[0].output_edge_id;
            break;

        case 'any':
            // All matches must have same outputs - return any
            result_outputs = extract_outputs(matched_rules[0], table);
            result_edge_id = matched_rules[0].output_edge_id;
            break;

        case 'priority':
            // Rules are already in priority order, return first match
            result_outputs = extract_outputs(matched_rules[0], table);
            result_edge_id = matched_rules[0].output_edge_id;
            break;

        case 'collect':
            // Collect all output values into arrays
            for (const output_col of table.outputs) {
                result_outputs[output_col.name] = matched_rules.map(
                    r => r.output_entries[table.outputs.indexOf(output_col)]
                );
            }
            // Use edge from first matched rule
            result_edge_id = matched_rules[0].output_edge_id;
            break;

        case 'rule_order':
            // Return outputs in rule order (similar to collect but ordered)
            for (const output_col of table.outputs) {
                result_outputs[output_col.name] = matched_rules.map(
                    r => r.output_entries[table.outputs.indexOf(output_col)]
                );
            }
            result_edge_id = matched_rules[0].output_edge_id;
            break;

        default:
            // Default behavior
            result_outputs = extract_outputs(matched_rules[0], table);
            result_edge_id = matched_rules[0].output_edge_id;
    }

    return {
        matched: true,
        output_edge_id: result_edge_id || node.default_output_edge_id,
        outputs: result_outputs,
        matched_rules
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
