// Recommendations from a journey record: twelve rules read the measures (specification section 21)
// and the journal, and join what they find into actions, each with the numbers that fired it, the
// customers behind it, its owner, its impact and effort, and how its effect is known.
//
// The same input as the journey view and awa-kpis.js: a portfolio export (awa journey export, or
// GET /api/v1/journeys/portfolio). No DOM, no clock, no randomness: the same record and options
// give the same recommendations, in the browser (window.AWA_RECOMMENDATIONS) and in Node (require).
//
//   const { compute } = require('./awa-recommendations.js');
//   const result = compute(record, options);          // options: the journey view's options
//
// options.recommendations (all optional):
//   thresholds   { R1: 0.1, R10: "P7D", ... } or { R1: { share: 0.1, min_entries: 5 } }
//   materiality  { cost_per_journey: 1.0 }           a cost below it is not material
//   reminders    ["reminded", ...]                    the touchpoints that are reminders (default: ids or names with "remind")
//   wording      { "<id>": { title?, finding?, action?, effect? } }   the journey's own words for a recommendation
//   rules        domain recommendations: [{ id, title, kind, stage, effort, for: "customer" | "journey",
//                  when: <condition>, finding?, action?, owner?, severity?, rules?: ["R8"], effect?: { method, text } }]
//   replays      { "<id>": summary } written by recommendation-replay.mjs (a path in an options file, read by the page)
//
// A condition is data, never code: { all: [...] }, { any: [...] }, { not: c }, or a test
//   { field: "data.outstanding_debt_eur", gt: 1000 }   on a customer: status, stage, stalled, days, mood,
//                                                        reached.<stage id>, touchpoints.<id>, data.<path>
//   { measure: "stage.abandoned", stage: "application", gte: 1 }   on the journey's measures
// with one of eq, ne, gt, gte, lt, lte, in, exists.
(function (root) {
'use strict';

const DAY = 86400000, H = 3600000;
const RULES = [
    { id: 'R1', name: 'A stage outlasts its time', kind: 'speed', reads: 'stage.breach_rate', threshold: '> 10%, at least 5 entries' },
    { id: 'R2', name: 'The outcome contract hands over', kind: 'quality', reads: 'contract.escalated per run, by activity', threshold: '≥ 10% of runs' },
    { id: 'R3', name: 'A guardrail blocks the same input again', kind: 'trust', reads: 'guardrail.triggered (block), same guardrail, one run', threshold: '≥ 2' },
    { id: 'R4', name: 'The policy refuses a person at a task', kind: 'trust', reads: 'authorization.decided deny', threshold: '≥ 1' },
    { id: 'R5', name: 'Customers need a reminder', kind: 'experience', reads: 'journeys with a reminder touchpoint', threshold: '≥ 10%' },
    { id: 'R6', name: 'Mood falls at a stage', kind: 'experience', reads: 'journey.sentiment_changed, change', threshold: '≤ −0.5' },
    { id: 'R7', name: 'Cost sits on one activity', kind: 'cost', reads: 'activity.tokens ÷ all tokens', threshold: '> 50%' },
    { id: 'R8', name: 'Customers leave at a stage', kind: 'experience', reads: 'stage.abandoned ÷ journeys started', threshold: '≥ 10%' },
    { id: 'R9', name: 'Right first time is low', kind: 'quality', reads: 'workflow.first_pass_yield', threshold: '< 80%' },
    { id: 'R10', name: 'The customer hears nothing', kind: 'experience', reads: 'longest gap between touchpoints with the customer', threshold: '≥ 7 days' },
    { id: 'R11', name: 'An awaited event never comes', kind: 'speed', reads: 'event.timed_out', threshold: '≥ 1' },
    { id: 'R12', name: 'A service level slips', kind: 'speed', reads: 'runs with sla.warning or sla.breached', threshold: '≥ 25%' },
];
const RULE = Object.fromEntries(RULES.map(r => [r.id, r]));
const DEFAULTS = {
    R1: { share: 0.10, min_entries: 5 }, R2: { share: 0.10 }, R3: { count: 2 }, R4: { count: 1 }, R5: { share: 0.10 }, R6: { change: -0.5 },
    R7: { share: 0.5 }, R8: { share: 0.10 }, R9: { yield: 0.8 }, R10: { days: 7 }, R11: { count: 1 }, R12: { share: 0.25 },
};
const MAIN = { R1: 'share', R2: 'share', R3: 'count', R4: 'count', R5: 'share', R6: 'change', R7: 'share', R8: 'share', R9: 'yield', R10: 'days', R11: 'count', R12: 'share' };
const KINDS = ['speed', 'quality', 'cost', 'trust', 'experience'];
const METHODS = ['measured', 'replay', 'replay-live', 'estimate', 'pilot'];
const SEVERITY = { lost: 3, late: 2, friction: 1, cost: 0.25 };
/** How a recommendation of each kind of action changes the work: 1 options, policy or a contract budget; 2 a workflow change; 3 new work for people */
const EFFORT_TEXT = { 1: 'a change of options, policy or a contract budget', 2: 'a workflow change: a timer or a touchpoint', 3: 'new work for people' };

// ---------------------------------------------------------------- small helpers
const iso = s => Date.parse(s);
const r1 = x => Math.round(x * 10) / 10, r2 = x => Math.round(x * 100) / 100;
const pct = (a, b) => b ? Math.round(a / b * 100) : 0;
const pct1 = (a, b) => b ? r1(a / b * 100) : 0;
const fmtPct = (a, b) => { const p = pct1(a, b); return (Number.isInteger(p) ? p : p.toFixed(1)) + '%'; };
const rpct = (a, b) => (b ? Math.round(a / b * 100) : 0) + '%';
const num = n => Number(n).toLocaleString('en-US');
const days = ms => r1(ms / DAY);
const median = a => { const s = a.filter(Number.isFinite).sort((x, y) => x - y); return s.length ? s[Math.max(0, Math.ceil(s.length / 2) - 1)] : null; };
const slug = s => String(s || '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'x';
const first = name => String(name || '').split(' ')[0];
const listNames = names => { const n = [...names]; return n.length <= 1 ? (n[0] || '') : n.slice(0, -1).join(', ') + ' and ' + n[n.length - 1]; };
const plural = (n, one, many) => `${n} ${n === 1 ? one : (many || one + 's')}`;
const WORDS = ['no', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve'];
/** An ISO 8601 duration (P14D, PT2H, P1DT6H) in milliseconds, or null */
function duration(p) {
    const m = /^P(?:(\d+(?:\.\d+)?)W)?(?:(\d+(?:\.\d+)?)D)?(?:T(?:(\d+(?:\.\d+)?)H)?(?:(\d+(?:\.\d+)?)M)?(?:(\d+(?:\.\d+)?)S)?)?$/.exec(String(p || ''));
    if (!m || String(p) === 'P') return null;
    return ((+m[1] || 0) * 7 * DAY) + ((+m[2] || 0) * DAY) + ((+m[3] || 0) * H) + ((+m[4] || 0) * 60000) + ((+m[5] || 0) * 1000);
}
const at = (obj, path) => String(path).split('.').reduce((v, k) => (v === null || v === undefined ? undefined : v[k]), obj);

/** The measures library: awa-kpis.js, as a page loads it or, in Node, from beside this file */
function measuresLib() {
    if (typeof root.AWA_MEASURES !== 'undefined') return root.AWA_MEASURES;
    if (typeof AWA_MEASURES !== 'undefined') return AWA_MEASURES; // eslint-disable-line no-undef
    if (typeof require === 'function' && typeof __dirname === 'string') {
        const fs = require('fs'), path = require('path'), vm = require('vm');
        const ctx = {};
        vm.runInNewContext(fs.readFileSync(path.join(__dirname, 'awa-kpis.js'), 'utf8') + '\n;this.M = AWA_MEASURES;', ctx);
        return ctx.M;
    }
    throw new Error('awa-recommendations.js needs awa-kpis.js (window.AWA_MEASURES) or options.measures');
}

/** The thresholds in force: the defaults, then what the options set (a number sets a rule's main threshold) */
function thresholdsOf(options) {
    const set = ((options || {}).recommendations || {}).thresholds || {};
    const out = {};
    for (const id of Object.keys(DEFAULTS)) {
        out[id] = { ...DEFAULTS[id] };
        const v = set[id];
        if (v === undefined || v === null) continue;
        if (typeof v === 'object' && !Array.isArray(v)) { for (const [k, x] of Object.entries(v)) if (typeof x === 'number' && Number.isFinite(x)) out[id][k] = x; continue; }
        if (id === 'R10' && typeof v === 'string') { const ms = duration(v); if (ms !== null) out[id].days = ms / DAY; continue; }
        if (typeof v === 'number' && Number.isFinite(v)) out[id][MAIN[id]] = v;
    }
    return out;
}
const thresholdText = (id, t) => ({
    R1: `> ${pct(t.R1.share, 1)}%, ≥ ${t.R1.min_entries} entries`, R2: `≥ ${pct(t.R2.share, 1)}% of runs`, R3: `≥ ${t.R3.count}`, R4: `≥ ${t.R4.count}`,
    R5: `≥ ${pct(t.R5.share, 1)}%`, R6: `≤ ${String(t.R6.change).replace('-', '−')}`, R7: `> ${pct(t.R7.share, 1)}%`, R8: `≥ ${pct(t.R8.share, 1)}%`,
    R9: `< ${pct(t.R9.yield, 1)}%`, R10: `≥ ${r1(t.R10.days)} days`, R11: `≥ ${t.R11.count}`, R12: `≥ ${pct(t.R12.share, 1)}%`,
}[id]);

// ---------------------------------------------------------------- conditions: data, never code
const OPS = ['eq', 'ne', 'gt', 'gte', 'lt', 'lte', 'in', 'exists'];
function test(value, c) {
    const op = OPS.find(o => Object.prototype.hasOwnProperty.call(c, o));
    if (!op) return false;
    const want = c[op];
    switch (op) {
        case 'exists': return want ? value !== undefined && value !== null : value === undefined || value === null;
        case 'eq': return value === want;
        case 'ne': return value !== want;
        case 'in': return Array.isArray(want) && want.includes(value);
        default: {
            if (typeof value !== 'number' || typeof want !== 'number' || !Number.isFinite(value)) return false;
            return op === 'gt' ? value > want : op === 'gte' ? value >= want : op === 'lt' ? value < want : value <= want;
        }
    }
}
/** Evaluate a condition against a lookup: field and measure tests read through `get`. Depth is bounded */
function holds(c, get, depth = 0) {
    if (!c || typeof c !== 'object' || depth > 12) return false;
    if (Array.isArray(c.all)) return c.all.every(x => holds(x, get, depth + 1));
    if (Array.isArray(c.any)) return c.any.some(x => holds(x, get, depth + 1));
    if (c.not) return !holds(c.not, get, depth + 1);
    if (typeof c.field === 'string' || typeof c.measure === 'string') return test(get(c), c);
    return false;
}
/** Is a condition well formed? Returns the problems it has, so that a page can say why a rule was left out */
function conditionProblems(c, depth = 0) {
    if (!c || typeof c !== 'object' || Array.isArray(c)) return ['a condition is an object'];
    if (depth > 12) return ['conditions nest at most 12 deep'];
    if (Array.isArray(c.all) || Array.isArray(c.any)) return (c.all || c.any).flatMap(x => conditionProblems(x, depth + 1));
    if (c.not) return conditionProblems(c.not, depth + 1);
    if (typeof c.field !== 'string' && typeof c.measure !== 'string') return ['a test names a field or a measure'];
    if (!OPS.some(o => Object.prototype.hasOwnProperty.call(c, o))) return [`a test uses one of ${OPS.join(', ')}`];
    return [];
}
/** Replace {name} in a text by the value given; nothing else is interpreted */
const fill = (text, vars) => String(text || '').replace(/\{([a-z_]+)\}/g, (m, k) => (vars[k] !== undefined ? String(vars[k]) : m));

// ---------------------------------------------------------------- the record, read once per journey
function readJourney(record, jk, M, options) {
    const J = record.journeys[jk], D = J.definition, asOf = iso(record.as_of || M.as_of);
    const wfById = new Map(record.workflows.map(w => [w.id, w]));
    const node = new Map(), actor = new Map(), roleOf = new Map();
    for (const w of record.workflows) {
        const roles = new Map((w.roles || []).map(r => [r.id, r]));
        for (const a of w.activities || []) { node.set(a.id, { name: a.name, kind: 'activity', w, a }); const r = roles.get(a.role_id) || {}; actor.set(a.id, a.actor_type || r.actor_type); roleOf.set(a.id, r.name); }
        for (const e of w.events || []) node.set(e.id, { name: e.name, kind: 'event', w, e });
        for (const d of w.decision_nodes || []) node.set(d.id, { name: d.name, kind: 'decision', w });
    }
    const named = data => {
        const paths = (options && options.subject_name) || [];
        if (!Array.isArray(paths) || !data) return undefined;
        const parts = paths.map(p => at(data, p)).filter(v => v !== undefined && v !== null && v !== '');
        return parts.length ? parts.join(' ') : undefined;
    };
    const stages = (D.stages || []).map((s, i) => ({ id: s.id, name: s.name, owner: s.owner || null, max_ms: duration(s.max_duration), max: s.max_duration || null, index: i }));
    const stageById = Object.fromEntries(stages.map(s => [s.id, s]));
    const customers = J.instances.map((row, i) => {
        const x = row.instance, name = row.subject_name || named(x.data) || (x.data && x.data.name) || x.subject_key;
        const hist = (x.stage_history || []).map(h => ({ stage: h.stage_id, from: iso(h.entered_at), to: h.left_at ? iso(h.left_at) : null, ms: (h.left_at ? iso(h.left_at) : asOf) - iso(h.entered_at) }));
        const stageAt = t => { let s = null; for (const h of hist) if (h.from <= t) s = h.stage; return s; };
        const tps = (x.events || []).filter(e => e.type === 'journey.touchpoint').map(e => ({ seq: e.seq, t: iso(e.time), stage: e.stage_id, id: e.data.touchpoint_id, name: e.data.name, party: e.data.party }));
        const moods = (x.events || []).filter(e => e.type === 'journey.sentiment_changed').map(e => ({ seq: e.seq, t: iso(e.time), stage: e.stage_id, value: e.data.value, change: r2(e.data.value - e.data.previous), reason: e.data.reason, basis: e.data.basis }));
        // the longest time without a word to or from the customer; an open journey counts to the record's end
        const pts = tps.filter(t => t.party === 'subject');
        const marks = pts.map(t => ({ t: t.t, seq: t.seq, name: t.name }));
        if (x.status === 'active') marks.push({ t: asOf, seq: null, name: null });
        let silence = { ms: 0 };
        for (let k = 1; k < marks.length; k++) {
            const ms = marks[k].t - marks[k - 1].t;
            if (ms > silence.ms) silence = { ms, from: marks[k - 1].t, to: marks[k].t, after_seq: marks[k - 1].seq, after: marks[k - 1].name, before: marks[k].name, stage: stageAt((marks[k - 1].t + marks[k].t) / 2) };
        }
        const runs = row.runs.map((r, ri) => {
            const end = [...r.events].reverse().find(e => /^run\.(completed|failed|cancelled)$/.test(e.type));
            return { index: ri, run_id: r.run_id, short: String(r.run_id).slice(4, 8), workflow_id: r.workflow_id, workflow: (wfById.get(r.workflow_id) || {}).name, events: r.events, status: end ? end.type.slice(4) : 'in_progress' };
        });
        const started = iso(x.started_at), ended = x.ended_at ? iso(x.ended_at) : null;
        return {
            index: i, id: x.id, key: x.subject_key, name, first: first(name), status: x.status, stage: x.stage_id, stalled: !!x.stalled, data: x.data || {},
            days: days((ended || asOf) - started), mood: x.sentiment, hist, tps, moods, silence, runs, stageAt,
        };
    });
    const runsOf = wid => customers.flatMap(c => c.runs.filter(r => r.workflow_id === wid).map(r => ({ c, r })));
    const workflowIds = [...new Set(customers.flatMap(c => c.runs.map(r => r.workflow_id)))];
    const mj = (M.journeys || []).find(m => m.name === D.name) || (M.journeys || [])[jk] || { measures: {}, stages: [] };
    return { J, D, jk, asOf, node, actor, roleOf, stages, stageById, customers, runsOf, workflowIds, wfById, mj };
}

// ---------------------------------------------------------------- the twelve rules
/** Each rule returns findings: { rule, subject, stage?, activity?, workflow?, count, of, share?, text, customers: [index], refs: [{ c, run, seq }] } */
function findings(X, M, T, options) {
    const { stages, customers, node, runsOf, workflowIds, mj } = X;
    const N = customers.length, out = [];
    const F = f => { out.push({ name: RULE[f.rule].name, kind: RULE[f.rule].kind, threshold: thresholdText(f.rule, T), ...f }); };
    const stageM = id => ((mj.stages || []).find(s => s.id === id || s.name === (X.stageById[id] || {}).name) || { measures: {} }).measures;
    const wfM = new Map((M.workflows || []).map(w => [w.name, w]));
    const refOf = (c, r, e) => ({ customer: c.index, run: r ? r.index : null, seq: e ? e.seq : null, journey_seq: null });

    // R1 a stage outlasts its time
    for (const s of stages) {
        const m = stageM(s.id)['stage.breach_rate'];
        if (!m || m.value === null || m.value === undefined || !(m.n >= T.R1.min_entries) || !(m.value > T.R1.share)) continue;
        const who = customers.filter(c => c.hist.some(h => h.stage === s.id && s.max_ms && h.ms > s.max_ms) || (c.stalled && c.stage === s.id));
        const count = Math.round(m.value * m.n);
        F({ rule: 'R1', subject: s.name, stage: s.id, count, of: m.n, share: m.value, text: `${s.name}: ${count} of ${m.n} outlasted the stage's time (${rpct(count, m.n)})`,
            customers: who.map(c => c.index), refs: who.map(c => ({ customer: c.index, run: null, seq: null })) });
    }
    // R2 the outcome contract hands over to a person
    for (const wid of workflowIds) {
        const runs = runsOf(wid), w = X.wfById.get(wid);
        for (const a of (w && w.activities) || []) {
            const esc = runs.map(({ c, r }) => ({ c, r, e: r.events.find(e => e.type === 'contract.escalated' && e.node_id === a.id) })).filter(x => x.e);
            if (!esc.length || esc.length / runs.length < T.R2.share) continue;
            F({ rule: 'R2', subject: a.name, activity: a.id, workflow: w.name, stage: null, count: esc.length, of: runs.length, share: esc.length / runs.length,
                text: `${a.name}: ${esc.length} of ${runs.length} runs handed to a person by the outcome contract (${rpct(esc.length, runs.length)})`,
                customers: esc.map(x => x.c.index), refs: esc.map(x => refOf(x.c, x.r, x.e)) });
        }
    }
    // R3 the same guardrail blocks the same input again, in one run
    for (const c of customers) for (const r of c.runs) {
        const by = new Map();
        for (const e of r.events) if (e.type === 'guardrail.triggered' && (e.data || {}).action === 'block') {
            const k = `${e.data.name}|${e.node_id || ''}|${e.data.tool || ''}`; if (!by.has(k)) by.set(k, []); by.get(k).push(e);
        }
        for (const list of by.values()) if (list.length >= T.R3.count) {
            const g = list[0].data, at_ = (node.get(list[0].node_id) || {}).name;
            F({ rule: 'R3', subject: g.name, activity: list[0].node_id, stage: null, count: list.length, of: null,
                text: `“${g.name}” blocked ${list.length} times in one run${at_ ? ' at ' + at_ : ''}${g.tool ? ', on the same tool, ' + g.tool : ''} (${c.first})`,
                customers: [c.index], refs: list.map(e => refOf(c, r, e)) });
        }
    }
    // R4 the policy refuses a person at a task
    const refusals = customers.flatMap(c => c.runs.flatMap(r => r.events.filter(e => e.type === 'authorization.decided' && (e.data || {}).decision === 'deny' && e.node_id).map(e => ({ c, r, e }))));
    if (refusals.length >= T.R4.count) {
        const byAct = new Map();
        for (const x of refusals) { const k = x.e.node_id; if (!byAct.has(k)) byAct.set(k, []); byAct.get(k).push(x); }
        for (const [aid, list] of byAct) {
            const who = list.map(x => `${x.e.data.principal ? x.e.data.principal.id : 'someone'} (${String(x.e.data.reason || 'refused').replace(/_/g, ' ')})`);
            F({ rule: 'R4', subject: (node.get(aid) || {}).name || aid, activity: aid, stage: null, count: list.length, of: null,
                text: `${(node.get(aid) || {}).name || aid}: ${list.length === 1 ? 'refused ' : list.length + ' refusals: '}${who.join(', ')}`,
                customers: [...new Set(list.map(x => x.c.index))], refs: list.map(x => refOf(x.c, x.r, x.e)),
                people: list.map(x => ({ customer: x.c.index, who: x.e.data.principal ? x.e.data.principal.id : null, reason: x.e.data.reason || null, rule: x.e.data.rule || null })) });
        }
    }
    // R5 customers need a reminder
    const remindIds = new Set(((options.recommendations || {}).reminders) || (X.D.touchpoints || []).filter(t => /remind/i.test(t.id + ' ' + t.name)).map(t => t.id));
    const reminded = customers.filter(c => c.tps.some(t => remindIds.has(t.id)));
    if (reminded.length && reminded.length / N >= T.R5.share) {
        const tp = reminded.map(c => ({ c, t: c.tps.find(t => remindIds.has(t.id)) }));
        F({ rule: 'R5', subject: tp[0].t.name, stage: tp[0].t.stage, count: reminded.length, of: N, share: reminded.length / N,
            text: `${reminded.length} of ${N} journeys needed a reminder (${fmtPct(reminded.length, N)})`,
            customers: reminded.map(c => c.index), refs: tp.map(x => ({ customer: x.c.index, run: null, seq: null, journey_seq: x.t.seq })) });
    }
    // R6 mood falls at a stage
    for (const s of stages) {
        const dips = customers.flatMap(c => c.moods.filter(m => m.stage === s.id && m.change <= T.R6.change).map(m => ({ c, m })));
        if (!dips.length) continue;
        F({ rule: 'R6', subject: s.name, stage: s.id, count: dips.length, of: null,
            text: `${s.name}: ${plural(dips.length, 'fall')} of mood: ${dips.map(d => `${d.c.first} ${String(d.m.change).replace('-', '−')} (${d.m.reason})`).join('; ')}`,
            customers: [...new Set(dips.map(d => d.c.index))], refs: dips.map(d => ({ customer: d.c.index, run: null, seq: null, journey_seq: d.m.seq })),
            dips: dips.map(d => ({ customer: d.c.index, change: d.m.change, reason: d.m.reason, basis: d.m.basis })) });
    }
    // R7 cost sits on one activity
    const acts = [];
    let tokens = 0;
    for (const wid of workflowIds) {
        const w = X.wfById.get(wid), m = w && wfM.get(w.name);
        if (!m) continue;
        tokens += (m.measures['workflow.input_tokens'] || {}).value || 0;
        tokens += (m.measures['workflow.output_tokens'] || {}).value || 0;
        for (const a of m.activities || []) { const v = (a.measures['activity.tokens'] || {}).value; if (v) acts.push({ name: a.name, workflow: w.name, tokens: v, n: a.measures['activity.tokens'].n }); }
    }
    acts.sort((a, b) => b.tokens - a.tokens || (a.name < b.name ? -1 : 1));
    if (acts.length && tokens && acts[0].tokens / tokens > T.R7.share) {
        const a = acts[0], act = [...node.values()].find(n => n.kind === 'activity' && n.name === a.name);
        F({ rule: 'R7', subject: a.name, activity: act ? act.a.id : null, workflow: a.workflow, stage: null, count: a.tokens, of: tokens, share: a.tokens / tokens,
            text: `${a.name}: ${num(a.tokens)} of ${num(tokens)} tokens (${fmtPct(a.tokens, tokens)})`,
            customers: customers.filter(c => c.runs.some(r => r.events.some(e => e.node_id === (act && act.a.id) && e.type === 'activity.completed'))).map(c => c.index), refs: [] });
    }
    // R8 customers leave at a stage
    for (const s of stages) {
        const v = (stageM(s.id)['stage.abandoned'] || {}).value;
        if (!v || v / N < T.R8.share) continue;
        const who = customers.filter(c => c.status === 'abandoned' && c.stage === s.id);
        F({ rule: 'R8', subject: s.name, stage: s.id, count: v, of: N, share: v / N, text: `${s.name}: ${v} of ${N} left here (${fmtPct(v, N)})`,
            customers: who.map(c => c.index), refs: who.map(c => ({ customer: c.index, run: null, seq: null })) });
    }
    // R9 right first time is low
    for (const wid of workflowIds) {
        const w = X.wfById.get(wid), m = w && wfM.get(w.name), v = m && m.measures['workflow.first_pass_yield'];
        if (!v || v.value === null || v.value === undefined || !(v.value < T.R9.yield)) continue;
        const bad = runsOf(wid).filter(({ r }) => r.status !== 'completed' || r.events.some(e => e.type === 'activity.failed' || e.type === 'activity.compensated'));
        const ok = Math.round(v.value * v.n);
        F({ rule: 'R9', subject: w.name, workflow: w.name, stage: null, count: ok, of: v.n, share: v.value, text: `${w.name}: right first time ${ok} of ${v.n} runs (${rpct(ok, v.n)})`,
            customers: [...new Set(bad.map(x => x.c.index))], refs: bad.map(({ c, r }) => ({ customer: c.index, run: r.index, seq: null })) });
    }
    // R10 the customer hears nothing, grouped by the stage the silence falls in
    const silent = customers.filter(c => c.silence.ms >= T.R10.days * DAY && c.silence.stage);
    for (const s of stages) {
        const here = silent.filter(c => c.silence.stage === s.id);
        if (!here.length) continue;
        const reached = customers.filter(c => c.hist.some(h => h.stage === s.id)).length;
        const longest = here.reduce((a, c) => (c.silence.ms > a.silence.ms ? c : a), here[0]);
        F({ rule: 'R10', subject: s.name, stage: s.id, count: here.length, of: reached, share: here.length / reached,
            median_days: days(median(here.map(c => c.silence.ms))), longest_days: days(longest.silence.ms), longest: longest.index,
            text: `${s.name}: ${here.length} of ${reached} who reached it heard nothing for ${r1(T.R10.days)} days or more (median ${Math.round(days(median(here.map(c => c.silence.ms))))} days, longest ${Math.round(days(longest.silence.ms))}, ${longest.first})`,
            customers: here.map(c => c.index), refs: here.map(c => ({ customer: c.index, run: null, seq: null, journey_seq: c.silence.after_seq })),
            silences: here.map(c => ({ customer: c.index, days: days(c.silence.ms), after: c.silence.after, before: c.silence.before, journey_seq: c.silence.after_seq })) });
    }
    // R11 an awaited event never comes
    const outs = customers.flatMap(c => c.runs.flatMap(r => r.events.filter(e => e.type === 'event.timed_out').map(e => ({ c, r, e }))));
    const byWait = new Map();
    for (const x of outs) { const k = `${x.e.data.name}|${x.c.index}`; if (!byWait.has(k)) byWait.set(k, []); byWait.get(k).push(x); }
    if (outs.length >= T.R11.count) for (const list of byWait.values()) {
        const x = list[0], ev = node.get(x.e.node_id), def = ev && ev.e && ev.e.event_definition || {};
        F({ rule: 'R11', subject: x.e.data.name, event: x.e.node_id, stage: x.c.stageAt(iso(x.e.time)), count: list.length, of: null,
            text: `“${x.e.data.name}” did not arrive in time${list.length > 1 ? `, ${WORDS[list.length] || list.length} times` : ''} (${x.c.first})`, wait_ms: duration(def.timeout), timeout_edge: def.timeout_edge_id || null,
            customers: [x.c.index], refs: list.map(y => refOf(y.c, y.r, y.e)) });
    }
    // R12 a service level slips
    for (const wid of workflowIds) {
        const runs = runsOf(wid), slip = runs.filter(({ r }) => r.events.some(e => e.type === 'sla.warning' || e.type === 'sla.breached'));
        if (!slip.length || slip.length / runs.length < T.R12.share) continue;
        const w = X.wfById.get(wid), by = new Map();
        for (const { c, r } of slip) for (const e of r.events) if (e.type === 'sla.warning' || e.type === 'sla.breached') {
            const k = e.data.name; if (!by.has(k)) by.set(k, { name: k, warnings: 0, breaches: 0, runs: new Set() });
            const b = by.get(k); b[e.type === 'sla.warning' ? 'warnings' : 'breaches']++; b.runs.add(r.run_id);
        }
        const parts = [...by.values()].map(b => `“${b.name}”: ${b.runs.size} of ${runs.length} runs${b.breaches ? `, ${plural(b.breaches, 'breach', 'breaches')}` : ''}${b.warnings ? `, ${plural(b.warnings, 'warning')}` : ''}`);
        F({ rule: 'R12', subject: w.name, workflow: w.name, stage: null, count: slip.length, of: runs.length, share: slip.length / runs.length,
            text: `${w.name}: ${slip.length} of ${runs.length} runs slipped (${rpct(slip.length, runs.length)}). ${parts.join('; ')}`,
            customers: [...new Set(slip.map(x => x.c.index))], refs: slip.map(({ c, r }) => ({ customer: c.index, run: r.index, seq: (r.events.find(e => e.type === 'sla.warning' || e.type === 'sla.breached') || {}).seq })),
            levels: [...by.values()].map(b => ({ name: b.name, runs: b.runs.size, warnings: b.warnings, breaches: b.breaches })) });
    }
    return { list: out, tokens, acts };
}

// ---------------------------------------------------------------- actions: the findings joined into recommendations
/** Which rules support which action, beside the rule that starts it. Fixed, so that a recommendation always shows the same evidence */
const SUPPORT = {
    silence: { R6: 'stage', R12: 'customers' },
    handover: { R3: 'customers', R9: 'workflow' },
    routing: {},
    wait: { R1: 'stage', R6: 'stage' },
    chase: { R1: 'stage', R12: 'customers' },
    reminder: { R6: 'stage' },
    leave: {},
    cost: {},
};

function actions(X, M, T, found, options) {
    const { stages, customers, node, stageById } = X;
    const N = customers.length, fs = found.list, recs = [];
    const ownerOf = stageId => (stageById[stageId] || {}).owner || null;
    // the stage a step serves: the journey's stage when the events concerned happened (an escalation, a refusal),
    // else when the step's work was done in most runs
    const stageOfActivity = (aid, refs) => {
        const n = {};
        const count = (c, e) => { const s = e && c.stageAt(iso(e.time)); if (s) n[s] = (n[s] || 0) + 1; };
        if (refs && refs.length) for (const rf of refs) { const c = customers[rf.customer], run = c.runs[rf.run]; count(c, run && run.events.find(e => e.seq === rf.seq)); }
        else for (const c of customers) for (const r of c.runs) count(c, r.events.filter(e => e.node_id === aid && e.type === 'activity.completed').pop());
        return Object.keys(n).sort((a, b) => n[b] - n[a] || stageById[a].index - stageById[b].index)[0] || null;
    };
    /** The earliest stage of the findings' events, and the owners of all their stages, in stage order */
    const stagesOf = list => {
        const ss = [...new Set(list.map(f => stageOfActivity(f.activity, f.refs)).filter(Boolean))].sort((a, b) => stageById[a].index - stageById[b].index);
        return { stage: ss[0] || null, owner: [...new Set(ss.map(ownerOf).filter(Boolean))].join(' and ') || null };
    };
    const support = (type, f0, who) => {
        const rules = SUPPORT[type], out = [];
        for (const f of fs) {
            const how = rules[f.rule]; if (!how) continue;
            if (how === 'stage' && f.stage === f0.stage && f.customers.some(i => who.includes(i))) out.push(f);
            else if (how === 'customers' && f.customers.some(i => who.includes(i))) out.push(f);
            else if (how === 'workflow' && f0.workflows && f0.workflows.includes(f.workflow)) out.push(f);
        }
        return out;
    };
    const add = r => recs.push(r);
    const sname = id => (stageById[id] || {}).name || id;

    // R10 → tell customers where things stand
    for (const f of fs.filter(f => f.rule === 'R10')) {
        const who = f.customers, s = stageById[f.stage], d = Math.round(T.R10.days);
        const sup = support('silence', f, who), dips = sup.filter(x => x.rule === 'R6');
        add({ type: 'silence', id: `silence-${slug(f.stage)}`, kind: 'experience', stage: f.stage, effort: 2, severity: SEVERITY.late, findings: [f, ...sup], customers: who,
            title: `Tell customers where their ${s.name.toLowerCase()} stands`,
            finding: `${f.count === f.of ? `Every customer who reached ${s.name}` : `${f.count} of ${f.of} customers who reached ${s.name}`} heard nothing for ${d} days or more, a median of ${Math.round(f.median_days)} days; ${customers[f.longest].first} waited longest, ${Math.round(f.longest_days)} days.${dips.length ? ` Mood fell in ${s.name} ${plural(dips.reduce((a, x) => a + x.count, 0), 'time')} for ${listNames([...new Set(dips.flatMap(x => x.customers.filter(i => who.includes(i))))].map(i => customers[i].first))}.` : ''}`,
            action: `Add a touchpoint “${s.name} update”: a short message on day ${d} of ${s.name}, and at once when something it waits for is late.`,
            effect: { method: 'estimate', text: `No customer would go ${d} days without a word in ${s.name} (${f.count} of ${f.of} now). The change adds a touchpoint the recorded runs never had, so a replay cannot show it (REPLAY_UNRECORDED). Measured after the change by the longest silence and the mood at the end of ${s.name}.`,
                before: { [`Silent ${d} days or more in ${s.name}`]: `${f.count} of ${f.of}` }, after: { [`Silent ${d} days or more in ${s.name}`]: `0 of ${f.of}` } } });
    }
    // R2 → hand the work to a person at the first failure
    const esc = fs.filter(f => f.rule === 'R2');
    if (esc.length) {
        const who = [...new Set(esc.flatMap(f => f.customers))], acts = esc.map(f => f.activity), wfs = [...new Set(esc.map(f => f.workflow))];
        const f0 = { stage: null, workflows: wfs };
        const sup = support('handover', f0, who);
        // a service level of the activity breached in a run concerned makes the handover late, not only an extra attempt
        const late = esc.some(f => f.refs.some(rf => customers[rf.customer].runs[rf.run].events.some(e => e.type === 'sla.breached' && acts.includes(e.node_id))));
        const failed = esc.flatMap(f => f.refs.map(rf => { const run = customers[rf.customer].runs[rf.run]; return run.events.filter(e => e.type === 'activity.failed' && e.node_id === f.activity); }));
        const attempts = failed.reduce((a, l) => a + l.length, 0);
        const extra = failed.map(l => l.slice(1)).flat(), extraMs = extra.reduce((a, e) => a + ((e.data || {}).duration_ms || 0), 0);
        const { stage, owner } = stagesOf(esc);
        const names = esc.map(f => f.subject);
        add({ type: 'handover', id: 'handover-first-failure', kind: 'quality', stage, owner, effort: 1, severity: late ? SEVERITY.late : SEVERITY.friction, findings: [...esc, ...sup], customers: who, activities: acts,
            title: `Hand ${names.length === 1 ? `“${names[0]}”` : 'the check'} to a person at the first failure`,
            finding: `${esc.map(f => `At ${f.subject} the outcome contract handed ${f.count === 1 ? 'one run' : f.count + ' runs'} to a person (${listNames(f.customers.map(i => customers[i].first))})`).join('; ')}, each after ${attempts / Math.max(1, failed.length) === 2 ? 'a second attempt that failed as the first had' : 'repeated attempts'}.${late ? ' A service level of the step was breached while it waited.' : ''}`,
            action: `Set the outcome contract budget of ${listNames(names)} to one attempt (budgets.max_attempts: 1) when a document cannot be read or a guardrail blocked it, so the person gets it at once.`,
            effect: { method: 'estimate', text: `${plural(extra.length, 'failed attempt')} fewer, about ${Math.round(extraMs / 60000)} minutes of agent time (the recorded durations of the attempts not made). A counterfactual replay with ai: recorded can measure it: node tools/visualization/recommendation-replay.mjs.`,
                before: { 'Attempts at the step': String(attempts), 'Agent time on the failed attempts': `${Math.round(failed.flat().reduce((a, e) => a + ((e.data || {}).duration_ms || 0), 0) / 60000)} min` },
                after: { 'Attempts at the step': String(attempts - extra.length), 'Agent time on the failed attempts': `${Math.round((failed.flat().reduce((a, e) => a + ((e.data || {}).duration_ms || 0), 0) - extraMs) / 60000)} min` } },
            replay: { kind: 'contract_budget', activities: acts, max_attempts: 1, runs: esc.flatMap(f => f.refs.map(rf => ({ customer: rf.customer, run: rf.run, run_id: customers[rf.customer].runs[rf.run].run_id, workflow_id: customers[rf.customer].runs[rf.run].workflow_id }))) } });
    }
    // R4 → send each task to someone allowed to decide it
    const ref = fs.filter(f => f.rule === 'R4');
    if (ref.length) {
        const who = [...new Set(ref.flatMap(f => f.customers))], people = ref.flatMap(f => f.people);
        const { stage, owner } = stagesOf(ref);
        add({ type: 'routing', id: 'routing-allowed', kind: 'trust', stage, effort: 1, severity: SEVERITY.friction, findings: ref, customers: who, owner,
            title: 'Send each task to someone allowed to decide it',
            finding: `${WORDS[people.length] ? WORDS[people.length][0].toUpperCase() + WORDS[people.length].slice(1) : people.length} ${people.length === 1 ? 'task' : 'tasks'} went first to a person the policy then refused: ${people.map(p => `${p.who} at ${(ref.find(f => f.people.includes(p)) || {}).subject} (${String(p.reason || '').replace(/_/g, ' ')})`).join('; ')}. Each refusal was right; the routing was not.`,
            action: `Offer a task only to the people the policy allows for it: ${ref.map(f => f.subject).join('; ')}.`,
            effect: { method: 'estimate', text: `${plural(people.length, 'refusal')} fewer, the same people deciding. A replay holds people's work as recorded, so it cannot show the routing; the policy's own decisions in the record say who was allowed.`,
                before: { 'Refusals by the policy': String(people.length) }, after: { 'Refusals by the policy': '0' } } });
    }
    // R11 → shorten the wait, or chase before it fails; a wait that leads to a reminder belongs to R5
    const reminderTargets = new Set();
    const remindF = fs.find(f => f.rule === 'R5');
    for (const f of fs.filter(f => f.rule === 'R11')) {
        const ev = node.get(f.event), w = ev && ev.w, edge = w && f.timeout_edge ? (w.edges || []).find(e => e.id === f.timeout_edge) : null;
        const target = edge ? node.get(edge.target_id) : null, c = customers[f.customers[0]], run = c.runs[f.refs[0].run];
        const W = f.wait_ms ? Math.round(f.wait_ms / DAY) : null;
        const isReminder = !!(target && target.kind === 'activity' && remindF && remindF.customers.includes(c.index) && (f.stage === remindF.stage || /remind/i.test(target.name)));
        if (isReminder) { reminderTargets.add(f); continue; }
        const failedRun = run.status === 'failed';
        if (edge && !failedRun) {
            const Nw = W ? Math.floor(W / 2) : null, shift = W && Nw ? W - Nw : 0;
            const stayed = c.hist.filter(h => h.stage === f.stage).reduce((a, h) => a + h.ms, 0);
            const sup = support('wait', f, f.customers);
            add({ type: 'wait', id: `wait-${slug(f.subject)}`, kind: 'speed', stage: f.stage, effort: 1, severity: sup.length ? SEVERITY.late : SEVERITY.friction, findings: [...sup.filter(x => x.rule === 'R1'), ...sup.filter(x => x.rule === 'R6'), f], customers: f.customers,
                title: target ? `${target.name} on day ${Nw}, not day ${W}` : `Act on day ${Nw} when “${f.subject}” has not come`,
                finding: `${c.name} did not answer “${f.subject}” in ${W} days; the run took the timeout path${target ? ` to ${target.name}` : ''}.${sup.some(x => x.rule === 'R1') ? ` The stage ${sname(f.stage)} outlasted its time.` : ''}${sup.some(x => x.rule === 'R6') ? ` ${c.first}'s mood fell there.` : ''}`,
                action: `Wait ${Nw} days for “${f.subject}”${target ? ` before ${target.name}` : ''}, not ${W}.`,
                effect: { method: 'estimate', text: `${c.first}'s ${sname(f.stage)} about ${shift} days shorter (${days(stayed)} → about ${r1(days(stayed) - shift)} days), the journey about ${r1(c.days - shift)} days instead of ${c.days}. A replay holds timeouts as recorded, so this is an estimate.`,
                    before: { [`${c.first}, ${sname(f.stage)}`]: `${days(stayed)} d`, [`${c.first}, start to end`]: `${c.days} d` }, after: { [`${c.first}, ${sname(f.stage)}`]: `≈ ${r1(days(stayed) - shift)} d`, [`${c.first}, start to end`]: `≈ ${r1(c.days - shift)} d` } } });
        } else {
            const at2 = W ? Math.round(W * 2 / 3) : null;
            const sup = support('chase', f, f.customers);
            add({ type: 'chase', id: `chase-${slug(f.subject)}`, kind: 'speed', stage: f.stage, effort: 2, severity: failedRun ? SEVERITY.lost : SEVERITY.late, findings: [...sup.filter(x => x.rule === 'R1'), f, ...sup.filter(x => x.rule === 'R12')], customers: f.customers,
                title: `Follow up before “${f.subject}” times out`,
                finding: `“${f.subject}” never came for ${c.name}. After ${W} days the wait ran out${failedRun ? ' and the run failed' : ''}${run.events.some(e => e.type === 'activity.compensated') ? '; what it had done was undone' : ''}. Nobody followed up in between.`,
                action: `Add a timer on the wait for “${f.subject}” at day ${at2} that opens a task to follow up, before the ${W}-day deadline.`,
                effect: { method: 'estimate', text: `A chance to save ${failedRun ? 'the run that failed' : 'the wait'}. A replay cannot show it: the new task has no recording (REPLAY_UNRECORDED). Measured by how often “${f.subject}” times out.`,
                    before: { 'Runs failed': failedRun ? '1' : '0' }, after: { 'Runs failed': failedRun ? '0, if the follow-up works' : '0' } } });
        }
    }
    // R5 → remind sooner
    if (remindF) {
        const outs = [...reminderTargets];
        const W = outs.length && outs[0].wait_ms ? Math.round(outs[0].wait_ms / DAY) : null, Nw = W ? Math.floor(W / 2) : null;
        const sup = support('reminder', remindF, remindF.customers);
        const c = customers[remindF.customers[0]], stay = c.hist.filter(h => h.stage === remindF.stage).reduce((a, h) => a + h.ms, 0);
        const med = ((((X.mj.stages || []).find(st => st.id === remindF.stage || st.name === sname(remindF.stage)) || { measures: {} }).measures['stage.duration_median_ms']) || {}).value;
        add({ type: 'reminder', id: 'remind-earlier', kind: 'experience', stage: remindF.stage, effort: 1, severity: sup.length ? SEVERITY.late : SEVERITY.friction, findings: [remindF, ...sup], customers: remindF.customers,
            title: W ? `Remind on day ${Nw}, not day ${W}` : 'Remind sooner, and say what is missing',
            finding: `${listNames(remindF.customers.map(i => customers[i].first))} needed a reminder${W ? ` after ${W} days` : ''}; ${c.first}'s ${sname(remindF.stage)} took ${days(stay)} days where the median is ${med ? (med < 2 * DAY ? r1(med / H) + ' hours' : days(med) + ' days') : 'not known'}.${sup.length ? ' The reminder itself lowered the mood.' : ''}`,
            action: W ? `Send the reminder after ${Nw} days, and let it say exactly what is missing.` : 'Send the reminder sooner, and let it say exactly what is missing.',
            effect: { method: 'estimate', text: `${W ? `Up to ${W - Nw} days shorter` : 'Shorter'} for a customer who answers the reminder as ${c.first} did. Measured by the share of journeys reminded and the time in ${sname(remindF.stage)}.`,
                before: { [`${c.first}, ${sname(remindF.stage)}`]: `${days(stay)} d` }, after: { [`${c.first}, ${sname(remindF.stage)}`]: W ? `≈ ${r1(days(stay) - (W - Nw))} d` : 'shorter' } } });
    }
    // R8 → find out why customers leave (a domain recommendation that names R8 at the stage replaces it)
    for (const f of fs.filter(f => f.rule === 'R8')) {
        add({ type: 'leave', id: `leave-${slug(f.stage)}`, kind: 'experience', stage: f.stage, effort: 3, severity: SEVERITY.lost, findings: [f], customers: f.customers,
            title: `Find out why customers leave at ${sname(f.stage)}`,
            finding: `${f.count} of ${f.of} customers left at ${sname(f.stage)}: ${listNames(f.customers.map(i => customers[i].name))}.`,
            action: `Ask the customers who leave at ${sname(f.stage)} why, and offer a person to talk to before the journey closes.`,
            effect: { method: 'pilot', text: `Not measurable by replay: the path is new. Run as a pilot and measure the customers who leave at ${sname(f.stage)}.` } });
    }
    // R7 → a lighter model for the clear cases
    const cost = fs.find(f => f.rule === 'R7');
    if (cost) {
        const total = ((M.totals || {})['workflow.cost'] || {}).value || 0, perJourney = N ? total / N : 0;
        const material = ((options.recommendations || {}).materiality || {}).cost_per_journey ?? 1.0;
        const cur = M.currency ? M.currency + ' ' : '';
        const same = recs.find(r => r.type === 'handover' && r.activities.includes(cost.activity));
        add({ type: 'cost', id: `cost-${slug(cost.subject)}`, kind: 'cost', stage: same ? stageOfActivity(cost.activity, (same.findings.find(f => f.activity === cost.activity) || {}).refs) : stageOfActivity(cost.activity), effort: 2, severity: perJourney < material ? SEVERITY.cost : SEVERITY.friction, findings: [cost], customers: customers.map(c => c.index),
            title: `Try a lighter model for the clear cases of ${cost.subject}`,
            finding: `${cost.subject} uses ${fmtPct(cost.count, cost.of)} of all model tokens (${num(cost.count)} of ${num(cost.of)}). The period cost ${cur}${total.toFixed(2)} in models and tools, ${cur}${perJourney.toFixed(3)} per journey${perJourney < material ? `, below the materiality of ${cur}${material.toFixed(2)} per journey` : ''}.`,
            action: `Replay the recorded runs with a lighter model tier for the clear cases, and keep the stronger tier when the agent's confidence is low.`,
            effect: { method: 'replay-live', text: `A replay with ai: live runs the agent again on the recorded runs and compares the contracts met. Not run yet.` } });
    }
    return recs;
}

/** Domain recommendations from the journey's options */
function domain(X, M, T, found, options) {
    const rules = ((options.recommendations || {}).rules) || [];
    const out = [], problems = [];
    const { customers, stageById, stages, mj } = X;
    const stageM = id => ((mj.stages || []).find(s => s.id === id || s.name === (stageById[id] || {}).name) || { measures: {} }).measures;
    for (const rule of rules) {
        if (!rule || typeof rule !== 'object' || typeof rule.id !== 'string' || typeof rule.title !== 'string') { problems.push('a domain recommendation needs an id and a title'); continue; }
        const bad = conditionProblems(rule.when);
        if (bad.length) { problems.push(`${rule.id}: ${bad[0]}`); continue; }
        if (rule.journey && rule.journey !== X.D.name && rule.journey !== X.D.id) continue;
        let who = [];
        if ((rule.for || 'customer') === 'customer') {
            for (const c of customers) {
                const get = t => {
                    if (typeof t.measure === 'string') return undefined;
                    const f = t.field;
                    if (f === 'status' || f === 'stage' || f === 'stalled' || f === 'days' || f === 'mood') return { status: c.status, stage: c.stage, stalled: c.stalled, days: c.days, mood: c.mood }[f];
                    if (f.startsWith('reached.')) return c.hist.some(h => h.stage === f.slice(8));
                    if (f.startsWith('touchpoints.')) return c.tps.filter(t2 => t2.id === f.slice(12)).length;
                    if (f.startsWith('data.')) return at(c.data, f.slice(5));
                    return undefined;
                };
                if (holds(rule.when, get)) who.push(c.index);
            }
        } else {
            const get = t => {
                if (typeof t.measure !== 'string') return undefined;
                const m = t.stage ? stageM(t.stage)[t.measure] : (mj.measures || {})[t.measure] || ((M.workflows || []).find(w => w.name === t.workflow) || { measures: {} }).measures[t.measure];
                return m ? m.value : undefined;
            };
            if (holds(rule.when, get)) who = customers.map(c => c.index);
        }
        if (!who.length) continue;
        const kind = KINDS.includes(rule.kind) ? rule.kind : 'experience';
        const effort = [1, 2, 3].includes(rule.effort) ? rule.effort : 2;
        const stage = stageById[rule.stage] ? rule.stage : (customers[who[0]] || {}).stage || (stages[0] || {}).id;
        const named = ((rule.rules) || []).filter(id => RULE[id]);
        let backing = found.list.filter(f => named.includes(f.rule) && (f.stage === stage || !f.stage) && f.customers.some(i => who.includes(i)));
        // a rule on the journey's measures concerns the customers its named rules found, when it names any
        if ((rule.for || 'customer') === 'journey' && backing.length) { who = [...new Set(backing.flatMap(f => f.customers))].sort((a, b) => a - b); backing = backing.filter(f => f.customers.some(i => who.includes(i))); }
        const sev = typeof rule.severity === 'number' ? rule.severity : backing.some(f => f.rule === 'R8') ? SEVERITY.lost : SEVERITY.late;
        const vars = { count: who.length, of: customers.length, names: listNames(who.map(i => customers[i].name)), first_names: listNames(who.map(i => customers[i].first)), stage: (stageById[stage] || {}).name || stage };
        const effect = rule.effect && typeof rule.effect === 'object' ? rule.effect : { method: typeof rule.effect === 'string' ? rule.effect : 'pilot' };
        out.push({ type: 'domain', origin: 'domain', id: slug(rule.id), kind, stage, effort, severity: sev, customers: who, owner: typeof rule.owner === 'string' ? rule.owner : undefined,
            findings: [...backing, { rule: 'domain', name: 'The journey’s own rule', kind, subject: rule.title, stage, count: who.length, of: customers.length, threshold: 'from the options', text: fill(rule.finding || `${who.length} of ${customers.length} customers meet the condition of this journey's options: ${vars.names}.`, vars), customers: who, refs: who.map(i => ({ customer: i, run: null, seq: null })) }],
            replaces: named,
            title: fill(rule.title, vars), finding: fill(rule.finding || `${vars.names}: the journey's options name this case.`, vars), action: fill(rule.action || rule.title, vars),
            effect: { method: METHODS.includes(effect.method) ? effect.method : 'pilot', text: fill(effect.text || 'Not knowable from the record: run it as a pilot and measure it.', vars) } });
    }
    return { recs: out, problems };
}

/** What each stage-scoped rule found in a stage, fired or not: the evidence of an empty state */
function stageChecks(X, T, found) {
    const { stages, customers } = X;
    const out = {};
    for (const s of stages) {
        const entered = customers.filter(c => c.hist.some(h => h.stage === s.id));
        const has = rule => found.list.some(f => f.rule === rule && f.stage === s.id);
        const stuck = entered.filter(c => c.hist.some(h => h.stage === s.id && s.max_ms && h.ms > s.max_ms) || (c.stalled && c.stage === s.id)).length;
        const longest = Math.max(0, ...customers.map(c => c.silence.stage === s.id ? c.silence.ms : 0));
        const waits = customers.flatMap(c => c.runs.flatMap(r => r.events.filter(e => e.type === 'event.waiting' && c.stageAt(iso(e.time)) === s.id).map(e => e.data.name)));
        const agents = customers.some(c => c.runs.some(r => r.events.some(e => e.type === 'contract.checked' && c.stageAt(iso(e.time)) === s.id)));
        const dips = customers.flatMap(c => c.moods.filter(m => m.stage === s.id && m.change <= T.R6.change)).length;
        const left = customers.filter(c => c.status === 'abandoned' && c.stage === s.id).length;
        const reminded = found.list.find(f => f.rule === 'R5' && f.stage === s.id);
        const longestStay = Math.max(0, ...entered.flatMap(c => c.hist.filter(h => h.stage === s.id && h.to).map(h => h.ms)));
        out[s.id] = {
            stage: s.id, name: s.name, entered: entered.length, longest_stay_ms: longestStay, max: s.max,
            checks: [
                { rule: 'R1', name: 'Outlasts its time', value: `${stuck} of ${entered.length} stuck`, threshold: thresholdText('R1', T), fired: has('R1') },
                { rule: 'R2', name: 'Contract hands over', value: agents ? (found.list.some(f => f.rule === 'R2') ? 'handed over elsewhere' : 'no handover') : 'no agent here', threshold: thresholdText('R2', T), fired: false },
                { rule: 'R5', name: 'Reminders', value: reminded ? `${reminded.count} reminded` : '0 reminders', threshold: thresholdText('R5', T), fired: has('R5') },
                { rule: 'R6', name: 'Mood falls', value: dips ? plural(dips, 'fall') : `no fall in ${s.name}`, threshold: thresholdText('R6', T), fired: has('R6') },
                { rule: 'R8', name: 'Customers leave', value: `${left} left here`, threshold: thresholdText('R8', T), fired: has('R8') },
                { rule: 'R10', name: 'Silence', value: longest ? `longest ${longest < 2 * DAY ? Math.round(longest / H) + ' h' : days(longest) + ' days'}` : 'no silence', threshold: thresholdText('R10', T), fired: has('R10') },
                { rule: 'R11', name: 'Awaited event', value: waits.length ? `${[...new Set(waits)].join(', ')} ${found.list.some(f => f.rule === 'R11' && f.stage === s.id) ? 'timed out' : 'always came'}` : 'no wait here', threshold: thresholdText('R11', T), fired: has('R11') },
            ],
        };
    }
    return out;
}

/**
 * Compute the recommendations of every journey in a record.
 * @returns {{ as_of, thresholds, rules, journeys: [{ index, name, customers, recommendations, findings, checks, problems }], recommendations }}
 */
function compute(record, options = {}) {
    options = options || {};
    if (!record || !Array.isArray(record.journeys) || !Array.isArray(record.workflows)) throw new Error('A journey record has journeys and workflows (awa journey export)');
    const M = options.measures || measuresLib().compute_measures(record);
    const T = thresholdsOf(options);
    const conf = options.recommendations || {};
    const wording = conf.wording || {};
    const replays = conf.replays && typeof conf.replays === 'object' && !Array.isArray(conf.replays) ? conf.replays : {};
    const journeys = [];
    record.journeys.forEach((J, jk) => {
        const X = readJourney(record, jk, M, options);
        const found = findings(X, M, T, options);
        let recs = actions(X, M, T, found, options);
        const dom = domain(X, M, T, found, options);
        // a domain recommendation that names a rule at its stage takes that rule's place
        for (const d of dom.recs) recs = recs.filter(r => !(r.type === 'leave' && d.replaces.includes('R8') && r.stage === d.stage));
        recs = recs.concat(dom.recs);
        const N = X.customers.length;
        const suffix = record.journeys.length > 1 && jk > 0 ? `-j${jk}` : '';
        const out = recs.map(r => {
            const w = wording[r.id] || {};
            const owner = r.owner || (X.stageById[r.stage] || {}).owner || null;
            const impact = N ? r2(r.customers.length / N * r.severity) : 0;
            const effect = { ...r.effect, ...(typeof w.effect === 'string' ? { text: w.effect } : {}) };
            const rep = replays[r.id];
            if (rep && rep.method === 'replay') Object.assign(effect, { method: 'replay', text: typeof w.effect === 'string' ? w.effect : rep.text || effect.text, replay: rep, before: rep.before || effect.before, after: rep.after || effect.after });
            const rules = [...new Set(r.findings.map(f => f.rule))];
            return {
                id: r.id + suffix, journey: jk, journey_name: X.D.name, origin: r.origin || 'rule', type: r.type,
                title: typeof w.title === 'string' ? w.title : r.title,
                kind: r.kind, stage: r.stage, stage_name: (X.stageById[r.stage] || {}).name || r.stage, owner,
                rules, findings: r.findings.map(f => ({ rule: f.rule, name: f.name, kind: f.kind, subject: f.subject, stage: f.stage || null, count: f.count, of: f.of, share: f.share ?? null, threshold: f.threshold, text: f.text, customers: f.customers, refs: f.refs || [], ...(f.silences ? { silences: f.silences } : {}), ...(f.dips ? { dips: f.dips } : {}), ...(f.people ? { people: f.people } : {}), ...(f.levels ? { levels: f.levels } : {}), ...(f.median_days !== undefined ? { median_days: f.median_days, longest_days: f.longest_days } : {}) })),
                customers: r.customers.map(i => {
                    const c = X.customers[i];
                    const refs = r.findings.flatMap(f => (f.refs || []).filter(x => x.customer === i));
                    const withRun = refs.find(x => x.run !== null && x.run !== undefined && x.seq !== null && x.seq !== undefined) || refs.find(x => x.run !== null && x.run !== undefined);
                    const jseq = refs.find(x => x.journey_seq !== null && x.journey_seq !== undefined);
                    const sil = r.findings.flatMap(f => f.silences || []).find(s => s.customer === i);
                    return { index: i, instance: c.id, key: c.key, name: c.name, first: c.first, status: c.status, stage: c.stage, days: c.days,
                        run: withRun ? withRun.run : (c.runs.length ? 0 : null), run_id: withRun ? c.runs[withRun.run].run_id : (c.runs[0] || {}).run_id || null,
                        run_short: withRun ? c.runs[withRun.run].short : (c.runs[0] || {}).short || null, seq: withRun ? withRun.seq : null,
                        journey_seq: jseq ? jseq.journey_seq : null, ...(sil ? { silent_days: sil.days } : {}) };
                }),
                severity: r.severity, impact, effort: r.effort, effort_text: EFFORT_TEXT[r.effort], priority: r.effort ? r2(impact / r.effort) : 0,
                finding: typeof w.finding === 'string' ? w.finding : r.finding, action: typeof w.action === 'string' ? w.action : r.action, effect,
                ...(r.replay ? { replay: r.replay } : {}), status: 'new',
            };
        });
        out.sort((a, b) => b.priority - a.priority || b.impact - a.impact || b.rules.length - a.rules.length || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
        out.forEach((r, k) => { r.rank = k + 1; });
        journeys.push({ index: jk, name: X.D.name, customers: N, stages: X.stages.map(s => ({ id: s.id, name: s.name, owner: s.owner, max: s.max })),
            recommendations: out, findings: found.list.map(f => ({ rule: f.rule, name: f.name, subject: f.subject, stage: f.stage || null, text: f.text, customers: f.customers })),
            checks: stageChecks(X, T, found), problems: dom.problems,
            rules_checked: RULES.length, workflows: X.workflowIds.length });
    });
    return { as_of: record.as_of || M.as_of, thresholds: T, rules: RULES, journeys, recommendations: journeys.flatMap(j => j.recommendations) };
}

const api = { compute, RULES, KINDS, METHODS, DEFAULTS, thresholds: thresholdsOf, holds, conditionProblems, duration, EFFORT_TEXT };
root.AWA_RECOMMENDATIONS = api;
if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
