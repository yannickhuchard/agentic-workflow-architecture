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
| `evidence/` | A record of journeys and runs, and the statements an evidence report must make about it, with their exact citations (section 32) |
| `evaluation/` | Journals and the evaluation dataset built from them; a dataset, a scripted candidate and the scores that follow (section 33) |
| `expressions.json` | Condition expressions, the data they are evaluated against, and their results |
| `unary-tests.json` | Decision table entries, values, and whether each value satisfies the entry |

Each execution case is tagged with a conformance level. An implementation claims a level only if it passes every case at that level, and reports the cases it skips.

Levels: `document`, `core`, `decision`, `verified`, `recorded`, `resilient`, `contract`, `routing`, `flow`, `knowledge`, `events`, `model_decision`, `tools`, `journeys`, `measures`, `contexts`, `service_levels`, `replay`, `a2a`, `evidence`, `evaluation`. Cases at level `events` carry a `deliver` list: business events to deliver, or deadlines to let pass, once the run has settled. Cases at level `routing` are execution cases whose scripted `model` lists several providers and the tier map; cases at level `knowledge` are in `knowledge/`, at level `evidence` in `evidence/` and at level `evaluation` in `evaluation/`. Shadow runs (section 33.5) have no cases: they are fixed by unit tests in both SDKs.

Cases at level `a2a` (section 28) are execution cases with scripted agents. `agents` maps the URL of each agent card to the `card` and the `replies` of that agent. The runner stands in for every agent: a `GET` of a card's URL answers with the card, and each JSON-RPC request to the interface URL the card names takes the agent's next reply, the last repeating; a reply is `{"result": ...}` or `{"error": ...}`, sent as the JSON-RPC response to that request. Any other address cannot be reached. The step `{"agent_input": <object or text>}` in `deliver` gives that input to every token waiting for an agent's input. `expect.agent_card_reads` is how many times cards were read, `expect.agent_requests` the JSON-RPC methods of every request to an agent in order, and `expect.agent_requests_contain` partial requests (`agent`, `method`, `params`) some request must contain. The MCP and gRPC executors (17.7, 17.8) have no cases: each needs a live server, and the SDKs' tests start one.

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
