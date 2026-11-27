#!/usr/bin/env node
// Records a demonstration video of a live AWA execution in one 1920 x 1080 frame (tools/video/studio.html):
// the real journey view and measures page on the stage, the record as it is written, the measures, and a caption.
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
// Frames come from the Chrome DevTools screencast at the rhythm the page paints, are written as JPEG with their
// timestamps, and ffmpeg turns them into an H.264 video at a constant 30 frames per second. Needs Playwright
// (pre-installed) and ffmpeg.

import { spawn, spawnSync } from 'child_process';
import fs from 'fs';
import http from 'http';
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
    for (const key of ['tail', 'width', 'height', 'fps', 'intro']) if (out[key] !== undefined) out[key] = Number(out[key]);
    if (!out.demo || !out.api || !out.out || !out.script) {
        console.error('Usage: node tools/video/record.mjs --demo "<command>" --api <url> --script <video.json> --out <file.mp4> [--intro <seconds>] [--tail <seconds>] [--keep-frames]');
        process.exit(2);
    }
    return out;
}

/** The repository's files over HTTP, so that the studio and the views load from one origin */
function serve_repository() {
    const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json', '.css': 'text/css', '.jsonl': 'text/plain', '.svg': 'image/svg+xml' };
    const server = http.createServer((req, res) => {
        const file = path.join(root, decodeURIComponent(new URL(req.url, 'http://x').pathname));
        if (!file.startsWith(root) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); res.end(); return; }
        res.writeHead(200, { 'Content-Type': types[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
        fs.createReadStream(file).pipe(res);
    });
    return new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve({ server, base: `http://127.0.0.1:${server.address().port}` })));
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
    const { server, base } = await serve_repository();
    const frames = path.resolve(o.out + '.frames');
    fs.rmSync(frames, { recursive: true, force: true });
    fs.mkdirSync(frames, { recursive: true });

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
    let buffer = '', exited = false;
    demo.stdout.setEncoding('utf-8');
    demo.stdout.on('data', chunk => {
        buffer += chunk;
        let nl;
        while ((nl = buffer.indexOf('\n')) >= 0) {
            const raw = buffer.slice(0, nl).trim();
            buffer = buffer.slice(nl + 1);
            if (!raw.startsWith('{')) continue;
            try { history.push(JSON.parse(raw)); } catch { /* not a step */ }
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
        return Object.entries(on).every(([key, want]) => key === 'customer' ? (want === 'main' ? line.instance_id === state.main && !state.phase : true)
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
            const main = line.instance_id === state.main && !state.phase;
            if (main && line.event === 'journey.stage_entered' && line.stage) await studio('chapter', line.stage);
            // A moment the script names: its caption and chapter, once
            const moment = (script.moments || []).find((m, k) => !fired.has(k) && matches(m.on, line));
            if (moment) fired.add(script.moments.indexOf(moment));
            if (moment?.chapter) await studio('chapter', moment.chapter);
            if (moment?.caption) await caption(moment.caption);
            else if (main && line.kind === 'action' && script.caption_actions !== false) await caption(line.text);
        }
    };

    // ---------------------------------------------------------------- moving the stage
    let shown = null;
    const show = async which => {
        await studio('show', which, views[which]);
        if (shown === which) return;
        shown = which;
        // The page is ready once it shows a record
        const frame = page.frameLocator(which === 'journey' ? '#journey' : '#measures-page');
        await frame.locator(which === 'journey' ? '.layer.on, #none:not([hidden])' : '#main:not([hidden]), #msg:not([hidden])').first().waitFor({ timeout: 20000 }).catch(() => { });
    };
    /** Where a place points to: {j} {i} for the scene's customer, {run} for its main run, {child} for the child run named by the
     *  line, and {step:<kind>} for the first step of that kind in the run (a guardrail, a refusal) */
    const resolve = async (place, line) => {
        if (!/\{(j|i|run|child|step:\w+)\}/.test(place)) return place;
        const instance = (line && line.instance_id) || state.main;
        const needs_child = place.includes('{child}'), needs_run = place.includes('{run}');
        const run_id = needs_child ? line?.child_run_id : needs_run ? (instance === state.main ? state.main_run : line?.run_id) : undefined;
        for (let tries = 0; tries < 100; tries++) {
            const where = await studio('place_of', instance, run_id || null);
            const kind = /\{step:(\w+)\}/.exec(place)?.[1], step = kind && where ? await studio('step_of', instance, run_id || null, kind) : 0;
            if (where && step >= 0) return place.replace('{j}', where.j).replace('{i}', where.i).replace('{run}', where.r).replace('{child}', where.r).replace(`{step:${kind}}`, step);
            await sleep(100);
        }
        throw new Error(`the record does not hold ${instance} ${run_id || ''} for ${place}`);
    };
    /** Follows a link of the journey view, and checks the view went there; the view may not hold the record yet */
    const go = async hash => {
        const [level, j, i, r] = hash.split('/'), asked = at();
        for (let tries = 0; tries < 30; tries++) {
            const there = await page.evaluate(([hash, level, j, i, r, first]) => {
                const w = document.getElementById('journey').contentWindow, v = w.AWA_VIEW;
                if (!first && v && v.level === level && (level === 'atlas' || (v.j === +j && (level === 'journey' || (v.i === +i && (level !== 'run' || v.r === +r)))))) return true;
                w.location.hash = '#' + hash;
                return false;
            }, [hash, level, j, i, r, tries === 0]);
            if (there) { console.log(`${asked} s  the journey view goes to #${hash}${tries > 1 ? `, there at ${at()} s` : ''}`); return; }
            await sleep(tries === 0 ? 300 : 0);
            await sleep(500);
        }
        console.error(`the journey view did not go to ${hash}`);
    };
    const in_page = () => page.frameLocator(shown === 'measures' ? '#measures-page' : '#journey');
    const perform = async (scene, line) => {
        if (scene.wait) await sleep(scene.wait * 1000);
        if (scene.card) { await studio('card', script[scene.card] || scene.card); }
        if (scene.chapter) await studio('chapter', scene.chapter);
        // Whom the Now card follows: the main customer, the customer of each new line, or everyone
        if (scene.focus) { state.focus = scene.focus; await studio('focus', scene.focus === 'main' ? state.main : scene.focus === 'lines' ? (line && line.instance_id) || null : null); }
        if (scene.show) await show(scene.show);
        if (scene.place) { if (shown !== 'journey') await show('journey'); await go(await resolve(scene.place, line)); }
        if (scene.caption) await caption(scene.caption);
        for (const step of scene.steps || []) {
            if (step.wait) await sleep(step.wait * 1000);
            if (step.scroll) await in_page().locator(step.scroll).first().evaluate(el => el.scrollIntoView({ behavior: 'smooth', block: 'start' })).catch(error => console.error(`scroll ${step.scroll}: ${error.message}`));
            if (step.click) {
                await in_page().locator(step.click).first().click({ timeout: 5000 }).catch(error => console.error(`click ${step.click}: ${error.message.split('\n')[0]}`));
                // A page laid out to fit its frame is never left scrolled by the click
                if (shown === 'journey') await page.evaluate(() => { const d = document.getElementById('journey').contentDocument; for (const el of [d.scrollingElement, d.body, d.getElementById('fit')]) if (el) { el.scrollLeft = 0; el.scrollTop = 0; } });
            }
            if (step.place) await go(await resolve(step.place, line));
            if (step.caption) await caption(step.caption);
        }
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
