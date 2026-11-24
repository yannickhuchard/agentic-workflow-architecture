"""
awa telemetry: the record of runs and journeys as OpenTelemetry (specification section 26).

Each subcommand writes OTLP JSON to a file, or sends OTLP to an endpoint: the one given,
else the one the OTEL_EXPORTER_OTLP_* variables name.
"""

import argparse
import json
import os
import sys
from pathlib import Path
from typing import Any

from awa.runtime.kpi import MEASURES, compute_measures
from awa.runtime.telemetry import (
    TelemetrySpan, gauges_to_otlp_json, journey_spans, measures_to_gauges, run_spans, spans_to_otlp_json, telemetry_resource,
)
from awa.runtime.telemetry_export import PROTOCOLS, otlp_exporter, telemetry_from_env


def _read_json(file: str) -> Any:
    return json.loads(Path(file).read_text(encoding="utf-8"))


def _config(args: argparse.Namespace) -> dict[str, Any] | None:
    """Where to send: the options given, else the environment. None when writing a file."""
    if args.file:
        return None
    warnings: list[str] = []
    env = None if args.endpoint else telemetry_from_env(warnings=warnings)
    for warning in warnings:
        print(warning, file=sys.stderr)
    if not args.endpoint and not env:
        raise ValueError("Say where the telemetry goes: --endpoint <url>, --file <out.json>, or OTEL_EXPORTER_OTLP_ENDPOINT")
    headers = dict((env or {}).get("headers") or {})
    for header in args.header or []:
        key, sep, value = header.partition("=")
        if not sep or not key.strip():
            raise ValueError(f'A header is key=value, not "{header}"')
        headers[key.strip()] = value.strip()
    protocol = args.protocol or (env or {}).get("protocol") or "http/protobuf"
    if protocol not in PROTOCOLS:
        raise ValueError(f'Protocol "{protocol}" is not supported: use http/protobuf or http/json')
    config = {**(env or {}), "headers": headers, "protocol": protocol}
    if args.endpoint:
        config.update({"endpoint": args.endpoint, "traces_endpoint": None, "metrics_endpoint": None})
    if args.service_name:
        config["service_name"] = args.service_name
    return config


def _payloads(args: argparse.Namespace) -> bool:
    return bool(args.payloads) or (os.environ.get("AWA_TELEMETRY_PAYLOADS") or "").strip().lower() == "true"


def _deliver(spans: list[TelemetrySpan], args: argparse.Namespace, what: str) -> None:
    config = _config(args)
    if config is None:
        Path(args.file).write_text(json.dumps(spans_to_otlp_json(spans, telemetry_resource(None, args.service_name)), indent=2) + "\n", encoding="utf-8")
        print(f"wrote {len(spans)} span(s) of {what} to {args.file}")
        return
    exporter = otlp_exporter(config, on_warning=lambda message: print(message, file=sys.stderr), max_queue_size=max(2048, len(spans)),
                             schedule_delay_ms=0)
    assert exporter is not None
    exporter.export(spans)
    exporter.shutdown()
    stats = exporter.stats()
    if stats["dropped"]:
        raise RuntimeError(f"{stats['dropped']} of {len(spans)} span(s) could not be sent")
    print(f"sent {stats['exported']} span(s) of {what}")


def _export(args: argparse.Namespace) -> int:
    try:
        document = _read_json(args.workflow)
        workflow = document["workflow"] if "workflow" in document and "activities" not in document else document
        events = [json.loads(line) for line in Path(args.journal).read_text(encoding="utf-8").split("\n") if line.strip()]
        runs: dict[str, list[dict[str, Any]]] = {}
        for event in events:
            runs.setdefault(event["run_id"], []).append(event)
        mine = {run_id: e for run_id, e in runs.items() if e and e[0].get("workflow_id") == workflow["id"]}
        if not mine:
            raise ValueError(f"The journal holds no run of workflow {workflow['id']}")
        spans = [span for e in mine.values() for span in run_spans(workflow, e, _payloads(args))]
        _deliver(spans, args, f"run {next(iter(mine))}" if len(mine) == 1 else f"{len(mine)} runs")
        return 0
    except Exception as error:
        print(f"Error: {error}", file=sys.stderr)
        return 1


def _portfolio(args: argparse.Namespace) -> dict[str, Any]:
    if args.portfolio:
        return _read_json(args.portfolio)
    from awa.runtime.runtime_host import open_runtime_directory
    with open_runtime_directory(args.dir) as runtime:
        return runtime.export_portfolio()


def _journeys(args: argparse.Namespace) -> int:
    try:
        record = _portfolio(args)
        workflows = {w["id"]: w for w in record.get("workflows") or []}
        payloads = _payloads(args)
        spans: list[TelemetrySpan] = []
        instances = runs = 0
        for journey in record.get("journeys") or []:
            for item in journey.get("instances") or []:
                instances += 1
                spans.extend(journey_spans(item["instance"]["events"], payloads))
                for run in item.get("runs") or []:
                    if run.get("events"):
                        runs += 1
                        spans.extend(run_spans(workflows.get(run["workflow_id"]), run["events"], payloads))
        _deliver(spans, args, f"{instances} journey instance(s) and {runs} run(s)")
        return 0
    except Exception as error:
        print(f"Error: {error}", file=sys.stderr)
        return 1


def _measures(args: argparse.Namespace) -> int:
    try:
        report = compute_measures(_portfolio(args), {"from": args.from_instant, "to": args.to_instant})
        gauges = measures_to_gauges(report, MEASURES)
        points = sum(len(g["points"]) for g in gauges)
        config = _config(args)
        if config is None:
            Path(args.file).write_text(json.dumps(gauges_to_otlp_json(gauges, report, telemetry_resource(None, args.service_name)), indent=2) + "\n",
                                       encoding="utf-8")
            print(f"wrote {len(gauges)} gauge(s), {points} data point(s), to {args.file}")
            return 0
        exporter = otlp_exporter(config, on_warning=lambda message: print(message, file=sys.stderr))
        assert exporter is not None
        if not exporter.export_metrics(gauges, report):
            raise RuntimeError("The measures could not be sent")
        print(f"sent {len(gauges)} gauge(s), {points} data point(s)")
        return 0
    except Exception as error:
        print(f"Error: {error}", file=sys.stderr)
        return 1


def _destination(parser: argparse.ArgumentParser) -> None:
    parser.add_argument("--endpoint", help="Send OTLP over HTTP to this endpoint (/v1/traces or /v1/metrics is appended unless present)")
    parser.add_argument("--file", help="Write OTLP JSON to this file instead of sending it")
    parser.add_argument("--protocol", help="http/protobuf (default) or http/json")
    parser.add_argument("--header", action="append", help="A request header, key=value; may be repeated")
    parser.add_argument("--service-name", dest="service_name", help="The service.name of the resource")
    parser.add_argument("--payloads", action="store_true", help="Put inputs, outputs and tool arguments on spans, as the journal holds them (26.6)")


def add_parser(subparsers: Any) -> None:
    parser = subparsers.add_parser("telemetry", help="The record of runs and journeys as OpenTelemetry traces and metrics (specification 26)")
    commands = parser.add_subparsers(dest="telemetry_command", required=True)

    export = commands.add_parser("export", help="Export the run(s) recorded in a journal as OpenTelemetry traces")
    export.add_argument("workflow", help="Path to the .awa.json file")
    export.add_argument("journal", help="Path to the journal (.jsonl)")
    _destination(export)
    export.set_defaults(handler=_export)

    for name, help_text, handler in (
        ("journeys", "Export every journey instance, and every run done for one, as OpenTelemetry traces", _journeys),
        ("measures", "Send the measures of journeys and workflows as OpenTelemetry gauges (26.12)", _measures),
    ):
        sub = commands.add_parser(name, help=help_text)
        sub.add_argument("--dir", default=".awa", help="The runtime directory (default: .awa)")
        sub.add_argument("--portfolio", help='Read a portfolio exported with "awa journey export" instead of a runtime directory')
        if name == "measures":
            sub.add_argument("--from", dest="from_instant", help="Keep what started at or after this instant")
            sub.add_argument("--to", dest="to_instant", help="Keep what started before this instant")
        _destination(sub)
        sub.set_defaults(handler=handler)
