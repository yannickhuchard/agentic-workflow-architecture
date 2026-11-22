// Checks the measures page in a real browser: its numbers against the measures
// computed outside the page, every number opening what it counts, the way to the
// journey view, a record given by URL, narrow screens, and hostile text in a record.
//
//   node tools/visualization/dashboard.check.mjs        (needs Playwright)

import fs from 'fs';
import http from 'http';
import path from 'path';
import vm from 'vm';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';
const { chromium } = createRequire(import.meta.url)('playwright');

const here = path.dirname(fileURLToPath(import.meta.url)), root = path.resolve(here, '../..');
const failures = [];
const check = (ok, what) => { console.log(`${ok ? 'ok  ' : 'FAIL'}  ${what}`); if (!ok) failures.push(what); };

// The same code the page runs, run here on the same sample
const sandbox = { window: {} }; vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(path.join(here, 'awa-kpis.js'), 'utf-8') + '\nwindow.K = AWA_MEASURES;', sandbox);
vm.runInContext(fs.readFileSync(path.join(here, 'dashboard-sample.js'), 'utf-8'), sandbox);
const K = sandbox.window.K, sample = sandbox.window.AWA_PORTFOLIO;
const report = K.compute_measures(sample);

// The page is served, as it would be, with everything else refused: it must need nothing from the network
const types = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json' };
const hostile = JSON.parse(JSON.stringify(sample));
hostile.journeys[1].definition.name = '<img src=x onerror="window.pwned=1">Claim';
hostile.journeys[1].instances[0].subject_name = '"><script>window.pwned=1</script>';
hostile.journeys[1].definition.stages[0].owner = '<b onmouseover="window.pwned=1">desk</b>';
for (const r of hostile.journeys[1].instances) for (const run of r.runs) for (const e of run.events) if (e.node_name) e.node_name = `<i onclick="window.pwned=1">${e.node_name}</i>`;
const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://x');
    if (url.pathname === '/hostile.json') { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify(hostile)); return; }
    if (url.pathname === '/empty.json') { res.writeHead(200, { 'content-type': 'application/json' }); res.end('{"journeys":[],"workflows":[]}'); return; }
    if (url.pathname === '/not.json') { res.writeHead(200, { 'content-type': 'application/json' }); res.end('{"hello":1}'); return; }
    const file = path.join(here, path.basename(url.pathname));
    if (!fs.existsSync(file)) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { 'content-type': types[path.extname(file)] || 'text/plain' }); res.end(fs.readFileSync(file));
}).listen(0, '127.0.0.1');
await new Promise(resolve => server.once('listening', resolve));
const base = `http://127.0.0.1:${server.address().port}`;

const browser = await chromium.launch();
const open = async (url, viewport = { width: 1440, height: 900 }, scheme = 'dark') => {
    const page = await browser.newPage({ viewport, colorScheme: scheme });
    page.errors = []; page.outside = [];
    page.on('pageerror', e => page.errors.push(e.message));
    page.on('console', m => { if (m.type() === 'error') page.errors.push(m.text()); });
    page.on('request', r => { if (!r.url().startsWith(base) && !r.url().startsWith('data:')) page.outside.push(r.url()); });
    await page.goto(url); await page.waitForSelector('#main:not([hidden]), #msg:not([hidden])');
    return page;
};
const text = async (page, selector) => (await page.innerText(selector)).replace(/\s+/g, ' ').trim();

// 1. The sample: what the page says is what the measures are
{
    const page = await open(`${base}/dashboard.html`);
    const t = report.totals;
    const tiles = await text(page, '#tiles');
    check(tiles.includes(`Journeys started ${t['journey.started'].value}`), `the page counts ${t['journey.started'].value} journeys started`);
    check(tiles.includes(`${Math.round(t['journey.goal_attainment'].value * 100)}%`) && tiles.includes(`${Math.round(t['journey.goal_attainment'].value * t['journey.goal_attainment'].n)} of ${t['journey.goal_attainment'].n} journeys`), 'the share that reached the goal comes with its count');
    check(await page.locator('#attention .row').count() === report.attention.length && report.attention.length === 2, 'everyone who is stuck is listed');
    check((await text(page, '#attention')).includes('No owner named for this stage'), 'a stage without an owner says so');
    check(await page.locator('#journeys .item').count() === report.journeys.length && await page.locator('#workflows .item').count() === report.workflows.length, 'one row per journey and per workflow');
    const claim = report.journeys.find(j => j.name === 'Motor Claim');
    const row = page.locator('#journeys .item', { hasText: 'Motor Claim' });
    const goal = claim.measures['journey.goal_attainment'];
    check((await row.textContent()).includes(`${Math.round(goal.value * goal.n)} of ${goal.n}`), 'a rate over few leads with the count');
    check(await row.locator('.seg button').count() === 3, 'the outcome bar of the claim journey has three parts: reached the end, left, stuck');
    check(await row.locator('.mood .d.said').count() === 1 && await row.locator('.mood .d:not(.said)').count() >= 2, 'mood said by the customer is drawn solid, inferred mood dashed');
    check((await text(page, '#journeys')).includes('all inferred by rule, none said'), 'a mood that was never measured says so');

    // A number opens what it counts
    await row.locator('.seg button.c-stuck').click();
    check((await text(page, '#ev-title')).startsWith('Stuck now · Motor Claim (2)') && await page.locator('#ev-list li').count() === 2, 'the stuck part of the bar opens the two customers who are stuck');
    check((await text(page, '#ev-rule')).length > 20, 'with the rule of the measure');
    const href = await page.locator('#ev-list li a').first().getAttribute('href');
    await page.keyboard.press('Escape');
    check(await page.locator('#ev').isHidden(), 'Escape closes the panel');

    // A journey opens into its stages, a workflow into its steps
    await row.locator('[data-open]').click();
    const stages = await text(page, '#journeys .detail');
    check(claim.stages.every(s => stages.includes(s.name)) && stages.includes('Outlasted its time') && stages.includes('7.0 days allowed'), 'a journey opens into its stages, with the time each is allowed');
    await page.locator('#workflows .item', { hasText: 'Motor Claim Settlement' }).locator('[data-open]').click();
    const steps = await text(page, '#workflows .detail');
    check(steps.includes('Pay claimant') && steps.includes('CONTRACT_VIOLATION') && steps.includes('3 by rule, 1 by a model'), 'a workflow opens into its steps, errors and who decided');
    check(steps.indexOf('Pay claimant') < steps.indexOf('Register claim'), 'the steps that fail come first');
    await page.locator('#workflows .item', { hasText: 'Motor Claim Settlement' }).locator('[data-ev$="|rough"]').click();
    check((await text(page, '#ev-title')).includes('Not right first time') && await page.locator('#ev-list li').count() === 2, '"right first time" opens the runs that were not');
    await page.keyboard.press('Escape');

    // Narrowing the page narrows every number
    await page.selectOption('#journey', { label: 'Policy Renewal' });
    check((await text(page, '#tiles')).includes('Journeys started 6') && await page.locator('#journeys .item').count() === 1 && await page.locator('#attention .row').count() === 0 && (await text(page, '#attention')).includes('Nobody is stuck'), 'choosing a journey narrows every number, and an empty list says nobody is stuck');
    await page.selectOption('#journey', ''); await page.selectOption('#period', '30');
    const late = K.compute_measures(sample, { from: new Date(Date.parse(sample.as_of) - 30 * 86400000).toISOString() });
    check((await text(page, '#tiles')).includes(`Journeys started ${late.totals['journey.started'].value}`), `the period narrows them too (${late.totals['journey.started'].value} started in the last 30 days)`);
    check(await page.locator('#charts svg').count() >= 1 || (await text(page, '#charts')).includes('within one'), 'counts over time are drawn');
    check(page.errors.length === 0, `no page errors on the sample ${page.errors.join(' | ')}`);
    check(page.outside.length === 0, `the page asks nothing of the network ${page.outside.join(' ')}`);

    // From a number to the customer's story
    await page.goto(`${base}/${href}`); await page.waitForTimeout(900);
    const crumbs = await text(page, '#crumbs');
    check(/L\. Petit|R\. Haddad/.test(crumbs) && crumbs.includes('Motor Claim'), `"Open the journey" lands on that customer in the journey view (${crumbs.slice(0, 60)})`);
    await page.close();
}

// 2. A record given by URL, with markup in its names
{
    const page = await open(`${base}/dashboard.html?data=${encodeURIComponent(`${base}/hostile.json`)}`);
    for (const toggle of await page.locator('[data-open]').all()) await toggle.click().catch(() => { });
    for (let i = 0; i < await page.locator('[data-open]').count(); i++) { const t = page.locator('[data-open]').nth(i); if (await t.getAttribute('aria-expanded') === 'false') await t.click(); }
    await page.locator('#journeys .n').first().click();
    await page.locator('#ev-list').hover().catch(() => { });
    check(await page.evaluate(() => !window.pwned && !document.querySelector('#main img, #main script, #main i[onclick], #main b[onmouseover], #ev script')), 'markup in a record is shown as text and never run');
    check((await text(page, '#journeys')).includes('<img src=x'), 'the hostile name is displayed literally');
    const link = await page.locator('#attention a').first().getAttribute('href');
    check(link.includes('?data=') && link.includes('#story/'), 'links to the journey view carry the same record');
    check(page.errors.length === 0, `no page errors on a hostile record ${page.errors.join(' | ')}`);
    await page.close();
}

// 3. Records with nothing in them, and files that are not records
{
    let page = await open(`${base}/dashboard.html?data=${encodeURIComponent(`${base}/empty.json`)}`);
    check((await text(page, '#journeys')).includes('No journey in this record') && (await text(page, '#workflows')).includes('No run'), 'an empty record is shown as empty, with no number invented');
    check(page.errors.length === 0, 'no page errors on an empty record');
    await page.close();
    page = await open(`${base}/dashboard.html?data=${encodeURIComponent(`${base}/not.json`)}`);
    check((await text(page, '#msg')).includes('not a record of journeys'), 'a file that is not a record is refused in words');
    await page.close();
}

// 4. A phone, in light
{
    const page = await open(`${base}/dashboard.html`, { width: 390, height: 800 }, 'light');
    await page.locator('#journeys [data-open]').nth(1).click();
    check(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), 'at 390 px nothing scrolls sideways');
    check((await page.evaluate(() => getComputedStyle(document.body).backgroundColor)) !== 'rgb(13, 13, 13)', 'the light theme is its own');
    check(page.errors.length === 0, 'no page errors on a phone');
    await page.close();
}

// 5. Embedded: a host page hands the record over
{
    const page = await open(`${base}/dashboard.html?data=${encodeURIComponent(`${base}/empty.json`)}`);
    await page.evaluate(record => window.AWA_dashboard_show(record, 'handed over'), sample);
    check((await text(page, '#source')) === 'handed over' && (await text(page, '#tiles')).includes('Journeys started 18'), 'AWA_dashboard_show shows a record handed over by an embedding page');
    await page.close();
}

await browser.close(); server.close();
console.log(failures.length ? `\n${failures.length} check(s) failed` : '\nall checks passed');
process.exit(failures.length ? 1 : 0);
