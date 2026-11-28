# Journeys, measures, views, recommendations and dossiers

What happens to a journey at run time, how its measures are computed, and how the views, recommendations and dossier present the record. The document fields are in `references/document-model.md`; the views are in `tools/visualization/README.md`; the dossier in `tools/dossier/README.md`.

## Contents

- A journey at run time
- Several journeys
- Measures
- The views
- View options
- Glossary
- Brand
- Recommendations
- Dossier

## A journey at run time

A journey is a small state machine over business events (section 19); it has no tokens. For every event a host accepts it does, in order (19.5):

1. For a subject already on a journey the event concerns: merge the event's `data` into the instance's data, record `journey.event_received`, then any inbound touchpoint and change of mood.
2. Deliver the event to the runs that wait for it.
3. Create an instance if a trigger with `starts_journey` says so.
4. Apply exits, then triggers (`enter_stage`, `start_workflow` with the event's data as input).
5. Evaluate goals and the current stage's `complete_when`.

When a run started for an instance settles, the host records `journey.run_ended`, takes in the events the run published, merges the run's data (or what `collect` lists) into the instance's data, and evaluates again. This is how one workflow moves a journey, wakes another workflow or starts another journey. A failed run marks its stage stalled; a journey never fails. An exit cancels the runs still under way.

The record of an instance: `journey.started`, `journey.event_received`, `journey.stage_entered`, `journey.stage_completed`, `journey.run_started`, `journey.run_ended` (each with the `run_id` that links to the run's journal), `journey.goal_reached`, `journey.touchpoint`, `journey.sentiment_changed` (with `basis` `measured` or `inferred`), `journey.stalled` (with the stage's `owner`), `journey.completed`, `journey.abandoned`.

An event concerns a journey when the journey names its type in a trigger, an exit, a touchpoint or a sentiment rule, or a workflow of the journey has an event node of that name. A host ignores an event `id` it has already accepted.

Mood is an estimate, never a fact: `measured` when a rule reads a value the subject gave (`measure.path`, mapped from `measure.from` onto the scale), `inferred` when a rule moves it by `change`. A view must show which. With `carry_over`, a new journey begins with the mood the subject's last journey ended with.

## Several journeys

A subject lives through several journeys (buy, claim, renew). Journeys never nest or call each other: they share the subject key and business events, since the event that ends one often begins the next. `awa journey analytics` and `transitions()` report how subjects move between journeys.

## Measures

Section 21; `awa measures --list` prints the 56 measures with their rules. Every measure is `{ "value", "n" }`: a value over `n` things, `null` when there is nothing to compute from (never 0). Read `n` with every rate.

| Group | Measures |
|---|---|
| Journey | `journey.started`, `active`, `completion_rate`, `abandonment_rate`, `stall_rate`, `stalled_now`, `goal_attainment`, `duration_median_ms`, `duration_p90_ms`, `mood_end`, `mood_change`, `mood_measured_share`, `touchpoints_per_journey`, `runs_per_journey`, `cost_per_journey` |
| Stage | `stage.entered`, `conversion`, `duration_median_ms`, `breach_rate`, `active`, `stalled_now`, `abandoned` |
| Workflow | `workflow.runs`, `in_progress`, `success_rate`, `failure_rate`, `cancel_rate`, `first_pass_yield` (right first time), `lead_time_median_ms`, `lead_time_p90_ms`, `process_time_median_ms`, `flow_efficiency`, `event_wait_median_ms`, `event_timeout_rate`, `human_wait_median_ms`, `automation_rate`, `retries`, `dead_letters`, `compensations`, `tool_calls`, `decisions`, `sla_warnings`, `sla_breaches`, `tool_failure_rate`, `contract_pass_rate`, `verification_pass_rate`, `decision_default_rate`, `model_decision_share`, `input_tokens`, `output_tokens`, `cost`, `cost_per_run` |
| Activity | `activity.attempts`, `failure_rate`, `duration_median_ms`, `tokens` |

The report (`spec/json-schema/measure-report.schema.json`) has `journeys` (with goals, stages and their owners, touchpoints by channel and technology, artefacts by kind, mood), `workflows` (with activities, decisions by method, tools, failures by code), `totals`, `attention` (stalled instances, longest first, with the owner) and `series` (per day, week or month). Sources: `awa measures --dir .awa`, `awa measures --file portfolio.json`, `compute_measures(record)` in both SDKs, `GET /api/v1/measures` and `?format=openmetrics` (gauges named `awa_<id with underscores>`).

## The views

All in `tools/visualization`, single HTML files with no build step and no network; the SDK package carries them in `dist/views`, and `awa serve` serves them under `/views`.

| View | Opens |
|---|---|
| `replay.html` | One run: drop the workflow and its journal, or `?workflow=<url>&journal=<url>`, or `?run=http://localhost:3000/api/v1/workflows/runs/<run id>` live. Space plays, arrows step, a click on a node shows its contract, attempts and checks |
| `journey.html` | A portfolio (`awa journey export`, `GET /api/v1/journeys/portfolio`): "Open a record", a dropped file, `?data=<url>`, or `?live=http://localhost:3000` (`&poll=<ms>`). Heights: all journeys, one journey on calendar time, one customer's blueprint (mood, touchpoints, stages, workflows, technology, documents), one run step by step. The address carries the place (`#level/journey/customer/run/position`) |
| `dashboard.html` | The measures of the same record: who is stuck and whose it is, what became of the journeys, how the work went, over time. Every number opens the customers behind it. `awa measures --html measures.html` writes it as one file |
| `index.html` | A workflow definition in 2D or 3D |
| `live.html` | A running workflow, by polling a local demo server |

A page opened from the file system cannot fetch other files: serve the record, options and brand over HTTP from the same origin to use `?data=`, `?options=` and `?brand=`.

## View options

A JSON object given with `&options=<url>` (beside `?data=` or `?live=`), to `awa dossier --options`, and to the MCP server's `make_dossier`. `examples/electricity-onboarding/views/story-options.json` and `examples/life-insurance-savings/views/story-options.json` are complete.

| Option | Meaning |
|---|---|
| `subject_name` | Paths in an instance's data whose values name the customer: `["applicant.first_name", "applicant.last_name"]` |
| `layouts` | By workflow name, `{ "<node name>": [column, row] }`: a hand-made layout of the run view |
| `bands` | By workflow name, `[{ "row": 0, "label": "Checks" }]`: rows where each band of a long workflow starts |
| `glossary` | The journey's own terms: `[{ "id"?, "term", "definition", "see"?, "aliases"? }]` |
| `brand` | A DESIGN.md path relative to the options file, or a brand.json object |
| `recommendations` | `thresholds`, `materiality`, `reminders`, `wording`, `rules`, `replays` |
| `dossier` | `subject`, `lead`, `personas`, `say`, `facts`, `promise` |

## Glossary

The Glossary button (or `?`) in the journey view lists 60 AWA terms (`awa-glossary.js`), each in one sentence citing its section of the specification, plus the journey's own terms from the `glossary` option. `#glossary/<term id>` opens an entry. Option text is shown as text; `see` becomes a link only when it is an https address.

## Brand

The journey view, the replay and the measures page take a company's brand with `?brand=<url of a DESIGN.md or brand.json>`, or the `brand` option. DESIGN.md is Markdown with YAML design tokens; the views read `colors.primary` (at least), `on-primary`, `surface`, `on-surface`, `on-surface-variant`, the `surface-container` steps, `outline`, `light` and `dark` groups, a heading and a body font under `typography`, `rounded.md` and `rounded.lg`, `name`, and AWA's own `logo` and `logo_dark`. Write hex colours in quotes. A brand.json holds the same: `name`, `logo`, `logo_dark`, `mode` (`light`, `dark`, `auto`), `colors`, `typography` (`heading`, `body`), `rounded`. The views keep text at 4.5:1 and marks at 3:1, adjust a colour that fails and name it in the browser console, and keep the hue of state colours. `tools/visualization/brands/valoria-life.DESIGN.md` is a fictional brand to copy.

## Recommendations

The journey view's Recommendations tab (`#recommendations`) ranks what to change, computed by `awa-recommendations.js` from the record and the options, with no model and no clock. Twelve rules:

| Rule | Fires when (default threshold) |
|---|---|
| R1 | A stage's share of entries that stalled exceeds 10%, with at least 5 entries |
| R2 | The outcome contract hands at least 10% of runs to a person at an activity |
| R3 | The same guardrail blocks the same input again in one run (2 times) |
| R4 | The policy refuses a person at a task (once) |
| R5 | At least 10% of journeys need a reminder |
| R6 | Mood falls at a stage by 0.5 or more |
| R7 | One activity holds more than 50% of model tokens |
| R8 | At least 10% of customers leave at a stage |
| R9 | Right first time is under 80% |
| R10 | The longest silence towards the customer reaches 7 days |
| R11 | An awaited event never comes (once) |
| R12 | At least 25% of runs have a service level warning or breach |

Each recommendation has an owner (the stage's `owner`), the customers concerned, impact (customers concerned over journeys started, times severity), effort (1 to 3), priority (impact over effort) and how its effect is known: measured, replay, replay not run, estimate or pilot. The options' `recommendations` set `thresholds` (`{ "R1": 0.05, "R10": "P5D" }`), `materiality` (`{ "cost_per_journey": 1.0 }`), `reminders` (touchpoint ids), `wording` (the journey's own words per recommendation), `rules` (domain recommendations with a condition as data: `all` or `any` with a list of conditions, `not` with one, `{ "field": "data.outstanding_debt_eur", "gt": 1000 }`, `{ "measure": "stage.abandoned", "stage": "invitation", "gte": 1 }`) and `replays` (replay reports, or the path of `replays.json`). `node tools/visualization/recommendation-replay.mjs` measures, by counterfactual replay with recorded agents, the effect of the recommendations a replay can measure.

## Dossier

One document of a journey for a professional or a client: the customers' stories in their own voice (written from the record by templates, each sentence citing its journal records, no feeling the record does not state), the journey at a glance, the work of agents, people and systems, the analysis, the recommendations and a compliance appendix.

```bash
awa dossier --file examples/electricity-onboarding/journeys.json \
  --options examples/electricity-onboarding/views/story-options.json \
  --format html,pdf,docx --out dossier
awa dossier --file examples/life-insurance-savings/journeys.json \
  --options examples/life-insurance-savings/views/story-options.json \
  --edition client --customer ENR-26001 --format html --out lea
```

| Edition | Holds |
|---|---|
| `professional` (default) | Every customer, every measure with its count, internal cost and tokens, the agents' contracts, guardrails and refusals, every recommendation, the EU AI Act appendix |
| `client` | One customer's own story, times and stages; no other customer named; recommendations that concern them; a notice that the record exists and can be asked for |

HTML needs nothing else; PDF needs Playwright with Chromium (`npm install playwright && npx playwright install chromium`); DOCX draws its charts with Chromium when it is there. `--evidence <file>` adds an evidence report in JSON (`awa evidence <sources> --format json -o evidence.json`); `evidence/evidence-report.json` beside the record is read when present. The options' `dossier` sets `subject` (`["household", "households"]`), `lead`, `personas` (whose stories are told), `say` (a customer's words per touchpoint, with `{field}` values), `facts` and `promise` (a duration, or `false`). The journey view's **Export dossier** dialog makes the HTML edition in the browser; the MCP server's `make_dossier` returns it for a portfolio given inline.
