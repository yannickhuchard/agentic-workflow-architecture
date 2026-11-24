/**
 * Translation of conditions and decision table entries between AWA's languages
 * (sections 6 and 5.5.1), FEEL (BPMN conditions, DMN unary tests and literal
 * expressions) and jq (Serverless Workflow runtime expressions). Specification 27.10.
 */
import { InterchangeError } from './common';
import { validate_expression } from '../runtime/expression';
import { parse_unary_tests, validate_unary_tests, type UnaryTest } from '../runtime/unary_test';

// ---------------------------------------------------------------------------
// Conditions
// ---------------------------------------------------------------------------

export type Literal =
    | { t: 'num'; v: number; text: string }
    | { t: 'str'; v: string }
    | { t: 'bool'; v: boolean }
    | { t: 'null' }
    | { t: 'word'; v: string };

export type Condition =
    | { k: 'or'; items: Condition[] }
    | { k: 'and'; items: Condition[] }
    | { k: 'not'; item: Condition }
    | { k: 'cmp'; path: string; op: string; value: Literal }
    | { k: 'exists'; path: string }
    | { k: 'typeof'; path: string; type: string }
    | { k: 'truthy'; path: string };

type Tok = { t: 'op' | 'num' | 'str' | 'word'; v: string };

const AWA_OPERATORS = ['&&', '||', '==', '!=', '>=', '<=', '>', '<', '!', '(', ')'];
const FEEL_OPERATORS = ['===', '!==', '&&', '||', '==', '!=', '<>', '>=', '<=', '>', '<', '=', '!', '(', ')', ','];

function fail(text: string, reason: string): never {
    throw new InterchangeError(`condition "${text}" cannot be read: ${reason}`);
}

/** Read a string literal at `i`; FEEL strings may contain backslash escapes */
function read_string(src: string, i: number, escapes: boolean): { value: string; end: number } {
    const quote = src[i];
    let value = '';
    let j = i + 1;
    while (j < src.length && src[j] !== quote) {
        if (escapes && src[j] === '\\' && j + 1 < src.length) {
            const c = src[j + 1];
            if (c === 'u' && /^[0-9a-fA-F]{4}$/.test(src.slice(j + 2, j + 6))) { value += String.fromCharCode(parseInt(src.slice(j + 2, j + 6), 16)); j += 6; continue; }
            value += c === 'n' ? '\n' : c === 't' ? '\t' : c === 'r' ? '\r' : c;
            j += 2;
            continue;
        }
        value += src[j++];
    }
    if (j >= src.length) throw new InterchangeError('unterminated string');
    return { value, end: j + 1 };
}

function tokenize(src: string, dialect: 'awa' | 'feel'): Tok[] {
    const operators = dialect === 'awa' ? AWA_OPERATORS : FEEL_OPERATORS;
    const out: Tok[] = [];
    let i = 0;
    while (i < src.length) {
        const c = src[i];
        if (/\s/.test(c)) { i++; continue; }
        if (c === '"' || c === "'") {
            try {
                const { value, end } = read_string(src, i, dialect === 'feel');
                out.push({ t: 'str', v: value });
                i = end;
            } catch { fail(src, 'a string is not terminated'); }
            continue;
        }
        const num = (dialect === 'awa' ? /^-?\d+(\.\d+)?/ : /^-?(\d+(\.\d+)?|\.\d+)/).exec(src.slice(i));
        if (num && (c !== '-' || out.length === 0 || out[out.length - 1].t === 'op')) { out.push({ t: 'num', v: num[0] }); i += num[0].length; continue; }
        const op = operators.find(o => src.startsWith(o, i));
        if (op) { out.push({ t: 'op', v: op }); i += op.length; continue; }
        const word = /^[A-Za-z_$][\w$]*(\.[A-Za-z_$][\w$]*)*/.exec(src.slice(i));
        if (word) { out.push({ t: 'word', v: word[0] }); i += word[0].length; continue; }
        fail(src, dialect === 'feel' ? `"${c}" is not part of what AWA conditions can say (comparisons joined by and, or, not)` : `unexpected character "${c}"`);
    }
    return out;
}

class ConditionParser {
    private pos = 0;
    constructor(private toks: Tok[], private src: string, private dialect: 'awa' | 'feel') { }
    private peek(): Tok | undefined { return this.toks[this.pos]; }
    private is(t: Tok['t'], v?: string): boolean { const k = this.peek(); return !!k && k.t === t && (v === undefined || k.v === v); }
    private keyword(v: string): boolean { return this.dialect === 'feel' && this.is('word', v); }

    parse(): Condition {
        if (!this.toks.length) fail(this.src, 'it is empty');
        const c = this.or();
        if (this.pos < this.toks.length) fail(this.src, `"${this.toks[this.pos].v}" is not expected here`);
        return c;
    }
    private or(): Condition {
        const items = [this.and()];
        while (this.is('op', '||') || this.keyword('or')) { this.pos++; items.push(this.and()); }
        return items.length === 1 ? items[0] : { k: 'or', items };
    }
    private and(): Condition {
        const items = [this.unary()];
        while (this.is('op', '&&') || this.keyword('and')) { this.pos++; items.push(this.unary()); }
        return items.length === 1 ? items[0] : { k: 'and', items };
    }
    private unary(): Condition {
        if (this.is('op', '!')) { this.pos++; return { k: 'not', item: this.unary() }; }
        if (this.keyword('not') && this.toks[this.pos + 1]?.t === 'op' && this.toks[this.pos + 1].v === '(') {
            this.pos += 2;
            const item = this.or();
            if (!this.is('op', ')')) fail(this.src, 'a ")" is missing');
            this.pos++;
            return { k: 'not', item };
        }
        if (this.is('op', '(')) {
            this.pos++;
            const inner = this.or();
            if (!this.is('op', ')')) fail(this.src, 'a ")" is missing');
            this.pos++;
            return inner;
        }
        return this.test();
    }
    private test(): Condition {
        const first = this.toks[this.pos++];
        if (!first) fail(this.src, 'it ends too early');
        if (first.t !== 'word') {
            fail(this.src, this.dialect === 'feel' ? `it compares the value ${first.v} with something; write the property first, as in "amount > 100"` : 'a property path is expected');
        }
        if (this.dialect === 'awa' && first.v === 'typeof') {
            const path = this.toks[this.pos++];
            if (!path || path.t !== 'word') fail(this.src, 'a property path is expected after "typeof"');
            if (!this.is('op', '==')) fail(this.src, '"==" is expected after "typeof <path>"');
            this.pos++;
            const type = this.toks[this.pos++];
            if (!type || (type.t !== 'word' && type.t !== 'str')) fail(this.src, 'a type name is expected');
            return { k: 'typeof', path: path.v, type: type.v };
        }
        if (this.dialect === 'awa' && this.is('word', 'exists')) { this.pos++; return { k: 'exists', path: first.v }; }
        if (this.dialect === 'feel' && this.is('op', '(')) fail(this.src, `it calls the function ${first.v}, which AWA conditions do not have`);
        if (this.dialect === 'feel' && ['true', 'false', 'null'].includes(first.v)) fail(this.src, `it starts with the value ${first.v}; write the property first`);
        const op = this.peek();
        if (op && op.t === 'op' && ['===', '!==', '==', '!=', '<>', '>=', '<=', '>', '<', '='].includes(op.v)) {
            this.pos++;
            const lit = this.toks[this.pos++];
            if (!lit || lit.t === 'op') fail(this.src, `a value is expected after "${op.v}"`);
            return { k: 'cmp', path: first.v, op: normal_op(op.v), value: this.literal(lit) };
        }
        return { k: 'truthy', path: first.v };
    }
    private literal(tok: Tok): Literal {
        if (tok.t === 'num') return { t: 'num', v: Number(tok.v), text: tok.v };
        if (tok.t === 'str') return { t: 'str', v: tok.v };
        if (tok.v === 'true' || tok.v === 'false') return { t: 'bool', v: tok.v === 'true' };
        if (tok.v === 'null') return { t: 'null' };
        if (this.dialect === 'feel') fail(this.src, `it compares with the name ${tok.v}; AWA conditions compare a property with a value`);
        return { t: 'word', v: tok.v };
    }
}

function normal_op(op: string): string {
    return op === '===' || op === '=' ? '==' : op === '!==' || op === '<>' ? '!=' : op;
}

/** Remove the wrappers that BPMN tools put around expressions: ${...}, #{...} and a leading "=" */
export function unwrap_expression(text: string): string {
    let t = text.trim();
    const wrapped = /^[$#]\{([\s\S]*)\}$/.exec(t);
    if (wrapped) t = wrapped[1].trim();
    if (t.startsWith('=') && !t.startsWith('==')) t = t.slice(1).trim();
    return t;
}

/** Parse a condition. `feel` also reads the forms common in BPMN tools: &&, ||, !, == and ===. */
export function parse_condition(text: string, dialect: 'awa' | 'feel'): Condition {
    return new ConditionParser(tokenize(text, dialect), text, dialect).parse();
}

function awa_string(value: string, where: string): string {
    if (!value.includes('"')) return `"${value}"`;
    if (!value.includes("'")) return `'${value}'`;
    throw new InterchangeError(`${where}: the text ${JSON.stringify(value)} contains both kinds of quote, which AWA cannot write`);
}

function awa_number(text: string, value: number): string {
    if (/^-?\d+(\.\d+)?$/.test(text)) return text;
    const canonical = String(value);
    if (!/^-?\d+(\.\d+)?$/.test(canonical)) throw new InterchangeError(`the number ${text} cannot be written in AWA`);
    return canonical;
}

function awa_literal(lit: Literal, where: string): string {
    switch (lit.t) {
        case 'num': return awa_number(lit.text, lit.v);
        case 'str': return awa_string(lit.v, where);
        case 'bool': return String(lit.v);
        case 'null': return 'null';
        case 'word': return lit.v;
    }
}

/** Print a condition in AWA's condition expression language */
export function condition_to_awa(c: Condition, where = 'condition', level = 0): string {
    switch (c.k) {
        case 'or': { const s = c.items.map(i => condition_to_awa(i, where, 1)).join(' || '); return level > 1 ? `(${s})` : s; }
        case 'and': { const s = c.items.map(i => condition_to_awa(i, where, 2)).join(' && '); return level > 2 ? `(${s})` : s; }
        case 'not': return c.item.k === 'truthy' ? `!${c.item.path}` : `!(${condition_to_awa(c.item, where, 0)})`;
        case 'cmp': return `${c.path} ${c.op} ${awa_literal(c.value, where)}`;
        case 'exists': return `${c.path} exists`;
        case 'typeof': return `typeof ${c.path} == ${c.type}`;
        case 'truthy': return c.path;
    }
}

/** Translate a condition read from BPMN into AWA's language. Throws InterchangeError when it cannot be */
export function feel_condition_to_awa(text: string): string {
    const awa = condition_to_awa(parse_condition(unwrap_expression(text), 'feel'), `condition "${text}"`);
    const check = validate_expression(awa);
    if (!check.valid) throw new InterchangeError(`condition "${text}" cannot be read: ${check.error}`);
    return awa;
}

/** FEEL for an AWA condition, or undefined when FEEL cannot say the same thing (exists, typeof, truthiness) */
export function awa_condition_to_feel(text: string): string | undefined {
    let c: Condition;
    try { c = parse_condition(text, 'awa'); } catch { return undefined; }
    const out = (n: Condition, level: number): string | undefined => {
        switch (n.k) {
            case 'or': case 'and': {
                const parts = n.items.map(i => out(i, n.k === 'or' ? 1 : 2));
                if (parts.some(p => p === undefined)) return undefined;
                const s = parts.join(n.k === 'or' ? ' or ' : ' and ');
                return level > (n.k === 'or' ? 1 : 2) ? `(${s})` : s;
            }
            case 'not': { const inner = out(n.item, 0); return inner === undefined ? undefined : `not(${inner})`; }
            case 'cmp': {
                if (n.path.includes('$')) return undefined;
                const op = n.op === '==' ? '=' : n.op;
                const v = n.value;
                const lit = v.t === 'num' ? String(v.v) : v.t === 'str' || v.t === 'word' ? JSON.stringify(v.v) : v.t === 'bool' ? String(v.v) : 'null';
                return `${n.path} ${op} ${lit}`;
            }
            default: return undefined;
        }
    };
    return out(c, 0);
}

// ---------------------------------------------------------------------------
// jq, for Serverless Workflow runtime expressions
// ---------------------------------------------------------------------------

export function jq_path(path: string): string {
    return path.split('.').map(seg => (/^[A-Za-z_][A-Za-z0-9_]*$/.test(seg) ? `.${seg}` : `.${JSON.stringify(seg)}`)).join('');
}

function jq_literal(lit: Literal): string {
    return lit.t === 'num' ? String(lit.v) : lit.t === 'str' || lit.t === 'word' ? JSON.stringify(lit.v) : lit.t === 'bool' ? String(lit.v) : 'null';
}

function jq_has(path: string): string {
    const segs = path.split('.');
    const last = segs.pop()!;
    const parent = segs.length ? jq_path(segs.join('.')) : '.';
    return `(try (${parent} | has(${JSON.stringify(last)})) catch false)`;
}

/** A jq expression with the meaning of an AWA condition (6.2), up to AWA's text-to-number comparison */
export function awa_condition_to_jq(text: string): string {
    const out = (n: Condition): string => {
        switch (n.k) {
            case 'or': return `(${n.items.map(out).join(' or ')})`;
            case 'and': return `(${n.items.map(out).join(' and ')})`;
            case 'not': return `(${out(n.item)} | not)`;
            case 'cmp': {
                if (n.value.t === 'null') return `${jq_path(n.path)} ${n.op} null`;
                return `${jq_path(n.path)} ${n.op} ${jq_literal(n.value)}`;
            }
            case 'exists': return jq_has(n.path);
            case 'typeof': return n.type === 'undefined' ? `(${jq_has(n.path)} | not)` : `(${jq_path(n.path)} | type) == ${JSON.stringify(n.type)}`;
            case 'truthy': return `(${jq_path(n.path)} | . != null and . != false and . != 0 and . != "")`;
        }
    };
    return out(parse_condition(text, 'awa'));
}

function jq_value(value: unknown): string {
    return typeof value === 'string' ? JSON.stringify(value) : String(value);
}

/** A jq expression true when the value at `path` satisfies a decision table entry (5.5.1) */
export function unary_tests_to_jq(entry: string, path: string): string {
    const v = jq_path(path);
    const test = (t: UnaryTest): string => {
        switch (t.kind) {
            case 'any': return 'true';
            case 'null': return t.negate ? `${v} != null` : `${v} == null`;
            case 'not': return `((${t.tests.map(test).join(' or ')}) | not)`;
            case 'compare': return `${v} ${t.op} ${jq_value(t.value)}`;
            case 'range': return `(${v} ${t.low_closed ? '>=' : '>'} ${jq_value(t.low)} and ${v} ${t.high_closed ? '<=' : '<'} ${jq_value(t.high)})`;
            case 'in': { const any = `(${t.values.map(x => `${v} == ${jq_value(x)}`).join(' or ')})`; return t.negate ? `(${any} | not)` : any; }
            case 'text': {
                const fn = t.fn === 'contains' ? 'contains' : t.fn === 'starts' ? 'startswith' : t.fn === 'ends' ? 'endswith' : 'test';
                return `(${v} != null and (${v} | tostring | ${fn}(${JSON.stringify(t.value)})))`;
            }
        }
    };
    const tests = parse_unary_tests(entry);
    return tests.length === 1 ? test(tests[0]) : `(${tests.map(test).join(' or ')})`;
}

// ---------------------------------------------------------------------------
// Decision table entries: FEEL unary tests
// ---------------------------------------------------------------------------

function split_top(text: string): string[] {
    const parts: string[] = [];
    let depth = 0, quote = '', start = 0;
    for (let i = 0; i < text.length; i++) {
        const c = text[i];
        if (quote) { if (c === '\\') { i++; continue; } if (c === quote) quote = ''; continue; }
        if (c === '"') quote = c;
        else if (c === '(' || c === '[') depth++;
        else if (c === ')' || c === ']') depth--;
        else if (c === ',' && depth === 0) { parts.push(text.slice(start, i)); start = i + 1; }
    }
    parts.push(text.slice(start));
    return parts.map(p => p.trim());
}

function refuse_feel(text: string, reason: string): never {
    throw new InterchangeError(`FEEL "${text}" cannot be expressed in AWA's decision table entries (5.5.1): ${reason}`);
}

/** A FEEL value an AWA entry can compare with: number, string, boolean, or a date or time given as text */
function feel_value(text: string, whole: string): { awa: string; value: string | number | boolean } {
    const t = text.trim();
    if (/^-?(\d+(\.\d+)?|\.\d+)$/.test(t)) return { awa: awa_number(t, Number(t)), value: Number(t) };
    if (t === 'true' || t === 'false') return { awa: t, value: t === 'true' };
    if (t.startsWith('"')) {
        let parsed: { value: string; end: number };
        try { parsed = read_string(t, 0, true); } catch { refuse_feel(whole, 'a string is not terminated'); }
        if (parsed.end !== t.length) refuse_feel(whole, `"${t}" is not a single value`);
        return { awa: awa_string(parsed.value, `FEEL "${whole}"`), value: parsed.value };
    }
    const temporal = /^(date and time|date|time)\s*\(\s*("(?:[^"\\]|\\.)*")\s*\)$/.exec(t);
    if (temporal) {
        const inner = read_string(temporal[2], 0, true).value;
        return { awa: awa_string(inner, `FEEL "${whole}"`), value: inner };
    }
    if (t === 'null') refuse_feel(whole, 'null cannot be a bound');
    refuse_feel(whole, /^[A-Za-z_]/.test(t) && !/[(+\-*/]/.test(t) ? `${t} names a variable; AWA compares with values only` : `"${t}" is an expression, not a value`);
}

function feel_test(p: string, whole: string): string {
    if (p === '') refuse_feel(whole, 'a test is empty');
    if (p === 'null') return 'null';
    const q = /^\?\s*(<=|>=|!=|=|<|>)\s*([\s\S]+)$/.exec(p);
    if (q) return q[1] === '=' ? (q[2].trim() === 'null' ? 'null' : feel_value(q[2], whole).awa) : q[1] === '!=' && q[2].trim() === 'null' ? 'not null' : `${q[1]} ${feel_value(q[2], whole).awa}`;
    const cmp = /^(<=|>=|!=|<|>|=)\s*([\s\S]+)$/.exec(p);
    if (cmp) {
        if (cmp[2].trim() === 'null') return cmp[1] === '=' ? 'null' : cmp[1] === '!=' ? 'not null' : refuse_feel(whole, 'null cannot be compared by order');
        return cmp[1] === '=' ? feel_value(cmp[2], whole).awa : `${cmp[1]} ${feel_value(cmp[2], whole).awa}`;
    }
    const range = /^([[\](])\s*([\s\S]+?)\s*\.\.\s*([\s\S]+?)\s*([[\])])$/.exec(p);
    if (range) {
        const low = feel_value(range[2], whole).awa, high = feel_value(range[3], whole).awa;
        return `${range[1] === '[' ? '[' : '('}${low}..${high}${range[4] === ']' ? ']' : ')'}`;
    }
    const fn = /^(contains|starts with|ends with|matches)\s*\(\s*\?\s*,\s*([\s\S]+)\)$/.exec(p);
    if (fn) {
        const arg = feel_value(fn[2], whole);
        if (typeof arg.value !== 'string') refuse_feel(whole, `${fn[1]} needs a string`);
        return fn[1] === 'contains' ? `contains(${arg.awa})` : fn[1] === 'matches' ? `matches(${arg.awa})` : `${fn[1]} ${arg.awa}`;
    }
    if (p.startsWith('[') || p.startsWith('{')) refuse_feel(whole, 'lists and contexts are not tests AWA has');
    if (p.includes('?')) refuse_feel(whole, 'only "? <operator> <value>" can use "?"');
    return feel_value(p, whole).awa;
}

/** Translate a FEEL unary test (a DMN input entry) into an AWA entry, or refuse with the reason */
export function feel_unary_to_awa(text: string): string {
    const t = (text ?? '').trim();
    if (t === '' || t === '-') return '-';
    const negated = /^not\s*\(([\s\S]*)\)$/.exec(t);
    let awa: string;
    if (negated) {
        const inner = split_top(negated[1]);
        awa = inner.length === 1 && inner[0] === 'null' ? 'not null' : `not(${inner.map(p => feel_test(p, t)).join(', ')})`;
    } else {
        awa = split_top(t).map(p => feel_test(p, t)).join(', ');
    }
    const check = validate_unary_tests(awa);
    if (!check.valid) refuse_feel(t, check.error || 'it is not a valid entry');
    return awa;
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const ISO_DATE_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})?$/;

/** FEEL for a value an AWA entry compares with; dates in date columns become FEEL dates */
function feel_of(value: string | number | boolean, column_type?: string): string {
    if (typeof value === 'string') {
        if (column_type === 'date' && ISO_DATE.test(value)) return `date(${JSON.stringify(value)})`;
        if (column_type === 'datetime' && ISO_DATE_TIME.test(value)) return `date and time(${JSON.stringify(value)})`;
        return JSON.stringify(value);
    }
    return String(value);
}

/** Translate an AWA entry into a FEEL unary test (27.10). Every AWA entry has one */
export function awa_unary_to_feel(entry: string, column_type?: string): string {
    const tests = parse_unary_tests(entry);
    const single = tests.length === 1;
    const one = (t: UnaryTest, alone: boolean): string => {
        switch (t.kind) {
            case 'any': return '-';
            case 'null': return t.negate ? (alone ? 'not(null)' : '? != null') : 'null';
            case 'not': return `not(${t.tests.map(x => one(x, false)).join(', ')})`;
            case 'compare':
                if (t.op === '==') return feel_of(t.value, column_type);
                if (t.op === '!=') return alone ? `not(${feel_of(t.value, column_type)})` : `? != ${feel_of(t.value, column_type)}`;
                return `${t.op} ${feel_of(t.value, column_type)}`;
            case 'range': return `${t.low_closed ? '[' : '('}${feel_of(t.low, column_type)}..${feel_of(t.high, column_type)}${t.high_closed ? ']' : ')'}`;
            case 'in':
                if (!t.negate) return t.values.map(v => feel_of(v, column_type)).join(', ');
                return alone ? `not(${t.values.map(v => feel_of(v, column_type)).join(', ')})` : `(${t.values.map(v => `? != ${feel_of(v, column_type)}`).join(' and ')})`;
            case 'text': {
                const fn = t.fn === 'contains' ? 'contains' : t.fn === 'starts' ? 'starts with' : t.fn === 'ends' ? 'ends with' : 'matches';
                return `${fn}(?, ${JSON.stringify(t.value)})`;
            }
        }
    };
    return tests.map(t => one(t, single)).join(', ');
}

/** FEEL literal expression for an AWA output entry. JSON values are FEEL literals */
export const value_to_feel = (value: unknown): string => (value === undefined ? 'null' : JSON.stringify(value));

/** The AWA output value of a FEEL literal expression (a DMN output entry), or refuse */
export function feel_to_value(text: string): unknown {
    const t = (text ?? '').trim();
    if (t === '') return null;
    try { return JSON.parse(t); } catch { /* not JSON */ }
    const temporal = /^(date and time|date|time)\s*\(\s*("(?:[^"\\]|\\.)*")\s*\)$/.exec(t);
    if (temporal) return read_string(temporal[2], 0, true).value;
    throw new InterchangeError(`FEEL "${t}" cannot be an AWA output entry: AWA outputs are values (numbers, strings, booleans, null, lists and objects), not expressions`);
}
