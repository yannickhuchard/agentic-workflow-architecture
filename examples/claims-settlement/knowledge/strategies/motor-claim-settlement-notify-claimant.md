---
type: Strategy
title: How to notify claimant
description: The approach whose outcome was accepted for "Notify claimant".
resource: urn:awa:workflow:42ddec2f-18d0-5b06-837b-bf1e9c8cecdb:node:f7054c16-d7aa-58a0-9873-376d4f409b43
tags:
  - ai_agent
  - motor-claim-settlement
status: draft
generated:
  by: agent:awa-distiller
  at: "2026-11-21T22:45:50.764Z"
sources:
  - id: run-7c4e3471
    resource: urn:awa:run:7c4e3471-2665-4706-b489-1dd3610ddb14
    title: Run 7c4e3471-2665-4706-b489-1dd3610ddb14, journal events 52, 54
    last_modified: "2026-11-21T22:45:50.764Z"
    x-awa-event-seqs:
      - 52
      - 54
x-awa-entry-type: strategy
x-awa-observations: 1
x-awa-scope:
  workflow_id: 42ddec2f-18d0-5b06-837b-bf1e9c8cecdb
  workflow_name: Motor Claim Settlement
  node_id: f7054c16-d7aa-58a0-9873-376d4f409b43
  node_name: Notify claimant
x-awa-counts:
  accepted_runs: 1
  accepted_first_attempt: 1
  attempts: 1
x-awa-latest:
  plan:
    - State the outcome
    - State the amount
    - Keep it short
  rationale: A settlement notice should lead with the result.
  confidence: 0.95
  model: tier:balanced
x-awa-created-at: "2026-11-21T22:45:50.764Z"
---

# How to notify claimant

Across 1 run(s), the outcome of **Notify claimant** was accepted 1 time(s), 100% of them on the first attempt (1.0 attempts on average).

## Approach that was accepted most recently

1. State the outcome
2. State the amount
3. Keep it short

## Why it works

A settlement notice should lead with the result.

Model reference used: `tier:balanced`.

The approach is the actor's own account of its work, recorded with its output.
