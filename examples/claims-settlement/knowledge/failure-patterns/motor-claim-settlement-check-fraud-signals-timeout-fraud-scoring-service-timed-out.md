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
  at: "2026-11-21T23:07:24.294Z"
sources:
  - id: run-5bdc86c3
    resource: urn:awa:run:5bdc86c3-9735-40a4-865b-6a71c26fecc2
    title: Run 5bdc86c3-9735-40a4-865b-6a71c26fecc2, journal events 32
    last_modified: "2026-11-21T23:07:11.460Z"
    x-awa-event-seqs:
      - 32
  - id: run-a49c556e
    resource: urn:awa:run:a49c556e-fd4b-4da5-9fcb-569a922e0859
    title: Run a49c556e-fd4b-4da5-9fcb-569a922e0859, journal events 32
    last_modified: "2026-11-21T23:07:17.510Z"
    x-awa-event-seqs:
      - 32
  - id: run-a56272e2
    resource: urn:awa:run:a56272e2-d388-466a-9a7c-ea26e04c035d
    title: Run a56272e2-d388-466a-9a7c-ea26e04c035d, journal events 32
    last_modified: "2026-11-21T23:07:24.294Z"
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
x-awa-created-at: "2026-11-21T23:07:11.460Z"
---

# Check fraud signals: timeout

Seen 3 time(s) across 3 run(s) at **Check fraud signals**.

## What goes wrong

Fraud scoring service timed out

## How it was resolved

- Retried after an error, then accepted: 3 time(s)

## Related

- [How to check fraud signals](/strategies/motor-claim-settlement-check-fraud-signals.md)
