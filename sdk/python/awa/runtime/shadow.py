"""
Shadow runs (specification section 33.5)

A host may run a candidate workflow or model beside production. Each time a
production run ends, its shadow performs the same run under the candidate: the
same input, the same business events in the same order, and, in place of every
tool, person, application and robot, the results production recorded. Only the
candidate's AI agents, model decisions and judges run. Nothing the shadow does
reaches the outside world: no tool runs, no person is asked, no business event
is published, nothing is learnt from it. Its journal is then compared with
production's (section 20.3), and the measures of section 21 are computed for both.

Follows sdk/typescript/src/runtime/shadow.ts.
"""

from typing import Any, Callable

from awa.runtime.counterfactual import counterfactual_replay
from awa.runtime.kpi import _iso, compute_measures
from awa.types import ActorType, Workflow

Json = dict[str, Any]

# Engine options a shadow may take: none of them lets it act on the world
_SAFE_KEYS = ("gemini_api_key", "default_ai_model_id", "verification_enabled", "verifiers", "model_providers", "default_model_provider",
              "model_tiers", "pricing_config", "decision_engines", "knowledge", "journal_payloads", "retry")
# A cancelled run is not shadowed: what ended it was decided outside the run, and a shadow cannot be told it
_ENDED = ("completed", "failed")


class ShadowRunner:
    """
    The shadow of production, held by a host.

    options:
      candidates:    the candidate workflow for each production workflow id; nodes that are the same keep their ids
      workflow_ids:  the production workflows to shadow. Default: those with a candidate, or every workflow when only
                     `engine` is given
      engine:        engine options for the shadow: model providers and tiers, the default model, verification, knowledge
                     to read, or the ai_agent actor. Everything else is ignored: tools, other actors, event sinks and stores
      ai:            "live" (default), or "recorded" to replay production's AI outputs too and test a changed contract or rule
      on_comparison: called with each comparison as it is made
    """

    def __init__(self, options: Json, now: Callable[[], float] | None = None) -> None:
        self.options = dict(options or {})
        self._now = now
        self._done: dict[str, Json] = {}
        self._journals: dict[str, Json] = {}

    def _time(self) -> str:
        if self._now:
            return _iso(self._now())
        import time
        return _iso(time.time() * 1000)

    def shadows(self, workflow_id: str) -> bool:
        """Whether runs of this workflow have a shadow"""
        if self.options.get("workflow_ids") is not None:
            return workflow_id in self.options["workflow_ids"]
        if self.options.get("candidates") is not None:
            return workflow_id in self.options["candidates"]
        return bool(self.options.get("engine"))

    def settled(self, production: Any) -> Json | None:
        """Called by the host when a production run has made progress. A run that has ended is shadowed once."""
        run_id = production.run_id
        workflow: Workflow = production.workflow
        workflow_id = str(workflow.id)
        status = production.status.value
        if status not in _ENDED or run_id in self._done or not self.shadows(workflow_id):
            return None
        candidate: Workflow = (self.options.get("candidates") or {}).get(workflow_id) or workflow
        recorded = production.get_events()
        base = {"production_run_id": run_id, "workflow_id": workflow_id,
                "candidate": {"id": str(candidate.id), "name": candidate.name, "version": candidate.version},
                "compared_at": self._time(), "production_status": status}
        try:
            given = self.options.get("engine") or {}
            engine = {key: given[key] for key in _SAFE_KEYS if given.get(key) is not None}
            ai_agent = next((actor for key, actor in (given.get("actors") or {}).items() if ActorType(key) == ActorType.ai_agent), None)
            if ai_agent is not None:
                engine["actors"] = {ActorType.ai_agent: ai_agent}
            replay = counterfactual_replay(workflow, recorded, candidate=candidate, ai=self.options.get("ai") or "live", engine={**engine, "learn": False})
            self._journals[run_id] = {"production": recorded, "shadow": replay.events}
            report = replay.report
            parted = not report["same_status"] or not report["same_path"] or any(n["verdict"] != "same" for n in report["nodes"])
            comparison = {**base, "shadow_run_id": replay.events[0]["run_id"] if replay.events else None, "shadow_status": replay.status,
                          "parted": parted, "report": report}
        except Exception as error:  # a shadow that cannot run is recorded as such; it never touches production
            comparison = {**base, "shadow_run_id": None, "shadow_status": "not_run", "parted": True, "report": None, "error": str(error)}
        self._done[run_id] = comparison
        listener = self.options.get("on_comparison")
        if listener:
            try:
                listener(comparison)
            except Exception:  # a listener must not break the host
                pass
        return comparison

    def comparisons(self) -> list[Json]:
        return list(self._done.values())

    def shadow_journal(self, production_run_id: str) -> list[Json] | None:
        """The journal of the shadow of a production run"""
        pair = self._journals.get(production_run_id)
        return pair["shadow"] if pair else None

    def report(self) -> Json:
        """The measures of section 21 for production and for its shadow, and the runs where they part"""
        comparisons = self.comparisons()
        workflows = []
        for workflow_id in dict.fromkeys(c["workflow_id"] for c in comparisons):
            mine = [c for c in comparisons if c["workflow_id"] == workflow_id]
            pairs = [self._journals[c["production_run_id"]] for c in mine if c["production_run_id"] in self._journals]

            def measures(journals: list[list[Json]], workflow_id: str = workflow_id) -> Json:
                runs = [{"run_id": j[0]["run_id"], "workflow_id": workflow_id, "events": j} for j in journals if j]
                found = compute_measures({"runs": runs})["workflows"]
                return found[0]["measures"] if found else {}
            first = next((e for p in pairs[:1] for e in p["production"] if e["type"] == "run.started"), None)
            workflows.append({
                "workflow_id": workflow_id, "name": (first or {}).get("data", {}).get("workflow_name") or workflow_id,
                "candidate": f"{mine[0]['candidate']['name']} {mine[0]['candidate']['version']}",
                "runs": len(mine), "parted": sum(1 for c in mine if c["parted"]),
                "production": measures([p["production"] for p in pairs]), "shadow": measures([p["shadow"] for p in pairs]),
            })
        runs = []
        for c in comparisons:
            report = c["report"] or {}
            row = {"production_run_id": c["production_run_id"], "shadow_run_id": c["shadow_run_id"], "workflow_id": c["workflow_id"],
                   "production_status": c["production_status"], "shadow_status": c["shadow_status"], "parted": c["parted"],
                   "regressions": report.get("regressions") or [], "improvements": report.get("improvements") or [], "unrecorded": report.get("unrecorded") or []}
            if report.get("divergence"):
                row["divergence"] = report["divergence"]
            if c.get("error"):
                row["error"] = c["error"]
            runs.append(row)
        return {"spec_version": "1.1", "as_of": self._time(), "workflows": workflows, "runs": runs,
                "parted": [c["production_run_id"] for c in comparisons if c["parted"]]}
