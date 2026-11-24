"""
awa import and awa export: interchange with BPMN 2.0, DMN 1.x and CNCF Serverless Workflow
1.0 (specification section 27). The same commands and defaults as the TypeScript CLI.
"""

from __future__ import annotations

import json
import re
import sys
from pathlib import Path
from typing import Any

from awa.interchange.bpmn_export import export_bpmn
from awa.interchange.bpmn_import import import_bpmn
from awa.interchange.common import InterchangeError, InterchangeWarning
from awa.interchange.dmn import import_dmn, write_dmn
from awa.interchange.serverless_workflow import export_serverless_workflow


def _base(file: str, extensions: tuple[str, ...]) -> Path:
    path = Path(file)
    name = path.name
    ext = next((e for e in extensions if name.lower().endswith(e)), None)
    return path.parent / (name[: -len(ext)] if ext else name)


def _slug(text: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", text.lower()).strip("-") or "workflow"


def _read_json(file: str) -> dict[str, Any]:
    value = json.loads(Path(file).read_text(encoding="utf-8"))
    if not isinstance(value, dict):
        raise InterchangeError(f"{file} does not hold a JSON object")
    return value


def _write(path: Path, text: str, written: list[str]) -> None:
    path.write_text(text, encoding="utf-8")
    written.append(str(path))


def _workflow(document: dict[str, Any]) -> dict[str, Any]:
    return document["workflow"] if isinstance(document.get("workflow"), dict) and "activities" not in document else document


def import_bpmn_file(file: str, dmn: list[str] | None = None, output: str | None = None) -> dict[str, Any]:
    """awa import bpmn: the first process to the output file, other processes and subprocesses beside it"""
    base = _base(file, (".bpmn20.xml", ".bpmn", ".xml"))
    dmn_files = list(dmn or [])
    found = not dmn_files and Path(f"{base}.dmn").exists()
    if found:
        dmn_files = [f"{base}.dmn"]
    result = import_bpmn(Path(file).read_text(encoding="utf-8"), [Path(f).read_text(encoding="utf-8") for f in dmn_files])
    out = Path(output) if output else Path(f"{base}.awa.json")
    out_base = _base(str(out), (".awa.json", ".json"))
    written: list[str] = []
    names: set[str] = set()
    for i, document in enumerate(result.documents):
        text = json.dumps(document, indent=2, ensure_ascii=False) + "\n"
        if i == 0:
            _write(out, text, written)
            continue
        name = _slug(str(_workflow(document).get("name", "workflow")))
        candidate, n = name, 2
        while candidate in names:
            candidate, n = f"{name}-{n}", n + 1
        names.add(candidate)
        _write(Path(f"{out_base}.{candidate}.awa.json"), text, written)
    warnings = ([InterchangeWarning(message=f"Decision tables read from {dmn_files[0]}")] if found else []) + result.warnings
    return {"written": written, "warnings": warnings}


def import_dmn_file(file: str, output: str | None = None) -> dict[str, Any]:
    """awa import dmn: the decision tables as a list of AWA decision nodes"""
    decisions, warnings = import_dmn(Path(file).read_text(encoding="utf-8"))
    out = Path(output) if output else Path(f"{_base(file, ('.dmn', '.xml'))}.decisions.json")
    written: list[str] = []
    _write(out, json.dumps(decisions, indent=2, ensure_ascii=False) + "\n", written)
    return {"written": written, "warnings": warnings}


def export_bpmn_files(files: list[str], output: str | None = None, diagram: bool = True) -> dict[str, Any]:
    """awa export bpmn: one BPMN document for the workflows, and a DMN document for their decision tables"""
    result = export_bpmn([_read_json(f) for f in files], diagram=diagram)
    out = Path(output) if output else Path(f"{_base(files[0], ('.awa.json', '.json'))}.bpmn")
    written: list[str] = []
    _write(out, result.bpmn, written)
    if result.dmn:
        _write(Path(f"{_base(str(out), ('.bpmn', '.xml'))}.dmn"), result.dmn, written)
    return {"written": written, "warnings": result.warnings}


def export_dmn_files(files: list[str], output: str | None = None) -> dict[str, Any]:
    """awa export dmn: the decision tables of the workflows"""
    workflows = [_workflow(_read_json(f)) for f in files]
    nodes = [n for w in workflows for n in (w.get("decision_nodes") or []) if isinstance(n.get("decision_table"), dict)]
    if not nodes:
        raise InterchangeError("None of the workflows has a decision table")
    xml = write_dmn(nodes, {"id": str(workflows[0]["id"]), "name": str(workflows[0]["name"])})
    out = Path(output) if output else Path(f"{_base(files[0], ('.awa.json', '.json'))}.dmn")
    written: list[str] = []
    _write(out, xml, written)
    return {"written": written, "warnings": []}


def export_serverless_workflow_file(file: str, output: str | None = None, fmt: str | None = None) -> dict[str, Any]:
    """awa export serverless-workflow: YAML when PyYAML is installed and not told otherwise, else JSON"""
    result = export_serverless_workflow(_read_json(file))
    fmt = fmt or ("json" if output and output.lower().endswith(".json") else "yaml")
    if fmt not in ("json", "yaml"):
        raise InterchangeError(f"--format is json or yaml, not {fmt}")
    if fmt == "yaml":
        try:
            import yaml  # type: ignore[import-untyped]
        except ImportError:
            raise InterchangeError("Writing YAML needs PyYAML (pip install pyyaml); use --format json") from None
        text = yaml.safe_dump(result.document, sort_keys=False, allow_unicode=True)
    else:
        text = json.dumps(result.document, indent=2, ensure_ascii=False) + "\n"
    out = Path(output) if output else Path(f"{_base(file, ('.awa.json', '.json'))}.sw.{fmt}")
    written: list[str] = []
    _write(out, text, written)
    return {"written": written, "warnings": [], "not_mapped": result.not_mapped}


def _report(outcome: dict[str, Any]) -> None:
    for file in outcome["written"]:
        print(f"✓ wrote {file}")
    for w in outcome["warnings"]:
        print(f"  note: {w.message}")
    not_mapped = outcome.get("not_mapped") or []
    if not_mapped:
        print(f"  not mapped ({len(not_mapped)}):")
        for n in not_mapped:
            where = " / ".join(x for x in (n.get("node"), n.get("property")) if x) or "workflow"
            print(f"    - {where}: {n['reason']}")


def _run(task) -> int:
    try:
        _report(task())
        return 0
    except (InterchangeError, OSError, ValueError) as error:
        print(f"✗ {error}", file=sys.stderr)
        return 1


def add_parser(subparsers: Any) -> None:
    importer = subparsers.add_parser("import", help="Read a BPMN 2.0 process or DMN decision tables into AWA (specification section 27)")
    kinds = importer.add_subparsers(dest="format", required=True)
    bpmn = kinds.add_parser("bpmn", help="Turn a BPMN 2.0 document into AWA workflows: the first process to the output, others beside it")
    bpmn.add_argument("file", help="BPMN 2.0 document")
    bpmn.add_argument("--dmn", nargs="+", help="DMN documents holding the decision tables business rule tasks name (default: <file>.dmn when it exists)")
    bpmn.add_argument("-o", "--output", help="Workflow document to write (default: <file>.awa.json)")
    bpmn.set_defaults(handler=lambda a: _run(lambda: import_bpmn_file(a.file, a.dmn, a.output)))
    dmn = kinds.add_parser("dmn", help="Turn the decision tables of a DMN 1.x document into AWA decision nodes")
    dmn.add_argument("file", help="DMN document")
    dmn.add_argument("-o", "--output", help="File to write (default: <file>.decisions.json)")
    dmn.set_defaults(handler=lambda a: _run(lambda: import_dmn_file(a.file, a.output)))

    exporter = subparsers.add_parser("export", help="Write AWA workflows as BPMN 2.0, DMN or CNCF Serverless Workflow (specification section 27)")
    kinds = exporter.add_subparsers(dest="format", required=True)
    bpmn = kinds.add_parser("bpmn", help="Write workflows as one BPMN 2.0 document, and their decision tables as DMN beside it")
    bpmn.add_argument("files", nargs="+", help="Workflow documents")
    bpmn.add_argument("-o", "--output", help="BPMN document to write (default: <first file>.bpmn)")
    bpmn.add_argument("--no-diagram", action="store_true", help="Leave out the diagram (BPMNDI)")
    bpmn.set_defaults(handler=lambda a: _run(lambda: export_bpmn_files(a.files, a.output, not a.no_diagram)))
    dmn = kinds.add_parser("dmn", help="Write the decision tables of workflows as a DMN 1.3 document")
    dmn.add_argument("files", nargs="+", help="Workflow documents")
    dmn.add_argument("-o", "--output", help="DMN document to write (default: <first file>.dmn)")
    dmn.set_defaults(handler=lambda a: _run(lambda: export_dmn_files(a.files, a.output)))
    sw = kinds.add_parser("serverless-workflow", help="Write a workflow as a CNCF Serverless Workflow 1.0 document, and list what does not map")
    sw.add_argument("file", help="Workflow document")
    sw.add_argument("-o", "--output", help="Document to write (default: <file>.sw.yaml)")
    sw.add_argument("--format", help="yaml or json (default: from the output file, else yaml)")
    sw.set_defaults(handler=lambda a: _run(lambda: export_serverless_workflow_file(a.file, a.output, a.format)))
