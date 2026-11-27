# Connect AWA to your AI assistant

The AWA plugin lets an AI assistant validate, show and simulate [Agentic Workflow Architecture](../../README.md) workflows and customer journeys. It works with Claude (Claude Code, Claude Desktop, claude.ai), ChatGPT (and Codex), Mistral (Le Chat and Mistral Vibe), Cursor and Gemini CLI, and with any other MCP client.

Every package connects the same AWA MCP server ([`apps/mcp-server`](../../apps/mcp-server)). Today the server runs on your own computer: the assistant starts it from your clone of this repository, or reaches it through a tunnel. When the server is hosted, one command points every package at its public address (see [Switch to the hosted address](#switch-to-the-hosted-address)).

## What you get

Seven tools, the same in every assistant:

| Tool | What it does | View |
|---|---|---|
| `validate_document` | Checks a workflow or journey against the AWA schema and its integrity rules, and returns each problem in plain words | none |
| `show_workflow` | Shows a workflow as a graph: activities with actor type and role, decisions, events, and the data that moves | workflow graph |
| `simulate_workflow` | Runs a workflow once in simulation and replays it: path, decisions, waits, simulated tool calls, failures, cost | run replay |
| `show_journeys` | Shows customer journeys from a portfolio export, or from journeys and workflows with events to play | journey view |
| `simulate_journey` | Plays business events through journeys in simulation and shows where each customer stands | journey view |
| `load_claims_example` | Opens the bundled fictional claims example (3 journeys, 5 workflows, 6 customers) and hands out its documents | journey view |
| `show_dashboard` | The measures of journeys and workflows: who is stuck, who is to act, outcomes, rework, waiting, cost | dashboard |

Everything is a simulation: no tool binding, command, HTTP call, model or production system is ever called. Documents are passed inline in the conversation and nothing is stored between calls. The views appear in assistants that display MCP Apps (ChatGPT, Claude Desktop and claude.ai); everywhere else the tools answer in text with the same facts.

The plugin for coding assistants, [`plugins/awa-code`](../../plugins/awa-code), adds:

- the **AWA skill**, the guide to writing AWA documents with the SDK, the command line and the JSON format;
- four **commands**: `validate`, `show`, `simulate` and `example` (in Claude Code, `/awa:validate` and so on);
- **rules** for `.awa.json` and `.journey.json` files (Cursor).

## Which assistant, which way

| Assistant | Package | Works today | What it needs today | After hosting |
|---|---|---|---|---|
| Claude Code | Plugin from this repository's marketplace | Yes | A built clone | No clone needed |
| Claude Desktop | MCP Bundle (`.mcpb`), or the configuration file | Yes | A built clone (the bundle is built from it) | Add the hosted address as a connector, or keep the bundle |
| claude.ai (web, mobile) | Custom connector | Yes, with a tunnel | A built clone, a tunnel | Paste the hosted address |
| ChatGPT | Custom MCP server in developer mode | Yes, with a tunnel | A built clone, a tunnel | Paste the hosted address; later, the plugin directory |
| Codex, ChatGPT desktop app | Local marketplace, or `codex mcp add` | Yes | A built clone (and a tunnel for the marketplace plugin) | The marketplace plugin points at the hosted address |
| Le Chat (Mistral) | Custom MCP connector | Yes, with a tunnel | A built clone, a tunnel, admin rights in Le Chat | Paste the hosted address |
| Mistral Vibe | `vibe mcp add`, or the plugin folder | Yes | A built clone | No clone needed |
| Cursor | Project configuration, Add to Cursor link, or the plugin | Yes | A built clone | No clone needed; the plugin can go to the Cursor Marketplace |
| Gemini CLI | Extension | Yes | A built clone | No clone needed |

A tunnel gives the server on your computer a temporary public HTTPS address. Assistants that run in the cloud (ChatGPT, claude.ai, Le Chat) need one, because they cannot reach your computer directly.

## Before you start

You need [Node.js](https://nodejs.org) 20 or later and [git](https://git-scm.com). Check with `node --version`.

1. Clone the repository into your home folder. The rest of this guide assumes `~/agentic-workflow-architecture`; if you put it elsewhere, use your path wherever this guide writes that one.

   ```bash
   cd ~
   git clone https://github.com/yannickhuchard/agentic-workflow-architecture
   ```

2. Build the SDK, then install the server:

   ```bash
   cd ~/agentic-workflow-architecture/sdk/typescript && npm ci && npm run build
   cd ~/agentic-workflow-architecture/apps/mcp-server && npm ci
   ```

3. Check that the server starts:

   ```bash
   node ~/agentic-workflow-architecture/plugins/awa-code/server/start.mjs
   ```

   It prints `AWA MCP server: starting from /home/you/agentic-workflow-architecture` and waits for a client. Stop it with Ctrl+C. If it says the repository is not built, it prints the commands to run.

After `git pull`, run step 2 again, then restart the assistant or reconnect the server.

## Claude Code

The repository is a Claude Code plugin marketplace ([`.claude-plugin/marketplace.json`](../../.claude-plugin/marketplace.json)) named `agentic-workflow-architecture`, with one plugin, `awa`.

1. Start Claude Code anywhere.
2. Add the marketplace from your clone:

   ```text
   /plugin marketplace add ~/agentic-workflow-architecture
   ```

3. Install the plugin:

   ```text
   /plugin install awa@agentic-workflow-architecture
   ```

   Claude Code may show a dialog for the option **AWA repository folder**. Leave it empty: a marketplace added from a folder loads the plugin where it lies, and the plugin finds the repository around it.
4. Run `/reload-plugins`, or start a new session.
5. Run `/mcp`. You should see `plugin:awa:awa` connected, with 7 tools.
6. Try it: `/awa:example` opens the claims example and its dashboard; `/awa:validate path/to/workflow.awa.json` checks a file of yours; `/awa:show` and `/awa:simulate` show and simulate a workflow. You can also simply ask, for example "Validate examples/claims-settlement/claims-settlement.awa.json".

**From GitHub instead of your clone.** `/plugin marketplace add yannickhuchard/agentic-workflow-architecture` works too, once this plugin is on the repository's main branch. Claude Code then copies the plugin into its cache, away from your clone, so give the clone's folder when the dialog asks for **AWA repository folder** (or later with `/plugin`, the AWA plugin, **Configure**). In one step, on recent versions of Claude Code: `/plugin install awa --marketplace yannickhuchard/agentic-workflow-architecture`. From the shell: `claude plugin install awa@agentic-workflow-architecture --config repository=$HOME/agentic-workflow-architecture`.

**Only the server, without the plugin.** `claude mcp add awa -- node ~/agentic-workflow-architecture/plugins/awa-code/server/start.mjs`

**Troubleshooting**

- `/mcp` shows the server failed: run the check in step 3 of [Before you start](#before-you-start); its message says what is missing.
- "the AWA repository was not found": set **AWA repository folder** with `/plugin`, the AWA plugin, **Configure**, then `/reload-plugins`.
- The commands do not appear: run `/plugin`, open the **Errors** tab.

## Claude Desktop

Choose one of three ways.

### A. The MCP Bundle (one click)

An MCP Bundle is a single `.mcpb` file holding the server and everything it needs. Claude Desktop runs it with the Node.js it ships with.

1. Build the bundle from your clone (it downloads the server's dependencies from npm):

   ```bash
   cd ~/agentic-workflow-architecture/apps/mcp-server
   npm run bundle:mcpb
   ```

   It writes `apps/mcp-server/dist/awa-workflows-0.1.0.mcpb` (about 30 MB) and prints `the server starts over stdio and lists 7 tools`.
2. Double-click the file, or drag it into the Claude Desktop window, or open **Settings**, **Extensions**, **Advanced settings**, **Install Extension** and choose it.
3. Review the details and select **Install**.
4. In a conversation, select the **+** button below the message box, then **Connectors**: **AWA Workflows & Journeys** is listed with its 7 tools.
5. Ask: "Load the AWA claims example and show its dashboard."

The bundle does not need the clone once it is installed. Rebuild and reinstall it after an update.

### B. The configuration file

1. Open Claude Desktop's settings from the Claude menu of your system's menu bar (not the settings inside the window), then **Developer**, **Edit Config**. This opens `claude_desktop_config.json` (macOS `~/Library/Application Support/Claude/`, Windows `%APPDATA%\Claude\`, Linux `~/.config/Claude/`).
2. Add the `awa` entry of [`apps/mcp-server/clients/stdio.json`](../../apps/mcp-server/clients/stdio.json), with the absolute path of your clone:

   ```json
   {
     "mcpServers": {
       "awa": {
         "command": "node",
         "args": ["/Users/you/agentic-workflow-architecture/apps/mcp-server/src/start.js", "--stdio"]
       }
     }
   }
   ```

3. Quit Claude Desktop completely and open it again.
4. Check as in step 4 of A.

If the server does not connect, read the logs: macOS `~/Library/Logs/Claude/mcp*.log`, Windows `%APPDATA%\Claude\logs`. A path must be absolute; on Windows write it with `\\` or `/`.

### C. A connector

Claude Desktop also shows the custom connectors of your claude.ai account: follow [claude.ai](#claudeai-web-and-mobile).

## claude.ai (web and mobile)

claude.ai reaches servers from Anthropic's cloud, so today it needs a tunnel to the server on your computer. Custom connectors are available on every plan (one on the Free plan); on Team and Enterprise plans an owner adds them.

1. [Open a tunnel and start the server in public mode](#open-a-tunnel). Keep both running.
2. On claude.ai open **Settings**, **Connectors**, then **Add custom connector**.
3. Name it `AWA`, paste `https://<your tunnel host>/mcp`, and select **Add**. The server needs no authentication.
4. In a conversation, select **+**, **Connectors**, and turn **AWA** on.
5. Ask: "Load the AWA claims example and show its dashboard." The journey view and the dashboard open in the conversation.

The tunnel address changes each time you restart a free tunnel: remove the connector and add it again with the new address. After hosting, add the hosted address once.

## ChatGPT

### Developer mode, with a tunnel

1. [Open a tunnel and start the server in public mode](#open-a-tunnel).
2. In ChatGPT open **Plugins**, select the **+** button, then **Add custom MCP server**. If you do not see it, turn on developer mode in ChatGPT's settings first.
3. Paste `https://<your tunnel host>/mcp`, choose no authentication, accept the warning about custom servers, and create the plugin.
4. In a conversation, turn the plugin on and ask: "Load the AWA claims example and walk me through one customer's journey." The journey view opens.
5. After a change to the server, refresh the connection in the plugin's settings.

### Codex and the ChatGPT desktop app

**The server alone, over stdio (no tunnel):**

```bash
codex mcp add awa -- node ~/agentic-workflow-architecture/plugins/awa-code/server/start.mjs
```

**The plugin from the local marketplace.** The repository is also a Codex marketplace ([`.agents/plugins/marketplace.json`](../../.agents/plugins/marketplace.json), named `awa-local`) that lists the ChatGPT package [`plugins/awa`](../../plugins/awa). That package connects to a remote address, which is a placeholder until the server is hosted. To use it today:

1. [Open a tunnel and start the server in public mode](#open-a-tunnel).
2. In your clone, replace the `url` in `plugins/awa/mcp.json` with `https://<your tunnel host>/mcp`. Do not commit this change.
3. Run `codex plugin marketplace add ~/agentic-workflow-architecture`, or restart the ChatGPT desktop app with the clone open.
4. Open the plugins directory, choose the `awa-local` marketplace and install **AWA Workflows & Journeys**.

### The plugin directory (after hosting)

The package in [`plugins/awa`](../../plugins/awa) is written for the ChatGPT plugin directory, with its listing and review cases. It is not submitted yet: the server must be hosted first. What remains is in [`apps/mcp-server/SUBMISSION.md`](../../apps/mcp-server/SUBMISSION.md). Once listed, users install it from the directory with no setup.

## Mistral

### Le Chat

Le Chat accepts a remote MCP server as a custom connector. Adding one needs admin rights in your Le Chat workspace (on individual plans, you are the admin). Today it needs a tunnel.

1. [Open a tunnel and start the server in public mode](#open-a-tunnel).
2. In Le Chat open **Intelligence**, **Connectors**, then **Add Connector**, and choose **Custom MCP Connector**.
3. Name it `AWA`, paste `https://<your tunnel host>/mcp`, and add a description if you like: the one in [`apps/mcp-server/clients/remote-connector.json`](../../apps/mcp-server/clients/remote-connector.json) fits.
4. Le Chat detects the authentication from the address: it finds none, which is right for this server. Create the connector.
5. In a conversation, turn the AWA connector on from the tools menu and ask: "Load the AWA claims example. Who is stuck, and who should act?"

Le Chat answers in text from the tools' results.

### Mistral Vibe

Mistral Vibe, Mistral's coding agent for the terminal, starts MCP servers from its configuration.

1. Add the server:

   ```bash
   vibe mcp add awa --transport stdio --command node --arg ~/agentic-workflow-architecture/plugins/awa-code/server/start.mjs
   ```

   This writes the table in [`apps/mcp-server/clients/mistral-vibe.toml`](../../apps/mcp-server/clients/mistral-vibe.toml) into `~/.vibe/config.toml`. You can also paste that table yourself, or into `.vibe/config.toml` of a project you trust.
2. Start `vibe` and ask: "Which AWA tools do you have?" It lists the seven tools, named after the `awa` server.

**With the skill and the commands.** Vibe also loads plugins written in Claude Code's format from `~/.vibe/plugins`. Link the plugin folder there instead of step 1:

```bash
mkdir -p ~/.vibe/plugins
ln -s ~/agentic-workflow-architecture/plugins/awa-code ~/.vibe/plugins/awa
```

Vibe then has the `awa` server and the skills `awa:agentic-workflow-architecture`, `awa:validate`, `awa:show`, `awa:simulate` and `awa:example`.

## Cursor

Choose one of three ways.

### A. Open the clone in Cursor

The repository carries [`.cursor/mcp.json`](../../.cursor/mcp.json) and the rule [`.cursor/rules/awa-documents.mdc`](../../.cursor/rules/awa-documents.mdc).

1. Open `~/agentic-workflow-architecture` in Cursor.
2. Open **Cursor Settings**, then the MCP section, and turn on the `awa` server. It shows 7 tools.
3. Open an `.awa.json` file and ask the agent: "Validate this workflow." The rule for AWA documents applies to these files.

### B. Add to Cursor, for every project

[![Add the AWA MCP server to Cursor](https://cursor.com/deeplink/mcp-install-dark.svg)](https://cursor.com/en/install-mcp?name=awa&config=eyJjb21tYW5kIjoibm9kZSIsImFyZ3MiOlsiJHt1c2VySG9tZX0vYWdlbnRpYy13b3JrZmxvdy1hcmNoaXRlY3R1cmUvcGx1Z2lucy9hd2EtY29kZS9zZXJ2ZXIvc3RhcnQubWpzIl19)

1. Select the button above, or paste this link into your browser's address bar:

   ```text
   cursor://anysphere.cursor-deeplink/mcp/install?name=awa&config=eyJjb21tYW5kIjoibm9kZSIsImFyZ3MiOlsiJHt1c2VySG9tZX0vYWdlbnRpYy13b3JrZmxvdy1hcmNoaXRlY3R1cmUvcGx1Z2lucy9hd2EtY29kZS9zZXJ2ZXIvc3RhcnQubWpzIl19
   ```

   It installs `{"command":"node","args":["${userHome}/agentic-workflow-architecture/plugins/awa-code/server/start.mjs"]}` into your Cursor configuration. Cursor fills in `${userHome}`.
2. Cursor shows the server and asks you to confirm. Install it.
3. Check in **Cursor Settings**, MCP section: `awa` is on, with 7 tools.

If your clone is elsewhere, make links for your path: `node ~/agentic-workflow-architecture/apps/mcp-server/scripts/cursor-link.mjs /path/to/your/clone`. You can also paste the same entry into `~/.cursor/mcp.json` yourself.

### C. The Cursor plugin

[`plugins/awa-code`](../../plugins/awa-code) is also a Cursor plugin ([`.cursor-plugin/plugin.json`](../../plugins/awa-code/.cursor-plugin/plugin.json)): the server, the AWA skill, the rule and the four commands. The repository lists it in [`.cursor-plugin/marketplace.json`](../../.cursor-plugin/marketplace.json).

1. Link it into Cursor's local plugins folder:

   ```bash
   mkdir -p ~/.cursor/plugins/local
   ln -s ~/agentic-workflow-architecture/plugins/awa-code ~/.cursor/plugins/local/awa
   ```

2. Reload Cursor. When it asks for **AWA repository folder**, give the absolute path of your clone.
3. Check in **Cursor Settings** that the plugin and its `awa` server are on.

**Cursor Marketplace (later).** Cursor reviews every plugin by hand before listing it. Once the server is hosted (so that the plugin needs no clone), submit the repository at [cursor.com/marketplace/publish](https://cursor.com/marketplace/publish): it reads `.cursor-plugin/marketplace.json` and the plugin's manifest.

## Gemini CLI

[`plugins/awa-code`](../../plugins/awa-code) is also a Gemini CLI extension ([`gemini-extension.json`](../../plugins/awa-code/gemini-extension.json)), with [`GEMINI.md`](../../plugins/awa-code/GEMINI.md) as its context.

1. Link the extension, so that it stays in your clone and follows your updates:

   ```bash
   gemini extensions link ~/agentic-workflow-architecture/plugins/awa-code
   ```

   With `gemini extensions install ~/agentic-workflow-architecture/plugins/awa-code` instead, Gemini CLI keeps a copy: give your clone's folder when it asks for **AWA repository folder** (or later with `gemini extensions config awa`).
2. Start `gemini` and run `/mcp`: the `awa` server is listed with 7 tools.
3. Ask: "Validate examples/claims-settlement/claims-settlement.awa.json with the AWA tools."

## Any other MCP client

- **Clients that start a local server:** command `node`, arguments `~/agentic-workflow-architecture/plugins/awa-code/server/start.mjs` (or `apps/mcp-server/src/start.js --stdio`). Snippet: [`clients/stdio.json`](../../apps/mcp-server/clients/stdio.json).
- **Clients that connect to an address on your computer:** run `npm start` in `apps/mcp-server` and connect to `http://127.0.0.1:8787/mcp` (Streamable HTTP). Snippet: [`clients/local-development.json`](../../apps/mcp-server/clients/local-development.json).
- **To try the tools without an assistant:** `npx @modelcontextprotocol/inspector@latest`, Streamable HTTP, `http://127.0.0.1:8787/mcp`.

## Open a tunnel

ChatGPT, claude.ai and Le Chat need a public HTTPS address. A tunnel lends one to the server on your computer for as long as it runs. Any tunnel works; two common ones:

| Tunnel | Command | Address it prints |
|---|---|---|
| [ngrok](https://ngrok.com/download) (free account) | `ngrok http 8787` | `https://<name>.ngrok-free.app` |
| [Cloudflare quick tunnel](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/do-more-with-tunnels/trycloudflare/) (no account) | `cloudflared tunnel --url http://localhost:8787` | `https://<name>.trycloudflare.com` |

1. In one terminal, start the tunnel and copy the HTTPS address it prints.
2. In a second terminal, start the server and tell it that address, followed by `/mcp`:

   ```bash
   cd ~/agentic-workflow-architecture/apps/mcp-server
   AWA_MCP_PUBLIC_URL=https://<your tunnel host>/mcp npm start
   ```

   On Windows PowerShell: `$env:AWA_MCP_PUBLIC_URL="https://<your tunnel host>/mcp"; npm start`.

   It prints `AWA MCP server serving https://<your tunnel host>/mcp`. The server still listens on your computer only; it now also answers requests addressed to the tunnel's host name.
3. Check from a browser: `https://<your tunnel host>/healthz` answers `{"status":"ok","server":"awa-mcp-server","version":"0.1.0","mode":"public"}`.
4. Give the assistant `https://<your tunnel host>/mcp`.

Anyone who knows the address can call the tools while the tunnel runs. They only simulate and store nothing, but stop the tunnel when you are done.

If the assistant reports 403, the host name in `AWA_MCP_PUBLIC_URL` differs from the tunnel's: restart the server with the address the tunnel printed.

## Switch to the hosted address

When the server is hosted at a public address, the maintainer runs one command in `apps/mcp-server`:

```bash
npm run hosted:set -- https://<hosted host>/mcp
```

It writes the address into every package: the Claude Code plugin and Mistral Vibe (an HTTP server instead of the local one, and no folder to ask for), the Cursor plugin, the Gemini CLI extension, the ChatGPT and Codex package (`plugins/awa/mcp.json`), and [`clients/remote-connector.json`](../../apps/mcp-server/clients/remote-connector.json). Then `npm test`, update the table at the top of this guide, and commit.

What users do then:

| Assistant | Step |
|---|---|
| ChatGPT, claude.ai, Claude Desktop connectors, Le Chat | Replace the tunnel address with the hosted address in the connector |
| Claude Code | `/plugin marketplace update agentic-workflow-architecture`, then `/reload-plugins`. New users install from GitHub with no clone |
| Cursor, Gemini CLI, Mistral Vibe | Update the plugin or extension (for a linked folder, `git pull`). The Add to Cursor link for the hosted address comes from `node apps/mcp-server/scripts/cursor-link.mjs https://<hosted host>/mcp` |
| Codex, ChatGPT desktop app | Update the marketplace; nothing to edit |

The local ways keep working for anyone who prefers to run the server on their own computer.

## Common problems

| What you see | What to do |
|---|---|
| `the AWA repository was not found` | Give the plugin your clone's folder (Claude Code: **Configure**; Cursor: the **AWA repository folder** variable; Gemini CLI: `gemini extensions config awa`), or set `AWA_REPOSITORY` |
| `the repository at <path> is not built yet` | Run the commands it prints, then reconnect the server |
| `Node <version> is too old` | Install Node.js 20 or later |
| The tools are missing after an install | Restart the assistant, or reload its plugins or MCP servers |
| 403 through a tunnel | Restart the server with `AWA_MCP_PUBLIC_URL` set to the tunnel's address |
| The tool answers but no view opens | The assistant does not display MCP Apps; the text answer carries the same facts |
| A run stops with `NO_ROUTE` or `CONTRACT_VIOLATION` | The workflow reads business data that the simulation was not given: pass the example's `simulation.json` as simulated outputs |

## Where each package lives

| Path | What |
|---|---|
| [`plugins/awa-code`](../../plugins/awa-code) | The plugin for coding assistants: `.claude-plugin/` (Claude Code, read by Mistral Vibe too), `.cursor-plugin/`, `gemini-extension.json`, `skills/`, `rules/`, `server/start.mjs` |
| [`.claude-plugin/marketplace.json`](../../.claude-plugin/marketplace.json) | The Claude Code marketplace |
| [`.cursor-plugin/marketplace.json`](../../.cursor-plugin/marketplace.json), [`.cursor/`](../../.cursor) | The Cursor marketplace, and the project configuration and rule |
| [`plugins/awa`](../../plugins/awa), [`.agents/plugins/marketplace.json`](../../.agents/plugins/marketplace.json) | The ChatGPT package and the Codex marketplace |
| [`apps/mcp-server/mcpb/manifest.json`](../../apps/mcp-server/mcpb/manifest.json) | The MCP Bundle for Claude Desktop (`npm run bundle:mcpb`) |
| [`apps/mcp-server/clients`](../../apps/mcp-server/clients) | Snippets: stdio, local HTTP, Mistral Vibe, remote connector |

The package tests are in [`apps/mcp-server/tests/clients.test.js`](../../apps/mcp-server/tests/clients.test.js): they start the server from each configuration. `npm run clients:schemas` checks each manifest against the schema its format publishes.

## Sources

These steps follow each vendor's documentation as of 27 November 2026.

- Read: Claude Code [plugin manifest reference](https://code.claude.com/docs/en/plugins-reference), [marketplace reference](https://code.claude.com/docs/en/plugins/marketplace-reference), [plugin loading](https://code.claude.com/docs/en/plugins/loading) and [plugin components](https://code.claude.com/docs/en/plugins/components); Claude's [MCP Bundles page](https://claude.com/docs/connectors/building/mcpb) and [local servers in Claude Desktop](https://support.claude.com/en/articles/10949351-getting-started-with-local-mcp-servers-on-claude-desktop); the [MCPB specification and command line](https://github.com/modelcontextprotocol/mcpb); the MCP documentation on [connecting local servers](https://github.com/modelcontextprotocol/modelcontextprotocol/tree/main/docs/docs); OpenAI's [plugin build guide](https://developers.openai.com/plugins/build/plugins); the plugin schemas and examples in [cursor/plugins](https://github.com/cursor/plugins); Gemini CLI's [extension reference](https://github.com/google-gemini/gemini-cli/blob/main/docs/extensions/reference.md); the source of [Mistral Vibe](https://github.com/mistralai/mistral-vibe) (its configuration, `vibe mcp add` and its reader for Claude Code plugins).
- Followed through summaries, because the pages could not be opened from the environment where this guide was written: Cursor's [MCP](https://cursor.com/docs/mcp), [install links](https://cursor.com/docs/mcp/install-links) and [plugins](https://cursor.com/docs/plugins); Mistral's [MCP connectors](https://docs.mistral.ai/le-chat/knowledge-integrations/connectors/mcp-connectors), [custom connector help](https://help.mistral.ai/en/articles/393572-configuring-a-custom-connector) and [Vibe MCP servers](https://docs.mistral.ai/vibe/code/cli/mcp-servers); Claude's [custom connectors](https://support.claude.com/en/articles/11175166-get-started-with-custom-connectors-using-remote-mcp). Menu labels in these sections are the ones those pages give; if your version names them differently, look for the same words nearby.

What was run and what was not is in [`apps/mcp-server/SUBMISSION.md`](../../apps/mcp-server/SUBMISSION.md#client-packages).
