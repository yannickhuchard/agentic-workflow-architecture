"""
AWA to BPMN 2.0 (specification 27.2 to 27.7).

Python port of sdk/typescript/src/interchange/bpmn_export.ts: write each workflow as a
process with BPMN's own elements where BPMN can say the same thing, read that back natively,
and keep in the awa: namespace exactly what the elements did not give back.
"""

from __future__ import annotations

import xml.etree.ElementTree as ET
from dataclasses import dataclass, field
from typing import Any

from awa.interchange.bpmn_import import check_imported, import_bpmn
from awa.interchange.bpmn_layout import lay_out
from awa.interchange.common import (
    AWA_DECISION_ROUTE_LANGUAGE, AWA_EXPRESSION_LANGUAGE, AWA_INTERCHANGE_NAMESPACE, BPMN_MODEL_NAMESPACE, BPMNDI_NAMESPACE,
    DC_NAMESPACE, DI_NAMESPACE, DMN13_NAMESPACE, FEEL_LANGUAGE, XSI_NAMESPACE, InterchangeError, InterchangeWarning, clone,
    json_equal, residual, residual_extensions, to_json, xml_id,
)
from awa.interchange.dmn import add_extensions, write_dmn
from awa.interchange.expressions import awa_condition_to_feel

ET.register_namespace("bpmn", BPMN_MODEL_NAMESPACE)
ET.register_namespace("bpmndi", BPMNDI_NAMESPACE)
ET.register_namespace("dc", DC_NAMESPACE)
ET.register_namespace("di", DI_NAMESPACE)
ET.register_namespace("xsi", XSI_NAMESPACE)
ET.register_namespace("awa", AWA_INTERCHANGE_NAMESPACE)

DEFAULT_ACTOR = {"userTask": "human", "serviceTask": "application", "callActivity": "application"}
COLLECTIONS = ("roles", "activities", "events", "decision_nodes", "edges")
AWA_ACTOR = f"{{{AWA_INTERCHANGE_NAMESPACE}}}actorType"
AWA_DECISION_REF = f"{{{AWA_INTERCHANGE_NAMESPACE}}}decisionRef"


def q(name: str) -> str:
    return f"{{{BPMN_MODEL_NAMESPACE}}}{name}"


def unwrap_document(document: dict[str, Any]) -> dict[str, Any]:
    return document["workflow"] if isinstance(document.get("workflow"), dict) and "activities" not in document else document


def check_document(document: dict[str, Any]) -> None:
    """Refuse a document that is not valid: only valid documents have a meaning to carry over"""
    check_imported(document, "is not exported: it")


@dataclass
class ExportBpmnResult:
    bpmn: str
    #: The decision tables, when a workflow has any
    dmn: str | None = None
    warnings: list[InterchangeWarning] = field(default_factory=list)


@dataclass
class _Shape:
    el: ET.Element
    entry: ET.Element
    exit: ET.Element
    timeout_exit: ET.Element | None = None


def _el(tag: str, attrib: dict[str, Any] | None = None) -> ET.Element:
    return ET.Element(q(tag), {k: str(v) for k, v in (attrib or {}).items() if v is not None})


def _documentation(el: ET.Element, text: Any) -> None:
    if isinstance(text, str) and text:
        d = ET.SubElement(el, q("documentation"))
        d.text = text


def _formal(parent: ET.Element, tag: str, body: str, language: str | None = None) -> ET.Element:
    attrib = {f"{{{XSI_NAMESPACE}}}type": "bpmn:tFormalExpression"}
    if language:
        attrib["language"] = language
    e = ET.SubElement(parent, q(tag), attrib)
    e.text = body
    return e


def _decision_route(node: dict[str, Any], edge_id: str) -> str:
    parts = []
    rules = ((node.get("decision_table") or {}).get("rules")) or []
    numbers = [str(i + 1) for i, r in enumerate(rules) if r.get("output_edge_id") == edge_id]
    if numbers:
        parts.append(f"{'rule' if len(numbers) == 1 else 'rules'} {', '.join(numbers)}")
    for source in (node.get("decision_model"), node.get("decision_engine")):
        for option in ((source or {}).get("options")) or []:
            if option.get("output_edge_id") == edge_id:
                parts.append(f"option {option.get('id')}")
    return f"chosen by {', '.join(parts)}" if parts else "not chosen by a rule"


def _build(workflows: list[dict[str, Any]]) -> tuple[ET.Element, dict[str, ET.Element], dict[str, ET.Element]]:
    first = workflows[0]
    root = ET.Element(q("definitions"), {"id": f"Definitions_{first['id']}", "targetNamespace": f"https://awa.io/workflows/{first['id']}",
                                         "exporter": "AWA", "exporterVersion": "1.1"})
    elements: dict[str, ET.Element] = {}
    processes: dict[str, ET.Element] = {}
    shared: dict[str, ET.Element] = {}
    shared_list: list[ET.Element] = []

    def shared_ref(kind: str, name: str) -> str:
        key = f"{kind}:{name}"
        if key not in shared:
            index = sum(1 for e in shared_list if e.tag == q(kind[0].lower() + kind[1:])) + 1
            el = _el(kind[0].lower() + kind[1:], {"id": f"{kind}_{index}", "name": name, **({"errorCode": name} if kind == "Error" else {})})
            shared[key] = el
            shared_list.append(el)
        return shared[key].get("id")

    collaboration = _el("collaboration", {"id": f"Collaboration_{first['id']}"})
    process_list = []
    for w in workflows:
        wid = str(w["id"])
        process = _el("process", {"id": xml_id(wid), "name": w.get("name"), "isExecutable": "true"})
        _documentation(process, w.get("description"))
        processes[wid] = process
        elements[wid] = process
        process_list.append(process)
        ET.SubElement(collaboration, q("participant"), {"id": f"Participant_{wid}", "name": str(w.get("name")), "processRef": xml_id(wid)})

        roles = w.get("roles") or []
        lanes: dict[str, ET.Element] = {}
        if roles:
            lane_set = ET.SubElement(process, q("laneSet"), {"id": f"LaneSet_{wid}"})
            for role in roles:
                lane = ET.SubElement(lane_set, q("lane"), {"id": xml_id(str(role["id"])), "name": str(role.get("name"))})
                _documentation(lane, role.get("description"))
                if isinstance(role.get("actor_type"), str):
                    lane.set(AWA_ACTOR, role["actor_type"])
                lanes[str(role["id"])] = lane
                elements[str(role["id"])] = lane

        activities = w.get("activities") or []
        events = w.get("events") or []
        decisions = w.get("decision_nodes") or []
        edges = w.get("edges") or []
        shapes: dict[str, _Shape] = {}
        nodes: list[ET.Element] = []
        synthetic_nodes: list[ET.Element] = []
        synthetic_flows: list[ET.Element] = []
        artifacts: list[ET.Element] = []

        def outgoing(node_id: str) -> list[dict]:
            return [e for e in edges if e.get("source_id") == node_id]

        def incoming(node_id: str) -> list[dict]:
            return [e for e in edges if e.get("target_id") == node_id]

        def flow(flow_id: str, source: ET.Element, target: ET.Element) -> None:
            synthetic_flows.append(_el("sequenceFlow", {"id": flow_id, "sourceRef": source.get("id"), "targetRef": target.get("id")}))

        for a in activities:
            kind = "callActivity" if a.get("is_expandable") is True else "userTask" if a.get("actor_type") == "human" else "serviceTask"
            el = _el(kind, {"id": xml_id(str(a["id"])), "name": a.get("name")})
            if a.get("actor_type") != DEFAULT_ACTOR[kind]:
                el.set(AWA_ACTOR, str(a.get("actor_type")))
            if kind == "callActivity" and isinstance(a.get("expansion_workflow_id"), str):
                el.set("calledElement", xml_id(a["expansion_workflow_id"]))
            _documentation(el, a.get("description"))

            def data(items: Any) -> list[dict] | None:
                return items if isinstance(items, list) and items and all(isinstance(i, dict) and isinstance(i.get("name"), str) for i in items) else None

            inputs, outputs = data(a.get("inputs")), data(a.get("outputs"))
            if inputs or outputs:
                io = ET.SubElement(el, q("ioSpecification"), {"id": f"IO_{a['id']}"})
                ins, outs = [], []
                for i, item in enumerate(inputs or []):
                    di = ET.SubElement(io, q("dataInput"), {"id": f"DataInput_{a['id']}_{i + 1}", "name": item["name"]})
                    _documentation(di, item.get("description"))
                    ins.append(di.get("id"))
                for i, item in enumerate(outputs or []):
                    do = ET.SubElement(io, q("dataOutput"), {"id": f"DataOutput_{a['id']}_{i + 1}", "name": item["name"]})
                    _documentation(do, item.get("description"))
                    outs.append(do.get("id"))
                input_set = ET.SubElement(io, q("inputSet"), {"id": f"InputSet_{a['id']}"})
                for ref in ins:
                    ET.SubElement(input_set, q("dataInputRefs")).text = ref
                output_set = ET.SubElement(io, q("outputSet"), {"id": f"OutputSet_{a['id']}"})
                for ref in outs:
                    ET.SubElement(output_set, q("dataOutputRefs")).text = ref
            if str(a.get("role_id")) in lanes:
                ET.SubElement(lanes[str(a["role_id"])], q("flowNodeRef")).text = el.get("id")
            nodes.append(el)
            elements[str(a["id"])] = el
            shapes[str(a["id"])] = _Shape(el, el, el)
        for a in activities:
            compensation = a.get("compensation") if isinstance(a.get("compensation"), dict) else None
            handler = shapes.get(str(compensation.get("activity_id"))) if compensation else None
            if handler is None:
                continue
            host = shapes[str(a["id"])].el
            boundary = _el("boundaryEvent", {"id": f"Compensation_{a['id']}", "attachedToRef": host.get("id")})
            ET.SubElement(boundary, q("compensateEventDefinition"), {"id": f"CompensateEventDefinition_{a['id']}"})
            handler.el.set("isForCompensation", "true")
            nodes.append(boundary)
            artifacts.append(_el("association", {"id": f"Association_{a['id']}", "associationDirection": "One",
                                                 "sourceRef": boundary.get("id"), "targetRef": handler.el.get("id")}))

        for e in events:
            eid = str(e["id"])
            definition = e.get("event_definition") if isinstance(e.get("event_definition"), dict) else {}
            name = definition.get("name") if isinstance(definition.get("name"), str) else None
            shape = None

            def make(tag: str) -> ET.Element:
                el = _el(tag, {"id": xml_id(eid), "name": e.get("name")})
                _documentation(el, e.get("description"))
                return el

            def message_def(el: ET.Element) -> None:
                ET.SubElement(el, q("messageEventDefinition"), {"id": f"MessageEventDefinition_{eid}", **({"messageRef": shared_ref("Message", name)} if name else {})})

            def signal_def(el: ET.Element) -> None:
                ET.SubElement(el, q("signalEventDefinition"), {"id": f"SignalEventDefinition_{eid}", **({"signalRef": shared_ref("Signal", name)} if name else {})})

            kind = e.get("event_type")
            if kind == "start":
                el = make("startEvent")
                if name:
                    message_def(el)
            elif kind == "end":
                el = make("endEvent")
            elif kind == "timer":
                el = make("intermediateCatchEvent")
                timer = ET.SubElement(el, q("timerEventDefinition"), {"id": f"TimerEventDefinition_{eid}"})
                _formal(timer, "timeDuration", str(definition.get("duration", "")))
            elif kind in ("message", "signal"):
                add = message_def if kind == "message" else signal_def
                if definition.get("mode") == "publish":
                    el = make("intermediateThrowEvent")
                    add(el)
                else:
                    el = make("intermediateCatchEvent")
                    add(el)
                    timeout_edge = next((x for x in outgoing(eid) if x.get("id") == definition.get("timeout_edge_id")), None)
                    if isinstance(definition.get("timeout"), str) and timeout_edge is not None:
                        gateway = _el("eventBasedGateway", {"id": f"Wait_{eid}"})
                        timer = _el("intermediateCatchEvent", {"id": f"Timeout_{eid}", "name": f"{e.get('name')}: no event within {definition['timeout']}"})
                        ted = ET.SubElement(timer, q("timerEventDefinition"), {"id": f"TimerEventDefinition_Timeout_{eid}"})
                        _formal(ted, "timeDuration", definition["timeout"])
                        synthetic_nodes.extend([gateway, timer])
                        flow(f"Wait_{eid}_event", gateway, el)
                        flow(f"Wait_{eid}_timeout", gateway, timer)
                        shape = _Shape(el, gateway, el, timer)
            elif kind == "error":
                el = make("endEvent")
                ET.SubElement(el, q("errorEventDefinition"), {"id": f"ErrorEventDefinition_{eid}", **({"errorRef": shared_ref("Error", name)} if name else {})})
            elif kind == "conditional":
                el = make("intermediateCatchEvent")
                ced = ET.SubElement(el, q("conditionalEventDefinition"), {"id": f"ConditionalEventDefinition_{eid}"})
                if isinstance(definition.get("condition"), str):
                    _formal(ced, "condition", definition["condition"])
            else:
                el = make("intermediateThrowEvent")
            nodes.append(el)
            elements[eid] = el
            shapes[eid] = shape or _Shape(el, el, el)

        for n in decisions:
            nid = str(n["id"])
            el = _el("businessRuleTask", {"id": xml_id(nid), "name": n.get("name")})
            if isinstance(n.get("decision_table"), dict):
                el.set("implementation", DMN13_NAMESPACE)
                el.set(AWA_DECISION_REF, xml_id(nid))
            _documentation(el, n.get("description"))
            nodes.append(el)
            elements[nid] = el
            shapes[nid] = _Shape(el, el, el)

        for node in activities + events:
            nid = str(node["id"])
            if node.get("join") != "all" or len(incoming(nid)) < 2:
                continue
            shape = shapes[nid]
            gateway = _el("parallelGateway", {"id": f"Join_{nid}", "gatewayDirection": "Converging"})
            synthetic_nodes.append(gateway)
            flow(f"Join_{nid}_out", gateway, shape.entry)
            shape.entry = gateway

        route_exit: dict[str, ET.Element] = {}
        route_default: dict[str, dict | None] = {}
        decision_ids = {str(d["id"]) for d in decisions}
        for node in activities + events + decisions:
            nid = str(node["id"])
            shape = shapes[nid]
            definition = node.get("event_definition") if isinstance(node.get("event_definition"), dict) else {}
            timeout_id = definition.get("timeout_edge_id")
            out = [x for x in outgoing(nid) if not (shape.timeout_exit is not None and x.get("id") == timeout_id)]
            is_decision = nid in decision_ids
            needs = len(out) > 1 if is_decision else any(isinstance(x.get("condition"), str) or x.get("is_default") is True for x in out)
            if not needs:
                continue
            gateway = _el("exclusiveGateway", {"id": f"Route_{nid}", "gatewayDirection": "Diverging"})
            synthetic_nodes.append(gateway)
            flow(f"Route_{nid}_in", shape.exit, gateway)
            route_exit[nid] = gateway
            route_default[nid] = next((x for x in out if x.get("id") == node.get("default_output_edge_id")), None) if is_decision \
                else next((x for x in out if x.get("is_default") is True), None)

        flows = []
        events_by_id = {str(x["id"]): x for x in events}
        decisions_by_id = {str(x["id"]): x for x in decisions}
        for e in edges:
            source, target = str(e["source_id"]), str(e["target_id"])
            shape = shapes[source]
            source_definition = (events_by_id.get(source) or {}).get("event_definition")
            timeout_id = source_definition.get("timeout_edge_id") if isinstance(source_definition, dict) else None
            frm = shape.timeout_exit if shape.timeout_exit is not None and e.get("id") == timeout_id else route_exit.get(source, shape.exit)
            f = _el("sequenceFlow", {"id": xml_id(str(e["id"])), "name": e.get("label") if isinstance(e.get("label"), str) else None,
                                     "sourceRef": frm.get("id"), "targetRef": shapes[target].entry.get("id")})
            gateway = route_exit.get(source)
            if gateway is not None and route_default.get(source) is e:
                gateway.set("default", f.get("id"))
            elif gateway is not None and source in decisions_by_id:
                _formal(f, "conditionExpression", _decision_route(decisions_by_id[source], str(e["id"])), AWA_DECISION_ROUTE_LANGUAGE)
            elif gateway is not None and isinstance(e.get("condition"), str):
                feel = awa_condition_to_feel(e["condition"])
                if feel is not None:
                    _formal(f, "conditionExpression", feel, FEEL_LANGUAGE)
                else:
                    _formal(f, "conditionExpression", e["condition"], AWA_EXPRESSION_LANGUAGE)
            flows.append(f)
            elements[str(e["id"])] = f
        for child in nodes + synthetic_nodes + flows + synthetic_flows + artifacts:
            process.append(child)
    for el in shared_list:
        root.append(el)
    root.append(collaboration)
    for process in process_list:
        root.append(process)
    return root, elements, processes


def _serialise(root: ET.Element) -> str:
    ET.indent(root, space="  ")
    return '<?xml version="1.0" encoding="UTF-8"?>\n' + ET.tostring(root, encoding="unicode") + "\n"


def export_bpmn(documents: list[dict[str, Any]], diagram: bool = True) -> ExportBpmnResult:
    """Write workflows as one BPMN 2.0 document, and their decision tables as one DMN document"""
    if not documents:
        raise InterchangeError("There is no workflow to export")
    for d in documents:
        check_document(d)
    workflows = [clone(unwrap_document(d)) for d in documents]
    seen: set[str] = set()
    for w in workflows:
        if str(w["id"]) in seen:
            raise InterchangeError(f"Two workflows have the identifier {w['id']}; a BPMN document holds each process once")
        seen.add(str(w["id"]))
    decision_nodes = [n for w in workflows for n in (w.get("decision_nodes") or []) if isinstance(n.get("decision_table"), dict)]
    dmn = write_dmn(decision_nodes, {"id": str(workflows[0]["id"]), "name": str(workflows[0]["name"])}) if decision_nodes else None
    dmn_list = [dmn] if dmn else []

    root, elements, processes = _build(workflows)
    draft = _serialise(ET.fromstring(ET.tostring(root)))
    native = import_bpmn(draft, dmn_list, native=True)
    for original in workflows:
        back = next((d for d in native.documents if d.get("id") == original["id"]), None)
        if back is None:
            raise InterchangeError(f'The workflow "{original["name"]}" was not read back from the BPMN written for it; this is a defect of the exporter')
        level = {k: v for k, v in original.items() if k not in COLLECTIONS}
        native_level = {k: v for k, v in back.items() if k not in COLLECTIONS}
        for key in COLLECTIONS:
            mine, theirs = original.get(key), back.get(key)
            same = isinstance(mine, list) and isinstance(theirs, list) and len(mine) == len(theirs) and all(
                m.get("id") == t.get("id") for m, t in zip(mine, theirs))
            if same:
                for item, other in zip(mine, theirs):
                    element = elements.get(str(item.get("id")))
                    if element is not None:
                        add_extensions(element, residual_extensions(residual(item, other)), BPMN_MODEL_NAMESPACE, ("documentation",))
            else:
                if key in original:
                    level[key] = mine
                if key in back:
                    native_level[key] = theirs
        add_extensions(processes[str(original["id"])], residual_extensions(residual(level, native_level)), BPMN_MODEL_NAMESPACE, ("documentation",))
    for document, w in zip(documents, workflows):
        if document is unwrap_document(document):
            continue
        envelope = {k: v for k, v in document.items() if k != "workflow"}
        add_extensions(processes[str(w["id"])], [("envelope", to_json(envelope))], BPMN_MODEL_NAMESPACE, ("documentation",))
    if diagram:
        lay_out(root)
    bpmn = _serialise(root)
    back = import_bpmn(bpmn, dmn_list)
    for i, document in enumerate(documents):
        if not json_equal(back.documents[i], document):
            raise InterchangeError(f'The workflow "{workflows[i]["name"]}" does not read back from BPMN as it was written; this is a defect of the exporter')
    return ExportBpmnResult(bpmn=bpmn, dmn=dmn)
