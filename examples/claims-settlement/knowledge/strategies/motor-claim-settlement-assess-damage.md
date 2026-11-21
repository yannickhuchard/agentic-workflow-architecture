---
type: Strategy
title: How to assess damage
description: The approach whose outcome was accepted for "Assess damage".
resource: urn:awa:workflow:42ddec2f-18d0-5b06-837b-bf1e9c8cecdb:node:47a33422-41f7-57f0-b94a-503dcca1edc5
tags:
  - ai_agent
  - motor-claim-settlement
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
    title: Run 7c4e3471-2665-4706-b489-1dd3610ddb14, journal events 15, 18
    last_modified: "2026-11-21T22:45:50.764Z"
    x-awa-event-seqs:
      - 15
      - 18
  - id: run-ac863140
    resource: urn:awa:run:ac863140-d3ec-4a67-b34b-aaaafca20cd5
    title: Run ac863140-d3ec-4a67-b34b-aaaafca20cd5, journal events 15, 18
    last_modified: "2026-11-21T22:45:56.672Z"
    x-awa-event-seqs:
      - 15
      - 18
x-awa-entry-type: strategy
x-awa-observations: 2
x-awa-scope:
  workflow_id: 42ddec2f-18d0-5b06-837b-bf1e9c8cecdb
  workflow_name: Motor Claim Settlement
  node_id: 47a33422-41f7-57f0-b94a-503dcca1edc5
  node_name: Assess damage
x-awa-counts:
  accepted_runs: 2
  accepted_first_attempt: 0
  attempts: 4
x-awa-latest:
  plan:
    - Re-read the contract feedback
    - Price each part from the repair catalogue
    - Sum parts and labour
    - Return the cost as a number
  rationale: The first answer gave the cost as text. Itemising the parts gives a numeric total of 3,200 EUR and satisfies the schema.
  alternatives_considered:
    - "Repair rather than replace the tailgate: rejected, the crease runs through the lock housing"
  confidence: 0.86
  model: tier:reasoning
x-awa-created-at: "2026-11-21T22:45:50.764Z"
---

# How to assess damage

Across 2 run(s), the outcome of **Assess damage** was accepted 2 time(s), 0% of them on the first attempt (2.0 attempts on average).

## Approach that was accepted most recently

1. Re-read the contract feedback
2. Price each part from the repair catalogue
3. Sum parts and labour
4. Return the cost as a number

## Why it works

The first answer gave the cost as text. Itemising the parts gives a numeric total of 3,200 EUR and satisfies the schema.

## Approaches that were rejected

- Repair rather than replace the tailgate: rejected, the crease runs through the lock housing

Model reference used: `tier:reasoning`.

The approach is the actor's own account of its work, recorded with its output.

## Related

- [Assess damage: contract violation (/estimated_cost, Within authority)](/failure-patterns/motor-claim-settlement-assess-damage-contract-violation-estimated-cost-within-authority.md)
