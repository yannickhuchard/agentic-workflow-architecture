// Checks the committed dossiers of the examples:
//   HTML: in Chromium at 1440 and 400 px wide: axe-core (WCAG 2.2 A and AA rules, when axe-core can be loaded from a
//         node_modules folder; nothing is fetched), the contrast of every text against what is behind it, the keyboard
//         (the skip link first, tables behind their buttons), reduced motion (nothing animates), no sideways scroll at 400
//   print layout: rendered again in Chromium; no text over other text or over a chart's marks, no text wider or taller
//         than its box, no chart label outside its chart, nothing off the page or in the bands of the running head and folio
//   PDF:  page count, tagged, title, language, bookmarks, figures with alternative text, tables with header cells
//   DOCX: headings, alt text, header rows, language and title, and, when LibreOffice is installed, that it renders
// and that make-dossiers.mjs writes the same bytes again (with --rebuild).
//
//   cd tools/dossier && npm install          (axe-core, for the accessibility rules)
//   node tools/dossier/dossier.check.mjs [--rebuild] [--layout]      (--layout: the print layout alone)
import fs from 'fs';
import path from 'path';
import zlib from 'zlib';
import crypto from 'crypto';
import { execFileSync } from 'child_process';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const here = path.dirname(fileURLToPath(import.meta.url)), root = path.resolve(here, '../..');
const failures = [];
const check = (ok, what) => { console.log(`${ok ? 'ok  ' : 'FAIL'}  ${what}`); if (!ok) failures.push(what); };
const note = what => console.log(`note  ${what}`);
const { chromium } = require('playwright');

const DOSSIERS = [
    { file: 'examples/electricity-onboarding/dossier/new-customer-onboarding.professional', pages: [14, 16], theme: 'dark', example: 'electricity-onboarding', edition: 'professional' },
    { file: 'examples/life-insurance-savings/dossier/lea-muller.client', pages: [6, 9], theme: 'light', example: 'life-insurance-savings', edition: 'client', customer: 'ENR-26001', client: true, others: JSON.parse(fs.readFileSync(path.join(root, 'examples/life-insurance-savings/journeys.json'), 'utf8')).journeys[0].instances.map(i => i.instance.data.employee).filter(e => e.first_name !== 'Léa').flatMap(e => [`${e.first_name} ${e.last_name}`, e.first_name]) },
    { file: 'examples/life-insurance-savings/dossier/workplace-pension-savings.professional', pages: [14, 18], theme: 'light', example: 'life-insurance-savings', edition: 'professional' },
];

let axe = null;
for (const from of [here, root, process.cwd()]) { try { axe = fs.readFileSync(createRequire(path.join(from, 'x.js')).resolve('axe-core/axe.min.js'), 'utf8'); break; } catch { /* look further */ } }
if (!axe) note('axe-core is not installed (cd tools/dossier && npm install): the axe rules are skipped, the other checks run');

if (process.argv.includes('--rebuild')) {
    const before = Object.fromEntries(DOSSIERS.flatMap(d => ['html', 'pdf', 'docx'].map(x => [`${d.file}.${x}`, crypto.createHash('sha256').update(fs.readFileSync(path.join(root, `${d.file}.${x}`))).digest('hex')])));
    execFileSync(process.execPath, [path.join(here, 'make-dossiers.mjs')], { stdio: 'ignore' });
    const changed = Object.keys(before).filter(f => crypto.createHash('sha256').update(fs.readFileSync(path.join(root, f))).digest('hex') !== before[f]);
    check(!changed.length, `make-dossiers.mjs writes the same bytes again ${changed.join(', ')}`);
}

// ---------------------------------------------------------------- the print layout: no text over text, nothing outside its box or the page
// Each print layout is made again as make-dossiers.mjs makes it (measured, then placed) and read in Chromium, page by
// page: every line of text and every chart label is a box. Two boxes of different texts must not intersect (an element
// marked data-layer is layered on purpose and left out), nor a text and a chart's mark; no element with a fixed size or hidden overflow may hold more
// than its size (scrollWidth, scrollHeight); a chart label stays inside its chart; text stays on the page, out of the
// running head's and the folio's bands.
const { buildModel, printLayout } = require(path.resolve(here, '../visualization/awa-dossier-node.js'));
const layoutProblems = page => page.evaluate(() => {
    const out = [], pages = [...document.querySelectorAll('section.pg')];
    const hiddenText = el => el.closest('.vh, caption, [hidden], [data-layer], title, desc, style, script') || getComputedStyle(el).visibility !== 'visible' || getComputedStyle(el).display === 'none';
    pages.forEach((pg, pi) => {
        const P = pg.getBoundingClientRect(), n = pi + 1, boxes = [];
        const at = r => ({ x0: r.left - P.left, y0: r.top - P.top, x1: r.right - P.left, y1: r.bottom - P.top });
        const say = el => (el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 40);
        // the boxes: each line of each HTML text node, each SVG text element
        const walker = document.createTreeWalker(pg, NodeFilter.SHOW_TEXT);
        let id = 0;
        for (let t = walker.nextNode(); t; t = walker.nextNode()) {
            const el = t.parentElement;
            if (!t.textContent.trim() || el.closest('svg') || hiddenText(el)) continue;
            const range = document.createRange(); range.selectNodeContents(t); id++;
            const size = parseFloat(getComputedStyle(el).fontSize), track = Math.max(0, -parseFloat(getComputedStyle(el).letterSpacing) || 0);
            for (const r of range.getClientRects()) if (r.width > 0.5 && r.height > 0.5) { const b = at(r); b.x1 += track; boxes.push({ id, el, size, text: t.textContent.trim().slice(0, 40), ...b }); }
        }
        for (const el of pg.querySelectorAll('svg text')) {
            if (!el.textContent.trim() || hiddenText(el)) continue;
            const r = el.getBoundingClientRect(); id++;
            boxes.push({ id, el, size: parseFloat(getComputedStyle(el).fontSize), text: say(el), svg: el.ownerSVGElement, ...at(r) });
        }
        // two texts over each other: a box is the font's ascent to descent, taken from the cap height to just above the
        // lowest descender, so that lines set tight still pass and a descender on the next line's capitals does not
        const inset = b => ({ x0: b.x0 + 0.75, x1: b.x1 - 0.75, y0: b.y0 + 0.22 * b.size, y1: b.y1 - 0.08 * b.size });
        const ins = boxes.map(inset);
        for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) {
            if (boxes[i].id === boxes[j].id) continue;
            const a = ins[i], b = ins[j];
            if (a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1) out.push(`page ${n}: "${boxes[i].text}" overlaps "${boxes[j].text}"`);
        }
        // a chart's marks (class "mark") under no text
        for (const mk of pg.querySelectorAll('svg .mark')) {
            const r = at(mk.getBoundingClientRect());
            boxes.forEach((b, i) => { const a = ins[i]; if (a.x0 < r.x1 - 1 && r.x0 + 1 < a.x1 && a.y0 < r.y1 - 1 && r.y0 + 1 < a.y1) out.push(`page ${n}: "${b.text}" lies on a chart's mark`); });
        }
        // text off the page, in the running head's band or the folio's band
        const folio = pg.querySelector('.fo'), head = pg.querySelector('.rh');
        const foTop = folio ? folio.getBoundingClientRect().top - P.top - 8 : 1123, rhBottom = head ? head.getBoundingClientRect().bottom - P.top + 8 : 0;
        for (const raw of boxes) {
            const b = { ...raw, ...inset(raw) };
            if (b.x0 < -0.5 || b.y0 < -0.5 || b.x1 > 794.5 || b.y1 > 1123.5) out.push(`page ${n}: "${b.text}" leaves the page`);
            else if (!b.el.closest('.fo, .rh') && (b.y1 > foTop + 2 || b.y0 < rhBottom - 2) && b.y1 - b.y0 > 0) out.push(`page ${n}: "${b.text}" enters the ${b.y1 > foTop + 2 ? 'folio' : 'running head'}'s band`);
            if (b.svg) { const s = at(b.svg.getBoundingClientRect()); if (b.x0 < s.x0 - 1 || b.x1 > s.x1 + 1 || b.y0 < s.y0 - 1 || b.y1 > s.y1 + 1) out.push(`page ${n}: the label "${b.text}" leaves its chart`); }
        }
        // a box that holds more than its size
        for (const el of pg.querySelectorAll('*')) {
            if (el.closest('svg') || el.matches('.vh, caption') || el.closest('.vh, caption')) continue;
            const cs = getComputedStyle(el), clips = cs.overflowX !== 'visible' || cs.overflowY !== 'visible', fixedW = !!el.style.width && cs.whiteSpace !== 'normal', fixedH = !!el.style.height || !!el.style.maxHeight;
            if (!(clips || fixedW || fixedH) || !el.textContent.trim()) continue;
            if (el.scrollHeight > el.clientHeight + 1 && (clips || fixedH)) out.push(`page ${n}: "${say(el)}" is taller than its box (${el.scrollHeight} > ${el.clientHeight} px)`);
            if (el.scrollWidth > el.clientWidth + 1) out.push(`page ${n}: "${say(el)}" is wider than its box (${el.scrollWidth} > ${el.clientWidth} px)`);
        }
        if (pg.scrollHeight > pg.clientHeight + 1 || pg.scrollWidth > pg.clientWidth + 1) out.push(`page ${n}: content leaves the page (${pg.scrollWidth} × ${pg.scrollHeight} px)`);
    });
    return { pages: pages.length, problems: [...new Set(out)] };
});
{
    const browser = await chromium.launch();
    for (const d of DOSSIERS) {
        const dir = path.join(root, 'examples', d.example), name = path.basename(d.file) + ' (print)';
        const { model, theme } = buildModel({ record: path.join(dir, 'journeys.json'), optionsFile: path.join(dir, 'views/story-options.json'), edition: d.edition, customer: d.customer, source: `examples/${d.example}/journeys.json` });
        const page = await browser.newPage({ viewport: { width: 794, height: 1123 } });
        await printLayout(page, model, theme);
        const res = await layoutProblems(page);
        check(!res.problems.length, `${name}: on ${res.pages} pages no text over text or marks, no text outside its box or the page, the bands of the running head and the folio kept clear (${res.problems.length} found)${res.problems.length ? '\n        ' + res.problems.slice(0, 200).join('\n        ') : ''}`);
        await page.close();
    }
    await browser.close();
}
if (process.argv.includes('--layout')) { console.log(failures.length ? `\n${failures.length} check(s) failed` : '\nall checks passed'); process.exit(failures.length ? 1 : 0); }

// ---------------------------------------------------------------- HTML
const contrastOf = page => page.evaluate(() => {
    const parse = v => { const m = /rgba?\(([^)]+)\)/.exec(v); if (!m) return null; const p = m[1].split(/[\s,/]+/).filter(Boolean).map(Number); return { r: p[0], g: p[1], b: p[2], a: p[3] ?? 1 }; };
    const over = (c, bg) => ({ r: c.r * c.a + bg.r * (1 - c.a), g: c.g * c.a + bg.g * (1 - c.a), b: c.b * c.a + bg.b * (1 - c.a), a: 1 });
    const lum = c => { const f = x => { x /= 255; return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b); };
    const ratio = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
    const behind = el => { const layers = []; for (let e = el; e; e = e.parentElement) { const c = parse(getComputedStyle(e).backgroundColor); if (c && c.a > 0) { layers.push(c); if (c.a >= 1) break; } } let bg = layers.length && layers[layers.length - 1].a >= 1 ? layers.pop() : { r: 255, g: 255, b: 255, a: 1 }; for (const c of layers.reverse()) bg = over(c, bg); return bg; };
    const out = []; let n = 0;
    for (const el of document.querySelectorAll('body *')) {
        if (!el.childNodes.length || ![...el.childNodes].some(t => t.nodeType === 3 && t.textContent.trim())) continue;
        if (el.closest('svg') || el.closest('[aria-hidden="true"]') || el.closest('[hidden]') || el.closest('.vh') || !el.getClientRects().length || getComputedStyle(el).visibility !== 'visible') continue;
        const fg = parse(getComputedStyle(el).color); if (!fg) continue;
        const bg = behind(el), r = ratio(over(fg, bg), bg), size = parseFloat(getComputedStyle(el).fontSize), bold = Number(getComputedStyle(el).fontWeight) >= 700;
        const need = size >= 24 || (bold && size >= 18.66) ? 3 : 4.5; n++;
        if (r < need) out.push(`"${el.textContent.trim().slice(0, 30)}" ${r.toFixed(2)}:1`);
    }
    return { n, low: out };
});
const browser = await chromium.launch();
for (const d of DOSSIERS) {
    const file = path.join(root, d.file + '.html'), name = path.basename(d.file);
    for (const width of [1440, 400]) {
        const page = await browser.newPage({ viewport: { width, height: 900 } });
        const errors = []; page.on('pageerror', e => errors.push(e.message));
        await page.goto('file://' + file); await page.waitForTimeout(900);
        const basics = await page.evaluate(() => ({ lang: document.documentElement.lang, title: document.title, main: !!document.querySelector('main'), banner: !!document.querySelector('header'), nav: !!document.querySelector('nav[aria-label]'), h1: document.querySelectorAll('h1').length,
            order: [...document.querySelectorAll('h1,h2,h3,h4')].map(h => Number(h.tagName[1])), wide: document.documentElement.scrollWidth, imgs: [...document.querySelectorAll('svg[role="img"], [role="img"]')].every(n => n.getAttribute('aria-label') || n.getAttribute('aria-labelledby')) }));
        const skips = basics.order.filter((l, i) => i && l > basics.order[i - 1] + 1);
        if (width === 1440) {
            check(basics.lang === 'en' && basics.title && basics.main && basics.banner && basics.nav && basics.h1 === 1, `${name}: lang, title, landmarks (banner, navigation, main) and one h1`);
            check(!skips.length, `${name}: headings in order, no level skipped (${basics.order.length} headings)`);
            check(basics.imgs, `${name}: every figure has a text alternative`);
            await page.keyboard.press('Tab'); await page.waitForTimeout(400);
            const first = await page.evaluate(() => ({ text: document.activeElement.textContent, outline: getComputedStyle(document.activeElement).outlineStyle, top: document.activeElement.getBoundingClientRect().top }));
            check(/Skip/.test(first.text) && first.top >= 0, `${name}: the first Tab reaches the skip link, which shows`);
            const btn = page.locator('[data-table]').first();
            if (await btn.count()) {
                await btn.focus(); await page.keyboard.press('Enter');
                const shown = await btn.evaluate(b => ({ open: b.getAttribute('aria-expanded'), visible: !document.getElementById(b.dataset.table).hidden, outline: getComputedStyle(b).outlineStyle }));
                check(shown.open === 'true' && shown.visible && shown.outline !== 'none', `${name}: a chart's table opens from the keyboard, with a visible focus ring`);
                await page.keyboard.press('Enter');
            }
            const c = await contrastOf(page);
            check(c.n > 50 && !c.low.length, `${name}: every text reads at 4.5:1 or more (3:1 large), ${d.theme} theme (${c.n} checked) ${c.low.slice(0, 5).join('; ')}`);
            if (axe) {
                await page.addScriptTag({ content: axe });
                const res = await page.evaluate(async () => { const r = await window.axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'] }, resultTypes: ['violations'] }); return r.violations.map(v => `${v.id} (${v.nodes.length}): ${v.help}`); });
                check(!res.length, `${name}: axe-core finds no WCAG 2.2 A or AA violation ${res.join('; ')}`);
            }
            if (d.client) { const text = await page.evaluate(() => document.body.innerText); const named = d.others.filter(o => new RegExp(`\\b${o}\\b`).test(text)); check(!named.length, `${name}: names no other customer ${named.join(', ')}`); }
        } else {
            check(basics.wide <= 400, `${name}: no sideways scroll at 400 px (${basics.wide} px)`);
        }
        check(!errors.length, `${name} at ${width}: no page errors ${errors.join('; ')}`);
        await page.close();
    }
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' });
    const still = await ctx.newPage(); await still.goto('file://' + file); await still.waitForTimeout(400);
    await still.evaluate(() => window.scrollTo(0, document.body.scrollHeight / 2)); await still.waitForTimeout(400);
    const running = await still.evaluate(() => document.getAnimations().filter(a => a.playState === 'running').length);
    check(running === 0, `${name}: under prefers-reduced-motion nothing animates (${running} running)`);
    await ctx.close();
    const off = await browser.newPage({ viewport: { width: 1440, height: 900 } }); await off.goto('file://' + file); await off.click('#motion'); await off.evaluate(() => window.scrollTo(0, 3000)); await off.waitForTimeout(400);
    const offRunning = await off.evaluate(() => document.getAnimations().filter(a => a.playState === 'running').length);
    check(offRunning === 0 && await off.getAttribute('#motion', 'aria-pressed') === 'false', `${name}: the Motion switch stops the motion`);
    await off.close();
}
await browser.close();

// ---------------------------------------------------------------- PDF
const inflateStreams = buf => { const s = buf.toString('latin1'), out = []; const re = /(?<!end)stream\r?\n/g; let m; while ((m = re.exec(s))) { const start = m.index + m[0].length, end = s.indexOf('endstream', start); if (end < 0) break; try { out.push(zlib.inflateSync(Buffer.from(s.slice(start, end), 'latin1')).toString('latin1')); } catch { /* not deflated */ } re.lastIndex = end; } return out; };
for (const d of DOSSIERS) {
    const file = path.join(root, d.file + '.pdf'), name = path.basename(d.file) + '.pdf', buf = fs.readFileSync(file), s = buf.toString('latin1');
    let info = '';
    try { info = execFileSync('pdfinfo', [file], { encoding: 'utf8' }); } catch { note('pdfinfo is not installed: the page count is read from the file'); }
    const pages = info ? Number(/Pages:\s+(\d+)/.exec(info)[1]) : (s.match(/\/Type \/Page\b/g) || []).length;
    check(pages >= d.pages[0] && pages <= d.pages[1], `${name}: ${pages} A4 pages`);
    check(/\/Lang \(en\)/.test(s) && /\/MarkInfo << \/Type \/MarkInfo \/Marked true >>|\/Marked true/.test(s) && /\/StructTreeRoot/.test(s), `${name}: tagged (MarkInfo, structure tree) with its language (en)`);
    check(/\/Outlines/.test(s) && /\/DisplayDocTitle true/.test(s) && (!info || /Title:\s+\S/.test(info)), `${name}: bookmarks, and the title shown in place of the file name`);
    const streams = inflateStreams(buf).join('\n');
    const figures = (s.match(/\/S \/Figure/g) || []).length, alts = (s.match(/\/Alt \(/g) || []).length + (s.match(/\/Alt <FEFF/g) || []).length;
    const th = (s.match(/\/S \/TH\b/g) || []).length, h = ['H1', 'H2', 'H3'].map(t => (s.match(new RegExp(`/S /${t}\\b`, 'g')) || []).length);
    check(figures > 0 && alts >= figures, `${name}: ${figures} figures, each with alternative text`);
    check(th > 0 && h[0] >= 1 && h[1] >= 4, `${name}: headings (${h.join(', ')} of levels 1 to 3) and ${th} table header cells`);
    note(`${name}: ${(streams.match(/\/Artifact\b/g) || []).length} content sequences marked as artifacts`);
}
try { execFileSync('verapdf', ['--version'], { stdio: 'ignore' }); note('veraPDF is installed: run verapdf --flavour ua1 on the PDFs'); } catch { note('veraPDF is not available here: PDF/UA-1 was not validated by a validator (tools/dossier/README.md says what Chromium meets)'); }

// ---------------------------------------------------------------- DOCX
const unzip = buf => { const out = {}; let i = 0; while (buf.readUInt32LE(i) === 0x04034b50) { const size = buf.readUInt32LE(i + 18), n = buf.readUInt16LE(i + 26), extra = buf.readUInt16LE(i + 28), nm = buf.slice(i + 30, i + 30 + n).toString('utf8'), data = buf.slice(i + 30 + n + extra, i + 30 + n + extra + size); out[nm] = /\.(png)$/.test(nm) ? data : zlib.inflateRawSync(data).toString('utf8'); i += 30 + n + extra + size; } return out; };
let soffice = null;
for (const c of ['soffice', 'libreoffice']) { try { execFileSync(c, ['--version'], { stdio: 'ignore' }); soffice = c; break; } catch { /* not here */ } }
for (const d of DOSSIERS) {
    const file = path.join(root, d.file + '.docx'), name = path.basename(d.file) + '.docx', parts = unzip(fs.readFileSync(file)), doc = parts['word/document.xml'];
    check(!!doc && /<w:pStyle w:val="Heading1"\/>/.test(doc) && /<w:pStyle w:val="Heading2"\/>/.test(doc) && /<w:pStyle w:val="Voice"\/>/.test(doc), `${name}: Heading 1 and 2 styles, and the customers' voice in a style of its own`);
    const pics = (doc.match(/<wp:docPr [^>]*>/g) || []);
    check(pics.length > 0 && pics.every(p => /descr="[^"]{12,}"/.test(p)), `${name}: ${pics.length} charts, each with alt text`);
    check((doc.match(/<w:tblHeader\/>/g) || []).length >= 4, `${name}: table header rows marked to repeat`);
    check(/<w:lang w:val="en-GB"/.test(parts['word/styles.xml']) && /<dc:language>en-GB<\/dc:language>/.test(parts['docProps/core.xml']) && /<dc:title>[^<]+<\/dc:title>/.test(parts['docProps/core.xml']), `${name}: language and title set`);
    check(/ PAGE /.test(parts['word/footer1.xml']) && !!parts['word/header1.xml'], `${name}: a page header and page numbers`);
    if (d.client) { const named = d.others.filter(o => new RegExp(`\\b${o}\\b`).test(doc.replace(/<[^>]+>/g, ' '))); check(!named.length, `${name}: names no other customer`); }
    if (soffice) {
        const out = fs.mkdtempSync(path.join(fs.realpathSync(process.env.TMPDIR || '/tmp'), 'dossier-'));
        try { execFileSync(soffice, ['--headless', '--convert-to', 'pdf', '--outdir', out, file], { stdio: 'ignore', timeout: 180000 }); const pdf = path.join(out, path.basename(file, '.docx') + '.pdf'); const n = Number(/Pages:\s+(\d+)/.exec(execFileSync('pdfinfo', [pdf], { encoding: 'utf8' }))[1]); check(n > 3, `${name}: LibreOffice opens it and renders ${n} pages`); }
        catch (e) { check(false, `${name}: LibreOffice renders it (${e.message})`); }
        finally { fs.rmSync(out, { recursive: true, force: true }); }
    } else note('LibreOffice is not installed: the DOCX was checked as XML only');
}
console.log(failures.length ? `\n${failures.length} check(s) failed` : '\nall checks passed');
process.exit(failures.length ? 1 : 0);
