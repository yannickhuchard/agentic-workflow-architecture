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
  at: "2026-11-21T22:45:56.672Z"
verified:
  - by: human:claims-lead
    at: "2026-11-21T22:45:56.688Z"
sources:
  - id: run-7c4e3471
    resource: urn:awa:run:7c4e3471-2665-4706-b489-1dd3610ddb14
    title: Run 7c4e3471-2665-4706-b489-1dd3610ddb14, journal events 11, 10
    last_modified: "2026-11-21T22:45:50.764Z"
    x-awa-event-seqs:
      - 11
      - 10
  - id: run-ac863140
    resource: urn:awa:run:ac863140-d3ec-4a67-b34b-aaaafca20cd5
    title: Run ac863140-d3ec-4a67-b34b-aaaafca20cd5, journal events 11, 10
    last_modified: "2026-11-21T22:45:56.672Z"
    x-awa-event-seqs:
      - 11
      - 10
x-awa-entry-type: failure_pattern
x-awa-observations: 2
x-awa-scope:
  workflow_id: 42ddec2f-18d0-5b06-837b-bf1e9c8cecdb
  workflow_name: Motor Claim Settlement
  node_id: 47a33422-41f7-57f0-b94a-503dcca1edc5
  node_name: Assess damage
x-awa-counts:
  occurrences: 2
  resolved_by_retry_with_feedback: 2
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
x-awa-created-at: "2026-11-21T22:45:50.764Z"
---

# Assess damage: contract violation (/estimated_cost, Within authority)

Seen 2 time(s) across 2 run(s) at **Assess damage**.

## What goes wrong

Outcome contract violated: /estimated_cost must be number; Within authority: "estimated_cost <= 50000" does not hold

Terms not met:

- /estimated_cost
- Within authority

## How it was resolved

- Re-executed with corrective feedback, then accepted: 2 time(s)

## Feedback that led to an accepted outcome

```
CONTRACT VIOLATED. The outcome must satisfy every item below:
- /estimated_cost must be number
- Within authority: "estimated_cost <= 50000" does not hold
```

## Related

- [How to assess damage](/strategies/motor-claim-settlement-assess-damage.md)
