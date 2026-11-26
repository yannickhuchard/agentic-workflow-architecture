"""
Authorization on the Operational API (specification 30.4).

Authentication says who a caller is; this says what they may do. A caller's
principal comes from the request: the claims of its JWT, or the principal its
API key stands for; an unauthenticated caller is `anonymous`. Under a policy,
every route that starts a run, completes, assigns or claims a task, answers
an agent, publishes an event or reads a journal asks the policy first, and
answers 403 with code FORBIDDEN when it says no. Without a policy nothing is
checked here, and authentication works as before.
"""

from typing import Any

from fastapi import Request
from fastapi.responses import JSONResponse

from awa.runtime.authorization import (
    ANONYMOUS_PRINCIPAL, AuthorizationError, decide, is_enforced, principal_from_claims, principal_named, principal_ref,
)
from awa.runtime.logger import get_logger

_configured: dict[str, Any] | None = None


def set_authorization(options: dict[str, Any] | None) -> None:
    """The deployment's authorization for every route of this process (`awa serve --deployment` sets it)"""
    global _configured
    _configured = options


def server_authorization() -> dict[str, Any] | None:
    return _configured


def principal_of_user(user: dict[str, Any] | None) -> dict[str, Any]:
    """The principal of an authenticated user (30.1); anonymous when the request was not authenticated"""
    if not user or user.get("anonymous"):
        return dict(ANONYMOUS_PRINCIPAL)
    if user.get("claims"):
        return principal_from_claims(user["claims"])
    attributes = {**(user.get("attributes") or {}), "roles": [user.get("role")], "permissions": user.get("permissions") or []}
    return {"id": str(user.get("id")), "kind": user.get("kind") or "application", "attributes": attributes}


def request_principal(request: Request) -> dict[str, Any]:
    """Who makes the request: the user the authentication dependency found, kept on the request's state"""
    return principal_of_user(getattr(request.state, "awa_user", None))


def forbidden(error: AuthorizationError, principal: dict[str, Any] | None = None) -> JSONResponse:
    """The answer to a refused request"""
    decision = {"action": error.action, **error.decision, **({"principal": principal_ref(principal)} if principal else {})}
    return JSONResponse({"error": "Forbidden", "code": "FORBIDDEN", "message": str(error), "decision": decision}, status_code=403)


def authorize_request(action: str, principal: dict[str, Any], resource: dict[str, Any], run: dict[str, Any] | None = None) -> JSONResponse | None:
    """
    Ask the policy before a route acts. Returns the 403 response on a denial, which is logged: a request refused
    here belongs to no run, so its denial has no journal to go to. Returns None when allowed, or without a policy.
    """
    if not is_enforced(_configured):
        return None
    decision = decide(_configured, {"action": action, "principal": principal, "resource": resource, "run": run or {},
                                    "history": {"performed": []}})
    if decision["decision"] == "allow":
        return None
    get_logger().warn(f"Request refused by the authorization policy: {action} by {principal['id']} ({decision['reason']})")
    return forbidden(AuthorizationError(decision.get("message") or f"{action} is not allowed to {principal['id']}", decision, action), principal)


def named_principal(principal_id: str) -> dict[str, Any]:
    """A principal a request names by id, such as the assignee of a task: the deployment's entry, or a person"""
    return principal_named(_configured, principal_id)


def task_resource(task: Any) -> dict[str, Any]:
    """The resource of a task in the task queue"""
    return {"workflow_id": str(task.workflow_id), "activity_id": str(task.activity_id), "activity_name": task.activity_name,
            "role_id": str(task.role_id), "task_id": str(task.id)}
