"""
The built-in AI agent: it calls the model its role names through the router,
asks for {reasoning, output}, parses the reply, reports usage, runs the tools
the model asks for through the engine's ToolRunner, and calls no model in
simulation. Every model here is a FunctionModelProvider: no network.
"""

import json
from uuid import uuid4

from awa.runtime.actors.ai_agent import parse_reply
from awa.runtime.model_config import DEFAULT_AI_MODEL_ID
from awa.runtime.models import FunctionModelProvider, ModelError, ModelRegistry, ModelResponse
from awa.runtime.workflow_engine import WorkflowEngine
from awa.types import Workflow


def uid():
    return str(uuid4())


def workflow(role=None, **activity_fields):
    role_id = uid()
    roles = [{"id": role_id, "name": "Claims assessor", "description": "Assesses motor claims.",
              "actor_type": "ai_agent", "capabilities": ["damage assessment"], **(role or {})}]
    activity = {"id": uid(), "name": "Assess damage", "description": "Estimate the cost of the damage.",
                "role_id": role_id, "actor_type": "ai_agent", **activity_fields}
    return Workflow.model_validate({"id": uid(), "name": "Claims", "version": "1.0.0",
                                    "activities": [activity], "edges": [], "roles": roles})


def reply(output, reasoning=None):
    return json.dumps({"reasoning": reasoning or {"plan": ["read the claim"], "rationale": "photos show it",
                                                  "alternatives_considered": [], "confidence": 0.8},
                       "output": output})


def engine_for(wf, provider, **options):
    return WorkflowEngine(wf, options={
        "model_providers": [provider], "model_tiers": {"balanced": "test:test-model"}, "default_ai_model_id": "tier:balanced",
        "log_execution": False, "sleep": lambda ms: None, **options})


def events_of(engine, type):
    return [e for e in engine.get_events() if e["type"] == type]


def test_the_agent_calls_the_model_and_separates_reasoning_from_output():
    provider = FunctionModelProvider("test", lambda request: {
        "text": "Here you are: " + reply({"estimated_cost": 3200}), "usage": {"input_tokens": 120, "output_tokens": 30}})
    engine = engine_for(workflow(), provider)
    result = engine.run({"claim_id": "CLM-1", "_internal": "hidden"})

    assert result["status"] == "completed"
    data = result["tokens"][0]["context_data"]
    assert data["output"] == {"estimated_cost": 3200}
    assert "_reasoning" not in data and "_model" not in data

    (request,) = provider.requests
    assert request.model == "test-model"
    assert request.temperature == 0.2 and request.max_output_tokens == 1024
    assert request.system.startswith("You are a Claims assessor.\nAssesses motor claims.")
    assert "Your capabilities are: damage assessment." in request.system
    assert '"reasoning"' in request.system and '"output"' in request.system
    assert 'perform the activity: "Assess damage"' in request.system
    assert "You have tools" not in request.system
    assert '"claim_id": "CLM-1"' in request.prompt and "_internal" not in request.prompt
    assert request.tools is None

    (completed,) = events_of(engine, "activity.completed")
    assert completed["data"]["usage"] == {"input_tokens": 120, "output_tokens": 30}
    assert engine.get_events()[-1]["data"]["input_tokens"] == 120
    (reasoning,) = events_of(engine, "reasoning.recorded")
    assert reasoning["level"] == "reasoning"
    assert reasoning["data"]["source"] == "actor" and reasoning["data"]["confidence"] == 0.8
    (selection,) = [e for e in events_of(engine, "meta.recorded") if e["data"]["subject"] == "model_selection"]
    model = selection["data"]["model"]
    assert (model["id"], model["provider"], model["requested"], model["tier"], model["source"]) == \
        ("test-model", "test", "tier:balanced", "balanced", "engine_default")
    assert selection["data"]["decision"] == "Use model test:test-model"


def test_the_role_names_the_model_and_its_settings():
    provider = FunctionModelProvider("test", lambda request: reply("done"))
    wf = workflow(role={"ai_model_config": {"model_id": "test:role-model", "temperature": 0.7, "max_tokens": 50,
                                            "system_prompt": "Answer in euros."}})
    engine = engine_for(wf, provider)
    assert engine.run()["status"] == "completed"
    (request,) = provider.requests
    assert (request.model, request.temperature, request.max_output_tokens) == ("role-model", 0.7, 50)
    assert "Answer in euros." in request.system
    (selection,) = [e for e in events_of(engine, "meta.recorded") if e["data"]["subject"] == "model_selection"]
    assert selection["data"]["model"]["source"] == "role"
    assert "The role assigned to this activity names this model." in selection["data"]["rationale"]


def test_feedback_controls_criteria_and_knowledge_reach_the_prompt():
    from awa.runtime.actors.ai_agent import AIAgent
    activity = workflow(
        controls=[{"id": uid(), "name": "Cap", "description": "No more than 10000", "type": "validation",
                   "enforcement": "mandatory"}],
        verification={"criteria": [{"id": uid(), "name": "Has cost", "description": "Gives a cost",
                                    "type": "completeness"}]}).activities[0]
    text = AIAgent.user_message(activity, {
        "claim": 1, "_verification_feedback": "The cost is missing", "_verification_attempt": 2,
        "_knowledge": [{"title": "Use photos", "guidance": "Photos settle most claims."}]})
    assert "Previous Attempt Failed Verification" in text and "The cost is missing" in text and "attempt #2" in text
    assert "- Use photos: Photos settle most claims." in text
    assert "- Cap: No more than 10000 (mandatory)" in text
    assert "1. Has cost [REQUIRED]: Gives a cost" in text


PRICE = {"name": "price", "description": "Price of a part",
         "parameters": {"type": "object", "properties": {"part": {"type": "string"}}, "required": ["part"]},
         "binding": {"kind": "function", "name": "price"}}


def test_a_tool_call_round_trip():
    def model(request):
        tool_turns = [m for m in (request.messages or []) if m["role"] == "tool"]
        if not tool_turns:
            return ModelResponse(text="", tool_calls=[{"id": "call-1", "name": "price", "arguments": {"part": "bumper"}}],
                                 input_tokens=50, output_tokens=5, provider_state={"opaque": True})
        return ModelResponse(text=reply({"estimated_cost": json.loads(tool_turns[0]["content"])["eur"]}),
                             input_tokens=80, output_tokens=20)

    provider = FunctionModelProvider("test", model)
    called = []
    engine = engine_for(workflow(tools=[PRICE]), provider,
                        tools={"handlers": {"price": lambda arguments: called.append(arguments) or {"eur": 410}}})
    result = engine.run()

    assert result["status"] == "completed"
    assert result["tokens"][0]["context_data"]["output"] == {"estimated_cost": 410}
    assert called == [{"part": "bumper"}]

    first, second = provider.requests
    assert first.tools == [{"name": "price", "description": "Price of a part", "parameters": PRICE["parameters"]}]
    assert "You have tools" in first.system and first.prompt and first.messages is None
    roles = [m["role"] for m in second.messages]
    assert roles == ["system", "user", "assistant", "tool"]
    assistant, tool = second.messages[2], second.messages[3]
    assert assistant["tool_calls"][0]["id"] == "call-1" and assistant["provider_state"] == {"opaque": True}
    assert (tool["tool_call_id"], tool["name"], json.loads(tool["content"])) == ("call-1", "price", {"eur": 410})

    (invoked,) = events_of(engine, "tool.invoked")
    assert invoked["data"]["call_id"] == "call-1" and invoked["data"]["arguments"] == {"part": "bumper"}
    assert len(events_of(engine, "tool.completed")) == 1
    (completed,) = events_of(engine, "activity.completed")
    assert completed["data"]["usage"] == {"input_tokens": 130, "output_tokens": 25}


def test_a_failed_tool_call_is_given_back_to_the_model():
    def model(request):
        tool_turns = [m for m in (request.messages or []) if m["role"] == "tool"]
        if not tool_turns:
            return {"tool_calls": [{"id": "c1", "name": "price", "arguments": {}}]}
        return reply({"error_seen": json.loads(tool_turns[0]["content"])["code"]})

    engine = engine_for(workflow(tools=[PRICE]), FunctionModelProvider("test", model),
                        tools={"handlers": {"price": lambda arguments: {"eur": 1}}})
    result = engine.run()
    assert result["tokens"][0]["context_data"]["output"] == {"error_seen": "VALIDATION_ERROR"}
    assert len(events_of(engine, "tool.failed")) == 1


def test_the_tool_loop_is_bounded_by_max_tool_calls():
    provider = FunctionModelProvider("test", lambda request: {
        "tool_calls": [{"id": uid(), "name": "price", "arguments": {"part": "door"}}]})
    engine = engine_for(workflow(tools=[PRICE], outcome_contract={"budgets": {"max_tool_calls": 2}}), provider,
                        tools={"handlers": {"price": lambda arguments: {"eur": 1}}})
    result = engine.run()
    assert result["status"] == "failed"
    token = result["tokens"][0]["context_data"]
    assert token["_error_code"] == "TOOL_BUDGET_EXCEEDED"
    assert len(events_of(engine, "tool.completed")) == 2
    assert len(provider.requests) == 3


def test_a_malformed_reply_is_the_output_as_text():
    provider = FunctionModelProvider("test", lambda request: 'I think {"reasoning": {"plan": [} is it')
    engine = engine_for(workflow(), provider)
    result = engine.run()
    assert result["status"] == "completed"
    assert result["tokens"][0]["context_data"]["output"] == 'I think {"reasoning": {"plan": [} is it'
    assert events_of(engine, "reasoning.recorded") == []


def test_a_malformed_reply_fails_a_contract_that_needs_structured_output():
    provider = FunctionModelProvider("test", lambda request: "no JSON here")
    engine = engine_for(workflow(outcome_contract={
        "postconditions": [{"name": "Costed", "expression": "estimated_cost > 0"}], "budgets": {"max_attempts": 2}}), provider)
    result = engine.run()
    assert result["status"] == "failed"
    assert result["tokens"][0]["context_data"]["_error_code"] == "CONTRACT_VIOLATION"
    # Asked again once, with the violated terms as feedback
    assert len(provider.requests) == 2 and "Previous Attempt Failed" in provider.requests[1].prompt


def test_parse_reply():
    assert parse_reply(reply({"a": 1}, {"plan": []})) == ({"a": 1}, {"plan": []})
    assert parse_reply('{"a": 1}') == ({"a": 1}, None)
    assert parse_reply("plain text") == ("plain text", None)
    assert parse_reply('{"reasoning": "r", "output": "o"}') == ("o", "r")


def test_a_model_error_fails_the_activity_with_its_code():
    def broken(request):
        raise ModelError("quota", "RATE_LIMITED")

    engine = engine_for(workflow(), FunctionModelProvider("test", broken))
    result = engine.run()
    assert result["status"] == "failed"
    data = result["tokens"][0]["context_data"]
    assert data["_error_code"] == "RATE_LIMITED" and "AIAgent execution failed" in data["_error"]


def test_a_fallback_route_is_journalled():
    def broken(request):
        raise ModelError("down")

    first = FunctionModelProvider("first", broken)
    second = FunctionModelProvider("second", lambda request: reply("ok"))
    engine = WorkflowEngine(workflow(), options={
        "model_providers": [first, second], "model_tiers": {"balanced": ["first:test-model", "second:test-model"]},
        "default_ai_model_id": "tier:balanced", "log_execution": False})
    assert engine.run()["status"] == "completed"
    route = [e for e in events_of(engine, "meta.recorded") if e["data"]["subject"] == "model_route"]
    assert len(route) == 1 and route[0]["data"]["decision"] == "Route to second:test-model"


def test_in_simulation_no_model_is_called():
    provider = FunctionModelProvider("test", lambda request: reply("real"))
    engine = engine_for(workflow(), provider, simulate=True)
    result = engine.run()
    assert result["status"] == "completed"
    assert provider.requests == []
    assert result["tokens"][0]["context_data"]["_simulated"] is True


def test_an_unmapped_standard_tier_is_the_default_model_of_the_default_provider():
    provider = FunctionModelProvider("test", lambda request: reply("ok"))
    engine = WorkflowEngine(workflow(), options={"model_providers": [provider], "default_ai_model_id": "tier:balanced", "log_execution": False})
    assert engine.run()["status"] == "completed"
    assert provider.requests[0].model == "default"
    # Without a default named, the engine uses the configured default model (awa/config.json), on the default provider
    configured = WorkflowEngine(workflow(), options={"model_providers": [provider], "log_execution": False})
    assert configured.run()["status"] == "completed"
    assert provider.requests[-1].model == DEFAULT_AI_MODEL_ID
    registry = ModelRegistry().register(provider).set_tier("fast", "test:quick").fill_standard_tiers()
    assert registry.resolve("tier:fast").ref == "test:quick"
    assert registry.resolve("tier:reasoning").ref == "test:default"
    presets = {"test": {"balanced": "test:preset-model"}}
    assert ModelRegistry().register(provider).fill_standard_tiers(presets).resolve("tier:balanced").ref == "test:preset-model"


def test_the_model_sees_the_contexts_it_is_bound_to_read_and_its_writes_reach_the_engine():
    policy = {"id": uid(), "name": "Policy", "type": "data", "sync_pattern": "shared_state", "initial_value": {"excess": 250}}
    notes = {"id": uid(), "name": "Notes", "type": "data", "sync_pattern": "blackboard"}
    secret = {"id": uid(), "name": "Secret", "type": "data", "sync_pattern": "shared_state", "initial_value": {"key": "not for the model"}}
    wf = workflow(context_bindings=[{"context_id": policy["id"], "access_mode": "read"}, {"context_id": notes["id"], "access_mode": "write"}])
    wf = Workflow.model_validate({**wf.model_dump(mode="json", exclude_none=True), "contexts": [policy, notes, secret]})
    provider = FunctionModelProvider("test", lambda request: json.dumps({
        "reasoning": {"rationale": "excess applies"}, "output": {"payable": 950}, "_context_writes": {"Notes": {"assessed": True}}}))
    engine = engine_for(wf, provider)
    assert engine.run({"claim": 1200})["status"] == "completed"
    (request,) = provider.requests
    prompt = json.dumps([request.prompt, request.messages], default=str)
    assert "Shared contexts" in prompt and '\\"excess\\": 250' in prompt
    assert "not for the model" not in prompt
    assert engine.get_contexts() == {"Policy": {"excess": 250}, "Notes": {"assessed": True}, "Secret": {"key": "not for the model"}}
