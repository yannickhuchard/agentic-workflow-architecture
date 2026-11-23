"""
The run routes of the server, as the reference server and the OpenAPI
description give them: start a run, read it, its workflow and its journal,
follow the journal as Server-Sent Events, and deliver business events.
"""

import json
import os
import time
from uuid import uuid4

import pytest

# The same settings as the other server tests, whichever module imports the server first
os.environ.setdefault("AUTH_ENABLED", "true")
os.environ.setdefault("JWT_SECRET", "super-secret-key-for-testing-12345")
os.environ.setdefault("API_KEYS", "apikey123:admin,operator456:operator")
os.environ.setdefault("AWA_DATABASE_URL", "test_awa_server.db")

from fastapi.testclient import TestClient  # noqa: E402

import awa.server as server  # noqa: E402

HEADERS = {"x-api-key": "apikey123"}


def uid():
    return str(uuid4())


def straight():
    role = uid()
    a, b = ({"id": uid(), "name": name, "role_id": role, "actor_type": "application"} for name in ("Receive", "Ship"))
    return {"id": uid(), "name": "Orders", "version": "1.0.0", "activities": [a, b],
            "edges": [{"id": uid(), "source_id": a["id"], "target_id": b["id"]}]}


def waiting():
    role = uid()
    ask, yes, no = ({"id": uid(), "name": name, "role_id": role, "actor_type": "application"} for name in ("Ask", "Yes", "No"))
    reply = {"id": uid(), "name": "Reply", "event_type": "message",
             "event_definition": {"name": "customer.replied", "correlation_key": "case_id"}}
    return {"id": uid(), "name": "Replies", "version": "1.0.0", "activities": [ask, yes, no], "events": [reply],
            "edges": [{"id": uid(), "source_id": ask["id"], "target_id": reply["id"]},
                      {"id": uid(), "source_id": reply["id"], "target_id": yes["id"], "condition": "answer == yes"},
                      {"id": uid(), "source_id": reply["id"], "target_id": no["id"], "is_default": True}]}


@pytest.fixture
def client(tmp_path, monkeypatch):
    monkeypatch.setenv("AWA_WORKFLOWS_DIR", str(tmp_path))
    monkeypatch.delenv("AWA_JOURNAL_DIR", raising=False)
    return TestClient(server.app)


def settle(client, run_id, until=("completed", "failed", "cancelled")):
    for _ in range(200):
        body = client.get(f"/api/v1/workflows/runs/{run_id}", headers=HEADERS).json()
        if body["status"] in until:
            return body
        time.sleep(0.02)
    raise AssertionError(f"run {run_id} did not settle: {body}")


def start(client, tmp_path, document, **body):
    (tmp_path / "flow.json").write_text(json.dumps(document))
    response = client.post("/api/v1/workflows/run", json={"filePath": "flow.json", **body}, headers=HEADERS)
    assert response.status_code == 200, response.text
    return response.json()


def test_a_run_its_workflow_and_its_journal(client, tmp_path):
    document = straight()
    started = start(client, tmp_path, document, input={"order_id": "A-1"}, simulate=True)
    assert started["status"] == "running" and started["message"] == "Workflow started"
    run_id = started["runId"]

    run = settle(client, run_id)
    assert run["runId"] == run_id and run["workflowId"] == document["id"] and run["status"] == "completed"
    assert [set(t) for t in run["tokens"]] == [{"id", "node_id", "status"}]
    assert run["tokens"][0]["status"] == "completed"

    assert client.get(f"/api/v1/workflows/runs/{run_id}/workflow", headers=HEADERS).json() == document

    events = client.get(f"/api/v1/workflows/runs/{run_id}/events", headers=HEADERS).json()
    assert [e["seq"] for e in events] == list(range(1, len(events) + 1))
    assert events[0]["type"] == "run.started" and events[0]["data"]["input"] == {"order_id": "A-1"}
    assert events[0]["data"]["simulate"] is True and events[-1]["type"] == "run.completed"
    later = client.get(f"/api/v1/workflows/runs/{run_id}/events?after=3", headers=HEADERS).json()
    assert [e["seq"] for e in later] == [e["seq"] for e in events[3:]]

    # The route of earlier versions of this server still answers
    old = client.get(f"/api/v1/workflows/run/{run_id}", headers=HEADERS).json()
    assert old["runId"] == run_id and old["status"] == "completed" and "context_data" in old["tokens"][0]


def test_the_journal_as_server_sent_events(client, tmp_path):
    run_id = start(client, tmp_path, straight())["runId"]
    settle(client, run_id)
    events = client.get(f"/api/v1/workflows/runs/{run_id}/events", headers=HEADERS).json()

    response = client.get(f"/api/v1/workflows/runs/{run_id}/events/stream", headers=HEADERS)
    assert response.status_code == 200 and response.headers["content-type"].startswith("text/event-stream")
    messages = [m for m in response.text.split("\n\n") if m.strip()]
    assert len(messages) == len(events)
    for message, event in zip(messages, events):
        lines = dict(line.split(": ", 1) for line in message.split("\n"))
        assert lines["id"] == str(event["seq"]) and lines["event"] == event["type"]
        assert json.loads(lines["data"]) == event

    resumed = client.get(f"/api/v1/workflows/runs/{run_id}/events/stream?after=2", headers=HEADERS).text
    assert resumed.startswith("id: 3\n")
    by_header = client.get(f"/api/v1/workflows/runs/{run_id}/events/stream", headers={**HEADERS, "Last-Event-ID": "4"}).text
    assert by_header.startswith("id: 5\n")


def test_a_business_event_resumes_the_runs_waiting_for_it(client, tmp_path):
    run_id = start(client, tmp_path, waiting(), input={"case_id": "C-1"})["runId"]
    assert settle(client, run_id, until=("waiting_event",))["status"] == "waiting_event"

    other = client.post("/api/v1/workflows/events", headers=HEADERS,
                        json={"id": uid(), "type": "customer.replied", "data": {"case_id": "OTHER", "answer": "no"}})
    assert other.status_code == 202 and other.json()["resumed_runs"] == []

    event_id = uid()
    delivered = client.post("/api/v1/workflows/events", headers=HEADERS,
                            json={"id": event_id, "type": "customer.replied", "data": {"case_id": "C-1", "answer": "yes"}})
    assert delivered.status_code == 202
    assert delivered.json() == {"event_id": event_id, "resumed_runs": [run_id]}
    assert settle(client, run_id)["status"] == "completed"
    received = [e for e in client.get(f"/api/v1/workflows/runs/{run_id}/events", headers=HEADERS).json()
                if e["type"] == "event.received"]
    assert received[0]["data"]["event_id"] == event_id and received[0]["data"]["source"] == "/http"

    bad = client.post("/api/v1/workflows/events", headers=HEADERS, json={"type": "customer.replied"})
    assert bad.status_code == 400 and bad.json()["code"] == "VALIDATION_ERROR"


def test_errors_take_the_form_of_the_openapi_description(client, tmp_path):
    missing = uid()
    for path in ("", "/workflow", "/events", "/events/stream"):
        response = client.get(f"/api/v1/workflows/runs/{missing}{path}", headers=HEADERS)
        assert response.status_code == 404 and response.json() == {"code": "NOT_FOUND", "message": "Run not found"}

    outside = client.post("/api/v1/workflows/run", json={"filePath": "../elsewhere.json"}, headers=HEADERS)
    assert outside.status_code == 400 and "inside the workflows directory" in outside.json()["message"]
    (tmp_path / "invalid.json").write_text(json.dumps({"name": "No id"}))
    invalid = client.post("/api/v1/workflows/run", json={"filePath": "invalid.json"}, headers=HEADERS)
    assert invalid.status_code == 400 and invalid.json()["code"] == "VALIDATION_ERROR"
    assert client.post("/api/v1/workflows/run", json={"filePath": "absent.json"}, headers=HEADERS).status_code == 404


def test_a_workflow_given_in_the_request_and_the_journal_directory(client, tmp_path, monkeypatch):
    journals = tmp_path / "journals"
    monkeypatch.setenv("AWA_JOURNAL_DIR", str(journals))
    response = client.post("/api/v1/workflows/run", headers=HEADERS,
                           json={"workflow_data": straight(), "initial_data": {"order_id": "B-2"}})
    run_id = response.json()["runId"]
    settle(client, run_id)
    lines = (journals / f"{run_id}.journal.jsonl").read_text().splitlines()
    assert json.loads(lines[0])["data"]["input"] == {"order_id": "B-2"}
