"""
Sub-workflows (specification section 24)

An activity with `is_expandable: true` and an `expansion_workflow_id` is a call
activity: a child run of the named workflow performs it. The child run has its
own run id and journal; its `run.started` names its parent, and the parent's
journal names the child (`subworkflow.*`). From the parent's side the child is
an actor: its output is the attempt's result, held to the activity's contract
and verification; its failure is the attempt's failure, retried under the
activity's retry policy with a new child run each time. A child that waits
leaves the parent's token waiting, and everything the host does to the parent
(events, people's tasks, time, cancellation) reaches the child. The parent's
state holds the state of the children it waits on, so the two are saved and
restored together.

This module holds that logic; the engine calls it from a few places. It
follows the TypeScript reference (sdk/typescript/src/runtime/subworkflow.ts)
and writes the same state, so that hosts of both SDKs can share a store.
"""

from __future__ import annotations

import copy
from typing import TYPE_CHECKING, Any, Callable, Iterable
from uuid import uuid4

from awa.runtime.expression import resolve_path
from awa.runtime.journal import public_payload

if TYPE_CHECKING:  # pragma: no cover
    from awa.runtime.workflow_engine import WorkflowEngine
    from awa.types import Activity, Workflow

# How deep child runs may nest unless the deployment says otherwise (24.1)
DEFAULT_SUBWORKFLOW_DEPTH = 8

SUBWORKFLOW_NOT_FOUND = "SUBWORKFLOW_NOT_FOUND"
SUBWORKFLOW_DEPTH_EXCEEDED = "SUBWORKFLOW_DEPTH_EXCEEDED"
SUBWORKFLOW_FAILED = "SUBWORKFLOW_FAILED"

_WAITING = ("waiting_human", "waiting_event")
_SETTLED = ("completed", "failed", "cancelled")
_ABSENT = object()


class SubworkflowError(Exception):
    """An attempt of a call activity that fails, with its error code"""

    def __init__(self, message: str, code: str):
        super().__init__(message)
        self.code = code


def is_call_activity(activity: "Activity") -> bool:
    """Whether an activity is performed by a child run (24.1)"""
    return activity.is_expandable is True and bool(activity.expansion_workflow_id)


def _mapped(mapping: dict[str, str], source: dict[str, Any]) -> dict[str, Any]:
    """The properties a mapping names, each read at its path; a path that leads nowhere gives nothing (24.1)"""
    out: dict[str, Any] = {}
    for prop, path in mapping.items():
        value = resolve_path(source, path, _ABSENT)
        if value is not _ABSENT:
            out[prop] = copy.deepcopy(value)
    return out


def _business(data: dict[str, Any]) -> dict[str, Any]:
    """A run's business data: without engine properties and without the records of activities and decisions (28.8)"""
    rest = copy.deepcopy(public_payload(data))
    rest.pop("decisions", None)
    return rest


def run_output(engine: "WorkflowEngine") -> dict[str, Any]:
    """The output of a run that completed: the data of its completed tokens, merged in the order they were created (24.3)"""
    output: dict[str, Any] = {}
    for token in engine.tokens:
        if token.status.value == "completed":
            output.update(_business(token.context_data))
    return output


def called_workflows(ids: Iterable[str], registry: dict[str, "Workflow"]) -> list["Workflow"]:
    """The workflows a set of workflows calls, directly or not, among those registered"""
    found: dict[str, "Workflow"] = {}

    def visit(workflow_id: str) -> None:
        workflow = registry.get(str(workflow_id))
        if workflow is None:
            return
        for activity in workflow.activities:
            target = str(activity.expansion_workflow_id) if is_call_activity(activity) else None
            if not target or target in found or target not in registry:
                continue
            found[target] = registry[target]
            visit(target)

    for workflow_id in ids:
        visit(str(workflow_id))
    return list(found.values())


def nested_states(state: dict[str, Any]) -> list[dict[str, Any]]:
    """The states of a run's children at every depth, as a state holds them"""
    out: list[dict[str, Any]] = []
    for live in ((state.get("metadata") or {}).get("subworkflows") or {}).get("live") or []:
        out.append(live["state"])
        out.extend(nested_states(live["state"]))
    return out


def is_child_state(state: dict[str, Any]) -> bool:
    """Whether a state is that of a child run, which is taken up only with its parent (24.8)"""
    return bool(((state.get("metadata") or {}).get("subworkflows") or {}).get("parent"))


class _CallActor:
    """Performs a call activity by a child run"""

    def __init__(self, calls: "SubworkflowCalls"):
        self.calls = calls
        # The outcome of a child that waited, for the first attempt after it (24.4)
        self.continuation: dict[str, Any] | None = None

    def execute(self, activity: "Activity", token: Any, context: Any = None) -> dict[str, Any]:
        return self.calls.perform(activity, token, context, self.continuation)


class SubworkflowCalls:
    """The child runs of one engine: those it waits on, and the record of every child it started, with their own children's."""

    def __init__(self, engine: "WorkflowEngine"):
        self.engine = engine
        options = engine.options.get("subworkflows") or {}
        self.depth: int = int(options.get("depth") or 0)
        self.parent: dict[str, Any] | None = options.get("parent")
        workflows = options.get("workflows") or []
        if isinstance(workflows, dict):
            workflows = list(workflows.values())
        self.registry: dict[str, "Workflow"] = {str(w.id): w for w in workflows}
        self.runs: list[dict[str, Any]] = []
        self.live: dict[str, "WorkflowEngine"] = {}
        self.listeners: list[Callable[[dict[str, Any]], None]] = []
        self.settled: list[dict[str, Any]] = []

    @property
    def _options(self) -> dict[str, Any]:
        return self.engine.options.get("subworkflows") or {}

    @property
    def max_depth(self) -> int:
        value = self._options.get("max_depth")
        return DEFAULT_SUBWORKFLOW_DEPTH if value is None else int(value)

    def started_data(self) -> dict[str, Any]:
        """What a child run's `run.started` adds (24.2)"""
        return {"depth": self.depth, "parent": copy.deepcopy(self.parent)} if self.parent else {}

    def actor(self, activity: "Activity") -> Any:
        """The actor of a call activity; None for any other activity"""
        if not is_call_activity(activity):
            return None
        return self._options.get("actor") or _CallActor(self)

    # ------------------------------------------------------------------ performing a call

    def perform(self, activity: "Activity", token: Any, context: Any, continuation: dict[str, Any] | None) -> dict[str, Any]:
        # The attempt after a child that waited takes that child's outcome; any later attempt starts a new child (24.4)
        if continuation and continuation.get("run_id") in self.live:
            return self._conclude(continuation["run_id"], activity, context)

        workflow = self.registry.get(str(activity.expansion_workflow_id))
        if workflow is None:
            raise SubworkflowError(
                f'Activity "{activity.name}" calls workflow {activity.expansion_workflow_id}, which is not registered with this engine',
                SUBWORKFLOW_NOT_FOUND)
        if self.depth + 1 > self.max_depth:
            raise SubworkflowError(
                f'Activity "{activity.name}" would start a run of "{workflow.name}" at depth {self.depth + 1}, '
                f"beyond the limit of {self.max_depth}", SUBWORKFLOW_DEPTH_EXCEEDED)

        data = token.context_data
        mapping = activity.subworkflow.input if activity.subworkflow is not None else None
        child_input = (_mapped(mapping, {k: v for k, v in data.items() if not str(k).startswith("_")})
                       if mapping else _business(data))
        run_id = str(uuid4())
        attempt_seq = getattr(context, "attempt_seq", None)
        parent = {
            "run_id": self.engine.run_id, "workflow_id": str(self.engine.workflow.id), "node_id": str(activity.id),
            "token_id": token.id, "attempt": int(data.get("_attempt") or 1),
            **({"seq": attempt_seq} if attempt_seq else {}),
            "root_run_id": (self.parent or {}).get("root_run_id") or self.engine.run_id,
        }
        payload = getattr(context, "payload", None) or (lambda value: value)
        record = getattr(context, "record", None) or (lambda type, data: None)
        record("subworkflow.started", {
            "run_id": run_id, "workflow_id": str(workflow.id), "workflow_name": workflow.name,
            "workflow_version": workflow.version, "depth": self.depth + 1, "input": payload(child_input),
        })
        child = type(self.engine)(workflow, options=self._child_options(run_id, parent, self.depth + 1))
        self._adopt(child)
        self.runs.append({
            "run_id": run_id, "parent_run_id": parent["run_id"], "workflow_id": str(workflow.id), "workflow_name": workflow.name,
            "node_id": str(activity.id), "token_id": parent["token_id"], "attempt": parent["attempt"], "depth": self.depth + 1,
            "status": "running", "started_at": self.engine._iso(),
        })
        child.run(child_input)
        return self._conclude(run_id, activity, context)

    def _conclude(self, run_id: str, activity: "Activity", context: Any) -> dict[str, Any]:
        """The attempt's result from a child run as it stands: waiting, completed or failed (24.3, 24.4)"""
        child = self.live[run_id]
        workflow = child.workflow
        status = child.status.value
        payload = getattr(context, "payload", None) or (lambda value: value)
        record = getattr(context, "record", None) or (lambda type, data: None)
        if status in _WAITING:
            self._refresh(child)
            return {"_awaiting_subworkflow": {
                "run_id": run_id, "workflow_id": str(workflow.id), "waiting_for": "human" if status == "waiting_human" else "event"}}
        # A child that neither settled nor waits (it ran out of steps) is not left behind
        if status not in _SETTLED:
            child.cancel("parent_failed")
            status = child.status.value
        self._release(run_id)
        entry = next((r for r in self.runs if r["run_id"] == run_id), None)
        if status == "completed":
            output = run_output(child)
            mapping = activity.subworkflow.output if activity.subworkflow is not None else None
            outcome = _mapped(mapping, output) if mapping else output
            started = _ms(entry["started_at"]) if entry else self.engine._now()
            ended = _ms(entry["ended_at"]) if entry and entry.get("ended_at") else self.engine._now()
            record("subworkflow.completed", {
                "run_id": run_id, "workflow_id": str(workflow.id), "duration_ms": int(ended - started), "output": payload(outcome)})
            return {"output": outcome}
        failed = next((t for t in child.tokens if t.status.value == "failed"), None)
        code = failed.get_data("_error_code") if failed else None
        default = "the run was cancelled" if status == "cancelled" else f"the run ended with status {status}"
        error = {"message": str(failed.get_data("_error") if failed and failed.get_data("_error") is not None else default),
                 **({"code": code} if isinstance(code, str) else {})}
        record("subworkflow.failed", {"run_id": run_id, "workflow_id": str(workflow.id), "error": error})
        raise SubworkflowError(f'Sub-workflow "{workflow.name}" (run {run_id}) failed: {error["message"]}', SUBWORKFLOW_FAILED)

    def _child_options(self, run_id: str, parent: dict[str, Any], depth: int) -> dict[str, Any]:
        return {
            **self.engine.options,
            "run_id": run_id,
            "journal": self.engine._journal_store,
            # A child is saved with its parent, never on its own (24.8)
            "checkpoint": None,
            "subworkflows": {**self._options, "workflows": self.registry, "parent": parent, "depth": depth},
        }

    def _adopt(self, child: "WorkflowEngine") -> None:
        for listener in self.listeners:
            child.on_event(listener)
        self.live[child.run_id] = child

    def _release(self, run_id: str) -> None:
        """The child no longer needs to be kept with the parent"""
        child = self.live.get(run_id)
        if child is None:
            return
        self._refresh(child)
        del self.live[run_id]
        if self._options.get("record_settled"):
            self.settled.append({"run_id": run_id, "workflow_id": str(child.workflow.id), "state": child.snapshot()})
            self.settled.extend(child.subworkflow_states())

    def _refresh(self, child: "WorkflowEngine") -> None:
        """Bring the record of a child, and of its own children, up to date"""
        status = child.status.value
        entry = next((r for r in self.runs if r["run_id"] == child.run_id), None)
        if entry is not None and entry["status"] != status:
            entry["status"] = status
            if status in _SETTLED:
                entry["ended_at"] = self.engine._iso()
        for descendant in child.subworkflow_runs():
            at = next((i for i, r in enumerate(self.runs) if r["run_id"] == descendant["run_id"]), None)
            if at is None:
                self.runs.append(descendant)
            else:
                self.runs[at] = descendant

    # ------------------------------------------------------------------ waiting

    def park(self, token: Any, activity: "Activity", awaiting: dict[str, Any], since: str) -> None:
        """Park the parent's token on a child that waits (24.4)"""
        token.set_data("_awaiting_subworkflow", awaiting)
        token.set_data("_waiting_since", since)
        self.engine._record("token.waiting", {
            "reason": "subworkflow", "run_id": awaiting["run_id"], "workflow_id": awaiting["workflow_id"],
            "waiting_for": awaiting["waiting_for"],
        }, token=token, node_id=str(activity.id))

    @staticmethod
    def waits_for_event(token: Any) -> bool:
        """Whether a waiting token waits on a child that waits only for business events"""
        awaiting = token.get_data("_awaiting_subworkflow")
        return isinstance(awaiting, dict) and awaiting.get("waiting_for") == "event"

    def _wake(self) -> int:
        """
        After a child made progress: a token whose child reached an outcome becomes active again,
        to take that outcome; one whose child still waits keeps waiting, for what the child now waits for.
        """
        from awa.runtime.token import TokenStatus
        woken = 0
        for token in self.engine.tokens:
            awaiting = token.get_data("_awaiting_subworkflow") if token.status == TokenStatus.WAITING else None
            child = self.live.get(awaiting["run_id"]) if isinstance(awaiting, dict) else None
            if child is None:
                continue
            self._refresh(child)
            status = child.status.value
            if status in _WAITING:
                token.set_data("_awaiting_subworkflow", {**awaiting, "waiting_for": "human" if status == "waiting_human" else "event"})
                continue
            token.context_data.pop("_awaiting_subworkflow", None)
            token.context_data.pop("_waiting_since", None)
            token.set_data("_subworkflow_continuation", {"run_id": awaiting["run_id"]})
            token.update_status(TokenStatus.ACTIVE)
            self.engine._record("token.resumed", {"reason": "subworkflow", "run_id": awaiting["run_id"], "status": status},
                                token=token, node_id=str(token.activity_id))
            woken += 1
        return woken

    def _waiting_children(self) -> list["WorkflowEngine"]:
        return [child for child in list(self.live.values()) if child.status.value in _WAITING]

    def deliver(self, event: dict[str, Any]) -> tuple[int, int]:
        """Deliver a business event to the children that wait (18.3). Returns the tokens it released and the parent tokens woken."""
        released = 0
        for child in self._waiting_children():
            n = child.deliver_event(event)
            if n > 0:
                released += n
                child.run()
        return released, (self._wake() if released else 0)

    def resume(self, token_id: str, output: dict[str, Any]) -> tuple[bool, int] | None:
        """Complete a person's task in a child run (5.6). None when no child holds the token."""
        for child in list(self.live.values()):
            if not child.owns_token(token_id):
                continue
            resumed = child.resume_token(token_id, output)
            child.run()
            return resumed, self._wake()
        return None

    def agent_requests(self) -> list[dict[str, Any]]:
        """What the agents of the children's activities ask for (28.6)"""
        return [request for child in self.live.values() for request in child.agent_requests()]

    def answer_agent(self, token_id: str, input: Any) -> tuple[bool, int] | None:
        """Give an agent of a child's activity the input it asked for (28.6). None when no child holds the token."""
        for child in list(self.live.values()):
            if not child.owns_token(token_id):
                continue
            answered = child.answer_agent(token_id, input)
            child.run()
            return answered, self._wake()
        return None

    def expire(self, now: float) -> tuple[int, int]:
        """Let the children's event waits run out (18.3)"""
        expired = 0
        for child in self._waiting_children():
            n = child.expire_events(now)
            if n > 0:
                expired += n
                child.run()
        return expired, (self._wake() if expired else 0)

    def check_service_levels(self, now: float) -> dict[str, int]:
        """Check the service levels of the work the children wait on (23.2)"""
        total = {"warnings": 0, "breaches": 0, "failed": 0, "woken": 0}
        for child in self._waiting_children():
            levels = child.check_service_levels(now)
            for key in ("warnings", "breaches", "failed"):
                total[key] += levels[key]
            if levels["failed"] > 0:
                child.run()
        if total["failed"] > 0:
            total["woken"] = self._wake()
        return total

    def deadline(self) -> float | None:
        """The earliest deadline of the children's event waits"""
        due = [d for d in (child.next_event_deadline() for child in self.live.values()) if d is not None]
        return min(due) if due else None

    def owns_token(self, token_id: str) -> bool:
        return any(child.owns_token(token_id) for child in self.live.values())

    def has_run(self, run_id: str) -> bool:
        return run_id in self.live or any(r["run_id"] == run_id for r in self.runs)

    # ------------------------------------------------------------------ cancellation

    def cancel_all(self, reason: str) -> None:
        """Cancel every child the run still keeps (24.5)"""
        for run_id in list(self.live):
            self._cancel_child(run_id, reason)

    def reap(self) -> None:
        """Cancel the children whose parent token no longer waits on them or is about to take their outcome"""
        for run_id in list(self.live):
            holder = self._holder(run_id)
            if holder is None or holder.status.value not in ("waiting", "active"):
                self._cancel_child(run_id, "parent_failed")

    def _holder(self, run_id: str) -> Any:
        for token in self.engine.tokens:
            awaiting = token.get_data("_awaiting_subworkflow")
            continued = token.get_data("_subworkflow_continuation")
            if (isinstance(awaiting, dict) and awaiting.get("run_id") == run_id) or \
                    (isinstance(continued, dict) and continued.get("run_id") == run_id):
                return token
        return None

    def _cancel_child(self, run_id: str, reason: str) -> None:
        child = self.live.get(run_id)
        if child is None:
            return
        cancelled = child.cancel(reason)
        holder = self._holder(run_id)
        if cancelled:
            entry = next((r for r in self.runs if r["run_id"] == run_id), None)
            self.engine._record(
                "subworkflow.cancelled", {"run_id": run_id, "workflow_id": str(child.workflow.id), "reason": reason},
                token=holder, node_id=str(holder.activity_id) if holder is not None else (entry["node_id"] if entry else None),
                attempt=entry["attempt"] if entry else None)
        if holder is not None:
            holder.context_data.pop("_awaiting_subworkflow", None)
            holder.context_data.pop("_subworkflow_continuation", None)
        self._release(run_id)

    # ------------------------------------------------------------------ listeners, record, state

    def subscribe(self, listener: Callable[[dict[str, Any]], None]) -> Callable[[], None]:
        self.listeners.append(listener)
        offs = [child.on_event(listener) for child in self.live.values()]

        def off() -> None:
            if listener in self.listeners:
                self.listeners.remove(listener)
            for f in offs:
                f()
        return off

    def list(self) -> list[dict[str, Any]]:
        """Every child run started by this run or its children, in the order they started (24.7)"""
        for child in list(self.live.values()):
            self._refresh(child)
        return [dict(r) for r in self.runs]

    def events(self, run_id: str) -> list[dict[str, Any]]:
        """The journal of a child run at any depth"""
        return self.engine._journal_store.read(run_id) if self.has_run(run_id) else []

    def states(self) -> list[dict[str, Any]]:
        """The states of the children kept, at any depth, and of those that settled since last asked (24.8)"""
        out, self.settled = self.settled, []
        for child in self.live.values():
            out.append({"run_id": child.run_id, "workflow_id": str(child.workflow.id), "state": child.snapshot()})
            out.extend(child.subworkflow_states())
        return out

    def snapshot(self) -> dict[str, Any] | None:
        """`metadata.subworkflows` of the run's state, when it has anything to say (24.8)"""
        live = [{"run_id": child.run_id, "workflow_id": str(child.workflow.id), "state": child.snapshot()}
                for child in self.live.values()]
        if not self.parent and not self.runs and not live:
            return None
        return {"depth": self.depth, **({"parent": self.parent} if self.parent else {}), "runs": self.list(), "live": live}

    def restore(self, saved: dict[str, Any] | None, resumed: bool) -> None:
        """Rebuild the children a saved state holds, each from its own state, under the same deployment (24.8)"""
        if not saved:
            return
        self.runs = [dict(r) for r in saved.get("runs") or []]
        for live in saved.get("live") or []:
            workflow = self.registry.get(str(live["workflow_id"]))
            if workflow is None:
                raise ValueError(
                    f"Run {self.engine.run_id} waits on child run {live['run_id']} of workflow {live['workflow_id']}, "
                    "which is not registered. Nothing was changed.")
            own = ((live["state"].get("metadata") or {}).get("subworkflows") or {})
            options = self._child_options(live["run_id"], own.get("parent"), int(own.get("depth") or self.depth + 1))
            child = type(self.engine).restore(workflow, live["state"], options, resumed)
            self._adopt(child)


def _ms(value: str) -> float:
    from awa.runtime.journey import time_ms
    return time_ms(value)


def record_child_runs(engine: "WorkflowEngine", instance: dict[str, Any], parent: dict[str, Any], time: str,
                      record: Callable[..., Any]) -> None:
    """
    A journey sees the child runs of its runs as its own (24.7): each is listed in the instance's runs with
    the run that started it, and its start and end are recorded, before the end of the run that started it.
    `record(instance, type, time, data, run_id=..., stage_id=...)` records a journey event.
    """
    for run in engine.subworkflow_runs():
        ref = next((r for r in instance["runs"] if r["run_id"] == run["run_id"]), None)
        if ref is None:
            ref = {"run_id": run["run_id"], "workflow_id": run["workflow_id"], "workflow_name": run["workflow_name"],
                   "stage_id": parent["stage_id"], "status": "running", "started_at": run["started_at"],
                   "parent_run_id": run["parent_run_id"]}
            instance["runs"].append(ref)
            record(instance, "journey.run_started", time,
                   {"workflow_id": run["workflow_id"], "workflow_name": run["workflow_name"], "parent_run_id": run["parent_run_id"]},
                   run_id=run["run_id"], stage_id=ref["stage_id"])
        if ref["status"] == run["status"] or ref["status"] in _SETTLED:
            continue
        ref["status"] = run["status"]
        if run["status"] not in _SETTLED:
            continue
        ref["ended_at"] = time
        record(instance, "journey.run_ended", time,
               {"workflow_name": run["workflow_name"], "status": run["status"], "parent_run_id": run["parent_run_id"]},
               run_id=run["run_id"], stage_id=ref["stage_id"])
