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
const types = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json', '.svg': 'image/svg+xml', '.md': 'text/markdown' };
const hostile = JSON.parse(JSON.stringify(sample));
hostile.journeys[1].definition.name = '<img src=x onerror="window.pwned=1">Claim';
hostile.journeys[1].instances[0].subject_name = '"><script>window.pwned=1</script>';
hostile.journeys[1].definition.stages[0].owner = '<b onmouseover="window.pwned=1">desk</b>';
delete hostile.journeys[1].definition.stages[1].owner;
for (const r of hostile.journeys[1].instances) for (const run of r.runs) for (const e of run.events) if (e.node_name) e.node_name = `<i onclick="window.pwned=1">${e.node_name}</i>`;
const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://x');
    if (url.pathname === '/hostile.json') { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify(hostile)); return; }
    if (url.pathname === '/empty.json') { res.writeHead(200, { 'content-type': 'application/json' }); res.end('{"journeys":[],"workflows":[]}'); return; }
    if (url.pathname === '/not.json') { res.writeHead(200, { 'content-type': 'application/json' }); res.end('{"hello":1}'); return; }
    const file = url.pathname.startsWith('/brands/') ? path.join(here, 'brands', path.basename(url.pathname)) : path.join(here, path.basename(url.pathname));
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
    await page.route('https://fonts.googleapis.com/**', route => route.fulfill({ contentType: 'text/css', body: '' }));   // a brand's fonts, answered here
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
    check((await text(page, '#attention')).includes('Claims intake desk') && (await text(page, '#attention')).includes('Claims adjusters'), 'each stuck customer comes with the owner of the stage');
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
    check((await text(page, '#attention')).includes('No owner named for this stage'), 'a stage without an owner says so');
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

// 5b. An embedding page fixes the period: the page shows what was asked for and offers no other
{
    const page = await open(`${base}/dashboard.html?data=${encodeURIComponent(`${base}/empty.json`)}`);
    const from = new Date(Date.parse(sample.as_of) - 30 * 86400000).toISOString();
    const late = K.compute_measures(sample, { from });
    await page.evaluate(([record, from]) => window.AWA_dashboard_show(record, 'handed over', '', { from }), [sample, from]);
    check((await text(page, '#tiles')).includes(`Journeys started ${late.totals['journey.started'].value}`) && await page.locator('#period').isHidden(), `a period given by the embedding page is kept (${late.totals['journey.started'].value} journeys) and cannot be changed in the page`);
    const runs_shown = (await page.locator('#workflows .item').allInnerTexts()).join(' ');
    check(late.workflows.every(w => runs_shown.includes(w.name)) && await page.locator('#workflows .item').count() === late.workflows.length, 'and the workflows listed are those with runs started in that period');
    await page.close();
}

// 6. Embedded without a journey view beside it: the embedding page says how a journey is opened
{
    const page = await open(`${base}/dashboard.html?data=${encodeURIComponent(`${base}/empty.json`)}`);
    await page.evaluate(record => { window.AWA_EMBEDDED = true; window.AWA_open_journey = (j, i, instance) => { window.asked = `${j}/${i}/${instance.subject_key}`; }; window.AWA_dashboard_show(record, 'in a panel'); }, sample);
    check(await page.locator('#tojourney').isHidden() && await page.locator('#attention a').count() === 0, 'embedded, there is no link to a page that is not there');
    await page.locator('#attention [data-go]').first().click();
    check(/^1\/\d\/cust-/.test(await page.evaluate(() => window.asked)), 'and "Open the journey" asks the embedding page instead');
    await page.close();
}

// 7. A company's brand: a DESIGN.md or a brand.json gives the page its colours, fonts and logo; the colours of states keep their meaning
{
    const B = createRequire(import.meta.url)('./awa-brand.js');
    const look = page => page.evaluate(() => {
        const css = getComputedStyle(document.documentElement), v = n => css.getPropertyValue(n).trim(), img = document.querySelector('#brandmark img');
        return { plane: getComputedStyle(document.body).backgroundColor, done: v('--done'), focus: v('--focus'), ink: v('--ink'), surface: v('--surface'), stuck: v('--stuck'), bad: v('--bad'), good: v('--good'), stuck_ink: v('--stuck-ink'), bad_ink: v('--bad-ink'),
            h1: getComputedStyle(document.querySelector('h1')).fontFamily, name: (document.querySelector('#brandmark .awa-brand-n') || {}).textContent, powered: (document.querySelector('#brandmark .awa-brand-p') || {}).textContent,
            logo: img ? img.complete && img.naturalWidth > 0 && /valoria-life\.svg$/.test(img.src) : false, shown: !document.getElementById('brandmark').hidden, link: document.getElementById('tojourney').getAttribute('href') };
    });
    // Text against what is behind it, for the words of the page
    const low = page => page.evaluate(() => {
        const parse = v => { const m = /\(([^)]+)\)/.exec(v); if (!m) return null; const p = m[1].replace(/^srgb /, '').split(/[\s,/]+/).filter(Boolean).map(Number); const k = /^color\(/.test(v) ? 255 : 1; return { r: p[0] * k, g: p[1] * k, b: p[2] * k, a: p[3] ?? 1 }; };
        const over = (c, bg) => ({ r: c.r * c.a + bg.r * (1 - c.a), g: c.g * c.a + bg.g * (1 - c.a), b: c.b * c.a + bg.b * (1 - c.a), a: 1 });
        const lum = c => { const f = x => { x /= 255; return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b); };
        const behind = el => { const layers = []; for (let e = el; e; e = e.parentElement) { const c = parse(getComputedStyle(e).backgroundColor); if (c && c.a > 0) { layers.push(c); if (c.a >= 1) break; } } let bg = layers.length && layers[layers.length - 1].a >= 1 ? layers.pop() : { r: 255, g: 255, b: 255, a: 1 }; for (const c of layers.reverse()) bg = over(c, bg); return bg; };
        const all = [...document.querySelectorAll('h1, h2, p.sub, .asof, .tile .lab, .tile .val, .tile .ctx, .legend span, .rows .head, .name, .of, .note, .src, .late, .att .own, .awa-brand-n, .awa-brand-p')].filter(e => e.getClientRects().length && e.textContent.trim());
        const out = all.map(el => { const bg = behind(el), fg = over(parse(getComputedStyle(el).color), bg), x = lum(fg), y = lum(bg); return { text: el.textContent.trim().slice(0, 24), ratio: (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05) }; });
        return { n: out.length, low: out.filter(o => o.ratio < 4.5).map(o => `"${o.text}" ${o.ratio.toFixed(2)}:1`) };
    });
    for (const [file, scheme] of [['valoria-life.DESIGN.md', 'dark'], ['valoria-life.brand.json', 'dark']]) {
        const page = await open(`${base}/dashboard.html?brand=brands/${file}`, { width: 1440, height: 900 }, scheme);
        await page.waitForTimeout(500);
        const l = await look(page), text = await low(page);
        check(l.plane === 'rgb(246, 247, 251)' && l.done === '#0e7c66' && l.focus === '#0e7c66' && l.shown && l.name === 'Valoria Life' && l.powered === 'powered by AWA' && l.logo,
            `${file}: the page takes the brand's surface and accent (the bars, the focus), its name and logo with "powered by AWA", in light mode even where the reader prefers dark`);
        check(/^"?Space Grotesk/.test(l.h1), `${file}: headings in the brand's heading font (${l.h1.split(',')[0]})`);
        check(text.n > 20 && !text.low.length, `${file}: light mode reads at 4.5:1 or more (${text.n} words checked) ${text.low.join('; ')}`);
        check(l.link.includes(`brand=${encodeURIComponent(`brands/${file}`)}`), `${file}: the link to the journey view carries the brand`);
        const bg = B.parse_color('#F6F7FB');
        check(B.contrast(B.parse_color(l.stuck), bg) >= 3 && B.contrast(B.parse_color(l.bad), bg) >= 3 && B.contrast(B.parse_color(l.stuck_ink), bg) >= 4.5 && B.contrast(B.parse_color(l.bad_ink), bg) >= 4.5,
            `${file}: stuck and failed keep their colours, adjusted to read on the light page (${l.stuck}, ${l.bad})`);
        check(page.errors.length === 0 && page.outside.every(u => u.startsWith('https://fonts.googleapis.com/')), `${file}: no page error, nothing fetched but the brand's fonts ${page.errors.join('; ')}`);
        await page.close();
    }
    {
        const page = await open(`${base}/dashboard.html`);
        check(await page.locator('#brandmark').isHidden() && (await look(page)).done !== '#0e7c66' && page.outside.length === 0, 'without a brand, the page is as it was and fetches nothing');
        await page.evaluate(() => window.AWA_set_brand('---\nname: X\ncolors:\n  primary: "#0E7C66"\n  surface: "not a colour"\n---\n'));
        const l = await look(page);
        check(l.done === '#0e7c66' && l.plane !== 'not a colour', 'a brand handed over by an embedding page applies, and a colour that is not one is left out');
        await page.close();
    }
}

await browser.close(); server.close();
console.log(failures.length ? `\n${failures.length} check(s) failed` : '\nall checks passed');
process.exit(failures.length ? 1 : 0);
