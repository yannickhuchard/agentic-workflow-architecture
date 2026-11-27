import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { check_plugin, is_placeholder, PLUGIN_DIR } from '../scripts/plugin-rules.mjs';
import { REPOSITORY_ROOT, RELEASE } from '../src/sdk.js';
import { connect } from './helpers.js';

const plugin = JSON.parse(fs.readFileSync(path.join(PLUGIN_DIR, 'plugin.json'), 'utf8'));
const openai = plugin.extensions['com.openai'];

test('the plugin package meets the submission rules; only the known placeholders remain', async () => {
    const { errors, placeholders } = await check_plugin();
    assert.deepEqual(errors, []);
    // npm run hosted:set writes the hosted address into mcp.json; until then it is a placeholder too
    const address_placeholder = is_placeholder(JSON.parse(fs.readFileSync(path.join(PLUGIN_DIR, 'mcp.json'), 'utf8')).mcpServers.awa.url);
    const expected = address_placeholder ? 2 : 1;
    assert.equal(placeholders.length, expected, placeholders.join(' | '));
    assert.equal(placeholders.some(p => /server address is a placeholder/.test(p)), address_placeholder);
    assert.ok(placeholders.some(p => /demo_recording_url/.test(p)));
    const strict = await check_plugin(PLUGIN_DIR, { for_submission: true });
    assert.equal(strict.errors.length, expected, 'placeholders stop a submission build');
});

test('listing pages exist in the repository at the paths the listing points to', () => {
    const prefix = 'https://github.com/yannickhuchard/agentic-workflow-architecture';
    const ui = openai.interface;
    assert.equal(ui.websiteURL, prefix);
    for (const field of ['supportURL', 'privacyPolicyURL', 'termsOfServiceURL']) {
        assert.ok(ui[field].startsWith(`${prefix}/blob/main/`), field);
        const file = path.join(REPOSITORY_ROOT, ui[field].slice(`${prefix}/blob/main/`.length));
        assert.ok(fs.existsSync(file) && fs.statSync(file).size > 500, `${field} points to a file that is not in the repository: ${file}`);
    }
    assert.equal(plugin.version, RELEASE);
});

test('review cases name real tools, and the listing does not promise what the server does not do', async t => {
    const client = await connect(t);
    const tools = (await client.listTools()).tools.map(x => x.name);
    for (const c of openai.review.test_cases.positive) for (const name of c.tools_triggered.split(',').map(s => s.trim())) assert.ok(tools.includes(name), name);
    const listing = `${plugin.description} ${openai.interface.longDescription}`;
    assert.match(listing, /simulat/i); assert.match(listing, /nothing is stored|Nothing is stored/);
});
