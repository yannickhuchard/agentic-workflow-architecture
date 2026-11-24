"""
A runtime store in PostgreSQL (specification section 29)

Several hosts, in several processes or on several machines, keep their
journeys and runs in one database. The store meets the contract of
shared_store.py this way:

- an operation is one transaction; what it changed is committed together with
  the journal events its runs recorded, or rolled back with them;
- a partition is held with a transaction-scoped advisory lock, so that a host
  that stops, or whose connection is lost, releases what it held at once; one
  that hangs releases it when its lease (an idle transaction timeout) runs out;
- an event is accepted by inserting its id, the primary key of
  business_events, in the operation's transaction: the same id inserted by
  another host waits for that host's transaction and is then refused;
- a row is written back only at the version that was loaded;
- deadlines are found by due_at, and their partitions held with
  pg_try_advisory_xact_lock, skipping those another operation holds.

The tables are those of spec/ddl/awa.postgresql.sql, section "Runtime store",
created in schema awa_runtime by the migrations below: the same statements as
the TypeScript SDK runs, so that both SDKs read and write one store.

Needs psycopg 3: pip install "agentic-workflow-architecture[postgres]".
"""

import json
import os
import random
import socket
import threading
import time
from collections.abc import Callable
from datetime import datetime, timezone
from typing import Any
from uuid import uuid4

from awa.runtime.business_event import BusinessEvent
from awa.runtime.journal import JournalEvent
from awa.runtime.journey import parse_journey, time_ms
from awa.runtime.shared_store import SETTLED_STATUSES, StoreConflict, StoredInstance, StoredRun

# The environment variable naming the shared runtime store. AWA_DATABASE_URL is another thing: the human task database.
RUNTIME_STORE_VARIABLE = "AWA_RUNTIME_STORE"

# The statements that come before any migration: the schema and the record of migrations
RUNTIME_STORE_BOOTSTRAP = """
CREATE SCHEMA IF NOT EXISTS awa_runtime;
CREATE TABLE IF NOT EXISTS awa_runtime.migrations (
    version INTEGER PRIMARY KEY,
    description TEXT NOT NULL,
    applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    applied_by TEXT NOT NULL
);
"""

# The migrations the store runs, in order, each recorded in awa_runtime.migrations once applied
RUNTIME_STORE_MIGRATIONS: list[dict[str, Any]] = [
    {
        "version": 1,
        "description": "Runtime store: definitions, accepted events, journey instances and events, runs and journals",
        "sql": """
CREATE TABLE awa_runtime.definitions (
    kind TEXT NOT NULL CHECK (kind IN ('workflow', 'journey')),
    id TEXT NOT NULL,
    name TEXT NOT NULL,
    version TEXT,
    document JSONB NOT NULL,
    added_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (kind, id)
);

CREATE TABLE awa_runtime.business_events (
    id TEXT PRIMARY KEY,
    source TEXT NOT NULL,
    type TEXT NOT NULL,
    subject TEXT,
    time TIMESTAMPTZ,
    data JSONB NOT NULL DEFAULT '{}',
    accepted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    accepted_by TEXT NOT NULL
);
CREATE INDEX business_events_type ON awa_runtime.business_events (type, accepted_at);

CREATE TABLE awa_runtime.journey_instances (
    id TEXT PRIMARY KEY,
    journey_id TEXT NOT NULL,
    subject_key TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('active', 'completed', 'abandoned')),
    stage_id TEXT NOT NULL,
    stalled BOOLEAN NOT NULL DEFAULT FALSE,
    started_at TIMESTAMPTZ NOT NULL,
    ended_at TIMESTAMPTZ,
    partition_key TEXT NOT NULL,
    due_at TIMESTAMPTZ,
    position BIGSERIAL NOT NULL,
    version INTEGER NOT NULL DEFAULT 1,
    document JSONB NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_by TEXT NOT NULL
);
CREATE UNIQUE INDEX journey_instances_active ON awa_runtime.journey_instances (journey_id, subject_key) WHERE status = 'active';
CREATE INDEX journey_instances_partition ON awa_runtime.journey_instances (partition_key);
CREATE INDEX journey_instances_due ON awa_runtime.journey_instances (due_at) WHERE due_at IS NOT NULL;

CREATE TABLE awa_runtime.journey_events (
    journey_instance_id TEXT NOT NULL REFERENCES awa_runtime.journey_instances(id) DEFERRABLE INITIALLY DEFERRED,
    seq INTEGER NOT NULL CHECK (seq >= 1),
    spec_version TEXT NOT NULL,
    journey_id TEXT NOT NULL,
    time TIMESTAMPTZ NOT NULL,
    type TEXT NOT NULL,
    stage_id TEXT,
    run_id TEXT,
    data JSONB NOT NULL DEFAULT '{}',
    PRIMARY KEY (journey_instance_id, seq)
);
CREATE INDEX journey_events_type ON awa_runtime.journey_events (journey_id, type, time);

CREATE TABLE awa_runtime.runs (
    id TEXT PRIMARY KEY,
    workflow_id TEXT NOT NULL,
    workflow_version TEXT,
    status TEXT NOT NULL,
    journey_instance_id TEXT REFERENCES awa_runtime.journey_instances(id) DEFERRABLE INITIALLY DEFERRED,
    partition_key TEXT NOT NULL,
    due_at TIMESTAMPTZ,
    waits_for TEXT[] NOT NULL DEFAULT '{}',
    waits JSONB NOT NULL DEFAULT '[]',
    outbox JSONB NOT NULL DEFAULT '[]',
    checkpoint JSONB NOT NULL,
    checkpoint_at TIMESTAMPTZ NOT NULL,
    started_at TIMESTAMPTZ NOT NULL,
    ended_at TIMESTAMPTZ,
    position BIGSERIAL NOT NULL,
    version INTEGER NOT NULL DEFAULT 1,
    updated_by TEXT NOT NULL
);
CREATE INDEX runs_partition ON awa_runtime.runs (partition_key) WHERE status NOT IN ('completed', 'failed', 'cancelled');
CREATE INDEX runs_waits_for ON awa_runtime.runs USING GIN (waits_for);
CREATE INDEX runs_due ON awa_runtime.runs (due_at) WHERE due_at IS NOT NULL;

CREATE TABLE awa_runtime.journal_events (
    run_id TEXT NOT NULL REFERENCES awa_runtime.runs(id) DEFERRABLE INITIALLY DEFERRED,
    seq INTEGER NOT NULL CHECK (seq >= 1),
    id TEXT NOT NULL UNIQUE,
    spec_version TEXT NOT NULL,
    time TIMESTAMPTZ NOT NULL,
    type TEXT NOT NULL,
    level TEXT NOT NULL DEFAULT 'execution' CHECK (level IN ('execution', 'reasoning', 'meta')),
    workflow_id TEXT NOT NULL,
    token_id TEXT,
    node_id TEXT,
    node_name TEXT,
    attempt INTEGER CHECK (attempt >= 1),
    data JSONB NOT NULL DEFAULT '{}',
    PRIMARY KEY (run_id, seq)
);
CREATE INDEX journal_events_type ON awa_runtime.journal_events (type);
""",
    },
]

# Errors after which an operation is begun again: it met another host's operation
_RETRYABLE = {"40001", "40P01", "23505", "55P03"}
_TIME = "to_char({} AT TIME ZONE 'UTC', 'YYYY-MM-DD\"T\"HH24:MI:SS.MS\"Z\"')"
_JOURNAL_COLUMNS = ("run_id, seq, id, spec_version, " + _TIME.format("time") + " AS time, type, level, workflow_id, "
                    "token_id, node_id, node_name, attempt, data")


def _iso(ms: float | None) -> str | None:
    if ms is None:
        return None
    return datetime.fromtimestamp(ms / 1000, tz=timezone.utc).isoformat()


def _valid_time(text: Any) -> str | None:
    if not isinstance(text, str):
        return None
    try:
        return _iso(time_ms(text))
    except (ValueError, OverflowError):
        return None


def _journal_event(row: dict[str, Any]) -> JournalEvent:
    event: JournalEvent = {
        "spec_version": row["spec_version"], "id": row["id"], "run_id": row["run_id"], "seq": int(row["seq"]),
        "time": row["time"], "type": row["type"], "level": row["level"], "workflow_id": row["workflow_id"],
    }
    for key in ("token_id", "node_id", "node_name"):
        if row.get(key) is not None:
            event[key] = row[key]
    if row.get("attempt") is not None:
        event["attempt"] = int(row["attempt"])
    event["data"] = row.get("data") if row.get("data") is not None else {}
    return event


def _stored_run(row: dict[str, Any]) -> StoredRun:
    run: StoredRun = {
        "run_id": row["id"], "workflow_id": row["workflow_id"], "state": row["checkpoint"], "outbox": row["outbox"] or [],
        "partition": row["partition_key"], "due_at": row["due_at"].timestamp() * 1000 if row["due_at"] else None,
        "waits_for": list(row["waits_for"] or []), "waits": row["waits"] or [], "version": int(row["version"]),
    }
    if row.get("journey_instance_id"):
        run["journey_instance_id"] = row["journey_instance_id"]
    return run


class _Journal:
    """The journals of runs, read and written on one connection"""

    def __init__(self, run: Callable[..., list[dict[str, Any]]], unit: "_PostgresUnit | None" = None) -> None:
        self._run = run
        self._unit = unit

    def append(self, event: JournalEvent) -> None:
        if self._unit is None:
            raise RuntimeError("The journal of a shared store is written within operations only")
        try:
            self._run(
                "INSERT INTO awa_runtime.journal_events (run_id, seq, id, spec_version, time, type, level, workflow_id, token_id, node_id, node_name, attempt, data) "
                "VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s::jsonb)",
                (event["run_id"], event["seq"], event["id"], event["spec_version"], event["time"], event["type"], event.get("level", "execution"),
                 event["workflow_id"], event.get("token_id"), event.get("node_id"), event.get("node_name"), event.get("attempt"),
                 json.dumps(event.get("data") or {}, default=str)), fetch=False)
        except Exception as error:
            if self._unit.failure is None:
                self._unit.failure = error
            raise

    def read(self, run_id: str, after_seq: int = 0) -> list[JournalEvent]:
        rows = self._run(f"SELECT {_JOURNAL_COLUMNS} FROM awa_runtime.journal_events WHERE run_id = %s AND seq > %s ORDER BY seq", (run_id, after_seq))
        return [_journal_event(r) for r in rows]


class _PostgresUnit:
    """One operation: one transaction on the store's connection"""

    def __init__(self, run: Callable[..., Any], host_id: str) -> None:
        self._run = run
        self._host_id = host_id
        self.failure: BaseException | None = None
        self.journal = _Journal(run, self)

    def accept(self, event: BusinessEvent) -> bool:
        rows = self._run(
            "INSERT INTO awa_runtime.business_events (id, source, type, subject, time, data, accepted_by) VALUES (%s, %s, %s, %s, %s, %s::jsonb, %s) "
            "ON CONFLICT (id) DO NOTHING RETURNING id",
            (str(event["id"]), str(event.get("source") or ""), event["type"], event.get("subject"), _valid_time(event.get("time")),
             json.dumps(event.get("data") if isinstance(event.get("data"), dict) else {}, default=str), self._host_id))
        return len(rows) == 1

    def hold(self, partitions: list[str]) -> None:
        for partition in partitions:
            self._run("SELECT pg_advisory_xact_lock(hashtextextended(%s, 0))", (f"awa:{partition}",))

    def try_hold(self, partition: str) -> bool:
        rows = self._run("SELECT pg_try_advisory_xact_lock(hashtextextended(%s, 0)) AS held", (f"awa:{partition}",))
        return bool(rows[0]["held"])

    def lock_waits(self, keys: list[str], mode: str) -> None:
        lock = "pg_advisory_xact_lock_shared" if mode == "shared" else "pg_advisory_xact_lock"
        for key in keys:
            self._run(f"SELECT {lock}(hashtextextended(%s, 0))", (f"awa:{key}",))

    def waiting_for(self, type: str) -> list[dict[str, Any]]:
        rows = self._run("SELECT partition_key, waits FROM awa_runtime.runs WHERE waits_for @> ARRAY[%s]::text[]", (type,))
        return [{"partition": r["partition_key"], "waits": r["waits"] or []} for r in rows]

    def due(self, now: float) -> list[str]:
        rows = self._run("SELECT partition_key FROM awa_runtime.runs WHERE due_at <= %s "
                         "UNION SELECT partition_key FROM awa_runtime.journey_instances WHERE due_at <= %s", (_iso(now), _iso(now)))
        return [r["partition_key"] for r in rows]

    def partition_of_run(self, run_id: str) -> str | None:
        rows = self._run("SELECT partition_key FROM awa_runtime.runs WHERE id = %s", (run_id,))
        return rows[0]["partition_key"] if rows else None

    def load(self, partitions: list[str]) -> dict[str, list[dict[str, Any]]]:
        instances = self._run("SELECT document, version, partition_key FROM awa_runtime.journey_instances WHERE partition_key = ANY(%s) ORDER BY position", (partitions,))
        runs = self._run("SELECT * FROM awa_runtime.runs WHERE partition_key = ANY(%s) AND status NOT IN ('completed', 'failed', 'cancelled') ORDER BY position", (partitions,))
        return {
            "instances": [{"instance": r["document"], "partition": r["partition_key"], "version": int(r["version"]), "due_at": None,
                           "kept_events": len(r["document"]["events"])} for r in instances],
            "runs": [_stored_run(r) for r in runs],
        }

    def write(self, instances: list[StoredInstance], runs: list[StoredRun]) -> None:
        if self.failure is not None:
            raise self.failure
        for kept in instances:
            i = kept["instance"]
            values = (i["id"], i["journey_id"], i["subject_key"], i["status"], i["stage_id"], bool(i.get("stalled")), i["started_at"], i.get("ended_at"),
                      kept["partition"], _iso(kept["due_at"]), json.dumps(i, default=str), self._host_id)
            if kept["version"] == 0:
                self._run(
                    "INSERT INTO awa_runtime.journey_instances (id, journey_id, subject_key, status, stage_id, stalled, started_at, ended_at, partition_key, due_at, document, updated_by) "
                    "VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s::jsonb, %s)", values, fetch=False)
            else:
                count = self._run(
                    "UPDATE awa_runtime.journey_instances SET journey_id = %s, subject_key = %s, status = %s, stage_id = %s, stalled = %s, started_at = %s, ended_at = %s, "
                    "partition_key = %s, due_at = %s, document = %s::jsonb, updated_by = %s, updated_at = NOW(), version = version + 1 WHERE id = %s AND version = %s",
                    (*values[1:], values[0], kept["version"]), fetch="count")
                if count != 1:
                    raise StoreConflict(f"Journey instance {i['id']} was changed by another host")
            for e in i["events"][kept["kept_events"]:]:
                self._run(
                    "INSERT INTO awa_runtime.journey_events (journey_instance_id, seq, spec_version, journey_id, time, type, stage_id, run_id, data) "
                    "VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s::jsonb)",
                    (i["id"], e["seq"], e["spec_version"], e["journey_id"], e["time"], e["type"], e.get("stage_id"), e.get("run_id"),
                     json.dumps(e.get("data") or {}, default=str)), fetch=False)
        for run in runs:
            state = run["state"]
            status = str(state.get("engine_status"))
            settled = status in SETTLED_STATUSES
            stats = (state.get("metadata") or {}).get("stats") or {}
            started = _valid_time(stats.get("startTime"))
            if started is None and isinstance(stats.get("started_at"), (int, float)):
                started = _iso(stats["started_at"])
            run_values = (run["run_id"], run["workflow_id"], state.get("workflow_version"), status, run.get("journey_instance_id"), run["partition"],
                      _iso(run["due_at"]), run["waits_for"], json.dumps(run["outbox"], default=str), json.dumps(state, default=str),
                      state["checkpoint_at"], state["checkpoint_at"] if settled else None, self._host_id, json.dumps(run["waits"], default=str))
            if run["version"] == 0:
                self._run(
                    "INSERT INTO awa_runtime.runs (id, workflow_id, workflow_version, status, journey_instance_id, partition_key, due_at, waits_for, outbox, checkpoint, "
                    "checkpoint_at, ended_at, updated_by, waits, started_at) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s::jsonb, %s::jsonb, %s, %s, %s, %s::jsonb, %s)",
                    (*run_values, started or state["checkpoint_at"]), fetch=False)
            else:
                count = self._run(
                    "UPDATE awa_runtime.runs SET workflow_id = %s, workflow_version = %s, status = %s, journey_instance_id = %s, partition_key = %s, due_at = %s, "
                    "waits_for = %s, outbox = %s::jsonb, checkpoint = %s::jsonb, checkpoint_at = %s, ended_at = %s, updated_by = %s, waits = %s::jsonb, "
                    "version = version + 1 WHERE id = %s AND version = %s", (*run_values[1:], run_values[0], run["version"]), fetch="count")
                if count != 1:
                    raise StoreConflict(f"Run {run['run_id']} was changed by another host")


def _psycopg() -> Any:
    try:
        import psycopg
        from psycopg.rows import dict_row
    except ImportError:
        raise ImportError('The PostgreSQL runtime store needs psycopg 3: pip install "agentic-workflow-architecture[postgres]"') from None
    return psycopg, dict_row


class PostgresRuntimeStore:
    """
    Journeys and runs kept in PostgreSQL, for several hosts at once (29). Open it
    with PostgresRuntimeStore(url), which runs the migrations, and give it to a
    host as `shared`, or use open_runtime_store(url).

      host_id:        who this host is, in what the store records
      lease_ms:       how long an operation may keep its partitions while the store hears nothing from it;
                      past it the database ends the operation and nothing of it is kept (default five minutes)
      attempts:       how many times an operation that met another host's is begun again (default 30)
      before_commit:  called just before an operation is kept; tests use it to stop a host mid-operation

    One store object holds one connection: a host does one operation at a time.
    Several hosts in one process each have their own store object.
    """

    def __init__(self, url: str, *, host_id: str | None = None, lease_ms: float | None = None, attempts: int = 30,
                 before_commit: Callable[[], None] | None = None) -> None:
        self._psycopg, self._dict_row = _psycopg()
        self.url = url
        self.host_id = host_id or f"{socket.gethostname()}:{os.getpid()}:{uuid4().hex[:8]}"
        self._lease = max(1000, round(lease_ms if lease_ms is not None else 300_000))
        self._attempts = attempts
        self.before_commit = before_commit
        self._lock = threading.RLock()
        self._connection: Any = None
        self._closed = False
        # How many operations were begun again because they met another host's: a measure of contention
        self.retries = 0
        self.journal = _Journal(self._query)
        try:
            self._migrate()
        except BaseException:
            self.close()
            raise

    # -- the connection ------------------------------------------------------

    def _connect(self) -> Any:
        if self._closed:
            raise RuntimeError("The runtime store is closed")
        if self._connection is None or self._connection.closed or self._connection.broken:
            # Text is UTF-8 whatever the server's encoding, as it is for the TypeScript SDK
            self._connection = self._psycopg.connect(self.url, autocommit=True, row_factory=self._dict_row, client_encoding="utf8",
                                                     options=f"-c idle_in_transaction_session_timeout={self._lease}")
        return self._connection

    def _query(self, sql: str, params: Any = None, fetch: Any = True) -> Any:
        with self._lock:
            cursor = self._connect().execute(sql, params)
            if fetch == "count":
                return cursor.rowcount
            return cursor.fetchall() if fetch and cursor.description else []

    def _migrate(self) -> None:
        with self._lock:
            self._query("SELECT pg_advisory_lock(hashtextextended('awa_runtime:migrations', 0))")
            try:
                self._query(RUNTIME_STORE_BOOTSTRAP, fetch=False)
                applied = {int(r["version"]) for r in self._query("SELECT version FROM awa_runtime.migrations")}
                known = max(m["version"] for m in RUNTIME_STORE_MIGRATIONS)
                newest = max(applied, default=0)
                if newest > known:
                    raise RuntimeError(f"The runtime store is at version {newest}, newer than this SDK knows ({known}). Upgrade the SDK.")
                for migration in RUNTIME_STORE_MIGRATIONS:
                    if migration["version"] in applied:
                        continue
                    self._query("BEGIN", fetch=False)
                    try:
                        self._query(migration["sql"], fetch=False)
                        self._query("INSERT INTO awa_runtime.migrations (version, description, applied_by) VALUES (%s, %s, %s)",
                                    (migration["version"], migration["description"], self.host_id), fetch=False)
                        self._query("COMMIT", fetch=False)
                    except BaseException:
                        self._query("ROLLBACK", fetch=False)
                        raise
            finally:
                self._query("SELECT pg_advisory_unlock(hashtextextended('awa_runtime:migrations', 0))")

    # -- operations ----------------------------------------------------------

    def operation(self, work: Callable[[_PostgresUnit], Any]) -> Any:
        """Do one operation as one transaction. One that met another host's is begun again from the start."""
        attempt = 0
        with self._lock:
            while True:
                attempt += 1
                try:
                    self._query("BEGIN", fetch=False)
                    unit = _PostgresUnit(self._query, self.host_id)
                    result = work(unit)
                    if unit.failure is not None:
                        raise unit.failure
                    if self.before_commit:
                        self.before_commit()
                    self._query("COMMIT", fetch=False)
                    return result
                except BaseException as error:
                    self._rollback()
                    code = getattr(error, "sqlstate", None)
                    if attempt < self._attempts and (isinstance(error, StoreConflict) or code in _RETRYABLE):
                        # Another host's operation was in the way: begin again, a little later, from what it kept
                        self.retries += 1
                        time.sleep(min(0.2, 0.005 * attempt) * random.random())
                        continue
                    raise

    def _rollback(self) -> None:
        connection = self._connection
        if connection is None or connection.closed:
            return
        try:
            connection.execute("ROLLBACK")
        except Exception:  # noqa: BLE001 - any failure means the connection is unusable
            # The connection is gone (the database ended it): the next operation opens another
            try:
                connection.close()
            except Exception:  # noqa: BLE001, S110 - closing what is already broken
                pass

    # -- reading -------------------------------------------------------------

    def read_all(self) -> dict[str, list[dict[str, Any]]]:
        instances = self._query("SELECT document FROM awa_runtime.journey_instances ORDER BY position")
        runs = self._query("SELECT * FROM awa_runtime.runs ORDER BY position")
        return {"instances": [r["document"] for r in instances], "runs": [_stored_run(r) for r in runs]}

    def required_definitions(self) -> dict[str, Any]:
        workflows = self._query("SELECT DISTINCT workflow_id FROM awa_runtime.runs WHERE status NOT IN ('completed', 'failed', 'cancelled') ORDER BY workflow_id")
        journeys = self._query("SELECT DISTINCT journey_id FROM awa_runtime.journey_instances ORDER BY journey_id")
        counts = self._query("SELECT (SELECT COUNT(*) FROM awa_runtime.journey_instances) AS instances, (SELECT COUNT(*) FROM awa_runtime.runs) AS runs")[0]
        return {"workflows": [r["workflow_id"] for r in workflows], "journeys": [r["journey_id"] for r in journeys],
                "instances": int(counts["instances"]), "runs": int(counts["runs"])}

    def definitions(self) -> list[dict[str, Any]]:
        rows = self._query("SELECT document FROM awa_runtime.definitions ORDER BY CASE kind WHEN 'workflow' THEN 0 ELSE 1 END, added_at, id")
        return [r["document"] for r in rows]

    def add_definition(self, document: dict[str, Any]) -> dict[str, str]:
        """Keep a workflow or journey document in the store, replacing one with the same id"""
        from awa.runtime.runtime_host import _parse_workflow, is_journey_document
        journey = is_journey_document(document)
        parsed: Any = parse_journey(document) if journey else _parse_workflow(document)
        kind = "journey" if journey else "workflow"
        self._query(
            "INSERT INTO awa_runtime.definitions (kind, id, name, version, document) VALUES (%s, %s, %s, %s, %s::jsonb) "
            "ON CONFLICT (kind, id) DO UPDATE SET name = EXCLUDED.name, version = EXCLUDED.version, document = EXCLUDED.document",
            (kind, str(parsed.id), parsed.name, getattr(parsed, "version", None), json.dumps(document, default=str)), fetch=False)
        return {"kind": kind, "id": str(parsed.id), "name": parsed.name}

    def stats(self) -> dict[str, int]:
        """How much the store holds: for operators and tests"""
        row = self._query("""SELECT
            (SELECT COUNT(*) FROM awa_runtime.business_events) AS accepted_events,
            (SELECT COUNT(*) FROM awa_runtime.journey_instances) AS instances,
            (SELECT COUNT(*) FROM awa_runtime.runs) AS runs,
            (SELECT COUNT(*) FROM awa_runtime.journal_events) AS journal_events,
            (SELECT COUNT(*) FROM awa_runtime.journey_events) AS journey_events""")[0]
        return {key: int(value) for key, value in row.items()}

    def close(self) -> None:
        with self._lock:
            self._closed = True
            if self._connection is not None and not self._connection.closed:
                self._connection.close()
            self._connection = None


def open_runtime_store(url: str, engine: dict[str, Any] | None = None, now: Callable[[], float] | None = None,
                       telemetry: Any = None, shadow: dict[str, Any] | None = None, **store_options: Any) -> Any:
    """
    A host on a shared PostgreSQL store, with the workflows and journeys the store
    keeps registered (29). Raises, and changes nothing, when the store keeps work
    this host could not continue. Call close() on the host, which is also a
    context manager, to release its connection. Read methods show what the host's
    last operation held: call refresh() first to read the whole store.
    """
    from awa.runtime.runtime_host import AwaRuntime, _parse_workflow, is_journey_document
    if not url.startswith(("postgres://", "postgresql://")):
        raise ValueError(f'A shared runtime store is a PostgreSQL URL (postgres://...), not "{url}"')
    store = PostgresRuntimeStore(url, **store_options)
    try:
        runtime = AwaRuntime(engine=engine, now=now, shared=store, telemetry=telemetry, shadow=shadow)
        documents = store.definitions()
        # Workflows first: a journey is checked against the workflows it names
        for document in documents:
            if not is_journey_document(document):
                _parse_workflow(document)
                runtime.register_workflow(document)
        for document in documents:
            if is_journey_document(document):
                runtime.register_journey(document)
        runtime.recover()
    except BaseException:
        store.close()
        raise
    runtime._release = store.close
    return runtime
