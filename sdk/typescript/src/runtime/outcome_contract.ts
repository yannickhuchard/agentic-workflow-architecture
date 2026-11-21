/**
 * AWA Outcome Contracts (specification section 11)
 *
 * A contract states what must be true of an activity's outcome, whatever
 * strategy the actor used to reach it. Checks are deterministic: the same
 * outcome always gets the same result.
 */

import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { OutcomeContract } from '../types';
import { evaluate_expression } from './expression';

export interface ContractViolation {
    /** Which part of the contract was violated */
    kind: 'output_schema' | 'postcondition' | 'budget';
    /** The postcondition name, the schema location, or the budget name */
    name: string;
    message: string;
}

const ajv = new Ajv2020({ allErrors: true, strict: false });
addFormats(ajv);

/**
 * The outcome of an activity: the value of the result's `output` property
 * when that is a JSON object, otherwise the result itself without
 * engine-reserved properties.
 */
export function outcome_of(result: Record<string, unknown>): Record<string, unknown> {
    const output = result.output;
    if (output !== null && typeof output === 'object' && !Array.isArray(output)) {
        return output as Record<string, unknown>;
    }
    const outcome: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(result)) {
        if (!key.startsWith('_')) outcome[key] = value;
    }
    return outcome;
}

/** Check an outcome against the deterministic parts of a contract */
export function check_contract(contract: OutcomeContract, outcome: Record<string, unknown>): ContractViolation[] {
    const violations: ContractViolation[] = [];

    if (contract.output_schema) {
        const validate = ajv.compile(contract.output_schema);
        if (!validate(outcome)) {
            for (const error of validate.errors || []) {
                violations.push({
                    kind: 'output_schema',
                    name: error.instancePath || '/',
                    message: `${error.instancePath || 'outcome'} ${error.message}`,
                });
            }
        }
    }

    for (const condition of contract.postconditions || []) {
        let holds = false;
        let detail = '';
        try {
            holds = evaluate_expression(condition.expression, outcome);
        } catch (error) {
            detail = ` (${error instanceof Error ? error.message : String(error)})`;
        }
        if (!holds) {
            violations.push({
                kind: 'postcondition',
                name: condition.name,
                message: `${condition.name}: "${condition.expression}" does not hold${detail}`,
            });
        }
    }

    return violations;
}

/** Corrective feedback for an actor whose outcome violated the contract */
export function contract_feedback(violations: ContractViolation[]): string {
    return [
        'CONTRACT VIOLATED. The outcome must satisfy every item below:',
        ...violations.map(v => `- ${v.message}`),
    ].join('\n');
}
