"""
AWA Outcome Contracts (specification section 11)

A contract states what must be true of an activity's outcome, whatever
strategy the actor used to reach it. Checks are deterministic: the same
outcome always gets the same result.
"""

from typing import Any

from awa.runtime.expression import evaluate_expression
from awa.types import OutcomeContract

ContractViolation = dict[str, str]


def outcome_of(result: dict[str, Any]) -> dict[str, Any]:
    """
    The outcome of an activity: the value of the result's `output` property
    when that is a JSON object, otherwise the result itself without
    engine-reserved properties (specification 11.1).
    """
    output = result.get("output")
    if isinstance(output, dict):
        return output
    return {key: value for key, value in result.items() if not str(key).startswith("_")}


def _schema_violations(schema: dict[str, Any], outcome: dict[str, Any]) -> list[ContractViolation]:
    try:
        from jsonschema import Draft202012Validator
    except ImportError:
        # Fail closed: a schema that cannot be checked is not satisfied
        return [{
            "kind": "output_schema", "name": "/",
            "message": "output_schema could not be checked: the 'jsonschema' package is not installed",
        }]
    try:
        Draft202012Validator.check_schema(schema)
        errors = sorted(Draft202012Validator(schema).iter_errors(outcome), key=lambda e: list(map(str, e.absolute_path)))
    except Exception as error:  # an invalid schema cannot be satisfied either
        return [{"kind": "output_schema", "name": "/", "message": f"output_schema is not a valid JSON Schema: {error}"}]
    violations = []
    for error in errors:
        path = "".join(f"/{part}" for part in error.absolute_path)
        violations.append({"kind": "output_schema", "name": path or "/", "message": f"{path or 'outcome'} {error.message}"})
    return violations


def check_contract(contract: OutcomeContract, outcome: dict[str, Any]) -> list[ContractViolation]:
    """Check an outcome against the deterministic terms of a contract: the schema, then the postconditions"""
    violations: list[ContractViolation] = []

    if contract.output_schema is not None:
        violations.extend(_schema_violations(contract.output_schema, outcome))

    for condition in contract.postconditions:
        holds, detail = False, ""
        try:
            holds = evaluate_expression(condition.expression, outcome)
        except Exception as error:
            detail = f" ({error})"
        if not holds:
            violations.append({
                "kind": "postcondition",
                "name": condition.name,
                "message": f'{condition.name}: "{condition.expression}" does not hold{detail}',
            })

    return violations


def contract_feedback(violations: list[ContractViolation]) -> str:
    """Corrective feedback for an actor whose outcome violated the contract"""
    return "\n".join(["CONTRACT VIOLATED. The outcome must satisfy every item below:",
                      *(f"- {v['message']}" for v in violations)])
