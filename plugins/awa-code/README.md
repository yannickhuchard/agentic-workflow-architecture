# AWA plugin for coding assistants

Validate, show and simulate [Agentic Workflow Architecture](../../README.md) workflows and customer journeys from Claude Code, Cursor, Mistral Vibe and Gemini CLI. One folder holds the plugin in each assistant's format:

| File or folder | Read by | What |
|---|---|---|
| `.claude-plugin/plugin.json`, `.mcp.json` | Claude Code; Mistral Vibe reads the same format | The plugin `awa`, its MCP server and the option **AWA repository folder** |
| `.cursor-plugin/plugin.json`, `mcp.json` | Cursor | The plugin `awa`, its MCP server and the variable `AWA_REPOSITORY` |
| `gemini-extension.json`, `GEMINI.md` | Gemini CLI | The extension `awa`, its MCP server and its context |
| `skills/agentic-workflow-architecture/` | all | The AWA skill, a copy of [`skills/agentic-workflow-architecture`](../../skills/agentic-workflow-architecture) |
| `skills/validate/`, `show/`, `simulate/`, `example/` | Claude Code, Cursor, Mistral Vibe | The commands: `/awa:validate <file>`, `/awa:show <workflow>`, `/awa:simulate <workflow> [outputs]`, `/awa:example` |
| `rules/awa-documents.mdc` | Cursor | The rule for `.awa.json` and `.journey.json` files (also in [`.cursor/rules`](../../.cursor/rules)) |
| `server/start.mjs` | all | Starts the AWA MCP server ([`apps/mcp-server`](../../apps/mcp-server)) over stdio from a clone of this repository |
| `assets/` | Claude Code, Cursor, the MCP Bundle | Icons |

The MCP server has eight tools: `validate_document`, `show_workflow`, `simulate_workflow`, `show_journeys`, `simulate_journey`, `load_claims_example`, `show_dashboard` and `make_dossier`. Everything is a simulation: no tool, command, model or production system is called, and nothing is stored.

**Install it:** follow [Connect AWA to your AI assistant](../../docs/guides/connect-ai-assistants.md). In Claude Code, from a built clone: `/plugin marketplace add ./`, then `/plugin install awa@agentic-workflow-architecture`.

## How the server is found

The server is not hosted yet, so the plugin starts it from a clone of this repository, built as the guide says. `server/start.mjs` looks for the clone in this order and starts the first one it finds:

1. `AWA_REPOSITORY`, the folder the user gave (Claude Code's option **AWA repository folder**, Cursor's variable, Gemini CLI's setting);
2. the repository around this folder, when the plugin is used where it lies in the clone (a Claude Code marketplace added from the clone, a linked Gemini CLI extension, a symbolic link in `~/.vibe/plugins` or `~/.cursor/plugins/local`);
3. the project the assistant works in, when it is the clone.

When it finds none, or the clone is not built, it says so on standard error, with the commands to run, and stops.

When the server is hosted, `npm run hosted:set -- https://<host>/mcp` in `apps/mcp-server` points every manifest here at its address, and the plugin no longer needs a clone.

## Keep the copies equal

The AWA skill and the Cursor rule exist in more than one place. Edit the folder [`skills/agentic-workflow-architecture`](../../skills/agentic-workflow-architecture) (its `SKILL.md`, `references/`, `assets/` and `scripts/`) and copy the whole folder to `skills/agentic-workflow-architecture/` here and to `.agent/skills/agentic-workflow-architecture/` (from the repository root: `for d in plugins/awa-code/skills .agent/skills; do rm -rf $d/agentic-workflow-architecture && cp -r skills/agentic-workflow-architecture $d/; done`); edit `rules/awa-documents.mdc` here and copy it to `.cursor/rules/`. `npm test` in `apps/mcp-server` fails while they differ.

## Check it

```bash
claude plugin validate plugins/awa-code       # the Claude Code plugin
claude plugin validate .                      # the marketplace
cd apps/mcp-server && npm test                # every manifest, and the server started from each configuration
cd apps/mcp-server && npm run clients:schemas # the manifests against the schemas each format publishes
```
