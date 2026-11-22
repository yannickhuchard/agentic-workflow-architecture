"""
AWA Journeys (specification section 19)

A workflow run is one piece of work. A journey is the longer story those pieces
belong to: one subject (a customer, a claim, an order) moving through stages
over days or months, driven by business events, with many runs along the way.

This module holds the journey document, the state of one journey, and the rules
that move it. It does no I/O; the runtime host (runtime_host.py) drives it.

A journey definition is a validated model. A journey instance and the events of
its record are plain JSON objects (dicts), in the form the specification gives
them, so that they are saved, exported and read by other implementations as they are.
"""

import math
from datetime import datetime, timedelta, timezone
from typing import Annotated, Any, Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator

from awa.runtime.duration import parse_iso_duration
from awa.runtime.expression import evaluate_expression, resolve_path

JOURNEY_SPEC_VERSION = "1.1"

_SLUG = r"^[a-z0-9][a-z0-9_-]{0,63}$"
_UUID = r"^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$"
_DURATION = r"^P(?:\d+Y)?(?:\d+M)?(?:\d+W)?(?:\d+D)?(?:T(?:\d+H)?(?:\d+M)?(?:\d+(?:\.\d+)?S)?)?$"

Number = int | float
JourneyInstance = dict[str, Any]
JourneyEvent = dict[str, Any]

JOURNEY_EVENT_TYPES = (
    "journey.started", "journey.event_received",
    "journey.stage_entered", "journey.stage_completed", "journey.stalled",
    "journey.run_started", "journey.run_ended",
    "journey.goal_reached",
    "journey.touchpoint", "journey.sentiment_changed",
    "journey.completed", "journey.abandoned",
)

# A kind of thing that changes hands, named as the business names it. `kind` is
# an open vocabulary; these are the recommended values.
ARTEFACT_KINDS = ("contract", "attestation", "invoice", "receipt", "certificate", "quote", "form", "evidence",
                  "notice", "order", "report", "survey")


class _Model(BaseModel):
    model_config = ConfigDict(extra="ignore", populate_by_name=True)


class StageOnEnter(_Model):
    start_workflow: str = Field(pattern=_UUID)


class StageTransition(_Model):
    to: str
    condition: str | None = None
    is_default: bool = False


class JourneyStage(_Model):
    id: str = Field(pattern=_SLUG)
    name: str
    description: str | None = None
    # Runs of these workflows belong to this stage
    workflows: list[Annotated[str, Field(pattern=_UUID)]] = Field(default_factory=list)
    # Started automatically when the stage is entered
    on_enter: StageOnEnter | None = None
    # The stage is complete when this is true of the journey's data
    complete_when: str | None = None
    # A journey that stays longer in the stage is stalled
    max_duration: str | None = Field(default=None, pattern=_DURATION)
    # Who must act when the journey stalls in this stage: a team, a role or a person
    owner: str | None = None
    # Where the journey goes when the stage completes. Absent: the next stage in the list. Empty: the journey completes here.
    transitions: list[StageTransition] | None = None


class JourneyArtefact(_Model):
    id: str = Field(pattern=_SLUG)
    name: str
    kind: str
    description: str | None = None


class TouchpointOccasion(_Model):
    event: str | None = None
    activity: str | None = None
    tool: str | None = None

    @model_validator(mode="after")
    def _exactly_one(self) -> "TouchpointOccasion":
        if sum(1 for value in (self.event, self.activity, self.tool) if value) != 1:
            raise ValueError("A touchpoint names exactly one of event, activity or tool")
        return self


class TouchpointExchange(_Model):
    artefact: str = Field(pattern=_SLUG)
    reference: str | None = None


class Touchpoint(_Model):
    """A moment at which the organisation and someone else are in contact, and what carries it"""
    id: str = Field(pattern=_SLUG)
    name: str
    # Who is on the other side: "subject" (the default) or the name of a third party, e.g. "bank"
    party: str = "subject"
    # inbound: the party acts towards the organisation. outbound: the organisation acts towards the party.
    direction: Literal["inbound", "outbound"]
    channel: str
    technology: str | None = None
    # What makes the touchpoint happen: a business event, the completion of an activity, or a tool call
    on: TouchpointOccasion
    # What changes hands. `reference` is a path in the data of the occasion that identifies the particular document.
    exchanges: list[TouchpointExchange] = Field(default_factory=list)


class SentimentMeasure(_Model):
    path: str
    from_: tuple[Number, Number] = Field(alias="from")


class SentimentRule(_Model):
    on: Literal["event", "touchpoint", "goal_reached", "stage_completed", "stalled", "run_failed", "waited"]
    # Narrow the rule: the event type, touchpoint id, goal id or stage id it applies to
    event: str | None = None
    touchpoint: str | None = None
    goal: str | None = None
    stage: str | None = None
    # waited: the subject acted and heard nothing for longer than this
    longer_than: str | None = Field(default=None, pattern=_DURATION)
    # Measured: read the value at `path` in the occasion's data, given on the scale `from`, onto the journey's scale
    measure: SentimentMeasure | None = None
    # Inferred: move the mood by this much
    change: Number | None = None
    reason: str | None = None

    @model_validator(mode="after")
    def _measure_or_change(self) -> "SentimentRule":
        if (self.measure is None) == (self.change is None):
            raise ValueError("A sentiment rule has either measure or change")
        return self


class Sentiment(_Model):
    """
    How the subject's mood is estimated. A value is either measured (the subject
    said so, and a rule reads it from an event) or inferred (the authors of the
    journey wrote a rule that moves it). The record says which, every time.
    """
    min: Number = -2
    max: Number = 2
    initial: Number = 0
    # A new journey begins with the mood the subject's previous journey ended with
    carry_over: bool = True
    rules: list[SentimentRule] = Field(default_factory=list)


class JourneySubject(_Model):
    name: str
    key: str


class JourneyTrigger(_Model):
    event: str
    # The event may begin a journey for a subject that has none
    starts_journey: bool = False
    enter_stage: str | None = None
    start_workflow: str | None = Field(default=None, pattern=_UUID)


class JourneyGoal(_Model):
    id: str
    name: str
    expression: str


class JourneyExit(_Model):
    event: str
    outcome: Literal["completed", "abandoned"]
    reason: str | None = None


class JourneyDefinition(_Model):
    id: str = Field(pattern=_UUID)
    name: str
    version: str = Field(pattern=r"^\d+\.\d+\.\d+$")
    awa_version: str | None = None
    description: str | None = None
    # Whose journey it is, and the property that identifies them in events and run data
    subject: JourneySubject
    stages: list[JourneyStage] = Field(min_length=1)
    # What a business event does to the journey
    triggers: list[JourneyTrigger] = Field(default_factory=list)
    # Outcomes worth tracking, each true or false of the journey's data
    goals: list[JourneyGoal] = Field(default_factory=list)
    # Events that end the journey early
    exits: list[JourneyExit] = Field(default_factory=list)
    # Run data properties copied into the journey's data when a run ends. Absent: all.
    collect: list[str] | None = None
    # The kinds of thing that change hands
    artefacts: list[JourneyArtefact] = Field(default_factory=list)
    # The moments of contact, with their channel, technology and what is exchanged
    touchpoints: list[Touchpoint] = Field(default_factory=list)
    # How the subject's mood is estimated
    sentiment: Sentiment | None = None

    def stage(self, stage_id: str) -> JourneyStage | None:
        return next((s for s in self.stages if s.id == stage_id), None)

    def to_json(self) -> dict[str, Any]:
        """The definition as a JSON object: defaults filled in, absent properties left out"""
        return self.model_dump(mode="json", by_alias=True, exclude_none=True)


def parse_journey(document: dict[str, Any]) -> JourneyDefinition:
    """Read a journey document. Raises a validation error if it does not have the form of one."""
    return JourneyDefinition.model_validate(document)


# ---------------------------------------------------------------------------
# Small helpers
# ---------------------------------------------------------------------------

_EPOCH = datetime(1970, 1, 1, tzinfo=timezone.utc)


def time_ms(instant: str) -> int:
    """An RFC 3339 timestamp as whole milliseconds since the epoch"""
    moment = datetime.fromisoformat(instant.replace("Z", "+00:00"))
    if moment.tzinfo is None:
        moment = moment.replace(tzinfo=timezone.utc)
    return (moment - _EPOCH) // timedelta(milliseconds=1)


def time_text(epoch_ms: float) -> str:
    """Milliseconds since the epoch as an RFC 3339 timestamp in UTC"""
    whole = math.floor(epoch_ms)
    return (_EPOCH + timedelta(milliseconds=whole)).strftime("%Y-%m-%dT%H:%M:%S.") + f"{whole % 1000:03d}Z"


def _whole(value: Number) -> Number:
    """A whole number as an integer, so that it is written 1 and not 1.0"""
    return int(value) if isinstance(value, float) and value.is_integer() else value


def _safe(expression: str, data: dict[str, Any]) -> bool:
    try:
        return evaluate_expression(expression, data)
    except Exception:
        return False


def _as_number(value: Any) -> float | None:
    """A value read from an event as a number, or None when it is not one"""
    if value is None or isinstance(value, bool):
        return None
    if isinstance(value, (int, float)):
        return None if isinstance(value, float) and not math.isfinite(value) else value
    if isinstance(value, str) and value.strip():
        try:
            number = float(value.strip())
        except ValueError:
            return None
        return number if math.isfinite(number) else None
    return None


# ---------------------------------------------------------------------------
# Instance and record (19.4)
# ---------------------------------------------------------------------------

def new_journey_instance(definition: JourneyDefinition, id: str, subject_key: str, time: str) -> JourneyInstance:
    instance: JourneyInstance = {
        "id": id, "journey_id": definition.id, "subject_key": subject_key, "status": "active",
        "stage_id": definition.stages[0].id, "stage_entered_at": time, "stalled": False,
        # Facts accumulated from events and runs
        "data": {}, "goals_reached": [], "runs": [], "stage_history": [], "started_at": time, "events": [],
    }
    if definition.sentiment:
        instance["sentiment"] = definition.sentiment.initial
    return instance


def record_journey_event(instance: JourneyInstance, type: str, time: str, data: dict[str, Any] | None = None, *,
                         stage_id: str | None = None, run_id: str | None = None) -> JourneyEvent:
    """Append one entry to the record of a journey. Entries are numbered from 1 without gaps."""
    event: JourneyEvent = {
        "spec_version": JOURNEY_SPEC_VERSION, "journey_instance_id": instance["id"], "journey_id": instance["journey_id"],
        "seq": len(instance["events"]) + 1, "time": time, "type": type,
        "stage_id": stage_id if stage_id is not None else instance["stage_id"],
    }
    if run_id:
        event["run_id"] = run_id
    event["data"] = {key: value for key, value in (data or {}).items() if value is not None}
    instance["events"].append(event)
    return event


def enter_stage(definition: JourneyDefinition, instance: JourneyInstance, stage_id: str, time: str, reason: str) -> str | None:
    """Move the journey into a stage. Returns the workflow to start there, if the stage names one."""
    stage = definition.stage(stage_id)
    if not stage:
        raise ValueError(f'Journey "{definition.name}" has no stage "{stage_id}"')
    _leave_stage(instance, time)
    instance["stage_id"] = stage.id
    instance["stage_entered_at"] = time
    instance["stalled"] = False
    instance["stage_history"].append({"stage_id": stage.id, "entered_at": time})
    record_journey_event(instance, "journey.stage_entered", time, {"stage_name": stage.name, "reason": reason}, stage_id=stage.id)
    return stage.on_enter.start_workflow if stage.on_enter else None


def _leave_stage(instance: JourneyInstance, time: str) -> None:
    current = next((h for h in instance["stage_history"] if not h.get("left_at")), None)
    if current:
        current["left_at"] = time


def end_journey(instance: JourneyInstance, outcome: str, time: str) -> None:
    """The journey is over: it leaves its stage and takes its final status"""
    _leave_stage(instance, time)
    instance["status"] = outcome
    instance["ended_at"] = time


# ---------------------------------------------------------------------------
# Mood (19.9)
# ---------------------------------------------------------------------------

def apply_sentiment(definition: JourneyDefinition, instance: JourneyInstance, time: str, on: str, *,
                    event: str | None = None, touchpoint: str | None = None, goal: str | None = None,
                    stage: str | None = None, data: dict[str, Any] | None = None, waited_ms: float | None = None) -> None:
    """
    Let what just happened move the estimate of the subject's mood. Every rule
    that matches applies, in order. Each change is recorded with its basis, so
    that a reader can tell what the subject said from what was assumed.
    """
    sentiment = definition.sentiment
    if not sentiment or instance.get("sentiment") is None:
        return
    for rule in sentiment.rules:
        if rule.on != on:
            continue
        if ((rule.event and rule.event != event) or (rule.touchpoint and rule.touchpoint != touchpoint)
                or (rule.goal and rule.goal != goal) or (rule.stage and rule.stage != stage)):
            continue
        if rule.on == "waited" and (not rule.longer_than or (waited_ms or 0) <= parse_iso_duration(rule.longer_than)):
            continue

        previous = instance["sentiment"]
        if rule.measure:
            raw = _as_number(resolve_path(data or {}, rule.measure.path))
            if raw is None:
                continue
            low, high = rule.measure.from_
            if high == low:
                continue
            value = sentiment.min + (raw - low) / (high - low) * (sentiment.max - sentiment.min)
        else:
            value = previous + (rule.change or 0)
        # To two decimals, halves upwards, and kept within the scale
        value = _whole(min(sentiment.max, max(sentiment.min, math.floor(value * 100 + 0.5) / 100)))
        if value == previous and not rule.measure:
            continue
        instance["sentiment"] = value
        record_journey_event(instance, "journey.sentiment_changed", time, {
            "value": value, "previous": previous, "basis": "measured" if rule.measure else "inferred",
            "reason": rule.reason or None, "on": on,
        })


# ---------------------------------------------------------------------------
# Touchpoints (19.8)
# ---------------------------------------------------------------------------

def touchpoints_for(definition: JourneyDefinition, *, event: str | None = None, activity: str | None = None,
                    tool: str | None = None) -> list[Touchpoint]:
    """The touchpoints an occasion realises"""
    return [t for t in definition.touchpoints if
            (event is not None and t.on.event == event)
            or (activity is not None and t.on.activity == activity)
            or (tool is not None and t.on.tool == tool)]


def _reference_text(value: Any) -> str:
    if isinstance(value, bool):
        return "true" if value else "false"
    if isinstance(value, float) and value.is_integer():
        return str(int(value))
    return str(value)


def record_touchpoint(definition: JourneyDefinition, instance: JourneyInstance, touchpoint: Touchpoint, time: str, *,
                      data: dict[str, Any] | None = None, run_id: str | None = None, event_id: str | None = None,
                      link: str | None = None) -> JourneyEvent:
    """Record that a touchpoint took place: who was in contact, over what channel and technology, and what changed hands"""
    data = data if isinstance(data, dict) else {}
    artefacts = []
    for exchange in touchpoint.exchanges:
        artefact = next((a for a in definition.artefacts if a.id == exchange.artefact), None)
        reference = resolve_path(data, exchange.reference) if exchange.reference else None
        artefacts.append({
            "id": exchange.artefact, "name": artefact.name if artefact else exchange.artefact,
            "kind": artefact.kind if artefact else "unknown",
            **({"reference": _reference_text(reference)} if reference is not None else {}),
        })
    to_subject = touchpoint.party == "subject"

    # The subject acted and heard nothing for a while: that wait is felt when the reply comes
    if to_subject and touchpoint.direction == "outbound" and instance.get("awaiting_reply_since"):
        waited_ms = time_ms(time) - time_ms(instance.pop("awaiting_reply_since"))
        apply_sentiment(definition, instance, time, "waited", waited_ms=waited_ms)
    if to_subject and touchpoint.direction == "inbound" and not instance.get("awaiting_reply_since"):
        instance["awaiting_reply_since"] = time

    event = record_journey_event(instance, "journey.touchpoint", time, {
        "touchpoint_id": touchpoint.id, "name": touchpoint.name, "party": touchpoint.party, "direction": touchpoint.direction,
        "channel": touchpoint.channel, "technology": touchpoint.technology or None,
        "artefacts": artefacts, "event_id": event_id or None, "link": link or None,
    }, run_id=run_id)
    apply_sentiment(definition, instance, time, "touchpoint", touchpoint=touchpoint.id, data=data)
    return event


# ---------------------------------------------------------------------------
# Moving a journey (19.2)
# ---------------------------------------------------------------------------

def advance_journey(definition: JourneyDefinition, instance: JourneyInstance, time: str) -> list[str]:
    """
    Apply the journey's rules to its current data: record goals newly reached,
    and complete the current stage if its condition holds, moving to the next.
    Returns the workflows to start as a result.
    """
    to_start: list[str] = []
    if instance["status"] != "active":
        return to_start

    for goal in definition.goals:
        if goal.id not in instance["goals_reached"] and _safe(goal.expression, instance["data"]):
            instance["goals_reached"].append(goal.id)
            record_journey_event(instance, "journey.goal_reached", time, {"goal_id": goal.id, "goal_name": goal.name})
            apply_sentiment(definition, instance, time, "goal_reached", goal=goal.id)

    # A stage may complete at once on entry, so this repeats; the bound stops a cycle of always-true stages
    for _ in range(len(definition.stages) + 1):
        stage = definition.stage(instance["stage_id"])
        if not stage or not stage.complete_when or not _safe(stage.complete_when, instance["data"]):
            break

        record_journey_event(instance, "journey.stage_completed", time, {
            "stage_name": stage.name, "duration_ms": time_ms(time) - time_ms(instance["stage_entered_at"])})
        apply_sentiment(definition, instance, time, "stage_completed", stage=stage.id)

        index = definition.stages.index(stage)
        transitions = stage.transitions
        if transitions is not None:
            chosen = (next((t for t in transitions if t.condition and _safe(t.condition, instance["data"])), None)
                      or next((t for t in transitions if t.is_default), None)
                      or next((t for t in transitions if not t.condition), None))
            following = chosen.to if chosen else None
        else:
            following = definition.stages[index + 1].id if index + 1 < len(definition.stages) else None

        if not following:
            end_journey(instance, "completed", time)
            record_journey_event(instance, "journey.completed", time, {"goals_reached": list(instance["goals_reached"])})
            break
        workflow = enter_stage(definition, instance, following, time, f'stage "{stage.name}" completed')
        if workflow:
            to_start.append(workflow)
    return to_start


def check_stalled(definition: JourneyDefinition, instance: JourneyInstance, now: float) -> bool:
    """Mark the journey stalled if it has been in its stage longer than the stage allows"""
    if instance["status"] != "active" or instance["stalled"]:
        return False
    stage = definition.stage(instance["stage_id"])
    if not stage or not stage.max_duration:
        return False
    spent = _whole(now - time_ms(instance["stage_entered_at"]))
    if spent <= parse_iso_duration(stage.max_duration):
        return False
    instance["stalled"] = True
    time = time_text(now)
    record_journey_event(instance, "journey.stalled", time, {
        "stage_name": stage.name, "max_duration": stage.max_duration, "in_stage_ms": spent, "owner": stage.owner or None})
    apply_sentiment(definition, instance, time, "stalled", stage=stage.id)
    return True


# ---------------------------------------------------------------------------
# Analytics (19.6) and transitions between journeys (19.7)
# ---------------------------------------------------------------------------

def journey_transitions(instances: list[JourneyInstance]) -> list[dict[str, Any]]:
    """How subjects move from one journey to the next: for each pair, how many did"""
    by_subject: dict[str, list[JourneyInstance]] = {}
    for instance in instances:
        by_subject.setdefault(instance["subject_key"], []).append(instance)
    pairs: dict[tuple[str, str], dict[str, Any]] = {}
    for subject, own in by_subject.items():
        ordered = sorted(own, key=lambda i: i["started_at"])
        for before, after in zip(ordered, ordered[1:]):
            pair = pairs.setdefault((before["journey_id"], after["journey_id"]), {
                "from": before["journey_id"], "to": after["journey_id"], "count": 0, "subjects": []})
            pair["count"] += 1
            pair["subjects"].append(subject)
    return list(pairs.values())


def journey_analytics(definition: JourneyDefinition, instances: list[JourneyInstance]) -> dict[str, Any]:
    """The funnel of a journey: for each stage, how many came in, went on, are waiting, stalled or dropped out"""
    mine = [i for i in instances if i["journey_id"] == definition.id]
    stages = []
    for stage in definition.stages:
        visits = [(i, h) for i in mine for h in i["stage_history"] if h["stage_id"] == stage.id]
        entered = len({i["id"] for i, _ in visits})
        here = [i for i in mine if i["stage_id"] == stage.id]
        # A stage left because the journey was abandoned in it was not completed
        done = [(i, h) for i, h in visits if h.get("left_at") and not (
            i["status"] == "abandoned" and i["stage_id"] == stage.id and h is i["stage_history"][-1])]
        durations = sorted(time_ms(h["left_at"]) - time_ms(h["entered_at"]) for _, h in done)
        completed = len({i["id"] for i, _ in done})
        stages.append({
            "stage_id": stage.id, "stage_name": stage.name,
            "entered": entered, "completed": completed,
            "active": sum(1 for i in here if i["status"] == "active"),
            "stalled": sum(1 for i in here if i["status"] == "active" and i["stalled"]),
            "abandoned": sum(1 for i in here if i["status"] == "abandoned"),
            **({"median_duration_ms": durations[(len(durations) - 1) // 2]} if durations else {}),
            **({"conversion": _whole(completed / entered)} if entered else {}),
        })
    return {
        "total": len(mine),
        "completed": sum(1 for i in mine if i["status"] == "completed"),
        "abandoned": sum(1 for i in mine if i["status"] == "abandoned"),
        "active": sum(1 for i in mine if i["status"] == "active"),
        "goals": {g.id: sum(1 for i in mine if g.id in i["goals_reached"]) for g in definition.goals},
        "stages": stages,
    }


# ---------------------------------------------------------------------------
# Validation beyond the form of the document
# ---------------------------------------------------------------------------

def validate_journey(definition: JourneyDefinition, workflow_ids: set[str] | None = None, strict: bool = False) -> list[dict[str, str]]:
    """
    Check a journey beyond its form: stages, expressions and references.
    Workflow references are checked when `workflow_ids` is given, or always with `strict`.
    Returns the problems found, each with `path`, `message` and `code`.
    """
    workflow_ids = workflow_ids or set()
    errors: list[dict[str, str]] = []

    def problem(path: str, message: str, code: str) -> None:
        errors.append({"path": path, "message": message, "code": code})

    def duplicates(ids: list[str]) -> list[str]:
        return list(dict.fromkeys(i for n, i in enumerate(ids) if ids.index(i) != n))

    def expression(text: str | None, path: str) -> None:
        if not text:
            return
        try:
            evaluate_expression(text, {})
        except Exception as error:
            problem(path, str(error), "invalid_expression")

    def workflow(id: str | None, path: str) -> None:
        if id and (strict or workflow_ids) and id not in workflow_ids:
            problem(path, f"Workflow '{id}' is not registered", "invalid_reference")

    ids = [s.id for s in definition.stages]
    for id in duplicates(ids):
        problem("stages", f"Duplicate stage '{id}'", "duplicate_id")
    for stage in definition.stages:
        expression(stage.complete_when, f"stages[{stage.id}].complete_when")
        workflow(stage.on_enter.start_workflow if stage.on_enter else None, f"stages[{stage.id}].on_enter")
        for workflow_id in stage.workflows:
            workflow(workflow_id, f"stages[{stage.id}].workflows")
        for transition in stage.transitions or []:
            if transition.to not in ids:
                problem(f"stages[{stage.id}].transitions", f"Stage '{transition.to}' not found", "invalid_reference")
            expression(transition.condition, f"stages[{stage.id}].transitions")
    for trigger in definition.triggers:
        if trigger.enter_stage and trigger.enter_stage not in ids:
            problem(f"triggers[{trigger.event}]", f"Stage '{trigger.enter_stage}' not found", "invalid_reference")
        workflow(trigger.start_workflow, f"triggers[{trigger.event}]")
    for goal in definition.goals:
        expression(goal.expression, f"goals[{goal.id}]")

    artefact_ids = {a.id for a in definition.artefacts}
    touchpoint_ids = [t.id for t in definition.touchpoints]
    for id in duplicates(touchpoint_ids):
        problem("touchpoints", f"Duplicate touchpoint '{id}'", "duplicate_id")
    for touchpoint in definition.touchpoints:
        for exchange in touchpoint.exchanges:
            if exchange.artefact not in artefact_ids:
                problem(f"touchpoints[{touchpoint.id}].exchanges", f"Artefact '{exchange.artefact}' not found", "invalid_reference")
    for index, rule in enumerate(definition.sentiment.rules if definition.sentiment else []):
        path = f"sentiment.rules[{index}]"
        if rule.touchpoint and rule.touchpoint not in touchpoint_ids:
            problem(path, f"Touchpoint '{rule.touchpoint}' not found", "invalid_reference")
        if rule.goal and not any(g.id == rule.goal for g in definition.goals):
            problem(path, f"Goal '{rule.goal}' not found", "invalid_reference")
        if rule.stage and rule.stage not in ids:
            problem(path, f"Stage '{rule.stage}' not found", "invalid_reference")
        if rule.on == "waited" and not rule.longer_than:
            problem(path, 'A "waited" rule needs longer_than', "invalid_journey")
    if not any(t.starts_journey for t in definition.triggers):
        problem("triggers", "No trigger can start the journey: set starts_journey on at least one", "invalid_journey")
    return errors
