#!/usr/bin/env node
// Runs the `awa` command of the AWA TypeScript SDK found on this machine, with the arguments given:
//
//   node scripts/awa.mjs validate workflow.awa.json journey.journey.json
//   node scripts/awa.mjs run workflow.awa.json --simulate --outputs simulation.json --journal run.journal.jsonl
//   node scripts/awa.mjs --where          prints which command it found, and runs nothing
//
// It looks, in this order, for:
//   1. a clone of the AWA repository named by the variable AWA_REPOSITORY;
//   2. a clone that holds the current folder or one of the folders above it;
//   3. a clone that holds this script (the skill read from inside the repository);
//   4. the package agentic-workflow-architecture in a node_modules folder at or above the current folder.
// A clone is used once its SDK is built (sdk/typescript/dist/cli/index.js). Only version 2 or later of the SDK,
// which implements specification 1.1, is used. When none is found, the script says how to get one and exits
// with status 3. Otherwise it exits with the status of the command.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const CLI_IN_CLONE = path.join('sdk', 'typescript', 'dist', 'cli', 'index.js');
const CLI_IN_PACKAGE = path.join('node_modules', 'agentic-workflow-architecture', 'dist', 'cli', 'index.js');

/** The folder and every folder above it */
function upwards(start) {
    const folders = [];
    for (let dir = path.resolve(start); ; dir = path.dirname(dir)) {
        folders.push(dir);
        if (path.dirname(dir) === dir) return folders;
    }
}

/** A folder is a clone of the AWA repository when it has the specification and the TypeScript SDK */
const is_clone = dir => fs.existsSync(path.join(dir, 'docs', 'specification.md')) && fs.existsSync(path.join(dir, 'sdk', 'typescript', 'package.json'));

/** The version of the SDK whose package.json is in this folder, or undefined */
function version_in(dir) {
    try { return JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8')).version; } catch { return undefined; }
}
/** Version 2 and later implement specification 1.1, which this skill describes */
const recent = version => Number(String(version || '0').split('.')[0]) >= 2;
const too_old = [];

function find() {
    const clones = [];
    if (process.env.AWA_REPOSITORY) clones.push(path.resolve(process.env.AWA_REPOSITORY));
    clones.push(...upwards(process.cwd()).filter(is_clone));
    clones.push(...upwards(path.dirname(fileURLToPath(import.meta.url))).filter(is_clone));
    const unbuilt = [];
    for (const clone of clones) {
        const cli = path.join(clone, CLI_IN_CLONE);
        const version = version_in(path.join(clone, 'sdk', 'typescript'));
        if (fs.existsSync(cli) && recent(version)) return { cli, from: `the clone at ${clone}, SDK ${version}` };
        if (fs.existsSync(cli)) too_old.push(`${clone} (SDK ${version})`);
        else if (is_clone(clone)) unbuilt.push(clone);
    }
    for (const dir of upwards(process.cwd())) {
        const cli = path.join(dir, CLI_IN_PACKAGE);
        const version = version_in(path.join(dir, 'node_modules', 'agentic-workflow-architecture'));
        if (fs.existsSync(cli) && recent(version)) return { cli, from: `the package in ${path.join(dir, 'node_modules')}, SDK ${version}` };
        if (fs.existsSync(cli)) too_old.push(`${path.join(dir, 'node_modules', 'agentic-workflow-architecture')} (SDK ${version})`);
    }
    return { unbuilt: [...new Set(unbuilt)] };
}

const args = process.argv.slice(2);
const found = find();
if (!found.cli) {
    const lines = ['The AWA command was not found.'];
    for (const old of [...new Set(too_old)]) lines.push(`Left out ${old}: this skill needs version 2 or later of the SDK, for specification 1.1.`);
    if (found.unbuilt.length) {
        lines.push(`The clone at ${found.unbuilt[0]} has no built SDK. Build it once:`, `  cd ${path.join(found.unbuilt[0], 'sdk', 'typescript')} && npm ci && npm run build`);
    } else {
        lines.push('Get the repository and build its SDK once:',
            '  git clone https://github.com/yannickhuchard/agentic-workflow-architecture',
            '  cd agentic-workflow-architecture/sdk/typescript && npm ci && npm run build',
            'then run this script from inside the clone, or set AWA_REPOSITORY to the clone\'s folder.');
    }
    console.error(lines.join('\n'));
    process.exit(3);
}
if (args[0] === '--where') {
    console.log(`${found.cli} (${found.from})`);
    process.exit(0);
}
const result = spawnSync(process.execPath, [found.cli, ...args], { stdio: 'inherit' });
if (result.error) {
    console.error(`Could not start ${found.cli}: ${result.error.message}`);
    process.exit(1);
}
process.exit(result.status ?? 1);
