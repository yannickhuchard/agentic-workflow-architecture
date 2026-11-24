# The `awa` command

Reference for the command line of the TypeScript SDK 2.0 (AWA specification 1.1). Every command also answers `--help`.

```bash
npm install agentic-workflow-architecture
```

The command is then `npx awa`, or `awa` after `npm install -g agentic-workflow-architecture`. Node 20 or later.

| Command | What it does |
|---|---|
| [`awa run`](#awa-run) | Run a workflow file, keeping its journal and checkpoints |
| [`awa validate`](#awa-validate) | Check workflow and journey documents before running them |
| [`awa journey`](#awa-journey) | Journeys kept in a runtime directory or a shared PostgreSQL store: add definitions, take in events, let time pass, inspect, export |
| [`awa measures`](#awa-measures) | The measures of journeys and workflows (specification section 21) |
| [`awa telemetry`](#awa-telemetry) | Runs, journeys and measures as OpenTelemetry traces and metrics (specification section 26) |
| [`awa replay`](#awa-replay) | Counterfactual replay of a recorded run under a changed workflow or model |
| [`awa evidence`](#awa-evidence) | An evidence report computed from journals and journey records (specification section 32) |
| [`awa eval`](#awa-eval) | Evaluation datasets built from journals, and a candidate scored against them (section 33) |
| [`awa recipe`](#awa-recipe) | A build-from-scratch recipe from a workflow and the journal of one run |
| [`awa knowledge`](#awa-knowledge) | Knowledge distilled from journals: ingest, review, exchange |
| [`awa serve`](#awa-serve) | The HTTP interface ([operational-api.md](operational-api.md)) |
| [`awa task`](#awa-task) | Human tasks kept in the task database |
| [`awa import`, `awa export`](#awa-import-and-awa-export) | BPMN 2.0 and DMN in and out without loss; CNCF Serverless Workflow out (specification section 27) |
| `awa init`, `awa generate` | A sample project; a workflow drafted from a sentence by a model |

## awa run

```bash
awa run workflow.awa.json --simulate --outputs simulation.json --journal run.jsonl
```

| Option | Meaning |
|---|---|
| `-s, --simulate` | Call no model, tool or person. Activities return what `--outputs` scripts, and nothing otherwise |
| `--outputs <file>` | With `--simulate`: what each activity returns, by activity name (see below) |
| `-j, --journal <file>` | Write the execution journal to this JSON Lines file |
| `-c, --checkpoint-dir <dir>` | Checkpoint the run after every step, so that it can be recovered in another process |
| `-i, --input <json>` | The run's initial data, as a JSON object |
| `-p, --providers <list>` | Model providers in order of preference: `google`, `openai`, `ollama`, `embedded`. Each capability tier falls back down the list |
| `-k, --key <key>` | Gemini API key (or `GEMINI_API_KEY`) |
| `--allow-commands [list]` | Let tools run commands on this machine: all, or a comma-separated list of program names. None by default |
| `--deployment <file>` | What the workflow may reach: the commands, hosts, MCP servers and gRPC services of its tools, and the hosts of its agents; and the guardrails the deployment adds to every run (see below). `--allow-commands` takes precedence over the file's `allow_commands` |
| `--db` | Also log the run's cost and duration to the task database |
| `-v, --verbose` | Print each step |

A simulation script names what each activity returns. An entry may give `output`, an `error` (with a `code`), `attempts` (one entry per attempt, the last repeating), and `contexts`, what the activity writes to the workflow's contexts:

```json
{
  "Receive order": { "output": { "order_id": "ORD-1" }, "contexts": { "Order": { "total": 240 } } },
  "Charge card":   { "attempts": [{ "error": "gateway timeout", "code": "TIMEOUT" }, { "output": { "charged": true } }] }
}
```

A simulated activity that is not scripted returns no business data, so a condition that reads data takes no edge and the run fails with `NO_ROUTE`: script the activities whose results drive the route. An activity bound to read a context nothing has written fails with `CONTEXT_MISSING`: script the activity that writes it, or give the context an `initial_value`.

A deployment file says what a workflow may reach (specification 17.4, 17.7, 17.8, 28.2). A workflow document can name any address, program or agent; only what this file allows runs:

```json
{
  "tools": {
    "allow_commands": ["python3"],
    "allowed_hosts": ["api.example.com", "mcp.example.com", "pricing.example.com:443", "agents.example.com"],
    "mcp_servers": {
      "docs":   { "command": "python3", "args": ["docs_server.py"] },
      "search": { "url": "https://mcp.example.com/mcp" }
    },
    "grpc": { "protos": ["pricing.proto"], "include_dirs": ["protos"], "plaintext_hosts": [] }
  },
  "a2a": { "poll_interval_ms": 1000, "max_wait_ms": 600000 },
  "guardrails": [
    { "id": "0b6f5a52-3c2e-4d7b-9a51-6d0f8f1c2e10", "name": "Organisation: personal data",
      "stages": ["output", "tool_call"], "check": { "kind": "personal_data" }, "action": "redact" }
  ]
}
```

An `mcp` binding names a server declared under `mcp_servers`: a program, started only when `allow_commands` allows it, or a Streamable HTTP address, held to `allowed_hosts`. A `grpc` binding is described by `grpc.protos`, or by the server's reflection service, and uses TLS unless its host is in `plaintext_hosts`; gRPC needs `npm install @grpc/grpc-js @grpc/proto-loader`. An activity whose role or itself has an `a2a` binding is performed by that agent; agents are held to `a2a.allowed_hosts`, or to the tools' `allowed_hosts` when that is absent. Paths are taken from the file's directory. Secrets are not read from this file.

`guardrails` are the deployment's guardrails (specification 31.1): they apply to every run, before the document's, and a document cannot remove them. They are written as a document's are, and a file whose guardrails are inconsistent (an action a stage does not allow, `redact` with a check that gives no positions, a pattern that does not compile) is refused when it is read. A guardrail that finds something is journalled as `guardrail.triggered`, with where and what it found and never the text.

| Provider | Needs |
|---|---|
| `google` | `GEMINI_API_KEY` |
| `openai` | `OPENAI_API_KEY` |
| `ollama` | A running Ollama; `OLLAMA_BASE_URL` if not on localhost |
| `embedded` | `npm install @huggingface/transformers`; `AWA_EMBEDDED_MODELS`, `AWA_EMBEDDED_MODEL` to choose where models are kept and which |

## awa validate

```bash
awa validate claim.journey.json intake.awa.json settlement.awa.json
```

Checks each workflow against the schema and the rules the engine applies before a run (edges and decisions that point to nothing, expressions and durations that cannot be read, and the like), and each journey against the journey schema. A journey's references to workflows are checked against the workflows given beside it. `--json` prints the result as JSON. The exit status is 1 when any document is not valid.

## awa journey

Journeys live in a **runtime directory** (`.awa` by default, `--dir` to choose another): their definitions, the state of every journey and run, and the journals. Each command is a separate process; the directory is held by one at a time.

Or they live in a **shared store**: a PostgreSQL database named by `--store <url>` or the variable `AWA_RUNTIME_STORE`, which any number of commands and servers, on any number of machines, use at once (specification section 29). Each operation holds only the subjects it touches; no event is taken twice. It needs the optional package `pg` (`npm install pg`); the store creates its tables, in schema `awa_runtime`, the first time.

```bash
export AWA_RUNTIME_STORE=postgres://awa@db.internal/awa
awa journey add intake.awa.json claim.journey.json
awa journey publish claim.submitted -d '{"customer_id":"c-1"}'
```

```bash
awa journey add intake.awa.json claim.journey.json
```

```bash
awa journey publish claim.submitted -d '{"customer_id":"c-1"}' --simulate --outputs simulation.json
```

```bash
awa journey tick
```

```bash
awa journey list --stalled
```

| Subcommand | What it does |
|---|---|
| `add <files...>` | Add workflows and journeys. A journey's workflows must be added first, or in the same call |
| `publish <type>` | Take in a business event (`-d` its data, `--id` to make it idempotent, `--source`): it wakes waiting runs, starts journeys and moves them on |
| `tick` | Let time pass (`--at` an instant): deadlines that ran out take effect, stalled journeys are marked, service levels of waiting work are checked |
| `resume <run_id> <token_id>` | Complete a task a run waits on a person for (`-d` what they decided) |
| `list` | Journey instances (`--stalled` for those that need someone) |
| `show <subject>` | A subject's journeys, in order (`--json` for the full record) |
| `analytics` | The funnel of each journey, and how subjects move between journeys |
| `export` | Everything recorded, in one file (`-o`): what the journey view and the measures page open |

`publish`, `tick` and `resume` take `--simulate` and `--outputs` as `awa run` does. Every subcommand takes `--store <url>`; with it, or with `AWA_RUNTIME_STORE` set, `--dir` is not used.

## awa measures

```bash
awa measures --dir .awa
```

| Option | Meaning |
|---|---|
| `--file <file>` | Read an export written by `awa journey export` instead of a runtime directory |
| `--from <instant>`, `--to <instant>` | Keep what started in this period |
| `--journey <id>`, `--workflow <id>` | Only this journey, or this workflow |
| `--json` | The report as JSON (`spec/json-schema/measure-report.schema.json`) |
| `--openmetrics` | The measures in the OpenMetrics text format |
| `--html <file>` | The measures page as one file with the record inside it |
| `--list` | Every measure with its rule |

## awa telemetry

```bash
awa telemetry export claims-settlement.awa.json run.jsonl --endpoint http://localhost:4318
```

| Subcommand | What it sends |
|---|---|
| `export <workflow> <journal>` | Each run of the workflow in the journal, as a trace (26.2). A run still waiting is sent with its open spans ended at its last event and marked `awa.incomplete` (26.8) |
| `journeys` | Every journey instance as a trace whose run spans link to the runs' traces, and every run done for one (26.7). From `--dir` (default `.awa`) or `--portfolio <file>` written by `awa journey export` |
| `measures` | The measure report as OpenTelemetry gauges (26.12), with `--from` and `--to` as for `awa measures` |

| Option | Meaning |
|---|---|
| `--endpoint <url>` | Send OTLP over HTTP. `/v1/traces` or `/v1/metrics` is appended unless the path already ends with it. Without `--endpoint` or `--file`, the `OTEL_EXPORTER_OTLP_*` variables say where |
| `--file <out.json>` | Write the OTLP/JSON request to this file instead |
| `--protocol <protocol>` | `http/protobuf` (default) or `http/json` |
| `--header <key=value>` | A request header, e.g. an API key of the backend; repeatable |
| `--service-name <name>` | `service.name` of the resource; `awa` by default |
| `--payloads` | Put inputs, outputs, decision inputs and tool arguments and results on spans, as the journal holds them (26.6) |

Identifiers come from the run id, so exporting a journal again gives the spans a live exporter sent, with the same ids: a backend can tell what it already has. The command exits with status 1 when a span could not be sent.

`awa run` and `awa journey` send the spans of their runs and journeys as they happen when `OTEL_EXPORTER_OTLP_ENDPOINT` (or `OTEL_EXPORTER_OTLP_TRACES_ENDPOINT`) is set, and `awa serve` does so for every run and journey it hosts. Telemetry never holds up or fails a run: spans are sent in the background, and what cannot be sent is dropped, counted and reported once a minute.

## awa replay

```bash
awa replay workflow.awa.json run.jsonl --candidate changed.awa.json --ai recorded
```

Runs a recorded run again with tools, people, applications, events and time held as recorded, and reports what changed. `--ai live` runs AI agents again under the candidate (with `--providers`, `--key`); `--ai recorded` replays their recorded outputs, to test changed contracts or rules without a model. `-o` writes the report, `--json` as JSON, `--journal-out` the candidate run's journal. The exit status is 2 when there is a regression.

## awa evidence

```bash
awa evidence .awa --from 2026-09-01 --to 2026-10-01 --format html -o evidence.html
```

An evidence report (specification section 32): what ran, which models decided what, every human decision, override and escalation, every contract and verification result, refusals, failures, compensations, service level breaches, tool calls by target, data by payload mode, and the records themselves. Every statement cites the journal records it rests on, and each part names the articles of the EU AI Act, and the functions of the NIST AI RMF and clauses of ISO/IEC 42001, it can serve as evidence for. It is evidence a deployer can use, not a certification of compliance, and says so.

The sources are any mix of runtime directories, directories of journals, journal files (`.jsonl`) and exports written by `awa journey export`. A runtime directory is read as files: no lock is taken and no run is continued, so a report can be made while a host runs.

| Option | Meaning |
|---|---|
| `--from <instant>`, `--to <instant>` | Keep runs and journeys started in this period |
| `--workflow <id or name...>` | Keep only runs of these workflows |
| `--as-of <instant>` | The instant the report is made as of, so that it can be made again identically |
| `--format json\|md\|html` | JSON (`spec/json-schema/evidence-report.schema.json`), Markdown (the default), or one HTML page |
| `-o <file>` | Write the report to this file |

## awa eval

```bash
awa eval build runs/*.jsonl -o dataset.jsonl
awa eval run claims.awa.json dataset.jsonl --candidate changed.awa.json --providers ollama
```

`build` turns every ended visit to an AI activity into a case: the input the agent was given, and the outcome accepted by its contract, by verification or by a person, or what rejected it (`spec/json-schema/evaluation-case.schema.json`). Visits whose payloads were journalled as hashes are left out and listed.

`run` performs each case again under the candidate through counterfactual replay: the agent runs under `--providers` (google, openai, ollama, embedded) or `--key`; the tools it calls answer as recorded, and a call with other arguments is not performed. It reports, per activity, the share accepted when recorded and now, the contract and verification pass rates, and the regressions and improvements. `--candidate` evaluates a changed workflow (keep activity ids), `--json` writes the report as JSON, `-o` to a file. The exit status is 2 when the candidate loses a case the recording had accepted.

## awa recipe

```bash
awa recipe workflow.awa.json run.jsonl -o RECIPE.md
```

A Markdown recipe that explains how to rebuild the workflow from scratch, from its definition and, if given, the journal of one run. `--no-definition` leaves out the full definition, `--no-payloads` the inputs and outputs.

## awa knowledge

| Subcommand | What it does |
|---|---|
| `ingest <workflow> <journal...>` | Distil runs into strategies, failure patterns, lessons and precedents. A run is counted once |
| `list` | The entries |
| `review <id...>` | Mark entries reviewed by a person. Only reviewed entries are given to actors by default |
| `deprecate <id>` | Mark an entry as no longer current |
| `export <directory>`, `import <directory>` | Exchange the knowledge base as an Open Knowledge Format bundle |

## awa serve

```bash
AWA_DATA_DIR=.awa awa serve --port 3000 --no-auth
```

`-p, --port`; `--jwt-secret` (or `JWT_SECRET`); `--api-key key:role`, repeatable; `--rate-limit` requests per minute; `--no-auth` for local development; `--store <url>` (or `AWA_RUNTIME_STORE`) to keep journeys in a PostgreSQL store that several servers share. The routes are in [operational-api.md](operational-api.md).

```bash
awa serve --port 3000 --store postgres://awa@db.internal/awa      # the same command on every machine
```

`--a2a <file>`, repeatable, offers a workflow to other agents over A2A 1.0 (specification 28.8): its agent card is at `/a2a/<workflow id>/.well-known/agent-card.json`, and at `/.well-known/agent-card.json` when one workflow is offered. `--public-url <url>` is the address written in the cards, when callers reach the server at another one than the request shows. `--deployment <file>` says what those runs may reach, as for `awa run`.

```bash
awa serve --port 3000 --a2a examples/claims-settlement/claims-settlement.awa.json --deployment deployment.json
```

## awa task

`list`, `show <id>`, `assign <id> <user_id>`, `complete <id> [json_outputs]`, `reject <id> [reason]`. These use the task database: see "The task database" in the [SDK README](../README.md).

## awa import and awa export

Interchange with the formats organisations already use (specification section 27). The commands read and write with `bpmn-moddle`, `dmn-moddle` and `@serverlessworkflow/sdk`, optional dependencies of the package: `npm install bpmn-moddle dmn-moddle @serverlessworkflow/sdk` where you use them. A command that misses one says which.

| Command | What it does |
|---|---|
| `awa export bpmn <workflow...> [-o file.bpmn] [--no-diagram]` | One BPMN 2.0 document with a process per workflow, and a diagram modelling tools can draw. Decision tables go to a DMN 1.3 document of the same name. What BPMN cannot say is kept in the `awa:` namespace, so importing the export gives the same workflows: the command checks that it does |
| `awa import bpmn <file.bpmn> [--dmn <file.dmn...>] [-o file.awa.json]` | One AWA workflow per process, the first to the output (default `<file>.awa.json`), the others and the workflows of embedded subprocesses beside it as `<output>.<name>.awa.json`. Without `--dmn`, a `<file>.dmn` beside the BPMN file is read |
| `awa import dmn <file.dmn> [-o file.json]` | The decision tables of a DMN 1.1 to 1.5 document as AWA decision nodes (default `<file>.decisions.json`) |
| `awa export dmn <workflow...> [-o file.dmn]` | The decision tables of the workflows as DMN 1.3 |
| `awa export serverless-workflow <workflow> [-o file] [--format yaml\|json]` | A CNCF Serverless Workflow 1.0 document (default `<file>.sw.yaml`), validated with the Serverless Workflow SDK, and the list of what does not map |

What an import cannot carry without changing meaning is refused, naming the element and the reason (section 27.8: complex gateways, transactions, terminate end events, error boundary events, loops, timers at a date, FEEL that AWA's languages cannot express, and others); what it leaves out without changing behaviour is printed as a note. The exit status is 1 on a refusal. The comparison of AWA with these formats and with agent frameworks is in [`docs/interchange.md`](../../../docs/interchange.md).

## Environment variables

| Variable | Read by | Meaning |
|---|---|---|
| `GEMINI_API_KEY`, `OPENAI_API_KEY`, `OLLAMA_BASE_URL` | model providers | Credentials and address of the providers |
| `AWA_DEFAULT_AI_MODEL_ID` | engine | The model used where nothing names one. Default: `default_ai_model_id` of `src/config.json` |
| `AWA_GOOGLE_REASONING_MODEL`, `AWA_GOOGLE_FAST_MODEL` | Google provider | The models of the reasoning and fast tiers. Default: from `src/config.json` |
| `AWA_EMBEDDED_MODELS`, `AWA_EMBEDDED_MODEL` | embedded provider | Where small models are kept, and which to use |
| `AWA_RUNTIME_STORE` | `awa journey`, `awa serve` | A PostgreSQL URL: journeys, runs and journals are kept in that shared store (section 29), which several hosts use at once. Takes precedence over `--dir` and `AWA_DATA_DIR` |
| `AWA_DATA_DIR` | `awa serve` | The runtime directory behind `/api/v1/journeys`, `/api/v1/measures` and `/api/v1/evidence`. Without it, journeys are kept in memory |
| `AWA_SIMULATE=1`, `AWA_SIMULATED_OUTPUTS` | `awa serve` | Simulate the activities of journeys' runs, with this script |
| `AWA_WORKFLOWS_DIR` | `awa serve` | The only directory `POST /api/v1/workflows/run` may read workflow files from. The working directory by default |
| `AWA_JOURNAL_DIR` | `awa serve` | Where the journals of runs started over HTTP are written |
| `AWA_DATABASE_URL` | task database | Its location, e.g. `file:/var/lib/awa/awa.db`. Not the runtime store |
| `JWT_SECRET` | `awa serve` | The secret for signed tokens |
| `LOG_LEVEL`, `LOG_FORMAT`, `LOG_TIMESTAMPS` | logging | Level, `json` or text, timestamps |
| `OTEL_EXPORTER_OTLP_ENDPOINT`, `OTEL_EXPORTER_OTLP_TRACES_ENDPOINT` | `awa run`, `awa journey`, `awa serve`, `awa telemetry` | Where spans are sent over OTLP/HTTP: the first with `/v1/traces` appended, the second as given. Without either, nothing is sent |
| `OTEL_EXPORTER_OTLP_HEADERS`, `OTEL_EXPORTER_OTLP_TRACES_HEADERS` | the same | Request headers, `key=value` pairs separated by commas, values percent-encoded |
| `OTEL_EXPORTER_OTLP_PROTOCOL`, `OTEL_EXPORTER_OTLP_TRACES_PROTOCOL` | the same | `http/protobuf` (default) or `http/json`. `grpc` is refused with a warning, and nothing is sent |
| `OTEL_EXPORTER_OTLP_TIMEOUT`, `OTEL_EXPORTER_OTLP_COMPRESSION` (and their `_TRACES_` forms) | the same | Export timeout in milliseconds (10000); `gzip` or `none` |
| `OTEL_SERVICE_NAME`, `OTEL_RESOURCE_ATTRIBUTES` | the same | The resource spans are sent with; `service.name` is `awa` by default |
| `OTEL_SDK_DISABLED=true`, `OTEL_TRACES_EXPORTER=none` | the same | No telemetry |
| `OTEL_BSP_SCHEDULE_DELAY`, `OTEL_BSP_MAX_QUEUE_SIZE`, `OTEL_BSP_MAX_EXPORT_BATCH_SIZE` | the same | Batching: delay in milliseconds (1000), queue (2048 spans), batch (512 spans) |
| `AWA_TELEMETRY_PAYLOADS=true` | the same | Opt in to inputs, outputs and tool arguments on spans (specification 26.6) |

## Common errors

| Error | What to do |
|---|---|
| `NO_ROUTE` | A condition read data no activity produced. In simulation, script the activity's output |
| `CONTEXT_MISSING` | An activity is bound to read a context that has no value. Have an earlier activity write it, give it an `initial_value`, or make the binding `required: false` |
| `CONTEXT_ACCESS_DENIED` | An activity wrote to a context it has no binding to write |
| `CONTRACT_VIOLATION` | The result did not meet the activity's outcome contract. The journal's `contract.checked` event says which term |
| `SLA_BREACH` | Work still waited for passed its service level, whose breach action is `fail` |
| `PERMISSION_DENIED` | A tool's command, host or MCP server, or an agent's host, is not allowed by this deployment (`--allow-commands`, `--deployment`) |
| `AGENT_FAILED`, `AGENT_REJECTED`, `AGENT_ERROR`, `AGENT_UNSUPPORTED` | An agent reached over A2A failed or refused the task, could not be reached, or offers no JSON-RPC interface of A2A 1.0. The journal's `agent.task_updated` event has its reply |
| `The runtime directory ... is in use by process N` | Another process holds the directory. Stop it, talk to it over HTTP, or move to a shared store (`--store`) |
| `The PostgreSQL runtime store needs the "pg" package` | `npm install pg` |
