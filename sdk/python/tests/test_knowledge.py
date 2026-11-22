"""
Knowledge (specification 15.1 to 15.4): what the conformance cases cannot reach.
The contents of `counts` and `latest`, the `types`, `tags` and `max_entries` of a
binding, determinism, saving and loading, and learning at the end of a run.
"""

import json
from uuid import uuid4

import pytest

from awa.runtime.knowledge import KnowledgeBase, distill, guidance
from awa.runtime.workflow_engine import WorkflowEngine
from awa.types import ActorType, Workflow

GOOD = {"plan": ["look up the price list", "sum the lines"], "rationale": "Prices come from the list.",
        "alternatives_considered": ["estimate"], "confidence": 0.9}
CONTRACT = {"postconditions": [{"name": "Total is a number", "expression": "typeof total == number"}],
            "budgets": {"max_attempts": 3}}


def document(binding=None, **more):
    price, ship = str(uuid4()), str(uuid4())
    return Workflow.model_validate({
        "id": str(uuid4()), "name": "Order Desk", "version": "1.0.0",
        "activities": [
            {"id": price, "name": "Price order", "role_id": str(uuid4()), "actor_type": "ai_agent",
             "outcome_contract": CONTRACT, **({} if binding is None else {"knowledge": binding}), **more},
            {"id": ship, "name": "Ship", "role_id": str(uuid4()), "actor_type": "application"},
        ],
        "edges": [{"id": str(uuid4()), "source_id": price, "target_id": ship}],
    })


class Scripted:
    """Each activity returns the next step of its script; the last repeats. Remembers the knowledge it was given."""

    def __init__(self, script):
        self.script, self.counts, self.given = script, {}, []

    def execute(self, activity, token):
        self.given.append(json.loads(json.dumps(token.get_data("_knowledge"))))
        steps = self.script.get(activity.name, [{}])
        n = self.counts[activity.name] = self.counts.get(activity.name, 0) + 1
        step = steps[min(n, len(steps)) - 1]
        if "error" in step:
            raise RuntimeError(step["error"])
        return {**step.get("output", {}), **({"_reasoning": step["reasoning"]} if "reasoning" in step else {})}


def run(workflow, script, knowledge=None, **options):
    actor = Scripted(script)
    engine = WorkflowEngine(workflow, options={
        "actors": {t: actor for t in ActorType}, "sleep": lambda ms: None, "knowledge": knowledge, **options})
    engine.run({})
    return engine, actor


FIRST_TIME = {"Price order": [{"output": {"total": 40}, "reasoning": GOOD}]}
SECOND_TIME = {"Price order": [{"output": {"total": "forty"}, "reasoning": {"plan": ["estimate"], "rationale": "From memory."}},
                               {"output": {"total": 40}, "reasoning": GOOD}]}


def test_counts_add_up_and_latest_is_replaced():
    workflow, knowledge = document(), KnowledgeBase()
    first, _ = run(workflow, SECOND_TIME)
    second, _ = run(workflow, FIRST_TIME)
    result = knowledge.ingest(workflow, first.get_events())
    assert result == {"run_id": first.run_id, "skipped": False, "updated": [],
                      "created": ["strategies/order-desk-price-order",
                                  "failure-patterns/order-desk-price-order-contract-violation-total-is-a-number"]}

    strategy = knowledge.get("strategies/order-desk-price-order")
    assert strategy["counts"] == {"accepted_runs": 1, "accepted_first_attempt": 0, "attempts": 2}
    assert strategy["latest"] == GOOD
    assert strategy["title"] == "How to price order" and strategy["tags"] == ["ai_agent", "order-desk"]
    assert strategy["scope"] == {"workflow_id": str(workflow.id), "workflow_name": "Order Desk",
                                 "node_id": str(workflow.activities[0].id), "node_name": "Price order"}

    failure = knowledge.list(type="failure_pattern")[0]
    assert failure["counts"] == {"occurrences": 1, "resolved_by_retry_with_feedback": 1}
    assert failure["latest"]["code"] == "CONTRACT_VIOLATION" and failure["latest"]["terms"] == ["Total is a number"]
    assert failure["latest"]["resolution"] == "retry_with_feedback" and "CONTRACT VIOLATED" in failure["latest"]["feedback"]
    assert failure["tags"] == ["ai_agent", "order-desk", "contract_violation"]

    assert knowledge.ingest(workflow, second.get_events())["updated"] == ["strategies/order-desk-price-order"]
    assert strategy["counts"] == {"accepted_runs": 2, "accepted_first_attempt": 1, "attempts": 3}
    assert strategy["observations"] == 2 and [s["run_id"] for s in strategy["sources"]] == [first.run_id, second.run_id]
    assert strategy["updated_at"] == second.get_events()[-1]["time"] and strategy["created_at"] == first.get_events()[-1]["time"]
    assert failure["observations"] == 1


def test_distillation_is_deterministic_and_cites_the_events_it_used():
    workflow = document()
    engine, _ = run(workflow, {**SECOND_TIME, "Ship": [{"error": "carrier 503 unavailable"}]})
    events = engine.get_events()
    candidates = distill(workflow, events)
    assert candidates == distill(workflow, list(reversed(events)))
    assert json.dumps(candidates) == json.dumps(distill(workflow, json.loads(json.dumps(events))))
    by_seq = {e["seq"]: e for e in events}
    for candidate in candidates:
        assert candidate["event_seqs"] and all(seq in by_seq for seq in candidate["event_seqs"])
    assert [(c["type"], [by_seq[s]["type"] for s in c["event_seqs"]]) for c in candidates] == [
        ("strategy", ["reasoning.recorded", "activity.completed"]),
        ("failure_pattern", ["activity.failed", "contract.checked"]),
        ("failure_pattern", ["activity.failed"]),
        ("lesson", ["token.failed", "run.failed"]),
    ]
    # An error is identified by its message with the numbers taken out, so the same failure with another number is the same entry
    again, _ = run(workflow, {**FIRST_TIME, "Ship": [{"error": "carrier 502 unavailable"}]})
    ids = {c["id"] for c in candidates}
    assert {c["id"] for c in distill(workflow, again.get_events()) if c["type"] != "strategy"} <= ids
    lesson = candidates[-1]
    assert lesson["counts"] == {"occurrences": 1, "compensations_attempted": 0, "compensations_succeeded": 0}
    assert lesson["scope"]["node_name"] == "Ship"


def test_a_run_that_fails_the_same_way_twice_is_one_observation():
    workflow, knowledge = document(), KnowledgeBase()
    script = {"Price order": [{"output": {"total": "forty"}}, {"output": {"total": "about forty"}}, {"output": {"total": 40}}]}
    engine, _ = run(workflow, script)
    knowledge.ingest(workflow, engine.get_events())
    failure = knowledge.list(type="failure_pattern")
    assert len(failure) == 1
    assert failure[0]["observations"] == 1 and failure[0]["counts"]["occurrences"] == 2
    assert len(failure[0]["sources"]) == 1 and len(failure[0]["sources"][0]["event_seqs"]) == 4
    assert knowledge.list(type="strategy") == []  # no reasoning was reported with the accepted outcome


def test_a_binding_chooses_types_tags_and_how_many():
    workflow, knowledge = document({"min_status": "draft"}), KnowledgeBase()
    price = workflow.activities[0]
    for script in (SECOND_TIME, SECOND_TIME, {"Price order": [{"error": "model timed out"}]}):
        knowledge.ingest(workflow, run(workflow, script)[0].get_events())
    kinds = lambda binding: [e["type"] for e in knowledge.retrieve(workflow, price, binding)]  # noqa: E731

    assert kinds({"min_status": "draft"}) == ["failure_pattern", "strategy", "failure_pattern"]  # by observations, then id
    assert kinds({"min_status": "draft", "max_entries": 1}) == ["failure_pattern"]
    assert kinds({"min_status": "draft", "types": ["strategy"]}) == ["strategy"]
    assert kinds({"min_status": "draft", "tags": ["contract_violation", "nothing"]}) == ["failure_pattern"]
    assert kinds({"min_status": "draft", "types": ["lesson"]}) == ["lesson"]  # only when asked for
    assert kinds({}) == [] and kinds(None) == []  # nothing has been reviewed
    assert kinds(price.knowledge) == kinds({"min_status": "draft"})
    # Entries about another activity, or another workflow, are not given
    assert knowledge.retrieve(workflow, workflow.activities[1], {"min_status": "draft"}) == []
    assert knowledge.retrieve(document(), price, {"min_status": "draft"}) == []


def test_an_actor_is_given_guidance_and_none_of_it_stays_in_the_run_data():
    workflow, knowledge = document({}), KnowledgeBase()
    knowledge.ingest(workflow, run(workflow, SECOND_TIME)[0].get_events())
    for entry in knowledge.list():
        knowledge.review(entry["id"], "ana", "2026-01-05T09:00:00.000Z")

    engine, actor = run(workflow, SECOND_TIME, knowledge)
    given = actor.given[0]
    assert [g["type"] for g in given] == ["failure_pattern", "strategy"]  # same status and observations: by id
    assert set(given[0]) == {"id", "type", "title", "guidance"}
    assert given[1]["guidance"] == ("An approach accepted before: look up the price list; sum the lines. "
                                    "Why: Prices come from the list.")
    assert given[0]["guidance"].startswith("Earlier outcomes were rejected here (1×): Outcome contract violated")
    assert given[0]["guidance"].endswith("Make sure these hold: Total is a number.")
    assert actor.given == [given, given, None]  # every attempt is given it; the next activity is given nothing
    assert len([e for e in engine.get_events() if e["type"] == "knowledge.retrieved"]) == 1  # once for the visit
    assert "_knowledge" not in json.dumps([t.to_dict() for t in engine.tokens], default=str)
    assert all(guidance(e) for e in knowledge.list())


def test_knowledge_never_relaxes_the_contract():
    workflow, knowledge = document({}), KnowledgeBase()
    knowledge.ingest(workflow, run(workflow, FIRST_TIME)[0].get_events())
    knowledge.review("strategies/order-desk-price-order", "ana")
    engine, actor = run(workflow, {"Price order": [{"output": {"total": "forty"}}]}, knowledge)
    assert actor.given[0] and engine.status.value == "failed"
    assert engine.tokens[0].get_data("_error_code") == "CONTRACT_VIOLATION"


def test_review_and_deprecation_are_recorded():
    workflow, knowledge = document(), KnowledgeBase()
    knowledge.ingest(workflow, run(workflow, SECOND_TIME)[0].get_events())
    strategy, failure = "strategies/order-desk-price-order", knowledge.list(type="failure_pattern")[0]["id"]

    reviewed = knowledge.review(strategy, "ana")
    assert (reviewed["status"], reviewed["reviewed_by"]) == ("reviewed", "ana") and reviewed["reviewed_at"].endswith("Z")
    with pytest.raises(KeyError):
        knowledge.review("strategies/nothing", "ana")
    with pytest.raises(ValueError):
        knowledge.review(failure, "")
    with pytest.raises(KeyError):
        knowledge.deprecate(failure, superseded_by="strategies/nothing")
    assert knowledge.deprecate(failure, superseded_by=strategy)["superseded_by"] == strategy
    assert [e["id"] for e in knowledge.list(status="deprecated")] == [failure]
    assert knowledge.retrieve(workflow, workflow.activities[0], {"min_status": "draft", "types": ["failure_pattern"]}) == []
    assert [entry["action"] for entry in knowledge.to_json()["log"]] == ["Creation", "Creation", "Review", "Deprecation"]


def test_a_saved_knowledge_base_remembers_what_it_ingested(tmp_path):
    workflow, knowledge = document(), KnowledgeBase()
    engine, _ = run(workflow, SECOND_TIME)
    knowledge.ingest(workflow, engine.get_events())
    knowledge.review("strategies/order-desk-price-order", "ana", "2026-01-05T09:00:00.000Z")
    file = str(tmp_path / "kb" / "knowledge.json")
    knowledge.save(file)

    loaded = KnowledgeBase.load(file)
    assert loaded.to_json() == knowledge.to_json() and loaded.to_json()["awa_knowledge"] == "1.1"
    assert loaded.has_ingested(engine.run_id)
    assert loaded.ingest(workflow, engine.get_events())["skipped"] is True
    assert loaded.get("strategies/order-desk-price-order")["observations"] == 1
    assert KnowledgeBase.load(str(tmp_path / "absent.json")).list() == []
    assert KnowledgeBase().ingest(workflow, [])["skipped"] is True


def test_a_run_told_to_learn_is_ingested_when_it_ends_and_only_then():
    workflow, knowledge = document({"min_status": "draft"}), KnowledgeBase()
    first, actor = run(workflow, FIRST_TIME, knowledge, learn=True)
    assert actor.given[0] is None  # nothing was known while the run was under way
    assert knowledge.has_ingested(first.run_id) and len(knowledge.list()) == 1
    assert knowledge.get("strategies/order-desk-price-order")["sources"][0]["event_seqs"]
    second, actor = run(workflow, FIRST_TIME, knowledge, learn=True)
    assert [g["type"] for g in actor.given[0]] == ["strategy"]
    assert knowledge.get("strategies/order-desk-price-order")["observations"] == 2
    # Without `learn`, a run draws on the knowledge base and adds nothing to it
    third, _ = run(workflow, FIRST_TIME, knowledge)
    assert not knowledge.has_ingested(third.run_id)
