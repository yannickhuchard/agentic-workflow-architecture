# Counterfactual replay: Identity, AML and Tax Residence Checks

**The candidate behaves exactly as recorded.**

Recorded AI outputs were replayed too, so only the changed contracts, criteria and rules could make a difference.

| | Recorded | Candidate |
|---|---|---|
| Outcome | completed | completed |
| Duration | 52823.0 s | 0 ms (replayed, without real waiting) |

Both runs took the same path.

## Step by step

| Step | Verdict | Recorded | Candidate | Notes |
|---|---|---|---|---|
| Checks requested | same | not accepted | not accepted |  |
| Verify identity documents | same | accepted, 2 attempts | accepted, 1 attempt | Tool calls: 4 recorded, 0 in the candidate. |
| Screen PEP and sanctions | same | accepted, 1 attempt | accepted, 1 attempt | Tool calls: 1 recorded, 0 in the candidate. |
| Validate tax self-certification | same | accepted, 1 attempt | accepted, 1 attempt | Tool calls: 1 recorded, 0 in the candidate. |
| Checks back | same | not accepted | not accepted |  |
| Customer due diligence | same | rule 5 (table) | rule 5 (table) |  |
| Record due diligence | same | accepted, 1 attempt | accepted, 1 attempt | Tool calls: 1 recorded, 0 in the candidate. |
| Checks passed | same | not accepted | not accepted |  |

