"""
AWA Human Agent Actor
"""

from uuid import uuid4
from typing import Any
from awa.types import Activity
from awa.runtime.token import Token
from awa.runtime.human_task_queue import get_task_queue, HumanTask
from .base import Actor


class HumanAgent(Actor):
    """Actor for managing human intervention tasks."""
    
    def execute(self, activity: Activity, token: Token) -> dict[str, Any]:
        """Create human task."""
        queue = get_task_queue()
        task = HumanTask(
            activity_id=str(activity.id),
            workflow_id=str(token.workflow_id or ""),
            data=token.context_data
        )
        queue.add(task)
        
        return {
            "_actor": "human_agent",
            "_activity": activity.name,
            "_human_task_id": task.id,
            "_completed": True  # Auto-complete for now in simulation
        }
