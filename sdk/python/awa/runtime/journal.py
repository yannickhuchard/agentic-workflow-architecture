"""
AWA Execution Journal

The append-only record of a run (specification section 9). Events are plain
JSON objects that validate against journal-event.schema.json.
"""

import hashlib
import json
import os
import time
from datetime import datetime, timezone
from typing import Any, Callable, Protocol
from uuid import uuid4

JOURNAL_SPEC_VERSION = "1.1"

JournalEvent = dict[str, Any]
JournalListener = Callable[[JournalEvent], None]

PAYLOAD_MODES = ("full", "hash", "none")


class JournalStore(Protocol):
    """Where a journal is kept. Events of a run are appended in sequence order."""

    def append(self, event: JournalEvent) -> None: ...

    def read(self, run_id: str, after_seq: int = 0) -> list[JournalEvent]: ...


class InMemoryJournalStore:
    def __init__(self) -> None:
        self._runs: dict[str, list[JournalEvent]] = {}

    def append(self, event: JournalEvent) -> None:
        self._runs.setdefault(event["run_id"], []).append(event)

    def read(self, run_id: str, after_seq: int = 0) -> list[JournalEvent]:
        return [e for e in self._runs.get(run_id, []) if e["seq"] > after_seq]


class FileJournalStore:
    """
    Journal stored as JSON Lines, the interchange format (specification 9.5).
    With a directory, each run is written to `<run_id>.journal.jsonl`.
    With a path ending in `.jsonl`, all events go to that one file.
    """

    def __init__(self, location: str) -> None:
        self.location = str(location)

    def _file_for(self, run_id: str) -> str:
        if self.location.endswith(".jsonl"):
            return self.location
        return os.path.join(self.location, f"{run_id}.journal.jsonl")

    def append(self, event: JournalEvent) -> None:
        path = self._file_for(event["run_id"])
        os.makedirs(os.path.dirname(path) or ".", exist_ok=True)
        with open(path, "a", encoding="utf-8") as handle:
            handle.write(json.dumps(event, ensure_ascii=False) + "\n")

    def read(self, run_id: str, after_seq: int = 0) -> list[JournalEvent]:
        try:
            with open(self._file_for(run_id), encoding="utf-8") as handle:
                events = parse_journal(handle.read())
        except FileNotFoundError:
            return []
        return [e for e in events if e["run_id"] == run_id and e["seq"] > after_seq]


def parse_journal(content: str) -> list[JournalEvent]:
    """Parse JSON Lines journal content. Blank lines are ignored."""
    return [json.loads(line) for line in content.split("\n") if line.strip()]


def canonical_json(value: Any) -> str:
    """JSON with object keys sorted at every depth and no whitespace, so equal values hash equally"""
    if value is None or isinstance(value, bool) or isinstance(value, str):
        return json.dumps(value, ensure_ascii=False)
    if isinstance(value, int):
        return str(value)
    if isinstance(value, float):
        # A whole number is written without a fraction, as other implementations write it
        return str(int(value)) if value.is_integer() and abs(value) < 1e21 else json.dumps(value)
    if isinstance(value, (list, tuple)):
        return "[" + ",".join(canonical_json(item) for item in value) + "]"
    if isinstance(value, dict):
        return "{" + ",".join(
            f"{json.dumps(str(key), ensure_ascii=False)}:{canonical_json(value[key])}" for key in sorted(value, key=str)
        ) + "}"
    return json.dumps(str(value), ensure_ascii=False)


def hash_payload(value: Any) -> str:
    return hashlib.sha256(canonical_json(value).encode("utf-8")).hexdigest()


def public_payload(data: dict[str, Any]) -> dict[str, Any]:
    """Remove engine-reserved properties (prefixed with `_`) and the per-activity archive"""
    return {key: value for key, value in data.items() if not str(key).startswith("_") and key != "activities"}


def _jsonable(value: Any) -> Any:
    """A deep copy that is safe to serialise: the journal must not change when token data does"""
    return json.loads(json.dumps(value, default=str))


def format_time(epoch_ms: float) -> str:
    """RFC 3339 timestamp in UTC"""
    return datetime.fromtimestamp(epoch_ms / 1000, timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


class JournalWriter:
    """
    Writes the journal of one run: assigns sequence numbers, applies the
    payload mode, persists to the store and notifies live listeners.
    """

    def __init__(
        self,
        run_id: str,
        workflow_id: str,
        store: JournalStore,
        payload_mode: str = "full",
        start_seq: int = 0,
        now: Callable[[], float] | None = None,
    ) -> None:
        if payload_mode not in PAYLOAD_MODES:
            raise ValueError(f'Unknown journal payload mode "{payload_mode}": use one of {", ".join(PAYLOAD_MODES)}')
        self.run_id = run_id
        self.workflow_id = workflow_id
        self.store = store
        self.payload_mode = payload_mode
        self._seq = start_seq
        self._now = now or (lambda: time.time() * 1000)
        self._listeners: list[JournalListener] = []

    @property
    def last_seq(self) -> int:
        return self._seq

    def subscribe(self, listener: JournalListener) -> Callable[[], None]:
        self._listeners.append(listener)
        return lambda: self._listeners.remove(listener) if listener in self._listeners else None

    def payload(self, value: Any) -> Any:
        """Represent a payload according to the configured payload mode (specification 9.4)"""
        if self.payload_mode == "full":
            return value
        if self.payload_mode == "hash":
            return {"sha256": hash_payload(value)}
        return None

    def record(
        self,
        type: str,
        data: dict[str, Any] | None = None,
        *,
        level: str = "execution",
        token_id: str | None = None,
        node_id: str | None = None,
        node_name: str | None = None,
        attempt: int | None = None,
    ) -> JournalEvent:
        self._seq += 1
        event: JournalEvent = {
            "spec_version": JOURNAL_SPEC_VERSION,
            "id": str(uuid4()),
            "run_id": self.run_id,
            "seq": self._seq,
            "time": format_time(self._now()),
            "type": type,
            "level": level,
            "workflow_id": self.workflow_id,
        }
        if token_id:
            event["token_id"] = str(token_id)
        if node_id:
            event["node_id"] = str(node_id)
        if node_name:
            event["node_name"] = node_name
        if attempt:
            event["attempt"] = attempt
        # Absent values are left out, as they are in the interchange format
        event["data"] = _jsonable({key: value for key, value in (data or {}).items() if value is not None})
        self.store.append(event)
        for listener in list(self._listeners):
            try:
                listener(event)
            except Exception:
                pass  # a listener must not break the run
        return event
