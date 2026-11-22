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
  at: "2026-11-22T11:47:16.484Z"
sources:
  - id: run-ed673f09
    resource: urn:awa:run:ed673f09-082b-45a0-aa9b-a2a68db5cb50
    title: Run ed673f09-082b-45a0-aa9b-a2a68db5cb50, journal events 32
    last_modified: "2026-11-22T11:47:03.573Z"
    x-awa-event-seqs:
      - 32
  - id: run-c068c94e
    resource: urn:awa:run:c068c94e-ded1-4189-a248-2b1224d44ffc
    title: Run c068c94e-ded1-4189-a248-2b1224d44ffc, journal events 32
    last_modified: "2026-11-22T11:47:09.658Z"
    x-awa-event-seqs:
      - 32
  - id: run-e853a985
    resource: urn:awa:run:e853a985-771b-4cb3-b440-bfa3978ea3af
    title: Run e853a985-771b-4cb3-b440-bfa3978ea3af, journal events 32
    last_modified: "2026-11-22T11:47:16.484Z"
    x-awa-event-seqs:
      - 32
x-awa-entry-type: failure_pattern
x-awa-observations: 3
x-awa-scope:
  workflow_id: 42ddec2f-18d0-5b06-837b-bf1e9c8cecdb
  workflow_name: Motor Claim Settlement
  node_id: 51b0afff-918b-534d-a81e-df9e9d91ad6c
  node_name: Check fraud signals
x-awa-counts:
  occurrences: 3
  resolved_by_retry: 3
x-awa-latest:
  code: TIMEOUT
  terms: []
  message: Fraud scoring service timed out
  resolution: retry
x-awa-created-at: "2026-11-22T11:47:03.573Z"
---

# Check fraud signals: timeout

Seen 3 time(s) across 3 run(s) at **Check fraud signals**.

## What goes wrong

Fraud scoring service timed out

## How it was resolved

- Retried after an error, then accepted: 3 time(s)

## Related

- [How to check fraud signals](/strategies/motor-claim-settlement-check-fraud-signals.md)
