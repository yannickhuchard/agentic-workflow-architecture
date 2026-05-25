"""
AWA Task Service
Manages persistence and retrieval of human tasks and workflow executions in SQLite.
"""

import json
from datetime import datetime
from uuid import UUID, uuid4
from typing import Any, Dict, List, Optional
from awa.runtime.persistence.db import get_connection
from awa.types import HumanTask, WorkflowExecution


class TaskService:
    """Service to handle persistence of AWA workflow execution and task elements."""

    @staticmethod
    def map_to_domain(row: dict) -> HumanTask:
        """Map raw DB row to HumanTask Pydantic model."""
        return HumanTask(
            id=UUID(row["id"]),
            activity_id=UUID(row["activity_id"]),
            activity_name=row["activity_name"],
            token_id=UUID(row["token_id"]),
            workflow_id=UUID(row["workflow_id"]),
            status=row["status"],
            priority=row["priority"],
            assignee_id=row["assignee_id"],
            role_id=UUID(row["role_id"]),
            creator_id=row["creator_id"],
            creator_type=row["creator_type"],
            assigner_id=row["assigner_id"],
            assigner_type=row["assigner_type"],
            inputs=json.loads(row["inputs"]),
            outputs=json.loads(row["outputs"]) if row["outputs"] else None,
            created_at=datetime.fromisoformat(row["created_at"]),
            updated_at=datetime.fromisoformat(row["updated_at"]),
            due_at=datetime.fromisoformat(row["due_at"]) if row["due_at"] else None,
            completed_at=datetime.fromisoformat(row["completed_at"]) if row["completed_at"] else None,
            description=row["description"],
            form_schema=json.loads(row["form_schema"]) if row["form_schema"] else None,
            tags=json.loads(row["tags"]) if row["tags"] else None
        )

    @staticmethod
    def create(data: Dict[str, Any]) -> HumanTask:
        """Create a new human task record in the database."""
        conn = get_connection()
        cursor = conn.cursor()

        task_id = str(data.get("id") or uuid4())
        created_at = data.get("created_at") or datetime.now().isoformat()
        updated_at = data.get("updated_at") or datetime.now().isoformat()

        cursor.execute(
            """
            INSERT INTO human_tasks (
                id, activity_id, activity_name, token_id, workflow_id,
                status, priority, assignee_id, role_id, creator_id,
                creator_type, assigner_id, assigner_type, inputs, outputs,
                created_at, updated_at, due_at, completed_at, description,
                form_schema, tags
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                task_id,
                str(data["activity_id"]),
                data["activity_name"],
                str(data["token_id"]),
                str(data["workflow_id"]),
                data.get("status", "pending"),
                data.get("priority", "normal"),
                data.get("assignee_id"),
                str(data["role_id"]),
                data.get("creator_id"),
                data.get("creator_type"),
                data.get("assigner_id"),
                data.get("assigner_type"),
                json.dumps(data.get("inputs", {})),
                json.dumps(data["outputs"]) if data.get("outputs") is not None else None,
                created_at,
                updated_at,
                data.get("due_at"),
                data.get("completed_at"),
                data.get("description"),
                json.dumps(data["form_schema"]) if data.get("form_schema") is not None else None,
                json.dumps(data["tags"]) if data.get("tags") is not None else None,
            ),
        )
        conn.commit()
        
        # Reload to return full populated model
        cursor.execute("SELECT * FROM human_tasks WHERE id = ?", (task_id,))
        row = dict(cursor.fetchone())
        conn.close()

        return TaskService.map_to_domain(row)

    @staticmethod
    def get(task_id: str) -> Optional[HumanTask]:
        """Fetch a specific task by ID."""
        conn = get_connection()
        cursor = conn.cursor()
        cursor.execute("SELECT * FROM human_tasks WHERE id = ?", (task_id,))
        row = cursor.fetchone()
        conn.close()
        if not row:
            return None
        return TaskService.map_to_domain(dict(row))

    @staticmethod
    def list(filters: Optional[Dict[str, Any]] = None) -> List[HumanTask]:
        """List tasks, optionally filtered by status, assignee_id, role_id, workflow_id."""
        conn = get_connection()
        cursor = conn.cursor()

        query = "SELECT * FROM human_tasks"
        params = []
        conditions = []

        if filters:
            if filters.get("status"):
                conditions.append("status = ?")
                params.append(filters["status"])
            if filters.get("assignee_id"):
                conditions.append("assignee_id = ?")
                params.append(filters["assignee_id"])
            if filters.get("role_id"):
                conditions.append("role_id = ?")
                params.append(str(filters["role_id"]))
            if filters.get("workflow_id"):
                conditions.append("workflow_id = ?")
                params.append(str(filters["workflow_id"]))

        if conditions:
            query += " WHERE " + " AND ".join(conditions)

        query += " ORDER BY created_at DESC"
        
        cursor.execute(query, params)
        rows = cursor.fetchall()
        conn.close()

        return [TaskService.map_to_domain(dict(r)) for r in rows]

    @staticmethod
    def assign(task_id: str, assignee_id: str, assigner_id: Optional[str] = None, assigner_type: Optional[str] = None) -> HumanTask:
        """Assign task to a user and set status to assigned."""
        conn = get_connection()
        cursor = conn.cursor()
        updated_at = datetime.now().isoformat()
        cursor.execute(
            """
            UPDATE human_tasks 
            SET assignee_id = ?, assigner_id = ?, assigner_type = ?, status = 'assigned', updated_at = ?
            WHERE id = ?
            """,
            (assignee_id, assigner_id, assigner_type, updated_at, task_id),
        )
        conn.commit()

        # Reload
        cursor.execute("SELECT * FROM human_tasks WHERE id = ?", (task_id,))
        row = cursor.fetchone()
        conn.close()
        if not row:
            raise ValueError(f"Task with id {task_id} not found")
        return TaskService.map_to_domain(dict(row))

    @staticmethod
    def start(task_id: str) -> HumanTask:
        """Start execution of a task."""
        conn = get_connection()
        cursor = conn.cursor()
        updated_at = datetime.now().isoformat()
        cursor.execute(
            "UPDATE human_tasks SET status = 'in_progress', updated_at = ? WHERE id = ?",
            (updated_at, task_id),
        )
        conn.commit()

        # Reload
        cursor.execute("SELECT * FROM human_tasks WHERE id = ?", (task_id,))
        row = cursor.fetchone()
        conn.close()
        if not row:
            raise ValueError(f"Task with id {task_id} not found")
        return TaskService.map_to_domain(dict(row))

    @staticmethod
    def complete(task_id: str, outputs: Dict[str, Any]) -> HumanTask:
        """Mark task as completed with output data."""
        conn = get_connection()
        cursor = conn.cursor()
        completed_at = datetime.now().isoformat()
        updated_at = datetime.now().isoformat()
        cursor.execute(
            """
            UPDATE human_tasks 
            SET status = 'completed', outputs = ?, completed_at = ?, updated_at = ?
            WHERE id = ?
            """,
            (json.dumps(outputs), completed_at, updated_at, task_id),
        )
        conn.commit()

        # Reload
        cursor.execute("SELECT * FROM human_tasks WHERE id = ?", (task_id,))
        row = cursor.fetchone()
        conn.close()
        if not row:
            raise ValueError(f"Task with id {task_id} not found")
        return TaskService.map_to_domain(dict(row))

    @staticmethod
    def reject(task_id: str, reason: str) -> HumanTask:
        """Mark task as rejected with reason."""
        conn = get_connection()
        cursor = conn.cursor()
        updated_at = datetime.now().isoformat()
        outputs = {"rejection_reason": reason}
        cursor.execute(
            """
            UPDATE human_tasks 
            SET status = 'rejected', outputs = ?, updated_at = ?
            WHERE id = ?
            """,
            (json.dumps(outputs), updated_at, task_id),
        )
        conn.commit()

        # Reload
        cursor.execute("SELECT * FROM human_tasks WHERE id = ?", (task_id,))
        row = cursor.fetchone()
        conn.close()
        if not row:
            raise ValueError(f"Task with id {task_id} not found")
        return TaskService.map_to_domain(dict(row))

    @staticmethod
    def get_pending_by_role(role_id: str) -> List[HumanTask]:
        """Get pending tasks for a role sorted by priority (critical > high > normal > low) and age."""
        tasks = TaskService.list({"role_id": role_id, "status": "pending"})

        priority_order = {
            "critical": 0,
            "high": 1,
            "normal": 2,
            "low": 3
        }

        # Sort tasks: priority ascending (since lower number = higher priority), then by created_at time ascending
        def sort_key(task: HumanTask):
            priority = priority_order.get(task.priority, 2)
            return (priority, task.created_at)

        return sorted(tasks, key=sort_key)


class ExecutionService:
    """Service to handle persistence of WorkflowExecution metrics."""

    @staticmethod
    def log_execution(metrics: WorkflowExecution) -> None:
        """Save a workflow execution record to SQLite."""
        try:
            conn = get_connection()
            cursor = conn.cursor()
            cursor.execute(
                """
                INSERT INTO workflow_executions (
                    id, workflow_id, workflow_name, status, started_at, completed_at,
                    duration_ms, input_tokens, output_tokens, total_tokens, execution_cost,
                    currency, steps_count, user_id, metadata
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    str(metrics.id),
                    str(metrics.workflow_id),
                    metrics.workflow_name,
                    metrics.status,
                    metrics.started_at.isoformat(),
                    metrics.completed_at.isoformat(),
                    metrics.duration_ms,
                    metrics.input_tokens,
                    metrics.output_tokens,
                    metrics.total_tokens,
                    metrics.execution_cost,
                    metrics.currency,
                    metrics.steps_count,
                    metrics.user_id,
                    json.dumps(metrics.metadata) if metrics.metadata is not None else None,
                ),
            )
            conn.commit()
            conn.close()
        except Exception as e:
            # Match TS SDK approach: print/log error but do not throw to block workflow completion
            print(f"[ExecutionService] Failed to log execution metrics: {e}")
