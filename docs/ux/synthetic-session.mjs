// Lets a synthetic participant (an AI agent playing a persona) use the journey
// view the way a person would: look at the screen, then act on something they
// can see. One action per call; the place is kept between calls.
//
//   node docs/ux/synthetic-session.mjs <session-dir> look
//   node docs/ux/synthetic-session.mjs <session-dir> click <number from the last look>
//   node docs/ux/synthetic-session.mjs <session-dir> key <ArrowRight|ArrowLeft|Escape>
//   node docs/ux/synthetic-session.mjs <session-dir> scrub <position>
//
// Every call writes screen.png in the session directory and prints what can be
// acted on. The log of actions is kept in actions.jsonl. Needs Playwright.

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';
const { chromium } = createRequire(import.meta.url)('playwright');

const [dir, action = 'look', arg] = process.argv.slice(2);
if (!dir) { console.error('usage: synthetic-session.mjs <session-dir> look|click N|key K|scrub N'); process.exit(1); }
fs.mkdirSync(dir, { recursive: true });
const state_file = path.join(dir, 'place.txt'), log_file = path.join(dir, 'actions.jsonl');
const view = 'file://' + path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../tools/visualization/journey.html');
const hash = fs.existsSync(state_file) ? fs.readFileSync(state_file, 'utf-8').trim() : '';

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
await page.goto(view + hash);
await page.waitForTimeout(1200);

// What a person could act on: visible buttons in the top bar, the layer in view and the transport
const targets = () => page.evaluate(() => {
    const seen = [];
    const visible = el => { const r = el.getBoundingClientRect(), s = getComputedStyle(el); return r.width > 4 && r.height > 4 && s.visibility !== 'hidden' && s.pointerEvents !== 'none' && +s.opacity > 0.3; };
    const scopes = [document.getElementById('top'), document.querySelector('.layer.on'), document.getElementById('bar')];
    for (const scope of scopes) for (const el of scope.querySelectorAll('button:not(:disabled)')) {
        if (!visible(el)) continue;
        const r = el.getBoundingClientRect();
        el.dataset.target = String(seen.length);
        seen.push({ n: seen.length, text: (el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 70), hint: el.title || '', x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) });
    }
    return seen;
});

let list = await targets(), note = '';
if (action === 'click') {
    const t = list.find(x => x.n === Number(arg));
    if (!t) note = `There is nothing numbered ${arg}.`;
    else { await page.locator(`[data-target="${t.n}"]`).click({ force: true }); note = `Clicked ${t.n}.`; }
} else if (action === 'key') { await page.keyboard.press(arg); note = `Pressed ${arg}.`; }
else if (action === 'scrub') { await page.evaluate(v => { const s = document.getElementById('scrub'); s.value = v; s.dispatchEvent(new Event('input')); }, arg); note = `Moved the slider to ${arg}.`; }
await page.waitForTimeout(1500);
list = await targets();

fs.writeFileSync(state_file, await page.evaluate(() => location.hash));
fs.appendFileSync(log_file, JSON.stringify({ at: new Date().toISOString(), action, arg, place: await page.evaluate(() => location.hash) }) + '\n');
await page.screenshot({ path: path.join(dir, 'screen.png') });
const slider = await page.evaluate(() => { const s = document.getElementById('scrub'); return `${s.value} of ${s.max}`; });
console.log(`${note}\nScreen saved: ${path.join(dir, 'screen.png')}  (look at it)\nSlider at position ${slider}.\n\nThings you can click (the number is on no screen: find the thing in the picture by its position x,y):`);
for (const t of list) console.log(`  ${String(t.n).padStart(2)}  at ${String(t.x).padStart(4)},${String(t.y).padStart(3)}  ${t.text ? `"${t.text}"` : '(no text)'}${t.hint ? `  [tooltip: ${t.hint}]` : ''}`);
await browser.close();
