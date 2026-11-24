"""
Hosts that share a store (specification section 29): the PostgreSQL runtime
store, under several host objects in this process and several processes.

The tests start a throwaway PostgreSQL (tests/postgres_helper.py) and are
skipped, saying why, where PostgreSQL or psycopg is missing.
"""

import json
import os
import re
import signal
import subprocess
import sys
import tempfile
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import pytest

from tests.postgres_helper import TestPostgres, postgres_unavailable
from tests.shared_store_load import CLAIM_JOURNEY, CLAIM_WORKFLOW, LoadActor, deal, event, phase

UNAVAILABLE = postgres_unavailable()
pytestmark = pytest.mark.skipif(UNAVAILABLE is not None, reason=f"shared store tests need PostgreSQL: {UNAVAILABLE}")

SDK = Path(__file__).resolve().parents[1]
ROOT = SDK.parents[1]
WORKER = Path(__file__).with_name("shared_store_worker.py")


@pytest.fixture(scope="module")
def postgres():
    server = TestPostgres()
    yield server
    server.stop()


def actors(actor):
    from awa.types import ActorType
    return {"actors": {t: actor for t in ActorType}, "sleep": lambda ms: None}


def host(url, actor=None, **options):
    from awa.runtime.postgres_store import open_runtime_store
    return open_runtime_store(url, engine=actors(actor or LoadActor()), **options)


def with_definitions(url):
    from awa.runtime.postgres_store import PostgresRuntimeStore
    store = PostgresRuntimeStore(url)
    store.add_definition(CLAIM_WORKFLOW)
    store.add_definition(CLAIM_JOURNEY)
    store.close()


def audit(url):
    """
    What every run of the store must satisfy whichever host wrote it: each event id
    accepted once, recorded at most once on a journey, and every journal and journey
    record numbered from 1 without a gap. Returns what it counted.
    """
    import psycopg
    with psycopg.connect(url) as connection:
        def q(sql):
            return connection.execute(sql).fetchall()
        assert q("SELECT run_id FROM awa_runtime.journal_events GROUP BY run_id HAVING MAX(seq) <> COUNT(*) OR MIN(seq) <> 1") == [], "journals with a gap"
        assert q("SELECT journey_instance_id FROM awa_runtime.journey_events GROUP BY 1 HAVING MAX(seq) <> COUNT(*) OR MIN(seq) <> 1") == [], "journey records with a gap"
        assert q("""SELECT i.id FROM awa_runtime.journey_instances i WHERE jsonb_array_length(i.document->'events')
                    <> (SELECT COUNT(*) FROM awa_runtime.journey_events e WHERE e.journey_instance_id = i.id)""") == [], "rows and record differ"
        recorded_twice = q("""SELECT journey_instance_id, data->>'event_id', COUNT(*) FROM awa_runtime.journey_events
                              WHERE type = 'journey.event_received' GROUP BY 1, 2 HAVING COUNT(*) > 1""")
        delivered_twice = q("""SELECT run_id, data->>'event_id', COUNT(*) FROM awa_runtime.journal_events
                               WHERE type = 'event.received' GROUP BY 1, 2 HAVING COUNT(*) > 1""")
        assert recorded_twice == [], "events recorded twice on a journey"
        assert delivered_twice == [], "events delivered twice to a run"
        assert q("SELECT journey_id, subject_key FROM awa_runtime.journey_instances WHERE status = 'active' GROUP BY 1, 2 HAVING COUNT(*) > 1") == []
        accepted, journal_events, journey_events, runs = q("""SELECT (SELECT COUNT(*) FROM awa_runtime.business_events),
            (SELECT COUNT(*) FROM awa_runtime.journal_events), (SELECT COUNT(*) FROM awa_runtime.journey_events), (SELECT COUNT(*) FROM awa_runtime.runs)""")[0]
        return {"accepted": accepted, "journal_events": journal_events, "journey_events": journey_events, "runs": runs,
                "duplicates": len(recorded_twice) + len(delivered_twice)}


def records(url):
    reader = host(url)
    reader.refresh()
    instances = reader.list_journey_instances()
    reader.close()
    return instances


def test_migrations_run_once_and_a_newer_store_is_refused(postgres):
    import psycopg

    from awa.runtime.postgres_store import RUNTIME_STORE_MIGRATIONS, PostgresRuntimeStore
    url = postgres.database()
    PostgresRuntimeStore(url).close()
    with ThreadPoolExecutor(3) as pool:  # several hosts starting at once migrate once between them
        list(pool.map(lambda _: PostgresRuntimeStore(url).close(), range(3)))
    with psycopg.connect(url, autocommit=True) as connection:
        assert connection.execute("SELECT version FROM awa_runtime.migrations ORDER BY version").fetchall() == [(m["version"],) for m in RUNTIME_STORE_MIGRATIONS]
        connection.execute("INSERT INTO awa_runtime.migrations (version, description, applied_by) VALUES (99, 'from the future', 'test')")
    with pytest.raises(RuntimeError, match="version 99, newer than this SDK knows"):
        PostgresRuntimeStore(url)


def test_the_tables_are_those_of_the_ddl_and_of_the_typescript_sdk():
    from awa.runtime.postgres_store import RUNTIME_STORE_BOOTSTRAP, RUNTIME_STORE_MIGRATIONS

    def normal(sql):
        return re.sub(r"\s+", " ", re.sub(r"--[^\n]*", "", sql)).strip()

    def statements(sqls):
        return [normal(s) for sql in sqls for s in sql.split(";") if normal(s)]

    mine = statements([RUNTIME_STORE_BOOTSTRAP, *(m["sql"] for m in RUNTIME_STORE_MIGRATIONS)])
    ddl = normal((ROOT / "spec" / "ddl" / "awa.postgresql.sql").read_text())
    for statement in mine:
        assert statement in ddl, statement
    # The reference implementation runs the very same statements: one store serves both SDKs
    ts = (ROOT / "sdk" / "typescript" / "src" / "runtime" / "postgres_store.ts").read_text()
    reference = [re.search(r"RUNTIME_STORE_BOOTSTRAP = `\n(.*?)`;", ts, re.DOTALL).group(1),
                 *re.findall(r"sql: `\n(.*?)`,\n    }", ts, re.DOTALL)]
    assert statements(reference) == mine


def test_refuses_a_url_that_is_not_postgres_and_a_host_that_lacks_a_definition(postgres):
    from awa.runtime.postgres_store import PostgresRuntimeStore, open_runtime_store
    from awa.runtime.runtime_host import AwaRuntime
    with pytest.raises(ValueError, match="PostgreSQL URL"):
        open_runtime_store("/var/lib/awa")
    url = postgres.database()
    with_definitions(url)
    first = host(url)
    first.publish(event("claim.submitted", "c-1", "e-1"))
    first.close()

    store = PostgresRuntimeStore(url)
    lacking = AwaRuntime(shared=store, engine={"sleep": lambda ms: None})
    with pytest.raises(RuntimeError, match="needs workflow .*journey .*which this host has not registered"):
        lacking.recover()
    # A host that skipped the check still does not touch what it cannot continue: nothing is kept
    with pytest.raises(RuntimeError, match="not registered on this host"):
        lacking.publish(event("documents.uploaded", "c-1", "e-2"))
    assert store.stats()["accepted_events"] == 1
    store.close()


def test_a_row_changed_meanwhile_is_refused_and_the_operation_begun_again(postgres):
    import psycopg

    from awa.runtime.postgres_store import PostgresRuntimeStore
    from awa.runtime.runtime_host import AwaRuntime
    from awa.runtime.shared_store import StoreConflict
    url = postgres.database()
    with_definitions(url)
    first = host(url)
    first.publish(event("claim.submitted", "c-1", "e-1"))
    meddler = psycopg.connect(url, autocommit=True)

    def meddled_host(**options):
        """A host whose operations find the subject's instance changed by someone else once, right after loading it"""
        store = PostgresRuntimeStore(url, **options)
        operation, meddled = store.operation, {"done": False}

        def meddling(work):
            def wrapped(unit):
                load = unit.load

                def loading(partitions):
                    loaded = load(partitions)
                    if not meddled["done"]:
                        meddled["done"] = True
                        meddler.execute("UPDATE awa_runtime.journey_instances SET version = version + 1")
                    return loaded
                unit.load = loading
                return work(unit)
            return operation(wrapped)
        store.operation = meddling
        runtime = AwaRuntime(shared=store, engine=actors(LoadActor()))
        runtime.register_workflow(CLAIM_WORKFLOW).register_journey(CLAIM_JOURNEY)
        return runtime, store

    strict, strict_store = meddled_host(attempts=1)
    with pytest.raises(StoreConflict):
        strict.publish(event("note.added", "c-1", "e-2"))
    patient, patient_store = meddled_host()
    assert patient.publish(event("note.added", "c-1", "e-3"))["accepted"] is True
    meddler.close()
    strict_store.close()
    patient_store.close()
    first.close()
    [claim] = records(url)
    assert [e["data"]["event_id"] for e in claim["events"] if e["type"] == "journey.event_received"] == ["e-1", "e-3"]
    audit(url)


def test_several_host_objects_take_a_burst_of_events_and_ticks_at_once(postgres):
    url = postgres.database()
    with_definitions(url)
    HOSTS, SUBJECTS, NOTES = 6, 24, 4
    hosts = [host(url, host_id=f"host-{n}") for n in range(HOSTS)]
    totals = {"given": 0, "accepted": 0, "refused": 0}
    lock = threading.Lock()

    def take(h, queue):
        for n, e in enumerate(queue):
            accepted = hosts[h].publish(e)["accepted"]
            with lock:
                totals["accepted" if accepted else "refused"] += 1
            if n % 5 == 0:
                hosts[h].tick()

    for name in ("submit", "notes", "documents"):
        queues = deal(phase(name, SUBJECTS, NOTES), HOSTS, 3)
        totals["given"] += sum(len(q) for q in queues)
        with ThreadPoolExecutor(HOSTS) as pool:
            list(pool.map(take, range(HOSTS), queues))
    for h in hosts:
        h.tick()
    retries = sum(h.shared_store.retries for h in hosts)
    for h in hosts:
        h.close()

    distinct = SUBJECTS * (2 + NOTES)
    assert totals["accepted"] == distinct
    assert totals["refused"] == totals["given"] - distinct
    counts = audit(url)
    assert counts["accepted"] == distinct
    instances = records(url)
    assert len(instances) == SUBJECTS
    for i in instances:
        types = [e["type"] for e in i["events"]]
        assert types.count("journey.started") == 1
        assert types.count("journey.event_received") == 2 + NOTES
        assert types.count("journey.touchpoint") == NOTES
        assert types.count("journey.stalled") <= 1
        assert i["status"] == "completed" and [r["status"] for r in i["runs"]] == ["completed"]
    print(f"[shared store, one process] {HOSTS} hosts, {totals['given']} deliveries of {distinct} events "
          f"({totals['given'] - distinct} duplicates), {totals['accepted']} accepted, {counts['journal_events']} journal events, "
          f"{counts['journey_events']} journey events, {retries} operations begun again, {counts['duplicates']} applied twice")


def run_workers(url, plans, directory):
    """Start one worker process per plan, at once, and gather what each reports"""
    children = []
    for n, plan in enumerate(plans):
        path = Path(directory) / f"plan-{n}-{time.time_ns()}.json"
        path.write_text(json.dumps({"url": url, **plan}))
        children.append(subprocess.Popen([sys.executable, str(WORKER), str(path)], stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, cwd=directory))
    outcomes = []
    for child in children:
        out, err = child.communicate(timeout=300)
        assert child.returncode == 0, err
        outcomes.append(json.loads(out.strip().splitlines()[-1]))
    return outcomes


def test_hosts_on_one_store_send_each_span_once_and_together_the_journey_trace(postgres):
    """The host whose operation is kept sends the journey spans that operation added (26.7)"""
    from awa.runtime.postgres_store import PostgresRuntimeStore, open_runtime_store
    from awa.runtime.telemetry import journey_spans, journey_trace_id
    url = postgres.database()
    # Two stages, so that spans end in operations of different hosts
    journey = {**CLAIM_JOURNEY, "id": "7d3e1c2b-4a5f-4e6d-9b8c-0a1b2c3d4e5f", "name": "Claim and rating",
               "stages": [{**{k: v for k, v in CLAIM_JOURNEY["stages"][0].items() if k != "max_duration"}, "transitions": [{"to": "rate"}]},
                          {"id": "rate", "name": "Rate", "complete_when": "rated == true", "transitions": []}],
               "touchpoints": [*CLAIM_JOURNEY["touchpoints"],
                               {"id": "rating", "name": "Rates", "direction": "inbound", "channel": "web", "on": {"event": "rating.given"}}]}
    store = PostgresRuntimeStore(url)
    store.add_definition(CLAIM_WORKFLOW)
    store.add_definition(journey)
    store.close()

    class Collect:
        def __init__(self):
            self.spans = []

        def export(self, spans):
            self.spans.extend(spans)

    HOSTS, SUBJECTS = 3, 6
    exporters = [Collect() for _ in range(HOSTS)]
    hosts = [open_runtime_store(url, engine=actors(LoadActor()), telemetry={"exporter": e, "payloads": False}, host_id=f"host-{n}")
             for n, e in enumerate(exporters)]
    # Each step of a subject on the next host: submitted on one, settled on the next, rated on the third
    steps = [lambda c, s: event("claim.submitted", c, f"submit-{s}"), lambda c, s: event("note.added", c, f"note-{s}"),
             lambda c, s: event("documents.uploaded", c, f"documents-{s}"), lambda c, s: event("rating.given", c, f"rating-{s}", rated=True)]
    with ThreadPoolExecutor(max_workers=SUBJECTS) as pool:
        for k, step in enumerate(steps):
            list(pool.map(lambda s: hosts[(s + k) % HOSTS].publish(step(f"c-{s}", s)), range(SUBJECTS)))
    for h in hosts:
        h.close()

    instances = records(url)
    assert len(instances) == SUBJECTS
    sent = [span for e in exporters for span in e.spans]
    ids = [f"{span.trace_id}/{span.span_id}" for span in sent]
    assert [i for n, i in enumerate(ids) if i in ids[:n]] == [], "spans sent twice"
    assert all(e.spans for e in exporters), "every host sent spans"
    for instance in instances:
        assert instance["status"] == "completed", instance["subject_key"]
        trace = journey_trace_id(instance["id"])
        expected = sorted(span.span_id for span in journey_spans(instance["events"]))
        got = sorted(span.span_id for span in sent if span.trace_id == trace)
        assert got == expected, instance["subject_key"]


def test_several_processes_take_a_burst_of_events_and_ticks_at_once(postgres):
    url = postgres.database()
    with_definitions(url)
    PROCESSES, SUBJECTS, NOTES = 4, 30, 3
    outcomes, given = [], 0
    with tempfile.TemporaryDirectory() as directory:
        for name in ("submit", "notes", "documents"):
            queues = deal(phase(name, SUBJECTS, NOTES), PROCESSES, 2)
            given += sum(len(q) for q in queues)
            outcomes += run_workers(url, [{"host_id": f"process-{n}", "queue": q, "tick_every": 4} for n, q in enumerate(queues)], directory)
    accepted = [a for o in outcomes for a in o["accepted"]]
    distinct = SUBJECTS * (2 + NOTES)
    assert [f for o in outcomes for f in o["failures"]] == []
    assert len(set(accepted)) == len(accepted) == distinct  # no event accepted by two processes
    counts = audit(url)
    assert counts["accepted"] == distinct
    instances = records(url)
    assert len(instances) == SUBJECTS
    for i in instances:
        assert [e["type"] for e in i["events"]].count("journey.event_received") == 2 + NOTES
        assert i["status"] == "completed"
    print(f"[shared store, {PROCESSES} processes] {given} deliveries of {distinct} events ({given - distinct} duplicates), "
          f"{len(accepted)} accepted, {counts['journal_events']} journal events, {counts['duplicates']} applied twice")


def test_a_process_killed_mid_operation_keeps_nothing_and_another_host_takes_over(postgres):
    url = postgres.database()
    with_definitions(url)
    with tempfile.TemporaryDirectory() as directory:
        path = Path(directory) / "plan.json"
        path.write_text(json.dumps({"url": url, "host_id": "doomed", "queue": [event("claim.submitted", "c-1", "submit-1")], "slow": {"Register": 60_000}}))
        child = subprocess.Popen([sys.executable, str(WORKER), str(path)], stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, cwd=directory)
        # Wait until the doomed host is in the middle of its operation, holding the subject
        line = child.stdout.readline()
        assert line.strip() == "HOLDING", child.stderr.read()
        survivor = host(url, host_id="survivor")
        done = {}

        def note():
            started = time.monotonic()
            done["accepted"] = survivor.publish(event("note.added", "c-1", "note-1"))["accepted"]
            done["waited"] = time.monotonic() - started
        waiting = threading.Thread(target=note)
        waiting.start()
        time.sleep(0.3)
        assert "accepted" not in done  # the subject is held by the doomed host
        os.kill(child.pid, signal.SIGKILL)
        child.wait()
        waiting.join(timeout=10)
        assert done.get("accepted") is True and done["waited"] < 10
        # The doomed host's event was never acknowledged: the producer gives it again, to the survivor
        assert survivor.publish(event("claim.submitted", "c-1", "submit-1"))["accepted"] is True
        assert survivor.publish(event("documents.uploaded", "c-1", "documents-1"))["accepted"] is True
        survivor.close()
    counts = audit(url)
    assert counts["accepted"] == 3 and counts["runs"] == 1
    [claim] = records(url)
    assert claim["status"] == "completed"
    assert [e["type"] for e in claim["events"]].count("journey.started") == 1
    print(f"[shared store, killed process] the survivor waited {done['waited'] * 1000:.0f} ms for the killed host's subject")


def test_an_event_and_a_run_starting_to_wait_for_it_on_another_host_do_not_miss_one_another(postgres):
    from awa.runtime.postgres_store import PostgresRuntimeStore

    def n(i):
        return f"3a7c9e1b-5d2f-4a6b-8c0d-{i:012d}"
    # A run outside any journey, started by one event, that waits for another correlated by k: its partition is its own
    pinger = {"id": n(100), "name": "Pinger", "version": "1.0.0", "awa_version": "1.1",
              "activities": [{"id": n(1), "name": "Prepare", "role_id": n(9), "actor_type": "application"},
                             {"id": n(2), "name": "Done", "role_id": n(9), "actor_type": "application"}],
              "events": [{"id": n(3), "name": "Go", "event_type": "start", "event_definition": {"name": "start.go"}},
                         {"id": n(4), "name": "Ping", "event_type": "message", "event_definition": {"name": "ping", "correlation_key": "k"}}],
              "edges": [{"id": n(5), "source_id": n(3), "target_id": n(1)}, {"id": n(6), "source_id": n(1), "target_id": n(4)},
                        {"id": n(7), "source_id": n(4), "target_id": n(2)}]}
    url = postgres.database()
    store = PostgresRuntimeStore(url)
    store.add_definition(pinger)
    store.close()
    paused, release = threading.Event(), threading.Event()

    def pause():
        paused.set()
        release.wait(10)
    # Host a keeps its run waiting for the ping, and pauses just before its operation is kept
    a, b, c = host(url, host_id="a", before_commit=pause), host(url, host_id="b"), host(url, host_id="c")
    results = {}

    def start():
        results["started"] = a.publish({"specversion": "1.0", "id": "go-1", "source": "/test", "type": "start.go", "data": {"k": "1"}})

    def ping():
        results["pinged"] = b.publish({"specversion": "1.0", "id": "ping-1", "source": "/test", "type": "ping", "data": {"k": "1"}})
    starting = threading.Thread(target=start)
    starting.start()
    assert paused.wait(10)
    pinging = threading.Thread(target=ping)
    pinging.start()
    time.sleep(0.3)
    # The ping waits: it may reach the wait host a is keeping, so it is not looked for until that is kept
    assert "pinged" not in results
    # Another ping, for another correlation, does not wait
    assert c.publish({"specversion": "1.0", "id": "ping-2", "source": "/test", "type": "ping", "data": {"k": "2"}})["resumed_runs"] == []
    release.set()
    starting.join()
    pinging.join()
    run_id = results["started"]["started_runs"][0]
    assert results["pinged"]["resumed_runs"] == [run_id]
    for h in (a, b, c):
        h.close()
    reader = host(url)
    reader.refresh()
    assert reader.get_run(run_id).status.value == "completed"
    reader.close()
    audit(url)


def test_a_host_that_hangs_loses_its_partitions_when_its_lease_runs_out(postgres):
    url = postgres.database()
    with_definitions(url)
    hanging = host(url, LoadActor({"Register": 4000}), host_id="hanging", lease_ms=1000)
    other = host(url, host_id="other")
    outcome = {}

    def stuck():
        try:
            hanging.publish(event("claim.submitted", "c-1", "submit-1"))
            outcome["result"] = "kept"
        except Exception:  # noqa: BLE001 - the lease ran out: any error will do
            outcome["result"] = "failed"
    thread = threading.Thread(target=stuck)
    thread.start()
    time.sleep(0.3)
    started = time.monotonic()
    assert other.publish(event("note.added", "c-1", "note-1"))["accepted"] is True
    assert time.monotonic() - started < 3.5
    thread.join()
    assert outcome["result"] == "failed"
    assert other.publish(event("claim.submitted", "c-1", "submit-1"))["accepted"] is True
    hanging.close()
    other.close()
    counts = audit(url)
    assert counts["accepted"] == 2 and counts["runs"] == 1


def test_a_person_completes_on_one_host_a_task_a_run_waits_for_on_another(postgres):
    from awa.runtime.postgres_store import PostgresRuntimeStore, open_runtime_store
    from awa.types import ActorType
    url = postgres.database()
    review = {"id": "7d1e2f3a-4b5c-4d6e-8f70-81a2b3c4d5e6", "name": "Review", "version": "1.0.0", "awa_version": "1.1",
              "activities": [{"id": "7d1e2f3a-4b5c-4d6e-8f70-000000000001", "name": "Approve",
                              "role_id": "7d1e2f3a-4b5c-4d6e-8f70-000000000009", "actor_type": "human"}], "edges": []}
    journey = {**CLAIM_JOURNEY, "id": "7d1e2f3a-4b5c-4d6e-8f70-000000000002", "name": "Review", "touchpoints": [],
               "stages": [{"id": "open", "name": "Open", "workflows": [review["id"]], "complete_when": "approved == true", "transitions": []}],
               "triggers": [{"event": "review.requested", "starts_journey": True, "start_workflow": review["id"]}]}
    store = PostgresRuntimeStore(url)
    store.add_definition(review)
    store.add_definition(journey)
    store.close()

    class Person:
        def execute(self, activity, token, context=None):
            return {"_requires_human_action": True, "_human_task_id": "task-1"}
    engine = {"actors": {t: Person() for t in ActorType}, "wait_for_human_tasks": True, "sleep": lambda ms: None}
    a, b = open_runtime_store(url, engine=engine), open_runtime_store(url, engine=engine)
    run_id = a.publish(event("review.requested", "c-9", "r-1"))["started_runs"][0]
    b.refresh()
    token = next(t for t in b.get_run(run_id).tokens if t.status.value == "waiting")
    assert b.resume(run_id, token.id, {"approved": True}) is True
    assert b.resume(run_id, token.id, {"approved": True}) is False
    assert b.resume("no-such-run", token.id, {}) is False
    a.close()
    b.close()
    instance = next(i for i in records(url) if i["subject_key"] == "c-9")
    assert instance["status"] == "completed" and instance["data"]["approved"] is True
    audit(url)


def test_awa_journey_works_on_the_store_named_by_option_or_environment(postgres, tmp_path):
    url = postgres.database()
    (tmp_path / "workflow.json").write_text(json.dumps(CLAIM_WORKFLOW))
    (tmp_path / "journey.json").write_text(json.dumps(CLAIM_JOURNEY))

    def awa(*args, store=None):
        env = {**os.environ, "PYTHONPATH": str(SDK), "AWA_RUNTIME_STORE": store or ""}
        result = subprocess.run([sys.executable, "-m", "awa.cli", *args], cwd=tmp_path, env=env, capture_output=True, text=True, check=False)
        assert result.returncode == 0, result.stderr
        return result.stdout
    assert re.search(r'added workflow "Claim"[\s\S]*added journey "Claim"', awa("journey", "add", "workflow.json", "journey.json", "--store", url))
    assert "started 1" in awa("journey", "publish", "claim.submitted", "-d", '{"customer_id": "c-1"}', "--id", "cli-1", "--simulate", store=url)
    assert "already" in awa("journey", "publish", "claim.submitted", "-d", '{"customer_id": "c-1"}', "--id", "cli-1", "--store", url)
    assert re.search(r"c-1\s+Claim\s+active", awa("journey", "list", store=url))
    assert not (tmp_path / ".awa").exists()  # the runtime directory was not used


def test_the_server_keeps_journeys_in_the_store_awa_runtime_store_names(postgres, monkeypatch):
    pytest.importorskip("fastapi")
    pytest.importorskip("httpx")
    from fastapi.testclient import TestClient
    import awa.server as server
    from awa.server import journeys as routes
    url = postgres.database()
    monkeypatch.setenv("AWA_RUNTIME_STORE", url)
    monkeypatch.setenv("AWA_SIMULATE", "1")
    key = next(iter(server.API_KEYS), None)
    headers = {"x-api-key": key} if key else {}
    client = TestClient(server.app)
    server.set_journey_runtime(None)
    try:
        assert client.post("/api/v1/journeys/definitions", json=CLAIM_WORKFLOW, headers=headers).status_code == 201
        assert client.post("/api/v1/journeys/definitions", json=CLAIM_JOURNEY, headers=headers).status_code == 201
        taken = client.post("/api/v1/journeys/events", json={"id": "http-1", "type": "claim.submitted", "data": {"customer_id": "c-1"}}, headers=headers)
        assert taken.json()["accepted"] is True
        # Another host, elsewhere, on the same store: it finds the definitions the server added, and the server sees its work
        other = host(url)
        assert other.publish(event("claim.submitted", "c-2", "other-1"))["accepted"] is True
        assert other.publish(event("claim.submitted", "c-1", "http-1"))["accepted"] is False
        other.close()
        assert sorted(i["subject_key"] for i in client.get("/api/v1/journeys/instances", headers=headers).json()) == ["c-1", "c-2"]
    finally:
        if routes._runtime is not None:
            routes._runtime.close()
        server.set_journey_runtime(None)
