"""
Where features meet: sub-workflows (24) with changing a workflow in flight (25),
identity and authorization (30), the shared store (29) and A2A (28.8). Each
feature is tested on its own elsewhere; these tests fix how they behave together.
Mirrors sdk/typescript/tests/seams.test.ts.
"""

import base64
import copy
import hashlib
import hmac
import json
import os
import tempfile
import time
from uuid import uuid4

import pytest

from awa.runtime.authorization import AuthorizationError
from awa.runtime.journal import InMemoryJournalStore
from awa.runtime.runtime_host import AwaRuntime, add_definition, open_runtime_directory
from awa.runtime.workflow_engine import WorkflowEngine
from awa.types import ActorType, Workflow
from tests.postgres_helper import TestPostgres, postgres_unavailable

ROLE = "7d1c0e55-0000-4000-8000-000000000002"


def workflow(name, steps, workflow_id=None, version="1.0.0", ids=None):
    """A workflow of activities in sequence, with node ids given by name so that versions can share them"""
    ids = {} if ids is None else ids
    activities = []
    for step in steps:
        s = {"name": step} if isinstance(step, str) else step
        ids.setdefault(s["name"], str(uuid4()))
        activity = {"id": ids[s["name"]], "name": s["name"], "role_id": ROLE, "actor_type": "human" if s.get("human") else "application"}
        if s.get("call"):
            activity.update(is_expandable=True, expansion_workflow_id=s["call"])
        activities.append(activity)
    edges = [{"id": str(uuid4()), "source_id": activities[i]["id"], "target_id": a["id"]} for i, a in enumerate(activities[1:])]
    return Workflow.model_validate({"id": workflow_id or str(uuid4()), "name": name, "version": version, "awa_version": "1.1",
                                    "activities": activities, "edges": edges})


def document(w):
    return json.loads(w.model_dump_json(exclude_none=True))


class Scripted:
    """A person's activity waits for a task; any other returns its name"""

    def execute(self, activity, token):
        if activity.actor_type == ActorType.human:
            return {"_requires_human_action": True, "_human_task_id": f"task-{activity.name}"}
        return {activity.name.lower(): True}


def engine_options(**extra):
    return {"actors": {t: Scripted() for t in ActorType}, "wait_for_human_tasks": True, "sleep": lambda ms: None,
            "log_execution": False, **extra}


def person(id_):
    return {"id": id_, "kind": "person"}


def waiting_at(events, name):
    return [e for e in events if e["type"] == "token.waiting" and e.get("node_name") == name
            and e["data"].get("reason") == "human_task"][-1]["token_id"]


# People may do anything; the applications may perform activities; the one who submits may not review
POLICY = {
    "rules": [
        {"id": "people", "effect": "allow", "actions": ["*"], "subject": {"kinds": ["person"]}},
        {"id": "applications", "effect": "allow", "actions": ["perform_activity"], "subject": {"kinds": ["application"]}},
    ],
    "separation_of_duties": [{"id": "submit-review", "activities": ["Submit", "Review"]}],
}

APPROVAL = workflow("Approval", [{"name": "Review", "human": True}, "Record"])
CLAIM = workflow("Claim", [{"name": "Submit", "human": True}, {"name": "Approve", "call": str(APPROVAL.id)}, "Pay"])


def claim(authorization=None):
    journal = InMemoryJournalStore()
    engine = WorkflowEngine(CLAIM, options=engine_options(journal=journal, subworkflows={"workflows": [APPROVAL]}, principal=person("alice"),
                                                         authorization=authorization or {"policy": POLICY}))
    engine.run({})
    engine.resume_token(waiting_at(engine.get_events(), "Submit"), {"submitted": True}, person("alice"))
    engine.run()
    child = engine.subworkflow_runs()[0]
    return engine, journal, child, waiting_at(journal.read(child["run_id"]), "Review")


# --- authorization in child runs (24, 30) ----------------------------------------------------------

def test_the_person_who_completes_a_task_of_a_child_run_through_the_parent_is_held_to_the_policy_and_recorded():
    engine, journal, child, review = claim()
    assert engine.resume_token(review, {"approved": True}, person("bob")) is True
    engine.run()
    assert engine.status.value == "completed"
    events = journal.read(child["run_id"])
    assert next(e for e in events if e["type"] == "token.resumed")["data"]["principal"] == person("bob")
    assert next(e for e in events if e["type"] == "activity.completed" and e.get("node_name") == "Review")["data"]["principal"] == person("bob")


def test_separation_of_duties_in_a_child_run_is_decided_on_the_record_of_its_parent():
    engine, journal, child, review = claim()
    with pytest.raises(AuthorizationError) as refused:
        engine.resume_token(review, {"approved": True}, person("alice"))
    assert refused.value.code == "FORBIDDEN"
    assert engine.status.value == "waiting_human"
    denied = next(e for e in journal.read(child["run_id"]) if e["type"] == "authorization.decided")["data"]
    assert (denied["action"], denied["decision"], denied["reason"], denied["rule"], denied["principal"]) == (
        "complete_task", "deny", "separation_of_duties", "submit-review", person("alice"))


def test_what_a_child_run_did_stays_on_the_record_of_its_parent_once_ended_across_a_checkpoint():
    intake = workflow("Intake", [{"name": "Submit", "human": True}])
    case = workflow("Case", [{"name": "Take in", "call": str(intake.id)}, {"name": "Review", "human": True}])
    journal = InMemoryJournalStore()
    options = engine_options(journal=journal, subworkflows={"workflows": [intake]}, authorization={"policy": POLICY})
    engine = WorkflowEngine(case, options={**options, "principal": person("carol")})
    engine.run({})
    taken = engine.subworkflow_runs()[0]
    engine.resume_token(waiting_at(journal.read(taken["run_id"]), "Submit"), {"submitted": True}, person("alice"))
    engine.run()
    restored = WorkflowEngine.restore(case, json.loads(json.dumps(engine.snapshot())), options, record_resumed=False)
    review = waiting_at(restored.get_events(), "Review")
    with pytest.raises(AuthorizationError):
        restored.resume_token(review, {}, person("alice"))
    assert restored.resume_token(review, {}, person("bob")) is True
    restored.run()
    assert restored.status.value == "completed"


def test_a_child_run_is_started_without_deciding_start_run_by_whoever_started_the_run_of_depth_0():
    # The policy lets people start claims and nothing else: a child run is not a start of its own
    policy = {"rules": [
        {"id": "start-claims", "effect": "allow", "actions": ["start_run"], "resource": {"workflows": ["Claim"]}},
        {"id": "people", "effect": "allow", "actions": ["complete_task"], "subject": {"kinds": ["person"]}},
        {"id": "applications", "effect": "allow", "actions": ["perform_activity"], "subject": {"kinds": ["application"]}},
    ]}
    journal = InMemoryJournalStore()
    options = engine_options(journal=journal, subworkflows={"workflows": [APPROVAL]}, authorization={"policy": policy})
    engine = WorkflowEngine(CLAIM, options={**options, "principal": person("alice")})
    engine.run({})
    # The host restores the run without knowing who started it: the run knows
    restored = WorkflowEngine.restore(CLAIM, json.loads(json.dumps(engine.snapshot())), options, record_resumed=False)
    restored.resume_token(waiting_at(restored.get_events(), "Submit"), {}, person("alice"))
    restored.run()
    child = restored.subworkflow_runs()[0]
    started = journal.read(child["run_id"])[0]
    assert started["type"] == "run.started" and started["data"]["principal"] == person("alice")
    assert [e for e in journal.read(restored.run_id) if e["type"] == "authorization.decided"] == []
    assert restored.status.value == "waiting_human"


# --- versions of a called workflow (24, 25.1) ----------------------------------------------------

APPROVAL_ID, CLAIM_ID = str(uuid4()), str(uuid4())
_IDS: dict = {}
V1 = workflow("Approval", [{"name": "Review", "human": True}, "Record"], APPROVAL_ID, "1.0.0", _IDS)
# Version 2 adds a step after the same two
V2 = workflow("Approval", [{"name": "Review", "human": True}, "Record", "Audit"], APPROVAL_ID, "2.0.0", _IDS)
CALLER = workflow("Claim", ["Open", {"name": "Approve", "call": APPROVAL_ID}, "Pay"], CLAIM_ID)


def test_a_waiting_child_run_keeps_its_version_when_a_newer_one_is_registered_and_the_host_restarts():
    with tempfile.TemporaryDirectory() as directory:
        for d in (CALLER, V1):
            add_definition(directory, document(d))
        host = open_runtime_directory(directory, engine=engine_options())
        run = host.start(CLAIM_ID)
        child = run.subworkflow_runs()[0]
        review = waiting_at(run.get_subworkflow_events(child["run_id"]), "Review")
        host.close()
        add_definition(directory, document(V2))
        host = open_runtime_directory(directory, engine=engine_options())
        assert host.resume(run.run_id, review, {"approved": True}) is True
        parent = host.get_run(run.run_id)
        assert parent.status.value == "completed"
        assert "Audit" not in [e.get("node_name") for e in parent.get_subworkflow_events(child["run_id"])]
        # A new child run starts on the newest version
        following = host.start(CLAIM_ID)
        assert next(e for e in following.get_events() if e["type"] == "subworkflow.started")["data"]["workflow_version"] == "2.0.0"
        host.close()


def test_a_host_refuses_to_start_when_a_waiting_child_needs_a_version_no_longer_registered():
    with tempfile.TemporaryDirectory() as directory:
        for d in (CALLER, V1):
            add_definition(directory, document(d))
        host = open_runtime_directory(directory, engine=engine_options())
        host.start(CLAIM_ID)
        host.close()
        os.remove(os.path.join(directory, "definitions", f"workflow-{APPROVAL_ID}@1.0.0.json"))
        add_definition(directory, document(V2))
        with pytest.raises(ValueError, match=r"version 1\.0\.0, which is not registered"):
            open_runtime_directory(directory, engine=engine_options())


def test_a_child_run_starts_on_the_version_the_host_pins():
    host = AwaRuntime(engine=engine_options(), pinned_versions={APPROVAL_ID: "1.0.0"})
    for d in (CALLER, V1, V2):
        host.register_workflow(d)
    run = host.start(CLAIM_ID)
    assert next(e for e in run.get_events() if e["type"] == "subworkflow.started")["data"]["workflow_version"] == "1.0.0"


# --- moving a run that keeps a record of who did what (25.3, 30) ---------------------------------

def payment_versions():
    ids: dict = {}
    workflow_id = str(uuid4())
    return (workflow_id, workflow("Payment", [{"name": "Approve", "human": True}, "Pay"], workflow_id, "1.0.0", ids),
            workflow("Payment", [{"name": "Approve", "human": True}, "Pay", "Notify"], workflow_id, "2.0.0", ids))


def test_a_moved_run_keeps_the_approvals_given_under_four_eyes_and_who_started_it():
    workflow_id, v1, v2 = payment_versions()
    policy = {**POLICY, "separation_of_duties": [{"id": "not-the-requester", "activities": ["Approve"], "includes_starter": True}],
              "four_eyes": [{"id": "two", "activities": ["Approve"], "approvals": 2}]}
    host = AwaRuntime(engine=engine_options(authorization={"policy": policy}))
    host.register_workflow(v1)
    host.register_workflow(v2)
    run = host.start(workflow_id, {}, principal=person("requester"), version="1.0.0")
    approve = waiting_at(run.get_events(), "Approve")
    assert host.resume(run.run_id, approve, {"ok": True}, person("ann")) is True
    moved = host.migrate(run.run_id, {"to_version": "2.0.0"}, principal=person("operator"))
    assert moved["refusals"] == [] and moved["applied"] is True
    after = host.get_run(run.run_id)
    assert next(e for e in after.get_events() if e["type"] == "run.migrated")["data"]["principal"] == person("operator")
    for who in ("ann", "requester"):
        with pytest.raises(AuthorizationError):
            host.resume(run.run_id, approve, {"ok": True}, person(who))
    assert host.resume(run.run_id, approve, {"ok": True}, person("ben")) is True
    assert after.status.value == "completed"
    completed = next(e for e in after.get_events() if e["type"] == "activity.completed" and e.get("node_name") == "Approve")
    assert completed["data"]["approvals"] == [person("ann"), person("ben")]


# --- routes where authorization meets migration and A2A (25.6, 28.8, 30.4) -----------------------

def _jwt(secret, claims):
    encode = lambda value: base64.urlsafe_b64encode(json.dumps(value).encode()).decode().rstrip("=")  # noqa: E731
    header, payload = encode({"alg": "HS256", "typ": "JWT"}), encode({**claims, "exp": (time.time() + 3600) * 1000})
    signature = base64.urlsafe_b64encode(hmac.new(secret.encode(), f"{header}.{payload}".encode(), hashlib.sha256).digest()).decode().rstrip("=")
    return f"{header}.{payload}.{signature}"


def bearer(secret, sub, roles):
    return {"Authorization": f"Bearer {_jwt(secret, {'sub': sub, 'role': roles[0], 'roles': roles})}", "a2a-version": "1.0"}


def test_the_policy_is_asked_before_a_run_is_moved_over_http_and_who_moved_it_is_recorded(monkeypatch):
    pytest.importorskip("fastapi")
    pytest.importorskip("httpx")
    from fastapi.testclient import TestClient
    import awa.server as server
    from awa.server.authorization import set_authorization

    secret = "seams-secret"
    monkeypatch.setattr(server, "AUTH_ENABLED", True)
    monkeypatch.setattr(server, "JWT_SECRET", secret)
    policy = {"rules": [
        {"id": "operators", "effect": "allow", "actions": ["migrate_run"], "subject": {"roles": ["operator"]}},
        {"id": "host", "effect": "allow", "actions": ["start_run"], "subject": {"ids": ["host"]}},
    ]}
    workflow_id, v1, v2 = payment_versions()
    host = AwaRuntime(engine=engine_options(authorization={"policy": policy}))
    host.register_workflow(v1)
    host.register_workflow(v2)
    server.set_journey_runtime(host)
    set_authorization({"policy": policy})
    try:
        client = TestClient(server.app)
        run = host.start(workflow_id, {}, version="1.0.0")
        route = f"/api/v1/journeys/runs/{run.run_id}/migrate"
        refused = client.post(route, json={"to_version": "2.0.0"}, headers=bearer(secret, "mallory", ["clerk"]))
        assert refused.status_code == 403
        body = refused.json()
        assert body["code"] == "FORBIDDEN" and body["decision"]["action"] == "migrate_run"
        assert body["decision"]["principal"] == {"id": "mallory", "kind": "person"}
        assert host.get_run(run.run_id).workflow.version == "1.0.0"
        assert client.post(f"{route}?dry_run=true", json={"to_version": "2.0.0"}, headers=bearer(secret, "mallory", ["clerk"])).status_code == 403
        moved = client.post(route, json={"to_version": "2.0.0"}, headers=bearer(secret, "olga", ["operator"]))
        assert moved.status_code == 200 and moved.json()["applied"] is True
        migrated = next(e for e in host.get_run(run.run_id).get_events() if e["type"] == "run.migrated")
        assert migrated["data"]["principal"] == {"id": "olga", "kind": "person"}
    finally:
        set_authorization(None)
        server.set_journey_runtime(None)


def test_a_workflow_offered_over_a2a_is_started_as_the_caller_and_the_policy_is_asked_before_starting_or_cancelling(monkeypatch):
    fastapi = pytest.importorskip("fastapi")
    pytest.importorskip("httpx")
    from fastapi import Depends
    from fastapi.testclient import TestClient
    import awa.server as server
    from awa.server.a2a import mount_a2a
    from awa.server.authorization import set_authorization

    secret = "seams-secret"
    monkeypatch.setattr(server, "AUTH_ENABLED", True)
    monkeypatch.setattr(server, "JWT_SECRET", secret)
    policy = {"rules": [
        {"id": "agents-start", "effect": "allow", "actions": ["start_run"], "subject": {"roles": ["partner"]}},
        # Runs the host starts are allowed: an A2A caller must not pass for the host
        {"id": "host", "effect": "allow", "actions": ["start_run", "cancel_run"], "subject": {"ids": ["host"]}},
    ]}
    offered = workflow("Triage", [{"name": "Assess", "human": True}])
    app = fastapi.FastAPI()
    mount_a2a(app, [offered], engine_options=lambda: engine_options(authorization={"policy": policy}),
              authenticated=True, dependencies=[Depends(server.rate_limiter)])
    set_authorization({"policy": policy})
    try:
        client = TestClient(app)

        def send(sub, roles):
            return client.post(f"/a2a/{offered.id}", headers=bearer(secret, sub, roles), json={
                "jsonrpc": "2.0", "id": 1, "method": "SendMessage",
                "params": {"message": {"role": "ROLE_USER", "messageId": str(uuid4()), "parts": [{"data": {"claim": 1}}]}}})

        refused = send("mallory", ["visitor"])
        assert refused.status_code == 403
        assert refused.json()["code"] == "FORBIDDEN" and refused.json()["decision"]["action"] == "start_run"
        assert refused.json()["decision"]["principal"] == {"id": "mallory", "kind": "person"}
        started = send("pat", ["partner"])
        assert started.status_code == 200
        task = started.json()["result"]["task"]
        assert task["status"]["state"] == "TASK_STATE_WORKING"
        cancelled = client.post(f"/a2a/{offered.id}", headers=bearer(secret, "pat", ["partner"]),
                                json={"jsonrpc": "2.0", "id": 2, "method": "CancelTask", "params": {"id": task["id"]}})
        assert cancelled.status_code == 403 and cancelled.json()["decision"]["action"] == "cancel_run"
    finally:
        set_authorization(None)


# --- a child run on a shared store (24.8, 25.1, 29, 30) ------------------------------------------

UNAVAILABLE = postgres_unavailable()


@pytest.fixture(scope="module")
def postgres():
    server = TestPostgres()
    yield server
    server.stop()


@pytest.mark.skipif(UNAVAILABLE is not None, reason=f"shared store tests need PostgreSQL: {UNAVAILABLE}")
def test_another_host_keeps_a_child_run_on_its_version_and_decides_separation_of_duties_on_the_parents_record(postgres):
    from awa.runtime.postgres_store import PostgresRuntimeStore, open_runtime_store
    approval_id, claim_id, ids = str(uuid4()), str(uuid4()), {}
    v1 = workflow("Approval", [{"name": "Review", "human": True}, "Record"], approval_id, "1.0.0", ids)
    v2 = workflow("Approval", [{"name": "Review", "human": True}, "Record", "Audit"], approval_id, "2.0.0", ids)
    caller = workflow("Claim", [{"name": "Submit", "human": True}, {"name": "Approve", "call": approval_id}, "Pay"], claim_id)
    url = postgres.database()
    store = PostgresRuntimeStore(url)
    for d in (caller, v1):
        store.add_definition(copy.deepcopy(document(d)))
    store.close()
    a = open_runtime_store(url, engine=engine_options(authorization={"policy": POLICY}))
    b = open_runtime_store(url, engine=engine_options(authorization={"policy": POLICY}))
    try:
        run = a.start(claim_id, {}, principal=person("alice"))
        a.resume(run.run_id, waiting_at(run.get_events(), "Submit"), {}, person("alice"))
        a.refresh()
        child = a.get_run(run.run_id).subworkflow_runs()[0]
        review = waiting_at(a.get_run(run.run_id).get_subworkflow_events(child["run_id"]), "Review")
        # Version 2 is registered on the other host while the child waits
        b.register_workflow(v2)
        with pytest.raises(AuthorizationError):
            b.resume(child["run_id"], review, {}, person("alice"))
        assert b.resume(child["run_id"], review, {}, person("bob")) is True
        b.refresh()
        parent = b.get_run(run.run_id)
        assert parent.status.value == "completed"
        assert "Audit" not in [e.get("node_name") for e in parent.get_subworkflow_events(child["run_id"])]
    finally:
        a.close()
        b.close()


# -- Engine state cannot be posed by a caller (5.2, 30.4) ---------------------

def test_the_reserved_properties_of_a_run_input_are_dropped_so_a_continuation_never_exempts_an_activity():
    pay = workflow("Pay out", ["Pay"])
    # People may start runs; no rule lets the application perform Pay
    policy = {"rules": [{"id": "people-start", "effect": "allow", "actions": ["start_run"], "subject": {"kinds": ["person"]}}]}
    journal = InMemoryJournalStore()
    engine = WorkflowEngine(pay, options=engine_options(journal=journal, principal=person("mallory"), authorization={"policy": policy}))
    engine.start({"amount": 10, "_agent_continuation": {"input": "approved"}, "_requires_human_action": True})
    engine.run()
    events = engine.get_events()
    assert engine.status.value == "failed"
    decided = next(e for e in events if e["type"] == "authorization.decided")["data"]
    assert (decided["action"], decided["decision"], decided["reason"]) == ("perform_activity", "deny", "no_rule")
    assert next(e for e in events if e["type"] == "run.started")["data"]["input"] == {"amount": 10}
    assert not any(e["type"] == "activity.completed" for e in events)


# -- A server started with a deployment applies it to every route (17.4, 31.1) -

def test_the_journey_host_of_the_server_gives_runs_the_deployment_guardrails_and_permissions(monkeypatch, tmp_path):
    from awa.server import journeys as journey_routes
    from awa.server.deployment import server_deployment_options, set_server_deployment
    outputs = tmp_path / "outputs.json"
    outputs.write_text(json.dumps({"Reply": {"output": {"text": "Write to ann@example.com"}}}))
    monkeypatch.setenv("AWA_SIMULATE", "1")
    monkeypatch.setenv("AWA_SIMULATED_OUTPUTS", str(outputs))
    monkeypatch.delenv("AWA_DATA_DIR", raising=False)
    monkeypatch.delenv("AWA_RUNTIME_STORE", raising=False)
    guardrail = {"id": str(uuid4()), "name": "No personal data out", "stages": ["output"], "check": {"kind": "personal_data"},
                 "action": "block", "actor_types": ["application"]}
    journey_routes.set_journey_runtime(None)
    set_server_deployment({"tools": {"allow_commands": ["git"]}, "a2a": {}, "guardrails": [guardrail]})
    try:
        assert server_deployment_options()["tools"] == {"allow_commands": ["git"]}
        host = journey_routes._host()
        reply = workflow("Reply", ["Reply"])
        host.register_workflow(reply)
        run = host.start(str(reply.id), {})
        events = run.get_events()
        assert run.status.value == "failed"
        triggered = next(e for e in events if e["type"] == "guardrail.triggered")["data"]
        assert (triggered["guardrail_id"], triggered["action"]) == (guardrail["id"], "block")
        assert "ann@example.com" not in json.dumps(events, default=str)
    finally:
        journey_routes.set_journey_runtime(None)
        set_server_deployment(None)


def test_awa_serve_with_a_store_and_without_a2a_starts(monkeypatch):
    import argparse
    import uvicorn
    from awa.cli import serve_api
    started = {}
    monkeypatch.setattr(uvicorn, "run", lambda app, host, port: started.update(host=host, port=port))
    monkeypatch.delenv("AWA_RUNTIME_STORE", raising=False)
    args = argparse.Namespace(host="127.0.0.1", port=3999, deployment=None, a2a=[], public_url=None,
                              store="postgresql://awa@localhost/awa")
    assert serve_api(args) == 0
    assert started == {"host": "127.0.0.1", "port": 3999}
    assert os.environ["AWA_RUNTIME_STORE"] == "postgresql://awa@localhost/awa"
    monkeypatch.delenv("AWA_RUNTIME_STORE", raising=False)
