"""
AWA Token
Represents a workflow execution instance moving through activities
"""

from enum import Enum
from datetime import datetime
from typing import Any
from uuid import uuid4


class TokenStatus(str, Enum):
    """Token execution status"""
    ACTIVE = "active"
    COMPLETED = "completed"
    FAILED = "failed"
    WAITING = "waiting"
    CANCELLED = "cancelled"


class Token:
    """
    Token represents an execution instance in a workflow.
    It carries context data and tracks its position and history.
    """
    
    def __init__(
        self,
        activity_id: str,
        initial_data: dict[str, Any] | None = None,
        parent_token_id: str | None = None,
        workflow_id: str | None = None
    ):
        self.id = str(uuid4())
        self.activity_id = activity_id
        self.status = TokenStatus.ACTIVE
        self.context_data: dict[str, Any] = dict(initial_data or {})
        self.history: list[dict[str, Any]] = []
        self.parent_token_id = parent_token_id
        self.workflow_id = workflow_id
        self.created_at = datetime.now()
        self.updated_at = datetime.now()
        
        self._add_to_history(activity_id, "created")
    
    def move(self, next_activity_id: str) -> None:
        """Move token to next activity"""
        self._add_to_history(self.activity_id, "exited")
        self.activity_id = next_activity_id
        self.status = TokenStatus.ACTIVE
        self.updated_at = datetime.now()
        self._add_to_history(next_activity_id, "entered")
    
    def update_status(self, status: TokenStatus) -> None:
        """Update token status"""
        self.status = status
        self.updated_at = datetime.now()
        self._add_to_history(self.activity_id, f"status_change:{status.value}")
    
    def set_data(self, key: str, value: Any) -> None:
        """Set context data"""
        self.context_data[key] = value
        self.updated_at = datetime.now()
    
    def get_data(self, key: str) -> Any:
        """Get context data"""
        return self.context_data.get(key)
    
    def merge_data(self, data: dict[str, Any]) -> None:
        """Merge data into context"""
        self.context_data.update(data)
        self.updated_at = datetime.now()
    
    def _add_to_history(
        self,
        node_id: str,
        action: str,
        metrics: dict[str, float] | None = None
    ) -> None:
        """Add entry to history"""
        self.history.append({
            "node_id": node_id,
            "timestamp": datetime.now().isoformat(),
            "action": action,
            "metrics": metrics
        })
    
    def to_dict(self) -> dict[str, Any]:
        """Convert to dictionary"""
        return {
            "id": self.id,
            "activity_id": self.activity_id,
            "status": self.status.value,
            "context_data": self.context_data,
            "history": self.history,
            "parent_token_id": self.parent_token_id,
            "workflow_id": self.workflow_id,
            "created_at": self.created_at.isoformat(),
            "updated_at": self.updated_at.isoformat()
        }
