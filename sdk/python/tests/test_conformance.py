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
CLAIMED_LEVELS = {"interchange", "core", "decision", "verified", "recorded", "resilient", "contract", "flow", "events",
                  "tools", "model_decision", "routing", "journeys", "measures",
                  "replay", "contexts", "service_levels", "knowledge", "telemetry", "shared_store", "evidence", "evaluation", "a2a"}
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


def scripted_agents(agents):
    """
    Stands in for the agents a case scripts (level a2a): a GET of a card's URL answers with the card, and
    each JSON-RPC request to the interface the card names takes the agent's next reply, the last repeating.
    Any other address cannot be reached.
    """
    agents = agents or {}
    seen = {"requests": [], "card_reads": 0, "served": {}}

    def transport(method, url, headers, body):
        if method == "GET" and url in agents:
            seen["card_reads"] += 1
            return 200, json.dumps(agents[url]["card"])
        agent = next((card_url for card_url, script in agents.items()
                      if any(i.get("url") == url for i in script["card"].get("supportedInterfaces") or [])), None)
        if method != "POST" or agent is None:
            raise ConnectionRefusedError(f"connection refused: {url}")
        request = json.loads(body or "{}")
        seen["requests"].append({"agent": agent, "method": request.get("method"), "params": request.get("params")})
        n = seen["served"].get(agent, 0)
        seen["served"][agent] = n + 1
        replies = agents[agent]["replies"]
        return 200, json.dumps({"jsonrpc": "2.0", "id": request.get("id"), **replies[min(n, len(replies) - 1)]})

    return transport, seen


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
    agent_transport, agents = scripted_agents(case.get("agents"))
    engine = WorkflowEngine(Workflow.model_validate(case["workflow"]), options={
        "actors": {actor_type: actor for actor_type in ActorType},
        "a2a": {"transport": agent_transport, "poll_interval_ms": 0},
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
        elif "agent_input" in step:
            # The host gives every agent that asked for input what the case says (28.6)
            resumed = sum(1 for request in engine.agent_requests() if engine.answer_agent(request["token_id"], step["agent_input"]))
            if "resumes" in step:
                assert resumed == step["resumes"], "tokens given agent input"
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
    if "agent_card_reads" in expect:
        assert agents["card_reads"] == expect["agent_card_reads"], "agent cards read"
    if "agent_requests" in expect:
        assert [r["method"] for r in agents["requests"]] == expect["agent_requests"], "requests to agents"
    for wanted in expect.get("agent_requests_contain", []):
        assert any(is_subset(wanted, r) for r in agents["requests"]), f"no request to an agent matches {json.dumps(wanted)}: {agents['requests']}"
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


def expect_journeys(runtime, expect, journey_event_schema):
    """What a journey case expects of the journeys a host has recorded (Appendix A). Shared by the journey and shared store cases."""
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
        if "run_journal" in wanted or "run_journal_excludes" in wanted:
            events = runtime.export_journey(instance["id"])["runs"][0]["events"]
            for position, event in enumerate(events):
                check_journal_event(event, position + 1)
            types_in_journal = [e["type"] for e in events]
            assert in_order(wanted.get("run_journal", []), types_in_journal) == [], f"journal was: {', '.join(types_in_journal)}"
            for type in wanted.get("run_journal_excludes", []):
                assert type not in types_in_journal, f"journal was: {', '.join(types_in_journal)}"
    if "transitions" in expect:
        assert [{"from": names[t["from"]], "to": names[t["to"]], "count": t["count"]}
                for t in runtime.transitions()] == expect["transitions"]


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

    expect_journeys(runtime, case["expect"], journey_event_schema)


SHARED_STORE = [json.loads(p.read_text()) for p in sorted((CONFORMANCE / "shared-store").glob("*.json"))]


@pytest.fixture(scope="module")
def postgres():
    """One PostgreSQL for the shared store cases; each case has a database of its own"""
    from tests.postgres_helper import TestPostgres, postgres_unavailable
    reason = postgres_unavailable()
    if reason:
        pytest.skip(f"shared store cases need PostgreSQL: {reason}")
    server = TestPostgres()
    yield server
    server.stop()


@pytest.mark.parametrize("case", SHARED_STORE, ids=[c["id"] for c in SHARED_STORE])
def test_shared_store(case, postgres):
    """Several hosts on one store (section 29). Steps marked `together` are performed at once, one thread per host."""
    from concurrent.futures import ThreadPoolExecutor
    from awa.runtime.postgres_store import PostgresRuntimeStore
    if case["level"] not in CLAIMED_LEVELS:
        pytest.skip(f"level '{case['level']}' is not claimed by the Python SDK")

    url = postgres.database()
    clock = {"now": time_ms(case["start"])}
    actor = ConformanceActor(case.get("actors"), lambda ms: clock.__setitem__("now", clock["now"] + ms))
    stores = []

    def open_host(name):
        stopping = {"now": False}

        def before_commit():
            if stopping["now"]:
                raise RuntimeError(f"host {name} stopped")
        store = PostgresRuntimeStore(url, host_id=name, before_commit=before_commit)
        stores.append(store)
        runtime = AwaRuntime(now=lambda: clock["now"], shared=store,
                             engine={"actors": {actor_type: actor for actor_type in ActorType}, "sleep": lambda ms: None})
        for workflow in case["workflows"]:
            runtime.register_workflow(workflow)
        for journey in case["journeys"]:
            runtime.register_journey(journey)
        runtime.recover()
        return {"runtime": runtime, "store": store, "stopping": stopping}

    hosts = {name: open_host(name) for name in case["hosts"]}

    def stop(name):
        hosts.pop(name)["store"].close()

    def perform(step):
        """One host's step; what it counts towards the step's expectations"""
        host = hosts[step["host"]]
        if step.get("tick"):
            result = host["runtime"].tick()
            return {"timed_out_runs": len(result["timed_out_runs"]), "stalled_journeys": len(result["stalled_journeys"])}
        e = step["publish"]
        event = {"specversion": "1.0", "id": e.get("id") or f"evt-{uuid4()}", "source": "/conformance", "type": e["type"], "data": e.get("data", {})}
        if step.get("stops_before_keeping"):
            host["stopping"]["now"] = True
            with pytest.raises(RuntimeError, match="stopped"):
                host["runtime"].publish(event)
            stop(step["host"])
            return {}
        return {"accepted": host["runtime"].publish(event)["accepted"]}

    def check(wanted, results):
        if not wanted:
            return
        if "accepted" in wanted:
            got = results[0]["accepted"] if isinstance(wanted["accepted"], bool) else sum(1 for r in results if r.get("accepted"))
            assert got == wanted["accepted"], "accepted"
        for key in ("timed_out_runs", "stalled_journeys"):
            if key in wanted:
                assert sum(r.get(key, 0) for r in results) == wanted[key], key

    try:
        for step in case["steps"]:
            if "advance" in step:
                clock["now"] += parse_iso_duration(step["advance"])
            elif "stop" in step:
                stop(step["stop"])
            elif "start" in step:
                hosts[step["start"]] = open_host(step["start"])
            elif "together" in step:
                with ThreadPoolExecutor(max_workers=len(step["together"])) as pool:
                    check(step.get("expect"), list(pool.map(perform, step["together"])))
            else:
                check(step.get("expect"), [perform(step)])
        # What the store keeps, read by a host that took no part
        reader = open_host("reader")
        reader["runtime"].refresh()
        stats = reader["store"].stats()
        expect = case["expect"]
        if "accepted_events" in expect:
            assert stats["accepted_events"] == expect["accepted_events"], "events accepted"
        if "run_count" in expect:
            assert stats["runs"] == expect["run_count"], "runs kept"
        # Every journal is numbered from 1 without a gap, whichever host wrote which part
        for engine in reader["runtime"].list_runs():
            assert [e["seq"] for e in engine.get_events()] == list(range(1, len(engine.get_events()) + 1))
        expect_journeys(reader["runtime"], expect, schema_validator("journey-event.schema.json"))
    finally:
        for store in stores:
            store.close()


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
# Telemetry (specification section 26)
# ---------------------------------------------------------------------------

from awa.runtime.kpi import MEASURES  # noqa: E402
from awa.runtime.telemetry import (  # noqa: E402
    gauges_to_otlp_json, journey_spans, measures_to_gauges, run_spans, spans_to_otlp_json, time_ms as telemetry_ms,
)

TELEMETRY_CASES = [json.loads(p.read_text()) for p in sorted((CONFORMANCE / "telemetry").glob("*.json"))]


def _sorted_attributes(value):
    """Attribute lists in any order: sorted by key at every depth"""
    if isinstance(value, list):
        return [_sorted_attributes(v) for v in value]
    if not isinstance(value, dict):
        return value
    return {k: (sorted((_sorted_attributes(a) for a in v), key=lambda a: a["key"]) if k == "attributes" and isinstance(v, list)
                else _sorted_attributes(v)) for k, v in value.items()}


def _same_value(got, want):
    """JSON equality, which keeps booleans apart from numbers and integers apart from fractions"""
    return json.dumps(got, sort_keys=True) == json.dumps(want, sort_keys=True)


@pytest.mark.parametrize("case", TELEMETRY_CASES, ids=[c["id"] for c in TELEMETRY_CASES])
def test_telemetry(case):
    if case["level"] not in CLAIMED_LEVELS:
        pytest.skip(f"level '{case['level']}' is not claimed by the Python SDK")
    expect = case["expect"]

    if "report" in case:
        report = case["report"]
        request = gauges_to_otlp_json(measures_to_gauges(report, MEASURES), report)
        metrics = request["resourceMetrics"][0]["scopeMetrics"][0]["metrics"]
        assert len(metrics) == expect["metric_count"]
        names = [m["name"] for m in metrics]
        for name in expect.get("absent", []):
            assert name not in names
        for want in expect["metrics"]:
            got = next(m for m in metrics if m["name"] == want["name"])
            assert got["unit"] == want["unit"], want["name"]
            points = [{"attributes": {a["key"]: a["value"]["stringValue"] for a in p["attributes"]}, "value": p["asDouble"]}
                      for p in got["gauge"]["dataPoints"]]
            assert points == want["points"], want["name"]
            for p in got["gauge"]["dataPoints"]:
                assert p["timeUnixNano"] == str(telemetry_ms(expect["time"]) * 1_000_000)
                assert p["startTimeUnixNano"] == str(telemetry_ms(expect["start_time"]) * 1_000_000)
        return

    payloads = (case.get("options") or {}).get("payloads", False)
    spans = run_spans(case["decision_nodes"], case["journal"], payloads) if "journal" in case else journey_spans(case["journey"], payloads)
    assert len(spans) == expect["span_count"]
    assert {s.trace_id for s in spans} == {expect["trace_id"]}
    if "otlp_json" in expect:
        assert _sorted_attributes(spans_to_otlp_json(spans)) == _sorted_attributes(expect["otlp_json"])
    for want in expect.get("spans", []):
        matching = [s for s in spans if s.span_id == want["span_id"]]
        assert len(matching) == 1, f"span {want['span_id']}"
        got = matching[0]
        where = f"{got.name} ({got.span_id})"
        if "parent_span_id" in want:
            assert got.parent_span_id == want["parent_span_id"], f"{where} parent"
        if "name" in want:
            assert got.name == want["name"]
        if "kind" in want:
            assert got.kind == want["kind"], f"{where} kind"
        if "start" in want:
            assert got.start_ms == telemetry_ms(want["start"]), f"{where} start"
        if "end" in want:
            assert got.end_ms == telemetry_ms(want["end"]), f"{where} end"
        if "status" in want:
            assert got.status["code"] == want["status"], f"{where} status"
        if "status_message" in want:
            assert got.status.get("message") == want["status_message"], f"{where} status message"
        for key, value in want.get("attributes", {}).items():
            assert key in got.attributes and _same_value(got.attributes[key], value), f"{where} {key}: {got.attributes.get(key)!r} != {value!r}"
        for key in want.get("absent", []):
            assert key not in got.attributes, f"{where} has {key}"
        if "events" in want:
            assert [e.name for e in got.events] == want["events"], f"{where} events"
        for e in want.get("events_contain", []):
            found = [x for x in got.events if x.name == e["name"]
                     and all(k in x.attributes and _same_value(x.attributes[k], v) for k, v in e.get("attributes", {}).items())
                     and all(k not in x.attributes for k in e.get("absent", []))]
            assert found, f"{where}: no event {e} among {[(x.name, x.attributes) for x in got.events]}"
        if "links" in want:
            assert [{"trace_id": l["trace_id"], "span_id": l["span_id"]} for l in got.links] == want["links"], f"{where} links"


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


# ---------------------------------------------------------------------------
# Evidence (specification section 32) and evaluation from journals (section 33)
# ---------------------------------------------------------------------------

from awa.runtime.evaluation import build_dataset, evaluate_dataset  # noqa: E402
from awa.runtime.evidence import compute_evidence, unresolved_citations  # noqa: E402

EVIDENCE_CASES = [json.loads(p.read_text()) for p in sorted((CONFORMANCE / "evidence").glob("*.json"))]
EVALUATION_CASES = [json.loads(p.read_text()) for p in sorted((CONFORMANCE / "evaluation").glob("*.json"))]


@pytest.mark.parametrize("case", EVIDENCE_CASES, ids=[c["id"] for c in EVIDENCE_CASES])
def test_evidence(case):
    if case["level"] not in CLAIMED_LEVELS:
        pytest.skip(f"level '{case['level']}' is not claimed by the Python SDK")
    report = compute_evidence(case["recorded"], case.get("options"))
    assert [e.message for e in schema_validator("evidence-report.schema.json").iter_errors(report)] == []
    # Every statement rests on records that exist (32.2)
    assert unresolved_citations(report, case["recorded"]) == []
    parts = {p["id"]: p for p in report["parts"]}
    expect = case["expect"]
    for id, summary in expect.get("summaries", {}).items():
        assert is_subset(summary, parts[id]["summary"]), f"summary of {id}: {json.dumps(parts[id]['summary'])}"
    for want in expect.get("statements", []):
        found = [s for s in parts[want["part"]]["statements"] if s["kind"] == want["kind"] and is_subset(want["facts"], s["facts"])]
        assert len(found) == 1, f"{want['part']}/{want['kind']} {json.dumps(want['facts'])} among {json.dumps([s['facts'] for s in parts[want['part']]['statements']])}"
        if "citations" in want:
            def key(citations):
                return sorted(json.dumps(c, sort_keys=True) for c in citations)
            assert key(found[0]["citations"]) == key(want["citations"]), f"citations of {want['part']}/{want['kind']} {json.dumps(want['facts'])}"
    for want in expect.get("absent", []):
        assert [s for s in parts[want["part"]]["statements"] if s["kind"] == want["kind"] and is_subset(want["facts"], s["facts"])] == []
    if "cited_runs" in expect:
        cited = {c["run_id"] for p in report["parts"] for s in p["statements"] for c in s["citations"] if "run_id" in c}
        assert sorted(cited) == sorted(expect["cited_runs"])


@pytest.mark.parametrize("case", EVALUATION_CASES, ids=[c["id"] for c in EVALUATION_CASES])
def test_evaluation(case):
    if case["level"] not in CLAIMED_LEVELS:
        pytest.skip(f"level '{case['level']}' is not claimed by the Python SDK")
    expect = case["expect"]
    if case["kind"] == "build":
        built = build_dataset(case["journals"])
        validator = schema_validator("evaluation-case.schema.json")
        for c in built["cases"]:
            assert [e.message for e in validator.iter_errors(c)] == []
        assert len(built["cases"]) == expect["case_count"], [c["id"] for c in built["cases"]]
        assert len(built["skipped"]) == expect["skipped"], built["skipped"]
        for want in expect["cases"]:
            got = next((c for c in built["cases"] if c["id"] == want["id"]), None)
            assert got is not None, f"case {want['id']}"
            for key, value in want.items():
                assert got.get(key, "absent") == value, f"{want['id']}.{key}: {got.get(key, 'absent')!r}"
        return

    def engine_for_case(k):
        scripts = {name: script.get("cases", {}).get(k["id"], script) for name, script in case["candidate_actors"].items()}
        return {"actors": {ActorType.ai_agent: ConformanceActor(scripts)}}
    report = evaluate_dataset(Workflow.model_validate(case["workflow"]), case["dataset"],
                              candidate=Workflow.model_validate(case["candidate"]) if "candidate" in case else None,
                              engine={"sleep": lambda ms: None}, engine_for_case=engine_for_case)
    assert [e.message for e in schema_validator("evaluation-report.schema.json").iter_errors(report)] == []
    for key in ("evaluated",):
        if key in expect:
            assert report[key] == expect[key]
    for key in ("skipped", "regressions", "improvements"):
        if key in expect:
            assert len(report[key]) == expect[key], json.dumps(report[key])

    def same(got, want):
        if want is None:
            return got is None
        if isinstance(want, (int, float)) and not isinstance(want, bool):
            return isinstance(got, (int, float)) and not isinstance(got, bool) and abs(got - want) < 1e-9
        return got == want
    for name, want in expect.get("activities", {}).items():
        got = next((a for a in report["activities"] if a["activity_name"] == name), None)
        assert got is not None, f"activity {name}"
        for key, value in want.items():
            actual = got[key]["value"] if isinstance(got[key], dict) and "value" in got[key] else got[key]
            assert same(actual, value), f"{name}.{key}: got {actual!r}, expected {value!r}"
    for case_id, want in expect.get("results", {}).items():
        got = next((r for r in report["results"] if r["case_id"] == case_id), None)
        assert got is not None, f"result of {case_id}"
        for key, value in want.items():
            actual = len(got["unrecorded"]) if key == "unrecorded" else got[key]
            assert actual == value if not isinstance(value, bool) else actual is value, f"{case_id}.{key}: got {actual!r}"


# ---------------------------------------------------------------------------
# Level interchange (specification section 27)
# ---------------------------------------------------------------------------

INTERCHANGE_CASES = [json.loads(p.read_text()) for p in sorted((CONFORMANCE / "interchange").glob("*.json"))]
FEEL = json.loads((CONFORMANCE / "feel.json").read_text())


@pytest.mark.parametrize("case", INTERCHANGE_CASES, ids=[c["id"] for c in INTERCHANGE_CASES])
def test_interchange(case):
    from awa.interchange import InterchangeError, export_bpmn, export_serverless_workflow, import_bpmn, import_dmn
    from awa.interchange.common import json_equal

    if case["level"] not in CLAIMED_LEVELS:
        pytest.skip(f"level '{case['level']}' is not claimed by the Python SDK")
    expect = case["expect"]
    if "error_matches" in expect:
        with pytest.raises(InterchangeError, match=expect["error_matches"]):
            if case["kind"] == "import_dmn":
                import_dmn(case["dmn"])
            else:
                import_bpmn(case["bpmn"], case.get("dmn"))
        return
    if case["kind"] == "import_bpmn":
        assert import_bpmn(case["bpmn"], case.get("dmn")).documents == expect["documents"]
    elif case["kind"] == "import_dmn":
        assert import_dmn(case["dmn"])[0] == expect["decisions"]
    elif case["kind"] == "round_trip":
        exported = export_bpmn([case["workflow"]])
        back = import_bpmn(exported.bpmn, [exported.dmn] if exported.dmn else [])
        assert json_equal(back.documents[0], case["workflow"])
    elif case["kind"] == "export_serverless_workflow":
        result = export_serverless_workflow(case["workflow"])
        assert result.document == expect["document"]
        assert result.not_mapped == expect["not_mapped"]
    else:
        raise AssertionError(f"unknown kind {case['kind']}")


def _interchange_claimed():
    if "interchange" not in CLAIMED_LEVELS:
        pytest.skip("level 'interchange' is not claimed by the Python SDK")


@pytest.mark.parametrize("case", FEEL["unary"], ids=[c["feel"] for c in FEEL["unary"]])
def test_feel_unary_tests(case):
    from awa.interchange import feel_unary_to_awa
    _interchange_claimed()
    assert feel_unary_to_awa(case["feel"]) == case["awa"]


@pytest.mark.parametrize("text", FEEL["unary_invalid"])
def test_feel_unary_tests_refused(text):
    from awa.interchange import InterchangeError, feel_unary_to_awa
    _interchange_claimed()
    with pytest.raises(InterchangeError, match="FEEL"):
        feel_unary_to_awa(text)


@pytest.mark.parametrize("case", FEEL["unary_export"], ids=[c["awa"] for c in FEEL["unary_export"]])
def test_feel_unary_export(case):
    from awa.interchange import awa_unary_to_feel
    _interchange_claimed()
    assert awa_unary_to_feel(case["awa"], case.get("type")) == case["feel"]


@pytest.mark.parametrize("case", FEEL["conditions"], ids=[c["bpmn"] for c in FEEL["conditions"]])
def test_feel_conditions(case):
    from awa.interchange import feel_condition_to_awa
    _interchange_claimed()
    assert feel_condition_to_awa(case["bpmn"]) == case["awa"]


@pytest.mark.parametrize("text", FEEL["conditions_invalid"])
def test_feel_conditions_refused(text):
    from awa.interchange import InterchangeError, feel_condition_to_awa
    _interchange_claimed()
    with pytest.raises(InterchangeError, match="cannot be read"):
        feel_condition_to_awa(text)


@pytest.mark.parametrize("case", FEEL["conditions_export"], ids=[c["awa"] for c in FEEL["conditions_export"]])
def test_feel_conditions_export(case):
    from awa.interchange import awa_condition_to_feel
    _interchange_claimed()
    assert awa_condition_to_feel(case["awa"]) == case["feel"]
