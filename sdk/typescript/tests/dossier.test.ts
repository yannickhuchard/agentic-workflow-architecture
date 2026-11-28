// The dossier (tools/visualization/awa-dossier*.js, tools/dossier): every chapter is there, every figure is the one
// awa-kpis.js computes, every sentence of a customer's story carries a journal reference that exists, a client edition
// leaves out what it should, the DOCX is well formed, and the dossier's own AWA workflow runs in simulation.
import { describe, it, expect, vi } from 'vitest';
import fs from 'fs';
import os from 'os';
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

describe('dossier: a client edition is for one customer, named', () => {
    const { record, options } = load('life-insurance-savings');
    const keys = record.journeys[0].instances.map((i: any) => i.instance.subject_key);
    const names = record.journeys[0].instances.map((i: any) => `${i.instance.data.employee.first_name} ${i.instance.data.employee.last_name}`);

    it('refuses a client edition without a customer, or with one that matches none, and says how to choose', () => {
        for (const customer of [undefined, '', '  ', 'DOES-NOT-EXIST']) {
            let message = '';
            try { D.build(record, options, { edition: 'client', customer }); } catch (error) { message = (error as Error).message; }
            expect(message, String(customer)).toMatch(/client edition/i);
            expect(message).toMatch(/subject key or name/);
            for (const key of keys) expect(message).toContain(key);
            for (const name of names) expect(message).not.toContain(name);
            if (customer === 'DOES-NOT-EXIST') expect(message).toContain('“DOES-NOT-EXIST” matches no customer');
        }
    });
    it('finds the customer by subject key or by name', () => {
        expect(D.build(record, options, { edition: 'client', customer: 'ENR-26003' }).meta.client.name).toBe('Ana Duarte');
        expect(D.build(record, options, { edition: 'client', customer: 'Sara Nilsen' }).meta.client.key).toBe('ENR-26005');
    });
    it('is refused by awa dossier, with the reason, when the customer matches none', async () => {
        const { dossierCommand } = await import('../src/cli/commands/dossier');
        const errors: string[] = [];
        const error = vi.spyOn(console, 'error').mockImplementation((...a: unknown[]) => { errors.push(a.join(' ')); });
        const exit = vi.spyOn(process, 'exit').mockImplementation(((code?: number) => { throw new Error(`exit ${code}`); }) as any);
        const out = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'awa-dossier-')), 'nobody');
        try {
            for (const customer of ['DOES-NOT-EXIST', ' ']) {
                errors.length = 0;
                await expect(dossierCommand.parseAsync(['--file', path.join(root, 'examples/life-insurance-savings/journeys.json'), '--edition', 'client', '--customer', customer, '--out', out], { from: 'user' })).rejects.toThrow('exit 1');
                expect(errors.join('\n')).toMatch(/subject key or name/);
                expect(errors.join('\n')).toContain('ENR-26001');
            }
            expect(fs.existsSync(out + '.html')).toBe(false);
        } finally { error.mockRestore(); exit.mockRestore(); }
    });
});

describe('dossier: every client edition of both examples tells the customer\'s journey without the internals', () => {
    // the internal mechanism, never in a client edition. What a customer saw (the names of their own touchpoints, the
    // reasons of their mood: "a change was refused") and the journey's own glossary (a fund's costs) are the customer's words, and are taken out before the check; "policy" is
    // the authorization policy ("the policy allows"), not the insurance policy the life insurance customers buy ("Issue policy")
    const INTERNAL = /guardrail|prompt injection|\bthe polic(y|ies)\b(?! documents)|refused|refusal|separation of duties|four eyes|\btokens?\b|\bmodels?\b|\bcosts?\b|outcome contract/i;
    const INTERNAL_RECORD = /^(guardrail\.|authorization\.|contract\.)/;
    const text = (html: string) => html.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/g, ' ').replace(/<[^>]+>/g, ' ')
        .replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, '\'').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/\s+/g, ' ');
    for (const example of ['electricity-onboarding', 'life-insurance-savings']) {
        const { record, options, evidence } = load(example);
        const glossary = (options.glossary || []).flatMap((t: any) => [t.definition, t.term, t.see]).filter(Boolean).sort((a: string, b: string) => b.length - a.length);
        for (const row of record.journeys[0].instances) {
            const key = row.instance.subject_key;
            it(`${example}, ${key}`, () => {
                const model = D.build(record, options, { edition: 'client', customer: key, evidence });
                const own = [...row.instance.events.filter((e: any) => e.type === 'journey.touchpoint' && e.data.party === 'subject').map((e: any) => String(e.data.name).split(/\s+/).slice(1).join(' ')),
                    ...row.instance.events.filter((e: any) => e.type === 'journey.sentiment_changed').map((e: any) => String(e.data.reason))];
                const clean = (s: string) => [...glossary, ...own].reduce((t: string, x: string) => t.split(x).join(' '), s);
                const sentences = D.sentences(model);
                expect(sentences.length).toBeGreaterThan(0);
                for (const s of sentences) {
                    expect(s.refs.length, s.text).toBeGreaterThan(0);
                    expect(clean(s.text), s.text).not.toMatch(INTERNAL);
                    for (const r of s.refs) {
                        const events = r.run === 'J' ? row.instance.events : row.runs.find((x: any) => x.run_id.slice(4, 8) === r.run).events;
                        const e = events.find((x: any) => x.seq === r.seq);
                        expect(e, `${s.text} ${r.run}·${r.seq}`).toBeTruthy();
                        expect(e.type, `${s.text} cites ${r.run}·${r.seq}`).not.toMatch(INTERNAL_RECORD);
                    }
                }
                const p = model.personas[0];
                for (const r of p.story.record) expect(clean(r.text), r.text).not.toMatch(INTERNAL);
                for (const r of p.blueprint.rows) expect(clean(`${r.sees || ''} ${r.behind || ''}`), r.behind).not.toMatch(INTERNAL);
                for (const r of model.recommendations.list) expect(clean(`${r.title} ${r.finding} ${r.action || ''} ${r.kind} ${r.effect}`), r.title).not.toMatch(INTERNAL);
                for (const [name, written] of [['HTML', text(HTML.render(model))], ['print layout', text(PRINT.render(model))], ['DOCX', text(unzip(DOCX.render(model))['word/document.xml'])]]) {
                    const found = clean(written).match(INTERNAL);
                    expect(found ? clean(written).slice(Math.max(0, found.index! - 80), found.index! + 40) : null, `${name} of ${key}`).toBeNull();
                }
            });
        }
    }
});

describe('dossier: a portfolio of several journeys (examples/claims-journey)', () => {
    const record = JSON.parse(fs.readFileSync(path.join(root, 'examples/claims-journey/journeys.json'), 'utf8'));
    it('computes the figures of each journey from that journey\'s own runs and instances', () => {
        expect(record.journeys.length).toBe(3);
        record.journeys.forEach((J: any, jk: number) => {
            const model = D.build(record, {}, { edition: 'professional', journey: jk });
            const M = KPI.compute_measures({ ...record, journeys: [J], runs: [] }), JM = M.journeys[0].measures, T = M.totals;
            const by = (id: string) => model.summary.figures.find((f: any) => f.measure === id);
            const name = J.definition.name;
            expect(model.meta.journey).toBe(name);
            expect(by('journey.completion_rate').value, name).toBe(JM['journey.completion_rate'].value);
            expect(by('journey.duration_median_ms').value, name).toBe(JM['journey.duration_median_ms'].value);
            expect(by('workflow.first_pass_yield').value, name).toBe(T['workflow.first_pass_yield'].value);
            expect(by('workflow.first_pass_yield').n, name).toBe(T['workflow.first_pass_yield'].n);
            expect(by('workflow.first_pass_yield').show, name).toBe(`${Math.round(T['workflow.first_pass_yield'].value * T['workflow.first_pass_yield'].n)} of ${T['workflow.first_pass_yield'].n}`);
            expect(by('journey.cost_per_journey').value, name).toBe(JM['journey.cost_per_journey'].value);
            expect(by('journey.mood_end').value, name).toBe(JM['journey.mood_end'].value);
            expect(model.analysis.first_pass_yield.n, name).toBe(T['workflow.first_pass_yield'].n);
            expect(model.analysis.cost.total, name).toBe(T['workflow.cost'].value);
            expect(model.analysis.cost.tokens_total, name).toBe(M.workflows.reduce((a: number, w: any) => a + (w.measures['workflow.input_tokens'].value || 0) + (w.measures['workflow.output_tokens'].value || 0), 0));
            expect(T['workflow.first_pass_yield'].n, name).toBeLessThanOrEqual(model.meta.runs);
            for (const s of model.glance.stages) {
                const m = M.journeys[0].stages.find((x: any) => x.id === s.id || x.name === s.name).measures;
                expect(s.entered, `${name}, ${s.name}`).toBe(m['stage.entered'].value);
                expect(s.median_ms, `${name}, ${s.name}`).toBe(m['stage.duration_median_ms'].value);
            }
            // a recommendation's figures are the journey's own too
            for (const r of model.recommendations.list.filter((x: any) => x.kind === 'cost')) expect(r.finding, name).toContain(`${(T['workflow.cost'].value).toFixed(2)} in models and tools`);
        });
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
