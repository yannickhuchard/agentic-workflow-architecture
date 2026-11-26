# AWA conformance suite

Language-neutral test cases that define what it means to implement AWA. The rules they test are in [`docs/specification.md`](../../docs/specification.md); the case format is in its Appendix A.

| Folder | Contents |
|---|---|
| `documents/` | Documents that must be accepted or rejected, and at which validation stage |
| `execution/` | Workflows with scripted actors and the outcome an engine must produce |
| `journeys/` | Journeys with their workflows, the events a host is given step by step, and what the journeys must then record |
| `shared-store/` | Journeys played by several hosts on one store (section 29): which host takes which event, which events arrive at the same moment, when a host stops, and what the store must then hold |
| `replay/` | A recorded run, a change, and what a counterfactual replay must report |
| `versioning/` | Versions of one workflow, runs brought to rest by steps of a host, migration plans refused with their reasons or applied, versions compared, and runs continued to their end on the new version (section 25) |
| `knowledge/` | Scripted runs, the ingestion of their journals and reviews, and what the knowledge base must then hold and give to actors |
| `measures/` | A record of journeys and runs, and the measures that follow from it (section 21) |
| `interchange/` | BPMN and DMN documents and the AWA documents they import to, documents an importer must refuse, workflows that must survive a round trip through BPMN, and a Serverless Workflow export (section 27) |
| `feel.json` | FEEL unary tests and conditions, and the AWA entries and conditions they translate to and from (27.10) |
| `telemetry/` | A run's journal or a journey's record, and the OpenTelemetry trace every implementation must derive from it, identifiers included; and a measure report as gauges (section 26) |
| `evidence/` | A record of journeys and runs, and the statements an evidence report must make about it, with their exact citations, and the parts in order (section 32): guardrails, authorization decisions and principals, child runs kept with their run of depth 0, migrations |
| `evaluation/` | Journals and the evaluation dataset built from them; a dataset, a scripted candidate and the scores that follow (section 33) |
| `authorization/` | A workflow, a deployment's principals and policy, a run played step by step by named principals, and the decisions, error codes and journal entries that must follow (section 30) |
| `expressions.json` | Condition expressions, the data they are evaluated against, and their results |
| `unary-tests.json` | Decision table entries, values, and whether each value satisfies the entry |

Each execution case is tagged with a conformance level. An implementation claims a level only if it passes every case at that level, and reports the cases it skips.

Levels: `document`, `core`, `decision`, `verified`, `recorded`, `resilient`, `contract`, `routing`, `flow`, `knowledge`, `events`, `model_decision`, `tools`, `journeys`, `measures`, `contexts`, `service_levels`, `subworkflows`, `versioning`, `replay`, `telemetry`, `interchange`, `shared_store`, `a2a`, `authorization`, `guardrails`, `evidence`, `evaluation`. Cases at level `events` carry a `deliver` list: business events to deliver, or deadlines to let pass, once the run has settled. Cases at level `routing` are execution cases whose scripted `model` lists several providers and the tier map; cases at level `knowledge` are in `knowledge/`, at level `telemetry` in `telemetry/` (they need no engine, since a trace is a function of the record), at level `evidence` in `evidence/` (an evidence case's `expect` holds `summaries`, `statements` with their exact `citations`, `absent`, `cited_runs`, `part_ids`, the parts in order, and `scope_workflows`, exactly the workflows of the scope, each as a subset) and at level `evaluation` in `evaluation/`. Shadow runs (section 33.5) have no cases: they are fixed by unit tests in both SDKs.

Cases at level `a2a` (section 28) are execution cases with scripted agents. `agents` maps the URL of each agent card to the `card` and the `replies` of that agent. The runner stands in for every agent: a `GET` of a card's URL answers with the card, and each JSON-RPC request to the interface URL the card names takes the agent's next reply, the last repeating; a reply is `{"result": ...}` or `{"error": ...}`, sent as the JSON-RPC response to that request. Any other address cannot be reached. The step `{"agent_input": <object or text>}` in `deliver` gives that input to every token waiting for an agent's input. `expect.agent_card_reads` is how many times cards were read, `expect.agent_requests` the JSON-RPC methods of every request to an agent in order, and `expect.agent_requests_contain` partial requests (`agent`, `method`, `params`) some request must contain. The MCP and gRPC executors (17.7, 17.8) have no cases: each needs a live server, and the SDKs' tests start one.

Cases at level `authorization` (section 30) are in `authorization/`. Each gives the deployment's `authorization` (its `principals` and `policy`), and `steps`: `{"start": {"principal", "input"}}` starts the run as that principal (the host when none is given), and `{"complete": {"activity", "principal", "output"}}` has that principal answer the task waiting at the activity of that name. An activity of a `human` actor waits for such an answer; the other activities follow `actors` as in an execution case, with `tools` and `agents` scripted the same way. Each step's `expect` says whether it was `allowed`, and for a refusal its `code` (`FORBIDDEN`) and the decision's `reason`; the case's `expect` gives `decisions`, the data of every `authorization.decided` event in order, and `started: false` when no run may exist. The HTTP routes, credentials, external deciders and recovery have no cases: they are fixed by unit tests in both SDKs.

Cases at level `guardrails` (section 31) are execution cases, document cases that give `"level": "guardrails"`, and one replay case. An execution case may give the deployment's guardrails in `options.guardrails`, and `classifiers`: for each classifier name, the verdict (`flagged`, `categories`) it gives every time. `expect.given_inputs` is, for an activity name, a subset of the input its actor was given at its last execution (properties reserved to the engine left out); `expect.journal_excludes_text` lists strings that no journal event may contain anywhere, so that what a guardrail matched is shown to stay out of the record; `expect.guardrail_sources` is the `source` of every `guardrail.triggered`, in journal order. A guard model is scripted as `model.replies`, each reply a `text`. A runner skips a document or replay case whose `level` it does not claim, and reports it.

Cases at level `subworkflows` (section 24) are execution cases whose workflow calls the case's other `workflows` (the runner gives the engine those and the case's own workflow, so a workflow may call itself). `actors` scripts the activities of every workflow by name; a script may give `human_task: true`, which hands the activity to a person so that the token waits (with `options.wait_for_human_tasks`). In `deliver`, `{"complete_task": {"activity", "output"}}` completes the task of every token waiting for a person at that activity, in the run or in a run it called, through the run (`resumes` is how many); `{"cancel": "<reason>"}` cancels the run. In a case whose `options` set `simulate`, the runner registers no actors: activities return what `options.simulated_outputs` scripts. `expect.subworkflow_runs` lists every child run in the order they started, with fields of the run's result (24.7) and, for its own journal, `journal`, `journal_contains` and `journal_excludes`; the runner also checks that each child's journal is valid and numbered from 1, that its `run.started` names the parent and the `seq` of the parent attempt's `activity.started`, and that the parent's journal names the child. One telemetry case at this level fixes the link from a child run's trace to its parent's attempt.

Cases at level `shared_store` are in `shared-store/`. They are journey cases with `hosts`: each step names the host that performs it, `together` performs several hosts' steps at the same moment, `stop` and `start` stop and start a host, and `stops_before_keeping` stops a host in the middle of an operation, its work done and not yet kept. They need a store several hosts share: the runners start a throwaway PostgreSQL (or use the server `AWA_TEST_POSTGRES_URL` names) and report the cases skipped, with the reason, where PostgreSQL is not installed.

Cases at level `versioning` are in `versioning/`. Each gives several versions of one workflow and steps that one host performs: `register` a version, `start` or `publish` to start a run (named with `as`), `complete` a person's task, `restart` the host (with only some versions, to check that it refuses to start), `migrate` a run under a plan (or a dry run) and `check` the versions and runs. An actor scripted with `waits: true` is a person who has not answered yet. A case that gives a run's `state` instead has its plan checked against that state without a host: it is how a run in the middle of an activity is given.

## Running

```bash
cd sdk/typescript && npx vitest run tests/conformance.test.ts
```

```bash
cd sdk/python && pytest tests/test_conformance.py -rs
```

## Adding a case

Cases are generated so that identifiers stay consistent. Add the case to `generate.py`, then run:

```bash
python3 spec/conformance/generate.py
```

CI fails if the committed JSON differs from what the generator produces.

## Implementing AWA in another language

Write a runner that, for each execution case: loads `workflow`, replaces every actor with one that returns what `actors` scripts for that activity name, starts a run with `input`, and compares the result with `expect`. Around 80 lines; the two existing runners are the reference.
