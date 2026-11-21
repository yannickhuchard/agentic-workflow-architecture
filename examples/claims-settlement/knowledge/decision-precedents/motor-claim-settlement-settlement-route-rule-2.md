---
type: Decision Precedent
title: "Settlement route: rule 2 routes to Reserve funds"
description: Inputs that matched rule 2 of "Settlement route" and were routed to "Reserve funds".
resource: urn:awa:workflow:42ddec2f-18d0-5b06-837b-bf1e9c8cecdb:node:1a533839-b043-5ff9-86e4-1bfe726fa52f
tags:
  - decision
  - motor-claim-settlement
status: draft
generated:
  by: agent:awa-distiller
  at: "2026-11-21T23:07:17.510Z"
sources:
  - id: run-5bdc86c3
    resource: urn:awa:run:5bdc86c3-9735-40a4-865b-6a71c26fecc2
    title: Run 5bdc86c3-9735-40a4-865b-6a71c26fecc2, journal events 45
    last_modified: "2026-11-21T23:07:11.460Z"
    x-awa-event-seqs:
      - 45
  - id: run-a49c556e
    resource: urn:awa:run:a49c556e-fd4b-4da5-9fcb-569a922e0859
    title: Run a49c556e-fd4b-4da5-9fcb-569a922e0859, journal events 45
    last_modified: "2026-11-21T23:07:17.510Z"
    x-awa-event-seqs:
      - 45
x-awa-entry-type: decision_precedent
x-awa-observations: 2
x-awa-scope:
  workflow_id: 42ddec2f-18d0-5b06-837b-bf1e9c8cecdb
  workflow_name: Motor Claim Settlement
  node_id: 1a533839-b043-5ff9-86e4-1bfe726fa52f
  node_name: Settlement route
x-awa-counts:
  occurrences: 2
x-awa-latest:
  rule: 2
  input_entries:
    - < 0.3
    - < 5000
  inputs:
    fraud_score: 0.12
    estimated_cost: 3200
  route: Reserve funds
x-awa-created-at: "2026-11-21T23:07:11.460Z"
---

# Settlement route: rule 2 routes to Reserve funds

Matched 2 time(s) across 2 run(s).

Rule entries: `< 0.3`, `< 5000`.

Most recent inputs:

```json
{
  "fraud_score": 0.12,
  "estimated_cost": 3200
}
```

Routed to **Reserve funds**.

## Related

- [Settlement route: default routes to Adjuster review](/decision-precedents/motor-claim-settlement-settlement-route-default.md)
