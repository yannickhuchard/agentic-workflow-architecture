# The examples, and what to copy from each

All in `examples/` of the repository. Every `.awa.json` file there passes `awa validate`. The four below are maintained with the specification; start from them. Each runs without a model, an API key or an external system: its actors, tools and models are scripted.

## Contents

- Pick an example by what you need
- claims-settlement
- claims-journey
- electricity-onboarding
- life-insurance-savings
- Older examples

## Pick an example by what you need

| You need | Copy from |
|---|---|
| A first workflow with every core feature | `claims-settlement/claims-settlement.awa.json` |
| An outcome contract with schema, postcondition, budgets and escalation | claims-settlement, activity Assess damage |
| A decision table backed by a model decision | claims-settlement, Settlement route |
| Parallel split and join, a timer, compensation | claims-settlement: Check fraud signals and Verify policy cover, Bank cut-off, Release funds |
| Tools over HTTP and JSON-RPC | claims-settlement (`price_part`, `get_policy`, `transfer`); electricity-onboarding (15 integration points in `INTEGRATION.md`) |
| Waits for business events with deadlines and reminders | `claims-journey/policy-purchase.awa.json`, `claims-journey/claim-intake.awa.json` |
| Several journeys of one customer, touchpoints, artefacts, mood | `claims-journey/*.journey.json` |
| A sub-workflow with input and output mapping | `electricity-onboarding/grid-export-registration.awa.json` called by Register grid export; life-insurance-savings, Run identity and AML checks |
| Contexts read only by the agents that need them | electricity-onboarding (`customer_profile`), life-insurance-savings (`employee_profile`) |
| Guardrails in the document and in the deployment | electricity-onboarding, life-insurance-savings (`deployment.json`) |
| A deployment with principals, policy, separation of duties and four eyes | `electricity-onboarding/deployment.json`, `life-insurance-savings/deployment.json` |
| Service levels on the run and on an activity | electricity-onboarding (onboarding: target 21 days, at most 35) |
| Decision tables with `collect`, ranges, `ends with`, `matches` | life-insurance-savings (Deduction rules, After the contribution) |
| Cancellation within a cooling-off period, with compensation | life-insurance-savings (a cancel within 30 days) |
| View options: names, layouts, bands, glossary, brand, recommendations, dossier | `electricity-onboarding/views/story-options.json`, `life-insurance-savings/views/story-options.json` |
| An evidence report | `claims-settlement/evidence`, and `evidence/` in both reference examples |
| BPMN and DMN exports | `bpmn/` in both reference examples |
| Recorded runs, a recipe, a knowledge bundle, telemetry | `claims-settlement/runs`, `RECIPE.md`, `knowledge/`, `telemetry/` |

## claims-settlement

One motor claim workflow that exercises most of AWA 1.1, with three recorded runs (completed, failed and compensated, decided by a model), the recipe, the knowledge distilled from the runs, their telemetry, and an evidence report of three claims under a policy and guardrails.

```bash
awa run examples/claims-settlement/claims-settlement.awa.json --simulate --outputs examples/claims-settlement/simulation.json --journal run.journal.jsonl
node examples/claims-settlement/make-runs.mjs          # writes the runs, recipe, knowledge and telemetry again
```

Its runs are built into `tools/visualization/replay.html`.

## claims-journey

Six customers buy a motor policy, claim and renew: three journeys (`policy-purchase`, `motor-claim`, `policy-renewal`) over five workflows, claims-settlement included. Shows triggers, goals, exits, touchpoints with channel and technology, what changes hands, mood across journeys, a withdrawn claim whose waiting run is cancelled, and a stalled stage. Validate `motor-claim.journey.json` with `claims-journey/*.awa.json` and `../claims-settlement/claims-settlement.awa.json` beside it. `node examples/claims-journey/make-journeys.mjs` writes `journeys.json`, which `tools/visualization/journey.html` shows by default.

## electricity-onboarding

A reference process a utility can take off the shelf: a household's onboarding by an electricity supplier, from the web form to an active supply. Two workflows (`electricity-onboarding.awa.json`, `grid-export-registration.awa.json`), the journey `new-customer-onboarding.journey.json`, `deployment.json`, reference adapters (`adapters/mock-server.mjs`, port 4545), eight scenarios (`scenarios/*.json`) played by `scenarios/play.mjs`, the dossier and the recommendations with their replays.

```bash
cd examples/electricity-onboarding
awa journey add electricity-onboarding.awa.json grid-export-registration.awa.json new-customer-onboarding.journey.json
awa journey publish onboarding.requested --simulate --outputs simulation.json -d '{"application_id": "APP-24001"}'
awa journey show APP-24001
```

From the repository root, `node examples/electricity-onboarding/demo/live.mjs` runs a live demonstration in about 70 seconds, followed by the journey view, the measures page and the run replay.

`INTEGRATION.md` documents every integration point; "Taking it into production" in its README says what to replace.

## life-insurance-savings

The second reference process: a year of workplace pension savings with a fictional Luxembourg life insurer (Valoria Life), from the HR portal's invitation to the tax certificate and the annual review. Seven workflows and one journey of nine stages, advice by an AI adviser and licensed advisers, due diligence with four eyes, a right to cancel with compensation, the Art. 111bis LIR deduction as a decision table, eight scenarios, the adapters on port 4560, a client dossier under the Valoria Life brand. Everything is fictional and is not tax or legal advice; `FACTS.md` gives each rule's source.

```bash
cd examples/life-insurance-savings
awa journey add *.awa.json workplace-pension-savings.journey.json
awa journey publish savings.invited --simulate --outputs simulation.json -d '{"enrolment_id": "ENR-26001", "plan_id": "KES-PENSION-111BIS", "tax_residence": "LU"}'
awa journey show ENR-26001
```

## Older examples

`customer-support-ai`, `flying-cars-insurance`, `insurance-claims-management`, `order-processing`, `paid-newsletter-funnel`, `retail-distribution` and `skills-demonstration` validate and illustrate skills, tool requirements and access rights; they use fewer of the 1.1 features. The `visualization-*` folders and `bank-account-opening` hold diagram configurations for `tools/visualization/index.html`.
