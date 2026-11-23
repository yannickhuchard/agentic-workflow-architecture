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
| [`awa journey`](#awa-journey) | Journeys kept in a runtime directory: add definitions, take in events, let time pass, inspect, export |
| [`awa measures`](#awa-measures) | The measures of journeys and workflows (specification section 21) |
| [`awa replay`](#awa-replay) | Counterfactual replay of a recorded run under a changed workflow or model |
| [`awa recipe`](#awa-recipe) | A build-from-scratch recipe from a workflow and the journal of one run |
| [`awa knowledge`](#awa-knowledge) | Knowledge distilled from journals: ingest, review, exchange |
| [`awa serve`](#awa-serve) | The HTTP interface ([operational-api.md](operational-api.md)) |
| [`awa task`](#awa-task) | Human tasks kept in the task database |
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

`publish`, `tick` and `resume` take `--simulate` and `--outputs` as `awa run` does.

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

## awa replay

```bash
awa replay workflow.awa.json run.jsonl --candidate changed.awa.json --ai recorded
```

Runs a recorded run again with tools, people, applications, events and time held as recorded, and reports what changed. `--ai live` runs AI agents again under the candidate (with `--providers`, `--key`); `--ai recorded` replays their recorded outputs, to test changed contracts or rules without a model. `-o` writes the report, `--json` as JSON, `--journal-out` the candidate run's journal. The exit status is 2 when there is a regression.

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

`-p, --port`; `--jwt-secret` (or `JWT_SECRET`); `--api-key key:role`, repeatable; `--rate-limit` requests per minute; `--no-auth` for local development. The routes are in [operational-api.md](operational-api.md).

## awa task

`list`, `show <id>`, `assign <id> <user_id>`, `complete <id> [json_outputs]`, `reject <id> [reason]`. These use the task database: see "The task database" in the [SDK README](../README.md).

## Environment variables

| Variable | Read by | Meaning |
|---|---|---|
| `GEMINI_API_KEY`, `OPENAI_API_KEY`, `OLLAMA_BASE_URL` | model providers | Credentials and address of the providers |
| `AWA_DEFAULT_AI_MODEL_ID` | engine | The model used where nothing names one. Default: `default_ai_model_id` of `src/config.json` |
| `AWA_GOOGLE_REASONING_MODEL`, `AWA_GOOGLE_FAST_MODEL` | Google provider | The models of the reasoning and fast tiers. Default: from `src/config.json` |
| `AWA_EMBEDDED_MODELS`, `AWA_EMBEDDED_MODEL` | embedded provider | Where small models are kept, and which to use |
| `AWA_DATA_DIR` | `awa serve` | The runtime directory behind `/api/v1/journeys` and `/api/v1/measures`. Without it, journeys are kept in memory |
| `AWA_SIMULATE=1`, `AWA_SIMULATED_OUTPUTS` | `awa serve` | Simulate the activities of journeys' runs, with this script |
| `AWA_WORKFLOWS_DIR` | `awa serve` | The only directory `POST /api/v1/workflows/run` may read workflow files from. The working directory by default |
| `AWA_JOURNAL_DIR` | `awa serve` | Where the journals of runs started over HTTP are written |
| `AWA_DATABASE_URL` | task database | Its location, e.g. `file:/var/lib/awa/awa.db` |
| `JWT_SECRET` | `awa serve` | The secret for signed tokens |
| `LOG_LEVEL`, `LOG_FORMAT`, `LOG_TIMESTAMPS` | logging | Level, `json` or text, timestamps |

## Common errors

| Error | What to do |
|---|---|
| `NO_ROUTE` | A condition read data no activity produced. In simulation, script the activity's output |
| `CONTEXT_MISSING` | An activity is bound to read a context that has no value. Have an earlier activity write it, give it an `initial_value`, or make the binding `required: false` |
| `CONTEXT_ACCESS_DENIED` | An activity wrote to a context it has no binding to write |
| `CONTRACT_VIOLATION` | The result did not meet the activity's outcome contract. The journal's `contract.checked` event says which term |
| `SLA_BREACH` | Work still waited for passed its service level, whose breach action is `fail` |
| `PERMISSION_DENIED` | A tool's command or host is not allowed by this deployment (`--allow-commands`) |
| `The runtime directory ... is in use by process N` | Another process holds the directory. Stop it, or talk to it over HTTP |
