# AWA conformance suite

Language-neutral test cases that define what it means to implement AWA. The rules they test are in [`docs/specification.md`](../../docs/specification.md); the case format is in its Appendix A.

| Folder | Contents |
|---|---|
| `documents/` | Documents that must be accepted or rejected, and at which validation stage |
| `execution/` | Workflows with scripted actors and the outcome an engine must produce |
| `expressions.json` | Condition expressions, the data they are evaluated against, and their results |
| `unary-tests.json` | Decision table entries, values, and whether each value satisfies the entry |

Each execution case is tagged with a conformance level. An implementation claims a level only if it passes every case at that level, and reports the cases it skips.

Levels: `document`, `core`, `decision`, `verified`, `recorded`, `resilient`, `contract`, `flow`, `events`. Cases at level `events` carry a `deliver` list: business events to deliver, or deadlines to let pass, once the run has settled.

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
