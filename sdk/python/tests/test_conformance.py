"""
AWA conformance runner (Python SDK).
Runs the language-neutral cases in spec/conformance against this SDK.
Cases at levels not claimed here are skipped, not hidden.
"""

import json
import re
import time
from datetime import datetime
from pathlib import Path
from uuid import uuid4

import pytest

from awa.runtime.expression import ExpressionError, evaluate_expression
from awa.runtime.unary_test import MISSING, evaluate_unary_tests, validate_unary_tests
from awa.runtime.workflow_engine import WorkflowEngine
from awa.types import ActorType, Workflow
from awa.validator import validate_workflow_integrity

CONFORMANCE = Path(__file__).resolve().parents[3] / "spec" / "conformance"
SCHEMAS = Path(__file__).resolve().parents[3] / "spec" / "json-schema"
CLAIMED_LEVELS = {"core", "decision", "verified", "recorded", "resilient", "contract", "flow", "events"}
# Integrity rules the Python SDK does not enforce. None at present.
UNSUPPORTED_INTEGRITY_RULES: set[str] = set()

EXECUTION = [json.loads(p.read_text()) for p in sorted((CONFORMANCE / "execution").glob("*.json"))]
DOCUMENTS = [json.loads(p.read_text()) for p in sorted((CONFORMANCE / "documents").glob("*.json"))]


class ScriptedError(RuntimeError):
    def __init__(self, message, code=None):
        super().__init__(message)
        if code:
            self.code = code


class ConformanceActor:
    def __init__(self, scripts):
        self.scripts, self.visited, self.counts = scripts or {}, [], {}

    def execute(self, activity, token):
        self.visited.append(activity.name)
        n = self.counts[activity.name] = self.counts.get(activity.name, 0) + 1
        script = self.scripts.get(activity.name, {})
        if "attempts" in script:
            script = script["attempts"][min(n, len(script["attempts"])) - 1]
        if script.get("delay_ms"):
            time.sleep(script["delay_ms"] / 1000)
        if "error" in script:
            raise ScriptedError(script["error"], script.get("code"))
        return script.get("output", {})


def is_subset(expected, actual):
    """Every property of `expected` is in `actual` with an equal value, at any depth"""
    if isinstance(expected, dict):
        return isinstance(actual, dict) and all(k in actual and is_subset(v, actual[k]) for k, v in expected.items())
    if isinstance(expected, list):
        return (isinstance(actual, list) and len(actual) >= len(expected)
                and all(is_subset(e, a) for e, a in zip(expected, actual)))
    if isinstance(expected, bool) or isinstance(actual, bool):
        return expected is actual
    return expected == actual


def unwrap(document):
    return document["workflow"] if "workflow" in document and "activities" not in document else document


def journal_event_validator():
    """Validates journal events against journal-event.schema.json, when a JSON Schema validator is installed"""
    try:
        from jsonschema import Draft202012Validator, FormatChecker
        from referencing import Registry, Resource
    except ImportError:
        return None
    schemas = [json.loads(p.read_text()) for p in sorted(SCHEMAS.glob("*.json"))]
    registry = Registry().with_resources([(s["$id"], Resource.from_contents(s)) for s in schemas if "$id" in s])
    schema = next(s for s in schemas if s.get("$id", "").endswith("/journal-event.schema.json"))
    return Draft202012Validator(schema, registry=registry, format_checker=FormatChecker())


EVENT_VALIDATOR = journal_event_validator()
UUID_PATTERN = re.compile(r"^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$")
REQUIRED_EVENT_FIELDS = ["spec_version", "id", "run_id", "seq", "time", "type", "level", "workflow_id", "data"]


def check_journal_event(event, position):
    """Every implementation that journals must journal validly: schema-valid events, numbered from 1 without gaps"""
    assert event["seq"] == position
    for name in REQUIRED_EVENT_FIELDS:
        assert name in event, f"event {position} has no {name}"
    for name in ("id", "run_id", "workflow_id", "token_id", "node_id"):
        if name in event:
            assert UUID_PATTERN.match(event[name]), f"event {position}: {name} is not a UUID"
    assert re.match(r"^\d+\.\d+$", event["spec_version"])
    assert event["level"] in ("execution", "reasoning", "meta")
    assert isinstance(event["data"], dict)
    assert datetime.fromisoformat(event["time"].replace("Z", "+00:00")).tzinfo is not None
    if "attempt" in event:
        assert isinstance(event["attempt"], int) and event["attempt"] >= 1
    json.dumps(event)  # an event is a JSON object
    if EVENT_VALIDATOR is not None:
        problems = [e.message for e in EVENT_VALIDATOR.iter_errors(event)]
        assert problems == [], f"event {position} ({event['type']}): {problems}"


@pytest.mark.parametrize("case", EXECUTION, ids=[c["id"] for c in EXECUTION])
def test_execution(case):
    if case["level"] not in CLAIMED_LEVELS:
        pytest.skip(f"level '{case['level']}' is not claimed by the Python SDK")

    # Every actor is replaced by one that follows the case's script
    actor = ConformanceActor(case.get("actors"))
    engine = WorkflowEngine(Workflow.model_validate(case["workflow"]), options={
        "actors": {actor_type: actor for actor_type in ActorType},
        **case.get("options", {}),
    })
    status = engine.run(case.get("input"))["status"]

    # Steps performed while the run waits: deliver a business event, or let its waits time out
    for number, step in enumerate(case.get("deliver", [])):
        if step.get("expire"):
            engine.expire_events(float("inf"))
        else:
            event = step["event"]
            resumed = engine.deliver_event({
                "specversion": "1.0", "id": event.get("id") or f"evt-{number}-{uuid4()}", "source": "/conformance",
                "type": event["type"], "data": event.get("data", {}),
            })
            if "resumes" in step:
                assert resumed == step["resumes"], f"tokens resumed by {event['type']}"
        status = engine.run()["status"]

    expect = case["expect"]

    assert status == expect["status"]
    assert engine.status.value == expect["status"]
    if "visited" in expect:
        assert actor.visited == expect["visited"]
    if "visited_unordered" in expect:
        assert sorted(actor.visited) == sorted(expect["visited_unordered"])
    for name in expect.get("not_visited", []):
        assert name not in actor.visited
    if "data" in expect:
        assert any(is_subset(expect["data"], t.context_data) for t in engine.tokens)

    events = engine.get_events()
    for index, event in enumerate(events):
        check_journal_event(event, index + 1)
    if "journal" in expect:
        # The expected types must appear in this order; other events may be interleaved
        cursor = 0
        for event in events:
            if cursor < len(expect["journal"]) and event["type"] == expect["journal"][cursor]:
                cursor += 1
        assert expect["journal"][cursor:] == [], f"journal was: {', '.join(e['type'] for e in events)}"
    for wanted in expect.get("journal_contains", []):
        assert any(is_subset(wanted, e) for e in events), f"no event matches {json.dumps(wanted)}"
    if "error_matches" in expect:
        errors = [str(t.get_data("_error") or "") for t in engine.tokens]
        assert any(re.search(expect["error_matches"], e) for e in errors), " | ".join(errors)


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
