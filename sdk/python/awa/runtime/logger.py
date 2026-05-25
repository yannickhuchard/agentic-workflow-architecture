"""
AWA Structured Logger
Provides JSON-based logging with correlation IDs and child logger support.
"""

import json
import os
import sys
import traceback
from contextvars import ContextVar
from datetime import datetime
from typing import Any, Dict, Optional, Callable

# ContextVar to maintain correlation IDs across threads/tasks
_correlation_id_var: ContextVar[Optional[str]] = ContextVar("correlation_id", default=None)

# Console color escape codes for text formatting
COLORS = {
    "DEBUG": "\033[36m",  # Cyan
    "INFO": "\033[32m",   # Green
    "WARNING": "\033[33m",# Yellow
    "ERROR": "\033[31m",  # Red
    "RESET": "\033[0m"
}


class Logger:
    """Structured JSON Logger aligning with TypeScript Logger class."""

    def __init__(
        self,
        level: str = "INFO",
        log_format: str = "json",
        timestamps: bool = True,
        output_func: Optional[Callable[[Dict[str, Any]], None]] = None
    ):
        self.level = level.upper()
        self.format = log_format.lower()
        self.timestamps = timestamps
        self.output_func = output_func
        self.context: Dict[str, Any] = {}
        
        self.level_priority = {
            "DEBUG": 0,
            "INFO": 1,
            "WARNING": 2,
            "ERROR": 3
        }

    def child(self, context: Dict[str, Any]) -> "Logger":
        """Create a child logger with merged context."""
        child_logger = Logger(
            level=self.level,
            log_format=self.format,
            timestamps=self.timestamps,
            output_func=self.output_func
        )
        child_logger.context = {**self.context, **context}
        return child_logger

    def set_correlation_id(self, correlation_id: str) -> None:
        """Set correlation ID for context tracing."""
        _correlation_id_var.set(correlation_id)

    def get_correlation_id(self) -> Optional[str]:
        """Retrieve current correlation ID."""
        return _correlation_id_var.get()

    def generate_correlation_id(self) -> str:
        """Generate a random unique correlation ID."""
        import random
        cid = f"{int(datetime.now().timestamp() * 1000)}-{random.randint(100000, 999999)}"
        self.set_correlation_id(cid)
        return cid

    def _should_log(self, level: str) -> bool:
        return self.level_priority.get(level, 1) >= self.level_priority.get(self.level, 1)

    def _log(self, level: str, message: str, metadata: Optional[Dict[str, Any]] = None) -> None:
        if not self._should_log(level):
            return

        entry: Dict[str, Any] = {
            "timestamp": datetime.utcnow().isoformat() + "Z" if self.timestamps else "",
            "level": level.lower(),
            "message": message,
            "correlation_id": self.get_correlation_id(),
        }
        
        # Merge logger contexts
        for k, v in self.context.items():
            entry[k] = v

        if metadata:
            entry["metadata"] = metadata

        if self.output_func:
            self.output_func(entry)
            return

        if self.format == "json":
            # Strip empty fields
            clean_entry = {k: v for k, v in entry.items() if v is not None and v != ""}
            print(json.dumps(clean_entry))
            sys.stdout.flush()
        else:
            self._log_text(entry)

    def _log_text(self, entry: Dict[str, Any]) -> None:
        parts = []
        if entry.get("timestamp"):
            parts.append(f"[{entry['timestamp']}]")
            
        lvl = entry["level"].upper()
        color = COLORS.get(lvl, "")
        reset = COLORS["RESET"]
        parts.append(f"{color}{lvl:<5}{reset}")

        if entry.get("correlation_id"):
            parts.append(f"[{entry['correlation_id']}]")

        parts.append(entry["message"])

        meta = entry.get("metadata")
        if meta:
            parts.append(json.dumps(meta))

        print(" ".join(parts))
        
        if "error" in entry:
            err = entry["error"]
            if isinstance(err, dict) and "stack" in err:
                print(err["stack"])
        sys.stdout.flush()

    def debug(self, message: str, metadata: Optional[Dict[str, Any]] = None) -> None:
        self._log("DEBUG", message, metadata)

    def info(self, message: str, metadata: Optional[Dict[str, Any]] = None) -> None:
        self._log("INFO", message, metadata)

    def warning(self, message: str, metadata: Optional[Dict[str, Any]] = None) -> None:
        self._log("WARNING", message, metadata)

    def warn(self, message: str, metadata: Optional[Dict[str, Any]] = None) -> None:
        """Alias for warning."""
        self.warning(message, metadata)

    def error(self, message: str, error: Optional[Any] = None, metadata: Optional[Dict[str, Any]] = None) -> None:
        error_info = None
        if error:
            if isinstance(error, Exception):
                error_info = {
                    "message": str(error),
                    "stack": "".join(traceback.format_exception(type(error), error, error.__traceback__))
                }
            else:
                error_info = {"message": str(error)}

        meta = {**(metadata or {})}
        if error_info:
            meta["error"] = error_info

        self._log("ERROR", message, meta)

    def workflow(self, event: str, workflow_id: str, metadata: Optional[Dict[str, Any]] = None) -> None:
        """Log workflow events."""
        meta = {**(metadata or {}), "workflow_id": workflow_id}
        self.info(f"[Workflow] {event}", meta)

    def activity(self, event: str, activity_id: str, metadata: Optional[Dict[str, Any]] = None) -> None:
        """Log activity events."""
        meta = {**(metadata or {}), "activity_id": activity_id}
        self.info(f"[Activity] {event}", meta)


# Global logger instance
_global_logger: Optional[Logger] = None


def get_logger() -> Logger:
    """Get or initialize global logger."""
    global _global_logger
    if not _global_logger:
        level = os.environ.get("LOG_LEVEL", "INFO")
        fmt = os.environ.get("LOG_FORMAT", "json")
        _global_logger = Logger(level=level, log_format=fmt)
    return _global_logger


def set_logger(logger: Logger) -> None:
    """Set global logger instance."""
    global _global_logger
    _global_logger = logger


def create_logger_from_env() -> Logger:
    """Create a logger instance configured from environment variables."""
    level = os.environ.get("LOG_LEVEL", "INFO")
    fmt = os.environ.get("LOG_FORMAT", "json")
    timestamps = os.environ.get("LOG_TIMESTAMPS", "true").lower() != "false"
    return Logger(level=level, log_format=fmt, timestamps=timestamps)
