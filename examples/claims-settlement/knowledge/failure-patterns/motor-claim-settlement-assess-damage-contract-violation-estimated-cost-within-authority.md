---
type: Failure Pattern
title: "Assess damage: contract violation (/estimated_cost, Within authority)"
description: '"Assess damage" was rejected or raised: Outcome contract violated: /estimated_cost must be number; Within authority: "estimated_cost <= 50000" does not hold'
resource: urn:awa:workflow:42ddec2f-18d0-5b06-837b-bf1e9c8cecdb:node:47a33422-41f7-57f0-b94a-503dcca1edc5
tags:
  - ai_agent
  - motor-claim-settlement
  - contract_violation
status: stable
generated:
  by: agent:awa-distiller
  at: "2026-11-22T11:47:16.484Z"
verified:
  - by: human:claims-lead
    at: "2026-11-22T11:47:16.510Z"
sources:
  - id: run-ed673f09
    resource: urn:awa:run:ed673f09-082b-45a0-aa9b-a2a68db5cb50
    title: Run ed673f09-082b-45a0-aa9b-a2a68db5cb50, journal events 11, 10
    last_modified: "2026-11-22T11:47:03.573Z"
    x-awa-event-seqs:
      - 11
      - 10
  - id: run-c068c94e
    resource: urn:awa:run:c068c94e-ded1-4189-a248-2b1224d44ffc
    title: Run c068c94e-ded1-4189-a248-2b1224d44ffc, journal events 11, 10
    last_modified: "2026-11-22T11:47:09.658Z"
    x-awa-event-seqs:
      - 11
      - 10
  - id: run-e853a985
    resource: urn:awa:run:e853a985-771b-4cb3-b440-bfa3978ea3af
    title: Run e853a985-771b-4cb3-b440-bfa3978ea3af, journal events 11, 10
    last_modified: "2026-11-22T11:47:16.484Z"
    x-awa-event-seqs:
      - 11
      - 10
x-awa-entry-type: failure_pattern
x-awa-observations: 3
x-awa-scope:
  workflow_id: 42ddec2f-18d0-5b06-837b-bf1e9c8cecdb
  workflow_name: Motor Claim Settlement
  node_id: 47a33422-41f7-57f0-b94a-503dcca1edc5
  node_name: Assess damage
x-awa-counts:
  occurrences: 3
  resolved_by_retry_with_feedback: 3
x-awa-latest:
  code: CONTRACT_VIOLATION
  terms:
    - /estimated_cost
    - Within authority
  message: 'Outcome contract violated: /estimated_cost must be number; Within authority: "estimated_cost <= 50000" does not hold'
  feedback: |-
    CONTRACT VIOLATED. The outcome must satisfy every item below:
    - /estimated_cost must be number
    - Within authority: "estimated_cost <= 50000" does not hold
  resolution: retry_with_feedback
x-awa-created-at: "2026-11-22T11:47:03.573Z"
---

# Assess damage: contract violation (/estimated_cost, Within authority)

Seen 3 time(s) across 3 run(s) at **Assess damage**.

## What goes wrong

Outcome contract violated: /estimated_cost must be number; Within authority: "estimated_cost <= 50000" does not hold

Terms not met:

- /estimated_cost
- Within authority

## How it was resolved

- Re-executed with corrective feedback, then accepted: 3 time(s)

## Feedback that led to an accepted outcome

```
CONTRACT VIOLATED. The outcome must satisfy every item below:
- /estimated_cost must be number
- Within authority: "estimated_cost <= 50000" does not hold
```

## Related

- [How to assess damage](/strategies/motor-claim-settlement-assess-damage.md)
