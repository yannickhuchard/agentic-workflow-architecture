// Checks plugins/awa against the submission rules and against the server.
//   node scripts/check-plugin.mjs            the package in the repository (placeholders are listed, not errors)
//   node scripts/check-plugin.mjs --submit   placeholders are errors
import fs from 'node:fs';
import path from 'node:path';
import { check_plugin, PLUGIN_DIR } from './plugin-rules.mjs';
import { REPOSITORY_ROOT } from '../src/sdk.js';

const { errors, placeholders } = await check_plugin(PLUGIN_DIR, { for_submission: process.argv.includes('--submit') });
for (const [file, expected] of [['plugins/marketplace.json', './awa'], ['.agents/plugins/marketplace.json', './plugins/awa']]) {
    const marketplace = JSON.parse(fs.readFileSync(path.join(REPOSITORY_ROOT, file), 'utf8'));
    const entry = marketplace.plugins?.[0];
    const plugin = JSON.parse(fs.readFileSync(path.join(PLUGIN_DIR, 'plugin.json'), 'utf8'));
    if (!marketplace.name || !marketplace.interface?.displayName) errors.push(`${file}: name and interface.displayName are required`);
    if (entry?.name !== plugin.name) errors.push(`${file}: the entry is not named ${plugin.name}`);
    if (entry?.source?.source !== 'local' || entry.source.path !== expected) errors.push(`${file}: source.path must be ${expected}`);
    if (!fs.existsSync(path.resolve(REPOSITORY_ROOT, file.startsWith('.agents') ? '.' : 'plugins', expected, 'plugin.json'))) errors.push(`${file}: ${expected} does not lead to the plugin`);
    if (!entry?.policy?.installation || !entry.policy.authentication || !entry.category) errors.push(`${file}: policy.installation, policy.authentication and category are required`);
}
for (const p of placeholders) console.log(`placeholder  ${p}`);
for (const e of errors) console.log(`ERROR        ${e}`);
console.log(errors.length ? `\n${errors.length} error(s)` : `\nThe plugin package is well formed${placeholders.length ? `; ${placeholders.length} placeholder(s) to replace before submission` : ' and has no placeholder'}.`);
process.exit(errors.length ? 1 : 0);
