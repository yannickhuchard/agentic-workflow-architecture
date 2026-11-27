# Integration points

Every tool of the two workflows is an **integration point**: a call to one of the supplier's systems, or to a system of the market (credit bureau, metering-point registry, grid operator). The workflows say what they send and what they read back; the address, and the system behind it, are the utility's. Each call is made by the engine's tool runner, held to the deployment's `allowed_hosts`, and journalled with its link (specification 17.3 to 17.5).

The reference adapters in [`adapters/mock-server.mjs`](adapters/mock-server.mjs) implement every one of them on `http://localhost:4545`, with plausible, deterministic answers. To plug in a real system, change the tool's `url` or `endpoint` in the workflow (or in `build-definitions.py`, which writes the workflows), add its host to `tools.allowed_hosts` in `deployment.json`, and give the secret its header names (see [README.md](README.md#taking-it-into-production)).

Some things arrive the other way: the business events the workflow waits for. They are listed at the end.

## Summary

| Tool | Binding | Used by | Secret header |
|---|---|---|---|
| [`register_customer`](#register_customer) | HTTP `POST /crm/v1/customers` | Register application | `authorization: Bearer {{secret:CRM_TOKEN}}` |
| [`send_message`](#send_message) | HTTP `POST /notifications/v1/messages` | Request documents, Send document reminder, Write decline letter, Activate customer | `authorization: Bearer {{secret:NOTIFY_TOKEN}}` |
| [`extract_document`](#extract_document) | HTTP `POST /documents/v1/extractions` | Verify documents, Verify installation documents | `x-api-key: {{secret:DOCUMENTS_API_KEY}}` |
| [`check_credit`](#check_credit) | HTTP `POST /credit/v1/checks` | Check credit and identity | `authorization: Bearer {{secret:CREDIT_BUREAU_TOKEN}}` |
| [`lookup_metering_point`](#lookup_metering_point) | HTTP `GET /registry/v1/metering-points/{metering_point_id}` | Look up metering point | `authorization: Bearer {{secret:REGISTRY_TOKEN}}` |
| [`estimate_annual_cost`](#estimate_annual_cost) | HTTP `GET /tariffs/v1/plans/{plan}/estimate` | Recommend plan | `x-api-key: {{secret:TARIFF_API_KEY}}` |
| [`notify_grid_operator`](#notify_grid_operator) | HTTP `POST /grid/v1/notifications` | Send simplified notification | `authorization: Bearer {{secret:GRID_OPERATOR_TOKEN}}` |
| [`register_export`](#register_export) | JSON-RPC `meterdata.register_export` at `/meter-data/rpc` | Register export meter and tariff | none (see below) |
| [`generate_contract`](#generate_contract) | HTTP `POST /contracts/v1/contracts` | Generate contract | `authorization: Bearer {{secret:CONTRACTS_TOKEN}}` |
| [`create_billing_account`](#create_billing_account) | JSON-RPC `billing.create_account` at `/billing/rpc` | Set up account and direct debit | none |
| [`collect_deposit`](#collect_deposit) | JSON-RPC `billing.collect_deposit` at `/billing/rpc` | Collect deposit | none |
| [`cancel_billing_account`](#cancel_billing_account) | JSON-RPC `billing.cancel_account` at `/billing/rpc` | Cancel account and mandate (compensation) | none |
| [`refund_deposit`](#refund_deposit) | JSON-RPC `billing.refund_deposit` at `/billing/rpc` | Refund deposit (compensation) | none |
| [`request_switch`](#request_switch) | HTTP `POST /registry/v1/switches` | Request supplier switch | `authorization: Bearer {{secret:REGISTRY_TOKEN}}` |
| [`activate_customer`](#activate_customer) | HTTP `POST /crm/v1/customers/{customer_id}/activation` | Activate customer | `authorization: Bearer {{secret:CRM_TOKEN}}` |

**HTTP.** `{name}` in a path is filled from the argument of that name. The other arguments go as query parameters for `GET`, and as a JSON body otherwise (specification 17.2). A status of 400 or more fails the call; the failure is returned to the actor and journalled as `tool.failed`, and does not by itself fail the activity. The reference adapters answer 401 to a request that carries neither an `authorization` nor an `x-api-key` header.

**JSON-RPC.** The engine sends `{"jsonrpc": "2.0", "id": <call id>, "method": ..., "params": <the arguments>}` and reads `result`, or fails the call on `error`. In AWA 1.1 a `jsonrpc` binding carries no headers, and a deployment's identity credentials are not sent with it (specification 17.2, 30.1): reach these endpoints over a network that authenticates the caller itself, such as mutual TLS, a private network or a gateway that adds the credential.

**Money and identifiers.** Amounts are in EUR and tariffs in EUR per kWh. Metering points are named by a generic `metering_point_id`; a utility maps it to the identifier its market uses.

## The tools

### register_customer

Creates the prospective customer in the customer platform (CRM).

| | |
|---|---|
| Binding | `http`, `POST http://localhost:4545/crm/v1/customers` |
| Request | `{"application_id": string, "applicant": {"first_name", "last_name", "date_of_birth"}, "contact": {"email", "phone"}, "supply_address": {"line1", "postcode", "city"}}`, all required |
| Response read | `{"customer_id": string}` |
| Reference adapter | `201 {"customer_id": "C-<digits of the application id>", "status": "prospect", "application_id": ...}` |
| Secret | `authorization: Bearer {{secret:CRM_TOKEN}}` |

### send_message

Sends a message to the customer: an e-mail, a text message or a letter.

| | |
|---|---|
| Binding | `http`, `POST http://localhost:4545/notifications/v1/messages` |
| Request | `{"application_id": string, "channel": "email" \| "sms" \| "post", "template": string, "subject"?: string, "body"?: string}` |
| Response read | `{"message_id": string}` |
| Reference adapter | `201 {"message_id": "MSG-<digits>-<4 digits from the template and channel>", "channel": ..., "status": "queued"}` |
| Secret | `authorization: Bearer {{secret:NOTIFY_TOKEN}}` |

Templates used: `document_request`, `document_reminder`, `decline_letter` (channel `post`), `welcome_pack`.

### extract_document

Reads an uploaded document. The text it returns was written by someone outside the organisation: the verifier agents' guardrail `prompt_injection` at stage `tool_result` withholds a result that carries instructions (specification 31.3, AEP 0002).

| | |
|---|---|
| Binding | `http`, `POST http://localhost:4545/documents/v1/extractions` |
| Request | `{"file_id": string, "document_type": string, "application_id"?: string}`; `document_type` is one of `proof_of_identity`, `proof_of_address`, `direct_debit_mandate`, `installer_certificate`, `compliance_certificate`, `commissioning_report`, `installation_ownership` |
| Response read | `{"file_id", "document_type", "legible": boolean, "fields": object, "text": string, "pages": number}` |
| Reference adapter | `200`, legible, with fields typical of the document type (an identity card in date, a signed mandate, a compliant certificate). A scenario's `world.documents` can make a document illegible, give it fields such as `serial_number` and `rated_capacity_kw`, or give it a text: the commissioning report of `scenarios/b-solar-prosumer.json` carries an instruction addressed to the reviewer |
| Secret | `x-api-key: {{secret:DOCUMENTS_API_KEY}}` |

### check_credit

Asks the credit bureau about the applicant.

| | |
|---|---|
| Binding | `http`, `POST http://localhost:4545/credit/v1/checks` |
| Request | `{"application_id", "first_name", "last_name", "date_of_birth", "postcode": string, "address_line"?: string}` |
| Response read | `{"reference": string, "credit_band": "A" \| "B" \| "C" \| "D" \| "E", "score": number, "outstanding_debt_eur": number, "identity_result": "verified" \| "not_verified" \| "mismatch"}` |
| Reference adapter | `200` with the scenario's `world.credit` for a known application, otherwise band A, B or C derived from the name and date of birth, no debt, identity verified |
| Secret | `authorization: Bearer {{secret:CREDIT_BUREAU_TOKEN}}` |

The decision table **Eligibility** reads `credit_band`, `outstanding_debt_eur` and `identity_result`. Map your bureau's own scale to the five bands, or change the table.

### lookup_metering_point

Reads a metering point from the registry.

| | |
|---|---|
| Binding | `http`, `GET http://localhost:4545/registry/v1/metering-points/{metering_point_id}` |
| Request | `{"metering_point_id": string}` (in the path) |
| Response read | `{"metering_point_id", "meter_type": "smart" \| "standard", "smart_meter": boolean, "current_supplier": string, "connection_capacity_kva": number, "region": string, "grid_operator": string, "phases": number}` |
| Reference adapter | `200` with the scenario's `world.metering_point` for a known point; for another id beginning `MP-`, a default in region `midlands`; `404` otherwise |
| Secret | `authorization: Bearer {{secret:REGISTRY_TOKEN}}` |

`region` is what the decision table **Electricity source** compares with the regions a community scheme supplies; `smart_meter` decides whether the time-of-use plan is offered.

### estimate_annual_cost

Estimates a plan's annual cost from the tariff catalogue.

| | |
|---|---|
| Binding | `http`, `GET http://localhost:4545/tariffs/v1/plans/{plan}/estimate?annual_consumption_kwh=&region=&electricity_source=` |
| Request | `{"plan": "fixed_12" \| "fixed_24" \| "variable" \| "time_of_use" \| "ev" \| "prosumer", "annual_consumption_kwh": number, "region": string, "electricity_source"?: string}` |
| Response read | `{"plan", "label", "annual_consumption_kwh", "unit_rate_eur_per_kwh", "standing_charge_eur_per_day", "estimated_annual_cost_eur": number, "currency": "EUR"}` |
| Reference adapter | `200`: consumption times the plan's unit rate (plus a premium for the source, times a regional factor), plus 365 days of standing charge. The rates are example figures, not any market's prices. `404` for an unknown plan |
| Secret | `x-api-key: {{secret:TARIFF_API_KEY}}` |

### notify_grid_operator

Files the simplified notification of a small generating installation.

| | |
|---|---|
| Binding | `http`, `POST http://localhost:4545/grid/v1/notifications` |
| Request | `{"metering_point_id", "technology": string, "capacity_kw": number, "inverter_serial"?: string, "commissioned_on"?: string}` |
| Response read | `{"notification_id": string, "status": "accepted"}` |
| Reference adapter | `201 {"notification_id": "GN-<digits of the metering point>", "status": "accepted", ...}` |
| Secret | `authorization: Bearer {{secret:GRID_OPERATOR_TOKEN}}` |

### register_export

Registers the export meter and the export tariff with the meter-data system.

| | |
|---|---|
| Binding | `jsonrpc`, `meterdata.register_export` at `http://localhost:4545/meter-data/rpc` |
| Params | `{"metering_point_id": string, "approved_export_kw": number, "technology": string}` |
| Result read | `{"export_registration_id": string, "export_meter_id": string, "approved_export_kw": number, "export_tariff_eur_per_kwh": number}` |
| Reference adapter | `EXP-` and `EM-` with the digits of the metering point; the tariff by technology: solar and wind 0.082, geothermal 0.075, small hydro 0.076, heat and power 0.071, other 0.06 EUR per kWh (example figures) |
| Secret | none (JSON-RPC) |

### generate_contract

Generates the supply contract and sends it for e-signature. The contract states the 14-day cooling-off period; the workflow does not wait for it to pass.

| | |
|---|---|
| Binding | `http`, `POST http://localhost:4545/contracts/v1/contracts` |
| Request | `{"application_id", "customer_id", "plan", "electricity_source": string, "export_tariff_eur_per_kwh"?: number \| null, "deposit_eur"?: number}` |
| Response read | `{"contract_id": string, "contract_url": string, "cooling_off_days": number}` |
| Reference adapter | `201 {"contract_id": "CT-<digits>", "contract_url": ".../CT-<digits>.pdf", "cooling_off_days": 14, "status": "sent_for_signature"}` |
| Secret | `authorization: Bearer {{secret:CONTRACTS_TOKEN}}` |

### create_billing_account

Opens the billing account and registers the direct debit mandate. Undone by `cancel_billing_account` when the switch does not happen.

| | |
|---|---|
| Binding | `jsonrpc`, `billing.create_account` at `http://localhost:4545/billing/rpc` |
| Params | `{"customer_id", "contract_id", "mandate_reference": string, "billing_day"?: number}` |
| Result read | `{"account_id": string, "mandate_id": string, "mandate_status": "active"}` |
| Reference adapter | `ACC-` with the digits of the customer, `MDT-` with those of the mandate reference |
| Secret | none (JSON-RPC) |

The mandate reference is the one the portal created when the customer signed the mandate online (`mandate_reference` in `documents.uploaded`); the account number itself never passes through the workflow.

### collect_deposit

| | |
|---|---|
| Binding | `jsonrpc`, `billing.collect_deposit` at `http://localhost:4545/billing/rpc` |
| Params | `{"account_id": string, "amount_eur": number > 0}` |
| Result read | `{"deposit_id": string, "amount_eur": number, "status": "collected"}` |
| Reference adapter | `DEP-` with the digits of the account |
| Secret | none (JSON-RPC) |

### cancel_billing_account

Compensation of `create_billing_account` (specification 13.6).

| | |
|---|---|
| Binding | `jsonrpc`, `billing.cancel_account` at `http://localhost:4545/billing/rpc` |
| Params | `{"account_id": string, "reason": string}` |
| Result read | `{"account_id", "status": "cancelled", "mandate_status": "cancelled"}` |
| Reference adapter | as above |
| Secret | none (JSON-RPC) |

### refund_deposit

Compensation of `collect_deposit`.

| | |
|---|---|
| Binding | `jsonrpc`, `billing.refund_deposit` at `http://localhost:4545/billing/rpc` |
| Params | `{"deposit_id": string, "amount_eur": number}` |
| Result read | `{"refund_id": string, "amount_eur": number, "status": "refunded"}` |
| Reference adapter | `REF-` with the digits of the deposit |
| Secret | none (JSON-RPC) |

### request_switch

Asks the registry to move the supply to this supplier.

| | |
|---|---|
| Binding | `http`, `POST http://localhost:4545/registry/v1/switches` |
| Request | `{"metering_point_id", "customer_id", "contract_id": string}` |
| Response read | `{"switch_id": string, "expected_switch_date": "YYYY-MM-DD"}` |
| Reference adapter | `201 {"switch_id": "SW-<digits of the customer>", "status": "requested", "expected_switch_date": <14 days from now>}` |
| Secret | `authorization: Bearer {{secret:REGISTRY_TOKEN}}` |

### activate_customer

| | |
|---|---|
| Binding | `http`, `POST http://localhost:4545/crm/v1/customers/{customer_id}/activation` |
| Request | `{"customer_id": string, "supply_start_date": "YYYY-MM-DD"}` |
| Response read | `{"customer_id", "status": "active", "activated_at": "YYYY-MM-DD"}` |
| Reference adapter | `200`, `activated_at` is the supply start date |
| Secret | `authorization: Bearer {{secret:CRM_TOKEN}}` |

## The business events

The host takes these in (specification 18), from a webhook, a queue or the HTTP route `POST /api/v1/journeys/events`, as CloudEvents 1.0 with `application_id` in `data`. Each wait is correlated on `application_id`.

| Event | Who sends it | `data` the workflow reads | Wait and deadline |
|---|---|---|---|
| `onboarding.requested` | Customer portal (web form) | the application: `application_id`, `applicant`, `contact`, `supply_address`, `metering_point_id`, `consumption_basis`, `annual_consumption_kwh`, `electricity_source`, `plan_preference`, `has_generation`, `generation_technology`, `generation_capacity_kw`, `installation`, `ev_charger`, `heat_pump` | starts the journey and the run |
| `documents.uploaded` | Customer portal (document upload) | `documents` (`[{type, file_id}]`), `installation_documents` for a home with generation, `mandate_reference` | 7 days, a reminder, 7 more days, then abandoned |
| `plan.confirmed` | Customer portal | `plan` | 14 days, then customer care calls |
| `contract.signed` | E-signature service | `contract_signed: true` | 14 days, then abandoned |
| `switch.completed` | Metering-point registry | `switch_completed: true`, `supply_start_date` | 21 days, then the run fails and compensation undoes the billing set-up |

The workflow publishes `onboarding.verified`, `plan.chosen`, `grid_export.completed`, `customer.activated`, `onboarding.abandoned` and `onboarding.declined`, with the data each lists in its event node; the journey moves on them, and other systems may subscribe to them.
