"""
Tests for AWA Builder
"""

import pytest
from uuid import uuid4

from awa import workflow, ActorType, SyncPattern, ContextType


class TestWorkflowBuilder:
    """WorkflowBuilder tests"""
    
    def test_basic_workflow_creation(self):
        """Test creating a basic workflow"""
        result = (
            workflow("Test Workflow", "1.0.0")
            .description("A test workflow")
            .build()
        )
        
        assert result.name == "Test Workflow"
        assert result.version == "1.0.0"
        assert result.description == "A test workflow"
    
    def test_workflow_with_activities(self):
        """Test adding activities"""
        result = (
            workflow("Order Process", "1.0.0")
            .activity("Receive Order",
                role_id="customer-service",
                actor_type=ActorType.application
            )
            .activity("Process Order",
                role_id="processor",
                actor_type=ActorType.ai_agent
            )
            .edge("Receive Order", "Process Order")
            .build()
        )
        
        assert len(result.activities) == 2
        assert len(result.edges) == 1
        assert result.activities[0].name == "Receive Order"
        assert result.activities[1].name == "Process Order"
    
    def test_workflow_with_context(self):
        """Test adding contexts"""
        result = (
            workflow("Context Test", "1.0.0")
            .context("order_data",
                type=ContextType.data,
                sync_pattern=SyncPattern.shared_state
            )
            .build()
        )
        
        assert len(result.contexts) == 1
        assert result.contexts[0].name == "order_data"
