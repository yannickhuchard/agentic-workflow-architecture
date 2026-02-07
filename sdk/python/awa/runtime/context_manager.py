"""
AWA Context Manager
Manages shared context data and access control
"""

from typing import Any
from awa.types import Context, AccessMode


class ContextManager:
    """
    Manages workflow contexts with access control.
    """
    
    def __init__(self, contexts: list[Context] | None = None):
        self._contexts: dict[str, Context] = {}
        self._data: dict[str, dict[str, Any]] = {}
        
        for ctx in (contexts or []):
            self._contexts[ctx.id] = ctx
            self._data[ctx.id] = {}
    
    def get_context(self, context_id: str) -> Context | None:
        """Get context definition by ID"""
        return self._contexts.get(context_id)
    
    def read(self, context_id: str) -> dict[str, Any]:
        """Read all data from a context"""
        return dict(self._data.get(context_id, {}))
    
    def read_value(self, context_id: str, key: str) -> Any:
        """Read a specific value from a context"""
        return self._data.get(context_id, {}).get(key)
    
    def write(self, context_id: str, key: str, value: Any) -> None:
        """Write a value to a context"""
        if context_id not in self._data:
            self._data[context_id] = {}
        self._data[context_id][key] = value
    
    def merge(self, context_id: str, data: dict[str, Any]) -> None:
        """Merge data into a context"""
        if context_id not in self._data:
            self._data[context_id] = {}
        self._data[context_id].update(data)
    
    def clear(self, context_id: str) -> None:
        """Clear all data from a context"""
        self._data[context_id] = {}
    
    def check_access(
        self,
        context_id: str,
        role_id: str,
        mode: AccessMode
    ) -> bool:
        """Check if a role has access to a context with given mode"""
        context = self._contexts.get(context_id)
        if not context:
            return False
        
        for access_right in context.access_rights:
            if access_right.role_id == role_id:
                if mode == AccessMode.READ:
                    return access_right.access_mode in (
                        AccessMode.READ, 
                        AccessMode.READ_WRITE
                    )
                elif mode == AccessMode.WRITE:
                    return access_right.access_mode in (
                        AccessMode.WRITE,
                        AccessMode.READ_WRITE
                    )
                elif mode == AccessMode.READ_WRITE:
                    return access_right.access_mode == AccessMode.READ_WRITE
        
        return False
    
    def get_all_data(self) -> dict[str, dict[str, Any]]:
        """Get all context data"""
        return {k: dict(v) for k, v in self._data.items()}
