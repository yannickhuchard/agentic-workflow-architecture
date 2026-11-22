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
  at: "2026-11-22T11:47:16.484Z"
sources:
  - id: run-ed673f09
    resource: urn:awa:run:ed673f09-082b-45a0-aa9b-a2a68db5cb50
    title: Run ed673f09-082b-45a0-aa9b-a2a68db5cb50, journal events 60, 62
    last_modified: "2026-11-22T11:47:03.573Z"
    x-awa-event-seqs:
      - 60
      - 62
  - id: run-e853a985
    resource: urn:awa:run:e853a985-771b-4cb3-b440-bfa3978ea3af
    title: Run e853a985-771b-4cb3-b440-bfa3978ea3af, journal events 65, 67
    last_modified: "2026-11-22T11:47:16.484Z"
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
x-awa-created-at: "2026-11-22T11:47:03.573Z"
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
