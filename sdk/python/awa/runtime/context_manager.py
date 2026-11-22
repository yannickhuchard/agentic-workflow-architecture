"""
AWA Contexts (specification section 22): what the activities of a run share.

An activity sees and changes a context only through a binding. The manager
holds the values; the engine decides who may read and write.
"""

from __future__ import annotations

import copy
from typing import Any

from awa.runtime.duration import parse_iso_duration
from awa.types import Context


class _NoValue:
    """What `get` returns for a context that has no value. `None` is a value: JSON null."""

    def __repr__(self) -> str:
        return "NO_VALUE"

    def __bool__(self) -> bool:
        return False


NO_VALUE: Any = _NoValue()


class ContextError(Exception):
    """A context that does not exist, or a value its schema or its sync pattern refuses"""

    def __init__(self, message: str, code: str):
        super().__init__(message)
        self.code = code  # CONTEXT_INVALID or CONTEXT_NOT_FOUND


def _plain(value: Any) -> Any:
    return getattr(value, "value", value)


class ContextManager:
    """The values of a workflow's contexts, keyed by context id"""

    def __init__(self, contexts: list[Context] | None = None):
        self._contexts: dict[str, Context] = {}
        self._values: dict[str, Any] = {}
        self._written_at: dict[str, float] = {}
        for context in contexts or []:
            self.register(context)

    def register(self, context: Context) -> None:
        context_id = str(context.id)
        self._contexts[context_id] = context
        # A context without an initial value has no value until something is written to it (22.1)
        if "initial_value" in context.model_fields_set:
            self._values[context_id] = copy.deepcopy(context.initial_value)

    def get_context(self, context_id: Any) -> Context | None:
        """The definition of a context, or None when the workflow declares none with this id"""
        return self._contexts.get(str(context_id))

    def _definition(self, context_id: Any) -> Context:
        context = self._contexts.get(str(context_id))
        if context is None:
            raise ContextError(f"Context with ID {context_id} not found", "CONTEXT_NOT_FOUND")
        return context

    def list(self) -> list[Context]:
        return list(self._contexts.values())

    def get(self, context_id: Any, now: float | None = None) -> Any:
        """
        The value of a context now, or NO_VALUE. A transient context with a time
        to live has no value once that long has passed since it was last written.
        `now` is in milliseconds since the epoch; without it the time to live is not applied.
        """
        context = self._definition(context_id)
        key = str(context_id)
        if now is not None and _plain(context.lifecycle) == "transient" and context.ttl and key in self._written_at:
            if now - self._written_at[key] > parse_iso_duration(context.ttl):
                return NO_VALUE
        return self._values.get(key, NO_VALUE)

    def set(self, context_id: Any, value: Any, now: float | None = None) -> None:
        """Replace the value, whatever the sync pattern. Checked against the context's schema."""
        context = self._definition(context_id)
        self._check(context, value)
        self._store(str(context_id), value, now)

    def write(self, context_id: Any, value: Any, now: float | None = None) -> Any:
        """
        Write as the context's sync pattern says (22.3): shared_state replaces the
        value; blackboard merges the properties written into it; message_passing
        and event_sourcing append what is written to a list. Returns the value the
        context has afterwards.
        """
        context = self._definition(context_id)
        current = self.get(context_id, now)
        pattern = _plain(context.sync_pattern)
        if pattern == "blackboard":
            if not isinstance(value, dict):
                raise ContextError(
                    f'Context "{context.name}" is a blackboard: what is written to it must be an object', "CONTEXT_INVALID")
            after: Any = {**(current if isinstance(current, dict) else {}), **value}
            self._check(context, after)
        elif pattern in ("message_passing", "event_sourcing"):
            self._check(context, value)  # the schema describes one entry
            after = [*(current if isinstance(current, list) else []), value]
        else:
            after = value
            self._check(context, after)
        self._store(str(context_id), after, now)
        return copy.deepcopy(after)

    def update(self, context_id: Any, partial_value: Any) -> None:
        """Merge into an object value; any other value is replaced"""
        current = self.get(context_id)
        if current is NO_VALUE or current is None:
            current = {}
        if isinstance(current, dict):
            self.set(context_id, {**current, **(partial_value if isinstance(partial_value, dict) else {})})
        else:
            self.set(context_id, partial_value)

    def _store(self, key: str, value: Any, now: float | None) -> None:
        self._values[key] = copy.deepcopy(value)
        if now is not None:
            self._written_at[key] = now

    def _check(self, context: Context, value: Any) -> None:
        schema = context.schema_
        if not schema:
            return
        try:
            from jsonschema import Draft202012Validator, FormatChecker
        except ImportError:
            # Fail closed: a value that cannot be checked is not written
            raise ContextError(
                f'What was written to context "{context.name}" could not be checked against its schema: '
                "the 'jsonschema' package is not installed", "CONTEXT_INVALID") from None
        try:
            Draft202012Validator.check_schema(schema)
            validator = Draft202012Validator(schema, format_checker=FormatChecker())
            problems = sorted(validator.iter_errors(value), key=lambda e: [str(p) for p in e.absolute_path])
        except Exception as error:
            raise ContextError(
                f'Context "{context.name}" has a schema that is not a JSON Schema: {getattr(error, "message", error)}',
                "CONTEXT_INVALID") from None
        if problems:
            why = "; ".join(
                f"{'/' + '/'.join(str(p) for p in e.absolute_path) if e.absolute_path else '/'} {e.message}"
                for e in problems[:3])
            raise ContextError(
                f'What was written to context "{context.name}" does not match its schema: {why}', "CONTEXT_INVALID")

    # -- checkpoints ------------------------------------------------------

    def snapshot(self) -> dict[str, Any]:
        """Every context value, keyed by context id. A context with no value is left out."""
        return copy.deepcopy(self._values)

    def snapshot_times(self) -> dict[str, float]:
        """When each context was last written, for a checkpoint"""
        return dict(self._written_at)

    def replace(self, values: dict[str, Any], times: dict[str, float] | None = None) -> None:
        """Put every value back as it was: what is not in the snapshot has no value again"""
        self._values = copy.deepcopy(dict(values))
        self._written_at = dict(times or {})

    def restore(self, values: dict[str, Any] | None, times: dict[str, float] | None = None) -> None:
        """Take context values from a checkpoint. Ids the workflow does not declare are ignored."""
        for context_id, value in (values or {}).items():
            if context_id in self._contexts:
                self._values[context_id] = copy.deepcopy(value)
        for context_id, at in (times or {}).items():
            if context_id in self._contexts:
                self._written_at[context_id] = at

    def get_all_data(self) -> dict[str, Any]:
        """Every context value, keyed by context id (the name the earlier interface used for snapshot())"""
        return self.snapshot()
