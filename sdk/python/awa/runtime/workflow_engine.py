"""
AWA Workflow Engine
Executes AWA workflow definitions: sequences, routing and decisions
(specification 5), verification (7), the execution journal (9), retry,
dead letters, checkpoints and recovery (10), outcome contracts (11),
parallel flow, events, timers and compensation (13) and business events (18).
"""

import copy
import os
import time
from datetime import datetime
from enum import Enum
from typing import Any, Callable
from uuid import uuid4

def format_iso_duration(seconds: float) -> str:
    """Format seconds as ISO 8601 duration string (PTnHnMnS)"""
    if seconds < 0:
        seconds = 0
    
    days = int(seconds // 86400)
    hours = int((seconds % 86400) // 3600)
    minutes = int((seconds % 3600) // 60)
    secs = seconds % 60
    
    result = "P"
    if days > 0:
        result += f"{days}D"
    
    result += "T"
    if hours > 0:
        result += f"{hours}H"
    if minutes > 0:
        result += f"{minutes}M"
    if secs > 0 or result == "PT":
        result += f"{secs:.1f}S"
    
    return result


from awa.types import Workflow, Activity, ActorType, DecisionNode, Edge, Event, WasteCategory
from awa.runtime.token import Token, TokenStatus
from awa.runtime.context_manager import ContextManager
from awa.runtime.actors import SoftwareAgent, AIAgent, HumanAgent, RobotAgent
from awa.runtime.decision_evaluator import DecisionEvaluator
from awa.validator import validate_workflow_integrity
from awa.runtime.expression import evaluate_expression, resolve_path
from awa.runtime.duration import parse_iso_duration
from awa.runtime.journal import (
    InMemoryJournalStore, JournalEvent, JournalListener, JournalWriter,
    format_time, hash_payload, public_payload,
)
from awa.runtime.logger import Logger
from awa.runtime.outcome_contract import check_contract, contract_feedback, outcome_of
from awa.runtime.retry import RetryConfig, RetryState, DeadLetterQueue, calculate_retry_delay
from awa.runtime.verification import VerificationEngine


class EngineStatus(str, Enum):
    """Workflow engine status (specification 5.7)"""
    IDLE = "idle"
    RUNNING = "running"
    PAUSED = "paused"
    COMPLETED = "completed"
    FAILED = "failed"
    WAITING_HUMAN = "waiting_human"
    WAITING_EVENT = "waiting_event"
    CANCELLED = "cancelled"


# Error codes that are never retried, whatever the retry policy says
NEVER_RETRIED = {"VERIFICATION_FAILED", "CONTRACT_VIOLATION", "NO_ROUTE"}

_UNFINISHED = (TokenStatus.ACTIVE, TokenStatus.WAITING, TokenStatus.JOINING)
_OUTCOMES = (EngineStatus.COMPLETED, EngineStatus.FAILED, EngineStatus.CANCELLED)
_ABSENT = object()


class ActivityError(Exception):
    """An error the engine raises itself, with an error code and data to keep on the failed token"""

    def __init__(self, message: str, code: str, details: dict[str, Any] | None = None):
        super().__init__(message)
        self.code = code
        self.details = details


def _error_info(error: BaseException) -> tuple[str, str | None]:
    code = getattr(error, "code", None)
    return str(error) or type(error).__name__, code if isinstance(code, str) else None


def _parse_time(value: str) -> float:
    """An RFC 3339 timestamp as milliseconds since the epoch"""
    return datetime.fromisoformat(value.replace("Z", "+00:00")).timestamp() * 1000


def _as_text(value: Any) -> str:
    """A value as a string, for comparing correlation values (specification 18.3)"""
    if value is _ABSENT:
        return "undefined"
    if value is None:
        return "null"
    if isinstance(value, bool):
        return "true" if value else "false"
    if isinstance(value, float) and value.is_integer():
        return str(int(value))
    return str(value)


class WorkflowEngine:
    """
    Executes AWA workflow definitions.

    Options (all optional):
      simulate, wait_for_human_tasks, pricing_config, user_id, gemini_api_key, verbose
      actors:              actor per actor type, replacing the built-in ones
      run_id:              identifier of the run; generated if absent
      journal:             where the execution journal is stored; in memory if absent
      journal_payloads:    "full" (default), "hash" or "none" (specification 9.4)
      checkpoint:          store with save(run_id, state); the run is saved there after every step
      retry:               default retry policy (RetryConfig or dict) for activities that declare none
      dead_letter_queue:   receives activities whose retries are exhausted
      verification_enabled: False switches verification off for the whole run
      verifiers:           verifier per verification mode ("ai_judge", "custom")
      event_sink:          callable that receives the business events the workflow publishes
      now:                 callable returning the current time in milliseconds
      sleep:               callable taking milliseconds; replaces the wait between retries and at timers
    """

    def __init__(
        self,
        workflow: Workflow,
        gemini_api_key: str | None = None,
        verbose: bool = False,
        options: dict[str, Any] | None = None
    ):
        self.workflow = workflow
        opts = options or {}
        self.options = opts
        self.gemini_api_key = gemini_api_key or opts.get("gemini_api_key") or os.environ.get("GEMINI_API_KEY")
        self.verbose = verbose or opts.get("verbose", False)
        self.simulate = opts.get("simulate", False)
        self.wait_for_human_tasks = opts.get("wait_for_human_tasks", True)
        self.pricing_config = opts.get("pricing_config")
        self.user_id = opts.get("user_id")

        self._context_manager = ContextManager(workflow.contexts)
        self._tokens: dict[str, Token] = {}
        self._status = EngineStatus.IDLE
        self._activities_by_id: dict[str, Activity] = {
            str(a.id): a for a in workflow.activities
        }
        self._decision_nodes_by_id: dict[str, DecisionNode] = {
            str(d.id): d for d in workflow.decision_nodes
        }
        self._events_by_id: dict[str, Event] = {str(e.id): e for e in workflow.events}
        self._edges_by_id: dict[str, Edge] = {str(e.id): e for e in workflow.edges}
        self._outgoing: dict[str, list[Edge]] = {}
        self._incoming: dict[str, list[Edge]] = {}
        for edge in workflow.edges:
            self._outgoing.setdefault(str(edge.source_id), []).append(edge)
            self._incoming.setdefault(str(edge.target_id), []).append(edge)

        # Initialize actors
        self._actors: dict[ActorType, Any] = {
            ActorType.application: SoftwareAgent(),
            ActorType.ai_agent: AIAgent(self.gemini_api_key),
            ActorType.human: HumanAgent({"simulate": self.simulate, "wait_for_completion": not self.wait_for_human_tasks}),
            ActorType.robot: RobotAgent(),
        }
        for actor_type, actor in (opts.get("actors") or {}).items():
            self._actors[ActorType(actor_type)] = actor
        self._decision_evaluator = DecisionEvaluator()
        self._verification = VerificationEngine(opts.get("verifiers"), simulate=self.simulate)

        # Journal, resilience and events
        self._now: Callable[[], float] = opts.get("now") or (lambda: time.time() * 1000)
        self._sleep: Callable[[float], None] = opts.get("sleep") or (lambda ms: time.sleep(ms / 1000))
        self._run_id = str(opts.get("run_id") or uuid4())
        self._journal_store = opts.get("journal") or InMemoryJournalStore()
        self._journal = JournalWriter(
            self._run_id, str(workflow.id), self._journal_store, opts.get("journal_payloads", "full"), 0, self._now)
        self._dead_letter_queue: DeadLetterQueue = (
            opts.get("dead_letter_queue") or DeadLetterQueue(Logger(output_func=lambda entry: None)))
        # Activities whose outcome was accepted, in order of completion. Drives compensation.
        self._completed_activities: list[dict[str, Any]] = []
        # Ids of the business events this run has consumed, so that a redelivery is ignored
        self._delivered_events: set[str] = set()
        self._stats: dict[str, Any] = {
            "started_at": self._now(), "steps": 0, "input_tokens": 0, "output_tokens": 0, "cost": 0.0,
        }

        # Validate workflow
        integrity = validate_workflow_integrity(workflow)
        if not integrity.valid:
            raise ValueError(
                "Invalid workflow definition: " + ", ".join(e.message for e in integrity.errors)
            )

    # ------------------------------------------------------------------
    # State
    # ------------------------------------------------------------------

    @property
    def status(self) -> EngineStatus:
        """Get engine status"""
        return self._status

    @property
    def tokens(self) -> list[Token]:
        """Get all tokens"""
        return list(self._tokens.values())

    @property
    def run_id(self) -> str:
        """Identifier of this run. Journal events and checkpoints are keyed by it."""
        return self._run_id

    @property
    def dead_letter_queue(self) -> DeadLetterQueue:
        return self._dead_letter_queue

    def get_events(self, after_seq: int = 0) -> list[JournalEvent]:
        """The journal of this run so far, in sequence order"""
        return self._journal_store.read(self._run_id, after_seq)

    def on_event(self, listener: JournalListener) -> Callable[[], None]:
        """Subscribe to journal events as they are recorded. Returns an unsubscribe function."""
        return self._journal.subscribe(listener)

    def result(self) -> dict[str, Any]:
        return {
            "status": self._status.value,
            "run_id": self._run_id,
            "tokens": [t.to_dict() for t in self._tokens.values()],
            "contexts": self._context_manager.get_all_data()
        }

    def _log(self, message: str) -> None:
        if self.verbose:
            print(f"[Engine] {message}")

    def _has(self, *statuses: TokenStatus) -> bool:
        return any(t.status in statuses for t in self._tokens.values())

    def _node_ref(self, node_id: str) -> dict[str, Any]:
        node = (self._activities_by_id.get(node_id) or self._decision_nodes_by_id.get(node_id)
                or self._events_by_id.get(node_id))
        return {"node_id": node_id, "node_name": node.name if node else None}

    def _record(self, type: str, data: dict[str, Any] | None = None, *, token: Token | None = None,
                token_id: str | None = None, node_id: str | None = None, attempt: int | None = None,
                level: str = "execution") -> JournalEvent:
        return self._journal.record(
            type, data, level=level, token_id=token.id if token else token_id, attempt=attempt,
            **(self._node_ref(str(node_id)) if node_id else {}))

    def _iso(self, epoch_ms: float | None = None) -> str:
        return format_time(self._now() if epoch_ms is None else epoch_ms)

    # ------------------------------------------------------------------
    # Running
    # ------------------------------------------------------------------

    def start(self, initial_data: dict[str, Any] | None = None) -> str:
        """Begin the run: create its first token at the start node. Returns the token's id."""
        if self._status != EngineStatus.IDLE:
            raise RuntimeError("The run has already started")

        start_node_id = self._find_start_node()
        if not start_node_id:
            self._status = EngineStatus.FAILED
            raise ValueError("No start activity found")

        self._stats["started_at"] = self._now()
        token = Token(
            activity_id=start_node_id,
            initial_data={
                **(initial_data or {}),
                "_workflow_id": str(self.workflow.id),
                "_workflow_name": self.workflow.name,
                "_started_at": self._iso(),
            },
            workflow_id=str(self.workflow.id)
        )
        self._tokens[token.id] = token
        self._status = EngineStatus.RUNNING

        self._record("run.started", {
            "workflow_name": self.workflow.name,
            "workflow_version": self.workflow.version,
            "input": self._journal.payload(initial_data or {}),
            "simulate": bool(self.simulate),
        })
        self._record("token.created", {}, token=token, node_id=start_node_id)
        self._log(f"Starting workflow: {self.workflow.name}")
        self._log(f"Token created: {token.id}")
        return token.id

    def run(self, initial_data: dict[str, Any] | None = None, max_steps: int = 1000) -> dict[str, Any]:
        """
        Execute the workflow until it reaches an outcome or has to wait.
        The first call starts the run with `initial_data`. A later call continues
        it, for example after deliver_event(), expire_events() or resume_token().
        """
        if self._status == EngineStatus.IDLE:
            self.start(initial_data)
        elif initial_data is not None:
            raise RuntimeError("The run has already started; initial data is only accepted by the first run()")

        try:
            steps = 0
            while self._status == EngineStatus.RUNNING and steps < max_steps:
                self.run_step()
                steps += 1
        except Exception:
            self._status = EngineStatus.FAILED
            self._finalize_execution()
            raise

        return self.result()

    def run_step(self) -> None:
        """Process every active token once, then derive the run status"""
        if self._status not in (EngineStatus.RUNNING, EngineStatus.WAITING_HUMAN, EngineStatus.WAITING_EVENT):
            return

        active_tokens = [t for t in self._tokens.values() if t.status == TokenStatus.ACTIVE]
        if not active_tokens:
            self._settle()
            return

        # Tokens on parallel branches each make one step of progress (specification 13.1)
        for token in active_tokens:
            if token.status == TokenStatus.ACTIVE:
                self._process_token(token)

        self._settle()
        self._save_checkpoint()

    def _settle(self) -> None:
        """
        Derive the run status from token states (specification 5.7).
        A run is `completed` only if every token completed. Any failed token
        makes the run `failed` once no token is still active or waiting.
        """
        # A join that can no longer be satisfied is a failure, not a wait
        if not self._has(TokenStatus.ACTIVE, TokenStatus.WAITING) and self._has(TokenStatus.JOINING):
            for token in [t for t in self._tokens.values() if t.status == TokenStatus.JOINING]:
                self._fail_token(token, ActivityError(
                    "Join can never complete: no token can still arrive on the remaining incoming edges", "JOIN_DEADLOCK"))

        # Fail fast: once a token has failed, the rest of the run is withdrawn
        if self._has(TokenStatus.FAILED):
            self._cancel_tokens("run_failed")

        if self._has(TokenStatus.ACTIVE):
            return

        previous = self._status

        if self._has(TokenStatus.WAITING):
            waiting = [t for t in self._tokens.values() if t.status == TokenStatus.WAITING]
            # Waiting on a person takes precedence in the status; otherwise the run waits on events
            on_human = any(not t.get_data("_awaiting_event") for t in waiting)
            self._status = EngineStatus.WAITING_HUMAN if on_human else EngineStatus.WAITING_EVENT
            if previous != self._status:
                self._record("run.waiting", {
                    "waiting_for": "human" if on_human else "event",
                    "waiting_tokens": [t.id for t in waiting],
                })
            return

        if previous in _OUTCOMES:
            return

        failed = self._has(TokenStatus.FAILED)
        compensation = self._compensate() if failed else None
        self._status = EngineStatus.FAILED if failed else EngineStatus.COMPLETED

        data: dict[str, Any] = {
            "duration_ms": int(self._now() - self._stats["started_at"]),
            "steps": self._stats["steps"],
            "input_tokens": self._stats["input_tokens"],
            "output_tokens": self._stats["output_tokens"],
            "cost": self._stats["cost"],
            "currency": (self.pricing_config or {}).get("currency", "USD"),
        }
        if failed:
            data["errors"] = [
                {"token_id": t.id, "node_id": str(t.activity_id), "message": t.get_data("_error")}
                for t in self._tokens.values() if t.status == TokenStatus.FAILED
            ]
            data["compensation"] = compensation
        self._record("run.failed" if failed else "run.completed", data)
        self._finalize_execution()

    def _cancel_tokens(self, reason: str) -> None:
        for token in [t for t in self._tokens.values() if t.status in _UNFINISHED]:
            token.update_status(TokenStatus.CANCELLED)
            self._record("token.cancelled", {"reason": reason}, token=token, node_id=str(token.activity_id))

    def _finalize_execution(self) -> None:
        if self._status in [EngineStatus.COMPLETED, EngineStatus.FAILED]:
            start_time = datetime.fromtimestamp(self._stats["started_at"] / 1000)
            completed_time = datetime.fromtimestamp(self._now() / 1000)
            duration_ms = int((completed_time - start_time).total_seconds() * 1000)

            currency = "USD"
            if self.pricing_config:
                currency = self.pricing_config.get("currency", "USD")

            from awa.types import WorkflowExecution
            metrics = WorkflowExecution(
                id=uuid4(),
                workflow_id=self.workflow.id,
                workflow_name=self.workflow.name,
                status=self._status.value,
                started_at=start_time,
                completed_at=completed_time,
                duration_ms=duration_ms,
                input_tokens=self._stats["input_tokens"],
                output_tokens=self._stats["output_tokens"],
                total_tokens=self._stats["input_tokens"] + self._stats["output_tokens"],
                execution_cost=self._stats["cost"],
                currency=currency,
                steps_count=self._stats["steps"],
                user_id=str(self.user_id) if self.user_id else None,
                metadata={"run_id": self._run_id}
            )

            from awa.runtime.services.task_service import ExecutionService
            ExecutionService.log_execution(metrics)

    def _find_start_node(self) -> str | None:
        """
        The node a run starts at (specification 5.3): the first start event;
        otherwise the first activity that no edge targets and that is not a
        compensation handler; otherwise the first activity.
        """
        for event in self.workflow.events:
            if event.event_type == "start":
                return str(event.id)

        handlers = {str(a.compensation.activity_id) for a in self.workflow.activities if a.compensation}
        for activity in self.workflow.activities:
            if str(activity.id) not in self._incoming and str(activity.id) not in handlers:
                return str(activity.id)

        return str(self.workflow.activities[0].id) if self.workflow.activities else None

    # ------------------------------------------------------------------
    # Checkpoints and recovery (specification 10.3)
    # ------------------------------------------------------------------

    def snapshot(self) -> dict[str, Any]:
        """The state of the run as a JSON object, sufficient to continue it in another process"""
        return copy.deepcopy({
            "version": "1.0",
            "workflow_id": str(self.workflow.id),
            "workflow_name": self.workflow.name,
            "workflow_version": self.workflow.version,
            "engine_status": self._status.value,
            "tokens": [t.to_dict() for t in self._tokens.values()],
            "contexts": self._context_manager.get_all_data(),
            "checkpoint_at": self._iso(),
            "metadata": {
                "run_id": self._run_id,
                "journal_seq": self._journal.last_seq,
                "completed_activities": self._completed_activities,
                "delivered_events": sorted(self._delivered_events),
                "stats": dict(self._stats),
            },
        })

    def _save_checkpoint(self) -> None:
        store = self.options.get("checkpoint")
        if store is not None:
            store.save(self._run_id, self.snapshot())

    @classmethod
    def restore(cls, workflow: Workflow, state: dict[str, Any], options: dict[str, Any] | None = None) -> "WorkflowEngine":
        """
        Continue a run from a checkpoint. The run keeps its run id and its
        journal continues at the next sequence number. Tokens that were active
        when the checkpoint was taken execute their current activity again, so
        activities are executed at least once.
        """
        if str(state.get("workflow_id")) != str(workflow.id):
            raise ValueError(f"Checkpoint belongs to workflow {state.get('workflow_id')}, not {workflow.id}")
        meta = state.get("metadata") or {}
        opts = dict(options or {})
        opts["run_id"] = meta.get("run_id") or opts.get("run_id")

        engine = cls(workflow, options=opts)
        # A process that stopped in the middle of an activity had already journalled events after its last
        # checkpoint. Numbering continues after the last event on record, not after the checkpoint.
        checkpoint_seq = int(meta.get("journal_seq") or 0)
        on_record = [int(e["seq"]) for e in engine._journal_store.read(engine._run_id)]
        engine._journal = JournalWriter(
            engine._run_id, str(workflow.id), engine._journal_store, opts.get("journal_payloads", "full"),
            max([checkpoint_seq, *on_record]), engine._now)
        engine._tokens = {t["id"]: Token.from_dict(copy.deepcopy(t)) for t in state.get("tokens", [])}
        for context_id, data in (state.get("contexts") or {}).items():
            engine._context_manager.merge(context_id, data)
        engine._completed_activities = copy.deepcopy(meta.get("completed_activities") or [])
        engine._delivered_events = set(meta.get("delivered_events") or [])
        engine._stats.update(meta.get("stats") or {})

        waiting = [t for t in engine._tokens.values() if t.status == TokenStatus.WAITING]
        if engine._has(TokenStatus.ACTIVE):
            engine._status = EngineStatus.RUNNING
        elif any(not t.get_data("_awaiting_event") for t in waiting):
            engine._status = EngineStatus.WAITING_HUMAN
        elif waiting:
            engine._status = EngineStatus.WAITING_EVENT
        else:
            engine._status = EngineStatus(state.get("engine_status", "idle"))

        engine._record("run.resumed", {
            "from_checkpoint_at": state.get("checkpoint_at"),
            "from_seq": int(meta.get("journal_seq") or 0),
            "active_tokens": sum(1 for t in engine._tokens.values() if t.status == TokenStatus.ACTIVE),
        })
        return engine

    # ------------------------------------------------------------------
    # Processing a token
    # ------------------------------------------------------------------

    def _process_token(self, token: Token) -> None:
        node_id = str(token.activity_id)

        decision = self._decision_nodes_by_id.get(node_id)
        if decision:
            self._process_decision(token, decision)
            return

        event = self._events_by_id.get(node_id)
        if event:
            self._process_event(token, event)
            return

        activity = self._activities_by_id.get(node_id)
        if not activity:
            self._fail_token(token, ActivityError(f"Node not found: {node_id}", "NOT_FOUND"))
            return

        self._process_activity(token, activity)

    def _process_activity(self, token: Token, activity: Activity) -> None:
        node_id = str(activity.id)
        started = self._now()
        self._log(f"Executing Activity: {activity.name}")

        try:
            actor = self._actors.get(activity.actor_type)
            if actor is None:
                self._advance_token(token, node_id)
                return

            visit = sum(1 for h in token.history if h["node_id"] == node_id and h["action"] == "entered")
            token.merge_data({
                "_token_id": token.id,
                "_run_id": self._run_id,
                "_workflow_id": str(self.workflow.id),
                "_activity_id": node_id,
                "_activity_name": activity.name,
                # Stable across retries and recovery, so actors can deduplicate side effects (10.4)
                "_idempotency_key": f"{self._run_id}:{token.id}:{node_id}:{visit}",
            })

            output, verification_records, attempts = self._execute_activity(token, actor, activity)

            ended = self._now()
            process_time = format_iso_duration((ended - started) / 1000)
            analytics: dict[str, Any] = {
                "process_time": process_time,
                "cycle_time": process_time,
                "lead_time": process_time,
                "value_added": getattr(activity.analytics, "value_added", True) if activity.analytics else True,
                "waste_categories": [WasteCategory.defects.value] if attempts > 1 else [],
            }
            if analytics["value_added"] is None:
                analytics["value_added"] = True

            # A human task that has not been completed yet parks the token
            if output.get("_requires_human_action"):
                analytics["waste_categories"].append(WasteCategory.waiting.value)
                token.merge_activity_output(node_id, output)
                token.update_status(TokenStatus.WAITING, analytics=analytics)
                token.set_data("_waiting_since", self._iso(ended))
                self._record("token.waiting", {"reason": "human_task", "human_task_id": output.get("_human_task_id")},
                             token=token, node_id=node_id)
                self._log(f"Token paused waiting for human task {output.get('_human_task_id')}")
                return

            token.merge_activity_output(node_id, {
                **output,
                "_last_actor_id": node_id,
                "_last_actor_type": activity.actor_type.value,
                **({"_verification_records": verification_records} if verification_records else {}),
            })

            duration_ms = int(ended - started)
            self._track_usage(output)
            self._stats["steps"] += 1
            self._record("activity.completed", {
                "actor_type": activity.actor_type.value,
                "output": self._journal.payload(public_payload(output)),
                "duration_ms": duration_ms,
                "attempts": attempts,
                "usage": output.get("usage"),
            }, token=token, node_id=node_id, attempt=attempts)

            self._completed_activities.append({
                "activity_id": node_id, "token_id": token.id, "output": copy.deepcopy(public_payload(output)),
            })

            self._advance_token(token, node_id, analytics)

        except Exception as error:
            analytics = {
                "process_time": format_iso_duration((self._now() - started) / 1000),
                "waste_categories": [WasteCategory.defects.value],
                "error_rate": 1.0
            }
            self._fail_token(token, error, analytics)
            self._log(f"Activity Failed: {activity.name} - {error}")

    def _track_usage(self, output: dict[str, Any]) -> None:
        usage = output.get("usage")
        if isinstance(usage, dict):
            self._stats["input_tokens"] += int(usage.get("input_tokens") or 0)
            self._stats["output_tokens"] += int(usage.get("output_tokens") or 0)

    def _retry_policy(self, activity: Activity) -> RetryConfig:
        """The retry policy that applies to an activity: its own, else the engine default, else none"""
        default = self.options.get("retry")
        if isinstance(default, RetryConfig):
            base = RetryConfig(default.max_retries, default.initial_delay_ms, default.max_delay_ms,
                               default.backoff_multiplier, default.jitter, list(default.non_retryable_errors))
        else:
            base = RetryConfig(**{"max_retries": 0, **(default or {})})
        declared = activity.retry
        if declared is None:
            return base
        if declared.max_attempts is not None:
            base.max_retries = max(0, declared.max_attempts - 1)
        if declared.initial_delay is not None:
            base.initial_delay_ms = parse_iso_duration(declared.initial_delay)
        if declared.max_delay is not None:
            base.max_delay_ms = parse_iso_duration(declared.max_delay)
        if declared.backoff_multiplier is not None:
            base.backoff_multiplier = declared.backoff_multiplier
        if declared.jitter is not None:
            base.jitter = declared.jitter
        if declared.non_retryable_errors is not None:
            base.non_retryable_errors = list(declared.non_retryable_errors)
        return base

    def _call_actor(self, actor: Any, activity: Activity, token: Token) -> dict[str, Any]:
        result = actor.execute(activity, token)
        if result is None:
            return {}
        if not isinstance(result, dict):
            raise ActivityError(
                f'Activity "{activity.name}" returned {type(result).__name__}; a result must be an object', "VALIDATION_ERROR")
        return dict(result)

    def _extract_traces(self, result: dict[str, Any], token: Token, node_id: str, attempt: int) -> dict[str, Any]:
        """Move an actor's self-reported reasoning out of its result and into the journal (9.2)"""
        reasoning = result.get("_reasoning")
        if isinstance(reasoning, dict):
            result = {key: value for key, value in result.items() if key != "_reasoning"}
            self._record("reasoning.recorded", {"source": "actor", **reasoning},
                         token=token, node_id=node_id, attempt=attempt, level="reasoning")
        return result

    def _execute_activity(self, token: Token, actor: Any, activity: Activity) -> tuple[dict[str, Any], list[dict[str, Any]], int]:
        """
        Execute an activity until an attempt is accepted or no further attempt
        is allowed. Every execution of the actor is one attempt. An attempt ends
        in one of three ways:
         - accepted: the actor returned, the outcome contract holds and verification, if any, passed
         - rejected: the contract or verification did not pass; an ai_agent is re-executed with feedback if allowed
         - errored:  the actor raised or timed out; retried with backoff if the retry policy allows
        Checks run cheapest first (specification 11.3): contract, then verification,
        then, if the contract says so, escalation to a human.
        Returns the output, the verification records and the number of attempts.
        """
        node_id = str(activity.id)
        policy = activity.verification
        verify = policy is not None and policy.enabled and self.options.get("verification_enabled") is not False
        max_verifications = policy.max_retries + 1 if verify and policy else 1
        contract = activity.outcome_contract
        budgets = contract.budgets if contract else None
        hard_cap = budgets.max_attempts if budgets and budgets.max_attempts is not None else float("inf")
        violation_cap = budgets.max_attempts if budgets and budgets.max_attempts is not None else 3
        timeout_ms = parse_iso_duration(budgets.max_duration) if budgets and budgets.max_duration else None
        max_tokens = budgets.max_tokens if budgets else None
        retry = self._retry_policy(activity)
        is_agent = activity.actor_type == ActorType.ai_agent

        def record(type: str, data: dict[str, Any], level: str = "execution") -> None:
            self._record(type, data, token=token, node_id=node_id, attempt=attempt, level=level)

        verification_records: list[dict[str, Any]] = []
        feedback: str | None = None
        feedback_attempt = 0
        attempt = 0
        errors = 0
        rejections = 0
        tokens_used = 0

        while True:
            attempt += 1
            attempt_start = self._now()

            # What the actor is given for this attempt, besides the token's data
            token.set_data("_attempt", attempt)
            if feedback is not None:
                token.merge_data({"_verification_feedback": feedback, "_verification_attempt": feedback_attempt})
            else:
                token.context_data.pop("_verification_feedback", None)
                token.context_data.pop("_verification_attempt", None)
            inputs = dict(token.context_data)

            record("activity.started", {
                "actor_type": activity.actor_type.value,
                "role_id": str(activity.role_id),
                "input": self._journal.payload(public_payload(inputs)),
                "feedback": feedback,
            })

            # --- execute -------------------------------------------------
            try:
                raw = self._call_actor(actor, activity, token)
                # The engine cannot interrupt the actor, so a result that arrives late is ignored (11.4)
                if timeout_ms is not None and self._now() - attempt_start > timeout_ms:
                    raise ActivityError(
                        f'Activity "{activity.name}" exceeded its duration budget of {timeout_ms:g} ms', "TIMEOUT")
                output = self._extract_traces(raw, token, node_id, attempt)
            except Exception as error:
                errors += 1
                message, code = _error_info(error)
                retryable = (errors <= retry.max_retries
                             and attempt < hard_cap
                             and code not in NEVER_RETRIED
                             and not (code and code in (retry.non_retryable_errors or [])))
                record("activity.failed", {
                    "error": {"message": message, "code": code}, "retryable": retryable,
                    "duration_ms": int(self._now() - attempt_start),
                })

                if not retryable:
                    if retry.max_retries > 0:
                        self._dead_letter_queue.add(
                            token, str(self.workflow.id), node_id, error,
                            RetryState(attempt, attempt_start / 1000, error))
                        record("activity.dead_lettered", {"error": {"message": message, "code": code}, "attempts": attempt})
                    raise

                delay = calculate_retry_delay(retry, errors - 1)
                record("activity.retry_scheduled", {"delay_ms": delay, "next_attempt": attempt + 1})
                record("meta.recorded", {
                    "subject": "retry",
                    "decision": f"Retry after {delay:g} ms",
                    "rationale": f'Attempt {attempt} raised "{message}"{f" ({code})" if code else ""}. '
                                 f"The error is retryable and {retry.max_retries - errors + 1} of {retry.max_retries} retries remained.",
                }, level="meta")
                if delay > 0:
                    self._sleep(delay)
                continue

            # A human task that is still pending is not an outcome yet. The token is
            # parked, and the contract is checked when the answer arrives (resume_token).
            if output.get("_requires_human_action"):
                return output, verification_records, attempt

            usage = output.get("usage") if isinstance(output.get("usage"), dict) else {}
            tokens_used += int(usage.get("input_tokens") or 0) + int(usage.get("output_tokens") or 0)
            outcome = outcome_of(output)

            # --- outcome contract (deterministic) ------------------------
            if contract:
                violations = check_contract(contract, outcome)
                if max_tokens is not None and tokens_used > max_tokens:
                    violations.append({
                        "kind": "budget", "name": "max_tokens",
                        "message": f"max_tokens: {tokens_used} tokens used, the budget is {max_tokens}",
                    })
                record("contract.checked", {
                    "passed": not violations, "violations": violations,
                    "tokens_used": tokens_used, "output_hash": hash_payload(outcome),
                })

                if violations:
                    message = "Outcome contract violated: " + "; ".join(v["message"] for v in violations)
                    over_budget = any(v["kind"] == "budget" for v in violations)
                    can_retry = not over_budget and is_agent and attempt < violation_cap
                    record("activity.failed", {
                        "error": {"message": message, "code": "CONTRACT_VIOLATION"}, "retryable": can_retry,
                        "duration_ms": int(self._now() - attempt_start),
                    })
                    if not can_retry:
                        return self._reject_outcome(
                            token, activity, output, "CONTRACT_VIOLATION", message,
                            {"_contract_violations": violations}, verification_records, attempt)
                    feedback, feedback_attempt = contract_feedback(violations), attempt + 1
                    record("meta.recorded", {
                        "subject": "contract_retry",
                        "decision": "Re-execute with the violated contract terms as feedback",
                        "rationale": f"{len(violations)} contract term(s) did not hold and "
                                     f"{violation_cap - attempt} of {violation_cap} attempts remained.",
                        "violations": [v["name"] for v in violations],
                    }, level="meta")
                    continue

            if not verify or policy is None:
                return output, verification_records, attempt

            # --- verification --------------------------------------------
            try:
                verification = self._verification.verify(activity, inputs, outcome, rejections + 1)
            except Exception as verification_error:
                # Fail closed: an output that could not be verified is not accepted
                verification = {
                    "id": str(uuid4()),
                    "activity_id": node_id,
                    "attempt": rejections + 1,
                    "verdict": "error",
                    "criteria_results": [],
                    "overall_score": 0,
                    "feedback": f"Verification engine error: {_error_info(verification_error)[0]}",
                    "verified_at": self._iso(),
                    "duration_ms": 0,
                    "output_hash": self._verification.compute_output_hash(outcome),
                }
            verification_records.append(verification)

            record("verification.completed", {
                "mode": policy.mode,
                "verdict": verification["verdict"],
                "score": verification["overall_score"],
                "pass_threshold": policy.pass_threshold,
                "criteria": verification["criteria_results"],
                "feedback": verification["feedback"],
                "output_hash": verification["output_hash"],
                "output": self._journal.payload(outcome),
            })

            if verification["verdict"] == "pass":
                self._log(f'Activity "{activity.name}" passed verification (attempt {attempt})')
                return output, verification_records, attempt

            rejections += 1
            can_retry = (verification["verdict"] == "fail"
                         and is_agent
                         and policy.retry_with_feedback
                         and rejections < max_verifications
                         and attempt < hard_cap)
            record("activity.failed", {
                "error": {
                    "message": f"Verification {verification['verdict']}: {verification['feedback'] or 'criteria not met'}",
                    "code": "VERIFICATION_FAILED",
                },
                "retryable": can_retry,
                "duration_ms": int(self._now() - attempt_start),
            })

            if not can_retry:
                return self._reject_outcome(
                    token, activity, output, "VERIFICATION_FAILED",
                    f"Verification failed: {verification['feedback'] or verification['verdict']}",
                    {}, verification_records, attempt)

            feedback = self._verification.generate_corrective_feedback(verification)
            feedback_attempt = rejections + 1
            record("meta.recorded", {
                "subject": "verification_retry",
                "decision": "Re-execute with corrective feedback",
                "rationale": f"The output scored {verification['overall_score'] * 100:.0f}% against a threshold of "
                             f"{policy.pass_threshold * 100:.0f}%. {max_verifications - rejections} verification attempt(s) remained.",
                "failed_criteria": [c["criterion_name"] for c in verification["criteria_results"] if not c["passed"]],
            }, level="meta")

    def _reject_outcome(self, token: Token, activity: Activity, rejected: dict[str, Any], code: str, message: str,
                        details: dict[str, Any], verification_records: list[dict[str, Any]],
                        attempts: int) -> tuple[dict[str, Any], list[dict[str, Any]], int]:
        """
        An outcome was rejected and no further automatic attempt is allowed.
        Either the activity fails, or, if the contract says so, a human decides (11.5).
        """
        node_id = str(activity.id)
        contract = activity.outcome_contract

        if contract is None or contract.on_violation != "escalate_human" or activity.actor_type == ActorType.human:
            raise ActivityError(message, code, {
                **rejected, **details,
                **({"_verification_records": verification_records} if verification_records else {}),
            })

        self._record("contract.escalated", {
            "code": code, "message": message,
            "rejected_output": self._journal.payload(outcome_of(rejected)), **details,
        }, token=token, node_id=node_id, attempt=attempts)
        self._record("meta.recorded", {
            "subject": "escalation",
            "decision": "Hand the activity to a human",
            "rationale": f"After {attempts} attempt(s) the outcome was still rejected ({code}) and the "
                         'contract\'s on_violation is "escalate_human".',
        }, token=token, node_id=node_id, attempt=attempts, level="meta")

        human = self._actors.get(ActorType.human)
        if human is None:
            # Fail closed: nobody to hand the activity to
            raise ActivityError(f"{message}. Escalation to a human is required, but no human actor is configured.", code, details)

        token.set_data("_escalation", {"code": code, "message": message, "rejected_outcome": outcome_of(rejected), **details})
        try:
            result = self._extract_traces(self._call_actor(human, activity, token), token, node_id, attempts)
        finally:
            token.context_data.pop("_escalation", None)

        if result.get("_requires_human_action"):
            # The token waits; the contract is checked when the person answers (resume_token)
            return {**result, "_escalated": True}, verification_records, attempts

        # A human answered at once. The deterministic terms still bind.
        violations = check_contract(contract, outcome_of(result))
        self._record("contract.checked", {
            "passed": not violations, "violations": violations, "decided_by": "human",
            "output_hash": hash_payload(outcome_of(result)),
        }, token=token, node_id=node_id, attempt=attempts)
        if violations:
            raise ActivityError(
                "Outcome contract violated by the human decision: " + "; ".join(v["message"] for v in violations),
                "CONTRACT_VIOLATION", {"_contract_violations": violations})
        return {**result, "_escalated": True}, verification_records, attempts

    def _fail_token(self, token: Token, error: BaseException, analytics: dict[str, Any] | None = None) -> None:
        """Mark a token failed and record why, in its data and in the journal"""
        message, code = _error_info(error)
        self._log(f"Token {token.id} failed: {message}")
        token.update_status(TokenStatus.FAILED, analytics=analytics)
        data: dict[str, Any] = {"_error": message}
        if code:
            data["_error_code"] = code
        if isinstance(error, ActivityError) and error.details:
            data.update(error.details)
        token.merge_data(data)
        self._record("token.failed", {"error": {"message": message, "code": code}},
                     token=token, node_id=str(token.activity_id))

    # ------------------------------------------------------------------
    # Decision nodes (specification 5.5)
    # ------------------------------------------------------------------

    def _process_decision(self, token: Token, decision: DecisionNode) -> None:
        self._log(f"Evaluating Decision: {decision.name}")
        node_id = str(decision.id)
        table = decision.decision_table
        hit_policy = getattr(table.hit_policy, "value", table.hit_policy) if table else None

        try:
            result = self._decision_evaluator.decide(decision, token.context_data)
        except Exception as error:
            # A hit-policy conflict is a defect in the table: fail, do not take the default edge
            self._record("decision.evaluated", {
                "method": "none", "strategy": "table", "hit_policy": hit_policy, "matched": False,
                "conflict": _error_info(error)[0],
            }, token=token, node_id=node_id)
            if not isinstance(getattr(error, "code", None), str):
                error = ActivityError(str(error), "DECISION_CONFLICT")
            self._fail_token(token, error)
            return

        rule_edge = next((str(r.output_edge_id) for r in result.matched_rules if r.output_edge_id), None)
        edge_id = result.output_edge_id
        method = "table" if result.matched and rule_edge else "default" if edge_id else "none"
        outputs = result.outputs if result.matched else {}

        # The outputs become token data, so a later decision or condition can use them
        decisions = dict(token.get_data("decisions") or {}) if isinstance(token.get_data("decisions"), dict) else {}
        decisions[node_id] = {"name": decision.name, "method": method, "outputs": outputs}
        token.merge_data({
            **{k: v for k, v in outputs.items() if not k.startswith("_") and k not in ("activities", "decisions")},
            "decisions": decisions,
            "_decision_node_id": node_id,
            "_decision_matched": method == "table",
            "_decision_method": method,
            "_decision_outputs": outputs,
        })

        self._record("decision.evaluated", {
            "method": method,
            "strategy": "table",
            "hit_policy": hit_policy,
            "inputs": self._journal.payload({c.name: token.context_data.get(c.name) for c in table.inputs} if table else {}),
            "matched": method == "table",
            "matched_rules": [
                {"index": table.rules.index(rule), "input_entries": rule.input_entries, "description": rule.description}
                for rule in result.matched_rules
            ] if table else [],
            "outputs": outputs,
            "edge_id": edge_id,
            "used_default": method == "default",
        }, token=token, node_id=node_id)

        edge = self._edges_by_id.get(str(edge_id)) if edge_id else None
        if not edge:
            self._fail_token(token, ActivityError("No matching decision rule and no default path", "NO_ROUTE"))
            return

        self._move_token(token, edge, "decision")

    # ------------------------------------------------------------------
    # Events, timers and business events (specification 13.4, 13.5, 18)
    # ------------------------------------------------------------------

    def _process_event(self, token: Token, event: Event) -> None:
        node_id = str(event.id)
        definition = event.event_definition or {}

        if event.event_type in ("start", "intermediate"):
            self._advance_token(token, node_id)
            return

        if event.event_type == "end":
            token.update_status(TokenStatus.COMPLETED)
            self._record("token.completed", {"end_event": True}, token=token, node_id=node_id)
            return

        if event.event_type == "timer":
            due_key = f"_timer_due:{node_id}"
            due = token.get_data(due_key)

            if not due:
                # First visit: note when the timer is due and yield, so the
                # deadline is checkpointed before the engine waits on it.
                try:
                    duration_ms = parse_iso_duration(definition.get("duration"))
                except ValueError as error:
                    self._fail_token(token, ActivityError(f'Timer "{event.name}": {error}', "VALIDATION_ERROR"))
                    return
                due_at = self._iso(self._now() + duration_ms)
                token.set_data(due_key, due_at)
                self._record("timer.started", {
                    "duration": definition.get("duration"), "duration_ms": duration_ms, "due_at": due_at,
                }, token=token, node_id=node_id)
                return

            remaining = _parse_time(due) - self._now()
            if remaining > 0:
                self._sleep(remaining)
            token.context_data.pop(due_key, None)
            self._record("timer.fired", {"due_at": due}, token=token, node_id=node_id)
            self._advance_token(token, node_id)
            return

        if event.event_type in ("message", "signal"):
            name = definition.get("name")
            if not name or not isinstance(name, str):
                self._fail_token(token, ActivityError(f'Event "{event.name}" has no event_definition.name', "VALIDATION_ERROR"))
                return

            if definition.get("mode") == "publish":
                self._publish_event(token, event, name, definition)
                return

            # Wait for the event. The deadline is fixed now and survives a restart.
            due_at = None
            if definition.get("timeout"):
                try:
                    due_at = self._iso(self._now() + parse_iso_duration(definition["timeout"]))
                except ValueError as error:
                    self._fail_token(token, ActivityError(f'Event "{event.name}": {error}', "VALIDATION_ERROR"))
                    return
            correlation = definition.get("correlation_key") if event.event_type == "message" else None
            awaiting: dict[str, Any] = {"node_id": node_id, "name": name, "broadcast": event.event_type == "signal"}
            if correlation:
                awaiting["correlation_key"] = correlation
                value = resolve_path(token.context_data, correlation, _ABSENT)
                if value is not _ABSENT:
                    awaiting["correlation_value"] = value
            if due_at:
                awaiting["due_at"] = due_at
            if definition.get("timeout_edge_id"):
                awaiting["timeout_edge_id"] = str(definition["timeout_edge_id"])
            token.set_data("_awaiting_event", awaiting)
            token.update_status(TokenStatus.WAITING)
            self._record("event.waiting", {
                "name": name, "correlation_key": correlation,
                "correlation_value": awaiting.get("correlation_value"), "due_at": due_at,
            }, token=token, node_id=node_id)
            return

        self._fail_token(token, ActivityError(
            f'Event "{event.name}" has type "{event.event_type}", which this engine cannot execute', "UNSUPPORTED_EVENT"))

    def _publish_event(self, token: Token, event: Event, name: str, definition: dict[str, Any]) -> None:
        """
        Publish a business event (specification 18.2). The journal is the outbox:
        the event is recorded first, with an id that is the same on every retry,
        then handed to the sink. A consumer deduplicates by id.
        """
        node_id = str(event.id)
        visit = sum(1 for h in token.history if h["node_id"] == node_id and h["action"] == "entered")
        data = {}
        for path in definition.get("data") or []:
            value = resolve_path(token.context_data, path, _ABSENT)
            if value is not _ABSENT:
                data[path] = copy.deepcopy(value)
        published = {
            "specversion": "1.0",
            "id": f"{self._run_id}:{node_id}:{visit}",
            "source": f"urn:awa:run:{self._run_id}",
            "type": name,
            "time": self._iso(),
            "datacontenttype": "application/json",
            "data": data,
        }
        sink = self.options.get("event_sink")
        self._record("event.published", {
            "event_id": published["id"], "name": name, "source": published["source"],
            "data": self._journal.payload(data), "delivered": sink is not None,
        }, token=token, node_id=node_id)
        if sink is not None:
            try:
                sink(published)
            except Exception as error:
                self._fail_token(token, ActivityError(
                    f'Event "{name}" could not be published: {_error_info(error)[0]}', "EVENT_PUBLISH_FAILED"))
                return
        self._advance_token(token, node_id)

    def _awaiting(self, token: Token) -> dict[str, Any] | None:
        awaited = token.get_data("_awaiting_event") if token.status == TokenStatus.WAITING else None
        return awaited if isinstance(awaited, dict) else None

    def deliver_event(self, event: dict[str, Any]) -> int:
        """
        Give the run a business event (specification 18.3): an object with at
        least `id` and `type`, and usually `source` and `data`. Tokens waiting
        for an event of this type, whose correlation matches, take its data and
        continue. A message is consumed by one token; a signal by every token
        waiting for it. An event id the run has already accepted is ignored, so
        redelivery is harmless. Returns how many tokens continued. Call run() afterwards.
        """
        event_id, event_type = event.get("id"), event.get("type")
        if not event_id or not event_type:
            raise ValueError("A business event needs an id and a type")
        if self._status in _OUTCOMES or str(event_id) in self._delivered_events:
            return 0
        data = event.get("data") if isinstance(event.get("data"), dict) else {}
        resumed = 0

        for token in list(self._tokens.values()):
            awaited = self._awaiting(token)
            if not awaited or awaited.get("name") != event_type:
                continue
            key = awaited.get("correlation_key")
            if key and _as_text(resolve_path(data, key, _ABSENT)) != _as_text(awaited.get("correlation_value", _ABSENT)):
                continue

            node_id = awaited["node_id"]
            token.context_data.pop("_awaiting_event", None)
            token.merge_data(copy.deepcopy(public_payload(data)))
            token.update_status(TokenStatus.ACTIVE)
            self._record("event.received", {
                "event_id": str(event_id), "name": event_type, "source": event.get("source"),
                "data": self._journal.payload(data),
            }, token=token, node_id=node_id)
            resumed += 1
            self._advance_token(token, node_id)
            if not awaited.get("broadcast"):
                break

        if resumed > 0:
            self._delivered_events.add(str(event_id))
            if self._status in (EngineStatus.WAITING_EVENT, EngineStatus.WAITING_HUMAN):
                self._status = EngineStatus.RUNNING
            self._settle()
            self._save_checkpoint()
        return resumed

    def next_event_deadline(self) -> float | None:
        """The earliest time at which a waiting token's event wait runs out, in milliseconds since the epoch"""
        due = [_parse_time(a["due_at"]) for a in map(self._awaiting, self._tokens.values()) if a and a.get("due_at")]
        return min(due) if due else None

    def expire_events(self, now: float | None = None) -> int:
        """
        Time out the event waits whose deadline has passed (specification 18.3).
        The token takes the event's timeout edge; an event without one fails the
        token. `now` is in milliseconds since the epoch and defaults to the
        current time. Returns how many tokens timed out. Call run() afterwards.
        """
        now = self._now() if now is None else now
        expired = 0
        for token in list(self._tokens.values()):
            awaited = self._awaiting(token)
            if not awaited or not awaited.get("due_at") or _parse_time(awaited["due_at"]) > now:
                continue

            node_id = awaited["node_id"]
            token.context_data.pop("_awaiting_event", None)
            token.update_status(TokenStatus.ACTIVE)
            self._record("event.timed_out", {"name": awaited["name"], "due_at": awaited["due_at"]},
                         token=token, node_id=node_id)
            expired += 1

            edge = self._edges_by_id.get(awaited["timeout_edge_id"]) if awaited.get("timeout_edge_id") else None
            if edge:
                self._move_token(token, edge, "timeout")
            else:
                self._fail_token(token, ActivityError(
                    f'No "{awaited["name"]}" event arrived before {awaited["due_at"]}, and the event has no timeout edge',
                    "EVENT_TIMEOUT"))

        if expired > 0:
            if self._status in (EngineStatus.WAITING_EVENT, EngineStatus.WAITING_HUMAN):
                self._status = EngineStatus.RUNNING
            self._settle()
            self._save_checkpoint()
        return expired

    def cancel(self, reason: str) -> bool:
        """
        Withdraw the run (specification 5.8): the work is no longer wanted. Tokens
        that have not finished are cancelled, completed activities that name a
        compensation handler are undone, and the run is `cancelled`. A run that
        already reached an outcome is left as it is. Returns whether the run was cancelled.
        """
        if self._status in _OUTCOMES or self._status == EngineStatus.IDLE:
            return False
        self._cancel_tokens("run_cancelled")
        compensation = self._compensate()
        self._status = EngineStatus.CANCELLED
        self._record("run.cancelled", {"reason": reason, "compensation": compensation})
        self._save_checkpoint()
        return True

    # ------------------------------------------------------------------
    # Compensation (specification 13.6)
    # ------------------------------------------------------------------

    def _compensate(self) -> dict[str, int]:
        """
        Undo completed work after a failure. Every completed activity that names
        a compensation handler is compensated, most recently completed first.
        A handler that fails does not stop the others.
        """
        attempted = succeeded = 0
        failure = next((t for t in self._tokens.values() if t.status == TokenStatus.FAILED), None)

        for done in reversed(list(self._completed_activities)):
            activity = self._activities_by_id.get(done["activity_id"])
            handler = (self._activities_by_id.get(str(activity.compensation.activity_id))
                       if activity and activity.compensation else None)
            if not activity or not handler:
                continue

            attempted += 1
            handler_id = str(handler.id)
            about = {"compensates_activity_id": str(activity.id), "compensates_activity_name": activity.name}
            try:
                actor = self._actors.get(handler.actor_type)
                if actor is None:
                    raise RuntimeError(f'No actor for compensation handler "{handler.name}"')
                # The handler works on its own data: the output it undoes and a description of the failure
                scratch = Token(handler_id, {
                    **copy.deepcopy(done["output"]),
                    "_compensating": {"activity_id": str(activity.id), "activity_name": activity.name,
                                      "output": copy.deepcopy(done["output"])},
                    "_failure": {"message": failure.get_data("_error") if failure else None,
                                 "code": failure.get_data("_error_code") if failure else None},
                    "_run_id": self._run_id,
                    "_token_id": done["token_id"],
                    "_idempotency_key": f"{self._run_id}:{done['token_id']}:{handler_id}:compensation",
                }, workflow_id=str(self.workflow.id))
                scratch.id = done["token_id"]
                result = self._call_actor(actor, handler, scratch)
                succeeded += 1
                self._record("activity.compensated", {**about, "output": self._journal.payload(public_payload(result))},
                             token_id=done["token_id"], node_id=handler_id)
            except Exception as error:
                message, code = _error_info(error)
                self._record("activity.compensation_failed", {**about, "error": {"message": message, "code": code}},
                             token_id=done["token_id"], node_id=handler_id)

        return {"attempted": attempted, "succeeded": succeeded}

    # ------------------------------------------------------------------
    # Routing, parallel split and join (specification 5.4, 13.1, 13.2)
    # ------------------------------------------------------------------

    def _select_next_edges(self, edges: list[Edge], data: dict[str, Any]) -> tuple[list[Edge], str]:
        """
        Select the outgoing edges to follow:
        1. Conditional edges are evaluated in document order; the first true one is taken, alone.
        2. Otherwise the edge marked `is_default` is taken, alone.
        3. Otherwise every unconditional edge is taken: one is a sequence, several are a parallel split.
        4. Otherwise there is no route and the token fails. An engine never guesses.
        """
        for edge in edges:
            if edge.condition and evaluate_expression(edge.condition, data):
                return [edge], "condition"
        for edge in edges:
            if edge.is_default:
                return [edge], "default"
        unconditional = [e for e in edges if not e.condition]
        return unconditional, "parallel_split" if len(unconditional) > 1 else "unconditional"

    def _advance_token(self, token: Token, node_id: str, analytics: dict[str, Any] | None = None) -> None:
        """Route a token over the edges that leave a node"""
        # An event's timeout edge is taken only when its wait times out, never by ordinary routing
        event = self._events_by_id.get(node_id)
        timeout_edge = str((event.event_definition or {}).get("timeout_edge_id") or "") if event else ""
        outgoing = [e for e in self._outgoing.get(node_id, []) if str(e.id) != timeout_edge]

        if not outgoing:
            token.update_status(TokenStatus.COMPLETED, analytics=analytics)
            self._record("token.completed", {}, token=token, node_id=node_id)
            return

        try:
            edges, reason = self._select_next_edges(outgoing, token.context_data)
        except Exception as error:
            self._fail_token(token, error, analytics)
            return

        if not edges:
            self._fail_token(token, ActivityError(
                "No route: no edge condition matched and no default edge is defined", "NO_ROUTE"), analytics)
            return

        # Parallel split: the token follows the first edge, and a new token,
        # carrying a copy of its data, follows each of the others.
        first, others = edges[0], edges[1:]
        siblings = []
        for edge in others:
            sibling = Token(node_id, copy.deepcopy(token.context_data), token.id, str(self.workflow.id))
            self._tokens[sibling.id] = sibling
            self._record("token.created", {"parent_token_id": token.id, "reason": "parallel_split"},
                         token=sibling, node_id=node_id)
            siblings.append((sibling, edge))

        self._move_token(token, first, reason, analytics)
        for sibling, edge in siblings:
            self._move_token(sibling, edge, reason)

    def _move_token(self, token: Token, edge: Edge, reason: str, analytics: dict[str, Any] | None = None) -> None:
        source, target = str(token.activity_id), str(edge.target_id)
        token.move(target, analytics=analytics)
        self._record("token.moved", {
            "from_node_id": source, "to_node_id": target, "edge_id": str(edge.id), "reason": reason,
            "condition": edge.condition if reason == "condition" else None,
        }, token=token, node_id=target)

        node = self._activities_by_id.get(target) or self._events_by_id.get(target)
        if node is not None and node.join == "all" and len(self._incoming.get(target, [])) > 1:
            token.set_data("_arrived_edge", str(edge.id))
            token.update_status(TokenStatus.JOINING)
            self._try_join(target)

    def _try_join(self, node_id: str) -> None:
        """
        Synchronising join. When a token has arrived over every incoming edge of
        the node, the tokens are merged into one, which then executes the node once.
        """
        incoming = self._incoming.get(node_id, [])
        parked = [t for t in self._tokens.values() if t.status == TokenStatus.JOINING and str(t.activity_id) == node_id]
        arrivals = [next((t for t in parked if t.get_data("_arrived_edge") == str(edge.id)), None) for edge in incoming]
        if any(t is None for t in arrivals):
            return

        tokens: list[Token] = [t for t in arrivals if t is not None]
        survivor = tokens[0]
        merged: dict[str, Any] = {}
        archive: dict[str, Any] = {}
        # Merge in the document order of the incoming edges; later branches win on conflict
        for token in tokens:
            if isinstance(token.context_data.get("activities"), dict):
                archive.update(token.context_data["activities"])
            merged.update(token.context_data)
        merged.pop("_arrived_edge", None)
        merged["activities"] = archive
        survivor.context_data = merged

        for token in tokens[1:]:
            token.update_status(TokenStatus.JOINED)
        survivor.update_status(TokenStatus.ACTIVE)
        self._record("token.joined", {
            "merged_token_ids": [t.id for t in tokens[1:]],
            "incoming_edge_ids": [str(e.id) for e in incoming],
        }, token=survivor, node_id=node_id)

    # ------------------------------------------------------------------
    # Human tasks (specification 5.6)
    # ------------------------------------------------------------------

    def resume_token(self, token_id: str, output: dict[str, Any]) -> bool:
        """
        Resume a token that was waiting for a person, with the person's answer.
        The answer is merged into the token's data, checked against the
        activity's outcome contract if it has one, and the token is routed.
        Returns False if the token was not waiting for a person or the answer
        was rejected. Call run() afterwards.
        """
        token = self._tokens.get(token_id)
        if not token or token.status != TokenStatus.WAITING or token.get_data("_awaiting_event"):
            return False

        node_id = str(token.activity_id)
        activity = self._activities_by_id.get(node_id)
        output = dict(output or {})
        waiting_since = token.get_data("_waiting_since")
        analytics = None
        waited_ms = None

        if waiting_since:
            waited_ms = int(self._now() - _parse_time(waiting_since))
            analytics = {
                "wait_time": format_iso_duration(waited_ms / 1000),
                "waste_categories": [WasteCategory.waiting.value]
            }

        token.merge_activity_output(node_id, output)
        token.merge_data({"_human_task_status": "completed", "_requires_human_action": False})
        token.update_status(TokenStatus.ACTIVE, analytics=analytics)
        self._record("token.resumed", {"waited_ms": waited_ms}, token=token, node_id=node_id)

        if self._status == EngineStatus.WAITING_HUMAN:
            self._status = EngineStatus.RUNNING

        # The deterministic terms of an outcome contract bind human decisions too
        contract = activity.outcome_contract if activity else None
        if contract:
            violations = check_contract(contract, outcome_of(output))
            self._record("contract.checked", {
                "passed": not violations, "violations": violations, "decided_by": "human",
                "output_hash": hash_payload(outcome_of(output)),
            }, token=token, node_id=node_id)
            if violations:
                self._fail_token(token, ActivityError(
                    "Outcome contract violated by the human decision: " + "; ".join(v["message"] for v in violations),
                    "CONTRACT_VIOLATION", {"_contract_violations": violations}))
                self._settle()
                self._save_checkpoint()
                return False

        self._record("activity.completed", {
            "actor_type": activity.actor_type.value if activity else "human",
            "output": self._journal.payload(public_payload(output)),
            "waited_ms": waited_ms,
        }, token=token, node_id=node_id)

        # The activity is now complete: if the run fails later, its effects are undone like any other's
        self._completed_activities.append({
            "activity_id": node_id, "token_id": token.id, "output": copy.deepcopy(public_payload(output)),
        })

        self._advance_token(token, node_id)
        self._save_checkpoint()
        return token.status != TokenStatus.FAILED
