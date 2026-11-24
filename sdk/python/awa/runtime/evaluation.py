"""
Evaluation from journals (specification section 33)

Every visit of a run to an AI activity is a labelled example: the input the
agent was given, and the outcome that was accepted (by its outcome contract, by
verification, or by a person to whom it was escalated), or the fact that it was
rejected. build_dataset() turns journals into such cases. evaluate_dataset()
performs each case again under a candidate workflow or model, through
counterfactual replay (section 20): the agent runs again, and the tools it calls
answer as they did when the case was recorded. It reports, per activity, how
often the candidate's outcomes are accepted, and the cases the candidate loses
or wins against the recording.

Follows sdk/typescript/src/runtime/evaluation.ts.
"""

import json
from typing import Any, Callable

from awa.runtime.counterfactual import counterfactual_replay
from awa.runtime.journal import canonical_json, public_payload
from awa.types import Activity, Workflow

Json = dict[str, Any]

_USED = {"activity.started", "activity.completed", "activity.failed", "contract.checked", "verification.completed", "contract.escalated",
         "tool.invoked", "tool.completed", "tool.failed", "token.failed", "activity.dead_lettered"}


def _outcome_of_output(output: Any) -> Any:
    if not isinstance(output, dict):
        return output
    rest = public_payload({k: v for k, v in output.items() if k not in ("output", "usage", "status")})
    if "output" not in output or output["output"] is None:
        return rest
    inner = output["output"]
    return inner if isinstance(inner, dict) else {"output": inner, **rest}


def _held(value: Any) -> bool:
    return value is not None and not (isinstance(value, dict) and len(value) == 1 and isinstance(value.get("sha256"), str))


def _term(v: Any) -> str:
    if isinstance(v, str):
        return v
    if isinstance(v, dict):
        for key in ("name", "path", "message"):
            if v.get(key) is not None:
                return str(v[key])
    return ""


def _data(event: Json) -> Json:
    return event.get("data") if isinstance(event.get("data"), dict) else {}


def build_dataset(events: list[Json]) -> Json:
    """
    Build evaluation cases from journals. Events of several runs may be mixed; each run is read
    in sequence order. Returns {"cases": [...], "skipped": [{run_id, activity_name, reason}]}.
    """
    by_run: dict[str, list[Json]] = {}
    for e in events:
        by_run.setdefault(e["run_id"], []).append(e)
    cases: list[Json] = []
    skipped: list[Json] = []

    for run_id, unsorted in by_run.items():
        journal = sorted(unsorted, key=lambda e: e["seq"])
        started = next((e for e in journal if e["type"] == "run.started"), None)
        visits: list[Json] = []
        open_: dict[str, Json] = {}
        for e in journal:
            if not e.get("node_id"):
                continue
            key = f"{e.get('token_id') or ''}|{e['node_id']}"
            visit = open_.get(key)
            if e["type"] == "activity.started":
                attempt = e.get("attempt") or 1
                if not visit or attempt <= visit["last_attempt"]:
                    visit = {"node_id": e["node_id"], "name": e.get("node_name") or e["node_id"], "events": [], "last_attempt": 0,
                             "ended": None, "ai": _data(e).get("actor_type") == "ai_agent"}
                    visits.append(visit)
                    open_[key] = visit
                visit["last_attempt"] = attempt
            if not visit:
                continue
            visit["events"].append(e)
            if e["type"] == "activity.completed":
                visit["ended"] = "accepted"
                open_.pop(key, None)
            elif e["type"] in ("token.failed", "activity.dead_lettered"):
                visit["ended"] = "rejected"
                open_.pop(key, None)

        count: dict[str, int] = {}
        for visit in visits:
            n = count.get(visit["node_id"], 0) + 1
            count[visit["node_id"]] = n
            if not visit["ai"]:
                continue

            def skip(reason: str, visit: Json = visit) -> None:
                skipped.append({"run_id": run_id, "activity_name": visit["name"], "reason": reason})
            if not visit["ended"]:
                skip("the visit had not ended when the journal was written")
                continue
            first = next(e for e in visit["events"] if e["type"] == "activity.started")
            input_ = _data(first).get("input")
            if not _held(input_):
                skip('the journal does not hold the input (payload mode "hash" or "none")')
                continue
            completed = next((e for e in visit["events"] if e["type"] == "activity.completed"), None)
            if completed and not _held(_data(completed).get("output")):
                skip('the journal does not hold the outcome (payload mode "hash" or "none")')
                continue

            def at(type_: str, attempt: Any = None, visit: Json = visit) -> list[Json]:
                return [e for e in visit["events"] if e["type"] == type_ and (attempt is None or e.get("attempt") == attempt)]

            rejections = []
            for f in at("activity.failed"):
                contract = [c for c in at("contract.checked", f.get("attempt")) if _data(c).get("passed") is False]
                verification = [v for v in at("verification.completed", f.get("attempt")) if _data(v).get("verdict") != "pass"]
                if contract:
                    terms = [_term(v) for v in _data(contract[-1]).get("violations") or []]
                elif verification:
                    terms = [str(c.get("criterion_name") or c.get("name") or c.get("criterion_id")) for c in _data(verification[-1]).get("criteria") or []
                             if isinstance(c, dict) and c.get("passed") is False]
                else:
                    terms = []
                error = _data(f).get("error") if isinstance(_data(f).get("error"), dict) else {}
                rejections.append({"attempt": f.get("attempt") or 1, "code": error.get("code"), "terms": terms})
            calls = []
            for invoked in at("tool.invoked"):
                call_id = _data(invoked).get("call_id")
                end = next((e for e in visit["events"] if e["type"] in ("tool.completed", "tool.failed") and _data(e).get("call_id") == call_id), None)
                d = _data(end) if end else {}
                call: Json = {"tool": _data(invoked).get("tool"), "arguments": _data(invoked).get("arguments"), "ok": bool(end and end["type"] == "tool.completed")}
                if "status" in d:
                    call["status"] = d["status"]
                if call["ok"]:
                    call["result"] = d.get("result")
                else:
                    call["error"] = (d.get("error") or {}).get("message") if isinstance(d.get("error"), dict) else None
                    call["error"] = call["error"] or "no result was recorded"
                calls.append(call)
            case: Json = {
                "id": f"{run_id}:{visit['node_id']}:{n}", "workflow_id": first.get("workflow_id"),
                "workflow_version": _data(started).get("workflow_version") if started else None,
                "run_id": run_id, "activity_id": visit["node_id"], "activity_name": visit["name"], "input": input_,
            }
            if completed:
                final = completed.get("attempt")
                if at("contract.escalated"):
                    accepted_by = "person"
                elif any(_data(v).get("verdict") == "pass" for v in at("verification.completed", final)):
                    accepted_by = "verification"
                elif any(_data(c).get("passed") is True for c in at("contract.checked", final)):
                    accepted_by = "contract"
                else:
                    accepted_by = "unchecked"
                case.update({"label": "accepted", "accepted_by": accepted_by, "outcome": _outcome_of_output(_data(completed).get("output"))})
            else:
                code = rejections[-1]["code"] if rejections else None
                case.update({"label": "rejected",
                             "rejected_by": "contract" if code == "CONTRACT_VIOLATION" else "verification" if code == "VERIFICATION_FAILED" else "error"})
            case.update({"attempts": visit["last_attempt"], "rejections": rejections, "tool_calls": calls,
                         "sources": [e["seq"] for e in visit["events"] if e["type"] in _USED]})
            cases.append(case)
    return {"cases": cases, "skipped": skipped}


def _rate(part: int, whole: int) -> Json:
    return {"value": part / whole if whole else None, "n": whole}


def _isolate(workflow: Workflow, activity: Activity) -> Workflow:
    """The workflow reduced to one activity, so that a case exercises that activity alone"""
    update: Json = {"context_bindings": [], "knowledge": None, "sla": None, "join": "any", "compensation": None}
    if activity.outcome_contract is not None:
        # A person is not asked in an evaluation: an outcome the contract would escalate is rejected
        update["outcome_contract"] = activity.outcome_contract.model_copy(update={"on_violation": "fail"})
    return workflow.model_copy(update={"activities": [activity.model_copy(update=update)], "edges": [], "events": [], "decision_nodes": [], "contexts": [], "sla": None})


def _case_journal(case: Json, workflow: Workflow) -> list[Json]:
    """A journal that holds exactly what the case recorded: its input, its tool calls, and its result"""
    events: list[Json] = []

    def add(type_: str, data: Json, at_node: bool = True) -> None:
        event: Json = {"spec_version": "1.1", "id": f"{case['id']}#{len(events) + 1}", "run_id": case["run_id"], "seq": len(events) + 1,
                       "time": "1970-01-01T00:00:00.000Z", "type": type_, "level": "execution", "workflow_id": str(workflow.id)}
        if at_node:
            event.update({"node_id": case["activity_id"], "node_name": case["activity_name"], "attempt": 1, "token_id": "case"})
        event["data"] = data
        events.append(event)

    add("run.started", {"workflow_name": workflow.name, "workflow_version": case.get("workflow_version"), "input": case["input"]}, False)
    add("activity.started", {"actor_type": "ai_agent", "input": case["input"]})
    for i, call in enumerate(case.get("tool_calls") or []):
        add("tool.invoked", {"call_id": f"call-{i}", "tool": call["tool"], "arguments": call.get("arguments")})
        if call.get("ok"):
            add("tool.completed", {"call_id": f"call-{i}", "tool": call["tool"], "status": call.get("status"), "result": call.get("result")})
        else:
            add("tool.failed", {"call_id": f"call-{i}", "tool": call["tool"], "invoked": True, "error": {"message": call.get("error")}})
    if case["label"] == "accepted":
        add("activity.completed", {"actor_type": "ai_agent", "output": case.get("outcome")})
        add("run.completed", {}, False)
    else:
        rejections = case.get("rejections") or []
        add("activity.failed", {"error": {"code": rejections[-1]["code"] if rejections else None}})
        add("run.failed", {}, False)
    return events


def evaluate_dataset(workflow: Workflow, cases: list[Json], candidate: Workflow | None = None, engine: Json | None = None,
                     engine_for_case: Callable[[Json], Json | None] | None = None) -> Json:
    """
    Perform every case again under the candidate and score the outcomes against contracts and verification.

    candidate:       the workflow to evaluate instead of the one the cases were recorded with; activities are matched by id
    engine:          engine options for the candidate: model_providers and tiers, or actors with the ai_agent to run
    engine_for_case: further engine options for one case, merged over `engine`
    """
    candidate = candidate or workflow
    results: list[Json] = []
    skipped: list[Json] = []
    for c in cases:
        if c.get("workflow_id") != str(workflow.id):
            skipped.append({"case_id": c["id"], "reason": f"recorded with workflow {c.get('workflow_id')}, not {workflow.id}"})
            continue
        recorded_activity = next((a for a in workflow.activities if str(a.id) == c["activity_id"]), None)
        activity = next((a for a in candidate.activities if str(a.id) == c["activity_id"]), None)
        if not activity or not recorded_activity:
            missing = "recorded workflow" if activity else "candidate"
            skipped.append({"case_id": c["id"], "reason": f"the {missing} has no activity {c['activity_id']} (\"{c.get('activity_name')}\")"})
            continue
        extra = (engine_for_case(c) if engine_for_case else None) or {}
        options = {**(engine or {}), **extra, "actors": {**((engine or {}).get("actors") or {}), **(extra.get("actors") or {})}}
        if not options["actors"]:
            options.pop("actors")
        replay = counterfactual_replay(_isolate(workflow, recorded_activity), _case_journal(c, workflow),
                                       candidate=_isolate(candidate, activity), ai="live", engine=options)

        def at(type_: str) -> list[Json]:
            return [e for e in replay.events if e["type"] == type_ and e.get("node_id") == c["activity_id"]]
        completed = at("activity.completed")
        contracts, verifications = at("contract.checked"), at("verification.completed")
        accepted = bool(completed)
        outcome = _outcome_of_output(_data(completed[-1]).get("output")) if completed else None
        change = "regressed" if c["label"] == "accepted" and not accepted else "improved" if c["label"] == "rejected" and accepted else "same"
        failure = at("activity.failed")
        result: Json = {
            "case_id": c["id"], "activity_id": c["activity_id"], "activity_name": activity.name,
            "recorded": c["label"], "candidate": "accepted" if accepted else "rejected",
            "attempts": len(at("activity.started")),
            "contract_passed": _data(contracts[-1]).get("passed") is True if contracts else None,
            "verification_passed": _data(verifications[-1]).get("verdict") == "pass" if verifications else None,
            "same_outcome": canonical_json(outcome) == canonical_json(c.get("outcome")) if c["label"] == "accepted" and accepted else None,
            "change": change,
        }
        if not accepted and failure:
            error = _data(failure[-1]).get("error") or {}
            result["error"] = f"{error.get('code') or 'ERROR'}: {error.get('message') or ''}".strip()
        result["unrecorded"] = list(replay.report.get("unrecorded") or [])
        results.append(result)

    groups: dict[str, list[Json]] = {}
    for r in results:
        groups.setdefault(r["activity_id"], []).append(r)

    def score(items: list[Json]) -> Json:
        contract = [r for r in items if r["contract_passed"] is not None]
        verification = [r for r in items if r["verification_passed"] is not None]
        both = [r for r in items if r["same_outcome"] is not None]
        return {
            "recorded_rate": _rate(sum(1 for r in items if r["recorded"] == "accepted"), len(items)),
            "pass_rate": _rate(sum(1 for r in items if r["candidate"] == "accepted"), len(items)),
            "contract_pass_rate": _rate(sum(1 for r in contract if r["contract_passed"]), len(contract)),
            "verification_pass_rate": _rate(sum(1 for r in verification if r["verification_passed"]), len(verification)),
            "same_outcome_rate": _rate(sum(1 for r in both if r["same_outcome"]), len(both)),
        }

    def reason(r: Json) -> str:
        if r["change"] == "regressed":
            return "accepted when recorded; the candidate's outcome was rejected" + (f" ({r['error']})" if r.get("error") else "")
        return "rejected when recorded; the candidate's outcome was accepted"

    activities = [{"activity_id": aid, "activity_name": items[0]["activity_name"], "cases": len(items), **score(items),
                   "regressions": [r["case_id"] for r in items if r["change"] == "regressed"],
                   "improvements": [r["case_id"] for r in items if r["change"] == "improved"]} for aid, items in groups.items()]
    totals = score(results)
    return {
        "spec_version": "1.1",
        "workflow": {"id": str(workflow.id), "name": workflow.name},
        "candidate": {"id": str(candidate.id), "name": candidate.name, "version": candidate.version},
        "cases": len(cases), "evaluated": len(results), "skipped": skipped,
        "totals": {k: totals[k] for k in ("recorded_rate", "pass_rate", "contract_pass_rate", "verification_pass_rate")},
        "activities": activities,
        "regressions": [{"case_id": r["case_id"], "activity_name": r["activity_name"], "reason": reason(r)} for r in results if r["change"] == "regressed"],
        "improvements": [{"case_id": r["case_id"], "activity_name": r["activity_name"], "reason": reason(r)} for r in results if r["change"] == "improved"],
        "results": results,
    }


def dataset_to_jsonl(cases: list[Json]) -> str:
    """A dataset as JSON Lines, one case per line"""
    return "".join(json.dumps(c, ensure_ascii=False) + "\n" for c in cases)


def parse_dataset(content: str) -> list[Json]:
    return [json.loads(line) for line in content.split("\n") if line.strip()]


def _percent(r: Json) -> str:
    return "no value" if r["value"] is None else f"{int(r['value'] * 100 + 0.5)}% of {r['n']}"


def render_evaluation_report(report: Json) -> str:
    """The report as Markdown"""
    out = [f"# Evaluation: {report['candidate']['name']} {report['candidate']['version']}", ""]
    if report["regressions"]:
        out.append(f"**The candidate loses {len(report['regressions'])} case(s) that were accepted when recorded.**")
    elif report["improvements"]:
        out.append("**The candidate loses no recorded case and wins at least one.**")
    else:
        out.append("**The candidate gets the same cases accepted as the recording.**")
    out += ["", f"{report['evaluated']} of {report['cases']} case(s) evaluated against the outcome contracts and verification of {report['candidate']['name']}. "
                "Each case's AI activity ran again; the tools it called answered as recorded.", "",
            "| Activity | Cases | Accepted when recorded | Accepted now | Contract met | Verification passed | Same outcome | Regressions | Improvements |",
            "|---|---|---|---|---|---|---|---|---|"]
    for a in report["activities"]:
        out.append(f"| {a['activity_name']} | {a['cases']} | {_percent(a['recorded_rate'])} | {_percent(a['pass_rate'])} | {_percent(a['contract_pass_rate'])} | "
                   f"{_percent(a['verification_pass_rate'])} | {_percent(a['same_outcome_rate'])} | {len(a['regressions'])} | {len(a['improvements'])} |")
    out.append("")
    for title, items in (("Regressions", report["regressions"]), ("Improvements", report["improvements"])):
        if items:
            out += [f"## {title}", ""] + [f"- {i['activity_name']}, case {i['case_id']}: {i['reason']}" for i in items] + [""]
    if report["skipped"]:
        out += ["## Not evaluated", ""] + [f"- {s['case_id']}: {s['reason']}" for s in report["skipped"]] + [""]
    return "\n".join(out)
