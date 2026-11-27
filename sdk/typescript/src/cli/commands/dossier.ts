import { Command } from 'commander';
import fs from 'fs';
import path from 'path';
import { view_directory } from '../../runtime/views';

/**
 * awa dossier: one document of a journey record (the journeys, the work behind them, the customers' stories in their own
 * voice, the analysis and the recommendations) as HTML, PDF and DOCX. The writers are the dossier modules that come with
 * the views (dist/views/awa-dossier*.js); the SDK itself takes on no dependency. The PDF needs Playwright, and the DOCX
 * renders its charts with it when it is installed.
 */
export const dossierCommand = new Command('dossier')
    .description('Write the dossier of a journey record (awa journey export) as HTML, PDF and DOCX')
    .requiredOption('--file <file>', 'A portfolio exported with "awa journey export"')
    .option('--options <file>', 'The journey view\'s options for this record (names, glossary, brand, recommendations, dossier)')
    .option('--edition <edition>', 'professional (every customer, internal cost, the agents\' internals) or client (one customer\'s own story)', 'professional')
    .option('--customer <key>', 'With --edition client: the customer, by subject key or name')
    .option('--evidence <file>', 'The evidence report (awa evidence --json) for the appendix')
    .option('--format <list>', 'html, pdf, docx, separated by commas', 'html')
    .option('--out <path>', 'Where to write, without the extension', 'dossier')
    .action(async options => {
        try {
            const formats = String(options.format).split(',').map((f: string) => f.trim()).filter(Boolean);
            const bad = formats.filter((f: string) => !['html', 'pdf', 'docx'].includes(f));
            if (bad.length) throw new Error(`Unknown format ${bad.join(', ')}: use html, pdf or docx`);
            if (!['professional', 'client'].includes(options.edition)) throw new Error('--edition is professional or client');
            if (options.edition === 'client' && !options.customer) throw new Error('A client edition is for one customer: give --customer <subject key or name>');
            // eslint-disable-next-line @typescript-eslint/no-require-imports
            const writer = require(path.join(view_directory(), 'awa-dossier-node.js'));
            const { files, model } = await writer.makeDossier({
                record: path.resolve(process.cwd(), options.file), optionsFile: options.options ? path.resolve(process.cwd(), options.options) : undefined,
                edition: options.edition, customer: options.customer, evidence: options.evidence ? path.resolve(process.cwd(), options.evidence) : undefined,
                source: path.basename(options.file), formats, out: path.resolve(process.cwd(), options.out),
            });
            for (const [kind, file] of Object.entries(files as Record<string, string>)) console.log(`${kind.padEnd(4)} ${path.relative(process.cwd(), file)} (${(fs.statSync(file).size / 1024).toFixed(0)} kB)`);
            console.log(`${model.meta.title}: ${model.personas.length} stories, ${model.stats.sentences} sentences, ${model.stats.references} references, ${model.recommendations.list.length} recommendations. A person approves it before it is issued.`);
        } catch (error: unknown) {
            console.error('Error:', error instanceof Error ? error.message : String(error));
            process.exit(1);
        }
    });
