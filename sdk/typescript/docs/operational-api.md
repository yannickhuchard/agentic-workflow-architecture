# The HTTP interface

`awa serve` (TypeScript SDK 2.0) offers runs, business events, journeys, measures, human tasks and the views over HTTP. The machine-readable description is [`spec/openapi/awa-api.yaml`](../../../spec/openapi/awa-api.yaml); this page is the guide to it. The Python SDK's `awa serve` offers the same routes.

```bash
AWA_DATA_DIR=.awa awa serve --port 3000 --no-auth
```

`--no-auth` is for local development. Otherwise every route but `/health` needs an `x-api-key` header (`--api-key key:role`) or a bearer token signed with `--jwt-secret`. Roles are `admin`, `operator` and `viewer`. `--rate-limit` sets requests per minute.

## Workflow runs

| Route | What it does |
|---|---|
| `POST /api/v1/workflows/run` | Start a run of a workflow file. Body `{ "filePath": "orders.awa.json", "simulate": true }`. The file must be a `.json` inside `AWA_WORKFLOWS_DIR`. Answers `{ runId, status }` at once; the run goes on in the background |
| `GET /api/v1/workflows/runs/{runId}` | Its status and tokens |
| `GET /api/v1/workflows/runs/{runId}/workflow` | The workflow it runs |
| `GET /api/v1/workflows/runs/{runId}/events?after={seq}` | Its journal, from after a sequence number |
| `GET /api/v1/workflows/runs/{runId}/events/stream` | The journal as Server-Sent Events, as it is written: what `tools/visualization/replay.html?run=` follows |
| `POST /api/v1/workflows/events` | A business event (CloudEvents 1.0 JSON with `id` and `type`) for the runs waiting for one. Answers `{ event_id, resumed_runs }` |

```bash
curl -s -X POST localhost:3000/api/v1/workflows/run -H 'content-type: application/json' -d '{"filePath":"examples/claims-settlement/claims-settlement.awa.json","simulate":true}'
```

## Journeys

Kept in `AWA_DATA_DIR` when it is set, in memory otherwise. `AWA_SIMULATE=1` with `AWA_SIMULATED_OUTPUTS=<file>` simulates the activities of the journeys' runs.

| Route | What it does |
|---|---|
| `POST /api/v1/journeys/definitions` | Register a workflow or a journey document. A journey's workflows must be registered first |
| `GET /api/v1/journeys` | The journeys, each with its funnel |
| `POST /api/v1/journeys/events` | A business event `{ id?, type, source?, data }`. Answers what it did: `{ accepted, started_runs, resumed_runs, journeys }`. An id seen before is accepted once |
| `POST /api/v1/journeys/tick` | Let time pass, optionally to `{ "at": "<instant>" }`: deadlines, stalled stages, service levels |
| `POST /api/v1/journeys/runs/{run_id}/tokens/{token_id}/resume` | Complete a task a run waits on a person for; the body is what they decided |
| `GET /api/v1/journeys/instances?journey_id=&subject=&stalled=true` | Journey instances |
| `GET /api/v1/journeys/instances/{id}` | One instance with its record and the journals of its runs |
| `GET /api/v1/journeys/transitions` | How subjects move from one journey to the next |
| `GET /api/v1/journeys/portfolio` | Everything recorded: what the journey view and the measures page open |

```bash
curl -s -X POST localhost:3000/api/v1/journeys/events -H 'content-type: application/json' -d '{"type":"claim.submitted","data":{"customer_id":"c-1"}}'
```

## Measures

| Route | What it does |
|---|---|
| `GET /api/v1/measures?from=&to=&journey_id=&workflow_id=` | The measure report (specification section 21). Each measure is `{ value, n }`; `value` is null when there was nothing to compute it from |
| `GET /api/v1/measures?format=openmetrics` | The same in the OpenMetrics text format, for a metrics system to scrape |
| `GET /api/v1/measures/definitions` | Every measure with its unit and its rule |

## Human tasks

Kept in the task database (see "The task database" in the [SDK README](../README.md)).

| Route | What it does |
|---|---|
| `GET /api/v1/tasks?status=&assignee=&role_id=&workflow_id=` | Tasks |
| `GET /api/v1/tasks/pending?role_id=` | Tasks waiting for someone |
| `GET /api/v1/tasks/{id}` | One task |
| `POST /api/v1/tasks/{id}/assign` | `{ "user_id": "...", "assigner_id": "...", "assigner_type": "..." }` |
| `POST /api/v1/tasks/{id}/complete` | `{ "result": { ... } }`: what the person decided |
| `POST /api/v1/tasks/{id}/reject` | `{ "reason": "..." }` |
| `GET /api/v1/tasks/queue/stats` | Counts by status |

## Views and health

| Route | What it does |
|---|---|
| `GET /views/dashboard.html?live=http://localhost:3000` | The measures page, following this server |
| `GET /views/journey.html?live=http://localhost:3000` | The journey view, following this server |
| `GET /health` | `{ status: "ok" }`, without authentication |

The views come with the npm package; the Python server does not serve them, but they open its `/api/v1/journeys/portfolio` the same way.
