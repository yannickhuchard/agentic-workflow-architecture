"""
Tests for AWA Persistence and TaskService
"""

import os
import json
import sqlite3
import pytest
from uuid import uuid4
from datetime import datetime

from awa.types import ActorType
from awa.runtime.persistence.db import get_connection, init_db, DB_PATH
from awa.runtime.services.task_service import TaskService, ExecutionService


@pytest.fixture(autouse=True)
def setup_test_db():
    """Setup and teardown a clean test SQLite database."""
    # Set a separate test database URL
    test_db = "test_awa.db"
    os.environ["AWA_DATABASE_URL"] = test_db
    
    # Force auto-initialization or call explicitly
    init_db()

    # Clear tables to prevent test interference
    conn = get_connection()
    conn.execute("DELETE FROM human_tasks")
    conn.execute("DELETE FROM workflow_executions")
    conn.commit()
    conn.close()
    
    yield
    
    # Cleanup DB file
    if os.path.exists(test_db):
        try:
            os.remove(test_db)
        except PermissionError:
            pass


class TestTaskService:
    """Tests for SQLite-backed TaskService."""

    def test_create_and_get_task(self):
        """Test task creation and retrieval."""
        role_id = uuid4()
        activity_id = uuid4()
        token_id = uuid4()
        workflow_id = uuid4()

        task_data = {
            "activity_id": activity_id,
            "activity_name": "Verify Account Details",
            "token_id": token_id,
            "workflow_id": workflow_id,
            "priority": "critical",
            "role_id": role_id,
            "inputs": {"account_number": "123456"},
            "description": "Please check standard documents",
        }

        task = TaskService.create(task_data)
        assert task.id is not None
        assert task.status == "pending"
        assert task.priority == "critical"
        assert task.inputs == {"account_number": "123456"}
        assert task.description == "Please check standard documents"

        # Fetch it back
        fetched = TaskService.get(str(task.id))
        assert fetched is not None
        assert fetched.id == task.id
        assert fetched.priority == "critical"
        assert fetched.inputs == {"account_number": "123456"}

    def test_list_and_filter_tasks(self):
        """Test listing and filtering tasks."""
        role_1 = uuid4()
        role_2 = uuid4()
        workflow_id = uuid4()

        # Create tasks
        t1 = TaskService.create({
            "activity_id": uuid4(),
            "activity_name": "Task 1",
            "token_id": uuid4(),
            "workflow_id": workflow_id,
            "role_id": role_1,
            "inputs": {},
            "status": "pending",
        })

        t2 = TaskService.create({
            "activity_id": uuid4(),
            "activity_name": "Task 2",
            "token_id": uuid4(),
            "workflow_id": workflow_id,
            "role_id": role_2,
            "inputs": {},
            "status": "completed",
        })

        # List all
        all_tasks = TaskService.list()
        assert len(all_tasks) >= 2

        # Filter by status
        pending = TaskService.list({"status": "pending"})
        assert len(pending) == 1
        assert pending[0].id == t1.id

        # Filter by role
        role_2_tasks = TaskService.list({"role_id": role_2})
        assert len(role_2_tasks) == 1
        assert role_2_tasks[0].id == t2.id

    def test_assign_complete_reject_task(self):
        """Test task lifecycle state transitions."""
        task = TaskService.create({
            "activity_id": uuid4(),
            "activity_name": "Lifecycle Task",
            "token_id": uuid4(),
            "workflow_id": uuid4(),
            "role_id": uuid4(),
            "inputs": {},
        })
        assert task.status == "pending"

        # Assign
        assigned = TaskService.assign(str(task.id), "user-99", "admin-1", "human")
        assert assigned.status == "assigned"
        assert assigned.assignee_id == "user-99"

        # Start (optional API transition check)
        started = TaskService.start(str(task.id))
        assert started.status == "in_progress"

        # Complete
        completed = TaskService.complete(str(task.id), {"processed": True})
        assert completed.status == "completed"
        assert completed.outputs == {"processed": True}
        assert completed.completed_at is not None

        # Reject new task
        task2 = TaskService.create({
            "activity_id": uuid4(),
            "activity_name": "Reject Task",
            "token_id": uuid4(),
            "workflow_id": uuid4(),
            "role_id": uuid4(),
            "inputs": {},
        })
        rejected = TaskService.reject(str(task2.id), "Incomplete input documents")
        assert rejected.status == "rejected"
        assert rejected.outputs == {"rejection_reason": "Incomplete input documents"}

    def test_pending_by_role_priority_sorting(self):
        """Test retrieving pending tasks sorted by priority and creation time."""
        role_id = uuid4()
        
        # Create normal priority
        t_normal = TaskService.create({
            "activity_id": uuid4(),
            "activity_name": "Normal Task",
            "token_id": uuid4(),
            "workflow_id": uuid4(),
            "role_id": role_id,
            "inputs": {},
            "priority": "normal",
        })

        # Create critical priority (created after but should sort first)
        t_critical = TaskService.create({
            "activity_id": uuid4(),
            "activity_name": "Critical Task",
            "token_id": uuid4(),
            "workflow_id": uuid4(),
            "role_id": role_id,
            "inputs": {},
            "priority": "critical",
        })

        # Create high priority
        t_high = TaskService.create({
            "activity_id": uuid4(),
            "activity_name": "High Task",
            "token_id": uuid4(),
            "workflow_id": uuid4(),
            "role_id": role_id,
            "inputs": {},
            "priority": "high",
        })

        sorted_tasks = TaskService.get_pending_by_role(str(role_id))
        assert len(sorted_tasks) == 3
        
        # Priorities should be: critical (0) -> high (1) -> normal (2)
        assert sorted_tasks[0].id == t_critical.id
        assert sorted_tasks[1].id == t_high.id
        assert sorted_tasks[2].id == t_normal.id


class TestExecutionService:
    """Tests for WorkflowExecution logging."""

    def test_log_execution(self):
        """Test saving workflow execution metrics."""
        from awa.types import WorkflowExecution

        workflow_id = uuid4()
        exec_id = uuid4()
        
        metrics = WorkflowExecution(
            id=exec_id,
            workflow_id=workflow_id,
            workflow_name="Pricing Pipeline",
            status="completed",
            started_at=datetime.utcnow(),
            completed_at=datetime.utcnow(),
            duration_ms=450,
            input_tokens=150,
            output_tokens=300,
            total_tokens=450,
            execution_cost=0.015,
            currency="USD",
            steps_count=5,
            user_id="user-admin",
            metadata={"source": "api_test"}
        )

        ExecutionService.log_execution(metrics)

        # Verify DB entry
        conn = get_connection()
        cursor = conn.cursor()
        cursor.execute("SELECT * FROM workflow_executions WHERE id = ?", (str(exec_id),))
        row = cursor.fetchone()
        conn.close()

        assert row is not None
        assert row["workflow_name"] == "Pricing Pipeline"
        assert row["duration_ms"] == 450
        assert row["execution_cost"] == 0.015
        assert row["user_id"] == "user-admin"
        assert json.loads(row["metadata"]) == {"source": "api_test"}
