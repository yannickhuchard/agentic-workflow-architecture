"""
Identity and authorization (specification section 30).

Who performs an activity, completes a person's task or starts a run is a
principal: a person, an AI agent, a robot, an application or a service, with
an id, a kind and attributes. The deployment gives the principals of agents,
tools and agents reached over A2A; an authenticated request gives those of
people and callers. A declarative policy in the deployment, with
deny-overrides and default deny, decides whether a principal may take an
action on a resource. Separation of duties and four-eyes approvals are
first-class rules. Every denial is journalled as `authorization.decided`.

The built-in policy is the reference decider. A deployment may plug in
another (an external policy engine) as `decider`: any object with
`decide(request) -> decision`. The engine enforces and records its decisions
the same way, and a decider that fails denies.
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from typing import Any, Callable, Protocol

from awa.runtime.expression import ExpressionError, evaluate_expression

PRINCIPAL_KINDS = ("person", "ai_agent", "robot", "application", "service")
AUTHORIZATION_ACTIONS = (
    "start_run", "perform_activity", "call_tool", "reach_agent", "claim_task", "assign_task",
    "complete_task", "approve", "answer_agent", "publish_event", "cancel_run", "read_journal", "migrate_run",
)
SOD_ACTIONS = ("perform_activity", "complete_task", "approve")
ANONYMOUS_PRINCIPAL: dict[str, Any] = {"id": "anonymous", "kind": "application"}
HOST_PRINCIPAL: dict[str, Any] = {"id": "host", "kind": "service"}
_KIND_OF_ACTOR = {"human": "person", "ai_agent": "ai_agent", "robot": "robot", "application": "application"}
_REGISTERED_CLAIMS = {"iss", "sub", "aud", "exp", "nbf", "iat", "jti", "kind", "name", "role", "roles"}


class Decider(Protocol):
    def decide(self, request: dict[str, Any]) -> dict[str, Any]: ...


class AuthorizationError(Exception):
    """A denial (30.4). Its code is FORBIDDEN; it carries the decision."""

    code = "FORBIDDEN"

    def __init__(self, message: str, decision: dict[str, Any], action: str):
        super().__init__(message)
        self.decision = decision
        self.action = action


def principal_ref(principal: dict[str, Any]) -> dict[str, Any]:
    """The part of a principal that is journalled: never its attributes (30.6)"""
    return {"id": principal["id"], "kind": principal["kind"]}


# ----------------------------------------------------------------------
# Validation
# ----------------------------------------------------------------------

def _is_strings(value: Any) -> bool:
    return isinstance(value, list) and all(isinstance(v, str) for v in value)


def _unknown_keys(where: str, value: dict[str, Any], keys: tuple[str, ...], errors: list[str]) -> None:
    for key in value:
        if key not in keys:
            errors.append(f'{where}: unknown property "{key}"')


def _check_principal(where: str, p: Any, errors: list[str], identity: bool) -> None:
    if not isinstance(p, dict):
        errors.append(f"{where}: must be an object")
        return
    keys = ("id", "kind", "name", "attributes") + (("acts_for", "credentials") if identity else ())
    _unknown_keys(where, p, keys, errors)
    if not isinstance(p.get("id"), str) or not p.get("id"):
        errors.append(f'{where}: "id" is required')
    if p.get("kind") not in PRINCIPAL_KINDS:
        errors.append(f'{where}: "kind" must be one of {", ".join(PRINCIPAL_KINDS)}')
    if "attributes" in p and not isinstance(p["attributes"], dict):
        errors.append(f'{where}: "attributes" must be an object')
    if identity and "acts_for" in p:
        acts = p["acts_for"] if isinstance(p["acts_for"], dict) else {}
        _unknown_keys(f"{where}.acts_for", acts, ("activities", "roles", "actor_types", "agents"), errors)
        for key, value in acts.items():
            if not _is_strings(value):
                errors.append(f"{where}.acts_for.{key}: must be a list of strings")
    if identity and "credentials" in p and not (isinstance(p["credentials"], dict)
                                                and all(isinstance(v, str) for v in p["credentials"].values())):
        errors.append(f"{where}.credentials: must map header names to text")


def validate_policy(policy: Any) -> list[str]:
    """Problems with a policy, each naming where it is. Empty when the policy is valid"""
    errors: list[str] = []
    if not isinstance(policy, dict):
        return ["policy: must be an object"]
    _unknown_keys("policy", policy, ("rules", "separation_of_duties", "four_eyes"), errors)
    ids: set[str] = set()

    def id_of(where: str, value: Any) -> None:
        if not isinstance(value, str) or not value:
            errors.append(f'{where}: "id" is required')
        elif value in ids:
            errors.append(f'{where}: id "{value}" is used twice')
        else:
            ids.add(value)

    def items(key: str) -> list[Any]:
        value = policy.get(key)
        if value is None:
            return []
        if not isinstance(value, list):
            errors.append(f"policy.{key}: must be a list")
            return []
        return value

    for i, rule in enumerate(items("rules")):
        where = f"policy.rules[{i}]"
        if not isinstance(rule, dict):
            errors.append(f"{where}: must be an object")
            continue
        _unknown_keys(where, rule, ("id", "description", "effect", "actions", "subject", "resource", "condition"), errors)
        id_of(where, rule.get("id"))
        if rule.get("effect") not in ("allow", "deny"):
            errors.append(f'{where}: "effect" must be "allow" or "deny"')
        actions = rule.get("actions")
        if not _is_strings(actions) or not actions:
            errors.append(f'{where}: "actions" must be a non-empty list')
        else:
            for action in actions:
                if action != "*" and action not in AUTHORIZATION_ACTIONS:
                    errors.append(f'{where}: unknown action "{action}"')
        if "subject" in rule:
            s = rule["subject"] if isinstance(rule["subject"], dict) else {}
            _unknown_keys(f"{where}.subject", s, ("ids", "kinds", "roles", "groups", "attributes"), errors)
            for key in ("ids", "kinds", "roles", "groups"):
                if key in s and not _is_strings(s[key]):
                    errors.append(f"{where}.subject.{key}: must be a list of strings")
            for kind in s.get("kinds") if _is_strings(s.get("kinds")) else []:
                if kind not in PRINCIPAL_KINDS:
                    errors.append(f'{where}.subject.kinds: unknown kind "{kind}"')
            if "attributes" in s and not isinstance(s["attributes"], dict):
                errors.append(f"{where}.subject.attributes: must be an object")
        if "resource" in rule:
            r = rule["resource"] if isinstance(rule["resource"], dict) else {}
            _unknown_keys(f"{where}.resource", r, ("workflows", "activities", "roles", "tools", "agents", "classifications"), errors)
            for key, value in r.items():
                if not _is_strings(value):
                    errors.append(f"{where}.resource.{key}: must be a list of strings")
        if "condition" in rule:
            condition = rule["condition"]
            if not isinstance(condition, str):
                errors.append(f"{where}.condition: must be text")
            else:
                try:
                    evaluate_expression(condition, {})
                except ExpressionError as error:
                    errors.append(f"{where}.condition: {error}")
    for i, sod in enumerate(items("separation_of_duties")):
        where = f"policy.separation_of_duties[{i}]"
        if not isinstance(sod, dict):
            errors.append(f"{where}: must be an object")
            continue
        _unknown_keys(where, sod, ("id", "description", "activities", "actions", "includes_starter"), errors)
        id_of(where, sod.get("id"))
        starter = sod.get("includes_starter") is True
        if not _is_strings(sod.get("activities")) or len(sod["activities"]) < (1 if starter else 2):
            errors.append(f'{where}: "activities" must list at least {"one activity" if starter else "two activities"}')
        if "actions" in sod and (not _is_strings(sod["actions"]) or not all(a in SOD_ACTIONS for a in sod["actions"])):
            errors.append(f'{where}: "actions" may only list {", ".join(SOD_ACTIONS)}')
        if "includes_starter" in sod and not isinstance(sod["includes_starter"], bool):
            errors.append(f'{where}: "includes_starter" must be true or false')
    for i, rule in enumerate(items("four_eyes")):
        where = f"policy.four_eyes[{i}]"
        if not isinstance(rule, dict):
            errors.append(f"{where}: must be an object")
            continue
        _unknown_keys(where, rule, ("id", "description", "activities", "approvals"), errors)
        id_of(where, rule.get("id"))
        if not _is_strings(rule.get("activities")) or not rule["activities"]:
            errors.append(f'{where}: "activities" must be a non-empty list')
        approvals = rule.get("approvals")
        if not isinstance(approvals, int) or isinstance(approvals, bool) or approvals < 2:
            errors.append(f'{where}: "approvals" must be a whole number of at least 2')
    return errors


def load_authorization(raw: Any) -> dict[str, Any]:
    """Read the `authorization` section of a deployment (30.2). Raises ValueError, naming every problem, when it is not valid"""
    if raw is None:
        return {}
    if not isinstance(raw, dict):
        raise ValueError("authorization: must be an object")
    errors: list[str] = []
    _unknown_keys("authorization", raw, ("policy", "principals", "classifications", "record_allows", "host_principal"), errors)
    if "policy" in raw:
        errors.extend(validate_policy(raw["policy"]))
    if "principals" in raw:
        if not isinstance(raw["principals"], list):
            errors.append("authorization.principals: must be a list")
        else:
            seen: set[str] = set()
            for i, p in enumerate(raw["principals"]):
                _check_principal(f"authorization.principals[{i}]", p, errors, True)
                pid = p.get("id") if isinstance(p, dict) else None
                if pid and pid in seen:
                    errors.append(f'authorization.principals[{i}]: id "{pid}" is used twice')
                if pid:
                    seen.add(pid)
    if "classifications" in raw and not (isinstance(raw["classifications"], dict)
                                         and all(isinstance(v, str) for v in raw["classifications"].values())):
        errors.append("authorization.classifications: must map workflow and activity ids or names to text")
    if "record_allows" in raw and not isinstance(raw["record_allows"], bool):
        errors.append("authorization.record_allows: must be true or false")
    if "host_principal" in raw:
        _check_principal("authorization.host_principal", raw["host_principal"], errors, False)
    if errors:
        raise ValueError("Invalid authorization: " + "; ".join(errors))
    return raw


# ----------------------------------------------------------------------
# The built-in policy (the reference decider)
# ----------------------------------------------------------------------

def _as_list(value: Any) -> list[Any]:
    if value is None:
        return []
    return value if isinstance(value, list) else [value]


def _listed(names: list[str] | None, *values: Any) -> bool:
    return names is None or any(isinstance(v, str) and v in names for v in values)


def _same(a: Any, b: Any) -> bool:
    return json.dumps(a, sort_keys=True) == json.dumps(b, sort_keys=True)


def _subject_matches(subject: dict[str, Any] | None, principal: dict[str, Any]) -> bool:
    if not subject:
        return True
    attributes = principal.get("attributes") or {}
    if "ids" in subject and principal["id"] not in subject["ids"]:
        return False
    if "kinds" in subject and principal["kind"] not in subject["kinds"]:
        return False
    if "roles" in subject and not any(r in subject["roles"] for r in _as_list(attributes.get("roles"))):
        return False
    if "groups" in subject and not any(g in subject["groups"] for g in _as_list(attributes.get("groups"))):
        return False
    for name, wanted in (subject.get("attributes") or {}).items():
        have = _as_list(attributes.get(name))
        if not any(_same(h, w) for w in _as_list(wanted) for h in have):
            return False
    return True


def _resource_matches(match: dict[str, Any] | None, r: dict[str, Any]) -> bool:
    if not match:
        return True
    return (_listed(match.get("workflows"), r.get("workflow_id"), r.get("workflow_name"))
            and _listed(match.get("activities"), r.get("activity_id"), r.get("activity_name"))
            and _listed(match.get("roles"), r.get("role_id"), r.get("role_name"))
            and _listed(match.get("tools"), r.get("tool"))
            and _listed(match.get("agents"), r.get("agent"))
            and _listed(match.get("classifications"), r.get("classification")))


def condition_data(request: dict[str, Any]) -> dict[str, Any]:
    """What a condition is evaluated against (30.2)"""
    principal = request["principal"]
    return {
        "principal": {"id": principal["id"], "kind": principal["kind"],
                      **({"name": principal["name"]} if principal.get("name") else {}),
                      "attributes": principal.get("attributes") or {}},
        "resource": request["resource"],
        "run": request.get("run") or {},
        "action": request["action"],
    }


def _names_activity(entry: str, activity_id: Any, name: Any) -> bool:
    return entry == activity_id or entry == name


class PolicyDecider:
    """The built-in policy: deny-overrides, default deny (30.3)"""

    def __init__(self, policy: dict[str, Any] | None):
        self.policy = policy or {}

    def decide(self, request: dict[str, Any]) -> dict[str, Any]:
        action, principal, resource = request["action"], request["principal"], request["resource"]
        history = request.get("history") or {"performed": []}
        allows: list[str] = []
        denies: list[tuple[str, str, str]] = []
        data = condition_data(request)
        target = resource.get("activity_name") or resource.get("activity_id")

        for rule in self.policy.get("rules") or []:
            if "*" not in rule["actions"] and action not in rule["actions"]:
                continue
            if not _subject_matches(rule.get("subject"), principal) or not _resource_matches(rule.get("resource"), resource):
                continue
            if rule.get("condition") and not evaluate_expression(rule["condition"], data):
                continue
            if rule["effect"] == "deny":
                denies.append((rule["id"], "rule", f'Rule "{rule["id"]}" denies {action} to {principal["id"]}'))
            else:
                allows.append(rule["id"])

        for sod in self.policy.get("separation_of_duties") or []:
            if action not in (sod.get("actions") or SOD_ACTIONS):
                continue
            if not any(_names_activity(a, resource.get("activity_id"), resource.get("activity_name")) for a in sod["activities"]):
                continue
            others = [a for a in sod["activities"] if not _names_activity(a, resource.get("activity_id"), resource.get("activity_name"))]
            did = next((p for p in history.get("performed") or [] if principal["id"] in p.get("principal_ids", [])
                        and any(_names_activity(a, p.get("activity_id"), p.get("activity_name")) for a in others)), None)
            if did:
                denies.append((sod["id"], "separation_of_duties",
                               f'{principal["id"]} performed "{did.get("activity_name") or did.get("activity_id")}" in this run, and separation '
                               f'of duties "{sod["id"]}" forbids them to {action} "{target}"'))
            elif sod.get("includes_starter") and history.get("started_by") == principal["id"]:
                denies.append((sod["id"], "separation_of_duties",
                               f'{principal["id"]} started this run, and separation of duties "{sod["id"]}" forbids them to {action} "{target}"'))

        if action == "approve":
            for rule in self.policy.get("four_eyes") or []:
                if not any(_names_activity(a, resource.get("activity_id"), resource.get("activity_name")) for a in rule["activities"]):
                    continue
                if principal["id"] in (history.get("approvals") or []):
                    denies.append((rule["id"], "four_eyes",
                                   f'{principal["id"]} has already approved "{target}"; four-eyes rule "{rule["id"]}" needs '
                                   f'{rule["approvals"]} distinct approvers'))

        if denies:
            rule_id, reason, message = denies[0]
            return {"decision": "deny", "rule": rule_id, "reason": reason, "message": message}
        if allows:
            return {"decision": "allow", "rule": allows[0], "reason": "rule"}
        return {"decision": "deny", "rule": None, "reason": "no_rule", "message": f"No rule allows {action} to {principal['id']}"}


def four_eyes_for(policy: dict[str, Any] | None, activity_id: str, activity_name: str | None) -> dict[str, Any] | None:
    """The four-eyes rule that applies to an activity, if any"""
    return next((rule for rule in (policy or {}).get("four_eyes") or []
                 if any(_names_activity(a, activity_id, activity_name) for a in rule["activities"])), None)


# ----------------------------------------------------------------------
# Principals
# ----------------------------------------------------------------------

def performer_of(identities: list[dict[str, Any]], activity: Any, role: Any = None, agent: str | None = None) -> dict[str, Any]:
    """
    The principal that performs an activity whose actor is not a person waiting for a task (30.1): the first identity
    that acts for the activity, then for its A2A agent, then for its role, then for its actor type. Without one,
    the agent's card URL for an agent over A2A, otherwise `<actor_type>:<role_id>`, with no attributes.
    """
    actor_type = getattr(activity.actor_type, "value", activity.actor_type)

    def by(key: str, *values: Any) -> dict[str, Any] | None:
        wanted = [v for v in values if isinstance(v, str)]
        return next((p for p in identities if any(v in wanted for v in ((p.get("acts_for") or {}).get(key) or []))), None)

    found = (by("activities", str(activity.id), activity.name)
             or (by("agents", agent) if agent else None)
             or by("roles", str(activity.role_id), getattr(role, "name", None))
             or by("actor_types", actor_type))
    if found:
        return found
    if agent:
        return {"id": agent, "kind": "ai_agent"}
    return {"id": f"{actor_type}:{activity.role_id}", "kind": _KIND_OF_ACTOR.get(actor_type, "application")}


def principal_named(options: dict[str, Any] | None, principal_id: str, kind: str = "person") -> dict[str, Any]:
    """A principal named only by id: the deployment's entry for it, or a person with no attributes"""
    known = next((p for p in (options or {}).get("principals") or [] if p.get("id") == principal_id), None)
    if known:
        return {"id": known["id"], "kind": known["kind"], **({"name": known["name"]} if known.get("name") else {}),
                "attributes": known.get("attributes") or {}}
    return {"id": principal_id, "kind": kind}


def principal_from_claims(claims: dict[str, Any]) -> dict[str, Any]:
    """
    The principal of a request authenticated by a JWT (30.1): `sub` is the id; `kind` the kind (default person);
    `roles` and `role` the roles; every other claim but the registered ones an attribute of the same name.
    """
    attributes = {k: v for k, v in claims.items() if k not in _REGISTERED_CLAIMS}
    roles: list[str] = []
    for role in [*_as_list(claims.get("roles")), *_as_list(claims.get("role"))]:
        if isinstance(role, str) and role not in roles:
            roles.append(role)
    if roles:
        attributes["roles"] = roles
    kind = claims.get("kind") if claims.get("kind") in PRINCIPAL_KINDS else "person"
    return {"id": str(claims.get("sub")), "kind": kind,
            **({"name": claims["name"]} if isinstance(claims.get("name"), str) else {}), "attributes": attributes}


def classification_of(options: dict[str, Any], workflow: Any, activity: Any = None) -> str | None:
    c = options.get("classifications") or {}
    if activity is not None:
        found = c.get(str(activity.id), c.get(activity.name))
        if found is not None:
            return found
    return c.get(str(workflow.id), c.get(workflow.name))


def resource_of(options: dict[str, Any], workflow: Any, activity: Any = None, role: Any = None, **extra: Any) -> dict[str, Any]:
    """The resource of an action on a workflow or one of its activities"""
    classification = classification_of(options, workflow, activity)
    resource: dict[str, Any] = {"workflow_id": str(workflow.id), "workflow_name": workflow.name}
    if activity is not None:
        resource.update({"activity_id": str(activity.id), "activity_name": activity.name, "role_id": str(activity.role_id)})
    if role is not None and getattr(role, "name", None):
        resource["role_name"] = role.name
    if classification is not None:
        resource["classification"] = classification
    resource.update({k: v for k, v in extra.items() if v is not None})
    return resource


def decide(options: dict[str, Any], request: dict[str, Any]) -> dict[str, Any]:
    """Decide, failing closed: a decider that raises or answers something other than a decision denies (30.7)"""
    decider = options.get("decider") or PolicyDecider(options.get("policy"))
    try:
        answer = decider.decide(request)
        if not isinstance(answer, dict) or answer.get("decision") not in ("allow", "deny"):
            raise ValueError("the decider gave no decision")
        decision = {"decision": answer["decision"], "rule": answer.get("rule"),
                    "reason": answer.get("reason") or ("rule" if answer.get("rule") else "no_rule")}
        if answer.get("message"):
            decision["message"] = answer["message"]
        return decision
    except Exception as error:  # noqa: BLE001 - any failure of the decider denies
        return {"decision": "deny", "rule": None, "reason": "decider_error", "message": f"The decider failed: {error}"}


def is_enforced(options: dict[str, Any] | None) -> bool:
    """Whether the options carry something that decides: then everything not allowed is denied"""
    return bool(options and (options.get("policy") is not None or options.get("decider") is not None))


# ----------------------------------------------------------------------
# One run's enforcement points (30.4)
# ----------------------------------------------------------------------

@dataclass
class RunAuthorization:
    """The engine's side of authorization: one per run"""
    options: dict[str, Any]
    workflow: Any
    roles: dict[str, Any]
    # record(type, data, **ref) writes a journal event
    record: Callable[..., Any]
    # The activities completed in the run, with who performed them
    performed: Callable[[], list[dict[str, Any]]]

    def __post_init__(self) -> None:
        # A policy given in code is held to the same rules as one read from a deployment file (30.2)
        errors = validate_policy(self.options["policy"]) if self.options.get("policy") is not None else []
        if errors:
            raise ValueError("Invalid authorization: " + "; ".join(errors))

    @property
    def enforced(self) -> bool:
        return is_enforced(self.options)

    @property
    def host_principal(self) -> dict[str, Any]:
        return self.options.get("host_principal") or HOST_PRINCIPAL

    def history(self, data: dict[str, Any], approvals: list[str] | None = None) -> dict[str, Any]:
        started = data.get("_started_by") or {}
        names = {str(a.id): a.name for a in self.workflow.activities}
        history: dict[str, Any] = {"performed": [
            {"activity_id": p["activity_id"], "activity_name": p.get("activity_name") or names.get(str(p["activity_id"])),
             "principal_ids": list(p["principal_ids"])}
            for p in self.performed() if p.get("principal_ids")]}
        if started.get("id"):
            history["started_by"] = started["id"]
        if approvals is not None:
            history["approvals"] = approvals
        return history

    def resource(self, activity: Any = None, **extra: Any) -> dict[str, Any]:
        role = self.roles.get(str(activity.role_id)) if activity is not None else None
        return resource_of(self.options, self.workflow, activity, role, **extra)

    def decide(self, action: str, principal: dict[str, Any], resource: dict[str, Any], run: dict[str, Any],
               history: dict[str, Any], ref: dict[str, Any] | None = None, approval: dict[str, int] | None = None) -> dict[str, Any]:
        """Decide and record: a denial is always journalled, an allow when the deployment asks, an approval always (30.6)"""
        if not self.enforced:
            return {"decision": "allow", "rule": None, "reason": "no_rule"}
        decision = decide(self.options, {"action": action, "principal": principal, "resource": resource, "run": run, "history": history})
        given = len(history.get("approvals") or []) + 1 if approval and decision["decision"] == "allow" else None
        if decision["decision"] == "deny" or self.options.get("record_allows") or given is not None:
            data = {"action": action, "decision": decision["decision"], "principal": principal_ref(principal), "resource": resource,
                    "rule": decision["rule"], "reason": decision["reason"]}
            if decision.get("message"):
                data["message"] = decision["message"]
            if given is not None:
                data["approval"] = {"given": given, "required": approval["required"]}
            self.record("authorization.decided", data, **(ref or {}))
        return decision

    def require(self, action: str, principal: dict[str, Any], resource: dict[str, Any], run: dict[str, Any],
                history: dict[str, Any], ref: dict[str, Any] | None = None) -> None:
        decision = self.decide(action, principal, resource, run, history, ref)
        if decision["decision"] == "deny":
            raise AuthorizationError(decision.get("message") or f"{action} is not allowed to {principal['id']}", decision, action)

    def start(self, data: dict[str, Any], principal: dict[str, Any] | None) -> dict[str, Any]:
        """Before a run starts: who starts it, refused when the policy says no. Nothing is recorded: there is no run yet"""
        starter = principal or self.host_principal
        if not self.enforced:
            return starter
        decision = decide(self.options, {"action": "start_run", "principal": starter, "resource": self.resource(),
                                         "run": data, "history": {"performed": []}})
        if decision["decision"] == "deny":
            raise AuthorizationError(decision.get("message") or f"start_run is not allowed to {starter['id']}", decision, "start_run")
        return starter

    def performer(self, activity: Any, agent: Any = None) -> dict[str, Any] | None:
        """The identity that performs an activity, or None when a person will (the check is then at completion)"""
        if agent is None and getattr(activity.actor_type, "value", activity.actor_type) == "human":
            return None
        return performer_of(self.options.get("principals") or [], activity, self.roles.get(str(activity.role_id)),
                            agent.agent_card if agent is not None else None)

    def before_activity(self, activity: Any, agent: Any, data: dict[str, Any], ref: dict[str, Any]) -> dict[str, Any] | None:
        """Before the first attempt of an activity an agent, robot or application performs: perform_activity, and reach_agent over A2A"""
        performer = self.performer(activity, agent)
        if performer is None:
            return None
        self.require("perform_activity", performer, self.resource(activity), data, self.history(data), ref)
        if agent is not None:
            self.require("reach_agent", performer, self.resource(activity, agent=agent.agent_card), data, self.history(data), ref)
        return performer

    def tools_for(self, tools: list[Any], performer: dict[str, Any] | None) -> list[Any]:
        """The identity's credentials added to the headers of its HTTP tools; they replace a header of the same name (30.1)"""
        credentials = (performer or {}).get("credentials")
        if not credentials:
            return tools
        out = []
        for tool in tools:
            if tool.binding.kind == "http":
                headers = {**_lower(tool.binding.headers or {}), **_lower(credentials)}
                tool = tool.model_copy(update={"binding": tool.binding.model_copy(update={"headers": headers})})
            out.append(tool)
        return out

    def agent_for(self, activity: Any, agent: Any) -> Any:
        """The identity's credentials added to the headers sent to an agent over A2A"""
        credentials = (self.performer(activity, agent) or {}).get("credentials")
        if not credentials:
            return agent
        return agent.model_copy(update={"headers": {**_lower(agent.headers or {}), **_lower(credentials)}})

    def tool_check(self, activity: Any, performer: dict[str, Any] | None, data: dict[str, Any], ref: dict[str, Any]) -> Callable[[dict[str, Any]], dict[str, Any]]:
        """What a tool runner asks before a call runs (17.3 step 3, 30.4)"""
        def check(call: dict[str, Any]) -> dict[str, Any]:
            if not self.enforced:
                return {"allowed": True}
            principal = performer or self.host_principal
            decision = self.decide("call_tool", principal, self.resource(activity, tool=call["tool"], link=call.get("link")),
                                   data, self.history(data), ref)
            return {"allowed": True} if decision["decision"] == "allow" else {"allowed": False, "message": decision.get("message")}
        return check

    def before_completion(self, activity: Any, data: dict[str, Any], output: dict[str, Any], principal: dict[str, Any] | None,
                          ref: dict[str, Any]) -> dict[str, Any]:
        """
        Before a person's answer is taken (30.4): complete_task, or approve under a four-eyes rule. Raises on a denial.
        Under a four-eyes rule an allowed approval is kept on the token until enough distinct principals have approved;
        `pending` is then true and the token keeps waiting.
        """
        who = principal or self.host_principal
        rule = four_eyes_for(self.options.get("policy"), str(activity.id), activity.name) if self.enforced else None
        if rule is None:
            self.require("complete_task", who, self.resource(activity), data, self.history(data), ref)
            return {"principal": who, "output": output, "pending": False}
        kept = list(data.get("_approvals") or [])
        history = self.history(data, [a["principal"]["id"] for a in kept])
        decision = self.decide("approve", who, self.resource(activity), data, history, ref, {"required": rule["approvals"]})
        if decision["decision"] == "deny":
            raise AuthorizationError(decision.get("message") or f"approve is not allowed to {who['id']}", decision, "approve")
        approvals = [*kept, {"principal": principal_ref(who), "output": output}]
        if len(approvals) < rule["approvals"]:
            return {"principal": who, "output": output, "pending": True, "kept": approvals}
        merged: dict[str, Any] = {}
        for approval in approvals:
            merged.update(approval["output"])
        return {"principal": who, "pending": False, "output": merged, "approvals": [a["principal"] for a in approvals]}


def _lower(headers: dict[str, str]) -> dict[str, str]:
    return {name.lower(): value for name, value in headers.items()}
