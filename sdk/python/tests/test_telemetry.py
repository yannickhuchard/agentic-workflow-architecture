"""
Telemetry (specification section 26): what the conformance cases cannot reach.

The claims-settlement example exported exactly as the TypeScript reference exports it
(identical trace and span ids, and the whole request); protobuf decoded with the
OpenTelemetry proto definitions; live export to a receiver on localhost in JSON and in
protobuf; failures that must not touch the run; recovery; journeys hosted live; the
environment; and the command.
"""

import base64
import gzip
import json
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any

import pytest

from awa.cli import main as awa_main
from awa.runtime.business_event import business_event
from awa.runtime.journal import InMemoryJournalStore
from awa.runtime.kpi import MEASURES, compute_measures
from awa.runtime.runtime_host import AwaRuntime, InMemoryRuntimeStore, simulated_actors
from awa.runtime.telemetry import (
    gauges_to_otlp_json, gauges_to_otlp_protobuf, journey_spans, measures_to_gauges, run_span_id, run_spans, run_trace_id,
    spans_to_otlp_json, spans_to_otlp_protobuf,
)
from awa.runtime.telemetry_export import OtlpHttpExporter, signal_url, telemetry_from_env
from awa.runtime.workflow_engine import EngineStatus, WorkflowEngine
from awa.types import Workflow

ROOT = Path(__file__).resolve().parents[3]
EXAMPLE = ROOT / "examples" / "claims-settlement"
RUNS = ["completed", "failed-and-compensated", "model-decision"]


def claims_document() -> dict[str, Any]:
    return json.loads((EXAMPLE / "claims-settlement.awa.json").read_text())


def journal_of(name: str) -> list[dict[str, Any]]:
    return [json.loads(line) for line in (EXAMPLE / "runs" / f"{name}.journal.jsonl").read_text().splitlines() if line.strip()]


def spans_in(request: dict[str, Any]) -> list[dict[str, Any]]:
    return [s for r in request["resourceSpans"] for ss in r["scopeSpans"] for s in ss["spans"]]


# ---------------------------------------------------------------------------
# Shared with the TypeScript reference
# ---------------------------------------------------------------------------

@pytest.mark.parametrize("name", RUNS)
def test_the_example_exports_with_the_trace_and_span_ids_typescript_gives(name):
    workflow = claims_document()
    exported = spans_to_otlp_json(run_spans(workflow, journal_of(name)))
    # Written by the TypeScript reference (sdk/typescript/tests/telemetry.test.ts checks it reproduces it)
    committed = json.loads((EXAMPLE / "telemetry" / f"{name}.otlp.json").read_text())
    ids = lambda request: [(s["traceId"], s["spanId"], s.get("parentSpanId")) for s in spans_in(request)]
    assert ids(exported) == ids(committed)
    assert {s["traceId"] for s in spans_in(exported)} == {run_trace_id(journal_of(name)[0]["run_id"])}
    assert exported == committed


def test_the_run_span_is_found_from_the_run_id_alone():
    events = journal_of("completed")
    spans = run_spans(claims_document(), events)
    run = next(s for s in spans if s.name.startswith("invoke_workflow"))
    assert (run.trace_id, run.span_id) == (run_trace_id(events[0]["run_id"]), run_span_id(events[0]["run_id"], 1))
    assert run.parent_span_id is None


# ---------------------------------------------------------------------------
# Protobuf, decoded with the OpenTelemetry proto definitions
# ---------------------------------------------------------------------------

def _comparable(value: Any, key: str = "") -> Any:
    """A decoded message, or OTLP/JSON, in one form: ids in hex, defaults and attribute order left out"""
    if isinstance(value, list):
        items = [_comparable(v) for v in value]
        return sorted(items, key=lambda a: a["key"]) if key == "attributes" else items
    if key in ("traceId", "spanId", "parentSpanId") and isinstance(value, str):
        try:
            int(value, 16)
            return value
        except ValueError:
            return base64.b64decode(value).hex()
    if not isinstance(value, dict):
        return value
    out = {}
    for k, v in value.items():
        c = _comparable(v, k)
        if c == [] or c == {} or (k == "code" and c == 0):
            continue
        out[k] = c
    return out


def _decode(message_type: Any, body: bytes) -> dict[str, Any]:
    from google.protobuf.json_format import MessageToDict
    message = message_type()
    message.ParseFromString(body)
    return _comparable(MessageToDict(message, use_integers_for_enums=True))


@pytest.mark.parametrize("name", RUNS)
def test_protobuf_decodes_to_the_same_request_as_json(name):
    pytest.importorskip("opentelemetry.proto")
    from opentelemetry.proto.collector.trace.v1.trace_service_pb2 import ExportTraceServiceRequest
    spans = run_spans(claims_document(), journal_of(name), payloads=True)
    assert _decode(ExportTraceServiceRequest, spans_to_otlp_protobuf(spans)) == _comparable(spans_to_otlp_json(spans))


def test_protobuf_encodes_every_kind_of_value_and_links():
    pytest.importorskip("opentelemetry.proto")
    from opentelemetry.proto.collector.trace.v1.trace_service_pb2 import ExportTraceServiceRequest
    base = {"spec_version": "1.1", "journey_instance_id": "i-1", "journey_id": "j"}
    events = [
        {**base, "seq": 1, "time": "2026-01-01T00:00:00.000Z", "type": "journey.started", "data": {"journey_name": "Ünïcode ✓"}},
        {**base, "seq": 2, "time": "2026-01-01T00:00:00.001Z", "type": "journey.run_started", "run_id": "r-1", "data": {"workflow_name": "W"}},
        {**base, "seq": 3, "time": "2026-01-01T00:00:01.000Z", "type": "journey.goal_reached",
         "data": {"big": 2 ** 40, "negative": -3, "ratio": 0.125, "list": [1, "a"], "yes": False}},
    ]
    spans = journey_spans(events)
    decoded = _decode(ExportTraceServiceRequest, spans_to_otlp_protobuf(spans))
    assert decoded == _comparable(spans_to_otlp_json(spans))
    run = next(s for s in spans_in(decoded) if s["name"] == "run W")
    assert run["links"] == [{"traceId": run_trace_id("r-1"), "spanId": run_span_id("r-1", 1)}]


def _a_report() -> dict[str, Any]:
    case = json.loads(sorted((ROOT / "spec" / "conformance" / "measures").glob("*.json"))[0].read_text())
    return compute_measures(case["recorded"], case.get("options"))


def test_measures_encode_as_gauges_that_decode_with_the_metrics_definitions():
    pytest.importorskip("opentelemetry.proto")
    from opentelemetry.proto.collector.metrics.v1.metrics_service_pb2 import ExportMetricsServiceRequest
    report = _a_report()
    gauges = measures_to_gauges(report, MEASURES)
    assert len(gauges) > 5
    assert _decode(ExportMetricsServiceRequest, gauges_to_otlp_protobuf(gauges, report)) == _comparable(gauges_to_otlp_json(gauges, report))


# ---------------------------------------------------------------------------
# A receiver on localhost
# ---------------------------------------------------------------------------

class Receiver:
    def __init__(self, answer=None):
        self.received: list[dict[str, Any]] = []
        self.answer = answer or (lambda request, index: {"status": 200})
        receiver = self

        class Handler(BaseHTTPRequestHandler):
            def do_POST(self):  # noqa: N802 - the standard library's name
                body = self.rfile.read(int(self.headers.get("Content-Length") or 0))
                if self.headers.get("Content-Encoding") == "gzip":
                    body = gzip.decompress(body)
                request = {"path": self.path, "headers": {k.lower(): v for k, v in self.headers.items()}, "body": body}
                reply = receiver.answer(request, len(receiver.received))
                receiver.received.append(request)
                time.sleep(reply.get("delay_s", 0))
                self.send_response(reply["status"])
                for k, v in (reply.get("headers") or {}).items():
                    self.send_header(k, v)
                self.send_header("Content-Length", "2")
                self.end_headers()
                self.wfile.write(b"{}")

            def log_message(self, *args):
                pass

        self.server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        self.url = f"http://127.0.0.1:{self.server.server_address[1]}"
        threading.Thread(target=self.server.serve_forever, daemon=True).start()

    def close(self):
        self.server.shutdown()
        self.server.server_close()


@pytest.fixture
def receiver():
    made = []

    def make(answer=None):
        r = Receiver(answer)
        made.append(r)
        return r
    yield make
    for r in made:
        r.close()


def _two_steps() -> Workflow:
    return Workflow.model_validate({
        "id": "9f0e4a52-6b8e-4c41-9a51-1f9c9f3f0a01", "name": "Two steps", "version": "1.0.0", "awa_version": "1.1",
        "activities": [
            {"id": "11111111-1111-4111-8111-111111111111", "name": "Draft", "role_id": "33333333-3333-4333-8333-333333333333", "actor_type": "application"},
            {"id": "22222222-2222-4222-8222-222222222222", "name": "Send", "role_id": "33333333-3333-4333-8333-333333333333", "actor_type": "application"},
        ],
        "edges": [{"id": "44444444-4444-4444-8444-444444444444", "source_id": "11111111-1111-4111-8111-111111111111",
                   "target_id": "22222222-2222-4222-8222-222222222222"}],
    })


@pytest.mark.parametrize("protocol", ["http/json", "http/protobuf"])
def test_a_run_sends_its_spans_as_it_proceeds_the_same_as_a_recorded_export(receiver, protocol):
    if protocol == "http/protobuf":
        pytest.importorskip("opentelemetry.proto")
    from opentelemetry.proto.collector.trace.v1.trace_service_pb2 import ExportTraceServiceRequest
    collector = receiver()
    exporter = OtlpHttpExporter(f"{collector.url}/v1/traces", protocol=protocol, schedule_delay_ms=5, headers={"x-tenant": "claims"})
    document = claims_document()
    workflow = Workflow.model_validate(document)
    engine = WorkflowEngine(workflow, options={
        "simulate": True, "simulated_outputs": json.loads((EXAMPLE / "simulation.json").read_text()), "journal": InMemoryJournalStore(),
        "telemetry": {"exporter": exporter, "payloads": True}, "sleep": lambda ms: None, "log_execution": False,
    })
    engine.run({"claimant": "J. Moreau"})
    assert engine.status == EngineStatus.COMPLETED
    exporter.flush()

    sent = []
    for request in collector.received:
        assert request["path"] == "/v1/traces"
        assert request["headers"]["x-tenant"] == "claims"
        assert request["headers"]["content-type"] == ("application/json" if protocol == "http/json" else "application/x-protobuf")
        decoded = _comparable(json.loads(request["body"])) if protocol == "http/json" else _decode(ExportTraceServiceRequest, request["body"])
        sent.extend(spans_in(decoded))
    recorded = spans_in(_comparable(spans_to_otlp_json(run_spans(document, engine.get_events(), payloads=True))))
    assert sent == recorded
    assert {s["traceId"] for s in sent} == {run_trace_id(engine.run_id)}
    names = [s["name"] for s in sent]
    assert "invoke_workflow Motor Claim Settlement" in names and "decision Settlement route" in names and "wait Bank cut-off" in names
    assert exporter.stats() == {"queued": 0, "exported": len(sent), "dropped": 0, "failed_requests": 0}


def test_gzip_and_batches(receiver):
    collector = receiver()
    exporter = OtlpHttpExporter(f"{collector.url}/v1/traces", protocol="http/json", compression="gzip", max_batch_size=8, schedule_delay_ms=5)
    exporter.export(run_spans(claims_document(), journal_of("completed")))
    exporter.flush()
    assert all(r["headers"].get("content-encoding") == "gzip" for r in collector.received)
    assert [len(spans_in(json.loads(r["body"]))) for r in collector.received] == [8, 8, 5]


# ---------------------------------------------------------------------------
# Telemetry never fails a run
# ---------------------------------------------------------------------------

def test_503_and_429_are_retried_honouring_retry_after(receiver):
    collector = receiver(lambda r, i: {"status": 503} if i == 0 else {"status": 429, "headers": {"Retry-After": "0"}} if i == 1 else {"status": 200})
    exporter = OtlpHttpExporter(f"{collector.url}/v1/traces", retry_delay_ms=5, schedule_delay_ms=5, on_warning=lambda m: None)
    exporter.export(run_spans(claims_document(), journal_of("completed")))
    exporter.flush()
    assert len(collector.received) == 3
    assert exporter.stats() == {"queued": 0, "exported": 21, "dropped": 0, "failed_requests": 0}


def test_a_refused_request_is_not_retried_and_the_run_completes(receiver):
    collector = receiver(lambda r, i: {"status": 400})
    warnings: list[str] = []
    exporter = OtlpHttpExporter(f"{collector.url}/v1/traces", retry_delay_ms=5, schedule_delay_ms=5, on_warning=warnings.append)
    engine = WorkflowEngine(_two_steps(), options={"simulate": True, "telemetry": exporter, "log_execution": False})
    engine.run({})
    assert engine.status == EngineStatus.COMPLETED
    exporter.flush()
    assert len(collector.received) == 1
    assert exporter.stats() == {"queued": 0, "exported": 0, "dropped": 3, "failed_requests": 1}
    assert len(warnings) == 1 and "HTTP 400" in warnings[0] and "awa telemetry export" in warnings[0]


def test_an_unreachable_receiver_does_not_hold_the_run(receiver):
    gone = receiver()
    url = gone.url
    gone.close()
    warnings: list[str] = []
    exporter = OtlpHttpExporter(f"{url}/v1/traces", retry_delay_ms=10, max_attempts=3, schedule_delay_ms=0, on_warning=warnings.append)
    engine = WorkflowEngine(_two_steps(), options={"simulate": True, "telemetry": exporter, "log_execution": False})
    engine.run({})
    assert engine.status == EngineStatus.COMPLETED
    exporter.flush()
    assert exporter.stats()["dropped"] == 3 and exporter.stats()["failed_requests"] >= 1
    assert "could not be sent" in warnings[0]


def test_a_slow_receiver_does_not_hold_the_run(receiver):
    collector = receiver(lambda r, i: {"status": 200, "delay_s": 1.5})
    exporter = OtlpHttpExporter(f"{collector.url}/v1/traces", schedule_delay_ms=0, max_batch_size=1)
    started = time.monotonic()
    engine = WorkflowEngine(_two_steps(), options={"simulate": True, "telemetry": exporter, "log_execution": False})
    engine.run({})
    assert engine.status == EngineStatus.COMPLETED
    assert time.monotonic() - started < 1.0
    exporter.flush()
    assert exporter.stats()["exported"] == 3


def test_a_full_queue_drops_and_counts():
    warnings: list[str] = []
    exporter = OtlpHttpExporter("http://127.0.0.1:9/v1/traces", max_queue_size=5, schedule_delay_ms=60_000, on_warning=warnings.append)
    exporter.export(run_spans(claims_document(), journal_of("completed")))
    assert exporter.stats()["queued"] == 5 and exporter.stats()["dropped"] == 16
    assert "16 span(s) dropped: the queue is full" in warnings[0]


def test_an_exporter_that_raises_or_an_endpoint_that_is_not_a_url_leaves_the_run_alone(caplog):
    class Broken:
        def export(self, spans):
            raise RuntimeError("broken exporter")

    for telemetry in (Broken(), {"endpoint": "not a url"}):
        engine = WorkflowEngine(_two_steps(), options={"simulate": True, "telemetry": telemetry, "log_execution": False})
        engine.run({})
        assert engine.status == EngineStatus.COMPLETED
    assert "broken exporter" in caplog.text and "not sending telemetry" in caplog.text


def test_grpc_is_refused_rather_than_sent_to_the_wrong_place():
    with pytest.raises(ValueError, match="not supported"):
        OtlpHttpExporter("http://127.0.0.1:4317", protocol="grpc")


# ---------------------------------------------------------------------------
# Recovery and journeys
# ---------------------------------------------------------------------------

class Collect:
    def __init__(self):
        self.spans = []

    def export(self, spans):
        self.spans.extend(spans)


class _Person:
    """A person who has not answered yet"""

    def execute(self, activity, token):
        return {"_requires_human_action": True, "_human_task_id": "task-1"}


def test_a_resumed_run_keeps_the_ids_and_starts_of_spans_opened_before_the_restart():
    workflow = Workflow.model_validate({
        "id": "0a4b9f9e-08a5-4b7e-8c3e-0b8f0c6a1d11", "name": "Approve", "version": "1.0.0", "awa_version": "1.1",
        "activities": [
            {"id": "11111111-1111-4111-8111-111111111111", "name": "Approve", "role_id": "33333333-3333-4333-8333-333333333333", "actor_type": "human"},
            {"id": "22222222-2222-4222-8222-222222222222", "name": "Archive", "role_id": "33333333-3333-4333-8333-333333333333", "actor_type": "application"},
        ],
        "edges": [{"id": "44444444-4444-4444-8444-444444444444", "source_id": "11111111-1111-4111-8111-111111111111",
                   "target_id": "22222222-2222-4222-8222-222222222222"}],
    })
    journal = InMemoryJournalStore()
    first = Collect()
    engine = WorkflowEngine(workflow, options={"journal": journal, "actors": {"human": _Person()}, "telemetry": first, "log_execution": False})
    engine.run({})
    assert engine.status == EngineStatus.WAITING_HUMAN
    assert first.spans == []

    second = Collect()
    resumed = WorkflowEngine.restore(workflow, engine.snapshot(), {"journal": journal, "telemetry": second, "log_execution": False})
    token = next(t for t in resumed.tokens if t.status.value == "waiting")
    resumed.resume_token(token.id, {"approved": True})
    resumed.run()
    assert resumed.status == EngineStatus.COMPLETED
    events = resumed.get_events()
    assert [(s.span_id, s.name) for s in second.spans] == [(s.span_id, s.name) for s in run_spans(workflow, events)]
    run = next(s for s in second.spans if s.name == "invoke_workflow Approve")
    assert run.span_id == run_span_id(engine.run_id, 1)
    assert run.start_ms == run_spans(workflow, events)[-1].start_ms
    wait = next(s for s in second.spans if s.name == "wait Approve")
    assert wait.status == {"code": "ok"}


def test_a_host_sends_journey_traces_linked_to_runs_and_not_again_after_a_restart():
    workflow = {
        "id": "d3c5f1c2-6a39-4a8f-8f2e-3c9d6b1a7e21", "name": "Intake", "version": "1.0.0", "awa_version": "1.1",
        "activities": [{"id": "11111111-1111-4111-8111-111111111111", "name": "Register", "role_id": "33333333-3333-4333-8333-333333333333",
                        "actor_type": "application"}], "edges": [],
    }
    journey = {
        "id": "f1e2d3c4-b5a6-4978-8877-665544332211", "name": "Claim", "version": "1.0.0", "subject": {"name": "customer", "key": "customer_id"},
        "stages": [{"id": "intake", "name": "Intake", "workflows": [workflow["id"]], "complete_when": "registered == true"}],
        "triggers": [{"event": "claim.submitted", "starts_journey": True, "start_workflow": workflow["id"]}], "exits": [], "goals": [],
    }
    store, exported = InMemoryRuntimeStore(), Collect()
    engine = {"actors": simulated_actors({"Register": {"output": {"registered": True}}}), "log_execution": False}
    host = AwaRuntime(engine=engine, store=store, telemetry=exported)
    host.register_workflow(workflow).register_journey(journey)
    host.publish(business_event("claim.submitted", {"customer_id": "C-9"}, source="/test", id="e-1"))
    instance = host.list_journey_instances(journey["id"])[0]
    assert instance["status"] == "completed"
    run_id = instance["runs"][0]["run_id"]
    trace = [s for s in exported.spans if s.attributes.get("awa.journey.instance_id") == instance["id"]]
    assert sorted(s.name for s in trace) == ["journey Claim", "run Intake", "stage Intake"]
    assert [s.span_id for s in trace] == [s.span_id for s in journey_spans(instance["events"])]
    assert next(s for s in trace if s.name == "run Intake").links == [{"trace_id": run_trace_id(run_id), "span_id": run_span_id(run_id, 1)}]
    assert any(s.trace_id == run_trace_id(run_id) and s.span_id == run_span_id(run_id, 1) for s in exported.spans)

    count = len(exported.spans)
    again = AwaRuntime(engine=engine, store=store, telemetry=exported)
    again.register_workflow(workflow).register_journey(journey)
    again.recover()
    again.save()
    assert len(exported.spans) == count


# ---------------------------------------------------------------------------
# Configuration and the command
# ---------------------------------------------------------------------------

def test_nothing_is_sent_unless_an_endpoint_is_named_or_when_disabled():
    assert telemetry_from_env({}) is None
    assert telemetry_from_env({"OTEL_EXPORTER_OTLP_ENDPOINT": "http://c:4318", "OTEL_SDK_DISABLED": "true"}) is None
    assert telemetry_from_env({"OTEL_EXPORTER_OTLP_ENDPOINT": "http://c:4318", "OTEL_TRACES_EXPORTER": "none"}) is None


def test_the_standard_variables_are_read():
    config = telemetry_from_env({
        "OTEL_EXPORTER_OTLP_ENDPOINT": "http://collector:4318",
        "OTEL_EXPORTER_OTLP_TRACES_ENDPOINT": "http://collector:4318/custom/traces",
        "OTEL_EXPORTER_OTLP_HEADERS": "authorization=Bearer%20abc,x-a=1",
        "OTEL_EXPORTER_OTLP_TRACES_HEADERS": "x-a=2",
        "OTEL_EXPORTER_OTLP_PROTOCOL": "http/json",
        "OTEL_EXPORTER_OTLP_TRACES_TIMEOUT": "2500",
        "OTEL_EXPORTER_OTLP_COMPRESSION": "gzip",
        "OTEL_SERVICE_NAME": "claims-host",
        "OTEL_RESOURCE_ATTRIBUTES": "deployment.environment.name=prod,service.namespace=insurance",
        "OTEL_BSP_MAX_EXPORT_BATCH_SIZE": "100",
        "AWA_TELEMETRY_PAYLOADS": "true",
    })
    assert config is not None
    assert config["traces_endpoint"] == "http://collector:4318/custom/traces" and config["endpoint"] == "http://collector:4318"
    assert config["headers"] == {"authorization": "Bearer abc", "x-a": "2"}
    assert (config["protocol"], config["timeout_ms"], config["compression"], config["service_name"]) == ("http/json", 2500, "gzip", "claims-host")
    assert config["resource"] == {"deployment.environment.name": "prod", "service.namespace": "insurance"}
    assert config["max_batch_size"] == 100 and config["payloads"] is True


def test_grpc_and_unknown_exporters_are_refused_with_a_reason():
    warnings: list[str] = []
    assert telemetry_from_env({"OTEL_EXPORTER_OTLP_ENDPOINT": "http://c:4317", "OTEL_EXPORTER_OTLP_PROTOCOL": "grpc"}, warnings) is None
    assert telemetry_from_env({"OTEL_EXPORTER_OTLP_ENDPOINT": "http://c:4318", "OTEL_TRACES_EXPORTER": "zipkin"}, warnings) is None
    assert len(warnings) == 2 and "grpc" in warnings[0]


def test_the_signal_path_is_appended_unless_present():
    assert signal_url("http://c:4318", "traces") == "http://c:4318/v1/traces"
    assert signal_url("http://c:4318/otlp/", "metrics") == "http://c:4318/otlp/v1/metrics"
    assert signal_url("http://c:4318/v1/traces", "metrics") == "http://c:4318/v1/metrics"


def test_measures_go_to_v1_metrics(receiver):
    pytest.importorskip("opentelemetry.proto")
    from opentelemetry.proto.collector.metrics.v1.metrics_service_pb2 import ExportMetricsServiceRequest
    collector = receiver()
    report = _a_report()
    exporter = OtlpHttpExporter(f"{collector.url}/v1/traces")
    assert exporter.export_metrics(measures_to_gauges(report, MEASURES), report) is True
    assert collector.received[0]["path"] == "/v1/metrics"
    metrics = _decode(ExportMetricsServiceRequest, collector.received[0]["body"])["resourceMetrics"][0]["scopeMetrics"][0]["metrics"]
    assert "awa.workflow.success_rate" in [m["name"] for m in metrics]


def test_awa_telemetry_export_writes_a_file_and_sends_to_an_endpoint(tmp_path, receiver, capsys):
    out = tmp_path / "run.json"
    workflow, journal = str(EXAMPLE / "claims-settlement.awa.json"), str(EXAMPLE / "runs" / "completed.journal.jsonl")
    assert awa_main(["telemetry", "export", workflow, journal, "--file", str(out)]) == 0
    assert json.loads(out.read_text()) == json.loads((EXAMPLE / "telemetry" / "completed.otlp.json").read_text())
    collector = receiver()
    assert awa_main(["telemetry", "export", workflow, journal, "--endpoint", collector.url, "--protocol", "http/json",
                     "--header", "x-key=k1", "--payloads"]) == 0
    assert collector.received[0]["headers"]["x-key"] == "k1"
    sent = spans_in(json.loads(collector.received[0]["body"]))
    assert len(sent) == 21
    assert any(a["key"] == "gen_ai.tool.call.arguments" for s in sent for a in s["attributes"])
    said = capsys.readouterr().out
    assert "wrote 21 span(s)" in said and "sent 21 span(s)" in said
    assert awa_main(["telemetry", "export", workflow, journal]) == 1 or telemetry_from_env() is not None
