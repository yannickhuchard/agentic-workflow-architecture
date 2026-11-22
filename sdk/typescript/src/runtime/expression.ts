/**
 * AWA Condition Expression Language (ACEL)
 *
 * The single, normative expression language used by edge conditions,
 * verification criteria and outcome-contract postconditions.
 * See docs/specification.md, section "Condition Expressions".
 *
 * Grammar:
 *   expr       := and ( '||' and )*
 *   and        := unary ( '&&' unary )*
 *   unary      := '!' unary | '(' expr ')' | test
 *   test       := 'typeof' path '==' word
 *               | path 'exists'
 *               | path ( '==' | '!=' | '>=' | '<=' | '>' | '<' ) literal
 *               | path                      (truthiness)
 *   path       := ident ( '.' ident )*
 *   literal    := number | 'string' | "string" | true | false | null | word
 *
 * A bare word on the right-hand side of a comparison is a string literal.
 * Evaluation is total and side-effect free: an expression that cannot be
 * parsed raises ExpressionError; it never silently evaluates to a value.
 */

export class ExpressionError extends Error {
    public readonly code = 'VALIDATION_ERROR';
    constructor(message: string, public readonly expression: string) {
        super(`Invalid expression "${expression}": ${message}`);
        this.name = 'ExpressionError';
    }
}

type Tok =
    | { t: 'op'; v: string }
    | { t: 'num'; v: number }
    | { t: 'str'; v: string }
    | { t: 'word'; v: string };

const OPERATORS = ['&&', '||', '==', '!=', '>=', '<=', '>', '<', '!', '(', ')'];

function tokenize(src: string): Tok[] {
    const out: Tok[] = [];
    let i = 0;
    while (i < src.length) {
        const c = src[i];
        if (/\s/.test(c)) { i++; continue; }

        const op = OPERATORS.find(o => src.startsWith(o, i));
        if (op) { out.push({ t: 'op', v: op }); i += op.length; continue; }

        if (c === '"' || c === "'") {
            const end = src.indexOf(c, i + 1);
            if (end < 0) throw new ExpressionError('unterminated string', src);
            out.push({ t: 'str', v: src.slice(i + 1, end) });
            i = end + 1;
            continue;
        }

        const num = /^-?\d+(\.\d+)?/.exec(src.slice(i));
        if (num) { out.push({ t: 'num', v: Number(num[0]) }); i += num[0].length; continue; }

        const word = /^[A-Za-z_$][\w$]*(\.[A-Za-z_$][\w$]*)*/.exec(src.slice(i));
        if (word) { out.push({ t: 'word', v: word[0] }); i += word[0].length; continue; }

        throw new ExpressionError(`unexpected character "${c}"`, src);
    }
    return out;
}

/** Resolve a dotted path against a data object. Returns undefined if any segment is missing. */
export function resolve_path(data: unknown, path: string): unknown {
    let current: unknown = data;
    for (const segment of path.split('.')) {
        if (current === null || typeof current !== 'object') return undefined;
        current = (current as Record<string, unknown>)[segment];
    }
    return current;
}

function has_path(data: unknown, path: string): boolean {
    let current: unknown = data;
    for (const segment of path.split('.')) {
        if (current === null || typeof current !== 'object' || !(segment in (current as object))) return false;
        current = (current as Record<string, unknown>)[segment];
    }
    return true;
}

function awa_typeof(value: unknown): string {
    if (value === null) return 'null';
    if (Array.isArray(value)) return 'array';
    return typeof value;
}

class Parser {
    private pos = 0;
    constructor(private toks: Tok[], private src: string, private data: Record<string, unknown>) { }

    private peek(): Tok | undefined { return this.toks[this.pos]; }
    private next(): Tok | undefined { return this.toks[this.pos++]; }
    private is_op(v: string): boolean {
        const t = this.peek();
        return !!t && t.t === 'op' && t.v === v;
    }
    private fail(message: string): never { throw new ExpressionError(message, this.src); }

    parse(): boolean {
        if (this.toks.length === 0) this.fail('empty expression');
        const value = this.or();
        if (this.pos < this.toks.length) this.fail('unexpected trailing tokens');
        return value;
    }

    private or(): boolean {
        let value = this.and();
        while (this.is_op('||')) { this.next(); const rhs = this.and(); value = value || rhs; }
        return value;
    }

    private and(): boolean {
        let value = this.unary();
        while (this.is_op('&&')) { this.next(); const rhs = this.unary(); value = value && rhs; }
        return value;
    }

    private unary(): boolean {
        if (this.is_op('!')) { this.next(); return !this.unary(); }
        if (this.is_op('(')) {
            this.next();
            const value = this.or();
            if (!this.is_op(')')) this.fail('missing ")"');
            this.next();
            return value;
        }
        return this.test();
    }

    private test(): boolean {
        const first = this.next();
        if (!first || first.t !== 'word') this.fail('expected a property path');
        const head = (first as { v: string }).v;

        if (head === 'typeof') {
            const path = this.next();
            if (!path || path.t !== 'word') this.fail('expected a property path after "typeof"');
            if (!this.is_op('==')) this.fail('expected "==" after "typeof <path>"');
            this.next();
            const type = this.next();
            if (!type || (type.t !== 'word' && type.t !== 'str')) this.fail('expected a type name');
            return awa_typeof(resolve_path(this.data, (path as { v: string }).v)) === String((type as { v: unknown }).v);
        }

        const after = this.peek();
        if (after && after.t === 'word' && after.v === 'exists') {
            this.next();
            return has_path(this.data, head);
        }

        if (after && after.t === 'op' && ['==', '!=', '>=', '<=', '>', '<'].includes(after.v)) {
            this.next();
            const lit = this.next();
            if (!lit || lit.t === 'op') this.fail(`expected a literal after "${after.v}"`);
            return this.compare(resolve_path(this.data, head), after.v, this.literal(lit as Tok));
        }

        return Boolean(resolve_path(this.data, head));
    }

    private literal(tok: Tok): unknown {
        if (tok.t === 'num' || tok.t === 'str') return tok.v;
        if (tok.v === 'true') return true;
        if (tok.v === 'false') return false;
        if (tok.v === 'null') return null;
        return tok.v; // bare word => string literal
    }

    private compare(actual: unknown, op: string, expected: unknown): boolean {
        if (op === '==' || op === '!=') {
            let equal: boolean;
            if (typeof expected === 'number') equal = actual !== null && actual !== '' && actual !== undefined && Number(actual) === expected;
            else if (typeof expected === 'boolean') equal = actual === expected || actual === String(expected);
            else if (expected === null) equal = actual === null || actual === undefined;
            else equal = actual !== undefined && actual !== null && String(actual) === expected;
            return op === '==' ? equal : !equal;
        }
        if (actual === undefined || actual === null) return false;
        const a = typeof expected === 'number' ? Number(actual) : String(actual);
        const b = expected as number | string;
        if (typeof a === 'number' && Number.isNaN(a)) return false;
        switch (op) {
            case '>': return a > b;
            case '>=': return a >= b;
            case '<': return a < b;
            default: return a <= b;
        }
    }
}

/**
 * Evaluate a condition expression against a data object.
 * @throws ExpressionError if the expression is not valid ACEL.
 */
export function evaluate_expression(expression: string, data: Record<string, unknown>): boolean {
    return new Parser(tokenize(expression), expression, data).parse();
}

/** Check whether an expression is syntactically valid, without needing data. */
export function validate_expression(expression: string): { valid: boolean; error?: string } {
    try {
        evaluate_expression(expression, {});
        return { valid: true };
    } catch (error) {
        return { valid: false, error: error instanceof Error ? error.message : String(error) };
    }
}
