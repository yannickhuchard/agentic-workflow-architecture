# Trust: contracts, checks, guardrails, evidence, replay, evaluation

How AWA makes an agent's outcome checkable, and how the record serves auditors and changes. Sections refer to `docs/specification.md`; the deployer's guide is `docs/compliance/eu-ai-act.md`.

## Contents

- Outcome contracts
- Verification
- Guardrails
- Escalation to a person
- Evidence reports
- The EU AI Act, NIST AI RMF and ISO/IEC 42001
- Counterfactual replay
- Evaluation and shadow runs
- Knowledge

## Outcome contracts

The workflow fixes what must be true of the result; the agent chooses how (section 11). Give every AI activity one:

```json
"outcome_contract": {
  "output_schema": { "type": "object", "required": ["estimated_cost"], "properties": { "estimated_cost": { "type": "number", "minimum": 0 } } },
  "postconditions": [ { "name": "Within authority", "expression": "estimated_cost <= 50000" } ],
  "budgets": { "max_attempts": 3, "max_duration": "PT30S", "max_tokens": 20000, "max_tool_calls": 8 },
  "on_violation": "escalate_human"
}
```

On every attempt that returns: output guardrails, then `output_schema`, `postconditions`, `max_tokens` (deterministic and free), then verification (which may call a model). The first rejection stops the checks. An `ai_agent` is re-executed with the violated terms as feedback while `max_attempts` allows (default 3, counting errors, contract and verification together). Then `on_violation` decides: `fail` gives `CONTRACT_VIOLATION` or `VERIFICATION_FAILED`, `escalate_human` hands the activity to a person with the rejected outcome and the reasons (`contract.escalated`). A person's answer is not judged by a model but is still held to the schema and postconditions. The journal's `contract.checked` gives `passed`, `violations`, `tokens_used`, `output_hash` and `decided_by`.

## Verification

Acceptance criteria that fail closed (section 7). `schema_only` evaluates each criterion's `expression`, deterministic; `ai_judge` has a model judge each criterion with evidence; `custom` calls a verifier the engine registers. The verdict is `pass` when every required criterion passes and the share of weights that pass reaches `pass_threshold` (default 0.9); anything else, or a judge reply that cannot be read, rejects the outcome. Prefer the contract for what an expression can say, and verification for what needs judgement.

```json
"verification": { "mode": "schema_only", "criteria": [
  { "id": "6f1d2c3b-9a8e-4f7d-b6c5-1a2b3c4d5e6f", "name": "Has a reason", "description": "The refund states why", "type": "completeness", "expression": "reason exists" } ] }
```

## Guardrails

Declarative checks on what goes into and comes out of agents and tools (section 31). Declare them on the workflow, a role, an activity or a tool; the deployment's `guardrails` run first, and a document cannot remove them. Order at each stage: deployment, workflow, role, activity, then the tool's.

```json
"guardrails": [
  { "id": "0b6f8f62-5d0e-4d5e-9a57-2b4f3b1e7c01", "name": "No personal data out", "stages": ["output", "tool_call"], "check": { "kind": "personal_data" }, "action": "redact" },
  { "id": "0b6f8f62-5d0e-4d5e-9a57-2b4f3b1e7c02", "name": "Injection in data", "stages": ["input"], "check": { "kind": "prompt_injection" }, "action": "escalate" },
  { "id": "0b6f8f62-5d0e-4d5e-9a57-2b4f3b1e7c03", "name": "Known decisions", "stages": ["output"], "check": { "kind": "allowed_values", "path": "decision", "values": ["approve", "refer"] }, "action": "retry_with_feedback" }
]
```

| Action | Effect |
|---|---|
| `warn` | Recorded only |
| `redact` | Each match replaced (`[REDACTED:{category}]`) everywhere the value goes, the journal included; only with `personal_data`, `deny_list`, `prompt_injection` |
| `block` | At `input` the actor is not called; at `output` the activity fails; at `tool_call` the call is refused; code `GUARDRAIL_BLOCKED`, never retried |
| `retry_with_feedback` | Stage `output` only: the agent tries again within the contract's `max_attempts` |
| `escalate` | Stages `input` and `output`: a person performs the activity |

`personal_data` finds email addresses, phone numbers, IBANs (with their checksum) and card numbers (Luhn); `prompt_injection` has six markers (`ignore_instructions`, `new_instructions`, `reveal_instructions`, `jailbreak_mode`, `chat_template_token`, `role_header`). A check that cannot run fails closed with `GUARDRAIL_ERROR`. The journal records `guardrail.triggered` with positions and categories, never the matched text. Pattern lists are a floor, not a defence: bound what an agent can do with tools, permissions, contracts and a person where the stakes call for one. `prompt_injection` at stage `tool_result` checks what tools bring back from outside.

## Escalation to a person

Three ways hand work to a person: a `human` activity; `on_violation: "escalate_human"` on a contract; a guardrail with `escalate`. The token waits (`waiting_human`) until the task is answered. Under a policy, `complete_task` (or `approve` under four eyes) decides who may answer, and separation of duties keeps the requester from approving. An engine that cannot wait for a person fails the activity.

## Evidence reports

`awa evidence` computes a report from journals and journey records (section 32). Every statement cites the records it rests on (`run 0000003f #37`: record 37 of the run whose id begins with `0000003f`), so the same records always give the same report; both SDKs give the same report.

```bash
awa evidence .awa --from 2026-09-01 --to 2026-10-01 --format html -o evidence.html
awa evidence examples/claims-settlement/evidence/journals --as-of 2026-11-26T09:00:00.000Z --format md -o evidence-report.md
```

Twelve parts, always in this order: `operation`, `models`, `oversight`, `outcomes`, `refusals`, `failures`, `compensations`, `service_levels`, `tools`, `data`, `retention`, `guardrails`. Each names the provisions it can serve. The report is evidence for the deployer's own compliance work, not a certification; it cannot say what a guardrail examined and found nothing in, nor whether a measure was adequate for the risk. `GET /api/v1/evidence` gives the same; JSON follows `spec/json-schema/evidence-report.schema.json`. `examples/claims-settlement/evidence` is a worked example.

## The EU AI Act, NIST AI RMF and ISO/IEC 42001

| Provision | What AWA records | Report parts |
|---|---|---|
| Art. 12(1), 12(2) record-keeping and logging | Every run's journal; refusals, failures, retries, guardrail actions, service levels, tool calls | `operation`, `data`, `retention`, `refusals`, `failures`, `service_levels`, `tools`, `guardrails` |
| Art. 12(3)(d), 14(5) persons who verify, two persons | The principal of every person who completes or approves; four-eyes approvals | `oversight` |
| Art. 13(3)(b) performance | Models per activity and their decisions; every contract and verification result | `models`, `outcomes` |
| Art. 13(3)(d), 14(4), 26(2) human oversight | Escalations, human decisions, cancellations, separation of duties, four eyes, principals with roles | `oversight`, `guardrails` |
| Art. 15(1), 15(3) accuracy | Contracts and verification on every result, right first time, evaluation scores | `outcomes` |
| Art. 15(4), 15(5) robustness, cybersecurity | Retries, dead letters, model fallback, compensation; injection markers, authorization decisions, deployment permissions | `failures`, `compensations`, `refusals`, `guardrails` |
| Art. 26(5), 26(6) monitoring, keeping logs | Measures, telemetry, service levels; journals kept in a runtime directory or a shared store | `operation`, `retention`, `data` |

Each part also names the NIST AI RMF functions and ISO/IEC 42001 clauses it serves. The mapping is informative (32.4). A deployment that produces useful evidence: names every agent, application and person in `authorization.principals`; lets only competent roles decide, with separation of duties and four eyes where needed (`record_allows: true` to record allows); adds input `prompt_injection` and output `personal_data` guardrails; gives every AI activity an outcome contract with escalation; keeps journals for the period the obligations require; produces the report each period with a fixed `--as-of`.

## Counterfactual replay

What a recorded run would have done under another model, prompt, contract or rule (section 20). Held from the journal: the input, results of people, applications and robots, tool results matched by tool and arguments, business events and timeouts, cancellation; time does not wait. Run again: AI agents (unless `--ai recorded`), model decisions, verification, contracts, guardrails, decision tables and routing.

```bash
awa replay workflow.awa.json run.journal.jsonl --candidate changed.awa.json --ai recorded -o report.md
```

`--ai recorded` replays the agents' outputs too, so the report isolates a changed contract, criterion, table or edge without calling a model. Keep node ids in the candidate for nodes that stay the same. A step the recording does not hold fails with `REPLAY_UNRECORDED`, never invents a result and never calls the world. Node verdicts: `same`, `changed`, `improved`, `regressed`, `only_baseline`, `only_candidate`. A regression exits with status 2, so recorded journals serve as a regression suite for a change of model. Journals with payload mode `hash` or `none` replay only to their first activity.

## Evaluation and shadow runs

Section 33. `awa eval build <journals...> -o dataset.jsonl` makes one case per visit to an `ai_agent` activity: its input, whether it was accepted (by `contract`, `verification`, `person` or `unchecked`) or rejected, the attempts and tool calls. `awa eval run workflow.awa.json dataset.jsonl --candidate changed.awa.json --providers ollama` performs each case again under the candidate (tools answered from the record, no person asked) and reports `recorded_rate`, `pass_rate`, `contract_pass_rate`, `verification_pass_rate` and `same_outcome_rate` per activity, with regressions; status 2 on a regression. A shadow (`shadow` option of `AwaRuntime`) replays each production run under a candidate when it ends, never acting on the world, and compares the two.

## Knowledge

Section 15. Distilled from journals without a model, compounded across runs, cited to journal events, and given to agents only after a person reviews it.

```bash
awa knowledge ingest workflow.awa.json run.journal.jsonl     # drafts; repeating a run changes nothing
awa knowledge review all --by "<reviewer>"
awa knowledge export knowledge/                               # Open Knowledge Format 0.3 bundle
```

Entry types: `strategy`, `failure_pattern`, `decision_precedent`, `lesson`. An activity opts in with `"knowledge": {}` (or `types`, `tags`, `max_entries`, `min_status`); the engine records `knowledge.retrieved`. Knowledge informs strategy and never relaxes the outcome contract. `examples/claims-settlement/knowledge` is a bundle.
