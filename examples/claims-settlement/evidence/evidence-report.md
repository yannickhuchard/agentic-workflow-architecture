# Evidence report

As of 2026-11-26T09:00:00.000Z. Period: 2026-11-02T09:00:00.750Z to 2026-11-04T11:20:58.475Z.

> This report is evidence computed from the execution journals and journey records listed in it. Every statement cites the records it rests on. It is not a certification, an audit opinion or a conformity assessment: it does not establish that any system, deployer or provider complies with the EU AI Act, the NIST AI RMF, ISO/IEC 42001 or any other framework. Whether these records meet an obligation depends on the system, its intended purpose, its risk classification and the applicable law, which this report does not assess.

## Scope

| Workflow | Versions | Runs | Of which child runs |
|---|---|---|---|
| Motor Claim Settlement | 1.0.0 | 3 | 0 |

Each statement cites the journal records it rests on: "run 1a2b3c4d #5" is the record with sequence number 5 in the journal of the run whose id begins 1a2b3c4d.

## 1. What ran

*Which runs and journeys took place in the period, with which workflow versions, and how did each end?*

Can serve as evidence for: EU AI Act Art. 12(1), Art. 12(2), Art. 26(5); NIST AI RMF MEASURE; ISO/IEC 42001 Clause 9.1, Annex A.6.

- runs: 3
- completed: 3
- failed: 0
- cancelled: 0
- in progress: 0
- child runs: 0
- journeys: 0
- migrations: 0
- authorizations allowed: 26

| Statement | Records |
|---|---|
| Run 00000001 of "Motor Claim Settlement" version 1.0.0 started at 2026-11-02T09:00:00.750Z by ana and completed at 2026-11-02T09:00:28.225Z. | run 00000001 #1, #58 |
| Run 0000003f of "Motor Claim Settlement" version 1.0.0 started at 2026-11-03T09:00:29.225Z by ana and completed at 2026-11-03T11:20:57.475Z. | run 0000003f #1, #61 |
| Run 00000080 of "Motor Claim Settlement" version 1.0.0 started at 2026-11-04T11:20:58.475Z by ana and completed at 2026-11-04T13:36:19.475Z. | run 00000080 #1, #49 |
| system:claims was allowed the action perform_activity at "Register claim" in run 00000001 by rule agents-and-systems-work. | run 00000001 #4 |
| agent:assessor was allowed the action perform_activity at "Assess damage" in run 00000001 by rule agents-and-systems-work. | run 00000001 #8 |
| agent:fraud was allowed the action perform_activity at "Check fraud signals" in run 00000001 by rule agents-and-systems-work. | run 00000001 #20 |
| system:claims was allowed the action perform_activity at "Verify policy cover" in run 00000001 by rule agents-and-systems-work. | run 00000001 #21 |
| system:claims was allowed the action perform_activity at "Consolidate findings" in run 00000001 by rule agents-and-systems-work. | run 00000001 #34 |
| system:claims was allowed the action perform_activity at "Reserve funds" in run 00000001 by rule agents-and-systems-work. | run 00000001 #40 |
| system:claims was allowed the action perform_activity at "Pay claimant" in run 00000001 by rule agents-and-systems-work. | run 00000001 #47 |
| agent:writer was allowed the action perform_activity at "Notify claimant" in run 00000001 by rule agents-and-systems-work. | run 00000001 #51 |
| system:claims was allowed the action perform_activity at "Register claim" in run 0000003f by rule agents-and-systems-work. | run 0000003f #4 |
| agent:assessor was allowed the action perform_activity at "Assess damage" in run 0000003f by rule agents-and-systems-work. | run 0000003f #8 |
| agent:fraud was allowed the action perform_activity at "Check fraud signals" in run 0000003f by rule agents-and-systems-work. | run 0000003f #16 |
| system:claims was allowed the action perform_activity at "Verify policy cover" in run 0000003f by rule agents-and-systems-work. | run 0000003f #17 |
| system:claims was allowed the action perform_activity at "Consolidate findings" in run 0000003f by rule agents-and-systems-work. | run 0000003f #26 |
| alice was allowed the action approve at "Adjuster review" in run 0000003f by rule adjusters-decide (approval 1 of 2). | run 0000003f #37 |
| bob was allowed the action approve at "Adjuster review" in run 0000003f by rule adjusters-decide (approval 2 of 2). | run 0000003f #39 |
| system:claims was allowed the action perform_activity at "Reserve funds" in run 0000003f by rule agents-and-systems-work. | run 0000003f #43 |
| system:claims was allowed the action perform_activity at "Pay claimant" in run 0000003f by rule agents-and-systems-work. | run 0000003f #50 |
| agent:writer was allowed the action perform_activity at "Notify claimant" in run 0000003f by rule agents-and-systems-work. | run 0000003f #54 |
| system:claims was allowed the action perform_activity at "Register claim" in run 00000080 by rule agents-and-systems-work. | run 00000080 #4 |
| agent:assessor was allowed the action perform_activity at "Assess damage" in run 00000080 by rule agents-and-systems-work. | run 00000080 #8 |
| carol was allowed the action complete_task at "Assess damage" in run 00000080 by rule adjusters-decide. | run 00000080 #13 |
| agent:fraud was allowed the action perform_activity at "Check fraud signals" in run 00000080 by rule agents-and-systems-work. | run 00000080 #20 |
| system:claims was allowed the action perform_activity at "Verify policy cover" in run 00000080 by rule agents-and-systems-work. | run 00000080 #21 |
| carol was allowed the action complete_task at "Check fraud signals" in run 00000080 by rule adjusters-decide. | run 00000080 #29 |
| system:claims was allowed the action perform_activity at "Consolidate findings" in run 00000080 by rule agents-and-systems-work. | run 00000080 #35 |
| bob was allowed the action complete_task at "Investigate" in run 00000080 by rule adjusters-decide. | run 00000080 #44 |

## 2. Models and what they decided

*Which models, as named by their providers, served which activities and decisions, and where did a route fall back?*

Can serve as evidence for: EU AI Act Art. 12(2), Art. 13(3)(b); NIST AI RMF MAP, MEASURE; ISO/IEC 42001 Annex A.6.

- models: none
- selections: 0
- routes: 0
- model decisions: 1

| Statement | Records |
|---|---|
| A model decided "Settlement route" in run 0000003f: option review with a stated confidence of 0.8. | run 0000003f #31 |

## 3. Human oversight

*Who decided what, how many people approved, what was escalated to them, where did a person decide in place of an automated outcome, where were duties kept apart, and which runs were stopped?*

Can serve as evidence for: EU AI Act Art. 12(3)(d), Art. 13(3)(d), Art. 14(4), Art. 14(5), Art. 26(2); NIST AI RMF GOVERN, MANAGE; ISO/IEC 42001 Annex A.3, Annex A.9.

- human decisions: 4
- overrides: 0
- escalations: 0
- guardrail escalations: 2
- four eyes: 1
- separation of duties: 2
- cancellations: 0

| Statement | Records |
|---|---|
| A person decided "Adjuster review" in run 0000003f at 2026-11-03T11:20:47.475Z (bob), approved by alice and bob (2 distinct approvers of 2 required), after a wait of 2.3 h. | run 0000003f #34, #37, #39, #40, #41 |
| A person decided "Assess damage" in run 00000080 at 2026-11-04T12:06:05.225Z (carol), escalated to them by a guardrail at stage input, after a wait of 45 min. | run 00000080 #9, #11, #13, #14, #15, #16 |
| A person decided "Check fraud signals" in run 00000080 at 2026-11-04T12:51:11.975Z (carol), escalated to them by a guardrail at stage input, after a wait of 45 min. | run 00000080 #22, #25, #29, #30, #31, #32 |
| A person decided "Investigate" in run 00000080 at 2026-11-04T13:36:18.475Z (bob), after a wait of 45 min. | run 00000080 #42, #44, #45, #46 |
| Guardrail "Instructions hidden in claim data" (prompt_injection) found ignore_instructions (1 finding) in the input of "Assess damage" in run 00000080, and handed the activity to a person. | run 00000080 #9 |
| Guardrail "Instructions hidden in claim data" (prompt_injection) found ignore_instructions (1 finding) in the input of "Check fraud signals" in run 00000080, and handed the activity to a person. | run 00000080 #22 |
| ana was refused the action approve at "Adjuster review" in run 0000003f: the separation of duties opener-does-not-approve keeps this apart from what they did in the run. | run 0000003f #36 |
| alice was refused the action approve at "Adjuster review" in run 0000003f: under the four-eyes rule two-adjusters-approve, each approval must come from another person. | run 0000003f #38 |

## 4. Outcome contracts and verification

*Which outcomes were checked against their contracts and verified, and with what result?*

Can serve as evidence for: EU AI Act Art. 13(3)(b), Art. 15(1), Art. 15(3); NIST AI RMF MEASURE; ISO/IEC 42001 Clause 9.1.

- contracts: 9
- contracts passed: 8
- verifications: 2
- verifications passed: 2

| Statement | Records |
|---|---|
| The outcome contract of "Assess damage" was violated (/estimated_cost; Within authority) at attempt 1 of run 00000001. | run 00000001 #10 |
| The outcome contract of "Assess damage" held at attempt 2 of run 00000001. | run 00000001 #14 |
| The outcome contract of "Check fraud signals" held at attempt 2 of run 00000001. | run 00000001 #30 |
| The outcome contract of "Notify claimant" held at attempt 1 of run 00000001. | run 00000001 #54 |
| The outcome contract of "Assess damage" held at attempt 1 of run 0000003f. | run 0000003f #10 |
| The outcome contract of "Check fraud signals" held at attempt 1 of run 0000003f. | run 0000003f #22 |
| The outcome contract of "Notify claimant" held at attempt 1 of run 0000003f. | run 0000003f #57 |
| The outcome contract of "Assess damage" held at attempt ? of run 00000080; the outcome was a person's. | run 00000080 #15 |
| The outcome contract of "Check fraud signals" held at attempt ? of run 00000080; the outcome was a person's. | run 00000080 #31 |
| Verification (schema_only) of "Assess damage" at attempt 2 of run 00000001: pass, score 1. | run 00000001 #15 |
| Verification (schema_only) of "Assess damage" at attempt 1 of run 0000003f: pass, score 1. | run 0000003f #11 |

## 5. Refusals

*What did the engine refuse to do before it happened, to whom, and under which rule or guardrail?*

Can serve as evidence for: EU AI Act Art. 12(2), Art. 15(4), Art. 15(5); NIST AI RMF GOVERN, MANAGE; ISO/IEC 42001 Annex A.6.

- refusals: 2
- tool calls: 0
- context writes: 0
- authorization: 2
- guardrails: 0
- by code: none
- authorization by reason: four_eyes 1, separation_of_duties 1

| Statement | Records |
|---|---|
| ana (person) was refused the action approve at "Adjuster review" in run 0000003f: the separation of duties opener-does-not-approve. | run 0000003f #36 |
| alice (person) was refused the action approve at "Adjuster review" in run 0000003f: the four-eyes rule two-adjusters-approve. | run 0000003f #38 |

## 6. Failures

*Which attempts, tool calls, runs and journeys failed or stalled, and why?*

Can serve as evidence for: EU AI Act Art. 12(2), Art. 15(4), Art. 26(5); NIST AI RMF MANAGE; ISO/IEC 42001 Annex A.6.

- attempts failed: 2
- dead letters: 0
- tool failures: 0
- runs failed: 0
- journeys stalled: 0

| Statement | Records |
|---|---|
| Attempt 1 of "Assess damage" in run 00000001 failed (CONTRACT_VIOLATION): Outcome contract violated: /estimated_cost must be number; Within authority: "estimated_cost <= 50000" does not hold | run 00000001 #11 |
| Attempt 1 of "Check fraud signals" in run 00000001 failed (TIMEOUT): Fraud scoring service timed out | run 00000001 #24 |

## 7. Compensations

*Which completed work was undone after a failure, and did undoing it succeed?*

Can serve as evidence for: EU AI Act Art. 15(4); NIST AI RMF MANAGE.

- compensations: 0
- failed: 0

Nothing recorded.

## 8. Service levels

*Where did work take longer than was promised?*

Can serve as evidence for: EU AI Act Art. 12(2), Art. 26(5); NIST AI RMF MEASURE, MANAGE.

- warnings: 0
- breaches: 0

Nothing recorded.

## 9. Tool calls by target

*Which outside systems were called, how often, and with what result?*

Can serve as evidence for: EU AI Act Art. 12(2), Art. 26(5); NIST AI RMF MAP; ISO/IEC 42001 Annex A.10.

- targets: 0
- calls: 0
- completed: 0
- failed: 0
- refused: 0

Nothing recorded.

## 10. Data handled

*How were inputs, outputs, tool arguments and results journalled, and which shared contexts were read and written?*

Can serve as evidence for: EU AI Act Art. 12(1), Art. 26(6); NIST AI RMF GOVERN; ISO/IEC 42001 Annex A.7.

- runs by mode: full 3, hash 0, none 0, mixed 0
- payloads: full 49, hash 0, none 0

| Statement | Records |
|---|---|
| Run 00000001 journalled its 19 payload(s) in full. | run 00000001 #1, #5, #6, #9, #13, #16, #22, #23, #27, #28, #31, #35, #36, #41, #42, #48, #49, #52, #55 |
| Run 0000003f journalled its 19 payload(s) in full. | run 0000003f #1, #5, #6, #9, #12, #18, #19, #20, #23, #27, #28, #33, #41, #44, #45, #51, #52, #55, #58 |
| Run 00000080 journalled its 11 payload(s) in full. | run 00000080 #1, #5, #6, #16, #24, #26, #32, #36, #37, #41, #46 |

## 11. The records themselves

*Which records does this report rest on, over what span, and are they complete?*

Can serve as evidence for: EU AI Act Art. 12(1), Art. 13(3)(f), Art. 26(6); NIST AI RMF GOVERN; ISO/IEC 42001 Annex A.6.

- runs: 3
- child runs: 0
- events: 168
- journey instances: 0
- journey events: 0
- oldest record: 2026-11-02T09:00:00.750Z
- newest record: 2026-11-04T13:36:19.475Z
- held for ms: 2073599250
- runs with gaps: 0

| Statement | Records |
|---|---|
| The report rests on 168 journal record(s) of 3 run(s) and 0 record(s) of 0 journey(s), from 2026-11-02T09:00:00.750Z to 2026-11-04T13:36:19.475Z. | run 00000001 #1; run 00000080 #49 |

## 12. Guardrails

*What did the guardrails find in what reached and left the agents and tools, at which stage, and what did they do about it?*

Can serve as evidence for: EU AI Act Art. 12(2), Art. 14(4), Art. 15(4), Art. 15(5); NIST AI RMF MEASURE, MANAGE; ISO/IEC 42001 Annex A.6, Annex A.7.

- triggered: 4
- guardrails: 2
- failed closed: 0
- by action: block 0, redact 2, retry_with_feedback 0, escalate 2, warn 0
- by stage: input 2, output 2, tool_call 0, tool_result 0
- by check: personal_data 2, prompt_injection 2
- by category: email 2, ignore_instructions 2, phone 2

| Statement | Records |
|---|---|
| Guardrail "Personal data in what agents write" (personal_data) found email, phone (2 findings) in the output of "Notify claimant" at attempt 1 in run 00000001, and redacted what it found. | run 00000001 #53 |
| Guardrail "Personal data in what agents write" (personal_data) found email, phone (2 findings) in the output of "Notify claimant" at attempt 1 in run 0000003f, and redacted what it found. | run 0000003f #56 |
| Guardrail "Instructions hidden in claim data" (prompt_injection) found ignore_instructions (1 finding) in the input of "Assess damage" in run 00000080, and handed the activity to a person. | run 00000080 #9 |
| Guardrail "Instructions hidden in claim data" (prompt_injection) found ignore_instructions (1 finding) in the input of "Check fraud signals" in run 00000080, and handed the activity to a person. | run 00000080 #22 |

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
