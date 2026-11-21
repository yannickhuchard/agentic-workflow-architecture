---
type: Lesson
title: Motor Claim Settlement fails at Pay claimant (VALIDATION_ERROR)
description: 'The run failed at "Pay claimant": Bank rejected the transfer: account closed'
resource: urn:awa:workflow:42ddec2f-18d0-5b06-837b-bf1e9c8cecdb:node:ec20a080-3057-5f9c-a694-7040111b09e7
tags:
  - run-failure
  - motor-claim-settlement
status: draft
generated:
  by: agent:awa-distiller
  at: "2026-11-21T22:45:56.672Z"
sources:
  - id: run-ac863140
    resource: urn:awa:run:ac863140-d3ec-4a67-b34b-aaaafca20cd5
    title: Run ac863140-d3ec-4a67-b34b-aaaafca20cd5, journal events 50, 52
    last_modified: "2026-11-21T22:45:56.672Z"
    x-awa-event-seqs:
      - 50
      - 52
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
  message: "Bank rejected the transfer: account closed"
x-awa-created-at: "2026-11-21T22:45:56.672Z"
---

# Motor Claim Settlement fails at Pay claimant (VALIDATION_ERROR)

Seen 1 time(s).

## Cause

Bank rejected the transfer: account closed

## Effects undone

1 of 1 compensations succeeded.

## Related

- [Pay claimant: validation error](/failure-patterns/motor-claim-settlement-pay-claimant-validation-error-bank-rejected-the-transfer-account-closed.md)
