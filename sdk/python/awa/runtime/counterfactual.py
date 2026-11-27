"""
AWA Counterfactual Replay (specification section 20)

Runs a recorded run again with something changed (a model, a prompt, a
contract, a decision rule) while holding the rest of the world exactly as it
was recorded, then compares the two runs. Every journal thereby becomes a
regression test: "had we used this instead, what would have happened?"

Held fixed, taken from the baseline journal: the run's input, the results of
activities performed by applications, robots and people, the results of tool
calls, the business events received, and the passing of time. What runs
again: AI agents, model decisions and judges, under the candidate configuration.
"""

import copy
import json
from dataclasses import dataclass
from typing import Any

from awa.runtime.business_event import business_event
from awa.runtime.journal import JournalEvent, canonical_json, hash_payload
from awa.runtime.migration import as_migrated
from awa.runtime.tools import BINDING_KINDS, ToolError, ToolExecution, ToolOptions
from awa.runtime.workflow_engine import WorkflowEngine
from awa.types import Activity, ActorType, Workflow

AI_MODES = ("live", "recorded")
VERDICTS = ("same", "improved", "regressed", "changed", "only_baseline", "only_candidate")
_ARROW = " → "


class ReplayUnrecorded(Exception):
    """The candidate did something the baseline never did, so there is no result to replay (20.2)"""
    code = "REPLAY_UNRECORDED"


@dataclass
class ReplayResult:
    """What a replay gives back: the report, the candidate run's own journal, and its status"""
    report: dict[str, Any]
    events: list[JournalEvent]
    status: str


def _outcome_of_output(output: Any) -> Any:
    if not isinstance(output, dict):
        return output
    rest = {key: value for key, value in output.items() if key not in ("output", "usage", "status")}
    if "output" not in output:
        return rest
    inner = output["output"]
    return inner if isinstance(inner, dict) else {"output": inner, **rest}


def _require_payloads(events: list[JournalEvent]) -> None:
    for event in events:
        if event["type"] != "activity.completed":
            continue
        output = event["data"].get("output")
        if output is None or (isinstance(output, dict) and output.get("sha256")):
            raise ValueError(
                'This journal does not hold activity outputs (payload mode "hash" or "none"), so the run cannot be '
                'replayed. Record with payload mode "full".')


def _names(workflow: Workflow) -> dict[str, str]:
    return {str(node.id): node.name for node in (*workflow.activities, *workflow.events, *workflow.decision_nodes)}


def _usage(usage: Any) -> int:
    if not isinstance(usage, dict):
        return 0
    return int(usage.get("input_tokens") or 0) + int(usage.get("output_tokens") or 0)


def _summarise(workflow: Workflow, events: list[JournalEvent]) -> tuple[dict[str, dict[str, Any]], dict[str, Any], list[tuple[str, str]]]:
    """What the journal says happened at each node, the totals of the run, and the path it took"""
    names = _names(workflow)
    nodes: dict[str, dict[str, Any]] = {}
    steps: list[tuple[str, str]] = []

    def at(node_id: str) -> dict[str, Any]:
        return nodes.setdefault(node_id, {"reached": True, "accepted": False, "attempts": 0, "tool_calls": 0, "tokens": 0})

    for event in sorted(events, key=lambda e: e["seq"]):
        data, type = event["data"], event["type"]
        if type == "token.moved":
            source, target = str(data.get("from_node_id")), str(data.get("to_node_id"))
            steps.append((names.get(source, source), names.get(target, target)))
            at(target)
            continue
        if not event.get("node_id") or type.startswith("activity.compensat"):
            continue
        node = at(event["node_id"])
        if type == "activity.started":
            node["attempts"] += 1
        elif type == "activity.completed":
            node["accepted"] = True
            node["outcome"] = _outcome_of_output(data.get("output"))
            node["outcome_hash"] = hash_payload(node["outcome"])
            node["tokens"] += _usage(data.get("usage"))
            node.pop("error", None)
        elif type == "activity.failed":
            node["error"] = (data.get("error") or {}).get("message")
        elif type == "token.failed":
            node["error"] = (data.get("error") or {}).get("message")
            node["accepted"] = False
        elif type == "tool.invoked":
            node["tool_calls"] += 1
        elif type == "decision.evaluated":
            model = data.get("model") if isinstance(data.get("model"), dict) else {}
            engine = data.get("engine") if isinstance(data.get("engine"), dict) else {}
            method = data.get("method")
            node["accepted"] = method != "none"
            if method == "model":
                choice = model.get("option")
            elif method == "engine":
                choice = engine.get("option")
            elif method == "table":
                choice = "rule " + ", ".join(str(rule["index"] + 1) for rule in data.get("matched_rules") or [])
            else:
                choice = str(method)
            node["decision"] = {"method": method, "choice": choice}
            node["tokens"] += _usage(model.get("usage"))
            node["outcome_hash"] = hash_payload([data.get("edge_id")])
        elif type in ("event.received", "timer.fired", "event.published"):
            node["accepted"] = True

    ended = next((e for e in events if e["type"] in ("run.completed", "run.failed")), None)
    totals: dict[str, Any] = {
        "run_id": events[0]["run_id"] if events else "",
        "status": ("completed" if ended["type"] == "run.completed" else "failed") if ended else "unfinished",
        "duration_ms": ended["data"].get("duration_ms") if ended else None,
        "attempts": sum(1 for e in events if e["type"] == "activity.started"),
        "tokens": sum(node["tokens"] for node in nodes.values()),
        "cost": ended["data"].get("cost") if ended else None,
        "path": [f"{source}{_ARROW}{target}" for source, target in steps],
    }
    return nodes, {key: value for key, value in totals.items() if value is not None}, steps


def compare_runs(workflow: Workflow, baseline: list[JournalEvent], candidate: list[JournalEvent], ai: str = "live",
                 unrecorded: list[str] | None = None, replayed: set[str] | None = None) -> dict[str, Any]:
    """
    Compare two journals node by node (specification 20.3). `workflow` is the
    candidate's; nodes are matched by id. `replayed` holds the ids of nodes whose
    results were supplied from the recording: their attempt counts say nothing
    about the candidate.
    """
    replayed = replayed or set()
    b_nodes, b_totals, b_steps = _summarise(workflow, baseline)
    c_nodes, c_totals, c_steps = _summarise(workflow, candidate)
    names = _names(workflow)
    absent = {"reached": False, "accepted": False, "attempts": 0, "tool_calls": 0, "tokens": 0}
    nodes: list[dict[str, Any]] = []

    for node_id in dict.fromkeys([*b_nodes, *c_nodes]):
        if node_id not in names:
            continue
        base, cand = b_nodes.get(node_id, absent), c_nodes.get(node_id, absent)
        notes: list[str] = []
        verdict = "same"

        if not cand["reached"]:
            verdict = "only_baseline"
            notes.append("The candidate run did not reach this step.")
        elif not base["reached"]:
            verdict = "only_candidate"
            notes.append("The recorded run did not reach this step.")
        else:
            b_decision, c_decision = base.get("decision"), cand.get("decision")
            if base["accepted"] and not cand["accepted"]:
                verdict = "regressed"
                notes.append("Accepted in the recorded run, not in the candidate"
                             + (f": {cand['error']}" if cand.get("error") else "") + ".")
            elif not base["accepted"] and cand["accepted"]:
                verdict = "improved"
                notes.append("Not accepted in the recorded run, accepted in the candidate.")
            elif b_decision and c_decision and (b_decision["choice"] != c_decision["choice"]
                                                or base.get("outcome_hash") != cand.get("outcome_hash")):
                verdict = "changed"
                notes.append(f"Decision changed from {b_decision['choice']} ({b_decision['method']}) "
                             f"to {c_decision['choice']} ({c_decision['method']}).")
            else:
                if node_id in replayed:
                    pass  # a replayed result is accepted at once; that is not an improvement
                elif cand["attempts"] < base["attempts"]:
                    verdict = "improved"
                    notes.append(f"Accepted in {cand['attempts']} attempt(s), down from {base['attempts']}.")
                elif cand["attempts"] > base["attempts"]:
                    verdict = "regressed"
                    notes.append(f"Needed {cand['attempts']} attempt(s), up from {base['attempts']}.")
                if base.get("outcome_hash") != cand.get("outcome_hash") and not b_decision:
                    if verdict == "same":
                        verdict = "changed"
                    notes.append("The accepted outcome differs.")
            if cand["tool_calls"] != base["tool_calls"]:
                notes.append(f"Tool calls: {base['tool_calls']} recorded, {cand['tool_calls']} in the candidate.")
            if node_id not in replayed and cand["tokens"] != base["tokens"]:
                notes.append(f"Model tokens: {base['tokens']} recorded, {cand['tokens']} in the candidate.")
        nodes.append({"node_id": node_id, "node_name": names[node_id], "verdict": verdict, "notes": notes,
                      "baseline": dict(base), "candidate": dict(cand)})

    # The first point at which the two runs went different ways
    divergence = None
    ended = "(the run ended)"
    for index in range(max(len(b_steps), len(c_steps))):
        b_step = b_steps[index] if index < len(b_steps) else None
        c_step = c_steps[index] if index < len(c_steps) else None
        if b_step != c_step:
            divergence = {"after": (b_step or c_step)[0], "baseline_next": b_step[1] if b_step else ended,
                          "candidate_next": c_step[1] if c_step else ended}
            break
    same_path = sorted(b_totals["path"]) == sorted(c_totals["path"])

    regressions = [f"{n['node_name']}: {n['notes'][0]}" for n in nodes if n["verdict"] == "regressed"]
    if b_totals["status"] == "completed" and c_totals["status"] != "completed":
        regressions.append(f"The run {'failed' if c_totals['status'] == 'failed' else 'did not finish'}; the recorded run completed.")
    improvements = [f"{n['node_name']}: {n['notes'][0]}" for n in nodes if n["verdict"] == "improved"]
    if b_totals["status"] != "completed" and c_totals["status"] == "completed":
        improvements.append("The run completed; the recorded run did not.")

    return {
        "workflow": workflow.name, "ai": ai,
        "baseline": b_totals, "candidate": c_totals,
        "same_status": b_totals["status"] == c_totals["status"],
        "same_path": same_path,
        **({} if same_path or divergence is None else {"divergence": divergence}),
        "regressions": regressions,
        "improvements": improvements,
        "unrecorded": list(unrecorded or []),
        "nodes": nodes,
    }


def counterfactual_replay(workflow: Workflow, baseline: list[JournalEvent], candidate: Workflow | None = None,
                          ai: str = "live", engine: dict[str, Any] | None = None) -> ReplayResult:
    """
    Replay a recorded run under a candidate configuration and compare.

    workflow:  the workflow the journal was recorded with
    baseline:  the journal of the recorded run, with payload mode "full"
    candidate: the workflow to run instead; nodes that are the same keep their ids
    ai:        "live" (default): AI agents and model decisions run again under the
               candidate configuration. "recorded": their recorded outputs are replayed
               too, which isolates the effect of a changed contract, criterion or rule
               and needs no model at all.
    engine:    engine options for the candidate run: model providers and tiers for the built-in
               AI agent, or `actors` with the AI agent to run; verifiers, knowledge

    Nothing but AI runs for real: tools, people, applications, events and time are as recorded.
    """
    if ai not in AI_MODES:
        raise ValueError('ai must be "live" or "recorded"')
    # A run moved to another version is matched node by node as its migrations mapped it (25.5)
    recorded = as_migrated(baseline)
    _require_payloads(recorded)
    candidate = candidate or workflow
    options = dict(engine or {})
    supplied_actors = {ActorType(actor_type): actor for actor_type, actor in (options.get("actors") or {}).items()}
    if ai == "live" and ActorType.ai_agent not in supplied_actors and not options.get("model_providers") \
            and any(a.actor_type == ActorType.ai_agent for a in candidate.activities):
        # Without a model provider the built-in AI agent calls no model. Letting it stand in would invent results.
        raise ValueError(
            'A live replay runs the AI agents again: give engine["model_providers"] for the built-in AI agent to call, '
            'or the actor that performs them in engine["actors"]["ai_agent"], or replay with ai="recorded"')
    unrecorded: list[str] = []

    # --- the recorded world ----------------------------------------------
    outputs: dict[str, list[dict[str, Any]]] = {}
    tool_results: dict[str, list[dict[str, Any]]] = {}
    invoked: dict[str, JournalEvent] = {}
    decisions: dict[str, list[dict[str, Any]]] = {}
    # A result is held with what the activity wrote to contexts (22.3): the writes journalled before it completed are given back with it
    writes: dict[str, dict[str, Any]] = {}
    for event in sorted(recorded, key=lambda e: e["seq"]):
        data, type = event["data"], event["type"]
        at = f"{event.get('token_id')}|{event.get('node_id')}"
        if type == "context.written" and event.get("node_id") and "written" in data:
            writes.setdefault(at, {})[data.get("context_name")] = data["written"]
        elif type in ("activity.completed", "activity.compensated") and event.get("node_id"):
            written = writes.pop(at, None)
            written = written if type == "activity.completed" else None
            output = data.get("output") or {}
            outputs.setdefault(event["node_id"], []).append(
                {**output, "_context_writes": written} if written and isinstance(output, dict) else output)
        elif type == "tool.invoked":
            invoked[data.get("call_id")] = event
        elif type in ("tool.completed", "tool.failed"):
            call = invoked.get(data.get("call_id"))
            if call is None:
                continue
            key = f"{call['data'].get('tool')}:{canonical_json(call['data'].get('arguments'))}"
            tool_results.setdefault(key, []).append(
                {"ok": True, "status": data.get("status"), "result": data.get("result")} if type == "tool.completed"
                else {"ok": False, "status": data.get("status"), "error": (data.get("error") or {}).get("message")})
        elif type == "decision.evaluated" and event.get("node_id") and isinstance(data.get("model"), dict):
            decisions.setdefault(event["node_id"], []).append(
                {"option": data["model"].get("option"), "confidence": data["model"].get("confidence")})
    received = [e for e in recorded if e["type"] == "event.received"]
    timeouts = sum(1 for e in recorded if e["type"] == "event.timed_out")

    def take(queue: list[Any]) -> Any:
        # The last recorded result repeats if the candidate needs it more often
        return queue.pop(0) if len(queue) > 1 else queue[0]

    def note(what: str) -> None:
        if what not in unrecorded:
            unrecorded.append(what)

    class RecordedActor:
        def execute(self, activity: Activity, token: Any) -> dict[str, Any]:
            queue = outputs.get(str(activity.id))
            if not queue:
                note(f'activity "{activity.name}"')
                raise ReplayUnrecorded(
                    f'"{activity.name}" was not performed in the recorded run, so there is no result to replay')
            return copy.deepcopy(take(queue))

    def recorded_tool(binding: Any, args: dict[str, Any], context: Any) -> ToolExecution:
        tool = next((t for a in candidate.activities for t in a.tools if t.binding is binding), None)
        name = tool.name if tool else None
        queue = tool_results.get(f"{name}:{canonical_json(args)}")
        if not queue:
            note(f"tool call {name}({json.dumps(args)})")
            raise ToolError(f"No recorded result for {name} with these arguments", "REPLAY_UNRECORDED")
        hit = take(queue)
        if not hit["ok"]:
            raise ToolError(hit.get("error") or "The recorded call failed", "TOOL_ERROR", hit.get("status"))
        return ToolExecution(copy.deepcopy(hit.get("result")), hit.get("status"))

    def recorded_decision(node: Any) -> dict[str, Any] | None:
        queue = decisions.get(str(node.id))
        return take(queue) if queue else None

    # --- the candidate run ------------------------------------------------
    recorded_actor = RecordedActor()
    tools = ToolOptions.of(options.get("tools"))
    started = next((e for e in recorded if e["type"] == "run.started"), None)
    run = WorkflowEngine(candidate, options={
        "log_execution": False,
        **options,
        "simulate": False,
        # With recorded AI, the choices models made at decision nodes are replayed as well
        **({"model_decision_override": recorded_decision} if ai == "recorded" else {}),
        "sleep": lambda ms: None,
        # A call activity's result is held as recorded: no child run is started (24.7)
        "subworkflows": {**(options.get("subworkflows") or {}), "actor": recorded_actor},
        "actors": {
            ActorType.application: recorded_actor, ActorType.human: recorded_actor, ActorType.robot: recorded_actor,
            **({ActorType.ai_agent: recorded_actor} if ai == "recorded" else {}),
            **supplied_actors,
        },
        # Every kind of tool is answered from the recording; nothing is called (20.2)
        "tools": ToolOptions(
            handlers=tools.handlers,
            executors={**{kind: recorded_tool for kind in BINDING_KINDS}, **tools.executors},
            allow_commands=True, allowed_hosts=None, secrets=tools.secrets,
            simulated_results=tools.simulated_results, max_output_bytes=tools.max_output_bytes),
    })

    run.run(copy.deepcopy((started["data"].get("input") if started else None) or {}))
    position = 0
    while run.status.value == "waiting_event":
        # Give the candidate the events the recorded run received, in order, then its timeouts
        progressed = False
        while position < len(received) and not progressed:
            data = received[position]["data"]
            position += 1
            progressed = run.deliver_event(
                business_event(data.get("name"), data.get("data") or {}, source=data.get("source"))) > 0
        if not progressed and timeouts > 0:
            timeouts -= 1
            progressed = run.expire_events(float("inf")) > 0
        if not progressed:
            note("a business event the candidate run waited for")
            break
        run.run()

    events = run.get_events()
    replayed = {str(a.id) for a in candidate.activities if ai == "recorded" or a.actor_type != ActorType.ai_agent}
    return ReplayResult(compare_runs(candidate, recorded, events, ai, unrecorded, replayed), events, run.status.value)


def _ms(value: Any) -> str:
    if value is None:
        return "n/a"
    return f"{round(value)} ms" if value < 1000 else f"{value / 1000:.1f} s"


def render_counterfactual_report(report: dict[str, Any]) -> str:
    """The report as Markdown"""
    out: list[str] = []
    if report["regressions"]:
        verdict = "The candidate is worse on at least one step."
    elif report["improvements"]:
        verdict = "The candidate is better, with no regressions."
    elif report["same_status"] and report["same_path"] and all(n["verdict"] == "same" for n in report["nodes"]):
        verdict = "The candidate behaves exactly as recorded."
    else:
        verdict = "The candidate behaves differently, with no step worse than recorded."
    baseline, candidate = report["baseline"], report["candidate"]
    out += [f"# Counterfactual replay: {report['workflow']}", "", f"**{verdict}**", ""]
    out += [
        "AI agents, model decisions and judges ran again under the candidate configuration. "
        "Everything else was held as recorded." if report["ai"] == "live" else
        "Recorded AI outputs were replayed too, so only the changed contracts, criteria and rules could make a difference.",
        ""]
    out += ["| | Recorded | Candidate |", "|---|---|---|", f"| Outcome | {baseline['status']} | {candidate['status']} |"]
    if report["ai"] == "live":
        out.append(f"| Attempts | {baseline['attempts']} | {candidate['attempts']} |")
        out.append(f"| Model tokens | {baseline['tokens']} | {candidate['tokens']} |")
    out += [f"| Duration | {_ms(baseline.get('duration_ms'))} | {_ms(candidate.get('duration_ms'))} "
            "(replayed, without real waiting) |", ""]

    divergence = report.get("divergence")
    if not report["same_path"] and divergence:
        out += [f"**The runs took different paths.** After **{divergence['after']}**, the recorded run went to "
                f"**{divergence['baseline_next']}** and the candidate to **{divergence['candidate_next']}**.", ""]
    elif report["same_path"]:
        out += ["Both runs took the same path.", ""]
    else:
        out += ["**The runs took different paths.**", ""]

    def section(title: str, items: list[str]) -> None:
        if items:
            out.extend([f"## {title}", "", *(f"- {item}" for item in items), ""])

    section("Regressions", report["regressions"])
    section("Improvements", report["improvements"])
    section("Could not be replayed", [
        f"No recorded result for {what}. The candidate went somewhere the recorded run never did."
        for what in report["unrecorded"]])

    def side(node: dict[str, Any]) -> str:
        if not node["reached"]:
            return "not reached"
        if node.get("decision"):
            return f"{node['decision']['choice']} ({node['decision']['method']})"
        attempts = node["attempts"]
        return ("accepted" if node["accepted"] else "not accepted") + (
            f", {attempts} attempt{'' if attempts == 1 else 's'}" if attempts else "")

    out += ["## Step by step", "", "| Step | Verdict | Recorded | Candidate | Notes |", "|---|---|---|---|---|"]
    for node in report["nodes"]:
        notes = " ".join(node["notes"]).replace("|", "\\|")
        out.append(f"| {node['node_name']} | {node['verdict'].replace('_', ' ')} | {side(node['baseline'])} | "
                   f"{side(node['candidate'])} | {notes} |")
    out.append("")
    return "\n".join(out)
