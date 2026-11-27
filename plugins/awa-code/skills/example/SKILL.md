---
name: example
description: Open the fictional claims example bundled with the AWA MCP server, its customer journeys and its measures dashboard. Use when the user wants to see what AWA does, or asks for a demonstration.
disable-model-invocation: true
---

# Open the AWA claims example

1. Call the `load_claims_example` tool of the `awa` MCP server with no argument. It opens three journeys (policy purchase, motor claim, policy renewal) with six fictional customers.
2. Call `show_dashboard` with `use_claims_example` set to true.
3. Report who is stuck and who should act, then the completion of each journey, quoting each rate with its count (for example 13 of 18 journeys reached the end).
4. Say that the example is fictional and was produced by a scripted simulation. Offer next steps: `/awa:show` on one of its workflows (ask `load_claims_example` for `document` `claims-settlement.workflow`), or `/awa:simulate` with its simulated outputs.
