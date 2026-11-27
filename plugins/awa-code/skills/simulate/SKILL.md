---
name: simulate
description: Simulate one run of an AWA workflow with the AWA MCP server and replay its path, decisions, waits and simulated tool calls. Use when the user asks to simulate, dry-run or replay an .awa.json workflow. Nothing is executed.
argument-hint: "<workflow file> [simulated outputs file]"
disable-model-invocation: true
---

# Simulate an AWA workflow

Arguments: $ARGUMENTS

1. Read the workflow file named first. If a second file is named, read it as the simulated outputs: what each activity returns, keyed by activity name. AWA examples keep them in a `simulation.json` beside the workflow; use that file when it is there and no other is named.
2. Call the `simulate_workflow` tool of the `awa` MCP server with `workflow` and, if you have them, `simulated_outputs`. Pass `input` when the user gives the data the run starts with. The server takes documents inline: pass the content, never a path.
3. Report the status, the number of steps and the path. Name each decision and the rule it matched, each wait and each failure with its code. Say that the run is a simulation: no tool, model or system was called.
4. A run that stops with `NO_ROUTE` or `CONTRACT_VIOLATION` usually lacks business data: say which activity needs which output in `simulated_outputs`, and offer to run it again with that output.
