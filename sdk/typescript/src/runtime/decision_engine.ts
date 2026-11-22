/**
 * AWA external decision engines (specification 5.5.4)
 *
 * AWA's own decision tables are evaluated natively. A deployment that already
 * has a rule base in another engine (a production rule system such as Drools,
 * a DMN service, an in-house scorer) can have a decision node consult it
 * instead, by registering an adapter under a name.
 *
 * The engine is bounded the same way a decision model is: it must return one
 * of the options the workflow enumerates. Anything else is no decision.
 */

export interface DecisionEngineRequest {
    node_id: string;
    node_name: string;
    /** The rule set, knowledge base or decision service to evaluate. Meaning is the engine's. */
    ruleset?: string;
    options: { id: string; description?: string }[];
    /** The facts: the token data properties the node selected */
    inputs: Record<string, unknown>;
    config?: Record<string, unknown>;
}

export interface DecisionEngineResult {
    /** The id of the option decided. Absent means the engine reached no decision. */
    option?: string;
    /** Values the engine derived, merged into the token's data */
    outputs?: Record<string, unknown>;
    /** Why, in the engine's terms */
    explanation?: string;
    /** Names of the rules that fired, for the journal */
    fired_rules?: string[];
}

export interface DecisionEngine {
    decide(request: DecisionEngineRequest): Promise<DecisionEngineResult> | DecisionEngineResult;
}
