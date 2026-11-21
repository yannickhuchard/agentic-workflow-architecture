---
type: Strategy
title: How to check fraud signals
description: The approach whose outcome was accepted for "Check fraud signals".
resource: urn:awa:workflow:42ddec2f-18d0-5b06-837b-bf1e9c8cecdb:node:51b0afff-918b-534d-a81e-df9e9d91ad6c
tags:
  - ai_agent
  - motor-claim-settlement
status: draft
generated:
  by: agent:awa-distiller
  at: "2026-11-21T22:45:56.672Z"
sources:
  - id: run-7c4e3471
    resource: urn:awa:run:7c4e3471-2665-4706-b489-1dd3610ddb14
    title: Run 7c4e3471-2665-4706-b489-1dd3610ddb14, journal events 31, 33
    last_modified: "2026-11-21T22:45:50.764Z"
    x-awa-event-seqs:
      - 31
      - 33
  - id: run-ac863140
    resource: urn:awa:run:ac863140-d3ec-4a67-b34b-aaaafca20cd5
    title: Run ac863140-d3ec-4a67-b34b-aaaafca20cd5, journal events 31, 33
    last_modified: "2026-11-21T22:45:56.672Z"
    x-awa-event-seqs:
      - 31
      - 33
x-awa-entry-type: strategy
x-awa-observations: 2
x-awa-scope:
  workflow_id: 42ddec2f-18d0-5b06-837b-bf1e9c8cecdb
  workflow_name: Motor Claim Settlement
  node_id: 51b0afff-918b-534d-a81e-df9e9d91ad6c
  node_name: Check fraud signals
x-awa-counts:
  accepted_runs: 2
  accepted_first_attempt: 0
  attempts: 4
x-awa-latest:
  plan:
    - Compare claim date with policy start
    - Check prior claims
    - Check repairer against watchlist
  rationale: Policy held for four years, one prior claim, repairer not on the watchlist.
  confidence: 0.9
  model: tier:fast
x-awa-created-at: "2026-11-21T22:45:50.764Z"
---

# How to check fraud signals

Across 2 run(s), the outcome of **Check fraud signals** was accepted 2 time(s), 0% of them on the first attempt (2.0 attempts on average).

## Approach that was accepted most recently

1. Compare claim date with policy start
2. Check prior claims
3. Check repairer against watchlist

## Why it works

Policy held for four years, one prior claim, repairer not on the watchlist.

Model reference used: `tier:fast`.

The approach is the actor's own account of its work, recorded with its output.

## Related

- [Check fraud signals: timeout](/failure-patterns/motor-claim-settlement-check-fraud-signals-timeout-fraud-scoring-service-timed-out.md)
