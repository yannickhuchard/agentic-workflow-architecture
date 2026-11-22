"""
AWA Checkpoints (specification 10.3)

A checkpoint store keeps the latest state of each run, keyed by run id, so
that a run can be continued in another process with WorkflowEngine.restore().
"""

import json
import os
from typing import Any, Protocol

WorkflowState = dict[str, Any]


class CheckpointStore(Protocol):
    def save(self, run_id: str, state: WorkflowState) -> None: ...

    def load(self, run_id: str) -> WorkflowState | None: ...


class InMemoryCheckpointStore:
    def __init__(self) -> None:
        self._states: dict[str, str] = {}

    def save(self, run_id: str, state: WorkflowState) -> None:
        # Serialised at once: a checkpoint must not change when the run goes on
        self._states[run_id] = json.dumps(state, default=str)

    def load(self, run_id: str) -> WorkflowState | None:
        return json.loads(self._states[run_id]) if run_id in self._states else None


class FileCheckpointStore:
    """One JSON file per run, `<run_id>.checkpoint.json`, replaced atomically on every save"""

    def __init__(self, directory: str) -> None:
        self.directory = str(directory)

    def _file_for(self, run_id: str) -> str:
        return os.path.join(self.directory, f"{run_id}.checkpoint.json")

    def save(self, run_id: str, state: WorkflowState) -> None:
        os.makedirs(self.directory, exist_ok=True)
        path = self._file_for(run_id)
        with open(path + ".tmp", "w", encoding="utf-8") as handle:
            json.dump(state, handle, default=str)
        os.replace(path + ".tmp", path)

    def load(self, run_id: str) -> WorkflowState | None:
        try:
            with open(self._file_for(run_id), encoding="utf-8") as handle:
                return json.load(handle)
        except FileNotFoundError:
            return None
