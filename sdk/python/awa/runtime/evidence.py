"""
Evidence (specification section 32)

An evidence report says, for a period and a set of workflows, what ran, which
models decided what, what people decided, what was checked and with what
result, what was refused, what failed and was undone, which outside systems
were called, how data was journalled, and which records are held. Every
statement is computed from journals and journey records, never estimated, and
cites the records it rests on: a run id and sequence numbers, or a journey
instance and sequence numbers.

Each part names the provisions it can serve as evidence for: articles of the EU
AI Act (Regulation (EU) 2024/1689), functions of the NIST AI Risk Management
Framework and clauses of ISO/IEC 42001. The report is evidence a deployer can
use. It does not certify compliance with anything.

Follows sdk/typescript/src/runtime/evidence.ts.
"""

import html as _html
import math
from typing import Any

from awa.runtime.kpi import _iso, _ms, _now_iso

Json = dict[str, Any]

EVIDENCE_NOTICE = (
    "This report is evidence computed from the execution journals and journey records listed in it. Every statement cites the records it rests on. "
    "It is not a certification, an audit opinion or a conformity assessment: it does not establish that any system, deployer or provider complies "
    "with the EU AI Act, the NIST AI RMF, ISO/IEC 42001 or any other framework. Whether these records meet an obligation depends on the system, "
    "its intended purpose, its risk classification and the applicable law, which this report does not assess."
)


def _ref(id: str, label: str, title: str) -> Json:
    return {"id": id, "label": label, "title": title}


EVIDENCE_FRAMEWORKS: list[Json] = [
    {"id": "eu-ai-act", "name": "Regulation (EU) 2024/1689 (AI Act)", "references": [
        _ref("eu-ai-act:12(1)", "Art. 12(1)", "Record-keeping: automatic recording of events over the lifetime of the system"),
        _ref("eu-ai-act:12(2)", "Art. 12(2)", "Logging that enables identifying situations of risk, post-market monitoring and monitoring of operation"),
        _ref("eu-ai-act:13(3)(b)", "Art. 13(3)(b)", "Information to deployers on characteristics, capabilities and limitations of performance, including accuracy"),
        _ref("eu-ai-act:13(3)(d)", "Art. 13(3)(d)", "Information to deployers on the human oversight measures"),
        _ref("eu-ai-act:13(3)(f)", "Art. 13(3)(f)", "Information to deployers on how to collect, store and interpret the logs"),
        _ref("eu-ai-act:14(4)", "Art. 14(4)", "Human oversight: monitoring, interpreting, disregarding, overriding or reversing outputs, and interrupting the system"),
        _ref("eu-ai-act:15(1)", "Art. 15(1)", "An appropriate level of accuracy and robustness"),
        _ref("eu-ai-act:15(3)", "Art. 15(3)", "Levels of accuracy and the relevant metrics"),
        _ref("eu-ai-act:15(4)", "Art. 15(4)", "Resilience to errors, faults and inconsistencies; fail-safe plans"),
        _ref("eu-ai-act:26(2)", "Art. 26(2)", "Deployers assign human oversight to persons with the competence and authority"),
        _ref("eu-ai-act:26(5)", "Art. 26(5)", "Deployers monitor the operation of the system"),
        _ref("eu-ai-act:26(6)", "Art. 26(6)", "Deployers keep the automatically generated logs under their control for an appropriate period of at least six months, unless other law provides otherwise"),
    ]},
    {"id": "nist-ai-rmf", "name": "NIST AI Risk Management Framework 1.0 (NIST AI 100-1)", "references": [
        _ref("nist-ai-rmf:GOVERN", "GOVERN", "Policies, accountability and human oversight"),
        _ref("nist-ai-rmf:MAP", "MAP", "Context, and dependencies on third parties"),
        _ref("nist-ai-rmf:MEASURE", "MEASURE", "Measuring and monitoring trustworthiness, in production included"),
        _ref("nist-ai-rmf:MANAGE", "MANAGE", "Responding to and recovering from errors and incidents"),
    ]},
    {"id": "iso-iec-42001", "name": "ISO/IEC 42001:2023 (AI management system)", "references": [
        _ref("iso-iec-42001:9.1", "Clause 9.1", "Monitoring, measurement, analysis and evaluation"),
        _ref("iso-iec-42001:A.6", "Annex A.6", "AI system life cycle, event logs included"),
        _ref("iso-iec-42001:A.7", "Annex A.7", "Data for AI systems"),
        _ref("iso-iec-42001:A.9", "Annex A.9", "Use of AI systems"),
        _ref("iso-iec-42001:A.10", "Annex A.10", "Third-party and customer relationships"),
    ]},
]

EVIDENCE_PARTS: list[Json] = [
    {"id": "operation", "title": "What ran", "question": "Which runs and journeys took place in the period, with which workflow versions, and how did each end?",
     "serves": ["eu-ai-act:12(1)", "eu-ai-act:12(2)", "eu-ai-act:26(5)", "nist-ai-rmf:MEASURE", "iso-iec-42001:9.1", "iso-iec-42001:A.6"]},
    {"id": "models", "title": "Models and what they decided", "question": "Which models, as named by their providers, served which activities and decisions, and where did a route fall back?",
     "serves": ["eu-ai-act:12(2)", "eu-ai-act:13(3)(b)", "nist-ai-rmf:MAP", "nist-ai-rmf:MEASURE", "iso-iec-42001:A.6"]},
    {"id": "oversight", "title": "Human oversight", "question": "What did people decide, what was escalated to them, where did a person decide in place of an automated outcome, and which runs were stopped?",
     "serves": ["eu-ai-act:13(3)(d)", "eu-ai-act:14(4)", "eu-ai-act:26(2)", "nist-ai-rmf:GOVERN", "nist-ai-rmf:MANAGE", "iso-iec-42001:A.9"]},
    {"id": "outcomes", "title": "Outcome contracts and verification", "question": "Which outcomes were checked against their contracts and verified, and with what result?",
     "serves": ["eu-ai-act:13(3)(b)", "eu-ai-act:15(1)", "eu-ai-act:15(3)", "nist-ai-rmf:MEASURE", "iso-iec-42001:9.1"]},
    {"id": "refusals", "title": "Refusals", "question": "What did the engine refuse to do before it happened?",
     "serves": ["eu-ai-act:12(2)", "eu-ai-act:15(4)", "nist-ai-rmf:MANAGE", "iso-iec-42001:A.6"]},
    {"id": "failures", "title": "Failures", "question": "Which attempts, tool calls, runs and journeys failed or stalled, and why?",
     "serves": ["eu-ai-act:12(2)", "eu-ai-act:15(4)", "eu-ai-act:26(5)", "nist-ai-rmf:MANAGE", "iso-iec-42001:A.6"]},
    {"id": "compensations", "title": "Compensations", "question": "Which completed work was undone after a failure, and did undoing it succeed?",
     "serves": ["eu-ai-act:15(4)", "nist-ai-rmf:MANAGE"]},
    {"id": "service_levels", "title": "Service levels", "question": "Where did work take longer than was promised?",
     "serves": ["eu-ai-act:12(2)", "eu-ai-act:26(5)", "nist-ai-rmf:MEASURE", "nist-ai-rmf:MANAGE"]},
    {"id": "tools", "title": "Tool calls by target", "question": "Which outside systems were called, how often, and with what result?",
     "serves": ["eu-ai-act:12(2)", "eu-ai-act:26(5)", "nist-ai-rmf:MAP", "iso-iec-42001:A.10"]},
    {"id": "data", "title": "Data handled", "question": "How were inputs, outputs, tool arguments and results journalled, and which shared contexts were read and written?",
     "serves": ["eu-ai-act:12(1)", "eu-ai-act:26(6)", "nist-ai-rmf:GOVERN", "iso-iec-42001:A.7"]},
    {"id": "retention", "title": "The records themselves", "question": "Which records does this report rest on, over what span, and are they complete?",
     "serves": ["eu-ai-act:12(1)", "eu-ai-act:13(3)(f)", "eu-ai-act:26(6)", "nist-ai-rmf:GOVERN", "iso-iec-42001:A.6"]},
]

_PAYLOAD_FIELDS = {"run.started": "input", "activity.started": "input", "activity.completed": "output", "tool.invoked": "arguments", "tool.completed": "result"}
_END_TYPES = ("run.completed", "run.failed", "run.cancelled")


def _short(id: Any) -> str:
    text = str(id)
    return text[:8] if len(text) > 8 else text


def _d(event: Json) -> Json:
    data = event.get("data")
    return data if isinstance(data, dict) else {}


def _uniq(values: list[Any]) -> list[Any]:
    return list(dict.fromkeys(values))


def _cite(*events: Json | None) -> list[Json]:
    """Citations grouped by run or journey instance, each with its sequence numbers in order"""
    runs: dict[str, set[int]] = {}
    journeys: dict[str, set[int]] = {}
    for e in events:
        if not e:
            continue
        if e.get("journey_instance_id"):
            journeys.setdefault(e["journey_instance_id"], set()).add(e["seq"])
        else:
            runs.setdefault(e.get("run_id") or "", set()).add(e["seq"])
    return [{"run_id": k, "seq": sorted(v)} for k, v in runs.items()] + [{"journey_instance_id": k, "seq": sorted(v)} for k, v in journeys.items()]


def _payload_kind(value: Any) -> str:
    """The kind of payload a journalled value is: the value itself, its hash, or nothing (9.4)"""
    if value is None:
        return "none"
    if isinstance(value, dict) and len(value) == 1 and isinstance(value.get("sha256"), str):
        return "hash"
    return "full"


def _by_code(codes: list[str]) -> list[Json]:
    counts: dict[str, int] = {}
    for code in codes:
        counts[code] = counts.get(code, 0) + 1
    return sorted(({"code": c, "count": n} for c, n in counts.items()), key=lambda x: (-x["count"], x["code"]))


def _duration(value: float) -> str:
    if value < 1000:
        return f"{round(value)} ms"
    if value < 90_000:
        return f"{round(value / 1000)} s"
    if value < 90 * 60_000:
        return f"{round(value / 60_000)} min"
    if value < 48 * 3_600_000:
        return f"{value / 3_600_000:.1f} h"
    return f"{value / 86_400_000:.1f} days"


def _statement(kind: str, text: str, facts: Json, citations: list[Json]) -> Json:
    return {"kind": kind, "text": text, "facts": facts, "citations": citations}


def _term(v: Any) -> str:
    if isinstance(v, str):
        return v
    if isinstance(v, dict):
        for key in ("name", "path", "message"):
            if v.get(key) is not None:
                return str(v[key])
    return ""


def compute_evidence(record: Json, options: Json | None = None) -> Json:
    """
    Compute the evidence report of section 32 from what was recorded: a portfolio as a host
    exports it (journeys with their instances and runs), and runs that belong to no journey.

    options: from, to (instants; runs and journeys are kept by their start), workflow_ids
    """
    options = options or {}
    lo = _ms(options["from"]) if options.get("from") else -math.inf
    hi = _ms(options["to"]) if options.get("to") else math.inf

    def within(iso: Any) -> bool:
        t = _ms(iso)
        if math.isnan(t):
            return lo == -math.inf and hi == math.inf
        return lo <= t < hi

    wanted = set(options["workflow_ids"]) if options.get("workflow_ids") else None
    catalogue: dict[str, Json] = {}
    for w in record.get("workflows") or []:
        catalogue[w["id"]] = {"name": w.get("name"), "version": w.get("version"),
                              "actor_types": {a["id"]: a.get("actor_type") or "" for a in w.get("activities") or []}}

    owner: dict[str, str] = {}
    every_run: dict[str, Json] = {}
    for j in record.get("journeys") or []:
        for row in j.get("instances") or []:
            for r in row.get("runs") or []:
                every_run[r["run_id"]] = r
                owner[r["run_id"]] = row["instance"]["id"]
    for r in record.get("runs") or []:
        every_run.setdefault(r["run_id"], r)

    runs: list[Json] = []
    for run in every_run.values():
        if wanted is not None and run.get("workflow_id") not in wanted:
            continue
        events = sorted(({**e, "run_id": e.get("run_id") or run["run_id"]} for e in run.get("events") or []), key=lambda e: e["seq"])
        started = next((e for e in events if e["type"] == "run.started"), None)
        first = started or (events[0] if events else None)
        if not within(first["time"] if first else None):
            continue
        ended = next((e for e in reversed(events) if e["type"] in _END_TYPES), None)
        sd = _d(started) if started else {}
        runs.append({
            "run": run, "events": events, "started": started, "ended": ended, "start": _ms(first["time"]) if first else math.nan,
            "name": sd.get("workflow_name") or catalogue.get(run.get("workflow_id"), {}).get("name") or run.get("workflow_id"),
            "version": sd.get("workflow_version") if sd.get("workflow_version") is not None else catalogue.get(run.get("workflow_id"), {}).get("version"),
            "journey_instance_id": owner.get(run["run_id"]),
        })
    runs.sort(key=lambda r: (r["start"] if not math.isnan(r["start"]) else math.inf, r["run"]["run_id"]))
    kept_runs = {r["run"]["run_id"] for r in runs}

    instances: list[Json] = []
    for j in record.get("journeys") or []:
        for row in j.get("instances") or []:
            instance = row["instance"]
            if not within(instance.get("started_at")):
                continue
            if wanted is not None and not any(r["run_id"] in kept_runs for r in row.get("runs") or []):
                continue
            instances.append({"journey_id": j["definition"]["id"], "name": j["definition"].get("name"), "instance": instance,
                              "events": sorted(({**e, "journey_instance_id": instance["id"]} for e in instance.get("events") or []), key=lambda e: e["seq"])})
    instances.sort(key=lambda i: (_ms(i["instance"].get("started_at")), i["instance"]["id"]))

    every = [(e, r) for r in runs for e in r["events"]]

    def of(*types: str) -> list[Json]:
        return [e for e, _ in every if e["type"] in types]

    def node(e: Json) -> str:
        return e.get("node_name") or e.get("node_id") or ""

    def actor_type(r: Json, e: Json) -> str:
        return _d(e).get("actor_type") or catalogue.get(r["run"].get("workflow_id"), {}).get("actor_types", {}).get(e.get("node_id") or "", "")

    def status_of(r: Json) -> str:
        if not r["ended"]:
            return "in_progress"
        return {"run.completed": "completed", "run.failed": "failed"}.get(r["ended"]["type"], "cancelled")

    # --- What ran ---------------------------------------------------------------
    operation: list[Json] = []
    for r in runs:
        status = status_of(r)
        first = r["started"] or (r["events"][0] if r["events"] else None)
        started_at = first["time"] if first else None
        ending = " and had not ended when recorded" if status == "in_progress" else \
            f" and {'completed' if status == 'completed' else 'failed' if status == 'failed' else 'was cancelled'} at {r['ended']['time']}"
        operation.append(_statement(
            "run", f"Run {_short(r['run']['run_id'])} of \"{r['name']}\"{' version ' + r['version'] if r['version'] else ''} started at {started_at}{ending}.",
            {"run_id": r["run"]["run_id"], "workflow_id": r["run"].get("workflow_id"), "workflow_name": r["name"], "workflow_version": r["version"],
             "status": status, "started_at": started_at, "ended_at": r["ended"]["time"] if r["ended"] else None, "journey_instance_id": r["journey_instance_id"]},
            _cite(r["started"], r["ended"])))
    for i in instances:
        inst = i["instance"]
        start = next((e for e in i["events"] if e["type"] == "journey.started"), None)
        end = next((e for e in reversed(i["events"]) if e["type"] in ("journey.completed", "journey.abandoned")), None)
        state = "was in progress when recorded" if inst.get("status") == "active" else f"was {inst.get('status')} at {inst.get('ended_at') or (end or {}).get('time')}"
        operation.append(_statement(
            "journey", f"Journey \"{i['name']}\" of subject {inst.get('subject_key')} started at {inst.get('started_at')} and {state}.",
            {"journey_id": i["journey_id"], "journey_instance_id": inst["id"], "subject_key": inst.get("subject_key"), "status": inst.get("status"),
             "started_at": inst.get("started_at"), "ended_at": inst.get("ended_at")},
            _cite(start, end)))
    workflows_scope = []
    for wid in _uniq([r["run"].get("workflow_id") for r in runs]):
        mine = [r for r in runs if r["run"].get("workflow_id") == wid]
        workflows_scope.append({"workflow_id": wid, "name": mine[0]["name"], "versions": sorted(_uniq([r["version"] for r in mine if r["version"]])), "runs": len(mine)})

    def count_status(s: str) -> int:
        return sum(1 for r in runs if status_of(r) == s)

    # --- Models -----------------------------------------------------------------
    selections = [e for e in of("meta.recorded") if _d(e).get("subject") == "model_selection" and isinstance(_d(e).get("model"), dict)]
    models: dict[str, Json] = {}
    for e in selections:
        m = _d(e)["model"]
        key = f"{m.get('provider') or ''}|{m.get('id')}|{e.get('node_id') or ''}"
        if key not in models:
            models[key] = {"facts": {"provider": m.get("provider"), "model": m.get("id"), "requested": m.get("requested"), "tier": m.get("tier"),
                                     "node_id": e.get("node_id"), "node_name": node(e)}, "events": []}
        models[key]["events"].append(e)

    def model_name(f: Json) -> str:
        return f"{f['provider'] + ':' if f['provider'] else ''}{f['model']}"

    model_statements: list[Json] = []
    for m in sorted(models.values(), key=lambda m: f"{m['facts']['provider']}:{m['facts']['model']}:{m['facts']['node_name']}"):
        f, n = m["facts"], len(m["events"])
        model_statements.append(_statement(
            "model", f"{model_name(f)} served \"{f['node_name']}\" {n} time{'' if n == 1 else 's'}{', requested as ' + f['requested'] if f['requested'] else ''}.",
            {**f, "uses": n}, _cite(*m["events"])))
    for e in of("meta.recorded"):
        if _d(e).get("subject") == "model_route":
            model_statements.append(_statement("route", f"At \"{node(e)}\" in run {_short(e['run_id'])}: {_d(e).get('decision')}. {_d(e).get('rationale') or ''}".strip(),
                                               {"run_id": e["run_id"], "node_name": node(e), "decision": _d(e).get("decision")}, _cite(e)))
    for e in of("decision.evaluated"):
        if _d(e).get("method") == "model":
            m = _d(e).get("model") or {}
            option, confidence = m.get("option"), m.get("confidence")
            model_statements.append(_statement(
                "model_decision", f"A model decided \"{node(e)}\" in run {_short(e['run_id'])}: option {option}" + (f" with a stated confidence of {confidence}" if confidence is not None else "") + ".",
                {"run_id": e["run_id"], "node_name": node(e), "option": option, "confidence": confidence}, _cite(e)))

    # --- Human oversight --------------------------------------------------------
    oversight: list[Json] = []
    overrides = 0
    for r in runs:
        for done in [e for e in r["events"] if e["type"] == "activity.completed"]:
            def same(e: Json, done: Json = done) -> bool:
                return e.get("node_id") == done.get("node_id") and e.get("token_id") == done.get("token_id") and e["seq"] < done["seq"]
            last_start = next((e for e in reversed(r["events"]) if e["type"] == "activity.started" and same(e)), None)
            visit = [e for e in r["events"] if same(e) and (not last_start or e["seq"] > last_start["seq"])]
            escalated = next((e for e in visit if e["type"] == "contract.escalated"), None)
            if not escalated and actor_type(r, done) != "human":
                continue
            if escalated:
                overrides += 1
            related = [e for e in visit if e["type"] in ("token.waiting", "token.resumed", "contract.escalated")
                       or (e["type"] == "contract.checked" and _d(e).get("decided_by") == "human")]
            resumed = next((e for e in related if e["type"] == "token.resumed"), None)
            waited = _d(resumed).get("waited_ms") if resumed else None
            oversight.append(_statement(
                "human_decision",
                f"A person decided \"{node(done)}\" in run {_short(r['run']['run_id'])} at {done['time']}"
                + (", in place of an outcome that was rejected and escalated to them" if escalated else "")
                + (f", after a wait of {_duration(float(waited))}" if waited is not None else "") + ".",
                {"run_id": r["run"]["run_id"], "node_name": node(done), "escalated": bool(escalated), "decided_at": done["time"]},
                _cite(*related, done)))
    for e in of("contract.escalated"):
        oversight.append(_statement("escalation", f"\"{node(e)}\" in run {_short(e['run_id'])} was escalated to a person ({_d(e).get('code')}): {_d(e).get('message')}",
                                    {"run_id": e["run_id"], "node_name": node(e), "code": _d(e).get("code")}, _cite(e)))
    for e in of("run.cancelled"):
        oversight.append(_statement("cancellation", f"Run {_short(e['run_id'])} was stopped: {_d(e).get('reason') or 'no reason recorded'}.",
                                    {"run_id": e["run_id"], "reason": _d(e).get("reason")}, _cite(e)))

    # --- Outcome contracts and verification -------------------------------------
    contracts, verifications = of("contract.checked"), of("verification.completed")
    outcomes: list[Json] = []
    for e in contracts:
        violations = [_term(v) for v in _d(e).get("violations") or []]
        decided_by = _d(e).get("decided_by") or "engine"
        passed = _d(e).get("passed") is True
        outcomes.append(_statement(
            "contract",
            f"The outcome contract of \"{node(e)}\" {'held' if passed else 'was violated (' + '; '.join(violations) + ')'} at attempt {e.get('attempt', '?')} of run {_short(e['run_id'])}"
            + ("; the outcome was a person's" if decided_by == "human" else "") + ".",
            {"run_id": e["run_id"], "node_name": node(e), "attempt": e.get("attempt"), "passed": passed, "violations": violations, "decided_by": decided_by}, _cite(e)))
    for e in verifications:
        score = _d(e).get("score")
        score = score if isinstance(score, (int, float)) and not isinstance(score, bool) else None
        outcomes.append(_statement(
            "verification",
            f"Verification ({_d(e).get('mode')}) of \"{node(e)}\" at attempt {e.get('attempt', '?')} of run {_short(e['run_id'])}: {_d(e).get('verdict')}" + (f", score {score}" if score is not None else "") + ".",
            {"run_id": e["run_id"], "node_name": node(e), "attempt": e.get("attempt"), "mode": _d(e).get("mode"), "verdict": _d(e).get("verdict"), "score": score}, _cite(e)))
    per_activity: dict[str, Json] = {}

    def tally(e: Json) -> Json:
        return per_activity.setdefault(node(e), {"node_name": node(e), "contracts": 0, "contracts_passed": 0, "verifications": 0, "verifications_passed": 0})
    for e in contracts:
        t = tally(e)
        t["contracts"] += 1
        t["contracts_passed"] += 1 if _d(e).get("passed") is True else 0
    for e in verifications:
        t = tally(e)
        t["verifications"] += 1
        t["verifications_passed"] += 1 if _d(e).get("verdict") == "pass" else 0

    # --- Refusals and failures --------------------------------------------------
    refused = [e for e in of("tool.failed") if _d(e).get("invoked") is False]
    err = lambda e: _d(e).get("error") if isinstance(_d(e).get("error"), dict) else {}  # noqa: E731
    refusals: list[Json] = [_statement(
        "tool_refused", f"A call to {_d(e).get('tool')} at \"{node(e)}\" in run {_short(e['run_id'])} was refused before it ran ({err(e).get('code')}): {err(e).get('message')}",
        {"run_id": e["run_id"], "node_name": node(e), "tool": _d(e).get("tool"), "link": _d(e).get("link"), "code": err(e).get("code")}, _cite(e)) for e in refused]
    refusals += [_statement(
        "context_denied", f"A write to the context \"{_d(e).get('context_name')}\" by \"{node(e)}\" in run {_short(e['run_id'])} was refused: {_d(e).get('reason')}.",
        {"run_id": e["run_id"], "node_name": node(e), "context_name": _d(e).get("context_name"), "reason": _d(e).get("reason")}, _cite(e)) for e in of("context.denied")]
    failed_tools = [e for e in of("tool.failed") if _d(e).get("invoked") is not False]
    stalls = [(e, i) for i in instances for e in i["events"] if e["type"] == "journey.stalled"]
    failures: list[Json] = [_statement(
        "attempt_failed", f"Attempt {e.get('attempt', '?')} of \"{node(e)}\" in run {_short(e['run_id'])} failed ({err(e).get('code') or 'no code'}): {err(e).get('message') or ''}".strip(),
        {"run_id": e["run_id"], "node_name": node(e), "attempt": e.get("attempt"), "code": err(e).get("code")}, _cite(e)) for e in of("activity.failed")]
    failures += [_statement("dead_letter", f"\"{node(e)}\" in run {_short(e['run_id'])} was dead-lettered after {_d(e).get('attempts', '?')} attempts.",
                            {"run_id": e["run_id"], "node_name": node(e), "attempts": _d(e).get("attempts")}, _cite(e)) for e in of("activity.dead_lettered")]
    failures += [_statement("tool_failed", f"A call to {_d(e).get('tool')} at \"{node(e)}\" in run {_short(e['run_id'])} failed ({err(e).get('code') or 'no code'}).",
                            {"run_id": e["run_id"], "node_name": node(e), "tool": _d(e).get("tool"), "link": _d(e).get("link"), "code": err(e).get("code")}, _cite(e)) for e in failed_tools]
    failures += [_statement("run_failed", f"Run {_short(e['run_id'])} failed.", {"run_id": e["run_id"]}, _cite(e)) for e in of("run.failed")]
    failures += [_statement(
        "journey_stalled", f"The journey \"{i['name']}\" of subject {i['instance'].get('subject_key')} stalled in stage {e.get('stage_id')}" + (f": {_d(e)['reason']}" if _d(e).get("reason") else "") + ".",
        {"journey_instance_id": i["instance"]["id"], "stage_id": e.get("stage_id"), "run_id": e.get("run_id")}, _cite(e)) for e, i in stalls]

    # --- Compensations and service levels ---------------------------------------
    compensations = []
    for e in of("activity.compensated", "activity.compensation_failed"):
        succeeded = e["type"] == "activity.compensated"
        compensates = _d(e).get("compensates_activity_name") or _d(e).get("compensates_activity_id")
        compensations.append(_statement("compensation", f"\"{compensates}\" in run {_short(e['run_id'])} {'was undone' if succeeded else 'could not be undone'} by \"{node(e)}\".",
                                        {"run_id": e["run_id"], "node_name": node(e), "compensates": compensates, "succeeded": succeeded}, _cite(e)))
    service_levels = []
    for e in of("sla.warning", "sla.breached"):
        level = "breach" if e["type"] == "sla.breached" else "warning"
        limit = _d(e).get("max_time") if level == "breach" else _d(e).get("threshold")
        who = f"Run {_short(e['run_id'])}" if _d(e).get("scope") == "workflow" else f"\"{node(e)}\" in run {_short(e['run_id'])}"
        service_levels.append(_statement(
            "sla", f"{who} {'breached its service level' if level == 'breach' else 'passed its point of warning'} after {_duration(float(_d(e).get('elapsed_ms') or 0))} (limit {limit}).",
            {"run_id": e["run_id"], "node_name": node(e) if e.get("node_id") else None, "level": level, "scope": _d(e).get("scope"),
             "elapsed_ms": _d(e).get("elapsed_ms"), "limit": limit, "action": _d(e).get("action")}, _cite(e)))

    # --- Tool calls by target ---------------------------------------------------
    targets: dict[str, Json] = {}
    for r in runs:
        links: dict[Any, str] = {}
        for e in r["events"]:
            if e["type"] not in ("tool.invoked", "tool.completed", "tool.failed"):
                continue
            d = _d(e)
            link = d.get("link") or links.get(d.get("call_id")) or f"tool:{d.get('tool')}"
            if d.get("call_id"):
                links[d["call_id"]] = link
            t = targets.setdefault(link, {"link": link, "tools": set(), "calls": 0, "completed": 0, "failed": 0, "refused": 0, "events": []})
            if d.get("tool"):
                t["tools"].add(d["tool"])
            t["events"].append(e)
            if e["type"] == "tool.invoked":
                t["calls"] += 1
            elif e["type"] == "tool.completed":
                t["completed"] += 1
            elif d.get("invoked") is False:
                t["refused"] += 1
            else:
                t["failed"] += 1
    tool_statements = []
    for t in sorted(targets.values(), key=lambda t: t["link"]):
        tools = sorted(t["tools"])
        tool_statements.append(_statement(
            "target", f"{t['link']}: {t['calls']} call{'' if t['calls'] == 1 else 's'} by {', '.join(tools)}; {t['completed']} completed, {t['failed']} failed, {t['refused']} refused.",
            {"link": t["link"], "tools": tools, "calls": t["calls"], "completed": t["completed"], "failed": t["failed"], "refused": t["refused"]}, _cite(*t["events"])))

    # --- Data handled -----------------------------------------------------------
    payloads = {"full": 0, "hash": 0, "none": 0}
    runs_by_mode = {"full": 0, "hash": 0, "none": 0, "mixed": 0}
    data: list[Json] = []
    for r in runs:
        counts = {"full": 0, "hash": 0, "none": 0}
        carriers = [e for e in r["events"] if e["type"] in _PAYLOAD_FIELDS]
        for e in carriers:
            counts[_payload_kind(_d(e).get(_PAYLOAD_FIELDS[e["type"]]))] += 1
        if not carriers:
            continue
        modes = [m for m in ("full", "hash", "none") if counts[m] > 0]
        mode = modes[0] if len(modes) == 1 else "mixed"
        runs_by_mode[mode] += 1
        for m in ("full", "hash", "none"):
            payloads[m] += counts[m]
        text = (f"Run {_short(r['run']['run_id'])} journalled {counts['full']} payload(s) in full, {counts['hash']} as a hash and {counts['none']} not at all."
                if mode == "mixed" else
                f"Run {_short(r['run']['run_id'])} journalled its {len(carriers)} payload(s) {'in full' if mode == 'full' else 'as SHA-256 hashes only' if mode == 'hash' else 'not at all'}.")
        data.append(_statement("run_payloads", text, {"run_id": r["run"]["run_id"], "mode": mode, **counts}, _cite(*carriers)))
    contexts: dict[str, Json] = {}

    def context(name: str) -> Json:
        return contexts.setdefault(name, {"reads": 0, "writes": 0, "denied": 0, "events": []})
    for e in of("context.read", "context.written", "context.denied"):
        if e["type"] == "context.read":
            for c in _d(e).get("contexts") or []:
                x = context(str(c.get("context_name")))
                x["reads"] += 1
                x["events"].append(e)
        else:
            name = _d(e).get("context_name")
            x = context(str(name) if name is not None else "(not named)")
            x["writes" if e["type"] == "context.written" else "denied"] += 1
            x["events"].append(e)
    for name in sorted(contexts):
        c = contexts[name]
        data.append(_statement(
            "context", f"The context \"{name}\" was given to activities {c['reads']} time(s), written {c['writes']} time(s) and refused {c['denied']} write(s); the journal holds hashes of its values, not the values.",
            {"context_name": name, "reads": c["reads"], "writes": c["writes"], "denied": c["denied"]}, _cite(*c["events"])))

    # --- The records themselves -------------------------------------------------
    records = [e for e in [*(e for r in runs for e in r["events"]), *(e for i in instances for e in i["events"])] if not math.isnan(_ms(e.get("time")))]
    as_of = record.get("as_of") or _now_iso()
    journey_events = sum(len(i["events"]) for i in instances)
    event_count = sum(len(r["events"]) for r in runs)
    retention: list[Json] = []
    oldest = newest = None
    if records:
        # The oldest and the newest records, every one of them where several share the instant
        first_time, last_time = min(_ms(e["time"]) for e in records), max(_ms(e["time"]) for e in records)
        oldest = next(e for e in records if _ms(e["time"]) == first_time)
        newest = next(e for e in records if _ms(e["time"]) == last_time)
        at_the_ends = [e for e in records if _ms(e["time"]) in (first_time, last_time)]
        retention.append(_statement(
            "held", f"The report rests on {event_count} journal record(s) of {len(runs)} run(s) and {journey_events} record(s) of {len(instances)} journey(s), from {oldest['time']} to {newest['time']}.",
            {"runs": len(runs), "events": event_count, "journey_instances": len(instances), "journey_events": journey_events,
             "oldest_record": oldest["time"], "newest_record": newest["time"]}, _cite(*at_the_ends)))
    runs_with_gaps = 0
    for r in runs:
        present = {e["seq"] for e in r["events"]}
        last = max(present, default=0)
        missing = [s for s in range(1, last + 1) if s not in present]
        if not missing and r["started"]:
            continue
        runs_with_gaps += 1
        around: list[Json | None] = []
        for s in missing:
            around.append(next((e for e in reversed(r["events"]) if e["seq"] < s), None))
            around.append(next((e for e in r["events"] if e["seq"] > s), None))
        if not any(around):
            around = [r["events"][0]] if r["events"] else []
        text = f"The journal of run {_short(r['run']['run_id'])} is incomplete: " + " and ".join(
            ([f"record(s) {', '.join(str(s) for s in missing)} are missing"] if missing else []) + ([] if r["started"] else ["it has no run.started"])) + "."
        retention.append(_statement("gap", text, {"run_id": r["run"]["run_id"], "missing": missing, "starts": bool(r["started"])}, _cite(*around)))

    times = [t for t in [*(r["start"] for r in runs), *(_ms(i["instance"].get("started_at")) for i in instances)] if not math.isnan(t)]

    def part(id: str, summary: Json, statements: list[Json]) -> Json:
        p = next(x for x in EVIDENCE_PARTS if x["id"] == id)
        return {"id": id, "title": p["title"], "question": p["question"], "serves": list(p["serves"]), "summary": summary, "statements": statements}

    def kinds(statements: list[Json], kind: str) -> int:
        return sum(1 for s in statements if s["kind"] == kind)

    journeys_scope = []
    for jid in _uniq([i["journey_id"] for i in instances]):
        mine = [i for i in instances if i["journey_id"] == jid]
        journeys_scope.append({"journey_id": jid, "name": mine[0]["name"], "instances": len(mine)})
    return {
        "spec_version": "1.1", "report": "evidence", "as_of": as_of,
        "period": {"from": options.get("from") or (_iso(min(times)) if times else None), "to": options.get("to") or (_iso(max(times)) if times else None)},
        "scope": {"workflows": workflows_scope, "journeys": journeys_scope},
        "notice": EVIDENCE_NOTICE,
        "frameworks": EVIDENCE_FRAMEWORKS,
        "parts": [
            part("operation", {"runs": len(runs), "completed": count_status("completed"), "failed": count_status("failed"), "cancelled": count_status("cancelled"),
                               "in_progress": count_status("in_progress"), "journeys": len(instances), "workflows": workflows_scope}, operation),
            part("models", {"models": sorted(_uniq([model_name(m["facts"]) for m in models.values()])), "selections": len(selections),
                            "routes": kinds(model_statements, "route"), "model_decisions": kinds(model_statements, "model_decision")}, model_statements),
            part("oversight", {"human_decisions": kinds(oversight, "human_decision"), "overrides": overrides, "escalations": kinds(oversight, "escalation"),
                               "cancellations": kinds(oversight, "cancellation")}, oversight),
            part("outcomes", {"contracts": len(contracts), "contracts_passed": sum(1 for e in contracts if _d(e).get("passed") is True),
                              "verifications": len(verifications), "verifications_passed": sum(1 for e in verifications if _d(e).get("verdict") == "pass"),
                              "activities": list(per_activity.values())}, outcomes),
            part("refusals", {"refusals": len(refusals), "tool_calls": len(refused), "context_writes": len(refusals) - len(refused),
                              "by_code": _by_code([str(err(e).get("code") or "UNKNOWN") for e in refused])}, refusals),
            part("failures", {"attempts_failed": kinds(failures, "attempt_failed"), "dead_letters": kinds(failures, "dead_letter"), "tool_failures": len(failed_tools),
                              "runs_failed": kinds(failures, "run_failed"), "journeys_stalled": len(stalls),
                              "by_code": _by_code([str(s["facts"]["code"] or "UNKNOWN") for s in failures if s["kind"] == "attempt_failed"])}, failures),
            part("compensations", {"compensations": len(compensations), "failed": sum(1 for s in compensations if not s["facts"]["succeeded"])}, compensations),
            part("service_levels", {"warnings": sum(1 for s in service_levels if s["facts"]["level"] == "warning"),
                                    "breaches": sum(1 for s in service_levels if s["facts"]["level"] == "breach")}, service_levels),
            part("tools", {"targets": len(targets), "calls": sum(s["facts"]["calls"] for s in tool_statements), "completed": sum(s["facts"]["completed"] for s in tool_statements),
                           "failed": sum(s["facts"]["failed"] for s in tool_statements), "refused": sum(s["facts"]["refused"] for s in tool_statements)}, tool_statements),
            part("data", {"runs_by_mode": runs_by_mode, "payloads": payloads}, data),
            part("retention", {"runs": len(runs), "events": event_count, "journey_instances": len(instances), "journey_events": journey_events,
                               "oldest_record": oldest["time"] if oldest else None, "newest_record": newest["time"] if newest else None,
                               "held_for_ms": max(0, _ms(as_of) - _ms(oldest["time"])) if oldest else None, "runs_with_gaps": runs_with_gaps}, retention),
        ],
    }


def unresolved_citations(report: Json, record: Json) -> list[str]:
    """Every citation of a report that does not point at a record of the input: an empty list for a sound report"""
    runs: dict[str, set[int]] = {}
    journeys: dict[str, set[int]] = {}
    for j in record.get("journeys") or []:
        for row in j.get("instances") or []:
            journeys[row["instance"]["id"]] = {e["seq"] for e in row["instance"].get("events") or []}
            for r in row.get("runs") or []:
                runs[r["run_id"]] = {e["seq"] for e in r.get("events") or []}
    for r in record.get("runs") or []:
        runs.setdefault(r["run_id"], {e["seq"] for e in r.get("events") or []})
    missing = []
    for p in report["parts"]:
        for s in p["statements"]:
            for c in s["citations"]:
                key, seqs = (f"run {c['run_id']}", runs.get(c["run_id"])) if "run_id" in c else (f"journey {c['journey_instance_id']}", journeys.get(c["journey_instance_id"]))
                if not c["seq"]:
                    missing.append(f"{p['id']}/{s['kind']}: {key} with no sequence number")
                for seq in c["seq"]:
                    if not seqs or seq not in seqs:
                        missing.append(f"{p['id']}/{s['kind']}: {key} #{seq}")
    return missing


_FRAMEWORK_SHORT = {"eu-ai-act": "EU AI Act", "nist-ai-rmf": "NIST AI RMF", "iso-iec-42001": "ISO/IEC 42001"}


def _serves_text(ids: list[str]) -> str:
    out = []
    for f in EVIDENCE_FRAMEWORKS:
        labels = [r["label"] for id in ids for r in f["references"] if r["id"] == id]
        if labels:
            out.append(f"{_FRAMEWORK_SHORT[f['id']]} {', '.join(labels)}")
    return "; ".join(out)


def _citation_text(citations: list[Json]) -> str:
    return "; ".join(
        (f"run {_short(c['run_id'])} " if "run_id" in c else f"journey {_short(c['journey_instance_id'])} ") + "#" + ", #".join(str(s) for s in c["seq"])
        for c in citations)


def _summary_lines(summary: Json) -> list[str]:
    def scalar(v: Any) -> bool:
        return v is None or not isinstance(v, (dict, list)) or (isinstance(v, list) and all(not isinstance(x, (dict, list)) for x in v))
    lines = []
    for k, v in summary.items():
        if scalar(v):
            text = (", ".join(str(x) for x in v) or "none") if isinstance(v, list) else "none" if v is None else ("true" if v is True else "false" if v is False else str(v))
            lines.append(f"{k.replace('_', ' ')}: {text}")
    for k, v in summary.items():
        if isinstance(v, dict):
            lines.append(f"{k.replace('_', ' ')}: " + ", ".join(f"{a} {b}" for a, b in v.items()))
    return lines


def render_evidence_markdown(report: Json) -> str:
    """The report as Markdown, for a person to read"""
    def esc(text: Any) -> str:
        return str(text).replace("|", "\\|").replace("\n", " ")
    period = report["period"]
    out = ["# Evidence report", "",
           f"As of {report['as_of']}. Period: {period['from'] or 'the beginning of the records'} to {period['to'] or 'the end of the records'}.", "",
           f"> {report['notice']}", "", "## Scope", ""]
    if report["scope"]["workflows"]:
        out += ["| Workflow | Versions | Runs |", "|---|---|---|"]
        out += [f"| {esc(w['name'])} | {', '.join(w['versions']) or 'not recorded'} | {w['runs']} |" for w in report["scope"]["workflows"]]
        out.append("")
    else:
        out += ["No run falls within the period.", ""]
    out += [f"- Journey \"{j['name']}\": {j['instances']} instance(s)" for j in report["scope"]["journeys"]]
    if report["scope"]["journeys"]:
        out.append("")
    out += ["Each statement cites the journal records it rests on: \"run 1a2b3c4d #5\" is the record with sequence number 5 in the journal of the run whose id begins 1a2b3c4d.", ""]
    for n, p in enumerate(report["parts"], 1):
        out += [f"## {n}. {p['title']}", "", f"*{p['question']}*", "", f"Can serve as evidence for: {_serves_text(p['serves'])}.", ""]
        out += [f"- {line}" for line in _summary_lines(p["summary"])]
        out.append("")
        if not p["statements"]:
            out += ["Nothing recorded.", ""]
            continue
        out += ["| Statement | Records |", "|---|---|"]
        out += [f"| {esc(s['text'])} | {_citation_text(s['citations'])} |" for s in p["statements"]]
        out.append("")
    out += ["## The frameworks named", ""]
    for f in report["frameworks"]:
        out += [f"**{f['name']}**", ""] + [f"- {r['label']}: {r['title']}" for r in f["references"]] + [""]
    out += ["The mapping from parts to provisions says which obligations a record is relevant to. It does not say that an obligation is met.", ""]
    return "\n".join(out)


def render_evidence_html(report: Json) -> str:
    """The report as one self-contained HTML page"""
    h = lambda text: _html.escape(str(text if text is not None else ""), quote=True)  # noqa: E731
    period = report["period"]
    parts = []
    for n, p in enumerate(report["parts"], 1):
        table = ("<table><thead><tr><th>Statement</th><th>Records</th></tr></thead><tbody>"
                 + "".join(f"<tr><td>{h(s['text'])}</td><td class=\"cite\">{h(_citation_text(s['citations']))}</td></tr>" for s in p["statements"])
                 + "</tbody></table>") if p["statements"] else "<p>Nothing recorded.</p>"
        parts.append(f"""
<section id="{h(p['id'])}">
  <h2>{n}. {h(p['title'])}</h2>
  <p class="question">{h(p['question'])}</p>
  <p class="serves">Can serve as evidence for: {h(_serves_text(p['serves']))}.</p>
  <ul class="summary">{''.join(f'<li>{h(line)}</li>' for line in _summary_lines(p['summary']))}</ul>
  {table}
</section>""")
    scope = report["scope"]
    workflows = ("<table><thead><tr><th>Workflow</th><th>Versions</th><th>Runs</th></tr></thead><tbody>"
                 + "".join(f"<tr><td>{h(w['name'])}</td><td>{h(', '.join(w['versions']) or 'not recorded')}</td><td>{w['runs']}</td></tr>" for w in scope["workflows"])
                 + "</tbody></table>") if scope["workflows"] else "<p>No run falls within the period.</p>"
    journeys = ("<ul>" + "".join(f"<li>Journey \"{h(j['name'])}\": {j['instances']} instance(s)</li>" for j in scope["journeys"]) + "</ul>") if scope["journeys"] else ""
    frameworks = "\n".join(f"<h3>{h(f['name'])}</h3><ul>" + "".join(f"<li>{h(r['label'])}: {h(r['title'])}</li>" for r in f["references"]) + "</ul>" for f in report["frameworks"])
    return f"""<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Evidence report</title>
<style>
:root {{ --fg: #1d1d1f; --muted: #5f6368; --line: #d9dce1; --bg: #ffffff; --note: #f4f6f8; }}
@media (prefers-color-scheme: dark) {{ :root {{ --fg: #e8eaed; --muted: #a0a4aa; --line: #3c4043; --bg: #17181a; --note: #222427; }} }}
body {{ font: 15px/1.5 system-ui, sans-serif; color: var(--fg); background: var(--bg); max-width: 1100px; margin: 0 auto; padding: 24px 16px; }}
h1 {{ font-size: 1.6em; margin-bottom: 4px; }} h2 {{ font-size: 1.2em; margin-top: 2em; border-bottom: 1px solid var(--line); padding-bottom: 4px; }}
.notice {{ background: var(--note); border-left: 4px solid var(--muted); padding: 10px 14px; }}
.question {{ font-style: italic; color: var(--muted); }} .serves {{ color: var(--muted); font-size: 0.92em; }}
table {{ border-collapse: collapse; width: 100%; font-size: 0.92em; }} th, td {{ text-align: left; vertical-align: top; border-bottom: 1px solid var(--line); padding: 6px 8px; }}
td.cite {{ font-family: ui-monospace, monospace; font-size: 0.85em; white-space: nowrap; color: var(--muted); }}
</style>
</head>
<body>
<h1>Evidence report</h1>
<p>As of {h(report['as_of'])}. Period: {h(period['from'] or 'the beginning of the records')} to {h(period['to'] or 'the end of the records')}.</p>
<p class="notice">{h(report['notice'])}</p>
<h2>Scope</h2>
{workflows}
{journeys}
<p class="serves">Each statement cites the journal records it rests on: "run 1a2b3c4d #5" is the record with sequence number 5 in the journal of the run whose id begins 1a2b3c4d.</p>
{''.join(parts)}
<h2>The frameworks named</h2>
{frameworks}
<p>The mapping from parts to provisions says which obligations a record is relevant to. It does not say that an obligation is met.</p>
</body>
</html>
"""
