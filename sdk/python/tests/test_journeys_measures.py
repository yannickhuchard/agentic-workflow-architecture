"""
Journeys (specification section 19) and measures (section 21): what the
conformance cases cannot reach. A host that keeps its state in files and is
replaced by another, the lock on a runtime directory, duplicate events, the
form of an export, the command line and the HTTP routes.
"""

import json
import os
import shutil
import subprocess
import sys
from pathlib import Path
from uuid import uuid4

import pytest

from awa.runtime.business_event import business_event
from awa.runtime.journal import FileJournalStore, InMemoryJournalStore
from awa.runtime.journey import parse_journey, validate_journey
from awa.runtime.kpi import MEASURES, compute_measures, measures_to_openmetrics
from awa.runtime.runtime_host import (
    AwaRuntime, FileRuntimeStore, InMemoryRuntimeStore, add_definition, open_runtime_directory, simulated_actors,
)

ROOT = Path(__file__).resolve().parents[3]
SCHEMAS = ROOT / "spec" / "json-schema"
EXAMPLE = ROOT / "examples" / "claims-journey"
REFERENCE = ROOT / "sdk" / "typescript" / "dist" / "index.js"
DAY = 24 * 3600 * 1000


def read(name):
    return json.loads((EXAMPLE / name).read_text())


def definitions():
    """A claim that asks for documents, waits five days for them, then settles; and the journey it serves"""
    ids = {name: str(uuid4()) for name in ("workflow", "role", "ask", "settle", "upload", "e1", "e2", "journey")}
    workflow = {
        "id": ids["workflow"], "name": "Claim", "version": "1.0.0",
        "activities": [
            {"id": ids["ask"], "name": "Request documents", "role_id": ids["role"], "actor_type": "application"},
            {"id": ids["settle"], "name": "Settle claim", "role_id": ids["role"], "actor_type": "application"},
        ],
        "events": [{"id": ids["upload"], "name": "Documents uploaded", "event_type": "message", "event_definition": {
            "name": "documents.uploaded", "correlation_key": "customer_id", "timeout": "P5D"}}],
        "edges": [{"id": ids["e1"], "source_id": ids["ask"], "target_id": ids["upload"]},
                  {"id": ids["e2"], "source_id": ids["upload"], "target_id": ids["settle"]}],
    }
    journey = {
        "id": ids["journey"], "name": "Claim", "version": "1.0.0", "subject": {"name": "customer", "key": "customer_id"},
        "stages": [{"id": "open", "name": "Open", "owner": "Claims desk", "workflows": [ids["workflow"]],
                    "complete_when": "paid == true", "transitions": []}],
        "triggers": [{"event": "claim.submitted", "starts_journey": True, "start_workflow": ids["workflow"]}],
        "goals": [{"id": "paid", "name": "Paid", "expression": "paid == true"}],
        "artefacts": [{"id": "receipt", "name": "Payment receipt", "kind": "receipt"}],
        "touchpoints": [{"id": "settled", "name": "Is told", "direction": "outbound", "channel": "email",
                         "on": {"activity": "Settle claim"}, "exchanges": [{"artefact": "receipt", "reference": "receipt_id"}]}],
        "sentiment": {"rules": [{"on": "goal_reached", "goal": "paid", "change": 1, "reason": "has been paid"}]},
    }
    return workflow, journey


OUTPUTS = {"Request documents": {"asked": True}, "Settle claim": {"paid": True, "receipt_id": "RC-1"}}


def host(defs, store, journal, now=None):
    runtime = AwaRuntime(store=store, now=now, engine={"actors": simulated_actors(OUTPUTS), "journal": journal})
    return runtime.register_workflow(defs[0]).register_journey(defs[1])


def unbroken(events):
    return [e["seq"] for e in events] == list(range(1, len(events) + 1))


# ---------------------------------------------------------------------------
# A host that restarts (19.10)
# ---------------------------------------------------------------------------

def test_a_second_host_recovers_from_files_and_finishes_the_journey(tmp_path):
    defs = definitions()
    state, journals = tmp_path / "state" / "runtime.json", tmp_path / "journals"
    first = host(defs, FileRuntimeStore(state), FileJournalStore(str(journals)))
    submitted = business_event("claim.submitted", {"customer_id": "c-9"})
    first.publish(submitted)
    assert first.list_journey_instances()[0]["runs"][0]["status"] == "waiting_event"
    saved = json.loads(state.read_text())
    assert saved["version"] == "1" and saved["instances"][0]["subject_key"] == "c-9"
    assert saved["runs"][0]["workflow_id"] == defs[0]["id"] and saved["seen_events"] == [submitted["id"]]
    # The saved state never names a journal position that is not on record
    run_id = saved["runs"][0]["run_id"]
    on_record = FileJournalStore(str(journals)).read(run_id)
    assert saved["runs"][0]["state"]["metadata"]["journal_seq"] <= on_record[-1]["seq"]

    # The first host is gone. A second one, with new store objects over the same files, recovers.
    second = host(defs, FileRuntimeStore(state), FileJournalStore(str(journals)))
    assert second.recover() == {"instances": 1, "runs": 1, "continued": []}
    instance = second.list_journey_instances()[0]
    assert instance["status"] == "active" and instance["subject_key"] == "c-9"
    assert second.publish(submitted)["accepted"] is False  # accepted before the restart: not accepted again

    result = second.publish(business_event("documents.uploaded", {"customer_id": "c-9"}))
    assert len(result["resumed_runs"]) == 1
    assert instance["status"] == "completed" and instance["goals_reached"] == ["paid"] and instance["sentiment"] == 1
    # The recovered run still reports to its journey, and its journal is one unbroken record
    touchpoint = next(e for e in instance["events"] if e["type"] == "journey.touchpoint")
    assert touchpoint["run_id"] == run_id and touchpoint["data"]["artefacts"][0]["reference"] == "RC-1"
    events = second.export_journey(instance["id"])["runs"][0]["events"]
    assert unbroken(events)
    types = [e["type"] for e in events]
    assert [t for t in types if t in ("run.started", "event.waiting", "run.resumed", "event.received", "run.completed")] == \
        ["run.started", "event.waiting", "run.resumed", "event.received", "run.completed"]
    assert FileRuntimeStore(tmp_path / "none.json").load() is None


def test_a_deadline_fixed_before_the_restart_passes_at_its_time():
    defs, store, journal = definitions(), InMemoryRuntimeStore(), InMemoryJournalStore()
    clock = {"now": 1_800_000_000_000}
    host(defs, store, journal, lambda: clock["now"]).publish(business_event("claim.submitted", {"customer_id": "c-3"}))

    second = host(defs, store, journal, lambda: clock["now"])
    second.recover()
    clock["now"] += 4 * DAY
    assert second.tick()["timed_out_runs"] == []
    clock["now"] += 2 * DAY
    later = second.tick()
    assert len(later["timed_out_runs"]) == 1  # no timeout edge: the run fails, and the journey stalls at once
    instance = second.list_journey_instances()[0]
    assert instance["stalled"] is True and instance["status"] == "active"
    stalled = next(e for e in instance["events"] if e["type"] == "journey.stalled")
    assert stalled["data"]["owner"] == "Claims desk" and stalled["run_id"] == instance["runs"][0]["run_id"]
    assert second.export_portfolio()["journeys"][0]["instances"][0]["runs"][0]["events"][-1]["type"] == "run.failed"


def test_recovery_is_refused_when_a_workflow_is_missing_and_nothing_is_changed():
    defs, store, journal = definitions(), InMemoryRuntimeStore(), InMemoryJournalStore()
    host(defs, store, journal).publish(business_event("claim.submitted", {"customer_id": "c-1"}))
    before = json.dumps(store.load())
    run_id = store.load()["runs"][0]["run_id"]
    journalled = len(journal.read(run_id))

    with pytest.raises(RuntimeError, match="is not registered"):
        AwaRuntime(store=store, engine={"journal": journal}).recover()
    assert json.dumps(store.load()) == before  # a failed recovery must not overwrite the record
    assert len(journal.read(run_id)) == journalled

    # Once the definitions are back, the same state recovers in full
    repaired = host(defs, store, journal)
    assert repaired.recover()["runs"] == 1
    repaired.publish(business_event("documents.uploaded", {"customer_id": "c-1"}))
    assert repaired.list_journey_instances()[0]["status"] == "completed"


def test_a_journal_sequence_number_is_never_used_twice():
    defs, store, journal = definitions(), InMemoryRuntimeStore(), InMemoryJournalStore()
    first = host(defs, store, journal)
    first.publish(business_event("claim.submitted", {"customer_id": "c-4"}))
    run_id = first.list_journey_instances()[0]["runs"][0]["run_id"]
    # The process journalled two more events, then died before it could save its state again
    tail = journal.read(run_id)[-1]
    journal.append({**tail, "id": str(uuid4()), "seq": tail["seq"] + 1, "type": "activity.started"})
    journal.append({**tail, "id": str(uuid4()), "seq": tail["seq"] + 2, "type": "tool.invoked"})

    second = host(defs, store, journal)
    second.recover()
    second.publish(business_event("documents.uploaded", {"customer_id": "c-4"}))
    events = journal.read(run_id)
    assert unbroken(events)
    resumed = next(e for e in events if e["type"] == "run.resumed")
    assert resumed["seq"] == tail["seq"] + 3
    assert resumed["data"]["from_seq"] == tail["seq"]  # where the saved state was, which is not where the journal ended


def test_a_run_stopped_in_the_middle_is_continued_on_recovery():
    defs, store, journal = definitions(), InMemoryRuntimeStore(), InMemoryJournalStore()
    first = host(defs, store, journal)
    first.publish(business_event("claim.submitted", {"customer_id": "c-5"}))
    # As if the host had stopped after the event was delivered to the run and before the run went on
    state = store.load()
    token = state["runs"][0]["state"]["tokens"][0]
    token["status"] = "active"
    token["context_data" if "context_data" in token else "contextData"].pop("_awaiting_event", None)
    token["activity_id" if "activity_id" in token else "activityId"] = defs[0]["activities"][1]["id"]
    store.save(state)

    second = host(defs, store, journal)
    assert second.recover()["continued"] == [state["runs"][0]["run_id"]]
    instance = second.list_journey_instances()[0]
    assert instance["runs"][0]["status"] == "completed" and instance["status"] == "completed"
    assert store.load()["instances"][0]["status"] == "completed"  # and what followed was saved


# ---------------------------------------------------------------------------
# Events
# ---------------------------------------------------------------------------

def test_an_event_id_is_accepted_once_whoever_sends_it_again():
    defs = definitions()
    runtime = host(defs, InMemoryRuntimeStore(), InMemoryJournalStore())
    event = business_event("claim.submitted", {"customer_id": "c-1"}, id="evt-1")
    first, again = runtime.publish(event), runtime.publish(dict(event))
    assert first["accepted"] is True and len(first["started_runs"]) == 1 and len(first["journeys"]) == 1
    assert again == {"accepted": False, "resumed_runs": [], "started_runs": [], "journeys": []}
    # The same id under another type is the same event as far as the host can tell
    assert runtime.publish(business_event("documents.uploaded", {"customer_id": "c-1"}, id="evt-1"))["accepted"] is False
    instance = runtime.list_journey_instances()[0]
    assert [e["type"] for e in instance["events"]].count("journey.event_received") == 1
    assert len(runtime.list_runs()) == 1
    with pytest.raises(ValueError):
        runtime.publish({"type": "claim.submitted", "data": {}})


def test_a_workflow_starts_on_its_start_event_when_no_journey_is_involved():
    start, act, edge, role = (str(uuid4()) for _ in range(4))
    workflow = {
        "id": str(uuid4()), "name": "Welcome", "version": "1.0.0",
        "activities": [{"id": act, "name": "Greet", "role_id": role, "actor_type": "application"}],
        "events": [{"id": start, "name": "Signed up", "event_type": "start", "event_definition": {"name": "customer.signed_up"}}],
        "edges": [{"id": edge, "source_id": start, "target_id": act}],
    }
    runtime = AwaRuntime(engine={"actors": simulated_actors({"Greet": {"greeted": True}})}).register_workflow(workflow)
    result = runtime.publish(business_event("customer.signed_up", {"customer_id": "c-1"}))
    assert len(result["started_runs"]) == 1 and result["journeys"] == []
    run = runtime.get_run(result["started_runs"][0])
    assert run.status.value == "completed" and run.tokens[0].get_data("customer_id") == "c-1"


def test_a_journey_that_cannot_work_is_rejected():
    workflow, journey = definitions()
    assert validate_journey(parse_journey(journey), {workflow["id"]}) == []

    def codes(change):
        document = json.loads(json.dumps(journey))
        change(document)
        return {e["code"] for e in validate_journey(parse_journey(document), {workflow["id"]})}

    assert codes(lambda d: d["triggers"][0].update(starts_journey=False)) == {"invalid_journey"}
    assert codes(lambda d: d["triggers"][0].update(enter_stage="nowhere")) == {"invalid_reference"}
    assert codes(lambda d: d["stages"][0].update(complete_when="paid ==")) == {"invalid_expression"}
    assert codes(lambda d: d["touchpoints"][0]["exchanges"][0].update(artefact="nothing")) == {"invalid_reference"}
    assert codes(lambda d: d["sentiment"]["rules"].append({"on": "waited", "change": -1})) == {"invalid_journey"}
    assert codes(lambda d: d["stages"].append(dict(d["stages"][0]))) == {"duplicate_id"}
    with pytest.raises(Exception):
        parse_journey({**journey, "touchpoints": [{**journey["touchpoints"][0], "on": {"event": "a", "tool": "b"}}]})
    with pytest.raises(Exception):
        parse_journey({**journey, "sentiment": {"rules": [{"on": "event"}]}})
    with pytest.raises(ValueError, match="is not registered"):
        AwaRuntime().register_journey(journey)  # its workflow is not there


# ---------------------------------------------------------------------------
# A runtime directory and its lock
# ---------------------------------------------------------------------------

ENGINE = {"actors": simulated_actors(json.loads((EXAMPLE / "simulation.json").read_text()))}


def test_a_runtime_directory_is_opened_by_one_host_after_another(tmp_path):
    directory = str(tmp_path)
    assert add_definition(directory, read("policy-purchase.awa.json"))["kind"] == "workflow"
    assert add_definition(directory, read("policy-purchase.journey.json"))["kind"] == "journey"

    with open_runtime_directory(directory, engine=ENGINE) as first:
        first.publish(business_event("quote.requested", {"customer_id": "c-7"}, id="q-7"))
        assert (tmp_path / "runtime.lock").read_text() == str(os.getpid())
    assert not (tmp_path / "runtime.lock").exists()

    with open_runtime_directory(directory, engine=ENGINE) as second:
        assert second.publish(business_event("quote.requested", {"customer_id": "c-7"}, id="q-7"))["accepted"] is False
        second.publish(business_event("quote.accepted", {"customer_id": "c-7", "quote_accepted": True}))

    with open_runtime_directory(directory, engine=ENGINE) as third:
        instance = third.list_journey_instances()[0]
        assert instance["stage_id"] == "contracted"
        # The journal is on disk too: one file, one unbroken sequence across three hosts
        events = third.export_journey(instance["id"])["runs"][0]["events"]
        assert unbroken(events) and sum(1 for e in events if e["type"] == "run.resumed") >= 2
    assert len(os.listdir(tmp_path / "journals")) == 1
    assert sorted(os.listdir(tmp_path)) == ["definitions", "journals", "runtime.json"]


@pytest.mark.skipif(sys.platform == "win32", reason="asks whether a process exists with a POSIX signal")
def test_a_runtime_directory_is_held_by_one_host_at_a_time(tmp_path):
    directory = str(tmp_path)
    add_definition(directory, read("policy-purchase.awa.json"))
    lock = tmp_path / "runtime.lock"
    # Another live process holds it: this test's parent
    lock.write_text(str(os.getppid()))
    with pytest.raises(RuntimeError, match="in use by process"):
        open_runtime_directory(directory, engine=ENGINE)
    assert lock.read_text() == str(os.getppid())  # a refused host leaves the holder's lock alone

    # A process that no longer exists left its lock behind: it is taken over
    gone = subprocess.Popen([sys.executable, "-c", "pass"])
    gone.wait()
    lock.write_text(str(gone.pid))
    runtime = open_runtime_directory(directory, engine=ENGINE)
    assert lock.read_text() == str(os.getpid())
    runtime.close()
    runtime.close()  # safe to call more than once
    assert not lock.exists()


@pytest.mark.skipif(sys.platform == "win32", reason="asks whether a process exists with a POSIX signal")
def test_a_second_process_is_refused_while_the_first_holds_the_directory(tmp_path):
    directory = str(tmp_path)
    add_definition(directory, read("policy-purchase.awa.json"))
    attempt = [sys.executable, "-c",
               "import sys; from awa.runtime.runtime_host import open_runtime_directory\n"
               "try:\n    open_runtime_directory(sys.argv[1]).close(); print('opened')\n"
               "except RuntimeError as error:\n    print('refused:', error)", directory]
    environment = {**os.environ, "PYTHONPATH": str(Path(__file__).resolve().parents[1])}
    with open_runtime_directory(directory, engine=ENGINE):
        refused = subprocess.run(attempt, capture_output=True, text=True, env=environment)
        assert "refused:" in refused.stdout and "in use by process" in refused.stdout, refused.stdout + refused.stderr
    released = subprocess.run(attempt, capture_output=True, text=True, env=environment)
    assert released.stdout.strip() == "opened", released.stdout + released.stderr


def test_a_directory_that_cannot_be_recovered_is_not_left_locked(tmp_path):
    directory = str(tmp_path)
    add_definition(directory, read("policy-purchase.awa.json"))
    add_definition(directory, read("policy-purchase.journey.json"))
    with open_runtime_directory(directory, engine=ENGINE) as runtime:
        runtime.publish(business_event("quote.requested", {"customer_id": "c-7"}))
    before = (tmp_path / "runtime.json").read_text()
    kept = tmp_path / "kept"
    shutil.move(str(tmp_path / "definitions"), str(kept))

    with pytest.raises(RuntimeError, match="Cannot recover"):
        open_runtime_directory(directory, engine=ENGINE)
    assert (tmp_path / "runtime.json").read_text() == before and not (tmp_path / "runtime.lock").exists()

    shutil.rmtree(tmp_path / "definitions")
    shutil.move(str(kept), str(tmp_path / "definitions"))
    with open_runtime_directory(directory, engine=ENGINE) as runtime:
        assert len(runtime.list_journey_instances()) == 1


# ---------------------------------------------------------------------------
# The export and the measures
# ---------------------------------------------------------------------------

def schema(file_name):
    from jsonschema import Draft202012Validator, FormatChecker
    from referencing import Registry, Resource
    schemas = [json.loads(p.read_text()) for p in sorted(SCHEMAS.glob("*.json"))]
    registry = Registry().with_resources([(s["$id"], Resource.from_contents(s)) for s in schemas if "$id" in s])
    return Draft202012Validator(json.loads((SCHEMAS / file_name).read_text()), registry=registry, format_checker=FormatChecker())


def played():
    """A host that has carried two customers through the claim, one of them to the end"""
    defs = definitions()
    clock = {"now": 1_800_000_000_000}
    runtime = host(defs, InMemoryRuntimeStore(), InMemoryJournalStore(), lambda: clock["now"])
    runtime.publish(business_event("claim.submitted", {"customer_id": "c-1"}))
    runtime.publish(business_event("claim.submitted", {"customer_id": "c-2"}))
    clock["now"] += DAY
    runtime.publish(business_event("documents.uploaded", {"customer_id": "c-1"}))
    clock["now"] += 6 * DAY
    runtime.tick()
    return runtime, defs


def test_the_export_has_the_form_the_views_and_the_measures_read():
    runtime, defs = played()
    portfolio = runtime.export_portfolio()
    assert json.loads(json.dumps(portfolio)) == portfolio  # plain JSON, whatever the runs held
    assert list(portfolio) == ["as_of", "workflows", "transitions", "journeys"]
    assert portfolio["workflows"] == [defs[0]] and portfolio["transitions"] == []

    journey = portfolio["journeys"][0]
    assert list(journey) == ["definition", "analytics", "instances"]
    assert schema("journey.schema.json").is_valid(journey["definition"])
    # Defaults are written out, as the reference writes them, and what was absent stays absent
    assert journey["definition"]["touchpoints"][0]["party"] == "subject"
    assert journey["definition"]["sentiment"] == {**defs[1]["sentiment"], "min": -2, "max": 2, "initial": 0, "carry_over": True}
    assert "collect" not in journey["definition"] and journey["definition"]["stages"][0]["transitions"] == []
    assert journey["analytics"] == {
        "total": 2, "completed": 1, "abandoned": 0, "active": 1, "goals": {"paid": 1},
        "stages": [{"stage_id": "open", "stage_name": "Open", "entered": 2, "completed": 1, "active": 1, "stalled": 1,
                    "abandoned": 0, "median_duration_ms": DAY, "conversion": 0.5}],
    }

    assert [list(row) for row in journey["instances"]] == [["instance", "runs"]] * 2
    done, stuck = (row["instance"] for row in journey["instances"])
    assert set(done) == {"id", "journey_id", "subject_key", "status", "stage_id", "stage_entered_at", "stalled", "data",
                         "goals_reached", "runs", "stage_history", "started_at", "ended_at", "events", "sentiment"}
    assert done["status"] == "completed" and done["ended_at"] == done["stage_history"][0]["left_at"]
    assert set(done["runs"][0]) == {"run_id", "workflow_id", "workflow_name", "stage_id", "status", "started_at",
                                    "ended_at", "caused_by_event"}
    assert stuck["status"] == "active" and stuck["stalled"] is True and "ended_at" not in stuck
    event_schema, journal_schema = schema("journey-event.schema.json"), schema("journal-event.schema.json")
    for row in journey["instances"]:
        assert all(event_schema.is_valid(e) for e in row["instance"]["events"])
        run = row["runs"][0]
        assert list(run) == ["run_id", "workflow_id", "stage_id", "events"]
        # run_id is the join between the two layers
        assert run["run_id"] == row["instance"]["runs"][0]["run_id"] and {e["run_id"] for e in run["events"]} == {run["run_id"]}
        assert unbroken(run["events"]) and all(journal_schema.is_valid(e) for e in run["events"])

    # One journey on its own has the same parts
    bundle = runtime.export_journey(done["id"])
    assert list(bundle) == ["definition", "instance", "workflows", "runs"] and bundle["instance"] == done
    with pytest.raises(KeyError):
        runtime.export_journey("nobody")


def test_measures_of_an_export_follow_the_rules():
    runtime, _ = played()
    report = compute_measures(runtime.export_portfolio())
    assert [e.message for e in schema("measure-report.schema.json").iter_errors(report)] == []
    journey, workflow = report["journeys"][0], report["workflows"][0]
    values = {id: m["value"] for id, m in {**journey["measures"], **workflow["measures"]}.items()}
    assert values["journey.started"] == 2 and values["journey.completion_rate"] == 0.5
    assert values["journey.stall_rate"] == 0.5 and values["journey.stalled_now"] == 1
    assert values["journey.duration_median_ms"] == DAY and values["journey.mood_end"] == 1
    assert values["journey.goal_attainment"] == 0.5 and values["journey.abandonment_rate"] == 0
    assert values["workflow.runs"] == 2 and values["workflow.success_rate"] == 0.5 and values["workflow.failure_rate"] == 0.5
    assert values["workflow.event_wait_median_ms"] == DAY and values["workflow.event_timeout_rate"] == 0.5
    assert values["workflow.human_wait_median_ms"] is None  # nothing to compute it from: no value, never zero
    assert journey["stages"][0]["owner"] == "Claims desk"
    assert journey["channels"] == [{"channel": "email", "touchpoints": 1, "inbound": 0, "outbound": 1}]
    assert journey["artefacts"] == [{"kind": "receipt", "count": 1}]
    assert journey["mood"]["inferred_changes"] == 1 and journey["mood"]["measured_changes"] == 0
    assert [(a["subject_key"], a["owner"], a["reason"], a["waiting_ms"]) for a in report["attention"]] == \
        [("c-2", "Claims desk", "the Claim workflow failed", 7 * DAY)]
    assert set(report["totals"]) == {m["id"] for m in MEASURES if m["scope"] in ("journey", "workflow")}

    # A period keeps what started in it; an empty period has no rates
    empty = compute_measures(runtime.export_portfolio(), {"from": "2040-01-01T00:00:00Z"})
    assert empty["journeys"][0]["measures"]["journey.started"] == {"value": 0, "n": 0}
    assert empty["journeys"][0]["measures"]["journey.completion_rate"] == {"value": None, "n": 0}
    assert empty["workflows"] == [] and empty["series"]["points"] == []


def test_measures_in_the_openmetrics_text_format():
    report = compute_measures(read("journeys.json"))
    assert [e.message for e in schema("measure-report.schema.json").iter_errors(report)] == []
    text = measures_to_openmetrics(report)
    lines = text.split("\n")
    assert text.endswith("# EOF\n") and lines[0] == "# TYPE awa_journey_started gauge"
    assert 'awa_journey_started{journey="Motor Claim"} 6' in lines
    assert any(line.startswith('awa_stage_entered{journey="Motor Claim",stage="') for line in lines)
    assert any(line.startswith("awa_activity_attempts{workflow=") for line in lines)
    # A measure without a value is left out, and every sample belongs to a declared gauge
    declared = {line.split()[2] for line in lines if line.startswith("# TYPE")}
    samples = [line for line in lines if line and not line.startswith("#")]
    assert {line.split("{")[0] for line in samples} == declared
    assert all(line.rsplit(" ", 1)[1] not in ("None", "null", "nan") for line in samples)
    every = [m for j in report["journeys"] for group in (j, *j["stages"]) for m in group["measures"].values()]
    every += [m for w in report["workflows"] for group in (w, *w["activities"]) for m in group["measures"].values()]
    assert any(m["value"] is None for m in every) and len(samples) == sum(1 for m in every if m["value"] is not None)
    hostile = {"journeys": [{**report["journeys"][0], "name": 'a"b\\c\nd'}], "workflows": []}
    assert 'awa_journey_started{journey="a\\"b\\\\c\\nd"} 6' in measures_to_openmetrics(hostile)


def same_report(mine, reference, where=""):
    """Every number, text and list of the two reports, compared; a measure only one side knows is left aside"""
    if isinstance(mine, dict) and isinstance(reference, dict):
        measures = all(isinstance(v, dict) and set(v) == {"value", "n"} for v in [*mine.values(), *reference.values()])
        if not measures:
            assert list(mine) == list(reference), f"{where}: {list(mine)} != {list(reference)}"
        return sum(same_report(mine[key], reference[key], f"{where}/{key}") for key in mine if key in reference)
    if isinstance(mine, list) and isinstance(reference, list):
        assert len(mine) == len(reference), f"{where}: {len(mine)} items, the reference has {len(reference)}"
        return sum(same_report(a, b, f"{where}[{n}]") for n, (a, b) in enumerate(zip(mine, reference)))
    if isinstance(reference, (int, float)) and not isinstance(reference, bool):
        assert isinstance(mine, (int, float)) and not isinstance(mine, bool) and abs(mine - reference) < 1e-9, \
            f"{where}: {mine}, the reference has {reference}"
        return 1
    assert mine == reference, f"{where}: {mine!r}, the reference has {reference!r}"
    return 0


def test_measures_agree_with_the_reference_implementation_number_by_number():
    node = shutil.which("node")
    if not node or not REFERENCE.exists():
        pytest.skip("needs Node and the built reference SDK (sdk/typescript/dist)")
    script = ("const awa = require(process.argv[1]); const fs = require('fs');"
              "const report = awa.compute_measures(JSON.parse(fs.readFileSync(process.argv[2], 'utf-8')));"
              "console.log(JSON.stringify({ report, text: awa.measures_to_openmetrics(report) }));")
    ran = subprocess.run([node, "-e", script, str(REFERENCE), str(EXAMPLE / "journeys.json")], capture_output=True, text=True)
    if ran.returncode != 0:
        pytest.skip(f"the built reference SDK could not compute the measures: {ran.stderr.strip()[:200]}")
    reference = json.loads(ran.stdout)

    report = compute_measures(read("journeys.json"))
    assert same_report(report, reference["report"]) > 1000  # numbers compared

    # The same text for a metrics system, for the measures both sides know
    known = {line.split()[2] for line in reference["text"].split("\n") if line.startswith("# TYPE")}
    mine = [line for line in measures_to_openmetrics(report).split("\n")
            if not line or (line.split()[2] if line.startswith("#") and line != "# EOF" else line.split("{")[0].split(" ")[0]) in known
            or line == "# EOF"]
    assert mine == reference["text"].split("\n")


# ---------------------------------------------------------------------------
# The command line
# ---------------------------------------------------------------------------

def awa(*args):
    environment = {**os.environ, "PYTHONPATH": str(Path(__file__).resolve().parents[1])}
    return subprocess.run([sys.executable, "-m", "awa.cli", *args], capture_output=True, text=True, env=environment)


def test_the_command_line_runs_journeys_kept_in_a_directory(tmp_path):
    directory, simulate = str(tmp_path / "rt"), ["-s", "--outputs", str(EXAMPLE / "simulation.json")]
    added = awa("journey", "add", "--dir", directory, str(EXAMPLE / "policy-purchase.journey.json"), str(EXAMPLE / "policy-purchase.awa.json"))
    assert added.returncode == 0 and added.stdout.splitlines()[0].startswith('added workflow "Policy Purchase"'), added.stderr

    request = ["journey", "publish", "--dir", directory, *simulate, "quote.requested", "-d", '{"customer_id": "c-7"}', "--id", "q-7"]
    assert "started 1, concerned 1 journey(s)" in awa(*request).stdout
    assert awa(*request).stdout.strip() == "already taken in: nothing done"
    assert "stage quoted" in awa("journey", "list", "--dir", directory).stdout
    ticked = awa("journey", "tick", "--dir", directory, *simulate, "--at", "2100-01-01T00:00:00Z")
    assert ticked.stdout.strip() == "1 wait(s) timed out, 1 journey(s) newly stalled", ticked.stderr
    assert "stalled" in awa("journey", "list", "--dir", directory, "--stalled").stdout
    shown = awa("journey", "show", "--dir", directory, "c-7")
    assert "Policy Purchase: active (stalled)" in shown.stdout and "event_received     quote.requested" in shown.stdout
    assert json.loads(awa("journey", "show", "--dir", directory, "c-7", "--json").stdout)[0]["instance"]["subject_key"] == "c-7"
    assert awa("journey", "show", "--dir", directory, "nobody").returncode == 1
    assert not (tmp_path / "rt" / "runtime.lock").exists()

    export = tmp_path / "export.json"
    assert awa("journey", "export", "--dir", directory, "-o", str(export)).returncode == 0
    from_directory = json.loads(awa("measures", "--dir", directory, "--json").stdout)
    from_file = json.loads(awa("measures", "--file", str(export), "--json").stdout)
    assert from_directory["journeys"] == from_file["journeys"] and from_file["journeys"][0]["measures"]["journey.stalled_now"]["value"] == 1
    assert [e.message for e in schema("measure-report.schema.json").iter_errors(from_file)] == []
    assert "Needs someone now" in awa("measures", "--file", str(export)).stdout
    assert awa("measures", "--file", str(export), "--openmetrics").stdout.endswith("# EOF\n")
    listed = awa("measures", "--list").stdout.splitlines()
    assert len(listed) == len(MEASURES) and listed[0].startswith("journey.started")


# ---------------------------------------------------------------------------
# Over HTTP
# ---------------------------------------------------------------------------

def test_the_server_takes_in_events_and_reports_journeys_and_measures():
    pytest.importorskip("fastapi")
    pytest.importorskip("httpx")
    from fastapi.testclient import TestClient
    import awa.server as server

    key = next(iter(server.API_KEYS), None)
    headers = {"x-api-key": key} if key else {}
    client = TestClient(server.app)
    server.set_journey_runtime(AwaRuntime(engine=ENGINE))
    try:
        if server.AUTH_ENABLED:
            assert client.get("/api/v1/journeys").status_code == 401  # behind the same authentication as the other routes
        assert client.post("/api/v1/journeys/definitions", json=read("policy-purchase.journey.json"), headers=headers).status_code == 400
        assert client.post("/api/v1/journeys/definitions", json=read("policy-purchase.awa.json"), headers=headers).json()["kind"] == "workflow"
        added = client.post("/api/v1/journeys/definitions", json=read("policy-purchase.journey.json"), headers=headers)
        assert added.status_code == 201 and added.json()["kind"] == "journey"

        event = {"type": "quote.requested", "id": "q-1", "data": {"customer_id": "c-1"}}
        taken = client.post("/api/v1/journeys/events", json=event, headers=headers)
        assert taken.status_code == 202 and taken.json()["accepted"] is True and taken.json()["event_id"] == "q-1"
        assert client.post("/api/v1/journeys/events", json=event, headers=headers).json()["accepted"] is False
        assert client.post("/api/v1/journeys/events", json={"data": {}}, headers=headers).status_code == 400

        assert client.get("/api/v1/journeys", headers=headers).json()[0]["analytics"]["total"] == 1
        instances = client.get("/api/v1/journeys/instances", params={"subject": "c-1"}, headers=headers).json()
        assert len(instances) == 1 and instances[0]["stage_id"] == "quoted"
        one = client.get(f"/api/v1/journeys/instances/{instances[0]['id']}", headers=headers).json()
        assert list(one) == ["definition", "instance", "workflows", "runs"]
        assert client.get("/api/v1/journeys/instances/nobody", headers=headers).status_code == 404
        assert client.post("/api/v1/journeys/tick", json={"at": "yesterday"}, headers=headers).status_code == 400
        ticked = client.post("/api/v1/journeys/tick", json={"at": "2100-01-01T00:00:00Z"}, headers=headers).json()
        assert len(ticked["timed_out_runs"]) == 1 and len(ticked["stalled_journeys"]) == 1
        assert len(client.get("/api/v1/journeys/instances", params={"stalled": "true"}, headers=headers).json()) == 1
        assert client.get("/api/v1/journeys/transitions", headers=headers).json() == []
        portfolio = client.get("/api/v1/journeys/portfolio", headers=headers).json()
        assert list(portfolio) == ["as_of", "workflows", "transitions", "journeys"]

        report = client.get("/api/v1/measures", headers=headers).json()
        assert [e.message for e in schema("measure-report.schema.json").iter_errors(report)] == []
        assert report["journeys"][0]["measures"]["journey.stalled_now"]["value"] == 1
        assert client.get("/api/v1/measures", params={"from": "2100-01-01T00:00:00Z"}, headers=headers).json()["journeys"][0]["measures"]["journey.started"]["value"] == 0
        assert client.get("/api/v1/measures", params={"from": "soon"}, headers=headers).status_code == 400
        scraped = client.get("/api/v1/measures", params={"format": "openmetrics"}, headers=headers)
        assert scraped.headers["content-type"].startswith("application/openmetrics-text") and scraped.text.endswith("# EOF\n")
        assert len(client.get("/api/v1/measures/definitions", headers=headers).json()) == len(MEASURES)
    finally:
        server.set_journey_runtime(None)
