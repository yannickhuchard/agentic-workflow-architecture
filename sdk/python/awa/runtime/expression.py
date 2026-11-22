"""
AWA Condition Expression Language (ACEL).

Python port of the normative expression language defined in
docs/specification.md ("Condition Expressions"). Evaluation is total and
side-effect free; an invalid expression raises ExpressionError and never
silently evaluates to a value.
"""

import re
from typing import Any


class ExpressionError(ValueError):
    def __init__(self, message: str, expression: str):
        super().__init__(f'Invalid expression "{expression}": {message}')
        self.expression = expression


_TOKEN = re.compile(
    r"\s*(?:(?P<op>&&|\|\||==|!=|>=|<=|>|<|!|\(|\))"
    r"|(?P<str>\"[^\"]*\"|'[^']*')"
    r"|(?P<num>-?\d+(?:\.\d+)?)"
    r"|(?P<word>[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*))"
)
_MISSING = object()


def _tokenize(src: str) -> list[tuple[str, Any]]:
    tokens: list[tuple[str, Any]] = []
    pos = 0
    while pos < len(src):
        if src[pos:].strip() == "":
            break
        match = _TOKEN.match(src, pos)
        if not match:
            raise ExpressionError(f'unexpected character "{src[pos:].strip()[:1]}"', src)
        kind = match.lastgroup
        text = match.group(kind)
        if kind == "str":
            tokens.append(("str", text[1:-1]))
        elif kind == "num":
            tokens.append(("num", float(text) if "." in text else int(text)))
        else:
            tokens.append((kind, text))
        pos = match.end()
    return tokens


def _resolve(data: Any, path: str) -> Any:
    current = data
    for segment in path.split("."):
        if not isinstance(current, dict) or segment not in current:
            return _MISSING
        current = current[segment]
    return current


def _typeof(value: Any) -> str:
    if value is _MISSING:
        return "undefined"
    if value is None:
        return "null"
    if isinstance(value, bool):
        return "boolean"
    if isinstance(value, (int, float)):
        return "number"
    if isinstance(value, str):
        return "string"
    if isinstance(value, list):
        return "array"
    return "object"


def _to_text(value: Any) -> str:
    if isinstance(value, bool):
        return "true" if value else "false"
    return str(value)


class _Parser:
    def __init__(self, tokens: list[tuple[str, Any]], src: str, data: dict[str, Any]):
        self.tokens, self.src, self.data, self.pos = tokens, src, data, 0

    def _peek(self) -> tuple[str, Any] | None:
        return self.tokens[self.pos] if self.pos < len(self.tokens) else None

    def _next(self) -> tuple[str, Any] | None:
        token = self._peek()
        self.pos += 1
        return token

    def _is_op(self, value: str) -> bool:
        return self._peek() == ("op", value)

    def _fail(self, message: str) -> None:
        raise ExpressionError(message, self.src)

    def parse(self) -> bool:
        if not self.tokens:
            self._fail("empty expression")
        value = self._or()
        if self.pos < len(self.tokens):
            self._fail("unexpected trailing tokens")
        return value

    def _or(self) -> bool:
        value = self._and()
        while self._is_op("||"):
            self._next()
            rhs = self._and()
            value = value or rhs
        return value

    def _and(self) -> bool:
        value = self._unary()
        while self._is_op("&&"):
            self._next()
            rhs = self._unary()
            value = value and rhs
        return value

    def _unary(self) -> bool:
        if self._is_op("!"):
            self._next()
            return not self._unary()
        if self._is_op("("):
            self._next()
            value = self._or()
            if not self._is_op(")"):
                self._fail('missing ")"')
            self._next()
            return value
        return self._test()

    def _test(self) -> bool:
        first = self._next()
        if not first or first[0] != "word":
            self._fail("expected a property path")
        head = first[1]

        if head == "typeof":
            path = self._next()
            if not path or path[0] != "word":
                self._fail('expected a property path after "typeof"')
            if not self._is_op("=="):
                self._fail('expected "==" after "typeof <path>"')
            self._next()
            type_name = self._next()
            if not type_name or type_name[0] not in ("word", "str"):
                self._fail("expected a type name")
            return _typeof(_resolve(self.data, path[1])) == type_name[1]

        after = self._peek()
        if after == ("word", "exists"):
            self._next()
            return _resolve(self.data, head) is not _MISSING

        if after and after[0] == "op" and after[1] in ("==", "!=", ">=", "<=", ">", "<"):
            self._next()
            literal = self._next()
            if not literal or literal[0] == "op":
                self._fail(f'expected a literal after "{after[1]}"')
            return self._compare(_resolve(self.data, head), after[1], self._literal(literal))

        value = _resolve(self.data, head)
        return value is not _MISSING and bool(value)

    @staticmethod
    def _literal(token: tuple[str, Any]) -> Any:
        kind, value = token
        if kind in ("num", "str"):
            return value
        return {"true": True, "false": False, "null": None}.get(value, value)

    @staticmethod
    def _number(value: Any) -> float | None:
        if isinstance(value, bool):
            return float(value)
        try:
            return float(value)
        except (TypeError, ValueError):
            return None

    def _compare(self, actual: Any, op: str, expected: Any) -> bool:
        missing = actual is _MISSING or actual is None
        if op in ("==", "!="):
            if isinstance(expected, bool):
                equal = actual is expected or actual == _to_text(expected)
            elif isinstance(expected, (int, float)):
                equal = not missing and actual != "" and self._number(actual) == expected
            elif expected is None:
                equal = missing
            else:
                equal = not missing and _to_text(actual) == expected
            return equal if op == "==" else not equal
        if missing:
            return False
        if isinstance(expected, (int, float)):
            left: Any = self._number(actual)
            if left is None:
                return False
        else:
            left = _to_text(actual)
        return {">": left > expected, ">=": left >= expected, "<": left < expected, "<=": left <= expected}[op]


def evaluate_expression(expression: str, data: dict[str, Any]) -> bool:
    """Evaluate a condition expression. Raises ExpressionError if it is not valid ACEL."""
    return bool(_Parser(_tokenize(expression), expression, data).parse())


def resolve_path(data: dict[str, Any], path: str, default: Any = None) -> Any:
    """The value at a dotted path in the data, or `default` when the path leads nowhere"""
    value = _resolve(data, path)
    return default if value is _MISSING else value
