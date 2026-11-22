/**
 * AWA decision table entries: unary tests (specification 5.5.1)
 *
 * An input entry of a decision rule is a test applied to one value.
 *
 *   entry   := "-" | "*" | ""                         any value
 *            | "not(" tests ")"                       none of the tests holds
 *            | tests
 *   tests   := test ( "," test )*                     at least one test holds
 *   test    := "null" | "not null"
 *            | ( ">" | ">=" | "<" | "<=" | "=" | "==" | "!=" | "<>" ) literal
 *            | ( "[" | "(" ) literal ".." literal ( "]" | ")" )
 *            | "in" "(" literal ( "," literal )* ")"
 *            | "not in" "(" literal ( "," literal )* ")"
 *            | "contains(" string ")" | "starts with" string | "ends with" string | "matches(" string ")"
 *            | literal                                equality
 *   literal := number | "string" | 'string' | true | false | word
 *
 * An entry that cannot be parsed is an error, never a value.
 */

export class UnaryTestError extends Error {
    public readonly code = 'VALIDATION_ERROR';
    constructor(message: string, public readonly entry: string) {
        super(`Invalid decision entry "${entry}": ${message}`);
        this.name = 'UnaryTestError';
    }
}

type Literal = number | string | boolean;
type Test =
    | { kind: 'any' }
    | { kind: 'null'; negate: boolean }
    | { kind: 'compare'; op: '>' | '>=' | '<' | '<=' | '==' | '!='; value: Literal }
    | { kind: 'range'; low: Literal; high: Literal; low_closed: boolean; high_closed: boolean }
    | { kind: 'in'; values: Literal[]; negate: boolean }
    | { kind: 'text'; fn: 'contains' | 'starts' | 'ends' | 'matches'; value: string }
    | { kind: 'not'; tests: Test[] };

/** Split on commas that are outside quotes, brackets and parentheses */
function split_top(text: string, entry: string): string[] {
    const parts: string[] = [];
    let depth = 0, quote = '', start = 0;
    for (let i = 0; i < text.length; i++) {
        const c = text[i];
        if (quote) { if (c === quote) quote = ''; continue; }
        if (c === '"' || c === "'") quote = c;
        else if (c === '(' || c === '[') depth++;
        else if (c === ')' || c === ']') depth--;
        else if (c === ',' && depth === 0) { parts.push(text.slice(start, i)); start = i + 1; }
    }
    if (quote) throw new UnaryTestError('unterminated string', entry);
    if (depth !== 0) throw new UnaryTestError('unbalanced brackets', entry);
    parts.push(text.slice(start));
    return parts.map(p => p.trim());
}

function literal(text: string, entry: string): Literal {
    const t = text.trim();
    if (t === '') throw new UnaryTestError('a value is missing', entry);
    if ((t.startsWith('"') && t.endsWith('"') && t.length >= 2) || (t.startsWith("'") && t.endsWith("'") && t.length >= 2)) return t.slice(1, -1);
    if (t === 'true') return true;
    if (t === 'false') return false;
    if (/^-?\d+(\.\d+)?$/.test(t)) return Number(t);
    if (/^[<>=!]/.test(t)) throw new UnaryTestError(`"${t}" is not a value`, entry);
    return t; // bare word: a string
}

function quoted(text: string, entry: string): string {
    const value = literal(text, entry);
    if (typeof value !== 'string') throw new UnaryTestError('a string is expected', entry);
    return value;
}

function parse_test(text: string, entry: string): Test {
    const t = text.trim();
    const lower = t.toLowerCase();
    if (t === '' ) throw new UnaryTestError('an empty test', entry);
    if (lower === 'null') return { kind: 'null', negate: false };
    if (lower === 'not null') return { kind: 'null', negate: true };

    const call = /^(not\s+in|in|contains|matches)\s*\(([\s\S]*)\)$/i.exec(t);
    if (call) {
        const name = call[1].toLowerCase().replace(/\s+/g, ' ');
        if (name === 'in' || name === 'not in') {
            const values = split_top(call[2], entry).map(v => literal(v, entry));
            return { kind: 'in', values, negate: name === 'not in' };
        }
        if (name === 'matches') {
            const pattern = quoted(call[2], entry);
            try { new RegExp(pattern); } catch { throw new UnaryTestError('the pattern is not a valid regular expression', entry); }
            return { kind: 'text', fn: 'matches', value: pattern };
        }
        return { kind: 'text', fn: 'contains', value: quoted(call[2], entry) };
    }
    if (lower.startsWith('starts with ')) return { kind: 'text', fn: 'starts', value: quoted(t.slice(12), entry) };
    if (lower.startsWith('ends with ')) return { kind: 'text', fn: 'ends', value: quoted(t.slice(10), entry) };

    const range = /^([\[(])([\s\S]+?)\.\.([\s\S]+)([\])])$/.exec(t);
    if (range) {
        return {
            kind: 'range', low: literal(range[2], entry), high: literal(range[3], entry),
            low_closed: range[1] === '[', high_closed: range[4] === ']',
        };
    }

    const compare = /^(>=|<=|!=|<>|==|=|>|<)([\s\S]*)$/.exec(t);
    if (compare) {
        const op = compare[1] === '<>' ? '!=' : compare[1] === '=' ? '==' : compare[1];
        return { kind: 'compare', op: op as '>' | '>=' | '<' | '<=' | '==' | '!=', value: literal(compare[2], entry) };
    }

    return { kind: 'compare', op: '==', value: literal(t, entry) };
}

const cache = new Map<string, Test[]>();

/** Parse an entry into its tests. Throws UnaryTestError if it is not valid. */
export function parse_unary_tests(entry: string): Test[] {
    const key = entry ?? '';
    const cached = cache.get(key);
    if (cached) return cached;

    const t = key.trim();
    let tests: Test[];
    if (t === '' || t === '-' || t === '*') {
        tests = [{ kind: 'any' }];
    } else {
        const negated = /^not\s*\(([\s\S]*)\)$/i.exec(t);
        tests = negated
            ? [{ kind: 'not', tests: split_top(negated[1], key).map(part => parse_test(part, key)) }]
            : split_top(t, key).map(part => parse_test(part, key));
    }
    cache.set(key, tests);
    return tests;
}

const missing = (value: unknown) => value === undefined || value === null;

function equal(value: unknown, expected: Literal): boolean {
    if (missing(value)) return false;
    if (typeof expected === 'number') return value !== '' && typeof value !== 'boolean' && Number(value) === expected;
    if (typeof expected === 'boolean') return value === expected || value === String(expected);
    return String(value) === expected;
}

/** -1, 0 or 1; undefined when the two cannot be ordered */
function order(value: unknown, bound: Literal): number | undefined {
    if (missing(value) || typeof value === 'boolean' || typeof bound === 'boolean') return undefined;
    if (typeof bound === 'number') {
        const n = value === '' ? NaN : Number(value);
        return Number.isNaN(n) ? undefined : Math.sign(n - bound);
    }
    // Text, including ISO 8601 dates and times, is ordered as text
    const text = String(value);
    return text < bound ? -1 : text > bound ? 1 : 0;
}

function holds(test: Test, value: unknown): boolean {
    switch (test.kind) {
        case 'any': return true;
        case 'null': return missing(value) !== test.negate;
        case 'not': return !test.tests.some(inner => holds(inner, value));
        case 'in': return test.values.some(v => equal(value, v)) !== test.negate;
        case 'compare': {
            if (test.op === '==') return equal(value, test.value);
            if (test.op === '!=') return !equal(value, test.value);
            const o = order(value, test.value);
            if (o === undefined) return false;
            return test.op === '>' ? o > 0 : test.op === '>=' ? o >= 0 : test.op === '<' ? o < 0 : o <= 0;
        }
        case 'range': {
            const low = order(value, test.low), high = order(value, test.high);
            if (low === undefined || high === undefined) return false;
            return (test.low_closed ? low >= 0 : low > 0) && (test.high_closed ? high <= 0 : high < 0);
        }
        case 'text': {
            if (missing(value)) return false;
            const text = String(value);
            return test.fn === 'contains' ? text.includes(test.value)
                : test.fn === 'starts' ? text.startsWith(test.value)
                    : test.fn === 'ends' ? text.endsWith(test.value)
                        : new RegExp(test.value).test(text);
        }
    }
}

/** Whether a value satisfies an entry: at least one of its tests holds */
export function evaluate_unary_tests(entry: string, value: unknown): boolean {
    return parse_unary_tests(entry).some(test => holds(test, value));
}

/** Check an entry without evaluating it */
export function validate_unary_tests(entry: string): { valid: boolean; error?: string } {
    try {
        parse_unary_tests(entry);
        return { valid: true };
    } catch (error) {
        return { valid: false, error: error instanceof Error ? error.message : String(error) };
    }
}
