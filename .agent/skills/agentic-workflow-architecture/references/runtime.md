# Running AWA: engines, hosts, deployments

How the reference engines run a workflow, what a deployment decides, and the record they write. Section numbers refer to `docs/specification.md`.

## Contents

- The engine in TypeScript
- The engine in Python
- Run statuses and token data
- Actors
- Models: providers, tiers, routing
- Tools: permissions, MCP servers, gRPC
- Agents over A2A
- The deployment file
- Identity and authorization
- Sub-workflows
- Hosts, runtime directories and shared stores
- Versions and migration
- Checkpoints, recovery and idempotency
- The journal
- Error codes
- Telemetry

## The engine in TypeScript

```typescript
import fs from 'node:fs';
import { WorkflowEngine, parse_document, validate_workflow, validate_workflow_integrity, FileJournalStore } from 'agentic-workflow-architecture';

const document = JSON.parse(fs.readFileSync('workflow.awa.json', 'utf8'));
if (!validate_workflow(document).valid) throw new Error('schema');
const workflow = parse_document(document);                   // accepts the workflow form and the envelope form
const integrity = validate_workflow_integrity(workflow);     // { valid, errors: [{ path, message, code }] }

const engine = new WorkflowEngine(workflow, { simulate: true, simulated_outputs: { 'Assess refund': { output: { amount: 120 } } } });
await engine.start({ customer_id: 'C-1' });
const status = await engine.run();                           // runs until an outcome or a wait
```

From a clone, import from `sdk/typescript/dist/index.mjs` (ES modules) or `dist/index.js` (CommonJS) after `npm run build`.

Main options of `WorkflowEngineOptions`:

| Option | Meaning |
|---|---|
| `simulate`, `simulated_outputs` | Simulation; by activity name: `output`, or `error` with `code`, `contexts` (writes by context name), or `attempts` (a list, one per execution, the last repeating) |
| `actors` | An actor per actor type, replacing the built-in ones |
| `model_providers`, `default_model_provider`, `model_tiers`, `default_ai_model_id`, `gemini_api_key` | Models (below) |
| `tools` | `handlers` (for `function` bindings), `executors` (per binding kind), `allow_commands`, `allowed_hosts`, `max_output_bytes`, `secrets`, `simulated_results`, `mcp_servers`, `grpc` |
| `a2a` | `allowed_hosts`, `poll_interval_ms`, `max_wait_ms`, `max_output_bytes`, secrets for agents |
| `authorization`, `principal` | The policy and principals (below); who starts the run |
| `guardrails`, `guardrail_classifiers` | The deployment's guardrails, applied before the document's; classifiers by name |
| `subworkflows` | `workflows` that call activities may run, `max_depth` (default 8) |
| `journal`, `journal_payloads` | A `JournalStore` (`InMemoryJournalStore`, `FileJournalStore`); payload mode `full` (default), `hash`, `none` |
| `checkpoint`, `retry`, `dead_letter_queue` | Persistence after every step; default retry policy; dead letters |
| `event_sink` | Receives the business events the workflow publishes |
| `decision_engines`, `model_decision_override` | External decision engines by name; decisions supplied without a model |
| `knowledge`, `learn` | A `KnowledgeBase` for activities with a `knowledge` binding; distil the run into it when it ends |
| `verification_enabled`, `verification_model_id` | Verification switch and judge |
| `wait_for_human_tasks`, `pricing_config`, `telemetry`, `now`, `sleep`, `run_id`, `verbose` | Behaviour, cost rates, spans, clock and test hooks |

Methods: `start(input)`, `run(maxSteps?)`, `runStep()`, `getStatus()`, `getTokens()`, `getEvents(afterSeq?)`, `onEvent(listener)`, `deliverEvent(event)`, `expireEvents(now?)`, `nextEventDeadline()`, `resumeToken(tokenId, output, principal?)`, `answerAgent(tokenId, input)`, `getAgentRequests()`, `cancel(reason)`, `checkServiceLevels(now?)`, `snapshot()`, `getRunId()`, `getContexts()`, `getSubworkflowRuns()`, `flush()`; static `WorkflowEngine.restore(workflow, state, options)` and `WorkflowEngine.recover(workflow, state, options)`. `business_event(type, data)` builds a CloudEvents 1.0 event for `deliverEvent`.

The fluent builder `workflow(name, version)` adds activities (`.activity(name, { role_id, actor_type, contexts, access_rights, verification })`), contexts (`.context(name, { type, sync_pattern })`), plain edges (`.edge(from, to, { condition })`), `.sla()`, `.metadata()` and `.build()`. Roles, events, decision nodes, contracts and tools are written in the JSON document.

## The engine in Python

```python
import json
from awa import Workflow, WorkflowEngine, business_event, validate_workflow, validate_workflow_integrity

document = json.load(open("workflow.awa.json"))
assert validate_workflow(document).valid
workflow = Workflow.model_validate(document)
assert validate_workflow_integrity(workflow).valid
engine = WorkflowEngine(workflow, options={"simulate": True, "simulated_outputs": outputs})
result = engine.run({"customer_id": "C-1"})        # a dict with "status"; later run() calls continue the run
```

Options are a dict with the same names as in TypeScript (`simulate`, `simulated_outputs`, `actors`, `journal`, `journal_payloads`, `checkpoint`, `retry`, `model_providers`, `model_tiers`, `tools`, `a2a`, `decision_engines`, `knowledge`, `learn`, `telemetry`, `guardrails`, `guardrail_classifiers`, `subworkflows`, `log_execution`, `now`, `sleep`). Methods are in snake case: `start`, `run`, `run_step`, `deliver_event`, `expire_events`, `next_event_deadline`, `resume_token`, `answer_agent`, `cancel`, `check_service_levels`, `snapshot`, `get_events`, `on_event`, `result`; properties `status`, `tokens`, `run_id`. Providers: `OpenAICompatibleModelProvider`, `ollama_provider`, `FunctionModelProvider` (no Google or embedded provider). The Python SDK has no recipe, no Open Knowledge Format exchange and no views. It keeps human tasks and its execution log in `awa.db` in the working folder, or at `AWA_DATABASE_URL`.

## Run statuses and token data

Run status (5.7): `running`, `waiting_human`, `waiting_event`, `completed`, `failed`, `cancelled`; the TypeScript engine also reports `idle` before it starts and `paused`. A run with a failed token is `failed`; the other tokens are cancelled and compensation runs.

Token data (5.2): the run's input, then each activity's result merged property by property, and the properties of a result's `output` object merged too, so `score > 5` reads an agent's `{ "output": { "score": 9 } }`. Each result is also kept under `activities.<activity id>.output`, each decision under `decisions.<node id>`. An error is recorded as `_error`.

## Actors

| Actor type | Built-in actor |
|---|---|
| `ai_agent` | Calls the role's model with the description, procedure, input, contexts and knowledge; runs the tool calls the model asks for; journals its reported plan, rationale and confidence as `reasoning.recorded` |
| `human` | Creates a task and leaves the token `waiting` (`waiting_human`) until `resumeToken`, `awa task complete`, `awa journey resume` or the tasks API answers |
| `robot` | Reaches the robot configured in `robot_config` |
| `application` | Passes its input through. Register your own actor (`actors.application`) to reach real systems; it receives `context.tools` to call the activity's tools, as the examples' `scenarios/play.mjs` do |

An actor implements `execute(activity, inputs, context)` and returns an object; it writes contexts by returning them by context name. The reasoning an agent reports is a self-report, never a verified trace of how a model computed its answer.

## Models: providers, tiers, routing

Workflows name models by reference (`tier:reasoning`, `tier:balanced`, `tier:fast`, `<provider>:<model>`, `<model>`). The command line registers providers with `--providers google,openai,ollama,embedded`, in order of preference; each tier falls back down the list when a provider fails (12.5), and the route is journalled as `meta.recorded` with subject `model_route` whenever it was not the first candidate.

| Provider | Needs |
|---|---|
| `google` | `GEMINI_API_KEY` (or `--key`) |
| `openai` | `OPENAI_API_KEY` |
| `ollama` | A running Ollama server; `OLLAMA_BASE_URL` for another host. Any OpenAI-compatible server works through it |
| `embedded` | The optional package `@huggingface/transformers`: a small open-source model in the process, without network. It follows formats well and judges poorly: keep it last, pair its decisions with `min_confidence` and a default edge to a person (`docs/embedded-models.md`) |

In code, `model_tiers` maps a tier to a reference or an ordered list of references. The engine default is `default_ai_model_id`, overridden by `AWA_DEFAULT_AI_MODEL_ID`. Python reads the model behind each tier from `AWA_<PROVIDER>_MODEL_<TIER>` or `AWA_<PROVIDER>_MODEL`.

## Tools: permissions, MCP servers, gRPC

A tool call (17.3) is refused when unknown (`UNKNOWN_TOOL`) or over budget (`TOOL_BUDGET_EXCEEDED`), validated against `parameters` (`VALIDATION_ERROR`), held to the deployment's permissions (`PERMISSION_DENIED`) and the policy (`FORBIDDEN`), then recorded (`tool.invoked`, `tool.completed` or `tool.failed`, each with a `link` to what ran). A failed call is returned to the actor and does not fail the activity. In simulation no binding runs; `tools.simulated_results` scripts results.

Permissions: `command` bindings run only when allowed (`--allow-commands all` or a list of programs, `tools.allow_commands`); `tools.allowed_hosts` restricts `http`, `jsonrpc`, `grpc`, MCP over HTTP and every redirect; replies are bounded (4 MiB by default, `max_output_bytes`).

MCP servers are declared by name in `tools.mcp_servers`: a program (`command`, `args`, `env`, `cwd`, started only when commands allow it) or an address (`url`, `headers`, Streamable HTTP). The engine speaks MCP revision 2025-11-25, opens a connection at the first call of a run and closes it when the run ends or waits. gRPC (`tools.grpc`): `protos`, `include_dirs`, `reflection` (default on), `root_certificates`, `plaintext_hosts`.

## Agents over A2A

An activity or role with `a2a.agent_card` is performed by that agent over A2A 1.0 (JSON-RPC binding). The engine reads the card once per run, sends the activity and its data as a message, follows the task, and takes its artifacts as the outcome, under the contract and verification. When the agent asks for input the run waits (`waiting_human`) until the host answers (`answerAgent`, `answer_agent`, `POST /api/v1/workflows/runs/{runId}/tokens/{tokenId}/agent-input`). Agents are held to `a2a.allowed_hosts`. `awa serve --a2a workflow.awa.json` offers a workflow as an A2A agent, its card at `/a2a/{workflowId}/.well-known/agent-card.json` (and `/.well-known/agent-card.json` when one workflow is offered).

## The deployment file

`--deployment deployment.json` on `awa run`, `awa serve` and `awa task`. Four sections, and any other is refused:

```json
{
  "tools": {
    "allow_commands": ["python3"],
    "allowed_hosts": ["api.example.com"],
    "mcp_servers": { "docs": { "command": "python3", "args": ["docs_server.py"] }, "search": { "url": "https://mcp.example.com/mcp" } },
    "grpc": { "protos": ["pricing.proto"], "plaintext_hosts": ["localhost"] }
  },
  "a2a": { "allowed_hosts": ["agents.example.com"] },
  "authorization": {
    "principals": [ { "id": "agent:assessor", "kind": "ai_agent", "acts_for": { "roles": ["Refund assessor"] } } ],
    "policy": { "rules": [
      { "id": "host-starts", "effect": "allow", "actions": ["start_run"], "subject": { "ids": ["host"] } },
      { "id": "agents-work", "effect": "allow", "actions": ["perform_activity", "call_tool"], "subject": { "kinds": ["ai_agent", "application"] } } ] }
  },
  "guardrails": [ { "id": "3d1c7a52-8e44-4f0b-9a6e-5c2b1f7e9a10", "stages": ["input"], "check": { "kind": "prompt_injection" }, "action": "escalate" } ]
}
```

Relative paths of `.proto` files and certificates are read from the file's folder. Secrets are never in this file: the engine takes them in `tools.secrets`. `examples/electricity-onboarding/deployment.json` and `examples/life-insurance-savings/deployment.json` are complete deployments.

## Identity and authorization

Section 30. The policy lives in the deployment's `authorization`, never in the workflow.

- **Principals**: `id`, `kind` (`person`, `ai_agent`, `robot`, `application`, `service`), `name`, `attributes` (`roles`, `groups`, anything else), and for agents and applications `acts_for` (`activities`, `roles`, `actor_types`, `agents`) and `credentials` (headers with `{{secret:NAME}}`). People come from the authenticated request (JWT claims `sub`, `kind`, `name`, `roles`). The host acts as `{ "id": "host", "kind": "service" }` unless `host_principal` names another; a policy must allow it to start the runs journeys start.
- **Rules**: `id`, `effect` (`allow`, `deny`), `actions`, `subject` (`ids`, `kinds`, `roles`, `groups`, `attributes`), `resource` (`workflows`, `activities`, `roles`, `tools`, `agents`, `classifications`), `condition` (an expression over `principal`, `resource`, `run`, `action`, such as `run.amount < 10000`).
- **Actions**: `start_run`, `perform_activity`, `reach_agent`, `call_tool`, `claim_task`, `assign_task`, `complete_task`, `approve`, `answer_agent`, `publish_event`, `read_journal`, `cancel_run`, `migrate_run`.
- **Deciding**: deny overrides, default deny. `separation_of_duties` (`id`, `activities`, `actions`, `includes_starter`) refuses whoever performed another activity of the set in the run; `four_eyes` (`id`, `activities`, `approvals` of at least 2) needs that many distinct approvers.
- **Refusal**: `FORBIDDEN` (HTTP 403), never retried, journalled as `authorization.decided`; `record_allows: true` journals allows too. `classifications` labels workflows and activities. An external decider replaces the policy in code (`authorization.decider`).
- **Acting as someone**: `awa run --deployment d.json --as <principal id>`, `awa task complete <id> --deployment d.json --as <id>`.

## Sub-workflows

Section 24. A call activity starts a child run of `expansion_workflow_id`, with its own run id and journal, both journals linked (`subworkflow.started`, `.completed`, `.failed`, `.cancelled`; `run.started` of the child names its `parent`). The child's output goes through the activity's contract and verification. A failed child fails the activity with `SUBWORKFLOW_FAILED` and the child's code as `error.cause`; the retry policy starts a new child when the cause may pass. A workflow that is not given fails with `SUBWORKFLOW_NOT_FOUND`; calls nest 8 deep at most (`SUBWORKFLOW_DEPTH_EXCEEDED`). A child that waits makes the parent wait; deliver its events and complete its tasks to the parent's host. Cancelling the parent cancels the child. Give the workflows to call with `awa run parent.awa.json --workflows child.awa.json`, `subworkflows.workflows` in code, or by registering them with a host.

## Hosts, runtime directories and shared stores

`AwaRuntime` is the host: the one place business events enter. Methods: `register_workflow`, `register_journey` (its workflows first), `publish(event)`, `tick(now?)`, `resume(run_id, token_id, output)`, `start(workflow_id, input)`, `list_journey_instances`, `analytics(journey_id)`, `transitions()`, `export_portfolio()`, `migrate`, `check_migration`, `recover()`, `close()`. Options: `engine` (options for every run), `store`, `shared`, `pinned_versions`, `shadow`, `telemetry`, `now`.

- **Runtime directory** (19.10): `open_runtime_directory(dir)`; it holds `definitions/` (one file per workflow version), `runtime.json` and `journals/`, and a `runtime.lock` so that one host works on it at a time. `awa journey` uses `.awa` by default; `awa serve` uses `AWA_DATA_DIR`.
- **Shared PostgreSQL store** (section 29): `open_runtime_store(url)`, `--store <url>` or `AWA_RUNTIME_STORE`; several hosts take any work, each event taken exactly once. It needs the package `pg` (TypeScript) or the extra `postgres` (Python). It is not `AWA_DATABASE_URL`, which is the task database.
- A host asks the engines for deadlines and lets them pass on `tick`: a run that waits two weeks costs nothing while it waits.

## Versions and migration

Section 25. A run stays on the version it started on; new runs take the newest registered version unless the host pins one (`pinned_versions`). Register a new version with a higher `version` and the same `id`, keeping node ids for nodes that stay the same. Only a run **at rest** (every token waiting for an event, a person, an agent, a timer or a join) can move. A plan:

```json
{ "to_version": "1.1.0",
  "nodes": { "<old node id>": "<new node id>" },
  "restart": ["<old node id where waiting tokens start afresh>"],
  "data": [ { "set": "risk_band", "value": "B", "when": "amount > 1000" }, { "remove": "legacy_flag" } ] }
```

Assignments: `{ "set", "value" }`, `{ "set", "from" }`, `{ "set", "expression" }`, `{ "remove" }`, each with an optional `when`. The engine checks the whole plan first and refuses it naming every reason; an applied move is journalled as `run.migrated`. Commands: `awa migrate check <workflow_id>`, `awa migrate plan <run_id> --plan plan.json`, `awa migrate apply <run_ids...> --plan plan.json` (exit status 2 on a refusal).

## Checkpoints, recovery and idempotency

`--checkpoint-dir` (or the `checkpoint` option) saves the run after every step; `WorkflowEngine.recover` continues it in another process under the same run id, with `run.resumed` in the journal. Activities are executed at least once: an actor with side effects deduplicates with `_idempotency_key` (the same for every attempt of one visit; `_attempt` gives the attempt).

## The journal

JSON Lines, one event per line, `seq` from 1 without gaps (section 9). Each event: `spec_version`, `id`, `run_id`, `seq`, `time`, `type`, `level` (`execution`, `reasoning`, `meta`), `workflow_id`, `token_id`, `node_id`, `node_name`, `attempt`, `data`. The types to read first:

| Type | Tells |
|---|---|
| `run.started`, `run.completed`, `run.failed`, `run.cancelled`, `run.waiting`, `run.resumed`, `run.migrated` | The run's life |
| `activity.started`, `activity.completed`, `activity.failed` (`error.code`, `retryable`), `activity.retry_scheduled`, `activity.dead_lettered`, `activity.compensated` | Each attempt |
| `contract.checked` (`passed`, `violations`), `contract.escalated`, `verification.completed` (`verdict`, `criteria`) | The checks |
| `decision.evaluated` (`method`, `matched_rules`, `outputs`, `edge_id`, `used_default`, `conflict`) | Each decision |
| `token.moved`, `token.waiting`, `token.resumed`, `token.failed`, `event.waiting`, `event.received`, `event.timed_out`, `event.published`, `timer.started`, `timer.fired` | Movement and waits |
| `tool.invoked`, `tool.completed`, `tool.failed`, `agent.message_sent`, `agent.task_updated` | Calls, each with its link |
| `guardrail.triggered`, `authorization.decided`, `context.read`, `context.written`, `context.denied`, `sla.warning`, `sla.breached`, `knowledge.retrieved` | Governance |
| `reasoning.recorded`, `meta.recorded` (`model_selection`, `model_route`, `retry`, `contract_retry`, `verification_retry`, `guardrail_retry`, `escalation`) | Why |

`awa run --journal run.journal.jsonl` writes it; a host writes `journals/<run id>.journal.jsonl`; `GET /api/v1/workflows/runs/{runId}/events/stream` streams it as Server-Sent Events.

## Error codes

| Code | Cause |
|---|---|
| `NO_ROUTE` | No edge applies: conditions false and no default, or a decision without a default |
| `DECISION_CONFLICT` | Overlapping rules disagree under `unique` or `any` |
| `JOIN_DEADLOCK` | A `join: all` that can never complete |
| `CONTRACT_VIOLATION`, `VERIFICATION_FAILED` | An outcome rejected with no attempt left |
| `TIMEOUT` | An attempt over `max_duration`, or a tool over its `timeout` (retryable) |
| `EVENT_TIMEOUT`, `EVENT_PUBLISH_FAILED`, `UNSUPPORTED_EVENT` | Waits and events |
| `UNKNOWN_TOOL`, `TOOL_BUDGET_EXCEEDED`, `TOOL_ERROR` | Tool calls (returned to the actor) |
| `PERMISSION_DENIED` | The deployment lets nothing reach that host or run that program |
| `FORBIDDEN` | The policy refuses this principal this action |
| `GUARDRAIL_BLOCKED`, `GUARDRAIL_ERROR` | A guardrail stopped the value, or could not check and failed closed |
| `CONTEXT_MISSING`, `CONTEXT_ACCESS_DENIED`, `CONTEXT_INVALID`, `CONTEXT_NOT_FOUND` | Context bindings and values |
| `SLA_BREACH` | Unfinished work past `max_time` with `breach_action: fail` |
| `SUBWORKFLOW_FAILED`, `SUBWORKFLOW_NOT_FOUND`, `SUBWORKFLOW_DEPTH_EXCEEDED` | Child runs |
| `AGENT_UNSUPPORTED`, `AGENT_INPUT_REQUIRED` | Agents over A2A |
| `VALIDATION_ERROR` | Invalid arguments, an unresolvable model reference, an unregistered decision engine, a binding kind with no executor |
| `REPLAY_UNRECORDED` | A replay reached a step the recording does not hold |

## Telemetry

Section 26. Every run and journey becomes an OpenTelemetry trace whose ids derive from the run id, so both SDKs give the same trace. `awa run`, `awa journey` and `awa serve` export over OTLP/HTTP when `OTEL_EXPORTER_OTLP_ENDPOINT` is set; `AWA_TELEMETRY_PAYLOADS=true` adds inputs and outputs. `awa telemetry export <workflow> <journal> --file out.json` converts a recorded run; `awa telemetry journeys` and `awa telemetry measures` do the same for a runtime directory. Telemetry never holds up or fails a run.
