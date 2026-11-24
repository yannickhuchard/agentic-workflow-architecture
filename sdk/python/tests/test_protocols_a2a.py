"""
Agents over A2A (specification section 28), against agents the tests start on localhost:
an agent built with the reference A2A SDK (the `a2a-sdk` package), this SDK's own host
offering a workflow, and, when Node.js and the TypeScript SDK's packages are there, the
TypeScript SDK's host.
"""

import json
import os
import shutil
import socket
import subprocess
import tempfile
import threading
import time
import urllib.request
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path

import pytest

from awa.runtime.workflow_engine import WorkflowEngine
from awa.types import Workflow

uvicorn = pytest.importorskip("uvicorn")
fastapi = pytest.importorskip("fastapi")

ROOT = Path(__file__).resolve().parents[3]
TRIAGE = ROOT / "sdk" / "typescript" / "tests" / "fixtures" / "protocols" / "triage.awa.json"
TYPESCRIPT = ROOT / "sdk" / "typescript"


def free_port():
    with socket.socket() as probe:
        probe.bind(("127.0.0.1", 0))
        return probe.getsockname()[1]


def serve(app):
    """Run an ASGI app on a free port in a thread; returns its base URL and a stop function"""
    port = free_port()
    server = uvicorn.Server(uvicorn.Config(app, host="127.0.0.1", port=port, log_level="error"))
    thread = threading.Thread(target=server.run, daemon=True)
    thread.start()
    for _ in range(200):
        if server.started:
            break
        time.sleep(0.02)

    def stop():
        server.should_exit = True
        thread.join(timeout=5)
    return f"http://127.0.0.1:{port}", port, stop


def delegating(card, **extra):
    """A workflow with one activity that the agent at `card` performs"""
    return Workflow.model_validate({
        "id": "a2a00000-0000-4000-8000-000000000001", "name": "Delegate", "version": "1.0.0", "awa_version": "1.1",
        "activities": [{"id": "a2a00000-0000-4000-8000-000000000010", "name": "Assess", "description": "Assess the claim",
                        "role_id": "a2a00000-0000-4000-8000-000000000090", "actor_type": "ai_agent",
                        "a2a": {"agent_card": card, **extra}}],
        "edges": [],
    })


def run(workflow, data, **options):
    a2a = {"poll_interval_ms": 20, **options.pop("a2a", {})}
    engine = WorkflowEngine(workflow, options={"log_execution": False, "a2a": a2a, **options})
    status = engine.run(data)["status"]
    return engine, status, engine.get_events()


# --- an agent built with the reference SDK -------------------------------------

@pytest.fixture(scope="module")
def reference():
    pytest.importorskip("a2a.server.routes", reason="the reference A2A agent needs the 'a2a-sdk' package")
    from starlette.applications import Starlette
    from a2a.helpers.proto_helpers import get_data_parts, new_data_part, new_task, new_text_part
    from a2a.server.agent_execution.agent_executor import AgentExecutor
    from a2a.server.request_handlers import DefaultRequestHandler
    from a2a.server.routes import create_agent_card_routes, create_jsonrpc_routes
    from a2a.server.tasks.inmemory_task_store import InMemoryTaskStore
    from a2a.server.tasks.task_updater import TaskUpdater
    from a2a.types.a2a_pb2 import AgentCapabilities, AgentCard, AgentInterface, AgentSkill, TaskState

    class Assessor(AgentExecutor):
        async def execute(self, context, event_queue):
            data = {}
            for value in get_data_parts(context.message.parts):
                if isinstance(value, dict):
                    data.update(value)
            follow_up = context.current_task is not None
            if not follow_up:
                await event_queue.enqueue_event(new_task(context.task_id, context.context_id, TaskState.TASK_STATE_SUBMITTED))
            updater = TaskUpdater(event_queue, context.task_id, context.context_id)
            if data.get("policy_needed") and not follow_up:
                await updater.requires_input(updater.new_agent_message([new_text_part("Which policy?")]))
                return
            answer = ({"decision": "approve", "policy": data.get("policy")} if follow_up else
                      {"decision": "approve" if float(data.get("amount", 0)) < 1000 else "refer", "seen": data})
            await updater.add_artifact([new_data_part(answer)], name="assessment")
            await updater.complete()

        async def cancel(self, context, event_queue):
            pass

    hits = {"n": 0}
    port = free_port()
    base = f"http://127.0.0.1:{port}"
    card = AgentCard(name="Reference assessor", description="An agent built with a2a-sdk", version="1.0.0",
                     supported_interfaces=[AgentInterface(url=f"{base}/a2a", protocol_binding="JSONRPC", protocol_version="1.0")],
                     capabilities=AgentCapabilities(streaming=False), default_input_modes=["application/json"],
                     default_output_modes=["application/json"],
                     skills=[AgentSkill(id="assess", name="Assess", description="Assess a claim", tags=["claims"])])
    handler = DefaultRequestHandler(agent_executor=Assessor(), task_store=InMemoryTaskStore(), agent_card=card)
    app = Starlette(routes=[*create_agent_card_routes(card), *create_jsonrpc_routes(handler, "/a2a")])

    async def count(scope, receive, send):
        if scope["type"] == "http":
            hits["n"] += 1
        await app(scope, receive, send)

    server = uvicorn.Server(uvicorn.Config(count, host="127.0.0.1", port=port, log_level="error"))
    thread = threading.Thread(target=server.run, daemon=True)
    thread.start()
    while not server.started:
        time.sleep(0.02)
    yield {"base": base, "card": f"{base}/.well-known/agent-card.json", "hits": hits}
    server.should_exit = True
    thread.join(timeout=5)


def test_the_reference_agent_performs_an_activity(reference):
    engine, status, events = run(delegating(reference["card"]), {"claim_id": "C-1", "amount": 400, "_private": "not sent"})
    assert status == "completed"
    data = engine.tokens[0].context_data
    assert data["decision"] == "approve" and data["seen"]["claim_id"] == "C-1" and "_private" not in data["seen"]
    sent = next(e for e in events if e["type"] == "agent.message_sent")["data"]
    assert sent["agent"] == reference["card"] and sent["link"] == f"{reference['base']}/a2a"
    assert next(e for e in events if e["type"] == "agent.task_updated")["data"]["state"] == "TASK_STATE_COMPLETED"


def test_input_the_agent_asks_for_is_sent_on_the_same_task(reference):
    engine, status, events = run(delegating(reference["card"]), {"claim_id": "C-2", "policy_needed": True})
    assert status == "waiting_human"
    [request] = engine.agent_requests()
    assert request["request"]["parts"][0]["text"] == "Which policy?"
    waiting = next(e for e in events if e["type"] == "token.waiting")["data"]
    assert waiting["reason"] == "agent_input" and waiting["task_id"] == request["task_id"]
    assert engine.resume_token(request["token_id"], {"decision": "forged"}) is False
    assert engine.answer_agent(request["token_id"], {"policy": "P-9"})
    assert engine.run()["status"] == "completed"
    assert engine.tokens[0].context_data["policy"] == "P-9"
    last = [e for e in engine.get_events() if e["type"] == "agent.message_sent"][-1]["data"]
    assert last["task_id"] == request["task_id"]


def test_an_agent_at_a_host_not_allowed_is_not_reached(reference):
    before = reference["hits"]["n"]
    _, status, events = run(delegating(reference["card"]), {"amount": 1}, a2a={"allowed_hosts": ["agents.example.com"]})
    assert status == "failed"
    assert next(e for e in events if e["type"] == "activity.failed")["data"]["error"]["code"] == "PERMISSION_DENIED"
    _, status, _ = run(delegating(reference["card"]), {"amount": 1}, tools={"allowed_hosts": ["agents.example.com"]})
    assert status == "failed"
    assert reference["hits"]["n"] == before


def test_simulation_calls_nothing(reference):
    before = reference["hits"]["n"]
    engine, status, events = run(delegating(reference["card"]), {"amount": 1}, simulate=True,
                                 simulated_outputs={"Assess": {"output": {"decision": "simulated"}}})
    assert status == "completed" and engine.tokens[0].context_data["decision"] == "simulated"
    assert next(e for e in events if e["type"] == "agent.message_sent")["data"]["simulated"] is True
    assert reference["hits"]["n"] == before


def test_a_redirect_to_a_host_not_on_the_list_is_refused():
    reached = {"n": 0}

    class Elsewhere(BaseHTTPRequestHandler):
        def do_GET(self):
            reached["n"] += 1
            self.send_response(200)
            self.end_headers()
            self.wfile.write(b"{}")

        def log_message(self, *args):
            pass

    elsewhere = HTTPServer(("127.0.0.1", 0), Elsewhere)
    target = f"http://127.0.0.1:{elsewhere.server_port}/card.json"

    class Redirecting(BaseHTTPRequestHandler):
        def do_GET(self):
            self.send_response(302)
            self.send_header("location", target)
            self.end_headers()

        def log_message(self, *args):
            pass

    redirecting = HTTPServer(("127.0.0.1", 0), Redirecting)
    for server in (elsewhere, redirecting):
        threading.Thread(target=server.serve_forever, daemon=True).start()
    try:
        _, status, events = run(delegating(f"http://127.0.0.1:{redirecting.server_port}/.well-known/agent-card.json"), {},
                                a2a={"allowed_hosts": [f"127.0.0.1:{redirecting.server_port}"]})
        assert status == "failed"
        assert next(e for e in events if e["type"] == "activity.failed")["data"]["error"]["code"] == "PERMISSION_DENIED"
        assert reached["n"] == 0
    finally:
        elsewhere.shutdown()
        redirecting.shutdown()


# --- awa serve offers a workflow -----------------------------------------------

@pytest.fixture(scope="module")
def host():
    from awa.cli.run import read_workflow
    from awa.server.a2a import mount_a2a
    app = fastapi.FastAPI()
    triage = read_workflow(str(TRIAGE))
    mount_a2a(app, [triage])
    base, port, stop = serve(app)
    yield {"base": base, "id": str(triage.id)}
    stop()


def rpc(host, method, params, version="1.0"):
    request = urllib.request.Request(f"{host['base']}/a2a/{host['id']}", method="POST",
                                     data=json.dumps({"jsonrpc": "2.0", "id": 1, "method": method, "params": params}).encode(),
                                     headers={"content-type": "application/json", "a2a-version": version})
    with urllib.request.urlopen(request, timeout=10) as response:
        return json.loads(response.read())


def test_the_card_is_served_at_the_workflow_address_and_at_the_root(host):
    for url in (f"{host['base']}/a2a/{host['id']}/.well-known/agent-card.json", f"{host['base']}/.well-known/agent-card.json"):
        with urllib.request.urlopen(url, timeout=5) as response:
            card = json.loads(response.read())
        assert card["name"] == "Claim triage" and card["version"] == "1.2.0"
        assert card["supportedInterfaces"] == [{"url": f"{host['base']}/a2a/{host['id']}", "protocolBinding": "JSONRPC", "protocolVersion": "1.0"}]
        assert card["capabilities"] == {"streaming": False, "pushNotifications": False}
        assert card["skills"][0]["id"] == host["id"]


def test_the_reference_client_runs_the_workflow(host):
    pytest.importorskip("a2a.client", reason="the reference A2A client needs the 'a2a-sdk' package")
    import asyncio
    import httpx
    from a2a.client import ClientConfig, ClientFactory
    from a2a.helpers.proto_helpers import new_data_part
    from a2a.types.a2a_pb2 import Message, Role, SendMessageRequest, TaskState

    async def call():
        async with httpx.AsyncClient(timeout=10) as http:
            client = await ClientFactory(ClientConfig(httpx_client=http, streaming=False)).create_from_url(host["base"])
            request = SendMessageRequest(message=Message(message_id="m1", role=Role.ROLE_USER, parts=[new_data_part({"amount": 2500, "claim": "C-9"})]))
            results = [item async for item in client.send_message(request)]
            await client.close()
            return results

    results = asyncio.run(call())
    task = results[-1].task if hasattr(results[-1], "task") else results[-1][0]
    assert task.status.state == TaskState.TASK_STATE_COMPLETED
    from google.protobuf.json_format import MessageToDict
    output = MessageToDict(task.artifacts[0].parts[0].data)
    assert output["tier"] == "large" and output["claim"] == "C-9"


def test_this_engine_delegates_to_the_host(host):
    engine, status, events = run(delegating(f"{host['base']}/.well-known/agent-card.json"), {"amount": 300})
    assert status == "completed"
    assert engine.tokens[0].context_data["tier"] == "small"
    assert [e["data"]["state"] for e in events if e["type"] == "agent.task_updated"] == ["TASK_STATE_COMPLETED"]


def test_the_host_answers_with_the_errors_a2a_defines(host):
    assert rpc(host, "GetTask", {"id": "nope"})["error"]["code"] == -32001
    assert rpc(host, "SendStreamingMessage", {})["error"]["code"] == -32004
    assert rpc(host, "Unknown", {})["error"]["code"] == -32601
    assert rpc(host, "GetTask", {"id": "x"}, version="0.3")["error"]["code"] == -32009
    done = rpc(host, "SendMessage", {"message": {"messageId": "m", "role": "ROLE_USER", "parts": [{"data": {"amount": 1}}]}})
    task = done["result"]["task"]
    assert task["status"]["state"] == "TASK_STATE_COMPLETED"
    assert rpc(host, "CancelTask", {"id": task["id"]})["error"]["code"] == -32002
    more = {"messageId": "m2", "role": "ROLE_USER", "taskId": task["id"], "parts": [{"text": "more"}]}
    assert rpc(host, "SendMessage", {"message": more})["error"]["code"] == -32004


def test_a_run_starts_from_text_parts_and_can_answer_at_once(host):
    reply = rpc(host, "SendMessage", {"message": {"messageId": "m3", "role": "ROLE_USER", "contextId": "ctx-7",
                                                  "parts": [{"text": "hello"}, {"data": {"amount": 5}}]},
                                      "configuration": {"returnImmediately": True}})
    task = reply["result"]["task"]
    assert task["contextId"] == "ctx-7"
    for _ in range(100):
        if task["status"]["state"] == "TASK_STATE_COMPLETED":
            break
        time.sleep(0.02)
        task = rpc(host, "GetTask", {"id": task["id"]})["result"]
    data = task["artifacts"][0]["parts"][0]["data"]
    assert data["text"] == "hello" and data["tier"] == "small" and "activities" not in data


# --- across SDKs: this SDK's client against the TypeScript SDK's host -----------

@pytest.fixture(scope="module")
def typescript_host():
    node = shutil.which("node")
    esbuild = TYPESCRIPT / "node_modules" / ".bin" / "esbuild"
    if not node or not esbuild.exists():
        pytest.skip("the TypeScript SDK's packages are not installed (npm ci in sdk/typescript)")
    bundle = TYPESCRIPT / "node_modules" / ".cache" / "awa-test" / "cli.cjs"
    subprocess.run([str(esbuild), "src/cli/index.ts", "--bundle", "--platform=node", "--format=cjs", "--packages=external",
                    f"--outfile={bundle}", "--log-level=error"], cwd=TYPESCRIPT, check=True, timeout=120)
    database = Path(tempfile.mkdtemp()) / "awa.db"
    shutil.copy(TYPESCRIPT / "prisma" / "awa.db", database)
    port = free_port()
    process = subprocess.Popen([node, str(bundle), "serve", "--port", str(port), "--no-auth", "--a2a", str(TRIAGE)], cwd=TYPESCRIPT,
                               env={**os.environ, "AWA_DATABASE_URL": f"file:{database}"},
                               stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    base = f"http://127.0.0.1:{port}"
    for _ in range(100):
        try:
            urllib.request.urlopen(f"{base}/.well-known/agent-card.json", timeout=1).close()
            break
        except OSError:
            time.sleep(0.1)
    else:
        process.kill()
        pytest.fail("the TypeScript host did not start")
    yield base
    process.terminate()
    process.wait(timeout=5)


def test_this_engine_delegates_to_the_typescript_host(typescript_host):
    engine, status, events = run(delegating(f"{typescript_host}/.well-known/agent-card.json"), {"amount": 4200, "claim": "C-3"})
    assert status == "completed"
    data = engine.tokens[0].context_data
    assert data["tier"] == "large" and data["claim"] == "C-3"
    assert "/a2a/" in next(e for e in events if e["type"] == "agent.message_sent")["data"]["link"]
