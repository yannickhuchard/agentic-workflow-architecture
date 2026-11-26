"""What the protocol clients share: which addresses they may reach, and secrets in headers"""

import re
import urllib.parse

from awa.runtime.tools import ToolError, _host

_SECRET = re.compile(r"\{\{secret:([\w-]+)\}\}")


def web_url(text: str) -> str:
    """An address a tool or agent may reach: http or https, and nothing else (no file:, no data:)"""
    try:
        parts = urllib.parse.urlsplit(text)
    except ValueError:
        raise ToolError(f'"{text}" is not a URL', "VALIDATION_ERROR") from None
    if parts.scheme not in ("http", "https") or not parts.netloc:
        raise ToolError(f"Only http and https addresses can be reached, not {parts.scheme or text}", "VALIDATION_ERROR")
    return text


def check_host(url: str, allowed_hosts: list[str] | None, what: str = "calls") -> None:
    """Refuse a host the deployment does not allow (specification 17.4)"""
    host = _host(url)
    if allowed_hosts is not None and host not in allowed_hosts:
        raise ToolError(f'This deployment does not allow {what} to host "{host}"', "PERMISSION_DENIED")


def with_secrets(value: str, secrets: dict[str, str]) -> str:
    """Replace {{secret:NAME}} in a header value. A secret that is not configured fails the call."""
    def secret(match: "re.Match[str]") -> str:
        if match.group(1) not in secrets:
            raise ToolError(f'Secret "{match.group(1)}" is not configured', "VALIDATION_ERROR")
        return secrets[match.group(1)]
    return _SECRET.sub(secret, value)
