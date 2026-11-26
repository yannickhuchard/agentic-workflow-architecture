# Contributing to AWA

Thank you for contributing to the Agentic Workflow Architecture. This guide explains how to propose a change, how to work on the code, and which checks a pull request passes before it is merged. How decisions are made is described in [`GOVERNANCE.md`](GOVERNANCE.md).

## Ways to contribute

| You want to | Start with |
|---|---|
| Report a defect in an SDK or a view | An issue with the bug template |
| Ask a question or share an idea | An issue with the question template |
| Change the specification, a JSON Schema or a conformance case | An AWA Enhancement Proposal, as described in [`docs/proposals/README.md`](docs/proposals/README.md) |
| Fix a defect or add an SDK feature | A pull request, with an issue for anything larger than a small fix |
| Add an implementation of AWA in another language | An issue with the conformance template, once your runner passes the levels you claim |
| Improve the documentation or an example | A pull request |

## Setting up

The TypeScript SDK is the reference implementation.

```bash
cd sdk/typescript && npm ci && npx prisma generate
```

The Python SDK installs with its development extra, which brings every package its tests use.

```bash
cd sdk/python && pip install -e ".[dev,web]"
```

The Java data model builds with Maven.

```bash
cd sdk/java && mvn -B -q test
```

The shared store tests start a temporary PostgreSQL server when PostgreSQL is installed, and use the server named by `AWA_TEST_POSTGRES_URL` when that variable is set.

## Working on the specification

A change to the rules follows these steps.

1. Write the normative text in `docs/specification.md`, with MUST, SHOULD and MAY as the rest of the document uses them, and a statement of what the change leaves out of scope.
2. Update the JSON Schemas in `spec/json-schema` and the types of both SDKs.
3. Add conformance cases through `spec/conformance/generate.py`. Add new cases and leave existing cases as they are. Then regenerate the cases:

   ```bash
   python3 spec/conformance/generate.py
   ```

4. Implement the change in the TypeScript SDK, then in the Python SDK, so that both runners pass every case of the level.
5. Add a row for a new level to the tables of sections 2.1 and 2.2, describe the case format in Appendix A, and add a line to Appendix B.

## Working on the code

- Keep each pull request focused on one change.
- Add tests for every behaviour, including refusals and failure paths.
- Keep the two SDKs in step. A behaviour that the specification defines behaves the same in both.
- Follow the rules in [`.agent/rules`](.agent/rules). In particular, the default AI model is a configuration value read from `sdk/typescript/src/config.json` and `sdk/python/awa/config.json`, and code and documentation refer to models through that configuration.
- Write plain, precise English in documentation and messages.

## Checks

Every pull request passes the same checks as the CI workflow in `.github/workflows/ci.yml`.

```bash
cd sdk/typescript && npm run typecheck && npm run lint && npx vitest run
```

```bash
cd sdk/python && python3 -m pytest -q
```

```bash
cd sdk/java && mvn -B -q test
```

```bash
python3 spec/conformance/generate.py && git diff --exit-code spec/conformance
```

```bash
python3 docs/build-guides.py && git diff --exit-code docs
```

The MCP server, the journey view and the measures page have their own checks, listed in the CI workflow. Run them when your change touches `apps/mcp-server`, `tools/visualization` or the measures.

## Commits and sign-off

Write a commit message that says what changed and why. Sign off each commit to certify the [Developer Certificate of Origin](https://developercertificate.org/):

```bash
git commit -s
```

Every contribution is offered under the Apache License 2.0, as section 5 of the license states.

## Release notes

Add one row at the top of the table in [`release_notes.md`](release_notes.md) for each change that users notice, and mark a change as breaking when it changes the meaning of an existing document or the behaviour of an existing call.

## Code of conduct

Every participant follows the [Code of Conduct](CODE_OF_CONDUCT.md).
