"""
AWA Human Agent Actor
Handles human task activities with pause/resume and persistent task queue using TaskService.
"""

import re
import time
from datetime import datetime, timedelta
from uuid import uuid4
from typing import Any, Dict, Optional
from awa.types import Activity
from awa.runtime.token import Token
from awa.runtime.services.task_service import TaskService
from .base import Actor


class HumanAgent(Actor):
    """Actor for managing human intervention tasks."""
    
    def __init__(self, options: Optional[Dict[str, Any]] = None):
        opts = options or {}
        self.wait_for_completion = opts.get("wait_for_completion", False)
        self.default_priority = opts.get("default_priority", "normal")
        self.simulate = opts.get("simulate", False)

    def execute(self, activity: Activity, token: Token) -> Dict[str, Any]:
        """Create human task in the SQLite database and optionally wait for completion."""
        inputs = token.context_data
        print(f"[HumanAgent] Executing activity: {activity.name} ({activity.id})")
        
        if self.simulate:
            print(f"[HumanAgent] SIMULATION: Auto-completing task \"{activity.name}\"")
            return {
                **inputs,
                "_human_task_status": "completed",
                "_simulated": True,
                "output": "Simulated human response"
            }

        print(f"[HumanAgent] Creating persistent task for activity: {activity.name} ({activity.id})")
        
        token_id = inputs.get("_token_id", token.id)
        workflow_id = inputs.get("_workflow_id", token.workflow_id) or str(uuid4())

        priority = self.default_priority
        if activity.sla and activity.sla.escalation_policy:
            priority = "high"

        due_date = self.calculate_due_date(activity)

        task = TaskService.create({
            "activity_id": str(activity.id),
            "activity_name": activity.name,
            "token_id": str(token_id),
            "workflow_id": str(workflow_id),
            "priority": priority,
            "role_id": str(activity.role_id) if activity.role_id else "user",
            "creator_id": inputs.get("_last_actor_id", "system"),
            "creator_type": inputs.get("_last_actor_type", "application"),
            "inputs": inputs,
            "description": activity.description,
            "due_at": due_date,
            "tags": []
        })

        print(f"[HumanAgent] Task created in DB: {task.id}")

        if self.wait_for_completion:
            print(f"[HumanAgent] Waiting for task {task.id} completion...")
            completed_task = self.wait_for_task_completion(str(task.id))
            
            if completed_task.status == "rejected":
                outputs = completed_task.outputs or {}
                raise RuntimeError(f"Human task rejected: {outputs.get('rejection_reason', 'No reason provided')}")
                
            outputs = completed_task.outputs or {}
            return {
                **inputs,
                **outputs,
                "_human_task_id": str(task.id),
                "_human_task_status": "completed"
            }

        return {
            **inputs,
            "_human_task_id": str(task.id),
            "_human_task_status": "pending",
            "_requires_human_action": True
        }

    def wait_for_task_completion(self, task_id: str) -> Any:
        """Poll for task completion in blocking mode."""
        while True:
            task = TaskService.get(task_id)
            if task and task.status in ["completed", "rejected"]:
                return task
            time.sleep(2.0)

    def calculate_due_date(self, activity: Activity) -> Optional[str]:
        """Calculate due date based on SLA max_time."""
        if not activity.sla or not activity.sla.max_time:
            return None
            
        duration = activity.sla.max_time
        match = re.match(r"PT?(\d+)([HMSD])", duration)
        if not match:
            return None
            
        value, unit = match.groups()
        val = int(value)
        
        now = datetime.now()
        if unit == 'S':
            delta = timedelta(seconds=val)
        elif unit == 'M':
            delta = timedelta(minutes=val)
        elif unit == 'H':
            delta = timedelta(hours=val)
        elif unit == 'D':
            delta = timedelta(days=val)
        else:
            return None
            
        return (now + delta).isoformat()
