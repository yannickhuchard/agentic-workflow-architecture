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
  at: "2026-11-22T11:23:35.788Z"
sources:
  - id: run-1c5f2824
    resource: urn:awa:run:1c5f2824-ac15-4cf1-b6f6-385bb4201253
    title: Run 1c5f2824-ac15-4cf1-b6f6-385bb4201253, journal events 32
    last_modified: "2026-11-22T11:23:22.990Z"
    x-awa-event-seqs:
      - 32
  - id: run-f4b30187
    resource: urn:awa:run:f4b30187-6774-41d0-abf3-7f707e2a920a
    title: Run f4b30187-6774-41d0-abf3-7f707e2a920a, journal events 32
    last_modified: "2026-11-22T11:23:29.066Z"
    x-awa-event-seqs:
      - 32
  - id: run-191bdcc6
    resource: urn:awa:run:191bdcc6-80b8-4d3d-a855-fb1fbbbb1393
    title: Run 191bdcc6-80b8-4d3d-a855-fb1fbbbb1393, journal events 32
    last_modified: "2026-11-22T11:23:35.788Z"
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
x-awa-created-at: "2026-11-22T11:23:22.990Z"
---

# Check fraud signals: timeout

Seen 3 time(s) across 3 run(s) at **Check fraud signals**.

## What goes wrong

Fraud scoring service timed out

## How it was resolved

- Retried after an error, then accepted: 3 time(s)

## Related

- [How to check fraud signals](/strategies/motor-claim-settlement-check-fraud-signals.md)
