# AWA MCP server

An MCP server for [Agentic Workflow Architecture](../../README.md) documents, with MCP Apps widgets. It lets an AI client (ChatGPT, Claude, an IDE agent, any MCP client) validate, show and simulate AWA workflows and customer journeys.

- **Stateless.** Documents are passed inline, as JSON, with each call. Nothing is kept when the call returns. There are no accounts.
- **Simulation only.** No tool binding, command, HTTP call, model or production system is ever called. See [What simulation means here](#what-simulation-means-here).
- **Self-contained widgets.** The views are the ones in [`tools/visualization`](../../tools/visualization), bundled into single HTML resources that make no network request.

The plugin package for the ChatGPT plugin directory is in [`plugins/awa`](../../plugins/awa). What is ready and what remains for a submission is in [SUBMISSION.md](SUBMISSION.md).

## Tools

| Tool | What it does | View |
|---|---|---|
| `validate_document` | Checks one workflow or journey document against the AWA schema and its integrity rules, and returns each problem in plain words | none |
| `show_workflow` | Shows a workflow as a graph: activities with actor type and role, decisions, events, and the data that moves (inputs, outputs, contexts read and written, access) | workflow graph |
| `simulate_workflow` | Runs a workflow once in simulation and replays it: path, decisions, waits, simulated tool calls, failures, and a cost if you give rates | run replay |
| `show_journeys` | Shows customer journeys from a portfolio export, or from journey and workflow documents with events to play | journey view |
| `simulate_journey` | Plays business events through an in-memory `AwaRuntime` in simulation and shows the result | journey view |
| `load_claims_example` | Opens the bundled fictional claims example (3 journeys, 5 workflows, 6 customers) and hands out its documents | journey view |
| `show_dashboard` | The measures of journeys and workflows (specification section 21) from a portfolio, from a simulation, or from the example: who is stuck and who is to act, outcomes per journey and stage, how each workflow's runs went. The widget receives only what the measures read: no input, output, reasoning or tool result | dashboard |

The dashboard widget is built from `tools/visualization/dashboard.html`; [Adding a widget](#adding-a-widget) describes how, as the pattern for the next one.

Every tool is annotated `readOnlyHint: true`, `destructiveHint: false`, `openWorldHint: false`, and declares the `noauth` security scheme. Results have three parts: a sentence in `content`, a summary a model can read in `structuredContent`, and the data the view draws in `_meta.awa`.

## Run it

Node 20 or later. The server uses the TypeScript SDK through `file:../../sdk/typescript`, so the SDK must be built first (its `dist/` is not in the repository):

```bash
cd sdk/typescript && npm install && npm run build
```

```bash
cd apps/mcp-server && npm install
```

```bash
npm start                # Streamable HTTP on http://127.0.0.1:8787/mcp
```

```bash
npm run start:stdio      # stdio, for clients that start the server themselves
```

### Connect a client

**MCP Inspector** (no account): `npx @modelcontextprotocol/inspector@latest`, choose Streamable HTTP, enter `http://127.0.0.1:8787/mcp`. If the Inspector's page sends an `Origin` header, allow it: `AWA_MCP_ALLOWED_ORIGINS=http://localhost:6274 npm start`.

**Claude Desktop, Claude Code and other clients that start a local server**: use stdio. [`clients/stdio.json`](clients/stdio.json) is the entry to add to the client's MCP configuration, with the absolute path of this folder filled in. For Claude Code:

```bash
claude mcp add awa -- node /absolute/path/to/apps/mcp-server/src/start.js --stdio
```

**Clients that connect to a local address**: [`clients/local-development.json`](clients/local-development.json) (`http://127.0.0.1:8787/mcp`).

**ChatGPT in developer mode**: ChatGPT reaches a server over public HTTPS, not on your loopback. Open a tunnel to the port (for example `ngrok http 8787`), then start the server telling it the address it is reached at, so that it accepts that host name while still listening on the loopback only:

```bash
AWA_MCP_PUBLIC_URL=https://<your-subdomain>.ngrok.app/mcp npm start
```

In ChatGPT open Plugins, select the plus button, then "Add custom MCP server", paste the same address, and choose no authentication. Refresh the connection after you change the server.

**claude.ai and other hosted clients** also need the public HTTPS address: add it as a custom connector.

The embedded views appear in clients that support MCP Apps. In other clients the tools answer in text and structured content.

> These connection steps follow the clients' documentation. The server was verified with the MCP SDK's client over stdio and HTTP and with a test host in Chromium; it was not connected to ChatGPT or Claude by its author. See [SUBMISSION.md](SUBMISSION.md).

### Configuration

| Variable | Meaning | Default |
|---|---|---|
| `AWA_MCP_HOST` | Interface to listen on | `127.0.0.1` |
| `AWA_MCP_PORT`, `PORT` | Port | `8787` |
| `AWA_MCP_ALLOWED_ORIGINS` | Comma-separated browser origins allowed to call | none |
| `AWA_MCP_PUBLIC_URL` | `https://<host>/mcp`. Turns on public mode: only that host name is answered. Required to listen on anything but the loopback | unset |
| `AWA_MCP_ALLOWED_HOSTS` | Further host names answered in public mode (a platform's own domain) | none |
| `AWA_MCP_OPENAI_CHALLENGE` | Token served as plain text at `/.well-known/openai-apps-challenge`, for domain verification | unset |
| `AWA_MCP_WIDGET_DOMAIN` | An https origin declared as the widgets' own domain (`_meta.ui.domain`), if the directory asks for one | unset |
| `AWA_MCP_MAX_CONCURRENT` | Requests handled at once; more are answered 503 | `8` |
| `AWA_MCP_DEBUG` | Send the SDK's progress lines to standard error | unset |

## Security

The HTTP entry point ([`src/http.js`](src/http.js)):

- listens on the loopback only, and refuses to start on another interface unless `AWA_MCP_PUBLIC_URL` is set;
- answers only requests whose `Host` header is a loopback name (in public mode: the configured host names). This stops DNS rebinding;
- refuses any request with an `Origin` that was not allowed by name. This stops a web page from calling the server;
- reads at most 1 MB of body, declared or streamed, and answers 413 beyond;
- answers `POST /mcp`, `GET /healthz` and, if configured, the domain-verification token; everything else is 404 or 405;
- sends `Cache-Control: no-store` and `X-Content-Type-Options: nosniff`;
- creates a new server object for each request and keeps no session.

Public mode has no authentication, because the server holds no data and no account: every tool is declared `noauth`. Put a rate limit in front of a public deployment; the server itself only caps concurrent requests.

Inputs ([`src/schemas.js`](src/schemas.js)): every tool takes a strict object (unknown properties are refused). A document is at most 400 kB, a portfolio 900 kB, nesting at most 48 levels; at most 12 workflows, 6 journeys and 100 events per call; property names `__proto__`, `constructor` and `prototype` are refused. A document is never an address: the server does not fetch.

### What simulation means here

A document comes from a conversation and is not trusted. [`src/simulation.js`](src/simulation.js) is the only place that creates a `WorkflowEngine` or an `AwaRuntime`, and it creates them so that nothing a document names is executed:

- every actor type (application, AI agent, human, robot) is replaced by one simulated actor, so the SDK's own actors are never constructed;
- the engine runs with `simulate: true`: its tool runner records a call as simulated and executes no binding. Command bindings are also refused by policy and are not attempted;
- no model provider, API key, knowledge base, journal file, checkpoint directory, runtime store, decision engine or event sink is supplied;
- the clock is virtual: timers, deadlines and retry delays advance it instead of waiting;
- a run stops after 400 steps, 200 tokens or 8 seconds.

A simulated activity returns what the caller scripts in `simulated_outputs` and nothing else. A run whose conditions read business data therefore stops with `NO_ROUTE` or `CONTRACT_VIOLATION` until the caller supplies it; the tool says so. A cost is computed only from the rates and usage the caller gives.

[`tests/simulation-safety.test.js`](tests/simulation-safety.test.js) checks this with a workflow whose tools would create a file, call an HTTP endpoint and a JSON-RPC endpoint: no file appears, no request arrives, no process starts, no connection opens. A control in the same file runs the same workflow through the SDK with simulation off and confirms that the file is then created and the endpoints are reached, so the test would notice an execution.

### Widgets

Each widget is one HTML document: a view from `tools/visualization` with its local scripts inlined, sample data left out, and three scripts added: [`network-off.js`](src/widgets/network-off.js) first (it disables `fetch`, `XMLHttpRequest`, `EventSource` and `WebSocket`, because the views can load a record from an address when opened as ordinary pages), then [`host-bridge.js`](src/widgets/host-bridge.js) (the MCP Apps bridge) and a few lines that hand the tool result to the view.

They are declared with an empty Content-Security-Policy domain list (`_meta.ui.csp` and `openai/widgetCSP`), take the host's maximum height and display mode (inline and fullscreen), and escape what they draw: the views use their own `esc` on every value, and the added code does the same.

Theme: the workflow and replay widgets follow the host's light or dark theme. The journey view is drawn dark in both: its stage is a fixed dark design, and it is scaled to its frame (it is designed for 1440 by 900, so it is small on a phone when shown inline).

One hook was added to a view for this: `window.AWA_show = show;` in `tools/visualization/journey.html`. The replay view already exposed `window.AWAReplay`.

## Adding a widget

A widget is one entry in `WIDGETS` in [`src/widgets.js`](src/widgets.js). `bundle_widget` does the work: it inlines the HTML file's local scripts, leaves out the ones you name, adds your styles and scripts, and refuses the result if anything in it would load from elsewhere.

This is how the dashboard (`tools/visualization/dashboard.html`) was added:

1. In `src/widgets.js`, add (a commented copy is already there):

   ```js
   dashboard: {
       uri: 'ui://awa/dashboard-v1.html',
       description: 'Key figures of journeys and runs…',
       bundle: { html: view('dashboard.html'), drop: ['dashboard-sample.js'], scripts: [own('host-bridge.js'), own('dashboard-bridge.js')] },
   },
   ```

2. Write `src/widgets/dashboard-bridge.js`. It is the same forty lines as [`journey-bridge.js`](src/widgets/journey-bridge.js): connect, and in `onResult` hand `result._meta.awa` to the view.

   ```js
   var host = window.AWA_HOST.connect({
       name: 'awa-dashboard',
       onResult: function (result) { var awa = result._meta && result._meta.awa; if (awa && awa.view === 'dashboard') window.AWA_dashboard_show(awa.kpis); },
       preferredHeight: function (width) { return 640; },
   });
   ```

   If the view has no function to receive data, add one to it, as `journey.html` has `window.AWA_show`.

3. In [`src/server.js`](src/server.js), register the tool and pass `{ widget: 'dashboard', … }`. The resource, its metadata and the tool's `_meta.ui.resourceUri` follow from the entry.

4. Add the tool to `TOOLS` in `tests/tools.test.js` and to `EXPECTED_TOOLS` and `CALLS` in `scripts/verify-widgets.mjs`, with a block that delivers the result and checks what is drawn. `tests/widgets.test.js` already checks every entry of `WIDGETS`.

Change the version in the `uri` when the HTML changes in a way a host must not serve from its cache.

## Tests and verification

```bash
npm test
```

runs the unit tests: the tools, the input limits, statelessness, simulation safety, the HTTP entry point (Host, Origin, body limit, loopback, public mode), stdio, the widget bundler and the plugin package.

```bash
NODE_PATH=$(npm root -g) npm run verify
```

needs Playwright with Chromium. It lists the tools and resources through an MCP client, calls every tool, then loads each widget in Chromium inside a fake MCP Apps host (an iframe sandboxed without same-origin access, served with a policy that allows no network), delivers the tool results through the bridge and checks what is drawn: the example at every height of the journey view, simulated journeys, the workflow graph and its Data tab, the replay stepped through, hostile names shown as text, light and dark themes, maximum height, fullscreen, a 390 px wide frame, that every message a widget sends is valid against the MCP Apps SDK's schemas, and that no request leaves the page. Screenshots and `verification.json` go to `artifacts/verify/`. `npm run preview` serves the fake host for you to look at.

```bash
npm run plugin:check
```

checks `plugins/awa` against the submission rules and lists the placeholders.

CI does not run these yet. A job would be: build the SDK, `npm ci` here, `npm test`, then `npx playwright install chromium` and `npm run verify` with `--playwright-module` pointing at Playwright.

## Layout

| Path | What |
|---|---|
| `src/server.js` | The tools and resources |
| `src/simulation.js` | The simulation boundary |
| `src/awa.js` | Validation in plain words, the data view of a workflow, summaries |
| `src/schemas.js`, `src/limits.js` | Input schemas and bounds |
| `src/widgets.js`, `src/widgets/` | The widget bundler, the bridge and what is added to each view |
| `src/http.js`, `src/start.js` | HTTP and stdio entry points |
| `src/example.js` | The bundled claims example |
| `scripts/` | Widget verification, plugin check and packaging |
| `legal/` | Privacy notice, terms, support page |
| `clients/` | Configuration snippets for MCP clients |
