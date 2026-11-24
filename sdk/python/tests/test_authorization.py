"""
Identity and authorization (specification section 30): what the conformance cases cannot reach.
Policy validation, JWT claims, an external decider and its failures, credentials, recovery of
separation of duties and four-eyes approvals, the runtime host, and the HTTP routes.
"""

import base64
import hashlib
import hmac
import json
import os
import time

import pytest

from awa.cli.deployment import load_deployment
from awa.runtime.authorization import (
    AuthorizationError, PolicyDecider, load_authorization, principal_from_claims, validate_policy,
)
from awa.runtime.runtime_host import AwaRuntime
from awa.runtime.workflow_engine import WorkflowEngine
from awa.types import Workflow


def uid(n: int) -> str:
    return f"00000000-0000-4000-8000-{n:012d}"


ROLE = uid(90)


def workflow(*activities: dict) -> Workflow:
    return Workflow.model_validate({
        "id": uid(1), "name": "Claims", "version": "1.0.0", "awa_version": "1.1",
        "roles": [{"id": ROLE, "name": "Clerk", "actor_type": "human"}],
        "activities": [{"id": uid(10 + i), "role_id": ROLE, **a} for i, a in enumerate(activities)],
        "edges": [{"id": uid(50 + i), "source_id": uid(10 + i), "target_id": uid(11 + i)} for i in range(len(activities) - 1)],
    })


class Person:
    def execute(self, activity, token, context=None):
        return {"_requires_human_action": True, "_human_task_id": f"task-{activity.name}"}


class App:
    def execute(self, activity, token, context=None):
        return {"done": True}


ALICE = {"id": "alice", "kind": "person", "attributes": {"roles": ["clerk"]}}
BOB = {"id": "bob", "kind": "person", "attributes": {"roles": ["clerk"]}}
OPEN = {"rules": [{"id": "all", "effect": "allow", "actions": ["*"]}]}


def engine(wf, authorization, **extra):
    return WorkflowEngine(wf, options={
        "actors": {"human": Person(), "application": App(), "ai_agent": App(), "robot": App()},
        "wait_for_human_tasks": True, "authorization": authorization, **extra})


def waiting(e):
    return next(t for t in e.tokens if t.status.value == "waiting")


def decided(e):
    return [ev["data"] for ev in e.get_events() if ev["type"] == "authorization.decided"]


# --- the policy ------------------------------------------------------------------------------------

def test_an_invalid_policy_is_refused_naming_every_problem():
    errors = validate_policy({
        "rules": [
            {"id": "a", "effect": "permit", "actions": ["fly"]},
            {"id": "a", "effect": "allow", "actions": ["start_run"], "condition": "amount >"},
            {"id": "b", "effect": "allow", "actions": ["start_run"], "subject": {"kinds": ["alien"]}, "extra": 1},
        ],
        "separation_of_duties": [{"id": "s", "activities": ["Only"]}],
        "four_eyes": [{"id": "f", "activities": ["Approve"], "approvals": 1}],
        "other": [],
    })
    for fragment in ('unknown property "other"', '"effect" must be', 'unknown action "fly"', 'id "a" is used twice', "condition",
                     'unknown kind "alien"', 'unknown property "extra"', "at least two activities", "at least 2"):
        assert any(fragment in e for e in errors), f"{fragment} in {errors}"
    assert validate_policy(OPEN) == []
    with pytest.raises(ValueError, match="Invalid authorization"):
        load_authorization({"policy": {"rules": [{"id": "x", "effect": "allow", "actions": []}]}})
    with pytest.raises(ValueError, match='acts_for: unknown property "teams"'):
        load_authorization({"principals": [{"id": "p", "kind": "robot", "acts_for": {"teams": []}}]})


def test_a_deployment_file_carries_the_authorization(tmp_path):
    file = tmp_path / "deployment.json"
    file.write_text(json.dumps({"tools": {}, "authorization": {"policy": OPEN, "record_allows": True}}))
    assert load_deployment(str(file))["authorization"]["record_allows"] is True
    file.write_text(json.dumps({"authorization": {"policy": {"rules": [{"id": "x", "effect": "allow", "actions": ["nope"]}]}}}))
    with pytest.raises(ValueError, match='unknown action "nope"'):
        load_deployment(str(file))


def test_a_principal_is_taken_from_the_claims_of_a_jwt():
    assert principal_from_claims({"sub": "u-1", "iat": 1, "exp": 2, "role": "operator", "roles": ["approver"], "groups": ["claims"],
                                  "clearance": 3, "name": "Ann"}) == {
        "id": "u-1", "kind": "person", "name": "Ann",
        "attributes": {"roles": ["approver", "operator"], "groups": ["claims"], "clearance": 3}}
    assert principal_from_claims({"sub": "svc", "kind": "service"})["kind"] == "service"
    assert principal_from_claims({"sub": "x", "kind": "wizard"})["kind"] == "person"


def test_attributes_match_any_of_the_values_a_rule_lists():
    decider = PolicyDecider({"rules": [{"id": "eu", "effect": "allow", "actions": ["start_run"], "subject": {"attributes": {"region": ["eu", "uk"]}}}]})

    def ask(region):
        return decider.decide({"action": "start_run", "principal": {"id": "p", "kind": "person", "attributes": {"region": region}},
                               "resource": {}, "run": {}, "history": {"performed": []}})["decision"]
    assert ask("uk") == "allow" and ask(["us", "eu"]) == "allow" and ask("us") == "deny"


# --- the decider -----------------------------------------------------------------------------------

def test_an_external_decider_decides_and_is_recorded_the_same_way():
    asked = []

    class Opa:
        def decide(self, request):
            asked.append(request["action"])
            if request["principal"]["id"] == "bob":
                return {"decision": "allow", "rule": "opa:allow", "reason": "rule"}
            return {"decision": "deny", "rule": "opa:deny", "reason": "rule", "message": "not bob"}

    e = engine(workflow({"name": "Review", "actor_type": "human"}), {"decider": Opa()}, principal=BOB)
    e.start({})
    e.run()
    with pytest.raises(AuthorizationError) as refused:
        e.resume_token(waiting(e).id, {}, ALICE)
    assert refused.value.code == "FORBIDDEN" and refused.value.decision["rule"] == "opa:deny"
    assert e.resume_token(waiting(e).id, {"ok": True}, BOB) is True
    e.run()
    assert e.status.value == "completed"
    assert asked == ["start_run", "complete_task", "complete_task"]
    assert [(d["action"], d["decision"], d["rule"], d["message"]) for d in decided(e)] == [("complete_task", "deny", "opa:deny", "not bob")]


@pytest.mark.parametrize("answer", [RuntimeError("policy engine unreachable"), {"verdict": "yes"}])
def test_a_decider_that_fails_denies(answer):
    class Broken:
        def decide(self, request):
            if isinstance(answer, Exception):
                raise answer
            return answer

    e = engine(workflow({"name": "Review", "actor_type": "human"}), {"decider": Broken()})
    with pytest.raises(AuthorizationError) as refused:
        e.start({})
    assert refused.value.decision["reason"] == "decider_error"
    assert e.get_events() == []


# --- credentials -----------------------------------------------------------------------------------

def test_an_identity_sends_its_credentials_with_its_http_tool_calls():
    seen = []

    class Caller:
        def execute(self, activity, token, context=None):
            context.tools.call("policy", {})
            return {}

    def http(binding, args, context):
        from awa.runtime.tools import ToolExecution
        seen.append(dict(binding.headers or {}))
        return ToolExecution({}, 200)

    wf = workflow({"name": "Look up", "actor_type": "ai_agent", "tools": [{
        "name": "policy", "description": "Find a policy",
        "binding": {"kind": "http", "method": "GET", "url": "https://api.example/policies",
                    "headers": {"Authorization": "Bearer from-document", "X-Trace": "1"}}}]})
    e = WorkflowEngine(wf, options={
        "actors": {"ai_agent": Caller()},
        "tools": {"secrets": {"BOT_TOKEN": "s3cret"}, "executors": {"http": http}},
        "authorization": {"principals": [{"id": "agent:bot", "kind": "ai_agent", "acts_for": {"activities": ["Look up"]},
                                          "credentials": {"Authorization": "Bearer {{secret:BOT_TOKEN}}"}}]},
    })
    e.run({})
    assert e.status.value == "completed"
    assert seen == [{"authorization": "Bearer {{secret:BOT_TOKEN}}", "x-trace": "1"}]
    assert "BOT_TOKEN" not in json.dumps(e.get_events())


def test_an_identity_sends_its_credentials_to_an_agent_over_a2a():
    card = "https://agents.example/.well-known/agent-card.json"
    headers = []

    def transport(method, url, sent, body):
        headers.append(dict(sent))
        if method == "GET":
            return 200, json.dumps({"name": "A", "supportedInterfaces": [{"url": "https://agents.example/rpc", "protocolBinding": "JSONRPC", "protocolVersion": "1.0"}]})
        request = json.loads(body)
        return 200, json.dumps({"jsonrpc": "2.0", "id": request["id"],
                                "result": {"message": {"messageId": "m", "role": "ROLE_AGENT", "parts": [{"data": {"ok": True}}]}}})

    e = WorkflowEngine(workflow({"name": "Assess", "actor_type": "ai_agent", "a2a": {"agent_card": card}}), options={
        "a2a": {"secrets": {"PARTNER": "p-key"}, "poll_interval_ms": 0, "transport": transport},
        "authorization": {"principals": [{"id": "agent:partner", "kind": "ai_agent", "acts_for": {"agents": [card]},
                                          "credentials": {"X-Api-Key": "{{secret:PARTNER}}"}}]},
    })
    e.run({})
    assert e.status.value == "completed"
    assert headers[-1].get("x-api-key") == "p-key"
    started = next(ev for ev in e.get_events() if ev["type"] == "activity.started")
    assert started["data"]["principal"] == {"id": "agent:partner", "kind": "ai_agent"}


# --- recovery --------------------------------------------------------------------------------------

def test_who_performed_what_and_the_approvals_given_survive_a_checkpoint():
    wf = workflow({"name": "Submit", "actor_type": "human"}, {"name": "Approve", "actor_type": "human"})
    authorization = {"policy": {
        "rules": [{"id": "clerks", "effect": "allow", "actions": ["start_run", "complete_task", "approve"], "subject": {"roles": ["clerk"]}}],
        "separation_of_duties": [{"id": "sod", "activities": ["Submit", "Approve"]}],
        "four_eyes": [{"id": "two", "activities": ["Approve"], "approvals": 2}],
    }}
    first = engine(wf, authorization, principal=BOB)
    first.start({})
    first.run()
    first.resume_token(waiting(first).id, {"amount": 5}, ALICE)
    first.run()
    first.resume_token(waiting(first).id, {"approved": True}, BOB)
    assert first.status.value == "waiting_human"

    restored = WorkflowEngine.restore(wf, json.loads(json.dumps(first.snapshot())), {
        "actors": {"human": Person()}, "wait_for_human_tasks": True, "authorization": authorization})
    with pytest.raises(AuthorizationError) as sod:
        restored.resume_token(waiting(restored).id, {}, ALICE)
    assert sod.value.decision["reason"] == "separation_of_duties"
    with pytest.raises(AuthorizationError) as again:
        restored.resume_token(waiting(restored).id, {}, BOB)
    assert again.value.decision["reason"] == "four_eyes"
    carol = {"id": "carol", "kind": "person", "attributes": {"roles": ["clerk"]}}
    assert restored.resume_token(waiting(restored).id, {"approved": True}, carol) is True
    restored.run()
    assert restored.status.value == "completed"
    completed = next(ev for ev in restored.get_events() if ev["type"] == "activity.completed")
    assert completed["data"]["principal"]["id"] == "carol"
    assert completed["data"]["approvals"] == [{"id": "bob", "kind": "person"}, {"id": "carol", "kind": "person"}]


# --- the runtime host ------------------------------------------------------------------------------

def test_the_host_leaves_no_run_when_a_start_is_refused_and_keeps_a_refused_task_waiting():
    wf = workflow({"name": "Review", "actor_type": "human"})
    policy = {"rules": [{"id": "clerks", "effect": "allow", "actions": ["start_run", "complete_task"], "subject": {"roles": ["clerk"]}}]}
    runtime = AwaRuntime(engine={"actors": {"human": Person()}, "wait_for_human_tasks": True, "authorization": {"policy": policy}})
    runtime.register_workflow(wf)
    with pytest.raises(AuthorizationError):
        runtime.start(str(wf.id), {})   # the host itself is not allowed
    assert runtime.list_runs() == []
    run = runtime.start(str(wf.id), {}, principal=ALICE)
    token = waiting(run).id
    with pytest.raises(AuthorizationError):
        runtime.resume(run.run_id, token, {}, {"id": "mallory", "kind": "person"})
    assert run.status.value == "waiting_human"
    assert runtime.resume(run.run_id, token, {"ok": True}, BOB) is True
    assert run.status.value == "completed"


# --- the Operational API ---------------------------------------------------------------------------

def _jwt(secret: str, claims: dict) -> str:
    encode = lambda value: base64.urlsafe_b64encode(json.dumps(value).encode()).decode().rstrip("=")  # noqa: E731
    header, payload = encode({"alg": "HS256", "typ": "JWT"}), encode({**claims, "exp": (time.time() + 3600) * 1000})
    signature = base64.urlsafe_b64encode(hmac.new(secret.encode(), f"{header}.{payload}".encode(), hashlib.sha256).digest()).decode().rstrip("=")
    return f"{header}.{payload}.{signature}"


def test_the_api_answers_403_where_the_policy_says_no(monkeypatch, tmp_path):
    pytest.importorskip("fastapi")
    pytest.importorskip("httpx")
    from fastapi.testclient import TestClient
    import awa.server as server
    from awa.server.authorization import set_authorization

    secret = "authorization-test-secret"
    monkeypatch.setattr(server, "AUTH_ENABLED", True)
    monkeypatch.setattr(server, "JWT_SECRET", secret)
    policy = {"rules": [
        {"id": "clerks", "effect": "allow", "actions": ["start_run", "complete_task", "read_journal"], "subject": {"roles": ["clerk"]}},
        {"id": "host", "effect": "allow", "actions": ["start_run"], "subject": {"ids": ["host"]}},
    ]}
    wf = workflow({"name": "Review", "actor_type": "human"})
    runtime = AwaRuntime(engine={"actors": {"human": Person()}, "wait_for_human_tasks": True, "authorization": {"policy": policy}})
    runtime.register_workflow(wf)
    server.set_journey_runtime(runtime)
    set_authorization({"policy": policy})
    try:
        client = TestClient(server.app)
        bearer = lambda sub, roles: {"Authorization": f"Bearer {_jwt(secret, {'sub': sub, 'role': 'operator', 'roles': roles})}"}  # noqa: E731
        run = runtime.start(str(wf.id), {})
        token = waiting(run).id
        refused = client.post(f"/api/v1/journeys/runs/{run.run_id}/tokens/{token}/resume", json={"ok": True}, headers=bearer("mallory", ["visitor"]))
        assert refused.status_code == 403
        body = refused.json()
        assert body["code"] == "FORBIDDEN"
        assert body["decision"]["action"] == "complete_task" and body["decision"]["principal"] == {"id": "mallory", "kind": "person"}
        assert run.status.value == "waiting_human"
        allowed = client.post(f"/api/v1/journeys/runs/{run.run_id}/tokens/{token}/resume", json={"ok": True}, headers=bearer("ann", ["clerk"]))
        assert allowed.status_code == 200 and allowed.json() == {"resumed": True}
        completed = next(ev for ev in run.get_events() if ev["type"] == "activity.completed")
        assert completed["data"]["principal"] == {"id": "ann", "kind": "person"}
        # Publishing an event is an action of its own, which this policy allows nobody
        assert client.post("/api/v1/journeys/events", json={"type": "claim.filed", "data": {}}, headers=bearer("ann", ["clerk"])).status_code == 403
        # Starting a run from a file: refused for a visitor before anything runs
        (tmp_path / "claims.json").write_text(wf.model_dump_json(exclude_none=True))
        monkeypatch.setenv("AWA_WORKFLOWS_DIR", str(tmp_path))
        started = client.post("/api/v1/workflows/run", json={"filePath": "claims.json", "simulate": True}, headers=bearer("mallory", ["visitor"]))
        assert started.status_code == 403 and started.json()["decision"]["action"] == "start_run"
    finally:
        set_authorization(None)
        server.set_journey_runtime(None)


def test_an_invalid_policy_given_in_code_is_refused_when_the_engine_is_made():
    with pytest.raises(ValueError, match="unknown action"):
        engine(workflow({"name": "Review", "actor_type": "human"}), {"policy": {"rules": [{"id": "x", "effect": "allow", "actions": ["fly"]}]}})
