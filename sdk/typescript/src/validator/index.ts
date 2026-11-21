/**
 * AWA Validator - Schema validation for AWA entities
 */

import { WorkflowSchema, ActivitySchema, ContextSchema, type Workflow, type Activity, type Context } from '../types';
import type { ZodError } from 'zod';
import { validate_expression } from '../runtime/expression';

export interface ValidationResult {
    valid: boolean;
    errors: ValidationError[];
}

export interface ValidationError {
    path: string;
    message: string;
    code: string;
}

function formatZodError(error: ZodError): ValidationError[] {
    return error.errors.map(e => ({
        path: e.path.join('.'),
        message: e.message,
        code: e.code,
    }));
}

/**
 * Validate a workflow against the AWA schema
 */
export function validate_workflow(data: unknown): ValidationResult {
    const result = WorkflowSchema.safeParse(data);
    if (result.success) {
        return { valid: true, errors: [] };
    }
    return { valid: false, errors: formatZodError(result.error) };
}

/**
 * Validate an activity against the AWA schema
 */
export function validate_activity(data: unknown): ValidationResult {
    const result = ActivitySchema.safeParse(data);
    if (result.success) {
        return { valid: true, errors: [] };
    }
    return { valid: false, errors: formatZodError(result.error) };
}

/**
 * Validate a context against the AWA schema
 */
export function validate_context(data: unknown): ValidationResult {
    const result = ContextSchema.safeParse(data);
    if (result.success) {
        return { valid: true, errors: [] };
    }
    return { valid: false, errors: formatZodError(result.error) };
}

/**
 * Parse and validate a workflow, throwing on error
 */
export function parse_workflow(data: unknown): Workflow {
    return WorkflowSchema.parse(data);
}

/**
 * Parse an AWA document. Accepts both forms defined by the specification:
 * a bare workflow object, or an envelope `{ "workflow": { ... } }`.
 */
export function parse_document(data: unknown): Workflow {
    if (data && typeof data === 'object' && 'workflow' in data && !('activities' in data)) {
        return WorkflowSchema.parse((data as { workflow: unknown }).workflow);
    }
    return WorkflowSchema.parse(data);
}

/**
 * Parse and validate an activity, throwing on error
 */
export function parse_activity(data: unknown): Activity {
    return ActivitySchema.parse(data);
}

/**
 * Parse and validate a context, throwing on error
 */
export function parse_context(data: unknown): Context {
    return ContextSchema.parse(data);
}

/**
 * Semantic validation for workflow integrity
 */
export function validate_workflow_integrity(workflow: Workflow): ValidationResult {
    const errors: ValidationError[] = [];

    // Check all edge references exist
    const nodeIds = new Set([
        ...workflow.activities.map(a => a.id),
        ...workflow.events.map(e => e.id),
        ...workflow.decision_nodes.map(d => d.id),
    ]);

    for (const edge of workflow.edges) {
        if (!nodeIds.has(edge.source_id)) {
            errors.push({
                path: `edges[${edge.id}].source_id`,
                message: `Source node '${edge.source_id}' not found`,
                code: 'invalid_reference',
            });
        }
        if (!nodeIds.has(edge.target_id)) {
            errors.push({
                path: `edges[${edge.id}].target_id`,
                message: `Target node '${edge.target_id}' not found`,
                code: 'invalid_reference',
            });
        }
    }

    // Check all context bindings reference valid contexts
    const contextIds = new Set(workflow.contexts.map(c => c.id));
    for (const activity of workflow.activities) {
        for (const binding of activity.context_bindings) {
            if (!contextIds.has(binding.context_id)) {
                errors.push({
                    path: `activities[${activity.id}].context_bindings`,
                    message: `Context '${binding.context_id}' not found`,
                    code: 'invalid_reference',
                });
            }
        }
    }

    // Node and edge identifiers must be unique within the workflow
    const seen = new Set<string>();
    const all_ids = [
        ...workflow.activities.map(a => a.id),
        ...workflow.events.map(e => e.id),
        ...workflow.decision_nodes.map(d => d.id),
        ...workflow.edges.map(e => e.id),
    ];
    for (const id of all_ids) {
        if (seen.has(id)) {
            errors.push({ path: `[${id}]`, message: `Duplicate identifier '${id}'`, code: 'duplicate_id' });
        }
        seen.add(id);
    }

    // Edge conditions must be valid expressions; at most one default edge per source
    const default_count = new Map<string, number>();
    for (const edge of workflow.edges) {
        if (edge.condition) {
            const check = validate_expression(edge.condition);
            if (!check.valid) {
                errors.push({ path: `edges[${edge.id}].condition`, message: check.error || 'Invalid condition', code: 'invalid_expression' });
            }
        }
        if (edge.is_default) {
            default_count.set(edge.source_id, (default_count.get(edge.source_id) || 0) + 1);
        }
    }
    for (const [source_id, count] of default_count) {
        if (count > 1) {
            errors.push({ path: `edges[source=${source_id}]`, message: `Node '${source_id}' has ${count} default edges; at most one is allowed`, code: 'multiple_default_edges' });
        }
    }

    // Decision rules must route to edges that leave the decision node
    const edge_by_id = new Map(workflow.edges.map(e => [e.id, e]));
    for (const decision of workflow.decision_nodes) {
        const refs = [
            decision.default_output_edge_id,
            ...decision.decision_table.rules.map(r => r.output_edge_id),
        ].filter((id): id is string => !!id);
        for (const ref of refs) {
            const target = edge_by_id.get(ref);
            if (!target) {
                errors.push({ path: `decision_nodes[${decision.id}]`, message: `Output edge '${ref}' not found`, code: 'invalid_reference' });
            } else if (target.source_id !== decision.id) {
                errors.push({ path: `decision_nodes[${decision.id}]`, message: `Output edge '${ref}' does not leave this decision node`, code: 'invalid_reference' });
            }
        }
    }

    return { valid: errors.length === 0, errors };
}
