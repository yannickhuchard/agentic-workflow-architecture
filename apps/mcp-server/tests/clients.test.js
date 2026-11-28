// The client packages of the AWA plugin: each manifest parses, names files that exist, and its MCP entry
// starts the server. Schemas published by each format are checked by npm run clients:schemas (network).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { REPOSITORY_ROOT, RELEASE, load_sdk } from '../src/sdk.js';
import { connect } from './helpers.js';
import { cursor_config, cursor_links } from '../scripts/cursor-link.mjs';
import { set_hosted_address, check_address } from '../scripts/set-hosted-address.mjs';

const ROOT = REPOSITORY_ROOT;
const PLUGIN = path.join(ROOT, 'plugins/awa-code');
const at = (...parts) => path.join(ROOT, ...parts);
const json = file => JSON.parse(fs.readFileSync(at(file), 'utf8'));
const text = file => fs.readFileSync(at(file), 'utf8');

function frontmatter(file) {
    const match = /^---\n([\s\S]*?)\n---\n/.exec(fs.readFileSync(file, 'utf8'));
    assert.ok(match, `${file} has no frontmatter`);
    return Object.fromEntries(match[1].split('\n').map(line => /^([A-Za-z-]+):\s*(.*)$/.exec(line)).filter(Boolean).map(m => [m[1], m[2]]));
}

/** Replaces ${name} placeholders the way a client does */
const fill = (value, variables) => value.replace(/\$\{([^}]+)\}/g, (all, name) => (name in variables ? variables[name] : all));

let expected_tools;
async function server_tools() {
    if (!expected_tools) {
        const client = await connect();
        expected_tools = (await client.listTools()).tools.map(t => t.name).sort();
        await client.close();
    }
    return expected_tools;
}

/** Starts a stdio entry as a client would, from a folder outside the repository, and lists its tools */
async function start(entry, variables, extra_env = {}) {
    const args = (entry.args || []).map(a => fill(a, variables));
    const env = Object.fromEntries(Object.entries(entry.env || {}).map(([k, v]) => [k, fill(v, variables)]));
    const command = entry.command === 'node' ? process.execPath : entry.command;
    const transport = new StdioClientTransport({ command, args, env: { ...process.env, AWA_REPOSITORY: '', ...env, ...extra_env }, cwd: entry.cwd ? fill(entry.cwd, variables) : os.tmpdir(), stderr: 'pipe' });
    const client = new Client({ name: 'awa-client-check', version: '1.0.0' });
    await client.connect(transport);
    try {
        const tools = (await client.listTools()).tools.map(t => t.name).sort();
        // One call that goes through the SDK, so that a server which lists its tools but cannot load the SDK fails here
        const example = await client.callTool({ name: 'load_claims_example', arguments: { document: 'claims-settlement.workflow' } });
        const checked = await client.callTool({ name: 'validate_document', arguments: { document: example.structuredContent.document.content } });
        assert.match(checked.content[0].text, /^The workflow "Motor Claim Settlement" is valid/);
        return tools;
    } finally { await client.close(); }
}

test('the Claude Code plugin and marketplace name files that exist', () => {
    const manifest = json('plugins/awa-code/.claude-plugin/plugin.json');
    assert.equal(manifest.name, 'awa');
    assert.equal(manifest.version, RELEASE);
    assert.ok(fs.existsSync(path.join(PLUGIN, manifest.icon)));
    assert.equal(manifest.userConfig.repository.type, 'directory');
    const marketplace = json('.claude-plugin/marketplace.json');
    assert.ok(!['claude-code-marketplace', 'claude-plugins-official', 'anthropic-marketplace', 'agent-skills'].includes(marketplace.name) && !/^claude|anthropic|official/i.test(marketplace.name));
    assert.equal(marketplace.plugins.length, 1);
    assert.equal(marketplace.plugins[0].name, manifest.name);
    assert.ok(fs.existsSync(path.join(ROOT, marketplace.plugins[0].source, '.claude-plugin/plugin.json')));
    assert.ok(!fs.existsSync(path.join(PLUGIN, 'CLAUDE.md')), 'a CLAUDE.md in a plugin is not loaded');
});

test('every skill of the plugin has a name and a description; the AWA skill is the repository\'s, word for word', () => {
    const skills = fs.readdirSync(path.join(PLUGIN, 'skills'));
    assert.deepEqual(skills.sort(), ['agentic-workflow-architecture', 'example', 'show', 'simulate', 'validate']);
    for (const skill of skills) {
        const meta = frontmatter(path.join(PLUGIN, 'skills', skill, 'SKILL.md'));
        assert.equal(meta.name, skill);
        assert.ok(meta.description && meta.description.length > 40, `${skill}: description`);
    }
    // The whole folder, reference files, assets and scripts included: an installed plugin holds only its own folder
    const files = folder => fs.readdirSync(at(folder), { recursive: true }).filter(f => fs.statSync(at(folder, f)).isFile()).sort();
    const canonical = 'skills/agentic-workflow-architecture';
    for (const copy of ['plugins/awa-code/skills/agentic-workflow-architecture', '.agent/skills/agentic-workflow-architecture']) {
        assert.deepEqual(files(copy), files(canonical), `copy the whole folder ${canonical} to ${copy}`);
        for (const file of files(canonical)) assert.equal(text(path.join(copy, file)), text(path.join(canonical, file)), `${copy}/${file} differs from ${canonical}/${file}: copy the folder again`);
    }
});

test('the AWA skill: its front matter, the files it names, and examples that validate and run', async () => {
    const dir = 'skills/agentic-workflow-architecture';
    const body = text(`${dir}/SKILL.md`);
    const meta = frontmatter(at(dir, 'SKILL.md'));
    assert.equal(meta.name, 'agentic-workflow-architecture');
    assert.ok(meta.description.length <= 1024, `the description has ${meta.description.length} characters; skills allow 1024`);
    assert.ok(!/: /.test(meta.description), 'the description is a plain YAML scalar: no colon followed by a space');
    assert.ok(!/^\s+internal:/m.test(/^---\n([\s\S]*?)\n---\n/.exec(body)[1]), 'the AWA skill is public: no metadata.internal');
    assert.ok(body.split('\n').length < 500, 'SKILL.md stays under 500 lines');
    for (const named of new Set([...body.matchAll(/`((?:references|assets|scripts)\/[A-Za-z0-9._-]+)`/g)].map(m => m[1]))) {
        assert.ok(fs.existsSync(at(dir, named)), `SKILL.md names ${named}, which is not in the skill's folder`);
    }
    // The two documents shown in SKILL.md are the assets, and both validate and run to their end
    const [workflow, journey] = [...body.matchAll(/```json\n([\s\S]*?)\n```/g)].map(m => JSON.parse(m[1]));
    assert.deepEqual(workflow, json(`${dir}/assets/refund-request.awa.json`));
    assert.deepEqual(journey, json(`${dir}/assets/refund-request.journey.json`));
    const sdk = await load_sdk();
    assert.ok(sdk.validate_workflow(workflow).valid);
    assert.deepEqual(sdk.validate_workflow_integrity(sdk.parse_document(workflow)).errors, []);
    assert.deepEqual(sdk.validate_journey(sdk.JourneyDefinitionSchema.parse(journey), new Set([workflow.id]), true), []);
    const engine = new sdk.WorkflowEngine(sdk.parse_document(workflow), { simulate: true, simulated_outputs: json(`${dir}/assets/refund-request.simulation.json`), execution_logger: { log_execution: async () => { } } });
    await engine.start({ customer_id: 'C-1' });
    assert.equal(await engine.run(), 'waiting_event');
    await engine.deliverEvent(sdk.business_event('receipt.uploaded', { customer_id: 'C-1', receipt_id: 'R-1' }));
    assert.equal(await engine.run(), 'completed');
    // The script finds this repository's command
    const where = spawnSync(process.execPath, [at(dir, 'scripts/awa.mjs'), '--where'], { cwd: os.tmpdir(), env: { ...process.env, AWA_REPOSITORY: ROOT }, encoding: 'utf8' });
    assert.equal(where.status, 0, where.stderr);
    assert.ok(where.stdout.startsWith(path.join(ROOT, 'sdk/typescript/dist/cli/index.js')));
});

test('the command skills call tools the server has', async () => {
    const tools = await server_tools();
    for (const skill of ['validate', 'show', 'simulate', 'example']) {
        const body = fs.readFileSync(path.join(PLUGIN, 'skills', skill, 'SKILL.md'), 'utf8');
        const named = [...body.matchAll(/`([a-z]+(?:_[a-z]+)+)`/g)].map(m => m[1]).filter(n => /^(validate|show|simulate|load)_/.test(n));
        assert.ok(named.length, `${skill} names no tool`);
        for (const name of named) assert.ok(tools.includes(name), `${skill} names ${name}, which the server does not have`);
    }
});

test('the Cursor plugin, marketplace and project files name files that exist', () => {
    const manifest = json('plugins/awa-code/.cursor-plugin/plugin.json');
    assert.match(manifest.name, /^[a-z0-9]([a-z0-9.-]*[a-z0-9])?$/);
    assert.equal(manifest.version, RELEASE);
    assert.ok(fs.existsSync(path.join(PLUGIN, manifest.logo)));
    assert.ok(fs.existsSync(path.join(PLUGIN, manifest.mcpServers)));
    const marketplace = json('.cursor-plugin/marketplace.json');
    assert.equal(marketplace.plugins[0].name, manifest.name);
    assert.ok(fs.existsSync(path.join(ROOT, marketplace.plugins[0].source, '.cursor-plugin/plugin.json')));
    const rule = text('plugins/awa-code/rules/awa-documents.mdc');
    assert.equal(text('.cursor/rules/awa-documents.mdc'), rule, 'the project rule is the plugin rule, word for word');
    const meta = frontmatter(path.join(PLUGIN, 'rules/awa-documents.mdc'));
    assert.ok(meta.description && meta.globs.includes('*.awa.json') && meta.alwaysApply === 'false');
});

test('the Gemini CLI extension and the MCP Bundle manifest describe this server', async () => {
    const extension = json('plugins/awa-code/gemini-extension.json');
    assert.equal(extension.version, RELEASE);
    assert.ok(fs.existsSync(path.join(PLUGIN, extension.contextFileName)));
    const bundle = json('apps/mcp-server/mcpb/manifest.json');
    assert.equal(bundle.manifest_version, '0.3');
    assert.equal(bundle.version, RELEASE);
    assert.equal(bundle.server.entry_point, 'server/apps/mcp-server/src/start.js');
    assert.ok(fs.existsSync(at(bundle.server.entry_point.replace(/^server\//, ''))), 'the bundle keeps the repository layout under server/');
    assert.deepEqual(bundle.server.mcp_config.args, ['${__dirname}/server/apps/mcp-server/src/start.js', '--stdio']);
    assert.deepEqual(bundle.tools.map(t => t.name).sort(), await server_tools());
    assert.ok(fs.existsSync(at('plugins/awa-code/assets/icon.png')), 'the bundle takes its icon from the plugin');
});

test('each stdio configuration starts the server and lists every tool', async () => {
    const tools = await server_tools();
    assert.equal(tools.length, 8);
    const plugin = { CLAUDE_PLUGIN_ROOT: PLUGIN, 'user_config.repository': '' };
    const entries = [
        ['Claude Code plugin (.mcp.json), loaded in place', json('plugins/awa-code/.mcp.json').mcpServers.awa, plugin],
        ['Cursor project (.cursor/mcp.json)', json('.cursor/mcp.json').mcpServers.awa, { workspaceFolder: ROOT }],
        ['Cursor plugin (mcp.json)', json('plugins/awa-code/mcp.json').mcpServers.awa, { AWA_REPOSITORY: ROOT }],
        ['Gemini CLI extension', json('plugins/awa-code/gemini-extension.json').mcpServers.awa, { extensionPath: PLUGIN, '/': path.sep, workspacePath: os.tmpdir() }],
        ['Claude Desktop and other clients (clients/stdio.json)', JSON.parse(text('apps/mcp-server/clients/stdio.json').replaceAll('/absolute/path/to/agentic-workflow-architecture', ROOT.split(path.sep).join('/'))).mcpServers.awa, {}],
    ];
    const toml = text('apps/mcp-server/clients/mistral-vibe.toml');
    const vibe_args = JSON.parse(/^args = (\[.*\])$/m.exec(toml)[1]).map(a => a.replace('/absolute/path/to/agentic-workflow-architecture', ROOT));
    assert.match(toml, /^command = "node"$/m);
    assert.match(toml, /^transport = "stdio"$/m);
    entries.push(['Mistral Vibe (clients/mistral-vibe.toml)', { command: 'node', args: vibe_args }, {}]);
    for (const [name, entry, variables] of entries) {
        assert.equal(entry.command, 'node', name);
        assert.deepEqual(await start(entry, variables), tools, name);
    }
});

test('the plugin finds a configured clone when it is installed away from the repository', async t => {
    const copy = fs.mkdtempSync(path.join(os.tmpdir(), 'awa-plugin-'));
    t.after(() => fs.rmSync(copy, { recursive: true, force: true }));
    fs.cpSync(PLUGIN, copy, { recursive: true });
    const entry = JSON.parse(fs.readFileSync(path.join(copy, '.mcp.json'), 'utf8')).mcpServers.awa;
    assert.deepEqual(await start(entry, { CLAUDE_PLUGIN_ROOT: copy, 'user_config.repository': ROOT }), await server_tools());

    const lost = spawnSync(process.execPath, [path.join(copy, 'server/start.mjs')], { cwd: os.tmpdir(), env: { ...process.env, AWA_REPOSITORY: '', CLAUDE_PROJECT_DIR: '' }, encoding: 'utf8', timeout: 20_000 });
    assert.equal(lost.status, 1);
    assert.equal(lost.stdout, '', 'nothing but the protocol on standard output');
    assert.match(lost.stderr, /the AWA repository was not found/);
    assert.match(lost.stderr, /AWA_REPOSITORY/);
});

test('the Add to Cursor links in the guide and the README install the server from the clone', () => {
    const links = cursor_links();
    assert.deepEqual(JSON.parse(Buffer.from(links.config, 'base64').toString()), cursor_config());
    assert.deepEqual(cursor_config(), { command: 'node', args: ['${userHome}/agentic-workflow-architecture/plugins/awa-code/server/start.mjs'] });
    for (const file of ['docs/guides/connect-ai-assistants.md', 'README.md']) {
        const doc = text(file);
        assert.ok(doc.includes(links.web), `${file}: the web link`);
    }
    assert.ok(text('docs/guides/connect-ai-assistants.md').includes(links.deeplink), 'the guide gives the cursor:// link too');
});

test('one command points every package at the hosted address', t => {
    assert.throws(() => check_address('http://example.org/mcp'), /https/);
    assert.throws(() => check_address('https://awa-mcp.placeholder.invalid/mcp'), /placeholder/);
    assert.throws(() => check_address('https://awa.dev/api'), /\/mcp/);
    const copy = fs.mkdtempSync(path.join(os.tmpdir(), 'awa-hosted-'));
    t.after(() => fs.rmSync(copy, { recursive: true, force: true }));
    const files = ['plugins/awa-code/.mcp.json', 'plugins/awa-code/.claude-plugin/plugin.json', 'plugins/awa-code/mcp.json', 'plugins/awa-code/.cursor-plugin/plugin.json',
        'plugins/awa-code/gemini-extension.json', 'plugins/awa/mcp.json', 'apps/mcp-server/clients/remote-connector.json', '.claude-plugin/marketplace.json'];
    for (const file of files) { fs.mkdirSync(path.dirname(path.join(copy, file)), { recursive: true }); fs.copyFileSync(at(file), path.join(copy, file)); }
    const url = 'https://awa.host.test/mcp';
    assert.deepEqual(set_hosted_address(url, copy).sort(), [...files].sort());
    const read = file => JSON.parse(fs.readFileSync(path.join(copy, file), 'utf8'));
    assert.deepEqual(read('plugins/awa-code/.mcp.json').mcpServers.awa, { type: 'http', url });
    assert.equal(read('plugins/awa-code/.claude-plugin/plugin.json').userConfig, undefined);
    assert.deepEqual(read('plugins/awa-code/.claude-plugin/plugin.json').network, { hosts: ['awa.host.test'] });
    assert.deepEqual(read('plugins/awa-code/mcp.json').mcpServers.awa, { url });
    assert.equal(read('plugins/awa-code/.cursor-plugin/plugin.json').variables, undefined);
    assert.deepEqual(read('plugins/awa-code/gemini-extension.json').mcpServers.awa, { httpUrl: url });
    assert.equal(read('plugins/awa/mcp.json').mcpServers.awa.url, url);
    assert.equal(read('plugins/awa/mcp.json').mcpServers.awa.type, 'streamable-http');
    assert.equal(read('apps/mcp-server/clients/remote-connector.json').hosted_url, url);
    assert.doesNotMatch(read('.claude-plugin/marketplace.json').plugins[0].description, /clone/);
    assert.deepEqual(set_hosted_address(url, copy), [], 'a second run changes nothing');
});
