// A live demonstration of the workplace pension savings example, paced for a viewer (and a screen recording).
//
//   cd sdk/typescript && npm install && npm run build
//   node examples/life-insurance-savings/demo/live.mjs [--port 4620] [--speed 1] [--scenario lea-full-year|all|<name>] [--adapters-port 4560]
//        [--then all --then-speed 8 --then-pause 10]   then the other scenarios, faster, so that the journey view and
//        the measures fill; --then-pause waits that many seconds between the main scenario and the others
//
// It starts the reference adapters (adapters/mock-server.mjs), an AWA host in this process (AwaRuntime) with
// the seven workflows and the journey registered, scripted AI agents whose answers are realistic and whose work
// takes a second or two, tools that really call the adapters over HTTP, and the SDK's HTTP server with the views.
// Then it plays the scenarios: invitations, advice, questionnaires, people completing their tasks under their own
// names, signatures, a year of payroll contributions, the tax certificate and the annual review. The business clock
// starts at the scenario's first day and jumps where the timeline says days pass. Léa's whole year takes about
// three minutes at --speed 1.
//
// Standard output is one JSON object per line:
//   {"t": <ms since start>, "kind": "action", "actor": ..., "text": ..., "run_id": ..., "instance_id": ...}   something done to the host
//   {"t": ..., "kind": "event", "actor": ..., "text": ..., "event": <record type>, "run_id": ..., "instance_id": ...}   something the host recorded
//   {"t": ..., "kind": "ready", "urls": {...}}     first line: where the views are
//   {"t": ..., "kind": "phase", "text": ...}      with --then: the other scenarios begin (their actions carry "main": false)
//   {"t": ..., "kind": "done", "run_id": ..., "instance_id": ..., "urls": {...}}   last line: the views of the main scenario's run
// "text" is a sentence a viewer reads. "actor" says who acted: customer, system, agent (an AI agent), person,
// guardrail, refused (a person or a call refused) or journey. An event line also carries "event", the type of the
// record it tells ("activity.completed", "journey.stage_entered"), "workflow" (the run's workflow), and where it
// applies "child_run_id" (subworkflow.started and .completed) or "stage" (journey.stage_entered).
// The server keeps serving after the last line, until the process receives SIGINT or SIGTERM.
//
// Besides the SDK's routes, this script serves, for every run the host starts, child runs included:
//   GET /api/v1/workflows/runs/<run id>/workflow        the workflow definition of the run
//   GET /api/v1/workflows/runs/<run id>/events           its journal as JSON (?after=<seq>)
//   GET /api/v1/workflows/runs/<run id>/events/stream   its journal as Server-Sent Events, in the SDK's format
// so that tools/visualization/replay.html?run=http://localhost:<port>/api/v1/workflows/runs/<run id> follows it
// live. The SDK's own routes under /api/v1/workflows only know the runs started through them, not a journey's.
// The SDK's views do not include the replay view, so this script also serves tools/visualization/replay.html
// (and the script it loads) as /views/replay.html.

import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { load_example, scripted_actors, watching_journal, play, DEMO_SECRETS } from '../scenarios/play.mjs';
import { start_adapters } from '../adapters/mock-server.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
export const MAIN_SCENARIO = 'lea-full-year';
/** How long a viewer is given before each step, at --speed 1; a month's payroll is read faster */
const STEP_PAUSE_MS = 6000;
const MONTHLY_PAUSE_MS = 1500;

/** Every string of a value, with `from` replaced by `to` */
const replace_all = (value, from, to) => JSON.parse(JSON.stringify(value).split(from).join(to));

// ------------------------------------------------------------------ what a viewer reads

const words = value => String(value).replace(/_/g, ' ');
const EUR = value => `${Number(value).toLocaleString('en-GB')} EUR`;
/** What each tool of the example does, as the rest of a sentence that begins with the step's name */
const TOOL = {
    register_enrolment: () => 'creates the enrolment in the policy administration system',
    send_notification: a => `sends the employee ${a.channel === 'email' ? 'an e-mail' : a.channel === 'portal' ? 'a message in the HR portal' : 'a message in the HR portal and by e-mail'}`,
    get_plan_rules: () => "reads the plan's terms",
    book_video_call: () => 'books a video call with a licensed adviser',
    open_questionnaire: () => 'opens the suitability questionnaire in the HR portal',
    record_suitability_profile: a => `records the ${words(a.risk_profile)} risk profile`,
    list_funds: () => "lists the plan's funds and their key information documents",
    check_allocation: () => 'checks the choice of funds against the risk profile',
    extract_document: a => `reads the ${words(a.document_type || 'document')} through the extraction service`,
    screen_person: () => 'screens the employee against the lists of politically exposed persons and sanctions',
    validate_self_certification: () => 'checks the tax residence self-certification',
    record_due_diligence: a => `records the due diligence file as ${a.outcome}`,
    request_signature: () => 'sends the contract for e-signature',
    issue_policy: () => 'issues the policy',
    cancel_policy: () => 'cancels the policy from its start',
    record_premium: a => `records a premium of ${EUR(a.amount_eur)} for ${a.period}`,
    refund_premium: a => `refunds ${EUR(a.amount_eur)} to the employee`,
    update_beneficiary_clause: () => 'replaces the beneficiary clause',
    create_payroll_deduction: a => `sets up a payroll deduction of ${EUR(a.monthly_amount_eur)} a month`,
    stop_payroll_deduction: () => 'stops the payroll deduction',
    schedule_one_off_deduction: a => `adds a top-up of ${EUR(a.amount_eur)} to the next payroll`,
    place_order: a => `buys units for ${EUR(a.amount_eur)} through the custodian bank`,
    redeem_units: () => 'sells the units through the custodian bank',
    switch_funds: () => 'moves the savings to the new allocation through the custodian bank',
    get_position: () => "reads the plan's value from the custodian bank",
    compute_deductions: a => `computes the deductible amount for tax year ${a.tax_year}`,
    issue_tax_certificate: a => `issues the ${a.tax_year} tax certificate`,
};
/** What the run waits for, by business event */
const AWAITED = {
    'invitation.opened': 'the employee to open the invitation', 'questionnaire.submitted': 'the questionnaire', 'investments.chosen': "the employee's choice of funds",
    'investments.reconsidered': 'the employee to adjust or keep the choice', 'subscription.submitted': 'the subscription form', 'contract.signed': 'the signed contract',
    'payroll.contribution_paid': 'the next payroll', 'cooling_off.ended': 'the end of the 30 days to cancel', 'savings_year.closed': 'the close of the savings year',
    'tax_certificates.due': 'the January certificate run', 'annual_review.answered': "the employee's review answers", 'recommendations.answered': "the employee's answer to the recommendations",
};
const FOUND = { ignore_instructions: 'Hidden instructions', guaranteed_return: 'A promise of a guaranteed return', phone: 'A phone number', email: 'An e-mail address', iban: 'A bank account number' };
const WHERE = { tool_result: node => `in what a tool returned to ${node}`, input: node => `in what ${node} was given`, output: node => `in what ${node} wrote`, tool_call: node => `in a tool call of ${node}` };
const list = values => (values.length > 3 ? `${values.slice(0, 3).join(', ')} and ${values.length - 3} more` : values.join(', '));
const value_words = v => (Array.isArray(v) ? list(v.map(x => words(x))) : v === true ? 'yes' : words(v));

/**
 * The sentence a viewer reads for a journal event, and who acted: { actor, text }, a list of them, or undefined for
 * the records not worth a line. `about` answers what the record alone does not say: the actor type of a step, a person's name,
 * the arguments of a tool call, the workflow of a run.
 */
export function describe(event, about) {
    const d = event.data || {}, node = event.node_name;
    const first = id => (about.person(id) || id).split(/[ ,]/)[0];
    switch (event.type) {
        case 'run.started': return d.parent ? undefined : { actor: 'system', text: `The ${d.workflow_name} workflow starts.` };
        case 'activity.completed': {
            // A person may complete a step an agent began, when its outcome contract hands it over
            if (d.actor_type === 'human' || d.principal?.kind === 'person') return { actor: 'person', text: `${first(d.principal?.id)} completes ${node}${d.approvals ? `, approved by ${d.approvals.map(a => first(a.id)).join(' and ')}` : ''}.` };
            return d.actor_type === 'ai_agent' ? { actor: 'agent', text: `The AI agent completes ${node}.` } : undefined;
        }
        case 'decision.evaluated': {
            if (d.method === 'model') return { actor: 'agent', text: `A model decides ${node}: ${value_words(d.outputs?.option ?? d.model?.option)}, ${Math.round((d.outputs?.confidence ?? d.model?.confidence ?? 0) * 100)}% sure.` };
            const outputs = Object.entries(d.outputs || {}).filter(([, v]) => v !== false && v !== 0 && v !== null).map(([k, v]) => `${words(k)} ${value_words(v)}`);
            return { actor: 'system', text: `The ${node} table decides: ${outputs.join('; ') || 'the default route'}.` };
        }
        case 'tool.completed': {
            const call = about.call(d.call_id), phrase = TOOL[d.tool];
            return { actor: about.actor(event), text: phrase ? `${node} ${phrase(call?.arguments || {})}.` : `${node} calls ${words(d.tool)}.` };
        }
        // A call a guardrail blocked is told by the guardrail's own line
        case 'tool.failed': return d.error?.code === 'GUARDRAIL_BLOCKED' ? undefined : { actor: 'system', text: `${node}: the call to ${words(d.tool)} fails (${d.error?.code}).` };
        case 'guardrail.triggered': {
            const what = FOUND[d.categories?.[0]] || `${words(d.categories?.[0] || d.check)}`.replace(/^./, c => c.toUpperCase());
            const thing = d.stage === 'tool_result' && about.call(d.call_id)?.arguments?.document_type ? `the ${words(about.call(d.call_id).arguments.document_type)}` : 'it';
            const effect = d.action === 'redact' ? `${thing === 'it' ? 'it' : thing} is removed before anyone reads it` : d.action === 'retry_with_feedback' ? 'the answer is withheld and the agent writes it again' : d.stage === 'tool_result' ? `${thing === 'it' ? 'the result' : thing} is withheld from the agent` : d.stage === 'output' ? 'the result is blocked' : 'the agent does not see it';
            const found = { actor: 'guardrail', text: `${what} found ${WHERE[d.stage] ? WHERE[d.stage](node) : `at ${words(d.stage)} of ${node}`}: ${effect}.` };
            // What a tool returned is checked before the agent reads it: the call is told first, then what the guardrail found in its answer
            const call = d.stage === 'tool_result' && about.call(d.call_id);
            return call && TOOL[call.tool] ? [{ actor: about.actor(event), text: `${node} ${TOOL[call.tool](call.arguments || {})}.` }, found] : found;
        }
        case 'contract.checked': {
            if (d.passed) return undefined;
            const names = d.violations.map(v => `“${v.name}”`);
            return { actor: 'agent', text: `${node} does not meet its outcome contract: ${names.join(' and ')} ${names.length === 1 ? 'fails' : 'fail'}.` };
        }
        case 'contract.escalated': return { actor: 'person', text: `${node} goes to a person, as its outcome contract says.` };
        case 'authorization.decided': {
            if (d.decision === 'deny') {
                const prior = /performed "([^"]+)"/.exec(d.message || '')?.[1];
                const why = d.reason === 'separation_of_duties' ? `${prior ? `${first(d.principal.id)} did ${prior} in this run, and ` : ''}separation of duties forbids it`
                    : d.reason === 'four_eyes' ? 'the second approval must come from another person (four eyes)'
                    : d.reason === 'no_rule' ? `no rule of the policy lets ${d.resource?.role_name ? `anyone but a ${d.resource.role_name.toLowerCase()}` : 'them'} do it`
                    : d.reason === 'rule' ? 'a rule of the policy denies it' : words(d.reason);
                return { actor: 'refused', text: `${first(d.principal.id)} is refused ${node}: ${why}.` };
            }
            return d.approval ? { actor: 'person', text: `${first(d.principal.id)} approves ${node} (${d.approval.given} of ${d.approval.required}).` } : undefined;
        }
        case 'token.waiting': return d.reason === 'human_task' ? { actor: 'person', text: `${node} waits for a person.` } : undefined;
        case 'event.waiting': return { actor: 'system', text: `The run waits for ${AWAITED[d.name] || `“${d.name}”`}.` };
        case 'event.timed_out': return { actor: 'system', text: `No sign of ${AWAITED[d.name] || `“${d.name}”`} before the deadline: the run takes the path planned for that.` };
        case 'event.published': return { actor: 'system', text: `The run announces “${d.name}”.` };
        case 'subworkflow.started': return { actor: 'system', text: `${node} starts the child run ${d.workflow_name}.` };
        case 'subworkflow.completed': return { actor: 'system', text: `The child run is complete: ${node} goes on.` };
        case 'sla.warning': return { actor: 'system', text: `Service level warning: ${d.name}.` };
        case 'sla.breached': return { actor: 'system', text: `Service level breached: ${d.name}.` };
        case 'activity.compensated': return { actor: 'system', text: `Compensation: ${node} undoes ${d.compensates_activity_name}.` };
        case 'run.completed': return { actor: 'system', text: `The ${about.workflow(event.run_id)} run is complete.` };
        case 'run.failed': return { actor: 'system', text: `The ${about.workflow(event.run_id)} run fails${d.compensation ? `; ${d.compensation.succeeded} of ${d.compensation.attempted} completed steps are undone` : ''}.` };
        default: return undefined;
    }
}

/** The sentence for a record of a journey */
function describe_journey(e) {
    const d = e.data || {};
    switch (e.type) {
        case 'journey.stage_entered': return `The journey enters the stage “${d.stage_name}”.`;
        case 'journey.goal_reached': return `Goal “${d.goal_name}” reached.`;
        case 'journey.completed': return 'The journey is complete.';
        case 'journey.abandoned': return `The journey ends: ${d.reason}.`;
        case 'journey.stalled': return `The journey is stalled${d.stage_name ? ` in “${d.stage_name}”` : ''}: ${d.reason || 'it has been there longer than it is given'}.`;
        default: return undefined;
    }
}

/**
 * Start the demonstration. `sdk` is the SDK module (the built package, or its sources in a test). Resolves once
 * the servers listen; `done` resolves after the last scenario, with the URLs of the main scenario's run.
 */
export async function start_demo({ sdk, port = 4620, adapters_port = 4560, speed = 1, scenario = MAIN_SCENARIO, then, then_speed, then_pause = 0, out = line => process.stdout.write(`${JSON.stringify(line)}\n`) }) {
    const started = Date.now();
    const emit = line => out({ t: Date.now() - started, ...line });
    const sleep = ms => new Promise(resolve => setTimeout(resolve, ms / speed));

    // --- The reference adapters, and the documents pointed at them -----------------------------
    const adapters = await start_adapters(adapters_port);
    const adapters_at = `localhost:${adapters.address().port}`;
    let example = load_example();
    if (adapters_at !== 'localhost:4560') example = replace_all(example, 'localhost:4560', adapters_at);
    const chosen = scenario === 'all' ? example.scenarios : example.scenarios.filter(s => s.name === scenario);
    if (!chosen.length) throw new Error(`No scenario "${scenario}". Scenarios: ${example.scenarios.map(s => s.name).join(', ')}, or all`);
    // With --then all: the other scenarios after the chosen ones, at --then-speed, so that the views fill with customers
    const afterwards = then === 'all' ? example.scenarios.filter(s => !chosen.includes(s)) : [];

    // --- The host: a business clock that starts on the first scenario's first day, moves with real time, and jumps when the timeline says days pass ---
    let offset = Date.parse(chosen[0].starts) - Date.now();
    const now = () => Date.now() + offset;
    const today = () => new Date(now()).toISOString().slice(0, 10);
    const journal = watching_journal(new sdk.InMemoryJournalStore());
    const by_enrolment = new Map(example.scenarios.map(s => [s.invitation.enrolment_id, s]));
    const runtime = new sdk.AwaRuntime({
        now,
        engine: {
            actors: scripted_actors({ scripts: example.scripts, scenario_of: id => by_enrolment.get(id), wait: sleep, today }),
            wait_for_human_tasks: true,
            journal,
            now,
            execution_logger: { log_execution: async () => { } },
            pricing_config: { input_token_cost_per_1k: 0.003, output_token_cost_per_1k: 0.015, currency: 'EUR', software_cost_per_execution: 0.001 },
            // Real HTTP calls, held to the deployment's hosts; the reference adapters only check a key is sent
            tools: { ...example.deployment.tools, allowed_hosts: [adapters_at], secrets: DEMO_SECRETS },
            authorization: sdk.load_authorization(example.deployment.authorization),
            guardrails: example.deployment.guardrails,
            model_tiers: { fast: 'scripted:fast-model', balanced: 'scripted:balanced-model', reasoning: 'scripted:reasoning-model' },
        },
    });
    for (const workflow of example.workflows) runtime.register_workflow(sdk.parse_document(workflow));
    runtime.register_journey(sdk.JourneyDefinitionSchema.parse(example.journey));

    // --- Which run is which: workflows, roots, journeys ------------------------------------------
    const run_workflow = new Map(), run_root = new Map();
    const instance_of = run_id => runtime.list_journey_instances().find(i => i.runs.some(r => r.run_id === (run_root.get(run_id) || run_id)))?.id;
    const people = new Map((example.deployment.authorization.principals || []).map(p => [p.id, p.name]));
    const calls = new Map();
    const workflow_name = run_id => runtime.get_workflow(run_workflow.get(run_id))?.name;
    const about = {
        person: id => people.get(id),
        call: id => calls.get(id),
        workflow: workflow_name,
        // Who did a step: the actor type its workflow gives it
        actor: event => {
            const type = runtime.get_workflow(run_workflow.get(event.run_id))?.activities.find(a => a.id === event.node_id)?.actor_type;
            return type === 'ai_agent' ? 'agent' : type === 'human' ? 'person' : 'system';
        },
    };
    journal.listeners.add(event => {
        if (event.type === 'run.started') {
            run_workflow.set(event.run_id, event.workflow_id);
            if (event.data?.parent) run_root.set(event.run_id, event.data.parent.root_run_id || event.data.parent.run_id);
        }
        if (event.type === 'tool.invoked') calls.set(event.data.call_id, event.data);
        const told = describe(event, about);
        for (const line of told ? [told].flat() : []) {
            const extra = event.type.startsWith('subworkflow.') ? { child_run_id: event.data.run_id } : {};
            emit({ kind: 'event', ...line, event: event.type, workflow: workflow_name(event.run_id), run_id: event.run_id, instance_id: instance_of(event.run_id), ...extra });
        }
        journey_lines();
    });
    // What the journeys recorded since last asked: stages, goals, endings
    const seen = new Map();
    function journey_lines() {
        for (const instance of runtime.list_journey_instances()) {
            const from = seen.get(instance.id) || 0;
            seen.set(instance.id, instance.events.length);
            for (const e of instance.events.slice(from)) {
                const text = describe_journey(e);
                if (text) emit({ kind: 'event', actor: 'journey', text, event: e.type, ...(e.type === 'journey.stage_entered' ? { stage: e.data.stage_name } : {}), run_id: e.run_id, instance_id: instance.id });
            }
        }
    }
    // Who does what a scenario's step does: the customer sends what the journey says the customer sends
    const from_subject = new Set(example.journey.touchpoints.filter(t => t.on?.event && t.direction === 'inbound' && t.party === 'subject').map(t => t.on.event));
    const actor_of_action = entry => (entry.complete ? 'person' : entry.publish ? (from_subject.has(entry.publish) ? 'customer' : 'system') : 'system');
    const pause_for = step => sleep(step.monthly ? MONTHLY_PAUSE_MS : STEP_PAUSE_MS);

    // --- The HTTP server: the SDK's routes and views, and the run routes a journey's runs need ------------
    sdk.set_journey_runtime(runtime);
    const app = sdk.createServer({ request_logging: false });
    const runs_route = /^\/api\/v1\/workflows\/runs\/([^/]+)\/(workflow|events|events\/stream)$/;
    const repository_views = path.resolve(here, '../../../tools/visualization');
    const own_views = { '/views/replay.html': 'text/html; charset=utf-8', '/views/replay-sample.js': 'text/javascript; charset=utf-8' };
    const streams = new Set();
    const server = http.createServer(async (req, res) => {
        const url = new URL(req.url, 'http://demo');
        if (req.method === 'GET' && own_views[url.pathname]) {
            res.writeHead(200, { 'content-type': own_views[url.pathname], 'cache-control': 'no-cache' });
            return res.end(fs.readFileSync(path.join(repository_views, path.basename(url.pathname))));
        }
        const match = req.method === 'GET' && url.pathname.match(runs_route);
        const run_id = match && decodeURIComponent(match[1]);
        if (!match || !run_workflow.has(run_id)) return app(req, res);
        res.setHeader('Access-Control-Allow-Origin', '*');
        if (match[2] === 'workflow') {
            res.writeHead(200, { 'content-type': 'application/json' });
            return res.end(JSON.stringify(runtime.get_workflow(run_workflow.get(run_id))));
        }
        const after = Number(url.searchParams.get('after')) || Number(req.headers['last-event-id']) || 0;
        if (match[2] === 'events') {
            res.writeHead(200, { 'content-type': 'application/json' });
            return res.end(JSON.stringify(await journal.read(run_id, after)));
        }
        // Server-Sent Events, as sdk/typescript/src/server/routes/workflows.ts writes them: replay, then live
        res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
        let last = after;
        const send = event => {
            if (event.run_id !== run_id || event.seq <= last) return;
            last = event.seq;
            res.write(`id: ${event.seq}\nevent: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
        };
        const buffered = [];
        let replaying = true;
        const listener = event => (replaying ? buffered.push(event) : send(event));
        journal.listeners.add(listener);
        for (const event of await journal.read(run_id, last)) send(event);
        replaying = false;
        for (const event of buffered) send(event);
        streams.add(res);
        req.on('close', () => { journal.listeners.delete(listener); streams.delete(res); });
    });
    await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, resolve); });
    const base = `http://localhost:${server.address().port}`;
    const views = {
        journey: `${base}/views/journey.html?live=${encodeURIComponent(base)}`,
        dashboard: `${base}/views/dashboard.html?live=${encodeURIComponent(base)}`,
        portfolio: `${base}/api/v1/journeys/portfolio`,
    };
    const replay = run_id => `${base}/views/replay.html?run=${encodeURIComponent(`${base}/api/v1/workflows/runs/${run_id}`)}`;
    emit({ kind: 'ready', text: `Views at ${base}/views/, reference adapters at http://${adapters_at}`, urls: views });

    // --- The timeline -------------------------------------------------------------------------
    let stopped = false;
    const done = (async () => {
        let main;
        for (const s of chosen) {
            if (stopped) break;
            const instance = await play(sdk, runtime, journal, example, s, {
                advance: ms => { offset += ms; },
                pause: async step => { journey_lines(); await pause_for(step); },
                log: entry => { journey_lines(); emit({ kind: 'action', actor: actor_of_action(entry), text: `${entry.text}.`, run_id: entry.run_id || first_run_of(entry.enrolment_id), instance_id: entry.instance_id }); },
                today,
            });
            journey_lines();
            if (s.name === MAIN_SCENARIO || !main) main = instance;
        }
        if (afterwards.length && !stopped) {
            // A moment between the main scenario and the others, in real seconds whatever the speed
            if (then_pause > 0) await new Promise(resolve => setTimeout(resolve, then_pause * 1000));
            speed = then_speed || speed;
            emit({ kind: 'phase', text: `${afterwards.length} more employees, at ${speed} times the speed.` });
            for (const s of afterwards) {
                if (stopped) break;
                await play(sdk, runtime, journal, example, s, {
                    advance: ms => { offset += ms; },
                    pause: async step => { journey_lines(); await pause_for(step); },
                    log: entry => { journey_lines(); emit({ kind: 'action', main: false, actor: actor_of_action(entry), text: `${entry.text}.`, run_id: entry.run_id || first_run_of(entry.enrolment_id), instance_id: entry.instance_id }); },
                    today,
                });
                journey_lines();
            }
        }
        const run = main?.runs[0];
        const child = main?.runs.find(r => r.parent_run_id);
        const urls = { ...views, replay: run && replay(run.run_id), ...(child ? { replay_child_run: replay(child.run_id) } : {}) };
        emit({ kind: 'done', text: 'The timeline is over. The views keep serving until the process is stopped.', run_id: run?.run_id, instance_id: main?.id, urls });
        return { urls, run_id: run?.run_id, instance_id: main?.id, child_run_id: child?.run_id };
    })();
    const first_run_of = enrolment_id => runtime.list_journey_instances().find(i => i.subject_key === enrolment_id)?.runs[0]?.run_id;

    const stop = async () => {
        stopped = true;
        for (const res of streams) res.end();
        // Connections kept alive (the tools' own calls to the adapters, a browser's) would hold close() open
        const closing = [server, adapters].map(s => new Promise(resolve => s.close(resolve)));
        for (const s of [server, adapters]) s.closeAllConnections();
        await Promise.all(closing);
        sdk.set_journey_runtime(undefined);
    };
    return { base, runtime, done, stop };
}

// --- As a command ------------------------------------------------------------------------------
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    const option = (name, fallback) => { const i = process.argv.indexOf(`--${name}`); return i > 0 ? process.argv[i + 1] : fallback; };
    const sdk = await import(path.resolve(here, '../../../sdk/typescript/dist/index.mjs'));
    const demo = await start_demo({
        sdk, port: Number(option('port', 4620)), adapters_port: Number(option('adapters-port', 4560)),
        speed: Number(option('speed', 1)), scenario: option('scenario', MAIN_SCENARIO),
        then: option('then'), then_speed: Number(option('then-speed', 0)) || undefined, then_pause: Number(option('then-pause', 0)) || 0,
    });
    let stopping = false;
    const shutdown = async () => {
        if (stopping) return;
        stopping = true;
        // The timeline may be in the middle of a step: the process ends whatever it was doing
        setTimeout(() => process.exit(0), 2000).unref();
        await demo.stop();
        process.exit(0);
    };
    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);
    demo.done.catch(error => { console.error(error); shutdown(); });
}
