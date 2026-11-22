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
  at: "2026-11-22T09:55:14.226Z"
sources:
  - id: run-2cf36b19
    resource: urn:awa:run:2cf36b19-3139-447a-bf48-2dc43b243516
    title: Run 2cf36b19-3139-447a-bf48-2dc43b243516, journal events 32
    last_modified: "2026-11-22T09:55:01.394Z"
    x-awa-event-seqs:
      - 32
  - id: run-3c8b8cc4
    resource: urn:awa:run:3c8b8cc4-0f7f-4944-8761-324d412b3e1c
    title: Run 3c8b8cc4-0f7f-4944-8761-324d412b3e1c, journal events 32
    last_modified: "2026-11-22T09:55:07.459Z"
    x-awa-event-seqs:
      - 32
  - id: run-148f2184
    resource: urn:awa:run:148f2184-e25a-495a-bcf3-97181d4cc29d
    title: Run 148f2184-e25a-495a-bcf3-97181d4cc29d, journal events 32
    last_modified: "2026-11-22T09:55:14.226Z"
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
x-awa-created-at: "2026-11-22T09:55:01.394Z"
---

# Check fraud signals: timeout

Seen 3 time(s) across 3 run(s) at **Check fraud signals**.

## What goes wrong

Fraud scoring service timed out

## How it was resolved

- Retried after an error, then accepted: 3 time(s)

## Related

- [How to check fraud signals](/strategies/motor-claim-settlement-check-fraud-signals.md)
