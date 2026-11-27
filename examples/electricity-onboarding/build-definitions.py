#!/usr/bin/env python3
"""
Writes the definitions of this example: the onboarding workflow, the grid export registration
it calls as a sub-workflow, and the journey of a new customer. Identifiers are derived from
names, so the output is stable: running this again writes the same files.

    python3 examples/electricity-onboarding/build-definitions.py
"""
import json
import pathlib
import uuid

HERE = pathlib.Path(__file__).parent
NS = uuid.UUID("6ba7b811-9dad-11d1-80b4-00c04fd430c8")
# Where the reference adapters listen (adapters/mock-server.mjs). A utility replaces these addresses with its own systems.
ADAPTERS = "http://localhost:4545"


def kit(prefix):
    u = lambda name: str(uuid.uuid5(NS, f"awa-example:electricity-onboarding:{prefix}:{name}"))

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

PLANS = ["fixed_12", "fixed_24", "variable", "time_of_use", "ev", "prosumer"]
SOURCES = ["renewable_100", "local_community", "low_carbon_mix", "standard_mix"]
TECHNOLOGIES = ["solar", "wind", "geothermal", "heat_and_power", "small_hydro", "other"]

# --- The integration points: every tool is one a utility replaces with its own system (INTEGRATION.md) ---
TOOLS = {
    "register_customer": {
        "name": "register_customer", "description": "Create the prospective customer in the customer platform (CRM) and return its identifier.",
        "parameters": obj(["application_id", "applicant", "contact", "supply_address"], application_id=S,
                          applicant={"type": "object"}, contact={"type": "object"}, supply_address={"type": "object"}),
        "binding": http("POST", "/crm/v1/customers", "CRM_TOKEN"),
    },
    "send_message": {
        "name": "send_message", "description": "Send a message to the customer by e-mail, text message or post, through the notification service.",
        "parameters": obj(["application_id", "channel", "template"], application_id=S, channel={"type": "string", "enum": ["email", "sms", "post"]},
                          template=S, subject=S, body=S),
        "binding": http("POST", "/notifications/v1/messages", "NOTIFY_TOKEN"),
    },
    "extract_document": {
        "name": "extract_document", "description": "Read an uploaded document: its type, whether it is legible, the fields printed on it and its text.",
        "parameters": obj(["file_id", "document_type"], file_id=S, document_type=S, application_id=S),
        "binding": http("POST", "/documents/v1/extractions", "DOCUMENTS_API_KEY", header="x-api-key"),
    },
    "check_credit": {
        "name": "check_credit", "description": "Ask the credit bureau for the applicant's credit band, outstanding energy debt and identity match.",
        "parameters": obj(["application_id", "first_name", "last_name", "date_of_birth", "postcode"], application_id=S,
                          first_name=S, last_name=S, date_of_birth=S, postcode=S, address_line=S),
        "binding": http("POST", "/credit/v1/checks", "CREDIT_BUREAU_TOKEN"),
    },
    "lookup_metering_point": {
        "name": "lookup_metering_point", "description": "Read a metering point from the metering-point registry: meter type, current supplier, connection capacity, region and grid operator.",
        "parameters": obj(["metering_point_id"], metering_point_id=S),
        "binding": http("GET", "/registry/v1/metering-points/{metering_point_id}", "REGISTRY_TOKEN"),
    },
    "estimate_annual_cost": {
        "name": "estimate_annual_cost", "description": "Estimate the annual cost of a plan for a consumption, a region and an electricity source, from the tariff catalogue.",
        "parameters": obj(["plan", "annual_consumption_kwh", "region"], plan={"type": "string", "enum": PLANS},
                          annual_consumption_kwh=N, region=S, electricity_source=S),
        "binding": http("GET", "/tariffs/v1/plans/{plan}/estimate", "TARIFF_API_KEY", header="x-api-key"),
    },
    "notify_grid_operator": {
        "name": "notify_grid_operator", "description": "File a simplified notification of a small generating installation with the grid operator.",
        "parameters": obj(["metering_point_id", "technology", "capacity_kw"], metering_point_id=S, technology=S, capacity_kw=N,
                          inverter_serial=S, commissioned_on=S),
        "binding": http("POST", "/grid/v1/notifications", "GRID_OPERATOR_TOKEN"),
    },
    "register_export": {
        "name": "register_export", "description": "Register the export meter and the export tariff with the meter-data system.",
        "parameters": obj(["metering_point_id", "approved_export_kw", "technology"], metering_point_id=S, approved_export_kw=N, technology=S),
        "binding": jsonrpc("/meter-data/rpc", "meterdata.register_export"),
    },
    "generate_contract": {
        "name": "generate_contract", "description": "Generate the supply contract for e-signature, with the plan, the source, the export tariff and the cooling-off period.",
        "parameters": obj(["application_id", "customer_id", "plan", "electricity_source"], application_id=S, customer_id=S,
                          plan={"type": "string", "enum": PLANS}, electricity_source={"type": "string", "enum": SOURCES},
                          export_tariff_eur_per_kwh={"type": ["number", "null"]}, deposit_eur=N),
        "binding": http("POST", "/contracts/v1/contracts", "CONTRACTS_TOKEN"),
    },
    "create_billing_account": {
        "name": "create_billing_account", "description": "Open the billing account and register the direct debit mandate.",
        "parameters": obj(["customer_id", "contract_id", "mandate_reference"], customer_id=S, contract_id=S, mandate_reference=S, billing_day=N),
        "binding": jsonrpc("/billing/rpc", "billing.create_account"),
    },
    "collect_deposit": {
        "name": "collect_deposit", "description": "Collect a security deposit by direct debit.",
        "parameters": obj(["account_id", "amount_eur"], account_id=S, amount_eur={"type": "number", "exclusiveMinimum": 0}),
        "binding": jsonrpc("/billing/rpc", "billing.collect_deposit"),
    },
    "cancel_billing_account": {
        "name": "cancel_billing_account", "description": "Close a billing account and cancel its direct debit mandate.",
        "parameters": obj(["account_id", "reason"], account_id=S, reason=S),
        "binding": jsonrpc("/billing/rpc", "billing.cancel_account"),
    },
    "refund_deposit": {
        "name": "refund_deposit", "description": "Refund a security deposit.",
        "parameters": obj(["deposit_id", "amount_eur"], deposit_id=S, amount_eur=N),
        "binding": jsonrpc("/billing/rpc", "billing.refund_deposit"),
    },
    "request_switch": {
        "name": "request_switch", "description": "Ask the metering-point registry to switch the supply to this supplier.",
        "parameters": obj(["metering_point_id", "customer_id", "contract_id"], metering_point_id=S, customer_id=S, contract_id=S),
        "binding": http("POST", "/registry/v1/switches", "REGISTRY_TOKEN"),
    },
    "activate_customer": {
        "name": "activate_customer", "description": "Mark the customer active in the customer platform from the supply start date.",
        "parameters": obj(["customer_id", "supply_start_date"], customer_id=S, supply_start_date=S),
        "binding": http("POST", "/crm/v1/customers/{customer_id}/activation", "CRM_TOKEN"),
    },
}

# Guardrails an activity declares (specification 31). The deployment adds its own (deployment.json).
INJECTION_IN_DOCUMENTS = lambda u, name: {
    "id": u(f"guardrail:{name}:injection"), "name": "Instructions inside uploaded documents", "stages": ["tool_result"],
    "check": {"kind": "prompt_injection"}, "action": "block", "tools": ["extract_document"],
}
PERSONAL_DATA_IN_NOTES = lambda u, name: {
    "id": u(f"guardrail:{name}:notes"), "name": "Personal data in the verifier's notes", "stages": ["output"],
    "check": {"kind": "personal_data", "categories": ["email", "phone", "iban"]}, "fields": ["notes"], "action": "redact",
}


def write(name, data):
    (HERE / name).write_text(json.dumps(data, indent=2, ensure_ascii=False) + "\n")


# =====================================================================================================
# Grid export registration: the sub-workflow (specification 24)
# =====================================================================================================
u, act, edge, ev, role = kit("grid-export")
GRID_ID = u("workflow")
classes = {
    "simplified": u("Classify installation->Send simplified notification"),
    "approval": u("Classify installation->Grid operator approval"),
    "four_eyes": u("Classify installation->Grid operator approval, two engineers"),
    "commercial": u("Classify installation->Refer to commercial team"),
}
grid = {
    "$schema": "https://awa.io/schema/awa.schema.json", "id": GRID_ID, "name": "Grid Export Registration", "version": "1.0.0", "awa_version": "1.1",
    "description": "Registers a home's own generation for export to the grid: checks the installation documents, classifies the installation by technology and capacity, files a simplified notification or obtains the grid operator's approval, and registers the export meter and tariff.",
    "roles": [
        role("installation-verifier", "Installation verifier", "ai_agent", "Checks installers' certificates, compliance certificates and commissioning reports, and that the serial numbers agree.",
             "tier:reasoning", ["document extraction", "electrical certificates"]),
        role("grid-desk", "Grid connection service", "application", "Files notifications with the grid operator and records the outcome."),
        role("grid-engineer", "Grid engineer", "human", "Approves the export of a medium installation for the grid operator."),
        role("meter-data", "Meter-data system", "application", "Holds metering points, export meters and their tariffs."),
    ],
    "events": [
        ev("Export registration requested", "start", "The onboarding of a home with its own generation asks for its export to be registered."),
        ev("Export registered", "end"),
        ev("Export not registered", "end"),
    ],
    "activities": [
        act("Verify installation documents", "ai_agent", "installation-verifier",
            "Check the installer's certificate, the generator or inverter compliance certificate, the commissioning report and the proof of ownership, and that the serial numbers on them agree.",
            procedure="Extract each installation document with the document tool. Compare the inverter or generator serial number on the compliance certificate with the one on the commissioning report. Compare the capacity declared on the application with the rated capacity on the certificate. Note anything that does not agree. Say how sure you are.",
            tools=[TOOLS["extract_document"]],
            guardrails=[INJECTION_IN_DOCUMENTS(u, "installation"), PERSONAL_DATA_IN_NOTES(u, "installation")],
            outcome_contract={
                "output_schema": obj(["installation_valid", "serials_match", "rated_capacity_kw", "unchecked_count", "unreadable_count", "confidence", "notes"],
                                     installation_valid=B, serials_match=B, rated_capacity_kw={"type": "number", "exclusiveMinimum": 0},
                                     unchecked_count={"type": "integer", "minimum": 0}, unreadable_count={"type": "integer", "minimum": 0},
                                     confidence={"type": "number", "minimum": 0, "maximum": 1}, notes={"type": "string", "minLength": 10}),
                "postconditions": [
                    {"name": "Every installation document is checked", "expression": "unchecked_count == 0"},
                    {"name": "Every installation document is legible", "expression": "unreadable_count == 0"},
                    {"name": "Serial numbers agree", "expression": "serials_match == true"},
                    {"name": "Sure enough to act on", "expression": "confidence >= 0.75"},
                ],
                "budgets": {"max_attempts": 2, "max_duration": "PT5M", "max_tokens": 30000, "max_tool_calls": 8},
                "on_violation": "escalate_human",
            }),
        act("Send simplified notification", "application", "grid-desk", "File the simplified notification of a small installation with the grid operator.",
            tools=[TOOLS["notify_grid_operator"]]),
        act("Grid operator approval", "human", "grid-engineer", "A grid engineer approves the export of a medium installation, and the capacity that may be exported.",
            outcome_contract={"output_schema": obj(["approved"], approved=B, approved_export_kw={"type": "number", "minimum": 0}, note=S)}),
        act("Grid operator approval, two engineers", "human", "grid-engineer",
            "Two grid engineers approve the export of an installation above the four-eyes threshold; the deployment's four-eyes rule makes the second approval necessary.",
            outcome_contract={"output_schema": obj(["approved"], approved=B, approved_export_kw={"type": "number", "minimum": 0}, note=S)}),
        act("Refer to commercial team", "application", "grid-desk", "Open a case for the commercial team, who agree a large installation's export individually."),
        act("Record export refusal", "application", "grid-desk", "Record that the export is not registered: the installation is not valid, or the grid operator did not approve the export."),
        act("Register export meter and tariff", "application", "meter-data", "Register the export meter and the export tariff with the meter-data system.",
            tools=[TOOLS["register_export"]], retry={"max_attempts": 3, "initial_delay": "PT1S"}),
    ],
    "decision_nodes": [{
        "id": u("Classify installation"), "name": "Classify installation",
        "description": "What the grid operator needs, from the technology and the capacity. THE THRESHOLDS ARE EXAMPLES: they differ by country and by grid operator, and each operator edits this table.",
        "decision_table": {
            "hit_policy": "first",
            "inputs": [{"name": "technology", "label": "Technology", "type": "string"}, {"name": "capacity_kw", "label": "Capacity (kW)", "type": "number"}],
            "outputs": [{"name": "installation_class", "type": "string"}, {"name": "export_route", "type": "string"}],
            "rules": [
                {"description": "Large: agreed individually by the commercial team", "input_entries": ["-", "> 50"],
                 "output_entries": ["large", "commercial_referral"], "output_edge_id": classes["commercial"]},
                {"description": "Small inverter-connected installation: a notification is enough", "input_entries": ['"solar", "wind"', "<= 3.68"],
                 "output_entries": ["small", "simplified_notification"], "output_edge_id": classes["simplified"]},
                {"description": "Small rotating machine: a notification is enough", "input_entries": ['"geothermal", "heat_and_power", "small_hydro", "other"', "<= 2"],
                 "output_entries": ["small", "simplified_notification"], "output_edge_id": classes["simplified"]},
                {"description": "Rotating machine above the four-eyes threshold", "input_entries": ['"geothermal", "heat_and_power", "small_hydro", "other"', "> 5"],
                 "output_entries": ["medium", "operator_approval_four_eyes"], "output_edge_id": classes["four_eyes"]},
                {"description": "Inverter-connected installation above the four-eyes threshold", "input_entries": ['"solar", "wind"', "> 10"],
                 "output_entries": ["medium", "operator_approval_four_eyes"], "output_edge_id": classes["four_eyes"]},
                {"description": "Medium: the grid operator approves", "input_entries": ["-", "> 0"],
                 "output_entries": ["medium", "operator_approval"], "output_edge_id": classes["approval"]},
            ],
        },
        "default_output_edge_id": classes["commercial"],
    }],
    "edges": [
        edge("Export registration requested", "Verify installation documents"),
        # An installation found not valid is refused, whatever its class: only a valid one is classified
        edge("Verify installation documents", "Classify installation", condition="installation_valid == true", label="installation valid"),
        edge("Verify installation documents", "Record export refusal", is_default=True, label="installation not valid"),
        {**edge("Classify installation", "Send simplified notification"), "label": "small"},
        {**edge("Classify installation", "Grid operator approval"), "label": "medium"},
        {**edge("Classify installation", "Grid operator approval, two engineers"), "label": "medium, above the four-eyes threshold"},
        {**edge("Classify installation", "Refer to commercial team"), "label": "large"},
        edge("Send simplified notification", "Register export meter and tariff"),
        edge("Grid operator approval", "Register export meter and tariff", condition="approved == true"),
        edge("Grid operator approval", "Record export refusal", is_default=True),
        edge("Grid operator approval, two engineers", "Register export meter and tariff", condition="approved == true"),
        edge("Grid operator approval, two engineers", "Record export refusal", is_default=True),
        edge("Register export meter and tariff", "Export registered"),
        edge("Refer to commercial team", "Export not registered"),
        edge("Record export refusal", "Export not registered"),
    ],
}
write("grid-export-registration.awa.json", grid)

# =====================================================================================================
# Electricity customer onboarding: the main workflow
# =====================================================================================================
u, act, edge, ev, role = kit("onboarding")
PROFILE = u("context:customer_profile")
read_profile = [{"context_id": PROFILE, "access_mode": "read"}]
care_role = u("role:care")
e = {
    "eligibility_accept": u("Eligibility->Applicant verified:accept"),
    "eligibility_refer": u("Eligibility->Credit referral"),
    "eligibility_decline": u("Eligibility->Write decline letter"),
    "source_available": u("Electricity source->Plan eligibility"),
    "source_default": u("Electricity source->Advise on electricity source"),
    "plans": u("Plan eligibility->Recommend plan"),
    "required": u("Required documents->Request documents"),
}
onboarding = {
    "$schema": "https://awa.io/schema/awa.schema.json", "id": u("workflow"), "name": "Electricity Customer Onboarding", "version": "1.0.0", "awa_version": "1.1",
    "description": "Onboards a new household customer of an electricity supplier: collects and verifies the documents, checks credit and identity and the metering point in parallel, decides eligibility, settles the electricity source, registers home generation for export, recommends a plan, has the contract signed, sets up billing and the direct debit, switches the supply, and welcomes the customer.",
    "sla": {
        "id": u("sla:onboarding"), "name": "Onboarding within three weeks", "target_time": "P21D", "max_time": "P35D",
        "escalation_policy": {"breach_action": "record", "notify_roles": [care_role]},
        "metrics": [{"name": "workflow.duration_ms", "target": 1814400000, "unit": "ms", "comparison": "lte"}],
    },
    "roles": [
        role("crm", "Customer platform", "application", "The supplier's customer platform (CRM): applications, customers and their messages."),
        role("documents", "Document verifier", "ai_agent", "Reads uploaded documents and checks that each one required is present, legible and consistent with the application.",
             "tier:reasoning", ["document extraction", "identity documents", "direct debit mandates"]),
        role("notifications", "Notification writer", "ai_agent", "Writes short service messages: reminders.", "tier:fast", ["customer writing"]),
        role("credit", "Credit and identity service", "application", "Asks the credit bureau about the applicant."),
        role("registry", "Metering-point registry", "application", "The registry of metering points, through which suppliers switch."),
        role("credit-officer", "Credit officer", "human", "Decides applications the eligibility rules refer to a person."),
        role("care", "Customer care agent", "human", "Talks to customers by phone and resolves what the automated steps cannot."),
        role("plans", "Plan advisor", "ai_agent", "Recommends the plan that suits the household's consumption, with its estimated annual cost.",
             "tier:balanced", ["tariff analysis"]),
        role("comms", "Customer letters", "ai_agent", "Writes letters and e-mails to customers.", "tier:balanced", ["customer writing"]),
        role("grid-export", "Grid export desk", "application", "Registers home generation for export; the work is done by the Grid Export Registration workflow."),
        role("contracts", "Contract service", "application", "Generates supply contracts and sends them for e-signature."),
        role("billing", "Billing system", "application", "Holds billing accounts, direct debit mandates and deposits."),
    ],
    "contexts": [{
        "id": PROFILE, "name": "customer_profile", "type": "data", "sync_pattern": "shared_state",
        "description": "The household as the agents that serve it need to know it: name, supply address, consumption, preferences, generation and devices. Credit results are not in it.",
        "schema": obj(["first_name", "last_name", "supply_postcode", "annual_consumption_kwh", "electricity_source", "has_generation"],
                      first_name=S, last_name=S, supply_postcode=S, supply_city=S, annual_consumption_kwh=N, consumption_basis=S,
                      electricity_source=S, plan_preference=S, has_generation=B, generation_technology=S, generation_capacity_kw=N,
                      ev_charger=B, heat_pump=B, preferred_channel=S),
    }],
    "events": [
        ev("Application received", "start", "A household applies to become a customer on the web form.", name="onboarding.requested"),
        ev("Documents uploaded", "message", "Wait for the supporting documents.", name="documents.uploaded",
           correlation_key="application_id", timeout="P7D", timeout_edge_id=u("Documents uploaded->Send document reminder")),
        ev("Documents uploaded after reminder", "message", "Wait once more after the reminder.", name="documents.uploaded",
           correlation_key="application_id", timeout="P7D", timeout_edge_id=u("Documents uploaded after reminder->Close as abandoned")),
        ev("Documents checked", "intermediate", "The documents are verified: the credit check and the metering point lookup start in parallel."),
        ev("Checks complete", "intermediate", "Both checks are back.", join="all"),
        ev("Applicant verified", "message", "Tell other systems and the journey the applicant is verified.", name="onboarding.verified",
           mode="publish", data=["application_id", "eligibility", "deposit_required"]),
        ev("Plan confirmed", "message", "Wait for the customer to confirm the plan in the portal.", name="plan.confirmed",
           correlation_key="application_id", timeout="P14D", timeout_edge_id=u("Plan confirmed->Confirm plan by phone")),
        ev("Plan chosen", "message", "Tell other systems and the journey which plan and source the household chose.", name="plan.chosen",
           mode="publish", data=["application_id", "plan", "source_offered"]),
        ev("Grid export settled", "message", "Tell other systems and the journey how the export registration ended.", name="grid_export.completed",
           mode="publish", data=["application_id", "export_status", "export_registration_id", "approved_export_kw", "export_tariff_eur_per_kwh"]),
        ev("Contract signed", "message", "Wait for the e-signature service to report the signed contract.", name="contract.signed",
           correlation_key="application_id", timeout="P14D", timeout_edge_id=u("Contract signed->Close as abandoned")),
        ev("Switch completed", "message",
           "Wait for the registry to confirm the switch. If it has not by the deadline the wait fails the run (EVENT_TIMEOUT), and compensation cancels the deposit, the account and the mandate.",
           name="switch.completed", correlation_key="application_id", timeout="P21D"),
        ev("Customer activated", "message", "Tell other systems and the journey the customer is active.", name="customer.activated",
           mode="publish", data=["application_id", "customer_id", "customer_active", "plan", "source_offered", "supply_start_date"]),
        ev("Application abandoned", "message", "Tell other systems and the journey the application was abandoned.", name="onboarding.abandoned",
           mode="publish", data=["application_id", "abandoned_reason"]),
        ev("Application declined", "message", "Tell other systems and the journey the application was declined.", name="onboarding.declined",
           mode="publish", data=["application_id", "decline_reason"]),
        ev("Customer active", "end"),
        ev("Abandoned", "end"),
        ev("Declined", "end"),
    ],
    "activities": [
        act("Register application", "application", "crm", "Create the prospective customer and the customer profile the agents read.",
            tools=[TOOLS["register_customer"]], retry={"max_attempts": 3, "initial_delay": "PT1S"},
            context_bindings=[{"context_id": PROFILE, "access_mode": "write"}]),
        act("Request documents", "application", "crm", "Ask the household for the documents the application needs, by e-mail.",
            tools=[TOOLS["send_message"]]),
        act("Send document reminder", "ai_agent", "notifications", "Remind the household which documents are still missing and when the application will be closed without them.",
            tools=[TOOLS["send_message"]], context_bindings=read_profile,
            outcome_contract={
                "output_schema": obj(["message", "deadline_stated"], message={"type": "string", "minLength": 40}, deadline_stated=B),
                "postconditions": [{"name": "States the deadline", "expression": "deadline_stated == true"}],
            }),
        act("Close as abandoned", "application", "crm", "Close the application because the documents, or the signed contract, never came."),
        act("Verify documents", "ai_agent", "documents",
            "Check each required document: present, legible, of the right kind, and consistent with the application (name, address, account holder).",
            procedure="For each document uploaded, call the document tool. Compare the name and address with the customer profile. Check that the identity document is in date and that the direct debit mandate is signed and names the applicant as account holder. List every required document with its status. Say how sure you are.",
            tools=[TOOLS["extract_document"]], context_bindings=read_profile,
            guardrails=[INJECTION_IN_DOCUMENTS(u, "documents"), PERSONAL_DATA_IN_NOTES(u, "documents")],
            sla={"id": u("sla:verify-documents"), "name": "Documents verified within the hour", "target_time": "PT15M", "max_time": "PT2H",
                 "escalation_policy": {"breach_action": "record", "notify_roles": [care_role]}},
            outcome_contract={
                "output_schema": obj(["documents", "documents_valid", "unchecked_count", "unreadable_count", "confidence", "notes"],
                                     documents={"type": "array", "minItems": 1, "items": obj(["type", "status"], type=S, status={"type": "string", "enum": ["valid", "invalid", "unreadable"]})},
                                     documents_valid=B, mandate_reference=S,
                                     unchecked_count={"type": "integer", "minimum": 0}, unreadable_count={"type": "integer", "minimum": 0},
                                     confidence={"type": "number", "minimum": 0, "maximum": 1}, notes={"type": "string", "minLength": 10}),
                "postconditions": [
                    {"name": "Every required document is checked", "expression": "unchecked_count == 0"},
                    {"name": "Every document is legible", "expression": "unreadable_count == 0"},
                    {"name": "Sure enough to act on", "expression": "confidence >= 0.75"},
                ],
                "budgets": {"max_attempts": 2, "max_duration": "PT5M", "max_tokens": 40000, "max_tool_calls": 12},
                "on_violation": "escalate_human",
            }),
        act("Check credit and identity", "application", "credit", "Ask the credit bureau for the credit band, outstanding energy debt and whether the identity matches.",
            tools=[TOOLS["check_credit"]], retry={"max_attempts": 3, "initial_delay": "PT2S", "backoff_multiplier": 2}),
        act("Look up metering point", "application", "registry", "Read the metering point: meter type, smart meter or not, current supplier, connection capacity and region.",
            tools=[TOOLS["lookup_metering_point"]], retry={"max_attempts": 3, "initial_delay": "PT2S", "backoff_multiplier": 2}),
        act("Credit referral", "human", "credit-officer", "A credit officer decides an application the eligibility rules referred, and any deposit.",
            outcome_contract={"output_schema": obj(["approved", "reason"], approved=B, deposit_required=B, deposit_eur={"type": "number", "minimum": 0}, reason=S)}),
        act("Write decline letter", "ai_agent", "comms", "Write a polite letter declining the application, with the reason and what the household can do.",
            tools=[TOOLS["send_message"]],
            outcome_contract={
                "output_schema": obj(["letter", "reason_given", "next_steps_given", "decline_reason"], letter={"type": "string", "minLength": 120},
                                     reason_given=B, next_steps_given=B, decline_reason=S),
                "postconditions": [{"name": "Gives the reason", "expression": "reason_given == true"},
                                   {"name": "Says what the household can do", "expression": "next_steps_given == true"}],
            }),
        act("Advise on electricity source", "human", "care", "A customer care agent agrees an electricity source with the customer when no option could be proposed."),
        act("Recommend plan", "ai_agent", "plans",
            "Recommend the plan that suits the household, with its estimated annual cost, putting the customer's preference first when it is eligible.",
            procedure="Read the eligible plans and the customer profile. Estimate the annual cost of the customer's preferred plan and of the other eligible plans with the tariff tool. Recommend the preferred plan when it is eligible; otherwise the cheapest eligible plan for the profile. Give the reasons.",
            tools=[TOOLS["estimate_annual_cost"]], context_bindings=read_profile,
            outcome_contract={
                "output_schema": obj(["recommended_plan", "estimated_annual_cost_eur", "alternatives", "reasons"],
                                     recommended_plan={"type": "string", "enum": PLANS}, estimated_annual_cost_eur={"type": "number", "exclusiveMinimum": 0},
                                     alternatives={"type": "array", "items": obj(["plan", "estimated_annual_cost_eur"], plan={"type": "string", "enum": PLANS}, estimated_annual_cost_eur=N)},
                                     reasons={"type": "string", "minLength": 20}, follows_preference=B),
                "postconditions": [{"name": "Has a cost", "expression": "estimated_annual_cost_eur > 0"}],
                "budgets": {"max_attempts": 2, "max_tool_calls": 8},
            }),
        act("Confirm plan by phone", "human", "care", "A customer care agent calls the household, which has not confirmed a plan, and records the plan and source they choose.",
            outcome_contract={"output_schema": obj(["plan"], plan={"type": "string", "enum": PLANS}, source_offered={"type": "string", "enum": SOURCES})}),
        act("Register grid export", "application", "grid-export", "Register the home's generation for export to the grid, by running the Grid Export Registration workflow.",
            is_expandable=True, expansion_workflow_id=GRID_ID,
            subworkflow={
                "input": {"application_id": "application_id", "metering_point_id": "metering_point_id", "technology": "generation_technology",
                          "capacity_kw": "generation_capacity_kw", "installation": "installation",
                          "installation_documents": "installation_documents"},
                "output": {"export_status": "export_status", "export_registration_id": "export_registration_id",
                           "approved_export_kw": "approved_export_kw", "export_tariff_eur_per_kwh": "export_tariff_eur_per_kwh",
                           "installation_class": "installation_class"},
            },
            outcome_contract={"postconditions": [{"name": "Says how the registration ended", "expression": "export_status exists"}]}),
        act("Agree another plan", "human", "care", "The export was not registered, so the prosumer plan cannot apply: a customer care agent agrees another plan with the customer.",
            outcome_contract={"output_schema": obj(["plan"], plan={"type": "string", "enum": [p for p in PLANS if p != "prosumer"]})}),
        act("Generate contract", "application", "contracts", "Generate the supply contract, with the 14-day cooling-off period, and send it for e-signature.",
            tools=[TOOLS["generate_contract"]]),
        act("Set up account and direct debit", "application", "billing", "Open the billing account and register the direct debit mandate.",
            tools=[TOOLS["create_billing_account"]], compensation={"activity_id": u("Cancel account and mandate")}),
        act("Collect deposit", "application", "billing", "Collect the security deposit eligibility asked for.",
            tools=[TOOLS["collect_deposit"]], compensation={"activity_id": u("Refund deposit")}),
        act("Request supplier switch", "application", "registry", "Ask the registry to switch the supply from the current supplier.",
            tools=[TOOLS["request_switch"]]),
        act("Write welcome pack", "ai_agent", "comms",
            "Write the personalised welcome message: the plan, the electricity source, the supply start date and, for a home that exports, the export tariff.",
            context_bindings=read_profile,
            guardrails=[{"id": u("guardrail:welcome:contact"), "name": "No bank or phone numbers in the welcome message", "stages": ["output"],
                         "check": {"kind": "personal_data", "categories": ["iban", "phone"]}, "action": "redact"}],
            outcome_contract={
                "output_schema": obj(["message", "tone", "facts"], message={"type": "string", "minLength": 120},
                                     tone={"type": "string", "enum": ["warm", "neutral"]},
                                     facts=obj(["plan", "electricity_source", "supply_start_date", "export_tariff_eur_per_kwh"],
                                               plan={"type": "string", "enum": PLANS}, electricity_source={"type": "string", "enum": SOURCES},
                                               supply_start_date=S, export_tariff_eur_per_kwh={"type": ["number", "null"]})),
                "postconditions": [
                    {"name": "Warm or neutral in tone", "expression": "tone == warm || tone == neutral"},
                    {"name": "States the plan", "expression": "facts.plan exists"},
                    {"name": "States the supply start date", "expression": "facts.supply_start_date exists"},
                ],
            }),
        act("Activate customer", "application", "crm", "Mark the customer active from the supply start date and send the welcome pack.",
            tools=[TOOLS["activate_customer"], TOOLS["send_message"]]),
        act("Cancel account and mandate", "application", "billing", "Close the billing account and cancel the direct debit mandate of a switch that did not happen.",
            tools=[TOOLS["cancel_billing_account"]]),
        act("Refund deposit", "application", "billing", "Refund the deposit of a switch that did not happen.",
            tools=[TOOLS["refund_deposit"]]),
    ],
    "decision_nodes": [
        {
            "id": u("Required documents"), "name": "Required documents",
            "description": "The documents an application needs: three for every household, four more for a home with its own generation.",
            "decision_table": {
                "hit_policy": "collect",
                "inputs": [{"name": "has_generation", "label": "Home generation", "type": "boolean"}],
                "outputs": [{"name": "required_documents", "type": "string"}],
                "rules": [
                    {"description": "Proof of identity", "input_entries": ["-"], "output_entries": ["proof_of_identity"]},
                    {"description": "Proof of address or occupancy", "input_entries": ["-"], "output_entries": ["proof_of_address"]},
                    {"description": "Direct debit mandate", "input_entries": ["-"], "output_entries": ["direct_debit_mandate"]},
                    {"description": "Installer's certificate", "input_entries": ["true"], "output_entries": ["installer_certificate"]},
                    {"description": "Inverter or generator compliance certificate", "input_entries": ["true"], "output_entries": ["compliance_certificate"]},
                    {"description": "Commissioning report", "input_entries": ["true"], "output_entries": ["commissioning_report"]},
                    {"description": "Proof of ownership or authorisation of the installation", "input_entries": ["true"], "output_entries": ["installation_ownership"]},
                ],
            },
            "default_output_edge_id": e["required"],
        },
        {
            "id": u("Eligibility"), "name": "Eligibility",
            "description": "Whether the supplier takes the household on, from the credit band, outstanding energy debt and the identity check. The limits are examples each supplier sets.",
            "decision_table": {
                "hit_policy": "first",
                "inputs": [{"name": "identity_result", "label": "Identity", "type": "string"}, {"name": "outstanding_debt_eur", "label": "Outstanding energy debt (EUR)", "type": "number"},
                           {"name": "credit_band", "label": "Credit band", "type": "string"}],
                "outputs": [{"name": "eligibility", "type": "string"}, {"name": "deposit_required", "type": "boolean"}, {"name": "deposit_eur", "type": "number"}],
                "rules": [
                    {"description": "The identity does not match the person", "input_entries": ['"mismatch"', "-", "-"], "output_entries": ["decline", False, 0], "output_edge_id": e["eligibility_decline"]},
                    {"description": "Energy debt above the limit", "input_entries": ["-", "> 1000", "-"], "output_entries": ["decline", False, 0], "output_edge_id": e["eligibility_decline"]},
                    {"description": "Lowest credit band", "input_entries": ["-", "-", '"E"'], "output_entries": ["decline", False, 0], "output_edge_id": e["eligibility_decline"]},
                    {"description": "Identity not confirmed: a person decides", "input_entries": ['not("verified")', "-", "-"], "output_entries": ["refer", False, 0], "output_edge_id": e["eligibility_refer"]},
                    {"description": "Good credit, no energy debt", "input_entries": ['"verified"', "<= 0", '"A", "B"'], "output_entries": ["accept", False, 0], "output_edge_id": e["eligibility_accept"]},
                    {"description": "Fair credit or a small debt: accepted with a deposit", "input_entries": ['"verified"', "<= 250", '"A", "B", "C"'], "output_entries": ["accept_with_deposit", True, 150], "output_edge_id": e["eligibility_accept"]},
                    {"description": "Weak credit or a debt to look at: a person decides", "input_entries": ["-", "-", "-"], "output_entries": ["refer", False, 0], "output_edge_id": e["eligibility_refer"]},
                ],
            },
            "default_output_edge_id": e["eligibility_refer"],
        },
        {
            "id": u("Electricity source"), "name": "Electricity source",
            "description": "Whether the source the customer chose is offered in their region. When it is not, an energy advisor model proposes the closest source that is.",
            "decision_table": {
                "hit_policy": "first",
                "inputs": [{"name": "electricity_source", "label": "Chosen source", "type": "string"}, {"name": "region", "label": "Region", "type": "string"}],
                "outputs": [{"name": "source_offered", "type": "string"}],
                "rules": [
                    {"description": "100% renewable, backed by guarantees of origin: everywhere", "input_entries": ['"renewable_100"', "-"], "output_entries": ["renewable_100"], "output_edge_id": e["source_available"]},
                    {"description": "Local community energy: where a community scheme supplies the region", "input_entries": ['"local_community"', '"north-west", "south-west"'], "output_entries": ["local_community"], "output_edge_id": e["source_available"]},
                    {"description": "Low-carbon mix: everywhere", "input_entries": ['"low_carbon_mix"', "-"], "output_entries": ["low_carbon_mix"], "output_edge_id": e["source_available"]},
                    {"description": "Standard mix: everywhere", "input_entries": ['"standard_mix"', "-"], "output_entries": ["standard_mix"], "output_edge_id": e["source_available"]},
                ],
            },
            "default_output_edge_id": e["source_default"],
            "decision_model": {
                "model": "tier:fast",
                "instructions": "The customer chose an electricity source that is not offered in their region. Propose the available source closest to what they asked for: keep a renewable choice renewable, and a local choice as close to local generation as the region allows. Give the reason in one sentence the customer can read.",
                "options": [
                    {"id": "renewable_100", "description": "100% renewable electricity backed by guarantees of origin, available in every region", "output_edge_id": e["source_available"]},
                    {"id": "low_carbon_mix", "description": "A low-carbon mix of renewable and nuclear generation, available in every region", "output_edge_id": e["source_available"]},
                    {"id": "standard_mix", "description": "The standard supply mix, available in every region", "output_edge_id": e["source_available"]},
                ],
                "inputs": ["electricity_source", "region", "annual_consumption_kwh", "has_generation"],
                "output": "source_offered",
                "min_confidence": 0.6,
            },
        },
        {
            "id": u("Plan eligibility"), "name": "Plan eligibility",
            "description": "The plans the household may choose: time-of-use needs a smart meter, the electric vehicle plan a declared charger, the prosumer plan home generation to register for export, the 24-month plan no deposit.",
            "decision_table": {
                "hit_policy": "collect",
                "inputs": [{"name": "smart_meter", "label": "Smart meter", "type": "boolean"}, {"name": "ev_charger", "label": "EV charger", "type": "boolean"},
                           {"name": "has_generation", "label": "Home generation", "type": "boolean"}, {"name": "eligibility", "label": "Eligibility", "type": "string"}],
                "outputs": [{"name": "eligible_plans", "type": "string"}],
                "rules": [
                    {"description": "Fixed price for 12 months", "input_entries": ["-", "-", "-", "-"], "output_entries": ["fixed_12"]},
                    {"description": "Fixed price for 24 months, without a deposit", "input_entries": ["-", "-", "-", 'not("accept_with_deposit")'], "output_entries": ["fixed_24"]},
                    {"description": "Variable price", "input_entries": ["-", "-", "-", "-"], "output_entries": ["variable"]},
                    {"description": "Time of use: needs a smart meter", "input_entries": ["true", "-", "-", "-"], "output_entries": ["time_of_use"]},
                    {"description": "Electric vehicle: needs a declared charger", "input_entries": ["-", "true", "-", "-"], "output_entries": ["ev"]},
                    {"description": "Prosumer: needs home generation registered for export", "input_entries": ["-", "-", "true", "-"], "output_entries": ["prosumer"]},
                ],
            },
            "default_output_edge_id": e["plans"],
        },
    ],
    "edges": [
        edge("Application received", "Register application"),
        edge("Register application", "Required documents"),
        {**edge("Required documents", "Request documents"), "id": e["required"]},
        edge("Request documents", "Documents uploaded"),
        edge("Documents uploaded", "Verify documents"),
        edge("Documents uploaded", "Send document reminder", label="nothing in 7 days"),
        edge("Send document reminder", "Documents uploaded after reminder"),
        edge("Documents uploaded after reminder", "Verify documents"),
        edge("Documents uploaded after reminder", "Close as abandoned", label="nothing in 7 more days"),
        edge("Close as abandoned", "Application abandoned"),
        edge("Application abandoned", "Abandoned"),
        edge("Verify documents", "Documents checked"),
        edge("Documents checked", "Request documents", condition="documents_valid == false", label="a document must be replaced"),
        edge("Documents checked", "Check credit and identity"),
        edge("Documents checked", "Look up metering point"),
        edge("Check credit and identity", "Checks complete"),
        edge("Look up metering point", "Checks complete"),
        edge("Checks complete", "Eligibility"),
        {**edge("Eligibility", "Applicant verified", key="accept"), "label": "accept"},
        {**edge("Eligibility", "Credit referral"), "label": "refer"},
        {**edge("Eligibility", "Write decline letter"), "label": "decline"},
        edge("Credit referral", "Applicant verified", key="referral", condition="approved == true", label="approved"),
        edge("Credit referral", "Write decline letter", key="referral", is_default=True, label="not approved"),
        edge("Write decline letter", "Application declined"),
        edge("Application declined", "Declined"),
        edge("Applicant verified", "Electricity source"),
        {**edge("Electricity source", "Plan eligibility"), "label": "offered in the region"},
        {**edge("Electricity source", "Advise on electricity source"), "label": "no source proposed"},
        edge("Advise on electricity source", "Plan eligibility"),
        {**edge("Plan eligibility", "Recommend plan"), "id": e["plans"]},
        edge("Recommend plan", "Plan confirmed"),
        edge("Plan confirmed", "Plan chosen"),
        edge("Plan confirmed", "Confirm plan by phone", label="not confirmed in 14 days"),
        edge("Confirm plan by phone", "Plan chosen"),
        edge("Plan chosen", "Register grid export", condition="has_generation == true", label="home generation"),
        edge("Plan chosen", "Generate contract", is_default=True),
        edge("Register grid export", "Grid export settled"),
        edge("Grid export settled", "Agree another plan", condition="plan == prosumer && export_status != registered", label="prosumer plan without an export registration"),
        edge("Grid export settled", "Generate contract", is_default=True),
        edge("Agree another plan", "Generate contract"),
        edge("Generate contract", "Contract signed"),
        edge("Contract signed", "Set up account and direct debit"),
        edge("Contract signed", "Close as abandoned", label="not signed in 14 days"),
        edge("Set up account and direct debit", "Collect deposit", condition="deposit_required == true", label="deposit"),
        edge("Set up account and direct debit", "Request supplier switch", is_default=True),
        edge("Collect deposit", "Request supplier switch"),
        edge("Request supplier switch", "Switch completed"),
        edge("Switch completed", "Write welcome pack"),
        edge("Write welcome pack", "Activate customer"),
        edge("Activate customer", "Customer activated"),
        edge("Customer activated", "Customer active"),
    ],
}
# The two handlers stand outside the flow (13.6): no edge reaches them
write("electricity-onboarding.awa.json", onboarding)

# =====================================================================================================
# The journey (specification 19)
# =====================================================================================================
uj = lambda name: str(uuid.uuid5(NS, f"awa-example:electricity-onboarding:journey:{name}"))


def tp(id, name, direction, channel, technology, exchanges=(), party="subject", **on):
    return {"id": id, "name": name, "party": party, "direction": direction, "channel": channel, "technology": technology, "on": on,
            "exchanges": [{"artefact": x} if isinstance(x, str) else {"artefact": x[0], "reference": x[1]} for x in exchanges]}


journey = {
    "id": uj("journey"), "name": "New Customer Onboarding", "version": "1.0.0", "awa_version": "1.1",
    "description": "A household's way from the application form to an active electricity supply: documents, checks, the choice of source and plan, the registration of its own generation for export, the contract, the switch and the welcome.",
    "subject": {"name": "household", "key": "application_id"},
    "stages": [
        {"id": "application", "name": "Application", "description": "The household applies and uploads its documents.",
         "workflows": [onboarding["id"]], "complete_when": "documents exists", "max_duration": "P14D", "owner": "Customer care"},
        {"id": "verification", "name": "Verification", "description": "Documents, credit and identity, and the metering point are checked; eligibility is decided.",
         "complete_when": "eligibility exists", "max_duration": "P5D", "owner": "Credit team"},
        {"id": "energy-choices", "name": "Energy choices", "description": "The electricity source and the plan are settled with the household.",
         "complete_when": "plan exists", "max_duration": "P14D", "owner": "Customer care",
         "transitions": [{"to": "grid-export", "condition": "has_generation == true"}, {"to": "contract", "is_default": True}]},
        {"id": "grid-export", "name": "Grid export", "description": "Only for homes with their own generation: the installation is checked and registered for export.",
         "workflows": [GRID_ID], "complete_when": "export_status exists", "max_duration": "P10D", "owner": "Grid connections team",
         "transitions": [{"to": "contract", "is_default": True}]},
        {"id": "contract", "name": "Contract", "description": "The contract is generated and signed.",
         "complete_when": "contract_signed == true", "max_duration": "P14D", "owner": "Customer care"},
        {"id": "switch", "name": "Switch", "description": "Billing and the direct debit are set up and the supply is switched.",
         "complete_when": "switch_completed == true", "max_duration": "P21D", "owner": "Switching team"},
        {"id": "active", "name": "Active", "description": "The customer is welcomed and supplied.",
         "complete_when": "customer_active == true", "transitions": []},
    ],
    "triggers": [{"event": "onboarding.requested", "starts_journey": True, "start_workflow": onboarding["id"]}],
    "goals": [
        {"id": "active-customer", "name": "Active customer", "expression": "customer_active == true"},
    ],
    "exits": [
        {"event": "onboarding.abandoned", "outcome": "abandoned", "reason": "The household did not complete the application"},
        {"event": "onboarding.declined", "outcome": "abandoned", "reason": "Declined on eligibility"},
    ],
    "artefacts": [
        {"id": "application-form", "name": "Application form", "kind": "form", "description": "Who, where, how much electricity, which source and plan, what generation and devices."},
        {"id": "document-request", "name": "Document request", "kind": "notice", "description": "The list of documents the application needs."},
        {"id": "identity-and-address", "name": "Identity and address documents", "kind": "evidence", "description": "Proof of identity and proof of address or occupancy."},
        {"id": "mandate", "name": "Direct debit mandate", "kind": "attestation", "description": "The account holder's authorisation to collect by direct debit."},
        {"id": "installation-certificates", "name": "Installation certificates", "kind": "certificate", "description": "Installer's certificate, compliance certificate, commissioning report, proof of ownership."},
        {"id": "reminder", "name": "Reminder", "kind": "notice", "description": "What is still missing, and by when."},
        {"id": "decline-letter", "name": "Decline letter", "kind": "notice", "description": "Why the application was declined and what the household can do."},
        {"id": "plan-quote", "name": "Plan recommendation", "kind": "quote", "description": "The recommended plan and its estimated annual cost."},
        {"id": "grid-notification", "name": "Grid operator notification", "kind": "notice", "description": "The simplified notification of a small installation."},
        {"id": "contract", "name": "Supply contract", "kind": "contract", "description": "The plan, the source, the export tariff and the 14-day cooling-off period."},
        {"id": "switch-request", "name": "Switch request", "kind": "order", "description": "The instruction to the registry to move the supply."},
        {"id": "welcome-pack", "name": "Welcome pack", "kind": "notice", "description": "The plan, the source, the start date and the export tariff, in the customer's words."},
    ],
    "touchpoints": [
        tp("applies", "Applies on the web form", "inbound", "web", "Customer portal", ["application-form"], event="onboarding.requested"),
        tp("documents-requested", "Is asked for documents", "outbound", "email", "Notification service", ["document-request"], activity="Request documents"),
        tp("documents-uploaded", "Uploads the documents", "inbound", "web", "Customer portal (document upload)",
           [("identity-and-address", "documents"), ("mandate", "documents"), ("installation-certificates", "documents")], event="documents.uploaded"),
        tp("reminded", "Is reminded of missing documents", "outbound", "email", "Notification service", ["reminder"], activity="Send document reminder"),
        tp("declined", "Receives the decline letter", "outbound", "post", "Notification service (print and post)", ["decline-letter"], activity="Write decline letter"),
        tp("plan-recommended", "Receives a plan recommendation", "outbound", "email", "Customer portal", [("plan-quote", "recommended_plan")], activity="Recommend plan"),
        tp("plan-confirmed", "Confirms the plan", "inbound", "web", "Customer portal", [("plan-quote", "plan")], event="plan.confirmed"),
        tp("plan-by-phone", "Chooses a plan on the phone", "outbound", "phone", "Contact centre telephony", [], activity="Confirm plan by phone"),
        tp("grid-notified", "Is notified of a small installation", "outbound", "api", "Grid operator portal (HTTP)", [("grid-notification", "notification_id")],
           party="grid operator", tool="notify_grid_operator"),
        tp("contract-sent", "Receives the contract to sign", "outbound", "email", "Contract service and e-signature", [("contract", "contract_id")], tool="generate_contract"),
        tp("contract-signed", "Signs the contract", "inbound", "web", "E-signature service", [("contract", "contract_id")], event="contract.signed"),
        tp("switch-requested", "Is asked to switch the supply", "outbound", "api", "Metering-point registry (HTTP)", [("switch-request", "switch_id")],
           party="metering-point registry", tool="request_switch"),
        tp("switch-confirmed", "Confirms the switch", "inbound", "api", "Metering-point registry (HTTP)", [("switch-request", "switch_id")],
           party="metering-point registry", event="switch.completed"),
        tp("welcomed", "Receives the welcome e-mail", "outbound", "email", "Notification service", ["welcome-pack"], activity="Activate customer"),
    ],
    "sentiment": {"min": -2, "max": 2, "initial": 0, "rules": [
        {"on": "touchpoint", "touchpoint": "reminded", "change": -0.5, "reason": "had to be chased for documents"},
        {"on": "touchpoint", "touchpoint": "plan-by-phone", "change": 0.5, "reason": "a person called to settle the plan"},
        {"on": "waited", "longer_than": "P15D", "change": -0.5, "reason": "waited more than fifteen days to hear back"},
        {"on": "touchpoint", "touchpoint": "declined", "change": -1, "reason": "was declined"},
        {"on": "goal_reached", "goal": "active-customer", "change": 1, "reason": "is supplied and welcomed"},
        {"on": "run_failed", "change": -1, "reason": "the onboarding failed"},
        {"on": "stalled", "change": -0.5, "reason": "nothing has moved for too long"},
    ]},
}
write("new-customer-onboarding.journey.json", journey)
print("wrote electricity-onboarding.awa.json, grid-export-registration.awa.json, new-customer-onboarding.journey.json")
