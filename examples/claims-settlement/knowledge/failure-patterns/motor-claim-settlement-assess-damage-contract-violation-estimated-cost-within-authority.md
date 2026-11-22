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
  at: "2026-11-22T11:23:35.788Z"
verified:
  - by: human:claims-lead
    at: "2026-11-22T11:23:35.803Z"
sources:
  - id: run-1c5f2824
    resource: urn:awa:run:1c5f2824-ac15-4cf1-b6f6-385bb4201253
    title: Run 1c5f2824-ac15-4cf1-b6f6-385bb4201253, journal events 11, 10
    last_modified: "2026-11-22T11:23:22.990Z"
    x-awa-event-seqs:
      - 11
      - 10
  - id: run-f4b30187
    resource: urn:awa:run:f4b30187-6774-41d0-abf3-7f707e2a920a
    title: Run f4b30187-6774-41d0-abf3-7f707e2a920a, journal events 11, 10
    last_modified: "2026-11-22T11:23:29.066Z"
    x-awa-event-seqs:
      - 11
      - 10
  - id: run-191bdcc6
    resource: urn:awa:run:191bdcc6-80b8-4d3d-a855-fb1fbbbb1393
    title: Run 191bdcc6-80b8-4d3d-a855-fb1fbbbb1393, journal events 11, 10
    last_modified: "2026-11-22T11:23:35.788Z"
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
x-awa-created-at: "2026-11-22T11:23:22.990Z"
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
