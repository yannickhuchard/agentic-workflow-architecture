"""
Engine behaviour the specification requires at levels `recorded`, `resilient`,
`contract`, `flow` and `events` that the shared conformance cases do not exercise:
payload modes (9.4), dead letters (10.2), checkpoints and recovery (10.3),
idempotency keys (10.4), human decisions under a contract (11.5), cancellation (5.8),
timers across recovery (13.5) and publishing through a sink (18.2).
"""

import json
from uuid import uuid4

import pytest

from awa.runtime import FileCheckpointStore, FileJournalStore, InMemoryCheckpointStore
from awa.runtime.journal import canonical_json, hash_payload
from awa.runtime.token import TokenStatus
from awa.runtime.workflow_engine import EngineStatus, WorkflowEngine
from awa.types import ActorType, Workflow


class Scripted:
    """Returns what the script says for each activity; an exception is raised; a list is one entry per call"""

    def __init__(self, script=None):
        self.script, self.calls, self.seen = script or {}, [], []

    def execute(self, activity, token):
        self.calls.append(activity.name)
        self.seen.append(dict(token.context_data))
        step = self.script.get(activity.name, {})
        if isinstance(step, list):
            step = step[min(self.calls.count(activity.name), len(step)) - 1]
        if isinstance(step, Exception):
            raise step
        return step


def workflow(names, edges, events=(), **activity_fields):
    ids = {name: str(uuid4()) for name in [*names, *[e["name"] for e in events]]}
    return Workflow.model_validate({
        "id": str(uuid4()), "name": "t", "version": "1.0.0",
        "activities": [
            {"id": ids[n], "name": n, "role_id": str(uuid4()), "actor_type": "application",
             **{k: (dict(v, activity_id=ids[v["activity"]]) if k == "compensation" else v)
                for k, v in activity_fields.get(n, {}).items()}}
            for n in names
        ],
        "edges": [{"id": str(uuid4()), "source_id": ids[s], "target_id": ids[t]} for s, t in edges],
        "events": [{"id": ids[e["name"]], **e} for e in events],
    })


def engine_for(wf, actor, **options):
    return WorkflowEngine(wf, options={"actors": {t: actor for t in ActorType}, "sleep": lambda ms: None, **options})


def types(engine):
    return [e["type"] for e in engine.get_events()]


# --- 9.4 payload modes -------------------------------------------------------

def test_payload_mode_hash_and_none():
    wf = workflow("A", [])
    hashed = engine_for(wf, Scripted({"A": {"secret": 1}}), journal_payloads="hash")
    hashed.run({"x": 1})
    completed = next(e for e in hashed.get_events() if e["type"] == "activity.completed")
    assert completed["data"]["output"] == {"sha256": hash_payload({"secret": 1})}
    assert "secret" not in json.dumps(hashed.get_events())

    silent = engine_for(wf, Scripted({"A": {"secret": 1}}), journal_payloads="none")
    silent.run({"x": 1})
    assert all("output" not in e["data"] and "input" not in e["data"] for e in silent.get_events())

    with pytest.raises(ValueError):
        engine_for(wf, Scripted(), journal_payloads="everything")


def test_canonical_json_sorts_keys_at_every_depth():
    assert canonical_json({"b": [1, {"d": 1.0, "c": None}], "a": "é"}) == '{"a":"é","b":[1,{"c":null,"d":1}]}'
    assert hash_payload({"a": 1, "b": 2}) == hash_payload({"b": 2, "a": 1})


def test_reserved_properties_are_not_journalled_as_payload():
    engine = engine_for(workflow("AB", [("A", "B")]), Scripted({"A": {"x": 1, "_internal": 2}}))
    engine.run()
    for event in engine.get_events():
        for part in ("input", "output"):
            assert not any(key.startswith("_") or key == "activities" for key in event["data"].get(part, {}))


def test_journal_listener_and_file_store(tmp_path):
    store = FileJournalStore(str(tmp_path))
    engine = engine_for(workflow("A", []), Scripted(), journal=store)
    heard = []
    engine.on_event(heard.append)
    engine.run()
    assert [e["seq"] for e in heard] == list(range(1, len(heard) + 1))
    lines = (tmp_path / f"{engine.run_id}.journal.jsonl").read_text().strip().split("\n")
    assert [json.loads(line) for line in lines] == heard == store.read(engine.run_id)
    assert store.read(engine.run_id, after_seq=2) == heard[2:]


# --- 10.1, 10.2 retry and dead letters ---------------------------------------

def test_engine_default_retry_policy_and_backoff_delays():
    slept = []
    actor = Scripted({"A": [RuntimeError("down"), RuntimeError("down"), {"ok": True}]})
    engine = engine_for(workflow("A", []), actor, sleep=slept.append,
                        retry={"max_retries": 2, "initial_delay_ms": 100, "jitter": False})
    assert engine.run()["status"] == "completed"
    assert actor.calls == ["A", "A", "A"]
    assert slept == [100, 200]
    assert [e["data"]["delay_ms"] for e in engine.get_events() if e["type"] == "activity.retry_scheduled"] == [100, 200]


def test_retryability_is_decided_by_code_not_by_message():
    actor = Scripted({"A": [RuntimeError("validation failed: invalid, not found"), {}]})
    engine = engine_for(workflow("A", [], A={"retry": {"max_attempts": 2, "initial_delay": "PT0S", "jitter": False}}), actor)
    assert engine.run()["status"] == "completed"
    assert actor.calls == ["A", "A"]


def test_exhausted_retries_are_dead_lettered_with_token_and_error():
    actor = Scripted({"A": RuntimeError("down")})
    engine = engine_for(workflow("A", [], A={"retry": {"max_attempts": 2, "initial_delay": "PT0S", "jitter": False}}), actor)
    assert engine.run({"order": 7})["status"] == "failed"
    entry, = engine.dead_letter_queue.list()
    assert entry.token is engine.tokens[0] and entry.token.status == TokenStatus.FAILED
    assert entry.token.get_data("order") == 7
    assert entry.error["message"] == "down" and entry.retry_state.attempt == 2


# --- 10.3 checkpoints and recovery, 10.4 idempotency ---------------------------

def test_run_is_checkpointed_after_each_step_and_recovered_in_another_engine(tmp_path):
    wf = workflow("ABC", [("A", "B"), ("B", "C")])
    checkpoints, journal = FileCheckpointStore(str(tmp_path / "cp")), FileJournalStore(str(tmp_path / "journal"))

    class Crash(BaseException):
        pass

    class CrashingOnB(Scripted):
        def execute(self, activity, token):
            if activity.name == "B":
                self.seen.append(dict(token.context_data))
                raise Crash()  # the process dies while B is executing
            return super().execute(activity, token)

    first_actor = CrashingOnB({"A": {"a": 1}})
    first = engine_for(wf, first_actor, checkpoint=checkpoints, journal=journal)
    with pytest.raises(Crash):
        first.run({"order": 7})
    seq_at_checkpoint = checkpoints.load(first.run_id)["metadata"]["journal_seq"]

    # Another process: only the checkpoint, the journal store and the document are shared
    state = json.loads(json.dumps(checkpoints.load(first.run_id)))
    actor = Scripted({"B": {"b": 2}})
    second = WorkflowEngine.restore(wf, state, options={
        "actors": {t: actor for t in ActorType}, "checkpoint": checkpoints, "journal": journal})

    assert second.run_id == first.run_id
    assert second.status == EngineStatus.RUNNING
    assert second.run()["status"] == "completed"
    assert actor.calls == ["B", "C"]  # B executes again: at least once
    data = second.tokens[0].context_data
    assert (data["order"], data["a"], data["b"]) == (7, 1, 2)

    events = journal.read(first.run_id)
    resumed = next(e for e in events if e["type"] == "run.resumed")
    assert resumed["data"]["from_seq"] == seq_at_checkpoint
    # The idempotency key of B's visit is the same before and after recovery
    assert first_actor.seen[-1]["_idempotency_key"] == actor.seen[0]["_idempotency_key"]
    assert checkpoints.load(first.run_id)["engine_status"] == "completed"


def test_restore_rejects_a_checkpoint_of_another_workflow():
    engine = engine_for(workflow("A", []), Scripted())
    engine.run()
    with pytest.raises(ValueError):
        WorkflowEngine.restore(workflow("A", []), engine.snapshot())


def test_idempotency_key_is_stable_across_attempts_and_distinct_per_visit():
    actor = Scripted({"A": [RuntimeError("down"), {}]})
    wf = workflow("AB", [("A", "B")], A={"retry": {"max_attempts": 2, "initial_delay": "PT0S", "jitter": False}})
    engine = engine_for(wf, actor)
    engine.run()
    first, second, other = (seen["_idempotency_key"] for seen in actor.seen)
    assert first == second != other
    assert [seen["_attempt"] for seen in actor.seen] == [1, 2, 1]


def test_delivered_event_ids_survive_recovery():
    wf = workflow("AB", [("A", "Wait"), ("Wait", "B")],
                  events=[{"name": "Wait", "event_type": "message", "event_definition": {"name": "ping"}}])
    store = InMemoryCheckpointStore()
    first = engine_for(wf, Scripted(), checkpoint=store)
    assert first.run()["status"] == "waiting_event"

    actor = Scripted()
    second = WorkflowEngine.restore(wf, store.load(first.run_id), options={"actors": {t: actor for t in ActorType}})
    assert second.status == EngineStatus.WAITING_EVENT
    assert second.deliver_event({"id": "e1", "type": "ping", "data": {"n": 1, "_hidden": 2}}) == 1
    assert second.run()["status"] == "completed"
    assert second.tokens[0].get_data("n") == 1 and second.tokens[0].get_data("_hidden") is None

    third = WorkflowEngine.restore(wf, second.snapshot())
    assert third.deliver_event({"id": "e1", "type": "ping"}) == 0


# --- 13.5 timers -------------------------------------------------------------

def test_recovered_timer_waits_only_for_the_time_remaining():
    wf = workflow("AB", [("A", "Wait"), ("Wait", "B")],
                  events=[{"name": "Wait", "event_type": "timer", "event_definition": {"duration": "PT10M"}}])
    clock = {"now": 1_700_000_000_000}
    store = InMemoryCheckpointStore()
    first = engine_for(wf, Scripted(), checkpoint=store, now=lambda: clock["now"])
    first.start()
    while "timer.started" not in types(first):
        first.run_step()

    clock["now"] += 4 * 60 * 1000  # four minutes pass before the run is recovered
    slept = []
    second = WorkflowEngine.restore(wf, store.load(first.run_id), options={
        "actors": {t: Scripted() for t in ActorType}, "now": lambda: clock["now"], "sleep": slept.append})
    assert second.run()["status"] == "completed"
    assert slept == [6 * 60 * 1000]
    assert types(second).count("timer.started") == 0  # the timer does not start again


# --- 5.6, 11.5 human decisions ------------------------------------------------

def human_workflow(contract=None):
    wf = workflow("AB", [("A", "B")], A={"outcome_contract": contract} if contract else {})
    wf.activities[0].actor_type = ActorType.human
    return wf


def test_human_task_parks_the_token_and_resume_routes_it():
    actor = Scripted({"A": {"_requires_human_action": True, "_human_task_id": "task-1"}})
    engine = engine_for(human_workflow(), actor)
    assert engine.run()["status"] == "waiting_human"
    token = engine.tokens[0]
    assert engine.resume_token(token.id, {"approved": True}) is True
    assert engine.run()["status"] == "completed"
    assert actor.calls == ["A", "B"] and token.get_data("approved") is True
    kinds = types(engine)
    assert [k for k in kinds if k in ("token.waiting", "run.waiting", "token.resumed", "run.completed")] == [
        "token.waiting", "run.waiting", "token.resumed", "run.completed"]
    assert engine.resume_token(token.id, {}) is False


def test_contract_binds_a_human_decision():
    contract = {"postconditions": [{"name": "decided", "expression": "decision exists"}]}
    engine = engine_for(human_workflow(contract), Scripted({"A": {"_requires_human_action": True}}))
    engine.run()
    assert engine.resume_token(engine.tokens[0].id, {"note": "unsure"}) is False
    assert engine.status == EngineStatus.FAILED
    assert engine.tokens[0].get_data("_error_code") == "CONTRACT_VIOLATION"


def test_duration_budget_ignores_a_late_result():
    clock = {"now": 0.0}

    class Slow(Scripted):
        def execute(self, activity, token):
            clock["now"] += 5000
            return super().execute(activity, token)

    actor = Slow({"A": {"late": True}})
    wf = workflow("AB", [("A", "B")], A={"outcome_contract": {"budgets": {"max_duration": "PT1S"}}})
    engine = engine_for(wf, actor, now=lambda: clock["now"])
    assert engine.run()["status"] == "failed"
    assert actor.calls == ["A"]
    assert engine.tokens[0].get_data("_error_code") == "TIMEOUT" and engine.tokens[0].get_data("late") is None


def test_verification_without_a_registered_verifier_fails_closed():
    criteria = [{"id": str(uuid4()), "name": "sound", "description": "sound", "type": "accuracy"}]
    for mode in ("ai_judge", "custom"):
        wf = workflow("AB", [("A", "B")], A={"verification": {"mode": mode, "criteria": criteria}})
        actor = Scripted({"A": {"total": 1}})
        engine = engine_for(wf, actor)
        assert engine.run()["status"] == "failed" and actor.calls == ["A"]
        verdict = next(e for e in engine.get_events() if e["type"] == "verification.completed")
        assert verdict["data"]["verdict"] == "error"

    judge = lambda activity, inputs, outcome, policy: [{"passed": outcome["total"] > 0, "evidence": "checked"}]
    engine = engine_for(wf, Scripted({"A": {"total": 1}}), verifiers={"custom": judge})
    assert engine.run()["status"] == "completed"


# --- 5.8 cancellation ---------------------------------------------------------

def test_cancel_withdraws_tokens_and_compensates():
    wf = workflow(["A", "B", "Undo"], [("A", "Wait"), ("Wait", "B")],
                  events=[{"name": "Wait", "event_type": "message", "event_definition": {"name": "ping"}}],
                  A={"compensation": {"activity": "Undo"}})
    actor = Scripted({"A": {"reserved": 3}})
    engine = engine_for(wf, actor)
    assert engine.run()["status"] == "waiting_event"
    assert engine.cancel("customer withdrew") is True
    assert engine.status == EngineStatus.CANCELLED
    assert actor.calls == ["A", "Undo"]
    assert actor.seen[-1]["reserved"] == 3 and actor.seen[-1]["_idempotency_key"].endswith(":compensation")
    cancelled = engine.get_events()[-1]
    assert cancelled["type"] == "run.cancelled"
    assert cancelled["data"] == {"reason": "customer withdrew", "compensation": {"attempted": 1, "succeeded": 1}}
    assert "token.cancelled" in types(engine)
    # A cancelled run accepts no further events, and cancelling again changes nothing
    assert engine.deliver_event({"id": "e1", "type": "ping"}) == 0
    assert engine.cancel("again") is False and engine.run()["status"] == "cancelled"


# --- 18.2 publishing ----------------------------------------------------------

def publishing_workflow():
    return workflow("AB", [("A", "Out"), ("Out", "B")], events=[{
        "name": "Out", "event_type": "message",
        "event_definition": {"name": "claim.settled", "mode": "publish", "data": ["claim_id", "missing"]}}])


def test_published_event_reaches_the_sink_after_the_journal():
    sent = []
    engine = engine_for(publishing_workflow(), Scripted({"A": {"claim_id": "C-9", "internal": "x"}}))
    engine.options["event_sink"] = lambda event: sent.append((event, "event.published" in types(engine)))
    assert engine.run()["status"] == "completed"
    (event, journalled_first), = sent
    assert journalled_first
    node_id = str(engine.workflow.events[0].id)
    assert event["id"] == f"{engine.run_id}:{node_id}:1" and event["source"] == f"urn:awa:run:{engine.run_id}"
    assert event["type"] == "claim.settled" and event["data"] == {"claim_id": "C-9"}


def test_sink_failure_fails_the_token():
    def sink(event):
        raise RuntimeError("broker down")

    actor = Scripted()
    engine = engine_for(publishing_workflow(), actor, event_sink=sink)
    assert engine.run()["status"] == "failed"
    assert actor.calls == ["A"]
    assert engine.tokens[0].get_data("_error_code") == "EVENT_PUBLISH_FAILED"


def test_next_event_deadline_and_expiry_respect_the_clock():
    wf = workflow("AB", [("A", "Wait"), ("Wait", "B")], events=[{
        "name": "Wait", "event_type": "message", "event_definition": {"name": "ping", "timeout": "PT1H"}}])
    clock = {"now": 1_700_000_000_000}
    engine = engine_for(wf, Scripted(), now=lambda: clock["now"])
    engine.run()
    assert engine.next_event_deadline() == clock["now"] + 3_600_000
    assert engine.expire_events() == 0 and engine.status == EngineStatus.WAITING_EVENT
    clock["now"] += 3_600_000
    assert engine.expire_events() == 1
    assert engine.run()["status"] == "failed"
    assert engine.tokens[0].get_data("_error_code") == "EVENT_TIMEOUT"


def test_recovery_never_reuses_a_journal_sequence_number():
    """A process that stops mid-activity has journalled events after its last checkpoint.
    The recovered run numbers its events after the last one on record, not after the checkpoint."""
    from awa.runtime.checkpoint import InMemoryCheckpointStore
    from awa.runtime.journal import InMemoryJournalStore

    workflow = Workflow.model_validate({
        "id": "00000000-0000-4000-8000-0000000000a1", "name": "wait", "version": "1.0.0",
        "activities": [
            {"id": "00000000-0000-4000-8000-0000000000a2", "name": "A", "role_id": "00000000-0000-4000-8000-0000000000a9", "actor_type": "application"},
            {"id": "00000000-0000-4000-8000-0000000000a3", "name": "B", "role_id": "00000000-0000-4000-8000-0000000000a9", "actor_type": "application"},
        ],
        "events": [{"id": "00000000-0000-4000-8000-0000000000a4", "name": "Go", "event_type": "message", "event_definition": {"name": "go"}}],
        "edges": [
            {"id": "00000000-0000-4000-8000-0000000000a5", "source_id": "00000000-0000-4000-8000-0000000000a2", "target_id": "00000000-0000-4000-8000-0000000000a4"},
            {"id": "00000000-0000-4000-8000-0000000000a6", "source_id": "00000000-0000-4000-8000-0000000000a4", "target_id": "00000000-0000-4000-8000-0000000000a3"},
        ],
    })
    journal, checkpoints = InMemoryJournalStore(), InMemoryCheckpointStore()
    first = WorkflowEngine(workflow, options={"journal": journal, "checkpoint": checkpoints})
    assert first.run()["status"] == "waiting_event"
    run_id = first.run_id
    state = checkpoints.load(run_id)
    tail = journal.read(run_id)[-1]
    # Two more events reached the journal before the process died without checkpointing again
    journal.append({**tail, "id": "00000000-0000-4000-8000-0000000000b1", "seq": tail["seq"] + 1, "type": "activity.started"})
    journal.append({**tail, "id": "00000000-0000-4000-8000-0000000000b2", "seq": tail["seq"] + 2, "type": "tool.invoked"})

    second = WorkflowEngine.restore(workflow, state, options={"journal": journal, "checkpoint": checkpoints})
    second.deliver_event({"specversion": "1.0", "id": "e1", "source": "/test", "type": "go", "data": {}})
    second.run()
    seqs = [e["seq"] for e in journal.read(run_id)]
    assert seqs == list(range(1, len(seqs) + 1))
    resumed = next(e for e in journal.read(run_id) if e["type"] == "run.resumed")
    assert resumed["seq"] == tail["seq"] + 3
