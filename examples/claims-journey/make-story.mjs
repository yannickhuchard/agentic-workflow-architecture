// Turns journeys.json into a story: for each customer, the beats of the journey
// in causal order, each with one plain sentence; for each run, its journal
// condensed into steps a reader can follow; and a layout for each workflow.
// This is the data a journey visualisation plays (docs/ux/journey-visualisation-research.md).
//
//   node examples/claims-journey/make-journeys.mjs
//   node examples/claims-journey/make-story.mjs [out.json]

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const here = path.dirname(fileURLToPath(import.meta.url));
const sample = JSON.parse(fs.readFileSync(path.join(here, 'journeys.json'), 'utf-8'));
const out = process.argv[2] || path.join(here, 'story.json');

const MIN = 60000, HOUR = 60 * MIN, DAY = 24 * HOUR;
const ms = iso => Date.parse(iso);
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

/** "1 day 3 hours", "6 hours", "4 minutes", "40 seconds" */
function span(d) {
    if (d >= DAY) { const days = Math.floor(d / DAY), hours = Math.round((d % DAY) / HOUR); return plural(days, 'day') + (hours && days < 4 ? ' ' + plural(hours, 'hour') : ''); }
    if (d >= HOUR) { const hours = Math.floor(d / HOUR), mins = Math.round((d % HOUR) / MIN); return plural(hours, 'hour') + (mins && hours < 3 ? ' ' + plural(mins, 'minute') : ''); }
    if (d >= MIN) return plural(Math.round(d / MIN), 'minute');
    return plural(Math.max(1, Math.round(d / 1000)), 'second');
}
const iso_span = text => { const m = /^P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/.exec(text || ''); return m ? span((+m[1] || 0) * 7 * DAY + (+m[2] || 0) * DAY + (+m[3] || 0) * HOUR + (+m[4] || 0) * MIN + (+m[5] || 0) * 1000) : text; };
const clock = t => new Date(t).toISOString().slice(11, 16);
const date = t => new Date(t).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });
const short = (text, n) => (text.length > n ? text.slice(0, n - 1).trimEnd() + '…' : text);
const ACTOR = { application: 'The system', ai_agent: 'An AI agent', human: 'A person', robot: 'A robot' };
const ACTOR_LABEL = { application: 'System', ai_agent: 'AI agent', human: 'Person', robot: 'Robot' };

// ---------------------------------------------------------------------------
// Workflow layouts. Columns and rows are given by hand, by node name: a layout
// a person chose reads better than one a general algorithm finds.
// ---------------------------------------------------------------------------
const GRID = {
    'Claim Intake': {
        'Claim submitted': [0, 0], 'Register claim': [1, 0], 'Request documents': [2, 0], 'Documents uploaded': [3, 0],
        'Check completeness': [5, 0], 'Claim registered': [6, 0], 'Intake done': [7, 0],
        'Send reminder': [4, 1], 'Reminder answered': [5, 1], 'Close as incomplete': [6, 1],
    },
    'Motor Claim Settlement': {
        'Claim received': [0, 1], 'Register claim': [1, 1], 'Assess damage': [2, 1], 'Check fraud signals': [3, 0], 'Verify policy cover': [3, 2],
        'Consolidate findings': [4, 1], 'Settlement route': [5, 1], 'Adjuster review': [5, 0], 'Investigate': [5, 2],
        'Reserve funds': [6, 1], 'Release funds': [6, 2], 'Bank cut-off': [7, 1], 'Pay claimant': [8, 1], 'Notify claimant': [9, 1], 'Claim closed': [10, 1],
    },
    'Customer Follow-up': {
        'Send survey': [0, 0], 'Survey answered': [1, 0], 'How satisfied': [2, 0], 'Thank customer': [3, 0], 'Follow-up done': [4, 0],
        'Call back': [3, 1], 'Record no response': [1, 1],
    },
};
const SIZE = { activity: [112, 56], event: [40, 40], decision: [64, 64] };
const GAP_X = 32, ROW = 96, TRACK = 30;

function layout(workflow) {
    const grid = GRID[workflow.name];
    const nodes = [
        ...workflow.activities.map(a => ({ id: a.id, name: a.name, kind: 'activity', actor: a.actor_type, handler: workflow.activities.some(b => b.compensation?.activity_id === a.id) })),
        ...workflow.events.map(e => ({ id: e.id, name: e.name, kind: 'event', sub: e.event_type, mode: e.event_definition?.mode === 'publish' ? 'publish' : e.event_type === 'message' || e.event_type === 'signal' ? 'wait' : e.event_type, timeout_edge: e.event_definition?.timeout_edge_id })),
        ...workflow.decision_nodes.map(d => ({ id: d.id, name: d.name, kind: 'decision' })),
    ];
    const cols = Math.max(...nodes.map(n => grid[n.name][0])) + 1, rows = Math.max(...nodes.map(n => grid[n.name][1])) + 1;
    const col_w = Array.from({ length: cols }, (_, c) => Math.max(...nodes.filter(n => grid[n.name][0] === c).map(n => SIZE[n.kind][0])));
    const col_x = []; let x = 0; for (const w of col_w) { col_x.push(x); x += w + GAP_X; }
    const width = x - GAP_X, top = TRACK, height = top + (rows - 1) * ROW + 64 + TRACK;
    for (const n of nodes) {
        const [c, r] = grid[n.name], [w, h] = SIZE[n.kind];
        n.w = w; n.h = h; n.x = col_x[c] + (col_w[c] - w) / 2; n.y = top + r * ROW + (64 - h) / 2; n.c = c; n.r = r;
        n.cx = n.x + w / 2; n.cy = n.y + h / 2;
    }
    const by_id = Object.fromEntries(nodes.map(n => [n.id, n]));
    const timeout_edges = new Set(nodes.map(n => n.timeout_edge).filter(Boolean));

    // An edge is a chain of horizontal and vertical runs from the source's border to the target's
    const route = (a, b) => {
        const pts = [];
        if (a.r === b.r && b.c > a.c) pts.push([a.x + a.w, a.cy], [b.x, b.cy]);
        else if (a.c === b.c) pts.push([a.cx, a.r < b.r ? a.y + a.h : a.y], [b.cx, a.r < b.r ? b.y : b.y + b.h]);
        else if (b.c - a.c > 2 && a.r !== b.r) {
            // A long way: along a clear track above the top row or below the bottom row
            const up = a.r < b.r || a.r === 0, y = up ? a.y - 18 : a.y + a.h + 18;
            pts.push([a.cx, up ? a.y : a.y + a.h], [a.cx, y], [b.cx, y], [b.cx, up ? b.y : b.y + b.h]);
        } else if (b.c > a.c) {
            // Leave sideways, turn in the gap before the target's column, arrive sideways
            const turn = b.x - GAP_X / 2;
            pts.push([a.x + a.w, a.cy], [turn, a.cy], [turn, b.cy], [b.x, b.cy]);
        } else pts.push([a.cx, a.r < b.r ? a.y + a.h : a.y], [a.cx, b.cy], [a.cx < b.cx ? b.x : b.x + b.w, b.cy]);
        const segs = [];
        for (let i = 1; i < pts.length; i++) {
            const [x1, y1] = pts[i - 1], [x2, y2] = pts[i];
            if (x1 === x2 && y1 === y2) continue;
            const horizontal = y1 === y2;
            segs.push({ x: Math.round(Math.min(x1, x2)), y: Math.round(Math.min(y1, y2)), len: Math.round(Math.abs(horizontal ? x2 - x1 : y2 - y1)), dir: horizontal ? (x2 > x1 ? 'r' : 'l') : (y2 > y1 ? 'd' : 'u') });
        }
        return segs;
    };
    const edges = workflow.edges.map(e => {
        const a = by_id[e.source_id], b = by_id[e.target_id];
        const segs = route(a, b), last = segs.at(-1);
        const tip = last.dir === 'r' ? [last.x + last.len, last.y] : last.dir === 'l' ? [last.x, last.y] : last.dir === 'd' ? [last.x, last.y + last.len] : [last.x, last.y];
        return { id: e.id, a: nodes.indexOf(a), b: nodes.indexOf(b), segs, tip: { x: tip[0], y: tip[1], dir: last.dir }, kind: timeout_edges.has(e.id) ? 'timeout' : 'flow' };
    });
    // Compensation is an association, not a path a token takes
    for (const a of workflow.activities) if (a.compensation) {
        const from = by_id[a.id], to = by_id[a.compensation.activity_id];
        edges.push({ id: `comp:${a.id}`, a: nodes.indexOf(from), b: nodes.indexOf(to), segs: route(from, to), tip: null, kind: 'undo' });
    }
    return { id: workflow.id, name: workflow.name, width, height, nodes, edges, by_id };
}
const layouts = sample.workflows.map(layout);
const layout_of = id => layouts.find(l => l.id === id);

// ---------------------------------------------------------------------------
// A run's journal, condensed into steps
// ---------------------------------------------------------------------------
const STATE = { idle: 0, running: 1, waiting: 2, done: 3, failed: 4, undone: 5, skipped: 6 };

function facts(output, n = 3) {
    const value = output && typeof output === 'object' && output.output && typeof output.output === 'object' ? output.output : output;
    if (!value || typeof value !== 'object') return '';
    return Object.entries(value).filter(([k, v]) => !k.startsWith('_') && k !== 'usage' && (typeof v !== 'object' || v === null)).slice(0, n)
        .map(([k, v]) => `${k.replace(/_/g, ' ')}: ${typeof v === 'string' ? `“${short(v, 60)}”` : v === true ? 'yes' : v === false ? 'no' : v}`).join(', ');
}
const message_of = output => { const v = output?.output?.message ?? output?.message; return typeof v === 'string' ? v : undefined; };

function condense(run, customer_name, day0) {
    const lay = layout_of(run.workflow_id);
    const when = t => `Day ${Math.floor((t - day0) / DAY) + 1} · ${clock(t)}`;
    const steps = [], state = lay.nodes.map(() => STATE.idle), lit = lay.edges.map(() => 0);
    const pending_edges = [], tool_calls = {}, notes = {};          // notes: detail gathered for a node until its next step
    const ix = id => lay.nodes.findIndex(n => n.id === id);
    const push = (e, kind, cap, extra = {}) => {
        const n = e.node_id ? ix(e.node_id) : -1;
        const det = [...(notes[n] || []), ...(extra.det || [])]; delete notes[n];
        for (const edge of pending_edges.splice(0)) lit[edge] = 1;
        if (extra.state !== undefined && n >= 0) state[n] = extra.state;
        for (const [node, value] of extra.also || []) state[node] = value;
        steps.push({ seq: e.seq, t: ms(e.time), when: when(ms(e.time)), n, kind, cap, det, link: extra.link, ns: state.join(''), es: lit.join('') });
        return steps.length - 1;
    };
    const note = (e, label, text) => { const n = ix(e.node_id); (notes[n] ||= []).push([label, text]); };

    for (const e of run.events) {
        const d = e.data || {}, name = e.node_name, node = e.node_id ? lay.by_id[e.node_id] : undefined;
        switch (e.type) {
            case 'run.started': push(e, 'begin', `The ${lay.name} workflow starts for ${customer_name}.`); break;
            case 'token.moved': { const edge = lay.edges.findIndex(x => x.id === d.edge_id); if (edge >= 0) pending_edges.push(edge); break; }
            case 'token.created': if (d.reason === 'parallel_split') note(e, 'Flow', 'The work splits here: the next steps run side by side.'); break;
            case 'activity.started':
                push(e, 'start', `${ACTOR[d.actor_type]} starts “${name}”${e.attempt > 1 ? `, attempt ${e.attempt}` : ''}.`, { state: STATE.running });
                break;
            case 'meta.recorded':
                if (d.subject === 'model_selection') note(e, 'Model', `${d.decision.replace(/^Use model /, '')}. ${d.rationale}`);
                else push(e, 'engine', `The engine decides: ${d.decision}.`, { det: d.rationale ? [['Why', d.rationale]] : [] });
                break;
            case 'reasoning.recorded':
                if (d.source === 'decision_model') { note(e, 'Model’s reason', `${d.rationale}${d.confidence ? ` (confidence ${Math.round(d.confidence * 100)}%)` : ''}`); break; }
                push(e, 'reasoning', `The agent explains its approach: ${d.rationale}`, {
                    det: [...(d.plan || []).map((p, i) => [`Plan ${i + 1}`, p]), ...(d.alternatives_considered || []).map(a => ['Set aside', a]), ...(d.confidence ? [['Confidence', `${Math.round(d.confidence * 100)}%`]] : [])],
                });
                break;
            case 'tool.invoked': tool_calls[d.call_id] = d; break;
            case 'tool.completed': case 'tool.failed': {
                const call = tool_calls[d.call_id] || d, b = call.binding || {};
                const what = b.kind === 'http' ? `${b.method} ${call.link}` : b.kind === 'jsonrpc' ? `JSON-RPC ${call.link}` : call.link;
                const ok = e.type === 'tool.completed';
                push(e, ok ? 'tool' : 'tool_failed', ok ? `“${name}” calls the tool ${d.tool} and gets an answer.` : `“${name}” calls the tool ${d.tool}, which fails: ${d.error?.message}.`, {
                    link: call.link,
                    det: [['Call', what], ...(call.arguments ? [['Arguments', JSON.stringify(call.arguments)]] : []), ['Result', ok ? short(JSON.stringify(d.result ?? {}), 140) : `${d.error?.message} (status ${d.status})`], ...(call.documentation ? [['Documented at', call.documentation]] : [])],
                });
                break;
            }
            case 'contract.checked':
                if (d.passed) note(e, 'Outcome contract', 'Checked: every condition holds.');
                else push(e, 'rejected', `The result of “${name}” is refused: it breaks the outcome contract.`, { det: d.violations.map(v => [v.kind === 'output_schema' ? 'Schema' : 'Condition', v.message]) });
                break;
            case 'verification.completed':
                if (d.verdict === 'pass') note(e, 'Verification', `Passed (${(d.criteria || []).map(c => c.criterion_name).join(', ')}).`);
                else push(e, 'rejected', `The result of “${name}” does not pass verification.`, { det: (d.criteria || []).filter(c => !c.passed).map(c => [c.criterion_name, c.evidence]) });
                break;
            case 'activity.failed':
                push(e, 'failed', `“${name}” fails${d.retryable ? ' this time' : ''}: ${d.error.message}`, { state: d.retryable ? STATE.waiting : STATE.failed, det: [['Error code', d.error.code], ['Can be retried', d.retryable ? 'yes' : 'no']] });
                break;
            case 'activity.retry_scheduled': note(e, 'Retry', `Attempt ${d.next_attempt} follows after a short pause.`); break;
            case 'activity.dead_lettered': note(e, 'Set aside', `Given up after ${plural(d.attempts, 'attempt')} and kept for a person to look at.`); break;
            case 'activity.completed': {
                const told = message_of(d.output), human = d.actor_type === 'human';
                const what = facts(d.output);
                push(e, 'done', human ? `A person completes “${name}”${d.waited_ms ? ` after ${span(d.waited_ms)}` : ''}${what ? `: ${what}` : ''}.`
                    : `“${name}” is done${d.attempts > 1 ? ` on attempt ${d.attempts}` : ''}${told ? `. ${customer_name} is told: “${short(told, 130)}”` : what ? `: ${what}.` : '.'}`,
                    { state: STATE.done, det: told ? [['Message', told]] : [] });
                if (told) steps.at(-1).told = told;
                break;
            }
            case 'token.joined': note(e, 'Flow', 'The parallel branches meet here; what each found is merged.'); break;
            case 'decision.evaluated': {
                const inputs = Object.entries(d.inputs || {}).map(([k, v]) => `${k.replace(/_/g, ' ')} ${v}`).join(', ');
                const rule = d.matched_rules?.[0];
                const cap = d.method === 'model'
                    ? `No rule covers this case (${inputs}), so a model decides “${name}”: ${d.outputs.option}, ${Math.round(d.outputs.confidence * 100)}% confident.`
                    : `“${name}” is decided by rule${rule?.description ? ` “${rule.description}”` : ''}: ${Object.entries(d.outputs || {}).map(([k, v]) => `${k} ${v}`).join(', ')}.`;
                push(e, d.method === 'model' ? 'model_decision' : 'decision', cap, { state: STATE.done, det: [['Inputs', inputs], ...(rule ? [['Rule', `${rule.input_entries.join(' and ')}${rule.description ? ` (${rule.description})` : ''}`]] : [['Rules', 'none matched']]), ...(d.model ? [['Allowed options', 'the options the workflow lists; the model cannot invent one'], ['Least confidence accepted', `${Math.round(d.model.min_confidence * 100)}%`]] : [])] });
                steps.at(-1).model = d.method === 'model';
                break;
            }
            case 'timer.fired': push(e, 'timer', `The timer “${name}” has run out; the work goes on.`, { state: STATE.done }); break;
            case 'event.waiting':
                push(e, 'wait', `The run now waits for “${d.name}”${d.due_at ? `, until ${date(ms(d.due_at))} at the latest` : ''}.`, { state: STATE.waiting, det: [...(d.correlation_key ? [['Matched on', `${d.correlation_key} = ${d.correlation_value}`]] : []), ...(d.due_at ? [['Deadline', `${date(ms(d.due_at))}, ${clock(ms(d.due_at))}`]] : [])] });
                break;
            case 'event.received': push(e, 'received', `“${d.name}” arrives and the run wakes up.`, { state: STATE.done, det: [['From', d.source], ['Event id', d.event_id]] }); break;
            case 'event.timed_out': push(e, 'timeout', `The deadline passes and no “${d.name}” has arrived. The run takes the path planned for that.`, { state: STATE.skipped }); steps.at(-1).event_name = d.name; break;
            case 'event.published': push(e, 'published', `The run announces “${d.name}” to whoever listens.`, { state: STATE.done, det: [['Event id', d.event_id], ['Data', JSON.stringify(d.data)]] }); break;
            case 'token.waiting': push(e, 'human_wait', `“${name}” is now waiting for a person.`, { state: STATE.waiting }); break;
            case 'activity.compensated':
                push(e, 'undone', `“${name}” undoes “${d.compensates_activity_name}”, so nothing is left half done.`, { state: STATE.done, also: [[lay.nodes.findIndex(n => n.id === d.compensates_activity_id), STATE.undone]] });
                { const edge = lay.edges.findIndex(x => x.id === `comp:${d.compensates_activity_id}`); if (edge >= 0) { lit[edge] = 1; steps.at(-1).es = lit.join(''); } }
                break;
            case 'token.completed': if (d.end_event) push(e, 'end', `The work reaches its end, “${name}”.`, { state: STATE.done }); break;
            case 'token.cancelled': if (node) { state[ix(e.node_id)] = STATE.skipped; } break;
            case 'run.completed': push(e, 'outcome_ok', `The run is complete: ${plural(d.steps, 'step')}${d.cost ? `, ${d.input_tokens + d.output_tokens} model tokens, EUR ${d.cost.toFixed(3)}` : ''}.`); break;
            case 'run.failed': push(e, 'outcome_failed', `The run has failed: ${d.errors?.[0]?.message}. ${d.compensation?.attempted ? `${d.compensation.succeeded} of ${plural(d.compensation.attempted, 'completed step')} undone.` : ''}`); break;
            case 'run.cancelled': push(e, 'outcome_cancelled', `The run is withdrawn: ${d.reason.replace(/^journey \w+: /, '').replace(/^The c/, 'the c')}. Nothing more will be sent.`); break;
            default: break;
        }
    }
    return steps;
}

// ---------------------------------------------------------------------------
// A journey, as beats
// ---------------------------------------------------------------------------
const EVENT_SENTENCE = {
    'claim.submitted': (n, d) => [`Claim reported`, `${n} reports a claim. ${d.description}`],
    'documents.uploaded': (n, d) => [`Documents uploaded`, `${n} uploads ${plural(d.documents, 'document')}.`],
    'survey.answered': (n, d) => [`Survey answered: ${d.satisfaction} of 5`, `${n} answers the survey: ${d.satisfaction} out of 5.${d.comment ? ` “${d.comment}”` : ''}`],
    'claim.withdrawn': (n, d) => [`Claim withdrawn`, `${n} withdraws the claim. ${d.reason || ''}`],
};

function tell(entry) {
    const { instance, runs, subject_name: name } = entry;
    const day0 = Math.floor(ms(instance.started_at) / DAY) * DAY, start = ms(instance.started_at);
    const when = t => `Day ${Math.floor((t - day0) / DAY) + 1} · ${clock(t)}`;
    const stage_name = id => sample.definition.stages.find(s => s.id === id)?.name;
    const run_list = runs.map(r => ({ run_id: r.run_id, wf: layouts.findIndex(l => l.id === r.workflow_id), name: layout_of(r.workflow_id).name, stage: r.stage_id, status: instance.runs.find(x => x.run_id === r.run_id).status, steps: condense(r, name, day0) }));
    const run_ix = id => run_list.findIndex(r => r.run_id === id);

    const beats = [];
    // The record is in causal order. Where a clock reading runs backwards, the order wins
    let latest = 0;
    const add = (order, t, lane, kind, title, cap, extra = {}) => { if (order % 1000 === 0) t = latest = Math.max(latest, t); beats.push({ order, t, lane, kind, title, cap, ...extra }); };
    instance.events.forEach((e, i) => {
        const d = e.data || {}, t = ms(e.time), order = i * 1000, r = e.run_id ? run_ix(e.run_id) : undefined;
        switch (e.type) {
            case 'journey.started': break;
            case 'journey.event_received': {
                const inner = d.source?.startsWith('urn:awa:run:');
                const [title, cap] = inner ? [`Announced: ${d.name}`, `The workflow announces “${d.name}”.`] : (EVENT_SENTENCE[d.name]?.(name, d.data || {}) || [d.name, `“${d.name}” is received.`]);
                // The event that began the journey is told first, although the record creates the journey a moment before it
                add(i === 2 ? -1 : order, t, inner ? 'work' : 'world', inner ? 'announced' : 'event', title, cap, { outside: !inner });
                break;
            }
            case 'journey.stage_entered': add(order, t, 'journey', 'stage_in', d.stage_name, `The journey enters the stage “${d.stage_name}”.`); break;
            case 'journey.stage_completed': add(order, t, 'journey', 'stage_out', `${d.stage_name} complete`, `“${d.stage_name}” is complete after ${span(d.duration_ms)}.`); break;
            case 'journey.run_started': add(order, t, 'work', 'run_in', d.workflow_name, `The ${d.workflow_name} workflow starts.`, { run: r, opens: r }); break;
            case 'journey.run_ended':
                add(order, t, 'work', d.status === 'completed' ? 'run_out' : d.status === 'failed' ? 'run_failed' : 'run_cancelled', `${d.workflow_name} ${d.status}`,
                    d.status === 'completed' ? `The ${d.workflow_name} workflow finishes.` : d.status === 'failed' ? `The ${d.workflow_name} workflow fails: ${d.error}` : `The ${d.workflow_name} workflow is withdrawn: the work is no longer wanted.`, { run: r, opens: r });
                break;
            case 'journey.goal_reached': add(order, t, 'journey', 'goal', `Goal: ${d.goal_name}`, `A goal of the journey is reached: ${d.goal_name.toLowerCase()}.`); break;
            case 'journey.stalled': add(order, t, 'journey', 'stalled', 'Stalled', d.max_duration ? `The journey is stalled: “${d.stage_name}” has lasted ${span(d.in_stage_ms)}, longer than the ${iso_span(d.max_duration)} it is given. Someone needs to act.` : `The journey is stalled in “${d.stage_name || stage_name(e.stage_id)}”: ${d.reason || 'a run failed'}. Someone needs to act.`, { outside: !!d.max_duration }); break;
            case 'journey.completed': {
                const missed = sample.definition.goals.filter(g => !instance.goals_reached.includes(g.id)).map(g => g.name.toLowerCase());
                add(order, t, 'journey', 'completed', 'Journey complete', `The journey is complete${missed.length ? `, but one goal was missed: ${missed.join(', ')}.` : ', with every goal reached.'}`);
                break;
            }
            case 'journey.abandoned': add(order, t, 'journey', 'abandoned', 'Journey ended by the customer', `The journey ends here, by the customer’s choice.`); break;
            default: break;
        }
    });

    // What happened inside the runs that the customer saw, or that changed the course of the journey
    run_list.forEach((run, r) => {
        // A step is told after the journey event that caused it: the start of the run, or the business event that woke it
        let after = instance.events.findIndex(e => e.type === 'journey.run_started' && e.run_id === run.run_id);
        run.steps.forEach((step, s) => {
            if (step.kind === 'received') { const id = step.det.find(d => d[0] === 'Event id')?.[1]; const at = instance.events.findIndex(e => e.type === 'journey.event_received' && e.data.event_id === id); if (at >= 0) after = at; }
            const node = step.n >= 0 ? layouts[run.wf].nodes[step.n] : undefined;
            const order = after * 1000 + 1 + s, link = { run: r, opens: r, step: s };
            if (step.told) add(order, step.t, 'world', 'told', node.name, `${name} is told: “${short(step.told, 150)}”`, link);
            else if (step.kind === 'timeout') add(order, step.t, 'world', 'timeout', 'Nothing arrives', `The deadline passes: no “${step.event_name}” from ${name}.`, { ...link, outside: true });
            else if (step.kind === 'human_wait') add(order, step.t, 'work', 'human_wait', `${node.name}: waiting`, `“${node.name}” waits for a person.`, link);
            else if (step.kind === 'done' && node.actor === 'human') add(order, step.t, 'work', 'human_done', `${node.name}: done`, step.cap, { ...link, outside: true });
            else if (step.kind === 'model_decision') add(order, step.t, 'work', 'model_decision', `Model decides: ${node.name}`, step.cap, link);
            else if (step.kind === 'undone') add(order, step.t, 'work', 'undone', node.name, step.cap, link);
        });
    });

    beats.sort((a, b) => a.order < 0 ? -1 : b.order < 0 ? 1 : a.t - b.t || a.order - b.order);
    let stage = -1;
    beats.forEach((b, i) => {
        if (b.kind === 'stage_in') stage = sample.definition.stages.findIndex(s => s.name === b.title);
        b.stage = Math.max(stage, 0); b.when = when(b.t);
        const gap = i ? b.t - beats[i - 1].t : 0;
        if (gap >= 30 * MIN) b.gap = `${span(gap)} later`;
        delete b.order;
    });
    run_list.forEach((run, r) => { const mine = beats.map((b, i) => (b.run === r ? i : -1)).filter(i => i >= 0); run.b0 = mine[0]; run.b1 = mine.at(-1); });

    const end_kind = instance.status === 'completed' ? 'completed' : instance.status === 'abandoned' ? 'abandoned' : instance.stalled ? 'stalled' : 'active';
    const end_label = { completed: 'Completed', abandoned: 'Withdrawn by customer', stalled: 'Stalled: needs action', active: 'Under way' }[end_kind];
    return {
        id: instance.subject_key, name, summary: entry.summary, claim: instance.data.claim_id || '',
        ending: { kind: end_kind, label: end_label }, start,
        end: instance.ended_at ? ms(instance.ended_at) : beats.at(-1).t,
        goals: sample.definition.goals.map(g => ({ name: g.name, reached: instance.goals_reached.includes(g.id) })),
        stages: instance.stage_history.map(h => ({ stage: sample.definition.stages.findIndex(s => s.id === h.stage_id), from: ms(h.entered_at), to: h.left_at ? ms(h.left_at) : null })),
        beats, runs: run_list,
    };
}

const customers = sample.instances.map(tell);
const t0 = Math.min(...customers.map(c => c.start)), t1 = ms(sample.as_of);

// All journeys on one clock: the moments worth stopping at
const KEY = new Set(['event', 'stage_in', 'timeout', 'run_failed', 'goal', 'stalled', 'completed', 'abandoned', 'model_decision', 'human_done']);
const all = customers.flatMap((c, ci) => c.beats.map((b, bi) => ({ t: b.t, c: ci, b: bi, kind: b.kind, when: `${date(b.t)} · ${clock(b.t)}`, cap: b.cap })).filter(x => KEY.has(x.kind))).sort((a, b) => a.t - b.t || a.c - b.c);
for (const moment of all) {
    moment.counts = sample.definition.stages.map((_, s) => {
        const count = { here: 0, done: 0, stalled: 0, left: 0 };
        for (const c of customers) {
            const seg = c.stages.find(x => x.stage === s && x.from <= moment.t);
            if (!seg) continue;
            const stalled_at = c.beats.find(b => b.kind === 'stalled' && b.stage === s)?.t, left_at = c.ending.kind === 'abandoned' ? c.end : undefined;
            if (left_at !== undefined && left_at <= moment.t && (seg.to === null || seg.to >= left_at)) count.left++;
            else if (seg.to !== null && seg.to <= moment.t) count.done++;
            else if (stalled_at !== undefined && stalled_at <= moment.t) count.stalled++;
            else count.here++;
        }
        return count;
    });
}

const story = {
    as_of: sample.as_of, t0, t1,
    journey: { name: sample.definition.name, subject: sample.definition.subject.name, stages: sample.definition.stages.map(s => ({ id: s.id, name: s.name, max: iso_span(s.max_duration) })), goals: sample.definition.goals.map(g => g.name) },
    workflows: layouts.map(l => ({
        name: l.name, width: l.width, height: l.height,
        nodes: l.nodes.map(n => ({ name: n.name, kind: n.kind, x: Math.round(n.x), y: Math.round(n.y), w: n.w, h: n.h, tag: n.kind === 'activity' ? (n.handler ? 'Undo step' : ACTOR_LABEL[n.actor]) : n.kind === 'decision' ? 'Decision' : { start: 'Start', end: 'End', timer: 'Timer', wait: 'Waits for event', publish: 'Announces event' }[n.mode] || 'Event', mode: n.mode || n.actor || 'decision' })),
        edges: l.edges.map(e => ({ a: e.a, b: e.b, kind: e.kind, segs: e.segs, tip: e.tip })),
    })),
    customers, all,
};
fs.writeFileSync(out, JSON.stringify(story));

for (const c of customers) {
    console.log(`\n${c.name} (${c.ending.label}), ${c.beats.length} beats, runs: ${c.runs.map(r => `${r.name} ${r.steps.length} steps`).join('; ')}`);
    if (process.env.VERBOSE) for (const b of c.beats) console.log(`  ${b.gap ? `[${b.gap}] ` : ''}${b.when}  ${b.lane.padEnd(7)} ${b.kind.padEnd(14)} ${b.cap}`);
}
console.log(`\n${all.length} moments across all journeys; ${(fs.statSync(out).size / 1024).toFixed(0)} KB -> ${path.relative(process.cwd(), out)}`);
