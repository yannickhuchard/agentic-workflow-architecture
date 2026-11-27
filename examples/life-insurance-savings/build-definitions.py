#!/usr/bin/env python3
"""
Writes the definitions of this example: the six workflows of a workplace pension savings plan with a
Luxembourg life insurer, the due diligence workflow the subscription calls as a sub-workflow, and the
journey of an employee from the invitation in the HR portal to the annual review. Identifiers are
derived from names, so the output is stable: running this again writes the same files.

    python3 examples/life-insurance-savings/build-definitions.py

The insurer (Valoria Life S.A.), the employer (Kestrel Engineering S.a r.l.), the custodian bank and
every person are fictional. The tax figures are in the decision table "Deduction rules" as data; FACTS.md
gives the source of each and marks those a tax adviser must confirm.
"""
import json
import pathlib
import uuid

HERE = pathlib.Path(__file__).parent
NS = uuid.UUID("6ba7b811-9dad-11d1-80b4-00c04fd430c8")
# Where the reference adapters listen (adapters/mock-server.mjs). An insurer replaces these addresses with its own systems.
ADAPTERS = "http://localhost:4560"


def kit(prefix):
    u = lambda name: str(uuid.uuid5(NS, f"awa-example:life-insurance-savings:{prefix}:{name}"))

    def act(title, actor, role, desc, **x):
        return {"id": u(title), "name": title, "role_id": u("role:" + role), "actor_type": actor, "description": desc, **x}

    def edge(a, b, key=None, **x):
        return {"id": u(f"{a}->{b}" + (f":{key}" if key else "")), "source_id": u(a), "target_id": u(b), **x}

    def ev(title, kind, desc=None, join=None, **definition):
        event = {"id": u(title), "name": title, "event_type": kind}
        if desc:
            event["description"] = desc
        if join:
            event["join"] = join
        if definition:
            event["event_definition"] = definition
        return event

    def role(key, title, actor, desc, model=None, capabilities=None):
        r = {"id": u("role:" + key), "name": title, "actor_type": actor, "description": desc}
        if capabilities:
            r["capabilities"] = capabilities
        if model:
            r["ai_model_config"] = {"model_id": model, "temperature": 0.2}
        return r

    return u, act, edge, ev, role


def http(method, path, secret=None, header="authorization"):
    binding = {"kind": "http", "method": method, "url": ADAPTERS + path}
    if secret:
        binding["headers"] = {header: f"Bearer {{{{secret:{secret}}}}}" if header == "authorization" else f"{{{{secret:{secret}}}}}"}
    return binding


def jsonrpc(path, method):
    return {"kind": "jsonrpc", "endpoint": ADAPTERS + path, "method": method}


def obj(required, **properties):
    return {"type": "object", "required": list(required), "properties": properties}


S = {"type": "string"}
N = {"type": "number"}
B = {"type": "boolean"}
I0 = {"type": "integer", "minimum": 0}
CONF = {"type": "number", "minimum": 0, "maximum": 1}
ALLOCATION = {"type": "array", "minItems": 1, "items": obj(["fund_id", "percent"], fund_id=S, percent={"type": "number", "exclusiveMinimum": 0, "maximum": 100})}
PROFILES = ["cautious", "moderate", "balanced", "dynamic"]
RECOMMENDATIONS = ["rebalance", "reduce_risk", "review_beneficiary", "increase_contribution", "no_change"]

# --- The integration points: every tool is one an insurer replaces with its own system (INTEGRATION.md) ---
TOOLS = {
    "register_enrolment": {
        "name": "register_enrolment", "description": "Create the enrolment of an invited employee in the policy administration system.",
        "parameters": obj(["enrolment_id", "plan_id", "employee", "employer"], enrolment_id=S, plan_id=S, employee={"type": "object"},
                          employer={"type": "object"}, tax_residence=S),
        "binding": http("POST", "/policy-admin/v1/enrolments", "POLICY_ADMIN_TOKEN"),
    },
    "send_notification": {
        "name": "send_notification", "description": "Send the employee a message in the HR portal's inbox, by e-mail, or both.",
        "parameters": obj(["enrolment_id", "channel", "template"], enrolment_id=S, channel={"type": "string", "enum": ["portal", "email", "portal_and_email"]},
                          template=S, subject=S, body=S),
        "binding": http("POST", "/portal/v1/notifications", "PORTAL_TOKEN"),
    },
    "get_plan_rules": {
        "name": "get_plan_rules", "description": "Read the terms of the employer's savings plan: the contract, its minimum duration, the fees, the fund range and the tax article it is written under.",
        "parameters": obj(["plan_id"], plan_id=S),
        "binding": http("GET", "/policy-admin/v1/plans/{plan_id}", "POLICY_ADMIN_TOKEN"),
    },
    "book_video_call": {
        "name": "book_video_call", "description": "Book a video call with a licensed adviser in the advice calendar.",
        "parameters": obj(["enrolment_id", "topic"], enrolment_id=S, topic=S, preferred_slot=S, language=S),
        "binding": http("POST", "/advice/v1/appointments", "ADVICE_CALENDAR_TOKEN"),
    },
    "open_questionnaire": {
        "name": "open_questionnaire", "description": "Open the demands-and-needs and suitability questionnaire for the employee in the HR portal.",
        "parameters": obj(["enrolment_id", "questionnaire"], enrolment_id=S, questionnaire=S, language=S),
        "binding": http("POST", "/portal/v1/questionnaires", "PORTAL_TOKEN"),
    },
    "record_suitability_profile": {
        "name": "record_suitability_profile", "description": "Record the demands and needs, the suitability assessment and the risk profile on the enrolment.",
        "parameters": obj(["enrolment_id", "risk_profile", "max_sri"], enrolment_id=S, risk_profile={"type": "string", "enum": PROFILES},
                          max_sri={"type": "integer", "minimum": 1, "maximum": 7}, demands_and_needs=S, sustainability_preference=S),
        "binding": http("POST", "/policy-admin/v1/enrolments/{enrolment_id}/profile", "POLICY_ADMIN_TOKEN"),
    },
    "list_funds": {
        "name": "list_funds", "description": "List the unit-linked funds and model portfolios of the plan, each with its key information document and its summary risk indicator.",
        "parameters": obj(["plan_id"], plan_id=S, max_sri={"type": "integer", "minimum": 1, "maximum": 7}, sustainability=S),
        "binding": http("GET", "/funds/v1/plans/{plan_id}/funds", "FUND_PLATFORM_KEY", header="x-api-key"),
    },
    "check_allocation": {
        "name": "check_allocation", "description": "Check an allocation against a risk profile: the weighted summary risk indicator, its excess over the profile's maximum, and whether every fund's key information document was delivered.",
        "parameters": obj(["allocation", "max_sri"], allocation=ALLOCATION, max_sri={"type": "integer", "minimum": 1, "maximum": 7}, enrolment_id=S),
        "binding": http("POST", "/funds/v1/suitability-checks", "FUND_PLATFORM_KEY", header="x-api-key"),
    },
    "extract_document": {
        "name": "extract_document", "description": "Read an uploaded identity document or proof of address: its type, whether it is legible, the fields printed on it and its text.",
        "parameters": obj(["file_id", "document_type"], file_id=S, document_type=S, enrolment_id=S),
        "binding": http("POST", "/documents/v1/extractions", "DOCUMENTS_API_KEY", header="x-api-key"),
    },
    "screen_person": {
        "name": "screen_person", "description": "Screen a person against the lists of politically exposed persons, sanctions and adverse media.",
        "parameters": obj(["enrolment_id", "first_name", "last_name", "date_of_birth"], enrolment_id=S, first_name=S, last_name=S, date_of_birth=S, nationality=S),
        "binding": http("POST", "/screening/v1/screenings", "SCREENING_TOKEN"),
    },
    "validate_self_certification": {
        "name": "validate_self_certification", "description": "Check a tax residence self-certification for CRS and FATCA: the countries of residence, the format of each tax identification number, and US status.",
        "parameters": obj(["enrolment_id", "self_certification"], enrolment_id=S, self_certification={"type": "object"}),
        "binding": http("POST", "/kyc/v1/self-certifications/validations", "KYC_TOKEN"),
    },
    "record_due_diligence": {
        "name": "record_due_diligence", "description": "Record the customer due diligence file: its level, the screening, the tax residences to report under CRS and the FATCA status.",
        "parameters": obj(["enrolment_id", "cdd_level", "outcome"], enrolment_id=S, cdd_level=S, outcome={"type": "string", "enum": ["accepted", "refused"]},
                          screening_reference=S, crs_reportable=B, fatca_status=S, note=S),
        "binding": http("POST", "/kyc/v1/files", "KYC_TOKEN"),
    },
    "request_signature": {
        "name": "request_signature", "description": "Send the subscription contract, the beneficiary clause and the payroll deduction mandate for e-signature.",
        "parameters": obj(["enrolment_id", "documents"], enrolment_id=S, documents={"type": "array", "items": S}, signer_email=S),
        "binding": http("POST", "/esign/v1/envelopes", "ESIGN_TOKEN"),
    },
    "issue_policy": {
        "name": "issue_policy", "description": "Issue the policy in the policy administration system and open its unit-linked account with the custodian bank.",
        "parameters": obj(["enrolment_id", "plan_id", "monthly_contribution_eur", "allocation", "beneficiary_clause"], enrolment_id=S, plan_id=S,
                          monthly_contribution_eur={"type": "number", "exclusiveMinimum": 0}, allocation=ALLOCATION, beneficiary_clause={"type": "object"}),
        "binding": http("POST", "/policy-admin/v1/policies", "POLICY_ADMIN_TOKEN"),
    },
    "cancel_policy": {
        "name": "cancel_policy", "description": "Cancel a policy from its start, as if it had never been issued.",
        "parameters": obj(["policy_id", "reason"], policy_id=S, reason=S),
        "binding": http("POST", "/policy-admin/v1/policies/{policy_id}/cancellation", "POLICY_ADMIN_TOKEN"),
    },
    "record_premium": {
        "name": "record_premium", "description": "Record a premium on the policy and return the premiums paid in the tax year so far.",
        "parameters": obj(["policy_id", "period", "amount_eur"], policy_id=S, period=S, amount_eur={"type": "number", "exclusiveMinimum": 0},
                          paid_before_eur={"type": "number", "minimum": 0}),
        "binding": http("POST", "/policy-admin/v1/policies/{policy_id}/premiums", "POLICY_ADMIN_TOKEN"),
    },
    "refund_premium": {
        "name": "refund_premium", "description": "Refund premiums to the employee's account.",
        "parameters": obj(["policy_id", "amount_eur", "reason"], policy_id=S, amount_eur={"type": "number", "minimum": 0}, reason=S),
        "binding": http("POST", "/policy-admin/v1/refunds", "POLICY_ADMIN_TOKEN"),
    },
    "update_beneficiary_clause": {
        "name": "update_beneficiary_clause", "description": "Replace the beneficiary clause of a policy.",
        "parameters": obj(["policy_id", "beneficiary_clause"], policy_id=S, beneficiary_clause={"type": "object"}),
        "binding": http("POST", "/policy-admin/v1/policies/{policy_id}/beneficiary-clause", "POLICY_ADMIN_TOKEN"),
    },
    "create_payroll_deduction": {
        "name": "create_payroll_deduction", "description": "Set up the monthly payroll deduction the employee signed, from the next payroll.",
        "parameters": obj(["employee_number", "policy_id", "monthly_amount_eur"], employee_number=S, policy_id=S, monthly_amount_eur={"type": "number", "exclusiveMinimum": 0}),
        "binding": jsonrpc("/payroll/rpc", "payroll.create_deduction"),
    },
    "stop_payroll_deduction": {
        "name": "stop_payroll_deduction", "description": "Stop a payroll deduction.",
        "parameters": obj(["deduction_id", "reason"], deduction_id=S, reason=S),
        "binding": jsonrpc("/payroll/rpc", "payroll.stop_deduction"),
    },
    "schedule_one_off_deduction": {
        "name": "schedule_one_off_deduction", "description": "Add a one-off amount to the employee's next payroll deduction: a top-up.",
        "parameters": obj(["employee_number", "policy_id", "amount_eur"], employee_number=S, policy_id=S, amount_eur={"type": "number", "exclusiveMinimum": 0}),
        "binding": jsonrpc("/payroll/rpc", "payroll.schedule_one_off"),
    },
    "place_order": {
        "name": "place_order", "description": "Buy units with a premium through the custodian bank: in the allocation given, or else in the policy's current allocation.",
        "parameters": obj(["policy_id", "amount_eur"], policy_id=S, amount_eur={"type": "number", "exclusiveMinimum": 0}, allocation=ALLOCATION, period=S),
        "binding": jsonrpc("/custody/rpc", "custody.place_order"),
    },
    "redeem_units": {
        "name": "redeem_units", "description": "Sell every unit bought for a policy, through the custodian bank.",
        "parameters": obj(["policy_id", "reason"], policy_id=S, reason=S),
        "binding": jsonrpc("/custody/rpc", "custody.redeem_all"),
    },
    "switch_funds": {
        "name": "switch_funds", "description": "Move the value of a policy to a new allocation, through the custodian bank.",
        "parameters": obj(["policy_id", "allocation"], policy_id=S, allocation=ALLOCATION),
        "binding": jsonrpc("/custody/rpc", "custody.switch"),
    },
    "get_position": {
        "name": "get_position", "description": "Read the value of a policy, its units by fund and how far its allocation has drifted from the target.",
        "parameters": obj(["policy_id"], policy_id=S, target_allocation=ALLOCATION, premiums_eur={"type": "number", "minimum": 0}),
        "binding": jsonrpc("/custody/rpc", "custody.get_position"),
    },
    "compute_deductions": {
        "name": "compute_deductions", "description": "Compute the deductible amount of premiums per article of the income tax law, from the premiums paid, the contributions still to come and the ceilings the decision table gives.",
        "parameters": obj(["tax_year", "articles", "ceilings_eur", "premiums_eur"], tax_year={"type": "integer"},
                          articles={"type": "array", "items": S}, ceilings_eur={"type": "array", "items": N}, bases={"type": "array", "items": S},
                          premiums_eur={"type": "number", "minimum": 0}, monthly_contribution_eur={"type": "number", "minimum": 0},
                          months_remaining={"type": "integer", "minimum": 0}, household_members={"type": "integer", "minimum": 1}),
        "binding": http("POST", "/tax/v1/deduction-computations", "TAX_SERVICE_TOKEN"),
    },
    "issue_tax_certificate": {
        "name": "issue_tax_certificate", "description": "Issue the annual tax certificate of the premiums paid, for the employee's tax return.",
        "parameters": obj(["policy_id", "tax_year", "article", "premiums_eur", "deductible_eur"], policy_id=S, tax_year={"type": "integer"}, article=S,
                          premiums_eur=N, deductible_eur=N, employee=S),
        "binding": http("POST", "/tax-certificates/v1/certificates", "CERTIFICATES_TOKEN"),
    },
}

# Guardrails an activity declares (specification 31). The deployment adds its own (deployment.json).
INJECTION_IN_DOCUMENTS = lambda u, name: {
    "id": u(f"guardrail:{name}:injection"), "name": "Instructions inside uploaded documents", "stages": ["tool_result"],
    "check": {"kind": "prompt_injection"}, "action": "block", "tools": ["extract_document"],
}
PERSONAL_DATA_IN = lambda u, name, fields: {
    "id": u(f"guardrail:{name}:personal-data"), "name": "Personal data in what the agent writes", "stages": ["output"],
    "check": {"kind": "personal_data", "categories": ["email", "phone", "iban"]}, "fields": fields, "action": "redact",
}


def write(name, data):
    (HERE / name).write_text(json.dumps(data, indent=2, ensure_ascii=False) + "\n")


def profile_context(u, description):
    return {
        "id": u("context:employee_profile"), "name": "employee_profile", "type": "data", "sync_pattern": "shared_state",
        "description": description,
        "schema": obj(["first_name", "tax_residence"], first_name=S, preferred_language=S, age={"type": "integer"}, retirement_age={"type": "integer"},
                      tax_residence=S, risk_profile=S, max_sri={"type": "integer"}, horizon_years=N, sustainability_preference=S, monthly_contribution_eur=N),
    }


PLAN_ID = "KES-PENSION-111BIS"

# =====================================================================================================
# 1. Plan invitation and advice (journey stages 1 to 3)
# =====================================================================================================
u, act, edge, ev, role = kit("advice")
ADVICE_ID = u("workflow")
PROFILE = u("context:employee_profile")
read_profile = [{"context_id": PROFILE, "access_mode": "read"}]
advice = {
    "$schema": "https://awa.io/schema/awa.schema.json", "id": ADVICE_ID, "name": "Plan Invitation and Advice", "version": "1.0.0", "awa_version": "1.1",
    "description": "Invites an employee to the employer's pension savings plan in the HR portal, reminds them, explains the plan, its tax ceiling and its risks through an AI adviser that hands over to a licensed adviser on request or when unsure, and establishes the demands and needs and the risk profile from the questionnaire.",
    "sla": {"id": u("sla:advice"), "name": "Advice and profile within six weeks", "target_time": "P21D", "max_time": "P42D",
            "escalation_policy": {"breach_action": "record", "notify_roles": [u("role:licensed-adviser")]}},
    "roles": [
        role("policy-admin", "Policy administration", "application", "Valoria Life's policy administration system: plans, enrolments, policies and premiums."),
        role("portal", "HR portal", "application", "The HR portal Valoria Life provides to the employer: inbox, questionnaires, self-service."),
        role("writer", "Reminder writer", "ai_agent", "Writes short reminders in the employee's language.", "tier:fast", ["customer writing"]),
        role("ai-adviser", "AI adviser", "ai_agent",
             "Explains the plan, its tax treatment and its risks, and turns the questionnaire into a demands-and-needs statement. Never prices, underwrites or decides on compliance.",
             "tier:reasoning", ["life insurance savings", "Luxembourg personal income tax", "insurance distribution rules"]),
        role("calendar", "Advice calendar", "application", "Books video calls with licensed advisers."),
        role("licensed-adviser", "Licensed adviser", "human", "An insurance distributor registered with the supervisor, who gives advice by video call and takes over from the AI adviser."),
    ],
    "contexts": [profile_context(u, "The employee as the agents that serve them need to know them: first name, language, age, retirement age, tax residence and, once assessed, the risk profile. Salary and identity documents are not in it.")],
    "events": [
        ev("Employee invited", "start", "The employer opens the plan to the employee in the HR portal.", name="savings.invited"),
        ev("Invitation opened", "message", "Wait for the employee to open the invitation.", name="invitation.opened",
           correlation_key="enrolment_id", timeout="P7D", timeout_edge_id=u("Invitation opened->Send invitation reminder")),
        ev("Invitation opened after reminder", "message", "Wait once more after the reminder.", name="invitation.opened",
           correlation_key="enrolment_id", timeout="P7D", timeout_edge_id=u("Invitation opened after reminder->Send last reminder")),
        ev("Invitation opened after last reminder", "message", "Wait a last time after the employer's reminder.", name="invitation.opened",
           correlation_key="enrolment_id", timeout="P14D", timeout_edge_id=u("Invitation opened after last reminder->Close invitation")),
        ev("Advice given", "message", "Tell the journey the plan has been explained, and by whom.", name="advice.given",
           mode="publish", data=["enrolment_id", "advice_given", "advice_channel"]),
        ev("Questionnaire answered", "message", "Wait for the questionnaire.", name="questionnaire.submitted",
           correlation_key="enrolment_id", timeout="P14D", timeout_edge_id=u("Questionnaire answered->Close invitation")),
        ev("Profile completed", "message", "Tell the journey and the subscription the employee's profile.", name="profile.completed",
           mode="publish", data=["enrolment_id", "plan_id", "employee", "employer", "tax_residence", "retirement_age", "risk_profile", "max_sri",
                                 "horizon_years", "capacity_for_loss", "sustainability_preference", "demands_and_needs", "monthly_contribution_eur", "profile_reference"]),
        ev("Invitation lapsed", "message", "Tell the journey the invitation lapsed.", name="savings.invitation_lapsed",
           mode="publish", data=["enrolment_id", "lapsed_reason"]),
        ev("Advice completed", "end"),
        ev("Not taken up", "end"),
    ],
    "activities": [
        act("Register enrolment", "application", "policy-admin", "Create the enrolment and the employee profile the agents read.",
            tools=[TOOLS["register_enrolment"]], retry={"max_attempts": 3, "initial_delay": "PT1S"},
            context_bindings=[{"context_id": PROFILE, "access_mode": "write"}]),
        act("Send invitation", "application", "portal", "Invite the employee to the plan in the HR portal's inbox and by e-mail.",
            tools=[TOOLS["send_notification"]]),
        act("Send invitation reminder", "ai_agent", "writer", "Remind the employee of the invitation: what the plan is, and until when it stays open.",
            tools=[TOOLS["send_notification"]], context_bindings=read_profile,
            outcome_contract={
                "output_schema": obj(["message", "deadline_stated"], message={"type": "string", "minLength": 60}, deadline_stated=B, reminder_id=S),
                "postconditions": [{"name": "States until when the invitation is open", "expression": "deadline_stated == true"}],
            }),
        act("Send last reminder", "application", "portal", "Send the employer's last reminder from Kestrel HR, through the HR portal.",
            tools=[TOOLS["send_notification"]]),
        act("Close invitation", "application", "policy-admin", "Close the enrolment: the employee did not answer, or did not continue."),
        act("Explain the plan", "ai_agent", "ai-adviser",
            "Explain the plan in the HR portal's chat: how it works, the tax ceiling under the article it is written under, the fees, that the value of unit-linked funds can fall, and the right to cancel. Hand over to a licensed adviser when the employee asks for one.",
            procedure="Read the plan's terms with the plan tool. Explain, in the employee's language: the contract and its minimum duration of ten years; that savings are paid out from age 60 and no later than 75; the deduction ceiling of the article the plan is written under for the current tax year; the fees; that the value of unit-linked funds goes down as well as up and is not guaranteed; the 30 days to cancel with a full refund. List every topic you covered. Offer a licensed adviser, and book one if the employee asks. Never state a guaranteed return. Say how sure you are that the employee has understood.",
            tools=[TOOLS["get_plan_rules"]], context_bindings=read_profile,
            outcome_contract={
                "output_schema": obj(["explanation", "topics_covered", "uncovered_count", "risk_warning_given", "tax_ceiling_eur", "handover_requested", "confidence"],
                                     explanation={"type": "string", "minLength": 200},
                                     topics_covered={"type": "array", "items": {"type": "string", "enum": ["contract", "duration", "payout_age", "tax_ceiling", "fees", "investment_risk", "right_to_cancel"]}},
                                     uncovered_count=I0, risk_warning_given=B, tax_ceiling_eur={"type": "number", "exclusiveMinimum": 0},
                                     handover_requested=B, confidence=CONF, advice_given=B, advice_channel=S),
                "postconditions": [
                    {"name": "Every topic of the plan is covered", "expression": "uncovered_count == 0"},
                    {"name": "The investment risk is stated", "expression": "risk_warning_given == true"},
                    {"name": "Sure enough the employee has understood", "expression": "confidence >= 0.8"},
                ],
                "budgets": {"max_attempts": 2, "max_duration": "PT10M", "max_tokens": 40000, "max_tool_calls": 4},
                "on_violation": "escalate_human",
            }),
        act("Book video call", "application", "calendar", "Book a video call with a licensed adviser at the time the employee chose.",
            tools=[TOOLS["book_video_call"]]),
        act("Advise in video call", "human", "licensed-adviser",
            "A licensed adviser explains the plan by video call, answers the employee's questions and records the advice given.",
            outcome_contract={"output_schema": obj(["advice_given", "advice_summary"], advice_given=B, advice_summary={"type": "string", "minLength": 20},
                                                   advice_channel=S, monthly_contribution_eur={"type": "number", "minimum": 0})}),
        act("Send questionnaire", "application", "portal",
            "Open the questionnaire in the HR portal: demands and needs, knowledge and experience, financial situation and capacity for loss, objectives and risk tolerance, sustainability preferences.",
            tools=[TOOLS["open_questionnaire"]]),
        act("Assess demands and needs", "ai_agent", "ai-adviser",
            "Turn the answers into the demands-and-needs statement and the suitability assessment of the Insurance Distribution Directive, and flag answers that contradict each other.",
            procedure="Read the answers. Write the demands and needs in plain words. Check every section is answered: knowledge and experience, financial situation including the capacity for loss, objectives including the horizon and risk tolerance, sustainability preferences. List answers that contradict each other, such as a short horizon with a high risk tolerance. Say how sure you are.",
            context_bindings=read_profile,
            guardrails=[PERSONAL_DATA_IN(u, "demands", ["demands_and_needs", "notes"])],
            outcome_contract={
                "output_schema": obj(["demands_and_needs", "sections_unanswered", "contradictions", "confidence", "notes"],
                                     demands_and_needs={"type": "string", "minLength": 80}, sections_unanswered=I0,
                                     contradictions={"type": "array", "items": S}, confidence=CONF, notes={"type": "string", "minLength": 10}),
                "postconditions": [
                    {"name": "Every section of the questionnaire is answered", "expression": "sections_unanswered == 0"},
                    {"name": "Sure enough to profile", "expression": "confidence >= 0.75"},
                ],
                "budgets": {"max_attempts": 2, "max_duration": "PT5M", "max_tokens": 30000},
                "on_violation": "escalate_human",
            }),
        act("Record suitability profile", "application", "policy-admin", "Record the demands and needs, the suitability assessment and the risk profile on the enrolment.",
            tools=[TOOLS["record_suitability_profile"]]),
    ],
    "decision_nodes": [{
        "id": u("Risk profile"), "name": "Risk profile",
        "description": "The risk profile, and the highest summary risk indicator (SRI, 1 to 7, from the key information documents) a choice may reach, from the suitability answers. THE BANDS ARE EXAMPLES each insurer sets in its own advice policy.",
        "decision_table": {
            "hit_policy": "first",
            "inputs": [{"name": "capacity_for_loss", "label": "Capacity for loss", "type": "string"}, {"name": "horizon_years", "label": "Horizon (years)", "type": "number"},
                       {"name": "risk_tolerance", "label": "Risk tolerance (1 to 5)", "type": "number"}, {"name": "knowledge_level", "label": "Knowledge and experience", "type": "string"}],
            "outputs": [{"name": "risk_profile", "type": "string"}, {"name": "max_sri", "type": "number"}],
            "rules": [
                {"description": "No loss can be borne", "input_entries": ['"none"', "-", "-", "-"], "output_entries": ["cautious", 2]},
                {"description": "A horizon under five years", "input_entries": ["-", "< 5", "-", "-"], "output_entries": ["cautious", 2]},
                {"description": "A low risk tolerance, or a limited capacity for loss", "input_entries": ["-", "-", "<= 2", "-"], "output_entries": ["moderate", 3]},
                {"description": "A limited capacity for loss", "input_entries": ['"limited"', "-", "-", "-"], "output_entries": ["moderate", 3]},
                {"description": "High tolerance, long horizon, informed investor", "input_entries": ['"moderate", "substantial"', ">= 15", ">= 4", '"informed", "advanced"'], "output_entries": ["dynamic", 5]},
                {"description": "Everyone else", "input_entries": ["-", "-", "-", "-"], "output_entries": ["balanced", 4]},
            ],
        },
        "default_output_edge_id": u("Risk profile->Record suitability profile"),
    }],
    "edges": [
        edge("Employee invited", "Register enrolment"),
        edge("Register enrolment", "Send invitation"),
        edge("Send invitation", "Invitation opened"),
        edge("Invitation opened", "Explain the plan"),
        edge("Invitation opened", "Send invitation reminder", label="not opened in 7 days"),
        edge("Send invitation reminder", "Invitation opened after reminder"),
        edge("Invitation opened after reminder", "Explain the plan"),
        edge("Invitation opened after reminder", "Send last reminder", label="not opened in 7 more days"),
        edge("Send last reminder", "Invitation opened after last reminder"),
        edge("Invitation opened after last reminder", "Explain the plan"),
        edge("Invitation opened after last reminder", "Close invitation", label="not opened in 14 more days"),
        edge("Close invitation", "Invitation lapsed"),
        edge("Invitation lapsed", "Not taken up"),
        edge("Explain the plan", "Book video call", condition="handover_requested == true", label="asks for a person"),
        edge("Explain the plan", "Advice given", is_default=True),
        edge("Book video call", "Advise in video call"),
        edge("Advise in video call", "Advice given"),
        edge("Advice given", "Send questionnaire"),
        edge("Send questionnaire", "Questionnaire answered"),
        edge("Questionnaire answered", "Assess demands and needs"),
        edge("Questionnaire answered", "Close invitation", label="no answer in 14 days"),
        edge("Assess demands and needs", "Risk profile"),
        edge("Risk profile", "Record suitability profile"),
        edge("Record suitability profile", "Profile completed"),
        edge("Profile completed", "Advice completed"),
    ],
}
write("plan-invitation-and-advice.awa.json", advice)

# =====================================================================================================
# 2b. Identity, anti-money-laundering and tax residence: the sub-workflow of the subscription (specification 24)
# =====================================================================================================
u, act, edge, ev, role = kit("due-diligence")
KYC_ID = u("workflow")
kyc = {
    "$schema": "https://awa.io/schema/awa.schema.json", "id": KYC_ID, "name": "Identity, AML and Tax Residence Checks", "version": "1.0.0", "awa_version": "1.1",
    "description": "Customer due diligence before a life insurance contract is issued: identity documents read by an agent, screening against the lists of politically exposed persons and sanctions, the CRS and FATCA tax residence self-certification, and a compliance officer, then two approvers, for a politically exposed person or a possible sanctions match.",
    "roles": [
        role("reader", "Document reader", "ai_agent", "Reads identity documents and proofs of address and checks them against the enrolment.",
             "tier:reasoning", ["document extraction", "identity documents"]),
        role("screening", "Screening service", "application", "Screens people against the lists of politically exposed persons, sanctions and adverse media."),
        role("kyc", "KYC service", "application", "Holds the due diligence files and validates tax self-certifications."),
        role("compliance", "Compliance officer", "human", "Resolves screening alerts, establishes the source of wealth and approves business relationships with politically exposed persons."),
    ],
    "events": [
        ev("Checks requested", "start", "The subscription asks for the employee's due diligence."),
        ev("Checks back", "intermediate", "The screening and the self-certification are both back.", join="all"),
        ev("Checks passed", "end"),
        ev("Checks failed", "end"),
    ],
    "activities": [
        act("Verify identity documents", "ai_agent", "reader",
            "Check the identity document and the proof of address: legible, in date, and matching the employee's name, date of birth and address.",
            procedure="Extract each uploaded document with the document tool. Compare the name and date of birth with the enrolment. Check the identity document is in date. Count the documents you could not read. Say how sure you are.",
            tools=[TOOLS["extract_document"]],
            guardrails=[INJECTION_IN_DOCUMENTS(u, "identity"), PERSONAL_DATA_IN(u, "identity", ["notes"])],
            outcome_contract={
                "output_schema": obj(["identity_verified", "unreadable_count", "confidence", "notes"], identity_verified=B, unreadable_count=I0,
                                     document_expiry=S, confidence=CONF, notes={"type": "string", "minLength": 10}),
                "postconditions": [
                    {"name": "Every document is legible", "expression": "unreadable_count == 0"},
                    {"name": "Sure enough to act on", "expression": "confidence >= 0.8"},
                ],
                "budgets": {"max_attempts": 2, "max_duration": "PT5M", "max_tokens": 30000, "max_tool_calls": 6},
                "on_violation": "escalate_human",
            }),
        act("Screen PEP and sanctions", "application", "screening", "Screen the employee against the lists of politically exposed persons, sanctions and adverse media.",
            tools=[TOOLS["screen_person"]], retry={"max_attempts": 3, "initial_delay": "PT2S", "backoff_multiplier": 2}),
        act("Validate tax self-certification", "application", "kyc", "Check the CRS and FATCA self-certification: the countries of tax residence, each tax identification number, and US status.",
            tools=[TOOLS["validate_self_certification"]]),
        act("Resolve compliance alert", "human", "compliance",
            "A compliance officer resolves a screening alert or a self-certification that does not hold: confirms or clears the match, establishes the source of wealth and of the funds, and rates the risk.",
            sla={"id": u("sla:alert"), "name": "Alerts resolved within two working days", "target_time": "P1D", "max_time": "P2D",
                 "escalation_policy": {"breach_action": "record", "notify_roles": [u("role:compliance")]}},
            outcome_contract={"output_schema": obj(["pep_confirmed", "relationship_refused", "note"], pep_confirmed=B, relationship_refused=B,
                                                   source_of_wealth=S, risk_rating={"type": "string", "enum": ["low", "medium", "high"]}, note={"type": "string", "minLength": 10})}),
        act("Approve PEP relationship", "human", "compliance",
            "Two approvers accept, or refuse, a business relationship with a politically exposed person; the deployment's four-eyes rule makes the second approval necessary.",
            outcome_contract={"output_schema": obj(["approved"], approved=B, note=S)}),
        act("Record due diligence", "application", "kyc", "Record the due diligence file as accepted, with its level, its CRS reporting and its FATCA status.",
            tools=[TOOLS["record_due_diligence"]]),
        act("Record refusal of relationship", "application", "kyc", "Record that the business relationship is refused.",
            tools=[TOOLS["record_due_diligence"]]),
    ],
    "decision_nodes": [{
        "id": u("Customer due diligence"), "name": "Customer due diligence",
        "description": "The level of due diligence and who decides it, from the identity check, the screening and the self-certification.",
        "decision_table": {
            "hit_policy": "first",
            "inputs": [{"name": "identity_verified", "label": "Identity verified", "type": "boolean"}, {"name": "screening_result", "label": "Screening", "type": "string"},
                       {"name": "self_certification_valid", "label": "Self-certification valid", "type": "boolean"}, {"name": "us_person", "label": "US person", "type": "boolean"}],
            "outputs": [{"name": "cdd_level", "type": "string"}, {"name": "fatca_status", "type": "string"}],
            "rules": [
                {"description": "Identity not verified: refused", "input_entries": ["false", "-", "-", "-"], "output_entries": ["refused", "not_assessed"],
                 "output_edge_id": u("Customer due diligence->Record refusal of relationship")},
                {"description": "A politically exposed person or a possible sanctions match: enhanced due diligence by compliance", "input_entries": ["-", '"pep", "possible_sanctions_match"', "-", "-"],
                 "output_entries": ["enhanced", "pending"], "output_edge_id": u("Customer due diligence->Resolve compliance alert")},
                {"description": "A self-certification that does not hold: compliance", "input_entries": ["-", "-", "false", "-"], "output_entries": ["standard", "pending"],
                 "output_edge_id": u("Customer due diligence->Resolve compliance alert")},
                {"description": "A US person: reportable under FATCA", "input_entries": ["-", '"clear"', "true", "true"], "output_entries": ["standard", "us_reportable"],
                 "output_edge_id": u("Customer due diligence->Record due diligence")},
                {"description": "Clear", "input_entries": ["-", '"clear"', "true", "-"], "output_entries": ["standard", "not_us"],
                 "output_edge_id": u("Customer due diligence->Record due diligence")},
            ],
        },
        "default_output_edge_id": u("Customer due diligence->Resolve compliance alert"),
    }],
    "edges": [
        edge("Checks requested", "Verify identity documents"),
        edge("Verify identity documents", "Screen PEP and sanctions"),
        edge("Verify identity documents", "Validate tax self-certification"),
        edge("Screen PEP and sanctions", "Checks back"),
        edge("Validate tax self-certification", "Checks back"),
        edge("Checks back", "Customer due diligence"),
        {**edge("Customer due diligence", "Record refusal of relationship"), "label": "identity not verified"},
        {**edge("Customer due diligence", "Resolve compliance alert"), "label": "alert"},
        {**edge("Customer due diligence", "Record due diligence"), "label": "clear"},
        edge("Resolve compliance alert", "Approve PEP relationship", condition="pep_confirmed == true", label="politically exposed"),
        edge("Resolve compliance alert", "Record refusal of relationship", condition="relationship_refused == true", label="refused"),
        edge("Resolve compliance alert", "Record due diligence", is_default=True, label="cleared"),
        edge("Approve PEP relationship", "Record due diligence", condition="approved == true", label="approved"),
        edge("Approve PEP relationship", "Record refusal of relationship", is_default=True, label="not approved"),
        edge("Record due diligence", "Checks passed"),
        edge("Record refusal of relationship", "Checks failed"),
    ],
}
write("identity-aml-and-tax-residence.awa.json", kyc)

# =====================================================================================================
# 2. Savings plan subscription (journey stages 4 to 6)
# =====================================================================================================
u, act, edge, ev, role = kit("subscription")
SUBSCRIPTION_ID = u("workflow")
subscription = {
    "$schema": "https://awa.io/schema/awa.schema.json", "id": SUBSCRIPTION_ID, "name": "Savings Plan Subscription", "version": "1.0.0", "awa_version": "1.1",
    "description": "Subscribes an employee to the plan: proposes unit-linked funds or a model portfolio with their key information documents, checks the choice against the risk profile, runs the due diligence as a child run, reviews the beneficiary clause, has the contract signed, issues the policy, sets up the payroll deduction, invests the first premium and keeps the 30 days in which the employee may cancel with a full refund.",
    "sla": {"id": u("sla:subscription"), "name": "Policy in force within two months of the profile", "target_time": "P60D", "max_time": "P90D",
            "escalation_policy": {"breach_action": "record", "notify_roles": [u("role:policy-admin")]}},
    "roles": [
        role("ai-adviser", "AI adviser", "ai_agent", "Proposes funds within the profile and warns, in plain words, when a choice goes beyond it.", "tier:balanced",
             ["unit-linked funds", "key information documents"]),
        role("funds", "Fund platform", "application", "The range of unit-linked funds and model portfolios, with their key information documents and summary risk indicators."),
        role("licensed-adviser", "Licensed adviser", "human", "Discusses a choice above the profile with the employee."),
        role("compliance", "Compliance officer", "human", "Approves, or not, a choice above the profile the employee insists on."),
        role("due-diligence", "Due diligence desk", "application", "Runs the customer due diligence; the work is done by the Identity, AML and Tax Residence Checks workflow."),
        role("checker", "Contract checker", "ai_agent", "Checks a beneficiary clause is complete and unambiguous.", "tier:balanced", ["beneficiary clauses"]),
        role("esign", "E-signature service", "application", "Sends documents for qualified e-signature and reports them signed."),
        role("policy-admin", "Policy administration", "application", "Valoria Life's policy administration system."),
        role("payroll", "Employer payroll", "application", "Kestrel's payroll system, which deducts the contribution from the salary and pays it to the insurer."),
        role("custodian", "Custodian bank", "application", "The custodian bank that holds the assets covering the policies, apart from the insurer's own."),
        role("portal", "HR portal", "application", "The HR portal Valoria Life provides to the employer."),
        role("back-office", "Back-office administrator", "human", "Valoria Life's back-office, who takes over a file an agent could not settle."),
    ],
    "events": [
        ev("Profile completed", "start", "The employee's profile is known: the subscription starts.", name="profile.completed"),
        ev("Investments chosen", "message", "Wait for the employee's choice of funds in the portal.", name="investments.chosen",
           correlation_key="enrolment_id", timeout="P14D", timeout_edge_id=u("Investments chosen->Close subscription")),
        ev("Choice reconsidered", "message", "Wait for the employee to adjust the choice, or to keep it and acknowledge the risk.", name="investments.reconsidered",
           correlation_key="enrolment_id", timeout="P14D", timeout_edge_id=u("Choice reconsidered->Close subscription")),
        ev("Investments confirmed", "message", "Tell the journey the investments are settled.", name="investments.confirmed",
           mode="publish", data=["enrolment_id", "allocation", "portfolio_sri", "allocation_confirmed"]),
        ev("Subscription form submitted", "message", "Wait for the subscription form: documents, tax self-certification, beneficiary clause, monthly contribution.",
           name="subscription.submitted", correlation_key="enrolment_id", timeout="P14D", timeout_edge_id=u("Subscription form submitted->Close subscription")),
        ev("Contract signed", "message", "Wait for the e-signature service to report the signed contract.", name="contract.signed",
           correlation_key="enrolment_id", timeout="P14D", timeout_edge_id=u("Contract signed->Close subscription")),
        ev("First premium received", "message",
           "Wait for the first payroll contribution. If none comes in 45 days the wait fails the run (EVENT_TIMEOUT), and compensation stops the deduction and cancels the policy.",
           name="payroll.contribution_paid", correlation_key="enrolment_id", timeout="P45D"),
        ev("Policy issued", "message", "Tell the journey the policy is issued and the first premium invested.", name="policy.issued",
           mode="publish", data=["enrolment_id", "policy_id", "policy_issued", "plan_id", "employee", "monthly_contribution_eur", "allocation", "max_sri",
                                 "premiums_paid_eur", "tax_year", "deduction_id"]),
        ev("Cooling-off period", "message",
           "The 30 days in which the employee may cancel. A cancellation is the journey's exit policy.cancellation_requested: the host withdraws this run and compensation undoes the issue, the investment and the deduction. At the deadline, or when the policy administration closes the period, the policy is in force.",
           name="cooling_off.ended", correlation_key="enrolment_id", timeout="P30D", timeout_edge_id=u("Cooling-off period->Confirm policy in force:timeout")),
        ev("Policy in force", "message", "Tell the journey the policy is in force.", name="policy.in_force",
           mode="publish", data=["enrolment_id", "policy_id", "policy_in_force", "in_force_on", "premiums_paid_eur"]),
        ev("Subscription closed", "message", "Tell the journey the subscription was not completed.", name="subscription.lapsed",
           mode="publish", data=["enrolment_id", "lapsed_reason"]),
        ev("Subscription refused", "message", "Tell the journey the subscription was refused after due diligence.", name="subscription.refused",
           mode="publish", data=["enrolment_id", "refusal_reason"]),
        ev("Plan in force", "end"),
        ev("Not subscribed", "end"),
        ev("Refused", "end"),
    ],
    "activities": [
        act("Propose investments", "ai_agent", "ai-adviser",
            "Propose the model portfolio that fits the risk profile and the sustainability preferences, and the funds the employee may choose instead, each with its key information document.",
            procedure="List the plan's funds and model portfolios with the fund tool. Propose the model portfolio whose summary risk indicator fits the profile, taking the sustainability preferences into account. List the funds within the profile as alternatives. Give the key information document of every fund you name. Never state a guaranteed return.",
            tools=[TOOLS["list_funds"]],
            outcome_contract={
                "output_schema": obj(["proposed_allocation", "allocation_total", "max_fund_sri", "kids", "missing_kid_count", "explanation"],
                                     proposed_allocation=ALLOCATION, allocation_total=N, max_fund_sri={"type": "integer", "minimum": 1, "maximum": 7},
                                     kids={"type": "array", "minItems": 1, "items": obj(["fund_id", "kid_id"], fund_id=S, kid_id=S)}, missing_kid_count=I0,
                                     model_portfolio=S, explanation={"type": "string", "minLength": 60}),
                "postconditions": [
                    {"name": "The allocation adds up to 100%", "expression": "allocation_total == 100"},
                    {"name": "Every fund named has its key information document", "expression": "missing_kid_count == 0"},
                ],
                "budgets": {"max_attempts": 2, "max_tool_calls": 4},
            }),
        act("Check choice against profile", "application", "funds",
            "Check the chosen allocation against the risk profile: its weighted summary risk indicator, the excess over the profile's maximum, and that every key information document was delivered.",
            tools=[TOOLS["check_allocation"]]),
        act("Warn about the risk", "ai_agent", "ai-adviser",
            "Tell the employee, in plain words, that the choice is riskier than the profile allows, by how much, and what they can do: adjust it, or keep it and acknowledge the risk after talking to an adviser.",
            tools=[TOOLS["send_notification"]],
            outcome_contract={
                "output_schema": obj(["warning", "portfolio_sri_stated", "profile_stated", "options_given"], warning={"type": "string", "minLength": 80},
                                     portfolio_sri_stated=B, profile_stated=B, options_given=B),
                "postconditions": [{"name": "States the choice's risk indicator", "expression": "portfolio_sri_stated == true"},
                                   {"name": "States the profile", "expression": "profile_stated == true"},
                                   {"name": "Says what the employee can do", "expression": "options_given == true"}],
            }),
        act("Discuss the risk with an adviser", "human", "licensed-adviser",
            "A licensed adviser talks the choice through with an employee who wants to keep it, and records the employee's informed acknowledgement.",
            outcome_contract={"output_schema": obj(["acknowledgement_recorded", "note"], acknowledgement_recorded=B, note={"type": "string", "minLength": 10})}),
        act("Approve choice above profile", "human", "compliance",
            "A compliance officer accepts, or not, a choice above the profile that the employee insists on. Whoever advised the employee on it may not approve it.",
            outcome_contract={"output_schema": obj(["approved", "allocation_confirmed"], approved=B, allocation_confirmed=B, note=S)}),
        act("Run identity and AML checks", "application", "due-diligence",
            "Run the customer due diligence by the Identity, AML and Tax Residence Checks workflow.",
            is_expandable=True, expansion_workflow_id=KYC_ID,
            subworkflow={
                "input": {"enrolment_id": "enrolment_id", "employee": "employee", "documents": "documents", "self_certification": "self_certification",
                          "tax_residence": "tax_residence"},
                "output": {"kyc_status": "kyc_status", "cdd_level": "cdd_level", "fatca_status": "fatca_status", "crs_reportable": "crs_reportable",
                           "kyc_file_id": "kyc_file_id", "screening_result": "screening_result"},
            },
            outcome_contract={"postconditions": [{"name": "Says how the due diligence ended", "expression": "kyc_status exists"}]}),
        act("Review beneficiary clause", "ai_agent", "checker",
            "Check the beneficiary clause: the standard clause, or named beneficiaries each identified, with shares that add up to 100%.",
            outcome_contract={
                "output_schema": obj(["clause_type", "shares_total", "unidentified_count", "beneficiary_clause_valid"],
                                     clause_type={"type": "string", "enum": ["standard", "named"]}, shares_total=N, unidentified_count=I0, beneficiary_clause_valid=B, note=S),
                "postconditions": [{"name": "Shares add up to 100%", "expression": "shares_total == 100"},
                                   {"name": "Every beneficiary is identified", "expression": "unidentified_count == 0"}],
                "on_violation": "escalate_human",
            }),
        act("Prepare contract for signature", "application", "esign", "Send the contract, the beneficiary clause and the payroll deduction mandate for e-signature.",
            tools=[TOOLS["request_signature"]]),
        act("Issue policy", "application", "policy-admin", "Issue the policy and open its account with the custodian bank.",
            tools=[TOOLS["issue_policy"]], compensation={"activity_id": u("Cancel policy")}),
        act("Set up payroll deduction", "application", "payroll", "Set up the monthly payroll deduction the employee signed, from the next payroll.",
            tools=[TOOLS["create_payroll_deduction"]], compensation={"activity_id": u("Stop payroll deduction")}),
        act("Invest first premium", "application", "custodian", "Record the first premium and buy the units of the chosen allocation through the custodian bank.",
            tools=[TOOLS["record_premium"], TOOLS["place_order"]], compensation={"activity_id": u("Redeem units and refund premium")}),
        act("Send policy documents", "application", "portal",
            "Send the policy documents: the policy schedule, the key information documents, and the right to cancel within 30 days with a full refund.",
            tools=[TOOLS["send_notification"]]),
        act("Confirm policy in force", "application", "policy-admin", "Mark the policy in force once the 30 days have passed without a cancellation."),
        act("Close subscription", "application", "policy-admin", "Close the subscription: the employee did not continue within the time given."),
        act("Record refusal", "application", "policy-admin", "Record that the subscription is refused after the due diligence, and tell the employee."),
        act("Cancel policy", "application", "policy-admin", "Cancel the policy from its start.", tools=[TOOLS["cancel_policy"]]),
        act("Stop payroll deduction", "application", "payroll", "Stop the payroll deduction.", tools=[TOOLS["stop_payroll_deduction"]]),
        act("Redeem units and refund premium", "application", "custodian",
            "Sell the units bought and refund every premium paid in full: the plan bears any loss in value during the 30 days.",
            tools=[TOOLS["redeem_units"], TOOLS["refund_premium"]]),
    ],
    "decision_nodes": [{
        "id": u("Suitability of the choice"), "name": "Suitability of the choice",
        "description": "Whether the chosen allocation fits the risk profile: its weighted summary risk indicator against the profile's maximum, and the key information documents delivered.",
        "decision_table": {
            "hit_policy": "first",
            "inputs": [{"name": "kids_delivered", "label": "Key information documents delivered", "type": "boolean"}, {"name": "sri_excess", "label": "Excess over the profile's SRI", "type": "number"}],
            "outputs": [{"name": "suitability", "type": "string"}, {"name": "allocation_confirmed", "type": "boolean"}],
            "rules": [
                {"description": "A key information document was not delivered: the choice cannot be accepted yet", "input_entries": ["false", "-"], "output_entries": ["kid_missing", False],
                 "output_edge_id": u("Suitability of the choice->Warn about the risk")},
                {"description": "Within the profile", "input_entries": ["true", "<= 0"], "output_entries": ["suitable", True],
                 "output_edge_id": u("Suitability of the choice->Investments confirmed")},
                {"description": "Above the profile", "input_entries": ["true", "> 0"], "output_entries": ["above_profile", False],
                 "output_edge_id": u("Suitability of the choice->Warn about the risk")},
            ],
        },
        "default_output_edge_id": u("Suitability of the choice->Warn about the risk"),
    }],
    "edges": [
        edge("Profile completed", "Propose investments"),
        edge("Propose investments", "Investments chosen"),
        edge("Investments chosen", "Check choice against profile"),
        edge("Investments chosen", "Close subscription", label="no choice in 14 days"),
        edge("Check choice against profile", "Suitability of the choice"),
        {**edge("Suitability of the choice", "Investments confirmed"), "label": "within the profile"},
        {**edge("Suitability of the choice", "Warn about the risk"), "label": "above the profile"},
        edge("Warn about the risk", "Choice reconsidered"),
        edge("Choice reconsidered", "Check choice against profile", condition="reconsider_decision == adjust", label="adjusts the choice"),
        edge("Choice reconsidered", "Discuss the risk with an adviser", is_default=True, label="keeps the choice"),
        edge("Choice reconsidered", "Close subscription", label="no answer in 14 days"),
        edge("Discuss the risk with an adviser", "Approve choice above profile"),
        edge("Approve choice above profile", "Investments confirmed", condition="approved == true", label="approved"),
        edge("Approve choice above profile", "Choice reconsidered", is_default=True, label="not approved: adjust"),
        edge("Investments confirmed", "Subscription form submitted"),
        edge("Subscription form submitted", "Run identity and AML checks"),
        edge("Subscription form submitted", "Close subscription", label="no form in 14 days"),
        edge("Run identity and AML checks", "Review beneficiary clause", condition="kyc_status == passed", label="due diligence passed"),
        edge("Run identity and AML checks", "Record refusal", is_default=True, label="refused"),
        edge("Review beneficiary clause", "Prepare contract for signature"),
        edge("Prepare contract for signature", "Contract signed"),
        edge("Contract signed", "Issue policy"),
        edge("Contract signed", "Close subscription", label="not signed in 14 days"),
        edge("Issue policy", "Set up payroll deduction"),
        edge("Set up payroll deduction", "First premium received"),
        edge("First premium received", "Invest first premium"),
        edge("Invest first premium", "Policy issued"),
        edge("Policy issued", "Send policy documents"),
        edge("Send policy documents", "Cooling-off period"),
        edge("Cooling-off period", "Confirm policy in force", label="period closed"),
        edge("Cooling-off period", "Confirm policy in force", key="timeout", label="30 days without a cancellation"),
        edge("Confirm policy in force", "Policy in force"),
        edge("Policy in force", "Plan in force"),
        edge("Close subscription", "Subscription closed"),
        edge("Subscription closed", "Not subscribed"),
        edge("Record refusal", "Subscription refused"),
        edge("Subscription refused", "Refused"),
    ],
}
# The three handlers stand outside the flow (13.6): no edge reaches them
write("savings-plan-subscription.awa.json", subscription)

# =====================================================================================================
# 3. Payroll contributions (journey stage 7): one run per policy and tax year
# =====================================================================================================
u, act, edge, ev, role = kit("contributions")
CONTRIBUTIONS_ID = u("workflow")
contributions = {
    "$schema": "https://awa.io/schema/awa.schema.json", "id": CONTRIBUTIONS_ID, "name": "Payroll Contributions", "version": "1.0.0", "awa_version": "1.1",
    "description": "From the policy's coming into force, invests each monthly payroll contribution, a top-up included, records it on the policy, sends a statement each quarter, and closes the savings year with the premiums of the tax year after the December payroll.",
    "roles": [
        role("custodian", "Custodian bank", "application", "The custodian bank that holds the assets covering the policies."),
        role("policy-admin", "Policy administration", "application", "Valoria Life's policy administration system."),
        role("portal", "HR portal", "application", "The HR portal Valoria Life provides to the employer."),
    ],
    "events": [
        ev("Policy in force", "start", "The 30 days to cancel have passed: from the next payroll, the contributions are invested here.", name="policy.in_force"),
        ev("Contribution paid", "message", "Wait for the next payroll: the employer pays the month's contribution.", name="payroll.contribution_paid",
           correlation_key="enrolment_id", timeout="P40D", timeout_edge_id=u("Contribution paid->Report missing contribution")),
        ev("Contribution recorded", "message", "Tell the journey the premiums paid in the tax year so far.", name="contribution.recorded",
           mode="publish", data=["enrolment_id", "period", "premiums_paid_eur"]),
        ev("Savings year closed", "message", "Tell the journey and the year-end tax the premiums of the tax year.", name="savings_year.closed",
           mode="publish", data=["enrolment_id", "policy_id", "tax_year", "premiums_paid_eur", "savings_year_closed"]),
        ev("Year closed", "end"),
    ],
    "activities": [
        act("Invest contribution", "application", "custodian", "Record the contribution on the policy and buy units of the allocation through the custodian bank.",
            tools=[TOOLS["record_premium"], TOOLS["place_order"]], retry={"max_attempts": 3, "initial_delay": "PT5S"}),
        act("Report missing contribution", "application", "portal", "Tell the employee and Kestrel HR that no contribution arrived for the month."),
        act("Send quarterly statement", "application", "portal", "Send the quarterly statement: the value, the units by fund and the premiums paid this year.",
            tools=[TOOLS["get_position"], TOOLS["send_notification"]]),
        act("Send annual statement", "application", "portal", "Send the annual statement after the December payroll.",
            tools=[TOOLS["get_position"], TOOLS["send_notification"]]),
    ],
    "decision_nodes": [{
        "id": u("After the contribution"), "name": "After the contribution",
        "description": "What follows a contribution: a statement at the end of a quarter, the close of the savings year after December, otherwise the next payroll.",
        "decision_table": {
            "hit_policy": "first",
            "inputs": [{"name": "period", "label": "Payroll period", "type": "string"}],
            "outputs": [{"name": "statement_due", "type": "string"}],
            "rules": [
                {"description": "December: the year closes", "input_entries": ['ends with "-12"'], "output_entries": ["annual"],
                 "output_edge_id": u("After the contribution->Send annual statement")},
                {"description": "End of a quarter", "input_entries": ['matches("-(03|06|09)$")'], "output_entries": ["quarterly"],
                 "output_edge_id": u("After the contribution->Send quarterly statement")},
            ],
        },
        "default_output_edge_id": u("After the contribution->Contribution paid"),
    }],
    "edges": [
        edge("Policy in force", "Contribution paid"),
        edge("Contribution paid", "Invest contribution"),
        edge("Contribution paid", "Report missing contribution", label="no payroll in 40 days"),
        edge("Report missing contribution", "Contribution paid"),
        edge("Invest contribution", "Contribution recorded"),
        edge("Contribution recorded", "After the contribution"),
        {**edge("After the contribution", "Send annual statement"), "label": "December"},
        {**edge("After the contribution", "Send quarterly statement"), "label": "end of a quarter"},
        {**edge("After the contribution", "Contribution paid"), "label": "next payroll"},
        edge("Send quarterly statement", "Contribution paid"),
        edge("Send annual statement", "Savings year closed"),
        edge("Savings year closed", "Year closed"),
    ],
}
write("payroll-contributions.awa.json", contributions)

# =====================================================================================================
# 3b. Self-service change (journey stage 7): one run per request in the HR portal
# =====================================================================================================
u, act, edge, ev, role = kit("self-service")
SELF_SERVICE_ID = u("workflow")
self_service = {
    "$schema": "https://awa.io/schema/awa.schema.json", "id": SELF_SERVICE_ID, "name": "Self-Service Change", "version": "1.0.0", "awa_version": "1.1",
    "description": "A change the employee makes in the HR portal: a fund switch, or a top-up collected with the next payroll. Each is checked against the risk profile and the plan's rules before it is made.",
    "roles": [
        role("funds", "Fund platform", "application", "Checks allocations against risk profiles."),
        role("custodian", "Custodian bank", "application", "The custodian bank that holds the assets covering the policies."),
        role("payroll", "Employer payroll", "application", "Kestrel's payroll system."),
        role("portal", "HR portal", "application", "The HR portal Valoria Life provides to the employer."),
    ],
    "events": [
        ev("Change requested", "start", "The employee asks for a fund switch or a top-up in the HR portal.", name="self_service.requested"),
        ev("Change made", "message", "Tell the journey the change is made.", name="self_service.completed",
           mode="publish", data=["enrolment_id", "request_type", "change_status"]),
        ev("Change declined", "message", "Tell the journey the change was declined.", name="self_service.declined",
           mode="publish", data=["enrolment_id", "request_type", "decline_reason"]),
        ev("Done", "end"),
        ev("Not done", "end"),
    ],
    "activities": [
        act("Check change against profile", "application", "funds", "Check the allocation the change leads to against the risk profile.",
            tools=[TOOLS["check_allocation"]]),
        act("Switch funds", "application", "custodian", "Move the policy's value to the new allocation.", tools=[TOOLS["switch_funds"]]),
        act("Schedule top-up", "application", "payroll", "Add the top-up to the next payroll deduction.", tools=[TOOLS["schedule_one_off_deduction"]]),
        act("Decline the change", "application", "portal", "Tell the employee why the change cannot be made, and offer a licensed adviser.",
            tools=[TOOLS["send_notification"]]),
    ],
    "decision_nodes": [{
        "id": u("Change within the rules"), "name": "Change within the rules",
        "description": "A switch must stay within the profile; a top-up is invested in the current allocation, and the plan takes at most 10,000 EUR of top-ups a year (an example of a plan rule).",
        "decision_table": {
            "hit_policy": "first",
            "inputs": [{"name": "request_type", "label": "Request", "type": "string"}, {"name": "sri_excess", "label": "Excess over the profile's SRI", "type": "number"},
                       {"name": "top_up_eur", "label": "Top-up (EUR)", "type": "number"}],
            "outputs": [{"name": "change_decision", "type": "string"}],
            "rules": [
                {"description": "Above the profile", "input_entries": ["-", "> 0", "-"], "output_entries": ["above_profile"],
                 "output_edge_id": u("Change within the rules->Decline the change")},
                {"description": "A switch within the profile", "input_entries": ['"switch"', "<= 0", "-"], "output_entries": ["switch"],
                 "output_edge_id": u("Change within the rules->Switch funds")},
                {"description": "A top-up within the plan's yearly limit", "input_entries": ['"top_up"', "<= 0", "(0..10000]"], "output_entries": ["top_up"],
                 "output_edge_id": u("Change within the rules->Schedule top-up")},
            ],
        },
        "default_output_edge_id": u("Change within the rules->Decline the change"),
    }],
    "edges": [
        edge("Change requested", "Check change against profile"),
        edge("Check change against profile", "Change within the rules"),
        {**edge("Change within the rules", "Switch funds"), "label": "switch within the profile"},
        {**edge("Change within the rules", "Schedule top-up"), "label": "top-up within the plan"},
        {**edge("Change within the rules", "Decline the change"), "label": "outside the rules"},
        edge("Switch funds", "Change made"),
        edge("Schedule top-up", "Change made"),
        edge("Change made", "Done"),
        edge("Decline the change", "Change declined"),
        edge("Change declined", "Not done"),
    ],
}
write("self-service-change.awa.json", self_service)

# =====================================================================================================
# 4. Year-end tax (journey stage 8)
# =====================================================================================================
u, act, edge, ev, role = kit("year-end-tax")
TAX_ID = u("workflow")
tax = {
    "$schema": "https://awa.io/schema/awa.schema.json", "id": TAX_ID, "name": "Year-End Tax", "version": "1.0.0", "awa_version": "1.1",
    "description": "From November to January: the deductible amount per article of the income tax law, a top-up proposal to reach the ceiling before 31 December, and the annual tax certificate for the tax return. A cross-border worker's file goes to a tax adviser first, since whether the deduction applies depends on their situation.",
    "sla": {"id": u("sla:tax"), "name": "Certificate by the end of February", "target_time": "P90D", "max_time": "P120D",
            "escalation_policy": {"breach_action": "record", "notify_roles": [u("role:back-office")]}},
    "roles": [
        role("tax-service", "Tax computation service", "application", "Computes deductible amounts from premiums and the ceilings of the decision table."),
        role("tax-adviser", "Tax adviser", "human", "Valoria Life's tax adviser for cross-border workers."),
        role("ai-adviser", "AI adviser", "ai_agent", "Writes the top-up proposal.", "tier:balanced", ["Luxembourg personal income tax", "customer writing"]),
        role("certificates", "Tax certificate service", "application", "Issues the annual tax certificates of premiums paid."),
        role("back-office", "Back-office administrator", "human", "Valoria Life's back-office."),
        role("portal", "HR portal", "application", "The HR portal Valoria Life provides to the employer."),
    ],
    "events": [
        ev("Tax review due", "start", "November: the insurer's calendar opens the year-end review of the tax year.", name="tax_year.review_due"),
        ev("Year's premiums known", "message", "Wait for the close of the savings year after the December payroll.", name="savings_year.closed",
           correlation_key="enrolment_id", timeout="P75D", timeout_edge_id=u("Year's premiums known->Confirm premiums by hand")),
        ev("Certificates due", "message", "Wait for the January certificate run of the policy administration.", name="tax_certificates.due",
           correlation_key="enrolment_id", timeout="P60D", timeout_edge_id=u("Certificates due->Issue tax certificate:timeout")),
        ev("Tax certificate issued", "message", "Tell the journey the certificate is in the HR portal.", name="tax_certificate.issued",
           mode="publish", data=["enrolment_id", "tax_year", "certificate_id", "deduction_article", "deductible_eur", "tax_certificate_issued"]),
        ev("Year-end done", "end"),
    ],
    "activities": [
        act("Tax adviser review", "human", "tax-adviser",
            "A tax adviser looks at a cross-border worker's situation: whether they can be assimilated to a resident (at least 90% of their income taxable in Luxembourg, or the other thresholds of Art. 157ter LIR) and so deduct the premiums, and what to tell them.",
            sla={"id": u("sla:tax-adviser"), "name": "Cross-border files answered within ten days", "target_time": "P5D", "max_time": "P10D",
                 "escalation_policy": {"breach_action": "record", "notify_roles": [u("role:back-office")]}},
            outcome_contract={"output_schema": obj(["deduction_applicable", "note"], deduction_applicable=B, assimilated_to_resident=B, note={"type": "string", "minLength": 20})}),
        act("Project the year", "application", "tax-service", "Project the year's premiums and the deductible amount, with the contributions still to come, and the shortfall to the ceiling.",
            tools=[TOOLS["compute_deductions"]]),
        act("Write top-up proposal", "ai_agent", "ai-adviser",
            "Propose a top-up that reaches the ceiling before 31 December: the ceiling, the shortfall, how the top-up is collected with the December payroll, and that the deduction depends on the employee's own tax situation.",
            tools=[TOOLS["send_notification"]],
            outcome_contract={
                "output_schema": obj(["proposal", "proposed_top_up_eur", "ceiling_stated", "deadline_stated", "tax_caveat_given"],
                                     proposal={"type": "string", "minLength": 120}, proposed_top_up_eur={"type": "number", "exclusiveMinimum": 0},
                                     ceiling_stated=B, deadline_stated=B, tax_caveat_given=B),
                "postconditions": [{"name": "States the ceiling", "expression": "ceiling_stated == true"},
                                   {"name": "States the deadline of 31 December", "expression": "deadline_stated == true"},
                                   {"name": "Says the deduction depends on the employee's situation", "expression": "tax_caveat_given == true"}],
            }),
        act("Confirm premiums by hand", "human", "back-office", "The savings year did not close: a back-office administrator confirms the premiums of the tax year."),
        act("Compute deductible amounts", "application", "tax-service", "Compute the deductible amount per article from the premiums of the tax year.",
            tools=[TOOLS["compute_deductions"]]),
        act("Issue tax certificate", "application", "certificates", "Issue the annual tax certificate and put it in the HR portal.",
            tools=[TOOLS["issue_tax_certificate"], TOOLS["send_notification"]]),
    ],
    "decision_nodes": [
        {
            "id": u("Tax residence route"), "name": "Tax residence route",
            "description": "A resident of Luxembourg goes straight to the deduction rules. A cross-border worker goes to a tax adviser first.",
            "decision_table": {
                "hit_policy": "first",
                "inputs": [{"name": "tax_residence", "label": "Country of tax residence", "type": "string"}],
                "outputs": [{"name": "tax_route", "type": "string"}],
                "rules": [
                    {"description": "Resident of Luxembourg", "input_entries": ['"LU"'], "output_entries": ["resident"], "output_edge_id": u("Tax residence route->Deduction rules")},
                    {"description": "Cross-border worker from France, Belgium or Germany", "input_entries": ['"FR", "BE", "DE"'], "output_entries": ["cross_border"],
                     "output_edge_id": u("Tax residence route->Tax adviser review")},
                ],
            },
            "default_output_edge_id": u("Tax residence route->Tax adviser review"),
        },
        {
            "id": u("Deduction rules"), "name": "Deduction rules",
            "description": "The articles of the Luxembourg income tax law (LIR) under which premiums are deductible as special expenses, with their ceilings, AS DATA: a tax change is a new rule here, not a change of code. FACTS.md gives the source of each figure and marks those a tax adviser must confirm. This is not tax advice.",
            "decision_table": {
                "hit_policy": "collect",
                "inputs": [{"name": "contract_type", "label": "Contract", "type": "string"}, {"name": "tax_year", "label": "Tax year", "type": "number"}],
                "outputs": [{"name": "article", "type": "string"}, {"name": "annual_ceiling_eur", "type": "number"}, {"name": "ceiling_basis", "type": "string"},
                            {"name": "figure_confirmed", "type": "boolean"}],
                "rules": [
                    {"description": "Pension savings contract (prévoyance-vieillesse), Art. 111bis LIR, from tax year 2026", "input_entries": ['"pension_savings"', ">= 2026"],
                     "output_entries": ["111bis", 4500, "per_taxpayer", True]},
                    {"description": "Pension savings contract, Art. 111bis LIR, up to tax year 2025", "input_entries": ['"pension_savings"', "< 2026"],
                     "output_entries": ["111bis", 3200, "per_taxpayer", True]},
                    {"description": "Life insurance premiums, Art. 111 LIR, shared with other insurance premiums", "input_entries": ['"life_insurance"', "-"],
                     "output_entries": ["111", 672, "per_household_member", True]},
                    {"description": "Personal contributions to an employer's supplementary pension scheme, Art. 110 LIR", "input_entries": ['"employer_scheme_personal"', "-"],
                     "output_entries": ["110", 1200, "per_taxpayer", True]},
                ],
            },
            "default_output_edge_id": u("Deduction rules->Project the year"),
        },
        {
            "id": u("Top-up worth proposing"), "name": "Top-up worth proposing",
            "description": "A top-up is proposed when the year's premiums will stay below the ceiling.",
            "decision_table": {
                "hit_policy": "first",
                "inputs": [{"name": "shortfall_eur", "label": "Shortfall to the ceiling (EUR)", "type": "number"}],
                "outputs": [{"name": "top_up_proposed", "type": "boolean"}],
                "rules": [{"description": "Below the ceiling", "input_entries": ["> 0"], "output_entries": [True], "output_edge_id": u("Top-up worth proposing->Write top-up proposal")}],
            },
            "default_output_edge_id": u("Top-up worth proposing->Year's premiums known"),
        },
    ],
    "edges": [
        edge("Tax review due", "Tax residence route"),
        {**edge("Tax residence route", "Deduction rules"), "label": "resident"},
        {**edge("Tax residence route", "Tax adviser review"), "label": "cross-border worker"},
        edge("Tax adviser review", "Deduction rules"),
        {**edge("Deduction rules", "Project the year")},
        edge("Project the year", "Top-up worth proposing"),
        {**edge("Top-up worth proposing", "Write top-up proposal"), "label": "below the ceiling"},
        {**edge("Top-up worth proposing", "Year's premiums known"), "label": "at the ceiling"},
        edge("Write top-up proposal", "Year's premiums known"),
        edge("Year's premiums known", "Compute deductible amounts"),
        edge("Year's premiums known", "Confirm premiums by hand", label="the year did not close"),
        edge("Confirm premiums by hand", "Compute deductible amounts"),
        edge("Compute deductible amounts", "Certificates due"),
        edge("Certificates due", "Issue tax certificate"),
        edge("Certificates due", "Issue tax certificate", key="timeout", label="no certificate run in 60 days"),
        edge("Issue tax certificate", "Tax certificate issued"),
        edge("Tax certificate issued", "Year-end done"),
    ],
}
write("year-end-tax.awa.json", tax)

# =====================================================================================================
# 5. Annual review (journey stage 9)
# =====================================================================================================
u, act, edge, ev, role = kit("annual-review")
REVIEW_ID = u("workflow")
PROFILE_R = u("context:employee_profile")
review = {
    "$schema": "https://awa.io/schema/awa.schema.json", "id": REVIEW_ID, "name": "Annual Review", "version": "1.0.0", "awa_version": "1.1",
    "description": "The yearly review: the employee's changes of situation, the position of the plan, and the AI adviser's recommendations (rebalance, reduce the risk as retirement approaches, review the beneficiary clause after a life event), confirmed by a licensed adviser where they change the plan, then applied as the employee accepts them.",
    "roles": [
        role("portal", "HR portal", "application", "The HR portal Valoria Life provides to the employer."),
        role("custodian", "Custodian bank", "application", "The custodian bank that holds the assets covering the policies."),
        role("ai-adviser", "AI adviser", "ai_agent", "Recommends changes to the plan from the employee's situation and its position. Never promises a return.",
             "tier:reasoning", ["life insurance savings", "lifecycle investing"]),
        role("licensed-adviser", "Licensed adviser", "human", "Confirms recommendations that change the plan."),
        role("policy-admin", "Policy administration", "application", "Valoria Life's policy administration system."),
    ],
    "contexts": [profile_context(u, "The employee as the AI adviser needs to know them for the review: first name, language, age, retirement age, tax residence and risk profile.")],
    "events": [
        ev("Review due", "start", "The anniversary of the policy: the insurer's calendar opens the annual review.", name="annual_review.due"),
        ev("Review answers received", "message", "Wait for the employee's answers: changes of situation, life events, whether the deduction was claimed.",
           name="annual_review.answered", correlation_key="enrolment_id", timeout="P30D", timeout_edge_id=u("Review answers received->Read the plan's position:timeout")),
        ev("Recommendations answered", "message", "Wait for the employee to accept or decline the recommendations.", name="recommendations.answered",
           correlation_key="enrolment_id", timeout="P30D", timeout_edge_id=u("Recommendations answered->Record the review:timeout")),
        ev("Review completed", "message", "Tell the journey the review is done.", name="annual_review.completed",
           mode="publish", data=["enrolment_id", "review_completed", "recommendations_accepted"]),
        ev("Reviewed", "end"),
    ],
    "activities": [
        act("Invite to annual review", "application", "portal", "Invite the employee to the review in the HR portal: a few questions on what changed in the year.",
            tools=[TOOLS["send_notification"]], context_bindings=[{"context_id": PROFILE_R, "access_mode": "write"}]),
        act("Read the plan's position", "application", "custodian", "Read the value, the units by fund and the drift from the target allocation.",
            tools=[TOOLS["get_position"]]),
        act("Recommend changes", "ai_agent", "ai-adviser",
            "Recommend what to change, with a reason for each: rebalance when the allocation has drifted, reduce the risk as retirement approaches, review the beneficiary clause after a life event, or no change.",
            procedure="Read the position, the answers and the profile. Recommend a rebalance when a fund has drifted more than five points from its target. Recommend reducing the risk when retirement is ten years away or less. Recommend reviewing the beneficiary clause after a marriage, a partnership, a birth, a divorce or a death. Say when a licensed adviser must confirm. Never promise or imply a guaranteed return on unit-linked funds; their value can fall.",
            context_bindings=[{"context_id": PROFILE_R, "access_mode": "read"}],
            guardrails=[PERSONAL_DATA_IN(u, "recommendations", ["recommendation_text"])],
            outcome_contract={
                "output_schema": obj(["recommendations", "recommendation_text", "requires_adviser"],
                                     recommendations={"type": "array", "minItems": 1, "items": obj(["type", "reason"], type={"type": "string", "enum": RECOMMENDATIONS}, reason={"type": "string", "minLength": 10})},
                                     recommendation_text={"type": "string", "minLength": 80}, requires_adviser=B, target_allocation=ALLOCATION),
                "budgets": {"max_attempts": 3, "max_duration": "PT5M", "max_tokens": 40000},
            }),
        act("Confirm recommendations with an adviser", "human", "licensed-adviser", "A licensed adviser confirms, or changes, recommendations that change the plan.",
            outcome_contract={"output_schema": obj(["recommendations_confirmed"], recommendations_confirmed=B, note=S)}),
        act("Publish recommendations", "application", "portal", "Put the recommendations in the HR portal for the employee to accept or decline.",
            tools=[TOOLS["send_notification"]]),
        act("Apply accepted changes", "application", "custodian", "Apply what the employee accepted: a switch to the new allocation, a new beneficiary clause.",
            tools=[TOOLS["switch_funds"], TOOLS["update_beneficiary_clause"]]),
        act("Record the review", "application", "policy-admin", "Record the review, the recommendations and what the employee decided."),
    ],
    "decision_nodes": [{
        "id": u("Adviser needed"), "name": "Adviser needed",
        "description": "Recommendations that change the plan's risk or its beneficiaries are confirmed by a licensed adviser before the employee sees them.",
        "decision_table": {
            "hit_policy": "first",
            "inputs": [{"name": "requires_adviser", "label": "Changes the plan", "type": "boolean"}],
            "outputs": [{"name": "adviser_review", "type": "boolean"}],
            "rules": [{"description": "Changes the plan", "input_entries": ["true"], "output_entries": [True],
                       "output_edge_id": u("Adviser needed->Confirm recommendations with an adviser")}],
        },
        "default_output_edge_id": u("Adviser needed->Publish recommendations"),
    }],
    "edges": [
        edge("Review due", "Invite to annual review"),
        edge("Invite to annual review", "Review answers received"),
        edge("Review answers received", "Read the plan's position"),
        edge("Review answers received", "Read the plan's position", key="timeout", label="no answers in 30 days"),
        edge("Read the plan's position", "Recommend changes"),
        edge("Recommend changes", "Adviser needed"),
        {**edge("Adviser needed", "Confirm recommendations with an adviser"), "label": "changes the plan"},
        {**edge("Adviser needed", "Publish recommendations"), "label": "no change to confirm"},
        edge("Confirm recommendations with an adviser", "Publish recommendations"),
        edge("Publish recommendations", "Recommendations answered"),
        edge("Recommendations answered", "Apply accepted changes", condition="recommendations_accepted == true", label="accepted"),
        edge("Recommendations answered", "Record the review", is_default=True, label="declined"),
        edge("Recommendations answered", "Record the review", key="timeout", label="no answer in 30 days"),
        edge("Apply accepted changes", "Record the review"),
        edge("Record the review", "Review completed"),
        edge("Review completed", "Reviewed"),
    ],
}
write("annual-review.awa.json", review)

# =====================================================================================================
# The journey (specification 19)
# =====================================================================================================
uj = lambda name: str(uuid.uuid5(NS, f"awa-example:life-insurance-savings:journey:{name}"))


def tp(id, name, direction, channel, technology, exchanges=(), party="subject", **on):
    return {"id": id, "name": name, "party": party, "direction": direction, "channel": channel, "technology": technology, "on": on,
            "exchanges": [{"artefact": x} if isinstance(x, str) else {"artefact": x[0], "reference": x[1]} for x in exchanges]}


journey = {
    "id": uj("journey"), "name": "Workplace Pension Savings", "version": "1.0.0", "awa_version": "1.1",
    "description": "An employee's way through the pension savings plan Valoria Life runs for Kestrel Engineering: the invitation in the HR portal, advice, the questionnaire and the risk profile, the choice of funds, the subscription with its due diligence, the 30 days to cancel, a year of payroll contributions and self-service, the year-end tax certificate, and the annual review.",
    "subject": {"name": "employee", "key": "enrolment_id"},
    "stages": [
        {"id": "invitation", "name": "Invitation", "description": "The employer opens the plan; the employee is invited in the HR portal and by e-mail, and reminded.",
         "workflows": [ADVICE_ID], "complete_when": "invitation_opened == true", "max_duration": "P30D", "owner": "Kestrel HR"},
        {"id": "discovery", "name": "Discovery and advice", "description": "The AI adviser explains the plan, the tax ceiling and the risks; a licensed adviser takes over by video call on request.",
         "workflows": [ADVICE_ID], "complete_when": "advice_given == true", "max_duration": "P14D", "owner": "Valoria advice desk"},
        {"id": "profile", "name": "Needs and profile", "description": "The questionnaire: demands and needs, knowledge and experience, capacity for loss, horizon, risk tolerance, sustainability preferences; the risk profile.",
         "workflows": [ADVICE_ID], "complete_when": "risk_profile exists", "max_duration": "P21D", "owner": "Valoria advice desk"},
        {"id": "investments", "name": "Investments", "description": "A model portfolio or the employee's own choice of unit-linked funds, each with its key information document, checked against the profile.",
         "workflows": [SUBSCRIPTION_ID], "complete_when": "allocation_confirmed == true", "max_duration": "P21D", "owner": "Valoria advice desk"},
        {"id": "subscription", "name": "Subscription", "description": "Identity, anti-money-laundering and tax residence checks, the beneficiary clause, the payroll mandate, the e-signature.",
         "workflows": [KYC_ID], "complete_when": "contract_signed == true", "max_duration": "P30D", "owner": "Valoria subscription desk"},
        {"id": "cooling-off", "name": "Cooling-off and issue", "description": "The policy is issued and the first premium invested; the employee has 30 days to cancel with a full refund.",
         "complete_when": "policy_in_force == true", "max_duration": "P60D", "owner": "Valoria back-office"},
        {"id": "saving", "name": "Saving", "description": "Monthly payroll contributions, switches and top-ups in self-service, quarterly statements.",
         "workflows": [CONTRIBUTIONS_ID, SELF_SERVICE_ID], "complete_when": "tax_review_due == true", "max_duration": "P300D", "owner": "Kestrel payroll"},
        {"id": "year-end-tax", "name": "Year-end tax", "description": "The deductible amount, a top-up proposed before 31 December, the tax certificate in January for the tax return.",
         "workflows": [TAX_ID], "complete_when": "tax_certificate_issued == true", "max_duration": "P100D", "owner": "Valoria tax desk"},
        {"id": "annual-review", "name": "Annual review", "description": "Recommendations: rebalance, reduce the risk with age, update the beneficiary clause after a life event.",
         "workflows": [REVIEW_ID], "complete_when": "review_completed == true", "max_duration": "P45D", "owner": "Valoria advice desk", "transitions": []},
    ],
    "triggers": [
        {"event": "savings.invited", "starts_journey": True, "start_workflow": ADVICE_ID},
        {"event": "profile.completed", "start_workflow": SUBSCRIPTION_ID},
        {"event": "policy.in_force", "start_workflow": CONTRIBUTIONS_ID},
        {"event": "self_service.requested", "start_workflow": SELF_SERVICE_ID},
        {"event": "tax_year.review_due", "start_workflow": TAX_ID},
        {"event": "annual_review.due", "start_workflow": REVIEW_ID},
    ],
    "goals": [
        {"id": "policy-issued", "name": "Policy issued", "expression": "policy_issued == true"},
        {"id": "first-deduction-claimed", "name": "First year's deduction claimed", "expression": "deduction_claimed == true"},
    ],
    "exits": [
        {"event": "savings.invitation_lapsed", "outcome": "abandoned", "reason": "Did not take up the invitation"},
        {"event": "subscription.lapsed", "outcome": "abandoned", "reason": "Did not complete the subscription"},
        {"event": "subscription.refused", "outcome": "abandoned", "reason": "Not accepted after due diligence"},
        {"event": "policy.cancellation_requested", "outcome": "abandoned", "reason": "Cancelled within the 30-day period"},
    ],
    "artefacts": [
        {"id": "invitation", "name": "Plan invitation", "kind": "notice", "description": "What the plan is, who runs it, and until when the invitation is open."},
        {"id": "reminder", "name": "Reminder", "kind": "notice", "description": "The invitation is still open, and until when."},
        {"id": "plan-explanation", "name": "Plan explanation", "kind": "notice", "description": "The contract, the tax ceiling, the fees, the investment risk and the right to cancel."},
        {"id": "appointment", "name": "Video call appointment", "kind": "notice", "description": "A call with a licensed adviser."},
        {"id": "advice-record", "name": "Advice record", "kind": "report", "description": "What the licensed adviser advised."},
        {"id": "questionnaire", "name": "Suitability questionnaire", "kind": "survey", "description": "Demands and needs, knowledge and experience, financial situation, objectives, sustainability preferences."},
        {"id": "kid", "name": "Key information documents", "kind": "notice", "description": "The PRIIPs key information document of each fund proposed."},
        {"id": "fund-proposal", "name": "Investment proposal", "kind": "quote", "description": "The model portfolio proposed and the funds within the profile."},
        {"id": "risk-warning", "name": "Risk warning", "kind": "notice", "description": "The choice is riskier than the profile, and what the employee can do."},
        {"id": "identity-documents", "name": "Identity documents", "kind": "evidence", "description": "Identity card or passport, proof of address."},
        {"id": "self-certification", "name": "Tax residence self-certification", "kind": "attestation", "description": "Countries of tax residence, tax identification numbers, US status (CRS and FATCA)."},
        {"id": "beneficiary-clause", "name": "Beneficiary clause", "kind": "form", "description": "Who receives the savings if the employee dies before the payout."},
        {"id": "payroll-mandate", "name": "Payroll deduction mandate", "kind": "attestation", "description": "The employee's authorisation to deduct the contribution from the salary."},
        {"id": "contract", "name": "Policy contract", "kind": "contract", "description": "The pension savings contract under Art. 111bis LIR."},
        {"id": "policy-schedule", "name": "Policy schedule", "kind": "certificate", "description": "The policy issued, with the right to cancel within 30 days."},
        {"id": "premium", "name": "Premium", "kind": "receipt", "description": "A payroll contribution paid to the policy."},
        {"id": "statement", "name": "Statement", "kind": "report", "description": "The value, the units by fund and the premiums paid."},
        {"id": "top-up-proposal", "name": "Top-up proposal", "kind": "quote", "description": "The amount that reaches the ceiling before 31 December."},
        {"id": "tax-certificate", "name": "Tax certificate", "kind": "certificate", "description": "The premiums paid in the tax year and the article they fall under, for the tax return."},
        {"id": "recommendations", "name": "Recommendations", "kind": "report", "description": "What the review recommends, and why."},
        {"id": "cancellation", "name": "Cancellation request", "kind": "form", "description": "The employee cancels within 30 days."},
    ],
    "touchpoints": [
        tp("invited", "Is invited in the HR portal", "outbound", "email", "HR portal and e-mail", ["invitation"], activity="Send invitation"),
        tp("opens", "Opens the invitation", "inbound", "web", "HR portal", [], event="invitation.opened"),
        tp("reminded", "Is reminded of the invitation", "outbound", "email", "HR portal and e-mail", [("reminder", "reminder_id")], activity="Send invitation reminder"),
        tp("last-reminder", "Receives Kestrel HR's last reminder", "outbound", "web", "HR portal", ["reminder"], activity="Send last reminder"),
        tp("explained", "Is explained the plan by the AI adviser", "outbound", "chat", "HR portal (AI adviser chat)", ["plan-explanation"], activity="Explain the plan"),
        tp("video-call", "Talks to a licensed adviser by video", "outbound", "video", "Advice video calls", [("appointment", "appointment_id"), "advice-record"], activity="Advise in video call"),
        tp("answers-questionnaire", "Answers the questionnaire", "inbound", "web", "HR portal", ["questionnaire"], event="questionnaire.submitted"),
        tp("funds-proposed", "Receives an investment proposal", "outbound", "web", "HR portal", ["fund-proposal", "kid"], activity="Propose investments"),
        tp("chooses-funds", "Chooses the funds", "inbound", "web", "HR portal", ["kid"], event="investments.chosen"),
        tp("warned", "Is warned the choice is above the profile", "outbound", "web", "HR portal", ["risk-warning"], activity="Warn about the risk"),
        tp("reconsiders", "Adjusts or keeps the choice", "inbound", "web", "HR portal", [], event="investments.reconsidered"),
        tp("subscribes", "Submits the subscription form", "inbound", "web", "HR portal",
           [("identity-documents", "documents"), ("self-certification", "self_certification"), ("beneficiary-clause", "beneficiary_clause"), "payroll-mandate"], event="subscription.submitted"),
        tp("screened", "Is screened for PEP and sanctions", "outbound", "api", "Screening provider (HTTP)", [], party="screening provider", tool="screen_person"),
        tp("signs", "Signs the contract", "inbound", "web", "E-signature service", [("contract", "envelope_id")], event="contract.signed"),
        tp("payroll-mandate", "Is asked to deduct the contribution", "outbound", "api", "Kestrel payroll (JSON-RPC)", [("payroll-mandate", "deduction_id")], party="employer payroll", tool="create_payroll_deduction"),
        tp("units-bought", "Is asked to buy units", "outbound", "api", "Custodian bank (JSON-RPC)", [], party="custodian bank", tool="place_order"),
        tp("policy-documents", "Receives the policy documents", "outbound", "email", "HR portal and e-mail", ["policy-schedule", "kid"], activity="Send policy documents"),
        tp("cancels", "Cancels within 30 days", "inbound", "web", "HR portal", ["cancellation"], event="policy.cancellation_requested"),
        tp("contribution", "Pays a contribution through payroll", "inbound", "api", "Kestrel payroll", [("premium", "period")], party="employer payroll", event="payroll.contribution_paid"),
        tp("quarterly-statement", "Receives a quarterly statement", "outbound", "email", "HR portal and e-mail", ["statement"], activity="Send quarterly statement"),
        tp("annual-statement", "Receives the annual statement", "outbound", "email", "HR portal and e-mail", ["statement"], activity="Send annual statement"),
        tp("self-service", "Asks for a change in self-service", "inbound", "web", "HR portal (self-service)", [], event="self_service.requested"),
        tp("change-declined", "Is told a change cannot be made", "outbound", "web", "HR portal", [], activity="Decline the change"),
        tp("top-up-proposed", "Receives a top-up proposal", "outbound", "email", "HR portal and e-mail", ["top-up-proposal"], activity="Write top-up proposal"),
        tp("tax-adviser", "Talks to a tax adviser", "outbound", "phone", "Tax desk telephony", [], activity="Tax adviser review"),
        tp("tax-certificate", "Receives the tax certificate", "outbound", "web", "HR portal", [("tax-certificate", "certificate_id")], activity="Issue tax certificate"),
        tp("review-invited", "Is invited to the annual review", "outbound", "web", "HR portal", [], activity="Invite to annual review"),
        tp("review-answers", "Answers the review questions", "inbound", "web", "HR portal", [], event="annual_review.answered"),
        tp("recommendations", "Receives recommendations", "outbound", "web", "HR portal", ["recommendations"], activity="Publish recommendations"),
        tp("decides-recommendations", "Accepts or declines the recommendations", "inbound", "web", "HR portal", [], event="recommendations.answered"),
    ],
    "sentiment": {"min": -2, "max": 2, "initial": 0, "rules": [
        {"on": "touchpoint", "touchpoint": "reminded", "change": -0.25, "reason": "had to be reminded"},
        {"on": "touchpoint", "touchpoint": "last-reminder", "change": -0.25, "reason": "reminded again by the employer"},
        {"on": "touchpoint", "touchpoint": "video-call", "change": 0.5, "reason": "talked to a person"},
        {"on": "touchpoint", "touchpoint": "warned", "change": -0.25, "reason": "was told the choice is too risky"},
        {"on": "touchpoint", "touchpoint": "change-declined", "change": -0.25, "reason": "a change was refused"},
        {"on": "goal_reached", "goal": "policy-issued", "change": 0.5, "reason": "the policy is issued"},
        {"on": "touchpoint", "touchpoint": "tax-certificate", "change": 0.5, "reason": "has the certificate for the tax return"},
        {"on": "event", "event": "annual_review.answered", "measure": {"path": "satisfaction", "from": [1, 5]}, "reason": "said how satisfied they are in the review"},
        {"on": "run_failed", "change": -1, "reason": "a step of the plan failed"},
        {"on": "stalled", "change": -0.5, "reason": "nothing has moved for too long"},
    ]},
}
write("workplace-pension-savings.journey.json", journey)
print("wrote plan-invitation-and-advice.awa.json, savings-plan-subscription.awa.json, identity-aml-and-tax-residence.awa.json, payroll-contributions.awa.json, "
      "self-service-change.awa.json, year-end-tax.awa.json, annual-review.awa.json, workplace-pension-savings.journey.json")
