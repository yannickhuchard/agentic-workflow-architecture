"""
Contexts (specification section 22) and service levels (section 23): what the
conformance cases cannot reach. The time to live of a transient context,
transforms, the sync patterns under a schema, writes made by a person, a
person's task that outlasts its service level, checkpoints, and the host's tick.
"""

import json
from uuid import uuid4

from awa.runtime import InMemoryCheckpointStore
from awa.runtime.context_manager import NO_VALUE, ContextError, ContextManager
from awa.runtime.kpi import compute_measures
from awa.runtime.runtime_host import AwaRuntime
from awa.runtime.workflow_engine import WorkflowEngine
from awa.types import ActorType, Context, Workflow

from .test_conformance import check_journal_event

HOUR = 3_600_000
START = 1_767_603_600_000  # 2026-01-05T09:00:00Z


def activity(name, **more):
    return {"id": str(uuid4()), "name": name, "role_id": str(uuid4()), "actor_type": "application", **more}


def context(name, **more):
    return {"id": str(uuid4()), "name": name, "type": "data", "sync_pattern": "shared_state", **more}


def bind(target, mode, **more):
    return {"context_id": target["id"], "access_mode": mode, **more}


def workflow(activities, contexts=(), **more):
    """The activities in sequence"""
    return Workflow.model_validate({
        "id": str(uuid4()), "name": "Test", "version": "1.0.0", "activities": activities, "contexts": list(contexts),
        "edges": [{"id": str(uuid4()), "source_id": a["id"], "target_id": b["id"]} for a, b in zip(activities, activities[1:])],
        **more,
    })


class Clocked:
    """
    Follows a script by activity name: `takes` moves the clock, `output` is returned,
    `writes` are written to contexts, `error` is raised. An activity whose actor type is
    `human` is left waiting for a person. Remembers what each actor was given.
    """

    def __init__(self, scripts=None):
        self.scripts, self.now, self.given, self.calls = scripts or {}, START, {}, []

    def execute(self, activity, token):
        self.calls.append(activity.name)
        self.given[activity.name] = json.loads(json.dumps(token.context_data.get("_contexts")))
        script = self.scripts.get(activity.name, {})
        self.now += script.get("takes", 0)
        if "error" in script:
            raise RuntimeError(script["error"])
        if activity.actor_type == ActorType.human:
            return {"_requires_human_action": True, "_human_task_id": "task-1"}
        return {**script.get("output", {}), **({"_context_writes": script["writes"]} if "writes" in script else {})}

    def engine(self, document, **options):
        return WorkflowEngine(document, options={
            "actors": {t: self for t in ActorType}, "now": lambda: self.now, "sleep": lambda ms: None, **options})


def journal(engine, *types):
    events = engine.get_events()
    for position, event in enumerate(events):
        check_journal_event(event, position + 1)
    return [e for e in events if not types or e["type"] in types]


# ---------------------------------------------------------------------------
# Contexts
# ---------------------------------------------------------------------------

def test_a_transient_context_has_no_value_once_its_time_to_live_has_passed():
    note = context("Note", lifecycle="transient", ttl="PT1H")
    actors = Clocked({"Write": {"writes": {"Note": "call back"}}, "Wait": {"takes": 2 * HOUR}})
    engine = actors.engine(workflow([
        activity("Write", context_bindings=[bind(note, "write")]),
        activity("Wait"),
        activity("Read", context_bindings=[bind(note, "read", required=False)]),
    ], [note]))
    assert engine.run()["status"] == "completed"
    assert actors.given["Read"] == {}
    assert engine.get_contexts() == {}


def test_a_transient_context_within_its_time_to_live_is_given():
    note = context("Note", lifecycle="transient", ttl="PT1H")
    actors = Clocked({"Write": {"writes": {"Note": "call back"}}, "Wait": {"takes": HOUR // 2}})
    engine = actors.engine(workflow([
        activity("Write", context_bindings=[bind(note, "write")]),
        activity("Wait"),
        activity("Read", context_bindings=[bind(note, "read")]),
    ], [note]))
    assert engine.run()["status"] == "completed"
    assert actors.given["Read"] == {"Note": "call back"}


def test_a_binding_selects_what_is_read_and_places_what_is_written():
    order = context("Order", initial_value={"customer": {"name": "Ada", "card": "4111"}, "lines": 2})
    actors = Clocked({"Price": {"writes": {"Order": 240}}})
    engine = actors.engine(workflow([
        activity("Greet", context_bindings=[bind(order, "read", transforms={"on_read": "customer.name"})]),
        activity("Price", context_bindings=[bind(order, "write", transforms={"on_write": "totals.gross"})]),
    ], [order]))
    assert engine.run()["status"] == "completed"
    assert actors.given["Greet"] == {"Order": "Ada"}  # not the card
    assert actors.given["Price"] == {}  # bound to write only: given nothing to read
    assert engine.get_contexts() == {"Order": {"customer": {"name": "Ada", "card": "4111"}, "lines": 2, "totals": {"gross": 240}}}


def test_a_required_part_that_the_value_does_not_hold_is_missing():
    order = context("Order", initial_value={"customer": {}})
    actors = Clocked()
    engine = actors.engine(workflow(
        [activity("Greet", context_bindings=[bind(order, "read", transforms={"on_read": "customer.name"})])], [order]))
    assert engine.run()["status"] == "failed"
    assert actors.calls == []
    assert engine.tokens[0].get_data("_error_code") == "CONTEXT_MISSING"


def test_contexts_stay_out_of_the_data_of_the_run_and_out_of_the_journal():
    secret = context("Secret", initial_value={"key": "do-not-leak"})

    class Echo:
        """An actor that returns everything it was given"""

        def execute(self, activity, token):
            assert token.context_data.get("_contexts") == ({"Secret": {"key": "do-not-leak"}} if activity.name == "Use" else None)
            return json.loads(json.dumps(token.context_data, default=str))

    engine = WorkflowEngine(workflow(
        [activity("Use", context_bindings=[bind(secret, "read")]), activity("Next")], [secret]),
        options={"actors": {ActorType.application: Echo()}})
    assert engine.run()["status"] == "completed"
    assert "do-not-leak" not in json.dumps([t.to_dict() for t in engine.tokens], default=str)
    assert "do-not-leak" not in json.dumps(journal(engine))  # the journal holds a hash, not the value
    assert "do-not-leak" not in json.dumps(engine.snapshot()["tokens"], default=str)
    read = journal(engine, "context.read")
    assert len(read) == 1 and len(read[0]["data"]["contexts"][0]["value_hash"]) == 64


def test_a_rejected_result_that_echoes_contexts_leaves_none_in_the_failed_token():
    secret = context("Secret", initial_value={"key": "do-not-leak"})

    class Echo:
        def execute(self, activity, token):
            return {"_contexts": token.context_data["_contexts"], "total": "many"}

    engine = WorkflowEngine(workflow([activity("Use", context_bindings=[bind(secret, "read")], outcome_contract={
        "postconditions": [{"name": "Total is a number", "expression": "typeof total == number"}]})], [secret]),
        options={"actors": {ActorType.application: Echo()}})
    assert engine.run()["status"] == "failed"
    assert "do-not-leak" not in json.dumps([t.to_dict() for t in engine.tokens], default=str)


def test_writes_follow_the_sync_pattern_and_the_schema():
    entry = {"type": "object", "required": ["step"]}
    manager = ContextManager([
        Context.model_validate(context("Log", sync_pattern="message_passing", schema=entry)),
        Context.model_validate(context("Board", sync_pattern="blackboard", schema={"type": "object", "maxProperties": 2})),
        Context.model_validate(context("State", initial_value=None)),
    ])
    log, board, state = (str(c.id) for c in manager.list())

    # For the appending patterns the schema describes one entry
    assert manager.write(log, {"step": "a"}) == [{"step": "a"}]
    assert manager.write(log, {"step": "b"}) == [{"step": "a"}, {"step": "b"}]
    refused = [({"note": "no step"}, log), ("not an object", board)]
    for value, target in refused:
        try:
            manager.write(target, value)
            raise AssertionError("the write was applied")
        except ContextError as error:
            assert error.code == "CONTEXT_INVALID"
    assert manager.get(log) == [{"step": "a"}, {"step": "b"}]

    # For a blackboard the schema describes the value after the write
    manager.write(board, {"a": 1})
    manager.write(board, {"b": 2})
    try:
        manager.write(board, {"c": 3})
        raise AssertionError("the write was applied")
    except ContextError as error:
        assert error.code == "CONTEXT_INVALID"
    assert manager.get(board) == {"a": 1, "b": 2}

    # An initial value of null is a value; a context that declares none has no value
    assert manager.get(state) is None
    assert manager.get(board) is not NO_VALUE and manager.snapshot().keys() == {log, board, state}
    try:
        manager.get(str(uuid4()))
        raise AssertionError("an undeclared context was read")
    except ContextError as error:
        assert error.code == "CONTEXT_NOT_FOUND"


def test_a_context_error_is_not_retried_and_a_refused_write_is_journalled_with_its_reason():
    order = context("Order", schema={"type": "object", "required": ["total"]})
    retry = {"max_attempts": 3, "initial_delay": "PT0S"}
    actors = Clocked({"Write": {"writes": {"Order": {"sum": 3}}}})
    engine = actors.engine(workflow([activity("Write", retry=retry, context_bindings=[bind(order, "write")])], [order]))
    assert engine.run()["status"] == "failed"
    assert actors.calls == ["Write"]
    denied = journal(engine, "context.denied")
    assert len(denied) == 1 and "does not match its schema" in denied[0]["data"]["reason"]

    # A required context with no value: the actor is never called, whatever the retry policy
    actors = Clocked()
    engine = actors.engine(workflow([activity("Read", retry=retry, context_bindings=[bind(order, "read")])], [order]))
    assert engine.run()["status"] == "failed"
    assert actors.calls == [] and journal(engine, "activity.started", "activity.retry_scheduled") == []

    # What is returned as writes must be an object keyed by context name
    actors = Clocked({"Write": {"writes": ["Order"]}})
    engine = actors.engine(workflow([activity("Write", context_bindings=[bind(order, "write")])], [order]))
    assert engine.run()["status"] == "failed"
    assert engine.tokens[0].get_data("_error_code") == "CONTEXT_INVALID"


def test_writes_are_applied_only_once_the_outcome_is_accepted():
    order = context("Order")
    actors = Clocked({"Price": {"output": {"total": "many"}, "writes": {"Order": {"total": "many"}}}})
    engine = actors.engine(workflow([activity("Price", context_bindings=[bind(order, "write")], outcome_contract={
        "postconditions": [{"name": "Total is a number", "expression": "typeof total == number"}]})], [order]))
    assert engine.run()["status"] == "failed"
    assert engine.get_contexts() == {}
    assert journal(engine, "context.written", "context.denied") == []
    assert "_context_writes" not in engine.tokens[0].context_data


def test_a_person_completing_a_task_writes_under_the_same_bindings():
    order, ledger = context("Order"), context("Ledger")
    approve = activity("Approve", actor_type="human", context_bindings=[bind(order, "read_write", required=False)],
                       outcome_contract={"postconditions": [{"name": "Decided", "expression": "approved exists"}]})

    def waiting():
        actors = Clocked()
        engine = actors.engine(workflow([approve, activity("File")], [order, ledger]))
        assert engine.run()["status"] == "waiting_human"
        return actors, engine, engine.tokens[0].id

    # An accepted answer writes, and the next activity runs
    actors, engine, token = waiting()
    assert engine.resume_token(token, {"approved": True, "_context_writes": {"Order": {"approved_by": "ana"}}}) is True
    assert engine.run()["status"] == "completed"
    assert engine.get_contexts() == {"Order": {"approved_by": "ana"}}
    assert "_context_writes" not in engine.tokens[0].context_data
    assert [e["type"] for e in journal(engine, "contract.checked", "context.written", "activity.completed")][:3] == [
        "contract.checked", "context.written", "activity.completed"]

    # A write the bindings do not allow fails the token, and nothing is written
    actors, engine, token = waiting()
    assert engine.resume_token(token, {"approved": True, "_context_writes": {"Ledger": {"entry": 1}}}) is False
    assert engine.status.value == "failed" and engine.get_contexts() == {}
    assert engine.tokens[0].get_data("_error_code") == "CONTEXT_ACCESS_DENIED"
    assert actors.calls == ["Approve"]

    # An answer the contract rejects writes nothing: writes follow acceptance (22.3)
    actors, engine, token = waiting()
    assert engine.resume_token(token, {"_context_writes": {"Order": {"approved_by": "ana"}}}) is False
    assert engine.status.value == "failed" and engine.get_contexts() == {}
    assert journal(engine, "context.written") == []


def test_context_values_and_service_level_records_survive_a_checkpoint():
    order = context("Order")
    reply = {"id": str(uuid4()), "name": "Reply", "event_type": "message", "event_definition": {"name": "customer.replied"}}
    write, read = activity("Write", context_bindings=[bind(order, "write")]), activity("Read", context_bindings=[bind(order, "read")])
    document = Workflow.model_validate({
        "id": str(uuid4()), "name": "Test", "version": "1.0.0", "activities": [write, read], "events": [reply],
        "contexts": [order], "sla": {"max_time": "P1D"},
        "edges": [{"id": str(uuid4()), "source_id": write["id"], "target_id": reply["id"]},
                  {"id": str(uuid4()), "source_id": reply["id"], "target_id": read["id"]}],
    })
    actors, store = Clocked({"Write": {"writes": {"Order": {"total": 5}}}}), InMemoryCheckpointStore()
    engine = actors.engine(document, checkpoint=store)
    assert engine.run()["status"] == "waiting_event"
    actors.now += 48 * HOUR
    assert engine.check_service_levels() == {"warnings": 0, "breaches": 1, "failed": 0}

    # Another process continues from the checkpoint: the context has its value, and the breach is not recorded again
    restored = WorkflowEngine.restore(document, store.load(engine.run_id), options={
        "actors": {t: actors for t in ActorType}, "now": lambda: actors.now, "journal": engine._journal_store})
    assert restored.get_contexts() == {"Order": {"total": 5}}
    assert restored.check_service_levels() == {"warnings": 0, "breaches": 0, "failed": 0}
    assert restored.deliver_event({"id": "e1", "type": "customer.replied", "data": {}}) == 1
    assert restored.run()["status"] == "completed"
    assert actors.given["Read"] == {"Order": {"total": 5}}
    assert len(journal(restored, "sla.breached")) == 1


def test_a_checkpoint_keeps_when_a_transient_context_was_written():
    note = context("Note", lifecycle="transient", ttl="PT1H")
    document = workflow([activity("Write", context_bindings=[bind(note, "write")])], [note])
    actors = Clocked({"Write": {"writes": {"Note": "call back"}}})
    engine = actors.engine(document)
    engine.run()
    state = json.loads(json.dumps(engine.snapshot(), default=str))
    actors.now += HOUR // 2
    restored = WorkflowEngine.restore(document, state, options={"now": lambda: actors.now})
    assert restored.get_contexts() == {"Note": "call back"}
    actors.now += HOUR
    assert restored.get_contexts() == {}


def test_a_checkpoint_from_before_contexts_were_enforced_gives_no_context_a_value():
    order = context("Order")
    document = workflow([activity("A")], [order])
    state = Clocked().engine(document).snapshot()
    # As the earlier engine wrote it: an empty object for every context, and nothing about contexts in the metadata
    state["contexts"] = {order["id"]: {}}
    del state["metadata"]["context_times"], state["metadata"]["sla_recorded"]
    assert WorkflowEngine.restore(document, state).get_contexts() == {}


# ---------------------------------------------------------------------------
# Service levels
# ---------------------------------------------------------------------------

def human(**sla):
    return activity("Approve", actor_type="human", sla=sla)


def test_a_task_a_person_has_not_done_is_warned_about_then_breached_and_fails_when_told_to():
    actors = Clocked()
    engine = actors.engine(workflow([human(target_time="PT4H", max_time="P1D", escalation_policy={"breach_action": "fail"})]))
    assert engine.run()["status"] == "waiting_human"
    assert engine.check_service_levels() == {"warnings": 0, "breaches": 0, "failed": 0}
    actors.now += 5 * HOUR
    assert engine.check_service_levels() == {"warnings": 1, "breaches": 0, "failed": 0}
    assert engine.check_service_levels() == {"warnings": 0, "breaches": 0, "failed": 0}  # once
    actors.now += 24 * HOUR
    assert engine.check_service_levels() == {"warnings": 0, "breaches": 1, "failed": 1}
    assert engine.run()["status"] == "failed"
    assert [e["type"] for e in journal(engine, "sla.warning", "sla.breached")] == ["sla.warning", "sla.breached"]
    assert journal(engine, "token.failed")[0]["data"]["error"]["code"] == "SLA_BREACH"
    # A run that has ended is not checked any more
    actors.now += 24 * HOUR
    assert engine.check_service_levels() == {"warnings": 0, "breaches": 0, "failed": 0}


def test_a_person_may_finish_late_when_the_breach_action_is_not_fail():
    actors = Clocked()
    engine = actors.engine(workflow([human(max_time="PT1H", name="Approval")]))
    assert engine.run()["status"] == "waiting_human"
    actors.now += 3 * HOUR
    assert engine.resume_token(engine.tokens[0].id, {"approved": True}) is True
    assert engine.run()["status"] == "completed"
    breach = journal(engine, "sla.breached")
    assert len(breach) == 1 and breach[0]["node_name"] == "Approve"
    assert breach[0]["data"] == {"scope": "activity", "name": "Approval", "elapsed_ms": 3 * HOUR, "max_time": "PT1H",
                                 "max_time_ms": HOUR, "action": "record"}
    assert engine.tokens[0].get_data("approved") is True
    assert not [key for key in engine.tokens[0].context_data if key.startswith("_entered_at")]


def test_work_first_seen_past_its_longest_time_is_a_breach_and_not_also_a_warning():
    # 23.2: a warning is for work past the point of warning and short of max_time
    actors = Clocked({"A": {"takes": 5 * HOUR}})
    engine = actors.engine(workflow([activity("A", sla={"target_time": "PT1H", "max_time": "PT4H"})]))
    assert engine.run()["status"] == "completed"
    assert [e["type"] for e in journal(engine, "sla.warning", "sla.breached")] == ["sla.breached"]


def test_each_visit_of_a_token_to_an_activity_is_measured_on_its_own():
    a, b = activity("A", sla={"max_time": "PT1H"}), activity("B")
    document = Workflow.model_validate({
        "id": str(uuid4()), "name": "Loop", "version": "1.0.0", "activities": [a, b],
        "edges": [{"id": str(uuid4()), "source_id": a["id"], "target_id": b["id"]},
                  {"id": str(uuid4()), "source_id": b["id"], "target_id": a["id"], "condition": "again == true"},
                  {"id": str(uuid4()), "source_id": b["id"], "target_id": a["id"], "condition": "never == true"}],
    })

    class Twice(Clocked):
        def execute(self, activity, token):
            super().execute(activity, token)
            if activity.name == "A":
                self.now += 2 * HOUR
                return {}
            return {"again": self.calls.count("B") == 1}

    actors = Twice()
    engine = actors.engine(document)
    engine.run()
    assert actors.calls == ["A", "B", "A", "B"]
    breaches = journal(engine, "sla.breached")
    assert [b["data"]["elapsed_ms"] for b in breaches] == [2 * HOUR, 2 * HOUR]  # the second visit starts from nothing


def test_a_warning_carries_what_the_policy_says_and_an_unknown_breach_action_only_records():
    role = str(uuid4())
    actors = Clocked({"A": {"error": "upstream unavailable", "takes": 2 * HOUR}})
    engine = actors.engine(workflow([activity(
        "A", retry={"max_attempts": 2, "initial_delay": "PT0S"},
        sla={"max_time": "PT1H", "escalation_policy": {"breach_action": "page-someone", "notify_roles": [role]}})]))
    assert engine.run()["status"] == "failed"
    assert actors.calls == ["A", "A"]  # treated as `record`: the retry policy goes on
    breach = journal(engine, "sla.breached")
    assert len(breach) == 1
    assert breach[0]["data"]["action"] == "page-someone" and breach[0]["data"]["notify_roles"] == [role]
    assert journal(engine, "token.failed")[0]["data"]["error"].get("code") != "SLA_BREACH"


def test_a_service_level_without_times_or_with_a_warning_at_the_longest_time_records_nothing_early():
    actors = Clocked({"A": {"takes": 2 * HOUR}, "B": {"takes": 2 * HOUR}})
    engine = actors.engine(workflow([
        activity("A", sla={"name": "Nothing to compare"}),
        activity("B", sla={"target_time": "PT4H", "max_time": "PT4H"}),
    ]))
    assert engine.run()["status"] == "completed"
    assert journal(engine, "sla.warning", "sla.breached") == []


def test_a_host_checks_service_levels_each_time_it_lets_time_pass():
    clock = {"now": START}
    actors = Clocked()
    document = workflow([human(max_time="PT1H", escalation_policy={"breach_action": "fail"})])
    runtime = AwaRuntime(now=lambda: clock["now"], engine={"actors": {t: actors for t in ActorType}, "now": lambda: clock["now"]})
    runtime.register_workflow(document)
    engine = runtime.start(str(document.id), {})
    assert engine.status.value == "waiting_human"
    runtime.tick()
    assert engine.status.value == "waiting_human"
    clock["now"] += 2 * HOUR
    runtime.tick()
    assert engine.status.value == "failed"
    events = journal(engine)
    report = compute_measures({"workflows": [{"id": str(document.id), "name": "Test"}],
                               "runs": [{"run_id": engine.run_id, "workflow_id": str(document.id), "events": events}]})
    measures = report["workflows"][0]["measures"]
    assert measures["workflow.sla_breaches"] == {"value": 1, "n": 1}
    assert measures["workflow.failure_rate"]["value"] == 1
