# Governance

This document describes how the Agentic Workflow Architecture (AWA) project makes decisions, how the specification changes, and how an implementation claims conformance. It applies to every part of the repository: the specification, the JSON Schemas, the conformance suite and the SDKs.

## Principles

The project follows five principles.

1. **The specification is the authority.** `docs/specification.md` and the JSON Schemas in `spec/json-schema` are normative. When an SDK and the specification disagree, the SDK is corrected.
2. **Every normative rule is testable.** A rule enters the specification together with the conformance cases that test it, wherever the rule can be stated without a particular implementation.
3. **Two implementations prove a rule.** A rule becomes part of a released version of the specification once two independent implementations pass its cases. Today the TypeScript reference SDK and the Python SDK play this role.
4. **Decisions happen in the open.** Proposals, discussions and decisions are recorded in the repository, in issues and in pull requests.
5. **Vendor neutrality.** The specification names capabilities and protocols. Model providers, products and vendors appear only as examples of an open interface.

## Roles

| Role | Responsibilities | How someone takes the role |
|---|---|---|
| **Contributor** | Anyone who opens an issue, a proposal or a pull request. | By contributing. |
| **Maintainer** | Reviews and merges pull requests, triages issues, keeps the SDKs, the conformance suite and the documentation consistent, and prepares releases. | Nominated by a maintainer and accepted by the maintainers, after sustained contributions. |
| **Specification editor** | Owns the text of `docs/specification.md`, keeps its terminology and numbering consistent, and decides when a proposal is ready for a vote. | Appointed by the maintainers from among the maintainers. |
| **Implementer** | Builds an implementation of AWA in or outside this repository and reports its conformance. | By publishing an implementation and its conformance report. |

The current maintainers and specification editors are listed in [`MAINTAINERS.md`](MAINTAINERS.md).

## Decision making

The project decides by **lazy consensus**. A proposal or a pull request is accepted when a maintainer approves it and no maintainer objects within the review period.

| Kind of change | Review period | Approvals |
|---|---|---|
| A fix to an SDK, the documentation or an example | None beyond review | One maintainer |
| A new SDK feature that leaves the specification unchanged | Three working days | One maintainer |
| A change to the specification, the JSON Schemas or the conformance suite | Seven days, through an AWA Enhancement Proposal | Two maintainers, one of them a specification editor |
| A change to this governance document | Fourteen days | A two-thirds majority of the maintainers |

When a maintainer objects, the discussion continues until the objection is resolved. When consensus remains out of reach, the maintainers vote, and a simple majority decides. A specification editor holds the casting vote on specification matters.

While the project has fewer than three maintainers, the project owner fulfils every approval in the table, and each review period applies in full so that the community can comment.

## Changing the specification

Every normative change follows the AWA Enhancement Proposal (AEP) process described in [`docs/proposals/README.md`](docs/proposals/README.md).

1. **Proposal.** The author opens a pull request that adds a proposal under `docs/proposals`, using the template. The proposal states the problem, the normative text, the conformance cases, and the effect on existing documents.
2. **Review.** The proposal stays open for the review period. The specification editor checks that every rule is testable and consistent with the rest of the specification.
3. **Acceptance.** Once approved, the proposal's status becomes `accepted`.
4. **Implementation.** The normative text, the JSON Schemas and the conformance cases land in one pull request, together with the reference implementation. The status becomes `implemented`.
5. **Release.** The change ships in the next version of the specification once a second implementation passes its cases. The status becomes `final`.

### Versions of the specification

The specification carries a version of the form `major.minor`, independent of the versions of the SDKs (specification section 2.3).

- A **minor** version adds capabilities. Every document that was valid under the previous minor version stays valid and keeps its meaning.
- A **major** version may change the meaning of existing documents. Appendix B of the specification lists every such change, and the release notes give the migration steps.
- A version in **draft** may change. A **released** version is fixed; corrections to it are published as errata in the release notes.

## Conformance claims

An implementation claims a conformance level when it passes every case of that level in `spec/conformance`, with no case skipped. A claim names three things:

1. the version of the specification, for example `1.1`;
2. the levels claimed, for example `core`, `decision`, `verified`;
3. the commit of the conformance suite the implementation ran.

An implementer publishes the claim with the output of the test runner, so that anyone can reproduce it. The implementations table of the specification (section 2.2) lists the implementations whose claims the maintainers have reproduced. An implementer requests a listing by opening an issue with the conformance template.

The phrase **"AWA conformant at level X"** describes an implementation with a reproducible claim at level X. A certification programme that issues a mark under these rules is part of the roadmap in [`ROADMAP.md`](ROADMAP.md).

## Intellectual property

The code, the specification and the conformance suite are released under the Apache License 2.0 ([`LICENSE`](LICENSE)). Under section 5 of that license, every contribution is offered under the same license. Section 3 of the license grants a patent license from each contributor for their contributions.

## Path to a foundation

The project intends to move to a neutral foundation once it has an independent third implementation and maintainers from several organisations. The steps are listed in [`ROADMAP.md`](ROADMAP.md). This governance document is written so that it can transfer to a foundation's charter with few changes.

## Code of conduct and security

Every participant follows the [Code of Conduct](CODE_OF_CONDUCT.md). Security issues follow the process in [`SECURITY.md`](SECURITY.md).
