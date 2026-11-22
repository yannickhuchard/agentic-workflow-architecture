#!/usr/bin/env python3
"""Writes the definitions of this example: four workflows and three journeys. Identifiers are derived from names, so the output is stable."""
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


u, act, edge, ev, role = kit("purchase")
purchase = {
    "$schema": "https://awa.io/schema/awa.schema.json", "id": u("workflow"), "name": "Policy Purchase", "version": "1.0.0", "awa_version": "1.1",
    "description": "Quotes a motor policy, has the contract signed, takes the first premium and issues the certificate of insurance.",
    "roles": [role("pricing", "Pricing agent", "ai_agent", "tier:reasoning"), role("esign", "E-signature service", "application"),
              role("billing", "Billing", "application"), role("policy-admin", "Policy administration", "application")],
    "events": [
        ev("Quote requested", "start", "A prospect asks for a quote.", name="quote.requested"),
        ev("Quote accepted", "message", "Wait for the prospect to accept the quote.", name="quote.accepted",
           correlation_key="customer_id", timeout="P7D", timeout_edge_id=u("Quote accepted->Expire quote")),
        ev("Contract signed", "message", "Wait for the signed contract.", name="contract.signed",
           correlation_key="customer_id", timeout="P10D", timeout_edge_id=u("Contract signed->Expire quote")),
        ev("Payment received", "message", "Wait for the first premium.", name="payment.received",
           correlation_key="customer_id", timeout="P7D", timeout_edge_id=u("Payment received->Expire quote")),
        ev("Policy issued", "message", "Tell other systems the policy is in force.", name="policy.issued", mode="publish", data=["policy_number", "customer_id"]),
        ev("Purchase done", "end"),
    ],
    "activities": [
        act("Prepare quote", "ai_agent", "pricing", "Price the cover from the vehicle and the driver's history, and write the quote.",
            outcome_contract={"postconditions": [{"name": "Has a premium", "expression": "premium > 0"}]}),
        act("Send contract", "application", "esign", "Send the insurance contract for signature."),
        act("Send invoice", "application", "billing", "Invoice the first premium."),
        act("Issue certificate", "application", "policy-admin", "Record the payment, issue the receipt and the certificate of insurance."),
        act("Expire quote", "application", "policy-admin", "Close the quote because the prospect did not go on."),
    ],
    "edges": [
        edge("Quote requested", "Prepare quote"), edge("Prepare quote", "Quote accepted"), edge("Quote accepted", "Send contract"),
        edge("Quote accepted", "Expire quote", label="no answer in 7 days"),
        edge("Send contract", "Contract signed"), edge("Contract signed", "Send invoice"), edge("Contract signed", "Expire quote", label="not signed in 10 days"),
        edge("Send invoice", "Payment received"), edge("Payment received", "Issue certificate"), edge("Payment received", "Expire quote", label="not paid in 7 days"),
        edge("Issue certificate", "Policy issued"), edge("Policy issued", "Purchase done"), edge("Expire quote", "Purchase done"),
    ],
}
write("policy-purchase.awa.json", purchase)

u, act, edge, ev, role = kit("renewal")
renewal = {
    "$schema": "https://awa.io/schema/awa.schema.json", "id": u("workflow"), "name": "Policy Renewal", "version": "1.0.0", "awa_version": "1.1",
    "description": "Sets the terms of a renewal, offers it, waits for payment, and either renews the policy or lets it lapse.",
    "roles": [role("comms", "Customer communications", "ai_agent", "tier:balanced"), role("policy-admin", "Policy administration", "application")],
    "events": [
        ev("Renewal due", "start", "A policy is 30 days from its end.", name="renewal.due"),
        ev("Renewal paid", "message", "Wait for the renewal premium.", name="renewal.paid",
           correlation_key="customer_id", timeout="P21D", timeout_edge_id=u("Renewal paid->Send last reminder")),
        ev("Paid after reminder", "message", "Wait once more after the reminder.", name="renewal.paid",
           correlation_key="customer_id", timeout="P9D", timeout_edge_id=u("Paid after reminder->Lapse policy")),
        ev("Policy renewed", "message", "Tell other systems the policy continues.", name="policy.renewed", mode="publish", data=["policy_number", "customer_id"]),
        ev("Policy lapsed", "message", "Tell other systems the policy has ended.", name="policy.lapsed", mode="publish", data=["policy_number", "customer_id"]),
        ev("Renewal done", "end"),
    ],
    "activities": [
        act("Send renewal offer", "ai_agent", "comms", "Write the renewal offer with the new premium and the reason for any change."),
        act("Send last reminder", "ai_agent", "comms", "Remind the customer that cover ends soon."),
        act("Issue renewal certificate", "application", "policy-admin", "Record the payment, issue the receipt and the new certificate."),
        act("Lapse policy", "application", "policy-admin", "End the cover and tell the customer."),
    ],
    "decision_nodes": [{
        "id": u("Renewal terms"), "name": "Renewal terms", "description": "How the premium changes, from the year's claims and how the customer felt about them.",
        "decision_table": {
            "hit_policy": "first",
            "inputs": [{"name": "claims_paid", "label": "Claims paid this year", "type": "number"}, {"name": "last_satisfaction", "label": "Last satisfaction score", "type": "number"}],
            "outputs": [{"name": "premium_change_percent", "type": "number"}, {"name": "terms_reason", "type": "string"}],
            "rules": [
                {"description": "Win back an unhappy customer", "input_entries": ["-", "< 3"], "output_entries": ["-10", "goodwill after a poor claim experience"], "output_edge_id": u("Renewal terms->Send renewal offer")},
                {"description": "No claims", "input_entries": ["0", "-"], "output_entries": ["-5", "no-claims discount"], "output_edge_id": u("Renewal terms->Send renewal offer")},
                {"description": "Claim paid", "input_entries": [">= 1", "-"], "output_entries": ["8", "a claim was paid this year"], "output_edge_id": u("Renewal terms->Send renewal offer")},
            ]},
        "default_output_edge_id": u("Renewal terms->Send renewal offer"),
    }],
    "edges": [
        edge("Renewal due", "Renewal terms"), edge("Renewal terms", "Send renewal offer"), edge("Send renewal offer", "Renewal paid"),
        edge("Renewal paid", "Issue renewal certificate"), edge("Renewal paid", "Send last reminder", label="not paid in 21 days"),
        edge("Send last reminder", "Paid after reminder"), edge("Paid after reminder", "Issue renewal certificate"),
        edge("Paid after reminder", "Lapse policy", label="not paid in 9 more days"),
        edge("Issue renewal certificate", "Policy renewed"), edge("Policy renewed", "Renewal done"),
        edge("Lapse policy", "Policy lapsed"), edge("Policy lapsed", "Renewal done"),
    ],
}
write("policy-renewal.awa.json", renewal)

settlement = json.loads((HERE / "../claims-settlement/claims-settlement.awa.json").read_text())
u, *_ = kit("journey")

art = lambda id, name, kind, desc: {"id": id, "name": name, "kind": kind, "description": desc}
def tp(id, name, direction, channel, technology, exchanges=(), party="subject", **on):
    return {"id": id, "name": name, "party": party, "direction": direction, "channel": channel, "technology": technology, "on": on,
            "exchanges": [{"artefact": e} if isinstance(e, str) else {"artefact": e[0], "reference": e[1]} for e in exchanges]}
infer = lambda on, change, reason, **narrow: {"on": on, "change": change, "reason": reason, **narrow}

PORTAL, EMAIL, SMS = "Customer portal", "Email gateway", "SMS gateway"

write("policy-purchase.journey.json", {
    "id": u("journey:purchase"), "name": "Policy Purchase", "version": "1.0.0", "awa_version": "1.1",
    "description": "From a request for a quote to a policy in force.",
    "subject": {"name": "customer", "key": "customer_id"},
    "stages": [
        {"id": "quoted", "name": "Quoted", "description": "A quote is prepared and the prospect decides.", "workflows": [purchase["id"]], "complete_when": "quote_accepted == true", "max_duration": "P7D"},
        {"id": "contracted", "name": "Contracted", "description": "The contract is signed.", "workflows": [purchase["id"]], "complete_when": "signed == true", "max_duration": "P10D"},
        {"id": "covered", "name": "Covered", "description": "The premium is paid and the certificate issued.", "workflows": [purchase["id"]], "complete_when": "covered == true", "max_duration": "P7D", "transitions": []},
    ],
    "triggers": [{"event": "quote.requested", "starts_journey": True, "start_workflow": purchase["id"]}],
    "goals": [{"id": "covered", "name": "Policy in force", "expression": "covered == true"}],
    "exits": [{"event": "quote.declined", "outcome": "abandoned", "reason": "The prospect declined the quote"}],
    "artefacts": [
        art("quote", "Quote", "quote", "The premium offered and what it covers."),
        art("insurance-contract", "Insurance contract", "contract", "The terms of the cover, to be signed."),
        art("signature-attestation", "Signature attestation", "attestation", "Proof from the e-signature service of who signed and when."),
        art("premium-invoice", "Premium invoice", "invoice", "The premium due."),
        art("payment-order", "Payment order", "order", "The customer's instruction to pay."),
        art("payment-receipt", "Payment receipt", "receipt", "Proof that the premium was received."),
        art("insurance-certificate", "Certificate of insurance", "certificate", "Proof of cover, as the law requires a driver to carry."),
    ],
    "touchpoints": [
        tp("quote-requested", "Asks for a quote", "inbound", "web", PORTAL, event="quote.requested"),
        tp("quote-sent", "Receives the quote", "outbound", "email", EMAIL, [("quote", "quote_id")], activity="Prepare quote"),
        tp("quote-accepted", "Accepts the quote", "inbound", "web", PORTAL, [("quote", "quote_id")], event="quote.accepted"),
        tp("contract-sent", "Receives the contract", "outbound", "email", "E-signature service", [("insurance-contract", "contract_id")], activity="Send contract"),
        tp("contract-signed", "Signs the contract", "inbound", "web", "E-signature service", [("insurance-contract", "contract_id"), "signature-attestation"], event="contract.signed"),
        tp("invoice-sent", "Receives the invoice", "outbound", "email", EMAIL, [("premium-invoice", "invoice_id")], activity="Send invoice"),
        tp("premium-paid", "Pays the premium", "inbound", "bank transfer", "Payment gateway", ["payment-order"], event="payment.received"),
        tp("certificate-sent", "Receives receipt and certificate", "outbound", "email", EMAIL, [("payment-receipt", "receipt_id"), ("insurance-certificate", "certificate_id")], activity="Issue certificate"),
    ],
    "sentiment": {"min": -2, "max": 2, "initial": 0, "rules": [
        infer("waited", -1, "waited more than two days for an answer", longer_than="P2D"),
        infer("goal_reached", 1, "is covered", goal="covered"),
        infer("stalled", -1, "nothing has moved for too long"),
    ]},
})

write("motor-claim.journey.json", {
    "id": u("journey"), "name": "Motor Claim", "version": "1.0.0", "awa_version": "1.1",
    "description": "A customer's motor claim, from the day it is reported to the follow-up after payment.",
    "subject": {"name": "customer", "key": "customer_id"},
    "stages": [
        {"id": "reported", "name": "Reported", "description": "The claim is registered and its documents collected.",
         "workflows": [intake["id"]], "complete_when": "documents_complete == true", "max_duration": "P7D", "owner": "Claims intake desk"},
        {"id": "settled", "name": "Assessed and settled", "description": "The damage is assessed, the claim is routed, and the customer is paid.",
         "on_enter": {"start_workflow": settlement["id"]}, "complete_when": "paid exists", "max_duration": "P10D", "owner": "Claims adjusters"},
        {"id": "followed-up", "name": "Followed up", "description": "The customer is asked how it went.",
         "on_enter": {"start_workflow": follow["id"]}, "complete_when": "followed_up == true", "max_duration": "P21D", "transitions": []},
    ],
    "triggers": [{"event": "claim.submitted", "starts_journey": True, "start_workflow": intake["id"]}],
    "goals": [{"id": "paid", "name": "Claimant paid", "expression": "paid exists"},
              {"id": "satisfied", "name": "Customer satisfied", "expression": "satisfaction >= 4"}],
    "exits": [{"event": "claim.withdrawn", "outcome": "abandoned", "reason": "The customer withdrew the claim"}],
    "artefacts": [
        art("claim-form", "Claim form", "form", "What happened, where and when, as the customer tells it."),
        art("damage-photos", "Photos of the damage", "evidence", "The customer's own pictures."),
        art("police-report", "Police report", "attestation", "A third party's statement of the facts."),
        art("repair-quote", "Repair quote", "quote", "What a garage would charge."),
        art("policy", "Insurance contract", "contract", "The cover the claim is checked against."),
        art("parts-price", "Catalogue price", "quote", "The list price of a part."),
        art("payment-order", "Payment order", "order", "The instruction to the bank to pay the claimant."),
        art("settlement-notice", "Settlement notice", "notice", "The decision on the claim and the amount."),
        art("payment-receipt", "Payment receipt", "receipt", "Proof that the settlement was paid."),
        art("survey", "Satisfaction survey", "survey", "One question, one to five."),
    ],
    "touchpoints": [
        tp("claim-reported", "Reports the claim", "inbound", "web", PORTAL, ["claim-form"], event="claim.submitted"),
        tp("documents-requested", "Is asked for documents", "outbound", "email", EMAIL, activity="Request documents"),
        tp("documents-uploaded", "Uploads documents", "inbound", "web", PORTAL, ["damage-photos", "police-report", "repair-quote"], event="documents.uploaded"),
        tp("reminder", "Is reminded", "outbound", "sms", SMS, activity="Send reminder"),
        tp("parts-priced", "Part priced", "outbound", "api", "Repair catalogue API (HTTP)", ["parts-price"], party="repair catalogue", tool="price_part"),
        tp("cover-checked", "Cover checked", "outbound", "api", "Policy API (HTTP)", [("policy", "policy_number")], party="policy administration", tool="get_policy"),
        tp("claim-paid", "Payment sent", "outbound", "api", "Payments (JSON-RPC)", [("payment-order", "payment_id")], party="bank", tool="transfer"),
        tp("settlement-notified", "Is told the claim is settled", "outbound", "email", EMAIL, ["settlement-notice", "payment-receipt"], activity="Notify claimant"),
        tp("survey-sent", "Is asked how it went", "outbound", "email", EMAIL, ["survey"], activity="Send survey"),
        tp("survey-answered", "Answers the survey", "inbound", "web", PORTAL, ["survey"], event="survey.answered"),
        tp("thanked", "Is thanked", "outbound", "email", EMAIL, activity="Thank customer"),
        tp("called-back", "Is called back", "outbound", "phone", "Contact centre telephony", activity="Call back"),
        tp("claim-withdrawn", "Withdraws the claim", "inbound", "web", PORTAL, event="claim.withdrawn"),
    ],
    "sentiment": {"min": -2, "max": 2, "initial": 0, "rules": [
        infer("event", -1, "has had an accident", event="claim.submitted"),
        infer("waited", -1, "waited more than two days for an answer", longer_than="P2D"),
        infer("touchpoint", -0.5, "had to be chased", touchpoint="reminder"),
        infer("goal_reached", 1, "has been paid", goal="paid"),
        {"on": "event", "event": "survey.answered", "measure": {"path": "satisfaction", "from": [1, 5]}, "reason": "said so in the survey"},
        infer("touchpoint", 0.5, "a person called to put it right", touchpoint="called-back"),
        infer("run_failed", -1, "the work for them failed"),
        infer("stalled", -0.5, "nothing has moved for too long"),
    ]},
})

write("policy-renewal.journey.json", {
    "id": u("journey:renewal"), "name": "Policy Renewal", "version": "1.0.0", "awa_version": "1.1",
    "description": "The month before a policy ends: offer, payment, and a renewed policy or a lapsed one.",
    "subject": {"name": "customer", "key": "customer_id"},
    "stages": [
        {"id": "offered", "name": "Offered", "description": "The renewal terms are set and sent; the customer decides.", "workflows": [renewal["id"]], "complete_when": "renewal_paid == true", "max_duration": "P35D", "owner": "Retention team"},
        {"id": "renewed", "name": "Renewed", "description": "The new certificate is issued.", "workflows": [renewal["id"]], "complete_when": "renewed == true", "max_duration": "P2D", "transitions": []},
    ],
    "triggers": [{"event": "renewal.due", "starts_journey": True, "start_workflow": renewal["id"]}],
    "goals": [{"id": "renewed", "name": "Customer kept", "expression": "renewed == true"}],
    "exits": [{"event": "policy.lapsed", "outcome": "abandoned", "reason": "The policy lapsed unpaid"},
              {"event": "policy.cancelled", "outcome": "abandoned", "reason": "The customer cancelled the policy"}],
    "artefacts": [
        art("renewal-invoice", "Renewal invoice", "invoice", "The new premium and why it changed."),
        art("payment-order", "Payment order", "order", "The customer's instruction to pay."),
        art("payment-receipt", "Payment receipt", "receipt", "Proof that the premium was received."),
        art("insurance-certificate", "Certificate of insurance", "certificate", "Proof of cover for the new year."),
        art("lapse-notice", "Notice of lapse", "notice", "Tells the customer that cover has ended."),
        art("cancellation-request", "Cancellation request", "form", "The customer's instruction to end the policy."),
    ],
    "touchpoints": [
        tp("offer-sent", "Receives the renewal offer", "outbound", "email", EMAIL, [("renewal-invoice", "invoice_id")], activity="Send renewal offer"),
        tp("last-reminder", "Is reminded cover ends soon", "outbound", "sms", SMS, activity="Send last reminder"),
        tp("renewal-paid", "Pays the renewal", "inbound", "bank transfer", "Payment gateway", ["payment-order"], event="renewal.paid"),
        tp("certificate-sent", "Receives receipt and certificate", "outbound", "email", EMAIL, [("payment-receipt", "receipt_id"), ("insurance-certificate", "certificate_id")], activity="Issue renewal certificate"),
        tp("lapse-notified", "Is told cover has ended", "outbound", "post", "Print and mail service", ["lapse-notice"], activity="Lapse policy"),
        tp("cancelled", "Cancels the policy", "inbound", "phone", "Contact centre telephony", ["cancellation-request"], event="policy.cancelled"),
    ],
    "sentiment": {"min": -2, "max": 2, "initial": 0, "rules": [
        infer("touchpoint", -0.5, "had to be chased", touchpoint="last-reminder"),
        infer("goal_reached", 0.5, "chose to stay", goal="renewed"),
        infer("touchpoint", -1, "lost their cover", touchpoint="lapse-notified"),
    ]},
})
print("wrote 4 workflows and 3 journeys")
