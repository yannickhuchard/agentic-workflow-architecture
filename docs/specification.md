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
24. [Sub-workflows](#24-sub-workflows)
25. [Changing a workflow while runs are in flight](#25-changing-a-workflow-while-runs-are-in-flight)
26. [Telemetry](#26-telemetry)
27. [Interchange](#27-interchange)
28. [Agents over A2A](#28-agents-over-a2a)
29. [Hosts that share a store](#29-hosts-that-share-a-store)
30. [Identity and authorization](#30-identity-and-authorization)
31. [Guardrails](#31-guardrails)
32. [Evidence](#32-evidence)
33. [Evaluation](#33-evaluation)

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
| `subworkflows` | Performs an activity by a child run of another workflow, under the activity's contract, verification, retries, waits and cancellation, with both runs linked in their journals | 24 |
| `versioning` | Keeps runs on the version of their workflow they started on, and moves a run at rest to another version by an explicit plan that is checked in full first, refused with named reasons, and recorded | 25 |
| `telemetry` | Derives OpenTelemetry traces from the journal and the journey record, with identifiers every implementation shares, and exports them without ever holding up a run | 26 |
| `interchange` | Imports and exports BPMN 2.0 and DMN without loss, refuses what AWA cannot express, and exports CNCF Serverless Workflow 1.0 | 27 |
| `a2a` | Lets an agent reached over the Agent2Agent protocol perform an activity, under the same contract, verification, permissions and record as any actor | 28 |
| `authorization` | Knows who acts (people, agents, applications), decides with the deployment's policy whether they may, with deny-overrides, default deny, separation of duties and four eyes, refuses with `FORBIDDEN`, and records who did what and who was refused | 30.1 to 30.6 |
| `shared_store` | Lets several hosts keep journeys and runs in one store and take any work, with the outcome of one host: no event taken twice or lost, no record with a gap | 29 |
| `guardrails` | Checks what goes into and comes out of AI agents and tools at run time, blocks, redacts, retries, escalates or warns as declared, and records each finding without what it matched | 31 |
| `evidence` | Computes evidence reports from journals and journey records, every statement citing the records it rests on | 32 |
| `evaluation` | Builds evaluation datasets from journals and scores a candidate against them | 33.1 to 33.4 |

An implementation MUST NOT claim a level unless it passes every case tagged with that level. It MUST report the cases it skips; it MUST NOT silently omit them.

### 2.2 Current implementations

| SDK | Levels claimed |
|---|---|
| TypeScript (reference) | `document`, `core`, `decision`, `verified`, `recorded`, `resilient`, `contract`, `routing`, `flow`, `knowledge`, `events`, `model_decision`, `tools`, `journeys`, `replay`, `measures`, `contexts`, `service_levels`, `subworkflows`, `versioning`, `telemetry`, `interchange`, `shared_store`, `a2a`, `authorization`, `guardrails`, `evidence`, `evaluation` (`shared_store` with PostgreSQL, through the optional package `pg`). Built-in MCP and gRPC executors (17.7, 17.8); serves workflows as A2A agents (28.8) |
| Python | every level: `document`, `core`, `decision`, `verified`, `recorded`, `resilient`, `contract`, `routing`, `flow`, `knowledge`, `events`, `model_decision`, `tools`, `journeys`, `replay`, `measures`, `contexts`, `service_levels`, `subworkflows`, `versioning`, `telemetry`, `interchange`, `shared_store`, `a2a`, `authorization`, `guardrails`, `evidence`, `evaluation` (`shared_store` with PostgreSQL, through the extra `postgres`). Built-in MCP and gRPC executors (gRPC with the `grpc` extra); serves workflows as A2A agents. Without the recipe, or Open Knowledge Format exchange |
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

The JSON Schemas in `spec/json-schema/` and this document are normative. The Avro, OpenAPI, GraphQL and PostgreSQL DDL files in `spec/` are informative projections of the same model, kept in step with version 1.1; where they differ from the JSON Schemas, the JSON Schemas apply. The XML Schema `spec/xsd/awa-interchange.xsd` defines the `awa:` namespace that BPMN and DMN exports use (27.7).

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
| Every guardrail is consistent: its action is allowed at each of its stages, it redacts only with a check that gives positions, a guardrail on a tool has only tool stages, its patterns compile and its markers exist, a size check has a limit, and no two guardrails share an `id` (31.11). An expression of a `topic` check is a valid condition expression (`invalid_expression`) | `invalid_guardrail` |

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
| `guardrails` | Guardrail[] | Guardrails on every activity and its tool calls (section 31). A role may carry its own as well |

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
| `guardrails` | Guardrail[] | Checks on the input, the output and the tool calls of the activity (section 31) |

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
| `guardrail_retry` | An output was rejected by a guardrail and the activity will be re-executed with feedback (31.5) |
| `escalation` | A rejected outcome, or what a guardrail escalated, is handed to a human |

### 9.3 Event types

| Type | Level | Recorded when | Main `data` |
|---|---|---|---|
| `run.started` | execution | A run begins | `workflow_name`, `workflow_version`, `input` |
| `run.completed`, `run.failed` | execution | The run reaches its outcome (5.7) | `duration_ms`, `steps`, token and cost totals; `errors` on failure |
| `run.cancelled` | execution | The host withdrew the run (5.8) | `reason`, `compensation` |
| `run.waiting` | execution | No token is active and at least one waits | `waiting_tokens` |
| `run.resumed` | execution | A run continues from a checkpoint (10.3) | `from_seq`, `from_checkpoint_at` |
| `run.migrated` | execution | A run at rest was moved to another version of its workflow (25.3) | `from_version`, `to_version`, `nodes`, `restart`, `tokens`, `data_changes` |
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
| `agent.message_sent` | execution | A message is sent to an agent over A2A (28.7) | `agent`, `link`, `message_id`, `context_id`, `task_id`, `parts`, `simulated` |
| `agent.task_updated` | execution | An agent answered, or its task changed state (28.7) | `agent`, `task_id`, `context_id`, `state`, `duration_ms`, `reply` |
| `authorization.decided` | execution | The policy denied an action in the run, allowed an approval, or allowed an action when allows are recorded (30.6) | `action`, `decision`, `principal`, `resource`, `rule`, `reason`, `approval` |
| `verification.completed` | execution | An output has been verified | `mode`, `verdict`, `score`, `criteria`, `feedback`, `output_hash` |
| `contract.checked` | execution | An outcome has been checked against its contract | `passed`, `violations`, `tokens_used`, `output_hash`, `decided_by` |
| `contract.escalated` | execution | A rejected outcome is handed to a human | `code`, `message`, `rejected_output` |
| `guardrail.triggered` | execution | A guardrail found something, or could not check (31.7) | `guardrail_id`, `name`, `source`, `stage`, `check`, `action`, `categories`, `findings`, `tool`, `call_id`, `error`; never the text found |
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

Guardrails at stage `output` (31.3) run before step 1, on every attempt that returns; the contract and verification see the output as they left it, and never see one they blocked.

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
| `guardrails` | Guardrails on every call of the tool, at stages `tool_call` and `tool_result` (section 31) |

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

An engine MUST implement `http`, `jsonrpc`, `command` and `function`. It SHOULD implement `mcp` and `grpc`, and where it does, it MUST behave as 17.7 and 17.8 say. A deployment MAY register its own executor for any kind, which then replaces the engine's. A call to a kind with no executor fails with `VALIDATION_ERROR`.

### 17.3 Calling

For each call, in this order, the engine MUST:

1. Refuse an unknown tool (`UNKNOWN_TOOL`) and a call beyond `budgets.max_tool_calls` (`TOOL_BUDGET_EXCEEDED`). Every call counts toward the budget, refused ones included.
2. Validate the arguments against `parameters`, and refuse invalid ones (`VALIDATION_ERROR`). Nothing runs.
3. Apply the deployment's permissions (17.4), and refuse what they forbid (`PERMISSION_DENIED`). Under an authorization policy, then refuse a call the principal performing the activity may not make (`FORBIDDEN`, 30.4).
4. Record `tool.invoked`.
5. Run the binding, bounded by `timeout`.
6. Record `tool.completed` with the result, or `tool.failed` with the error.

Guardrails (section 31) at stage `tool_call` run between steps 1 and 2, and at stage `tool_result` between steps 5 and 6.

A failed or refused call does not fail the activity by itself. The failure is returned to the actor as the result of the call, so that an agent can read it and act on it. It is journalled either way: `tool.failed` with `invoked: false` for a call refused before it ran.

When the actor is an AI agent, the engine gives the model the tools' names, descriptions and parameters; runs each call the model asks for through the steps above; returns the results to the model; and repeats until the model gives its answer. Other actors call tools through the same runner, so their calls are recorded the same way.

### 17.4 Permissions

A workflow document can name any URL or program. What may actually run is for the deployment to decide:

- `command` bindings MUST NOT run unless the deployment allows commands, either all or a named list. The default is to allow none.
- A deployment MAY restrict `http` and `jsonrpc` bindings to a list of hosts.
- `http` and `jsonrpc` bindings reach `http` and `https` addresses only. Any other scheme (a file, a data URL) is refused with `VALIDATION_ERROR` before anything is called.
- A redirect is a call to another address: each hop is held to the list of hosts, and a hop to a host not on it is refused with `PERMISSION_DENIED`. Headers set by the binding, which may carry secrets, MUST NOT be sent on to a different origin.
- An engine MUST bound what a call may return, and fail a call whose reply is larger. The reference bound is 4 MiB, configurable by the deployment.
- An `mcp` binding run by the engine's own executor reaches only a server the deployment declares (17.7), by its name. A binding that names any other server is refused with `PERMISSION_DENIED`. A server the engine starts as a program is held to the rule for `command` bindings, by its program: it does not start unless the deployment allows commands, all or that one. A server reached over HTTP is held to the list of hosts, redirects included, as `http` bindings are.
- A `grpc` binding's endpoint is held to the list of hosts. The call is made over TLS unless the deployment allows plaintext for that host (17.8).

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

The executors of 17.7 and 17.8 do not belong to level `tools`: an implementation can claim `tools` without them, and no case reaches them, since each needs a live server. They are fixed by `sdk/typescript/tests/protocols_mcp.test.ts` and `sdk/typescript/tests/protocols_grpc.test.ts`, and their Python counterparts, against servers the tests start.

### 17.7 Model Context Protocol servers

A deployment declares the Model Context Protocol (MCP) servers its tools may use, by name, in `mcp_servers`. A binding of kind `mcp` names one of them in `server` and the server's tool in `tool`.

| Declaration | Fields | The engine reaches the server |
|---|---|---|
| A program | `command`, `args`, `env`, `cwd` | By starting the program and speaking to it over its standard input and output. `args` are passed one element per argument, with no shell; `env` is added to the environment of the program |
| An address | `url`, `headers` | Over Streamable HTTP at that `url`. In `headers`, `{{secret:NAME}}` is replaced as in 17.2; headers are never journalled |

The engine speaks MCP as revision 2025-11-25 defines it, opening each connection with the `initialize` handshake; it accepts a server that answers with revision 2024-11-05 or any later one it knows, and fails the call with `TOOL_ERROR` otherwise. Revisions without the handshake are not used.

A connection is opened at the first call of a run to that server, and reused by every later call of the run to it, whichever activity or attempt makes it. The engine closes every connection of a run when the run ends and when it stops to wait (5.6); a later call opens a new one. Closing stops a server the engine started. In simulation no connection is opened (17.5).

A call is a `tools/call` request with `name` set to the binding's `tool` and `arguments` set to the call's arguments. Its outcome:

| The server answers | The engine records |
|---|---|
| A result without `isError` | `tool.completed`. The `result` is the result's `structuredContent` when it has one. Otherwise, when its `content` is a single text block, the text, parsed as JSON when it is JSON. Otherwise the `content` list as received |
| A result with `isError: true` | `tool.failed` with `TOOL_ERROR` and the text of its content as the message |
| A JSON-RPC error | `tool.failed` with `TOOL_ERROR`, the error's message, and its code as `status` |
| Nothing within the tool's `timeout` | `tool.failed` with `TIMEOUT`. The engine sends `notifications/cancelled` for the request |
| A program that fails to start or exits, a connection refused or closed, a reply that is not MCP | `tool.failed` with `TOOL_ERROR` |

The bound on what a call may return (17.4) applies to each message the server sends.

### 17.8 gRPC

A binding of kind `grpc` makes one unary call: `method` of `service` (its full name, with package) at `endpoint` (`host:port`; a `grpc://` or `grpcs://` prefix is ignored). Streaming methods are refused with `VALIDATION_ERROR`.

The engine learns the request and response messages from the `.proto` files the deployment provides (`grpc.protos`, with `grpc.include_dirs` for their imports). When none of them defines the service, it asks the server, through gRPC server reflection (version `v1` or `v1alpha`), unless the deployment turns reflection off (`grpc.reflection: false`). A service that neither describes fails the call with `VALIDATION_ERROR`.

The arguments are the request message in JSON, with the field names written in the `.proto` file. The result is the response message in the same form: scalar, enumeration and repeated fields present with their default values when not set, a message field that is not set absent, enumerations by name, 64-bit integers as strings, bytes in base64.

The call is made over TLS, with the host's trusted roots or the deployment's `grpc.root_certificates`. It is made in plaintext only to a host the deployment lists in `grpc.plaintext_hosts`. Its deadline is the tool's `timeout`.

| The call ends with | The engine records |
|---|---|
| `OK` | `tool.completed`, with `status` `OK` |
| `DEADLINE_EXCEEDED` | `tool.failed` with `TIMEOUT` and `status` `DEADLINE_EXCEEDED` |
| Any other status | `tool.failed` with `TOOL_ERROR`, the status details as the message, and the name of the status code, for example `NOT_FOUND`, as `status`. A server's own `PERMISSION_DENIED` is such a status, not the deployment's refusal of 17.4 |

Channels are reused within a run and closed when it ends, as MCP connections are (17.7). Call metadata, client certificates and streaming calls are out of scope; a deployment that needs them registers its own executor (17.2).

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

A host that cannot recover a run, because its workflow, or the version of it the run is on (25.1), is no longer registered, MUST refuse to start rather than drop the run.

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
| Business events received, and timeouts | Contracts, guardrails (31.9), decision tables and routing |
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

Guardrail records (`guardrail.triggered`, section 31) are counted by no measure of this version; a reader counts them from the journal.

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

## 24. Sub-workflows

A workflow can do one of its steps by running another workflow. The step is an activity like any other: it is given data, it returns an outcome, the outcome is held to the activity's contract and verification, and it can fail, be retried, wait and be cancelled. What performs it is a **child run** of the called workflow, with its own run id and its own journal, linked to the **parent run** in both journals.

### 24.1 Calling a workflow

An activity with `is_expandable: true` and an `expansion_workflow_id` is a **call activity**. It is performed by a child run of the workflow that `expansion_workflow_id` names, whatever its `actor_type`: an actor the deployment registers for an actor type does not replace it, and its `a2a`, `tools` and `programs` are not used. An activity with `is_expandable: true` and no `expansion_workflow_id` names no workflow; it is performed by its actor, as before.

An activity MAY carry `subworkflow`:

| Field | Meaning |
|---|---|
| `input` | An object. Each property is a property of the child run's input, and its value a path (6.1) in the parent token's data. A path that resolves to nothing gives no property. When absent: see 24.2 |
| `output` | An object. Each property is a property of the activity's outcome, and its value a path in the child run's output (24.3). A path that resolves to nothing gives no property. When absent, the outcome is the child run's output |

**Where the called workflow comes from.** An engine is given the workflows it may call: the reference engines take them in the option `subworkflows.workflows`, and a host (section 19) gives every run the workflows registered with it. A child run is started only from a workflow given so; an engine MUST NOT fetch one from elsewhere. If the named workflow is not among them, the attempt fails with error code `SUBWORKFLOW_NOT_FOUND`, and no child run is started.

**Depth.** A run that a host or a caller starts has depth 0; a child run has the depth of its parent plus one. An engine has a **depth limit**, 8 unless the deployment sets another (`subworkflows.max_depth`). An attempt that would start a child run deeper than the limit fails with `SUBWORKFLOW_DEPTH_EXCEEDED`, and no child run is started. A workflow MAY call itself; the limit bounds how deep it goes.

`SUBWORKFLOW_NOT_FOUND` and `SUBWORKFLOW_DEPTH_EXCEEDED` are never retried.

### 24.2 Starting the child run

Each attempt of a call activity (11.3) starts a new child run, except an attempt that takes the outcome of a child run that waited (24.4).

- **Input.** With `subworkflow.input`, the child's input is the object it maps. Without it, the child is given the data the activity would be given: the parent token's data without the properties whose names begin with `_` and without the engine's records `activities` and `decisions` (5.2, 5.5.3).
- **Version.** The child run starts on the version of the called workflow that a new run of it would start on at that host (25.1: the newest registered, or the one the host pins), and is bound to it as any run is: it is restored, recovered and taken up on that version, whatever version is registered after it started.
- **Identity.** The child run has a new run id. Its `run.started` carries, besides what 9.3 lists, `depth` and `parent`: the parent's `run_id`, `workflow_id`, the call activity's `node_id`, the `token_id`, the `attempt`, the `seq` of the attempt's `activity.started` in the parent's journal, and `root_run_id`, the run of depth 0 above it.
- **Record in the parent.** Between the attempt's `activity.started` and the event that ends it, the parent records `subworkflow.started` (24.7).
- **Contexts.** The parent's contexts (section 22) are not shared with the child, and the contexts the call activity is given are not passed on: the child has the contexts its own workflow declares.
- **Deployment.** The child runs under the parent's deployment: the same actors, model providers, tools and their permissions, payload mode (9.4), journal store, business event sink, knowledge base, clock and simulation setting, and the same workflows to call. Each run keeps its own journal, numbered from 1.

### 24.3 Completion and failure

A child run is run until it reaches an outcome (5.7) or waits (24.4).

**Output.** The output of a child run that completed is the data of its `completed` tokens, merged in the order the tokens were created, without the properties whose names begin with `_` and without `activities` and `decisions`: the output 28.8 defines. With `subworkflow.output` it is mapped as 24.1 says.

**Completed.** The parent records `subworkflow.completed`. The attempt's result is `{"output": <the outcome>}`, and from there it is any actor's result: the outcome contract is checked, then verification (11.3); an accepted result is merged into the token's data (5.2), and recorded under `activities.<id>.output`. A call activity is never re-executed with feedback after a rejected outcome (7.4, 11.3), whatever its `actor_type`: a workflow takes no feedback. With `on_violation: "escalate_human"`, a rejected outcome is handed to a person as 11.5 says.

**Failed.** When the child run fails, the parent records `subworkflow.failed` and the attempt fails with error code `SUBWORKFLOW_FAILED`, whose message names the called workflow and gives the message of the child's first failure. `SUBWORKFLOW_FAILED` is retried under the activity's retry policy (10.1) like any error that is not excluded; each retry is a new attempt, which starts a **new child run** with a new run id. The failed child stays on record. A child's compensation (13.6) is its own: it compensates what it completed before it records `run.failed`, and the parent compensates the call activity, if the activity names a handler, as any other.

A parent's totals (`run.completed`, `run.failed`: tokens, cost, steps) count its own work only. A child's are in its own journal.

### 24.4 Waiting

A child run that waits (5.6, 18.3, 28.6) leaves the parent's token waiting.

- The attempt ends without an outcome, with `token.waiting` in place of `activity.completed` or `activity.failed`, as 28.6 says, with `reason: "subworkflow"`, the child's `run_id` and `workflow_id`, and `waiting_for`: `human` when the child waits for a person, `event` otherwise.
- The parent's status follows 5.7, a token waiting on a child counting as waiting for what the child waits for: the parent is `waiting_human` when any child it waits on waits for a person.
- The parent is the run a host knows. Every operation a host performs on the parent reaches the child runs it waits on: a business event delivered to the parent is delivered to them (18.3), each run ignoring an event id it has already accepted; a person's task in a child run is completed through the parent, named by the child's run id and the token's id, and an agent of a child run that asks for input (28.6) is answered through the parent; the next deadline of the parent is the earliest of its own and theirs; letting time pass, and checking service levels (23.2), act on them too. A delivery returns the number of tokens it released in the parent and in its children.
- When a child run that was resumed reaches an outcome, the parent records `token.resumed` with `reason: "subworkflow"`, the child's `run_id` and its `status`, and performs the activity again from a new `activity.started`. That attempt starts no child run: it takes the outcome of the child that waited, as 24.3 says. When the child waits again, the parent's token keeps waiting.

### 24.5 Cancellation

Cancelling a parent run (5.8) first cancels every child run it waits on, which records `run.cancelled` with reason `parent_cancelled` and compensates as 5.8 says; the parent records `subworkflow.cancelled`. When a token waiting on a child run is withdrawn or failed for another reason (13.3, 23.3), the child run is cancelled in the same way with reason `parent_failed`. A child run is not cancelled on its own: a host cancels the run of depth 0, and a journey that ends cancels its runs (19.5) and so their children.

### 24.6 Simulation

When a run is simulated (the reference option `simulate`), its child runs are simulated too: a child run executes in simulation, its `run.started` says so, and the scripted results a deployment gives for activities by name (`simulated_outputs`) apply to the activities of the child runs as well. A script given for the call activity's own name is not used: the activity is performed by its child run.

### 24.7 Record

| Event, in the parent's journal | `data` |
|---|---|
| `subworkflow.started` | `run_id`, `workflow_id`, `workflow_name`, `workflow_version`, `depth` of the child, and `input` under the payload mode |
| `subworkflow.completed` | `run_id`, `workflow_id`, `duration_ms` of the child run, and `output`, the outcome after mapping, under the payload mode |
| `subworkflow.failed` | `run_id`, `workflow_id`, and `error`: the `message` and `code` of the child's first failed token |
| `subworkflow.cancelled` | `run_id`, `workflow_id`, `reason` |

Each carries the call activity's `token_id`, `node_id` and `attempt`. A child run's own journal is a journal like any other (section 9); its `run.started` carries `parent` and `depth` (24.2).

The **result of a run** lists its child runs and theirs, in the order they started, each with `run_id`, `parent_run_id`, `workflow_id`, `workflow_name`, `node_id`, `token_id`, `attempt`, `depth`, `status`, `started_at` and, once it has an outcome, `ended_at`. The reference engines give it as `getSubworkflowRuns()` and `subworkflow_runs()`, and in the Python `result()` as `subworkflow_runs`.

What reads the record sees this:

| Reader | What it sees |
|---|---|
| Explaining a run (14) | The parent's recipe shows each attempt of a call activity with the child run it started, by run id, and how it ended. A child run is explained by its own recipe, from its own journal and the workflow it ran |
| Counterfactual replay (20) | The result of a call activity is taken from the baseline journal, as an application's is (20.1). No child run is started: a replay has no side effects |
| Measures (21) | A child run is a run of the called workflow and counts in that workflow's measures; the call activity counts in the parent's, as any activity. The parent's wait on a child is not a wait for a person: `token.resumed` with reason `subworkflow` carries no `waited_ms` |
| Journeys (19) | A child run of a run started for a journey instance belongs to that instance: the instance's `runs` lists it with `parent_run_id`, and the host records `journey.run_started` and `journey.run_ended` for it, with `parent_run_id`, as it records them for the parent, before the parent's own `journey.run_ended`. Its activities and tool calls realise touchpoints (19.8); the business events it publishes are accepted when the parent settles (19.5); a workflow that the journey's workflows call is one of the journey's workflows for deciding which events concern it. A child's failure does not stall the journey; the parent's does |
| Telemetry (26) | A child run is a trace of its own, whose run span links to the parent's attempt span (26.2) |
| Evidence (32) | A child run is a run, cited by its own run id; a report that covers the called workflow covers its child runs |

### 24.8 Durability

A parent's state (10.3) holds the state of every child run it waits on, so that the parent and its children are saved, restored and taken up together. A child run is never restored, saved or taken up on its own.

The checkpoint's `metadata.subworkflows` holds, where the run has any: `depth`; `parent`, as in 24.2, for a child; `runs`, the list of 24.7 for the run's own children and their descendants; `live`, for each child run the run waits on or whose outcome it has not yet taken, `{run_id, workflow_id, state}` with that child's own state; and `performed`, for each activity completed with a principal (30.6) in a child run that has ended, at any depth, `{run_id, activity_id, activity_name, principal_ids}`. Implementations that share a store (29.5) MUST write this form.

- **Runtime directory (19.10).** `runtime.json` holds runs of depth 0 only, each with its children inside. Each child run's journal is a file of `journals/` under its own run id. On recovery a child run is continued with its parent, its journal going on at the next `seq` of its own journal with `run.resumed`; the version of the workflow each child runs (its state's `workflow_version`) must be registered, or the host refuses to start.
- **Shared store (29).** A child run belongs to the partition of its run of depth 0: a child of a run started for a journey instance is in the subject's partition, a child of a run outside any journey in `run:<root run id>`. A child and its parent are therefore never in different partitions, and one hold covers both. The store keeps each child run as a run of its own (in the PostgreSQL store, a row of `runs` in that partition), so that its journal belongs to a run and a reader finds it, but a host takes up only runs of depth 0, each with its children; it never adopts a child. The waits and deadlines a store finds for a run (29.1, item 4) include those of its children. A host asked to complete a task of a child run holds the partition the store gives for that run.

### 24.9 Out of scope

Calling a workflow on another host or over A2A as a child run (an A2A agent that is a workflow is an actor, section 28); passing a child data after it has started, other than by business events; a child that outlives its parent; running a child of one workflow version against a parent that registered another; compensating a completed child run's activities when the parent later fails (the parent compensates the call activity through its handler).

### 24.10 Conformance

Level `subworkflows` has execution cases (Appendix A) whose workflow calls the case's other `workflows`, with scripted actors for the activities of all of them, and expectations on the parent's journal and on each child run's. A run restored with a child that waits, on a runtime directory and on a PostgreSQL store, is fixed by `sdk/typescript/tests/subworkflow.test.ts` and `sdk/python/tests/test_subworkflow.py`.

## 25. Changing a workflow while runs are in flight

A run that waits for a person, a business event or a deadline can last weeks, and a journey (section 19) months. Its workflow changes meanwhile: a step is added, a review is automated, a wait is replaced. This section fixes what happens to the runs under way when a new version of their workflow is registered, how an operator moves a run from one version to another, and how two versions are compared to know which runs can move.

The rule is that **nothing moves by itself**. A run keeps the version it started on until a migration, asked for explicitly and checked in full, moves it.

### 25.1 Versions and pinning

A workflow is identified by its `id`; its `version` (8.1) is a semantic version. Two documents with the same `id` and `version` are the same workflow: a version on which runs have started SHOULD NOT be changed, since changing it changes the runs under way.

A run is bound to the version it started on. `run.started` records it as `workflow_version` (9.3) and the run's state (10.3) carries it. An engine MUST execute every step of a run against the document of that version, until a migration (25.3) moves the run to another.

A host MAY have several versions of one workflow registered at once. It MUST:

- start a new run on the **newest** registered version, by semantic version order, unless the caller names a version, or the host is configured to **pin** the workflow to a version, which new runs then start on. This holds for runs a caller starts, runs a journey's trigger or stage starts (19.2, 19.3), runs a business event starts (18.4) and child runs (24.2);
- keep each run under way on its own version when another version is registered, and after the host restarts (19.10) or another host takes the run up (29.2);
- keep every version a run that has not ended is on. A runtime directory (19.10) keeps each version of a workflow in its own file, `definitions/workflow-<id>@<version>.json`; a shared store keeps each version as its own row of `definitions` (29.4). Registering a version does not remove another. A version no run is on MAY be removed.

A host MUST refuse to start on a saved state or a store that keeps a run not yet ended on a version it has not registered, naming the run, the workflow and the version, and change nothing (19.10, 29.2). On a shared store it MUST refuse, with nothing kept, an operation that would load such a run.

A journey names workflows by `id` (19.1). Versions do not change that: the runs of a journey may be on different versions of the same workflow.

### 25.2 Runs at rest

A token is **at rest** when it waits for something outside the engine:

| The token | waits for | `wait` |
|---|---|---|
| is `waiting` for a business event (18.3) | the event, or its deadline | `event` |
| is `waiting` for an agent's input (28.6) | the input | `agent` |
| is `waiting` otherwise: a person's task (5.6), or an outcome escalated to a person (11.5) | a person | `human` |
| is `active` at a timer event whose due time is fixed (13.5) | time | `timer` |
| is `joining` (13.2) | the other branches of the join | `join` |

Any other `active` token is **in the middle of work**: an activity under way, or a node the engine is about to process. A token that is `completed`, `joined`, `failed` or `cancelled` has ended. A run is at rest when it has not ended (5.7) and each of its tokens is at rest or has ended. Only a run at rest can be migrated: work in progress is never moved.

### 25.3 Migration

A **migration** moves one run at rest from the version it is on to another version of the same workflow, as a **plan** says:

| Field | Meaning |
|---|---|
| `to_version` | The version to move to. Default: the newest registered |
| `from_version` | Optional. The version the run must be on |
| `workflow_id` | Optional. The workflow the run must be a run of |
| `nodes` | Old node id → new node id. A node the plan does not list keeps its id: the **identity mapping** |
| `restart` | Old node ids. A token at rest at one of them gives up what it waits for and starts afresh at the node it is mapped to |
| `data` | Changes to the data of every token that has not ended, applied in order |

A change to data (an **assignment**) is one of:

| Form | Effect |
|---|---|
| `{"set": <path>, "value": <JSON>}` | Sets the property at the path (6.1) to the value |
| `{"set": <path>, "from": <path>}` | Copies the value at the second path. When that path is missing (6.2), the assignment changes nothing |
| `{"set": <path>, "expression": <condition>}` | Sets the property to the result, `true` or `false`, of the condition expression (section 6) |
| `{"remove": <path>}` | Removes the property, if it is there |

Each MAY have `when`, a condition expression: the assignment applies to a token only if its data satisfies it. Each sees the data as the assignments before it left them. Setting a path creates the objects it passes through.

**Checks.** Before anything changes, an engine MUST check the whole plan against the run and refuse it if any check fails, naming every reason, each with a code, and with the token and node where it concerns one:

| Code | Reason |
|---|---|
| `not_found` | The host has no such run |
| `unknown_version` | `to_version` names a version the host has not registered |
| `different_workflow` | The plan, or the version to move to, belongs to another workflow. A migration never changes a run's workflow |
| `wrong_version` | The run is not on `from_version` |
| `same_version` | The run is already on `to_version` |
| `run_ended` | The run has ended |
| `run_in_activity` | A token is in the middle of work (25.2) |
| `child_run_in_flight` | A token waits on a child run (24.4). The child's state names nodes of the run's version; the run can be moved once its child runs have ended |
| `unknown_source` | `nodes` or `restart` names a node the run's version does not have |
| `unknown_target` | `nodes` maps a node to one the new version does not have |
| `unmapped_token` | A token at rest is at a node the new version does not have, and the plan does not map it |
| `wait_incompatible` | A token whose wait is kept would wait at a node where the wait means nothing (below) |
| `invalid_assignment` | An assignment does not have one of the forms above, sets or removes a property reserved to the engine (any segment of its path begins with `_`, 5.2), or has an expression or a `when` that is not a condition expression |

A wait is **kept** at the node a token is mapped to only where it keeps its meaning:

| `wait` | The new node must be |
|---|---|
| `human` | An activity performed by the same actor type as the old node |
| `agent` | An activity performed by the same actor type, by an agent over A2A (28.1) |
| `event` | An event of the same type (`message` or `signal`) that waits rather than publishes, for an event of the same name, with the same correlation key |
| `timer` | A timer event |
| `join` | A synchronising join (13.2) with an incoming edge that has the id of the edge the token arrived by |

A plan that cannot keep a wait says what replaces it by listing the old node in `restart`: the wait is withdrawn and no check of this table applies.

**Applying.** When every check passes, the engine, in one change of the run's state:

1. Moves each token at rest to its new node. A token whose wait is **kept** waits on there for the same thing: the same person's task, the same event with the correlation value and the deadline fixed when the wait began, the same due time. When a deadline passes, what follows is the new node's (its `timeout_edge_id`, 18.3). A token that is **restarted** loses what it waited for and becomes `active` at its new node, which it then performs from the start. Tokens that have ended are left as they are.
2. Applies the assignments to the data of each token that has not ended.
3. Records the run's state on the new version. Work completed before the migration is compensated, if the run later fails (13.6), by the handler of the node the plan maps it to; work at a node the new version does not have is not compensated.
4. Records `run.migrated` in the run's journal, which goes on at the next `seq`. No `run.resumed` is recorded: the run was not interrupted.
5. Continues the run on the new version. A restarted token is processed at once, in the same operation; kept waits end as they would have.

On a store that holds operations (29.1), a migration is one operation on the run's partition: it is kept whole or not at all.

`run.migrated` concerns the run, not one token or node. Its `data`:

| Property | Content |
|---|---|
| `from_version`, `to_version` | The versions |
| `nodes`, `restart` | The plan's, as given |
| `tokens` | For each token at rest: `token_id`, `status` before, `from_node_id`, `from_node_name`, `to_node_id`, `to_node_name`, `wait`, and `outcome`, `kept` or `restarted` |
| `data_changes` | For each change made: `token_id`, `path`, `change` (`set` or `removed`), and `value` and `previous` where there are any. The values are payloads: the run's payload mode (9.4) applies to them |
| `completed_work` | Where the plan maps the node of completed work elsewhere: `from_node_id` and `to_node_id` |
| `principal` | Where the deployment has an `authorization` section: who moved the run (30.6), the host principal when the host was not told |

**Dry run.** An engine MUST offer a dry run: it performs every check and reports what the migration would do (its refusals, or the tokens, the changes to data and the run's status after it), and changes nothing and journals nothing.

**The result** of a migration or a dry run gives `run_id`, `workflow_id`, `from_version`, `to_version`, `applied` (true only when the run was moved), `dry_run`, `refusals` (each `code`, `message`, and `token_id`, `node_id`, `node_name` where they apply), `tokens` (as in `run.migrated`, and with `outcome: unchanged` the tokens that have ended), `data_changes`, `completed_work` and `status`, the run's status after it. Tokens a migration leaves where they are, those that have ended and, in a refusal, every token, have `outcome: unchanged`.

### 25.4 Compatibility

Before moving runs, an operator wants to know which can move. Comparing two versions gives, for every **position** of the old version, a node at which a run can be at rest with what it waits for there (25.2: an activity performed by a person or with `on_violation: escalate_human` waits for a person, one performed over A2A for an agent; a waiting message or signal event for an event; a timer event for time; a join for its branches), one class:

| Class | Meaning |
|---|---|
| `compatible` | A run at rest here moves as the plan says (the identity mapping without one): its wait is kept at the node the plan or the identity maps it to, or the plan restarts it there. `to_node_id` and `outcome` say where and how |
| `needs_mapping` | As things stand it cannot move, but the new version has nodes where the wait keeps its meaning: `candidates` names them. A plan that maps it to one makes it compatible |
| `impossible` | No node of the new version keeps the wait. A run here moves only under a plan that restarts it |

A comparison also gives `reason` for each position that is not compatible, `automatic` (every position is compatible), and the nodes the new version `removed` and `added`. A run is **migratable** under a plan when the plan would be applied to it without refusal. Since a run occupies only some positions, a run may be migratable by the identity mapping while other positions of its version are not compatible: a check lists, for each run not ended on another version than the one to move to, whether it is migratable and, if not, the refusals.

### 25.5 What other parts see of a migrated run

A migrated run is still one run: one `run_id`, one journal numbered from 1 without a gap, one `workflow_id`. Its journal reads in two parts, before and after `run.migrated`; the events after it concern nodes of the new version.

| Part | What it sees |
|---|---|
| Journeys (19) | The run stays the journey's run. Nothing is recorded on the journey. Touchpoints (19.8) after the migration are realised by the activities and tools of the new version |
| Replay (20) | A migrated run is replayed against one candidate, normally the version it ended on. Its recorded results are matched by node as the migrations mapped them: an event recorded at a node before a migration counts as recorded at the node that migration's `nodes` maps it to, through each later migration in turn. The migration itself is not replayed. Against the version it started on, a replay matches only what happened before the migration |
| Measures (21) | The run counts once, under its `workflow_id`: measures are not divided by version. Its lead time runs from `run.started` to its end, across the migration. Activity measures stay with the node at which each attempt was recorded |
| Evidence (32) | The `run` statement's `workflow_version` is the version `run.started` records, the one the run started on. Besides the kinds of 32.3, the `operation` part has one statement of kind `migration` for each `run.migrated` kept, with facts `run_id`, `from_version`, `to_version`, `tokens_kept`, `tokens_restarted` and `data_changes` (the number of changes), citing that event alone. The part's `summary` counts `migrations`, and the versions of each workflow in `scope` include those runs moved to |
| Telemetry (26) | `run.migrated` is a span event of the run span (26.4), its data as `awa.data.*` attributes. The run span's `awa.workflow.version` stays the version the run started on. For each token restarted, every span of that token still open ends at the time of `run.migrated`, most recently opened first, with status unset; a wait span among them carries `awa.wait.outcome` = `withdrawn`. The spans of kept waits stay open and end as they would have |

### 25.6 Interfaces of the reference implementations

Both SDKs give a host (`AwaRuntime`) `register_workflow` for every version, `workflow_versions`, `get_workflow(id, version)`, `start(..., version)`, the option `pinned_versions` (workflow id → version), `migrate(run_id, plan, dry_run)` and `check_migration(workflow_id, from_version, to_version, plan)`; and, without a host, `plan_migration(old, new, state, plan)`, `compare_versions(old, new, plan)` and `as_migrated(journal)`.

The command `awa migrate` works on a runtime directory (`--dir`, default `.awa`) or a shared store (`--store <url>` or `AWA_RUNTIME_STORE`), as `awa journey` does. A plan is a JSON file given with `--plan`; `--to` names the version to move to.

| Command | Does |
|---|---|
| `awa migrate check <workflow_id> [--from <version>]` | Compares each version with live runs with the version to move to, position by position, and lists the runs with whether each can move |
| `awa migrate plan <run_id>` | A dry run. Exits with status 2 when the migration would be refused |
| `awa migrate apply <run_id...>` | Moves the runs. Exits with status 2 when one is refused |

`awa serve` offers `GET /api/v1/journeys/workflows/{workflow_id}/versions`, `POST /api/v1/journeys/migrations/check` and `POST /api/v1/journeys/runs/{run_id}/migrate[?dry_run=true]`, described in the operational API guide.

### 25.7 Out of scope

- Moving work in progress: a run in the middle of an activity is refused, and the operator waits for it to come to rest.
- Moving a run to another workflow, or a run that has ended.
- Migrating on registration: a host never migrates a run of its own accord.
- Versions of journeys: a journey instance follows the journey definition registered, as before.
- Computing new values: the data changes copy, set and test values; the expression language has no arithmetic.
- Context values (section 22) are kept as they are.
- Withdrawing a person's task from a task system outside the host when its token is restarted: a host that holds such tasks SHOULD withdraw it.

### 25.8 Conformance

Level `versioning` has its own cases, in `spec/conformance/versioning/` (Appendix A): versions registered with a host, runs brought to rest by scripted steps, plans refused with their reasons or applied, compared versions, and runs continued to their end on the new version. Runs on a shared store, the runtime directory's files, replay, measures, evidence and telemetry of migrated runs, the command line and the HTTP routes are fixed by `sdk/typescript/tests/migration.test.ts` and `sdk/python/tests/test_migration.py`.

## 26. Telemetry

The journal (section 9) and the journey record (19.4) are AWA's account of what happened. Operations teams watch OpenTelemetry. This section fixes how the one becomes the other, so that a run looks the same in a tracing system whichever implementation ran it, and the same whether its spans were sent as it ran or exported from its journal afterwards.

Telemetry is a **projection of the record**. An implementation at level `telemetry` MUST derive every span, span event, attribute and link from journal events and journey events, and MUST NOT put on a span anything the record does not hold. Whatever the journal leaves out because of its payload mode (9.4), telemetry leaves out too. Prompts and model messages are not journalled, so they are never exported.

AWA follows the OpenTelemetry protocol (OTLP) as defined by `opentelemetry-proto` 1.9.0, and the generative AI semantic conventions as published in version 1.45.0 of the `@opentelemetry/semantic-conventions` package (its `incubating` entry point). Those conventions are still in development, and that package now notes that they continue in their own repository; AWA uses the names below as they are in 1.45.0 and will move only with a revision of this section. What has no convention is in the `awa.` namespace.

### 26.1 Identifiers

Every implementation produces the same identifiers for the same record. With *H(s)* the SHA-256 of the UTF-8 string *s*, written in lower-case hexadecimal:

| Identifier | Value |
|---|---|
| Trace of a run | The first 16 bytes of *H*(`awa:run:<run_id>`) |
| Span in a run's trace | The first 8 bytes of *H*(`awa:run:<run_id>:<seq>`), where `seq` is that of the span's **key event** (26.2) |
| Trace of a journey instance | The first 16 bytes of *H*(`awa:journey:<journey_instance_id>`) |
| Span in a journey's trace | The first 8 bytes of *H*(`awa:journey:<journey_instance_id>:<seq>`), with the `seq` of the key journey event |

If the bytes are all zero, the last is set to 1. The run span's key event is `run.started`, whose `seq` is 1, so anyone who knows a run id can find its trace and its root span. Because identifiers come from the record, a span sent again has the same identifiers, and a receiver can recognise it.

### 26.2 Spans of a run

A run is one trace. Its spans, with the event that opens each (its key event, unless the table says otherwise) and the event that ends it:

| Span | Opened by | Ended by | Parent | Name | Kind |
|---|---|---|---|---|---|
| Run | `run.started` | `run.completed`, `run.failed` or `run.cancelled` | none | `invoke_workflow <workflow_name>` | internal |
| Attempt | `activity.started` | `activity.completed` or `activity.failed` of the same token, node and attempt; an event without `attempt` ends the latest open attempt of that token and node | Run | `invoke_agent <node_name>` for an `ai_agent`, else `activity <node_name>` | internal |
| Tool call | `tool.invoked` | `tool.completed` or `tool.failed` with the same `call_id` | The open attempt of the same token, node and attempt, else the run | `execute_tool <tool>` | internal |
| Model call | Starts when its parent starts; its key event is `meta.recorded` with subject `model_selection` | At the time of its key event, sent when its parent ends | The open attempt of the same token, node and attempt, or the open decision of the same token and node | `chat <model.id>` | client |
| Decision | The latest `token.created`, `token.moved` or `token.joined` of the token at a decision node of the workflow | `decision.evaluated` of the same token and node | Run | `decision <node_name>` | internal |
| Wait | `token.waiting`, `event.waiting` or `timer.started` | `token.resumed`; `event.received` or `event.timed_out`; `timer.fired`: of the same token | The open attempt of the same token and node, else the run | `wait <node_name>` | internal |

A span starts at the time of the event that opens it and ends at the time of the event that ends it. Times are converted to nanoseconds since the Unix epoch; anything finer than a millisecond is discarded. Where a name needs `node_name` and the event has none, `node_id` is used. Deciding which nodes are decision nodes needs the workflow, which an export is therefore given.

A `tool.failed` with no `tool.invoked` before it (a call refused before it ran, 17.3) is a tool call span of no duration whose key event is the `tool.failed`. A `meta.recorded` with subject `model_selection` when no attempt or decision is open for it, and an ending event with no open span to end, are span events instead.

A child run (section 24) is a trace of its own. Its run span carries `awa.run.parent_run_id` and `awa.run.depth` from its `run.started`, and links to the span of the parent's attempt that started it: in the parent run's trace, the span whose key event has the `seq` that `parent.seq` gives (24.2).

When `token.failed` or `token.cancelled` is recorded, it is first a span event (26.4); then every span of that token still open ends at its time, the most recently opened first: with status error and the event's `error.message` for `token.failed`, unset for `token.cancelled`. When the run ends, every span still open other than the run ends at that time, unset, before the run span ends.

### 26.3 Attributes and status

Every span of a run carries `awa.run.id`. Spans that concern a node also carry `awa.node.id`, `awa.node.name` and `awa.token.id`, and `awa.attempt` where the key event has an attempt. The others are:

| Span | Attributes |
|---|---|
| Run | `gen_ai.operation.name` = `invoke_workflow`, `gen_ai.workflow.name`, `awa.workflow.id`, `awa.workflow.version`, `awa.run.simulated` from `simulate`; from the ending event `awa.run.status` (`completed`, `failed`, `cancelled`), `awa.run.steps`, `awa.run.input_tokens`, `awa.run.output_tokens`, `awa.run.cost`, `awa.run.currency`, `awa.run.cancel_reason` |
| Attempt | `awa.actor.type`, `awa.role.id`; for an `ai_agent` also `gen_ai.operation.name` = `invoke_agent`, `gen_ai.agent.name` (the node name) and `gen_ai.agent.id` (the node id); on failure `error.type` and `awa.error.retryable` |
| Tool call | `gen_ai.operation.name` = `execute_tool`, `gen_ai.tool.name`, `gen_ai.tool.call.id`, `awa.tool.link`, `awa.tool.binding` (the binding's `kind`), `awa.tool.invoked`; from the ending event `awa.tool.status`, and `error.type` on failure |
| Model call | `gen_ai.operation.name` = `chat`, `gen_ai.provider.name`, `gen_ai.request.model` and `gen_ai.response.model` (both `model.id`: the journal records the model that served), `gen_ai.request.temperature`, `gen_ai.usage.input_tokens` and `gen_ai.usage.output_tokens` (26.5), `awa.model.provider`, `awa.model.requested`, `awa.model.tier`, `awa.model.source` |
| Decision | `awa.decision.method`, `awa.decision.strategy`, `awa.decision.hit_policy`, `awa.decision.edge_id`, `awa.decision.used_default`, `awa.decision.matched_rules` (the rules' indexes, an array of integers), `awa.decision.outputs`, and for a model decision `awa.decision.option` and `awa.decision.confidence` |
| Wait | `awa.wait.kind` (`human`, `event`, `timer`), `awa.wait.outcome` (`resumed`, `received`, `timed_out`, `fired`); for a person `awa.wait.reason`, `awa.human_task.id`, `awa.wait.waited_ms`; for a business event `awa.business_event.name`, `awa.business_event.correlation_key`, `awa.business_event.due_at`, and on receipt `awa.business_event.id` and `awa.business_event.source`; for a timer `awa.timer.duration`, `awa.timer.due_at` |

An attribute whose value the record does not hold is absent. `gen_ai.provider.name` is the provider id of 12.4, except that `google` becomes `gcp.gemini`, the value the conventions give the Gemini API. `error.type` is the error's `code`, or `_OTHER` when it has none. `awa.decision.outputs` holds the outputs as canonical JSON (9.4), which also holds for any other value that is neither a string, a number nor a boolean. A number with no fractional part is an integer attribute; any other number is a double.

| Span | Status ok | Status error, with this description | Otherwise |
|---|---|---|---|
| Run | `run.completed` | `run.failed`: the `message` of its first error | unset |
| Attempt | `activity.completed` | `activity.failed`: `error.message` | unset |
| Tool call | `tool.completed` | `tool.failed`: `error.message` | unset |
| Model call | always: the model served | | |
| Decision | a method other than `none` | method `none`: `conflict`, or `no decision` | |
| Wait | `token.resumed`, `event.received`, `timer.fired` | | unset (`event.timed_out`) |

Status ok means the record says the work succeeded; it is not the absence of an error.

### 26.4 Span events

Every journal event that neither opens nor ends a span is a span event, named by its `type`, at its time. So are `token.created`, `token.moved` and `token.joined`, also when they open a decision. Its span is the most recently opened span still open, other than a tool call, whose token and node are the event's and whose attempt, where both have one, is the event's; failing that, the run span. Events recorded where no run span is open are not exported.

A span event carries `awa.journal.seq`, `awa.journal.level`, and `awa.token.id`, `awa.node.id`, `awa.node.name` and `awa.attempt` where the event has them. Each property of the event's `data` becomes `awa.data.<property>` by the rules of 26.3, except a null and, unless the deployment opts in, the payload properties of 26.6.

An implementation MUST NOT drop span events itself. A receiver may limit the number of events per span; the journal keeps them all.

### 26.5 Model calls and tokens

The journal records a model call when the call is over: `meta.recorded` with subject `model_selection` names the model that served, and token usage arrives with the outcome. A model call span therefore starts when its attempt or decision starts and ends when the model is recorded, and its usage is the `usage` of the `activity.completed` that ends the attempt, or the `model.usage` of the `decision.evaluated`, given to the last model call of that parent. An attempt that is rejected has no usage on record, and its model call span has none. The run's totals are `awa.run.input_tokens` and `awa.run.output_tokens`, not the conventions' usage attributes, so that a system summing usage over spans counts each token once.

### 26.6 Payloads

Inputs, outputs, decision inputs, tool arguments and results, business event data and the subject of a journey may be sensitive. They go on spans only when the deployment opts in, and then only as the journal holds them: the value when the payload mode is `full`, the hash when it is `hash`, nothing when it is `none` (9.4). Without opting in, an implementation MUST NOT export them.

| Attribute | Source |
|---|---|
| `awa.run.input` | `input` of `run.started` |
| `awa.input`, `awa.output` | `input` of `activity.started`; `output` of `activity.completed` |
| `awa.decision.inputs` | `inputs` of `decision.evaluated` |
| `gen_ai.tool.call.arguments`, `gen_ai.tool.call.result` | `arguments` of `tool.invoked`; `result` of `tool.completed` |
| `awa.business_event.data`, `awa.business_event.correlation_value` | `data` of `event.received`; `correlation_value` of `event.waiting` |
| `awa.journey.subject_key` | `subject_key` of `journey.started` |

As span event attributes, the payload properties are `input`, `inputs`, `output`, `arguments`, `result`, `rejected_output`, `data`, `correlation_value` and `subject_key`. Each value is canonical JSON.

### 26.7 Journeys

A journey instance is one trace:

| Span | Opened by | Ended by | Parent | Name |
|---|---|---|---|---|
| Journey | `journey.started` | `journey.completed` or `journey.abandoned` | none | `journey <journey_name>` |
| Stage | `journey.stage_entered` | `journey.stage_completed` of that stage; or the next `journey.stage_entered`, or the end of the journey, unset | Journey | `stage <stage_name>` |
| Run | `journey.run_started` | `journey.run_ended` with the same `run_id` | The open stage with the event's `stage_id`, else the journey | `run <workflow_name>` |

Each run span **links** to the run's own trace: to the trace and span identifiers of that run's run span (26.1). This is how a tracing system goes from a customer's journey to every step of every run done for it, as `run_id` does in the record (19.4). Every span carries `awa.journey.instance_id`. The journey span carries `awa.journey.id`, `awa.journey.name`, `awa.journey.subject`, and on its end `awa.journey.status` and `awa.journey.reason`; it is ok when completed and unset when abandoned. A stage span carries `awa.journey.stage.id`, `awa.journey.stage.name` and `awa.journey.stage.outcome` (`completed` or `left`), and is ok when completed. A run span carries `awa.run.id`, `awa.workflow.id`, `awa.workflow.name`, `awa.journey.stage.id`, `awa.business_event.id` for the event that caused it, and `awa.run.status`; it is ok when the run completed, an error described by the run's `error` when it failed, and unset otherwise. All spans are internal.

Other journey events are span events, with `awa.journey.seq` in place of `awa.journal.seq`, on the open run span of their `run_id`, else the open stage span of their `stage_id`, else the journey span.

When hosts share a store (section 29), the host whose operation is kept sends the spans of the journey events that operation added, and only those: the events another host added before it are that host's to send. Since identifiers are derived from the journey instance, a span is the same whichever host sends it.

### 26.8 Unfinished records

A span that has not ended is not sent while a run or a journey proceeds: spans leave when they end, and a run that waits for days sends its run span when it ends. An export from a record that ends before its spans do (a run still waiting, a journey in progress) ends each open span at the time of the last event of the record, with status unset and `awa.incomplete` = `true`, the most recently opened first. A later export of the complete record gives the same identifiers.

### 26.9 Encoding and export

Spans are sent as OTLP over HTTP: a `POST` of an `ExportTraceServiceRequest` to the endpoint's `/v1/traces`, as protobuf (`application/x-protobuf`, the default) or JSON (`application/json`). An endpoint whose path already ends with `/v1/traces` is used as given. In JSON, trace and span identifiers are hexadecimal, times (in nanoseconds) and other 64-bit integers are decimal strings, and kind and status codes are numbers, as OTLP/JSON requires. The resource carries `service.name`, `awa` unless the deployment names another, and whatever attributes the deployment adds. The instrumentation scope is named `awa`, with the specification version as its version.

A host attaches an exporter to a run (or to a host of journeys) and spans are handed to it as the record is written. A recorded run is exported with `awa telemetry export <workflow> <journal.jsonl>`, to an `--endpoint` or to a `--file` holding OTLP JSON; its spans are those a live exporter would have sent, plus those 26.8 ends.

### 26.10 Telemetry never fails a run

An implementation MUST NOT let telemetry delay, block or fail a run, a journey or a host. In particular:

- Handing spans to an exporter MUST NOT wait for them to be sent. Spans are queued and sent in batches in the background.
- A request that fails with a network error or with HTTP status 429, 502, 503 or 504 MAY be retried with increasing delays, honouring `Retry-After`, for no longer than the export timeout. Other failures are not retried.
- The queue is bounded. When it is full, or when a batch cannot be sent, spans are dropped and counted; an implementation SHOULD report how many, and SHOULD warn without flooding its log.
- An exporter that cannot be set up (an unsupported protocol, an invalid endpoint) is reported and the run proceeds without telemetry.

Nothing is lost for good: the journal remains the record, and a recorded export sends again, with the same identifiers, what a live exporter dropped.

### 26.11 Configuration

A host that runs workflows from the command line or as a server SHOULD honour the standard OpenTelemetry environment variables:

| Variable | Effect |
|---|---|
| `OTEL_EXPORTER_OTLP_TRACES_ENDPOINT`, `OTEL_EXPORTER_OTLP_ENDPOINT` | Where spans are sent: the first as given, the second with `/v1/traces` appended. Without either, nothing is sent |
| `OTEL_EXPORTER_OTLP_TRACES_HEADERS`, `OTEL_EXPORTER_OTLP_HEADERS` | Request headers, as comma-separated `key=value` pairs with percent-encoded values |
| `OTEL_EXPORTER_OTLP_TRACES_PROTOCOL`, `OTEL_EXPORTER_OTLP_PROTOCOL` | `http/protobuf` (default) or `http/json`. `grpc` is not supported: the host says so and sends nothing |
| `OTEL_EXPORTER_OTLP_TRACES_TIMEOUT`, `OTEL_EXPORTER_OTLP_TIMEOUT` | Export timeout in milliseconds, default 10000 |
| `OTEL_EXPORTER_OTLP_TRACES_COMPRESSION`, `OTEL_EXPORTER_OTLP_COMPRESSION` | `gzip` or `none` |
| `OTEL_EXPORTER_OTLP_METRICS_ENDPOINT` | Where measures are sent (26.12), as given; otherwise `/v1/metrics` under the endpoint |
| `OTEL_SERVICE_NAME`, `OTEL_RESOURCE_ATTRIBUTES` | The resource |
| `OTEL_SDK_DISABLED` = `true`, `OTEL_TRACES_EXPORTER` = `none` | No telemetry |
| `OTEL_BSP_SCHEDULE_DELAY`, `OTEL_BSP_MAX_QUEUE_SIZE`, `OTEL_BSP_MAX_EXPORT_BATCH_SIZE` | Batching |
| `AWA_TELEMETRY_PAYLOADS` = `true` | The deployment opts in to payloads (26.6) |

Unlike an OpenTelemetry SDK, a host sends nothing to a default endpoint: a run's record leaves the host only when someone has said where it goes.

### 26.12 Measures

Spans and measures (section 21) are computed from the same record and answer different questions: a trace is one run or one journey, step by step; a measure is a number over many of them in a period. They agree by construction: `workflow.tool_calls` over a period, for example, is the number of `execute_tool` spans in the traces of the runs kept.

A measure report MAY also be sent as OpenTelemetry metrics, as an `ExportMetricsServiceRequest` to the endpoint's `/v1/metrics`. This is sound because a report is a snapshot: each measure with a value becomes one data point of a **gauge**, never a counter or a histogram, since measures are recomputed over a period rather than accumulated. The gauge is named `awa.` followed by the measure's id (`awa.workflow.success_rate`); its data points carry the attributes `journey`, `stage`, `workflow` and `activity`, by name, exactly as the labels of the OpenMetrics exposition (21.6), the value as a double, the time `as_of` and, when the period has a `from`, that as the start time. The unit is `1` for ratios, scores and counts, `ms` for durations, `{token}` for tokens, and the currency in braces (`{EUR}`) for costs. A metrics system that turns the dots of a name into underscores therefore shows the series of 21.6. `n` is not sent; a reader who needs it reads the report.

### 26.13 Out of scope

Telemetry does not replace the journal: nothing in this section makes a trace a record a run can be recovered, replayed or explained from. Out of scope are OTLP over gRPC, logs, sampling (an implementation sends every span of every run it exports; a deployment that wants fewer samples in its collector), context propagation into the calls that tools and model providers make, and metrics computed live from spans.

### 26.14 Conformance

Level `telemetry` has its own cases, in `spec/conformance/telemetry/` (Appendix A): a record, and the trace that must be derived from it. Live export, retries, failure, recovery and the environment are fixed by each SDK's own tests, `sdk/typescript/tests/telemetry.test.ts` and `sdk/python/tests/test_telemetry.py`, which also check that both export the claims-settlement example (`examples/claims-settlement/telemetry/`) identically, and decode protobuf with the OpenTelemetry proto definitions.

## 27. Interchange

Organisations already hold their processes in BPMN 2.0, their rules in DMN, and some of their automation in CNCF Serverless Workflow. This section says how an AWA document is read from and written to those formats, what is kept, and what is refused. `docs/interchange.md` compares the formats and agent frameworks informatively.

Two rules govern every mapping:

- **Nothing is lost on the way out.** Exporting a valid AWA document to BPMN (with DMN beside it) and importing the result MUST give back an equal document: the same JSON value, whatever the order of an object's properties. What BPMN and DMN cannot say is kept in the `awa:` extension namespace (27.7).
- **Nothing changes meaning on the way in.** An importer MUST refuse a construct whose meaning AWA cannot express rather than import something that behaves differently. The refusal names the element, by its kind and identifier, and says why. What is left out without changing behaviour (a diagram, an annotation) is reported as a warning.

An exporter MUST refuse a document that is not valid (4.3). An importer MUST check what it produces as a processor does (4.3) and MUST refuse to return a document that is not valid.

Out of scope: BPMN collaboration semantics between pools (message flows are reported and left out, since message events already name their business events), BPMN choreographies and conversations, DMN decision requirement graphs, business knowledge models and literal-expression decisions, FEEL beyond what 27.10 lists, and import of Serverless Workflow.

### 27.1 Operations

| Operation | Command | Result |
|---|---|---|
| Import BPMN | `awa import bpmn <file.bpmn> [--dmn <file.dmn>...]` | One AWA workflow per process, then one per embedded subprocess. Without `--dmn`, a DMN file of the same name beside the BPMN file is read |
| Export BPMN | `awa export bpmn <file.awa.json>...` | One BPMN 2.0 document with one process per workflow, and, when a workflow has decision tables, one DMN 1.3 document beside it |
| Import DMN | `awa import dmn <file.dmn>` | The decision tables, as a list of decision nodes `{id, name, description?, decision_table}` |
| Export DMN | `awa export dmn <file.awa.json>...` | The decision tables as a DMN 1.3 document |
| Export Serverless Workflow | `awa export serverless-workflow <file.awa.json>` | A Serverless Workflow 1.0 document, and the list of what does not map (27.11) |

An importer reads BPMN 2.0 and DMN 1.1 to 1.5. An exporter writes BPMN 2.0 and DMN 1.3, and its output MUST be read back by the reference readers (`bpmn-moddle`, `dmn-moddle`) without warnings. A Serverless Workflow export MUST validate against the Serverless Workflow 1.0 schema.

### 27.2 Identifiers and names

An exporter writes the BPMN or DMN identifier of an AWA object as `_` followed by its UUID, since an XML identifier cannot begin with a digit. Elements the exporter adds have identifiers with a prefix and the UUID of the node they serve (`Route_`, `Join_`, `Wait_`, `Timeout_`, `Compensation_`, `Association_`, `Definitions_`, `Collaboration_`, `Participant_`, `LaneSet_`, `IO_`, `DataInput_`, `DataOutput_`, `Message_`, `Signal_`, `Error_`, and in DMN `DecisionTable_`, `Input_`, `Output_`, `Rule_`).

An importer derives the AWA identifier of an element from its identifier:

- `_<uuid>` gives that UUID.
- Any other identifier `X` gives the name-based UUID (RFC 4122, version 5) in the namespace `84c7aa15-559c-5fc6-abf7-39cad8e0d785` (itself the version 5 UUID of `https://awa.io/schema/interchange/1.1` in the URL namespace) of the text `<D>/<X><suffix>`, where `<D>` is the identifier of the BPMN or DMN `definitions` (`definitions` when it has none) and `<suffix>` is empty unless this section gives one.

An element without a name is named by its identifier. A workflow imported from BPMN has `version` `"1.0.0"` and `awa_version` `"1.1"`. An importer writes a property only when the element gives it a value: it writes no empty lists other than `activities` and `edges`, and no defaults other than those this section names.

### 27.3 Processes, lanes and activities

| BPMN | AWA |
|---|---|
| `process` (and the `participant` that names it) | A workflow. `id`, `name` (the process's, else the participant's), `description` from `documentation` |
| `lane` | A role: `id`, `name`, `description` from `documentation`, `actor_type` from `awa:actorType`, else that of the first activity whose innermost lane it is, else `human`. Every lane is a role, nested lanes included; an activity's role is its innermost lane |
| An activity in no lane | A role per actor type, identified with the process's identifier and the suffix `#role:<actor_type>`, named `Human`, `AI agent`, `Robot` or `Application` |
| `userTask`, `manualTask`, `task` | An activity, `actor_type` `human` |
| `serviceTask`, `scriptTask` | An activity, `actor_type` `application`. A script whose `scriptFormat` names a language of `programs` becomes one program (`#script`); any other script becomes the `procedure` |
| `callActivity` | An activity with `is_expandable: true` and, when `calledElement` names a process of the document or is `_<uuid>`, `expansion_workflow_id`. `actor_type` `application` |
| `subProcess` (embedded) | An activity as for `callActivity`, whose `expansion_workflow_id` names a workflow made from the subprocess's content (`#workflow`), with `parent_workflow_id` and `expansion_activity_id` |
| `businessRuleTask` | A decision node (27.6) |
| `sendTask`, `receiveTask` | A message event that publishes, or waits (27.5) |
| `ioSpecification` data inputs and outputs; data object and data store references joined by data associations | The activity's `inputs` and `outputs`, each with `name` and `description` |
| `documentation` | `description` |

The attribute `awa:actorType` on any task or lane gives its actor type (`human`, `ai_agent`, `robot` or `application`) and takes precedence. It is how an AI agent's task is marked. An exporter writes user tasks for `human` activities and service tasks for the others, with `awa:actorType` when it differs from the task's own; an activity with `is_expandable: true` becomes a `callActivity`.

### 27.4 Sequence flows and gateways

A sequence flow is an edge: `id`, `source_id`, `target_id`, `label` from `name`, `condition` from `conditionExpression` (27.10), and `is_default: true` when its source names it as `default`. Edges keep the document order of the flows, which decides routing (5.4).

| BPMN | AWA |
|---|---|
| Exclusive gateway with one incoming flow, after a task or event that has no default and whose only outgoing flow (apart from a wait's timeout) it receives | Folded into that node: its outgoing flows leave the node, its default is the node's default. AWA routing (5.4) is exclusive routing. After a business rule task, see 27.6 |
| Converging parallel gateway whose one outgoing flow leads to a task, event, or exclusive or inclusive gateway reached only from it | Folded into that node as `join: "all"` (13.2) |
| Any other exclusive, parallel or inclusive gateway | An `intermediate` event with the extension property `bpmn:gateway` (`exclusive`, `parallel` or `inclusive`) and the gateway's flows. A parallel gateway with several incoming flows has `join: "all"`. Conditions on the flows of a parallel gateway are ignored with a warning, as BPMN ignores them |
| Diverging inclusive gateway | Encoded below |
| Event-based gateway | Folded into the wait it guards (27.5) |

**Inclusive gateways.** BPMN takes every outgoing flow of an inclusive gateway whose condition holds, and its matching join waits for the branches taken. AWA routing takes one conditional edge, so an importer encodes the gateway `G`:

- `G` becomes an `intermediate` event that splits in parallel. Each conditional flow `f`, and the default flow, leaves a **guard**: an `intermediate` event (suffix `#guard:<f>`, named `<G>: <f>`) reached from `G` by an unconditional edge (`#branch:<f>`). From the guard, `f` keeps its condition; the default flow's condition is the conjunction of the negations of the others, `!(c1) && !(c2)`. The guard's default edge (`#skip:<f>`) skips the branch.
- The matching join `J` is the first converging inclusive gateway that every branch reaches. Each incoming flow of `J` must be reached from exactly one branch. Each branch then meets `J` through a **merge**: an `intermediate` event (suffix `#merge:<f>` on `J`, named `<J>: <f>`) that receives the branch's flows into `J` and its skip edge, with an edge to `J` (`#merged:<f>` on `J`). `J` has `join: "all"`, and every branch delivers exactly one token to it.
- Without a matching join, a skipped branch ends at one `end` event (`#skip-end`, named `<G>: no branch`).

Among the events, the ones an importer adds follow the gateway they belong to: the merges follow the join, and the guards the split, each in the order of the split's outgoing flows, with the skip end after the first guard. The edges it adds follow the others: each merge's edge to the join, then for each guard its edge from the split and its skip edge.

A flow without a condition is always taken; an inclusive gateway with one and a default flow is refused, since its default can never be taken. A converging inclusive gateway that is not the join of such a split is refused, as is a gateway that both converges and diverges.

**Conditions leaving tasks.** BPMN takes every conditional flow leaving a task whose condition holds. An importer accepts at most one conditional flow leaving a task or event, any other being its default, and refuses more. An exporter writes the conditional and default edges of a task or event behind an exclusive gateway (`Route_`), which the importer folds back.

### 27.5 Events

| BPMN | AWA `event_type` | `event_definition` |
|---|---|---|
| Start event, none | `start` | |
| Start event, message or signal | `start` | `name`: the message's or signal's name, else its identifier |
| Start event, timer or conditional | `start`, with a warning: when to start a run is the host's decision | |
| End event, none | `end` | |
| End event or intermediate throw event, message or signal | `message` or `signal` | `name`, `mode: "publish"` |
| End event, error | `error` (reserved, 13.4: a token that reaches it fails) | `name`: the error's code, else its name |
| Intermediate throw event, none | `intermediate` | |
| Intermediate catch event, timer with `timeDuration` | `timer` | `duration` |
| Intermediate catch event, message or signal | `message` or `signal` | `name`; no `mode`, which means wait (18.3) |
| Intermediate catch event, conditional | `conditional` (reserved, 13.4) | `condition`, when it has one |
| Send task | `message` | `name` from `messageRef`, else the task's name; `mode: "publish"` |
| Receive task | `message` | `name` as for a send task |

**Waits with a timeout.** An event-based gateway whose targets are one message or signal catch event (or receive task) and at most one timer catch event, each reached only from it, is folded into the wait: the gateway's incoming flows reach the wait, and the timer's outgoing flow leaves the wait as `event_definition.timeout_edge_id`, with the timer's duration as `timeout`. A timer boundary event that interrupts a receive task means the same. An exporter writes a wait with `timeout` and `timeout_edge_id` as an event-based gateway (`Wait_`) before the catch event and a timer catch event (`Timeout_`).

**Compensation.** A compensation boundary event on an activity, associated with another activity, gives the first activity `compensation.activity_id` (13.6). An exporter writes `compensation` that way and marks the handler `isForCompensation`. AWA compensates when a run fails; BPMN compensation thrown by an event has no AWA counterpart and is refused.

### 27.6 Decisions

A business rule task becomes a decision node: `id`, `name`, `description`. Its decision is named by `awa:decisionRef`, or by an attribute `decisionRef` in another namespace (as Camunda writes it). When a DMN document given to the importer holds that decision, the node's `decision_table` is the decision's table (27.9). Otherwise the node is decided by an external decision engine named `dmn` (5.5.4), with the decision (else the task's `implementation`, else its name) as `ruleset` and one option per outgoing flow, whose `id` is the flow's identifier with every character other than a letter, a digit, `-` or `_` replaced by `_`, and the importer warns. `default_output_edge_id` is the task's default flow, or its only outgoing flow.

An exporter writes a decision node as a business rule task with `implementation` set to the DMN 1.3 namespace and `awa:decisionRef` naming its decision in the DMN document written beside it. A node with several outgoing edges routes through an exclusive gateway (`Route_`) whose flows carry, in the language `https://awa.io/schema/decision-route/1.1`, the rules and options that choose them, in words. That text is informative: an importer never reads it, and folds the gateway back into the node. A business rule task with several outgoing flows and no such gateway is refused, since it would split the token.

A business rule task followed by an exclusive gateway with conditions is not folded: the gateway becomes an `intermediate` event whose conditions read the decision's outputs, which are merged into the token's data (5.5.3). That is how a DMN decision followed by a gateway behaves in BPMN.

### 27.7 The `awa:` extension

The namespace is `https://awa.io/schema/interchange/1.1`; its schema is `spec/xsd/awa-interchange.xsd`. It has two attributes, `awa:actorType` (27.3) and `awa:decisionRef` (27.6), and elements placed in `extensionElements`, each holding JSON text:

| Element | Holds |
|---|---|
| `awa:properties` | A JSON object: properties of the AWA object that the BPMN or DMN element does not give |
| `awa:outcomeContract`, `awa:verification`, `awa:retry`, `awa:tools`, `awa:contextBindings`, `awa:contexts`, `awa:modelConfig`, `awa:decisionModel`, `awa:decisionEngine`, `awa:sla`, `awa:knowledge` | The value of `outcome_contract`, `verification`, `retry`, `tools`, `context_bindings`, `contexts`, `ai_model_config` (a role's model reference), `decision_model`, `decision_engine`, `sla` or `knowledge` |
| `awa:absent` | A JSON list of property paths, each a list of names, that the element gives but the AWA object does not have |
| `awa:envelope` | On a process: the properties of an envelope-form document (4.1) other than `workflow` |

Together they are the **residual** of an AWA object: what an importer adds to, and removes from, what the elements give. An importer reads an element natively, then merges each extension element over the result (objects key by key, any other value replacing), then removes every path in `awa:absent`. The residual of a workflow is on its process; of a role, its lane; of an activity, event or decision node, the element written for it; of an edge, its sequence flow; of a decision table, its parts in DMN: the decision, the table, each input, output and rule. When the elements give a list of nodes, edges or roles that does not match the original one by one, the whole list is part of the workflow's residual.

An exporter writes the residual as the difference between the document and what an importer reads from the elements alone, so a property is written once. An importer MUST refuse an `awa:` element it does not know and one whose content is not JSON of the expected shape.

### 27.8 What is not imported

| BPMN construct | Why |
|---|---|
| Complex gateway | Its activation rule has no AWA counterpart |
| Transaction, cancel events | AWA compensates completed work when a run fails (13.6), but nothing is rolled back atomically |
| Compensation throw events, event subprocesses | AWA compensates when a run fails; no event starts compensation or a handler |
| Terminate end event | It ends every branch; an AWA end event completes one token |
| Error, escalation, message, signal and conditional boundary events; timer boundary events other than on a receive task | AWA has no error routing (an error fails the run, 5.7) and does not interrupt an activity to take another path. Write the alternative as a condition on the activity's result, a compensation handler, an outcome contract that escalates to a person (11.5), or a service level (section 23) |
| Escalation and link events | AWA has no escalation events; a link is a drawing aid for a sequence flow |
| Timers with `timeDate` or `timeCycle`, and durations with years or months | AWA timers wait once, for a fixed duration (13.5) |
| Loop and multi-instance activities | AWA repeats work with an edge back to the activity and a condition |
| Ad hoc subprocesses, choreographies | Every AWA activity is reached by an edge |
| Several start events in one process | A run starts at one node (5.3) |
| Event-based gateways other than one wait and at most one timer | An AWA wait is for one business event, with an optional timeout (18.3) |
| Several conditional flows leaving a task, or a business rule task with several outgoing flows | BPMN takes every flow whose condition holds; AWA takes one |
| Conditions FEEL cannot express in AWA's language | 27.10 |

Text annotations, groups, associations other than compensation, diagrams and message flows are left out with a warning, or silently for diagrams.

### 27.9 DMN decision tables

| DMN | AWA decision table |
|---|---|
| `decision` with a `decisionTable` | A decision node: `id`, `name`, `description` |
| `hitPolicy` `UNIQUE` (the default), `FIRST`, `PRIORITY`, `ANY`, `COLLECT`, `RULE ORDER` | `unique`, `first`, `priority`, `any`, `collect`, `rule_order` |
| `input`: `inputExpression` text, `label`, `typeRef`, `inputValues` | Input column: `name`, `label`, `type`, `allowed_values` |
| `output`: `name`, `label`, `typeRef`, `outputValues` | Output column likewise. A single output without a name is named after the decision |
| `typeRef` `string`; `number`, `integer`, `long`, `double`, `decimal`; `boolean`; `date`; `date and time` | `string`; `number`; `boolean`; `date`; `datetime`. Any other type is read as `string` with a warning |
| `rule`: `description`, input entries, output entries | Rule: `description`, `input_entries` (27.10), `output_entries` (each a FEEL literal: JSON values are FEEL literals) |

An input expression MUST be the name of one property (letters, digits, `_` and spaces); a path such as `applicant.age` is refused, since an AWA input reads one property of the token data. `PRIORITY` orders rules by the position of their outputs in each output's list of values; an importer gives each rule a `priority` so that the rule whose outputs come first has the highest, and refuses a `PRIORITY` table with no output values (unless the rules carry their AWA priorities in `awa:properties`). `OUTPUT ORDER` and `COLLECT` with an aggregation are refused: AWA neither sorts outputs nor aggregates them. Decisions decided by something other than a table are left out with a warning.

An exporter writes a rule's `output_edge_id` and `priority`, which DMN does not have, in the rule's `awa:properties`. Its `PRIORITY` tables keep their AWA priorities there: a DMN engine that ignores them orders the rules by output values instead.

### 27.10 FEEL

**Unary tests.** An input entry is translated between FEEL and AWA's entries (5.5.1) as follows. An importer MUST refuse any other FEEL with a message that quotes the expression.

| FEEL | AWA |
|---|---|
| `-`, empty | `-` |
| `null`; `not(null)`, `? != null` | `null`; `not null` |
| A number; `"text"`; `true`, `false` | The same literal. Text with a `"` is written `'text'` |
| `date("…")`, `time("…")`, `date and time("…")` | The text, compared as text (ISO 8601 orders correctly) |
| `< v`, `<= v`, `> v`, `>= v`, `!= v`; `= v` | The same; `v` |
| `[a..b]`, `(a..b)`, `]a..b[` and mixed | `[a..b]`, `(a..b)` and mixed: `(` and `]…` open, `[` closed |
| `? < v` and the other comparisons with `?` | As without `?` |
| `contains(?, "s")`, `starts with(?, "s")`, `ends with(?, "s")`, `matches(?, "p")` | `contains("s")`, `starts with "s"`, `ends with "s"`, `matches("p")` |
| `t1, t2` | `t1, t2` |
| `not(t1, t2)` | `not(t1, t2)` |
| Names, arithmetic, function calls other than those above, lists, contexts | Refused |

In the other direction every AWA entry has a FEEL form: a bare word is quoted, `!= v` alone is `not(v)`, `in (a, b)` is `a, b`, `not in (a, b)` alone is `not(a, b)`, and a negation inside a list uses `?`. Text compared in a `date` or `datetime` column that is an ISO 8601 date or date-time is written `date("…")` or `date and time("…")`. Since some AWA entries have more than one FEEL form and the reverse, an entry whose translation does not read back the same is kept in the rule's residual.

**Conditions.** A sequence flow's condition in the language `https://awa.io/schema/expression/1.1` is AWA's condition expression (section 6), validated as such. In any other language, or none, it is read as FEEL: comparisons of a property path with a value (`=`, `!=`, `<`, `<=`, `>`, `>=`), joined by `and`, `or` and `not(…)`, with parentheses, a property alone as a truth value, and the forms tools commonly write (`==`, `===`, `!=`, `<>`, `&&`, `||`, `!`, a `${…}` or `#{…}` wrapper, a leading `=`). A comparison with a name rather than a value, arithmetic and function calls are refused. A FEEL comparison is evaluated under AWA's rules (6.2). An exporter writes a condition in FEEL when it uses only comparisons and `and`, `or` and `not`, and otherwise in AWA's language.

### 27.11 Serverless Workflow export

An export to CNCF Serverless Workflow 1.0 maps what Serverless Workflow can run and lists the rest, each item naming the node and property and saying why. The list is part of the result; an exporter MUST NOT drop a property without listing it.

| AWA | Serverless Workflow |
|---|---|
| Workflow | `document`: `dsl` `1.0.0`, `namespace` `awa`, `name` from the workflow's name, `version`, `title`, `summary`, `metadata.awa_workflow_id` |
| Start event with `event_definition.name` | `schedule.on`: the workflow starts on that event |
| Activity | A `do` of an `emit` of `io.awa.activity.requested` (subject: the activity's identifier; data: name, actor type, role, description) and a `listen` for `io.awa.activity.completed` with that subject, whose data is merged into the workflow's data. Whoever performs the activity answers the event |
| Activity with `retry` | The same inside a `try` whose `catch.retry` has the initial delay, exponential backoff and the number of attempts |
| Activity with `is_expandable` and `expansion_workflow_id` | `run.workflow` of `awa-<id>`, version `latest` |
| Timer | `wait` with the duration |
| Message or signal that publishes | `emit` of the event type, with the listed data |
| Message or signal that waits | `listen` for the event type, correlated on `correlation_key`, with `timeout.after`. The timeout edge is listed as not mapped: a wait that runs out fails the workflow |
| Conditional and default edges | A `switch` with one case per conditional edge, in order, and the default. AWA conditions become jq (6.2, except that jq does not compare text with numbers) |
| Several unconditional edges | A `fork` with one branch per edge, `compete: false`, continuing at the node with `join: "all"` every branch reaches. Branches that meet elsewhere are refused |
| Decision table, hit policy `first` (and `unique`, `any`, whose conflicts are listed as not detected) | A `switch` with one case per rule and the default edge. The rule outputs are listed as not merged |
| Other hit policies, external engines, models | A `raise` of a `https://awa.io/errors/decision-not-mapped` error, listed |
| No route | A `raise` of a `https://awa.io/errors/no-route` error |
| End event | `then: end` (`exit` inside a branch) |
| Error event | A `raise` |

Roles, contexts, service levels, analytics, verification, outcome contracts, tools, knowledge, context bindings and compensation have no Serverless Workflow counterpart and are listed when present.

### 27.12 Conformance

Level `interchange` has cases in `spec/conformance/interchange/` (Appendix A): BPMN documents with the AWA workflows an importer must produce, DMN documents with the decision tables, documents an importer must refuse, workflows that must survive an export to BPMN and back, a Serverless Workflow export, and the FEEL translations of 27.10. Besides the cases, an implementation at this level MUST round-trip every workflow under `examples/` through BPMN and DMN.

## 28. Agents over A2A

An activity's actor may be an agent that runs elsewhere, reached over the Agent2Agent protocol (A2A). The engine sends it the work, follows the task it opens until it ends, and treats its reply as any actor's result: the same outcome contract, the same verification, the same record. A host can also offer a workflow to other agents as an A2A agent of its own.

This section follows the A2A specification version 1.0, over its JSON-RPC binding, as implemented by `@a2a-js/sdk` 1.x and `a2a-sdk` 1.x. Every request the engine sends carries the header `A2A-Version: 1.0`. Task states are written as A2A 1.0 writes them, for example `TASK_STATE_COMPLETED`.

### 28.1 The binding

A role or an activity names an agent in `a2a`:

| Field | Meaning |
|---|---|
| `agent_card` | URL of the agent's card. Required |
| `skill` | The id of the skill on the card the work is for. Sent with the message (28.3) |
| `on_input_required` | `wait` (default) or `fail`: what happens when the agent asks for input (28.6) |
| `headers` | Headers sent with every request to the agent. `{{secret:NAME}}` is replaced as in 17.2. Never journalled |

An activity's `a2a` replaces its role's. An activity that has one, or whose role has one, is performed by that agent, whatever its `actor_type`; an actor the deployment registers for an actor type does not replace it. The `actor_type` keeps its meaning elsewhere: only an `ai_agent` is tried again with feedback after a rejected outcome (11.3, 7.4). The activity's `tools` (section 17) are not offered to a remote agent.

### 28.2 Reaching the agent

The engine reads the card with `GET` once per run and agent, and uses the first entry of its `supportedInterfaces` whose `protocolBinding` is `JSONRPC` and whose `protocolVersion` is 1.x or absent. A card without one fails the activity with `AGENT_UNSUPPORTED`.

An agent is held to the deployment's permissions as an `http` tool is (17.4): the card's URL and the interface's URL MUST be `http` or `https` addresses, or the activity fails with `VALIDATION_ERROR`; when the deployment restricts hosts, each of them, and every redirect, MUST be on its list, or the activity fails with `PERMISSION_DENIED` before anything is sent to that host; headers are not sent on to another origin; replies are bounded in size. A deployment MAY give agents a list of hosts of their own, which then applies to them in place of the tools' list. `AGENT_UNSUPPORTED` and `PERMISSION_DENIED` are never retried.

### 28.3 The message

Each attempt (11.3) sends one `SendMessage` request whose message has a new `messageId`, the role `ROLE_USER`, and these parts, in order:

1. A `text` part: the activity's `name`, `description` and `procedure`, those it has, separated by blank lines, followed by the corrective feedback when the attempt is a retry with feedback (7.4, 11.3).
2. A `data` part with media type `application/json`: the run's data as the activity is given it, without the properties whose names begin with `_`.
3. When the activity is given contexts (22.2), a `data` part holding them by context name, whose `metadata` is `{"awa": "contexts"}`.

The message's `metadata.awa` holds the `run_id`, the `activity_id`, the `activity` name, the `attempt`, the idempotency key (10.4) as `idempotency_key`, and the `skill` when the binding names one. The first attempt sends no `contextId`; every later message of the same visit to the activity carries the `contextId` the agent answered with, so that the agent sees one conversation.

### 28.4 Following the task

The agent answers with a message or a task.

- A message is the agent's reply (28.5).
- A task in state `TASK_STATE_SUBMITTED` or `TASK_STATE_WORKING` is followed: the engine asks for it with `GetTask` at an interval the deployment sets (the reference is one second) until its state is another. An engine MAY follow it by streaming instead, when the card says the agent streams; what it records and returns is the same. When the deployment's longest wait for an agent passes first (the reference is ten minutes), the engine sends `CancelTask` and the attempt fails with `TIMEOUT`. An outcome contract's `max_duration` (11.4) bounds the attempt as for any actor.

| The task ends in | The attempt |
|---|---|
| `TASK_STATE_COMPLETED` | Has the reply of 28.5 |
| `TASK_STATE_INPUT_REQUIRED` | Waits for input, or fails (28.6) |
| `TASK_STATE_FAILED` | Fails with `AGENT_FAILED` |
| `TASK_STATE_REJECTED` | Fails with `AGENT_REJECTED` |
| `TASK_STATE_CANCELED` | Fails with `AGENT_CANCELED` |
| `TASK_STATE_AUTH_REQUIRED` | Fails with `AGENT_AUTH_REQUIRED` |

The message of each failure is the text of the task's status message, when it has one. A JSON-RPC error, an HTTP status other than success, an agent that cannot be reached, or a reply that is not what A2A 1.0 says, fails the attempt with `AGENT_ERROR`, with the JSON-RPC error code or the HTTP status in the error. These failures are retried as any actor's error is, under the activity's retry policy (10.1); each retry sends a new message.

### 28.5 The reply

The output of the attempt is built from the artifacts of the completed task, in order, or, for a message, from its parts as one artifact without a name. A completed task without artifacts gives its status message, if any, as one artifact without a name.

The value of an artifact is the `data` of its part when it has exactly one part and that part is `data`; the text of its parts, joined by line breaks, when every part is `text`; and otherwise the list of its parts as received. A value that is a JSON object has its properties merged into the output, a later artifact's replacing an earlier one's of the same name. Any other value becomes the output's property named after the artifact's `name`, or `result` when it has none.

The output is then checked as any actor's result: the outcome contract (section 11), then verification (section 7). A retry with feedback sends a new message in the same context (28.3).

### 28.6 When the agent asks for input

With `on_input_required: wait`, a task in `TASK_STATE_INPUT_REQUIRED` ends the attempt without an outcome, and the token waits (5.6): the attempt ends with `token.waiting` in place of `activity.completed` or `activity.failed`, as an attempt that hands work to a person does. The engine journals `token.waiting` with `reason: "agent_input"`, the `agent`, the `task_id`, the `context_id`, and the agent's status message as `request`, under the payload mode (9.4). The run's status is `waiting_human`: the input is the host's to give, usually from a person. The wait counts toward service levels (23.2) as a wait for a person does.

The host gives the input for that token, as an object or as text. The engine journals `token.resumed` and performs the activity again from a new `activity.started`: that attempt sends the input as a message with the task's `taskId` and `contextId` (a `data` part for an object, a `text` part for text) and follows the task as in 28.4. The input is not part of the run's data. The outcome, when the task completes, is checked as in 28.5.

With `on_input_required: fail`, the attempt fails with `AGENT_INPUT_REQUIRED`.

### 28.7 Record

| Event | `data` |
|---|---|
| `agent.message_sent` | `agent` (the card's URL), `link` (the interface's URL, or the card's when nothing was sent), `message_id`, `context_id` and `task_id` when the message continues them, `parts` under the payload mode, and `simulated` in simulation |
| `agent.task_updated` | `agent`, `task_id` and `context_id` when there is a task, `state` (the task's state, or `message` for a message reply), `duration_ms` since the message was sent, and, when the state ends the attempt, `reply`: the artifacts, the status message or the message's parts, under the payload mode |

`agent.task_updated` is recorded for the first answer and for every change of state seen while the task is followed; an answer in the same state as the last is not recorded again. Both events carry the `node_id` and `attempt` and fall between the `activity.started` of their attempt and the event that ends it. The card's URL is never hashed or omitted, whatever the payload mode; headers never appear.

In simulation the engine MUST NOT read the card or send anything. It records `agent.message_sent` with `simulated: true`, and the attempt returns what the deployment scripted for the activity, or no business data.

### 28.8 A workflow offered as an A2A agent

A host MAY offer a workflow to other agents. When it does, it MUST serve:

- **The card**, at `<base>/.well-known/agent-card.json`, where `<base>` is the address it serves the workflow at, and also at `/.well-known/agent-card.json` when it offers one workflow only. The card gives the workflow's `name`, `description` and `version`; one entry in `supportedInterfaces`, `{"url": <base>, "protocolBinding": "JSONRPC", "protocolVersion": "1.0"}`; `capabilities` with `streaming` and `pushNotifications` false; `defaultInputModes` `application/json` and `text/plain`; `defaultOutputModes` `application/json`; and one skill whose `id` is the workflow's id. When the host requires authentication, the card says how, in `securitySchemes` and `securityRequirements`. The card itself needs none.
- **`SendMessage`**, which starts a run of the workflow. The run's input is the properties of the message's `data` parts that are objects, merged in order, and the text of its `text` parts, joined by line breaks, as `text`. The task's id is the run's id; its `contextId` is the message's, or a new one. Unless the request's `configuration.returnImmediately` is true, the host answers once the run has ended or waits; otherwise at once.
- **`GetTask`**, which answers with the task as it stands, and **`CancelTask`**, which cancels the run (5.8) and answers with the task.

The task's state follows the run's status: `running`, `waiting_human` and `waiting_event` are `TASK_STATE_WORKING`, since what the run waits for is the host's to handle; `completed` is `TASK_STATE_COMPLETED`, with one artifact named `output` whose one `data` part is the run's output: the data of its completed tokens merged, without the properties whose names begin with `_` and without the engine's own records of each activity's output and each decision (`activities`, `decisions`); `failed` is `TASK_STATE_FAILED`, with the error as the status message; `cancelled` is `TASK_STATE_CANCELED`.

A request for a task the host does not know is answered with error `-32001`; cancelling a task that has ended, with `-32002`; a message that continues an existing task, and any other A2A method, with `-32004`, since a run takes no further input over A2A; an unknown method, with `-32601`; a request whose `A2A-Version` is not 1.x, with `-32009`. The run is performed under the host's own permissions: a caller gains no way to reach a host or run a program the deployment did not allow.

### 28.9 Out of scope

Streaming and push notifications on the served side; the HTTP+JSON and gRPC bindings of A2A; extended and signed agent cards; carrying out an agent's authentication request (`TASK_STATE_AUTH_REQUIRED` fails the attempt); fetching the content of `url` and `raw` parts, which are passed on as received; A2A versions before 1.0.

### 28.10 Conformance

Level `a2a` covers 28.1 to 28.7. Its cases are execution cases (Appendix A) with scripted agents: the case gives each agent's card and replies, and the runner stands in for the agent. Serving a workflow (28.8) is fixed by `sdk/typescript/tests/protocols_a2a.test.ts` and `sdk/python/tests/test_protocols_a2a.py`, in which each SDK's client calls the other SDK's host.

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

- Every host on a store MUST register the same workflows and journeys. The store keeps their documents so that each host can register them from it. A host MUST refuse to start on a store that keeps a run not yet settled, or an instance, that needs a definition it has not registered (19.10; for a run, the version of its workflow it is on, 25.1), and MUST refuse, with nothing kept, an operation that would load one.
- A run a host loads is taken up where it was kept, its journal going on at the next `seq`. A run kept at rest, waiting for a person, an event or time, was not interrupted: it is not resumed, and no `run.resumed` is recorded. A run kept in the middle of an activity (an operation that stopped at its step limit, or a store whose unit is not atomic) is continued at the next tick, with `run.resumed` (10.3).
- What a host reads outside an operation (listings, analytics, exports, measures) is what the store held when it was read, and may already have been overtaken by another host.
- The rule of 19.10 that two hosts MUST NOT work from the same saved state at once applies to stores that do not meet 29.1, such as a runtime directory. A store that meets it MAY be opened by any number of hosts.

### 29.3 Two implementations of the contract

| | Runtime directory (19.10) | PostgreSQL store (29.4) |
|---|---|---|
| Partitions | One: the whole directory | One per subject and one per run outside a journey |
| Holding | `runtime.lock`, held by one host for its whole life | Transaction-scoped advisory locks on `awa:<partition>` |
| One unit | Journals appended, then `runtime.json` replaced atomically | One transaction |
| Acceptance once | The ids in `runtime.json` | The primary key of `awa_runtime.business_events` |
| Finding | Every run and instance is in memory | Columns `waits_for`, `waits` and `due_at` |
| Ordering of waits | One host holds every wait | Advisory locks on `awa:<wait key>`, shared to look and exclusive to keep a new wait |
| Release | The lock names its process, and is taken over once that process has gone | The database ends the session of a host that has gone; the lease is the session's idle transaction timeout |
| Versions | Not needed: there is one host | Column `version`, written back `WHERE version` is the one read |
| Several hosts | No | Yes |

### 29.4 The PostgreSQL store

The tables are those of the section "Runtime store" of `spec/ddl/awa.postgresql.sql`, in schema `awa_runtime`. A store creates them itself by migrations, recorded in `awa_runtime.migrations` with the host that applied them; hosts that start together apply each migration once between them. An implementation MUST refuse to open a store migrated beyond what it knows.

| Table | Keeps |
|---|---|
| `definitions` | The workflow and journey documents, whole: every version of a workflow, keyed by `kind`, `id` and `version` (25.1), and a journey once, with `version` empty |
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

## 30. Identity and authorization

A role says what kind of actor performs an activity (8.2). It does not say who. This section says who: who started a run, which agent performed an activity, which person completed a task. It says how a host knows them, how a deployment decides whether they may act, where the engine asks, and what it records, so that a run can show who did what and who was refused.

The decision belongs to the deployment, in a declarative policy that every implementation evaluates the same way. A deployment that runs its own policy engine can plug it in (30.7); the built-in policy is the reference.

### 30.1 Principals

A **principal** is whoever acts: a person, an AI agent, a robot, an application or a service.

| Field | Meaning |
|---|---|
| `id` | Identifies the principal within the deployment. Required |
| `kind` | `person`, `ai_agent`, `robot`, `application` or `service`. Required |
| `name` | For a person to read |
| `attributes` | An object a policy tests: `roles` and `groups` (lists of text) by convention, and anything else, such as `clearance` or `department` |

A host learns principals in three ways.

**From the authenticated request**, for people who complete tasks and for callers who start runs, publish events or read journals. A request authenticated by a JWT is the principal whose `id` is the claim `sub`; whose `kind` is the claim `kind` when it is one of the five kinds, and `person` otherwise; whose `name` is the claim `name`; whose `roles` attribute is the union of the claims `roles` (a list) and `role` (a value); and whose other attributes are the other claims, except the registered claims `iss`, `sub`, `aud`, `exp`, `nbf`, `iat` and `jti`. A request authenticated by an API key is the principal the host associates with the key; the reference servers make it `{"id": <the key's user>, "kind": "application", "attributes": {"roles": [<its role>], "permissions": [...]}}`. A request that is not authenticated, where the host does not require authentication, is the principal `{"id": "anonymous", "kind": "application"}`.

**From the deployment**, for the agents, robots and applications that perform activities, and for agents reached over A2A (section 28). The `principals` of the deployment's `authorization` section (30.2) are identities:

| Field | Meaning |
|---|---|
| `id`, `kind`, `name`, `attributes` | As above |
| `acts_for` | `activities` and `roles`, each by id or name; `actor_types`; `agents`, by agent card URL |
| `credentials` | Headers sent with the identity's requests. In their values `{{secret:NAME}}` is replaced as in 17.2 |

The principal that performs an activity whose actor is not a person is the first identity, in the order of the list, that acts for the activity; failing that, the first that acts for its agent over A2A; then for its role; then for its actor type. Without one, it is the principal `{"id": <the agent card URL>, "kind": "ai_agent"}` for an agent over A2A, and otherwise `{"id": "<actor_type>:<role_id>", "kind": <the kind of the actor type>}`, with no attributes: `human` is `person`, and the other actor types are the kinds of the same name.

An identity's `credentials` are sent with its `http` tool calls (17.2) and with every request to its agent over A2A (28.1). Header names are compared without regard to case, and a credential replaces a header of the same name the workflow document sets: who the agent is, is the deployment's to say. Secrets are those the deployment supplies for tools, or for agents. Credentials are never journalled, and they are not sent with `jsonrpc`, `command`, `mcp` or `grpc` bindings.

**The host itself.** What the host does on its own account, without naming who asked, is done as the **host principal**: `{"id": "host", "kind": "service"}` unless the deployment names another as `host_principal`. A run a journey starts (19.3) is started by the host. A program that embeds an engine and starts a run, or gives a person's answer, without a principal, does so as the host.

When a request names a principal only by its id, as when a task is assigned to someone, the principal is the deployment's entry of that id, with its attributes, or a `person` of that id with no attributes.

### 30.2 The policy

The policy is part of the deployment, in its `authorization` section, beside what the deployment allows tools and agents to reach (17.4, 28.2):

| Field | Meaning |
|---|---|
| `principals` | The identities of 30.1 |
| `policy` | `rules`, `separation_of_duties` and `four_eyes` |
| `classifications` | The data classification of workflows and activities, by id or name |
| `record_allows` | `true` to journal allowed decisions as well as denials (30.6). Default `false` |
| `host_principal` | The host principal (30.1) |

A workflow document carries no policy. Who may act in a workflow is the decision of the organisation that deploys it, changes without the workflow changing, and differs between deployments of the same workflow; a policy in the document would be a second place to audit, which whoever edits the workflow could change. A policy names activities and roles by id or by name, so that it reads as the workflow does.

A **rule** has:

| Field | Meaning |
|---|---|
| `id` | Unique within the policy, across rules, separations of duties and four-eyes rules |
| `effect` | `allow` or `deny` |
| `actions` | The actions it concerns, or `["*"]` for every action |
| `subject` | Which principals it concerns. Absent: all |
| `resource` | Which resources it concerns. Absent: all |
| `condition` | A condition expression (section 6). Absent: true |

The **actions** are fixed:

| Action | Taken when |
|---|---|
| `start_run` | A run is started |
| `perform_activity` | An agent, robot or application performs an activity |
| `reach_agent` | The engine sends the work of an activity to an agent over A2A |
| `call_tool` | An actor calls a tool |
| `claim_task` | A task is assigned to a principal, who then holds it |
| `assign_task` | A principal assigns a task to another |
| `complete_task` | A person completes or rejects a task |
| `approve` | A person approves a task under a four-eyes rule |
| `answer_agent` | Someone gives the input an agent over A2A asked for (28.6) |
| `publish_event` | Someone gives the host a business event (18) |
| `read_journal` | Someone reads the journal of a run |
| `cancel_run` | Someone withdraws a run (5.8), where a host offers it |
| `migrate_run` | Someone moves a run to another version of its workflow, where a host offers it |

A `subject` matches a principal when every field it has matches: `ids`, the principal's id is listed; `kinds`, its kind is listed; `roles` and `groups`, one of its `roles` or `groups` attributes is listed; `attributes`, for each name given, the principal's attribute of that name, or one of its values when it is a list, equals the value given, or one of the values given when that is a list. Values are compared as JSON values.

The **resource** of an action is what it is taken on: `workflow_id` and `workflow_name`; for an activity, `activity_id`, `activity_name`, `role_id` and, when the role is known, `role_name`; `classification`, the activity's entry in `classifications`, else its workflow's; and, as the action has them, `run_id`, `tool` and `link` (17.5), `agent` (the card URL), `task_id` and `event_type`. A rule's `resource` matches when every field it has matches: `workflows`, `activities` and `roles` list an id or a name of the resource's; `tools`, `agents` and `classifications` list the resource's.

A `condition` is evaluated against an object with four properties: `principal` (`id`, `kind`, `name`, and `attributes`), `resource`, `run` and `action`. `run` is the run's data where the decision is taken: the token's data in a run, the input of a run being started, the inputs of a task in a task queue. `principal.attributes.clearance >= 3` and `run.amount < 10000` are conditions.

A deployment's `authorization` MUST be validated when it is loaded, and refused, naming every problem, when a rule has an unknown field or action, a condition that is not a valid expression, or an id used twice, and when the other requirements of this section are not met. A host MUST NOT start with an `authorization` it refused.

### 30.3 Deciding

The decision on an action is **deny-overrides with default deny**:

1. A rule applies when one of its `actions` is the action and its `subject`, `resource` and `condition` all match.
2. A separation of duties or a four-eyes rule denies as below.
3. If anything denies, the action is denied, and the decision names the first that denied: in the order of `rules`, then of `separation_of_duties`, then of `four_eyes`.
4. Otherwise, if a rule allows, the action is allowed, and the decision names the first rule that allowed it.
5. Otherwise the action is denied, and the decision names no rule.

A decision has `decision` (`allow` or `deny`), `rule` (its id, absent when none decided), `reason` (`rule`, `no_rule`, `separation_of_duties`, `four_eyes` or `decider_error`) and a `message` whose wording is the implementation's. A decision depends only on the action, the principal, the resource, the run's data and the run's record: the same request is decided the same way by every implementation, every time.

**Separation of duties.** An entry of `separation_of_duties` has an `id`, the `activities` of a set (at least two, by id or name), the `actions` it governs (`perform_activity`, `complete_task` and `approve` unless it names fewer), and `includes_starter`. It denies a governed action on an activity of the set to a principal who, in the same run, performed another activity of the set; with `includes_starter: true`, also to the principal who started the run, and then the set may name a single activity. The person who submitted a claim may not approve it; the requester may not approve their own request. A principal performed an activity when its completion names them (30.6): the agent that performed it, the person who completed its task, and each approver under a four-eyes rule. Performing the same activity again, as in a loop, is not a breach.

**Four eyes.** An entry of `four_eyes` has an `id`, the `activities` it covers and `approvals`, a whole number of at least 2. A person's answer to the task of a covered activity is an **approval**: the action decided is `approve`, not `complete_task`. An allowed approval is kept with the token, and the token keeps waiting until `approvals` distinct principals have approved; the answer that completes the count completes the activity, whose output is the answers merged in the order they were given, a later answer's property replacing an earlier one's. An approval by a principal who has already approved that task is denied by the four-eyes rule. The approvals already given survive a checkpoint and a recovery (10.3), as the token does.

**Without a policy.** When the deployment's `authorization` has no `policy` (and no other decider, 30.7), nothing is decided and nothing is refused. The principals of 30.1 are still recorded (30.6). When the deployment has no `authorization` at all, nothing of this section applies.

### 30.4 Enforcement points

Under a policy, an engine and a host MUST ask before each of these, and MUST NOT take the action when the decision is a denial:

| Point | Action | Principal | On denial |
|---|---|---|---|
| A run is started | `start_run` | The caller, or the host (30.1) | No run is created and nothing is journalled. The caller is refused with `FORBIDDEN` |
| Before the first attempt of each visit of a token to an activity whose actor is not a person | `perform_activity` | The identity that performs it (30.1) | The activity is not started: no `activity.started`. The token fails with `FORBIDDEN` |
| Before the engine reads the card of an agent over A2A or sends it anything, after `perform_activity` | `reach_agent` | The agent's identity | Nothing is sent. The token fails with `FORBIDDEN` |
| A tool call, after the deployment's permissions (17.3, step 3) | `call_tool` | The principal performing the activity | The call is refused: `tool.failed` with `invoked: false` and code `FORBIDDEN`, returned to the actor. It does not fail the activity |
| A person's answer reaches the run (5.6) | `complete_task`, or `approve` under a four-eyes rule | Who answers | Nothing of the answer is applied, and the token keeps waiting. The caller is refused with `FORBIDDEN` |
| A task in a task queue is assigned | `claim_task` for the assignee; `assign_task` for the caller, when the caller is not the assignee | | The task is unchanged. `FORBIDDEN` |
| A task in a task queue is completed or rejected | `complete_task` | The caller | The task is unchanged. `FORBIDDEN` |
| An agent's input is given; a business event is published; a journal is read; a run is cancelled or migrated, where a host offers it | `answer_agent`, `publish_event`, `read_journal`, `cancel_run`, `migrate_run` | The caller | `FORBIDDEN` |

A child run (section 24) is not decided as `start_run`: starting it is how its parent performs the call activity, which is decided as any activity is. Its `run.started` names as `principal` whoever started the run of depth 0 above it. A person's answer to a task of a child run, given through its parent (24.4), is decided in the child run, for who answers, as in any run. A host that offers a workflow as an A2A agent (28.8) decides `start_run` for the caller whose message starts a run and `cancel_run` for the caller that cancels its task.

Retries of an activity (10.1, 7.4, 11.3) are attempts of the same visit and are not decided again. The attempt that resumes an agent's task after the host gave it input (28.6) continues the visit and is not decided again either. A compensation handler (13.6) is run by the engine to undo work already allowed, and is not decided.

A task queue that does not host the run decides with the task's inputs as the run's data and without the run's record: separation of duties and four-eyes rules are applied when the answer reaches the run, which may still refuse it.

Authorization comes after authentication and never replaces it. A host that requires authentication refuses an unauthenticated request as before; a policy can only refuse more.

### 30.5 Errors

A denial fails with the error code `FORBIDDEN`. It is distinct from `PERMISSION_DENIED`, which says that the deployment does not let anything reach a host or run a program (17.4, 28.2), whoever asks. A token that fails with `FORBIDDEN` is not retried, whatever its retry policy says. An HTTP host answers a denial with status 403 and a body that holds `code: "FORBIDDEN"`, a `message`, and the `decision` with its `action` and the principal's `id` and `kind`. A host SHOULD log a denial that belongs to no run, such as a refused start or a refusal in a task queue, since it has no journal to go to.

### 30.6 Record

What a run records says who did what:

| Event | Carries |
|---|---|
| `run.started` | `principal`: who started the run |
| `activity.started`, `activity.completed` | `principal`: the identity that performed the activity, when its actor is not a person |
| `token.resumed`, `activity.completed` | `principal`: who answered a person's task; under a four-eyes rule, `approvals` on `activity.completed`: every approver, in order |
| `run.migrated` | `principal`: who moved the run to another version (25.3) |
| `authorization.decided` | A decision, as below |

These are recorded whenever the deployment has an `authorization` section, with or without a policy. A principal is journalled as its `id` and `kind` only; its attributes, which may be personal data, and its credentials, never.

`authorization.decided` is an `execution` event with the `token_id`, `node_id` and, for a tool call, the `attempt` it concerns, and `data`:

| Field | Content |
|---|---|
| `action` | The action decided |
| `decision` | `allow` or `deny` |
| `principal` | `id` and `kind` |
| `resource` | The resource of 30.2 |
| `rule`, `reason`, `message` | As in 30.3 |
| `approval` | For an approval under a four-eyes rule, `given` (how many with this one) and `required` |

An engine MUST record a denial within a run, MUST record every allowed approval under a four-eyes rule, and records other allowed decisions when the deployment sets `record_allows`. The decision to start a run is not journalled: a refused start has no run, and an allowed one names its principal on `run.started`.

The record a separation of duties is decided on is the run's own: the principals that completed its activities, kept with the run across checkpoints, recovery (10.3) and migration (25.3). A run of depth 0 and its child runs (section 24) are one record: in any of them, a separation of duties is decided on the activities completed in all of them, those of child runs that have ended included (24.8), and `includes_starter` names whoever started the run of depth 0.

### 30.7 Other deciders

A deployment MAY replace the built-in policy by another **decider**: a function given the request (`action`, `principal` with its attributes, `resource`, `run`, and `history`: `started_by`, the activities `performed` with the ids of their principals, and the `approvals` already given) that returns a decision of 30.3. It is the extension point for an external policy engine, such as Open Policy Agent or Cedar; how the request maps to that engine's input is the deployment's. The engine enforces and records a decider's decisions exactly as the built-in policy's. A decider that fails, or that returns anything other than a decision, denies, with reason `decider_error`: an engine MUST fail closed.

The reference implementations take a decider as `authorization.decider` in the engine's options, an object with `decide(request)`; in TypeScript it may return a promise.

### 30.8 Out of scope

How people sign in, and how tokens are issued: OAuth 2.0 and OpenID Connect flows, token refresh, signature algorithms other than the HS256 of the reference servers. Provisioning principals and keeping a directory in step (SCIM, LDAP). Delegation and acting on behalf of another. Fetching attributes at the time of a decision. Obligations and advice attached to decisions. Administering policies: their versions, distribution and review. Credentials for `jsonrpc`, `command`, `mcp` and `grpc` bindings. Masking fields of data by classification. Who may see which tasks in a list, and who may read or register definitions.

### 30.9 Conformance

Level `authorization` covers 30.1 to 30.6. Its cases are in `spec/conformance/authorization/` (Appendix A): a workflow, a deployment's `authorization`, a run played step by step by named principals, and the decisions, error codes and journal entries that must follow. The HTTP routes, credentials, other deciders and their failures, and recovery are fixed by `sdk/typescript/tests/authorization.test.ts` and `sdk/python/tests/test_authorization.py`.

## 31. Guardrails

Verification (section 7) and outcome contracts (section 11) judge whether an outcome is right. A **guardrail** judges whether something may pass at all: whether an input may reach an AI agent, whether an output may leave one, whether a tool call may run and whether what a tool returned may be given back. It applies a check to that value at run time and, when the check finds something, takes a declared action: block, redact, retry with feedback, escalate to a person, or warn.

Guardrails are declarative. A document states them, a deployment adds its own, and an engine at level `guardrails` applies both the same way whichever implementation runs them, records every time one acts, and never records what it found.

### 31.1 Where guardrails are declared

A guardrail is declared in a `guardrails` list on one of:

| Declared on | Applies to |
|---|---|
| The deployment | Every run the engine performs. A document cannot remove or weaken it |
| The workflow | Every activity of the workflow, and every tool call they make |
| A role | Every activity of that role, and every tool call they make |
| An activity | That activity, and every tool call it makes |
| A tool (17.1) | Every call of that tool, whatever the activity's actor |

A guardrail declared on the deployment, the workflow, a role or an activity applies at stages `input` and `output` to activities whose actor type is among its `actor_types`, by default `["ai_agent"]`, and at stages `tool_call` and `tool_result` to the tool calls of those activities, restricted to the tools named in its `tools` when it has one. A guardrail declared on a tool applies to that tool's calls only, at stages `tool_call` and `tool_result`; any other stage on a tool is an error (31.11). The role of an activity is the one its `role_id` names, among the roles of the document and those the deployment supplies (12.3).

A deployment's guardrails are given to the engine with its configuration (the reference SDKs take them in the option `guardrails`). They are guardrails in the same form as a document's.

### 31.2 The guardrail

| Field | Meaning |
|---|---|
| `id` | UUID. Unique among the guardrails of the document |
| `name` | Optional. Carried by the record |
| `stages` | One or more of `input`, `output`, `tool_call`, `tool_result` (31.3) |
| `check` | What is looked for (31.4). An object with a `kind` |
| `action` | `block`, `redact`, `retry_with_feedback`, `escalate` or `warn` (31.5) |
| `actor_types` | The actor types of the activities it applies to. Default `["ai_agent"]`. Not used on a tool |
| `tools` | The names of the tools it applies to at `tool_call` and `tool_result`. Default: every tool. Not used on a tool |
| `fields` | Paths (6.2) within the value checked, through object properties only. When given, the checks `personal_data`, `deny_list`, `prompt_injection` and `size` look only at what those paths hold; findings keep their path within the whole value |
| `replacement` | For `redact`: the text that replaces each match, in which `{category}` is replaced by the match's category. Default `[REDACTED:{category}]` |

### 31.3 Stages

| Stage | The value checked | When |
|---|---|---|
| `input` | The input the actor is about to be given: the token's data without the properties reserved to the engine (5.2), with the contexts the activity is given (22.2) under `_contexts` | Once for each visit of a token to the activity, after its contexts and knowledge are gathered and before the first attempt. An `input` guardrail is not an attempt: retries and feedback attempts do not check the input again |
| `output` | The actor's result without the properties reserved to the engine, with what it writes to contexts (22.3) under `_context_writes` | In every attempt that returns a result, **before the outcome contract (11.3) and before verification (section 7)**. A result that is not yet an outcome (a person's task still pending, 5.6; an agent asking for input, 28.6) is not checked |
| `tool_call` | The arguments of a call | Between steps 1 and 2 of 17.3: after an unknown tool and the call budget are refused, before the arguments are validated, permissions applied and `tool.invoked` recorded |
| `tool_result` | The result of a call that returned | Between steps 5 and 6 of 17.3: after the binding ran, before `tool.completed` is recorded and the result given to the actor |

Because an output guardrail runs first, the contract and verification see the output as the guardrails left it, and an output a guardrail blocked is never judged. The checks `json_schema`, `allowed_values` and `topic` at stage `output` apply to the outcome (11.1); the other checks apply to the whole value of the table.

A guardrail of stage `input` or `output` does not apply to an activity performed by a person who answers an escalation (31.5), nor to a human decision given when a token resumes (5.6). The terms of an outcome contract still bind those (11.5).

### 31.4 Checks

Every check is deterministic except `model` and `classifier`, whose result is what the model or classifier says. A check either finds nothing or makes **findings**. A finding has a `category`, and where it has one, the `path` of what it concerns within the value checked, as a JSON Pointer (RFC 6901), and for a match within a string the `start` and `end` of the match, counted in Unicode code points from the start of that string, `end` excluded.

| `kind` | Fields | Finds |
|---|---|---|
| `personal_data` | `categories`: any of `email`, `phone`, `iban`, `credit_card` (default all four); `patterns`: custom patterns, each a `name` and a `pattern` | Matches of the built-in patterns of 31.4.1 and of the custom patterns. A custom pattern's category is its `name` |
| `deny_list` | `terms`: words or phrases; `patterns`: custom patterns as above; `whole_words` (default true) | Each occurrence of a term, compared without regard to case, and each match of a pattern. With `whole_words`, a term matches only where it is neither preceded nor followed by an ASCII letter, digit or underscore. The category of a term is `term`, of a pattern its `name` |
| `prompt_injection` | `markers`: ids of the markers of 31.4.2 (default all); `patterns`: custom patterns as above | Matches of the markers and patterns. The category of a marker is its id |
| `size` | `max_characters`, `max_tokens` (at least one) | Characters: the number of code points of all the strings in the value checked. Tokens: that number divided by four and rounded up, the approximation the reference SDKs make where a provider reports no usage. A finding of category `max_characters` or `max_tokens`, with `limit` and `actual`, for each limit exceeded |
| `json_schema` | `schema`: a JSON Schema (2020-12) | A finding of category `schema` for each error, with the `path` of the instance and the `keyword` that failed. Never the value |
| `allowed_values` | `path` (6.2, object properties only), `values` | A finding of category `allowed_values` with that path when the value there is missing or equal to none of `values` (as JSON values) |
| `topic` | `allow`: condition expressions (section 6) | A finding of category `off_topic` when none of the expressions is true of the value checked. A topic allow-list over data: the value's own fields (an intent, a product, a classification an earlier activity made) say what it is about |
| `model` | `instructions`: what to flag; `model`: a model reference (12.1); `categories`: the categories it may name | What a guard model says (31.8) |
| `classifier` | `name`: a classifier the deployment registers; `config`: given to it unchanged | What the classifier says (31.8) |

Only strings are scanned by the pattern checks (`personal_data`, `deny_list`, `prompt_injection`): object keys, numbers and booleans are not. Strings are visited in document order: the properties of an object in the order they appear, the items of an array in order.

Within one string, the matches of a pattern are found from left to right without overlapping, as a regular expression engine of the ECMAScript or Python kind finds them. A candidate that fails a check that follows the pattern (31.4.1) is not a match, and the search continues after it. Patterns are applied in this order: for `personal_data`, `email`, `iban`, `credit_card`, `phone`, then the custom patterns; for `deny_list`, the terms, then the patterns; for `prompt_injection`, the markers in the order of 31.4.2, then the patterns; each list in the order given. A match that overlaps a match already kept is dropped. The findings are then put in the order their strings were visited, and within a string in order of `start`.

A custom pattern SHOULD keep to the syntax that ECMAScript (with the `u` flag) and Python's `re` module read the same way: literal characters, character classes with ASCII ranges, groups, alternation, quantifiers and anchors. A pattern that does not compile is an error in the document (31.11).

#### 31.4.1 Personal data

| Category | Pattern | Followed by |
|---|---|---|
| `email` | `[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}` | |
| `iban` | `(?<![A-Za-z0-9])[A-Z]{2}[0-9]{2}(?: ?[A-Z0-9]{4}){2,7}(?: ?[A-Z0-9]{1,4})?(?![A-Za-z0-9])` | Without its spaces, 15 to 34 characters whose ISO 13616 checksum holds: the first four characters moved to the end, letters replaced by 10 to 35, the number modulo 97 is 1 |
| `credit_card` | `(?<![0-9])[0-9](?:[ -]?[0-9]){12,18}(?![0-9])` | Its digits pass the Luhn check |
| `phone` | `(?<![A-Za-z0-9+])(?:\+\|00)[1-9][0-9]{0,3}(?:[ .-]?\(?[0-9]{1,4}\)?){2,6}(?![A-Za-z0-9])` | 8 to 15 digits after the `+` or `00` |
| | `(?<![A-Za-z0-9])\(?[2-9][0-9]{2}\)?[ .-][0-9]{3}[ .-][0-9]{4}(?![A-Za-z0-9])` | |
| | `(?<![A-Za-z0-9])\(?0[1-9][0-9]{0,3}\)?(?:[ .-]?[0-9]{2,4}){2,4}(?![A-Za-z0-9])` | 9 to 11 digits |

The three `phone` patterns are applied in that order, as three patterns of one category.

#### 31.4.2 Prompt injection markers

Markers are looked for in data that reaches an agent from outside its instructions: the input of an activity, which holds what earlier activities, people, business events and contexts put there, and the results of tools. They are compared without regard to case. `\s` below stands for `[ \t\r\n]`.

| Id | Pattern |
|---|---|
| `ignore_instructions` | `(?<![A-Za-z])(?:ignore\|disregard\|forget\|override)\s+(?:all\s+\|any\s+)?(?:(?:the\|your\|my\|these)\s+)?(?:previous\|prior\|above\|earlier\|preceding\|original)\s+(?:instructions\|directions\|prompts?\|rules\|guidelines)` |
| `new_instructions` | `(?<![A-Za-z])(?:new\|updated\|revised\|real\|actual)\s+(?:system\s+)?instructions\s*:` |
| `reveal_instructions` | `(?<![A-Za-z])(?:reveal\|print\|show\|repeat\|output\|leak)\s+(?:me\s+)?(?:the\|your)\s+(?:system\s+prompt\|hidden\s+instructions\|initial\s+instructions)` |
| `jailbreak_mode` | `(?<![A-Za-z])(?:(?:developer\|god\|jailbreak\|unrestricted)\s+mode\|do\s+anything\s+now)` |
| `chat_template_token` | `<\|(?:im_start\|im_end\|system\|user\|assistant\|endoftext)\|>\|\[/?INST\]\|<</?SYS>>` |
| `role_header` | `(?:^\|[\r\n])[ \t]*(?:#{1,6}[ \t]*)?(?:system\|assistant)[ \t]*:` |

**These lists are a floor, not a defence.** They find the crudest attempts at instructing a model through data, and the most common forms of personal data in the forms they are most often written in. A paraphrase, another language, an encoding, an instruction spread over two fields, a phone number written in words, an IBAN in lower case or a personal identifier of a kind not listed all pass them. A deployment that gives an agent data it does not control MUST NOT rely on detection to make that safe: what the agent can do is bounded by its tools and the deployment's permissions (17.4), the contexts it is bound to (section 22), its outcome contract (section 11) and verification (section 7). Pattern checks are cheap and predictable, which is why they come first; a deployment that needs more adds a `model` or `classifier` check, which is neither cheap nor predictable.

### 31.5 Actions

| Action | Stages | What happens |
|---|---|---|
| `warn` | all | Nothing but the record. The value goes on unchanged |
| `redact` | all | Every match is replaced by the guardrail's `replacement`. The redacted value is what goes on, everywhere the value would have gone: to the actor, to the next guardrail, to the contract and verification, into the token's data and contexts, to the tool, back to the agent, and into the journal. The original is never journalled. Allowed only with the checks `personal_data`, `deny_list` and `prompt_injection` |
| `block` | all | At `input`: the actor is not called; the token fails with error code `GUARDRAIL_BLOCKED`. At `output`: the attempt fails with `GUARDRAIL_BLOCKED` (`activity.failed`, `retryable: false`) and so does the activity; neither the retry policy (10.1) nor verification retries it. At `tool_call`: the call is refused before it runs, as 17.3 refuses a call: `tool.failed` with `invoked: false` and code `GUARDRAIL_BLOCKED`, the refusal returned to the actor. At `tool_result`: the result is withheld; `tool.failed` with `invoked: true` and code `GUARDRAIL_BLOCKED` is recorded instead of `tool.completed`, and the refusal is returned to the actor |
| `retry_with_feedback` | `output` | As a contract violation (11.3): when the actor is `ai_agent` and attempts remain within the contract's `budgets.max_attempts` (default 3), the attempt fails (`activity.failed`, code `GUARDRAIL_BLOCKED`, `retryable: true`), the engine records `meta.recorded` with subject `guardrail_retry`, and executes the activity again with feedback naming the guardrail and the categories found, never the text. Otherwise it is `block` |
| `escalate` | `input`, `output` | The activity is handed to a person, as 11.5 hands a rejected outcome, with the guardrail, the categories found and, at `output`, the output: the engine records `meta.recorded` with subject `escalation` and the human actor performs the activity. At `output` the attempt is first recorded as failed with `GUARDRAIL_BLOCKED`. The token waits (5.6) until the person decides; their decision is bound by the terms of the outcome contract (11.5). An engine that cannot wait for a person fails the activity with `GUARDRAIL_BLOCKED`. An escalation at `input` is not an attempt: the activity is completed by the person with `attempts: 0`. On an activity performed by a person, `escalate` is `block` |

A check that cannot be carried out (a classifier not registered, a model that fails or whose reply cannot be read) is an error, whatever the action: the guardrail **fails closed**. The engine records `guardrail.triggered` with the `error` and action `block`, and acts as `block` does, with error code `GUARDRAIL_ERROR`. Neither code is retried by a retry policy.

### 31.6 Order

The guardrails that apply at a stage are taken in this order: the deployment's, the workflow's, the role's, the activity's, then, at `tool_call` and `tool_result`, the tool's; within each, in the order listed.

They are evaluated one at a time, each on the value as the guardrails before it left it. A guardrail that finds nothing does nothing. One that finds something is recorded, then: with `warn` or `redact` the next guardrail is evaluated, on the redacted value after a `redact`; with `block`, `retry_with_feedback` or `escalate`, evaluation at that stage stops and the action is taken. The first guardrail to stop decides. A deployment's guardrails therefore always run, and run first.

For one attempt the order is: `input` (once for the visit), the actor with its `tool_call` and `tool_result` guardrails around each call, `output`, then the outcome contract and verification (11.3).

### 31.7 Record

Each guardrail that finds something is recorded as a `guardrail.triggered` event, with the token, node and, except at `input`, the attempt:

| Field | Content |
|---|---|
| `guardrail_id`, `name` | The guardrail |
| `source` | Where it was declared: `deployment`, `workflow`, `role`, `activity` or `tool` |
| `stage` | The stage |
| `check` | The check's `kind` |
| `action` | The action taken |
| `categories` | The distinct categories found, sorted |
| `findings` | Each finding (31.4): `category`, and where it has them `path`, `start`, `end`, `limit`, `actual`, `keyword` |
| `tool`, `call_id` | At `tool_call` and `tool_result`: the call (17.5) |
| `error` | When the check could not be carried out |

The record MUST NOT hold the text a check matched, nor the value checked, whatever the payload mode (9.4): positions and categories say where and what, and the value they point into is journalled only as the guardrails left it. A guardrail that finds nothing is not recorded. A model's rationale is not recorded either, since it may quote what it flagged.

Every guardrail that acted can thus be counted from the journal. Measures (section 21) define no measure of them in this version; evidence reports (section 32) do not yet make statements about them.

### 31.8 Model and external classifiers

Some things cannot be found by a pattern. Two kinds of check hand the value to something else.

A **`model`** check asks a guard model, through the model router (12.5). The model is the check's `model` reference if it has one, otherwise the engine default (12.3): the model the deployment configures, never one fixed by an implementation. The model is given the guardrail's `instructions` and the value as canonical JSON (9.4), and asked to answer with a JSON object holding `flagged` (a boolean) and optionally `categories` (strings). When `flagged` is true, each category becomes a finding, `flagged` if it names none; when the check declares `categories`, a category it does not declare becomes `flagged`. The engine records the model it used as `meta.recorded` with subject `model_selection` (12.3), and the route as 12.5 says.

A **`classifier`** check calls a function the deployment registers by name (in the reference SDKs, the option `guardrail_classifiers`). It is given the value, the stage, the guardrail and its `config`, and returns `flagged` and optionally `categories`. A deployment uses it for an external moderation or data-loss-prevention service, or a guard model it hosts itself.

Neither can redact, since neither says where in the value it found something. Both fail closed (31.5). In conformance, and wherever a run must be repeatable, the model is scripted (Appendix A) and the classifier is a function of its input.

### 31.9 Simulation and replay

In simulation guardrails apply as in any run, to the inputs and to the scripted outputs and tool results; a `model` check calls the models the deployment registered, which in simulation are usually scripted. In counterfactual replay (section 20) the candidate's guardrails, and the deployment's, are evaluated again on the values the replay holds, so adding or changing a guardrail can be tested against recorded runs. A recorded output that a redaction changed is held as redacted, since the original was never recorded; a blocked output was never accepted and is not held.

### 31.10 What guardrails do not do

- Detection is a floor (31.4.2). Guardrails reduce what reaches a model and what leaves it; they do not make an agent safe to give untrusted data or dangerous tools.
- The input of a run (`run.started`, 9.3) is recorded before any guardrail sees it. A deployment that receives personal data journals payloads as `hash` or `none` (9.4), or redacts before starting the run.
- An input guardrail decides what the actor is given. It does not change the token's data, which an application or a person later in the flow may need.
- Prompts an AI agent builds from its input, its instructions and knowledge, and messages exchanged with a model within an attempt, are not checked one by one: the input is checked before the attempt, tool calls and results as they happen, and the output at the end.
- A guardrail checks values, not behaviour over time: rates, quotas and patterns across runs are a deployment's monitoring.
- Natural-language categories (toxicity, advice of a kind, off-topic in a sense no field states) are what `model` and `classifier` checks are for; AWA fixes how they are called and recorded, not what they decide.

### 31.11 Validation and conformance

A document whose guardrails are inconsistent is invalid at the integrity stage (4.3) with error code `invalid_guardrail`: a guardrail whose action is not allowed at one of its stages (31.5), `redact` with a check other than `personal_data`, `deny_list` or `prompt_injection`, a stage other than `tool_call` and `tool_result` on a tool, a pattern that does not compile, a marker id that 31.4.2 does not define, a `size` check without a limit, or two guardrails with the same `id`. An expression of a `topic` check that is not a valid condition expression is `invalid_expression`.

Level `guardrails` has execution cases (Appendix A) for each check and each action, the order of guardrails, a tool call refused, a tool result redacted, a deployment guardrail added to a document's, and a guard model scripted to flag an output; document cases for the rules above; and a replay case. Each states what the run must do, what value goes on, and which records must and must not be in the journal, including that the text a guardrail matched appears in no event.

## 32. Evidence

Rules on AI systems ask for records: that a system logs what it does over its lifetime, that the people who deploy it can monitor it and keep its logs, that a person can oversee it, and that its accuracy and robustness can be shown. The journal (section 9) and the journey records (section 19) already hold most of what such rules ask about. An **evidence report** gathers it for a period and a set of workflows, in a form a deployer can hand to an auditor, a regulator or its own risk function.

An evidence report is computed from the record, never estimated. Every statement in it cites the records it rests on.

**An evidence report is evidence a deployer can use. It is not a certification of compliance.** It does not establish that a system, a deployer or a provider complies with the EU AI Act, the NIST AI RMF, ISO/IEC 42001 or any other framework, and an implementation MUST NOT present it as doing so. Whether the records meet an obligation depends on the system, its intended purpose, its risk classification and the applicable law, none of which a report assesses.

### 32.1 The report

A report is computed from journals and journey records in the form a host exports them (21.1): journeys with their instances and the journals of their runs, the workflows, and runs that belong to no journey. Its form is fixed by `spec/json-schema/evidence-report.schema.json`.

| Option | Meaning |
|---|---|
| `from`, `to` | Keep the runs started at or after `from` and before `to`, each by its own `run.started`, and the journey instances started in the same period. A kept run's journal is kept whole |
| `workflow_ids` | Keep only runs of these workflows, and only the journey instances that have one of them |

| Field | Content |
|---|---|
| `spec_version`, `report` | `"1.1"`, `"evidence"` |
| `as_of` | The instant the record was exported, or the report made |
| `period` | `from` and `to` as given; otherwise the first and last start of what was kept |
| `scope` | The workflows kept, with their versions as recorded and their runs; the journeys kept, with their instances |
| `notice` | A statement that the report is evidence and not a certification, as above. It MUST be present |
| `frameworks` | The frameworks and provisions the parts name (32.4) |
| `parts` | The eleven parts of 32.3, in that order. Each has an `id`, a `title`, the `question` it answers, the provisions it can `serve`, a `summary` of counts, and its `statements` |

A **statement** has a `kind`, a `text` for a person to read, `facts`, and `citations`. The wording of `text` is the implementation's; `facts` are fixed by 32.3.

### 32.2 Citations

A citation names a run and the `seq` of journal events of that run, or a journey instance and the `seq` of journey events of that instance. Within a citation the sequence numbers are in ascending order; a statement has at most one citation per run or instance.

- Every statement MUST cite at least one record, and every record it cites MUST be in the input. An implementation MUST NOT state anything that no record supports.
- A statement cites exactly the records 32.3 lists for its kind: no more, and no fewer.
- A record is cited as it stands. A report MUST NOT alter or summarise the records it cites; a reader follows the citation to the record itself.

### 32.3 Parts and statements

Unless a row says otherwise, a statement is made for each record of the type named, in run order (by start, then run id) and `seq` order, and cites that record. Where a fact has no recorded value it is `null`. `node_name` falls back to `node_id`.

| Part | Kind | One statement per | Facts | Cites |
|---|---|---|---|---|
| `operation` | `run` | Run kept | `run_id`, `workflow_id`, `workflow_name`, `workflow_version`, `status` (`completed`, `failed`, `cancelled`, `in_progress`), `started_at`, `ended_at`, `journey_instance_id` | `run.started` and the event that ended the run |
| | `journey` | Journey instance kept | `journey_id`, `journey_instance_id`, `subject_key`, `status`, `started_at`, `ended_at` | `journey.started` and `journey.completed` or `journey.abandoned` |
| `models` | `model` | Model and node, over all `model_selection` records (12.3) with a `model` | `provider`, `model` (the model's id as recorded, which is the version its provider gives it), `requested`, `tier`, `node_id`, `node_name`, `uses` | Every `model_selection` counted |
| | `route` | `model_route` record (12.5) | `run_id`, `node_name`, `decision` | It |
| | `model_decision` | `decision.evaluated` with method `model` (16.4) | `run_id`, `node_name`, `option`, `confidence` | It |
| `oversight` | `human_decision` | `activity.completed` whose actor is `human`, or that follows a `contract.escalated` at the same node and token since the visit's last `activity.started` | `run_id`, `node_name`, `escalated`, `decided_at` | The completion, and the `token.waiting`, `token.resumed`, `contract.escalated` and `contract.checked` with `decided_by: human` at that node and token since the last `activity.started` |
| | `escalation` | `contract.escalated` (11.5) | `run_id`, `node_name`, `code` | It |
| | `cancellation` | `run.cancelled` (5.8) | `run_id`, `reason` | It |
| `outcomes` | `contract` | `contract.checked` | `run_id`, `node_name`, `attempt`, `passed`, `violations` (the name of each term violated), `decided_by` (`engine` unless recorded) | It |
| | `verification` | `verification.completed` | `run_id`, `node_name`, `attempt`, `mode`, `verdict`, `score` | It |
| `refusals` | `tool_refused` | `tool.failed` with `invoked: false` (17.3) | `run_id`, `node_name`, `tool`, `link`, `code` | It |
| | `context_denied` | `context.denied` (22.3) | `run_id`, `node_name`, `context_name`, `reason` | It |
| `failures` | `attempt_failed` | `activity.failed` | `run_id`, `node_name`, `attempt`, `code` | It |
| | `dead_letter` | `activity.dead_lettered` | `run_id`, `node_name`, `attempts` | It |
| | `tool_failed` | `tool.failed` not refused | `run_id`, `node_name`, `tool`, `link`, `code` | It |
| | `run_failed` | `run.failed` | `run_id` | It |
| | `journey_stalled` | `journey.stalled` of a journey instance kept | `journey_instance_id`, `stage_id`, `run_id` | It |
| `compensations` | `compensation` | `activity.compensated` or `activity.compensation_failed` | `run_id`, `node_name`, `compensates`, `succeeded` | It |
| `service_levels` | `sla` | `sla.warning` or `sla.breached` | `run_id`, `node_name` (`null` for a workflow), `level` (`warning`, `breach`), `scope`, `elapsed_ms`, `limit` (`threshold` or `max_time`), `action` | It |
| `tools` | `target` | Link (17.5), over all tool events; a call without a link is grouped under `tool:<name>` | `link`, `tools` (names, sorted), `calls` (`tool.invoked`), `completed`, `failed`, `refused` | Every tool event of that link |
| `data` | `run_payloads` | Run with at least one payload: the `input` of `run.started` and `activity.started`, the `output` of `activity.completed`, the `arguments` of `tool.invoked`, the `result` of `tool.completed` | `run_id`, `mode` (`full`, `hash`, `none`, or `mixed` when they differ), and the number of payloads `full`, `hash` (an object holding only `sha256`) and `none` (absent) (9.4) | Every event carrying a payload |
| | `context` | Context name, over `context.read`, `context.written` and `context.denied` | `context_name`, `reads`, `writes`, `denied` | Those records |
| `retention` | `held` | The report: one statement | `runs`, `events`, `journey_instances`, `journey_events`, `oldest_record`, `newest_record` | Every record, of a run or of a journey, at the oldest instant and at the newest |
| | `gap` | Run whose journal lacks a `seq` between 1 and its last, or lacks `run.started` | `run_id`, `missing` (the sequence numbers), `starts` | For each missing number, the records just before and just after it; for a journal that is merely without `run.started`, its first record |

Who completed a person's task is on record (30.6): the `activity.completed` that a `human_decision` statement cites carries its `principal`, and a refusal under the deployment's policy is an `authorization.decided` event of the same journal.

Each part's `summary` gives counts over its statements: for `operation` the runs by status and the journeys; for `models` the distinct models, the selections, routes and model decisions; for `oversight` the human decisions, the **overrides** (human decisions taken on an escalated outcome: a person decided in place of an automated outcome that was rejected), the escalations and the cancellations; for `outcomes` contracts and verifications checked and passed, overall and by activity; for `refusals` the refusals of tool calls and of context writes, and tool refusals by code; for `failures` the failed attempts, dead letters, tool failures, failed runs and stalled journeys, and failed attempts by code; for `compensations` those that succeeded and failed; for `service_levels` the warnings and breaches; for `tools` the targets and calls; for `data` the runs by payload mode and the payloads by kind; for `retention` the records held, the oldest and newest, `held_for_ms` (from the oldest record to `as_of`) and the runs with gaps.

### 32.4 What each part can serve as evidence for

Each part names the provisions to which its records are relevant. The EU AI Act (Regulation (EU) 2024/1689) is the reference case; the NIST AI Risk Management Framework 1.0 and ISO/IEC 42001:2023 are named at the level of their functions and clauses, so that the same report serves an organisation that works to them. The mapping is informative. It says that a record is relevant to an obligation; it never says that the obligation is met.

| Part | EU AI Act | NIST AI RMF | ISO/IEC 42001 |
|---|---|---|---|
| `operation` | Art. 12(1) record-keeping over the lifetime; Art. 12(2) logging for monitoring of operation; Art. 26(5) deployers monitor operation | MEASURE | 9.1, Annex A.6 |
| `models` | Art. 12(2); Art. 13(3)(b) characteristics and performance | MAP, MEASURE | Annex A.6 |
| `oversight` | Art. 13(3)(d) human oversight measures; Art. 14(4) overseeing, overriding or reversing an output, interrupting the system; Art. 26(2) oversight assigned to competent persons | GOVERN, MANAGE | Annex A.9 |
| `outcomes` | Art. 13(3)(b); Art. 15(1) accuracy and robustness; Art. 15(3) levels of accuracy and their metrics | MEASURE | 9.1 |
| `refusals` | Art. 12(2) identifying situations of risk; Art. 15(4) resilience to errors and faults | MANAGE | Annex A.6 |
| `failures` | Art. 12(2); Art. 15(4); Art. 26(5) | MANAGE | Annex A.6 |
| `compensations` | Art. 15(4) fail-safe plans | MANAGE | |
| `service_levels` | Art. 12(2); Art. 26(5) | MEASURE, MANAGE | |
| `tools` | Art. 12(2); Art. 26(5) | MAP (third parties) | Annex A.10 |
| `data` | Art. 12(1); Art. 26(6) keeping logs, subject to the law on personal data | GOVERN | Annex A.7 |
| `retention` | Art. 12(1); Art. 13(3)(f) collecting, storing and interpreting logs; Art. 26(6) keeping logs for at least six months unless other law provides otherwise | GOVERN | Annex A.6 |

Guardrail records (`guardrail.triggered`, 31.7) are relevant to the same provisions as `refusals` and `failures`. This version of the report makes no statement about them.

Article 26(6) asks a deployer to keep the logs under its control for a period appropriate to the system's purpose, of at least six months unless other law provides otherwise. The `retention` part states which records are held and over what span; it does not judge whether that period is met, since that depends on when the system was put into use and on other law, notably on personal data.

### 32.5 Output

A report is data (JSON). An implementation SHOULD also render it as a document a person reads: Markdown, or one self-contained HTML page, each giving the notice first, then every part with its question, the provisions it can serve, its summary and every statement with its citations. The reference implementations give it with `compute_evidence`, `awa evidence <dir-or-journals...> [--from --to] [--workflow ...] [--format json|md|html]`, and `GET /api/v1/evidence?from=&to=&workflow_id=&format=`. The command reads runtime directories (19.10) as files, without opening them as a host, so a report can be made while a host runs.

### 32.6 What a report does not do

A report does not assess risk classification, intended purpose, a conformity assessment, technical documentation, a quality management system, a fundamental rights impact assessment, or the reporting of serious incidents; it may inform them. It does not show that a journal was not altered beyond what its sequence numbers show (32.3, `gap`): keeping records intact is the deployer's. An actor's reasoning in the journal is its own account (9.2), and a report never presents it as more. Compliance with the law on personal data is not assessed.

### 32.7 Conformance

Level `evidence` has its own cases, in `spec/conformance/evidence/` (Appendix A): a record, the options of a report, the summaries and statements it must contain with their exact citations, and statements it must not contain.

## 33. Evaluation

A journal records what an AI agent was given and whether what it produced was accepted. Kept over many runs, those records are an evaluation set drawn from real work. This section fixes how one is built, how a candidate (another model, prompt or workflow) is scored against it, and how a candidate can run in the shadow of production.

### 33.1 Cases

A **case** is one visit of a run to an activity whose actor is `ai_agent`: the attempts made there from the first `activity.started` of the visit until it ends. A new visit begins when the same token starts the activity again at an attempt number no greater than the last. A visit ends **accepted** at `activity.completed`, and **rejected** at a `token.failed` or `activity.dead_lettered` at its node and token.

A case conforms to `spec/json-schema/evaluation-case.schema.json`:

| Field | Content |
|---|---|
| `id` | `<run_id>:<activity_id>:<n>`, the n-th visit of the run to that activity |
| `workflow_id`, `workflow_version`, `run_id`, `activity_id`, `activity_name` | Where it was recorded |
| `input` | The `input` of the visit's first `activity.started`: what the agent was given |
| `label` | `accepted` or `rejected` |
| `accepted_by` | For an accepted case, the first that applies: `person` if the visit was escalated (11.5); `verification` if a verification of the accepted attempt passed; `contract` if a contract check of the accepted attempt passed; otherwise `unchecked` |
| `outcome` | For an accepted case, the accepted outcome (11.1) |
| `rejected_by` | For a rejected case, by the code of its last failed attempt: `contract` for `CONTRACT_VIOLATION`, `verification` for `VERIFICATION_FAILED`, otherwise `error` |
| `attempts` | The attempts of the visit |
| `rejections` | For each failed attempt, its `attempt`, `code` and the `terms` that rejected it: the contract terms violated, or the verification criteria failed |
| `tool_calls` | Each call of the visit with its `tool`, `arguments`, and `result`, or `error`, as recorded |
| `sources` | The `seq` of every journal event of the visit the case was built from |

A visit that has not ended, or whose input or accepted output the journal does not hold (payload mode `hash` or `none`, 9.4), is not a case; building a dataset MUST report it as left out. Visits to activities of other actors are not cases. Building cases MUST be deterministic and MUST NOT call a model.

A **dataset** is a file of cases in JSON Lines, one per line. The reference command is `awa eval build <journals...> -o dataset.jsonl`.

### 33.2 Performing a case again

A case is performed again under a **candidate**: a workflow (by default the one the case was recorded with) and the engine options under which its AI agents run. The candidate's activity is the one with the case's `activity_id`. The case is performed through counterfactual replay (section 20) of a workflow reduced to that activity alone, with a journal holding only what the case recorded:

- the agent is given the case's `input`;
- each tool call is answered with the recorded result for the same tool and arguments; a call without one fails with `REPLAY_UNRECORDED`, is listed, and is not performed (20.2). Nothing outside the engine is called but the candidate's model;
- the candidate's outcome contract and verification apply, in the order of 11.3, with their budgets;
- escalation is not taken: a person is not asked during an evaluation, so an outcome the contract would escalate is rejected;
- contexts and knowledge are not given: the journal holds only hashes of the contexts an activity read (22.2), and knowledge is not part of a case.

A case recorded with another workflow, or about an activity the candidate does not have, is not evaluated and MUST be listed as skipped.

### 33.3 Scores

For each case evaluated, the result states whether the candidate's outcome was `accepted`, the attempts it took, whether its last outcome met the contract and passed verification (`null` where none applied), whether an accepted outcome equals the recorded one (canonical JSON, 9.4), and the tool calls that had no recording.

A case **regressed** when it was accepted when recorded and the candidate's outcome is not; it **improved** when it was rejected when recorded and the candidate's is accepted. Every other case is the `same`.

The report conforms to `spec/json-schema/evaluation-report.schema.json`. For each activity, and over all, it gives as rates `{value, n}`, with `value` `null` when `n` is 0 (21.1):

| Rate | Over |
|---|---|
| `recorded_rate` | Cases accepted when recorded, over cases |
| `pass_rate` | Cases the candidate got accepted, over cases |
| `contract_pass_rate` | Cases whose last candidate outcome met its contract, over cases where a contract was checked |
| `verification_pass_rate` | Cases whose last candidate outcome passed verification, over cases where it was verified |
| `same_outcome_rate` | Cases accepted in both with an equal outcome, over cases accepted in both |

It lists the regressions and the improvements, by case and activity, with the reason. The reference command `awa eval run <workflow> dataset.jsonl [--candidate changed.awa.json] [--providers ...]` writes the report as Markdown or JSON and exits with status 2 when there is a regression, so that a dataset gates a change of model, prompt or contract.

### 33.4 Determinism

With the same dataset, the same candidate workflow and a model that answers the same request the same way, an evaluation MUST give the same report. Nothing in it depends on the clock.

### 33.5 Shadow runs

A host MAY run a **shadow**: a candidate workflow or model beside production. Its purpose is to see how the candidate would behave on real work before it replaces production.

- The shadow of a production run is performed when the production run ends, `completed` or `failed`, by counterfactual replay (section 20) of the production journal under the candidate. It receives the same input and the same business events in the same order; tools, people, applications and robots are answered from production's record. Only the candidate's AI agents, model decisions and judges run.
- A shadow MUST NOT act on the world: it MUST NOT run a tool binding, ask a person, publish a business event, or be distilled into knowledge, whatever options it is given. A host gives a shadow only options that cannot act: model providers and tiers, the default model, verification, knowledge to read, and the actor that performs AI agents.
- A shadow MUST NOT change production: not its outcome, not its journal, not the host's state. A shadow that cannot run (a production journal recorded with payload mode `hash` or `none`) is recorded as not run, with the reason.
- A run that was cancelled is not shadowed: what ended it was decided outside the run.
- The shadow has its own journal and run id. It is compared with production's as the report of 20.3; the runs **part** when their status or their path differ, or any node's verdict is not `same`.
- The host reports, per workflow, the measures of section 21 for production and for its shadow, and the runs where they part. Measures of time are not comparable: a shadow does not wait (20.1).

The reference hosts take a shadow as an option (`shadow` of `AwaRuntime`) and keep its comparisons in memory; a host that restarts does not keep them. A shadow that runs before production ends, alongside it, is out of scope: the recorded results that stand in for the world exist only once production has them.

### 33.6 Conformance

Level `evaluation` covers 33.1 to 33.4. Its cases are in `spec/conformance/evaluation/` (Appendix A): journals in and a dataset out; a dataset and a scripted candidate in and scores out. Shadow runs (33.5) have no language-neutral cases. A shadow is a host's arrangement around counterfactual replay, whose comparison is fixed by the `replay` cases and whose measures by the `measures` cases; what remains, that a shadow never acts and never changes production, depends on how a host is wired to the outside world, which a case cannot state for every host. It is fixed by unit tests in both SDKs (`sdk/typescript/tests/shadow.test.ts`, `sdk/python/tests/test_evidence_evaluation.py`), with a tool that would write a file.

## Appendix A. Conformance suite

`spec/conformance/` holds language-neutral cases.

**Expression and entry tables.** `expressions.json` holds condition expressions (section 6) with the data they are evaluated against and their results. `unary-tests.json` holds decision table entries (5.5.1) with values and results. Both list inputs that must be rejected. An implementation of level `core` MUST reproduce the first; of level `decision`, the second.

**Document cases** (`documents/*.json`) each give a `document`, whether it is `valid`, and for invalid documents the `stage` at which it must be rejected (`schema` or `integrity`) and the `error_code`. A document case MAY give a `level`; it then belongs to that level (for example `guardrails`, 31.11) instead of `document`.

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

Execution cases at level `guardrails` add: in `options`, `guardrails`, the deployment's guardrails, given to the engine with its configuration (31.1); `classifiers`, for the name of each classifier the deployment registers, the verdict it gives every time (`flagged` and `categories`); and in `expect`, `given_inputs`, for an activity name, a subset that the input its actor was given at its last execution must contain (properties reserved to the engine left out), `journal_excludes_text`, strings that no journal event may contain anywhere, serialised as JSON, and `guardrail_sources`, the `source` of every `guardrail.triggered`, in journal order. A guard model is scripted as `model.replies`, each reply a `text`.

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

**Replay cases** (`replay/*.json`), at level `replay` unless they give another `level`, each give a `workflow`, `input` and `actors` that produce the baseline run; optionally a `candidate` workflow; `ai` (`recorded` or `live`); and for `live`, `candidate_actors` for the AI agents. `expect` gives `baseline_status`, `candidate_status`, `same_path`, `verdicts` by node name (20.3), `regressions` or `regressions_at_least`, `unrecorded` (how many situations had no recording), `divergence_after`, and `error_matches`.

Execution cases at levels `contexts` and `service_levels` add: in an actor's script, `contexts`, what the actor writes by context name, and `takes`, the time the execution takes; `clock`, the instant at which the case's clock starts, on which the engine and the actors then run; in `deliver`, the steps `{"advance": <duration>}`, which moves the clock, and `{"check_service_levels": true, "expect": {warnings, breaches, failed}}`, which asks the engine to check the work that is waiting (23.2) and states how many it newly recorded and how many tokens it failed; in `expect`, `given_contexts`, for each activity named the contexts its actor was given at its last execution (`null` for none at all), and `contexts`, the value of every context that has one when the case ends.

Execution cases at level `subworkflows` add `workflows`: the other workflows the case's workflow may call. A runner gives the engine those and the case's workflow itself (24.1). `actors` scripts the activities of all of them, by name. An actor's script MAY give `human_task: true`: the actor hands the activity to a person, and the token waits (the case's `options` set `wait_for_human_tasks`). In `deliver`, `{"complete_task": {"activity": <name>, "output": <object>}}` completes, through the run, the task of every token waiting for a person at an activity of that name, in the run or in any run it called, and `resumes` says how many there must be; `{"cancel": <reason>}` cancels the run (5.8). In a case whose `options` set `simulate`, the runner registers no actors, and activities return what `options.simulated_outputs` scripts (24.6). `expect.subworkflow_runs` lists every child run, at any depth, in the order they started: each gives fields its record in the run's result must have (24.7), and MAY give `journal`, `journal_contains` and `journal_excludes`, which apply to that child run's own journal as they do to the parent's. A runner MUST also check that every child run's journal is valid and numbered from 1 without a gap, that its `run.started` names its parent run and the `seq` of the `activity.started` of the parent's attempt, and that the parent's journal records `subworkflow.started` for it.

Execution cases at level `a2a` add `agents`: for the URL of each agent card, the `card` and the agent's `replies`. A runner stands in for every agent: a `GET` of a card's URL answers with the card, and each JSON-RPC request to the interface URL the card names takes that agent's next reply, the last repeating. A reply is `{"result": ...}` or `{"error": ...}`, sent as the JSON-RPC response to the request; any other address cannot be reached. In `deliver`, the step `{"agent_input": <object or text>}` gives that input to every token waiting for an agent's input (28.6), and `resumes` says how many there must be. In `expect`, `agent_card_reads` is how many times cards were read, `agent_requests` the JSON-RPC methods of every request sent to an agent, in order, and `agent_requests_contain` partial requests, each with `agent` (the card's URL), `method` and `params`, that some request must contain.

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

**Interchange cases** (`interchange/*.json`, level `interchange`) each give a `kind`:

| `kind` | Given | `expect` |
|---|---|---|
| `import_bpmn` | `bpmn`, a BPMN document; optionally `dmn`, a list of DMN documents | `documents`: the AWA documents the import gives, in order, compared as JSON values; or `error_matches` |
| `import_dmn` | `dmn`, a DMN document | `decisions`: the decision nodes the import gives; or `error_matches` |
| `round_trip` | `workflow`, an AWA document | `round_trip: true`: exporting it to BPMN and DMN and importing the result gives an equal document |
| `export_serverless_workflow` | `workflow` | `document`: the Serverless Workflow document, and `not_mapped`: the list of what does not map, both compared exactly |

`error_matches` is a regular expression the refusal's message must match; refusals name the element by its kind and identifier, as in `complexGateway "G1"`. `feel.json` holds the FEEL translations of 27.10: `unary` (a FEEL input entry and the AWA entry it becomes), `unary_invalid` (FEEL to refuse), `unary_export` (an AWA entry, optionally a column `type`, and its FEEL), `conditions` (a BPMN condition and the AWA condition it becomes), `conditions_invalid`, and `conditions_export` (an AWA condition and its FEEL, `null` when it is written in AWA's language).

Runners: `sdk/typescript/tests/conformance.test.ts`, `sdk/python/tests/test_conformance.py`.
**Telemetry cases** (`telemetry/*.json`) each give a record and the trace that must be derived from it (section 26). A run's record is `journal`, its events in order, with `decision_nodes`, the ids of the workflow's decision nodes; a journey's is `journey`, the events of one instance. `options.payloads` says whether the deployment opts in to payloads (26.6). `expect` gives the `trace_id` every span must carry, `span_count`, the exact number of spans, and `spans`: each names a `span_id`, which exactly one span must have, and may state `parent_span_id` (`null` for the root), `name`, `kind` (`internal` or `client`), `start` and `end` (compared as instants), `status` (`ok`, `error`, `unset`) and `status_message`, `attributes` (a subset, with JSON values compared exactly, so that `1` and `1.5` and `true` stay apart), `absent` (attributes that must not be there), `events` (the names of its span events, exactly and in order), `events_contain` (partial span events: a `name`, `attributes`, and `absent`) and `links` (exactly). `expect.otlp_json` gives the whole OTLP/JSON request, compared with attributes in any order. A case with `report` gives a measure report instead (21.1), and `expect` gives `metric_count`, the gauges that must be `absent`, and for each gauge named its `unit` and its data points (`attributes` and `value`, exactly), with the `time` and `start_time` of every point.
**Evidence cases** (`evidence/*.json`) each give `recorded`, in the form a host exports (journeys with their instances and the journals of their runs, the workflows, and `runs` that belong to no journey), and the `options` of the report (32.1). `expect` gives:

| Field | Meaning |
|---|---|
| `summaries` | For a part, a subset its `summary` must contain |
| `statements` | Each names a `part`, a `kind` and a subset of `facts`: exactly one statement of that part and kind must contain those facts. Where `citations` is given, that statement's citations must be exactly these, compared as sets of `{run_id, seq}` and `{journey_instance_id, seq}` |
| `absent` | Statements, described the same way, that no statement may match |
| `cited_runs` | Exactly the runs the report cites, over all its statements |

A runner MUST also check that the report validates against `evidence-report.schema.json` and that every sequence number of every citation names a record of `recorded` (32.2).

**Evaluation cases** (`evaluation/*.json`) are of two kinds. A case of kind `build` gives `journals`, journal events of several runs, and `expect`: `case_count`, the number of cases built; `skipped`, the number of visits left out; and `cases`, each naming a case by `id` with fields it must have exactly as given (33.1). A case of kind `run` gives a `workflow`, a `dataset` of cases recorded with it, optionally a `candidate` workflow, and `candidate_actors`: for an activity name, the script of the candidate's AI agent as in an execution case, which a script under `cases` replaces for the case of that id. Its `expect` gives `evaluated`, and the number of `skipped`, `regressions` and `improvements`; `activities`, for an activity name, its `cases`, the `value` of each rate (`null` meaning no value), and the case ids of its `regressions` and `improvements`; and `results`, for a case id, fields of its result, `unrecorded` being the number of tool calls without a recording. A runner MUST validate each case built against `evaluation-case.schema.json` and each report against `evaluation-report.schema.json`.

**Authorization cases** (`authorization/*.json`, level `authorization`) each give a `workflow`, the deployment's `authorization` (30.2), and, as in an execution case, `actors`, `tools` and `agents`. An activity whose actor type is `human` waits for a person: its actor opens a task and the token waits (5.6). The other activities follow `actors`. The case gives `steps`, performed in order:

| Step | Meaning |
|---|---|
| `{"start": {"principal", "input"}}` | The run is started by that principal, or by the host when none is given, with that input; then it runs until it settles |
| `{"complete": {"activity", "principal", "output"}}` | That principal answers the task of the token waiting at the activity of that name with that output; then the run goes on until it settles |

Each step's `expect` gives `allowed`, whether the step was accepted; for a refusal, `code` (`FORBIDDEN`) and, where given, the `reason` of the decision; and, where given, the run's `status` after the step. The case's `expect` gives `started: false` for a run that must not exist, with no journal; otherwise `status`, and `decisions`: the `data` of every `authorization.decided` event, in order, each compared as a subset, and exactly as many as listed. It may also give `visited` (the activities the scripted actors performed), `data`, `journal`, `journal_contains`, `journal_excludes`, `journal_count`, `agent_card_reads` and `agent_requests`, as in an execution case.

**Versioning cases** (`versioning/*.json`, level `versioning`) each give `workflows`, several versions of one workflow (same `id`, different `version`), optionally `journeys`, `actors` as in an execution case, where `{"waits": true}` makes the actor a person who has not answered yet, so that the token waits (5.6), and a `start` time for the case's clock. Most give `steps`, performed in order by one host over one store:

| Step | Meaning |
|---|---|
| `{"register": "<version>"}` | The host registers that version. The case's journeys are registered with the first |
| `{"start": {"input", "version"}, "as": "<name>"}` | The host starts a run of the workflow, on `version` if given, and the case calls it by that name |
| `{"publish": {...}, "as": "<name>"}` | As in a journey case; with `as`, the first run the event started is called by that name |
| `{"complete": {"run", "node", "output"}}` | The person the named run waits for at the node of that name answers with `output` |
| `{"restart": true}` | A new host over what the first one kept, with every version registered so far. With `{"versions": [...]}`, with those versions only; `expect.refused` then says it must refuse to start (25.1), and the case goes on with the host it had |
| `{"advance": "<duration>"}`, `{"tick": true}` | As in a journey case |
| `{"migrate": {"run", "plan", "dry_run"}}` | The host migrates the named run as the plan says, or performs a dry run (25.3) |
| `{"check": {"to_version", "from_version", "plan"}}` | The host checks the workflow's runs and versions (25.4) |

A `start` or `publish` step's `expect` may give the run's `version` and `status`. A `migrate` step's `expect` gives `refusals`, the codes of every refusal, compared in any order (an empty list: none), and may give `applied`, `dry_run`, `status` (of the result), `tokens` (the tokens at rest, each as `from` and `to` node names, `wait` and `outcome`, exactly and in order), `data_changes` (exactly as many changes, each containing what is given, in order), and `run_version` and `run_status`, the version and status of the run after the step. A `check` step's `expect` gives `automatic` (over every version compared), `positions` (every position of every version compared, in order, each as `node`, `wait`, `class`, and where given `to`, `outcome` and `candidates`, by node name) and `runs`, whether each named run is `migratable`. The case's `expect` gives `visited`, the activity names the actors performed, in order, over the whole case, and `runs`: for each named run its `version` and `status` at the end, `data` (a subset of some token's data), `data_absent` (paths no token has), and `journal`, `journal_contains`, `journal_excludes` and `journal_count` as in an execution case. A runner MUST also check that every journal is numbered from 1 without a gap and that its events validate.

A case that gives `state` instead of steps gives a run's state as recorded: its `version`, `status` and `tokens`, each with an `id`, the name of its `node`, its `status`, its `data` and, for a token at rest, `waits` (`kind`, and for a timer its `due_at`). A runner writes the state in the form its engine keeps (10.3), checks the case's `migrate.plan` against it without a host, and compares `refusals`, `refused_tokens` (the token named by each refusal, in order), `tokens`, and `timers`, the due time each token's timer keeps.

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
- Evidence reports computed from journals and journey records, every statement citing the records it rests on and naming the provisions of the EU AI Act, the NIST AI RMF and ISO/IEC 42001 it can serve, without certifying compliance (section 32, level `evidence`); evaluation datasets built from journals and a candidate scored against them, and shadow runs beside production (section 33, level `evaluation`).
- Built-in executors for `mcp` bindings, over standard input and output or Streamable HTTP, and for unary `grpc` calls, held to the deployment's permissions (17.7, 17.8). An agent reached over A2A 1.0 can perform an activity, under the same contract, verification and record as any actor, and a host can offer a workflow as an A2A agent (section 28, level `a2a`).
- The journal and the journey record as OpenTelemetry traces, with identifiers derived from the run and the journey instance, the generative AI semantic conventions, OTLP export that never holds up a run, the standard `OTEL_EXPORTER_OTLP_*` variables, and measures as OpenTelemetry gauges; conformance level `telemetry` (section 26).
- Several hosts may share one store and take any work, with the outcome of one host: a store contract of partitions, holding, acceptance once and versions, met by a PostgreSQL store, with conformance level `shared_store` (section 29). A runtime directory still belongs to one host at a time (19.10).
- Identity and authorization: principals for people, agents and applications, from the authenticated request and from the deployment; a declarative policy in the deployment with deny-overrides, default deny, conditions over the principal and the run's data, separation of duties and four-eyes approvals; enforcement when a run starts, before an agent performs an activity or reaches an agent over A2A, on tool calls and when a person completes a task; denials fail with `FORBIDDEN`; `principal` on run and activity events and the journal event `authorization.decided`; an external policy engine can be plugged in as the decider; conformance level `authorization` (section 30).
- Sub-workflows: an activity with `is_expandable` and `expansion_workflow_id` is performed by a child run of that workflow, with input and output mapping (`subworkflow`), its outcome held to the activity's contract and verification, retries that start a new child, waits that reach the parent, cancellation that reaches the child, `subworkflow.*` journal events, a depth limit, child runs kept with their parent in a runtime directory and in the parent's partition of a shared store, and conformance level `subworkflows` (section 24). **Such an activity used to be performed by its actor; it now runs the named workflow, and fails with `SUBWORKFLOW_NOT_FOUND` where that workflow is not given to the engine.**
- Interchange with BPMN 2.0 and DMN 1.x, import and export without loss through the `awa:` extension namespace (`spec/xsd/awa-interchange.xsd`), with what is not imported refused and named; export to CNCF Serverless Workflow 1.0 with the list of what does not map; conformance level `interchange` (section 27).
- Runs keep the version of their workflow they started on while newer versions are registered, in a runtime directory and in a shared store alike (migration 2 of the store keeps every version); a run at rest moves to another version only by an explicit migration plan, checked whole and refused with named reasons, applied as one change and recorded as `run.migrated`; two versions are compared position by position; conformance level `versioning` (section 25).
- Guardrails on what goes into and comes out of AI agents and tools: declared on the deployment, the workflow, a role, an activity or a tool, at stages `input`, `output` (before the contract and verification), `tool_call` and `tool_result`; deterministic checks for personal data, deny-lists, prompt injection markers, size, JSON Schema, allowed values and topics, and model or external classifiers; actions block, redact, retry with feedback, escalate and warn; the record `guardrail.triggered`, with positions and categories and never the text found; integrity error `invalid_guardrail`; conformance level `guardrails` (section 31).
