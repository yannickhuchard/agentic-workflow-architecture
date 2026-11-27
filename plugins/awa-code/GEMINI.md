# AWA workflows and journeys

This extension connects the AWA MCP server. AWA (Agentic Workflow Architecture) is an open specification for business workflows in which AI agents, people, robots and applications work together, and for customer journeys across those workflows. Workflows are JSON files that usually end in `.awa.json`; journeys end in `.journey.json`.

## The tools of the `awa` server

| Tool | Use it to |
|---|---|
| `validate_document` | Check a workflow or journey (and, for a journey, the workflows it refers to) and report each problem in plain words |
| `show_workflow` | Show a workflow as a graph: activities, actor types, roles, decisions, events and the data that moves |
| `simulate_workflow` | Run a workflow once in simulation and replay its path, decisions, waits and simulated tool calls |
| `show_journeys` | Show customer journeys from a portfolio export, or from journeys and workflows with events to play |
| `simulate_journey` | Play business events through journeys in simulation and show where each customer stands |
| `load_claims_example` | Open the bundled fictional claims example (3 journeys, 5 workflows, 6 customers) and hand out its documents |
| `show_dashboard` | The measures of journeys and workflows: who is stuck, who is to act, completion, rework, waiting, cost |

## How to use them

- Documents are passed inline: read the file, then pass its JSON content. The server never reads a path or fetches an address.
- Everything is a simulation: no tool binding, command, HTTP call, model or production system is called. Say so when you report a simulated run.
- A simulated activity returns only what `simulated_outputs` says. Examples keep these outputs in a `simulation.json` beside the workflow. A run that stops with `NO_ROUTE` or `CONTRACT_VIOLATION` usually lacks such data.
- Quote each rate with its count, for example 13 of 18 journeys.
- After you edit an AWA document, validate it before you finish.

The specification is `docs/specification.md` in the AWA repository, https://github.com/yannickhuchard/agentic-workflow-architecture.
