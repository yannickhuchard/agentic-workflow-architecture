// Puts the views the SDK serves and writes (the measures page and the journey view) into dist/views,
// so that the published package carries them. Run by "npm run build".
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const here = path.dirname(fileURLToPath(import.meta.url));
const from = path.resolve(here, '../../../tools/visualization'), to = path.resolve(here, '../dist/views');
fs.mkdirSync(to, { recursive: true });
for (const file of ['dashboard.html', 'awa-kpis.js', 'journey.html', 'journey-story-builder.js', 'awa-glossary.js', 'awa-brand.js', 'awa-recommendations.js']) fs.copyFileSync(path.join(from, file), path.join(to, file));
console.log(`views copied to ${path.relative(process.cwd(), to)}`);
