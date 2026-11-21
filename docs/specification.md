# AWA Specification

**Version 1.1 (draft)**

Agentic Workflow Architecture (AWA) is a specification for defining, executing, observing and learning from workflows in which humans, AI agents, robots and applications work together.

This document is normative. Where it and an SDK disagree, this document is right and the SDK has a bug.

## Table of contents

1. [Scope](#1-scope)
2. [Conformance](#2-conformance)
3. [Terminology](#3-terminology)
4. [Documents](#4-documents)
5. [Execution semantics](#5-execution-semantics)
6. [Condition expressions](#6-condition-expressions)
7. [Verification](#7-verification)
8. [Data model reference](#8-data-model-reference)
9. [Execution journal](#9-execution-journal)
10. [Resilience](#10-resilience)
11. [Outcome contracts](#11-outcome-contracts)
12. [Model binding](#12-model-binding)
13. [Flow control](#13-flow-control)

## 1. Scope

AWA standardises four things:

- **The document**: how a workflow is written down (section 4).
- **The behaviour**: what an engine does with that document (sections 5 to 7).
- **The record**: what an engine writes down while it runs, so a run can be explained, replayed and rebuilt.
- **The knowledge**: how what was learned from runs is kept and exchanged.

The guiding principle is **fixed outcome, free strategy**. An AI agent may reach a result by different means on different runs. AWA does not try to fix the means. It fixes what must be true of the result, records how the result was reached, and refuses results it cannot verify.

## 2. Conformance

The key words MUST, MUST NOT, SHOULD, SHOULD NOT and MAY are to be read as in RFC 2119.

### 2.1 Conformance levels

An implementation claims one or more levels. Each level has cases in `spec/conformance/`, tagged with the level name.

| Level | An implementation at this level | Sections |
|---|---|---|
| `document` | Reads AWA documents and applies schema and integrity validation | 4 |
| `core` | Executes sequences and conditional routing, and reports the run outcome | 5.1 to 5.4, 5.7, 6 |
| `decision` | Evaluates decision tables | 5.5 |
| `verified` | Applies verification policies, failing closed | 7 |
| `recorded` | Writes the execution journal | 9 |
| `resilient` | Retries, dead-letters and recovers runs | 10 |
| `contract` | Enforces outcome contracts, budgets and escalation | 11 |
| `flow` | Parallel split and join, events, timers and compensation | 13 |

An implementation MUST NOT claim a level unless it passes every case tagged with that level. It MUST report the cases it skips; it MUST NOT silently omit them.

### 2.2 Current implementations

| SDK | Levels claimed |
|---|---|
| TypeScript (reference) | `document`, `core`, `decision`, `verified`, `recorded`, `resilient`, `contract`, `flow` |
| Python | `core`, and `document` except four integrity rules (see its conformance run) |
| Java | none (data model only) |

### 2.3 Normative and informative artefacts

The JSON Schemas in `spec/json-schema/` and this document are normative. The Avro, OpenAPI, GraphQL and PostgreSQL DDL files in `spec/` are informative projections of the same model; where they differ from the JSON Schemas, the JSON Schemas apply.

## 3. Terminology

- **Workflow**: a directed graph of nodes joined by edges.
- **Node**: an activity, an event or a decision node.
- **Activity**: a unit of work performed by one actor.
- **Actor**: who performs an activity: `human`, `ai_agent`, `robot` or `application`.
- **Edge**: a directed connection from a source node to a target node, optionally with a condition.
- **Run**: one execution of a workflow.
- **Token**: the marker of progress within a run. A token is at exactly one node and carries data.
- **Engine**: software that executes runs.

## 4. Documents

### 4.1 Form

An AWA document is a JSON object in one of two forms:

- **Workflow form**: the object is a workflow and validates against `workflow.schema.json`. This is the canonical form.
- **Envelope form**: the object has a `workflow` property holding a workflow, and has no `activities` property of its own.

A processor MUST accept both forms. A document SHOULD state the specification version it targets in `awa_version` (for this version, `"1.1"`).

### 4.2 Identifiers

Every `id` and every reference to one MUST be a UUID. Identifiers of activities, events, decision nodes and edges MUST be unique within a workflow.

### 4.3 Validation

A processor MUST validate a document in two stages and MUST reject a document that fails either. It MUST NOT execute an invalid document.

**Schema validation.** The workflow validates against `workflow.schema.json`.

**Integrity validation.** All of the following hold:

| Rule | Error code |
|---|---|
| Every edge's `source_id` and `target_id` name a node in the workflow | `invalid_reference` |
| Every context binding names a context in the workflow | `invalid_reference` |
| Every decision rule's `output_edge_id`, and every `default_output_edge_id`, names an edge whose source is that decision node | `invalid_reference` |
| Node and edge identifiers are unique | `duplicate_id` |
| Every edge `condition` and every postcondition is a valid condition expression (section 6) | `invalid_expression` |
| Every `compensation.activity_id` names an activity in the workflow | `invalid_reference` |
| No compensation handler is the target of an edge | `invalid_compensation` |
| Every timer event has a valid `event_definition.duration` | `invalid_timer` |
| No node is the source of more than one edge with `is_default: true` | `multiple_default_edges` |

### 4.4 Extension

Processors MUST ignore properties they do not recognise and MUST preserve them when rewriting a document. Extension properties SHOULD be namespaced with a prefix followed by a colon (for example `acme:cost_centre`) so they cannot collide with future versions of this specification.

## 5. Execution semantics

### 5.1 Runs and tokens

A run begins with one token. Parallel splits (13.1) create more. A token has a status:

| Status | Meaning |
|---|---|
| `active` | The engine will process the token's current node |
| `waiting` | The token is paused until an external party resumes it |
| `completed` | The token reached a node with no outgoing edges |
| `failed` | The token could not proceed |
| `cancelled` | The token was withdrawn because the run failed (13.3) |
| `joining` | The token is at a join, waiting for the other branches (13.2) |
| `joined` | The token was merged into another at a join (13.2) |

### 5.2 Data

A token carries a JSON object, its data.

- The data starts as the input supplied when the run starts.
- When an activity finishes, its result object is merged into the token's data, property by property. Later values replace earlier values of the same property.
- The engine also records each activity's result under `activities.<activity id>.output`, so a result is not lost when a later activity reuses a property name.
- Properties whose names begin with `_` are reserved for the engine.

Conditions (section 6) are evaluated against the token's data.

### 5.3 Start and sequence

The start node is the first of these that exists:

1. The first event, in document order, with `event_type: "start"`.
2. The first activity, in document order, that is not the target of any edge and is not a compensation handler (13.6).
3. The first activity in the document.

An engine processes an active token by executing the activity at its node with the activity's actor, then routing the token (5.4).

### 5.4 Routing

When a token leaves an activity or an event, the engine selects outgoing edges as follows, stopping at the first step that applies:

1. The node has no outgoing edges: the token is `completed`.
2. The first edge, in document order, whose `condition` evaluates to true. It is taken alone.
3. The edge with `is_default: true`. It is taken alone.
4. Every edge that has no `condition`. One such edge is a sequence; several are a parallel split (13.1).
5. Otherwise there is no route: the token is `failed` with error code `NO_ROUTE`.

An engine MUST NOT select an edge whose condition evaluated to false. In particular it MUST NOT fall back to "the first edge" when conditions exist and none is true.

### 5.5 Decision nodes

A decision node routes a token using a decision table. It performs no work.

Each rule has one input entry per input column. An entry is a **unary test** applied to the token data property named by the column:

| Entry | True when the value |
|---|---|
| `-`, `*` or empty | always |
| `true`, `false` | is that boolean |
| `null`, `not null` | is absent or null; is present and not null |
| `"text"` | equals the quoted string |
| `> n`, `>= n`, `< n`, `<= n` | compares so, as a number |
| `== x`, `= x`, `!= x`, `<> x` | equals, or does not equal, `x` |
| `[a..b]`, `(a..b)`, `[a..b)`, `(a..b]` | lies in the range; `[` `]` include the bound, `(` `)` exclude it |
| `in (a, b, c)`, `not in (a, b, c)` | is, or is not, one of the listed values |

A rule matches when all its entries are true. Which matching rule supplies the outgoing edge depends on the table's hit policy:

| Hit policy | Edge taken |
|---|---|
| `first`, `rule_order`, `collect` | that of the first matching rule in document order |
| `unique` | that of the single matching rule |
| `priority`, `any` | that of the first matching rule |

The token moves along the selected rule's `output_edge_id`. If the rule has none, or no rule matches, the token moves along `default_output_edge_id`. If there is none, the token is `failed`.

### 5.6 Waiting

An activity performed by a `human` actor MAY leave its token `waiting`. The engine resumes the token when the task is completed, merges the human's output into the token's data, and routes it (5.4).

### 5.7 Run outcome

A run has a status derived from its tokens:

| Run status | Condition |
|---|---|
| `running` | At least one token is `active` |
| `waiting_human` | No token is `active` and at least one is `waiting` |
| `failed` | At least one token is `failed` (the others are then cancelled, 13.3) |
| `completed` | Every token is `completed` or `joined` |

An engine MUST NOT report `completed` for a run in which any token failed.

When an activity raises an error, its token is `failed` and the error message is recorded in the token's data as `_error`.

## 6. Condition expressions

One expression language is used for edge conditions and verification criteria.

### 6.1 Grammar

```
expr     := and ( "||" and )*
and      := unary ( "&&" unary )*
unary    := "!" unary | "(" expr ")" | test
test     := "typeof" path "==" word
          | path "exists"
          | path operator literal
          | path
operator := "==" | "!=" | ">=" | "<=" | ">" | "<"
path     := name ( "." name )*
literal  := number | "string" | 'string' | true | false | null | word
```

### 6.2 Evaluation

- A `path` is resolved against the data, one property per segment. If any segment is absent the path is **missing**.
- `path` alone is true when the value is present and truthy (not `false`, `0`, `""` or `null`).
- `path exists` is true when the property is present, even if its value is `null`.
- `typeof path == word` compares against one of `string`, `number`, `boolean`, `object`, `array`, `null`, `undefined`.
- A bare `word` on the right of an operator is a string literal: `status == approved` and `status == "approved"` are the same test.
- `==` against a number compares numerically; against a boolean compares to that boolean; against `null` is true when the value is missing or null; otherwise compares as strings.
- `>`, `>=`, `<`, `<=` against a number compare numerically. They are false when the value is missing or is not a number.
- `!=` is the negation of `==`. A missing value is therefore not equal to any non-null literal.

### 6.3 Errors

Evaluation has no side effects. An expression that does not match the grammar is an error. A processor MUST reject it at validation (4.3) and MUST NOT treat it as true or false.

## 7. Verification

An activity MAY carry a `verification` policy: acceptance criteria its output must meet before the token may proceed.

### 7.1 Modes

| Mode | How criteria are evaluated |
|---|---|
| `schema_only` | Each criterion's `expression` is evaluated against the output. Deterministic. |
| `ai_judge` | A model evaluates each criterion and returns, per criterion, pass or fail with evidence. |
| `custom` | A verifier registered with the engine. |

### 7.2 Verdict

Each criterion passes or fails. The score is the sum of the weights of passing criteria divided by the sum of all weights. The verdict is `pass` when every criterion with `required: true` passes **and** the score is at least `pass_threshold`. Otherwise it is `fail`. If verification itself could not be carried out, the verdict is `error`.

### 7.3 Fail closed

Verification MUST fail closed:

- The token proceeds only on a `pass` verdict. On `fail` or `error` the activity fails.
- A criterion that cannot be evaluated (for example, no `expression` in `schema_only` mode) is not met.
- An engine MUST NOT substitute a weaker mode for the one the policy names. A `custom` policy with no registered verifier yields `error`.
- A judge response that cannot be parsed yields fail for every criterion.

### 7.4 Retry

When the verdict is `fail`, the actor is `ai_agent` and `retry_with_feedback` is true, the engine re-executes the activity, giving the agent the failed criteria and the evidence, up to `max_retries` additional attempts. The first `pass` is accepted. Activities performed by other actor types are not retried by verification.

### 7.5 Record

Each verification attempt produces a record holding the attempt number, the verdict, the result and evidence per criterion, the score, and a SHA-256 hash of the output that was judged.

## 8. Data model reference

The JSON Schemas are authoritative for field names and types. This section summarises them.

### 8.1 Workflow

| Field | Type | Description |
|---|---|---|
| `id` | UUID | Unique identifier |
| `name` | string | Workflow name |
| `version` | string | Semantic version of this workflow, e.g. `1.0.0` |
| `awa_version` | string | Specification version targeted, e.g. `1.1` |
| `description` | string | Optional description |
| `activities` | Activity[] | Units of work |
| `edges` | Edge[] | Connections between nodes |
| `events` | Event[] | Events |
| `decision_nodes` | DecisionNode[] | Decision tables |
| `contexts` | Context[] | Shared contexts |
| `sla` | SLA | Service level agreement |
| `analytics` | Analytics | Value stream metrics |

### 8.2 Activity

| Field | Type | Description |
|---|---|---|
| `id` | UUID | Unique identifier |
| `name` | string | Activity name |
| `description` | string | What the activity does and why |
| `procedure` | string | How to perform it, step by step |
| `role_id` | UUID | Role that performs it |
| `actor_type` | enum | `human`, `ai_agent`, `robot`, `application` |
| `inputs`, `outputs` | DataObject[] | Declared data, each optionally with a JSON Schema |
| `context_bindings` | ContextBinding[] | Contexts the activity reads or writes |
| `access_rights` | AccessRight[] | Permissions required or provisioned |
| `programs` | Program[] | Executable code or tools |
| `controls` | Control[] | Governance policies |
| `skills` | SkillBinding[] | Knowledge or competency required |
| `tool_requirements` | ToolRequirement[] | Tools or interfaces required |
| `join` | enum | `any` (default) or `all` (13.2) |
| `compensation` | object | The activity that undoes this one (13.6) |
| `verification` | VerificationPolicy | Acceptance criteria (section 7) |
| `retry` | RetryPolicy | What to do when the actor raises an error (section 10) |
| `outcome_contract` | OutcomeContract | What must be true of the outcome (section 11) |
| `sla` | SLA | Activity-level SLA |
| `analytics` | Analytics | Activity-level metrics |

### 8.3 Edge

| Field | Type | Description |
|---|---|---|
| `id` | UUID | Unique identifier |
| `source_id`, `target_id` | UUID | The nodes joined |
| `condition` | string | Condition expression (section 6) |
| `is_default` | boolean | Taken when no condition is true |
| `label` | string | Display label |

### 8.4 Contexts

Contexts are shared data used for collaboration between actors.

| Context type | Description |
|---|---|
| `document` | Shared documents |
| `data` | Structured data |
| `config` | Configuration |
| `state` | Workflow state |
| `memory` | Agent memory |
| `artifact` | Generated artefacts |

| Sync pattern | Description |
|---|---|
| `shared_state` | Direct read and write of shared state |
| `message_passing` | Message-based communication |
| `blackboard` | Blackboard pattern |
| `event_sourcing` | Immutable event log |

| Access mode | Description |
|---|---|
| `read`, `write`, `read_write` | Direct access |
| `subscribe`, `publish` | Receive or send updates |

### 8.5 Access rights

An access right has a `direction` (`requires` or `provisions`), a `resource_type` (`system`, `api`, `database`, `file`, `service`, `secret`) and a `permission` (`read`, `write`, `execute`, `admin`, `delete`, `create`).

### 8.6 Value stream analytics

| Metric | Description |
|---|---|
| `process_time` | Time spent working |
| `cycle_time` | Time from start to finish of a step |
| `lead_time` | Time from request to delivery |
| `wait_time` | Time spent waiting |
| `value_added` | Whether the activity adds value |
| `process_cycle_efficiency` | Share of time that is value-added |

Waste categories (DOWNTIME): `defects`, `overproduction`, `waiting`, `non_utilized_talent`, `transport`, `inventory`, `motion`, `extra_processing`.

## 9. Execution journal

The journal is the append-only record of a run. It is the single source for everything that explains a run: live and replayed visualisation, recovery, the recipe document and distilled knowledge. An engine at level `recorded` MUST write it.

### 9.1 Events

A journal is an ordered sequence of events. Each event validates against `journal-event.schema.json`:

| Field | Description |
|---|---|
| `spec_version` | Version of this specification, `"1.1"` |
| `id` | Unique identifier of the event |
| `run_id` | The run |
| `seq` | Position in the run. The first event is 1 and there are no gaps |
| `time` | When the event was recorded (RFC 3339) |
| `type` | The event type (9.3) |
| `level` | The trace level (9.2) |
| `workflow_id` | The workflow |
| `token_id`, `node_id`, `node_name`, `attempt` | What the event concerns, where applicable |
| `data` | Payload specific to the event type |

An engine MUST NOT alter or remove an event once written.

### 9.2 Trace levels

| Level | Answers | Written by |
|---|---|---|
| `execution` | What happened? | The engine |
| `reasoning` | How did the actor arrive at its result? | The actor, through the engine |
| `meta` | Why did the engine handle the work this way? | The engine |

`reasoning` events carry an actor's own account: its `plan`, its `rationale`, the `alternatives_considered` and its `confidence`. For an AI agent this is a self-report produced alongside the output. It is evidence about the run, not a guaranteed-faithful trace of the model's internal computation, and consumers MUST NOT treat it as one.

`meta` events record engine decisions that a reader could not otherwise reconstruct. Each has a `subject`, a `decision` and a `rationale`:

| Subject | Recorded when |
|---|---|
| `model_selection` | A model is chosen for an attempt |
| `retry` | An attempt raised and will be retried |
| `verification_retry` | An output was rejected by verification and the activity will be re-executed with feedback |
| `contract_retry` | An outcome violated its contract and the activity will be re-executed with feedback |
| `escalation` | A rejected outcome is handed to a human |

### 9.3 Event types

| Type | Level | Recorded when | Main `data` |
|---|---|---|---|
| `run.started` | execution | A run begins | `workflow_name`, `workflow_version`, `input` |
| `run.completed`, `run.failed` | execution | The run reaches its outcome (5.7) | `duration_ms`, `steps`, token and cost totals; `errors` on failure |
| `run.waiting` | execution | No token is active and at least one waits | `waiting_tokens` |
| `run.resumed` | execution | A run continues from a checkpoint (10.3) | `from_seq`, `from_checkpoint_at` |
| `token.created` | execution | A token comes into existence | `parent_token_id` and `reason: parallel_split` for a split |
| `token.joined` | execution | Tokens are merged at a join | `merged_token_ids`, `incoming_edge_ids` |
| `token.cancelled` | execution | A token is withdrawn because the run failed | `reason` |
| `timer.started`, `timer.fired` | execution | A token reaches a timer event; the timer elapses | `duration`, `due_at` |
| `activity.compensated`, `activity.compensation_failed` | execution | A compensation handler ran, or raised | `compensates_activity_id`, `output` or `error` |
| `token.moved` | execution | A token follows an edge | `from_node_id`, `to_node_id`, `edge_id`, `reason` (`condition`, `default`, `unconditional`, `parallel_split`, `decision`), `condition` |
| `token.completed`, `token.failed` | execution | A token ends | `error` on failure |
| `token.waiting`, `token.resumed` | execution | A token pauses for, or returns from, an external party | `reason`, `waited_ms` |
| `activity.started` | execution | An attempt begins | `actor_type`, `input`, `feedback` |
| `activity.completed` | execution | An attempt's output is accepted | `output`, `duration_ms`, `attempts`, `usage` |
| `activity.failed` | execution | An attempt raised, or its output was rejected | `error.message`, `error.code`, `retryable` |
| `activity.retry_scheduled` | execution | A further attempt will follow an error | `delay_ms`, `next_attempt` |
| `activity.dead_lettered` | execution | Retries are exhausted | `error`, `attempts` |
| `decision.evaluated` | execution | A decision node is evaluated | `inputs`, `matched_rules`, `outputs`, `edge_id`, `used_default` |
| `verification.completed` | execution | An output has been verified | `mode`, `verdict`, `score`, `criteria`, `feedback`, `output_hash` |
| `contract.checked` | execution | An outcome has been checked against its contract | `passed`, `violations`, `tokens_used`, `output_hash`, `decided_by` |
| `contract.escalated` | execution | A rejected outcome is handed to a human | `code`, `message`, `rejected_output` |
| `reasoning.recorded` | reasoning | An actor reports its reasoning | `plan`, `rationale`, `alternatives_considered`, `confidence` |
| `meta.recorded` | meta | The engine makes a decision listed in 9.2 | `subject`, `decision`, `rationale` |

Every attempt of an activity is bracketed: one `activity.started`, then exactly one of `activity.completed` or `activity.failed`, with the same `attempt` number.

### 9.4 Payloads

Activity inputs and outputs may be sensitive. An engine MUST support three payload modes and MUST apply the chosen one to every `input` and `output` it journals:

| Mode | The journal holds |
|---|---|
| `full` | The value |
| `hash` | `{ "sha256": "<hex>" }`, the SHA-256 of the value's canonical JSON |
| `none` | Nothing |

Canonical JSON has object keys sorted at every depth and no insignificant whitespace, so equal values hash equally. Properties reserved to the engine (5.2) are not journalled as payload.

### 9.5 Interchange and streaming

The interchange format for a journal is JSON Lines: one event per line, in `seq` order, in a file named `<run_id>.journal.jsonl`.

An engine that serves journals over HTTP SHOULD offer them as Server-Sent Events, with the SSE `id` set to `seq` and the SSE `event` set to `type`, and SHOULD resume from a `Last-Event-ID` header so that a client that reconnects misses nothing.

## 10. Resilience

### 10.1 Retry

An activity MAY declare a `retry` policy. An engine MAY also be configured with a default policy for activities that declare none. Without either, an activity is executed once.

| Field | Default | Meaning |
|---|---|---|
| `max_attempts` | 1 | Executions allowed when the actor raises, including the first |
| `initial_delay` | `PT1S` | Delay before the second attempt |
| `backoff_multiplier` | 2 | Factor applied to the delay after each failed attempt |
| `max_delay` | `PT30S` | Upper bound on the delay |
| `jitter` | true | Vary each delay randomly by up to 25% |
| `non_retryable_errors` | see below | Error codes that end the activity at once |

When an attempt raises an error the engine retries if attempts remain and the error is retryable. The delay before attempt *n* + 1 is `min(initial_delay × backoff_multiplier^(n−1), max_delay)`.

An error MAY carry a `code`. An error is not retryable if its code is in `non_retryable_errors`, which defaults to `VALIDATION_ERROR`, `AUTHENTICATION_ERROR`, `PERMISSION_DENIED` and `NOT_FOUND`. An engine MUST NOT decide retryability by matching text in the error message.

Retry applies to errors. A rejected output is governed by the verification policy (7.4), not by `retry`.

### 10.2 Dead letters

When an activity with a retry policy exhausts its attempts, the engine MUST record `activity.dead_lettered` and keep the token, its data and the last error available for inspection and manual resolution. The token is `failed`.

### 10.3 Checkpoints and recovery

An engine at level `resilient` MUST be able to persist the state of a run after each step and continue the run from that state in another process. The continued run keeps its `run_id`, and its journal continues at the next `seq` with a `run.resumed` event.

A token that was `active` when the checkpoint was taken executes its current activity again. Activities are therefore executed **at least once**.

### 10.4 Idempotency

To make at-least-once execution safe, the engine MUST pass each execution an idempotency key that is the same for every attempt of the same visit of a token to an activity, including attempts made after recovery, and different for every other visit. Actors with side effects SHOULD use it to deduplicate. The reference engine passes it as `_idempotency_key`, with the attempt number as `_attempt`.

## 11. Outcome contracts

An AI agent may take a different route to its result every time it runs. An outcome contract states what must be true of the result regardless of the route. This is how AWA makes outcomes predictable without constraining strategy.

### 11.1 The outcome

The **outcome** of an activity is the value of its result's `output` property when that is a JSON object; otherwise it is the result itself, without properties reserved to the engine. Contracts and verification both apply to the outcome.

### 11.2 Terms

An activity MAY carry an `outcome_contract`:

| Term | Meaning |
|---|---|
| `output_schema` | A JSON Schema (2020-12) the outcome must validate against |
| `postconditions` | Named condition expressions (section 6), each of which must be true of the outcome |
| `budgets` | Limits on what the activity may consume (11.4) |
| `on_violation` | `fail` (default) or `escalate_human` (11.5) |

Checking `output_schema` and `postconditions` MUST be deterministic: the same outcome always yields the same result. A postcondition that is not a valid expression is rejected at validation (4.3).

### 11.3 Order of checks

For each attempt that returns, an engine MUST check in this order and stop at the first rejection:

1. **Contract**: `output_schema`, then `postconditions`, then `budgets.max_tokens`. Deterministic and free.
2. **Verification** (section 7), if the activity has a policy. May call a model.

An outcome is accepted only if every check that applies passes. When the contract rejects an outcome, the actor is `ai_agent`, and attempts remain within `budgets.max_attempts` (default 3), the engine re-executes the activity with the violated terms as feedback. Other actor types are not re-executed.

### 11.4 Budgets

| Budget | Meaning | When exceeded |
|---|---|---|
| `max_attempts` | Most executions of the actor in one visit, **for any cause**: errors, contract violations and verification failures together | No further attempt is made |
| `max_duration` | Longest a single attempt may take | The attempt fails with error code `TIMEOUT`, which is retryable under the retry policy |
| `max_tokens` | Most model tokens, input plus output, the visit may consume, counting judge tokens | The outcome is rejected and not retried |

`max_attempts` overrides any higher limit in `retry` or `verification`. An engine cannot always cancel work that has timed out; it MUST ignore a result that arrives after the timeout.

### 11.5 Escalation

When an outcome is rejected, by the contract or by verification, and no automatic attempt remains:

- With `on_violation: "fail"`, the activity fails with error code `CONTRACT_VIOLATION` or `VERIFICATION_FAILED`.
- With `on_violation: "escalate_human"`, the engine hands the activity to a human, together with the rejected outcome and the reasons, and records `contract.escalated`. The token waits (5.6) until the human decides.

A human decision is not re-verified by a model, but `output_schema` and `postconditions` still bind it: a human outcome that violates them fails the activity. The same holds for any activity performed by a `human` actor that carries a contract.

An engine that cannot wait for a human MUST fail the activity. A pending task is not an answer.

## 12. Model binding

A workflow document names models by **reference** and never depends on a vendor's API. The engine resolves each reference to a provider when the run executes.

### 12.1 Model references

A model reference appears wherever a document names a model (`role.ai_model_config.model_id`, `verification.judge_model_id`). It takes one of three forms, tried in this order:

| Form | Meaning |
|---|---|
| `tier:<name>` | A capability tier that the deployment maps to a model |
| `<provider>:<model>` | A specific model of a provider registered with the engine |
| `<model>` | A model of the engine's default provider |

The part before the first colon is treated as a provider only if a provider is registered under that name; otherwise the whole string is a model name.

### 12.2 Tiers

Portable documents SHOULD use tiers rather than vendor model names. Every deployment SHOULD map these three:

| Tier | Intended for |
|---|---|
| `tier:reasoning` | Planning and multi-step work where quality matters most |
| `tier:balanced` | General work |
| `tier:fast` | High-volume, simple work such as classification and judging |

A deployment MAY define further tiers. A tier MUST map to a model, not to another tier.

### 12.3 Resolution

When an AI agent executes an activity the model reference is, in order: the one named by the activity's role; otherwise the engine default. For a judge it is the policy's `judge_model_id`; otherwise the engine default.

A reference that cannot be resolved (an unmapped tier, or no provider) is an error with code `VALIDATION_ERROR`. An engine MUST NOT substitute another model silently.

The engine MUST journal each resolution as a `meta.recorded` event with subject `model_selection`, giving the provider, the model, the tier if one was used, and why that reference applied.

### 12.4 Providers

A provider is an adapter with one operation: given a model name, optional standing instructions, a prompt and sampling settings, it returns text and the input and output token counts. The reference SDK ships adapters for Google Gemini and for any service exposing an OpenAI-style `chat/completions` endpoint, and accepts others through `model_providers`.

## 13. Flow control

### 13.1 Parallel split

When routing (5.4) selects several unconditional edges, the token splits. The token follows the first selected edge in document order. For each further edge the engine creates a new token whose `parent_token_id` is the original token and whose data is a copy of the original's. From then on each token has its own data.

Tokens on parallel branches make progress concurrently. The order in which activities on different branches execute is unspecified.

### 13.2 Join

An activity or event has a `join` mode that says what happens when it has more than one incoming edge:

| `join` | Behaviour |
|---|---|
| `any` (default) | Every token that arrives executes the node. A node reached by two tokens executes twice. |
| `all` | The engine waits until a token has arrived over **every** incoming edge, merges those tokens into one, and executes the node once. |

With `all`, a token that arrives is `joining`. When every incoming edge has delivered a token:

- The tokens' data are merged property by property in the document order of the incoming edges. On a conflict the later edge's value applies. The per-activity record under `activities` (5.2) is merged as well, so no branch's result is lost.
- One token continues with the merged data. The others become `joined`.

If no token is `active` or `waiting` while some are `joining`, the join can never complete. The engine MUST fail those tokens with error code `JOIN_DEADLOCK`; it MUST NOT wait indefinitely. A join `all` after an exclusive choice is a modelling error that this rule turns into a visible failure.

### 13.3 Failure with parallel branches

When a token fails, the engine MUST cancel every token that is `active`, `waiting` or `joining`, recording `token.cancelled`. Work in flight on other branches when the failure occurs is allowed to finish its current activity; its tokens are then cancelled and do not proceed.

### 13.4 Events

A token at an event node is handled according to the event's `event_type`:

| `event_type` | Behaviour |
|---|---|
| `start`, `intermediate` | The token is routed onward (5.4) |
| `end` | The token is `completed` |
| `timer` | The token is held for a duration, then routed onward (13.5) |
| any other | The token is `failed` with error code `UNSUPPORTED_EVENT` |

An engine MUST NOT pass a token through an event it does not implement. `message`, `signal`, `conditional` and `error` events are reserved for a future version.

### 13.5 Timers

A timer event has `event_definition.duration`, an ISO 8601 duration of weeks, days, hours, minutes and seconds. Years and months are not allowed, having no fixed length. An invalid duration is rejected at validation with error code `invalid_timer`.

When a token reaches a timer the engine records the deadline (`timer.started`, with `due_at`) and persists it before waiting. When the deadline passes it records `timer.fired` and routes the token. A run that is recovered (10.3) while a timer is pending waits only for the time remaining; the timer does not start again.

### 13.6 Compensation

An activity MAY name a **compensation handler**: another activity, in `compensation.activity_id`, that undoes its effect. A handler stands outside the normal flow: it MUST NOT be the target of any edge (error code `invalid_compensation`), and a run never starts at one.

When a run fails, before recording `run.failed`, the engine MUST compensate every activity that completed in the run and names a handler:

- Handlers execute one at a time, in reverse order of the completion of the activities they undo.
- A handler receives the output of the activity it undoes and a description of the failure. It receives an idempotency key (10.4) so that it can be made safe to repeat.
- A handler that raises is recorded as `activity.compensation_failed`; the remaining handlers still execute.

`run.failed` carries `compensation.attempted` and `compensation.succeeded`. A run in which these differ needs human attention: some effects were not undone.

Compensation does not change the run status. A compensated run is still `failed`.

## Appendix A. Conformance suite

`spec/conformance/` holds language-neutral cases.

**Document cases** (`documents/*.json`) each give a `document`, whether it is `valid`, and for invalid documents the `stage` at which it must be rejected (`schema` or `integrity`) and the `error_code`.

**Execution cases** (`execution/*.json`) each give:

| Field | Meaning |
|---|---|
| `level` | Conformance level the case belongs to |
| `spec` | Section the case tests |
| `workflow` | The workflow to run |
| `input` | Data the run starts with |
| `actors` | What each activity returns, keyed by activity name: `output`, or `error` (optionally with an error `code`), or `attempts` (a list of those, one per execution; the last repeats) |
| `expect.status` | The run status |
| `expect.visited` | Activity names in execution order, one entry per execution |
| `expect.visited_unordered` | The same, where parallel branches make the order unspecified |
| `expect.not_visited` | Activity names that must not have executed |
| `expect.data` | A subset that the data of some token must contain |
| `expect.error_matches` | A regular expression some token's `_error` must match |
| `expect.journal` | Event types that must appear in the journal in this order; other events may come between them |
| `expect.journal_contains` | Partial events, each of which some journal event must contain |

A runner replaces every actor with one that follows `actors`, runs the workflow, and compares. An activity not listed in `actors` returns an empty object.

Runners: `sdk/typescript/tests/conformance.test.ts`, `sdk/python/tests/test_conformance.py`.

## Appendix B. Changes from 1.0

- Execution semantics, the condition expression language and verification are now specified normatively.
- A run with a failed token is `failed` (1.0 engines reported `completed`).
- Routing never falls back to the first edge when conditions exist and none is true.
- Verification fails closed.
- `verification` is part of the activity schema; `judge_model_id` has no vendor default.
- `awa_version` added to the workflow.
- Conformance levels and a conformance suite introduced.
- Execution journal with three trace levels (section 9).
- Activity `retry` policy, dead letters, checkpoints, recovery and idempotency keys (section 10).
- Outcome contracts: output schema, postconditions, budgets and human escalation (section 11).
- Vendor-neutral model references with capability tiers (section 12).
- Parallel split, synchronising join, start, end and timer events, fail-fast cancellation and compensation (section 13).
- Several unconditional edges from one node are now a parallel split; 1.0 engines followed only the first.
