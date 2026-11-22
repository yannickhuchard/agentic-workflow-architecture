"""
AWA Tools (specification section 17)

A tool is a function an actor may call while performing an activity. Each
tool declares a binding: the API, command or remote procedure that actually
runs. Every call goes through the ToolRunner, which checks the arguments,
applies the deployment's permissions, executes the binding and journals what
was called, when, with what, and the link to what ran.

Only the standard library and `jsonschema` are used.
"""

import json
import re
import subprocess
import threading
import time
import urllib.error
import urllib.request
from dataclasses import dataclass, field
from typing import Any, Callable
from urllib.parse import parse_qsl, quote, urlencode, urlsplit, urlunsplit
from uuid import uuid4

from awa.runtime.duration import parse_iso_duration
from awa.types import ToolBinding, ToolDefinition

DEFAULT_TIMEOUT_MS = 30_000
# Longest output of a command, or body of an HTTP response, that a call may return
DEFAULT_MAX_OUTPUT_BYTES = 4 * 1024 * 1024
# Longest result text given back to a model
MAX_CONTENT_CHARS = 60_000

BINDING_KINDS = ("http", "command", "jsonrpc", "grpc", "mcp", "function")


class ToolError(Exception):
    """A call that was refused or failed, with the error code that is journalled"""

    def __init__(self, message: str, code: str = "TOOL_ERROR", status: Any = None, result: Any = None):
        super().__init__(message)
        self.code = code
        self.status = status
        self.result = result


@dataclass
class ToolResult:
    """What a call gives back to the actor. A failed call is a result too, not an exception."""
    ok: bool
    # What the tool returned, or a description of the error
    result: Any
    # The result as text, in the form given back to a model
    content: str


@dataclass
class ToolExecution:
    result: Any
    # HTTP status, process exit code, or similar
    status: Any = None


@dataclass
class ToolCallContext:
    """What an executor is given besides the binding and the arguments"""
    call_id: str
    secrets: dict[str, str]
    # How long the call may take. The runner stops waiting after this; an executor
    # should bound its own input and output by it, so that nothing keeps running.
    timeout_ms: float
    allowed_hosts: list[str] | None = None
    max_output_bytes: int = DEFAULT_MAX_OUTPUT_BYTES

    def __post_init__(self) -> None:
        self._deadline = time.monotonic() + self.timeout_ms / 1000

    @property
    def remaining_seconds(self) -> float:
        return max(0.001, self._deadline - time.monotonic())


ToolHandler = Callable[[dict[str, Any]], Any]
ToolExecutor = Callable[[ToolBinding, dict[str, Any], ToolCallContext], Any]


@dataclass
class ToolOptions:
    """How the tools declared on activities are executed, and what they are allowed to do"""
    # Functions callable through bindings of kind "function", by name
    handlers: dict[str, ToolHandler] = field(default_factory=dict)
    # Executors for binding kinds the engine does not implement itself (mcp, grpc), or replacements for those it does
    executors: dict[str, ToolExecutor] = field(default_factory=dict)
    # Whether "command" bindings may run. False by default: a workflow document must not be able to run
    # programs on the host unless the deployment says so. A list allows only the named commands.
    allow_commands: bool | list[str] = False
    # If set, "http" and "jsonrpc" bindings may only reach these hosts ("host" or "host:port")
    allowed_hosts: list[str] | None = None
    # Values for {{secret:NAME}} placeholders in binding headers. Never journalled.
    secrets: dict[str, str] = field(default_factory=dict)
    # In simulation mode, what each tool returns, by tool name
    simulated_results: dict[str, Any] = field(default_factory=dict)
    max_output_bytes: int = DEFAULT_MAX_OUTPUT_BYTES

    @classmethod
    def of(cls, value: "ToolOptions | dict[str, Any] | None") -> "ToolOptions":
        if isinstance(value, ToolOptions):
            return value
        options = dict(value or {})
        unknown = set(options) - set(cls.__dataclass_fields__)
        if unknown:
            raise ValueError(f"Unknown tool option(s): {', '.join(sorted(unknown))}")
        return cls(**{key: item for key, item in options.items() if item is not None})


@dataclass
class ActorContext:
    """What the engine hands an actor for one attempt, besides the activity and the token"""
    tools: "ToolRunner | None" = None


# ----------------------------------------------------------------------
# What a binding runs for given arguments
# ----------------------------------------------------------------------

_PLACEHOLDER = re.compile(r"\{([A-Za-z_]\w*)\}")
_SECRET = re.compile(r"\{\{secret:([\w-]+)\}\}")


def _text(value: Any) -> str:
    """A value as it is written into a URL or a command line"""
    if value is None:
        return "null"
    if isinstance(value, bool):
        return "true" if value else "false"
    if isinstance(value, float) and value.is_integer():
        return str(int(value))
    if isinstance(value, (dict, list)):
        return json.dumps(value, separators=(",", ":"), ensure_ascii=False)
    return str(value)


def _fill(template: str, args: dict[str, Any], encode: Callable[[str], str], used: set[str]) -> str:
    def replace(match: "re.Match[str]") -> str:
        name = match.group(1)
        if name not in args:
            return match.group(0)
        used.add(name)
        return encode(_text(args[name]))
    return _PLACEHOLDER.sub(replace, template)


def _split_url(url: str) -> Any:
    parts = urlsplit(url)
    if parts.scheme not in ("http", "https") or not parts.hostname:
        raise ToolError(f'"{url.split("?")[0]}" is not an http or https URL', "VALIDATION_ERROR")
    return parts


def _host(url: str) -> str:
    """The host of a URL, with its port unless that is the scheme's default"""
    parts = _split_url(url)
    try:
        port = parts.port
    except ValueError:
        raise ToolError("The URL has an invalid port", "VALIDATION_ERROR") from None
    default = {"http": 80, "https": 443}[parts.scheme]
    host = f"[{parts.hostname}]" if ":" in parts.hostname else parts.hostname
    return host if port in (None, default) else f"{host}:{port}"


def _without_query(url: str) -> str:
    """Scheme, host and path of a URL: no credentials, query string or fragment"""
    parts = _split_url(url)
    return f"{parts.scheme}://{_host(url)}{parts.path or '/'}"


def http_request(binding: ToolBinding, args: dict[str, Any]) -> tuple[str, str, str | None]:
    """The request an "http" binding makes for given arguments: method, URL and body"""
    used: set[str] = set()
    url = _fill(binding.url or "", args, lambda v: quote(v, safe="-_.!~*'()"), used)
    parts = _split_url(url)
    rest = {key: value for key, value in args.items() if key not in used}
    method = (binding.method or "GET").upper()
    body: str | None = None
    if method in ("GET", "DELETE", "HEAD"):
        # Arguments not used in the URL are query parameters; one of the same name replaces what the URL had
        query = [(key, value) for key, value in parse_qsl(parts.query, keep_blank_values=True) if key not in rest]
        query += [(key, _text(value)) for key, value in rest.items()]
        url = urlunsplit((parts.scheme, parts.netloc, parts.path or "/", urlencode(query), ""))
    else:
        body = json.dumps(rest)
    return method, url, body


def command_line(binding: ToolBinding, args: dict[str, Any]) -> list[str]:
    """The argument list a "command" binding runs with for given arguments"""
    used: set[str] = set()
    # Each element is filled separately and passed as one argument: no shell, no splitting
    return [_fill(arg, args, lambda v: v, used) for arg in (binding.args or [])]


def tool_link(binding: ToolBinding, args: dict[str, Any]) -> str:
    """
    The link to what a call runs: a URL for an API, and a URI of the same kind
    for everything else, so that every call can be traced to its target.
    """
    if binding.kind == "http":
        # Query values are arguments, journalled separately under the payload mode
        return _without_query(http_request(binding, args)[1])
    if binding.kind == "command":
        return f"command:{binding.command}"
    if binding.kind == "jsonrpc":
        return f"{binding.endpoint}#{binding.method}"
    if binding.kind == "grpc":
        # A scheme such as "dns:///" is dropped; a bare "host:port" is kept whole
        return f"grpc://{re.sub(r'^[a-z][a-z0-9+.-]*:/+', '', binding.endpoint or '')}/{binding.service}/{binding.method}"
    if binding.kind == "mcp":
        return f"mcp://{binding.server}/{binding.tool}"
    return f"function:{binding.name}"


def describe_binding(binding: ToolBinding, args: dict[str, Any]) -> dict[str, Any]:
    """The binding as journalled: what will run, without headers or secrets"""
    if binding.kind == "http":
        method, url, _ = http_request(binding, args)
        return {"kind": "http", "method": method, "url": _without_query(url), "url_template": binding.url}
    if binding.kind == "command":
        return {"kind": "command", "command": binding.command, "args": command_line(binding, args)}
    if binding.kind == "jsonrpc":
        return {"kind": "jsonrpc", "endpoint": binding.endpoint, "method": binding.method}
    if binding.kind == "grpc":
        return {"kind": "grpc", "endpoint": binding.endpoint, "service": binding.service, "method": binding.method}
    if binding.kind == "mcp":
        return {"kind": "mcp", "server": binding.server, "tool": binding.tool}
    return {"kind": "function", "name": binding.name}


# ----------------------------------------------------------------------
# Built-in executors
# ----------------------------------------------------------------------

def _parse(text: str) -> Any:
    try:
        return json.loads(text)
    except ValueError:
        return text  # not JSON: keep the text


class _CheckedRedirects(urllib.request.HTTPRedirectHandler):
    """Follows redirects only to hosts the deployment allows, so a permitted host cannot hand the call on"""

    def __init__(self, allowed_hosts: list[str] | None):
        self.allowed_hosts = allowed_hosts

    def redirect_request(self, req: Any, fp: Any, code: int, msg: str, headers: Any, newurl: str) -> Any:
        host = _host(newurl)
        if self.allowed_hosts is not None and host not in self.allowed_hosts:
            raise ToolError(f'This deployment does not allow calls to host "{host}" (redirected)', "PERMISSION_DENIED")
        return super().redirect_request(req, fp, code, msg, headers, newurl)


def _send(method: str, url: str, headers: dict[str, str], body: str | None, context: ToolCallContext) -> tuple[int, str]:
    """One HTTP exchange: the status and the body as text. A status outside 2xx is returned, not raised."""
    request = urllib.request.Request(url, data=body.encode("utf-8") if body is not None else None, method=method, headers=headers)
    opener = urllib.request.build_opener(_CheckedRedirects(context.allowed_hosts))
    try:
        try:
            response = opener.open(request, timeout=context.remaining_seconds)
        except urllib.error.HTTPError as error:
            response = error
        with response:
            raw = response.read(context.max_output_bytes + 1)
            status = response.status if hasattr(response, "status") else response.code
    except ToolError:
        raise
    except TimeoutError:
        raise ToolError(f"No answer from {_host(url)} within {context.timeout_ms:g} ms", "TIMEOUT") from None
    except (urllib.error.URLError, OSError) as error:
        reason = getattr(error, "reason", error)
        if isinstance(reason, TimeoutError):
            raise ToolError(f"No answer from {_host(url)} within {context.timeout_ms:g} ms", "TIMEOUT") from None
        raise ToolError(f"Could not reach {_host(url)}: {reason}", "TOOL_ERROR") from None
    if len(raw) > context.max_output_bytes:
        raise ToolError(f"The response from {_host(url)} exceeds {context.max_output_bytes} bytes", "TOOL_ERROR", status)
    return status, raw.decode("utf-8", errors="replace")


def _run_http(binding: ToolBinding, args: dict[str, Any], context: ToolCallContext) -> ToolExecution:
    method, url, body = http_request(binding, args)
    headers = {"accept": "application/json", **({"content-type": "application/json"} if body else {})}

    def secret(match: "re.Match[str]") -> str:
        if match.group(1) not in context.secrets:
            raise ToolError(f'Secret "{match.group(1)}" is not configured', "VALIDATION_ERROR")
        return context.secrets[match.group(1)]

    for name, value in (binding.headers or {}).items():
        headers[name.lower()] = _SECRET.sub(secret, value)
    status, text = _send(method, url, headers, body, context)
    result = _parse(text)
    if not 200 <= status < 300:
        raise ToolError(f"HTTP {status} from {_host(url)}", "TOOL_ERROR", status, result)
    return ToolExecution(result, status)


def _run_jsonrpc(binding: ToolBinding, args: dict[str, Any], context: ToolCallContext) -> ToolExecution:
    endpoint = binding.endpoint or ""
    payload = json.dumps({"jsonrpc": "2.0", "id": context.call_id, "method": binding.method, "params": args})
    status, text = _send("POST", endpoint, {"content-type": "application/json"}, payload, context)
    if not 200 <= status < 300:
        raise ToolError(f"HTTP {status} from {_host(endpoint)}", "TOOL_ERROR", status)
    try:
        reply = json.loads(text)
    except ValueError:
        raise ToolError(f"{_host(endpoint)} did not answer with JSON", "TOOL_ERROR", status) from None
    error = reply.get("error") if isinstance(reply, dict) else None
    if error:
        code = error.get("code") if isinstance(error, dict) else None
        message = error.get("message") if isinstance(error, dict) else error
        raise ToolError(f"RPC error {code}: {message}", "TOOL_ERROR", code)
    return ToolExecution(reply.get("result") if isinstance(reply, dict) else None, status)


def _run_command(binding: ToolBinding, args: dict[str, Any], context: ToolCallContext) -> ToolExecution:
    command = binding.command or ""
    argv = [command, *command_line(binding, args)]
    # Arguments not placed on the command line are given as JSON on standard input
    stdin = "" if any(re.search(r"\{\w+\}", arg) for arg in (binding.args or [])) else json.dumps(args)
    try:
        # A list and no shell: each element is exactly one argument, whatever it contains
        process = subprocess.Popen(argv, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, shell=False)
    except OSError as error:
        raise ToolError(f'Command "{command}" failed: {error.strerror or error}', "TOOL_ERROR",
                        "ENOENT" if isinstance(error, FileNotFoundError) else "EACCES") from None

    limit = context.max_output_bytes
    captured = {"stdout": bytearray(), "stderr": bytearray()}
    overflow = threading.Event()

    def read(name: str, stream: Any) -> None:
        for chunk in iter(lambda: stream.read(65536), b""):
            if len(captured[name]) + len(chunk) > limit:
                overflow.set()
                process.kill()
                return
            captured[name] += chunk

    def write() -> None:
        try:
            process.stdin.write(stdin.encode("utf-8"))  # type: ignore[union-attr]
            process.stdin.close()  # type: ignore[union-attr]
        except OSError:
            pass  # a program may exit without reading its input: that is its business, not an error of the call

    workers = [threading.Thread(target=read, args=(name, getattr(process, name)), daemon=True) for name in captured]
    workers.append(threading.Thread(target=write, daemon=True))
    for worker in workers:
        worker.start()
    try:
        exit_code = process.wait(timeout=context.remaining_seconds)
    except subprocess.TimeoutExpired:
        process.kill()
        process.wait()
        raise ToolError(f'Command "{command}" did not finish within {context.timeout_ms:g} ms', "TIMEOUT") from None
    finally:
        for worker in workers:
            worker.join(timeout=1)
        for stream in (process.stdout, process.stderr):
            if stream:
                stream.close()

    if overflow.is_set():
        raise ToolError(f'Command "{command}" failed: its output exceeds {limit} bytes', "TOOL_ERROR")
    stdout = captured["stdout"].decode("utf-8", errors="replace")
    if exit_code != 0:
        detail = captured["stderr"].decode("utf-8", errors="replace").strip() or f"exit code {exit_code}"
        raise ToolError(f'Command "{command}" failed: {detail}', "TOOL_ERROR", exit_code)
    try:
        return ToolExecution(json.loads(stdout), 0)
    except ValueError:
        return ToolExecution(stdout.strip(), 0)


BUILT_IN_EXECUTORS: dict[str, ToolExecutor] = {"http": _run_http, "jsonrpc": _run_jsonrpc, "command": _run_command}


# ----------------------------------------------------------------------
# The runner
# ----------------------------------------------------------------------

ToolRecorder = Callable[[str, dict[str, Any]], Any]


class ToolRunner:
    """
    Runs the tools of one activity attempt and journals each call
    (specification 17.3). A failed or refused call does not raise: the failure
    is returned, so an agent can read it and try something else. It is
    journalled either way.

    `record(type, data)` writes a journal event; `payload(value)` applies the
    journal's payload mode to arguments and results.
    """

    def __init__(
        self,
        tools: list[ToolDefinition],
        options: ToolOptions | dict[str, Any] | None = None,
        record: ToolRecorder | None = None,
        payload: Callable[[Any], Any] | None = None,
        max_calls: int = 16,
        simulate: bool = False,
        now: Callable[[], float] | None = None,
    ):
        self._tools = list(tools)
        self._options = ToolOptions.of(options)
        recorder = record or (lambda type, data: None)
        # Absent values are left out of the record
        self._record = lambda type, data: recorder(type, {key: value for key, value in data.items() if value is not None})
        self._payload = payload or (lambda value: value)
        self._max_calls = max_calls
        self._simulate = simulate
        self._now = now or (lambda: time.time() * 1000)
        self._calls = 0
        self._validators: dict[str, Any] = {}

    @property
    def specs(self) -> list[dict[str, Any]]:
        """The tools in the form given to a model"""
        return [{
            "name": tool.name, "description": tool.description,
            "parameters": tool.parameters or {"type": "object", "properties": {}},
        } for tool in self._tools]

    @property
    def call_count(self) -> int:
        return self._calls

    def call(self, name: str, args: dict[str, Any] | None = None, call_id: str | None = None) -> ToolResult:
        args = dict(args or {})
        call_id = call_id or str(uuid4())
        started = self._now()
        tool = next((t for t in self._tools if t.name == name), None)
        link: str | None = None
        if tool:
            try:
                link = tool_link(tool.binding, args)
            except Exception:
                link = None  # the call is refused below, where the binding is described

        def failure(error: BaseException, invoked: bool) -> ToolResult:
            message = str(error) or type(error).__name__
            code = getattr(error, "code", None)
            code = code if isinstance(code, str) else "TOOL_ERROR"
            self._record("tool.failed", {
                "call_id": call_id, "tool": name, "link": link, "invoked": invoked,
                "error": {"message": message, "code": code},
                "status": getattr(error, "status", None), "duration_ms": int(self._now() - started),
            })
            result = {"error": message, "code": code}
            return ToolResult(False, result, json.dumps(result))

        # 1. Unknown tools and calls beyond the budget
        self._calls += 1
        if tool is None:
            available = ", ".join(t.name for t in self._tools) or "none"
            return failure(ToolError(f'Unknown tool "{name}". Available: {available}', "UNKNOWN_TOOL"), False)
        if self._calls > self._max_calls:
            return failure(ToolError(f"Tool call budget of {self._max_calls} exceeded", "TOOL_BUDGET_EXCEEDED"), False)

        # 2. to 3. Arguments, then permissions, are checked before anything runs
        try:
            self._check_arguments(tool, args)
            self._check_permission(tool.binding, args)
            binding = describe_binding(tool.binding, args)
            timeout_ms = parse_iso_duration(tool.timeout) if tool.timeout else DEFAULT_TIMEOUT_MS
        except ToolError as error:
            return failure(error, False)
        except ValueError as error:
            return failure(ToolError(str(error), "VALIDATION_ERROR"), False)

        # 4. Recorded before it runs
        self._record("tool.invoked", {
            "call_id": call_id, "tool": name, "link": link, "binding": binding,
            "documentation": tool.documentation,
            "arguments": self._payload(args),
            "simulated": True if self._simulate else None,
        })

        # 5. to 6. Run, bounded by the timeout, and record how it ended
        try:
            if self._simulate:
                # In simulation nothing is executed (17.5)
                scripted = self._options.simulated_results
                execution = ToolExecution(scripted[name] if name in scripted else {"_simulated": True}, "simulated")
            else:
                execution = self._execute(tool, args, call_id, timeout_ms)
        except Exception as error:
            return failure(error, True)

        self._record("tool.completed", {
            "call_id": call_id, "tool": name, "link": link, "status": execution.status,
            "duration_ms": int(self._now() - started), "result": self._payload(execution.result),
        })
        content = execution.result if isinstance(execution.result, str) else json.dumps(execution.result, default=str)
        if len(content) > MAX_CONTENT_CHARS:
            content = f"{content[:MAX_CONTENT_CHARS]}… (truncated)"
        return ToolResult(True, execution.result, content)

    def _check_arguments(self, tool: ToolDefinition, args: dict[str, Any]) -> None:
        if not tool.parameters:
            return
        if tool.name not in self._validators:
            try:
                from jsonschema import Draft202012Validator, FormatChecker
            except ImportError:
                # Fail closed: arguments that cannot be checked are not accepted
                raise ToolError(
                    f'Arguments for "{tool.name}" could not be checked: the \'jsonschema\' package is not installed',
                    "VALIDATION_ERROR") from None
            try:
                Draft202012Validator.check_schema(tool.parameters)
            except Exception as error:
                raise ToolError(f'The parameters of "{tool.name}" are not a valid JSON Schema: {getattr(error, "message", error)}',
                                "VALIDATION_ERROR") from None
            self._validators[tool.name] = Draft202012Validator(tool.parameters, format_checker=FormatChecker())
        problems = sorted(self._validators[tool.name].iter_errors(args), key=lambda e: [str(p) for p in e.absolute_path])
        if problems:
            detail = "; ".join(
                f"{'/' + '/'.join(str(p) for p in e.absolute_path) if e.absolute_path else 'arguments'} {e.message}"
                for e in problems)
            raise ToolError(f'Invalid arguments for "{tool.name}": {detail}', "VALIDATION_ERROR")

    def _check_permission(self, binding: ToolBinding, args: dict[str, Any]) -> None:
        if binding.kind == "command":
            allowed = self._options.allow_commands
            if not allowed or (allowed is not True and binding.command not in allowed):
                raise ToolError(f'This deployment does not allow the command "{binding.command}"', "PERMISSION_DENIED")
        if binding.kind in ("http", "jsonrpc") and self._options.allowed_hosts is not None:
            host = _host(http_request(binding, args)[1] if binding.kind == "http" else binding.endpoint or "")
            if host not in self._options.allowed_hosts:
                raise ToolError(f'This deployment does not allow calls to host "{host}"', "PERMISSION_DENIED")

    def _execute(self, tool: ToolDefinition, args: dict[str, Any], call_id: str, timeout_ms: float) -> ToolExecution:
        binding = tool.binding
        executor = self._options.executors.get(binding.kind) or BUILT_IN_EXECUTORS.get(binding.kind)
        if binding.kind == "function" and "function" not in self._options.executors:
            handler = self._options.handlers.get(binding.name or "")
            if handler is None:
                raise ToolError(f'No handler is registered for function "{binding.name}"', "VALIDATION_ERROR")
            executor = lambda _binding, handler_args, _context: ToolExecution(handler(handler_args))  # noqa: E731
        if executor is None:
            raise ToolError(
                f'No executor is registered for "{binding.kind}" tools. Register one with tools["executors"]["{binding.kind}"]',
                "VALIDATION_ERROR")

        context = ToolCallContext(call_id, dict(self._options.secrets), timeout_ms,
                                  self._options.allowed_hosts, self._options.max_output_bytes)
        outcome: dict[str, Any] = {}

        def run() -> None:
            try:
                outcome["value"] = executor(binding, dict(args), context)
            except BaseException as error:  # handed to the caller below
                outcome["error"] = error

        # Every kind of binding runs under the tool's timeout, registered handlers included.
        # Python cannot interrupt a function: after the timeout its result is ignored.
        worker = threading.Thread(target=run, daemon=True, name=f"awa-tool-{tool.name}")
        worker.start()
        worker.join(timeout_ms / 1000)
        if worker.is_alive():
            raise ToolError(f'Tool "{tool.name}" timed out after {timeout_ms:g} ms', "TIMEOUT")
        if "error" in outcome:
            raise outcome["error"]
        value = outcome.get("value")
        return value if isinstance(value, ToolExecution) else ToolExecution(value)
