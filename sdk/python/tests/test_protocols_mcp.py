"""
The built-in MCP executor (specification 17.7), against a server built with the
reference SDK (the `mcp` package) that the tests start: over standard input and
output, and over Streamable HTTP on localhost.
"""

import os
import socket
import subprocess
import sys
import tempfile
import time
import urllib.request
from pathlib import Path

import pytest

from awa.runtime.protocols.sessions import ToolSessions
from awa.runtime.tools import ToolRunner
from awa.runtime.workflow_engine import EngineStatus, WorkflowEngine
from awa.types import ActorType, ToolBinding, ToolDefinition, Workflow

pytest.importorskip("mcp.server.mcpserver", reason="the reference MCP server needs the 'mcp' package")

FIXTURE = str(Path(__file__).parent / "fixtures" / "mcp_server.py")
PYTHON = sys.executable


def tool(name, server="docs", timeout=None):
    return ToolDefinition(name=name, binding=ToolBinding(kind="mcp", server=server, tool=name), timeout=timeout)


def runner(tools, options, simulate=False):
    events = []
    return ToolRunner(tools, options, lambda type, data: events.append((type, data)), max_calls=20, simulate=simulate), events


def alive(pid):
    try:
        os.kill(pid, 0)
        return True
    except OSError:
        return False


STDIO = {"allow_commands": [PYTHON], "mcp_servers": {"docs": {"command": PYTHON, "args": [FIXTURE, "stdio"]}}}


def test_stdio_maps_structured_content_text_and_errors_over_one_connection():
    sessions = ToolSessions()
    tools, events = runner([tool("lookup"), tool("words"), tool("count"), tool("broken"), tool("slow", timeout="PT0.3S")],
                           {**STDIO, "sessions": sessions})
    assert tools.call("lookup", {"policy": "P-1"}).result == {"policy": "P-1", "covered": True}
    assert tools.call("words").result == "not json"
    first, second = tools.call("count").result, tools.call("count").result
    assert second["count"] == first["count"] + 1 and first["pid"] == second["pid"]
    failed = tools.call("broken")
    # The reference server reports an exception as a result with isError, in its own words
    assert failed.result["code"] == "TOOL_ERROR" and "broken" in failed.result["error"]
    assert next(data for type, data in events if type == "tool.failed")["invoked"] is True
    assert tools.call("slow").result["code"] == "TIMEOUT"
    invoked = next(data for type, data in events if type == "tool.invoked")
    assert invoked["link"] == "mcp://docs/lookup" and invoked["binding"] == {"kind": "mcp", "server": "docs", "tool": "lookup"}
    assert len(sessions) == 1
    sessions.close()
    deadline = time.monotonic() + 5
    while alive(first["pid"]) and time.monotonic() < deadline:
        time.sleep(0.05)
    assert not alive(first["pid"])


def test_a_server_is_not_started_unless_the_deployment_allows_its_command():
    marker = os.path.join(tempfile.mkdtemp(), "started")
    servers = {"docs": {"command": PYTHON, "args": [FIXTURE, "stdio", marker]}}
    for allow in (False, ["node"]):
        tools, events = runner([tool("count")], {"allow_commands": allow, "mcp_servers": servers})
        assert tools.call("count").result["code"] == "PERMISSION_DENIED"
        assert [type for type, _ in events] == ["tool.failed"] and events[0][1]["invoked"] is False
    tools, _ = runner([tool("count", "elsewhere")], {"allow_commands": True, "mcp_servers": servers})
    result = tools.call("count").result
    assert result["code"] == "PERMISSION_DENIED" and 'declares no MCP server "elsewhere"' in result["error"]
    time.sleep(0.3)
    assert not os.path.exists(marker)


def test_simulation_starts_no_server():
    marker = os.path.join(tempfile.mkdtemp(), "started")
    tools, events = runner([tool("count")], {"allow_commands": True, "simulated_results": {"count": {"count": 99}},
                                             "mcp_servers": {"docs": {"command": PYTHON, "args": [FIXTURE, "stdio", marker]}}},
                           simulate=True)
    assert tools.call("count").result == {"count": 99}
    assert events[0][1]["simulated"] is True
    time.sleep(0.3)
    assert not os.path.exists(marker)


def test_a_run_reuses_one_connection_and_stops_the_server_when_it_ends():
    results = []

    class Actor:
        def execute(self, activity, token, context):
            results.append(context.tools.call("count").result)
            results.append(context.tools.call("count").result)
            return {f"{activity.name}_done": True}

    tools = [{"name": "count", "binding": {"kind": "mcp", "server": "docs", "tool": "count"}}]
    role = "11111111-1111-4111-8111-0000000000ff"
    workflow = Workflow.model_validate({
        "id": "11111111-1111-4111-8111-111111111111", "name": "mcp-run", "version": "1.0.0", "awa_version": "1.1",
        "activities": [{"id": "11111111-1111-4111-8111-000000000001", "name": "A", "role_id": role, "actor_type": "application", "tools": tools},
                       {"id": "11111111-1111-4111-8111-000000000002", "name": "B", "role_id": role, "actor_type": "application", "tools": tools}],
        "edges": [{"id": "11111111-1111-4111-8111-000000000003", "source_id": "11111111-1111-4111-8111-000000000001",
                   "target_id": "11111111-1111-4111-8111-000000000002"}],
    })
    engine = WorkflowEngine(workflow, options={"actors": {ActorType.application: Actor()}, "tools": STDIO, "log_execution": False})
    assert engine.run({})["status"] == EngineStatus.COMPLETED.value
    assert [r["count"] for r in results] == [1, 2, 3, 4]
    assert len({r["pid"] for r in results}) == 1
    deadline = time.monotonic() + 5
    while alive(results[0]["pid"]) and time.monotonic() < deadline:
        time.sleep(0.05)
    assert not alive(results[0]["pid"])


@pytest.fixture(scope="module")
def http_server():
    with socket.socket() as probe:
        probe.bind(("127.0.0.1", 0))
        port = probe.getsockname()[1]
    process = subprocess.Popen([PYTHON, FIXTURE, "http", str(port)], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    url = f"http://127.0.0.1:{port}/mcp"
    for _ in range(100):
        try:
            urllib.request.urlopen(urllib.request.Request(url, method="GET"), timeout=0.5)
            break
        except urllib.error.HTTPError:
            break  # it answers
        except OSError:
            time.sleep(0.1)
    yield port
    process.terminate()
    process.wait(timeout=5)


def test_streamable_http_calls_tools_over_one_session(http_server):
    sessions = ToolSessions()
    options = {"allowed_hosts": [f"127.0.0.1:{http_server}"], "sessions": sessions,
               "mcp_servers": {"search": {"url": f"http://127.0.0.1:{http_server}/mcp"}}}
    tools, _ = runner([tool("lookup", "search"), tool("count", "search"), tool("broken", "search"), tool("slow", "search", "PT0.3S")], options)
    assert tools.call("lookup", {"policy": "P-0"}).result == {"policy": "P-0", "covered": False}
    first, second = tools.call("count").result, tools.call("count").result
    assert second["count"] == first["count"] + 1
    assert tools.call("broken").result["code"] == "TOOL_ERROR"
    assert tools.call("slow").result["code"] == "TIMEOUT"
    assert len(sessions) == 1
    sessions.close()


def test_streamable_http_is_held_to_the_allowed_hosts(http_server):
    tools, events = runner([tool("lookup", "search")], {"allowed_hosts": ["api.example.com"],
                                                        "mcp_servers": {"search": {"url": f"http://127.0.0.1:{http_server}/mcp"}}})
    assert tools.call("lookup", {"policy": "P-1"}).result["code"] == "PERMISSION_DENIED"
    assert [type for type, _ in events] == ["tool.failed"]


def test_a_server_that_is_not_there_fails_the_call():
    tools, _ = runner([tool("lookup", "gone")], {"mcp_servers": {"gone": {"url": "http://127.0.0.1:1/mcp"}}})
    assert tools.call("lookup", {"policy": "P-1"}).result["code"] == "TOOL_ERROR"
