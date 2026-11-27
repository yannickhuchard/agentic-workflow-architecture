#!/usr/bin/env node
// Records a demonstration video of a live AWA execution, seen from four sides at once
// (tools/video/studio.html): the console of what happens, the run in the replay view,
// the journeys, and the measures.
//
//   node tools/video/record.mjs --demo "node examples/electricity-onboarding/demo/live.mjs --port 4100" \
//        --api http://127.0.0.1:4100 --out onboarding.mp4 [--lang fr] [--script <file.json>]
//
// The demo command must start an AWA host whose HTTP interface answers at --api, and write one
// JSON line per step on its standard output: {"t", "kind", "text", "run_id"?, "instance_id"?}.
// A line whose kind is "done" ends the recording, after --tail seconds.
//
// Frames come from the Chrome DevTools screencast at the rhythm the page paints, are written as
// JPEG with their timestamps, and ffmpeg turns them into an H.264 video at a constant 30 frames
// per second. Needs Playwright (pre-installed) and ffmpeg.

import { spawn, spawnSync } from 'child_process';
import fs from 'fs';
import http from 'http';
import path from 'path';
import { createRequire } from 'module';
import { fileURLToPath } from 'url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../..');
const require = createRequire(import.meta.url);

function args() {
    const out = { tail: 8, lang: 'en', width: 1920, height: 1080, fps: 30, intro: 5 };
    const argv = process.argv.slice(2);
    for (let i = 0; i < argv.length; i++) {
        const key = argv[i].replace(/^--/, '');
        out[key] = argv[i + 1];
        i++;
    }
    for (const key of ['tail', 'width', 'height', 'fps', 'intro']) out[key] = Number(out[key]);
    if (!out.demo || !out.api || !out.out) {
        console.error('Usage: node tools/video/record.mjs --demo "<command>" --api <url> --out <file.mp4> [--script <file.json>] [--lang en|fr]');
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
        await new Promise(r => setTimeout(r, 250));
    }
    throw new Error(`${url} did not answer within ${ms} ms`);
}

const mmss = ms => { const s = Math.max(0, Math.floor(ms / 1000)); return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`; };

async function main() {
    const o = args();
    const script = o.script ? JSON.parse(fs.readFileSync(path.resolve(o.script), 'utf-8')) : {};
    const text = script[o.lang] || script.en || {};
    // A caption or a console line in another language: an exact sentence, else a rule, else as written
    const translate = value => {
        if (!value || !text.phrases) return value;
        if (text.phrases[value]) return text.phrases[value];
        for (const [pattern, replacement] of text.rules || []) {
            const re = new RegExp(pattern);
            if (re.test(value)) return value.replace(re, replacement);
        }
        return value;
    };

    const { server, base } = await serve_repository();
    const frames = path.resolve(o.out + '.frames');
    fs.rmSync(frames, { recursive: true, force: true });
    fs.mkdirSync(frames, { recursive: true });

    const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
    const browser = await chromium.launch();
    const context = await browser.newContext({ viewport: { width: o.width, height: o.height }, deviceScaleFactor: 1 });
    const page = await context.newPage();
    await page.goto(`${base}/tools/video/studio.html`);
    await page.evaluate(labels => window.studio.labels(labels), text.labels || {});

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

    // The title card while the demonstration starts
    await page.evaluate(card => window.studio.card(card.tag, card.title, card.text), text.intro || { tag: 'AWA', title: 'A live AWA execution', text: '' });
    const demo = spawn(o.demo, { shell: true, cwd: root, stdio: ['ignore', 'pipe', 'inherit'] });
    const begun = Date.now();
    let done = false, main_run = null, step = 0;
    const pending = [];
    demo.stdout.setEncoding('utf-8');
    let buffer = '';
    demo.stdout.on('data', chunk => {
        buffer += chunk;
        let nl;
        while ((nl = buffer.indexOf('\n')) >= 0) {
            const raw = buffer.slice(0, nl).trim();
            buffer = buffer.slice(nl + 1);
            if (!raw.startsWith('{')) continue;
            try { pending.push(JSON.parse(raw)); } catch { /* not a step */ }
        }
    });
    demo.on('exit', () => { done = true; });

    await wait_for(`${o.api.replace(/\/$/, '')}/api/v1/journeys/portfolio`);
    await new Promise(r => setTimeout(r, Math.max(0, o.intro * 1000 - (Date.now() - begun))));
    const api = o.api.replace(/\/$/, '');
    await page.evaluate(({ api, labels }) => {
        window.studio.view('journeys', `../visualization/journey.html?live=${encodeURIComponent(api)}`, 1180, labels.journeys_note || 'live');
        window.studio.view('measures', `../visualization/dashboard.html?live=${encodeURIComponent(api)}`, 1180, labels.measures_note || 'live');
        window.studio.placeholder('run', labels.run_waiting || 'Waiting for the first run');
        window.studio.hideCard();
    }, { api, labels: text.labels || {} });

    const start_of_steps = Date.now();
    let finished_at = null;
    while (true) {
        while (pending.length) {
            const s = pending.shift();
            if (s.kind === 'done') { finished_at = Date.now(); continue; }
            // The first run of the main scenario is the one the run pane follows
            if (!main_run && s.run_id && (s.main !== false)) {
                main_run = s.run_id;
                const url = `../visualization/replay.html?run=${encodeURIComponent(`${api}/api/v1/workflows/runs/${main_run}`)}`;
                await page.evaluate(({ url, note }) => window.studio.view('run', url, 1700, note), { url, note: s.run_label || s.scenario || '' });
            }
            const line = translate(s.text);
            const kind = s.kind === 'action' ? (s.actor === 'person' ? 'person' : s.actor === 'agent' ? 'agent' : 'action') : s.kind === 'fail' ? 'fail' : 'event';
            await page.evaluate(({ kind, line, time }) => window.studio.line(kind, line, time), { kind, line, time: mmss(s.t ?? (Date.now() - start_of_steps)) });
            if (s.kind === 'action' || s.caption) {
                step++;
                await page.evaluate(({ c, n }) => window.studio.caption(c, n), { c: translate(s.caption || s.text), n: String(step) });
            }
        }
        if (finished_at && Date.now() - finished_at > o.tail * 1000) break;
        if (done && !pending.length && !finished_at) finished_at = Date.now();
        await new Promise(r => setTimeout(r, 100));
    }

    if (text.outro) {
        await page.evaluate(card => window.studio.card(card.tag, card.title, card.text), text.outro);
        await new Promise(r => setTimeout(r, 5000));
    }
    clearInterval(nudge);
    await cdp.send('Page.stopScreencast').catch(() => { });
    await browser.close();
    if (demo.exitCode === null) demo.kill('SIGINT');
    server.close();

    // Each frame lasts until the next one: ffmpeg's concat demuxer with durations, then a constant rate
    const list = shots.map((s, i) => `file '${s.file}'\nduration ${Math.max(0.001, ((shots[i + 1]?.at ?? s.at + 1 / o.fps) - s.at)).toFixed(4)}`).join('\n');
    fs.writeFileSync(path.join(frames, 'list.txt'), `${list}\nfile '${shots[shots.length - 1].file}'\n`);
    const ff = spawnSync('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', path.join(frames, 'list.txt'),
        '-vf', `fps=${o.fps},format=yuv420p`, '-c:v', 'libx264', '-preset', 'slow', '-crf', '18', '-movflags', '+faststart', path.resolve(o.out)], { stdio: 'inherit' });
    if (ff.status !== 0) throw new Error('ffmpeg failed');
    fs.rmSync(frames, { recursive: true, force: true });
    console.log(`${path.resolve(o.out)}: ${shots.length} frames over ${((shots[shots.length - 1].at - shots[0].at)).toFixed(1)} s`);
}

main().catch(error => { console.error(error); process.exit(1); });
