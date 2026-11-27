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
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const here = path.dirname(fileURLToPath(import.meta.url)), VIEWS = path.resolve(here, '../visualization');
const D = require(path.join(VIEWS, 'awa-dossier.js')), HTML = require(path.join(VIEWS, 'awa-dossier-html.js'));
const PRINT = require(path.join(VIEWS, 'awa-dossier-print.js')), DOCX = require(path.join(VIEWS, 'awa-dossier-docx.js')), BRAND = require(path.join(VIEWS, 'awa-brand.js'));

/** The options as a page reads them: replay reports and the brand given by a path are read beside the options file */
export function readOptions(file) {
    if (!file) return { options: {}, brand: null };
    const dir = path.dirname(path.resolve(file)), options = JSON.parse(fs.readFileSync(file, 'utf8'));
    const rec = options.recommendations || {};
    if (typeof rec.replays === 'string') { const f = path.resolve(dir, rec.replays); rec.replays = fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : {}; }
    let brand = null;
    if (typeof options.brand === 'string') {
        const f = path.resolve(dir, options.brand), text = fs.readFileSync(f, 'utf8');
        brand = BRAND.read_brand(f.endsWith('.json') ? JSON.parse(text) : text);
        const logo = /^logo:\s*["']?([^"'\s]+)["']?/m.exec(text);
        if (logo && /\.svg$/i.test(logo[1]) && fs.existsSync(path.resolve(path.dirname(f), logo[1]))) brand.logo = 'data:image/svg+xml;base64,' + fs.readFileSync(path.resolve(path.dirname(f), logo[1])).toString('base64');
    } else if (options.brand && typeof options.brand === 'object') brand = BRAND.read_brand(options.brand);
    return { options, brand };
}

/** The PDF Chromium writes, with its dates and its document identifier made the same every time */
export function steadyPdf(buf, asOf) {
    let s = buf.toString('latin1');
    const d = new Date(asOf), pad = n => String(n).padStart(2, '0');
    const stamp = `D:${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}`;
    s = s.replace(/\/(CreationDate|ModDate) \(D:[0-9]{14}([^)]*)\)/g, (m, k, rest) => { const v = (stamp + rest).slice(0, 2 + 14 + rest.length); return `/${k} (${v.padEnd(16 + rest.length, '0').slice(0, 16 + rest.length)})`; });
    s = s.replace(/<xmp:(CreateDate|ModifyDate|MetadataDate)>[^<]*<\/xmp:\1>/g, (m, k) => { const v = d.toISOString().replace(/\.\d{3}Z$/, '+00:00'); const old = m.length - `<xmp:${k}></xmp:${k}>`.length; return `<xmp:${k}>${v.padEnd(old).slice(0, old)}</xmp:${k}>`; });
    const body = s.replace(/\/ID \[<[0-9A-Fa-f]+> ?<[0-9A-Fa-f]+>\]/g, '');
    const id = crypto.createHash('md5').update(body, 'latin1').digest('hex').toUpperCase();
    s = s.replace(/\/ID \[<([0-9A-Fa-f]+)> ?<([0-9A-Fa-f]+)>\]/g, (m, a, b) => m.replace(a, id.slice(0, a.length).padEnd(a.length, '0')).replace(b, id.slice(0, b.length).padEnd(b.length, '0')));
    return Buffer.from(s, 'latin1');
}

/**
 * Chromium drops the space where a heading wraps when it writes a bookmark, and keeps the capitals of text-transform.
 * Each bookmark whose letters match a heading of the page is written again with the heading's own text, in an
 * incremental update at the end of the file (the original objects stay as they are).
 */
export function fixOutline(buf, headings) {
    const s = buf.toString('latin1');
    const squash = t => t.replace(/\s+/g, '').toLowerCase();
    const byLetters = new Map(headings.map(h => [squash(h), h]));
    const decode = tok => {
        if (tok.startsWith('<')) { const hx = tok.slice(1, -1); let out = ''; const start = /^FEFF/i.test(hx) ? 4 : 0; for (let i = start; i + 3 < hx.length + 1; i += 4) out += String.fromCharCode(parseInt(hx.slice(i, i + 4), 16)); return out; }
        return tok.slice(1, -1).replace(/\\([()\\])/g, '$1');
    };
    const encode = t => '<FEFF' + [...t].map(c => c.charCodeAt(0).toString(16).padStart(4, '0').toUpperCase()).join('') + '>';
    const changed = [];
    const re = /(\d+) 0 obj\s*<<([\s\S]*?)>>\s*endobj/g;
    let m;
    while ((m = re.exec(s))) {
        const body = m[2], t = /\/Title\s*(<[0-9A-Fa-f]*>|\((?:\\.|[^\\)])*\))/.exec(body);
        if (!t || !/\/Parent/.test(body)) continue;
        const title = decode(t[1]), right = byLetters.get(squash(title));
        if (right && right !== title) changed.push([m[1], body.replace(t[1], encode(right))]);
    }
    if (!changed.length) return buf;
    const trailer = s.slice(s.lastIndexOf('trailer'));
    const size = /\/Size (\d+)/.exec(trailer)[1], rootRef = /\/Root (\d+ \d+ R)/.exec(trailer)[1], info = /\/Info (\d+ \d+ R)/.exec(trailer), id = /\/ID \[[^\]]*\]/.exec(trailer);
    const prev = /startxref\s+(\d+)\s+%%EOF\s*$/.exec(s)[1];
    let out = s.endsWith('\n') ? s : s + '\n';
    const offsets = [];
    for (const [n, body] of changed) { offsets.push([n, Buffer.byteLength(out, 'latin1')]); out += `${n} 0 obj\n<<${body}>>\nendobj\n`; }
    const xref = Buffer.byteLength(out, 'latin1');
    out += 'xref\n' + offsets.map(([n, o]) => `${n} 1\n${String(o).padStart(10, '0')} 00000 n \n`).join('');
    out += `trailer\n<< /Size ${size} /Root ${rootRef}${info ? ` /Info ${info[1]}` : ''}${id ? ' ' + id[0] : ''} /Prev ${prev} >>\nstartxref\n${xref}\n%%EOF\n`;
    return Buffer.from(out, 'latin1');
}

async function chromium() {
    try { return require('playwright').chromium; } catch { throw new Error('The PDF and the DOCX charts need Playwright: npm install playwright, then npx playwright install chromium'); }
}

/** Render the charts of the HTML edition as images for the DOCX, with their text alternatives */
async function chartImages(browser, html) {
    const page = await browser.newPage({ viewport: { width: 1200, height: 900 }, deviceScaleFactor: 2, reducedMotion: 'reduce' });
    await page.setContent(html, { waitUntil: 'load' }); await page.evaluate(() => document.fonts && document.fonts.ready); await page.waitForTimeout(300);
    await page.addStyleTag({ content: 'header.bar,nav.rail{display:none!important}.doss{display:block!important}' });
    const out = {};
    const shoot = async (key, selector, altSel) => {
        const el = page.locator(selector).first(); if (!(await el.count())) return;
        const alt = await el.evaluate((n, a) => { const t = a ? n.querySelector(a) : n; return (t && (t.getAttribute('aria-label') || (t.querySelector('desc') || {}).textContent)) || n.textContent.slice(0, 200); }, altSel);
        const box = await el.boundingBox();
        out[key] = { png: await el.screenshot({ animations: 'disabled' }), width: Math.round(box.width), height: Math.round(box.height), alt: alt.trim() };
    };
    await shoot('cover', 'svg.cover-lines');
    const figs = await page.locator('figure.chart').evaluateAll(fs => fs.map(f => f.querySelector('h3').textContent));
    const pick = (key, test) => { const i = figs.findIndex(test); return i < 0 ? null : shoot(key, `figure.chart >> nth=${i}`, '[role="img"]'); };
    await pick('who', t => t === 'Who does what');
    await pick('funnel', t => /^A ·/.test(t)); await pick('time', t => /^B ·/.test(t)); await pick('mood', t => /^C ·/.test(t)); await pick('people', t => /^D ·/.test(t)); await pick('tokens', t => /^E ·/.test(t));
    await shoot('recs', 'svg.mini-map');
    await page.close();
    return out;
}

/** Build a dossier and write the formats asked for. Returns { model, files } */
export async function makeDossier({ record, optionsFile, edition = 'professional', customer, evidence, source, formats = ['html'], out }) {
    const rec = typeof record === 'string' ? JSON.parse(fs.readFileSync(record, 'utf8')) : record;
    const { options, brand } = readOptions(optionsFile);
    const evFile = evidence || (typeof record === 'string' ? path.join(path.dirname(record), 'evidence/evidence-report.json') : null);
    const ev = evFile && fs.existsSync(evFile) ? JSON.parse(fs.readFileSync(evFile, 'utf8')) : null;
    const model = D.build(rec, options, { edition, customer, evidence: ev, source });
    const theme = D.theme(brand);
    const files = {};
    fs.mkdirSync(path.dirname(out), { recursive: true });
    const html = HTML.render(model, { theme });
    if (formats.includes('html')) { fs.writeFileSync(out + '.html', html); files.html = out + '.html'; }
    if (formats.includes('pdf') || formats.includes('docx')) {
        const browser = await (await chromium()).launch();
        try {
            if (formats.includes('pdf')) {
                const page = await browser.newPage();
                const printed = PRINT.render(model, { theme });
                const headings = [...printed.matchAll(/<h[1-4][^>]*aria-label="([^"]*)"/g)].map(x => x[1].replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>'));
                await page.setContent(printed, { waitUntil: 'load' });
                await page.evaluate(() => document.fonts && document.fonts.ready);
                const pdf = await page.pdf({ format: 'A4', printBackground: true, preferCSSPageSize: true, tagged: true, outline: true, margin: { top: 0, right: 0, bottom: 0, left: 0 } });
                fs.writeFileSync(out + '.pdf', steadyPdf(fixOutline(Buffer.from(pdf), headings), model.meta.as_of)); files.pdf = out + '.pdf';
                await page.close();
            }
            if (formats.includes('docx')) { const images = await chartImages(browser, html); fs.writeFileSync(out + '.docx', DOCX.render(model, { theme, images })); files.docx = out + '.docx'; }
        } finally { await browser.close(); }
    }
    return { model, files };
}

// ---------------------------------------------------------------- the command line
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    const args = process.argv.slice(2), opt = k => { const i = args.indexOf('--' + k); return i < 0 ? undefined : args[i + 1]; };
    if (!opt('record') || !opt('out')) { console.error('Usage: node tools/dossier/dossier.mjs --record <journeys.json> [--options <story-options.json>] [--edition professional|client] [--customer <key>] [--format html,pdf,docx] --out <path without extension>'); process.exit(1); }
    const { files, model } = await makeDossier({ record: opt('record'), optionsFile: opt('options'), edition: opt('edition') || 'professional', customer: opt('customer'), evidence: opt('evidence'), source: opt('source') || path.relative(process.cwd(), opt('record')), formats: (opt('format') || 'html').split(','), out: opt('out') });
    for (const [k, f] of Object.entries(files)) console.log(`${k.padEnd(4)} ${f} (${(fs.statSync(f).size / 1024).toFixed(0)} kB)`);
    console.log(`${model.meta.title}: ${model.personas.length} stories, ${model.stats.sentences} sentences, ${model.stats.references} references, ${model.recommendations.list.length} recommendations`);
}
