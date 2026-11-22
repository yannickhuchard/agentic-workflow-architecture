# AWA Python SDK

Python SDK for Agentic Workflow Architecture (AWA).

## Installation

```bash
pip install awa
```

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
- **Gemini AI Integration**: First-class support for AI agents.
- **REST API Support**: Optional server mode via FastAPI.

## Tools, model routing and model decisions

The engine passes the conformance levels `tools` (specification section 17), `model_decision` (section 16) and `routing` (section 12), in addition to `core`, `decision`, `verified`, `recorded`, `resilient`, `contract`, `flow` and `events`. Run the cases with `pytest tests/test_conformance.py -rs`.

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
| `mcp`, `grpc` | An executor from `tools.executors` | Without one the call fails with `VALIDATION_ERROR` |

The output of a command and the body of an HTTP response are limited to `max_output_bytes` (4 MiB by default); a longer one fails the call. A handler that is still running at the timeout cannot be interrupted in Python: the call fails with `TIMEOUT` and the handler's result is ignored. In simulation mode no binding runs: the call is journalled with `simulated: true` and returns `tools.simulated_results[<tool name>]`.

The built-in `AIAgent` actor does not call tools on its own; an actor you supply calls them through `context.tools`.

### Model references and routing

The engine calls a model itself at decision nodes that carry a `decision_model`. A model reference is `tier:<name>`, `<provider>:<model>`, or a bare model name of the default provider. All calls go through one router: it lists the candidates of the reference, leaves out those whose provider is not registered, calls the first, falls back to the next when a provider fails, and stops when a provider rejects the request as invalid. The model that served is journalled as `meta.recorded` with subject `model_selection`, and any route other than "first candidate used" with subject `model_route`.

```python
from awa.runtime import FunctionModelProvider, OpenAICompatibleModelProvider, WorkflowEngine

engine = WorkflowEngine(workflow, options={
    "model_providers": [
        OpenAICompatibleModelProvider("gateway", "https://llm.example.com/v1", api_key="..."),
        OpenAICompatibleModelProvider("local", "http://localhost:11434/v1"),
    ],
    "default_model_provider": "gateway",          # the first registered, if absent
    "model_tiers": {"fast": ["gateway:<model name>", "local:<model name>"]},
    "default_ai_model_id": "tier:fast",           # used where a decision names no model; "tier:balanced" if absent
})
```

A provider is any object with an `id`, a `supports_tools` flag and `generate(request) -> ModelResponse`. `FunctionModelProvider` wraps a function, for tests and deterministic stand-ins. `OpenAICompatibleModelProvider` reaches any server exposing `chat/completions` and uses only the standard library. No vendor SDK is required.

### Model decisions

A decision node with a `decision_model` lets a model choose among the options the workflow enumerates. With `strategy: table_first` (the default when the node also has a table or an external engine) the model is asked only when no rule decides. A reply is a valid vote only if it names exactly one offered option; with `votes` above 1 the option with a strict majority of all votes decides; a confidence below `min_confidence`, or unstated when one is required, is no decision. On no decision the token takes `default_output_edge_id`, or fails with `NO_ROUTE`. `decision.evaluated` records the method, the votes and the token usage.

`model_decision_override` (a callable taking the decision node) supplies a decision without calling a model. In simulation mode no model is called; `simulated_outputs[<node name>]["output"]` scripts the decision.

External decision engines (specification 5.5.4) are registered by name in `decision_engines`: a callable, or an object with `decide(request)`, that returns `{"option": ..., "outputs": ..., "explanation": ..., "fired_rules": ...}`.

## Business events, journeys and measures

The SDK also passes the conformance levels `journeys` (specification section 19) and `measures` (section 21). The cases are run by `tests/test_conformance.py`; `tests/test_journeys_measures.py` covers what the cases cannot reach: recovery from files by a second host, the lock on a runtime directory, duplicate event ids, the form of an export, the command line and the HTTP routes.

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

awa measures --dir .awa                # as text
awa measures --file journeys.json --json [--from <instant>] [--to <instant>] [--journey <id>] [--workflow <id>]
awa measures --dir .awa --openmetrics
awa measures --list
```

`publish`, `tick` and `resume` accept `-s/--simulate` with `--outputs <file>`: activities then call no model, tool or person and return what the file gives under their name. The reference command's `--html` option (the measures page as one file) is not available in this SDK.

### HTTP

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

With `AWA_DATA_DIR` set the server keeps a runtime directory there and survives a restart; without it journeys live in the process. `AWA_SIMULATE=1` and `AWA_SIMULATED_OUTPUTS=<file>` simulate activities as on the command line.
