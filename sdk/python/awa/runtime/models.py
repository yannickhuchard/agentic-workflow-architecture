"""
AWA Model Binding (specification section 12)

Workflows name models by reference; the engine resolves a reference to a
provider at run time. Nothing in a workflow document or in the engine core
depends on a particular vendor.

A model reference is one of:
  "tier:<name>"          a capability tier the deployment maps to a model
  "<provider>:<model>"   a specific model of a registered provider
  "<model>"              a model of the default provider
"""

import json
import math
import re
import urllib.error
import urllib.request
from dataclasses import dataclass, field, replace
from typing import Any, Callable, Protocol

# Capability tiers every deployment SHOULD map (specification 12.2)
STANDARD_TIERS = ("reasoning", "balanced", "fast")

# A turn of a conversation: {"role": "system" | "user", "content"},
# {"role": "assistant", "content", "tool_calls"?, "provider_state"?} or
# {"role": "tool", "tool_call_id", "name", "content"}
ChatMessage = dict[str, Any]


class ModelError(Exception):
    """A model call that failed, with an error code and, from the router, the route that was tried"""

    def __init__(self, message: str, code: str = "PROVIDER_ERROR", route: "list[RouteAttempt] | None" = None,
                 status: int | None = None):
        super().__init__(message)
        self.code = code
        self.route = route or []
        self.status = status


@dataclass
class ModelRequest:
    """
    One request in the unified format. Every provider adapter translates this
    to its vendor's interface and back, so callers never see a vendor format.
    """
    # Provider-specific model name, already resolved. The router fills it in.
    model: str = ""
    # Standing instructions for the model
    system: str | None = None
    # The request, when the conversation is a single user turn
    prompt: str | None = None
    # The conversation, when there is more than one turn. Takes precedence over `prompt`.
    messages: list[ChatMessage] | None = None
    # Tools the model may call: each a dict with name, description and parameters (a JSON Schema)
    tools: list[dict[str, Any]] | None = None
    # Ask for a JSON object as the reply
    json: bool = False
    temperature: float | None = None
    max_output_tokens: int | None = None


@dataclass
class ModelResponse:
    text: str = ""
    # Calls the model asks for: each a dict with id, name and arguments
    tool_calls: list[dict[str, Any]] = field(default_factory=list)
    input_tokens: int = 0
    output_tokens: int = 0
    # Opaque continuation data; put it on the assistant message when replying with tool results
    provider_state: Any = None

    @property
    def usage(self) -> dict[str, int]:
        return {"input_tokens": self.input_tokens, "output_tokens": self.output_tokens}


class ModelProvider(Protocol):
    """An adapter between the unified request and one vendor's or runtime's interface (12.4)"""

    # Provider identifier used in model references
    id: str
    # Whether the provider can call tools
    supports_tools: bool

    def generate(self, request: ModelRequest) -> ModelResponse: ...


@dataclass
class ResolvedModel:
    provider: Any
    model: str
    # Canonical reference: "<provider>:<model>"
    ref: str
    # The tier the reference went through, if any
    tier: str | None = None


@dataclass
class RouteAttempt:
    ref: str
    # "used", "skipped" or "failed"
    outcome: str
    reason: str | None = None

    def to_dict(self) -> dict[str, Any]:
        return {"ref": self.ref, "outcome": self.outcome, **({"reason": self.reason} if self.reason else {})}


@dataclass
class RoutedResponse:
    response: ModelResponse
    model: ResolvedModel
    # Every candidate considered, in order, and what happened to it
    route: list[RouteAttempt]


def request_messages(request: ModelRequest) -> list[ChatMessage]:
    """The conversation of a request: its messages, or its system and prompt as two turns"""
    turns = list(request.messages) if request.messages else [{"role": "user", "content": request.prompt or ""}]
    if request.system and not any(turn.get("role") == "system" for turn in turns):
        turns.insert(0, {"role": "system", "content": request.system})
    return turns


def estimate_tokens(text: str) -> int:
    return math.ceil(len(text) / 4)


_PROVIDER_NAME = re.compile(r"^[a-z][a-z0-9_-]*$")


class ModelRegistry:
    """The providers registered with a deployment, and what its tiers map to"""

    def __init__(self) -> None:
        self._providers: dict[str, Any] = {}
        self._tiers: dict[str, list[str]] = {}
        self._default_provider: str | None = None

    def register(self, provider: Any, default: bool = False) -> "ModelRegistry":
        """Register a provider. The first one registered is the default until another is named."""
        self._providers[provider.id] = provider
        if default or self._default_provider is None:
            self._default_provider = provider.id
        return self

    def set_tier(self, tier: str, ref: str | list[str]) -> "ModelRegistry":
        """
        Map a tier to a model reference, or to an ordered list of them. With a
        list the router uses the first that can serve the request and falls
        back to the next if a provider fails.
        """
        refs = [ref] if isinstance(ref, str) else list(ref)
        if not refs:
            raise ValueError(f'Model tier "{tier}" needs at least one model reference')
        self._tiers[tier] = refs
        return self

    def set_default_provider(self, provider_id: str) -> "ModelRegistry":
        self._default_provider = provider_id
        return self

    def has_providers(self) -> bool:
        return bool(self._providers)

    def _resolve_direct(self, target: str, origin: str, tier: str | None = None) -> ResolvedModel:
        named, colon, rest = target.partition(":")
        # Names such as "ft:custom:v2" contain a colon but no provider: the part before
        # the colon is a provider only when one is registered under that name (12.1)
        is_provider = bool(colon) and bool(named) and named in self._providers
        provider = self._providers.get(named if is_provider else self._default_provider or "")
        if provider is None:
            raise ModelError(f'No model provider is registered for "{origin}"', "VALIDATION_ERROR")
        model = rest if is_provider else target
        return ResolvedModel(provider, model, f"{provider.id}:{model}", tier)

    def candidates(self, ref: str) -> list[ResolvedModel]:
        """
        Every model a reference can resolve to, in order of preference.
        Candidates whose provider is not registered are left out, so one tier
        map can serve deployments with different providers.
        """
        if not ref.startswith("tier:"):
            return [self._resolve_direct(ref, ref)]

        tier = ref[5:]
        mapped = self._tiers.get(tier)
        if not mapped:
            raise ModelError(f'Model tier "{tier}" is not mapped to a model in this deployment', "VALIDATION_ERROR")
        resolved: list[ResolvedModel] = []
        for target in mapped:
            if target.startswith("tier:"):
                raise ModelError(f'Model tier "{tier}" must map to a model, not to another tier', "VALIDATION_ERROR")
            named, colon, _ = target.partition(":")
            if len(mapped) > 1 and colon and named not in self._providers and _PROVIDER_NAME.match(named):
                continue
            resolved.append(self._resolve_direct(target, ref, tier))
        if not resolved:
            raise ModelError(
                f'No provider is registered for any model of tier "{tier}" ({", ".join(mapped)})', "VALIDATION_ERROR")
        return resolved

    def resolve(self, ref: str) -> ResolvedModel:
        """The preferred model for a reference"""
        return self.candidates(ref)[0]


class ModelRouter:
    """
    The single entry point for calling a model (specification 12.5).
    Given a model reference and a request in the unified format, the router
    picks the first candidate able to serve it, and falls back to the next
    when a provider fails. It reports the route it took.
    """

    def __init__(self, registry: ModelRegistry):
        self.registry = registry

    def generate(self, ref: str, request: ModelRequest) -> RoutedResponse:
        route: list[RouteAttempt] = []
        last_error: BaseException | None = None

        for candidate in self.registry.candidates(ref):
            if request.tools and not getattr(candidate.provider, "supports_tools", False):
                route.append(RouteAttempt(candidate.ref, "skipped", "provider cannot call tools"))
                continue
            try:
                response = candidate.provider.generate(replace(request, model=candidate.model))
            except Exception as error:
                last_error = error
                code = getattr(error, "code", None)
                code = code if isinstance(code, str) else None
                route.append(RouteAttempt(candidate.ref, "failed", f"{code}: {error}" if code else str(error)))
                # A request the provider judged invalid will be invalid for the next one too
                if code == "VALIDATION_ERROR":
                    break
                continue
            route.append(RouteAttempt(candidate.ref, "used"))
            return RoutedResponse(response, candidate, route)

        summary = "; ".join(f"{r.ref} {r.outcome}{f' ({r.reason})' if r.reason else ''}" for r in route)
        code = getattr(last_error, "code", None)
        if not isinstance(code, str):
            code = "PROVIDER_ERROR" if last_error else "VALIDATION_ERROR"
        raise ModelError(f'No model could serve "{ref}": {summary}', code, route)


class FunctionModelProvider:
    """A provider driven by a function. For tests and for deterministic stand-ins."""

    def __init__(self, id: str, fn: Callable[[ModelRequest], "str | ModelResponse | dict[str, Any]"], tools: bool = True):
        self.id = id
        self.supports_tools = tools
        self.requests: list[ModelRequest] = []
        self._fn = fn

    def generate(self, request: ModelRequest) -> ModelResponse:
        self.requests.append(request)
        result = self._fn(request)
        if isinstance(result, ModelResponse):
            return result
        reply = {"text": result} if isinstance(result, str) else dict(result or {})
        text = reply.get("text") or ""
        usage = reply.get("usage") or {
            "input_tokens": estimate_tokens(" ".join(str(turn.get("content", "")) for turn in request_messages(request))),
            "output_tokens": estimate_tokens(text),
        }
        return ModelResponse(
            text=text, tool_calls=list(reply.get("tool_calls") or []),
            input_tokens=int(usage.get("input_tokens") or 0), output_tokens=int(usage.get("output_tokens") or 0),
            provider_state=reply.get("provider_state"))


def _http_error(provider: str, status: int, detail: str) -> ModelError:
    code = {401: "AUTHENTICATION_ERROR", 403: "PERMISSION_DENIED", 404: "NOT_FOUND", 400: "VALIDATION_ERROR",
            422: "VALIDATION_ERROR", 429: "RATE_LIMITED"}.get(status, "PROVIDER_ERROR")
    return ModelError(f'Model provider "{provider}" returned HTTP {status}{f": {detail[:300]}" if detail else ""}', code,
                      status=status)


def _parse_arguments(raw: Any) -> dict[str, Any]:
    if isinstance(raw, dict):
        return raw
    try:
        parsed = json.loads(str(raw or "{}"))
    except ValueError:
        return {}
    return parsed if isinstance(parsed, dict) else {}


class OpenAICompatibleModelProvider:
    """
    Any service that implements the OpenAI-style `POST /chat/completions`
    endpoint, including its tool-calling fields. That covers most hosted
    gateways and the usual ways of serving open-source models (Ollama,
    llama.cpp server, vLLM, LM Studio, LocalAI). Uses the standard library only.
    """

    def __init__(self, id: str, base_url: str, api_key: str | None = None, tools: bool = True, timeout: float = 120):
        self.id = id
        self.supports_tools = tools
        self._base_url = base_url.rstrip("/")
        self._api_key = api_key
        self._timeout = timeout

    def _message(self, message: ChatMessage) -> Any:
        role = message.get("role")
        if role == "tool":
            return {"role": "tool", "tool_call_id": message.get("tool_call_id"), "content": message.get("content", "")}
        if role == "assistant":
            # The provider's own message is sent back untouched: it may carry fields this
            # adapter does not know and that the provider needs in order to continue the turn
            if message.get("provider_state"):
                return message["provider_state"]
            calls = [{"id": call["id"], "type": "function",
                      "function": {"name": call["name"], "arguments": json.dumps(call.get("arguments") or {})}}
                     for call in message.get("tool_calls") or []]
            return {"role": "assistant", "content": message.get("content", ""), **({"tool_calls": calls} if calls else {})}
        return {"role": role, "content": message.get("content", "")}

    def generate(self, request: ModelRequest) -> ModelResponse:
        body: dict[str, Any] = {
            "model": request.model,
            "messages": [self._message(message) for message in request_messages(request)],
        }
        if request.tools:
            body["tools"] = [{"type": "function", "function": {
                key: tool[key] for key in ("name", "description", "parameters") if tool.get(key) is not None
            }} for tool in request.tools]
        if request.json:
            body["response_format"] = {"type": "json_object"}
        if request.temperature is not None:
            body["temperature"] = request.temperature
        if request.max_output_tokens is not None:
            body["max_tokens"] = request.max_output_tokens

        http_request = urllib.request.Request(
            f"{self._base_url}/chat/completions", data=json.dumps(body).encode("utf-8"), method="POST",
            headers={"content-type": "application/json",
                     **({"authorization": f"Bearer {self._api_key}"} if self._api_key else {})})
        try:
            with urllib.request.urlopen(http_request, timeout=self._timeout) as response:
                reply = json.loads(response.read().decode("utf-8"))
        except urllib.error.HTTPError as error:
            raise _http_error(self.id, error.code, error.read().decode("utf-8", errors="replace")) from None
        except (urllib.error.URLError, OSError, ValueError) as error:
            raise ModelError(f'Model provider "{self.id}" could not be reached: {getattr(error, "reason", error)}') from None

        message = ((reply.get("choices") or [{}])[0] or {}).get("message") or {}
        tool_calls = [{
            "id": call.get("id") or f"call_{index}",
            "name": (call.get("function") or {}).get("name") or "",
            "arguments": _parse_arguments((call.get("function") or {}).get("arguments")),
        } for index, call in enumerate(message.get("tool_calls") or [])]
        usage = reply.get("usage") or {}
        return ModelResponse(
            text=message.get("content") or "", tool_calls=tool_calls,
            input_tokens=int(usage.get("prompt_tokens") or 0), output_tokens=int(usage.get("completion_tokens") or 0),
            provider_state=message if tool_calls else None)


def ollama_provider(base_url: str = "http://localhost:11434/v1", id: str = "ollama", tools: bool = True) -> OpenAICompatibleModelProvider:
    """Open-source models served by a local Ollama, through its OpenAI-compatible endpoint"""
    return OpenAICompatibleModelProvider(id, base_url, tools=tools)
