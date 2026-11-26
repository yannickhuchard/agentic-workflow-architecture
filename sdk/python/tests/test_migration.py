"""
Changing a workflow while runs are in flight (specification section 25): versions on a host,
plans and their refusals, and what replay, telemetry, evidence and measures see of a migrated run.
The conformance cases in spec/conformance/versioning cover the main paths; these cover the rest.
"""

import json
import os
import uuid

import pytest

from awa.runtime.counterfactual import counterfactual_replay
from awa.runtime.evidence import compute_evidence
from awa.runtime.journal import InMemoryJournalStore
from awa.runtime.kpi import compute_measures
from awa.runtime.migration import as_migrated, check_assignments, compare_versions, plan_migration, rest_positions, semver_key
from awa.runtime.runtime_host import AwaRuntime, InMemoryRuntimeStore, add_definition, open_runtime_directory
from awa.runtime.telemetry import run_spans
from awa.types import ActorType, Workflow
from tests.postgres_helper import TestPostgres, postgres_unavailable

ID = "7d1f0c3e-5b8a-4e6f-9a2b-0c1d2e3f4a5b"
ROLE = "7d1f0c3e-5b8a-4e6f-9a2b-0c1d2e3f4a00"
_ids: dict[str, str] = {}


def nid(name: str) -> str:
    """The same name gives the same id in every version, as a kept node does"""
    if name not in _ids:
        _ids[name] = f"7d1f0c3e-5b8a-4e6f-9a2b-{len(_ids) + 1:012d}"
    return _ids[name]


def document(version, nodes, edges=None):
    """A workflow of nodes in sequence (or as the edges say), as a document"""
    pairs = edges or [(a["name"], b["name"]) for a, b in zip(nodes, nodes[1:])]
    return {
        "id": ID, "name": "Claim", "version": version, "awa_version": "1.1",
        "activities": [{"id": nid(n["name"]), "name": n["name"], "role_id": ROLE, "actor_type": n.get("actor", "application"),
                        **({"join": "all"} if n.get("join") else {}),
                        **({"a2a": {"agent_card": "https://agents.example/card.json"}} if n.get("a2a") else {})}
                       for n in nodes if "event" not in n],
        "events": [{"id": nid(n["name"]), "name": n["name"], **n["event"], **({"join": "all"} if n.get("join") else {})} for n in nodes if "event" in n],
        "edges": [{"id": nid(f"{a}->{b}"), "source_id": nid(a), "target_id": nid(b)} for a, b in pairs],
    }


def workflow(version, nodes, edges=None) -> Workflow:
    return Workflow.model_validate(document(version, nodes, edges))


class Script:
    def __init__(self, outputs=None):
        self.outputs, self.visited = outputs or {}, []

    def execute(self, activity, token, context=None):
        self.visited.append(activity.name)
        if activity.actor_type == ActorType.human:
            return {"_requires_human_action": True, "_human_task_id": f"task:{activity.name}"}
        return dict(self.outputs.get(activity.name, {}))


def engine(actor, journal=None):
    return {"actors": {t: actor for t in ActorType}, "journal": journal or InMemoryJournalStore(), "sleep": lambda ms: None}


V1 = document("1.0.0", [{"name": "Register"}, {"name": "Review", "actor": "human"}, {"name": "Settle"}])
V2 = document("2.0.0", [{"name": "Register"}, {"name": "Review", "actor": "human"}, {"name": "Settle"}, {"name": "Notify"}])


def state_of(wf: Workflow, node: str, status="waiting", data=None, engine_status="waiting_human"):
    return {"version": "1.0", "workflow_id": str(wf.id), "workflow_name": wf.name, "workflow_version": wf.version, "engine_status": engine_status,
            "contexts": {}, "checkpoint_at": "2026-05-04T09:00:00.000Z", "metadata": {"run_id": "r"},
            "tokens": [{"id": str(uuid.uuid4()), "activity_id": nid(node), "status": status, "context_data": data or {}}]}


def test_new_runs_start_on_the_newest_version_unless_pinned():
    assert semver_key("1.10.0") > semver_key("1.9.3")
    runtime = AwaRuntime(engine=engine(Script()))
    runtime.register_workflow(V2).register_workflow(V1)
    assert runtime.workflow_versions(ID) == ["1.0.0", "2.0.0"]
    assert runtime.get_workflow(ID).version == "2.0.0"
    assert runtime.start(ID).workflow.version == "2.0.0"
    assert runtime.start(ID, version="1.0.0").workflow.version == "1.0.0"
    with pytest.raises(KeyError, match="no registered version 9.9.9"):
        runtime.start(ID, version="9.9.9")
    pinned = AwaRuntime(engine=engine(Script()), pinned_versions={ID: "1.0.0"})
    pinned.register_workflow(V1).register_workflow(V2)
    assert pinned.start(ID).workflow.version == "1.0.0"


def test_a_runtime_directory_keeps_every_version_and_refuses_to_start_without_one_a_run_needs(tmp_path):
    os.makedirs(tmp_path / "definitions")
    # A directory written by an earlier SDK names a workflow's file by its id alone
    (tmp_path / "definitions" / f"workflow-{ID}.json").write_text(json.dumps(V1))
    actor = Script()
    with open_runtime_directory(str(tmp_path), engine=engine(actor)) as runtime:
        run = runtime.start(ID)
    add_definition(str(tmp_path), V1)
    add_definition(str(tmp_path), V2)
    assert sorted(os.listdir(tmp_path / "definitions")) == [f"workflow-{ID}@1.0.0.json", f"workflow-{ID}@2.0.0.json"]
    with open_runtime_directory(str(tmp_path), engine=engine(actor)) as runtime:
        assert runtime.get_run(run.run_id).workflow.version == "1.0.0"
        assert runtime.start(ID).workflow.version == "2.0.0"
    saved = (tmp_path / "runtime.json").read_text()
    os.remove(tmp_path / "definitions" / f"workflow-{ID}@1.0.0.json")
    with pytest.raises(RuntimeError, match=f"run {run.run_id} needs workflow {ID} version 1.0.0, which is not registered"):
        open_runtime_directory(str(tmp_path), engine=engine(actor))
    assert (tmp_path / "runtime.json").read_text() == saved


def test_plans_refuse_another_workflow_and_check_each_assignment():
    v1, v2 = Workflow.model_validate(V1), Workflow.model_validate(V2)
    other = Workflow.model_validate({**V2, "id": "7d1f0c3e-5b8a-4e6f-9a2b-ffffffffffff"})
    assert [r["code"] for r in plan_migration(v1, other, state_of(v1, "Review"))["refusals"]] == ["different_workflow"]
    assert [r["code"] for r in plan_migration(v1, v2, state_of(v1, "Review"), {"workflow_id": str(other.id)})["refusals"]] == ["different_workflow"]
    assert len(check_assignments([{"set": "a", "remove": "b"}, {"set": "x.y"}, {"set": "a", "value": 1, "from": "b"}, {"remove": "not a path"},
                                  {"set": "a.b._c", "value": 1}, {"set": "ok", "value": 1, "when": ""}])) == 7
    assert check_assignments([{"set": "a.b", "value": 1}, {"remove": "c"}, {"set": "d", "from": "e.f", "when": "g == 1"}]) == []


def test_nested_properties_are_set_and_a_state_is_never_changed_in_place():
    v1, v2 = Workflow.model_validate(V1), Workflow.model_validate(V2)
    state = state_of(v1, "Review", data={"customer": {"tier": "gold"}})
    result = plan_migration(v1, v2, state, {"data": [{"set": "customer.address.city", "value": "Lyon"}, {"set": "gold", "expression": "customer.tier == gold"}]})
    assert result["refusals"] == []
    assert result["state"]["tokens"][0]["context_data"] == {"customer": {"tier": "gold", "address": {"city": "Lyon"}}, "gold": True}
    assert state["tokens"][0]["context_data"] == {"customer": {"tier": "gold"}}


def test_an_event_wait_is_kept_only_for_the_same_event_and_correlation():
    def docs(name, key=None):
        return {"event_type": "message", "event_definition": {"name": name, **({"correlation_key": key} if key else {})}}
    a = workflow("1.0.0", [{"name": "Register"}, {"name": "Documents", "event": docs("documents.uploaded", "claim_id")}, {"name": "Settle"}])
    data = {"_awaiting_event": {"node_id": nid("Documents"), "name": "documents.uploaded", "correlation_key": "claim_id", "correlation_value": "C-1"}}
    for event, reason in [(docs("documents.uploaded", "customer_id"), 'correlates on "customer_id"'), (docs("papers.uploaded", "claim_id"), 'waits for "papers.uploaded"'),
                          ({"event_type": "signal", "event_definition": {"name": "documents.uploaded"}}, "signal event"),
                          ({"event_type": "timer", "event_definition": {"duration": "PT1H"}}, "does not wait for a business event")]:
        b = workflow("2.0.0", [{"name": "Register"}, {"name": "Documents", "event": event}, {"name": "Settle"}])
        result = plan_migration(a, b, state_of(a, "Documents", data=data, engine_status="waiting_event"))
        assert [r["code"] for r in result["refusals"]] == ["wait_incompatible"]
        assert reason in result["refusals"][0]["message"]
    b = workflow("2.0.0", [{"name": "Register"}, {"name": "Documents", "event": docs("documents.uploaded", "claim_id")}, {"name": "Settle"}])
    kept = plan_migration(a, b, state_of(a, "Documents", data=data, engine_status="waiting_event"))
    assert kept["refusals"] == []
    assert kept["state"]["tokens"][0]["context_data"]["_awaiting_event"]["correlation_value"] == "C-1"


def test_a_join_keeps_its_token_only_where_it_joins_on_the_edge_it_came_by():
    nodes = [{"name": "Split"}, {"name": "Left"}, {"name": "Right"}, {"name": "Join", "join": True}]
    edges = [("Split", "Left"), ("Split", "Right"), ("Left", "Join"), ("Right", "Join")]
    a = workflow("1.0.0", nodes, edges)
    data = {"_arrived_edge": nid("Left->Join")}
    assert plan_migration(a, workflow("2.0.0", nodes, edges), state_of(a, "Join", "joining", data, "running"))["refusals"] == []
    rewired = workflow("2.0.0", [*nodes, {"name": "Middle"}], [("Split", "Middle"), ("Middle", "Left"), ("Split", "Right"), ("Left", "Right"), ("Right", "Join"), ("Middle", "Join")])
    assert [r["code"] for r in plan_migration(a, rewired, state_of(a, "Join", "joining", data, "running"))["refusals"]] == ["wait_incompatible"]
    restarted = plan_migration(a, rewired, state_of(a, "Join", "joining", data, "running"), {"restart": [nid("Join")]})
    assert restarted["tokens"][0]["outcome"] == "restarted"
    assert restarted["state"]["tokens"][0]["status"] == "active" and restarted["state"]["tokens"][0]["context_data"] == {}
    assert restarted["status"] == "running"


def test_a_task_is_kept_only_where_the_same_kind_of_actor_performs_it():
    a = workflow("1.0.0", [{"name": "Register"}, {"name": "Ask", "actor": "ai_agent", "a2a": True}, {"name": "Settle"}])
    data = {"_awaiting_agent_input": {"agent": "x", "task_id": "t"}}
    not_a2a = workflow("2.0.0", [{"name": "Register"}, {"name": "Ask", "actor": "ai_agent"}, {"name": "Settle"}])
    assert "not performed by an agent over A2A" in plan_migration(a, not_a2a, state_of(a, "Ask", data=data))["refusals"][0]["message"]
    human = workflow("2.0.0", [{"name": "Register"}, {"name": "Ask", "actor": "human"}, {"name": "Settle"}])
    assert "performed by human, not ai_agent" in plan_migration(a, human, state_of(a, "Ask", data=data))["refusals"][0]["message"]
    v1 = Workflow.model_validate(V1)
    timer = workflow("2.0.0", [{"name": "Register"}, {"name": "Settle"}, {"name": "Review", "event": {"event_type": "timer", "event_definition": {"duration": "PT1H"}}}])
    assert "is not an activity" in plan_migration(v1, timer, state_of(v1, "Review"))["refusals"][0]["message"]


def test_positions_at_rest_and_completed_work_mapped_for_compensation():
    a = workflow("1.0.0", [{"name": "Register"}, {"name": "Ask", "actor": "ai_agent", "a2a": True}, {"name": "Review", "actor": "human"},
                           {"name": "Wait", "event": {"event_type": "timer", "event_definition": {"duration": "PT1H"}}}])
    assert [f"{p['node_name']}:{p['wait']}" for p in rest_positions(a)] == ["Ask:agent", "Review:human", "Wait:timer"]
    v1 = Workflow.model_validate(V1)
    state = state_of(v1, "Review")
    state["metadata"]["completed_activities"] = [{"activity_id": nid("Register"), "token_id": "t", "output": {}}]
    b = workflow("2.0.0", [{"name": "Intake"}, {"name": "Review", "actor": "human"}, {"name": "Settle"}])
    result = plan_migration(v1, b, state, {"nodes": {nid("Register"): nid("Intake")}})
    assert result["completed_work"] == [{"from_node_id": nid("Register"), "to_node_id": nid("Intake")}]
    assert result["state"]["metadata"]["completed_activities"][0]["activity_id"] == nid("Intake")
    comparison = compare_versions(v1, b)
    assert [n["node_name"] for n in comparison["removed"]] == ["Register"]
    assert [n["node_name"] for n in comparison["added"]] == ["Intake"]


def migrated_run():
    """A run of 1.0.0 waiting at Review, moved to a 2.0.0 that replaced Review by Check (an application), with a restart"""
    actor = Script({"Register": {"output": {"claim_id": "CLM-1"}}, "Check": {"output": {"approved": True}}})
    runtime = AwaRuntime(store=InMemoryRuntimeStore(), engine=engine(actor))
    b = document("2.0.0", [{"name": "Register"}, {"name": "Check"}, {"name": "Settle"}, {"name": "Notify"}])
    runtime.register_workflow(V1)
    run = runtime.start(ID)
    runtime.register_workflow(b)
    result = runtime.migrate(run.run_id, {"nodes": {nid("Review"): nid("Check")}, "restart": [nid("Review")], "data": [{"set": "currency", "value": "EUR"}]})
    assert result["applied"] is True and result["status"] == "completed"
    return runtime.get_run(run.run_id).get_events(), Workflow.model_validate(b), run.run_id


def test_replay_matches_a_migrated_run_as_the_migration_mapped_it():
    events, b, _ = migrated_run()
    mapped = as_migrated(events)
    assert next(e for e in mapped if e["type"] == "activity.started" and e.get("node_name") == "Review")["node_id"] == nid("Check")
    unmigrated = [e for e in events if e["type"] != "run.migrated"]
    assert as_migrated(unmigrated) == sorted(unmigrated, key=lambda e: e["seq"])
    replay = counterfactual_replay(b, events, ai="recorded")
    assert replay.report["candidate"]["status"] == "completed"
    assert replay.report["unrecorded"] == [] and replay.report["regressions"] == []


def test_telemetry_has_the_migration_on_the_run_and_ends_a_withdrawn_wait():
    events, b, _ = migrated_run()
    spans = run_spans(b, events)
    run = next(s for s in spans if s.parent_span_id is None)
    assert run.attributes["awa.workflow.version"] == "1.0.0"
    event = next(e for e in run.events if e.name == "run.migrated")
    assert event.attributes["awa.data.from_version"] == "1.0.0" and event.attributes["awa.data.to_version"] == "2.0.0"
    wait = next(s for s in spans if s.name.startswith("wait "))
    assert wait.attributes["awa.wait.outcome"] == "withdrawn"
    from awa.runtime.journey import time_ms
    assert wait.end_ms == time_ms(next(e for e in events if e["type"] == "run.migrated")["time"])


def test_evidence_states_each_migration_and_measures_count_the_run_once():
    events, b, run_id = migrated_run()
    workflow_json = b.model_dump(mode="json", exclude_none=True)
    report = compute_evidence({"workflows": [workflow_json], "runs": [{"run_id": run_id, "workflow_id": ID, "events": events}]})
    operation = next(p for p in report["parts"] if p["id"] == "operation")
    migration = next(s for s in operation["statements"] if s["kind"] == "migration")
    assert migration["facts"] == {"run_id": run_id, "from_version": "1.0.0", "to_version": "2.0.0", "tokens_kept": 0, "tokens_restarted": 1, "data_changes": 1}
    assert migration["citations"] == [{"run_id": run_id, "seq": [next(e for e in events if e["type"] == "run.migrated")["seq"]]}]
    assert operation["summary"]["migrations"] == 1
    assert operation["summary"]["workflows"] == [{"workflow_id": ID, "name": "Claim", "versions": ["1.0.0", "2.0.0"], "runs": 1}]
    assert next(s for s in operation["statements"] if s["kind"] == "run")["facts"]["workflow_version"] == "1.0.0"
    measures = compute_measures({"workflows": [workflow_json], "runs": [{"run_id": run_id, "workflow_id": ID, "events": events}]})
    assert len(measures["workflows"]) == 1
    assert measures["workflows"][0]["measures"]["workflow.runs"]["value"] == 1
    assert measures["workflows"][0]["measures"]["workflow.success_rate"]["value"] == 1


def test_values_a_migration_changes_follow_the_payload_mode():
    runtime = AwaRuntime(engine={**engine(Script()), "journal_payloads": "hash"})
    runtime.register_workflow(V1)
    run = runtime.start(ID)
    runtime.register_workflow(V2)
    runtime.migrate(run.run_id, {"data": [{"set": "secret", "value": "S-1"}]})
    migrated = next(e for e in runtime.get_run(run.run_id).get_events() if e["type"] == "run.migrated")
    assert "sha256" in migrated["data"]["data_changes"][0]["value"]


def test_migration_over_http():
    pytest.importorskip("fastapi")
    pytest.importorskip("httpx")
    from fastapi.testclient import TestClient
    import awa.server as server

    key = next(iter(server.API_KEYS), None)
    headers = {"x-api-key": key} if key else {}
    client = TestClient(server.app)
    runtime = AwaRuntime(engine=engine(Script()))
    server.set_journey_runtime(runtime)
    try:
        runtime.register_workflow(V1)
        run = runtime.start(ID)
        base = "/api/v1/journeys"
        assert client.post(f"{base}/definitions", json=V2, headers=headers).status_code == 201
        assert client.get(f"{base}/workflows/{ID}/versions", headers=headers).json() == {
            "workflow_id": ID, "newest": "2.0.0", "versions": [{"version": "1.0.0", "live_runs": [run.run_id]}, {"version": "2.0.0", "live_runs": []}]}
        assert client.get(f"{base}/workflows/nope/versions", headers=headers).status_code == 404
        check = client.post(f"{base}/migrations/check", json={"workflow_id": ID}, headers=headers).json()
        assert check["to_version"] == "2.0.0" and check["comparisons"][0]["automatic"] is True and check["runs"][0]["migratable"] is True
        assert client.post(f"{base}/migrations/check", json={}, headers=headers).status_code == 400
        dry = client.post(f"{base}/runs/{run.run_id}/migrate?dry_run=true", json={}, headers=headers)
        assert dry.status_code == 200 and dry.json()["applied"] is False and dry.json()["dry_run"] is True
        assert client.post(f"{base}/runs/{run.run_id}/migrate", json={"to_version": "7.0.0"}, headers=headers).status_code == 409
        assert client.post(f"{base}/runs/nope/migrate", json={}, headers=headers).status_code == 404
        applied = client.post(f"{base}/runs/{run.run_id}/migrate", json={}, headers=headers)
        assert applied.status_code == 200 and applied.json()["applied"] is True
        assert runtime.get_run(run.run_id).workflow.version == "2.0.0"
    finally:
        server.set_journey_runtime(None)


def test_migrate_command(tmp_path, capsys):
    from awa.cli import main
    for doc in (V1,):
        add_definition(str(tmp_path), doc)
    with open_runtime_directory(str(tmp_path), engine=engine(Script())) as runtime:
        run = runtime.start(ID)
    add_definition(str(tmp_path), V2)
    assert main(["migrate", "check", ID, "--dir", str(tmp_path)]) == 0
    assert "can be moved" in capsys.readouterr().out
    plan = tmp_path / "plan.json"
    plan.write_text(json.dumps({"to_version": "3.0.0"}))
    assert main(["migrate", "plan", run.run_id, "--dir", str(tmp_path), "--plan", str(plan)]) == 2
    assert "unknown_version" in capsys.readouterr().out
    assert main(["migrate", "plan", run.run_id, "--dir", str(tmp_path), "--json"]) == 0
    assert json.loads(capsys.readouterr().out)["dry_run"] is True
    assert main(["migrate", "apply", run.run_id, "--dir", str(tmp_path)]) == 0
    assert "moved from 1.0.0 to 2.0.0" in capsys.readouterr().out
    with open_runtime_directory(str(tmp_path), engine=engine(Script())) as runtime:
        assert runtime.get_run(run.run_id).workflow.version == "2.0.0"


UNAVAILABLE = postgres_unavailable()


@pytest.mark.skipif(UNAVAILABLE is not None, reason=f"needs PostgreSQL: {UNAVAILABLE}")
def test_versions_on_a_shared_store():
    from awa.runtime.postgres_store import PostgresRuntimeStore, open_runtime_store
    import psycopg
    server = TestPostgres()
    try:
        url = server.database()
        store = PostgresRuntimeStore(url)
        store.add_definition(V1)
        actor = Script()
        first = open_runtime_store(url, engine=engine(actor))
        run = first.start(ID)
        store.add_definition(V2)
        store.add_definition(V2)  # the same version again replaces it
        assert [d["version"] for d in store.definitions()] == ["1.0.0", "2.0.0"]
        first.close()

        second = open_runtime_store(url, engine=engine(actor))
        assert second.workflow_versions(ID) == ["1.0.0", "2.0.0"]
        assert second.start(ID).workflow.version == "2.0.0"
        check = second.check_migration(ID)
        assert [(r["run_id"], r["version"], r["migratable"]) for r in check["runs"]] == [(run.run_id, "1.0.0", True)]
        result = second.migrate(run.run_id, {})
        assert result["applied"] is True and result["status"] == "waiting_human"
        second.close()

        third = open_runtime_store(url, engine=engine(actor))
        third.refresh()
        taken = third.get_run(run.run_id)
        assert taken.workflow.version == "2.0.0"
        assert third.resume(run.run_id, taken.tokens[0].id, {}) is True
        third.refresh()
        events = third.get_run(run.run_id).get_events()
        assert [e["seq"] for e in events] == list(range(1, len(events) + 1))
        assert "run.migrated" in [e["type"] for e in events]
        assert "Notify" in actor.visited
        third.close()

        lagging = open_runtime_store(url, engine=engine(actor))
        lagging.start(ID, version="1.0.0")
        lagging.close()
        with psycopg.connect(url, autocommit=True) as connection:
            connection.execute("DELETE FROM awa_runtime.definitions WHERE version = '1.0.0'")
        with pytest.raises(RuntimeError, match=f"workflow {ID} version 1.0.0, which this host has not registered"):
            open_runtime_store(url, engine=engine(actor))
        store.close()
    finally:
        server.stop()
