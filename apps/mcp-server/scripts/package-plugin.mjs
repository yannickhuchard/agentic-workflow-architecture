// Writes the plugin package for upload, with the real address of the hosted server.
//   node scripts/package-plugin.mjs https://<host>/mcp [--demo https://<recording>] [--out <dir>]
// Copies only plugin.json, mcp.json and the icons the listing refers to.
import fs from 'node:fs';
import path from 'node:path';
import { check_plugin, is_placeholder, PLUGIN_DIR } from './plugin-rules.mjs';
import { PACKAGE_ROOT } from '../src/sdk.js';

const args = process.argv.slice(2);
const option = key => { const i = args.indexOf(key); return i < 0 ? undefined : args[i + 1]; };
const fail = message => { console.error(message); process.exit(1); };
const address = args.find(a => /^https?:/.test(a) && a !== option('--demo'));
if (!address) fail('Usage: node scripts/package-plugin.mjs https://<host>/mcp [--demo https://<recording>] [--out <dir>]');
let endpoint; try { endpoint = new URL(address); } catch { fail('The address is not a URL.'); }
if (endpoint.protocol !== 'https:' || endpoint.username || endpoint.password || endpoint.search || endpoint.hash || endpoint.pathname !== '/mcp' || is_placeholder(endpoint.href)) fail('Give the public https address of the server, ending in /mcp, without credentials or a query.');

const out = path.resolve(option('--out') || path.join(PACKAGE_ROOT, 'dist/plugins/awa'));
fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(path.join(out, 'assets'), { recursive: true });
const plugin = JSON.parse(fs.readFileSync(path.join(PLUGIN_DIR, 'plugin.json'), 'utf8')), mcp = JSON.parse(fs.readFileSync(path.join(PLUGIN_DIR, 'mcp.json'), 'utf8'));
for (const server of Object.values(mcp.mcpServers)) server.url = endpoint.href;
if (option('--demo')) plugin.extensions['com.openai'].review.demo_recording_url = option('--demo');
const ui = plugin.extensions['com.openai'].interface;
for (const relative of new Set([ui.composerIcon, ui.composerIconDark, ui.logo, ui.logoDark].filter(Boolean))) {
    if (!/^\.\/assets\/[A-Za-z0-9._-]+\.(svg|png|jpe?g|webp)$/.test(relative)) fail(`Listing assets must be files directly in ./assets/: ${relative}`);
    fs.copyFileSync(path.join(PLUGIN_DIR, relative), path.join(out, relative));
}
fs.writeFileSync(path.join(out, 'plugin.json'), JSON.stringify(plugin, null, 2) + '\n');
fs.writeFileSync(path.join(out, 'mcp.json'), JSON.stringify(mcp, null, 2) + '\n');

const { errors, placeholders } = await check_plugin(out);
for (const p of placeholders) console.log(`still to do  ${p}`);
if (errors.length) fail(errors.map(e => `ERROR  ${e}`).join('\n'));
console.log(`Package written to ${out} (${fs.readdirSync(out, { recursive: true }).filter(f => !fs.statSync(path.join(out, f)).isDirectory()).join(', ')}). Zip the contents of that folder for upload.`);
