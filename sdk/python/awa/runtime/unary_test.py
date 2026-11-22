"""
AWA decision table entries: unary tests (specification 5.5.1).

Python port of sdk/typescript/src/runtime/unary_test.ts. Both are held to
spec/conformance/unary-tests.json.
"""

import re
from functools import lru_cache
from typing import Any


class UnaryTestError(ValueError):
    def __init__(self, message: str, entry: str):
        super().__init__(f'Invalid decision entry "{entry}": {message}')
        self.entry = entry


_MISSING = object()
_NUMBER = re.compile(r"^-?\d+(\.\d+)?$")


def _split_top(text: str, entry: str) -> list[str]:
    """Split on commas that are outside quotes, brackets and parentheses."""
    parts, depth, quote, start = [], 0, "", 0
    for i, c in enumerate(text):
        if quote:
            if c == quote:
                quote = ""
            continue
        if c in "\"'":
            quote = c
        elif c in "([":
            depth += 1
        elif c in ")]":
            depth -= 1
        elif c == "," and depth == 0:
            parts.append(text[start:i])
            start = i + 1
    if quote:
        raise UnaryTestError("unterminated string", entry)
    if depth != 0:
        raise UnaryTestError("unbalanced brackets", entry)
    parts.append(text[start:])
    return [p.strip() for p in parts]


def _literal(text: str, entry: str) -> Any:
    t = text.strip()
    if t == "":
        raise UnaryTestError("a value is missing", entry)
    if len(t) >= 2 and t[0] == t[-1] and t[0] in "\"'":
        return t[1:-1]
    if t == "true":
        return True
    if t == "false":
        return False
    if _NUMBER.match(t):
        return float(t)
    if t[0] in "<>=!":
        raise UnaryTestError(f'"{t}" is not a value', entry)
    return t


def _quoted(text: str, entry: str) -> str:
    value = _literal(text, entry)
    if not isinstance(value, str):
        raise UnaryTestError("a string is expected", entry)
    return value


def _parse_test(text: str, entry: str) -> tuple:
    t = text.strip()
    lower = t.lower()
    if t == "":
        raise UnaryTestError("an empty test", entry)
    if lower == "null":
        return ("null", False)
    if lower == "not null":
        return ("null", True)

    call = re.match(r"^(not\s+in|in|contains|matches)\s*\((.*)\)$", t, re.IGNORECASE | re.DOTALL)
    if call:
        name = re.sub(r"\s+", " ", call.group(1).lower())
        if name in ("in", "not in"):
            return ("in", [_literal(v, entry) for v in _split_top(call.group(2), entry)], name == "not in")
        if name == "matches":
            pattern = _quoted(call.group(2), entry)
            try:
                re.compile(pattern)
            except re.error:
                raise UnaryTestError("the pattern is not a valid regular expression", entry)
            return ("text", "matches", pattern)
        return ("text", "contains", _quoted(call.group(2), entry))
    if lower.startswith("starts with "):
        return ("text", "starts", _quoted(t[12:], entry))
    if lower.startswith("ends with "):
        return ("text", "ends", _quoted(t[10:], entry))

    rng = re.match(r"^([\[(])(.+?)\.\.(.+)([\])])$", t, re.DOTALL)
    if rng:
        return ("range", _literal(rng.group(2), entry), _literal(rng.group(3), entry), rng.group(1) == "[", rng.group(4) == "]")

    compare = re.match(r"^(>=|<=|!=|<>|==|=|>|<)(.*)$", t, re.DOTALL)
    if compare:
        op = {"<>": "!=", "=": "=="}.get(compare.group(1), compare.group(1))
        return ("compare", op, _literal(compare.group(2), entry))

    return ("compare", "==", _literal(t, entry))


@lru_cache(maxsize=4096)
def parse_unary_tests(entry: str) -> tuple:
    """Parse an entry into its tests. Raises UnaryTestError if it is not valid."""
    t = (entry or "").strip()
    if t in ("", "-", "*"):
        return (("any",),)
    negated = re.match(r"^not\s*\((.*)\)$", t, re.IGNORECASE | re.DOTALL)
    if negated:
        return (("not", tuple(_parse_test(p, entry) for p in _split_top(negated.group(1), entry))),)
    return tuple(_parse_test(p, entry) for p in _split_top(t, entry))


def _missing(value: Any) -> bool:
    return value is _MISSING or value is None


def _text(value: Any) -> str:
    if isinstance(value, bool):
        return "true" if value else "false"
    if isinstance(value, float) and value.is_integer():
        return str(int(value))
    return str(value)


def _number(value: Any) -> float | None:
    if isinstance(value, bool) or value == "":
        return None
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def _equal(value: Any, expected: Any) -> bool:
    if _missing(value):
        return False
    if isinstance(expected, bool):
        return value is expected or value == _text(expected)
    if isinstance(expected, float):
        return _number(value) == expected
    return _text(value) == expected


def _order(value: Any, bound: Any) -> int | None:
    """-1, 0 or 1; None when the two cannot be ordered."""
    if _missing(value) or isinstance(value, bool) or isinstance(bound, bool):
        return None
    if isinstance(bound, float):
        n = _number(value)
        return None if n is None else (n > bound) - (n < bound)
    text = _text(value)
    return (text > bound) - (text < bound)


def _holds(test: tuple, value: Any) -> bool:
    kind = test[0]
    if kind == "any":
        return True
    if kind == "null":
        return _missing(value) != test[1]
    if kind == "not":
        return not any(_holds(inner, value) for inner in test[1])
    if kind == "in":
        return any(_equal(value, v) for v in test[1]) != test[2]
    if kind == "compare":
        _, op, expected = test
        if op == "==":
            return _equal(value, expected)
        if op == "!=":
            return not _equal(value, expected)
        o = _order(value, expected)
        if o is None:
            return False
        return {">": o > 0, ">=": o >= 0, "<": o < 0, "<=": o <= 0}[op]
    if kind == "range":
        _, low, high, low_closed, high_closed = test
        lo, hi = _order(value, low), _order(value, high)
        if lo is None or hi is None:
            return False
        return (lo >= 0 if low_closed else lo > 0) and (hi <= 0 if high_closed else hi < 0)
    if kind == "text":
        if _missing(value):
            return False
        text, fn, arg = _text(value), test[1], test[2]
        if fn == "contains":
            return arg in text
        if fn == "starts":
            return text.startswith(arg)
        if fn == "ends":
            return text.endswith(arg)
        return re.search(arg, text) is not None
    return False


def evaluate_unary_tests(entry: str, value: Any = _MISSING) -> bool:
    """Whether a value satisfies an entry: at least one of its tests holds."""
    return any(_holds(test, value) for test in parse_unary_tests(entry))


def validate_unary_tests(entry: str) -> str | None:
    """None if the entry is valid, otherwise why it is not."""
    try:
        parse_unary_tests(entry)
        return None
    except UnaryTestError as error:
        return str(error)


MISSING = _MISSING
