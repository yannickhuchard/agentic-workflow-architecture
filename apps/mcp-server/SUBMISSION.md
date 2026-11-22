# Submission checklist: AWA Workflows & Journeys

State on 22 November 2026, plugin and server version 0.1.0.

**Not submitted. Not hosted. Not connected to ChatGPT or Claude by its author.** The server, the widgets, the plugin package and the review material are written and pass the checks listed under [What was verified](#what-was-verified). The steps under [What only the publisher can do](#what-only-the-publisher-can-do) remain.

The model follows the two plugins already published by the same developer (SEDA: MCP server with MCP Apps widgets; AIR: plugin package and submission records). Differences are listed at the end.

## 1. What is ready

| Item | Where | State |
|---|---|---|
| MCP server, stdio and Streamable HTTP | `apps/mcp-server/src` | Done. 7 tools, 4 UI resources |
| Widgets | `src/widgets.js`, built from `tools/visualization/journey.html` and `replay.html` | Done |
| Plugin manifest | `plugins/awa/plugin.json` | Done: identity, listing, 5 positive and 3 negative review cases, commerce declaration, release notes |
| MCP configuration | `plugins/awa/mcp.json` | Format done. **The address is a placeholder** |
| Icons | `plugins/awa/assets/awa.svg`, `awa-dark.svg` | Done: square SVG, 64 by 64 view box. Drawn for this package; replace them if AWA has a mark of its own |
| Marketplaces for local installation | `plugins/marketplace.json`, `.agents/plugins/marketplace.json` | Done |
| Privacy notice, terms, support page | `apps/mcp-server/legal/` | Drafted. Passages marked *to confirm* need the publisher |
| Packaging | `npm run plugin:package -- https://<host>/mcp --demo https://<recording>` | Done: writes `dist/plugins/awa/` with the real address and refuses a placeholder |
| Container file | `apps/mcp-server/Dockerfile` | Written, **not built** (see below) |

## 2. What runs today, in development mode

Build the SDK, install, start: see [README.md](README.md#run-it).

- **Any MCP client over stdio** (Claude Desktop, Claude Code, IDE agents): `node apps/mcp-server/src/start.js --stdio`. Snippet: `clients/stdio.json`.
- **Any MCP client on this machine over HTTP**: `http://127.0.0.1:8787/mcp`. Snippet: `clients/local-development.json`.
- **ChatGPT developer mode**: needs a public HTTPS address. Open a tunnel to port 8787 and start the server with `AWA_MCP_PUBLIC_URL=https://<tunnel host>/mcp`. In ChatGPT: Plugins, plus button, "Add custom MCP server", paste the address, no authentication.
- **claude.ai**: add the same public address as a custom connector.
- **ChatGPT desktop or Codex, as a local plugin**: the repository is a marketplace (`.agents/plugins/marketplace.json`, name `awa-local`). The plugin it lists points at the placeholder address, so it connects to nothing until `plugins/awa/mcp.json` holds a real address.

The views appear only in clients that support MCP Apps. Elsewhere the tools answer in text.

## 3. Placeholders to replace before submission

| Placeholder | Where | Replace with |
|---|---|---|
| `https://awa-mcp.placeholder.invalid/mcp` | `plugins/awa/mcp.json` | The public HTTPS address of the hosted server. `npm run plugin:package` writes it into the package |
| `review.demo_recording_url` (absent) | `plugins/awa/plugin.json` | The address of a recorded walkthrough of the five positive cases. Required for review |
| `supportURL`, `privacyPolicyURL`, `termsOfServiceURL` | `plugins/awa/plugin.json` | They point to `…/blob/main/apps/mcp-server/legal/*.md`. These resolve only once this work is merged to `main`. The directory may want pages on a site of the publisher instead of files on GitHub: to confirm in the portal ("Public URLs must be accessible and identify the same publisher as the submission") |
| Hosting provider, region, log retention; private contact address | `legal/PRIVACY.md` | The facts of the real deployment |
| Governing law, legal contact | `legal/TERMS.md` | The publisher's choice. The terms were not reviewed by a lawyer |
| `developerName: "Yannick Huchard"` | `plugins/awa/plugin.json` | Kept as in the developer's other packages. The directory shows the name of the verified developer identity chosen in the portal |
| Icons | `plugins/awa/assets/` | Optional: a mark of AWA's own |
| `publication.countries` | absent | Optional: an allowlist of countries. Absent means no restriction is set by the package |

`npm run plugin:check` lists the first two. `node scripts/check-plugin.mjs --submit` fails while they remain.

## 4. What only the publisher can do

1. **Host the server** at a stable public HTTPS address ending in `/mcp`. Set `AWA_MCP_HOST=0.0.0.0`, `AWA_MCP_PUBLIC_URL=https://<host>/mcp` and, if the platform reaches the container under its own domain, `AWA_MCP_ALLOWED_HOSTS`. The address cannot be changed after publication without contacting support. Put a rate limit in front of it: the server has no authentication because it holds no data.
2. **Check the deployment**: `GET /healthz` answers `{"status":"ok",…,"mode":"public"}`; then connect an MCP client and call `load_claims_example`.
3. **Developer account and identity**: complete individual or business verification in the OpenAI organisation settings.
4. **Domain verification**: the portal shows a challenge token and the address where it must be served as plain text. Set `AWA_MCP_OPENAI_CHALLENGE=<token>`: the server then serves it at `/.well-known/openai-apps-challenge`. If the portal names another path, serve it from the hosting layer.
5. **Record the walkthrough** of the five positive cases and host the recording.
6. **Build and upload the package**: `npm run plugin:package -- https://<host>/mcp --demo https://<recording>`, zip the contents of `dist/plugins/awa/`, upload under Plugins, "Upload new or existing plugin".
7. **Connect and scan** the server in the portal, resolve findings, check that 7 tools and 4 UI resources are found.
8. **Run each review case** in ChatGPT against the hosted server, then accept the terms and the attestations, and submit.
9. **After approval**, publish. Later changes to the server are picked up by scans; changes to the listing need a new ZIP.

No OAuth is needed: the tools are declared `noauth` and `mcp.json` declares `auth.type: "none"`. No reviewer account is needed for the same reason. If the server ever stores data per user, this changes: see how SEDA does it.

## 5. Review cases

They are in `plugins/awa/plugin.json` under `extensions.com.openai.review.test_cases`. The expected results were taken from running the tools against the bundled example (`tests/tools.test.js` and the calls in `scripts/verify-widgets.mjs` exercise the same data). What a model does with a prompt in ChatGPT was not run.

| # | Case | Tools |
|---|---|---|
| + | Open the bundled example in the journey view, then its measures dashboard | `load_claims_example`, `show_dashboard` |
| + | Validate a broken workflow and report its problems in plain words | `validate_document` |
| + | Show a workflow as a graph with the data that moves | `load_claims_example`, `show_workflow` |
| + | Simulate a workflow run and replay it | `load_claims_example`, `simulate_workflow` |
| + | Simulate customer journeys from business events | `load_claims_example`, `simulate_journey` |
| − | Real execution is asked for (pay through an API) | none: the plugin only simulates |
| − | A document by address and a shell command on the server | none: documents are inline, nothing is fetched or run |
| − | Another user's or an earlier conversation's simulations | none: nothing is stored |

`show_journeys` has no review case of its own (five are allowed); it is covered by the tests and the widget verification.

## What was verified

Run on 22 November 2026 on Linux, Node 22, Chromium through Playwright.

| Check | Command | Result |
|---|---|---|
| Unit tests | `npm test` | 30 passed, 0 failed |
| Server and widgets with a fake MCP Apps host | `NODE_PATH=$(npm root -g) npm run verify` | 79 of 79 checks passed |
| Plugin package | `npm run plugin:check` | well formed, 2 placeholders |
| The journey view's own check, after the one-line hook | `node tools/visualization/journey.check.mjs` | 22 of 22 checks passed |
| Packaging | `npm run plugin:package -- <https address> --demo <address>` to a temporary folder | 4 files: `plugin.json`, `mcp.json`, 2 icons |

What these show:

- **Protocol**: the SDK's own client lists 7 tools and 4 resources and calls every tool in memory, over Streamable HTTP and over stdio. Tool metadata (`annotations`, `securitySchemes`, `_meta.ui.resourceUri`, `openai/outputTemplate`) and resource metadata (MIME type, empty CSP domain lists) are as declared.
- **Simulation safety**: a workflow whose tools would create a file with a command, and call HTTP and JSON-RPC endpoints, creates no file, reaches no endpoint, starts no process and opens no connection when simulated, alone or inside a journey. A control runs the same workflow through the SDK with simulation off and does create the file and reach the endpoints.
- **Limits**: an endless loop stops at 400 steps; a loop that splits in parallel is stopped; a 52-week timer and 6-hour retry delays complete at once on the simulated clock; oversized, over-nested and `__proto__`-bearing inputs are refused.
- **No state**: an event id played in one call is new in the next; records do not accumulate; a second server sees nothing.
- **HTTP**: listens on 127.0.0.1; refuses to be configured for another interface without `AWA_MCP_PUBLIC_URL`; 403 for foreign `Host` and for any `Origin` not allowed; 413 above 1 MB, declared or streamed; 404, 405 and 400 where due; 503 above the concurrency cap; `no-store` on every answer.
- **Widgets in Chromium**, in a sandboxed iframe under a policy that allows no network: bridge initialisation, every message the widgets send valid against the schemas published with the MCP Apps SDK, tool results delivered through `ui/notifications/tool-result`, the example drawn at all four heights of the journey view, simulated journeys, the workflow graph and its Data tab, the replay stepped forward and back, tool errors shown as text, document names carrying markup shown as text (no element created, no script run), light and dark host themes, height within the host's maximum, fullscreen on request, a 390 px wide frame without overflow, the same widget fed by ChatGPT's `window.openai` globals instead of the bridge, no page error, no console error, and no request beyond the page itself. Served without any policy and asked by address to load from a server, the widgets make no request; a control without the network-closing script does.
- **Container file list**: the server was started from a directory holding exactly the files the `Dockerfile` copies, and served all tools, documents and widgets.

## What was not verified

- **Nothing was run inside ChatGPT or Claude.** The fake host implements the MCP Apps messages the widgets use; it is not either product. How each client sizes, themes and frames the views, and whether it passes `_meta` to the view, is unverified. SEDA relies on the same mechanisms.
- **No model was in the loop.** Whether a model picks the expected tools for the review prompts, or copies a 30 kB workflow correctly into a tool call, is unverified.
- **No public deployment.** Public mode is covered by tests on the loopback only. No tunnel, no TLS, no real `Host` from a platform, no domain verification, no portal scan.
- **The `Dockerfile` was not built**: no container daemon was available. `npm prune --omit=dev` in the SDK and the image as a whole are untested.
- **The size of results.** The claims example sends a 260 kB story to its view in `_meta`. Whether every client accepts a result of that size is unverified.
- **The submission format** was checked against the live documentation on 22 November 2026 (`developers.openai.com/plugins/build/plugins`, `/plugins/build/chatgpt-ui`, `/plugins/build/auth`, `/plugins/build/app-quickstart`, `/plugins/deploy/submission`): manifest fields and limits, `mcp.json` with `auth.type: "none"`, marketplace files, five positive and three negative cases, icon rules. `scripts/plugin-rules.mjs` encodes those rules. The portal's own validation was not run. Two points could not be settled from the documentation: whether a widget `domain` must be declared for review (the server can declare one: `AWA_MCP_WIDGET_DOMAIN`), and the exact address of the domain-verification file (the portal shows it).
- **The SDK was not rebuilt.** The server ran against the `sdk/typescript/dist` present in the working tree.

## Differences from SEDA

| SEDA | AWA | Why |
|---|---|---|
| OAuth, tenants, a catalogue in Firestore | No authentication, no storage | AWA's tools compute from their arguments. There is nothing to protect per user |
| CommonJS, inside the main package | ES modules, own package `apps/mcp-server` | The AWA SDK is a separate TypeScript package; the server depends on its build |
| Review cases in `review-cases.json`, added at packaging | In `plugin.json` | One source; the documented manifest holds them |
| Loopback HTTP unless OAuth is configured | Loopback HTTP unless a public address is configured | Same rule, without OAuth |
| Three tools retain a derived artefact and are not marked read-only | Every tool is read-only | Nothing is retained |
| One browser verification script per view | One script for the four widgets, in a sandboxed iframe, with hostile-content and no-network checks | The documents are untrusted |
