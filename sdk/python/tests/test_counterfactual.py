"""
Counterfactual replay (specification section 20): what the conformance cases
cannot reach. Replay of tool results, of business events and of timeouts, of
model decisions, of time, the refusal of a journal without outputs, the report
as text, and the command line.
"""

import json
import os
import subprocess
import sys
import time
from pathlib import Path
from uuid import uuid4

import pytest

from awa.runtime.counterfactual import compare_runs, counterfactual_replay, render_counterfactual_report
from awa.runtime.models import FunctionModelProvider
from awa.runtime.workflow_engine import WorkflowEngine
from awa.types import ActorType, Workflow


def uid():
    return str(uuid4())


def activity(name, actor_type="application", **more):
    return {"id": uid(), "name": name, "role_id": uid(), "actor_type": actor_type, **more}


def edge(source, target, **more):
    return {"id": uid(), "source_id": source["id"], "target_id": target["id"], **more}


def document(activities, edges, **more):
    return {"id": uid(), "name": "Claims", "version": "1.0.0", "activities": activities, "edges": edges, **more}


class Scripted:
    """Each activity returns the next step of its script, the last repeating, after making its tool `calls`"""

    def __init__(self, script=None):
        self.script, self.counts, self.calls = script or {}, {}, []

    def execute(self, activity, token, context=None):
        self.calls.append(activity.name)
        steps = self.script.get(activity.name, [{}])
        n = self.counts[activity.name] = self.counts.get(activity.name, 0) + 1
        step = steps[min(n, len(steps)) - 1]
        results = [context.tools.call(call["tool"], call.get("arguments", {})) for call in step.get("calls", [])]
        if "error" in step:
            raise RuntimeError(step["error"])
        return {**step.get("output", {}), **({"quoted": [r.result for r in results]} if results else {})}


def record(doc, script=None, input=None, **options):
    actor = Scripted(script)
    engine = WorkflowEngine(Workflow.model_validate(doc), options={
        "actors": {t: actor for t in ActorType}, "sleep": lambda ms: None, **options})
    engine.run(input or {})
    return engine


def verdicts(report):
    return {n["node_name"]: n["verdict"] for n in report["nodes"]}


# ---------------------------------------------------------------------------
# Tools
# ---------------------------------------------------------------------------

PRICE = {"name": "price", "description": "Price of a part",
         "parameters": {"type": "object", "properties": {"part": {"type": "string"}}},
         "binding": {"kind": "function", "name": "price"}}


def test_tool_results_are_replayed_and_the_tools_are_not_called_again():
    called = []

    def price(arguments):
        called.append(arguments)
        return {"price": 1150}

    quote = activity("Quote", "ai_agent", tools=[PRICE])
    doc = document([quote], [])
    script = {"Quote": [{"calls": [{"tool": "price", "arguments": {"part": "bumper"}}], "output": {"done": True}}]}
    baseline = record(doc, script, tools={"handlers": {"price": price}})
    assert baseline.status.value == "completed" and called == [{"part": "bumper"}]

    # The replay is given no handler: the result can only come from the journal
    replay = counterfactual_replay(Workflow.model_validate(doc), baseline.get_events(),
                                   engine={"actors": {"ai_agent": Scripted(script)}})
    assert replay.status == "completed" and called == [{"part": "bumper"}]
    completed = next(e for e in replay.events if e["type"] == "tool.completed")
    assert completed["data"]["result"] == {"price": 1150}
    node = replay.report["nodes"][0]
    assert node["verdict"] == "same" and node["candidate"]["tool_calls"] == 1
    assert node["candidate"]["outcome"] == {"done": True, "quoted": [{"price": 1150}]}
    assert replay.report["unrecorded"] == []


def test_a_tool_call_the_baseline_never_made_is_unrecorded_and_is_not_performed():
    called = []
    quote = activity("Quote", "ai_agent", tools=[PRICE])
    doc = document([quote], [])
    baseline = record(doc, {"Quote": [{"calls": [{"tool": "price", "arguments": {"part": "bumper"}}]}]},
                      tools={"handlers": {"price": lambda arguments: {"price": 1150}}})

    other = Scripted({"Quote": [{"calls": [{"tool": "price", "arguments": {"part": "door"}}]}]})
    replay = counterfactual_replay(
        Workflow.model_validate(doc), baseline.get_events(),
        engine={"actors": {"ai_agent": other}, "tools": {"handlers": {"price": lambda arguments: called.append(arguments)}}})
    failed = next(e for e in replay.events if e["type"] == "tool.failed")
    assert failed["data"]["error"]["code"] == "REPLAY_UNRECORDED"
    assert replay.report["unrecorded"] == ['tool call price({"part": "door"})']
    assert called == []  # a replay has no side effects


def test_a_recorded_tool_failure_is_replayed_as_a_failure():
    def broken(arguments):
        raise RuntimeError("price service is down")

    quote = activity("Quote", "ai_agent", tools=[PRICE])
    doc = document([quote], [])
    script = {"Quote": [{"calls": [{"tool": "price", "arguments": {"part": "bumper"}}]}]}
    baseline = record(doc, script, tools={"handlers": {"price": broken}})
    replay = counterfactual_replay(Workflow.model_validate(doc), baseline.get_events(),
                                   engine={"actors": {"ai_agent": Scripted(script)}})
    failed = next(e for e in replay.events if e["type"] == "tool.failed")
    assert failed["data"]["error"] == {"message": "price service is down", "code": "TOOL_ERROR"}
    assert replay.report["unrecorded"] == [] and verdicts(replay.report) == {"Quote": "same"}


# ---------------------------------------------------------------------------
# Business events, timeouts and time
# ---------------------------------------------------------------------------

def waiting_document(timeout=False):
    ask, done, late = activity("Ask"), activity("Done"), activity("Chase")
    wait = {"id": uid(), "name": "Reply", "event_type": "message", "event_definition": {"name": "customer.replied"}}
    edges = [edge(ask, wait), edge(wait, done)]
    if timeout:
        to_late = edge(wait, late)
        wait["event_definition"].update({"timeout": "P2D", "timeout_edge_id": to_late["id"]})
        edges.append(to_late)
    return document([ask, done, late], edges, events=[wait])


def test_the_business_events_the_recorded_run_received_are_delivered_again():
    doc = waiting_document()
    baseline = record(doc, {"Done": [{"output": {"closed": True}}]})
    assert baseline.status.value == "waiting_event"
    baseline.deliver_event({"id": "e-1", "type": "customer.replied", "source": "/crm", "data": {"answer": "yes"}})
    assert baseline.run()["status"] == "completed"

    replay = counterfactual_replay(Workflow.model_validate(doc), baseline.get_events(), ai="recorded")
    assert replay.status == "completed" and replay.report["same_path"] is True
    received = next(e for e in replay.events if e["type"] == "event.received")
    assert received["data"]["source"] == "/crm" and received["data"]["data"] == {"answer": "yes"}
    assert verdicts(replay.report) == {"Ask": "same", "Reply": "same", "Done": "same"}


def test_a_recorded_timeout_is_replayed_without_waiting():
    doc = waiting_document(timeout=True)
    baseline = record(doc, {"Chase": [{"output": {"chased": True}}]})
    assert baseline.expire_events(float("inf")) == 1
    assert baseline.run()["status"] == "completed"

    began = time.monotonic()
    replay = counterfactual_replay(Workflow.model_validate(doc), baseline.get_events(), ai="recorded")
    assert time.monotonic() - began < 5
    assert replay.status == "completed" and replay.report["same_path"] is True
    assert [e["type"] for e in replay.events if e["type"].startswith("event.")] == ["event.waiting", "event.timed_out"]
    assert verdicts(replay.report)["Chase"] == "same"


def test_the_waits_end_as_the_recorded_run_ended_them_in_the_same_order():
    # The first wait times out, a reminder goes, and the documents arrive at the second wait: the event must not end the first
    ask, chase, check = activity("Ask"), activity("Chase"), activity("Check")
    first = {"id": uid(), "name": "Uploaded", "event_type": "message", "event_definition": {"name": "documents.uploaded", "timeout": "P2D"}}
    again = {"id": uid(), "name": "Uploaded after reminder", "event_type": "message", "event_definition": {"name": "documents.uploaded"}}
    late = edge(first, chase)
    first["event_definition"]["timeout_edge_id"] = late["id"]
    doc = document([ask, chase, check], [edge(ask, first), edge(first, check), late, edge(chase, again), edge(again, check)], events=[first, again])
    baseline = record(doc, {"Check": [{"output": {"checked": True}}]})
    assert baseline.status.value == "waiting_event" and baseline.expire_events(float("inf")) == 1
    assert baseline.run()["status"] == "waiting_event"
    baseline.deliver_event({"id": "e-1", "type": "documents.uploaded", "source": "/portal", "data": {"files": 3}})
    assert baseline.run()["status"] == "completed"

    replay = counterfactual_replay(Workflow.model_validate(doc), baseline.get_events(), ai="recorded")
    assert replay.status == "completed"
    assert replay.report["same_path"] is True, replay.report.get("divergence")
    assert set(verdicts(replay.report).values()) == {"same"}, verdicts(replay.report)


def test_a_run_withdrawn_while_it_waited_is_withdrawn_again_and_its_compensation_is_compared():
    refund = activity("Refund", tools=[{"name": "refund", "description": "Refund", "parameters": {"type": "object"},
                                         "binding": {"kind": "function", "name": "refund"}}])
    pay, done = activity("Pay", compensation={"activity_id": refund["id"]}), activity("Done")
    wait = {"id": uid(), "name": "Reply", "event_type": "message", "event_definition": {"name": "customer.replied"}}
    doc = document([pay, done, refund], [edge(pay, wait), edge(wait, done)], events=[wait])

    class Payer:
        def execute(self, activity, token, context=None):
            if activity.name == "Refund":
                context.tools.call("refund", {"amount": 150})
                return {"refunded": True}
            return {"paid": 150}

    engine = WorkflowEngine(Workflow.model_validate(doc), options={
        "actors": {t: Payer() for t in ActorType}, "sleep": lambda ms: None, "tools": {"handlers": {"refund": lambda arguments: {"ok": True}}}})
    assert engine.run({})["status"] == "waiting_event"
    assert engine.cancel("the customer withdrew") is True

    replay = counterfactual_replay(Workflow.model_validate(doc), engine.get_events(), ai="recorded")
    assert replay.status == "cancelled"
    assert next(e for e in replay.events if e["type"] == "run.cancelled")["data"]["reason"] == "the customer withdrew"
    report = replay.report
    assert report["baseline"]["status"] == "cancelled"
    assert report["same_status"] and report["same_path"] and report["regressions"] == [] and report["unrecorded"] == []
    node = next(n for n in report["nodes"] if n["node_name"] == "Refund")
    assert node["verdict"] == "same" and node["baseline"]["accepted"] and node["candidate"]["accepted"]


def test_a_wait_the_recording_cannot_end_is_reported_and_nothing_is_invented():
    doc = waiting_document()
    baseline = record(doc)  # recorded while still waiting: no event was received
    replay = counterfactual_replay(Workflow.model_validate(doc), baseline.get_events(), ai="recorded")
    assert replay.status == "waiting_event"
    assert replay.report["unrecorded"] == ["a business event the candidate run waited for"]
    assert replay.report["candidate"]["status"] == "unfinished"


def test_timers_and_backoff_do_not_wait():
    a, b = activity("A", retry={"max_attempts": 2, "initial_delay": "PT1H"}), activity("B")
    timer = {"id": uid(), "name": "Cool off", "event_type": "timer", "event_definition": {"duration": "P1D"}}
    doc = document([a, b], [edge(a, timer), edge(timer, b)], events=[timer])
    baseline = record(doc, {"A": [{"error": "busy"}, {"output": {"ok": True}}]})
    assert baseline.status.value == "completed"

    began = time.monotonic()
    replay = counterfactual_replay(Workflow.model_validate(doc), baseline.get_events(), ai="recorded")
    assert time.monotonic() - began < 5
    assert replay.status == "completed"
    assert "timer.fired" in [e["type"] for e in replay.events]
    # The recorded result is supplied at once; needing fewer attempts is not an improvement of the candidate
    assert verdicts(replay.report)["A"] == "same" and replay.report["improvements"] == []


# ---------------------------------------------------------------------------
# Model decisions
# ---------------------------------------------------------------------------

def triage_document():
    intake, pay, review = activity("Intake"), activity("Pay"), activity("Review")
    node = {"id": uid(), "name": "Triage"}
    to_pay, to_review = edge(node, pay), edge(node, review)
    node["decision_model"] = {"instructions": "Pay small claims, review large ones.", "inputs": ["cost"], "options": [
        {"id": "pay", "description": "small", "output_edge_id": to_pay["id"]},
        {"id": "review", "description": "large", "output_edge_id": to_review["id"]}]}
    return document([intake, pay, review], [edge(intake, node), to_pay, to_review], decision_nodes=[node])


def model(option, calls):
    def reply(request):
        calls.append(option)
        return json.dumps({"option": option, "confidence": 0.9, "rationale": "clear"})
    return {"model_providers": [FunctionModelProvider("acme", reply)],
            "model_tiers": {tier: "acme:model" for tier in ("fast", "balanced", "reasoning")}}


def test_recorded_model_decisions_are_replayed_without_a_model_and_live_ones_decide_again():
    doc, calls = triage_document(), []
    script = {"Intake": [{"output": {"cost": 300}}], "Pay": [{"output": {"paid": True}}]}
    baseline = record(doc, script, **model("pay", calls))
    assert baseline.status.value == "completed" and calls == ["pay"]
    workflow = Workflow.model_validate(doc)

    # Recorded: no provider is registered, and none is needed
    replay = counterfactual_replay(workflow, baseline.get_events(), ai="recorded")
    assert replay.status == "completed" and calls == ["pay"]
    assert verdicts(replay.report) == {"Intake": "same", "Triage": "same", "Pay": "same"}
    assert render_counterfactual_report(replay.report).splitlines()[2] == "**The candidate behaves exactly as recorded.**"

    # Live: the model decides again, and here it sends the run where the recording never went
    replay = counterfactual_replay(workflow, baseline.get_events(), engine=model("review", calls))
    assert calls == ["pay", "review"] and replay.status == "failed"
    report = replay.report
    assert report["same_path"] is False
    assert report["divergence"] == {"after": "Triage", "baseline_next": "Pay", "candidate_next": "Review"}
    assert verdicts(report) == {"Intake": "same", "Triage": "changed", "Pay": "only_baseline", "Review": "only_candidate"}
    triage = next(n for n in report["nodes"] if n["node_name"] == "Triage")
    assert (triage["baseline"]["decision"], triage["candidate"]["decision"]) == (
        {"method": "model", "choice": "pay"}, {"method": "model", "choice": "review"})
    assert report["unrecorded"] == ['activity "Review"']
    assert report["regressions"] == ["The run failed; the recorded run completed."]
    text = render_counterfactual_report(report)
    assert "After **Triage**, the recorded run went to **Pay** and the candidate to **Review**" in text
    assert "## Could not be replayed" in text and "| Review | only candidate | not reached |" in text


# ---------------------------------------------------------------------------
# What a replay refuses, and what it leaves alone
# ---------------------------------------------------------------------------

def test_what_recorded_activities_wrote_to_contexts_is_restored_for_the_activities_that_read_them():
    profile = {"id": uid(), "name": "customer_profile", "type": "data", "sync_pattern": "shared_state"}
    register = activity("Register", context_bindings=[{"context_id": profile["id"], "access_mode": "write"}])
    verify = activity("Verify", "ai_agent", context_bindings=[{"context_id": profile["id"], "access_mode": "read"}])
    doc = document([register, verify], [edge(register, verify)], contexts=[profile])
    given = []

    class Writer:
        def execute(self, activity, token, context=None):
            if activity.name == "Register":
                return {"customer_id": "C-1", "_context_writes": {"customer_profile": {"name": "Lena", "segment": "household"}}}
            given.append(json.loads(json.dumps(token.context_data.get("_contexts"))))
            return {"output": {"documents_valid": True}, "usage": {"input_tokens": 1, "output_tokens": 1}}

    engine = WorkflowEngine(Workflow.model_validate(doc), options={"actors": {t: Writer() for t in ActorType}, "sleep": lambda ms: None})
    assert engine.run({})["status"] == "completed"
    events = engine.get_events()
    assert next(e for e in events if e["type"] == "context.written")["data"]["written"] == {"name": "Lena", "segment": "household"}

    recorded = counterfactual_replay(Workflow.model_validate(doc), events, ai="recorded")
    assert recorded.status == "completed", recorded.report["regressions"]
    assert recorded.report["same_path"] and recorded.report["regressions"] == [] and set(verdicts(recorded.report).values()) == {"same"}
    read = next(e for e in recorded.events if e["type"] == "context.read")
    assert read["data"]["contexts"][0]["present"] is True

    # With live AI, the agent that runs again is given the context the recorded application wrote
    live = counterfactual_replay(Workflow.model_validate(doc), events, engine={"actors": {"ai_agent": Writer()}})
    assert live.status == "completed"
    assert given[-1] == {"customer_profile": {"name": "Lena", "segment": "household"}}


def test_a_journal_without_outputs_is_refused():
    doc = document([activity("A")], [])
    for mode in ("hash", "none"):
        baseline = record(doc, {"A": [{"output": {"secret": 1}}]}, journal_payloads=mode)
        with pytest.raises(ValueError, match='payload mode "full"'):
            counterfactual_replay(Workflow.model_validate(doc), baseline.get_events(), ai="recorded")


def test_a_live_replay_needs_the_actor_that_performs_the_ai_agents():
    doc = document([activity("Assess", "ai_agent")], [])
    baseline = record(doc, {"Assess": [{"output": {"score": 7}}]})
    with pytest.raises(ValueError, match="ai_agent"):
        counterfactual_replay(Workflow.model_validate(doc), baseline.get_events())
    with pytest.raises(ValueError, match='"live" or "recorded"'):
        counterfactual_replay(Workflow.model_validate(doc), baseline.get_events(), ai="imagined")


def test_a_replay_changes_neither_the_recording_nor_the_execution_log(monkeypatch):
    from awa.runtime.services.task_service import ExecutionService
    logged = []
    monkeypatch.setattr(ExecutionService, "log_execution", staticmethod(logged.append))
    doc = document([activity("A")], [])
    baseline = record(doc, {"A": [{"output": {"n": 1}}]})
    assert len(logged) == 1
    events = baseline.get_events()
    before = json.dumps(events)
    replay = counterfactual_replay(Workflow.model_validate(doc), events, ai="recorded")
    assert len(logged) == 1 and json.dumps(events) == before
    assert replay.events[0]["run_id"] != events[0]["run_id"]
    assert replay.report["baseline"]["run_id"] == events[0]["run_id"]


def test_two_journals_are_compared_without_running_anything():
    a = activity("Assess", "ai_agent", outcome_contract={
        "postconditions": [{"name": "Has a score", "expression": "score exists"}], "budgets": {"max_attempts": 3}})
    doc = document([a], [])
    quick = record(doc, {"Assess": [{"output": {"score": 7}}]}).get_events()
    slow = record(doc, {"Assess": [{"output": {}}, {"output": {"score": 4}}]}).get_events()
    workflow = Workflow.model_validate(doc)
    report = compare_runs(workflow, quick, slow)
    assert verdicts(report) == {"Assess": "regressed"}
    assert report["regressions"] == ["Assess: Needed 2 attempt(s), up from 1."]
    assert report["nodes"][0]["notes"] == ["Needed 2 attempt(s), up from 1.", "The accepted outcome differs."]
    assert (report["baseline"]["attempts"], report["candidate"]["attempts"]) == (1, 2)
    assert verdicts(compare_runs(workflow, slow, quick)) == {"Assess": "improved"}
    # Accepted in both in as many attempts, with another outcome: for a person to judge
    other = record(doc, {"Assess": [{"output": {"score": 2}}]}).get_events()
    assert verdicts(compare_runs(workflow, quick, other)) == {"Assess": "changed"}
    assert compare_runs(workflow, quick, other)["regressions"] == []


# ---------------------------------------------------------------------------
# The command line
# ---------------------------------------------------------------------------

def awa(*args):
    environment = {**os.environ, "PYTHONPATH": str(Path(__file__).resolve().parents[1])}
    return subprocess.run([sys.executable, "-m", "awa.cli", *args], capture_output=True, text=True, env=environment)


def test_the_command_line_exits_with_2_when_the_candidate_regresses(tmp_path):
    collect, assess, approve = activity("Collect"), activity("Assess", "ai_agent"), activity("Approve")
    doc = document([collect, assess, approve], [edge(collect, assess), edge(assess, approve)])
    baseline = record(doc, {"Assess": [{"output": {"score": 7}}]})
    stricter = json.loads(json.dumps(doc))
    stricter["activities"][1]["outcome_contract"] = {"postconditions": [{"name": "High confidence", "expression": "score >= 9"}]}

    files = {name: str(tmp_path / name) for name in ("workflow.json", "stricter.json", "run.jsonl", "report.json", "out.jsonl")}
    Path(files["workflow.json"]).write_text(json.dumps({"workflow": doc}))
    Path(files["stricter.json"]).write_text(json.dumps(stricter))
    Path(files["run.jsonl"]).write_text("".join(json.dumps(e) + "\n" for e in baseline.get_events()))

    same = awa("replay", files["workflow.json"], files["run.jsonl"])
    assert same.returncode == 0, same.stderr
    assert "**The candidate behaves exactly as recorded.**" in same.stdout

    worse = awa("replay", files["workflow.json"], files["run.jsonl"], "--candidate", files["stricter.json"], "--json",
                "-o", files["report.json"], "--journal-out", files["out.jsonl"])
    assert worse.returncode == 2, worse.stderr
    report = json.loads(Path(files["report.json"]).read_text())
    assert report["ai"] == "recorded" and report["candidate"]["status"] == "failed"
    assert report["regressions"][0].startswith("Assess: Accepted in the recorded run, not in the candidate: Outcome contract violated")
    assert [json.loads(line)["seq"] for line in Path(files["out.jsonl"]).read_text().splitlines()][:2] == [1, 2]

    Path(files["run.jsonl"]).write_text("")
    empty = awa("replay", files["workflow.json"], files["run.jsonl"])
    assert empty.returncode == 1 and "holds no run of workflow" in empty.stderr
