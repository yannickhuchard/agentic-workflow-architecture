#!/usr/bin/env node
// Builds the AWA MCP server as an MCP Bundle (.mcpb) for Claude Desktop.
//
//   npm run bundle:mcpb                   writes dist/awa-workflows-<version>.mcpb
//   npm run bundle:mcpb -- --no-pack      stops after the staged folder is built and checked
//
// Needs the SDK built (cd sdk/typescript && npm ci && npm run build) and network access to the npm
// registry: it installs the production dependencies into the bundle, and packs with the MCPB command
// line tool (npx @anthropic-ai/mcpb). The bundle keeps the repository's layout under server/, because
// the server reads the views in tools/visualization and the example in examples/ next to it.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { PACKAGE_ROOT, REPOSITORY_ROOT, RELEASE } from '../src/sdk.js';

export const MCPB_CLI = '@anthropic-ai/mcpb@2.1.2';
const DIST = path.join(PACKAGE_ROOT, 'dist');
const STAGE = path.join(DIST, 'mcpb', 'awa-workflows');
const OUT = path.join(DIST, `awa-workflows-${RELEASE}.mcpb`);
const pack = !process.argv.includes('--no-pack');
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const npx = process.platform === 'win32' ? 'npx.cmd' : 'npx';
const run = (command, args, cwd) => execFileSync(command, args, { cwd, stdio: ['ignore', 'pipe', 'inherit'], encoding: 'utf8' });

function copy(from, to, keep = () => true) {
    const source = path.join(REPOSITORY_ROOT, from), target = path.join(STAGE, 'server', to ?? from);
    fs.cpSync(source, target, { recursive: true, filter: file => keep(path.basename(file), fs.statSync(file).isDirectory()) });
}

/** Starts the staged server as Claude Desktop would and returns its tool names. */
export async function staged_tools(stage = STAGE) {
    const manifest = JSON.parse(fs.readFileSync(path.join(stage, 'manifest.json'), 'utf8'));
    const args = manifest.server.mcp_config.args.map(a => a.replaceAll('${__dirname}', stage));
    const transport = new StdioClientTransport({ command: process.execPath, args, cwd: os.tmpdir(), stderr: 'pipe' });
    const client = new Client({ name: 'awa-mcpb-check', version: '1.0.0' });
    await client.connect(transport);
    try { return (await client.listTools()).tools.map(t => t.name); }
    finally { await client.close(); }
}

async function main() {
    if (!fs.existsSync(path.join(REPOSITORY_ROOT, 'sdk/typescript/dist/index.mjs'))) throw new Error('Build the SDK first: cd sdk/typescript && npm ci && npm run build');
    fs.rmSync(path.join(DIST, 'mcpb'), { recursive: true, force: true });
    fs.mkdirSync(STAGE, { recursive: true });

    const manifest = JSON.parse(fs.readFileSync(path.join(PACKAGE_ROOT, 'mcpb/manifest.json'), 'utf8'));
    manifest.version = RELEASE;
    fs.writeFileSync(path.join(STAGE, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
    fs.copyFileSync(path.join(REPOSITORY_ROOT, 'plugins/awa-code/assets/icon.png'), path.join(STAGE, 'icon.png'));

    copy('apps/mcp-server/src');
    copy('apps/mcp-server/package.json');
    copy('apps/mcp-server/package-lock.json');
    copy('apps/mcp-server/legal');
    copy('LICENSE');
    copy('tools/visualization', undefined, name => !/\.check\.mjs$|^README\.md$/.test(name));
    copy('examples/claims-journey', undefined, (name, directory) => directory || name.endsWith('.json'));
    for (const file of ['claims-settlement.awa.json', 'simulation.json']) copy(`examples/claims-settlement/${file}`);

    // The SDK goes in as a packed package, so that the bundle holds real files and no link outside it
    const server = path.join(STAGE, 'server/apps/mcp-server');
    const tarball = run(npm, ['pack', '--ignore-scripts', '--silent', '--pack-destination', path.join(DIST, 'mcpb')], path.join(REPOSITORY_ROOT, 'sdk/typescript')).trim().split('\n').pop();
    const package_json = JSON.parse(fs.readFileSync(path.join(server, 'package.json'), 'utf8'));
    package_json.dependencies['agentic-workflow-architecture'] = `file:${path.relative(server, path.join(DIST, 'mcpb', tarball)).split(path.sep).join('/')}`;
    fs.writeFileSync(path.join(server, 'package.json'), `${JSON.stringify(package_json, null, 2)}\n`);
    run(npm, ['install', '--omit=dev', '--omit=peer', '--legacy-peer-deps', '--ignore-scripts', '--no-audit', '--no-fund', '--loglevel=error'], server);
    fs.rmSync(path.join(server, 'package-lock.json'), { force: true });
    if (fs.lstatSync(path.join(server, 'node_modules/agentic-workflow-architecture')).isSymbolicLink()) throw new Error('The SDK was linked, not copied, into the bundle');

    const tools = await staged_tools();
    console.log(`staged ${path.relative(PACKAGE_ROOT, STAGE)}: the server starts over stdio and lists ${tools.length} tools (${tools.join(', ')})`);
    const declared = manifest.tools.map(t => t.name).sort();
    if (JSON.stringify(declared) !== JSON.stringify([...tools].sort())) throw new Error(`manifest.json lists ${declared.join(', ')}; the server has ${tools.join(', ')}`);
    if (!pack) return;

    console.log(run(npx, ['-y', MCPB_CLI, 'validate', path.join(STAGE, 'manifest.json')], PACKAGE_ROOT).trim());
    fs.rmSync(OUT, { force: true });
    run(npx, ['-y', MCPB_CLI, 'pack', STAGE, OUT], PACKAGE_ROOT);
    console.log(`wrote ${path.relative(PACKAGE_ROOT, OUT)} (${(fs.statSync(OUT).size / 1048576).toFixed(1)} MB)`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    main().catch(error => { console.error(error.message); process.exitCode = 1; });
}
