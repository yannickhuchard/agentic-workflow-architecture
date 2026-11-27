// The dossier's print layout: the pages of the design (A4 portrait, 794 × 1123 px at 96 px per inch), night pages and
// paper pages, running heads and folios, varied layouts, for Chromium to print as a tagged PDF. It renders the model of
// awa-dossier.js; it computes nothing itself. Headings are real headings (they become the PDF's bookmarks), tables have
// header rows, every chart has a text alternative and its numbers in a table or in the text, and what only decorates
// (running heads, folios, monograms, lines) is hidden from assistive technology so that Chromium marks it as an artifact.
//
//   const { render } = require('./awa-dossier-print.js');
//   const html = render(model, { theme: AWA_DOSSIER.theme(brand) });
(function (root) {
'use strict';

const DAY = 86400000, H = 3600000;
const esc = s => String(s === null || s === undefined ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const col = k => 64 + (k - 1) * 57, span = n => n * 57 - 18;
const P = (x, y, w, cls, inner, extra = '', tag = 'div') => `<${tag} class="abs ${cls}" style="left:${x}px;top:${y}px;width:${w}px;${extra}">${inner}</${tag}>`;
const box = (x, y, w, inner, extra = '') => `<div class="abs" style="left:${x}px;top:${y}px;width:${w}px;${extra}">${inner}</div>`;
const fmtH = ms => ms === null || ms === undefined ? '' : ms === 0 ? '0' : ms < H ? `${Math.round(ms / 60000)} min` : ms < 48 * H ? `${String(Math.round(ms / H * 10) / 10).replace(/\.0$/, '')} h` : `${(ms / DAY).toFixed(1)} d`;
const days = p => (p ? String(p).replace(/^P(\d+)D$/, '$1 days').replace(/^P/, '') : 'no limit');
const ref = r => `<span class="ref">${esc(typeof r === 'string' ? r : `${r.run}·${r.seq}`)}</span>`;
const refs = list => (list || []).map(ref).join('');
const word = n => ['no', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve'][n] || String(n);
const Word = n => { const w = word(n); return w[0].toUpperCase() + w.slice(1); };
const MOOD = (T, v) => v === null || v === undefined ? T.ink3 : v >= 0.5 ? T.ok : v > -0.5 ? T.ink3 : v > -1 ? T.wait : T.bad;
const kindShape = (k, cx, cy, r, fill, stroke = 'none', sw = 0) => {
    const s = stroke !== 'none' ? ` stroke="${stroke}" stroke-width="${sw}"` : '';
    if (k === 'quality') return `<rect x="${cx - r * 0.86}" y="${cy - r * 0.86}" width="${r * 1.72}" height="${r * 1.72}" rx="${r * 0.25}" fill="${fill}"${s}/>`;
    if (k === 'cost') return `<path d="M${cx} ${cy - r} L${cx + r} ${cy} L${cx} ${cy + r} L${cx - r} ${cy}Z" fill="${fill}"${s}/>`;
    if (k === 'trust') { const p = [0, 1, 2, 3, 4, 5].map(i => { const a = Math.PI / 3 * i - Math.PI / 2; return `${(cx + r * Math.cos(a)).toFixed(1)},${(cy + r * Math.sin(a)).toFixed(1)}`; }).join(' '); return `<polygon points="${p}" fill="${fill}"${s}/>`; }
    if (k === 'experience') return `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${fill}"${s}/><circle cx="${cx}" cy="${cy}" r="${r * 0.42}" fill="none" stroke="#fff" stroke-width="${Math.max(1.5, r * 0.22)}"/>`;
    return `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${fill}"${s}/>`;
};
const METHOD = { replay: 'Replay', measured: 'Measured', estimate: 'Estimate', pilot: 'Pilot', 'replay-live': 'Replay, not run' };

function css(T) {
    const vars = Object.entries(T).filter(([, v]) => typeof v === 'string' && /^#/.test(v)).map(([k, v]) => `--${k}:${v}`).join(';');
    const D = `'${T.display}', 'Space Grotesk', Inter, system-ui, sans-serif`, B = `'${T.body}', Inter, system-ui, sans-serif`;
    return `@page{size:A4;margin:0}
html,body{margin:0;padding:0;background:#fff}
:root{${vars}}
.pg{position:relative;width:794px;height:1123px;overflow:hidden;background:var(--paper);color:var(--ink);font:400 14px/20px ${B};font-feature-settings:"cv11";break-after:page;page-break-after:always;-webkit-print-color-adjust:exact;print-color-adjust:exact}
.pg:last-child{break-after:auto;page-break-after:auto}
.pg.night{background:var(--night);color:var(--on)}
.pg *{box-sizing:border-box}
h1,h2,h3,h4,p,ol,ul,figure,table{margin:0;padding:0}
h1,h2,h3,h4{white-space:pre-wrap}
.abs{position:absolute}
.rh{position:absolute;left:64px;right:64px;top:30px;display:flex;justify-content:space-between;font:600 11.5px/14px ${B};letter-spacing:.12em;text-transform:uppercase;color:var(--ink3)}
.night .rh,.night .fo{color:var(--on3)}
.fo{position:absolute;left:64px;right:64px;bottom:34px;display:flex;justify-content:space-between;align-items:baseline;font:500 11.5px/14px ${B};color:var(--ink3)}
.fo b{font:600 14px/14px ${D};color:var(--ink)}
.night .fo b{color:var(--on)}
.ov{font:600 11.5px/14px ${B};letter-spacing:.12em;text-transform:uppercase;color:var(--accent)}
.night .ov{color:var(--acc_n)}
.d1{font:600 72px/70px ${D};letter-spacing:-.03em}
.d2{font:600 48px/50px ${D};letter-spacing:-.025em}
.h1{font:600 32px/37px ${D};letter-spacing:-.015em}
.h2{font:600 20px/26px ${D};letter-spacing:-.005em}
.h3{font:600 15px/20px ${B}}
.lead{font:400 16px/24px ${B};color:var(--ink2)}
.night .lead{color:var(--on2)}
.body{font:400 14px/20px ${B};color:var(--ink2)}
.night .body{color:var(--on2)}
.small{font:400 12px/16px ${B};color:var(--ink2)}
.night .small{color:var(--on2)}
.cap{font:400 11.5px/15px ${B};color:var(--ink3)}
.night .cap{color:var(--on3)}
.lab{font:600 11.5px/14px ${B};letter-spacing:.12em;text-transform:uppercase;color:var(--ink3)}
.night .lab{color:var(--on3)}
.num3{font:600 26px/28px ${D};letter-spacing:-.02em;font-variant-numeric:tabular-nums}
.voice{font:400 17px/27px Newsreader,Georgia,serif;font-variation-settings:"opsz" 16;color:var(--on)}
.voice p{margin:0 0 12px}
.quote{font:italic 400 32px/40px Newsreader,Georgia,serif;font-variation-settings:"opsz" 48;letter-spacing:-.01em}
.ref{font:500 11px/14px 'JetBrains Mono',ui-monospace,monospace;color:var(--accent);white-space:nowrap}
.night .ref{color:var(--acc_n)}
.voice .ref{margin-left:5px;vertical-align:2px}
.ref + .ref{margin-left:6px}
.tnum{font-variant-numeric:tabular-nums}
.rule{height:1px;background:var(--rule)}
table.t{border-collapse:collapse;width:100%;font:400 12px/16px ${B};font-variant-numeric:tabular-nums;color:var(--ink2)}
table.t th{font:600 11px/14px ${B};letter-spacing:.06em;text-transform:uppercase;color:var(--ink3);text-align:left;padding:0 8px 6px 0;border-bottom:1.5px solid var(--ink)}
table.t tbody th{font:600 12px/16px ${B};letter-spacing:0;text-transform:none;color:var(--ink);border-bottom:1px solid var(--rule);padding:6px 8px 6px 0;vertical-align:top}
table.t td{padding:6px 8px 6px 0;border-bottom:1px solid var(--rule);vertical-align:top}
table.t .r{text-align:right}
table.t td b{color:var(--ink);font-weight:600}
table.t caption{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0)}
.sum{border-left:3px solid var(--accent);padding:2px 0 2px 12px}
.vh{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}
svg text{font-family:${B}}`;
}

function shell(T, m, pages) {
    return `<!doctype html>
<html lang="${esc(m.lang || 'en')}">
<head>
<meta charset="utf-8">
<title>${esc(m.meta.title)}</title>
<meta name="description" content="${esc(m.meta.lead)}">
<meta name="author" content="${esc(T.name)}">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&amp;family=Space+Grotesk:wght@500;600;700&amp;family=Newsreader:ital,opsz,wght@0,6..72,400;1,6..72,400&amp;family=JetBrains+Mono:wght@500&amp;display=block">
<style>${css(T)}</style>
</head>
<body>
<main>
${labelled(pages.join('\n'))}
</main>
</body>
</html>
`;
}

/** Headings carry their text as a label, so that a heading that wraps, or is set in capitals, gives a clean bookmark */
const labelled = html => html.replace(/<(h[1-4])([^>]*)>([\s\S]*?)<\/\1>/g, (m, tag, attrs, inner) => {
    if (/aria-label=/.test(attrs)) return m;
    const text = inner.replace(/<br\s*\/?>/g, ' ').replace(/<span class="vh">[^<]*<\/span>/g, '').replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();
    return `<${tag}${attrs} aria-label="${esc(text)}">${inner}</${tag}>`;
});

/** Render the print layout of a dossier */
function render(m, opts = {}) {
    const T = opts.theme || (root.AWA_DOSSIER || (typeof require === 'function' ? require('./awa-dossier.js') : {})).AWA_THEME;
    const client = m.edition === 'client';
    const head = (left, right) => `<div class="rh" aria-hidden="true"><span>${esc(left)}</span><span>${esc(right === undefined ? `${m.meta.journey} · dossier` : right)}</span></div>`;
    let folioN = 0;
    const folio = side => { folioN++; const n = String(folioN).padStart(2, '0'); return `<div class="fo" aria-hidden="true">${side === 'left' ? `<b class="tnum">${n}</b><span>Period ${esc(m.meta.period.text)}</span>` : `<span>Period ${esc(m.meta.period.text)}</span><b class="tnum">${n}</b>`}</div>`; };
    const page = (inner, night, label, style = '') => `<section class="pg${night ? ' night' : ''}" aria-label="${esc(label)}"${style ? ` style="${style}"` : ''}>${inner}</section>`;
    const pages = [];
    const N = m.meta.customers, S = m.meta.subject;
    const personas = m.personas;

    // ------------------------------------------------------------ 1 cover: the customers as lines as long as their days
    {
        folioN++;
        const lines = m.cover.lines, maxDays = Math.max(28, ...lines.map(l => l.days)) + 1;
        const x0 = 104, x1 = 732, sc = (x1 - x0) / maxDays, n = lines.length, y0 = client ? 520 : 438, dy = Math.min(46, Math.floor(380 / Math.max(1, n)));
        const ox = 40, oy = y0 + dy * (n - 1) / 2;
        const featuredCol = l => (l.stuck ? T.wait_n : T.acc_n);
        let svg = '';
        const ticks = []; for (let t = 0; t <= maxDays; t += maxDays > 120 ? 30 : maxDays > 60 ? 14 : 7) ticks.push(t);
        for (const t of ticks) { const x = x0 + t * sc; svg += `<line x1="${x.toFixed(1)}" y1="${y0 - 34}" x2="${x.toFixed(1)}" y2="${y0 + dy * (n - 1) + 30}" stroke="rgba(255,255,255,.09)"/><text x="${x.toFixed(1)}" y="${y0 + dy * (n - 1) + 50}" fill="${T.on3}" font-size="11.5" text-anchor="middle">${t ? t : 'day 0'}</text>`; }
        if (m.meta.promise) { const x = x0 + m.meta.promise.days * sc; svg += `<line x1="${x.toFixed(1)}" y1="${y0 - 34}" x2="${x.toFixed(1)}" y2="${y0 + dy * (n - 1) + 30}" stroke="${T.wait_n}" stroke-width="1.5" stroke-dasharray="4 5"/><text x="${(x + 8).toFixed(1)}" y="${y0 - 22}" fill="${T.wait_n}" font-weight="600" font-size="11.5">${m.meta.promise.days} days, the promise</text>`; }
        const desc = [];
        lines.forEach((l, i) => {
            const y = y0 + i * dy, feat = l.featured, colr = feat ? featuredCol(l) : T.on3, sw = feat ? 3 : 1.8, xe = x0 + l.days * sc;
            svg += `<path d="M${ox} ${oy} C ${ox + 34} ${oy}, ${x0 - 30} ${y}, ${x0} ${y}" fill="none" stroke="${colr}" stroke-width="${sw}" stroke-linecap="round" opacity="${feat ? 1 : 0.8}"/>`;
            if (l.silence) {
                const xs = x0 + l.silence.from_days * sc, xt = Math.min(xe, x0 + l.silence.to_days * sc);
                svg += `<line x1="${x0}" y1="${y}" x2="${xs.toFixed(1)}" y2="${y}" stroke="${colr}" stroke-width="${sw}" stroke-linecap="round"/><line x1="${xs.toFixed(1)}" y1="${y}" x2="${xt.toFixed(1)}" y2="${y}" stroke="${colr}" stroke-width="${sw}" stroke-dasharray="2 6" stroke-linecap="round"/>`;
                if (xt < xe) svg += `<line x1="${xt.toFixed(1)}" y1="${y}" x2="${xe.toFixed(1)}" y2="${y}" stroke="${colr}" stroke-width="${sw}" stroke-linecap="round"/>`;
                svg += `<circle cx="${xs.toFixed(1)}" cy="${y}" r="3.2" fill="${T.night}" stroke="${colr}" stroke-width="1.6"/>`;
            } else svg += `<line x1="${x0}" y1="${y}" x2="${Math.max(xe, x0 + 3).toFixed(1)}" y2="${y}" stroke="${colr}" stroke-width="${sw}" stroke-linecap="round"/>`;
            if (l.status === 'completed') svg += `<circle cx="${xe.toFixed(1)}" cy="${y}" r="5.5" fill="${T.night}" stroke="${T.ok_n}" stroke-width="2.2"/><circle cx="${xe.toFixed(1)}" cy="${y}" r="2" fill="${T.ok_n}"/>`;
            else if (l.status === 'abandoned') svg += `<rect x="${(xe - 4).toFixed(1)}" y="${y - 5}" width="10" height="10" rx="1.5" fill="${T.on3}"/>`;
            else svg += `<rect x="${(xe - 5).toFixed(1)}" y="${y - 6}" width="12" height="12" rx="2" fill="${T.wait_n}"/>`;
            const label = l.status === 'completed' ? `${l.days.toFixed(1)} d` : l.status === 'abandoned' ? 'left' : `${l.days.toFixed(1)} d, waiting`;
            if (l.name) svg += `<text x="${x0 + 8}" y="${y - 9}" fill="${feat ? T.on : T.on2}" font-size="12" font-weight="${feat ? 600 : 500}">${esc(l.name)}</text>`;
            svg += `<text x="${(xe + 12).toFixed(1)}" y="${y + 4}" fill="${feat ? T.on : T.on2}" font-family="'${T.display}', 'Space Grotesk', sans-serif" font-size="12.5" font-weight="500">${label}</text>`;
            desc.push(`${l.name || (client ? 'a colleague' : 'a customer')}: ${label}`);
        });
        svg += `<circle cx="${ox}" cy="${oy}" r="5" fill="${T.acc_n}"/>`;
        const chart = `<svg class="abs" style="left:0;top:0" width="794" height="1123" viewBox="0 0 794 1123" role="img" aria-label="${esc(`${Word(N)} ${S[1]}, each a line as long as their days: ${desc.join('; ')}.${m.meta.promise ? ` ${lines.filter(l => l.days > m.meta.promise.days).length} pass the ${m.meta.promise.days}-day promise.` : ''}`)}">${svg}</svg>`;
        const brandMark = T.logo ? `<img src="${esc(T.logo)}" alt="" style="height:28px;vertical-align:middle">` : `<span style="font:700 20px/20px '${T.display}';letter-spacing:-.01em">${esc(T.name === 'AWA' ? 'AWA' : T.name)}</span>`;
        const meta = client
            ? [['For', esc(m.meta.client.name)], ['Journey', esc(m.meta.journey)], ['Period', esc(m.meta.period.text)], ['Edition', 'Client: your journey only']]
            : [['Scope', `1 journey · ${m.meta.workflows.length} workflow${m.meta.workflows.length === 1 ? '' : 's'}<br>${N} ${esc(S[1])} · ${m.meta.runs} runs`], ['Period', esc(m.meta.period.text).replace(' to ', ' to<br>')], ['Record as of', `${esc(m.meta.as_of_text)}<br>${m.meta.run_events.toLocaleString('en-US')} run events, ${m.meta.journey_events} journey events`], ['Edition', 'Professional: with cost, agents and every customer']];
        const inner = chart
            + P(64, 44, 360, '', `${brandMark}<span class="cap" style="margin-left:10px">${esc(T.tagline || '')}</span>`, '', 'div')
            + P(430, 47, 300, 'lab', `Dossier · ${client ? 'client' : 'professional'} edition`, 'text-align:right')
            + P(64, 112, 640, 'ov', client ? `Your ${esc(m.meta.journey.toLowerCase())}` : 'A dossier on one journey and the work behind it', '', 'p')
            + P(62, 138, 680, 'd1', esc(client ? `${m.meta.client.name}` : m.meta.journey), m.meta.journey.length > 26 && !client ? 'font-size:58px;line-height:60px' : '', 'h1')
            + P(64, client ? 220 : 290, span(9), 'lead', esc(client ? `Every step you took with us, in your words and in the record: what you chose, what was checked, and what we recommend for next time.` : m.meta.lead), 'color:var(--on2)', 'p')
            + P(64, y0 + dy * (n - 1) + 74, span(10), 'cap', esc(client ? 'Your line, among the others’, who are not named. A client edition leaves out our internal costs, how our agents work inside, and other customers’ data.' : `Each line is one of the ${S[1]}, as long as its days with us. Dashed: the longest time without a word to them. A ring is a journey that reached its end, a grey square one that ended early, the amber square a journey that is stuck.`), '', 'p')
            + `<div class="abs" aria-hidden="true" style="left:64px;top:930px;width:666px;height:1px;background:rgba(255,255,255,.14)"></div>`
            + `<dl class="abs" style="left:64px;top:952px;width:666px;display:grid;grid-template-columns:repeat(4,1fr);gap:18px;margin:0">${meta.map(([a, b]) => `<div><dt class="lab" style="margin-bottom:6px">${a}</dt><dd class="small" style="color:var(--on2);margin:0">${b}</dd></div>`).join('')}</dl>`
            + P(64, 1060, 666, 'cap', esc(`${m.meta.source ? `Computed from ${m.meta.source}. ` : ''}${m.meta.fictional}`), '', 'p');
        pages.push(page(inner, true, 'Cover'));
    }

    // ------------------------------------------------------------ 2 contents and reading paths
    {
        const ch = m.contents;
        const pageOf = { summary: 3, glance: 4, voices: 5, work: 5 + personas.length * 2, analysis: 6 + personas.length * 2, recommendations: 8 + personas.length * 2, appendix: 9 + personas.length * 2 };
        const cpage = { voices: 3, glance: 3 + personas.length * 2, recommendations: 4 + personas.length * 2, appendix: 5 + personas.length * 2 };
        const pg2 = id => String((client ? cpage : pageOf)[id] || '').padStart(2, '0');
        let rows = '';
        ch.forEach((c, i) => {
            const y = (client ? 330 : 486) + i * 74;
            rows += `<li class="abs" style="left:64px;top:${y}px;width:666px;height:66px;list-style:none"><span class="abs" aria-hidden="true" style="left:0;top:0;font:500 44px/44px '${T.display}';letter-spacing:-.03em;color:var(--accent)">${c.n}</span>`
                + `<h3 class="abs h2" style="left:${col(3) - 64}px;top:2px;width:${span(8)}px"><span class="vh">${c.n} </span>${esc(c.title)}</h3><p class="abs small" style="left:${col(3) - 64}px;top:30px;width:${span(8)}px">${esc(c.sub)}</p>`
                + `<span class="abs tnum" style="left:${col(11) - 64}px;top:4px;width:${span(2)}px;text-align:right;font:500 20px/26px '${T.display}'"><span class="vh">page </span>${pg2(c.id)}</span><span class="abs rule" aria-hidden="true" style="left:${col(3) - 64}px;top:60px;width:${span(10)}px"></span></li>`;
        });
        const paths = client ? [] : [['5 minutes', 'Decide', 'For a director or a client who decides what to change.', 'Summary, then Recommendations', `${pg2('summary')} · ${pg2('recommendations')}`, 'var(--accent)'],
            ['40 minutes', 'Improve', 'For the people who run the journey and the work.', 'The whole book, in order', `${pg2('summary')} to ${pg2('recommendations')}`, 'var(--ok)'],
            ['Open-ended', 'Verify', 'For an auditor or a risk officer.', 'The appendix, then any reference into the record', `${pg2('appendix')} · the journal`, 'var(--run)']];
        const cards = paths.map((p, i) => `<div class="abs" style="left:${col(1 + i * 4)}px;top:176px;width:${span(4)}px;height:236px;border-top:3px solid ${p[5]};padding-top:14px"><p class="lab" style="color:${p[5]}">${p[0]}</p><h3 class="h1" style="margin-top:10px">${p[1]}</h3><p class="body" style="margin-top:8px">${p[2]}</p><p class="small" style="margin-top:12px;color:var(--ink)">${p[3]}</p><p style="margin-top:10px;font:500 13px/18px 'JetBrains Mono';color:${p[4] ? p[5] : ''}">p. ${p[4]}</p></div>`).join('');
        const firstRef = personas[0] && personas[0].story.record.find(r => r.run !== 'J');
        const inner = head('Contents', '')
            + P(64, 84, 600, 'ov', client ? 'Inside' : 'How to read this dossier', '', 'p')
            + P(64, 108, 666, 'h1', client ? 'Your journey, and the record underneath' : 'Three ways in, one record underneath', '', 'h2')
            + (client ? P(64, 176, span(10), 'lead', 'Each page tells part of your journey in your words, with the records it rests on beside it. Nothing here is about anyone else.', '', 'p') : cards)
            + P(64, client ? 284 : 440, 300, 'lab', 'Chapters', '', 'p') + `<ol class="abs" style="left:0;top:0;margin:0;padding:0">${rows}</ol>`
            + `<div class="abs" style="left:64px;top:1004px;width:666px;padding:12px 14px;background:var(--paper2);border-radius:6px"><p class="small" style="color:var(--ink)"><b style="font-weight:600">Reading a reference.</b> ${ref('J·37')} is journey record 37 of the customer in question.${firstRef ? ` ${ref(firstRef.ref)} is event ${firstRef.seq} of run ${esc(firstRef.run)}.` : ''} Every sentence a customer “says” cites the records it rests on: the dossier invents nothing.</p></div>`
            + folio('left');
        pages.push(page(inner, false, 'Contents'));
    }

    // ------------------------------------------------------------ 3 executive summary
    if (!client) {
        const tiles = m.summary.figures.map((f, i) => `<div class="abs" style="left:${col(1 + (i % 3) * 4)}px;top:${222 + Math.floor(i / 3) * 92}px;width:${span(4)}px;border-top:1px solid var(--ink);padding-top:10px"><p style="display:flex;align-items:baseline;gap:8px"><span class="num3">${esc(f.show)}</span><span class="cap tnum">${esc(f.unit)}</span></p><p class="small" style="margin-top:6px">${esc(f.text)}</p></div>`).join('');
        const viz = f => {
            if (!f.viz) return '';
            if (f.viz.kind === 'silence') { const v = f.viz.values, mx = Math.max(...v.map(x => x.days), 1), w = span(4); return `<svg width="${w}" height="${v.length * 11 + 28}" role="img" aria-label="${esc(`Days without a word: ${v.map(x => `${x.first} ${Math.round(x.days)}`).join(', ')}`)}"><g transform="translate(0,8)">${v.map((x, i) => `<rect x="0" y="${i * 11}" width="${(x.days / mx * (w - 4)).toFixed(1)}" height="7" rx="1.5" fill="${i === v.length - 1 ? T.wait : T.accent}"/>`).join('')}<line x1="${(f.viz.threshold / mx * (w - 4)).toFixed(1)}" y1="-6" x2="${(f.viz.threshold / mx * (w - 4)).toFixed(1)}" y2="${v.length * 11}" stroke="${T.ink}" stroke-dasharray="2 3"/></g><text x="${(f.viz.threshold / mx * (w - 4) + 4).toFixed(1)}" y="${v.length * 11 + 24}" font-size="11.5" fill="${T.ink3}">${f.viz.threshold} days</text><text x="${w}" y="${v.length * 11 + 24}" text-anchor="end" font-size="11.5" fill="${T.wait}" font-weight="600">${esc(v[v.length - 1].first)}, ${Math.round(v[v.length - 1].days)}</text></svg>`; }
            if (f.viz.kind === 'people') { const v = f.viz.values.slice(0, 8); return `<svg width="${span(4)}" height="96" role="img" aria-label="${esc(`${v.length} decisions by people: ${v.map(x => `${x.who} after ${x.hours.toFixed(1)} hours`).join(', ')}`)}">${v.map((x, i) => `<g transform="translate(${i * 34},0)"><circle cx="11" cy="22" r="10" fill="${T.wait}"/><text x="11" y="26" text-anchor="middle" font-size="10" font-weight="700" fill="#fff">${esc(x.who[0])}</text><rect x="4" y="40" width="14" height="${Math.min(40, x.hours * 12).toFixed(0)}" fill="${T.wait}" opacity=".35"/></g>`).join('')}<text x="0" y="96" font-size="11.5" fill="${T.ink3}">hours waited</text></svg>`; }
            if (f.viz.kind === 'contracts') { const w = span(4); return `<svg width="${w}" height="96" role="img" aria-label="${esc(`Outcome contracts: ${f.viz.met} of ${f.viz.of} met`)}"><rect x="0" y="16" width="${w}" height="16" rx="3" fill="${T.tint}"/><rect x="0" y="16" width="${(w * f.viz.met / Math.max(1, f.viz.of)).toFixed(0)}" height="16" rx="3" fill="${T.ok}"/><text x="0" y="52" font-size="11.5" fill="${T.ink2}">${f.viz.met} of ${f.viz.of} contracts met</text><text x="0" y="70" font-size="11.5" fill="${T.ink2}">${f.viz.escalated} handed to a person</text><text x="0" y="88" font-size="11.5" fill="${T.ink2}">${f.viz.guards} guardrail actions</text></svg>`; }
            return '';
        };
        const fh = m.summary.findings.map((f, i) => { const y = 428 + i * 134; return `<div class="abs" aria-hidden="true" style="left:64px;top:${y - 6}px;font:500 56px/56px '${T.display}';color:var(--accent)">${i + 1}</div>` + P(col(2), y, span(6), 'h2', esc(f.title), '', 'h3') + P(col(2), y + 30, span(6), 'body', esc(f.text), '', 'p') + box(col(9), y + 2, span(4), viz(f)); }).join('');
        const rc = m.summary.first.map((r, i) => `<div class="abs" style="left:${col(1 + i * 4)}px;top:880px;width:${span(4)}px;height:150px;background:var(--tint);border-radius:6px;padding:12px 14px"><p style="display:flex;justify-content:space-between;gap:8px"><span class="lab" style="color:var(--accent)">No. ${r.rank}</span><span class="cap" style="text-align:right">${esc((r.owner || '').split(' and ')[0])}</span></p><h4 class="h3" style="margin-top:8px;color:var(--ink)">${esc(r.title)}</h4><p class="cap" style="margin-top:8px;color:var(--ink2)">${r.customers} customer${r.customers === 1 ? '' : 's'} · rules ${esc(r.rules.filter(x => x !== 'domain').join(', '))}</p><p class="cap" style="margin-top:2px;color:var(--ink2)">Effect: ${r.method === 'replay' ? 'counterfactual replay' : esc(r.method.replace('replay-live', 'replay, not run'))}</p></div>`).join('');
        const inner = head('01 · Summary') + P(64, 84, 400, 'ov', '01 Summary', '', 'p') + P(64, 108, span(11), 'h1', esc(m.summary.headline), '', 'h2')
            + `<div class="abs" style="left:0;top:0"><h3 class="vh">The figures</h3>${tiles}</div>` + `<div class="abs" style="left:0;top:0"><h3 class="vh">Three findings</h3>${fh}</div>`
            + P(64, 850, 500, 'lab', `What to change first · page ${String(8 + personas.length * 2).padStart(2, '0')}`, '', 'h3') + rc + folio();
        pages.push(page(inner, false, 'Executive summary'));
    }

    // ------------------------------------------------------------ 4 the journey at a glance
    const glancePage = () => {
        const st = m.glance.stages, rowsAll = m.glance.rows, gx = 214, cw = (col(12) + 39 - gx) / st.length, y0 = 262 - (st.length > 7 ? 0 : 0);
        const rh = Math.min(44, Math.floor(400 / Math.max(1, rowsAll.length)));
        const headCells = st.map((s, i) => P(gx + i * cw, 196, cw - 4, '', `<p class="h3" style="font-size:${st.length > 7 ? 10.5 : 12}px;line-height:14px">${esc(s.name)}</p><p class="cap" style="margin-top:3px">${esc(days(s.max))}</p>`)).join('');
        let svg = '', names = '';
        rowsAll.forEach((r, ri) => {
            const y = y0 + ri * rh, cy = y + 16;
            const idx = r.cells.map((c, i) => (c ? i : -1)).filter(i => i >= 0), last = idx.length ? Math.max(...idx) : 0;
            svg += `<line x1="${(gx + cw / 2).toFixed(1)}" y1="${cy}" x2="${(gx + last * cw + cw / 2).toFixed(1)}" y2="${cy}" stroke="${T.ink}" stroke-width="1.5"/>`;
            r.cells.forEach((c, i) => {
                if (!c) return;
                const x = gx + i * cw + 3, w = cw - 8, colr = MOOD(T, c.mood), stuck = r.stuck && st[i].id === r.stage;
                const label = stuck ? 'stuck' : (st[i].max_ms === null && r.status === 'completed' && i === st.length - 1 ? 'done' : fmtH(c.ms));
                svg += `<rect x="${x.toFixed(1)}" y="${cy - 11}" width="${w.toFixed(1)}" height="22" rx="11" fill="${stuck ? '#FEF3C7' : '#fff'}" stroke="${colr}" stroke-width="${stuck ? 2.2 : 1.4}" stroke-dasharray="${stuck ? '4 3' : '0'}"/><circle cx="${(x + 9).toFixed(1)}" cy="${cy}" r="3.5" fill="${colr}"/><text x="${(x + 16).toFixed(1)}" y="${cy + 4}" font-size="${cw < 70 ? 10 : 11.5}" font-weight="500" fill="${T.ink}">${esc(label)}</text>`;
            });
            const out = r.status === 'completed' ? ['reached the end', T.ok] : r.status === 'abandoned' ? ['left', T.ink3] : ['stuck', T.wait];
            names += P(64, y + 2, 148, '', `<p style="display:flex;gap:8px;align-items:center"><span aria-hidden="true" style="width:26px;height:26px;border-radius:50%;background:${r.featured ? T.accent : T.paper2};color:${r.featured ? '#fff' : T.ink};font:600 11px/26px ${T.body};text-align:center;flex:none">${esc(r.initials)}</span><span><span class="h3" style="font-size:12.5px;line-height:15px">${esc(r.name)}</span><br><span class="cap" style="color:${out[1]};font-weight:600">${out[0]}</span><span class="cap"> · ${r.days.toFixed(1)} d</span></span></p>`);
        });
        const alt = rowsAll.map(r => `${r.name}: ${r.cells.map((c, i) => c ? `${st[i].name} ${fmtH(c.ms) || '0'}` : null).filter(Boolean).join(', ')}`).join('. ');
        const legend = [['good, +0.5 or more', T.ok], ['neutral', T.ink3], ['low, −0.5', T.wait], ['very low, −1 or less', T.bad]].map(([w, c]) => `<span style="display:inline-flex;align-items:center;gap:6px;margin-right:16px"><span aria-hidden="true" style="width:9px;height:9px;border-radius:50%;background:${c}"></span>${w}</span>`).join('');
        const trs = st.map(s => `<tr><th scope="row">${esc(s.name)}</th><td>${esc(s.owner || '')}</td><td class="r">${esc(days(s.max).replace(' days', ' d'))}</td><td class="r">${s.median_ms === null || s.median_ms === undefined ? '' : fmtH(s.median_ms)}</td><td class="r">${s.entered}</td><td class="r">${s.completed}</td><td class="r">${s.stalled}</td><td class="r">${s.abandoned}</td></tr>`).join('');
        const tableY = Math.max(690, y0 + rowsAll.length * rh + 60);
        const inner = head(client ? '02 · Your stages' : '02 · The journey at a glance') + P(64, 84, 400, 'ov', client ? '02 Your stages' : '02 The journey at a glance', '', 'p')
            + P(64, 108, span(8), 'h1', esc(client ? `${Word(st.length)} stages, one journey` : `${Word(st.length)} stages, ${word(N)} ${S[1]}`), '', 'h2')
            + P(col(9), 112, span(4), 'small', esc(`Each row is ${client ? 'your journey' : `one of the ${S[1]}`}; each pill, a stage it passed through, with the time spent there and the mood as the stage ended.`), '', 'p')
            + headCells + `<svg class="abs" style="left:0;top:0" width="794" height="1123" role="img" aria-label="${esc(alt)}">${svg}</svg>` + names
            + P(gx, y0 + rowsAll.length * rh + 6, 520, 'cap', legend, '', 'p')
            + (client ? '' : P(64, tableY, 666, 'lab', 'The stages, their owners and their times', '', 'h3') + box(64, tableY + 24, 666, `<table class="t"><caption>The stages, their owners and their times</caption><thead><tr><th scope="col">Stage</th><th scope="col">Owner</th><th scope="col" class="r">Given</th><th scope="col" class="r">Median</th><th scope="col" class="r">Entered</th><th scope="col" class="r">Done</th><th scope="col" class="r">Stuck</th><th scope="col" class="r">Left</th></tr></thead><tbody>${trs}</tbody></table>`))
            + (client ? box(64, 640, 666, `<table class="t"><caption>Your time at each stage</caption><thead><tr><th scope="col">Stage</th><th scope="col">Owner</th><th scope="col" class="r">Given</th><th scope="col" class="r">Your time</th></tr></thead><tbody>${st.map((s, i) => { const c = rowsAll[0].cells[i]; return c ? `<tr><th scope="row">${esc(s.name)}</th><td>${esc(s.owner || '')}</td><td class="r">${esc(days(s.max).replace(' days', ' d'))}</td><td class="r">${fmtH(c.ms)}</td></tr>` : ''; }).join('')}</tbody></table>`) : '')
            + folio('left');
        return page(inner, false, client ? 'Your stages' : 'The journey at a glance');
    };
    if (!client) pages.push(glancePage());

    // ------------------------------------------------------------ 5 to 8 the personas: their voice, then the record
    personas.forEach((p, pi) => {
        const accent = p.stuck ? T.wait_n : T.acc_n;
        const story = p.story;
        const prose = story.paragraphs.map(par => `<p>${par.map(s => `${esc(s.text)}${s.refs.map(ref).join('')}`).join(' ')}</p>`).join('');
        const longText = story.paragraphs.flat().reduce((a, s) => a + s.text.length, 0);
        const fs = longText > 2600 ? 'font-size:14px;line-height:21px' : longText > 1800 ? 'font-size:15.5px;line-height:24px' : '';
        const facts = p.facts.map(([a, b]) => `<div style="display:grid;grid-template-columns:110px 1fr;gap:10px;padding:7px 0;border-top:1px solid rgba(255,255,255,.14)"><dt class="cap">${esc(a)}</dt><dd class="small" style="color:var(--on);margin:0">${esc(b)}</dd></div>`).join('');
        const chapterHead = client ? '01 · Your journey' : `03 · In their own words`;
        const count = client ? '' : `${p.name} · ${pi + 1} of ${personas.length}`;
        const mono = `<div class="abs" aria-hidden="true" style="left:46px;top:82px;font:600 250px/200px '${T.display}';letter-spacing:-.06em;color:transparent;-webkit-text-stroke:1.6px ${accent}">${esc(p.initials)}</div>`;
        const line = `<svg class="abs" aria-hidden="true" style="left:0;top:0" width="794" height="560"><path d="M0 312 C 140 312, 190 298, 352 298" fill="none" stroke="${accent}" stroke-width="2.5"/><circle cx="352" cy="298" r="6" fill="${T.night}" stroke="${p.stuck ? T.wait_n : T.ok_n}" stroke-width="2.2"/></svg>`;
        const voice = line + head(chapterHead, count) + mono
            + P(64, 334, 330, 'ov', esc(cap2(p.role)), `color:${accent}`, 'p')
            + P(64, 358, 300, 'd2', esc(p.name), '', 'h2')
            + `<dl class="abs" style="left:64px;top:476px;width:${span(5)}px;margin:0">${facts}</dl>`
            + (story.quote ? P(64, 700, span(5), 'quote', `<span aria-hidden="true">“</span>${esc(story.quote.text)}<span aria-hidden="true">”</span>`, `color:${accent}`, 'blockquote') : '')
            + P(64, 830, span(5), 'cap', esc(`Told in ${client ? 'your' : 'their'} voice by the dossier’s narrator from the record: every sentence cites the journal records it rests on, and a sentence the record does not support is not written. ${client ? '' : `${p.first} is a fictional customer of the example.`}`), '', 'p')
            + `<div class="abs voice" style="left:${col(7) - 18}px;top:96px;width:${span(6) + 18}px;${fs}"><h3 class="vh">${esc(p.name)}, in ${client ? 'your' : 'their'} own words</h3>${prose}<p class="cap" style="margin-top:18px;font-family:${T.body};color:var(--on3)">${esc(`${p.name}, as the record tells it. ${story.sentences} sentences, each resting on the record: ${story.references} references.`)}</p></div>`
            + folio('left');
        pages.push(page(voice, true, `${p.name} in ${client ? 'your' : 'their'} own words`));

        // the record: a blueprint top to bottom, the moments that mattered, the numbers
        const bp = p.blueprint.rows;
        const X_T = 64, X_C = 124, X_S = 292, X_B = 312, W_C = 150, W_B = 250;
        let y = 226, out = '';
        const spine = [];
        for (const r of bp) {
            if (r.silence) {
                const hgt = 96;
                out += `<div class="abs" aria-hidden="true" style="left:${X_T}px;top:${y}px;width:${X_B + W_B - X_T}px;height:${hgt}px;background:repeating-linear-gradient(180deg,transparent 0 11px,var(--paper2) 11px 12px)"></div>`
                    + P(X_C, y + 26, W_C, '', `<p class="h2" style="color:var(--wait)">${esc(r.ms >= 2 * DAY ? `${Word(Math.round(r.ms / DAY))} days` : fmtH(r.ms))}</p><p class="small">without a word to ${esc(p.first)}</p>`)
                    + P(X_B, y + 30, W_B, 'small', esc(r.behind || 'Waiting'), '', 'p');
                spine.push([y, y + hgt, 0]); y += hgt + 10; continue;
            }
            const linesB = Math.ceil(((r.behind || '').length + 10) / 40), linesC = Math.ceil(((r.sees || `not seen by ${p.first}`).length) / 24);
            const hgt = Math.max(linesB * 16 + 20, linesC * 16, 34);
            if (y + hgt > 1040) break;
            const date = r.t ? `${new Date(r.t).getUTCDate()} ${['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][new Date(r.t).getUTCMonth()]}` : '';
            out += P(X_T, y, 56, '', `<p class="h3" style="font-size:12.5px;line-height:16px">${esc(date)}</p><p class="cap tnum">${esc(r.t ? new Date(r.t).toISOString().slice(11, 16) : '')}</p>`)
                + P(X_C, y, W_C, 'small', r.sees ? `<span style="color:var(--ink)">${esc(r.stage ? r.stage + ': ' : '')}${esc(r.sees)}</span>` : `<span class="cap" style="font-style:italic">not seen by ${esc(p.first)}</span>`)
                + P(X_B, y, W_B, 'small', `${esc(r.behind || '')}<span style="display:block;margin-top:3px">${refs(r.refs)}</span>`, 'color:var(--ink2)');
            spine.push([y, y + hgt, r.mood || 0]); y += hgt + 10;
        }
        const pts = spine.flatMap(([a, b, mv]) => [[X_S + mv * 10, a + 6], [X_S + mv * 10, b - 4]]);
        const spineSvg = `<svg class="abs" aria-hidden="true" style="left:0;top:0" width="794" height="1123"><line x1="${X_S}" y1="226" x2="${X_S}" y2="${y - 10}" stroke="${T.rule}"/>${pts.length ? `<path d="M${pts.map(([x, yy]) => `${x.toFixed(1)} ${yy.toFixed(1)}`).join(' L')}" fill="none" stroke="${T.ok}" stroke-width="2.2" stroke-dasharray="5 4"/><circle cx="${pts[pts.length - 1][0].toFixed(1)}" cy="${pts[pts.length - 1][1].toFixed(1)}" r="4.5" fill="#fff" stroke="${T.ok}" stroke-width="2"/>` : ''}</svg>`;
        const moments = momentsOf(p).slice(0, 4).map(mm => `<li style="padding:9px 0;border-top:1px solid var(--rule);list-style:none"><p class="lab" style="color:${mm.colr === 'ok' ? T.ok : mm.colr === 'wait' ? T.wait : T.run}"><span aria-hidden="true">${mm.sign}</span> ${mm.kind}</p><p class="small" style="color:var(--ink);margin-top:4px">${esc(mm.text)}</p><p style="margin-top:4px">${refs(mm.refs)}</p></li>`).join('');
        const nums = [[p.days.toFixed(1), 'days, start to end'], [String(p.tps.length), `touchpoints with ${p.first}`], [String(p.runs.length), `run${p.runs.length === 1 ? '' : 's'}: ${p.runs.map(r => r.workflow).join(', ')}`], [String(p.decisions), `decisions by people${p.refused ? `, ${p.refused} refused first` : ''}`], ...(p.cost !== null && p.cost !== undefined ? [[`${m.meta.currency === 'EUR' ? '€' : ''}${p.cost.toFixed(3)}`, 'in models and tools']] : [])];
        const nn = nums.map(([a, b]) => `<div style="padding:6px 0;border-top:1px solid var(--rule)"><dt class="num3" style="font-size:22px;line-height:24px">${esc(a)}</dt><dd class="cap" style="color:var(--ink2);margin:0">${esc(b)}</dd></div>`).join('');
        const anySaid = p.moods.some(x => x.basis === 'measured');
        const record = head(`${client ? '01' : '03'} · ${p.name}, the record`) + P(64, 84, 400, 'ov', 'Blueprint · what the record says', '', 'p')
            + P(64, 108, span(9), 'h1', esc(recordTitle(p)), '', 'h2')
            + P(X_C, 198, W_C, 'lab', `${p.first} sees`, '', 'p') + P(X_B, 198, W_B, 'lab', 'Behind the scenes', '', 'p') + P(X_S - 40, 198, 40, 'lab', 'Mood', `text-align:right;color:${T.ok}`, 'p')
            + spineSvg + `<div class="abs" style="left:0;top:0"><h3 class="vh">${esc(p.first)}’s journey, moment by moment</h3>${out}</div>`
            + P(col(10), 108, span(3), 'lab', 'What mattered', '', 'h3') + `<ul class="abs" style="left:${col(10)}px;top:130px;width:${span(3)}px;margin:0;padding:0">${moments}</ul>`
            + P(col(10), 600, span(3), 'lab', 'In numbers', '', 'h3') + `<dl class="abs" style="left:${col(10)}px;top:622px;width:${span(3)}px;margin:0">${nn}</dl>`
            + P(col(10), 940, span(3), 'cap', esc(`Mood is ${anySaid ? 'partly said by the customer (solid) and partly' : ''} inferred by the journey’s rules (dashed).${anySaid ? '' : ` ${p.first} never said how ${client ? 'you' : 'they'} felt.`}`), '', 'p')
            + folio();
        pages.push(page(record, false, `${p.name}: the record`));
    });
    if (client) pages.push(glancePage());

    // ------------------------------------------------------------ 9 the workflow
    if (!client) {
        const w0 = m.work.workflows[0], TAGC = { application: T.ink2, ai_agent: T.accent, human: T.wait, robot: T.sky, undo: T.ink3 };
        const TAG = { application: 'SYSTEM', ai_agent: 'AI AGENT', human: 'PERSON', robot: 'ROBOT' };
        let y = 330, out = '';
        const groups = m.work.workflows.map(w => ({ name: w.name, acts: w.activities }));
        groups.forEach((g, gi) => {
            const acts = g.acts.slice(0, 15);
            out += `<div class="abs" aria-hidden="true" style="left:64px;top:${y - 4}px;font:500 28px/28px '${T.display}';color:var(--accent)">${gi + 1}</div>` + P(96, y, 600, 'h3', esc(g.name), '', 'h3');
            const yy = y + 26;
            out += `<ul class="abs" style="left:96px;top:${yy}px;width:640px;margin:0;padding:0">${acts.map((a, i) => { const k = a.undo ? 'undo' : a.actor; return `<li style="position:absolute;left:${(i % 5) * 127}px;top:${Math.floor(i / 5) * 54}px;width:119px;height:48px;list-style:none;border:1.4px ${a.undo ? 'dashed' : 'solid'} ${TAGC[k] || T.ink2};border-radius:6px;padding:5px 8px;background:#fff"><span style="display:block;font:700 9.5px/11px ${T.body};letter-spacing:.07em;color:${TAGC[k] || T.ink2}">${a.undo ? 'UNDO STEP' : TAG[a.actor] || 'STEP'}</span><span style="display:block;font:600 11px/13px ${T.body};color:${T.ink};margin-top:3px;overflow:hidden;max-height:27px">${esc(a.name)}</span></li>`; }).join('')}</ul>`;
            y = yy + (Math.floor((acts.length - 1) / 5) + 1) * 54 + 12 + (g.acts.length > 15 ? 18 : 0);
            if (g.acts.length > 15) out += P(96, y - 26, 500, 'cap', `and ${g.acts.length - 15} more steps`, '', 'p');
        });
        y = Math.min(y, 760);
        const stack = (rows, w) => { const tot = rows.reduce((a, r) => a + r.count, 0) || 1; let x = 0; return rows.map(r => { const ww = r.count / tot * w; const s = `<rect x="${x.toFixed(1)}" y="0" width="${Math.max(0, ww - 2).toFixed(1)}" height="20" fill="${TAGC[r.key] || T.ink2}"/>`; x += ww; return s; }).join(''); };
        const leg = rows => rows.map(r => `<tspan fill="${TAGC[r.key] || T.ink2}">■</tspan> ${esc(r.actor)} <tspan font-weight="700" fill="${T.ink}">${r.count}</tspan>`).join(' · ');
        const defN = m.work.defined.reduce((a, r) => a + r.count, 0), doneN = m.work.completed.reduce((a, r) => a + r.count, 0);
        const bars = `<svg width="666" height="74" role="img" aria-label="${esc(`Activities defined: ${m.work.defined.map(r => `${r.count} by ${r.actor.toLowerCase()}`).join(', ')}. Completed in the runs: ${m.work.completed.map(r => `${r.count} by ${r.actor.toLowerCase()}`).join(', ')}.`)}"><text x="0" y="11" font-size="11.5" font-weight="600" fill="${T.ink3}" letter-spacing="1.2">${defN} DEFINED</text><g transform="translate(0,20)">${stack(m.work.defined, 309)}</g><text x="0" y="66" font-size="11.5" fill="${T.ink2}">${leg(m.work.defined)}</text><text x="357" y="11" font-size="11.5" font-weight="600" fill="${T.ink3}" letter-spacing="1.2">${doneN} COMPLETED IN THE RUNS</text><g transform="translate(357,20)">${stack(m.work.completed, 309)}</g><text x="357" y="66" font-size="11.5" fill="${T.ink2}">${leg(m.work.completed)}</text></svg>`;
        const cg = m.work.controls.map(([a, b, c]) => `<div style="border-top:1.5px solid var(--ink);padding-top:8px"><h4 class="h3" style="font-size:13.5px">${esc(a)}</h4><p class="cap" style="color:var(--accent);font-weight:600;margin-top:2px">${esc(b)}</p><p class="cap" style="color:var(--ink2);margin-top:3px">${esc(c)}</p></div>`).join('');
        const top = `<div class="abs" aria-hidden="true" style="left:0;top:0;width:794px;height:276px;background:var(--night)"></div><svg class="abs" aria-hidden="true" style="left:0;top:0" width="794" height="276">${[0, 1, 2, 3, 4, 5, 6, 7].map(i => `<path d="M${470 + i * 26} 276 C ${520 + i * 26} ${200 - i * 6}, ${600 + i * 10} ${120 + i * 12}, 794 ${110 + i * 12}" fill="none" stroke="${T.acc_n2}" stroke-opacity="${(0.14 + i * 0.06).toFixed(2)}" stroke-width="1.5"/>`).join('')}</svg>`
            + `<div class="rh" aria-hidden="true" style="color:${T.on3}"><span>04 · The work behind the journey</span><span>${esc(m.meta.journey)} · dossier</span></div>`
            + P(64, 92, 500, 'ov', '04 The work behind the journey', `color:${T.acc_n}`, 'p') + P(62, 116, span(10), 'd2', esc(w0 ? w0.name : m.meta.journey), `color:${T.on};${(w0 ? w0.name : '').length > 30 ? 'font-size:38px;line-height:42px' : ''}`, 'h2')
            + P(64, 226, span(10), 'small', esc(`${m.work.workflows.map(w => `${w.name}: ${w.activities.length} activities${w.bands.length ? ` in ${word(w.bands.length)} bands` : ''}, ${w.runs} runs`).join('. ')}.`), `color:${T.on2}`, 'p');
        const inner = top + P(64, 300, 500, 'lab', 'The steps, as the run view shows them', '', 'h3') + out
            + P(64, y + 8, 300, 'lab', 'Who does what', '', 'h3') + box(64, y + 32, 666, bars)
            + P(64, y + 124, 300, 'lab', 'The controls', '', 'h3') + box(64, y + 148, 666, `<div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:14px 18px">${cg}</div>`) + folio('left');
        pages.push(page(inner, false, 'The work behind the journey'));
    }

    // ------------------------------------------------------------ 10 analysis 1: where the days go
    if (!client) {
        const A = m.analysis, w = span(6), maxIn = Math.max(1, ...A.funnel.map(s => s.entered));
        const fun = A.funnel.map((s, i) => { const y = i * 24, bw = s.entered / maxIn * (w - 130); return `<text x="0" y="${y + 14}" font-size="11.5" fill="${T.ink}" font-weight="500">${esc(s.name.length > 18 ? s.name.slice(0, 17) + '…' : s.name)}</text><rect x="116" y="${y + 2}" width="${w - 130}" height="15" fill="${T.paper2}"/><rect x="116" y="${y + 2}" width="${bw.toFixed(1)}" height="15" fill="${s.side ? '#fff' : T.accent}" stroke="${T.accent}" stroke-width="${s.side ? 1.5 : 0}" stroke-dasharray="${s.side ? '3 2' : '0'}"/><text x="${(116 + bw + 6).toFixed(1)}" y="${y + 14}" font-family="'${T.display}', 'Space Grotesk', sans-serif" font-size="13" font-weight="600" fill="${T.ink}">${s.entered}</text>`; }).join('');
        const ftab = `<table class="t" style="font-size:11.5px"><caption>Entering, leaving and lost or stuck, by stage</caption><thead><tr><th scope="col">Stage</th><th scope="col" class="r">In</th><th scope="col" class="r">Out</th><th scope="col" class="r">Lost or stuck</th></tr></thead><tbody>${A.funnel.map(s => `<tr><th scope="row" style="padding:3px 8px 3px 0;font-weight:500">${esc(s.name)}</th><td class="r" style="padding:3px 8px 3px 0">${s.entered}</td><td class="r" style="padding:3px 8px 3px 0">${s.completed}</td><td class="r" style="padding:3px 0">${s.lost}</td></tr>`).join('')}</tbody></table>`;
        const W = 420, gs = A.time;
        const tg = gs.map((s, i) => {
            const y = i * 34, med = s.share || 0, longest = s.longest_share || 0, lx = 150 + W * Math.min(longest, 1.1);
            return `<text x="0" y="${y + 15}" font-size="12" font-weight="500" fill="${T.ink}">${esc(s.name)}</text><text x="0" y="${y + 29}" font-size="11.5" fill="${T.ink3}">given ${esc(days(s.max))}</text><rect x="150" y="${y + 6}" width="${W}" height="14" fill="${T.paper2}"/><rect x="150" y="${y + 6}" width="${Math.max(W * Math.min(med, 1.1), 2).toFixed(1)}" height="14" fill="${T.accent}"/>${med >= 0.02 ? `<text x="${(150 + Math.max(W * Math.min(med, 1.1), 2) + 5).toFixed(1)}" y="${y + 17}" font-size="11.5" fill="${T.accent}" font-weight="600">${Math.round(med * 100)}%</text>` : ''}${longest > 0.05 ? `<line x1="${lx.toFixed(1)}" y1="${y + 1}" x2="${lx.toFixed(1)}" y2="${y + 25}" stroke="${longest >= 1 ? T.bad : T.ink}" stroke-width="2"/><text x="${(longest >= 0.9 ? lx - 6 : lx + 6).toFixed(1)}" y="${y + 30}" text-anchor="${longest >= 0.9 ? 'end' : 'start'}" font-size="11.5" fill="${longest >= 1 ? T.bad : T.ink2}">longest ${Math.round(longest * 100)}%${s.longest_who ? ` (${esc(s.longest_who)}${s.longest_open ? ', still waiting' : ''})` : ''}</text>` : ''}`;
        }).join('') + `<line x1="${150 + W}" y1="-4" x2="${150 + W}" y2="${gs.length * 34}" stroke="${T.ink}" stroke-dasharray="3 3"/><text x="${150 + W - 4}" y="-8" text-anchor="end" font-size="11.5" fill="${T.ink}">all the time given</text>`;
        const tH = gs.length * 34 + 30;
        const hdr = [['CUSTOMER', 0], ['STEP', 128], ['WHO', 372], ['WAITED', 440], ['REFUSED', 580]];
        const ppl = A.people.slice(0, 7);
        const pp = hdr.map(([t, x]) => `<text x="${x}" y="10" font-size="11.5" font-weight="600" fill="${T.ink3}" letter-spacing="1">${t}</text>`).join('') + ppl.map((p, i) => { const y = 24 + i * 22, h = (p.waited_ms || 0) / H; return `<text x="0" y="${y + 12}" font-size="12" fill="${T.ink}" font-weight="500">${esc(p.name)}</text><text x="128" y="${y + 12}" font-size="11.5" fill="${T.ink2}">${esc((p.step || '').length > 36 ? p.step.slice(0, 35) + '…' : p.step)}</text><text x="372" y="${y + 12}" font-size="12" fill="${T.ink}">${esc(p.who)}</text><rect x="440" y="${y + 2}" width="${Math.min(120, h * 28).toFixed(1)}" height="12" fill="${T.wait}"/><text x="${(440 + Math.min(120, h * 28) + 6).toFixed(1)}" y="${y + 12}" font-size="11.5" fill="${T.ink2}">${h.toFixed(1)} h</text>${p.refused ? `<text x="580" y="${y + 12}" font-size="11.5" font-weight="600" fill="${T.bad}">✕ ${esc(p.refused.who)}</text>` : ''}`; }).join('');
        const sumF = `${A.funnel[0].entered} entered ${A.funnel[0].name}; ${A.funnel[A.funnel.length - 1].entered} reached ${A.funnel[A.funnel.length - 1].name}.${A.funnel.filter(s => s.lost).map(s => ` ${s.lost} lost or stuck at ${s.name}.`).join('')}`;
        const top = gs.slice().sort((a, b) => (b.share || 0) - (a.share || 0))[0];
        const sumT = top ? `${top.name} takes the time: ${top.median_ms ? fmtH(top.median_ms) : 'no time'} of its ${days(top.max)} at the median${top.longest_share >= 1 ? `, and ${top.longest_who ? top.longest_who + '’s stay' : 'the longest stay'} reached all of it` : ''}. ${gs.filter(s => s.longest_share > 1).map(s => `${s.name} ran past its time for ${s.longest_who || 'one customer'}.`).join(' ')}` : '';
        const waits = A.people.map(p => p.waited_ms).filter(Number.isFinite).sort((a, b) => a - b), medW = waits.length ? waits[Math.max(0, Math.ceil(waits.length / 2) - 1)] : null;
        const sumP = `${Word(A.people.length)} decisions by ${word(new Set(A.people.map(p => p.who)).size)} people${medW !== null ? `, a median wait of ${fmtH(medW)} (n = ${waits.length})` : ''}.${A.people.some(p => p.refused) ? ` ${Word(A.people.filter(p => p.refused).length)} of these tasks first went to someone the policy refused.` : ''}`;
        const inner = head('05 · Analysis') + P(64, 84, 400, 'ov', '05 Analysis · 1 of 2', '', 'p') + P(64, 108, span(10), 'h1', 'Where the days go', '', 'h2')
            + P(64, 168, 330, 'lab', `A · ${cap2(S[1])} entering each stage`, '', 'h3') + box(64, 192, w, `<svg width="${w}" height="${A.funnel.length * 24 + 6}" role="img" aria-label="${esc(`${cap2(S[1])} entering each stage: ${A.funnel.map(s => `${s.name} ${s.entered}`).join(', ')}.`)}">${fun}</svg>`)
            + box(col(8), 168, span(5), `<div class="sum"><p class="small" style="color:var(--ink)"><b style="font-weight:600">In short.</b> ${esc(sumF)}</p></div>`) + box(col(8), 250, span(5), ftab)
            + P(64, 470, 500, 'lab', 'B · Time used, of the time each stage is given', '', 'h3') + box(64, 500, 666, `<svg width="666" height="${tH}" viewBox="0 -18 666 ${tH}" role="img" aria-label="${esc(`Median time in each stage as a share of the time it is given: ${gs.map(s => `${s.name} ${Math.round((s.share || 0) * 100)}%, longest ${Math.round((s.longest_share || 0) * 100)}%`).join('; ')}.`)}">${tg}</svg>`)
            + box(64, 500 + tH + 6, 666, `<div class="sum"><p class="small" style="color:var(--ink)"><b style="font-weight:600">In short.</b> ${esc(sumT)} The stage times are on page ${String(9 + personas.length * 2).padStart(2, '0')}.</p></div>`)
            + P(64, 800, 500, 'lab', 'C · Where people step in', '', 'h3') + box(64, 824, 666, `<svg width="666" height="${30 + ppl.length * 22}" role="img" aria-label="${esc(sumP)}">${pp}</svg>`)
            + box(64, 1000, 666, `<div class="sum"><p class="small" style="color:var(--ink)"><b style="font-weight:600">In short.</b> ${esc(sumP)}</p></div>`) + folio('left');
        pages.push(page(inner, false, 'Analysis: where the days go'));
    }

    // ------------------------------------------------------------ 11 analysis 2: cost, quality, mood and trust
    if (!client) {
        const A = m.analysis, w = span(6), cs = A.cost ? A.cost.by_customer : [];
        let costSvg = '', tokSvg = '';
        if (A.cost) {
            const mx = Math.max(...cs.map(c => c.cost), 0.0001) * 1.15, bw = (w - 20) / Math.max(1, cs.length);
            costSvg = cs.map((c, i) => { const h = c.cost / mx * 120, x = 10 + i * bw; return `<rect x="${(x + 4).toFixed(1)}" y="${(130 - h).toFixed(1)}" width="${Math.max(2, bw - 8).toFixed(1)}" height="${h.toFixed(1)}" fill="${c.completed ? T.accent : T.on3}"/><text x="${(x + bw / 2).toFixed(1)}" y="${(124 - h).toFixed(1)}" text-anchor="middle" font-size="${cs.length > 9 ? 9 : 11}" fill="${T.ink}">${(c.cost * 100).toFixed(1)}</text><text x="${(x + bw / 2).toFixed(1)}" y="148" text-anchor="middle" font-size="${cs.length > 9 ? 9 : 11}" fill="${T.ink2}">${esc(c.initials)}</text>`; }).join('');
            const meanY = 130 - A.cost.per_journey / mx * 120; costSvg += `<line x1="0" y1="${meanY.toFixed(1)}" x2="${w}" y2="${meanY.toFixed(1)}" stroke="${T.ink}" stroke-dasharray="3 3"/>`;
            const parts = A.cost.tokens.map(t => [t.activity, t.tokens]); const others = A.cost.tokens_total - parts.reduce((a, p) => a + p[1], 0); if (others > 0) parts.push(['Others', others]);
            const colors = [T.accent, T.line, T.acc_n2, T.acc_n, T.tint]; let x = 0;
            tokSvg = parts.map(([nm, v], i) => { const ww = v / Math.max(1, A.cost.tokens_total) * w; const s = `<rect x="${x.toFixed(1)}" y="0" width="${Math.max(0, ww - 1.5).toFixed(1)}" height="20" fill="${colors[i % colors.length]}"/>`; x += ww; return s; }).join('') + parts.map(([nm, v], i) => `<text x="0" y="${44 + i * 17}" font-size="11.5" fill="${T.ink2}"><tspan fill="${colors[i % colors.length]}">■</tspan> ${esc(nm)} <tspan font-weight="600" fill="${T.ink}">${v.toLocaleString('en-US')}</tspan> · ${(v / Math.max(1, A.cost.tokens_total) * 100).toFixed(1)}%</text>`).join('');
        }
        const rft = A.right_first_time.map((row, j) => { const y = j * 40, good = row.runs.filter(r => r.ok).length; return `<text x="0" y="${y + 16}" font-size="12" font-weight="500" fill="${T.ink}">${esc(row.workflow.length > 14 ? row.workflow.split(' ').slice(0, 2).join(' ') : row.workflow)}</text>${row.runs.slice(0, 12).map((r, i) => { const cx = 112 + i * 27; return r.ok ? `<circle cx="${cx}" cy="${y + 11}" r="10" fill="${T.ok}"/><text x="${cx}" y="${y + 15}" text-anchor="middle" font-size="9.5" font-weight="700" fill="#fff">${esc(r.initials)}</text>` : `<circle cx="${cx}" cy="${y + 11}" r="9" fill="#fff" stroke="${T.bad}" stroke-width="2"/><text x="${cx}" y="${y + 15}" text-anchor="middle" font-size="9.5" font-weight="700" fill="${T.bad}">${esc(r.initials)}</text>`; }).join('')}<text x="${112 + Math.min(12, row.runs.length) * 27 + 2}" y="${y + 16}" font-family="'${T.display}', 'Space Grotesk', sans-serif" font-size="14" font-weight="600" fill="${T.ink}">${good} of ${row.runs.length}</text>`; }).join('');
        const rftH = A.right_first_time.length * 40;
        const mw = 666, mh = 170, n = A.mood.length, mxp = i => 62 + i * (mw - 96) / Math.max(1, n - 1), myp = v => 80 - v * 34;
        let ms = [-2, -1, 0, 1, 2].map(v => `<line x1="30" y1="${myp(v)}" x2="${mw}" y2="${myp(v)}" stroke="${v ? T.rule : T.on3}"/><text x="22" y="${myp(v) + 4}" text-anchor="end" font-size="11.5" fill="${T.ink3}">${v > 0 ? '+' : ''}${v}</text>`).join('');
        A.mood.forEach((s, i) => { ms += `<text x="${mxp(i).toFixed(1)}" y="${mh}" text-anchor="middle" font-size="${n > 7 ? 9.5 : 11.5}" fill="${T.ink2}">${esc(s.name.length > 14 ? s.name.split(' ')[0] : s.name)}</text>`; const counts = {}; s.values.forEach(v => { counts[v] = (counts[v] || 0) + 1; }); Object.entries(counts).forEach(([v, c]) => { for (let k = 0; k < c; k++) ms += `<circle cx="${(mxp(i) + (k - (c - 1) / 2) * 7).toFixed(1)}" cy="${myp(+v).toFixed(1)}" r="3" fill="#fff" stroke="${MOOD(T, +v)}" stroke-width="1.5"/>`; }); });
        const withMean = A.mood.map((s, i) => [i, s.mean]).filter(x => x[1] !== null);
        ms += `<polyline points="${withMean.map(([i, v]) => `${mxp(i).toFixed(1)},${myp(v).toFixed(1)}`).join(' ')}" fill="none" stroke="${T.accent}" stroke-width="2.5" stroke-dasharray="6 4"/>${withMean.map(([i, v]) => `<circle cx="${mxp(i).toFixed(1)}" cy="${myp(v).toFixed(1)}" r="4.5" fill="${T.accent}"/>`).join('')}`;
        const trust = (A.trust || []).slice(0, 8);
        const tt = trust.map(t => `<tr><th scope="row">${esc(t.by)}</th><td>${esc(t.what)}</td><td>${esc(t.rule)}</td><td>${esc(t.for)}</td><td style="white-space:nowrap">${refs(t.refs)}</td></tr>`).join('');
        const lowest = A.mood.filter(s => s.min !== null).sort((a, b) => a.min - b.min)[0];
        const sumM = `Mood is lowest at ${lowest ? lowest.name : 'no stage'} (${lowest ? lowest.min : ''}) and ends at ${A.mood[A.mood.length - 1].mean !== null ? (A.mood[A.mood.length - 1].mean > 0 ? '+' : '') + A.mood[A.mood.length - 1].mean : 'no value'}. ${A.mood_said ? `${A.mood_said} of ${A.mood_changes} changes were said by the customers` : `Every change of mood was inferred by the journey’s rules (0 of ${A.mood_changes} said): ask customers, and this line becomes theirs`}.`;
        const sumQ = `${A.first_pass_yield.ok} of ${A.first_pass_yield.n} runs went right first time; ${A.contracts.met} of ${A.contracts.of} outcome contracts met.`;
        const inner = head('05 · Analysis') + P(64, 84, 400, 'ov', '05 Analysis · 2 of 2', '', 'p') + P(64, 108, 666, 'h1', 'Cost, quality, mood and trust', '', 'h2')
            + (A.cost ? P(64, 166, 330, 'lab', `D · Cost per customer, cents · mean ${(A.cost.per_journey * 100).toFixed(1)}`, '', 'h3') + box(64, 190, w, `<svg width="${w}" height="154" role="img" aria-label="${esc(`Cost per customer in cents: ${cs.map(c => `${c.first} ${(c.cost * 100).toFixed(1)}`).join(', ')}; mean ${(A.cost.per_journey * 100).toFixed(1)}. Models and tools only.`)}">${costSvg}</svg>`)
                + P(col(7), 166, 300, 'lab', 'E · Where the model tokens go', '', 'h3') + box(col(7), 192, w, `<svg width="${w}" height="${44 + 17 * 5}" role="img" aria-label="${esc(`Model tokens by activity, ${A.cost.tokens_total.toLocaleString('en-US')} in all: ${A.cost.tokens.map(t => `${t.activity} ${t.tokens.toLocaleString('en-US')}`).join(', ')}.`)}">${tokSvg}</svg>`)
                + box(col(7), 322, w, `<p class="cap" style="color:var(--ink2)">Models and tools, as the runs recorded them: ${A.cost.total.toFixed(2)} ${esc(m.meta.currency || '')} in all. People’s time is not costed: the record has no price for it.</p>`) : '')
            + P(64, 368, 300, 'lab', 'F · Right first time', '', 'h3') + box(64, 394, span(6), `<svg width="${span(6)}" height="${rftH + 4}" role="img" aria-label="${esc(`Right first time: ${A.right_first_time.map(r => `${r.workflow} ${r.runs.filter(x => x.ok).length} of ${r.runs.length}`).join('; ')}`)}">${rft}</svg>`)
            + box(col(7), 384, w, `<div class="sum"><p class="small" style="color:var(--ink)"><b style="font-weight:600">In short.</b> ${esc(sumQ)}</p></div>`)
            + P(64, 494, 400, 'lab', 'G · Mood at the end of each stage, −2 to +2', '', 'h3') + box(64, 520, 666, `<svg width="${mw}" height="${mh + 6}" role="img" aria-label="${esc(`Mean mood at the end of each stage: ${A.mood.map(s => `${s.name} ${s.mean === null ? 'no value' : s.mean}`).join(', ')}.`)}">${ms}</svg>`)
            + box(64, 700, 666, `<div class="sum"><p class="small" style="color:var(--ink)"><b style="font-weight:600">In short.</b> ${esc(sumM)}</p></div>`)
            + (trust.length ? P(64, 784, 400, 'lab', 'H · Trust events', '', 'h3') + box(64, 808, 666, `<table class="t"><caption>Trust events: guardrails, contracts and the policy</caption><thead><tr><th scope="col">By</th><th scope="col">What</th><th scope="col">Rule</th><th scope="col">For</th><th scope="col">Record</th></tr></thead><tbody>${tt}</tbody></table>`) : '') + folio();
        pages.push(page(inner, false, 'Analysis: cost, quality, mood and trust'));
    }

    // ------------------------------------------------------------ 12 recommendations
    {
        const RECS = m.recommendations.list;
        const mw = span(5), mh = 300, padL = 30, padB = 30;
        const ymax = Math.max(2, Math.ceil(Math.max(0, ...RECS.map(r => r.impact)) * 2) / 2);
        const X = e => padL + 10 + (e - 0.35) / 3.1 * (mw - 50), Y = v => mh - padB - v / ymax * (mh - 50);
        let svg = `<rect x="${padL}" y="20" width="${mw - 40}" height="${mh - 50}" fill="${T.paper2}"/><rect x="${padL}" y="20" width="${(X(2.5) - padL).toFixed(1)}" height="${(Y(1) - 20).toFixed(1)}" fill="${T.tint}"/><line x1="${X(2.5).toFixed(1)}" y1="20" x2="${X(2.5).toFixed(1)}" y2="${mh - padB}" stroke="#fff" stroke-width="2"/><line x1="${padL}" y1="${Y(1).toFixed(1)}" x2="${mw - 10}" y2="${Y(1).toFixed(1)}" stroke="#fff" stroke-width="2"/>`;
        for (const [t, x, y, a, c] of [['DO FIRST', padL + 8, 36, 'start', T.accent], ['PLAN', mw - 18, 36, 'end', T.ink3], ['QUICK FIXES', padL + 8, mh - padB - 8, 'start', T.ink3], ['LATER', mw - 18, mh - padB - 8, 'end', T.ink3]]) svg += `<text x="${x}" y="${y}" text-anchor="${a}" font-size="11.5" font-weight="600" letter-spacing="1" fill="${c}">${t}</text>`;
        for (const [e, l] of [[1, 'low'], [2, 'medium'], [3, 'high']]) svg += `<text x="${X(e).toFixed(1)}" y="${mh - 10}" text-anchor="middle" font-size="11.5" fill="${T.ink2}">${l}</text>`;
        svg += `<text x="${((mw + padL) / 2).toFixed(0)}" y="${mh + 12}" text-anchor="middle" font-size="11.5" font-weight="600" letter-spacing="1" fill="${T.ink3}">EFFORT</text><text x="12" y="${mh / 2}" transform="rotate(-90 12 ${mh / 2})" text-anchor="middle" font-size="11.5" font-weight="600" letter-spacing="1" fill="${T.ink3}">IMPACT</text>`;
        for (let v = 0.5; v < ymax; v += 0.5) svg += `<text x="${padL - 4}" y="${(Y(v) + 4).toFixed(1)}" text-anchor="end" font-size="10.5" fill="${T.ink3}">${v}</text>`;
        const byE = {}; RECS.forEach(r => (byE[r.effort] = byE[r.effort] || []).push(r));
        for (const [e, list] of Object.entries(byE)) { list.sort((a, b) => a.rank - b.rank); list.forEach((r, k) => { const cx = X(+e) + (k - (list.length - 1) / 2) * 23, cy = Y(r.impact), rad = 6 + Math.sqrt(r.customers) * 3.4; svg += kindShape(r.kind, +cx.toFixed(1), +cy.toFixed(1), +rad.toFixed(1), T['k_' + r.kind] || T.accent, '#fff', 1.5) + `<text x="${cx.toFixed(1)}" y="${(cy - rad - 4).toFixed(1)}" text-anchor="middle" font-family="'${T.display}', 'Space Grotesk', sans-serif" font-size="12" font-weight="700" fill="${T.ink}">${r.rank}</text>`; }); }
        const alt = `Impact against effort for ${RECS.length} recommendation${RECS.length === 1 ? '' : 's'}, a mark’s size being the customers concerned: ${RECS.map(r => `${r.rank}, impact ${r.impact}, effort ${r.effort}`).join('; ')}.`;
        const legend = ['experience', 'quality', 'trust', 'speed', 'cost'].map(k => `<span style="display:inline-flex;align-items:center;gap:5px;margin-right:12px;white-space:nowrap"><svg width="14" height="14" aria-hidden="true">${kindShape(k, 7, 7, 5.5, T['k_' + k])}</svg>${k}</span>`).join('');
        const r1 = RECS[0];
        const feat = r1 ? `<p style="display:flex;align-items:flex-end;gap:14px"><span aria-hidden="true" style="font:500 72px/60px '${T.display}';letter-spacing:-.04em;color:var(--accent)">${r1.rank}</span><span class="lab" style="color:var(--accent);padding-bottom:4px"><span class="vh">Recommendation ${r1.rank}. </span>${r1.priority >= 0.5 ? 'Do first' : 'First'} · ${esc(r1.kind)}<br>${esc(r1.owner || '')} · rules ${esc(r1.rules.filter(x => x !== 'domain').join(', '))}</span></p><h3 class="h1" style="margin-top:12px;font-size:25px;line-height:30px">${esc(r1.title)}</h3><p class="small" style="margin-top:10px;color:var(--ink2)">${esc(r1.finding)}</p><p class="small" style="margin-top:12px;color:var(--ink)"><b style="font-weight:600">Action.</b> ${esc(r1.action)}</p><p class="small" style="margin-top:8px;color:var(--ink)"><b style="font-weight:600">Expected · ${esc(METHOD[r1.method] || r1.method)}.</b> ${esc(r1.effect)}</p>` : `<h3 class="h2">No recommendation</h3><p class="small">Every rule was checked; none fired${client ? ' for your journey' : ''}.</p>`;
        const rest = RECS.slice(1, 8);
        const rows = rest.map(r => `<tr><td><b style="font:600 15px '${T.display}';color:var(--accent)">${r.rank}</b></td><th scope="row" style="font-weight:600">${esc(r.title)}<span class="cap" style="display:block;margin-top:2px;font-weight:400;color:var(--ink3)">${esc(client ? r.finding : `${r.who.length > 3 ? `${r.who.length} customers` : r.who.join(', ')} · ${r.trigger || r.rules.join(', ')}`)}</span></th><td>${esc(r.kind)}</td><td>${esc((r.owner || '').split(' and ')[0])}</td><td class="r">${r.impact.toFixed(2)}</td><td class="r">${r.effort}</td><td>${esc(METHOD[r.method] || r.method)}</td></tr>`).join('');
        const inner = head(client ? '03 · For next time' : '06 · Recommendations') + P(64, 84, 400, 'ov', client ? '03 For next time' : '06 Recommendations', '', 'p') + P(64, 108, 666, 'h1', client ? 'What we recommend, and why' : 'What to change, in order', '', 'h2')
            + box(64, 162, mw, `<svg width="${mw}" height="${mh + 20}" role="img" aria-label="${esc(alt)}">${svg}</svg>`) + P(64, 490, mw, 'cap', legend, '', 'p')
            + P(64, 534, mw, 'cap', esc(`Impact = customers concerned ÷ ${N} × severity (3 lost, 2 late or unhappy, 1 friction, 0.25 immaterial cost). Effort 1 to 3. Effect known by replay (specification section 20), estimate or pilot.`), '', 'p')
            + box(col(7), 160, span(6), feat)
            + (rows ? P(64, 616, 400, 'lab', 'Then, by impact over effort', '', 'h3') + box(64, 640, 666, `<table class="t" style="font-size:11.5px"><caption>The other recommendations, ranked by impact over effort</caption><thead><tr><th scope="col">#</th><th scope="col">Recommendation · who · rule and numbers</th><th scope="col">Kind</th><th scope="col">Owner</th><th scope="col" class="r">Impact</th><th scope="col" class="r">Effort</th><th scope="col">Effect</th></tr></thead><tbody>${rows}</tbody></table>${m.recommendations.empty.length && !client ? `<p class="cap" style="margin-top:8px">${esc(`No recommendation for ${m.recommendations.empty.join(', ')}: every check passed.`)}</p>` : ''}${RECS.length > 8 ? `<p class="cap" style="margin-top:4px">${esc(`And ${RECS.length - 8} more in the journey view’s Recommendations tab.`)}</p>` : ''}`) : '') + folio('left');
        pages.push(page(inner, false, client ? 'For next time' : 'Recommendations'));
    }

    // ------------------------------------------------------------ 13 compliance
    if (!client && m.compliance) {
        const C = m.compliance;
        const tr = C.rows.slice(0, 15).map(r => `<tr><th scope="row" style="white-space:nowrap">${esc(r.provision)}</th><td>${esc(r.asks)}</td><td style="font-family:'JetBrains Mono';font-size:11px;color:var(--accent)">${esc(r.parts.join(', '))}</td><td>${esc(r.holds)}</td></tr>`).join('');
        const inner = head('07 · Appendix') + P(64, 84, 500, 'ov', '07 Appendix · Compliance and evidence', '', 'p') + P(64, 108, 666, 'h1', 'The EU AI Act and the record', '', 'h2')
            + `<div class="abs" style="left:64px;top:164px;width:666px;padding:12px 16px;border:1.5px solid var(--ink);border-radius:4px"><p class="small" style="color:var(--ink)"><b style="font-weight:600">Evidence, not a certification.</b> ${esc(C.notice)}</p></div>`
            + P(64, 290, span(11), 'small', esc(`Each provision of ${C.framework} that the record serves, the parts of the evidence report (specification section 32) that state it, and what this record holds. The mapping is informative: it says a record is relevant to an obligation, never that the obligation is met.`), '', 'p')
            + box(64, 346, 666, `<table class="t" style="font-size:11px"><caption>Provisions, report parts and what the record holds</caption><thead><tr><th scope="col">Provision</th><th scope="col">What it asks for</th><th scope="col">Report part</th><th scope="col">In this record</th></tr></thead><tbody>${tr}</tbody></table>`) + folio();
        pages.push(page(inner, false, 'Appendix: compliance and evidence'));
    }

    // ------------------------------------------------------------ 14 glossary, method, sources
    {
        const terms = m.glossary.filter(t => t.definition.length < 190).slice(0, 9);
        const tg = terms.map(t => `<div style="padding:7px 0;border-top:1px solid var(--rule)"><dt style="display:flex;justify-content:space-between;gap:6px"><b class="h3" style="font-size:12px;line-height:16px">${esc(t.term)}</b><span class="ref">${esc(String(t.see || '').length > 14 ? '' : t.see)}</span></dt><dd class="cap" style="color:var(--ink2);margin:2px 0 0">${esc(t.definition)}</dd></div>`).join('');
        const rules = m.recommendations.rules.map(r => `<tr><th scope="row" style="padding:4px 6px 4px 0;font-family:'JetBrains Mono';font-size:11px;color:var(--accent)">${r.id}</th><td style="padding:4px 6px 4px 0"><b>${esc(r.name)}</b></td><td class="r" style="padding:4px 0">${esc(r.threshold)}</td></tr>`).join('');
        const stt = m.glance.stages.map(s => `<tr><th scope="row" style="padding:4px 6px 4px 0;font-weight:500">${esc(s.name)}</th><td class="r" style="padding:4px 6px 4px 0">${esc(days(s.max).replace(' days', ' d'))}</td><td class="r" style="padding:4px 0">${s.median_ms === null || s.median_ms === undefined ? '' : fmtH(s.median_ms)}</td></tr>`).join('');
        const inner = head(client ? '04 · Your record and these words' : '07 · Appendix') + P(64, 84, 500, 'ov', client ? '04 Your record and these words' : '07 Appendix · Glossary, method, sources', '', 'p') + P(64, 108, 666, 'h1', 'Words, rules and sources', '', 'h2')
            + P(64, 166, 300, 'lab', 'Glossary', '', 'h3') + `<dl class="abs" style="left:64px;top:188px;width:666px;display:grid;grid-template-columns:1fr 1fr 1fr;gap:0 18px;margin:0">${tg}</dl>`
            + P(64, 456, 330, 'lab', 'The rules behind the recommendations', '', 'h3') + box(64, 478, span(6), `<table class="t" style="font-size:11px"><caption>The twelve rules and their thresholds</caption><thead><tr><th scope="col">Rule</th><th scope="col">Fires when</th><th scope="col" class="r">Threshold</th></tr></thead><tbody>${rules}</tbody></table>`)
            + (client ? '' : P(col(7), 456, 300, 'lab', 'Stage times', '', 'h3') + box(col(7), 478, span(6), `<table class="t" style="font-size:11px"><caption>Stage times, for chart B</caption><thead><tr><th scope="col">Stage</th><th scope="col" class="r">Given</th><th scope="col" class="r">Median</th></tr></thead><tbody>${stt}</tbody></table>`))
            + P(col(7), client ? 900 : 950, span(6), 'cap', esc(`Sources: ${m.sources.join('; ')}. As of ${m.meta.as_of_text} UTC.`), 'color:var(--ink2)', 'p')
            + P(col(7), client ? 760 : 790, span(6), 'lab', 'Method', '', 'h3') + P(col(7), client ? 782 : 812, span(6), 'cap', esc(m.method.join(' ')), 'color:var(--ink2)', 'p')
            + (client ? `<div class="abs" style="left:${col(7)}px;top:660px;width:${span(6)}px;padding:12px 14px;border:1.5px solid var(--ink);border-radius:4px"><p class="small" style="color:var(--ink)"><b style="font-weight:600">Your record.</b> Every sentence in this dossier rests on the record of your journey, which you may ask to see. ${m.compliance ? 'The organisation keeps an evidence report of the whole system; it is not part of a client edition.' : ''}</p></div>` : '')
            + P(64, 1040, 666, 'cap', esc(`Colophon. ${T.display}, ${T.body}, Newsreader, JetBrains Mono. Tagged PDF in English; every figure has a text alternative and its numbers in the text or a table. ${m.meta.fictional}`), '', 'p') + folio('left');
        pages.push(page(inner, false, 'Glossary, method and sources'));
    }
    return shell(T, m, pages);
}
const cap2 = s => (s ? s[0].toUpperCase() + s.slice(1) : s);
function recordTitle(p) {
    const work = p.hist.filter(h => h.name).length;
    if (p.silence && p.silence.days >= 7) return `${p.stuck ? 'Days of work, then' : 'Days of work,'} ${Math.round(p.silence.days)} days of ${p.stuck ? 'silence' : 'waiting'}`;
    return `${work} stages, ${p.days.toFixed(1)} days`;
}
function momentsOf(p) {
    const out = [];
    for (const mo of p.moods) out.push(mo.change > 0 ? { sign: '▲', kind: 'Delight', colr: 'ok', text: `${mo.reason}${mo.basis === 'measured' ? '' : ' (inferred)'}`, refs: [`J·${mo.seq}`] } : { sign: '▼', kind: 'Pain', colr: 'wait', text: `${mo.reason}${mo.basis === 'measured' ? '' : ' (inferred)'}`, refs: [`J·${mo.seq}`] });
    if (p.silence && p.silence.days >= 7) out.push({ sign: '▼', kind: 'Pain', colr: 'wait', text: `${Math.round(p.silence.days)} days without a word${p.silence.stage ? ' in ' + p.silence.stage : ''}`, refs: [] });
    const unseen = p.story.paragraphs.length === 3 ? p.story.paragraphs[1] : [];
    for (const s of unseen.slice(0, 2)) out.push({ sign: '●', kind: 'Unseen', colr: 'run', text: s.text.replace(/^What I did not see, the record shows: /, '').replace(/^\w/, c => c.toUpperCase()), refs: s.refs.map(r => `${r.run}·${r.seq}`) });
    const order = { Unseen: 1, Pain: 0, Delight: 2 };
    return out.sort((a, b) => order[a.kind] - order[b.kind]).slice(0, 4);
}

const api = { render };
root.AWA_DOSSIER_PRINT = api;
if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
