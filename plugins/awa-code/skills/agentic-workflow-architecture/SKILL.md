---
name: agentic-workflow-architecture
description: Writes, validates, simulates and explains Agentic Workflow Architecture (AWA) documents, the .awa.json workflows in which AI agents, people, robots and applications work together and the .journey.json customer journeys. Use when a user writes or edits an AWA workflow or journey, validates one, or runs it with the AWA TypeScript or Python SDK or the awa command line; adds outcome contracts, verification, decision tables, model decisions, business events and waits, tools (HTTP, MCP, gRPC), agents over A2A, guardrails, an authorization policy or sub-workflows; versions a workflow and migrates runs in flight; reads a run's journal, replays it counterfactually or builds an evaluation; computes measures; opens the journey view, the measures page or the run replay, with a brand or a glossary; reads recommendations; makes a dossier or an evidence report for the EU AI Act; imports or exports BPMN, DMN or Serverless Workflow; or checks conformance to the AWA specification.
license: Apache-2.0
compatibility: Writing documents needs nothing. Validating, simulating and running them needs Node.js 20 or later and a clone of the AWA repository with its TypeScript SDK built, or Python 3.10 or later for the Python SDK.
metadata:
  version: "2.0.0"
  awa-specification: "1.1"
  repository: https://github.com/yannickhuchard/agentic-workflow-architecture
  homepage: https://github.com/yannickhuchard/agentic-workflow-architecture#readme
---

# Agentic Workflow Architecture (AWA)

## What AWA is

AWA is an open specification (version 1.1) for business processes in which AI agents, people, robots and applications work together.
A **workflow** (`.awa.json`) is a JSON graph of activities, events and decision nodes joined by edges; each activity names its actor type, its role, and what must be true of its result.
A **journey** (`.journey.json`) follows one customer or order through stages over days or months, driven by business events, and names the workflows that serve each stage.
The engine runs workflows, records every step in an append-only **journal**, and derives replays, measures, telemetry, knowledge and evidence reports from it.
The principle is **fixed outcome, free strategy**: the workflow fixes the outcome contract, the agent chooses how to meet it, and the engine accepts only what passes the checks.

Paths such as `docs/specification.md` are in the AWA repository, https://github.com/yannickhuchard/agentic-workflow-architecture. Paths that start with `references/`, `assets/` or `scripts/` are in this skill's folder.

## Get the AWA tools

This skill describes version 2 of the SDKs, which implements specification 1.1; versions 1.x implement specification 1.0 and lack most of what follows (`awa --version` tells). Use the tools from a clone of the repository, and build the TypeScript SDK once:

```bash
git clone https://github.com/yannickhuchard/agentic-workflow-architecture
cd agentic-workflow-architecture/sdk/typescript && npm ci && npm run build
```

Then call the command line as `node sdk/typescript/dist/cli/index.js <command>` from the clone, or put `awa` on the PATH with `npm link` in `sdk/typescript`. From anywhere, `node scripts/awa.mjs <command>` (in this skill's folder) finds a built clone (the variable `AWA_REPOSITORY`, the folders above the current one, or the folders above the script) or the package `agentic-workflow-architecture` in a `node_modules` folder, at version 2 or later, and runs its `awa` command; `node scripts/awa.mjs --where` says which one it found. It exits with status 3 and prints the build steps when it finds none.

The Python SDK installs from the same clone with `pip install -e sdk/python` (extras: `web` for `awa serve`, `grpc`, `postgres`, `contracts`). The package you import and its command are both named `awa`, like the TypeScript command, so keep the two in separate environments.

The AWA MCP server (`apps/mcp-server`) and the plugin `plugins/awa-code` give assistants eight tools that validate, show and simulate documents: see "Views and the MCP server" below.

## Decide what to do

| The user wants to | Do this | Read |
|---|---|---|
| Write a new workflow | Copy `assets/refund-request.awa.json`, replace names, ids and logic, validate | "A minimal workflow" below, `references/document-model.md` |
| Write a journey | Copy `assets/refund-request.journey.json`, point its stages at the workflows, validate it with them | "A minimal journey" below, `references/journeys-and-measures.md` |
| Check a document | `awa validate <files...>`; give a journey's workflows beside it | "Rules that keep documents valid" below |
| See what a run does without any model | `awa run <wf> --simulate --outputs <sim.json> --journal run.journal.jsonl` | "The core loop" below, `references/cli.md` |
| Run with real models, tools and people | `--providers`, `--deployment`, a runtime directory or `awa serve` | `references/runtime.md` |
| Constrain an AI agent | `outcome_contract`, `verification`, `guardrails` on the activity | `references/trust-and-compliance.md` |
| Route by rules or by judgement | A decision node with `decision_table`, `decision_engine` or `decision_model` | `references/document-model.md` |
| Wait for the outside world | A `message` or `signal` event with `correlation_key`, `timeout`, `timeout_edge_id` | `references/document-model.md` |
| Call APIs, MCP servers, gRPC, other agents | `tools` on the activity, `a2a` on the role or activity, permissions in the deployment file | `references/runtime.md` |
| Decide who may do what | `authorization` in the deployment file, never in the workflow | `references/runtime.md`, `references/trust-and-compliance.md` |
| Reuse a workflow as a step | A call activity: `is_expandable`, `expansion_workflow_id`, `subworkflow` | `references/runtime.md` |
| Change a workflow with runs in flight | A new `version`; `awa migrate check`, `plan`, `apply` | `references/runtime.md`, `references/cli.md` |
| Ask what a changed model or rule would have done | `awa replay <wf> <journal> --candidate <changed> --ai recorded` | `references/trust-and-compliance.md` |
| Measure journeys and workflows | `awa measures`, `awa journey export`, `tools/visualization/dashboard.html` | `references/journeys-and-measures.md` |
| Show journeys, a run, recommendations, a brand | `journey.html`, `replay.html`, `dashboard.html` with `?data=`, `?options=`, `?brand=` | `references/journeys-and-measures.md` |
| Hand over a document of a journey | `awa dossier --file <portfolio> --options <options> --format html,pdf,docx` | `references/journeys-and-measures.md` |
| Show compliance evidence | `awa evidence <sources> --format html -o evidence.html` | `references/trust-and-compliance.md` |
| Import from or export to BPMN, DMN, Serverless Workflow | `awa import bpmn`, `awa export bpmn`, `awa export serverless-workflow` | `references/cli.md` |
| Find an example to copy from | Pick by feature | `references/examples.md` |
| Implement AWA or claim a conformance level | Run the conformance suite | "Conformance" below |

## The core loop

Copy this checklist and tick it off:

```text
- [ ] 1. Write the document, starting from assets/ or from an example
- [ ] 2. Validate: awa validate workflow.awa.json (exit status 1 lists every problem)
- [ ] 3. Script what each activity returns: simulation.json, keyed by activity name
- [ ] 4. Simulate: awa run workflow.awa.json --simulate --outputs simulation.json -i '{"customer_id":"C-1"}' --journal run.journal.jsonl
- [ ] 5. Deliver events and complete tasks through a runtime directory (awa journey publish, awa journey resume) when the run waits
- [ ] 6. Inspect the journal: statuses, contract.checked, decision.evaluated, activity.failed with its error.code
- [ ] 7. Measure: awa measures, or awa journey export -o portfolio.json and open it in the views
- [ ] 8. Run for real: --providers, --deployment, and a person for each human task
```

Fix and repeat from step 2 until the run ends as expected. A run ends `completed`, `failed` or `cancelled`, or rests at `waiting_event` or `waiting_human`. Every problem names a code: look it up in "Pitfalls" below and in `references/runtime.md`.

## A minimal workflow

A refund request: it waits for the customer's receipt for seven days, an AI agent assesses the refund under an outcome contract, a decision table pays small refunds at once and sends larger ones to a person. The same document is `assets/refund-request.awa.json`.

```json
{
  "id": "74829770-13de-4882-9720-2bf9e2348bd6", "name": "Refund Request", "version": "1.0.0", "awa_version": "1.1",
  "description": "Waits for the customer's receipt, has an AI agent assess the refund under an outcome contract, pays small refunds at once and sends the others to a refund officer.",
  "roles": [
    { "id": "cf02cde3-1f26-43d9-bcac-223211d052ca", "name": "Refund assessor", "actor_type": "ai_agent", "ai_model_config": { "model_id": "tier:balanced", "temperature": 0.2 } },
    { "id": "94e2b6cc-9390-4c03-8d5a-b3c0be0d54f4", "name": "Refund officer", "actor_type": "human" },
    { "id": "a54cc693-5a0e-49d4-a498-36a11189ec75", "name": "Payments", "actor_type": "application" }
  ],
  "events": [
    { "id": "972cbed5-9fc4-4578-abb9-4d9d93c6909d", "name": "Refund requested", "event_type": "start", "event_definition": { "name": "refund.requested" } },
    { "id": "a7aaec01-586d-43fb-92c1-eaf48b41d397", "name": "Receipt uploaded", "event_type": "message", "description": "Wait for the receipt of this customer, for seven days at most.",
      "event_definition": { "name": "receipt.uploaded", "correlation_key": "customer_id", "timeout": "P7D", "timeout_edge_id": "40416bc5-33ec-49b3-9093-331128aa9ef5" } },
    { "id": "df4109bf-9d82-461f-ac31-e6f648428557", "name": "Refund paid", "event_type": "end" },
    { "id": "ba294d52-e5d2-4528-b440-a17cb830f1e5", "name": "Closed without receipt", "event_type": "end" }
  ],
  "activities": [
    { "id": "3d430317-f8ba-4e02-a0ae-853a0332d9a7", "name": "Assess refund", "role_id": "cf02cde3-1f26-43d9-bcac-223211d052ca", "actor_type": "ai_agent",
      "description": "Read the request and the receipt, and decide how much to refund.",
      "procedure": "1. Check that the receipt matches the order. 2. Refund the price of the items the customer returns. 3. Give the amount and one sentence of reason.",
      "outcome_contract": {
        "output_schema": { "type": "object", "required": ["amount", "reason"],
                           "properties": { "amount": { "type": "number", "minimum": 0 }, "reason": { "type": "string", "minLength": 1 } } },
        "postconditions": [ { "id": "74831420-13b2-4eb9-b875-b47980513b33", "name": "Within the refund limit", "expression": "amount <= 5000" } ],
        "budgets": { "max_attempts": 3, "max_duration": "PT2M", "max_tool_calls": 4 },
        "on_violation": "escalate_human" } },
    { "id": "3a684e82-966b-45ba-a20e-9b57579e9d9e", "name": "Review refund", "role_id": "94e2b6cc-9390-4c03-8d5a-b3c0be0d54f4", "actor_type": "human",
      "description": "A refund officer approves or changes the amount the agent proposed." },
    { "id": "ba606e19-3e5b-4b85-9424-56d13580dc1e", "name": "Pay refund", "role_id": "a54cc693-5a0e-49d4-a498-36a11189ec75", "actor_type": "application",
      "description": "Pay the refund to the customer's original means of payment.",
      "retry": { "max_attempts": 3, "initial_delay": "PT5S", "backoff_multiplier": 2 } }
  ],
  "decision_nodes": [
    { "id": "c99cc58f-52ad-49cd-9a6c-22d145a5d1a2", "name": "Route refund",
      "decision_table": { "hit_policy": "first",
        "inputs": [ { "name": "amount", "type": "number" } ], "outputs": [ { "name": "route", "type": "string" } ],
        "rules": [
          { "id": "304d6ece-a446-4386-b42a-0037825712cf", "description": "Small refunds are paid at once", "input_entries": ["<= 200"], "output_entries": ["auto"], "output_edge_id": "8037d304-1c9c-4731-819f-8caf20630a79" },
          { "id": "b24d243a-217c-46a2-af57-6a95c7216335", "description": "Larger refunds are reviewed", "input_entries": ["> 200"], "output_entries": ["review"], "output_edge_id": "f046927f-b034-45cf-a4cd-82b236cc2df5" } ] },
      "default_output_edge_id": "f046927f-b034-45cf-a4cd-82b236cc2df5" }
  ],
  "edges": [
    { "id": "2b7c78ed-df53-49da-aeaa-bded16fde320", "source_id": "972cbed5-9fc4-4578-abb9-4d9d93c6909d", "target_id": "a7aaec01-586d-43fb-92c1-eaf48b41d397" },
    { "id": "e491e1ad-ca2b-4cd5-a579-5e554f40acc5", "source_id": "a7aaec01-586d-43fb-92c1-eaf48b41d397", "target_id": "3d430317-f8ba-4e02-a0ae-853a0332d9a7" },
    { "id": "40416bc5-33ec-49b3-9093-331128aa9ef5", "source_id": "a7aaec01-586d-43fb-92c1-eaf48b41d397", "target_id": "ba294d52-e5d2-4528-b440-a17cb830f1e5", "label": "No receipt in 7 days" },
    { "id": "5c9fd684-e4b4-4b76-bf3e-3e8216f89842", "source_id": "3d430317-f8ba-4e02-a0ae-853a0332d9a7", "target_id": "c99cc58f-52ad-49cd-9a6c-22d145a5d1a2" },
    { "id": "8037d304-1c9c-4731-819f-8caf20630a79", "source_id": "c99cc58f-52ad-49cd-9a6c-22d145a5d1a2", "target_id": "ba606e19-3e5b-4b85-9424-56d13580dc1e", "label": "Paid at once" },
    { "id": "f046927f-b034-45cf-a4cd-82b236cc2df5", "source_id": "c99cc58f-52ad-49cd-9a6c-22d145a5d1a2", "target_id": "3a684e82-966b-45ba-a20e-9b57579e9d9e", "label": "Reviewed" },
    { "id": "1f15395b-f0d8-4a6c-acb5-b26f66c544fd", "source_id": "3a684e82-966b-45ba-a20e-9b57579e9d9e", "target_id": "ba606e19-3e5b-4b85-9424-56d13580dc1e" },
    { "id": "f909e07d-a85d-47a5-b508-03a4ca24a2a9", "source_id": "ba606e19-3e5b-4b85-9424-56d13580dc1e", "target_id": "df4109bf-9d82-461f-ac31-e6f648428557" }
  ]
}
```

What it shows:

- **Roles name models by tier** (`tier:reasoning`, `tier:balanced`, `tier:fast`), never by vendor; the deployment maps tiers to models.
- **The outcome contract** is checked deterministically on every attempt: schema, then postconditions, then the token budget. A rejected outcome is retried with the violated terms as feedback, up to `max_attempts`; then `escalate_human` hands the activity to a person.
- **The agent's outcome joins the run's data**: `amount` becomes a token data property that the decision table reads, and decision outputs (`route`) join it too.
- **The decision** has a `default_output_edge_id` that leaves the node, so no case ends in `NO_ROUTE`.
- **The wait** correlates on `customer_id`, which must be in the run's data when the wait begins; its timeout edge leads to its own end.

## A minimal journey

The journey above the workflow; the same document is `assets/refund-request.journey.json`.

```json
{
  "id": "c3c7ee72-a1bd-4788-975e-a2dcb4976b96", "name": "Refund", "version": "1.0.0", "awa_version": "1.1",
  "description": "From a customer's request for a refund to the money back on their account.",
  "subject": { "name": "customer", "key": "customer_id" },
  "stages": [
    { "id": "receipt", "name": "Receipt", "description": "The customer sends the receipt.", "workflows": ["74829770-13de-4882-9720-2bf9e2348bd6"],
      "complete_when": "receipt_id exists", "max_duration": "P7D", "owner": "Customer service" },
    { "id": "refund", "name": "Refund", "description": "The refund is assessed and paid.", "workflows": ["74829770-13de-4882-9720-2bf9e2348bd6"],
      "complete_when": "paid == true", "max_duration": "P10D", "owner": "Refunds team", "transitions": [] }
  ],
  "triggers": [ { "event": "refund.requested", "starts_journey": true, "start_workflow": "74829770-13de-4882-9720-2bf9e2348bd6" } ],
  "goals": [ { "id": "refunded", "name": "Refund paid", "expression": "paid == true" } ],
  "exits": [ { "event": "refund.withdrawn", "outcome": "abandoned", "reason": "The customer withdrew the request" } ],
  "artefacts": [
    { "id": "receipt", "name": "Receipt", "kind": "receipt", "description": "Proof of the purchase." },
    { "id": "refund-notice", "name": "Refund notice", "kind": "notice", "description": "Tells the customer how much was refunded." }
  ],
  "touchpoints": [
    { "id": "asks-for-refund", "name": "Asks for a refund", "direction": "inbound", "channel": "web", "technology": "Customer portal", "on": { "event": "refund.requested" } },
    { "id": "sends-receipt", "name": "Sends the receipt", "direction": "inbound", "channel": "web", "technology": "Customer portal", "on": { "event": "receipt.uploaded" },
      "exchanges": [ { "artefact": "receipt", "reference": "receipt_id" } ] },
    { "id": "refund-notified", "name": "Is told the refund is paid", "direction": "outbound", "channel": "email", "technology": "Email gateway", "on": { "activity": "Pay refund" },
      "exchanges": [ { "artefact": "refund-notice", "reference": "payment_id" } ] }
  ],
  "sentiment": { "rules": [
    { "on": "waited", "longer_than": "P3D", "change": -1, "reason": "waited more than three days for an answer" },
    { "on": "goal_reached", "goal": "refunded", "change": 1, "reason": "has the money back" } ] }
}
```

Stage ids are short slugs, `complete_when` and goals read the journey's data (event data, and run data once a run ends), the last stage, or a stage with `"transitions": []`, ends the journey, and at least one trigger has `starts_journey: true`.

## Run them

`assets/refund-request.simulation.json` scripts the agent and the payment. In a folder that holds the three files of `assets/`, with `awa` standing for the command found above:

```bash
awa validate refund-request.awa.json refund-request.journey.json
awa run refund-request.awa.json --simulate --outputs refund-request.simulation.json -i '{"customer_id":"C-1"}' --journal run.journal.jsonl
```

The first prints a line ending in `is valid` for each document. The run ends `waiting_event`: one command cannot deliver an event. A runtime directory (`.awa` by default) keeps journeys and runs between commands:

```bash
awa journey add refund-request.awa.json refund-request.journey.json
awa journey publish refund.requested --simulate --outputs refund-request.simulation.json -d '{"customer_id":"C-1"}'
awa journey publish receipt.uploaded --simulate --outputs refund-request.simulation.json -d '{"customer_id":"C-1","receipt_id":"R-1"}'
awa journey show C-1
awa measures
```

`journey show` lists the record: stages entered and completed, touchpoints, the run started and ended, the goal reached, and the mood moving from 0 to 1, marked inferred. With an amount above 200 in the simulation file the run waits for the refund officer: find the `token.waiting` event in `.awa/journals/<run id>.journal.jsonl` and complete the task with `awa journey resume <run id> <token id> --simulate --outputs refund-request.simulation.json -d '{"amount": 850}'`. Human tasks are kept in a task database: see "Pitfalls".

The same in code, TypeScript (import from the built SDK, `sdk/typescript/dist/index.mjs`, or from the package `agentic-workflow-architecture` at version 2 or later):

```typescript
import { WorkflowEngine, parse_document, business_event } from 'agentic-workflow-architecture';

const engine = new WorkflowEngine(parse_document(document), { simulate: true, simulated_outputs });
await engine.start({ customer_id: 'C-1' });
await engine.run();                                        // 'waiting_event'
await engine.deliverEvent(business_event('receipt.uploaded', { customer_id: 'C-1', receipt_id: 'R-1' }));
await engine.run();                                        // 'completed'
const journal = await engine.getEvents();
```

Python:

```python
from awa import Workflow, WorkflowEngine, business_event
engine = WorkflowEngine(Workflow.model_validate(document), options={"simulate": True, "simulated_outputs": outputs})
engine.run({"customer_id": "C-1"})["status"]               # 'waiting_event'
engine.deliver_event(business_event("receipt.uploaded", {"customer_id": "C-1", "receipt_id": "R-1"}))
engine.run()["status"]                                     # 'completed'
```

## Rules that keep documents valid

Validation has two stages, schema then integrity (specification 4.3), and an engine refuses to run a document that fails either.

- **Required fields.** A workflow needs `id`, `name`, `version` (`major.minor.patch`), `activities`, `edges`; an activity `id`, `name`, `role_id`, `actor_type`; an edge `id`, `source_id`, `target_id`; an event `id`, `name`, `event_type`; a role `id`, `name`, `actor_type`. A journey needs `id`, `name`, `version`, `subject` (`name`, `key`) and at least one stage with `id` and `name`. Set `"awa_version": "1.1"`.
- **Identifiers.** Every `id` and every reference to one is a UUID, unique among the nodes and edges of the workflow. Generate them (`node -e "console.log(crypto.randomUUID())"`, or `uuid.uuid4()` in Python); keep them stable across versions: replay and migration match nodes by id, and journeys name workflows by id. Journey stage, touchpoint and artefact ids are slugs: lowercase letters, digits, `_` and `-`.
- **Actor types** are `human`, `ai_agent`, `robot` and `application`. Point `role_id` at a role in `roles`, whose `ai_model_config.model_id` gives an AI agent its model.
- **References.** Edges join nodes that exist; a context binding names a declared context; each rule's `output_edge_id` and the `default_output_edge_id` are edges that leave that decision node; a `timeout_edge_id` leaves its event; `compensation.activity_id` names an activity that no edge targets.
- **Routing** (5.4). From a node, the first edge whose `condition` is true is taken alone; else the edge with `is_default: true`; else every edge without a condition, and several of those are a **parallel split**. Several unconditional edges are never a choice: for a choice, give conditions and one default. Join branches with `"join": "all"` on the node where they meet.
- **Decision tables.** One input entry per input column and one output entry per output column in every rule. Hit policies: `first`, `unique`, `any`, `priority`, `collect`, `rule_order`; with `unique` and `any`, overlapping rules that disagree fail with `DECISION_CONFLICT`. A node has a `decision_table` or a `decision_engine`, never both, and may add a `decision_model` with at least two options.
- **Events.** Event types that run are `start`, `intermediate`, `end`, `timer`, `message` and `signal`; `error` and `conditional` fail the token. A message or signal event needs `event_definition.name`; `mode` is `wait` (default) or `publish` with a `data` list. A timer needs `event_definition.duration` in weeks, days, hours, minutes or seconds (`PT30M`, `P7D`), never months or years.
- **Expressions** (section 6) are `path op literal` with `== != > >= < <=`, joined by `&&`, `||`, `!` and parentheses, plus `path exists`, `typeof path == number` and a bare `path` for truthiness. Paths are dotted (`order.total`); a bare word on the right is a string (`status == approved`). An expression that does not parse is refused at validation.
- **Decision entries** (5.5.1) are tests on the column's property: `-` for any value, `> 100`, `[50..70)`, `"FR", "DE"` for any of, `in("a", "b")`, `not(< 18)`, `null`, `not null`, `contains("x")`, `starts with "x"`, `matches("^A")`.
- **Journeys.** Every `transitions[].to` and `enter_stage` names a stage; each touchpoint's `on` names exactly one of `event`, `activity` or `tool`; each exchange names an artefact; each sentiment rule has `change` or `measure`, never both, and a `waited` rule needs `longer_than`. Give a journey's workflows to `awa validate` beside it: with them, every workflow it names must be one of them.
- **Policies stay out of documents.** Principals, the authorization policy and tool permissions belong to the deployment file, so the same workflow runs under different policies.
- **Extensions.** Unknown properties are kept and ignored; prefix your own with a namespace and a colon (`acme:cost_centre`).

## Pitfalls

- **`NO_ROUTE` in simulation.** Simulated activities return no business data unless `--outputs` scripts them by activity name (`output`, `error` with `code`, `contexts`, or `attempts`, one entry per execution). Script every value a condition or a decision reads.
- **A run that stops at `waiting_event`.** `awa run` cannot deliver events. Use `awa journey publish` on a runtime directory, `POST /api/v1/journeys/events` on `awa serve`, or `deliverEvent` in code. An event that matches no waiting token is not kept, so the workflow must wait before the event comes.
- **A correlated wait that never matches.** The `correlation_key` path must hold a value in the token's data when the wait begins, and the event's `data` must carry the same value.
- **A human task that fails at once.** The TypeScript SDK keeps human tasks in a SQLite database through Prisma (`sdk/typescript/prisma/awa.db`). When a human activity fails with an error about a missing Prisma client or table, run `npx prisma generate` and `npx prisma db push` once in `sdk/typescript`, or set `AWA_DATABASE_URL` to a database that has the tables (`file:/path/to/awa.db`). The Python SDK creates `awa.db` in the working folder, or at `AWA_DATABASE_URL`.
- **A rejected outcome.** `CONTRACT_VIOLATION` and `VERIFICATION_FAILED` are not retried by `retry`: attempts after a rejection belong to the contract's `budgets.max_attempts` (default 3), and only `ai_agent` activities are re-executed. `contract.checked` in the journal names the violated terms.
- **Verification fails closed.** A `schema_only` criterion without an `expression` fails; a `custom` mode without a registered verifier gives `error`; nothing passes by default.
- **Codes never retried** whatever the retry policy: `NO_ROUTE`, `FORBIDDEN`, `PERMISSION_DENIED`, `GUARDRAIL_BLOCKED`, `GUARDRAIL_ERROR`, `SLA_BREACH`, the `CONTEXT_*` codes, `SUBWORKFLOW_NOT_FOUND`, `SUBWORKFLOW_DEPTH_EXCEEDED` (specification 10.1).
- **Commands and hosts are denied by default.** A `command` tool binding runs only with `--allow-commands` or `tools.allow_commands`; `tools.allowed_hosts` restricts HTTP; an `mcp` binding reaches only a server declared in `tools.mcp_servers`.
- **A journey that never starts.** No trigger with `starts_journey: true`, or the event data lacks the subject key.
- **A join that waits forever** after an exclusive choice: the engine fails it with `JOIN_DEADLOCK`. Use `join: all` only after a parallel split.
- **A context the agent cannot see.** An activity is given only the contexts its `context_bindings` allow; conditions never see contexts; a required context with no value fails with `CONTEXT_MISSING`.
- **Replays need full payloads.** A journal written with payload mode `hash` or `none` replays only up to its first activity.

## Command line at a glance

The TypeScript `awa` command; `references/cli.md` lists every option and the differences of the Python command.

| Command | Does |
|---|---|
| `awa validate <files...> [--json]` | Schema and integrity of workflows and journeys; exit status 1 on a problem |
| `awa run <file> [-s] [--outputs f] [-i json] [-j journal.jsonl] [-p providers] [--deployment f] [--as id] [-w child.awa.json...]` | One run, in simulation or for real |
| `awa journey add\|publish\|tick\|resume\|list\|show\|analytics\|export [--dir .awa] [--store url]` | Journeys and runs kept in a runtime directory or a shared PostgreSQL store |
| `awa serve [-p 3000] [--deployment f] [--a2a wf.awa.json] [--store url]` | The HTTP interface, the views under `/views`, workflows offered as A2A agents |
| `awa task list\|show\|assign\|complete\|reject` | Human tasks |
| `awa replay <wf> <journal> [--candidate f] [--ai live\|recorded] [--json]` | Counterfactual replay; exit status 2 on a regression |
| `awa migrate check\|plan\|apply` | Versions with runs in flight, and runs moved between them |
| `awa measures [--dir d \| --file portfolio.json] [--json\|--openmetrics\|--html f\|--list]` | The 56 measures of section 21 |
| `awa evidence <sources...> [--format json\|md\|html] [--as-of t] [-o f]` | The evidence report of section 32 |
| `awa dossier --file portfolio.json [--options f] [--edition professional\|client] [--format html,pdf,docx]` | The dossier of a journey |
| `awa recipe <wf> [journal] [-o RECIPE.md]` | How to rebuild the workflow, and what one run did |
| `awa eval`, `awa knowledge`, `awa telemetry`, `awa import`, `awa export` | Evaluation datasets, knowledge, OpenTelemetry, BPMN, DMN and Serverless Workflow |

## Views and the MCP server

- `tools/visualization/replay.html`: one run from its workflow and journal, step by step (`?workflow=<url>&journal=<url>`, or `?run=<server run url>` to follow it live).
- `tools/visualization/journey.html`: journeys from `awa journey export` (`?data=<url>`, `?live=http://localhost:3000`), with the glossary, the Recommendations tab, the Export dossier dialog, the journey's options (`?options=<url>`) and a company's brand from a DESIGN.md or a brand.json (`?brand=<url>`).
- `tools/visualization/dashboard.html`: the measures page over the same record; `awa measures --html measures.html` writes it as one file.
- `tools/visualization/index.html`: a workflow definition in 2D or 3D.
- Each page opens from the file system with its sample. The journey view and the measures page take a record through "Open a record"; the replay takes a workflow and a journal dropped on it. A page that fetches files by address (`?data=`, `?options=`, `?brand=`) needs them served over HTTP from the same origin; `awa serve` serves the views under `/views`.

The MCP server works entirely in simulation and takes documents inline: `validate_document`, `show_workflow`, `simulate_workflow`, `show_journeys`, `simulate_journey`, `load_claims_example`, `show_dashboard`, `make_dossier`. In Claude Code, the plugin installs from a built clone with `/plugin marketplace add ./` and `/plugin install awa@agentic-workflow-architecture`; `docs/guides/connect-ai-assistants.md` gives the steps for Claude Desktop, claude.ai, ChatGPT, Codex, Cursor, Mistral and Gemini CLI. When the server is connected, prefer its tools for validating and showing; when it is not, use the command line.

## Conformance

`spec/conformance` holds language-neutral cases in 28 levels (specification 2.1), from `document` and `core` to `guardrails`, `evidence` and `evaluation`. The TypeScript and Python SDKs pass all of them; the Java SDK is a data model that reads and writes documents without validating them. An implementation claims a level only when it passes every case of that level and reports the cases it skips. Run the suites with `npx vitest run tests/conformance.test.ts` in `sdk/typescript` and `pytest tests/test_conformance.py -rs` in `sdk/python`. A change to the specification, a schema or a case goes through an AWA Enhancement Proposal (`docs/proposals/README.md`, `GOVERNANCE.md`).

## Reference files

Read the one the task needs; each is self-contained.

- `references/document-model.md`: every field of workflow and journey documents that matters, from the JSON Schemas: roles, activities, edges, events, decisions, contexts, service levels, tools, contracts, guardrails, journeys.
- `references/runtime.md`: engine options in both SDKs, actors, model providers and tiers, tools over HTTP, MCP and gRPC, A2A, deployment files, authorization, sub-workflows, versions and migration, hosts and stores, journal events, error codes.
- `references/cli.md`: every command and option of `awa`, the HTTP routes and the environment variables.
- `references/journeys-and-measures.md`: journeys at run time, measures, the views, view options, glossary, brand, recommendations, dossier.
- `references/trust-and-compliance.md`: outcome contracts, verification, guardrails, evidence reports, the EU AI Act mapping, counterfactual replay, evaluation, shadow runs, knowledge.
- `references/examples.md`: what each example in `examples/` shows and which file to copy from.
