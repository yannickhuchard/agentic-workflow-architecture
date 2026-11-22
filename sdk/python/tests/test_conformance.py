"""
AWA conformance runner (Python SDK).
Runs the language-neutral cases in spec/conformance against this SDK.
Cases above the levels claimed here are skipped, not hidden.
"""

import json
import re
from pathlib import Path

import pytest

from awa.runtime.expression import ExpressionError, evaluate_expression
from awa.runtime.unary_test import MISSING, evaluate_unary_tests, validate_unary_tests
from awa.runtime.workflow_engine import WorkflowEngine
from awa.types import Workflow
from awa.validator import validate_workflow_integrity

CONFORMANCE = Path(__file__).resolve().parents[3] / "spec" / "conformance"
CLAIMED_LEVELS = {"core", "decision"}
# Rules about features the Python SDK does not execute (compensation, timer events)
UNSUPPORTED_INTEGRITY_RULES = {"invalid_compensation", "invalid_timer"}

EXECUTION = [json.loads(p.read_text()) for p in sorted((CONFORMANCE / "execution").glob("*.json"))]
DOCUMENTS = [json.loads(p.read_text()) for p in sorted((CONFORMANCE / "documents").glob("*.json"))]


class ConformanceActor:
    def __init__(self, scripts):
        self.scripts, self.visited, self.counts = scripts or {}, [], {}

    def execute(self, activity, token):
        self.visited.append(activity.name)
        n = self.counts[activity.name] = self.counts.get(activity.name, 0) + 1
        script = self.scripts.get(activity.name, {})
        if "attempts" in script:
            script = script["attempts"][min(n, len(script["attempts"])) - 1]
        if "error" in script:
            raise RuntimeError(script["error"])
        return script.get("output", {})


def is_subset(expected, actual):
    if not isinstance(expected, dict):
        return expected == actual
    return isinstance(actual, dict) and all(is_subset(v, actual.get(k)) for k, v in expected.items())


def unwrap(document):
    return document["workflow"] if "workflow" in document and "activities" not in document else document


@pytest.mark.parametrize("case", EXECUTION, ids=[c["id"] for c in EXECUTION])
def test_execution(case):
    if case["level"] not in CLAIMED_LEVELS:
        pytest.skip(f"level '{case['level']}' is not claimed by the Python SDK")

    engine = WorkflowEngine(Workflow.model_validate(case["workflow"]), options={"simulate": True})
    actor = ConformanceActor(case.get("actors"))
    engine._actors = {key: actor for key in engine._actors}
    result = engine.run(case.get("input"))
    expect = case["expect"]

    assert result["status"] == expect["status"]
    if "visited" in expect:
        assert actor.visited == expect["visited"]
    if "data" in expect:
        assert any(is_subset(expect["data"], t.context_data) for t in engine.tokens)
    if "error_matches" in expect:
        assert any(re.search(expect["error_matches"], str(t.get_data("_error") or "")) for t in engine.tokens)


@pytest.mark.parametrize("case", DOCUMENTS, ids=[c["id"] for c in DOCUMENTS])
def test_documents(case):
    document = unwrap(case["document"])
    if case["valid"]:
        assert validate_workflow_integrity(Workflow.model_validate(document)).valid
    elif case["stage"] == "schema":
        with pytest.raises(Exception):
            Workflow.model_validate(document)
    else:
        if case["error_code"] in UNSUPPORTED_INTEGRITY_RULES:
            pytest.skip(f"integrity rule '{case['error_code']}' is not implemented by the Python SDK")
        result = validate_workflow_integrity(Workflow.model_validate(document))
        assert not result.valid
        assert case["error_code"] in [e.code for e in result.errors]

UNARY = json.loads((CONFORMANCE / "unary-tests.json").read_text())


@pytest.mark.parametrize("case", UNARY["cases"], ids=[f"{c['entry']!r} | {c.get('value', 'missing')!r}" for c in UNARY["cases"]])
def test_decision_entries(case):
    value = MISSING if case.get("missing") else case["value"]
    assert evaluate_unary_tests(case["entry"], value) is case["expect"]


@pytest.mark.parametrize("entry", UNARY["invalid"])
def test_invalid_decision_entries_are_rejected(entry):
    assert validate_unary_tests(entry) is not None


EXPRESSIONS = json.loads((CONFORMANCE / "expressions.json").read_text())


@pytest.mark.parametrize("case", EXPRESSIONS["cases"], ids=[c["expression"] for c in EXPRESSIONS["cases"]])
def test_condition_expressions(case):
    assert evaluate_expression(case["expression"], EXPRESSIONS["data"]) is case["expect"]


@pytest.mark.parametrize("expression", EXPRESSIONS["invalid"])
def test_invalid_condition_expressions_are_rejected(expression):
    with pytest.raises(ExpressionError):
        evaluate_expression(expression, EXPRESSIONS["data"])
