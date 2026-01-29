/**
 * AWA Validator - Schema validation for AWA entities
 */

import { WorkflowSchema, ActivitySchema, ContextSchema, type Workflow, type Activity, type Context } from '../types';
import type { ZodError } from 'zod';

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

    return { valid: errors.length === 0, errors };
}
