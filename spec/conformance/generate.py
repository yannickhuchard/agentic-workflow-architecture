#!/usr/bin/env python3
"""
Generates the AWA conformance cases in this directory.

The JSON files are the normative artefacts; this script only keeps them
consistent and readable. Run it from anywhere: python3 spec/conformance/generate.py
"""

import json
import pathlib
import uuid

ROOT = pathlib.Path(__file__).parent
NS = uuid.UUID("6ba7b811-9dad-11d1-80b4-00c04fd430c8")


def uid(case: str, name: str) -> str:
    return str(uuid.uuid5(NS, f"awa-conformance:{case}:{name}"))


class Case:
    """Small builder so each case reads as a description of the scenario."""

    def __init__(self, case_id: str, level: str, spec: str, description: str):
        self.id, self.level, self.spec, self.description = case_id, level, spec, description
        self.activities, self.edges, self.decisions, self.events = [], [], [], []
        self.actors, self.input, self.expect, self.options = {}, {}, {}, {}

    def u(self, name: str) -> str:
        return uid(self.id, name)

    def act(self, name: str, actor_type: str = "application", **extra):
        self.activities.append({"id": self.u(name), "name": name, "role_id": self.u("role"),
                                "actor_type": actor_type, **extra})
        return self

    def edge(self, source: str, target: str, **extra):
        self.edges.append({"id": self.u(f"{source}->{target}"), "source_id": self.u(source),
                           "target_id": self.u(target), **extra})
        return self

    def event(self, name: str, event_type: str, **definition):
        event = {"id": self.u(name), "name": name, "event_type": event_type}
        if definition:
            event["event_definition"] = definition
        self.events.append(event)
        return self

    def decision(self, name: str, hit_policy: str, inputs, rules, default=None):
        node = {"id": self.u(name), "name": name, "decision_table": {
            "hit_policy": hit_policy,
            "inputs": [{"name": n, "type": t} for n, t in inputs],
            "outputs": [{"name": "route", "type": "string"}],
            "rules": [{"input_entries": entries, "output_entries": [target],
                       "output_edge_id": self.u(f"{name}->{target}")} for entries, target in rules]}}
        if default:
            node["default_output_edge_id"] = self.u(f"{name}->{default}")
        self.decisions.append(node)
        return self

    def build(self) -> dict:
        workflow = {"id": self.u("workflow"), "name": self.id, "version": "1.0.0", "awa_version": "1.1",
                    "activities": self.activities, "edges": self.edges}
        if self.events:
            workflow["events"] = self.events
        if self.decisions:
            workflow["decision_nodes"] = self.decisions
        case = {"id": self.id, "level": self.level, "spec": self.spec, "description": self.description,
                "workflow": workflow}
        if self.input:
            case["input"] = self.input
        if self.options:
            case["options"] = self.options
        if self.actors:
            case["actors"] = self.actors
        case["expect"] = self.expect
        return case


def criterion(case: Case, name: str, expression: str | None = None) -> dict:
    c = {"id": case.u(f"criterion-{name}"), "name": name, "description": name, "type": "format"}
    if expression:
        c["expression"] = expression
    return c


def execution_cases() -> list[Case]:
    cases = []

    c = Case("sequence-completes", "core", "5.3", "Activities connected by unconditional edges run in order and the run completes.")
    c.act("A").act("B").act("C").edge("A", "B").edge("B", "C")
    c.expect = {"status": "completed", "visited": ["A", "B", "C"]}
    cases.append(c)

    c = Case("activity-error-fails-run", "core", "5.7", "An activity that raises fails its token, and a run with a failed token is failed, never completed.")
    c.act("A").act("B").edge("A", "B")
    c.actors = {"A": {"error": "upstream unavailable"}}
    c.expect = {"status": "failed", "visited": ["A"], "error_matches": "upstream unavailable"}
    cases.append(c)

    c = Case("data-flows-downstream", "core", "5.2", "The output of an activity is visible to routing and to later activities.")
    c.act("A").act("B").edge("A", "B", condition="order.total >= 100")
    c.actors = {"A": {"output": {"order": {"total": 150}}}}
    c.expect = {"status": "completed", "visited": ["A", "B"], "data": {"order": {"total": 150}}}
    cases.append(c)

    c = Case("routing-first-true-condition", "core", "5.4", "Conditional edges are evaluated in document order; the first true one is taken.")
    c.act("A").act("B").act("C").edge("A", "B", condition="score > 10").edge("A", "C", condition="score > 5")
    c.actors = {"A": {"output": {"score": 50}}}
    c.expect = {"status": "completed", "visited": ["A", "B"]}
    cases.append(c)

    c = Case("routing-default-edge", "core", "5.4", "When no condition is true the default edge is taken.")
    c.act("A").act("B").act("C").edge("A", "B", condition="approved == true").edge("A", "C", is_default=True)
    c.actors = {"A": {"output": {"approved": False}}}
    c.expect = {"status": "completed", "visited": ["A", "C"]}
    cases.append(c)

    c = Case("routing-no-route-fails", "core", "5.4", "When no condition is true and there is no default edge the token fails; the engine does not guess.")
    c.act("A").act("B").act("C").edge("A", "B", condition="approved == true").edge("A", "C", condition="approved == false")
    c.actors = {"A": {"output": {"approved": "pending"}}}
    c.expect = {"status": "failed", "visited": ["A"], "error_matches": "No route"}
    cases.append(c)

    c = Case("initial-input-is-routable", "core", "5.2", "Data supplied when the run starts is available to conditions.")
    c.act("A").act("B").act("C").edge("A", "B", condition="channel == web").edge("A", "C", is_default=True)
    c.input = {"channel": "web"}
    c.expect = {"status": "completed", "visited": ["A", "B"]}
    cases.append(c)

    c = Case("decision-first-hit", "decision", "5.5", "A decision table with hit policy 'first' routes along the edge of the first matching rule.")
    c.act("A").act("Low").act("High").act("Manual")
    c.decision("Risk", "first", [("amount", "number")], [(["< 1000"], "Low"), ([">= 1000"], "High")], default="Manual")
    c.edge("A", "Risk").edge("Risk", "Low").edge("Risk", "High").edge("Risk", "Manual")
    c.actors = {"A": {"output": {"amount": 5000}}}
    c.expect = {"status": "completed", "visited": ["A", "High"]}
    cases.append(c)

    c = Case("decision-default-edge", "decision", "5.5", "When no rule matches, the decision's default edge is taken.")
    c.act("A").act("Low").act("Manual")
    c.decision("Risk", "first", [("tier", "string")], [(['"gold"'], "Low")], default="Manual")
    c.edge("A", "Risk").edge("Risk", "Low").edge("Risk", "Manual")
    c.actors = {"A": {"output": {"tier": "bronze"}}}
    c.expect = {"status": "completed", "visited": ["A", "Manual"]}
    cases.append(c)

    c = Case("decision-no-match-fails", "decision", "5.5", "When no rule matches and there is no default edge, the token fails.")
    c.act("A").act("Low")
    c.decision("Risk", "first", [("tier", "string")], [(['"gold"'], "Low")])
    c.edge("A", "Risk").edge("Risk", "Low")
    c.actors = {"A": {"output": {"tier": "bronze"}}}
    c.expect = {"status": "failed", "visited": ["A"]}
    cases.append(c)

    c = Case("verification-deterministic-pass", "verified", "7", "An output that satisfies every required criterion is accepted.")
    c.act("A").act("B").edge("A", "B")
    c.activities[0]["verification"] = {"mode": "schema_only", "max_retries": 0,
                                       "criteria": [criterion(c, "has-total", "total > 0")]}
    c.actors = {"A": {"output": {"total": 12}}}
    c.expect = {"status": "completed", "visited": ["A", "B"]}
    cases.append(c)

    c = Case("verification-fail-rejects-output", "verified", "7", "An output that fails a required criterion is rejected; the activity fails and downstream work does not run.")
    c.act("A").act("B").edge("A", "B")
    c.activities[0]["verification"] = {"mode": "schema_only", "max_retries": 0,
                                       "criteria": [criterion(c, "has-total", "total > 0")]}
    c.actors = {"A": {"output": {"total": 0}}}
    c.expect = {"status": "failed", "visited": ["A"]}
    cases.append(c)

    c = Case("verification-unverifiable-fails-closed", "verified", "7", "A criterion that cannot be evaluated is not met. Verification never passes by default.")
    c.act("A").act("B").edge("A", "B")
    c.activities[0]["verification"] = {"mode": "schema_only", "max_retries": 0,
                                       "criteria": [criterion(c, "looks-right")]}
    c.actors = {"A": {"output": {"total": 12}}}
    c.expect = {"status": "failed", "visited": ["A"]}
    cases.append(c)

    c = Case("verification-retry-with-feedback", "verified", "7", "A failed verification of an ai_agent output is retried up to max_retries; a later passing attempt is accepted.")
    c.act("A", "ai_agent").act("B").edge("A", "B")
    c.activities[0]["verification"] = {"mode": "schema_only", "max_retries": 2,
                                       "criteria": [criterion(c, "has-summary", "summary exists")]}
    c.actors = {"A": {"attempts": [{"output": {"draft": "x"}}, {"output": {"summary": "ok"}}]}}
    c.expect = {"status": "completed", "visited": ["A", "A", "B"]}
    cases.append(c)

    retry = {"initial_delay": "PT0S", "jitter": False}

    c = Case("retry-recovers", "resilient", "10.1", "An activity that raises is executed again under its retry policy; a later success is accepted.")
    c.act("A", retry={"max_attempts": 3, **retry}).act("B").edge("A", "B")
    c.actors = {"A": {"attempts": [{"error": "timeout"}, {"error": "timeout"}, {"output": {"ok": True}}]}}
    c.expect = {"status": "completed", "visited": ["A", "A", "A", "B"]}
    cases.append(c)

    c = Case("retry-exhausted-fails", "resilient", "10.1", "When every allowed attempt raises, the activity fails and so does the run.")
    c.act("A", retry={"max_attempts": 2, **retry}).act("B").edge("A", "B")
    c.actors = {"A": {"error": "timeout"}}
    c.expect = {"status": "failed", "visited": ["A", "A"], "journal": ["activity.failed", "activity.retry_scheduled", "activity.failed", "activity.dead_lettered", "token.failed", "run.failed"]}
    cases.append(c)

    c = Case("retry-skips-non-retryable-error", "resilient", "10.1", "An error whose code is non-retryable ends the activity at once.")
    c.act("A", retry={"max_attempts": 5, **retry}).act("B").edge("A", "B")
    c.actors = {"A": {"error": "bad input", "code": "VALIDATION_ERROR"}}
    c.expect = {"status": "failed", "visited": ["A"]}
    cases.append(c)

    c = Case("no-retry-without-policy", "resilient", "10.1", "Without a retry policy an activity is executed once.")
    c.act("A").act("B").edge("A", "B")
    c.actors = {"A": {"attempts": [{"error": "timeout"}, {"output": {}}]}}
    c.expect = {"status": "failed", "visited": ["A"]}
    cases.append(c)

    c = Case("journal-sequence", "recorded", "9.3", "A run is journalled as an ordered sequence of events from run.started to run.completed.")
    c.act("A").act("B").edge("A", "B")
    c.expect = {"status": "completed", "journal": [
        "run.started", "token.created", "activity.started", "activity.completed", "token.moved",
        "activity.started", "activity.completed", "token.completed", "run.completed"]}
    cases.append(c)

    c = Case("journal-records-routing-reason", "recorded", "9.3", "token.moved says which edge was taken and why.")
    c.act("A").act("B").act("C").edge("A", "B", condition="x > 1").edge("A", "C", is_default=True)
    c.actors = {"A": {"output": {"x": 0}}}
    c.expect = {"status": "completed", "journal": ["token.moved"],
                "journal_contains": [{"type": "token.moved", "data": {"reason": "default"}}]}
    cases.append(c)

    c = Case("journal-records-failure", "recorded", "9.3", "A failed run ends with token.failed then run.failed, carrying the error.")
    c.act("A")
    c.actors = {"A": {"error": "boom"}}
    c.expect = {"status": "failed", "journal": ["activity.started", "activity.failed", "token.failed", "run.failed"],
                "journal_contains": [{"type": "activity.failed", "data": {"error": {"message": "boom"}}}]}
    cases.append(c)

    c = Case("journal-records-verification", "recorded", "9.3", "Each verification attempt is journalled with its verdict before the attempt is accepted or rejected.")
    c.act("A", "ai_agent").act("B").edge("A", "B")
    c.activities[0]["verification"] = {"mode": "schema_only", "max_retries": 1,
                                       "criteria": [criterion(c, "has-summary", "summary exists")]}
    c.actors = {"A": {"attempts": [{"output": {"draft": "x"}}, {"output": {"summary": "ok"}}]}}
    c.expect = {"status": "completed", "journal": [
        "activity.started", "verification.completed", "activity.failed", "meta.recorded",
        "activity.started", "verification.completed", "activity.completed"],
        "journal_contains": [{"type": "verification.completed", "data": {"verdict": "fail"}},
                             {"type": "verification.completed", "data": {"verdict": "pass"}}]}
    cases.append(c)

    amount_schema = {"type": "object", "required": ["amount", "currency"],
                     "properties": {"amount": {"type": "number", "minimum": 0}, "currency": {"type": "string", "minLength": 3, "maxLength": 3}}}

    c = Case("contract-holds", "contract", "11.2", "An outcome that satisfies the schema and every postcondition is accepted.")
    c.act("A", outcome_contract={"output_schema": amount_schema, "postconditions": [{"name": "capped", "expression": "amount <= 1000"}]})
    c.act("B").edge("A", "B")
    c.actors = {"A": {"output": {"amount": 250, "currency": "EUR"}}}
    c.expect = {"status": "completed", "visited": ["A", "B"],
                "journal_contains": [{"type": "contract.checked", "data": {"passed": True}}]}
    cases.append(c)

    c = Case("contract-schema-violation-fails", "contract", "11.2", "An outcome that does not validate against output_schema is rejected.")
    c.act("A", outcome_contract={"output_schema": amount_schema}).act("B").edge("A", "B")
    c.actors = {"A": {"output": {"amount": "a lot"}}}
    c.expect = {"status": "failed", "visited": ["A"], "error_matches": "Outcome contract violated",
                "journal_contains": [{"type": "contract.checked", "data": {"passed": False}}]}
    cases.append(c)

    c = Case("contract-postcondition-violation-fails", "contract", "11.2", "An outcome for which a postcondition is false is rejected.")
    c.act("A", outcome_contract={"postconditions": [{"name": "capped", "expression": "amount <= 1000"}]}).act("B").edge("A", "B")
    c.actors = {"A": {"output": {"amount": 5000}}}
    c.expect = {"status": "failed", "visited": ["A"], "error_matches": "capped"}
    cases.append(c)

    c = Case("contract-applies-to-output-property", "contract", "11.1", "When the result has an object-valued 'output' property, the contract applies to that object.")
    c.act("A", outcome_contract={"postconditions": [{"name": "decided", "expression": "decision exists"}]}).act("B").edge("A", "B")
    c.actors = {"A": {"output": {"output": {"decision": "approve"}, "status": "done"}}}
    c.expect = {"status": "completed", "visited": ["A", "B"]}
    cases.append(c)

    c = Case("contract-agent-retried-with-feedback", "contract", "11.3", "An ai_agent whose outcome violates the contract is executed again, up to budgets.max_attempts.")
    c.act("A", "ai_agent", outcome_contract={"postconditions": [{"name": "has-summary", "expression": "summary exists"}], "budgets": {"max_attempts": 3}})
    c.act("B").edge("A", "B")
    c.actors = {"A": {"attempts": [{"output": {}}, {"output": {}}, {"output": {"summary": "s"}}]}}
    c.expect = {"status": "completed", "visited": ["A", "A", "A", "B"]}
    cases.append(c)

    c = Case("contract-attempt-budget-is-a-hard-cap", "contract", "11.4", "budgets.max_attempts bounds executions for every cause, including error retries.")
    c.act("A", retry={"max_attempts": 10, "initial_delay": "PT0S", "jitter": False}, outcome_contract={"budgets": {"max_attempts": 2}})
    c.actors = {"A": {"error": "timeout"}}
    c.expect = {"status": "failed", "visited": ["A", "A"]}
    cases.append(c)

    c = Case("contract-non-agent-not-retried", "contract", "11.3", "Actors other than ai_agent are not re-executed on a contract violation.")
    c.act("A", outcome_contract={"postconditions": [{"name": "has-summary", "expression": "summary exists"}], "budgets": {"max_attempts": 3}})
    c.actors = {"A": {"attempts": [{"output": {}}, {"output": {"summary": "s"}}]}}
    c.expect = {"status": "failed", "visited": ["A"]}
    cases.append(c)

    c = Case("contract-escalates-to-human", "contract", "11.5", "With on_violation 'escalate_human', a rejected outcome is handed to a human, whose decision is accepted if it satisfies the contract.")
    c.act("Assess", "ai_agent", outcome_contract={"postconditions": [{"name": "decided", "expression": "decision exists"}],
                                                 "budgets": {"max_attempts": 1}, "on_violation": "escalate_human"})
    c.act("B").edge("Assess", "B")
    c.actors = {"Assess": {"attempts": [{"output": {"note": "unsure"}}, {"output": {"decision": "approve"}}]}}
    c.expect = {"status": "completed", "visited": ["Assess", "Assess", "B"], "data": {"decision": "approve"},
                "journal": ["contract.checked", "contract.escalated", "contract.checked", "activity.completed"]}
    cases.append(c)

    c = Case("parallel-split-and-join", "flow", "13.1", "Several unconditional edges split the token; a node with join 'all' waits for every branch, merges their data and runs once.")
    c.act("A").act("B").act("C").act("D", join="all")
    c.edge("A", "B").edge("A", "C").edge("B", "D").edge("C", "D")
    c.actors = {"B": {"output": {"b": 1}}, "C": {"output": {"c": 2}}}
    c.expect = {"status": "completed", "visited_unordered": ["A", "B", "C", "D"], "data": {"b": 1, "c": 2},
                "journal": ["token.created", "token.joined", "run.completed"]}
    cases.append(c)

    c = Case("parallel-split-without-join", "flow", "13.1", "Without a join, each branch runs to its own end and the run completes when all have.")
    c.act("A").act("B").act("C").edge("A", "B").edge("A", "C")
    c.expect = {"status": "completed", "visited_unordered": ["A", "B", "C"]}
    cases.append(c)

    c = Case("join-any-runs-per-token", "flow", "13.2", "With the default join 'any', a node reached by two tokens runs twice.")
    c.act("A").act("B").act("C").act("D")
    c.edge("A", "B").edge("A", "C").edge("B", "D").edge("C", "D")
    c.expect = {"status": "completed", "visited_unordered": ["A", "B", "C", "D", "D"]}
    cases.append(c)

    c = Case("join-deadlock-fails", "flow", "13.2", "A join 'all' that can never be satisfied fails the run instead of waiting for ever.")
    c.act("A").act("B").act("C").act("D", join="all")
    c.edge("A", "B", condition="go == b").edge("A", "C", is_default=True).edge("B", "D").edge("C", "D")
    c.actors = {"A": {"output": {"go": "b"}}}
    c.expect = {"status": "failed", "visited": ["A", "B"], "error_matches": "Join can never complete"}
    cases.append(c)

    c = Case("failure-cancels-other-branches", "flow", "13.3", "When one branch fails, tokens on other branches are cancelled and the run fails.")
    c.act("A").act("B").act("C").act("D").act("E")
    c.edge("A", "B").edge("A", "C").edge("B", "D").edge("C", "E")
    c.actors = {"B": {"error": "boom"}}
    c.expect = {"status": "failed", "not_visited": ["D", "E"], "journal": ["token.failed", "token.cancelled", "run.failed"]}
    cases.append(c)

    c = Case("start-and-end-events", "flow", "13.4", "A run starts at the start event, and a token that reaches an end event completes.")
    c.event("Begin", "start").event("Done", "end").act("Orphan").act("A")
    c.edge("Begin", "A").edge("A", "Done")
    c.expect = {"status": "completed", "visited": ["A"]}
    cases.append(c)

    c = Case("timer-event-holds-token", "flow", "13.5", "A timer event holds the token for its duration, then lets it continue.")
    c.act("A").event("Wait", "timer", duration="PT0.02S").act("B").edge("A", "Wait").edge("Wait", "B")
    c.expect = {"status": "completed", "visited": ["A", "B"], "journal": ["timer.started", "timer.fired", "activity.started"]}
    cases.append(c)

    c = Case("unsupported-event-fails", "flow", "13.4", "A token that reaches an event the engine cannot execute fails; it is not waved through.")
    c.act("A").event("Await payment", "message").act("B").edge("A", "Await payment").edge("Await payment", "B")
    c.expect = {"status": "failed", "visited": ["A"], "error_matches": "cannot execute"}
    cases.append(c)

    c = Case("compensation-on-failure", "flow", "13.6", "When a run fails, completed activities that name a compensation handler are compensated, most recent first.")
    c.act("Reserve", compensation={"activity_id": c.u("Release")}).act("Charge", compensation={"activity_id": c.u("Refund")})
    c.act("Ship").act("Release").act("Refund")
    c.edge("Reserve", "Charge").edge("Charge", "Ship")
    c.actors = {"Ship": {"error": "carrier down"}}
    c.expect = {"status": "failed", "visited": ["Reserve", "Charge", "Ship", "Refund", "Release"],
                "journal": ["token.failed", "activity.compensated", "activity.compensated", "run.failed"],
                "journal_contains": [{"type": "run.failed", "data": {"compensation": {"attempted": 2, "succeeded": 2}}}]}
    cases.append(c)

    c = Case("compensation-not-run-on-success", "flow", "13.6", "Compensation handlers are not part of the normal flow and do not run when the run completes.")
    c.act("Reserve", compensation={"activity_id": c.u("Release")}).act("Ship").act("Release")
    c.edge("Reserve", "Ship")
    c.expect = {"status": "completed", "visited": ["Reserve", "Ship"]}
    cases.append(c)

    c = Case("compensation-handler-failure-does-not-stop-others", "flow", "13.6", "A handler that fails is recorded and the remaining compensations still run.")
    c.act("Reserve", compensation={"activity_id": c.u("Release")}).act("Charge", compensation={"activity_id": c.u("Refund")})
    c.act("Ship").act("Release").act("Refund")
    c.edge("Reserve", "Charge").edge("Charge", "Ship")
    c.actors = {"Ship": {"error": "carrier down"}, "Refund": {"error": "bank offline"}}
    c.expect = {"status": "failed", "visited": ["Reserve", "Charge", "Ship", "Refund", "Release"],
                "journal": ["activity.compensation_failed", "activity.compensated", "run.failed"],
                "journal_contains": [{"type": "run.failed", "data": {"compensation": {"attempted": 2, "succeeded": 1}}}]}
    cases.append(c)

    return cases


def document_cases() -> list[dict]:
    def base(case_id: str) -> Case:
        c = Case(case_id, "document", "4", "")
        c.act("A").act("B").edge("A", "B")
        return c

    docs = []

    c = base("valid-minimal")
    docs.append({"id": c.id, "description": "The smallest useful workflow: two activities and one edge.",
                 "valid": True, "document": c.build()["workflow"]})

    c = base("valid-envelope")
    docs.append({"id": c.id, "description": "The envelope form wraps the workflow in a 'workflow' property.",
                 "valid": True, "document": {"workflow": c.build()["workflow"]}})

    c = base("invalid-missing-version")
    w = c.build()["workflow"]
    del w["version"]
    docs.append({"id": c.id, "description": "'version' is required.", "valid": False, "stage": "schema", "document": w})

    c = base("invalid-unknown-actor-type")
    w = c.build()["workflow"]
    w["activities"][0]["actor_type"] = "wizard"
    docs.append({"id": c.id, "description": "'actor_type' must be one of the defined actor types.",
                 "valid": False, "stage": "schema", "document": w})

    c = base("invalid-non-uuid-id")
    w = c.build()["workflow"]
    w["activities"][0]["id"] = "act-1"
    docs.append({"id": c.id, "description": "Identifiers must be UUIDs.", "valid": False, "stage": "schema", "document": w})

    c = base("invalid-dangling-edge")
    w = c.build()["workflow"]
    w["edges"][0]["target_id"] = c.u("nowhere")
    docs.append({"id": c.id, "description": "An edge must connect nodes that exist.",
                 "valid": False, "stage": "integrity", "error_code": "invalid_reference", "document": w})

    c = base("invalid-duplicate-id")
    w = c.build()["workflow"]
    w["activities"][1]["id"] = w["activities"][0]["id"]
    w["edges"][0]["target_id"] = w["activities"][0]["id"]
    docs.append({"id": c.id, "description": "Node identifiers must be unique.",
                 "valid": False, "stage": "integrity", "error_code": "duplicate_id", "document": w})

    c = base("invalid-condition")
    w = c.build()["workflow"]
    w["edges"][0]["condition"] = "amount >> 3"
    docs.append({"id": c.id, "description": "An edge condition must be a valid condition expression.",
                 "valid": False, "stage": "integrity", "error_code": "invalid_expression", "document": w})

    c = base("invalid-two-default-edges")
    c.act("C").edge("A", "C")
    w = c.build()["workflow"]
    for e in w["edges"]:
        e["is_default"] = True
    docs.append({"id": c.id, "description": "A node may have at most one default edge.",
                 "valid": False, "stage": "integrity", "error_code": "multiple_default_edges", "document": w})

    c = Case("invalid-decision-edge", "document", "4", "")
    c.act("A").act("B").decision("D", "first", [("x", "number")], [(["> 1"], "B")]).edge("A", "D")
    docs.append({"id": c.id, "description": "A decision rule must route to an edge that exists and leaves the decision node.",
                 "valid": False, "stage": "integrity", "error_code": "invalid_reference", "document": c.build()["workflow"]})

    c = Case("invalid-compensation-in-flow", "document", "4", "")
    c.act("A", compensation={"activity_id": c.u("B")}).act("B").edge("A", "B")
    docs.append({"id": c.id, "description": "A compensation handler must not be the target of an edge.",
                 "valid": False, "stage": "integrity", "error_code": "invalid_compensation", "document": c.build()["workflow"]})

    c = Case("invalid-timer-duration", "document", "4", "")
    c.act("A").event("Wait", "timer", duration="soon").edge("A", "Wait")
    docs.append({"id": c.id, "description": "A timer event needs an ISO 8601 duration.",
                 "valid": False, "stage": "integrity", "error_code": "invalid_timer", "document": c.build()["workflow"]})

    return docs


def write(path: pathlib.Path, data: dict) -> None:
    path.write_text(json.dumps(data, indent=2) + "\n")


def main() -> None:
    for folder in ("execution", "documents"):
        (ROOT / folder).mkdir(exist_ok=True)
        for old in (ROOT / folder).glob("*.json"):
            old.unlink()
    for case in execution_cases():
        write(ROOT / "execution" / f"{case.id}.json", case.build())
    for doc in document_cases():
        write(ROOT / "documents" / f"{doc['id']}.json", doc)
    print(f"wrote {len(execution_cases())} execution cases and {len(document_cases())} document cases")


if __name__ == "__main__":
    main()
