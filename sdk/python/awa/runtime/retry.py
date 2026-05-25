"""
AWA Retry Logic and Dead Letter Queue
Exponential backoff retry, retryability checks, and dead letter queue management.
"""

import math
import random
import re
import time
from typing import Any, Callable, Dict, List, Optional, TypeVar
from uuid import UUID

from awa.runtime.token import Token
from awa.runtime.logger import get_logger, Logger

T = TypeVar('T')

class RetryConfig:
    """Configuration options for retrying operations."""
    
    def __init__(
        self,
        max_retries: int = 3,
        initial_delay_ms: float = 1000.0,
        max_delay_ms: float = 30000.0,
        backoff_multiplier: float = 2.0,
        jitter: bool = True,
        non_retryable_errors: Optional[List[str]] = None
    ):
        self.max_retries = max_retries
        self.initial_delay_ms = initial_delay_ms
        self.max_delay_ms = max_delay_ms
        self.backoff_multiplier = backoff_multiplier
        self.jitter = jitter
        self.non_retryable_errors = non_retryable_errors or [
            "VALIDATION_ERROR",
            "AUTHENTICATION_ERROR",
            "PERMISSION_DENIED",
            "NOT_FOUND"
        ]


DEFAULT_RETRY_CONFIG = RetryConfig()


class RetryState:
    """Maintains retry metrics."""
    
    def __init__(self, attempt: int, started_at: float, last_error: Optional[Exception] = None):
        self.attempt = attempt
        self.started_at = started_at
        self.last_error = last_error
        self.next_retry_at: Optional[float] = None


class DeadLetterEntry:
    """Represents a failed token stored in DLQ."""
    
    def __init__(
        self,
        id: str,
        token: Token,
        workflow_id: str,
        activity_id: str,
        error_message: str,
        retry_state: RetryState,
        error_code: Optional[str] = None,
        metadata: Optional[Dict[str, Any]] = None
    ):
        self.id = id
        self.token = token
        self.workflow_id = workflow_id
        self.activity_id = activity_id
        self.error = {
            "message": error_message,
            "code": error_code
        }
        self.retry_state = retry_state
        self.created_at = time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime())
        self.metadata = metadata or {}

    def to_dict(self) -> Dict[str, Any]:
        """Convert entry to dictionary representation."""
        return {
            "id": self.id,
            "workflow_id": self.workflow_id,
            "activity_id": self.activity_id,
            "error": self.error,
            "created_at": self.created_at,
            "metadata": self.metadata
        }


def calculate_retry_delay(config: RetryConfig, attempt: int) -> float:
    """Calculate exponential backoff retry delay in milliseconds."""
    delay = config.initial_delay_ms * math.pow(config.backoff_multiplier, attempt)
    delay = min(delay, config.max_delay_ms)

    if config.jitter:
        jitter_range = delay * 0.25
        delay += random.uniform(-jitter_range, jitter_range)

    return round(delay, 2)


def is_retryable_error(error: Exception, config: RetryConfig) -> bool:
    """Check if the given exception is retryable based on patterns or codes."""
    # Check for error code if present
    error_code = getattr(error, "code", None)
    if error_code and error_code in config.non_retryable_errors:
        return False

    error_msg = str(error)
    non_retryable_patterns = [
        r"validation",
        r"invalid",
        r"unauthorized",
        r"forbidden",
        r"not found",
        r"permission"
    ]

    for pattern in non_retryable_patterns:
        if re.search(pattern, error_msg, re.IGNORECASE):
            return False

    return True


def with_retry(
    fn: Callable[[], T],
    config: Optional[RetryConfig] = None,
    logger: Optional[Logger] = None
) -> T:
    """Run function with exponential backoff retry."""
    full_config = config or DEFAULT_RETRY_CONFIG
    log = logger or get_logger()
    last_error: Optional[Exception] = None

    for attempt in range(full_config.max_retries + 1):
        try:
            return fn()
        except Exception as error:
            last_error = error

            if attempt >= full_config.max_retries:
                log.error(f"All {full_config.max_retries} retry attempts exhausted", error, {"attempt": attempt})
                raise last_error

            if not is_retryable_error(last_error, full_config):
                log.warn(f"Error is not retryable: {str(last_error)}")
                raise last_error

            delay = calculate_retry_delay(full_config, attempt)
            log.warn(
                f"Retry attempt {attempt + 1}/{full_config.max_retries} after {delay}ms",
                {
                    "error": str(last_error),
                    "attempt": attempt + 1,
                    "delay_ms": delay
                }
            )
            time.sleep(delay / 1000.0)

    if last_error:
        raise last_error
    raise Exception("Retry failed without specific error")


class DeadLetterQueue:
    """Manages DLQ for failed workflow execution tokens."""

    def __init__(self, logger: Optional[Logger] = None):
        self.entries: Dict[str, DeadLetterEntry] = {}
        self.logger = logger or get_logger()

    def add(
        self,
        token: Token,
        workflow_id: str,
        activity_id: str,
        error: Exception,
        retry_state: RetryState,
        metadata: Optional[Dict[str, Any]] = None
    ) -> DeadLetterEntry:
        """Add failed token to Dead Letter Queue."""
        entry = DeadLetterEntry(
            id=token.id,
            token=token,
            workflow_id=workflow_id,
            activity_id=activity_id,
            error_message=str(error),
            retry_state=retry_state,
            error_code=getattr(error, "code", None),
            metadata=metadata
        )
        self.entries[token.id] = entry
        self.logger.error(
            f"Token added to dead letter queue: {str(error)}",
            error,
            {
                "token_id": token.id,
                "workflow_id": workflow_id,
                "activity_id": activity_id,
                "attempts": retry_state.attempt
            }
        )
        return entry

    def get(self, token_id: str) -> Optional[DeadLetterEntry]:
        """Fetch DLQ entry by ID."""
        return self.entries.get(token_id)

    def list(self) -> List[DeadLetterEntry]:
        """List all DLQ entries."""
        return list(self.entries.values())

    def list_by_workflow(self, workflow_id: str) -> List[DeadLetterEntry]:
        """List DLQ entries by workflow ID."""
        return [e for e in self.list() if e.workflow_id == workflow_id]

    def remove(self, token_id: str) -> bool:
        """Remove entry from DLQ."""
        if token_id in self.entries:
            del self.entries[token_id]
            self.logger.info(f"Token removed from dead letter queue", {"token_id": token_id})
            return True
        return False

    def clear(self) -> int:
        """Clear all entries from DLQ."""
        count = len(self.entries)
        self.entries.clear()
        self.logger.info("Dead letter queue cleared", {"count": count})
        return count

    def stats(self) -> Dict[str, Any]:
        """Get DLQ statistics."""
        by_workflow: Dict[str, int] = {}
        for entry in self.entries.values():
            by_workflow[entry.workflow_id] = by_workflow.get(entry.workflow_id, 0) + 1
        return {"total": len(self.entries), "by_workflow": by_workflow}


# Global DLQ instance
_global_dlq: Optional[DeadLetterQueue] = None


def get_dead_letter_queue() -> DeadLetterQueue:
    """Get the global dead letter queue instance."""
    global _global_dlq
    if not _global_dlq:
        _global_dlq = DeadLetterQueue()
    return _global_dlq


def set_dead_letter_queue(dlq: DeadLetterQueue) -> None:
    """Set custom global dead letter queue."""
    global _global_dlq
    _global_dlq = dlq
