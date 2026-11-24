"""
A deployment file: what the workflows run by this host may reach (specification 17.4, 17.7, 17.8, 28.2),
and who may do what in them (specification 30).

    {
      "tools": {
        "allow_commands": ["python3"],
        "allowed_hosts": ["api.example.com"],
        "mcp_servers": {"docs": {"command": "python3", "args": ["docs_server.py"]},
                        "search": {"url": "https://mcp.example.com/mcp"}},
        "grpc": {"protos": ["pricing.proto"], "plaintext_hosts": ["localhost"]}
      },
      "a2a": {"allowed_hosts": ["agents.example.com"], "poll_interval_ms": 1000, "max_wait_ms": 600000},
      "authorization": {
        "principals": [{"id": "agent:assessor", "kind": "ai_agent", "attributes": {"roles": ["underwriter"]},
                        "acts_for": {"roles": ["Underwriter"]}, "credentials": {"authorization": "Bearer {{secret:ASSESSOR_TOKEN}}"}}],
        "policy": {"rules": [...], "separation_of_duties": [...], "four_eyes": [...]},
        "classifications": {"Claim settlement": "confidential"},
        "record_allows": false
      }
    }

Relative paths of .proto files, include directories and root certificates are taken from the
file's own directory. Secrets are not read from this file.
"""

import json
import os
from typing import Any

from awa.runtime.authorization import load_authorization

TOOL_KEYS = {"allow_commands", "allowed_hosts", "max_output_bytes", "mcp_servers", "grpc"}
A2A_KEYS = {"allowed_hosts", "poll_interval_ms", "max_wait_ms", "max_output_bytes"}


def load_deployment(file: str) -> dict[str, Any]:
    """The engine options `tools`, `a2a` and, when the file has that section, `authorization` a deployment file gives"""
    with open(file, encoding="utf-8") as handle:
        raw = json.load(handle)
    directory = os.path.dirname(os.path.abspath(file))
    extra = set(raw or {}) - {"tools", "a2a", "authorization"}
    if extra:
        raise ValueError(f"Unknown section(s) in {file}: {', '.join(sorted(extra))}")
    for section, keys in (("tools", TOOL_KEYS), ("a2a", A2A_KEYS)):
        unknown = set(raw.get(section) or {}) - keys
        if unknown:
            raise ValueError(f"Unknown {section} option(s) in {file}: {', '.join(sorted(unknown))}")
    tools = dict(raw.get("tools") or {})
    grpc = dict(tools.get("grpc") or {})
    if grpc:
        local = lambda p: os.path.join(directory, p)  # noqa: E731
        if grpc.get("protos"):
            grpc["protos"] = [local(p) for p in grpc["protos"]]
        if grpc.get("include_dirs"):
            grpc["include_dirs"] = [local(p) for p in grpc["include_dirs"]]
        if grpc.get("root_certificates"):
            grpc["root_certificates"] = local(grpc["root_certificates"])
        tools["grpc"] = grpc
    deployment: dict[str, Any] = {"tools": tools, "a2a": dict(raw.get("a2a") or {})}
    if raw.get("authorization") is not None:
        deployment["authorization"] = load_authorization(raw["authorization"])
    return deployment
