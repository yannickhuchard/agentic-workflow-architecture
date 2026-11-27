/**
 * AWA Guardrails (specification section 31)
 *
 * A guardrail checks what goes into an AI agent or a tool and what comes out,
 * at run time, and takes a declared action when its check finds something:
 * block, redact, retry with feedback, escalate to a person, or warn.
 *
 * Guardrails are declared on the deployment, the workflow, a role, an activity
 * or a tool. This module finds the ones that apply, runs their checks in order
 * (31.6) and records each one that acts as `guardrail.triggered`, with the
 * positions and categories of what it found and never the text (31.7). The
 * engine decides what the action means for the run.
 */

import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { Activity, Guardrail, GuardrailCheck, GuardrailSchema, Role, ToolDefinition, Workflow } from '../types';
import { evaluate_expression, validate_expression } from './expression';
import { JournalEventInput, canonical_json, public_payload } from './journal';
import { ModelRouter, RouteAttempt } from './models';

const ajv = new Ajv2020({ allErrors: true, strict: false });
addFormats(ajv);

export type GuardrailStage = Guardrail['stages'][number];
export type GuardrailAction = Guardrail['action'];
export type GuardrailSource = 'deployment' | 'workflow' | 'role' | 'activity' | 'tool';

export const GUARDRAIL_BLOCKED = 'GUARDRAIL_BLOCKED';
export const GUARDRAIL_ERROR = 'GUARDRAIL_ERROR';

/** What a check found (31.4). Never the text it matched */
export interface GuardrailFinding {
    category: string;
    /** JSON Pointer of what the finding concerns, within the value checked */
    path?: string;
    /** For a match within a string: its first code point, and the one after its last */
    start?: number;
    end?: number;
    limit?: number;
    actual?: number;
    /** For a json_schema finding: the schema keyword that failed */
    keyword?: string;
}

/** A classifier the deployment registers for `classifier` checks (31.8) */
export type GuardrailClassifier = (request: {
    value: unknown; stage: GuardrailStage; guardrail: Guardrail; config?: Record<string, unknown>;
}) => { flagged: boolean; categories?: string[] } | Promise<{ flagged: boolean; categories?: string[] }>;

/** What the engine gives the guardrails for one check */
export interface GuardrailContext {
    /** Records an event, bound to the token, the node and the attempt */
    record: (event: JournalEventInput) => void;
    router?: ModelRouter;
    /** The engine default model reference (12.3) */
    default_model?: string;
    classifiers?: Record<string, GuardrailClassifier>;
    /** At tool_call and tool_result: the call */
    tool?: ToolDefinition;
    call_id?: string;
}

/** A guardrail that stopped evaluation at a stage, and what it asks the engine to do */
export interface GuardrailStop {
    guardrail: Guardrail;
    source: GuardrailSource;
    action: 'block' | 'retry_with_feedback' | 'escalate';
    code: typeof GUARDRAIL_BLOCKED | typeof GUARDRAIL_ERROR;
    message: string;
    categories: string[];
}

export interface GuardrailResult<T> {
    /** The value as the guardrails left it: redacted where one redacted */
    value: T;
    stop?: GuardrailStop;
}

// ---------------------------------------------------------------------------
// Built-in patterns (31.4.1, 31.4.2). ASCII only, so that ECMAScript and Python read them the same way.

interface NamedPattern { category: string; pattern: string; flags?: string; accept?: (text: string) => boolean }

const digits = (text: string) => text.replace(/[^0-9]/g, '');

function luhn(text: string): boolean {
    const d = digits(text);
    let sum = 0;
    for (let i = 0; i < d.length; i++) {
        let n = Number(d[d.length - 1 - i]);
        if (i % 2 === 1) { n *= 2; if (n > 9) n -= 9; }
        sum += n;
    }
    return d.length >= 13 && d.length <= 19 && sum % 10 === 0;
}

function iban_checksum(text: string): boolean {
    const compact = text.replace(/ /g, '');
    if (compact.length < 15 || compact.length > 34) return false;
    const moved = compact.slice(4) + compact.slice(0, 4);
    let remainder = 0;
    for (const ch of moved) {
        const value = ch >= 'A' && ch <= 'Z' ? String(ch.charCodeAt(0) - 55) : ch;
        for (const digit of value) remainder = (remainder * 10 + Number(digit)) % 97;
    }
    return remainder === 1;
}

const after_prefix = (text: string) => digits(text.replace(/^[^0-9+]*(?:\+|00)/, ''));

export const PERSONAL_DATA_PATTERNS: Record<string, NamedPattern[]> = {
    email: [{ category: 'email', pattern: '[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\\.[A-Za-z0-9-]+)*\\.[A-Za-z]{2,}' }],
    iban: [{
        category: 'iban', pattern: '(?<![A-Za-z0-9])[A-Z]{2}[0-9]{2}(?: ?[A-Z0-9]{4}){2,7}(?: ?[A-Z0-9]{1,4})?(?![A-Za-z0-9])',
        accept: iban_checksum,
    }],
    credit_card: [{ category: 'credit_card', pattern: '(?<![0-9])[0-9](?:[ -]?[0-9]){12,18}(?![0-9])', accept: luhn }],
    phone: [
        {
            category: 'phone', pattern: '(?<![A-Za-z0-9+])(?:\\+|00)[1-9][0-9]{0,3}(?:[ .-]?\\(?[0-9]{1,4}\\)?){2,6}(?![A-Za-z0-9])',
            accept: text => { const n = after_prefix(text).length; return n >= 8 && n <= 15; },
        },
        { category: 'phone', pattern: '(?<![A-Za-z0-9])\\(?[2-9][0-9]{2}\\)?[ .-][0-9]{3}[ .-][0-9]{4}(?![A-Za-z0-9])' },
        {
            category: 'phone', pattern: '(?<![A-Za-z0-9])\\(?0[1-9][0-9]{0,3}\\)?(?:[ .-]?[0-9]{2,4}){2,4}(?![A-Za-z0-9])',
            accept: text => { const n = digits(text).length; return n >= 9 && n <= 11; },
        },
    ],
};

/** The order in which personal data categories are looked for (31.4) */
export const PERSONAL_DATA_CATEGORIES = ['email', 'iban', 'credit_card', 'phone'] as const;

const S = '[ \\t\\r\\n]';
/** Prompt injection markers (31.4.2), compared without regard to case. A floor, not a defence. */
export const INJECTION_MARKERS: Record<string, string> = {
    ignore_instructions: `(?<![A-Za-z])(?:ignore|disregard|forget|override)${S}+(?:all${S}+|any${S}+)?(?:(?:the|your|my|these)${S}+)?(?:previous|prior|above|earlier|preceding|original)${S}+(?:instructions|directions|prompts?|rules|guidelines)`,
    new_instructions: `(?<![A-Za-z])(?:new|updated|revised|real|actual)${S}+(?:system${S}+)?instructions${S}*:`,
    reveal_instructions: `(?<![A-Za-z])(?:reveal|print|show|repeat|output|leak)${S}+(?:me${S}+)?(?:the|your)${S}+(?:system${S}+prompt|hidden${S}+instructions|initial${S}+instructions)`,
    jailbreak_mode: `(?<![A-Za-z])(?:(?:developer|god|jailbreak|unrestricted)${S}+mode|do${S}+anything${S}+now)`,
    chat_template_token: '<\\|(?:im_start|im_end|system|user|assistant|endoftext)\\|>|\\[/?INST\\]|<</?SYS>>',
    role_header: '(?:^|[\\r\\n])[ \\t]*(?:#{1,6}[ \\t]*)?(?:system|assistant)[ \\t]*:',
};

const escape_regex = (text: string) => text.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');

/** The patterns a pattern check looks for, in the order of 31.4 */
function patterns_of(check: GuardrailCheck): NamedPattern[] {
    const custom = (check as { patterns?: { name: string; pattern: string }[] }).patterns || [];
    const customs = custom.map(p => ({ category: p.name, pattern: p.pattern }));
    switch (check.kind) {
        case 'personal_data': {
            const wanted = check.categories || [...PERSONAL_DATA_CATEGORIES];
            return [...PERSONAL_DATA_CATEGORIES.filter(c => wanted.includes(c)).flatMap(c => PERSONAL_DATA_PATTERNS[c]), ...customs];
        }
        case 'deny_list': {
            const whole = check.whole_words !== false;
            const terms = (check.terms || []).filter(t => t.length > 0).map(term => ({
                category: 'term', flags: 'i',
                pattern: whole ? `(?<![A-Za-z0-9_])${escape_regex(term)}(?![A-Za-z0-9_])` : escape_regex(term),
            }));
            return [...terms, ...customs];
        }
        case 'prompt_injection': {
            const ids = check.markers || Object.keys(INJECTION_MARKERS);
            return [...Object.keys(INJECTION_MARKERS).filter(id => ids.includes(id)).map(id => ({ category: id, pattern: INJECTION_MARKERS[id], flags: 'i' })), ...customs];
        }
        default: return [];
    }
}

const compiled = new Map<string, RegExp>();
function regex(pattern: string, flags = ''): RegExp {
    const key = `${flags}/${pattern}`;
    if (!compiled.has(key)) compiled.set(key, new RegExp(pattern, `g${flags}u`));
    const re = compiled.get(key)!;
    re.lastIndex = 0;
    return re;
}

/** Code point offset of a UTF-16 index */
const code_points = (text: string, index: number) => Array.from(text.slice(0, index)).length;

/** The value at a path (6.2) of object properties, or undefined when the path leads nowhere. Arrays are not entered */
function lookup(value: unknown, path: string): unknown {
    let current = value;
    for (const key of path.split('.')) {
        if (current === null || typeof current !== 'object' || Array.isArray(current) || !Object.prototype.hasOwnProperty.call(current, key)) return undefined;
        current = (current as Record<string, unknown>)[key];
    }
    return current;
}

/** JSON Pointer segment (RFC 6901) */
const segment = (key: string | number) => String(key).replace(/~/g, '~0').replace(/\//g, '~1');

/** Every string in a value, with its JSON Pointer, in document order */
function strings_of(value: unknown, base: string, out: { path: string; text: string }[] = []): { path: string; text: string }[] {
    if (typeof value === 'string') out.push({ path: base, text: value });
    else if (Array.isArray(value)) value.forEach((item, i) => strings_of(item, `${base}/${i}`, out));
    else if (value && typeof value === 'object') for (const [key, item] of Object.entries(value)) strings_of(item, `${base}/${segment(key)}`, out);
    return out;
}

/** A path (6.2) as a JSON Pointer */
const pointer = (path: string) => path.split('.').map(segment).map(s => `/${s}`).join('');

/** What the paths of `fields` start from (31.2): at stage output the outcome (11.1), with its pointer within the whole value; otherwise the value */
function fields_root(value: unknown, stage: GuardrailStage): { root: unknown; base: string } {
    if (stage !== 'output') return { root: value, base: '' };
    const inner = value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>).output : undefined;
    if (inner && typeof inner === 'object' && !Array.isArray(inner)) return { root: inner, base: '/output' };
    return { root: outcome_part(value), base: '' };
}

/** The strings a pattern or size check looks at: those under `fields`, or all of them. Paths stay within the whole value */
function scanned(value: unknown, stage: GuardrailStage, fields?: string[]): { path: string; text: string }[] {
    if (!fields || fields.length === 0) return strings_of(value, '');
    const { root, base } = fields_root(value, stage);
    const out: { path: string; text: string }[] = [];
    for (const field of fields) {
        const found = lookup(root, field);
        if (found !== undefined) strings_of(found, base + pointer(field), out);
    }
    return out;
}

/** The matches of patterns in a string, the overlapping ones dropped, in order of start */
export function find_matches(text: string, patterns: NamedPattern[]): { category: string; start: number; end: number }[] {
    const kept: { category: string; start: number; end: number }[] = [];
    for (const p of patterns) {
        const re = regex(p.pattern, p.flags);
        for (let m = re.exec(text); m; m = re.exec(text)) {
            if (m[0].length === 0) { re.lastIndex++; continue; }
            if (p.accept && !p.accept(m[0])) continue;
            const start = code_points(text, m.index);
            const end = start + Array.from(m[0]).length;
            if (kept.some(k => start < k.end && k.start < end)) continue;
            kept.push({ category: p.category, start, end });
        }
    }
    return kept.sort((a, b) => a.start - b.start);
}

// ---------------------------------------------------------------------------
// Checks

/** The part of a value the contract would judge (11.1), for checks that apply to the outcome at stage output */
function outcome_part(value: unknown): unknown {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
        const inner = (value as Record<string, unknown>).output;
        if (inner && typeof inner === 'object' && !Array.isArray(inner)) return inner;
        return Object.fromEntries(Object.entries(value).filter(([key]) => key !== '_context_writes'));
    }
    return value;
}

class CheckError extends Error { }

/** Run one check. Deterministic except for `model` and `classifier`. Throws CheckError when the check cannot be carried out */
export async function run_check(guardrail: Guardrail, stage: GuardrailStage, value: unknown, context: Pick<GuardrailContext, 'router' | 'default_model' | 'classifiers' | 'record'>): Promise<GuardrailFinding[]> {
    const check = guardrail.check;
    const judged = stage === 'output' ? outcome_part(value) : value;
    switch (check.kind) {
        case 'personal_data':
        case 'deny_list':
        case 'prompt_injection': {
            const patterns = patterns_of(check);
            return scanned(value, stage, guardrail.fields).flatMap(({ path, text }) =>
                find_matches(text, patterns).map(m => ({ category: m.category, path, start: m.start, end: m.end })));
        }
        case 'size': {
            const characters = scanned(value, stage, guardrail.fields).reduce((n, s) => n + Array.from(s.text).length, 0);
            const findings: GuardrailFinding[] = [];
            if (check.max_characters !== undefined && characters > check.max_characters) findings.push({ category: 'max_characters', limit: check.max_characters, actual: characters });
            const tokens = Math.ceil(characters / 4);
            if (check.max_tokens !== undefined && tokens > check.max_tokens) findings.push({ category: 'max_tokens', limit: check.max_tokens, actual: tokens });
            return findings;
        }
        case 'json_schema': {
            const validate = ajv.compile(check.schema);
            if (validate(judged)) return [];
            return (validate.errors || []).map(e => ({ category: 'schema', path: e.instancePath, keyword: e.keyword }));
        }
        case 'allowed_values': {
            const found = lookup(judged, check.path);
            const allowed = found !== undefined && check.values.some(v => canonical_json(v) === canonical_json(found));
            return allowed ? [] : [{ category: 'allowed_values', path: pointer(check.path) }];
        }
        case 'topic': {
            const data = judged && typeof judged === 'object' && !Array.isArray(judged) ? judged as Record<string, unknown> : undefined;
            const on_topic = !!data && check.allow.some(expression => evaluate_expression(expression, data));
            return on_topic ? [] : [{ category: 'off_topic' }];
        }
        case 'classifier': {
            const classifier = context.classifiers?.[check.name];
            if (!classifier) throw new CheckError(`No guardrail classifier "${check.name}" is registered`);
            let verdict: { flagged: boolean; categories?: string[] };
            try {
                verdict = await classifier({ value, stage, guardrail, config: check.config });
            } catch (error) {
                throw new CheckError(`Guardrail classifier "${check.name}" failed: ${error instanceof Error ? error.message : String(error)}`);
            }
            if (!verdict || typeof verdict.flagged !== 'boolean') throw new CheckError(`Guardrail classifier "${check.name}" gave no verdict`);
            return verdict.flagged ? categories_found(verdict.categories) : [];
        }
        case 'model':
            return model_check(guardrail, check, value, context);
    }
}

function categories_found(categories: unknown, declared?: string[]): GuardrailFinding[] {
    const named = Array.isArray(categories) ? categories.filter((c): c is string => typeof c === 'string' && c.length > 0) : [];
    const kept = named.map(c => (declared && !declared.includes(c) ? 'flagged' : c));
    return [...new Set(kept.length ? kept : ['flagged'])].map(category => ({ category }));
}

async function model_check(guardrail: Guardrail, check: Extract<GuardrailCheck, { kind: 'model' }>, value: unknown,
    context: Pick<GuardrailContext, 'router' | 'default_model' | 'record'>): Promise<GuardrailFinding[]> {
    const requested = check.model || context.default_model;
    if (!context.router || !requested) throw new CheckError('No model is available for the guard model check');
    const system = 'You are a guardrail. You are given a JSON value and a description of what to flag. '
        + 'Answer with a JSON object only: {"flagged": true or false, "categories": [the categories that apply]}. '
        + `What to flag: ${check.instructions}`
        + (check.categories?.length ? ` Categories: ${check.categories.join(', ')}.` : '');
    let routed;
    try {
        routed = await context.router.generate(requested, { system, prompt: canonical_json(value), json: true, temperature: 0, max_output_tokens: 200 });
    } catch (error) {
        record_route(context, (error as { route?: RouteAttempt[] })?.route);
        throw new CheckError(`The guard model could not be reached: ${error instanceof Error ? error.message : String(error)}`);
    }
    context.record({
        type: 'meta.recorded', level: 'meta',
        data: {
            subject: 'model_selection',
            decision: `Use model ${routed.model.provider.id}:${routed.model.model}`,
            rationale: (check.model ? `Guardrail "${guardrail.name || guardrail.id}" names this model.` : `Guardrail "${guardrail.name || guardrail.id}" names no model, so the engine default applies.`)
                + (routed.model.tier ? ` The reference is the capability tier "${routed.model.tier}", which this deployment maps to that model.` : ''),
            model: { provider: routed.model.provider.id, id: routed.model.model, requested, ...(routed.model.tier ? { tier: routed.model.tier } : {}), source: 'guardrail' },
        },
    });
    record_route(context, routed.route);
    let reply: { flagged?: unknown; categories?: unknown };
    try {
        const text = routed.response.text.trim().replace(/^```(?:json)?\s*|\s*```$/g, '');
        reply = JSON.parse(text);
    } catch {
        throw new CheckError('The guard model did not answer with a JSON object');
    }
    if (!reply || typeof reply !== 'object' || typeof reply.flagged !== 'boolean') throw new CheckError('The guard model did not say whether the value is flagged');
    return reply.flagged ? categories_found(reply.categories, check.categories) : [];
}

function record_route(context: Pick<GuardrailContext, 'record'>, route: RouteAttempt[] | undefined): void {
    if (!route || !route.some(r => r.outcome !== 'used')) return;
    const used = route.find(r => r.outcome === 'used');
    context.record({
        type: 'meta.recorded', level: 'meta',
        data: {
            subject: 'model_route',
            decision: used ? `Route to ${used.ref}` : 'No model could serve the request',
            rationale: route.filter(r => r.outcome !== 'used').map(r => `${r.ref} was ${r.outcome === 'skipped' ? 'skipped' : 'tried and failed'}${r.reason ? `: ${r.reason}` : ''}`).join('. ') + '.',
            route,
        },
    });
}

// ---------------------------------------------------------------------------
// Redaction

function pointer_parts(pointer: string): string[] {
    return pointer === '' ? [] : pointer.slice(1).split('/').map(s => s.replace(/~1/g, '/').replace(/~0/g, '~'));
}

/** The value with every match replaced by the guardrail's replacement (31.5). The original is not changed */
export function redact(value: unknown, findings: GuardrailFinding[], replacement = '[REDACTED:{category}]'): unknown {
    const copy = JSON.parse(JSON.stringify(value ?? null));
    const by_path = new Map<string, GuardrailFinding[]>();
    for (const f of findings) if (f.path !== undefined && f.start !== undefined && f.end !== undefined) by_path.set(f.path, [...(by_path.get(f.path) || []), f]);
    const swap = (text: string, matches: GuardrailFinding[]) => {
        const chars = Array.from(text);
        for (const m of [...matches].sort((a, b) => b.start! - a.start!)) chars.splice(m.start!, m.end! - m.start!, replacement.split('{category}').join(m.category));
        return chars.join('');
    };
    let root = copy;
    for (const [path, matches] of by_path) {
        const parts = pointer_parts(path);
        if (parts.length === 0) { if (typeof root === 'string') root = swap(root, matches); continue; }
        let parent = root as Record<string, unknown>;
        for (const part of parts.slice(0, -1)) parent = parent?.[part] as Record<string, unknown>;
        const last = parts[parts.length - 1];
        if (parent && typeof parent[last] === 'string') parent[last] = swap(parent[last] as string, matches);
    }
    return root;
}

// ---------------------------------------------------------------------------
// Which guardrails apply, and in which order (31.1, 31.6)

export interface AppliedGuardrail { guardrail: Guardrail; source: GuardrailSource }

/** The checks that can say where they found something, and so can redact */
const REDACTABLE = new Set(['personal_data', 'deny_list', 'prompt_injection']);
const ACTIONS_AT: Record<GuardrailStage, Set<GuardrailAction>> = {
    input: new Set(['block', 'redact', 'escalate', 'warn']),
    output: new Set(['block', 'redact', 'retry_with_feedback', 'escalate', 'warn']),
    tool_call: new Set(['block', 'redact', 'warn']),
    tool_result: new Set(['block', 'redact', 'warn']),
};

export class GuardrailSet {
    private deployment: Guardrail[];

    /** A deployment's guardrails are held to the rules of a document's (31.11): an inconsistent one is refused here */
    constructor(
        private workflow: Workflow,
        deployment: unknown[] = [],
        private role_of: (activity: Activity) => Role | undefined = a => (workflow.roles || []).find(r => r.id === a.role_id),
    ) {
        this.deployment = deployment.map(g => GuardrailSchema.parse(g));
        const seen = new Set<string>();
        const issues = this.deployment.flatMap(g => check_guardrail(g, `deployment.guardrails[${g.id}]`, false, seen));
        if (issues.length > 0) throw new Error(`Invalid deployment guardrails: ${issues.map(i => i.message).join('; ')}`);
    }

    /** Whether any guardrail is declared at all. A run without one behaves exactly as before */
    get empty(): boolean {
        return this.deployment.length === 0 && !this.workflow.guardrails?.length && !(this.workflow.roles || []).some(r => r.guardrails?.length)
            && !this.workflow.activities.some(a => a.guardrails?.length || (a.tools || []).some(t => t.guardrails?.length));
    }

    /** The guardrails that apply at a stage, in the order of 31.6 */
    applicable(stage: GuardrailStage, activity: Activity, tool?: ToolDefinition): AppliedGuardrail[] {
        const scoped = (list: Guardrail[] | undefined, source: GuardrailSource) => (list || [])
            .filter(g => g.stages.includes(stage))
            .filter(g => (g.actor_types || ['ai_agent']).includes(activity.actor_type))
            .filter(g => !tool || !g.tools || g.tools.includes(tool.name))
            .map(guardrail => ({ guardrail, source }));
        const own = tool && (stage === 'tool_call' || stage === 'tool_result')
            ? (tool.guardrails || []).filter(g => g.stages.includes(stage)).map(guardrail => ({ guardrail, source: 'tool' as const }))
            : [];
        return [
            ...scoped(this.deployment, 'deployment'),
            ...scoped(this.workflow.guardrails, 'workflow'),
            ...scoped(this.role_of(activity)?.guardrails, 'role'),
            ...scoped(activity.guardrails, 'activity'),
            ...own,
        ];
    }

    /**
     * Apply the guardrails of a stage to a value, one at a time (31.6). Each sees the value as the ones before
     * left it; warn and redact go on, block, retry_with_feedback and escalate stop. Each that finds something is recorded.
     */
    async apply<T>(stage: GuardrailStage, activity: Activity, value: T, context: GuardrailContext): Promise<GuardrailResult<T>> {
        let current: unknown = value;
        for (const { guardrail, source } of this.applicable(stage, activity, context.tool)) {
            const base = {
                guardrail_id: guardrail.id, ...(guardrail.name ? { name: guardrail.name } : {}), source, stage, check: guardrail.check.kind,
                ...(context.tool ? { tool: context.tool.name, ...(context.call_id ? { call_id: context.call_id } : {}) } : {}),
            };
            let findings: GuardrailFinding[];
            try {
                findings = await run_check(guardrail, stage, current, context);
            } catch (error) {
                const message = error instanceof Error ? error.message : String(error);
                context.record({ type: 'guardrail.triggered', data: { ...base, action: 'block', categories: [], findings: [], error: message } });
                return {
                    value: current as T,
                    stop: { guardrail, source, action: 'block', code: GUARDRAIL_ERROR, message: `Guardrail "${guardrail.name || guardrail.id}" could not be checked: ${message}`, categories: [] },
                };
            }
            if (findings.length === 0) continue;
            const categories = [...new Set(findings.map(f => f.category))].sort();
            // An action a stage does not allow cannot pass validation; an engine given one anyway blocks
            const action: GuardrailAction = ACTIONS_AT[stage].has(guardrail.action) ? guardrail.action : 'block';
            const escalate_as_block = action === 'escalate' && activity.actor_type === 'human';
            const taken = escalate_as_block ? 'block' : action;
            context.record({ type: 'guardrail.triggered', data: { ...base, action: taken, categories, findings } });
            if (taken === 'warn') continue;
            if (taken === 'redact') {
                current = redact(current, findings, guardrail.replacement);
                continue;
            }
            return {
                value: current as T,
                stop: {
                    guardrail, source, action: taken, code: GUARDRAIL_BLOCKED, categories,
                    message: `Guardrail "${guardrail.name || guardrail.id}" (${guardrail.check.kind}) found ${categories.join(', ')} at stage ${stage}`,
                },
            };
        }
        return { value: current as T };
    }
}

/** The value an input guardrail checks: the actor's input without what is reserved to the engine, with the contexts it is given (31.3) */
export function input_value(inputs: Record<string, unknown>): Record<string, unknown> {
    return { ...public_payload(inputs), ...(inputs._contexts !== undefined ? { _contexts: inputs._contexts } : {}) };
}

/** The value an output guardrail checks: the result without what is reserved to the engine, with what it writes to contexts (31.3) */
export function output_value(output: Record<string, unknown>): Record<string, unknown> {
    return { ...public_payload(output), ...(output._context_writes !== undefined ? { _context_writes: output._context_writes } : {}) };
}

/** A value as the guardrails left it, put back in place of the original, keeping what is reserved to the engine */
export function merge_guarded(original: Record<string, unknown>, guarded: Record<string, unknown>): Record<string, unknown> {
    const kept = Object.fromEntries(Object.entries(original).filter(([key]) => !(key in guarded) && (key.startsWith('_') || key === 'activities')));
    return { ...kept, ...guarded };
}

/** The feedback given to an agent whose output a guardrail rejected: the guardrail and the categories, never the text (31.5) */
export function guardrail_feedback(stop: GuardrailStop): string {
    return `Your output was rejected by the guardrail "${stop.guardrail.name || stop.guardrail.id}" (${stop.guardrail.check.kind}), `
        + `which found: ${stop.categories.join(', ') || 'a problem'}. Produce the output again without it.`;
}

// ---------------------------------------------------------------------------
// Validation (31.11)

export interface GuardrailIssue { path: string; message: string; code: 'invalid_guardrail' | 'invalid_expression' }

function compiles(pattern: string): boolean {
    try { new RegExp(pattern, 'u'); return true; } catch { return false; }
}

/** Integrity errors of the guardrails of a document */
export function guardrail_integrity_errors(workflow: Workflow): GuardrailIssue[] {
    const issues: GuardrailIssue[] = [];
    const seen = new Set<string>();
    const lists: { where: string; list: Guardrail[] | undefined; on_tool: boolean }[] = [
        { where: 'guardrails', list: workflow.guardrails, on_tool: false },
        ...(workflow.roles || []).map(r => ({ where: `roles[${r.id}].guardrails`, list: r.guardrails, on_tool: false })),
        ...workflow.activities.flatMap(a => [
            { where: `activities[${a.id}].guardrails`, list: a.guardrails, on_tool: false },
            ...(a.tools || []).map(t => ({ where: `activities[${a.id}].tools[${t.name}].guardrails`, list: t.guardrails, on_tool: true })),
        ]),
    ];
    for (const { where, list, on_tool } of lists) {
        for (const g of list || []) issues.push(...check_guardrail(g, `${where}[${g.id}]`, on_tool, seen));
    }
    return issues;
}

/** The problems of one guardrail; also used for a deployment's guardrails */
export function check_guardrail(g: Guardrail, where: string, on_tool = false, seen = new Set<string>()): GuardrailIssue[] {
    const issues: GuardrailIssue[] = [];
    const bad = (message: string) => issues.push({ path: where, message, code: 'invalid_guardrail' });
    if (seen.has(g.id)) bad(`Duplicate guardrail id '${g.id}'`);
    seen.add(g.id);
    for (const stage of g.stages) {
        if (!ACTIONS_AT[stage].has(g.action)) bad(`Action '${g.action}' is not allowed at stage '${stage}'`);
        if (on_tool && stage !== 'tool_call' && stage !== 'tool_result') bad(`A guardrail on a tool applies at stages tool_call and tool_result, not '${stage}'`);
    }
    if (g.action === 'redact' && !REDACTABLE.has(g.check.kind)) bad(`A '${g.check.kind}' check cannot redact`);
    const check = g.check;
    for (const p of (check as { patterns?: { name: string; pattern: string }[] }).patterns || []) {
        if (!compiles(p.pattern)) bad(`Pattern '${p.name}' does not compile`);
    }
    if (check.kind === 'prompt_injection') {
        for (const id of check.markers || []) if (!(id in INJECTION_MARKERS)) bad(`Unknown prompt injection marker '${id}'`);
    }
    if (check.kind === 'size' && check.max_characters === undefined && check.max_tokens === undefined) bad('A size check needs max_characters or max_tokens');
    if (check.kind === 'json_schema') {
        try { ajv.compile(check.schema); } catch (error) { bad(`Invalid JSON Schema: ${error instanceof Error ? error.message : String(error)}`); }
    }
    if (check.kind === 'topic') {
        for (const expression of check.allow) {
            const result = validate_expression(expression);
            if (!result.valid) issues.push({ path: `${where}.check.allow`, message: result.error || 'Invalid condition', code: 'invalid_expression' });
        }
    }
    return issues;
}
