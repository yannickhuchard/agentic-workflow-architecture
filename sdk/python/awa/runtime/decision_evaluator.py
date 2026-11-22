"""
AWA Decision Evaluator (specification 5.5).

Evaluates decision tables: unary-test entries, hit policies, outputs.
"""

import json
from dataclasses import dataclass, field
from typing import Any

from awa.runtime.unary_test import MISSING, evaluate_unary_tests
from awa.types import DecisionNode, DecisionRule, DecisionTable


class DecisionConflictError(ValueError):
    """The rules that match contradict the table's hit policy: a defect in the table."""

    code = "DECISION_CONFLICT"


@dataclass
class DecisionResult:
    matched: bool
    output_edge_id: str | None = None
    outputs: dict[str, Any] = field(default_factory=dict)
    matched_rules: list[DecisionRule] = field(default_factory=list)


def _hit_policy(table: DecisionTable) -> str:
    return getattr(table.hit_policy, "value", table.hit_policy)


def _rule_matches(rule: DecisionRule, table: DecisionTable, data: dict[str, Any]) -> bool:
    for index, column in enumerate(table.inputs):
        entry = rule.input_entries[index] if index < len(rule.input_entries) else "-"
        if not evaluate_unary_tests(entry, data.get(column.name, MISSING)):
            return False
    return True


def _outputs(rule: DecisionRule, table: DecisionTable) -> dict[str, Any]:
    return {column.name: rule.output_entries[i] for i, column in enumerate(table.outputs) if i < len(rule.output_entries)}


def evaluate_decision(node: DecisionNode, data: dict[str, Any]) -> DecisionResult:
    table = node.decision_table
    default = str(node.default_output_edge_id) if node.default_output_edge_id else None
    if table is None:
        return DecisionResult(matched=False, output_edge_id=default)

    policy = _hit_policy(table)
    matched: list[DecisionRule] = []
    for rule in table.rules:
        if _rule_matches(rule, table, data):
            matched.append(rule)
            if policy == "first":
                break
    if not matched:
        return DecisionResult(matched=False, output_edge_id=default)

    number = lambda rule: table.rules.index(rule) + 1  # noqa: E731
    deciding = matched[0]

    if policy == "unique" and len(matched) > 1:
        raise DecisionConflictError(
            f'Decision "{node.name}" has hit policy "unique" but rules '
            f'{" and ".join(str(number(r)) for r in matched)} both match')
    if policy == "any":
        signature = lambda r: json.dumps([r.output_entries, str(r.output_edge_id) if r.output_edge_id else None], sort_keys=True)  # noqa: E731
        differing = next((r for r in matched if signature(r) != signature(matched[0])), None)
        if differing:
            raise DecisionConflictError(
                f'Decision "{node.name}" has hit policy "any" but rules {number(matched[0])} and '
                f'{number(differing)} match with different results')
    if policy == "priority":
        for rule in matched:
            if (rule.priority or 0) > (deciding.priority or 0):
                deciding = rule

    if policy in ("collect", "rule_order"):
        outputs = {column.name: [r.output_entries[i] for r in matched] for i, column in enumerate(table.outputs)}
        edge = next((r.output_edge_id for r in matched if r.output_edge_id), None)
        rules = matched
    else:
        outputs, edge, rules = _outputs(deciding, table), deciding.output_edge_id, [deciding]

    return DecisionResult(matched=True, output_edge_id=str(edge) if edge else default, outputs=outputs, matched_rules=rules)


class DecisionEvaluator:
    """Evaluates decision tables to determine the next path in a workflow."""

    def evaluate(self, node: DecisionNode, context_data: dict[str, Any]) -> str | None:
        """The id of the edge to take, or None. Raises DecisionConflictError on a hit-policy conflict."""
        return evaluate_decision(node, context_data).output_edge_id

    def decide(self, node: DecisionNode, context_data: dict[str, Any]) -> DecisionResult:
        return evaluate_decision(node, context_data)
