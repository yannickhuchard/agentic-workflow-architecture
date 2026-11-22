// Walks the journey view as each of the people it is designed for would, using
// only what is on screen: clicks, the transport and the text shown. For each it
// reports whether the question can be answered and in how many actions.
//
// This is a scripted walkthrough of the tasks in docs/ux/journey-visualisation-research.md,
// section 9. It shows that each answer is reachable; it does not show that a
// person would find it. That needs people.
//
//   node examples/claims-journey/persona-walkthrough.mjs      (needs Playwright)

import path from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';
const { chromium } = createRequire(import.meta.url)('playwright');

const page_url = 'file://' + path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../tools/visualization/journey.html');
const browser = await chromium.launch();
const results = [];

async function persona(who, question, walk) {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    const errors = []; page.on('pageerror', e => errors.push(e.message));
    await page.goto(page_url);
    let actions = 0;
    const ui = {
        page,
        click: async selector => { await page.click(selector); actions++; await page.waitForTimeout(700); },
        key: async key => { await page.keyboard.press(key); actions++; await page.waitForTimeout(120); },
        caption: () => page.textContent('#cap'),
        facts: () => page.textContent('#facts'),
        text: selector => page.locator(selector).allTextContents(),
        cell: (person, journey) => `.pcell[aria-label="Follow ${person} through ${journey}"]`,
        /** Read the whole story from the first beat, as someone pressing "next" would */
        read_all: async () => { await ui.click('#b-start'); const lines = [await ui.caption()]; const n = +(await page.getAttribute('#scrub', 'max')); for (let i = 0; i < n; i++) { await ui.key('ArrowRight'); lines.push(await ui.caption()); } return lines; },
    };
    let answer, ok = false;
    try { ({ answer, ok } = await walk(ui)); } catch (error) { answer = `could not finish: ${error.message.split('\n')[0]}`; }
    if (errors.length) { ok = false; answer += ` [page errors: ${errors.join('; ')}]`; }
    results.push({ who, question, ok, actions, answer });
    await page.close();
}

await persona('Operations lead', 'Which customers need someone to act today, and why?', async ui => {
    const stalled = [];
    for (const label of await ui.page.locator('.pcell').evaluateAll(cells => cells.filter(c => c.textContent.includes('Stalled')).map(c => c.getAttribute('aria-label')))) {
        await ui.click(`.pcell[aria-label="${label}"]`);
        stalled.push(`${label.replace('Follow ', '').replace(' through ', ' in ')}: ${await ui.caption()}`);
        await ui.click('[data-level="atlas"]');
    }
    return { ok: stalled.length === 2 && stalled.every(s => /stalled/i.test(s)), answer: stalled.join(' | ') };
});

await persona('Case handler', 'Tell me what happened to A. Okafor with the claim, in order.', async ui => {
    await ui.click(ui.cell('A. Okafor', 'Motor Claim'));
    const story = await ui.read_all();
    const at = text => story.findIndex(line => line.includes(text));
    const order = [at('reports a claim'), at('uploads 3 documents'), at('waits for a person'), at('has been settled'), at('2 out of 5'), at('Call back')];
    return { ok: order.every((v, i) => v >= 0 && (i === 0 || v > order[i - 1])), answer: `${story.length} sentences; the wait for the adjuster is sentence ${order[2] + 1}, the rating of 2 is sentence ${order[4] + 1}` };
});

await persona('Workflow designer', 'Why did A. Okafor\'s claim go to an adjuster?', async ui => {
    await ui.click(ui.cell('A. Okafor', 'Motor Claim'));
    await ui.click('.g[aria-label="Model decides: Settlement route"]');
    await ui.click('.rbl[data-run="1"]');
    const evidence = (await ui.text('#evidence .ev')).join(' | ');
    return { ok: /Model.s reason/.test(evidence) && /adjuster should confirm/.test(evidence), answer: evidence.match(/Model.s reason(.*?)\|/)?.[1]?.trim() || evidence.slice(0, 160) };
});

await persona('Auditor', 'Was R. Haddad\'s money left reserved when the payment failed?', async ui => {
    await ui.click(ui.cell('R. Haddad', 'Motor Claim'));
    await ui.click('.g[aria-label="Release funds"]');
    const sentence = await ui.caption();
    await ui.click('.rbl[data-run="1"]');
    const record = (await ui.text('#evidence .ev')).find(line => line.includes('Journal record'));
    return { ok: /undoes .Reserve funds./.test(sentence) && !!record, answer: `${sentence} (${record.replace('Journal record', 'journal record: ')})` };
});

await persona('Journey owner', 'Which stage of the claim journey loses the most customers?', async ui => {
    await ui.click('[data-open-j="1"]');
    await ui.page.evaluate(() => { const s = document.getElementById('scrub'); s.value = s.max; s.dispatchEvent(new Event('input')); });
    const cards = await ui.page.locator('.card').evaluateAll(cards => cards.map(card => ({ stage: card.querySelector('.hd').textContent, lost: [...card.querySelectorAll('.ct')].filter(c => /stalled|left/.test(c.textContent)).reduce((n, c) => n + +c.querySelector('b').textContent, 0) })));
    const worst = cards.sort((a, b) => b.lost - a.lost)[0];
    await ui.click('[data-lane="2"]');
    return { ok: worst.stage === 'Reported' && worst.lost === 2, answer: `“${worst.stage}”: ${worst.lost} of 6 stalled or left there. Example opened: ${await ui.caption()}` };
});

await persona('Journey owner', 'Did the poor claim experience cost us A. Okafor as a customer?', async ui => {
    await ui.click(ui.cell('A. Okafor', 'Motor Claim'));
    const claim = await ui.page.textContent('#moodchip');
    await ui.click('#switch [data-j="2"]');
    await ui.page.evaluate(() => { const s = document.getElementById('scrub'); s.value = s.max; s.dispatchEvent(new Event('input')); });
    const renewal = await ui.page.textContent('#moodchip'), ending = await ui.caption();
    return { ok: /unhappy/.test(claim) && /lapsed/.test(ending), answer: `Claim ended with ${claim.replace('Mood', 'mood ')}; one step sideways to the renewal: ${ending} (${renewal.replace('Mood', 'mood ')})` };
});

await browser.close();
for (const r of results) console.log(`${r.ok ? 'REACHED ' : 'NOT REACHED'}  ${r.who}: ${r.question}\n   in ${r.actions} actions -> ${r.answer}\n`);
process.exit(results.every(r => r.ok) ? 0 : 1);
