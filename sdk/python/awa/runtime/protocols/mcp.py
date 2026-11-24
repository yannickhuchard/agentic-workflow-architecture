"""
The built-in executor of "mcp" tool bindings (specification 17.7).

A deployment declares its Model Context Protocol servers by name: a program
the engine starts and speaks to over standard input and output, or an
address it reaches over Streamable HTTP. A binding names the server and the
tool. Connections are opened with the initialize handshake of MCP revision
2025-11-25, kept for the run, and closed when it ends or waits.

The client is written here with the standard library: MCP is JSON-RPC 2.0
over one of two transports.
"""

import itertools
import json
import os
import subprocess
import threading
import urllib.error
import urllib.parse
import urllib.request
from typing import Any, Callable

from awa.runtime.protocols.common import web_url, with_secrets
from awa.runtime.tools import ToolError, _host

MCP_PROTOCOL_VERSION = "2025-11-25"
MCP_ACCEPTED_VERSIONS = ("2024-11-05", "2025-03-26", "2025-06-18", "2025-11-25")


class _NoRedirect(urllib.request.HTTPRedirectHandler):
    """A redirect is not followed: the server is the address the deployment declared"""

    def redirect_request(self, req: Any, fp: Any, code: int, msg: str, headers: Any, newurl: str) -> Any:
        raise ToolError("The MCP server answered with a redirect, which is not followed", "TOOL_ERROR")


class McpConnection:
    """One connection to one MCP server, opened by the initialize handshake"""

    def __init__(self, name: str) -> None:
        self.name = name
        self._ids = itertools.count(1)
        self._pending: dict[Any, dict[str, Any]] = {}
        self._lock = threading.Lock()
        self._closed = False
        self._transport: Any = None
        self.protocol_version = ""
        self.server_info: dict[str, Any] = {}

    @classmethod
    def open(cls, name: str, config: dict[str, Any], secrets: dict[str, str], allowed_hosts: list[str] | None,
             max_output_bytes: int, timeout: float) -> "McpConnection":
        connection = cls(name)
        if "command" in config:
            connection._transport = _StdioTransport(name, config, max_output_bytes, connection._receive, connection._fail)
        else:
            connection._transport = _HttpTransport(name, config, secrets, allowed_hosts, max_output_bytes, connection._receive)
        try:
            result = connection.request("initialize", {
                "protocolVersion": MCP_PROTOCOL_VERSION, "capabilities": {},
                "clientInfo": {"name": "awa", "version": "2"},
            }, timeout)
            version = str((result or {}).get("protocolVersion") or "")
            if version not in MCP_ACCEPTED_VERSIONS:
                raise ToolError(f'MCP server "{name}" answered with protocol revision "{version}", which this engine does not speak', "TOOL_ERROR")
            connection.protocol_version = version
            connection.server_info = (result or {}).get("serverInfo") or {}
            connection._transport.negotiated(version)
            connection._transport.send({"jsonrpc": "2.0", "method": "notifications/initialized"}, timeout)
            return connection
        except BaseException:
            connection.close()
            raise

    def request(self, method: str, params: Any, timeout: float) -> Any:
        """Send a request and wait for its answer. A JSON-RPC error raises with its code as status."""
        if self._closed:
            raise ToolError(f'The connection to MCP server "{self.name}" is closed', "TOOL_ERROR")
        request_id = next(self._ids)
        slot: dict[str, Any] = {"event": threading.Event()}
        with self._lock:
            self._pending[request_id] = slot
        try:
            self._transport.send({"jsonrpc": "2.0", "id": request_id, "method": method, "params": params}, timeout)
            if not slot["event"].wait(timeout):
                # The server is told the request is cancelled
                try:
                    self._transport.send({"jsonrpc": "2.0", "method": "notifications/cancelled",
                                          "params": {"requestId": request_id, "reason": "timeout"}}, 2)
                except Exception:
                    pass
                raise ToolError(f'MCP server "{self.name}" did not answer {method} in time', "TIMEOUT")
        finally:
            with self._lock:
                self._pending.pop(request_id, None)
        if "failure" in slot:
            raise slot["failure"]
        reply = slot["reply"]
        error = reply.get("error")
        if error:
            raise ToolError(f'MCP error {error.get("code")} from "{self.name}": {error.get("message")}', "TOOL_ERROR", error.get("code"))
        return reply.get("result")

    def call_tool(self, tool: str, args: dict[str, Any], timeout: float) -> Any:
        """Call a tool. The outcome is mapped as specification 17.7 says."""
        result = self.request("tools/call", {"name": tool, "arguments": args}, timeout) or {}
        content = result.get("content") if isinstance(result.get("content"), list) else []
        if result.get("isError"):
            text = "\n".join(str(c.get("text")) for c in content if isinstance(c, dict) and c.get("type") == "text")
            raise ToolError(text or f'Tool "{tool}" reported an error', "TOOL_ERROR", None, content)
        if result.get("structuredContent") is not None:
            return result["structuredContent"]
        if len(content) == 1 and isinstance(content[0], dict) and content[0].get("type") == "text":
            text = str(content[0].get("text") or "")
            try:
                return json.loads(text)
            except ValueError:
                return text
        return content

    def _receive(self, message: dict[str, Any]) -> None:
        if not isinstance(message, dict):
            return
        if "method" in message:
            # A request from the server: answer ping, refuse the rest. Notifications are ignored.
            if message.get("id") is not None:
                reply = ({"jsonrpc": "2.0", "id": message["id"], "result": {}} if message["method"] == "ping" else
                         {"jsonrpc": "2.0", "id": message["id"], "error": {"code": -32601, "message": f"This client does not offer {message['method']}"}})
                try:
                    self._transport.send(reply, 5)
                except Exception:
                    pass
            return
        with self._lock:
            slot = self._pending.get(message.get("id"))
        if slot is not None:
            slot["reply"] = message
            slot["event"].set()

    def _fail(self, error: ToolError) -> None:
        with self._lock:
            pending = list(self._pending.values())
            self._closed = True
        for slot in pending:
            slot["failure"] = error
            slot["event"].set()

    def close(self) -> None:
        self._fail(ToolError(f'The connection to MCP server "{self.name}" was closed', "TOOL_ERROR"))
        if self._transport is not None:
            try:
                self._transport.close()
            except Exception:
                pass


class _StdioTransport:
    """A server the engine starts: newline-delimited JSON-RPC over its standard input and output"""

    def __init__(self, name: str, config: dict[str, Any], limit: int, deliver: Callable[[dict[str, Any]], None],
                 fail: Callable[[ToolError], None]) -> None:
        self.name = name
        self._stderr = b""
        self._write = threading.Lock()
        try:
            # No shell: each element of args is one argument
            self.process = subprocess.Popen(
                [config["command"], *(config.get("args") or [])], stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                stderr=subprocess.PIPE, env={**os.environ, **(config.get("env") or {})}, cwd=config.get("cwd"))
        except OSError as error:
            raise ToolError(f'MCP server "{name}" could not be started: {error.strerror or error}', "TOOL_ERROR") from None

        def read() -> None:
            stdout = self.process.stdout
            assert stdout is not None
            while True:
                line = stdout.readline(limit + 1)
                if not line:
                    break
                if len(line) > limit and not line.endswith(b"\n"):
                    fail(ToolError(f'MCP server "{name}" sent a message larger than {limit} bytes', "TOOL_ERROR"))
                    self.process.kill()
                    return
                text = line.strip()
                if not text:
                    continue
                try:
                    deliver(json.loads(text))
                except ValueError:
                    continue  # a line that is not JSON-RPC is not a message
            code = self.process.wait()
            tail = self._stderr.decode("utf-8", errors="replace").strip().splitlines()
            fail(ToolError(f'MCP server "{name}" exited with code {code}{": " + tail[-1] if tail else ""}', "TOOL_ERROR"))

        def read_stderr() -> None:
            stderr = self.process.stderr
            assert stderr is not None
            for chunk in iter(lambda: stderr.read(4096), b""):
                self._stderr = (self._stderr + chunk)[-2000:]

        threading.Thread(target=read, daemon=True, name=f"awa-mcp-{name}").start()
        threading.Thread(target=read_stderr, daemon=True, name=f"awa-mcp-{name}-stderr").start()

    def negotiated(self, version: str) -> None:
        pass

    def send(self, message: dict[str, Any], timeout: float) -> None:
        if self.process.poll() is not None:
            raise ToolError(f'MCP server "{self.name}" is not running', "TOOL_ERROR")
        data = (json.dumps(message) + "\n").encode("utf-8")
        try:
            with self._write:
                self.process.stdin.write(data)  # type: ignore[union-attr]
                self.process.stdin.flush()  # type: ignore[union-attr]
        except OSError as error:
            raise ToolError(f'Could not write to MCP server "{self.name}": {error}', "TOOL_ERROR") from None

    def close(self) -> None:
        if self.process.poll() is not None:
            return
        try:
            self.process.stdin.close()  # type: ignore[union-attr]
        except OSError:
            pass
        try:
            self.process.wait(timeout=1)
        except subprocess.TimeoutExpired:
            self.process.terminate()
            try:
                self.process.wait(timeout=2)
            except subprocess.TimeoutExpired:
                self.process.kill()
                self.process.wait()


class _HttpTransport:
    """A server at an address: Streamable HTTP. Each message is POSTed; the answer comes as JSON or as an event stream."""

    def __init__(self, name: str, config: dict[str, Any], secrets: dict[str, str], allowed_hosts: list[str] | None,
                 limit: int, deliver: Callable[[dict[str, Any]], None]) -> None:
        self.name = name
        self.url = web_url(config["url"])
        host = _host(self.url)
        if allowed_hosts is not None and host not in allowed_hosts:
            raise ToolError(f'This deployment does not allow calls to host "{host}"', "PERMISSION_DENIED")
        self.headers = {key.lower(): with_secrets(value, secrets) for key, value in (config.get("headers") or {}).items()}
        self.limit = limit
        self.deliver = deliver
        self.session: str | None = None
        self.version: str | None = None
        self._opener = urllib.request.build_opener(_NoRedirect())

    def negotiated(self, version: str) -> None:
        self.version = version

    def _headers(self) -> dict[str, str]:
        headers = {**self.headers, "content-type": "application/json", "accept": "application/json, text/event-stream"}
        if self.session:
            headers["mcp-session-id"] = self.session
        if self.version:
            headers["mcp-protocol-version"] = self.version
        return headers

    def send(self, message: dict[str, Any], timeout: float) -> None:
        request = urllib.request.Request(self.url, data=json.dumps(message).encode("utf-8"), method="POST", headers=self._headers())
        try:
            try:
                response = self._opener.open(request, timeout=max(timeout, 0.001))
            except urllib.error.HTTPError as error:
                response = error
        except ToolError:
            raise
        except (urllib.error.URLError, OSError) as error:
            reason = getattr(error, "reason", error)
            if isinstance(reason, TimeoutError) or isinstance(error, TimeoutError):
                raise ToolError(f'MCP server "{self.name}" did not answer in time', "TIMEOUT") from None
            raise ToolError(f'MCP server "{self.name}" at {_host(self.url)} could not be reached: {reason}', "TOOL_ERROR") from None
        with response:
            status = response.status if hasattr(response, "status") else response.code
            session = response.headers.get("mcp-session-id")
            if session:
                self.session = session
            if status in (202, 204):
                return
            kind = response.headers.get("content-type") or ""
            if not 200 <= status < 300:
                text = response.read(self.limit + 1).decode("utf-8", errors="replace")
                try:
                    body = json.loads(text)
                except ValueError:
                    body = None
                # An error about a request is delivered as its answer, so the caller sees it
                if isinstance(body, dict) and body.get("error") and "id" in message:
                    self.deliver({**body, "id": body.get("id") if body.get("id") is not None else message["id"]})
                    return
                raise ToolError(f'HTTP {status} from MCP server "{self.name}"', "TOOL_ERROR", status)
            if "text/event-stream" in kind:
                # Each event's data is one JSON-RPC message. The stream is read until the answer to this request has come.
                size, data = 0, []
                while True:
                    line = response.readline(self.limit + 1)
                    if not line:
                        break
                    size += len(line)
                    if size > self.limit:
                        raise ToolError(f'MCP server "{self.name}" sent a reply larger than {self.limit} bytes', "TOOL_ERROR")
                    text = line.decode("utf-8", errors="replace").rstrip("\r\n")
                    if text == "":
                        if data:
                            try:
                                parsed = json.loads("\n".join(data))
                            except ValueError:
                                parsed = None
                            data = []
                            if isinstance(parsed, dict):
                                self.deliver(parsed)
                                if "id" in message and parsed.get("id") == message["id"] and "method" not in parsed:
                                    return
                    elif text.startswith("data:"):
                        data.append(text[5:][1:] if text[5:].startswith(" ") else text[5:])
                return
            raw = response.read(self.limit + 1)
            if len(raw) > self.limit:
                raise ToolError(f'MCP server "{self.name}" sent a reply larger than {self.limit} bytes', "TOOL_ERROR")
        if not raw.strip():
            return
        try:
            body = json.loads(raw)
        except ValueError:
            raise ToolError(f'MCP server "{self.name}" did not answer in JSON', "TOOL_ERROR") from None
        for item in body if isinstance(body, list) else [body]:
            self.deliver(item)

    def close(self) -> None:
        if not self.session:
            return
        # Ending the session is a courtesy; a server that does not support it answers 405
        try:
            self._opener.open(urllib.request.Request(self.url, method="DELETE", headers=self._headers()), timeout=2).close()
        except Exception:
            pass


def call_mcp_tool(binding: Any, args: dict[str, Any], context: Any) -> Any:
    """Run an "mcp" binding: the server's connection is taken from the run's sessions, or opened"""
    servers = (context.options.mcp_servers if context.options is not None else None) or {}
    config = servers.get(binding.server)
    if config is None:
        raise ToolError(f'This deployment declares no MCP server "{binding.server}"', "PERMISSION_DENIED")
    key = f"mcp:{binding.server}"
    connection = context.sessions.get(key, lambda: McpConnection.open(
        binding.server, config, context.secrets, context.allowed_hosts, context.max_output_bytes, context.remaining_seconds))
    try:
        return connection.call_tool(binding.tool, args, context.remaining_seconds)
    except ToolError as error:
        # A connection that broke is not reused
        if error.code == "TOOL_ERROR" and error.status is None and error.result is None:
            context.sessions.discard(key)
        raise
