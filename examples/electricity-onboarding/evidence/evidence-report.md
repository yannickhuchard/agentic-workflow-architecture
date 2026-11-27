# Evidence report

As of 2027-03-24T03:07:07.000Z. Period: 2026-11-03T09:00:00.000Z to 2027-03-01T09:00:00.000Z.

> This report is evidence computed from the execution journals and journey records listed in it. Every statement cites the records it rests on. It is not a certification, an audit opinion or a conformity assessment: it does not establish that any system, deployer or provider complies with the EU AI Act, the NIST AI RMF, ISO/IEC 42001 or any other framework. Whether these records meet an obligation depends on the system, its intended purpose, its risk classification and the applicable law, which this report does not assess.

## Scope

| Workflow | Versions | Runs | Of which child runs |
|---|---|---|---|
| Electricity Customer Onboarding | 1.0.0 | 8 | 0 |
| Grid Export Registration | 1.0.0 | 3 | 3 |

- Journey "New Customer Onboarding": 8 instance(s)

Each statement cites the journal records it rests on: "run 1a2b3c4d #5" is the record with sequence number 5 in the journal of the run whose id begins 1a2b3c4d.

## 1. What ran

*Which runs and journeys took place in the period, with which workflow versions, and how did each end?*

Can serve as evidence for: EU AI Act Art. 12(1), Art. 12(2), Art. 26(5); NIST AI RMF MEASURE; ISO/IEC 42001 Clause 9.1, Annex A.6.

- runs: 11
- completed: 10
- failed: 1
- cancelled: 0
- in progress: 0
- child runs: 3
- journeys: 8
- migrations: 0
- authorizations allowed: 2

| Statement | Records |
|---|---|
| Run 00000003 of "Electricity Customer Onboarding" version 1.0.0 started at 2026-11-03T09:00:00.000Z by host and completed at 2026-11-17T16:07:47.000Z. | run 00000003 #1, #119 |
| Run 00000093 of "Electricity Customer Onboarding" version 1.0.0 started at 2026-11-18T09:00:00.000Z by host and completed at 2026-12-04T11:15:57.000Z. | run 00000093 #1, #134 |
| Run 000000f7 of "Grid Export Registration" version 1.0.0, a child run of run 00000093 at depth 1, started at 2026-11-19T06:06:02.000Z by host and completed at 2026-11-19T11:14:12.000Z. | run 000000f7 #1, #57 |
| Run 00000178 of "Electricity Customer Onboarding" version 1.0.0 started at 2026-12-05T09:00:00.000Z by host and completed at 2026-12-18T21:12:12.000Z. | run 00000178 #1, #130 |
| Run 000001db of "Grid Export Registration" version 1.0.0, a child run of run 00000178 at depth 1, started at 2026-12-06T13:06:07.000Z by host and completed at 2026-12-06T13:10:27.000Z. | run 000001db #1, #31 |
| Run 0000023b of "Electricity Customer Onboarding" version 1.0.0 started at 2026-12-19T09:00:00.000Z by host and completed at 2027-01-18T22:31:57.000Z. | run 0000023b #1, #138 |
| Run 0000029f of "Grid Export Registration" version 1.0.0, a child run of run 0000023b at depth 1, started at 2027-01-02T19:06:02.000Z by host and completed at 2027-01-02T22:30:12.000Z. | run 0000029f #1, #36 |
| Run 00000308 of "Electricity Customer Onboarding" version 1.0.0 started at 2027-01-19T09:00:00.000Z by host and completed at 2027-02-11T19:11:47.000Z. | run 00000308 #1, #150 |
| Run 000003ba of "Electricity Customer Onboarding" version 1.0.0 started at 2027-02-12T09:00:00.000Z by host and completed at 2027-02-27T19:07:57.000Z. | run 000003ba #1, #131 |
| Run 00000457 of "Electricity Customer Onboarding" version 1.0.0 started at 2027-02-28T09:00:00.000Z by host and completed at 2027-02-28T13:05:02.000Z. | run 00000457 #1, #62 |
| Run 000004a3 of "Electricity Customer Onboarding" version 1.0.0 started at 2027-03-01T09:00:00.000Z by host and failed at 2027-03-24T03:07:07.000Z. | run 000004a3 #1, #111 |
| Journey "New Customer Onboarding" of subject APP-24001 started at 2026-11-03T09:00:00.000Z and was completed at 2026-11-17T16:07:47.000Z. | journey 00000002 #1, #36 |
| Journey "New Customer Onboarding" of subject APP-24002 started at 2026-11-18T09:00:00.000Z and was completed at 2026-12-04T11:15:57.000Z. | journey 00000092 #1, #41 |
| Journey "New Customer Onboarding" of subject APP-24003 started at 2026-12-05T09:00:00.000Z and was completed at 2026-12-18T21:12:12.000Z. | journey 00000177 #1, #42 |
| Journey "New Customer Onboarding" of subject APP-24004 started at 2026-12-19T09:00:00.000Z and was completed at 2027-01-18T22:31:57.000Z. | journey 0000023a #1, #44 |
| Journey "New Customer Onboarding" of subject APP-24005 started at 2027-01-19T09:00:00.000Z and was completed at 2027-02-11T19:11:47.000Z. | journey 00000307 #1, #38 |
| Journey "New Customer Onboarding" of subject APP-24006 started at 2027-02-12T09:00:00.000Z and was completed at 2027-02-27T19:07:57.000Z. | journey 000003b9 #1, #36 |
| Journey "New Customer Onboarding" of subject APP-24007 started at 2027-02-28T09:00:00.000Z and was abandoned at 2027-02-28T13:05:02.000Z. | journey 00000456 #1, #13 |
| Journey "New Customer Onboarding" of subject APP-24008 started at 2027-03-01T09:00:00.000Z and was in progress when recorded. | journey 000004a2 #1 |
| gabriel was allowed the action approve at "Grid operator approval, two engineers" in run 0000029f by rule grid-engineers-decide-exports (approval 1 of 2). | run 0000029f #23 |
| hana was allowed the action approve at "Grid operator approval, two engineers" in run 0000029f by rule grid-engineers-decide-exports (approval 2 of 2). | run 0000029f #25 |

## 2. Models and what they decided

*Which models, as named by their providers, served which activities and decisions, and where did a route fall back?*

Can serve as evidence for: EU AI Act Art. 12(2), Art. 13(3)(b); NIST AI RMF MAP, MEASURE; ISO/IEC 42001 Annex A.6.

- models: scripted:balanced-model, scripted:fast-model, scripted:reasoning-model
- selections: 29
- routes: 0
- model decisions: 1

| Statement | Records |
|---|---|
| scripted:balanced-model served "Recommend plan" 7 times, requested as tier:balanced. | run 00000003 #67; run 00000093 #71; run 00000178 #71; run 0000023b #67; run 00000308 #98; run 000003ba #75; run 000004a3 #65 |
| scripted:balanced-model served "Write decline letter" 1 time, requested as tier:balanced. | run 00000457 #54 |
| scripted:balanced-model served "Write welcome pack" 6 times, requested as tier:balanced. | run 00000003 #103; run 00000093 #119; run 00000178 #115; run 0000023b #122; run 00000308 #134; run 000003ba #116 |
| scripted:fast-model served "Electricity source" 1 time, requested as tier:fast. | run 00000178 #53 |
| scripted:fast-model served "Send document reminder" 1 time, requested as tier:fast. | run 00000308 #25 |
| scripted:reasoning-model served "Verify documents" 9 times, requested as tier:reasoning. | run 00000003 #29; run 00000093 #29; run 00000178 #29; run 0000023b #29; run 00000308 #42, #54; run 000003ba #29; run 00000457 #29; run 000004a3 #29 |
| scripted:reasoning-model served "Verify installation documents" 4 times, requested as tier:reasoning. | run 000000f7 #14, #29; run 000001db #13; run 0000029f #13 |
| A model decided "Electricity source" in run 00000178: option renewable_100 with a stated confidence of 0.86. | run 00000178 #55 |

## 3. Human oversight

*Who decided what, how many people approved, what was escalated to them, where did a person decide in place of an automated outcome, where were duties kept apart, and which runs were stopped?*

Can serve as evidence for: EU AI Act Art. 12(3)(d), Art. 13(3)(d), Art. 14(4), Art. 14(5), Art. 26(2); NIST AI RMF GOVERN, MANAGE; ISO/IEC 42001 Annex A.3, Annex A.9.

- human decisions: 6
- overrides: 2
- escalations: 2
- guardrail escalations: 0
- four eyes: 1
- separation of duties: 2
- cancellations: 0

| Statement | Records |
|---|---|
| A person decided "Verify installation documents" in run 000000f7 at 2026-11-19T08:14:02.000Z (hana), in place of an outcome that was rejected and escalated to them, after a wait of 2.0 h. | run 000000f7 #33, #35, #37, #38, #39 |
| A person decided "Grid operator approval" in run 000000f7 at 2026-11-19T11:14:02.000Z (gabriel), after a wait of 3.0 h. | run 000000f7 #44, #47, #48, #49 |
| A person decided "Confirm plan by phone" in run 0000023b at 2027-01-02T19:06:02.000Z (marco), after a wait of 3.0 h. | run 0000023b #77, #79, #80, #81 |
| A person decided "Grid operator approval, two engineers" in run 0000029f at 2027-01-02T22:30:02.000Z (hana), approved by gabriel and hana (2 distinct approvers of 2 required), after a wait of 3.3 h. | run 0000029f #21, #23, #25, #26, #27, #28 |
| A person decided "Verify documents" in run 00000308 at 2027-01-28T13:07:50.000Z (marco), in place of an outcome that was rejected and escalated to them, after a wait of 3.0 h. | run 00000308 #58, #60, #62, #63, #65 |
| A person decided "Credit referral" in run 000003ba at 2027-02-12T16:04:02.000Z (olivia), after a wait of 3.0 h. | run 000003ba #52, #55, #56, #57 |
| "Verify installation documents" in run 000000f7 was escalated to a person (CONTRACT_VIOLATION): Outcome contract violated: Every installation document is legible: "unreadable_count == 0" does not hold; Sure enough to act on: "confidence >= 0.75" does not hold | run 000000f7 #33 |
| "Verify documents" in run 00000308 was escalated to a person (CONTRACT_VIOLATION): Outcome contract violated: Every document is legible: "unreadable_count == 0" does not hold; Sure enough to act on: "confidence >= 0.75" does not hold | run 00000308 #58 |
| hana was refused the action complete_task at "Grid operator approval" in run 000000f7: the separation of duties who-resolves-the-installation-file-does-not-approve-it keeps this apart from what they did in the run. | run 000000f7 #46 |
| gabriel was refused the action approve at "Grid operator approval, two engineers" in run 0000029f: under the four-eyes rule two-engineers-above-the-threshold, each approval must come from another person. | run 0000029f #24 |

## 4. Outcome contracts and verification

*Which outcomes were checked against their contracts and verified, and with what result?*

Can serve as evidence for: EU AI Act Art. 13(3)(b), Art. 15(1), Art. 15(3); NIST AI RMF MEASURE; ISO/IEC 42001 Clause 9.1.

- contracts: 37
- contracts passed: 33
- verifications: 0
- verifications passed: 0

| Statement | Records |
|---|---|
| The outcome contract of "Verify documents" held at attempt 1 of run 00000003. | run 00000003 #31 |
| The outcome contract of "Recommend plan" held at attempt 1 of run 00000003. | run 00000003 #69 |
| The outcome contract of "Write welcome pack" held at attempt 1 of run 00000003. | run 00000003 #106 |
| The outcome contract of "Verify documents" held at attempt 1 of run 00000093. | run 00000093 #31 |
| The outcome contract of "Recommend plan" held at attempt 1 of run 00000093. | run 00000093 #73 |
| The outcome contract of "Register grid export" held at attempt 1 of run 00000093. | run 00000093 #89 |
| The outcome contract of "Write welcome pack" held at attempt 1 of run 00000093. | run 00000093 #121 |
| The outcome contract of "Verify installation documents" was violated (Every installation document is legible; Sure enough to act on) at attempt 1 of run 000000f7. | run 000000f7 #16 |
| The outcome contract of "Verify installation documents" was violated (Every installation document is legible; Sure enough to act on) at attempt 2 of run 000000f7. | run 000000f7 #31 |
| The outcome contract of "Verify installation documents" held at attempt ? of run 000000f7; the outcome was a person's. | run 000000f7 #38 |
| The outcome contract of "Grid operator approval" held at attempt ? of run 000000f7; the outcome was a person's. | run 000000f7 #48 |
| The outcome contract of "Verify documents" held at attempt 1 of run 00000178. | run 00000178 #31 |
| The outcome contract of "Recommend plan" held at attempt 1 of run 00000178. | run 00000178 #73 |
| The outcome contract of "Register grid export" held at attempt 1 of run 00000178. | run 00000178 #85 |
| The outcome contract of "Write welcome pack" held at attempt 1 of run 00000178. | run 00000178 #117 |
| The outcome contract of "Verify installation documents" held at attempt 1 of run 000001db. | run 000001db #15 |
| The outcome contract of "Verify documents" held at attempt 1 of run 0000023b. | run 0000023b #31 |
| The outcome contract of "Recommend plan" held at attempt 1 of run 0000023b. | run 0000023b #69 |
| The outcome contract of "Confirm plan by phone" held at attempt ? of run 0000023b; the outcome was a person's. | run 0000023b #80 |
| The outcome contract of "Register grid export" held at attempt 1 of run 0000023b. | run 0000023b #92 |
| The outcome contract of "Write welcome pack" held at attempt 1 of run 0000023b. | run 0000023b #124 |
| The outcome contract of "Verify installation documents" held at attempt 1 of run 0000029f. | run 0000029f #15 |
| The outcome contract of "Grid operator approval, two engineers" held at attempt ? of run 0000029f; the outcome was a person's. | run 0000029f #27 |
| The outcome contract of "Send document reminder" held at attempt 1 of run 00000308. | run 00000308 #27 |
| The outcome contract of "Verify documents" was violated (Every document is legible; Sure enough to act on) at attempt 1 of run 00000308. | run 00000308 #44 |
| The outcome contract of "Verify documents" was violated (Every document is legible; Sure enough to act on) at attempt 2 of run 00000308. | run 00000308 #56 |
| The outcome contract of "Verify documents" held at attempt ? of run 00000308; the outcome was a person's. | run 00000308 #63 |
| The outcome contract of "Recommend plan" held at attempt 1 of run 00000308. | run 00000308 #100 |
| The outcome contract of "Write welcome pack" held at attempt 1 of run 00000308. | run 00000308 #136 |
| The outcome contract of "Verify documents" held at attempt 1 of run 000003ba. | run 000003ba #31 |
| The outcome contract of "Credit referral" held at attempt ? of run 000003ba; the outcome was a person's. | run 000003ba #56 |
| The outcome contract of "Recommend plan" held at attempt 1 of run 000003ba. | run 000003ba #77 |
| The outcome contract of "Write welcome pack" held at attempt 1 of run 000003ba. | run 000003ba #118 |
| The outcome contract of "Verify documents" held at attempt 1 of run 00000457. | run 00000457 #31 |
| The outcome contract of "Write decline letter" held at attempt 1 of run 00000457. | run 00000457 #56 |
| The outcome contract of "Verify documents" held at attempt 1 of run 000004a3. | run 000004a3 #31 |
| The outcome contract of "Recommend plan" held at attempt 1 of run 000004a3. | run 000004a3 #67 |

## 5. Refusals

*What did the engine refuse to do before it happened, to whom, and under which rule or guardrail?*

Can serve as evidence for: EU AI Act Art. 12(2), Art. 15(4), Art. 15(5); NIST AI RMF GOVERN, MANAGE; ISO/IEC 42001 Annex A.6.

- refusals: 5
- tool calls: 0
- context writes: 0
- authorization: 3
- guardrails: 2
- by code: none
- authorization by reason: four_eyes 1, no_rule 1, separation_of_duties 1

| Statement | Records |
|---|---|
| hana (person) was refused the action complete_task at "Grid operator approval" in run 000000f7: the separation of duties who-resolves-the-installation-file-does-not-approve-it. | run 000000f7 #46 |
| gabriel (person) was refused the action approve at "Grid operator approval, two engineers" in run 0000029f: the four-eyes rule two-engineers-above-the-threshold. | run 0000029f #24 |
| marco (person) was refused the action complete_task at "Credit referral" in run 000003ba: no rule allows it. | run 000003ba #54 |
| Guardrail "Instructions inside uploaded documents" (prompt_injection) found ignore_instructions (1 finding) in the result of extract_document by "Verify installation documents" at attempt 1 in run 000000f7, and blocked it. | run 000000f7 #10 |
| Guardrail "Instructions inside uploaded documents" (prompt_injection) found ignore_instructions (1 finding) in the result of extract_document by "Verify installation documents" at attempt 2 in run 000000f7, and blocked it. | run 000000f7 #25 |

## 6. Failures

*Which attempts, tool calls, runs and journeys failed or stalled, and why?*

Can serve as evidence for: EU AI Act Art. 12(2), Art. 15(4), Art. 26(5); NIST AI RMF MANAGE; ISO/IEC 42001 Annex A.6.

- attempts failed: 4
- dead letters: 0
- tool failures: 2
- runs failed: 1
- journeys stalled: 2

| Statement | Records |
|---|---|
| Attempt 1 of "Verify installation documents" in run 000000f7 failed (CONTRACT_VIOLATION): Outcome contract violated: Every installation document is legible: "unreadable_count == 0" does not hold; Sure enough to act on: "confidence >= 0.75" does not hold | run 000000f7 #17 |
| Attempt 2 of "Verify installation documents" in run 000000f7 failed (CONTRACT_VIOLATION): Outcome contract violated: Every installation document is legible: "unreadable_count == 0" does not hold; Sure enough to act on: "confidence >= 0.75" does not hold | run 000000f7 #32 |
| Attempt 1 of "Verify documents" in run 00000308 failed (CONTRACT_VIOLATION): Outcome contract violated: Every document is legible: "unreadable_count == 0" does not hold; Sure enough to act on: "confidence >= 0.75" does not hold | run 00000308 #45 |
| Attempt 2 of "Verify documents" in run 00000308 failed (CONTRACT_VIOLATION): Outcome contract violated: Every document is legible: "unreadable_count == 0" does not hold; Sure enough to act on: "confidence >= 0.75" does not hold | run 00000308 #57 |
| A call to extract_document at "Verify installation documents" in run 000000f7 failed (GUARDRAIL_BLOCKED). | run 000000f7 #11 |
| A call to extract_document at "Verify installation documents" in run 000000f7 failed (GUARDRAIL_BLOCKED). | run 000000f7 #26 |
| Run 000004a3 failed. | run 000004a3 #111 |
| The journey "New Customer Onboarding" of subject APP-24004 stalled in stage energy-choices. | journey 0000023a #15 |
| The journey "New Customer Onboarding" of subject APP-24008 stalled in stage switch: the Electricity Customer Onboarding workflow failed. | journey 000004a2 #27 |

## 7. Compensations

*Which completed work was undone after a failure, and did undoing it succeed?*

Can serve as evidence for: EU AI Act Art. 15(4); NIST AI RMF MANAGE.

- compensations: 2
- failed: 0

| Statement | Records |
|---|---|
| "Collect deposit" in run 000004a3 was undone by "Refund deposit". | run 000004a3 #106 |
| "Set up account and direct debit" in run 000004a3 was undone by "Cancel account and mandate". | run 000004a3 #109 |

## 8. Service levels

*Where did work take longer than was promised?*

Can serve as evidence for: EU AI Act Art. 12(2), Art. 26(5); NIST AI RMF MEASURE, MANAGE.

- warnings: 3
- breaches: 1

| Statement | Records |
|---|---|
| Run 0000023b passed its point of warning after 30.6 days (limit P21D). | run 0000023b #137 |
| "Verify documents" in run 00000308 breached its service level after 3.1 h (limit PT2H). | run 00000308 #64 |
| Run 00000308 passed its point of warning after 23.4 days (limit P21D). | run 00000308 #149 |
| Run 000004a3 passed its point of warning after 22.8 days (limit P21D). | run 000004a3 #110 |

## 9. Tool calls by target

*Which outside systems were called, how often, and with what result?*

Can serve as evidence for: EU AI Act Art. 12(2), Art. 26(5); NIST AI RMF MAP; ISO/IEC 42001 Annex A.10.

- targets: 32
- calls: 147
- completed: 145
- failed: 2
- refused: 0

| Statement | Records |
|---|---|
| http://localhost:4545/billing/rpc#billing.cancel_account: 1 call by cancel_billing_account; 1 completed, 0 failed, 0 refused. | run 000004a3 #107, #108 |
| http://localhost:4545/billing/rpc#billing.collect_deposit: 2 calls by collect_deposit; 2 completed, 0 failed, 0 refused. | run 000003ba #101, #102; run 000004a3 #91, #92 |
| http://localhost:4545/billing/rpc#billing.create_account: 7 calls by create_billing_account; 7 completed, 0 failed, 0 refused. | run 00000003 #88, #89; run 00000093 #104, #105; run 00000178 #100, #101; run 0000023b #107, #108; run 00000308 #119, #120; run 000003ba #96, #97; run 000004a3 #86, #87 |
| http://localhost:4545/billing/rpc#billing.refund_deposit: 1 call by refund_deposit; 1 completed, 0 failed, 0 refused. | run 000004a3 #104, #105 |
| http://localhost:4545/contracts/v1/contracts: 7 calls by generate_contract; 7 completed, 0 failed, 0 refused. | run 00000003 #79, #80; run 00000093 #95, #96; run 00000178 #91, #92; run 0000023b #98, #99; run 00000308 #110, #111; run 000003ba #87, #88; run 000004a3 #77, #78 |
| http://localhost:4545/credit/v1/checks: 8 calls by check_credit; 8 completed, 0 failed, 0 refused. | run 00000003 #39, #41; run 00000093 #39, #41; run 00000178 #39, #41; run 0000023b #39, #41; run 00000308 #72, #74; run 000003ba #39, #41; run 00000457 #39, #41; run 000004a3 #39, #41 |
| http://localhost:4545/crm/v1/customers: 8 calls by register_customer; 8 completed, 0 failed, 0 refused. | run 00000003 #5, #6; run 00000093 #5, #6; run 00000178 #5, #6; run 0000023b #5, #6; run 00000308 #5, #6; run 000003ba #5, #6; run 00000457 #5, #6; run 000004a3 #5, #6 |
| http://localhost:4545/crm/v1/customers/C-24001/activation: 1 call by activate_customer; 1 completed, 0 failed, 0 refused. | run 00000003 #110, #111 |
| http://localhost:4545/crm/v1/customers/C-24002/activation: 1 call by activate_customer; 1 completed, 0 failed, 0 refused. | run 00000093 #125, #126 |
| http://localhost:4545/crm/v1/customers/C-24003/activation: 1 call by activate_customer; 1 completed, 0 failed, 0 refused. | run 00000178 #121, #122 |
| http://localhost:4545/crm/v1/customers/C-24004/activation: 1 call by activate_customer; 1 completed, 0 failed, 0 refused. | run 0000023b #128, #129 |
| http://localhost:4545/crm/v1/customers/C-24005/activation: 1 call by activate_customer; 1 completed, 0 failed, 0 refused. | run 00000308 #140, #141 |
| http://localhost:4545/crm/v1/customers/C-24006/activation: 1 call by activate_customer; 1 completed, 0 failed, 0 refused. | run 000003ba #122, #123 |
| http://localhost:4545/documents/v1/extractions: 43 calls by extract_document; 41 completed, 2 failed, 0 refused. | run 00000003 #23, #24, #25, #26, #27, #28; run 00000093 #23, #24, #25, #26, #27, #28; run 000000f7 #5, #6, #7, #8, #9, #11, #12, #13, #20, #21, #22, #23, #24, #26, #27, #28; run 00000178 #23, #24, #25, #26, #27, #28; run 000001db #5, #6, #7, #8, #9, #10, #11, #12; run 0000023b #23, #24, #25, #26, #27, #28; run 0000029f #5, #6, #7, #8, #9, #10, #11, #12; run 00000308 #36, #37, #38, #39, #40, #41, #48, #49, #50, #51, #52, #53; run 000003ba #23, #24, #25, #26, #27, #28; run 00000457 #23, #24, #25, #26, #27, #28; run 000004a3 #23, #24, #25, #26, #27, #28 |
| http://localhost:4545/grid/v1/notifications: 1 call by notify_grid_operator; 1 completed, 0 failed, 0 refused. | run 000001db #21, #22 |
| http://localhost:4545/meter-data/rpc#meterdata.register_export: 3 calls by register_export; 3 completed, 0 failed, 0 refused. | run 000000f7 #52, #53; run 000001db #26, #27; run 0000029f #31, #32 |
| http://localhost:4545/notifications/v1/messages: 16 calls by send_message; 16 completed, 0 failed, 0 refused. | run 00000003 #13, #14, #112, #113; run 00000093 #13, #14, #127, #128; run 00000178 #13, #14, #123, #124; run 0000023b #13, #14, #130, #131; run 00000308 #13, #14, #23, #24, #142, #143; run 000003ba #13, #14, #124, #125; run 00000457 #13, #14, #52, #53; run 000004a3 #13, #14 |
| http://localhost:4545/registry/v1/metering-points/MP-18250-007741: 1 call by lookup_metering_point; 1 completed, 0 failed, 0 refused. | run 000004a3 #40, #42 |
| http://localhost:4545/registry/v1/metering-points/MP-22740-001876: 1 call by lookup_metering_point; 1 completed, 0 failed, 0 refused. | run 000003ba #40, #42 |
| http://localhost:4545/registry/v1/metering-points/MP-22745-000322: 1 call by lookup_metering_point; 1 completed, 0 failed, 0 refused. | run 00000457 #40, #42 |
| http://localhost:4545/registry/v1/metering-points/MP-30115-004410: 1 call by lookup_metering_point; 1 completed, 0 failed, 0 refused. | run 00000308 #73, #75 |
| http://localhost:4545/registry/v1/metering-points/MP-40217-000141: 1 call by lookup_metering_point; 1 completed, 0 failed, 0 refused. | run 00000003 #40, #42 |
| http://localhost:4545/registry/v1/metering-points/MP-41893-002207: 1 call by lookup_metering_point; 1 completed, 0 failed, 0 refused. | run 00000093 #40, #42 |
| http://localhost:4545/registry/v1/metering-points/MP-52011-000913: 1 call by lookup_metering_point; 1 completed, 0 failed, 0 refused. | run 00000178 #40, #42 |
| http://localhost:4545/registry/v1/metering-points/MP-63320-000058: 1 call by lookup_metering_point; 1 completed, 0 failed, 0 refused. | run 0000023b #40, #42 |
| http://localhost:4545/registry/v1/switches: 7 calls by request_switch; 7 completed, 0 failed, 0 refused. | run 00000003 #93, #94; run 00000093 #109, #110; run 00000178 #105, #106; run 0000023b #112, #113; run 00000308 #124, #125; run 000003ba #106, #107; run 000004a3 #96, #97 |
| http://localhost:4545/tariffs/v1/plans/ev/estimate: 1 call by estimate_annual_cost; 1 completed, 0 failed, 0 refused. | run 00000093 #67, #68 |
| http://localhost:4545/tariffs/v1/plans/fixed_12/estimate: 7 calls by estimate_annual_cost; 7 completed, 0 failed, 0 refused. | run 00000003 #59, #60; run 00000093 #59, #60; run 00000178 #61, #62; run 0000023b #59, #60; run 00000308 #92, #93; run 000003ba #67, #68; run 000004a3 #59, #60 |
| http://localhost:4545/tariffs/v1/plans/fixed_24/estimate: 6 calls by estimate_annual_cost; 6 completed, 0 failed, 0 refused. | run 00000003 #61, #62; run 00000093 #61, #62; run 00000178 #63, #64; run 0000023b #61, #62; run 00000308 #94, #95; run 000003ba #69, #70 |
| http://localhost:4545/tariffs/v1/plans/prosumer/estimate: 3 calls by estimate_annual_cost; 3 completed, 0 failed, 0 refused. | run 00000093 #69, #70; run 00000178 #69, #70; run 0000023b #65, #66 |
| http://localhost:4545/tariffs/v1/plans/time_of_use/estimate: 5 calls by estimate_annual_cost; 5 completed, 0 failed, 0 refused. | run 00000003 #65, #66; run 00000093 #65, #66; run 00000178 #67, #68; run 000003ba #73, #74; run 000004a3 #63, #64 |
| http://localhost:4545/tariffs/v1/plans/variable/estimate: 7 calls by estimate_annual_cost; 7 completed, 0 failed, 0 refused. | run 00000003 #63, #64; run 00000093 #63, #64; run 00000178 #65, #66; run 0000023b #63, #64; run 00000308 #96, #97; run 000003ba #71, #72; run 000004a3 #61, #62 |

## 10. Data handled

*How were inputs, outputs, tool arguments and results journalled, and which shared contexts were read and written?*

Can serve as evidence for: EU AI Act Art. 12(1), Art. 26(6); NIST AI RMF GOVERN; ISO/IEC 42001 Annex A.7.

- runs by mode: full 11, hash 0, none 0, mixed 0
- payloads: full 503, hash 0, none 0

| Statement | Records |
|---|---|
| Run 00000003 journalled its 55 payload(s) in full. | run 00000003 #1, #4, #5, #6, #8, #12, #13, #14, #15, #22, #23, #24, #25, #26, #27, #28, #32, #37, #38, #39, #40, #41, #42, #43, #45, #58, #59, #60, #61, #62, #63, #64, #65, #66, #70, #78, #79, #80, #81, #87, #88, #89, #90, #92, #93, #94, #95, #102, #107, #109, #110, #111, #112, #113, #114 |
| Run 00000093 journalled its 62 payload(s) in full. | run 00000093 #1, #4, #5, #6, #8, #12, #13, #14, #15, #22, #23, #24, #25, #26, #27, #28, #32, #37, #38, #39, #40, #41, #42, #43, #45, #58, #59, #60, #61, #62, #63, #64, #65, #66, #67, #68, #69, #70, #74, #82, #87, #90, #94, #95, #96, #97, #103, #104, #105, #106, #108, #109, #110, #111, #118, #122, #124, #125, #126, #127, #128, #129 |
| Run 000000f7 journalled its 24 payload(s) in full. | run 000000f7 #1, #4, #5, #6, #7, #8, #9, #12, #13, #19, #20, #21, #22, #23, #24, #27, #28, #39, #43, #49, #51, #52, #53, #54 |
| Run 00000178 journalled its 59 payload(s) in full. | run 00000178 #1, #4, #5, #6, #8, #12, #13, #14, #15, #22, #23, #24, #25, #26, #27, #28, #32, #37, #38, #39, #40, #41, #42, #43, #45, #60, #61, #62, #63, #64, #65, #66, #67, #68, #69, #70, #74, #82, #86, #90, #91, #92, #93, #99, #100, #101, #102, #104, #105, #106, #107, #114, #118, #120, #121, #122, #123, #124, #125 |
| Run 000001db journalled its 19 payload(s) in full. | run 000001db #1, #4, #5, #6, #7, #8, #9, #10, #11, #12, #16, #20, #21, #22, #23, #25, #26, #27, #28 |
| Run 0000023b journalled its 60 payload(s) in full. | run 0000023b #1, #4, #5, #6, #8, #12, #13, #14, #15, #22, #23, #24, #25, #26, #27, #28, #32, #37, #38, #39, #40, #41, #42, #43, #45, #58, #59, #60, #61, #62, #63, #64, #65, #66, #70, #76, #81, #85, #90, #93, #97, #98, #99, #100, #106, #107, #108, #109, #111, #112, #113, #114, #121, #125, #127, #128, #129, #130, #131, #132 |
| Run 0000029f journalled its 17 payload(s) in full. | run 0000029f #1, #4, #5, #6, #7, #8, #9, #10, #11, #12, #16, #20, #28, #30, #31, #32, #33 |
| Run 00000308 journalled its 64 payload(s) in full. | run 00000308 #1, #4, #5, #6, #8, #12, #13, #14, #15, #22, #23, #24, #28, #35, #36, #37, #38, #39, #40, #41, #47, #48, #49, #50, #51, #52, #53, #65, #70, #71, #72, #73, #74, #75, #76, #78, #91, #92, #93, #94, #95, #96, #97, #101, #109, #110, #111, #112, #118, #119, #120, #121, #123, #124, #125, #126, #133, #137, #139, #140, #141, #142, #143, #144 |
| Run 000003ba journalled its 61 payload(s) in full. | run 000003ba #1, #4, #5, #6, #8, #12, #13, #14, #15, #22, #23, #24, #25, #26, #27, #28, #32, #37, #38, #39, #40, #41, #42, #43, #45, #51, #57, #66, #67, #68, #69, #70, #71, #72, #73, #74, #78, #86, #87, #88, #89, #95, #96, #97, #98, #100, #101, #102, #103, #105, #106, #107, #108, #115, #119, #121, #122, #123, #124, #125, #126 |
| Run 00000457 journalled its 29 payload(s) in full. | run 00000457 #1, #4, #5, #6, #8, #12, #13, #14, #15, #22, #23, #24, #25, #26, #27, #28, #32, #37, #38, #39, #40, #41, #42, #43, #45, #51, #52, #53, #57 |
| Run 000004a3 journalled its 53 payload(s) in full. | run 000004a3 #1, #4, #5, #6, #8, #12, #13, #14, #15, #22, #23, #24, #25, #26, #27, #28, #32, #37, #38, #39, #40, #41, #42, #43, #45, #58, #59, #60, #61, #62, #63, #64, #68, #76, #77, #78, #79, #85, #86, #87, #88, #90, #91, #92, #93, #95, #96, #97, #98, #104, #105, #107, #108 |
| The context "customer_profile" was given to activities 22 time(s), written 8 time(s) and refused 0 write(s); the journal holds hashes of its values, not the values. | run 00000003 #7, #21, #57, #101; run 00000093 #7, #21, #57, #117; run 00000178 #7, #21, #59, #113; run 0000023b #7, #21, #57, #120; run 00000308 #7, #21, #34, #90, #132; run 000003ba #7, #21, #65, #114; run 00000457 #7, #21; run 000004a3 #7, #21, #57 |

## 11. The records themselves

*Which records does this report rest on, over what span, and are they complete?*

Can serve as evidence for: EU AI Act Art. 12(1), Art. 13(3)(f), Art. 26(6); NIST AI RMF GOVERN; ISO/IEC 42001 Annex A.6.

- runs: 11
- child runs: 3
- events: 1099
- journey instances: 8
- journey events: 279
- oldest record: 2026-11-03T09:00:00.000Z
- newest record: 2027-03-24T03:07:07.000Z
- held for ms: 12161227000
- runs with gaps: 0

| Statement | Records |
|---|---|
| The report rests on 1099 journal record(s) of 11 run(s), 3 of them child runs, and 279 record(s) of 8 journey(s), from 2026-11-03T09:00:00.000Z to 2027-03-24T03:07:07.000Z. | run 00000003 #1, #2, #3, #4; run 000004a3 #107, #108, #109, #110, #111; journey 00000002 #1, #2, #3, #4, #5; journey 000004a2 #26, #27, #28, #29 |

## 12. Guardrails

*What did the guardrails find in what reached and left the agents and tools, at which stage, and what did they do about it?*

Can serve as evidence for: EU AI Act Art. 12(2), Art. 14(4), Art. 15(4), Art. 15(5); NIST AI RMF MEASURE, MANAGE; ISO/IEC 42001 Annex A.6, Annex A.7.

- triggered: 3
- guardrails: 2
- failed closed: 0
- by action: block 2, redact 1, retry_with_feedback 0, escalate 0, warn 0
- by stage: input 0, output 1, tool_call 0, tool_result 2
- by check: personal_data 1, prompt_injection 2
- by category: ignore_instructions 2, phone 1

| Statement | Records |
|---|---|
| Guardrail "No bank or phone numbers in the welcome message" (personal_data) found phone (1 finding) in the output of "Write welcome pack" at attempt 1 in run 00000003, and redacted what it found. | run 00000003 #105 |
| Guardrail "Instructions inside uploaded documents" (prompt_injection) found ignore_instructions (1 finding) in the result of extract_document by "Verify installation documents" at attempt 1 in run 000000f7, and blocked it. | run 000000f7 #10 |
| Guardrail "Instructions inside uploaded documents" (prompt_injection) found ignore_instructions (1 finding) in the result of extract_document by "Verify installation documents" at attempt 2 in run 000000f7, and blocked it. | run 000000f7 #25 |

## The frameworks named

**Regulation (EU) 2024/1689 (AI Act)**

- Art. 12(1): Record-keeping: automatic recording of events over the lifetime of the system
- Art. 12(2): Logging that enables identifying situations of risk, post-market monitoring and monitoring of operation
- Art. 12(3)(d): For the systems of Annex III point 1(a): logging that identifies the natural persons involved in verifying the results
- Art. 13(3)(b): Information to deployers on characteristics, capabilities and limitations of performance, including accuracy
- Art. 13(3)(d): Information to deployers on the human oversight measures
- Art. 13(3)(f): Information to deployers on how to collect, store and interpret the logs
- Art. 14(4): Human oversight: monitoring, interpreting, disregarding, overriding or reversing outputs, and interrupting the system
- Art. 14(5): For the systems of Annex III point 1(a): no action on a result unless separately verified and confirmed by at least two natural persons
- Art. 15(1): An appropriate level of accuracy and robustness
- Art. 15(3): Levels of accuracy and the relevant metrics
- Art. 15(4): Resilience to errors, faults and inconsistencies; fail-safe plans
- Art. 15(5): Cybersecurity: resilience against attempts by unauthorised third parties to alter use, outputs or performance, inputs designed to manipulate the model included
- Art. 26(2): Deployers assign human oversight to persons with the competence and authority
- Art. 26(5): Deployers monitor the operation of the system
- Art. 26(6): Deployers keep the automatically generated logs under their control for an appropriate period of at least six months, unless other law provides otherwise

**NIST AI Risk Management Framework 1.0 (NIST AI 100-1)**

- GOVERN: Policies, accountability and human oversight
- MAP: Context, and dependencies on third parties
- MEASURE: Measuring and monitoring trustworthiness, in production included
- MANAGE: Responding to and recovering from errors and incidents

**ISO/IEC 42001:2023 (AI management system)**

- Clause 9.1: Monitoring, measurement, analysis and evaluation
- Annex A.3: Internal organization: roles and responsibilities for AI
- Annex A.6: AI system life cycle, event logs included
- Annex A.7: Data for AI systems
- Annex A.9: Use of AI systems
- Annex A.10: Third-party and customer relationships

The mapping from parts to provisions says which obligations a record is relevant to. It does not say that an obligation is met.
