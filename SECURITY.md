# Security policy

## Supported versions

| Version | Supported |
|---|---|
| SDK 2.x (specification 1.1) | Yes: security fixes and releases |
| SDK 1.x (specification 1.0) | Users receive fixes by upgrading to 2.x; Appendix B of the specification lists the changes |

## Reporting a vulnerability

Report a vulnerability privately through GitHub: open the repository's **Security** tab and choose **Report a vulnerability**. This keeps the report visible to the maintainers only until a fix is published.

A useful report contains:

- the affected component (an SDK, the HTTP interface, the MCP server, a view) and its version;
- the steps to reproduce the issue, or a workflow document that shows it;
- the impact you observed or expect.

## What happens next

1. A maintainer acknowledges the report within five working days.
2. The maintainers assess the impact and agree a timeline with the reporter.
3. The fix is prepared in a private fork, released in both SDKs when both are affected, and announced in a security advisory that credits the reporter, with their agreement.

## Scope

The following areas are in scope:

- the engines of the TypeScript and Python SDKs, including the enforcement of deployment permissions, authorization policies, context bindings and guardrails;
- the HTTP interface started by `awa serve`, including its authentication and the A2A routes;
- the shared PostgreSQL store;
- the MCP server in `apps/mcp-server` and the views in `tools/visualization`.

Guardrail pattern lists form a baseline of protection, as section 31 of the specification states. A report that shows an input passing a guardrail helps the project strengthen the baseline, and the project welcomes it as an ordinary issue.
