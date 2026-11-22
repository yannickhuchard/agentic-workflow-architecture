---
type: Decision Precedent
title: "Settlement route: default routes to Adjuster review"
description: Inputs that matched default of "Settlement route" and were routed to "Adjuster review".
resource: urn:awa:workflow:42ddec2f-18d0-5b06-837b-bf1e9c8cecdb:node:1a533839-b043-5ff9-86e4-1bfe726fa52f
tags:
  - decision
  - motor-claim-settlement
status: draft
generated:
  by: agent:awa-distiller
  at: "2026-11-22T09:55:14.226Z"
sources:
  - id: run-148f2184
    resource: urn:awa:run:148f2184-e25a-495a-bcf3-97181d4cc29d
    title: Run 148f2184-e25a-495a-bcf3-97181d4cc29d, journal events 47
    last_modified: "2026-11-22T09:55:14.226Z"
    x-awa-event-seqs:
      - 47
x-awa-entry-type: decision_precedent
x-awa-observations: 1
x-awa-scope:
  workflow_id: 42ddec2f-18d0-5b06-837b-bf1e9c8cecdb
  workflow_name: Motor Claim Settlement
  node_id: 1a533839-b043-5ff9-86e4-1bfe726fa52f
  node_name: Settlement route
x-awa-counts:
  occurrences: 1
x-awa-latest:
  rule: null
  inputs:
    fraud_score: 0.45
    estimated_cost: 8200
  route: Adjuster review
x-awa-created-at: "2026-11-22T09:55:14.226Z"
---

# Settlement route: default routes to Adjuster review

Matched 1 time(s) across 1 run(s).

Most recent inputs:

```json
{
  "fraud_score": 0.45,
  "estimated_cost": 8200
}
```

Routed to **Adjuster review**.

## Related

- [Settlement route: rule 2 routes to Reserve funds](/decision-precedents/motor-claim-settlement-settlement-route-rule-2.md)
