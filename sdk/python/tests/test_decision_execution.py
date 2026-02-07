"""
Tests for AWA Decision Node Execution
"""

import pytest
from uuid import uuid4

from awa.types import (
    Workflow, Activity, Edge, Role, ActorType, DecisionNode, DecisionTable, DecisionRule, TableColumn, HitPolicy
)
from awa.runtime import WorkflowEngine, EngineStatus


def create_decision_workflow() -> Workflow:
    """Create a workflow with a decision node"""
    role_id = str(uuid4())
    start_id = str(uuid4())
    decision_id = str(uuid4())
    path_a_id = str(uuid4())
    path_b_id = str(uuid4())
    
    edge_to_a = str(uuid4())
    edge_to_b = str(uuid4())
    
    return Workflow(
        id=str(uuid4()),
        name="Decision Workflow",
        version="1.0.0",
        activities=[
            Activity(
                id=start_id,
                name="Start",
                role_id=role_id,
                actor_type=ActorType.application
            ),
            Activity(
                id=path_a_id,
                name="Path A",
                role_id=role_id,
                actor_type=ActorType.application
            ),
            Activity(
                id=path_b_id,
                name="Path B",
                role_id=role_id,
                actor_type=ActorType.application
            )
        ],
        edges=[
            Edge(id=str(uuid4()), source_id=start_id, target_id=decision_id),
            Edge(id=edge_to_a, source_id=decision_id, target_id=path_a_id),
            Edge(id=edge_to_b, source_id=decision_id, target_id=path_b_id)
        ],
        decision_nodes=[
            DecisionNode(
                id=decision_id,
                name="Branch",
                decision_table=DecisionTable(
                    hit_policy=HitPolicy.unique,
                    inputs=[TableColumn(name="choice", type="string")],
                    outputs=[TableColumn(name="path", type="string")],
                    rules=[
                        DecisionRule(
                            input_entries=["A"],
                            output_entries=["A"],
                            output_edge_id=edge_to_a
                        ),
                        DecisionRule(
                            input_entries=["B"],
                            output_entries=["B"],
                            output_edge_id=edge_to_b
                        )
                    ]
                )
            )
        ],
        roles=[Role(id=role_id, name="Actor", actor_type=ActorType.application)],
        contexts=[],
        events=[]
    )


class TestDecisionExecution:
    """Tests for decision node execution logic"""
    
    def test_decision_path_a(self):
        """Test branching to Path A"""
        wf = create_decision_workflow()
        engine = WorkflowEngine(wf)
        
        result = engine.run({"choice": "A"})
        
        # Should have 1 token that moved: Start -> Decision -> Path A
        token = result["tokens"][0]
        assert str(token["activity_id"]) == str(wf.activities[1].id) # Path A
        assert token["status"] == "completed"
        
    def test_decision_path_b(self):
        """Test branching to Path B"""
        wf = create_decision_workflow()
        engine = WorkflowEngine(wf)
        
        result = engine.run({"choice": "B"})
        
        token = result["tokens"][0]
        assert str(token["activity_id"]) == str(wf.activities[2].id) # Path B
        assert token["status"] == "completed"
