"""
AWA Validator - Schema validation for AWA entities
"""

from dataclasses import dataclass
from typing import Any

from pydantic import ValidationError as PydanticValidationError

from awa.types import Activity, Context, Workflow


@dataclass
class ValidationError:
    path: str
    message: str
    code: str


@dataclass
class ValidationResult:
    valid: bool
    errors: list[ValidationError]


def _format_pydantic_errors(exc: PydanticValidationError) -> list[ValidationError]:
    """Convert Pydantic validation errors to our format."""
    errors = []
    for error in exc.errors():
        path = ".".join(str(loc) for loc in error["loc"])
        errors.append(
            ValidationError(
                path=path,
                message=error["msg"],
                code=error["type"],
            )
        )
    return errors


def validate_workflow(data: dict[str, Any]) -> ValidationResult:
    """Validate a workflow against the AWA schema."""
    try:
        Workflow.model_validate(data)
        return ValidationResult(valid=True, errors=[])
    except PydanticValidationError as e:
        return ValidationResult(valid=False, errors=_format_pydantic_errors(e))


def validate_activity(data: dict[str, Any]) -> ValidationResult:
    """Validate an activity against the AWA schema."""
    try:
        Activity.model_validate(data)
        return ValidationResult(valid=True, errors=[])
    except PydanticValidationError as e:
        return ValidationResult(valid=False, errors=_format_pydantic_errors(e))


def validate_context(data: dict[str, Any]) -> ValidationResult:
    """Validate a context against the AWA schema."""
    try:
        Context.model_validate(data)
        return ValidationResult(valid=True, errors=[])
    except PydanticValidationError as e:
        return ValidationResult(valid=False, errors=_format_pydantic_errors(e))


def validate_workflow_integrity(workflow: Workflow) -> ValidationResult:
    """Semantic validation for workflow integrity."""
    errors: list[ValidationError] = []

    # Collect all node IDs
    node_ids = set()
    node_ids.update(a.id for a in workflow.activities)
    node_ids.update(e.id for e in workflow.events)
    node_ids.update(d.id for d in workflow.decision_nodes)

    # Check edge references
    for edge in workflow.edges:
        if edge.source_id not in node_ids:
            errors.append(
                ValidationError(
                    path=f"edges[{edge.id}].source_id",
                    message=f"Source node '{edge.source_id}' not found",
                    code="invalid_reference",
                )
            )
        if edge.target_id not in node_ids:
            errors.append(
                ValidationError(
                    path=f"edges[{edge.id}].target_id",
                    message=f"Target node '{edge.target_id}' not found",
                    code="invalid_reference",
                )
            )

    # Check context binding references
    context_ids = {c.id for c in workflow.contexts}
    for activity in workflow.activities:
        for binding in activity.context_bindings:
            if binding.context_id not in context_ids:
                errors.append(
                    ValidationError(
                        path=f"activities[{activity.id}].context_bindings",
                        message=f"Context '{binding.context_id}' not found",
                        code="invalid_reference",
                    )
                )

    # Imported here: the runtime package itself imports this module
    from awa.runtime.expression import ExpressionError, evaluate_expression
    from awa.runtime.unary_test import validate_unary_tests

    def add(path: str, message: str, code: str) -> None:
        errors.append(ValidationError(path=path, message=message, code=code))

    # Node and edge identifiers are unique
    seen: set[Any] = set()
    for item in [*workflow.activities, *workflow.events, *workflow.decision_nodes, *workflow.edges]:
        if item.id in seen:
            add(f"[{item.id}]", f"Duplicate identifier '{item.id}'", "duplicate_id")
        seen.add(item.id)

    # Conditions are valid expressions; at most one default edge per source
    defaults: dict[Any, int] = {}
    for edge in workflow.edges:
        if edge.condition:
            try:
                evaluate_expression(edge.condition, {})
            except ExpressionError as error:
                add(f"edges[{edge.id}].condition", str(error), "invalid_expression")
        if edge.is_default:
            defaults[edge.source_id] = defaults.get(edge.source_id, 0) + 1
    for source_id, count in defaults.items():
        if count > 1:
            add(f"edges[source={source_id}]", f"Node '{source_id}' has {count} default edges; at most one is allowed",
                "multiple_default_edges")

    # Decision tables: rule width, entries, and edges that leave the node
    edges_by_id = {edge.id: edge for edge in workflow.edges}
    for decision in workflow.decision_nodes:
        table = decision.decision_table
        refs = [decision.default_output_edge_id] if decision.default_output_edge_id else []
        if table:
            for index, rule in enumerate(table.rules):
                where = f"decision_nodes[{decision.id}].decision_table.rules[{index}]"
                if len(rule.input_entries) != len(table.inputs) or len(rule.output_entries) != len(table.outputs):
                    add(where, f"Rule {index + 1} of '{decision.name}' does not have one entry per column", "invalid_rule")
                for entry in rule.input_entries:
                    problem = validate_unary_tests(entry)
                    if problem:
                        add(where, problem, "invalid_expression")
                if rule.output_edge_id:
                    refs.append(rule.output_edge_id)
        for ref in refs:
            target = edges_by_id.get(ref)
            if target is None:
                add(f"decision_nodes[{decision.id}]", f"Output edge '{ref}' not found", "invalid_reference")
            elif target.source_id != decision.id:
                add(f"decision_nodes[{decision.id}]", f"Output edge '{ref}' does not leave this decision node", "invalid_reference")

    return ValidationResult(valid=len(errors) == 0, errors=errors)
