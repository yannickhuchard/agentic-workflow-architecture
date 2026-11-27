#!/usr/bin/env node
// Validates each client manifest of the AWA plugins against the JSON Schema its format publishes.
//
//   npm run clients:schemas
//
// Needs network access: the schemas are downloaded from where their owners publish them. A schema that
// cannot be downloaded is reported as not checked, and does not fail the run. Ajv comes with the MCP SDK.
import fs from 'node:fs';
import path from 'node:path';
import Ajv from 'ajv';
import addFormats from 'ajv-formats';
import { REPOSITORY_ROOT } from '../src/sdk.js';

export const SCHEMAS = [
    { file: 'plugins/awa-code/.claude-plugin/plugin.json', schema: 'https://json.schemastore.org/claude-code-plugin-manifest.json', what: 'Claude Code plugin manifest' },
    { file: '.claude-plugin/marketplace.json', schema: 'https://json.schemastore.org/claude-code-marketplace.json', what: 'Claude Code marketplace' },
    { file: 'plugins/awa-code/.cursor-plugin/plugin.json', schema: 'https://raw.githubusercontent.com/cursor/plugins/main/schemas/plugin.schema.json', what: 'Cursor plugin manifest' },
    { file: '.cursor-plugin/marketplace.json', schema: 'https://raw.githubusercontent.com/cursor/plugins/main/schemas/marketplace.schema.json', what: 'Cursor marketplace' },
    { file: 'apps/mcp-server/mcpb/manifest.json', schema: 'https://raw.githubusercontent.com/modelcontextprotocol/mcpb/main/schemas/mcpb-manifest-v0.3.schema.json', what: 'MCP Bundle manifest 0.3' },
    { file: 'plugins/awa/plugin.json', schema: 'https://agent-plugins.org/schemas/1.0.0/plugin.schema.json', what: 'Agent Plugins manifest (ChatGPT)' },
    { file: 'plugins/awa/mcp.json', schema: 'https://agent-plugins.org/schemas/1.0.0/mcp.schema.json', what: 'Agent Plugins MCP configuration (ChatGPT)' },
];

async function download(url) {
    const response = await fetch(url, { signal: AbortSignal.timeout(20_000) });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return response.json();
}

let failed = 0;
for (const { file, schema: url, what } of SCHEMAS) {
    let schema;
    try { schema = await download(url); }
    catch (error) { console.log(`not checked  ${file} (${what}): ${url} could not be downloaded: ${error.cause?.code || error.message}`); continue; }
    const ajv = new Ajv({ allErrors: true, strict: false });
    addFormats(ajv);
    delete schema.$schema;
    const validate = ajv.compile(schema);
    const document = JSON.parse(fs.readFileSync(path.join(REPOSITORY_ROOT, file), 'utf8'));
    if (validate(document)) console.log(`valid        ${file} (${what})`);
    else {
        failed++;
        console.log(`NOT VALID    ${file} (${what})`);
        for (const error of validate.errors) console.log(`  ${error.instancePath || '/'} ${error.message}${error.params?.additionalProperty ? `: ${error.params.additionalProperty}` : ''}`);
    }
}
process.exitCode = failed ? 1 : 0;
