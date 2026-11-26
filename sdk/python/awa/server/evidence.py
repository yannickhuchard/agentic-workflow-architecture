"""
Evidence over HTTP (specification section 32): the report computed from what the
host behind /api/v1/journeys recorded, as JSON, Markdown or HTML.

  GET /api/v1/evidence?from=&to=&workflow_id=&workflow_id=&format=json|md|html
"""

from typing import Any

from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import HTMLResponse, PlainTextResponse

from awa.runtime.evidence import compute_evidence, render_evidence_html, render_evidence_markdown
from awa.server.journeys import _guard, _host, _instant

evidence_router = APIRouter()


@evidence_router.get("")
@evidence_router.get("/", include_in_schema=False)
def evidence(from_: str | None = Query(default=None, alias="from"), to: str | None = None,
             workflow_id: list[str] | None = Query(default=None), format: str = "json") -> Any:
    for instant in (from_, to):
        _instant(instant)
    if format not in ("json", "md", "html"):
        raise HTTPException(status_code=400, detail="format must be json, md or html")
    with _guard:
        host = _host()
        record = host.export_portfolio()
        # Runs that belong to no journey are part of the record too
        in_journeys = {r["run_id"] for j in record["journeys"] for i in j["instances"] for r in i["runs"]}
        record["runs"] = []
        for e in host.list_runs():
            if e.run_id in in_journeys:
                continue
            record["runs"].append({"run_id": e.run_id, "workflow_id": str(e.workflow.id), "events": e.get_events()})
            # Its child runs (24.7), each with its own journal
            record["runs"] += [{"run_id": c["run_id"], "workflow_id": str(c["workflow_id"]), "events": e.get_subworkflow_events(c["run_id"])}
                               for c in e.subworkflow_runs() if c["run_id"] not in in_journeys]
    report = compute_evidence(record, {"from": from_ or None, "to": to or None, "workflow_ids": [w for w in workflow_id or [] if w] or None})
    if format == "md":
        return PlainTextResponse(render_evidence_markdown(report), media_type="text/markdown; charset=utf-8")
    if format == "html":
        return HTMLResponse(render_evidence_html(report))
    return report
