"""
The protocols tools and actors speak to what lies outside the engine:
Model Context Protocol servers and gRPC services (specification 17.7, 17.8)
and agents over A2A (specification 28).
"""

from awa.runtime.protocols.sessions import ToolSessions

__all__ = ["ToolSessions"]
