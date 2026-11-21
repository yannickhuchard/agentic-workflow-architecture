---
type: Failure Pattern
title: "Pay claimant: validation error"
description: '"Pay claimant" was rejected or raised: Bank rejected the transfer: account closed'
resource: urn:awa:workflow:42ddec2f-18d0-5b06-837b-bf1e9c8cecdb:node:ec20a080-3057-5f9c-a694-7040111b09e7
tags:
  - application
  - motor-claim-settlement
  - validation_error
status: draft
generated:
  by: agent:awa-distiller
  at: "2026-11-21T22:45:56.672Z"
sources:
  - id: run-ac863140
    resource: urn:awa:run:ac863140-d3ec-4a67-b34b-aaaafca20cd5
    title: Run ac863140-d3ec-4a67-b34b-aaaafca20cd5, journal events 48
    last_modified: "2026-11-21T22:45:56.672Z"
    x-awa-event-seqs:
      - 48
x-awa-entry-type: failure_pattern
x-awa-observations: 1
x-awa-scope:
  workflow_id: 42ddec2f-18d0-5b06-837b-bf1e9c8cecdb
  workflow_name: Motor Claim Settlement
  node_id: ec20a080-3057-5f9c-a694-7040111b09e7
  node_name: Pay claimant
x-awa-counts:
  occurrences: 1
  resolved_by_unresolved: 1
x-awa-latest:
  code: VALIDATION_ERROR
  terms: []
  message: "Bank rejected the transfer: account closed"
  resolution: unresolved
x-awa-created-at: "2026-11-21T22:45:56.672Z"
---

# Pay claimant: validation error

Seen 1 time(s) across 1 run(s) at **Pay claimant**.

## What goes wrong

Bank rejected the transfer: account closed

## How it was resolved

- Not resolved: the activity failed: 1 time(s)

## Related

- [Motor Claim Settlement fails at Pay claimant (VALIDATION_ERROR)](/lessons/motor-claim-settlement-failed-at-pay-claimant-validation-error.md)
