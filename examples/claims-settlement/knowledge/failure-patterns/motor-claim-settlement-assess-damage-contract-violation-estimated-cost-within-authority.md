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
  at: "2026-11-21T23:07:24.294Z"
verified:
  - by: human:claims-lead
    at: "2026-11-21T23:07:24.342Z"
sources:
  - id: run-5bdc86c3
    resource: urn:awa:run:5bdc86c3-9735-40a4-865b-6a71c26fecc2
    title: Run 5bdc86c3-9735-40a4-865b-6a71c26fecc2, journal events 11, 10
    last_modified: "2026-11-21T23:07:11.460Z"
    x-awa-event-seqs:
      - 11
      - 10
  - id: run-a49c556e
    resource: urn:awa:run:a49c556e-fd4b-4da5-9fcb-569a922e0859
    title: Run a49c556e-fd4b-4da5-9fcb-569a922e0859, journal events 11, 10
    last_modified: "2026-11-21T23:07:17.510Z"
    x-awa-event-seqs:
      - 11
      - 10
  - id: run-a56272e2
    resource: urn:awa:run:a56272e2-d388-466a-9a7c-ea26e04c035d
    title: Run a56272e2-d388-466a-9a7c-ea26e04c035d, journal events 11, 10
    last_modified: "2026-11-21T23:07:24.294Z"
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
x-awa-created-at: "2026-11-21T23:07:11.460Z"
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
