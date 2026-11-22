"""
AWA conformance runner (Python SDK).
Runs the language-neutral cases in spec/conformance against this SDK.
Cases at levels not claimed here are skipped, not hidden.
"""

import copy
import json
import re
import time
from datetime import datetime
from pathlib import Path
from uuid import uuid4

import pytest

from awa.runtime.counterfactual import counterfactual_replay
from awa.runtime.duration import parse_iso_duration
from awa.runtime.expression import ExpressionError, evaluate_expression
from awa.runtime.journey import time_ms
from awa.runtime.knowledge import KnowledgeBase
from awa.runtime.models import FunctionModelProvider
from awa.runtime.unary_test import MISSING, evaluate_unary_tests, validate_unary_tests
from awa.runtime.workflow_engine import WorkflowEngine
from awa.types import ActorType, Workflow
from awa.validator import validate_workflow_integrity

CONFORMANCE = Path(__file__).resolve().parents[3] / "spec" / "conformance"
SCHEMAS = Path(__file__).resolve().parents[3] / "spec" / "json-schema"
CLAIMED_LEVELS = {"core", "decision", "verified", "recorded", "resilient", "contract", "flow", "events",
                  "tools", "model_decision", "routing", "journeys", "measures",
                  "replay", "contexts", "service_levels", "knowledge"}
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
    def __init__(self, scripts, spend=None):
        self.scripts, self.visited, self.counts = scripts or {}, [], {}
        # Moves the case's clock by the time an execution `takes`
        self.spend = spend or (lambda ms: None)
        # The ids of the knowledge entries the actor was handed, one list per execution
        self.given = []
        # The contexts the actor was handed at its last execution of each activity; None when it was handed none
        self.contexts = {}

    def execute(self, activity, token, context=None):
        self.visited.append(activity.name)
        self.given.append({"activity": activity.name, "ids": [k["id"] for k in token.get_data("_knowledge") or []]})
        self.contexts[activity.name] = copy.deepcopy(token.context_data.get("_contexts"))
        n = self.counts[activity.name] = self.counts.get(activity.name, 0) + 1
        script = self.scripts.get(activity.name, {})
        if "attempts" in script:
            script = script["attempts"][min(n, len(script["attempts"])) - 1]
        if script.get("delay_ms"):
            time.sleep(script["delay_ms"] / 1000)
        if script.get("takes"):
            self.spend(parse_iso_duration(script["takes"]))
        # Tool calls the actor makes, in order, before it returns
        for call in script.get("calls", []):
            context.tools.call(call["tool"], call.get("arguments", {}))
        if "error" in script:
            raise ScriptedError(script["error"], script.get("code"))
        return {
            **script.get("output", {}),
            **({"_reasoning": script["reasoning"]} if "reasoning" in script else {}),
            **({"_context_writes": script["contexts"]} if "contexts" in script else {}),
        }


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

    # A case with a clock runs on it: actors spend time on it and the case moves it
    clock = {"now": time_ms(case["clock"]) if "clock" in case else 0}

    def spend(ms):
        clock["now"] += ms

    # Every actor is replaced by one that follows the case's script
    actor = ConformanceActor(case.get("actors"), spend)
    model_options, model_calls = scripted_models(case.get("model", {}))
    engine = WorkflowEngine(Workflow.model_validate(case["workflow"]), options={
        "actors": {actor_type: actor for actor_type in ActorType},
        **({"tools": scripted_tools(case["tools"])} if "tools" in case else {}),
        **(model_options if "model" in case else {}),
        **({"now": lambda: clock["now"], "sleep": lambda ms: None} if "clock" in case else {}),
        **case.get("options", {}),
    })
    status = engine.run(case.get("input"))["status"]

    # Steps performed while the run waits: deliver a business event, let its waits time out,
    # move the clock, or ask the engine to check the work that is waiting
    for number, step in enumerate(case.get("deliver", [])):
        if "advance" in step:
            spend(parse_iso_duration(step["advance"]))
            continue
        elif step.get("check_service_levels"):
            checked = engine.check_service_levels()
            assert is_subset(step.get("expect", {}), checked), f"service levels checked: {checked}"
        elif step.get("expire"):
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
    for name, given in expect.get("given_contexts", {}).items():
        assert name in actor.contexts or given is None, f"{name} was not executed"
        assert actor.contexts.get(name) == given, f"contexts given to {name}"
    if "contexts" in expect:
        assert engine.get_contexts() == expect["contexts"]
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

from awa.runtime.expression import resolve_path  # noqa: E402
from awa.runtime.journal import InMemoryJournalStore  # noqa: E402
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

    actor = ConformanceActor(case.get("actors"), spend)

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


# ---------------------------------------------------------------------------
# Counterfactual replay (specification section 20) and knowledge (section 15)
# ---------------------------------------------------------------------------

REPLAY_CASES = [json.loads(p.read_text()) for p in sorted((CONFORMANCE / "replay").glob("*.json"))]
KNOWLEDGE_CASES = [json.loads(p.read_text()) for p in sorted((CONFORMANCE / "knowledge").glob("*.json"))]


@pytest.mark.parametrize("case", REPLAY_CASES, ids=[c["id"] for c in REPLAY_CASES])
def test_replay(case):
    if case["level"] not in CLAIMED_LEVELS:
        pytest.skip(f"level '{case['level']}' is not claimed by the Python SDK")

    quiet = {"sleep": lambda ms: None}
    actor = ConformanceActor(case.get("actors"))
    workflow = Workflow.model_validate(case["workflow"])
    baseline = WorkflowEngine(workflow, options={"actors": {actor_type: actor for actor_type in ActorType}, **quiet})
    assert baseline.run(case.get("input") or {})["status"] == case["expect"]["baseline_status"]

    # In the replay nothing but the candidate's AI agents may run: every other actor is the recording
    live = ConformanceActor(case.get("candidate_actors"))
    replay = counterfactual_replay(
        workflow, baseline.get_events(),
        candidate=Workflow.model_validate(case["candidate"]) if "candidate" in case else None, ai=case["ai"],
        engine={**quiet, **({"actors": {ActorType.ai_agent: live}} if case["ai"] == "live" else {})})
    report, expect = replay.report, case["expect"]

    for index, event in enumerate(replay.events):
        check_journal_event(event, index + 1)
    assert replay.status == expect["candidate_status"]
    if "same_path" in expect:
        assert report["same_path"] is expect["same_path"]
    for name, verdict in expect.get("verdicts", {}).items():
        found = [n["verdict"] for n in report["nodes"] if n["node_name"] == name]
        assert found == [verdict], f"verdict for {name}"
    if "regressions" in expect:
        assert len(report["regressions"]) == expect["regressions"], "; ".join(report["regressions"])
    if "regressions_at_least" in expect:
        assert len(report["regressions"]) >= expect["regressions_at_least"]
    if "unrecorded" in expect:
        assert len(report["unrecorded"]) == expect["unrecorded"], "; ".join(report["unrecorded"])
    if "divergence_after" in expect:
        assert report.get("divergence", {}).get("after") == expect["divergence_after"]
    if "error_matches" in expect:
        assert any(re.search(expect["error_matches"], json.dumps(e["data"])) for e in replay.events), \
            "no event carries the expected error"


def knowledge_entry_matches(wanted, entry):
    """Whether an entry is as a case describes it; what the description leaves out is not compared"""
    return (entry is not None
            and ("type" not in wanted or entry["type"] == wanted["type"])
            and ("node" not in wanted or entry["scope"].get("node_name") == wanted["node"])
            and ("status" not in wanted or entry["status"] == wanted["status"])
            and ("observations" not in wanted or entry["observations"] == wanted["observations"])
            and ("sources" not in wanted or len(entry["sources"]) == wanted["sources"])
            and ("reviewed_by" not in wanted
                 or (entry.get("reviewed_by") == wanted["reviewed_by"] and bool(entry.get("reviewed_at")))))


def shown(entries):
    return json.dumps([e and {"type": e["type"], "node": e["scope"].get("node_name"), "status": e["status"],
                              "observations": e["observations"], "sources": len(e["sources"])} for e in entries])


@pytest.mark.parametrize("case", KNOWLEDGE_CASES, ids=[c["id"] for c in KNOWLEDGE_CASES])
def test_knowledge(case):
    if case["level"] not in CLAIMED_LEVELS:
        pytest.skip(f"level '{case['level']}' is not claimed by the Python SDK")

    workflow = Workflow.model_validate(case["workflow"])
    knowledge = KnowledgeBase()
    journals = {}
    ingested = set()

    def one(wanted):
        """The one entry a step names"""
        found = [e for e in knowledge.list() if knowledge_entry_matches(wanted, e)]
        assert len(found) == 1, f"entries matching {json.dumps(wanted)} among {shown(knowledge.list())}"
        return found[0]

    for step in case["steps"]:
        if "ingest" in step:
            assert step["ingest"] in journals, f'run "{step["ingest"]}" has been performed'
            knowledge.ingest(workflow, journals[step["ingest"]])
            ingested.add(journals[step["ingest"]][0]["run_id"])
        elif "review" in step:
            knowledge.review(one(step["review"])["id"], step["by"])
        elif "deprecate" in step:
            knowledge.deprecate(one(step["deprecate"])["id"])
        else:
            # A run draws on the knowledge base as it stands; it is not ingested until a step says so
            actor = ConformanceActor(step.get("actors"))
            engine = WorkflowEngine(workflow, options={
                "actors": {actor_type: actor for actor_type in ActorType}, "knowledge": knowledge, "sleep": lambda ms: None})
            assert engine.run(step.get("input") or {})["status"] == step["expect"]["status"], f'status of run "{step["run"]}"'
            events = engine.get_events()
            for index, event in enumerate(events):
                check_journal_event(event, index + 1)
            journals[step["run"]] = events
            for name, wanted in step["expect"].get("given", {}).items():
                executions = [g for g in actor.given if g["activity"] == name]
                assert executions, f'executions of {name} in run "{step["run"]}"'
                for execution in executions:
                    entries = [knowledge.get(id) for id in execution["ids"]]
                    assert len(entries) == len(wanted) and all(
                        knowledge_entry_matches(w, e) for w, e in zip(wanted, entries)), \
                        f'{name} in run "{step["run"]}" was given {shown(entries)}, expected {json.dumps(wanted)}'
            for wanted in step["expect"].get("journal_contains", []):
                assert any(is_subset(wanted, e) for e in events), \
                    f'no event of run "{step["run"]}" matches {json.dumps(wanted)}'

    entries, expect = knowledge.list(), case["expect"]
    if "entry_count" in expect:
        assert len(entries) == expect["entry_count"], shown(entries)
    for wanted in expect.get("entries", []):
        assert len([e for e in entries if knowledge_entry_matches(wanted, e)]) == wanted.get("count", 1), \
            f"entries matching {json.dumps(wanted)} among {shown(entries)}"
    # Every entry is traceable: each source names a run that was ingested and events of its journal (15.2)
    for entry in entries:
        for source in entry["sources"]:
            assert source["run_id"] in ingested, f'{entry["id"]} cites run {source["run_id"]}, which was not ingested'
            journal = next(events for events in journals.values() if events[0]["run_id"] == source["run_id"])
            assert source["event_seqs"], f'{entry["id"]} cites events'
            for seq in source["event_seqs"]:
                assert any(e["seq"] == seq for e in journal), f'{entry["id"]} cites event {seq}'
