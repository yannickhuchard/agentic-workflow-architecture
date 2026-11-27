#!/usr/bin/env node
// The "Add to Cursor" install links for the AWA MCP server (cursor.com/docs/mcp/install-links).
//
//   node scripts/cursor-link.mjs                       the links in the guide: a clone at ~/agentic-workflow-architecture
//   node scripts/cursor-link.mjs /path/to/your/clone   links for a clone somewhere else
//   node scripts/cursor-link.mjs https://<host>/mcp    links for the hosted server
//
// The config parameter is the server's entry of mcp.json, without its name, as JSON in base64.
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const DEFAULT_CLONE = '${userHome}/agentic-workflow-architecture';

export function cursor_config(target = DEFAULT_CLONE) {
    if (/^https:\/\//.test(target)) return { url: target };
    return { command: 'node', args: [`${target.replace(/[\\/]+$/, '')}/plugins/awa-code/server/start.mjs`] };
}

export function cursor_links(target = DEFAULT_CLONE, name = 'awa') {
    const config = Buffer.from(JSON.stringify(cursor_config(target))).toString('base64');
    const query = `name=${encodeURIComponent(name)}&config=${encodeURIComponent(config)}`;
    return { config, deeplink: `cursor://anysphere.cursor-deeplink/mcp/install?${query}`, web: `https://cursor.com/en/install-mcp?${query}` };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    const target = process.argv[2] && !/^https:/.test(process.argv[2]) ? path.resolve(process.argv[2]) : process.argv[2];
    const links = cursor_links(target);
    console.log(`Server entry: ${JSON.stringify(cursor_config(target))}\n\nOpen in a browser, or paste in its address bar:\n${links.deeplink}\n\nWeb form of the same link:\n${links.web}`);
}
