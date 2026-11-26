"""
Interchange with BPMN 2.0, DMN and CNCF Serverless Workflow (specification section 27):
identifiers, namespaces, errors, and the residual that keeps an export lossless.

Python port of sdk/typescript/src/interchange/common.ts.
"""

from __future__ import annotations

import copy
import json
import re
import uuid
from dataclasses import dataclass, field
from typing import Any

AWA_INTERCHANGE_NAMESPACE = "https://awa.io/schema/interchange/1.1"
AWA_EXPRESSION_LANGUAGE = "https://awa.io/schema/expression/1.1"
AWA_DECISION_ROUTE_LANGUAGE = "https://awa.io/schema/decision-route/1.1"
FEEL_LANGUAGE = "https://www.omg.org/spec/DMN/20191111/FEEL/"
BPMN_MODEL_NAMESPACE = "http://www.omg.org/spec/BPMN/20100524/MODEL"
BPMNDI_NAMESPACE = "http://www.omg.org/spec/BPMN/20100524/DI"
DC_NAMESPACE = "http://www.omg.org/spec/DD/20100524/DC"
DI_NAMESPACE = "http://www.omg.org/spec/DD/20100524/DI"
XSI_NAMESPACE = "http://www.w3.org/2001/XMLSchema-instance"
DMN13_NAMESPACE = "https://www.omg.org/spec/DMN/20191111/MODEL/"
DMN_NAMESPACES = [
    "http://www.omg.org/spec/DMN/20151101/dmn.xsd",
    "http://www.omg.org/spec/DMN/20180521/MODEL/",
    DMN13_NAMESPACE,
    "https://www.omg.org/spec/DMN/20211108/MODEL/",
    "https://www.omg.org/spec/DMN/20230324/MODEL/",
]

#: uuid5(NAMESPACE_URL, AWA_INTERCHANGE_NAMESPACE): the namespace of identifiers derived from BPMN and DMN identifiers
INTERCHANGE_ID_NAMESPACE = uuid.UUID("84c7aa15-559c-5fc6-abf7-39cad8e0d785")

_UUID = re.compile(r"^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$")


class InterchangeError(ValueError):
    """A BPMN, DMN or Serverless Workflow document that cannot be read or written without changing its meaning"""

    code = "INTERCHANGE_ERROR"


@dataclass
class InterchangeWarning:
    """Something an import or export left out that does not change how a run behaves"""

    message: str
    element: str | None = None


def xml_id(value: str) -> str:
    """The BPMN or DMN identifier of an AWA object: an XML ID cannot start with a digit"""
    return f"_{value}"


def awa_id(element_id: str, document_id: str, suffix: str = "") -> str:
    """The AWA identifier of an element (27.2)"""
    if not suffix and element_id.startswith("_") and _UUID.match(element_id[1:]):
        return element_id[1:]
    return str(uuid.uuid5(INTERCHANGE_ID_NAMESPACE, f"{document_id}/{element_id}{suffix}"))


def is_uuid(value: Any) -> bool:
    return isinstance(value, str) and bool(_UUID.match(value))


def is_object(value: Any) -> bool:
    return isinstance(value, dict)


def json_equal(a: Any, b: Any) -> bool:
    """Deep equality of JSON values; the order of an object's properties does not matter"""
    if isinstance(a, bool) or isinstance(b, bool):
        return type(a) is type(b) and a == b
    if isinstance(a, (int, float)) and isinstance(b, (int, float)):
        return a == b
    if isinstance(a, list) and isinstance(b, list):
        return len(a) == len(b) and all(json_equal(x, y) for x, y in zip(a, b))
    if isinstance(a, dict) and isinstance(b, dict):
        return a.keys() == b.keys() and all(json_equal(a[k], b[k]) for k in a)
    return type(a) is type(b) and a == b


def clone(value: Any) -> Any:
    return copy.deepcopy(value)


def to_json(value: Any) -> str:
    """JSON text as the reference implementation writes it"""
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"))


# ---------------------------------------------------------------------------
# The residual (27.7)
# ---------------------------------------------------------------------------


@dataclass
class Residual:
    set: dict[str, Any] = field(default_factory=dict)
    absent: list[list[str]] = field(default_factory=list)

    def is_empty(self) -> bool:
        return not self.set and not self.absent


def residual(original: dict[str, Any], native: dict[str, Any]) -> Residual:
    """What must be added to, and removed from, `native` to obtain `original`"""
    out = Residual()
    for key, value in original.items():
        if key not in native:
            out.set[key] = value
            continue
        if json_equal(value, native[key]):
            continue
        if isinstance(value, dict) and isinstance(native[key], dict):
            inner = residual(value, native[key])
            if inner.set:
                out.set[key] = inner.set
            out.absent.extend([key, *path] for path in inner.absent)
        else:
            out.set[key] = value
    out.absent.extend([key] for key in native if key not in original)
    return out


def apply_residual(target: dict[str, Any], r: Residual) -> dict[str, Any]:
    """Merge `set` over `target` (objects key by key, any other value replaces) and remove the `absent` paths"""
    _merge_into(target, r.set)
    for path in r.absent:
        node: Any = target
        for key in path[:-1]:
            node = node.get(key) if isinstance(node, dict) else None
        if isinstance(node, dict):
            node.pop(path[-1], None)
    return target


def _merge_into(target: dict[str, Any], values: dict[str, Any]) -> None:
    for key, value in values.items():
        if isinstance(value, dict) and isinstance(target.get(key), dict):
            _merge_into(target[key], value)
        else:
            target[key] = clone(value)


#: Properties of the residual written as their own extension element rather than inside awa:properties
NAMED_EXTENSIONS = {
    "outcome_contract": "outcomeContract",
    "verification": "verification",
    "retry": "retry",
    "tools": "tools",
    "context_bindings": "contextBindings",
    "contexts": "contexts",
    "ai_model_config": "modelConfig",
    "decision_model": "decisionModel",
    "decision_engine": "decisionEngine",
    "sla": "sla",
    "knowledge": "knowledge",
}
_BY_ELEMENT = {v: k for k, v in NAMED_EXTENSIONS.items()}


def residual_extensions(r: Residual) -> list[tuple[str, str]]:
    """The extension elements that carry a residual: (local name, JSON text)"""
    out: list[tuple[str, str]] = []
    rest: dict[str, Any] = {}
    for key, value in r.set.items():
        if key in NAMED_EXTENSIONS:
            out.append((NAMED_EXTENSIONS[key], to_json(value)))
        else:
            rest[key] = value
    if rest:
        out.insert(0, ("properties", to_json(rest)))
    if r.absent:
        out.append(("absent", to_json(r.absent)))
    return out


def read_residual(extensions: list[tuple[str, str]], where: str) -> Residual:
    """Read back a residual from extension elements. Unknown awa: elements are refused"""
    r = Residual()
    for name, body in extensions:
        if name == "envelope":
            continue
        try:
            value = json.loads(body)
        except ValueError:
            raise InterchangeError(f"{where}: the content of awa:{name} is not JSON") from None
        if name == "properties":
            if not isinstance(value, dict):
                raise InterchangeError(f"{where}: awa:properties must hold a JSON object")
            r.set.update(value)
        elif name == "absent":
            if not isinstance(value, list) or not all(isinstance(p, list) and p and all(isinstance(k, str) for k in p) for p in value):
                raise InterchangeError(f"{where}: awa:absent must hold a list of property paths")
            r.absent.extend(value)
        elif name in _BY_ELEMENT:
            r.set[_BY_ELEMENT[name]] = value
        else:
            raise InterchangeError(f"{where}: awa:{name} is not an element of the AWA interchange namespace")
    return r


def token_name(text: str, limit: int = 64) -> str:
    """A name usable where only letters, digits, "-" and "_" are allowed"""
    cleaned = re.sub(r"[^A-Za-z0-9_-]", "_", text)[:limit]
    return cleaned or "_"


def js_number(value: int | float) -> str:
    """A number as JavaScript writes it, so that both SDKs write the same text"""
    if isinstance(value, bool):
        return "true" if value else "false"
    if isinstance(value, int):
        return str(value)
    if value != value or value in (float("inf"), float("-inf")):
        return "null"
    if value.is_integer() and abs(value) < 1e21:
        return str(int(value))
    text = repr(value)
    if "e" in text:
        mantissa, exponent = text.split("e")
        sign = "-" if exponent.startswith("-") else "+"
        text = f"{mantissa}e{sign}{exponent.lstrip('+-').lstrip('0') or '0'}"
    return text
