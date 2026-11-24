"""
Reading what an evidence report or an evaluation dataset is computed from: journal
files, exported portfolios and runtime directories. Nothing here opens a runtime
directory as a host: its files are read, no lock is taken and no run is continued,
so evidence can be gathered while a host runs.

Follows sdk/typescript/src/runtime/evidence_sources.ts.
"""

import json
import os
from typing import Any

from awa.runtime.journal import parse_journal
from awa.runtime.runtime_host import is_journey_document

Json = dict[str, Any]


def _journal_files(directory: str) -> list[str]:
    """Every journal file under a directory, its own and those of a journals/ folder"""
    found = []
    for folder in (directory, os.path.join(directory, "journals")):
        if os.path.isdir(folder):
            found += [os.path.join(folder, name) for name in sorted(os.listdir(folder)) if name.endswith(".jsonl")]
    return found


def read_journals(paths: list[str]) -> list[Json]:
    """The journal events held by files and directories of journal files (.jsonl)"""
    events: list[Json] = []
    for p in paths:
        if not os.path.exists(p):
            raise FileNotFoundError(f"No such file or directory: {p}")
        for file in (_journal_files(p) if os.path.isdir(p) else [p]):
            with open(file, encoding="utf-8") as handle:
                events += parse_journal(handle.read())
    return events


def _runs_of(events: list[Json]) -> list[Json]:
    runs: dict[str, Json] = {}
    for e in events:
        runs.setdefault(e["run_id"], {"run_id": e["run_id"], "workflow_id": e.get("workflow_id"), "events": []})["events"].append(e)
    return list(runs.values())


def _read_runtime_directory(directory: str) -> Json:
    """A runtime directory (19.10) read as files: definitions, journey records and journals"""
    definitions = []
    folder = os.path.join(directory, "definitions")
    if os.path.isdir(folder):
        for name in sorted(n for n in os.listdir(folder) if n.endswith(".json")):
            with open(os.path.join(folder, name), encoding="utf-8") as handle:
                definitions.append(json.load(handle))
    state: Json = {"instances": []}
    if os.path.exists(os.path.join(directory, "runtime.json")):
        with open(os.path.join(directory, "runtime.json"), encoding="utf-8") as handle:
            state = json.load(handle)
    runs = {r["run_id"]: r for r in _runs_of(read_journals([os.path.join(directory, "journals")]) if os.path.isdir(os.path.join(directory, "journals")) else [])}
    used: set[str] = set()
    journeys = []
    for definition in (d for d in definitions if is_journey_document(d)):
        instances = []
        for instance in (i for i in state.get("instances") or [] if i.get("journey_id") == definition["id"]):
            mine = []
            for ref in instance.get("runs") or []:
                used.add(ref["run_id"])
                mine.append({**runs.get(ref["run_id"], {"run_id": ref["run_id"], "workflow_id": ref.get("workflow_id"), "events": []}), "stage_id": ref.get("stage_id")})
            instances.append({"instance": instance, "runs": mine})
        journeys.append({"definition": {"id": definition["id"], "name": definition.get("name")}, "instances": instances})
    workflows = [{"id": d["id"], "name": d.get("name"), "version": d.get("version"),
                  "activities": [{"id": a["id"], "name": a.get("name"), "actor_type": a.get("actor_type")} for a in d.get("activities") or []]}
                 for d in definitions if not is_journey_document(d)]
    return {"workflows": workflows, "journeys": journeys, "runs": [r for r in runs.values() if r["run_id"] not in used]}


def read_evidence_input(paths: list[str]) -> Json:
    """
    What an evidence report is computed from, read from any mix of: runtime directories,
    directories of journal files, journal files (.jsonl), and portfolios exported by a host (.json).
    """
    merged: Json = {"workflows": [], "journeys": [], "runs": []}
    loose: list[Json] = []
    for p in paths:
        if not os.path.exists(p):
            raise FileNotFoundError(f"No such file or directory: {p}")
        if os.path.isdir(p):
            if os.path.exists(os.path.join(p, "runtime.json")) or os.path.isdir(os.path.join(p, "definitions")):
                part = _read_runtime_directory(p)
            else:
                loose += read_journals([p])
                continue
        elif p.endswith(".jsonl"):
            loose += read_journals([p])
            continue
        else:
            with open(p, encoding="utf-8") as handle:
                document = json.load(handle)
            # One journey with its runs, as a host exports it, or a portfolio of several, or loose runs
            if isinstance(document, dict) and document.get("definition") and document.get("instance") and isinstance(document.get("runs"), list):
                part = {"workflows": document.get("workflows") or [], "journeys": [{"definition": document["definition"], "instances": [{"instance": document["instance"], "runs": document["runs"]}]}]}
            elif isinstance(document, dict) and (isinstance(document.get("journeys"), list) or isinstance(document.get("runs"), list)):
                part = document
            else:
                raise ValueError(f"{p} is neither a portfolio nor a journey exported by a host, nor a journal (.jsonl)")
        merged["workflows"] += part.get("workflows") or []
        merged["journeys"] += part.get("journeys") or []
        merged["runs"] += part.get("runs") or []
        if part.get("as_of") and (not merged.get("as_of") or part["as_of"] > merged["as_of"]):
            merged["as_of"] = part["as_of"]
    merged["runs"] += _runs_of(loose)
    return merged
