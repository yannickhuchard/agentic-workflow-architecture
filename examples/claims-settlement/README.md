# Motor claim settlement

One workflow that exercises most of AWA 1.1, with two recorded runs, the documents derived from them, and the knowledge they produced.

| File | What it is |
|---|---|
| `claims-settlement.awa.json` | The workflow definition |
| `runs/completed.journal.jsonl` | Journal of a run that settles the claim |
| `runs/failed-and-compensated.journal.jsonl` | Journal of a run whose payment fails; the reserved funds are released |
| `runs/model-decision.journal.jsonl` | Journal of a run no table rule covers, so a model decides the route |
| `RECIPE.md` | Recipe compiled from the completed run |
| `runs/failed-and-compensated.recipe.md` | Recipe compiled from the failed run |
| `knowledge/` | Knowledge distilled from both runs, as an Open Knowledge Format bundle |
| `telemetry/*.otlp.json` | Each run as OpenTelemetry traces (OTLP/JSON, specification section 26): the same trace and span ids in both SDKs |
| `make-runs.mjs` | Regenerates all of the above |
| `simulation.json` | What each activity returns when the workflow is run with `--simulate` |
| `evidence/` | A worked example of an evidence report (specification section 32): three claims under a deployment with an authorization policy and guardrails, their journals, and the report as JSON, Markdown and HTML; `evidence/README.md` says how to make it again |

## What the workflow shows

| Feature | Where |
|---|---|
| Outcome contract with schema, postcondition, budgets and escalation | Assess damage |
| An agent corrected by contract feedback | Assess damage: attempt 1 returns the cost as text and is rejected; attempt 2 is accepted |
| Retry with backoff after an error | Check fraud signals: attempt 1 times out |
| Parallel split and synchronising join | Assess damage → Check fraud signals and Verify policy cover → Consolidate findings |
| Decision table, then a model for what the table does not cover | Settlement route |
| Tools, each call journalled with its link | `price_part` and `get_policy` (HTTP), `transfer` (JSON-RPC) |
| Timer event | Bank cut-off |
| Compensation | Reserve funds is undone by Release funds when Pay claimant fails |
| Model tiers | The roles name `tier:reasoning`, `tier:fast` and `tier:balanced` |

## See it

Open `tools/visualization/replay.html` in a browser and choose a sample run. The three runs of this example are built in.

## Run it yourself

```bash
awa run claims-settlement.awa.json --simulate --outputs simulation.json --journal my-run.journal.jsonl
```

## Regenerate

The actors are scripted, so no API key is needed.

```bash
cd sdk/typescript && npm install && npm run build
```

```bash
node examples/claims-settlement/make-runs.mjs
```

Or step by step with the CLI, from a journal you already have:

```bash
awa recipe claims-settlement.awa.json runs/completed.journal.jsonl -o RECIPE.md
```

```bash
awa knowledge ingest claims-settlement.awa.json runs/*.jsonl --kb knowledge.json
```

```bash
awa telemetry export claims-settlement.awa.json runs/completed.journal.jsonl --file telemetry/completed.otlp.json
```

Or send a run to an OpenTelemetry collector or backend, and see its model calls, tool calls, retries and the decision as spans:

```bash
awa telemetry export claims-settlement.awa.json runs/failed-and-compensated.journal.jsonl --endpoint http://localhost:4318
```

```bash
awa knowledge review all --by claims-lead --kb knowledge.json
```

```bash
awa knowledge export knowledge --kb knowledge.json
```
