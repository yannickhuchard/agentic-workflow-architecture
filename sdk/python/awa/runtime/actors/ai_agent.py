"""
AWA AI Agent Actor (specification sections 12 and 17.3)

Performs an activity by calling the model that the activity's role names, or
the engine's default model reference, through the ModelRouter. The model is
asked for a reply of the form {"reasoning": {...}, "output": ...}. The
reasoning is returned as `_reasoning`, which the engine moves into the journal;
which model served the attempt is returned as `_model`.

When the engine hands the agent a ToolRunner, the model is given the tools'
names, descriptions and parameters. Every call it asks for is run through the
runner and its result given back, until the model answers without asking for a
tool. The runner bounds the number of calls (`max_tool_calls`).

In simulation, and when no model provider is registered, no model is called.
"""

import json
import os
import re
from typing import Any
from uuid import uuid4

from awa.runtime.model_config import DEFAULT_AI_MODEL_ID
from awa.runtime.models import ChatMessage, ModelRegistry, ModelRequest, ModelRouter
from awa.runtime.token import Token
from awa.runtime.tools import ActorContext
from awa.types import Activity, Role
from .base import Actor

_JSON_OBJECT = re.compile(r"\{[\s\S]*\}")


class AIAgentError(Exception):
    def __init__(self, message: str, code: str | None = None):
        super().__init__(message)
        if code:
            self.code = code


class AIAgent(Actor):
    """
    Actor for ai_agent activities.

      api_key:          kept for compatibility; this SDK has no provider that uses it
      models:           the registry of model providers and tiers the engine was given
      roles:            the workflow's roles, by id; the activity's role gives the model and its settings
      default_model_id: model reference used when the role names none
      simulate:         call no model
    """

    def __init__(self, api_key: str | None = None, models: ModelRegistry | None = None,
                 roles: dict[str, Role] | None = None, default_model_id: str = DEFAULT_AI_MODEL_ID,
                 simulate: bool = False):
        self.api_key = api_key or os.environ.get("GEMINI_API_KEY")
        self.models = models if models is not None else ModelRegistry().fill_standard_tiers()
        self.router = ModelRouter(self.models)
        self.roles = dict(roles or {})
        self.default_model_id = default_model_id
        self.simulate = simulate

    def execute(self, activity: Activity, token: Token, context: ActorContext | None = None) -> dict[str, Any]:
        if self.simulate or not self.models.has_providers():
            return {
                "_actor": "ai_agent",
                "_activity": activity.name,
                "_simulated": True,
                "_completed": True,
            }

        inputs = dict(token.context_data)
        role = self.roles.get(str(activity.role_id))
        config = role.ai_model_config if role else None
        model_ref = (config.model_id if config else None) or self.default_model_id
        temperature = config.temperature if config and config.temperature is not None else 0.2
        max_tokens = config.max_tokens if config and config.max_tokens is not None else 1024
        tools = context.tools if context else None
        specs = tools.specs if tools else []

        system = self.system_prompt(activity, role, bool(specs))
        user = self.user_message(activity, inputs)

        try:
            # The model may ask for tools any number of times before it answers.
            # Every call goes through the engine's runner, which journals it and enforces the budget.
            messages: list[ChatMessage] = [{"role": "system", "content": system}, {"role": "user", "content": user}]
            usage = {"input_tokens": 0, "output_tokens": 0}
            while True:
                request = ModelRequest(temperature=temperature, max_output_tokens=max_tokens, tools=specs or None)
                if len(messages) == 2:
                    # A single turn is sent as system and prompt, the simplest form a provider can receive
                    request.system, request.prompt = system, user
                else:
                    request.messages = list(messages)
                routed = self.router.generate(model_ref, request)
                usage["input_tokens"] += routed.response.input_tokens
                usage["output_tokens"] += routed.response.output_tokens

                calls = routed.response.tool_calls or []
                if tools is None or not calls:
                    break
                messages.append({"role": "assistant", "content": routed.response.text, "tool_calls": calls,
                                 "provider_state": routed.response.provider_state})
                for call in calls:
                    call_id = call.get("id") or f"call_{uuid4().hex[:12]}"
                    result = tools.call(call.get("name") or "", call.get("arguments") or {}, call_id)
                    messages.append({"role": "tool", "tool_call_id": call_id, "name": call.get("name"),
                                     "content": result.content})
                    if not result.ok and isinstance(result.result, dict) and result.result.get("code") == "TOOL_BUDGET_EXCEEDED":
                        raise AIAgentError(str(result.result.get("error")), "TOOL_BUDGET_EXCEEDED")
        except Exception as error:
            code = getattr(error, "code", None)
            raise AIAgentError(f"AIAgent execution failed: {error}", code if isinstance(code, str) else None) from error

        output, reasoning = parse_reply(routed.response.text)
        # What the model writes to contexts goes to the engine, which checks it against the bindings (22.3)
        context_writes = context_writes_of(routed.response.text)
        resolved = routed.model
        model: dict[str, Any] = {
            "id": resolved.model,
            "provider": resolved.provider.id,
            "requested": model_ref,
            **({"tier": resolved.tier} if resolved.tier else {}),
            "source": "role" if config and config.model_id else "engine_default",
            "temperature": temperature,
            "route": [step.to_dict() for step in routed.route],
        }
        return {
            "output": output,
            **({"_context_writes": context_writes} if context_writes is not None else {}),
            **({"_reasoning": reasoning} if isinstance(reasoning, dict) and reasoning else {}),
            "_model": model,
            "status": "complex_completed",
            "usage": usage,
        }

    # ------------------------------------------------------------------
    # Prompts
    # ------------------------------------------------------------------

    @staticmethod
    def system_prompt(activity: Activity, role: Role | None, has_tools: bool = False) -> str:
        lines: list[str] = []
        if role:
            lines.append(f"You are a {role.name}.")
            if role.description:
                lines.append(role.description)
            if role.capabilities:
                lines.append(f" Your capabilities are: {', '.join(role.capabilities)}.")
            if role.ai_model_config and role.ai_model_config.system_prompt:
                lines.append(role.ai_model_config.system_prompt)
        else:
            lines.append("You are an intelligent AI agent.")

        lines.append(f'\nYou are responding to a request to perform the activity: "{activity.name}".')
        if activity.description:
            lines.append(f"Description: {activity.description}")
        procedure = getattr(activity, "procedure", None)
        if procedure:
            lines.append(f"Procedure: {procedure}")

        if has_tools:
            lines.append("\nYou have tools. Call them when you need facts or need something done; "
                         "do not guess what a tool could tell you.")
            lines.append("When you have what you need, give your final answer in the format below.")

        lines.append("\nRespond with a single JSON object that has exactly two properties:")
        lines.append('- "reasoning": an object with "plan" (array of the steps you took), "rationale" (why this result is right),')
        lines.append('  "alternatives_considered" (array of approaches you rejected and why) and "confidence" (number from 0 to 1).')
        lines.append('- "output": the result of the activity. Use a JSON object if the activity implies structured data, '
                     "otherwise a string.")
        return "\n".join(lines)

    @staticmethod
    def user_message(activity: Activity, inputs: dict[str, Any]) -> str:
        lines: list[str] = []
        if inputs.get("_verification_feedback"):
            lines.append("## IMPORTANT: Previous Attempt Failed Verification")
            lines.append("Your previous output did NOT pass quality verification.")
            lines.append("You MUST correct your output based on the following feedback:\n")
            lines.append(str(inputs["_verification_feedback"]))
            lines.append(f"\nThis is attempt #{inputs.get('_verification_attempt') or 'unknown'}. "
                         "Please ensure your output fully satisfies ALL criteria.\n")

        display = {key: value for key, value in inputs.items() if not str(key).startswith("_")}

        knowledge = inputs.get("_knowledge")
        if isinstance(knowledge, list) and knowledge:
            lines.append("## Knowledge from earlier runs")
            lines.append("Use this where it helps. It describes what worked and what was rejected before.\n")
            for entry in knowledge:
                lines.append(f"- {entry.get('title')}: {entry.get('guidance')}")
            lines.append("")

        # The contexts the activity is bound to read (22.2): given to the model as what it may read, apart from the run's data
        contexts = inputs.get("_contexts")
        if isinstance(contexts, dict) and contexts:
            lines.append("## Shared contexts")
            lines.append('Read-only here. To change one your activity may write, return it under "_context_writes" beside "output", by context name.\n')
            lines.append(json.dumps(contexts, indent=2, default=str))
            lines.append("")

        lines.append("## Input Context")
        lines.append(json.dumps(display, indent=2, default=str) if display else "No specific input data provided.")

        if activity.controls:
            lines.append("\n## Controls & Constraints")
            for control in activity.controls:
                enforcement = getattr(control.enforcement, "value", control.enforcement)
                lines.append(f"- {control.name}: {control.description or ''} ({enforcement})")

        verification = activity.verification
        if verification and verification.enabled and verification.criteria:
            lines.append("\n## Acceptance Criteria (Your output will be verified against these)")
            for index, criterion in enumerate(verification.criteria, 1):
                label = "[REQUIRED]" if criterion.required else "[OPTIONAL]"
                lines.append(f"{index}. {criterion.name} {label}: {criterion.description}")

        lines.append("\nBased on the above, please perform the activity and generate the output.")
        return "\n".join(lines)


def context_writes_of(text: str) -> Any:
    """What a reply of the form {"reasoning", "output", "_context_writes"} writes to contexts, or None"""
    match = _JSON_OBJECT.search(text or "")
    if not match:
        return None
    try:
        whole = json.loads(match.group(0))
    except ValueError:
        return None
    if isinstance(whole, dict) and "reasoning" in whole and "output" in whole:
        return whole.get("_context_writes")
    return None


def parse_reply(text: str) -> tuple[Any, Any]:
    """
    The output and the reasoning of a model's reply. A reply that holds a JSON
    object of the form {"reasoning", "output"} is split in two; any other JSON
    object is the output; a reply with no JSON object is the output as text.
    """
    output: Any = text
    reasoning: Any = None
    match = _JSON_OBJECT.search(text or "")
    if match:
        try:
            output = json.loads(match.group(0))
        except ValueError:
            output = text
    if isinstance(output, dict) and "reasoning" in output and "output" in output:
        reasoning = output["reasoning"]
        output = output["output"]
    return output, reasoning
