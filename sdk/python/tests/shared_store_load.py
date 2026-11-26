"""
The workload of the shared store tests, as in sdk/typescript/tests/fixtures/shared_store_load.ts:
a claim journey whose run waits for the customer's documents, notes the customer adds while it
waits, and the actors that do the work. Used by the tests and by the worker processes they start.
"""

import time
from typing import Any

CLAIM_WORKFLOW_ID = "0b6b6f8e-6a43-4c7e-9a4b-2f1d3c5e7a91"
CLAIM_JOURNEY_ID = "5f2c9d1e-3b4a-4f6e-8c7d-1a2b3c4d5e6f"


def _id(n: int) -> str:
    return f"9c1e4f2a-7b3d-4e5f-8a6b-{n:012d}"


CLAIM_WORKFLOW = {
    "id": CLAIM_WORKFLOW_ID, "name": "Claim", "version": "1.0.0", "awa_version": "1.1",
    "activities": [
        {"id": _id(1), "name": "Register", "role_id": _id(9), "actor_type": "application"},
        {"id": _id(2), "name": "Settle", "role_id": _id(9), "actor_type": "application"},
    ],
    "events": [{"id": _id(3), "name": "Documents", "event_type": "message",
                "event_definition": {"name": "documents.uploaded", "correlation_key": "customer_id", "timeout": "P1D"}}],
    "edges": [{"id": _id(4), "source_id": _id(1), "target_id": _id(3)}, {"id": _id(5), "source_id": _id(3), "target_id": _id(2)}],
}

CLAIM_JOURNEY = {
    "id": CLAIM_JOURNEY_ID, "name": "Claim", "version": "1.0.0", "subject": {"name": "customer", "key": "customer_id"},
    "stages": [{"id": "open", "name": "Open", "workflows": [CLAIM_WORKFLOW_ID], "complete_when": "paid == true", "max_duration": "PT1S", "transitions": []}],
    "triggers": [{"event": "claim.submitted", "starts_journey": True, "start_workflow": CLAIM_WORKFLOW_ID}],
    "touchpoints": [{"id": "note", "name": "Adds a note", "direction": "inbound", "channel": "web", "on": {"event": "note.added"}}],
}


class LoadActor:
    """Returns at once, except for the activities named, which take the time given (in milliseconds)"""

    def __init__(self, slow: dict[str, float] | None = None, on_slow: Any = None) -> None:
        self.slow, self.on_slow = slow or {}, on_slow

    def execute(self, activity: Any, token: Any, context: Any = None) -> dict[str, Any]:
        ms = self.slow.get(activity.name)
        if ms:
            if self.on_slow:
                self.on_slow(activity.name)
            time.sleep(ms / 1000)
        if activity.name == "Settle":
            return {"paid": True}
        return {"claim_id": f"CLM-{token.context_data.get('customer_id')}"}


def event(type: str, customer: str, event_id: str, **data: Any) -> dict[str, Any]:
    return {"specversion": "1.0", "id": event_id, "source": "/load", "type": type, "data": {"customer_id": customer, **data}}


def phase(name: str, subjects: int, notes: int) -> list[dict[str, Any]]:
    """The events of one phase of the burst, for every subject"""
    out = []
    for s in range(subjects):
        customer = f"c-{s}"
        if name == "submit":
            out.append(event("claim.submitted", customer, f"submit-{s}"))
        if name == "notes":
            out += [event("note.added", customer, f"note-{s}-{n}", note=n) for n in range(notes)]
        if name == "documents":
            out.append(event("documents.uploaded", customer, f"documents-{s}"))
    return out


def deal(events: list[Any], hosts: int, duplicate_every: int) -> list[list[Any]]:
    """Each event to one host, and every `duplicate_every`th to a second host as well, as a producer that delivers twice would"""
    queues: list[list[Any]] = [[] for _ in range(hosts)]
    for n, e in enumerate(events):
        queues[n % hosts].append(e)
        if duplicate_every and n % duplicate_every == 0:
            queues[(n + 1) % hosts].append(e)
    return [list(reversed(q)) if h % 2 else q for h, q in enumerate(queues)]
