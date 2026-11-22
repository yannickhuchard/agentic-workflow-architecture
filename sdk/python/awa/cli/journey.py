"""
awa journey: journeys that outlive the command that touches them. Every
subcommand opens the runtime directory, does one thing, and leaves the state on
disk for the next (specification 19.10).
"""

import argparse
import json
import sys
from pathlib import Path
from typing import Any

from awa.runtime.business_event import business_event
from awa.runtime.journey import time_ms
from awa.runtime.runtime_host import AwaRuntime, add_definition, is_journey_document, open_runtime_directory, simulated_actors


def _read_json(file: str) -> Any:
    return json.loads(Path(file).read_text(encoding="utf-8"))


def _open(args: argparse.Namespace) -> AwaRuntime:
    engine: dict[str, Any] = {}
    if getattr(args, "simulate", False):
        outputs = _read_json(args.outputs) if getattr(args, "outputs", None) else {}
        engine = {"simulate": True, "actors": simulated_actors(outputs)}
    return open_runtime_directory(args.dir, engine=engine)


def _line(instance: dict[str, Any], journey: str) -> str:
    state = "stalled" if instance["stalled"] and instance["status"] == "active" else instance["status"]
    mood = "" if instance.get("sentiment") is None else f"mood {instance['sentiment']}"
    return f"{instance['subject_key']:<16} {journey:<20} {state:<10} stage {instance['stage_id']:<14} {mood}  {instance['id']}"


def _add(args: argparse.Namespace) -> None:
    documents = [_read_json(file) for file in args.files]
    # Workflows first, so that a journey added in the same command finds them
    for document in sorted(documents, key=is_journey_document):
        added = add_definition(args.dir, document)
        print(f'added {added["kind"]} "{added["name"]}" ({added["id"]})')
    _open(args).close()  # checks that every journey finds its workflows


def _publish(args: argparse.Namespace) -> None:
    with _open(args) as runtime:
        result = runtime.publish(business_event(args.type, json.loads(args.data), source=args.source, id=args.id))
        if not result["accepted"]:
            print("already taken in: nothing done")
            return
        print(f'resumed {len(result["resumed_runs"])} run(s), started {len(result["started_runs"])}, '
              f'concerned {len(result["journeys"])} journey(s)')
        names = {j.id: j.name for j in runtime.list_journeys()}
        for id in result["journeys"]:
            instance = runtime.get_journey_instance(id)
            if instance:
                print(_line(instance, names.get(instance["journey_id"], "")))


def _tick(args: argparse.Namespace) -> None:
    with _open(args) as runtime:
        result = runtime.tick(time_ms(args.at) if args.at else None)
        print(f'{len(result["timed_out_runs"])} wait(s) timed out, {len(result["stalled_journeys"])} journey(s) newly stalled')


def _resume(args: argparse.Namespace) -> None:
    with _open(args) as runtime:
        print("resumed" if runtime.resume(args.run_id, args.token_id, json.loads(args.data)) else "no such waiting task")


def _list(args: argparse.Namespace) -> None:
    with _open(args) as runtime:
        names = {j.id: j.name for j in runtime.list_journeys()}
        instances = [i for i in runtime.list_journey_instances() if not args.stalled or (i["stalled"] and i["status"] == "active")]
        if not instances:
            print("no journeys")
        for instance in instances:
            print(_line(instance, names.get(instance["journey_id"], "")))


def _show(args: argparse.Namespace) -> None:
    with _open(args) as runtime:
        instances = sorted((i for i in runtime.list_journey_instances() if args.subject in (i["subject_key"], i["id"])),
                           key=lambda i: i["started_at"])
        if not instances:
            raise ValueError(f'No journey for "{args.subject}"')
        if args.json:
            print(json.dumps([runtime.export_journey(i["id"]) for i in instances], indent=2))
            return
        names = {j.id: j.name for j in runtime.list_journeys()}
        for instance in instances:
            stalled = " (stalled)" if instance["stalled"] and instance["status"] == "active" else ""
            print(f'\n{names[instance["journey_id"]]}: {instance["status"]}{stalled}, '
                  f'goals reached: {", ".join(instance["goals_reached"]) or "none"}')
            for event in instance["events"]:
                data = event["data"]
                if event["type"] == "journey.sentiment_changed":
                    reason = f': {data["reason"]}' if data.get("reason") else ""
                    text = f'{data.get("previous")} -> {data.get("value")} ({data.get("basis")}{reason})'
                else:
                    what = next((data[k] for k in ("name", "stage_name", "workflow_name", "goal_name", "reason") if data.get(k) is not None), "")
                    text = f'{what}{" " + str(data["status"]) if data.get("status") else ""}'
                print(f'  {event["time"][:16].replace("T", " ")}  {event["type"].replace("journey.", ""):<18} {text}')


def _analytics(args: argparse.Namespace) -> None:
    with _open(args) as runtime:
        for journey in runtime.list_journeys():
            a = runtime.analytics(journey.id)
            print(f'\n{journey.name}: {a["total"]} journeys, {a["completed"]} completed, {a["active"]} active, {a["abandoned"]} abandoned')
            for s in a["stages"]:
                print(f'  {s["stage_name"]:<24} entered {s["entered"]}, moved on {s["completed"]}, here {s["active"]}, '
                      f'stalled {s["stalled"]}, left {s["abandoned"]}')
            for goal, n in a["goals"].items():
                print(f'  goal {goal}: {n} of {a["total"]}')
        names = {j.id: j.name for j in runtime.list_journeys()}
        for t in runtime.transitions():
            print(f'\n{names.get(t["from"])} -> {names.get(t["to"])}: {t["count"]}')


def _export(args: argparse.Namespace) -> None:
    with _open(args) as runtime:
        text = json.dumps(runtime.export_portfolio(), separators=(",", ":"))
    if args.output:
        Path(args.output).write_text(text, encoding="utf-8")
        print(f"wrote {args.output}")
    else:
        print(text)


def add_parser(subparsers: Any) -> None:
    parser = subparsers.add_parser("journey", help="Run and inspect journeys kept in a runtime directory")
    commands = parser.add_subparsers(dest="journey_command", required=True)

    def command(name: str, action: Any, help: str, engine: bool = False) -> argparse.ArgumentParser:
        sub = commands.add_parser(name, help=help)
        sub.add_argument("--dir", default=".awa", help="The runtime directory (default: .awa)")
        if engine:
            sub.add_argument("-s", "--simulate", action="store_true", help="Simulate activities instead of calling models and tools")
            sub.add_argument("--outputs", help="With --simulate: JSON file giving what each activity returns, by activity name")
        sub.set_defaults(handler=lambda args: _guarded(action, args))
        return sub

    add = command("add", _add, "Add workflows and journeys to the runtime directory")
    add.add_argument("files", nargs="+", help="Workflow and journey JSON files")

    publish = command("publish", _publish, "Take in a business event: it wakes waiting runs, starts journeys and moves them on", engine=True)
    publish.add_argument("type", help="The event type, e.g. claim.submitted")
    publish.add_argument("-d", "--data", default="{}", help="The event data, as a JSON object")
    publish.add_argument("--source", default="/cli", help="Who produced the event")
    publish.add_argument("--id", help="The event id. Publishing the same id twice has no further effect")

    tick = command("tick", _tick, "Let time pass: deadlines that have run out take effect and journeys that have "
                                  "outstayed a stage are marked stalled", engine=True)
    tick.add_argument("--at", help="Act as if it were this time (ISO 8601). Default: now")

    resume = command("resume", _resume, "Complete a task a run is waiting on a person for", engine=True)
    resume.add_argument("run_id")
    resume.add_argument("token_id")
    resume.add_argument("-d", "--data", default="{}", help="What the person decided, as a JSON object")

    listing = command("list", _list, "List journey instances")
    listing.add_argument("--stalled", action="store_true", help="Only those that need someone to act")

    show = command("show", _show, "The record of a subject's journeys, in order: subject key or instance id")
    show.add_argument("subject")
    show.add_argument("--json", action="store_true", help="Write the full record as JSON")

    command("analytics", _analytics, "The funnel of each journey, and how subjects move between journeys")

    export = command("export", _export, "Everything recorded, in one file: what tools/visualization/journey.html loads")
    export.add_argument("-o", "--output", help="Write to this file instead of standard output")


def _guarded(action: Any, args: argparse.Namespace) -> int:
    try:
        action(args)
        return 0
    except Exception as error:
        print(f"Error: {error}", file=sys.stderr)
        return 1
