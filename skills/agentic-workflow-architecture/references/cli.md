# The awa command line

The TypeScript command, from a built clone: `node sdk/typescript/dist/cli/index.js`, `awa` after `npm link` in `sdk/typescript`, or `node scripts/awa.mjs` from this skill. `awa <command> --help` prints the options below. The full guide with every environment variable is `sdk/typescript/docs/cli-guide.md`; the HTTP interface is `sdk/typescript/docs/operational-api.md`.

## Contents

- Documents: validate, run, init, generate
- Journeys and the runtime directory
- Human tasks
- Server
- Versions
- Record: measures, evidence, dossier, recipe, replay, eval, knowledge, telemetry
- Interchange: import and export
- The Python command
- HTTP routes
- Environment variables
- Exit statuses

## Documents: validate, run, init, generate

`awa validate <files...> [--json]`: schema and integrity of workflows (`.awa.json`) and journeys. Give a journey's workflows beside it to check its references; without any workflow, the references are not checked and the command says so.

`awa run <file>` options:

| Option | Meaning |
|---|---|
| `-s, --simulate` | No model, tool or system is called |
| `--outputs <file>` | With `--simulate`: what each activity returns, by activity name |
| `-i, --input <json>` | The run's input, a JSON object |
| `-j, --journal <file>` | Write the journal to this `.jsonl` file |
| `-c, --checkpoint-dir <dir>` | Checkpoint the run after every step |
| `-p, --providers <list>` | `google`, `openai`, `ollama`, `embedded`, in order of preference |
| `-k, --key <key>` | Gemini API key (or `GEMINI_API_KEY`) |
| `--allow-commands [list]` | Let `command` tools run: `all`, or a comma-separated list of programs |
| `--deployment <file>` | What the workflow may reach (`tools`, `a2a`), who may do what (`authorization`), and the deployment's `guardrails` |
| `--as <principal>` | Start the run as this principal of the deployment (default: the host) |
| `-w, --workflows <files...>` | Workflows that call activities may run as child runs |
| `--db` | Log the execution to the task database |
| `-v, --verbose` | Step-by-step output |

A run that waits for an event ends the command at `waiting_event`; deliver events through a runtime directory (`awa journey`) or the server.

`awa init` writes a sample `workflow.awa.json` and a `.env` template in the current folder; `awa generate <prompt> [-o file] [-k key]` drafts a workflow from a description with a model (validate and review what it writes).

## Journeys and the runtime directory

Every subcommand takes `--dir <dir>` (default `.awa`) or `--store <url>` (a shared PostgreSQL store, default `$AWA_RUNTIME_STORE`). The subcommands that run work also take `-s, --simulate` and `--outputs <file>`.

| Command | Does |
|---|---|
| `awa journey add <files...>` | Registers workflows and journeys (workflows first, whatever the order given) |
| `awa journey publish <type> [-d json] [--source s] [--id id]` | Takes in a business event: wakes waiting runs, starts and moves journeys. The same `--id` twice has no further effect |
| `awa journey tick [--at <ISO 8601>]` | Lets time pass: deadlines run out, stages outstayed are marked stalled |
| `awa journey resume <run_id> <token_id> [-d json]` | Completes a task a run waits on a person for. The ids are in the `token.waiting` event of the run's journal |
| `awa journey list [--stalled]` | Journey instances, with stage, status and mood |
| `awa journey show <subject> [--json]` | A subject's record in order, by subject key or instance id; `--json` includes each run's journal |
| `awa journey analytics` | The funnel of each journey, and moves between journeys |
| `awa journey export [-o file]` | Everything recorded in one file: what the journey view and the measures page open |

## Human tasks

`awa task list [-s status] [-r role] [-a assignee]` (status `pending` by default; also `assigned`, `in_progress`, `completed`, `rejected`), `awa task show <id>`, `awa task assign <id> <user_id>`, `awa task complete <id> [json_outputs]`, `awa task reject <id> [reason]`. `assign`, `complete` and `reject` take `--deployment <file>` and `--as <principal>` to decide under a policy.

## Server

`awa serve` options: `-p, --port` (3000), `--jwt-secret` (or `JWT_SECRET`), `--api-key key:role` (repeatable), `--rate-limit <per minute>`, `--no-auth`, `--a2a <workflow file>` (repeatable; offers it as an A2A agent), `--public-url <url>` (written in agent cards), `--deployment <file>`, `--store <url>`. `AWA_DATA_DIR` gives the routes under `/api/v1/journeys`, `/api/v1/measures` and `/api/v1/evidence` a runtime directory; `AWA_SIMULATE=1` with `AWA_SIMULATED_OUTPUTS` simulates the journeys' runs. The views are served under `/views`.

## Versions

`awa migrate check <workflow_id> [--from v] [--to v] [--plan f] [--json]`, `awa migrate plan <run_id> [--plan f] [--to v] [--json]` (a dry run), `awa migrate apply <run_ids...> [--plan f] [--to v] [--json]`. All take `--dir` or `--store`. A plan is a JSON object with `to_version`, `nodes`, `restart` and `data` (`references/runtime.md`).

## Record: measures, evidence, dossier, recipe, replay, eval, knowledge, telemetry

| Command | Options |
|---|---|
| `awa measures` | `--dir`, `--file <portfolio>`, `--from`, `--to`, `--journey <id>`, `--workflow <id>`, `--json`, `--openmetrics`, `--html <file>` (one self-contained page), `--list` (the 56 measures and their rules) |
| `awa evidence <sources...>` | Sources: runtime directories, folders of journals, `.jsonl` journals, portfolios. `--from`, `--to`, `--workflow <id or name...>`, `--as-of <instant>` (the same records always give the same report), `--format json\|md\|html` (default `md`), `-o` |
| `awa dossier` | `--file <portfolio>`, `--options <file>` (the journey view's options), `--edition professional\|client`, `--customer <key or name>` (client edition), `--evidence <file>` (an evidence report in JSON), `--format html,pdf,docx` (PDF and charts in DOCX need Playwright with Chromium), `--out <path without extension>` |
| `awa recipe <workflow> [journal]` | `-o <file>`, `--no-definition`, `--no-payloads` |
| `awa replay <workflow> <journal>` | `--candidate <file>` (keep node ids), `--ai live\|recorded`, `-p, --providers`, `-k, --key`, `-o`, `--json`, `--journal-out <file>` |
| `awa eval build <journals...>` | `-o <dataset.jsonl>` |
| `awa eval run <workflow> <dataset>` | `--candidate <file>` (keep activity ids), `-p, --providers`, `-k, --key`, `-o`, `--json` |
| `awa knowledge ingest <workflow> <journal...>` | `--kb <file>` (default `knowledge.json`); safe to repeat |
| `awa knowledge list`, `review <id...\|all> --by <name>`, `deprecate <id>`, `export <dir>`, `import <dir>` | `--kb`; `export` takes `--title` and `--license` and writes an Open Knowledge Format bundle |
| `awa telemetry export <workflow> <journal>` | `--endpoint <url>` or `--file <out.json>`, `--protocol http/protobuf\|http/json`, `--header k=v`, `--service-name`, `--payloads` |
| `awa telemetry journeys`, `awa telemetry measures` | The same, with `--dir` or `--portfolio <file>`; `measures` also `--from`, `--to` |

## Interchange: import and export

| Command | Does |
|---|---|
| `awa import bpmn <file.bpmn> [--dmn <files...>] [-o file.awa.json]` | One workflow per process. Task types give actor types; `awa:actorType="ai_agent"` marks an agent's task; lanes are roles. Refused, with the element and the reason: complex gateways, transactions, terminate end events, error boundary events, loops, timers at a date, FEEL that AWA cannot express |
| `awa import dmn <file.dmn> [-o file]` | Decision tables of DMN 1.1 to 1.5 as decision nodes |
| `awa export bpmn <files...> [-o file.bpmn] [--no-diagram]` | BPMN 2.0, with decision tables as DMN beside it; importing the export gives the same workflows |
| `awa export dmn <files...> [-o file.dmn]` | DMN 1.3 |
| `awa export serverless-workflow <file> [-o file] [--format yaml\|json]` | CNCF Serverless Workflow 1.0, and the list of what does not map |

`docs/interchange.md` compares AWA with BPMN, DMN, Serverless Workflow, Arazzo and agent frameworks.

## The Python command

`pip install -e sdk/python` from a clone installs a command also named `awa`, with `validate`, `serve`, `run`, `task`, `knowledge`, `journey`, `migrate`, `measures`, `replay`, `evidence`, `eval`, `telemetry`, `import` and `export`. Differences from the TypeScript command:

- `awa validate <file>` takes one workflow file.
- `awa run --providers` takes `openai` and `ollama`; the model behind each tier comes from `AWA_<PROVIDER>_MODEL_<TIER>` or `AWA_<PROVIDER>_MODEL`.
- There is no `init`, `generate`, `recipe` or `dossier`, no `measures --html`, no `replay --ai live`, `--providers` or `--key` (a live replay is made in code), and `serve` reads `AUTH_ENABLED`, `JWT_SECRET` and `API_KEYS` from the environment instead of options.

## HTTP routes

`awa serve`, all under `/api/v1` except the agent cards and `/health`:

| Route | Does |
|---|---|
| `POST /workflows/run` | Starts a run of a workflow file under `AWA_WORKFLOWS_DIR`: `{ "filePath": "orders.awa.json", "simulate": true }` |
| `GET /workflows/runs/{runId}`, and under it `/workflow`, `/events?after=`, `/events/stream` | Status and tokens, the workflow, the journal, the journal as Server-Sent Events |
| `POST /workflows/events` | A business event for the runs waiting for one |
| `GET /workflows/runs/{runId}/agent-requests`, `POST /workflows/runs/{runId}/tokens/{tokenId}/agent-input` | Input an agent over A2A asked for |
| `POST /journeys/definitions`, `GET /journeys`, `POST /journeys/events`, `POST /journeys/tick` | Register documents, list journeys, take in an event, let time pass |
| `POST /journeys/runs/{run_id}/tokens/{token_id}/resume` | Complete a person's task |
| `GET /journeys/instances`, `/journeys/instances/{id}`, `/journeys/transitions`, `/journeys/portfolio` | Instances, one record with its runs' journals, moves between journeys, everything recorded |
| `GET /journeys/workflows/{workflow_id}/versions`, `POST /journeys/migrations/check`, `POST /journeys/runs/{run_id}/migrate[?dry_run=true]` | Versions and migration |
| `GET /measures[?format=openmetrics\|otlp]`, `GET /measures/definitions` | Measures |
| `GET /evidence?from=&to=&workflow_id=&format=` | The evidence report |
| `GET /tasks`, `/tasks/pending`, `/tasks/{id}`, `POST /tasks/{id}/assign\|complete\|reject`, `GET /tasks/queue/stats` | Human tasks |
| `GET /a2a/{workflowId}/.well-known/agent-card.json`, `POST /a2a/{workflowId}` | A workflow as an A2A agent |
| `GET /views/journey.html?live=http://localhost:3000`, `/views/dashboard.html?live=http://localhost:3000`, `GET /health` | Views following the server; health without authentication |

`spec/openapi/awa-api.yaml` is the machine-readable description.

## Environment variables

| Variable | Meaning |
|---|---|
| `GEMINI_API_KEY`, `OPENAI_API_KEY`, `OLLAMA_BASE_URL` | Model providers |
| `AWA_DEFAULT_AI_MODEL_ID` | The model used where nothing names one |
| `AWA_EMBEDDED_MODELS`, `AWA_EMBEDDED_MODEL` | Where small embedded models are kept, and which to use |
| `AWA_RUNTIME_STORE` | A shared PostgreSQL runtime store for `awa journey` and `awa serve` |
| `AWA_DATA_DIR`, `AWA_SIMULATE`, `AWA_SIMULATED_OUTPUTS`, `AWA_WORKFLOWS_DIR`, `AWA_JOURNAL_DIR` | `awa serve` |
| `AWA_DATABASE_URL` | The human task database (not the runtime store) |
| `JWT_SECRET`, `LOG_LEVEL`, `LOG_FORMAT` | Server authentication and logging |
| `OTEL_EXPORTER_OTLP_ENDPOINT`, `OTEL_EXPORTER_OTLP_HEADERS`, `OTEL_EXPORTER_OTLP_PROTOCOL`, `OTEL_SERVICE_NAME`, `OTEL_SDK_DISABLED`, `AWA_TELEMETRY_PAYLOADS` | OpenTelemetry export |

## Exit statuses

`validate`: 1 when a document is not valid. `replay` and `eval run`: 2 when there is a regression, so a set of recorded journals gates a change. `migrate plan` and `migrate apply`: 2 when a move is refused. `import`: 1 on a refusal. `scripts/awa.mjs`: 3 when it finds no AWA command.
