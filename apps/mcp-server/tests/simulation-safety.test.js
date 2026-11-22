// A document comes from an untrusted chat. These tests give the server documents
// that would do real things if anything they name were executed, and check that
// nothing is: no command, no HTTP or JSON-RPC call, no model call, no file.
//
// Each tripwire has a positive control: the same document run through the SDK
// with simulation off does trip it. Without that, a passing test could simply
// mean the workflow never reached the tool.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import net from 'node:net';
import child_process from 'node:child_process';
import { syncBuiltinESMExports } from 'node:module';
import { connect, call, read, workflow, id } from './helpers.js';
import { load_sdk } from '../src/sdk.js';
import { engine_options, virtual_clock, sample_arguments } from '../src/simulation.js';
import { LIMITS } from '../src/limits.js';

const temp = t => { const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'awa-mcp-safety-')); t.after(() => fs.rmSync(dir, { recursive: true, force: true })); return dir; };
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

/** A local server that counts what reaches it */
async function listener(t) {
    const hits = [];
    const server = http.createServer((req, res) => { hits.push(`${req.method} ${req.url}`); res.writeHead(200, { 'content-type': 'application/json' }).end('{"jsonrpc":"2.0","id":1,"result":{}}'); });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    t.after(() => new Promise(resolve => { server.closeAllConnections(); server.close(resolve); }));
    return { hits, url: `http://127.0.0.1:${server.address().port}` };
}

/** Record every outbound connection and every process started while the tripwires are set */
function tripwires(t) {
    const seen = { connections: [], processes: [], fetches: [] };
    const original = { connect: net.Socket.prototype.connect, fetch: globalThis.fetch };
    const names = ['execFile', 'exec', 'spawn', 'fork', 'execFileSync', 'execSync', 'spawnSync'];
    const processes = Object.fromEntries(names.map(name => [name, child_process[name]]));
    net.Socket.prototype.connect = function (...args) { seen.connections.push(JSON.stringify(args[0])?.slice(0, 120)); return original.connect.apply(this, args); };
    globalThis.fetch = (...args) => { seen.fetches.push(String(args[0]?.url || args[0])); return original.fetch(...args); };
    for (const name of names) child_process[name] = function (...args) { seen.processes.push(`${name} ${args[0]}`); return processes[name].apply(this, args); };
    syncBuiltinESMExports();
    const restore = () => { net.Socket.prototype.connect = original.connect; globalThis.fetch = original.fetch; Object.assign(child_process, processes); syncBuiltinESMExports(); };
    t.after(restore);
    return { seen, restore };
}

/** An actor that does what a real agent would: call every tool the activity declares */
const eager_actor = { async execute(activity, inputs, context) { for (const tool of activity.tools) await context.tools.call(tool.name, sample_arguments(tool.parameters)); return { done: true }; } };

function dangerous_workflow(marker, base) {
    const write = `require('fs').writeFileSync(${JSON.stringify(marker)}, 'executed')`;
    return workflow([
        {
            name: 'Run a command', actor_type: 'ai_agent',
            tools: [
                { name: 'touch_file', description: 'Creates a file', binding: { kind: 'command', command: process.execPath, args: ['-e', write] } },
                { name: 'shell', binding: { kind: 'command', command: '/bin/sh', args: ['-c', `echo executed > ${marker}.sh`] } },
            ],
        },
        {
            name: 'Call services', actor_type: 'application',
            programs: [{ id: id(), name: 'Post order', language: 'rest_api', code_uri: `${base}/program` }, { id: id(), name: 'Script', language: 'shell', code: `echo executed > ${marker}.program` }],
            tools: [
                { name: 'http_get', binding: { kind: 'http', method: 'GET', url: `${base}/http-get` } },
                { name: 'http_post', parameters: { type: 'object', properties: { amount: { type: 'number' } }, required: ['amount'] }, binding: { kind: 'http', method: 'POST', url: `${base}/http-post`, headers: { authorization: 'Bearer {{secret:TOKEN}}' } } },
                { name: 'rpc', binding: { kind: 'jsonrpc', endpoint: `${base}/rpc`, method: 'pay' } },
                { name: 'mcp_tool', binding: { kind: 'mcp', server: 'payments', tool: 'transfer' } },
                { name: 'grpc_tool', binding: { kind: 'grpc', endpoint: base.replace('http://', ''), service: 'Pay', method: 'Send' } },
                { name: 'function_tool', binding: { kind: 'function', name: 'process.exit' } },
            ],
        },
        { name: 'Ask a model', actor_type: 'ai_agent', verification: { enabled: true, criteria: [{ id: id(), name: 'Good', type: 'custom', description: 'Is it good', weight: 1 }], pass_threshold: 0.5 } },
        { name: 'Ask a person', actor_type: 'human' },
        { name: 'Move a robot', actor_type: 'robot' },
    ], { roles: undefined });
}
const with_role = (document, base) => {
    const role = { id: id(), name: 'Agent', actor_type: 'ai_agent', ai_model_config: { model_id: 'openai:some-model', system_prompt: 'x' }, mcp_tools: [{ server_name: 'payments', tool_name: 'transfer' }] };
    return { ...document, roles: [role], activities: document.activities.map(a => ({ ...a, role_id: role.id })) };
};

test('simulate_workflow executes nothing a document names: no command, no HTTP, no model, no file', async t => {
    const dir = temp(t), marker = path.join(dir, 'pwned');
    const { hits, url } = await listener(t);
    const document = with_role(dangerous_workflow(marker, url), url);
    const cwd = temp(t), previous = process.cwd();
    process.chdir(cwd); t.after(() => process.chdir(previous));
    for (const key of ['GEMINI_API_KEY', 'OPENAI_API_KEY', 'OLLAMA_BASE_URL']) { const before = process.env[key]; process.env[key] = key === 'OLLAMA_BASE_URL' ? url : 'test-key-not-real'; t.after(() => { if (before === undefined) delete process.env[key]; else process.env[key] = before; }); }
    const { seen, restore } = tripwires(t);

    const client = await connect(t);
    const result = await call(client, 'simulate_workflow', { workflow: document, simulated_tool_results: { http_get: { ok: true } } });
    await wait(300);                                             // anything started in the background would have landed by now
    restore();

    const s = result.structuredContent;
    assert.equal(result.isError, undefined, JSON.stringify(result.content));
    assert.equal(s.status, 'completed', JSON.stringify(s.failures));
    assert.deepEqual(s.path, ['Run a command', 'Call services', 'Ask a model', 'Ask a person', 'Move a robot'], 'the run did reach every activity');
    assert.equal(fs.existsSync(marker), false, 'the command tool created its file');
    assert.deepEqual(fs.readdirSync(dir), [], 'something was written next to the marker');
    assert.deepEqual(hits, [], 'a request reached the HTTP listener');
    assert.deepEqual(seen.processes, [], 'a process was started');
    assert.deepEqual(seen.connections, [], 'a connection was opened');
    assert.deepEqual(seen.fetches, [], 'fetch was called');
    assert.deepEqual(fs.readdirSync(cwd), [], 'a file was written to the working directory');
    assert.deepEqual(s.commands_not_called.sort(), ['shell', 'touch_file'], 'command tools are reported as not called');
    const journal = result._meta.awa.journal;
    const invoked = journal.filter(e => e.type === 'tool.invoked');
    assert.deepEqual(invoked.map(e => e.data.tool).sort(), ['function_tool', 'grpc_tool', 'http_get', 'http_post', 'mcp_tool', 'rpc']);
    assert.ok(invoked.every(e => e.data.simulated === true), 'every recorded tool call is marked simulated');
    assert.ok(journal.filter(e => e.type === 'tool.completed').every(e => e.data.status === 'simulated'));
    assert.equal(journal.some(e => e.type === 'tool.invoked' && /touch_file|shell/.test(e.data.tool)), false);
    assert.equal(JSON.stringify(journal).includes('test-key-not-real'), false, 'no environment secret appears in the journal');
});

test('positive control: the same document does run its command and reach its endpoint when the SDK executes for real', async t => {
    const dir = temp(t), marker = path.join(dir, 'pwned');
    const { hits, url } = await listener(t);
    const { WorkflowEngine, parse_document } = await load_sdk();
    const parsed = parse_document(with_role(dangerous_workflow(marker, url), url));
    const log = console.log; console.log = () => { }; t.after(() => { console.log = log; });
    const { seen, restore } = tripwires(t);
    const engine = new WorkflowEngine(parsed, {
        simulate: false, tools: { allow_commands: true, secrets: { TOKEN: 'x' } }, execution_logger: { log_execution: async () => { } },
        actors: { ai_agent: eager_actor, application: eager_actor, human: eager_actor, robot: eager_actor }, verification_enabled: false,
    });
    await engine.start({}); await engine.run(20);
    restore();
    assert.equal(fs.readFileSync(marker, 'utf8'), 'executed', 'the control did not run the command: the test above proves nothing');
    assert.ok(hits.some(h => h === 'GET /http-get') && hits.some(h => h.startsWith('POST /http-post')) && hits.some(h => h === 'POST /rpc'), `the control did not reach the endpoints: ${hits}`);
    assert.ok(seen.processes.some(p => p.startsWith('execFile')), 'the process tripwire does not see the SDK starting a command');
    assert.ok(seen.connections.length > 0 && seen.fetches.length > 0, 'the network tripwires do not see the SDK calling out');
});

test('the options every simulated engine gets cannot be widened by a caller', async () => {
    const clock = virtual_clock(0), notes = { commands_not_called: new Set() };
    const options = engine_options({ outputs: { A: { output: { x: 1 } } }, tool_results: { t: 1 }, pricing: { currency: 'EUR' }, clock, notes });
    assert.equal(options.simulate, true);
    assert.equal(options.tools.allow_commands, false);
    assert.deepEqual(Object.keys(options.actors).sort(), ['ai_agent', 'application', 'human', 'robot'], 'every actor type is replaced, so no built-in actor is ever constructed');
    for (const forbidden of ['gemini_api_key', 'geminiApiKey', 'model_providers', 'journal', 'checkpoint', 'knowledge', 'decision_engines', 'event_sink', 'dead_letter_queue', 'robot_config'])
        assert.equal(forbidden in options, false, `${forbidden} must not be set`);
    assert.equal(options.learn, false);
    await options.sleep(3_600_000);
    assert.equal(clock.now(), 3_600_000, 'waiting advances the simulated clock instead of the real one');
});

test('simulate_journey executes nothing either, and decisions by a model or an external engine are never asked', async t => {
    const dir = temp(t), marker = path.join(dir, 'pwned');
    const { hits, url } = await listener(t);
    const edge = { a: id(), b: id(), c: id() };
    const base = with_role(dangerous_workflow(marker, url), url);
    const first = base.activities[0], second = base.activities[1];
    const decision = {
        id: id(), name: 'Route', decision_model: { instructions: 'Choose', options: [{ id: 'go', description: 'Go on', output_edge_id: edge.b }, { id: 'also', description: 'Go on as well', output_edge_id: edge.c }] },
        decision_engine: undefined, default_output_edge_id: edge.c,
    };
    const document = {
        ...base, activities: [first, second], decision_nodes: [decision],
        edges: [{ id: edge.a, source_id: first.id, target_id: decision.id }, { id: edge.b, source_id: decision.id, target_id: second.id }, { id: edge.c, source_id: decision.id, target_id: second.id, is_default: true }],
    };
    const journey = {
        id: id(), name: 'Onboarding', version: '1.0.0', subject: { name: 'Customer', key: 'customer_id' },
        stages: [{ id: 'start', name: 'Start', workflows: [document.id] }],
        triggers: [{ event: 'customer.arrived', starts_journey: true, start_workflow: document.id }],
    };
    const { seen, restore } = tripwires(t);
    const client = await connect(t);
    const result = await call(client, 'simulate_journey', { journeys: [journey], workflows: [document], events: [{ type: 'customer.arrived', data: { customer_id: 'c-1' } }], then_wait: 'P30D' });
    await wait(300);
    restore();
    assert.equal(result.isError, undefined, JSON.stringify(result.content));
    assert.equal(result.structuredContent.journeys[0].customers.length, 1);
    assert.equal(result.structuredContent.runs[0].status, 'completed', 'the run reached the end, through the decision');
    assert.equal(fs.existsSync(marker), false);
    assert.deepEqual([hits, seen.processes, seen.connections, seen.fetches], [[], [], [], []]);
    assert.deepEqual(result.structuredContent.commands_not_called.sort(), ['shell', 'touch_file']);
});

test('a simulation cannot run without end or wait in real time', async t => {
    const client = await connect(t);
    const a = id(), b = id(), role = { id: id(), name: 'Loop', actor_type: 'application' };
    const loop = { id: id(), name: 'Loop', version: '1.0.0', roles: [role], activities: [{ id: a, name: 'A', role_id: role.id, actor_type: 'application' }, { id: b, name: 'B', role_id: role.id, actor_type: 'application' }], edges: [{ id: id(), source_id: a, target_id: b }, { id: id(), source_id: b, target_id: a }] };
    let started = Date.now();
    const endless = await call(client, 'simulate_workflow', { workflow: loop });
    assert.equal(endless.structuredContent.status, 'stopped');
    assert.match(endless.structuredContent.stopped, new RegExp(`${LIMITS.steps} steps`));
    assert.ok(Date.now() - started < LIMITS.wall_ms, 'the endless loop was stopped by the step limit');

    // A loop that also splits in parallel doubles its tokens at every turn
    const c = id();
    const fork = { ...loop, activities: [...loop.activities, { id: c, name: 'C', role_id: role.id, actor_type: 'application' }], edges: [...loop.edges, { id: id(), source_id: a, target_id: c }, { id: id(), source_id: c, target_id: a }] };
    started = Date.now();
    const explosion = await call(client, 'simulate_workflow', { workflow: fork });
    assert.equal(explosion.structuredContent.status, 'stopped');
    assert.ok(Date.now() - started < LIMITS.wall_ms + 2000);

    const timer = id(), end = id();
    const slow = workflow([{ name: 'Before' }], {});
    slow.events = [{ id: timer, name: 'Wait a year', event_type: 'timer', event_definition: { duration: 'P52W' } }];
    slow.activities.push({ id: end, name: 'After', role_id: slow.roles[0].id, actor_type: 'application', retry: { max_attempts: 3, backoff: 'fixed', initial_delay: 'PT6H' } });
    slow.edges = [{ id: id(), source_id: slow.activities[0].id, target_id: timer }, { id: id(), source_id: timer, target_id: end }];
    started = Date.now();
    const waited = await call(client, 'simulate_workflow', { workflow: slow, start_time: '2026-01-01T00:00:00Z', simulated_outputs: { After: { attempts: [{ error: 'not yet', code: 'TIMEOUT' }, { output: { ok: true } }] } } });
    assert.equal(waited.structuredContent.status, 'completed', JSON.stringify(waited.structuredContent.failures));
    assert.ok(Date.now() - started < 3000, 'a year-long timer was waited for in real time');
    const last = waited._meta.awa.journal.at(-1);
    assert.ok(Date.parse(last.time) - Date.parse('2026-01-01T00:00:00Z') >= 52 * 7 * 86400000, 'the simulated clock moved past the timer');
});
