"""
The command line: awa run with every option of the reference, awa knowledge
and awa task. Each command runs in a child process, as a person would run it.
Model calls go to a local http.server only.
"""

import json
import os
import subprocess
import sys
import threading
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path
from uuid import uuid4

import pytest

ROOT = Path(__file__).resolve().parents[1]
EXAMPLES = ROOT.parents[1] / "examples"


def awa(*args, env=None, cwd=None):
    environment = {**os.environ, "PYTHONPATH": str(ROOT), **(env or {})}
    return subprocess.run([sys.executable, "-m", "awa.cli", *map(str, args)], capture_output=True, text=True,
                          env=environment, cwd=cwd)


def journal(file):
    events = [json.loads(line) for line in Path(file).read_text().splitlines() if line.strip()]
    assert [e["seq"] for e in events] == list(range(1, len(events) + 1))
    for event in events:
        for name in ("spec_version", "id", "run_id", "seq", "time", "type", "level", "workflow_id", "data"):
            assert name in event
    return events


def uid():
    return str(uuid4())


# ---------------------------------------------------------------------------
# awa run
# ---------------------------------------------------------------------------

def test_run_help_lists_the_options_of_the_reference():
    text = awa("run", "--help").stdout
    for option in ("--simulate", "--outputs", "--journal", "--checkpoint-dir", "--input", "--providers",
                   "--allow-commands", "--db", "--verbose", "--key", "-s", "-j", "-c", "-i", "-p"):
        assert option in text


@pytest.mark.parametrize("example", ["claims-settlement", "order-processing"])
def test_run_simulates_an_example_with_its_outputs_and_writes_the_journal(tmp_path, example):
    directory = EXAMPLES / example
    file = next(directory.glob("*.awa.json"))
    out = tmp_path / "run.jsonl"
    result = awa("run", file, "--simulate", "--outputs", directory / "simulation.json", "--journal", out)
    assert result.returncode == 0, result.stderr
    assert "Running in SIMULATION MODE" in result.stdout
    assert "Status: completed" in result.stdout and "Cost: USD 0.000000" in result.stdout
    assert "Workflow finished with status: completed" in result.stdout
    assert f"Journal written to {out}" in result.stdout
    events = journal(out)
    assert events[0]["type"] == "run.started" and events[0]["data"]["simulate"] is True
    assert events[-1]["type"] == "run.completed"
    if example == "claims-settlement":
        # attempts: a scripted error with its code is retried, a contract violation is re-executed
        failed = [e["data"]["error"] for e in events if e["type"] == "activity.failed"]
        assert {"message": "Fraud scoring service timed out", "code": "TIMEOUT"} in failed
        assert any(e["code"] == "CONTRACT_VIOLATION" for e in failed)
    else:
        # contexts: what an activity writes to a context, from simulation.json
        written = [e for e in events if e["type"] == "context.written"]
        assert [e["data"]["context_name"] for e in written] == ["Order Data"]


def test_run_without_the_outputs_explains_what_is_missing():
    result = awa("run", EXAMPLES / "order-processing" / "order-processing.awa.json", "--simulate")
    assert result.returncode == 1
    assert "Workflow finished with status: failed" in result.stdout
    assert "Failed: " in result.stderr and "Workflow failed." in result.stderr


def small_workflow(tmp_path, actor_type="application", role=None, **activity):
    role_id = uid()
    doc = {"id": uid(), "name": "Small", "version": "1.0.0", "edges": [],
           "roles": [{"id": role_id, "name": "Assistant", "actor_type": actor_type, **(role or {})}],
           "activities": [{"id": uid(), "name": "Answer", "role_id": role_id, "actor_type": actor_type, **activity}]}
    file = tmp_path / "small.awa.json"
    file.write_text(json.dumps(doc))
    return file


def test_run_input_and_checkpoint_dir(tmp_path):
    file = small_workflow(tmp_path)
    checkpoints = tmp_path / "checkpoints"
    result = awa("run", file, "--input", json.dumps({"order_id": "A-1"}), "--checkpoint-dir", checkpoints, "-v")
    assert result.returncode == 0, result.stderr
    assert "Step 1 completed." in result.stdout
    (saved,) = list(checkpoints.glob("*.checkpoint.json"))
    state = json.loads(saved.read_text())
    assert state["engine_status"] == "completed"
    assert state["tokens"][0]["context_data"]["order_id"] == "A-1"

    bad = awa("run", file, "--input", "[1]")
    assert bad.returncode == 1 and "--input must be a JSON object" in bad.stderr


def test_run_allow_commands_lets_tools_run_the_programs_named(tmp_path):
    # What the option gives the engine's tool options; ToolRunner's own tests cover what they allow
    from awa.cli.run import _allow_commands
    assert _allow_commands(None) is False
    assert _allow_commands(True) is True and _allow_commands("all") is True
    assert _allow_commands("git, ls") == ["git", "ls"]
    assert awa("run", small_workflow(tmp_path), "--allow-commands").returncode == 0
    assert awa("run", small_workflow(tmp_path), "--allow-commands", "git,ls").returncode == 0


def test_run_db_logs_the_execution_to_the_database(tmp_path):
    database = tmp_path / "runs.db"
    result = awa("run", small_workflow(tmp_path), "--db", env={"AWA_DATABASE_URL": str(database)})
    assert result.returncode == 0, result.stderr
    assert "--- Workflow Execution Metrics ---" not in result.stdout
    import sqlite3
    with sqlite3.connect(database) as connection:
        assert connection.execute("SELECT status FROM workflow_executions").fetchall() == [("completed",)]

    elsewhere = tmp_path / "other.db"
    assert awa("run", small_workflow(tmp_path), env={"AWA_DATABASE_URL": str(elsewhere)}).returncode == 0
    with sqlite3.connect(elsewhere) as connection:
        assert connection.execute("SELECT COUNT(*) FROM workflow_executions").fetchone() == (0,)


@pytest.mark.parametrize("name", ["google", "embedded"])
def test_run_refuses_the_providers_python_does_not_have(tmp_path, name):
    result = awa("run", small_workflow(tmp_path), "--providers", name)
    assert result.returncode == 1
    assert f'Provider "{name}" is not available' in result.stderr and "Python SDK has no" in result.stderr


def test_run_refuses_an_unknown_provider_and_openai_without_a_key(tmp_path):
    assert 'Unknown provider "other"' in awa("run", small_workflow(tmp_path), "-p", "other").stderr
    result = awa("run", small_workflow(tmp_path), "-p", "openai", env={"OPENAI_API_KEY": ""})
    assert result.returncode == 1 and "OPENAI_API_KEY" in result.stderr


class _ChatServer(BaseHTTPRequestHandler):
    requests: list = []

    def do_POST(self):
        body = json.loads(self.rfile.read(int(self.headers["content-length"])))
        type(self).requests.append({"path": self.path, "body": body})
        answer = {"reasoning": {"plan": ["answer"], "rationale": "asked", "alternatives_considered": [], "confidence": 1},
                  "output": {"answer": 42}}
        reply = json.dumps({"choices": [{"message": {"role": "assistant", "content": json.dumps(answer)}}],
                            "usage": {"prompt_tokens": 1000, "completion_tokens": 500}}).encode()
        self.send_response(200)
        self.send_header("content-type", "application/json")
        self.send_header("content-length", str(len(reply)))
        self.end_headers()
        self.wfile.write(reply)

    def log_message(self, *args):
        pass


def test_run_calls_an_openai_compatible_server_through_the_ollama_provider(tmp_path):
    _ChatServer.requests = []
    server = HTTPServer(("127.0.0.1", 0), _ChatServer)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    try:
        file = small_workflow(tmp_path, "ai_agent")
        out = tmp_path / "run.jsonl"
        result = awa("run", file, "--providers", "ollama", "--journal", out, env={
            "OLLAMA_BASE_URL": f"http://127.0.0.1:{server.server_port}/v1", "AWA_OLLAMA_MODEL": "test-model"})
    finally:
        server.shutdown()
    assert result.returncode == 0, result.stderr
    (request,) = _ChatServer.requests
    assert request["path"] == "/v1/chat/completions" and request["body"]["model"] == "test-model"
    assert request["body"]["messages"][0]["role"] == "system"
    # 1000 tokens in at 0.0001 per 1000, 500 out at 0.0004 per 1000
    assert "Tokens: 1500 (In: 1000, Out: 500)" in result.stdout and "Cost: USD 0.000300" in result.stdout
    events = journal(out)
    assert any(e["type"] == "reasoning.recorded" for e in events)
    selection = [e for e in events if e["type"] == "meta.recorded" and e["data"]["subject"] == "model_selection"]
    assert selection[0]["data"]["model"]["provider"] == "ollama" and selection[0]["data"]["model"]["tier"] == "balanced"


def test_model_options_map_each_tier_down_the_providers():
    from awa.cli.run import model_options
    options = model_options(["ollama", "openai"], {"OPENAI_API_KEY": "k", "AWA_OLLAMA_MODEL": "local-model",
                                                   "AWA_OPENAI_MODEL_REASONING": "hosted-model"})
    assert [p.id for p in options["model_providers"]] == ["ollama", "openai"]
    assert options["default_model_provider"] == "ollama"
    assert options["model_tiers"] == {"reasoning": ["ollama:local-model", "openai:hosted-model"],
                                      "balanced": ["ollama:local-model"], "fast": ["ollama:local-model"]}
    assert model_options([]) == {}


# ---------------------------------------------------------------------------
# awa knowledge
# ---------------------------------------------------------------------------

def test_knowledge_ingest_list_review_and_deprecate(tmp_path):
    directory = EXAMPLES / "claims-settlement"
    workflow = directory / "claims-settlement.awa.json"
    runs = []
    for index in range(2):
        runs.append(tmp_path / f"run{index}.jsonl")
        assert awa("run", workflow, "-s", "--outputs", directory / "simulation.json", "-j", runs[-1]).returncode == 0
    kb = tmp_path / "kb.json"

    ingested = awa("knowledge", "ingest", workflow, *runs, "--kb", kb)
    assert ingested.returncode == 0, ingested.stderr
    lines = ingested.stdout.splitlines()
    assert len(lines) == 2 and "created" in lines[0] and "updated" in lines[1]
    again = awa("knowledge", "ingest", workflow, runs[0], "--kb", kb)
    assert again.stdout.strip().endswith("already ingested")

    data = json.loads(kb.read_text())
    ids = [e["id"] for e in data["entries"]]
    assert ids and all(e["status"] == "draft" for e in data["entries"])
    listing = awa("knowledge", "list", "--kb", kb).stdout
    assert ids[0] in listing and "  2 run(s)" in listing

    reviewed = awa("knowledge", "review", ids[0], "--by", "A. Reviewer", "--kb", kb)
    assert reviewed.stdout.strip() == "1 entry reviewed by A. Reviewer"
    assert ids[0] in awa("knowledge", "list", "--status", "reviewed", "--kb", kb).stdout
    assert awa("knowledge", "review", "all", "--by", "B", "--kb", kb).returncode == 0
    assert awa("knowledge", "list", "--status", "draft", "--kb", kb).stdout == ""

    if len(ids) > 1:
        assert awa("knowledge", "deprecate", ids[0], "--superseded-by", ids[1], "--kb", kb).stdout.strip() == f"{ids[0]} deprecated"
        entry = next(e for e in json.loads(kb.read_text())["entries"] if e["id"] == ids[0])
        assert entry["status"] == "deprecated" and entry["superseded_by"] == ids[1]
    missing = awa("knowledge", "deprecate", "no-such-entry", "--kb", kb)
    assert missing.returncode == 1 and 'Knowledge entry "no-such-entry" not found' in missing.stderr
    assert awa("knowledge", "review", ids[0], "--kb", kb).returncode == 2  # --by is required


def test_knowledge_uses_knowledge_json_by_default_and_says_what_is_left_out(tmp_path):
    help_text = " ".join(awa("knowledge", "--help").stdout.split())
    assert "Open Knowledge Format" in help_text and "not part of the Python SDK" in help_text
    assert "knowledge.json" in " ".join(awa("knowledge", "list", "--help").stdout.split())
    assert awa("knowledge", "list", cwd=tmp_path).returncode == 0
    assert awa("knowledge", "export", "x").returncode == 2


# ---------------------------------------------------------------------------
# awa task
# ---------------------------------------------------------------------------

def test_task_list_show_assign_complete_and_reject(tmp_path):
    env = {"AWA_DATABASE_URL": str(tmp_path / "tasks.db")}
    script = ("from awa.runtime.services.task_service import TaskService\n"
              "import uuid\n"
              "for name in ('Approve claim', 'Check photos'):\n"
              "    t = TaskService.create({'activity_id': uuid.uuid4(), 'activity_name': name, 'token_id': uuid.uuid4(),"
              " 'workflow_id': uuid.uuid4(), 'role_id': uuid.uuid4(), 'inputs': {'claim': 7}, 'description': 'Look'})\n"
              "    print(t.id)\n")
    created = subprocess.run([sys.executable, "-c", script], capture_output=True, text=True,
                             env={**os.environ, "PYTHONPATH": str(ROOT), **env})
    first, second = created.stdout.split()

    listing = awa("task", "list", env=env).stdout
    assert first in listing and second in listing and "Approve claim" in listing and "pending" in listing
    assert awa("task", "list", "--status", "completed", env=env).stdout.strip() == "No tasks found."

    shown = awa("task", "show", first, env=env).stdout
    assert f"ID:        {first}" in shown and "Desc:      Look" in shown and '"claim": 7' in shown

    assigned = awa("task", "assign", first, "user-1", env=env).stdout
    assert f"Task {first} assigned to user-1" in assigned and "New Status: assigned" in assigned
    assert first in awa("task", "list", "-s", "assigned", "-a", "user-1", env=env).stdout

    assert awa("task", "complete", first, "not json", env=env).stderr.strip() == "Invalid JSON outputs"
    assert awa("task", "complete", first, '{"approved": true}', env=env).stdout.strip() == f"Task {first} completed."
    assert '"approved": true' in awa("task", "show", first, env=env).stdout

    assert awa("task", "reject", second, "Blurry photos", env=env).stdout.strip() == f"Task {second} rejected."
    assert "Blurry photos" in awa("task", "show", second, env=env).stdout

    missing = str(uuid4())
    assert awa("task", "show", missing, env=env).returncode == 1
    assert "not found" in awa("task", "complete", missing, env=env).stderr


class _ToolCallingServer(BaseHTTPRequestHandler):
    """Asks for the tool "echo" once, then answers"""

    def do_POST(self):
        body = json.loads(self.rfile.read(int(self.headers["content-length"])))
        if any(m["role"] == "tool" for m in body["messages"]):
            message = {"role": "assistant", "content": json.dumps({"reasoning": {}, "output": {"done": True}})}
        else:
            message = {"role": "assistant", "content": "", "tool_calls": [
                {"id": "c1", "type": "function", "function": {"name": "echo", "arguments": "{}"}}]}
        reply = json.dumps({"choices": [{"message": message}], "usage": {}}).encode()
        self.send_response(200)
        self.send_header("content-type", "application/json")
        self.send_header("content-length", str(len(reply)))
        self.end_headers()
        self.wfile.write(reply)

    def log_message(self, *args):
        pass


@pytest.mark.parametrize("allow", [None, "all", "named", "other"])
def test_run_allow_commands_decides_whether_a_command_tool_runs(tmp_path, allow):
    program = Path(sys.executable).name
    tool = {"name": "echo", "description": "Echo", "parameters": {"type": "object", "properties": {}},
            "binding": {"kind": "command", "command": program, "args": ["-c", "print(7)"]}}
    file = small_workflow(tmp_path, "ai_agent", tools=[tool])
    server = HTTPServer(("127.0.0.1", 0), _ToolCallingServer)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    option = {None: [], "all": ["--allow-commands"], "named": ["--allow-commands", f"ls,{program}"],
              "other": ["--allow-commands", "ls"]}[allow]
    out = tmp_path / "run.jsonl"
    try:
        result = awa("run", file, "-p", "ollama", "-j", out, *option, env={
            "OLLAMA_BASE_URL": f"http://127.0.0.1:{server.server_port}/v1", "AWA_OLLAMA_MODEL": "test-model",
            "PATH": f"{Path(sys.executable).parent}{os.pathsep}{os.environ.get('PATH', '')}"})
    finally:
        server.shutdown()
    assert result.returncode == 0, result.stderr
    events = journal(out)
    if allow in ("all", "named"):
        assert [e["type"] for e in events if e["type"].startswith("tool.")] == ["tool.invoked", "tool.completed"]
    else:
        (failed,) = [e for e in events if e["type"] == "tool.failed"]
        assert failed["data"]["error"]["code"] == "PERMISSION_DENIED"
