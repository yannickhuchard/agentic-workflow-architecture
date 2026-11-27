#!/usr/bin/env node
// Records a demonstration video of a live AWA execution in one 1920 x 1080 frame (tools/video/studio.html):
// the real journey view and measures page on the stage, the record as it is written, the measures, and a caption.
// The stage can also show a document: the pages of a PDF, turning, or an HTML page such as the dossier the journey
// view has just made.
//
//   node tools/video/record.mjs --demo "node examples/electricity-onboarding/demo/live.mjs --port 4610 --then all --then-speed 8 --then-pause 14" \
//        --api http://localhost:4610 --script examples/electricity-onboarding/demo/video.json --out onboarding.mp4
//
// The demo command must start an AWA host whose HTTP interface answers at --api, and write one JSON line per step on
// its standard output: {"t", "kind", "actor"?, "text", "event"?, "run_id"?, "instance_id"?, "child_run_id"?, "stage"?}.
// The script (--script) is the plan of the video: its cards, chapters, captions and scenes. A scene waits for a line
// of the demo, or for some seconds after the scene before it, then moves the stage through the views' own links
// (the journey view's place, #level/journey/instance/run/position) and real clicks inside the page.
// See tools/video/README.md for the script's format.
//
// The pages of a PDF the script names are drawn as images with pdftoppm (poppler) before the recording starts.
//
// Frames come from the Chrome DevTools screencast at the rhythm the page paints, are written as JPEG with their
// timestamps, and ffmpeg turns them into an H.264 video at a constant 30 frames per second. Needs Playwright
// (pre-installed) and ffmpeg.

import { spawn, spawnSync } from 'child_process';
import fs from 'fs';
import http from 'http';
import os from 'os';
import path from 'path';
import { createRequire } from 'module';
import { fileURLToPath } from 'url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../..');
const require = createRequire(import.meta.url);
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

function args() {
    const out = { tail: 2, width: 1920, height: 1080, fps: 30 };
    const argv = process.argv.slice(2);
    for (let i = 0; i < argv.length; i++) {
        const key = argv[i].replace(/^--/, '');
        if (argv[i + 1] === undefined || argv[i + 1].startsWith('--')) { out[key] = true; continue; }
        out[key] = argv[++i];
    }
    for (const key of ['tail', 'width', 'height', 'fps', 'intro', 'dpi']) if (out[key] !== undefined) out[key] = Number(out[key]);
    if (!out.demo || !out.api || !out.out || !out.script) {
        console.error('Usage: node tools/video/record.mjs --demo "<command>" --api <url> --script <video.json> --out <file.mp4> [--intro <seconds>] [--tail <seconds>] [--dpi <n>] [--keep-frames]');
        process.exit(2);
    }
    return out;
}

/** The repository's files over HTTP, so that the studio and the views load from one origin; /_pages/ serves the drawn PDF pages */
function serve_repository(pages_dir) {
    const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json', '.css': 'text/css', '.jsonl': 'text/plain', '.svg': 'image/svg+xml', '.png': 'image/png', '.pdf': 'application/pdf' };
    const server = http.createServer((req, res) => {
        const asked = decodeURIComponent(new URL(req.url, 'http://x').pathname);
        const base = asked.startsWith('/_pages/') ? pages_dir : root;
        const file = path.join(base, asked.startsWith('/_pages/') ? asked.slice('/_pages'.length) : asked);
        if (!file.startsWith(base) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); res.end(); return; }
        res.writeHead(200, { 'Content-Type': types[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
        fs.createReadStream(file).pipe(res);
    });
    return new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve({ server, base: `http://127.0.0.1:${server.address().port}` })));
}

/** Every PDF the script names (a scene's or a step's `document.pdf`), drawn as one PNG per page: { pdf: { pages: [urls], count } } */
function draw_documents(script, pages_dir, dpi) {
    const named = new Set();
    for (const scene of script.scenes || []) for (const x of [scene, ...(scene.steps || [])]) if (x.document?.pdf) named.add(x.document.pdf);
    const drawn = {};
    for (const pdf of named) {
        const slug = pdf.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').toLowerCase();
        const dir = path.join(pages_dir, slug);
        fs.mkdirSync(dir, { recursive: true });
        const run = spawnSync('pdftoppm', ['-q', '-r', String(dpi), '-png', path.resolve(root, pdf), path.join(dir, 'p')], { stdio: ['ignore', 'ignore', 'inherit'] });
        if (run.status !== 0) throw new Error(`pdftoppm could not draw ${pdf}`);
        // pdftoppm numbers pages p-1.png or p-01.png, by the number of pages
        const files = fs.readdirSync(dir).filter(f => /^p-\d+\.png$/.test(f)).sort((a, b) => Number(a.match(/\d+/)[0]) - Number(b.match(/\d+/)[0]));
        drawn[pdf] = { pages: files.map(f => `/_pages/${slug}/${f}`), count: files.length };
    }
    return drawn;
}

async function wait_for(url, ms = 60000) {
    const end = Date.now() + ms;
    while (Date.now() < end) {
        try { if ((await fetch(url)).ok) return; } catch { /* not up yet */ }
        await sleep(250);
    }
    throw new Error(`${url} did not answer within ${ms} ms`);
}

async function main() {
    const o = args();
    const script = JSON.parse(fs.readFileSync(path.resolve(o.script), 'utf-8'));
    const api = o.api.replace(/\/$/, '');
    const frames = path.resolve(o.out + '.frames');
    fs.rmSync(frames, { recursive: true, force: true });
    fs.mkdirSync(frames, { recursive: true });
    const pages_dir = fs.mkdtempSync(path.join(os.tmpdir(), 'awa-video-pages-'));
    const documents = draw_documents(script, pages_dir, o.dpi || 150);
    const { server, base } = await serve_repository(pages_dir);

    const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
    const browser = await chromium.launch();
    // The measures page follows the reader's colour scheme: the studio is dark, and so is it
    const context = await browser.newContext({ viewport: { width: o.width, height: o.height }, deviceScaleFactor: 1, colorScheme: 'dark' });
    const page = await context.newPage();
    page.on('pageerror', error => console.error(`page error: ${error.message}`));
    await page.goto(`${base}/tools/video/studio.html`);
    const options = script.options ? JSON.parse(fs.readFileSync(path.resolve(root, script.options), 'utf-8')) : {};
    await page.evaluate(s => window.studio.init(s), { title: script.title, chapters: script.chapters, subjects: script.subjects, options });
    const options_query = script.options ? `&options=${encodeURIComponent(`${base}/${script.options}`)}` : '';
    const views = {
        journey: `../visualization/journey.html?live=${encodeURIComponent(api)}&poll=1000${options_query}`,
        measures: `../visualization/dashboard.html?live=${encodeURIComponent(api)}${options_query}`,
    };

    // Every frame the page paints, with its time
    const cdp = await context.newCDPSession(page);
    const shots = [];
    cdp.on('Page.screencastFrame', async frame => {
        const file = path.join(frames, `${String(shots.length).padStart(6, '0')}.jpg`);
        fs.writeFileSync(file, Buffer.from(frame.data, 'base64'));
        shots.push({ file, at: frame.metadata.timestamp });
        try { await cdp.send('Page.screencastFrameAck', { sessionId: frame.sessionId }); } catch { /* closing */ }
    });
    await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 92, maxWidth: o.width, maxHeight: o.height, everyNthFrame: 1 });
    // A frame now and then, so that a still page still yields frames
    const nudge = setInterval(() => page.evaluate(() => document.body.style.setProperty('--tick', String(Date.now()))).catch(() => { }), 200);
    const began = Date.now();
    const at = () => ((Date.now() - began) / 1000).toFixed(1);

    // The title card while the demonstration starts
    await page.evaluate(card => window.studio.card(card), script.intro || { title: script.title });
    // Its own process group, so that stopping it stops the demonstration and not only the shell around it
    const demo = spawn(o.demo, { shell: true, cwd: root, stdio: ['ignore', 'pipe', 'inherit'], detached: true });
    const history = [];
    // Each line knows whether it came after the demonstration's phase line, whatever the reader is doing when a scene looks back
    let buffer = '', exited = false, after_phase = false;
    demo.stdout.setEncoding('utf-8');
    demo.stdout.on('data', chunk => {
        buffer += chunk;
        let nl;
        while ((nl = buffer.indexOf('\n')) >= 0) {
            const raw = buffer.slice(0, nl).trim();
            buffer = buffer.slice(nl + 1);
            if (!raw.startsWith('{')) continue;
            let line;
            try { line = JSON.parse(raw); } catch { continue; /* not a step */ }
            if (line.kind === 'phase') after_phase = true;
            history.push(Object.assign(line, { after_phase }));
        }
    });
    demo.on('exit', () => { exited = true; });
    await wait_for(`${api}/api/v1/journeys/portfolio`);
    await page.evaluate(api => window.studio.follow(api), api);

    // ---------------------------------------------------------------- what the lines say
    const state = { main: null, main_run: null, phase: false, step: 0, focus: 'main' };
    const studio = (fn, ...a) => page.evaluate(([fn, a]) => window.studio[fn](...a), [fn, a]);
    const caption = text => { state.step++; return studio('caption', String(state.step), text); };
    const kept_in_phase = new Set(script.phase_record || ['customer', 'person', 'refused', 'guardrail', 'journey']);
    const matches = (on, line) => {
        if (on === 'start') return false;
        if (typeof on === 'string') return line.kind === on;
        return Object.entries(on).every(([key, want]) => key === 'customer' ? (want === 'main' ? line.instance_id === state.main && !line.after_phase : true)
            : line[key] !== undefined && new RegExp(want).test(String(line[key])));
    };
    let read = 0, taking = null;
    const fired = new Set();
    // Reads the lines not read yet, once at a time
    const take = () => (taking ||= read_lines().finally(() => { taking = null; }));
    const read_lines = async () => {
        for (; read < history.length; read++) {
            const line = history[read];
            if (line.kind === 'ready' || line.kind === 'done') continue;
            if (line.kind === 'phase') { state.phase = true; continue; }
            if (!state.main && line.instance_id && line.main !== false) { state.main = line.instance_id; await studio('focus', state.main); }
            if (!state.main_run && line.event === 'run.started' && line.instance_id === state.main) state.main_run = line.run_id;
            if (!state.phase || kept_in_phase.has(line.actor)) await studio('record', { actor: line.actor || (line.kind === 'action' ? 'customer' : 'system'), text: line.text });
            if (state.focus === 'lines' && line.instance_id) await studio('focus', line.instance_id);
            const main = line.instance_id === state.main && !line.after_phase;
            if (main && line.event === 'journey.stage_entered' && line.stage) await studio('chapter', script.stage_chapters?.[line.stage] || line.stage);
            // A moment the script names: its caption and chapter, once
            const moment = (script.moments || []).find((m, k) => !fired.has(k) && matches(m.on, line));
            if (moment) fired.add(script.moments.indexOf(moment));
            if (moment?.chapter) await studio('chapter', moment.chapter);
            if (moment?.caption) await caption(moment.caption);
            else if (main && line.kind === 'action' && script.caption_actions !== false && !(script.caption_skip || []).some(on => matches(on, line))) await caption(line.text);
        }
    };

    // ---------------------------------------------------------------- moving the stage
    let shown = null;
    const FRAME = { journey: '#journey', measures: '#measures-page', html: '#doc-html' };
    const show = async (which, what) => {
        if (which === 'html') {
            // A page of the repository, or "made": the dossier the journey view made last (its export dialog); `offset`
            // shows it from that many pixels down, from its first frame
            const { page: from, offset = 0 } = typeof what === 'string' ? { page: what } : what;
            const srcdoc = from === 'made' ? await page.evaluate(() => document.getElementById('journey').contentWindow.AWA_last_dossier || '') : null;
            if (from === 'made' && !srcdoc) console.error('the journey view has made no dossier yet');
            await studio('html', { ...(srcdoc ? { srcdoc } : { src: `../../${from}` }), offset });
            await page.frameLocator('#doc-html').locator('body').waitFor({ timeout: 20000 }).catch(() => { });
            shown = which;
            return;
        }
        await studio('show', which, views[which]);
        if (shown === which) return;
        shown = which;
        if (!views[which]) return;
        // The page is ready once it shows a record
        const frame = page.frameLocator(FRAME[which]);
        await frame.locator(which === 'journey' ? '.layer.on, #none:not([hidden])' : '#main:not([hidden]), #msg:not([hidden])').first().waitFor({ timeout: 20000 }).catch(() => { });
    };
    /** A document on the stage: the pages of a PDF the recorder drew, at a spread; `turn` animates the page */
    const book = async doc => {
        const drawn = documents[doc.pdf];
        await studio('book', { pages: drawn.pages, count: drawn.count, title: doc.title || doc.pdf });
        if (shown !== 'document') { await studio('show', 'document'); shown = 'document'; }
        // Every page is loaded before it is shown
        await page.waitForFunction(() => window.studio.pages_ready(), null, { timeout: 30000 }).catch(() => console.error(`the pages of ${doc.pdf} did not load`));
    };
    /** Where a place points to: {j} {i} for the scene's customer, {run} for its main run, {lrun} for the run of the line,
     *  {child} for the child run named by the line, and for the step: {step:<kind>} the first step of that kind in the
     *  run (a guardrail, a refusal), {step:<kind>:<n>} the n-th, {step~<text>} the first whose caption has the text */
    const resolve = async (place, line) => {
        const STEP = /\{step(?::(\w+)(?::(\d+))?|~([^}]+))\}/;
        if (!/\{(j|i|run|lrun|child)\}/.test(place) && !STEP.test(place)) return place;
        const instance = (line && line.instance_id) || state.main;
        const run_id = place.includes('{child}') ? line?.child_run_id : place.includes('{lrun}') ? line?.run_id
            : place.includes('{run}') ? (instance === state.main ? state.main_run : line?.run_id) : undefined;
        const [token, kind, nth, text] = STEP.exec(place) || [];
        for (let tries = 0; tries < 100; tries++) {
            const where = await studio('place_of', instance, run_id || null);
            const step = token && where ? await studio('step_of', instance, run_id || null, { kind: kind || null, n: Number(nth) || 1, text: text || null }) : 0;
            if (where && step >= 0) return place.replace('{j}', where.j).replace('{i}', where.i).replace(/\{(run|lrun|child)\}/, where.r).replace(token || '\u0000', step);
            await sleep(100);
        }
        throw new Error(`the record does not hold ${instance} ${run_id || ''} for ${place}`);
    };
    /** Follows a link of the journey view, and checks the view went there; the view may not hold the record yet */
    const go = async hash => {
        const [level, j, i, r] = hash.split('/'), asked = at();
        for (let tries = 0; tries < 80; tries++) {
            const there = await page.evaluate(([hash, level, j, i, r, first]) => {
                const w = document.getElementById('journey').contentWindow, v = w.AWA_VIEW;
                if (!first && v && v.level === level && (level === 'atlas' || (v.j === +j && (level === 'journey' || (v.i === +i && (level !== 'run' || v.r === +r)))))) return true;
                w.location.hash = '#' + hash;
                return false;
            }, [hash, level, j, i, r, tries === 0]);
            if (there) { console.log(`${asked} s  the journey view goes to #${hash}${tries > 1 ? `, there at ${at()} s` : ''}`); return; }
            // The view moves on its hashchange; looked at again soon, so that a caption follows the move closely
            await sleep(200);
        }
        console.error(`the journey view did not go to ${hash}`);
    };
    const in_page = () => page.frameLocator(FRAME[shown] || '#journey');
    /** What a scene and each of its steps may do, in this order */
    const act = async (x, line) => {
        if (x.wait) await sleep(x.wait * 1000);
        if (x.document) await book(x.document);
        if (x.spread) await studio('spread', x.spread);
        if (x.zoom !== undefined) await studio('zoom', x.zoom);
        if (x.html) await show('html', x.html);
        if ((x.scroll || x.scroll_by) && shown === 'html') await studio('html_settle');
        if (x.scroll) await in_page().locator(x.scroll).first().evaluate(el => el.scrollIntoView({ behavior: 'smooth', block: 'start' })).catch(error => console.error(`scroll ${x.scroll}: ${error.message}`));
        if (x.scroll_by) await in_page().locator('html').evaluate((el, by) => el.ownerDocument.defaultView.scrollBy({ top: by, behavior: 'smooth' }), x.scroll_by).catch(error => console.error(`scroll by ${x.scroll_by}: ${error.message}`));
        if (x.click) {
            await in_page().locator(x.click).first().click({ timeout: 5000 }).catch(error => console.error(`click ${x.click}: ${error.message.split('\n')[0]}`));
            // A page laid out to fit its frame is never left scrolled by the click
            if (shown === 'journey') await page.evaluate(() => { const d = document.getElementById('journey').contentDocument; for (const el of [d.scrollingElement, d.body, d.getElementById('fit')]) if (el) { el.scrollLeft = 0; el.scrollTop = 0; } });
        }
        if (x.select) await in_page().locator(x.select).first().selectOption({ label: x.option }, { timeout: 5000 }).catch(error => console.error(`select ${x.select}: ${error.message.split('\n')[0]}`));
        if (x.type) await in_page().locator(x.into).first().pressSequentially(x.type, { delay: 110, timeout: 5000 }).catch(error => console.error(`type into ${x.into}: ${error.message.split('\n')[0]}`));
        if (x.key) await page.keyboard.press(x.key);
        if (x.place) { if (shown !== 'journey') await show('journey'); await go(await resolve(x.place, line)); }
        if (x.caption) await caption(x.caption);
    };
    const perform = async (scene, line) => {
        if (scene.wait) await sleep(scene.wait * 1000);
        if (scene.card) { await studio('card', script[scene.card] || scene.card); }
        if (scene.chapter) await studio('chapter', scene.chapter);
        // Whom the Now card follows: the main customer, the customer of each new line, or everyone
        if (scene.focus) { state.focus = scene.focus; await studio('focus', scene.focus === 'main' ? state.main : scene.focus === 'lines' ? (line && line.instance_id) || null : null); }
        if (scene.show && scene.show !== 'document' && scene.show !== 'html') await show(scene.show);
        if (scene.hide_card) await studio('hideCard');
        await act({ ...scene, wait: 0 }, line);
        for (const step of scene.steps || []) await act(step, line);
        if (scene.hold) await sleep(scene.hold * 1000);
    };

    // The title card lasts while the host starts, then the scenes follow the demonstration
    await sleep(Math.max(0, (o.intro ?? script.intro?.seconds ?? 5) * 1000 - (Date.now() - began)));
    await studio('hideCard');
    let cursor = 0, done_at = null;
    const reader = setInterval(() => { take().catch(error => console.error(error)); }, 100);
    for (const scene of script.scenes || []) {
        let line = null;
        if (scene.on && scene.on !== 'start') {
            // A scene waits for its line among those that came after the line of the scene before it
            for (;;) {
                await take();
                while (cursor < history.length && !matches(scene.on, history[cursor])) cursor++;
                if (cursor < history.length) { line = history[cursor++]; break; }
                if (exited) break;
                await sleep(100);
            }
        }
        if (scene.after) await sleep(scene.after * 1000);
        console.log(`${at()} s  ${scene.name || JSON.stringify(scene.on || scene.after)}`);
        await perform(scene, line);
    }
    done_at = Date.now();
    await sleep(o.tail * 1000);
    clearInterval(reader);
    clearInterval(nudge);
    await cdp.send('Page.stopScreencast').catch(() => { });
    await browser.close();
    if (demo.exitCode === null) { try { process.kill(-demo.pid, 'SIGINT'); } catch { /* already gone */ } }
    server.close();
    fs.rmSync(pages_dir, { recursive: true, force: true });

    // Each frame lasts until the next one: ffmpeg's concat demuxer with durations, then a constant rate
    const list = shots.map((s, i) => `file '${s.file}'\nduration ${Math.max(0.001, ((shots[i + 1]?.at ?? s.at + 1 / o.fps) - s.at)).toFixed(4)}`).join('\n');
    fs.writeFileSync(path.join(frames, 'list.txt'), `${list}\nfile '${shots[shots.length - 1].file}'\n`);
    const ff = spawnSync('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', path.join(frames, 'list.txt'),
        '-vf', `fps=${o.fps},format=yuv420p`, '-c:v', 'libx264', '-preset', 'slow', '-crf', '18', '-movflags', '+faststart', path.resolve(o.out)], { stdio: 'inherit' });
    if (ff.status !== 0) throw new Error('ffmpeg failed');
    if (!o['keep-frames']) fs.rmSync(frames, { recursive: true, force: true });
    console.log(`${path.resolve(o.out)}: ${shots.length} frames over ${((shots[shots.length - 1].at - shots[0].at)).toFixed(1)} s (the scenes ended at ${((done_at - began) / 1000).toFixed(1)} s)`);
}

main().catch(error => { console.error(error); process.exit(1); });
