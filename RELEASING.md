# Releasing

A release is published by pushing a version tag. `.github/workflows/release.yml` then tests both SDKs, builds both packages, installs each in an empty environment and runs it, and only then publishes to npm and to PyPI and creates the GitHub release.

## Once

Add two repository secrets (Settings, Secrets and variables, Actions):

| Secret | What |
|---|---|
| `NPM_TOKEN` | An npm token allowed to publish `agentic-workflow-architecture` |
| `PYPI_API_TOKEN` | A PyPI token allowed to upload `agentic-workflow-architecture`. For the first upload it must be a token for the whole account, since the project does not exist yet; replace it with one scoped to the project afterwards |

The Python distribution is named `agentic-workflow-architecture` and imported as `awa`. The PyPI name `awa` belongs to an unrelated project.

## Each release

1. Set the same version in `sdk/typescript/package.json` and `sdk/python/pyproject.toml`, add a row to `release_notes.md`, and merge to `main`.
2. Tag that commit and push the tag:

```bash
git tag -a v2.0.0 -m "AWA specification 1.1, SDK 2.0.0"
```

```bash
git push origin v2.0.0
```

The tag must be `v` followed by the version of both packages; the workflow stops before publishing anything if it is not.

A published version cannot be replaced, on npm or on PyPI. If the workflow fails after one registry has accepted the package, fix the cause and publish the other by hand from the same tag rather than re-tagging.

## By hand

```bash
cd sdk/typescript && npm ci && npx prisma generate && npm run build && npm publish --access public
```

```bash
cd sdk/python && python -m build && twine upload dist/*
```
