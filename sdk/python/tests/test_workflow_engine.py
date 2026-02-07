"""
Tests for AWA Runtime WorkflowEngine
"""

import pytest
from uuid import uuid4

from awa.types import (
    Workflow, Activity, Edge, Role, ActorType, Context
)
from awa.runtime import WorkflowEngine, EngineStatus
from awa.runtime.token import TokenStatus


def create_test_workflow() -> Workflow:
    """Create a simple test workflow"""
    role_id = str(uuid4())
    activity1_id = str(uuid4())
    activity2_id = str(uuid4())
    
    return Workflow(
        id=str(uuid4()),
        name="Test Workflow",
        version="1.0.0",
        activities=[
            Activity(
                id=activity1_id,
                name="Start Task",
                role_id=role_id,
                actor_type=ActorType.application,
                inputs=[],
                outputs=[]
            ),
            Activity(
                id=activity2_id,
                name="End Task",
                role_id=role_id,
                actor_type=ActorType.application,
                inputs=[],
                outputs=[]
            )
        ],
        edges=[
            Edge(
                id=str(uuid4()),
                source_id=activity1_id,
                target_id=activity2_id
            )
        ],
        roles=[
            Role(
                id=role_id,
                name="Test Role",
                actor_type=ActorType.application
            )
        ],
        contexts=[],
        events=[],
        decision_nodes=[]
    )


class TestWorkflowEngine:
    """WorkflowEngine class tests"""
    
    def test_engine_creation(self):
        """Test engine initialization"""
        workflow = create_test_workflow()
        engine = WorkflowEngine(workflow)
        
        assert engine.status == EngineStatus.IDLE
        assert engine.workflow == workflow
        assert len(engine.tokens) == 0
    
    def test_engine_run_simple_workflow(self):
        """Test running a simple workflow"""
        workflow = create_test_workflow()
        engine = WorkflowEngine(workflow, verbose=True)
        
        result = engine.run()
        
        assert engine.status == EngineStatus.COMPLETED
        assert result["status"] == "completed"
        assert len(result["tokens"]) == 1
        assert result["tokens"][0]["status"] == "completed"
    
    def test_engine_with_initial_data(self):
        """Test running with initial context data"""
        workflow = create_test_workflow()
        engine = WorkflowEngine(workflow)
        
        result = engine.run({"input_key": "input_value"})
        
        token_data = result["tokens"][0]["context_data"]
        assert "input_key" in token_data
        assert token_data["input_key"] == "input_value"
    
    def test_engine_ai_agent_simulation(self):
        """Test AI agent in simulation mode (no API key)"""
        role_id = str(uuid4())
        activity_id = str(uuid4())
        
        workflow = Workflow(
            id=str(uuid4()),
            name="AI Workflow",
            version="1.0.0",
            activities=[
                Activity(
                    id=activity_id,
                    name="AI Task",
                    role_id=role_id,
                    actor_type=ActorType.ai_agent,
                    inputs=[],
                    outputs=[]
                )
            ],
            edges=[],
            roles=[
                Role(
                    id=role_id,
                    name="AI Role",
                    actor_type=ActorType.ai_agent
                )
            ],
            contexts=[],
            events=[],
            decision_nodes=[]
        )
        
        engine = WorkflowEngine(workflow)
        result = engine.run()
        
        assert result["status"] == "completed"
        assert result["tokens"][0]["context_data"]["_simulated"] is True
