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

    def event(self, title: str, event_type: str, **definition):
        event = {"id": self.u(title), "name": title, "event_type": event_type}
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
        if getattr(self, "contexts", None):
            workflow["contexts"] = self.contexts
        if getattr(self, "sla", None):
            workflow["sla"] = self.sla
        case = {"id": self.id, "level": self.level, "spec": self.spec, "description": self.description,
                "workflow": workflow}
        if self.input:
            case["input"] = self.input
        if self.options:
            case["options"] = self.options
        if self.actors:
            case["actors"] = self.actors
        if getattr(self, "deliver", None):
            case["deliver"] = self.deliver
        for extra in ("tools", "model", "clock"):
            if getattr(self, extra, None):
                case[extra] = getattr(self, extra)
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

    c = Case("outcome-fields-are-routable", "core", "5.2", "When a result has an object-valued 'output', that object's fields are merged into the token's data and can be used by conditions.")
    c.act("A").act("B").act("C").edge("A", "B", condition="score > 5").edge("A", "C", is_default=True)
    c.actors = {"A": {"output": {"output": {"score": 9}, "status": "done"}}}
    c.expect = {"status": "completed", "visited": ["A", "B"], "data": {"score": 9, "output": {"score": 9}}}
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

    # ---- decision tables: hit policies, outputs, chaining ------------------
    def table(c, name, policy, inputs, rules, outputs=(("route", "string"),), default=None):
        """rules: (input_entries, output_entries, target or None, extra)"""
        node = {"id": c.u(name), "name": name, "decision_table": {
            "hit_policy": policy,
            "inputs": [{"name": n, "type": t} for n, t in inputs],
            "outputs": [{"name": n, "type": t} for n, t in outputs],
            "rules": [{"input_entries": i, "output_entries": o,
                       **({"output_edge_id": c.u(f"{name}->{t}")} if t else {}), **(x or {})} for i, o, t, x in rules]}}
        if default:
            node["default_output_edge_id"] = c.u(f"{name}->{default}")
        c.decisions.append(node)
        return c

    c = Case("decision-unique-single-match", "decision", "5.5.2", "Hit policy 'unique': when exactly one rule matches, it decides, wherever it is in the table.")
    c.act("A").act("Low").act("High")
    table(c, "D", "unique", [("amount", "number")], [(["< 100"], ["low"], "Low", None), ([">= 100"], ["high"], "High", None)])
    c.edge("A", "D").edge("D", "Low").edge("D", "High")
    c.actors = {"A": {"output": {"amount": 500}}}
    c.expect = {"status": "completed", "visited": ["A", "High"]}
    cases.append(c)

    c = Case("decision-unique-conflict-fails", "decision", "5.5.2", "Hit policy 'unique': two matching rules are a defect in the table. The token fails; the default edge is not taken.")
    c.act("A").act("Low").act("High").act("Other")
    table(c, "D", "unique", [("amount", "number")], [(["< 1000"], ["low"], "Low", None), (["> 100"], ["high"], "High", None)], default="Other")
    c.edge("A", "D").edge("D", "Low").edge("D", "High").edge("D", "Other")
    c.actors = {"A": {"output": {"amount": 500}}}
    c.expect = {"status": "failed", "visited": ["A"], "error_matches": "unique"}
    cases.append(c)

    c = Case("decision-any-agreeing-rules", "decision", "5.5.2", "Hit policy 'any': several rules may match if they give the same result.")
    c.act("A").act("Review").act("Pay")
    table(c, "D", "any", [("amount", "number"), ("flagged", "boolean")],
          [(["> 1000", "-"], ["review"], "Review", None), (["-", "true"], ["review"], "Review", None), (["<= 1000", "false"], ["pay"], "Pay", None)])
    c.edge("A", "D").edge("D", "Review").edge("D", "Pay")
    c.actors = {"A": {"output": {"amount": 5000, "flagged": True}}}
    c.expect = {"status": "completed", "visited": ["A", "Review"]}
    cases.append(c)

    c = Case("decision-any-disagreeing-rules-fail", "decision", "5.5.2", "Hit policy 'any': matching rules with different results are a conflict, and the token fails.")
    c.act("A").act("Review").act("Pay")
    table(c, "D", "any", [("amount", "number"), ("flagged", "boolean")],
          [(["> 1000", "-"], ["review"], "Review", None), (["-", "false"], ["pay"], "Pay", None)])
    c.edge("A", "D").edge("D", "Review").edge("D", "Pay")
    c.actors = {"A": {"output": {"amount": 5000, "flagged": False}}}
    c.expect = {"status": "failed", "visited": ["A"], "error_matches": "any"}
    cases.append(c)

    c = Case("decision-priority-highest-wins", "decision", "5.5.2", "Hit policy 'priority': of the matching rules the one with the highest priority decides, even if it comes later.")
    c.act("A").act("Standard").act("Vip").act("Blocked")
    table(c, "D", "priority", [("spend", "number"), ("blocked", "boolean")],
          [(["-", "-"], ["standard"], "Standard", {"priority": 1}), (["> 1000", "-"], ["vip"], "Vip", {"priority": 5}), (["-", "true"], ["blocked"], "Blocked", {"priority": 9})])
    c.edge("A", "D").edge("D", "Standard").edge("D", "Vip").edge("D", "Blocked")
    c.actors = {"A": {"output": {"spend": 4000, "blocked": False}}}
    c.expect = {"status": "completed", "visited": ["A", "Vip"]}
    cases.append(c)

    c = Case("decision-priority-tie-earlier-rule", "decision", "5.5.2", "Hit policy 'priority': among matching rules of equal priority the earlier one decides.")
    c.act("A").act("First").act("Second")
    table(c, "D", "priority", [("x", "number")], [(["> 0"], ["first"], "First", {"priority": 2}), (["> 0"], ["second"], "Second", {"priority": 2})])
    c.edge("A", "D").edge("D", "First").edge("D", "Second")
    c.actors = {"A": {"output": {"x": 1}}}
    c.expect = {"status": "completed", "visited": ["A", "First"]}
    cases.append(c)

    c = Case("decision-collect-lists-outputs", "decision", "5.5.2", "Hit policy 'collect': each output is the list of the matching rules' values, in rule order; the first matching rule that names an edge routes.")
    c.act("A").act("Next")
    table(c, "D", "collect", [("amount", "number"), ("country", "string")],
          [(["> 1000", "-"], ["large-amount"], "Next", None), (["-", "in(\"XX\", \"YY\")"], ["high-risk-country"], None, None), (["< 0", "-"], ["negative"], None, None)],
          outputs=(("flags", "string"),))
    c.edge("A", "D").edge("D", "Next")
    c.actors = {"A": {"output": {"amount": 5000, "country": "XX"}}}
    c.expect = {"status": "completed", "visited": ["A", "Next"], "data": {"flags": ["large-amount", "high-risk-country"]}}
    cases.append(c)

    c = Case("decision-outputs-become-token-data", "decision", "5.5.3", "The outputs of the deciding rule are merged into the token's data, where later conditions can use them.")
    c.act("A").act("B").act("Fast").act("Slow")
    table(c, "D", "first", [("amount", "number")], [(["< 100"], ["express", 1], "B", None), (["-"], ["standard", 5], "B", None)],
          outputs=(("lane", "string"), ("days", "number")))
    c.edge("A", "D").edge("D", "B").edge("B", "Fast", condition="lane == express").edge("B", "Slow", is_default=True)
    c.actors = {"A": {"output": {"amount": 20}}}
    c.expect = {"status": "completed", "visited": ["A", "B", "Fast"], "data": {"lane": "express", "days": 1}}
    cases.append(c)

    c = Case("decision-chained-decisions", "decision", "5.5.3", "One decision can feed another directly: the second reads what the first derived.")
    c.act("A").act("Approve").act("Refer")
    table(c, "Band", "first", [("score", "number")], [([">= 700"], ["A"], "Outcome", None), (["[600..700)"], ["B"], "Outcome", None), (["-"], ["C"], "Outcome", None)],
          outputs=(("band", "string"),))
    table(c, "Outcome", "first", [("band", "string"), ("amount", "number")],
          [(['"A"', "-"], ["approve"], "Approve", None), (['"B"', "< 5000"], ["approve"], "Approve", None), (["-", "-"], ["refer"], "Refer", None)])
    c.edge("A", "Band").edge("Band", "Outcome").edge("Outcome", "Approve").edge("Outcome", "Refer")
    c.actors = {"A": {"output": {"score": 640, "amount": 9000}}}
    c.expect = {"status": "completed", "visited": ["A", "Refer"], "data": {"band": "B", "route": "refer"}}
    cases.append(c)

    c = Case("decision-entries-combine", "decision", "5.5.1", "An entry may list alternatives separated by commas, and may negate a list with not(...).")
    c.act("A").act("Eu").act("Other")
    table(c, "D", "first", [("country", "string"), ("age", "number")],
          [(['"FR", "DE", "LU"', "not(< 18, > 99)"], ["eu"], "Eu", None), (["-", "-"], ["other"], "Other", None)])
    c.edge("A", "D").edge("D", "Eu").edge("D", "Other")
    c.actors = {"A": {"output": {"country": "LU", "age": 40}}}
    c.expect = {"status": "completed", "visited": ["A", "Eu"]}
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
    c.act("A").event("Await payment", "conditional").act("B").edge("A", "Await payment").edge("Await payment", "B")
    c.expect = {"status": "failed", "visited": ["A"], "error_matches": "cannot execute"}
    cases.append(c)

    # ---- business events (section 18) -------------------------------------
    c = Case("event-wait-and-receive", "events", "18.2", "A token at a message event waits; an event with the right name and correlation continues it, and the event's data joins the token's data.")
    c.act("Ask").event("Reply", "message", name="customer.replied", correlation_key="case_id").act("Yes").act("No")
    c.edge("Ask", "Reply").edge("Reply", "Yes", condition="answer == yes").edge("Reply", "No", is_default=True)
    c.actors = {"Ask": {"output": {"case_id": "C-1"}}}
    c.deliver = [{"event": {"type": "customer.replied", "data": {"case_id": "OTHER", "answer": "no"}}, "resumes": 0},
                 {"event": {"type": "customer.replied", "data": {"case_id": "C-1", "answer": "yes"}}, "resumes": 1}]
    c.expect = {"status": "completed", "visited": ["Ask", "Yes"], "data": {"answer": "yes"},
                "journal": ["event.waiting", "run.waiting", "event.received", "run.completed"]}
    cases.append(c)

    c = Case("event-redelivery-ignored", "events", "18.2", "An event id a run has consumed is ignored when delivered again.")
    c.act("A").event("First", "message", name="ping").act("B").event("Second", "message", name="ping").act("C")
    c.edge("A", "First").edge("First", "B").edge("B", "Second").edge("Second", "C")
    c.deliver = [{"event": {"id": "evt-1", "type": "ping"}, "resumes": 1}, {"event": {"id": "evt-1", "type": "ping"}, "resumes": 0},
                 {"event": {"id": "evt-2", "type": "ping"}, "resumes": 1}]
    c.expect = {"status": "completed", "visited": ["A", "B", "C"]}
    cases.append(c)

    c = Case("event-timeout-takes-timeout-edge", "events", "18.3", "When the wait runs out the token takes the event's timeout edge, which ordinary routing never takes.")
    c.act("Ask").event("Reply", "message", name="customer.replied", timeout="P3D", timeout_edge_id=c.u("Reply->Chase")).act("Proceed").act("Chase")
    c.edge("Ask", "Reply").edge("Reply", "Proceed").edge("Reply", "Chase")
    c.deliver = [{"expire": True}]
    c.expect = {"status": "completed", "visited": ["Ask", "Chase"], "not_visited": ["Proceed"], "journal": ["event.waiting", "event.timed_out", "token.moved"]}
    cases.append(c)

    c = Case("event-received-in-time-skips-timeout-edge", "events", "18.3", "An event that arrives in time continues along the ordinary edge only.")
    c.act("Ask").event("Reply", "message", name="customer.replied", timeout="P3D", timeout_edge_id=c.u("Reply->Chase")).act("Proceed").act("Chase")
    c.edge("Ask", "Reply").edge("Reply", "Proceed").edge("Reply", "Chase")
    c.deliver = [{"event": {"type": "customer.replied"}, "resumes": 1}]
    c.expect = {"status": "completed", "visited": ["Ask", "Proceed"], "not_visited": ["Chase"]}
    cases.append(c)

    c = Case("event-timeout-without-edge-fails", "events", "18.3", "A wait that runs out with no timeout edge fails the token.")
    c.act("Ask").event("Reply", "message", name="customer.replied", timeout="PT1H").act("Proceed")
    c.edge("Ask", "Reply").edge("Reply", "Proceed")
    c.deliver = [{"expire": True}]
    c.expect = {"status": "failed", "visited": ["Ask"], "error_matches": "customer.replied"}
    cases.append(c)

    c = Case("signal-reaches-every-waiting-token", "events", "18.2", "A signal continues every token waiting for it; it has no correlation.")
    c.act("A").event("Go 1", "signal", name="market.opened").event("Go 2", "signal", name="market.opened").act("B").act("C")
    c.edge("A", "Go 1").edge("A", "Go 2").edge("Go 1", "B").edge("Go 2", "C")
    c.deliver = [{"event": {"type": "market.opened"}, "resumes": 2}]
    c.expect = {"status": "completed", "visited_unordered": ["A", "B", "C"]}
    cases.append(c)

    c = Case("event-published-to-journal", "events", "18.4", "A message event in publish mode records the event, with the listed data only, and the token continues.")
    c.act("Settle").event("Settled", "message", name="claim.settled", mode="publish", data=["claim_id"]).act("Close")
    c.edge("Settle", "Settled").edge("Settled", "Close")
    c.actors = {"Settle": {"output": {"claim_id": "C-9", "internal": "x"}}}
    c.expect = {"status": "completed", "visited": ["Settle", "Close"],
                "journal_contains": [{"type": "event.published", "data": {"name": "claim.settled", "data": {"claim_id": "C-9"}}}]}
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


# ---------------------------------------------------------------------------
# Tools (section 17) and model decisions (section 16)
# ---------------------------------------------------------------------------

def tool_cases() -> list[Case]:
    cases = []

    def tool(name, **extra):
        return {"name": name, "description": f"The {name} tool", "parameters": {"type": "object", "properties": {"q": {"type": "string"}}},
                "binding": {"kind": "function", "name": name}, **extra}

    c = Case("tool-call-is-journalled", "tools", "17.3", "A tool call is recorded before it runs and when it returns, with the link to what ran, between the start and the end of its activity.")
    c.act("A", tools=[tool("lookup")])
    c.actors = {"A": {"calls": [{"tool": "lookup", "arguments": {"q": "POL-1"}}], "output": {"done": True}}}
    c.tools = {"lookup": {"result": {"found": True}}}
    c.expect = {"status": "completed", "journal": ["activity.started", "tool.invoked", "tool.completed", "activity.completed"],
                "journal_contains": [{"type": "tool.invoked", "node_name": "A", "data": {"tool": "lookup", "link": "function:lookup", "arguments": {"q": "POL-1"}}},
                                     {"type": "tool.completed", "node_name": "A", "data": {"tool": "lookup", "link": "function:lookup", "result": {"found": True}}}]}
    cases.append(c)

    c = Case("tool-failure-does-not-fail-activity", "tools", "17.3", "A call that fails is journalled as tool.failed and returned to the actor; it does not fail the activity by itself.")
    c.act("A", tools=[tool("lookup")]).act("B").edge("A", "B")
    c.actors = {"A": {"calls": [{"tool": "lookup", "arguments": {"q": "x"}}], "output": {"done": True}}}
    c.tools = {"lookup": {"error": "backend down"}}
    c.expect = {"status": "completed", "visited": ["A", "B"], "journal": ["tool.invoked", "tool.failed", "activity.completed"],
                "journal_contains": [{"type": "tool.failed", "data": {"tool": "lookup", "invoked": True, "error": {"message": "backend down"}}}]}
    cases.append(c)

    c = Case("unknown-tool-is-refused", "tools", "17.3", "A call to a tool the activity does not declare is refused before anything runs.")
    c.act("A", tools=[tool("lookup")])
    c.actors = {"A": {"calls": [{"tool": "delete_everything", "arguments": {}}], "output": {}}}
    c.tools = {"lookup": {"result": {}}, "delete_everything": {"result": {"deleted": True}}}
    c.expect = {"status": "completed", "journal_contains": [{"type": "tool.failed", "data": {"tool": "delete_everything", "invoked": False, "error": {"code": "UNKNOWN_TOOL"}}}],
                "journal_excludes": ["tool.invoked", "tool.completed"]}
    cases.append(c)

    c = Case("invalid-arguments-are-refused", "tools", "17.3", "Arguments that do not match the tool's parameters are refused; nothing runs.")
    c.act("A", tools=[tool("lookup", parameters={"type": "object", "required": ["q"], "properties": {"q": {"type": "string"}}})])
    c.actors = {"A": {"calls": [{"tool": "lookup", "arguments": {"q": 42}}], "output": {}}}
    c.tools = {"lookup": {"result": {"found": True}}}
    c.expect = {"status": "completed", "journal_contains": [{"type": "tool.failed", "data": {"tool": "lookup", "invoked": False, "error": {"code": "VALIDATION_ERROR"}}}],
                "journal_excludes": ["tool.invoked", "tool.completed"]}
    cases.append(c)

    c = Case("tool-call-budget-is-enforced", "tools", "17.3", "A call beyond the activity's budget of tool calls is refused.")
    c.act("A", tools=[tool("lookup")], outcome_contract={"postconditions": [], "budgets": {"max_tool_calls": 1}})
    c.actors = {"A": {"calls": [{"tool": "lookup", "arguments": {"q": "1"}}, {"tool": "lookup", "arguments": {"q": "2"}}], "output": {}}}
    c.tools = {"lookup": {"result": {"found": True}}}
    c.expect = {"status": "completed", "journal": ["tool.invoked", "tool.completed", "tool.failed"],
                "journal_contains": [{"type": "tool.failed", "data": {"invoked": False, "error": {"code": "TOOL_BUDGET_EXCEEDED"}}}],
                "journal_count": {"tool.invoked": 1}}
    cases.append(c)

    c = Case("command-needs-permission", "tools", "17.4", "A command binding does not run unless the deployment allows commands. The default is to allow none.")
    c.act("A", tools=[{"name": "shell", "description": "Run a program", "parameters": {"type": "object", "properties": {}}, "binding": {"kind": "command", "command": "echo", "args": ["hello"]}}])
    c.actors = {"A": {"calls": [{"tool": "shell", "arguments": {}}], "output": {}}}
    c.expect = {"status": "completed", "journal_contains": [{"type": "tool.failed", "data": {"tool": "shell", "invoked": False, "error": {"code": "PERMISSION_DENIED"}}}],
                "journal_excludes": ["tool.invoked"]}
    cases.append(c)

    c = Case("two-tools-same-name-rejected-call-order-kept", "tools", "17.5", "Several calls in one activity are recorded in the order they were made, each tied together by its call_id.")
    c.act("A", tools=[tool("first"), tool("second")])
    c.actors = {"A": {"calls": [{"tool": "first", "arguments": {"q": "a"}}, {"tool": "second", "arguments": {"q": "b"}}], "output": {}}}
    c.tools = {"first": {"result": 1}, "second": {"result": 2}}
    c.expect = {"status": "completed", "journal": ["tool.invoked", "tool.completed", "tool.invoked", "tool.completed"],
                "journal_contains": [{"type": "tool.completed", "data": {"tool": "first", "result": 1}}, {"type": "tool.completed", "data": {"tool": "second", "result": 2}}],
                "journal_count": {"tool.invoked": 2, "tool.completed": 2}}
    c.id = "tool-calls-keep-their-order"
    cases.append(c)
    return cases


def model_decision_cases() -> list[Case]:
    cases = []

    def triage(case_id, spec, description, table=False, default=True, **model):
        c = Case(case_id, "model_decision", spec, description)
        c.act("Intake").act("Pay").act("Review").act("Manual").edge("Intake", "Triage")
        c.edge("Triage", "Pay").edge("Triage", "Review").edge("Triage", "Manual")
        node = {"id": c.u("Triage"), "name": "Triage", "description": "Route the claim.",
                "decision_model": {"model": "tier:fast", "instructions": "Pay simple claims. Send anything unusual to review.",
                                   "options": [{"id": "pay", "description": "Simple and covered", "output_edge_id": c.u("Triage->Pay")},
                                               {"id": "review", "description": "Unusual or unclear", "output_edge_id": c.u("Triage->Review")}],
                                   "inputs": ["amount"], **model}}
        if table:
            node["decision_table"] = {"hit_policy": "first", "inputs": [{"name": "amount", "type": "number"}], "outputs": [{"name": "route", "type": "string"}],
                                      "rules": [{"input_entries": ["< 100"], "output_entries": ["pay"], "output_edge_id": c.u("Triage->Pay")}]}
        if default:
            node["default_output_edge_id"] = c.u("Triage->Manual")
        c.decisions.append(node)
        c.actors = {"Intake": {"output": {"amount": 900}}}
        return c
    vote = lambda option, confidence=0.9: {"option": option, "confidence": confidence, "rationale": "Because."}

    c = triage("model-chooses-an-option", "16.4", "The model picks one of the enumerated options and the token takes that option's edge. The decision, its rationale and the model that served are journalled.")
    c.model = {"replies": [vote("review", 0.82)]}
    c.expect = {"status": "completed", "visited": ["Intake", "Review"], "model_calls": 1,
                "journal": ["meta.recorded", "reasoning.recorded", "decision.evaluated"],
                "journal_contains": [{"type": "decision.evaluated", "node_name": "Triage", "data": {"method": "model", "model": {"option": "review", "confidence": 0.82}}},
                                     {"type": "reasoning.recorded", "data": {"source": "decision_model", "rationale": "Because."}},
                                     {"type": "meta.recorded", "data": {"subject": "model_selection"}}]}
    cases.append(c)

    c = triage("table-first-rule-decides-without-model", "16.2", "With table_first, a rule that matches decides and no model is called.", table=True)
    c.actors = {"Intake": {"output": {"amount": 40}}}
    c.model = {"replies": [vote("review")]}
    c.expect = {"status": "completed", "visited": ["Intake", "Pay"], "model_calls": 0, "journal_contains": [{"type": "decision.evaluated", "data": {"method": "table"}}]}
    cases.append(c)

    c = triage("table-first-asks-model-when-no-rule-matches", "16.2", "With table_first, the model is asked only for the cases no rule covers.", table=True)
    c.model = {"replies": [vote("review")]}
    c.expect = {"status": "completed", "visited": ["Intake", "Review"], "model_calls": 1, "journal_contains": [{"type": "decision.evaluated", "data": {"method": "model"}}]}
    cases.append(c)

    c = triage("strategy-model-ignores-the-table", "16.2", "With strategy model, the model decides even where a rule would match.", table=True, strategy="model")
    c.actors = {"Intake": {"output": {"amount": 40}}}
    c.model = {"replies": [vote("review")]}
    c.expect = {"status": "completed", "visited": ["Intake", "Review"], "model_calls": 1}
    cases.append(c)

    c = triage("option-not-offered-is-no-decision", "16.3", "A reply naming an option that was not offered is an invalid vote. The token takes the default edge; the engine never invents a route.")
    c.model = {"replies": [vote("refund")]}
    c.expect = {"status": "completed", "visited": ["Intake", "Manual"], "journal_contains": [{"type": "decision.evaluated", "data": {"method": "default"}}]}
    cases.append(c)

    c = triage("no-decision-without-default-fails", "16.4", "On no decision, a node without a default edge fails its token with NO_ROUTE.", default=False)
    c.model = {"replies": [vote("refund")]}
    c.expect = {"status": "failed", "visited": ["Intake"], "error_matches": "no default path", "journal_contains": [{"type": "decision.evaluated", "data": {"method": "none"}}]}
    cases.append(c)

    c = triage("below-min-confidence-is-no-decision", "16.3", "A decision whose confidence is below min_confidence is no decision.", min_confidence=0.7)
    c.model = {"replies": [vote("pay", 0.5)]}
    c.expect = {"status": "completed", "visited": ["Intake", "Manual"], "journal_contains": [{"type": "decision.evaluated", "data": {"method": "default", "model": {"min_confidence": 0.7}}}]}
    cases.append(c)

    c = triage("unreachable-model-is-no-decision", "16.3", "A model that cannot be reached casts an invalid vote; the run does not fail for it when a default edge exists.")
    c.model = {"replies": [{"error": "connection refused"}]}
    c.expect = {"status": "completed", "visited": ["Intake", "Manual"]}
    cases.append(c)

    c = triage("loose-reply-names-one-option", "16.3", "A reply that is not JSON still counts if exactly one option id appears in it. Such a vote has no confidence.")
    c.model = {"replies": [{"text": "I would send this one to review."}]}
    c.expect = {"status": "completed", "visited": ["Intake", "Review"]}
    cases.append(c)

    c = triage("loose-reply-without-confidence-fails-min-confidence", "16.3", "A vote with no stated confidence is no decision when min_confidence is above 0.", min_confidence=0.5)
    c.model = {"replies": [{"text": "review"}]}
    c.expect = {"status": "completed", "visited": ["Intake", "Manual"]}
    cases.append(c)

    c = triage("reply-naming-two-options-is-invalid", "16.3", "A reply in which more than one option id appears is an invalid vote.")
    c.model = {"replies": [{"text": "Either pay or review would do."}]}
    c.expect = {"status": "completed", "visited": ["Intake", "Manual"]}
    cases.append(c)

    c = triage("majority-of-votes-decides", "16.3", "With several votes, the option with a strict majority of all votes cast is the decision.", votes=3)
    c.model = {"replies": [vote("review"), vote("pay"), vote("review")]}
    c.expect = {"status": "completed", "visited": ["Intake", "Review"], "model_calls": 3}
    cases.append(c)

    c = triage("no-majority-is-no-decision", "16.3", "Invalid votes count among the votes cast: one vote each for two options and one invalid vote give no strict majority.", votes=3)
    c.model = {"replies": [vote("review"), vote("pay"), {"text": "I cannot tell."}]}
    c.expect = {"status": "completed", "visited": ["Intake", "Manual"], "model_calls": 3}
    cases.append(c)

    c = triage("chosen-option-is-written-to-data", "16.1", "With output, the id of the chosen option is written to the token's data for later nodes.", output="route")
    c.model = {"replies": [vote("pay")]}
    c.expect = {"status": "completed", "visited": ["Intake", "Pay"], "data": {"route": "pay"}}
    cases.append(c)
    return cases


# ---------------------------------------------------------------------------
# Model routing (section 12)
# ---------------------------------------------------------------------------

def routing_cases() -> list[Case]:
    cases = []

    def routed(case_id, spec, description, model="tier:fast", default=True):
        c = Case(case_id, "routing", spec, description)
        c.act("Intake").act("Pay").act("Review").act("Manual").edge("Intake", "Triage")
        c.edge("Triage", "Pay").edge("Triage", "Review").edge("Triage", "Manual")
        node = {"id": c.u("Triage"), "name": "Triage", "description": "Route the claim.",
                "decision_model": {"model": model, "instructions": "Pay simple claims. Send anything unusual to review.",
                                   "options": [{"id": "pay", "description": "Simple and covered", "output_edge_id": c.u("Triage->Pay")},
                                               {"id": "review", "description": "Unusual or unclear", "output_edge_id": c.u("Triage->Review")}],
                                   "inputs": ["amount"]}}
        if default:
            node["default_output_edge_id"] = c.u("Triage->Manual")
        c.decisions.append(node)
        c.actors = {"Intake": {"output": {"amount": 900}}}
        return c
    serves = lambda provider, option: {"id": provider, "replies": [{"option": option, "confidence": 0.9, "rationale": "Because."}]}
    fails = lambda provider, error, code=None: {"id": provider, "error": error, **({"code": code} if code else {})}
    selection = lambda *names: {"event": {"type": "meta.recorded", "node_name": "Triage", "data": {"subject": "model_selection"}}, "mentions": list(names)}
    route = lambda *names: {"event": {"type": "meta.recorded", "node_name": "Triage", "data": {"subject": "model_route"}}, "mentions": list(names)}

    c = routed("tier-first-candidate-serves", "12.5", "A tier maps to an ordered list of models. The first candidate is called; while it serves, no other is. The journal names the provider, the model and the tier.")
    c.model = {"providers": [serves("primary", "review"), serves("backup", "pay")], "tiers": {"fast": ["primary:alpha", "backup:beta"]}}
    c.expect = {"status": "completed", "visited": ["Intake", "Review"], "model_calls": 1, "provider_calls": {"primary": 1, "backup": 0},
                "journal": ["meta.recorded", "decision.evaluated"],
                "journal_contains": [{"type": "decision.evaluated", "node_name": "Triage", "data": {"method": "model", "model": {"option": "review"}}}],
                "journal_mentions": [selection("primary", "alpha", "fast")]}
    cases.append(c)

    c = routed("tier-falls-back-to-next-candidate", "12.5", "When the first candidate's provider fails, the router tries the next in the tier's list and stops at the one that serves. The model that actually served is journalled as the selection, and the fallback as a model_route naming the candidate that failed.")
    c.model = {"providers": [fails("primary", "quota exhausted", "RATE_LIMITED"), serves("backup", "review"), serves("last", "pay")],
               "tiers": {"fast": ["primary:alpha", "backup:beta", "last:gamma"]}}
    c.expect = {"status": "completed", "visited": ["Intake", "Review"], "model_calls": 2, "provider_calls": {"primary": 1, "backup": 1, "last": 0},
                "journal_contains": [{"type": "decision.evaluated", "node_name": "Triage", "data": {"method": "model", "model": {"option": "review"}}}],
                "journal_mentions": [selection("backup", "beta", "fast"), route("primary", "alpha")]}
    cases.append(c)

    c = routed("tier-every-candidate-fails-takes-default", "12.5", "When no candidate serves the request the router fails with the whole route. At a decision that is no decision: the token takes the default edge, and the route naming every candidate that failed is journalled.")
    c.model = {"providers": [fails("primary", "quota exhausted", "RATE_LIMITED"), fails("backup", "connection refused")],
               "tiers": {"fast": ["primary:alpha", "backup:beta"]}}
    c.expect = {"status": "completed", "visited": ["Intake", "Manual"], "model_calls": 2, "provider_calls": {"primary": 1, "backup": 1},
                "journal_contains": [{"type": "decision.evaluated", "node_name": "Triage", "data": {"method": "default"}}],
                "journal_mentions": [route("primary", "alpha", "backup", "beta")]}
    cases.append(c)

    c = routed("tier-every-candidate-fails-without-default", "12.5", "When no candidate serves and the decision has no default edge, the token fails with NO_ROUTE. The engine does not pick an option for the model.", default=False)
    c.model = {"providers": [fails("primary", "quota exhausted", "RATE_LIMITED"), fails("backup", "connection refused")],
               "tiers": {"fast": ["primary:alpha", "backup:beta"]}}
    c.expect = {"status": "failed", "visited": ["Intake"], "provider_calls": {"primary": 1, "backup": 1},
                "journal_contains": [{"type": "decision.evaluated", "node_name": "Triage", "data": {"method": "none"}},
                                     {"type": "token.failed", "data": {"error": {"code": "NO_ROUTE"}}}],
                "journal_mentions": [route("primary", "alpha", "backup", "beta")]}
    cases.append(c)

    c = routed("invalid-request-stops-the-route", "12.5", "A provider that rejects the request as invalid ends the route: the request would be invalid for the next candidate too, so it is not tried.")
    c.model = {"providers": [fails("primary", "the request is malformed", "VALIDATION_ERROR"), serves("backup", "review")],
               "tiers": {"fast": ["primary:alpha", "backup:beta"]}}
    c.expect = {"status": "completed", "visited": ["Intake", "Manual"], "provider_calls": {"primary": 1, "backup": 0},
                "journal_contains": [{"type": "decision.evaluated", "node_name": "Triage", "data": {"method": "default"}}],
                "journal_mentions": [route("primary", "alpha")]}
    cases.append(c)

    c = routed("unregistered-candidate-is-left-out", "12.5", "A candidate whose provider is not registered in this deployment is left out of the route, so one tier map serves deployments with different providers.")
    c.model = {"providers": [serves("local", "review")], "tiers": {"fast": ["cloud:big", "local:small"]}}
    c.expect = {"status": "completed", "visited": ["Intake", "Review"], "provider_calls": {"local": 1},
                "journal_mentions": [selection("local", "small", "fast")]}
    cases.append(c)

    c = routed("direct-reference-names-provider-and-model", "12.1", "A reference of the form <provider>:<model> names a specific model of a registered provider. It has one candidate; no tier and no other provider is involved.", model="backup:beta")
    c.model = {"providers": [serves("primary", "pay"), serves("backup", "review")], "tiers": {"fast": ["primary:alpha"]}}
    c.expect = {"status": "completed", "visited": ["Intake", "Review"], "provider_calls": {"primary": 0, "backup": 1},
                "journal_mentions": [selection("backup", "beta")]}
    cases.append(c)

    c = routed("direct-reference-is-not-substituted", "12.3", "A model named directly has one candidate. When its provider fails no other model is substituted, although another provider could have served.", model="primary:alpha")
    c.model = {"providers": [fails("primary", "connection refused"), serves("backup", "review")], "tiers": {"fast": ["backup:beta"]}}
    c.expect = {"status": "completed", "visited": ["Intake", "Manual"], "provider_calls": {"primary": 1, "backup": 0},
                "journal_contains": [{"type": "decision.evaluated", "node_name": "Triage", "data": {"method": "default"}}],
                "journal_mentions": [route("primary", "alpha")]}
    cases.append(c)

    c = routed("bare-model-name-uses-default-provider", "12.1", "A reference with no provider is a model of the engine's default provider.", model="alpha")
    c.model = {"providers": [serves("primary", "review"), serves("backup", "pay")]}
    c.expect = {"status": "completed", "visited": ["Intake", "Review"], "provider_calls": {"primary": 1, "backup": 0},
                "journal_mentions": [selection("primary", "alpha")]}
    cases.append(c)

    c = routed("colon-without-registered-provider-is-a-model-name", "12.1", "The part before the first colon is a provider only if one is registered under that name. Otherwise the whole string is a model name of the default provider.", model="ft:custom")
    c.model = {"providers": [serves("primary", "review"), serves("backup", "pay")]}
    c.expect = {"status": "completed", "visited": ["Intake", "Review"], "provider_calls": {"primary": 1, "backup": 0},
                "journal_mentions": [selection("primary", "ft:custom")]}
    cases.append(c)

    c = routed("deployment-defined-tier", "12.2", "A deployment may define tiers beyond the three standard ones, and a tier may map to a single model.", model="tier:legal")
    c.model = {"providers": [serves("primary", "pay"), serves("backup", "review")], "tiers": {"fast": ["primary:alpha"], "legal": ["backup:beta"]}}
    c.expect = {"status": "completed", "visited": ["Intake", "Review"], "provider_calls": {"primary": 0, "backup": 1},
                "journal_mentions": [selection("backup", "beta", "legal")]}
    cases.append(c)
    return cases


# ---------------------------------------------------------------------------
# Knowledge (section 15)
# ---------------------------------------------------------------------------

def knowledge_cases() -> list[dict]:
    cases = []
    TERM = {"name": "Total is a number", "expression": "typeof total == number"}
    good = {"output": {"total": 40}, "reasoning": {"plan": ["look up the price list", "sum the lines"], "rationale": "Prices come from the list, not from memory.",
                                                   "alternatives_considered": ["estimate"], "confidence": 0.9}}
    bad = {"output": {"total": "forty"}, "reasoning": {"plan": ["estimate"], "rationale": "From memory.", "confidence": 0.3}}
    clean, corrected = {"Price order": good}, {"Price order": {"attempts": [bad, good]}}
    strategy = {"type": "strategy", "node": "Price order"}
    failure = {"type": "failure_pattern", "node": "Price order"}

    def orders(case_id, binding={}, terms=(TERM,)):
        """An AI agent prices an order under a contract; an application ships it."""
        c = Case(case_id, "knowledge", "15", "")
        extra = {} if binding is None else {"knowledge": binding}
        c.act("Price order", "ai_agent", outcome_contract={"postconditions": list(terms), "budgets": {"max_attempts": 3}}, **extra)
        c.act("Ship").edge("Price order", "Ship")
        return c.build()["workflow"]
    def run(name, actors, **expect):
        return {"run": name, "actors": actors, "expect": {"status": "completed", **expect}}
    def review(entry, by="ana"):
        return {"review": entry, "by": by}
    def emit(case_id, spec, description, steps, expect, workflow=None):
        cases.append({"id": case_id, "level": "knowledge", "spec": spec, "description": description,
                      "workflow": workflow or orders(case_id), "steps": steps, "expect": expect})

    emit("accepted-outcome-yields-a-strategy", "15.1", "The reasoning an AI agent reported with an accepted outcome is distilled into a strategy about that activity. A new entry is a draft, with one observation and its run as the source.",
         [run("first", clean), {"ingest": "first"}],
         {"entry_count": 1, "entries": [{**strategy, "status": "draft", "observations": 1, "sources": 1}]})

    emit("rejected-attempt-yields-a-failure-pattern", "15.1", "An attempt whose outcome was rejected, followed by one that was accepted, yields a failure pattern beside the strategy. Both are about the activity.",
         [run("first", corrected), {"ingest": "first"}],
         {"entry_count": 2, "entries": [{**strategy, "status": "draft", "observations": 1}, {**failure, "status": "draft", "observations": 1, "sources": 1}]})

    emit("ingesting-a-run-twice-counts-it-once", "15.3", "Ingesting is idempotent: a run that was already ingested changes nothing.",
         [run("first", corrected), {"ingest": "first"}, {"ingest": "first"}],
         {"entry_count": 2, "entries": [{**strategy, "observations": 1, "sources": 1}, {**failure, "observations": 1, "sources": 1}]})

    emit("second-run-adds-an-observation", "15.3", "A second run that exhibits the same patterns produces the same ids: each entry gains an observation and a source, and no entry is created.",
         [run("first", corrected), {"ingest": "first"}, run("second", corrected), {"ingest": "second"}],
         {"entry_count": 2, "entries": [{**strategy, "status": "draft", "observations": 2, "sources": 2}, {**failure, "status": "draft", "observations": 2, "sources": 2}]})

    two_terms = (TERM, {"name": "Currency is stated", "expression": "currency exists"})
    priced = {"output": {"total": 40, "currency": "EUR"}, "reasoning": good["reasoning"]}
    emit("different-failures-are-different-entries", "15.2", "A failure pattern is identified by the terms it failed, not by the run. Two runs that fail different terms of the same activity yield two failure patterns, while the strategy they share compounds.",
         [run("first", {"Price order": {"attempts": [{"output": {"total": "forty", "currency": "EUR"}, "reasoning": bad["reasoning"]}, priced]}}), {"ingest": "first"},
          run("second", {"Price order": {"attempts": [{"output": {"total": 40}, "reasoning": bad["reasoning"]}, priced]}}), {"ingest": "second"}],
         {"entry_count": 3, "entries": [{**strategy, "observations": 2}, {**failure, "observations": 1, "count": 2}]},
         workflow=orders("different-failures-are-different-entries", terms=two_terms))

    emit("unreviewed-entry-is-not-given-reviewed-is", "15.4", "A draft entry is not given to an actor. Once a person has reviewed it, the actor of the activity it is about is given it, and the journal records knowledge.retrieved listing it. The review records who made it.",
         [run("first", clean), {"ingest": "first"},
          run("before review", clean, given={"Price order": []}),
          review(strategy),
          run("after review", clean, given={"Price order": [{**strategy, "status": "reviewed"}]},
              journal_contains=[{"type": "knowledge.retrieved", "node_name": "Price order", "data": {"entries": [{"type": "strategy", "status": "reviewed", "observations": 1}]}}])],
         {"entry_count": 1, "entries": [{**strategy, "status": "reviewed", "observations": 1, "reviewed_by": "ana"}]})

    emit("draft-is-given-when-the-binding-admits-it", "15.4", "A binding with min_status draft also admits unreviewed entries.",
         [run("first", clean), {"ingest": "first"}, run("second", clean, given={"Price order": [{**strategy, "status": "draft"}]})],
         {"entry_count": 1, "entries": [{**strategy, "status": "draft"}]},
         workflow=orders("draft-is-given-when-the-binding-admits-it", binding={"min_status": "draft"}))

    emit("reviewed-entry-stays-reviewed-as-evidence-accrues", "15.3", "Evidence from a later run adds to a reviewed entry without changing its status.",
         [run("first", clean), {"ingest": "first"}, review(strategy), run("second", clean), {"ingest": "second"}],
         {"entry_count": 1, "entries": [{**strategy, "status": "reviewed", "observations": 2, "sources": 2, "reviewed_by": "ana"}]})

    emit("deprecated-entry-is-never-given", "15.4", "A deprecated entry is not given to an actor, even by a binding that admits drafts.",
         [run("first", clean), {"ingest": "first"}, review(strategy), {"deprecate": strategy}, run("second", clean, given={"Price order": []})],
         {"entry_count": 1, "entries": [{**strategy, "status": "deprecated"}]},
         workflow=orders("deprecated-entry-is-never-given", binding={"min_status": "draft"}))

    emit("no-binding-no-knowledge", "15.4", "An activity without a knowledge binding receives no knowledge, although a reviewed entry about it exists.",
         [run("first", clean), {"ingest": "first"}, review(strategy), run("second", clean, given={"Price order": []})],
         {"entry_count": 1, "entries": [{**strategy, "status": "reviewed"}]},
         workflow=orders("no-binding-no-knowledge", binding=None))

    emit("reviewed-entries-are-given-first", "15.4", "Matching entries are given reviewed first, then by observations: a reviewed failure pattern seen once comes before a draft strategy seen twice.",
         [run("first", corrected), {"ingest": "first"}, run("second", clean), {"ingest": "second"}, review(failure),
          run("third", clean, given={"Price order": [{**failure, "status": "reviewed", "observations": 1}, {**strategy, "status": "draft", "observations": 2}]})],
         {"entry_count": 2},
         workflow=orders("reviewed-entries-are-given-first", binding={"min_status": "draft"}))

    emit("failed-run-yields-a-lesson", "15.1", "A run that fails yields a lesson. The errored attempt that caused it is also a failure pattern about its activity.",
         [{"run": "first", "actors": {**clean, "Ship": {"error": "carrier unavailable", "code": "UNAVAILABLE"}}, "expect": {"status": "failed"}}, {"ingest": "first"}],
         {"entry_count": 3, "entries": [{**strategy, "observations": 1}, {"type": "failure_pattern", "node": "Ship", "status": "draft", "observations": 1},
                                        {"type": "lesson", "status": "draft", "observations": 1, "sources": 1}]})

    c = Case("decision-evaluation-yields-a-precedent", "knowledge", "15.1", "")
    c.act("Intake").act("Pay").act("Review").edge("Intake", "Route").edge("Route", "Pay").edge("Route", "Review")
    c.decision("Route", "first", [("amount", "number")], [(["< 100"], "Pay"), (["-"], "Review")])
    emit(c.id, "15.1", "A decision evaluation is distilled into a decision precedent about the decision node. A run that matches another rule yields another precedent.",
         [run("small", {"Intake": {"output": {"amount": 40}}}), {"ingest": "small"}, run("small again", {"Intake": {"output": {"amount": 60}}}), {"ingest": "small again"},
          run("large", {"Intake": {"output": {"amount": 900}}}), {"ingest": "large"}],
         {"entry_count": 2, "entries": [{"type": "decision_precedent", "node": "Route", "status": "draft", "observations": 2},
                                        {"type": "decision_precedent", "node": "Route", "status": "draft", "observations": 1}]},
         workflow=c.build()["workflow"])
    return cases


# ---------------------------------------------------------------------------
# Counterfactual replay (section 20)
# ---------------------------------------------------------------------------

def replay_cases() -> list[dict]:
    cases = []

    def flow(case_id):
        c = Case(case_id, "replay", "20", "")
        c.act("Collect").act("Assess", "ai_agent").act("Approve").act("Escalate")
        c.edge("Collect", "Assess").edge("Assess", "Approve", condition="score >= 5").edge("Assess", "Escalate", is_default=True)
        return c
    def emit(case_id, spec, description, baseline, candidate=None, ai="recorded", candidate_actors=None, expect=None):
        case = {"id": case_id, "level": "replay", "spec": spec, "description": description, "workflow": baseline.build()["workflow"], "input": {"claim": 1},
                "actors": baseline.actors, "ai": ai}
        if candidate is not None:
            case["candidate"] = candidate
        if candidate_actors:
            case["candidate_actors"] = candidate_actors
        case["expect"] = expect
        cases.append(case)
    world = {"Collect": {"output": {"documents": 3}}, "Assess": {"output": {"score": 7}}, "Approve": {"output": {"approved": True}}}

    b = flow("replay-unchanged-is-identical"); b.actors = world
    emit(b.id, "20.1", "Replaying a run with nothing changed and AI outputs recorded reproduces it: same status, same path, every node the same.", b,
         expect={"baseline_status": "completed", "candidate_status": "completed", "same_path": True, "regressions": 0,
                 "verdicts": {"Collect": "same", "Assess": "same", "Approve": "same"}, "unrecorded": 0})

    b = flow("replay-tightened-contract-regresses"); b.actors = world
    cand = flow(b.id); cand.activities[1]["outcome_contract"] = {"postconditions": [{"name": "High confidence", "expression": "score >= 9"}], "on_violation": "fail"}
    emit(b.id, "20.3", "A contract tightened in the candidate is tested against the recorded AI output, with no model at all. The node that no longer passes is a regression, and so is the run.", b,
         candidate=cand.build()["workflow"],
         expect={"baseline_status": "completed", "candidate_status": "failed", "verdicts": {"Collect": "same", "Assess": "regressed"}, "regressions_at_least": 1, "unrecorded": 0})

    b = flow("replay-changed-rule-diverges"); b.actors = world
    cand = flow(b.id); cand.edges[1]["condition"] = "score >= 8"
    emit(b.id, "20.2", "A changed routing rule sends the candidate to an activity the baseline never performed. There is no recording to replay: the step fails with REPLAY_UNRECORDED and is listed. Nothing is invented.", b,
         candidate=cand.build()["workflow"],
         expect={"baseline_status": "completed", "candidate_status": "failed", "same_path": False, "verdicts": {"Approve": "only_baseline"}, "unrecorded": 1,
                 "divergence_after": "Assess", "error_matches": "not performed in the recorded run"})

    b = flow("replay-live-ai-improves")
    b.activities[1]["outcome_contract"] = {"postconditions": [{"name": "Has a score", "expression": "score exists"}]}
    b.activities[1]["retry"] = {"max_attempts": 3, "initial_delay": "PT0S"}
    b.actors = {**world, "Assess": {"attempts": [{"output": {"note": "no score"}}, {"output": {"score": 7}}]}}
    emit(b.id, "20.1", "With live AI, agents run again under the candidate while everything else is held as recorded. An agent that is accepted in fewer attempts has improved.", b,
         ai="live", candidate_actors={"Assess": {"output": {"score": 7}}},
         expect={"baseline_status": "completed", "candidate_status": "completed", "same_path": True, "verdicts": {"Collect": "same", "Assess": "improved", "Approve": "same"}, "regressions": 0})

    b = flow("replay-live-ai-regresses"); b.actors = world
    emit(b.id, "20.3", "With live AI, an agent whose output now routes the run elsewhere changes the path; a run that was completed and is not any more is a regression.", b,
         ai="live", candidate_actors={"Assess": {"error": "model returned nothing usable"}},
         expect={"baseline_status": "completed", "candidate_status": "failed", "verdicts": {"Assess": "regressed"}, "regressions_at_least": 1})
    return cases


# ---------------------------------------------------------------------------
# Journeys (section 19)
# ---------------------------------------------------------------------------

def journey_cases() -> list[dict]:
    cases = []
    START = "2026-01-05T09:00:00Z"

    class J:
        def __init__(self, case_id, spec, description):
            self.id, self.spec, self.description = case_id, spec, description
            self.workflows, self.journeys, self.actors, self.steps, self.expect = [], [], {}, [], {}
        def workflow(self, name, build):
            c = Case(f"{self.id}:{name}", "journeys", self.spec, "")
            build(c)
            wf = c.build()["workflow"]; wf["name"] = name
            self.workflows.append(wf)
            return wf["id"]
        def journey(self, name, stages, triggers, **extra):
            j = {"id": uid(self.id, f"journey:{name}"), "name": name, "version": "1.0.0", "subject": {"name": "customer", "key": "customer_id"},
                 "stages": stages, "triggers": triggers, **extra}
            self.journeys.append(j)
            return j
        def publish(self, type, data=None, **extra):
            self.steps.append({"publish": {"type": type, "data": {"customer_id": "c-1", **(data or {})}, **extra}})
            return self
        def advance(self, duration): self.steps.append({"advance": duration}); return self
        def tick(self): self.steps.append({"tick": True}); return self
        def restart(self): self.steps.append({"restart": True}); return self
        def emit(self):
            case = {"id": self.id, "level": "journeys", "spec": self.spec, "description": self.description, "start": START,
                    "workflows": self.workflows, "journeys": self.journeys}
            if self.actors: case["actors"] = self.actors
            case["steps"] = self.steps; case["expect"] = self.expect
            cases.append(case)

    def claim(j, wait=True, timeout=None, timeout_to=None):
        """A claim workflow: register, then wait for documents, then settle."""
        def build(c):
            c.act("Register").act("Settle")
            if wait:
                definition = {"name": "documents.uploaded", "correlation_key": "customer_id"}
                if timeout: definition["timeout"] = timeout
                if timeout_to:
                    c.act(timeout_to); definition["timeout_edge_id"] = c.u(f"Documents->{timeout_to}")
                c.event("Documents", "message", **definition)
                c.edge("Register", "Documents").edge("Documents", "Settle")
                if timeout_to: c.edge("Documents", timeout_to)
            else:
                c.edge("Register", "Settle")
        return j.workflow("Claim", build)
    one_stage = lambda wf, **extra: [{"id": "open", "name": "Open", "workflows": [wf], "complete_when": "paid == true", "transitions": [], **extra}]
    starts = lambda wf: [{"event": "claim.submitted", "starts_journey": True, "start_workflow": wf}]
    PAID = {"Register": {"output": {"claim_id": "CLM-1"}}, "Settle": {"output": {"paid": True}}}

    j = J("journey-starts-on-trigger", "19.3", "A trigger with starts_journey creates an instance in the first stage for a subject that has none, and starts the workflow it names. The run belongs to the journey.")
    wf = claim(j); j.journey("Claim", one_stage(wf), starts(wf)); j.actors = PAID
    j.publish("claim.submitted")
    j.expect = {"instances": [{"journey": "Claim", "subject_key": "c-1", "status": "active", "stage_id": "open", "runs": ["waiting_event"],
                               "events": ["journey.started", "journey.stage_entered", "journey.event_received", "journey.run_started"]}]}
    j.emit()

    j = J("journey-completes-when-stage-condition-holds", "19.2", "A run's business data becomes the journey's data when the run ends. A stage completes when its condition holds, and a stage with empty transitions completes the journey.")
    wf = claim(j); j.journey("Claim", one_stage(wf), starts(wf), goals=[{"id": "paid", "name": "Paid", "expression": "paid == true"}]); j.actors = PAID
    j.publish("claim.submitted").publish("documents.uploaded")
    j.expect = {"instances": [{"journey": "Claim", "status": "completed", "goals_reached": ["paid"], "runs": ["completed"],
                               "events": ["journey.run_ended", "journey.goal_reached", "journey.stage_completed", "journey.completed"]}]}
    j.emit()

    j = J("journey-record-is-in-causal-order", "19.5", "A business event is recorded on the journey before anything reacts to it: the event that wakes a run precedes that run's end.")
    wf = claim(j); j.journey("Claim", one_stage(wf), starts(wf)); j.actors = PAID
    j.publish("claim.submitted").publish("documents.uploaded")
    j.expect = {"instances": [{"journey": "Claim", "events_exact": ["journey.started", "journey.stage_entered", "journey.event_received", "journey.run_started",
                                                                    "journey.event_received", "journey.run_ended", "journey.stage_completed", "journey.completed"]}]}
    j.emit()

    j = J("journey-moves-through-stages", "19.2", "Without transitions a completed stage leads to the next in the list; entering a stage starts the workflow it names with the journey's data.")
    wf = claim(j, wait=False)
    survey = j.workflow("Survey", lambda c: c.act("Ask"))
    j.journey("Claim", [{"id": "open", "name": "Open", "workflows": [wf], "complete_when": "paid == true"},
                        {"id": "asked", "name": "Asked", "on_enter": {"start_workflow": survey}, "complete_when": "asked == true", "transitions": []}], starts(wf))
    j.actors = {**PAID, "Ask": {"output": {"asked": True}}}
    j.publish("claim.submitted")
    j.expect = {"instances": [{"journey": "Claim", "status": "completed", "stage_id": "asked", "runs": ["completed", "completed"],
                               "events": ["journey.stage_completed", "journey.stage_entered", "journey.run_started", "journey.run_ended", "journey.stage_completed", "journey.completed"]}]}
    j.emit()

    j = J("journey-transition-by-condition", "19.2", "With transitions, the first whose condition is true names the next stage; failing that, the default.")
    wf = claim(j, wait=False)
    j.journey("Claim", [{"id": "open", "name": "Open", "workflows": [wf], "complete_when": "claim_id exists",
                         "transitions": [{"to": "fast", "condition": "amount < 100"}, {"to": "slow", "is_default": True}]},
                        {"id": "fast", "name": "Fast"}, {"id": "slow", "name": "Slow"}], starts(wf))
    j.actors = {"Register": {"output": {"claim_id": "CLM-1", "amount": 900}}}
    j.publish("claim.submitted")
    j.expect = {"instances": [{"journey": "Claim", "status": "active", "stage_id": "slow"}]}
    j.emit()

    j = J("journey-exit-abandons-and-cancels-runs", "19.5", "An exit event ends the journey with the outcome it names, and the runs still under way for it are cancelled: a customer who has left is not sent a reminder.")
    wf = claim(j); j.journey("Claim", one_stage(wf), starts(wf), exits=[{"event": "claim.withdrawn", "outcome": "abandoned", "reason": "Withdrawn"}]); j.actors = PAID
    j.publish("claim.submitted").publish("claim.withdrawn")
    j.expect = {"instances": [{"journey": "Claim", "status": "abandoned", "runs": ["cancelled"],
                               "events": ["journey.event_received", "journey.run_ended", "journey.abandoned"],
                               "events_contain": [{"type": "journey.run_ended", "data": {"status": "cancelled"}}, {"type": "journey.abandoned", "data": {"reason": "Withdrawn"}}]}]}
    j.emit()

    j = J("journey-stalls-when-stage-outlasts-its-limit", "19.2", "A stage that lasts longer than its max_duration is stalled. It is recorded once.")
    wf = claim(j); j.journey("Claim", one_stage(wf, max_duration="P2D"), starts(wf)); j.actors = PAID
    j.publish("claim.submitted").advance("P3D").tick().advance("P1D").tick()
    j.expect = {"instances": [{"journey": "Claim", "status": "active", "stalled": True, "events_count": {"journey.stalled": 1},
                               "events_contain": [{"type": "journey.stalled", "data": {"max_duration": "P2D"}}]}]}
    j.emit()

    j = J("journey-stalls-at-once-when-a-run-fails", "19.5", "A run that fails marks its stage stalled at once, with the run's id. The journey itself does not fail.")
    wf = claim(j, wait=False); j.journey("Claim", one_stage(wf), starts(wf)); j.actors = {"Register": {"error": "claims system down"}}
    j.publish("claim.submitted")
    j.expect = {"instances": [{"journey": "Claim", "status": "active", "stalled": True, "runs": ["failed"], "events": ["journey.run_ended", "journey.stalled"],
                               "events_contain": [{"type": "journey.run_ended", "data": {"status": "failed"}}]}]}
    j.emit()

    j = J("journey-deadline-takes-planned-path", "18.3", "When the host lets time pass, a wait whose deadline has run out takes its timeout edge, and the journey learns what that path established.")
    wf = claim(j, timeout="P5D", timeout_to="Close"); j.journey("Claim", one_stage(wf), starts(wf)); j.actors = {**PAID, "Close": {"output": {"closed": True}}}
    j.publish("claim.submitted").advance("P6D").tick()
    j.expect = {"instances": [{"journey": "Claim", "status": "active", "runs": ["completed"], "data": {"closed": True}}]}
    j.emit()

    j = J("journey-ignores-duplicate-event", "19.5", "An event id the host has already accepted has no further effect.")
    wf = claim(j); j.journey("Claim", one_stage(wf), starts(wf)); j.actors = PAID
    j.publish("claim.submitted", id="evt-1").publish("claim.submitted", id="evt-1")
    j.steps[1]["expect"] = {"accepted": False}
    j.expect = {"instances": [{"journey": "Claim", "events_count": {"journey.event_received": 1, "journey.run_started": 1}}], "instance_count": 1}
    j.emit()

    j = J("journey-untouched-by-event-that-does-not-concern-it", "19.5", "An event whose type the journey does not name, and none of its workflows waits for, leaves no trace on it.")
    wf = claim(j); j.journey("Claim", one_stage(wf), starts(wf)); j.actors = PAID
    j.publish("claim.submitted").publish("newsletter.opened")
    j.expect = {"instances": [{"journey": "Claim", "events_count": {"journey.event_received": 1}}]}
    j.emit()

    j = J("journey-subjects-are-kept-apart", "19.1", "Events with different values of the subject key belong to different instances.")
    wf = claim(j); j.journey("Claim", one_stage(wf), starts(wf)); j.actors = PAID
    j.publish("claim.submitted").publish("claim.submitted", {"customer_id": "c-2"}).publish("documents.uploaded", {"customer_id": "c-2"})
    j.expect = {"instance_count": 2, "instances": [{"journey": "Claim", "subject_key": "c-1", "status": "active"}, {"journey": "Claim", "subject_key": "c-2", "status": "completed"}]}
    j.emit()

    # ---- touchpoints and what changes hands (19.8) ----
    TOUCH = dict(artefacts=[{"id": "claim-form", "name": "Claim form", "kind": "form"}, {"id": "receipt", "name": "Payment receipt", "kind": "receipt"}],
                 touchpoints=[{"id": "reported", "name": "Reports the claim", "direction": "inbound", "channel": "web", "technology": "Customer portal", "on": {"event": "claim.submitted"}, "exchanges": [{"artefact": "claim-form"}]},
                              {"id": "settled", "name": "Is told the claim is settled", "direction": "outbound", "channel": "email", "technology": "Email gateway", "on": {"activity": "Settle"},
                               "exchanges": [{"artefact": "receipt", "reference": "receipt_id"}]}])
    j = J("journey-records-touchpoints", "19.8", "A touchpoint is recorded when its occasion occurs, with party, direction, channel, technology and what changed hands. One realised by a run carries that run's id; a reference identifies the particular document.")
    wf = claim(j, wait=False); j.journey("Claim", one_stage(wf), starts(wf), **TOUCH)
    j.actors = {"Register": {"output": {"claim_id": "CLM-1"}}, "Settle": {"output": {"paid": True, "receipt_id": "RC-7"}}}
    j.publish("claim.submitted")
    j.expect = {"instances": [{"journey": "Claim", "events": ["journey.event_received", "journey.touchpoint", "journey.run_started", "journey.touchpoint", "journey.run_ended"],
                               "events_count": {"journey.touchpoint": 2},
                               "events_contain": [{"type": "journey.touchpoint", "data": {"touchpoint_id": "reported", "party": "subject", "direction": "inbound", "channel": "web", "technology": "Customer portal",
                                                                                         "artefacts": [{"id": "claim-form", "name": "Claim form", "kind": "form"}]}},
                                                  {"type": "journey.touchpoint", "has": ["run_id"], "data": {"touchpoint_id": "settled", "direction": "outbound",
                                                                                                            "artefacts": [{"id": "receipt", "name": "Payment receipt", "kind": "receipt", "reference": "RC-7"}]}}]}]}
    j.emit()

    # ---- mood (19.9) ----
    def mood(rules, **extra): return {"sentiment": {"rules": rules, **extra}}
    j = J("mood-moves-by-inferred-rule", "19.9", "A rule with change moves the estimate, and the change is recorded as inferred with the rule's reason.")
    wf = claim(j); j.journey("Claim", one_stage(wf), starts(wf), goals=[{"id": "paid", "name": "Paid", "expression": "paid == true"}],
                             **mood([{"on": "event", "event": "claim.submitted", "change": -1, "reason": "has had an accident"}, {"on": "goal_reached", "goal": "paid", "change": 1.5, "reason": "has been paid"}]))
    j.actors = PAID
    j.publish("claim.submitted").publish("documents.uploaded")
    j.expect = {"instances": [{"journey": "Claim", "sentiment": 0.5, "events_count": {"journey.sentiment_changed": 2},
                               "events_contain": [{"type": "journey.sentiment_changed", "data": {"value": -1, "previous": 0, "basis": "inferred", "reason": "has had an accident"}},
                                                  {"type": "journey.sentiment_changed", "data": {"value": 0.5, "previous": -1, "basis": "inferred"}}]}]}
    j.emit()

    j = J("mood-is-measured-from-what-the-subject-said", "19.9", "A rule with measure reads a value from the event, maps it from its own scale onto the journey's, and sets the estimate to it. The change is recorded as measured.")
    wf = claim(j); j.journey("Claim", one_stage(wf), starts(wf), **mood([{"on": "event", "event": "survey.answered", "measure": {"path": "satisfaction", "from": [1, 5]}}]))
    j.actors = PAID
    j.publish("claim.submitted").publish("survey.answered", {"satisfaction": 2})
    j.expect = {"instances": [{"journey": "Claim", "sentiment": -1, "events_contain": [{"type": "journey.sentiment_changed", "data": {"value": -1, "basis": "measured"}}]}]}
    j.emit()

    j = J("mood-stays-within-its-scale", "19.9", "The estimate is kept within the journey's scale.")
    wf = claim(j); j.journey("Claim", one_stage(wf), starts(wf), **mood([{"on": "event", "event": "claim.submitted", "change": -5, "reason": "very bad news"}], min=-2, max=2))
    j.actors = PAID
    j.publish("claim.submitted")
    j.expect = {"instances": [{"journey": "Claim", "sentiment": -2}]}
    j.emit()

    j = J("mood-feels-a-wait-at-the-reply", "19.9", "The waited rule applies when an outbound touchpoint reaches the subject more than longer_than after the subject last acted, having heard nothing since.")
    wf = claim(j)
    j.journey("Claim", one_stage(wf), starts(wf), **mood([{"on": "waited", "longer_than": "P2D", "change": -1, "reason": "waited more than two days"}]),
              touchpoints=[{"id": "uploaded", "name": "Uploads documents", "direction": "inbound", "channel": "web", "on": {"event": "documents.uploaded"}},
                           {"id": "settled", "name": "Is told", "direction": "outbound", "channel": "email", "on": {"activity": "Settle"}}])
    j.actors = {"Register": {"output": {}}, "Settle": {"output": {"paid": True}, "takes": "P3D"}}
    j.publish("claim.submitted").publish("documents.uploaded")
    j.expect = {"instances": [{"journey": "Claim", "sentiment": -1, "events": ["journey.sentiment_changed", "journey.touchpoint"],
                               "events_contain": [{"type": "journey.sentiment_changed", "data": {"on": "waited", "basis": "inferred", "value": -1}}]}]}
    j.emit()

    # ---- several journeys (19.7) ----
    j = J("announced-event-starts-the-next-journey", "19.7", "An event a run publishes is accepted by the host like any other, after the run's end is recorded and before what follows from it. Here it begins the subject's next journey, which starts at the mood the last one left, and the movement between journeys is counted.")
    def build(c):
        c.act("Settle").event("Settled", "message", name="claim.settled", mode="publish", data=["customer_id", "paid"]).edge("Settle", "Settled")
    wf = j.workflow("Claim", build)
    care = j.workflow("Aftercare", lambda c: c.act("Ask"))
    j.journey("Claim", one_stage(wf), starts(wf), **mood([{"on": "event", "event": "claim.submitted", "change": -1, "reason": "has had an accident"}]))
    j.journey("Aftercare", [{"id": "asked", "name": "Asked", "workflows": [care], "complete_when": "asked == true", "transitions": []}],
              [{"event": "claim.settled", "starts_journey": True, "start_workflow": care}], **mood([]))
    j.actors = {"Settle": {"output": {"paid": True}}, "Ask": {"output": {"asked": True}}}
    j.publish("claim.submitted")
    j.expect = {"instance_count": 2,
                "instances": [{"journey": "Claim", "status": "completed", "sentiment": -1, "events": ["journey.run_ended", "journey.event_received", "journey.stage_completed", "journey.completed"]},
                              {"journey": "Aftercare", "status": "completed", "sentiment": -1, "events_contain": [{"type": "journey.started", "has": ["data.sentiment_carried_from"], "data": {"sentiment": -1}}]}],
                "transitions": [{"from": "Claim", "to": "Aftercare", "count": 1}]}
    j.emit()

    # ---- a host that restarts (19.11) ----
    j = J("journey-survives-a-restart", "19.10", "A host that stops and starts again carries on: the journey and its waiting run are as they were, an event accepted before the restart is not accepted again, and the run's journal continues without a gap.")
    wf = claim(j); j.journey("Claim", one_stage(wf), starts(wf)); j.actors = PAID
    j.publish("claim.submitted", id="evt-1").restart().publish("claim.submitted", id="evt-1").publish("documents.uploaded")
    j.steps[2]["expect"] = {"accepted": False}
    j.expect = {"instance_count": 1, "instances": [{"journey": "Claim", "status": "completed", "runs": ["completed"], "run_journal": ["run.started", "event.waiting", "run.resumed", "event.received", "run.completed"]}]}
    j.emit()

    j = J("deadline-passes-after-a-restart", "19.10", "A deadline fixed before a restart still passes after it, at the time it was fixed for.")
    wf = claim(j, timeout="P5D", timeout_to="Close"); j.journey("Claim", one_stage(wf), starts(wf)); j.actors = {**PAID, "Close": {"output": {"closed": True}}}
    j.publish("claim.submitted").advance("P4D").restart().tick().advance("P2D").tick()
    j.steps[3]["expect"] = {"timed_out_runs": 0}
    j.steps[5]["expect"] = {"timed_out_runs": 1}
    j.expect = {"instances": [{"journey": "Claim", "runs": ["completed"], "data": {"closed": True}}]}
    j.emit()
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

    c = Case("invalid-decision-entry", "document", "4", "")
    c.act("A").act("B").decision("D", "first", [("x", "number")], [(["[1..", ], "B")]).edge("A", "D").edge("D", "B")
    docs.append({"id": c.id, "description": "A decision table entry must be a valid unary test.",
                 "valid": False, "stage": "integrity", "error_code": "invalid_expression", "document": c.build()["workflow"]})

    c = Case("invalid-decision-rule-width", "document", "4", "")
    c.act("A").act("B").decision("D", "first", [("x", "number"), ("y", "number")], [(["> 1"], "B")]).edge("A", "D").edge("D", "B")
    docs.append({"id": c.id, "description": "A rule has exactly one input entry per input column.",
                 "valid": False, "stage": "integrity", "error_code": "invalid_rule", "document": c.build()["workflow"]})

    c = Case("invalid-event-without-name", "document", "4", "")
    c.act("A").event("Wait", "message").act("B").edge("A", "Wait").edge("Wait", "B")
    docs.append({"id": c.id, "description": "A message or signal event must name its event.",
                 "valid": False, "stage": "integrity", "error_code": "invalid_event", "document": c.build()["workflow"]})

    c = Case("invalid-compensation-in-flow", "document", "4", "")
    c.act("A", compensation={"activity_id": c.u("B")}).act("B").edge("A", "B")
    docs.append({"id": c.id, "description": "A compensation handler must not be the target of an edge.",
                 "valid": False, "stage": "integrity", "error_code": "invalid_compensation", "document": c.build()["workflow"]})

    c = Case("invalid-timer-duration", "document", "4", "")
    c.act("A").event("Wait", "timer", duration="soon").edge("A", "Wait")
    docs.append({"id": c.id, "description": "A timer event needs an ISO 8601 duration.",
                 "valid": False, "stage": "integrity", "error_code": "invalid_timer", "document": c.build()["workflow"]})

    return docs


def unary_tests() -> dict:
    """Entries of decision tables (specification 5.5.1), each with a value and whether it satisfies the entry."""
    MISSING = {"missing": True}
    T, F = True, False
    rows = [
        # any
        ("-", 5, T), ("-", MISSING, T), ("*", "x", T), ("", None, T),
        # equality
        ("100", 100, T), ("100", "100", T), ("100", 99, F), ("100", MISSING, F),
        ('"approved"', "approved", T), ('"approved"', "rejected", F), ("approved", "approved", T),
        ("= 5", 5, T), ("== 5", 5.0, T), ("true", True, T), ("true", False, F), ("true", "true", T), ("false", MISSING, F),
        ('"100"', 100, T), ("5", True, F),
        # inequality: a missing value differs from every value
        ("!= 5", 6, T), ("!= 5", 5, F), ("<> 5", MISSING, T), ('!= "a"', "b", T),
        # comparison
        ("> 10", 11, T), ("> 10", 10, F), (">= 10", 10, T), ("< 10", 9.5, T), ("<= 10", 10, T), (">=80", 80, T),
        ("> 10", "11", T), ("> 10", "abc", F), ("> 10", MISSING, F), ("< 10", None, F), ("< 0.3", 0.12, T), ("> -5", -4, T),
        # text is ordered as text, which orders ISO dates
        ('>= "2026-01-01"', "2026-06-30", T), ('< "2026-01-01"', "2026-06-30", F),
        # ranges
        ("[50..70]", 50, T), ("[50..70]", 70, T), ("(50..70)", 50, F), ("(50..70)", 60, T), ("[50..70)", 70, F), ("(50..70]", 70, T),
        ("[50..70]", MISSING, F), ("[0.5..1]", 0.75, T), ('["2026-01-01".."2026-12-31"]', "2026-06-30", T),
        # lists
        ('in("red", "green")', "red", T), ('in("red", "green")', "blue", F), ("in (1, 2, 3)", 2, T), ("in(1, 2)", MISSING, F),
        ('not in("US", "CA")', "UK", T), ('not in("US", "CA")', "US", F), ("not in(1, 2)", MISSING, T),
        # alternatives
        ('"FR", "DE"', "DE", T), ('"FR", "DE"', "IT", F), ("< 10, > 90", 95, T), ("< 10, > 90", 50, F), ("null, 0", MISSING, T), ("null, 0", 0, T),
        # negation
        ("not(< 18, > 99)", 40, T), ("not(< 18, > 99)", 12, F), ('not("a", "b")', "c", T), ("not(null)", MISSING, F), ("not(5)", MISSING, T),
        # null
        ("null", None, T), ("null", MISSING, T), ("null", 0, F), ("not null", 0, T), ("not null", MISSING, F), ("not null", "", T),
        # text functions
        ('contains("fire")', "engine fire", T), ('contains("fire")', "flood", F), ('contains("x")', MISSING, F),
        ('starts with "POL-"', "POL-77", T), ('ends with ".pdf"', "claim.PDF", F), ('matches("^[A-Z]{3}-[0-9]+$")', "CLM-2041", T), ('matches("^[A-Z]{3}$")', "clm", F),
    ]
    cases = []
    for entry, value, expect in rows:
        case = {"entry": entry, "expect": expect}
        if value is MISSING:
            case["missing"] = True
        else:
            case["value"] = value
        cases.append(case)
    invalid = ["[1..", "(1..5", "in(", "in()", ">", ">=", '"open', "not(", "matches(\"[\")", "> > 3", "1, , 2", 'contains(5)']
    return {"description": "Decision table entries. 'cases': an entry, a value (or 'missing': true when the property is absent) and whether the value satisfies the entry. 'invalid': entries that must be rejected at validation.",
            "spec": "5.5.1", "cases": cases, "invalid": invalid}


def expressions() -> dict:
    """Condition expressions (specification section 6), evaluated against one data object."""
    data = {"amount": 120, "status": "approved", "ok": True, "off": False, "nested": {"score": 0.2, "tags": ["a"]}, "empty": None, "zero": 0, "blank": ""}
    T, F = True, False
    rows = [
        ("amount > 100", T), ("amount <= 100", F), ("amount == 120", T), ("amount >= 120", T), ("amount < 120", F), ("amount != 121", T),
        ("status == approved", T), ('status == "approved"', T), ("status != 'rejected'", T), ("status != approved", F),
        ("ok == true", T), ("off == false", T), ("ok", T), ("!ok", F), ("off", F), ("zero", F), ("blank", F), ("empty", F), ("missing", F), ("!missing", T),
        ("nested.score < 0.3", T), ("nested.missing == 1", F), ("nested.tags exists", T),
        ("missing == 1", F), ("missing != 1", T), ("missing > 1", F), ("missing < 1", F),
        ("missing exists", F), ("empty exists", T), ("empty == null", T), ("missing == null", T), ("amount == null", F),
        ("typeof amount == number", T), ("typeof status == string", T), ("typeof ok == boolean", T), ("typeof nested == object", T),
        ("typeof nested.tags == array", T), ("typeof empty == null", T), ("typeof missing == undefined", T),
        ("ok && amount > 100", T), ("ok && amount > 500", F), ("amount > 500 || status == approved", T), ("off || missing", F),
        ("!(ok && amount > 500)", T), ("(off || ok) && amount == 120", T), ("off || ok && amount > 500", F),
        ("status > 5", F), ("amount == 120.0", T),
    ]
    invalid = ["", "amount >", "== 3", "amount > 1 &&", "a ? b", "(ok", "ok)", "amount >> 3", "typeof amount", '"quoted" == 1', "amount = 1"]
    return {"description": "Condition expressions. 'data' is the object every expression is evaluated against. 'cases': an expression and its result. 'invalid': expressions that must be rejected.",
            "spec": "6", "data": data, "cases": [{"expression": e, "expect": x} for e, x in rows], "invalid": invalid}


def write(path: pathlib.Path, data: dict) -> None:
    path.write_text(json.dumps(data, indent=2) + "\n")


def measure_cases() -> list[dict]:
    """Level `measures` (section 21): what was recorded, and the values that follow from it by the rules of 21.2 to 21.5."""
    day = lambda d, hm: f"2026-01-{d:02d}T{hm}:00.000Z"
    seq = iter(range(1, 10_000))

    def ev(type_, time, **rest):
        return {"type": type_, "time": time, "seq": next(seq), **rest}

    pack, approve, wait, route_ = "pack", "approve", "paid", "route"
    r1 = {"run_id": "r1", "workflow_id": "fulfil", "stage_id": "placed", "events": [
        ev("run.started", day(5, "09:00"), data={"workflow_name": "Fulfil"}),
        ev("activity.started", day(5, "09:00"), node_id=pack, node_name="Pack", data={"actor_type": "ai_agent"}),
        ev("activity.completed", day(5, "09:10"), node_id=pack, node_name="Pack", data={"actor_type": "ai_agent", "duration_ms": 600000, "usage": {"input_tokens": 100, "output_tokens": 20}}),
        ev("event.waiting", day(5, "09:10"), node_id=wait, node_name="Paid"),
        ev("event.received", day(5, "09:40"), node_id=wait, node_name="Paid"),
        ev("run.completed", day(5, "10:00"), data={"cost": 0.02, "currency": "EUR", "input_tokens": 100, "output_tokens": 20}),
    ]}
    r2 = {"run_id": "r2", "workflow_id": "fulfil", "stage_id": "placed", "events": [
        ev("run.started", day(6, "09:00"), data={"workflow_name": "Fulfil"}),
        ev("activity.started", day(6, "09:00"), node_id=pack, node_name="Pack", data={"actor_type": "ai_agent"}),
        ev("activity.failed", day(6, "09:01"), node_id=pack, node_name="Pack", data={"duration_ms": 60000, "error": {"code": "TIMEOUT", "message": "too slow"}}),
        ev("activity.retry_scheduled", day(6, "09:01"), node_id=pack, node_name="Pack", data={"next_attempt": 2}),
        ev("activity.started", day(6, "09:02"), node_id=pack, node_name="Pack", data={"actor_type": "ai_agent"}),
        ev("tool.invoked", day(6, "09:03"), node_id=pack, data={"tool": "label"}),
        ev("tool.completed", day(6, "09:03"), node_id=pack, data={"tool": "label", "duration_ms": 5}),
        ev("tool.invoked", day(6, "09:04"), node_id=pack, data={"tool": "label"}),
        ev("tool.failed", day(6, "09:04"), node_id=pack, data={"tool": "label"}),
        ev("activity.completed", day(6, "09:11"), node_id=pack, node_name="Pack", data={"actor_type": "ai_agent", "duration_ms": 540000, "usage": {"input_tokens": 300, "output_tokens": 40}}),
        ev("decision.evaluated", day(6, "09:11"), node_id=route_, node_name="Route", data={"method": "table", "used_default": False}),
        ev("decision.evaluated", day(6, "09:11"), node_id=route_, node_name="Route", data={"method": "model", "used_default": False}),
        ev("activity.started", day(6, "09:12"), node_id=approve, node_name="Approve", data={"actor_type": "human"}),
        ev("token.waiting", day(6, "09:12"), node_id=approve, data={"reason": "human_task"}),
        ev("token.resumed", day(6, "10:12"), node_id=approve, data={"waited_ms": 3600000}),
        ev("activity.completed", day(6, "10:22"), node_id=approve, node_name="Approve", data={"actor_type": "human", "duration_ms": 600000}),
        ev("run.completed", day(6, "12:00"), data={"cost": 0.04, "currency": "EUR", "input_tokens": 300, "output_tokens": 40}),
    ]}
    r3 = {"run_id": "r3", "workflow_id": "fulfil", "stage_id": "placed", "events": [
        ev("run.started", day(7, "09:00"), data={"workflow_name": "Fulfil"}),
        ev("event.waiting", day(7, "09:05"), node_id=wait, node_name="Paid"),
        ev("event.timed_out", day(7, "10:00"), node_id=wait, node_name="Paid"),
        ev("run.cancelled", day(7, "10:00"), data={"reason": "journey abandoned"}),
    ]}
    r4 = {"run_id": "r4", "workflow_id": "fulfil", "stage_id": "placed", "events": [
        ev("run.started", day(8, "09:00"), data={"workflow_name": "Fulfil"}),
    ]}

    def instance(key, status, d, ended, history, goals, mood, events, stage, stalled=False):
        i = {"id": f"i-{key}", "journey_id": "order", "subject_key": key, "status": status, "stage_id": stage, "stage_entered_at": history[-1]["entered_at"],
             "stalled": stalled, "started_at": day(d, "09:00"), "goals_reached": goals, "stage_history": history,
             "events": [{"type": "journey.started", "time": day(d, "09:00"), "stage_id": "placed", "data": {"sentiment": 0}}] + events}
        if ended: i["ended_at"] = ended
        if mood is not None: i["sentiment"] = mood
        return i
    visit = lambda stage, a, b=None: {"stage_id": stage, "entered_at": a, **({"left_at": b} if b else {})}
    touch = lambda t, channel, direction, artefacts=(): {"type": "journey.touchpoint", "time": t, "data": {"channel": channel, "direction": direction, "technology": "Shop", "artefacts": [{"kind": k} for k in artefacts]}}
    mood = lambda t, basis: {"type": "journey.sentiment_changed", "time": t, "data": {"basis": basis}}
    stall = lambda t: {"type": "journey.stalled", "time": t, "stage_id": "placed", "data": {"stage_name": "Placed", "max_duration": "P1D", "owner": "Sales desk"}}

    a = instance("a", "completed", 5, day(5, "11:00"), [visit("placed", day(5, "09:00"), day(5, "10:00")), visit("delivered", day(5, "10:00"), day(5, "11:00"))], ["delivered"], 1,
                 [touch(day(5, "09:00"), "web", "inbound"), touch(day(5, "10:00"), "email", "outbound", ["receipt"]), mood(day(5, "11:00"), "measured")], "delivered")
    b = instance("b", "completed", 6, day(6, "15:00"), [visit("placed", day(6, "09:00"), day(6, "12:00")), visit("delivered", day(6, "12:00"), day(6, "15:00"))], ["delivered"], 2,
                 [touch(day(6, "09:00"), "web", "inbound"), stall(day(6, "11:00")), mood(day(6, "15:00"), "inferred")], "delivered")
    c = instance("c", "abandoned", 7, day(7, "10:00"), [visit("placed", day(7, "09:00"), day(7, "10:00"))], [], -1,
                 [touch(day(7, "09:00"), "phone", "inbound"), mood(day(7, "10:00"), "inferred")], "placed")
    d = instance("d", "active", 8, None, [visit("placed", day(8, "09:00"))], [], 0, [stall(day(9, "09:00"))], "placed", stalled=True)

    recorded = {
        "as_of": day(10, "09:00"),
        "workflows": [{"id": "fulfil", "name": "Fulfil", "activities": [{"id": pack, "name": "Pack", "actor_type": "ai_agent"}, {"id": approve, "name": "Approve", "actor_type": "human"}]}],
        "journeys": [{
            "definition": {"id": "order", "name": "Order", "stages": [{"id": "placed", "name": "Placed", "max_duration": "P1D", "owner": "Sales desk"}, {"id": "delivered", "name": "Delivered"}],
                           "goals": [{"id": "delivered", "name": "Delivered"}], "sentiment": {"min": -2, "max": 2, "initial": 0}},
            "instances": [{"instance": a, "runs": [r1]}, {"instance": b, "runs": [r2]}, {"instance": c, "runs": [r3]}, {"instance": d, "runs": [r4]}],
        }],
        "transitions": [],
    }
    H = 3600000
    whole = {
        "id": "measures-from-a-small-record", "level": "measures", "spec": "21",
        "description": "Four journeys of one kind and their four runs: two completed, one abandoned, one stalled. Every value follows from the record by the rules of section 21; a measure with nothing to be computed from has no value.",
        "recorded": recorded, "options": {},
        "expect": {
            "currency": "EUR",
            "journeys": [{"name": "Order", "measures": {
                "journey.started": 4, "journey.active": 1, "journey.completion_rate": 0.5, "journey.abandonment_rate": 0.25,
                "journey.stall_rate": 0.5, "journey.stalled_now": 1, "journey.goal_attainment": 0.5,
                "journey.duration_median_ms": 2 * H, "journey.duration_p90_ms": 6 * H,
                "journey.mood_end": 2 / 3, "journey.mood_change": 2 / 3, "journey.mood_measured_share": 1 / 3,
                "journey.touchpoints_per_journey": 1, "journey.runs_per_journey": 1, "journey.cost_per_journey": 0.015},
                "stages": [
                    {"stage_id": "placed", "owner": "Sales desk", "measures": {"stage.entered": 4, "stage.conversion": 0.5, "stage.duration_median_ms": H, "stage.breach_rate": 0.5, "stage.active": 1, "stage.stalled_now": 1, "stage.abandoned": 1}},
                    {"stage_id": "delivered", "measures": {"stage.entered": 2, "stage.conversion": 1, "stage.duration_median_ms": H, "stage.breach_rate": 0, "stage.active": 0, "stage.stalled_now": 0, "stage.abandoned": 0}}],
                "channels": [{"channel": "web", "touchpoints": 2, "inbound": 2, "outbound": 0}, {"channel": "email", "touchpoints": 1, "inbound": 0, "outbound": 1}, {"channel": "phone", "touchpoints": 1, "inbound": 1, "outbound": 0}],
                "artefacts": [{"kind": "receipt", "count": 1}]}],
            "workflows": [{"name": "Fulfil", "measures": {
                "workflow.runs": 4, "workflow.in_progress": 1, "workflow.success_rate": 2 / 3, "workflow.failure_rate": 0, "workflow.cancel_rate": 1 / 3,
                "workflow.first_pass_yield": 1 / 3, "workflow.lead_time_median_ms": H, "workflow.lead_time_p90_ms": 3 * H,
                "workflow.process_time_median_ms": 600000, "workflow.flow_efficiency": 0.1,
                "workflow.event_wait_median_ms": 1800000, "workflow.event_timeout_rate": 0.5, "workflow.human_wait_median_ms": H,
                "workflow.automation_rate": 2 / 3, "workflow.retries": 1, "workflow.dead_letters": 0, "workflow.compensations": 0,
                "workflow.tool_calls": 2, "workflow.tool_failure_rate": 0.5, "workflow.contract_pass_rate": None, "workflow.verification_pass_rate": None,
                "workflow.decisions": 2, "workflow.decision_default_rate": 0, "workflow.model_decision_share": 0.5,
                "workflow.input_tokens": 400, "workflow.output_tokens": 60, "workflow.cost": 0.06, "workflow.cost_per_run": 0.02},
                "activities": [
                    {"name": "Pack", "measures": {"activity.attempts": 3, "activity.failure_rate": 1 / 3, "activity.duration_median_ms": 540000, "activity.tokens": 460}},
                    {"name": "Approve", "measures": {"activity.attempts": 1, "activity.failure_rate": 0, "activity.duration_median_ms": 600000}}]}],
            "attention": [{"subject_key": "d", "stage_id": "placed", "owner": "Sales desk", "waiting_ms": 48 * H}],
        },
    }
    later = {
        "id": "measures-over-a-period", "level": "measures", "spec": "21.1",
        "description": "The same record, keeping what started on or after 7 January: one abandoned journey and one stalled. Rates are over what is kept; a median over nothing has no value.",
        "recorded": recorded, "options": {"from": day(7, "00:00")},
        "expect": {
            "journeys": [{"name": "Order", "measures": {"journey.started": 2, "journey.completion_rate": 0, "journey.abandonment_rate": 0.5, "journey.stall_rate": 0.5,
                                                         "journey.duration_median_ms": None, "journey.mood_end": -1, "journey.goal_attainment": 0}}],
            "workflows": [{"name": "Fulfil", "measures": {"workflow.runs": 2, "workflow.in_progress": 1, "workflow.success_rate": 0, "workflow.cancel_rate": 1,
                                                           "workflow.event_wait_median_ms": None, "workflow.event_timeout_rate": 1, "workflow.automation_rate": None}}],
        },
    }
    # A journey and its runs need not start in the same period: each is kept by its own start
    follow_up = {"run_id": "r5", "workflow_id": "fulfil", "stage_id": "delivered", "events": [
        ev("run.started", day(9, "10:00"), data={"workflow_name": "Fulfil"}),
        ev("run.completed", day(9, "10:30"), data={"cost": 0.01, "currency": "EUR", "input_tokens": 0, "output_tokens": 0}),
    ]}
    spread = json.loads(json.dumps(recorded))
    spread["journeys"][0]["instances"][0]["runs"].append(follow_up)
    after = {
        "id": "measures-keep-runs-by-their-own-start", "level": "measures", "spec": "21.1",
        "description": "A journey that started on 5 January starts another run on 9 January. A report from 9 January keeps that run, although it keeps no journey: workflow measures follow the start of each run, not of the journey it belongs to.",
        "recorded": spread, "options": {"from": day(9, "00:00")},
        "expect": {
            "journeys": [{"name": "Order", "measures": {"journey.started": 0, "journey.completion_rate": None}}],
            "workflows": [{"name": "Fulfil", "measures": {"workflow.runs": 1, "workflow.success_rate": 1, "workflow.cost": 0.01, "workflow.lead_time_median_ms": 1800000}}],
        },
    }
    before = {
        "id": "measures-leave-out-runs-started-after-the-period", "level": "measures", "spec": "21.1",
        "description": "The same record up to 6 January: the journey of 5 January is kept with both of its runs counted as its own, but the workflow's measures leave out the run that started on the 9th.",
        "recorded": spread, "options": {"to": day(6, "00:00")},
        "expect": {
            "journeys": [{"name": "Order", "measures": {"journey.started": 1, "journey.completion_rate": 1, "journey.runs_per_journey": 2, "journey.cost_per_journey": 0.03}}],
            "workflows": [{"name": "Fulfil", "measures": {"workflow.runs": 1, "workflow.cost": 0.02, "workflow.lead_time_median_ms": 3600000}}],
        },
    }
    return [whole, later, after, before]


def context_cases() -> list[Case]:
    """Level `contexts` (section 22): an activity sees and changes a context only through a binding."""
    cases = []

    def ctx(c: Case, name: str, pattern: str = "shared_state", **extra) -> dict:
        context = {"id": c.u(f"context-{name}"), "name": name, "type": "data", "sync_pattern": pattern, **extra}
        c.contexts = getattr(c, "contexts", []) + [context]
        return context

    def bind(c: Case, context: str, mode: str, **extra) -> dict:
        return {"context_id": c.u(f"context-{context}"), "access_mode": mode, **extra}

    def failed(code: str) -> dict:
        return {"type": "token.failed", "data": {"error": {"code": code}}}

    c = Case("context-given-only-to-bound-activities", "contexts", "22.2", "An activity bound to read a context is given its value. An activity with no binding is given no context at all.")
    ctx(c, "Order", initial_value={"total": 150})
    c.act("A", context_bindings=[bind(c, "Order", "read")]).act("B").edge("A", "B")
    c.expect = {"status": "completed", "visited": ["A", "B"], "given_contexts": {"A": {"Order": {"total": 150}}, "B": None},
                "journal_contains": [{"type": "context.read", "node_name": "A", "data": {"contexts": [{"context_name": "Order", "access_mode": "read", "present": True}]}}],
                "journal_count": {"context.read": 1}}
    cases.append(c)

    c = Case("context-written-then-read", "contexts", "22.3", "What one activity writes under a binding that allows writing, a later activity bound to read is given.")
    ctx(c, "Order")
    c.act("A", context_bindings=[bind(c, "Order", "write")]).act("B", context_bindings=[bind(c, "Order", "read")]).edge("A", "B")
    c.actors = {"A": {"contexts": {"Order": {"total": 80}}}}
    c.expect = {"status": "completed", "visited": ["A", "B"], "given_contexts": {"A": {}, "B": {"Order": {"total": 80}}}, "contexts": {"Order": {"total": 80}},
                "journal_contains": [{"type": "context.written", "node_name": "A", "data": {"context_name": "Order", "sync_pattern": "shared_state", "access_mode": "write"}}]}
    cases.append(c)

    c = Case("context-write-without-binding-is-denied", "contexts", "22.3", "An activity bound only to read a context cannot write to it: the activity fails with CONTEXT_ACCESS_DENIED and the context keeps its value.")
    ctx(c, "Order", initial_value={"total": 150})
    c.act("A", context_bindings=[bind(c, "Order", "read")]).act("B").edge("A", "B")
    c.actors = {"A": {"contexts": {"Order": {"total": 0}}}}
    c.expect = {"status": "failed", "visited": ["A"], "contexts": {"Order": {"total": 150}},
                "journal_contains": [{"type": "context.denied", "node_name": "A", "data": {"context_name": "Order"}}, failed("CONTEXT_ACCESS_DENIED")],
                "journal_excludes": ["context.written"]}
    cases.append(c)

    c = Case("context-write-to-unbound-context-is-denied", "contexts", "22.3", "A context the activity has no binding to cannot be written, even though the workflow declares it.")
    ctx(c, "Order"); ctx(c, "Ledger")
    c.act("A", context_bindings=[bind(c, "Order", "write")])
    c.actors = {"A": {"contexts": {"Ledger": {"entry": 1}}}}
    c.expect = {"status": "failed", "visited": ["A"], "contexts": {}, "journal_contains": [failed("CONTEXT_ACCESS_DENIED")]}
    cases.append(c)

    c = Case("required-context-without-value-fails", "contexts", "22.2", "A binding is required unless it says otherwise. When a required context has no value the activity fails with CONTEXT_MISSING before its actor is called.")
    ctx(c, "Order")
    c.act("A", context_bindings=[bind(c, "Order", "read")])
    c.expect = {"status": "failed", "visited": [], "journal_contains": [failed("CONTEXT_MISSING"), {"type": "context.read", "data": {"contexts": [{"context_name": "Order", "present": False}]}}],
                "journal_excludes": ["activity.started"]}
    cases.append(c)

    c = Case("optional-context-without-value-is-left-out", "contexts", "22.2", "A binding with required false lets the activity run without the context, which is then left out of what it is given.")
    ctx(c, "Notes")
    c.act("A", context_bindings=[bind(c, "Notes", "read", required=False)])
    c.expect = {"status": "completed", "visited": ["A"], "given_contexts": {"A": {}}}
    cases.append(c)

    c = Case("context-schema-refuses-a-write", "contexts", "22.3", "A value that does not match the context's schema is not written: the activity fails with CONTEXT_INVALID.")
    ctx(c, "Order", schema={"type": "object", "required": ["total"], "properties": {"total": {"type": "number"}}}, initial_value={"total": 1})
    c.act("A", context_bindings=[bind(c, "Order", "read_write")])
    c.actors = {"A": {"contexts": {"Order": {"total": "many"}}}}
    c.expect = {"status": "failed", "visited": ["A"], "contexts": {"Order": {"total": 1}}, "journal_contains": [failed("CONTEXT_INVALID")], "journal_excludes": ["context.written"]}
    cases.append(c)

    c = Case("context-writes-are-all-or-nothing", "contexts", "22.3", "When one of an activity's writes is refused, none of them is applied.")
    ctx(c, "Notes"); ctx(c, "Order", schema={"type": "object", "required": ["total"]})
    c.act("A", context_bindings=[bind(c, "Notes", "write"), bind(c, "Order", "write")])
    c.actors = {"A": {"contexts": {"Notes": {"text": "checked"}, "Order": {"sum": 3}}}}
    c.expect = {"status": "failed", "visited": ["A"], "contexts": {}, "journal_contains": [failed("CONTEXT_INVALID")], "journal_excludes": ["context.written"]}
    cases.append(c)

    c = Case("blackboard-merges-what-is-written", "contexts", "22.3", "On a blackboard each write adds its properties to what is there; a later writer does not erase an earlier one.")
    ctx(c, "Findings", "blackboard")
    c.act("A", context_bindings=[bind(c, "Findings", "write")]).act("B", context_bindings=[bind(c, "Findings", "read_write")]).edge("A", "B")
    c.actors = {"A": {"contexts": {"Findings": {"damage": "rear bumper"}}}, "B": {"contexts": {"Findings": {"fraud": "none"}}}}
    c.expect = {"status": "completed", "visited": ["A", "B"], "given_contexts": {"B": {"Findings": {"damage": "rear bumper"}}},
                "contexts": {"Findings": {"damage": "rear bumper", "fraud": "none"}}}
    cases.append(c)

    c = Case("event-sourcing-appends-what-is-written", "contexts", "22.3", "With event sourcing and message passing each write is appended: the context is the list of what was written, in order.")
    ctx(c, "Log", "event_sourcing")
    c.act("A", context_bindings=[bind(c, "Log", "publish")]).act("B", context_bindings=[bind(c, "Log", "publish")]).act("C", context_bindings=[bind(c, "Log", "subscribe")]).edge("A", "B").edge("B", "C")
    c.actors = {"A": {"contexts": {"Log": {"step": "received"}}}, "B": {"contexts": {"Log": {"step": "checked"}}}}
    c.expect = {"status": "completed", "visited": ["A", "B", "C"], "given_contexts": {"C": {"Log": [{"step": "received"}, {"step": "checked"}]}},
                "contexts": {"Log": [{"step": "received"}, {"step": "checked"}]}}
    cases.append(c)

    c = Case("contexts-stay-out-of-the-run-data", "contexts", "22.2", "A context is not part of the data that flows along edges: an activity without a binding cannot reach it through the run's data, and routing does not see it.")
    ctx(c, "Secret", initial_value={"limit": 5})
    c.act("A", context_bindings=[bind(c, "Secret", "read")]).act("B").act("C").edge("A", "B", condition="_contexts exists").edge("A", "C", is_default=True)
    c.expect = {"status": "completed", "visited": ["A", "C"], "given_contexts": {"C": None}}
    cases.append(c)
    return cases


def service_level_cases() -> list[Case]:
    """Level `service_levels` (section 23): time taken, waits and retries included, compared with what was promised."""
    cases = []
    START = "2026-01-05T09:00:00.000Z"

    def timed(case_id, spec, description) -> Case:
        c = Case(case_id, "service_levels", spec, description)
        c.clock = START
        return c

    c = timed("within-service-level-is-silent", "23.2", "An activity that finishes within its target and its longest time leaves no service level record.")
    c.act("A", sla={"target_time": "PT1H", "max_time": "PT4H"})
    c.actors = {"A": {"takes": "PT10M"}}
    c.expect = {"status": "completed", "journal_excludes": ["sla.warning", "sla.breached"]}
    cases.append(c)

    c = timed("target-missed-is-a-warning", "23.2", "Past the target but within the longest time, one warning is recorded and the work goes on.")
    c.act("A", sla={"name": "Assessment", "target_time": "PT1H", "max_time": "PT4H"}).act("B").edge("A", "B")
    c.actors = {"A": {"takes": "PT2H"}}
    c.expect = {"status": "completed", "visited": ["A", "B"],
                "journal_contains": [{"type": "sla.warning", "node_name": "A", "data": {"scope": "activity", "name": "Assessment", "elapsed_ms": 7200000, "threshold": "PT1H"}}],
                "journal_count": {"sla.warning": 1}, "journal_excludes": ["sla.breached"]}
    cases.append(c)

    c = timed("warning-threshold-names-who-to-notify", "23.2", "An escalation policy's warning threshold takes the place of the target, and its roles to notify are carried by the record.")
    c.act("A", sla={"target_time": "PT3H", "max_time": "PT4H", "escalation_policy": {"warning_threshold": "PT30M", "warning_action": "notify", "notify_roles": [uid("warning-threshold-names-who-to-notify", "supervisor")]}})
    c.actors = {"A": {"takes": "PT1H"}}
    c.expect = {"status": "completed",
                "journal_contains": [{"type": "sla.warning", "data": {"scope": "activity", "threshold": "PT30M", "action": "notify", "notify_roles": [uid("warning-threshold-names-who-to-notify", "supervisor")]}}]}
    cases.append(c)

    c = timed("breach-is-recorded-and-finished-work-stands", "23.3", "Work that finished after its longest time is recorded as a breach. It is not undone, whatever the breach action: the run goes on with its output.")
    c.act("A", sla={"max_time": "PT4H", "escalation_policy": {"breach_action": "fail"}}).act("B").edge("A", "B")
    c.actors = {"A": {"takes": "PT5H", "output": {"done": True}}}
    c.expect = {"status": "completed", "visited": ["A", "B"], "data": {"done": True},
                "journal_contains": [{"type": "sla.breached", "node_name": "A", "data": {"scope": "activity", "elapsed_ms": 18000000, "max_time": "PT4H", "action": "fail"}}],
                "journal_count": {"sla.breached": 1}}
    cases.append(c)

    c = timed("breach-with-fail-stops-retries", "23.3", "The time of an activity counts across its attempts. With breach action fail, an activity past its longest time is not tried again: it fails with SLA_BREACH.")
    c.act("A", sla={"max_time": "PT1H", "escalation_policy": {"breach_action": "fail"}}, retry={"max_attempts": 3, "initial_delay": "PT0S"}).act("B").edge("A", "B")
    c.actors = {"A": {"attempts": [{"error": "upstream unavailable", "takes": "PT2H"}, {"output": {"done": True}}]}}
    c.expect = {"status": "failed", "visited": ["A"], "journal_count": {"activity.started": 1},
                "journal_contains": [{"type": "sla.breached", "data": {"scope": "activity", "action": "fail"}}, {"type": "token.failed", "data": {"error": {"code": "SLA_BREACH"}}}]}
    cases.append(c)

    c = timed("breach-without-fail-keeps-retrying", "23.3", "Without the breach action fail, a breach is recorded and the retry policy goes on as it would.")
    c.act("A", sla={"max_time": "PT1H"}, retry={"max_attempts": 3, "initial_delay": "PT0S"})
    c.actors = {"A": {"attempts": [{"error": "upstream unavailable", "takes": "PT2H"}, {"output": {"done": True}}]}}
    c.expect = {"status": "completed", "visited": ["A", "A"], "journal_count": {"sla.breached": 1},
                "journal_contains": [{"type": "sla.breached", "data": {"scope": "activity", "action": "record"}}]}
    cases.append(c)

    c = timed("run-breach-is-recorded-at-the-end", "23.4", "A workflow's service level counts from the start of the run. A run that ends late is recorded as breached before its end is recorded.")
    c.sla = {"name": "Claim settled", "max_time": "PT1H"}
    c.act("A").act("B").edge("A", "B")
    c.actors = {"A": {"takes": "PT40M"}, "B": {"takes": "PT40M"}}
    c.expect = {"status": "completed", "journal": ["sla.breached", "run.completed"],
                "journal_contains": [{"type": "sla.breached", "data": {"scope": "workflow", "name": "Claim settled", "elapsed_ms": 4800000, "max_time": "PT1H"}}]}
    cases.append(c)

    c = timed("waiting-run-past-its-time-fails-when-told-to", "23.4", "Work that waits is compared with its service levels when the host checks them. With breach action fail, a run still waiting past its longest time fails with SLA_BREACH.")
    c.sla = {"max_time": "P1D", "escalation_policy": {"breach_action": "fail"}}
    c.act("Ask").event("Reply", "message", name="customer.replied").act("Proceed").edge("Ask", "Reply").edge("Reply", "Proceed")
    c.deliver = [{"advance": "PT2H"}, {"check_service_levels": True, "expect": {"warnings": 0, "breaches": 0, "failed": 0}},
                 {"advance": "P2D"}, {"check_service_levels": True, "expect": {"breaches": 1, "failed": 1}}]
    c.expect = {"status": "failed", "visited": ["Ask"], "journal_count": {"sla.breached": 1},
                "journal_contains": [{"type": "sla.breached", "data": {"scope": "workflow", "action": "fail"}}, {"type": "token.failed", "data": {"error": {"code": "SLA_BREACH"}}}]}
    cases.append(c)

    c = timed("waiting-run-breach-is-recorded-once", "23.4", "Without the breach action fail, a waiting run past its longest time is recorded as breached once, however often the host checks, and goes on waiting.")
    c.sla = {"max_time": "P1D"}
    c.act("Ask").event("Reply", "message", name="customer.replied").act("Proceed").edge("Ask", "Reply").edge("Reply", "Proceed")
    c.deliver = [{"advance": "P2D"}, {"check_service_levels": True, "expect": {"breaches": 1, "failed": 0}}, {"advance": "P1D"}, {"check_service_levels": True, "expect": {"breaches": 0, "failed": 0}},
                 {"event": {"type": "customer.replied"}, "resumes": 1}]
    c.expect = {"status": "completed", "visited": ["Ask", "Proceed"], "journal_count": {"sla.breached": 1}}
    cases.append(c)
    return cases


def telemetry_cases() -> list[dict]:
    """Level `telemetry` (section 26): a record, and the trace every implementation must derive from it."""
    import hashlib
    from datetime import datetime, timedelta, timezone

    def digest(text: str, size: int) -> str:
        raw = bytearray(hashlib.sha256(text.encode("utf-8")).digest()[:size])
        if not any(raw):
            raw[-1] = 1
        return raw.hex()

    trace = lambda run: digest(f"awa:run:{run}", 16)
    span = lambda run, seq: digest(f"awa:run:{run}:{seq}", 8)
    jtrace = lambda inst: digest(f"awa:journey:{inst}", 16)
    jspan = lambda inst, seq: digest(f"awa:journey:{inst}:{seq}", 8)
    t0 = datetime(2026, 3, 2, 9, 0, tzinfo=timezone.utc)
    at = lambda ms: (t0 + timedelta(milliseconds=ms)).isoformat(timespec="milliseconds").replace("+00:00", "Z")
    canonical = lambda value: json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False)

    class Journal:
        def __init__(self, case_id: str, workflow_name: str = "Refund"):
            self.case_id, self.run, self.workflow, self.events = case_id, uid(case_id, "run"), uid(case_id, "workflow"), []
            self.workflow_name = workflow_name

        def u(self, name: str) -> str:
            return uid(self.case_id, name)

        def ev(self, type_: str, ms: int, token=None, node=None, attempt=None, level="execution", **data) -> int:
            seq = len(self.events) + 1
            event = {"spec_version": "1.1", "id": self.u(f"event-{seq}"), "run_id": self.run, "seq": seq, "time": at(ms),
                     "type": type_, "level": level, "workflow_id": self.workflow}
            if token:
                event["token_id"] = self.u(token)
            if node:
                event["node_id"], event["node_name"] = self.u(node), node
            if attempt:
                event["attempt"] = attempt
            event["data"] = data
            self.events.append(event)
            return seq

        def s(self, seq: int) -> str:
            return span(self.run, seq)

        def case(self, case_id, spec, description, expect, options=None, decision_nodes=()):
            return {"id": case_id, "level": "telemetry", "spec": spec, "description": description,
                    "decision_nodes": [self.u(n) for n in decision_nodes], "journal": self.events,
                    "options": options or {"payloads": False}, "expect": {"trace_id": trace(self.run), **expect}}

    cases = []

    # --- 1. Identifiers, the run span and attempts --------------------------------------------
    j = Journal("telemetry-run-and-attempts")
    j.ev("run.started", 0, workflow_name="Refund", workflow_version="1.2.0", input={"order": "O-17", "amount": 40}, simulate=False)
    j.ev("token.created", 0, "T", "Start")
    j.ev("token.moved", 0, "T", "Check request", from_node_id=j.u("Start"), to_node_id=j.u("Check request"), edge_id=j.u("e1"), reason="unconditional")
    a1 = j.ev("activity.started", 10, "T", "Check request", 1, actor_type="application", role_id=j.u("clerk"), input={"order": "O-17"})
    j.ev("activity.completed", 260, "T", "Check request", 1, actor_type="application", output={"valid": True}, duration_ms=250, attempts=1)
    j.ev("token.moved", 265, "T", "Pay refund", from_node_id=j.u("Check request"), to_node_id=j.u("Pay refund"), edge_id=j.u("e2"), reason="unconditional")
    a2 = j.ev("activity.started", 270, "T", "Pay refund", 1, actor_type="robot", input={"amount": 40})
    j.ev("activity.completed", 770, "T", "Pay refund", 1, actor_type="robot", output={"paid": True}, duration_ms=500, attempts=1)
    j.ev("token.completed", 780, "T", "End")
    j.ev("run.completed", 780, duration_ms=780, steps=2, input_tokens=0, output_tokens=0, cost=0.5, currency="EUR")
    run_attrs = {"awa.run.id": j.run, "gen_ai.operation.name": "invoke_workflow", "gen_ai.workflow.name": "Refund", "awa.workflow.id": j.workflow,
                 "awa.workflow.version": "1.2.0", "awa.run.simulated": False, "awa.run.status": "completed", "awa.run.steps": 2,
                 "awa.run.input_tokens": 0, "awa.run.output_tokens": 0, "awa.run.cost": 0.5, "awa.run.currency": "EUR"}
    cases.append(j.case("run-trace-and-attempt-spans", "26.1",
        "A run is one trace whose identifiers derive from the run id. The run span's key event is run.started; each attempt is a span "
        "from activity.started to activity.completed, a child of the run. Events that open or end nothing are span events of the run.", {
            "span_count": 3,
            "spans": [
                {"span_id": j.s(1), "parent_span_id": None, "name": "invoke_workflow Refund", "kind": "internal", "start": at(0), "end": at(780),
                 "status": "ok", "attributes": run_attrs, "absent": ["awa.run.input"],
                 "events": ["token.created", "token.moved", "token.moved", "token.completed"],
                 "events_contain": [{"name": "token.moved", "attributes": {"awa.journal.seq": 3, "awa.journal.level": "execution", "awa.token.id": j.u("T"),
                                                                           "awa.node.name": "Check request", "awa.data.reason": "unconditional", "awa.data.edge_id": j.u("e1")}}]},
                {"span_id": j.s(a1), "parent_span_id": j.s(1), "name": "activity Check request", "kind": "internal", "start": at(10), "end": at(260),
                 "status": "ok", "attributes": {"awa.run.id": j.run, "awa.node.id": j.u("Check request"), "awa.node.name": "Check request", "awa.token.id": j.u("T"),
                                                "awa.attempt": 1, "awa.actor.type": "application", "awa.role.id": j.u("clerk")},
                 "absent": ["gen_ai.operation.name", "awa.input", "awa.output", "error.type"], "events": []},
                {"span_id": j.s(a2), "parent_span_id": j.s(1), "name": "activity Pay refund", "start": at(270), "end": at(770), "status": "ok",
                 "attributes": {"awa.actor.type": "robot"}},
            ]}))

    # --- 2. AI agent attempts and model calls -------------------------------------------------
    j = Journal("telemetry-agent-and-model")
    j.ev("run.started", 0, workflow_name="Reply", workflow_version="1.0.0", input={}, simulate=False)
    j.ev("token.created", 0, "T", "Draft reply")
    m = {"id": "model-a", "provider": "google", "requested": "tier:balanced", "tier": "balanced", "source": "role", "temperature": 0.2}
    a1 = j.ev("activity.started", 0, "T", "Draft reply", 1, actor_type="ai_agent", input={"question": "Where is my parcel?"})
    m1 = j.ev("meta.recorded", 400, "T", "Draft reply", 1, level="meta", subject="model_selection", decision="Use model google:model-a", rationale="The role names this model.", model=m)
    j.ev("reasoning.recorded", 400, "T", "Draft reply", 1, level="reasoning", source="actor", plan=["look up parcel", "answer"], rationale="The tracking page shows it in transit.", confidence=0.7)
    j.ev("contract.checked", 401, "T", "Draft reply", 1, passed=False, violations=[{"kind": "schema", "name": "schema", "message": "/eta must be string"}], tokens_used=120, output_hash="ab" * 32)
    j.ev("activity.failed", 401, "T", "Draft reply", 1, error={"message": "Outcome contract violated: /eta must be string", "code": "CONTRACT_VIOLATION"}, retryable=True, duration_ms=401)
    j.ev("meta.recorded", 401, "T", "Draft reply", 1, level="meta", subject="contract_retry", decision="Re-execute with the violated contract terms as feedback", rationale="1 contract term(s) did not hold.")
    a2 = j.ev("activity.started", 402, "T", "Draft reply", 2, actor_type="ai_agent", input={"question": "Where is my parcel?"}, feedback="/eta must be string")
    m2 = j.ev("meta.recorded", 900, "T", "Draft reply", 2, level="meta", subject="model_selection", decision="Use model google:model-a", rationale="The role names this model.", model=m)
    j.ev("contract.checked", 901, "T", "Draft reply", 2, passed=True, violations=[], tokens_used=465, output_hash="cd" * 32)
    j.ev("activity.completed", 901, "T", "Draft reply", 2, actor_type="ai_agent", output={"eta": "tomorrow"}, duration_ms=499, attempts=2, usage={"input_tokens": 300, "output_tokens": 45})
    j.ev("token.completed", 901, "T", "Draft reply")
    j.ev("run.completed", 901, duration_ms=901, steps=1, input_tokens=420, output_tokens=45, cost=0.0123, currency="EUR")
    model_attrs = {"gen_ai.operation.name": "chat", "gen_ai.provider.name": "gcp.gemini", "awa.model.provider": "google", "gen_ai.request.model": "model-a",
                   "gen_ai.response.model": "model-a", "gen_ai.request.temperature": 0.2, "awa.model.tier": "balanced", "awa.model.requested": "tier:balanced",
                   "awa.model.source": "role", "awa.attempt": 1}
    cases.append(j.case("agent-attempts-and-model-calls", "26.5",
        "An AI agent's attempt is an invoke_agent span. Each model_selection is a chat span (kind client) under its attempt, from the attempt's start to "
        "the record of the model. Usage comes from the activity.completed that ends the attempt; a rejected attempt has none. The provider google is gcp.gemini.", {
            "span_count": 5,
            "spans": [
                {"span_id": j.s(1), "parent_span_id": None, "status": "ok", "attributes": {"awa.run.input_tokens": 420, "awa.run.output_tokens": 45, "awa.run.cost": 0.0123},
                 "absent": ["gen_ai.usage.input_tokens"], "events": ["token.created", "meta.recorded", "token.completed"]},
                {"span_id": j.s(a1), "parent_span_id": j.s(1), "name": "invoke_agent Draft reply", "start": at(0), "end": at(401),
                 "status": "error", "status_message": "Outcome contract violated: /eta must be string",
                 "attributes": {"gen_ai.operation.name": "invoke_agent", "gen_ai.agent.name": "Draft reply", "gen_ai.agent.id": j.u("Draft reply"),
                                "awa.actor.type": "ai_agent", "error.type": "CONTRACT_VIOLATION", "awa.error.retryable": True, "awa.attempt": 1},
                 "events": ["reasoning.recorded", "contract.checked"],
                 "events_contain": [{"name": "reasoning.recorded", "attributes": {"awa.journal.level": "reasoning", "awa.attempt": 1, "awa.data.source": "actor",
                                                                                  "awa.data.rationale": "The tracking page shows it in transit.", "awa.data.confidence": 0.7,
                                                                                  "awa.data.plan": canonical(["look up parcel", "answer"])}},
                                    {"name": "contract.checked", "attributes": {"awa.data.passed": False, "awa.data.tokens_used": 120}}]},
                {"span_id": j.s(m1), "parent_span_id": j.s(a1), "name": "chat model-a", "kind": "client", "start": at(0), "end": at(400), "status": "ok",
                 "attributes": model_attrs, "absent": ["gen_ai.usage.input_tokens", "gen_ai.usage.output_tokens"], "events": []},
                {"span_id": j.s(a2), "parent_span_id": j.s(1), "name": "invoke_agent Draft reply", "start": at(402), "end": at(901), "status": "ok",
                 "attributes": {"awa.attempt": 2}, "absent": ["error.type", "awa.input"], "events": ["contract.checked"]},
                {"span_id": j.s(m2), "parent_span_id": j.s(a2), "name": "chat model-a", "kind": "client", "start": at(402), "end": at(900), "status": "ok",
                 "attributes": {**model_attrs, "awa.attempt": 2, "gen_ai.usage.input_tokens": 300, "gen_ai.usage.output_tokens": 45}},
            ]}))

    # --- 3. Tool calls -------------------------------------------------------------------------
    j = Journal("telemetry-tools")
    j.ev("run.started", 0, workflow_name="Check cover", input={}, simulate=False)
    j.ev("token.created", 0, "T", "Verify cover")
    a = j.ev("activity.started", 0, "T", "Verify cover", 1, actor_type="application", input={"policy": "P-1"})
    c1 = j.ev("tool.invoked", 10, "T", "Verify cover", 1, call_id="c1", tool="get_policy", link="https://policies.example/api/policies/P-1",
              binding={"kind": "http", "method": "GET", "url": "https://policies.example/api/policies/P-1"}, arguments={"policy": "P-1"})
    j.ev("tool.completed", 160, "T", "Verify cover", 1, call_id="c1", tool="get_policy", link="https://policies.example/api/policies/P-1", status=200, duration_ms=150, result={"covered": True})
    c2 = j.ev("tool.failed", 170, "T", "Verify cover", 1, call_id="c2", tool="get_policy", invoked=False,
              error={"message": "Invalid arguments for \"get_policy\": arguments must have required property 'policy'", "code": "VALIDATION_ERROR"}, duration_ms=0)
    c3 = j.ev("tool.invoked", 180, "T", "Verify cover", 1, call_id="c3", tool="notify", link="https://notify.example/rpc#send",
              binding={"kind": "jsonrpc", "endpoint": "https://notify.example/rpc", "method": "send"}, arguments={"to": "a@example.org"})
    j.ev("tool.failed", 380, "T", "Verify cover", 1, call_id="c3", tool="notify", link="https://notify.example/rpc#send", invoked=True,
         error={"message": "Service unavailable", "code": "TOOL_ERROR"}, status=503, duration_ms=200)
    j.ev("activity.completed", 400, "T", "Verify cover", 1, actor_type="application", output={"covered": True}, duration_ms=400, attempts=1)
    j.ev("token.completed", 400, "T", "Verify cover")
    j.ev("run.completed", 400, duration_ms=400, steps=1, input_tokens=0, output_tokens=0, cost=0, currency="EUR")
    cases.append(j.case("tool-calls-are-spans", "26.2",
        "Each tool call is an execute_tool span under its attempt, matched by call_id. A call refused before it ran is a span of no duration keyed by its "
        "tool.failed. A failed call is an error, with the error's code as error.type. Arguments and results stay off spans unless the deployment opts in.", {
            "span_count": 5,
            "spans": [
                {"span_id": j.s(a), "events": []},
                {"span_id": j.s(c1), "parent_span_id": j.s(a), "name": "execute_tool get_policy", "kind": "internal", "start": at(10), "end": at(160), "status": "ok",
                 "attributes": {"gen_ai.operation.name": "execute_tool", "gen_ai.tool.name": "get_policy", "gen_ai.tool.call.id": "c1",
                                "awa.tool.link": "https://policies.example/api/policies/P-1", "awa.tool.binding": "http", "awa.tool.status": 200, "awa.tool.invoked": True,
                                "awa.attempt": 1, "awa.node.name": "Verify cover"},
                 "absent": ["gen_ai.tool.call.arguments", "gen_ai.tool.call.result", "error.type"]},
                {"span_id": j.s(c2), "parent_span_id": j.s(a), "name": "execute_tool get_policy", "start": at(170), "end": at(170), "status": "error",
                 "status_message": "Invalid arguments for \"get_policy\": arguments must have required property 'policy'",
                 "attributes": {"awa.tool.invoked": False, "error.type": "VALIDATION_ERROR", "gen_ai.tool.call.id": "c2"}, "absent": ["awa.tool.binding", "awa.tool.status"]},
                {"span_id": j.s(c3), "parent_span_id": j.s(a), "name": "execute_tool notify", "start": at(180), "end": at(380), "status": "error",
                 "status_message": "Service unavailable", "attributes": {"awa.tool.status": 503, "error.type": "TOOL_ERROR", "awa.tool.binding": "jsonrpc", "awa.tool.invoked": True}},
            ]}))

    # --- 4. Decisions, by table and by model -------------------------------------------------
    j = Journal("telemetry-decisions")
    j.ev("run.started", 0, workflow_name="Settle", input={}, simulate=False)
    j.ev("token.created", 0, "T", "Assess")
    j.ev("activity.started", 0, "T", "Assess", 1, actor_type="application", input={})
    j.ev("activity.completed", 100, "T", "Assess", 1, actor_type="application", output={"score": 0.2}, duration_ms=100, attempts=1)
    d1 = j.ev("token.moved", 101, "T", "Route", from_node_id=j.u("Assess"), to_node_id=j.u("Route"), edge_id=j.u("e1"), reason="unconditional")
    j.ev("decision.evaluated", 103, "T", "Route", method="table", strategy="table", hit_policy="first", inputs={"score": 0.2}, matched=True,
         matched_rules=[{"index": 1, "input_entries": ["< 0.3"], "description": "Clean"}], outputs={"route": "auto"}, edge_id=j.u("auto"), used_default=False)
    d2 = j.ev("token.moved", 104, "T", "Second look", from_node_id=j.u("Route"), to_node_id=j.u("Second look"), edge_id=j.u("auto"), reason="decision")
    mm = j.ev("meta.recorded", 450, "T", "Second look", level="meta", subject="model_selection", decision="Use model acme:classifier-small", rationale="The decision names this model.",
              model={"provider": "acme", "id": "classifier-small", "requested": "tier:fast", "tier": "fast"})
    j.ev("reasoning.recorded", 450, "T", "Second look", level="reasoning", source="decision_model", rationale="Unusual pattern of repairs.", confidence=0.84, plan=[], option="review")
    j.ev("decision.evaluated", 451, "T", "Second look", method="model", strategy="table_first", hit_policy="first", inputs={"score": 0.2}, matched=True, matched_rules=[],
         outputs={"option": "review", "confidence": 0.84}, edge_id=j.u("review"), used_default=False,
         model={"option": "review", "confidence": 0.84, "min_confidence": 0.6, "votes": [{"option": "review", "confidence": 0.84}], "usage": {"input_tokens": 203, "output_tokens": 41}})
    j.ev("token.moved", 452, "T", "Adjuster review", from_node_id=j.u("Second look"), to_node_id=j.u("Adjuster review"), edge_id=j.u("review"), reason="decision")
    j.ev("token.completed", 452, "T", "Adjuster review")
    j.ev("run.completed", 452, duration_ms=452, steps=1, input_tokens=203, output_tokens=41, cost=0.001, currency="EUR")
    cases.append(j.case("decisions-are-spans", "26.2",
        "A decision is a span from the token's arrival at the decision node to decision.evaluated. A model decision has a chat span under it, from that arrival "
        "to the record of the model, with the decision's usage. The arrival is also a span event of the run.", {
            "span_count": 5,
            "spans": [
                {"span_id": j.s(1), "events": ["token.created", "token.moved", "token.moved", "token.moved", "token.completed"]},
                {"span_id": j.s(d1), "parent_span_id": j.s(1), "name": "decision Route", "kind": "internal", "start": at(101), "end": at(103), "status": "ok",
                 "attributes": {"awa.node.id": j.u("Route"), "awa.token.id": j.u("T"), "awa.decision.method": "table", "awa.decision.strategy": "table",
                                "awa.decision.hit_policy": "first", "awa.decision.matched_rules": [1], "awa.decision.outputs": canonical({"route": "auto"}),
                                "awa.decision.edge_id": j.u("auto"), "awa.decision.used_default": False},
                 "absent": ["awa.decision.inputs", "awa.decision.option", "awa.attempt"], "events": []},
                {"span_id": j.s(d2), "parent_span_id": j.s(1), "name": "decision Second look", "start": at(104), "end": at(451), "status": "ok",
                 "attributes": {"awa.decision.method": "model", "awa.decision.matched_rules": [], "awa.decision.option": "review", "awa.decision.confidence": 0.84},
                 "events": ["reasoning.recorded"]},
                {"span_id": j.s(mm), "parent_span_id": j.s(d2), "name": "chat classifier-small", "kind": "client", "start": at(104), "end": at(450), "status": "ok",
                 "attributes": {"gen_ai.provider.name": "acme", "gen_ai.request.model": "classifier-small", "gen_ai.usage.input_tokens": 203, "gen_ai.usage.output_tokens": 41},
                 "absent": ["awa.attempt", "gen_ai.request.temperature"]},
            ]}, decision_nodes=("Route", "Second look")))

    # --- 5. Waits --------------------------------------------------------------------------------
    j = Journal("telemetry-waits")
    hour, day = 3_600_000, 86_400_000
    j.ev("run.started", 0, workflow_name="Approve", input={}, simulate=False)
    j.ev("token.created", 0, "T", "Approve refund")
    a = j.ev("activity.started", 0, "T", "Approve refund", 1, actor_type="human", input={})
    w1 = j.ev("token.waiting", 5, "T", "Approve refund", reason="human_task", human_task_id="task-1")
    j.ev("run.waiting", 5, waiting_for="human", waiting_tokens=[j.u("T")])
    j.ev("token.resumed", hour + 5, "T", "Approve refund", waited_ms=hour)
    j.ev("activity.completed", hour + 5, "T", "Approve refund", actor_type="human", output={"approved": True}, waited_ms=hour)
    j.ev("token.moved", hour + 10, "T", "Payment confirmed", from_node_id=j.u("Approve refund"), to_node_id=j.u("Payment confirmed"), edge_id=j.u("e1"), reason="unconditional")
    w2 = j.ev("event.waiting", hour + 10, "T", "Payment confirmed", name="payment.confirmed", correlation_key="order_id", correlation_value="O-17", due_at=at(hour + 10 + day))
    j.ev("event.timed_out", hour + 10 + day, "T", "Payment confirmed", name="payment.confirmed", due_at=at(hour + 10 + day))
    j.ev("token.moved", hour + 11 + day, "T", "Cool-off", from_node_id=j.u("Payment confirmed"), to_node_id=j.u("Cool-off"), edge_id=j.u("e2"), reason="unconditional")
    w3 = j.ev("timer.started", hour + 11 + day, "T", "Cool-off", duration="PT1H", duration_ms=hour, due_at=at(2 * hour + 11 + day))
    j.ev("timer.fired", 2 * hour + 11 + day, "T", "Cool-off", due_at=at(2 * hour + 11 + day))
    j.ev("token.completed", 2 * hour + 11 + day, "T", "Cool-off")
    j.ev("run.completed", 2 * hour + 11 + day, duration_ms=2 * hour + 11 + day, steps=1, input_tokens=0, output_tokens=0, cost=0, currency="EUR")
    cases.append(j.case("waits-are-spans", "26.2",
        "A person's task, a business event and a timer are each a wait span. A person's wait is a child of the attempt it interrupts, which an "
        "activity.completed without attempt ends. A wait that runs out is unset, not an error. The correlation value is a payload.", {
            "span_count": 5,
            "spans": [
                {"span_id": j.s(1), "events": ["token.created", "run.waiting", "token.moved", "token.moved", "token.completed"],
                 "events_contain": [{"name": "run.waiting", "attributes": {"awa.data.waiting_for": "human", "awa.data.waiting_tokens": canonical([j.u("T")])},
                                     "absent": ["awa.token.id", "awa.attempt"]}]},
                {"span_id": j.s(a), "parent_span_id": j.s(1), "name": "activity Approve refund", "start": at(0), "end": at(hour + 5), "status": "ok",
                 "attributes": {"awa.actor.type": "human"}},
                {"span_id": j.s(w1), "parent_span_id": j.s(a), "name": "wait Approve refund", "kind": "internal", "start": at(5), "end": at(hour + 5), "status": "ok",
                 "attributes": {"awa.wait.kind": "human", "awa.wait.reason": "human_task", "awa.human_task.id": "task-1", "awa.wait.outcome": "resumed", "awa.wait.waited_ms": hour},
                 "events": []},
                {"span_id": j.s(w2), "parent_span_id": j.s(1), "name": "wait Payment confirmed", "start": at(hour + 10), "end": at(hour + 10 + day), "status": "unset",
                 "attributes": {"awa.wait.kind": "event", "awa.business_event.name": "payment.confirmed", "awa.business_event.correlation_key": "order_id",
                                "awa.business_event.due_at": at(hour + 10 + day), "awa.wait.outcome": "timed_out"},
                 "absent": ["awa.business_event.correlation_value", "awa.business_event.id"]},
                {"span_id": j.s(w3), "parent_span_id": j.s(1), "name": "wait Cool-off", "start": at(hour + 11 + day), "end": at(2 * hour + 11 + day), "status": "ok",
                 "attributes": {"awa.wait.kind": "timer", "awa.timer.duration": "PT1H", "awa.timer.due_at": at(2 * hour + 11 + day), "awa.wait.outcome": "fired"}},
            ]}))

    # --- 6. A failed run -----------------------------------------------------------------------
    j = Journal("telemetry-failed-run")
    j.ev("run.started", 0, workflow_name="Post", input={}, simulate=False)
    j.ev("token.created", 0, "T1", "Post ledger")
    j.ev("token.created", 0, "T2", "Write letter", parent_token_id=j.u("T1"), reason="parallel_split")
    a1 = j.ev("activity.started", 1, "T1", "Post ledger", 1, actor_type="application", input={})
    a2 = j.ev("activity.started", 2, "T2", "Write letter", 1, actor_type="ai_agent", input={})
    j.ev("activity.failed", 50, "T1", "Post ledger", 1, error={"message": "Ledger unavailable", "code": "LEDGER_DOWN"}, retryable=False, duration_ms=49)
    j.ev("activity.dead_lettered", 50, "T1", "Post ledger", 1, error={"message": "Ledger unavailable", "code": "LEDGER_DOWN"}, attempts=1)
    j.ev("token.failed", 50, "T1", "Post ledger", error={"message": "Ledger unavailable", "code": "LEDGER_DOWN"})
    j.ev("token.cancelled", 51, "T2", "Write letter", reason="run_failed")
    j.ev("run.failed", 52, duration_ms=52, steps=0, input_tokens=0, output_tokens=0, cost=0, currency="EUR",
         errors=[{"token_id": j.u("T1"), "node_id": j.u("Post ledger"), "message": "Ledger unavailable"}])
    cases.append(j.case("failed-run-ends-open-spans", "26.3",
        "A failed run is an error described by its first error. A token that is cancelled ends its open spans, unset, after the cancellation "
        "is recorded on the innermost of them.", {
            "span_count": 3,
            "spans": [
                {"span_id": j.s(1), "status": "error", "status_message": "Ledger unavailable", "end": at(52), "attributes": {"awa.run.status": "failed"},
                 "events": ["token.created", "token.created", "activity.dead_lettered", "token.failed"],
                 "events_contain": [{"name": "token.failed", "attributes": {"awa.data.error": canonical({"code": "LEDGER_DOWN", "message": "Ledger unavailable"})}}]},
                {"span_id": j.s(a1), "status": "error", "status_message": "Ledger unavailable", "end": at(50), "attributes": {"error.type": "LEDGER_DOWN", "awa.error.retryable": False}},
                {"span_id": j.s(a2), "status": "unset", "end": at(51), "events": ["token.cancelled"], "absent": ["error.type"]},
            ]}))

    # --- 7. A cancelled run ----------------------------------------------------------------------
    j = Journal("telemetry-cancelled-run")
    j.ev("run.started", 0, workflow_name="Remind", input={}, simulate=False)
    j.ev("token.created", 0, "T", "Payment received")
    w = j.ev("event.waiting", 0, "T", "Payment received", name="payment.received", due_at=at(day))
    j.ev("run.waiting", 0, waiting_for="event", waiting_tokens=[j.u("T")])
    j.ev("token.cancelled", 5000, "T", "Payment received", reason="run_cancelled")
    j.ev("run.cancelled", 5000, reason="the customer left")
    cases.append(j.case("cancelled-run-is-unset", "26.3",
        "A cancelled run is neither ok nor an error. The wait its token was in ends, unset, when the token is cancelled.", {
            "span_count": 2,
            "spans": [
                {"span_id": j.s(1), "status": "unset", "end": at(5000), "attributes": {"awa.run.status": "cancelled", "awa.run.cancel_reason": "the customer left"},
                 "absent": ["awa.incomplete"], "events": ["token.created", "run.waiting"]},
                {"span_id": j.s(w), "parent_span_id": j.s(1), "status": "unset", "end": at(5000), "events": ["token.cancelled"], "absent": ["awa.wait.outcome"]},
            ]}))

    # --- 8 to 10. Payloads ---------------------------------------------------------------------
    def payload_journal(case_id: str, mode: str) -> Journal:
        p = (lambda v: v) if mode == "full" else (lambda v: {"sha256": hashlib.sha256(canonical(v).encode()).hexdigest()})
        j = Journal(case_id)
        j.ev("run.started", 0, workflow_name="Refund", input=p({"order": "O-17"}), simulate=False)
        j.ev("token.created", 0, "T", "Pay")
        j.ev("activity.started", 0, "T", "Pay", 1, actor_type="application", input=p({"amount": 40}))
        j.ev("tool.invoked", 1, "T", "Pay", 1, call_id="c1", tool="transfer", link="https://bank.example/rpc#transfer", binding={"kind": "jsonrpc"}, arguments=p({"iban": "FR76"}))
        j.ev("tool.completed", 2, "T", "Pay", 1, call_id="c1", tool="transfer", link="https://bank.example/rpc#transfer", status=200, duration_ms=1, result=p({"ref": "TX-9"}))
        j.ev("activity.completed", 3, "T", "Pay", 1, actor_type="application", output=p({"paid": True}), duration_ms=3, attempts=1)
        j.ev("event.published", 3, "T", "Refunded", event_id="ev-1", name="refund.paid", source="urn:awa:run:x", data=p({"order": "O-17"}), delivered=True)
        j.ev("token.completed", 3, "T", "Refunded")
        j.ev("run.completed", 3, duration_ms=3, steps=1, input_tokens=0, output_tokens=0, cost=0, currency="EUR")
        return j

    for case_id, mode, payloads, description in [
        ("payloads-stay-off-spans-by-default", "full", False,
         "A journal in full payload mode, exported without opting in: no input, output, argument, result or event data is on any span or span event."),
        ("payloads-on-spans-when-opted-in", "full", True,
         "The same journal with the deployment opted in: each payload is on its span as canonical JSON, and event data is on the span event."),
        ("payloads-are-hashes-in-hash-mode", "hash", True,
         "A journal in hash mode, opted in: telemetry carries what the journal holds, the hash and never the value."),
    ]:
        j = payload_journal(case_id.replace("payloads", "telemetry-payloads"), mode)
        shown = (lambda v: canonical(v)) if mode == "full" else (lambda v: canonical({"sha256": hashlib.sha256(canonical(v).encode()).hexdigest()}))
        keys = {"run": "awa.run.input", "in": "awa.input", "out": "awa.output", "args": "gen_ai.tool.call.arguments", "res": "gen_ai.tool.call.result", "event": "awa.data.data"}
        if payloads:
            spans = [
                {"span_id": j.s(1), "attributes": {"awa.run.input": shown({"order": "O-17"})},
                 "events_contain": [{"name": "event.published", "attributes": {"awa.data.data": shown({"order": "O-17"}), "awa.data.name": "refund.paid"}}]},
                {"span_id": j.s(3), "attributes": {"awa.input": shown({"amount": 40}), "awa.output": shown({"paid": True})}},
                {"span_id": j.s(4), "attributes": {"gen_ai.tool.call.arguments": shown({"iban": "FR76"}), "gen_ai.tool.call.result": shown({"ref": "TX-9"})}},
            ]
        else:
            spans = [
                {"span_id": j.s(1), "absent": [keys["run"]],
                 "events_contain": [{"name": "event.published", "attributes": {"awa.data.name": "refund.paid", "awa.data.delivered": True}, "absent": ["awa.data.data"]}]},
                {"span_id": j.s(3), "absent": [keys["in"], keys["out"]]},
                {"span_id": j.s(4), "absent": [keys["args"], keys["res"]]},
            ]
        cases.append(j.case(case_id, "26.6", description, {"span_count": 3, "spans": spans}, options={"payloads": payloads}))

    # --- 11. An unfinished run ------------------------------------------------------------------
    j = Journal("telemetry-unfinished")
    j.ev("run.started", 0, workflow_name="Order", input={}, simulate=False)
    j.ev("token.created", 0, "T", "Take order")
    a = j.ev("activity.started", 0, "T", "Take order", 1, actor_type="application", input={})
    j.ev("activity.completed", 20, "T", "Take order", 1, actor_type="application", output={}, duration_ms=20, attempts=1)
    j.ev("token.moved", 21, "T", "Paid", from_node_id=j.u("Take order"), to_node_id=j.u("Paid"), edge_id=j.u("e1"), reason="unconditional")
    w = j.ev("event.waiting", 21, "T", "Paid", name="order.paid", due_at=at(day))
    j.ev("run.waiting", 22, waiting_for="event", waiting_tokens=[j.u("T")])
    cases.append(j.case("unfinished-run-ends-at-its-last-event", "26.8",
        "A run still waiting: an export ends what is open at the time of the last event, unset and marked incomplete. What had ended is as it was.", {
            "span_count": 3,
            "spans": [
                {"span_id": j.s(a), "status": "ok", "end": at(20), "absent": ["awa.incomplete"]},
                {"span_id": j.s(w), "parent_span_id": j.s(1), "status": "unset", "start": at(21), "end": at(22), "attributes": {"awa.incomplete": True}, "absent": ["awa.wait.outcome"]},
                {"span_id": j.s(1), "status": "unset", "end": at(22), "attributes": {"awa.incomplete": True}, "absent": ["awa.run.status"]},
            ]}))

    # --- 12. Journeys ------------------------------------------------------------------------------
    inst = uid("telemetry-journey", "instance")
    journey_id = uid("telemetry-journey", "journey")
    r1, r2 = uid("telemetry-journey", "run-1"), uid("telemetry-journey", "run-2")
    jevents = []

    def jev(type_: str, ms: int, stage=None, run=None, **data) -> int:
        seq = len(jevents) + 1
        event = {"spec_version": "1.1", "journey_instance_id": inst, "journey_id": journey_id, "seq": seq, "time": at(ms), "type": type_}
        if stage:
            event["stage_id"] = stage
        if run:
            event["run_id"] = run
        event["data"] = data
        jevents.append(event)
        return seq

    js = jev("journey.started", 0, "intake", subject="customer", subject_key="C-1", journey_name="Motor claim")
    s1 = jev("journey.stage_entered", 0, "intake", stage_name="Intake", reason="journey started")
    jev("journey.event_received", 1, "intake", event_id="e1", name="claim.submitted", source="/portal", data={"customer_id": "C-1", "amount": 1200})
    k1 = jev("journey.run_started", 2, "intake", r1, workflow_id=uid("telemetry-journey", "wf-intake"), workflow_name="Claim intake", caused_by_event="e1")
    jev("journey.touchpoint", 3, "intake", r1, touchpoint_id="tp-ack", name="Acknowledgement", channel="email", direction="outbound")
    jev("journey.run_ended", 900, "intake", r1, workflow_name="Claim intake", status="completed")
    jev("journey.stage_completed", 900, "intake", stage_name="Intake", duration_ms=900)
    s2 = jev("journey.stage_entered", 900, "settle", stage_name="Settlement", reason="stage intake completed")
    k2 = jev("journey.run_started", 901, "settle", r2, workflow_id=uid("telemetry-journey", "wf-settle"), workflow_name="Claim settlement")
    jev("journey.run_ended", 2000, "settle", r2, workflow_name="Claim settlement", status="failed", error="Payment failed")
    jev("journey.stalled", 2000, "settle", r2, stage_name="Settlement", reason="the Claim settlement workflow failed", owner="claims-team")
    jev("journey.completed", 5000, "settle", reason="claim.closed", event_id="e9")
    cases.append({
        "id": "journey-trace-links-to-runs", "level": "telemetry", "spec": "26.7",
        "description": "A journey instance is one trace: the journey, its stages and the runs done for it. Each run span links to the run span of that run's own "
                       "trace. A stage left without completing is unset. Events land on the run, else the stage, they name.",
        "journey": jevents, "options": {"payloads": False},
        "expect": {
            "trace_id": jtrace(inst), "span_count": 5,
            "spans": [
                {"span_id": jspan(inst, js), "parent_span_id": None, "name": "journey Motor claim", "kind": "internal", "start": at(0), "end": at(5000), "status": "ok",
                 "attributes": {"awa.journey.instance_id": inst, "awa.journey.id": journey_id, "awa.journey.name": "Motor claim", "awa.journey.subject": "customer",
                                "awa.journey.status": "completed", "awa.journey.reason": "claim.closed"},
                 "absent": ["awa.journey.subject_key"], "events": []},
                {"span_id": jspan(inst, s1), "parent_span_id": jspan(inst, js), "name": "stage Intake", "start": at(0), "end": at(900), "status": "ok",
                 "attributes": {"awa.journey.stage.id": "intake", "awa.journey.stage.name": "Intake", "awa.journey.stage.outcome": "completed"},
                 "events": ["journey.event_received"],
                 "events_contain": [{"name": "journey.event_received", "attributes": {"awa.journey.seq": 3, "awa.journey.stage.id": "intake", "awa.data.name": "claim.submitted"},
                                     "absent": ["awa.data.data"]}]},
                {"span_id": jspan(inst, k1), "parent_span_id": jspan(inst, s1), "name": "run Claim intake", "start": at(2), "end": at(900), "status": "ok",
                 "attributes": {"awa.run.id": r1, "awa.workflow.name": "Claim intake", "awa.business_event.id": "e1", "awa.run.status": "completed", "awa.journey.stage.id": "intake"},
                 "links": [{"trace_id": trace(r1), "span_id": span(r1, 1)}], "events": ["journey.touchpoint"]},
                {"span_id": jspan(inst, s2), "parent_span_id": jspan(inst, js), "name": "stage Settlement", "start": at(900), "end": at(5000), "status": "unset",
                 "attributes": {"awa.journey.stage.outcome": "left"}, "events": ["journey.stalled"]},
                {"span_id": jspan(inst, k2), "parent_span_id": jspan(inst, s2), "name": "run Claim settlement", "start": at(901), "end": at(2000), "status": "error",
                 "status_message": "Payment failed", "attributes": {"awa.run.status": "failed"}, "absent": ["awa.business_event.id"],
                 "links": [{"trace_id": trace(r2), "span_id": span(r2, 1)}]},
            ]},
    })

    # --- 13. OTLP/JSON encoding -----------------------------------------------------------------
    j = Journal("telemetry-encoding")
    j.ev("run.started", 0, workflow_name="Tiny", workflow_version="1.0.0", input={}, simulate=True)
    j.ev("token.created", 0, "T", "Score")
    j.ev("activity.started", 1, "T", "Score", 1, actor_type="ai_agent", input={})
    j.ev("activity.failed", 3, "T", "Score", 1, error={"message": "No reply"}, retryable=False, duration_ms=2)
    j.ev("token.failed", 3, "T", "Score", error={"message": "No reply"})
    j.ev("run.failed", 4, duration_ms=4, steps=0, input_tokens=0, output_tokens=0, cost=0.25, currency="EUR", errors=[{"message": "No reply"}])
    ns = lambda ms: str(int((t0 + timedelta(milliseconds=ms)).timestamp() * 1000) * 1_000_000)
    kv = lambda key, value: {"key": key, "value": value}
    s, i, d, b = (lambda v: {"stringValue": v}), (lambda v: {"intValue": str(v)}), (lambda v: {"doubleValue": v}), (lambda v: {"boolValue": v})
    otlp = {"resourceSpans": [{
        "resource": {"attributes": [kv("service.name", s("awa"))]},
        "scopeSpans": [{
            "scope": {"name": "awa", "version": "1.1"},
            "spans": [
                {"traceId": trace(j.run), "spanId": j.s(3), "parentSpanId": j.s(1), "name": "invoke_agent Score", "kind": 1,
                 "startTimeUnixNano": ns(1), "endTimeUnixNano": ns(3),
                 "attributes": [kv("awa.run.id", s(j.run)), kv("awa.node.id", s(j.u("Score"))), kv("awa.node.name", s("Score")), kv("awa.token.id", s(j.u("T"))),
                                kv("awa.attempt", i(1)), kv("awa.actor.type", s("ai_agent")), kv("gen_ai.operation.name", s("invoke_agent")),
                                kv("gen_ai.agent.name", s("Score")), kv("gen_ai.agent.id", s(j.u("Score"))), kv("error.type", s("_OTHER")), kv("awa.error.retryable", b(False))],
                 "events": [], "links": [], "status": {"code": 2, "message": "No reply"}},
                {"traceId": trace(j.run), "spanId": j.s(1), "name": "invoke_workflow Tiny", "kind": 1,
                 "startTimeUnixNano": ns(0), "endTimeUnixNano": ns(4),
                 "attributes": [kv("awa.run.id", s(j.run)), kv("gen_ai.operation.name", s("invoke_workflow")), kv("gen_ai.workflow.name", s("Tiny")),
                                kv("awa.workflow.id", s(j.workflow)), kv("awa.workflow.version", s("1.0.0")), kv("awa.run.simulated", b(True)),
                                kv("awa.run.status", s("failed")), kv("awa.run.steps", i(0)), kv("awa.run.input_tokens", i(0)), kv("awa.run.output_tokens", i(0)),
                                kv("awa.run.cost", d(0.25)), kv("awa.run.currency", s("EUR"))],
                 "events": [
                     {"timeUnixNano": ns(0), "name": "token.created", "attributes": [kv("awa.journal.seq", i(2)), kv("awa.journal.level", s("execution")),
                                                                                     kv("awa.token.id", s(j.u("T"))), kv("awa.node.id", s(j.u("Score"))), kv("awa.node.name", s("Score"))]},
                     {"timeUnixNano": ns(3), "name": "token.failed", "attributes": [kv("awa.journal.seq", i(5)), kv("awa.journal.level", s("execution")),
                                                                                    kv("awa.token.id", s(j.u("T"))), kv("awa.node.id", s(j.u("Score"))), kv("awa.node.name", s("Score")),
                                                                                    kv("awa.data.error", s(canonical({"message": "No reply"})))]},
                 ],
                 "links": [], "status": {"code": 2, "message": "No reply"}},
            ]}]}]}
    cases.append(j.case("otlp-json-encoding", "26.9",
        "The OTLP/JSON request for a small run: hexadecimal identifiers, nanosecond times and 64-bit integers as decimal strings, kinds and status codes as "
        "numbers, the resource and the scope. Spans in the order they end. Attributes may come in any order.", {"span_count": 2, "otlp_json": otlp}))

    # --- 14. Measures as gauges ------------------------------------------------------------------
    report = {
        "spec_version": "1.1", "as_of": "2026-03-31T00:00:00.000Z", "period": {"from": "2026-03-01T00:00:00.000Z", "to": "2026-03-31T00:00:00.000Z"}, "currency": "EUR",
        "totals": {}, "attention": [], "series": {"bucket": "day", "points": []},
        "journeys": [{"name": "Order", "measures": {"journey.started": {"value": 4, "n": 4}, "journey.completion_rate": {"value": 0.5, "n": 4}, "journey.mood_end": {"value": None, "n": 0}},
                      "stages": [{"name": "Placed", "measures": {"stage.duration_median_ms": {"value": 3600000, "n": 2}}}]}],
        "workflows": [{"name": "Fulfil", "measures": {"workflow.success_rate": {"value": 0.75, "n": 4}, "workflow.cost": {"value": 0.04, "n": 4}, "workflow.input_tokens": {"value": 400, "n": 4}},
                       "activities": [{"name": "Pack", "measures": {"activity.attempts": {"value": 5, "n": 5}}}]}],
    }
    cases.append({
        "id": "measures-as-gauges", "level": "telemetry", "spec": "26.12",
        "description": "A measure report sent as OpenTelemetry metrics: one gauge per measure with a value, named awa.<id>, with the labels of the OpenMetrics "
                       "exposition as attributes, the time as_of and the start of the period. A measure with no value sends nothing.",
        "report": report,
        "expect": {
            "metric_count": 7,
            "absent": ["awa.journey.mood_end"],
            "metrics": [
                {"name": "awa.journey.started", "unit": "1", "points": [{"attributes": {"journey": "Order"}, "value": 4}]},
                {"name": "awa.journey.completion_rate", "unit": "1", "points": [{"attributes": {"journey": "Order"}, "value": 0.5}]},
                {"name": "awa.stage.duration_median_ms", "unit": "ms", "points": [{"attributes": {"journey": "Order", "stage": "Placed"}, "value": 3600000}]},
                {"name": "awa.workflow.success_rate", "unit": "1", "points": [{"attributes": {"workflow": "Fulfil"}, "value": 0.75}]},
                {"name": "awa.workflow.cost", "unit": "{EUR}", "points": [{"attributes": {"workflow": "Fulfil"}, "value": 0.04}]},
                {"name": "awa.workflow.input_tokens", "unit": "{token}", "points": [{"attributes": {"workflow": "Fulfil"}, "value": 400}]},
                {"name": "awa.activity.attempts", "unit": "1", "points": [{"attributes": {"workflow": "Fulfil", "activity": "Pack"}, "value": 5}]},
            ],
            "time": "2026-03-31T00:00:00.000Z", "start_time": "2026-03-01T00:00:00.000Z",
        },
    })
    return cases


def main() -> None:
    for folder in ("execution", "documents", "journeys", "replay", "knowledge", "measures", "telemetry"):
        (ROOT / folder).mkdir(exist_ok=True)
        for old in (ROOT / folder).glob("*.json"):
            old.unlink()
    execution = execution_cases() + tool_cases() + model_decision_cases() + routing_cases() + context_cases() + service_level_cases()
    for case in execution:
        write(ROOT / "execution" / f"{case.id}.json", case.build())
    for case in journey_cases():
        write(ROOT / "journeys" / f"{case['id']}.json", case)
    for case in replay_cases():
        write(ROOT / "replay" / f"{case['id']}.json", case)
    for case in knowledge_cases():
        write(ROOT / "knowledge" / f"{case['id']}.json", case)
    for case in measure_cases():
        write(ROOT / "measures" / f"{case['id']}.json", case)
    for doc in document_cases():
        write(ROOT / "documents" / f"{doc['id']}.json", doc)
    for case in telemetry_cases():
        write(ROOT / "telemetry" / f"{case['id']}.json", case)
    tests = unary_tests()
    write(ROOT / "unary-tests.json", tests)
    exprs = expressions()
    write(ROOT / "expressions.json", exprs)
    print(f"wrote {len(exprs['cases']) + len(exprs['invalid'])} expression tests")
    print(f"wrote {len(journey_cases())} journey cases, {len(replay_cases())} replay cases and {len(knowledge_cases())} knowledge cases")
    print(f"wrote {len(telemetry_cases())} telemetry cases")
    print(f"wrote {len(execution)} execution cases, {len(document_cases())} document cases "
          f"and {len(tests['cases']) + len(tests['invalid'])} unary tests")


if __name__ == "__main__":
    main()
