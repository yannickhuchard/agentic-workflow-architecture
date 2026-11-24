# AWA conformance suite

Language-neutral test cases that define what it means to implement AWA. The rules they test are in [`docs/specification.md`](../../docs/specification.md); the case format is in its Appendix A.

| Folder | Contents |
|---|---|
| `documents/` | Documents that must be accepted or rejected, and at which validation stage |
| `execution/` | Workflows with scripted actors and the outcome an engine must produce |
| `journeys/` | Journeys with their workflows, the events a host is given step by step, and what the journeys must then record |
| `shared-store/` | Journeys played by several hosts on one store (section 29): which host takes which event, which events arrive at the same moment, when a host stops, and what the store must then hold |
| `replay/` | A recorded run, a change, and what a counterfactual replay must report |
| `knowledge/` | Scripted runs, the ingestion of their journals and reviews, and what the knowledge base must then hold and give to actors |
| `measures/` | A record of journeys and runs, and the measures that follow from it (section 21) |
| `expressions.json` | Condition expressions, the data they are evaluated against, and their results |
| `unary-tests.json` | Decision table entries, values, and whether each value satisfies the entry |

Each execution case is tagged with a conformance level. An implementation claims a level only if it passes every case at that level, and reports the cases it skips.

Levels: `document`, `core`, `decision`, `verified`, `recorded`, `resilient`, `contract`, `routing`, `flow`, `knowledge`, `events`, `model_decision`, `tools`, `journeys`, `measures`, `contexts`, `service_levels`, `replay`, `shared_store`. Cases at level `events` carry a `deliver` list: business events to deliver, or deadlines to let pass, once the run has settled. Cases at level `routing` are execution cases whose scripted `model` lists several providers and the tier map; cases at level `knowledge` are in `knowledge/`.

Cases at level `shared_store` are in `shared-store/`. They are journey cases with `hosts`: each step names the host that performs it, `together` performs several hosts' steps at the same moment, `stop` and `start` stop and start a host, and `stops_before_keeping` stops a host in the middle of an operation, its work done and not yet kept. They need a store several hosts share: the runners start a throwaway PostgreSQL (or use the server `AWA_TEST_POSTGRES_URL` names) and report the cases skipped, with the reason, where PostgreSQL is not installed.

## Running

```bash
cd sdk/typescript && npx vitest run tests/conformance.test.ts
```

```bash
cd sdk/python && pytest tests/test_conformance.py -rs
```

## Adding a case

Cases are generated so that identifiers stay consistent. Add the case to `generate.py`, then run:

```bash
python3 spec/conformance/generate.py
```

CI fails if the committed JSON differs from what the generator produces.

## Implementing AWA in another language

Write a runner that, for each execution case: loads `workflow`, replaces every actor with one that returns what `actors` scripts for that activity name, starts a run with `input`, and compares the result with `expect`. Around 80 lines; the two existing runners are the reference.
