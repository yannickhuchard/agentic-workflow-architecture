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
from awa.runtime.models import FunctionModelProvider
from awa.runtime.unary_test import MISSING, evaluate_unary_tests, validate_unary_tests
from awa.runtime.workflow_engine import WorkflowEngine
from awa.types import ActorType, Workflow
from awa.validator import validate_workflow_integrity

CONFORMANCE = Path(__file__).resolve().parents[3] / "spec" / "conformance"
SCHEMAS = Path(__file__).resolve().parents[3] / "spec" / "json-schema"
CLAIMED_LEVELS = {"core", "decision", "verified", "recorded", "resilient", "contract", "flow", "events",
                  "tools", "model_decision", "routing", "journeys", "measures"}
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

    def execute(self, activity, token, context=None):
        self.visited.append(activity.name)
        n = self.counts[activity.name] = self.counts.get(activity.name, 0) + 1
        script = self.scripts.get(activity.name, {})
        if "attempts" in script:
            script = script["attempts"][min(n, len(script["attempts"])) - 1]
        if script.get("delay_ms"):
            time.sleep(script["delay_ms"] / 1000)
        # Tool calls the actor makes, in order, before it returns
        for call in script.get("calls", []):
            context.tools.call(call["tool"], call.get("arguments", {}))
        if "error" in script:
            raise ScriptedError(script["error"], script.get("code"))
        return script.get("output", {})


def scripted_tools(script):
    """Handlers for `function` tools: each returns the case's `result`, or raises its `error`"""
    def handler(spec):
        def run(arguments):
            if "error" in spec:
                raise RuntimeError(spec["error"])
            return spec.get("result")
        return run
    return {"handlers": {name: handler(spec) for name, spec in script.items()}}


def scripted_models(script):
    """
    Scripted model providers. Each call to a provider takes its next reply; the
    last repeats. A provider scripted with an `error` fails every call. The
    short form, `replies` alone, is one provider that every standard tier maps to.
    Returns the engine options and the number of calls made to each provider.
    """
    calls = {}

    def provider(provider_id, replies):
        calls[provider_id] = 0

        def reply_to(request):
            calls[provider_id] += 1
            if not replies:
                raise RuntimeError(f'the case scripts no reply for provider "{provider_id}"')
            reply = replies[min(calls[provider_id], len(replies)) - 1]
            if "error" in reply:
                raise ScriptedError(reply["error"], reply.get("code"))
            return reply["text"] if "text" in reply else json.dumps(reply)
        return FunctionModelProvider(provider_id, reply_to)

    if "providers" in script:
        return {
            "model_providers": [
                provider(p["id"], [{"error": p["error"], "code": p.get("code")}] if "error" in p else p.get("replies", []))
                for p in script["providers"]],
            "default_model_provider": script["providers"][0]["id"],
            "model_tiers": script.get("tiers", {}),
        }, calls
    return {
        "model_providers": [provider("conformance", script.get("replies", []))],
        "model_tiers": {tier: "conformance:model" for tier in ("fast", "balanced", "reasoning")},
    }, calls


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
    model_options, model_calls = scripted_models(case.get("model", {}))
    engine = WorkflowEngine(Workflow.model_validate(case["workflow"]), options={
        "actors": {actor_type: actor for actor_type in ActorType},
        **({"tools": scripted_tools(case["tools"])} if "tools" in case else {}),
        **(model_options if "model" in case else {}),
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
    for excluded in expect.get("journal_excludes", []):
        assert excluded not in [e["type"] for e in events]
    for event_type, count in expect.get("journal_count", {}).items():
        assert len([e for e in events if e["type"] == event_type]) == count, f"count of {event_type}"
    for wanted in expect.get("journal_mentions", []):
        assert any(
            is_subset(wanted["event"], e) and all(text in json.dumps(e["data"]) for text in wanted["mentions"])
            for e in events), f"no event matching {json.dumps(wanted['event'])} mentions {', '.join(wanted['mentions'])}"
    if "model_calls" in expect:
        assert sum(model_calls.values()) == expect["model_calls"], "calls to the model"
    for provider_id, count in expect.get("provider_calls", {}).items():
        assert model_calls.get(provider_id) == count, f"calls to provider {provider_id}"
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


# ---------------------------------------------------------------------------
# Journeys (specification section 19) and measures (section 21)
# ---------------------------------------------------------------------------

from awa.runtime.duration import parse_iso_duration  # noqa: E402
from awa.runtime.expression import resolve_path  # noqa: E402
from awa.runtime.journal import InMemoryJournalStore  # noqa: E402
from awa.runtime.journey import time_ms  # noqa: E402
from awa.runtime.kpi import compute_measures  # noqa: E402
from awa.runtime.runtime_host import AwaRuntime, InMemoryRuntimeStore  # noqa: E402

JOURNEYS = [json.loads(p.read_text()) for p in sorted((CONFORMANCE / "journeys").glob("*.json"))]
MEASURE_CASES = [json.loads(p.read_text()) for p in sorted((CONFORMANCE / "measures").glob("*.json"))]


def schema_validator(file_name):
    """A validator for one of the published JSON Schemas, with the others at hand for its references"""
    from jsonschema import Draft202012Validator, FormatChecker
    from referencing import Registry, Resource
    schemas = [json.loads(p.read_text()) for p in sorted(SCHEMAS.glob("*.json"))]
    registry = Registry().with_resources([(s["$id"], Resource.from_contents(s)) for s in schemas if "$id" in s])
    return Draft202012Validator(json.loads((SCHEMAS / file_name).read_text()), registry=registry, format_checker=FormatChecker())


class JourneyCaseActor(ConformanceActor):
    """Follows the case's script; an activity that `takes` time moves the case's clock by that much"""

    def __init__(self, scripts, spend):
        super().__init__(scripts)
        self.spend = spend

    def execute(self, activity, token):
        script = self.scripts.get(activity.name, {})
        if script.get("takes"):
            self.spend(parse_iso_duration(script["takes"]))
        return super().execute(activity, token)


def in_order(wanted, actual):
    """The wanted types that were not found in this order; others may come between"""
    cursor = 0
    for type in actual:
        if cursor < len(wanted) and type == wanted[cursor]:
            cursor += 1
    return wanted[cursor:]


@pytest.mark.parametrize("case", JOURNEYS, ids=[c["id"] for c in JOURNEYS])
def test_journeys(case):
    if case["level"] not in CLAIMED_LEVELS:
        pytest.skip(f"level '{case['level']}' is not claimed by the Python SDK")

    journey_schema, journey_event_schema = schema_validator("journey.schema.json"), schema_validator("journey-event.schema.json")
    clock = {"now": time_ms(case["start"])}
    store, journal = InMemoryRuntimeStore(), InMemoryJournalStore()

    def spend(ms):
        clock["now"] += ms

    actor = JourneyCaseActor(case.get("actors"), spend)

    def host(recover):
        """A new host over what the previous one kept: the same store and the same journals, nothing else"""
        runtime = AwaRuntime(
            now=lambda: clock["now"], store=store,
            engine={"actors": {actor_type: actor for actor_type in ActorType}, "journal": journal, "sleep": lambda ms: None})
        for workflow in case["workflows"]:
            runtime.register_workflow(workflow)
        for journey in case["journeys"]:
            assert [e.message for e in journey_schema.iter_errors(journey)] == []
            runtime.register_journey(journey)
        if recover:
            runtime.recover()
        return runtime

    runtime = host(False)
    for number, step in enumerate(case["steps"]):
        expect = step.get("expect", {})
        if "advance" in step:
            spend(parse_iso_duration(step["advance"]))
        elif step.get("restart"):
            runtime = host(True)
        elif step.get("tick"):
            result = runtime.tick()
            if "timed_out_runs" in expect:
                assert len(result["timed_out_runs"]) == expect["timed_out_runs"], "runs timed out"
        else:
            event = step["publish"]
            result = runtime.publish({
                "specversion": "1.0", "id": event.get("id") or f"evt-{number}-{uuid4()}",
                "source": event.get("source") or "/conformance", "type": event["type"], "data": event.get("data", {}),
            })
            if "accepted" in expect:
                assert result["accepted"] is expect["accepted"], f"accepted {event['type']}"

    expect = case["expect"]
    names = {j.id: j.name for j in runtime.list_journeys()}
    instances = runtime.list_journey_instances()
    if "instance_count" in expect:
        assert len(instances) == expect["instance_count"]
    for wanted in expect.get("instances", []):
        found = [i for i in instances if names[i["journey_id"]] == wanted["journey"]
                 and (not wanted.get("subject_key") or i["subject_key"] == wanted["subject_key"])]
        assert len(found) == 1, f"instances of {wanted['journey']} {wanted.get('subject_key', '')}"
        instance = found[0]
        types = [e["type"] for e in instance["events"]]
        # Every implementation that records journeys must record validly: schema-valid events, numbered from 1 without gaps
        for position, event in enumerate(instance["events"]):
            assert [e.message for e in journey_event_schema.iter_errors(event)] == [], event
            assert event["seq"] == position + 1
        for key in ("status", "stage_id", "stalled", "sentiment"):
            if key in wanted:
                assert instance.get(key) == wanted[key] and isinstance(instance.get(key), bool) == isinstance(wanted[key], bool), key
        if "goals_reached" in wanted:
            assert instance["goals_reached"] == wanted["goals_reached"]
        if "runs" in wanted:
            assert [r["status"] for r in instance["runs"]] == wanted["runs"]
        if "data" in wanted:
            assert is_subset(wanted["data"], instance["data"]), json.dumps(instance["data"])
        if "events" in wanted:
            assert in_order(wanted["events"], types) == [], f"record was: {', '.join(types)}"
        if "events_exact" in wanted:
            assert types == wanted["events_exact"]
        for type, count in wanted.get("events_count", {}).items():
            assert types.count(type) == count, f"count of {type}"
        for part in wanted.get("events_contain", []):
            rest = {k: v for k, v in part.items() if k != "has"}
            absent = object()
            assert any(is_subset(rest, e) and all(resolve_path(e, p, absent) is not absent for p in part.get("has", []))
                       for e in instance["events"]), f"no journey event matches {json.dumps(part)}"
        if "run_journal" in wanted:
            events = runtime.export_journey(instance["id"])["runs"][0]["events"]
            for position, event in enumerate(events):
                check_journal_event(event, position + 1)
            assert in_order(wanted["run_journal"], [e["type"] for e in events]) == [], \
                f"journal was: {', '.join(e['type'] for e in events)}"
    if "transitions" in expect:
        assert [{"from": names[t["from"]], "to": names[t["to"]], "count": t["count"]}
                for t in runtime.transitions()] == expect["transitions"]


@pytest.mark.parametrize("case", MEASURE_CASES, ids=[c["id"] for c in MEASURE_CASES])
def test_measures(case):
    if case["level"] not in CLAIMED_LEVELS:
        pytest.skip(f"level '{case['level']}' is not claimed by the Python SDK")

    report = compute_measures(case["recorded"], case.get("options"))
    # The report has the form the schema fixes
    assert [e.message for e in schema_validator("measure-report.schema.json").iter_errors(report)] == []

    def same(got, want):
        if want is None:
            return got is None
        return isinstance(got, (int, float)) and not isinstance(got, bool) and abs(got - want) < 1e-9

    def measures(where, got, want):
        for id, value in want.items():
            actual = got.get(id, {}).get("value", "absent")
            assert same(actual, value), f"{where} {id}: got {actual}, expected {value}"

    def one(items, key, value, what):
        found = [x for x in items if x[key] == value]
        assert found, f"{what} {value}"
        return found[0]

    expect = case["expect"]
    if expect.get("currency"):
        assert report["currency"] == expect["currency"]
    for j in expect.get("journeys", []):
        got = one(report["journeys"], "name", j["name"], "journey")
        measures(j["name"], got["measures"], j.get("measures", {}))
        for s in j.get("stages", []):
            stage = one(got["stages"], "stage_id", s["stage_id"], "stage")
            if "owner" in s:
                assert stage.get("owner") == s["owner"]
            measures(f"{j['name']} / {s['stage_id']}", stage["measures"], s["measures"])
        if "channels" in j:
            assert got["channels"] == j["channels"]
        if "artefacts" in j:
            assert got["artefacts"] == j["artefacts"]
    for w in expect.get("workflows", []):
        got = one(report["workflows"], "name", w["name"], "workflow")
        measures(w["name"], got["measures"], w.get("measures", {}))
        for a in w.get("activities", []):
            measures(f"{w['name']} / {a['name']}", one(got["activities"], "name", a["name"], "activity")["measures"], a["measures"])
    if "attention" in expect:
        assert len(report["attention"]) == len(expect["attention"])
        for got, want in zip(report["attention"], expect["attention"]):
            assert is_subset(want, got), f"{json.dumps(got)} does not contain {json.dumps(want)}"
