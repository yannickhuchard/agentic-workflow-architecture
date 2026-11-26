## Summary

What this pull request changes, and why.

## Kind of change

- [ ] Fix in an SDK, a view or the documentation
- [ ] SDK feature within the current specification
- [ ] Change to the specification, a JSON Schema or the conformance suite (link the AEP: `docs/proposals/NNNN-...`)

## Checks

- [ ] `cd sdk/typescript && npm run typecheck && npm run lint && npx vitest run`
- [ ] `cd sdk/python && python3 -m pytest -q`
- [ ] `cd sdk/java && mvn -B -q test`
- [ ] `python3 spec/conformance/generate.py` leaves `spec/conformance` unchanged
- [ ] `python3 docs/build-guides.py` leaves `docs` unchanged
- [ ] A row in `release_notes.md` for a change users notice, marked as breaking where it applies

## Notes for reviewers

Anything that helps review: design choices, known limits, follow-up work.
