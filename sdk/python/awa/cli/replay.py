"""
awa replay: counterfactual replay (specification section 20). Runs a recorded
run again under a changed workflow, with everything else held as recorded, and
reports the difference. Exits with status 2 when the candidate regresses, so a
set of recorded journals can serve as a regression suite.

This command replays the recorded outputs of AI agents and model decisions
too (`ai: "recorded"`): it tests a changed contract, criterion, table or edge
and calls no model. A live replay needs the actor that performs the AI agents,
which is given to `awa.runtime.counterfactual.counterfactual_replay` in code.
"""

import argparse
import json
import sys
from pathlib import Path
from typing import Any

from awa.runtime.counterfactual import counterfactual_replay, render_counterfactual_report
from awa.runtime.journal import parse_journal
from awa.types import Workflow
from awa.validator import validate_workflow_integrity


def _workflow(file: str) -> Workflow:
    document = json.loads(Path(file).read_text(encoding="utf-8"))
    inner = document["workflow"] if "workflow" in document and "activities" not in document else document
    workflow = Workflow.model_validate(inner)
    integrity = validate_workflow_integrity(workflow)
    if not integrity.valid:
        raise ValueError(f"{file} is not a valid workflow: " + "; ".join(e.message for e in integrity.errors))
    return workflow


def _run(args: argparse.Namespace) -> int:
    try:
        workflow = _workflow(args.workflow)
        events = [e for e in parse_journal(Path(args.journal).read_text(encoding="utf-8"))
                  if e.get("workflow_id") == str(workflow.id)]
        runs = list(dict.fromkeys(e["run_id"] for e in events))
        if not runs:
            raise ValueError(f"The journal holds no run of workflow {workflow.id}")
        # A file that holds several runs is replayed from its last
        baseline = [e for e in events if e["run_id"] == runs[-1]]
        candidate = _workflow(args.candidate) if args.candidate else None

        replay = counterfactual_replay(workflow, baseline, candidate=candidate, ai="recorded")

        text = json.dumps(replay.report, indent=2) if args.json else render_counterfactual_report(replay.report)
        if args.output:
            Path(args.output).write_text(text + "\n", encoding="utf-8")
            print(f"Report written to {args.output}", file=sys.stderr)
        else:
            sys.stdout.write(text + "\n")
        if args.journal_out:
            Path(args.journal_out).write_text(
                "".join(json.dumps(event, ensure_ascii=False) + "\n" for event in replay.events), encoding="utf-8")
    except Exception as error:
        print(f"Error: {error}", file=sys.stderr)
        return 1
    # A regression is a failure, so the command can gate a change
    return 2 if replay.report["regressions"] else 0


def add_parser(subparsers: Any) -> None:
    parser = subparsers.add_parser(
        "replay",
        help="Counterfactual replay (specification section 20): run a recorded run again under a changed workflow, "
             "holding everything else as recorded, and compare")
    parser.add_argument("workflow", help="The workflow the journal was recorded with (.awa.json)")
    parser.add_argument("journal", help="The recorded run (.jsonl)")
    parser.add_argument("--candidate", help="A changed version of the workflow to run instead "
                                            "(keep node ids for nodes that are the same)")
    parser.add_argument("-o", "--output", help="Write the report to this file instead of standard output")
    parser.add_argument("--json", action="store_true", help="Write the report as JSON instead of Markdown")
    parser.add_argument("--journal-out", help="Also write the candidate run's journal to this .jsonl file")
    parser.set_defaults(handler=_run)
