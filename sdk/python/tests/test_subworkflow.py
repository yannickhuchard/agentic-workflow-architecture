"""
Sub-workflows (specification section 24): what the conformance cases cannot
reach. Child runs at several depths, refusals, a parent restored with a child
that waits, replay, telemetry, a journey whose run calls workflows, and the same
journey on a runtime directory and on a PostgreSQL store shared by two hosts.
Mirrors sdk/typescript/tests/subworkflow.test.ts.
"""

import copy
import json
import os
import tempfile
from uuid import uuid4

import pytest

from awa.runtime.counterfactual import counterfactual_replay
from awa.runtime.journal import InMemoryJournalStore
from awa.runtime.runtime_host import add_definition, open_runtime_directory
from awa.runtime.telemetry import run_span_id, run_spans, run_trace_id
from awa.runtime.workflow_engine import WorkflowEngine
from awa.types import ActorType, Workflow
from tests.postgres_helper import TestPostgres, postgres_unavailable

ROLE = "7d1c0e55-0000-4000-8000-000000000001"


def workflow(name, steps, workflow_id=None):
    """A workflow from steps in sequence: a name, or a dict with `call` (a workflow), `human`, `wait` (an event type) or `extra`"""
    activities, events, nodes = [], [], []
    for step in steps:
        s = {"name": step} if isinstance(step, str) else step
        node = str(uuid4())
        nodes.append(node)
        if s.get("wait"):
            events.append({"id": node, "name": s["name"], "event_type": "message",
                           "event_definition": {"name": s["wait"], "correlation_key": "claim_id"}})
            continue
        activity = {"id": node, "name": s["name"], "role_id": ROLE, "actor_type": "human" if s.get("human") else "application",
                    **s.get("extra", {})}
        if s.get("call") is not None:
            activity.update(is_expandable=True, expansion_workflow_id=str(s["call"].id))
        activities.append(activity)
    edges = [{"id": str(uuid4()), "source_id": nodes[i], "target_id": target} for i, target in enumerate(nodes[1:])]
    return Workflow.model_validate({"id": workflow_id or str(uuid4()), "name": name, "version": "1.0.0", "awa_version": "1.1",
                                    "activities": activities, "events": events, "edges": edges})


class Scripted:
    """Returns what is scripted by activity name; a person's activity becomes a task that waits"""

    def __init__(self, outputs=None):
        self.outputs, self.visited = outputs or {}, []

    def execute(self, activity, token):
        self.visited.append(activity.name)
        if activity.actor_type == ActorType.human:
            return {"_requires_human_action": True, "_human_task_id": f"task-{activity.name}"}
        return dict(self.outputs.get(activity.name, {}))


def with_actor(actor, **extra):
    return {"actors": {t: actor for t in ActorType}, "wait_for_human_tasks": True, "sleep": lambda ms: None,
            "log_execution": False, **extra}


def event(type_, claim_id, event_id, **data):
    return {"specversion": "1.0", "id": event_id, "source": "/test", "type": type_, "data": {"claim_id": claim_id, **data}}


def numbered(events):
    return all(e["seq"] == i + 1 for i, e in enumerate(events))


def task_of(events, activity):
    """The token of a run that waits for a person at that activity, from its journal"""
    return next(e["token_id"] for e in events
                if e["type"] == "token.waiting" and e.get("node_name") == activity and e["data"].get("reason") == "human_task")


COLLECT = workflow("Collect documents", ["Request", {"name": "Documents received", "wait": "documents.received"}, "File"])
APPROVAL = workflow("Approval", [{"name": "Review", "human": True}, "Record"])
CLAIM = workflow("Claim", ["Open", {"name": "Collect", "call": COLLECT}, {"name": "Approve", "call": APPROVAL}, "Pay"])
CLAIM_WORKFLOWS = [CLAIM, COLLECT, APPROVAL]
OUTPUTS = {"File": {"filed": True}, "Record": {"recorded": True}, "Pay": {"paid": True}}


def as_document(w):
    return w.model_dump(mode="json", exclude_none=True)


# ------------------------------------------------------------------------------------- the engine

def test_lists_child_runs_at_every_depth_in_the_order_they_started():
    c = workflow("C", ["Deepest"])
    b = workflow("B", ["Middle", {"name": "Call C", "call": c}])
    a = workflow("A", ["Top", {"name": "Call B", "call": b}])
    engine = WorkflowEngine(a, options=with_actor(Scripted({"Deepest": {"depth_reached": 2}}), subworkflows={"workflows": [a, b, c]}))
    result = engine.run({})
    assert result["status"] == "completed"
    runs = result["subworkflow_runs"]
    assert [(r["workflow_name"], r["depth"], r["status"]) for r in runs] == [("B", 1, "completed"), ("C", 2, "completed")]
    assert runs[1]["parent_run_id"] == runs[0]["run_id"]
    deepest = engine.get_subworkflow_events(runs[1]["run_id"])
    assert deepest[0]["data"]["depth"] == 2
    assert deepest[0]["data"]["parent"]["root_run_id"] == engine.run_id
    assert engine.tokens[0].context_data["depth_reached"] == 2
    assert engine.has_subworkflow_run(runs[1]["run_id"])
    assert engine.get_subworkflow_events(str(uuid4())) == []


def test_takes_the_depth_limit_from_the_deployment():
    loop_id = str(uuid4())
    loop = workflow("Loop", ["Step", {"name": "Again", "extra": {"is_expandable": True, "expansion_workflow_id": loop_id}}], loop_id)
    engine = WorkflowEngine(loop, options=with_actor(Scripted(), subworkflows={"workflows": [loop], "max_depth": 2}))
    assert engine.run({})["status"] == "failed"
    runs = engine.subworkflow_runs()
    assert [r["depth"] for r in runs] == [1, 2]
    failed = next(e for e in engine.get_subworkflow_events(runs[1]["run_id"]) if e["type"] == "activity.failed")
    assert failed["data"]["error"]["code"] == "SUBWORKFLOW_DEPTH_EXCEEDED"


def test_a_token_waiting_on_a_child_is_not_resumed_as_if_a_person_had_answered():
    engine = WorkflowEngine(CLAIM, options=with_actor(Scripted(OUTPUTS), subworkflows={"workflows": CLAIM_WORKFLOWS}))
    assert engine.run({"claim_id": "CL-1"})["status"] == "waiting_event"
    parent_token = engine.tokens[0]
    assert parent_token.status.value == "waiting"
    assert engine.resume_token(parent_token.id, {"approved": True}) is False
    assert engine.resume_token(str(uuid4()), {}) is False
    assert engine.status.value == "waiting_event"
    assert engine.next_event_deadline() is None


def test_restores_a_parent_waiting_on_a_child_and_each_journal_goes_on():
    journal = InMemoryJournalStore()
    options = with_actor(Scripted(OUTPUTS), journal=journal, subworkflows={"workflows": CLAIM_WORKFLOWS})
    first = WorkflowEngine(CLAIM, options=options)
    assert first.run({"claim_id": "CL-1"})["status"] == "waiting_event"
    state = json.loads(json.dumps(first.snapshot()))
    assert len(state["metadata"]["subworkflows"]["live"]) == 1
    child_id = state["metadata"]["subworkflows"]["live"][0]["run_id"]
    assert state["metadata"]["subworkflows"]["live"][0]["state"]["metadata"]["subworkflows"]["parent"]["run_id"] == first.run_id

    second = WorkflowEngine.restore(CLAIM, state, options)
    assert second.status.value == "waiting_event"
    assert second.deliver_event(event("documents.received", "CL-1", "evt-1")) == 1
    assert second.run()["status"] == "waiting_human"
    approval = next(r for r in second.subworkflow_runs() if r["workflow_name"] == "Approval")
    token = task_of(journal.read(approval["run_id"]), "Review")

    third = WorkflowEngine.restore(CLAIM, json.loads(json.dumps(second.snapshot())), options)
    assert third.resume_token(token, {"approved": True}) is True
    assert third.run()["status"] == "completed"
    assert {"filed": True, "approved": True, "recorded": True, "paid": True}.items() <= third.tokens[0].context_data.items()
    for run_id in (first.run_id, child_id, approval["run_id"]):
        events = journal.read(run_id)
        assert numbered(events), f"journal of {run_id}"
        assert any(e["type"] == "run.resumed" for e in events)


def test_refuses_to_restore_a_parent_whose_child_runs_a_workflow_not_registered():
    engine = WorkflowEngine(CLAIM, options=with_actor(Scripted(), subworkflows={"workflows": CLAIM_WORKFLOWS}))
    engine.run({"claim_id": "CL-1"})
    with pytest.raises(ValueError, match="not registered"):
        WorkflowEngine.restore(CLAIM, engine.snapshot(), with_actor(Scripted(), subworkflows={"workflows": [CLAIM]}))


def test_cancels_the_child_when_the_parent_token_fails_by_its_service_level():
    clock = {"now": 1_767_600_000_000}
    collect = workflow("Collect documents", ["Request", {"name": "Documents received", "wait": "documents.received"}, "File"])
    claim = workflow("Claim", [{"name": "Collect", "call": collect,
                                "extra": {"sla": {"max_time": "PT1H", "escalation_policy": {"breach_action": "fail"}}}}])
    journal = InMemoryJournalStore()
    engine = WorkflowEngine(claim, options=with_actor(Scripted(), journal=journal, now=lambda: clock["now"],
                                                      subworkflows={"workflows": [claim, collect]}))
    assert engine.run({"claim_id": "CL-1"})["status"] == "waiting_event"
    clock["now"] += 2 * 3_600_000
    assert engine.check_service_levels()["failed"] == 1
    assert engine.run()["status"] == "failed"
    child = engine.subworkflow_runs()[0]
    assert child["status"] == "cancelled"
    assert next(e for e in journal.read(child["run_id"]) if e["type"] == "run.cancelled")["data"]["reason"] == "parent_failed"


def test_a_replay_holds_the_call_activity_as_recorded_and_starts_no_child():
    journal = InMemoryJournalStore()
    engine = WorkflowEngine(CLAIM, options=with_actor(Scripted(OUTPUTS), journal=journal, subworkflows={"workflows": CLAIM_WORKFLOWS}))
    engine.run({"claim_id": "CL-1"})
    engine.deliver_event(event("documents.received", "CL-1", "evt-1"))
    engine.run()
    approval = next(r for r in engine.subworkflow_runs() if r["workflow_name"] == "Approval")
    engine.resume_token(task_of(journal.read(approval["run_id"]), "Review"), {"approved": True})
    assert engine.run()["status"] == "completed"

    replay = counterfactual_replay(CLAIM, engine.get_events(), ai="recorded", engine={"subworkflows": {"workflows": CLAIM_WORKFLOWS}})
    assert replay.report["candidate"]["status"] == "completed"
    assert not any(e["type"].startswith("subworkflow.") for e in replay.events)
    assert next(n for n in replay.report["nodes"] if n["node_name"] == "Approve")["verdict"] == "same"


def test_the_child_trace_links_to_the_parent_attempt_span():
    journal = InMemoryJournalStore()
    engine = WorkflowEngine(CLAIM, options=with_actor(Scripted(OUTPUTS), journal=journal, subworkflows={"workflows": CLAIM_WORKFLOWS}))
    engine.run({"claim_id": "CL-1"})
    child = engine.subworkflow_runs()[0]
    started = next(e for e in engine.get_events() if e["type"] == "activity.started" and e.get("node_name") == "Collect")
    root = next(s for s in run_spans(COLLECT, journal.read(child["run_id"])) if s.parent_span_id is None)
    assert root.links == [{"trace_id": run_trace_id(engine.run_id), "span_id": run_span_id(engine.run_id, started["seq"])}]
    assert root.attributes["awa.run.parent_run_id"] == engine.run_id


def test_a_call_activity_and_its_mapping_survive_bpmn_and_the_serverless_export_says_what_it_drops():
    from pathlib import Path
    from awa.interchange.bpmn_export import export_bpmn
    from awa.interchange.bpmn_import import import_bpmn
    from awa.interchange.common import json_equal
    from awa.interchange.serverless_workflow import export_serverless_workflow
    case = json.loads((Path(__file__).resolve().parents[3] / "spec/conformance/execution/subworkflow-output-becomes-the-outcome.json").read_text())
    exported = export_bpmn([case["workflow"]])
    assert "callActivity" in exported.bpmn
    back = import_bpmn(exported.bpmn, [exported.dmn] if exported.dmn else None)
    assert json_equal(back.documents[0], case["workflow"])
    assert any("subworkflow" in json.dumps(n) for n in export_serverless_workflow(case["workflow"]).not_mapped)


# ------------------------------------------------------------------------------------------ hosts

JOURNEY = {
    "id": "5f2c9d1e-3b4a-4f6e-8c7d-000000000024", "name": "Claims", "version": "1.0.0", "subject": {"name": "claim", "key": "claim_id"},
    "stages": [{"id": "open", "name": "Open", "workflows": [str(CLAIM.id)], "complete_when": "paid == true", "transitions": []}],
    "triggers": [{"event": "claim.opened", "starts_journey": True, "start_workflow": str(CLAIM.id)}],
    "touchpoints": [{"id": "filed", "name": "Documents filed", "direction": "outbound", "channel": "email", "on": {"activity": "File"}}],
}


def expect_journey_of_children(instance):
    """What a journey must show of a run that called two workflows"""
    assert instance["status"] == "completed"
    root = next(r for r in instance["runs"] if not r.get("parent_run_id"))
    children = [r for r in instance["runs"] if r.get("parent_run_id")]
    assert [(r["workflow_name"], r["status"], r["parent_run_id"]) for r in children] == [
        ("Collect documents", "completed", root["run_id"]), ("Approval", "completed", root["run_id"])]
    runs = [(e["type"][12:], e.get("run_id")) for e in instance["events"] if e["type"] in ("journey.run_started", "journey.run_ended")]
    assert runs == [("started", root["run_id"]), ("started", children[0]["run_id"]), ("ended", children[0]["run_id"]),
                    ("started", children[1]["run_id"]), ("ended", children[1]["run_id"]), ("ended", root["run_id"])]
    # An activity of a child run realises the journey's touchpoint, carrying that run's id
    assert next(e for e in instance["events"] if e["type"] == "journey.touchpoint")["run_id"] == children[0]["run_id"]
    # The child's wait is the journey's: the event that resumed it is on the journey's record
    assert any(e["type"] == "journey.event_received" and e["data"]["name"] == "documents.received" for e in instance["events"])


def test_a_runtime_directory_keeps_a_parent_with_its_waiting_child_across_restarts():
    with tempfile.TemporaryDirectory() as directory:
        for document in [*map(as_document, CLAIM_WORKFLOWS), JOURNEY]:
            add_definition(directory, copy.deepcopy(document))
        engine = with_actor(Scripted(OUTPUTS))
        host = open_runtime_directory(directory, engine)
        host.publish(event("claim.opened", "CL-1", "open-1"))
        with open(os.path.join(directory, "runtime.json"), encoding="utf-8") as handle:
            state = json.load(handle)
        assert len(state["runs"]) == 1, "only runs of depth 0 are kept in runtime.json"
        assert len(state["runs"][0]["state"]["metadata"]["subworkflows"]["live"]) == 1
        host.close()

        host = open_runtime_directory(directory, engine)
        host.publish(event("documents.received", "CL-1", "docs-1", pages=2))
        host.close()

        host = open_runtime_directory(directory, engine)
        instance = host.list_journey_instances()[0]
        approval = next(r for r in instance["runs"] if r["workflow_name"] == "Approval")
        assert approval["status"] == "waiting_human"
        bundle = host.export_journey(instance["id"])
        token = task_of(next(r for r in bundle["runs"] if r["run_id"] == approval["run_id"])["events"], "Review")
        assert host.resume(str(uuid4()), token, {}) is False
        assert host.resume(approval["run_id"], token, {"approved": True}) is True
        expect_journey_of_children(host.get_journey_instance(instance["id"]))
        for run in instance["runs"]:
            events = next(r for r in host.export_journey(instance["id"])["runs"] if r["run_id"] == run["run_id"])["events"]
            assert events and numbered(events), f"journal of {run['workflow_name']}"
            assert os.path.exists(os.path.join(directory, "journals", f"{run['run_id']}.journal.jsonl"))
        host.close()


def test_a_runtime_directory_refuses_to_start_when_a_waiting_child_needs_a_missing_workflow():
    with tempfile.TemporaryDirectory() as directory:
        for document in [*map(as_document, CLAIM_WORKFLOWS), JOURNEY]:
            add_definition(directory, copy.deepcopy(document))
        host = open_runtime_directory(directory, with_actor(Scripted(OUTPUTS)))
        host.publish(event("claim.opened", "CL-1", "open-1"))
        host.close()
        os.remove(os.path.join(directory, "definitions", f"workflow-{COLLECT.id}.json"))
        with pytest.raises(Exception, match="not registered"):
            open_runtime_directory(directory, with_actor(Scripted(OUTPUTS)))


UNAVAILABLE = postgres_unavailable()


@pytest.fixture(scope="module")
def postgres():
    server = TestPostgres()
    yield server
    server.stop()


@pytest.mark.skipif(UNAVAILABLE is not None, reason=f"shared store tests need PostgreSQL: {UNAVAILABLE}")
def test_a_shared_store_keeps_each_child_in_the_partition_of_its_parent(postgres):
    from awa.runtime.postgres_store import PostgresRuntimeStore, open_runtime_store
    import psycopg
    url = postgres.database()
    store = PostgresRuntimeStore(url)
    for document in [*map(as_document, CLAIM_WORKFLOWS), JOURNEY]:
        store.add_definition(copy.deepcopy(document))
    store.close()
    a = open_runtime_store(url, engine=with_actor(Scripted(OUTPUTS)))
    b = open_runtime_store(url, engine=with_actor(Scripted(OUTPUTS)))
    try:
        a.publish(event("claim.opened", "CL-1", "open-1"))
        # Another host takes the event the child waits for: the store finds the child's wait through its parent
        assert len(b.publish(event("documents.received", "CL-1", "docs-1"))["resumed_runs"]) == 1
        a.refresh()
        instance = a.list_journey_instances()[0]
        approval = next(r for r in instance["runs"] if r["workflow_name"] == "Approval")
        token = task_of(next(r for r in a.export_journey(instance["id"])["runs"] if r["run_id"] == approval["run_id"])["events"], "Review")
        assert a.resume(approval["run_id"], token, {"approved": True}) is True

        b.refresh()
        expect_journey_of_children(b.get_journey_instance(instance["id"]))
        with psycopg.connect(url) as connection:
            rows = connection.execute(
                "SELECT id, status, partition_key, checkpoint->'metadata'->'subworkflows'->'parent'->>'run_id' "
                "FROM awa_runtime.runs ORDER BY position").fetchall()
            assert [(r[1], r[2]) for r in rows] == [("completed", "subject:CL-1")] * 3
            assert all(r[3] == rows[0][0] for r in rows[1:])
            gaps = connection.execute("SELECT run_id FROM awa_runtime.journal_events GROUP BY run_id "
                                      "HAVING MAX(seq) <> COUNT(*) OR MIN(seq) <> 1").fetchall()
            assert gaps == []
            assert len(connection.execute("SELECT DISTINCT run_id FROM awa_runtime.journal_events").fetchall()) == 3
    finally:
        a.close()
        b.close()
