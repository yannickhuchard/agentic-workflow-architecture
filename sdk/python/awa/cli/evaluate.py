"""
awa eval: evaluation from journals (specification section 33).

  awa eval build <journals...> -o dataset.jsonl
  awa eval run <workflow> dataset.jsonl [--candidate changed.awa.json] [--providers ollama]

`eval run` performs each case again under the candidate's AI agents and exits with
status 2 when the candidate loses a case the recording had accepted. This SDK's
providers for the command line are OpenAI-compatible servers (ollama); other
providers, and function providers for tests, are given to
awa.runtime.evaluation.evaluate_dataset in code.
"""

import argparse
import json
import os
import sys
from pathlib import Path
from typing import Any

from awa.runtime.evaluation import build_dataset, dataset_to_jsonl, evaluate_dataset, parse_dataset, render_evaluation_report
from awa.runtime.evidence_sources import read_journals
from awa.runtime.models import ollama_provider, tier_fallbacks
from awa.types import Workflow


def _workflow(file: str) -> Workflow:
    document = json.loads(Path(file).read_text(encoding="utf-8"))
    return Workflow.model_validate(document["workflow"] if "workflow" in document and "activities" not in document else document)


def _build(args: argparse.Namespace) -> int:
    try:
        built = build_dataset(read_journals(args.journals))
        Path(args.output).write_text(dataset_to_jsonl(built["cases"]), encoding="utf-8")
        accepted = sum(1 for c in built["cases"] if c["label"] == "accepted")
        print(f"{len(built['cases'])} case(s) written to {args.output}: {accepted} accepted, {len(built['cases']) - accepted} rejected", file=sys.stderr)
        for s in built["skipped"]:
            print(f"  left out: \"{s['activity_name']}\" in run {s['run_id']}: {s['reason']}", file=sys.stderr)
        return 0
    except Exception as error:
        print(f"Error: {error}", file=sys.stderr)
        return 1


def _run(args: argparse.Namespace) -> int:
    try:
        workflow = _workflow(args.workflow)
        candidate = _workflow(args.candidate) if args.candidate else None
        cases = parse_dataset(Path(args.dataset).read_text(encoding="utf-8"))
        names = [n.strip() for n in (args.providers or "").split(",") if n.strip()]
        if not names:
            raise ValueError("An evaluation runs the candidate's AI agents: give --providers")
        providers = []
        for name in names:
            if name == "ollama":
                providers.append(ollama_provider(base_url=os.environ.get("OLLAMA_BASE_URL", "http://localhost:11434/v1")))
            else:
                raise ValueError(f'Unknown provider "{name}". This command offers ollama; give other providers to evaluate_dataset in code')
        report = evaluate_dataset(workflow, cases, candidate=candidate, engine={
            "model_providers": providers, "default_model_provider": providers[0].id, "model_tiers": tier_fallbacks(names), "default_ai_model_id": "tier:balanced"})
        text = json.dumps(report, indent=2) if args.json else render_evaluation_report(report)
        if args.output:
            Path(args.output).write_text(text + "\n", encoding="utf-8")
            print(f"Report written to {args.output}", file=sys.stderr)
        else:
            sys.stdout.write(text + "\n")
        return 2 if report["regressions"] else 0
    except Exception as error:
        print(f"Error: {error}", file=sys.stderr)
        return 1


def add_parser(subparsers: Any) -> None:
    parser = subparsers.add_parser("eval", help="Evaluation from journals (specification section 33): build datasets from recorded runs, and score a candidate against them")
    commands = parser.add_subparsers(dest="eval_command")
    build = commands.add_parser("build", help="Build an evaluation dataset from recorded runs")
    build.add_argument("journals", nargs="+", help="Journal files (.jsonl), or directories holding them")
    build.add_argument("-o", "--output", required=True, help="The dataset to write, one case per line (.jsonl)")
    build.set_defaults(handler=_build)
    run = commands.add_parser("run", help="Perform every case again under a candidate and report pass rates per activity, with the regressions. Exits with 2 on a regression")
    run.add_argument("workflow", help="The workflow the cases were recorded with (.awa.json)")
    run.add_argument("dataset", help='The dataset (.jsonl), from "awa eval build"')
    run.add_argument("--candidate", help="A changed version of the workflow to evaluate (keep activity ids)")
    run.add_argument("-p", "--providers", help="Model providers for the candidate, in order of preference: ollama")
    run.add_argument("-o", "--output", help="Write the report to this file instead of standard output")
    run.add_argument("--json", action="store_true", help="Write the report as JSON instead of Markdown")
    run.set_defaults(handler=_run)
    parser.set_defaults(handler=lambda args: (parser.print_help(), 0)[1])
