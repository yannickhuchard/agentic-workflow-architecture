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
  at: "2026-11-22T09:55:14.226Z"
verified:
  - by: human:claims-lead
    at: "2026-11-22T09:55:14.247Z"
sources:
  - id: run-2cf36b19
    resource: urn:awa:run:2cf36b19-3139-447a-bf48-2dc43b243516
    title: Run 2cf36b19-3139-447a-bf48-2dc43b243516, journal events 11, 10
    last_modified: "2026-11-22T09:55:01.394Z"
    x-awa-event-seqs:
      - 11
      - 10
  - id: run-3c8b8cc4
    resource: urn:awa:run:3c8b8cc4-0f7f-4944-8761-324d412b3e1c
    title: Run 3c8b8cc4-0f7f-4944-8761-324d412b3e1c, journal events 11, 10
    last_modified: "2026-11-22T09:55:07.459Z"
    x-awa-event-seqs:
      - 11
      - 10
  - id: run-148f2184
    resource: urn:awa:run:148f2184-e25a-495a-bcf3-97181d4cc29d
    title: Run 148f2184-e25a-495a-bcf3-97181d4cc29d, journal events 11, 10
    last_modified: "2026-11-22T09:55:14.226Z"
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
x-awa-created-at: "2026-11-22T09:55:01.394Z"
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
