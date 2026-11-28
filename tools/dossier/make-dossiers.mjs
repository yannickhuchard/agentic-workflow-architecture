// Writes the dossiers committed with the examples, in each example's dossier/ folder:
//   electricity onboarding: the professional edition
//   life insurance savings: the client edition for Léa Muller under the Valoria Life brand, and the professional edition
// as HTML, PDF and DOCX. Run it again and it writes the same bytes.
//
//   node tools/dossier/make-dossiers.mjs            (needs Playwright for the PDF and the DOCX charts)
import path from 'path';
import { fileURLToPath } from 'url';
import { makeDossier } from './dossier.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const jobs = [
    { example: 'electricity-onboarding', edition: 'professional', name: 'new-customer-onboarding.professional' },
    { example: 'life-insurance-savings', edition: 'client', customer: 'ENR-26001', name: 'lea-muller.client' },
    { example: 'life-insurance-savings', edition: 'professional', name: 'workplace-pension-savings.professional' },
];
for (const job of jobs) {
    const dir = path.join(root, 'examples', job.example);
    const { files, model } = await makeDossier({
        record: path.join(dir, 'journeys.json'), optionsFile: path.join(dir, 'views/story-options.json'), edition: job.edition, customer: job.customer,
        source: `examples/${job.example}/journeys.json`, formats: ['html', 'pdf', 'docx'], out: path.join(dir, 'dossier', job.name),
    });
    console.log(`${job.example}, ${job.edition}: ${Object.values(files).map(f => path.relative(root, f)).join(', ')} (${model.stats.sentences} sentences, ${model.stats.references} references)`);
}
