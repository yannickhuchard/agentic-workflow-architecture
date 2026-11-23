"""
awa knowledge: build and review the knowledge distilled from run journals
(specification section 15), kept in one JSON file (--kb, default knowledge.json).

Export to and import from the Open Knowledge Format (OKF), which the
TypeScript SDK's `awa knowledge export` and `import` provide, are not part of
the Python SDK.
"""

import argparse
import json
import sys
from pathlib import Path
from typing import Any, Callable

from awa.cli.run import read_workflow
from awa.runtime.journal import parse_journal
from awa.runtime.knowledge import KnowledgeBase

DEFAULT_KB = "knowledge.json"


def _guarded(action: Callable[[argparse.Namespace], None]) -> Callable[[argparse.Namespace], int]:
    def run(args: argparse.Namespace) -> int:
        try:
            action(args)
            return 0
        except Exception as error:
            message = error.args[0] if isinstance(error, KeyError) and error.args else error
            print(f"Error: {message}", file=sys.stderr)
            return 1
    return run


def _ingest(args: argparse.Namespace) -> None:
    workflow = read_workflow(args.workflow)
    kb = KnowledgeBase.load(args.kb)
    for file in args.journal:
        events = [e for e in parse_journal(Path(file).read_text(encoding="utf-8"))
                  if e.get("workflow_id") == str(workflow.id)]
        for run_id in dict.fromkeys(e["run_id"] for e in events):
            result = kb.ingest(workflow, [e for e in events if e["run_id"] == run_id])
            print(f"run {run_id}: already ingested" if result["skipped"]
                  else f"run {run_id}: {len(result['created'])} created, {len(result['updated'])} updated")
    kb.save(args.kb)


def _list(args: argparse.Namespace) -> None:
    kb = KnowledgeBase.load(args.kb)
    for entry in kb.list(status=args.status):
        print(f"{entry['status']:<10} {entry['observations']:>3} run(s)  {entry['id']}\n{' ' * 23}{entry['title']}")


def _review(args: argparse.Namespace) -> None:
    kb = KnowledgeBase.load(args.kb)
    targets = [e["id"] for e in kb.list(status="draft")] if "all" in args.id else args.id
    for id in targets:
        kb.review(id, args.by)
    kb.save(args.kb)
    print(f"{len(targets)} entr{'y' if len(targets) == 1 else 'ies'} reviewed by {args.by}")


def _deprecate(args: argparse.Namespace) -> None:
    kb = KnowledgeBase.load(args.kb)
    kb.deprecate(args.id, args.superseded_by)
    kb.save(args.kb)
    print(f"{args.id} deprecated")


def add_parser(subparsers: Any) -> None:
    parser = subparsers.add_parser(
        "knowledge", help="Build and review knowledge distilled from run journals",
        description="Build and review knowledge distilled from run journals. Export to and import from the "
                    "Open Knowledge Format (OKF), available in the TypeScript SDK, are not part of the Python SDK.")
    commands = parser.add_subparsers(dest="knowledge_command", metavar="command")
    parser.set_defaults(handler=lambda args: (parser.print_help(), 0)[1])

    def kb_option(sub: argparse.ArgumentParser) -> None:
        sub.add_argument("--kb", default=DEFAULT_KB, metavar="FILE", help=f"Knowledge base file (default: {DEFAULT_KB})")

    ingest = commands.add_parser(
        "ingest", help="Distil the journal of a run into the knowledge base. Safe to repeat: a run is counted once")
    ingest.add_argument("workflow", help="Path to the .awa.json file")
    ingest.add_argument("journal", nargs="+", help="One or more run journals (.jsonl)")
    kb_option(ingest)
    ingest.set_defaults(handler=_guarded(_ingest))

    listing = commands.add_parser("list", help="List knowledge entries")
    kb_option(listing)
    listing.add_argument("--status", choices=("draft", "reviewed", "deprecated"),
                         help="Only entries with this status")
    listing.set_defaults(handler=_guarded(_list))

    review = commands.add_parser(
        "review", help="Mark entries as reviewed by a person. Only reviewed entries are given to actors by default")
    review.add_argument("id", nargs="+", help='Entry ids, or "all" for every draft')
    review.add_argument("--by", required=True, metavar="REVIEWER", help="Who reviewed them")
    kb_option(review)
    review.set_defaults(handler=_guarded(_review))

    deprecate = commands.add_parser("deprecate", help="Mark an entry as no longer current")
    deprecate.add_argument("id", help="Entry id")
    deprecate.add_argument("--superseded-by", metavar="ID", help="The entry that replaces it")
    kb_option(deprecate)
    deprecate.set_defaults(handler=_guarded(_deprecate))
