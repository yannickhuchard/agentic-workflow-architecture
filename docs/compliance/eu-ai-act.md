# Using AWA evidence for the EU AI Act

This guide shows how an organisation that runs AI-assisted processes on AWA uses the record of those processes as evidence for its obligations under the EU AI Act (Regulation (EU) 2024/1689). It also maps the same evidence to the NIST AI Risk Management Framework 1.0 and to ISO/IEC 42001:2023.

AWA produces evidence. The organisation, with its legal and compliance advisers, decides whether its system is in scope, which risk class it belongs to, and whether the evidence meets each obligation. The evidence report states this on its first line, and section 32 of the specification defines it.

## Who this guide is for

- **Deployers** of high-risk AI systems, who monitor the operation of the system, assign human oversight, and keep its logs (Article 26).
- **Providers** of AI systems built as AWA workflows, who design record-keeping, human oversight, accuracy and robustness into the system (Articles 12 to 15) and monitor it after it is placed on the market (Article 72).
- **Auditors and compliance officers**, who read the evidence report and trace each statement to the records it rests on.

The application dates of each obligation are set by Article 113 of the Regulation and by any later amendment. Check the dates in force for your system.

## How AWA produces evidence

AWA produces evidence in three steps.

1. **The workflow declares the measures.** A workflow document and its deployment file state who performs each step, what each step must achieve, which checks apply to each result, where a person decides, which guardrails inspect inputs and outputs, and who may do what.
2. **The engine records what happened.** Every run writes an append-only journal (specification section 9): each activity, each check and its result, each model and the decision it took, each person's decision and who made it, each refusal, each guardrail that acted, and each tool call.
3. **The evidence report states what the record shows.** `awa evidence` computes a report from the journals (specification section 32). Each statement cites the journal records it rests on, and each part of the report names the provisions it can serve.

Because the report is computed from the journal, two people who run it on the same records obtain the same report. Both SDKs produce identical reports from the same journals.

## Obligations and the evidence that serves them

The table lists the provisions that AWA's record serves, what AWA records for each, and the part of the evidence report that states it. The mapping is informative, as section 32.4 of the specification explains.

| Provision | What it asks for | What AWA records and does | Report part |
|---|---|---|---|
| **Art. 12(1)** Record-keeping | Automatic recording of events over the lifetime of the system | The journal of every run, with every event numbered from 1 and without gaps; journey records for processes that span several runs | `operation`, `data`, `retention` |
| **Art. 12(2)** Logging for risk, post-market monitoring and operation | Logs that identify situations of risk, support post-market monitoring and support the deployer's monitoring | Refusals, failures, retries, dead letters, guardrail actions, service level warnings and breaches, tool calls by target | `refusals`, `failures`, `service_levels`, `tools`, `guardrails` |
| **Art. 12(3)(d)** Identification of the persons who verify results (systems of Annex III point 1(a)) | The identity of each person involved in verifying results | The principal of every person who completes a task or approves, with each approval of a four-eyes rule | `oversight` |
| **Art. 13(3)(b)** Characteristics and performance | Information on accuracy and on the performance of the system | Every model used, per activity, with the decisions it took; every contract check and verification result | `models`, `outcomes` |
| **Art. 13(3)(d)** Human oversight measures | A description of the oversight measures | Escalations to a person, human decisions, cancellations, separation of duties and four-eyes rules, guardrail escalations | `oversight` |
| **Art. 13(3)(f)** Mechanisms for logs | How logs are collected, stored and interpreted | The records held, their span, their payload mode, and the journals themselves | `retention`, `data` |
| **Art. 14(4)** Effective human oversight | People who can interpret the output, decide against it, override or reverse it, and interrupt the system | Outcome contracts that escalate to a person, human tasks, guardrails that escalate, cancellation of a run; each human decision with its principal and with the output it replaced | `oversight`, `guardrails` |
| **Art. 14(5)** Verification by two persons (systems of Annex III point 1(a)) | Separate verification by at least two natural persons | Four-eyes rules that count distinct approvers, and separation of duties that keeps the requester from approving | `oversight` |
| **Art. 15(1)** and **15(3)** Accuracy | Appropriate accuracy, with declared metrics | Outcome contracts and verification on every result, with each pass and each violation; measures such as right first time; evaluation datasets and scores (section 33) | `outcomes` |
| **Art. 15(4)** Robustness | Resilience to errors and faults, with redundancy and fail-safe plans | Retries with backoff, dead letters, model fallback across providers, compensation of completed steps, guardrails that block | `failures`, `compensations`, `refusals`, `guardrails` |
| **Art. 15(5)** Cybersecurity | Resilience against attempts to alter the use or the outputs of the system | Prompt injection markers in inputs and tool results, authorization decisions on every action, deployment permissions on tools and agents | `refusals`, `guardrails` |
| **Art. 26(2)** Oversight by competent persons | Oversight assigned to persons with the competence, training and authority | Principals with roles and attributes, and a policy that lets only those roles decide | `oversight` |
| **Art. 26(5)** Monitoring of operation | Monitoring on the basis of the instructions for use | Measures (section 21), OpenTelemetry traces (section 26), service levels (section 23), the evidence report itself | `operation`, `failures`, `service_levels`, `tools` |
| **Art. 26(6)** Keeping logs | Logs kept for at least six months, unless other law provides otherwise | Journals in a runtime directory or a shared PostgreSQL store; the report states which records are held and over which span | `retention`, `data` |

Other provisions draw on the same record:

- **Article 9 (risk management)** and **Article 72 (post-market monitoring)** use evaluation datasets built from recorded runs, shadow runs of a candidate beside production, and counterfactual replay of recorded runs under a changed model or rule (sections 20 and 33).
- **Article 11 (technical documentation)** uses the workflow document itself, which states the logic of the process, and the recipe (section 14), which explains how the process is built.
- **Article 73 (serious incidents)** and the deployer's duty to inform the provider (Article 26(5)) use the journal of each run, which shows the sequence of events that led to an incident, and the report's `failures` and `refusals` parts.

## Setting up a deployment for evidence

A deployment produces useful evidence when it declares the measures that the obligations ask for. The worked example in [`examples/claims-settlement/evidence`](../../examples/claims-settlement/evidence) uses each of the following.

**1. Name the people and the agents.** The deployment's `authorization.principals` gives every agent and application an identity, and the authenticated request gives the identity of every person. Each decision in the record then names who made it.

```json
{ "id": "agent:assessor", "kind": "ai_agent", "name": "Damage assessment agent", "acts_for": { "roles": ["Damage assessor"] } }
```

**2. State who may decide.** The policy allows each role the actions it needs. Separation of duties keeps the person who opened a claim from approving it, and a four-eyes rule requires two distinct approvers.

```json
"separation_of_duties": [{ "id": "opener-does-not-approve", "activities": ["Adjuster review"], "includes_starter": true }],
"four_eyes": [{ "id": "two-adjusters-approve", "activities": ["Adjuster review"], "approvals": 2 }]
```

Set `record_allows` to `true` to record every allowed decision as well as every refusal.

**3. Add guardrails.** A guardrail at stage `input` with the check `prompt_injection` and the action `escalate` hands a manipulated input to a person before any agent sees it. A guardrail at stage `output` with the check `personal_data` and the action `redact` removes personal data from what agents write. The journal records where a guardrail acted and what kind of thing it found, and keeps the matched text out of the record.

**4. Give each AI activity an outcome contract.** An output schema, postconditions and an escalation to a person make every AI result checkable, and every check appears in the `outcomes` part.

**5. Keep the journals.** Start the server with `AWA_DATA_DIR` for a runtime directory, or with `AWA_RUNTIME_STORE` for a shared PostgreSQL store, and keep the journals for the period your obligations require. `awa run --journal <file>` writes the journal of a single run.

**6. Monitor operation.** `awa measures` and `GET /api/v1/measures?format=openmetrics` give the measures of journeys and workflows, and the `OTEL_EXPORTER_OTLP_*` variables send every run to an OpenTelemetry collector.

## Producing the report

The report is computed from a runtime directory or from journal files.

```bash
awa evidence .awa --from 2026-09-01 --to 2026-10-01 --format html -o evidence.html
```

```bash
awa evidence examples/claims-settlement/evidence/journals --as-of 2026-11-26T09:00:00.000Z --format md -o evidence-report.md
```

| Option | Effect |
|---|---|
| `--from`, `--to` | Keeps the runs and journeys that started in the period. A child run is kept with its top-level run. |
| `--workflow` | Keeps the runs of the workflows named, with their child runs. |
| `--format json\|md\|html` | JSON in the form of `spec/json-schema/evidence-report.schema.json`, Markdown, or one HTML page. |
| `--as-of` | Fixes the instant the report is made as of, so that the same records always give the same report. |

A server started with `awa serve` offers the same report at `GET /api/v1/evidence`. The Python SDK's `awa evidence` produces the same report from the same journals.

## The worked example

[`examples/claims-settlement/evidence`](../../examples/claims-settlement/evidence) runs three motor claims through the claims-settlement workflow under a deployment with principals, a policy, a separation of duties, a four-eyes rule and two guardrails. It then produces the report in JSON, Markdown and HTML. The script fixes the clock and the identifiers, so the files are identical on every run.

| Claim | What happens | Where the report states it |
|---|---|---|
| Routine | The claim settles without a person. A failed contract check and a timeout are each retried, and the guardrail redacts a phone number and an email address from the letter to the claimant. | `outcomes`, `failures`, `guardrails` |
| Reviewed | The decision table sends a costly claim to review. The clerk who opened it is refused by the separation of duties, Alice approves, a second approval by Alice is refused by the four-eyes rule, and Bob approves. | `models`, `oversight`, `refusals`, `operation` |
| Injection | The claim's description carries instructions to the agents. The input guardrail hands the assessment and the fraud check to a senior adjuster before any agent is called. | `guardrails`, `oversight` |

Each statement cites its records in the form `run 0000003f #37`: the record with sequence number 37 in the journal of the run whose identifier begins with `0000003f`. An auditor opens that journal and reads the record.

## Reading the report

The report has twelve parts, always in the same order: `operation`, `models`, `oversight`, `outcomes`, `refusals`, `failures`, `compensations`, `service_levels`, `tools`, `data`, `retention` and `guardrails`. Each part answers one question, names the provisions it can serve, gives a summary of counts, and lists its statements with their citations.

The report states what the records show. Three judgements remain with the organisation:

- whether a measure was adequate for the risk of the system, for example whether a policy assigned oversight to the right people;
- what the guardrails examined and found nothing in, since the journal records the times a guardrail acted;
- whether the period over which records are held meets Article 26(6) and the law on personal data.

## Checklist for a deployer

1. Decide, with your advisers, whether your system is in scope and in which risk class.
2. Give every agent, application and person an identity in the deployment.
3. Write a policy that lets only competent roles decide, with separation of duties and four-eyes rules where a decision needs them.
4. Give every AI activity an outcome contract, and an escalation to a person where the stakes call for one.
5. Add input and output guardrails for prompt injection and personal data.
6. Keep the journals in a runtime directory or a shared store for the period your obligations require.
7. Produce the evidence report for each monitoring period with a fixed `--as-of`, and archive it with the journals it cites.
8. Review the `oversight`, `refusals`, `failures` and `guardrails` parts at each period, and act on what they show.

## The same evidence for NIST AI RMF and ISO/IEC 42001

Each part of the report also names the NIST AI RMF functions and the ISO/IEC 42001 clauses it serves.

| Report part | NIST AI RMF | ISO/IEC 42001 |
|---|---|---|
| `operation` | MEASURE | 9.1, Annex A.6 |
| `models` | MAP, MEASURE | Annex A.6 |
| `oversight` | GOVERN, MANAGE | Annex A.3, Annex A.9 |
| `outcomes` | MEASURE | 9.1 |
| `refusals` | GOVERN, MANAGE | Annex A.6 |
| `failures` | MANAGE | Annex A.6 |
| `compensations` | MANAGE | |
| `service_levels` | MEASURE, MANAGE | |
| `tools` | MAP | Annex A.10 |
| `data` | GOVERN | Annex A.7 |
| `retention` | GOVERN | Annex A.6 |
| `guardrails` | MEASURE, MANAGE | Annex A.6, Annex A.7 |

## References

- Specification section 32, Evidence: [`docs/specification.md`](../specification.md#32-evidence)
- Specification sections 30 (identity and authorization) and 31 (guardrails)
- The schema of the report: [`spec/json-schema/evidence-report.schema.json`](../../spec/json-schema/evidence-report.schema.json)
- The command: [`awa evidence`](../../sdk/typescript/docs/cli-guide.md#awa-evidence)
