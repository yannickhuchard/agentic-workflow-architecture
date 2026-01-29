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

    return ValidationResult(valid=len(errors) == 0, errors=errors)
