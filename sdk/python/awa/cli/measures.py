"""
awa measures: the measures of journeys and workflows (specification section 21),
computed from what was recorded in a runtime directory or in an exported portfolio.
"""

import argparse
import json
import math
import sys
from pathlib import Path
from typing import Any

from awa.runtime.kpi import MEASURES, compute_measures, measures_to_openmetrics
from awa.runtime.runtime_host import open_runtime_directory

_BY_ID = {m["id"]: m for m in MEASURES}


def _duration(ms: float) -> str:
    if ms < 1000:
        return f"{round(ms)} ms"
    if ms < 90_000:
        return f"{round(ms / 1000)} s"
    if ms < 90 * 60_000:
        return f"{round(ms / 60_000)} min"
    if ms < 48 * 3_600_000:
        return f"{ms / 3_600_000:.1f} h"
    return f"{ms / 86_400_000:.1f} days"


def format_measure(id: str, measure: dict[str, Any], currency: str | None) -> str:
    """A measure as a person reads it, with what it was computed over when that is few"""
    value = measure["value"]
    if value is None:
        return "no value"
    unit = _BY_ID.get(id, {}).get("unit")
    if unit == "ratio":
        few = f" (of {measure['n']})" if measure["n"] < 10 else ""
        return f"{math.floor(value * 100 + 0.5)}%{few}"
    if unit == "ms":
        return _duration(value)
    if unit == "currency":
        return f"{currency or ''} {value:.{4 if value < 1 else 2}f}".strip()
    if unit == "score":
        return ("+" if value > 0 else "") + f"{value:.2f}"
    return str(value) if isinstance(value, int) else f"{value:.2f}"


def _print(report: dict[str, Any]) -> None:
    def row(id: str, measure: dict[str, Any]) -> str:
        return f"  {_BY_ID.get(id, {}).get('name', id):<38} {format_measure(id, measure, report['currency'])}"

    period = report["period"]
    print(f"Measures as of {report['as_of']}" + (f", from {period['from']} to {period['to']}" if period["from"] else ""))
    for j in report["journeys"]:
        print(f"\nJourney: {j['name']}")
        for id, measure in j["measures"].items():
            print(row(id, measure))
        for s in j["stages"]:
            m = s["measures"]
            print(f"    {s['name']:<26} entered {m['stage.entered']['value']}, "
                  f"moved on {format_measure('stage.conversion', m['stage.conversion'], None)}, "
                  f"median {format_measure('stage.duration_median_ms', m['stage.duration_median_ms'], None)}, "
                  f"stalled now {m['stage.stalled_now']['value']}" + (f", owner {s['owner']}" if s.get("owner") else ""))
    for w in report["workflows"]:
        print(f"\nWorkflow: {w['name']}")
        for id, measure in w["measures"].items():
            print(row(id, measure))
    if report["attention"]:
        print("\nNeeds someone now")
        for a in report["attention"]:
            owner = f", owner {a['owner']}" if a.get("owner") else ", no owner named"
            print(f"  {a.get('subject_name') or a['subject_key']}: {a['journey_name']}, stalled in \"{a['stage_name']}\" "
                  f"for {_duration(a['waiting_ms'] or 0)}{owner}: {a['reason']}")


def _run(args: argparse.Namespace) -> int:
    try:
        if args.list:
            for m in MEASURES:
                print(f"{m['id']:<34} {m['unit']:<9} {m['definition']}")
            return 0
        if args.file:
            record = json.loads(Path(args.file).read_text(encoding="utf-8"))
        else:
            with open_runtime_directory(args.dir) as runtime:
                record = runtime.export_portfolio()
        report = compute_measures(record, {
            "from": args.from_instant, "to": args.to_instant, "journey_id": args.journey, "workflow_id": args.workflow})
        if args.openmetrics:
            sys.stdout.write(measures_to_openmetrics(report))
        elif args.json:
            print(json.dumps(report, indent=2))
        else:
            _print(report)
        return 0
    except Exception as error:
        print(f"Error: {error}", file=sys.stderr)
        return 1


def add_parser(subparsers: Any) -> None:
    parser = subparsers.add_parser(
        "measures", help="The measures of journeys and workflows (specification section 21), computed from what was recorded")
    parser.add_argument("--dir", default=".awa", help="The runtime directory (default: .awa)")
    parser.add_argument("--file", help='Read a portfolio exported with "awa journey export" instead of a runtime directory')
    parser.add_argument("--from", dest="from_instant", help="Keep what started at or after this instant")
    parser.add_argument("--to", dest="to_instant", help="Keep what started before this instant")
    parser.add_argument("--journey", help="Only this journey (its id)")
    parser.add_argument("--workflow", help="Only this workflow (its id)")
    parser.add_argument("--json", action="store_true", help="Print the report as JSON")
    parser.add_argument("--openmetrics", action="store_true", help="Print the measures in the OpenMetrics text format")
    parser.add_argument("--list", action="store_true", help="List the measures and their definitions")
    parser.set_defaults(handler=_run)
