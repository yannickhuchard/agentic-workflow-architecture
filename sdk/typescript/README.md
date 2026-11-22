# Agentic Workflow Architecture: TypeScript SDK

The reference implementation of [AWA 1.1](https://github.com/yannickhuchard/agentic-workflow-architecture/blob/main/docs/specification.md), an open specification for business workflows in which AI agents, people, robots and applications work side by side. The guiding principle is **fixed outcome, free strategy**: an agent may reach a result by different means each time, so AWA fixes what must be true of the result, records how it was reached, and refuses results it cannot verify.

## Install

```bash
npm install agentic-workflow-architecture
```

Node 20 or later. The package gives a library (CommonJS and ES modules, with types) and the `awa` command.

## Run a workflow

```bash
npx awa run workflow.awa.json --simulate --outputs simulation.json --journal run.jsonl
```

`--simulate` calls no model, tool or person: activities return what `--outputs` scripts and nothing otherwise. The journal is the append-only record of the run.

```typescript
import { WorkflowEngine, parse_document } from 'agentic-workflow-architecture';

const engine = new WorkflowEngine(parse_document(document), { simulate: true, simulated_outputs });
await engine.start({ claim_id: 'C-1' });
const status = await engine.run();          // completed, failed, waiting_event, waiting_human
const events = await engine.getEvents();    // the journal
```

## What it does

| | |
|---|---|
| Flow | Sequence, conditions, decision tables, parallel split and join, timers, compensation |
| Outcome contracts | Output schema, postconditions, budgets, escalation to a person; checked deterministically, failing closed |
| Resilience | Retry with backoff, dead letters, checkpoints, recovery in another process |
| Models | References by capability tier, a router with ordered fallbacks, model decisions within enumerated options |
| Tools | HTTP, command, JSON-RPC, gRPC and MCP bindings through one runner that refuses, bounds and journals every call |
| Contexts | An activity is given the contexts it is bound to read and no other; a write needs a binding that allows it |
| Service levels | Time taken, waits and retries included, compared with what was promised; warnings and breaches journalled |
| Business events | Publish and wait for events in CloudEvents form, with correlation and deadlines |
| Journeys | `AwaRuntime` hosts the journeys of customers across workflows, keeps its state and recovers in another process |
| Measures | `compute_measures`, `awa measures`: 56 measures of journeys and workflows, each with the number it was computed over |
| Replay | `awa replay`: re-run a recorded run under a changed model, prompt or rule and get a regression report |
| Knowledge, recipe | `awa knowledge`, `awa recipe`: what runs taught, and how to rebuild a workflow from its journal |

It passes every level of the conformance suite in [`spec/conformance`](https://github.com/yannickhuchard/agentic-workflow-architecture/tree/main/spec/conformance).

## Journeys and measures

```bash
npx awa journey add intake.awa.json claim.journey.json
```

```bash
npx awa journey publish claim.submitted -d '{"customer_id":"c-1"}'
```

```bash
npx awa measures --html measures.html
```

The last command writes the measures page as one file to open in a browser. `npx awa serve` offers the same page and the journey view under `/views`, the measures under `/api/v1/measures`, and `?format=openmetrics` for a metrics system.

## Commands

`awa run`, `awa journey`, `awa measures`, `awa replay`, `awa recipe`, `awa knowledge`, `awa serve`, `awa task`. Each has `--help`.

## The task database

Workflows, journeys, measures and replay need no database. Human tasks kept in a database (`awa task`, the tasks API of `awa serve`) use SQLite through Prisma, whose client is generated once after installing:

```bash
npx prisma@6 generate --schema node_modules/agentic-workflow-architecture/prisma/schema.prisma
```

```bash
npx prisma@6 db push --schema node_modules/agentic-workflow-architecture/prisma/schema.prisma
```

By default the database file sits beside that schema, inside `node_modules`, and is lost when the package is reinstalled: for anything you want to keep, set `AWA_DATABASE_URL` (for example `file:/var/lib/awa/awa.db`) and create its tables there.

## Changes in 2.0.0

2.0.0 implements AWA 1.1 and breaks with 1.x where 1.x was wrong:

- A run with a failed token is `failed`. A choice with no true condition and no default edge fails with `NO_ROUTE` instead of taking the first edge.
- Verification and outcome contracts fail closed: an output that cannot be verified is rejected.
- Several unconditional edges from one node are a parallel split.
- Context bindings are enforced: a workflow that binds a required context nothing has written fails with `CONTEXT_MISSING`.
- Simulated activities return no business data unless scripted.

The full list is in the [release notes](https://github.com/yannickhuchard/agentic-workflow-architecture/blob/main/release_notes.md).

## Links

[Specification](https://github.com/yannickhuchard/agentic-workflow-architecture/blob/main/docs/specification.md) · [Examples](https://github.com/yannickhuchard/agentic-workflow-architecture/tree/main/examples) · [Repository](https://github.com/yannickhuchard/agentic-workflow-architecture) · Apache-2.0
