"""
Measures (specification section 21)

What an organisation asks of its journeys and workflows, computed from what was
recorded: journey records and run journals. Nothing here is estimated. A measure
that has nothing to be computed from has no value (`None`), and every measure
says over how many it was computed.

This module depends on nothing but the standard library. It follows the
reference implementation rule by rule, so that the same record gives the same
report: nearest-rank percentiles, `None` for no value, the same order of lists.
A report is returned in its JSON form: whole numbers are integers, and a number
that is not finite is `None`.
"""

import math
import re
from datetime import datetime, timedelta, timezone
from decimal import Decimal
from typing import Any

Json = dict[str, Any]
Measure = dict[str, Any]


def _m(id: str, name: str, scope: str, unit: str, better: str, definition: str) -> Json:
    return {"id": id, "name": name, "scope": scope, "unit": unit, "better": better, "definition": definition}


# Every measure: its id, name, scope (journey, stage, workflow, activity), unit
# (count, ratio, ms, score, tokens, currency), which way is good, and the rule in
# words precise enough to recompute the value by hand.
MEASURES: list[Json] = [
    _m("journey.started", "Journeys started", "journey", "count", "neither", "Journey instances started in the period."),
    _m("journey.active", "Journeys in progress", "journey", "count", "neither", "Journey instances neither completed nor abandoned."),
    _m("journey.completion_rate", "Completion rate", "journey", "ratio", "higher", "Completed instances divided by started instances."),
    _m("journey.abandonment_rate", "Abandonment rate", "journey", "ratio", "lower", "Abandoned instances divided by started instances."),
    _m("journey.stall_rate", "Stall rate", "journey", "ratio", "lower", "Instances that stalled at least once divided by started instances."),
    _m("journey.stalled_now", "Stalled now", "journey", "count", "lower", "Instances in progress that are stalled."),
    _m("journey.goal_attainment", "Goal attainment", "journey", "ratio", "higher", "Instances that reached every goal of the journey divided by started instances. A journey without goals has no value."),
    _m("journey.duration_median_ms", "Time to complete, median", "journey", "ms", "lower", "Median time from start to end of completed instances."),
    _m("journey.duration_p90_ms", "Time to complete, 90th percentile", "journey", "ms", "lower", "Nearest-rank 90th percentile of the time from start to end of completed instances."),
    _m("journey.mood_end", "Mood at the end", "journey", "score", "higher", "Mean of the last mood of ended instances, on the scale of the journey."),
    _m("journey.mood_change", "Change of mood", "journey", "score", "higher", "Mean of the last mood minus the first mood of ended instances."),
    _m("journey.mood_measured_share", "Mood that was measured", "journey", "ratio", "higher", "Changes of mood whose basis is measured divided by all changes of mood. The rest is inferred by rule."),
    _m("journey.touchpoints_per_journey", "Touchpoints per journey", "journey", "count", "neither", "Touchpoints recorded divided by started instances."),
    _m("journey.runs_per_journey", "Runs per journey", "journey", "count", "neither", "Workflow runs started for the journey divided by started instances."),
    _m("journey.cost_per_journey", "Cost per journey", "journey", "currency", "lower", "Cost recorded by the ended runs of the journey divided by started instances."),

    _m("stage.entered", "Entered", "stage", "count", "neither", "Instances that entered the stage."),
    _m("stage.conversion", "Conversion", "stage", "ratio", "higher", "Instances that completed the stage divided by instances that entered it."),
    _m("stage.duration_median_ms", "Time in stage, median", "stage", "ms", "lower", "Median time between entering and completing the stage."),
    _m("stage.breach_rate", "Outlasted its time", "stage", "ratio", "lower", "Instances that stalled in the stage divided by instances that entered it."),
    _m("stage.active", "In the stage now", "stage", "count", "neither", "Instances in progress whose current stage this is."),
    _m("stage.stalled_now", "Stalled now", "stage", "count", "lower", "Instances in progress, in this stage, that are stalled."),
    _m("stage.abandoned", "Abandoned here", "stage", "count", "lower", "Instances abandoned while in the stage."),

    _m("workflow.runs", "Runs", "workflow", "count", "neither", "Runs started."),
    _m("workflow.in_progress", "Runs in progress", "workflow", "count", "neither", "Runs with no run.completed, run.failed or run.cancelled."),
    _m("workflow.success_rate", "Success rate", "workflow", "ratio", "higher", "Completed runs divided by ended runs."),
    _m("workflow.failure_rate", "Failure rate", "workflow", "ratio", "lower", "Failed runs divided by ended runs."),
    _m("workflow.cancel_rate", "Cancelled", "workflow", "ratio", "lower", "Cancelled runs divided by ended runs."),
    _m("workflow.first_pass_yield", "Right first time", "workflow", "ratio", "higher", "Runs completed with no failed attempt, retry, dead letter or compensation divided by ended runs."),
    _m("workflow.lead_time_median_ms", "Lead time, median", "workflow", "ms", "lower", "Median time from run.started to the end of ended runs."),
    _m("workflow.lead_time_p90_ms", "Lead time, 90th percentile", "workflow", "ms", "lower", "Nearest-rank 90th percentile of the same."),
    _m("workflow.process_time_median_ms", "Work time, median", "workflow", "ms", "lower", "Median over ended runs of the summed duration of their activity attempts."),
    _m("workflow.flow_efficiency", "Flow efficiency", "workflow", "ratio", "higher", "Summed work time divided by summed lead time of ended runs, at most 1. The rest is waiting."),
    _m("workflow.event_wait_median_ms", "Wait for an awaited event, median", "workflow", "ms", "lower", "Median time between event.waiting and the event.received that answered it."),
    _m("workflow.event_timeout_rate", "Awaited events that never came", "workflow", "ratio", "lower", "event.timed_out divided by waits that ended, by an event or by a timeout."),
    _m("workflow.human_wait_median_ms", "Wait for a person, median", "workflow", "ms", "lower", "Median waited_ms of token.resumed after a human task."),
    _m("workflow.automation_rate", "Done without a person", "workflow", "ratio", "neither", "Completed activities whose actor is not human divided by completed activities."),
    _m("workflow.retries", "Retries", "workflow", "count", "lower", "activity.retry_scheduled events."),
    _m("workflow.dead_letters", "Dead letters", "workflow", "count", "lower", "activity.dead_lettered events."),
    _m("workflow.compensations", "Compensations", "workflow", "count", "lower", "activity.compensated events."),
    _m("workflow.sla_warnings", "Service level warnings", "workflow", "count", "lower", "sla.warning events."),
    _m("workflow.sla_breaches", "Service levels breached", "workflow", "count", "lower", "sla.breached events."),
    _m("workflow.tool_calls", "Tool calls", "workflow", "count", "neither", "tool.invoked events."),
    _m("workflow.tool_failure_rate", "Tool calls that failed", "workflow", "ratio", "lower", "tool.failed divided by tool.completed plus tool.failed."),
    _m("workflow.contract_pass_rate", "Outcome contracts met", "workflow", "ratio", "higher", "contract.checked that passed divided by all contract.checked."),
    _m("workflow.verification_pass_rate", "Verifications passed", "workflow", "ratio", "higher", "verification.completed with verdict pass divided by all verification.completed."),
    _m("workflow.decisions", "Decisions", "workflow", "count", "neither", "decision.evaluated events."),
    _m("workflow.decision_default_rate", "Decisions that fell to the default", "workflow", "ratio", "lower", "Decisions that used the default edge divided by all decisions."),
    _m("workflow.model_decision_share", "Decisions made by a model", "workflow", "ratio", "neither", "Decisions whose method is model divided by all decisions."),
    _m("workflow.input_tokens", "Input tokens", "workflow", "tokens", "neither", "Input tokens recorded by ended runs."),
    _m("workflow.output_tokens", "Output tokens", "workflow", "tokens", "neither", "Output tokens recorded by ended runs."),
    _m("workflow.cost", "Cost", "workflow", "currency", "lower", "Cost recorded by ended runs."),
    _m("workflow.cost_per_run", "Cost per run", "workflow", "currency", "lower", "Cost divided by ended runs."),

    _m("activity.attempts", "Attempts", "activity", "count", "neither", "activity.started events."),
    _m("activity.failure_rate", "Attempts that failed", "activity", "ratio", "lower", "activity.failed divided by attempts that ended."),
    _m("activity.duration_median_ms", "Duration, median", "activity", "ms", "lower", "Median duration_ms of completed attempts."),
    _m("activity.tokens", "Tokens", "activity", "tokens", "neither", "Input plus output tokens of completed attempts."),
]

# ---------------------------------------------------------------------------
# Reading a record. A record is JSON written by any implementation, so values
# are read the way the reference reads them: a missing property is not the
# same as null, and a number may arrive as text.
# ---------------------------------------------------------------------------

_ABSENT: Any = object()
_NAN = float("nan")
_EPOCH = datetime(1970, 1, 1, tzinfo=timezone.utc)
_DAY = 86400000
_INSTANT = re.compile(
    r"^(\d{4})-(\d\d)-(\d\d)(?:[Tt ](\d\d):(\d\d)(?::(\d\d)(?:[.,](\d+))?)?)?\s*(Z|z|[+-]\d\d(?::?\d\d)?)?$")
_DECIMAL = re.compile(r"^[+-]?(?:\d+\.?\d*(?:[eE][+-]?\d+)?|\.\d+(?:[eE][+-]?\d+)?)$")


def _get(value: Any, *path: str) -> Any:
    """The property at a path, or _ABSENT when any step of it is missing"""
    for key in path:
        if not isinstance(value, dict) or key not in value:
            return _ABSENT
        value = value[key]
    return value


def _data(event: Json, *path: str) -> Any:
    return _get(event, "data", *path)


def _truthy(value: Any) -> bool:
    if value is _ABSENT or value is None:
        return False
    if isinstance(value, float) and math.isnan(value):
        return False
    if isinstance(value, (dict, list)):
        return True
    return bool(value)


def _or(value: Any, fallback: Any) -> Any:
    return value if _truthy(value) else fallback


def _is_number(value: Any) -> bool:
    return isinstance(value, (int, float)) and not isinstance(value, bool)


def _number(value: Any) -> float:
    """A recorded value as a number; not-a-number when it is not one. Null counts as zero, a missing value does not."""
    if value is _ABSENT:
        return _NAN
    if value is None:
        return 0
    if isinstance(value, bool):
        return 1 if value else 0
    if isinstance(value, (int, float)):
        return value
    if isinstance(value, str):
        text = value.strip()
        if text == "":
            return 0
        if _DECIMAL.match(text):
            number = float(text)
            return int(number) if number.is_integer() and abs(number) < 1e15 else number
        if text in ("Infinity", "+Infinity"):
            return math.inf
        if text == "-Infinity":
            return -math.inf
        return _NAN
    if isinstance(value, list):
        return 0 if not value else _number(value[0]) if len(value) == 1 and not isinstance(value[0], (list, dict)) else _NAN
    return _NAN


def _finite(value: Any) -> bool:
    return _is_number(value) and math.isfinite(value)


def _number_or_zero(value: Any) -> float:
    number = _number(value)
    return 0 if math.isnan(number) else number


def _number_text(value: Any) -> str:
    """A number as the reference writes it: no fraction on a whole number, shortest form otherwise"""
    if isinstance(value, bool):
        return "true" if value else "false"
    if isinstance(value, int):
        return str(value)
    if math.isnan(value):
        return "NaN"
    if math.isinf(value):
        return "Infinity" if value > 0 else "-Infinity"
    if value.is_integer() and abs(value) < 1e21:
        return str(int(value))
    text = repr(value)
    if "e" not in text:
        return text
    if 1e-7 <= abs(value) < 1e21:
        return format(Decimal(text), "f")
    mantissa, exponent = text.split("e")
    return f"{mantissa}e{'+' if int(exponent) > 0 else '-'}{abs(int(exponent))}"


def _text(value: Any) -> str:
    if isinstance(value, str):
        return value
    if value is None:
        return "null"
    if _is_number(value) or isinstance(value, bool):
        return _number_text(value)
    return str(value)


def _ms(instant: Any) -> float:
    """An instant as milliseconds since the epoch; not-a-number when there is none. A time without an offset is read as UTC."""
    if not _truthy(instant):
        return _NAN
    if _is_number(instant):
        return instant
    match = _INSTANT.match(instant.strip()) if isinstance(instant, str) else None
    if not match:
        return _NAN
    year, month, day, hour, minute, second, fraction, offset = match.groups()
    try:
        moment = datetime(int(year), int(month), int(day), int(hour or 0), int(minute or 0), int(second or 0), tzinfo=timezone.utc)
    except ValueError:
        return _NAN
    total = (moment - _EPOCH) // timedelta(milliseconds=1) + int((fraction or "0")[:3].ljust(3, "0"))
    if offset and offset not in ("Z", "z"):
        digits = offset[1:].replace(":", "")
        minutes = int(digits[:2]) * 60 + int(digits[2:] or 0)
        total -= (1 if offset[0] == "+" else -1) * minutes * 60000
    return total


def _iso(epoch_ms: float) -> str:
    moment = _EPOCH + timedelta(milliseconds=int(epoch_ms))
    return moment.strftime("%Y-%m-%dT%H:%M:%S.") + f"{int(epoch_ms) % 1000:03d}Z"


def _now_iso() -> str:
    return _iso((datetime.now(timezone.utc) - _EPOCH) // timedelta(milliseconds=1))


def _max0(value: float) -> float:
    return value if math.isnan(value) else max(0, value)


def _list(value: Any) -> list[Any]:
    return value if isinstance(value, list) else []


# ---------------------------------------------------------------------------
# The forms a measure takes
# ---------------------------------------------------------------------------

def _count(n: int) -> Measure:
    return {"value": n, "n": n}


def _ratio(part: float, whole: float) -> Measure:
    return {"value": part / whole if whole else None, "n": whole}


def _total(value: float, n: int) -> Measure:
    return {"value": value if n else None, "n": n}


def _percentile(values: list[Any], p: float) -> Measure:
    """Nearest-rank percentile: the smallest value with at least p of the values at or below it"""
    ordered = sorted(v for v in values if _finite(v))
    return {"value": ordered[max(0, math.ceil(p * len(ordered)) - 1)] if ordered else None, "n": len(ordered)}


def _median(values: list[Any]) -> Measure:
    return _percentile(values, 0.5)


def _mean(values: list[float]) -> Measure:
    return {"value": _sum(values) / len(values) if values else None, "n": len(values)}


def _sum(values: Any) -> float:
    """Added one after the other, left to right, as the reference adds: the built-in sum compensates for rounding and can differ in the last digit"""
    result: float = 0
    for value in values:
        result += value
    return result


def _bump(counts: dict[Any, int], key: Any, by: int = 1) -> None:
    counts[key] = counts.get(key, 0) + by


# ---------------------------------------------------------------------------
# Runs and workflows (21.4, 21.5)
# ---------------------------------------------------------------------------

_ENDINGS = ("run.completed", "run.failed", "run.cancelled")
_NOT_CLEAN = ("activity.failed", "activity.retry_scheduled", "activity.dead_lettered", "activity.compensated")


def _events(run: Json) -> list[Json]:
    return _list(run.get("events"))


def _first_event(events: list[Json]) -> Json | None:
    return next((e for e in events if e.get("type") == "run.started"), events[0] if events else None)


def _run_facts(run: Json) -> Json:
    events = _events(run)
    first = _first_event(events)
    last = next((e for e in reversed(events) if e.get("type") in _ENDINGS), None)
    started = _ms(first.get("time")) if first else _NAN
    ended = _ms(last.get("time")) if last else None
    status = ("in_progress" if not last else "completed" if last["type"] == "run.completed"
              else "failed" if last["type"] == "run.failed" else "cancelled")
    work: float = 0
    clean = status == "completed"
    for e in events:
        if e.get("type") in ("activity.completed", "activity.failed"):
            work += _number_or_zero(_data(e, "duration_ms"))
        if e.get("type") in _NOT_CLEAN:
            clean = False
    end_data = (lambda key: _data(last, key)) if last else (lambda key: _ABSENT)
    return {
        "run": run, "started": started, "ended": ended, "status": status,
        "lead": None if ended is None else _max0(ended - started), "work": work, "clean": clean,
        "cost": _number_or_zero(end_data("cost")), "currency": _or(end_data("currency"), None),
        "input_tokens": _number_or_zero(end_data("input_tokens")),
        "output_tokens": _number_or_zero(end_data("output_tokens")),
    }


def _workflow_measures(id: str, name: str, facts: list[Json], catalogue: dict[str, Json]) -> Json:
    ended = [f for f in facts if f["status"] != "in_progress"]
    events = [e for f in facts for e in _events(f["run"])]

    def by(status: str) -> int:
        return sum(1 for f in facts if f["status"] == status)

    def of(type: str) -> list[Json]:
        return [e for e in events if e.get("type") == type]

    # Waits for an awaited event: pair each event.waiting with what ended it at the same node of the same run
    event_waits: list[float] = []
    timeouts = 0
    for f in facts:
        waiting: dict[str, float] = {}
        for e in _events(f["run"]):
            key = _or(e.get("node_id"), "")
            if e.get("type") == "event.waiting":
                waiting[key] = _ms(e.get("time"))
            elif e.get("type") == "event.received" and key in waiting:
                event_waits.append(_ms(e.get("time")) - waiting.pop(key))
            elif e.get("type") == "event.timed_out" and key in waiting:
                timeouts += 1
                del waiting[key]

    human_waits = [v for v in (_number(_data(e, "waited_ms")) for e in of("token.resumed")) if _finite(v)]
    done = of("activity.completed")
    automated = sum(1 for e in done if _or(_data(e, "actor_type"), (catalogue.get(_or(e.get("node_id"), "")) or {}).get("actor_type")) != "human")
    tool_done, tool_failed = len(of("tool.completed")), len(of("tool.failed"))
    contracts, verifications, decisions = of("contract.checked"), of("verification.completed"), of("decision.evaluated")
    lead_sum = _sum(_or(f["lead"], 0) for f in ended)
    work_sum = _sum(f["work"] for f in ended)
    cost = _sum(f["cost"] for f in ended)

    measures: Json = {
        "workflow.runs": _count(len(facts)),
        "workflow.in_progress": _count(by("in_progress")),
        "workflow.success_rate": _ratio(by("completed"), len(ended)),
        "workflow.failure_rate": _ratio(by("failed"), len(ended)),
        "workflow.cancel_rate": _ratio(by("cancelled"), len(ended)),
        "workflow.first_pass_yield": _ratio(sum(1 for f in ended if f["clean"]), len(ended)),
        "workflow.lead_time_median_ms": _median([f["lead"] for f in ended]),
        "workflow.lead_time_p90_ms": _percentile([f["lead"] for f in ended], 0.9),
        "workflow.process_time_median_ms": _median([f["work"] for f in ended]),
        "workflow.flow_efficiency": {"value": min(1, work_sum / lead_sum) if lead_sum else None, "n": len(ended)},
        "workflow.event_wait_median_ms": _median(event_waits),
        "workflow.event_timeout_rate": _ratio(timeouts, len(event_waits) + timeouts),
        "workflow.human_wait_median_ms": _median(human_waits),
        "workflow.automation_rate": _ratio(automated, len(done)),
        "workflow.retries": _count(len(of("activity.retry_scheduled"))),
        "workflow.dead_letters": _count(len(of("activity.dead_lettered"))),
        "workflow.compensations": _count(len(of("activity.compensated"))),
        "workflow.sla_warnings": _count(len(of("sla.warning"))),
        "workflow.sla_breaches": _count(len(of("sla.breached"))),
        "workflow.tool_calls": _count(len(of("tool.invoked"))),
        "workflow.tool_failure_rate": _ratio(tool_failed, tool_done + tool_failed),
        "workflow.contract_pass_rate": _ratio(sum(1 for e in contracts if _data(e, "passed") is True), len(contracts)),
        "workflow.verification_pass_rate": _ratio(sum(1 for e in verifications if _data(e, "verdict") == "pass"), len(verifications)),
        "workflow.decisions": _count(len(decisions)),
        "workflow.decision_default_rate": _ratio(
            sum(1 for e in decisions if _data(e, "used_default") is True or _data(e, "method") == "default"), len(decisions)),
        "workflow.model_decision_share": _ratio(sum(1 for e in decisions if _data(e, "method") == "model"), len(decisions)),
        "workflow.input_tokens": _total(_sum(f["input_tokens"] for f in ended), len(ended)),
        "workflow.output_tokens": _total(_sum(f["output_tokens"] for f in ended), len(ended)),
        "workflow.cost": _total(cost, len(ended)),
        "workflow.cost_per_run": {"value": cost / len(ended) if ended else None, "n": len(ended)},
    }

    activities: dict[str, Json] = {}

    def activity(e: Json) -> Json:
        key = _or(e.get("node_id"), _or(e.get("node_name"), ""))
        if key not in activities:
            known = catalogue.get(key) or {}
            activities[key] = {
                "name": _or(e.get("node_name"), _or(known.get("name"), key)), "actor_type": known.get("actor_type"),
                "attempts": 0, "failed": 0, "ended": 0, "durations": [], "tokens": 0,
            }
        a = activities[key]
        if _truthy(_data(e, "actor_type")):
            a["actor_type"] = _data(e, "actor_type")
        return a

    for e in events:
        if e.get("type") == "activity.started":
            activity(e)["attempts"] += 1
        elif e.get("type") == "activity.failed":
            a = activity(e)
            a["failed"] += 1
            a["ended"] += 1
        elif e.get("type") == "activity.completed":
            a = activity(e)
            a["ended"] += 1
            duration = _number(_data(e, "duration_ms"))
            if _finite(duration):
                a["durations"].append(duration)
            a["tokens"] += _number_or_zero(_data(e, "usage", "input_tokens")) + _number_or_zero(_data(e, "usage", "output_tokens"))

    decision_nodes: dict[str, Json] = {}
    for e in decisions:
        key = _or(e.get("node_id"), _or(e.get("node_name"), ""))
        if key not in decision_nodes:
            decision_nodes[key] = {"node_id": key, "name": _or(e.get("node_name"), key),
                                   "evaluations": 0, "table": 0, "model": 0, "engine": 0, "default": 0, "none": 0}
        d = decision_nodes[key]
        d["evaluations"] += 1
        method = "default" if _data(e, "used_default") is True else _text(_or(_data(e, "method"), "none"))
        if method in ("table", "model", "engine", "default", "none"):
            d[method] += 1

    tools: dict[str, Json] = {}
    for e in events:
        if e.get("type") not in ("tool.invoked", "tool.completed", "tool.failed"):
            continue
        key = _text(_or(_data(e, "tool"), "unnamed"))
        t = tools.setdefault(key, {"calls": 0, "failures": 0, "durations": []})
        if e["type"] == "tool.invoked":
            t["calls"] += 1
        elif e["type"] == "tool.failed":
            t["failures"] += 1
        else:
            duration = _number(_data(e, "duration_ms"))
            if _finite(duration):
                t["durations"].append(duration)

    errors: dict[str, int] = {}
    for e in of("activity.failed"):
        _bump(errors, _text(_or(_data(e, "error", "code"), "UNKNOWN")))

    return {
        "workflow_id": id, "name": name, "measures": measures,
        "activities": [{
            "activity_id": activity_id, "name": a["name"],
            **({"actor_type": a["actor_type"]} if _truthy(a["actor_type"]) else {}),
            "measures": {
                "activity.attempts": _count(a["attempts"]),
                "activity.failure_rate": _ratio(a["failed"], a["ended"]),
                "activity.duration_median_ms": _median(a["durations"]),
                "activity.tokens": _total(a["tokens"], len(a["durations"])),
            },
        } for activity_id, a in activities.items()],
        "decisions": list(decision_nodes.values()),
        "tools": sorted(({"tool": tool, "calls": t["calls"], "failures": t["failures"],
                          "duration_median_ms": _median(t["durations"])["value"]} for tool, t in tools.items()),
                        key=lambda t: -t["calls"]),
        "errors": sorted(({"code": code, "count": n} for code, n in errors.items()), key=lambda e: -e["count"]),
    }


# ---------------------------------------------------------------------------
# Journeys and stages (21.2, 21.3)
# ---------------------------------------------------------------------------

def _ended(instance: Json) -> bool:
    return instance.get("status") in ("completed", "abandoned")


def _first_mood(definition: Json, instance: Json) -> float:
    started = next((e for e in _list(instance.get("events")) if e.get("type") == "journey.started"), None)
    start = _data(started, "sentiment") if started else _ABSENT
    if _is_number(start):
        return start
    initial = _get(definition, "sentiment", "initial")
    return 0 if initial is _ABSENT or initial is None else initial


def _reached_all(goals: list[Json], instance: Json) -> bool:
    return all(g.get("id") in _list(instance.get("goals_reached")) for g in goals)


def _journey_measures(definition: Json, rows: list[Json], facts_of: Any) -> Json:
    instances = [r["instance"] for r in rows]
    started = len(instances)
    completed = [i for i in instances if i.get("status") == "completed"]
    ended = [i for i in instances if _ended(i)]
    events = [e for i in instances for e in _list(i.get("events"))]
    goals = _list(definition.get("goals"))
    durations = [_ms(i.get("ended_at")) - _ms(i.get("started_at")) for i in completed if _truthy(i.get("ended_at"))]
    follows_mood = _truthy(definition.get("sentiment"))
    mooded = [i for i in ended if _is_number(i.get("sentiment"))] if follows_mood else []
    changes = [e for e in events if e.get("type") == "journey.sentiment_changed"]
    runs = [facts_of(run) for r in rows for run in _list(r.get("runs"))]
    ended_runs = [f for f in runs if f["status"] != "in_progress"]
    return {
        "journey.started": _count(started),
        "journey.active": _count(sum(1 for i in instances if i.get("status") == "active")),
        "journey.completion_rate": _ratio(len(completed), started),
        "journey.abandonment_rate": _ratio(sum(1 for i in instances if i.get("status") == "abandoned"), started),
        "journey.stall_rate": _ratio(
            sum(1 for i in instances if any(e.get("type") == "journey.stalled" for e in _list(i.get("events")))), started),
        "journey.stalled_now": _count(sum(1 for i in instances if i.get("status") == "active" and _truthy(i.get("stalled")))),
        "journey.goal_attainment": (_ratio(sum(1 for i in instances if _reached_all(goals, i)), started)
                                    if goals else {"value": None, "n": 0}),
        "journey.duration_median_ms": _median(durations),
        "journey.duration_p90_ms": _percentile(durations, 0.9),
        "journey.mood_end": _mean([i["sentiment"] for i in mooded]),
        "journey.mood_change": _mean([i["sentiment"] - _first_mood(definition, i) for i in mooded]),
        "journey.mood_measured_share": _ratio(sum(1 for e in changes if _data(e, "basis") == "measured"), len(changes)),
        "journey.touchpoints_per_journey": {
            "value": sum(1 for e in events if e.get("type") == "journey.touchpoint") / started if started else None, "n": started},
        "journey.runs_per_journey": {"value": len(runs) / started if started else None, "n": started},
        "journey.cost_per_journey": {
            "value": _sum(f["cost"] for f in ended_runs) / started if started and ended_runs else None, "n": started},
    }


def _stage_measures(definition: Json, instances: list[Json]) -> list[Json]:
    stages = []
    for stage in _list(definition.get("stages")):
        visits = [(i, h) for i in instances for h in _list(i.get("stage_history")) if h.get("stage_id") == stage.get("id")]
        entered = len({i.get("id") for i, _ in visits})
        here = [i for i in instances if i.get("stage_id") == stage.get("id")]
        # A stage left because the journey was abandoned in it was not completed
        done = [(i, h) for i, h in visits if _truthy(h.get("left_at")) and not (
            i.get("status") == "abandoned" and i.get("stage_id") == stage.get("id") and h is i["stage_history"][-1])]
        stalled = sum(1 for i in instances if any(
            e.get("type") == "journey.stalled" and e.get("stage_id") == stage.get("id") for e in _list(i.get("events"))))
        stages.append({
            "stage_id": stage.get("id"), "name": stage.get("name"),
            **({"owner": stage["owner"]} if _truthy(stage.get("owner")) else {}),
            **({"max_duration": stage["max_duration"]} if _truthy(stage.get("max_duration")) else {}),
            "measures": {
                "stage.entered": _count(entered),
                "stage.conversion": _ratio(len({i.get("id") for i, _ in done}), entered),
                "stage.duration_median_ms": _median([_ms(h.get("left_at")) - _ms(h.get("entered_at")) for _, h in done]),
                "stage.breach_rate": _ratio(stalled, entered),
                "stage.active": _count(sum(1 for i in here if i.get("status") == "active")),
                "stage.stalled_now": _count(sum(1 for i in here if i.get("status") == "active" and _truthy(i.get("stalled")))),
                "stage.abandoned": _count(sum(1 for i in here if i.get("status") == "abandoned")),
            },
        })
    return stages


# ---------------------------------------------------------------------------
# Over time: days, weeks starting on Monday, or months, in UTC
# ---------------------------------------------------------------------------

def _bucket_start(time: float, bucket: str) -> int:
    moment = _EPOCH + timedelta(milliseconds=int(time))
    if bucket == "month":
        return (datetime(moment.year, moment.month, 1, tzinfo=timezone.utc) - _EPOCH) // timedelta(milliseconds=1)
    day = (datetime(moment.year, moment.month, moment.day, tzinfo=timezone.utc) - _EPOCH) // timedelta(milliseconds=1)
    return day if bucket == "day" else day - moment.weekday() * _DAY


def _next_bucket(start: int, bucket: str) -> int:
    if bucket == "day":
        return start + _DAY
    if bucket == "week":
        return start + 7 * _DAY
    moment = _EPOCH + timedelta(milliseconds=start)
    year, month = (moment.year + 1, 1) if moment.month == 12 else (moment.year, moment.month + 1)
    return (datetime(year, month, 1, tzinfo=timezone.utc) - _EPOCH) // timedelta(milliseconds=1)


def _tidy(value: Any) -> Any:
    """The JSON form of a report: whole numbers are integers, and a number that is not finite has no value"""
    if isinstance(value, dict):
        return {key: _tidy(item) for key, item in value.items()}
    if isinstance(value, list):
        return [_tidy(item) for item in value]
    if isinstance(value, float):
        if not math.isfinite(value):
            return None
        return int(value) if value.is_integer() else value
    return value


def compute_measures(record: Json, options: Json | None = None) -> Json:
    """
    Compute every measure of section 21 from what was recorded.

    `record` is a portfolio as a host exports it (`AwaRuntime.export_portfolio()`):
    `journeys` with their definition and instances, each instance with the
    journals of its runs; optionally `workflows`, `transitions`, `as_of`, and
    `runs` that belong to no journey. `options` may give `from` and `to`
    (instants: what started at or after `from` and before `to` is kept),
    `journey_id` and `workflow_id`.
    """
    options = options or {}
    start = _ms(options.get("from")) if _truthy(options.get("from")) else -math.inf
    end = _ms(options.get("to")) if _truthy(options.get("to")) else math.inf

    def within(instant: Any) -> bool:
        t = _ms(instant)
        if math.isnan(t):
            return start == -math.inf and end == math.inf
        return start <= t < end

    def keep_workflow(id: Any) -> bool:
        return not _truthy(options.get("workflow_id")) or options["workflow_id"] == id

    given = _list(record.get("journeys"))
    selected = [j for j in given if not _truthy(options.get("journey_id")) or j["definition"].get("id") == options["journey_id"]]
    journeys = [
        {"definition": j["definition"], "rows": [r for r in _list(j.get("instances")) if within(r["instance"].get("started_at"))]}
        for j in selected
    ]

    cache: dict[int, Json] = {}

    def facts_of(run: Json) -> Json:
        if id(run) not in cache:
            cache[id(run)] = _run_facts(run)
        return cache[id(run)]

    def run_start(run: Json) -> Any:
        first = _first_event(_events(run))
        return first.get("time") if first else None

    # A run is kept by its own start, not by the start of the journey it belongs to: a journey begun
    # before the period may start runs within it, and one begun within it may start runs after it.
    journey_runs = [run for j in selected for r in _list(j.get("instances")) for run in _list(r.get("runs")) if within(run_start(run))]
    loose_runs = [] if _truthy(options.get("journey_id")) else [r for r in _list(record.get("runs")) if within(run_start(r))]
    all_runs = [r for r in journey_runs + loose_runs if keep_workflow(r.get("workflow_id"))]

    names = {w.get("id"): w.get("name") for w in _list(record.get("workflows"))}
    catalogue: dict[str, Json] = {}
    for w in _list(record.get("workflows")):
        for a in _list(w.get("activities")):
            catalogue[a.get("id")] = {"name": a.get("name"), "actor_type": a.get("actor_type")}
    by_workflow: dict[Any, list[Json]] = {}
    for run in all_runs:
        by_workflow.setdefault(run.get("workflow_id"), []).append(facts_of(run))

    def workflow_name(id: Any, facts: list[Json]) -> Any:
        if _truthy(names.get(id)):
            return names[id]
        started = next((e for e in _events(facts[0]["run"]) if e.get("type") == "run.started"), None) if facts else None
        return _or(_data(started, "workflow_name") if started else _ABSENT, id)

    workflows = [_workflow_measures(id, workflow_name(id, facts), facts, catalogue) for id, facts in by_workflow.items()]

    journey_names = {j["definition"].get("id"): j["definition"].get("name") for j in given}
    journey_reports = []
    for j in journeys:
        definition, rows = j["definition"], j["rows"]
        instances = [r["instance"] for r in rows]
        events = [e for i in instances for e in _list(i.get("events"))]
        channels: dict[str, Json] = {}
        technologies: dict[str, int] = {}
        artefacts: dict[str, int] = {}
        for e in events:
            if e.get("type") != "journey.touchpoint":
                continue
            c = channels.setdefault(_text(_or(_data(e, "channel"), "unnamed")), {"touchpoints": 0, "inbound": 0, "outbound": 0})
            c["touchpoints"] += 1
            if _data(e, "direction") == "inbound":
                c["inbound"] += 1
            elif _data(e, "direction") == "outbound":
                c["outbound"] += 1
            if _truthy(_data(e, "technology")):
                _bump(technologies, _text(_data(e, "technology")))
            for a in _list(_or(_data(e, "artefacts"), [])):
                _bump(artefacts, _text(_or(_get(a, "kind"), _or(_get(a, "name"), "unnamed"))))
        changes = [e for e in events if e.get("type") == "journey.sentiment_changed"]
        spread: dict[float, int] = {}
        for i in instances:
            if _ended(i) and _is_number(i.get("sentiment")):
                _bump(spread, i["sentiment"])
        goals = _list(definition.get("goals"))
        sentiment = definition.get("sentiment")
        report: Json = {
            "journey_id": definition.get("id"), "name": definition.get("name"),
            "measures": _journey_measures(definition, rows, facts_of),
            "goals": [{
                "goal_id": g.get("id"), "name": g.get("name"),
                "reached": (reached := sum(1 for i in instances if g.get("id") in _list(i.get("goals_reached")))),
                "rate": reached / len(instances) if instances else None,
            } for g in goals],
            "stages": _stage_measures(definition, instances),
            "channels": sorted(({"channel": channel, **c} for channel, c in channels.items()), key=lambda c: -c["touchpoints"]),
            "technologies": sorted(({"technology": t, "touchpoints": n} for t, n in technologies.items()), key=lambda t: -t["touchpoints"]),
            "artefacts": sorted(({"kind": kind, "count": n} for kind, n in artefacts.items()), key=lambda a: -a["count"]),
        }
        if _truthy(sentiment):
            low, high = _get(sentiment, "min"), _get(sentiment, "max")
            report["mood"] = {
                "min": -2 if low is _ABSENT or low is None else low, "max": 2 if high is _ABSENT or high is None else high,
                "ended": sorted(({"value": value, "count": n} for value, n in spread.items()), key=lambda s: s["value"]),
                "measured_changes": sum(1 for e in changes if _data(e, "basis") == "measured"),
                "inferred_changes": sum(1 for e in changes if _data(e, "basis") != "measured"),
            }
        report["leads_to"] = [
            {"journey_id": t.get("to"), "name": _or(journey_names.get(t.get("to")), t.get("to")), "count": t.get("count")}
            for t in _list(record.get("transitions")) if t.get("from") == definition.get("id")
        ]
        journey_reports.append(report)

    # Over everything: the same rules, applied to all journeys as one and all runs as one
    every_row = [r for j in journeys for r in j["rows"]]
    overall: Json = {}
    if journeys:
        any_mood = any(_truthy(j["definition"].get("sentiment")) for j in journeys)
        overall = _journey_measures({"id": "", "name": "", "stages": [], "goals": [], **({"sentiment": {}} if any_mood else {})},
                                    every_row, facts_of)
        # Goals and the first mood belong to each journey: take them journey by journey
        with_goals = [j for j in journeys if _list(j["definition"].get("goals"))]
        reached = sum(1 for j in with_goals for r in j["rows"] if _reached_all(j["definition"]["goals"], r["instance"]))
        overall["journey.goal_attainment"] = _ratio(reached, sum(len(j["rows"]) for j in with_goals))
        moods = [
            (r["instance"]["sentiment"], r["instance"]["sentiment"] - _first_mood(j["definition"], r["instance"]))
            for j in journeys if _truthy(j["definition"].get("sentiment"))
            for r in j["rows"] if _ended(r["instance"]) and _is_number(r["instance"].get("sentiment"))
        ]
        overall["journey.mood_end"] = _mean([m[0] for m in moods])
        overall["journey.mood_change"] = _mean([m[1] for m in moods])
    every_run = _workflow_measures("", "", [facts_of(r) for r in all_runs], catalogue)["measures"]

    as_of = _or(record.get("as_of"), None) or _now_iso()
    attention = []
    for j in journeys:
        definition = j["definition"]
        for r in j["rows"]:
            i = r["instance"]
            if not (i.get("status") == "active" and _truthy(i.get("stalled"))):
                continue
            stage = next((s for s in _list(definition.get("stages")) if s.get("id") == i.get("stage_id")), None) or {}
            stall = next((e for e in reversed(_list(i.get("events"))) if e.get("type") == "journey.stalled"), None) or {}
            since = _or(i.get("stage_entered_at"), _or(stall.get("time"), i.get("started_at")))
            limit = _data(stall, "max_duration")
            attention.append({
                "journey_id": definition.get("id"), "journey_name": definition.get("name"), "instance_id": i.get("id"),
                "subject_key": i.get("subject_key"),
                **({"subject_name": r["subject_name"]} if _truthy(r.get("subject_name")) else {}),
                "stage_id": i.get("stage_id"), "stage_name": _or(stage.get("name"), i.get("stage_id")),
                **({"owner": stage["owner"]} if _truthy(stage.get("owner")) else {}),
                "since": since, "waiting_ms": _max0(_ms(as_of) - _ms(since)),
                "reason": _or(_data(stall, "reason"),
                              f"longer in the stage than the {_text(limit)} it is given" if _truthy(limit) else "stalled"),
            })
    attention.sort(key=lambda a: -a["waiting_ms"] if not math.isnan(a["waiting_ms"]) else 0)

    # Over time
    instances = [r["instance"] for r in every_row]
    run_list = [facts_of(r) for r in all_runs]
    times = [t for t in (
        [x for i in instances for x in (_ms(i.get("started_at")), _ms(i.get("ended_at")))]
        + [x for f in run_list for x in (f["started"], _NAN if f["ended"] is None else f["ended"])]
    ) if _finite(t)]
    first, last = (min(times), max(times)) if times else (_NAN, _NAN)
    span = last - first
    bucket = "day" if not span > 45 * _DAY else "month" if span > 400 * _DAY else "week"
    points: list[Json] = []
    if times:
        index: dict[int, Json] = {}
        t = _bucket_start(first, bucket)
        while t <= last:
            index[t] = {"start": _iso(t), "journeys_started": 0, "journeys_completed": 0, "journeys_abandoned": 0,
                        "runs_ended": 0, "runs_failed": 0, "cost": 0, "mood": None, "moods": []}
            t = _next_bucket(t, bucket)

        def at(time: float) -> Json | None:
            return index.get(_bucket_start(time, bucket)) if _finite(time) else None

        for i in instances:
            point = at(_ms(i.get("started_at")))
            if point:
                point["journeys_started"] += 1
            if not _truthy(i.get("ended_at")):
                continue
            point = at(_ms(i.get("ended_at")))
            if not point:
                continue
            if i.get("status") == "completed":
                point["journeys_completed"] += 1
            elif i.get("status") == "abandoned":
                point["journeys_abandoned"] += 1
            if _is_number(i.get("sentiment")):
                point["moods"].append(i["sentiment"])
        for f in run_list:
            if f["ended"] is None:
                continue
            point = at(f["ended"])
            if not point:
                continue
            point["runs_ended"] += 1
            if f["status"] == "failed":
                point["runs_failed"] += 1
            point["cost"] += f["cost"]
        for point in index.values():
            moods = point.pop("moods")
            points.append({**point, "mood": _mean(moods)["value"]})

    return _tidy({
        "spec_version": "1.1", "as_of": as_of,
        "period": {
            "from": _or(options.get("from"), None) or (_iso(first) if _finite(first) else None),
            "to": _or(options.get("to"), None) or (_iso(last) if _finite(last) else None),
        },
        "currency": next((f["currency"] for f in run_list if _truthy(f["currency"])), None),
        "totals": {**overall, **every_run},
        "journeys": journey_reports, "workflows": workflows, "attention": attention,
        "series": {"bucket": bucket, "points": points},
    })


def measures_to_openmetrics(report: Json) -> str:
    """
    The same measures in the OpenMetrics text format, for a metrics system to scrape.
    A measure without a value is left out, and names follow the measure ids:
    journey.completion_rate becomes awa_journey_completion_rate{journey="..."}.
    """
    def label(text: Any) -> str:
        return _text(text).replace("\\", "\\\\").replace('"', '\\"').replace("\n", "\\n")

    samples: dict[str, list[str]] = {}

    def add(id: str, labels: dict[str, Any], measure: Measure) -> None:
        value = measure.get("value")
        if value is None or not _finite(value):
            return
        name = "awa_" + id.replace(".", "_")
        text = ",".join(f'{key}="{label(item)}"' for key, item in labels.items())
        samples.setdefault(id, []).append(f"{name}{'{' + text + '}' if text else ''} {_number_text(value)}")

    for j in report.get("journeys", []):
        for id, measure in j["measures"].items():
            add(id, {"journey": j["name"]}, measure)
        for s in j["stages"]:
            for id, measure in s["measures"].items():
                add(id, {"journey": j["name"], "stage": s["name"]}, measure)
    for w in report.get("workflows", []):
        for id, measure in w["measures"].items():
            add(id, {"workflow": w["name"]}, measure)
        for a in w["activities"]:
            for id, measure in a["measures"].items():
                add(id, {"workflow": w["name"], "activity": a["name"]}, measure)

    lines: list[str] = []
    for definition in MEASURES:
        rows = samples.get(definition["id"])
        if not rows:
            continue
        name = "awa_" + definition["id"].replace(".", "_")
        lines += [f"# TYPE {name} gauge", f"# HELP {name} {definition['name']}. {definition['definition']}", *rows]
    lines.append("# EOF")
    return "\n".join(lines) + "\n"
