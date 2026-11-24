"""
AWA Runtime host (specification sections 18 and 19)

Hosts many runs and the journeys they belong to, and is the one place business
events enter. For each event it: ignores it if already accepted, records it on
the journeys it concerns, hands it to the runs waiting for it, starts the runs
it triggers, and moves the journeys on.

With a store, the host saves what it knows after every operation, so that
another process can register the same definitions, call recover() and carry on
(19.10). open_runtime_directory() keeps definitions, state and journals side by
side in one directory and holds that directory exclusively.
"""

import atexit
import json
import math
import os
import sys
import threading
from typing import Any, Callable, Protocol
from uuid import uuid4

from awa.runtime.telemetry_export import JourneyTelemetry, resolve_telemetry
from awa.runtime.business_event import BusinessEvent
from awa.runtime.expression import resolve_path
from awa.runtime.journal import FileJournalStore, public_payload
from awa.runtime.journey import (
    JourneyDefinition, JourneyInstance, advance_journey, apply_sentiment, check_stalled, end_journey, enter_stage,
    journey_analytics, journey_transitions, new_journey_instance, parse_journey, record_journey_event,
    record_touchpoint, time_text, touchpoints_for, validate_journey,
)
from awa.runtime.shared_store import SharedJournal, SharedOperation, StoredRun
from awa.runtime.migration import compare_versions, plan_migration, semver_key
from awa.runtime.subworkflow import called_workflows, record_child_runs
from awa.runtime.token import TokenStatus
from awa.runtime.workflow_engine import EngineStatus, WorkflowEngine
from awa.runtime.shadow import ShadowRunner
from awa.types import ActorType, Workflow
from awa.validator import validate_workflow_integrity

RuntimeState = dict[str, Any]
_SETTLED = ("completed", "failed", "cancelled")


def _jsonable(value: Any) -> Any:
    """A deep copy that is plain JSON"""
    return json.loads(json.dumps(value, default=str))


def _key_text(value: Any) -> str:
    """A subject key as text: the same text whichever way the number was written"""
    if isinstance(value, bool):
        return "true" if value else "false"
    if isinstance(value, float) and value.is_integer():
        return str(int(value))
    return str(value)


# ---------------------------------------------------------------------------
# Stores
# ---------------------------------------------------------------------------

class RuntimeStore(Protocol):
    """Where a host keeps everything it must know to carry on after a restart"""

    def save(self, state: RuntimeState) -> None: ...

    def load(self) -> RuntimeState | None: ...


class InMemoryRuntimeStore:
    def __init__(self) -> None:
        self._state: str | None = None

    def save(self, state: RuntimeState) -> None:
        # Serialised at once: what was saved must not change when the host goes on
        self._state = json.dumps(state, default=str)

    def load(self) -> RuntimeState | None:
        return json.loads(self._state) if self._state else None


class FileRuntimeStore:
    """Keeps the runtime's state in one JSON file, replaced atomically on every save"""

    def __init__(self, file: str) -> None:
        self.file = str(file)

    def save(self, state: RuntimeState) -> None:
        os.makedirs(os.path.dirname(self.file) or ".", exist_ok=True)
        temporary = f"{self.file}.{os.getpid()}.tmp"
        with open(temporary, "w", encoding="utf-8") as handle:
            json.dump(state, handle, default=str)
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temporary, self.file)

    def load(self) -> RuntimeState | None:
        try:
            with open(self.file, encoding="utf-8") as handle:
                return json.load(handle)
        except FileNotFoundError:
            return None


# ---------------------------------------------------------------------------
# Simulation
# ---------------------------------------------------------------------------

class _ScriptedActor:
    def __init__(self, outputs: dict[str, Any]) -> None:
        self.outputs = outputs

    def execute(self, activity: Any, token: Any) -> dict[str, Any]:
        return _jsonable(self.outputs.get(activity.name) or {})


def simulated_actors(outputs: dict[str, Any] | None = None) -> dict[ActorType, Any]:
    """
    Actors for the engine's `actors` option that call no model, tool or person:
    each activity returns what `outputs` gives under its name, or an empty object.
    """
    actor = _ScriptedActor(outputs or {})
    return {actor_type: actor for actor_type in ActorType}


# ---------------------------------------------------------------------------
# The host
# ---------------------------------------------------------------------------

class AwaRuntime:
    """
    One host for workflows and journeys.

      engine: options given to every run the host starts (see WorkflowEngine)
      now:    callable returning the current time in milliseconds; tests replace it to move time forward
      store:  where the host keeps what it knows (19.10). Without it, everything is in memory.
      shadow: options of a candidate run beside production and compared as runs end (33.5; see ShadowRunner)
      telemetry: where the spans of journeys and of the runs they start go (26): an exporter, or
              {"endpoint", "headers", "protocol", "payloads"}
      shared: a store that several hosts use at once (29), instead of `store`. Each operation then works on
              what it holds of the store, and keeps it there.
      pinned_versions: workflow id -> the version new runs of it start on, instead of the newest registered (25.1)
    """

    def __init__(self, engine: dict[str, Any] | None = None, now: Callable[[], float] | None = None,
                 store: RuntimeStore | None = None, shadow: dict[str, Any] | None = None,
                 telemetry: Any = None, shared: Any = None, pinned_versions: dict[str, str] | None = None) -> None:
        self._engine_defaults = dict(engine or {})
        # Where the spans of journeys and of their runs go (specification 26); runs take it unless engine says otherwise
        resolved = resolve_telemetry(telemetry)
        self._journey_telemetry = JourneyTelemetry(resolved[0], resolved[1]) if resolved else None
        if resolved and "telemetry" not in self._engine_defaults:
            self._engine_defaults["telemetry"] = {"exporter": resolved[0], "payloads": resolved[1]}
        self._clock = now
        self._store = store
        # workflow id -> its newest registered version: what new runs start on (25.1)
        self._workflows: dict[str, Workflow] = {}
        # workflow id -> version -> the workflow: every version registered, for the runs that started on it
        self._versions: dict[str, dict[str, Workflow]] = {}
        self._pinned_versions = dict(pinned_versions or {})
        # "<id>@<version>" -> the document as registered
        self._workflow_documents: dict[str, dict[str, Any]] = {}
        self._journeys: dict[str, JourneyDefinition] = {}
        self._instances: dict[str, JourneyInstance] = {}
        self._runs: dict[str, WorkflowEngine] = {}
        # In the order the runs were started. Runs started while it is walked are reached too.
        self._run_order: list[str] = []
        # run id -> journey instance id
        self._run_journey: dict[str, str] = {}
        self._seen_events: dict[str, None] = {}
        # run id -> events the run published, accepted when the run next settles
        self._outbox: dict[str, list[BusinessEvent]] = {}
        # journey id -> the business event types that concern it
        self._concerns: dict[str, set[str]] = {}
        self._depth = 0
        self._release: Callable[[], None] | None = None
        # The shadow of production, when the host was given one (33.5)
        self.shadow: ShadowRunner | None = ShadowRunner(shadow, self._now) if shadow else None
        # On a shared store: the operation under way, its journal, and one operation of this host at a time (29)
        self._shared = shared
        self._operation: SharedOperation | None = None
        self._operation_guard = threading.RLock()
        self._shared_journal = SharedJournal(shared, lambda: self._operation) if shared is not None else None

    # -- time ---------------------------------------------------------------

    def _now(self) -> int:
        if self._clock:
            return math.floor(self._clock())
        import time
        return math.floor(time.time() * 1000)

    def _time(self) -> str:
        return time_text(self._now())

    # -- definitions --------------------------------------------------------

    def register_workflow(self, workflow: Workflow | dict[str, Any]) -> "AwaRuntime":
        """
        Register a workflow, given as a model or as its document. Several versions of one workflow may
        be registered: runs keep the version they started on, and new runs start on the newest (25.1).
        """
        if isinstance(workflow, dict):
            document = workflow["workflow"] if "workflow" in workflow and "activities" not in workflow else workflow
            model = Workflow.model_validate(document)
            self._workflow_documents[f"{model.id}@{model.version}"] = _jsonable(document)
            workflow = model
        else:
            self._workflow_documents.pop(f"{workflow.id}@{workflow.version}", None)
        self._versions.setdefault(str(workflow.id), {})[workflow.version] = workflow
        newest = self._workflows.get(str(workflow.id))
        if newest is None or semver_key(workflow.version) >= semver_key(newest.version):
            self._workflows[str(workflow.id)] = workflow
        return self

    def workflow_versions(self, workflow_id: str) -> list[str]:
        """The versions of a workflow registered on this host, oldest first"""
        return sorted(self._versions.get(str(workflow_id), {}), key=semver_key)

    def get_workflow(self, workflow_id: str, version: str | None = None) -> Workflow | None:
        """A registered workflow: the version named, or the newest"""
        if version:
            return self._versions.get(str(workflow_id), {}).get(version)
        return self._workflows.get(str(workflow_id))

    def _workflow_of(self, workflow_id: str, version: str | None) -> Workflow | None:
        """The version a run needs: the one it started on, or the newest for a state that does not say"""
        return self.get_workflow(workflow_id, version)

    def _starting_version(self, workflow_id: str, version: str | None = None) -> Workflow:
        """The version new runs of a workflow start on: the newest registered, unless the host pins another (25.1)"""
        wanted = version or self._pinned_versions.get(str(workflow_id))
        workflow = self.get_workflow(str(workflow_id), wanted)
        if workflow is None:
            if wanted and str(workflow_id) in self._workflows:
                raise KeyError(f"Workflow {workflow_id} has no registered version {wanted}")
            raise KeyError(f"Workflow {workflow_id} is not registered")
        return workflow

    def register_journey(self, definition: JourneyDefinition | dict[str, Any]) -> "AwaRuntime":
        """Register a journey. The workflows it names must be registered first."""
        if isinstance(definition, dict):
            definition = parse_journey(definition)
        errors = validate_journey(definition, set(self._workflows), strict=True)
        if errors:
            raise ValueError(f'Invalid journey "{definition.name}": ' + "; ".join(e["message"] for e in errors))
        self._journeys[definition.id] = definition
        # An event concerns a journey that names it, or whose workflows have an event node of that name (19.5)
        types = {t.event for t in definition.triggers} | {e.event for e in definition.exits}
        types |= {t.on.event for t in definition.touchpoints if t.on.event}
        types |= {r.event for r in (definition.sentiment.rules if definition.sentiment else []) if r.event}
        workflow_ids = [w for s in definition.stages for w in [*s.workflows, *([s.on_enter.start_workflow] if s.on_enter else [])]]
        workflow_ids += [t.start_workflow for t in definition.triggers if t.start_workflow]
        # The workflows they call are the journey's too (24.7)
        workflow_ids += [str(w.id) for w in called_workflows(workflow_ids, self._workflows)]
        for workflow_id in workflow_ids:
            workflow = self._workflows.get(workflow_id)
            for event in (workflow.events if workflow else []):
                name = (event.event_definition or {}).get("name")
                if name:
                    types.add(name)
        self._concerns[definition.id] = types
        return self

    # -- reading ------------------------------------------------------------

    def get_run(self, run_id: str) -> WorkflowEngine | None:
        return self._runs.get(run_id)

    def list_runs(self) -> list[WorkflowEngine]:
        return list(self._runs.values())

    def list_workflows(self) -> list[Workflow]:
        return list(self._workflows.values())

    def list_journeys(self) -> list[JourneyDefinition]:
        return list(self._journeys.values())

    def get_journey_instance(self, id: str) -> JourneyInstance | None:
        return self._instances.get(id)

    def list_journey_instances(self, journey_id: str | None = None) -> list[JourneyInstance]:
        return [i for i in self._instances.values() if not journey_id or i["journey_id"] == journey_id]

    def find_journey_instance(self, journey_id: str, subject_key: str) -> JourneyInstance | None:
        """The active instance of a journey for a subject"""
        return next((i for i in self.list_journey_instances(journey_id)
                     if i["subject_key"] == subject_key and i["status"] == "active"), None)

    def analytics(self, journey_id: str) -> dict[str, Any]:
        definition = self._journeys.get(journey_id)
        if not definition:
            raise KeyError(f"Journey {journey_id} is not registered")
        return journey_analytics(definition, self.list_journey_instances(journey_id))

    def transitions(self) -> list[dict[str, Any]]:
        """How subjects move from one journey to the next, across every journey registered"""
        return journey_transitions(list(self._instances.values()))

    # -- saving and recovering (19.10) ---------------------------------------

    def _op(self, work: Callable[[], Any]) -> Any:
        """One operation of the host. When the outermost one ends, what the host knows is saved."""
        if self._shared is not None:
            return self._shared_op(work)
        self._depth += 1
        try:
            return work()
        finally:
            self._depth -= 1
            if self._depth == 0:
                self.save()

    def save(self) -> None:
        """Write the host's state to its store. Called after every operation; a host may also call it."""
        # Journals first: a state that names a journal position must never be ahead of the journal.
        # The stores of this SDK write each event as it is recorded; one that buffers offers flush().
        for store in {id(e._journal_store): e._journal_store for e in self._runs.values()}.values():
            flush = getattr(store, "flush", None)
            if callable(flush):
                flush()
        if self._journey_telemetry:
            self._journey_telemetry.observe(self._instances.values())
        if not self._store:
            return
        self._store.save({
            "version": "1", "saved_at": self._time(),
            "instances": list(self._instances.values()),
            "runs": [{
                "run_id": engine.run_id, "workflow_id": str(engine.workflow.id),
                **({"journey_instance_id": self._run_journey[engine.run_id]} if engine.run_id in self._run_journey else {}),
                "state": engine.snapshot(),
            } for engine in self._runs.values()],
            "seen_events": list(self._seen_events),
            "outbox": self._outbox,
        })

    def recover(self) -> dict[str, Any]:
        """
        Take up where a previous process left off. Call after the workflows and
        journeys are registered. Runs that were in the middle of an activity
        execute it again, so activities are executed at least once (10.3).
        Raises, and changes nothing, when a run or a journey on record cannot be continued.
        """
        if self._shared is not None:
            return self._check_shared_store()
        state = self._store.load() if self._store else None
        if not state:
            return {"instances": 0, "runs": 0, "continued": []}

        # Everything is rebuilt aside first. A recovery that cannot complete raises here, before
        # anything is taken over or saved: the state on record stays exactly as it was.
        saved_runs = state.get("runs") or []
        # Each run on the version it started on, or was moved to (25.1)
        def needs(r: dict[str, Any]) -> str:
            version = (r.get("state") or {}).get("workflow_version")
            return f"run {r['run_id']} needs workflow {r['workflow_id']}" + (f" version {version}" if version else "")
        problems = [needs(r) for r in saved_runs
                    if self._workflow_of(r["workflow_id"], (r.get("state") or {}).get("workflow_version")) is None]
        problems += [f"journey instance {i['id']} needs journey {i['journey_id']}"
                     for i in state.get("instances") or [] if i["journey_id"] not in self._journeys]
        if problems:
            raise RuntimeError(f"Cannot recover: {'; '.join(problems)}, which is not registered. Nothing was changed.")
        instances = {i["id"]: i for i in state.get("instances") or []}
        outbox = {run_id: list(events) for run_id, events in (state.get("outbox") or {}).items()}
        engines = [(saved, WorkflowEngine.restore(
            self._workflow_of(saved["workflow_id"], saved["state"].get("workflow_version")), saved["state"],
            self._engine_options(saved["run_id"])))
            for saved in saved_runs]

        def take_over() -> dict[str, Any]:
            self._instances = instances
            if self._journey_telemetry:
                self._journey_telemetry.prime(instances.values())
            self._outbox = outbox
            self._seen_events = dict.fromkeys(state.get("seen_events") or [])
            continued: list[str] = []
            for saved, engine in engines:
                self._runs[saved["run_id"]] = engine
                self._run_order.append(saved["run_id"])
                instance = self._instances.get(saved.get("journey_instance_id") or "")
                if instance:
                    self._run_journey[saved["run_id"]] = instance["id"]
                    self._watch(engine, self._journeys[instance["journey_id"]], instance, saved["run_id"])
            for saved, engine in engines:
                if engine.status == EngineStatus.RUNNING:
                    continued.append(saved["run_id"])
                    engine.run()
                self._sync(engine)
            return {"instances": len(self._instances), "runs": len(self._runs), "continued": continued}

        return self._op(take_over)

    def close(self) -> None:
        """Release whatever the host holds outside the process, such as the lock on its directory. Safe to call more than once."""
        release, self._release = self._release, None
        if release:
            release()

    def __enter__(self) -> "AwaRuntime":
        return self

    def __exit__(self, *exc: Any) -> None:
        self.close()

    # -- runs ---------------------------------------------------------------

    def _engine_options(self, run_id: str) -> dict[str, Any]:
        outer_sink = self._engine_defaults.get("event_sink")

        def sink(event: BusinessEvent) -> None:
            # Kept until the run settles, then accepted like any other event (19.5)
            self._outbox.setdefault(run_id, []).append(event)
            if outer_sink:
                outer_sink(event)

        options = {**self._engine_defaults, "run_id": run_id, "event_sink": sink,
                   # Call activities run the workflows registered here (24.1); a shared store keeps each child run (24.8)
                   "subworkflows": {"workflows": self._workflows, **({"record_settled": True} if self._shared is not None else {}),
                                    **(self._engine_defaults.get("subworkflows") or {})}}
        if self._shared_journal is not None:
            options["journal"] = self._shared_journal
        if self._clock:
            options["now"] = self._clock
        return options

    def _watch(self, engine: WorkflowEngine, definition: JourneyDefinition, instance: JourneyInstance, run_id: str) -> None:
        """What a run does towards the outside world shows on its journey as touchpoints (19.8)"""
        if not definition.touchpoints:
            return

        def listener(event: dict[str, Any]) -> None:
            data = event.get("data") or {}
            if event["type"] == "activity.completed":
                output = data.get("output")
                inner = output.get("output") if isinstance(output, dict) else None
                occasion: dict[str, Any] = {"activity": event.get("node_name"), "data": inner if isinstance(inner, dict) and inner else output}
            elif event["type"] == "tool.completed":
                occasion = {"tool": data.get("tool"), "data": data.get("result"), "link": data.get("link")}
            elif event["type"] == "event.published":
                occasion = {"event": data.get("name"), "data": data.get("data"), "event_id": data.get("event_id")}
            else:
                return
            found = touchpoints_for(definition, event=occasion.get("event"), activity=occasion.get("activity"), tool=occasion.get("tool"))
            for touchpoint in found:
                if occasion.get("event") and touchpoint.direction != "outbound":
                    continue
                record_touchpoint(definition, instance, touchpoint, event["time"], data=occasion.get("data"), run_id=event.get("run_id") or run_id,
                                  event_id=occasion.get("event_id"), link=occasion.get("link"))

        engine.on_event(listener)

    def start(self, workflow_id: str, input: dict[str, Any] | None = None, *, instance: JourneyInstance | None = None,
              caused_by_event: str | None = None, principal: dict[str, Any] | None = None,
              version: str | None = None) -> WorkflowEngine:
        """
        Start a run. With a journey instance, the run belongs to that journey. It starts on the newest
        version of the workflow, or on `version`, or the one the host pins, and keeps it (25.1).
        `principal` is who starts it (specification 30.1); without one, the host does. Under a policy
        that refuses it, an AuthorizationError is raised and no run exists.
        """
        def work() -> WorkflowEngine:
            workflow = self._starting_version(str(workflow_id), version)
            run_id = str(uuid4())
            engine = WorkflowEngine(workflow, options={**self._engine_options(run_id), **({"principal": principal} if principal else {})})
            # A start the policy refuses leaves no run behind (30.4)
            engine.authorize_start(_jsonable(input or {}))
            self._runs[run_id] = engine
            self._run_order.append(run_id)

            if instance is not None:
                definition = self._journeys[instance["journey_id"]]
                stage = next((s for s in definition.stages if str(workflow_id) in s.workflows
                              or (s.on_enter and s.on_enter.start_workflow == str(workflow_id))), None)
                ref = {
                    "run_id": run_id, "workflow_id": str(workflow_id), "workflow_name": workflow.name,
                    "stage_id": stage.id if stage else instance["stage_id"], "status": "running", "started_at": self._time(),
                    # The business event that started the run, if one did
                    **({"caused_by_event": caused_by_event} if caused_by_event else {}),
                }
                instance["runs"].append(ref)
                self._run_journey[run_id] = instance["id"]
                record_journey_event(instance, "journey.run_started", ref["started_at"], {
                    "workflow_id": str(workflow_id), "workflow_name": workflow.name, "caused_by_event": caused_by_event or None,
                }, run_id=run_id, stage_id=ref["stage_id"])
                self._watch(engine, definition, instance, run_id)

            engine.run(_jsonable(input or {}))
            self._sync(engine)
            return engine

        return self._op(work)

    def _sync(self, engine: WorkflowEngine) -> None:
        """After a run has made progress: if it ended, fold its result into its journey and move the journey on"""
        if self.shadow:
            self.shadow.settled(engine)
        def flush() -> None:
            # What the run announced is accepted now that it has settled: after its own ending is
            # recorded, before anything follows from it (19.5)
            for event in self._outbox.pop(engine.run_id, []):
                self.publish(event)

        instance = self._instances.get(self._run_journey.get(engine.run_id) or "")
        if not instance:
            return flush()
        ref = next(r for r in instance["runs"] if r["run_id"] == engine.run_id)
        status = engine.status.value
        # The runs it called belong to the journey too, and end before it does (24.7)
        record_child_runs(engine, instance, ref, self._time(), record_journey_event)
        if ref["status"] == status:
            return flush()
        ref["status"] = status
        if status not in _SETTLED:
            return flush()

        definition = self._journeys[instance["journey_id"]]
        time = self._time()
        ref["ended_at"] = time
        if status == "completed":
            # What the run established becomes part of what the journey knows
            for token in engine.tokens:
                if token.status != TokenStatus.COMPLETED:
                    continue
                facts = {k: v for k, v in public_payload(token.context_data).items() if k != "decisions"}
                kept = {k: facts[k] for k in definition.collect if k in facts} if definition.collect is not None else facts
                instance["data"] = {**instance["data"], **_jsonable(kept)}
        failed = next((t for t in engine.tokens if t.status == TokenStatus.FAILED), None)
        record_journey_event(instance, "journey.run_ended", time, {
            "workflow_name": ref["workflow_name"], "status": status,
            "error": failed.get_data("_error") if status == "failed" and failed else None,
        }, run_id=ref["run_id"], stage_id=ref["stage_id"])
        # A failed run leaves the subject where they were, with nobody working for them (19.5)
        if status == "failed" and instance["status"] == "active" and not instance["stalled"]:
            instance["stalled"] = True
            stage = definition.stage(instance["stage_id"])
            record_journey_event(instance, "journey.stalled", time, {
                "stage_name": stage.name if stage else None, "reason": f"the {ref['workflow_name']} workflow failed",
                "owner": (stage.owner if stage else None) or None,
            }, run_id=ref["run_id"])
            apply_sentiment(definition, instance, time, "run_failed", stage=instance["stage_id"])
            apply_sentiment(definition, instance, time, "stalled", stage=instance["stage_id"])
        flush()
        self._progress(definition, instance, time)

    def _each_run(self) -> Any:
        position = 0
        while position < len(self._run_order):
            yield self._runs[self._run_order[position]]
            position += 1

    def _progress(self, definition: JourneyDefinition, instance: JourneyInstance, time: str, caused_by_event: str | None = None) -> None:
        for workflow_id in advance_journey(definition, instance, time):
            self.start(workflow_id, dict(instance["data"]), instance=instance, caused_by_event=caused_by_event)

    # -- business events (19.5) ----------------------------------------------

    def _touch(self, definition: JourneyDefinition, instance: JourneyInstance, event: BusinessEvent, time: str) -> None:
        """An event from outside is an inbound touchpoint where the journey says so, and may move the mood"""
        if str(event.get("source") or "").startswith("urn:awa:run:"):
            return  # told by the run that published it
        data = event.get("data") if isinstance(event.get("data"), dict) else {}
        for touchpoint in touchpoints_for(definition, event=event["type"]):
            if touchpoint.direction == "inbound":
                record_touchpoint(definition, instance, touchpoint, time, data=data, event_id=event["id"])
        apply_sentiment(definition, instance, time, "event", event=event["type"], data=data)

    def _receive(self, instance: JourneyInstance, definition: JourneyDefinition, event: BusinessEvent, data: dict[str, Any], time: str) -> None:
        instance["data"] = {**instance["data"], **_jsonable(public_payload(data))}
        record_journey_event(instance, "journey.event_received", time, {
            "event_id": event["id"], "name": event["type"], "source": event.get("source"), "data": _jsonable(data)})
        self._touch(definition, instance, event, time)

    def _subject_of(self, definition: JourneyDefinition, event: BusinessEvent, data: dict[str, Any]) -> str | None:
        key = resolve_path(data, definition.subject.key)
        if key is None:
            key = event.get("subject")
        return None if key is None else _key_text(key)

    def publish(self, event: BusinessEvent) -> dict[str, Any]:
        """
        Accept a business event. Safe to call again with the same event: an id
        already accepted is ignored. Returns `accepted`, and the ids of the runs
        it resumed (`resumed_runs`) and started (`started_runs`) and of the
        journey instances it concerned (`journeys`).
        """
        if not isinstance(event, dict) or not event.get("id") or not event.get("type"):
            raise ValueError("A business event needs an id and a type")
        return self._op(lambda: self._accept(event))

    def _accept(self, event: BusinessEvent) -> dict[str, Any]:
        result: dict[str, Any] = {"accepted": False, "resumed_runs": [], "started_runs": [], "journeys": []}
        event_id = str(event["id"])
        if self._operation is not None:
            # Accepted once across every host of the store, and everything it can touch held (29.3)
            if not self._operation.accept(event):
                return result
        else:
            if event_id in self._seen_events:
                return result
            self._seen_events[event_id] = None
        result["accepted"] = True
        data = event.get("data") if isinstance(event.get("data"), dict) else {}
        time = self._time()

        # 1. The event becomes part of the story of every journey it concerns before anything
        #    reacts to it, so that the record reads in causal order
        recorded: set[str] = set()
        for definition in list(self._journeys.values()):
            subject_key = self._subject_of(definition, event, data)
            if subject_key is None:
                continue
            instance = self.find_journey_instance(definition.id, subject_key)
            if not instance or event["type"] not in self._concerns.get(definition.id, set()):
                continue
            self._receive(instance, definition, event, data, time)
            recorded.add(instance["id"])

        # 2. Runs waiting for this event
        for engine in self._each_run():
            if engine.deliver_event(event) > 0:
                result["resumed_runs"].append(engine.run_id)
                engine.run()
                self._sync(engine)

        # 3. Journeys the event concerns
        in_journey: set[str] = set()
        for definition in list(self._journeys.values()):
            subject_key = self._subject_of(definition, event, data)
            if subject_key is None:
                continue
            instance = self.find_journey_instance(definition.id, subject_key)
            triggers = [t for t in definition.triggers if t.event == event["type"]]
            leaving = next((e for e in definition.exits if e.event == event["type"]), None)
            # An event about a subject already on its journey is part of that journey's story,
            # whether or not a rule reacts to it
            if not triggers and not leaving and not (instance and event["type"] in self._concerns.get(definition.id, set())):
                continue

            if not instance:
                if not any(t.starts_journey for t in triggers):
                    continue
                instance = new_journey_instance(definition, str(uuid4()), subject_key, time)
                # The subject brings the mood their last journey left them in
                before = None
                if definition.sentiment and definition.sentiment.carry_over:
                    earlier = sorted((i for i in self._instances.values()
                                      if i["subject_key"] == subject_key and i.get("sentiment") is not None),
                                     key=lambda i: i["started_at"])
                    before = earlier[-1] if earlier else None
                if before and definition.sentiment:
                    instance["sentiment"] = min(definition.sentiment.max, max(definition.sentiment.min, before["sentiment"]))
                self._instances[instance["id"]] = instance
                record_journey_event(instance, "journey.started", time, {
                    "subject": definition.subject.name, "subject_key": subject_key, "journey_name": definition.name,
                    "sentiment": instance.get("sentiment"), "sentiment_carried_from": before["id"] if before else None,
                })
                enter_stage(definition, instance, definition.stages[0].id, time, "journey started")
            result["journeys"].append(instance["id"])
            if instance["id"] not in recorded:
                self._receive(instance, definition, event, data, time)

            if leaving:
                end_journey(instance, leaving.outcome, time)
                # Work still under way for a subject that has left is withdrawn, not left to time out
                for ref in list(instance["runs"]):
                    engine = self._runs.get(ref["run_id"])
                    if engine and engine.cancel(f"journey {leaving.outcome}: {leaving.reason or event['type']}"):
                        self._sync(engine)
                record_journey_event(
                    instance, "journey.completed" if leaving.outcome == "completed" else "journey.abandoned", time,
                    {"reason": leaving.reason or event["type"], "event_id": event["id"]})
                continue

            for trigger in triggers:
                if trigger.enter_stage and trigger.enter_stage != instance["stage_id"]:
                    workflow_id = enter_stage(definition, instance, trigger.enter_stage, time, f'event "{event["type"]}"')
                    if workflow_id:
                        run = self.start(workflow_id, dict(instance["data"]), instance=instance, caused_by_event=event["id"])
                        result["started_runs"].append(run.run_id)
                        in_journey.add(workflow_id)
                if trigger.start_workflow:
                    run = self.start(trigger.start_workflow, dict(instance["data"]), instance=instance, caused_by_event=event["id"])
                    result["started_runs"].append(run.run_id)
                    in_journey.add(trigger.start_workflow)
            self._progress(definition, instance, time, event["id"])

        # 4. Workflows that start on this event (18.4) and were not started as part of a journey
        for workflow in list(self._workflows.values()):
            if str(workflow.id) in in_journey:
                continue
            if not any(e.event_type == "start" and (e.event_definition or {}).get("name") == event["type"] for e in workflow.events):
                continue
            run = self.start(str(workflow.id), public_payload(data))
            result["started_runs"].append(run.run_id)

        return result

    # -- time and people ------------------------------------------------------

    def tick(self, now: float | None = None) -> dict[str, list[str]]:
        """
        Let time act: time out the event waits whose deadline has passed, compare
        the work that waits with its service levels (specification 23.2), and mark
        journeys that have stayed too long in a stage as stalled. `now` is in
        milliseconds since the epoch and defaults to the current time.
        """
        moment = self._now() if now is None else now

        def work() -> dict[str, list[str]]:
            if self._operation is not None:
                self._operation.hold_due(moment)
            timed_out_runs: list[str] = []
            for engine in self._each_run():
                # A run left in the middle of an activity is continued (10.3)
                if engine.status == EngineStatus.RUNNING:
                    engine.run()
                    self._sync(engine)
                if engine.expire_events(moment) > 0:
                    timed_out_runs.append(engine.run_id)
                    engine.run()
                    self._sync(engine)
                # Work that waits is compared with its service levels on the same schedule (23.2)
                levels = engine.check_service_levels(moment)
                if levels["failed"] > 0:
                    engine.run()
                if levels["failed"] > 0 or levels["breaches"] > 0 or levels["warnings"] > 0:
                    self._sync(engine)
            stalled_journeys = [i["id"] for i in list(self._instances.values())
                                if check_stalled(self._journeys[i["journey_id"]], i, moment)]
            return {"timed_out_runs": timed_out_runs, "stalled_journeys": stalled_journeys}

        return self._op(work)

    def resume(self, run_id: str, token_id: str, output: dict[str, Any] | None = None,
               principal: dict[str, Any] | None = None) -> bool:
        """
        A person completed a task in one of the runs, or in a child run one of them holds (24.4).
        `principal` is who (30.4); a refusal raises an AuthorizationError and the task keeps waiting.
        """
        if self._shared is None and self._holding(run_id) is None:
            return False

        def work() -> bool:
            if self._operation is not None:
                self._operation.hold_run(run_id)
            # A task of a child run is completed through the run that holds it (24.4)
            engine = self._holding(run_id)
            if not engine:
                return False
            resumed = engine.resume_token(token_id, output or {}, principal)
            engine.run()
            self._sync(engine)
            return resumed

        return self._op(work)

    # -- changing a workflow while runs are in flight (25) ----------------------

    def migrate(self, run_id: str, plan: dict[str, Any] | None = None, *, dry_run: bool = False) -> dict[str, Any]:
        """
        Move a run at rest to another registered version of its workflow (25.3): the newest, or
        `plan["to_version"]`. The plan is checked in full first; a refusal names its reasons and
        changes nothing. With `dry_run`, says what would happen and changes nothing either.
        """
        plan = dict(plan or {})

        def refused(code: str, message: str, **extra: Any) -> dict[str, Any]:
            return {"run_id": run_id, "workflow_id": plan.get("workflow_id") or "", "from_version": "", "to_version": plan.get("to_version") or "",
                    "applied": False, "dry_run": dry_run, "refusals": [{"code": code, "message": message}], "tokens": [],
                    "data_changes": [], "completed_work": [], **extra}

        def work() -> dict[str, Any]:
            if self._operation is not None:
                self._operation.hold_run(run_id)
            engine = self._runs.get(run_id)
            if engine is None:
                return refused("not_found", f"There is no run {run_id} on this host.")
            old = engine.workflow
            new = self.get_workflow(str(old.id), plan.get("to_version"))
            if new is None:
                return refused("unknown_version", f"Workflow {old.id} has no registered version {plan.get('to_version')}.",
                               workflow_id=str(old.id), from_version=old.version)
            result = plan_migration(old, new, engine.snapshot(), plan, run_id)
            state = result.pop("state", None)
            result["dry_run"] = dry_run
            if dry_run or result["refusals"] or state is None:
                return result

            # The run goes on as a run of the new version, its journal continuing with the migration itself
            moved = WorkflowEngine.restore(new, state, self._engine_options(run_id), record_resumed=False)

            def data(payload: Callable[[Any], Any]) -> dict[str, Any]:
                return {
                    "from_version": result["from_version"], "to_version": result["to_version"],
                    "nodes": plan.get("nodes") or {}, "restart": plan.get("restart") or [],
                    "tokens": [t for t in result["tokens"] if t["outcome"] != "unchanged"],
                    "data_changes": [{"token_id": c["token_id"], "path": c["path"], "change": c["change"],
                                      **({"value": payload(c["value"])} if "value" in c else {}),
                                      **({"previous": payload(c["previous"])} if "previous" in c else {})} for c in result["data_changes"]],
                    **({"completed_work": result["completed_work"]} if result["completed_work"] else {}),
                }
            moved.record_migrated(data)
            self._runs[run_id] = moved
            instance = self._instances.get(self._run_journey.get(run_id) or "")
            if instance:
                self._watch(moved, self._journeys[instance["journey_id"]], instance, run_id)
            result["applied"] = True
            # A token that gave up its wait starts afresh at once (25.3)
            if any(t["outcome"] == "restarted" for t in result["tokens"]):
                moved.run()
            self._sync(moved)
            result["status"] = moved.status.value
            return result

        return self._op(work)

    def check_migration(self, workflow_id: str, *, from_version: str | None = None, to_version: str | None = None,
                        plan: dict[str, Any] | None = None) -> dict[str, Any]:
        """
        For a workflow: how each position of each older version with live runs fares under a move to
        `to_version` (the newest by default), and which of those runs the plan (the identity mapping
        by default) could move (25.4). Changes nothing.
        """
        self.refresh()
        wanted = to_version or (plan or {}).get("to_version")
        new = self.get_workflow(str(workflow_id), wanted)
        if new is None:
            if str(workflow_id) in self._workflows:
                raise KeyError(f"Workflow {workflow_id} has no registered version {wanted}")
            raise KeyError(f"Workflow {workflow_id} is not registered")
        plan = {**(plan or {}), "to_version": new.version}
        live = [e for e in self._runs.values()
                if str(e.workflow.id) == str(workflow_id) and e.workflow.version != new.version
                and (not from_version or e.workflow.version == from_version) and e.status.value not in _SETTLED]
        versions = sorted({e.workflow.version for e in live} | ({from_version} if from_version else set()), key=semver_key)
        comparisons = []
        for version in versions:
            old = self.get_workflow(str(workflow_id), version)
            if old is None:
                raise KeyError(f"Workflow {workflow_id} has no registered version {version}")
            comparisons.append(compare_versions(old, new, plan))
        runs = []
        for engine in live:
            result = plan_migration(engine.workflow, new, engine.snapshot(), plan, engine.run_id)
            instance_id = self._run_journey.get(engine.run_id)
            runs.append({
                "run_id": engine.run_id, "version": engine.workflow.version, "status": engine.status.value,
                **({"journey_instance_id": instance_id} if instance_id else {}),
                "migratable": not result["refusals"], "refusals": result["refusals"],
                "tokens": [t for t in result["tokens"] if t["outcome"] != "unchanged" or t["wait"]],
            })
        return {"workflow_id": str(workflow_id), "to_version": new.version, "comparisons": comparisons, "runs": runs}

    def _holding(self, run_id: str) -> WorkflowEngine | None:
        """The run of this id, or the run that holds it as a child run (24.8)"""
        return self._runs.get(run_id) or next((e for e in self._runs.values() if e.has_subworkflow_run(run_id)), None)

    # -- export ---------------------------------------------------------------

    def _workflow_json(self, workflow: Workflow) -> dict[str, Any]:
        return self._workflow_documents.get(f"{workflow.id}@{workflow.version}") or workflow.model_dump(mode="json", exclude_none=True)

    def export_journey(self, instance_id: str) -> dict[str, Any]:
        """Everything about one journey, for a view or an audit: its definition, its record, and the journal of each of its runs"""
        self.refresh()
        return self._bundle(instance_id)

    def _bundle(self, instance_id: str) -> dict[str, Any]:
        instance = self._instances.get(instance_id)
        if not instance:
            raise KeyError(f"Journey instance {instance_id} not found")
        definition = self._journeys[instance["journey_id"]]
        runs = []
        for ref in instance["runs"]:
            engine = self._runs.get(ref["run_id"])
            holder = None if engine else self._holding(ref["run_id"])
            events = engine.get_events() if engine else holder.get_subworkflow_events(ref["run_id"]) if holder else []
            runs.append({"run_id": ref["run_id"], "workflow_id": ref["workflow_id"], "stage_id": ref["stage_id"], "events": events})
        workflow_ids = list(dict.fromkeys(r["workflow_id"] for r in instance["runs"]))
        return _jsonable({
            "definition": definition.to_json(), "instance": instance,
            "workflows": [self._workflow_json(self._workflows[w]) for w in workflow_ids if w in self._workflows],
            "runs": runs,
        })

    def export_portfolio(self) -> dict[str, Any]:
        """
        Every journey with everything recorded about it: what tools/visualization/journey.html
        and dashboard.html load, and what compute_measures() reads.
        """
        self.refresh()
        journeys = []
        for definition in self._journeys.values():
            instances = self.list_journey_instances(definition.id)
            journeys.append({
                "definition": definition.to_json(),
                "analytics": journey_analytics(definition, instances),
                "instances": [{"instance": i, "runs": self._bundle(i["id"])["runs"]} for i in instances],
            })
        return _jsonable({
            "as_of": self._time(),
            "workflows": [self._workflow_json(w) for w in self._workflows.values()],
            "transitions": self.transitions(),
            "journeys": journeys,
        })

    # -- a shared store (29) -------------------------------------------------

    @property
    def shared_store(self) -> Any:
        """The store this host shares with others (29), if it has one"""
        return self._shared

    def _shared_op(self, work: Callable[[], Any]) -> Any:
        """One operation as one unit of the store: the working set starts empty and holds what the operation takes"""
        with self._operation_guard:
            if self._operation is not None:
                return work()  # within the operation under way: the guard is held by this thread
            kept: list[SharedOperation] = []

            def unit_work(unit: Any) -> Any:
                self._instances, self._runs, self._run_order, self._run_journey, self._outbox = {}, {}, [], {}, {}
                self._operation = SharedOperation(unit, _SharedView(self))
                try:
                    result = work()
                    self._operation.write()
                    kept[:] = [self._operation]
                    return result
                finally:
                    self._operation = None
            result = self._shared.operation(unit_work)
            self._observe_shared(kept[0] if kept else None)
            return result

    def _observe_shared(self, operation: SharedOperation | None) -> None:
        """
        The journey spans of an operation that was kept (26.7). The events another host added
        before it were that host's to send: they are taken in without being sent.
        """
        if not self._journey_telemetry or operation is None:
            return
        loaded = operation.loaded_events()
        self._journey_telemetry.prime([{**instance, "status": "active", "events": instance["events"][:loaded.get(instance["id"], 0)]}
                                       for instance in self._instances.values()])
        self._journey_telemetry.observe(self._instances.values())

    def _adopt(self, saved: StoredRun) -> WorkflowEngine:
        """A run taken up where another operation left it. Only one left in the middle of an activity is resumed (10.3)."""
        resumed = any(t.get("status") == "active" for t in saved["state"].get("tokens") or [])
        engine = WorkflowEngine.restore(self._workflow_of(saved["workflow_id"], saved["state"].get("workflow_version")), saved["state"],
                                        self._engine_options(saved["run_id"]), record_resumed=resumed)
        self._runs[saved["run_id"]] = engine
        self._run_order.append(saved["run_id"])
        instance = self._instances.get(saved.get("journey_instance_id") or "")
        if instance:
            self._watch(engine, self._journeys[instance["journey_id"]], instance, saved["run_id"])
        return engine

    def _check_shared_store(self) -> dict[str, Any]:
        """A host refuses to start on a store that keeps work it could not continue (19.10)"""
        needed = self._shared.required_definitions()
        missing = [f"workflow {w}" for w in needed["workflows"] if w not in self._workflows]
        # Each version a run not yet settled is on (25.1)
        missing += [f"workflow {w['id']} version {w['version']}" for w in needed.get("workflow_versions") or []
                    if w["id"] in self._workflows and self._workflow_of(w["id"], w["version"]) is None]
        missing += [f"journey {j}" for j in needed["journeys"] if j not in self._journeys]
        if missing:
            raise RuntimeError(f"Cannot work on this store: what it keeps needs {', '.join(missing)}, "
                               "which this host has not registered. Nothing was changed.")
        return {"instances": needed["instances"], "runs": needed["runs"], "continued": []}

    def refresh(self) -> None:
        """
        On a shared store, load everything as last kept, for reading: list_journey_instances(),
        analytics(), transitions() and get_run() then show the whole store rather than what this
        host's last operation held. Exports do this themselves. Without a shared store it does nothing.
        """
        if self._shared is None:
            return
        with self._operation_guard:
            if self._operation is not None:
                return
            kept = self._shared.read_all()
            self._instances = {i["id"]: i for i in kept["instances"]}
            self._runs, self._run_order, self._run_journey, self._outbox = {}, [], {}, {}
            options = {**self._engine_defaults, "journal": self._shared.journal,
                       "subworkflows": {"workflows": self._workflows, **(self._engine_defaults.get("subworkflows") or {})}}
            if self._clock:
                options["now"] = self._clock
            for saved in kept["runs"]:
                workflow = self._workflow_of(saved["workflow_id"], (saved.get("state") or {}).get("workflow_version"))
                if workflow is None:
                    continue
                self._runs[saved["run_id"]] = WorkflowEngine.restore(workflow, saved["state"], options, record_resumed=False)
                self._run_order.append(saved["run_id"])
                if saved.get("journey_instance_id"):
                    self._run_journey[saved["run_id"]] = saved["journey_instance_id"]


class _SharedView:
    """What a host lends an operation on a shared store (shared_store.HostView)"""

    def __init__(self, host: AwaRuntime) -> None:
        self._host = host
        self.workflows = host._workflows
        self.journeys = host._journeys
        self.concerns = host._concerns
        self.instances = host._instances
        self.runs = host._runs
        self.run_journey = host._run_journey
        self.outbox = host._outbox

    def adopt(self, saved: StoredRun) -> WorkflowEngine:
        return self._host._adopt(saved)

    def has_workflow(self, workflow_id: str, version: str | None = None) -> bool:
        """Whether the host has registered this version of a workflow (the newest when none is named) (25.1)"""
        return self._host._workflow_of(workflow_id, version) is not None

    def all_workflows(self) -> list[Workflow]:
        """Every version of every workflow registered: their waits may all be live"""
        return [w for versions in self._host._versions.values() for w in versions.values()]

    def subject_of(self, definition: JourneyDefinition, event: BusinessEvent) -> str | None:
        data: dict[str, Any] = event["data"] if isinstance(event.get("data"), dict) else {}
        return self._host._subject_of(definition, event, data)


# ---------------------------------------------------------------------------
# A runtime directory
# ---------------------------------------------------------------------------

def is_journey_document(document: Any) -> bool:
    """A journey has stages and a subject; a workflow has activities"""
    return isinstance(document, dict) and isinstance(document.get("stages"), list) and isinstance(document.get("subject"), dict)


def _parse_workflow(document: dict[str, Any]) -> Workflow:
    inner = document["workflow"] if "workflow" in document and "activities" not in document else document
    workflow = Workflow.model_validate(inner)
    integrity = validate_workflow_integrity(workflow)
    if not integrity.valid:
        raise ValueError(f'Invalid workflow "{workflow.name}": ' + "; ".join(e.message for e in integrity.errors))
    return workflow


def add_definition(directory: str, document: dict[str, Any]) -> dict[str, str]:
    """Add a workflow or a journey to a runtime directory. Returns its `kind`, `id` and `name`."""
    journey = is_journey_document(document)
    parsed: Any = parse_journey(document) if journey else _parse_workflow(document)
    kind = "journey" if journey else "workflow"
    definitions = os.path.join(directory, "definitions")
    os.makedirs(definitions, exist_ok=True)
    # Every version of a workflow is kept beside the others, for the runs that started on it (25.1)
    name = f"journey-{parsed.id}.json" if journey else f"workflow-{parsed.id}@{parsed.version}.json"
    with open(os.path.join(definitions, name), "w", encoding="utf-8") as handle:
        handle.write(json.dumps(document, indent=2) + "\n")
    if not journey:
        # A file of the same version under the name earlier versions of this SDK gave it is replaced
        legacy = os.path.join(definitions, f"workflow-{parsed.id}.json")
        try:
            with open(legacy, encoding="utf-8") as handle:
                before = json.load(handle)
            inner = before["workflow"] if "workflow" in before and "activities" not in before else before
            if inner.get("version") == parsed.version:
                os.remove(legacy)
        except (OSError, ValueError):
            pass
    return {"kind": kind, "id": str(parsed.id), "name": parsed.name}


def open_runtime_directory(directory: str, engine: dict[str, Any] | None = None, now: Callable[[], float] | None = None,
                           store: RuntimeStore | None = None, telemetry: Any = None) -> AwaRuntime:
    """
    A runtime that lives in a directory, so that a command line, a server or a
    scheduled job can each open it, do one thing and leave it for the next:

      <dir>/definitions/*.json   workflows and journeys
      <dir>/runtime.json         journeys, runs, events already accepted
      <dir>/journals/            one journal per run
      <dir>/runtime.lock         the process that holds the directory

    The directory is held exclusively until close() is called on the runtime
    returned, which is also a context manager. Raises if another live process
    holds it, or if what was saved cannot be recovered.
    """
    directory = os.path.abspath(str(directory))
    definitions = os.path.join(directory, "definitions")
    os.makedirs(definitions, exist_ok=True)
    release = _lock_directory(directory)
    try:
        runtime = AwaRuntime(
            engine={"journal": FileJournalStore(os.path.join(directory, "journals")), **(engine or {})},
            now=now, store=store or FileRuntimeStore(os.path.join(directory, "runtime.json")), telemetry=telemetry)
        documents = []
        for name in sorted(n for n in os.listdir(definitions) if n.endswith(".json")):
            with open(os.path.join(definitions, name), encoding="utf-8") as handle:
                documents.append(json.load(handle))
        # Workflows first: a journey is checked against the workflows it names
        for document in documents:
            if not is_journey_document(document):
                _parse_workflow(document)
                runtime.register_workflow(document)
        for document in documents:
            if is_journey_document(document):
                runtime.register_journey(document)
        runtime.recover()
    except BaseException:
        release()
        raise
    runtime._release = release
    return runtime


_held: dict[str, int] = {}
_held_guard = threading.Lock()


def _process_exists(pid: int) -> bool:
    if pid <= 0:
        return False
    if sys.platform == "win32":
        return True  # cannot be asked without side effects: assume the holder is alive
    try:
        os.kill(pid, 0)
    except ProcessLookupError:
        return False
    except PermissionError:
        return True
    except OSError:
        return False
    return True


def _remove_held_locks() -> None:
    for file in list(_held):
        try:
            os.remove(file)
        except OSError:
            pass


atexit.register(_remove_held_locks)


def _lock_directory(directory: str) -> Callable[[], None]:
    """
    One host at a time on a runtime directory: two processes that each loaded the state and each
    saved it would lose one another's work. The lock is a file naming the process that holds it.
    A lock left by a process that no longer exists is taken over. Within one process the lock is
    counted, so that a program may open the directory more than once in turn.
    """
    file = os.path.join(directory, "runtime.lock")
    released = False

    def release() -> None:
        nonlocal released
        with _held_guard:
            if released:
                return
            released = True
            left = _held.get(file, 1) - 1
            if left > 0:
                _held[file] = left
                return
            _held.pop(file, None)
            try:
                os.remove(file)
            except FileNotFoundError:
                pass

    with _held_guard:
        if file in _held:
            _held[file] += 1
            return release
        for _ in range(2):
            try:
                descriptor = os.open(file, os.O_WRONLY | os.O_CREAT | os.O_EXCL)
            except FileExistsError:
                try:
                    with open(file, encoding="utf-8") as handle:
                        pid = int(handle.read().strip() or 0)
                except (OSError, ValueError):
                    pid = 0
                if _process_exists(pid):
                    raise RuntimeError(
                        f"The runtime directory {directory} is in use by process {pid}. "
                        "One host at a time: stop it, or talk to it over HTTP.") from None
                try:
                    os.remove(file)  # left behind by a process that is gone
                except FileNotFoundError:
                    pass
                continue
            with os.fdopen(descriptor, "w", encoding="utf-8") as handle:
                handle.write(str(os.getpid()))
            _held[file] = 1
            return release
    raise RuntimeError(f"Could not lock the runtime directory {directory}")
