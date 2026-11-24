"""
AWA Telemetry (specification section 26)

The journal and the journey record projected onto OpenTelemetry traces. Everything
here is a pure function of the record: the same events give the same trace and span
identifiers, names, times, attributes and links as the TypeScript reference, whether
the spans are sent while a run proceeds or exported from its journal afterwards.

Encoding follows OTLP (opentelemetry-proto 1.9.0), written by hand so that the SDK
needs no OpenTelemetry package. Attribute names follow the generative AI semantic
conventions as published in @opentelemetry/semantic-conventions 1.45.0.
"""

from __future__ import annotations

import calendar
import hashlib
import math
import re
import struct
from dataclasses import dataclass, field
from typing import Any, Callable, Iterable, Union

from awa.runtime.journal import JOURNAL_SPEC_VERSION, canonical_json

TELEMETRY_CONVENTIONS = {"otlp": "1.9.0", "semantic_conventions": "1.45.0"}

# Semantic convention names, as in @opentelemetry/semantic-conventions 1.45.0
GEN_AI = {
    "OPERATION_NAME": "gen_ai.operation.name",
    "PROVIDER_NAME": "gen_ai.provider.name",
    "REQUEST_MODEL": "gen_ai.request.model",
    "RESPONSE_MODEL": "gen_ai.response.model",
    "REQUEST_TEMPERATURE": "gen_ai.request.temperature",
    "USAGE_INPUT_TOKENS": "gen_ai.usage.input_tokens",
    "USAGE_OUTPUT_TOKENS": "gen_ai.usage.output_tokens",
    "TOOL_NAME": "gen_ai.tool.name",
    "TOOL_CALL_ID": "gen_ai.tool.call.id",
    "TOOL_CALL_ARGUMENTS": "gen_ai.tool.call.arguments",
    "TOOL_CALL_RESULT": "gen_ai.tool.call.result",
    "AGENT_NAME": "gen_ai.agent.name",
    "AGENT_ID": "gen_ai.agent.id",
    "WORKFLOW_NAME": "gen_ai.workflow.name",
    "ERROR_TYPE": "error.type",
    "SERVICE_NAME": "service.name",
}
GEN_AI_OPERATIONS = {"INVOKE_WORKFLOW": "invoke_workflow", "INVOKE_AGENT": "invoke_agent", "EXECUTE_TOOL": "execute_tool", "CHAT": "chat"}

# AWA provider ids (12.4) whose value in the conventions differs
_PROVIDER_NAMES = {"google": "gcp.gemini"}

TelemetryValue = Union[str, int, float, bool, list]
TelemetryAttributes = dict[str, Any]


@dataclass
class TelemetrySpanEvent:
    name: str
    time_ms: int
    attributes: TelemetryAttributes


@dataclass
class TelemetrySpan:
    """One span, ready to encode. Times are milliseconds since the Unix epoch (26.2)."""
    trace_id: str
    span_id: str
    name: str
    kind: str  # "internal" or "client"
    start_ms: int
    end_ms: int
    parent_span_id: str | None = None
    attributes: TelemetryAttributes = field(default_factory=dict)
    events: list[TelemetrySpanEvent] = field(default_factory=list)
    links: list[dict[str, Any]] = field(default_factory=list)
    status: dict[str, Any] = field(default_factory=lambda: {"code": "unset"})


# ---------------------------------------------------------------------------
# Identifiers (26.1)
# ---------------------------------------------------------------------------

def _digest(text: str, size: int) -> str:
    raw = bytearray(hashlib.sha256(text.encode("utf-8")).digest()[:size])
    if not any(raw):
        raw[-1] = 1
    return raw.hex()


def run_trace_id(run_id: str) -> str:
    return _digest(f"awa:run:{run_id}", 16)


def run_span_id(run_id: str, seq: int) -> str:
    return _digest(f"awa:run:{run_id}:{seq}", 8)


def journey_trace_id(instance_id: str) -> str:
    return _digest(f"awa:journey:{instance_id}", 16)


def journey_span_id(instance_id: str, seq: int) -> str:
    return _digest(f"awa:journey:{instance_id}:{seq}", 8)


_RFC3339 = re.compile(r"^(\d{4})-(\d{2})-(\d{2})[Tt ](\d{2}):(\d{2}):(\d{2})(?:\.(\d+))?([Zz]|[+-]\d{2}:\d{2})$")


def time_ms(text: str) -> int:
    """Milliseconds since the epoch of an RFC 3339 time; finer precision is discarded (26.2)"""
    match = _RFC3339.match(str(text))
    if not match:
        raise ValueError(f'Not an RFC 3339 time: "{text}"')
    year, month, day, hour, minute, second, fraction, zone = match.groups()
    seconds = calendar.timegm((int(year), int(month), int(day), int(hour), int(minute), int(second), 0, 0, 0))
    if zone not in ("Z", "z"):
        sign = 1 if zone[0] == "+" else -1
        seconds -= sign * (int(zone[1:3]) * 3600 + int(zone[4:6]) * 60)
    return seconds * 1000 + int((fraction or "0")[:3].ljust(3, "0"))


# ---------------------------------------------------------------------------
# Attribute values (26.3)
# ---------------------------------------------------------------------------

def attribute_value(value: Any) -> Any:
    """Strings, numbers and booleans as they are; anything else as canonical JSON. None for nothing."""
    if value is None:
        return None
    if isinstance(value, bool) or isinstance(value, str):
        return value
    if isinstance(value, int):
        return value
    if isinstance(value, float):
        if not math.isfinite(value):
            return str(value)
        return int(value) if value.is_integer() else value
    return canonical_json(value)


def _put(attributes: TelemetryAttributes, key: str, value: Any) -> None:
    v = attribute_value(value)
    if v is not None:
        attributes[key] = v


# Payload properties of span events (26.6)
_PAYLOAD_PROPERTIES = {"input", "inputs", "output", "arguments", "result", "rejected_output", "data", "correlation_value", "subject_key"}


def _data_attributes(attributes: TelemetryAttributes, data: dict[str, Any] | None, payloads: bool) -> None:
    for key, value in (data or {}).items():
        if not payloads and key in _PAYLOAD_PROPERTIES:
            continue
        _put(attributes, f"awa.data.{key}", value)


def _record(value: Any) -> dict[str, Any]:
    return value if isinstance(value, dict) else {}


def _error_of(data: dict[str, Any]) -> dict[str, Any]:
    error = data.get("error")
    if isinstance(error, str):
        return {"message": error}
    e = _record(error)
    return {"message": e.get("message") if isinstance(e.get("message"), str) else None,
            "code": e.get("code") if isinstance(e.get("code"), str) else None}


def _error_status(message: Any) -> dict[str, Any]:
    return {"code": "error", **({"message": message} if message is not None else {})}


# ---------------------------------------------------------------------------
# A run's trace (26.2 to 26.6)
# ---------------------------------------------------------------------------

@dataclass
class _Open:
    kind: str
    span: TelemetrySpan
    token: str | None = None
    node: str | None = None
    attempt: int | None = None
    call_id: str | None = None
    wait: str | None = None
    models: list[TelemetrySpan] = field(default_factory=list)


_WAIT_END = {
    "token.resumed": ("human", "resumed", "ok"),
    "event.received": ("event", "received", "ok"),
    "event.timed_out": ("event", "timed_out", "unset"),
    "timer.fired": ("timer", "fired", "ok"),
}
_WAIT_START = {"token.waiting": "human", "event.waiting": "event", "timer.started": "timer"}


def _decision_ids(workflow: Any) -> set[str]:
    """The ids of the decision nodes of a workflow given as a model, a document, or a list of ids"""
    if workflow is None:
        return set()
    if isinstance(workflow, (set, list, tuple)):
        return {str(i) for i in workflow}
    nodes = workflow.get("decision_nodes") if isinstance(workflow, dict) else getattr(workflow, "decision_nodes", None)
    return {str(n["id"] if isinstance(n, dict) else n.id) for n in (nodes or [])}


class RunTraceMapper:
    """
    Turns the events of one run's journal into spans, one event at a time. push() returns
    the spans the event ends; finish() ends what is still open, as an export of an
    unfinished record does (26.8). Live and recorded export use the same mapper.
    """

    def __init__(self, workflow: Any = None, payloads: bool = False) -> None:
        self._open: list[_Open] = []
        self._run: _Open | None = None
        self._run_id: str | None = None
        self._trace_id: str | None = None
        self._last_ms: int | None = None
        self._decision_nodes = _decision_ids(workflow)
        self._payloads = payloads is True
        self._ended = False

    def push(self, event: dict[str, Any]) -> list[TelemetrySpan]:
        out: list[TelemetrySpan] = []
        if self._run_id is None:
            self._run_id = event["run_id"]
            self._trace_id = run_trace_id(event["run_id"])
        at = time_ms(event["time"])
        self._last_ms = at
        data = _record(event.get("data"))
        type_ = event["type"]
        token, node, attempt = event.get("token_id"), event.get("node_id"), event.get("attempt")

        if type_ == "run.started":
            if not self._run and not self._ended:
                name = data["workflow_name"] if isinstance(data.get("workflow_name"), str) else event["workflow_id"]
                self._run = self._start("run", event, f"{GEN_AI_OPERATIONS['INVOKE_WORKFLOW']} {name}", "internal", None)
                a = self._run.span.attributes
                a[GEN_AI["OPERATION_NAME"]] = GEN_AI_OPERATIONS["INVOKE_WORKFLOW"]
                _put(a, GEN_AI["WORKFLOW_NAME"], data.get("workflow_name"))
                _put(a, "awa.workflow.id", event.get("workflow_id"))
                _put(a, "awa.workflow.version", data.get("workflow_version"))
                _put(a, "awa.run.simulated", data.get("simulate"))
                if self._payloads:
                    _put(a, "awa.run.input", data.get("input"))
                # A child run's span names its parent run and links to the attempt span that started it (24.7, 26.2)
                parent = _record(data.get("parent"))
                if isinstance(parent.get("run_id"), str):
                    _put(a, "awa.run.parent_run_id", parent["run_id"])
                    _put(a, "awa.run.depth", data.get("depth"))
                    if isinstance(parent.get("seq"), int) and not isinstance(parent.get("seq"), bool):
                        self._run.span.links.append({"trace_id": run_trace_id(parent["run_id"]), "span_id": run_span_id(parent["run_id"], parent["seq"])})
                return out
        elif type_ in ("run.completed", "run.failed", "run.cancelled"):
            if self._run:
                while self._open:
                    self._finish_span(self._open[-1], at, {"code": "unset"}, {}, out)
                status = type_[4:]
                a = self._run.span.attributes
                _put(a, "awa.run.status", status)
                for key in ("steps", "input_tokens", "output_tokens", "cost", "currency"):
                    _put(a, f"awa.run.{key}", data.get(key))
                if type_ == "run.cancelled":
                    _put(a, "awa.run.cancel_reason", data.get("reason"))
                errors = data.get("errors")
                first = _record(errors[0]) if isinstance(errors, list) and errors else {}
                if type_ == "run.completed":
                    result = {"code": "ok"}
                elif type_ == "run.failed":
                    result = {"code": "error", "message": first["message"] if isinstance(first.get("message"), str) else "run failed"}
                else:
                    result = {"code": "unset"}
                self._end(self._run, at, result, out)
                self._run = None
                self._ended = True
                return out
        elif type_ == "activity.started":
            if self._run:
                ai = data.get("actor_type") == "ai_agent"
                name = f"{GEN_AI_OPERATIONS['INVOKE_AGENT'] if ai else 'activity'} {event.get('node_name') or node}"
                span = self._start("attempt", event, name, "internal", self._run.span.span_id)
                a = span.span.attributes
                _put(a, "awa.actor.type", data.get("actor_type"))
                _put(a, "awa.role.id", data.get("role_id"))
                if ai:
                    a[GEN_AI["OPERATION_NAME"]] = GEN_AI_OPERATIONS["INVOKE_AGENT"]
                    _put(a, GEN_AI["AGENT_NAME"], event.get("node_name"))
                    _put(a, GEN_AI["AGENT_ID"], node)
                if self._payloads:
                    _put(a, "awa.input", data.get("input"))
                self._open.append(span)
                return out
        elif type_ in ("activity.completed", "activity.failed"):
            span = self._find(lambda s: s.kind == "attempt" and s.token == token and s.node == node
                              and (attempt is None or s.attempt == attempt))
            if span:
                extra: TelemetryAttributes = {}
                if type_ == "activity.completed":
                    if self._payloads:
                        _put(extra, "awa.output", data.get("output"))
                    self._finish_span(span, at, {"code": "ok"}, extra, out, _record(data.get("usage")))
                else:
                    error = _error_of(data)
                    extra[GEN_AI["ERROR_TYPE"]] = error.get("code") or "_OTHER"
                    _put(extra, "awa.error.retryable", data.get("retryable"))
                    self._finish_span(span, at, _error_status(error.get("message")), extra, out)
                return out
        elif type_ == "tool.invoked":
            if self._run:
                self._open.append(self._tool_span(event, data))
                return out
        elif type_ in ("tool.completed", "tool.failed"):
            span = self._find(lambda s: s.kind == "tool" and s.call_id == data.get("call_id"))
            if span is None and type_ == "tool.failed" and self._run:
                span = self._tool_span(event, data)  # refused before it ran: a span of no duration
                self._open.append(span)
            if span:
                extra = {}
                _put(extra, "awa.tool.status", data.get("status"))
                if type_ == "tool.completed":
                    if self._payloads:
                        _put(extra, GEN_AI["TOOL_CALL_RESULT"], data.get("result"))
                    self._finish_span(span, at, {"code": "ok"}, extra, out)
                else:
                    error = _error_of(data)
                    _put(extra, "awa.tool.invoked", data.get("invoked"))
                    extra[GEN_AI["ERROR_TYPE"]] = error.get("code") or "_OTHER"
                    self._finish_span(span, at, _error_status(error.get("message")), extra, out)
                return out
        elif type_ == "meta.recorded":
            model = _record(data.get("model"))
            if data.get("subject") == "model_selection" and isinstance(model.get("id"), str):
                parent = self._find(lambda s: (s.kind == "attempt" and s.token == token and s.node == node
                                               and (attempt is None or s.attempt == attempt))
                                    or (s.kind == "decision" and s.token == token and s.node == node))
                if parent:
                    span = self._base_span(event, f"{GEN_AI_OPERATIONS['CHAT']} {model['id']}", "client", parent.span.span_id)
                    span.start_ms = parent.span.start_ms
                    span.end_ms = at
                    span.status = {"code": "ok"}
                    a = span.attributes
                    a[GEN_AI["OPERATION_NAME"]] = GEN_AI_OPERATIONS["CHAT"]
                    if isinstance(model.get("provider"), str):
                        a[GEN_AI["PROVIDER_NAME"]] = _PROVIDER_NAMES.get(model["provider"], model["provider"])
                    a[GEN_AI["REQUEST_MODEL"]] = model["id"]
                    a[GEN_AI["RESPONSE_MODEL"]] = model["id"]
                    temperature = model.get("temperature")
                    if isinstance(temperature, (int, float)) and not isinstance(temperature, bool):
                        _put(a, GEN_AI["REQUEST_TEMPERATURE"], temperature)
                    for key in ("provider", "requested", "tier", "source"):
                        _put(a, f"awa.model.{key}", model.get(key))
                    parent.models.append(span)
                    return out
        elif type_ == "decision.evaluated":
            span = self._find(lambda s: s.kind == "decision" and s.token == token and s.node == node)
            if span:
                extra = {}
                for key in ("method", "strategy", "hit_policy", "edge_id", "used_default"):
                    _put(extra, f"awa.decision.{key}", data.get(key))
                if isinstance(data.get("matched_rules"), list):
                    extra["awa.decision.matched_rules"] = [
                        _record(r).get("index") for r in data["matched_rules"]
                        if isinstance(_record(r).get("index"), (int, float)) and not isinstance(_record(r).get("index"), bool)]
                _put(extra, "awa.decision.outputs", data.get("outputs"))
                model = _record(data.get("model"))
                _put(extra, "awa.decision.option", model.get("option"))
                _put(extra, "awa.decision.confidence", model.get("confidence"))
                if self._payloads:
                    _put(extra, "awa.decision.inputs", data.get("inputs"))
                none = data.get("method") == "none"
                status = ({"code": "error", "message": data["conflict"] if isinstance(data.get("conflict"), str) else "no decision"}
                          if none else {"code": "ok"})
                self._finish_span(span, at, status, extra, out, _record(model.get("usage")))
                return out
        elif type_ in _WAIT_START:
            if self._run:
                parent = self._find(lambda s: s.kind == "attempt" and s.token == token and s.node == node) or self._run
                span = self._start("wait", event, f"wait {event.get('node_name') or node}", "internal", parent.span.span_id)
                span.wait = _WAIT_START[type_]
                a = span.span.attributes
                a["awa.wait.kind"] = span.wait
                if type_ == "token.waiting":
                    _put(a, "awa.wait.reason", data.get("reason"))
                    _put(a, "awa.human_task.id", data.get("human_task_id"))
                elif type_ == "event.waiting":
                    _put(a, "awa.business_event.name", data.get("name"))
                    _put(a, "awa.business_event.correlation_key", data.get("correlation_key"))
                    if self._payloads:
                        _put(a, "awa.business_event.correlation_value", data.get("correlation_value"))
                    _put(a, "awa.business_event.due_at", data.get("due_at"))
                else:
                    _put(a, "awa.timer.duration", data.get("duration"))
                    _put(a, "awa.timer.due_at", data.get("due_at"))
                self._open.append(span)
                return out
        elif type_ in _WAIT_END:
            kind, outcome, code = _WAIT_END[type_]
            span = self._find(lambda s: s.kind == "wait" and s.wait == kind and s.token == token)
            if span:
                extra = {"awa.wait.outcome": outcome}
                if type_ == "token.resumed":
                    _put(extra, "awa.wait.waited_ms", data.get("waited_ms"))
                if type_ == "event.received":
                    _put(extra, "awa.business_event.id", data.get("event_id"))
                    _put(extra, "awa.business_event.source", data.get("source"))
                    if self._payloads:
                        _put(extra, "awa.business_event.data", data.get("data"))
                self._finish_span(span, at, {"code": code}, extra, out)
                return out
        elif type_ in ("token.created", "token.moved", "token.joined"):
            self._span_event(event, data)
            if self._run and token and node and node in self._decision_nodes:
                name = f"decision {event.get('node_name') or node}"
                self._open.append(self._start("decision", event, name, "internal", self._run.span.span_id))
            return out
        elif type_ in ("token.failed", "token.cancelled"):
            self._span_event(event, data)
            error = _error_of(data)
            status = _error_status(error.get("message")) if type_ == "token.failed" else {"code": "unset"}
            for open_span in reversed(list(self._open)):
                if open_span.token == token and open_span in self._open:
                    self._finish_span(open_span, at, status, {}, out)
            return out

        self._span_event(event, data)
        return out

    def finish(self) -> list[TelemetrySpan]:
        """End every span still open at the time of the last event (26.8)"""
        out: list[TelemetrySpan] = []
        if self._last_ms is None:
            return out
        while self._open:
            self._finish_span(self._open[-1], self._last_ms, {"code": "unset"}, {"awa.incomplete": True}, out)
        if self._run:
            self._run.span.attributes["awa.incomplete"] = True
            self._end(self._run, self._last_ms, {"code": "unset"}, out)
            self._run = None
        return out

    def _base_span(self, event: dict[str, Any], name: str, kind: str, parent: str | None) -> TelemetrySpan:
        at = time_ms(event["time"])
        attributes: TelemetryAttributes = {"awa.run.id": event["run_id"]}
        _put(attributes, "awa.node.id", event.get("node_id"))
        _put(attributes, "awa.node.name", event.get("node_name"))
        _put(attributes, "awa.token.id", event.get("token_id"))
        _put(attributes, "awa.attempt", event.get("attempt"))
        return TelemetrySpan(trace_id=self._trace_id or run_trace_id(event["run_id"]), span_id=run_span_id(event["run_id"], event["seq"]),
                             parent_span_id=parent, name=name, kind=kind, start_ms=at, end_ms=at, attributes=attributes)

    def _start(self, kind: str, event: dict[str, Any], name: str, span_kind: str, parent: str | None) -> _Open:
        return _Open(kind=kind, span=self._base_span(event, name, span_kind, parent),
                     token=event.get("token_id"), node=event.get("node_id"), attempt=event.get("attempt"))

    def _tool_span(self, event: dict[str, Any], data: dict[str, Any]) -> _Open:
        token, node, attempt = event.get("token_id"), event.get("node_id"), event.get("attempt")
        parent = self._find(lambda s: s.kind == "attempt" and s.token == token and s.node == node
                            and (attempt is None or s.attempt == attempt)) or self._run
        assert parent is not None
        span = self._start("tool", event, f"{GEN_AI_OPERATIONS['EXECUTE_TOOL']} {data.get('tool')}", "internal", parent.span.span_id)
        span.call_id = data.get("call_id") if isinstance(data.get("call_id"), str) else None
        a = span.span.attributes
        a[GEN_AI["OPERATION_NAME"]] = GEN_AI_OPERATIONS["EXECUTE_TOOL"]
        _put(a, GEN_AI["TOOL_NAME"], data.get("tool"))
        _put(a, GEN_AI["TOOL_CALL_ID"], data.get("call_id"))
        _put(a, "awa.tool.link", data.get("link"))
        _put(a, "awa.tool.binding", _record(data.get("binding")).get("kind"))
        if event["type"] == "tool.invoked":
            a["awa.tool.invoked"] = True
            if self._payloads:
                _put(a, GEN_AI["TOOL_CALL_ARGUMENTS"], data.get("arguments"))
        return span

    def _find(self, match: Callable[[_Open], bool]) -> _Open | None:
        for span in reversed(self._open):
            if match(span):
                return span
        return None

    def _span_event(self, event: dict[str, Any], data: dict[str, Any]) -> None:
        if not self._run:
            return
        token, node, attempt = event.get("token_id"), event.get("node_id"), event.get("attempt")
        holder = (self._find(lambda s: s.kind != "tool" and s.token == token and s.node == node
                             and (attempt is None or s.attempt is None or s.attempt == attempt))
                  if token is not None else None) or self._run
        attributes: TelemetryAttributes = {"awa.journal.seq": event["seq"], "awa.journal.level": event.get("level")}
        _put(attributes, "awa.token.id", token)
        _put(attributes, "awa.node.id", node)
        _put(attributes, "awa.node.name", event.get("node_name"))
        _put(attributes, "awa.attempt", attempt)
        _data_attributes(attributes, data, self._payloads)
        holder.span.events.append(TelemetrySpanEvent(name=event["type"], time_ms=time_ms(event["time"]), attributes=attributes))

    def _finish_span(self, span: _Open, at: int, status: dict[str, Any], extra: TelemetryAttributes,
                     out: list[TelemetrySpan], usage: dict[str, Any] | None = None) -> None:
        self._open.remove(span)
        span.span.attributes.update(extra)
        if span.models and usage is not None:
            last = span.models[-1]
            _put(last.attributes, GEN_AI["USAGE_INPUT_TOKENS"], usage.get("input_tokens"))
            _put(last.attributes, GEN_AI["USAGE_OUTPUT_TOKENS"], usage.get("output_tokens"))
        out.extend(span.models)
        self._end(span, at, status, out)

    @staticmethod
    def _end(span: _Open, at: int, status: dict[str, Any], out: list[TelemetrySpan]) -> None:
        span.span.end_ms = at
        span.span.status = status
        out.append(span.span)


def run_spans(workflow: Any, events: Iterable[dict[str, Any]], payloads: bool = False) -> list[TelemetrySpan]:
    """Every span of one run's journal, in the order a live exporter sends them, then those still open (26.8)"""
    mapper = RunTraceMapper(workflow, payloads)
    spans: list[TelemetrySpan] = []
    for event in sorted(events, key=lambda e: e["seq"]):
        spans.extend(mapper.push(event))
    spans.extend(mapper.finish())
    return spans


# ---------------------------------------------------------------------------
# A journey's trace (26.7)
# ---------------------------------------------------------------------------

@dataclass
class _OpenJourney:
    kind: str
    span: TelemetrySpan
    stage_id: str | None = None
    run_id: str | None = None


class JourneyTraceMapper:
    """Turns the record of one journey instance into spans, one journey event at a time"""

    def __init__(self, payloads: bool = False) -> None:
        self._journey: _OpenJourney | None = None
        self._open: list[_OpenJourney] = []
        self._last_ms: int | None = None
        self._ended = False
        self._payloads = payloads is True

    def push(self, event: dict[str, Any]) -> list[TelemetrySpan]:
        out: list[TelemetrySpan] = []
        at = time_ms(event["time"])
        self._last_ms = at
        data = _record(event.get("data"))
        type_ = event["type"]
        stage_id, run_id = event.get("stage_id"), event.get("run_id")

        if type_ == "journey.started":
            if not self._journey and not self._ended:
                name = data["journey_name"] if isinstance(data.get("journey_name"), str) else event["journey_id"]
                span = self._start("journey", event, f"journey {name}", None)
                a = span.span.attributes
                _put(a, "awa.journey.id", event.get("journey_id"))
                _put(a, "awa.journey.name", data.get("journey_name"))
                _put(a, "awa.journey.subject", data.get("subject"))
                if self._payloads:
                    _put(a, "awa.journey.subject_key", data.get("subject_key"))
                self._journey = span
                return out
        elif type_ in ("journey.completed", "journey.abandoned"):
            if self._journey:
                while self._open:
                    last = self._open[-1]
                    self._close(last, at, {"code": "unset"}, {"awa.journey.stage.outcome": "left"} if last.kind == "stage" else {}, out)
                status = type_[8:]
                a = self._journey.span.attributes
                a["awa.journey.status"] = status
                _put(a, "awa.journey.reason", data.get("reason"))
                self._journey.span.end_ms = at
                self._journey.span.status = {"code": "ok" if status == "completed" else "unset"}
                out.append(self._journey.span)
                self._journey = None
                self._ended = True
                return out
        elif type_ == "journey.stage_entered":
            if self._journey:
                for stage in reversed([s for s in self._open if s.kind == "stage"]):
                    self._close(stage, at, {"code": "unset"}, {"awa.journey.stage.outcome": "left"}, out)
                name = data["stage_name"] if isinstance(data.get("stage_name"), str) else stage_id
                span = self._start("stage", event, f"stage {name}", self._journey.span.span_id)
                span.stage_id = stage_id
                _put(span.span.attributes, "awa.journey.stage.id", stage_id)
                _put(span.span.attributes, "awa.journey.stage.name", data.get("stage_name"))
                self._open.append(span)
                return out
        elif type_ == "journey.stage_completed":
            stage = self._find(lambda s: s.kind == "stage" and s.stage_id == stage_id)
            if stage:
                self._close(stage, at, {"code": "ok"}, {"awa.journey.stage.outcome": "completed"}, out)
                return out
        elif type_ == "journey.run_started":
            if self._journey and run_id:
                parent = self._find(lambda s: s.kind == "stage" and s.stage_id == stage_id) or self._journey
                name = data["workflow_name"] if isinstance(data.get("workflow_name"), str) else data.get("workflow_id")
                span = self._start("run", event, f"run {name}", parent.span.span_id)
                span.run_id = run_id
                a = span.span.attributes
                a["awa.run.id"] = run_id
                _put(a, "awa.workflow.id", data.get("workflow_id"))
                _put(a, "awa.workflow.name", data.get("workflow_name"))
                _put(a, "awa.journey.stage.id", stage_id)
                _put(a, "awa.business_event.id", data.get("caused_by_event"))
                span.span.links.append({"trace_id": run_trace_id(run_id), "span_id": run_span_id(run_id, 1)})
                self._open.append(span)
                return out
        elif type_ == "journey.run_ended":
            run = self._find(lambda s: s.kind == "run" and s.run_id == run_id)
            if run:
                status = data.get("status")
                if status == "completed":
                    result = {"code": "ok"}
                elif status == "failed":
                    result = {"code": "error", "message": data["error"] if isinstance(data.get("error"), str) else "run failed"}
                else:
                    result = {"code": "unset"}
                extra = {}
                _put(extra, "awa.run.status", status)
                self._close(run, at, result, extra, out)
                return out

        self._span_event(event, data)
        return out

    def finish(self) -> list[TelemetrySpan]:
        out: list[TelemetrySpan] = []
        if self._last_ms is None:
            return out
        while self._open:
            self._close(self._open[-1], self._last_ms, {"code": "unset"}, {"awa.incomplete": True}, out)
        if self._journey:
            self._journey.span.attributes["awa.incomplete"] = True
            self._journey.span.end_ms = self._last_ms
            self._journey.span.status = {"code": "unset"}
            out.append(self._journey.span)
            self._journey = None
        return out

    def _start(self, kind: str, event: dict[str, Any], name: str, parent: str | None) -> _OpenJourney:
        at = time_ms(event["time"])
        instance = event["journey_instance_id"]
        return _OpenJourney(kind=kind, span=TelemetrySpan(
            trace_id=journey_trace_id(instance), span_id=journey_span_id(instance, event["seq"]), parent_span_id=parent,
            name=name, kind="internal", start_ms=at, end_ms=at, attributes={"awa.journey.instance_id": instance}))

    def _find(self, match: Callable[[_OpenJourney], bool]) -> _OpenJourney | None:
        for span in reversed(self._open):
            if match(span):
                return span
        return None

    def _close(self, span: _OpenJourney, at: int, status: dict[str, Any], extra: TelemetryAttributes, out: list[TelemetrySpan]) -> None:
        self._open.remove(span)
        span.span.attributes.update(extra)
        span.span.end_ms = at
        span.span.status = status
        out.append(span.span)

    def _span_event(self, event: dict[str, Any], data: dict[str, Any]) -> None:
        if not self._journey:
            return
        run_id, stage_id = event.get("run_id"), event.get("stage_id")
        holder = ((self._find(lambda s: s.kind == "run" and s.run_id == run_id) if run_id else None)
                  or (self._find(lambda s: s.kind == "stage" and s.stage_id == stage_id) if stage_id else None)
                  or self._journey)
        attributes: TelemetryAttributes = {"awa.journey.seq": event["seq"]}
        _put(attributes, "awa.journey.stage.id", stage_id)
        _put(attributes, "awa.run.id", run_id)
        _data_attributes(attributes, data, self._payloads)
        holder.span.events.append(TelemetrySpanEvent(name=event["type"], time_ms=time_ms(event["time"]), attributes=attributes))


def journey_spans(events: Iterable[dict[str, Any]], payloads: bool = False) -> list[TelemetrySpan]:
    """Every span of one journey instance's record"""
    mapper = JourneyTraceMapper(payloads)
    spans: list[TelemetrySpan] = []
    for event in sorted(events, key=lambda e: e["seq"]):
        spans.extend(mapper.push(event))
    spans.extend(mapper.finish())
    return spans


# ---------------------------------------------------------------------------
# OTLP encoding (26.9)
# ---------------------------------------------------------------------------

TELEMETRY_SCOPE = {"name": "awa", "version": JOURNAL_SPEC_VERSION}
_KIND_CODE = {"internal": 1, "client": 3}
_STATUS_CODE = {"unset": 0, "ok": 1, "error": 2}


def telemetry_resource(attributes: dict[str, Any] | None = None, service_name: str | None = None) -> TelemetryAttributes:
    """The resource: service.name `awa` unless another is given, then whatever the deployment adds"""
    attributes = dict(attributes or {})
    given = attributes.pop("service.name", None)
    return {"service.name": service_name or (given if isinstance(given, str) else "awa"), **attributes}


def _is_int(value: Any) -> bool:
    return isinstance(value, int) or (isinstance(value, float) and math.isfinite(value) and value.is_integer())


def _any_value(value: Any) -> dict[str, Any]:
    if isinstance(value, list):
        return {"arrayValue": {"values": [_any_value(v) for v in value]}}
    if isinstance(value, bool):
        return {"boolValue": value}
    if isinstance(value, str):
        return {"stringValue": value}
    if _is_int(value):
        return {"intValue": str(int(value))}
    return {"doubleValue": value}


def otlp_attributes(attributes: TelemetryAttributes) -> list[dict[str, Any]]:
    return [{"key": key, "value": _any_value(value)} for key, value in attributes.items()]


def _nanos(ms: int) -> str:
    return str(int(ms) * 1_000_000)


def spans_to_otlp_json(spans: list[TelemetrySpan], resource: TelemetryAttributes | None = None) -> dict[str, Any]:
    """An ExportTraceServiceRequest in OTLP/JSON"""
    def one(span: TelemetrySpan) -> dict[str, Any]:
        out: dict[str, Any] = {"traceId": span.trace_id, "spanId": span.span_id}
        if span.parent_span_id:
            out["parentSpanId"] = span.parent_span_id
        out.update({
            "name": span.name,
            "kind": _KIND_CODE[span.kind],
            "startTimeUnixNano": _nanos(span.start_ms),
            "endTimeUnixNano": _nanos(span.end_ms),
            "attributes": otlp_attributes(span.attributes),
            "events": [{"timeUnixNano": _nanos(e.time_ms), "name": e.name, "attributes": otlp_attributes(e.attributes)} for e in span.events],
            "links": [{"traceId": l["trace_id"], "spanId": l["span_id"], "attributes": otlp_attributes(l.get("attributes") or {})} for l in span.links],
            "status": {"code": _STATUS_CODE[span.status["code"]], **({"message": span.status["message"]} if span.status.get("message") is not None else {})},
        })
        return out

    return {"resourceSpans": [{
        "resource": {"attributes": otlp_attributes(resource if resource is not None else telemetry_resource())},
        "scopeSpans": [{"scope": dict(TELEMETRY_SCOPE), "spans": [one(s) for s in spans]}],
    }]}


class _ProtoWriter:
    """A minimal protobuf writer: just what the OTLP messages need"""

    def __init__(self) -> None:
        self._parts: list[bytes] = []

    @staticmethod
    def _varint(value: int) -> bytes:
        value &= (1 << 64) - 1
        out = bytearray()
        while value >= 0x80:
            out.append((value & 0x7F) | 0x80)
            value >>= 7
        out.append(value)
        return bytes(out)

    def _tag(self, number: int, wire: int) -> None:
        self._parts.append(self._varint((number << 3) | wire))

    def uint(self, number: int, value: int) -> "_ProtoWriter":
        if value:
            self._tag(number, 0)
            self._parts.append(self._varint(value))
        return self

    def boolean(self, number: int, value: bool) -> "_ProtoWriter":
        self._tag(number, 0)
        self._parts.append(b"\x01" if value else b"\x00")
        return self

    def int64(self, number: int, value: int) -> "_ProtoWriter":
        self._tag(number, 0)
        self._parts.append(self._varint(value))
        return self

    def fixed64(self, number: int, value: int) -> "_ProtoWriter":
        self._tag(number, 1)
        self._parts.append(struct.pack("<Q", value & ((1 << 64) - 1)))
        return self

    def double(self, number: int, value: float) -> "_ProtoWriter":
        self._tag(number, 1)
        self._parts.append(struct.pack("<d", value))
        return self

    def raw(self, number: int, value: bytes) -> "_ProtoWriter":
        self._tag(number, 2)
        self._parts.append(self._varint(len(value)))
        self._parts.append(value)
        return self

    def string(self, number: int, value: str) -> "_ProtoWriter":
        return self.raw(number, value.encode("utf-8"))

    def text(self, number: int, value: str | None) -> "_ProtoWriter":
        return self.string(number, value) if value else self

    def message(self, number: int, write: Callable[["_ProtoWriter"], None]) -> "_ProtoWriter":
        inner = _ProtoWriter()
        write(inner)
        return self.raw(number, inner.finish())

    def finish(self) -> bytes:
        return b"".join(self._parts)


def _write_any(w: _ProtoWriter, value: Any) -> None:
    if isinstance(value, list):
        w.message(5, lambda a: [a.message(1, lambda x, v=v: _write_any(x, v)) for v in value] and None)
    elif isinstance(value, bool):
        w.boolean(2, value)
    elif isinstance(value, str):
        w.string(1, value)
    elif _is_int(value):
        w.int64(3, int(value))
    else:
        w.double(4, float(value))


def _write_attributes(w: _ProtoWriter, number: int, attributes: TelemetryAttributes) -> None:
    for key, value in attributes.items():
        w.message(number, lambda kv, k=key, v=value: (kv.string(1, k), kv.message(2, lambda x: _write_any(x, v))) and None)


def _scope(w: _ProtoWriter) -> None:
    w.string(1, TELEMETRY_SCOPE["name"])
    w.string(2, TELEMETRY_SCOPE["version"])


def spans_to_otlp_protobuf(spans: list[TelemetrySpan], resource: TelemetryAttributes | None = None) -> bytes:
    """An ExportTraceServiceRequest in OTLP protobuf"""
    resource = resource if resource is not None else telemetry_resource()

    def span_message(s: _ProtoWriter, span: TelemetrySpan) -> None:
        s.raw(1, bytes.fromhex(span.trace_id))
        s.raw(2, bytes.fromhex(span.span_id))
        if span.parent_span_id:
            s.raw(4, bytes.fromhex(span.parent_span_id))
        s.string(5, span.name)
        s.uint(6, _KIND_CODE[span.kind])
        s.fixed64(7, span.start_ms * 1_000_000)
        s.fixed64(8, span.end_ms * 1_000_000)
        _write_attributes(s, 9, span.attributes)
        for e in span.events:
            s.message(11, lambda ev, e=e: (ev.fixed64(1, e.time_ms * 1_000_000), ev.string(2, e.name), _write_attributes(ev, 3, e.attributes)) and None)
        for link in span.links:
            s.message(13, lambda lw, l=link: (lw.raw(1, bytes.fromhex(l["trace_id"])), lw.raw(2, bytes.fromhex(l["span_id"])),
                                              _write_attributes(lw, 4, l.get("attributes") or {})) and None)
        s.message(15, lambda st: (st.text(2, span.status.get("message")), st.uint(3, _STATUS_CODE[span.status["code"]])) and None)

    def scope_spans(ss: _ProtoWriter) -> None:
        ss.message(1, _scope)
        for span in spans:
            ss.message(2, lambda s, span=span: span_message(s, span))

    w = _ProtoWriter()
    w.message(1, lambda rs: (rs.message(1, lambda r: _write_attributes(r, 1, resource)), rs.message(2, scope_spans)) and None)
    return w.finish()


# ---------------------------------------------------------------------------
# Measures as OpenTelemetry metrics (26.12)
# ---------------------------------------------------------------------------

def measures_to_gauges(report: dict[str, Any], definitions: list[Any]) -> list[dict[str, Any]]:
    """
    Each measure with a value as a data point of a gauge named `awa.<id>`, with the labels
    of the OpenMetrics exposition (21.6) as attributes, in the order of the definitions.
    """
    points: dict[str, list[dict[str, Any]]] = {}

    def add(measure_id: str, attributes: dict[str, str], measure: dict[str, Any]) -> None:
        value = (measure or {}).get("value")
        if value is None or isinstance(value, bool) or not math.isfinite(value):
            return
        points.setdefault(measure_id, []).append({"attributes": attributes, "value": value})

    for j in report.get("journeys") or []:
        for mid, m in j["measures"].items():
            add(mid, {"journey": j["name"]}, m)
        for s in j.get("stages") or []:
            for mid, m in s["measures"].items():
                add(mid, {"journey": j["name"], "stage": s["name"]}, m)
    for w in report.get("workflows") or []:
        for mid, m in w["measures"].items():
            add(mid, {"workflow": w["name"]}, m)
        for a in w.get("activities") or []:
            for mid, m in a["measures"].items():
                add(mid, {"workflow": w["name"], "activity": a["name"]}, m)

    currency = report.get("currency")

    def unit(u: str) -> str:
        if u == "ms":
            return "ms"
        if u == "tokens":
            return "{token}"
        if u == "currency":
            return f"{{{currency}}}" if currency else "1"
        return "1"

    out = []
    for d in definitions:
        d = d if isinstance(d, dict) else vars(d)
        if d["id"] in points:
            out.append({"name": f"awa.{d['id']}", "description": f"{d['name']}. {d['definition']}", "unit": unit(d["unit"]), "points": points[d["id"]]})
    return out


def gauges_to_otlp_json(gauges: list[dict[str, Any]], report: dict[str, Any], resource: TelemetryAttributes | None = None) -> dict[str, Any]:
    """An ExportMetricsServiceRequest in OTLP/JSON"""
    time_text = _nanos(time_ms(report["as_of"]))
    start = (report.get("period") or {}).get("from")
    start_text = _nanos(time_ms(start)) if start else None

    def point(p: dict[str, Any]) -> dict[str, Any]:
        out: dict[str, Any] = {"attributes": otlp_attributes(p["attributes"])}
        if start_text:
            out["startTimeUnixNano"] = start_text
        out["timeUnixNano"] = time_text
        out["asDouble"] = p["value"]
        return out

    return {"resourceMetrics": [{
        "resource": {"attributes": otlp_attributes(resource if resource is not None else telemetry_resource())},
        "scopeMetrics": [{"scope": dict(TELEMETRY_SCOPE), "metrics": [
            {"name": g["name"], "description": g["description"], "unit": g["unit"], "gauge": {"dataPoints": [point(p) for p in g["points"]]}}
            for g in gauges]}],
    }]}


def gauges_to_otlp_protobuf(gauges: list[dict[str, Any]], report: dict[str, Any], resource: TelemetryAttributes | None = None) -> bytes:
    """An ExportMetricsServiceRequest in OTLP protobuf"""
    resource = resource if resource is not None else telemetry_resource()
    at = time_ms(report["as_of"]) * 1_000_000
    start_text = (report.get("period") or {}).get("from")
    start = time_ms(start_text) * 1_000_000 if start_text else None

    def data_point(dp: _ProtoWriter, p: dict[str, Any]) -> None:
        if start is not None:
            dp.fixed64(2, start)
        dp.fixed64(3, at)
        dp.double(4, float(p["value"]))
        _write_attributes(dp, 7, p["attributes"])

    def metric(m: _ProtoWriter, g: dict[str, Any]) -> None:
        m.string(1, g["name"])
        m.text(2, g["description"])
        m.text(3, g["unit"])
        m.message(5, lambda gauge: [gauge.message(1, lambda dp, p=p: data_point(dp, p)) for p in g["points"]] and None)

    def scope_metrics(sm: _ProtoWriter) -> None:
        sm.message(1, _scope)
        for g in gauges:
            sm.message(2, lambda m, g=g: metric(m, g))

    w = _ProtoWriter()
    w.message(1, lambda rm: (rm.message(1, lambda r: _write_attributes(r, 1, resource)), rm.message(2, scope_metrics)) and None)
    return w.finish()
