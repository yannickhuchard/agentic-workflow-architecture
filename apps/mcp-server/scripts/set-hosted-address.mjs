#!/usr/bin/env node
// Points every AWA plugin package at the hosted server, in one step.
//
//   npm run hosted:set -- https://<host>/mcp
//
// Until the server is hosted, the packages start it from a clone of this repository (stdio) or wait for an
// address the user gives (a tunnel). Once it is hosted, this script writes its address into:
//   plugins/awa-code/.mcp.json                   Claude Code (and Mistral Vibe): an http server instead of stdio
//   plugins/awa-code/.claude-plugin/plugin.json  the repository folder option is no longer asked for
//   plugins/awa-code/mcp.json                    Cursor: a url instead of a command
//   plugins/awa-code/.cursor-plugin/plugin.json  the repository folder variable is no longer asked for
//   plugins/awa-code/gemini-extension.json       Gemini CLI: httpUrl instead of a command
//   plugins/awa/mcp.json                         ChatGPT and Codex
//   apps/mcp-server/clients/remote-connector.json
//   .claude-plugin/marketplace.json              the description no longer asks for a clone
// server/start.mjs stays, for anyone who prefers to run the server on their own computer.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { REPOSITORY_ROOT } from '../src/sdk.js';
import { is_placeholder } from './plugin-rules.mjs';

const NEEDS_CLONE = 'Needs a built clone of this repository until the server is hosted.';
const HOSTED = 'Connects to the hosted AWA MCP server.';

export function check_address(url) {
    let parsed;
    try { parsed = new URL(url); } catch { throw new Error(`Not an address: ${url}`); }
    if (parsed.protocol !== 'https:' || parsed.username || parsed.password) throw new Error('The hosted address must be https, without credentials');
    if (!parsed.pathname.endsWith('/mcp')) throw new Error('The hosted address must end with /mcp');
    if (is_placeholder(url)) throw new Error(`This is a placeholder, not the hosted address: ${url}`);
    return parsed;
}

/** Writes the hosted address into the packages under root. Returns the files changed, relative to root. */
export function set_hosted_address(url, root = REPOSITORY_ROOT) {
    const { host } = check_address(url);
    const changed = [];
    const edit = (file, change) => {
        const full = path.join(root, file);
        const before = fs.readFileSync(full, 'utf8');
        const value = change(JSON.parse(before));
        const after = `${JSON.stringify(value, null, 2)}\n`;
        if (after !== before) { fs.writeFileSync(full, after); changed.push(file); }
    };

    edit('plugins/awa-code/.mcp.json', () => ({ mcpServers: { awa: { type: 'http', url } } }));
    edit('plugins/awa-code/.claude-plugin/plugin.json', manifest => {
        delete manifest.userConfig;
        manifest.network = { hosts: [host] };
        return manifest;
    });
    edit('plugins/awa-code/mcp.json', () => ({ mcpServers: { awa: { url } } }));
    edit('plugins/awa-code/.cursor-plugin/plugin.json', manifest => { delete manifest.variables; return manifest; });
    edit('plugins/awa-code/gemini-extension.json', manifest => {
        manifest.mcpServers = { awa: { httpUrl: url } };
        delete manifest.settings;
        return manifest;
    });
    edit('plugins/awa/mcp.json', config => { config.mcpServers.awa.url = url; return config; });
    edit('apps/mcp-server/clients/remote-connector.json', connector => ({ ...connector, hosted_url: url }));
    edit('.claude-plugin/marketplace.json', marketplace => {
        for (const plugin of marketplace.plugins) plugin.description = plugin.description.replace(NEEDS_CLONE, HOSTED);
        return marketplace;
    });
    return changed;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    const url = process.argv[2];
    if (!url) { console.error('Usage: npm run hosted:set -- https://<host>/mcp'); process.exit(2); }
    try {
        const changed = set_hosted_address(url);
        console.log(changed.length ? `Wrote ${url} into:\n${changed.map(f => `  ${f}`).join('\n')}` : 'Every package already points at this address.');
        console.log('Then run npm test, commit, and update the guide\'s table (docs/guides/connect-ai-assistants.md).');
    } catch (error) { console.error(error.message); process.exit(1); }
}
