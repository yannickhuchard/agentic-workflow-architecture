// The rules a plugin package must meet, taken from the submission documentation
// (developers.openai.com/plugins/build/plugins and /plugins/deploy/submission,
// read on 2026-11-22) and from the server it describes.
import fs from 'node:fs';
import path from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createMcpServer } from '../src/server.js';
import { REPOSITORY_ROOT, RELEASE } from '../src/sdk.js';

export const PLUGIN_DIR = path.join(REPOSITORY_ROOT, 'plugins/awa');
const read = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const is_https = value => { try { const url = new URL(value); return url.protocol === 'https:' && !url.username && !url.password; } catch { return false; } };
export const is_placeholder = value => /\.invalid(\/|$|:)|placeholder|example\.(com|org|net)|REPLACE/i.test(String(value));

async function tool_names() {
    const server = await createMcpServer();
    const [a, b] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: 'awa-plugin-check', version: '1.0.0' });
    await server.connect(a); await client.connect(b);
    const names = (await client.listTools()).tools.map(t => t.name);
    await client.close();
    return names;
}

/**
 * Check a plugin folder.
 * @returns {{ errors: string[], placeholders: string[] }}  errors make the package wrong; placeholders are what must be replaced before submission
 */
export async function check_plugin(directory = PLUGIN_DIR, { for_submission = false } = {}) {
    const errors = [], placeholders = [];
    const need = (ok, message) => { if (!ok) errors.push(message); };
    const plugin = read(path.join(directory, 'plugin.json')), mcp = read(path.join(directory, 'mcp.json'));

    need(plugin.$schema === 'https://agent-plugins.org/schemas/1.0.0/plugin.schema.json', 'plugin.json: $schema must be the Agent Plugins schema');
    need(/^[a-z0-9]+(-[a-z0-9]+)*$/.test(plugin.name) && plugin.name.length <= 64, 'plugin.json: name must be lowercase letters, digits and single hyphens, at most 64 characters');
    need(/^\d+\.\d+\.\d+$/.test(plugin.version), 'plugin.json: version must be a semantic version');
    need(typeof plugin.description === 'string' && plugin.description.length <= 4000, 'plugin.json: description is required, at most 4000 characters');
    need(plugin.author?.name && plugin.author.name.length <= 120 && (!plugin.author.url || is_https(plugin.author.url)), 'plugin.json: author needs a name and, if given, an https url');
    const server_version = RELEASE;
    need(plugin.version === server_version, `plugin.json: version ${plugin.version} differs from the server's ${server_version}`);

    const openai = plugin.extensions?.['com.openai'] || {}, ui = openai.interface || {};
    need(typeof ui.displayName === 'string' && ui.displayName.length > 0 && ui.displayName.length <= 30, `interface.displayName is required, at most 30 characters (${ui.displayName?.length})`);
    need(typeof ui.shortDescription === 'string' && ui.shortDescription.length > 0 && ui.shortDescription.length <= 30 && !/\n/.test(ui.shortDescription), `interface.shortDescription is required, one line of at most 30 characters (${ui.shortDescription?.length})`);
    need(typeof ui.longDescription === 'string' && ui.longDescription.length > 0 && ui.longDescription.length <= 4000, 'interface.longDescription is required, at most 4000 characters');
    need(typeof ui.developerName === 'string' && ui.developerName.length > 0 && ui.developerName.length <= 80, 'interface.developerName is required, at most 80 characters');
    need(typeof ui.category === 'string' && ui.category.length > 0, 'interface.category is required');
    need(Array.isArray(ui.capabilities) && ui.capabilities.length <= 20 && ui.capabilities.every(c => typeof c === 'string' && c.length <= 120), 'interface.capabilities: at most 20 labels of at most 120 characters');
    for (const field of ['websiteURL', 'supportURL', 'privacyPolicyURL', 'termsOfServiceURL']) {
        need(is_https(ui[field]) && String(ui[field]).length <= 1024, `interface.${field} must be an https URL without credentials, at most 1024 characters`);
        if (is_placeholder(ui[field])) placeholders.push(`interface.${field} is a placeholder: ${ui[field]}`);
    }
    const prompts = Array.isArray(ui.defaultPrompt) ? ui.defaultPrompt : [ui.defaultPrompt].filter(Boolean);
    need(prompts.length <= 3 && prompts.every(p => typeof p === 'string' && p.length <= 128 && !p.includes('@')) && new Set(prompts).size === prompts.length, 'interface.defaultPrompt: at most three different prompts of at most 128 characters, without @mentions');
    for (const field of ['brandColor', 'brandColorDark']) need(ui[field] === undefined || /^#[0-9A-Fa-f]{6}$/.test(ui[field]), `interface.${field} must be #RRGGBB`);
    need(ui.logo && ui.composerIcon, 'interface.logo and interface.composerIcon are required for distribution');
    for (const field of ['composerIcon', 'composerIconDark', 'logo', 'logoDark']) {
        const relative = ui[field];
        if (relative === undefined) continue;
        if (!/^\.\/assets\/[A-Za-z0-9._-]+\.(svg|png|jpe?g|webp)$/.test(relative)) { errors.push(`interface.${field} must be a file directly in ./assets/`); continue; }
        const file = path.join(directory, relative);
        if (!fs.existsSync(file) || fs.lstatSync(file).isSymbolicLink()) { errors.push(`interface.${field}: ${relative} is missing or a link`); continue; }
        need(fs.statSync(file).size <= 5 * 1024 * 1024, `interface.${field}: larger than 5 MiB`);
        if (relative.endsWith('.svg')) {
            const svg = fs.readFileSync(file, 'utf8');
            const box = /viewBox="\s*0\s+0\s+([\d.]+)\s+([\d.]+)\s*"/.exec(svg), w = /<svg[^>]*\swidth="([\d.]+)"/.exec(svg), h = /<svg[^>]*\sheight="([\d.]+)"/.exec(svg);
            need((box && box[1] === box[2] && Number(box[1]) >= 48) || (w && h && w[1] === h[1] && Number(w[1]) >= 48), `interface.${field}: the SVG must be square and at least 48 by 48`);
            need(!/<script|<foreignObject|\son\w+=|href=/i.test(svg), `interface.${field}: the SVG must not contain scripts, handlers or links`);
        }
    }

    const cases = openai.review?.test_cases || {};
    need(Array.isArray(cases.positive) && cases.positive.length === 5, `review.test_cases.positive: exactly five cases are required for a first review (${cases.positive?.length ?? 0})`);
    need(Array.isArray(cases.negative) && cases.negative.length === 3, `review.test_cases.negative: exactly three cases are required for a first review (${cases.negative?.length ?? 0})`);
    const tools = await tool_names();
    for (const [i, c] of (cases.positive || []).entries()) {
        need(c.description && c.description.length <= 4000 && c.prompt && c.tools_triggered && c.expected_behavior, `positive case ${i + 1} needs description, prompt, tools_triggered and expected_behavior`);
        for (const name of String(c.tools_triggered || '').split(',').map(s => s.trim()).filter(Boolean)) need(tools.includes(name), `positive case ${i + 1} names a tool the server does not have: ${name}`);
    }
    for (const [i, c] of (cases.negative || []).entries()) need(c.description && c.prompt, `negative case ${i + 1} needs description and prompt`);
    const exercised = new Set((cases.positive || []).flatMap(c => String(c.tools_triggered || '').split(',').map(s => s.trim())));
    for (const name of tools) if (!exercised.has(name) && name !== 'show_journeys') errors.push(`no positive review case exercises the tool ${name}`);
    need(!('test_credentials' in (openai.review || {})) && !('reviewer_instructions' in (openai.review || {})), 'review: credentials and reviewer instructions do not belong in the package');
    need(typeof openai.publication?.release_notes === 'string' && openai.publication.release_notes.length > 0, 'publication.release_notes is required');
    need(openai.review?.commerce === false, 'review.commerce must be false: the server sells nothing');
    need(!('apps' in openai) && !('hooks' in openai), 'a package with app references or lifecycle hooks cannot be submitted');
    if (!openai.review?.demo_recording_url) placeholders.push('review.demo_recording_url is not set: a recorded walkthrough is required for review');
    else { need(is_https(openai.review.demo_recording_url), 'review.demo_recording_url must be an https URL'); if (is_placeholder(openai.review.demo_recording_url)) placeholders.push('review.demo_recording_url is a placeholder'); }

    need(mcp.$schema === 'https://agent-plugins.org/schemas/1.0.0/mcp.schema.json', 'mcp.json: $schema must be the Agent Plugins MCP schema');
    const servers = Object.entries(mcp.mcpServers || {});
    need(servers.length === 1, 'mcp.json: exactly one server (plugin-level review cases require it)');
    for (const [name, entry] of servers) {
        need(entry.type === 'streamable-http', `mcp.json: ${name} must be of type streamable-http`);
        let url; try { url = new URL(entry.url); } catch { /* reported below */ }
        need(url && url.protocol === 'https:' && !url.username && !url.password && !url.search && !url.hash && url.pathname === '/mcp', `mcp.json: ${name}.url must be a public https address ending in /mcp`);
        need(!url || !/^(localhost|127\.|\[::1\]|10\.|192\.168\.)/.test(url.hostname), `mcp.json: ${name}.url must not be a loopback or private address`);
        if (is_placeholder(entry.url)) placeholders.push(`mcp.json: the server address is a placeholder: ${entry.url}`);
        need(entry.extensions?.['com.openai']?.auth?.type === 'none', `mcp.json: ${name} must declare auth type "none": every tool of the server is declared noauth`);
    }
    if (for_submission) errors.push(...placeholders.map(p => `not ready for submission: ${p}`));
    return { errors, placeholders };
}
