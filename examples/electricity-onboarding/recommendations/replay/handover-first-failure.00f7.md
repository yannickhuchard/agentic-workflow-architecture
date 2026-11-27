# Counterfactual replay: Grid Export Registration

**The candidate behaves exactly as recorded.**

Recorded AI outputs were replayed too, so only the changed contracts, criteria and rules could make a difference.

| | Recorded | Candidate |
|---|---|---|
| Outcome | completed | completed |
| Duration | 18490.0 s | 0 ms (replayed, without real waiting) |

Both runs took the same path.

## Step by step

| Step | Verdict | Recorded | Candidate | Notes |
|---|---|---|---|---|
| Export registration requested | same | not accepted | not accepted |  |
| Verify installation documents | same | accepted, 2 attempts | accepted, 1 attempt | Tool calls: 8 recorded, 0 in the candidate. |
| Classify installation | same | rule 6 (table) | rule 6 (table) |  |
| Grid operator approval | same | accepted, 1 attempt | accepted, 1 attempt |  |
| Register export meter and tariff | same | accepted, 1 attempt | accepted, 1 attempt | Tool calls: 1 recorded, 0 in the candidate. |
| Export registered | same | not accepted | not accepted |  |

