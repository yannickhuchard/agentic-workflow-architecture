"""Run outcome, routing and condition expression behaviour (spec sections 5-6)."""

from uuid import uuid4

import pytest

from awa.runtime.expression import ExpressionError, evaluate_expression
from awa.runtime.workflow_engine import EngineStatus, WorkflowEngine
from awa.types import Workflow


class Scripted:
    def __init__(self, script):
        self.script, self.calls = script, []

    def execute(self, activity, token):
        self.calls.append(activity.name)
        result = self.script.get(activity.name, {"ok": True})
        if isinstance(result, Exception):
            raise result
        return result


def build(script, edges):
    ids = {name: str(uuid4()) for name in "ABC"}
    workflow = Workflow.model_validate({
        "id": str(uuid4()), "name": "t", "version": "1.0.0",
        "activities": [
            {"id": ids[n], "name": n, "role_id": str(uuid4()), "actor_type": "application"} for n in "ABC"
        ],
        "edges": [
            {"id": str(uuid4()), "source_id": ids[s], "target_id": ids[t], **extra} for s, t, extra in edges
        ],
    })
    engine = WorkflowEngine(workflow, options={"simulate": True})
    actor = Scripted(script)
    engine._actors = {key: actor for key in engine._actors}
    return engine, actor


def test_failed_activity_fails_the_run():
    engine, _ = build({"A": RuntimeError("boom")}, [("A", "B", {})])
    assert engine.run()["status"] == "failed"
    assert engine.status == EngineStatus.FAILED


def test_first_true_condition_wins():
    engine, actor = build({"A": {"approved": True}},
                          [("A", "B", {"condition": "approved == true"}), ("A", "C", {"condition": "approved == false"})])
    assert engine.run()["status"] == "completed"
    assert actor.calls == ["A", "B"]


def test_default_edge_when_nothing_matches():
    engine, actor = build({"A": {"approved": "maybe"}},
                          [("A", "B", {"condition": "approved == true"}), ("A", "C", {"is_default": True})])
    assert engine.run()["status"] == "completed"
    assert actor.calls == ["A", "C"]


def test_no_route_fails_instead_of_guessing():
    engine, actor = build({"A": {"approved": "maybe"}},
                          [("A", "B", {"condition": "approved == true"}), ("A", "C", {"condition": "approved == false"})])
    assert engine.run()["status"] == "failed"
    assert actor.calls == ["A"]


DATA = {"amount": 120, "status": "approved", "ok": True, "nested": {"score": 0.2}, "empty": None}


@pytest.mark.parametrize("expression,expected", [
    ("amount > 100", True), ("amount <= 100", False), ("amount == 120", True),
    ("status == approved", True), ('status == "approved"', True), ("status != 'rejected'", True),
    ("status != approved", False), ("ok == true", True), ("ok", True), ("!ok", False),
    ("nested.score < 0.3", True), ("missing == 1", False), ("missing != 1", True),
    ("missing exists", False), ("empty exists", True), ("empty == null", True),
    ("typeof amount == number", True), ("typeof status == string", True),
    ("ok && amount > 100", True), ("ok && amount > 500", False),
    ("amount > 500 || status == approved", True), ("!(ok && amount > 500)", True),
    ("missing > 1", False),
])
def test_expressions(expression, expected):
    assert evaluate_expression(expression, DATA) is expected


@pytest.mark.parametrize("bad", ["", "amount >", "== 3", "amount > 1 &&", "a ? b", "(ok"])
def test_invalid_expressions_raise(bad):
    with pytest.raises(ExpressionError):
        evaluate_expression(bad, DATA)
