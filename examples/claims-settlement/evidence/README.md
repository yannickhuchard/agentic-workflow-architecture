# Evidence report of the claims-settlement workflow

A worked example for a compliance guide: three motor claims run through `../claims-settlement.awa.json` under a deployment that says who may do what and adds two guardrails, and the evidence report (specification section 32) made from their journals with `awa evidence`.

**The report is evidence a deployer can use. It is not a certification of compliance** with the EU AI Act, the NIST AI RMF, ISO/IEC 42001 or anything else, and says so on its first line.

| File | What it is |
|---|---|
| `deployment.json` | The deployment: principals for the agents, the claims platform and four people; a policy (who may open claims, perform work, decide and approve), a separation of duties and a four-eyes rule on Adjuster review; and two guardrails, one against instructions hidden in claim data, one that redacts personal data from what agents write |
| `make-evidence.mjs` | Runs the three claims in simulation, writes their journals, and calls `awa evidence` three times |
| `journals/*.journal.jsonl` | The journal of each run (specification section 9) |
| `evidence-report.json` | The report as data, in the form `spec/json-schema/evidence-report.schema.json` fixes |
| `evidence-report.md`, `evidence-report.html` | The same report for a person to read |

## The three claims

| Claim | What happens | Where the report states it |
|---|---|---|
| Routine | Settled without a person. The first damage assessment breaks its outcome contract and the first fraud check times out; both are tried again. The letter to the claimant names a phone number and an email address, which the guardrail redacts before the letter leaves the agent | `outcomes`, `failures`; `guardrails` (redact, stage `output`) |
| Reviewed | The decision table does not cover a costly claim, so the decision goes to review. Ana, who opened the claim, may not approve it (separation of duties); Alice approves; Alice may not approve a second time (four eyes); Bob approves, and the claim is paid | `models` (the decision); `oversight` (the human decision with both approvers, the two refusals); `refusals` (the two denials); `operation` (every allowed decision, since the deployment sets `record_allows`) |
| Injection | The claim's description tells the agents to ignore their instructions. The input guardrail hands the damage assessment and the fraud check to Carol before either agent is called; she scores the claim as fraud, and Bob investigates it | `guardrails` and `oversight` (escalations, stage `input`); `oversight` (the people who decided in place of the agents) |

Each statement of the report cites the journal records it rests on, as `run 0000003f #37`: the record with sequence number 37 in `journals/0000003f-….journal.jsonl`. No statement holds what a guardrail matched: the journal never held it (specification 31.7), and the letters in the journals are already redacted.

## Regenerate

The actors are scripted and the people's answers are given by the script, so no model, bank or API key is needed. The clock, the identifiers and the jitter of retries are fixed in the script, so running it again writes the same files byte for byte.

```bash
cd sdk/typescript && npm install && npm run build
```

```bash
node examples/claims-settlement/evidence/make-evidence.mjs
```

The report alone, from journals you already have, is one command per format:

```bash
awa evidence examples/claims-settlement/evidence/journals --as-of 2026-11-26T09:00:00.000Z --format md -o evidence-report.md
```

`--as-of` fixes the instant the report is made as of; without it the report is made as of now, and `as_of` and `held_for_ms` change with each run of the command. `--from`, `--to` and `--workflow` narrow it to a period and to workflows. The Python SDK's `awa evidence` makes the same report from the same journals.

To run one claim yourself under the same deployment, started by Ana, with the outputs of `../simulation.json` (its letter names no phone number, so no guardrail acts):

```bash
awa run examples/claims-settlement/claims-settlement.awa.json --simulate --outputs examples/claims-settlement/simulation.json --deployment examples/claims-settlement/evidence/deployment.json --as ana --journal my-claim.journal.jsonl
```

A run made this way takes its times and identifiers from the clock and from random numbers, so its journal differs from these.
