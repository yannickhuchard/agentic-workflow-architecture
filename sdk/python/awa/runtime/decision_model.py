"""
AWA Model Decisions (specification section 16)

A decision node may be decided by a language model instead of, or after, a
decision table. The model's freedom is bounded: it must pick exactly one of
the options the workflow enumerates, its answer is validated, and anything
else (an unknown option, low confidence, no majority, a model failure) is
"no decision", which takes the node's default edge or fails the token.
"""

import json
import re
from dataclasses import dataclass, field
from typing import Any

from awa.runtime.models import ModelRequest, ModelRouter, RouteAttempt
from awa.types import DecisionModel, DecisionNode


@dataclass
class ModelVote:
    option: str | None = None
    confidence: float | None = None
    rationale: str | None = None
    # Why the vote does not count, if it does not
    invalid: str | None = None
    # The model that cast it, as "<provider>:<model>"
    model: str | None = None

    def to_dict(self) -> dict[str, Any]:
        """The vote as journalled: its option and confidence, or why it was invalid"""
        return {key: value for key, value in
                (("option", self.option), ("confidence", self.confidence), ("invalid", self.invalid)) if value is not None}


@dataclass
class ModelDecision:
    # The option decided, or None for "no decision"
    option: str | None = None
    edge_id: str | None = None
    confidence: float | None = None
    rationale: str | None = None
    # Why there is no decision
    reason: str | None = None
    votes: list[ModelVote] = field(default_factory=list)
    # The model that served: provider, id, the reference requested and the tier it went through, if any
    model: dict[str, Any] | None = None
    route: list[RouteAttempt] = field(default_factory=list)
    usage: dict[str, int] = field(default_factory=lambda: {"input_tokens": 0, "output_tokens": 0})


def _fact(value: Any) -> str:
    if isinstance(value, (dict, list)):
        return json.dumps(value, ensure_ascii=False)
    if value is None:
        return "null"
    if isinstance(value, bool):
        return "true" if value else "false"
    return str(value)


def decision_prompt(node: DecisionNode, model: DecisionModel, inputs: dict[str, Any]) -> tuple[str, str]:
    """
    The system text and the prompt for one decision. The model is shown the
    node's name and description, the instructions, the options and the
    selected inputs, and nothing else (16.3). The prompt is short and ends
    with the exact reply shape, naming the option ids, which small models
    follow more reliably than an abstract description of the format.
    """
    ids = [option.id for option in model.options]
    system = "You decide which route a workflow takes. Choose exactly one of the listed options."
    prompt = "\n".join([
        f"Decision: {node.name}",
        *([node.description] if node.description else []),
        model.instructions,
        "",
        "Options:",
        *(f"- {option.id}: {option.description}" for option in model.options),
        "",
        "Facts:",
        *(f"- {key}: {_fact(value)}" for key, value in inputs.items()),
        "",
        f'Reply with JSON like {{"option": "<{" or ".join(ids)}>", "confidence": <0 to 1>, "rationale": "<one sentence>"}}.',
    ])
    return system, prompt


def parse_vote(text: str, model: DecisionModel) -> ModelVote:
    """Read one model reply as a vote. Never raises: an unusable reply is an invalid vote."""
    ids = [option.id for option in model.options]
    text = text if isinstance(text, str) else ""
    match = re.search(r"\{[\s\S]*\}", text)
    if match:
        try:
            parsed = json.loads(match.group(0))
        except ValueError:
            parsed = None  # small models often produce almost-JSON: read it as plain text below
        if isinstance(parsed, dict):
            option = parsed["option"].strip() if isinstance(parsed.get("option"), str) else None
            stated = parsed.get("confidence")
            confidence = (float(stated) if isinstance(stated, (int, float)) and not isinstance(stated, bool)
                          and 0 <= stated <= 1 else None)
            rationale = parsed["rationale"] if isinstance(parsed.get("rationale"), str) else None
            if option and option in ids:
                return ModelVote(option=option, confidence=confidence, rationale=rationale)
            return ModelVote(
                invalid=f'"{option}" is not one of the options' if option else "the reply names no option",
                confidence=confidence, rationale=rationale)
    # A reply that is not JSON still counts if it names exactly one option
    named = [i for i in ids if re.search(rf"(^|[^A-Za-z0-9_-]){re.escape(i)}($|[^A-Za-z0-9_-])", text)]
    if len(named) == 1:
        return ModelVote(option=named[0], rationale=text.strip()[:300])
    return ModelVote(invalid="the reply names more than one option" if len(named) > 1
                     else "the reply is not valid JSON and names no option")


def decision_inputs(model: DecisionModel, data: dict[str, Any]) -> dict[str, Any]:
    """The token data properties the model is shown: those the node selects, else all but the engine's own"""
    if model.inputs is not None:
        return {name: data[name] for name in model.inputs if name in data}
    return {key: value for key, value in data.items() if not str(key).startswith("_") and key != "activities"}


def decide_with_model(node: DecisionNode, data: dict[str, Any], router: ModelRouter, default_model: str) -> ModelDecision:
    """
    Ask a model to decide. `votes` independent samples are taken; the decision
    is the option with a strict majority of all votes cast, provided the mean
    confidence of the votes for it reaches `min_confidence`.
    """
    model = node.decision_model
    if model is None:
        raise ValueError(f'Decision "{node.name}" has no decision_model')
    system, prompt = decision_prompt(node, model, decision_inputs(model, data))
    requested = model.model or default_model
    # One sample should be as repeatable as possible; several need to be independent
    temperature = model.temperature if model.temperature is not None else (0.7 if model.votes > 1 else 0)
    decision = ModelDecision()

    for _ in range(model.votes):
        try:
            routed = router.generate(requested, ModelRequest(
                system=system, prompt=prompt, json=True, temperature=temperature, max_output_tokens=300))
        except Exception as error:
            # A model that cannot be reached casts an invalid vote
            decision.route = getattr(error, "route", None) or decision.route
            decision.votes.append(ModelVote(invalid=f"the model could not be reached: {error}"))
            continue
        decision.usage["input_tokens"] += routed.response.input_tokens
        decision.usage["output_tokens"] += routed.response.output_tokens
        decision.route = routed.route
        decision.model = {
            "provider": routed.model.provider.id, "id": routed.model.model, "requested": requested,
            **({"tier": routed.model.tier} if routed.model.tier else {}),
        }
        vote = parse_vote(routed.response.text, model)
        vote.model = routed.model.ref
        decision.votes.append(vote)

    tally: dict[str, list[ModelVote]] = {}
    for vote in decision.votes:
        if vote.option:
            tally.setdefault(vote.option, []).append(vote)
    if not tally:
        decision.reason = (decision.votes[0].invalid if decision.votes else None) or "no valid vote"
        return decision

    winner, supporters = max(tally.items(), key=lambda item: len(item[1]))
    if len(supporters) * 2 <= len(decision.votes):
        counts = ", ".join(f"{option}: {len(votes)}" for option, votes in tally.items())
        decision.reason = f"no option has a majority ({counts} of {len(decision.votes)} votes)"
        return decision

    stated = [vote.confidence for vote in supporters if vote.confidence is not None]
    decision.confidence = sum(stated) / len(stated) if stated else None
    decision.rationale = supporters[0].rationale
    if model.min_confidence > 0 and (decision.confidence is None or decision.confidence < model.min_confidence):
        shown = "was not stated" if decision.confidence is None else f"{decision.confidence:.2f}"
        decision.reason = f"confidence {shown} is below the required {model.min_confidence:g}"
        return decision

    decision.option = winner
    decision.edge_id = str(next(option.output_edge_id for option in model.options if option.id == winner))
    return decision
