"""
AWA Telemetry export (specification 26.9 to 26.11)

Sends the spans of section 26 as OTLP over HTTP, in protobuf or JSON, attaches to runs
and journey hosts so that spans leave as the record is written, and reads the standard
OpenTelemetry environment variables. Needs nothing beyond the standard library.

Telemetry never delays, blocks or fails a run: spans are queued and sent by a background
thread, failures are retried within a bound, and what cannot be sent is dropped and
counted. The journal remains the record; a recorded export can send again what was
dropped, with the same identifiers.
"""

from __future__ import annotations

import atexit
import email.utils
import gzip
import json
import logging
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
import weakref
from typing import Any, Callable, Iterable, Protocol

from awa.runtime.telemetry import (
    JourneyTraceMapper, RunTraceMapper, TelemetrySpan, gauges_to_otlp_json, gauges_to_otlp_protobuf,
    spans_to_otlp_json, spans_to_otlp_protobuf, telemetry_resource,
)

logger = logging.getLogger("awa.telemetry")

_RETRYABLE = {429, 502, 503, 504}
PROTOCOLS = ("http/protobuf", "http/json")


class SpanExporter(Protocol):
    """Receives spans as they end. export() must return at once; sending happens elsewhere."""

    def export(self, spans: list[TelemetrySpan]) -> None: ...


def signal_url(endpoint: str, signal: str) -> str:
    """The URL of a signal (traces, metrics) under an OTLP endpoint (26.9)"""
    parts = urllib.parse.urlsplit(endpoint)
    if not parts.scheme or not parts.netloc:
        raise ValueError(f'"{endpoint}" is not a URL')
    path = parts.path.rstrip("/")
    if path.endswith("/v1/traces") or path.endswith("/v1/metrics"):
        path = path[: path.rfind("/") + 1] + signal
    else:
        path = f"{path}/v1/{signal}"
    return urllib.parse.urlunsplit((parts.scheme, parts.netloc, path, parts.query, parts.fragment))


_live: "weakref.WeakSet[OtlpHttpExporter]" = weakref.WeakSet()


@atexit.register
def _flush_at_exit() -> None:
    for exporter in list(_live):
        try:
            exporter.flush()
        except Exception:
            pass


class OtlpHttpExporter:
    """
    Sends spans as OTLP over HTTP. export() queues and returns; a background thread sends
    batches when full or after the schedule delay. A failed request is retried on a network
    error or HTTP 429, 502, 503 or 504, honouring Retry-After, within the timeout; after
    that its spans are dropped and counted.
    """

    def __init__(self, traces_url: str, metrics_url: str | None = None, headers: dict[str, str] | None = None,
                 protocol: str = "http/protobuf", timeout_ms: float = 10_000, compression: str = "none",
                 resource: dict[str, Any] | None = None, max_queue_size: int = 2048, max_batch_size: int = 512,
                 schedule_delay_ms: float = 1000, retry_delay_ms: float = 1000, max_attempts: int = 5,
                 on_warning: Callable[[str], None] | None = None) -> None:
        signal_url(traces_url, "traces")  # an invalid endpoint is refused here, not when the first span ends
        if protocol not in PROTOCOLS:
            raise ValueError(f'OTLP protocol "{protocol}" is not supported: use http/protobuf or http/json')
        self.traces_url = traces_url
        self.metrics_url = metrics_url
        self.headers = dict(headers or {})
        self.protocol = protocol
        self.timeout_ms = timeout_ms
        self.compression = compression
        self.resource = resource if resource is not None else telemetry_resource()
        self.max_queue_size = max_queue_size
        self.max_batch_size = max_batch_size
        self.schedule_delay_ms = schedule_delay_ms
        self.retry_delay_ms = retry_delay_ms
        self.max_attempts = max_attempts
        self._on_warning = on_warning
        self._queue: list[TelemetrySpan] = []
        self._lock = threading.Condition()
        self._sending = 0
        self._closed = False
        self._worker = False
        self._counts = {"exported": 0, "dropped": 0, "failed_requests": 0}
        self._last_warning = float("-inf")
        self._flush_requested = False

    # -- the run's side: never waits ------------------------------------------

    def export(self, spans: list[TelemetrySpan]) -> None:
        dropped = 0
        with self._lock:
            for span in spans:
                if self._closed or len(self._queue) >= self.max_queue_size:
                    dropped += 1
                    continue
                self._queue.append(span)
            self._counts["dropped"] += dropped
            if self._queue:
                _live.add(self)
                self._ensure_thread()
                self._lock.notify_all()
        if dropped:
            self._warn(f"{dropped} span(s) dropped: {'the exporter is shut down' if self._closed else 'the queue is full'}")

    def stats(self) -> dict[str, int]:
        with self._lock:
            return {"queued": len(self._queue), **self._counts}

    # -- the host's side --------------------------------------------------------

    def flush(self, timeout_s: float | None = None) -> None:
        """Send everything queued. Returns when it was sent or dropped, or after the export timeout (by default); never raises."""
        deadline = time.monotonic() + (timeout_s if timeout_s is not None else self.timeout_ms / 1000 + 1)
        with self._lock:
            self._flush_requested = True
            self._lock.notify_all()
            while (self._queue or self._sending) and time.monotonic() < deadline:
                if self._queue:
                    self._ensure_thread()
                self._lock.wait(timeout=max(0.0, min(0.05, deadline - time.monotonic())))
            self._flush_requested = False

    def shutdown(self) -> None:
        """Flush, then refuse further spans"""
        self.flush()
        with self._lock:
            self._closed = True
            self._lock.notify_all()

    def export_metrics(self, gauges: list[dict[str, Any]], report: dict[str, Any]) -> bool:
        """Send gauges (26.12) at once. True when the receiver accepted them."""
        if not gauges:
            return True
        url = self.metrics_url or signal_url(self.traces_url, "metrics")
        body = (json.dumps(gauges_to_otlp_json(gauges, report, self.resource)).encode("utf-8") if self.protocol == "http/json"
                else gauges_to_otlp_protobuf(gauges, report, self.resource))
        return self._post(url, body, 0)

    # -- the background thread --------------------------------------------------

    def _ensure_thread(self) -> None:
        """Start the sending thread unless it runs. Called with the lock held."""
        if self._worker:
            return
        self._worker = True
        threading.Thread(target=self._work, name="awa-telemetry", daemon=True).start()

    def _work(self) -> None:
        while True:
            with self._lock:
                if not self._queue:
                    self._lock.wait(timeout=5.0)
                    if not self._queue:
                        self._worker = False  # idle: the next export starts another thread
                        return
                # A batch leaves when it is full, when a flush asks, or after the schedule delay
                deadline = time.monotonic() + self.schedule_delay_ms / 1000
                while len(self._queue) < self.max_batch_size and not self._flush_requested and not self._closed:
                    remaining = deadline - time.monotonic()
                    if remaining <= 0:
                        break
                    self._lock.wait(timeout=remaining)
                batch = self._queue[: self.max_batch_size]
                del self._queue[: self.max_batch_size]
                self._sending += 1
            try:
                body = (json.dumps(spans_to_otlp_json(batch, self.resource)).encode("utf-8") if self.protocol == "http/json"
                        else spans_to_otlp_protobuf(batch, self.resource))
                if self._post(self.traces_url, body, len(batch)):
                    with self._lock:
                        self._counts["exported"] += len(batch)
            except Exception as error:  # telemetry must never take a thread of the host down noisily
                with self._lock:
                    self._counts["dropped"] += len(batch)
                self._warn(f"telemetry export failed: {error}")
            finally:
                with self._lock:
                    self._sending -= 1
                    self._lock.notify_all()

    def _post(self, url: str, body: bytes, spans: int) -> bool:
        deadline = time.monotonic() + self.timeout_ms / 1000
        headers = {**self.headers, "Content-Type": "application/json" if self.protocol == "http/json" else "application/x-protobuf"}
        if self.compression == "gzip":
            body = gzip.compress(body)
            headers["Content-Encoding"] = "gzip"
        delay = self.retry_delay_ms / 1000
        attempt = 0
        while True:
            attempt += 1
            retry_after: float | None = None
            retryable = True
            try:
                request = urllib.request.Request(url, data=body, headers=headers, method="POST")
                remaining = max(0.001, deadline - time.monotonic())
                with urllib.request.urlopen(request, timeout=remaining) as response:  # noqa: S310 - the endpoint is the deployment's
                    response.read()
                return True
            except urllib.error.HTTPError as error:
                reason = f"HTTP {error.code}"
                retryable = error.code in _RETRYABLE
                header = error.headers.get("Retry-After") if error.headers else None
                if header:
                    try:
                        retry_after = float(header)
                    except ValueError:
                        parsed = email.utils.parsedate_to_datetime(header)
                        retry_after = max(0.0, parsed.timestamp() - time.time()) if parsed else None
            except Exception as error:
                reason = str(getattr(error, "reason", None) or error)
            wait = retry_after if retry_after is not None else delay
            if not retryable or attempt >= self.max_attempts or time.monotonic() + wait >= deadline:
                with self._lock:
                    self._counts["failed_requests"] += 1
                    self._counts["dropped"] += spans
                self._warn(f"telemetry could not be sent to {url} ({reason})"
                           + (f": {spans} span(s) dropped" if spans else "")
                           + '. The journal keeps the record; "awa telemetry export" can send it again')
                return False
            time.sleep(wait)
            delay *= 2

    def _warn(self, message: str) -> None:
        if self._on_warning:
            self._on_warning(message)
            return
        now = time.monotonic()
        if now - self._last_warning < 60:
            return
        self._last_warning = now
        logger.warning("[awa telemetry] %s (%s dropped so far)", message, self._counts["dropped"])


def otlp_exporter(config: dict[str, Any], **extra: Any) -> OtlpHttpExporter | None:
    """An OTLP exporter for a configuration, or None when it names nowhere to send to"""
    traces_url = config.get("traces_endpoint") or (signal_url(config["endpoint"], "traces") if config.get("endpoint") else None)
    if not traces_url:
        return None
    options: dict[str, Any] = {
        "metrics_url": config.get("metrics_endpoint") or (signal_url(config["endpoint"], "metrics") if config.get("endpoint") else None),
        "headers": config.get("headers"), "protocol": config.get("protocol") or "http/protobuf",
        "timeout_ms": config.get("timeout_ms") or 10_000, "compression": config.get("compression") or "none",
        "resource": telemetry_resource(config.get("resource"), config.get("service_name")),
    }
    for key in ("max_queue_size", "max_batch_size", "schedule_delay_ms"):
        if config.get(key) is not None:
            options[key] = config[key]
    options.update(extra)
    return OtlpHttpExporter(traces_url, **options)


_shared: dict[str, OtlpHttpExporter] = {}


def resolve_telemetry(setting: Any) -> tuple[Any, bool] | None:
    """An exporter and whether payloads go on spans, from an engine's or a host's option; None for none"""
    if not setting:
        return None
    if callable(getattr(setting, "export", None)) and not isinstance(setting, dict):
        return setting, False
    config = dict(setting)
    if config.get("exporter") is not None:
        return config["exporter"], config.get("payloads") is True
    key = json.dumps({k: v for k, v in config.items() if k != "payloads"}, sort_keys=True, default=str)
    exporter = _shared.get(key)
    if exporter is None:
        try:
            exporter = otlp_exporter(config)
        except ValueError as error:
            logger.warning("[awa telemetry] not sending telemetry: %s", error)
            return None
        if exporter is None:
            return None
        _shared[key] = exporter
    return exporter, config.get("payloads") is True


def _hand_over(exporter: Any, spans: list[TelemetrySpan]) -> None:
    if not spans:
        return
    try:
        exporter.export(spans)
    except Exception as error:
        logger.warning("[awa telemetry] the exporter refused spans: %s", error)


class RunTelemetry:
    """
    The telemetry of one run: maps its journal events to spans as they are recorded and
    hands each span to the exporter when it ends. A run resumed in another process first
    reads the journal it continues, so that spans opened before the restart keep their
    start and identifiers.
    """

    def __init__(self, workflow: Any, exporter: Any, payloads: bool, earlier: Callable[[], list[dict[str, Any]]]) -> None:
        self._mapper = RunTraceMapper(workflow, payloads)
        self._exporter = exporter
        self._earlier = earlier
        self._seen = 0
        self._unsubscribe: Callable[[], None] | None = None

    def watch(self, journal: Any) -> None:
        """Follow a journal writer. Calling it again follows another writer instead."""
        if self._unsubscribe:
            self._unsubscribe()
        self._unsubscribe = journal.subscribe(self._on_event)

    def _on_event(self, event: dict[str, Any]) -> None:
        try:
            if self._seen == 0 and event["seq"] > 1:
                try:
                    for earlier in sorted(self._earlier(), key=lambda e: e["seq"]):
                        if earlier["seq"] < event["seq"]:
                            self._mapper.push(earlier)
                except Exception:
                    pass
            self._seen += 1
            _hand_over(self._exporter, self._mapper.push(event))
        except Exception as error:
            logger.warning("[awa telemetry] %s", error)


def open_run_telemetry(workflow: Any, setting: Any, earlier: Callable[[], list[dict[str, Any]]]) -> RunTelemetry | None:
    resolved = resolve_telemetry(setting)
    return RunTelemetry(workflow, resolved[0], resolved[1], earlier) if resolved else None


class JourneyTelemetry:
    """The telemetry of a host of journeys: each journey instance is a trace (26.7)"""

    def __init__(self, exporter: Any, payloads: bool) -> None:
        self._exporter = exporter
        self._payloads = payloads
        # Per instance, the last journey event taken in, and the mapper while the journey is under way
        self._state: dict[str, dict[str, Any]] = {}

    def prime(self, instances: Iterable[dict[str, Any]]) -> None:
        """Take in records already sent by an earlier process, without sending them again"""
        self._take(instances, send=False)

    def observe(self, instances: Iterable[dict[str, Any]]) -> None:
        try:
            self._take(instances, send=True)
        except Exception as error:
            logger.warning("[awa telemetry] %s", error)

    def _take(self, instances: Iterable[dict[str, Any]], send: bool) -> None:
        for instance in instances:
            state = self._state.setdefault(instance["id"], {"mapper": JourneyTraceMapper(self._payloads), "seen": 0})
            fresh = sorted((e for e in instance.get("events") or [] if e["seq"] > state["seen"]), key=lambda e: e["seq"])
            for event in fresh:
                state["seen"] = event["seq"]
                spans = state["mapper"].push(event) if state["mapper"] else []
                if send:
                    _hand_over(self._exporter, spans)
            # An ended journey keeps only how far it was read, so that nothing is sent twice
            if instance.get("status") != "active":
                state["mapper"] = None


def open_journey_telemetry(setting: Any) -> JourneyTelemetry | None:
    resolved = resolve_telemetry(setting)
    return JourneyTelemetry(resolved[0], resolved[1]) if resolved else None


# ---------------------------------------------------------------------------
# Environment (26.11)
# ---------------------------------------------------------------------------

def _pairs(text: str | None) -> dict[str, str]:
    out: dict[str, str] = {}
    for part in (text or "").split(","):
        key, sep, value = part.partition("=")
        if not sep or not key.strip():
            continue
        out[key.strip()] = urllib.parse.unquote(value.strip())
    return out


def _positive(text: str | None) -> float | None:
    try:
        value = float(text) if text else None
    except ValueError:
        return None
    return value if value and value > 0 else None


def telemetry_from_env(env: dict[str, str] | None = None, warnings: list[str] | None = None) -> dict[str, Any] | None:
    """
    Telemetry configured by the standard OpenTelemetry environment variables, or None when
    they say to send nothing or name nowhere to send to. What cannot be honoured is
    reported in `warnings`.
    """
    import os
    env = dict(os.environ) if env is None else env
    warnings = warnings if warnings is not None else []

    def get(name: str) -> str | None:
        return env.get(f"OTEL_EXPORTER_OTLP_TRACES_{name}") or env.get(f"OTEL_EXPORTER_OTLP_{name}")

    if (env.get("OTEL_SDK_DISABLED") or "").strip().lower() == "true":
        return None
    exporters = [e.strip().lower() for e in (env.get("OTEL_TRACES_EXPORTER") or "otlp").split(",")]
    if "none" in exporters:
        return None
    if "otlp" not in exporters:
        warnings.append(f"OTEL_TRACES_EXPORTER={env.get('OTEL_TRACES_EXPORTER')} is not supported: only otlp is. No telemetry is sent.")
        return None
    traces_endpoint = (env.get("OTEL_EXPORTER_OTLP_TRACES_ENDPOINT") or "").strip()
    endpoint = (env.get("OTEL_EXPORTER_OTLP_ENDPOINT") or "").strip()
    if not traces_endpoint and not endpoint:
        return None
    protocol = (get("PROTOCOL") or "http/protobuf").strip()
    if protocol not in PROTOCOLS:
        warnings.append(f'OTLP protocol "{protocol}" is not supported: use http/protobuf or http/json. No telemetry is sent.')
        return None
    for url in (traces_endpoint, endpoint):
        if url:
            try:
                signal_url(url, "traces")
            except ValueError:
                warnings.append(f'"{url}" is not a URL. No telemetry is sent.')
                return None
    compression = (get("COMPRESSION") or "none").strip().lower()
    if compression not in ("gzip", "none"):
        warnings.append(f'OTLP compression "{compression}" is not supported; sending uncompressed.')
    config: dict[str, Any] = {}
    if traces_endpoint:
        config["traces_endpoint"] = traces_endpoint
    if endpoint:
        config["endpoint"] = endpoint
    if env.get("OTEL_EXPORTER_OTLP_METRICS_ENDPOINT"):
        config["metrics_endpoint"] = env["OTEL_EXPORTER_OTLP_METRICS_ENDPOINT"].strip()
    config.update({
        "headers": {**_pairs(env.get("OTEL_EXPORTER_OTLP_HEADERS")), **_pairs(env.get("OTEL_EXPORTER_OTLP_TRACES_HEADERS"))},
        "protocol": protocol,
        "timeout_ms": _positive(get("TIMEOUT")) or 10_000,
        "compression": "gzip" if compression == "gzip" else "none",
        "resource": _pairs(env.get("OTEL_RESOURCE_ATTRIBUTES")),
        "payloads": (env.get("AWA_TELEMETRY_PAYLOADS") or "").strip().lower() == "true",
    })
    if env.get("OTEL_SERVICE_NAME"):
        config["service_name"] = env["OTEL_SERVICE_NAME"]
    for variable, key in (("OTEL_BSP_SCHEDULE_DELAY", "schedule_delay_ms"), ("OTEL_BSP_MAX_QUEUE_SIZE", "max_queue_size"),
                          ("OTEL_BSP_MAX_EXPORT_BATCH_SIZE", "max_batch_size")):
        value = _positive(env.get(variable))
        if value is not None:
            config[key] = int(value) if key != "schedule_delay_ms" else value
    return config


_env_setting: dict[str, Any] | None = None


def shared_telemetry_from_env() -> dict[str, Any] | None:
    """The telemetry a command or a server takes from its environment, resolved once per process"""
    global _env_setting
    if _env_setting is None:
        warnings: list[str] = []
        config = telemetry_from_env(warnings=warnings)
        for warning in warnings:
            logger.warning("[awa telemetry] %s", warning)
        resolved = resolve_telemetry(config) if config else None
        _env_setting = {"setting": {"exporter": resolved[0], "payloads": resolved[1]} if resolved else None}
    return _env_setting["setting"]
