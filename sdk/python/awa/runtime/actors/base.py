"""
AWA Base Actor
"""

from abc import ABC, abstractmethod
from typing import Any
from awa.types import Activity
from awa.runtime.token import Token


class Actor(ABC):
    """Base class for all AWA actors."""
    
    @abstractmethod
    def execute(self, activity: Activity, token: Token) -> dict[str, Any]:
        """Execute the given activity for the token."""
        pass
