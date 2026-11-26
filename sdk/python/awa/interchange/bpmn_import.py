"""
BPMN 2.0 to AWA (specification 27.2 to 27.8).

Python port of sdk/typescript/src/interchange/bpmn_import.ts: read the document into a
graph of nodes and flows, fold the shapes an AWA export writes back into the node they came
from, encode inclusive gateways, refuse what AWA cannot express, and write one workflow per
process and per embedded subprocess.
"""

from __future__ import annotations

import json
import re
from dataclasses import dataclass, field
from typing import Any

from awa.interchange.common import (
    AWA_DECISION_ROUTE_LANGUAGE, AWA_EXPRESSION_LANGUAGE, BPMN_MODEL_NAMESPACE, InterchangeError,
    InterchangeWarning, apply_residual, awa_id, clone, read_residual, token_name,
)
from awa.interchange.dmn import read_dmn
from awa.interchange.expressions import feel_condition_to_awa
from awa.interchange.xml_reader import (
    Document, Element, awa_attribute, awa_extensions, check_known, foreign_attribute, local, parse,
)
from awa.runtime.duration import parse_iso_duration
from awa.runtime.expression import ExpressionError, evaluate_expression

ACTOR_TYPES = ["human", "ai_agent", "robot", "application"]
DEFAULT_ACTOR = {
    "task": "human", "userTask": "human", "manualTask": "human",
    "serviceTask": "application", "scriptTask": "application", "callActivity": "application", "subProcess": "application",
}
ROLE_NAMES = {"human": "Human", "ai_agent": "AI agent", "robot": "Robot", "application": "Application"}
PROGRAM_LANGUAGES = {
    "python": "python", "typescript": "typescript", "ts": "typescript", "javascript": "javascript", "js": "javascript",
    "ecmascript": "javascript", "java": "java", "sql": "sql", "shell": "shell", "sh": "shell", "bash": "shell", "graphql": "graphql",
}
ACTIVITY_TYPES = {"task", "userTask", "manualTask", "serviceTask", "scriptTask", "businessRuleTask", "sendTask", "receiveTask", "callActivity", "subProcess"}
EVENT_TYPES = {"startEvent", "endEvent", "intermediateThrowEvent", "intermediateCatchEvent"}
GATEWAY_TYPES = {"exclusiveGateway", "parallelGateway", "inclusiveGateway", "eventBasedGateway"}
DATA_TYPES = {"dataObject", "dataObjectReference", "dataStoreReference"}
REFUSED = {
    "complexGateway": "a complex gateway's activation rule has no AWA counterpart",
    "transaction": "AWA has no transactions: compensation (13.6) undoes completed work when a run fails, but nothing is rolled back atomically",
    "adHocSubProcess": "AWA has no ad hoc ordering of activities: every activity is reached by an edge",
    "callChoreography": "choreographies describe exchanges between participants, not a process AWA can run",
    "choreographyTask": "choreographies describe exchanges between participants, not a process AWA can run",
    "subChoreography": "choreographies describe exchanges between participants, not a process AWA can run",
}
KNOWN_BPMN = {
    "definitions", "import", "extension", "documentation", "extensionElements", "process", "collaboration", "participant",
    "participantMultiplicity", "messageFlow", "laneSet", "lane", "childLaneSet", "flowNodeRef", "partitionElement",
    "sequenceFlow", "conditionExpression", "task", "userTask", "manualTask", "serviceTask", "scriptTask", "script",
    "businessRuleTask", "sendTask", "receiveTask", "callActivity", "subProcess", "adHocSubProcess", "transaction",
    "startEvent", "endEvent", "intermediateThrowEvent", "intermediateCatchEvent", "boundaryEvent",
    "messageEventDefinition", "signalEventDefinition", "timerEventDefinition", "timeDuration", "timeDate", "timeCycle",
    "errorEventDefinition", "escalationEventDefinition", "compensateEventDefinition", "conditionalEventDefinition",
    "condition", "linkEventDefinition", "source", "target", "cancelEventDefinition", "terminateEventDefinition",
    "eventDefinitionRef", "exclusiveGateway", "parallelGateway", "inclusiveGateway", "eventBasedGateway", "complexGateway",
    "activationCondition", "message", "signal", "error", "escalation", "itemDefinition", "dataObject",
    "dataObjectReference", "dataStore", "dataStoreReference", "dataState", "ioSpecification", "dataInput", "dataOutput",
    "inputSet", "outputSet", "dataInputRefs", "dataOutputRefs", "optionalInputRefs", "optionalOutputRefs",
    "whileExecutingInputRefs", "whileExecutingOutputRefs", "outputSetRefs", "inputSetRefs", "dataInputAssociation",
    "dataOutputAssociation", "sourceRef", "targetRef", "assignment", "from", "to", "transformation", "textAnnotation",
    "text", "association", "group", "category", "categoryValue", "standardLoopCharacteristics",
    "multiInstanceLoopCharacteristics", "loopCardinality", "loopCondition", "completionCondition", "inputDataItem",
    "outputDataItem", "loopDataInputRef", "loopDataOutputRef", "complexBehaviorDefinition", "property", "performer",
    "humanPerformer", "potentialOwner", "resourceAssignmentExpression", "resourceRef", "resourceParameterBinding",
    "expression", "formalExpression", "interface", "operation", "inMessageRef", "outMessageRef", "errorRef", "endPoint",
    "resource", "resourceParameter", "correlationKey", "correlationProperty", "correlationPropertyRef",
    "correlationPropertyRetrievalExpression", "messagePath", "correlationSubscription", "correlationPropertyBinding",
    "dataPath", "incoming", "outgoing", "choreography", "choreographyTask", "callChoreography", "subChoreography",
    "participantRef", "messageFlowRef", "conversation", "subConversation", "callConversation", "conversationLink",
    "globalTask", "globalUserTask", "globalScriptTask", "globalManualTask", "globalBusinessRuleTask", "relationship",
    "auditing", "monitoring", "interfaceRef", "supportedInterfaceRef", "ioBinding", "rendering", "participantAssociation",
    "innerParticipantRef", "outerParticipantRef", "extensionDefinition", "extensionAttributeDefinition",
}


@dataclass(eq=False)
class GFlow:
    id: str
    el: Element | None
    source: "GNode"
    target: "GNode"
    order: float
    awa_id: str
    condition: str | None = None
    route: bool = False
    is_default: bool = False
    removed: bool = False


@dataclass(eq=False)
class GNode:
    id: str
    el: Element | None
    type: str
    kind: str
    order: float
    awa_id: str
    incoming: list[GFlow] = field(default_factory=list)
    outgoing: list[GFlow] = field(default_factory=list)
    join: str | None = None
    default_flow: GFlow | None = None
    timeout: tuple[str, GFlow] | None = None
    compensation: "GNode | None" = None
    folded: bool = False
    removed: bool = False
    awa: dict[str, Any] | None = None


class _Graph:
    def __init__(self):
        self.nodes: list[GNode] = []
        self.flows: list[GFlow] = []
        self.by_id: dict[str, GNode] = {}
        self.synthetic = 0

    def add_node(self, node: GNode) -> GNode:
        self.nodes.append(node)
        self.by_id[node.id] = node
        return node

    def connect(self, flow: GFlow) -> GFlow:
        flow.source.outgoing.append(flow)
        flow.target.incoming.append(flow)
        self.flows.append(flow)
        return flow

    def remove_flow(self, flow: GFlow) -> None:
        flow.removed = True
        flow.source.outgoing = [f for f in flow.source.outgoing if f is not flow]
        flow.target.incoming = [f for f in flow.target.incoming if f is not flow]

    def retarget(self, flow: GFlow, target: GNode) -> None:
        flow.target.incoming = [f for f in flow.target.incoming if f is not flow]
        flow.target = target
        target.incoming.append(flow)

    def resource(self, flow: GFlow, source: GNode) -> None:
        flow.source.outgoing = [f for f in flow.source.outgoing if f is not flow]
        flow.source = source
        source.outgoing.append(flow)

    def next_order(self, after: float) -> float:
        self.synthetic += 1
        return after + self.synthetic / 10000

    def live(self) -> list[GNode]:
        return [n for n in self.nodes if not n.removed]


def _describe(el: Element) -> str:
    name = el.get("name")
    return f'{local(el.tag)} "{el.get("id")}"' + (f" ({name})" if name else "")


def _refuse(el: Element, reason: str):
    raise InterchangeError(f"{_describe(el)} is not imported: {reason}")


@dataclass
class _Ctx:
    doc: Document
    doc_id: str
    native: bool
    warnings: list[InterchangeWarning]
    decisions: dict[str, dict[str, Any]]
    process_ids: dict[str, str]
    documents: list[dict[str, Any]] = field(default_factory=list)
    lane_of: dict[str, Element] = field(default_factory=dict)
    lanes: list[Element] = field(default_factory=list)

    def warn(self, el: Element | None, message: str) -> None:
        self.warnings.append(InterchangeWarning(message=f"{_describe(el)}: {message}" if el is not None else message,
                                                element=el.get("id") if el is not None else None))


def _flow_condition(ctx: _Ctx, flow: Element) -> dict[str, Any]:
    expression = ctx.doc.child(flow, "conditionExpression")
    if expression is None:
        return {}
    body = (expression.text or "").strip()
    if not body:
        return {}
    language = expression.get("language") or ctx.doc.root.get("expressionLanguage")
    if language == AWA_DECISION_ROUTE_LANGUAGE:
        return {"route": True}
    if language == AWA_EXPRESSION_LANGUAGE:
        try:
            evaluate_expression(body, {})
        except ExpressionError as error:
            raise InterchangeError(f"{_describe(flow)}: {error}") from None
        return {"condition": body}
    try:
        return {"condition": feel_condition_to_awa(body)}
    except InterchangeError as error:
        raise InterchangeError(f"{_describe(flow)}: {error}. AWA conditions compare a property with a value and join comparisons with and, or and not (section 6)") from None


def _event_definition(ctx: _Ctx, el: Element) -> Element | None:
    defs = [c for c in ctx.doc.children(el) if local(c.tag).endswith("EventDefinition")]
    if len(defs) > 1:
        _refuse(el, "it has several event definitions; AWA events have one")
    if ctx.doc.children(el, "eventDefinitionRef"):
        _refuse(el, "it refers to shared event definitions; define the event on the element")
    return defs[0] if defs else None


def _message_name(ctx: _Ctx, ref: Element | None, el: Element, what: str = "message") -> str:
    if ref is not None:
        return ref.get("name") or ref.get("id")
    ctx.warn(el, f"it names no {what}; the business event is named after the element")
    return el.get("name") or el.get("id")


def _duration_of(ctx: _Ctx, el: Element, definition: Element) -> str:
    if ctx.doc.child(definition, "timeDate") is not None:
        _refuse(el, "a timer at a date has no AWA counterpart: AWA timers wait for a duration (13.5)")
    if ctx.doc.child(definition, "timeCycle") is not None:
        _refuse(el, "a repeating timer has no AWA counterpart: AWA timers wait once, for a duration (13.5)")
    body = (ctx.doc.text(definition, "timeDuration") or "").strip()
    if not body:
        _refuse(el, "the timer has no duration")
    try:
        parse_iso_duration(body)
    except (ValueError, TypeError):
        _refuse(el, f'the timer duration "{body}" is not an ISO 8601 duration of weeks, days, hours, minutes and seconds (13.5)')
    return body


def _actor_type_of(el: Element, kind: str) -> str:
    declared = awa_attribute(el, "actorType")
    if declared is not None:
        if declared not in ACTOR_TYPES:
            raise InterchangeError(f'{_describe(el)}: awa:actorType "{declared}" is not one of {", ".join(ACTOR_TYPES)}')
        return declared
    return DEFAULT_ACTOR.get(kind, "application")


def _data_objects(ctx: _Ctx, el: Element) -> tuple[list[dict], list[dict]]:
    doc = ctx.doc
    inputs: list[dict] = []
    outputs: list[dict] = []

    def add(target: list[dict], item: Element) -> None:
        ref = doc.ref(item, "dataObjectRef") if item.get("dataObjectRef") else doc.ref(item, "dataStoreRef") if item.get("dataStoreRef") else None
        name = item.get("name") or (ref.get("name") if ref is not None else None) or item.get("id")
        if not name or any(d["name"] == name for d in target):
            return
        data: dict[str, Any] = {"name": name}
        description = doc.documentation(item)
        if description:
            data["description"] = description
        target.append(data)

    io = doc.child(el, "ioSpecification")
    if io is not None:
        for item in doc.children(io, "dataInput"):
            add(inputs, item)
        for item in doc.children(io, "dataOutput"):
            add(outputs, item)
    for association in doc.children(el, "dataInputAssociation"):
        for source in doc.ref_children(association, "sourceRef"):
            if local(source.tag) in ("dataObjectReference", "dataStoreReference"):
                add(inputs, source)
    for association in doc.children(el, "dataOutputAssociation"):
        for target in doc.ref_children(association, "targetRef"):
            if local(target.tag) in ("dataObjectReference", "dataStoreReference"):
                add(outputs, target)
    return inputs, outputs


# ---------------------------------------------------------------------------
# A process or embedded subprocess becomes a workflow
# ---------------------------------------------------------------------------


def _build_workflow(container: Element, ctx: _Ctx, head: dict[str, Any], process_id: str, top: Element) -> dict[str, Any]:
    doc = ctx.doc
    g = _Graph()
    elements = [c for c in doc.children(container) if local(c.tag) not in (
        "documentation", "extensionElements", "laneSet", "ioSpecification", "property", "incoming", "outgoing",
        "textAnnotation", "association", "group", "standardLoopCharacteristics", "multiInstanceLoopCharacteristics",
        "dataInputAssociation", "dataOutputAssociation", "ioBinding", "auditing", "monitoring", "performer",
        "humanPerformer", "potentialOwner", "correlationSubscription", "resourceRole")]
    artifacts = [c for c in doc.children(container) if local(c.tag) in ("textAnnotation", "association", "group")]
    boundaries: list[Element] = []
    flows: list[Element] = []
    boundary_flows: list[tuple[Element, Element, GNode]] = []

    for index, el in enumerate(elements):
        kind_name = local(el.tag)
        if kind_name == "sequenceFlow":
            flows.append(el)
            continue
        if kind_name in REFUSED:
            _refuse(el, REFUSED[kind_name])
        if kind_name == "subProcess" and el.get("triggeredByEvent") == "true":
            _refuse(el, "an event subprocess starts when an event occurs anywhere in its process; AWA has no handler of that kind")
        if kind_name == "boundaryEvent":
            boundaries.append(el)
            continue
        if kind_name in DATA_TYPES:
            continue
        if kind_name in ACTIVITY_TYPES:
            loop = doc.child(el, "standardLoopCharacteristics")
            if loop is None:
                loop = doc.child(el, "multiInstanceLoopCharacteristics")
            if loop is not None:
                _refuse(el, f"{'a loop' if local(loop.tag) == 'standardLoopCharacteristics' else 'multiple instances'} of one activity have no AWA counterpart; draw the repetition as an edge back to the activity, with a condition")
            kind = "decision" if kind_name == "businessRuleTask" else "event" if kind_name in ("sendTask", "receiveTask") else "activity"
        elif kind_name in EVENT_TYPES:
            kind = "event"
        elif kind_name in GATEWAY_TYPES:
            kind = "gateway"
        else:
            _refuse(el, "AWA has no element of this kind")
        g.add_node(GNode(id=el.get("id"), el=el, type=kind_name, kind=kind, order=index, awa_id=awa_id(el.get("id"), ctx.doc_id)))
    all_children = list(doc.children(container))
    for el in flows:
        source_el, target_el = doc.ref(el, "sourceRef"), doc.ref(el, "targetRef")
        source = g.by_id.get(source_el.get("id")) if source_el is not None else None
        target = g.by_id.get(target_el.get("id")) if target_el is not None else None
        if source is None or target is None:
            boundary = next((b for b in boundaries if source_el is not None and b is source_el), None)
            if boundary is not None and target is not None:
                boundary_flows.append((el, boundary, target))
                continue
            raise InterchangeError(f"{_describe(el)} joins elements that are not in the same process")
        g.connect(GFlow(id=el.get("id"), el=el, source=source, target=target, order=all_children.index(el), awa_id=awa_id(el.get("id"), ctx.doc_id), **_flow_condition(ctx, el)))
    for node in g.nodes:
        default = node.el.get("default") if node.el is not None else None
        if default:
            doc.resolve(default, node.el, "default")
            flow = next((f for f in g.flows if f.id == default), None)
            if flow is not None:
                node.default_flow = flow
                flow.is_default = True

    associations = [a for a in doc.children(container, "association") + (doc.children(top, "association") if top is not container else [])]
    for b in boundaries:
        attached = doc.ref(b, "attachedToRef")
        host = g.by_id.get(attached.get("id")) if attached is not None else None
        if host is None:
            _refuse(b, "it is not attached to an activity of this process")
        definition = _event_definition(ctx, b)
        outgoing = [(f, t) for f, bb, t in boundary_flows if bb is b]
        kind = local(definition.tag) if definition is not None else "none"
        if kind == "compensateEventDefinition":
            handler = None
            for a in associations:
                source, target = doc.ref(a, "sourceRef"), doc.ref(a, "targetRef")
                if source is b or target is b:
                    other = target if source is b else source
                    handler = g.by_id.get(other.get("id")) if other is not None else None
                    break
            if handler is None or handler.kind != "activity":
                _refuse(b, "a compensation boundary event needs an association to the activity that compensates")
            host.compensation = handler
            continue
        if kind == "timerEventDefinition" and host.type == "receiveTask":
            if b.get("cancelActivity") == "false":
                _refuse(b, "a timer that does not interrupt the wait has no AWA counterpart")
            if len(outgoing) != 1:
                _refuse(b, "the timer must have exactly one outgoing flow, the path taken when the wait runs out")
            if host.timeout:
                _refuse(b, "the receive task already has a timer")
            flow_el, target = outgoing[0]
            flow = g.connect(GFlow(id=flow_el.get("id"), el=flow_el, source=host, target=target, order=all_children.index(flow_el),
                                   awa_id=awa_id(flow_el.get("id"), ctx.doc_id), **_flow_condition(ctx, flow_el)))
            host.timeout = (_duration_of(ctx, b, definition), flow)
            continue
        reasons = {
            "errorEventDefinition": "AWA has no error routing: an activity that raises an error fails its token and the run (5.7); state the alternative as a condition on the activity's result, or undo the work with a compensation handler (13.6)",
            "timerEventDefinition": "AWA interrupts an activity only through its outcome contract budget (11.4) or service level (23.3), which fail it rather than take another path; a timer boundary is imported only on a receive task",
            "messageEventDefinition": "AWA activities are not interrupted by messages; wait for the message with a message event instead (18.3)",
            "signalEventDefinition": "AWA activities are not interrupted by signals; wait for the signal with a signal event instead (18.3)",
            "escalationEventDefinition": "AWA has no escalation events; an outcome contract can escalate to a person (11.5)",
            "conditionalEventDefinition": "AWA activities are not interrupted by conditions",
            "cancelEventDefinition": "AWA has no transactions to cancel",
        }
        _refuse(b, reasons.get(kind, "this boundary event has no AWA counterpart"))

    for artifact in artifacts:
        kind = local(artifact.tag)
        if kind == "association":
            source, target = doc.ref(artifact, "sourceRef"), doc.ref(artifact, "targetRef")
            if any(b is source or b is target for b in boundaries):
                continue
        if not ctx.native:
            ctx.warn(artifact, f"{'text annotations' if kind == 'textAnnotation' else 'groups' if kind == 'group' else 'associations'} are not imported")

    _collapse_event_based(g, ctx)
    _fold_parallel_joins(g)
    _fold_exclusive_splits(g)
    _encode_inclusive(g, ctx)
    _check_routing(g, ctx)
    return _emit(g, container, ctx, head, process_id, top)


def _definition_type(ctx: _Ctx, n: GNode) -> str:
    if n.type == "receiveTask":
        return "messageEventDefinition"
    if n.type == "intermediateCatchEvent":
        d = _event_definition(ctx, n.el)
        return local(d.tag) if d is not None else ""
    return ""


def _collapse_event_based(g: _Graph, ctx: _Ctx) -> None:
    for gw in [n for n in g.live() if n.type == "eventBasedGateway"]:
        targets = [f.target for f in gw.outgoing]
        waits = [n for n in targets if _definition_type(ctx, n) in ("messageEventDefinition", "signalEventDefinition")]
        timers = [n for n in targets if _definition_type(ctx, n) == "timerEventDefinition"]
        if len(waits) != 1 or len(timers) > 1 or len(waits) + len(timers) != len(targets):
            _refuse(gw.el, "AWA waits for one business event, with an optional timeout (18.3); an event-based gateway is imported only before one message or signal event and at most one timer")
        if any(len(t.incoming) != 1 for t in targets):
            _refuse(gw.el, "the events after an event-based gateway must be reached only from it")
        wait = waits[0]
        if wait.timeout:
            _refuse(gw.el, f"{_describe(wait.el)} already has a timer")
        for f in list(gw.incoming):
            g.retarget(f, wait)
        for f in list(gw.outgoing):
            g.remove_flow(f)
        if timers:
            timer = timers[0]
            if len(timer.outgoing) != 1:
                _refuse(timer.el, "the timer after an event-based gateway must have exactly one outgoing flow")
            flow = timer.outgoing[0]
            g.resource(flow, wait)
            wait.timeout = (_duration_of(ctx, timer.el, _event_definition(ctx, timer.el)), flow)
            timer.removed = True
        gw.removed = True


def _can_join(n: GNode) -> bool:
    return not n.removed and (n.kind in ("activity", "event") or (n.kind == "gateway" and n.type != "eventBasedGateway"))


def _fold_parallel_joins(g: _Graph) -> None:
    for gw in [n for n in g.live() if n.type == "parallelGateway"]:
        if len(gw.incoming) < 2 or len(gw.outgoing) != 1:
            continue
        flow = gw.outgoing[0]
        target = flow.target
        if not _can_join(target) or target.type == "parallelGateway" or len(target.incoming) != 1 or target.join:
            continue
        for f in list(gw.incoming):
            g.retarget(f, target)
        g.remove_flow(flow)
        gw.removed = True
        target.join = "all"


def _fold_exclusive_splits(g: _Graph) -> None:
    for gw in [n for n in g.live() if n.type == "exclusiveGateway"]:
        if len(gw.incoming) != 1:
            continue
        flow = gw.incoming[0]
        source = flow.source
        if source.removed or source.kind in ("gateway", "synthetic"):
            continue
        timeout_flow = source.timeout[1] if source.timeout else None
        others = [f for f in source.outgoing if f is not flow and f is not timeout_flow]
        if others or source.default_flow:
            continue
        if source.kind == "decision" and not all(f.route or f is gw.default_flow or (not f.condition and len(gw.outgoing) == 1) for f in gw.outgoing):
            continue
        if source.kind != "decision" and any(f.route for f in gw.outgoing):
            continue
        for f in list(gw.outgoing):
            g.resource(f, source)
        if gw.default_flow:
            source.default_flow = gw.default_flow
        g.remove_flow(flow)
        gw.removed = True
        source.folded = True


def _reach(start: GNode, stop: GNode | None = None) -> list[GNode]:
    seen: list[GNode] = []
    queue = [start]
    while queue:
        n = queue.pop(0)
        if n is stop or n in seen:
            continue
        seen.append(n)
        queue.extend(f.target for f in n.outgoing)
    return seen


def _synthetic_event(g: _Graph, ctx: _Ctx, near: GNode, suffix: str, name: str, event_type: str) -> GNode:
    node_id = awa_id(near.id, ctx.doc_id, suffix)
    return g.add_node(GNode(id=f"{near.id}{suffix}", el=None, type="synthetic", kind="synthetic", order=g.next_order(near.order),
                            awa_id=node_id, awa={"id": node_id, "name": name, "event_type": event_type}))


def _encode_inclusive(g: _Graph, ctx: _Ctx) -> None:
    inclusive = [n for n in g.live() if n.type == "inclusiveGateway"]
    matched: list[GNode] = []
    for gw in inclusive:
        if len(gw.incoming) > 1 and len(gw.outgoing) > 1:
            _refuse(gw.el, "an inclusive gateway that both joins and splits has no AWA counterpart; draw a converging and a diverging gateway")
        if len(gw.outgoing) < 2 and not any(f.condition for f in gw.outgoing):
            continue
        branches = sorted(gw.outgoing, key=lambda f: f.order)
        conditional = [f for f in branches if f.condition]
        plain = [f for f in branches if not f.condition and f is not gw.default_flow]
        if gw.default_flow and plain:
            _refuse(gw.el, "its default flow can never be taken, since a flow without a condition is always taken")
        name = gw.el.get("name") or gw.el.get("id")
        reached = [[n for n in _reach(f.target) if n.type == "inclusiveGateway" and len(n.incoming) > 1 and n is not gw] for f in branches]
        join = next((j for j in reached[0] if all(j in lst for lst in reached)), None)
        merges: dict[int, GNode] = {}
        skip_end: list[GNode] = []
        if join is not None:
            sets = [[] if f.target is join else _reach(f.target, join) for f in branches]
            for incoming in list(join.incoming):
                owners = [f for i, f in enumerate(branches) if f is incoming or incoming.source in sets[i]]
                if len(owners) != 1:
                    _refuse(gw.el, f"its branches do not each reach {_describe(join.el)} by their own flows, so which branches were taken cannot be known there")
            for i, f in enumerate(branches):
                label = f.el.get("name") if f.el is not None and f.el.get("name") else f.id
                merge = _synthetic_event(g, ctx, join, f"#merge:{f.id}", f"{join.el.get('name') or join.el.get('id')}: {label}", "intermediate")
                merges[id(f)] = merge
                for incoming in list(join.incoming):
                    if incoming is f or incoming.source in sets[i]:
                        g.retarget(incoming, merge)
                g.connect(GFlow(id=f"{join.id}#merged:{f.id}", el=None, source=merge, target=join, order=float("inf"), awa_id=awa_id(join.id, ctx.doc_id, f"#merged:{f.id}")))
            join.join = "all"
            matched.append(join)

        def skip_target(f: GFlow) -> GNode:
            if join is not None:
                return merges[id(f)]
            if not skip_end:
                skip_end.append(_synthetic_event(g, ctx, gw, "#skip-end", f"{name}: no branch", "end"))
            return skip_end[0]

        for f in [f for f in branches if f.condition or f is gw.default_flow]:
            label = f.el.get("name") if f.el is not None and f.el.get("name") else f.id
            guard = _synthetic_event(g, ctx, gw, f"#guard:{f.id}", f"{name}: {label}", "intermediate")
            g.connect(GFlow(id=f"{gw.id}#branch:{f.id}", el=None, source=gw, target=guard, order=float("inf"), awa_id=awa_id(gw.id, ctx.doc_id, f"#branch:{f.id}")))
            g.resource(f, guard)
            if f is gw.default_flow:
                f.condition = " && ".join(f"!({c.condition})" for c in conditional)
                f.is_default = False
            skip = g.connect(GFlow(id=f"{gw.id}#skip:{f.id}", el=None, source=guard, target=skip_target(f), order=float("inf"),
                                   awa_id=awa_id(gw.id, ctx.doc_id, f"#skip:{f.id}"), is_default=True))
            guard.default_flow = skip
        gw.default_flow = None
    for gw in inclusive:
        if len(gw.incoming) > 1 and gw not in matched:
            _refuse(gw.el, "a converging inclusive gateway is imported only as the join of an inclusive split whose branches each reach it; AWA joins wait for every incoming edge (13.2)")


def _check_routing(g: _Graph, ctx: _Ctx) -> None:
    for node in g.live():
        timeout_flow = node.timeout[1] if node.timeout else None
        out = [f for f in node.outgoing if f is not timeout_flow]
        if node.type == "parallelGateway" and any(f.condition for f in out):
            ctx.warn(node.el, "conditions on the flows of a parallel gateway are ignored, as BPMN ignores them")
            for f in out:
                f.condition = None
        if node.kind == "decision" and not node.folded and len(out) > 1:
            _refuse(node.el, "a business rule task with several outgoing flows splits the token in BPMN, and an AWA decision takes one edge; put an exclusive gateway after it")
        if node.kind in ("activity", "event") and not node.folded:
            conditional = [f for f in out if f.condition]
            if conditional and (len(conditional) > 1 or any(not f.condition and f is not node.default_flow for f in out)):
                _refuse(node.el, "BPMN takes every conditional flow leaving an activity whose condition holds, and AWA takes one; put an exclusive or inclusive gateway after it")


# ---------------------------------------------------------------------------
# Writing the workflow
# ---------------------------------------------------------------------------


def _lane_role(ctx: _Ctx, lane: Element) -> dict[str, Any]:
    role: dict[str, Any] = {"id": awa_id(lane.get("id"), ctx.doc_id), "name": lane.get("name") or lane.get("id")}
    description = ctx.doc.documentation(lane)
    if description:
        role["description"] = description
    declared = awa_attribute(lane, "actorType")
    if declared is not None and declared not in ACTOR_TYPES:
        raise InterchangeError(f'{_describe(lane)}: awa:actorType "{declared}" is not one of {", ".join(ACTOR_TYPES)}')
    actor = declared
    if not actor:
        first = next((n for n in ctx.doc.ref_children(lane, "flowNodeRef") if ctx.lane_of.get(n.get("id")) is lane and local(n.tag) in DEFAULT_ACTOR), None)
        actor = _actor_type_of(first, local(first.tag)) if first is not None else "human"
    role["actor_type"] = actor
    if not ctx.native:
        apply_residual(role, read_residual(awa_extensions(ctx.doc, lane), _describe(lane)))
    return role


def _residual_of(ctx: _Ctx, el: Element | None, target: dict[str, Any]) -> None:
    if ctx.native or el is None:
        return
    apply_residual(target, read_residual(awa_extensions(ctx.doc, el), _describe(el)))


def _emit(g: _Graph, container: Element, ctx: _Ctx, head: dict[str, Any], process_id: str, top: Element) -> dict[str, Any]:
    doc = ctx.doc
    activities: list[dict] = []
    events: list[dict] = []
    decisions: list[dict] = []
    roles: dict[str, dict] = {}
    for lane in ctx.lanes:
        used = any(n.get("id") in g.by_id and ctx.lane_of.get(n.get("id")) is lane for n in doc.ref_children(lane, "flowNodeRef"))
        if used or container is top:
            roles[awa_id(lane.get("id"), ctx.doc_id)] = _lane_role(ctx, lane)

    def role_of(node: GNode, actor_type: str) -> str:
        lane = ctx.lane_of.get(node.id)
        if lane is not None:
            role_id = awa_id(lane.get("id"), ctx.doc_id)
            if role_id not in roles:
                roles[role_id] = _lane_role(ctx, lane)
            return role_id
        role_id = awa_id(process_id, ctx.doc_id, f"#role:{actor_type}")
        if role_id not in roles:
            roles[role_id] = {"id": role_id, "name": ROLE_NAMES[actor_type], "actor_type": actor_type}
        return role_id

    live = sorted(g.live(), key=lambda n: n.order)
    starts = [n for n in live if n.type == "startEvent"]
    if len(starts) > 1:
        _refuse(starts[1].el, "a run starts at one node (5.3), and this process has several start events; start the other paths from one start event with a gateway")

    for node in live:
        el = node.el
        if node.kind == "synthetic":
            events.append(clone(node.awa))
            continue
        if node.kind == "activity":
            actor_type = _actor_type_of(el, node.type)
            a: dict[str, Any] = {"id": node.awa_id, "name": el.get("name") or el.get("id")}
            description = doc.documentation(el)
            if description:
                a["description"] = description
            a["role_id"] = role_of(node, actor_type)
            a["actor_type"] = actor_type
            inputs, outputs = _data_objects(ctx, el)
            if inputs:
                a["inputs"] = inputs
            if outputs:
                a["outputs"] = outputs
            if node.type == "callActivity":
                a["is_expandable"] = True
                called = el.get("calledElement")
                if called:
                    if called in ctx.process_ids:
                        a["expansion_workflow_id"] = ctx.process_ids[called]
                    elif re.fullmatch(r"_[0-9a-fA-F-]{36}", called):
                        a["expansion_workflow_id"] = called[1:]
                    else:
                        ctx.warn(el, f'the called element "{called}" is not a process of this document, so the activity names no sub-workflow')
            if node.type == "subProcess":
                a["is_expandable"] = True
                sub_id = awa_id(el.get("id"), ctx.doc_id, "#workflow")
                a["expansion_workflow_id"] = sub_id
                sub_head = {"id": sub_id, "name": el.get("name") or el.get("id"), "parent_workflow_id": head["id"], "expansion_activity_id": node.awa_id}
                ctx.documents.append(_build_workflow(el, ctx, sub_head, process_id, top))
            script = doc.text(el, "script")
            if node.type == "scriptTask" and script and script.strip():
                fmt = re.sub(r"^(text|application)/", "", (el.get("scriptFormat") or "").lower())
                language = PROGRAM_LANGUAGES.get(fmt)
                if language:
                    a["programs"] = [{"id": awa_id(el.get("id"), ctx.doc_id, "#script"), "name": el.get("name") or el.get("id"), "language": language, "code": script}]
                else:
                    a["procedure"] = script
                    ctx.warn(el, f"the script format \"{el.get('scriptFormat') or 'unspecified'}\" is not a program language AWA names, so the script is kept as the activity's procedure")
            if node.join:
                a["join"] = node.join
            if node.compensation:
                a["compensation"] = {"activity_id": node.compensation.awa_id}
            _residual_of(ctx, el, a)
            activities.append(a)
            continue
        if node.kind == "decision":
            d: dict[str, Any] = {"id": node.awa_id, "name": el.get("name") or el.get("id")}
            description = doc.documentation(el)
            if description:
                d["description"] = description
            ref = awa_attribute(el, "decisionRef")
            if ref is None:
                ref = foreign_attribute(el, "decisionRef", BPMN_MODEL_NAMESPACE)
            table = ctx.decisions.get(ref) if ref else None
            out = node.outgoing
            if table is not None:
                d["decision_table"] = clone(table["decision_table"])
            else:
                if not ctx.native:
                    ctx.warn(el, f'the decision "{ref}" is not in the DMN documents given, so an external decision engine named "dmn" decides (5.5.4)' if ref
                             else 'it names no DMN decision, so an external decision engine named "dmn" decides (5.5.4)')
                implementation = el.get("implementation")
                d["decision_engine"] = {
                    "name": "dmn",
                    "ruleset": ref or (implementation if implementation and implementation != "##unspecified" else el.get("name") or el.get("id")),
                    "options": [{"id": token_name(f.id), "output_edge_id": f.awa_id} for f in out],
                }
            if node.default_flow:
                d["default_output_edge_id"] = node.default_flow.awa_id
            elif len(out) == 1:
                d["default_output_edge_id"] = out[0].awa_id
            _residual_of(ctx, el, d)
            decisions.append(d)
            continue
        e: dict[str, Any] = {"id": node.awa_id, "name": el.get("name") or el.get("id")}
        description = doc.documentation(el)
        if description:
            e["description"] = description
        e.update(_event_fields(node, ctx))
        if node.join:
            e["join"] = node.join
        _residual_of(ctx, el, e)
        events.append(e)

    edges = []
    for f in sorted([f for f in g.flows if not f.removed], key=lambda f: f.order):
        edge: dict[str, Any] = {"id": f.awa_id, "source_id": f.source.awa_id, "target_id": f.target.awa_id}
        if f.condition:
            edge["condition"] = f.condition
        if f.is_default and f.source.kind != "decision":
            edge["is_default"] = True
        if f.el is not None and f.el.get("name"):
            edge["label"] = f.el.get("name")
        _residual_of(ctx, f.el, edge)
        edges.append(edge)

    workflow: dict[str, Any] = {"id": head["id"], "name": head["name"], "version": "1.0.0", "awa_version": "1.1"}
    for key in ("description", "parent_workflow_id", "expansion_activity_id"):
        if head.get(key) is not None:
            workflow[key] = head[key]
    if roles:
        workflow["roles"] = list(roles.values())
    workflow["activities"] = activities
    workflow["edges"] = edges
    if events:
        workflow["events"] = events
    if decisions:
        workflow["decision_nodes"] = decisions
    return workflow


def _event_fields(node: GNode, ctx: _Ctx) -> dict[str, Any]:
    el = node.el
    doc = ctx.doc

    def with_timeout(definition: dict[str, Any]) -> dict[str, Any]:
        if node.timeout:
            definition["timeout"] = node.timeout[0]
            definition["timeout_edge_id"] = node.timeout[1].awa_id
        return definition

    def ref(definition: Element, attribute: str) -> Element | None:
        value = definition.get(attribute)
        if value is None:
            child = doc.child(definition, attribute)
            value = child.text if child is not None else None
        return doc.resolve(value, definition, attribute) if value else None

    if node.kind == "gateway":
        if node.type == "parallelGateway" and len(node.incoming) > 1:
            node.join = "all"
        return {"event_type": "intermediate", "bpmn:gateway": node.type.replace("Gateway", "")}
    if node.type == "sendTask":
        return {"event_type": "message", "event_definition": {"name": _message_name(ctx, doc.ref(el, "messageRef"), el), "mode": "publish"}}
    if node.type == "receiveTask":
        return {"event_type": "message", "event_definition": with_timeout({"name": _message_name(ctx, doc.ref(el, "messageRef"), el)})}
    definition = _event_definition(ctx, el)
    kind = local(definition.tag) if definition is not None else "none"

    def message(publish: bool = False):
        out = {"name": _message_name(ctx, ref(definition, "messageRef"), el)}
        if publish:
            out["mode"] = "publish"
        return out

    def signal(publish: bool = False):
        out = {"name": _message_name(ctx, ref(definition, "signalRef"), el, "signal")}
        if publish:
            out["mode"] = "publish"
        return out

    if node.type == "startEvent":
        if kind == "messageEventDefinition":
            return {"event_type": "start", "event_definition": message()}
        if kind == "signalEventDefinition":
            return {"event_type": "start", "event_definition": signal()}
        if kind in ("timerEventDefinition", "conditionalEventDefinition"):
            ctx.warn(el, f"a {'timer' if kind == 'timerEventDefinition' else 'conditional'} start event is imported as a start event: when to start a run is the host's decision")
        elif kind != "none":
            _refuse(el, "this kind of start event has no AWA counterpart")
        return {"event_type": "start"}
    if node.type == "endEvent":
        if kind == "none":
            return {"event_type": "end"}
        if kind == "messageEventDefinition":
            return {"event_type": "message", "event_definition": message(True)}
        if kind == "signalEventDefinition":
            return {"event_type": "signal", "event_definition": signal(True)}
        if kind == "errorEventDefinition":
            if not ctx.native:
                ctx.warn(el, "an error end event is imported as an AWA error event, which fails the token that reaches it (13.4)")
            error = ref(definition, "errorRef")
            if error is not None:
                return {"event_type": "error", "event_definition": {"name": error.get("errorCode") or error.get("name") or error.get("id")}}
            return {"event_type": "error"}
        reasons = {
            "terminateEventDefinition": "a terminate end event ends every branch of the run, and an AWA end event completes one token (13.4)",
            "compensateEventDefinition": "AWA compensates when a run fails (13.6); it has no event that starts compensation",
            "escalationEventDefinition": "AWA has no escalation events; an outcome contract can escalate to a person (11.5)",
            "cancelEventDefinition": "AWA has no transactions to cancel",
        }
        _refuse(el, reasons.get(kind, "this kind of end event has no AWA counterpart"))
    if node.type == "intermediateThrowEvent":
        if kind == "none":
            return {"event_type": "intermediate"}
        if kind == "messageEventDefinition":
            return {"event_type": "message", "event_definition": message(True)}
        if kind == "signalEventDefinition":
            return {"event_type": "signal", "event_definition": signal(True)}
        reasons = {
            "compensateEventDefinition": "AWA compensates when a run fails (13.6); it has no event that starts compensation",
            "linkEventDefinition": "link events are a drawing aid; draw the sequence flow they stand for",
            "escalationEventDefinition": "AWA has no escalation events; an outcome contract can escalate to a person (11.5)",
        }
        _refuse(el, reasons.get(kind, "this kind of intermediate event has no AWA counterpart"))
    if node.type == "intermediateCatchEvent":
        if kind == "timerEventDefinition":
            return {"event_type": "timer", "event_definition": {"duration": _duration_of(ctx, el, definition)}}
        if kind == "messageEventDefinition":
            return {"event_type": "message", "event_definition": with_timeout(message())}
        if kind == "signalEventDefinition":
            return {"event_type": "signal", "event_definition": with_timeout(signal())}
        if kind == "conditionalEventDefinition":
            if not ctx.native:
                ctx.warn(el, "a conditional event is imported as an AWA conditional event, which is reserved and fails the token that reaches it (13.4)")
            body = (doc.text(definition, "condition") or "").strip()
            return {"event_type": "conditional", "event_definition": {"condition": body}} if body else {"event_type": "conditional"}
        if kind == "linkEventDefinition":
            _refuse(el, "link events are a drawing aid; draw the sequence flow they stand for")
        _refuse(el, "this kind of intermediate event has no AWA counterpart")
    _refuse(el, "AWA has no element of this kind")


# ---------------------------------------------------------------------------
# The document
# ---------------------------------------------------------------------------


def _collect_lanes(ctx: _Ctx, container: Element) -> None:
    doc = ctx.doc

    def visit(lanes: list[Element]) -> None:
        for lane in lanes:
            ctx.lanes.append(lane)
            for node in doc.ref_children(lane, "flowNodeRef"):
                ctx.lane_of[node.get("id")] = lane
            child = doc.child(lane, "childLaneSet")
            if child is not None:
                visit(doc.children(child, "lane"))

    for lane_set in doc.children(container, "laneSet"):
        visit(doc.children(lane_set, "lane"))


@dataclass
class ImportBpmnResult:
    """The workflows, as documents: the first process first, then the others, then subprocesses"""

    documents: list[dict[str, Any]]
    warnings: list[InterchangeWarning]


def import_bpmn(xml: str, dmn: list[str] | None = None, native: bool = False) -> ImportBpmnResult:
    """Read a BPMN 2.0 document into AWA workflow documents"""
    root = parse(xml, "BPMN")
    if root.tag != f"{{{BPMN_MODEL_NAMESPACE}}}definitions":
        raise InterchangeError("The BPMN document is not well-formed BPMN: it does not start with <definitions> in the BPMN 2.0 model namespace")
    doc = Document(root, BPMN_MODEL_NAMESPACE, "BPMN")
    check_known(doc, KNOWN_BPMN)
    for el in doc.iter_ns():
        for name in ("incoming", "outgoing"):
            doc.ref_children(el, name)
    warnings: list[InterchangeWarning] = []
    decisions: dict[str, dict[str, Any]] = {}
    for text in dmn or []:
        read = read_dmn(text)
        warnings.extend(read.warnings)
        decisions.update(read.decisions)
    doc_id = root.get("id") or "definitions"
    processes = doc.children(root, "process")
    if not processes:
        raise InterchangeError("The BPMN document has no process")
    collaborations = doc.children(root, "collaboration")
    participants = [p for c in collaborations for p in doc.children(c, "participant")]
    ctx = _Ctx(doc=doc, doc_id=doc_id, native=native, warnings=warnings, decisions=decisions,
               process_ids={p.get("id"): awa_id(p.get("id"), doc_id) for p in processes})
    if any(doc.children(c, "messageFlow") for c in collaborations):
        warnings.append(InterchangeWarning(message="Message flows between pools are not imported: the message events at either end name the business events that carry them (section 18)"))
    for p in participants:
        doc.ref(p, "processRef")
    top_documents = []
    for process in processes:
        ctx.lane_of = {}
        ctx.lanes = []
        _collect_lanes(ctx, process)
        participant = next((p for p in participants if p.get("processRef") == process.get("id")), None)
        head: dict[str, Any] = {"id": ctx.process_ids[process.get("id")],
                                "name": process.get("name") or (participant.get("name") if participant is not None else None) or process.get("id")}
        description = doc.documentation(process)
        if description:
            head["description"] = description
        workflow = _build_workflow(process, ctx, head, process.get("id"), process)
        document: dict[str, Any] = workflow
        if not native:
            extensions = awa_extensions(doc, process)
            apply_residual(workflow, read_residual(extensions, _describe(process)))
            envelope = next((body for name, body in extensions if name == "envelope"), None)
            if envelope is not None:
                try:
                    value = json.loads(envelope)
                except ValueError:
                    raise InterchangeError(f"{_describe(process)}: the content of awa:envelope is not JSON") from None
                if not isinstance(value, dict):
                    raise InterchangeError(f"{_describe(process)}: awa:envelope must hold a JSON object")
                document = {**value, "workflow": workflow}
        top_documents.append(document)
    documents = top_documents + ctx.documents
    if not native:
        for document in documents:
            check_imported(document)
    return ImportBpmnResult(documents=documents, warnings=warnings)


def check_imported(document: dict[str, Any], verb: str = "read from BPMN") -> None:
    """What an import gives is a valid AWA document, or the import fails"""
    from awa.types import Workflow
    from awa.validator import validate_workflow, validate_workflow_integrity

    workflow = document["workflow"] if isinstance(document.get("workflow"), dict) and "activities" not in document else document
    schema = validate_workflow(workflow)
    problems = schema.errors if not schema.valid else validate_workflow_integrity(Workflow.model_validate(workflow)).errors
    if problems:
        details = "; ".join(f"{p.path + ': ' if p.path else ''}{p.message}" for p in problems[:5])
        raise InterchangeError(f'The workflow "{workflow.get("name")}" {verb} is not a valid AWA document: {details}')

