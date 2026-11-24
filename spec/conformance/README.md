# AWA conformance suite

Language-neutral test cases that define what it means to implement AWA. The rules they test are in [`docs/specification.md`](../../docs/specification.md); the case format is in its Appendix A.

| Folder | Contents |
|---|---|
| `documents/` | Documents that must be accepted or rejected, and at which validation stage |
| `execution/` | Workflows with scripted actors and the outcome an engine must produce |
| `journeys/` | Journeys with their workflows, the events a host is given step by step, and what the journeys must then record |
| `replay/` | A recorded run, a change, and what a counterfactual replay must report |
| `knowledge/` | Scripted runs, the ingestion of their journals and reviews, and what the knowledge base must then hold and give to actors |
| `measures/` | A record of journeys and runs, and the measures that follow from it (section 21) |
| `interchange/` | BPMN and DMN documents and the AWA documents they import to, documents an importer must refuse, workflows that must survive a round trip through BPMN, and a Serverless Workflow export (section 27) |
| `feel.json` | FEEL unary tests and conditions, and the AWA entries and conditions they translate to and from (27.10) |
| `expressions.json` | Condition expressions, the data they are evaluated against, and their results |
| `unary-tests.json` | Decision table entries, values, and whether each value satisfies the entry |

Each execution case is tagged with a conformance level. An implementation claims a level only if it passes every case at that level, and reports the cases it skips.

Levels: `document`, `core`, `decision`, `verified`, `recorded`, `resilient`, `contract`, `routing`, `flow`, `knowledge`, `events`, `model_decision`, `tools`, `journeys`, `measures`, `contexts`, `service_levels`, `replay`, `interchange`. Cases at level `events` carry a `deliver` list: business events to deliver, or deadlines to let pass, once the run has settled. Cases at level `routing` are execution cases whose scripted `model` lists several providers and the tier map; cases at level `knowledge` are in `knowledge/`; cases at level `interchange` are in `interchange/`, each with a `kind` (`import_bpmn`, `import_dmn`, `round_trip`, `export_serverless_workflow`) described in Appendix A, and `generate.py` writes them from `interchange_cases.py`.

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
