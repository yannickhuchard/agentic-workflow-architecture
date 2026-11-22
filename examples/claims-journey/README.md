# A customer's year: purchase, claim, renewal

Six customers buy a motor policy, make a claim on it and come up for renewal. Each of the three is a **journey** (specification section 19), served by workflows, driven by **business events** (section 18). The example shows what a journey records beyond its stages: **touchpoints** with their channel and technology, **what changes hands** (contract, attestation, invoice, receipt, certificate), an estimate of the customer's **mood**, and how customers move **from one journey to the next**.

Open [`tools/visualization/journey.html`](../../tools/visualization/journey.html) to see it.

| File | What it is |
|---|---|
| `policy-purchase.journey.json`, `motor-claim.journey.json`, `policy-renewal.journey.json` | The three journeys: stages, triggers, goals, exits, artefacts, touchpoints, mood rules |
| `policy-purchase.awa.json` | Quote, contract signature, first premium, certificate. Three waits, each with a deadline |
| `claim-intake.awa.json` | Registers the claim, asks for documents, waits, reminds once, then closes |
| `../claims-settlement/claims-settlement.awa.json` | Assesses, decides and pays |
| `customer-follow-up.awa.json` | Survey, then thanks or a call back |
| `policy-renewal.awa.json` | Sets the terms by decision table, offers, waits, reminds, then renews or lets the policy lapse |
| `make-journeys.mjs` | Plays the six customers on a simulated clock and writes `journeys.json`: every journey record and every run's journal |
| `make-story.mjs` | Turns `journeys.json` into `story.json`: each journey as beats in causal order with one plain sentence each, each run condensed into steps, and a layout per workflow |
| `persona-walkthrough.mjs` | Walks the journey view as each kind of reader would and reports whether their question can be answered (needs Playwright) |
| `build-definitions.py` | Generates the definitions, so that identifiers stay consistent |

## The six customers

| Customer | Temperament | Purchase | Claim | Renewal |
|---|---|---|---|---|
| J. Moreau | Organised; answers the same day | covered in a day | paid in a day, rates 5 | renews in two days |
| A. Okafor | Needs the car for work | covered in two hours | no rule covers the claim, a model sends it to an adjuster, who takes three days; rates 2 | given a goodwill discount; lets the policy lapse |
| L. Petit | Not at ease online | four days to sign | never uploads documents; stalled | pays after the last reminder |
| S. Lindqvist | Compares everything | pays three days late | withdraws; the waiting run is cancelled | renews next day |
| R. Haddad | Does not chase | covered in a day | the bank rejects the payment, the reserve is released; stalled | calls to cancel |
| M. Castellano | Decides slowly | accepts on day 6 of 7 | paid; never answers the survey | renews after ten days |

A. Okafor is the reason to look at more than one journey at a time. The claim journey completed and the claim was paid. What the wait cost shows up in another journey, five months later.

## Run it

```bash
cd sdk/typescript && npm install && npm run build
```

```bash
node examples/claims-journey/make-journeys.mjs
```

```bash
node examples/claims-journey/make-story.mjs
```

No API key is needed: actors, tools and the model are scripted.

## How the layers link

- Journey to run: every `journey.run_started`, `journey.run_ended` and run-made `journey.touchpoint` carries a `run_id`; the run's journal carries the same id.
- Journey to journey: the same `customer_id`, and business events. `claim.submitted` begins a claim; a workflow that announces `policy.lapsed` ends a renewal.
- Mood across journeys: a journey begins at the mood the customer's last one left them in.
