# Roadmap

This roadmap describes the steps that take AWA from a specification with two implementations to an international standard for agentic workflows. Each step names what it delivers and how the project knows it is complete.

## 1. Publish version 2.0.0

The SDKs version 2.0.0 implement specification 1.1 in full.

| Deliverable | Complete when |
|---|---|
| The npm package `agentic-workflow-architecture` 2.0.0 | The package installs with `npm install agentic-workflow-architecture` |
| The PyPI distribution `agentic-workflow-architecture` 2.0.0 | The distribution installs with `pip install agentic-workflow-architecture` |
| The GitHub release `v2.0.0` | The release carries both packages and the release notes |
| Specification 1.1 marked as released | The header of `docs/specification.md` reads "Version 1.1" |

[`RELEASING.md`](RELEASING.md) describes the release steps.

## 2. Open governance

The project runs under written rules that anyone can follow.

| Deliverable | Complete when |
|---|---|
| [`GOVERNANCE.md`](GOVERNANCE.md), [`CONTRIBUTING.md`](CONTRIBUTING.md), [`CODE_OF_CONDUCT.md`](CODE_OF_CONDUCT.md), [`SECURITY.md`](SECURITY.md) | The files are on `main` |
| The AWA Enhancement Proposal process | Every normative change after 1.1 starts as a proposal in [`docs/proposals`](docs/proposals) |
| Maintainers from several organisations | [`MAINTAINERS.md`](MAINTAINERS.md) lists maintainers from at least three organisations |

## 3. Evidence for regulated deployments

Organisations that deploy AI systems under the EU AI Act, the NIST AI RMF or ISO/IEC 42001 use AWA's record as evidence for their own compliance work.

| Deliverable | Complete when |
|---|---|
| An evidence report that covers guardrails, authorization decisions and child runs | The `evidence` level includes cases for each |
| A compliance guide | [`docs/compliance/eu-ai-act.md`](docs/compliance/eu-ai-act.md) maps each obligation to the records and the report parts that serve it, with a worked example |
| A reference deployment for a regulated process | An example workflow runs with a policy, guardrails and an evidence report, and its outputs are published in the repository |

## 4. A third implementation

An implementation written outside this repository passes the conformance suite. This proves that the specification and its cases are enough to build AWA.

| Deliverable | Complete when |
|---|---|
| An implementer's guide | `spec/conformance/README.md` takes a new implementer from an empty project to the `core` level |
| A third implementation | An independent implementation publishes a reproducible claim at the `core`, `decision` and `verified` levels or above |

## 5. Ecosystem

Tools and frameworks read, write and run AWA documents.

| Deliverable | Complete when |
|---|---|
| Schema discovery in editors | The AWA schemas are listed in the SchemaStore catalogue, so that editors validate `*.awa.json` files as users type |
| Stable schema identifiers | The domain in the `$id` of every schema serves the schemas |
| Bridges to agent frameworks | At least one agent framework runs AWA activities, or exports its graphs as AWA documents |
| A website | A public site presents the specification, the guides, the playground and the list of implementations |

## 6. Certification

Implementers and vendors show conformance with a recognised mark.

| Deliverable | Complete when |
|---|---|
| A conformance report format | An implementation publishes its claim as a machine-readable report that anyone can reproduce |
| A certification programme | The maintainers issue the mark "AWA conformant" under the rules of [`GOVERNANCE.md`](GOVERNANCE.md#conformance-claims) |

## 7. A neutral home

The project moves to a foundation that hosts open standards, and the specification follows that foundation's standards track.

| Deliverable | Complete when |
|---|---|
| A foundation | A foundation accepts the project, and the governance moves into its charter |
| A standards track | The specification enters the foundation's process towards an approved standard |
