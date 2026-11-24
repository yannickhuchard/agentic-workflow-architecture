"""
Hosts that share a store (specification section 29)

A host of journeys and runs (AwaRuntime) can keep its state in a store that
several hosts use at once. The store divides what it keeps into partitions:
one per subject (every journey instance of a subject, and the runs started for
them) and one per run that belongs to no journey. Each operation of a host is
one unit of work in the store: it holds the partitions it reads or changes,
loads them as last kept, does its work on them alone, and keeps what it
changed, all or nothing. An event id is recorded as accepted in the same unit,
so that no event is ever taken twice.

This module holds the contract a store meets (SharedRuntimeStore, StoreUnit)
and what a host does with it (SharedOperation). PostgresRuntimeStore in
postgres_store.py is one such store. It follows the TypeScript reference,
sdk/typescript/src/runtime/shared_store.ts, and keeps the same stored forms.
"""

import json
from collections.abc import Callable
from typing import Any, Protocol

from awa.runtime.business_event import BusinessEvent
from awa.runtime.duration import parse_iso_duration
from awa.runtime.expression import resolve_path
from awa.runtime.journal import JournalEvent, JournalStore
from awa.runtime.journey import JourneyDefinition, JourneyInstance, time_ms

SETTLED_STATUSES = ("completed", "failed", "cancelled")

# A journey instance as a store keeps it:
#   instance, partition, due_at (ms or None), version (0: created by this operation), kept_events
StoredInstance = dict[str, Any]
# A run as a store keeps it:
#   run_id, workflow_id, journey_instance_id?, state, outbox, partition, due_at, waits_for, waits, version
StoredRun = dict[str, Any]


class StoreConflict(Exception):
    """A store refused to keep what an operation changed, because another changed it meanwhile. The operation is begun again."""


class StoreUnit(Protocol):
    """One operation of one host, as the store sees it. Everything it does is kept when it ends well, nothing otherwise."""

    journal: JournalStore

    def accept(self, event: BusinessEvent) -> bool: ...

    def hold(self, partitions: list[str]) -> None: ...

    def try_hold(self, partition: str) -> bool: ...

    def lock_waits(self, keys: list[str], mode: str) -> None: ...

    def waiting_for(self, type: str) -> list[dict[str, Any]]: ...

    def due(self, now: float) -> list[str]: ...

    def partition_of_run(self, run_id: str) -> str | None: ...

    def load(self, partitions: list[str]) -> dict[str, list[dict[str, Any]]]: ...

    def write(self, instances: list[StoredInstance], runs: list[StoredRun]) -> None: ...


class SharedRuntimeStore(Protocol):
    """A store that several hosts may use at once (29.1)"""

    host_id: str
    journal: JournalStore

    def operation(self, work: Callable[[StoreUnit], Any]) -> Any: ...

    def read_all(self) -> dict[str, list[dict[str, Any]]]: ...

    def required_definitions(self) -> dict[str, Any]: ...

    def definitions(self) -> list[dict[str, Any]]: ...

    def add_definition(self, document: dict[str, Any]) -> dict[str, str]: ...

    def close(self) -> None: ...


def subject_partition(subject_key: str) -> str:
    return f"subject:{subject_key}"


def run_partition(run_id: str) -> str:
    return f"run:{run_id}"


def _awaited(token: dict[str, Any]) -> dict[str, Any] | None:
    if token.get("status") != "waiting":
        return None
    awaited = (token.get("context_data") or {}).get("_awaiting_event")
    return awaited if isinstance(awaited, dict) else None


def run_waits(state: dict[str, Any]) -> list[dict[str, Any]]:
    """What a run's waiting tokens wait for, with their correlation"""
    waits = []
    for token in state.get("tokens") or []:
        awaited = _awaited(token)
        if not awaited or not awaited.get("name"):
            continue
        wait: dict[str, Any] = {"name": awaited["name"]}
        if awaited.get("correlation_key"):
            wait["correlation_key"] = awaited["correlation_key"]
            if "correlation_value" in awaited:
                wait["correlation_value"] = awaited["correlation_value"]
        waits.append(wait)
    return waits


def run_waits_for(state: dict[str, Any]) -> list[str]:
    """The business event types a run's waiting tokens wait for"""
    return sorted({w["name"] for w in run_waits(state)})


def wait_key(wait: dict[str, Any]) -> str:
    """The key that orders a wait against the events that may reach it: its type, and its correlation if it has one"""
    from awa.runtime.workflow_engine import _ABSENT, _as_text
    if wait.get("correlation_key"):
        return f"wait:{wait['name']}:{wait['correlation_key']}={_as_text(wait.get('correlation_value', _ABSENT))}"
    return f"wait:{wait['name']}"


def event_wait_keys(event: BusinessEvent, workflows: Any) -> list[str]:
    """The wait keys of every wait an event may reach, given the correlation keys the workflows use for its type"""
    from awa.runtime.workflow_engine import _ABSENT
    data: dict[str, Any] = event["data"] if isinstance(event.get("data"), dict) else {}
    keys = {f"wait:{event['type']}"}
    for workflow in workflows:
        for node in workflow.events or []:
            definition = node.event_definition or {}
            if node.event_type == "message" and definition.get("name") == event["type"] and definition.get("correlation_key"):
                key = definition["correlation_key"]
                value = resolve_path(data, key, _ABSENT)
                keys.add(wait_key({"name": event["type"], "correlation_key": key,
                                   **({} if value is _ABSENT else {"correlation_value": value})}))
    return sorted(keys)


def may_reach(wait: dict[str, Any], event: BusinessEvent) -> bool:
    """Whether an event may reach a waiting token: as the engine decides it (18.3)"""
    from awa.runtime.workflow_engine import _ABSENT, _as_text
    if wait.get("name") != event.get("type"):
        return False
    key = wait.get("correlation_key")
    if not key:
        return True
    data: dict[str, Any] = event["data"] if isinstance(event.get("data"), dict) else {}
    return _as_text(resolve_path(data, key, _ABSENT)) == _as_text(wait.get("correlation_value", _ABSENT))


def run_due(workflow: Any, state: dict[str, Any]) -> float | None:
    """
    When time next acts on a run, in milliseconds. A run whose work is held to a
    service level is due at every tick while it has not settled: from the epoch on.
    """
    if str(state.get("engine_status")) in SETTLED_STATUSES:
        return None
    tokens = state.get("tokens") or []
    if any(t.get("status") == "active" for t in tokens):
        return 0  # left in the middle of an activity: continued at the next tick
    if workflow is not None and (getattr(workflow, "sla", None) or any(getattr(a, "sla", None) for a in workflow.activities)):
        return 0
    deadlines = []
    for token in tokens:
        awaited = _awaited(token)
        if awaited and awaited.get("due_at"):
            try:
                deadlines.append(time_ms(awaited["due_at"]))
            except ValueError:
                pass
    return min(deadlines) if deadlines else None


def instance_due(definition: JourneyDefinition | None, instance: JourneyInstance) -> float | None:
    """When a journey instance's stage outlasts its limit, if it can"""
    if definition is None or instance.get("status") != "active" or instance.get("stalled"):
        return None
    stage = definition.stage(instance["stage_id"])
    if stage is None or not stage.max_duration:
        return None
    try:
        return time_ms(instance["stage_entered_at"]) + parse_iso_duration(stage.max_duration)
    except ValueError:
        return None


def _text(value: Any) -> str:
    return json.dumps(value, sort_keys=True, default=str)


def _run_text(state: dict[str, Any], outbox: list[BusinessEvent]) -> str:
    return _text({**state, "checkpoint_at": None, "outbox": outbox})


class HostView(Protocol):
    """What a host lends an operation: its definitions, the maps of its working set, and how it rebuilds a run"""

    workflows: dict[str, Any]
    journeys: dict[str, JourneyDefinition]
    concerns: dict[str, set[str]]
    instances: dict[str, JourneyInstance]
    runs: dict[str, Any]
    run_journey: dict[str, str]
    outbox: dict[str, list[BusinessEvent]]

    def adopt(self, saved: StoredRun) -> Any: ...

    def subject_of(self, definition: JourneyDefinition, event: BusinessEvent) -> str | None: ...


class SharedOperation:
    """
    One operation of a host on a shared store. The host's maps hold only the
    partitions the operation holds; what the host reads, it has loaded fresh
    under its hold, and what it changed is written back when the operation ends.
    """

    def __init__(self, unit: StoreUnit, view: HostView) -> None:
        self.unit = unit
        self._view = view
        self._held: set[str] = set()
        self._kept_instances: dict[str, dict[str, Any]] = {}
        self._kept_runs: dict[str, dict[str, Any]] = {}

    def loaded_events(self) -> dict[str, int]:
        """How many journey events each instance held when it was loaded: what follows them is what this operation added"""
        return {instance_id: kept["events"] for instance_id, kept in self._kept_instances.items()}

    def hold(self, partitions: list[str]) -> None:
        """Hold the partitions and load what they keep into the working set"""
        wanted = sorted({p for p in partitions if p not in self._held})
        if not wanted:
            return
        # Always in the same order, so that two operations wanting the same partitions do not wait for one another
        self.unit.hold(wanted)
        self._load(wanted)

    def _load(self, partitions: list[str]) -> None:
        self._held.update(partitions)
        loaded = self.unit.load(partitions)
        for kept in loaded["instances"]:
            instance = kept["instance"]
            if instance["journey_id"] not in self._view.journeys:
                raise RuntimeError(f"Journey instance {instance['id']} needs journey {instance['journey_id']}, "
                                   "which is not registered on this host. Nothing was changed.")
            self._view.instances[instance["id"]] = instance
            self._kept_instances[instance["id"]] = {"text": _text(instance), "events": len(instance["events"]), "version": kept["version"]}
        for kept in loaded["runs"]:
            version = (kept.get("state") or {}).get("workflow_version")
            has = getattr(self._view, "has_workflow", None)
            if not (has(kept["workflow_id"], version) if has else kept["workflow_id"] in self._view.workflows):
                needed = f"workflow {kept['workflow_id']}" + (f" version {version}" if version else "")
                raise RuntimeError(f"Run {kept['run_id']} needs {needed}, "
                                   "which is not registered on this host. Nothing was changed.")
            self._kept_runs[kept["run_id"]] = {"text": _run_text(kept["state"], kept["outbox"]), "version": kept["version"],
                                               "waits": [wait_key(w) for w in kept["waits"]]}
            if kept["outbox"]:
                self._view.outbox[kept["run_id"]] = list(kept["outbox"])
            if kept.get("journey_instance_id"):
                self._view.run_journey[kept["run_id"]] = kept["journey_instance_id"]
            self._view.adopt(kept)

    def accept(self, event: BusinessEvent) -> bool:
        """
        Accept an event: record its id, then hold every partition it can touch: the
        subject of each journey it concerns, and every run waiting for it. False when
        the event was accepted before, by this host or another.
        """
        if not self.unit.accept(event):
            return False
        subjects = []
        for definition in self._view.journeys.values():
            if event["type"] not in self._view.concerns.get(definition.id, set()):
                continue
            key = self._view.subject_of(definition, event)
            if key is not None:
                subjects.append(subject_partition(key))
        self.hold(subjects)
        # No operation may keep a new wait this event could reach until this one has looked for the waits there are
        every = getattr(self._view, "all_workflows", None)
        self.unit.lock_waits(event_wait_keys(event, every() if every else self._view.workflows.values()), "shared")
        # A run may start waiting in a partition not yet held while this one waited: ask again until nothing new appears.
        # Only runs whose correlation the event matches are held, so that events about different subjects do not wait for one another.
        while True:
            more = [r["partition"] for r in self.unit.waiting_for(event["type"])
                    if r["partition"] not in self._held and any(may_reach(w, event) for w in r["waits"])]
            if not more:
                return True
            self.hold(more)

    def hold_due(self, now: float) -> None:
        """Hold the partitions in which time acts by now, leaving those another operation holds to it or to a later tick"""
        for partition in sorted(p for p in set(self.unit.due(now)) if p not in self._held):
            if self.unit.try_hold(partition):
                self._load([partition])

    def hold_run(self, run_id: str) -> None:
        partition = self.unit.partition_of_run(run_id)
        if partition:
            self.hold([partition])

    def write(self) -> None:
        """Write back what the operation changed"""
        instances: list[StoredInstance] = []
        for instance in self._view.instances.values():
            kept = self._kept_instances.get(instance["id"])
            if kept and kept["text"] == _text(instance):
                continue
            partition = subject_partition(instance["subject_key"])
            if partition not in self._held:
                raise RuntimeError(f"Journey instance {instance['id']} was changed outside the partitions this operation holds")
            instances.append({"instance": instance, "partition": partition, "version": kept["version"] if kept else 0,
                              "kept_events": kept["events"] if kept else 0,
                              "due_at": instance_due(self._view.journeys.get(instance["journey_id"]), instance)})
        runs: list[StoredRun] = []
        for run_id, engine in self._view.runs.items():
            state, outbox = engine.snapshot(), self._view.outbox.get(run_id, [])
            kept = self._kept_runs.get(run_id)
            if kept and kept["text"] == _run_text(state, outbox):
                continue
            owner = self._view.instances.get(self._view.run_journey.get(run_id) or "")
            partition = subject_partition(owner["subject_key"]) if owner else run_partition(run_id)
            if kept and partition not in self._held:
                raise RuntimeError(f"Run {run_id} was changed outside the partitions this operation holds")
            run: StoredRun = {
                "run_id": run_id, "workflow_id": str(state["workflow_id"]), "state": state, "outbox": outbox, "partition": partition,
                "due_at": run_due(self._view.workflows.get(str(state["workflow_id"])), state),
                "waits_for": run_waits_for(state), "waits": run_waits(state), "version": kept["version"] if kept else 0,
            }
            if owner:
                run["journey_instance_id"] = owner["id"]
            runs.append(run)
        # A wait that is new must not be kept while an event that could reach it is being accepted unseen (29.3)
        new_waits = {key for run in runs for key in map(wait_key, run["waits"])
                     if key not in (self._kept_runs.get(run["run_id"]) or {}).get("waits", [])}
        if new_waits:
            self.unit.lock_waits(sorted(new_waits), "exclusive")
        self.unit.write(instances, runs)


class SharedJournal:
    """
    The journal a host's runs write to on a shared store: within an operation it is
    the operation's, so that journal and state are kept together; outside one it
    reads what is kept.
    """

    def __init__(self, store: SharedRuntimeStore, current: Callable[[], SharedOperation | None]) -> None:
        self._store = store
        self._current = current

    def append(self, event: JournalEvent) -> None:
        operation = self._current()
        if operation is None:
            raise RuntimeError("On a shared store a run journals only within an operation of its host")
        operation.unit.journal.append(event)

    def read(self, run_id: str, after_seq: int = 0) -> list[JournalEvent]:
        operation = self._current()
        return (operation.unit.journal if operation else self._store.journal).read(run_id, after_seq)

