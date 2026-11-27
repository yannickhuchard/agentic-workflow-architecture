// The dossier (tools/visualization/awa-dossier*.js, tools/dossier): every chapter is there, every figure is the one
// awa-kpis.js computes, every sentence of a customer's story carries a journal reference that exists, a client edition
// leaves out what it should, the DOCX is well formed, and the dossier's own AWA workflow runs in simulation.
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import zlib from 'zlib';
import vm from 'vm';
import { createRequire } from 'module';
import * as sdk from '../src/index';

const require = createRequire(import.meta.url);
const root = path.resolve(__dirname, '../../..'), VIEWS = path.join(root, 'tools/visualization');
const D = require(path.join(VIEWS, 'awa-dossier.js')), HTML = require(path.join(VIEWS, 'awa-dossier-html.js'));
const PRINT = require(path.join(VIEWS, 'awa-dossier-print.js')), DOCX = require(path.join(VIEWS, 'awa-dossier-docx.js'));
const ctx: Record<string, unknown> = {};
vm.runInNewContext(fs.readFileSync(path.join(VIEWS, 'awa-kpis.js'), 'utf8') + '\n;this.M = AWA_MEASURES;', ctx);
const KPI = ctx.M as { compute_measures: (r: unknown) => any }; // eslint-disable-line @typescript-eslint/no-explicit-any

/* eslint-disable @typescript-eslint/no-explicit-any */
const load = (example: string) => {
    const dir = path.join(root, 'examples', example);
    const record = JSON.parse(fs.readFileSync(path.join(dir, 'journeys.json'), 'utf8'));
    const options = JSON.parse(fs.readFileSync(path.join(dir, 'views/story-options.json'), 'utf8'));
    options.recommendations.replays = JSON.parse(fs.readFileSync(path.join(dir, 'recommendations/replays.json'), 'utf8'));
    const evidence = JSON.parse(fs.readFileSync(path.join(dir, 'evidence/evidence-report.json'), 'utf8'));
    return { record, options, evidence };
};
/** The text of each part of a DOCX archive */
function unzip(buf: Buffer): Record<string, string> {
    const out: Record<string, string> = {};
    let i = 0;
    while (buf.readUInt32LE(i) === 0x04034b50) {
        const size = buf.readUInt32LE(i + 18), n = buf.readUInt16LE(i + 26), extra = buf.readUInt16LE(i + 28);
        const name = buf.slice(i + 30, i + 30 + n).toString('utf8'), data = buf.slice(i + 30 + n + extra, i + 30 + n + extra + size);
        out[name] = name.endsWith('.png') ? '' : zlib.inflateRawSync(data).toString('utf8');
        i += 30 + n + extra + size;
    }
    return out;
}

describe('dossier: the professional edition of the electricity example', () => {
    const { record, options, evidence } = load('electricity-onboarding');
    const model = D.build(record, options, { edition: 'professional', evidence, source: 'examples/electricity-onboarding/journeys.json' });
    const html = HTML.render(model), printed = PRINT.render(model);

    it('has every chapter, in the HTML edition and on the pages of the print layout', () => {
        expect(model.contents.map((c: any) => c.title)).toEqual(['Summary', 'The journey at a glance', 'In their own words', 'The work behind the journey', 'Analysis', 'Recommendations', 'Appendix']);
        for (const id of ['cover', 'summary', 'glance', 'voice-0', 'voice-1', 'work', 'analysis', 'recs', 'appendix']) expect(html).toContain(`id="${id}"`);
        // without Chromium the sizes are estimated, so a page can run on; tools/dossier/dossier.check.mjs reads the measured layout
        const labels = [...printed.matchAll(/<section class="pg[^"]*" aria-label="([^"]*)"/g)].map(x => x[1]);
        expect(labels.length).toBeGreaterThanOrEqual(14);
        for (const l of ['Cover', 'Contents', 'Executive summary', 'The journey at a glance', 'The work behind the journey', 'Recommendations', 'Appendix: compliance and evidence', 'Glossary, method and sources']) expect(labels).toContain(l);
        expect(labels.filter(l => /^Analysis: /.test(l)).length).toBeGreaterThanOrEqual(2);
        // the table of contents gives each chapter the page it starts on
        const toc = [...printed.matchAll(/<span class="vh">page <\/span>(\d+)/g)].map(x => Number(x[1]));
        const first = (re: RegExp) => labels.findIndex(l => re.test(l)) + 1;
        expect(toc).toEqual([/^Executive summary$/, /^The journey at a glance$/, /own words$/, /^The work behind/, /^Analysis: /, /^Recommendations$/, /^Appendix: /].map(first));
        // the first rendering carries a ruler of the texts to measure; the second, given the sizes, carries none
        expect(PRINT.render(model, { ruler: true })).toContain('data-ruler=');
        expect(printed).not.toContain('data-ruler=');
        expect(model.personas.map((p: any) => p.name)).toEqual(['Tomás Reyes', 'Sofia Lind']);
    });

    it('states every figure as awa-kpis.js computes it', () => {
        const M = KPI.compute_measures(record), JM = M.journeys[0].measures, T = M.totals;
        const by = (id: string) => model.summary.figures.find((f: any) => f.measure === id);
        expect(by('journey.completion_rate').value).toBe(JM['journey.completion_rate'].value);
        expect(by('journey.duration_median_ms').value).toBe(JM['journey.duration_median_ms'].value);
        expect(by('workflow.first_pass_yield').value).toBe(T['workflow.first_pass_yield'].value);
        expect(by('journey.cost_per_journey').value).toBe(JM['journey.cost_per_journey'].value);
        expect(by('journey.mood_end').value).toBe(JM['journey.mood_end'].value);
        expect(model.summary.figures.map((f: any) => f.show)).toEqual(['6 of 8', '15.4 d', '3 of 8', '8 of 11', '€0.057', '+0.57']);
        for (const s of model.glance.stages) {
            const m = M.journeys[0].stages.find((x: any) => x.id === s.id || x.name === s.name).measures;
            expect(s.entered).toBe(m['stage.entered'].value);
            expect(s.median_ms).toBe(m['stage.duration_median_ms'].value);
        }
        expect(model.analysis.contracts).toEqual({ met: 33, of: 37 });
    });

    it('gives every sentence of every story a journal reference that exists in the record', () => {
        const sentences = D.sentences(model);
        expect(sentences.length).toBeGreaterThan(15);
        for (const s of sentences) {
            expect(s.refs.length, s.text).toBeGreaterThan(0);
            const row = record.journeys[0].instances.find((i: any) => i.instance.subject_key === s.persona);
            for (const r of s.refs) {
                const events = r.run === 'J' ? row.instance.events : row.runs.find((x: any) => x.run_id.slice(4, 8) === r.run).events;
                expect(events.some((e: any) => e.seq === r.seq), `${s.text} ${r.run}·${r.seq}`).toBe(true);
            }
        }
        // no feeling is put in a customer's mouth: the record's moods are all inferred by rules
        expect(sentences.some((s: any) => /\b(I felt|frustrat|happy|angry|upset|worried|delighted)\b/i.test(s.text))).toBe(false);
        expect(sentences.map((s: any) => s.text)).toContain('Then nothing for fourteen days.');
    });

    it('is the same every time', () => {
        expect(HTML.render(D.build(record, options, { edition: 'professional', evidence, source: 'examples/electricity-onboarding/journeys.json' }))).toBe(html);
    });

    it('writes a DOCX with headings, alt text, repeated header rows, its language and its title', () => {
        const parts = unzip(DOCX.render(model, { images: { cover: { png: Buffer.from('89504e470d0a1a0a', 'hex'), width: 800, height: 400, alt: 'The customers as lines' } } }));
        expect(Object.keys(parts)).toEqual(expect.arrayContaining(['word/document.xml', 'word/styles.xml', 'docProps/core.xml', 'word/header1.xml', 'word/footer1.xml']));
        const doc = parts['word/document.xml'];
        expect(doc).toContain('<w:pStyle w:val="Heading1"/>');
        expect(doc).toContain('<w:pStyle w:val="Voice"/>');
        expect(doc).toContain('<w:tblHeader/>');
        expect(doc).toContain('descr="The customers as lines"');
        expect(parts['word/styles.xml']).toContain('<w:lang w:val="en-GB"');
        expect(parts['docProps/core.xml']).toContain('<dc:title>New Customer Onboarding · dossier</dc:title>');
        expect(parts['word/footer1.xml']).toContain(' PAGE ');
    });
});

describe('dossier: a client edition, for Léa Muller under her company\'s brand', () => {
    const { record, options, evidence } = load('life-insurance-savings');
    const model = D.build(record, options, { edition: 'client', customer: 'ENR-26001', evidence });
    const html = HTML.render(model), docx = unzip(DOCX.render(model))['word/document.xml'];
    const others = record.journeys[0].instances.map((i: any) => `${i.instance.data.employee.first_name} ${i.instance.data.employee.last_name}`).filter((n: string) => n !== 'Léa Muller');

    it('tells only her story and names no other customer', () => {
        expect(model.personas.map((p: any) => p.name)).toEqual(['Léa Muller']);
        for (const name of others) { expect(html).not.toContain(name); expect(docx).not.toContain(name); }
        expect(model.glance.rows.length).toBe(1);
    });
    it('leaves out internal cost, the agents\' internals and the compliance appendix\'s internal parts', () => {
        expect(model.summary.figures.some((f: any) => f.measure === 'journey.cost_per_journey')).toBe(false);
        expect(model.analysis.cost).toBeNull();
        expect(model.analysis.trust).toBeNull();
        expect(model.compliance.rows).toEqual([]);
        expect(html).not.toMatch(/tokens|EUR 0\.|guardrail/i);
        expect(model.personas[0].facts.some((f: any) => /models and tools/.test(f[0]))).toBe(false);
    });
    it('keeps the references of her story', () => {
        for (const s of D.sentences(model)) expect(s.refs.length, s.text).toBeGreaterThan(0);
    });
});

describe('dossier: the workflow that makes it (tools/dossier/dossier.awa.json)', () => {
    it('runs in simulation: the narrator\'s first story is refused by its outcome contract, the second passes, a person approves', async () => {
        const workflow = sdk.parse_document(JSON.parse(fs.readFileSync(path.join(root, 'tools/dossier/dossier.awa.json'), 'utf8')));
        const outputs = JSON.parse(fs.readFileSync(path.join(root, 'tools/dossier/dossier.simulation.json'), 'utf8'));
        const journal = new sdk.InMemoryJournalStore();
        const engine = new sdk.WorkflowEngine(workflow as any, {
            simulate: true, simulated_outputs: outputs, journal, execution_logger: { log_execution: async () => { } } as any,
            // the narrator's model is configuration: the tier is mapped by the deployment, never named in the workflow
            model_tiers: { narrator: process.env.DOSSIER_NARRATOR_MODEL || 'scripted:narrator' } as any, sleep: async () => { },
        } as any);
        await engine.start({ record: 'examples/electricity-onboarding/journeys.json', edition: 'professional' });
        for (let i = 0; i < 200 && engine.getStatus() === 'running'; i++) await engine.runStep();
        expect(engine.getStatus()).toBe('completed');
        const events = await journal.read(engine.getRunId());
        const name = (id: string) => workflow.activities.find(a => a.id === id)?.name;
        const narrator = events.filter((e: any) => name(e.node_id) === 'Tell each persona\'s story');
        expect(narrator.filter((e: any) => e.type === 'activity.failed').length).toBe(1);
        expect(narrator.filter((e: any) => e.type === 'contract.checked').map((e: any) => e.data.passed)).toEqual([false, true]);
        expect(events.some((e: any) => e.type === 'activity.completed' && name(e.node_id) === 'Review and approve')).toBe(true);
        expect(events.some((e: any) => e.type === 'activity.completed' && name(e.node_id) === 'Export HTML, PDF and DOCX')).toBe(true);
        expect(JSON.stringify(workflow)).not.toMatch(/gemini|gpt|claude|llama|mistral/i);
    });
});
