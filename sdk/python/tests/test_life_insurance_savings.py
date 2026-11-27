"""
The workplace pension savings example (examples/life-insurance-savings): every document validates, and every
scenario runs to its end with the scripted actors, from the same documents, the same actors.json and the
same scenario files as sdk/typescript/tests/life_insurance_savings.test.ts. Follows scenarios/play.mjs.

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
from datetime import datetime, timezone
from pathlib import Path

import pytest

from awa.cli.deployment import load_deployment
from awa.runtime.authorization import AuthorizationError, principal_named
from awa.runtime.business_event import business_event
from awa.runtime.evidence import compute_evidence, render_evidence_html, render_evidence_markdown
from awa.runtime.evidence_sources import read_evidence_input
from awa.runtime.journal import InMemoryJournalStore
from awa.runtime.journey import parse_journey, validate_journey
from awa.runtime.runtime_host import AwaRuntime
from awa.runtime.tools import BUILT_IN_EXECUTORS
from awa.types import Workflow
from awa.validator import validate_workflow_integrity

ROOT = Path(__file__).resolve().parents[3]
EXAMPLE = ROOT / "examples" / "life-insurance-savings"
read = lambda name: json.loads((EXAMPLE / name).read_text())  # noqa: E731

WORKFLOW_FILES = ["identity-aml-and-tax-residence.awa.json", "plan-invitation-and-advice.awa.json", "savings-plan-subscription.awa.json",
                  "payroll-contributions.awa.json", "self-service-change.awa.json", "year-end-tax.awa.json", "annual-review.awa.json"]
WORKFLOWS = [read(name) for name in WORKFLOW_FILES]
JOURNEY = read("workplace-pension-savings.journey.json")
DEPLOYMENT = load_deployment(str(EXAMPLE / "deployment.json"))
SCRIPTS = read("scenarios/actors.json")
SCENARIOS = [json.loads(p.read_text()) for p in sorted((EXAMPLE / "scenarios").glob("[a-z]-*.json"))]
SECRETS = {name: f"demo-{name.lower().replace('_', '-')}" for name in
           ["POLICY_ADMIN_TOKEN", "PORTAL_TOKEN", "ADVICE_CALENDAR_TOKEN", "FUND_PLATFORM_KEY", "DOCUMENTS_API_KEY", "SCREENING_TOKEN",
            "KYC_TOKEN", "ESIGN_TOKEN", "TAX_SERVICE_TOKEN", "CERTIFICATES_TOKEN"]}


# ---------------------------------------------------------------------------
# The documents
# ---------------------------------------------------------------------------

def test_every_document_of_the_example_is_valid():
    for document in WORKFLOWS:
        result = validate_workflow_integrity(Workflow.model_validate(document))
        assert result.valid, (document["name"], [e.message for e in result.errors])
    journey = parse_journey(JOURNEY)
    assert validate_journey(journey, {w["id"] for w in WORKFLOWS}, True) == []
    # The deployment loads: principals, a policy with two separations of duties and a four-eyes rule, three guardrails
    assert {p["id"] for p in DEPLOYMENT["authorization"]["principals"]} >= {"hugo", "mireille", "ines", "jonas", "claire", "yann", "sofia"}
    assert [f["activities"] for f in DEPLOYMENT["authorization"]["policy"]["four_eyes"]] == [["Approve PEP relationship"]]
    assert len(DEPLOYMENT["guardrails"]) == 3
    # The subscription calls the due diligence as a sub-workflow
    call = next(a for w in WORKFLOWS for a in w["activities"] if a.get("is_expandable"))
    assert call["expansion_workflow_id"] == WORKFLOWS[0]["id"]
    assert len(SCENARIOS) == 8


def test_the_tax_ceilings_are_data_in_a_decision_table():
    tax = next(w for w in WORKFLOWS if w["name"] == "Year-End Tax")
    rules = next(d for d in tax["decision_nodes"] if d["name"] == "Deduction rules")["decision_table"]["rules"]
    assert [r["output_entries"][:2] for r in rules] == [["111bis", 4500], ["111bis", 3200], ["111", 672], ["110", 1200]]


def test_the_guaranteed_return_pattern_reads_the_same_in_python():
    """The deployment's pattern is read by Python's re as by ECMAScript: it finds a promise, not a denial"""
    pattern = re.compile(read("deployment.json")["guardrails"][2]["check"]["patterns"][0]["pattern"])
    assert pattern.search("it guarantees a 3% annual return until you retire")
    assert pattern.search("a guaranteed return of 4%")
    assert not pattern.search("the return is not guaranteed, and you bear the investment risk")
    assert not pattern.search("there is no guaranteed return on unit-linked funds")


# ---------------------------------------------------------------------------
# Placeholders and the timeline: the same rules as scenarios/play.mjs
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


def iso_ms(text):
    return int(datetime.fromisoformat(text.replace("Z", "+00:00")).timestamp() * 1000)


def months_after(ms, n):
    """The calendar month n months after an instant, same day and time (the 28th at most)"""
    date = datetime.fromtimestamp(ms / 1000, tz=timezone.utc)
    month0 = date.month - 1 + n
    target = datetime(date.year + month0 // 12, month0 % 12 + 1, min(date.day, 28), date.hour, date.minute, tzinfo=timezone.utc)
    return int(target.timestamp() * 1000)


def timeline(scenario):
    start = iso_ms(scenario["starts"])
    employee = scenario["invitation"]["employee"]
    entries = [{"time": start, "step": {"invite": True, "say": f"Kestrel HR opens the savings plan to {employee['first_name']} {employee['last_name']}"}, "order": 0}]
    last, order = start, 1
    for step in scenario["steps"]:
        at = iso_ms(step["at"]) if step.get("at") else last + duration_ms(step.get("after"))
        for i in range(step.get("monthly") or 1):
            when = months_after(at, i) if step.get("monthly") else at
            entry = {"time": when, "step": step, "order": order}
            if step.get("monthly"):
                entry["period"] = time.strftime("%Y-%m", time.gmtime(when / 1000))
            entries.append(entry)
            order += 1
        last = at
    return sorted(entries, key=lambda e: (e["time"], e["order"]))


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


def test_placeholders_and_months_follow_the_typescript_rules():
    scope = {"a": {"b": 6.0, "c": [1, 2]}, "t": True, "items": [{"plan": "x", "cost": 3}, {"plan": "y", "cost": 4}]}
    assert fill("{{a.b}} kW, {{t}}", scope) == "6 kW, true"
    assert fill({"k": "{{missing}}", "j": "{{missing|null}}", "n": "{{missing|a.c}}"}, scope) == {"j": None, "n": [1, 2]}
    assert fill({"$find": "items", "where": {"plan": "y"}, "get": "cost"}, scope) == 4
    assert time.strftime("%Y-%m-%d", time.gmtime(months_after(iso_ms("2026-11-27T06:00:00Z"), 2) / 1000)) == "2027-01-27"
    lea = next(s for s in SCENARIOS if s["name"] == "lea-full-year")
    periods = [e["period"] for e in timeline(lea) if "period" in e]
    assert periods == [f"2026-{m:02d}" for m in range(1, 13)]


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
        scenario = self.scenario_of(inputs.get("enrolment_id"))
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
        return {"_requires_human_action": True, "_human_task_id": f"{token.context_data.get('enrolment_id')}:{activity.name}"}


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
        return binding.model_copy(update={field: getattr(binding, field).replace("localhost:4560", f"127.0.0.1:{port}")})
    return {kind: (lambda run: lambda binding, args, context: run(moved(binding), args, context))(BUILT_IN_EXECUTORS[kind]) for kind in ("http", "jsonrpc")}


def host(port, clock, journal, extra=()):
    by_enrolment = {s["invitation"]["enrolment_id"]: s for s in [*SCENARIOS, *extra]}
    actor = ScriptedActor(clock, by_enrolment.get)
    runtime = AwaRuntime(now=lambda: clock.now, engine={
        "actors": {"application": actor, "ai_agent": actor, "robot": actor, "human": Person()},
        "wait_for_human_tasks": True, "journal": journal, "now": clock.tick, "sleep": lambda ms: setattr(clock, "now", clock.now + ms),
        "tools": {"allowed_hosts": ["localhost:4560", f"127.0.0.1:{port}"], "secrets": SECRETS, "executors": executors(port)},
        "authorization": DEPLOYMENT["authorization"], "guardrails": DEPLOYMENT["guardrails"],
        "model_tiers": {"fast": "scripted:fast-model", "balanced": "scripted:balanced-model", "reasoning": "scripted:reasoning-model"},
        "pricing_config": {"input_token_cost_per_1k": 0.003, "output_token_cost_per_1k": 0.015, "currency": "EUR", "software_cost_per_execution": 0.001},
    })
    for workflow in WORKFLOWS:
        runtime.register_workflow(workflow)
    runtime.register_journey(JOURNEY)
    return runtime


def play(runtime, journal, clock, scenario):
    enrolment_id = scenario["invitation"]["enrolment_id"]
    authorization = DEPLOYMENT["authorization"]

    def publish(type, data, source):
        runtime.publish(business_event(type, {"enrolment_id": enrolment_id, **data}, source=source))

    last = None
    for entry in timeline(scenario):
        if last is not None:
            clock.now += entry["time"] - last
        last = entry["time"]
        step = entry["step"]
        if step.get("invite"):
            publish("savings.invited", copy.deepcopy(scenario["invitation"]), "/hr-portal/plan-opening")
        elif step.get("publish"):
            data = fill(step.get("data") or {}, {"today": clock.today(), "invitation": scenario["invitation"], "period": entry.get("period")})
            publish(step["publish"], data, step.get("source", "/hr-portal"))
        elif step.get("tick"):
            runtime.tick()
        elif step.get("complete"):
            task = next((t for t in journal.tasks.values() if t["node_name"] == step["complete"] and t["task"].startswith(f"{enrolment_id}:")), None)
            assert task, f'{scenario["name"]}: nobody is waiting at "{step["complete"]}"'
            try:
                runtime.resume(task["run_id"], task["token_id"], step.get("output") or {}, principal_named(authorization, step["by"]))
                assert not step.get("refused"), f'{step["by"]} was expected to be refused'
            except AuthorizationError as error:
                assert step.get("refused"), f"{step['by']} was refused: {error}"
                assert error.decision.get("reason") == step["refused"]
    return next(i for i in runtime.list_journey_instances() if i["subject_key"] == enrolment_id)


def _matches(actual, wanted):
    if not isinstance(wanted, (dict, list)):
        return actual == wanted
    if isinstance(wanted, list):
        return isinstance(actual, list) and len(actual) == len(wanted) and all(_matches(a, w) for a, w in zip(actual, wanted))
    return isinstance(actual, dict) and all(_matches(actual.get(k, MISSING), v) for k, v in wanted.items())


def check_expectations(scenario, instance, runs):
    expect, problems = scenario.get("expect") or {}, []
    events = [e for r in runs for e in r["events"]]
    for workflow, statuses in (expect.get("runs") or {}).items():
        actual = [r["status"] for r in instance["runs"] if r.get("workflow_name") == workflow]
        if actual != statuses:
            problems.append(f"runs of {workflow}: {actual}, expected {statuses}")
    if expect.get("journey_status") and instance["status"] != expect["journey_status"]:
        problems.append(f"journey status {instance['status']}")
    if expect.get("journey_stage") and instance["stage_id"] != expect["journey_stage"]:
        problems.append(f"journey stage {instance['stage_id']}")
    if "stalled" in expect and bool(instance.get("stalled")) != expect["stalled"]:
        problems.append(f"stalled {instance.get('stalled')}")
    if "goals" in expect and sorted(instance["goals_reached"]) != sorted(expect["goals"]):
        problems.append(f"goals {instance['goals_reached']}")
    for key, value in (expect.get("data") or {}).items():
        if not _matches(instance["data"].get(key, MISSING), value):
            problems.append(f"journey data {key} is {instance['data'].get(key)}")
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
    clock = Clock(iso_ms(scenario["starts"]))
    journal = WatchingJournal()
    runtime = host(adapters, clock, journal)
    instance = play(runtime, journal, clock, scenario)
    runs = runtime.export_journey(instance["id"])["runs"]
    assert check_expectations(scenario, instance, runs) == []
    events = [e for r in runs for e in r["events"]]
    # Every tool call was made through the runner: invoked, then completed or failed, with its link
    invoked = {e["data"]["call_id"] for e in events if e["type"] == "tool.invoked"}
    ended = {e["data"]["call_id"] for e in events if e["type"] in ("tool.completed", "tool.failed")}
    assert invoked and invoked <= ended
    assert all(e["data"]["link"].startswith("http://localhost:4560/") for e in events if e["type"] == "tool.invoked")
    # Due diligence is a child run of the subscription
    if any(r.get("workflow_name") == "Savings Plan Subscription" for r in instance["runs"]):
        child = next(r for r in instance["runs"] if r.get("parent_run_id"))
        assert child["workflow_id"] == WORKFLOWS[0]["id"] and child["status"] == "completed"
    if scenario["name"] == "marc-cancels":
        assert [e["node_name"] for e in events if e["type"] == "activity.compensated"] == ["Redeem units and refund premium", "Stop payroll deduction", "Cancel policy"]
    if scenario["name"] == "eva-guarantee-blocked":
        text = json.dumps(events, ensure_ascii=False)
        assert "guarantees a 3% annual return" not in text and "621 555 018" not in text


def test_a_choice_above_the_profile_is_not_approved_by_the_adviser_who_advised_on_it(adapters):
    """Tom keeps his choice: Mireille, adviser and compliance officer, discussed it with him and may not approve it"""
    tom = next(s for s in SCENARIOS if s["name"] == "tom-above-profile")
    keeps = {
        **copy.deepcopy(tom), "name": "tom-keeps-choice",
        "invitation": {**copy.deepcopy(tom["invitation"]), "enrolment_id": "ENR-26902"},
        "steps": [
            *copy.deepcopy(tom["steps"][:3]),
            {"at": "2026-01-14T07:45:00Z", "publish": "investments.reconsidered", "data": {"reconsider_decision": "keep"}},
            {"at": "2026-01-14T15:00:00Z", "complete": "Discuss the risk with an adviser", "by": "mireille",
             "output": {"acknowledgement_recorded": True, "note": "Tom accepts in writing he could lose more than his profile allows."}},
            {"at": "2026-01-14T15:10:00Z", "complete": "Approve choice above profile", "by": "mireille", "output": {"approved": True, "allocation_confirmed": True}, "refused": "separation_of_duties"},
            {"at": "2026-01-15T09:00:00Z", "complete": "Approve choice above profile", "by": "jonas", "output": {"approved": True, "allocation_confirmed": True}},
        ],
        "expect": {
            "runs": {"Savings Plan Subscription": ["waiting_event"]}, "journey_status": "active", "journey_stage": "subscription",
            "records": [
                {"type": "authorization.decided", "node_name": "Approve choice above profile", "data": {"decision": "deny", "reason": "separation_of_duties", "principal": {"id": "mireille"}}},
                {"type": "activity.completed", "node_name": "Approve choice above profile", "data": {"principal": {"id": "jonas"}}},
            ],
        },
    }
    clock, journal = Clock(iso_ms(keeps["starts"])), WatchingJournal()
    runtime = host(adapters, clock, journal, [keeps])
    instance = play(runtime, journal, clock, keeps)
    assert check_expectations(keeps, instance, runtime.export_journey(instance["id"])["runs"]) == []


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
