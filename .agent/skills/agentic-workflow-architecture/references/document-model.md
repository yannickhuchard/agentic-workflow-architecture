# AWA documents: the fields that matter

The JSON Schemas in `spec/json-schema/` are normative; section 8 of `docs/specification.md` summarises them. This file lists what an author sets, with the rules the validator applies. "Required" marks what the schema requires.

## Contents

- Workflow
- Role
- Activity
- Outcome contract, verification, retry
- Tools and their bindings
- Agents over A2A, sub-workflows, compensation, knowledge
- Guardrails
- Edge
- Event
- Decision node: table, external engine, model
- Context and binding
- Service level, access rights, analytics
- Journey
- Two forms of document, and extensions

## Workflow

`workflow.schema.json`. Required: `id`, `name`, `version`, `activities`, `edges`.

| Field | Meaning |
|---|---|
| `id` | UUID. Keep it across versions: hosts, journeys and migrations know a workflow by it |
| `name` | 1 to 255 characters |
| `version` | Semantic version `major.minor.patch`. Two documents with the same `id` and `version` are the same workflow |
| `awa_version` | The specification targeted: `"1.1"` |
| `description` | What the workflow is for |
| `roles` | Role[]: who performs activities, and with which model |
| `activities`, `edges`, `events`, `decision_nodes` | The graph |
| `contexts` | Context[]: what activities share beside the data that flows |
| `sla` | Service level of the whole run (section 23) |
| `guardrails` | Guardrail[] on every activity and its tool calls (section 31) |
| `analytics`, `metadata`, `visualization`, `alternate_visualizations` | Descriptive |
| `owner_id`, `organization_id`, `parent_workflow_id`, `expansion_activity_id`, `created_at`, `updated_at` | Descriptive |

## Role

`role.schema.json`. Required: `id`, `name`, `actor_type`.

| Field | Meaning |
|---|---|
| `actor_type` | `human`, `ai_agent`, `robot` or `application` |
| `ai_model_config` | For `ai_agent`: `model_id` (a model reference), `temperature` (0 to 2), `max_tokens`, `system_prompt` |
| `a2a` | The agent over A2A that performs this role's activities |
| `guardrails` | Guardrails on this role's activities |
| `description`, `capabilities`, `mcp_tools`, `organization_id`, `is_embedded` | Descriptive |

A **model reference** (specification 12.1) is `tier:<name>` (recommended: `tier:reasoning`, `tier:balanced`, `tier:fast`), `<provider>:<model>` for a provider the engine registers, or `<model>` for the default provider. A reference that cannot be resolved fails with `VALIDATION_ERROR`; no other model is substituted.

## Activity

`activity.schema.json`. Required: `id`, `name`, `role_id`, `actor_type`.

| Field | Meaning |
|---|---|
| `role_id` | UUID of the role that performs it |
| `actor_type` | `human`, `ai_agent`, `robot`, `application` |
| `description`, `procedure` | What and why; how, step by step. An AI agent is given both |
| `inputs`, `outputs` | Data objects: `name` (required), `description`, `schema`, `required` (default true) |
| `outcome_contract` | What must be true of the outcome (below) |
| `verification` | Acceptance criteria, fail closed (below) |
| `retry` | What to do when the actor raises an error (below) |
| `tools` | Functions the actor may call (below) |
| `guardrails` | Checks on input, output and tool calls |
| `context_bindings` | Contexts the activity reads or writes |
| `join` | `any` (default): each arriving token executes the node. `all`: wait for a token on every incoming edge and merge them |
| `compensation` | `{ "activity_id": <UUID> }`: the activity that undoes this one when the run later fails |
| `knowledge` | Knowledge from earlier runs given to the actor |
| `a2a` | An agent over A2A that performs it, replacing its role's |
| `is_expandable`, `expansion_workflow_id`, `subworkflow` | A call activity: performed by a child run |
| `sla` | Service level of the activity |
| `access_rights`, `programs`, `controls`, `skills`, `tool_requirements`, `system_id`, `machine_id`, `endpoint_id`, `organization_id`, `analytics` | Descriptive: what the activity needs and touches |

## Outcome contract, verification, retry

**`outcome_contract`** (section 11):

| Field | Meaning |
|---|---|
| `output_schema` | JSON Schema (2020-12) the outcome must validate against |
| `postconditions` | `[{ "name", "expression", "id"?, "description"? }]`: condition expressions true of the outcome |
| `budgets.max_attempts` | 1 to 50, default 3: executions in one visit for any cause (errors, contract, verification together). Overrides higher limits in `retry` and `verification` |
| `budgets.max_duration` | Longest single attempt; past it the attempt fails with `TIMEOUT` (retryable) |
| `budgets.max_tokens` | Model tokens of the visit, judges included; past it the outcome is rejected |
| `budgets.max_tool_calls` | Default 16, per attempt; further calls are refused (`TOOL_BUDGET_EXCEEDED`) |
| `on_violation` | `fail` (default: `CONTRACT_VIOLATION` or `VERIFICATION_FAILED`) or `escalate_human` |

The **outcome** is the result's `output` object when there is one, else the result. Order of checks on every attempt: output guardrails, then `output_schema`, `postconditions`, `max_tokens`, then verification. Only `ai_agent` activities are re-executed after a rejection, with the violated terms as feedback. A person's answer is still held to `output_schema` and `postconditions`.

**`verification`** (section 7). Required: `criteria` (at least one).

| Field | Meaning |
|---|---|
| `mode` | `ai_judge` (default; a model judges each criterion), `schema_only` (each criterion's `expression`, deterministic), `custom` (a verifier the engine registers) |
| `criteria[]` | `id`, `name`, `description`, `type` (`completeness`, `accuracy`, `format`, `compliance`, `custom`) required; `expression`, `weight` (0 to 1, default 1), `required` (default true) |
| `pass_threshold` | Default 0.9: share of weights that must pass, besides every required criterion |
| `max_retries` | Default 3; `retry_with_feedback` default true (only for `ai_agent`) |
| `judge_model_id`, `judge_temperature` | The judge's model reference (default: the engine's) and temperature (default 0.1) |
| `output_schema`, `enabled` | A schema to satisfy; switch off |

**`retry`** (section 10.1): `max_attempts` (default 1, includes the first), `initial_delay` (`PT1S`), `backoff_multiplier` (2), `max_delay` (`PT30S`), `jitter` (true), `non_retryable_errors` (default `VALIDATION_ERROR`, `AUTHENTICATION_ERROR`, `PERMISSION_DENIED`, `NOT_FOUND`). Retry applies to raised errors only; permanent codes are never retried.

## Tools and their bindings

`tools[]` on an activity (section 17). Required: `name` (`^[A-Za-z_][A-Za-z0-9_-]{0,63}$`, unique in the activity), `binding`.

| Field | Meaning |
|---|---|
| `description` | Given to the model: what it does and when to use it |
| `parameters` | JSON Schema of the arguments; invalid arguments are refused before anything runs |
| `documentation` | URI of the interface's documentation |
| `timeout` | Default `PT30S` |
| `guardrails` | Guardrails at stages `tool_call` and `tool_result` |

| `binding.kind` | Fields | Notes |
|---|---|---|
| `http` | `url` (required), `method` (default `GET`), `headers` | `{name}` in the URL is replaced by that argument; other arguments go as query (GET, DELETE, HEAD) or JSON body. `{{secret:NAME}}` in headers is replaced by a deployment secret and never journalled |
| `jsonrpc` | `endpoint`, `method` | JSON-RPC 2.0 over HTTP |
| `command` | `command`, `args` | Runs only when the deployment allows commands; no shell; `{name}` per argument |
| `grpc` | `endpoint`, `service`, `method` | One unary call, described by the deployment's `.proto` files or server reflection, over TLS unless the host is in `grpc.plaintext_hosts` |
| `mcp` | `server`, `tool` | A tool on an MCP server the deployment declares by that name |
| `function` | `name` | A handler registered with the engine (`tools.handlers`) |

```json
"tools": [ {
  "name": "price_part",
  "description": "Price of a replacement part from the repair catalogue.",
  "parameters": { "type": "object", "required": ["part"], "properties": { "part": { "type": "string" } } },
  "binding": { "kind": "http", "method": "GET", "url": "https://catalogue.example/v2/parts/{part}/price",
               "headers": { "authorization": "Bearer {{secret:CATALOGUE_KEY}}" } }
} ]
```

## Agents over A2A, sub-workflows, compensation, knowledge

**`a2a`** on a role or an activity (section 28): `agent_card` (required, URL), `skill`, `on_input_required` (`wait` default, or `fail` with `AGENT_INPUT_REQUIRED`), `headers`. The activity is performed by that agent whatever its `actor_type`; its result goes through the contract and verification as any actor's.

**Call activity** (section 24): `"is_expandable": true` and `"expansion_workflow_id": <UUID>`. Optional `subworkflow`:

```json
"subworkflow": { "input": { "applicant": "applicant", "amount": "request.amount" }, "output": { "credit_grade": "grade" } }
```

`input` maps each child input property to a path in the parent token's data (absent: the parent's data without `_` properties and the engine's records); `output` maps each outcome property to a path in the child's output (absent: the child's output).

**`compensation`**: `{ "activity_id": <UUID> }`. The handler activity must not be the target of any edge. When the run fails, handlers run one at a time in reverse order of completion.

**`knowledge`** (section 15.4): `types` (default `strategy`, `failure_pattern`; also `decision_precedent`, `lesson`), `tags`, `max_entries` (default 5, at most 20), `min_status` (`reviewed` default, or `draft`). An empty object `{}` asks for the defaults.

## Guardrails

`guardrail.schema.json` (section 31), on the workflow, a role, an activity or a tool, and in the deployment. Required: `id` (UUID, unique among the document's guardrails), `stages`, `check`, `action`.

| Field | Values |
|---|---|
| `stages` | `input` (what the actor is given), `output` (before the contract), `tool_call`, `tool_result`. A guardrail on a tool takes only the tool stages |
| `action` | `block` (`GUARDRAIL_BLOCKED`), `redact`, `retry_with_feedback` (stage `output` only), `escalate` (stages `input` and `output`), `warn` |
| `check.kind` | `personal_data` (`categories`: `email`, `phone`, `iban`, `credit_card`; `patterns`), `deny_list` (`terms`, `patterns`, `whole_words`), `prompt_injection` (`markers`, `patterns`), `size` (`max_characters`, `max_tokens`), `json_schema` (`schema`), `allowed_values` (`path`, `values`), `topic` (`allow`: condition expressions), `model` (`instructions`, `model`, `categories`), `classifier` (`name`, `config`) |
| `actor_types` | Default `["ai_agent"]` |
| `tools` | At tool stages: the tools it applies to, by name (default every tool) |
| `fields` | Paths within the value checked (at `output`, within the outcome) |
| `replacement` | For `redact`: default `[REDACTED:{category}]` |

`redact` is allowed only with checks that give positions (`personal_data`, `deny_list`, `prompt_injection`). A custom `pattern` is `{ "name", "pattern" }`, in the syntax ECMAScript (with the `u` flag) and Python read the same way.

## Edge

Required: `id`, `source_id`, `target_id`. Optional: `condition` (an expression), `is_default` (at most one per source node), `label`, `source_type`, `target_type` (`activity`, `event`, `decision`), `skills`, `tool_requirements`.

## Event

Required: `id`, `name`, `event_type`. `join` as for activities.

| `event_type` | `event_definition` |
|---|---|
| `start` | Optional `name`: the business event type that starts a run (used by hosts and journeys) |
| `end` | None. The token completes |
| `intermediate` | None. The token passes |
| `timer` | `duration` (required): weeks, days, hours, minutes, seconds, such as `PT10M` or `P2D` |
| `message`, `signal` | `name` (required), `mode` (`wait` default, or `publish`), `correlation_key` (a path; messages only), `timeout`, `timeout_edge_id` (an edge leaving this event), `data` (for `publish`: the token paths sent as the event's data) |
| `error`, `conditional` | Reserved: a token that reaches one fails with `UNSUPPORTED_EVENT` |

A `message` releases the first matching waiting token; a `signal` releases them all. A wait without `timeout_edge_id` that times out fails with `EVENT_TIMEOUT`.

## Decision node: table, external engine, model

`decision.schema.json`. Required: `id`, `name`, and one of `decision_table`, `decision_engine`, `decision_model`. A table and an engine never go together. Always set `default_output_edge_id`, an edge that leaves this node.

**`decision_table`**: `hit_policy` (`unique`, `first`, `priority`, `any`, `collect`, `rule_order`), `inputs` and `outputs` (columns: `name`, `type` in `string`, `number`, `boolean`, `date`, `datetime`; `label`, `allowed_values`), `rules` (each `input_entries`, `output_entries`, `output_edge_id`, `priority`, `description`, `id`). Outputs are merged into the token's data and kept under `decisions.<node id>`; a later decision node may read them.

Entry grammar (5.5.1): `-`, `*` or empty for any; `null`, `not null`; `> 5`, `>= 5`, `< 5`, `<= 5`, `= 5`, `!= 5`; ranges `[1..10]`, `(1..10)`, `[1..10)`; `in(1, 2)`, `not in("a")`; `contains("x")`, `starts with "x"`, `ends with "x"`, `matches("re")`; a literal for equality; several tests separated by commas (any holds); `not(...)` (none holds). A missing value satisfies only `-`, `null` and negations. Text comparisons order ISO 8601 dates correctly.

**`decision_engine`**: `name` (registered by the deployment), `options` (each `id`, `output_edge_id`, `description`), `ruleset`, `inputs`, `config`.

**`decision_model`** (section 16): `instructions` and `options` (at least two, each `id`, `description`, `output_edge_id`) required; `model` (a reference; `tier:fast` suits), `inputs` (properties shown; default all), `strategy` (`table_first` when the node has a table, else `model`), `min_confidence` (default 0), `votes` (1 to 9; a strict majority decides), `temperature`, `output` (a property that receives the chosen option's id). An invalid or low-confidence reply is no decision: the default edge is taken. Send the default to a person.

```json
"decision_model": {
  "model": "tier:fast",
  "instructions": "Prefer review when the cost is high or the fraud score is middling.",
  "options": [
    { "id": "auto", "description": "Routine, pay without review", "output_edge_id": "<edge to Reserve funds>" },
    { "id": "review", "description": "An adjuster should look first", "output_edge_id": "<edge to Adjuster review>" }
  ],
  "inputs": ["fraud_score", "estimated_cost"],
  "min_confidence": 0.6
}
```

## Context and binding

`context.schema.json` (section 22). Required: `id`, `name` (unique), `type` (`document`, `data`, `config`, `state`, `memory`, `artifact`), `sync_pattern`. Optional: `schema`, `initial_value`, `lifecycle` (`transient`, `persistent`, `cached`), `ttl`, `visibility`, `description`.

| `sync_pattern` | A write |
|---|---|
| `shared_state` | Replaces the value |
| `blackboard` | An object whose properties are added |
| `message_passing`, `event_sourcing` | Appended to a list |

A binding in `context_bindings`: `context_id`, `access_mode` required; `required` (default true), `transforms` (`on_read`, `on_write`: paths). `read`, `read_write`, `subscribe` let it read; `write`, `read_write`, `publish` let it write. An activity sees only the contexts it is bound to read; conditions never see contexts.

## Service level, access rights, analytics

**`sla`** (section 23), on the workflow or an activity: `target_time`, `max_time` (durations), `name`, `escalation_policy` (`warning_threshold`, `warning_action`, `breach_action`: `record` default or `fail`, `notify_roles`), `metrics` (informative). Work that finishes late stands; `breach_action: fail` stops waiting for unfinished work with `SLA_BREACH`.

**`access_rights[]`**: `id`, `name`, `direction` (`requires`, `provisions`), `resource_type` (`system`, `api`, `database`, `file`, `service`, `secret`), `permission` (`read`, `write`, `execute`, `admin`, `delete`, `create`) required; descriptive.

**`analytics`**: `process_time`, `cycle_time`, `lead_time`, `wait_time`, `value_added`, `waste_categories` (`defects`, `overproduction`, `waiting`, `non_utilized_talent`, `transport`, `inventory`, `motion`, `extra_processing`), `cost`, `process_cycle_efficiency`; descriptive.

## Journey

`journey.schema.json` (section 19). Required: `id`, `name`, `version`, `subject`, `stages`.

| Field | Meaning |
|---|---|
| `subject` | `name` (what travels: customer, order) and `key` (the property that identifies one in event and run data) |
| `stages[]` | `id` (slug, required), `name` (required), `description`, `workflows` (UUIDs, informative), `on_enter.start_workflow`, `complete_when` (expression over the journey's data), `max_duration` (past it the journey is stalled), `owner` (who acts when it stalls), `transitions` (`[{ "to", "condition", "is_default" }]`; absent: the next stage; empty: the journey completes) |
| `triggers[]` | `event` (required), `starts_journey` (at least one trigger needs it), `enter_stage`, `start_workflow` |
| `goals[]` | `id`, `name`, `expression`: reaching one is recorded once |
| `exits[]` | `event`, `outcome` (`completed`, `abandoned`), `reason`. An exit cancels the journey's runs still under way |
| `collect` | Run data properties copied into the journey's data when a run ends (absent: all) |
| `artefacts[]` | `id` (slug), `name`, `kind` (business concept: `contract`, `attestation`, `invoice`, `receipt`, `certificate`, `quote`, `form`, `evidence`, `notice`, `order`, `report`, `survey`), `description` |
| `touchpoints[]` | `id` (slug), `name`, `direction` (`inbound`, `outbound`), `channel` (`web`, `email`, `phone`, `sms`, `app`, `post`, `api`, `in_person`, or another word), `on` (exactly one of `event`, `activity` name, `tool` name) required; `party` (default `subject`), `technology`, `exchanges` (`[{ "artefact", "reference" }]`, reference a path in the occasion's data) |
| `sentiment` | `min` (-2), `max` (2), `initial` (0), `carry_over` (true), `rules[]`: `on` (`event`, `touchpoint`, `goal_reached`, `stage_completed`, `stalled`, `run_failed`, `waited`), narrowed by `event`, `touchpoint`, `goal`, `stage`; `longer_than` for `waited`; either `change` (inferred) or `measure` (`path`, `from: [low, high]`, measured); `reason` |

## Two forms of document, and extensions

A document is a workflow object, or an envelope, an object whose `workflow` property holds the workflow, without its own `activities`. Processors keep and ignore properties they do not know; name your own with a prefix and a colon (`acme:cost_centre`). Properties of token data whose names begin with `_` belong to the engine and are dropped from a run's input.
