"""
AWA Guardrails (specification section 31)

A guardrail checks what goes into an AI agent or a tool and what comes out, at
run time, and takes a declared action when its check finds something: block,
redact, retry with feedback, escalate to a person, or warn.

Guardrails are declared on the deployment, the workflow, a role, an activity or
a tool. This module finds the ones that apply, runs their checks in order (31.6)
and records each one that acts as `guardrail.triggered`, with the positions and
categories of what it found and never the text (31.7). The engine decides what
the action means for the run. It follows the TypeScript reference
(sdk/typescript/src/runtime/guardrails.ts).
"""

from __future__ import annotations

import copy
import json
import math
import re
from dataclasses import dataclass, field
from typing import Any, Callable

from awa.runtime.journal import canonical_json, public_payload
from awa.types import Activity, Guardrail, Role, ToolDefinition, Workflow

GUARDRAIL_BLOCKED = "GUARDRAIL_BLOCKED"
GUARDRAIL_ERROR = "GUARDRAIL_ERROR"

STAGES = ("input", "output", "tool_call", "tool_result")
TOOL_STAGES = ("tool_call", "tool_result")

# A classifier the deployment registers for `classifier` checks (31.8). It is called with
# {"value", "stage", "guardrail", "config"} and returns {"flagged": bool, "categories": [...]}.
GuardrailClassifier = Callable[[dict[str, Any]], dict[str, Any]]


# ---------------------------------------------------------------------------
# Built-in patterns (31.4.1, 31.4.2). ASCII only, so that ECMAScript and Python read them the same way.

@dataclass
class _Pattern:
    category: str
    pattern: str
    ignore_case: bool = False
    accept: Callable[[str], bool] | None = None


def _digits(text: str) -> str:
    return re.sub(r"[^0-9]", "", text)


def _luhn(text: str) -> bool:
    d = _digits(text)
    total = 0
    for i, ch in enumerate(reversed(d)):
        n = int(ch)
        if i % 2 == 1:
            n *= 2
            if n > 9:
                n -= 9
        total += n
    return 13 <= len(d) <= 19 and total % 10 == 0


def _iban_checksum(text: str) -> bool:
    compact = text.replace(" ", "")
    if not 15 <= len(compact) <= 34:
        return False
    moved = compact[4:] + compact[:4]
    remainder = 0
    for ch in moved:
        value = str(ord(ch) - 55) if "A" <= ch <= "Z" else ch
        for digit in value:
            remainder = (remainder * 10 + int(digit)) % 97
    return remainder == 1


def _after_prefix(text: str) -> str:
    return _digits(re.sub(r"^[^0-9+]*(?:\+|00)", "", text, count=1))


PERSONAL_DATA_PATTERNS: dict[str, list[_Pattern]] = {
    "email": [_Pattern("email", r"[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}")],
    "iban": [_Pattern("iban", r"(?<![A-Za-z0-9])[A-Z]{2}[0-9]{2}(?: ?[A-Z0-9]{4}){2,7}(?: ?[A-Z0-9]{1,4})?(?![A-Za-z0-9])",
                      accept=_iban_checksum)],
    "credit_card": [_Pattern("credit_card", r"(?<![0-9])[0-9](?:[ -]?[0-9]){12,18}(?![0-9])", accept=_luhn)],
    "phone": [
        _Pattern("phone", r"(?<![A-Za-z0-9+])(?:\+|00)[1-9][0-9]{0,3}(?:[ .-]?\(?[0-9]{1,4}\)?){2,6}(?![A-Za-z0-9])",
                 accept=lambda text: 8 <= len(_after_prefix(text)) <= 15),
        _Pattern("phone", r"(?<![A-Za-z0-9])\(?[2-9][0-9]{2}\)?[ .-][0-9]{3}[ .-][0-9]{4}(?![A-Za-z0-9])"),
        _Pattern("phone", r"(?<![A-Za-z0-9])\(?0[1-9][0-9]{0,3}\)?(?:[ .-]?[0-9]{2,4}){2,4}(?![A-Za-z0-9])",
                 accept=lambda text: 9 <= len(_digits(text)) <= 11),
    ],
}

# The order in which personal data categories are looked for (31.4)
PERSONAL_DATA_CATEGORIES = ("email", "iban", "credit_card", "phone")

_S = r"[ \t\r\n]"
# Prompt injection markers (31.4.2), compared without regard to case. A floor, not a defence.
INJECTION_MARKERS: dict[str, str] = {
    "ignore_instructions": rf"(?<![A-Za-z])(?:ignore|disregard|forget|override){_S}+(?:all{_S}+|any{_S}+)?(?:(?:the|your|my|these){_S}+)?(?:previous|prior|above|earlier|preceding|original){_S}+(?:instructions|directions|prompts?|rules|guidelines)",
    "new_instructions": rf"(?<![A-Za-z])(?:new|updated|revised|real|actual){_S}+(?:system{_S}+)?instructions{_S}*:",
    "reveal_instructions": rf"(?<![A-Za-z])(?:reveal|print|show|repeat|output|leak){_S}+(?:me{_S}+)?(?:the|your){_S}+(?:system{_S}+prompt|hidden{_S}+instructions|initial{_S}+instructions)",
    "jailbreak_mode": rf"(?<![A-Za-z])(?:(?:developer|god|jailbreak|unrestricted){_S}+mode|do{_S}+anything{_S}+now)",
    "chat_template_token": r"<\|(?:im_start|im_end|system|user|assistant|endoftext)\|>|\[/?INST\]|<</?SYS>>",
    "role_header": r"(?:^|[\r\n])[ \t]*(?:#{1,6}[ \t]*)?(?:system|assistant)[ \t]*:",
}

_REDACTABLE = {"personal_data", "deny_list", "prompt_injection"}
ACTIONS_AT: dict[str, set[str]] = {
    "input": {"block", "redact", "escalate", "warn"},
    "output": {"block", "redact", "retry_with_feedback", "escalate", "warn"},
    "tool_call": {"block", "redact", "warn"},
    "tool_result": {"block", "redact", "warn"},
}


def _patterns_of(check: dict[str, Any]) -> list[_Pattern]:
    """The patterns a pattern check looks for, in the order of 31.4"""
    customs = [_Pattern(p["name"], p["pattern"]) for p in check.get("patterns") or []]
    kind = check["kind"]
    if kind == "personal_data":
        wanted = check.get("categories")
        wanted = list(PERSONAL_DATA_CATEGORIES) if wanted is None else wanted
        return [p for c in PERSONAL_DATA_CATEGORIES if c in wanted for p in PERSONAL_DATA_PATTERNS[c]] + customs
    if kind == "deny_list":
        whole = check.get("whole_words") is not False
        terms = [_Pattern("term", rf"(?<![A-Za-z0-9_]){re.escape(t)}(?![A-Za-z0-9_])" if whole else re.escape(t), ignore_case=True)
                 for t in check.get("terms") or [] if t]
        return terms + customs
    if kind == "prompt_injection":
        ids = check.get("markers")
        ids = list(INJECTION_MARKERS) if ids is None else ids
        return [_Pattern(i, INJECTION_MARKERS[i], ignore_case=True) for i in INJECTION_MARKERS if i in ids] + customs
    return []


_compiled: dict[tuple[str, bool], re.Pattern[str]] = {}


def _regex(pattern: str, ignore_case: bool) -> re.Pattern[str]:
    key = (pattern, ignore_case)
    if key not in _compiled:
        _compiled[key] = re.compile(pattern, re.IGNORECASE if ignore_case else 0)
    return _compiled[key]


def _segment(key: Any) -> str:
    """JSON Pointer segment (RFC 6901)"""
    return str(key).replace("~", "~0").replace("/", "~1")


def _pointer(path: str) -> str:
    return "".join(f"/{_segment(part)}" for part in path.split("."))


_MISSING = object()


def _lookup(value: Any, path: str) -> Any:
    """The value at a path (6.2) of object properties, or _MISSING. Arrays are not entered"""
    current = value
    for key in path.split("."):
        if not isinstance(current, dict) or key not in current:
            return _MISSING
        current = current[key]
    return current


def _strings_of(value: Any, base: str, out: list[tuple[str, str]]) -> list[tuple[str, str]]:
    """Every string in a value, with its JSON Pointer, in document order"""
    if isinstance(value, str):
        out.append((base, value))
    elif isinstance(value, list):
        for i, item in enumerate(value):
            _strings_of(item, f"{base}/{i}", out)
    elif isinstance(value, dict):
        for key, item in value.items():
            _strings_of(item, f"{base}/{_segment(key)}", out)
    return out


def _fields_root(value: Any, stage: str) -> tuple[Any, str]:
    """What the paths of `fields` start from (31.2): at stage output the outcome (11.1), with its pointer within the whole value; otherwise the value"""
    if stage != "output":
        return value, ""
    inner = value.get("output") if isinstance(value, dict) else None
    if isinstance(inner, dict):
        return inner, "/output"
    return _outcome_part(value), ""


def _scanned(value: Any, stage: str, fields: list[str] | None) -> list[tuple[str, str]]:
    """The strings a pattern or size check looks at: those under `fields`, or all of them. Paths stay within the whole value"""
    if not fields:
        return _strings_of(value, "", [])
    root, base = _fields_root(value, stage)
    out: list[tuple[str, str]] = []
    for path in fields:
        found = _lookup(root, path)
        if found is not _MISSING:
            _strings_of(found, base + _pointer(path), out)
    return out


def find_matches(text: str, patterns: list[_Pattern]) -> list[dict[str, Any]]:
    """The matches of patterns in a string, the overlapping ones dropped, in order of start"""
    kept: list[dict[str, Any]] = []
    for p in patterns:
        for m in _regex(p.pattern, p.ignore_case).finditer(text):
            if not m.group(0):
                continue
            if p.accept and not p.accept(m.group(0)):
                continue
            start, end = m.start(), m.end()
            if any(start < k["end"] and k["start"] < end for k in kept):
                continue
            kept.append({"category": p.category, "start": start, "end": end})
    return sorted(kept, key=lambda k: k["start"])


# ---------------------------------------------------------------------------
# Checks

class CheckError(Exception):
    """A check that could not be carried out. The guardrail fails closed (31.5)"""


def _outcome_part(value: Any) -> Any:
    """The part of a value the contract would judge (11.1), for checks that apply to the outcome at stage output"""
    if isinstance(value, dict):
        inner = value.get("output")
        if isinstance(inner, dict):
            return inner
        return {k: v for k, v in value.items() if k != "_context_writes"}
    return value


def _categories_found(categories: Any, declared: list[str] | None = None) -> list[dict[str, Any]]:
    named = [c for c in categories if isinstance(c, str) and c] if isinstance(categories, list) else []
    kept = ["flagged" if declared is not None and c not in declared else c for c in named] or ["flagged"]
    return [{"category": c} for c in dict.fromkeys(kept)]


def run_check(guardrail: Guardrail, stage: str, value: Any, context: "GuardrailContext") -> list[dict[str, Any]]:
    """Run one check. Deterministic except for `model` and `classifier`. Raises CheckError when it cannot be carried out"""
    check = guardrail.check
    kind = check["kind"]
    judged = _outcome_part(value) if stage == "output" else value
    if kind in _REDACTABLE:
        patterns = _patterns_of(check)
        return [{"category": m["category"], "path": path, "start": m["start"], "end": m["end"]}
                for path, text in _scanned(value, stage, guardrail.fields) for m in find_matches(text, patterns)]
    if kind == "size":
        characters = sum(len(text) for _, text in _scanned(value, stage, guardrail.fields))
        findings = []
        if check.get("max_characters") is not None and characters > check["max_characters"]:
            findings.append({"category": "max_characters", "limit": check["max_characters"], "actual": characters})
        tokens = math.ceil(characters / 4)
        if check.get("max_tokens") is not None and tokens > check["max_tokens"]:
            findings.append({"category": "max_tokens", "limit": check["max_tokens"], "actual": tokens})
        return findings
    if kind == "json_schema":
        try:
            from jsonschema import Draft202012Validator, FormatChecker
        except ImportError:
            raise CheckError("the 'jsonschema' package is not installed") from None
        validator = Draft202012Validator(check["schema"], format_checker=FormatChecker())
        return [{"category": "schema", "path": "".join(f"/{_segment(p)}" for p in error.absolute_path), "keyword": error.validator}
                for error in validator.iter_errors(judged)]
    if kind == "allowed_values":
        found = _lookup(judged, check["path"])
        allowed = found is not _MISSING and any(canonical_json(v) == canonical_json(found) for v in check["values"])
        return [] if allowed else [{"category": "allowed_values", "path": _pointer(check["path"])}]
    if kind == "topic":
        from awa.runtime.expression import evaluate_expression
        on_topic = isinstance(judged, dict) and any(evaluate_expression(e, judged) for e in check["allow"])
        return [] if on_topic else [{"category": "off_topic"}]
    if kind == "classifier":
        classifier = (context.classifiers or {}).get(check["name"])
        if classifier is None:
            raise CheckError(f'No guardrail classifier "{check["name"]}" is registered')
        try:
            verdict = classifier({"value": value, "stage": stage, "guardrail": guardrail, "config": check.get("config")})
        except Exception as error:
            raise CheckError(f'Guardrail classifier "{check["name"]}" failed: {error}') from None
        if not isinstance(verdict, dict) or not isinstance(verdict.get("flagged"), bool):
            raise CheckError(f'Guardrail classifier "{check["name"]}" gave no verdict')
        return _categories_found(verdict.get("categories")) if verdict["flagged"] else []
    if kind == "model":
        return _model_check(guardrail, check, value, context)
    raise CheckError(f'Unknown check kind "{kind}"')


def _model_check(guardrail: Guardrail, check: dict[str, Any], value: Any, context: "GuardrailContext") -> list[dict[str, Any]]:
    from awa.runtime.models import ModelRequest
    requested = check.get("model") or context.default_model
    if context.router is None or not requested:
        raise CheckError("No model is available for the guard model check")
    label = guardrail.name or str(guardrail.id)
    system = ("You are a guardrail. You are given a JSON value and a description of what to flag. "
              'Answer with a JSON object only: {"flagged": true or false, "categories": [the categories that apply]}. '
              f"What to flag: {check['instructions']}"
              + (f" Categories: {', '.join(check['categories'])}." if check.get("categories") else ""))
    try:
        routed = context.router.generate(requested, ModelRequest(
            system=system, prompt=canonical_json(value), json=True, temperature=0, max_output_tokens=200))
    except Exception as error:
        _record_route(context, getattr(error, "route", None))
        raise CheckError(f"The guard model could not be reached: {error}") from None
    model = {"provider": routed.model.provider.id, "id": routed.model.model, "requested": requested, "source": "guardrail"}
    if routed.model.tier:
        model["tier"] = routed.model.tier
    context.record("meta.recorded", {
        "subject": "model_selection",
        "decision": f"Use model {routed.model.provider.id}:{routed.model.model}",
        "rationale": (f'Guardrail "{label}" names this model.' if check.get("model")
                      else f'Guardrail "{label}" names no model, so the engine default applies.')
                     + (f' The reference is the capability tier "{routed.model.tier}", which this deployment maps to that model.'
                        if routed.model.tier else ""),
        "model": model,
    }, "meta")
    _record_route(context, routed.route)
    text = re.sub(r"^```(?:json)?\s*|\s*```$", "", routed.response.text.strip())
    try:
        reply = json.loads(text)
    except ValueError:
        raise CheckError("The guard model did not answer with a JSON object") from None
    if not isinstance(reply, dict) or not isinstance(reply.get("flagged"), bool):
        raise CheckError("The guard model did not say whether the value is flagged")
    return _categories_found(reply.get("categories"), check.get("categories")) if reply["flagged"] else []


def _record_route(context: "GuardrailContext", route: Any) -> None:
    if not route or not any(r.outcome != "used" for r in route):
        return
    used = next((r for r in route if r.outcome == "used"), None)
    context.record("meta.recorded", {
        "subject": "model_route",
        "decision": f"Route to {used.ref}" if used else "No model could serve the request",
        "rationale": ". ".join(f"{r.ref} was {'skipped' if r.outcome == 'skipped' else 'tried and failed'}{f': {r.reason}' if r.reason else ''}"
                               for r in route if r.outcome != "used") + ".",
        "route": [{"ref": r.ref, "outcome": r.outcome, **({"reason": r.reason} if r.reason else {})} for r in route],
    }, "meta")


# ---------------------------------------------------------------------------
# Redaction

def _pointer_parts(pointer: str) -> list[str]:
    return [] if pointer == "" else [s.replace("~1", "/").replace("~0", "~") for s in pointer[1:].split("/")]


def redact(value: Any, findings: list[dict[str, Any]], replacement: str | None = None) -> Any:
    """The value with every match replaced by the guardrail's replacement (31.5). The original is not changed"""
    replacement = "[REDACTED:{category}]" if replacement is None else replacement
    root = copy.deepcopy(value)
    by_path: dict[str, list[dict[str, Any]]] = {}
    for f in findings:
        if "path" in f and "start" in f and "end" in f:
            by_path.setdefault(f["path"], []).append(f)

    def swap(text: str, matches: list[dict[str, Any]]) -> str:
        for m in sorted(matches, key=lambda m: m["start"], reverse=True):
            text = text[:m["start"]] + replacement.replace("{category}", m["category"]) + text[m["end"]:]
        return text

    for path, matches in by_path.items():
        parts = _pointer_parts(path)
        if not parts:
            if isinstance(root, str):
                root = swap(root, matches)
            continue
        parent = root
        for part in parts[:-1]:
            parent = parent[int(part)] if isinstance(parent, list) else parent.get(part) if isinstance(parent, dict) else None
        last = parts[-1]
        if isinstance(parent, list) and isinstance(parent[int(last)], str):
            parent[int(last)] = swap(parent[int(last)], matches)
        elif isinstance(parent, dict) and isinstance(parent.get(last), str):
            parent[last] = swap(parent[last], matches)
    return root


# ---------------------------------------------------------------------------
# Which guardrails apply, and in which order (31.1, 31.6)

@dataclass
class GuardrailContext:
    """What the engine gives the guardrails for one check"""
    # record(type, data, level="execution"), bound to the token, the node and the attempt
    record: Callable[..., None]
    router: Any = None
    # The engine default model reference (12.3)
    default_model: str | None = None
    classifiers: dict[str, GuardrailClassifier] | None = None
    # At tool_call and tool_result: the call
    tool: ToolDefinition | None = None
    call_id: str | None = None


@dataclass
class GuardrailStop:
    """A guardrail that stopped evaluation at a stage, and what it asks the engine to do"""
    guardrail: Guardrail
    source: str
    action: str
    code: str
    message: str
    categories: list[str] = field(default_factory=list)


@dataclass
class GuardrailResult:
    # The value as the guardrails left it: redacted where one redacted
    value: Any
    stop: GuardrailStop | None = None


def _as_guardrail(g: Any) -> Guardrail:
    return g if isinstance(g, Guardrail) else Guardrail.model_validate(g)


class GuardrailSet:
    """The guardrails of a document and of the deployment, applied in the order of 31.6"""

    def __init__(self, workflow: Workflow, deployment: list[Any] | None = None,
                 role_of: Callable[[Activity], Role | None] | None = None) -> None:
        self.workflow = workflow
        # A deployment's guardrails are held to the rules of a document's (31.11): an inconsistent one is refused here
        self.deployment = [_as_guardrail(g) for g in deployment or []]
        seen: set[str] = set()
        issues = [i for g in self.deployment for i in check_guardrail(g, f"deployment.guardrails[{g.id}]", False, seen)]
        if issues:
            raise ValueError("Invalid deployment guardrails: " + "; ".join(message for _, message, _ in issues))
        roles = {str(r.id): r for r in workflow.roles}
        self.role_of = role_of or (lambda activity: roles.get(str(activity.role_id)))

    @property
    def empty(self) -> bool:
        """Whether any guardrail is declared at all. A run without one behaves exactly as before"""
        return (not self.deployment and not self.workflow.guardrails
                and not any(r.guardrails for r in self.workflow.roles)
                and not any(a.guardrails or any(t.guardrails for t in a.tools) for a in self.workflow.activities))

    def applicable(self, stage: str, activity: Activity, tool: ToolDefinition | None = None) -> list[tuple[Guardrail, str]]:
        actor = activity.actor_type.value if hasattr(activity.actor_type, "value") else str(activity.actor_type)

        def scoped(items: list[Guardrail] | None, source: str) -> list[tuple[Guardrail, str]]:
            out = []
            for g in items or []:
                types = [t.value if hasattr(t, "value") else str(t) for t in g.actor_types] if g.actor_types is not None else ["ai_agent"]
                if stage in g.stages and actor in types and (tool is None or g.tools is None or tool.name in g.tools):
                    out.append((g, source))
            return out

        role = self.role_of(activity)
        own = [(g, "tool") for g in (tool.guardrails or []) if stage in g.stages] if tool is not None and stage in TOOL_STAGES else []
        return [*scoped(self.deployment, "deployment"), *scoped(self.workflow.guardrails, "workflow"),
                *scoped(role.guardrails if role else None, "role"), *scoped(activity.guardrails, "activity"), *own]

    def apply(self, stage: str, activity: Activity, value: Any, context: GuardrailContext) -> GuardrailResult:
        """
        Apply the guardrails of a stage to a value, one at a time (31.6). Each sees the value as the ones before
        left it; warn and redact go on, block, retry_with_feedback and escalate stop. Each that finds something is recorded.
        """
        current = value
        for guardrail, source in self.applicable(stage, activity, context.tool):
            label = guardrail.name or str(guardrail.id)
            base: dict[str, Any] = {"guardrail_id": str(guardrail.id), **({"name": guardrail.name} if guardrail.name else {}),
                                    "source": source, "stage": stage, "check": guardrail.check["kind"]}
            if context.tool is not None:
                base["tool"] = context.tool.name
                if context.call_id:
                    base["call_id"] = context.call_id
            try:
                findings = run_check(guardrail, stage, current, context)
            except Exception as error:
                message = str(error) or type(error).__name__
                context.record("guardrail.triggered", {**base, "action": "block", "categories": [], "findings": [], "error": message})
                return GuardrailResult(current, GuardrailStop(guardrail, source, "block", GUARDRAIL_ERROR,
                                                              f'Guardrail "{label}" could not be checked: {message}'))
            if not findings:
                continue
            categories = sorted({f["category"] for f in findings})
            action = guardrail.action if guardrail.action in ACTIONS_AT[stage] else "block"
            if action == "escalate" and (activity.actor_type.value if hasattr(activity.actor_type, "value") else activity.actor_type) == "human":
                action = "block"
            context.record("guardrail.triggered", {**base, "action": action, "categories": categories, "findings": findings})
            if action == "warn":
                continue
            if action == "redact":
                current = redact(current, findings, guardrail.replacement)
                continue
            return GuardrailResult(current, GuardrailStop(
                guardrail, source, action, GUARDRAIL_BLOCKED,
                f'Guardrail "{label}" ({guardrail.check["kind"]}) found {", ".join(categories)} at stage {stage}', categories))
        return GuardrailResult(current)


def input_value(inputs: dict[str, Any]) -> dict[str, Any]:
    """The value an input guardrail checks: the actor's input without what is reserved to the engine, with its contexts (31.3)"""
    return {**public_payload(inputs), **({"_contexts": inputs["_contexts"]} if "_contexts" in inputs else {})}


def output_value(output: dict[str, Any]) -> dict[str, Any]:
    """The value an output guardrail checks: the result without what is reserved to the engine, with its context writes (31.3)"""
    return {**public_payload(output), **({"_context_writes": output["_context_writes"]} if "_context_writes" in output else {})}


def merge_guarded(original: dict[str, Any], guarded: dict[str, Any]) -> dict[str, Any]:
    """A value as the guardrails left it, put back in place of the original, keeping what is reserved to the engine"""
    kept = {k: v for k, v in original.items() if k not in guarded and (str(k).startswith("_") or k == "activities")}
    return {**kept, **guarded}


def guardrail_feedback(stop: GuardrailStop) -> str:
    """The feedback given to an agent whose output a guardrail rejected: the guardrail and the categories, never the text"""
    return (f'Your output was rejected by the guardrail "{stop.guardrail.name or stop.guardrail.id}" ({stop.guardrail.check["kind"]}), '
            f"which found: {', '.join(stop.categories) or 'a problem'}. Produce the output again without it.")


# ---------------------------------------------------------------------------
# Validation (31.11)

def check_guardrail(g: Guardrail, where: str, on_tool: bool = False, seen: set[str] | None = None) -> list[tuple[str, str, str]]:
    """The problems of one guardrail, as (path, message, code); also used for a deployment's guardrails"""
    issues: list[tuple[str, str, str]] = []
    seen = set() if seen is None else seen

    def bad(message: str) -> None:
        issues.append((where, message, "invalid_guardrail"))

    if str(g.id) in seen:
        bad(f"Duplicate guardrail id '{g.id}'")
    seen.add(str(g.id))
    check = g.check
    for stage in g.stages:
        if g.action not in ACTIONS_AT[stage]:
            bad(f"Action '{g.action}' is not allowed at stage '{stage}'")
        if on_tool and stage not in TOOL_STAGES:
            bad(f"A guardrail on a tool applies at stages tool_call and tool_result, not '{stage}'")
    if g.action == "redact" and check["kind"] not in _REDACTABLE:
        bad(f"A '{check['kind']}' check cannot redact")
    for p in check.get("patterns") or []:
        try:
            re.compile(p["pattern"])
        except (re.error, TypeError, KeyError):
            bad(f"Pattern '{p.get('name') if isinstance(p, dict) else p}' does not compile")
    if check["kind"] == "prompt_injection":
        for marker in check.get("markers") or []:
            if marker not in INJECTION_MARKERS:
                bad(f"Unknown prompt injection marker '{marker}'")
    if check["kind"] == "size" and check.get("max_characters") is None and check.get("max_tokens") is None:
        bad("A size check needs max_characters or max_tokens")
    if check["kind"] == "json_schema":
        try:
            from jsonschema import Draft202012Validator
            Draft202012Validator.check_schema(check["schema"])
        except ImportError:
            pass
        except Exception as error:
            bad(f"Invalid JSON Schema: {getattr(error, 'message', error)}")
    if check["kind"] == "topic":
        from awa.runtime.expression import ExpressionError, evaluate_expression
        for expression in check["allow"]:
            try:
                evaluate_expression(expression, {})
            except ExpressionError as error:
                issues.append((f"{where}.check.allow", str(error), "invalid_expression"))
    return issues


def guardrail_integrity_errors(workflow: Workflow) -> list[tuple[str, str, str]]:
    """Integrity errors of the guardrails of a document, as (path, message, code)"""
    issues: list[tuple[str, str, str]] = []
    seen: set[str] = set()
    lists: list[tuple[str, list[Guardrail] | None, bool]] = [("guardrails", workflow.guardrails, False)]
    lists += [(f"roles[{r.id}].guardrails", r.guardrails, False) for r in workflow.roles]
    for a in workflow.activities:
        lists.append((f"activities[{a.id}].guardrails", a.guardrails, False))
        lists += [(f"activities[{a.id}].tools[{t.name}].guardrails", t.guardrails, True) for t in a.tools]
    for where, items, on_tool in lists:
        for g in items or []:
            issues += check_guardrail(g, f"{where}[{g.id}]", on_tool, seen)
    return issues
