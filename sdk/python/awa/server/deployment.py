"""
What the deployment lets the runs of this server reach, and the guardrails it adds
to every run (specification 17.4, 28.2, 31.1). Every engine the routes create takes
these options, so that HTTP runs, journeys and A2A runs work under the same
permissions. `awa serve --deployment` sets them.
"""

from typing import Any

_configured: dict[str, Any] | None = None


def set_server_deployment(deployment: dict[str, Any] | None) -> None:
    """The deployment's `tools`, `a2a` and `guardrails` for every route of this process"""
    global _configured
    _configured = deployment


def server_deployment_options() -> dict[str, Any]:
    """The engine options the deployment gives every run of this server; empty without a deployment"""
    if not _configured:
        return {}
    return {
        **({"tools": _configured["tools"]} if _configured.get("tools") else {}),
        **({"a2a": _configured["a2a"]} if _configured.get("a2a") else {}),
        **({"guardrails": _configured["guardrails"]} if _configured.get("guardrails") else {}),
    }
