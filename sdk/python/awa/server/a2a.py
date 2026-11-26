"""
A workflow offered to other agents as an A2A agent (specification 28.8).

Each workflow is served at `/a2a/<workflow id>`: its agent card at
`/a2a/<workflow id>/.well-known/agent-card.json`, and the A2A 1.0 JSON-RPC
methods SendMessage, GetTask and CancelTask at `/a2a/<workflow id>`. When one
workflow is offered, its card is also at `/.well-known/agent-card.json`.
A message starts a run; the task is the run.
"""

import re
import threading
from collections import OrderedDict
from datetime import datetime, timezone
from typing import Any, Callable
from uuid import uuid4

from awa.runtime.protocols.a2a import A2A_PROTOCOL_VERSION
from awa.types import Workflow

ERRORS = {"invalid_request": -32600, "method_not_found": -32601, "invalid_params": -32602, "internal": -32603,
          "task_not_found": -32001, "task_not_cancelable": -32002, "unsupported": -32004, "version": -32009}
# A2A methods this host does not offer: answered with UnsupportedOperation, not MethodNotFound
UNSUPPORTED = {"SendStreamingMessage", "SubscribeToTask", "ListTasks", "CreateTaskPushNotificationConfig",
               "GetTaskPushNotificationConfig", "ListTaskPushNotificationConfigs", "DeleteTaskPushNotificationConfig",
               "GetExtendedAgentCard"}
ENDED = {"completed", "failed", "cancelled"}
# What the engine keeps in a token's data for itself: the archive of each activity's output and of each decision
RESERVED = {"activities", "decisions"}


def workflow_agent_card(workflow: Workflow, base: str, authenticated: bool = False) -> dict[str, Any]:
    """The card of a workflow offered at `base`"""
    description = workflow.description or f'The AWA workflow "{workflow.name}"'
    card: dict[str, Any] = {
        "name": workflow.name, "description": description, "version": workflow.version,
        "supportedInterfaces": [{"url": base, "protocolBinding": "JSONRPC", "protocolVersion": A2A_PROTOCOL_VERSION}],
        "capabilities": {"streaming": False, "pushNotifications": False},
        "defaultInputModes": ["application/json", "text/plain"],
        "defaultOutputModes": ["application/json"],
        "skills": [{"id": str(workflow.id), "name": workflow.name,
                    "description": workflow.description or f'Runs the workflow "{workflow.name}"', "tags": ["awa", "workflow"]}],
    }
    if authenticated:
        card["securitySchemes"] = {
            "bearer": {"httpAuthSecurityScheme": {"scheme": "Bearer", "bearerFormat": "JWT"}},
            "apiKey": {"apiKeySecurityScheme": {"location": "header", "name": "X-API-Key"}},
        }
        card["securityRequirements"] = [{"schemes": {"bearer": {"list": []}}}, {"schemes": {"apiKey": {"list": []}}}]
    return card


def message_input(parts: list[Any]) -> dict[str, Any]:
    """The input of a run started by a message: its object data parts merged, its texts as `text` (28.8)"""
    data: dict[str, Any] = {}
    texts = []
    for part in parts or []:
        if isinstance(part, dict) and isinstance(part.get("text"), str):
            texts.append(part["text"])
        elif isinstance(part, dict) and isinstance(part.get("data"), dict):
            data.update(part["data"])
    if texts:
        data["text"] = "\n".join(texts)
    return data


def run_output(engine: Any) -> dict[str, Any]:
    """What a run produced: the data of its completed tokens merged, without what the engine keeps for itself"""
    output: dict[str, Any] = {}
    for token in engine.tokens:
        if token.status.value == "completed":
            output.update({k: v for k, v in token.context_data.items() if not k.startswith("_") and k not in RESERVED})
    return output


class _Served:
    def __init__(self, engine: Any, workflow_id: str, context_id: str) -> None:
        self.engine = engine
        self.workflow_id = workflow_id
        self.context_id = context_id
        self.done = threading.Event()


def _task(task_id: str, served: _Served) -> dict[str, Any]:
    status = served.engine.status.value
    now = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
    task: dict[str, Any] = {"id": task_id, "contextId": served.context_id}
    if status == "completed":
        task["status"] = {"state": "TASK_STATE_COMPLETED", "timestamp": now}
        task["artifacts"] = [{"artifactId": f"{task_id}-output", "name": "output",
                              "parts": [{"data": run_output(served.engine), "mediaType": "application/json"}]}]
    elif status == "failed":
        errors = [str(t.get_data("_error") or "failed") for t in served.engine.tokens if t.status.value == "failed"]
        task["status"] = {"state": "TASK_STATE_FAILED", "timestamp": now, "message": {
            "messageId": str(uuid4()), "role": "ROLE_AGENT", "contextId": served.context_id, "taskId": task_id,
            "parts": [{"text": "\n".join(errors) or "The run failed"}]}}
    elif status == "cancelled":
        task["status"] = {"state": "TASK_STATE_CANCELED", "timestamp": now}
    elif status == "idle":
        task["status"] = {"state": "TASK_STATE_SUBMITTED", "timestamp": now}
    else:
        # running, waiting for a person or for an event: what the run waits for is the host's to handle
        task["status"] = {"state": "TASK_STATE_WORKING", "timestamp": now}
    return task


def mount_a2a(app: Any, workflows: list[Workflow], *, engine_options: Callable[[], dict[str, Any]] | None = None,
              public_url: str | None = None, authenticated: bool = False, dependencies: list[Any] | None = None,
              max_tasks: int = 500) -> None:
    """Offer workflows as A2A agents on a FastAPI app. The cards need no authentication; `dependencies` guard the rest."""
    from fastapi import Request
    from fastapi.responses import JSONResponse
    from awa.runtime import WorkflowEngine
    from awa.runtime.authorization import AuthorizationError
    from awa.server.authorization import authorize_request, forbidden, request_principal

    by_id = {str(w.id): w for w in workflows}
    tasks: "OrderedDict[str, _Served]" = OrderedDict()
    lock = threading.Lock()

    def base_of(request: Request, workflow_id: str) -> str:
        root = (public_url or str(request.base_url)).rstrip("/")
        return f"{root}/a2a/{workflow_id}"

    def card(request: Request, workflow_id: str) -> Any:
        workflow = by_id.get(workflow_id)
        if workflow is None:
            return JSONResponse({"error": "No such agent"}, status_code=404)
        return workflow_agent_card(workflow, base_of(request, workflow_id), authenticated)

    app.add_api_route("/a2a/{workflow_id}/.well-known/agent-card.json", card, methods=["GET"])
    if len(workflows) == 1:
        only = str(workflows[0].id)

        def root_card(request: Request) -> Any:
            return card(request, only)
        app.add_api_route("/.well-known/agent-card.json", root_card, methods=["GET"])

    def keep(task_id: str, served: _Served) -> None:
        with lock:
            tasks[task_id] = served
            for old in list(tasks):
                if len(tasks) <= max_tasks:
                    break
                if tasks[old].engine.status.value in ENDED:
                    del tasks[old]

    def rpc(workflow_id: str, request: Request, body: dict[str, Any]) -> Any:
        request_id = body.get("id") if isinstance(body, dict) else None

        def reply(result: Any) -> dict[str, Any]:
            return {"jsonrpc": "2.0", "id": request_id, "result": result}

        def fail(code: int, message: str) -> dict[str, Any]:
            return {"jsonrpc": "2.0", "id": request_id, "error": {"code": code, "message": message}}

        workflow = by_id.get(workflow_id)
        if workflow is None:
            return JSONResponse(fail(ERRORS["method_not_found"], "No such agent"), status_code=404)
        if not isinstance(body, dict) or body.get("jsonrpc") != "2.0" or not isinstance(body.get("method"), str):
            return fail(ERRORS["invalid_request"], "Not a JSON-RPC 2.0 request")
        version = request.headers.get("a2a-version")
        if version and not re.match(r"^1(\.|$)", version):
            return fail(ERRORS["version"], f"A2A version {version} is not supported; this agent speaks {A2A_PROTOCOL_VERSION}")
        params = body.get("params") or {}
        method = body["method"]
        try:
            if method == "SendMessage":
                message = params.get("message")
                if not isinstance(message, dict) or not isinstance(message.get("parts"), list):
                    return fail(ERRORS["invalid_params"], "SendMessage needs a message with parts")
                # A run takes no further input over A2A once started
                if message.get("taskId"):
                    return fail(ERRORS["unsupported"], "A task of this agent takes no further messages: each message starts a new run")
                # The caller starts the run (30.1): a start the policy refuses leaves no run and answers 403
                principal = request_principal(request)
                engine = WorkflowEngine(workflow, options={**(engine_options() if engine_options else {}), "principal": principal})
                try:
                    engine.authorize_start(message_input(message["parts"]))
                except AuthorizationError as error:
                    return forbidden(error, principal)
                served = _Served(engine, workflow_id, message.get("contextId") or str(uuid4()))
                task_id = engine.run_id
                keep(task_id, served)

                def perform() -> None:
                    try:
                        engine.run(message_input(message["parts"]))
                    finally:
                        served.done.set()
                if (params.get("configuration") or {}).get("returnImmediately"):
                    threading.Thread(target=perform, daemon=True, name=f"awa-a2a-{task_id}").start()
                else:
                    perform()
                return reply({"task": _task(task_id, served)})
            if method in ("GetTask", "CancelTask"):
                served = tasks.get(str(params.get("id")))
                if served is None or served.workflow_id != workflow_id:
                    return fail(ERRORS["task_not_found"], f"Task {params.get('id')} was not found")
                if method == "GetTask":
                    return reply(_task(str(params["id"]), served))
                if served.engine.status.value in ENDED:
                    return fail(ERRORS["task_not_cancelable"], f"Task {params['id']} has ended")
                refused = authorize_request("cancel_run", request_principal(request),
                                            {"workflow_id": workflow_id, "workflow_name": workflow.name, "run_id": str(params["id"])})
                if refused is not None:
                    return refused
                served.engine.cancel("Cancelled by the caller over A2A")
                return reply(_task(str(params["id"]), served))
            if method in UNSUPPORTED:
                return fail(ERRORS["unsupported"], f"{method} is not supported by this agent")
            return fail(ERRORS["method_not_found"], f"Unknown method {method}")
        except Exception as error:
            return fail(ERRORS["internal"], str(error))

    app.add_api_route("/a2a/{workflow_id}", rpc, methods=["POST"], dependencies=dependencies or [])
