#!/usr/bin/env python3
"""Writes the definitions of this example: two workflows and the journey. Identifiers are derived from names, so the output is stable."""
import json
import pathlib
import uuid

HERE = pathlib.Path(__file__).parent
NS = uuid.UUID("6ba7b811-9dad-11d1-80b4-00c04fd430c8")


def kit(prefix):
    u = lambda name: str(uuid.uuid5(NS, f"awa-example:claims-journey:{prefix}:{name}"))
    act = lambda title, actor, role, desc, **x: {"id": u(title), "name": title, "role_id": u("role:" + role), "actor_type": actor, "description": desc, **x}
    edge = lambda a, b, **x: {"id": u(f"{a}->{b}"), "source_id": u(a), "target_id": u(b), **x}
    def ev(title, kind, desc=None, **definition):
        event = {"id": u(title), "name": title, "event_type": kind}
        if desc:
            event["description"] = desc
        if definition:
            event["event_definition"] = definition
        return event
    def role(key, title, actor, model=None):
        r = {"id": u("role:" + key), "name": title, "actor_type": actor}
        if model:
            r["ai_model_config"] = {"model_id": model, "temperature": 0.2}
        return r
    return u, act, edge, ev, role


def write(name, data):
    (HERE / name).write_text(json.dumps(data, indent=2) + "\n")


u, act, edge, ev, role = kit("intake")
intake = {
    "$schema": "https://awa.io/schema/awa.schema.json", "id": u("workflow"), "name": "Claim Intake", "version": "1.0.0", "awa_version": "1.1",
    "description": "Registers a new claim, asks the customer for the documents that are missing, and waits for them.",
    "roles": [role("claims-system", "Claims system", "application"), role("comms", "Customer communications", "ai_agent", "tier:balanced")],
    "events": [
        ev("Claim submitted", "start", "The customer submits a claim in the portal.", name="claim.submitted"),
        ev("Documents uploaded", "message", "Wait for the customer to upload the documents.", name="documents.uploaded",
           correlation_key="customer_id", timeout="P5D", timeout_edge_id=u("Documents uploaded->Send reminder")),
        ev("Reminder answered", "message", "Wait once more after the reminder.", name="documents.uploaded",
           correlation_key="customer_id", timeout="P5D", timeout_edge_id=u("Reminder answered->Close as incomplete")),
        ev("Claim registered", "message", "Tell other systems the claim is complete.", name="claim.registered", mode="publish", data=["claim_id", "customer_id"]),
        ev("Intake done", "end"),
    ],
    "activities": [
        act("Register claim", "application", "claims-system", "Create the claim record."),
        act("Request documents", "ai_agent", "comms", "Write to the customer listing the documents needed.",
            outcome_contract={"postconditions": [{"name": "Lists the documents", "expression": "documents_requested exists"}]}),
        act("Send reminder", "ai_agent", "comms", "Remind the customer that the documents are still missing."),
        act("Check completeness", "application", "claims-system", "Confirm every required document is present."),
        act("Close as incomplete", "application", "claims-system", "Close the claim because the documents never arrived."),
    ],
    "edges": [
        edge("Claim submitted", "Register claim"), edge("Register claim", "Request documents"), edge("Request documents", "Documents uploaded"),
        edge("Documents uploaded", "Check completeness"), edge("Documents uploaded", "Send reminder", label="no reply in 5 days"),
        edge("Send reminder", "Reminder answered"), edge("Reminder answered", "Check completeness"),
        edge("Reminder answered", "Close as incomplete", label="no reply in 5 more days"),
        edge("Check completeness", "Claim registered"), edge("Claim registered", "Intake done"), edge("Close as incomplete", "Intake done"),
    ],
}
write("claim-intake.awa.json", intake)

u, act, edge, ev, role = kit("followup")
follow = {
    "$schema": "https://awa.io/schema/awa.schema.json", "id": u("workflow"), "name": "Customer Follow-up", "version": "1.0.0", "awa_version": "1.1",
    "description": "After a claim is paid, asks the customer how it went and acts on the answer.",
    "roles": [role("comms", "Customer communications", "ai_agent", "tier:balanced"), role("care", "Customer care agent", "human"), role("crm", "CRM", "application")],
    "events": [
        ev("Survey answered", "message", "Wait for the customer's answer.", name="survey.answered",
           correlation_key="customer_id", timeout="P14D", timeout_edge_id=u("Survey answered->Record no response")),
        ev("Follow-up done", "end"),
    ],
    "activities": [
        act("Send survey", "ai_agent", "comms", "Ask the customer to rate the claim experience from 1 to 5."),
        act("Thank customer", "ai_agent", "comms", "Thank a satisfied customer."),
        act("Call back", "human", "care", "A customer care agent calls a dissatisfied customer."),
        act("Record no response", "application", "crm", "Note that the customer did not answer."),
    ],
    "decision_nodes": [{
        "id": u("How satisfied"), "name": "How satisfied", "description": "Route on the satisfaction score.",
        "decision_table": {
            "hit_policy": "first", "inputs": [{"name": "satisfaction", "label": "Satisfaction", "type": "number"}],
            "outputs": [{"name": "sentiment", "type": "string"}],
            "rules": [
                {"description": "Satisfied", "input_entries": [">= 4"], "output_entries": ["positive"], "output_edge_id": u("How satisfied->Thank customer")},
                {"description": "Not satisfied", "input_entries": ["< 4"], "output_entries": ["negative"], "output_edge_id": u("How satisfied->Call back")},
            ]},
        "default_output_edge_id": u("How satisfied->Call back"),
    }],
    "edges": [
        edge("Send survey", "Survey answered"), edge("Survey answered", "How satisfied"),
        edge("Survey answered", "Record no response", label="no answer in 14 days"),
        edge("How satisfied", "Thank customer"), edge("How satisfied", "Call back"),
        edge("Thank customer", "Follow-up done"), edge("Call back", "Follow-up done"), edge("Record no response", "Follow-up done"),
    ],
}
write("customer-follow-up.awa.json", follow)

settlement = json.loads((HERE / "../claims-settlement/claims-settlement.awa.json").read_text())
u, *_ = kit("journey")
write("motor-claim.journey.json", {
    "id": u("journey"), "name": "Motor Claim", "version": "1.0.0", "awa_version": "1.1",
    "description": "A customer's motor claim, from the day it is reported to the follow-up after payment.",
    "subject": {"name": "customer", "key": "customer_id"},
    "stages": [
        {"id": "reported", "name": "Reported", "description": "The claim is registered and its documents collected.",
         "workflows": [intake["id"]], "complete_when": "documents_complete == true", "max_duration": "P7D"},
        {"id": "settled", "name": "Assessed and settled", "description": "The damage is assessed, the claim is routed, and the customer is paid.",
         "on_enter": {"start_workflow": settlement["id"]}, "complete_when": "paid exists", "max_duration": "P10D"},
        {"id": "followed-up", "name": "Followed up", "description": "The customer is asked how it went.",
         "on_enter": {"start_workflow": follow["id"]}, "complete_when": "followed_up == true", "max_duration": "P21D", "transitions": []},
    ],
    "triggers": [{"event": "claim.submitted", "starts_journey": True, "start_workflow": intake["id"]}],
    "goals": [{"id": "paid", "name": "Claimant paid", "expression": "paid exists"},
              {"id": "satisfied", "name": "Customer satisfied", "expression": "satisfaction >= 4"}],
    "exits": [{"event": "claim.withdrawn", "outcome": "abandoned", "reason": "The customer withdrew the claim"}],
})
print("wrote claim-intake.awa.json, customer-follow-up.awa.json, motor-claim.journey.json")
