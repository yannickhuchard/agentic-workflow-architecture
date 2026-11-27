// The dossier's HTML edition: one self-contained page (fonts from Google Fonts, with fallbacks; everything else
// inline, images as inline SVG) that renders the model of awa-dossier.js. A chapter rail with scrollspy, the cover's
// lines drawing, counters, a customer's story revealed sentence by sentence with the record beside it, charts that
// grow from a visible resting state, each with a text summary and a "Show the table" button, the recommendations map,
// the appendix. The page is complete at rest: every element is in its final state in the markup, and motion only plays
// from a start state when an element comes into view. prefers-reduced-motion, or the Motion switch, stops it all.
// WCAG 2.2 AA: landmarks, a skip link, headings in order, lang, text alternatives, keyboard, visible focus, contrast in
// both themes, no horizontal scroll at 400 px.
//
//   const html = require('./awa-dossier-html.js').render(model, { theme: AWA_DOSSIER.theme(brand) });
(function (root) {
'use strict';

const DAY = 86400000, H = 3600000;
const esc = s => String(s === null || s === undefined ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const fmtH = ms => ms === null || ms === undefined ? '' : ms === 0 ? '0' : ms < H ? `${Math.round(ms / 60000)} min` : ms < 48 * H ? `${String(Math.round(ms / H * 10) / 10).replace(/\.0$/, '')} h` : `${(ms / DAY).toFixed(1)} d`;
const days = p => (p ? String(p).replace(/^P(\d+)D$/, '$1 days').replace(/^P/, '') : 'no limit');
const cap = s => (s ? s[0].toUpperCase() + s.slice(1) : s);
const METHOD = { replay: 'Replay', measured: 'Measured', estimate: 'Estimate', pilot: 'Pilot', 'replay-live': 'Replay, not run' };
const SHAPE = {
    speed: '<circle cx="50" cy="50" r="46"/>', quality: '<rect x="8" y="8" width="84" height="84" rx="12"/>', cost: '<path d="M50 2 L98 50 L50 98 L2 50Z"/>',
    trust: '<polygon points="50,2 92,26 92,74 50,98 8,74 8,26"/>', experience: '<circle cx="50" cy="50" r="46"/><circle cx="50" cy="50" r="20" fill="none" stroke="var(--panel)" stroke-width="12"/>',
};

/** Screen tokens: AWA's own dark page, or a light page from a company's brand */
function screen(T) {
    if (T.mode !== 'light') return { scheme: 'dark', bg: '#0b0f19', panel: '#111827', card: '#1e293b', line: 'rgba(255,255,255,.11)', lineStrong: 'rgba(255,255,255,.22)', text: '#f8fafc', soft: '#cbd5e1', mute: '#94a3b8', accent: '#818cf8', accentText: '#a5b4fc', accentFill: '#4338ca', onAccent: '#ffffff', tint: 'rgba(129,140,248,.14)', ok: '#34d399', wait: '#fbbf24', bad: '#ff6b6d', run: '#c084fc', sky: '#38bdf8', night: '#0b0f19', nOn: '#f8fafc', nSoft: '#cbd5e1', nMute: '#94a3b8', nAccent: '#a5b4fc', kSpeed: '#38bdf8', kQuality: '#a78bfa', kCost: '#fbbf24', kTrust: '#34d399', kExperience: '#f472b6', focus: '#a5b4fc' };
    return { scheme: 'light', bg: T.paper, panel: T.paper2, card: T.tint, line: 'rgba(15,23,42,.12)', lineStrong: 'rgba(15,23,42,.26)', text: T.ink, soft: T.ink2, mute: T.ink3, accent: T.accent, accentText: T.accent, accentFill: T.accent, onAccent: '#ffffff', tint: T.tint, ok: T.ok, wait: T.wait, bad: T.bad, run: T.run, sky: T.sky, night: T.night, nOn: T.on, nSoft: T.on2, nMute: T.on3, nAccent: T.acc_n, kSpeed: T.k_speed, kQuality: T.k_quality, kCost: T.k_cost, kTrust: T.k_trust, kExperience: T.k_experience, focus: T.accent };
}

function css(V, T) {
    return `:root{color-scheme:${V.scheme};--display:'${T.display}','Space Grotesk',Inter,system-ui,sans-serif;--body:'${T.body}',Inter,system-ui,-apple-system,'Segoe UI',sans-serif;--serif:Newsreader,Georgia,serif;--mono:'JetBrains Mono',ui-monospace,Menlo,monospace;
--ease-out:cubic-bezier(.2,.7,.2,1);--ease-std:cubic-bezier(.4,0,.2,1);--ease-draw:cubic-bezier(.65,0,.35,1);--t-instant:150ms;--t-quick:240ms;--t-move:400ms;--t-draw:600ms;--radius:12px;
--bg:${V.bg};--panel:${V.panel};--card:${V.card};--line:${V.line};--line-strong:${V.lineStrong};--text:${V.text};--soft:${V.soft};--mute:${V.mute};--accent:${V.accent};--accent-text:${V.accentText};--accent-fill:${V.accentFill};--on-accent:${V.onAccent};--accent-tint:${V.tint};
--ok:${V.ok};--wait:${V.wait};--bad:${V.bad};--run:${V.run};--sky:${V.sky};--night:${V.night};--n-on:${V.nOn};--n-soft:${V.nSoft};--n-mute:${V.nMute};--n-accent:${V.nAccent};--focus:${V.focus};
--k-speed:${V.kSpeed};--k-quality:${V.kQuality};--k-cost:${V.kCost};--k-trust:${V.kTrust};--k-experience:${V.kExperience}}
*{box-sizing:border-box}
html{scroll-behavior:smooth;scroll-padding-top:72px}
body{margin:0;background:var(--bg);color:var(--text);font:400 17px/1.6 var(--body);font-feature-settings:"cv11"}
a{color:var(--accent-text)}
button{font:inherit;color:inherit}
:focus-visible{outline:2px solid var(--focus);outline-offset:2px;border-radius:4px}
.vh{position:absolute!important;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}
.skip{position:absolute;left:12px;top:-60px;z-index:50;padding:10px 14px;border-radius:8px;background:var(--accent-fill);color:var(--on-accent);text-decoration:none;font-weight:600;transition:top var(--t-quick) var(--ease-out)}
.skip:focus{top:10px}
.tnum{font-variant-numeric:tabular-nums}
header.bar{position:sticky;top:0;z-index:20;display:flex;align-items:center;gap:12px;height:60px;padding:0 20px;background:var(--panel);border-bottom:1px solid var(--line)}
.brand{display:flex;align-items:center;gap:10px;font:700 19px/1 var(--display);white-space:nowrap;min-width:0}
.brand .logo{width:28px;height:28px;border-radius:8px;display:grid;place-items:center;background:var(--accent-fill);color:var(--on-accent);font-size:15px;flex:none}
.brand img{height:28px}
.bar .ed{font-size:13px;color:var(--mute);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.bar .spacer{flex:1}
.btn{min-height:36px;padding:0 14px;border-radius:9px;border:1px solid var(--line-strong);background:transparent;cursor:pointer;font-size:14px;color:var(--text);display:inline-flex;align-items:center;gap:8px;white-space:nowrap;transition:background-color var(--t-instant) var(--ease-std),border-color var(--t-instant) var(--ease-std)}
.btn:hover{background:var(--accent-tint);border-color:var(--accent)}
.sw{width:30px;height:18px;border-radius:9px;background:var(--line-strong);position:relative;flex:none}
.sw::after{content:"";position:absolute;left:2px;top:2px;width:14px;height:14px;border-radius:50%;background:var(--text);transition:transform var(--t-quick) var(--ease-out)}
[aria-pressed="true"] .sw{background:var(--accent-fill)}
[aria-pressed="true"] .sw::after{transform:translateX(12px);background:#fff}
.doss{display:grid;grid-template-columns:232px minmax(0,1fr);max-width:1440px;margin:0 auto}
nav.rail{position:sticky;top:60px;align-self:start;height:calc(100vh - 60px);padding:28px 18px 28px 24px;border-right:1px solid var(--line);overflow-y:auto}
nav.rail h2{margin:0 0 14px;font:700 12px/1.3 var(--body);letter-spacing:.12em;text-transform:uppercase;color:var(--mute)}
nav.rail ol{list-style:none;margin:0;padding:0;display:grid;gap:2px}
nav.rail a{display:grid;grid-template-columns:30px 1fr;gap:6px;padding:7px 8px;border-radius:8px;text-decoration:none;color:var(--soft);font-size:14px;line-height:1.3}
nav.rail a span:first-child{font:600 13px/1.3 var(--display);color:var(--mute)}
nav.rail a:hover{background:var(--accent-tint);color:var(--text)}
nav.rail a[aria-current="true"]{background:var(--accent-tint);color:var(--text);font-weight:600}
nav.rail a[aria-current="true"] span:first-child{color:var(--accent-text)}
.progress{margin-top:20px;height:3px;border-radius:2px;background:var(--line);overflow:hidden}
.progress i{display:block;height:100%;width:100%;background:var(--accent);transform-origin:0 50%;transform:scaleX(var(--p,0))}
.reading{margin-top:24px;font-size:13px;color:var(--mute);line-height:1.5}
.reading b{color:var(--soft);font-weight:600}
main{min-width:0}
.ch{padding:96px clamp(16px,6vw,96px);border-bottom:1px solid var(--line);position:relative}
.ch.night{background:var(--night);color:var(--n-on)}
.kicker{font:700 13px/1.3 var(--body);letter-spacing:.14em;text-transform:uppercase;color:var(--accent-text);margin:0 0 16px}
.night .kicker{color:var(--n-accent)}
h1,h2,h3{font-family:var(--display);letter-spacing:-.02em;margin:0}
.ch h2{font-size:clamp(30px,4.4vw,56px);line-height:1.06;font-weight:600;max-width:22ch}
.ch h3{font-size:22px;line-height:1.25;font-weight:600;letter-spacing:-.01em}
.lead{font-size:clamp(18px,1.6vw,21px);line-height:1.55;color:var(--soft);max-width:62ch;margin:20px 0 0}
.night .lead{color:var(--n-soft)}
.ref{font:500 13px/1 var(--mono);color:var(--accent-text);text-decoration:none;white-space:nowrap;padding:2px 4px;border-radius:4px}
.night .ref{color:var(--n-accent)}
#cover{min-height:calc(100vh - 60px);display:flex;flex-direction:column;justify-content:center;padding-top:72px;padding-bottom:72px}
#cover h1{font-size:clamp(44px,7.4vw,108px);line-height:.98;font-weight:600;letter-spacing:-.035em;overflow-wrap:anywhere}
.cover-lines{width:100%;height:auto;margin-top:36px;overflow:visible}
.cover-meta{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:24px;margin:36px 0 0;padding-top:24px;border-top:1px solid rgba(255,255,255,.18);font-size:14px;color:var(--n-soft)}
.cover-meta dt{font-size:12px;letter-spacing:.12em;text-transform:uppercase;color:var(--n-mute);font-weight:700;margin-bottom:8px}
.cover-meta dd{margin:0}
.cover-meta b{display:block;font:600 30px/1.1 var(--display);color:var(--n-on);margin-bottom:4px}
.legend-line{font-size:14px;color:var(--n-soft);max-width:70ch;margin-top:14px}
.figs{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:0 28px;margin-top:44px}
.fig{border-top:1px solid var(--text);padding:14px 0 26px}
.fig .n{font:600 clamp(32px,3.6vw,48px)/1 var(--display);letter-spacing:-.03em}
.fig .n small{font:500 14px var(--body);color:var(--mute);letter-spacing:0;margin-left:8px}
.fig p{margin:8px 0 0;color:var(--soft);font-size:15px;line-height:1.45}
.finds{display:grid;gap:34px;margin-top:36px;padding:0;list-style:none}
.find{display:grid;grid-template-columns:64px minmax(0,1fr);gap:18px}
.find .k{font:500 56px/1 var(--display);color:var(--accent)}
.find p{margin:8px 0 0;color:var(--soft);max-width:62ch}
figure.chart{margin:40px 0 0;padding:22px 24px;border:1px solid var(--line);border-radius:var(--radius);background:var(--panel)}
figure.chart figcaption{display:flex;flex-wrap:wrap;gap:8px 16px;align-items:baseline;justify-content:space-between;margin-bottom:14px}
figure.chart figcaption h3{font-size:19px}
.summary{margin:14px 0 0;padding-left:14px;border-left:3px solid var(--accent);color:var(--soft);font-size:15.5px;max-width:72ch}
.tbtn{min-height:30px;padding:0 12px;font-size:13px}
.tablewrap{overflow-x:auto;margin-top:14px}
table.data{border-collapse:collapse;width:100%;font-size:14px;font-variant-numeric:tabular-nums}
table.data th{text-align:left;font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:var(--mute);border-bottom:1.5px solid var(--text);padding:6px 10px 6px 0}
table.data tbody th{font-size:14px;letter-spacing:0;text-transform:none;color:var(--text);border-bottom:1px solid var(--line);font-weight:600}
table.data td{padding:7px 10px 7px 0;border-bottom:1px solid var(--line);color:var(--soft)}
table.data .r{text-align:right}
.bars{display:grid;gap:10px}
.brow{display:grid;grid-template-columns:150px minmax(0,1fr) 76px;gap:12px;align-items:center;font-size:14.5px}
.track{position:relative;height:18px;border-radius:4px;background:var(--card)}
.fill{position:absolute;left:0;top:0;height:100%;border-radius:4px;background:var(--accent);transform-origin:0 50%}
.fill.side{background:transparent;border:1.5px dashed var(--accent)}
.tick{position:absolute;top:-4px;width:2px;height:26px;background:var(--text)}
.tick.over{background:var(--bad)}
.limit{position:absolute;top:-8px;bottom:-8px;width:0;border-left:1.5px dashed var(--text)}
.val{font:600 15px var(--display)}
.atlas{margin-top:36px;overflow-x:auto}
.atlas table{border-collapse:separate;border-spacing:0 8px;width:100%;min-width:760px;font-size:13px}
.atlas th{font:600 13px/1.25 var(--body);text-align:left;color:var(--text);padding:0 6px 6px;vertical-align:bottom}
.atlas th small{display:block;font-weight:400;color:var(--mute);font-size:12px}
.atlas th[scope="row"]{padding:0 12px 0 0;white-space:nowrap;font-size:14px}
.atlas td{padding:0 3px;position:relative}
.pill{position:relative;display:flex;align-items:center;gap:6px;height:28px;padding:0 10px;border-radius:14px;border:1.5px solid var(--m,var(--mute));background:var(--panel);white-space:nowrap;font-weight:500}
.pill i{width:8px;height:8px;border-radius:50%;background:var(--m,var(--mute));flex:none}
.pill.stuck{border-style:dashed;border-width:2px}
.m-good{--m:var(--ok)}.m-mid{--m:var(--mute)}.m-low{--m:var(--wait)}.m-bad{--m:var(--bad)}
.persona-head{display:flex;flex-wrap:wrap;align-items:flex-end;gap:12px 32px}
.mono-gram{font:600 clamp(110px,16vw,220px)/.8 var(--display);letter-spacing:-.06em;color:transparent;-webkit-text-stroke:1.5px currentColor}
.persona{display:grid;grid-template-columns:minmax(0,1fr) 320px;gap:56px;margin-top:40px;align-items:start}
.story{font:400 clamp(19px,1.7vw,23px)/1.6 var(--serif);font-variation-settings:"opsz" 20;max-width:40em}
.story p{margin:0 0 1em}
.story .ref{font-size:12.5px;vertical-align:2px;margin-left:4px}
.quote{font:italic 400 clamp(30px,4vw,54px)/1.15 var(--serif);font-variation-settings:"opsz" 48;margin:48px 0 0;max-width:20ch}
aside.record{position:sticky;top:92px;border-left:1px solid rgba(255,255,255,.18);padding-left:22px}
aside.record h3{font:700 12px/1.3 var(--body);letter-spacing:.12em;text-transform:uppercase;color:var(--n-mute);margin-bottom:14px}
aside.record ol{list-style:none;margin:0;padding:0;display:grid;gap:4px}
aside.record li{padding:8px 10px;border-radius:8px;font-size:14px;line-height:1.4;color:var(--n-soft);border:1px solid transparent;transition:background-color var(--t-quick) var(--ease-std),border-color var(--t-quick) var(--ease-std)}
aside.record li b{display:block;font:600 12px/1.3 var(--mono);color:var(--n-accent);margin-bottom:2px}
aside.record li[aria-current="true"]{background:rgba(255,255,255,.1);border-color:rgba(255,255,255,.4);color:var(--n-on)}
.facts{display:grid;grid-template-columns:auto 1fr;gap:6px 18px;margin:24px 0 0;font-size:15px;color:var(--n-soft)}
.facts dt{color:var(--n-mute)}
.facts dd{margin:0}
.days{display:grid;grid-template-columns:repeat(var(--n,21),minmax(0,1fr));gap:5px;margin-top:40px}
.days span{aspect-ratio:1;border-radius:4px;border:1px solid rgba(255,255,255,.3)}
.days span.out{border:1.5px solid var(--n-accent);background:rgba(255,255,255,.12)}
.recbook{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:36px;margin-top:36px;align-items:start}
.mini-map{width:100%;height:auto;border-radius:var(--radius);background:var(--panel);border:1px solid var(--line)}
.rlist{list-style:none;margin:0;padding:0;display:grid;gap:2px}
.rlist li{display:grid;grid-template-columns:40px minmax(0,1fr);gap:12px;padding:12px 0;border-top:1px solid var(--line)}
.rlist .no{font:600 26px/1 var(--display);color:var(--accent)}
.rlist h3{font:600 17px/1.35 var(--body);letter-spacing:0}
.rlist p{margin:4px 0 0;font-size:14.5px;color:var(--soft);line-height:1.45}
.rlist .meta{color:var(--mute);font-size:13.5px}
.controls{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:18px;margin-top:28px}
.controls div{border-top:1.5px solid var(--text);padding-top:8px}
.controls h4{margin:0;font:600 15px var(--body)}
.controls p{margin:4px 0 0;font-size:14px;color:var(--soft)}
.controls b{display:block;font-size:13px;color:var(--accent-text);margin-top:2px}
.gloss{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:0 24px;margin-top:20px}
.gloss div{border-top:1px solid var(--line);padding:10px 0}
.gloss dt{font-weight:600}
.gloss dd{margin:4px 0 0;font-size:14.5px;color:var(--soft)}
.notice{margin-top:28px;padding:14px 18px;border:1.5px solid var(--text);border-radius:6px;font-size:15px}
footer.foot{padding:28px clamp(16px,6vw,96px);font-size:13.5px;color:var(--mute)}
.play .grow{animation:grow var(--t-draw) var(--ease-draw) both;animation-delay:calc(var(--i,0)*40ms)}
@keyframes grow{from{transform:scaleX(.04)}}
.play .rise{animation:rise var(--t-draw) var(--ease-out) both;animation-delay:calc(var(--i,0)*40ms)}
@keyframes rise{from{opacity:.3;transform:translateY(14px)}}
.play .pop{animation:pop var(--t-quick) var(--ease-out) both;animation-delay:calc(var(--i,0)*24ms)}
@keyframes pop{from{opacity:.35;transform:scale(.82)}}
.beat.play{animation:beat var(--t-move) var(--ease-out) both}
@keyframes beat{from{opacity:.3}}
.play .wipe{animation:wipe var(--t-draw) var(--ease-draw) both;animation-delay:calc(var(--i,0)*40ms)}
@keyframes wipe{from{clip-path:inset(0 100% 0 0)}to{clip-path:inset(0 0 0 0)}}
.stuck-pulse{animation:wait 1.6s ease-in-out infinite}
@keyframes wait{50%{opacity:.45}}
html.still *,html.still *::before,html.still *::after{animation:none!important;transition:none!important;scroll-behavior:auto!important}
@media (prefers-reduced-motion:reduce){*,*::before,*::after{animation:none!important;transition:none!important;scroll-behavior:auto!important}}
@media (max-width:1100px){.doss{grid-template-columns:minmax(0,1fr)}nav.rail{position:sticky;top:60px;z-index:10;height:auto;padding:8px 12px;border-right:0;border-bottom:1px solid var(--line);background:var(--panel)}nav.rail h2,nav.rail .reading,nav.rail .progress{display:none}nav.rail ol{grid-auto-flow:column;grid-auto-columns:max-content;overflow-x:auto}nav.rail a{grid-template-columns:auto auto;padding:6px 10px}.persona,.recbook{grid-template-columns:minmax(0,1fr)}aside.record{position:static;border-left:0;padding-left:0}html{scroll-padding-top:112px}}
@media (max-width:720px){body{font-size:16px}header.bar{gap:8px;padding:0 10px;height:56px}.bar .ed,.brand .word{display:none}nav.rail{top:56px}.ch{padding:64px 16px}.figs,.cover-meta,.controls,.gloss{grid-template-columns:minmax(0,1fr) minmax(0,1fr)}.find{grid-template-columns:40px minmax(0,1fr)}.find .k{font-size:40px}.brow{grid-template-columns:96px minmax(0,1fr) 58px;font-size:13.5px}figure.chart{padding:16px 12px}.days{gap:3px}}
@media (max-width:480px){.gloss,.controls{grid-template-columns:minmax(0,1fr)}}
@media print{header.bar,nav.rail,.tbtn{display:none}.doss{display:block}.ch{break-inside:avoid-page}}`;
}

const moodCls = v => (v === null || v === undefined ? 'm-mid' : v >= 0.5 ? 'm-good' : v > -0.5 ? 'm-mid' : v > -1 ? 'm-low' : 'm-bad');
const moodWord = v => (v === null || v === undefined ? 'no value' : v >= 0.5 ? 'good' : v > -0.5 ? 'neutral' : v > -1 ? 'low' : 'very low');

/** Render the HTML edition of a dossier */
function render(m, opts = {}) {
    const T = opts.theme || (root.AWA_DOSSIER || (typeof require === 'function' ? require('./awa-dossier.js') : {})).AWA_THEME;
    const V = screen(T), client = m.edition === 'client', S = m.meta.subject;
    let tid = 0;
    const tableBtn = id => `<button class="btn tbtn" type="button" aria-expanded="false" aria-controls="${id}" data-table="${id}">Show the table</button>`;
    const table = (id, caption, head, rows) => `<div class="tablewrap" id="${id}" hidden role="region" aria-label="${esc(caption)}" tabindex="0"><table class="data"><caption class="vh">${esc(caption)}</caption><thead><tr>${head.map((h, i) => `<th scope="col"${i && /^[0-9.,% −+-]/.test(String((rows[0] || [])[i] || '')) ? ' class="r"' : ''}>${esc(h)}</th>`).join('')}</tr></thead><tbody>${rows.map(r => `<tr>${r.map((c, i) => (i === 0 ? `<th scope="row">${esc(c)}</th>` : `<td${/^[0-9.,% −+-]/.test(String(c)) ? ' class="r"' : ''}>${esc(c)}</td>`)).join('')}</tr>`).join('')}</tbody></table></div>`;
    const bars = (rows, max, label) => `<div class="bars" role="img" aria-label="${esc(label)}">${rows.map((r, i) => `<div class="brow" aria-hidden="true"><span>${esc(r.label)}</span><span class="track">${r.limit !== undefined ? `<span class="limit" style="left:${(r.limit / max * 100).toFixed(1)}%"></span>` : ''}<span class="fill grow${r.side ? ' side' : ''}" style="--i:${i};width:${Math.max(r.v / max * 100, 0.6).toFixed(1)}%;${r.col ? 'background:' + r.col : ''}"></span>${r.tick !== undefined ? `<span class="tick${r.tick > (r.limit || 1e9) ? ' over' : ''}" style="left:${Math.min(r.tick / max * 100, 100).toFixed(1)}%"></span>` : ''}</span><span class="val tnum">${esc(r.text)}</span></div>`).join('')}</div>`;
    const chart = (title, body, summary, tbl) => { const id = `t${++tid}`, hid = `h${tid}`; return `<figure class="chart" aria-labelledby="${hid}"><figcaption><h3 id="${hid}">${esc(title)}</h3>${tbl ? tableBtn(id) : ''}</figcaption>${body}${summary ? `<p class="summary">${esc(summary)}</p>` : ''}${tbl ? table(id, title, tbl[0], tbl[1]) : ''}</figure>`; };
    const ref = (r, who) => `<a class="ref" href="#rec-${who}-${esc(r.run)}-${r.seq}" aria-label="${r.run === 'J' ? `journey record ${r.seq}` : `event ${r.seq} of run ${esc(r.run)}`}">${esc(r.run)}·${r.seq}</a>`;
    const chapters = [];

    // cover
    {
        const lines = m.cover.lines, n = lines.length, maxDays = Math.max(28, ...lines.map(l => l.days)) + 1;
        const VW = 900, x0 = 70, x1 = 820, sc = (x1 - x0) / maxDays, y0 = 40, dy = Math.min(48, 380 / Math.max(1, n)), ox = 12, oy = y0 + dy * (n - 1) / 2, H2 = y0 + dy * (n - 1) + 60;
        let s = '';
        const step = maxDays > 120 ? 30 : maxDays > 60 ? 14 : 7;
        for (let t = 0; t <= maxDays; t += step) { const x = x0 + t * sc; s += `<line x1="${x.toFixed(1)}" y1="${y0 - 26}" x2="${x.toFixed(1)}" y2="${y0 + dy * (n - 1) + 18}" stroke="rgba(255,255,255,.12)"/><text x="${x.toFixed(1)}" y="${y0 + dy * (n - 1) + 40}" fill="${V.nMute}" font-size="13" text-anchor="middle">${t ? t + ' d' : 'day 0'}</text>`; }
        if (m.meta.promise) { const x = x0 + m.meta.promise.days * sc; s += `<line x1="${x.toFixed(1)}" y1="${y0 - 26}" x2="${x.toFixed(1)}" y2="${y0 + dy * (n - 1) + 18}" stroke="${T.wait_n}" stroke-dasharray="4 5" stroke-width="1.5"/><text x="${(x + 8).toFixed(1)}" y="${y0 - 12}" fill="${T.wait_n}" font-size="13" font-weight="600">${m.meta.promise.days} days, the promise</text>`; }
        lines.forEach((l, i) => {
            const y = y0 + i * dy, col = l.featured ? (l.stuck ? T.wait_n : V.nAccent) : V.nMute, w = l.featured ? 3 : 1.8, xe = x0 + l.days * sc;
            let g = `<path d="M${ox} ${oy} C ${ox + 32} ${oy}, ${x0 - 30} ${y}, ${x0} ${y}" fill="none" stroke="${col}" stroke-width="${w}"/>`;
            if (l.silence) { const xs = x0 + l.silence.from_days * sc, xt = Math.min(xe, x0 + l.silence.to_days * sc); g += `<line x1="${x0}" y1="${y}" x2="${Math.max(xs, x0 + 3).toFixed(1)}" y2="${y}" stroke="${col}" stroke-width="${w}" stroke-linecap="round"/><line x1="${xs.toFixed(1)}" y1="${y}" x2="${xt.toFixed(1)}" y2="${y}" stroke="${col}" stroke-width="${w}" stroke-dasharray="2 6" stroke-linecap="round"/>${xt < xe ? `<line x1="${xt.toFixed(1)}" y1="${y}" x2="${xe.toFixed(1)}" y2="${y}" stroke="${col}" stroke-width="${w}"/>` : ''}`; }
            else g += `<line x1="${x0}" y1="${y}" x2="${Math.max(xe, x0 + 3).toFixed(1)}" y2="${y}" stroke="${col}" stroke-width="${w}" stroke-linecap="round"/>`;
            g += l.status === 'completed' ? `<circle cx="${xe.toFixed(1)}" cy="${y}" r="6" fill="${V.night}" stroke="${T.ok_n}" stroke-width="2.4"/>` : l.status === 'abandoned' ? `<rect x="${(xe - 4).toFixed(1)}" y="${y - 5}" width="10" height="10" rx="1.5" fill="${V.nMute}"/>` : `<rect class="stuck-pulse" x="${(xe - 6).toFixed(1)}" y="${y - 6}" width="12" height="12" rx="2" fill="${T.wait_n}"/>`;
            const lab = l.status === 'completed' ? `${l.days.toFixed(1)} d` : l.status === 'abandoned' ? 'left' : `${l.days.toFixed(1)} d, waiting`;
            if (l.name) g += `<text x="${x0 + 8}" y="${y - 9}" fill="${l.featured ? V.nOn : V.nSoft}" font-size="13" font-weight="${l.featured ? 600 : 500}">${esc(l.name)}</text>`;
            g += `<text x="${(xe + 12).toFixed(1)}" y="${y + 4}" fill="${l.featured ? V.nOn : V.nSoft}" font-size="13.5" font-weight="500">${lab}</text>`;
            s += `<g class="wipe" style="--i:${i}">${g}</g>`;
        });
        s += `<circle cx="${ox}" cy="${oy}" r="5" fill="${V.nAccent}"/>`;
        const desc = lines.map(l => `${l.name || 'a customer'}: ${l.status === 'completed' ? l.days.toFixed(1) + ' days' : l.status === 'abandoned' ? 'left' : l.days.toFixed(1) + ' days, waiting'}`).join('; ');
        const meta = client ? [['For', esc(m.meta.client.name), ''], ['Journey', esc(m.meta.journey), ''], ['Period', `${m.meta.period.days} days`, esc(m.meta.period.text)], ['Edition', 'Client', 'your journey only']]
            : [['Scope', `<span class="count-up" data-to="${m.meta.customers}">${m.meta.customers}</span>`, `${esc(S[1])}, 1 journey, ${m.meta.workflows.length} workflow${m.meta.workflows.length === 1 ? '' : 's'}`], ['Runs', `<span class="count-up" data-to="${m.meta.runs}">${m.meta.runs}</span>`, 'recorded event by event'], ['Record', `<span class="count-up" data-to="${m.meta.run_events}" data-sep="1">${m.meta.run_events.toLocaleString('en-US')}</span>`, `run events, and ${m.meta.journey_events} journey events`], ['Period', `${m.meta.period.days} days`, esc(m.meta.period.text)]];
        chapters.push({ id: 'cover', n: '00', name: 'Cover', html: `<section class="ch night" id="cover" aria-labelledby="cover-h"><p class="kicker">${client ? `Your ${esc(m.meta.journey.toLowerCase())}` : 'A dossier on one journey and the work behind it'}</p><h1 id="cover-h">${esc(client ? m.meta.client.name : m.meta.journey)}</h1><p class="lead">${esc(client ? 'Every step you took with us, in your words and in the record: what you chose, what was checked, and what we recommend for next time.' : m.meta.lead)}</p>
<svg class="cover-lines" viewBox="0 0 ${VW} ${H2}" role="img" aria-labelledby="cl-t cl-d"><title id="cl-t">${esc(`${n} ${S[1]}, each a line as long as their days`)}</title><desc id="cl-d">${esc(desc)}</desc>${s}</svg>
<p class="legend-line">${esc(client ? 'Your line, among the others’, who are not named. A client edition leaves out internal costs, how the agents work inside, and other customers’ data.' : 'Dashed: the longest time without a word to the customer. A ring is a journey that reached its end, a grey square one that ended early, the amber square a journey that is stuck.')}</p>
<dl class="cover-meta">${meta.map(([a, b, c]) => `<div><dt>${a}</dt><dd><b class="tnum">${b}</b>${c}</dd></div>`).join('')}</dl></section>` });
    }

    // summary
    if (!client) {
        const figs = m.summary.figures.map((f, i) => `<div class="fig rise" style="--i:${i}"><p class="n tnum">${esc(f.show)}<small>${esc(f.unit)}</small></p><p>${esc(f.text)}</p></div>`).join('');
        const finds = m.summary.findings.map((f, i) => `<li class="find rise" style="--i:${i + 3}"><span class="k" aria-hidden="true">${i + 1}</span><div><h3>${esc(f.title)}</h3><p>${esc(f.text)}</p></div></li>`).join('');
        chapters.push({ id: 'summary', n: '01', name: 'Summary', html: `<section class="ch" id="summary" aria-labelledby="sum-h"><p class="kicker">01 Summary</p><h2 id="sum-h">${esc(m.summary.headline)}</h2><h3 class="vh">The figures</h3><div class="figs">${figs}</div><h3 class="vh">Three findings</h3><ol class="finds">${finds}</ol></section>` });
    }

    // the journey at a glance, as a table of pills
    {
        const st = m.glance.stages;
        let h = `<table><caption class="vh">${esc(client ? 'Your time and mood at each stage' : `Each of the ${S[1]}: time and mood in each stage`)}</caption><thead><tr><td></td>${st.map(s => `<th scope="col">${esc(s.name)}<small>${esc(days(s.max))}</small></th>`).join('')}</tr></thead><tbody>`;
        m.glance.rows.forEach((r, ri) => {
            const out = r.status === 'completed' ? 'reached the end' : r.status === 'abandoned' ? 'left' : 'stuck';
            h += `<tr><th scope="row">${esc(r.name)}<small>${out} · ${r.days.toFixed(1)} days</small></th>${r.cells.map((c, i) => { if (!c) return '<td><span class="vh">not reached</span></td>'; const stuck = r.stuck && st[i].id === r.stage; return `<td><span class="pill pop ${moodCls(c.mood)}${stuck ? ' stuck' : ''}" style="--i:${ri + i}"><i aria-hidden="true"></i>${stuck ? 'stuck' : esc(fmtH(c.ms))}<span class="vh">, mood ${moodWord(c.mood)} (${c.mood})</span></span></td>`; }).join('')}</tr>`;
        });
        h += '</tbody></table>';
        const stagesTable = client ? '' : chart('The stages, their owners and their times', '', '', [['Stage', 'Owner', 'Given', 'Median', 'Entered', 'Done', 'Stuck', 'Left'], st.map(s => [s.name, s.owner || '', days(s.max), s.median_ms === null || s.median_ms === undefined ? '' : fmtH(s.median_ms), String(s.entered), String(s.completed), String(s.stalled), String(s.abandoned)])]);
        chapters.push({ id: 'glance', n: client ? '02' : '02', name: client ? 'Your stages' : 'At a glance', html: `<section class="ch" id="glance" aria-labelledby="gl-h"><p class="kicker">${client ? '02 Your stages' : '02 The journey at a glance'}</p><h2 id="gl-h">${esc(client ? `${cap(String(st.length))} stages, one journey` : `${st.length} stages, ${m.meta.customers} ${S[1]}`)}</h2><p class="lead">Each row ${client ? 'is your journey' : `is one of the ${esc(S[1])}`}; each pill, a stage it passed through, with the time there and the mood as the stage ended: a word, a number and a colour, never the colour alone.</p><div class="atlas" role="region" aria-label="The stages, one row each; scrolls sideways on a small screen" tabindex="0">${h}</div>${stagesTable}</section>`, after: client });
    }

    // the personas
    m.personas.forEach((p, pi) => {
        const who = `p${pi}`, story = p.story;
        const prose = story.paragraphs.map(par => `<p>${par.map(s => `<span class="beat" data-refs="${s.refs.map(r => `${r.run}-${r.seq}`).join(' ')}">${esc(s.text)}${s.refs.map(r => ref(r, who)).join('')} </span>`).join('')}</p>`).join('');
        const rec = story.record.map(r => `<li id="rec-${who}-${esc(r.run)}-${r.seq}" data-key="${esc(r.run)}-${r.seq}"><b>${esc(r.ref)} · ${esc(new Date(r.t).toISOString().slice(0, 16).replace('T', ' '))}</b>${esc(r.text)}</li>`).join('');
        const color = p.stuck ? T.wait_n : V.nAccent;
        const strip = p.stuck && p.silence && p.silence.open ? (() => { const nd = Math.min(31, Math.max(1, Math.round(p.silence.days))); return `<div class="days" style="--n:${nd}" role="img" aria-label="${esc(`${nd} days without a word to ${p.first}, one square a day, up to the record's last day`)}">${Array.from({ length: nd }, (_, i) => `<span class="${i === nd - 1 ? 'out' : ''}" aria-hidden="true"></span>`).join('')}</div>`; })() : '';
        chapters.push({ id: `voice-${pi}`, n: client ? '01' : '03', name: p.name, html: `<section class="ch night" id="voice-${pi}" aria-labelledby="pv${pi}-h"><p class="kicker" style="color:${color}">${client ? '01 Your journey' : `03 In their own words · ${pi + 1} of ${m.personas.length}`}${p.stuck ? ` · ${esc(p.role)}` : ''}</p>
<div class="persona-head" style="color:${color}"><span class="mono-gram" aria-hidden="true">${esc(p.initials)}</span><div><h2 id="pv${pi}-h" style="color:var(--n-on)">${esc(p.name)}</h2><dl class="facts">${p.facts.map(([a, b]) => `<dt>${esc(a)}</dt><dd>${esc(b)}</dd>`).join('')}</dl></div></div>
<div class="persona"><div class="story">${prose}<p style="font:400 14px/1.5 var(--body);color:var(--n-mute)">${esc(`${p.name}, as the record tells it: ${story.sentences} sentences, ${story.references} references. Told in ${client ? 'your' : 'their'} voice by the dossier’s narrator; every sentence cites the records it rests on.`)}</p></div><aside class="record" aria-label="${esc(`What the record says, for ${p.first}`)}"><h3>What the record says</h3><ol>${rec}</ol></aside></div>
${strip}${story.quote ? `<blockquote class="quote" style="color:${color}"><p style="margin:0">“${esc(story.quote.text)}”</p></blockquote>` : ''}</section>` });
    });
    if (client) { const g = chapters.find(c => c.id === 'glance'); chapters.splice(chapters.indexOf(g), 1); chapters.push(g); }

    // the work
    if (!client) {
        const def = m.work.defined, done = m.work.completed, mx = Math.max(1, ...done.map(r => r.count));
        const COL = { application: 'var(--soft)', ai_agent: 'var(--accent)', human: 'var(--wait)', robot: 'var(--sky)' };
        const ctrl = m.work.controls.map(([a, b, c]) => `<div><h4>${esc(a)}</h4><b>${esc(b)}</b><p>${esc(c)}</p></div>`).join('');
        chapters.push({ id: 'work', n: '04', name: 'The work', html: `<section class="ch" id="work" aria-labelledby="wk-h"><p class="kicker">04 The work behind the journey</p><h2 id="wk-h">${esc(m.work.workflows[0] ? m.work.workflows[0].name : m.meta.journey)}</h2><p class="lead">${esc(m.work.workflows.map(w => `${w.name}: ${w.activities.length} activities${w.bands.length ? ` in ${w.bands.length} bands` : ''}, ${w.runs} runs`).join('. '))}.</p>
${chart('Who does what', bars(done.map(r => ({ label: r.actor, v: r.count, text: String(r.count), col: COL[r.key] })), mx, `Activities completed in the runs: ${done.map(r => `${r.count} by ${r.actor.toLowerCase()}`).join(', ')}`), `${done.map(r => `${r.actor} completed ${r.count}`).join(', ')} of the activities done in the runs; ${def.map(r => `${r.count} defined for ${r.actor.toLowerCase()}`).join(', ')}.`, [['Actor', 'Defined', 'Completed in the runs'], def.map(r => [r.actor, String(r.count), String((done.find(x => x.key === r.key) || {}).count || 0)])])}
<h3 style="margin-top:40px">The controls</h3><div class="controls">${ctrl}</div></section>` });
    }

    // analysis
    if (!client) {
        const A = m.analysis, maxIn = Math.max(1, ...A.funnel.map(s => s.entered));
        const fun = chart(`A · ${cap(S[1])} entering each stage`, bars(A.funnel.map(s => ({ label: s.name, v: s.entered, text: String(s.entered), side: s.side })), maxIn, `${cap(S[1])} entering each stage: ${A.funnel.map(s => `${s.name} ${s.entered}`).join(', ')}`), `${A.funnel[0].entered} entered ${A.funnel[0].name}; ${A.funnel[A.funnel.length - 1].entered} reached ${A.funnel[A.funnel.length - 1].name}.${A.funnel.filter(s => s.lost).map(s => ` ${s.lost} lost or stuck at ${s.name}.`).join('')}`, [['Stage', 'Entered', 'Completed', 'Lost or stuck'], A.funnel.map(s => [s.name, String(s.entered), String(s.completed), String(s.lost)])]);
        const time = chart('B · Time used, of the time each stage is given', bars(A.time.map(s => ({ label: s.name, v: (s.share || 0) * 100, text: `${Math.round((s.share || 0) * 100)}%`, tick: (s.longest_share || 0) * 100, limit: 100 })), 110, `Median time as a share of the time given: ${A.time.map(s => `${s.name} ${Math.round((s.share || 0) * 100)}%`).join(', ')}`), (() => { const t = A.time.slice().sort((a, b) => (b.share || 0) - (a.share || 0))[0]; return t ? `${t.name} takes the time: ${fmtH(t.median_ms)} of its ${days(t.max)} at the median. The tick is the longest stay${A.time.some(s => s.longest_share > 1) ? `; ${A.time.filter(s => s.longest_share > 1).map(s => s.name).join(' and ')} ran past its time once` : ''}.` : ''; })(), [['Stage', 'Given', 'Median', 'Share', 'Longest'], A.time.map(s => [s.name, days(s.max), fmtH(s.median_ms) || '0', `${Math.round((s.share || 0) * 100)}%`, `${fmtH(s.longest_ms)}${s.longest_who ? ', ' + s.longest_who : ''}${s.longest_open ? ', still waiting' : ''}`])]);
        // mood: a line of means, each customer a hollow dot
        const n = A.mood.length, X = i => 70 + i * (820 / Math.max(1, n - 1)), Y = v => 120 - v * 44;
        let ms = [-2, -1, 0, 1, 2].map(v => `<line x1="50" x2="900" y1="${Y(v)}" y2="${Y(v)}" stroke="${v ? V.line : V.lineStrong}"/><text x="40" y="${Y(v) + 4}" text-anchor="end" font-size="13" fill="${V.mute}">${v > 0 ? '+' + v : v}</text>`).join('');
        A.mood.forEach((s, i) => { ms += `<text x="${X(i).toFixed(1)}" y="252" text-anchor="middle" font-size="${n > 7 ? 11 : 13}" fill="${V.soft}">${esc(s.name.length > 14 ? s.name.split(' ')[0] : s.name)}</text>`; const c = {}; s.values.forEach(v => { c[v] = (c[v] || 0) + 1; }); Object.entries(c).forEach(([v, k]) => { for (let j = 0; j < k; j++) ms += `<circle cx="${(X(i) + (j - (k - 1) / 2) * 9).toFixed(1)}" cy="${Y(+v)}" r="3.6" fill="${V.panel}" stroke="${+v >= 0.5 ? V.ok : +v > -0.5 ? V.mute : +v > -1 ? V.wait : V.bad}" stroke-width="1.8"/>`; }); });
        const mm = A.mood.map((s, i) => [i, s.mean]).filter(x => x[1] !== null);
        ms += `<g class="wipe"><polyline points="${mm.map(([i, v]) => `${X(i).toFixed(1)},${Y(v).toFixed(1)}`).join(' ')}" fill="none" stroke="${V.accent}" stroke-width="3" stroke-dasharray="7 5"/>${mm.map(([i, v]) => `<circle cx="${X(i).toFixed(1)}" cy="${Y(v).toFixed(1)}" r="5" fill="${V.accent}"/>`).join('')}</g>`;
        const mood = chart('C · Mood at the end of each stage, −2 to +2', `<svg viewBox="0 0 920 262" role="img" aria-label="${esc(`Mean mood at the end of each stage: ${A.mood.map(s => `${s.name} ${s.mean === null ? 'no value' : s.mean}`).join(', ')}. ${A.mood_said ? A.mood_said + ' changes said' : 'All inferred by rule.'}`)}" style="width:100%;height:auto;display:block">${ms}</svg>`, A.mood_said ? `${A.mood_said} of ${A.mood_changes} changes of mood were said by the customers; the rest were inferred by the journey’s rules.` : `Every change of mood was inferred by the journey’s rules (0 of ${A.mood_changes} said): the line is dashed until customers are asked.`, [['Stage', 'Mean', 'Customers', 'Lowest'], A.mood.map(s => [s.name, s.mean === null ? 'no value' : String(s.mean), String(s.n), s.min === null ? '' : String(s.min)])]);
        const ppl = A.people.length ? chart('D · Where people step in, and how long they were waited for', bars(A.people.map(p => ({ label: `${p.first} · ${p.who}`, v: (p.waited_ms || 0) / H, text: `${((p.waited_ms || 0) / H).toFixed(1)} h${p.refused ? ' ✕' : ''}`, col: 'var(--wait)' })), Math.max(1, ...A.people.map(p => (p.waited_ms || 0) / H)), `${A.people.length} decisions by people, with the hours each waited`), `${A.people.length} decisions by ${new Set(A.people.map(p => p.who)).size} people.${A.people.some(p => p.refused) ? ` ✕: the task first went to someone the policy refused (${A.people.filter(p => p.refused).length}).` : ''}`, [['Customer', 'Step', 'Who', 'Waited', 'Refused first'], A.people.map(p => [p.name, p.step, p.who, `${((p.waited_ms || 0) / H).toFixed(1)} h`, p.refused ? `${p.refused.who}, ${String(p.refused.reason).replace(/_/g, ' ')}` : ''])]) : '';
        const cost = A.cost ? chart('E · Where the model tokens go', bars(A.cost.tokens.map(t => ({ label: t.activity, v: t.tokens, text: t.tokens.toLocaleString('en-US') })), Math.max(1, ...A.cost.tokens.map(t => t.tokens)), `Model tokens by activity, ${A.cost.tokens_total.toLocaleString('en-US')} in all`), `${A.cost.tokens_total.toLocaleString('en-US')} model tokens in all; the period cost ${A.cost.total.toFixed(2)} ${m.meta.currency || ''} in models and tools, ${A.cost.per_journey.toFixed(3)} per journey. People’s time is not costed.`, [['Activity', 'Tokens', 'Share'], A.cost.tokens.map(t => [t.activity, t.tokens.toLocaleString('en-US'), `${(t.tokens / A.cost.tokens_total * 100).toFixed(1)}%`])]) : '';
        chapters.push({ id: 'analysis', n: '05', name: 'Analysis', html: `<section class="ch" id="analysis" aria-labelledby="an-h"><p class="kicker">05 Analysis</p><h2 id="an-h">Where the days go, and how it felt</h2>${fun}${time}${mood}${ppl}${cost}</section>` });
    }

    // recommendations
    {
        const R = m.recommendations.list, ymax = Math.max(2, Math.ceil(Math.max(0, ...R.map(r => r.impact)) * 2) / 2);
        const W = 560, Hh = 480, X = e => 60 + (e - 0.4) / 3.2 * (W - 90), Y = v => Hh - 50 - v / ymax * (Hh - 90);
        let s = `<rect x="44" y="20" width="${(X(2.5) - 44).toFixed(1)}" height="${(Y(1) - 20).toFixed(1)}" fill="${V.tint}"/><text x="54" y="40" font-size="13" font-weight="700" fill="${V.accentText}" letter-spacing="1.5">DO FIRST</text><text x="${W - 16}" y="40" text-anchor="end" font-size="13" font-weight="700" fill="${V.mute}" letter-spacing="1.5">PLAN</text><text x="54" y="${Hh - 58}" font-size="13" font-weight="700" fill="${V.mute}" letter-spacing="1.5">QUICK FIXES</text><text x="${W - 16}" y="${Hh - 58}" text-anchor="end" font-size="13" font-weight="700" fill="${V.mute}" letter-spacing="1.5">LATER</text>`;
        [[1, 'low'], [2, 'medium'], [3, 'high']].forEach(([e, l]) => { s += `<text x="${X(e).toFixed(1)}" y="${Hh - 22}" text-anchor="middle" font-size="13" fill="${V.mute}">${l}</text>`; });
        s += `<text x="${W / 2}" y="${Hh - 4}" text-anchor="middle" font-size="12" font-weight="700" fill="${V.mute}" letter-spacing="1.5">EFFORT →</text>`;
        const byE = {}; R.forEach(r => (byE[r.effort] = byE[r.effort] || []).push(r));
        for (const [e, list] of Object.entries(byE)) list.forEach((r, k) => { const cx = X(+e) + (k - (list.length - 1) / 2) * 40, cy = Y(r.impact), size = 22 + Math.sqrt(r.customers) * 8; s += `<g class="pop" style="--i:${r.rank}"><svg x="${(cx - size / 2).toFixed(1)}" y="${(cy - size / 2).toFixed(1)}" width="${size.toFixed(1)}" height="${size.toFixed(1)}" viewBox="0 0 100 100" overflow="visible"><g fill="var(--k-${r.kind})" stroke="var(--panel)" stroke-width="5">${SHAPE[r.kind] || SHAPE.speed}</g></svg><text x="${(cx + size / 2 + 3).toFixed(1)}" y="${(cy - size / 2 + 4).toFixed(1)}" font-size="15" font-weight="700" fill="${V.text}">${r.rank}</text></g>`; });
        const alt = `Impact against effort: ${R.map(r => `${r.rank}, ${r.kind}, impact ${r.impact}, effort ${r.effort}`).join('; ')}.`;
        const list = R.map(r => `<li><span class="no" aria-hidden="true">${r.rank}</span><div><h3><span class="vh">${r.rank}. </span>${esc(r.title)}</h3><p>${esc(r.finding)}</p><p><b style="font-weight:600;color:var(--text)">Action.</b> ${esc(r.action)}</p><p class="meta">${esc(r.kind)} · ${esc(r.stage)} · ${esc(r.owner || '')} · impact ${r.impact}, effort ${r.effort} · ${esc(METHOD[r.method] || r.method)}: ${esc(r.effect)}</p></div></li>`).join('');
        chapters.push({ id: 'recs', n: client ? '03' : '06', name: client ? 'For next time' : 'Recommendations', html: `<section class="ch" id="recs" aria-labelledby="rc-h"><p class="kicker">${client ? '03 For next time' : '06 Recommendations'}</p><h2 id="rc-h">${client ? 'What we recommend, and why' : 'What to change, in order'}</h2><p class="lead">${esc(R.length ? `${R.length} recommendation${R.length === 1 ? '' : 's'}, computed from the record by twelve rules and the journey’s options; each with its evidence, its owner and how its effect is known.` : 'No recommendation: every rule was checked and none fired.')}</p>
<div class="recbook"><div><svg class="mini-map" viewBox="0 0 ${W} ${Hh}" role="img" aria-label="${esc(alt)}">${s}</svg><p style="font-size:13.5px;color:var(--mute)">Mark size: customers concerned. Shape: the kind. Impact = customers concerned ÷ ${m.meta.customers} × severity; effort 1 to 3.</p></div><ol class="rlist">${list}</ol></div>${m.recommendations.empty.length && !client ? `<p style="color:var(--mute)">${esc(`No recommendation for ${m.recommendations.empty.join(', ')}: every check passed.`)}</p>` : ''}</section>` });
    }

    // appendix
    {
        const C = m.compliance;
        const ev = C && !client ? chart('The EU AI Act and the record', '', 'The mapping is informative: it says a record is relevant to an obligation, never that the obligation is met.', [['Provision', 'What it asks for', 'Report part', 'In this record'], C.rows.map(r => [r.provision, r.asks, r.parts.join(', '), r.holds])]).replace('hidden role="region"', 'role="region"').replace('aria-expanded="false"', 'aria-expanded="true"').replace('>Show the table<', '>Hide the table<') : '';
        const gl = m.glossary.map(t => `<div><dt>${esc(t.term)}</dt><dd>${esc(t.definition)} <span style="color:var(--mute)">${esc(t.see || '')}</span></dd></div>`).join('');
        chapters.push({ id: 'appendix', n: client ? '04' : '07', name: 'Appendix', html: `<section class="ch" id="appendix" aria-labelledby="ap-h"><p class="kicker">${client ? '04 Your record and these words' : '07 Appendix'}</p><h2 id="ap-h">${client ? 'How this dossier was made' : C ? 'The EU AI Act and the record' : 'Words, method and sources'}</h2>${C ? `<p class="notice"><b>Evidence, not a certification.</b> ${esc(client ? 'The organisation keeps an evidence report of the whole system; a client edition shows only your own journey.' : C.notice)}</p>` : ''}${ev}
<h3 style="margin-top:44px">Glossary</h3><dl class="gloss">${gl}</dl>
<h3 style="margin-top:44px">Method</h3>${m.method.map(t => `<p style="color:var(--soft);max-width:72ch">${esc(t)}</p>`).join('')}
<h3 style="margin-top:32px">Sources</h3><p style="color:var(--soft)">${esc(m.sources.join('; '))}. As of ${esc(m.meta.as_of_text)} UTC.</p></section>` });
    }

    const brandMark = T.logo ? `<img src="${esc(T.logo)}" alt="">` : `<span class="logo" aria-hidden="true">${esc(T.name[0])}</span>`;
    const rail = chapters.map(c => `<li><a href="#${c.id}"><span>${c.n}</span><span>${esc(c.name)}</span></a></li>`).join('');
    const script = `(() => {'use strict';
const root = document.documentElement, mq = matchMedia('(prefers-reduced-motion: reduce)');
const still = () => mq.matches || root.classList.contains('still');
const $$ = s => [...document.querySelectorAll(s)];
$$('[data-table]').forEach(b => b.addEventListener('click', () => { const t = document.getElementById(b.dataset.table), open = t.hidden; t.hidden = !open; b.setAttribute('aria-expanded', String(open)); b.textContent = open ? 'Hide the table' : 'Show the table'; }));
function countUp(el) { const to = parseFloat(el.dataset.to), txt = el.textContent; el.setAttribute('aria-hidden', 'true'); if (!el.nextElementSibling || !el.nextElementSibling.classList.contains('vh')) el.insertAdjacentHTML('afterend', '<span class="vh">' + txt + '</span>'); const t0 = performance.now(); const f = now => { const p = Math.min(1, (now - t0) / 600), v = to * (1 - Math.pow(1 - p, 3)); el.textContent = p < 1 ? (el.dataset.sep ? Math.round(v).toLocaleString('en-US') : String(Math.round(v))) : txt; if (p < 1) requestAnimationFrame(f); }; requestAnimationFrame(f); }
const io = new IntersectionObserver(es => es.forEach(e => { if (!e.isIntersecting) return; io.unobserve(e.target); if (still()) return; e.target.classList.add('play'); e.target.querySelectorAll('.count-up').forEach(countUp); }), { threshold: .15 });
$$('.ch, figure.chart').forEach(s => io.observe(s));
const beatIO = new IntersectionObserver(es => es.forEach(e => { if (e.isIntersecting) { beatIO.unobserve(e.target); if (!still()) e.target.classList.add('play'); } }), { rootMargin: '0px 0px -18% 0px' });
$$('.beat').forEach(b => beatIO.observe(b));
const links = $$('nav.rail a').map(a => [a, document.getElementById(a.hash.slice(1))]).filter(x => x[1]);
const prog = document.getElementById('prog');
function onScroll() { const y = innerHeight * .35; let cur = links[0] && links[0][0]; for (const [a, s] of links) if (s.getBoundingClientRect().top < y) cur = a; links.forEach(([a]) => { if (a === cur) a.setAttribute('aria-current', 'true'); else a.removeAttribute('aria-current'); }); if (prog) prog.style.setProperty('--p', (scrollY / Math.max(1, root.scrollHeight - innerHeight)).toFixed(3));
  $$('.story').forEach(st => { let best = null, bd = 1e9; st.querySelectorAll('.beat').forEach(b => { const r = b.getBoundingClientRect(), d = Math.abs(r.top + r.height / 2 - innerHeight * .45); if (d < bd && r.bottom > 0 && r.top < innerHeight) { bd = d; best = b; } }); const keys = best ? best.dataset.refs.split(' ') : []; const list = st.parentElement.querySelectorAll('aside.record li'); list.forEach(li => li.setAttribute('aria-current', keys.includes(li.dataset.key) ? 'true' : 'false')); }); }
addEventListener('scroll', () => requestAnimationFrame(onScroll), { passive: true }); onScroll();
requestAnimationFrame(() => { const c = document.getElementById('cover'); if (!c) return; io.unobserve(c); if (!still()) { c.classList.add('play'); c.querySelectorAll('.count-up').forEach(countUp); } });
const mb = document.getElementById('motion');
function setMotion(on) { root.classList.toggle('still', !on); mb.setAttribute('aria-pressed', String(on)); try { localStorage.setItem('awa-dossier-motion', on ? '1' : '0'); } catch (e) { /* nothing kept */ } }
mb.addEventListener('click', () => setMotion(root.classList.contains('still')));
if (mq.matches) mb.setAttribute('aria-pressed', 'false');
try { if (localStorage.getItem('awa-dossier-motion') === '0') setMotion(false); } catch (e) { /* nothing kept */ }
})();`;
    return `<!doctype html>
<html lang="${esc(m.lang || 'en')}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(m.meta.title)}</title>
<meta name="description" content="${esc(m.meta.lead)}">
<meta name="generator" content="AWA dossier, ${m.edition} edition">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&amp;family=Space+Grotesk:wght@500;600;700&amp;family=Newsreader:ital,opsz,wght@0,6..72,400;1,6..72,400&amp;family=JetBrains+Mono:wght@500&amp;display=swap">
<style>${css(V, T)}</style>
</head>
<body>
<a class="skip" href="#content">Skip to the dossier</a>
<header class="bar"><span class="brand">${brandMark}<span class="word">${esc(T.name)}</span></span><span class="ed">${esc(m.meta.journey)} · ${client ? 'client' : 'professional'} edition</span><span class="spacer"></span><button class="btn" id="motion" type="button" aria-pressed="true"><span class="sw" aria-hidden="true"></span>Motion</button></header>
<div class="doss">
<nav class="rail" aria-label="Chapters"><h2>${esc(m.meta.journey)}</h2><ol>${rail}</ol><div class="progress" aria-hidden="true"><i id="prog"></i></div>${client ? '' : '<p class="reading"><b>5 minutes</b>: Summary, then Recommendations.<br><b>40 minutes</b>: in order.<br><b>Audit</b>: Appendix, then any reference.</p>'}</nav>
<main id="content" tabindex="-1">
${chapters.map(c => c.html).join('\n')}
<footer class="foot"><p>${esc(`${m.meta.title}. ${m.meta.source ? `Computed from ${m.meta.source}. ` : ''}${m.meta.fictional} Every sentence a customer says cites the records it rests on.`)}</p></footer>
</main>
</div>
<script>${script.replace(/<\/script/gi, '<\\/script')}</script>
</body>
</html>
`;
}

const api = { render, screen };
root.AWA_DOSSIER_HTML = api;
if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
