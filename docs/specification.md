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
14. [Explaining a run](#14-explaining-a-run)
15. [Knowledge](#15-knowledge)
16. [Model decisions](#16-model-decisions)
17. [Tools](#17-tools)
18. [Business events](#18-business-events)
19. [Journeys](#19-journeys)
20. [Counterfactual replay](#20-counterfactual-replay)
21. [Measures](#21-measures)
22. [Contexts](#22-contexts)
23. [Service levels](#23-service-levels)
29. [Hosts that share a store](#29-hosts-that-share-a-store)

## 1. Scope

AWA standardises four things:

- **The document**: how a workflow is written down (section 4).
- **The behaviour**: what an engine does with that document (sections 5 to 7).
- **The record**: what an engine writes down while it runs, so a run can be explained, replayed and rebuilt (sections 9 and 14).
- **The knowledge**: how what was learned from runs is kept and exchanged (section 15).

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
| `routing` | Resolves model references and routes model calls through tiers with ordered fallbacks | 12 |
| `flow` | Parallel split and join, events, timers and compensation | 13 |
| `knowledge` | Distils journals into knowledge that compounds, and gives actors only what a person has reviewed | 15.1 to 15.4 |
| `events` | Publishes business events and holds tokens until one arrives or a deadline passes | 18 |
| `model_decision` | Lets a model decide at a decision node, within enumerated options | 16 |
| `tools` | Runs tool calls through one runner that refuses, records and bounds them | 17 |
| `journeys` | Hosts journeys: stages, triggers, exits, touchpoints, mood, several journeys, and a host that restarts | 19 |
| `replay` | Replays a recorded run under a changed workflow or model and reports the difference | 20 |
| `measures` | Computes the measures of journeys and workflows from what was recorded | 21 |
| `contexts` | Gives an activity the contexts it is bound to and no other, and refuses writes its bindings do not allow | 22 |
| `service_levels` | Compares the time work takes with what was promised, and records warnings and breaches | 23 |
| `shared_store` | Lets several hosts keep journeys and runs in one store and take any work, with the outcome of one host: no event taken twice or lost, no record with a gap | 29 |

An implementation MUST NOT claim a level unless it passes every case tagged with that level. It MUST report the cases it skips; it MUST NOT silently omit them.

### 2.2 Current implementations

| SDK | Levels claimed |
|---|---|
| TypeScript (reference) | `document`, `core`, `decision`, `verified`, `recorded`, `resilient`, `contract`, `routing`, `flow`, `knowledge`, `events`, `model_decision`, `tools`, `journeys`, `replay`, `measures`, `contexts`, `service_levels`, `shared_store` (with PostgreSQL, through the optional package `pg`) |
| Python | every level: `document`, `core`, `decision`, `verified`, `recorded`, `resilient`, `contract`, `routing`, `flow`, `knowledge`, `events`, `model_decision`, `tools`, `journeys`, `replay`, `measures`, `contexts`, `service_levels`, `shared_store` (with PostgreSQL, through the extra `postgres`). Without a built-in AI agent that calls a model, the recipe, or Open Knowledge Format exchange. A Python host and a TypeScript host can share one store (29.5) |
| Java | none: a data model that reads and writes 1.1 documents faithfully, without validating them, and no engine |

### 2.3 Versions

Two things carry a version, and they are independent.

| What | Version | Where it appears | Changes when |
|---|---|---|---|
| The specification | `major.minor`, e.g. 1.1 | `awa_version` in documents, `spec_version` in journal events | The rules in this document change |
| An SDK | Semantic version, e.g. 2.0.0 | The package | Its behaviour changes: major for any change that makes a previously valid workflow fail or behave differently, minor for additions, patch for fixes |

| SDK | Implements specification |
|---|---|
| TypeScript 1.x, Python 1.x | 1.0 |
| TypeScript 2.x, Python 2.x | 1.1 |

An SDK moved from 1.x to 2.0 for specification 1.1 because 1.1 is stricter: Appendix B lists what changed.

### 2.4 Normative and informative artefacts

The JSON Schemas in `spec/json-schema/` and this document are normative. The Avro, OpenAPI, GraphQL and PostgreSQL DDL files in `spec/` are informative projections of the same model, kept in step with version 1.1; where they differ from the JSON Schemas, the JSON Schemas apply.

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
| Every edge `condition` and every postcondition is a valid condition expression (section 6); every decision table entry is a valid entry (5.5.1) | `invalid_expression` |
| Every decision rule has one input entry per input column and one output entry per output column | `invalid_rule` |
| Every `compensation.activity_id` names an activity in the workflow | `invalid_reference` |
| No compensation handler is the target of an edge | `invalid_compensation` |
| Every timer event has a valid `event_definition.duration` | `invalid_timer` |
| Every message or signal event has `event_definition.name`; a `timeout` is a valid duration; a `timeout_edge_id` names an edge leaving the event | `invalid_event` |
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
- If the result has an `output` property that is a JSON object, that object's properties are merged as well. An AI agent's outcome fields are therefore addressable directly: after an agent returns `{ "output": { "score": 9 } }`, the condition `score > 5` is true.
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

A decision node routes a token. It performs no work. What decides is one of:

| Decided by | Field | Nature |
|---|---|---|
| A decision table | `decision_table` | Native to AWA, deterministic, specified here. Every engine evaluates it the same way |
| An external decision engine | `decision_engine` | A rule engine the deployment already runs (5.5.4) |
| A language model | `decision_model` | For judgement that cannot be written as rules (section 16) |

A node has a table or an external engine, not both, and MAY add a model for the cases those leave undecided.

#### 5.5.1 Entries

Each rule has exactly one input entry per input column. An entry is a test applied to the token data property the column names.

```
entry   := "-" | "*" | ""                          any value
         | "not(" tests ")"                        none of the tests holds
         | tests
tests   := test ( "," test )*                      at least one test holds
test    := "null" | "not null"
         | ( ">" | ">=" | "<" | "<=" | "=" | "==" | "!=" | "<>" ) literal
         | ( "[" | "(" ) literal ".." literal ( "]" | ")" )
         | "in" "(" literal ( "," literal )* ")"
         | "not in" "(" literal ( "," literal )* ")"
         | "contains(" string ")" | "starts with" string | "ends with" string | "matches(" string ")"
         | literal                                 equality
literal := number | "string" | 'string' | true | false | word
```

- A value is **missing** when the property is absent or null. A missing value satisfies only `-`, `null`, and tests that are negations: `!=`, `not in`, `not(...)`.
- Equality with a number compares numerically; with a boolean, to that boolean; otherwise as text. A bare `word` is text.
- `>`, `>=`, `<`, `<=` and ranges compare numerically when the literal is a number, and are false if the value is not a number. When the literal is text they compare as text, which orders ISO 8601 dates and times correctly.
- In a range, `[` and `]` include the bound; `(` and `)` exclude it.
- `matches` takes a regular expression, found anywhere in the value unless anchored.

An entry that does not fit the grammar is an error. A processor MUST reject it at validation (`invalid_expression`), as it MUST a rule whose number of input or output entries differs from the number of columns (`invalid_rule`). The file `spec/conformance/unary-tests.json` holds entries, values and expected results that every implementation MUST reproduce.

#### 5.5.2 Hit policies

A rule matches when every one of its entries is satisfied. The hit policy says which matching rule decides.

| Hit policy | Deciding rule | If the matches contradict the policy |
|---|---|---|
| `first` | The first matching rule in document order | |
| `unique` | The only matching rule | More than one rule matches: conflict |
| `any` | Any matching rule, since all must give the same outputs and edge | Two matching rules differ: conflict |
| `priority` | The matching rule with the highest `priority` (default 0); among equals, the earlier | |
| `collect`, `rule_order` | All matching rules. Each output is the list of their values in document order. The edge is that of the first matching rule that names one | |

A **conflict** is a defect in the table, not a routing outcome. The token MUST fail with error code `DECISION_CONFLICT`. An engine MUST NOT take the default edge on a conflict, because that would hide the defect.

For `unique` and `any` an engine MUST evaluate every rule, since it cannot otherwise detect a conflict.

#### 5.5.3 Outputs and routing

The outputs of the deciding rule, named by the output columns, are **merged into the token's data**. A later condition, or another decision node, can therefore use what a decision derived. Decision nodes MAY be connected directly to one another; the second reads the outputs of the first. The engine also keeps each decision under `decisions.<node id>`.

The token moves along the deciding rule's `output_edge_id`. If the rule names none, or no rule matches, the token moves along the node's `default_output_edge_id`. If there is none, the token fails with `NO_ROUTE`.

#### 5.5.4 External decision engines

Decision tables cover decisions that are one pass over the facts. Some organisations already hold their rules in a production rule engine with forward chaining, or in a decision service. A decision node MAY consult such an engine instead of a table:

| Field | Meaning |
|---|---|
| `name` | The engine, as registered by the deployment |
| `ruleset` | What the engine should evaluate. Its meaning is the engine's |
| `options` | The only possible decisions: each an `id` and the `output_edge_id` it takes |
| `inputs` | The token data properties the engine is given. Default: all |
| `config` | Passed to the engine unchanged |

The engine receives the node, the rule set, the options and the facts, and returns the `id` of one option. It MAY also return outputs, which are merged into the token's data, an explanation, and the names of the rules that fired.

The engine is bounded as a decision model is. An option that was not offered, no option, or a failure of the engine is **no decision**: the node's model decides if it has one, otherwise the default edge is taken, otherwise the token fails. If the engine a node names is not registered, the token fails with `VALIDATION_ERROR`; an engine MUST NOT substitute another way of deciding.

This specification does not define how an external engine evaluates its rules. A workflow that uses one is portable only to deployments that register an engine of that name. Workflows meant to be portable SHOULD use decision tables.

### 5.6 Waiting

An activity performed by a `human` actor MAY leave its token `waiting`. The engine resumes the token when the task is completed, merges the human's output into the token's data, and routes it (5.4).

### 5.7 Run outcome

A run has a status derived from its tokens:

| Run status | Condition |
|---|---|
| `running` | At least one token is `active` |
| `waiting_human` | No token is `active` and at least one is `waiting` for a person |
| `waiting_event` | No token is `active`, none waits for a person, and at least one is `waiting` for a business event (18.3) |
| `failed` | At least one token is `failed` (the others are then cancelled, 13.3) |
| `completed` | Every token is `completed` or `joined` |
| `cancelled` | The host withdrew the run (5.8) |

An engine MUST NOT report `completed` for a run in which any token failed.

When an activity raises an error, its token is `failed` and the error message is recorded in the token's data as `_error`.

### 5.8 Cancellation

A host MAY withdraw a run that has not reached an outcome, because the work is no longer wanted: the customer withdrew, the order was replaced. The engine cancels every token that is `active`, `waiting` or `joining` (`token.cancelled` with reason `run_cancelled`), compensates as for a failure (13.6), and records `run.cancelled` with the reason the host gave. The run is `cancelled`; it is neither `completed` nor `failed`, and it accepts no further events. Cancelling a run that already reached an outcome changes nothing.

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
| `roles` | Role[] | Roles the activities refer to, with their model references |
| `activities` | Activity[] | Units of work |
| `edges` | Edge[] | Connections between nodes |
| `events` | Event[] | Events |
| `decision_nodes` | DecisionNode[] | Decision tables |
| `contexts` | Context[] | Shared contexts |
| `sla` | SLA | Service level of the run as a whole (section 23) |
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
| `context_bindings` | ContextBinding[] | Contexts the activity reads or writes (section 22) |
| `access_rights` | AccessRight[] | Permissions required or provisioned |
| `programs` | Program[] | Executable code or tools |
| `controls` | Control[] | Governance policies |
| `skills` | SkillBinding[] | Knowledge or competency required |
| `tool_requirements` | ToolRequirement[] | Tools or interfaces required |
| `join` | enum | `any` (default) or `all` (13.2) |
| `compensation` | object | The activity that undoes this one (13.6) |
| `knowledge` | object | Which knowledge from earlier runs the actor is given (15.4) |
| `tools` | Tool[] | Functions the actor may call, each bound to what it runs (section 17) |
| `verification` | VerificationPolicy | Acceptance criteria (section 7) |
| `retry` | RetryPolicy | What to do when the actor raises an error (section 10) |
| `outcome_contract` | OutcomeContract | What must be true of the outcome (section 11) |
| `sla` | SLA | Activity-level service level (section 23) |
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
| `model_selection` | A model is chosen for an attempt or a decision |
| `model_route` | The route was anything other than "first candidate used": a candidate was skipped or failed, even when it was the only one (12.5) |
| `retry` | An attempt raised and will be retried |
| `verification_retry` | An output was rejected by verification and the activity will be re-executed with feedback |
| `contract_retry` | An outcome violated its contract and the activity will be re-executed with feedback |
| `escalation` | A rejected outcome is handed to a human |

### 9.3 Event types

| Type | Level | Recorded when | Main `data` |
|---|---|---|---|
| `run.started` | execution | A run begins | `workflow_name`, `workflow_version`, `input` |
| `run.completed`, `run.failed` | execution | The run reaches its outcome (5.7) | `duration_ms`, `steps`, token and cost totals; `errors` on failure |
| `run.cancelled` | execution | The host withdrew the run (5.8) | `reason`, `compensation` |
| `run.waiting` | execution | No token is active and at least one waits | `waiting_tokens` |
| `run.resumed` | execution | A run continues from a checkpoint (10.3) | `from_seq`, `from_checkpoint_at` |
| `token.created` | execution | A token comes into existence | `parent_token_id` and `reason: parallel_split` for a split |
| `token.joined` | execution | Tokens are merged at a join | `merged_token_ids`, `incoming_edge_ids` |
| `token.cancelled` | execution | A token is withdrawn because the run failed | `reason` |
| `timer.started`, `timer.fired` | execution | A token reaches a timer event; the timer elapses | `duration`, `due_at` |
| `event.published` | execution | A token passes a publishing event (18.2) | `event_id`, `name`, `source`, `data`, `delivered` |
| `context.read` | execution | An activity is given the contexts it is bound to read (22.2) | `contexts`: for each, `context_id`, `context_name`, `access_mode`, `present`, `value_hash` |
| `context.written`, `context.denied` | execution | A write to a context is applied, or refused (22.3) | `context_name`, `sync_pattern`, `access_mode`, `value_hash`; or `reason` |
| `sla.warning`, `sla.breached` | execution | Work passed the point of warning, or its longest time (23.2) | `scope`, `elapsed_ms`, `threshold` or `max_time`, `action`, `name`, `notify_roles` |
| `event.waiting` | execution | A token is held at a waiting event (18.3) | `name`, `correlation_key`, `correlation_value`, `due_at` |
| `event.received` | execution | A business event released a held token | `event_id`, `name`, `source`, `data` |
| `event.timed_out` | execution | The deadline of a waiting event passed | `name`, `due_at` |
| `activity.compensated`, `activity.compensation_failed` | execution | A compensation handler ran, or raised | `compensates_activity_id`, `output` or `error` |
| `token.moved` | execution | A token follows an edge | `from_node_id`, `to_node_id`, `edge_id`, `reason` (`condition`, `default`, `unconditional`, `parallel_split`, `decision`), `condition` |
| `token.completed`, `token.failed` | execution | A token ends | `error` on failure |
| `token.waiting`, `token.resumed` | execution | A token pauses for, or returns from, an external party | `reason`, `waited_ms` |
| `activity.started` | execution | An attempt begins | `actor_type`, `input`, `feedback` |
| `activity.completed` | execution | An attempt's output is accepted | `output`, `duration_ms`, `attempts`, `usage` |
| `activity.failed` | execution | An attempt raised, or its output was rejected | `error.message`, `error.code`, `retryable` |
| `activity.retry_scheduled` | execution | A further attempt will follow an error | `delay_ms`, `next_attempt` |
| `activity.dead_lettered` | execution | Retries are exhausted | `error`, `attempts` |
| `decision.evaluated` | execution | A decision node is evaluated | `method` (`table`, `engine`, `model`, `default`, `none`), `inputs`, `matched_rules`, `outputs`, `edge_id`, `used_default`, `conflict`; for an external engine `engine` (name, rule set, option, fired rules, explanation); for a model decision `model` (16.4) |
| `tool.invoked` | execution | A tool call is about to run | `call_id`, `tool`, `link`, `binding`, `arguments`, `documentation` |
| `tool.completed` | execution | A tool call returned | `call_id`, `tool`, `link`, `status`, `duration_ms`, `result` |
| `tool.failed` | execution | A tool call failed, or was refused before running | `call_id`, `tool`, `link`, `invoked`, `error`, `status`, `duration_ms` |
| `verification.completed` | execution | An output has been verified | `mode`, `verdict`, `score`, `criteria`, `feedback`, `output_hash` |
| `contract.checked` | execution | An outcome has been checked against its contract | `passed`, `violations`, `tokens_used`, `output_hash`, `decided_by` |
| `contract.escalated` | execution | A rejected outcome is handed to a human | `code`, `message`, `rejected_output` |
| `knowledge.retrieved` | execution | An actor is given knowledge entries | `entries` (id, type, title, status, observations) |
| `reasoning.recorded` | reasoning | An actor reports its reasoning | `plan`, `rationale`, `alternatives_considered`, `confidence` |
| `meta.recorded` | meta | The engine makes a decision listed in 9.2 | `subject`, `decision`, `rationale` |

Every attempt of an activity is bracketed: one `activity.started`, then exactly one of `activity.completed` or `activity.failed`, with the same `attempt` number.

### 9.4 Payloads

Activity inputs and outputs may be sensitive. An engine MUST support three payload modes and MUST apply the chosen one to every `input`, `output`, tool `arguments` and tool `result` it journals:

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
| `max_tool_calls` | Most tool calls in one attempt (default 16) | Further calls are refused; an agent that cannot finish without them fails the attempt with `TOOL_BUDGET_EXCEEDED` |

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

The engine default is the deployment's configuration: the reference implementations read it from one setting (`default_ai_model_id`, overridden by `AWA_DEFAULT_AI_MODEL_ID`). A deployment maps the standard tiers (`reasoning`, `balanced`, `fast`) to models; a standard tier it leaves unmapped MAY take a mapping the implementation documents for the providers registered (the reference ones use published presets for the providers they know, and otherwise the default model of the default provider). Whatever mapping applied is recorded by `model_selection`.

A reference that cannot be resolved (an unmapped tier, or no provider) is an error with code `VALIDATION_ERROR`. An engine MUST NOT substitute another model silently. At a decision node the error is a vote that cannot be cast: it is invalid (16.3), so the decision falls to its default edge or fails with `NO_ROUTE`.

The engine MUST journal each resolution as a `meta.recorded` event with subject `model_selection`, giving the provider, the model, the tier if one was used, and why that reference applied.

### 12.4 Providers

A provider is an adapter between the engine's unified request and one vendor's or runtime's interface. The unified request carries a model name, a conversation (system, user, assistant and tool turns), optionally the tools the model may call, whether a JSON reply is wanted, and sampling settings. The unified response carries text, any tool calls the model asks for, and input and output token counts.

An adapter MAY return opaque continuation data with a response. The caller MUST give it back, unchanged, on the assistant turn when it continues the conversation. This is how vendor-specific data that a model needs returned (for example signatures attached to its tool calls) survives without the engine knowing about it.

A provider declares whether it can call tools.

The reference SDK ships these adapters, and accepts others through `model_providers`:

| Provider | Reaches | Tools |
|---|---|---|
| `google` | Google Gemini | yes |
| `openai` | OpenAI, through the Responses API | yes |
| OpenAI-compatible | Any server exposing `chat/completions`: hosted gateways and the usual ways of serving open-source models (Ollama, llama.cpp, vLLM, LM Studio, LocalAI) | yes, if the served model supports them |
| `ollama` | Open-source models on a local Ollama | as above |
| `embedded` | A small open-source model running inside the engine's own process | no |

### 12.5 Routing

All model calls go through one router. Given a model reference and a request, the router:

1. Lists the candidates. A tier MAY map to an ordered list of model references; a direct reference has one candidate. Candidates whose provider is not registered in this deployment are left out, so the same tier map serves deployments with different providers.
2. Skips a candidate whose provider cannot serve the request: in particular one that cannot call tools, when the request carries tools.
3. Calls the first remaining candidate. If the provider fails, it tries the next. It does not try further candidates after a provider rejects the request as invalid, since the request would be invalid for them too.
4. Fails, with the whole route, if no candidate served the request.

Whenever the route was anything other than "first candidate used", the engine MUST journal it as a `meta.recorded` event with subject `model_route`, naming each candidate skipped or failed and why.

A deployment that must keep working without its cloud provider maps each tier to a list ending in a local model, for example `fast: [google:…, ollama:…, embedded:default]`.

### 12.6 Open-source and embedded models

An engine MUST be usable with open-source models only, with no proprietary provider registered.

The `embedded` provider runs a small model in the engine's process: no server, no key, and no data leaves the machine. The reference SDK uses ONNX models through Transformers.js (an optional dependency), by default a model of a few hundred million parameters with 4-bit weights, and can load weights from a local directory for use without network access. An embedded model keeps a workflow running when no other model is reachable, and suits simple, high-volume calls. It does not call tools, so the router never selects it for a request that carries them.

Small models follow a reply format more reliably than they judge. In the reference implementation's measurements (`docs/embedded-models.md`), models under one billion parameters always returned a valid option and chose correctly no more often than chance. A deployment SHOULD therefore place an embedded model last in a tier, and SHOULD pair model decisions made by one with `min_confidence` and a default edge that leads to a person (section 16).

### 12.7 Conformance

Level `routing` covers 12.1, 12.2, 12.5 and the rule of 12.3 that no other model is substituted, where an engine itself calls a model, which is at a decision node with a `decision_model` (section 16): the three forms of reference, tiers with ordered candidates, fallback, the end of a route, and the `model_selection` and `model_route` records. Its cases are execution cases (Appendix A) whose scripted `model` describes several providers and the tier map. Routing of an AI agent's and a judge's calls (12.3), the skipping of a provider that cannot call tools, and the adapters of 12.4 and 12.6 are fixed by `sdk/typescript/tests/router_tools_decisions.test.ts` and `contract_models.test.ts`.

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
| `message`, `signal` | A business event is published, or the token is held until one arrives (section 18) |
| any other | The token is `failed` with error code `UNSUPPORTED_EVENT` |

An engine MUST NOT pass a token through an event it does not implement. `conditional` and `error` events are reserved for a future version.

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

## 14. Explaining a run

Two artefacts are derived from a workflow definition and the journal of one run. Both are pure functions of those two inputs: an implementation MUST NOT consult anything else, and the same inputs MUST give the same result.

### 14.1 Recipe

A **recipe** is a document that explains how to build the workflow from scratch and what one run of it did. It is the runbook of the run, condensed. A recipe MUST contain, in this order:

| Section | Content |
|---|---|
| 1. What this workflow achieves | The workflow's purpose, and for the run its outcome, duration, attempts, tokens and cost |
| 2. What you need before you start | Roles and actor types; each model reference and what it resolved to; tools, programs and skills; shared contexts; access rights; the conformance levels the engine must claim |
| 3. Build it, step by step | Every node. Nodes the run reached come first, in the order reached; the rest follow, marked as not reached. For each activity: its purpose and procedure, its outcome contract, acceptance criteria, retry policy, compensation and outgoing routes. Then what the run did there: each attempt with its result, the actor's reported plan, rationale and rejected alternatives, contract and verification results, and each engine decision with its rationale |
| 4. Wire the flow | Every edge with the condition under which it is taken, and whether the run took it |
| 5. What this run taught | Every rejected or failed attempt and how it was resolved; compensations; cancellations; the cause of failure, if the run failed |
| 6. Check your build | How to validate, run and compare a rebuild against this run |
| Appendix | The complete workflow definition |

With the appendix, a recipe alone is sufficient to reconstruct the workflow. An implementation MAY let the appendix and the payload samples be omitted, for recipes that must not carry data.

The recipe states what the actor **reported** as its reasoning (9.2). It MUST NOT present that report as a verified account of how a model computed its answer.

The reference implementation writes recipes as Markdown: `awa recipe <workflow> <journal>`.

### 14.2 Replay

A **replay** presents a run visually and lets a person move through it. An implementation of replay MUST:

- derive what it shows at position *p* solely from the journal events 1 to *p*, so that moving backwards, forwards or directly to any position shows the same picture for the same position;
- show, for every node, whether it has not been reached, is running, is waiting or retrying, is done, has failed, or has been compensated;
- show which edges tokens have taken, and where each live token is;
- let the person step one event at a time in both directions, move directly to any event, and play the run continuously;
- let the person inspect any node: its definition, and every attempt made there with its reasoning, checks and engine decisions up to the current position;
- distinguish the three trace levels (9.2).

A replay that follows a run in progress SHOULD read the journal as Server-Sent Events (9.5).

The reference implementation is `tools/visualization/replay.html`.

## 15. Knowledge

Each run teaches something: an approach that was accepted, a mistake and what corrected it, a route a decision took, a cause of failure. The knowledge layer keeps that, so the hundredth run is better informed than the first. Its design rests on four rules: knowledge is **distilled from the journal**, it **compounds**, it is **traceable to its evidence**, and it reaches actors only after **a person has reviewed it**.

### 15.1 Entries

A knowledge entry has:

| Field | Meaning |
|---|---|
| `id` | Its path in a bundle, without `.md`, for example `strategies/claims-assess-damage` |
| `type` | `strategy`, `failure_pattern`, `decision_precedent` or `lesson` |
| `title`, `description`, `tags` | For people and for search |
| `scope` | The workflow, and the node, the entry is about |
| `status` | `draft`, `reviewed` or `deprecated` |
| `observations` | The number of runs that contributed evidence |
| `counts` | Counters that add up across runs |
| `latest` | Facts from the most recent contributing run |
| `sources` | For each contributing run: its `run_id` and the `seq` of each journal event used |
| `reviewed_by`, `reviewed_at`, `superseded_by` | Review and replacement |

| Type | Distilled from | Tells an actor or a designer |
|---|---|---|
| `strategy` | The reasoning reported with an **accepted** outcome | An approach that worked for this activity, and how often it is accepted first time |
| `failure_pattern` | A rejected or errored attempt, with the terms or criteria it failed | What goes wrong here, how often, and what resolved it |
| `decision_precedent` | A decision evaluation | Which inputs matched which rule and where they were routed |
| `lesson` | A failed run | Where and why runs of this workflow fail, and whether their effects were undone |

### 15.2 Distillation

Distillation derives candidate entries from the journal of one run. It MUST be deterministic and MUST NOT call a model: the same journal always yields the same candidates. Every candidate MUST cite the journal events it was derived from.

A candidate's `id` is derived from what it is about (the workflow, the node, and for a failure the terms or the error that characterise it), not from the run. Two runs that exhibit the same pattern therefore produce the same `id`.

### 15.3 Compounding

Ingesting a run into a knowledge base MUST:

- create, as `draft`, each candidate whose `id` is new;
- for each candidate whose `id` exists: add its `counts` to the entry's, replace `latest`, add the run to `sources`, and increase `observations` by one;
- leave the entry's `status` unchanged, so reviewed knowledge stays reviewed as evidence accrues;
- be idempotent: ingesting a run that was already ingested changes nothing.

### 15.4 Review and use

Only a person makes an entry `reviewed`. An implementation MUST record who and when.

An activity asks for knowledge with a `knowledge` binding:

| Field | Default | Meaning |
|---|---|---|
| `types` | `strategy`, `failure_pattern` | Entry types wanted |
| `tags` | any | Only entries with at least one of these tags |
| `max_entries` | 5 | Most entries given |
| `min_status` | `reviewed` | `draft` also admits unreviewed entries |

When such an activity executes, the engine gives the actor the matching entries about that activity, reviewed entries first and then by `observations`, and records `knowledge.retrieved` listing them. An engine MUST NOT give an actor a `deprecated` entry, and MUST NOT give a `draft` entry unless the binding sets `min_status: draft`. Activities without a binding receive no knowledge.

Knowledge informs the actor's strategy. It never relaxes the outcome contract (section 11): an outcome produced with knowledge is checked exactly as any other.

### 15.5 Portability: Open Knowledge Format

Knowledge is exchanged as an Open Knowledge Format (OKF) bundle, version 0.3: a directory of Markdown files with YAML frontmatter, one concept per file, that any OKF consumer can read without AWA software. An implementation MUST be able to export a knowledge base as a conformant bundle and import one.

| AWA | OKF |
|---|---|
| Entry `id` | The concept's path |
| `type` | `type`: `Strategy`, `Failure Pattern`, `Decision Precedent`, `Lesson` |
| `title`, `description`, `tags` | `title`, `description`, `tags` |
| `scope` | `resource`: `urn:awa:workflow:<workflow id>:node:<node id>` |
| `status` `draft` / `reviewed` / `deprecated` | `status` `draft` / `stable` / `deprecated` |
| `reviewed_by`, `reviewed_at` | `verified`: one event with `by: human:<reviewer>` and `at` |
| `updated_at` | `generated.at`, with `generated.by: agent:awa-distiller` |
| `sources` | `sources`: one per run, `resource: urn:awa:run:<run id>` |
| `superseded_by` | `superseded_by`: the bundle path of the replacement |
| Everything else | Extension keys named `x-awa-<name>` |

The bundle has a root `index.md` whose frontmatter declares `okf_version: "0.3"`, an `index.md` per type directory, and a `log.md` recording creations, updates, reviews and deprecations by date. The Markdown body of each concept is rendered from the entry's data, so a reader needs none of the extension keys to understand it.

An import MUST restore AWA-written concepts exactly, including which runs were already ingested. Concepts written by other producers are imported as entries with their text preserved; a foreign concept whose OKF status is absent or `stable` is treated as `reviewed`.

### 15.6 Conformance

Level `knowledge` covers 15.1 to 15.4. It has its own cases, in `spec/conformance/knowledge/` (Appendix A): scripted runs, the ingestion of their journals, reviews, and what the knowledge base then holds and what actors are given. The contents of `counts` and `latest`, the `tags` and `max_entries` of a binding, and the Open Knowledge Format exchange (15.5) are fixed by `sdk/typescript/tests/knowledge.test.ts`.

## 16. Model decisions

A decision table needs every case anticipated as a rule. Some routing depends on judgement that cannot be written that way. A decision node MAY therefore carry a `decision_model`, which lets a language model decide. To keep the outcome predictable, the model's freedom is bounded on every side: it picks from options the workflow enumerates, its reply is validated, and anything else is no decision.

### 16.1 Definition

| Field | Default | Meaning |
|---|---|---|
| `model` | engine default | Model reference (12.1). Decisions are a natural use of `tier:fast` and of embedded models |
| `instructions` | required | How to decide, in natural language |
| `options` | required, at least 2 | The only possible decisions. Each has an `id`, a `description` of when it applies, and the `output_edge_id` it takes |
| `inputs` | all token data | The token data properties the model is shown |
| `strategy` | `table_first` if the node has a table or an external engine, else `model` | See 16.2 |
| `output` | none | Name of a token data property that receives the id of the chosen option, so later nodes can use it |
| `min_confidence` | 0 | A decision with lower, or unstated, confidence is no decision |
| `votes` | 1 | Number of independent samples (16.3) |
| `temperature` | 0 for one vote, 0.7 for several | Sampling temperature |

A decision node has a `decision_table`, a `decision_model`, or both. Every option's edge MUST leave the node, and option ids MUST be unique (4.3).

### 16.2 Strategy

| Strategy | Behaviour |
|---|---|
| `table_first` | The table, or the external engine, is consulted first (5.5). If it decides, **no model is called**. Otherwise the model decides. |
| `model` | The model decides. Any table on the node is ignored. |

`table_first` keeps every anticipated case deterministic and free, and spends a model call only on the remainder.

### 16.3 Deciding

The engine asks the model to reply with a JSON object holding `option`, `confidence` (0 to 1) and `rationale`. The model is shown the node's name and description, the instructions, the options with their descriptions, and the selected inputs. Nothing else.

A reply is a **valid vote** if it names exactly one option id. A reply that is not valid JSON still counts if exactly one option id appears in it, which is how small models often answer; such a vote has no confidence. A reply naming an id that was not offered, more than one id, or none, is an invalid vote. A model that cannot be reached casts an invalid vote.

With `votes` greater than 1 the engine takes that many independent samples. The decision is the option with a **strict majority of all votes cast**, valid or not. Its confidence is the mean of the confidences its votes stated.

There is **no decision** when no option has a strict majority, or when `min_confidence` is above 0 and the confidence is lower or was not stated.

### 16.4 Outcome and record

On a decision the token moves along the option's edge. On no decision it moves along `default_output_edge_id`; if the node has none, the token fails with `NO_ROUTE`. An engine MUST NOT pick an option the model did not validly choose.

`decision.evaluated` records `method`: `table`, `model`, `default` or `none`. For a node with a model it also records under `model` the chosen `option`, the `confidence`, `min_confidence`, every vote (its option, confidence, or why it was invalid), the token usage, and `no_decision_reason` when there was no decision. The model's rationale is journalled as a `reasoning.recorded` event, and the model that served as a `meta.recorded` event with subject `model_selection`.

## 17. Tools

A tool is a function an actor may call while performing an activity: look something up, compute something, make something happen. AWA records every call: which tool, when, with what arguments, what came back, and a link to the API, command or remote procedure that actually ran.

### 17.1 Definition

An activity lists its tools in `tools`. Tool names MUST be unique within the activity.

| Field | Meaning |
|---|---|
| `name` | The name the actor calls |
| `description` | What it does and when to use it. Given to the model |
| `parameters` | JSON Schema of the arguments object |
| `binding` | What runs (17.2) |
| `documentation` | Where the underlying interface is documented, for example an OpenAPI document |
| `timeout` | Longest a call may take (default `PT30S`) |

### 17.2 Bindings

| `kind` | Fields | Runs | Link journalled |
|---|---|---|---|
| `http` | `method`, `url`, `headers` | An HTTP request | The resolved URL, without its query string |
| `command` | `command`, `args` | A program on the engine's host | `command:<program>` |
| `jsonrpc` | `endpoint`, `method` | A JSON-RPC 2.0 call over HTTP | `<endpoint>#<method>` |
| `grpc` | `endpoint`, `service`, `method` | A gRPC call | `grpc://<endpoint>/<service>/<method>` |
| `mcp` | `server`, `tool` | A tool on a Model Context Protocol server | `mcp://<server>/<tool>` |
| `function` | `name` | A handler registered with the engine | `function:<name>` |

In `url` and in each element of `args`, `{name}` is replaced by the argument of that name. For `http`, arguments not used in the URL are sent as query parameters for `GET`, `DELETE` and `HEAD`, and as a JSON body otherwise. For `command`, each element of `args` is passed as exactly one argument and no shell is involved, so an argument's content cannot add commands; if no element uses an argument, the arguments are given as JSON on standard input.

In `headers`, `{{secret:NAME}}` is replaced by a secret the deployment supplies. Headers and secrets MUST NOT be journalled.

An engine MUST implement `http`, `jsonrpc`, `command` and `function`. It MAY implement `grpc` and `mcp` through executors the deployment registers; a call to a kind with no executor fails with `VALIDATION_ERROR`.

### 17.3 Calling

For each call, in this order, the engine MUST:

1. Refuse an unknown tool (`UNKNOWN_TOOL`) and a call beyond `budgets.max_tool_calls` (`TOOL_BUDGET_EXCEEDED`). Every call counts toward the budget, refused ones included.
2. Validate the arguments against `parameters`, and refuse invalid ones (`VALIDATION_ERROR`). Nothing runs.
3. Apply the deployment's permissions (17.4), and refuse what they forbid (`PERMISSION_DENIED`).
4. Record `tool.invoked`.
5. Run the binding, bounded by `timeout`.
6. Record `tool.completed` with the result, or `tool.failed` with the error.

A failed or refused call does not fail the activity by itself. The failure is returned to the actor as the result of the call, so that an agent can read it and act on it. It is journalled either way: `tool.failed` with `invoked: false` for a call refused before it ran.

When the actor is an AI agent, the engine gives the model the tools' names, descriptions and parameters; runs each call the model asks for through the steps above; returns the results to the model; and repeats until the model gives its answer. Other actors call tools through the same runner, so their calls are recorded the same way.

### 17.4 Permissions

A workflow document can name any URL or program. What may actually run is for the deployment to decide:

- `command` bindings MUST NOT run unless the deployment allows commands, either all or a named list. The default is to allow none.
- A deployment MAY restrict `http` and `jsonrpc` bindings to a list of hosts.
- `http` and `jsonrpc` bindings reach `http` and `https` addresses only. Any other scheme (a file, a data URL) is refused with `VALIDATION_ERROR` before anything is called.
- A redirect is a call to another address: each hop is held to the list of hosts, and a hop to a host not on it is refused with `PERMISSION_DENIED`. Headers set by the binding, which may carry secrets, MUST NOT be sent on to a different origin.
- An engine MUST bound what a call may return, and fail a call whose reply is larger. The reference bound is 4 MiB, configurable by the deployment.

### 17.5 Record

| Event | `data` |
|---|---|
| `tool.invoked` | `call_id`, `tool`, `link`, `binding` (kind and what will run: method and URL, or command line, or endpoint and method), `arguments`, `documentation`, `simulated` |
| `tool.completed` | `call_id`, `tool`, `link`, `status` (HTTP status, exit code), `duration_ms`, `result` |
| `tool.failed` | `call_id`, `tool`, `link`, `invoked`, `error.message`, `error.code`, `status`, `duration_ms` |

Each event carries the `time` it was recorded, the `node_id` of the activity and the `attempt` it belongs to, so every call can be placed exactly in the run. `call_id` ties the events of one call together. Tool events fall between the `activity.started` of their attempt and the event that ends it.

Arguments and results follow the payload mode (9.4). The `link` is never hashed or omitted: which interface was called is always on record, even when what was sent is not. Unless the mode is `full`, the link and the binding are recorded as declared, with their placeholders, and not as filled: an argument that became part of an address or of a command line is still an argument.

In simulation an engine MUST NOT run bindings. It records the call with `simulated: true` and returns a result the deployment scripted.

A recipe (14.1) lists every tool with its binding among the prerequisites, and under each attempt the calls it made with their time, link and outcome. A replay (14.2) shows each call as a step, with its link.

### 17.6 Conformance

Level `tools` covers 17.3 to 17.5, and level `model_decision` covers section 16. Their cases are execution cases (Appendix A) with a scripted `tools` or `model`. Bindings other than `function`, and agents that choose their own tool calls, are fixed by `sdk/typescript/tests/router_tools_decisions.test.ts`.

## 18. Business events

A workflow does not live alone. It is started by something that happened in the business, it waits for things to happen, and what it does is of interest to other systems. This section makes those three relations explicit and gives them one shape.

### 18.1 The business event

A **business event** is a statement that something happened. It has the attributes of [CloudEvents 1.0](https://github.com/cloudevents/spec/blob/v1.0.2/cloudevents/spec.md):

| Attribute | Required | Meaning |
|---|---|---|
| `specversion` | yes | `"1.0"` |
| `id` | yes | Unique within `source`. Two events with the same `source` and `id` are the same event |
| `source` | yes | Where it happened, as a URI reference |
| `type` | yes | What happened, for example `documents.uploaded`. This is the name workflows and journeys refer to |
| `time` | no | When it happened |
| `subject` | no | Whom or what it concerns |
| `data` | no | An object with the details |

Events travel between an engine and the outside world through a **host**: the program that runs engines. An engine never opens a connection to a broker. A host that receives events from Kafka, a webhook or a queue translates them to this shape and delivers them; a host that is handed a published event sends it wherever the deployment wants.

### 18.2 Publishing

A message or signal event node with `event_definition.mode` `"publish"` publishes a business event when a token reaches it. The token is not held.

- `type` is `event_definition.name`.
- `data` holds the values of the paths listed in `event_definition.data`, read from the token's data. Nothing else is published: what leaves the run is chosen, never the whole token.
- `id` is `<run_id>:<node_id>:<visit>`, so a recovered run that passes the node again publishes the same event, and a consumer can discard the duplicate.
- `source` is `urn:awa:run:<run_id>`.

The engine records `event.published` before handing the event to the host: the journal is the outbox. If the host reports that it could not send the event, the token is `failed` with error code `EVENT_PUBLISH_FAILED`; a recovered run (10.3) publishes it again under the same `id`.

### 18.3 Waiting

A message or signal event node with `event_definition.mode` `"wait"`, or with no `mode`, holds the token until a matching business event is delivered.

| `event_definition` | Meaning |
|---|---|
| `name` | The `type` to wait for. Required |
| `correlation_key` | For a `message`: a path, read both in the token's data when the wait begins and in the event's `data`. The event matches only if the two values are equal as strings. Without it, every event of the type matches. A `signal` ignores it |
| `timeout` | A duration (13.5). When it passes without a match, the wait times out |
| `timeout_edge_id` | The edge a token takes when the wait times out. It is never taken otherwise |

When a token reaches the node the engine records `event.waiting` with the deadline, sets the token `waiting`, and persists the run. The run is `waiting_event` (5.7).

**Delivery.** When the host delivers an event, the engine finds the held tokens it matches. A `message` releases the first of them, in token order; a `signal` releases all of them. For each, the engine records `event.received`, merges the event's `data` into the token's data (except properties whose names begin with `_`), and routes the token over the edges that leave the node, excluding the `timeout_edge_id`.

Delivery is **idempotent**: an engine MUST ignore an event whose `id` it has already accepted for the run. The set of accepted events is part of a checkpoint (10.3).

An event that matches no held token is not kept by the engine. A host MAY keep it and deliver it later; the reference host does not, so a workflow should begin to wait before the event can occur.

**Timeout.** When the deadline passes, the engine records `event.timed_out`. With a `timeout_edge_id` the token takes that edge. Without one the token is `failed` with error code `EVENT_TIMEOUT`: a wait that nobody planned an answer for MUST NOT hang, and MUST NOT continue as if the event had arrived.

An engine does not watch the clock for held tokens. The host asks for the next deadline and tells the engine when it has passed, which lets a run that waits two weeks cost nothing while it waits.

### 18.4 Starting

A `start` event MAY carry `event_definition.name`. It declares which business event starts the workflow. An engine does nothing with it; a host uses it, or a journey trigger (19.3), to start a run with the event's `data` as input.

### 18.5 Conformance

Level `events` covers 18.2 and 18.3. Its cases use a `deliver` list: after the run settles, the runner delivers each event in turn, or lets the pending deadlines pass with `{"expire": true}`, and then compares.

## 19. Journeys

A workflow describes how one piece of work is done. A customer, a supplier or an order lives through several of them, over days or months, with waiting in between. A **journey** is the layer that describes that life: the stages a subject passes through, which workflows serve each stage, and what counts as success.

A journey does not replace workflows and has no tokens. It is a small state machine over business events. Everything it knows, it learned from an event or from the end of a run.

### 19.1 Definition

A journey definition conforms to `spec/json-schema/journey.schema.json`:

| Property | Meaning |
|---|---|
| `id`, `name`, `version` | Identity |
| `subject.name` | What travels: "customer", "order" |
| `subject.key` | The path in event `data` that identifies one subject. Events with the same value belong to the same journey instance |
| `stages` | Ordered list of stages (19.2) |
| `triggers` | What business events do to the journey (19.3) |
| `goals` | Each has an `id`, a `name` and an `expression` (section 6) over the journey's data. Reaching one is recorded once |
| `exits` | Business events that end the journey, each with the `outcome` (`completed` or `abandoned`) and a `reason` |
| `collect` | Paths of event and run data to keep as the journey's data. When absent, all of it is kept |
| `artefacts` | The kinds of thing that change hands (19.8) |
| `touchpoints` | The moments of contact, with channel, technology and what is exchanged (19.8) |
| `sentiment` | How the subject's mood is estimated (19.9) |

### 19.2 Stages

| Property | Meaning |
|---|---|
| `id`, `name`, `description` | Identity |
| `workflows` | Ids of the workflows that do the work of this stage. Informative: it is what a reader and a visualisation use to link the two layers |
| `on_enter.start_workflow` | A workflow the host starts when the stage is entered, with the journey's data as input |
| `complete_when` | A condition (section 6) over the journey's data. The stage is complete when it becomes true |
| `max_duration` | A duration (13.5). A stage that lasts longer is **stalled** |
| `owner` | Who must act when the journey stalls in this stage: a team, a role or a person, as the organisation names them. `journey.stalled` carries it |
| `transitions` | A list of `{to, condition, is_default}`. When the stage completes, the first whose `condition` is true names the next stage; failing that, the one marked `is_default`, or one with no condition |

When a stage completes and it has no `transitions` property, the journey moves to the next stage in the list. When `transitions` is present and empty, or the stage is the last, the journey is `completed`. When transitions exist and none applies, the journey stays in the stage; it does not guess.

### 19.3 Triggers

| Property | Meaning |
|---|---|
| `event` | The business event `type` |
| `starts_journey` | When true and the subject has no active instance, one is created in the first stage |
| `enter_stage` | Move the instance to this stage |
| `start_workflow` | Start this workflow with the event's `data` as input |

### 19.4 Instance and record

A journey instance has an `id`, the `subject_key` value, a `status` (`active`, `completed`, `abandoned`), the current `stage_id`, its `data`, the `runs` started on its behalf (each with `run_id`, `workflow_id`, `stage_id` and status) and an append-only list of **journey events** conforming to `spec/json-schema/journey-event.schema.json`:

| Type | When |
|---|---|
| `journey.started` | The instance is created |
| `journey.event_received` | A business event concerning the subject arrived. Carries the event |
| `journey.stage_entered`, `journey.stage_completed` | A stage begins or ends. Completion carries the time spent |
| `journey.run_started`, `journey.run_ended` | A workflow run begins or settles. Both carry `run_id`, which is the link from this record into the run's journal (section 9) |
| `journey.goal_reached` | A goal's condition became true |
| `journey.touchpoint` | A touchpoint took place (19.8) |
| `journey.sentiment_changed` | The estimate of the subject's mood changed (19.9) |
| `journey.stalled` | A stage outlasted its `max_duration`, or a run of the stage failed |
| `journey.completed`, `journey.abandoned` | The journey ended |

`run_id` is the only join between the two layers, and it is enough: from a journey event a reader reaches every step, attempt, reasoning record and tool call of the run; from a run's journal a reader reaches the journey through the same id.

### 19.5 The host's duties

An event **concerns** a journey when the journey names its type in a trigger, an exit, a touchpoint or a sentiment rule, or when a workflow of the journey has an event node of that name. An event that does not concern a journey leaves no trace on it.

For every business event it accepts, a host that runs journeys MUST, in this order:

1. For a subject already on a journey the event concerns: merge the event's `data` into the instance's data and record `journey.event_received`, then any inbound touchpoint the event realises (19.8) and any change of mood (19.9).
2. Deliver the event to the runs that wait for it (18.3).
3. Create an instance if a trigger says so, recording the event on it as in step 1.
4. Apply exits, then triggers.
5. Evaluate goals and the current stage's `complete_when`.

The event is recorded before anything reacts to it, so that a journey's record reads in causal order. A host MUST ignore an event `id` it has already accepted.

When a run started for an instance settles, the host MUST, in this order: record `journey.run_ended`; accept the events the run published (18.2), exactly as it accepts any other; merge the run's business data into the instance's data; evaluate again. What a run announces is therefore on the record after the run that announced it and before anything that follows from it. This is how one workflow moves a journey, wakes another workflow, or begins another journey.

When a journey ends through an exit, the host MUST cancel (5.8) the runs still under way for it: a customer who has left is not sent a reminder. A run that fails marks its stage stalled at once (`journey.stalled`, with the run's `run_id`). A journey never fails: a failed run is a reason for a person to look, not the end of the customer's story.

### 19.6 Analytics

From instances alone a host can report, per stage: how many entered, completed, are there now, are stalled, and left from there; the median time spent; and per goal how many reached it. The reference host provides this as `journey_analytics`.

### 19.7 Several journeys

A subject usually lives through more than one journey: a customer buys, claims, renews. Journeys are not nested and do not call one another. They are joined by two things only: the **subject key**, which has the same value in each, and **business events**, since the event that ends one story is often the event that begins the next.

A subject MAY be on several journeys at once. An event is recorded on each of those it concerns (19.5).

From instances alone a host can report how subjects move between journeys: for each ordered pair of journeys, how many subjects went from an instance of the first to an instance of the second, taking each subject's instances in order of their start. The reference host provides this as `journey_transitions`.

### 19.8 Touchpoints and what changes hands

A journey map shows where the subject and the organisation meet. In AWA those meetings are declared, and then recorded when they happen.

An **artefact** is a kind of thing that changes hands, named as the business names it:

| Property | Meaning |
|---|---|
| `id`, `name`, `description` | Identity |
| `kind` | What sort of thing it is. An open vocabulary. Recommended values: `contract`, `attestation`, `invoice`, `receipt`, `certificate`, `quote`, `form`, `evidence`, `notice`, `order`, `report`, `survey` |

The `kind` is a business concept, not a file format. An insurance contract is a `contract` whether it travels as a PDF or as JSON; a police report is an `attestation`: a third party's statement of fact.

A **touchpoint** is a moment of contact:

| Property | Meaning |
|---|---|
| `id`, `name` | Identity. The name says what the party does or receives: "Signs the contract" |
| `party` | Who is on the other side: `subject` (the default) or the name of a third party, such as `bank` |
| `direction` | `inbound`: the party acts towards the organisation. `outbound`: the organisation acts towards the party |
| `channel` | How the contact is made: `web`, `email`, `phone`, `sms`, `app`, `post`, `api`, `in_person`, or another word the deployment uses |
| `technology` | The system that carries it: "Customer portal", "Payments (JSON-RPC)" |
| `on` | What makes it happen. Exactly one of: `event` (a business event type), `activity` (the name of an activity that completes in a run of the journey), `tool` (the name of a tool a run of the journey calls, section 17) |
| `exchanges` | What changes hands: a list of `{artefact, reference}`. `reference` is a path in the data of the occasion (the event's `data`, the activity's output, the tool's result) that identifies the particular document |

When the occasion occurs the host records `journey.touchpoint` with `touchpoint_id`, `name`, `party`, `direction`, `channel`, `technology`, and `artefacts`: for each exchange the artefact's `id`, `name` and `kind`, and the `reference` value where one was found. A touchpoint realised by a run carries that run's `run_id`, and one realised by a tool call carries the call's `link` (17.5): from a point on the customer's journey a reader reaches the technology that served it.

An `event` touchpoint with direction `inbound` is realised by an event from outside; with direction `outbound`, by an event a run publishes.

### 19.9 Mood

A journey MAY estimate how its subject feels. The estimate is a number on a scale the journey chooses (`min`, `max`, `initial`; by default −2 to 2, starting at 0).

**An estimate is never presented as a fact.** It changes only by a rule the journey declares, and each change records its `basis`:

| Basis | Meaning |
|---|---|
| `measured` | The subject said so. The rule reads a value from an event (`measure.path`), given on the scale `measure.from`, and maps it onto the journey's scale. The estimate is set to it. A value that is not a number, or text that is one, is no measurement: the rule makes no change |
| `inferred` | The journey's authors assumed so. The rule moves the estimate by `change` |

A rule applies `on` one kind of occasion, optionally narrowed:

| `on` | The occasion | Narrowed by |
|---|---|---|
| `event` | A business event from outside is received | `event` |
| `touchpoint` | A touchpoint is recorded | `touchpoint` |
| `goal_reached`, `stage_completed` | As named | `goal`, `stage` |
| `stalled`, `run_failed` | As named | `stage` |
| `waited` | An outbound touchpoint reaches the subject more than `longer_than` after the subject last acted, having heard nothing since | |

Every rule that matches applies, in the order written. The result is kept within the scale. Each change is recorded as `journey.sentiment_changed` with `value`, `previous`, `basis`, `reason` and `on`.

With `carry_over` (the default), an instance begins at the estimate with which the subject's most recent journey stands, and `journey.started` records it as `sentiment` with `sentiment_carried_from`: a customer does not forget a bad claim when the renewal arrives.

A view of a journey MUST let a reader tell a measured value from an inferred one.

### 19.10 A host that restarts

A journey lasts longer than a process. A host at level `journeys` MUST be able to stop and be started again, in another process, without losing or repeating anything. To that end it keeps, durably:

- every journey instance with its record;
- for every run, the state from which the run can be continued (10.3), and which instance it belongs to;
- the `id` of every business event it has accepted;
- the events runs have published that it has not yet accepted.

It MUST save this after each operation it performs for the outside world (accepting an event, letting time pass, completing a human task), and MUST have written the journals of the runs concerned first: the saved state never refers to a journal position that is not on record.

On starting again, once the workflows and journeys are registered, the host recovers: instances are as they were; each run is continued from its saved state under its `run_id`, its journal going on at the next `seq` with `run.resumed`; a run that was in the middle of an activity performs it again (activities are executed at least once, 10.3); a recovered run reports to its journey as before. An event accepted before the restart is not accepted again. A deadline fixed before the restart passes at the time it was fixed for.

A host that cannot recover a run, because its workflow is no longer registered, MUST refuse to start rather than drop the run.

Two hosts MUST NOT work from the same saved state at once: each would load it, and each would save over the other's work. A host that keeps its state where another process could open it MUST hold it exclusively and refuse to start while another holds it. It MAY take over from a holder that no longer exists. The reference host keeps a `runtime.lock` file naming the process in its directory. Several hosts MAY share a store that meets the contract of section 29, which holds each part of the state only for the operation that works on it; a runtime directory does not, and belongs to one host at a time.

The reference host keeps this in a **runtime directory**: `definitions/` holding the workflows and journeys, `runtime.json` holding the state above, `journals/` holding one journal per run. `awa journey` and the HTTP interface under `/journeys` both work on such a directory, so a command, a server and a scheduled job can each open it, do one thing and leave it for the next.

### 19.11 Conformance

Level `journeys` has its own cases, in `spec/conformance/journeys/` (Appendix A).

## 20. Counterfactual replay

A journal records what a run did. **Counterfactual replay** asks what it would have done had something been different: another model, another prompt, a stricter contract, a changed rule. It runs the workflow again with the world held as recorded, and compares.

### 20.1 What is held and what runs again

| Taken from the baseline journal | Runs again |
|---|---|
| The run's input | AI agents, under the candidate configuration |
| Results of activities performed by applications, robots and people | Model decisions (section 16) |
| Results of tool calls, matched by tool and arguments | Verification and judges (section 7) |
| Business events received, and timeouts | Contracts, decision tables and routing |
| The passing of time: timers and backoff do not wait | |

With `ai: "recorded"`, the recorded outputs of AI agents and model decisions are replayed as well. Nothing calls a model, and the comparison isolates the effect of a changed contract, criterion, table or edge.

The candidate MAY be a different workflow document. Nodes are matched by `id`.

### 20.2 Unrecorded situations

The candidate may do something the baseline never did: call a tool with other arguments, or reach an activity the baseline did not. There is then no recording to replay. The replay MUST fail that step with error code `REPLAY_UNRECORDED` and list it in the report. It MUST NOT invent a result, and it MUST NOT perform the real call: a replay has no side effects.

A baseline recorded with payload mode `hash` or `none` (9.4) holds no outputs, and can be replayed only as far as its first activity.

### 20.3 The report

The report compares the runs as a whole (status, path, attempts, tokens, cost, duration) and node by node. Each node gets a verdict:

| Verdict | Meaning |
|---|---|
| `same` | Same acceptance and the same outcome |
| `changed` | Accepted in both, with a different outcome. Whether that is better is for a person to judge |
| `improved` | Accepted where the baseline was not, or accepted in fewer attempts |
| `regressed` | Not accepted where the baseline was, or accepted in more attempts |
| `only_baseline`, `only_candidate` | Reached by one run only: the path diverged |

It names the first point at which the paths diverge. A run that was `completed` and is not any more is a regression; so is every `regressed` node. The reference command `awa replay` exits with status 2 when there is one, so a set of recorded journals can serve as a regression suite for a change of model.

### 20.4 Conformance

Level `replay` has its own cases, in `spec/conformance/replay/` (Appendix A). Replay of tool results, of business events and of timeouts is fixed by `sdk/typescript/tests/counterfactual.test.ts`.

## 21. Measures

An organisation asks the same questions of every journey and every workflow: how many finish, where they stop, how long they take, how often the work is right the first time, what it costs, how the customer felt. This section fixes the answers, so that two implementations given the same record report the same numbers, and a dashboard built on one can be read on another.

Measures are computed, never estimated. Their only source is what was recorded: journey instances with their records (19.6) and run journals (section 9).

### 21.1 The report

A **measure** is a `value` and `n`, the number of things the value was computed over. When there is nothing to compute it from, `value` is `null` and MUST NOT be reported as zero: an empty week has no completion rate. A reader shows `n` wherever a rate over few could mislead.

The form of the report is fixed by `spec/json-schema/measure-report.schema.json`. A report covers a **period**: with `from` and `to`, it keeps the journey instances and the runs started at or after `from` and before `to`, and may be narrowed to one journey or one workflow. It carries:

| Part | Content |
|---|---|
| `journeys` | For each journey: its measures (21.2), its goals with the number that reached each, its stages with their measures (21.3) and `owner`, touchpoints by channel and by technology, artefacts by kind, the spread of mood of ended instances with the number of measured and of inferred changes, and the journeys its subjects went on to (19.7) |
| `workflows` | For each workflow: its measures (21.4), its activities with theirs (21.5), its decision nodes with the number of evaluations by method, its tools with calls and failures, and its activity failures by error code |
| `totals` | The journey measures over all journeys kept, and the workflow measures over all runs kept |
| `attention` | Instances in progress that are stalled, longest first, each with its stage, the stage's `owner`, since when, and the reason `journey.stalled` gave |
| `series` | Journeys started, completed and abandoned, runs ended and failed, cost, and mean mood of journeys ended, per day, week or month in UTC, weeks starting on Monday |
| `currency` | The currency of the costs, as recorded |

A median is the nearest-rank 50th percentile: of *n* values in ascending order, the value at position ⌈*p*·*n*⌉. Durations are in milliseconds, rates between 0 and 1.

### 21.2 Journey measures

"Started" is the number of instances kept. "Ended" instances are those `completed` or `abandoned`.

| Id | Rule |
|---|---|
| `journey.started`, `journey.active` | Instances kept; instances neither completed nor abandoned |
| `journey.completion_rate`, `journey.abandonment_rate` | Completed, respectively abandoned, over started |
| `journey.stall_rate`, `journey.stalled_now` | Instances with at least one `journey.stalled` over started; instances in progress that are stalled |
| `journey.goal_attainment` | Instances that reached every goal of their journey over started. No value for a journey without goals |
| `journey.duration_median_ms`, `journey.duration_p90_ms` | From `started_at` to `ended_at` of completed instances |
| `journey.mood_end`, `journey.mood_change` | Mean last mood of ended instances; mean of last mood minus first mood (19.9) |
| `journey.mood_measured_share` | `journey.sentiment_changed` with basis `measured` over all of them. What is not measured was inferred by rule, and a reader MUST be able to tell |
| `journey.touchpoints_per_journey`, `journey.runs_per_journey` | `journey.touchpoint` records, respectively runs, over started |
| `journey.cost_per_journey` | Cost of the ended runs of the journey over started |

### 21.3 Stage measures

| Id | Rule |
|---|---|
| `stage.entered` | Instances that entered the stage |
| `stage.conversion` | Instances that completed the stage over those that entered. A stage left because the journey was abandoned in it was not completed |
| `stage.duration_median_ms` | From entering to completing |
| `stage.breach_rate` | Instances with a `journey.stalled` in the stage over those that entered |
| `stage.active`, `stage.stalled_now`, `stage.abandoned` | Instances whose current stage this is: in progress, in progress and stalled, abandoned |

### 21.4 Workflow measures

"Ended" runs have a `run.completed`, `run.failed` or `run.cancelled`. Lead time is from `run.started` to that event. Work time is the sum of `duration_ms` of the run's `activity.completed` and `activity.failed`.

| Id | Rule |
|---|---|
| `workflow.runs`, `workflow.in_progress` | Runs kept; runs not ended |
| `workflow.success_rate`, `workflow.failure_rate`, `workflow.cancel_rate` | Completed, failed, cancelled over ended |
| `workflow.first_pass_yield` | Runs completed with no `activity.failed`, `activity.retry_scheduled`, `activity.dead_lettered` or `activity.compensated`, over ended |
| `workflow.lead_time_median_ms`, `workflow.lead_time_p90_ms`, `workflow.process_time_median_ms` | Over ended runs |
| `workflow.flow_efficiency` | Summed work time over summed lead time of ended runs, at most 1 |
| `workflow.event_wait_median_ms`, `workflow.event_timeout_rate` | Time from `event.waiting` to the `event.received` at the same node; `event.timed_out` over waits that ended either way |
| `workflow.human_wait_median_ms` | `waited_ms` of `token.resumed` |
| `workflow.automation_rate` | `activity.completed` whose actor is not `human` over all `activity.completed` |
| `workflow.retries`, `workflow.dead_letters`, `workflow.compensations`, `workflow.tool_calls`, `workflow.decisions` | Counts of `activity.retry_scheduled`, `activity.dead_lettered`, `activity.compensated`, `tool.invoked`, `decision.evaluated` |
| `workflow.sla_warnings`, `workflow.sla_breaches` | Counts of `sla.warning` and `sla.breached` (section 23) |
| `workflow.tool_failure_rate` | `tool.failed` over `tool.completed` plus `tool.failed` |
| `workflow.contract_pass_rate`, `workflow.verification_pass_rate` | `contract.checked` that passed; `verification.completed` with verdict `pass`; each over all of its kind |
| `workflow.decision_default_rate`, `workflow.model_decision_share` | Decisions that took the default edge; decisions whose method is `model`; over all decisions |
| `workflow.input_tokens`, `workflow.output_tokens`, `workflow.cost`, `workflow.cost_per_run` | As recorded by the ended runs |

### 21.5 Activity measures

| Id | Rule |
|---|---|
| `activity.attempts` | `activity.started` |
| `activity.failure_rate` | `activity.failed` over attempts that ended |
| `activity.duration_median_ms`, `activity.tokens` | `duration_ms`, and input plus output tokens, of completed attempts |

### 21.6 Exposure

An implementation at this level offers the report as data. It SHOULD also offer it in the OpenMetrics text format for a metrics system to scrape: each measure with a value becomes a gauge named `awa_` followed by its id with dots replaced by underscores, labelled `journey`, `stage`, `workflow` or `activity` by name. The reference implementation gives the report with `compute_measures`, `awa measures` and `GET /api/v1/measures`, and OpenMetrics with `GET /api/v1/measures?format=openmetrics`.

Measures say what happened. They do not say why, and a rate over a handful of journeys is an anecdote: a reader of a report SHOULD be led from any number to the journeys and the journal records behind it.

### 21.7 Conformance

Level `measures` has its own cases, in `spec/conformance/measures/` (Appendix A): a record, the options of a report, and the values that follow.

## 22. Contexts

A **context** is something the activities of a run share beside the data that flows along edges: an order, a blackboard of findings, a log. A workflow declares its contexts; an activity reaches one only through a **binding**. This section fixes what a binding lets an activity see and do, so that "this agent cannot read the fraud signals" is a property of the document that an engine upholds, not a convention.

### 22.1 Declaration

A context has an `id`, a `name` unique in the workflow, a `sync_pattern`, and optionally a `schema` (a JSON Schema), an `initial_value`, and a `lifecycle` with a `ttl`. A context without an `initial_value` has no value until something is written to it. A context whose `lifecycle` is `transient` and which has a `ttl` has no value once that long has passed since it was last written.

Every `context_id` of a binding MUST name a context the workflow declares; a document where one does not is invalid.

### 22.2 Reading

An activity's `context_bindings` each name a context and an `access_mode`. The modes `read`, `read_write` and `subscribe` let the activity read.

Before an actor is called, the engine MUST give it the value of each context it is bound to read, by context name, apart from the run's data, and MUST NOT give it any other context. An activity with no binding is given no context. A context is not part of the run's data: conditions (section 6) do not see it, and it does not travel along edges.

A binding is required unless it says `required: false`. When a context the activity is required to read has no value, the activity fails with `CONTEXT_MISSING` before its actor is called; this error is not retried. A context that is not required and has no value is left out.

A binding's `transforms.on_read`, a path (6.2), selects the part of the value the activity is given.

Each time an activity is given contexts the engine journals `context.read`, listing for each context bound for reading its `context_id`, `context_name`, the `access_mode`, whether it was `present`, and a hash of the value given.

### 22.3 Writing

The modes `write`, `read_write` and `publish` let the activity write. An actor returns what it writes with its result, by context name. The engine applies it once the activity's outcome is accepted (section 11), according to the context's `sync_pattern`:

| `sync_pattern` | A write |
|---|---|
| `shared_state` | Replaces the value |
| `blackboard` | Must be an object; its properties are added to the value, replacing those of the same name. A later writer does not erase an earlier one |
| `message_passing`, `event_sourcing` | Is appended: the context's value is the list of what was written, in order |

A binding's `transforms.on_write`, a path, places what is written at that path within the value instead.

A write is refused, and the activity fails without being retried, when:

- the workflow declares no context of that name, or the activity has no binding to it that allows writing: `CONTEXT_ACCESS_DENIED`;
- the context has a `schema` and the result does not match it: `CONTEXT_INVALID`. For the appending patterns the schema describes one entry; for the others, the value after the write.

The writes of one activity are applied together or not at all. The engine journals `context.written` for each write applied, with the context, its `sync_pattern`, the `access_mode` and a hash of the value afterwards, and `context.denied` for a write refused, with the reason.

Context values are part of the state a run is recovered from (10.3).

### 22.4 Conformance

Level `contexts` has execution cases (Appendix A) in which actors are scripted to write contexts, and which state what each actor must have been given and what each context holds at the end. The time to live of a transient context, `transforms`, and writes made by a person completing a task are fixed by `sdk/typescript/tests/contexts_service_levels.test.ts`.

What this level does not do: `visibility` beyond the workflow, and `access_rights` on external resources, remain descriptive. An engine at this level controls what it hands to an actor; it cannot control what an actor reaches by other means.

## 23. Service levels

An activity or a workflow may carry a **service level** (`sla`): how long the work should take and the longest it may take. An outcome contract's `max_duration` (11.4) bounds one attempt and interrupts it. A service level is about the promise made to whoever is waiting: it counts everything, waits and retries included, and it mostly observes.

### 23.1 Terms

| Property | Meaning |
|---|---|
| `target_time` | A duration (13.5). Past it, the work is late against its target |
| `max_time` | A duration. Past it, the service level is breached |
| `escalation_policy.warning_threshold` | A duration that takes the place of `target_time` as the point of warning |
| `escalation_policy.warning_action` | Carried by the warning. Its meaning is the host's |
| `escalation_policy.breach_action` | `record`, the default, or `fail` (23.3). Any other value is carried by the record and treated as `record` |
| `escalation_policy.notify_roles` | Roles to tell, carried by the records. Telling them is the host's work |
| `name` | Carried by the records |

### 23.2 What is measured, and when

For an activity, time counts from the moment a token reaches it until its outcome is accepted: every attempt, the delays between attempts, and any wait for a person. For a workflow, time counts from `run.started`.

The engine compares the time taken with the service level:

- when an activity's outcome is accepted, before another attempt is scheduled, and again once the delay before that attempt has passed;
- when the run ends, before `run.completed` or `run.failed` is recorded;
- when the host asks it to check the work that is waiting. A host of runs that wait MUST ask on a schedule, as it lets event waits run out (18.3).

Past the point of warning and short of `max_time`, the engine journals `sla.warning` once, with `scope` (`activity` or `workflow`), `elapsed_ms`, the `threshold` and, where given, the `name`, the warning `action` and `notify_roles`. Past `max_time` it journals `sla.breached` once, with `scope`, `elapsed_ms`, `max_time`, the `action` and, where given, `name` and `notify_roles`. Each is recorded once for a visit of a token to an activity, and once for a run.

### 23.3 Breach

Work that finished late stands. The engine MUST NOT undo or reject an accepted outcome because it came after `max_time`, whatever the breach action: the breach is recorded and the run goes on.

With `breach_action: fail`, work that is *not* finished stops being waited for:

- an activity past its `max_time` is not tried again: it fails with `SLA_BREACH`;
- a token waiting at an activity past its `max_time` fails with `SLA_BREACH` when the host checks;
- a run past its workflow's `max_time` that is still running or waiting fails when the host checks: one of its unfinished tokens fails with `SLA_BREACH`, and the run ends as any run with a failed token does (5.7).

`SLA_BREACH` is never retried.

### 23.4 What a service level is not

`metrics` of a service level name targets for measures (section 21). They are informative here: an engine does not evaluate them. Warnings and breaches are counted by the measures `workflow.sla_warnings` and `workflow.sla_breaches`.

### 23.5 Conformance

Level `service_levels` has execution cases (Appendix A) that run on a clock: actors take scripted time, and the case moves the clock and asks the engine to check what is waiting. A person's task that outlasts its service level is fixed by `sdk/typescript/tests/contexts_service_levels.test.ts`.

## 29. Hosts that share a store

A host of journeys keeps its state durably (19.10). One host is one point of failure and one machine's worth of work. This section lets several hosts, in several processes or on several machines, keep their state in one **shared store** and take any work, with the same outcome as one host would produce.

**The guarantee.** The outcome of the operations of all hosts on a shared store is that of some order in which they ran one at a time on a single host. In particular, no event is accepted twice, no event is lost once accepted, a subject never has two active instances of one journey, every run journal and every journey record is numbered from 1 without a gap whichever host wrote which part, and the causal order of 19.5 holds for each subject.

### 29.1 The store contract

An **operation** is one thing a host does for the outside world, with everything it causes (19.5): accepting a business event, letting time pass, completing a person's task, starting a run.

What a store keeps (19.10: journey instances with their records, run states and the instance each belongs to, run journals, accepted event ids, the events runs published that are not yet accepted) is divided into **partitions**. Each instance and each run belongs to exactly one:

| Partition | What it holds |
|---|---|
| `subject:<key>` | Every journey instance whose subject key (19.1) is that text, whatever its journey, and every run started for one of them |
| `run:<run id>` | One run that belongs to no journey |

The subject key is written as text the same way by every host: an integral number without a decimal part, `true` or `false`, `null`, and anything else as written.

A store MUST give each operation:

1. **One unit.** What the operation changes (instances and their records, run states, journal events, accepted event ids, unaccepted published events) is kept entirely, or none of it is. A store whose unit is not atomic MUST at least never keep a journal behind the state that refers to it (19.10).
2. **Holding.** An operation holds a partition before it reads it and until what it changed is kept or discarded. No other operation reads for changing, or changes, a partition another holds. What an operation reads of a partition it holds is what was last kept. Operations that hold no partition in common MAY run at the same time, on one host or on several.
3. **Acceptance once.** Recording an event id as accepted is part of the operation's unit. An id on record, or being recorded by another operation, is not accepted again: the second operation waits for the first, and if the first is kept, the event is refused.
4. **Finding.** The store finds the runs that wait for an event of a given type, with what each waits for and its correlation (18.3), and the partitions in which time acts at or before a given instant: a wait's deadline (18.3), a stage's limit (19.2), work held to a service level (23.2).
5. **Ordering of waits.** An operation that accepts an event, and an operation that keeps a run newly waiting for an event the first could reach, are ordered: the first does not look for waiting runs while the second has not been kept, or the second does not keep its wait while the first is looking. Both name the wait by its **wait key**: `wait:<type>`, or `wait:<type>:<correlation key>=<correlation value>` for a correlated wait, the value written as a subject key is. An event looks under `wait:<type>` and under the key of each correlation the registered workflows use for its type.
6. **Release.** When a host stops, crashes or loses the store during an operation, the operation is discarded and the partitions it held are released at once or within a bounded time. A host that holds partitions and is not heard from for longer than its **lease** loses its operation in the same way.
7. **Versions.** Each instance and run is kept with a version. Writing it back names the version that was read; the store refuses it if another operation changed it meanwhile, and the operation is discarded.

A host on a shared store MUST, in each operation:

- to accept an event: record its id (item 3); hold the subject partition of each journey the event concerns (19.5); hold its wait keys shared (item 5); hold every partition with a run that waits for the event's type with a correlation the event matches, asking again until no new partition appears; then proceed as 19.5 says. Events the operation's runs publish are accepted in the same operation (19.5), each holding what it needs in turn;
- to let time pass: hold the partitions in which time acts by now that no other operation holds, and act on them. It MAY leave a partition another operation holds to a later tick: what is due stays due until a tick acts on it;
- to complete a person's task: hold the partition of the run;
- hold partitions it knows together in one fixed order (the reference hosts sort their names), so that two operations seldom wait for one another;
- work only on what it loaded under its hold in this operation, never on a copy kept from an earlier one, and change nothing outside the partitions it holds;
- before keeping a run that newly waits for an event, hold that wait's key exclusively (item 5);
- begin again from the start an operation the store discarded because it met another (a refused version, two operations each waiting for the other), and report any other failure to its caller with nothing kept;
- tell its caller that an event was accepted only once the operation is kept. An event whose operation was discarded was not accepted: its producer gives it again, to any host, and item 3 makes that safe.

Activities are still executed at least once (10.3): an operation begun again, or one whose host stopped, performs again the activities it had performed. Runs that existed before the operation do so under the same idempotency keys (10.4); runs the operation started are started again under new run ids, since the first were never kept.

### 29.2 Hosts on one store

- Every host on a store MUST register the same workflows and journeys. The store keeps their documents so that each host can register them from it. A host MUST refuse to start on a store that keeps a run not yet settled, or an instance, that needs a definition it has not registered (19.10), and MUST refuse, with nothing kept, an operation that would load one.
- A run a host loads is taken up where it was kept, its journal going on at the next `seq`. A run kept at rest, waiting for a person, an event or time, was not interrupted: it is not resumed, and no `run.resumed` is recorded. A run kept in the middle of an activity (an operation that stopped at its step limit, or a store whose unit is not atomic) is continued at the next tick, with `run.resumed` (10.3).
- What a host reads outside an operation (listings, analytics, exports, measures) is what the store held when it was read, and may already have been overtaken by another host.
- The rule of 19.10 that two hosts MUST NOT work from the same saved state at once applies to stores that do not meet 29.1, such as a runtime directory. A store that meets it MAY be opened by any number of hosts.

### 29.3 Two implementations of the contract

| | Runtime directory (19.10) | PostgreSQL store (29.4) |
|---|---|---|
| Partitions | One: the whole directory | One per subject and one per run outside a journey |
| Holding | `runtime.lock`, for the life of the host, which then does one operation at a time | Transaction-scoped advisory locks on `awa:<partition>` |
| One unit | Journals appended, then `runtime.json` replaced atomically | One transaction |
| Acceptance once | The ids in `runtime.json` | The primary key of `awa_runtime.business_events` |
| Finding | Every run and instance is in memory | Columns `waits_for`, `waits` and `due_at` |
| Ordering of waits | One operation at a time | Advisory locks on `awa:<wait key>`, shared to look and exclusive to keep a new wait |
| Release | The lock names its process, and is taken over once that process has gone | The database ends the session of a host that has gone; the lease is the session's idle transaction timeout |
| Versions | Not needed: there is one host | Column `version`, written back `WHERE version` is the one read |
| Several hosts | No | Yes |

### 29.4 The PostgreSQL store

The tables are those of the section "Runtime store" of `spec/ddl/awa.postgresql.sql`, in schema `awa_runtime`. A store creates them itself by migrations, recorded in `awa_runtime.migrations` with the host that applied them; hosts that start together apply each migration once between them. An implementation MUST refuse to open a store migrated beyond what it knows.

| Table | Keeps |
|---|---|
| `definitions` | The workflow and journey documents, whole |
| `business_events` | Every accepted event, keyed by its id, with the host that accepted it |
| `journey_instances` | Each instance whole (`document`, 19.4), its partition, `version`, and `due_at`, when its stage may outlast its limit |
| `journey_events` | The record of each instance, one row per journey event |
| `runs` | Each run's state (`checkpoint`, 10.3), its unaccepted published events (`outbox`), its partition, `version`, the event types it waits for (`waits_for`) with their correlations (`waits`), and `due_at` |
| `journal_events` | Each run's journal (section 9), one row per event, keyed by run and `seq` |

An operation is one transaction at isolation level read committed. A partition is held with `pg_advisory_xact_lock(hashtextextended('awa:' || partition, 0))`, a due partition taken with `pg_try_advisory_xact_lock`, a wait key held with `pg_advisory_xact_lock_shared` or `pg_advisory_xact_lock`. The lease is the session's `idle_in_transaction_session_timeout`, five minutes unless configured: longer than any one activity should take, since a host waiting for an activity is silent towards the database. Text is UTF-8.

The reference hosts name the store by a URL, `postgres://…`, given as the option `--store` to `awa serve` and the `awa journey` commands, or in the environment variable `AWA_RUNTIME_STORE`. It is not `AWA_DATABASE_URL`, which names the database of tasks for people.

### 29.5 Implementations that share a store

A store keeps the forms this specification defines: instances as in 19.4, journal events as in section 9, business events in the form of 18.1, documents as written. A run's state is the checkpoint of 10.3, whose `metadata` this specification leaves partly to implementations. Hosts of different implementations MAY share a store when they read and write each other's run states, and write subject keys, correlation values and wait keys as text the same way (29.1). Hosts of implementations that do not MUST NOT share a store: each would take up runs it cannot continue faithfully.

The TypeScript and Python SDKs share stores: they run the same migrations, keep the same forms, and are tested on one store together, each taking up runs the other began.

### 29.6 Out of scope

- How events reach hosts: any host may be given any event, by a queue, a load balancer or a person. Giving an event again after a failure is the producer's part.
- Work on one subject is done one operation at a time. Hosts share work across subjects, not within one.
- Activities run at least once (29.1); side effects outside the store are made safe by idempotency keys (10.4), not by the store.
- The database's own availability: replication, failover and backups.
- Moving a runtime directory into a shared store.
- Clocks: hosts are assumed to agree on the time closely enough. A deadline takes effect at the first tick at or after it, on whichever host ticks.

### 29.7 Conformance

Level `shared_store` has its own cases, in `spec/conformance/shared-store/` (Appendix A): scenarios that several hosts play against one store, saying which host takes which event, which events arrive at the same moment, and when a host stops. An implementation claims the level only with a store that several hosts can share, and runs the cases against it.

## Appendix A. Conformance suite

`spec/conformance/` holds language-neutral cases.

**Expression and entry tables.** `expressions.json` holds condition expressions (section 6) with the data they are evaluated against and their results. `unary-tests.json` holds decision table entries (5.5.1) with values and results. Both list inputs that must be rejected. An implementation of level `core` MUST reproduce the first; of level `decision`, the second.

**Document cases** (`documents/*.json`) each give a `document`, whether it is `valid`, and for invalid documents the `stage` at which it must be rejected (`schema` or `integrity`) and the `error_code`.

**Execution cases** (`execution/*.json`) each give:

| Field | Meaning |
|---|---|
| `level` | Conformance level the case belongs to |
| `spec` | Section the case tests |
| `workflow` | The workflow to run |
| `input` | Data the run starts with |
| `actors` | What each activity returns, keyed by activity name: `output`, or `error` (optionally with an error `code`), or `attempts` (a list of those, one per execution; the last repeats) |
| `deliver` | Business events to deliver after the run settles, in order (18.5) |
| `tools` | For level `tools`: what each `function` tool returns, by name: `result`, or `error` |
| `model` | For level `model_decision`: `replies`, one per call to the model, the last repeating. Each is a vote (`option`, `confidence`, `rationale`), a raw `text`, or an `error` (optionally with an error `code`). Every standard tier maps to this one model |
| `model.providers`, `model.tiers` | For level `routing`, instead of `model.replies`: the providers registered with the engine, each with an `id` and either `replies` as above, counted per provider, or an `error` (optionally with a `code`) with which every call to it fails. The first listed is the default provider. `tiers` maps each tier name to an ordered list of model references; no other tier is mapped |
| `actors.<name>.calls` | Tool calls the actor makes, in order, before it returns its output |
| `expect.status` | The run status |
| `expect.visited` | Activity names in execution order, one entry per execution |
| `expect.visited_unordered` | The same, where parallel branches make the order unspecified |
| `expect.not_visited` | Activity names that must not have executed |
| `expect.data` | A subset that the data of some token must contain |
| `expect.error_matches` | A regular expression some token's `_error` must match |
| `expect.journal` | Event types that must appear in the journal in this order; other events may come between them |
| `expect.journal_contains` | Partial events, each of which some journal event must contain |
| `expect.journal_excludes` | Event types that must not appear |
| `expect.journal_count` | For an event type, exactly how many times it must appear |
| `expect.journal_mentions` | Each gives a partial `event` and a list `mentions`: some journal event must contain the partial event and have every one of those strings in its `data`, serialised as JSON. For records whose wording is left to the implementation but which must name something, such as a model |
| `expect.model_calls` | Exactly how many times the model must have been called, over all providers |
| `expect.provider_calls` | For a provider id, exactly how many times that provider must have been called |

A runner replaces every actor with one that follows `actors`, runs the workflow, and compares. An activity not listed in `actors` returns an empty object.

**Journey cases** (`journeys/*.json`) each give `workflows`, `journeys`, `actors` as above, a `start` time for the case's clock, and `steps` performed in order:

| Step | Meaning |
|---|---|
| `{"publish": {"type", "data", "id"}}` | The host accepts this business event. `expect.accepted` says whether it must be |
| `{"advance": "P3D"}` | The clock moves forward by this duration |
| `{"tick": true}` | The host lets time pass. `expect.timed_out_runs` says how many waits must run out |
| `{"restart": true}` | The host is discarded and a new one recovers from what the first one kept (19.10) |

An actor script MAY give `takes`, a duration by which the activity moves the clock. `expect` gives `instance_count`, `transitions`, and `instances`: each names a `journey` and optionally a `subject_key`, and may state `status`, `stage_id`, `stalled`, `sentiment`, `goals_reached`, `runs` (their statuses in order), `data` (a subset), `events` (types in this order, others allowed between), `events_exact`, `events_count`, `events_contain` (partial events; `has` lists paths that must be present) and `run_journal` (types in order in the journal of the first run).

**Shared store cases** (`shared-store/*.json`) are journey cases played by several hosts on one store (section 29). They add `hosts`, the names of the hosts, all started on an empty store at the beginning, each with the case's workflows and journeys and its scripted actors. A step is performed by the host it names in `host`. Besides the journey steps:

| Step | Meaning |
|---|---|
| `{"together": [<step>, ...]}` | The steps, each by its own host, are performed at the same moment. In `expect`, `accepted` is how many of the events were accepted between them, and `timed_out_runs` and `stalled_journeys` are summed over the hosts |
| `{"host": "a", "publish": {...}, "stops_before_keeping": true}` | The host does all the work of accepting the event and stops just before what it did is kept. Its caller is not told the event was accepted, and the host takes no further step |
| `{"stop": "a"}` | The host stops between operations |
| `{"start": "a"}` | A host of that name starts again on the store |

A tick step's `expect` may also give `stalled_journeys`, how many journeys it newly found stalled. The case's `expect` is checked by a host that took no part, reading the whole store; besides the keys of a journey case it gives `accepted_events`, how many event ids the store holds as accepted, `run_count`, how many runs it keeps, and per instance `run_journal_excludes`, event types that must not appear in the journal of its first run. A runner MUST also check that every run's journal is numbered from 1 without a gap.

**Replay cases** (`replay/*.json`) each give a `workflow`, `input` and `actors` that produce the baseline run; optionally a `candidate` workflow; `ai` (`recorded` or `live`); and for `live`, `candidate_actors` for the AI agents. `expect` gives `baseline_status`, `candidate_status`, `same_path`, `verdicts` by node name (20.3), `regressions` or `regressions_at_least`, `unrecorded` (how many situations had no recording), `divergence_after`, and `error_matches`.

Execution cases at levels `contexts` and `service_levels` add: in an actor's script, `contexts`, what the actor writes by context name, and `takes`, the time the execution takes; `clock`, the instant at which the case's clock starts, on which the engine and the actors then run; in `deliver`, the steps `{"advance": <duration>}`, which moves the clock, and `{"check_service_levels": true, "expect": {warnings, breaches, failed}}`, which asks the engine to check the work that is waiting (23.2) and states how many it newly recorded and how many tokens it failed; in `expect`, `given_contexts`, for each activity named the contexts its actor was given at its last execution (`null` for none at all), and `contexts`, the value of every context that has one when the case ends.

**Measure cases** (`measures/*.json`) each give `recorded`, what the measures are computed from in the form a host exports (journeys with their instances and the journals of their runs), the `options` of the report (21.1), and `expect`: for journeys, stages, workflows and activities named, the value of each measure listed, `null` meaning no value; and where given the channels, artefacts, currency and the list of what needs attention. Numbers are compared to within 1e-9.

**Knowledge cases** (`knowledge/*.json`) each give a `workflow` and `steps` performed in order against one knowledge base, which starts empty:

| Step | Meaning |
|---|---|
| `{"run": "<name>", "actors", "input", "expect"}` | The workflow is run with the knowledge base as it then stands. `actors` and `input` are as in an execution case. The run is not ingested by this step |
| `{"ingest": "<name>"}` | The journal of the run of that name is ingested (15.3) |
| `{"review": <entry>, "by": "<reviewer>"}` | That person reviews the entry (15.4) |
| `{"deprecate": <entry>}` | The entry is made `deprecated` |

An actor script MAY give `reasoning` (`plan`, `rationale`, `alternatives_considered`, `confidence`): the account the actor reports with that result, which the engine journals as `reasoning.recorded` (9.2).

An `<entry>` describes entries by `type`, `node` (the name of the node in the entry's scope), `status`, `observations`, `sources` (how many runs the entry cites) and `reviewed_by`; whatever it leaves out is not compared. In a `review` or `deprecate` step it MUST describe exactly one entry of the knowledge base.

A run's `expect` gives its `status`; optionally `given`, which for an activity name lists, in order, the entries its actor must have been given at each execution of that activity, an empty list meaning none; and `journal_contains` as in an execution case. The case's `expect` gives `entry_count`, the number of entries the knowledge base must hold at the end, and `entries`: each `<entry>` must describe exactly one entry, or as many as its `count` says. A runner MUST also check that every source of every entry names a run that was ingested and at least one event of that run's journal, each by its `seq` (15.2).

Runners: `sdk/typescript/tests/conformance.test.ts`, `sdk/python/tests/test_conformance.py`. Both run the shared store cases against a PostgreSQL they start, or the one `AWA_TEST_POSTGRES_URL` names, and report them skipped, with the reason, where there is none.

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
- `roles` are part of the workflow document; the fields of an object-valued `output` are merged into token data (5.2).
- Recipe and replay defined as artefacts derived from the journal (section 14).
- Knowledge layer with Open Knowledge Format exchange (section 15).
- Model router with ordered fallbacks per tier; OpenAI, open-source and embedded providers (12.4 to 12.6).
- Decision nodes may be decided by a model within enumerated options (section 16).
- Executable tools with bindings, permissions and a journalled record of every call (section 17).
- Decision tables fully specified: entry grammar, strict hit policies with conflicts, rule `priority`, outputs merged into token data so decisions can be chained (5.5.1 to 5.5.3).
- External decision engines as a plug-in point (5.5.4).
- `unique` and `any` now fail on a conflict; 1.0 engines took the first matching rule.
- Business events in CloudEvents form; message and signal events publish them or hold a token until one arrives, with correlation and a timeout edge; run status `waiting_event`; conformance level `events` (section 18).
- Journeys: stages, triggers, goals and exits over business events, linked to runs by `run_id` (section 19).
- Counterfactual replay of a recorded run under a changed model, prompt, contract or rule (section 20).
- Journeys declare touchpoints (channel, technology, what changes hands as business artefacts) and an estimate of the subject's mood whose every change is marked measured or inferred; a subject's journeys are joined by subject key and business events (19.7 to 19.9).
- Conformance levels `model_decision`, `tools`, `journeys` and `replay`, each with language-neutral cases.
- A host of journeys keeps its state durably and recovers after a restart (19.10).
- Conformance levels `routing` (section 12) and `knowledge` (section 15), each with language-neutral cases.
- A stage may name its `owner`, carried by `journey.stalled`; a host holds its saved state exclusively (19.2, 19.10).
- Measures of journeys and workflows, computed from the record, with conformance level `measures` (section 21).
- Context bindings are enforced: an activity is given the contexts it is bound to read and no other, and a write needs a binding that allows it (section 22, level `contexts`). **A workflow that binds a required context nothing has written now fails with `CONTEXT_MISSING`** where it used to run.
- Service levels are compared with the time work takes, and warnings and breaches are journalled; `breach_action: fail` stops work that is still waited for (section 23, level `service_levels`).
- Several hosts may share one store and take any work, with the outcome of one host: a store contract of partitions, holding, acceptance once and versions, met by a PostgreSQL store, with conformance level `shared_store` (section 29). A runtime directory still belongs to one host at a time (19.10).
