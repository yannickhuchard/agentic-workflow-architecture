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
  at: "2026-11-21T22:45:56.672Z"
sources:
  - id: run-7c4e3471
    resource: urn:awa:run:7c4e3471-2665-4706-b489-1dd3610ddb14
    title: Run 7c4e3471-2665-4706-b489-1dd3610ddb14, journal events 39
    last_modified: "2026-11-21T22:45:50.764Z"
    x-awa-event-seqs:
      - 39
  - id: run-ac863140
    resource: urn:awa:run:ac863140-d3ec-4a67-b34b-aaaafca20cd5
    title: Run ac863140-d3ec-4a67-b34b-aaaafca20cd5, journal events 39
    last_modified: "2026-11-21T22:45:56.672Z"
    x-awa-event-seqs:
      - 39
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
x-awa-created-at: "2026-11-21T22:45:50.764Z"
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
