"""
AWA Human Task Queue
Global queue for managing human intervention tasks
"""

from datetime import datetime
from typing import Any, Dict, List, Optional
from uuid import uuid4


class HumanTask:
    """Represents a task requiring human intervention."""
    
    def __init__(
        self,
        activity_id: str,
        workflow_id: str,
        data: Optional[Dict[str, Any]] = None,
        assignee_id: Optional[str] = None
    ):
        self.id = str(uuid4())
        self.activity_id = activity_id
        self.workflow_id = workflow_id
        self.status = "pending"
        self.assignee_id = assignee_id
        self.data = data or {}
        self.created_at = datetime.now()


class HumanTaskQueue:
    """Manages a collection of human tasks."""
    
    def __init__(self):
        self._tasks: Dict[str, HumanTask] = {}
    
    def add(self, task: HumanTask) -> None:
        """Add a task to the queue."""
        self._tasks[task.id] = task
    
    def get(self, task_id: str) -> Optional[HumanTask]:
        """Get a task by ID."""
        return self._tasks.get(task_id)
    
    def list(self, assignee_id: Optional[str] = None) -> List[HumanTask]:
        """List tasks, optionally filtered by assignee."""
        tasks = list(self._tasks.values())
        if assignee_id:
            tasks = [t for t in tasks if t.assignee_id == assignee_id]
        return tasks
    
    def complete(self, task_id: str, data: Dict[str, Any]) -> bool:
        """Complete a task with the given data."""
        task = self._tasks.get(task_id)
        if not task:
            return False
        
        task.status = "completed"
        task.data.update(data)
        return True


# Global singleton instance
_global_queue = HumanTaskQueue()

def get_task_queue() -> HumanTaskQueue:
    """Get the global human task queue instance."""
    return _global_queue
