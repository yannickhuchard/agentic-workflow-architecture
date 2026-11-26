"""
Journeys and measures over HTTP (specification sections 19 and 21).

With AWA_RUNTIME_STORE set to a PostgreSQL URL, definitions, journeys and
journals are kept in that shared store, which several servers may use at once
(29). Otherwise, with AWA_DATA_DIR set, they are kept in that directory and
survive a restart; without either they live in this process.
AWA_SIMULATE=1 runs activities without calling models, tools or people, and
AWA_SIMULATED_OUTPUTS names a JSON file saying what each activity returns.
"""

import json
import os
import threading
from typing import Any

from fastapi import APIRouter, Body, HTTPException, Query, Request
from fastapi.responses import JSONResponse, PlainTextResponse

from awa.runtime.business_event import business_event
from awa.runtime.journey import time_ms
from awa.runtime.kpi import MEASURES, compute_measures, measures_to_openmetrics
from awa.runtime.telemetry import gauges_to_otlp_json, measures_to_gauges
from awa.runtime.telemetry_export import shared_telemetry_from_env
from awa.runtime.runtime_host import AwaRuntime, add_definition, is_journey_document, open_runtime_directory, simulated_actors
from awa.runtime.authorization import AuthorizationError
from awa.server.authorization import authorize_request, forbidden, request_principal, server_authorization
from awa.server.deployment import server_deployment_options

journey_router = APIRouter()
measures_router = APIRouter()

_runtime: AwaRuntime | None = None
# One operation of the host at a time: the host is not made for concurrent callers
_guard = threading.RLock()


def set_journey_runtime(instance: AwaRuntime | None) -> None:
    """The runtime behind the routes. A host may supply its own, for example with real actors configured."""
    global _runtime
    with _guard:
        _runtime = instance


def _directory() -> str | None:
    return os.path.abspath(os.environ["AWA_DATA_DIR"]) if os.environ.get("AWA_DATA_DIR") else None


def _host() -> AwaRuntime:
    global _runtime
    if _runtime is None:
        engine: dict[str, Any] = {}
        if os.environ.get("AWA_SIMULATE") == "1":
            outputs = {}
            if os.environ.get("AWA_SIMULATED_OUTPUTS"):
                with open(os.environ["AWA_SIMULATED_OUTPUTS"], encoding="utf-8") as handle:
                    outputs = json.load(handle)
            engine = {"simulate": True, "actors": simulated_actors(outputs)}
        # What the deployment lets runs reach, and its guardrails (specification 17.4, 28.2, 31.1)
        engine.update(server_deployment_options())
        # Who may do what in the runs the host starts (specification 30)
        if server_authorization() is not None:
            engine["authorization"] = server_authorization()
        directory, store = _directory(), os.environ.get("AWA_RUNTIME_STORE")
        telemetry = shared_telemetry_from_env()
        if store:
            from awa.runtime.postgres_store import open_runtime_store
            _runtime = open_runtime_store(store, engine=engine, telemetry=telemetry)
        else:
            _runtime = (open_runtime_directory(directory, engine=engine, telemetry=telemetry) if directory
                        else AwaRuntime(engine=engine, telemetry=telemetry))
    return _runtime


def _reading() -> AwaRuntime:
    """The host, having read what its store keeps: on a shared store, other hosts may have changed it since"""
    host = _host()
    host.refresh()
    return host


def _instant(text: str | None) -> float | None:
    if not text:
        return None
    try:
        return time_ms(text)
    except ValueError:
        raise HTTPException(status_code=400, detail=f"Not an instant: {text}") from None


def _summary(i: dict[str, Any]) -> dict[str, Any]:
    keys = ("id", "journey_id", "subject_key", "status", "stalled", "stage_id", "goals_reached", "sentiment", "started_at", "ended_at", "runs")
    return {key: i[key] for key in keys if key in i}


@journey_router.post("/definitions", status_code=201)
def register_definition(document: dict[str, Any] = Body(...)) -> dict[str, Any]:
    """Register a workflow or a journey. Workflows a journey names must be registered first."""
    with _guard:
        try:
            host = _host()
            journey = is_journey_document(document)
            if journey:
                host.register_journey(document)
            else:
                host.register_workflow(document)
            if host.shared_store is not None:
                host.shared_store.add_definition(document)
            elif _directory():
                add_definition(_directory() or "", document)
        except HTTPException:
            raise
        except Exception as error:
            raise HTTPException(status_code=400, detail=str(error)) from error
        inner = document.get("workflow", document) if not journey and "activities" not in document else document
        return {"kind": "journey" if journey else "workflow", "id": inner.get("id"), "name": inner.get("name")}


@journey_router.get("")
@journey_router.get("/", include_in_schema=False)
def list_journeys() -> list[dict[str, Any]]:
    with _guard:
        host = _reading()
        return [{
            "id": j.id, "name": j.name, "version": j.version, "description": j.description,
            "stages": [{"id": s.id, "name": s.name} for s in j.stages], "analytics": host.analytics(j.id),
        } for j in host.list_journeys()]


@journey_router.post("/events", status_code=202)
def take_in_event(request: Request, body: dict[str, Any] = Body(...)) -> Any:
    """Take in a business event (CloudEvents 1.0). The same id twice has no further effect."""
    if not body.get("type") or not isinstance(body["type"], str):
        raise HTTPException(status_code=400, detail="type is required")
    data = body.get("data") if isinstance(body.get("data"), dict) else {}
    refused = authorize_request("publish_event", request_principal(request), {"event_type": body["type"]}, data)
    if refused is not None:
        return refused
    event = business_event(body["type"], data, id=body.get("id") or None, source=body.get("source") or "/api",
                           subject=body.get("subject") or None, time=body.get("time") or None)
    with _guard:
        return {"event_id": event["id"], **_host().publish(event)}


@journey_router.post("/tick")
def tick(body: dict[str, Any] | None = Body(default=None)) -> dict[str, Any]:
    """Let time pass: deadlines take effect, journeys that outstayed a stage are marked stalled"""
    at = _instant((body or {}).get("at"))
    with _guard:
        return _host().tick(at)


@journey_router.post("/runs/{run_id}/tokens/{token_id}/resume")
def resume(run_id: str, token_id: str, request: Request, body: dict[str, Any] | None = Body(default=None)) -> JSONResponse:
    """A person completes a task: who they are is the request's principal, held to the policy where the run is hosted (30.4)"""
    principal = request_principal(request)
    try:
        with _guard:
            resumed = _host().resume(run_id, token_id, body or {}, principal if server_authorization() is not None else None)
    except AuthorizationError as error:
        return forbidden(error, principal)
    return JSONResponse({"resumed": resumed}, status_code=200 if resumed else 404)


# -- changing a workflow while runs are in flight (specification section 25) --

@journey_router.get("/workflows/{workflow_id}/versions")
def workflow_versions(workflow_id: str) -> dict[str, Any]:
    """The registered versions of a workflow, oldest first, with the live runs on each"""
    with _guard:
        host = _reading()
        versions = host.workflow_versions(workflow_id)
        if not versions:
            raise HTTPException(status_code=404, detail=f"Workflow {workflow_id} is not registered")
        live = [e for e in host.list_runs() if str(e.workflow.id) == workflow_id and e.status.value not in ("completed", "failed", "cancelled")]
        return {"workflow_id": workflow_id, "newest": versions[-1],
                "versions": [{"version": v, "live_runs": [e.run_id for e in live if e.workflow.version == v]} for v in versions]}


@journey_router.post("/migrations/check")
def check_migration(body: dict[str, Any] | None = Body(default=None)) -> dict[str, Any]:
    """How each position of the versions with live runs fares under a move, and which runs can move"""
    body = body or {}
    if not body.get("workflow_id"):
        raise HTTPException(status_code=400, detail="workflow_id is required")
    with _guard:
        try:
            return _host().check_migration(body["workflow_id"], from_version=body.get("from_version"),
                                           to_version=body.get("to_version"), plan=body.get("plan"))
        except KeyError as error:
            raise HTTPException(status_code=400, detail=str(error.args[0] if error.args else error)) from error


@journey_router.post("/runs/{run_id}/migrate")
def migrate_run(run_id: str, request: Request, body: dict[str, Any] | None = Body(default=None), dry_run: str | None = None) -> JSONResponse:
    """Move a run at rest to another version: the body is the plan, and ?dry_run=true says what would happen without doing it"""
    principal = request_principal(request)
    with _guard:
        # Who moves a run must be allowed to, under a policy (30.4); a dry run is part of moving it
        host = _host()
        if host.get_run(run_id) is None:
            host.refresh()
        engine = host.get_run(run_id)
        resource = {**({"workflow_id": str(engine.workflow.id), "workflow_name": engine.workflow.name} if engine is not None else {}),
                    "run_id": run_id}
        refused = authorize_request("migrate_run", principal, resource)
        if refused is not None:
            return refused
        result = host.migrate(run_id, body or {}, dry_run=dry_run in ("true", "1"),
                              principal=principal if server_authorization() is not None else None)
    codes = [r["code"] for r in result["refusals"]]
    return JSONResponse(result, status_code=404 if "not_found" in codes else 409 if codes else 200)


@journey_router.get("/instances")
def list_instances(journey_id: str | None = None, subject: str | None = None, stalled: str | None = None) -> list[dict[str, Any]]:
    with _guard:
        return [_summary(i) for i in _reading().list_journey_instances(journey_id)
                if (not subject or i["subject_key"] == subject)
                and (stalled is None or (i["stalled"] and i["status"] == "active") == (stalled != "false"))]


@journey_router.get("/instances/{instance_id}")
def get_instance(instance_id: str) -> dict[str, Any]:
    """One journey with its whole record and the journal of each of its runs"""
    with _guard:
        try:
            return _host().export_journey(instance_id)
        except KeyError as error:
            raise HTTPException(status_code=404, detail=str(error.args[0])) from error


@journey_router.get("/transitions")
def transitions() -> list[dict[str, Any]]:
    with _guard:
        return _reading().transitions()


@journey_router.get("/portfolio")
def portfolio() -> dict[str, Any]:
    """Everything, in the form tools/visualization/journey.html loads"""
    with _guard:
        return _host().export_portfolio()


@measures_router.get("")
@measures_router.get("/", include_in_schema=False)
def measures(from_: str | None = Query(default=None, alias="from"), to: str | None = None, journey_id: str | None = None,
             workflow_id: str | None = None, format: str | None = None) -> Any:
    """The measures of what was recorded: the report as data, or in the OpenMetrics text format for a metrics system to scrape"""
    for instant in (from_, to):
        _instant(instant)
    with _guard:
        record = _host().export_portfolio()
    report = compute_measures(record, {"from": from_ or None, "to": to or None, "journey_id": journey_id or None,
                                       "workflow_id": workflow_id or None})
    if format == "openmetrics":
        return PlainTextResponse(measures_to_openmetrics(report), media_type="application/openmetrics-text; version=1.0.0; charset=utf-8")
    if format == "otlp":
        return gauges_to_otlp_json(measures_to_gauges(report, MEASURES), report)
    return report


@measures_router.get("/definitions")
def measure_definitions() -> list[dict[str, Any]]:
    return MEASURES
