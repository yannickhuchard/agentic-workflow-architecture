"""
Agents over A2A (specification section 28): the client side.

An activity whose role, or which itself, names an agent by its agent card is
performed by that agent over the Agent2Agent protocol, version 1.0, on its
JSON-RPC binding. The engine sends the activity's inputs as a message,
follows the task the agent opens until it ends, and turns the reply into the
activity's output, which is then checked as any actor's is. Every exchange
is journalled. Nothing is called in simulation.

The client is written here with the standard library.
"""

import json
import re
import time
import urllib.parse
from dataclasses import dataclass, field
from typing import Any, Callable
from uuid import uuid4

from awa.runtime.protocols.common import check_host, web_url, with_secrets
from awa.runtime.tools import DEFAULT_MAX_OUTPUT_BYTES, ToolCallContext, ToolError, _send

A2A_PROTOCOL_VERSION = "1.0"

COMPLETED = "TASK_STATE_COMPLETED"
INPUT_REQUIRED = "TASK_STATE_INPUT_REQUIRED"
FAILURES = {
    "TASK_STATE_FAILED": "AGENT_FAILED",
    "TASK_STATE_REJECTED": "AGENT_REJECTED",
    "TASK_STATE_CANCELED": "AGENT_CANCELED",
    "TASK_STATE_AUTH_REQUIRED": "AGENT_AUTH_REQUIRED",
}
FOLLOWED = {"TASK_STATE_SUBMITTED", "TASK_STATE_WORKING", "TASK_STATE_UNSPECIFIED"}

# How requests reach an agent: (method, url, headers, body) -> (status, body). The default uses HTTP;
# a test or a conformance runner may stand in for the agent. Permissions are applied before it is called.
A2ATransport = Callable[[str, str, dict[str, str], str | None], tuple[int, str]]


@dataclass
class A2AOptions:
    """How agents reached over A2A are called, and which hosts they may be reached at (specification 28.2)"""
    # Hosts agents may be reached at, redirects included. Default: the tools' allowed_hosts (17.4); absent, any.
    allowed_hosts: list[str] | None = None
    # Values for {{secret:NAME}} in a binding's headers. Default: the tools' secrets.
    secrets: dict[str, str] | None = None
    # How often a task that is still working is asked about, in milliseconds
    poll_interval_ms: float = 1000
    # The longest the engine follows a task before it cancels it and the attempt fails with TIMEOUT
    max_wait_ms: float = 600_000
    max_output_bytes: int = DEFAULT_MAX_OUTPUT_BYTES
    transport: A2ATransport | None = None

    @classmethod
    def of(cls, value: "A2AOptions | dict[str, Any] | None") -> "A2AOptions":
        if isinstance(value, A2AOptions):
            return value
        options = dict(value or {})
        unknown = set(options) - set(cls.__dataclass_fields__)
        if unknown:
            raise ValueError(f"Unknown A2A option(s): {', '.join(sorted(unknown))}")
        return cls(**{key: item for key, item in options.items() if item is not None})


@dataclass
class A2ARunState:
    """What the engine and the actors share for one run: the cards already read"""
    cards: dict[str, tuple[dict[str, Any], str]] = field(default_factory=dict)


def a2a_binding(activity: Any, role: Any = None) -> Any:
    """The agent that performs an activity: the activity's own binding, else its role's (28.1)"""
    return getattr(activity, "a2a", None) or (getattr(role, "a2a", None) if role is not None else None)


def _artifact_value(parts: list[Any]) -> Any:
    if len(parts) == 1 and isinstance(parts[0], dict) and "data" in parts[0]:
        return parts[0]["data"]
    if parts and all(isinstance(p, dict) and isinstance(p.get("text"), str) for p in parts):
        return "\n".join(p["text"] for p in parts)
    return parts


def a2a_output(artifacts: list[dict[str, Any]]) -> dict[str, Any]:
    """The output built from a reply's artifacts, in order (28.5)"""
    output: dict[str, Any] = {}
    for artifact in artifacts:
        value = _artifact_value(list(artifact.get("parts") or []))
        if isinstance(value, dict):
            output.update(value)
        else:
            output[artifact.get("name") or "result"] = value
    return output


def _text_of(message: Any) -> str:
    parts = (message or {}).get("parts") or [] if isinstance(message, dict) else []
    return "\n".join(p["text"] for p in parts if isinstance(p, dict) and isinstance(p.get("text"), str))


def _input_parts(value: Any) -> list[dict[str, Any]]:
    """The input a host gives an agent that asked for it: an object as data, anything else as text (28.6)"""
    if isinstance(value, dict):
        return [{"data": value, "mediaType": "application/json"}]
    return [{"text": value if isinstance(value, str) else json.dumps(value)}]


def _agent_error(error: ToolError) -> ToolError:
    """A refusal keeps its code; any other transport failure is the agent's"""
    if error.code in ("PERMISSION_DENIED", "VALIDATION_ERROR", "TIMEOUT"):
        return error
    return ToolError(str(error), "AGENT_ERROR", error.status)


class A2AActor:
    """
    The actor of an activity performed by a remote agent. One instance serves
    the attempts of one visit to the activity, so that every message after the
    first is sent in the context the agent answered with.
    """

    def __init__(self, binding: Any, options: A2AOptions, state: A2ARunState, *, simulate: bool = False,
                 scripted: Any = None, tools_allowed_hosts: list[str] | None = None,
                 tools_secrets: dict[str, str] | None = None) -> None:
        self.binding = binding
        self.options = options
        self.state = state
        self.simulate = simulate
        self.scripted = scripted
        self.tools_allowed_hosts = tools_allowed_hosts
        self.tools_secrets = tools_secrets or {}
        # The input a host gave for a task that asked for it (28.6), sent once
        self.continuation: dict[str, Any] | None = None
        self._context_id: str | None = None

    @property
    def _allowed(self) -> list[str] | None:
        return self.options.allowed_hosts if self.options.allowed_hosts is not None else self.tools_allowed_hosts

    def _transport(self) -> A2ATransport:
        if self.options.transport is not None:
            return self.options.transport

        def send(method: str, url: str, headers: dict[str, str], body: str | None) -> tuple[int, str]:
            context = ToolCallContext("a2a", {}, 60_000, self._allowed, self.options.max_output_bytes)
            return _send(method, url, headers, body, context)
        return send

    def execute(self, activity: Any, token: Any, context: Any = None) -> dict[str, Any]:
        record = getattr(context, "record", None) or (lambda type, data: None)
        payload = getattr(context, "payload", None) or (lambda value: value)
        data = token.context_data
        agent = self.binding.agent_card
        continuation, self.continuation = self.continuation, None
        message: dict[str, Any] = {
            "messageId": str(uuid4()), "role": "ROLE_USER",
            "parts": _input_parts(continuation["input"]) if continuation else self._parts(activity, data),
        }
        if continuation:
            message["taskId"] = continuation["task_id"]
        context_id = continuation.get("context_id") if continuation else self._context_id
        if context_id:
            message["contextId"] = context_id
        awa = {"run_id": data.get("_run_id"), "activity_id": str(activity.id), "activity": activity.name,
               "attempt": data.get("_attempt"), "idempotency_key": data.get("_idempotency_key")}
        if self.binding.skill:
            awa["skill"] = self.binding.skill
        message["metadata"] = {"awa": awa}

        def sent(link: str, simulated: bool = False) -> None:
            event: dict[str, Any] = {"agent": agent, "link": link, "message_id": message["messageId"]}
            if message.get("contextId"):
                event["context_id"] = message["contextId"]
            if message.get("taskId"):
                event["task_id"] = message["taskId"]
            event["parts"] = payload(message["parts"])
            if simulated:
                event["simulated"] = True
            record("agent.message_sent", event)

        # In simulation nothing is called (28.7)
        if self.simulate:
            sent(agent, True)
            if self.scripted is not None:
                return self.scripted.execute(activity, token)
            return {"_simulated": True}

        secrets = self.options.secrets if self.options.secrets is not None else self.tools_secrets
        headers = {"a2a-version": A2A_PROTOCOL_VERSION, "accept": "application/json"}
        for name, value in (self.binding.headers or {}).items():
            headers[name.lower()] = with_secrets(value, secrets)
        transport = self._transport()
        _, url = self._card(transport, headers)
        counter = {"n": 0}

        def call(method: str, params: Any) -> Any:
            check_host(web_url(url), self._allowed, "requests")
            counter["n"] += 1
            body = json.dumps({"jsonrpc": "2.0", "id": f"{message['messageId']}-{counter['n']}", "method": method, "params": params})
            try:
                status, text = transport("POST", url, {**headers, "content-type": "application/json"}, body)
            except ToolError as error:
                raise _agent_error(error) from None
            except Exception as error:
                raise ToolError(f"Agent {agent} could not be reached: {error}", "AGENT_ERROR") from None
            try:
                reply = json.loads(text)
            except ValueError:
                raise ToolError(f"Agent {agent} answered {method} with HTTP {status} and no JSON-RPC reply", "AGENT_ERROR", status) from None
            error = reply.get("error") if isinstance(reply, dict) else None
            if error:
                code = error.get("code") if isinstance(error, dict) else None
                raise ToolError(f"Agent {agent} answered {method} with error {code}: {error.get('message') if isinstance(error, dict) else error}",
                                "AGENT_ERROR", code)
            if not 200 <= status < 300:
                raise ToolError(f"Agent {agent} answered {method} with HTTP {status}", "AGENT_ERROR", status)
            result = reply.get("result") if isinstance(reply, dict) else None
            if not isinstance(result, dict):
                raise ToolError(f"Agent {agent} answered {method} without a result", "AGENT_ERROR")
            return result

        started = time.monotonic()

        def updated(event: dict[str, Any]) -> None:
            record("agent.task_updated", {"agent": agent, **event, "duration_ms": int((time.monotonic() - started) * 1000)})

        sent(url)
        reply = call("SendMessage", {"message": message})

        # A message is the agent's reply
        reply_message = reply.get("message") if isinstance(reply.get("message"), dict) else (
            reply if "messageId" in reply and "parts" in reply else None)
        if reply_message is not None:
            if reply_message.get("contextId"):
                self._context_id = reply_message["contextId"]
            event = {"state": "message"}
            if reply_message.get("contextId"):
                event["context_id"] = reply_message["contextId"]
            event["reply"] = payload(reply_message.get("parts") or [])
            updated(event)
            return a2a_output([{"parts": reply_message.get("parts") or []}])
        task = reply.get("task") if isinstance(reply.get("task"), dict) else (reply if "id" in reply and "status" in reply else None)
        if not isinstance(task, dict) or not isinstance(task.get("id"), str) or not isinstance(task.get("status"), dict):
            raise ToolError(f"Agent {agent} answered SendMessage with neither a task nor a message", "AGENT_ERROR")

        # The task is followed until its state is neither submitted nor working (28.4)
        last_state = None
        while True:
            if task.get("contextId"):
                self._context_id = task["contextId"]
            state = str(task["status"].get("state") or "TASK_STATE_UNSPECIFIED")
            ends = state not in FOLLOWED
            if state != last_state:
                last_state = state
                event = {"task_id": task["id"]}
                if task.get("contextId"):
                    event["context_id"] = task["contextId"]
                event["state"] = state
                if ends:
                    status_message = task["status"].get("message")
                    event["reply"] = payload(task.get("artifacts") or [] if state == COMPLETED else
                                             (status_message.get("parts") or [] if isinstance(status_message, dict) else []))
                updated(event)
            if ends:
                break
            if (time.monotonic() - started) * 1000 >= self.options.max_wait_ms:
                try:
                    call("CancelTask", {"id": task["id"]})
                except ToolError:
                    pass
                raise ToolError(f"Agent {agent} did not finish task {task['id']} within {self.options.max_wait_ms:g} ms", "TIMEOUT")
            if self.options.poll_interval_ms > 0:
                time.sleep(self.options.poll_interval_ms / 1000)
            following = call("GetTask", {"id": task["id"]})
            task = following.get("task") if isinstance(following.get("task"), dict) else following
            if not isinstance(task.get("id"), str) or not isinstance(task.get("status"), dict):
                raise ToolError(f"Agent {agent} answered GetTask without a task", "AGENT_ERROR")

        state = task["status"]["state"]
        status_message = task["status"].get("message")
        if state == COMPLETED:
            artifacts = task.get("artifacts") or (
                [{"parts": status_message.get("parts") or []}] if isinstance(status_message, dict) else [])
            return a2a_output(artifacts)
        if state == INPUT_REQUIRED:
            if self.binding.on_input_required == "fail":
                text = _text_of(status_message)
                raise ToolError(f"Agent {agent} asks for input{': ' + text if text else ''}", "AGENT_INPUT_REQUIRED")
            # The token waits for the host to give the input (28.6)
            return {"_awaiting_agent_input": {"agent": agent, "task_id": task["id"], "context_id": task.get("contextId"),
                                              "request": status_message}}
        raise ToolError(_text_of(status_message) or f"Agent {agent} ended task {task['id']} in state {state}",
                        FAILURES.get(state, "AGENT_ERROR"))

    def _parts(self, activity: Any, data: dict[str, Any]) -> list[dict[str, Any]]:
        """The parts of the first message of an attempt (28.3)"""
        feedback = data.get("_verification_feedback")
        texts = [activity.name, getattr(activity, "description", None), getattr(activity, "procedure", None),
                 None if feedback is None else feedback if isinstance(feedback, str) else json.dumps(feedback)]
        parts: list[dict[str, Any]] = [
            {"text": "\n\n".join(t for t in texts if isinstance(t, str) and t)},
            {"data": {k: v for k, v in data.items() if not k.startswith("_")}, "mediaType": "application/json"},
        ]
        if isinstance(data.get("_contexts"), dict):
            parts.append({"data": data["_contexts"], "mediaType": "application/json", "metadata": {"awa": "contexts"}})
        return parts

    def _card(self, transport: A2ATransport, headers: dict[str, str]) -> tuple[dict[str, Any], str]:
        """The card, read once per run, and the JSON-RPC interface it offers (28.2)"""
        address = self.binding.agent_card
        if address in self.state.cards:
            return self.state.cards[address]
        check_host(web_url(address), self._allowed, "requests")
        try:
            status, text = transport("GET", address, headers, None)
        except ToolError as error:
            raise _agent_error(error) from None
        except Exception as error:
            raise ToolError(f"The card of agent {address} could not be read: {error}", "AGENT_ERROR") from None
        if not 200 <= status < 300:
            raise ToolError(f"The card of agent {address} could not be read: HTTP {status}", "AGENT_ERROR", status)
        try:
            card = json.loads(text)
        except ValueError:
            raise ToolError(f"The card of agent {address} is not JSON", "AGENT_ERROR") from None
        entry = next((i for i in (card.get("supportedInterfaces") or []) if isinstance(i, dict)
                      and i.get("protocolBinding") == "JSONRPC"
                      and (not i.get("protocolVersion") or re.match(r"^1(\.|$)", str(i["protocolVersion"])))), None)
        if entry is None or not isinstance(entry.get("url"), str):
            raise ToolError(f"Agent {address} offers no JSON-RPC interface of A2A {A2A_PROTOCOL_VERSION}", "AGENT_UNSUPPORTED")
        url = urllib.parse.urljoin(address, entry["url"])
        check_host(web_url(url), self._allowed, "requests")
        self.state.cards[address] = (card, url)
        return card, url
