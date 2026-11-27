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
const { build_story } = require('./journey-story-builder.js');

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
        check(scale >= 0.9, `a band is shown large enough to read (scale ${scale})`);
        await page.click('[data-bandchip="1"]'); await settle(page);
        check((await page.getAttribute('[data-bandchip="1"]', 'class')).includes(' on') && await dimmed(0) && !(await dimmed(1)), 'a band chip focuses its band');
        await to_end(page);
        check((await page.getAttribute('[data-bandchip="2"]', 'class')).includes(' on') && (await page.textContent('[data-bandchip="0"]')).includes('done'), 'at the end of the run, the last band is in focus and the others are done');
        await page.evaluate(i => { location.hash = `#run/0/${i}/1/0`; }, tomas); await settle(page);
        check((await page.textContent('#crumbs')).includes('Grid Export Registration') && await page.locator('[data-bandchip]').count() === 1, 'the child run has its own band');
        await page.evaluate(() => { location.hash = '#atlas/0/0/0/0'; }); await settle(page);
        check(await page.locator('.layer.on').getAttribute('id') === 'L0', 'and a link goes back up to the atlas');
        check(page.errors.length === 0, `no page errors with options ${page.errors.join('; ')}`);
        await page.close();
    } finally { server.close(); }
}

await browser.close();
console.log(failures.length ? `\n${failures.length} check(s) failed` : '\nall checks passed');
process.exit(failures.length ? 1 : 0);
