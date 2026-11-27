# AWA plugin package

The package that is uploaded to the plugin directory: `plugin.json` (identity, listing, review cases, release notes), `mcp.json` (where the MCP server is) and `assets/` (icons).

The MCP server itself is in [`apps/mcp-server`](../../apps/mcp-server). What is ready, what is a placeholder and what only the publisher can do is in [`apps/mcp-server/SUBMISSION.md`](../../apps/mcp-server/SUBMISSION.md).

**Placeholder:** the address in `mcp.json`, `https://awa-mcp.placeholder.invalid/mcp`, does not exist. The server is not hosted anywhere yet. Do not upload this folder as it is: build the package with the real address,

```bash
cd apps/mcp-server
npm run plugin:package -- https://<your host>/mcp --demo https://<recording>
```

which checks the package and writes it to `apps/mcp-server/dist/plugins/awa/`.

To use the server today, connect to it directly in developer mode through a tunnel, or install this package in Codex or the ChatGPT desktop app from the repository's local marketplace (`.agents/plugins/marketplace.json`) with your tunnel address in `mcp.json`: the steps are in **[Connect AWA to your AI assistant](../../docs/guides/connect-ai-assistants.md#chatgpt)**, which also covers Claude, Mistral, Cursor and Gemini CLI.

When the server is hosted, `npm run hosted:set -- https://<host>/mcp` in `apps/mcp-server` writes the address into this package's `mcp.json` and into the other packages.
