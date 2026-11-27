// The dossier of a journey: one document of the journeys, the work behind them, the customers' stories in their
// own voice, the analysis and the recommendations. This module computes its content (the model); the HTML edition
// (awa-dossier-html.js), the print layout for the PDF (awa-dossier-print.js) and the DOCX (awa-dossier-docx.js)
// render it.
//
// The same input as the journey view: a portfolio export (awa journey export) and the view's options. No DOM, no
// clock, no randomness: the same record, options and edition give the same dossier, byte for byte.
//
//   const { build } = require('./awa-dossier.js');                       // or window.AWA_DOSSIER in a page
//   const model = build(record, options, { edition: 'professional' });   // or { edition: 'client', customer: 'ENR-26001' }
//
// The customers' stories are told in their own voice by templates: each sentence is written from journal records
// and carries their references ("J·28" is journey record 28 of that customer, "0093·74" event 74 of run 00000093).
// A template never states a feeling the record does not state, and a client edition names no other customer.
// options.dossier (all optional):
//   subject     ["household", "households"]          what a customer is called
//   lead        a sentence for the cover
//   personas    ["APP-24002", "APP-24008"]           the customers whose stories are told (the narrator picks otherwise)
//   say         { "<touchpoint id>": "I had a recommendation: the {plan} plan, about {estimated_annual_cost_eur} euros a year" }
//               a customer's words for a touchpoint, with values from the journey instance's data
//   facts       [{ "label": "Plan", "value": "{plan}" }]  the facts beside a persona's name
//   promise     "P21D"                                 the time the journey promises (default: the start workflow's service level)
//   fictional   "The households and the company are fictional."
(function (root) {
'use strict';

const DAY = 86400000, H = 3600000, MIN = 60000;
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const WORDS = ['no', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen', 'twenty', 'twenty-one', 'twenty-two', 'twenty-three', 'twenty-four', 'twenty-five', 'twenty-six', 'twenty-seven', 'twenty-eight', 'twenty-nine', 'thirty', 'thirty-one'];
const word = n => (Number.isInteger(n) && n >= 0 && n < WORDS.length ? WORDS[n] : String(n));
const Word = n => { const w = word(n); return w[0].toUpperCase() + w.slice(1); };
const iso = s => Date.parse(s);
const r1 = x => Math.round(x * 10) / 10, r2 = x => Math.round(x * 100) / 100;
const num = n => Number(n).toLocaleString('en-US');
const pct = (a, b) => (b ? Math.round(a / b * 100) : 0);
const at = (obj, path) => String(path).split('.').reduce((v, k) => (v === null || v === undefined ? undefined : v[k]), obj);
const cap = s => (s ? s[0].toUpperCase() + s.slice(1) : s);
const plural = (n, one, many) => `${n} ${n === 1 ? one : (many || one + 's')}`;
const listOf = items => { const a = [...items]; return a.length <= 1 ? (a[0] || '') : a.slice(0, -1).join(', ') + ' and ' + a[a.length - 1]; };
const median = a => { const s = a.filter(Number.isFinite).sort((x, y) => x - y); return s.length ? s[Math.max(0, Math.ceil(s.length / 2) - 1)] : null; };
const duration = p => { const m = /^P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/.exec(String(p || '')); return m && p !== 'P' ? ((+m[1] || 0) * 7 * DAY + (+m[2] || 0) * DAY + (+m[3] || 0) * H + (+m[4] || 0) * MIN + (+m[5] || 0) * 1000) : null; };
/** Dates and times in UTC, as the record keeps them */
const d = t => new Date(t);
const fmtDate = t => `${d(t).getUTCDate()} ${MONTHS[d(t).getUTCMonth()].slice(0, 3)} ${d(t).getUTCFullYear()}`;
const fmtDay = t => `${d(t).getUTCDate()} ${MONTHS[d(t).getUTCMonth()].slice(0, 3)}`;
const fmtLongDay = t => `${d(t).getUTCDate()} ${MONTHS[d(t).getUTCMonth()]}`;
const hhmm = t => d(t).toISOString().slice(11, 16);
const partOfDay = t => { const h = d(t).getUTCHours(); return h < 5 ? 'night' : h < 12 ? 'morning' : h < 18 ? 'afternoon' : 'evening'; };
/** A span of time as a person says it */
function span(ms) {
    if (ms === null || ms === undefined) return 'no time';
    if (ms < MIN) return 'less than a minute';
    if (ms < H) return plural(Math.round(ms / MIN), 'minute');
    if (ms < 2 * DAY) { const h = r1(ms / H); return `${Number.isInteger(h) ? h : h.toFixed(1)} ${h === 1 ? 'hour' : 'hours'}`; }
    return `${r1(ms / DAY).toFixed(1)} days`;
}
const short = ms => (ms === null || ms === undefined ? '' : ms === 0 ? '0' : ms < H ? `${Math.round(ms / MIN)} min` : ms < 2 * DAY ? `${String(r1(ms / H)).replace(/\.0$/, '')} h` : `${(ms / DAY).toFixed(1)} d`);
const wordsSpan = ms => { const days = Math.round(ms / DAY); if (ms >= 2 * DAY) return `${word(days)} days`; const h = Math.round(ms / H); if (ms >= 2 * H) return `${word(h)} hours`; if (ms >= H) return 'an hour'; const m = Math.round(ms / MIN); return m <= 1 ? 'a minute' : `${word(m)} minutes`; };

function lib(name, global) {
    if (typeof root[global] !== 'undefined') return root[global];
    if (typeof require === 'function' && typeof __dirname === 'string') {
        const path = require('path');
        if (name === 'awa-kpis.js') { const fs = require('fs'), vm = require('vm'), ctx = {}; vm.runInNewContext(fs.readFileSync(path.join(__dirname, name), 'utf8') + '\n;this.M = AWA_MEASURES;', ctx); return ctx.M; }
        return require(path.join(__dirname, name));
    }
    return null;
}

// ---------------------------------------------------------------- words in the first person
const IRREGULAR = { is: 'was', are: 'were', has: 'had', gets: 'got', gives: 'gave', chooses: 'chose', pays: 'paid', makes: 'made', sends: 'sent', takes: 'took', sees: 'saw', hears: 'heard', says: 'said', does: 'did', buys: 'bought', keeps: 'kept', lets: 'let', puts: 'put', leaves: 'left', finds: 'found', tells: 'told', writes: 'wrote', goes: 'went', comes: 'came', meets: 'met', knows: 'knew', reads: 'read', speaks: 'spoke', brings: 'brought', holds: 'held', wins: 'won', loses: 'lost', sells: 'sold', thinks: 'thought', feels: 'felt', understands: 'understood', becomes: 'became', begins: 'began', runs: 'ran', sits: 'sat', stands: 'stood' };
const DOUBLE = new Set(['cancels', 'signals', 'travels', 'labels', 'models', 'totals', 'stops', 'plans', 'admits', 'submits', 'commits', 'permits', 'regrets', 'prefers', 'refers', 'transfers', 'occurs', 'controls', 'patrols', 'enrols', 'compels', 'expels', 'propels']);
/** "Applies" → "applied", "Uploads" → "uploaded", "Is" → "was": a present third-person verb in the past */
function past(verb) {
    const v = verb.toLowerCase();
    if (IRREGULAR[v]) return IRREGULAR[v];
    if (DOUBLE.has(v)) { const stem = v.slice(0, -1); return stem + stem.slice(-1) + 'ed'; }
    if (/[^aeiou]ies$/.test(v)) return v.slice(0, -3) + 'ied';
    if (/(ss|sh|ch|x|zz|o)es$/.test(v)) return v.slice(0, -2) + 'ed';
    if (/es$/.test(v) && /[^aeiou][aeiou][^aeiouwxy]es$|[cgsvz]es$|[^aeiou]les$|ates$|ines$|ures$|ses$|izes$|yzes$|kes$|pes$|tes$|des$|nes$/.test(v)) return v.slice(0, -1) + 'd';
    if (/s$/.test(v)) return v.slice(0, -1) + (/e$/.test(v.slice(0, -1)) ? 'd' : 'ed');
    return v + 'ed';
}
const VERBY = /^(is|are|has|[a-z]+s)$/i;
/** A touchpoint's name, "Applies on the web form", as the customer says it: "I applied on the web form" */
function firstPerson(name) {
    const words = String(name || '').trim().split(/\s+/);
    if (!words.length || !VERBY.test(words[0]) || /ss$/.test(words[0].toLowerCase())) return `I had “${name}”`;
    const out = [past(words[0])];
    for (let i = 1; i < words.length; i++) {
        const w = words[i];
        if ((words[i - 1] === 'or' || words[i - 1] === 'and') && VERBY.test(w) && i > 1 && /^[a-z]+s$/.test(w) && !/ss$/.test(w) && i <= 4) out.push(past(w));
        else out.push(w.replace(/^(its|their)$/i, 'my').replace(/^(it|them)$/i, 'it'));
    }
    return 'I ' + out.join(' ');
}
const fillData = (text, data) => String(text || '').replace(/\{([a-zA-Z0-9_.]+)\}/g, (m, k) => {
    const v = at(data, k);
    if (v === undefined || v === null) return m;
    if (typeof v === 'number') return num(v);
    if (typeof v === 'string') return v.replace(/_/g, ' ');
    return String(v);
});

// ---------------------------------------------------------------- the record of one journey, read once
function read(record, options, jk) {
    const MEASURES = lib('awa-kpis.js', 'AWA_MEASURES');
    const M = options.measures || MEASURES.compute_measures(record);
    const J = record.journeys[jk], D = J.definition, asOf = iso(record.as_of || M.as_of);
    const node = new Map(), actorOf = new Map(), roleName = new Map(), wfName = new Map();
    for (const w of record.workflows) {
        wfName.set(w.id, w.name);
        const roles = new Map((w.roles || []).map(r => [r.id, r]));
        for (const a of w.activities || []) { node.set(a.id, a.name); const r = roles.get(a.role_id) || {}; actorOf.set(a.id, a.actor_type || r.actor_type || 'application'); roleName.set(a.id, r.name || ''); }
        for (const e of w.events || []) node.set(e.id, e.name);
        for (const x of w.decision_nodes || []) node.set(x.id, x.name);
    }
    const named = data => { const paths = options.subject_name || []; if (!Array.isArray(paths) || !data) return undefined; const parts = paths.map(p => at(data, p)).filter(v => v !== undefined && v !== null && v !== ''); return parts.length ? parts.join(' ') : undefined; };
    const stages = (D.stages || []).map((s, i) => ({ id: s.id, name: s.name, owner: s.owner || null, max: s.max_duration || null, max_ms: duration(s.max_duration), index: i, description: s.description || '' }));
    const sById = Object.fromEntries(stages.map(s => [s.id, s]));
    const mj = (M.journeys || []).find(m => m.name === D.name) || (M.journeys || [])[jk];
    const tpDef = new Map((D.touchpoints || []).map(t => [t.id, t]));
    const customers = J.instances.map((row, i) => {
        const x = row.instance, name = row.subject_name || named(x.data) || (x.data && x.data.name) || x.subject_key;
        const parts = String(name).split(/\s+/);
        const hist = (x.stage_history || []).map(h => ({ stage: h.stage_id, from: iso(h.entered_at), to: h.left_at ? iso(h.left_at) : null, ms: (h.left_at ? iso(h.left_at) : asOf) - iso(h.entered_at) }));
        const stageAt = t => { let s = hist.length ? hist[0].stage : null; for (const h of hist) if (h.from <= t) s = h.stage; return s; };
        const ev = x.events || [];
        const moods = ev.filter(e => e.type === 'journey.sentiment_changed').map(e => ({ seq: e.seq, t: iso(e.time), stage: e.stage_id, value: e.data.value, change: r2(e.data.value - e.data.previous), reason: e.data.reason, basis: e.data.basis }));
        const initial = (D.sentiment && typeof D.sentiment.initial === 'number') ? D.sentiment.initial : 0;
        const moodAt = t => { let v = initial; for (const m of moods) if (m.t <= t) v = m.value; return v; };
        const moodEnd = hist.map(h => ({ stage: h.stage, mood: moodAt(h.to || asOf) }));
        const tps = ev.filter(e => e.type === 'journey.touchpoint').map(e => ({ seq: e.seq, t: iso(e.time), stage: e.stage_id, id: e.data.touchpoint_id, name: e.data.name, party: e.data.party, direction: e.data.direction, channel: e.data.channel, technology: e.data.technology, artefacts: e.data.artefacts || [] }));
        const subj = tps.filter(t => t.party === 'subject');
        const marks = subj.map(t => ({ t: t.t, seq: t.seq }));
        if (x.status === 'active') marks.push({ t: asOf, seq: null });
        let silence = { ms: 0 };
        for (let k = 1; k < marks.length; k++) { const ms = marks[k].t - marks[k - 1].t; if (ms > silence.ms) silence = { ms, from: marks[k - 1].t, to: marks[k].t, seq_from: marks[k - 1].seq, seq_to: marks[k].seq, stage: stageAt((marks[k - 1].t + marks[k].t) / 2), open: marks[k].seq === null }; }
        const runs = row.runs.map((r, ri) => {
            const end = [...r.events].reverse().find(e => /^run\.(completed|failed|cancelled)$/.test(e.type));
            const costs = end ? { cost: +end.data.cost || 0, tokens: (+end.data.input_tokens || 0) + (+end.data.output_tokens || 0) } : { cost: 0, tokens: 0 };
            return { index: ri, run_id: r.run_id, short: String(r.run_id).slice(4, 8), workflow_id: r.workflow_id, workflow: wfName.get(r.workflow_id) || '', events: r.events, status: end ? end.type.slice(4) : 'in_progress', ...costs };
        });
        const started = iso(x.started_at), ended = x.ended_at ? iso(x.ended_at) : null;
        return {
            index: i, id: x.id, key: x.subject_key, name, first: parts[0], initials: (parts[0][0] + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase(),
            status: x.status, stage: x.stage_id, stalled: !!x.stalled, data: x.data || {}, events: ev,
            started, ended, days: r1(((ended || asOf) - started) / DAY), hist, moods, moodEnd, mood: x.sentiment, tps, subj, silence, runs, stageAt,
            cost: runs.reduce((a, r) => a + r.cost, 0), tokens: runs.reduce((a, r) => a + r.tokens, 0),
        };
    });
    return { record, J, D, jk, M, mj, asOf, node, actorOf, roleName, wfName, stages, sById, customers, tpDef, options };
}

// ---------------------------------------------------------------- what the journal says, event by event
function eventText(X, c, run, e) {
    const dd = e.data || {}, n = X.node.get(e.node_id) || dd.node_name || '';
    const who = p => cap(String((p && p.id) || 'someone'));
    switch (e.type) {
        case 'activity.failed': return `${n}: attempt fails (${String((dd.error || {}).code || 'error').toLowerCase().replace(/_/g, ' ')})`;
        case 'activity.completed': return dd.principal && dd.principal.kind === 'person' ? `${who(dd.principal)} decides ${n} by hand` : `${n} done`;
        case 'activity.started': return `${n} starts`;
        case 'guardrail.triggered': return `Guardrail “${dd.name}” ${dd.action === 'block' ? 'blocks' : dd.action === 'redact' ? 'redacts' : 'acts on'} ${dd.tool ? 'the result of ' + dd.tool : n}${dd.check ? ` (${String(dd.check).replace(/_/g, ' ')})` : ''}`;
        case 'contract.escalated': return `Outcome contract hands ${n} to a person`;
        case 'authorization.decided': return dd.decision === 'deny' ? `${who(dd.principal)} refused at ${n}: ${String(dd.reason || '').replace(/_/g, ' ')}` : `${who(dd.principal)} allowed at ${n}`;
        case 'event.timed_out': return `“${dd.name}” never arrives: the wait times out`;
        case 'event.received': return `“${dd.name}” arrives`;
        case 'activity.compensated': return `Undo: ${n}${dd.compensates_activity_name ? ' (for ' + dd.compensates_activity_name + ')' : ''}`;
        case 'run.failed': return `${run.workflow} fails`;
        case 'run.completed': return `${run.workflow} completes`;
        case 'sla.breached': return `Service level “${dd.name}” breached`;
        case 'sla.warning': return `Service level “${dd.name}” warned`;
        case 'subworkflow.started': return `${n || 'A child workflow'} starts a child run`;
        default: return e.type.replace(/\./g, ' ');
    }
}
function journeyText(X, c, e) {
    const dd = e.data || {};
    switch (e.type) {
        case 'journey.touchpoint': return dd.name;
        case 'journey.stalled': return `Journey stalled in ${(X.sById[e.stage_id] || {}).name || e.stage_id}`;
        case 'journey.abandoned': return 'Journey ends: abandoned';
        case 'journey.completed': return 'Journey completed';
        case 'journey.goal_reached': return `Goal reached: ${dd.goal_name || ''}`;
        case 'journey.stage_entered': return `Enters ${dd.stage_name || e.stage_id}`;
        case 'journey.sentiment_changed': return `Mood ${dd.value > 0 ? '+' : ''}${dd.value} (${dd.reason}${dd.basis === 'measured' ? ', said' : ', inferred'})`;
        case 'journey.event_received': return `“${dd.name}” received`;
        default: return e.type.replace('journey.', '').replace(/_/g, ' ');
    }
}

// ---------------------------------------------------------------- narration: a customer's story in their own voice
/** The narrator's choice: a customer who went the whole way, and one who is stuck or failed */
function pickPersonas(X, options) {
    const want = ((options.dossier || {}).personas || []).map(k => X.customers.find(c => c.key === k || c.name === k)).filter(Boolean);
    if (want.length) return want.slice(0, 2);
    const whole = X.customers.filter(c => c.status === 'completed').sort((a, b) => b.hist.length - a.hist.length || b.runs.length - a.runs.length || b.subj.length - a.subj.length || a.index - b.index)[0];
    const stuck = X.customers.filter(c => c !== whole && (c.stalled || c.status === 'active' || c.runs.some(r => r.status === 'failed'))).sort((a, b) => (b.runs.some(r => r.status === 'failed') - a.runs.some(r => r.status === 'failed')) || b.days - a.days || a.index - b.index)[0]
        || X.customers.filter(c => c !== whole && c.status === 'abandoned')[0];
    return [whole, stuck].filter(Boolean);
}
const REASON = { separation_of_duties: 'the person who resolved a file may not also approve it', four_eyes: 'it needed a second person', no_rule: 'no rule lets that role decide it' };

/**
 * Tell one customer's story: paragraphs of sentences, each with its journal references, written by templates from the record.
 * Returns { paragraphs: [[{ text, refs }]], record: [{ ref, t, text }], quote, sentences, references }.
 */
function narrate(X, c, options) {
    const say = (options.dossier || {}).say || {};
    const J = seq => ({ run: 'J', seq });
    const R = (run, seq) => ({ run: run.short, seq });
    const items = [];
    for (const t of c.subj) items.push({ kind: 'tp', t: t.t, tp: t, refs: [J(t.seq)] });
    const unseen = [];
    for (const run of c.runs) {
        const ev = run.events;
        // a guardrail that withheld what the customer sent, once or more, at one step
        const blocks = new Map();
        for (const e of ev) if (e.type === 'guardrail.triggered' && (e.data || {}).action === 'block') { const k = `${e.node_id}|${e.data.name}`; if (!blocks.has(k)) blocks.set(k, []); blocks.get(k).push(e); }
        for (const list of blocks.values()) unseen.push({ kind: 'block', t: iso(list[0].time), list, run, refs: list.map(e => R(run, e.seq)) });
        for (const e of ev) {
            const dd = e.data || {};
            if (e.type === 'guardrail.triggered' && dd.action === 'redact') unseen.push({ kind: 'redact', t: iso(e.time), e, run, refs: [R(run, e.seq)] });
            if (e.type === 'contract.escalated') {
                const person = ev.filter(x => x.type === 'activity.completed' && x.node_id === e.node_id && x.data && x.data.principal && x.data.principal.kind === 'person' && x.seq > e.seq)[0];
                unseen.push({ kind: 'escalated', t: iso(e.time), e, person, run, refs: [R(run, e.seq), ...(person ? [R(run, person.seq)] : [])] });
            }
            if (e.type === 'authorization.decided' && dd.decision === 'deny' && e.node_id) {
                const next = ev.filter(x => x.seq > e.seq && x.node_id === e.node_id && ((x.type === 'authorization.decided' && x.data.decision === 'allow' && x.data.principal && x.data.principal.id !== (dd.principal || {}).id) || (x.type === 'activity.completed' && x.data && x.data.principal && x.data.principal.kind === 'person' && x.data.principal.id !== (dd.principal || {}).id)))[0];
                unseen.push({ kind: 'refused', t: iso(e.time), e, next, run, refs: [R(run, e.seq), ...(next ? [R(run, next.seq)] : [])] });
            }
            if (e.type === 'sla.breached') unseen.push({ kind: 'breach', t: iso(e.time), e, run, refs: [R(run, e.seq)] });
            if (e.type === 'event.timed_out') items.push({ kind: 'timeout', t: iso(e.time), e, run, refs: [R(run, e.seq)] });
            if (e.type === 'run.failed') {
                const undo = ev.filter(x => x.type === 'activity.compensated');
                items.push({ kind: 'failed', t: iso(e.time), e, run, undo, refs: [...undo.map(x => R(run, x.seq)), R(run, e.seq)] });
            }
        }
    }
    unseen.sort((a, b) => a.t - b.t);
    items.sort((a, b) => a.t - b.t || (a.refs[0].seq - b.refs[0].seq));
    const sent = [];
    let last = null;
    let afterSilence = false;
    const when = (t, first) => {
        if (first) return `On a ${WEEKDAYS[d(t).getUTCDay()]} ${partOfDay(t)}`;
        if (afterSilence) { afterSilence = false; return `On ${fmtLongDay(t)}`; }
        const gap = t - last, sameDay = fmtDate(t) === fmtDate(last);
        if (gap < 2 * MIN) return '';
        if (gap < H) return `${cap(wordsSpan(gap))} later`;
        if (sameDay && gap < 6 * H) return `${cap(wordsSpan(gap))} later`;
        if (sameDay) return `The same ${partOfDay(t)}`;
        if (Math.floor(t / DAY) - Math.floor(last / DAY) === 1) return `The next ${partOfDay(t)}`;
        if (gap < 7 * DAY) return `${cap(word(Math.round(gap / DAY)))} days later`;
        return `On ${fmtLongDay(t)}`;
    };
    const tpSentence = (it, first) => {
        const w = when(it.t, first), own = say[it.tp.id] ? fillData(say[it.tp.id], c.data) : firstPerson(it.tp.name);
        const body = /\{[a-z_.]+\}/i.test(own) ? firstPerson(it.tp.name) : own;
        return w ? `${w}, ${body}.` : `${cap(body)}.`;
    };
    const paragraphs = [[], [], []];
    // 1. what I did and what came back to me, until the first thing done out of my sight
    const firstUnseen = unseen.length ? unseen[0].t : Infinity;
    const waitTp = name => (X.D.touchpoints || []).find(t => t.on && t.on.event === name && t.party === 'subject' && t.direction === 'inbound');
    let k = 0;
    for (; k < items.length; k++) {
        const it = items[k];
        if (it.t > firstUnseen || paragraphs[0].length >= 4) break;
        if (it.kind === 'tp') { paragraphs[0].push({ text: tpSentence(it, last === null), refs: it.refs }); last = it.t; }
        else if (it.kind === 'timeout') { const tp = waitTp(it.e.data.name); const W = it.run.events.find(e => e.type === 'event.waiting' && e.data.name === it.e.data.name); const ms = W ? iso(it.e.time) - iso(W.time) : null; paragraphs[0].push({ text: tp ? `${firstPerson(tp.name).replace(/^I /, 'I had not ').replace(/^I had not (\w+)/, (m, v) => 'I had not ' + v)} after ${ms ? wordsSpan(ms) : 'the time given'}.` : `“${it.e.data.name}” did not come in time.`, refs: it.refs }); last = it.t; }
    }
    // 2. what I did not see, the record shows
    const whoOf = p => cap(String((p && p.id) || 'someone'));
    for (const u of unseen) {
        const step = X.node.get((u.e || u.list[0]).node_id) || '';
        let text;
        if (u.kind === 'block') {
            const g = u.list[0].data, times = u.list.length;
            text = g.check === 'prompt_injection'
                ? `the agent reading what I had sent found an instruction hidden inside it, and a guardrail withheld it${times > 1 ? `, ${times === 2 ? 'twice' : word(times) + ' times'}` : ''}.`
                : `a guardrail, “${g.name}”, withheld what reached the agent at ${step}${times > 1 ? `, ${times === 2 ? 'twice' : word(times) + ' times'}` : ''}.`;
        } else if (u.kind === 'redact') text = `a guardrail took ${listOf((u.e.data.categories || ['personal data']).map(x => String(x).replace(/_/g, ' ')))} out of ${step === '' ? 'a message' : 'what ' + step + ' wrote'} before it reached me.`;
        else if (u.kind === 'escalated') text = u.person ? `So a person decided it: ${whoOf(u.person.data.principal)} took ${step} by hand ${wordsSpan(iso(u.person.time) - iso(u.e.time))} later.` : `The outcome contract handed ${step} to a person.`;
        else if (u.kind === 'refused') text = `${whoOf(u.e.data.principal)} was not allowed to decide ${step}: ${REASON[u.e.data.reason] || String(u.e.data.reason || 'the policy refused').replace(/_/g, ' ')}${u.next ? `; ${whoOf(u.next.data.principal)} did` : ''}.`;
        else if (u.kind === 'breach') text = `A promise of the work, “${u.e.data.name}”, was broken while I waited.`;
        paragraphs[1].push({ text, refs: u.refs });
    }
    if (paragraphs[1].length) paragraphs[1][0].text = 'What I did not see, the record shows: ' + paragraphs[1][0].text.replace(/^So /, 'so ').replace(/^A promise/, 'a promise').replace(/^([A-Z][a-z]+ was not allowed)/, '$1');
    // 3. the rest, the silence and the end
    const sil = c.silence;
    let silenceSaid = false;
    for (; k < items.length; k++) {
        const it = items[k];
        if (sil.ms >= 7 * DAY && !silenceSaid && sil.seq_from !== null && it.t > sil.from + DAY) {
            paragraphs[2].push({ text: `Then nothing for ${wordsSpan(sil.ms)}${sil.open ? ', and counting' : ''}.`, refs: [J(sil.seq_from), ...(sil.seq_to !== null ? [J(sil.seq_to)] : [])], silence: true });
            silenceSaid = true; last = sil.to; afterSilence = true;
        }
        if (it.kind === 'tp') {
            const again = paragraphs[2].find(x => x.tp === it.tp.id);
            if (again) { again.again.push(it.t); again.refs.push(...it.refs); again.text = again.base.replace(/\.$/, '') + `, and again on ${listOf(again.again.map(fmtLongDay))}.`; last = it.t; continue; }
            const text = tpSentence(it, last === null);
            paragraphs[2].push({ text, base: text, again: [], tp: it.tp.id, refs: [...it.refs] }); last = it.t;
        }
        else if (it.kind === 'timeout') {
            const tp = waitTp(it.e.data.name), W = it.run.events.filter(e => e.type === 'event.waiting' && e.data.name === it.e.data.name && iso(e.time) <= iso(it.e.time)).pop(), ms = W ? iso(it.e.time) - iso(W.time) : null;
            paragraphs[2].push({ text: tp ? `I had not ${past(String(tp.name).split(/\s+/)[0]).replace(/ed$|d$/, m => m) && firstPerson(tp.name).slice(2).replace(/^(\w+)/, v => { const base = { confirmed: 'confirmed', signed: 'signed', uploaded: 'uploaded' }[v]; return base || v; })} after ${ms ? wordsSpan(ms) : 'the time given'}.` : `On ${fmtLongDay(it.t)}, ${ms ? wordsSpan(ms) + ' on, ' : ''}the wait for “${it.e.data.name}” ran out.`, refs: it.refs });
            last = it.t;
        } else if (it.kind === 'failed') {
            const undo = it.undo.map(x => X.node.get(x.node_id) || (x.data || {}).node_name).filter(Boolean);
            paragraphs[2].push({ text: undo.length ? `The record shows ${word(undo.length)} undo ${undo.length === 1 ? 'step' : 'steps'}: ${listOf(undo)}.` : `${it.run.workflow} failed.`, refs: it.refs });
            last = it.t;
        }
    }
    if (sil.ms >= 7 * DAY && !silenceSaid && sil.seq_from !== null) { paragraphs[2].push({ text: `Then nothing for ${wordsSpan(sil.ms)}${sil.open ? ', and counting' : ''}.`, refs: [J(sil.seq_from), ...(sil.seq_to !== null ? [J(sil.seq_to)] : [])], silence: true }); silenceSaid = true; }
    const lastOut = c.subj.filter(t => t.direction === 'outbound').pop();
    const failedAt = c.runs.map(r => r.events.find(e => e.type === 'run.failed' || e.type === 'event.timed_out')).filter(Boolean).map(e => iso(e.time)).pop();
    if (c.status === 'active' || c.stalled) {
        const what = /^Receives /.test(lastOut ? lastOut.name : '') ? lastOut.name.replace(/^Receives /, '') : lastOut ? `“${lastOut.name}”` : '';
        if (lastOut && (!failedAt || lastOut.t < failedAt)) paragraphs[2].push({ text: `Nobody wrote to tell me: the last thing they sent me was ${what}.`, refs: [J(lastOut.seq)], quote: 'Nobody wrote to tell me.' });
        const stall = c.events.filter(e => e.type === 'journey.stalled').pop();
        paragraphs[2].push({ text: 'As far as the record goes, I am still waiting.', refs: [J(stall ? stall.seq : (c.events[c.events.length - 1] || {}).seq)] });
    } else if (c.status === 'abandoned') {
        const end = c.events.find(e => e.type === 'journey.abandoned');
        paragraphs[2].push({ text: 'That is where my journey ended.', refs: [J(end ? end.seq : (c.events[c.events.length - 1] || {}).seq)] });
    }
    const paras = paragraphs.filter(p => p.length);
    // the record beside the story: every reference, in order of time
    const allRefs = [], seen = new Set();
    for (const p of paras) for (const s of p) for (const r of s.refs) { const key = `${r.run}·${r.seq}`; if (!seen.has(key) && r.seq !== null && r.seq !== undefined) { seen.add(key); allRefs.push(r); } }
    const record = allRefs.map(r => {
        if (r.run === 'J') { const e = c.events.find(x => x.seq === r.seq); return e ? { ref: `J·${r.seq}`, run: 'J', seq: r.seq, t: iso(e.time), text: journeyText(X, c, e) } : null; }
        const run = c.runs.find(x => x.short === r.run), e = run && run.events.find(x => x.seq === r.seq);
        return e ? { ref: `${r.run}·${r.seq}`, run: r.run, seq: r.seq, t: iso(e.time), text: eventText(X, c, run, e) } : null;
    }).filter(Boolean).sort((a, b) => a.t - b.t || (a.run === 'J' ? 0 : 1) - (b.run === 'J' ? 0 : 1));
    const flat = paras.flat();
    const quoteS = flat.find(s => s.quote) || flat.find(s => s.silence) || flat[flat.length - 1];
    const quote = quoteS ? { text: quoteS.quote || quoteS.text, refs: quoteS.refs } : null;
    return { paragraphs: paras, record, quote, sentences: flat.length, references: flat.reduce((a, s) => a + s.refs.length, 0) };
}

/** The facts beside a persona's name: from the options, else from the journey */
function personaFacts(X, c, options, edition) {
    const given = (options.dossier || {}).facts;
    const out = [];
    if (Array.isArray(given)) for (const f of given) { const v = fillData(f.value, c.data); if (!/\{[a-z_.]+\}/i.test(v)) out.push([f.label, v]); }
    out.push(['With us', c.status === 'completed' ? `${c.days.toFixed(1)} days, start to end` : c.status === 'active' ? `${c.days.toFixed(1)} days and counting` : `${c.days.toFixed(1)} days, then left`]);
    out.push(['Touchpoints', `${c.tps.length}, ${c.subj.length} with ${c.first}`]);
    if (edition === 'professional') out.push(['In models and tools', `${X.M.currency ? X.M.currency + ' ' : ''}${c.cost.toFixed(3)}`]);
    return out;
}

/** The blueprint of a persona, top to bottom: what the customer saw beside what was done, by moment or, on a long journey, by stage */
function blueprint(X, c, story) {
    const rows = [];
    const actorWord = { ai_agent: 'AI agent', human: 'person', application: 'system', robot: 'robot' };
    const done = c.runs.flatMap(r => r.events.filter(e => e.type === 'activity.completed').map(e => ({ t: iso(e.time), name: X.node.get(e.node_id) || '', actor: e.data && e.data.principal && e.data.principal.kind === 'person' ? 'human' : X.actorOf.get(e.node_id), ref: { run: r.short, seq: e.seq } })));
    const subj = c.subj;
    const byStage = subj.length > 12;
    if (byStage) {
        for (const h of c.hist) {
            const tps = subj.filter(t => t.stage === h.stage), work = done.filter(x => x.t >= h.from && x.t <= (h.to || X.asOf));
            rows.push({ t: h.from, sees: tps.slice(0, 3).map(t => t.name).join('; ') + (tps.length > 3 ? `; and ${tps.length - 3} more` : ''), behind: summarizeWork(work, actorWord), refs: [...tps.slice(0, 2).map(t => ({ run: 'J', seq: t.seq })), ...work.slice(0, 1).map(x => x.ref)], stage: (X.sById[h.stage] || {}).name, mood: c.moodEnd.find(m => m.stage === h.stage).mood });
        }
    } else {
        subj.forEach((t, i) => {
            const next = subj[i + 1] ? subj[i + 1].t : (c.ended || X.asOf) + 1;
            const work = done.filter(x => x.t >= t.t && x.t < next);
            if (c.silence.ms >= 7 * DAY && c.silence.from === t.t) {
                rows.push({ t: t.t, sees: t.name, behind: summarizeWork(work.filter(x => x.t - t.t < DAY), actorWord), refs: [{ run: 'J', seq: t.seq }], mood: moodAt(c, t.t) });
                rows.push({ silence: true, ms: c.silence.ms, behind: summarizeWork(work.filter(x => x.t - t.t >= DAY), actorWord) || 'Waiting', refs: [] });
            } else rows.push({ t: t.t, sees: t.name, behind: summarizeWork(work, actorWord), refs: [{ run: 'J', seq: t.seq }, ...work.slice(-1).map(x => x.ref)], mood: moodAt(c, t.t) });
        });
        // what the customer did not see, at its moment
        for (const p of story.paragraphs[1] && story.paragraphs.length === 3 ? story.paragraphs[1] : []) {
            const rec = story.record.find(r => r.ref === `${p.refs[0].run}·${p.refs[0].seq}`);
            if (rec) rows.push({ t: rec.t, sees: null, behind: p.text.replace(/^What I did not see, the record shows: /, '').replace(/^\w/, ch => ch.toUpperCase()).replace(/\bmy\b/g, 'the').replace(/\bI had sent\b/g, `${c.first} had sent`).replace(/\bme\b/g, c.first).replace(/\bI\b/g, c.first), refs: p.refs, unseen: true, mood: moodAt(c, rec.t) });
        }
        rows.sort((a, b) => (a.t ?? (c.silence.from + 1)) - (b.t ?? (c.silence.from + 1)));
    }
    return { by_stage: byStage, rows: rows.slice(0, 14) };
}
const moodAt = (c, t) => { let v = 0; for (const m of c.moods) if (m.t <= t) v = m.value; return v; };
function summarizeWork(work, actorWord) {
    if (!work.length) return '';
    const by = new Map();
    for (const x of work) { const k = x.actor || 'application'; if (!by.has(k)) by.set(k, []); if (!by.get(k).includes(x.name)) by.get(k).push(x.name); }
    return [...by.entries()].map(([k, names]) => `${listOf(names.slice(0, 3))}${names.length > 3 ? ` and ${names.length - 3} more` : ''} (${names.length > 1 && actorWord[k] !== 'person' ? actorWord[k] + 's' : actorWord[k]})`).join('; ');
}

// ---------------------------------------------------------------- the whole dossier
/**
 * Build the dossier's content.
 * @param record   a portfolio export
 * @param options  the journey view's options (subject_name, glossary, brand, recommendations, dossier)
 * @param settings { edition: 'professional' | 'client', customer?: key or name (client edition), journey?: index,
 *                   evidence?: an evidence report (section 32), recommendations?: a result of awa-recommendations.js,
 *                   source?: where the record comes from, as text, sections?: [chapter ids] }
 */
function build(record, options = {}, settings = {}) {
    options = options || {};
    const edition = settings.edition === 'client' ? 'client' : 'professional';
    const jk = settings.journey || 0;
    const X = read(record, options, jk);
    const { D, M, mj, stages, customers } = X;
    const conf = options.dossier || {};
    const subj = Array.isArray(conf.subject) && conf.subject.length === 2 ? conf.subject : ['customer', 'customers'];
    const N = customers.length;
    const recEngine = lib('awa-recommendations.js', 'AWA_RECOMMENDATIONS');
    const recResult = settings.recommendations || (recEngine ? recEngine.compute(record, { ...options, measures: M }) : null);
    const recsAll = recResult ? ((recResult.journeys.find(j => j.name === D.name) || recResult.journeys[jk] || {}).recommendations || []) : [];
    const cur = M.currency ? M.currency + ' ' : '';
    const JM = mj.measures, T = M.totals;
    const client = edition === 'client' ? customers.find(c => c.key === settings.customer || c.name === settings.customer || c.id === settings.customer) || customers[0] : null;
    const glossaryLib = lib('awa-glossary.js', 'AWA_GLOSSARY');

    // the stages, with their measures
    const stageM = id => ((mj.stages || []).find(s => s.id === id || s.name === (X.sById[id] || {}).name) || { measures: {} }).measures;
    const stageRows = stages.map(s => {
        const m = stageM(s.id), entered = (m['stage.entered'] || {}).value || 0, conv = (m['stage.conversion'] || {}).value;
        const stays = customers.flatMap(c => c.hist.filter(h => h.stage === s.id).map(h => ({ c, ms: h.ms, open: !h.to })));
        const longest = stays.reduce((a, x) => (x.ms > (a ? a.ms : -1) ? x : a), null);
        const moods = customers.flatMap(c => c.moodEnd.filter(h => h.stage === s.id).map(h => h.mood));
        const breach = m['stage.breach_rate'] || {};
        return { ...s, entered, completed: conv === null || conv === undefined ? 0 : Math.round(conv * ((m['stage.conversion'] || {}).n || entered)),
            median_ms: (m['stage.duration_median_ms'] || {}).value, longest_ms: longest ? longest.ms : null, longest_who: longest ? longest.c.first : null, longest_open: longest ? longest.open : false,
            stalled: breach.value !== null && breach.value !== undefined ? Math.round(breach.value * breach.n) : 0, abandoned: (m['stage.abandoned'] || {}).value || 0,
            mood_mean: moods.length ? r2(moods.reduce((a, b) => a + b, 0) / moods.length) : null, mood_n: moods.length, mood_min: moods.length ? Math.min(...moods) : null };
    });

    // the work: who does what, defined and done
    const wfIds = [...new Set(customers.flatMap(c => c.runs.map(r => r.workflow_id)))];
    const wfs = record.workflows.filter(w => wfIds.includes(w.id));
    const ACTOR = { application: 'Systems', ai_agent: 'AI agents', human: 'People', robot: 'Robots' };
    const defined = {}, completed = {};
    for (const w of wfs) for (const a of w.activities || []) { if (a.compensation_for || /^(Refund|Cancel|Undo)/.test(a.name) && false) continue; const k = X.actorOf.get(a.id); defined[k] = (defined[k] || 0) + 1; }
    for (const c of customers) for (const r of c.runs) for (const e of r.events) if (e.type === 'activity.completed') { const k = e.data && e.data.principal && e.data.principal.kind === 'person' ? 'human' : X.actorOf.get(e.node_id); completed[k] = (completed[k] || 0) + 1; }
    const people = customers.flatMap(c => c.runs.flatMap(r => r.events.filter(e => e.type === 'activity.completed' && e.data && e.data.principal && e.data.principal.kind === 'person').map(e => {
        const refused = r.events.find(x => x.type === 'authorization.decided' && x.data.decision === 'deny' && x.node_id === e.node_id && x.seq < e.seq);
        return { customer: c.index, name: c.name, first: c.first, step: X.node.get(e.node_id), who: cap(e.data.principal.id), waited_ms: e.data.waited_ms || null, run: r.short, seq: e.seq, refused: refused ? { who: cap(refused.data.principal.id), reason: refused.data.reason } : null };
    })));
    const tokensBy = [];
    for (const w of wfs) { const m = (M.workflows || []).find(x => x.name === w.name); if (m) for (const a of m.activities) if ((a.measures['activity.tokens'] || {}).value) tokensBy.push({ activity: a.name, workflow: w.name, tokens: a.measures['activity.tokens'].value }); }
    tokensBy.sort((a, b) => b.tokens - a.tokens || (a.activity < b.activity ? -1 : 1));
    const tokensTotal = wfs.reduce((s, w) => { const m = (M.workflows || []).find(x => x.name === w.name); return s + (m ? ((m.measures['workflow.input_tokens'] || {}).value || 0) + ((m.measures['workflow.output_tokens'] || {}).value || 0) : 0); }, 0);
    const runsAll = customers.flatMap(c => c.runs.map(r => ({ c, r })));
    const contracts = runsAll.flatMap(({ r }) => r.events.filter(e => e.type === 'contract.checked'));
    const guards = runsAll.flatMap(({ c, r }) => r.events.filter(e => e.type === 'guardrail.triggered').map(e => ({ c, r, e })));
    const refusals = runsAll.flatMap(({ c, r }) => r.events.filter(e => e.type === 'authorization.decided' && e.data.decision === 'deny').map(e => ({ c, r, e })));
    const escalations = runsAll.flatMap(({ c, r }) => r.events.filter(e => e.type === 'contract.escalated').map(e => ({ c, r, e })));
    const slaEvents = runsAll.flatMap(({ c, r }) => r.events.filter(e => e.type === 'sla.warning' || e.type === 'sla.breached').map(e => ({ c, r, e })));
    const compensations = runsAll.flatMap(({ c, r }) => r.events.filter(e => e.type === 'activity.compensated').map(e => ({ c, r, e })));
    const runEvents = runsAll.reduce((a, { r }) => a + r.events.length, 0), journeyEvents = customers.reduce((a, c) => a + c.events.length, 0);

    // the promise: the service level of the workflow that starts the journey
    const startWf = record.workflows.find(w => (D.triggers || []).some(t => t.start_workflow === w.id)) || wfs[0];
    const promiseIso = conf.promise === false ? null : conf.promise || (startWf && startWf.sla && startWf.sla.target_time) || null, promiseMs = duration(promiseIso);
    const promiseName = startWf && startWf.sla ? startWf.sla.name : null;
    const past = promiseMs ? customers.filter(c => c.days * DAY > promiseMs) : [];
    const completedN = customers.filter(c => c.status === 'completed').length, abandonedN = customers.filter(c => c.status === 'abandoned').length, activeN = N - completedN - abandonedN;
    const goal = (D.goals || [])[0];
    const asOf = X.asOf, start = Math.min(...customers.map(c => c.started));

    // figures, each with the measure it is
    const fig = (id, value, n, text, show, unit) => ({ measure: id, value, n, text, show, unit });
    const fpy = T['workflow.first_pass_yield'], cpr = T['workflow.contract_pass_rate'], dur = JM['journey.duration_median_ms'], moodEnd = JM['journey.mood_end'], measured = JM['journey.mood_measured_share'];
    const figures = [
        fig('journey.completion_rate', JM['journey.completion_rate'].value, N, `${subj[1]} reached the end${goal ? ', “' + goal.name + '”' : ''}`, `${completedN} of ${N}`, `${pct(completedN, N)}%`),
        fig('journey.duration_median_ms', dur.value, dur.n, `median from the start to the end`, dur.value !== null ? `${(dur.value / DAY).toFixed(1)} d` : 'no value', `n = ${dur.n}`),
        promiseMs ? fig('workflow.sla_warnings', past.length, N, `journeys went past the ${Math.round(promiseMs / DAY)}-day promise`, `${past.length} of ${N}`, `${pct(past.length, N)}%`) : fig('journey.stall_rate', JM['journey.stall_rate'].value, N, `journeys stalled`, `${Math.round(JM['journey.stall_rate'].value * N)} of ${N}`, ''),
        fig('workflow.first_pass_yield', fpy.value, fpy.n, 'runs right first time, without a failed attempt', `${Math.round(fpy.value * fpy.n)} of ${fpy.n}`, `${pct(Math.round(fpy.value * fpy.n), fpy.n)}%`),
        fig('journey.cost_per_journey', JM['journey.cost_per_journey'].value, N, 'per journey in models and tools; people’s time is not costed', `${cur.replace('EUR ', '€')}${(JM['journey.cost_per_journey'].value || 0).toFixed(3)}`, `n = ${N}`),
        fig('journey.mood_end', moodEnd.value, moodEnd.n, `mood at the end, on a scale of −2 to +2; ${measured.value ? `${pct(Math.round(measured.value * measured.n), measured.n)}% said` : 'inferred by rule, none said'}`, moodEnd.value === null ? 'no value' : `${moodEnd.value > 0 ? '+' : ''}${moodEnd.value.toFixed(2)}`, `n = ${moodEnd.n}`),
    ];

    // the personas and their stories
    const chosen = client ? [client] : pickPersonas(X, options);
    const personas = chosen.map((c, i) => {
        const story = narrate(X, c, options);
        const recsFor = recsAll.filter(r => r.customers.some(x => x.key === c.key));
        const hasLeft = c.status === 'abandoned';
        return {
            key: c.key, name: c.name, first: c.first, initials: c.initials, index: c.index, status: c.status, stuck: c.status === 'active' || c.stalled || c.runs.some(r => r.status === 'failed'),
            role: i === 0 && !client ? 'the whole way' : client ? 'your journey' : hasLeft ? 'a journey that ended early' : `stuck in ${(X.sById[c.stage] || {}).name || c.stage}`,
            stage: (X.sById[c.stage] || {}).name || c.stage, days: c.days, facts: personaFacts(X, c, options, edition), story, blueprint: blueprint(X, c, story),
            silence: c.silence.ms ? { days: r1(c.silence.ms / DAY), from: c.silence.from, to: c.silence.to, stage: (X.sById[c.silence.stage] || {}).name || null, open: !!c.silence.open } : null,
            hist: c.hist.map(h => ({ stage: h.stage, name: (X.sById[h.stage] || {}).name, from: h.from, to: h.to, ms: h.ms })),
            tps: c.subj.map(t => ({ t: t.t, name: t.name, direction: t.direction, seq: t.seq })), moods: c.moods.map(m => ({ t: m.t, value: m.value, change: m.change, reason: m.reason, basis: m.basis, seq: m.seq })),
            started: c.started, ended: c.ended, runs: c.runs.map(r => ({ short: r.short, workflow: r.workflow, status: r.status })),
            decisions: people.filter(p => p.customer === c.index).length, refused: refusals.filter(x => x.c === c).length, cost: edition === 'professional' ? c.cost : null,
            recommendations: recsFor.map(r => ({ rank: r.rank, id: r.id, title: r.title })),
            undo: c.runs.flatMap(r => r.events.filter(e => e.type === 'activity.compensated').map(e => X.node.get(e.node_id) || '')),
        };
    });

    // the summary's three findings
    const silenceRec = recsAll.find(r => r.type === 'silence');
    const findings = [];
    if (silenceRec) {
        const f = silenceRec.findings.find(x => x.rule === 'R10');
        findings.push({ title: `${silenceRec.stage_name} is a long silence`, text: `${f.count === f.of ? `All ${f.of}` : `${f.count} of ${f.of}`} ${subj[1]} who reached ${silenceRec.stage_name} heard nothing for a week or more, a median of ${Math.round(f.median_days)} days, the longest ${Math.round(f.longest_days)}.`, viz: { kind: 'silence', values: silenceRec.customers.map(x => ({ first: x.first, days: x.silent_days || 0 })).sort((a, b) => a.days - b.days), threshold: 7 } });
    } else if (recsAll[0]) findings.push({ title: recsAll[0].title, text: recsAll[0].finding, viz: null });
    if (people.length) {
        const waits = people.map(p => p.waited_ms).filter(Number.isFinite);
        findings.push({ title: `People step in ${word(people.length)} times`, text: `${cap(word([...new Set(people.map(p => p.who))].length))} people decided at ${word([...new Set(people.map(p => p.step))].length)} steps${waits.length ? `, after a median wait of ${span(median(waits))}` : ''}.${refusals.length ? ` ${cap(word(refusals.length))} of those tasks first went to someone the policy then refused.` : ''}`, viz: { kind: 'people', values: people.map(p => ({ who: p.who, hours: (p.waited_ms || 0) / H })) } });
    }
    if (edition === 'professional') findings.push({ title: 'The safeguards held', text: `The agents met ${contracts.filter(e => e.data.passed).length} of ${contracts.length} outcome contracts; the ${contracts.length - contracts.filter(e => e.data.passed).length} misses went back to the agent or to a person.${guards.length ? ` Guardrails acted ${plural(guards.length, 'time')}: ${listOf(Object.entries(guards.reduce((a, g) => { a[g.e.data.action] = (a[g.e.data.action] || 0) + 1; return a; }, {})).map(([k, v]) => plural(v, { block: 'block', redact: 'redaction', escalate: 'escalation', warn: 'warning' }[k] || k)))}.` : ''}`, viz: { kind: 'contracts', met: contracts.filter(e => e.data.passed).length, of: contracts.length, escalated: escalations.length, guards: guards.length } });
    const headline = `${Word(completedN)} of ${word(N)} ${completedN === 1 ? 'reached' : 'reached'} the end.${silenceRec ? ' The work was quick; the waiting was not.' : ''}`;

    // the chapters
    const allStages = stageRows;
    const timed = stageRows.filter(s => s.max_ms);
    const evidence = settings.evidence || null;
    const term = id => (glossaryLib && glossaryLib.terms ? glossaryLib.terms.find(t => t.id === id) : null);
    const glossary = [...((options.glossary || []).filter(t => t && typeof t.term === 'string' && typeof t.definition === 'string').map(t => ({ term: t.term, definition: t.definition, see: typeof t.see === 'string' ? t.see : 'This journey' }))),
        ...['journey', 'stage', 'touchpoint', 'mood', 'run', 'outcome-contract', 'guardrail', 'separation-of-duties', 'four-eyes', 'service-level', 'compensation', 'counterfactual-replay', 'recommendation', 'impact', 'effort', 'right-first-time']
            .filter(id => !client || ['journey', 'stage', 'touchpoint', 'mood', 'service-level', 'recommendation'].includes(id))
            .map(term).filter(Boolean).map(t => ({ term: t.term, definition: t.definition, see: t.see }))];
    const model = {
        version: 1, edition, lang: 'en',
        meta: {
            title: client ? `${D.name}: ${client.name}’s dossier` : `${D.name} · dossier`, journey: D.name, description: D.description || '', goal: goal ? goal.name : null,
            subject: subj, customers: N, workflows: wfs.map(w => w.name), runs: runsAll.length, run_events: runEvents, journey_events: journeyEvents,
            as_of: asOf, as_of_text: `${fmtDate(asOf)}, ${hhmm(asOf)}`, period: { from: start, to: asOf, text: `${fmtDate(start)} to ${fmtDate(asOf)}`, days: Math.round((asOf - start) / DAY) },
            source: settings.source || null, fictional: conf.fictional || `The ${subj[1]} and the company are fictional.`,
            lead: conf.lead ? conf.lead.replace(/\{Count\}/g, Word(N)).replace(/\{count\}/g, word(N)) : `${Word(N)} ${subj[1]} through ${word(stages.length)} stages: their own stories, the work of agents, people and systems behind them, what the record shows, and what to change.`,
            promise: promiseMs ? { days: Math.round(promiseMs / DAY), name: promiseName } : null, currency: M.currency || null,
            client: client ? { key: client.key, name: client.name, first: client.first } : null,
        },
        cover: { lines: customers.map(c => ({ name: client && c !== client ? null : c.name, first: client && c !== client ? null : c.first, initials: client && c !== client ? null : c.initials, status: c.status, days: c.days, featured: chosen.includes(c), stuck: c.status === 'active' || c.stalled, silence: c.silence.ms >= 7 * DAY ? { from_days: r1((c.silence.from - c.started) / DAY), to_days: r1((c.silence.to - c.started) / DAY) } : null })) },
        summary: { headline, figures: edition === 'client' ? figures.filter(f => f.measure !== 'journey.cost_per_journey') : figures, findings, first: recsAll.slice(0, 3).map(r => ({ rank: r.rank, title: r.title, owner: r.owner, customers: r.customers.length, rules: r.rules, method: r.effect.method })) },
        glance: {
            stages: allStages.map(s => ({ id: s.id, name: s.name, owner: s.owner, max: s.max, max_ms: s.max_ms, median_ms: s.median_ms, entered: s.entered, completed: s.completed, stalled: s.stalled, abandoned: s.abandoned })),
            rows: customers.filter(c => !client || c === client).map(c => ({ name: c.name, first: c.first, initials: c.initials, featured: chosen.includes(c), status: c.status, stuck: c.status === 'active' || c.stalled, days: c.days, stage: c.stage,
                cells: stages.map(s => { const h = c.hist.filter(x => x.stage === s.id); if (!h.length) return null; const ms = h.reduce((a, x) => a + x.ms, 0); return { stage: s.id, ms, open: h.some(x => !x.to), mood: (c.moodEnd.find(m => m.stage === s.id) || {}).mood ?? null }; }) })),
        },
        personas,
        work: {
            workflows: wfs.slice().sort((a, b) => (b === startWf) - (a === startWf)).map(w => ({ name: w.name, description: w.description || '', activities: (w.activities || []).map(a => ({ name: a.name, actor: X.actorOf.get(a.id), undo: !!(a.compensates || a.compensation_for || /^(Refund|Cancel)/.test(a.name)) })),
                bands: ((options.bands || {})[w.name] || []).map(b => b.label), runs: runsAll.filter(x => x.r.workflow_id === w.id).length, sla: w.sla ? { name: w.sla.name, target: w.sla.target_time } : null })),
            defined: Object.entries(defined).map(([k, v]) => ({ actor: ACTOR[k] || k, key: k, count: v })), completed: Object.entries(completed).map(([k, v]) => ({ actor: ACTOR[k] || k, key: k, count: v })),
            controls: [
                ['Outcome contracts', `${wfs.reduce((a, w) => a + (w.activities || []).filter(x => x.outcome_contract).length, 0)} activities`, `${contracts.filter(e => e.data.passed).length} of ${contracts.length} checks met; ${plural(escalations.length, 'handed to a person', 'handed to a person')}`],
                ['Guardrails', `${new Set(guards.map(g => g.e.data.name)).size} acted`, `${plural(guards.length, 'action')}: ${listOf(Object.entries(guards.reduce((a, g) => { a[g.e.data.action] = (a[g.e.data.action] || 0) + 1; return a; }, {})).map(([k, v]) => `${v} ${k}`)) || 'none'}`],
                ['Authorization', `${refusals.length} refusals`, refusals.length ? listOf(refusals.map(x => `${cap(x.e.data.principal.id)} (${String(x.e.data.reason).replace(/_/g, ' ')})`)) : 'no refusal'],
                ['Service levels', `${wfs.filter(w => w.sla).length + wfs.reduce((a, w) => a + (w.activities || []).filter(x => x.sla).length, 0)} defined`, `${plural(slaEvents.filter(x => x.e.type === 'sla.warning').length, 'warning')}, ${plural(slaEvents.filter(x => x.e.type === 'sla.breached').length, 'breach', 'breaches')}`],
                ['Compensation', `${compensations.length} undo steps used`, compensations.length ? listOf([...new Set(compensations.map(x => x.c.first))]) : 'never needed'],
            ],
        },
        analysis: {
            funnel: allStages.map(s => ({ name: s.name, entered: s.entered, completed: s.completed, lost: s.entered - s.completed, side: s.entered < Math.max(...allStages.map(x => x.entered)) && allStages.indexOf(s) > 0 && allStages[allStages.indexOf(s) + 1] && allStages[allStages.indexOf(s) + 1].entered > s.entered })),
            time: timed.map(s => ({ name: s.name, max: s.max, max_ms: s.max_ms, median_ms: s.median_ms, share: s.median_ms !== null && s.median_ms !== undefined ? s.median_ms / s.max_ms : null, longest_ms: s.longest_ms, longest_share: s.longest_ms !== null ? s.longest_ms / s.max_ms : null, longest_who: client ? null : s.longest_who, longest_open: s.longest_open })),
            mood: allStages.map(s => ({ name: s.name, mean: s.mood_mean, n: s.mood_n, min: s.mood_min, values: customers.flatMap(c => c.moodEnd.filter(h => h.stage === s.id).map(h => h.mood)) })),
            mood_said: measured.value ? Math.round(measured.value * measured.n) : 0, mood_changes: customers.reduce((a, c) => a + c.moods.length, 0),
            people: client ? people.filter(p => p.customer === client.index) : people,
            cost: edition === 'professional' ? { total: (T['workflow.cost'] || {}).value || 0, per_journey: JM['journey.cost_per_journey'].value, by_customer: customers.map(c => ({ first: c.first, initials: c.initials, cost: c.cost, completed: c.status === 'completed' })), tokens: tokensBy.slice(0, 4), tokens_total: tokensTotal } : null,
            right_first_time: wfs.map(w => { const rs = runsAll.filter(x => x.r.workflow_id === w.id); return { workflow: w.name, runs: rs.map(({ c, r }) => ({ initials: c.initials, first: c.first, ok: r.status === 'completed' && !r.events.some(e => e.type === 'activity.failed' || e.type === 'activity.compensated') })) }; }),
            trust: edition === 'professional' ? [
                ...guards.map(g => ({ by: 'Guardrail', what: g.e.data.action === 'block' ? 'blocked' : g.e.data.action === 'redact' ? 'redacted' : g.e.data.action, rule: g.e.data.name, for: g.c.first, refs: [`${g.r.short}·${g.e.seq}`] })),
                ...escalations.map(x => ({ by: 'Contract', what: 'handed to a person', rule: X.node.get(x.e.node_id), for: x.c.first, refs: [`${x.r.short}·${x.e.seq}`] })),
                ...refusals.map(x => ({ by: 'Policy', what: `refused ${cap(x.e.data.principal.id)}`, rule: String(x.e.data.reason).replace(/_/g, ' '), for: x.c.first, refs: [`${x.r.short}·${x.e.seq}`] })),
            ] : null,
            contracts: { met: contracts.filter(e => e.data.passed).length, of: contracts.length },
            first_pass_yield: { value: fpy.value, n: fpy.n, ok: Math.round(fpy.value * fpy.n) },
        },
        recommendations: {
            list: (client ? recsAll.filter(r => r.customers.some(x => x.key === client.key)) : recsAll).map(r => ({
                rank: r.rank, id: r.id, title: r.title, kind: r.kind, stage: r.stage_name, owner: r.owner, rules: r.rules, trigger: r.trigger, impact: r.impact, effort: r.effort, priority: r.priority,
                customers: client ? 1 : r.customers.length, who: client ? [client.first] : r.customers.map(x => x.first), finding: client ? clientText(r, client) : r.finding, action: r.action,
                method: r.effect.method, effect: client ? 'We will measure its effect after the change, and tell you what we learn.' : r.effect.text, before: client ? null : r.effect.before || null, after: client ? null : r.effect.after || null, origin: r.origin,
            })),
            total: recsAll.length, rules: recResult ? recResult.rules.map(x => ({ id: x.id, name: x.name, threshold: x.threshold })) : [],
            thresholds: recResult ? recResult.thresholds : null,
            empty: recResult ? Object.values((recResult.journeys.find(j => j.name === D.name) || {}).checks || {}).filter(c => !recsAll.some(r => r.stage === c.stage) && c.entered).map(c => c.name) : [],
        },
        compliance: evidence ? complianceOf(evidence, edition) : null,
        glossary,
        method: [
            'The measures come from awa-kpis.js, the same code as awa measures and the measures page; every figure carries its count.',
            `The customers’ words are written from the record by the dossier’s narrator: each sentence cites the journal records it rests on, no sentence states a feeling the record does not state${edition === 'client' ? ', and no other customer is named' : ''}.`,
            'Recommendations come from rules R1 to R12 and the journey’s options; their effects are replayed where AWA can (specification section 20), estimated where it cannot, and marked.',
        ],
        sources: [settings.source, evidence ? 'the evidence report (specification section 32)' : null, 'the journey and workflow definitions in the record', 'the journey view’s options'].filter(Boolean),
        stats: { figures: 0, tables: 0, sentences: personas.reduce((a, p) => a + p.story.sentences, 0), references: personas.reduce((a, p) => a + p.story.references, 0) },
    };
    if (edition === 'client') {
        // a client edition: one customer's own story, no internal cost, no agents' internals, no other customer
        model.analysis.trust = null; model.analysis.cost = null;
        model.analysis.right_first_time = model.analysis.right_first_time.map(w => ({ workflow: w.workflow, runs: w.runs.filter(x => x.first === client.first) })).filter(w => w.runs.length);
        model.work.controls = model.work.controls.filter(c => c[0] !== 'Guardrails' && c[0] !== 'Authorization');
    }
    model.contents = contentsOf(model);
    return model;
}
const clientText = (r, client) => { const me = r.customers.find(x => x.key === client.key) || {}; return `This recommendation rests partly on your own journey${me.silent_days ? `: ${Math.round(me.silent_days)} days without a word from us in ${r.stage_name}` : ''}.`; };
function complianceOf(ev, edition) {
    const S = Object.fromEntries((ev.parts || []).map(p => [p.id, p.summary || {}]));
    const line = id => {
        const s = S[id] || {};
        switch (id) {
            case 'operation': return `${plural(s.runs, 'run')}: ${s.completed} completed, ${s.failed} failed`;
            case 'models': return `${plural((s.models || []).length, 'model')}, ${plural(s.selections, 'selection')}`;
            case 'oversight': return `${plural(s.human_decisions, 'human decision')}, ${plural(s.escalations, 'escalation')}, ${s.four_eyes} under four eyes`;
            case 'outcomes': return `${s.contracts_passed} of ${s.contracts} outcome contracts met`;
            case 'refusals': return `${plural(s.refusals, 'refusal')}: ${s.authorization} by the policy, ${s.guardrails} by ${s.guardrails === 1 ? 'a guardrail' : 'guardrails'}`;
            case 'failures': return `${plural(s.attempts_failed, 'failed attempt')}, ${s.runs_failed} ${s.runs_failed === 1 ? 'run' : 'runs'} failed, ${s.journeys_stalled} ${s.journeys_stalled === 1 ? 'journey' : 'journeys'} stalled`;
            case 'compensations': return `${plural(s.compensations, 'compensation')}, ${s.failed} failed`;
            case 'service_levels': return `${plural(s.warnings, 'warning')}, ${plural(s.breaches, 'breach', 'breaches')}`;
            case 'tools': return `${plural(s.calls, 'tool call')} to ${plural(s.targets, 'target')}`;
            case 'data': return `${num((s.payloads || {}).full || 0)} payloads kept in full`;
            case 'retention': return `${num(s.events || 0)} run events and ${s.journey_events} journey events, no gaps`;
            case 'guardrails': return `${plural(s.triggered, 'action')}: ${Object.entries(s.by_action || {}).filter(([, v]) => v).map(([k, v]) => `${v} ${k.replace(/_/g, ' ')}`).join(', ')}`;
            default: return '';
        }
    };
    const refs = ((ev.frameworks || []).find(f => f.id === 'eu-ai-act') || { references: [] }).references;
    const rows = refs.map(r => {
        const parts = (ev.parts || []).filter(p => (p.serves || []).includes(r.id));
        return { provision: r.label, asks: r.title, parts: parts.map(p => p.id.replace(/_/g, ' ')), holds: parts.slice(0, 2).map(p => line(p.id)).filter(Boolean).join('; ') };
    }).filter(r => r.parts.length);
    return { notice: ev.notice, framework: 'Regulation (EU) 2024/1689 (AI Act)', rows: edition === 'client' ? [] : rows,
        parts: (ev.parts || []).map(p => ({ id: p.id, title: p.title, line: line(p.id), statements: (p.statements || []).length })), short: edition === 'client' };
}
function contentsOf(m) {
    const client = m.edition === 'client';
    return client
        ? [{ n: '01', id: 'voices', title: 'Your journey', sub: 'Every step, in your words, with the record beside it' }, { n: '02', id: 'glance', title: 'Your stages', sub: 'The time at each stage, and what was done for you' }, { n: '03', id: 'recommendations', title: 'For next time', sub: 'What we recommend, and why' }, { n: '04', id: 'appendix', title: 'Your record and these words', sub: 'How this dossier was made; the words it uses' }]
        : [{ n: '01', id: 'summary', title: 'Summary', sub: 'Three findings, the figures with their counts, the first recommendations' },
            { n: '02', id: 'glance', title: 'The journey at a glance', sub: `${cap(word(m.glance.stages.length))} stages, ${word(m.meta.customers)} ${m.meta.subject[1]}, how each ended` },
            { n: '03', id: 'voices', title: 'In their own words', sub: `${listOf(m.personas.map(p => p.name))} tell their journey; the record beside them` },
            { n: '04', id: 'work', title: 'The work behind the journey', sub: `${cap(word(m.work.workflows.length))} workflow${m.work.workflows.length === 1 ? '' : 's'}, who does what, the controls` },
            { n: '05', id: 'analysis', title: 'Analysis', sub: 'Where the days go; cost, right first time, mood and trust' },
            { n: '06', id: 'recommendations', title: 'Recommendations', sub: `${cap(word(m.recommendations.list.length))} changes, ranked, each with its evidence and its owner` },
            { n: '07', id: 'appendix', title: 'Appendix', sub: `${m.compliance ? 'The EU AI Act and the evidence report; ' : ''}glossary, method and sources` }];
}

// ---------------------------------------------------------------- the look: AWA's tokens (design brief, section 4), or a company's brand
const AWA_THEME = { name: 'AWA', tagline: 'Agentic Workflow Architecture', logo: null, display: 'Space Grotesk', body: 'Inter', mode: 'dark',
    paper: '#FFFFFF', paper2: '#F2F3F7', ink: '#0B0F19', ink2: '#3A4456', ink3: '#5A6476', rule: '#D5D9E2', accent: '#4338CA', tint: '#E7E9FD', line: '#6366F1',
    night: '#0B0F19', night2: '#111827', night3: '#1E293B', on: '#F8FAFC', on2: '#CBD5E1', on3: '#94A3B8', acc_n: '#A5B4FC', acc_n2: '#818CF8',
    ok: '#047857', wait: '#A15C07', bad: '#C81E1E', run: '#7E22CE', sky: '#0369A1', ok_n: '#34D399', wait_n: '#FBBF24', bad_n: '#FF6B6D', run_n: '#C084FC', sky_n: '#38BDF8',
    k_speed: '#0369A1', k_quality: '#6D28D9', k_cost: '#A15C07', k_trust: '#047857', k_experience: '#BE185D' };
const hex2 = c => { const m = /^#?([0-9a-f]{6})$/i.exec(String(c || '')); if (!m) return null; const n = parseInt(m[1], 16); return { r: n >> 16, g: (n >> 8) & 255, b: n & 255 }; };
const toHex = c => '#' + [c.r, c.g, c.b].map(v => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('').toUpperCase();
const lum = c => { const f = x => { x /= 255; return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b); };
const contrast = (a, b) => { const x = lum(hex2(a)), y = lum(hex2(b)); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
const mix = (a, b, t) => { const x = hex2(a), y = hex2(b); return toHex({ r: x.r + (y.r - x.r) * t, g: x.g + (y.g - x.g) * t, b: x.b + (y.b - x.b) * t }); };
/** Darken (toward black) or lighten a colour until it reads at `ratio` on `on` */
const reach = (c, on, ratio, toward) => { let x = c; for (let i = 0; i < 40 && contrast(x, on) < ratio; i++) x = mix(x, toward, 0.06); return x; };
/** The dossier's tokens for a brand read by awa-brand.js (read_brand), or AWA's own */
function theme(brand) {
    if (!brand || brand === 'awa' || !brand.colors) return AWA_THEME;
    const top = (brand.colors && brand.colors.top) || {}, h = k => (top[k] ? toHex(top[k]) : null);
    const primary = h('primary') || AWA_THEME.accent, paper = h('surface') || '#FFFFFF';
    const dark = lum(hex2(paper)) < 0.2;
    if (dark) return { ...AWA_THEME, name: brand.name || 'Brand', tagline: brand.description || '', logo: brand.logo_dark || brand.logo || null, display: (brand.fonts || {}).heading || AWA_THEME.display, body: (brand.fonts || {}).body || AWA_THEME.body };
    const ink = h('on-surface') || '#0F172A';
    const accent = reach(primary, paper, 4.6, '#000000'), night = reach(primary, '#FFFFFF', 7, '#000000');
    const ink3 = reach(mix(ink, paper, 0.45), paper, 4.6, '#000000');
    return { ...AWA_THEME, name: brand.name || 'Brand', tagline: brand.description || '', logo: brand.logo || null, display: (brand.fonts || {}).heading || AWA_THEME.display, body: (brand.fonts || {}).body || AWA_THEME.body, mode: 'light',
        paper, paper2: h('surface-container') || '#FFFFFF', ink, ink2: reach(h('on-surface-variant') || mix(ink, paper, 0.25), paper, 7, '#000000'), ink3, rule: mix(ink, paper, 0.84),
        accent, tint: mix(primary, '#FFFFFF', 0.86), line: accent, night, night2: mix(night, '#FFFFFF', 0.06), night3: mix(night, '#FFFFFF', 0.14),
        on: '#FFFFFF', on2: reach(mix(primary, '#FFFFFF', 0.8), night, 4.6, '#FFFFFF'), on3: reach(mix(primary, '#FFFFFF', 0.8), night, 4.6, '#FFFFFF'), acc_n: '#FFFFFF', acc_n2: mix(primary, '#FFFFFF', 0.8) };
}

/** Every sentence of every story, with its references: what a test or the narrator's contract checks */
function sentences(model) { return model.personas.flatMap(p => p.story.paragraphs.flat().map(s => ({ persona: p.key, text: s.text, refs: s.refs }))); }

const api = { build, theme, contrast, AWA_THEME, narrate: (record, options, key) => { const X = read(record, options || {}, 0); return narrate(X, X.customers.find(c => c.key === key) || X.customers[0], options || {}); }, sentences, firstPerson, past, span, short, fmtDate, fmtDay, hhmm, word };
root.AWA_DOSSIER = api;
if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
