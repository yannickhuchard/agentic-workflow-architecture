# Integration points

Every tool of the seven workflows is an **integration point**: a call to one of Valoria Life's systems, to the custodian bank, to Kestrel's payroll or to a service provider (screening, e-signature). The workflows say what they send and what they read back; the address, and the system behind it, are the insurer's. Each call is made by the engine's tool runner, held to the deployment's `allowed_hosts`, and journalled with its link (specification 17.3 to 17.5).

The reference adapters in [`adapters/mock-server.mjs`](adapters/mock-server.mjs) implement every one of them on `http://localhost:4560`, with plausible, deterministic answers and no state. To plug in a real system, change the tool's `url` or `endpoint` in `build-definitions.py`, which writes the workflows, run it, add the host to `tools.allowed_hosts` in `deployment.json`, and give the secret its header names (see [README.md](README.md#taking-it-into-production)).

Some things arrive the other way: the business events the workflows wait for. They are listed at the end.

This file is written from the workflow documents; the request of each tool is its `parameters` schema.

## Summary

| System | Tool | Binding | Used by | Secret header |
|---|---|---|---|---|
| HR portal | [`send_notification`](#send_notification) | HTTP `POST /portal/v1/notifications` | Send invitation, Send invitation reminder, Send last reminder, Warn about the risk, Send policy documents, Send quarterly statement, Send annual statement, Decline the change, Write top-up proposal, Issue tax certificate, Invite to annual review, Publish recommendations | `authorization: Bearer {{secret:PORTAL_TOKEN}}` |
| HR portal | [`open_questionnaire`](#open_questionnaire) | HTTP `POST /portal/v1/questionnaires` | Send questionnaire | `authorization: Bearer {{secret:PORTAL_TOKEN}}` |
| Advice calendar | [`book_video_call`](#book_video_call) | HTTP `POST /advice/v1/appointments` | Book video call | `authorization: Bearer {{secret:ADVICE_CALENDAR_TOKEN}}` |
| Policy administration | [`register_enrolment`](#register_enrolment) | HTTP `POST /policy-admin/v1/enrolments` | Register enrolment | `authorization: Bearer {{secret:POLICY_ADMIN_TOKEN}}` |
| Policy administration | [`get_plan_rules`](#get_plan_rules) | HTTP `GET /policy-admin/v1/plans/{plan_id}` | Explain the plan | `authorization: Bearer {{secret:POLICY_ADMIN_TOKEN}}` |
| Policy administration | [`record_suitability_profile`](#record_suitability_profile) | HTTP `POST /policy-admin/v1/enrolments/{enrolment_id}/profile` | Record suitability profile | `authorization: Bearer {{secret:POLICY_ADMIN_TOKEN}}` |
| Policy administration | [`issue_policy`](#issue_policy) | HTTP `POST /policy-admin/v1/policies` | Issue policy | `authorization: Bearer {{secret:POLICY_ADMIN_TOKEN}}` |
| Policy administration | [`cancel_policy`](#cancel_policy) | HTTP `POST /policy-admin/v1/policies/{policy_id}/cancellation` | Cancel policy (compensation) | `authorization: Bearer {{secret:POLICY_ADMIN_TOKEN}}` |
| Policy administration | [`record_premium`](#record_premium) | HTTP `POST /policy-admin/v1/policies/{policy_id}/premiums` | Invest first premium, Invest contribution | `authorization: Bearer {{secret:POLICY_ADMIN_TOKEN}}` |
| Policy administration | [`refund_premium`](#refund_premium) | HTTP `POST /policy-admin/v1/refunds` | Redeem units and refund premium (compensation) | `authorization: Bearer {{secret:POLICY_ADMIN_TOKEN}}` |
| Policy administration | [`update_beneficiary_clause`](#update_beneficiary_clause) | HTTP `POST /policy-admin/v1/policies/{policy_id}/beneficiary-clause` | Apply accepted changes | `authorization: Bearer {{secret:POLICY_ADMIN_TOKEN}}` |
| Fund platform | [`list_funds`](#list_funds) | HTTP `GET /funds/v1/plans/{plan_id}/funds` | Propose investments | `x-api-key: {{secret:FUND_PLATFORM_KEY}}` |
| Fund platform | [`check_allocation`](#check_allocation) | HTTP `POST /funds/v1/suitability-checks` | Check choice against profile, Check change against profile | `x-api-key: {{secret:FUND_PLATFORM_KEY}}` |
| Custodian bank | [`place_order`](#place_order) | JSON-RPC `custody.place_order` at `/custody/rpc` | Invest first premium, Invest contribution | none (see below) |
| Custodian bank | [`redeem_units`](#redeem_units) | JSON-RPC `custody.redeem_all` at `/custody/rpc` | Redeem units and refund premium (compensation) | none (see below) |
| Custodian bank | [`switch_funds`](#switch_funds) | JSON-RPC `custody.switch` at `/custody/rpc` | Switch funds, Apply accepted changes | none (see below) |
| Custodian bank | [`get_position`](#get_position) | JSON-RPC `custody.get_position` at `/custody/rpc` | Send quarterly statement, Send annual statement, Read the plan's position | none (see below) |
| KYC and AML screening | [`extract_document`](#extract_document) | HTTP `POST /documents/v1/extractions` | Verify identity documents | `x-api-key: {{secret:DOCUMENTS_API_KEY}}` |
| KYC and AML screening | [`screen_person`](#screen_person) | HTTP `POST /screening/v1/screenings` | Screen PEP and sanctions | `authorization: Bearer {{secret:SCREENING_TOKEN}}` |
| KYC and AML screening | [`validate_self_certification`](#validate_self_certification) | HTTP `POST /kyc/v1/self-certifications/validations` | Validate tax self-certification | `authorization: Bearer {{secret:KYC_TOKEN}}` |
| KYC and AML screening | [`record_due_diligence`](#record_due_diligence) | HTTP `POST /kyc/v1/files` | Record due diligence, Record refusal of relationship | `authorization: Bearer {{secret:KYC_TOKEN}}` |
| E-signature | [`request_signature`](#request_signature) | HTTP `POST /esign/v1/envelopes` | Prepare contract for signature | `authorization: Bearer {{secret:ESIGN_TOKEN}}` |
| Employer payroll | [`create_payroll_deduction`](#create_payroll_deduction) | JSON-RPC `payroll.create_deduction` at `/payroll/rpc` | Set up payroll deduction | none (see below) |
| Employer payroll | [`stop_payroll_deduction`](#stop_payroll_deduction) | JSON-RPC `payroll.stop_deduction` at `/payroll/rpc` | Stop payroll deduction (compensation) | none (see below) |
| Employer payroll | [`schedule_one_off_deduction`](#schedule_one_off_deduction) | JSON-RPC `payroll.schedule_one_off` at `/payroll/rpc` | Schedule top-up | none (see below) |
| Tax computation and certificates | [`compute_deductions`](#compute_deductions) | HTTP `POST /tax/v1/deduction-computations` | Project the year, Compute deductible amounts | `authorization: Bearer {{secret:TAX_SERVICE_TOKEN}}` |
| Tax computation and certificates | [`issue_tax_certificate`](#issue_tax_certificate) | HTTP `POST /tax-certificates/v1/certificates` | Issue tax certificate | `authorization: Bearer {{secret:CERTIFICATES_TOKEN}}` |

27 tools in all.

**HTTP.** `{name}` in a path is filled from the argument of that name. The other arguments go as query parameters for `GET`, and as a JSON body otherwise (specification 17.2). A status of 400 or more fails the call; the failure is returned to the actor and journalled as `tool.failed`, and does not by itself fail the activity. The reference adapters answer 401 to a request that carries neither an `authorization` nor an `x-api-key` header.

**JSON-RPC.** The engine sends `{"jsonrpc": "2.0", "id": <call id>, "method": ..., "params": <the arguments>}` and reads `result`, or fails the call on `error`. In AWA 1.1 a `jsonrpc` binding carries no headers, and a deployment's identity credentials are not sent with it (specification 17.2, 30.1): reach the payroll and the custodian bank over a network that authenticates the caller itself, such as mutual TLS, a private network or a gateway that adds the credential.

**Money, identifiers and personal data.** Amounts are in EUR. An enrolment is named by `enrolment_id`, a policy by `policy_id`; the reference adapters derive their identifiers from the digits of the enrolment id. Identity documents, tax identification numbers and beneficiaries are personal data: the deployment classifies every workflow as `personal_data`, and a production host journals payloads as `hash` where the law asks for it (specification 9.4).

## HR portal

The portal Valoria Life provides to Kestrel's employees: inbox, chat with the AI adviser, questionnaires, self-service. It also sends e-mails.

### send_notification

Send the employee a message in the HR portal's inbox, by e-mail, or both.

| | |
|---|---|
| Binding | `http`, `POST http://localhost:4560/portal/v1/notifications` |
| Request | `enrolment_id`: string, `channel`: "portal" \| "email" \| "portal_and_email", `template`: string, `subject`?: string, `body`?: string |
| Response read | {"message_id"} |
| Reference adapter | `201` with `message_id: "MSG-<digits>-<4 digits from the template, channel and subject>"`, `status: "delivered"` |
| Used by | Send invitation, Send invitation reminder, Send last reminder, Warn about the risk, Send policy documents, Send quarterly statement, Send annual statement, Decline the change, Write top-up proposal, Issue tax certificate, Invite to annual review, Publish recommendations |
| Secret | `authorization: Bearer {{secret:PORTAL_TOKEN}}` |

### open_questionnaire

Open the demands-and-needs and suitability questionnaire for the employee in the HR portal.

| | |
|---|---|
| Binding | `http`, `POST http://localhost:4560/portal/v1/questionnaires` |
| Request | `enrolment_id`: string, `questionnaire`: string, `language`?: string |
| Response read | {"questionnaire_id"} |
| Reference adapter | `201` with `questionnaire_id: "Q-<digits>"` and the five sections |
| Used by | Send questionnaire |
| Secret | `authorization: Bearer {{secret:PORTAL_TOKEN}}` |

## Advice calendar

Licensed advisers' availability and video calls.

### book_video_call

Book a video call with a licensed adviser in the advice calendar.

| | |
|---|---|
| Binding | `http`, `POST http://localhost:4560/advice/v1/appointments` |
| Request | `enrolment_id`: string, `topic`: string, `preferred_slot`?: string, `language`?: string |
| Response read | {"appointment_id", "slot", "video_link"} |
| Reference adapter | `201` with `appointment_id: "APT-<digits>"` and a slot two days ahead when none is asked |
| Used by | Book video call |
| Secret | `authorization: Bearer {{secret:ADVICE_CALENDAR_TOKEN}}` |

## Policy administration

Valoria Life's system of record for plans, enrolments, profiles, policies, premiums, refunds and beneficiary clauses.

### register_enrolment

Create the enrolment of an invited employee in the policy administration system.

| | |
|---|---|
| Binding | `http`, `POST http://localhost:4560/policy-admin/v1/enrolments` |
| Request | `enrolment_id`: string, `plan_id`: string, `employee`: object, `employer`: object, `tax_residence`?: string |
| Response read | {"enrolment_id", "prospect_id", "invitation_open_until"} |
| Reference adapter | `201` with `prospect_id: "P-<digits of the enrolment id>"`, `status: "invited"`, `invitation_open_until` 28 days ahead |
| Used by | Register enrolment |
| Secret | `authorization: Bearer {{secret:POLICY_ADMIN_TOKEN}}` |

### get_plan_rules

Read the terms of the employer's savings plan: the contract, its minimum duration, the fees, the fund range and the tax article it is written under.

| | |
|---|---|
| Binding | `http`, `GET http://localhost:4560/policy-admin/v1/plans/{plan_id}` |
| Request | `plan_id`: string |
| Response read | the plan's terms: `product`, `contract_type`, `tax_article`, `deduction_ceiling_eur`, `ceiling_from_tax_year`, `minimum_duration_years`, `payout_from_age`, `payout_until_age`, `management_fee_pct_per_year`, `right_to_cancel_days`, `custodian_bank` |
| Reference adapter | `200` with the terms of `KES-PENSION-111BIS`; `404` for another plan |
| Used by | Explain the plan |
| Secret | `authorization: Bearer {{secret:POLICY_ADMIN_TOKEN}}` |

### record_suitability_profile

Record the demands and needs, the suitability assessment and the risk profile on the enrolment.

| | |
|---|---|
| Binding | `http`, `POST http://localhost:4560/policy-admin/v1/enrolments/{enrolment_id}/profile` |
| Request | `enrolment_id`: string, `risk_profile`: "cautious" \| "moderate" \| "balanced" \| "dynamic", `max_sri`: integer, `demands_and_needs`?: string, `sustainability_preference`?: string |
| Response read | {"profile_reference"} |
| Reference adapter | `201` with `profile_reference: "PRF-<digits>"` |
| Used by | Record suitability profile |
| Secret | `authorization: Bearer {{secret:POLICY_ADMIN_TOKEN}}` |

### issue_policy

Issue the policy in the policy administration system and open its unit-linked account with the custodian bank.

| | |
|---|---|
| Binding | `http`, `POST http://localhost:4560/policy-admin/v1/policies` |
| Request | `enrolment_id`: string, `plan_id`: string, `monthly_contribution_eur`: number, `allocation`: array, `beneficiary_clause`: object |
| Response read | {"policy_id", "custody_account", "issued_on"} |
| Reference adapter | `201` with `policy_id: "VL-<digits>"`, `custody_account: "CUST-<digits>"` and the custodian bank's name |
| Used by | Issue policy |
| Secret | `authorization: Bearer {{secret:POLICY_ADMIN_TOKEN}}` |

### cancel_policy

Cancel a policy from its start, as if it had never been issued.

| | |
|---|---|
| Binding | `http`, `POST http://localhost:4560/policy-admin/v1/policies/{policy_id}/cancellation` |
| Request | `policy_id`: string, `reason`: string |
| Response read | {"status"} |
| Reference adapter | `200` with `status: "cancelled_from_start"` |
| Used by | Cancel policy (compensation) |
| Secret | `authorization: Bearer {{secret:POLICY_ADMIN_TOKEN}}` |

### record_premium

Record a premium on the policy and return the premiums paid in the tax year so far.

| | |
|---|---|
| Binding | `http`, `POST http://localhost:4560/policy-admin/v1/policies/{policy_id}/premiums` |
| Request | `policy_id`: string, `period`: string, `amount_eur`: number, `paid_before_eur`?: number |
| Response read | {"premium_id", "paid_to_date_eur", "tax_year"} |
| Reference adapter | `201`; `paid_to_date_eur` is `paid_before_eur + amount_eur`: the adapters keep no state, so the caller passes the total so far. A real policy administration system keeps it |
| Used by | Invest first premium, Invest contribution |
| Secret | `authorization: Bearer {{secret:POLICY_ADMIN_TOKEN}}` |

### refund_premium

Refund premiums to the employee's account.

| | |
|---|---|
| Binding | `http`, `POST http://localhost:4560/policy-admin/v1/refunds` |
| Request | `policy_id`: string, `amount_eur`: number, `reason`: string |
| Response read | {"refund_id", "amount_eur"} |
| Reference adapter | `201` with `refund_id: "REF-<digits>"`, `status: "paid"` |
| Used by | Redeem units and refund premium (compensation) |
| Secret | `authorization: Bearer {{secret:POLICY_ADMIN_TOKEN}}` |

### update_beneficiary_clause

Replace the beneficiary clause of a policy.

| | |
|---|---|
| Binding | `http`, `POST http://localhost:4560/policy-admin/v1/policies/{policy_id}/beneficiary-clause` |
| Request | `policy_id`: string, `beneficiary_clause`: object |
| Response read | {"clause_version"} |
| Reference adapter | `200` with `clause_version: 2` |
| Used by | Apply accepted changes |
| Secret | `authorization: Bearer {{secret:POLICY_ADMIN_TOKEN}}` |

## Fund platform

The plan's range of unit-linked funds and model portfolios, with their key information documents, and the suitability check of an allocation.

### list_funds

List the unit-linked funds and model portfolios of the plan, each with its key information document and its summary risk indicator.

| | |
|---|---|
| Binding | `http`, `GET http://localhost:4560/funds/v1/plans/{plan_id}/funds` |
| Request | `plan_id`: string, `max_sri`?: integer, `sustainability`?: string |
| Response read | `funds` (each with `fund_id`, `name`, `sri`, `sfdr_article`, `ongoing_charges_pct`, `within_profile`, `kid_id`, `kid_url`) and `model_portfolios` (each with `model_portfolio`, `allocation`, `portfolio_sri`, `within_profile`) |
| Reference adapter | `200` with nine example funds, SRI 1 to 6, and four model portfolios |
| Used by | Propose investments |
| Secret | `x-api-key: {{secret:FUND_PLATFORM_KEY}}` |

### check_allocation

Check an allocation against a risk profile: the weighted summary risk indicator, its excess over the profile's maximum, and whether every fund's key information document was delivered.

| | |
|---|---|
| Binding | `http`, `POST http://localhost:4560/funds/v1/suitability-checks` |
| Request | `allocation`: array, `max_sri`: integer, `enrolment_id`?: string |
| Response read | {"portfolio_sri", "sri_excess", "kids_delivered"} |
| Reference adapter | `200`: `portfolio_sri` is the indicators weighted by percent, to one decimal; `sri_excess` is `portfolio_sri - max_sri`; `422` for a fund outside the range |
| Used by | Check choice against profile, Check change against profile |
| Secret | `x-api-key: {{secret:FUND_PLATFORM_KEY}}` |

## Custodian bank

The bank that holds the assets covering the policies apart from the insurer's own, and executes orders, switches and redemptions.

### place_order

Buy units with a premium through the custodian bank: in the allocation given, or else in the policy's current allocation.

| | |
|---|---|
| Binding | `jsonrpc`, `custody.place_order` at `http://localhost:4560/custody/rpc` |
| Request | `policy_id`: string, `amount_eur`: number, `allocation`?: array, `period`?: string |
| Response read | {"order_id", "lines"} |
| Reference adapter | `{"order_id": "ORD-<digits>-<period>", "status": "executed"}`; without an `allocation`, the custodian applies the policy's current one |
| Used by | Invest first premium, Invest contribution |
| Secret | none (see below) |

### redeem_units

Sell every unit bought for a policy, through the custodian bank.

| | |
|---|---|
| Binding | `jsonrpc`, `custody.redeem_all` at `http://localhost:4560/custody/rpc` |
| Request | `policy_id`: string, `reason`: string |
| Response read | {"redemption_id"} |
| Reference adapter | `{"redemption_id": "RED-<digits>", "status": "executed"}` |
| Used by | Redeem units and refund premium (compensation) |
| Secret | none (see below) |

### switch_funds

Move the value of a policy to a new allocation, through the custodian bank.

| | |
|---|---|
| Binding | `jsonrpc`, `custody.switch` at `http://localhost:4560/custody/rpc` |
| Request | `policy_id`: string, `allocation`: array |
| Response read | {"switch_id", "portfolio_sri"} |
| Reference adapter | `{"switch_id": "SWT-<digits>-<month>", "status": "executed"}` |
| Used by | Switch funds, Apply accepted changes |
| Secret | none (see below) |

### get_position

Read the value of a policy, its units by fund and how far its allocation has drifted from the target.

| | |
|---|---|
| Binding | `jsonrpc`, `custody.get_position` at `http://localhost:4560/custody/rpc` |
| Request | `policy_id`: string, `target_allocation`?: array, `premiums_eur`?: number |
| Response read | {"value_eur", "performance_pct", "drift_pp"} |
| Reference adapter | the value is the premiums times an example performance, from the scenario's `world.position` or derived from the policy id; `drift_pp` likewise |
| Used by | Send quarterly statement, Send annual statement, Read the plan's position |
| Secret | none (see below) |

## KYC and AML screening

Document extraction for identity documents, screening against the lists of politically exposed persons and sanctions, CRS and FATCA self-certification checks, and the due diligence file.

### extract_document

Read an uploaded identity document or proof of address: its type, whether it is legible, the fields printed on it and its text.

| | |
|---|---|
| Binding | `http`, `POST http://localhost:4560/documents/v1/extractions` |
| Request | `file_id`: string, `document_type`: string, `enrolment_id`?: string |
| Response read | {"document_type", "legible", "fields", "text"} |
| Reference adapter | `200`; a document named in a scenario's `world.documents` returns its fields and text (Ana's proof of address carries a hidden instruction) |
| Used by | Verify identity documents |
| Secret | `x-api-key: {{secret:DOCUMENTS_API_KEY}}` |

### screen_person

Screen a person against the lists of politically exposed persons, sanctions and adverse media.

| | |
|---|---|
| Binding | `http`, `POST http://localhost:4560/screening/v1/screenings` |
| Request | `enrolment_id`: string, `first_name`: string, `last_name`: string, `date_of_birth`: string, `nationality`?: string |
| Response read | {"screening_reference", "result": "clear" \| "pep" \| "possible_sanctions_match", "matches"} |
| Reference adapter | `200` with `clear`, or the scenario's `world.screening` (Sara: `pep`) |
| Used by | Screen PEP and sanctions |
| Secret | `authorization: Bearer {{secret:SCREENING_TOKEN}}` |

### validate_self_certification

Check a tax residence self-certification for CRS and FATCA: the countries of residence, the format of each tax identification number, and US status.

| | |
|---|---|
| Binding | `http`, `POST http://localhost:4560/kyc/v1/self-certifications/validations` |
| Request | `enrolment_id`: string, `self_certification`: object |
| Response read | {"self_certification_valid", "us_person", "crs_reportable", "tax_residences", "problems"} |
| Reference adapter | `200`: checks the format of each tax identification number for LU, FR, BE and DE (13, 13, 11 and 11 digits; EXAMPLE format checks only); `crs_reportable` when a residence is outside Luxembourg |
| Used by | Validate tax self-certification |
| Secret | `authorization: Bearer {{secret:KYC_TOKEN}}` |

### record_due_diligence

Record the customer due diligence file: its level, the screening, the tax residences to report under CRS and the FATCA status.

| | |
|---|---|
| Binding | `http`, `POST http://localhost:4560/kyc/v1/files` |
| Request | `enrolment_id`: string, `cdd_level`: string, `outcome`: "accepted" \| "refused", `screening_reference`?: string, `crs_reportable`?: boolean, `fatca_status`?: string, `note`?: string |
| Response read | {"kyc_file_id"} |
| Reference adapter | `201` with `kyc_file_id: "KYC-<digits>"` and a review date one year (enhanced) or three years (standard) ahead |
| Used by | Record due diligence, Record refusal of relationship |
| Secret | `authorization: Bearer {{secret:KYC_TOKEN}}` |

## E-signature

Qualified electronic signature of the contract, the beneficiary clause and the payroll mandate.

### request_signature

Send the subscription contract, the beneficiary clause and the payroll deduction mandate for e-signature.

| | |
|---|---|
| Binding | `http`, `POST http://localhost:4560/esign/v1/envelopes` |
| Request | `enrolment_id`: string, `documents`: array, `signer_email`?: string |
| Response read | {"envelope_id"} |
| Reference adapter | `201` with `envelope_id: "ENV-<digits>"`; the signed envelope comes back as the business event `contract.signed` |
| Used by | Prepare contract for signature |
| Secret | `authorization: Bearer {{secret:ESIGN_TOKEN}}` |

## Employer payroll

Kestrel's payroll system: the monthly deduction from the salary and one-off top-ups.

### create_payroll_deduction

Set up the monthly payroll deduction the employee signed, from the next payroll.

| | |
|---|---|
| Binding | `jsonrpc`, `payroll.create_deduction` at `http://localhost:4560/payroll/rpc` |
| Request | `employee_number`: string, `policy_id`: string, `monthly_amount_eur`: number |
| Response read | {"deduction_id", "first_period"} |
| Reference adapter | `{"deduction_id": "DED-<digits>", "status": "active"}` |
| Used by | Set up payroll deduction |
| Secret | none (see below) |

### stop_payroll_deduction

Stop a payroll deduction.

| | |
|---|---|
| Binding | `jsonrpc`, `payroll.stop_deduction` at `http://localhost:4560/payroll/rpc` |
| Request | `deduction_id`: string, `reason`: string |
| Response read | {"status"} |
| Reference adapter | `{"status": "stopped"}` |
| Used by | Stop payroll deduction (compensation) |
| Secret | none (see below) |

### schedule_one_off_deduction

Add a one-off amount to the employee's next payroll deduction: a top-up.

| | |
|---|---|
| Binding | `jsonrpc`, `payroll.schedule_one_off` at `http://localhost:4560/payroll/rpc` |
| Request | `employee_number`: string, `policy_id`: string, `amount_eur`: number |
| Response read | {"one_off_id", "period"} |
| Reference adapter | `{"one_off_id": "ONE-<digits>-<month>", "status": "scheduled"}`; the next `payroll.contribution_paid` carries the top-up in its `amount_eur` |
| Used by | Schedule top-up |
| Secret | none (see below) |

## Tax computation and certificates

The computation of deductible amounts from the premiums and the ceilings of the decision table, and the annual tax certificate.

### compute_deductions

Compute the deductible amount of premiums per article of the income tax law, from the premiums paid, the contributions still to come and the ceilings the decision table gives.

| | |
|---|---|
| Binding | `http`, `POST http://localhost:4560/tax/v1/deduction-computations` |
| Request | `tax_year`: integer, `articles`: array, `ceilings_eur`: array, `bases`?: array, `premiums_eur`: number, `monthly_contribution_eur`?: number, `months_remaining`?: integer, `household_members`?: integer |
| Response read | {"article", "ceiling_eur", "deductible_eur", "projected_premiums_eur", "projected_deductible_eur", "shortfall_eur", "lines"} |
| Reference adapter | `200`: per article, the ceiling (times `household_members` for a ceiling per household member), the deductible amount `min(premiums, ceiling)`, and with `monthly_contribution_eur` and `months_remaining` the projection and the shortfall to the ceiling. The premiums of the plan count under the first article the decision table names |
| Used by | Project the year, Compute deductible amounts |
| Secret | `authorization: Bearer {{secret:TAX_SERVICE_TOKEN}}` |

### issue_tax_certificate

Issue the annual tax certificate of the premiums paid, for the employee's tax return.

| | |
|---|---|
| Binding | `http`, `POST http://localhost:4560/tax-certificates/v1/certificates` |
| Request | `policy_id`: string, `tax_year`: integer, `article`: string, `premiums_eur`: number, `deductible_eur`: number, `employee`?: string |
| Response read | {"certificate_id", "document_url"} |
| Reference adapter | `201` with `certificate_id: "TC-<tax year>-<digits>"` |
| Used by | Issue tax certificate |
| Secret | `authorization: Bearer {{secret:CERTIFICATES_TOKEN}}` |

## The business events

The host takes these in (specification 18), from a webhook, a queue or the HTTP route `POST /api/v1/journeys/events`, as CloudEvents 1.0 with `enrolment_id` in `data`. Each wait is correlated on `enrolment_id`.

| Event | Who sends it | `data` the workflows read | What it does |
|---|---|---|---|
| `savings.invited` | HR portal, when Kestrel HR opens the plan to an employee | `enrolment_id`, `plan_id`, `contract_type`, `employer`, `employee` (`employee_number`, `first_name`, `last_name`, `date_of_birth`, `age`, `email`, `nationality`, `language`), `tax_residence`, `retirement_age`, `household_members` | starts the journey and Plan Invitation and Advice |
| `invitation.opened` | HR portal | `invitation_opened: true` | 7 days, an AI reminder, 7 more days, Kestrel HR's last reminder, 14 more days, then the invitation lapses |
| `questionnaire.submitted` | HR portal | `knowledge_level`, `capacity_for_loss`, `horizon_years`, `risk_tolerance` (1 to 5), `sustainability_preference`, `monthly_contribution_eur` | 14 days, then the enrolment is closed |
| `investments.chosen` | HR portal | `choice` (`model_portfolio` or `own_choice`), `allocation` (`[{fund_id, percent}]`), `kids_acknowledged` | 14 days |
| `investments.reconsidered` | HR portal | `reconsider_decision` (`adjust` with a new `allocation`, or `keep`) | 14 days |
| `subscription.submitted` | HR portal | `documents` (`[{type, file_id}]`), `self_certification` (`tax_residences: [{country, tin}]`, `us_person`), `beneficiary_clause`, `monthly_contribution_eur`, `payroll_mandate_signed` | 14 days |
| `contract.signed` | E-signature service | `contract_signed: true`, `envelope_id` | 14 days |
| `payroll.contribution_paid` | Kestrel payroll, each month | `period` (YYYY-MM), `amount_eur` (a top-up included) | the first premium (45 days, then the run fails and compensation undoes the issue), then each month's contribution (40 days, then HR is told) |
| `cooling_off.ended` | Policy administration, optional | none | the policy is in force; at 30 days it is in force anyway |
| `policy.cancellation_requested` | HR portal, within the 30 days | `cancellation_reason` | the journey's exit: the host withdraws the runs, and compensation refunds and cancels |
| `self_service.requested` | HR portal (self-service) | `request_type` (`switch` with `new_allocation`, or `top_up` with `top_up_eur`) | starts a Self-Service Change |
| `tax_year.review_due` | The insurer's calendar, in November | `tax_year`, `months_remaining`, `tax_review_due: true` | starts Year-End Tax |
| `tax_certificates.due` | The insurer's calendar, in January | `tax_year` | the certificate run |
| `annual_review.due` | The insurer's calendar, at the policy's anniversary | `review_year` | starts the Annual Review |
| `annual_review.answered` | HR portal | `deduction_claimed`, `life_events`, `satisfaction` (1 to 5, the measured mood) | 30 days |
| `recommendations.answered` | HR portal | `recommendations_accepted`, a new `beneficiary_clause` where one was recommended | 30 days |

The workflows publish `advice.given`, `profile.completed`, `savings.invitation_lapsed`, `investments.confirmed`, `subscription.lapsed`, `subscription.refused`, `policy.issued`, `policy.in_force`, `contribution.recorded`, `savings_year.closed`, `self_service.completed`, `self_service.declined`, `tax_certificate.issued` and `annual_review.completed`, with the data each lists in its event node. The journey moves on them, `profile.completed` starts the subscription, `policy.in_force` the payroll contributions and `savings_year.closed` lets the year-end tax compute the certificate; other systems may subscribe to them.
