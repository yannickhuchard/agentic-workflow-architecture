---
type: Lesson
title: Motor Claim Settlement fails at Pay claimant (VALIDATION_ERROR)
description: 'The run failed at "Pay claimant": Bank rejected the transfer: RPC error -32010: account closed'
resource: urn:awa:workflow:42ddec2f-18d0-5b06-837b-bf1e9c8cecdb:node:ec20a080-3057-5f9c-a694-7040111b09e7
tags:
  - run-failure
  - motor-claim-settlement
status: draft
generated:
  by: agent:awa-distiller
  at: "2026-11-22T11:23:29.066Z"
sources:
  - id: run-f4b30187
    resource: urn:awa:run:f4b30187-6774-41d0-abf3-7f707e2a920a
    title: Run f4b30187-6774-41d0-abf3-7f707e2a920a, journal events 58, 60
    last_modified: "2026-11-22T11:23:29.066Z"
    x-awa-event-seqs:
      - 58
      - 60
x-awa-entry-type: lesson
x-awa-observations: 1
x-awa-scope:
  workflow_id: 42ddec2f-18d0-5b06-837b-bf1e9c8cecdb
  workflow_name: Motor Claim Settlement
  node_id: ec20a080-3057-5f9c-a694-7040111b09e7
  node_name: Pay claimant
x-awa-counts:
  occurrences: 1
  compensations_attempted: 1
  compensations_succeeded: 1
x-awa-latest:
  code: VALIDATION_ERROR
  message: "Bank rejected the transfer: RPC error -32010: account closed"
x-awa-created-at: "2026-11-22T11:23:29.066Z"
---

# Motor Claim Settlement fails at Pay claimant (VALIDATION_ERROR)

Seen 1 time(s).

## Cause

Bank rejected the transfer: RPC error -32010: account closed

## Effects undone

1 of 1 compensations succeeded.

## Related

- [Pay claimant: validation error](/failure-patterns/motor-claim-settlement-pay-claimant-validation-error-bank-rejected-the-transfer-rpc-error-n-account-closed.md)
