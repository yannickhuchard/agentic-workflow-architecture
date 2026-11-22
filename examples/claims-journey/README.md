# Motor claim journey

Six customers make a motor claim. Each lives through up to three workflows, days apart, with waiting in between. This example shows the layer that holds those workflows together: a **journey** (specification section 19), driven by **business events** (section 18).

| File | What it is |
|---|---|
| `motor-claim.journey.json` | The journey: three stages, one trigger, two goals, one exit |
| `claim-intake.awa.json` | Registers the claim, asks for documents, waits up to 5 days for `documents.uploaded`, reminds once, then closes |
| `../claims-settlement/claims-settlement.awa.json` | Assesses, decides and pays (the example from section 14) |
| `customer-follow-up.awa.json` | Sends a survey, waits up to 14 days for `survey.answered`, thanks the customer or has a person call back |
| `make-journeys.mjs` | Plays six customers on a simulated clock |
| `journeys.json` | What happened: every journey event and every run's journal |
| `build-definitions.py` | Generates the three definitions above, so that identifiers stay consistent |

## The six stories

| Customer | What happens | Journey ends |
|---|---|---|
| J. Moreau | Documents next day; assessment needs a second attempt, the fraud service one retry; paid; rates 5 | completed, both goals reached |
| A. Okafor | A large claim no decision rule covers: a model routes it to an adjuster, who takes three days; paid; rates 2; a person calls back | completed, paid but not satisfied |
| L. Petit | Never sends documents: reminder after 5 days, closed after 10 | stalled in "Reported" |
| S. Lindqvist | Withdraws the claim while the workflow waits for documents | abandoned |
| R. Haddad | The bank rejects the payment; the reserved funds are released | stalled in "Assessed and settled", run failed and compensated |
| M. Castellano | Paid without trouble; never answers the survey | completed, satisfaction unknown |

## Run it

```bash
cd sdk/typescript && npm install && npm run build
```

```bash
node examples/claims-journey/make-journeys.mjs
```

No API key is needed: actors, tools and the model are scripted. The script also writes `tools/visualization/journey-sample.js`, the data behind the journey visualisation.

## How the two layers link

Every `journey.run_started` and `journey.run_ended` event carries a `run_id`. The run's journal carries the same id. That is the whole link: from a point in a customer's journey you reach every step, attempt, reasoning record and tool call of the run that served it.
