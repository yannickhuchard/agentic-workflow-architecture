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
  at: "2026-11-21T23:07:17.510Z"
sources:
  - id: run-a49c556e
    resource: urn:awa:run:a49c556e-fd4b-4da5-9fcb-569a922e0859
    title: Run a49c556e-fd4b-4da5-9fcb-569a922e0859, journal events 58, 60
    last_modified: "2026-11-21T23:07:17.510Z"
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
x-awa-created-at: "2026-11-21T23:07:17.510Z"
---

# Motor Claim Settlement fails at Pay claimant (VALIDATION_ERROR)

Seen 1 time(s).

## Cause

Bank rejected the transfer: RPC error -32010: account closed

## Effects undone

1 of 1 compensations succeeded.

## Related

- [Pay claimant: validation error](/failure-patterns/motor-claim-settlement-pay-claimant-validation-error-bank-rejected-the-transfer-rpc-error-n-account-closed.md)
