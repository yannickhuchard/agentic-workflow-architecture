// A live demonstration of the electricity onboarding example, paced for a viewer (and a screen recording).
//
//   cd sdk/typescript && npm install && npm run build
//   node examples/electricity-onboarding/demo/live.mjs [--port 4600] [--speed 1] [--scenario solar-prosumer|all|<name>] [--adapters-port 4545]
//        [--then all --then-speed 8]   then the other scenarios, faster, so that the journey view and the measures fill
//
// It starts the reference adapters (adapters/mock-server.mjs), an AWA host in this process (AwaRuntime) with
// both workflows and the journey registered, scripted AI agents whose answers are realistic and whose work takes
// a second or two, tools that really call the adapters over HTTP, and the SDK's HTTP server with the views. Then
// it plays the scenarios: applications, documents, people completing their tasks under their own names, signed
// contracts, completed switches. A whole prosumer onboarding takes about 70 seconds at --speed 1.
//
// Standard output is one JSON object per line:
//   {"t": <ms since start>, "kind": "action", "text": ..., "run_id": ..., "instance_id": ...}   something done to the host
//   {"t": ..., "kind": "event", "text": ..., "run_id": ..., "instance_id": ...}                 something the host recorded
//   {"t": ..., "kind": "ready", "urls": {...}}     first line: where the views are
//   {"t": ..., "kind": "phase", "text": ...}      with --then: the other scenarios begin (their actions carry "main": false)
//   {"t": ..., "kind": "done", "run_id": ..., "instance_id": ..., "urls": {...}}   last line: the views of the main scenario's run
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
import { load_example, scripted_actors, scripted_decisions, watching_journal, play, DEMO_SECRETS } from '../scenarios/play.mjs';
import { start_adapters } from '../adapters/mock-server.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
export const MAIN_SCENARIO = 'solar-prosumer';
/** How long a viewer is given before each step, at --speed 1 */
const STEP_PAUSE_MS = 6000;

/** Every string of a value, with `from` replaced by `to` */
const replace_all = (value, from, to) => JSON.parse(JSON.stringify(value).split(from).join(to));

/** What a journal event says, in a line a viewer can read; undefined for the events not worth a line */
function describe(event) {
    const d = event.data || {}, node = event.node_name;
    switch (event.type) {
        case 'run.started': return `Run started: ${d.workflow_name}${d.parent ? ' (child run)' : ''}`;
        case 'activity.completed': return `${node} completed${d.principal ? ` by ${d.principal.id}` : ''}${d.approvals ? ` (approved by ${d.approvals.map(a => a.id).join(' and ')})` : ''}`;
        case 'decision.evaluated': {
            const outputs = Object.entries(d.outputs || {}).map(([k, v]) => `${k} = ${Array.isArray(v) ? v.join(', ') : v}`).join('; ');
            return `Decision "${node}" by ${d.method}: ${d.model?.option ? `${d.model.option} (confidence ${d.model.confidence})` : outputs || 'default route'}`;
        }
        case 'tool.completed': return `${node}: ${d.tool} -> ${d.link} (${d.status})`;
        case 'tool.failed': return `${node}: ${d.tool} refused or failed (${d.error?.code})`;
        case 'guardrail.triggered': return `Guardrail "${d.name}" ${d.action === 'block' ? 'blocked' : d.action === 'redact' ? 'redacted' : d.action} ${d.categories?.join(', ')} at ${d.stage} of ${node}`;
        case 'contract.checked': return d.passed ? undefined : `${node}: outcome contract not met (${d.violations.map(v => v.name).join('; ')})`;
        case 'contract.escalated': return `${node}: handed to a person`;
        case 'authorization.decided': return d.decision === 'deny' ? `Refused: ${d.principal.id} may not ${d.action.replace('_', ' ')} "${node}" (${d.reason})` : d.approval ? `${d.principal.id} approves "${node}" (${d.approval.given} of ${d.approval.required})` : undefined;
        case 'token.waiting': return d.reason === 'human_task' ? `${node} waits for a person` : undefined;
        case 'event.waiting': return `Waits for ${d.name}`;
        case 'event.timed_out': return `No ${d.name} before the deadline`;
        case 'event.published': return `Publishes ${d.name}`;
        case 'subworkflow.started': return `${node}: starts the child run "${d.workflow_name}"`;
        case 'subworkflow.completed': return `${node}: the child run completed`;
        case 'sla.warning': return `Service level warning: ${d.name}`;
        case 'sla.breached': return `Service level breached: ${d.name}`;
        case 'activity.compensated': return `Compensation: ${node} undoes ${d.compensates_activity_name}`;
        case 'run.completed': return 'Run completed';
        case 'run.failed': return `Run failed${d.compensation ? `, ${d.compensation.succeeded} of ${d.compensation.attempted} compensations done` : ''}`;
        default: return undefined;
    }
}

/**
 * Start the demonstration. `sdk` is the SDK module (the built package, or its sources in a test). Resolves once
 * the servers listen; `done` resolves after the last scenario, with the URLs of the main scenario's run.
 */
export async function start_demo({ sdk, port = 4600, adapters_port = 4545, speed = 1, scenario = MAIN_SCENARIO, then, then_speed, out = line => process.stdout.write(`${JSON.stringify(line)}\n`) }) {
    const started = Date.now();
    const emit = line => out({ t: Date.now() - started, ...line });
    const sleep = ms => new Promise(resolve => setTimeout(resolve, ms / speed));

    // --- The reference adapters, and the documents pointed at them -----------------------------
    const adapters = await start_adapters(adapters_port);
    const adapters_at = `localhost:${adapters.address().port}`;
    let example = load_example();
    if (adapters_at !== 'localhost:4545') example = replace_all(example, 'localhost:4545', adapters_at);
    const chosen = scenario === 'all' ? example.scenarios : example.scenarios.filter(s => s.name === scenario);
    if (!chosen.length) throw new Error(`No scenario "${scenario}". Scenarios: ${example.scenarios.map(s => s.name).join(', ')}, or all`);
    // With --then all: the other scenarios after the chosen ones, at --then-speed, so that the views fill with customers
    const afterwards = then === 'all' ? example.scenarios.filter(s => !chosen.includes(s)) : [];

    // --- The host: a business clock that moves with real time, and jumps when the timeline says days pass ---
    let offset = 0;
    const now = () => Date.now() + offset;
    const today = () => new Date(now()).toISOString().slice(0, 10);
    const journal = watching_journal(new sdk.InMemoryJournalStore());
    const by_application = new Map(example.scenarios.map(s => [s.application.application_id, s]));
    const runtime = new sdk.AwaRuntime({
        now,
        engine: {
            actors: scripted_actors({ scripts: example.scripts, scenario_of: id => by_application.get(id), wait: sleep, today }),
            wait_for_human_tasks: true,
            journal,
            now,
            execution_logger: { log_execution: async () => { } },
            pricing_config: { input_token_cost_per_1k: 0.003, output_token_cost_per_1k: 0.015, currency: 'EUR', software_cost_per_execution: 0.001 },
            // Real HTTP calls, held to the deployment's hosts; the reference adapters only check a key is sent
            tools: { ...example.deployment.tools, allowed_hosts: [adapters_at], secrets: DEMO_SECRETS },
            authorization: sdk.load_authorization(example.deployment.authorization),
            guardrails: example.deployment.guardrails,
            model_providers: [new sdk.FunctionModelProvider('scripted', scripted_decisions({ scripts: example.scripts, wait: sleep }))],
            model_tiers: { fast: 'scripted:fast-model', balanced: 'scripted:balanced-model', reasoning: 'scripted:reasoning-model' },
        },
    });
    const workflows = [sdk.parse_document(example.grid), sdk.parse_document(example.onboarding)];
    for (const workflow of workflows) runtime.register_workflow(workflow);
    runtime.register_journey(sdk.JourneyDefinitionSchema.parse(example.journey));

    // --- Which run is which: workflows, roots, journeys ------------------------------------------
    const run_workflow = new Map(), run_root = new Map();
    const instance_of = run_id => runtime.list_journey_instances().find(i => i.runs.some(r => r.run_id === (run_root.get(run_id) || run_id)))?.id;
    journal.listeners.add(event => {
        if (event.type === 'run.started') {
            run_workflow.set(event.run_id, event.workflow_id);
            if (event.data?.parent) run_root.set(event.run_id, event.data.parent.root_run_id || event.data.parent.run_id);
        }
        const text = describe(event);
        if (text) emit({ kind: 'event', text, run_id: event.run_id, instance_id: instance_of(event.run_id) });
    });
    // What the journeys recorded since last asked: stages, goals, endings
    const seen = new Map();
    const journey_lines = () => {
        for (const instance of runtime.list_journey_instances()) {
            const from = seen.get(instance.id) || 0;
            for (const e of instance.events.slice(from)) {
                const text = { 'journey.stage_entered': `Journey: stage "${e.data.stage_name}"`, 'journey.goal_reached': `Journey: goal "${e.data.goal_name}" reached`, 'journey.completed': 'Journey completed', 'journey.abandoned': `Journey abandoned: ${e.data.reason}`, 'journey.stalled': `Journey stalled: ${e.data.reason || `longer than allowed in stage "${e.data.stage_name}"`}` }[e.type];
                if (text) emit({ kind: 'event', text, run_id: e.run_id, instance_id: instance.id });
            }
            seen.set(instance.id, instance.events.length);
        }
    };

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
                pause: async () => { journey_lines(); await sleep(STEP_PAUSE_MS); },
                log: entry => { journey_lines(); emit({ kind: 'action', text: entry.text, run_id: entry.run_id || instance_of_application(entry.application_id), instance_id: entry.instance_id }); },
                today,
            });
            journey_lines();
            if (s.name === MAIN_SCENARIO || !main) main = instance;
        }
        if (afterwards.length && !stopped) {
            speed = then_speed || speed;
            emit({ kind: 'phase', text: `${afterwards.length} more customers, at ${speed} times the speed` });
            for (const s of afterwards) {
                if (stopped) break;
                await play(sdk, runtime, journal, example, s, {
                    advance: ms => { offset += ms; },
                    pause: async () => { journey_lines(); await sleep(STEP_PAUSE_MS); },
                    log: entry => { journey_lines(); emit({ kind: 'action', main: false, text: entry.text, run_id: entry.run_id || instance_of_application(entry.application_id), instance_id: entry.instance_id }); },
                    today,
                });
                journey_lines();
            }
        }
        const run = main?.runs.find(r => !r.parent_run_id);
        const child = main?.runs.find(r => r.parent_run_id);
        const urls = { ...views, replay: run && replay(run.run_id), ...(child ? { replay_child_run: replay(child.run_id) } : {}) };
        emit({ kind: 'done', text: 'The timeline is over. The views keep serving until the process is stopped.', run_id: run?.run_id, instance_id: main?.id, urls });
        return { urls, run_id: run?.run_id, instance_id: main?.id, child_run_id: child?.run_id };
    })();
    const instance_of_application = application_id => runtime.list_journey_instances().find(i => i.subject_key === application_id)?.runs.find(r => !r.parent_run_id)?.run_id;

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
        sdk, port: Number(option('port', 4600)), adapters_port: Number(option('adapters-port', 4545)),
        speed: Number(option('speed', 1)), scenario: option('scenario', MAIN_SCENARIO),
        then: option('then'), then_speed: Number(option('then-speed', 0)) || undefined,
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
