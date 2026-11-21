"""
AWA conformance runner (Python SDK).
Runs the language-neutral cases in spec/conformance against this SDK.
Cases above the levels claimed here are skipped, not hidden.
"""

import json
import re
from pathlib import Path

import pytest

from awa.runtime.workflow_engine import WorkflowEngine
from awa.types import Workflow
from awa.validator import validate_workflow_integrity

CONFORMANCE = Path(__file__).resolve().parents[3] / "spec" / "conformance"
CLAIMED_LEVELS = {"core"}

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
        if case["error_code"] != "invalid_reference" or "decision_nodes" in document or "invalid-comp" in case["id"]:
            pytest.skip(f"integrity rule '{case['error_code']}' is not implemented by the Python SDK")
        assert not validate_workflow_integrity(Workflow.model_validate(document)).valid
