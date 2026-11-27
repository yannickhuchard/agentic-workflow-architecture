# Counterfactual replay: Electricity Customer Onboarding

**The candidate behaves exactly as recorded.**

Recorded AI outputs were replayed too, so only the changed contracts, criteria and rules could make a difference.

| | Recorded | Candidate |
|---|---|---|
| Outcome | completed | completed |
| Duration | 2023907.0 s | 0 ms (replayed, without real waiting) |

Both runs took the same path.

## Step by step

| Step | Verdict | Recorded | Candidate | Notes |
|---|---|---|---|---|
| Application received | same | not accepted | not accepted |  |
| Register application | same | accepted, 1 attempt | accepted, 1 attempt | Tool calls: 1 recorded, 0 in the candidate. |
| Required documents | same | rule 1, 2, 3 (table) | rule 1, 2, 3 (table) |  |
| Request documents | same | accepted, 1 attempt | accepted, 1 attempt | Tool calls: 1 recorded, 0 in the candidate. |
| Documents uploaded | same | not accepted | not accepted |  |
| Send document reminder | same | accepted, 1 attempt | accepted, 1 attempt | Tool calls: 1 recorded, 0 in the candidate. |
| Documents uploaded after reminder | same | accepted | accepted |  |
| Verify documents | same | accepted, 2 attempts | accepted, 1 attempt | Tool calls: 6 recorded, 0 in the candidate. |
| Documents checked | same | not accepted | not accepted |  |
| Check credit and identity | same | accepted, 1 attempt | accepted, 1 attempt | Tool calls: 1 recorded, 0 in the candidate. |
| Look up metering point | same | accepted, 1 attempt | accepted, 1 attempt | Tool calls: 1 recorded, 0 in the candidate. |
| Checks complete | same | not accepted | not accepted |  |
| Eligibility | same | rule 5 (table) | rule 5 (table) |  |
| Applicant verified | same | accepted | accepted |  |
| Electricity source | same | rule 3 (table) | rule 3 (table) |  |
| Plan eligibility | same | rule 1, 2, 3 (table) | rule 1, 2, 3 (table) |  |
| Recommend plan | same | accepted, 1 attempt | accepted, 1 attempt | Tool calls: 3 recorded, 0 in the candidate. |
| Plan confirmed | same | accepted | accepted |  |
| Plan chosen | same | accepted | accepted |  |
| Generate contract | same | accepted, 1 attempt | accepted, 1 attempt | Tool calls: 1 recorded, 0 in the candidate. |
| Contract signed | same | accepted | accepted |  |
| Set up account and direct debit | same | accepted, 1 attempt | accepted, 1 attempt | Tool calls: 1 recorded, 0 in the candidate. |
| Request supplier switch | same | accepted, 1 attempt | accepted, 1 attempt | Tool calls: 1 recorded, 0 in the candidate. |
| Switch completed | same | accepted | accepted |  |
| Write welcome pack | same | accepted, 1 attempt | accepted, 1 attempt |  |
| Activate customer | same | accepted, 1 attempt | accepted, 1 attempt | Tool calls: 2 recorded, 0 in the candidate. |
| Customer activated | same | accepted | accepted |  |
| Customer active | same | not accepted | not accepted |  |

