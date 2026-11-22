---
type: Failure Pattern
title: "Pay claimant: validation error"
description: '"Pay claimant" was rejected or raised: Bank rejected the transfer: RPC error -32010: account closed'
resource: urn:awa:workflow:42ddec2f-18d0-5b06-837b-bf1e9c8cecdb:node:ec20a080-3057-5f9c-a694-7040111b09e7
tags:
  - application
  - motor-claim-settlement
  - validation_error
status: draft
generated:
  by: agent:awa-distiller
  at: "2026-11-22T11:23:29.066Z"
sources:
  - id: run-f4b30187
    resource: urn:awa:run:f4b30187-6774-41d0-abf3-7f707e2a920a
    title: Run f4b30187-6774-41d0-abf3-7f707e2a920a, journal events 56
    last_modified: "2026-11-22T11:23:29.066Z"
    x-awa-event-seqs:
      - 56
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
  message: "Bank rejected the transfer: RPC error -32010: account closed"
  resolution: unresolved
x-awa-created-at: "2026-11-22T11:23:29.066Z"
---

# Pay claimant: validation error

Seen 1 time(s) across 1 run(s) at **Pay claimant**.

## What goes wrong

Bank rejected the transfer: RPC error -32010: account closed

## How it was resolved

- Not resolved: the activity failed: 1 time(s)

## Related

- [Motor Claim Settlement fails at Pay claimant (VALIDATION_ERROR)](/lessons/motor-claim-settlement-failed-at-pay-claimant-validation-error.md)
