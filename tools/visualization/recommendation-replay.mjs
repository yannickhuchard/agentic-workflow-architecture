// Measures the effect of a recommendation by counterfactual replay (specification section 20), where a replay can:
// for each recommendation of an example that carries a replayable candidate (today: an outcome contract's attempt
// budget), it replays every run concerned with ai: "recorded" under the changed workflow, and writes the reports
// beside the example, so that the journey view and the dossier can say "measured by replay" and show it.
//
//   cd sdk/typescript && npm run build
//   node tools/visualization/recommendation-replay.mjs [examples/<name> ...]
//
// Writes, for each example with a views/story-options.json:
//   examples/<name>/recommendations/replays.json                  what the view and the dossier read (options.recommendations.replays)
//   examples/<name>/recommendations/replay/<id>.<run>.json and .md  each replay report in full
// Nothing calls a model and nothing calls a tool: a replay has no side effects. The files are the same bytes every time.

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const here = path.dirname(fileURLToPath(import.meta.url)), root = path.resolve(here, '../..');
const sdk = require(path.join(root, 'sdk/typescript/dist/index.js'));
const { compute } = require('./awa-recommendations.js');

const args = process.argv.slice(2);
const examples = (args.length ? args : ['examples/electricity-onboarding', 'examples/life-insurance-savings']).map(a => path.resolve(root, a));

const H = 3600000;
const minutes = ms => Math.round(ms / 60000);

async function replayExample(dir) {
    const record = JSON.parse(fs.readFileSync(path.join(dir, 'journeys.json'), 'utf8'));
    const optionsFile = path.join(dir, 'views/story-options.json');
    const options = fs.existsSync(optionsFile) ? JSON.parse(fs.readFileSync(optionsFile, 'utf8')) : {};
    const { recommendations: conf = {} } = options;
    const result = compute(record, { ...options, recommendations: { ...conf, replays: {} } });
    const candidates = result.recommendations.filter(r => r.replay && r.replay.kind === 'contract_budget');
    // every journal of the example, by run
    const journals = new Map();
    for (const f of fs.readdirSync(path.join(dir, 'runs')).filter(f => f.endsWith('.jsonl')).sort()) {
        for (const e of sdk.parse_journal(fs.readFileSync(path.join(dir, 'runs', f), 'utf8'))) {
            if (!journals.has(e.run_id)) journals.set(e.run_id, { file: `runs/${f}`, events: [] });
            journals.get(e.run_id).events.push(e);
        }
    }
    const workflows = new Map();
    for (const f of fs.readdirSync(dir).filter(f => f.endsWith('.awa.json')).sort()) {
        const doc = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
        workflows.set(doc.id, { file: f, doc });
    }
    const outDir = path.join(dir, 'recommendations'), repDir = path.join(outDir, 'replay');
    fs.mkdirSync(repDir, { recursive: true });
    const summary = {
        about: 'Counterfactual replay (specification section 20) of the recommendations a replay can measure, written by node tools/visualization/recommendation-replay.mjs. Read by the journey view and the dossier through options.recommendations.replays.',
    };
    // every outcome contract check and failed attempt of the journey, to show the effect on the measures
    const allRunEvents = record.journeys.flatMap(j => j.instances.flatMap(i => i.runs.flatMap(r => r.events)));
    const checked = allRunEvents.filter(e => e.type === 'contract.checked'), passed = checked.filter(e => (e.data || {}).passed);
    const failedAll = allRunEvents.filter(e => e.type === 'activity.failed').length;

    for (const rec of candidates) {
        const runs = [];
        for (const ref of rec.replay.runs) {
            const j = journals.get(ref.run_id), w = workflows.get(ref.workflow_id);
            if (!j || !w) { console.error(`${path.basename(dir)}: no journal or workflow for run ${ref.run_id}`); continue; }
            const workflow = sdk.parse_document(w.doc);
            const doc = JSON.parse(JSON.stringify(w.doc));
            const changed = [];
            for (const a of doc.activities) if (rec.replay.activities.includes(a.id) && a.outcome_contract) {
                a.outcome_contract.budgets = { ...(a.outcome_contract.budgets || {}), max_attempts: rec.replay.max_attempts };
                changed.push(a);
            }
            const candidate = sdk.parse_document(doc);
            const { report, events } = await sdk.counterfactual_replay(workflow, j.events, { candidate, ai: 'recorded' });
            // what changes from one replay to the next is not part of the report: the candidate's run id and its wall-clock time
            report.candidate.run_id = 'replay';
            report.candidate.duration_ms = 0;
            const at = id => report.nodes.find(n => n.node_id === id);
            const inBase = (type, ids) => j.events.filter(e => e.type === type && ids.includes(e.node_id));
            const inCand = (type, ids) => events.filter(e => e.type === type && ids.includes(e.node_id));
            const ids = changed.map(a => a.id);
            const attemptsBase = ids.reduce((s, id) => s + ((at(id) || {}).baseline || {}).attempts || 0, 0);
            const attemptsCand = ids.reduce((s, id) => s + ((at(id) || {}).candidate || {}).attempts || 0, 0);
            // The replay supplies the step's recorded result, so its journal shows what the rest of the run does under the
            // new budget (path, status, people, regressions). What the step itself does under the budget is computed from the
            // recorded attempts: the first max_attempts attempts happen as recorded, the ones after them do not.
            const failedBase = inBase('activity.failed', ids), kept = Math.min(rec.replay.max_attempts, failedBase.length);
            const durations = failedBase.map(e => (e.data || {}).duration_ms || 0);
            const agentBase = durations.reduce((s, d) => s + d, 0), agentCand = durations.slice(0, kept).reduce((s, d) => s + d, 0);
            const checksBase = j.events.filter(e => e.type === 'contract.checked').length;
            const customer = record.journeys.flatMap(jj => jj.instances).find(i => i.runs.some(r => r.run_id === ref.run_id));
            const short = ref.run_id.slice(4, 8);
            const base = `${rec.id}.${short}`;
            fs.writeFileSync(path.join(repDir, base + '.json'), JSON.stringify(report, null, 2) + '\n');
            fs.writeFileSync(path.join(repDir, base + '.md'), sdk.render_counterfactual_report(report) + '\n');
            runs.push({
                customer: rec.customers.find(c => c.run_id === ref.run_id || c.index === ref.customer)?.name || customer?.instance.subject_key,
                instance: customer?.instance.id, run_id: ref.run_id, run: short, workflow: workflow.name, journal: j.file,
                report: `replay/${base}.json`, report_md: `replay/${base}.md`,
                status: [report.baseline.status, report.candidate.status], same_path: report.same_path, regressions: report.regressions,
                steps: changed.map(a => ({ name: a.name, verdict: (at(a.id) || {}).verdict, attempts: [((at(a.id) || {}).baseline || {}).attempts, ((at(a.id) || {}).candidate || {}).attempts] })),
                attempts_at_step: [attemptsBase, attemptsCand], attempts_run: [report.baseline.attempts, report.candidate.attempts],
                failed_at_step: [failedBase.length, kept],
                contracts_checked: [checksBase, checksBase - (failedBase.length - kept)],
                agent_ms_at_step: [agentBase, agentCand],
                replayed: { attempts_at_step: attemptsCand, failed_at_step: inCand('activity.failed', ids).length, contracts_checked: events.filter(e => e.type === 'contract.checked').length },
                who_decided: inBase('activity.completed', ids).filter(e => e.data && e.data.principal && e.data.principal.kind === 'person').map(e => e.data.principal.id),
            });
        }
        if (!runs.length) continue;
        const sum = k => [runs.reduce((s, r) => s + r[k][0], 0), runs.reduce((s, r) => s + r[k][1], 0)];
        const att = sum('attempts_at_step'), failed = sum('failed_at_step'), ag = sum('agent_ms_at_step'), cc = sum('contracts_checked');
        const removed = cc[0] - cc[1];
        const regress = runs.flatMap(r => r.regressions);
        summary[rec.id] = {
            method: 'replay', ai: 'recorded',
            candidate: `budgets.max_attempts: ${rec.replay.max_attempts} on ${[...new Set(runs.flatMap(r => r.steps.map(s => s.name)))].join(' and ')}`,
            runs,
            same_status: runs.every(r => r.status[0] === r.status[1]), same_path: runs.every(r => r.same_path), regressions: regress,
            before: { 'Attempts at the step': String(att[0]), 'Failed attempts, all runs': String(failedAll), 'Outcome contracts met': `${passed.length} of ${checked.length}`, 'Agent time on the failed attempts': `${minutes(ag[0])} min` },
            after: { 'Attempts at the step': String(att[1]), 'Failed attempts, all runs': String(failedAll - (failed[0] - failed[1])), 'Outcome contracts met': `${passed.length} of ${checked.length - removed}`, 'Agent time on the failed attempts': `${minutes(ag[1])} min` },
            text: `Counterfactual replay with ai: recorded on the ${runs.length === 1 ? 'run' : runs.length + ' runs'} concerned: attempts at the step ${att[0]} → ${att[1]}, ${failed[0] - failed[1]} failed ${failed[0] - failed[1] === 1 ? 'attempt' : 'attempts'} fewer, about ${minutes(ag[0] - ag[1])} minutes of agent time fewer (the recorded durations of the attempts not made; the replay supplies the step's recorded result, so these figures come from the recorded attempts). ${runs.every(r => r.same_path) ? 'The same path and the same people deciding' : 'The path changed'}; ${regress.length ? `${regress.length} regression${regress.length > 1 ? 's' : ''}` : 'no regression'}. Right first time is unchanged: an escalation still counts.`,
        };
    }
    const file = path.join(outDir, 'replays.json');
    fs.writeFileSync(file, JSON.stringify(summary, null, 2) + '\n');
    console.log(`${path.relative(root, file)}: ${Object.keys(summary).filter(k => k !== 'about').map(k => `${k} (${summary[k].runs.length} runs, ${summary[k].regressions.length} regressions)`).join(', ') || 'nothing a replay can measure'}`);
}

for (const dir of examples) await replayExample(dir);
