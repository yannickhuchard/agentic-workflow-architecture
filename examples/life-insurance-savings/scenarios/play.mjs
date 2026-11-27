// Plays the scenarios of the workplace pension savings example on an AWA host (AwaRuntime), with scripted
// actors: what each activity does is in actors.json and in the scenario's `actors`; what the employee, the
// people of the insurer and the outside world do is in the scenario's `steps`. Used by make-runs.mjs,
// demo/live.mjs and the SDK's tests, which pass in the SDK they run against. The Python SDK's tests read the
// same files the same way.
//
// Nothing here calls a model: the agents' answers are scripted. Their tool calls are real calls, through the
// engine's tool runner, to whatever executes the bindings: the reference adapters (adapters/), or an insurer's
// own systems.
//
// A scenario covers a year or more. Each step happens at a time: `at` (an instant), or `after` (a duration
// after the step before it); `monthly: n` repeats a step n times, a calendar month apart, with {{period}}
// (YYYY-MM) in its data. The steps are played in the order of their times.

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const here = path.dirname(fileURLToPath(import.meta.url));
export const EXAMPLE_DIR = path.resolve(here, '..');
const read = file => JSON.parse(fs.readFileSync(path.join(EXAMPLE_DIR, file), 'utf-8'));

/** The workflow documents of the example, in the order they are registered: called workflows first */
export const WORKFLOW_FILES = ['identity-aml-and-tax-residence.awa.json', 'plan-invitation-and-advice.awa.json', 'savings-plan-subscription.awa.json',
    'payroll-contributions.awa.json', 'self-service-change.awa.json', 'year-end-tax.awa.json', 'annual-review.awa.json'];

/** The documents, the deployment, the actors' scripts and the scenarios, in the order of their file names */
export function load_example() {
    const scenarios = fs.readdirSync(here).filter(f => /^[a-z]-.*\.json$/.test(f)).sort().map(f => JSON.parse(fs.readFileSync(path.join(here, f), 'utf-8')));
    return {
        workflows: WORKFLOW_FILES.map(read),
        journey: read('workplace-pension-savings.journey.json'),
        deployment: read('deployment.json'),
        scripts: read('scenarios/actors.json'),
        scenarios,
    };
}

// ------------------------------------------------------------------ durations and placeholders

/** An ISO 8601 duration of weeks, days, hours, minutes and seconds, in milliseconds */
export function duration_ms(text) {
    if (!text) return 0;
    const m = /^P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+(?:\.\d+)?)S)?)?$/.exec(text);
    if (!m) throw new Error(`Not a duration: ${text}`);
    const [, w, d, h, min, s] = m.map(x => Number(x || 0));
    return ((((w * 7 + d) * 24 + h) * 60 + min) * 60 + s) * 1000;
}

const MISSING = Symbol('missing');
function resolve(scope, path_text) {
    if (path_text === 'null') return null;
    if (/^-?\d+(\.\d+)?$/.test(path_text)) return Number(path_text);
    let value = scope;
    for (const part of path_text.split('.')) {
        if (value === null || typeof value !== 'object' || !(part in value)) return MISSING;
        value = value[part];
    }
    return value === undefined ? MISSING : value;
}
/** The first of `a|b|null` that resolves */
function evaluate(scope, expression) {
    for (const alternative of expression.split('|').map(s => s.trim())) {
        const value = resolve(scope, alternative);
        if (value !== MISSING) return value;
    }
    return MISSING;
}
/** A value as it is written into text: whole numbers without a decimal point, booleans in lower case */
const as_text = value => (value === MISSING || value === null ? '' : typeof value === 'object' ? JSON.stringify(value) : String(value));

/**
 * Fill the placeholders of a script. "{{path}}" alone is the value at the path, of any type, and a key whose
 * value is missing is left out; "{{a|b|null}}" takes the first that resolves. Within text, each placeholder is
 * replaced by the value as text. {"$map": path, "to": template} maps a list; {"$find": path, "where": {...},
 * "get": path} picks a field of the first item that matches.
 */
export function fill(template, scope) {
    if (typeof template === 'string') {
        const whole = /^\{\{([^{}]+)\}\}$/.exec(template);
        if (whole) return evaluate(scope, whole[1]);
        return template.replace(/\{\{([^{}]+)\}\}/g, (_, expression) => as_text(evaluate(scope, expression)));
    }
    if (Array.isArray(template)) return template.map(t => fill(t, scope)).filter(v => v !== MISSING);
    if (template && typeof template === 'object') {
        if ('$map' in template) {
            const list = evaluate(scope, template.$map);
            return Array.isArray(list) ? list.map(item => fill(template.to, { ...scope, item })) : [];
        }
        if ('$find' in template) {
            const list = evaluate(scope, template.$find);
            const where = fill(template.where || {}, scope);
            const found = Array.isArray(list) ? list.find(item => Object.entries(where).every(([k, v]) => resolve(item, k) === v)) : undefined;
            return found === undefined ? MISSING : resolve(found, template.get);
        }
        const out = {};
        for (const [key, value] of Object.entries(template)) {
            const filled = fill(value, scope);
            if (filled !== MISSING) out[key] = filled;
        }
        return out;
    }
    return template;
}

/** The script of an activity: the shared entry, overridden by the scenario's, then by the attempt's */
export function script_for(scripts, scenario, name, attempt = 1) {
    const base = scripts.activities[name], own = scenario?.actors?.[name];
    if (!base && !own) return undefined;
    const merge = (a = {}, b = {}) => ({ ...a, ...b, ...(a.output || b.output ? { output: { ...(a.output || {}), ...(b.output || {}) } } : {}), ...(a.agent || b.agent ? { agent: { ...(a.agent || {}), ...(b.agent || {}) } } : {}) });
    const entry = merge(base, own);
    const attempts = entry.attempts;
    return attempts?.length ? merge(entry, attempts[Math.min(attempt, attempts.length) - 1]) : entry;
}

// ------------------------------------------------------------------ the timeline of a scenario

/** The calendar month `n` months after an instant, same day and time (the 28th at most) */
function months_after(ms, n) {
    const date = new Date(ms);
    const target = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + n, Math.min(date.getUTCDate(), 28), date.getUTCHours(), date.getUTCMinutes()));
    return target.getTime();
}

/**
 * The steps of a scenario with their times, in the order they happen: the invitation first, at `starts`.
 * Each entry is { time (ms), step, scenario, period (for a monthly step) }.
 */
export function timeline(scenario) {
    const start = Date.parse(scenario.starts);
    const entries = [{ time: start, step: { invite: true, say: `Kestrel HR opens the savings plan to ${scenario.invitation.employee.first_name} ${scenario.invitation.employee.last_name}` }, scenario, order: 0 }];
    let last = start, order = 1;
    for (const step of scenario.steps) {
        const time = step.at ? Date.parse(step.at) : last + duration_ms(step.after);
        if (Number.isNaN(time)) throw new Error(`${scenario.name}: a step has no valid time`);
        for (let i = 0; i < (step.monthly || 1); i++) {
            const at = step.monthly ? months_after(time, i) : time;
            entries.push({ time: at, step, scenario, order: order++, ...(step.monthly ? { period: new Date(at).toISOString().slice(0, 7) } : {}) });
        }
        last = time;
    }
    return entries.sort((a, b) => a.time - b.time || a.order - b.order);
}

// ------------------------------------------------------------------ actors

/**
 * Actors for the engine's `actors` option. `scenario_of(enrolment_id)` names the scenario an activity
 * belongs to; `spend(ms)` moves the business clock by the time the work takes; `wait(ms)` is real time
 * (the live demonstration lets an agent take a second or two; elsewhere it is nothing).
 */
export function scripted_actors({ scripts, scenario_of, spend = () => { }, wait = async () => { }, today = () => '' }) {
    const actor = {
        async execute(activity, inputs, context) {
            const scenario = scenario_of(inputs.enrolment_id);
            const entry = script_for(scripts, scenario, activity.name, inputs._attempt || 1);
            if (!entry) throw Object.assign(new Error(`No script for "${activity.name}"`), { code: 'VALIDATION_ERROR' });
            await wait(entry.delay_ms || 0);
            spend(duration_ms(entry.takes));
            const scope = { ...inputs, scenario, today: today() };
            for (const call of entry.calls || []) {
                const items = call.each ? evaluate(scope, call.each) : undefined;
                if (call.each) {
                    const results = [];
                    for (const item of Array.isArray(items) ? items : []) {
                        const result = await context.tools.call(call.tool, fill(call.arguments, { ...scope, item }));
                        results.push(result.ok ? result.result : { error: result.result });
                    }
                    scope[call.as] = results;
                } else {
                    const result = await context.tools.call(call.tool, fill(call.arguments, scope));
                    scope[call.as] = result.ok ? result.result : { error: result.result };
                }
            }
            if (entry.error) throw Object.assign(new Error(entry.error.message), { code: entry.error.code || 'TOOL_ERROR' });
            const output = fill(entry.output || {}, scope);
            const writes = entry.writes ? { _context_writes: fill(entry.writes, scope) } : {};
            if (activity.actor_type !== 'ai_agent') return { ...output, ...writes };
            const agent = entry.agent || {};
            return {
                output, ...writes,
                usage: { input_tokens: agent.input_tokens || 0, output_tokens: agent.output_tokens || 0 },
                _model: { id: `${agent.tier}-model`, provider: 'scripted', requested: `tier:${agent.tier}`, tier: agent.tier, source: 'role', temperature: 0.2 },
                _reasoning: { plan: agent.plan || [], rationale: agent.rationale || '', confidence: agent.confidence ?? 0.9, ...(agent.alternatives ? { alternatives_considered: agent.alternatives } : {}) },
            };
        },
    };
    // A person's task, and an agent's work handed to a person, waits for the scenario's steps to answer it
    const person = { execute: async (activity, inputs) => ({ _requires_human_action: true, _human_task_id: `${inputs.enrolment_id}:${activity.name}` }) };
    return { application: actor, ai_agent: actor, robot: actor, human: person };
}

// ------------------------------------------------------------------ tools, without a network

/**
 * Tool executors that hand each call to the reference adapters in this process: the call is made, checked
 * and journalled by the engine as any other, but nothing goes over the network. `adapters` is what
 * adapters/mock-server.mjs `create_adapters()` returns.
 */
export function in_process_executors(sdk, adapters) {
    const headers_of = (binding, secrets) => Object.fromEntries(Object.entries(binding.headers || {}).map(([k, v]) =>
        [k.toLowerCase(), v.replace(/\{\{secret:([\w-]+)\}\}/g, (_, key) => secrets[key] ?? '')]));
    const answer = (reply) => {
        if (reply.status >= 400) throw Object.assign(new Error(`HTTP ${reply.status}: ${reply.body.error}`), { code: 'TOOL_ERROR', status: reply.status });
        return reply.body;
    };
    return {
        http: async (binding, args, context) => {
            const request = sdk.http_request(binding, args);
            const reply = answer(adapters(request.method, request.url, headers_of(binding, context.secrets || {}), request.body ? JSON.parse(request.body) : {}));
            return { status: 200, result: reply };
        },
        jsonrpc: async (binding, args, context) => {
            const reply = answer(adapters('POST', binding.endpoint, {}, { jsonrpc: '2.0', id: context.call_id, method: binding.method, params: args }));
            if (reply.error) throw Object.assign(new Error(`RPC error ${reply.error.code}: ${reply.error.message}`), { code: 'TOOL_ERROR', status: reply.error.code });
            return { status: 200, result: reply.result };
        },
    };
}

/** The secrets the tools' headers name. The reference adapters only check that one is sent. */
export const SECRET_NAMES = ['POLICY_ADMIN_TOKEN', 'PORTAL_TOKEN', 'ADVICE_CALENDAR_TOKEN', 'FUND_PLATFORM_KEY', 'DOCUMENTS_API_KEY', 'SCREENING_TOKEN',
    'KYC_TOKEN', 'ESIGN_TOKEN', 'TAX_SERVICE_TOKEN', 'CERTIFICATES_TOKEN'];
export const DEMO_SECRETS = Object.fromEntries(SECRET_NAMES.map(name => [name, `demo-${name.toLowerCase().replace(/_/g, '-')}`]));

// ------------------------------------------------------------------ the people's tasks

/**
 * A journal store that also keeps the list of tasks waiting for a person, in every run and child run, so that
 * a step can name a task by its activity. `listeners` hear every event as it is written.
 */
export function watching_journal(inner) {
    const waiting = new Map(); // token id -> { run_id, token_id, node_name, task }
    const listeners = new Set();
    const store = {
        tasks: waiting,
        listeners,
        async append(event) {
            if (event.type === 'token.waiting' && event.data?.reason === 'human_task') {
                waiting.set(event.token_id, { run_id: event.run_id, token_id: event.token_id, node_name: event.node_name, task: event.data.human_task_id });
            } else if (['token.resumed', 'token.cancelled', 'token.failed'].includes(event.type) || (event.type === 'activity.completed' && waiting.has(event.token_id))) {
                waiting.delete(event.token_id);
            }
            await inner.append(event);
            for (const listener of listeners) listener(event);
        },
        read: (run_id, after) => inner.read(run_id, after),
    };
    return store;
}

// ------------------------------------------------------------------ playing a scenario

/** What a step does to the host. `log` hears it before it is done, so that a viewer reads the action before its effects. */
async function perform(sdk, runtime, journal, example, entry, { log = () => { }, today = () => '' } = {}) {
    const { scenario, step } = entry;
    const enrolment_id = scenario.invitation.enrolment_id;
    const instance = () => runtime.list_journey_instances().find(i => i.subject_key === enrolment_id);
    const publish = (type, data, source) => runtime.publish(sdk.business_event(type, { enrolment_id, ...data }, { source }));
    if (step.invite) {
        log({ kind: 'action', text: step.say, enrolment_id, publish: 'savings.invited' });
        return publish('savings.invited', scenario.invitation, '/hr-portal/plan-opening');
    }
    const task = step.complete ? [...journal.tasks.values()].find(t => t.node_name === step.complete && t.task.startsWith(`${enrolment_id}:`)) : undefined;
    if (step.complete && !task) throw new Error(`${scenario.name}: nobody is waiting at "${step.complete}"`);
    const say = fill(step.say || step.publish || step.complete || 'time passes', { period: entry.period });
    log({ kind: 'action', text: say, enrolment_id, run_id: task?.run_id, instance_id: instance()?.id, ...(step.publish ? { publish: step.publish } : {}), ...(step.complete ? { complete: step.complete, by: step.by } : {}) });
    if (step.publish) {
        await publish(step.publish, fill(step.data || {}, { today: today(), invitation: scenario.invitation, period: entry.period }), step.source || '/hr-portal');
    } else if (step.tick) {
        await runtime.tick();
    } else if (step.complete) {
        const principal = sdk.principal_named(example.deployment.authorization, step.by);
        try {
            await runtime.resume(task.run_id, task.token_id, step.output || {}, principal);
            if (step.refused) throw new Error(`${scenario.name}: ${step.by} was expected to be refused at "${step.complete}"`);
        } catch (error) {
            if (!step.refused || error.code !== 'FORBIDDEN') throw error;
        }
    }
}

/**
 * Play one scenario on a host to its end. `advance(ms)` moves the host's clock by the time between two steps;
 * `pause(step)` is called before each step (the live demonstration waits there); `log(entry)` hears what is
 * about to be done. Returns the journey instance.
 */
export async function play(sdk, runtime, journal, example, scenario, { advance = () => { }, pause = async () => { }, log = () => { }, today = () => '' } = {}) {
    let last;
    for (const entry of timeline(scenario)) {
        await pause(entry.step);
        if (last !== undefined) advance(entry.time - last);
        last = entry.time;
        await perform(sdk, runtime, journal, example, entry, { log, today });
    }
    return runtime.list_journey_instances().find(i => i.subject_key === scenario.invitation.enrolment_id);
}

/**
 * Play several scenarios on one host as one calendar: every step of every scenario in the order of its time.
 * `move_to(ms)` sets the host's clock to a time, never backwards. Returns the journey instances, in the order
 * of the scenarios.
 */
export async function play_together(sdk, runtime, journal, example, scenarios, { move_to = () => { }, log = () => { }, today = () => '' } = {}) {
    const entries = scenarios.flatMap((scenario, s) => timeline(scenario).map(entry => ({ ...entry, s })))
        .sort((a, b) => a.time - b.time || a.s - b.s || a.order - b.order);
    for (const entry of entries) {
        move_to(entry.time);
        await perform(sdk, runtime, journal, example, entry, { log, today });
    }
    return scenarios.map(scenario => runtime.list_journey_instances().find(i => i.subject_key === scenario.invitation.enrolment_id));
}

// ------------------------------------------------------------------ what must have happened

const matches = (actual, wanted) => {
    if (wanted === null || typeof wanted !== 'object') return actual === wanted;
    if (Array.isArray(wanted)) return Array.isArray(actual) && wanted.length === actual.length && wanted.every((w, i) => matches(actual[i], w));
    return actual !== null && typeof actual === 'object' && Object.entries(wanted).every(([k, v]) => matches(actual[k], v));
};

/**
 * Compare what a scenario did with its `expect`: the statuses of its runs by workflow (child runs included, in
 * the order they started), the status and stage of its journey, the goals reached, and records that must, or
 * must not, be in the journals of its runs and in the journey's record. Returns the differences; none when the
 * scenario did what it says.
 */
export function check_expectations(scenario, instance, runs) {
    const expect = scenario.expect || {};
    const problems = [];
    const events = runs.flatMap(r => r.events);
    if (!instance) return [`${scenario.name}: no journey`];
    for (const [workflow, statuses] of Object.entries(expect.runs || {})) {
        const actual = instance.runs.filter(r => r.workflow_name === workflow).map(r => r.status);
        if (!matches(actual, statuses)) problems.push(`runs of ${workflow}: ${JSON.stringify(actual)}, expected ${JSON.stringify(statuses)}`);
    }
    if (expect.journey_status && instance.status !== expect.journey_status) problems.push(`journey status ${instance.status}, expected ${expect.journey_status}`);
    if (expect.journey_stage && instance.stage_id !== expect.journey_stage) problems.push(`journey stage ${instance.stage_id}, expected ${expect.journey_stage}`);
    if (expect.stalled !== undefined && !!instance.stalled !== expect.stalled) problems.push(`journey stalled ${instance.stalled}, expected ${expect.stalled}`);
    if (expect.goals && !matches([...instance.goals_reached].sort(), [...expect.goals].sort())) problems.push(`goals ${JSON.stringify(instance.goals_reached)}, expected ${JSON.stringify(expect.goals)}`);
    for (const [key, value] of Object.entries(expect.data || {})) if (!matches(instance.data[key], value)) problems.push(`journey data ${key} is ${JSON.stringify(instance.data[key])}, expected ${JSON.stringify(value)}`);
    for (const { count: wanted_count, ...wanted } of expect.records || []) {
        const count = events.filter(e => matches(e, wanted)).length;
        if (wanted_count === undefined ? count < 1 : count !== wanted_count) problems.push(`${count} record(s) like ${JSON.stringify(wanted)}${wanted_count === undefined ? '' : `, expected ${wanted_count}`}`);
    }
    for (const unwanted of expect.absent || []) if (events.some(e => matches(e, unwanted))) problems.push(`unexpected record like ${JSON.stringify(unwanted)}`);
    for (const wanted of expect.journey_records || []) if (!instance.events.some(e => matches(e, wanted))) problems.push(`no journey record like ${JSON.stringify(wanted)}`);
    return problems.map(p => `${scenario.name}: ${p}`);
}
