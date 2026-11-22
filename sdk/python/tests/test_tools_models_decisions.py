"""
Tools (specification 17), model binding and routing (12) and model decisions (16):
what the conformance cases cannot reach. Bindings other than `function`, the
deployment's permissions, timeouts and output bounds, and the edges of the router.
Nothing here leaves the machine: HTTP goes to a server started by the test.
"""

import json
import sys
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from uuid import uuid4

import pytest

from awa.runtime.decision_model import decide_with_model, decision_prompt, parse_vote
from awa.runtime.models import (
    FunctionModelProvider, ModelError, ModelRegistry, ModelRequest, ModelRouter, request_messages,
)
from awa.runtime.tools import ToolExecution, ToolRunner, command_line, http_request, tool_link
from awa.runtime.workflow_engine import WorkflowEngine
from awa.types import ActorType, DecisionNode, ToolBinding, ToolDefinition, Workflow
from awa.validator import validate_workflow_integrity

PYTHON = sys.executable


@pytest.fixture(autouse=True)
def no_proxy_for_loopback(monkeypatch):
    monkeypatch.setenv("NO_PROXY", "127.0.0.1,localhost")
    monkeypatch.setenv("no_proxy", "127.0.0.1,localhost")


def tool(name, binding, parameters=None, **more):
    return ToolDefinition(name=name, description=f"The {name} tool", parameters=parameters, binding=binding, **more)


def runner(tools, options=None, **more):
    """A runner whose journal is a list of (type, data)"""
    events = []
    return ToolRunner(tools, options, lambda type, data: events.append((type, data)), **more), events


def types(events):
    return [event_type for event_type, _ in events]


# ----------------------------------------------------------------------
# A local HTTP server
# ----------------------------------------------------------------------

class Handler(BaseHTTPRequestHandler):
    def log_message(self, *args):
        pass

    def _reply(self, status, body, headers=None):
        raw = body if isinstance(body, bytes) else json.dumps(body).encode()
        self.send_response(status)
        for name, value in (headers or {}).items():
            self.send_header(name, value)
        self.send_header("content-length", str(len(raw)))
        self.end_headers()
        if self.command != "HEAD":
            self.wfile.write(raw)

    def _handle(self):
        length = int(self.headers.get("content-length") or 0)
        body = self.rfile.read(length).decode() if length else None
        self.server.seen.append({"method": self.command, "path": self.path, "headers": dict(self.headers), "body": body})
        if self.path.startswith("/missing"):
            return self._reply(404, {"detail": "no such policy"})
        if self.path.startswith("/redirect"):
            return self._reply(302, b"", {"location": self.server.redirect_to})
        if self.path.startswith("/big"):
            return self._reply(200, b"x" * 5000)
        if self.path.startswith("/slow"):
            time.sleep(1)
            return self._reply(200, {})
        if self.path.startswith("/text"):
            return self._reply(200, b"plain words")
        if self.path.startswith("/rpc"):
            request = json.loads(body)
            if request["method"] == "fail":
                return self._reply(200, {"jsonrpc": "2.0", "id": request["id"], "error": {"code": -32000, "message": "refused"}})
            return self._reply(200, {"jsonrpc": "2.0", "id": request["id"], "result": {"sum": sum(request["params"]["values"])}})
        return self._reply(200, {"ok": True, "path": self.path})

    do_GET = do_POST = do_PUT = do_DELETE = do_HEAD = _handle


def serve():
    server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    server.seen, server.redirect_to = [], ""
    threading.Thread(target=server.serve_forever, kwargs={"poll_interval": 0.02}, daemon=True).start()
    server.base = f"http://127.0.0.1:{server.server_address[1]}"
    return server


@pytest.fixture
def server():
    instance = serve()
    yield instance
    instance.shutdown()
    instance.server_close()


@pytest.fixture
def other_server():
    instance = serve()
    yield instance
    instance.shutdown()
    instance.server_close()


# ----------------------------------------------------------------------
# HTTP and JSON-RPC bindings
# ----------------------------------------------------------------------

def test_http_get_fills_the_path_and_sends_the_rest_as_query(server):
    binding = ToolBinding(kind="http", url=server.base + "/policies/{id}",
                          headers={"Authorization": "Bearer {{secret:API_KEY}}"})
    tools, events = runner([tool("policy", binding, documentation="https://example.test/openapi.json")],
                           {"secrets": {"API_KEY": "s3cret-value"}})
    result = tools.call("policy", {"id": "POL 1/2", "expand": True, "limit": 5})

    assert result.ok and result.result["ok"] is True
    request = server.seen[0]
    assert request["method"] == "GET"
    assert request["path"] == "/policies/POL%201%2F2?expand=true&limit=5"
    assert request["headers"]["Authorization"] == "Bearer s3cret-value"

    assert types(events) == ["tool.invoked", "tool.completed"]
    invoked, completed = events[0][1], events[1][1]
    assert invoked["link"] == completed["link"] == server.base + "/policies/POL%201%2F2"
    assert invoked["binding"] == {"kind": "http", "method": "GET", "url": invoked["link"],
                                  "url_template": server.base + "/policies/{id}"}
    assert invoked["documentation"] == "https://example.test/openapi.json"
    assert invoked["call_id"] == completed["call_id"]
    assert completed["status"] == 200
    # Headers and secrets are never journalled (17.2)
    assert "s3cret-value" not in json.dumps(events) and "Authorization" not in json.dumps(events)


def test_http_post_sends_remaining_arguments_as_a_json_body(server):
    tools, _ = runner([tool("create", ToolBinding(kind="http", method="post", url=server.base + "/claims/{claim}/notes"))])
    assert tools.call("create", {"claim": "C1", "text": "hello", "tags": ["a"]}).ok
    request = server.seen[0]
    assert (request["method"], request["path"]) == ("POST", "/claims/C1/notes")
    assert json.loads(request["body"]) == {"text": "hello", "tags": ["a"]}
    assert request["headers"]["Content-Type"] == "application/json"


def test_http_error_status_is_a_failed_call_the_actor_can_read(server):
    tools, events = runner([tool("policy", ToolBinding(kind="http", url=server.base + "/missing/{id}"))])
    result = tools.call("policy", {"id": "x"})
    assert not result.ok and result.result["code"] == "TOOL_ERROR"
    assert json.loads(result.content) == result.result
    assert types(events) == ["tool.invoked", "tool.failed"]
    failed = events[1][1]
    assert failed["invoked"] is True and failed["status"] == 404
    assert failed["error"]["message"].startswith("HTTP 404 from 127.0.0.1")


def test_http_text_that_is_not_json_is_kept_as_text(server):
    tools, _ = runner([tool("text", ToolBinding(kind="http", url=server.base + "/text"))])
    assert tools.call("text").result == "plain words"


def test_missing_secret_fails_the_call_without_sending_it(server):
    binding = ToolBinding(kind="http", url=server.base + "/x", headers={"x-key": "{{secret:ABSENT}}"})
    tools, events = runner([tool("x", binding)])
    assert tools.call("x").result["code"] == "VALIDATION_ERROR"
    assert server.seen == []
    assert events[-1][0] == "tool.failed"


def test_hosts_are_restricted_when_the_deployment_lists_them(server, other_server):
    allowed = server.base.removeprefix("http://")
    options = {"allowed_hosts": [allowed]}
    tools, events = runner([
        tool("inside", ToolBinding(kind="http", url=server.base + "/a")),
        tool("outside", ToolBinding(kind="http", url=other_server.base + "/a")),
        tool("rpc", ToolBinding(kind="jsonrpc", endpoint=other_server.base + "/rpc", method="sum")),
        tool("bounce", ToolBinding(kind="http", url=server.base + "/redirect")),
    ], options)
    assert tools.call("inside").ok
    for name in ("outside", "rpc"):
        refused = tools.call(name, {})
        assert refused.result["code"] == "PERMISSION_DENIED"
        assert events[-1][0] == "tool.failed" and events[-1][1]["invoked"] is False
    assert other_server.seen == []

    # A permitted host cannot hand the call on to one that is not
    server.redirect_to = other_server.base + "/a"
    assert tools.call("bounce").result["code"] == "PERMISSION_DENIED"
    assert other_server.seen == []


def test_a_url_that_is_not_http_is_refused_before_anything_runs(tmp_path):
    secret = tmp_path / "secret.txt"
    secret.write_text("do not read")
    tools, events = runner([tool("file", ToolBinding(kind="http", url=f"file://{secret}"))])
    result = tools.call("file")
    assert result.result["code"] == "VALIDATION_ERROR"
    assert types(events) == ["tool.failed"] and events[0][1]["invoked"] is False


def test_http_response_larger_than_the_bound_fails_the_call(server):
    tools, events = runner([tool("big", ToolBinding(kind="http", url=server.base + "/big"))], {"max_output_bytes": 1000})
    result = tools.call("big")
    assert not result.ok and "exceeds 1000 bytes" in result.result["error"]
    assert types(events) == ["tool.invoked", "tool.failed"]


def test_http_call_is_bounded_by_the_tool_timeout(server):
    tools, events = runner([tool("slow", ToolBinding(kind="http", url=server.base + "/slow"), timeout="PT0.2S")])
    started = time.monotonic()
    result = tools.call("slow")
    assert result.result["code"] == "TIMEOUT"
    assert time.monotonic() - started < 0.9
    assert events[-1][1]["invoked"] is True


def test_jsonrpc_call_and_rpc_error(server):
    tools, events = runner([
        tool("sum", ToolBinding(kind="jsonrpc", endpoint=server.base + "/rpc", method="sum")),
        tool("fail", ToolBinding(kind="jsonrpc", endpoint=server.base + "/rpc", method="fail")),
    ])
    assert tools.call("sum", {"values": [1, 2, 3]}, call_id="call-7").result == {"sum": 6}
    sent = json.loads(server.seen[0]["body"])
    assert sent == {"jsonrpc": "2.0", "id": "call-7", "method": "sum", "params": {"values": [1, 2, 3]}}
    assert events[0][1]["link"] == server.base + "/rpc#sum"

    failed = tools.call("fail", {"values": []})
    assert not failed.ok and "RPC error -32000: refused" in failed.result["error"]
    assert events[-1][1]["status"] == -32000


# ----------------------------------------------------------------------
# Command bindings and the deployment's policy
# ----------------------------------------------------------------------

ECHO_ARGS = ToolBinding(kind="command", command=PYTHON,
                        args=["-c", "import sys, json; print(json.dumps(sys.argv[1:]))", "{text}", "--flag={n}"])
READ_STDIN = ToolBinding(kind="command", command=PYTHON,
                         args=["-c", "import sys, json; print(json.dumps({'got': json.load(sys.stdin)}))"])


def test_commands_do_not_run_unless_the_deployment_allows_them():
    for options in (None, {"allow_commands": False}, {"allow_commands": []}, {"allow_commands": ["/usr/bin/other"]}):
        tools, events = runner([tool("echo", ECHO_ARGS)], options)
        result = tools.call("echo", {"text": "hi", "n": 1})
        assert result.result["code"] == "PERMISSION_DENIED"
        assert types(events) == ["tool.failed"]
        assert events[0][1]["invoked"] is False and events[0][1]["link"] == f"command:{PYTHON}"


def test_an_allowed_command_runs_without_a_shell():
    tools, events = runner([tool("echo", ECHO_ARGS)], {"allow_commands": [PYTHON]})
    # Each element is exactly one argument: what an argument contains cannot add commands
    hostile = 'a b; echo pwned && $(touch /tmp/x) "quoted"'
    result = tools.call("echo", {"text": hostile, "n": 3})
    assert result.ok and result.result == [hostile, "--flag=3"]
    invoked = events[0][1]
    assert invoked["link"] == f"command:{PYTHON}"
    assert invoked["binding"]["kind"] == "command" and invoked["binding"]["args"][-2:] == [hostile, "--flag=3"]
    assert events[1][1]["status"] == 0


def test_arguments_not_on_the_command_line_arrive_as_json_on_standard_input():
    tools, _ = runner([tool("read", READ_STDIN)], {"allow_commands": True})
    assert tools.call("read", {"q": "POL-1", "n": 2}).result == {"got": {"q": "POL-1", "n": 2}}
    assert command_line(READ_STDIN, {"q": 1}) == list(READ_STDIN.args)


def test_a_command_that_exits_without_reading_its_input_is_not_an_error():
    binding = ToolBinding(kind="command", command=PYTHON, args=["-c", "print('done')"])
    tools, _ = runner([tool("quick", binding)], {"allow_commands": True})
    assert tools.call("quick", {"blob": "x" * 500_000}).result == "done"


def test_a_failing_command_reports_its_exit_code_and_what_it_wrote_to_standard_error():
    binding = ToolBinding(kind="command", command=PYTHON, args=["-c", "import sys; sys.stderr.write('bad input'); sys.exit(3)"])
    tools, events = runner([tool("fail", binding), tool("absent", ToolBinding(kind="command", command="/no/such/program"))],
                           {"allow_commands": True})
    result = tools.call("fail")
    assert not result.ok and "bad input" in result.result["error"]
    assert events[-1][1]["status"] == 3 and events[-1][1]["invoked"] is True
    assert tools.call("absent").result["code"] == "TOOL_ERROR"
    assert events[-1][1]["status"] == "ENOENT"


def test_a_command_is_stopped_at_the_tool_timeout():
    binding = ToolBinding(kind="command", command=PYTHON, args=["-c", "import time; time.sleep(30)"])
    tools, events = runner([tool("sleep", binding, timeout="PT0.3S")], {"allow_commands": True})
    started = time.monotonic()
    assert tools.call("sleep").result["code"] == "TIMEOUT"
    assert time.monotonic() - started < 5
    assert types(events) == ["tool.invoked", "tool.failed"]


def test_command_output_beyond_the_bound_fails_the_call():
    binding = ToolBinding(kind="command", command=PYTHON, args=["-c", "print('x' * 200000)"])
    small, events = runner([tool("flood", binding)], {"allow_commands": True, "max_output_bytes": 10_000})
    result = small.call("flood")
    assert not result.ok and "exceeds 10000 bytes" in result.result["error"]
    assert types(events) == ["tool.invoked", "tool.failed"]

    # Within the bound the output is returned whole, and shortened only in the text given to a model
    roomy, _ = runner([tool("flood", binding)], {"allow_commands": True})
    whole = roomy.call("flood")
    assert whole.ok and len(whole.result) == 200_000
    assert len(whole.content) < 61_000 and whole.content.endswith("(truncated)")


# ----------------------------------------------------------------------
# The runner's own rules
# ----------------------------------------------------------------------

def test_arguments_are_checked_against_the_schema_before_anything_runs():
    ran = []
    schema = {"type": "object", "required": ["q"], "properties": {"q": {"type": "string"}, "n": {"type": "integer", "minimum": 1}},
              "additionalProperties": False}
    tools, events = runner([tool("lookup", ToolBinding(kind="function", name="lookup"), schema)],
                           {"handlers": {"lookup": lambda args: ran.append(args) or {"found": True}}})
    for bad in ({}, {"q": 1}, {"q": "a", "n": 0}, {"q": "a", "extra": True}):
        result = tools.call("lookup", bad)
        assert result.result["code"] == "VALIDATION_ERROR" and 'Invalid arguments for "lookup"' in result.result["error"]
    assert ran == [] and set(types(events)) == {"tool.failed"}
    assert tools.call("lookup", {"q": "a", "n": 2}).result == {"found": True}
    assert ran == [{"q": "a", "n": 2}]


def test_unknown_tools_missing_handlers_and_missing_executors_are_failures_the_caller_can_read():
    tools, events = runner([
        tool("orphan", ToolBinding(kind="function", name="nobody")),
        tool("remote", ToolBinding(kind="mcp", server="crm", tool="find")),
        tool("rpc", ToolBinding(kind="grpc", endpoint="dns:///billing:443", service="Billing", method="Charge")),
    ])
    assert tools.call("nothing").result["code"] == "UNKNOWN_TOOL"
    assert "link" not in events[-1][1]
    assert tools.call("orphan").result["code"] == "VALIDATION_ERROR"
    for name, link in (("remote", "mcp://crm/find"), ("rpc", "grpc://billing:443/Billing/Charge")):
        result = tools.call(name)
        assert result.result["code"] == "VALIDATION_ERROR" and "No executor is registered" in result.result["error"]
        assert events[-1][1]["link"] == link and events[-1][1]["invoked"] is True
    assert tools.call_count == 4


def test_a_registered_executor_serves_a_kind_the_engine_does_not_implement():
    seen = []

    def mcp(binding, args, context):
        seen.append((binding.server, binding.tool, args, context.call_id))
        return ToolExecution({"rows": 2}, "ok")

    tools, events = runner([tool("remote", ToolBinding(kind="mcp", server="crm", tool="find"))], {"executors": {"mcp": mcp}})
    assert tools.call("remote", {"name": "Ada"}, call_id="c1").result == {"rows": 2}
    assert seen == [("crm", "find", {"name": "Ada"}, "c1")]
    assert events[1][1]["status"] == "ok"


def test_the_tool_timeout_applies_to_registered_handlers():
    tools, events = runner([tool("slow", ToolBinding(kind="function", name="slow"), timeout="PT0.1S")],
                           {"handlers": {"slow": lambda args: time.sleep(1)}})
    started = time.monotonic()
    result = tools.call("slow")
    assert result.result["code"] == "TIMEOUT" and time.monotonic() - started < 0.8
    assert events[-1][0] == "tool.failed" and events[-1][1]["invoked"] is True


def test_the_call_budget_counts_refused_calls_too():
    tools, events = runner([tool("lookup", ToolBinding(kind="function", name="lookup"))],
                           {"handlers": {"lookup": lambda args: 1}}, max_calls=2)
    assert tools.call("lookup").ok
    assert tools.call("unknown").result["code"] == "UNKNOWN_TOOL"
    assert tools.call("lookup").result["code"] == "TOOL_BUDGET_EXCEEDED"
    assert types(events) == ["tool.invoked", "tool.completed", "tool.failed", "tool.failed"]


def test_in_simulation_nothing_is_executed():
    ran = []
    tools, events = runner(
        [tool("lookup", ToolBinding(kind="function", name="lookup")), tool("shell", ECHO_ARGS)],
        {"handlers": {"lookup": lambda args: ran.append(args)}, "simulated_results": {"lookup": {"found": "scripted"}},
         "allow_commands": True},
        simulate=True)
    assert tools.call("lookup", {"q": "x"}).result == {"found": "scripted"}
    assert tools.call("shell", {"text": "hi", "n": 1}).result == {"_simulated": True}
    assert ran == []
    assert [data["simulated"] for event_type, data in events if event_type == "tool.invoked"] == [True, True]
    assert [data["status"] for event_type, data in events if event_type == "tool.completed"] == ["simulated", "simulated"]


def test_every_kind_of_binding_has_a_link():
    assert tool_link(ToolBinding(kind="http", url="https://user:pw@api.example.test:443/v1/items/{id}?token=abc#top"),
                     {"id": 7, "q": "x"}) == "https://api.example.test/v1/items/7"
    assert tool_link(ToolBinding(kind="http", url="http://api.example.test:8080"), {}) == "http://api.example.test:8080/"
    assert tool_link(ToolBinding(kind="command", command="/usr/bin/jq", args=["."]), {}) == "command:/usr/bin/jq"
    assert tool_link(ToolBinding(kind="jsonrpc", endpoint="https://rpc.example.test/v1", method="sum"), {}) == "https://rpc.example.test/v1#sum"
    assert tool_link(ToolBinding(kind="grpc", endpoint="billing:443", service="Billing", method="Charge"), {}) == "grpc://billing:443/Billing/Charge"
    assert tool_link(ToolBinding(kind="mcp", server="crm", tool="find"), {}) == "mcp://crm/find"
    assert tool_link(ToolBinding(kind="function", name="lookup"), {}) == "function:lookup"


def test_http_request_keeps_the_query_of_the_template_and_replaces_parameters_of_the_same_name():
    binding = ToolBinding(kind="http", method="DELETE", url="https://api.example.test/items/{id}?v=1&page=1")
    assert http_request(binding, {"id": "a b", "page": 3, "filter": {"k": None}}) == (
        "DELETE", "https://api.example.test/items/a%20b?v=1&page=3&filter=%7B%22k%22%3Anull%7D", None)


def test_a_binding_must_have_the_fields_of_its_kind():
    with pytest.raises(Exception):
        ToolBinding(kind="http")
    with pytest.raises(Exception):
        ToolBinding(kind="command", args=["x"])
    with pytest.raises(Exception):
        ToolBinding(kind="telepathy", name="x")


# ----------------------------------------------------------------------
# Tools within a run
# ----------------------------------------------------------------------

def uid():
    return str(uuid4())


def tool_workflow(tools, **activity):
    a, b = uid(), uid()
    return Workflow.model_validate({
        "id": uid(), "name": "Tools", "version": "1.0.0",
        "activities": [
            {"id": a, "name": "A", "role_id": uid(), "actor_type": "application", "tools": tools, **activity},
            {"id": b, "name": "B", "role_id": uid(), "actor_type": "application"},
        ],
        "edges": [{"id": uid(), "source_id": a, "target_id": b}],
    })


class CallingActor:
    """Calls the tools it is told to, and returns what they gave back"""

    def __init__(self, calls):
        self.calls, self.results = calls, []

    def execute(self, activity, token, context):
        if activity.name != "A":
            return {}
        self.results = [context.tools.call(name, args) for name, args in self.calls]
        return {"answers": [r.result for r in self.results]}


LOOKUP = {"name": "lookup", "description": "Look a policy up", "binding": {"kind": "function", "name": "lookup"},
          "parameters": {"type": "object", "properties": {"q": {"type": "string"}}}}


def run_with_tools(tools, calls, options=None, **activity):
    actor = CallingActor(calls)
    engine = WorkflowEngine(tool_workflow(tools, **activity), options={
        "actors": {actor_type: actor for actor_type in ActorType}, **(options or {})})
    status = engine.run()["status"]
    return status, engine.get_events(), actor


def test_tool_events_carry_node_attempt_and_call_id_and_fall_inside_their_attempt():
    status, events, actor = run_with_tools(
        [LOOKUP], [("lookup", {"q": "POL-1"})], {"tools": {"handlers": {"lookup": lambda args: {"found": args["q"]}}}})
    assert status == "completed" and actor.results[0].result == {"found": "POL-1"}
    order = [e["type"] for e in events]
    assert order.index("activity.started") < order.index("tool.invoked") < order.index("tool.completed") < order.index("activity.completed")
    invoked, completed = (next(e for e in events if e["type"] == t) for t in ("tool.invoked", "tool.completed"))
    for event in (invoked, completed):
        assert event["node_name"] == "A" and event["attempt"] == 1 and event["time"]
        assert event["token_id"] and event["data"]["link"] == "function:lookup"
    assert invoked["data"]["call_id"] == completed["data"]["call_id"]
    assert invoked["data"]["binding"] == {"kind": "function", "name": "lookup"}
    assert "simulated" not in invoked["data"]


@pytest.mark.parametrize("mode", ["hash", "none"])
def test_the_link_is_on_record_even_when_arguments_and_results_are_not(mode):
    _, events, _ = run_with_tools(
        [LOOKUP], [("lookup", {"q": "confidential"})],
        {"tools": {"handlers": {"lookup": lambda args: {"found": "private"}}}, "journal_payloads": mode})
    invoked, completed = (next(e for e in events if e["type"] == t) for t in ("tool.invoked", "tool.completed"))
    assert invoked["data"]["link"] == completed["data"]["link"] == "function:lookup"
    recorded = json.dumps([invoked, completed])
    assert "confidential" not in recorded and "private" not in recorded
    if mode == "hash":
        assert set(invoked["data"]["arguments"]) == set(completed["data"]["result"]) == {"sha256"}
    else:
        assert "arguments" not in invoked["data"] and "result" not in completed["data"]


def test_the_engine_applies_the_command_policy_and_the_default_budget():
    shell = {"name": "shell", "binding": {"kind": "command", "command": PYTHON, "args": ["-c", "print(41 + 1)"]}}
    status, events, actor = run_with_tools([shell], [("shell", {})])
    assert status == "completed" and actor.results[0].result["code"] == "PERMISSION_DENIED"
    assert "tool.invoked" not in [e["type"] for e in events]

    status, events, actor = run_with_tools([shell], [("shell", {})] * 17, {"tools": {"allow_commands": [PYTHON]}})
    assert actor.results[0].result == 42
    assert [r.ok for r in actor.results] == [True] * 16 + [False]
    assert actor.results[-1].result["code"] == "TOOL_BUDGET_EXCEEDED"


def test_a_simulated_run_executes_no_binding_and_says_so_in_the_journal():
    ran = []
    _, events, actor = run_with_tools(
        [LOOKUP], [("lookup", {"q": "x"})],
        {"simulate": True, "tools": {"handlers": {"lookup": lambda args: ran.append(args)},
                                     "simulated_results": {"lookup": {"found": "scripted"}}}})
    assert ran == [] and actor.results[0].result == {"found": "scripted"}
    assert next(e for e in events if e["type"] == "tool.invoked")["data"]["simulated"] is True


def test_an_actor_that_takes_no_context_still_runs_an_activity_with_tools():
    class Plain:
        def execute(self, activity, token):
            return {"done": True}

    engine = WorkflowEngine(tool_workflow([LOOKUP]), options={"actors": {t: Plain() for t in ActorType}})
    assert engine.run()["status"] == "completed"


def test_two_tools_of_the_same_name_on_one_activity_are_rejected():
    result = validate_workflow_integrity(tool_workflow([LOOKUP, LOOKUP]))
    assert not result.valid and "duplicate_id" in [e.code for e in result.errors]
    with pytest.raises(ValueError):
        WorkflowEngine(tool_workflow([LOOKUP, LOOKUP]))


def test_unknown_tool_options_are_rejected():
    with pytest.raises(ValueError):
        WorkflowEngine(tool_workflow([LOOKUP]), options={"tools": {"allow_command": True}})


# ----------------------------------------------------------------------
# Model references and the router
# ----------------------------------------------------------------------

def failing(message, code=None):
    def fail(request):
        error = RuntimeError(message)
        if code:
            error.code = code
        raise error
    return fail


def registry(*providers, **tiers):
    models = ModelRegistry()
    for provider in providers:
        models.register(provider)
    for tier, refs in tiers.items():
        models.set_tier(tier, refs)
    return models


def test_the_three_forms_of_reference():
    first, second = FunctionModelProvider("first", lambda r: "a"), FunctionModelProvider("second", lambda r: "b")
    models = registry(first, second, fast=["second:small"], legal="first:careful")

    direct = models.resolve("second:large")
    assert (direct.provider, direct.model, direct.ref, direct.tier) == (second, "large", "second:large", None)
    bare = models.resolve("large")
    assert (bare.provider, bare.model, bare.ref) == (first, "large", "first:large")
    # The part before the colon is a provider only if one is registered under that name
    tuned = models.resolve("ft:custom:v2")
    assert (tuned.provider, tuned.model) == (first, "ft:custom:v2")
    # A model name may itself contain colons after the provider
    assert models.resolve("second:family:4b").model == "family:4b"
    tier = models.resolve("tier:fast")
    assert (tier.ref, tier.tier) == ("second:small", "fast")
    assert models.resolve("tier:legal").ref == "first:careful"

    models.set_default_provider("second")
    assert models.resolve("large").ref == "second:large"


def test_references_that_cannot_be_resolved_are_validation_errors():
    with pytest.raises(ModelError) as none_registered:
        ModelRegistry().resolve("anything")
    assert none_registered.value.code == "VALIDATION_ERROR"

    models = registry(FunctionModelProvider("local", lambda r: "x"), loop=["tier:fast"], cloud=["cloud:big", "other:big"])
    for ref, wording in (("tier:unmapped", "not mapped"), ("tier:loop", "not to another tier"), ("tier:cloud", "No provider is registered")):
        with pytest.raises(ModelError) as error:
            models.candidates(ref)
        assert error.value.code == "VALIDATION_ERROR" and wording in str(error.value)
    with pytest.raises(ValueError):
        models.set_tier("empty", [])


def test_the_router_uses_the_first_candidate_and_reports_the_route():
    first, second = FunctionModelProvider("first", lambda r: "from first"), FunctionModelProvider("second", lambda r: "from second")
    routed = ModelRouter(registry(first, second, fast=["first:a", "second:b"])).generate(
        "tier:fast", ModelRequest(system="Be brief.", prompt="hello", temperature=0.2))
    assert routed.response.text == "from first"
    assert (routed.model.ref, routed.model.tier) == ("first:a", "fast")
    assert [r.to_dict() for r in routed.route] == [{"ref": "first:a", "outcome": "used"}]
    assert second.requests == []
    # The provider is given the model name, already resolved, and the rest of the request unchanged
    sent = first.requests[0]
    assert (sent.model, sent.system, sent.prompt, sent.temperature) == ("a", "Be brief.", "hello", 0.2)
    assert request_messages(sent) == [{"role": "system", "content": "Be brief."}, {"role": "user", "content": "hello"}]
    assert routed.response.usage == {"input_tokens": 4, "output_tokens": 3}


def test_the_router_falls_back_and_stops_at_the_one_that_serves():
    down = FunctionModelProvider("down", failing("quota exhausted", "RATE_LIMITED"))
    up, spare = FunctionModelProvider("up", lambda r: "served"), FunctionModelProvider("spare", lambda r: "unused")
    routed = ModelRouter(registry(down, up, spare, fast=["down:a", "up:b", "spare:c"])).generate("tier:fast", ModelRequest(prompt="x"))
    assert routed.model.ref == "up:b"
    assert [r.to_dict() for r in routed.route] == [
        {"ref": "down:a", "outcome": "failed", "reason": "RATE_LIMITED: quota exhausted"}, {"ref": "up:b", "outcome": "used"}]
    assert spare.requests == []


def test_the_router_skips_providers_that_cannot_call_tools_when_the_request_has_tools():
    embedded = FunctionModelProvider("embedded", lambda r: "no tools here", tools=False)
    capable = FunctionModelProvider("capable", lambda r: {"text": "", "tool_calls": [{"id": "1", "name": "lookup", "arguments": {}}]})
    router = ModelRouter(registry(embedded, capable, fast=["embedded:tiny", "capable:big"]))
    spec = [{"name": "lookup", "description": "Look up", "parameters": {"type": "object"}}]

    with_tools = router.generate("tier:fast", ModelRequest(prompt="x", tools=spec))
    assert with_tools.model.ref == "capable:big" and with_tools.response.tool_calls[0]["name"] == "lookup"
    assert with_tools.route[0].to_dict() == {"ref": "embedded:tiny", "outcome": "skipped", "reason": "provider cannot call tools"}
    assert embedded.requests == []
    # Without tools the same provider serves
    assert router.generate("tier:fast", ModelRequest(prompt="x")).model.ref == "embedded:tiny"

    # A skipped only candidate is the end of the route, and not the fault of a provider
    with pytest.raises(ModelError) as error:
        router.generate("embedded:tiny", ModelRequest(prompt="x", tools=spec))
    assert error.value.code == "VALIDATION_ERROR" and error.value.route[0].outcome == "skipped"


def test_tier_candidates_whose_provider_is_not_registered_are_left_out():
    local = FunctionModelProvider("local", lambda r: "x")
    models = registry(local, fast=["cloud:big", "local:small", "other:big"])
    assert [c.ref for c in models.candidates("tier:fast")] == ["local:small"]


def test_the_router_fails_with_the_whole_route_when_no_candidate_serves():
    a, b = FunctionModelProvider("a", failing("quota exhausted", "RATE_LIMITED")), FunctionModelProvider("b", failing("connection refused"))
    with pytest.raises(ModelError) as error:
        ModelRouter(registry(a, b, fast=["a:x", "b:y"])).generate("tier:fast", ModelRequest(prompt="x"))
    assert [(r.ref, r.outcome) for r in error.value.route] == [("a:x", "failed"), ("b:y", "failed")]
    assert error.value.code == "PROVIDER_ERROR"
    assert "a:x failed (RATE_LIMITED: quota exhausted); b:y failed (connection refused)" in str(error.value)


def test_the_router_does_not_try_further_candidates_after_an_invalid_request():
    strict = FunctionModelProvider("strict", failing("the request is malformed", "VALIDATION_ERROR"))
    spare = FunctionModelProvider("spare", lambda r: "unused")
    with pytest.raises(ModelError) as error:
        ModelRouter(registry(strict, spare, fast=["strict:a", "spare:b"])).generate("tier:fast", ModelRequest(prompt="x"))
    assert error.value.code == "VALIDATION_ERROR" and len(error.value.route) == 1
    assert spare.requests == []


def test_a_direct_reference_has_one_candidate_and_no_other_model_is_substituted():
    down, up = FunctionModelProvider("down", failing("connection refused")), FunctionModelProvider("up", lambda r: "x")
    with pytest.raises(ModelError) as error:
        ModelRouter(registry(down, up, fast=["up:b"])).generate("down:a", ModelRequest(prompt="x"))
    assert [(r.ref, r.outcome) for r in error.value.route] == [("down:a", "failed")]
    assert up.requests == []


# ----------------------------------------------------------------------
# Model decisions
# ----------------------------------------------------------------------

def triage_workflow(default=True, table=False, engine=False, use_model=True, **decision_model):
    ids = {name: uid() for name in ("Intake", "Triage", "Pay", "Review", "Manual", "to_pay", "to_review", "to_manual")}
    options = [{"id": "pay", "description": "Simple and covered", "output_edge_id": ids["to_pay"]},
               {"id": "review", "description": "Unusual or unclear", "output_edge_id": ids["to_review"]}]
    node = {"id": ids["Triage"], "name": "Triage", "description": "Route the claim."}
    if use_model:
        node["decision_model"] = {"instructions": "Pay simple claims.", "options": options, **decision_model}
    if table:
        node["decision_table"] = {
            "hit_policy": "first", "inputs": [{"name": "amount", "type": "number"}], "outputs": [{"name": "route", "type": "string"}],
            "rules": [{"input_entries": ["< 100"], "output_entries": ["pay"], "output_edge_id": ids["to_pay"]}]}
    if engine:
        node["decision_engine"] = {"name": "rules", "ruleset": "claims-v3", "options": options, "inputs": ["amount"]}
    if default:
        node["default_output_edge_id"] = ids["to_manual"]
    return Workflow.model_validate({
        "id": uid(), "name": "Triage", "version": "1.0.0",
        "activities": [{"id": ids[name], "name": name, "role_id": uid(), "actor_type": "application"}
                       for name in ("Intake", "Pay", "Review", "Manual")],
        "decision_nodes": [node],
        "edges": [
            {"id": uid(), "source_id": ids["Intake"], "target_id": ids["Triage"]},
            {"id": ids["to_pay"], "source_id": ids["Triage"], "target_id": ids["Pay"]},
            {"id": ids["to_review"], "source_id": ids["Triage"], "target_id": ids["Review"]},
            {"id": ids["to_manual"], "source_id": ids["Triage"], "target_id": ids["Manual"]},
        ],
    })


class Visiting:
    def __init__(self):
        self.visited = []

    def execute(self, activity, token):
        self.visited.append(activity.name)
        return {}


def run_triage(workflow, data=None, **options):
    actor = Visiting()
    engine = WorkflowEngine(workflow, options={"actors": {t: actor for t in ActorType}, **options})
    status = engine.run(data or {"amount": 900, "customer": "Ada", "secret_note": "do not show"})["status"]
    return status, actor.visited, engine


def decision_event(engine):
    return next(e for e in engine.get_events() if e["type"] == "decision.evaluated")["data"]


def node_of(**decision_model):
    return triage_workflow(**decision_model).decision_nodes[0]


def test_replies_are_read_as_votes():
    model = node_of().decision_model
    vote = parse_vote('Sure. {"option": " review ", "confidence": 0.8, "rationale": "Unusual."} Done.', model)
    assert (vote.option, vote.confidence, vote.rationale, vote.invalid) == ("review", 0.8, "Unusual.", None)
    # A confidence outside 0 to 1, or not a number, is not a stated confidence
    for stated in ('1.5', '"high"', 'true', '-0.1'):
        assert parse_vote(f'{{"option": "pay", "confidence": {stated}}}', model).confidence is None
    assert parse_vote('{"option": "refund", "confidence": 0.9}', model).invalid == '"refund" is not one of the options'
    assert parse_vote('{"confidence": 0.9}', model).invalid == "the reply names no option"
    assert parse_vote('{"option": ["pay"]}', model).option is None
    # Not JSON: counts if exactly one option id appears, as a word of its own, and has no confidence
    loose = parse_vote("I would send this one to review.", model)
    assert (loose.option, loose.confidence) == ("review", None)
    assert parse_vote("{option: pay}", model).option == "pay"
    assert parse_vote("Either pay or review would do.", model).invalid == "the reply names more than one option"
    for text in ("I cannot tell.", "", "prepay", "reviewed", "pay-later"):
        assert parse_vote(text, model).option is None


def test_the_model_is_shown_the_node_the_instructions_the_options_and_the_selected_inputs_only():
    seen = FunctionModelProvider("p", lambda r: '{"option": "pay", "confidence": 1, "rationale": "ok"}')
    status, visited, engine = run_triage(
        triage_workflow(inputs=["amount", "absent"], model="p:m"), model_providers=[seen])
    assert visited == ["Intake", "Pay"]
    request = seen.requests[0]
    assert request.model == "m" and request.json is True and request.temperature == 0 and not request.tools
    lines = request.prompt.split("\n")
    assert lines[:3] == ["Decision: Triage", "Route the claim.", "Pay simple claims."]
    assert "- pay: Simple and covered" in lines and "- review: Unusual or unclear" in lines
    assert [line for line in lines if line.startswith("- ") and "amount" in line] == ["- amount: 900"]
    assert "Ada" not in request.prompt and "do not show" not in request.prompt and "absent" not in request.prompt
    assert '"option": "<pay or review>"' in lines[-1]

    node = node_of()
    _, everything = decision_prompt(node, node.decision_model, {"amount": 5, "flags": {"vip": True}, "open": False, "note": None})
    assert '- flags: {"vip": true}' in everything and "- open: false" in everything and "- note: null" in everything


def test_without_inputs_the_model_is_shown_all_token_data_but_the_engines_own():
    seen = FunctionModelProvider("p", lambda r: '{"option": "pay"}')
    run_triage(triage_workflow(model="p:m"), model_providers=[seen])
    prompt = seen.requests[0].prompt
    assert "- customer: Ada" in prompt and "- amount: 900" in prompt
    assert "_run_id" not in prompt and "_idempotency_key" not in prompt and "- activities:" not in prompt


def test_several_votes_are_sampled_independently_and_their_confidences_averaged():
    replies = iter(['{"option": "review", "confidence": 0.9, "rationale": "First."}', "review", '{"option": "pay", "confidence": 1}',
                    '{"option": "review", "confidence": 0.5}', "no idea"])
    provider = FunctionModelProvider("p", lambda r: next(replies))
    status, visited, engine = run_triage(triage_workflow(model="p:m", votes=5, output="route"), model_providers=[provider])
    assert visited == ["Intake", "Review"] and len(provider.requests) == 5
    assert {r.temperature for r in provider.requests} == {0.7}
    data = decision_event(engine)
    assert data["method"] == "model" and data["strategy"] == "model" and data["matched"] is True
    assert data["model"]["option"] == "review" and data["model"]["confidence"] == pytest.approx(0.7)
    assert data["model"]["votes"] == [
        {"option": "review", "confidence": 0.9}, {"option": "review"}, {"option": "pay", "confidence": 1.0},
        {"option": "review", "confidence": 0.5}, {"invalid": "the reply is not valid JSON and names no option"}]
    assert data["model"]["usage"]["input_tokens"] > 0 and data["model"]["usage"]["output_tokens"] > 0
    assert "no_decision_reason" not in data["model"]
    token = engine.tokens[0]
    assert token.get_data("route") == "review"
    assert token.get_data("decisions")[str(triage_id(engine))]["method"] == "model"
    reasoning = next(e for e in engine.get_events() if e["type"] == "reasoning.recorded")
    assert reasoning["level"] == "reasoning" and reasoning["data"]["rationale"] == "First."


def triage_id(engine):
    return engine.workflow.decision_nodes[0].id


def test_half_of_the_votes_is_not_a_majority():
    replies = iter(["pay", "pay", "review", "nothing"])
    provider = FunctionModelProvider("p", lambda r: next(replies))
    _, visited, engine = run_triage(triage_workflow(model="p:m", votes=4, temperature=1.2), model_providers=[provider])
    assert visited == ["Intake", "Manual"] and provider.requests[0].temperature == 1.2
    data = decision_event(engine)
    assert data["method"] == "default" and data["used_default"] is True and data["matched"] is False
    assert data["model"]["no_decision_reason"] == "no option has a majority (pay: 2, review: 1 of 4 votes)"
    assert "option" not in data["model"]


def test_a_confidence_below_the_minimum_is_no_decision_and_says_why():
    provider = FunctionModelProvider("p", lambda r: '{"option": "pay", "confidence": 0.55, "rationale": "Maybe."}')
    _, visited, engine = run_triage(triage_workflow(model="p:m", min_confidence=0.7, default=False), model_providers=[provider])
    assert visited == ["Intake"]
    data = decision_event(engine)
    assert data["method"] == "none" and data["model"]["min_confidence"] == 0.7 and data["model"]["confidence"] == 0.55
    assert data["model"]["no_decision_reason"] == "confidence 0.55 is below the required 0.7"
    token = engine.tokens[0]
    assert token.get_data("_error_code") == "NO_ROUTE" and "confidence 0.55" in token.get_data("_error")


def test_the_default_strategy_is_table_first_when_the_node_has_a_table():
    provider = FunctionModelProvider("p", lambda r: '{"option": "review", "confidence": 0.9}')
    _, visited, engine = run_triage(triage_workflow(table=True, model="p:m"), {"amount": 40}, model_providers=[provider])
    assert visited == ["Intake", "Pay"] and provider.requests == []
    data = decision_event(engine)
    assert data["method"] == "table" and data["strategy"] == "table_first" and "model" not in data
    assert engine.tokens[0].get_data("route") == "pay"

    _, visited, engine = run_triage(triage_workflow(table=True, model="p:m"), {"amount": 400}, model_providers=[provider])
    assert visited == ["Intake", "Review"] and len(provider.requests) == 1
    assert decision_event(engine)["method"] == "model"


def test_a_decision_that_names_no_model_uses_the_engine_default_and_says_so():
    provider = FunctionModelProvider("p", lambda r: '{"option": "pay", "confidence": 0.9}')
    _, visited, engine = run_triage(triage_workflow(), model_providers=[provider], default_ai_model_id="p:chosen")
    assert visited == ["Intake", "Pay"] and provider.requests[0].model == "chosen"
    selection = next(e for e in engine.get_events() if e["type"] == "meta.recorded")
    assert selection["level"] == "meta" and selection["node_name"] == "Triage"
    assert selection["data"]["model"] == {"provider": "p", "id": "chosen", "requested": "p:chosen"}
    assert "engine default" in selection["data"]["rationale"]

    # With no default configured the reference is the balanced tier, which the deployment maps
    _, visited, engine = run_triage(triage_workflow(), model_providers=[provider], model_tiers={"balanced": "p:general"})
    assert visited == ["Intake", "Pay"] and provider.requests[-1].model == "general"


def test_a_reference_that_cannot_be_resolved_is_no_decision_and_no_other_model_is_substituted():
    provider = FunctionModelProvider("p", lambda r: '{"option": "pay", "confidence": 0.9}')
    _, visited, engine = run_triage(triage_workflow(model="tier:legal"), model_providers=[provider], model_tiers={"fast": "p:m"})
    assert visited == ["Intake", "Manual"] and provider.requests == []
    data = decision_event(engine)
    assert data["method"] == "default" and 'tier "legal" is not mapped' in data["model"]["no_decision_reason"]
    assert not [e for e in engine.get_events() if e["type"] == "meta.recorded"]


def test_a_fallback_is_journalled_as_the_route_and_the_model_that_served_as_the_selection():
    down = FunctionModelProvider("down", failing("quota exhausted", "RATE_LIMITED"))
    up = FunctionModelProvider("up", lambda r: '{"option": "review", "confidence": 0.9, "rationale": "Unusual."}')
    _, visited, engine = run_triage(
        triage_workflow(model="tier:fast"), model_providers=[down, up], model_tiers={"fast": ["down:a", "up:b"]})
    assert visited == ["Intake", "Review"]
    meta = {e["data"]["subject"]: e["data"] for e in engine.get_events() if e["type"] == "meta.recorded"}
    assert meta["model_selection"]["model"] == {"provider": "up", "id": "b", "requested": "tier:fast", "tier": "fast"}
    assert meta["model_route"]["decision"] == "Route to up:b"
    assert meta["model_route"]["route"] == [
        {"ref": "down:a", "outcome": "failed", "reason": "RATE_LIMITED: quota exhausted"}, {"ref": "up:b", "outcome": "used"}]
    assert "down:a was tried and failed: RATE_LIMITED: quota exhausted." == meta["model_route"]["rationale"]


def test_a_decision_can_be_supplied_without_calling_a_model():
    provider = FunctionModelProvider("p", lambda r: '{"option": "pay"}')
    workflow = triage_workflow(model="p:m")
    _, visited, engine = run_triage(workflow, model_providers=[provider],
                                    model_decision_override=lambda node: {"option": "review", "confidence": 0.6})
    assert visited == ["Intake", "Review"] and provider.requests == []
    assert decision_event(engine)["model"]["option"] == "review"

    # An option that was not offered is still no decision
    _, visited, engine = run_triage(workflow, model_providers=[provider], model_decision_override=lambda node: {"option": "refund"})
    assert visited == ["Intake", "Manual"]
    assert decision_event(engine)["model"]["no_decision_reason"] == '"refund" is not one of the options'


def test_in_simulation_no_model_is_called():
    provider = FunctionModelProvider("p", lambda r: '{"option": "pay"}')
    workflow = triage_workflow(model="p:m")
    _, visited, engine = run_triage(workflow, model_providers=[provider], simulate=True)
    assert visited == ["Intake", "Manual"] and provider.requests == []
    assert decision_event(engine)["model"]["no_decision_reason"] == "simulation mode supplies no model decision"

    _, visited, _ = run_triage(workflow, model_providers=[provider], simulate=True,
                               simulated_outputs={"Triage": {"output": {"option": "pay", "confidence": 1}}})
    assert visited == ["Intake", "Pay"] and provider.requests == []


def test_decide_with_model_reports_the_votes_and_the_usage():
    provider = FunctionModelProvider("p", lambda r: {"text": '{"option": "pay", "confidence": 0.9}', "usage": {"input_tokens": 50, "output_tokens": 7}})
    node = node_of(votes=3)
    decided = decide_with_model(node, {"amount": 1}, ModelRouter(registry(provider)), "p:m")
    assert decided.option == "pay" and decided.confidence == pytest.approx(0.9)
    assert decided.edge_id == str(node.decision_model.options[0].output_edge_id)
    assert decided.usage == {"input_tokens": 150, "output_tokens": 21}
    assert [vote.model for vote in decided.votes] == ["p:m"] * 3


def test_options_must_be_unique_and_their_edges_must_leave_the_node():
    document = json.loads(triage_workflow(model="p:m").model_dump_json())
    node = document["decision_nodes"][0]
    node["decision_model"]["options"][1]["id"] = "pay"
    result = validate_workflow_integrity(Workflow.model_validate(document))
    assert "duplicate_id" in [e.code for e in result.errors]

    document = json.loads(triage_workflow(model="p:m").model_dump_json())
    document["decision_nodes"][0]["decision_model"]["options"][0]["output_edge_id"] = document["edges"][0]["id"]
    result = validate_workflow_integrity(Workflow.model_validate(document))
    assert "invalid_reference" in [e.code for e in result.errors]

    with pytest.raises(Exception):
        DecisionNode.model_validate({"id": uid(), "name": "D", "decision_model": {
            "instructions": "x", "options": [{"id": "only", "description": "one", "output_edge_id": uid()}]}})


# ----------------------------------------------------------------------
# External decision engines (5.5.4)
# ----------------------------------------------------------------------

def test_an_external_engine_decides_within_the_options_and_its_outputs_become_token_data():
    asked = []

    def rules(request):
        asked.append(request)
        return {"option": "review", "outputs": {"risk": "high"}, "explanation": "Rule 7 fired", "fired_rules": ["R7"]}

    _, visited, engine = run_triage(triage_workflow(engine=True, use_model=False), decision_engines={"rules": rules})
    assert visited == ["Intake", "Review"]
    assert asked[0]["ruleset"] == "claims-v3" and asked[0]["inputs"] == {"amount": 900}
    assert [o["id"] for o in asked[0]["options"]] == ["pay", "review"]
    data = decision_event(engine)
    assert data["method"] == "engine" and data["strategy"] == "engine"
    assert data["engine"]["option"] == "review" and data["engine"]["fired_rules"] == ["R7"]
    assert engine.tokens[0].get_data("risk") == "high"


def test_an_engine_that_reaches_no_decision_leaves_it_to_the_model_then_the_default_edge():
    provider = FunctionModelProvider("p", lambda r: '{"option": "pay", "confidence": 0.9}')
    for answer, reason in (({"option": "refund"}, '"refund" is not one of the options'), ({}, "the engine returned no option")):
        _, visited, engine = run_triage(triage_workflow(engine=True, use_model=False), decision_engines={"rules": lambda request: answer})
        assert visited == ["Intake", "Manual"]
        assert decision_event(engine)["engine"]["no_decision_reason"] == reason

    def broken(request):
        raise RuntimeError("rule base offline")

    _, visited, engine = run_triage(triage_workflow(engine=True, model="p:m"), model_providers=[provider],
                                    decision_engines={"rules": broken})
    assert visited == ["Intake", "Pay"]
    data = decision_event(engine)
    assert data["method"] == "model" and data["strategy"] == "table_first"
    assert data["engine"]["no_decision_reason"] == "the engine failed: rule base offline"


def test_an_engine_that_is_not_registered_fails_the_token():
    status, visited, engine = run_triage(triage_workflow(engine=True, use_model=False))
    assert status == "failed" and visited == ["Intake"]
    assert engine.tokens[0].get_data("_error_code") == "VALIDATION_ERROR"
