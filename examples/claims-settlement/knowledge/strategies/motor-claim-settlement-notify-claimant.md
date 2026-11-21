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
  at: "2026-11-21T23:07:24.294Z"
sources:
  - id: run-5bdc86c3
    resource: urn:awa:run:5bdc86c3-9735-40a4-865b-6a71c26fecc2
    title: Run 5bdc86c3-9735-40a4-865b-6a71c26fecc2, journal events 60, 62
    last_modified: "2026-11-21T23:07:11.460Z"
    x-awa-event-seqs:
      - 60
      - 62
  - id: run-a56272e2
    resource: urn:awa:run:a56272e2-d388-466a-9a7c-ea26e04c035d
    title: Run a56272e2-d388-466a-9a7c-ea26e04c035d, journal events 65, 67
    last_modified: "2026-11-21T23:07:24.294Z"
    x-awa-event-seqs:
      - 65
      - 67
x-awa-entry-type: strategy
x-awa-observations: 2
x-awa-scope:
  workflow_id: 42ddec2f-18d0-5b06-837b-bf1e9c8cecdb
  workflow_name: Motor Claim Settlement
  node_id: f7054c16-d7aa-58a0-9873-376d4f409b43
  node_name: Notify claimant
x-awa-counts:
  accepted_runs: 2
  accepted_first_attempt: 2
  attempts: 2
x-awa-latest:
  plan:
    - State the outcome
    - State the amount
    - Keep it short
  rationale: A settlement notice should lead with the result.
  confidence: 0.95
  model: tier:balanced
x-awa-created-at: "2026-11-21T23:07:11.460Z"
---

# How to notify claimant

Across 2 run(s), the outcome of **Notify claimant** was accepted 2 time(s), 100% of them on the first attempt (1.0 attempts on average).

## Approach that was accepted most recently

1. State the outcome
2. State the amount
3. Keep it short

## Why it works

A settlement notice should lead with the result.

Model reference used: `tier:balanced`.

The approach is the actor's own account of its work, recorded with its output.
