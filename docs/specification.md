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

An implementation MUST NOT claim a level unless it passes every case tagged with that level. It MUST report the cases it skips; it MUST NOT silently omit them.

### 2.2 Current implementations

| SDK | Levels claimed |
|---|---|
| TypeScript (reference) | `document`, `core`, `decision`, `verified` |
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
| Every edge `condition` is a valid condition expression (section 6) | `invalid_expression` |
| No node is the source of more than one edge with `is_default: true` | `multiple_default_edges` |

### 4.4 Extension

Processors MUST ignore properties they do not recognise and MUST preserve them when rewriting a document. Extension properties SHOULD be namespaced with a prefix followed by a colon (for example `acme:cost_centre`) so they cannot collide with future versions of this specification.

## 5. Execution semantics

### 5.1 Runs and tokens

A run begins with one token. A token has a status:

| Status | Meaning |
|---|---|
| `active` | The engine will process the token's current node |
| `waiting` | The token is paused until an external party resumes it |
| `completed` | The token reached a node with no outgoing edges |
| `failed` | The token could not proceed |
| `cancelled` | The token was withdrawn |

### 5.2 Data

A token carries a JSON object, its data.

- The data starts as the input supplied when the run starts.
- When an activity finishes, its result object is merged into the token's data, property by property. Later values replace earlier values of the same property.
- The engine also records each activity's result under `activities.<activity id>.output`, so a result is not lost when a later activity reuses a property name.
- Properties whose names begin with `_` are reserved for the engine.

Conditions (section 6) are evaluated against the token's data.

### 5.3 Start and sequence

The start node is the first activity, in document order, that is not the target of any edge. If every activity is the target of an edge, the start node is the first activity in the document.

An engine processes an active token by executing the activity at its node with the activity's actor, then routing the token (5.4).

### 5.4 Routing

When a token leaves a node, the engine selects one outgoing edge as follows, stopping at the first step that yields an edge:

1. The node has no outgoing edges: the token is `completed`.
2. The first edge, in document order, whose `condition` evaluates to true.
3. The edge with `is_default: true`.
4. The first edge, in document order, that has no `condition`.
5. Otherwise there is no route: the token is `failed`.

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
| `failed` | No token is `active` or `waiting`, and at least one is `failed` |
| `completed` | Every token is `completed` |

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
| `verification` | VerificationPolicy | Acceptance criteria (section 7) |
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
| `actors` | What each activity returns, keyed by activity name: `output`, or `error`, or `attempts` (a list of those, one per execution; the last repeats) |
| `expect.status` | The run status |
| `expect.visited` | Activity names in execution order, one entry per execution |
| `expect.data` | A subset that the data of some token must contain |
| `expect.error_matches` | A regular expression some token's `_error` must match |

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
