# AWA Enhancement Proposals

An AWA Enhancement Proposal (AEP) describes a change to the specification, the JSON Schemas or the conformance suite. It records the problem, the decision and the reasons, so that implementers and reviewers understand each rule long after it was written. Decisions follow [`GOVERNANCE.md`](../../GOVERNANCE.md).

## When to write a proposal

Write a proposal for any change to a normative artefact:

- a new section, a new rule or a changed rule in `docs/specification.md`;
- a new or changed property in `spec/json-schema`;
- a new conformance level, or a change to the expected outcome of a case.

Fixes to wording that keep the meaning of a rule, SDK features that the specification already covers, documentation and examples go straight to a pull request.

## Lifecycle

| Status | Meaning |
|---|---|
| `draft` | The author is writing the proposal and welcomes early comments. |
| `review` | The proposal is complete, and the review period of [`GOVERNANCE.md`](../../GOVERNANCE.md#decision-making) runs. |
| `accepted` | The maintainers approved the proposal. The change can be implemented. |
| `implemented` | The normative text, the schemas, the conformance cases and the reference implementation are merged. |
| `final` | A second implementation passes the cases, and the change is part of a released version of the specification. |
| `withdrawn` | The author withdrew the proposal. The file stays as a record. |
| `superseded` | A later proposal replaced this one, and the file links to it. |

## Writing a proposal

1. Copy [`0000-template.md`](0000-template.md) to `NNNN-short-title.md`, with the next free number.
2. Fill in every section of the template. The normative text is written as it will appear in the specification.
3. Open a pull request titled `AEP NNNN: Short title`, with the status `review`.
4. Answer the review comments in the pull request. The specification editor merges the proposal once it is accepted.

## Index

| Number | Title | Status | Specification |
|---|---|---|---|
| 0001 | [The AEP process](0001-aep-process.md) | `final` | Governance |
