// Writes the dossier of a journey record as HTML, PDF and DOCX.
//
//   node tools/dossier/dossier.mjs --record examples/electricity-onboarding/journeys.json \
//        --options examples/electricity-onboarding/views/story-options.json \
//        --edition professional --format html,pdf,docx --out examples/electricity-onboarding/dossier/dossier
//
//   --edition professional | client        a client edition needs --customer <subject key or name>
//   --evidence <file>                      the evidence report (default: evidence/evidence-report.json beside the record)
//   --format html,pdf,docx                 the PDF and the charts of the DOCX need Playwright (Chromium)
//
// The HTML edition needs nothing but this repository. The same inputs give the same HTML and DOCX bytes; the PDF's
// dates and identifiers are fixed after Chromium writes it (see tools/dossier/README.md for what stays variable).
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const here = path.dirname(fileURLToPath(import.meta.url));
const { makeDossier, readOptions, steadyPdf, fixOutline } = require(path.resolve(here, '../visualization/awa-dossier-node.js'));
export { makeDossier, readOptions, steadyPdf, fixOutline };

// ---------------------------------------------------------------- the command line
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    const args = process.argv.slice(2), opt = k => { const i = args.indexOf('--' + k); return i < 0 ? undefined : args[i + 1]; };
    if (!opt('record') || !opt('out')) { console.error('Usage: node tools/dossier/dossier.mjs --record <journeys.json> [--options <story-options.json>] [--edition professional|client] [--customer <key>] [--format html,pdf,docx] --out <path without extension>'); process.exit(1); }
    const { files, model } = await makeDossier({ record: opt('record'), optionsFile: opt('options'), edition: opt('edition') || 'professional', customer: opt('customer'), evidence: opt('evidence'), source: opt('source') || path.relative(process.cwd(), opt('record')), formats: (opt('format') || 'html').split(','), out: opt('out') });
    for (const [k, f] of Object.entries(files)) console.log(`${k.padEnd(4)} ${f} (${(fs.statSync(f).size / 1024).toFixed(0)} kB)`);
    console.log(`${model.meta.title}: ${model.personas.length} stories, ${model.stats.sentences} sentences, ${model.stats.references} references, ${model.recommendations.list.length} recommendations`);
}
