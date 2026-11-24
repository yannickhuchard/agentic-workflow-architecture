"""
Changing a workflow while runs are in flight (specification section 25)

A run is bound to the version of its workflow it started on. A host keeps
running it on that version when a newer one is registered; new runs take the
newest. A run that is at rest (waiting for a person, an event, an agent's
input, a timer or the other branches of a join) can be moved to another
version by an explicit plan: where each token goes, what data changes, and
which waits are withdrawn. The plan is checked in full before anything
changes, and refused with named reasons when it would leave a token nowhere,
or a wait without meaning. Applied, it is one change of the run's state with
one journal event, `run.migrated`.

Everything here is pure: it reads two workflow documents and a run's state and
says what follows. AwaRuntime.migrate applies it to a run it hosts. It follows
src/runtime/migration.ts of the TypeScript SDK.
"""

import copy
import re
from typing import Any

from awa.runtime.expression import ExpressionError, _MISSING, _resolve, evaluate_expression
from awa.types import Workflow

MigrationPlan = dict[str, Any]
MigrationResult = dict[str, Any]

_RESERVED = re.compile(r"(^|\.)_")
_PATH = re.compile(r"^[A-Za-z_$][\w$-]*(\.[A-Za-z_$][\w$-]*)*$")
_LIVE = ("active", "waiting", "joining")
_ENDED = ("completed", "failed", "cancelled")
_WHAT = {"human": "a person", "agent": "an agent's input", "event": "a business event", "timer": "a timer",
         "join": "the other branches of a join"}


def _value(x: Any) -> Any:
    return getattr(x, "value", x)


def _nodes(workflow: Workflow) -> dict[str, dict[str, Any]]:
    """Every node of a workflow by id, in the order activities, events, decision nodes"""
    nodes: dict[str, dict[str, Any]] = {}
    for activity in workflow.activities:
        nodes[str(activity.id)] = {"kind": "activity", "node": activity, "name": activity.name}
    for event in workflow.events or []:
        nodes[str(event.id)] = {"kind": "event", "node": event, "name": event.name}
    for decision in workflow.decision_nodes or []:
        nodes[str(decision.id)] = {"kind": "decision", "node": decision, "name": decision.name}
    return nodes


def _definition(node: dict[str, Any] | None) -> dict[str, Any]:
    return (node["node"].event_definition or {}) if node and node["kind"] == "event" else {}


def _incoming(workflow: Workflow, node_id: str) -> list[Any]:
    return [e for e in workflow.edges if str(e.target_id) == node_id]


def _is_join(workflow: Workflow, node: dict[str, Any] | None, node_id: str) -> bool:
    return bool(node) and node["kind"] in ("activity", "event") and node["node"].join == "all" and len(_incoming(workflow, node_id)) > 1


def _is_waiting_event(node: dict[str, Any] | None) -> bool:
    return bool(node) and node["kind"] == "event" and node["node"].event_type in ("message", "signal") and _definition(node).get("mode") != "publish"


def _over_a2a(workflow: Workflow, activity: Any) -> bool:
    """Whether the activity is performed by an agent reached over A2A (28.1), directly or through its role"""
    if activity.a2a:
        return True
    role = next((r for r in workflow.roles or [] if str(r.id) == str(activity.role_id)), None)
    return bool(role and role.a2a)


def token_wait(workflow: Workflow, token: dict[str, Any]) -> str | None:
    """What a token of a run at rest waits for; None for a token that is in the middle of work"""
    data = token.get("context_data") or {}
    status = token.get("status")
    if status == "waiting":
        return "event" if data.get("_awaiting_event") else "agent" if data.get("_awaiting_agent_input") else "human"
    if status == "joining":
        return "join"
    if status == "active":
        node = _nodes(workflow).get(str(token.get("activity_id")))
        # A token at a timer whose due time is fixed is waiting for time to pass (13.5)
        if node and node["kind"] == "event" and node["node"].event_type == "timer" and data.get(f"_timer_due:{token.get('activity_id')}"):
            return "timer"
    return None


def _wait_problem(wait: str, old: Workflow, from_id: str, new: Workflow, to_id: str, token: dict[str, Any] | None = None) -> str | None:
    """Why a wait would lose its meaning at a node of the new version, or None when it keeps it"""
    source, target = _nodes(old).get(from_id), _nodes(new).get(to_id)
    if not target:
        return f"version {new.version} has no node {to_id}"
    named = f'"{target["name"]}"'
    if wait in ("human", "agent"):
        actor = _value(source["node"].actor_type) if source and source["kind"] == "activity" else ("human" if wait == "human" else "ai_agent")
        what = "task a person was given" if wait == "human" else "agent's request for input"
        if target["kind"] != "activity":
            return f"{named} is not an activity, so the {what} would have nothing to return to"
        if _value(target["node"].actor_type) != actor:
            short = "task a person was given" if wait == "human" else "agent's request"
            return f"{named} is performed by {_value(target['node'].actor_type)}, not {actor}: the {short} would not fit it"
        if wait == "agent" and not _over_a2a(new, target["node"]):
            return f"{named} is not performed by an agent over A2A, which the token waits for"
        return None
    if wait == "event":
        awaited = ((token or {}).get("context_data") or {}).get("_awaiting_event") or {}
        name = awaited.get("name", _definition(source).get("name"))
        key = awaited.get("correlation_key") if token else _definition(source).get("correlation_key")
        if not _is_waiting_event(target):
            return f"{named} does not wait for a business event"
        if source and source["kind"] == "event" and target["node"].event_type != source["node"].event_type:
            return f"{named} is a {target['node'].event_type} event, not a {source['node'].event_type} event"
        if _definition(target).get("name") != name:
            return f'{named} waits for "{_definition(target).get("name")}", not "{name}"'
        target_key = _definition(target).get("correlation_key") if target["node"].event_type == "message" else None
        if (target_key or None) != (key or None):
            on = f'"{target_key}"' if target_key else "nothing"
            not_on = f'"{key}"' if key else "nothing"
            return f"{named} correlates on {on}, not {not_on}"
        return None
    if wait == "timer":
        return None if target["kind"] == "event" and target["node"].event_type == "timer" else f"{named} is not a timer"
    # join
    if not _is_join(new, target, to_id):
        return f"{named} is not a join"
    arrived = ((token or {}).get("context_data") or {}).get("_arrived_edge")
    if arrived and not any(str(e.id) == arrived for e in _incoming(new, to_id)):
        return f"the edge the token arrived by ({arrived}) does not lead to {named}"
    return None


def _set_path(data: dict[str, Any], path: str, value: Any) -> None:
    segments = path.split(".")
    current = data
    for segment in segments[:-1]:
        if not isinstance(current.get(segment), dict):
            current[segment] = {}
        current = current[segment]
    current[segments[-1]] = value


def _remove_path(data: dict[str, Any], path: str) -> bool:
    segments = path.split(".")
    current: Any = data
    for segment in segments[:-1]:
        if not isinstance(current, dict):
            return False
        current = current.get(segment)
    if not isinstance(current, dict) or segments[-1] not in current:
        return False
    del current[segments[-1]]
    return True


def _valid_expression(expression: Any) -> str | None:
    if not isinstance(expression, str):
        return "not text"
    try:
        evaluate_expression(expression, {})
        return None
    except ExpressionError as error:
        return str(error)


def check_assignments(assignments: list[dict[str, Any]] | None = None) -> list[str]:
    """Problems with a plan's data assignments, each as a message"""
    problems: list[str] = []
    for i, a in enumerate(assignments or []):
        at = f"assignment {i + 1}"
        target = a.get("set", a.get("remove"))
        if ("set" in a) == ("remove" in a):
            problems.append(f'{at} must have exactly one of "set" and "remove"')
        elif not isinstance(target, str) or not _PATH.match(target):
            problems.append(f'{at}: "{target}" is not a path')
        elif _RESERVED.search(target):
            problems.append(f'{at}: "{target}" names a property reserved to the engine (5.2)')
        if "set" in a:
            if sum(1 for k in ("value", "from", "expression") if k in a) != 1:
                problems.append(f'{at} must have exactly one of "value", "from" and "expression"')
            if "from" in a and (not isinstance(a["from"], str) or not _PATH.match(a["from"])):
                problems.append(f'{at}: "from" is not a path')
        for key in ("expression", "when"):
            if key in a:
                error = _valid_expression(a[key])
                if error:
                    problems.append(f'{at}: "{key}" is not a condition expression: {error}')
    return problems


def apply_assignments(token_id: str, data: dict[str, Any], assignments: list[dict[str, Any]] | None = None) -> list[dict[str, Any]]:
    """Apply a plan's assignments to one token's data. Returns the changes made."""
    changes: list[dict[str, Any]] = []
    for a in assignments or []:
        if "when" in a and not evaluate_expression(a["when"], data):
            continue
        if "remove" in a:
            previous = copy.deepcopy(_resolve(data, a["remove"]))
            if _remove_path(data, a["remove"]):
                changes.append({"token_id": token_id, "path": a["remove"], "change": "removed",
                                **({"previous": previous} if previous is not _MISSING else {})})
            continue
        if "value" in a:
            value = copy.deepcopy(a["value"])
        elif "from" in a:
            found = _resolve(data, a["from"])
            if found is _MISSING:
                continue
            value = copy.deepcopy(found)
        else:
            value = evaluate_expression(a["expression"], data)
        previous = _resolve(data, a["set"])
        _set_path(data, a["set"], value)
        changes.append({"token_id": token_id, "path": a["set"], "change": "set", "value": value,
                        **({"previous": copy.deepcopy(previous)} if previous is not _MISSING else {})})
    return changes


def _withdraw(data: dict[str, Any], from_id: str) -> dict[str, Any]:
    """The data a token gives up when its wait is withdrawn"""
    rest = dict(data)
    for key in ("_awaiting_event", "_awaiting_agent_input", "_requires_human_action", "_human_task_id", "_waiting_since",
                "_arrived_edge", f"_timer_due:{from_id}"):
        rest.pop(key, None)
    return rest


def plan_migration(old: Workflow, new: Workflow, state: dict[str, Any], plan: MigrationPlan | None = None,
                   run_id: str | None = None) -> MigrationResult:
    """
    Check a plan against a run's state and work out what it does, without
    changing anything. With no refusal, `state` in the result is the run's
    state on the new version, ready to be continued (10.3).
    """
    plan = plan or {}
    rid = run_id if run_id is not None else ((state.get("metadata") or {}).get("run_id") or "")
    from_version = state.get("workflow_version") or old.version
    result: MigrationResult = {
        "run_id": rid, "workflow_id": str(state.get("workflow_id")), "from_version": from_version, "to_version": new.version,
        "applied": False, "dry_run": True, "refusals": [], "tokens": [], "data_changes": [], "completed_work": [],
    }

    def refuse(code: str, message: str, **extra: Any) -> None:
        result["refusals"].append({"code": code, "message": message, **{k: v for k, v in extra.items() if v is not None}})

    old_nodes, new_nodes = _nodes(old), _nodes(new)
    mapping: dict[str, str] = plan.get("nodes") or {}
    restart = set(plan.get("restart") or [])
    workflow_id = str(state.get("workflow_id"))

    # The run and the versions
    if str(new.id) != workflow_id or (plan.get("workflow_id") and plan["workflow_id"] != workflow_id):
        other = plan["workflow_id"] if plan.get("workflow_id") and plan["workflow_id"] != workflow_id else str(new.id)
        refuse("different_workflow", f"Run {rid} is a run of workflow {workflow_id}; a migration moves a run between versions of its own workflow, not to workflow {other}.")
    if old.version != from_version:
        refuse("wrong_version", f"Run {rid} is on version {from_version}, but the workflow given as its version is {old.version}.")
    if plan.get("from_version") and plan["from_version"] != from_version:
        refuse("wrong_version", f"The plan moves runs from version {plan['from_version']}; run {rid} is on version {from_version}.")
    if new.version == from_version:
        refuse("same_version", f"Run {rid} is already on version {new.version}.")
    if str(state.get("engine_status")) in _ENDED:
        refuse("run_ended", f"Run {rid} has ended ({state.get('engine_status')}): there is nothing left to move.")

    # The plan itself
    for source, target in mapping.items():
        if source not in old_nodes:
            refuse("unknown_source", f"The plan maps node {source}, which version {old.version} does not have.", node_id=source)
        if target not in new_nodes:
            name = old_nodes.get(source, {}).get("name")
            refuse("unknown_target", f"The plan maps node {name or source} to {target}, which version {new.version} does not have.", node_id=source, node_name=name)
    for source in restart:
        if source not in old_nodes:
            refuse("unknown_source", f"The plan restarts tokens at node {source}, which version {old.version} does not have.", node_id=source)
    for problem in check_assignments(plan.get("data")):
        refuse("invalid_assignment", f"The plan's data changes cannot be applied: {problem}.")

    # Each token
    tokens = copy.deepcopy(state.get("tokens") or [])
    for token in tokens:
        from_id = str(token["activity_id"])
        source = old_nodes.get(from_id)
        entry: dict[str, Any] = {"token_id": token["id"], "status": token["status"], "from_node_id": from_id,
                                 **({"from_node_name": source["name"]} if source else {}), "to_node_id": from_id, "wait": None, "outcome": "unchanged"}
        if token["status"] not in _LIVE:
            result["tokens"].append(entry)
            continue
        ref = {"token_id": token["id"], "node_id": from_id, "node_name": source["name"] if source else None}
        label = source["name"] if source else from_id
        wait = token_wait(old, token)
        if not wait:
            refuse("run_in_activity", f'Token {token["id"]} is in the middle of "{label}": a run can be moved only while it is at rest. Let the step finish, then migrate.', **ref)
            result["tokens"].append(entry)
            continue
        # A token waiting on a child run (24.4): the child's state names nodes of this version, so the run stays where it is
        data = token.get("context_data") or {}
        if data.get("_awaiting_subworkflow") or data.get("_subworkflow_continuation"):
            refuse("child_run_in_flight", f'Token {token["id"]} at "{label}" waits on a child run (section 24). A run can be moved only once its child runs have ended.', **ref)
            result["tokens"].append(entry)
            continue
        entry["wait"] = wait
        to_id = mapping.get(from_id, from_id)
        target = new_nodes.get(to_id)
        entry["to_node_id"] = to_id
        if target:
            entry["to_node_name"] = target["name"]
        if not target:
            if from_id not in mapping:
                where = "waits at the join" if wait == "join" else "waits at"
                refuse("unmapped_token", f'Token {token["id"]} {where} "{label}", which version {new.version} does not have, and the plan does not say where it goes.', **ref)
            result["tokens"].append(entry)
            continue
        if from_id in restart:
            entry["outcome"] = "restarted"
            token["activity_id"] = to_id
            token["context_data"] = _withdraw(token.get("context_data") or {}, from_id)
            token["status"] = "active"
        else:
            problem = _wait_problem(wait, old, from_id, new, to_id, token)
            if problem:
                refuse("wait_incompatible", f'Token {token["id"]} waits for {_WHAT[wait]} at "{label}", but at its new node {problem}. '
                       "Map it to a node where the wait keeps its meaning, or restart it.", **ref)
                result["tokens"].append(entry)
                continue
            entry["outcome"] = "kept"
            token["activity_id"] = to_id
            data = token.setdefault("context_data", {})
            if wait == "event":
                # The deadline fixed when the wait began is kept; what follows it is the new node's (18.3)
                awaited = {**data["_awaiting_event"], "node_id": to_id}
                timeout_edge = _definition(target).get("timeout_edge_id")
                if timeout_edge:
                    awaited["timeout_edge_id"] = timeout_edge
                else:
                    awaited.pop("timeout_edge_id", None)
                data["_awaiting_event"] = awaited
            if wait == "timer" and to_id != from_id:
                data[f"_timer_due:{to_id}"] = data.pop(f"_timer_due:{from_id}")
        result["tokens"].append(entry)

    # Changes to data, once every token is known to have a place
    if not result["refusals"]:
        for token in (t for t in tokens if t["status"] in _LIVE):
            try:
                result["data_changes"].extend(apply_assignments(token["id"], token.setdefault("context_data", {}), plan.get("data")))
            except ExpressionError as error:
                refuse("invalid_assignment", f"The plan's data changes cannot be applied to token {token['id']}: {error}.", token_id=token["id"])
    if result["refusals"]:
        return result

    # Completed work is compensated, if the run later fails, by the handler of the node it is mapped to (13.6)
    meta = copy.deepcopy(state.get("metadata") or {})
    for done in meta.get("completed_activities") or []:
        target = mapping.get(str(done.get("activity_id")))
        if target and target != str(done.get("activity_id")):
            result["completed_work"].append({"from_node_id": str(done["activity_id"]), "to_node_id": target})
            done["activity_id"] = target
    waiting = [t for t in tokens if t["status"] == "waiting"]
    if any(t["status"] == "active" for t in tokens):
        status = "running"
    elif any(not (t.get("context_data") or {}).get("_awaiting_event") for t in waiting):
        status = "waiting_human"
    elif waiting:
        status = "waiting_event"
    else:
        status = str(state.get("engine_status"))
    result["status"] = status
    result["state"] = {**state, "workflow_name": new.name, "workflow_version": new.version, "engine_status": status,
                       "tokens": tokens, "metadata": meta}
    return result


def rest_positions(workflow: Workflow) -> list[dict[str, str]]:
    """The positions at which a run of a workflow can be at rest, with what it waits for there"""
    positions: list[dict[str, str]] = []
    for node_id, node in _nodes(workflow).items():
        if node["kind"] == "activity":
            activity = node["node"]
            if _over_a2a(workflow, activity):
                positions.append({"node_id": node_id, "node_name": node["name"], "wait": "agent"})
            escalates = activity.outcome_contract is not None and activity.outcome_contract.on_violation == "escalate_human"
            if _value(activity.actor_type) == "human" or escalates:
                positions.append({"node_id": node_id, "node_name": node["name"], "wait": "human"})
        if _is_waiting_event(node):
            positions.append({"node_id": node_id, "node_name": node["name"], "wait": "event"})
        if node["kind"] == "event" and node["node"].event_type == "timer":
            positions.append({"node_id": node_id, "node_name": node["name"], "wait": "timer"})
        if _is_join(workflow, node, node_id):
            positions.append({"node_id": node_id, "node_name": node["name"], "wait": "join"})
    return positions


def compare_versions(old: Workflow, new: Workflow, plan: MigrationPlan | None = None) -> dict[str, Any]:
    """
    Compare two versions of a workflow position by position (25.4): for every
    node where a run of the old version can be at rest, whether a run there can
    be moved to the new version as the plan says (the identity mapping when
    there is no plan), needs a mapping, or cannot keep its wait at all.
    """
    plan = plan or {}
    mapping: dict[str, str] = plan.get("nodes") or {}
    restart = set(plan.get("restart") or [])
    old_nodes, new_nodes = _nodes(old), _nodes(new)
    positions: list[dict[str, Any]] = []
    for position in rest_positions(old):
        to_id = mapping.get(position["node_id"], position["node_id"])
        target = new_nodes.get(to_id)
        entry: dict[str, Any] = {**position, "class": "compatible"}
        if target and position["node_id"] in restart:
            positions.append({**entry, "to_node_id": to_id, "to_node_name": target["name"], "outcome": "restarted"})
            continue
        problem = (_wait_problem(position["wait"], old, position["node_id"], new, to_id) if target
                   else f'version {new.version} has no node "{position["node_name"]}"')
        if not problem:
            positions.append({**entry, "to_node_id": to_id, "to_node_name": target["name"], "outcome": "kept"})
            continue
        candidates = [{"node_id": i, "node_name": n["name"]} for i, n in new_nodes.items()
                      if not _wait_problem(position["wait"], old, position["node_id"], new, i)]
        positions.append({**entry, "class": "needs_mapping" if candidates else "impossible", "reason": problem,
                          **({"candidates": candidates} if candidates else {})})
    return {
        "workflow_id": str(old.id), "from_version": old.version, "to_version": new.version,
        "automatic": all(p["class"] == "compatible" for p in positions),
        "positions": positions,
        "removed": [{"node_id": i, "node_name": n["name"]} for i, n in old_nodes.items() if i not in new_nodes],
        "added": [{"node_id": i, "node_name": n["name"]} for i, n in new_nodes.items() if i not in old_nodes],
    }


def semver_key(version: str) -> tuple[int, ...]:
    """A key that orders semantic versions, oldest first"""
    parts = []
    for part in str(version).split(".")[:3]:
        try:
            parts.append(int(part))
        except ValueError:
            parts.append(0)
    return tuple(parts + [0] * (3 - len(parts)))


def as_migrated(events: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """
    The journal of a migrated run with the node ids recorded before each
    migration read as the plan mapped them: what a replay of the run (20.1)
    matches against the version it ended on.
    """
    ordered = sorted(events, key=lambda e: e["seq"])
    migrations = [e for e in ordered if e["type"] == "run.migrated"]
    if not migrations:
        return ordered
    out = []
    for event in ordered:
        data = event.get("data") or {}
        node, source, target = event.get("node_id"), data.get("from_node_id"), data.get("to_node_id")
        for migration in migrations:
            if migration["seq"] <= event["seq"]:
                continue
            nodes = (migration.get("data") or {}).get("nodes") or {}
            node = nodes.get(node, node) if node else node
            source = nodes.get(source, source) if source else source
            target = nodes.get(target, target) if target else target
        if node == event.get("node_id") and source == data.get("from_node_id") and target == data.get("to_node_id"):
            out.append(event)
            continue
        changed = {**event, "data": {**data, **({"from_node_id": source} if source is not None else {}), **({"to_node_id": target} if target is not None else {})}}
        if node:
            changed["node_id"] = node
        out.append(changed)
    return out
