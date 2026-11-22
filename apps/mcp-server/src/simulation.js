// The simulation boundary.
//
// Documents come from a chat and are untrusted. This module is the only place
// that creates a WorkflowEngine or an AwaRuntime, and it creates them so that
// nothing a document names is ever executed:
//
//   - every actor type is replaced by the simulated actor below, so the SDK's
//     own actors (which call models, robots or wait on people) are never built;
//   - the engine runs with simulate: true, so its ToolRunner records tool calls
//     as simulated and never executes an http, jsonrpc, mcp, grpc, function or
//     command binding; commands are also refused by policy (allow_commands: false)
//     and are not even attempted;
//   - no model provider, API key, knowledge base, journal file, checkpoint
//     directory, runtime store, decision engine or event sink is supplied, so
//     the engine has nothing to call and nowhere to write;
//   - the clock is virtual: timers and retry delays advance it instead of waiting.
//
// tests/simulation-safety.test.js checks these properties.
import { LIMITS } from './limits.js';
import { load_sdk } from './sdk.js';

const ACTOR_TYPES = ['application', 'ai_agent', 'human', 'robot'];
const SILENT_LOGGER = { log_execution: async () => { } };

export class SimulationLimitError extends Error {
    constructor(message) { super(message); this.name = 'SimulationLimitError'; this.code = 'SIMULATION_LIMIT'; }
}

/** The SDK prints progress with console.log. Keep it out of standard output, which stdio transports own. */
let muted = 0;
const original_log = console.log;
async function quietly(work) {
    if (muted++ === 0 && !process.env.AWA_MCP_DEBUG) console.log = () => { };
    try { return await work(); } finally { if (--muted === 0) console.log = original_log; }
}

/** A virtual clock, in milliseconds */
export function virtual_clock(start) {
    let now = Number.isFinite(start) ? start : Date.now();
    return { now: () => now, advance: ms => { if (ms > 0) now += ms; return now; }, set: t => { if (t > now) now = t; return now; } };
}

/** Arguments that satisfy the required part of a tool's parameter schema, so that a simulated call can be recorded */
export function sample_arguments(schema, depth = 0) {
    if (!schema || typeof schema !== 'object' || depth > 4) return {};
    const value = (s, d) => {
        if (!s || typeof s !== 'object') return 'simulated';
        if (s.default !== undefined) return s.default;
        if (Array.isArray(s.enum) && s.enum.length) return s.enum[0];
        if (s.const !== undefined) return s.const;
        const type = Array.isArray(s.type) ? s.type[0] : s.type;
        if (type === 'number' || type === 'integer') return typeof s.minimum === 'number' ? s.minimum : 0;
        if (type === 'boolean') return false;
        if (type === 'array') return [];
        if (type === 'object') return sample_arguments(s, d + 1);
        if (type === 'null') return null;
        return 'simulated';
    };
    const properties = schema.properties && typeof schema.properties === 'object' ? schema.properties : {};
    const out = {};
    for (const name of Array.isArray(schema.required) ? schema.required : []) out[String(name)] = value(properties[name], depth);
    return out;
}

/**
 * The actor every activity gets. It returns what the caller scripted for the
 * activity (by name), or nothing. Tools the activity declares are called through
 * the engine's runner, which in simulation records the call and executes nothing.
 */
export function simulated_actor(outputs, clock, notes) {
    return {
        async execute(activity, inputs, context) {
            const scripted = outputs?.[activity.name];
            const attempt = Number(inputs._attempt) || 1;
            const step = scripted?.attempts?.length ? scripted.attempts[Math.min(attempt, scripted.attempts.length) - 1] : scripted;
            if (step?.duration_ms) clock.advance(step.duration_ms);
            if (step?.error) throw Object.assign(new Error(String(step.error)), step.code ? { code: String(step.code) } : {});
            for (const tool of activity.tools || []) {
                if (tool.binding?.kind === 'command') { notes.commands_not_called.add(tool.name); continue; }
                if (context?.tools) await context.tools.call(tool.name, sample_arguments(tool.parameters));
            }
            // The same shapes "awa run --simulate --outputs" produces: the fields themselves, or { output, usage } when usage is scripted
            const output = { ...(step?.output || {}), _simulated: true };
            return step?.usage ? { output, usage: { input_tokens: step.usage.input_tokens || 0, output_tokens: step.usage.output_tokens || 0 } } : output;
        },
    };
}

/** The options every simulated engine is created with. Nothing here can reach outside the process. */
export function engine_options({ outputs = {}, tool_results = {}, pricing, clock, notes }) {
    const actor = simulated_actor(outputs, clock, notes);
    return {
        simulate: true,
        // Read by the engine for decision nodes decided by a model: { "<decision name>": { output: { option } } }
        simulated_outputs: outputs,
        actors: Object.fromEntries(ACTOR_TYPES.map(type => [type, actor])),
        tools: { allow_commands: false, simulated_results: tool_results },
        execution_logger: SILENT_LOGGER,
        verification_enabled: false,
        learn: false,
        verbose: false,
        now: clock.now,
        sleep: async ms => { clock.advance(ms); },
        ...(pricing ? { pricing_config: pricing } : {}),
    };
}

function check_run(engine, started) {
    if (Date.now() - started > LIMITS.wall_ms) throw new SimulationLimitError(`The simulation took longer than ${LIMITS.wall_ms / 1000} seconds and was stopped.`);
    if (engine.getTokens().length > LIMITS.tokens) throw new SimulationLimitError(`The run created more than ${LIMITS.tokens} tokens and was stopped. A loop that splits in parallel grows without end.`);
}

/**
 * Run one workflow in simulation.
 * @returns {{ status, events, steps, stopped?, delivered, timed_out, notes }}
 */
export async function simulate_workflow_run(workflow, { input = {}, outputs, tool_results, events = [], let_waits_time_out = false, pricing, start_time } = {}) {
    const { WorkflowEngine, business_event } = await load_sdk();
    const clock = virtual_clock(start_time);
    const notes = { commands_not_called: new Set() };
    return quietly(async () => {
        const engine = new WorkflowEngine(workflow, engine_options({ outputs, tool_results, pricing, clock, notes }));
        const started = Date.now();
        let steps = 0, stopped;
        const queue = [...events];
        const delivered = [], undelivered = [];
        let timed_out = 0;
        try {
            await engine.start(input);
            for (;;) {
                while (engine.getStatus() === 'running') {
                    if (steps >= LIMITS.steps) throw new SimulationLimitError(`The run did not end within ${LIMITS.steps} steps and was stopped. Check the workflow for a loop that never exits.`);
                    await engine.runStep(); steps++;
                    check_run(engine, started);
                }
                if (engine.getStatus() !== 'waiting_event') break;
                if (queue.length) {
                    const next = queue.shift();
                    if (next.after_ms) clock.advance(next.after_ms);
                    await engine.expireEvents(clock.now());
                    const taken = engine.getStatus() === 'waiting_event'
                        ? await engine.deliverEvent(business_event(next.type, next.data || {}, { source: '/awa-mcp/simulation', time: new Date(clock.now()).toISOString() })) : 0;
                    (taken ? delivered : undelivered).push(next.type);
                } else if (let_waits_time_out && engine.nextEventDeadline() !== undefined) {
                    clock.set(engine.nextEventDeadline() + 1);
                    timed_out += await engine.expireEvents(clock.now());
                } else break;
                // A delivered event or an expired wait leaves tokens active while the status still says waiting
                if (engine.getStatus() !== 'running') { await engine.runStep(); steps++; }
            }
        } catch (error) {
            if (!(error instanceof SimulationLimitError)) throw error;
            stopped = error.message;
            await engine.cancel('simulation limit reached').catch(() => { });
        }
        const journal = await engine.getEvents();
        return {
            status: stopped ? 'stopped' : engine.getStatus(), run_id: engine.getRunId(), steps, stopped,
            events: journal.slice(0, LIMITS.journal_events), truncated: journal.length > LIMITS.journal_events,
            delivered, undelivered: [...undelivered, ...queue.map(e => e.type)], timed_out,
            commands_not_called: [...notes.commands_not_called], priced: !!pricing,
        };
    });
}

/**
 * Play business events through an in-memory runtime in simulation.
 * @returns {{ portfolio, played, notes }}
 */
export async function simulate_journeys(workflows, journeys, events, { outputs, tool_results, pricing, start_time, end_after_ms } = {}) {
    const { AwaRuntime, business_event } = await load_sdk();
    const clock = virtual_clock(start_time);
    const notes = { commands_not_called: new Set() };
    return quietly(async () => {
        // No store is given: everything the runtime knows lives in this object and is dropped when the call returns.
        const runtime = new AwaRuntime({ now: clock.now, engine: engine_options({ outputs, tool_results, pricing, clock, notes }) });
        for (const workflow of workflows) runtime.register_workflow(workflow);
        for (const journey of journeys) runtime.register_journey(journey);
        const started = Date.now();
        const played = [];
        let stopped;
        for (const [index, event] of events.entries()) {
            if (Date.now() - started > LIMITS.wall_ms) { stopped = `The simulation took longer than ${LIMITS.wall_ms / 1000} seconds and was stopped after ${index} of ${events.length} events.`; break; }
            if (event.at !== undefined) clock.set(event.at); else if (event.after_ms) clock.advance(event.after_ms);
            const passed = await runtime.tick(clock.now());
            const result = await runtime.publish(business_event(event.type, event.data || {}, {
                source: '/awa-mcp/simulation', time: new Date(clock.now()).toISOString(), ...(event.id ? { id: event.id } : {}),
            }));
            played.push({
                type: event.type, time: new Date(clock.now()).toISOString(), accepted: result.accepted,
                resumed_runs: result.resumed_runs.length, started_runs: result.started_runs.length, journeys: result.journeys.length,
                waits_timed_out_before: passed.timed_out_runs.length,
            });
        }
        if (end_after_ms && !stopped) { clock.advance(end_after_ms); await runtime.tick(clock.now()); }
        const portfolio = await runtime.export_portfolio();
        return { portfolio: JSON.parse(JSON.stringify(portfolio)), played, stopped, commands_not_called: [...notes.commands_not_called] };
    });
}
