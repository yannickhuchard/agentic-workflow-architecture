"""
AWA Robot Agent Actor
"""

from typing import Any
from awa.types import Activity
from awa.runtime.token import Token
from .base import Actor


class RobotAgent(Actor):
    """Actor for executing physical robot tasks."""
    
    def execute(self, activity: Activity, token: Token) -> dict[str, Any]:
        """Execute robot task."""
        return {
            "_actor": "robot_agent",
            "_activity": activity.name,
            "_simulated": True,
            "_completed": True
        }
