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
  at: "2026-11-22T11:47:16.484Z"
sources:
  - id: run-ed673f09
    resource: urn:awa:run:ed673f09-082b-45a0-aa9b-a2a68db5cb50
    title: Run ed673f09-082b-45a0-aa9b-a2a68db5cb50, journal events 37, 39
    last_modified: "2026-11-22T11:47:03.573Z"
    x-awa-event-seqs:
      - 37
      - 39
  - id: run-c068c94e
    resource: urn:awa:run:c068c94e-ded1-4189-a248-2b1224d44ffc
    title: Run c068c94e-ded1-4189-a248-2b1224d44ffc, journal events 37, 39
    last_modified: "2026-11-22T11:47:09.658Z"
    x-awa-event-seqs:
      - 37
      - 39
  - id: run-e853a985
    resource: urn:awa:run:e853a985-771b-4cb3-b440-bfa3978ea3af
    title: Run e853a985-771b-4cb3-b440-bfa3978ea3af, journal events 37, 39
    last_modified: "2026-11-22T11:47:16.484Z"
    x-awa-event-seqs:
      - 37
      - 39
x-awa-entry-type: strategy
x-awa-observations: 3
x-awa-scope:
  workflow_id: 42ddec2f-18d0-5b06-837b-bf1e9c8cecdb
  workflow_name: Motor Claim Settlement
  node_id: 51b0afff-918b-534d-a81e-df9e9d91ad6c
  node_name: Check fraud signals
x-awa-counts:
  accepted_runs: 3
  accepted_first_attempt: 0
  attempts: 6
x-awa-latest:
  plan:
    - Compare claim date with policy start
    - Check prior claims
    - Check repairer against watchlist
  rationale: Policy held for four years, one prior claim, repairer not on the watchlist.
  confidence: 0.9
  model: tier:fast
x-awa-created-at: "2026-11-22T11:47:03.573Z"
---

# How to check fraud signals

Across 3 run(s), the outcome of **Check fraud signals** was accepted 3 time(s), 0% of them on the first attempt (2.0 attempts on average).

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
