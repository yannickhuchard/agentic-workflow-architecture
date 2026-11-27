#!/usr/bin/env node
// Starts the AWA MCP server over stdio from a clone of the AWA repository.
//
// The plugins in this folder (Claude Code, Cursor, Gemini CLI, Mistral Vibe) run this file. It looks for the
// repository in this order and starts apps/mcp-server/src/start.js --stdio from the first one found:
//   1. AWA_REPOSITORY, the folder the user configured (Claude Code asks for it when the plugin is enabled);
//   2. the repository this file is in, when the plugin is used where it lies in the clone;
//   3. CLAUDE_PROJECT_DIR and the current folder, when the assistant runs inside the clone.
// Standard output belongs to the MCP protocol: every message of this file goes to standard error.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const say = message => process.stderr.write(`AWA MCP server: ${message}\n`);
const here = path.dirname(fs.realpathSync(fileURLToPath(import.meta.url)));
const configured = value => typeof value === 'string' && value.trim() !== '' && !value.includes('${') ? value.trim() : undefined;

function is_awa_repository(folder) {
    try {
        const manifest = JSON.parse(fs.readFileSync(path.join(folder, 'apps/mcp-server/package.json'), 'utf8'));
        return manifest.name === 'awa-mcp-server' && fs.existsSync(path.join(folder, 'apps/mcp-server/src/start.js'));
    } catch { return false; }
}

const candidates = [
    configured(process.env.AWA_REPOSITORY),
    path.resolve(here, '../../..'),
    configured(process.env.CLAUDE_PROJECT_DIR),
    process.cwd(),
].filter(Boolean).map(folder => path.resolve(folder.replace(/^~(?=$|[\\/])/, process.env.HOME || process.env.USERPROFILE || '~')));

const major = Number(process.versions.node.split('.')[0]);
if (major < 20) {
    say(`Node ${process.versions.node} is too old. Install Node 20 or later and start the assistant again.`);
    process.exit(1);
}

const repository = candidates.find(is_awa_repository);
if (!repository) {
    say('the AWA repository was not found. Looked in:');
    for (const folder of [...new Set(candidates)]) say(`  ${folder}`);
    say('Clone it (git clone https://github.com/yannickhuchard/agentic-workflow-architecture), build it (see docs/guides/connect-ai-assistants.md),');
    say('then give its folder to the plugin: in Claude Code run /plugin, choose the AWA plugin and Configure; elsewhere set AWA_REPOSITORY to that folder.');
    process.exit(1);
}

const missing = [];
if (!fs.existsSync(path.join(repository, 'sdk/typescript/dist/index.mjs'))) missing.push(`cd "${path.join(repository, 'sdk/typescript')}" && npm ci && npm run build`);
if (!fs.existsSync(path.join(repository, 'apps/mcp-server/node_modules/@modelcontextprotocol/sdk/package.json'))) missing.push(`cd "${path.join(repository, 'apps/mcp-server')}" && npm ci`);
if (missing.length) {
    say(`the repository at ${repository} is not built yet. Run:`);
    for (const command of missing) say(`  ${command}`);
    say('then restart the assistant or reconnect the server.');
    process.exit(1);
}

const entry = path.join(repository, 'apps/mcp-server/src/start.js');
say(`starting from ${repository}`);
process.argv = [process.argv[0], entry, '--stdio'];
await import(pathToFileURL(entry).href);
