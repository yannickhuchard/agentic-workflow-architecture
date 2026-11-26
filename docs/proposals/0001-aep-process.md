# AEP 0001: The AEP process

| Field | Value |
|---|---|
| Status | `final` |
| Author | Yannick HUCHARD |
| Created | 2026-11-26 |
| Specification version | All versions from 1.1 |
| Sections | Governance |
| Conformance level | None |

## Problem

AWA 1.1 grew from version 1.0 through ten new sections (24 to 33). Each section was designed with its conformance cases and implemented in two SDKs. An organisation that evaluates AWA as a standard asks how such changes are proposed, reviewed and accepted, and where the reasons behind each rule are recorded.

## Proposal

Every normative change follows a written proposal stored in `docs/proposals`, reviewed in a pull request, and decided under [`GOVERNANCE.md`](../../GOVERNANCE.md). The proposal moves through the statuses `draft`, `review`, `accepted`, `implemented` and `final`. A change becomes final when two independent implementations pass its conformance cases.

## Normative text

This proposal changes the governance of the project and leaves the specification text unchanged.

## Effect on existing documents

Every existing document keeps its meaning. Sections 1 to 33 of specification 1.1 stand as the baseline from which later proposals start.

## Alternatives considered

- **Decisions in issues alone.** Issues record discussions well and are harder to find later. A file per proposal keeps the decision and its reasons next to the specification.
- **A separate repository for proposals.** A separate repository separates each proposal from the conformance cases and the code that implement it. One repository keeps them in the same pull request.

## Out of scope

The transfer of the project to a foundation, which [`ROADMAP.md`](../../ROADMAP.md) describes.
