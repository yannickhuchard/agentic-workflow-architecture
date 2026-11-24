"""
AWA to CNCF Serverless Workflow 1.0 (specification 27.11): an export of what maps, with the
list of what does not. Python port of sdk/typescript/src/interchange/serverless_workflow.ts.

Python has no Serverless Workflow SDK; the documents it writes are checked against the
reference SDK by the test suite when Node is available.
"""

from __future__ import annotations

import json
import re
from dataclasses import dataclass
from typing import Any

from awa.interchange.bpmn_export import check_document, unwrap_document
from awa.interchange.common import InterchangeError
from awa.interchange.expressions import awa_condition_to_jq, jq_path, unary_tests_to_jq

SW_DSL_VERSION = "1.0.0"
SW_EVENT_SOURCE = "https://awa.io"
SW_ERROR_BASE = "https://awa.io/errors"

NODE_PROPERTIES = {
    "verification": "Serverless Workflow has no acceptance verification of a task's output (section 7)",
    "outcome_contract": "Serverless Workflow has no outcome contract (section 11)",
    "tools": "Serverless Workflow tasks do not hand tools to an actor (section 17)",
    "knowledge": "Serverless Workflow has no knowledge given to actors (section 15)",
    "context_bindings": "Serverless Workflow has no shared contexts with bindings (section 22)",
    "compensation": "Serverless Workflow has no compensation of completed tasks (13.6)",
    "sla": "Serverless Workflow has timeouts that fail a task, not service levels that are measured (section 23)",
    "skills": "skills required of the actor are descriptive",
    "tool_requirements": "tool requirements of the actor are descriptive",
    "access_rights": "access rights are descriptive",
    "controls": "controls are descriptive",
    "programs": "programs are not called: the activity is requested from whoever performs it",
    "analytics": "value stream metrics are descriptive",
}
WORKFLOW_PROPERTIES = {
    "roles": "Serverless Workflow has no roles; the role of each activity is carried in the event that requests it",
    "contexts": "Serverless Workflow has no shared contexts (section 22)",
    "sla": "Serverless Workflow has a workflow timeout that fails the run, not a service level that is measured (section 23)",
    "analytics": "value stream metrics are descriptive",
}
_LISTEN_OUTPUT = "${ $input + (.[0].data // .[0] // {}) }"


def _slug(text: str, limit: int = 63) -> str:
    s = re.sub(r"[^a-z0-9]+", "-", text.lower()).strip("-")[:limit].rstrip("-")
    return s or "task"


def _present(value: Any) -> bool:
    return value is not None and not (isinstance(value, list) and not value)


@dataclass
class _Scope:
    owner: str
    in_branch: bool = False
    join: dict | None = None


class _Exporter:
    def __init__(self, w: dict[str, Any]):
        self.w = w
        self.names: dict[str, str] = {}
        self.used: set[str] = set()
        self.emitted: set[str] = set()
        self.owner: dict[str, str] = {}
        self.not_mapped: list[dict[str, str]] = []
        self.nodes: dict[str, dict] = {}
        self.kind: dict[str, str] = {}
        self.extra_tasks: list[dict] = []
        self.fork_joins: set[str] = set()
        for kind, key in (("activity", "activities"), ("event", "events"), ("decision", "decision_nodes")):
            for node in w.get(key) or []:
                self.nodes[str(node["id"])] = node
                self.kind[str(node["id"])] = kind
        self.edges = w.get("edges") or []

    def name(self, node: dict) -> str:
        node_id = str(node["id"])
        if node_id not in self.names:
            self.names[node_id] = self.unique(_slug(str(node.get("name"))))
        return self.names[node_id]

    def unique(self, base: str) -> str:
        name, i = base, 2
        while name in self.used:
            name = f"{base[:60]}-{i}"
            i += 1
        self.used.add(name)
        return name

    def out(self, node_id: str) -> list[dict]:
        return [e for e in self.edges if e.get("source_id") == node_id]

    def inc(self, node_id: str) -> list[dict]:
        return [e for e in self.edges if e.get("target_id") == node_id]

    def note(self, node: dict | None, prop: str | None, reason: str) -> None:
        item: dict[str, str] = {"reason": reason}
        if node is not None:
            item = {"reason": reason, "node": str(node.get("name"))}
        if prop:
            item["property"] = prop
        self.not_mapped.append(item)

    def timeout_edge(self, node: dict) -> str | None:
        d = node.get("event_definition") if isinstance(node.get("event_definition"), dict) else None
        return d["timeout_edge_id"] if d and isinstance(d.get("timeout"), str) and isinstance(d.get("timeout_edge_id"), str) else None

    def routed(self, node: dict) -> list[dict]:
        t = self.timeout_edge(node)
        return [e for e in self.out(str(node["id"])) if e.get("id") != t]

    def elided(self, node: dict) -> bool:
        if self.kind.get(str(node["id"])) != "event" or node.get("event_type") not in ("start", "intermediate"):
            return False
        out = self.routed(node)
        return len(out) == 1 and not isinstance(out[0].get("condition"), str) and out[0].get("is_default") is not True and node.get("join") != "all"

    def ref(self, node_id: str, scope: _Scope, seen: set | None = None) -> str:
        seen = seen if seen is not None else set()
        node = self.nodes[node_id]
        if scope.join is not None and node_id == scope.join["id"]:
            return "exit"
        if node.get("event_type") == "end" and self.kind.get(node_id) == "event":
            return "exit" if scope.in_branch else "end"
        if self.elided(node):
            if node_id in seen:
                raise InterchangeError(f'Events "{node.get("name")}" and those after it lead to each other and to nothing else')
            seen.add(node_id)
            return self.ref(str(self.routed(node)[0]["target_id"]), scope, seen)
        return self.name(node)

    def scope(self, starts: list[str], scope: _Scope) -> list[dict]:
        tasks: list[dict] = []
        queue = list(starts)
        while queue:
            node_id = queue.pop(0)
            node = self.nodes[node_id]
            if node_id in self.emitted or (scope.join is not None and node_id == scope.join["id"]):
                continue
            if self.kind.get(node_id) == "event" and node.get("event_type") == "end":
                continue
            owner = self.owner.get(node_id)
            if owner and owner != scope.owner:
                raise InterchangeError(f'"{node.get("name")}" is reached both from inside a parallel branch and from outside it, which Serverless Workflow\'s nested branches cannot express')
            self.owner[node_id] = scope.owner
            if self.elided(node):
                queue.append(str(self.routed(node)[0]["target_id"]))
                self.emitted.add(node_id)
                continue
            self.emitted.add(node_id)
            new_tasks, nxt = self.node_tasks(node, scope)
            tasks.extend(new_tasks)
            queue.extend(nxt)
        return tasks

    def node_tasks(self, node: dict, scope: _Scope) -> tuple[list[dict], list[str]]:
        node_id = str(node["id"])
        kind = self.kind[node_id]
        name = self.name(node)
        if kind == "decision":
            return self.decision(node, scope)
        body = self.activity(node) if kind == "activity" else self.event(node)
        if node.get("join") == "all" and node_id not in self.fork_joins:
            self.note(node, "join", 'the parallel branches that reach this node do not start at one split, so its join "all" cannot be a fork; it runs once per arrival')
        then, extra, nxt = self.routing(node, scope)
        if then:
            body["then"] = then
        return [{name: body}] + extra, nxt

    def activity(self, a: dict) -> dict:
        for key, reason in NODE_PROPERTIES.items():
            if _present(a.get(key)):
                self.note(a, key, reason)
        if a.get("is_expandable") is True and isinstance(a.get("expansion_workflow_id"), str):
            self.note(a, "expansion_workflow_id", 'the sub-workflow is named by its AWA identifier, as workflow "awa-<id>" version "latest"; export it as well under that name')
            return {"run": {"workflow": {"namespace": "awa", "name": f"awa-{a['expansion_workflow_id']}", "version": "latest"}}}
        data: dict[str, Any] = {"activity_id": str(a["id"]), "activity": str(a.get("name")), "actor_type": str(a.get("actor_type"))}
        if a.get("role_id") is not None:
            data["role_id"] = a["role_id"]
        if isinstance(a.get("description"), str):
            data["description"] = a["description"]
        steps = [
            {"request": {"emit": {"event": {"with": {"source": SW_EVENT_SOURCE, "type": "io.awa.activity.requested", "subject": str(a["id"]), "data": data}}}}},
            {"complete": {"listen": {"to": {"one": {"with": {"type": "io.awa.activity.completed", "subject": str(a["id"])}}}}, "output": {"as": _LISTEN_OUTPUT}}},
        ]
        if isinstance(a.get("retry"), dict):
            r = a["retry"]
            return {"try": steps, "catch": {"retry": {"delay": str(r.get("initial_delay", "PT1S")), "backoff": {"exponential": {}},
                                                      "limit": {"attempt": {"count": int(r.get("max_attempts", 1))}}}}}
        return {"do": steps}

    def event(self, e: dict) -> dict:
        d = e.get("event_definition") if isinstance(e.get("event_definition"), dict) else {}
        kind = str(e.get("event_type"))
        if "bpmn:gateway" in e or kind in ("start", "intermediate"):
            return {"wait": "PT0S"}
        if kind == "timer":
            return {"wait": str(d.get("duration"))}
        if kind in ("message", "signal"):
            if d.get("mode") == "publish":
                fields = d.get("data") if isinstance(d.get("data"), list) else None
                data = ("${ {" + ", ".join(f"{json.dumps(f, ensure_ascii=False)}: {jq_path(f)}" for f in fields) + "} }") if fields is not None else "${ . }"
                return {"emit": {"event": {"with": {"source": SW_EVENT_SOURCE, "type": str(d.get("name")), "data": data}}}}
            event_filter: dict[str, Any] = {"with": {"type": str(d.get("name"))}}
            if isinstance(d.get("correlation_key"), str):
                key = d["correlation_key"]
                event_filter["correlate"] = {"key": {"from": f"${{ .data.{key} }}", "expect": f"${{ {jq_path(key)} }}"}}
            task: dict[str, Any] = {"listen": {"to": {"one": event_filter}}, "output": {"as": _LISTEN_OUTPUT}}
            if isinstance(d.get("timeout"), str):
                task["timeout"] = {"after": d["timeout"]}
                if self.timeout_edge(e):
                    self.note(e, "event_definition.timeout_edge_id", "when the wait runs out the task fails with a timeout error; the path the timeout edge takes is not followed")
            return task
        if kind == "error":
            return {"raise": {"error": {"type": f"{SW_ERROR_BASE}/{_slug(str(d.get('name') or e.get('name')))}", "status": 500, "title": str(e.get("name"))}}}
        self.note(e, "event_type", f"AWA {kind} events are reserved (13.4); the export raises an error where one is reached")
        return {"raise": {"error": {"type": f"{SW_ERROR_BASE}/unsupported-event", "status": 500, "title": str(e.get("name"))}}}

    def no_route(self, node: dict) -> str:
        name = self.unique(f"{self.name(node)}-no-route")
        self.extra_tasks.append({name: {"raise": {"error": {"type": f"{SW_ERROR_BASE}/no-route", "status": 500, "title": f"No route from {node.get('name')}"}}, "then": "end"}})
        return name

    def routing(self, node: dict, scope: _Scope) -> tuple[str | None, list[dict], list[str]]:
        out = self.routed(node)
        t = self.timeout_edge(node)
        nxt = [str(e["target_id"]) for e in out]
        if t:
            nxt.append(str(next(e for e in self.edges if e.get("id") == t)["target_id"]))
        if not out:
            return ("exit" if scope.in_branch else "end"), [], nxt
        conditional = [e for e in out if isinstance(e.get("condition"), str)]
        fallback = next((e for e in out if e.get("is_default") is True), None)
        plain = [e for e in out if not isinstance(e.get("condition"), str) and e.get("is_default") is not True]
        if not conditional and fallback is None:
            if len(plain) == 1:
                return self.ref(str(plain[0]["target_id"]), scope), [], nxt
            return self.fork(node, plain, scope)
        cases = [{(_slug(str(e["label"])) if e.get("label") else f"when-{i + 1}"): {"when": f"${{ {awa_condition_to_jq(e['condition'])} }}", "then": self.ref(str(e["target_id"]), scope)}}
                 for i, e in enumerate(conditional)]
        if fallback is not None:
            cases.append({"default": {"then": self.ref(str(fallback["target_id"]), scope)}})
        elif len(plain) == 1:
            cases.append({"default": {"then": self.ref(str(plain[0]["target_id"]), scope)}})
        else:
            if len(plain) > 1:
                self.note(node, "edges", "when no condition holds the token would split over several edges, which a switch cannot do; the export raises an error instead")
            cases.append({"default": {"then": self.no_route(node)}})
        router = self.unique(f"{self.name(node)}-route")
        return router, [{router: {"switch": cases}}], nxt

    def reach(self, start: str, stop: str | None = None) -> list[str]:
        seen: list[str] = []
        queue = [start]
        while queue:
            node_id = queue.pop(0)
            if node_id == stop or node_id in seen:
                continue
            seen.append(node_id)
            queue.extend(str(e["target_id"]) for e in self.out(node_id))
        return seen

    def fork(self, node: dict, edges: list[dict], scope: _Scope) -> tuple[str, list[dict], list[str]]:
        targets = [str(e["target_id"]) for e in edges]
        candidates = [i for i in self.reach(targets[0]) if self.nodes[i].get("join") == "all" and all(i in self.reach(t) for t in targets)]
        join = self.nodes[candidates[0]] if candidates else None
        sets = [self.reach(t, str(join["id"]) if join else None) for t in targets]
        for i, a in enumerate(sets):
            for b in sets[i + 1:]:
                if any(x in b for x in a):
                    raise InterchangeError(f'The parallel branches after "{node.get("name")}" meet before they reach a join, which Serverless Workflow\'s nested branches cannot express')
        if join is not None:
            self.fork_joins.add(str(join["id"]))
        branches = []
        for i, target in enumerate(targets):
            inner = _Scope(owner=f"{node['id']}#{i}", in_branch=True, join=join)
            first = self.ref(target, inner)
            tasks = self.scope([target], inner)
            if not tasks or first in ("exit", "end"):
                tasks.insert(0, {self.unique(f"{self.name(node)}-branch-{i + 1}-empty"): {"wait": "PT0S", "then": "exit" if first == "end" else first}})
            _check_then(tasks, f'a branch after "{node.get("name")}"')
            label = _slug(str(edges[i]["label"])) if edges[i].get("label") else f"branch-{i + 1}"
            branches.append({label: {"do": tasks}})
        split = self.unique(f"{self.name(node)}-split")
        after = self.ref(str(join["id"]), scope) if join is not None else ("exit" if scope.in_branch else "end")
        return split, [{split: {"fork": {"branches": branches, "compete": False}, "then": after}}], ([str(join["id"])] if join is not None else [])

    def decision(self, d: dict, scope: _Scope) -> tuple[list[dict], list[str]]:
        name = self.name(d)
        table = d.get("decision_table") if isinstance(d.get("decision_table"), dict) else None
        nxt = [str(e["target_id"]) for e in self.out(str(d["id"]))]
        if d.get("decision_model"):
            self.note(d, "decision_model", "the model that decides when no rule matches is not called; the default edge is taken instead" if table
                      else "a model decides here, which Serverless Workflow cannot express; the export raises an error")
        if d.get("decision_engine"):
            self.note(d, "decision_engine", "an external decision engine decides here, which Serverless Workflow cannot express; the export raises an error")
        policy = str(table.get("hit_policy")) if table else ""
        if table is None or policy not in ("first", "unique", "any"):
            if table is not None:
                self.note(d, "decision_table.hit_policy", f"hit policy {policy} cannot be written as a switch; the export raises an error")
            return [{name: {"raise": {"error": {"type": f"{SW_ERROR_BASE}/decision-not-mapped", "status": 500, "title": str(d.get("name"))}}, "then": "end"}}], nxt
        if policy != "first":
            self.note(d, "decision_table.hit_policy", f"hit policy {policy} is written as first: a conflict between rules is not detected")
        self.note(d, "decision_table.outputs", "the outputs of the deciding rule are not merged into the data; only the route is kept")
        inputs = table.get("inputs") or []
        default_edge = next((e for e in self.edges if e.get("id") == d.get("default_output_edge_id")), None) if isinstance(d.get("default_output_edge_id"), str) else None
        default_target = default_edge["target_id"] if default_edge else None
        cases = []
        for i, rule in enumerate(table.get("rules") or []):
            tests = [unary_tests_to_jq(entry, str(inputs[j].get("name"))) for j, entry in enumerate(rule.get("input_entries") or []) if j < len(inputs)]
            tests = [t for t in tests if t != "true"]
            edge = next((e for e in self.edges if e.get("id") == rule.get("output_edge_id")), None) if rule.get("output_edge_id") else None
            target = edge["target_id"] if edge else default_target
            cases.append({f"rule-{i + 1}": {"when": f"${{ {' and '.join(tests) if tests else 'true'} }}", "then": self.ref(str(target), scope) if target else self.no_route(d)}})
        cases.append({"default": {"then": self.ref(str(default_target), scope) if default_target else self.no_route(d)}})
        return [{name: {"switch": cases}}], nxt

    def is_handler(self, a: dict) -> bool:
        return any(isinstance(x.get("compensation"), dict) and x["compensation"].get("activity_id") == a.get("id") for x in self.w.get("activities") or [])

    def build(self) -> list[dict]:
        events = self.w.get("events") or []
        activities = self.w.get("activities") or []
        start = next((e for e in events if e.get("event_type") == "start"), None) \
            or next((a for a in activities if not self.inc(str(a["id"])) and not self.is_handler(a)), None) \
            or (activities[0] if activities else None)
        top = _Scope(owner="top")
        tasks = self.scope([str(start["id"])], top) if start else []
        for node_id, node in self.nodes.items():
            if node_id not in self.emitted and not self.is_handler(node):
                tasks.extend(self.scope([node_id], top))
        for a in activities:
            if self.is_handler(a):
                self.note(a, None, "a compensation handler runs only when a run fails (13.6), which the export does not express")
        tasks.extend(self.extra_tasks)
        return tasks


def _check_then(tasks: list[dict], where: str) -> None:
    names = {next(iter(t)) for t in tasks}

    def visit(value: Any) -> None:
        if isinstance(value, list):
            for v in value:
                visit(v)
            return
        if not isinstance(value, dict):
            return
        for key, inner in value.items():
            if key == "then" and isinstance(inner, str) and inner not in names and inner not in ("continue", "exit", "end"):
                raise InterchangeError(f'In {where}, "{inner}" is reached from a list of tasks it is not in, which Serverless Workflow\'s nested branches cannot express')
            if key not in ("do", "fork", "try"):
                visit(inner)

    for task in tasks:
        visit(next(iter(task.values())))


@dataclass
class ServerlessWorkflowExport:
    document: dict[str, Any]
    #: What of the workflow the export does not carry: node, property and the reason
    not_mapped: list[dict[str, str]]


def export_serverless_workflow(document: dict[str, Any]) -> ServerlessWorkflowExport:
    """Export a workflow as a CNCF Serverless Workflow 1.0 document, and list what of it the export does not carry"""
    check_document(document)
    w = unwrap_document(document)
    exporter = _Exporter(w)
    tasks = exporter.build()
    _check_then(tasks, f'workflow "{w.get("name")}"')
    header: dict[str, Any] = {"dsl": SW_DSL_VERSION, "namespace": "awa", "name": _slug(str(w.get("name"))), "version": str(w.get("version")), "title": str(w.get("name"))}
    if isinstance(w.get("description"), str):
        header["summary"] = w["description"]
    header["metadata"] = {"awa_workflow_id": str(w["id"]), **({"awa_version": str(w["awa_version"])} if w.get("awa_version") else {})}
    sw: dict[str, Any] = {"document": header}
    start = next((e for e in w.get("events") or [] if e.get("event_type") == "start"), None)
    start_name = (start.get("event_definition") or {}).get("name") if start and isinstance(start.get("event_definition"), dict) else None
    if isinstance(start_name, str):
        sw["schedule"] = {"on": {"one": {"with": {"type": start_name}}}}
    sw["do"] = tasks
    for key, reason in reversed(list(WORKFLOW_PROPERTIES.items())):
        if _present(w.get(key)):
            exporter.not_mapped.insert(0, {"property": key, "reason": reason})
    return ServerlessWorkflowExport(document=sw, not_mapped=exporter.not_mapped)
