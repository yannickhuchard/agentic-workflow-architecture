"""
Translation of conditions and decision table entries between AWA's languages (sections 6
and 5.5.1), FEEL and jq. Specification 27.10.

Python port of sdk/typescript/src/interchange/expressions.ts.
"""

from __future__ import annotations

import json
import re
from typing import Any

from awa.interchange.common import InterchangeError, js_number
from awa.runtime.expression import ExpressionError, evaluate_expression
from awa.runtime.unary_test import UnaryTestError, parse_unary_tests, validate_unary_tests

# A literal is ("num", value, text) | ("str", value) | ("bool", value) | ("null",) | ("word", value)
# A condition is ("or", [items]) | ("and", [items]) | ("not", item) | ("cmp", path, op, literal)
#              | ("exists", path) | ("typeof", path, type) | ("truthy", path)

_AWA_OPERATORS = ["&&", "||", "==", "!=", ">=", "<=", ">", "<", "!", "(", ")"]
_FEEL_OPERATORS = ["===", "!==", "&&", "||", "==", "!=", "<>", ">=", "<=", ">", "<", "=", "!", "(", ")", ","]
_WORD = re.compile(r"[A-Za-z_$][\w$]*(\.[A-Za-z_$][\w$]*)*")
_AWA_NUMBER = re.compile(r"-?\d+(\.\d+)?")
_FEEL_NUMBER = re.compile(r"-?(\d+(\.\d+)?|\.\d+)")


def _fail(text: str, reason: str):
    raise InterchangeError(f'condition "{text}" cannot be read: {reason}')


def _read_string(src: str, i: int, escapes: bool) -> tuple[str, int]:
    quote = src[i]
    out = []
    j = i + 1
    while j < len(src) and src[j] != quote:
        if escapes and src[j] == "\\" and j + 1 < len(src):
            c = src[j + 1]
            if c == "u" and re.fullmatch(r"[0-9a-fA-F]{4}", src[j + 2:j + 6] or ""):
                out.append(chr(int(src[j + 2:j + 6], 16)))
                j += 6
                continue
            out.append({"n": "\n", "t": "\t", "r": "\r"}.get(c, c))
            j += 2
            continue
        out.append(src[j])
        j += 1
    if j >= len(src):
        raise InterchangeError("unterminated string")
    return "".join(out), j + 1


def _tokenize(src: str, dialect: str) -> list[tuple[str, str]]:
    operators = _AWA_OPERATORS if dialect == "awa" else _FEEL_OPERATORS
    out: list[tuple[str, str]] = []
    i = 0
    while i < len(src):
        c = src[i]
        if c.isspace():
            i += 1
            continue
        if c in "\"'":
            try:
                value, end = _read_string(src, i, dialect == "feel")
            except InterchangeError:
                _fail(src, "a string is not terminated")
            out.append(("str", value))
            i = end
            continue
        num = (_AWA_NUMBER if dialect == "awa" else _FEEL_NUMBER).match(src, i)
        if num and (c != "-" or not out or out[-1][0] == "op"):
            out.append(("num", num.group(0)))
            i = num.end()
            continue
        op = next((o for o in operators if src.startswith(o, i)), None)
        if op:
            out.append(("op", op))
            i += len(op)
            continue
        word = _WORD.match(src, i)
        if word:
            out.append(("word", word.group(0)))
            i = word.end()
            continue
        _fail(src, f'"{c}" is not part of what AWA conditions can say (comparisons joined by and, or, not)' if dialect == "feel" else f'unexpected character "{c}"')
    return out


def _normal_op(op: str) -> str:
    return "==" if op in ("===", "=") else "!=" if op in ("!==", "<>") else op


class _Parser:
    def __init__(self, toks, src, dialect):
        self.toks, self.src, self.dialect, self.pos = toks, src, dialect, 0

    def peek(self):
        return self.toks[self.pos] if self.pos < len(self.toks) else None

    def is_(self, kind, value=None):
        t = self.peek()
        return t is not None and t[0] == kind and (value is None or t[1] == value)

    def keyword(self, value):
        return self.dialect == "feel" and self.is_("word", value)

    def parse(self):
        if not self.toks:
            _fail(self.src, "it is empty")
        c = self.or_()
        if self.pos < len(self.toks):
            _fail(self.src, f'"{self.toks[self.pos][1]}" is not expected here')
        return c

    def or_(self):
        items = [self.and_()]
        while self.is_("op", "||") or self.keyword("or"):
            self.pos += 1
            items.append(self.and_())
        return items[0] if len(items) == 1 else ("or", items)

    def and_(self):
        items = [self.unary()]
        while self.is_("op", "&&") or self.keyword("and"):
            self.pos += 1
            items.append(self.unary())
        return items[0] if len(items) == 1 else ("and", items)

    def unary(self):
        if self.is_("op", "!"):
            self.pos += 1
            return ("not", self.unary())
        nxt = self.toks[self.pos + 1] if self.pos + 1 < len(self.toks) else None
        if self.keyword("not") and nxt == ("op", "("):
            self.pos += 2
            item = self.or_()
            if not self.is_("op", ")"):
                _fail(self.src, 'a ")" is missing')
            self.pos += 1
            return ("not", item)
        if self.is_("op", "("):
            self.pos += 1
            inner = self.or_()
            if not self.is_("op", ")"):
                _fail(self.src, 'a ")" is missing')
            self.pos += 1
            return inner
        return self.test()

    def test(self):
        first = self.peek()
        self.pos += 1
        if first is None:
            _fail(self.src, "it ends too early")
        if first[0] != "word":
            _fail(self.src, f'it compares the value {first[1]} with something; write the property first, as in "amount > 100"'
                  if self.dialect == "feel" else "a property path is expected")
        if self.dialect == "awa" and first[1] == "typeof":
            path = self.peek()
            self.pos += 1
            if not path or path[0] != "word":
                _fail(self.src, 'a property path is expected after "typeof"')
            if not self.is_("op", "=="):
                _fail(self.src, '"==" is expected after "typeof <path>"')
            self.pos += 1
            kind = self.peek()
            self.pos += 1
            if not kind or kind[0] not in ("word", "str"):
                _fail(self.src, "a type name is expected")
            return ("typeof", path[1], kind[1])
        if self.dialect == "awa" and self.is_("word", "exists"):
            self.pos += 1
            return ("exists", first[1])
        if self.dialect == "feel" and self.is_("op", "("):
            _fail(self.src, f"it calls the function {first[1]}, which AWA conditions do not have")
        if self.dialect == "feel" and first[1] in ("true", "false", "null"):
            _fail(self.src, f"it starts with the value {first[1]}; write the property first")
        op = self.peek()
        if op and op[0] == "op" and op[1] in ("===", "!==", "==", "!=", "<>", ">=", "<=", ">", "<", "="):
            self.pos += 1
            lit = self.peek()
            self.pos += 1
            if not lit or lit[0] == "op":
                _fail(self.src, f'a value is expected after "{op[1]}"')
            return ("cmp", first[1], _normal_op(op[1]), self.literal(lit))
        return ("truthy", first[1])

    def literal(self, tok):
        kind, value = tok
        if kind == "num":
            return ("num", float(value) if ("." in value) else int(value), value)
        if kind == "str":
            return ("str", value)
        if value in ("true", "false"):
            return ("bool", value == "true")
        if value == "null":
            return ("null",)
        if self.dialect == "feel":
            _fail(self.src, f"it compares with the name {value}; AWA conditions compare a property with a value")
        return ("word", value)


def unwrap_expression(text: str) -> str:
    """Remove the wrappers that BPMN tools put around expressions: ${...}, #{...} and a leading "=" """
    t = text.strip()
    wrapped = re.fullmatch(r"[$#]\{([\s\S]*)\}", t)
    if wrapped:
        t = wrapped.group(1).strip()
    if t.startswith("=") and not t.startswith("=="):
        t = t[1:].strip()
    return t


def parse_condition(text: str, dialect: str):
    return _Parser(_tokenize(text, dialect), text, dialect).parse()


def _awa_string(value: str, where: str) -> str:
    if '"' not in value:
        return f'"{value}"'
    if "'" not in value:
        return f"'{value}'"
    raise InterchangeError(f"{where}: the text {json.dumps(value, ensure_ascii=False)} contains both kinds of quote, which AWA cannot write")


def _awa_number(text: str, value: int | float) -> str:
    if re.fullmatch(r"-?\d+(\.\d+)?", text):
        return text
    canonical = js_number(value)
    if not re.fullmatch(r"-?\d+(\.\d+)?", canonical):
        raise InterchangeError(f"the number {text} cannot be written in AWA")
    return canonical


def _awa_literal(lit, where: str) -> str:
    kind = lit[0]
    if kind == "num":
        return _awa_number(lit[2], lit[1])
    if kind == "str":
        return _awa_string(lit[1], where)
    if kind == "bool":
        return "true" if lit[1] else "false"
    if kind == "null":
        return "null"
    return lit[1]


def condition_to_awa(c, where: str = "condition", level: int = 0) -> str:
    """Print a condition in AWA's condition expression language"""
    kind = c[0]
    if kind == "or":
        s = " || ".join(condition_to_awa(i, where, 1) for i in c[1])
        return f"({s})" if level > 1 else s
    if kind == "and":
        s = " && ".join(condition_to_awa(i, where, 2) for i in c[1])
        return f"({s})" if level > 2 else s
    if kind == "not":
        return f"!{c[1][1]}" if c[1][0] == "truthy" else f"!({condition_to_awa(c[1], where, 0)})"
    if kind == "cmp":
        return f"{c[1]} {c[2]} {_awa_literal(c[3], where)}"
    if kind == "exists":
        return f"{c[1]} exists"
    if kind == "typeof":
        return f"typeof {c[1]} == {c[2]}"
    return c[1]


def feel_condition_to_awa(text: str) -> str:
    """Translate a condition read from BPMN into AWA's language. Raises InterchangeError when it cannot be"""
    awa = condition_to_awa(parse_condition(unwrap_expression(text), "feel"), f'condition "{text}"')
    try:
        evaluate_expression(awa, {})
    except ExpressionError as error:
        raise InterchangeError(f'condition "{text}" cannot be read: {error}') from None
    return awa


def _literal_text(lit) -> str:
    kind = lit[0]
    if kind == "num":
        return js_number(lit[1])
    if kind in ("str", "word"):
        return json.dumps(lit[1], ensure_ascii=False)
    if kind == "bool":
        return "true" if lit[1] else "false"
    return "null"


def awa_condition_to_feel(text: str) -> str | None:
    """FEEL for an AWA condition, or None when FEEL cannot say the same thing (exists, typeof, truthiness)"""
    try:
        c = parse_condition(text, "awa")
    except InterchangeError:
        return None

    def out(n, level):
        kind = n[0]
        if kind in ("or", "and"):
            parts = [out(i, 1 if kind == "or" else 2) for i in n[1]]
            if any(p is None for p in parts):
                return None
            s = (" or " if kind == "or" else " and ").join(parts)
            return f"({s})" if level > (1 if kind == "or" else 2) else s
        if kind == "not":
            inner = out(n[1], 0)
            return None if inner is None else f"not({inner})"
        if kind == "cmp":
            if "$" in n[1]:
                return None
            op = "=" if n[2] == "==" else n[2]
            return f"{n[1]} {op} {_literal_text(n[3])}"
        return None

    return out(c, 0)


# ---------------------------------------------------------------------------
# jq, for Serverless Workflow runtime expressions
# ---------------------------------------------------------------------------


def jq_path(path: str) -> str:
    return "".join(f".{seg}" if re.fullmatch(r"[A-Za-z_][A-Za-z0-9_]*", seg) else f".{json.dumps(seg, ensure_ascii=False)}" for seg in path.split("."))


def _jq_has(path: str) -> str:
    segs = path.split(".")
    last = segs.pop()
    parent = jq_path(".".join(segs)) if segs else "."
    return f"(try ({parent} | has({json.dumps(last, ensure_ascii=False)})) catch false)"


def awa_condition_to_jq(text: str) -> str:
    """A jq expression with the meaning of an AWA condition (6.2), up to AWA's text-to-number comparison"""

    def out(n):
        kind = n[0]
        if kind == "or":
            return "(" + " or ".join(out(i) for i in n[1]) + ")"
        if kind == "and":
            return "(" + " and ".join(out(i) for i in n[1]) + ")"
        if kind == "not":
            return f"({out(n[1])} | not)"
        if kind == "cmp":
            return f"{jq_path(n[1])} {n[2]} {_literal_text(n[3])}"
        if kind == "exists":
            return _jq_has(n[1])
        if kind == "typeof":
            return f"({_jq_has(n[1])} | not)" if n[2] == "undefined" else f"({jq_path(n[1])} | type) == {json.dumps(n[2])}"
        return f'({jq_path(n[1])} | . != null and . != false and . != 0 and . != "")'

    return out(parse_condition(text, "awa"))


def _jq_value(value: Any) -> str:
    if isinstance(value, str):
        return json.dumps(value, ensure_ascii=False)
    if isinstance(value, bool):
        return "true" if value else "false"
    return js_number(value)


def unary_tests_to_jq(entry: str, path: str) -> str:
    """A jq expression true when the value at `path` satisfies a decision table entry (5.5.1)"""
    v = jq_path(path)

    def test(t) -> str:
        kind = t[0]
        if kind == "any":
            return "true"
        if kind == "null":
            return f"{v} != null" if t[1] else f"{v} == null"
        if kind == "not":
            return "((" + " or ".join(test(x) for x in t[1]) + ") | not)"
        if kind == "compare":
            return f"{v} {t[1]} {_jq_value(t[2])}"
        if kind == "range":
            return f"({v} {'>=' if t[3] else '>'} {_jq_value(t[1])} and {v} {'<=' if t[4] else '<'} {_jq_value(t[2])})"
        if kind == "in":
            any_ = "(" + " or ".join(f"{v} == {_jq_value(x)}" for x in t[1]) + ")"
            return f"({any_} | not)" if t[2] else any_
        fn = {"contains": "contains", "starts": "startswith", "ends": "endswith"}.get(t[1], "test")
        return f"({v} != null and ({v} | tostring | {fn}({json.dumps(t[2], ensure_ascii=False)})))"

    tests = parse_unary_tests(entry)
    return test(tests[0]) if len(tests) == 1 else "(" + " or ".join(test(t) for t in tests) + ")"


# ---------------------------------------------------------------------------
# Decision table entries: FEEL unary tests
# ---------------------------------------------------------------------------


def _split_top(text: str) -> list[str]:
    parts, depth, quote, start, i = [], 0, False, 0, 0
    while i < len(text):
        c = text[i]
        if quote:
            if c == "\\":
                i += 2
                continue
            if c == '"':
                quote = False
            i += 1
            continue
        if c == '"':
            quote = True
        elif c in "([":
            depth += 1
        elif c in ")]":
            depth -= 1
        elif c == "," and depth == 0:
            parts.append(text[start:i])
            start = i + 1
        i += 1
    parts.append(text[start:])
    return [p.strip() for p in parts]


def _refuse_feel(text: str, reason: str):
    raise InterchangeError(f"FEEL \"{text}\" cannot be expressed in AWA's decision table entries (5.5.1): {reason}")


_TEMPORAL = re.compile(r'(date and time|date|time)\s*\(\s*("(?:[^"\\]|\\.)*")\s*\)')


def _feel_value(text: str, whole: str) -> tuple[str, Any]:
    t = text.strip()
    if re.fullmatch(r"-?(\d+(\.\d+)?|\.\d+)", t):
        value = float(t) if "." in t else int(t)
        return _awa_number(t, value), value
    if t in ("true", "false"):
        return t, t == "true"
    if t.startswith('"'):
        try:
            value, end = _read_string(t, 0, True)
        except InterchangeError:
            _refuse_feel(whole, "a string is not terminated")
        if end != len(t):
            _refuse_feel(whole, f'"{t}" is not a single value')
        return _awa_string(value, f'FEEL "{whole}"'), value
    temporal = _TEMPORAL.fullmatch(t)
    if temporal:
        inner = _read_string(temporal.group(2), 0, True)[0]
        return _awa_string(inner, f'FEEL "{whole}"'), inner
    if t == "null":
        _refuse_feel(whole, "null cannot be a bound")
    if re.match(r"[A-Za-z_]", t) and not re.search(r"[(+\-*/]", t):
        _refuse_feel(whole, f"{t} names a variable; AWA compares with values only")
    _refuse_feel(whole, f'"{t}" is an expression, not a value')


def _feel_test(p: str, whole: str) -> str:
    if p == "":
        _refuse_feel(whole, "a test is empty")
    if p == "null":
        return "null"
    q = re.fullmatch(r"\?\s*(<=|>=|!=|=|<|>)\s*([\s\S]+)", p)
    if q:
        op, rest = q.group(1), q.group(2)
        if op == "=":
            return "null" if rest.strip() == "null" else _feel_value(rest, whole)[0]
        if op == "!=" and rest.strip() == "null":
            return "not null"
        return f"{op} {_feel_value(rest, whole)[0]}"
    cmp = re.fullmatch(r"(<=|>=|!=|<|>|=)\s*([\s\S]+)", p)
    if cmp:
        op, rest = cmp.group(1), cmp.group(2)
        if rest.strip() == "null":
            if op == "=":
                return "null"
            if op == "!=":
                return "not null"
            _refuse_feel(whole, "null cannot be compared by order")
        return _feel_value(rest, whole)[0] if op == "=" else f"{op} {_feel_value(rest, whole)[0]}"
    rng = re.fullmatch(r"([\[\](])\s*([\s\S]+?)\s*\.\.\s*([\s\S]+?)\s*([\[\])])", p)
    if rng:
        low, high = _feel_value(rng.group(2), whole)[0], _feel_value(rng.group(3), whole)[0]
        return f"{'[' if rng.group(1) == '[' else '('}{low}..{high}{']' if rng.group(4) == ']' else ')'}"
    fn = re.fullmatch(r"(contains|starts with|ends with|matches)\s*\(\s*\?\s*,\s*([\s\S]+)\)", p)
    if fn:
        awa, value = _feel_value(fn.group(2), whole)
        if not isinstance(value, str):
            _refuse_feel(whole, f"{fn.group(1)} needs a string")
        name = fn.group(1)
        return f"contains({awa})" if name == "contains" else f"matches({awa})" if name == "matches" else f"{name} {awa}"
    if p.startswith("[") or p.startswith("{"):
        _refuse_feel(whole, "lists and contexts are not tests AWA has")
    if "?" in p:
        _refuse_feel(whole, 'only "? <operator> <value>" can use "?"')
    return _feel_value(p, whole)[0]


def feel_unary_to_awa(text: str | None) -> str:
    """Translate a FEEL unary test (a DMN input entry) into an AWA entry, or refuse with the reason"""
    t = (text or "").strip()
    if t in ("", "-"):
        return "-"
    negated = re.fullmatch(r"not\s*\(([\s\S]*)\)", t)
    if negated:
        inner = _split_top(negated.group(1))
        awa = "not null" if inner == ["null"] else "not(" + ", ".join(_feel_test(p, t) for p in inner) + ")"
    else:
        awa = ", ".join(_feel_test(p, t) for p in _split_top(t))
    error = validate_unary_tests(awa)
    if error:
        _refuse_feel(t, error)
    return awa


_ISO_DATE = re.compile(r"\d{4}-\d{2}-\d{2}")
_ISO_DATE_TIME = re.compile(r"\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})?")


def _feel_of(value: Any, column_type: str | None) -> str:
    if isinstance(value, str):
        if column_type == "date" and _ISO_DATE.fullmatch(value):
            return f"date({json.dumps(value, ensure_ascii=False)})"
        if column_type == "datetime" and _ISO_DATE_TIME.fullmatch(value):
            return f"date and time({json.dumps(value, ensure_ascii=False)})"
        return json.dumps(value, ensure_ascii=False)
    if isinstance(value, bool):
        return "true" if value else "false"
    return js_number(value)


def awa_unary_to_feel(entry: str, column_type: str | None = None) -> str:
    """Translate an AWA entry into a FEEL unary test (27.10). Every AWA entry has one"""
    try:
        tests = parse_unary_tests(entry)
    except UnaryTestError as error:
        raise InterchangeError(str(error)) from None
    single = len(tests) == 1

    def one(t, alone: bool) -> str:
        kind = t[0]
        if kind == "any":
            return "-"
        if kind == "null":
            return ("not(null)" if alone else "? != null") if t[1] else "null"
        if kind == "not":
            return "not(" + ", ".join(one(x, False) for x in t[1]) + ")"
        if kind == "compare":
            if t[1] == "==":
                return _feel_of(t[2], column_type)
            if t[1] == "!=":
                return f"not({_feel_of(t[2], column_type)})" if alone else f"? != {_feel_of(t[2], column_type)}"
            return f"{t[1]} {_feel_of(t[2], column_type)}"
        if kind == "range":
            return f"{'[' if t[3] else '('}{_feel_of(t[1], column_type)}..{_feel_of(t[2], column_type)}{']' if t[4] else ')'}"
        if kind == "in":
            if not t[2]:
                return ", ".join(_feel_of(v, column_type) for v in t[1])
            if alone:
                return "not(" + ", ".join(_feel_of(v, column_type) for v in t[1]) + ")"
            return "(" + " and ".join(f"? != {_feel_of(v, column_type)}" for v in t[1]) + ")"
        name = {"contains": "contains", "starts": "starts with", "ends": "ends with"}.get(t[1], "matches")
        return f"{name}(?, {json.dumps(t[2], ensure_ascii=False)})"

    return ", ".join(one(t, single) for t in tests)


def value_to_feel(value: Any) -> str:
    """FEEL literal expression for an AWA output entry. JSON values are FEEL literals"""
    return _json_text(value)


def _json_text(value: Any) -> str:
    if isinstance(value, bool) or value is None:
        return json.dumps(value)
    if isinstance(value, (int, float)):
        return js_number(value)
    if isinstance(value, str):
        return json.dumps(value, ensure_ascii=False)
    if isinstance(value, list):
        return "[" + ",".join(_json_text(v) for v in value) + "]"
    return "{" + ",".join(f"{json.dumps(k, ensure_ascii=False)}:{_json_text(v)}" for k, v in value.items()) + "}"


def feel_to_value(text: str | None) -> Any:
    """The AWA output value of a FEEL literal expression (a DMN output entry), or refuse"""
    t = (text or "").strip()
    if t == "":
        return None
    try:
        return json.loads(t)
    except ValueError:
        pass
    temporal = _TEMPORAL.fullmatch(t)
    if temporal:
        return _read_string(temporal.group(2), 0, True)[0]
    raise InterchangeError(f'FEEL "{t}" cannot be an AWA output entry: AWA outputs are values (numbers, strings, booleans, null, lists and objects), not expressions')
