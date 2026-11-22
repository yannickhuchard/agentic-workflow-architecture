"""
Business events (specification section 18)

The envelope AWA uses for events that cross its boundary, in either direction:
a CloudEvents 1.0 event in JSON form. `type` names the event, `id` together
with `source` identifies one occurrence, `data` carries the facts.
"""

from datetime import datetime, timezone
from typing import Any, Callable
from uuid import uuid4

BusinessEvent = dict[str, Any]

# Receives the events a workflow publishes: a Kafka producer, a webhook caller, a queue.
EventSink = Callable[[BusinessEvent], None]


def business_event(type: str, data: dict[str, Any] | None = None, **extra: Any) -> BusinessEvent:
    """
    A business event of this type. `id`, `source`, `time` and `subject` may be
    given as keyword arguments; an id is generated and the time is now otherwise.
    """
    if not type or not isinstance(type, str):
        raise ValueError("A business event needs a type")
    return {
        "specversion": "1.0",
        "id": str(uuid4()),
        "source": "/awa",
        "type": type,
        "time": datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z"),
        "datacontenttype": "application/json",
        "data": dict(data or {}),
        **{key: value for key, value in extra.items() if value is not None},
    }
