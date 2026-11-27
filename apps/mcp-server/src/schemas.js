// Input schemas of the tools. Every object is strict (unknown properties are
// refused) and every free-form JSON value is bounded in size and depth.
import { z } from 'zod';
import { LIMITS } from './limits.js';

const FORBIDDEN_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

/** Why a JSON value is refused, or undefined. Walks the value once without recursion. */
export function json_problem(value, max_bytes) {
    const stack = [[value, 1]];
    let nodes = 0;
    while (stack.length) {
        const [item, depth] = stack.pop();
        if (depth > LIMITS.json_depth) return `it is nested more than ${LIMITS.json_depth} levels deep`;
        if (++nodes > 400_000) return 'it has too many values';
        if (item === null || typeof item !== 'object') continue;
        if (Array.isArray(item)) { for (const child of item) stack.push([child, depth + 1]); continue; }
        for (const key of Object.keys(item)) {
            if (FORBIDDEN_KEYS.has(key)) return `it has a property named "${key}", which is not accepted`;
            stack.push([item[key], depth + 1]);
        }
    }
    let size;
    try { size = Buffer.byteLength(JSON.stringify(value) ?? '', 'utf8'); } catch { return 'it is not plain JSON'; }
    if (size > max_bytes) return `it is ${Math.ceil(size / 1000)} kB as JSON; the limit is ${Math.floor(max_bytes / 1000)} kB`;
    return undefined;
}

const bounded = (schema, max_bytes, what) => schema.superRefine((value, context) => {
    const problem = json_problem(value, max_bytes);
    if (problem) context.addIssue({ code: 'custom', message: `${what} is refused: ${problem}.` });
});

/** One AWA document, inline */
export const json_document = (what = 'The document', max_bytes = LIMITS.document_bytes) => bounded(z.record(z.string(), z.unknown()), max_bytes, what);
const small_json = (what, max_bytes = 100_000) => bounded(z.record(z.string(), z.unknown()), max_bytes, what);

const name = z.string().min(1).max(200);
const iso_duration = z.string().max(40).regex(/^P(?=\d|T\d)(?:\d+W)?(?:\d+D)?(?:T(?:\d+H)?(?:\d+M)?(?:\d+(?:\.\d+)?S)?)?$/, 'Use an ISO 8601 duration of weeks, days, hours, minutes or seconds, such as "PT2H" or "P3D".');
const iso_time = z.string().max(40).refine(value => /^\d{4}-\d{2}-\d{2}T/.test(value) && Number.isFinite(Date.parse(value)), 'Use an ISO 8601 date and time, such as "2026-03-02T09:00:00Z".');

/** Milliseconds of an ISO 8601 duration made of weeks, days, hours, minutes and seconds */
export function duration_ms(text) {
    if (!text) return 0;
    const m = /^P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+(?:\.\d+)?)S)?)?$/.exec(text);
    if (!m) return 0;
    return ((Number(m[1] || 0) * 7 + Number(m[2] || 0)) * 86400 + Number(m[3] || 0) * 3600 + Number(m[4] || 0) * 60 + Number(m[5] || 0)) * 1000;
}

const simulated_step = z.strictObject({
    output: small_json('A simulated output', 50_000).optional().describe('The fields the activity returns.'),
    error: z.string().max(500).optional().describe('Make the activity fail with this message instead.'),
    code: z.string().max(60).optional().describe('Error code of the failure, such as TIMEOUT.'),
    usage: z.strictObject({ input_tokens: z.number().int().min(0).max(10_000_000).optional(), output_tokens: z.number().int().min(0).max(10_000_000).optional() }).optional().describe('Token usage to count for an AI activity. Only used to compute cost from the pricing you give.'),
    contexts: small_json('Simulated context writes', 50_000).optional().describe('What the activity writes to the workflow\'s contexts, by context name: { "<context name>": <value> }. The activity needs a context binding that allows writing.'),
    duration: iso_duration.optional().describe('How long the activity takes on the simulated clock.'),
});
export const simulated_outputs = z.record(name, simulated_step.extend({
    attempts: z.array(simulated_step).min(1).max(10).optional().describe('One entry per attempt; the last repeats.'),
})).refine(value => Object.keys(value).length <= 200, 'At most 200 simulated outputs.')
    .describe('What each activity returns in the simulation, by activity name: { "<activity name>": { "output": { ... } } }. For a decision node decided by a model, use { "<decision name>": { "output": { "option": "<option id>" } } }. Activities not listed return no business data.');

export const simulated_tool_results = bounded(z.record(z.string().regex(/^[A-Za-z_][A-Za-z0-9_-]{0,63}$/), z.unknown()), 100_000, 'simulated_tool_results')
    .describe('What each declared tool returns in the simulation, by tool name. Tools are never executed.');

export const pricing = z.strictObject({
    currency: z.string().regex(/^[A-Z]{3}$/).describe('ISO 4217 code, such as EUR.'),
    input_token_cost_per_1k: z.number().min(0).max(1000).optional(),
    output_token_cost_per_1k: z.number().min(0).max(1000).optional(),
    human_cost_per_hour: z.number().min(0).max(100_000).optional(),
    robot_cost_per_hour: z.number().min(0).max(100_000).optional(),
    software_cost_per_execution: z.number().min(0).max(100_000).optional(),
}).describe('Rates used to compute a cost. Without rates no cost is computed. The cost is arithmetic on the usage and durations you scripted, not a measurement.');

const event_type = z.string().min(1).max(120).regex(/^[A-Za-z0-9][A-Za-z0-9_.:\/-]*$/, 'An event type is a name such as "claim.submitted".');
const event_data = small_json('The event data', 50_000).optional().describe('The facts the event carries. Include the property that identifies the subject, such as customer_id.');

export const run_event = z.strictObject({
    type: event_type, data: event_data,
    after: iso_duration.optional().describe('Simulated time that passes before the event arrives.'),
});
export const journey_event = z.strictObject({
    type: event_type, data: event_data,
    after: iso_duration.optional().describe('Simulated time that passes before the event, counted from the previous one.'),
    at: iso_time.optional().describe('The simulated time of the event. Use either "at" or "after". Time never goes backwards.'),
    id: z.string().min(1).max(120).optional().describe('Event id. An id played twice has no further effect.'),
});

export const workflows = z.array(json_document('A workflow')).min(1).max(LIMITS.workflows);
export const journeys = z.array(json_document('A journey')).min(1).max(LIMITS.journeys);
export const portfolio = bounded(z.record(z.string(), z.unknown()), LIMITS.portfolio_bytes, 'The portfolio');
/** A company's brand for the view: a DESIGN.md text, or a brand.json object, inline. Logos only as data: URLs */
export const brand = z.union([
    z.string().min(1).max(LIMITS.brand_bytes).describe('The text of a DESIGN.md file: YAML front matter with colors (primary, surface, on-surface and their variants), typography, rounded, and name.'),
    bounded(z.record(z.string(), z.unknown()), LIMITS.brand_bytes, 'The brand').describe('A brand.json: { "name", "logo", "logo_dark", "colors": { "primary", "surface", "on-surface", ... }, "typography": { "heading", "body" }, "rounded": { "md", "lg" }, "mode": "dark" | "light" | "auto" }.'),
]).describe('Optional. A company\'s brand for the view: its colours, fonts, corner radius, name and logo, in the DESIGN.md format or as a brand.json. A logo must be a data: URL (image/png, image/svg+xml, image/jpeg, image/webp), since the view reaches no network. Colours are read as hex, rgb() or hsl(); the colours of states keep their hue and are adjusted for contrast.');
export { iso_duration, iso_time };
