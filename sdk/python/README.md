# AWA Python SDK

Python SDK for Agentic Workflow Architecture (AWA).

## Installation

```bash
pip install agentic-workflow-architecture
```

The distribution is named `agentic-workflow-architecture`; the package you import, and the command, are `awa`. Do not install the unrelated PyPI project named `awa`.

Extras: `web` for `awa serve`, `grpc` for tools with `grpc` bindings (`pip install "agentic-workflow-architecture[grpc]"`), `contracts` for outcome contracts with an output schema.
For several hosts sharing one PostgreSQL store (see [Hosts that share a store](#hosts-that-share-a-store)), install the extra: `pip install "agentic-workflow-architecture[postgres]"`.

## Usage

```python
from awa import workflow

# Build a workflow
my_workflow = (
    workflow("My Workflow", "1.0.0")
    .description("A simple workflow")
    .activity("Start", {"actor_type": "application", "role_id": "system"})
    .build()
)

# Run a workflow
from awa.runtime import WorkflowEngine

engine = WorkflowEngine(my_workflow)
result = engine.run()
print(result)
```

## Features

- **Built-in VSM & Analytics**: Real-time tracking of DOWNTIME waste (Waiting, Defects) and process metrics.
- **Fluent Builder API**: Construct complex workflows with a clean Pythonic interface.
- **AI agents**: the built-in AI agent calls the model its role names through the model providers you register, runs the tools the model asks for, and journals its reasoning (see [The AI agent](#the-ai-agent)). An actor you supply replaces it.
- **REST API Support**: Optional server mode via FastAPI.

## Conformance

The Python SDK passes every case of every conformance level of the specification (`docs/specification.md`, section 2.1): `document`, `core`, `decision`, `verified`, `recorded`, `resilient`, `contract`, `routing`, `flow`, `knowledge`, `events`, `model_decision`, `tools`, `journeys`, `replay`, `measures`, `contexts`, `service_levels`, `versioning`, `telemetry`, `interchange`, `shared_store` (with the extra `postgres`), `a2a`, `evidence` and `evaluation`. No case is skipped. Run them with `pytest tests/test_conformance.py -rs`.

What it still lacks compared with the TypeScript reference implementation, none of which belongs to a conformance level:

- **The recipe** (specification 14.1, `awa recipe`) and the visual replay (14.2).
- **The Open Knowledge Format exchange** (15.5): `awa knowledge export` and `awa knowledge import`, and `export_okf` and `import_okf` in code. A knowledge base is saved and loaded as JSON, in the form the reference writes with `to_json`.
- **Model providers** for Google and for embedded models, and the reference's `TIER_PRESETS`: `TIER_PRESETS` is empty here, so a standard tier the deployment leaves unmapped is `<default provider>:default` (12.3). `OpenAICompatibleModelProvider`, `ollama_provider` and `FunctionModelProvider` are available. `awa run --providers` names the model behind each tier from the environment instead (see below).
- **Commands**: `awa init`, `awa generate` and `awa recipe`; `awa measures --html`; for `awa replay`, the options `--ai live`, `--providers` and `--key` (a live replay is made in code); and for `awa serve`, the options `--jwt-secret`, `--api-key`, `--rate-limit` and `--no-auth` (the Python server reads `AUTH_ENABLED`, `JWT_SECRET` and `API_KEYS` from the environment).
- **The views**: the dashboard and journey pages the reference server serves under `/views`, and the HTML measures page.
- **The execution logger option**: the reference engine takes an `execution_logger`; the Python engine writes the execution record to its SQLite database unless `log_execution` is `False`.

## Command line

```
awa run claim.awa.json [-s] [--outputs simulation.json] [-j run.jsonl] [-c checkpoints/] [-i '{"claim_id": "C-1"}']
                       [-p openai,ollama] [--allow-commands [all|git,jq]] [--deployment deployment.json] [--db] [-v]
awa validate claim.awa.json
awa serve [--port 3000] [--host 0.0.0.0] [--a2a claim.awa.json ...] [--public-url URL] [--deployment deployment.json]
awa task list [-s pending] [-r <role id>] [-a <assignee>]
awa task show <id> | assign <id> <user_id> | complete <id> ['{"approved": true}'] | reject <id> [reason]
awa knowledge ingest claim.awa.json run1.jsonl run2.jsonl [--kb knowledge.json]
awa knowledge list [--status draft|reviewed|deprecated] [--kb knowledge.json]
awa knowledge review <id...|all> --by <reviewer> [--kb knowledge.json]
awa knowledge deprecate <id> [--superseded-by <id>] [--kb knowledge.json]
awa telemetry export claim.awa.json run.jsonl (--endpoint http://collector:4318 | --file run.otlp.json) [--protocol http/json] [--header k=v] [--payloads]
awa telemetry journeys [--dir .awa | --portfolio journeys.json] (--endpoint <url> | --file <out.json>)
awa telemetry measures [--dir .awa | --portfolio journeys.json] [--from <instant>] [--to <instant>] (--endpoint <url> | --file <out.json>)
awa export bpmn claim.awa.json [-o claim.bpmn] [--no-diagram]     # and claim.dmn for its decision tables
awa import bpmn claim.bpmn [--dmn claim.dmn] [-o claim.awa.json]
awa import dmn rules.dmn | awa export dmn claim.awa.json
awa export serverless-workflow claim.awa.json [--format json|yaml]
```

`awa run` takes the options of the reference command, with the same meaning:

| Option | Meaning |
|---|---|
| `-s, --simulate` | Call no model, tool or person |
| `--outputs <file>` | With `--simulate`: what each activity returns, by activity name, in the format of `examples/*/simulation.json`: `output`, or `error` with an optional `code`, optional `contexts` (what the activity writes to contexts, by context name), or `attempts`, a list of those, one per execution, the last repeating |
| `-j, --journal <file>` | Write the execution journal to this file, as JSON Lines |
| `-c, --checkpoint-dir <dir>` | Save the run state to `<dir>/<run id>.checkpoint.json` after every step |
| `-i, --input <json>` | The data the run starts with, a JSON object |
| `-p, --providers <list>` | Model providers in order of preference: `openai` (reads `OPENAI_API_KEY`) and `ollama` (reads `OLLAMA_BASE_URL`, default `http://localhost:11434/v1`, which can point at any OpenAI-compatible server). `google` and `embedded` are refused: the Python SDK does not have them |
| `--allow-commands [list]` | Let tools run commands on this machine: all, or a comma-separated list of program names |
| `--deployment <file>` | What the workflow may reach: `tools.allow_commands`, `tools.allowed_hosts`, `tools.mcp_servers`, `tools.grpc` and `a2a`, in the format of the reference's [CLI guide](../typescript/docs/cli-guide.md). `--allow-commands` takes precedence over the file's `allow_commands` |
| `--db` | Write the execution record to the database (`AWA_DATABASE_URL`, default `awa.db`) instead of printing it |
| `-k, --key` | Accepted for compatibility; the Python SDK has no Google provider |

The reference maps each provider's capability tiers to its preset models. This SDK names no models, so the model behind a tier is read from `AWA_<PROVIDER>_MODEL_<TIER>` (for example `AWA_OLLAMA_MODEL_FAST`) or `AWA_<PROVIDER>_MODEL`; each tier falls back down the list of providers, and a tier none of them names is `<first provider>:default`. At the end the command prints the run's metrics (status, duration, steps, tokens and cost, at the reference's example rates), `Workflow finished with status: ...` and, with `--journal`, where the journal was written. It exits with status 1 when the run fails.

`awa task` works on the human tasks in the database named by `AWA_DATABASE_URL`. `awa knowledge` keeps the knowledge base in one JSON file, `knowledge.json` by default.

## BPMN, DMN and Serverless Workflow

Level `interchange` (specification section 27), with the same commands, defaults and results as the TypeScript SDK. Exporting a workflow to BPMN 2.0 (and its decision tables to DMN 1.3) and importing the result gives back the same document; what BPMN has no element for travels in the `awa:` namespace of `spec/xsd/awa-interchange.xsd`. An import refuses, naming the element and the reason, what AWA cannot express without changing its meaning.

```python
from awa.interchange import export_bpmn, import_bpmn, import_dmn, export_serverless_workflow

result = export_bpmn([workflow_document])          # result.bpmn, result.dmn
back = import_bpmn(result.bpmn, [result.dmn])      # back.documents == [workflow_document]
decisions, warnings = import_dmn(dmn_text)
sw = export_serverless_workflow(workflow_document)  # sw.document, sw.not_mapped
```

Only the standard library's XML is used; the reference BPMN, DMN and Serverless Workflow libraries are JavaScript, and the test suite reads this SDK's exports with them when Node and `sdk/typescript/node_modules` are present. Writing Serverless Workflow as YAML needs PyYAML; `--format json` does not.
## Telemetry

Level `telemetry` (specification section 26): every run and every journey as an OpenTelemetry trace, with the same trace and span identifiers the TypeScript reference gives for the same record. A test exports the journals of `examples/claims-settlement` and compares them with the files the reference wrote, request for request.

```python
from awa import OtlpHttpExporter, WorkflowEngine, run_spans, spans_to_otlp_json

# Live: spans leave as the journal is written, from a background thread; the run never waits for them
exporter = OtlpHttpExporter("http://collector:4318/v1/traces", protocol="http/protobuf", headers={"x-tenant": "claims"})
engine = WorkflowEngine(workflow, options={"telemetry": {"exporter": exporter, "payloads": False}})
engine.run({"claim_id": "C-1"})
exporter.flush()                       # before the process ends; exporter.stats() counts what was sent and dropped

# Recorded: the same spans from a journal, as OTLP/JSON
request = spans_to_otlp_json(run_spans(workflow, events))
```

`telemetry` may also be `{"endpoint": "http://collector:4318", "headers": {...}, "protocol": "http/json", "payloads": False}`, or any object with `export(spans)`. `AwaRuntime(telemetry=...)` and `open_runtime_directory(..., telemetry=...)` send each journey's trace as well, whose run spans link to the runs' traces. `awa run`, `awa journey` and `awa serve` read `OTEL_EXPORTER_OTLP_ENDPOINT` and the rest of that family (`telemetry_from_env`); without an endpoint nothing is sent. Inputs, outputs and tool arguments go on spans only with `payloads` (or `AWA_TELEMETRY_PAYLOADS=true`), and then only as the journal holds them. The exporter needs only the standard library; the tests decode protobuf with `opentelemetry-proto` (in the `dev` extra). `GET /api/v1/measures?format=otlp` gives the measures as OpenTelemetry gauges.

## Tools, model routing and model decisions

The levels `tools` (specification section 17), `model_decision` (section 16) and `routing` (section 12).

### Tools

An activity lists its tools in `tools`. Every call goes through one `ToolRunner`, which refuses an unknown tool and a call beyond `budgets.max_tool_calls` (16 if the activity sets none), validates the arguments against the tool's `parameters`, applies the deployment's permissions, runs the binding under the tool's `timeout`, and journals `tool.invoked` followed by `tool.completed` or `tool.failed`, each with the link to what ran. A refused or failed call is returned to the actor as a result; it does not raise.

```python
from awa.runtime import WorkflowEngine

class Lookup:
    # An actor whose execute() takes a third parameter is given the context of the attempt
    def execute(self, activity, token, context):
        found = context.tools.call("policy", {"id": token.get_data("policy_id")})
        return {"covered": found.ok and found.result["active"]}

engine = WorkflowEngine(workflow, options={
    "actors": {"application": Lookup()},
    "tools": {
        "handlers": {"policy": lambda args: {"active": True}},  # bindings of kind "function"
        "allow_commands": ["/usr/bin/jq"],                      # default: no command may run
        "allowed_hosts": ["api.example.com"],                   # default: any host
        "secrets": {"API_KEY": "..."},                          # for {{secret:API_KEY}} in headers; never journalled
    },
})
```

| Binding | Runs | Notes |
|---|---|---|
| `function` | A handler from `tools.handlers` | |
| `http` | An HTTP request, with the standard library | Only `http` and `https` URLs. Redirects are followed only to allowed hosts |
| `jsonrpc` | A JSON-RPC 2.0 call over HTTP | |
| `command` | A program, without a shell | Refused unless `allow_commands` is `True` or lists the program |
| `mcp` | A tool on a server named in `tools.mcp_servers` (17.7): `{"command", "args", "env", "cwd"}`, started and spoken to over standard input and output, or `{"url", "headers"}`, over Streamable HTTP | A server not declared there is refused. A program is held to `allow_commands`, an address to `allowed_hosts`. MCP revision 2025-11-25, standard library only |
| `grpc` | A unary call (17.8), described by `tools.grpc.protos` (with `include_dirs`) or by server reflection | The `grpc` extra. TLS unless the host is in `grpc.plaintext_hosts`; the endpoint is held to `allowed_hosts`. Arguments and results use the field names of the `.proto` file |

A deployment may still register its own executor for any kind in `tools.executors`; it replaces the built-in one. MCP connections and gRPC channels are opened at a run's first call, reused by every later call of the run, and closed when the run ends or waits.

The output of a command and the body of an HTTP response are limited to `max_output_bytes` (4 MiB by default); a longer one fails the call. A handler that is still running at the timeout cannot be interrupted in Python: the call fails with `TIMEOUT` and the handler's result is ignored. In simulation mode no binding runs: the call is journalled with `simulated: true` and returns `tools.simulated_results[<tool name>]`.

The built-in `AIAgent` calls tools when the model asks for them (see [The AI agent](#the-ai-agent)); an actor you supply calls them through `context.tools`.

### Agents over A2A

Level `a2a` (specification section 28). A role or an activity that names an agent card in `a2a` is performed by that agent over A2A 1.0 (JSON-RPC binding), whatever its actor type:

```json
{ "a2a": { "agent_card": "https://agents.example.com/.well-known/agent-card.json", "on_input_required": "wait" } }
```

The engine reads the card once per run, sends the activity and its public data as a message, follows the task with `GetTask` until it ends, and turns the artifacts into the output, which the outcome contract and verification then check as any actor's. `agent.message_sent` and `agent.task_updated` record the exchange. A task that asks for input parks the token (`waiting_human`); `engine.agent_requests()` lists what the agents ask, and `engine.answer_agent(token_id, input)` sends the answer on the same task, after which `run()` goes on. Options under `a2a`: `allowed_hosts` (default: the tools' `allowed_hosts`), `secrets`, `poll_interval_ms`, `max_wait_ms`, `transport`. In simulation nothing is called.

### Model references and routing

The engine calls a model at decision nodes that carry a `decision_model`, and its AI agent calls one for each `ai_agent` activity. A model reference is `tier:<name>`, `<provider>:<model>`, or a bare model name of the default provider. All calls go through one router: it lists the candidates of the reference, leaves out those whose provider is not registered, calls the first, falls back to the next when a provider fails, and stops when a provider rejects the request as invalid. The model that served is journalled as `meta.recorded` with subject `model_selection`, and any route other than "first candidate used" with subject `model_route`.

```python
from awa.runtime import FunctionModelProvider, OpenAICompatibleModelProvider, WorkflowEngine

engine = WorkflowEngine(workflow, options={
    "model_providers": [
        OpenAICompatibleModelProvider("gateway", "https://llm.example.com/v1", api_key="..."),
        OpenAICompatibleModelProvider("local", "http://localhost:11434/v1"),
    ],
    "default_model_provider": "gateway",          # the first registered, if absent
    "model_tiers": {"fast": ["gateway:<model name>", "local:<model name>"]},
    "default_ai_model_id": "tier:fast",           # used where a role or decision names no model; see below
})
```

Where a role or a decision names no model the engine uses `default_ai_model_id`, else `DEFAULT_AI_MODEL_ID` from `awa.runtime.model_config`: the environment variable `AWA_DEFAULT_AI_MODEL_ID`, else `default_ai_model_id` in `awa/config.json` (`gemini-3-flash-preview`, the same setting and value as the TypeScript SDK). A standard tier (`reasoning`, `balanced`, `fast`) the deployment leaves unmapped takes the entries of `TIER_PRESETS` for the providers registered, which this SDK leaves empty, and otherwise `<default provider>:default` (12.3).

A provider is any object with an `id`, a `supports_tools` flag and `generate(request) -> ModelResponse`. `FunctionModelProvider` wraps a function, for tests and deterministic stand-ins. `OpenAICompatibleModelProvider` reaches any server exposing `chat/completions` and uses only the standard library. No vendor SDK is required.

### The AI agent

The built-in `AIAgent` performs `ai_agent` activities as the reference's does. It calls the model the activity's role names in `ai_model_config.model_id`, or the engine default, through the router, with the role's `temperature` (0.2 if absent) and `max_tokens` (1024). The system message gives the role, its description and capabilities, the activity, its description, and asks for a single JSON object `{"reasoning": {"plan", "rationale", "alternatives_considered", "confidence"}, "output": ...}`. The user message gives the token's data without engine-reserved properties, any verification feedback from a rejected attempt, the knowledge handed to the activity, its controls and its verification criteria.

The reply is parsed: the first JSON object in it, split into `reasoning` and `output` when it has both; any other JSON object is the output; a reply without one is the output as text. The reasoning is journalled as `reasoning.recorded`, the model that served as `meta.recorded` with subject `model_selection` (and `model_route` after a fallback), and the token usage of every call is added up and reported in `activity.completed`.

When the activity has tools, the model is given their names, descriptions and parameters (17.3). Each call it asks for is run through the engine's `ToolRunner`, which journals it, and the result goes back to the model as a tool turn; this repeats until the model answers without asking for a tool. A run past `budgets.max_tool_calls` fails the attempt with `TOOL_BUDGET_EXCEEDED`. A model error fails the attempt with the error's code, so the retry policy applies.

In simulation no model is called, and neither is one when no model provider is registered: the agent returns a result marked `_simulated`. (The reference raises an error in the second case.)

### Model decisions

A decision node with a `decision_model` lets a model choose among the options the workflow enumerates. With `strategy: table_first` (the default when the node also has a table or an external engine) the model is asked only when no rule decides. A reply is a valid vote only if it names exactly one offered option; with `votes` above 1 the option with a strict majority of all votes decides; a confidence below `min_confidence`, or unstated when one is required, is no decision. On no decision the token takes `default_output_edge_id`, or fails with `NO_ROUTE`. `decision.evaluated` records the method, the votes and the token usage.

`model_decision_override` (a callable taking the decision node) supplies a decision without calling a model. In simulation mode no model is called; `simulated_outputs[<node name>]["output"]` scripts the decision.

External decision engines (specification 5.5.4) are registered by name in `decision_engines`: a callable, or an object with `decide(request)`, that returns `{"option": ..., "outputs": ..., "explanation": ..., "fired_rules": ...}`.

## Contexts and service levels

The levels `contexts` (specification section 22) and `service_levels` (section 23). `tests/test_contexts_service_levels.py` covers what the cases cannot reach: the time to live of a transient context, `transforms`, writes made by a person completing a task, a person's task that outlasts its service level, checkpoints, and the host's tick.

### Contexts

An activity reaches a context only through a binding. While its actor executes, the token's data holds `_contexts`: the value of each context the activity is bound to read (`read`, `read_write`, `subscribe`), by context name, and no other. An activity with no binding has no `_contexts`. An actor writes by returning `_context_writes`, an object keyed by context name; the engine applies it once the outcome is accepted, as the context's `sync_pattern` says. Neither property stays in the token's data, so contexts do not travel along edges and conditions do not see them.

```python
class Assessor:
    def execute(self, activity, token):
        order = token.get_data("_contexts")["Order"]          # bound with access_mode read
        return {"score": 7, "_context_writes": {"Findings": {"damage": "rear bumper"}}}   # bound with write

engine = WorkflowEngine(workflow, options={"actors": {"ai_agent": Assessor()}})
engine.run({"claim": 1})
engine.get_contexts()        # {"Order": {...}, "Findings": {"damage": "rear bumper"}}: every context that has a value, by name
```

A required context with no value fails the activity with `CONTEXT_MISSING` before its actor is called. A write with no binding that allows it fails with `CONTEXT_ACCESS_DENIED`, and one the context's `schema` refuses with `CONTEXT_INVALID`; the writes of one activity are applied together or not at all. None of these errors is retried. The journal records `context.read`, `context.written` and `context.denied`, with hashes, never values. A person's answer given to `resume_token` may carry `_context_writes` under the same bindings. Context values, and when each was last written, are part of a checkpoint.

`ContextManager` now holds one value per context and has the interface of the reference: `get`, `set`, `write`, `list`, `snapshot`, `restore`. Its earlier key-value methods (`read`, `read_value`, `merge`, `clear`, `check_access`) are gone; the engine never called them.

### Service levels

An activity's or a workflow's `sla` is compared with the time the work takes: when an activity's outcome is accepted, before another attempt follows an error, when the run ends, and whenever the host calls `check_service_levels()`. The engine journals `sla.warning` and `sla.breached`, each once for a visit of a token to an activity and once for a run. Work that finished late stands. With `breach_action: fail`, work that is not finished fails with `SLA_BREACH`: an activity is not tried again, and a waiting token or run fails when the host checks.

```python
engine.check_service_levels()        # {"warnings": 0, "breaches": 1, "failed": 1}; call engine.run() when failed is not zero
```

`AwaRuntime.tick()` checks the service levels of every run it hosts, on the schedule on which it lets event waits run out. What was already recorded is part of a checkpoint, so a recovered run does not record it twice.

## Knowledge

The level `knowledge` (specification 15.1 to 15.4). `tests/test_knowledge.py` fixes the contents of `counts` and `latest` and the `types`, `tags` and `max_entries` of a binding.

```python
from awa import KnowledgeBase

knowledge = KnowledgeBase.load("knowledge.json")              # empty when the file does not exist
knowledge.ingest(workflow, engine.get_events())               # counted once per run, however often it is ingested
knowledge.review("strategies/claims-assess-damage", "ana")    # only a person makes an entry reviewed
knowledge.deprecate("failure-patterns/...")                   # never given to an actor again
knowledge.save("knowledge.json")

engine = WorkflowEngine(workflow, options={"knowledge": knowledge, "learn": True})
```

`distill(workflow, events)` derives candidate entries from one journal without calling a model: a `strategy` from the reasoning reported with an accepted outcome, a `failure_pattern` from each rejected or errored attempt, a `decision_precedent` from each decision evaluation, and a `lesson` from a failed run. Each cites the journal events it came from. An activity with a `knowledge` binding is given the matching entries about it in the token's data, as `_knowledge` (`id`, `type`, `title`, `guidance`): reviewed entries first, then by observations, never a deprecated one, and a draft only when the binding sets `min_status: draft`. The engine journals `knowledge.retrieved`. With `learn`, the run's journal is ingested when the run ends.

## Counterfactual replay

The level `replay` (specification section 20). `tests/test_counterfactual.py` covers the replay of tool results, business events, timeouts, model decisions and time.

```python
from awa import counterfactual_replay, render_counterfactual_report

replay = counterfactual_replay(workflow, baseline_events, candidate=changed_workflow, ai="recorded")
replay.status                      # the status of the candidate run
replay.report["regressions"]       # a run that completed and no longer does, and every regressed node
replay.report["nodes"]             # each with a verdict: same, changed, improved, regressed, only_baseline, only_candidate
print(render_counterfactual_report(replay.report))
```

The run's input, the results of applications, robots and people, tool results (matched by tool and arguments), the business events received, timeouts and the passing of time are taken from the baseline journal. Something the baseline never did fails with `REPLAY_UNRECORDED` and is listed in `report["unrecorded"]`; nothing is invented and no tool is called. With `ai="recorded"` the outputs of AI agents and model decisions are replayed too. With `ai="live"` (the default) they run again: give the model providers the built-in AI agent and model decisions call in `engine={"model_providers": [...], "model_tiers": {...}}`, or the actor that performs the AI agents in `engine={"actors": {"ai_agent": ...}}`. A live replay with neither is refused, because without a provider the built-in agent calls no model. A journal recorded with payload mode `hash` or `none` is refused.

```
awa replay claim.awa.json run.journal.jsonl [--candidate changed.awa.json] [--json] [-o report.md] [--journal-out candidate.jsonl]
```

The command replays recorded AI outputs (`ai: "recorded"`), so it tests a changed contract, criterion, table or edge without a model. It exits with status 2 when the candidate regresses, 1 on an error, and 0 otherwise. The reference command's `--ai live`, `--providers` and `--key` options are not available: a live replay is made in code.

## Evidence, evaluation and shadow runs

The levels `evidence` (specification section 32) and `evaluation` (section 33). They follow the reference: on the claims examples both SDKs give identical reports and datasets.

```python
from awa import compute_evidence, render_evidence_markdown, build_dataset, evaluate_dataset, render_evaluation_report
from awa.runtime.evidence_sources import read_evidence_input, read_journals

record = read_evidence_input([".awa", "more-runs/"])        # runtime directories, journals, exports
report = compute_evidence(record, {"from": "2026-09-01T00:00:00Z", "workflow_ids": [...]})
print(render_evidence_markdown(report))                     # or render_evidence_html(report)

cases = build_dataset(read_journals(["runs/"]))["cases"]    # one case per visit to an AI activity
scores = evaluate_dataset(workflow, cases, candidate=changed, engine={"model_providers": [...], "model_tiers": {...}})
print(render_evaluation_report(scores))                     # pass rates per activity, regressions, improvements
```

Every statement of an evidence report cites the journal records it rests on (`run_id` and `seq`), and each part names the EU AI Act articles, NIST AI RMF functions and ISO/IEC 42001 clauses it can serve. It is evidence a deployer can use, not a certification of compliance. `unresolved_citations(report, record)` lists any citation that does not point at a record: none, for a report computed here.

A host runs a candidate beside production with `AwaRuntime(..., shadow={"candidates": {workflow_id: candidate}, "engine": {...}})`. Each production run that completes or fails is replayed under the candidate as it ends: tools, people and other actors are answered from production's record and never run, and nothing is published or learnt. `runtime.shadow.report()` gives the measures of section 21 for production and shadow and the runs where they part. Comparisons are kept in memory. Shadow runs have no conformance cases; `tests/test_evidence_evaluation.py` fixes them.

```
awa evidence <dir-or-journals...> [--from <instant>] [--to <instant>] [--workflow <id or name>...] [--as-of <instant>] [--format json|md|html] [-o file]
awa eval build <journals...> -o dataset.jsonl
awa eval run <workflow> dataset.jsonl [--candidate changed.awa.json] --providers ollama [--json] [-o report.md]
```

`awa eval run` exits with status 2 when the candidate loses a case the recording had accepted. Of the reference command's providers it offers `ollama` (any OpenAI-compatible server, from `OLLAMA_BASE_URL`); other providers are given to `evaluate_dataset` in code.

## Business events, journeys and measures

The levels `journeys` (specification section 19) and `measures` (section 21). The cases are run by `tests/test_conformance.py`; `tests/test_journeys_measures.py` covers what the cases cannot reach: recovery from files by a second host, the lock on a runtime directory, duplicate event ids, the form of an export, the command line and the HTTP routes.

### A host for journeys

`AwaRuntime` hosts runs and the journeys they belong to, and is the one place business events enter. For every event it accepts it records the event on the journeys it concerns, delivers it to the runs that wait for it, creates and moves journeys, and starts the workflows they name, in the order section 19.5 gives.

```python
from awa import AwaRuntime, business_event

runtime = AwaRuntime()
runtime.register_workflow(claim_workflow)      # a Workflow, or its document as a dict
runtime.register_journey(claim_journey)        # a journey document; its workflows must be registered first

result = runtime.publish(business_event("claim.submitted", {"customer_id": "c-1"}))
# {"accepted": True, "resumed_runs": [], "started_runs": ["..."], "journeys": ["..."]}

runtime.tick()                                  # deadlines that have passed take effect; stages outstayed are marked stalled
instance = runtime.list_journey_instances()[0]  # status, stage_id, stalled, sentiment, goals_reached, runs, events
runtime.analytics(claim_journey["id"])          # the funnel, stage by stage (19.6)
runtime.transitions()                           # how subjects move from one journey to the next (19.7)
portfolio = runtime.export_portfolio()          # everything recorded, as JSON
```

A journey instance and the events of its record are plain dicts in the form of `spec/json-schema/journey-event.schema.json`. `run_id` links a journey event to the journal of the run. `export_portfolio()` has the same form as the reference implementation's export, so `tools/visualization/journey.html` and `dashboard.html` open it.

Options: `engine` (options for every run, see `WorkflowEngine`), `now` (a clock in milliseconds, for tests) and `store`.

### A host that restarts

With a store, the host saves its state after every operation: journey instances, the state of every run, the ids of the events it has accepted, and events runs have published that it has not yet accepted. Journals are written before the state is saved. Another process registers the same definitions and calls `recover()`.

```python
from awa import AwaRuntime, FileRuntimeStore
from awa.runtime import FileJournalStore

def host():
    runtime = AwaRuntime(store=FileRuntimeStore("state/runtime.json"), engine={"journal": FileJournalStore("state/journals")})
    return runtime.register_workflow(claim_workflow).register_journey(claim_journey)

host().publish(event)          # one process
second = host()                # another, later
second.recover()               # {"instances": 1, "runs": 1, "continued": []}
```

Each run continues under its `run_id`, its journal going on at the next `seq` with `run.resumed`. An event accepted before the restart is not accepted again. `recover()` raises, and changes nothing, when a saved run names a workflow, or a saved instance a journey, that is not registered.

`open_runtime_directory(directory)` keeps everything in one directory (`definitions/`, `runtime.json`, `journals/`) and holds it with `runtime.lock`, a file naming the process. A second process is refused while the first holds the directory; a lock left by a process that no longer exists is taken over. The runtime returned is a context manager, and `close()` releases the lock. On Windows a lock that was left behind is not taken over: delete `runtime.lock` once the process is known to be gone.

```python
from awa import open_runtime_directory
from awa.runtime import add_definition

add_definition(".awa", workflow_document)
add_definition(".awa", journey_document)
with open_runtime_directory(".awa") as runtime:
    runtime.publish(event)
```

### Hosts that share a store

A runtime directory belongs to one host at a time. A **PostgreSQL store** is shared: any number of hosts, in any number of processes and machines, keep journeys and runs in one database and take any work (specification section 29). Each operation of a host (accepting an event, letting time pass, completing a task) is one transaction that holds only the subjects it touches, so work on different subjects goes on at once; an event id is recorded under a primary key in the same transaction, so no event is accepted twice; rows are written back at the version read; a host that dies releases what it held when its connection drops, and one that hangs when its lease (`lease_ms`, five minutes by default) runs out, keeping nothing of its operation. The outcome is that of one host doing everything one operation at a time.

```python
from awa import PostgresRuntimeStore, open_runtime_store

store = PostgresRuntimeStore("postgres://awa@db.internal/awa")   # creates its tables, in schema awa_runtime, the first time
store.add_definition(workflow_document)
store.add_definition(journey_document)
store.close()

with open_runtime_store("postgres://awa@db.internal/awa", engine={...}) as runtime:   # on every host
    runtime.publish(event)
    runtime.refresh()                      # to read the whole store, as other hosts left it
    runtime.list_journey_instances()
```

One store object holds one connection and its host does one operation at a time: run several hosts, in threads or processes, for more. The tables are those of `spec/ddl/awa.postgresql.sql`, section "Runtime store". The TypeScript SDK runs the same migrations and keeps the same forms: a TypeScript host and a Python host can share one store. `tests/test_shared_store.py` starts a throwaway PostgreSQL (or uses the one `AWA_TEST_POSTGRES_URL` names) and plays bursts of events and ticks across host objects and processes, a process killed mid-operation, a lease that runs out, and an event racing a new wait.

### Versions of a workflow, and runs that move between them

Level `versioning` (specification section 25). A host may have several versions of one workflow registered: a run keeps the version it started on, new runs start on the newest (or on `start(..., version=...)`, or on the version `AwaRuntime(pinned_versions={workflow_id: version})` pins). A runtime directory keeps each version in its own file (`definitions/workflow-<id>@<version>.json`), a shared store each as its own row; a host refuses to start where a run needs a version it has not registered.

A run at rest (waiting for a person, an event, an agent, a timer or a join) moves to another version only by a plan, checked whole before anything changes:

```python
plan = {
    "to_version": "2.0.0",                                   # default: the newest registered
    "nodes": {review_v1_id: automated_review_v2_id},         # a node not listed keeps its id
    "restart": [review_v1_id],                               # its wait is withdrawn; the token starts afresh there
    "data": [{"set": "currency", "value": "EUR"}, {"set": "priority", "expression": "amount > 1000"}, {"remove": "legacy_code"}],
}
runtime.migrate(run_id, plan, dry_run=True)    # what would happen: tokens, data changes, or every refusal with its code
runtime.migrate(run_id, plan)                  # applied as one change, recorded in the journal as run.migrated
runtime.check_migration(workflow_id)           # each position of the older versions: compatible, needs_mapping or impossible; each run: migratable
```

Without a host, `plan_migration(old, new, state, plan)` and `compare_versions(old, new, plan)` in `awa.runtime.migration` do the same on a run's state and two workflow models, and `as_migrated(journal)` reads a migrated journal as its migrations mapped it, which is how `counterfactual_replay` replays it. `tests/test_migration.py` covers what the conformance cases cannot reach: the files of a runtime directory, a shared store, replay, telemetry, evidence and measures of a migrated run, the command line and the HTTP routes.

### Measures

`compute_measures(record, options)` computes every measure of section 21 from an export; `MEASURES` lists them with their definitions; `measures_to_openmetrics(report)` gives the OpenMetrics text. A measure is `{"value": ..., "n": ...}`, and `value` is `None` when there is nothing to compute it from. The report validates against `spec/json-schema/measure-report.schema.json`.

```python
from awa import compute_measures, measures_to_openmetrics

report = compute_measures(runtime.export_portfolio(), {"from": "2026-01-01T00:00:00Z", "to": "2026-04-01T00:00:00Z"})
report["journeys"][0]["measures"]["journey.completion_rate"]   # {"value": 0.5, "n": 2}
print(measures_to_openmetrics(report))
```

`options` may also give `journey_id` and `workflow_id`. A test compares the report for `examples/claims-journey/journeys.json` with the reference implementation's, number by number, when Node and the built TypeScript SDK are present.

### Command line

```
awa journey add --dir .awa claim.awa.json claim.journey.json
awa journey publish --dir .awa claim.submitted -d '{"customer_id": "c-1"}' [--id evt-1] [--source /crm]
awa journey tick --dir .awa [--at 2026-06-01T00:00:00Z]
awa journey resume --dir .awa <run_id> <token_id> -d '{"approved": true}'
awa journey list --dir .awa [--stalled]
awa journey show --dir .awa <subject key or instance id> [--json]
awa journey analytics --dir .awa
awa journey export --dir .awa [-o journeys.json]
awa journey publish --store postgres://awa@db/awa claim.submitted -d '{"customer_id": "c-1"}'   # a shared store instead

awa migrate check --dir .awa <workflow_id> [--from <version>] [--to <version>] [--plan plan.json] [--json]
awa migrate plan --dir .awa <run_id> [--plan plan.json] [--to <version>] [--json]    # a dry run; exit status 2 when refused
awa migrate apply --dir .awa <run_id>... [--plan plan.json] [--to <version>]         # exit status 2 when one is refused

awa measures --dir .awa                # as text
awa measures --file journeys.json --json [--from <instant>] [--to <instant>] [--journey <id>] [--workflow <id>]
awa measures --dir .awa --openmetrics
awa measures --list
```

Every `awa journey` subcommand takes `--store <url>`, or reads `AWA_RUNTIME_STORE`, to work on a shared PostgreSQL store instead of `--dir`; `awa serve --store <url>` does the same for the HTTP routes. `AWA_DATABASE_URL` is another thing: the SQLite file of human tasks.

`publish`, `tick` and `resume` accept `-s/--simulate` with `--outputs <file>`: activities then call no model, tool or person and return what the file gives under their name. The reference command's `--html` option (the measures page as one file) is not available in this SDK.

### HTTP

`awa serve` runs workflows with the routes of the reference server and of `spec/openapi/awa-api.yaml`:

| Route | Purpose |
|---|---|
| `POST /api/v1/workflows/run` | Start a run: `filePath`, a `.json` file inside `AWA_WORKFLOWS_DIR` (default the working directory), or `workflow_data`; `input` (or `initial_data`); `simulate`. Returns `runId` and `status` |
| `POST /api/v1/workflows/events` | Deliver a business event (CloudEvents JSON with `id` and `type`) to the runs waiting for it. Returns `202` with `event_id` and `resumed_runs` |
| `GET /api/v1/workflows/runs/{run_id}` | `runId`, `workflowId`, `status` and the tokens (`id`, `node_id`, `status`) |
| `GET /api/v1/workflows/runs/{run_id}/workflow` | The workflow the run executes |
| `GET /api/v1/workflows/runs/{run_id}/events` | The journal; `?after=<seq>` for later events only |
| `GET /api/v1/workflows/runs/{run_id}/events/stream` | The journal as Server-Sent Events, from `?after=` or `Last-Event-ID`; the stream ends once the run has completed, failed or been cancelled |
| `GET /api/v1/workflows/run/{run_id}` | The route of earlier versions: status and tokens in full |
| `GET /api/v1/workflows/runs/{run_id}/agent-requests` | The tokens waiting for input an agent over A2A asked for, with what it asked |
| `POST /api/v1/workflows/runs/{run_id}/tokens/{token_id}/agent-input` | `{"input": <object or text>}`: the answer, sent on the agent's task; the run goes on in the background. `409` when the token is not waiting for an agent |

Errors of these routes are `{"code", "message"}`, as the OpenAPI description gives them. With `AWA_JOURNAL_DIR` set, each run's journal is written there.

`awa serve` also offers, behind the same authentication as the other routes:

| Route | Purpose |
|---|---|
| `POST /api/v1/journeys/definitions` | Register a workflow or a journey |
| `GET /api/v1/journeys` | Journeys with their analytics |
| `POST /api/v1/journeys/events` | Accept a business event (`type`, optionally `id`, `source`, `subject`, `data`) |
| `POST /api/v1/journeys/tick` | Let time pass (`{"at": "<instant>"}` optional) |
| `POST /api/v1/journeys/runs/{run_id}/tokens/{token_id}/resume` | Complete a human task |
| `GET /api/v1/journeys/instances`, `/instances/{id}` | Instances (`journey_id`, `subject`, `stalled`), and one with its record and journals |
| `GET /api/v1/journeys/transitions`, `/portfolio` | Movement between journeys; the full export |
| `GET /api/v1/measures` | The report (`from`, `to`, `journey_id`, `workflow_id`); `format=openmetrics` for the text format |
| `GET /api/v1/measures/definitions` | The measures and their definitions |
| `GET /api/v1/evidence` | The evidence report (`from`, `to`, `workflow_id` repeated); `format=md` or `html` for a document |

With `AWA_RUNTIME_STORE` set to a PostgreSQL URL the server keeps journeys in that shared store, which several servers use at once. Otherwise, with `AWA_DATA_DIR` set the server keeps a runtime directory there and survives a restart; without it journeys live in the process. `AWA_SIMULATE=1` and `AWA_SIMULATED_OUTPUTS=<file>` simulate activities as on the command line.

`awa serve --a2a <file>` offers a workflow to other agents over A2A 1.0, with the routes of the reference's [operational-api.md](../typescript/docs/operational-api.md): the card at `/a2a/<workflow id>/.well-known/agent-card.json` (and at `/.well-known/agent-card.json` for a single workflow), and `SendMessage`, `GetTask` and `CancelTask` at `POST /a2a/<workflow id>`. `mount_a2a(app, workflows, ...)` in `awa.server.a2a` adds them to any FastAPI application.
