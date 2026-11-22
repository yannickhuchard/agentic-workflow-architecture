"""
AWA Knowledge Layer (specification section 15.1 to 15.4)

Turns run journals into knowledge that compounds: each run adds evidence to
entries that already exist instead of creating duplicates, every entry points
back to the runs and journal events it came from, and only entries a person
has reviewed are given to actors unless a binding says otherwise.

An entry is a JSON object with the fields of specification 15.1: `id`, `type`,
`title`, `description`, `tags`, `scope`, `status`, `observations`, `counts`,
`latest`, `sources`, `created_at`, `updated_at` and, once set, `reviewed_by`,
`reviewed_at` and `superseded_by`.

The Open Knowledge Format exchange (15.5) is not implemented by this SDK. A
knowledge base is saved and loaded as JSON, in the form the reference
implementation writes with `to_json`.
"""

from __future__ import annotations

import copy
import json
import os
import re
from datetime import datetime, timezone
from typing import Any

from awa.runtime.journal import JournalEvent
from awa.types import Activity, Workflow

KnowledgeEntry = dict[str, Any]

KNOWLEDGE_TYPES = ("strategy", "failure_pattern", "decision_precedent", "lesson")
KNOWLEDGE_STATUSES = ("draft", "reviewed", "deprecated")

# The directory of each type in a bundle, which begins the id of its entries
DIRECTORY = {
    "strategy": "strategies",
    "failure_pattern": "failure-patterns",
    "decision_precedent": "decision-precedents",
    "lesson": "lessons",
}
# The most sources an entry keeps; `observations` goes on counting beyond it
MAX_SOURCES = 50


def _slug(text: Any) -> str:
    return re.sub(r"[^a-z0-9]+", "-", str(text).lower()).strip("-")[:60] or "x"


def _one_line(text: Any) -> str:
    return re.sub(r"\s+", " ", "" if text is None else str(text)).strip()


def _without_absent(values: dict[str, Any]) -> dict[str, Any]:
    return {key: value for key, value in values.items() if value is not None}


def _now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


# ----------------------------------------------------------------------
# Distillation (15.2)
# ----------------------------------------------------------------------

def distill(workflow: Workflow, events: list[JournalEvent]) -> list[dict[str, Any]]:
    """
    Distil the journal of one run into candidate knowledge entries.
    Deterministic and model-free: the same journal always yields the same
    candidates, and every candidate cites, in `event_seqs`, the events it came
    from. A candidate's id says what it is about, not which run it came from.
    """
    ordered = sorted(events, key=lambda e: e["seq"])
    wf = {"workflow_id": str(workflow.id), "workflow_name": workflow.name}
    wf_slug = _slug(workflow.name)
    candidates: list[dict[str, Any]] = []
    node_events: dict[str, list[JournalEvent]] = {}
    for event in ordered:
        if event.get("node_id"):
            node_events.setdefault(event["node_id"], []).append(event)

    for activity in workflow.activities:
        here = node_events.get(str(activity.id), [])
        scope = {**wf, "node_id": str(activity.id), "node_name": activity.name}
        base = f"{wf_slug}-{_slug(activity.name)}"
        actor_type = activity.actor_type.value
        accepted = next((e for e in here if e["type"] == "activity.completed"), None)
        failures = [e for e in here if e["type"] == "activity.failed"]
        escalated = any(e["type"] == "contract.escalated" for e in here)

        # Strategy: how the accepted attempt went about the work
        reasoning = accepted and next(
            (e for e in reversed(here) if e["type"] == "reasoning.recorded" and e.get("attempt") == accepted.get("attempt")), None)
        if accepted and reasoning:
            model = next((e for e in here if e["type"] == "meta.recorded" and e["data"].get("subject") == "model_selection"), None)
            attempts = accepted.get("attempt") or 1
            chosen = (model["data"].get("model") or {}) if model else {}
            candidates.append({
                "id": f"{DIRECTORY['strategy']}/{base}",
                "type": "strategy",
                "title": f"How to {activity.name[:1].lower()}{activity.name[1:]}",
                "description": f'The approach whose outcome was accepted for "{activity.name}".',
                "tags": [actor_type, wf_slug],
                "scope": scope,
                "counts": {"accepted_runs": 1, "accepted_first_attempt": 1 if attempts == 1 else 0, "attempts": attempts},
                "latest": _without_absent({
                    "plan": reasoning["data"].get("plan"),
                    "rationale": reasoning["data"].get("rationale"),
                    "alternatives_considered": reasoning["data"].get("alternatives_considered"),
                    "confidence": reasoning["data"].get("confidence"),
                    "model": chosen.get("requested") if isinstance(chosen, dict) else None,
                }),
                "event_seqs": [reasoning["seq"], accepted["seq"]],
            })

        # Failure patterns: what went wrong here, and what resolved it
        for failure in failures:
            error = failure["data"].get("error") or {}
            code = error.get("code") or "ERROR"
            wanted = "contract.checked" if code == "CONTRACT_VIOLATION" else "verification.completed"
            check = next((e for e in here if e.get("attempt") == failure.get("attempt") and e["type"] == wanted), None)
            if code == "CONTRACT_VIOLATION":
                terms = [v["name"] for v in (check["data"].get("violations") if check else None) or []]
            elif code == "VERIFICATION_FAILED":
                terms = [c["criterion_name"] for c in (check["data"].get("criteria") if check else None) or []
                         if not c.get("passed")]
            else:
                terms = []
            signature = "+".join(sorted(terms)) if terms else re.sub(r"\d+", "N", _one_line(error.get("message")))
            following = next((e for e in here if e["type"] == "activity.started"
                              and (e.get("attempt") or 0) == (failure.get("attempt") or 0) + 1), None)
            feedback = following["data"].get("feedback") if following else None
            if not accepted:
                resolution = "escalated" if escalated else "unresolved"
            else:
                resolution = "escalated" if escalated else "retry_with_feedback" if feedback else "retry"
            candidates.append({
                "id": f"{DIRECTORY['failure_pattern']}/{base}-{_slug(code)}-{_slug(signature)}"[:140],
                "type": "failure_pattern",
                "title": f"{activity.name}: {code.lower().replace('_', ' ')}" + (f" ({', '.join(terms)})" if terms else ""),
                "description": f'"{activity.name}" was rejected or raised: {_one_line(error.get("message"))[:140]}',
                "tags": [actor_type, wf_slug, code.lower()],
                "scope": scope,
                "counts": {"occurrences": 1, f"resolved_by_{resolution}": 1},
                "latest": _without_absent({
                    "code": code, "terms": terms, "message": error.get("message"), "feedback": feedback,
                    "resolution": resolution,
                }),
                "event_seqs": [failure["seq"], *([check["seq"]] if check else [])],
            })

    # Decision precedents: which rule a set of inputs matched
    nodes = [*workflow.activities, *workflow.events, *workflow.decision_nodes]
    for decision in workflow.decision_nodes:
        for event in [e for e in node_events.get(str(decision.id), []) if e["type"] == "decision.evaluated"]:
            rules = event["data"].get("matched_rules") or []
            rule = rules[0] if rules else None
            edge = next((e for e in workflow.edges if str(e.id) == str(event["data"].get("edge_id"))), None)
            target = edge and next((n for n in nodes if str(n.id) == str(edge.target_id)), None)
            label = f"rule {rule['index'] + 1}" if rule else "default"
            candidates.append({
                "id": f"{DIRECTORY['decision_precedent']}/{wf_slug}-{_slug(decision.name)}-{_slug(label)}",
                "type": "decision_precedent",
                "title": f"{decision.name}: {label}" + (f" routes to {target.name}" if target else ""),
                "description": f'Inputs that matched {label} of "{decision.name}"'
                               + (f' and were routed to "{target.name}"' if target else "") + ".",
                "tags": ["decision", wf_slug],
                "scope": {**wf, "node_id": str(decision.id), "node_name": decision.name},
                "counts": {"occurrences": 1},
                "latest": {
                    "rule": rule["index"] + 1 if rule else None,
                    **_without_absent({
                        "input_entries": rule.get("input_entries") if rule else None,
                        "inputs": event["data"].get("inputs"),
                        "route": target.name if target else None,
                    }),
                },
                "event_seqs": [event["seq"]],
            })

    # Lessons: why a run failed, and whether its effects were undone
    failed = next((e for e in ordered if e["type"] == "run.failed"), None)
    if failed:
        token = next((e for e in ordered if e["type"] == "token.failed"), None)
        error = (token["data"].get("error") or {}) if token else {}
        compensation = failed["data"].get("compensation") or {"attempted": 0, "succeeded": 0}
        at = (token.get("node_name") if token else None) or "unknown step"
        cause = error.get("code") or re.sub(r"\d+", "N", _one_line(error.get("message")))
        candidates.append({
            "id": f"{DIRECTORY['lesson']}/{wf_slug}-failed-at-{_slug(at)}-{_slug(cause)}"[:140],
            "type": "lesson",
            "title": f"{workflow.name} fails at {at}" + (f" ({error['code']})" if error.get("code") else ""),
            "description": f'The run failed at "{at}": {_one_line(error.get("message"))[:140]}',
            "tags": ["run-failure", wf_slug],
            "scope": {**wf, **_without_absent({
                "node_id": token.get("node_id") if token else None, "node_name": token.get("node_name") if token else None})},
            "counts": {
                "occurrences": 1,
                "compensations_attempted": compensation.get("attempted", 0),
                "compensations_succeeded": compensation.get("succeeded", 0),
            },
            "latest": _without_absent({"code": error.get("code"), "message": error.get("message")}),
            "event_seqs": [*([token["seq"]] if token else []), failed["seq"]],
        })

    return candidates


def guidance(entry: KnowledgeEntry) -> str:
    """A short instruction for an actor, derived from an entry"""
    latest = entry.get("latest") or {}
    if entry["type"] == "strategy":
        plan = "; ".join(_one_line(step) for step in latest["plan"]) if isinstance(latest.get("plan"), list) else ""
        why = f". Why: {_one_line(latest['rationale'])}" if latest.get("rationale") else ""
        return f"An approach accepted before: {plan}{why}"
    if entry["type"] == "failure_pattern":
        terms = latest.get("terms")
        hold = f" Make sure these hold: {', '.join(_one_line(t) for t in terms)}." if isinstance(terms, list) and terms else ""
        times = (entry.get("counts") or {}).get("occurrences") or 1
        return f"Earlier outcomes were rejected here ({times}×): {_one_line(latest.get('message'))}.{hold}"
    return f"{entry['title']}. {entry['description']}"


# ----------------------------------------------------------------------
# The knowledge base (15.3, 15.4)
# ----------------------------------------------------------------------

class KnowledgeBase:
    """Knowledge entries, the runs they were distilled from, and a log of what happened to them"""

    def __init__(self) -> None:
        self._entries: dict[str, KnowledgeEntry] = {}
        self._ingested: set[str] = set()
        self._ingested_order: list[str] = []
        self._log: list[dict[str, str]] = []

    def _note(self, date: str, action: str, id: str, text: str) -> None:
        self._log.append({"date": date[:10], "action": action, "id": id, "text": text})

    def ingest(self, workflow: Workflow, events: list[JournalEvent]) -> dict[str, Any]:
        """
        Add the evidence of one run (15.3). Entries that already exist gain an
        observation and a source and keep their status; new ones are created as
        drafts. A run that was already ingested changes nothing, so ingesting is
        safe to repeat. Returns `run_id`, the ids `created` and `updated`, and
        whether the run was `skipped`.
        """
        run_id = events[0].get("run_id") if events else None
        if not run_id or run_id in self._ingested:
            return {"run_id": run_id, "created": [], "updated": [], "skipped": True}
        self._ingested.add(run_id)
        self._ingested_order.append(run_id)

        observed_at = max(events, key=lambda e: e["seq"])["time"]
        created: list[str] = []
        updated: list[str] = []
        seen: set[str] = set()

        for candidate in distill(workflow, events):
            candidate = copy.deepcopy(candidate)
            event_seqs = candidate.pop("event_seqs")
            existing = self._entries.get(candidate["id"])
            if existing is None:
                self._entries[candidate["id"]] = {
                    **candidate, "status": "draft", "observations": 1,
                    "sources": [{"run_id": run_id, "event_seqs": event_seqs, "observed_at": observed_at}],
                    "created_at": observed_at, "updated_at": observed_at,
                }
                created.append(candidate["id"])
                seen.add(candidate["id"])
                self._note(observed_at, "Creation", candidate["id"], f"Distilled from run {run_id}.")
                continue
            for key, value in candidate["counts"].items():
                existing["counts"][key] = existing["counts"].get(key, 0) + value
            existing["latest"] = candidate["latest"]
            existing["title"] = candidate["title"]
            existing["description"] = candidate["description"]
            existing["updated_at"] = observed_at
            source = next((s for s in existing["sources"] if s["run_id"] == run_id), None)
            if source:
                source["event_seqs"] = sorted({*source["event_seqs"], *event_seqs})
            else:
                existing["sources"] = [
                    *existing["sources"], {"run_id": run_id, "event_seqs": event_seqs, "observed_at": observed_at},
                ][-MAX_SOURCES:]
            # A run counts once for an entry, however often it exhibits the pattern
            if candidate["id"] not in seen:
                existing["observations"] += 1
                seen.add(candidate["id"])
                updated.append(candidate["id"])
                self._note(observed_at, "Update", candidate["id"],
                           f"Evidence added from run {run_id} ({existing['observations']} runs).")
        return {"run_id": run_id, "created": created, "updated": updated, "skipped": False}

    def has_ingested(self, run_id: str) -> bool:
        return run_id in self._ingested

    def get(self, id: str) -> KnowledgeEntry | None:
        return self._entries.get(id)

    def list(self, type: str | None = None, status: str | None = None) -> list[KnowledgeEntry]:
        """The entries, in the order of their ids, optionally of one type or one status"""
        return sorted(
            (e for e in self._entries.values()
             if (not type or e["type"] == type) and (not status or e["status"] == status)),
            key=lambda e: e["id"])

    def _require(self, id: str) -> KnowledgeEntry:
        entry = self._entries.get(id)
        if entry is None:
            raise KeyError(f'Knowledge entry "{id}" not found')
        return entry

    def review(self, id: str, reviewer: str, at: str | None = None) -> KnowledgeEntry:
        """Record that a person has reviewed an entry, who and when (15.4). Only reviewed entries reach actors by default."""
        if not reviewer or not isinstance(reviewer, str):
            raise ValueError("A review names the person who made it")
        entry = self._require(id)
        at = at or _now()
        entry["status"] = "reviewed"
        entry["reviewed_by"] = reviewer
        entry["reviewed_at"] = at
        self._note(at, "Review", id, f"Reviewed by {reviewer}.")
        return entry

    def deprecate(self, id: str, superseded_by: str | None = None, at: str | None = None) -> KnowledgeEntry:
        """Make an entry `deprecated`, optionally naming the entry that replaces it. It is never given to an actor again."""
        entry = self._require(id)
        if superseded_by:
            self._require(superseded_by)
        entry["status"] = "deprecated"
        if superseded_by:
            entry["superseded_by"] = superseded_by
        else:
            entry.pop("superseded_by", None)
        self._note(at or _now(), "Deprecation", id, f"Superseded by {superseded_by}." if superseded_by else "Deprecated.")
        return entry

    def retrieve(self, workflow: Workflow, activity: Activity, binding: Any = None) -> list[KnowledgeEntry]:
        """
        The entries an activity is given (15.4): about that activity, of the types
        and with the tags the binding asks for, never deprecated, reviewed unless
        the binding sets `min_status: draft`; reviewed entries first, then by
        observations; at most `max_entries`. `binding` is the activity's
        `knowledge` binding, or a dict of its fields.
        """
        if binding is None:
            binding = {}
        elif not isinstance(binding, dict):
            binding = binding.model_dump()
        types = binding.get("types") or ["strategy", "failure_pattern"]
        allow_draft = binding.get("min_status") == "draft"
        tags = binding.get("tags") or []
        limit = binding.get("max_entries")
        workflow_id, node_id = str(workflow.id), str(activity.id)
        matching = [
            e for e in self._entries.values()
            if e["scope"].get("workflow_id") == workflow_id and e["scope"].get("node_id") == node_id
            and e["type"] in types
            and (e["status"] == "reviewed" or (allow_draft and e["status"] == "draft"))
            and (not tags or any(tag in e["tags"] for tag in tags))
        ]
        matching.sort(key=lambda e: (e["status"] != "reviewed", -e["observations"], e["id"]))
        return matching[:5 if limit is None else limit]

    # -- persistence ------------------------------------------------------

    def to_json(self) -> dict[str, Any]:
        return copy.deepcopy({
            "awa_knowledge": "1.1", "entries": self.list(),
            "ingested_runs": list(self._ingested_order), "log": self._log,
        })

    @classmethod
    def from_json(cls, data: dict[str, Any]) -> "KnowledgeBase":
        base = cls()
        for entry in copy.deepcopy(data.get("entries") or []):
            base._entries[entry["id"]] = entry
        base._ingested_order = list(dict.fromkeys(data.get("ingested_runs") or []))
        base._ingested = set(base._ingested_order)
        base._log = copy.deepcopy(data.get("log") or [])
        return base

    def save(self, file: str) -> None:
        """Write the knowledge base to a JSON file, replacing it atomically"""
        os.makedirs(os.path.dirname(os.path.abspath(file)), exist_ok=True)
        with open(file + ".tmp", "w", encoding="utf-8") as handle:
            json.dump(self.to_json(), handle, indent=2, ensure_ascii=False)
            handle.write("\n")
        os.replace(file + ".tmp", file)

    @classmethod
    def load(cls, file: str) -> "KnowledgeBase":
        """Read a knowledge base from a JSON file. A file that does not exist is an empty knowledge base."""
        try:
            with open(file, encoding="utf-8") as handle:
                return cls.from_json(json.load(handle))
        except FileNotFoundError:
            return cls()
