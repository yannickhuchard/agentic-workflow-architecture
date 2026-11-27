"""
The electricity onboarding example (examples/electricity-onboarding): every document validates, and every
scenario runs to its end with the scripted actors, from the same documents, the same actors.json and the
same scenario files as sdk/typescript/tests/electricity_onboarding.test.ts. Follows scenarios/play.mjs.

The tools really run: the reference adapters (adapters/mock-server.mjs) are started on a free port of this
machine with Node, and the calls go to them over HTTP. Nothing leaves localhost. Without Node the scenarios
are skipped; the documents are still checked.
"""

import copy
import json
import re
import shutil
import subprocess
import time
from pathlib import Path

import pytest

from awa.cli.deployment import load_deployment
from awa.runtime.authorization import AuthorizationError, principal_named
from awa.runtime.business_event import business_event
from awa.runtime.evidence import compute_evidence, render_evidence_html, render_evidence_markdown
from awa.runtime.evidence_sources import read_evidence_input
from awa.runtime.journal import InMemoryJournalStore
from awa.runtime.journey import parse_journey, validate_journey
from awa.runtime.models import FunctionModelProvider
from awa.runtime.runtime_host import AwaRuntime
from awa.runtime.tools import BUILT_IN_EXECUTORS
from awa.types import Workflow
from awa.validator import validate_workflow_integrity

ROOT = Path(__file__).resolve().parents[3]
EXAMPLE = ROOT / "examples" / "electricity-onboarding"
read = lambda name: json.loads((EXAMPLE / name).read_text())  # noqa: E731

ONBOARDING = read("electricity-onboarding.awa.json")
GRID = read("grid-export-registration.awa.json")
JOURNEY = read("new-customer-onboarding.journey.json")
DEPLOYMENT = load_deployment(str(EXAMPLE / "deployment.json"))
SCRIPTS = read("scenarios/actors.json")
SCENARIOS = [json.loads(p.read_text()) for p in sorted((EXAMPLE / "scenarios").glob("[a-z]-*.json"))]
SECRETS = {name: f"demo-{name.lower().replace('_', '-')}" for name in
           ["CRM_TOKEN", "NOTIFY_TOKEN", "DOCUMENTS_API_KEY", "CREDIT_BUREAU_TOKEN", "REGISTRY_TOKEN", "TARIFF_API_KEY",
            "GRID_OPERATOR_TOKEN", "CONTRACTS_TOKEN"]}


# ---------------------------------------------------------------------------
# The documents
# ---------------------------------------------------------------------------

def test_every_document_of_the_example_is_valid():
    for document in (ONBOARDING, GRID):
        workflow = Workflow.model_validate(document)
        result = validate_workflow_integrity(workflow)
        assert result.valid, [e.message for e in result.errors]
    journey = parse_journey(JOURNEY)
    assert validate_journey(journey, {ONBOARDING["id"], GRID["id"]}, True) == []
    # The deployment loads: principals, policy and guardrails
    assert {p["id"] for p in DEPLOYMENT["authorization"]["principals"]} >= {"olivia", "gabriel", "hana", "marco"}
    assert len(DEPLOYMENT["guardrails"]) == 2
    # Every call activity names the workflow it runs, and the scenarios cover the cases the example promises
    call = next(a for a in ONBOARDING["activities"] if a.get("is_expandable"))
    assert call["expansion_workflow_id"] == GRID["id"]
    assert len(SCENARIOS) >= 7


# ---------------------------------------------------------------------------
# Placeholders: the same rules as scenarios/play.mjs
# ---------------------------------------------------------------------------

MISSING = object()


def _resolve(scope, path):
    if path == "null":
        return None
    if re.fullmatch(r"-?\d+(\.\d+)?", path):
        return float(path) if "." in path else int(path)
    value = scope
    for part in path.split("."):
        if isinstance(value, dict) and part in value:
            value = value[part]
        elif isinstance(value, list) and part.isdigit() and int(part) < len(value):
            value = value[int(part)]
        else:
            return MISSING
    return value


def _evaluate(scope, expression):
    for alternative in (s.strip() for s in expression.split("|")):
        value = _resolve(scope, alternative)
        if value is not MISSING:
            return value
    return MISSING


def _text(value):
    if value is MISSING or value is None:
        return ""
    if isinstance(value, bool):
        return "true" if value else "false"
    if isinstance(value, float) and value.is_integer():
        return str(int(value))
    if isinstance(value, (dict, list)):
        return json.dumps(value, separators=(",", ":"), ensure_ascii=False)
    return str(value)


def fill(template, scope):
    if isinstance(template, str):
        whole = re.fullmatch(r"\{\{([^{}]+)\}\}", template)
        if whole:
            return _evaluate(scope, whole.group(1))
        return re.sub(r"\{\{([^{}]+)\}\}", lambda m: _text(_evaluate(scope, m.group(1))), template)
    if isinstance(template, list):
        return [v for v in (fill(t, scope) for t in template) if v is not MISSING]
    if isinstance(template, dict):
        if "$map" in template:
            items = _evaluate(scope, template["$map"])
            return [fill(template["to"], {**scope, "item": item}) for item in items] if isinstance(items, list) else []
        if "$find" in template:
            items = _evaluate(scope, template["$find"])
            where = fill(template.get("where") or {}, scope)
            found = next((i for i in items if all(_resolve(i, k) == v for k, v in where.items())), MISSING) if isinstance(items, list) else MISSING
            return MISSING if found is MISSING else _resolve(found, template["get"])
        out = {}
        for key, value in template.items():
            filled = fill(value, scope)
            if filled is not MISSING:
                out[key] = filled
        return out
    return template


def duration_ms(text):
    if not text:
        return 0
    m = re.fullmatch(r"P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+(?:\.\d+)?)S)?)?", text)
    w, d, h, mi, s = (float(x or 0) for x in m.groups())
    return int(((((w * 7 + d) * 24 + h) * 60 + mi) * 60 + s) * 1000)


def script_for(scenario, name, attempt=1):
    base, own = SCRIPTS["activities"].get(name), ((scenario or {}).get("actors") or {}).get(name)
    if base is None and own is None:
        return None

    def merge(a, b):
        a, b = a or {}, b or {}
        merged = {**a, **b}
        if "output" in a or "output" in b:
            merged["output"] = {**(a.get("output") or {}), **(b.get("output") or {})}
        if "agent" in a or "agent" in b:
            merged["agent"] = {**(a.get("agent") or {}), **(b.get("agent") or {})}
        return merged

    entry = merge(base, own)
    attempts = entry.get("attempts")
    return merge(entry, attempts[min(attempt, len(attempts)) - 1]) if attempts else entry


def test_placeholders_follow_the_typescript_rules():
    scope = {"a": {"b": 6.0, "c": [1, 2]}, "t": True, "items": [{"plan": "x", "cost": 3}, {"plan": "y", "cost": 4}]}
    assert fill("{{a.b}}", scope) == 6.0
    assert fill("{{a.b}} kW, {{t}}", scope) == "6 kW, true"
    assert fill({"k": "{{missing}}", "j": "{{missing|null}}", "n": "{{missing|a.c}}"}, scope) == {"j": None, "n": [1, 2]}
    assert fill({"$find": "items", "where": {"plan": "y"}, "get": "cost"}, scope) == 4
    assert fill({"$map": "items", "to": {"p": "{{item.plan}}"}}, scope) == [{"p": "x"}, {"p": "y"}]


# ---------------------------------------------------------------------------
# The scripted world
# ---------------------------------------------------------------------------

class Clock:
    def __init__(self, start):
        self.now = start

    def tick(self):
        self.now += 250
        return self.now

    def today(self):
        return time.strftime("%Y-%m-%d", time.gmtime(self.now / 1000))


class ScriptedActor:
    """Does what actors.json and the scenario say, calling the tools for real"""

    def __init__(self, clock, scenario_of):
        self.clock, self.scenario_of = clock, scenario_of

    def execute(self, activity, token, context=None):
        inputs = dict(token.context_data)
        scenario = self.scenario_of(inputs.get("application_id"))
        entry = script_for(scenario, activity.name, int(inputs.get("_attempt") or 1))
        if entry is None:
            raise ValueError(f'No script for "{activity.name}"')
        self.clock.now += duration_ms(entry.get("takes"))
        scope = {**inputs, "scenario": scenario, "today": self.clock.today()}
        for call in entry.get("calls") or []:
            if call.get("each"):
                items = _evaluate(scope, call["each"])
                results = []
                for item in items if isinstance(items, list) else []:
                    result = context.tools.call(call["tool"], fill(call["arguments"], {**scope, "item": item}))
                    results.append(result.result if result.ok else {"error": result.result})
                scope[call["as"]] = results
            else:
                result = context.tools.call(call["tool"], fill(call["arguments"], scope))
                scope[call["as"]] = result.result if result.ok else {"error": result.result}
        output = fill(entry.get("output") or {}, scope)
        writes = {"_context_writes": fill(entry["writes"], scope)} if entry.get("writes") else {}
        if activity.actor_type.value != "ai_agent":
            return {**output, **writes}
        agent = entry.get("agent") or {}
        return {
            "output": output, **writes,
            "usage": {"input_tokens": agent.get("input_tokens", 0), "output_tokens": agent.get("output_tokens", 0)},
            "_model": {"id": f"{agent.get('tier')}-model", "provider": "scripted", "requested": f"tier:{agent.get('tier')}",
                       "tier": agent.get("tier"), "source": "role", "temperature": 0.2},
            "_reasoning": {"plan": agent.get("plan", []), "rationale": agent.get("rationale", ""), "confidence": agent.get("confidence", 0.9)},
        }


class Person:
    """A person's task waits for a step of the scenario to answer it"""

    def execute(self, activity, token, context=None):
        return {"_requires_human_action": True, "_human_task_id": f"{token.context_data.get('application_id')}:{activity.name}"}


def scripted_decisions(clock):
    def decide(request):
        prompt = request.prompt or ""
        name = re.search(r"^Decision: (.+)$", prompt, re.M).group(1)
        script = SCRIPTS["decisions"][name]
        clock.now += duration_ms(script.get("takes"))
        fact = re.search(rf"^- {script['by_fact']}: (.+)$", prompt, re.M)
        return json.dumps(script["replies"].get(fact.group(1) if fact else "", script["default"]))
    return decide


class WatchingJournal(InMemoryJournalStore):
    """Keeps the tasks waiting for a person, in every run and child run"""

    def __init__(self):
        super().__init__()
        self.tasks = {}

    def append(self, event):
        if event["type"] == "token.waiting" and (event.get("data") or {}).get("reason") == "human_task":
            self.tasks[event["token_id"]] = {"run_id": event["run_id"], "token_id": event["token_id"], "node_name": event.get("node_name"),
                                             "task": event["data"].get("human_task_id")}
        elif event["type"] in ("token.resumed", "token.cancelled", "token.failed") or (event["type"] == "activity.completed" and event.get("token_id") in self.tasks):
            self.tasks.pop(event.get("token_id"), None)
        super().append(event)


@pytest.fixture(scope="module")
def adapters():
    """The reference adapters, started with Node on a free port"""
    node = shutil.which("node")
    if not node:
        pytest.skip("Node is needed to run the reference adapters")
    process = subprocess.Popen([node, str(EXAMPLE / "adapters" / "mock-server.mjs"), "--port", "0"], stdout=subprocess.PIPE, text=True)
    line = process.stdout.readline()
    port = int(re.search(r":(\d+)\s*$", line).group(1))
    yield port
    process.terminate()
    process.wait(timeout=10)


def executors(port):
    """The built-in executors, sent to where the adapters listen instead of the address the documents name"""
    def moved(binding):
        field = "url" if binding.kind == "http" else "endpoint"
        return binding.model_copy(update={field: getattr(binding, field).replace("localhost:4545", f"127.0.0.1:{port}")})
    return {kind: (lambda run: lambda binding, args, context: run(moved(binding), args, context))(BUILT_IN_EXECUTORS[kind]) for kind in ("http", "jsonrpc")}


def host(port, clock, journal, extra=()):
    by_application = {s["application"]["application_id"]: s for s in [*SCENARIOS, *extra]}
    actor = ScriptedActor(clock, by_application.get)
    runtime = AwaRuntime(now=lambda: clock.now, engine={
        "actors": {"application": actor, "ai_agent": actor, "robot": actor, "human": Person()},
        "wait_for_human_tasks": True, "journal": journal, "now": clock.tick, "sleep": lambda ms: setattr(clock, "now", clock.now + ms),
        "tools": {"allowed_hosts": ["localhost:4545", f"127.0.0.1:{port}"], "secrets": SECRETS, "executors": executors(port)},
        "authorization": DEPLOYMENT["authorization"], "guardrails": DEPLOYMENT["guardrails"],
        "model_providers": [FunctionModelProvider("scripted", scripted_decisions(clock))],
        "model_tiers": {"fast": "scripted:fast-model", "balanced": "scripted:balanced-model", "reasoning": "scripted:reasoning-model"},
        "pricing_config": {"input_token_cost_per_1k": 0.003, "output_token_cost_per_1k": 0.015, "currency": "EUR", "software_cost_per_execution": 0.001},
    })
    runtime.register_workflow(GRID).register_workflow(ONBOARDING).register_journey(JOURNEY)
    return runtime


def play(runtime, journal, clock, scenario):
    application_id = scenario["application"]["application_id"]
    authorization = DEPLOYMENT["authorization"]

    def publish(type, data, source):
        runtime.publish(business_event(type, {"application_id": application_id, **data}, source=source))

    publish("onboarding.requested", copy.deepcopy(scenario["application"]), "/customer-portal/apply")
    for step in scenario["steps"]:
        clock.now += duration_ms(step.get("after"))
        if step.get("publish"):
            publish(step["publish"], fill(step.get("data") or {}, {"today": clock.today(), "application": scenario["application"]}), step.get("source", "/customer-portal"))
        elif step.get("tick"):
            runtime.tick()
        elif step.get("complete"):
            task = next((t for t in journal.tasks.values() if t["node_name"] == step["complete"] and t["task"].startswith(f"{application_id}:")), None)
            assert task, f'{scenario["name"]}: nobody is waiting at "{step["complete"]}"'
            try:
                runtime.resume(task["run_id"], task["token_id"], step.get("output") or {}, principal_named(authorization, step["by"]))
                assert not step.get("refused"), f'{step["by"]} was expected to be refused'
            except AuthorizationError as error:
                assert step.get("refused"), f"{step['by']} was refused: {error}"
                assert error.decision.get("reason") == step["refused"]
    return next(i for i in runtime.list_journey_instances() if i["subject_key"] == application_id)


def _matches(actual, wanted):
    if not isinstance(wanted, (dict, list)):
        return actual == wanted
    if isinstance(wanted, list):
        return isinstance(actual, list) and len(actual) == len(wanted) and all(_matches(a, w) for a, w in zip(actual, wanted))
    return isinstance(actual, dict) and all(_matches(actual.get(k, MISSING), v) for k, v in wanted.items())


def check_expectations(scenario, instance, runs):
    expect, problems = scenario.get("expect") or {}, []
    main = next(r for r in instance["runs"] if r["workflow_id"] == ONBOARDING["id"] and not r.get("parent_run_id"))
    events = [e for r in runs for e in r["events"]]
    if expect.get("run_status") and main["status"] != expect["run_status"]:
        problems.append(f"run status {main['status']}, expected {expect['run_status']}")
    if expect.get("journey_status") and instance["status"] != expect["journey_status"]:
        problems.append(f"journey status {instance['status']}")
    if expect.get("journey_stage") and instance["stage_id"] != expect["journey_stage"]:
        problems.append(f"journey stage {instance['stage_id']}")
    if "stalled" in expect and bool(instance.get("stalled")) != expect["stalled"]:
        problems.append(f"stalled {instance.get('stalled')}")
    problems += [f"goal {g} not reached" for g in expect.get("goals", []) if g not in instance["goals_reached"]]
    for wanted in expect.get("records", []):
        wanted = dict(wanted)
        count = wanted.pop("count", None)
        n = sum(1 for e in events if _matches(e, wanted))
        if (n < 1) if count is None else (n != count):
            problems.append(f"{n} record(s) like {wanted}")
    problems += [f"unexpected {u}" for u in expect.get("absent", []) if any(_matches(e, u) for e in events)]
    problems += [f"no journey record like {w}" for w in expect.get("journey_records", []) if not any(_matches(e, w) for e in instance["events"])]
    return problems


@pytest.mark.parametrize("scenario", SCENARIOS, ids=[s["name"] for s in SCENARIOS])
def test_each_scenario_runs_to_its_end(adapters, scenario):
    clock = Clock(1793955600000)  # 2026-11-02T09:00:00Z
    journal = WatchingJournal()
    runtime = host(adapters, clock, journal)
    instance = play(runtime, journal, clock, scenario)
    runs = runtime.export_journey(instance["id"])["runs"]
    assert check_expectations(scenario, instance, runs) == []
    events = [e for r in runs for e in r["events"]]
    # The key events the example promises, beyond what each scenario states
    has_generation = scenario["application"]["has_generation"]
    assert any(e["type"] == "subworkflow.started" for e in events) == (has_generation and scenario["name"] != "declined")
    if has_generation:
        child = next(r for r in instance["runs"] if r.get("parent_run_id"))
        assert child["workflow_id"] == GRID["id"] and child["status"] == "completed"
    # Every tool call was made through the runner: invoked, then completed or failed, with its link
    invoked = {e["data"]["call_id"] for e in events if e["type"] == "tool.invoked"}
    ended = {e["data"]["call_id"] for e in events if e["type"] in ("tool.completed", "tool.failed")}
    assert invoked and invoked <= ended
    assert all(e["data"]["link"].startswith("http://localhost:4545/") for e in events if e["type"] == "tool.invoked")


def test_an_installation_that_is_not_valid_is_refused_without_registration(adapters):
    """Small wind, but the verifier finds the installation not valid while every document is legible and it is sure"""
    small_wind = next(s for s in SCENARIOS if s["name"] == "small-wind")
    invalid = {
        **copy.deepcopy(small_wind), "name": "small-wind-invalid",
        "application": {**copy.deepcopy(small_wind["application"]), "application_id": "APP-24903"},
        "actors": {
            **copy.deepcopy(small_wind["actors"]),
            "Verify installation documents": {"output": {
                "installation_valid": False, "serials_match": True, "confidence": 0.95,
                "notes": "The compliance certificate is for a turbine model that is not certified for export at this connection."}},
        },
        "expect": {
            "run_status": "completed", "journey_status": "completed",
            "records": [
                {"type": "subworkflow.completed", "node_name": "Register grid export", "data": {"output": {"export_status": "not_approved"}}},
                {"type": "activity.completed", "node_name": "Record export refusal"},
            ],
            "absent": [
                {"type": "decision.evaluated", "node_name": "Classify installation"},
                {"type": "activity.started", "node_name": "Send simplified notification"},
                {"type": "activity.started", "node_name": "Register export meter and tariff"},
                {"type": "contract.escalated", "node_name": "Verify installation documents"},
            ],
        },
    }
    clock, journal = Clock(1793955600000), WatchingJournal()
    runtime = host(adapters, clock, journal, [invalid])
    instance = play(runtime, journal, clock, invalid)
    runs = runtime.export_journey(instance["id"])["runs"]
    assert check_expectations(invalid, instance, runs) == []
    child = next(r for r in instance["runs"] if r.get("parent_run_id"))
    assert child["workflow_id"] == GRID["id"] and child["status"] == "completed"
    # From the verifier, the token takes the default edge to the refusal, and ends at "Export not registered"
    events = next(r for r in runs if r["run_id"] == child["run_id"])["events"]
    assert [(e["node_name"], e["data"]["reason"]) for e in events if e["type"] == "token.moved"] == [
        ("Verify installation documents", "unconditional"), ("Record export refusal", "default"), ("Export not registered", "unconditional")]


def test_a_compensation_handler_is_given_the_tools_it_declares():
    """Without the example: the handler's call is checked, made and journalled like any activity's (13.6, 17.3)"""
    from awa.runtime.workflow_engine import WorkflowEngine
    ids = [f"00000000-0000-4000-8000-{n:012d}" for n in range(7)]
    workflow = Workflow.model_validate({
        "id": ids[1], "name": "Book and fail", "version": "1.0.0", "awa_version": "1.1",
        "roles": [{"id": ids[2], "name": "System", "actor_type": "application"}],
        "activities": [
            {"id": ids[3], "name": "Book", "role_id": ids[2], "actor_type": "application", "compensation": {"activity_id": ids[5]}},
            {"id": ids[4], "name": "Fail", "role_id": ids[2], "actor_type": "application"},
            {"id": ids[5], "name": "Cancel booking", "role_id": ids[2], "actor_type": "application",
             "tools": [{"name": "cancel", "description": "Cancel a booking", "binding": {"kind": "function", "name": "cancel"},
                        "parameters": {"type": "object", "required": ["booking"], "properties": {"booking": {"type": "string"}}}}]},
        ],
        "edges": [{"id": ids[6], "source_id": ids[3], "target_id": ids[4]}],
    })
    cancelled = []

    class Actor:
        def execute(self, activity, token, context=None):
            if activity.name == "Book":
                return {"booking": "B-1"}
            if activity.name == "Fail":
                raise ValueError("Nothing more can be done")
            return {"cancelled": context.tools.call("cancel", {"booking": token.context_data["booking"]}).ok}

    engine = WorkflowEngine(workflow, options={"actors": {"application": Actor()}, "log_execution": False,
                                               "tools": {"handlers": {"cancel": lambda args: cancelled.append(args) or {"ok": True}}}})
    engine.start({})
    engine.run()
    assert cancelled == [{"booking": "B-1"}]
    events = engine.get_events()
    assert [e["type"] for e in events if e.get("node_name") == "Cancel booking"] == ["tool.invoked", "tool.completed", "activity.compensated"]
    completed = next(e for e in events if e["type"] == "tool.completed")
    assert completed["attempt"] == 1 and completed["data"]["link"] == "function:cancel"
    assert events[-1]["data"]["compensation"] == {"attempted": 1, "succeeded": 1}


_IDS = [f"00000000-0000-4000-8000-{n:012d}" for n in range(13)]


def _book_and_fail(guardrails=None, binding=None, tool_guardrails=None):
    """Book, then fail, so that "Cancel booking" compensates; its tool is bound as given"""
    ids = _IDS
    tool = {"name": "cancel", "description": "Cancel a booking", "binding": binding or {"kind": "function", "name": "cancel"},
            "parameters": {"type": "object", "required": ["booking"], "properties": {"booking": {"type": "string"}}}}
    if tool_guardrails:
        tool["guardrails"] = tool_guardrails
    return Workflow.model_validate({
        "id": ids[1], "name": "Book and fail", "version": "1.0.0", "awa_version": "1.1",
        **({"guardrails": guardrails} if guardrails else {}),
        "roles": [{"id": ids[2], "name": "System", "actor_type": "application"}],
        "activities": [
            {"id": ids[3], "name": "Book", "role_id": ids[2], "actor_type": "application", "compensation": {"activity_id": ids[5]}},
            {"id": ids[4], "name": "Fail", "role_id": ids[2], "actor_type": "application"},
            {"id": ids[5], "name": "Cancel booking", "role_id": ids[2], "actor_type": "application", "tools": [tool]},
        ],
        "edges": [{"id": ids[6], "source_id": ids[3], "target_id": ids[4]}],
    })


class _BookingActor:
    def __init__(self, booking, after=None):
        self.booking, self.after = booking, after

    def execute(self, activity, token, context=None):
        if activity.name == "Book":
            return {"booking": self.booking}
        if activity.name == "Fail":
            raise ValueError("Nothing more can be done")
        call = context.tools.call("cancel", {"booking": token.context_data["booking"]})
        if self.after:
            self.after(call)
        return {"cancelled": call.ok, "result": call.result}


def test_a_compensation_handlers_tool_calls_are_held_to_the_guardrails():
    """The deployment's, the workflow's and the tool's guardrails at tool_call and tool_result (31.3)"""
    from awa.runtime.workflow_engine import WorkflowEngine
    ids = _IDS
    cancelled = []
    workflow = _book_and_fail(
        guardrails=[{"id": ids[10], "name": "No internal bookings", "stages": ["tool_call"], "action": "block", "actor_types": ["application"],
                     "check": {"kind": "deny_list", "terms": ["INTERNAL"], "whole_words": False}}],
        tool_guardrails=[{"id": ids[11], "name": "No email in results", "stages": ["tool_result"], "action": "redact", "replacement": "[email]",
                          "check": {"kind": "personal_data", "categories": ["email"]}}])
    handlers = {"cancel": lambda args: cancelled.append(args) or {"note": "Cancelled, receipt sent to ada@example.com"}}

    def run(booking, workflow=workflow, **options):
        engine = WorkflowEngine(workflow, options={"actors": {"application": _BookingActor(booking)}, "log_execution": False,
                                                   "tools": {"handlers": handlers}, **options})
        engine.start({})
        engine.run()
        return engine.get_events()

    # The call goes out, and what comes back is redacted by the tool's own guardrail
    events = run("B-1")
    assert cancelled == [{"booking": "B-1"}]
    triggered = [e for e in events if e["type"] == "guardrail.triggered"]
    assert [(e["data"]["guardrail_id"], e["data"]["source"], e["data"]["stage"], e["data"]["action"], e["data"]["tool"]) for e in triggered] \
        == [(ids[11], "tool", "tool_result", "redact", "cancel")]
    assert triggered[0]["node_name"] == "Cancel booking" and triggered[0]["attempt"] == 1
    compensated = next(e for e in events if e["type"] == "activity.compensated")
    assert compensated["data"]["output"] == {"cancelled": True, "result": {"note": "Cancelled, receipt sent to [email]"}}

    # The workflow's guardrail refuses the call: the tool is not called
    events = run("INTERNAL-7")
    assert len(cancelled) == 1
    triggered = [e for e in events if e["type"] == "guardrail.triggered"]
    assert [(e["data"]["guardrail_id"], e["data"]["source"], e["data"]["stage"], e["data"]["action"]) for e in triggered] \
        == [(ids[10], "workflow", "tool_call", "block")]
    assert [e["type"] for e in events if e.get("node_name") == "Cancel booking"] == ["guardrail.triggered", "tool.failed", "activity.compensated"]
    assert next(e for e in events if e["type"] == "tool.failed")["data"]["error"]["code"] == "GUARDRAIL_BLOCKED"

    # A deployment's guardrail applies the same way
    events = run("B-2", workflow=_book_and_fail(), guardrails=[
        {"id": ids[12], "stages": ["tool_call"], "check": {"kind": "deny_list", "terms": ["B-2"]}, "action": "block", "actor_types": ["application"]}])
    assert len(cancelled) == 1
    assert [(e["data"]["source"], e["data"]["stage"], e["data"]["action"]) for e in events if e["type"] == "guardrail.triggered"] \
        == [("deployment", "tool_call", "block")]


@pytest.mark.parametrize("fails", [False, True])
def test_the_sessions_a_compensation_handler_opens_are_closed(fails):
    """The run's sessions were closed when it settled; those its compensation opens are closed after it, whatever happens"""
    from awa.runtime.tools import ToolExecution
    from awa.runtime.workflow_engine import WorkflowEngine
    counts = {"opened": 0, "closed": 0}

    class Session:
        def close(self):
            counts["closed"] += 1

    def mcp(binding, args, context):
        def create():
            counts["opened"] += 1
            return Session()
        context.sessions.get("fake-server", create)
        return ToolExecution({"ok": True})

    def after(call):
        if fails:
            raise RuntimeError("The booking system is down")

    engine = WorkflowEngine(_book_and_fail(binding={"kind": "mcp", "server": "bookings", "tool": "cancel"}),
                            options={"actors": {"application": _BookingActor("B-1", after)}, "log_execution": False,
                                     "tools": {"executors": {"mcp": mcp}}})
    engine.start({})
    engine.run()
    assert engine.status.value == "failed"
    assert any(e["type"] == ("activity.compensation_failed" if fails else "activity.compensated") for e in engine.get_events())
    assert counts == {"opened": 1, "closed": 1}


def test_a_compensation_handler_calls_its_tools_through_the_runner(adapters):
    """A handler's declared tools are called and journalled like any activity's (13.6, 17.3)"""
    scenario = next(s for s in SCENARIOS if s["name"] == "switch-not-confirmed")
    clock, journal = Clock(1793955600000), WatchingJournal()
    runtime = host(adapters, clock, journal)
    instance = play(runtime, journal, clock, scenario)
    events = [e for r in runtime.export_journey(instance["id"])["runs"] for e in r["events"]]
    calls = [(e["node_name"], e["data"]["tool"]) for e in events if e["type"] == "tool.completed" and e["node_name"] in ("Refund deposit", "Cancel account and mandate")]
    assert calls == [("Refund deposit", "refund_deposit"), ("Cancel account and mandate", "cancel_billing_account")]
    compensated = [e["node_name"] for e in events if e["type"] == "activity.compensated"]
    assert compensated == ["Refund deposit", "Cancel account and mandate"]


# ---------------------------------------------------------------------------
# The committed outputs of make-runs.mjs
# ---------------------------------------------------------------------------

def test_the_committed_evidence_report_is_what_this_sdk_makes_from_the_journeys():
    portfolio = read_evidence_input([str(EXAMPLE / "journeys.json")])
    report = compute_evidence(portfolio)
    assert report == json.loads((EXAMPLE / "evidence" / "evidence-report.json").read_text())
    assert render_evidence_markdown(report) == (EXAMPLE / "evidence" / "evidence-report.md").read_text()
    # The HTML page is the same report; its escaping is each SDK's own, as for examples/claims-settlement/evidence
    assert "Evidence report" in render_evidence_html(report)


def test_the_committed_journals_are_the_runs_of_the_portfolio():
    portfolio = json.loads((EXAMPLE / "journeys.json").read_text())
    instances = portfolio["journeys"][0]["instances"]
    by_run = {r["run_id"]: r["events"] for row in instances for r in row["runs"]}
    files = sorted((EXAMPLE / "runs").glob("*.journal.jsonl"))
    assert len(files) == len(by_run)
    for file in files:
        events = [json.loads(line) for line in file.read_text().splitlines() if line.strip()]
        assert events == by_run[events[0]["run_id"]]
    assert len(instances) == len(SCENARIOS)
