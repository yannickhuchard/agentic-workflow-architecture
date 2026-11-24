"""
awa task: the human tasks kept by the TaskService (in the SQLite database named
by AWA_DATABASE_URL, default awa.db), as the reference `awa task` command.
"""

import argparse
import json
import sys
from typing import Any

from awa.runtime.services.task_service import TaskService


def _allowed(task_id: str, action: str, args: argparse.Namespace, subject: str | None = None) -> bool:
    """
    Under the policy of a deployment file, whether the principal named by --as (default: the host) may take the
    action on the task (specification 30.4). Prints the refusal and returns False when it may not.
    """
    if not getattr(args, "deployment", None):
        return True
    from awa.cli.deployment import load_deployment
    from awa.runtime.authorization import HOST_PRINCIPAL, decide, is_enforced, principal_named
    authorization = load_deployment(args.deployment).get("authorization")
    if not is_enforced(authorization):
        return True
    task = TaskService.get(task_id)
    if task is None:
        print(f"Task {task_id} not found.", file=sys.stderr)
        return False
    who = subject if subject is not None else args.as_principal
    principal = principal_named(authorization, who) if who else (authorization.get("host_principal") or HOST_PRINCIPAL)
    decision = decide(authorization, {
        "action": action, "principal": principal, "run": task.inputs or {}, "history": {"performed": []},
        "resource": {"workflow_id": str(task.workflow_id), "activity_id": str(task.activity_id), "activity_name": task.activity_name,
                     "role_id": str(task.role_id), "task_id": str(task.id)},
    })
    if decision["decision"] == "allow":
        return True
    rule = f" (rule {decision['rule']})" if decision.get("rule") else ""
    principal_id = principal["id"]
    print(f"FORBIDDEN: {decision.get('message') or f'{action} is not allowed to {principal_id}'}{rule}", file=sys.stderr)
    return False


def _when(value: Any) -> str:
    return value.strftime("%Y-%m-%d %H:%M:%S") if value else ""


def _table(rows: list[dict[str, str]]) -> str:
    headers = list(rows[0])
    widths = {h: max(len(h), *(len(r[h]) for r in rows)) for h in headers}
    line = lambda values: "  ".join(str(values[h]).ljust(widths[h]) for h in headers).rstrip()  # noqa: E731
    return "\n".join([line({h: h for h in headers}), line({h: "-" * widths[h] for h in headers}), *map(line, rows)])


def _list(args: argparse.Namespace) -> int:
    try:
        tasks = TaskService.list({"status": args.status, "role_id": args.role, "assignee_id": args.assignee})
    except Exception as error:
        print(f"Error listing tasks: {error}", file=sys.stderr)
        return 1
    if not tasks:
        print("No tasks found.")
        return 0
    print(_table([{"ID": str(t.id), "Activity": t.activity_name, "Status": str(t.status), "Priority": str(t.priority),
                   "Created": _when(t.created_at)} for t in tasks]))
    return 0


def _show(args: argparse.Namespace) -> int:
    try:
        task = TaskService.get(args.id)
    except Exception as error:
        print(f"Error fetching task: {error}", file=sys.stderr)
        return 1
    if not task:
        print(f"Task {args.id} not found.", file=sys.stderr)
        return 1
    rule = "-" * 40
    print("Task Details:")
    print(rule)
    print(f"ID:        {task.id}")
    print(f"Activity:  {task.activity_name}")
    print(f"Status:    {task.status}")
    print(f"Priority:  {task.priority}")
    print(f"Queue:     {task.role_id}")
    print(f"Created:   {_when(task.created_at)}")
    if task.assignee_id:
        print(f"Assignee:  {task.assignee_id}")
    if task.description:
        print(f"Desc:      {task.description}")
    print(rule)
    print("Inputs:")
    print(json.dumps(task.inputs, indent=2, default=str))
    if task.outputs:
        print(rule)
        print("Outputs:")
        print(json.dumps(task.outputs, indent=2, default=str))
    return 0


def _found(task_id: str) -> bool:
    if TaskService.get(task_id) is None:
        print(f"Task {task_id} not found.", file=sys.stderr)
        return False
    return True


def _assign(args: argparse.Namespace) -> int:
    # The assignee must be allowed to claim the task; whoever assigns it to someone else, to assign it (30.4)
    if not _allowed(args.id, "claim_task", args, args.user_id):
        return 1
    if args.as_principal != args.user_id and not _allowed(args.id, "assign_task", args):
        return 1
    try:
        task = TaskService.assign(args.id, args.user_id)
    except Exception as error:
        print(f"Error assigning task: {error}", file=sys.stderr)
        return 1
    print(f"Task {args.id} assigned to {args.user_id}")
    print(f"New Status: {task.status}")
    return 0


def _complete(args: argparse.Namespace) -> int:
    outputs: Any = {}
    if args.json_outputs:
        try:
            outputs = json.loads(args.json_outputs)
        except ValueError:
            print("Invalid JSON outputs", file=sys.stderr)
            return 1
        if not isinstance(outputs, dict):
            print("Invalid JSON outputs: a JSON object is required", file=sys.stderr)
            return 1
    if not _allowed(args.id, "complete_task", args):
        return 1
    try:
        if not _found(args.id):
            return 1
        TaskService.complete(args.id, outputs)
    except Exception as error:
        print(f"Error completing task: {error}", file=sys.stderr)
        return 1
    print(f"Task {args.id} completed.")
    return 0


def _reject(args: argparse.Namespace) -> int:
    if not _allowed(args.id, "complete_task", args):
        return 1
    try:
        if not _found(args.id):
            return 1
        TaskService.reject(args.id, args.reason or "")
    except Exception as error:
        print(f"Error rejecting task: {error}", file=sys.stderr)
        return 1
    print(f"Task {args.id} rejected.")
    return 0


def add_parser(subparsers: Any) -> None:
    parser = subparsers.add_parser("task", help="Manage human tasks", description="Manage human tasks")
    commands = parser.add_subparsers(dest="task_command", metavar="command")
    parser.set_defaults(handler=lambda args: (parser.print_help(), 0)[1])

    listing = commands.add_parser("list", help="List tasks")
    listing.add_argument("-s", "--status", default="pending",
                         help="Filter by status (pending, assigned, in_progress, completed, rejected). Default: pending")
    listing.add_argument("-r", "--role", help="Filter by role")
    listing.add_argument("-a", "--assignee", help="Filter by assignee")
    listing.set_defaults(handler=_list)

    show = commands.add_parser("show", help="Show task details")
    show.add_argument("id")
    show.set_defaults(handler=_show)

    assign = commands.add_parser("assign", help="Assign a task to a user")
    assign.add_argument("id")
    assign.add_argument("user_id")
    _principal_options(assign)
    assign.set_defaults(handler=_assign)

    complete = commands.add_parser("complete", help="Complete a task with optional JSON outputs")
    complete.add_argument("id")
    complete.add_argument("json_outputs", nargs="?")
    _principal_options(complete)
    complete.set_defaults(handler=_complete)

    reject = commands.add_parser("reject", help="Reject a task")
    reject.add_argument("id")
    reject.add_argument("reason", nargs="?")
    _principal_options(reject)
    reject.set_defaults(handler=_reject)


def _principal_options(parser: Any) -> None:
    parser.add_argument("--as", dest="as_principal", metavar="PRINCIPAL",
                        help="Act as this principal, by its id in the deployment's authorization.principals. Default: the host")
    parser.add_argument("--deployment", metavar="FILE", help="Deployment file whose authorization policy decides (specification 30)")
