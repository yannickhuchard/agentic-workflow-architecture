---
type: Failure Pattern
title: "Check fraud signals: timeout"
description: '"Check fraud signals" was rejected or raised: Fraud scoring service timed out'
resource: urn:awa:workflow:42ddec2f-18d0-5b06-837b-bf1e9c8cecdb:node:51b0afff-918b-534d-a81e-df9e9d91ad6c
tags:
  - ai_agent
  - motor-claim-settlement
  - timeout
status: draft
generated:
  by: agent:awa-distiller
  at: "2026-11-21T22:45:56.672Z"
sources:
  - id: run-7c4e3471
    resource: urn:awa:run:7c4e3471-2665-4706-b489-1dd3610ddb14
    title: Run 7c4e3471-2665-4706-b489-1dd3610ddb14, journal events 26
    last_modified: "2026-11-21T22:45:50.764Z"
    x-awa-event-seqs:
      - 26
  - id: run-ac863140
    resource: urn:awa:run:ac863140-d3ec-4a67-b34b-aaaafca20cd5
    title: Run ac863140-d3ec-4a67-b34b-aaaafca20cd5, journal events 26
    last_modified: "2026-11-21T22:45:56.672Z"
    x-awa-event-seqs:
      - 26
x-awa-entry-type: failure_pattern
x-awa-observations: 2
x-awa-scope:
  workflow_id: 42ddec2f-18d0-5b06-837b-bf1e9c8cecdb
  workflow_name: Motor Claim Settlement
  node_id: 51b0afff-918b-534d-a81e-df9e9d91ad6c
  node_name: Check fraud signals
x-awa-counts:
  occurrences: 2
  resolved_by_retry: 2
x-awa-latest:
  code: TIMEOUT
  terms: []
  message: Fraud scoring service timed out
  resolution: retry
x-awa-created-at: "2026-11-21T22:45:50.764Z"
---

# Check fraud signals: timeout

Seen 2 time(s) across 2 run(s) at **Check fraud signals**.

## What goes wrong

Fraud scoring service timed out

## How it was resolved

- Retried after an error, then accepted: 2 time(s)

## Related

- [How to check fraud signals](/strategies/motor-claim-settlement-check-fraud-signals.md)
