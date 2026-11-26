"""
Connections a run keeps open to the servers its tools call: MCP servers and
gRPC channels (specification 17.7, 17.8). A connection is opened at the first
call of a run that needs it, reused by every later call of the run, and closed
when the run ends or stops to wait.
"""

import threading
from typing import Any, Callable


class ToolSessions:
    def __init__(self) -> None:
        self._open: dict[str, Any] = {}
        self._locks: dict[str, threading.Lock] = {}
        self._lock = threading.Lock()

    def get(self, key: str, create: Callable[[], Any]) -> Any:
        """The connection kept under `key`, opened by `create` if there is none yet"""
        with self._lock:
            if key in self._open:
                return self._open[key]
            lock = self._locks.setdefault(key, threading.Lock())
        # Opened once even when two calls ask at the same time
        with lock:
            with self._lock:
                if key in self._open:
                    return self._open[key]
            connection = create()  # a connection that failed to open is not kept: the next call tries again
            with self._lock:
                self._open[key] = connection
            return connection

    def discard(self, key: str) -> None:
        """Forget a connection that broke, so that the next call opens a new one"""
        with self._lock:
            connection = self._open.pop(key, None)
        _close(connection)

    def __len__(self) -> int:
        return len(self._open)

    def close(self) -> None:
        """Close every connection. Closing stops a server the engine started."""
        with self._lock:
            connections = list(self._open.values())
            self._open.clear()
        for connection in connections:
            _close(connection)


def _close(connection: Any) -> None:
    close = getattr(connection, "close", None)
    if callable(close):
        try:
            close()
        except Exception:
            pass
