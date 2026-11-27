// Checks the journey view in a real browser: the sample at every height, a
// record opened from a file, a host followed live while its journeys move, and the
// builder's options (names, bands, routes) on the electricity onboarding example.
//
//   cd sdk/typescript && npm run build
//   node tools/visualization/journey.check.mjs        (needs Playwright)

import fs from 'fs';
import http from 'http';
import os from 'os';
import path from 'path';
import { spawn, execFileSync } from 'child_process';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const { build_story, name_lines } = require('./journey-story-builder.js');

const here = path.dirname(fileURLToPath(import.meta.url)), root = path.resolve(here, '../..');
const page_url = 'file://' + path.join(here, 'journey.html');
const cli = path.join(root, 'sdk/typescript/dist/cli/index.js'), example = path.join(root, 'examples/claims-journey');
const failures = [];
const check = (ok, what) => { console.log(`${ok ? 'ok  ' : 'FAIL'}  ${what}`); if (!ok) failures.push(what); };
const browser = await chromium.launch();
const open = async url => {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    page.errors = []; page.on('pageerror', e => page.errors.push(e.message));
    await page.goto(url); await page.waitForTimeout(800);
    return page;
};
const settle = page => page.waitForTimeout(900);

/**
 * How well the text of the view reads: for each element matched (visible, with text, not dimmed on purpose), the contrast of its colour
 * on the background behind it. Returns [{ sel, text, ratio }].
 */
const legibility = (page, selectors) => page.evaluate(selectors => {
    const parse = v => {
        let m = /^rgba?\(([^)]+)\)/.exec(v);
        if (m) { const p = m[1].split(/[\s,/]+/).filter(Boolean).map(Number); return { r: p[0], g: p[1], b: p[2], a: p[3] ?? 1 }; }
        m = /^color\(srgb ([^)]+)\)/.exec(v);
        if (m) { const p = m[1].split(/[\s/]+/).filter(Boolean).map(Number); return { r: p[0] * 255, g: p[1] * 255, b: p[2] * 255, a: p[3] ?? 1 }; }
        return null;
    };
    const over = (c, bg) => ({ r: c.r * c.a + bg.r * (1 - c.a), g: c.g * c.a + bg.g * (1 - c.a), b: c.b * c.a + bg.b * (1 - c.a), a: 1 });
    const lum = c => { const f = x => { x /= 255; return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b); };
    const ratio = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
    const behind = el => {
        const layers = [];
        for (let e = el; e; e = e.parentElement) { const c = parse(getComputedStyle(e).backgroundColor); if (c && c.a > 0) { layers.push(c); if (c.a >= 1) break; } }
        let bg = layers.length && layers[layers.length - 1].a >= 1 ? layers.pop() : parse(getComputedStyle(document.body).backgroundColor);
        for (const c of layers.reverse()) bg = over(c, bg);
        return bg;
    };
    const dimmed = el => { for (let e = el; e; e = e.parentElement) { const cs = getComputedStyle(e); if (Number(cs.opacity) < 0.99 || cs.filter !== 'none' || cs.visibility !== 'visible') return true; } return false; };
    const out = [];
    for (const sel of selectors) for (const el of [...document.querySelectorAll(sel)].filter(e => e.getClientRects().length && e.textContent.trim() && !dimmed(e)).slice(0, 12)) {
        const bg = behind(el), fg = over(parse(getComputedStyle(el).color), bg);
        out.push({ sel, text: el.textContent.trim().slice(0, 30), ratio: Math.round(ratio(fg, bg) * 100) / 100 });
    }
    return out;
}, selectors);

/**
 * The run view on screen: every activity's name inside its box and not cut (three lines fit; the builder widens the boxes of
 * a workflow until each name does), no two nodes on top of each other, and names never drawn smaller than 11 px.
 */
const run_layout = page => page.evaluate(() => {
    const scene = document.querySelector('#L3 .scene'), problems = [];
    const graph = scene.querySelector('.gband'), scale = Number(graph.dataset.scale);
    const acts = [...scene.querySelectorAll('.nd.act')], sizes = new Set(acts.map(n => `${parseFloat(n.style.width)} × ${parseFloat(n.style.height)}`));
    for (const box of acts) {
        const name = box.querySelector('.nm'), b = box.getBoundingClientRect(), t = name.getBoundingClientRect();
        if (name.scrollHeight > name.clientHeight + 1 || name.scrollWidth > name.clientWidth + 1) problems.push(`"${name.textContent}" is cut`);
        if (t.bottom > b.bottom - 1 || t.right > b.right - 1) problems.push(`"${name.textContent}" leaves its box`);
    }
    if (sizes.size > 1) problems.push(`activity boxes of ${sizes.size} sizes: ${[...sizes].join(', ')}`);
    const nodes = [...scene.querySelectorAll('.nd')].map(n => ({ name: n.title || n.dataset.n, x: parseFloat(n.style.left), y: parseFloat(n.style.top), w: parseFloat(n.style.width), h: parseFloat(n.style.height) }));
    for (let i = 0; i < nodes.length; i++) for (let k = i + 1; k < nodes.length; k++) {
        const a = nodes[i], c = nodes[k];
        if (a.x < c.x + c.w && c.x < a.x + a.w && a.y < c.y + c.h && c.y < a.y + a.h) problems.push(`${a.name} overlaps ${c.name}`);
    }
    const px = 12 * scale * (document.getElementById('fit').getBoundingClientRect().width / 1440);
    if (px < 11 - 1e-6) problems.push(`names drawn at ${px.toFixed(2)} px`);
    return { problems, size: [...sizes][0], px: Math.round(px * 100) / 100 };
});
const to_end = async page => { await page.evaluate(() => { const s = document.getElementById('scrub'); s.value = s.max; s.dispatchEvent(new Event('input')); }); await settle(page); };

// 1. The sample, at every height and sideways
{
    const page = await open(page_url);
    check(await page.locator('.jcard').count() === 3 && await page.locator('.pcell').count() === 18, 'atlas shows 3 journeys and 18 cells');
    await page.click('[data-open-j="1"]'); await settle(page);
    check(await page.locator('.lane').count() === 6, 'one journey shows a lane per customer');
    await page.click('[data-lane="1"]'); await settle(page);
    check((await page.textContent('#crumbs')).includes('A. Okafor'), 'a lane opens that customer');
    check(await page.locator('.rowl').count() > 10 && await page.locator('.ms').count() > 5, 'the blueprint has mood, technology and exchange rows');
    await page.click('#switch [data-j="2"]'); await settle(page);
    check((await page.textContent('#crumbs')).includes('Policy Renewal') && (await page.textContent('#crumbs')).includes('A. Okafor'), 'the journey switch keeps the customer');
    await page.click('[data-person="1"]'); await settle(page);
    check(!(await page.textContent('#crumbs')).includes('A. Okafor'), 'the customer arrows keep the journey');
    check(await page.textContent('#count').then(t => t.split(' / ')[0] === t.split(' / ')[1]), 'a sideways move opens the whole story, like every other way in');
    await page.click('[data-list="toggle"]'); await settle(page);
    const short = await page.locator('#listb button').count(); await page.click('[data-list="all"]'); await settle(page);
    check(short > 2 && await page.locator('#listb button').count() > short, 'the story reads as a dated list: the customer\'s side, or everything');
    await page.click('#listp [data-list="toggle"]'); await settle(page);
    await page.click('.md >> nth=0'); await settle(page);
    check(await page.locator('.g').count() === await page.locator('.g:visible').count() && (await page.textContent('#facts')).includes('Mood'), 'selecting a point on the mood line explains it, and hides nothing');
    await to_end(page);
    await page.click('.rbl[data-run="0"]'); await settle(page);
    check(await page.locator('.nd').count() > 5 && (await page.textContent('#evidence')).includes('Journal record'), 'a run shows its graph and evidence');
    // Every workflow of the sample, in the run view: one size of box, every name inside its box, nothing on top of anything
    const runs = await page.evaluate(() => { const seen = {}; window.AWA_STORY.journeys.forEach((j, jk) => j.instances.forEach((c, i) => c.runs.forEach((run, r) => { if (!(run.wf in seen)) seen[run.wf] = [jk, i, r, run.name]; }))); return Object.values(seen); });
    for (const [j, i, r, name] of runs) {
        await page.evaluate(([j, i, r]) => { location.hash = `#run/${j}/${i}/${r}/0`; }, [j, i, r]); await settle(page);
        const { problems, size, px } = await run_layout(page);
        check(!problems.length && size === '140 × 72', `${name}: activity boxes ${size}, every name inside its box, no node on another, names at ${px} px ${problems.join('; ')}`);
    }
    // The glossary: a button, a search, the words of the view, a link to an entry, Escape and the focus
    {
        const { terms } = createRequire(import.meta.url)('./awa-glossary.js');
        check(await page.locator('#b-gloss').isVisible() && await page.locator('#gloss').isHidden(), 'the top bar has a Glossary button, the panel closed');
        await page.click('#b-gloss'); await page.waitForTimeout(200);
        check(await page.locator('#gloss').isVisible() && await page.evaluate(() => document.activeElement.id) === 'gq'
            && await page.getAttribute('#gq', 'placeholder') === `Search ${terms.length} terms`, `the button opens the glossary, the search focused ("Search ${terms.length} terms")`);
        check(await page.locator('#glist .ge').count() === terms.length && await page.evaluate(() => /#run\/.*\/glossary$/.test(location.hash)), 'it lists every term, and the address says the glossary is open');
        await page.keyboard.type('four eyes'); await page.waitForTimeout(200);
        check(await page.locator('#glist .ge').count() >= 1 && (await page.textContent('#glist .ge >> nth=0')).includes('Four eyes') && await page.textContent('#count') !== null, 'a search filters as you type');
        await page.keyboard.press('ArrowLeft');
        await page.fill('#gq', ''); await page.click('[data-gfilter="measures"]'); await page.waitForTimeout(200);
        check(await page.locator('#glist .ge').count() === terms.filter(t => t.group === 'measures').length, 'a chip shows one group');
        // Tab stays in the panel
        await page.focus('#gloss-close'); await page.keyboard.press('Shift+Tab');
        check(await page.evaluate(() => document.getElementById('gloss').contains(document.activeElement)), 'Tab stays inside the open panel');
        await page.keyboard.press('Escape'); await page.waitForTimeout(200);
        check(await page.locator('#gloss').isHidden() && await page.evaluate(() => document.activeElement.id) === 'b-gloss' && await page.evaluate(() => window.AWA_VIEW.level) === 'run',
            'Escape closes the glossary, gives the focus back to the button, and stays on the run');
        // A dotted word of the legend opens its entry
        await page.click('#L3 .gw:text("undone afterwards")'); await page.waitForTimeout(300);
        check(await page.locator('#gloss').isVisible() && await page.getAttribute('#glist .ge.on', 'id') === 'g-compensation' && await page.evaluate(() => location.hash.endsWith('/glossary/compensation')),
            'a dotted word of the legend ("undone afterwards") opens its entry, and the address names it');
        await page.click('#gloss-close'); await page.waitForTimeout(200);
        const tag = page.locator('#L3 .nd.act .gw.tg').first();
        await tag.click(); await page.waitForTimeout(300);
        const tag_term = await page.getAttribute('#glist .ge.on', 'id');
        check(['g-ai-agent', 'g-person', 'g-system', 'g-robot', 'g-compensation'].includes(tag_term) && await page.evaluate(() => window.AWA_VIEW.level) === 'run', `an actor tag opens its entry (${tag_term})`);
        await page.keyboard.press('Escape'); await page.waitForTimeout(200);
        // The keys: ? opens and closes it, / searches
        await page.keyboard.press('?'); await page.waitForTimeout(200);
        const opened = await page.locator('#gloss').isVisible();
        await page.keyboard.press('Escape'); await page.keyboard.press('/'); await page.waitForTimeout(200);
        check(opened && await page.evaluate(() => document.activeElement.id) === 'gq', 'the ? key opens the glossary and / goes to its search');
        await page.keyboard.press('Escape'); await page.waitForTimeout(200);
        // A link to an entry, with the place in the view
        const here = await page.evaluate(() => location.hash);
        await page.evaluate(h => { location.hash = h + '/glossary/four-eyes'; }, here); await settle(page);
        check(await page.locator('#gloss').isVisible() && await page.getAttribute('#glist .ge.on', 'id') === 'g-four-eyes' && await page.evaluate(() => window.AWA_VIEW.level) === 'run',
            'a link #level/…/glossary/<term> opens the view at its place with the entry shown');
        await page.keyboard.press('Escape'); await settle(page);
        check(await page.evaluate(() => location.hash) === here, 'closing it takes /glossary off the address, and the place stays');
    }
    await page.keyboard.press('Escape'); await page.keyboard.press('Escape'); await page.keyboard.press('Escape'); await settle(page);
    check(await page.locator('.layer.on').getAttribute('id') === 'L0', 'Escape goes up to the atlas');
    const hash = await page.evaluate(() => location.hash);
    check(/^#atlas\//.test(hash), 'the address carries the place');
    check(page.errors.length === 0, `no page errors on the sample ${page.errors.join('; ')}`);
    await page.close();
}

// 2. A record made with the command line, opened from a file, then followed live from a server
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'awa-view-'));
const awa = (...args) => execFileSync('node', [cli, 'journey', ...args, '--dir', dir], { stdio: ['ignore', 'pipe', 'pipe'] }).toString();
const sim = ['-s', '--outputs', path.join(example, 'simulation.json')];
awa('add', path.join(example, 'policy-purchase.awa.json'), path.join(example, 'policy-purchase.journey.json'));
awa('publish', 'quote.requested', '-d', JSON.stringify({ customer_id: 'c-1', name: 'Ada' }), ...sim);
awa('publish', 'quote.requested', '-d', JSON.stringify({ customer_id: 'c-2', name: 'Ben' }), ...sim);
awa('publish', 'quote.accepted', '-d', JSON.stringify({ customer_id: 'c-1', quote_accepted: true }), ...sim);
const record = path.join(dir, 'portfolio.json');
awa('export', '-o', record);
{
    const page = await open(page_url);
    await page.setInputFiles('#file', record); await settle(page);
    check(await page.locator('.jcard').count() === 1 && await page.locator('.pcell').count() === 2, 'a record exported by the command line opens: 1 journey, 2 customers');
    check((await page.textContent('.pname')).includes('Ada'), 'customers are named from the record');
    await page.click('.pcell'); await settle(page);
    check(await page.locator('.g').count() >= 8, 'its journey is told as beats');
    await page.click('.rbl[data-run="0"]'); await settle(page);
    check(await page.locator('.nd.act').count() === 5, 'its workflow is laid out by rule, without a hand-made layout');
    check(page.errors.length === 0, `no page errors on an opened record ${page.errors.join('; ')}`);
    await page.close();
}
{
    const port = 4300 + Math.floor(Math.random() * 500);
    const server = spawn('node', [cli, 'serve', '--no-auth', '-p', String(port)], { env: { ...process.env, AWA_DATA_DIR: dir, AWA_SIMULATE: '1', AWA_SIMULATED_OUTPUTS: path.join(example, 'simulation.json') }, stdio: 'ignore' });
    try {
        const base = `http://127.0.0.1:${port}`;
        for (let i = 0; i < 40; i++) { try { if ((await fetch(`${base}/api/v1/journeys`)).ok) break; } catch { /* not up yet */ } await new Promise(r => setTimeout(r, 250)); }
        const page = await open(`${page_url}?live=${encodeURIComponent(base)}`);
        await settle(page);
        check((await page.textContent('#source')).startsWith('live') && await page.locator('.pcell').count() === 2, 'a host is followed live: the server recovered what the command line left');
        await page.click('.pcell >> nth=1'); await settle(page);                       // Ben, still waiting to accept the quote
        const before = await page.textContent('#count');
        await fetch(`${base}/api/v1/journeys/events`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ type: 'quote.accepted', data: { customer_id: 'c-2', quote_accepted: true } }) });
        await page.waitForTimeout(4500);
        const after = await page.textContent('#count');
        check(before !== after && after.split(' / ')[0] === after.split(' / ')[1], `the view follows the journey as it moves, staying at the latest moment (${before} -> ${after})`);
        check((await page.textContent('#crumbs')).includes('Ben'), 'and keeps the reader on the same customer');
        check(page.errors.length === 0, `no page errors while following live ${page.errors.join('; ')}`);
        await page.close();
    } finally { server.kill(); }
}

// 3. The options: a subject named from its data, a long workflow in bands, the routes of a layout that wraps
{
    const electricity = path.join(root, 'examples/electricity-onboarding');
    const record = JSON.parse(fs.readFileSync(path.join(electricity, 'journeys.json'), 'utf-8'));
    const options = JSON.parse(fs.readFileSync(path.join(electricity, 'views/story-options.json'), 'utf-8'));
    const story = build_story(record, options);
    check(story.customers.some(c => c.name === 'Tomás Reyes') && story.journeys[0].instances.every(c => !/^APP-/.test(c.name)), 'subject_name names the customers from the data of their journey');
    check(build_story(record).customers.every(c => /^APP-/.test(c.name)), 'without it, a customer is named by the key of the journey');
    const W = story.workflows.find(w => w.name === 'Electricity Customer Onboarding');
    check(W.bands?.length === 3 && W.nodes.every(n => n.band >= 0 && n.band < 3) && W.bands[0].label === 'Application and verification', 'bands: three bands, every node in one');
    const edge = (from, to) => W.edges.find(e => W.nodes[e.a].name === from && W.nodes[e.b].name === to);
    const down = edge('Applicant verified', 'Electricity source'), [b1, b2] = W.bands;
    const along = down.segs.filter(sg => sg.dir === 'l' || sg.dir === 'r');
    check(along.some(sg => sg.y > b1.y1 && sg.y < b2.y0) && down.tip.dir === 'd' && down.tip.y === W.nodes[down.b].y,
        'an edge to a later band and an earlier column runs along the gap above the target\'s band and comes down into the target');
    const back = edge('Documents checked', 'Request documents'), target = W.nodes[back.b];
    check(back.segs.every(sg => sg.y <= target.y) && back.tip.dir === 'd' && back.segs.some(sg => sg.dir === 'l' && sg.y < target.y),
        'an edge back to an earlier column of the same row goes over a track above the row');
    // A name that needs a fourth line at 140 widens every activity box of its workflow together, until each name fits in three
    const long = 'Refer the application to the commercial team for a decision on an unusual installation';
    const renamed = build_story(JSON.parse(JSON.stringify(record).split('Refer to commercial team').join(long)), options);
    const widths = new Set(renamed.workflows.find(w => w.name === 'Grid Export Registration').nodes.filter(n => n.kind === 'activity').map(n => n.w));
    const other = new Set(renamed.workflows.find(w => w.name === 'Electricity Customer Onboarding').nodes.filter(n => n.kind === 'activity').map(n => n.w));
    check(widths.size === 1 && [...widths][0] > 140 && name_lines(long, [...widths][0] - 23) <= 3 && [...other].join() === '140',
        `a name too long for three lines widens every box of its workflow, and only of its workflow (${[...widths]} and ${[...other]})`);
    const plain = build_story(record, { layouts: options.layouts }).workflows.find(w => w.name === 'Electricity Customer Onboarding');
    check(!plain.bands && plain.edges.length === W.edges.length, 'without bands, the same layout has no bands');
    // The claims sample is laid out as it was: the builder rebuilds the committed story exactly
    const committed = fs.readFileSync(path.join(here, 'journey-story.js'), 'utf-8');
    const out = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'awa-story-')), 'story.json');
    execFileSync('node', [path.join(root, 'examples/claims-journey/make-story.mjs'), out], { stdio: 'ignore' });
    const rebuilt = fs.readFileSync(path.join(here, 'journey-story.js'), 'utf-8');
    if (rebuilt !== committed) fs.writeFileSync(path.join(here, 'journey-story.js'), committed);
    check(rebuilt === committed, 'the claims sample, built again, is the committed story: its routes are unchanged');

    // In the browser, from a record and the options served over HTTP
    const server = http.createServer((req, res) => {
        const file = path.join(root, decodeURIComponent(new URL(req.url, 'http://x').pathname));
        if (!file.startsWith(root) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); res.end(); return; }
        res.writeHead(200, { 'content-type': file.endsWith('.html') ? 'text/html; charset=utf-8' : file.endsWith('.js') ? 'text/javascript' : 'application/json' });
        fs.createReadStream(file).pipe(res);
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const base = `http://127.0.0.1:${server.address().port}`;
    try {
        const page = await open(`${base}/tools/visualization/journey.html?data=${encodeURIComponent(`${base}/examples/electricity-onboarding/journeys.json`)}&options=${encodeURIComponent(`${base}/examples/electricity-onboarding/views/story-options.json`)}`);
        await settle(page);
        check((await page.textContent('#L0')).includes('Tomás Reyes'), '?options= names the customers in the atlas');
        // A link followed while the page is open moves the view, as a click would
        const tomas = story.journeys[0].instances.findIndex(c => c.name === 'Tomás Reyes');
        await page.evaluate(i => { location.hash = `#run/0/${i}/0/12`; }, tomas); await settle(page);
        check(await page.evaluate(() => window.AWA_VIEW.level === 'run') && (await page.textContent('#crumbs')).includes('Electricity Customer Onboarding'), 'a link followed while the page is open goes to the run');
        check(await page.locator('[data-bandchip]').count() === 3 && (await page.getAttribute('[data-bandchip="0"]', 'class')).includes(' on'), 'a run in bands shows its band chips, the band of the step being read in focus');
        const dimmed = async k => page.evaluate(k => [...document.querySelectorAll('#L3 .nd[data-band]')].filter(n => n.dataset.band === String(k)).every(n => n.classList.contains('dimb')), k);
        check(await dimmed(1) && !(await dimmed(0)), 'the other bands are dimmed');
        // The widest band, twelve columns, is shown at nearly its own size: its names stay legible in a video
        const scale = await page.evaluate(() => Number(/scale\(([\d.]+)\)/.exec(document.querySelector('#L3 .gband').style.transform)[1]));
        check(scale >= 11 / 12 - 1e-4, `a band is shown large enough to read: names at 11 px or more (scale ${scale})`);
        for (const k of [0, 1, 2]) {
            await page.click(`[data-bandchip="${k}"]`); await settle(page);
            const { problems, size, px } = await run_layout(page);
            check(!problems.length, `Electricity Customer Onboarding, band ${k + 1}: activity boxes ${size}, every name inside its box, no node on another, names at ${px} px ${problems.join('; ')}`);
        }
        // The first band is wider than the stage at a legible scale: the part around the step being read is shown, and the rest is a click away
        await page.click('[data-bandchip="0"]'); await settle(page);
        const shift = () => page.evaluate(() => Number(/translate\(([-\d.]+)px/.exec(document.querySelector('#L3 .gband').style.transform)[1]));
        const before_pan = await shift();
        check(await page.locator('#L3 .gmore.r:not([hidden])').count() + await page.locator('#L3 .gmore.l:not([hidden])').count() >= 1, 'a band too wide to show whole at a legible scale offers to show more beside it');
        const side = await page.locator('#L3 .gmore.r:not([hidden])').count() ? 'r' : 'l';
        await page.click(`#L3 .gmore.${side} button`); await settle(page);
        check(await shift() !== before_pan, `the arrow beside the graph shows more of it (${before_pan} -> ${await shift()})`);
        await page.click('[data-bandchip="1"]'); await settle(page);
        check((await page.getAttribute('[data-bandchip="1"]', 'class')).includes(' on') && await dimmed(0) && !(await dimmed(1)), 'a band chip focuses its band');
        await to_end(page);
        check((await page.getAttribute('[data-bandchip="2"]', 'class')).includes(' on') && (await page.textContent('[data-bandchip="0"]')).includes('done'), 'at the end of the run, the last band is in focus and the others are done');
        await page.evaluate(i => { location.hash = `#run/0/${i}/1/0`; }, tomas); await settle(page);
        check((await page.textContent('#crumbs')).includes('Grid Export Registration') && await page.locator('[data-bandchip]').count() === 1, 'the child run has its own band');
        {
            const { problems, size, px } = await run_layout(page);
            check(!problems.length, `Grid Export Registration: activity boxes ${size}, every name inside its box ("Grid operator approval, two engineers" included), no node on another, names at ${px} px ${problems.join('; ')}`);
        }
        await page.evaluate(() => { location.hash = '#atlas/0/0/0/0'; }); await settle(page);
        check(await page.locator('.layer.on').getAttribute('id') === 'L0', 'and a link goes back up to the atlas');
        // The journey's own words, from the options
        await page.evaluate(() => { location.hash = '#glossary/prosumer'; }); await settle(page);
        check(await page.locator('[data-gfilter="journey"]').count() === 1 && await page.getAttribute('#glist .ge.on', 'id') === 'g-prosumer'
            && (await page.textContent('#glist .gloss-g >> nth=0')) === 'This journey', '#glossary/<term> opens an entry of the journey\'s own glossary, listed first under "This journey"');
        await page.click('[data-gfilter="journey"]'); await page.waitForTimeout(200);
        check(await page.locator('#glist .ge').count() === options.glossary.length && await page.getAttribute('#g-metering-point a.ge-r', 'href').then(h => /^https:\/\//.test(h)), `the options give ${options.glossary.length} terms of the journey, with https links`);
        check(page.errors.length === 0, `no page errors with options ${page.errors.join('; ')}`);
        await page.close();
        // Option text is data: markup stays text, and only an https address becomes a link
        const evil = await browser.newPage({ viewport: { width: 1440, height: 900 } });
        evil.errors = []; evil.on('pageerror', e => evil.errors.push(e.message));
        await evil.route('**/evil-options.json', route => route.fulfill({ contentType: 'application/json', body: JSON.stringify({ glossary: [
            { term: '<img src=x onerror="window.pwned=1">Meter', definition: '<b>bold</b> text' , see: 'javascript:window.pwned=2' },
            { term: 'Tariff', definition: 'A price.', see: 'http://example.org/plain' },
            { term: 42, definition: 'not a term' },
        ] }) }));
        await evil.goto(`${base}/tools/visualization/journey.html?data=${encodeURIComponent(`${base}/examples/electricity-onboarding/journeys.json`)}&options=${encodeURIComponent(`${base}/evil-options.json`)}#glossary`);
        await evil.waitForTimeout(1500);
        const shown = await evil.evaluate(() => ({ pwned: window.pwned, imgs: document.querySelectorAll('#glist img, #glist b').length, links: document.querySelectorAll('#glist a').length,
            first: document.querySelector('#glist .ge .ge-t').textContent, mine: [...document.querySelectorAll('#glist .ge')].filter(e => !window.AWA_GLOSSARY.terms.some(t => 'g-' + t.id === e.id)).length }));
        check(!shown.pwned && shown.imgs === 0 && shown.links === 0 && shown.first.startsWith('<img') && shown.mine === 2, `glossary options are text: no markup, no link that is not https, a term that is not text left out (${JSON.stringify(shown)})`);
        await evil.close();
    } finally { server.close(); }
}


// 4. A company's brand: a DESIGN.md or a brand.json, from ?brand= or the options
{
    const B = createRequire(import.meta.url)('./awa-brand.js');
    const server = http.createServer((req, res) => {
        const file = path.join(root, decodeURIComponent(new URL(req.url, 'http://x').pathname));
        if (!file.startsWith(root) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); res.end(); return; }
        const type = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.svg': 'image/svg+xml', '.md': 'text/markdown; charset=utf-8' }[path.extname(file)] || 'application/json';
        res.writeHead(200, { 'content-type': type }); fs.createReadStream(file).pipe(res);
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const base = `http://127.0.0.1:${server.address().port}`, view = `${base}/tools/visualization/journey.html`;
    const branded = async (url, setup) => {
        const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
        page.errors = []; page.warnings = []; page.outside = [];
        page.on('pageerror', e => page.errors.push(e.message));
        page.on('console', m => { if (m.type() === 'warning') page.warnings.push(m.text()); });
        await page.route('https://fonts.googleapis.com/**', route => { page.outside.push(route.request().url()); route.fulfill({ contentType: 'text/css', body: '' }); });
        if (setup) await setup(page);
        await page.goto(url); await page.waitForTimeout(1200);
        return page;
    };
    const look = page => page.evaluate(() => {
        const css = getComputedStyle(document.documentElement), v = name => css.getPropertyValue(name).trim();
        const img = document.querySelector('#brandmark img');
        return { accent: v('--accent'), bg: getComputedStyle(document.body).backgroundColor, text: v('--text'), theme: document.documentElement.dataset.theme,
            display: getComputedStyle(document.querySelector('#brandmark .awa-brand-n') || document.body).fontFamily, body: getComputedStyle(document.body).fontFamily,
            radius: getComputedStyle(document.querySelector('.crumb')).borderTopLeftRadius,
            name: (document.querySelector('#brandmark .awa-brand-n') || {}).textContent, powered: (document.querySelector('#brandmark .awa-brand-p') || {}).textContent,
            logo: img ? img.getAttribute('src') : null, logo_loaded: img ? img.complete && img.naturalWidth > 0 : false, inline_svg: !!document.querySelector('#brandmark svg'),
            states: Object.fromEntries(['run', 'wait', 'ok', 'bad', 'undone', 'run-ink', 'wait-ink', 'ok-ink', 'bad-ink', 'bg', 'panel', 'card'].map(k => [k, v('--' + k)])) };
    });
    const TEXT = ['#crumbs .crumb', '#cap', '#when', '#facts b', '#facts span', '#count', '.layer.on .sub', '.layer.on .pt', '.layer.on .hd', '.layer.on .nm', '.layer.on .tg', '.layer.on .lg', '.layer.on .ct span', '.layer.on .rowl', '.layer.on .evl', '.layer.on .evt2', '.layer.on .tr', '.layer.on .bchip', '#gloss .ge-d', '#gloss .ge-t', '#gloss .gloss-g'];
    const readable = async (page, where) => {
        const all = await legibility(page, TEXT), low = all.filter(x => x.ratio < 4.5);
        check(all.length > 20 && !low.length, `${where}: every word reads at 4.5:1 or more (${all.length} checked, the lowest ${Math.min(...all.map(x => x.ratio))}:1) ${low.map(x => `${x.sel} "${x.text}" ${x.ratio}:1`).join('; ')}`);
    };
    // The DESIGN.md of a light brand
    {
        const page = await branded(`${view}?brand=brands/valoria-life.DESIGN.md`);
        const l = await look(page);
        check(l.accent === '#0e7c66' && l.bg === 'rgb(246, 247, 251)' && l.theme === 'light', `a DESIGN.md sets the accent (colors.primary ${l.accent}) and the page (colors.surface ${l.bg}), in light mode`);
        check(l.name === 'Valoria Life' && l.powered === 'powered by AWA' && /valoria-life\.svg$/.test(l.logo) && l.logo_loaded && !l.inline_svg, 'the header shows the logo (an SVG as an image, not inlined), the company\'s name and "powered by AWA"');
        check(/^"?Space Grotesk/.test(l.display) && /^"?Inter/.test(l.body) && l.radius === '8px', `the fonts and the radius follow typography and rounded (${l.display.split(',')[0]}, ${l.body.split(',')[0]}, ${l.radius})`);
        // The colours of states keep their hue and read on the brand's background
        const hue = h => { const c = B.parse_color(h), r = c.r / 255, g = c.g / 255, b = c.b / 255, max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min; if (!d) return 0; const x = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4; return x * 60; };
        const st = l.states, bgs = ['bg', 'panel', 'card'].map(k => B.parse_color(st[k]));
        const kept = Object.entries({ run: '#A855F7', wait: '#FBBF24', ok: '#10B981', bad: '#FF4D4F' }).map(([k, base]) => ({ k, turn: Math.abs(hue(st[k]) - hue(base)), mark: Math.min(...bgs.map(b => B.contrast(B.parse_color(st[k]), b))), word: Math.min(...bgs.map(b => B.contrast(B.parse_color(st[`${k}-ink`]), b))) }));
        check(kept.every(x => x.turn < 3 && x.mark >= 3 && x.word >= 4.5), `the colours of states keep their hue and pass contrast: ${kept.map(x => `${x.k} ${x.mark.toFixed(1)}:1 as a mark, ${x.word.toFixed(1)}:1 as a word`).join(', ')}`);
        await readable(page, 'light brand, journeys');
        await page.evaluate(() => { location.hash = '#story/1/1/0/12'; }); await settle(page);
        await readable(page, 'light brand, one customer\'s journey');
        await page.evaluate(() => { location.hash = '#run/1/1/1/10'; }); await settle(page);
        await readable(page, 'light brand, a run');
        await page.click('#L3 .gw:text("undone afterwards")'); await page.waitForTimeout(300);
        await readable(page, 'light brand, the glossary');
        check(page.outside.every(u => u.startsWith('https://fonts.googleapis.com/css2?family=')) && page.errors.length === 0, `nothing is fetched but the fonts, and no page error ${page.errors.join('; ')}`);
        await page.close();
    }
    // The brand.json of the same brand, through the options
    {
        const page = await branded(`${view}?options=${encodeURIComponent(`${base}/brand-options.json`)}`, page => page.route('**/brand-options.json', route => route.fulfill({ contentType: 'application/json', body: JSON.stringify({ brand: 'tools/visualization/brands/valoria-life.brand.json' }) })));
        const l = await look(page);
        check(l.accent === '#0e7c66' && l.bg === 'rgb(246, 247, 251)' && l.name === 'Valoria Life' && l.logo_loaded, 'a brand.json, named by the options\' "brand", applies the same accent, page, name and logo');
        await page.close();
    }
    // A dark brand, and the default
    {
        const page = await branded(`${view}?brand=brands/valoria-life-dark.DESIGN.md`);
        const l = await look(page);
        check(l.accent === '#2bb596' && l.theme === 'dark' && l.bg === 'rgb(12, 20, 22)', `a dark DESIGN.md gives a dark view (${l.accent} on ${l.bg})`);
        await page.evaluate(() => { location.hash = '#run/1/1/1/10'; }); await settle(page);
        await readable(page, 'dark brand, a run');
        await page.close();
        const plain = await branded(view);
        const p = await look(plain);
        check(p.name === undefined && (await plain.textContent('#brandmark')) === 'AWA' && p.accent === '#818cf8' && p.bg === 'rgb(11, 15, 25)' && plain.outside.length === 0, 'without a brand, the view is AWA\'s own and loads nothing');
        await plain.close();
    }
    // A brand with a colour that is not one, a primary too light for its page, and fonts the page does not have
    {
        const design = ['---', 'name: Test & Co <b>', 'logo: "javascript:alert(1)"', 'colors:', '  primary: "#FFE08A"', '  surface: "#FFFFFF"', '  on-surface: "url(javascript:alert(1))"', '  surface-container: "red; background: url(x)"',
            'typography:', '  headline-lg: { fontFamily: Lora }', '  body-md: { fontFamily: "Source Sans 3" }', '  label-md: { fontFamily: "x\\"; } body { color: red" }', 'rounded:', '  md: "expression(1)"', '  lg: 4px', '---', '# Test'].join('\n');
        const page = await branded(`${view}?brand=${encodeURIComponent(`${base}/test.DESIGN.md`)}`, page => page.route('**/test.DESIGN.md', route => route.fulfill({ contentType: 'text/markdown', body: design })));
        const l = await look(page), warned = page.warnings.join(' | ');
        check(/colors\.on-surface/.test(warned) && /colors\.surface-container/.test(warned) && /rounded\.md/.test(warned) && /logo/.test(warned) && !l.logo && l.text !== 'url(javascript:alert(1))',
            'a colour, a dimension or a logo that is not one is refused, with a warning naming its token');
        const accent = B.parse_color(l.accent);
        check(/colors\.primary/.test(warned) && B.contrast(accent, B.parse_color('#FFFFFF')) >= 3 && l.accent !== '#ffe08a', `a primary too light for its page is darkened to 3:1 (${l.accent}), with a warning naming colors.primary`);
        check(l.name === 'Test & Co <b>' && !(await page.$('#brandmark b')), 'the brand\'s name is text, never markup');
        check(/^"?Source Sans 3/.test(l.body) && page.outside.some(u => /family=Lora/.test(u)) && page.outside.some(u => /family=Source\+Sans\+3/.test(u)), 'fonts the page does not have are asked of Google Fonts, and the body takes the brand\'s');
        await readable(page, 'a brand with a light primary');
        await page.close();
    }
    server.close();
}

await browser.close();
console.log(failures.length ? `\n${failures.length} check(s) failed` : '\nall checks passed');
process.exit(failures.length ? 1 : 0);
