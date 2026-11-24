"""
awa migrate: move runs that are at rest to another version of their workflow
(specification section 25). Works on a runtime directory, or on the shared
runtime store named by --store or AWA_RUNTIME_STORE, as `awa journey` does.

  awa migrate check <workflow_id>   how each position of the older versions fares, and which runs can move
  awa migrate plan <run_id>         what moving the run would do (a dry run); changes nothing
  awa migrate apply <run_id...>     move the runs

plan and apply exit with status 2 when a migration is refused.
"""

import argparse
import json
import os
import sys
from pathlib import Path
from typing import Any

from awa.runtime.runtime_host import AwaRuntime, open_runtime_directory


def _open(args: argparse.Namespace) -> AwaRuntime:
    url = getattr(args, "store", None) or os.environ.get("AWA_RUNTIME_STORE") or None
    if not url:
        return open_runtime_directory(args.dir)
    from awa.runtime.postgres_store import open_runtime_store
    return open_runtime_store(url)


def _plan(args: argparse.Namespace) -> dict[str, Any]:
    """The plan: the file --plan names (a JSON object, section 25.3), with --to over it"""
    plan = json.loads(Path(args.plan).read_text(encoding="utf-8")) if args.plan else {}
    if not isinstance(plan, dict):
        raise ValueError(f"{args.plan} does not hold a migration plan (a JSON object)")
    if args.to:
        plan["to_version"] = args.to
    return plan


def _print_result(result: dict[str, Any]) -> None:
    verb = "moved" if result["applied"] else "refused" if result["refusals"] else "would move"
    line = f"run {result['run_id']}: {verb}"
    if result.get("from_version"):
        line += f" from {result['from_version']}"
    if result.get("to_version"):
        line += f" to {result['to_version']}"
    if result.get("status") and not result["refusals"]:
        line += f" ({result['status']})"
    print(line)
    for r in result["refusals"]:
        print(f"  refused ({r['code']}): {r['message']}")
    for t in result["tokens"]:
        if t["wait"]:
            print(f"  token {t['token_id']}: {t.get('from_node_name') or t['from_node_id']} -> {t.get('to_node_name') or t['to_node_id']}, "
                  f"waits for {t['wait']}, {t['outcome']}")
    for c in result["data_changes"]:
        print(f"  data {c['path']}: " + ("removed" if c["change"] == "removed" else f"set to {json.dumps(c.get('value'))}"))


def _print_check(check: dict[str, Any]) -> None:
    if not check["comparisons"]:
        print(f"No run of workflow {check['workflow_id']} is on a version other than {check['to_version']}.")
    for c in check["comparisons"]:
        print(f"{c['from_version']} -> {c['to_version']}: " + ("every position is compatible" if c["automatic"] else "some positions need a decision"))
        for p in c["positions"]:
            if p["class"] == "compatible":
                detail = f"-> {p['to_node_name']} ({p['outcome']})"
            elif p["class"] == "needs_mapping":
                detail = "map it to one of: " + ", ".join(n["node_name"] for n in p.get("candidates") or [])
            else:
                detail = f"{p['reason']}; only a restart can move a run here"
            print(f"  {p['node_name']:<24} waits for {p['wait']:<6} {p['class']:<14} {detail}")
    for r in check["runs"]:
        state = "can be moved" if r["migratable"] else "cannot be moved: " + ", ".join(x["code"] for x in r["refusals"])
        print(f"run {r['run_id']} ({r['version']}, {r['status']}): {state}")


def _check(args: argparse.Namespace) -> int:
    with _open(args) as runtime:
        plan = _plan(args)
        check = runtime.check_migration(args.workflow_id, from_version=args.from_version, to_version=plan.get("to_version"), plan=plan)
    if args.json:
        print(json.dumps(check, indent=2))
    else:
        _print_check(check)
    return 0


def _dry_run(args: argparse.Namespace) -> int:
    with _open(args) as runtime:
        result = runtime.migrate(args.run_id, _plan(args), dry_run=True)
    if args.json:
        print(json.dumps(result, indent=2))
    else:
        _print_result(result)
    return 2 if result["refusals"] else 0


def _apply(args: argparse.Namespace) -> int:
    with _open(args) as runtime:
        plan = _plan(args)
        results = [runtime.migrate(run_id, plan) for run_id in args.run_ids]
    if args.json:
        print(json.dumps(results[0] if len(results) == 1 else results, indent=2))
    else:
        for result in results:
            _print_result(result)
    return 2 if any(r["refusals"] for r in results) else 0


def _guarded(action: Any, args: argparse.Namespace) -> int:
    try:
        return action(args)
    except Exception as error:
        print(f"Error: {error}", file=sys.stderr)
        return 1


def add_parser(subparsers: Any) -> None:
    parser = subparsers.add_parser("migrate", help="Move runs that are at rest to another version of their workflow (specification section 25)")
    commands = parser.add_subparsers(dest="migrate_command", required=True)

    def command(name: str, action: Any, help: str) -> argparse.ArgumentParser:
        sub = commands.add_parser(name, help=help)
        sub.add_argument("--dir", default=".awa", help="The runtime directory (default: .awa)")
        sub.add_argument("--store", help="A PostgreSQL runtime store shared by several hosts, as a URL "
                                         "(default: $AWA_RUNTIME_STORE). When given, --dir is not used")
        sub.add_argument("--plan", help="A migration plan: a JSON object with to_version, nodes (old node id -> new node id), restart and data")
        sub.add_argument("--to", help="The version to move to (default: the plan's to_version, or the newest registered)")
        sub.add_argument("--json", action="store_true", help="Write the result as JSON")
        sub.set_defaults(handler=lambda args: _guarded(action, args))
        return sub

    check = command("check", _check, "Compare the versions with live runs against the version to move to, position by position, "
                                     "and say which runs can move")
    check.add_argument("workflow_id")
    check.add_argument("--from", dest="from_version", help="Only runs on this version")
    command("plan", _dry_run, "What moving the run would do: a dry run that changes nothing").add_argument("run_id")
    command("apply", _apply, "Move the runs, each as one change recorded in its journal as run.migrated").add_argument("run_ids", nargs="+")
