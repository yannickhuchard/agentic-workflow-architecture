"""
awa evidence: an evidence report computed from journals and journey records
(specification section 32). Evidence a deployer can use; not a certification of compliance.
"""

import argparse
import json
import sys
from pathlib import Path
from typing import Any

from awa.runtime.evidence import compute_evidence, render_evidence_html, render_evidence_markdown
from awa.runtime.evidence_sources import read_evidence_input
from awa.runtime.journey import time_ms


def _run(args: argparse.Namespace) -> int:
    try:
        if args.format not in ("json", "md", "html"):
            raise ValueError("--format must be json, md or html")
        for instant in (args.from_instant, args.to_instant, args.as_of):
            if instant:
                try:
                    time_ms(instant)
                except ValueError:
                    raise ValueError(f"Not an instant: {instant}") from None
        record = read_evidence_input(args.sources)
        if args.as_of:
            record["as_of"] = args.as_of
        workflow_ids = None
        if args.workflow:
            # A workflow may be named by id or by name
            names = {w.get("name"): w["id"] for w in record.get("workflows") or []}
            for r in [*(record.get("runs") or []), *(r for j in record.get("journeys") or [] for i in j["instances"] for r in i["runs"])]:
                started = next((e for e in r.get("events") or [] if e["type"] == "run.started"), None)
                if started and (started.get("data") or {}).get("workflow_name"):
                    names[started["data"]["workflow_name"]] = r["workflow_id"]
            workflow_ids = [names.get(w, w) for w in args.workflow]
        report = compute_evidence(record, {"from": args.from_instant, "to": args.to_instant, "workflow_ids": workflow_ids})
        text = json.dumps(report, indent=2) + "\n" if args.format == "json" else render_evidence_html(report) if args.format == "html" else render_evidence_markdown(report)
        if args.output:
            Path(args.output).write_text(text, encoding="utf-8")
            statements = sum(len(p["statements"]) for p in report["parts"])
            print(f"Evidence report written to {args.output}: {report['parts'][0]['summary']['runs']} run(s), {statements} statement(s)", file=sys.stderr)
        else:
            sys.stdout.write(text)
        return 0
    except Exception as error:
        print(f"Error: {error}", file=sys.stderr)
        return 1


def add_parser(subparsers: Any) -> None:
    parser = subparsers.add_parser(
        "evidence", help="An evidence report computed from journals and journey records (specification section 32). "
                         "Evidence a deployer can use; not a certification of compliance")
    parser.add_argument("sources", nargs="+", help="Runtime directories, directories of journals, journal files (.jsonl) or portfolios exported by a host (.json)")
    parser.add_argument("--from", dest="from_instant", help="Keep runs and journeys started at or after this instant")
    parser.add_argument("--to", dest="to_instant", help="Keep runs and journeys started before this instant")
    parser.add_argument("--workflow", nargs="+", help="Keep only runs of these workflows, by id or name")
    parser.add_argument("--as-of", dest="as_of", help="The instant the report is made as of, for a report that can be made again identically")
    parser.add_argument("--format", default="md", help="json, md or html (default: md)")
    parser.add_argument("-o", "--output", help="Write the report to this file instead of standard output")
    parser.set_defaults(handler=_run)
