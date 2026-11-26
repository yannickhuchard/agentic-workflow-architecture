"""
Conformance cases of level `interchange` (specification section 27), called from generate.py.

Every expected document here is written out by hand from the rules of section 27, so that
both SDKs are checked against the specification and not against each other.
"""

import re
import uuid

INTERCHANGE_NS = uuid.UUID("84c7aa15-559c-5fc6-abf7-39cad8e0d785")
FEEL = "https://www.omg.org/spec/DMN/20191111/FEEL/"
AWA_EXPR = "https://awa.io/schema/expression/1.1"


def aid(document: str, element: str, suffix: str = "") -> str:
    """The AWA identifier of a BPMN or DMN element (27.2)"""
    if not suffix and re.fullmatch(r"_[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}", element):
        return element[1:]
    return str(uuid.uuid5(INTERCHANGE_NS, f"{document}/{element}{suffix}"))


def bpmn(defs_id: str, body: str, extra_ns: str = "") -> str:
    return ('<?xml version="1.0" encoding="UTF-8"?>\n'
            '<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" '
            'xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" '
            'xmlns:awa="https://awa.io/schema/interchange/1.1"'
            f'{extra_ns} id="{defs_id}" targetNamespace="https://example.com/bpmn">\n{body}\n</bpmn:definitions>\n')


def dmn(defs_id: str, body: str, namespace: str = "https://www.omg.org/spec/DMN/20191111/MODEL/") -> str:
    return ('<?xml version="1.0" encoding="UTF-8"?>\n'
            f'<definitions xmlns="{namespace}" xmlns:awa="https://awa.io/schema/interchange/1.1" '
            f'id="{defs_id}" name="Decisions" namespace="https://example.com/dmn">\n{body}\n</definitions>\n')


def flows(*items) -> str:
    """Sequence flows: (id, source, target) or (id, source, target, extra attributes, inner XML)"""
    out = []
    for item in items:
        fid, source, target = item[:3]
        attrs = item[3] if len(item) > 3 else ""
        inner = item[4] if len(item) > 4 else ""
        if inner:
            out.append(f'<bpmn:sequenceFlow id="{fid}" sourceRef="{source}" targetRef="{target}"{attrs}>{inner}</bpmn:sequenceFlow>')
        else:
            out.append(f'<bpmn:sequenceFlow id="{fid}" sourceRef="{source}" targetRef="{target}"{attrs}/>')
    return "\n".join(out)


def cond(body: str, language: str | None = FEEL) -> str:
    lang = f' language="{language}"' if language else ""
    return f'<bpmn:conditionExpression xsi:type="bpmn:tFormalExpression"{lang}>{body}</bpmn:conditionExpression>'


def edge(d: str, fid: str, source: str, target: str, **extra) -> dict:
    e = {"id": aid(d, fid), "source_id": aid(d, source), "target_id": aid(d, target)}
    e.update(extra)
    return e


def workflow(d: str, process: str, name: str, **rest) -> dict:
    w = {"id": aid(d, process), "name": name, "version": "1.0.0", "awa_version": "1.1"}
    w.update(rest)
    return w


def default_role(d: str, process: str, actor: str) -> dict:
    names = {"human": "Human", "ai_agent": "AI agent", "robot": "Robot", "application": "Application"}
    return {"id": aid(d, process, f"#role:{actor}"), "name": names[actor], "actor_type": actor}


def act(d: str, el: str, name: str, role: str, actor: str, **extra) -> dict:
    a = {"id": aid(d, el), "name": name, "role_id": role, "actor_type": actor}
    a.update(extra)
    return a


def ev(d: str, el: str, name: str, event_type: str, **extra) -> dict:
    e = {"id": aid(d, el), "name": name, "event_type": event_type}
    e.update(extra)
    return e


def case(case_id: str, spec: str, kind: str, description: str, **fields) -> dict:
    out = {"id": case_id, "level": "interchange", "spec": spec, "kind": kind, "description": description}
    out.update(fields)
    return out


# ---------------------------------------------------------------------------
# BPMN import
# ---------------------------------------------------------------------------

def bpmn_import_cases() -> list[dict]:
    cases = []

    d = "Definitions_lanes"
    xml = bpmn(d, f"""<bpmn:process id="Process_1" name="Claim handling" isExecutable="true">
<bpmn:documentation>Handles a claim.</bpmn:documentation>
<bpmn:laneSet id="LaneSet_1">
<bpmn:lane id="Lane_clerk" name="Clerk"><bpmn:flowNodeRef>Task_review</bpmn:flowNodeRef><bpmn:flowNodeRef>Task_file</bpmn:flowNodeRef></bpmn:lane>
<bpmn:lane id="Lane_assistant" name="Assistant" awa:actorType="ai_agent"><bpmn:flowNodeRef>Task_summarise</bpmn:flowNodeRef></bpmn:lane>
</bpmn:laneSet>
<bpmn:startEvent id="Start" name="Claim received"/>
<bpmn:serviceTask id="Task_summarise" name="Summarise claim" awa:actorType="ai_agent"><bpmn:documentation>Write a short summary.</bpmn:documentation></bpmn:serviceTask>
<bpmn:userTask id="Task_review" name="Review claim"/>
<bpmn:manualTask id="Task_file" name="File paper copy"/>
<bpmn:scriptTask id="Task_score" name="Score claim" scriptFormat="python"><bpmn:script>score = 1</bpmn:script></bpmn:scriptTask>
<bpmn:task id="Task_note" name="Note outcome"/>
<bpmn:scriptTask id="Task_legacy" name="Legacy step" scriptFormat="groovy"><bpmn:script>println 'x'</bpmn:script></bpmn:scriptTask>
<bpmn:endEvent id="End" name="Done"/>
{flows(("F1", "Start", "Task_summarise"), ("F2", "Task_summarise", "Task_review"), ("F3", "Task_review", "Task_file"),
       ("F4", "Task_file", "Task_score"), ("F5", "Task_score", "Task_note"), ("F6", "Task_note", "Task_legacy"),
       ("F7", "Task_legacy", "End"))}
</bpmn:process>
<bpmndi:BPMNDiagram id="Diagram_1" xmlns:bpmndi="http://www.omg.org/spec/BPMN/20100524/DI"><bpmndi:BPMNPlane id="Plane_1" bpmnElement="Process_1"/></bpmndi:BPMNDiagram>""")
    clerk, assistant = aid(d, "Lane_clerk"), aid(d, "Lane_assistant")
    app, human = default_role(d, "Process_1", "application"), default_role(d, "Process_1", "human")
    cases.append(case("bpmn-tasks-lanes-and-roles", "27.3", "import_bpmn",
                      "Task types give actor types, awa:actorType marks an AI agent's task, lanes are roles, and activities outside every lane get a role per actor type. A diagram is ignored.",
                      bpmn=xml, expect={"documents": [workflow(d, "Process_1", "Claim handling", description="Handles a claim.",
        roles=[{"id": clerk, "name": "Clerk", "actor_type": "human"}, {"id": assistant, "name": "Assistant", "actor_type": "ai_agent"}, app, human],
        activities=[
            act(d, "Task_summarise", "Summarise claim", assistant, "ai_agent", description="Write a short summary."),
            act(d, "Task_review", "Review claim", clerk, "human"),
            act(d, "Task_file", "File paper copy", clerk, "human"),
            act(d, "Task_score", "Score claim", app["id"], "application",
                programs=[{"id": aid(d, "Task_score", "#script"), "name": "Score claim", "language": "python", "code": "score = 1"}]),
            act(d, "Task_note", "Note outcome", human["id"], "human"),
            act(d, "Task_legacy", "Legacy step", app["id"], "application", procedure="println 'x'"),
        ],
        edges=[edge(d, "F1", "Start", "Task_summarise"), edge(d, "F2", "Task_summarise", "Task_review"), edge(d, "F3", "Task_review", "Task_file"),
               edge(d, "F4", "Task_file", "Task_score"), edge(d, "F5", "Task_score", "Task_note"), edge(d, "F6", "Task_note", "Task_legacy"),
               edge(d, "F7", "Task_legacy", "End")],
        events=[ev(d, "Start", "Claim received", "start"), ev(d, "End", "Done", "end")])]}))

    d = "Definitions_xor"
    xml = bpmn(d, f"""<bpmn:process id="P" name="Order routing">
<bpmn:startEvent id="S"/>
<bpmn:serviceTask id="T_check" name="Check order"/>
<bpmn:exclusiveGateway id="G" name="Value?" default="F_std"/>
<bpmn:userTask id="T_approve" name="Approve"/>
<bpmn:serviceTask id="T_vip" name="VIP handling"/>
<bpmn:serviceTask id="T_std" name="Standard"/>
<bpmn:endEvent id="E"/>
{flows(("F1", "S", "T_check"), ("F2", "T_check", "G"),
       ("F_big", "G", "T_approve", ' name="big"', cond("amount &gt; 1000 and not(flagged)")),
       ("F_vip", "G", "T_vip", "", cond("${tier == 'gold'}", None)),
       ("F_std", "G", "T_std"), ("F_a", "T_approve", "E"), ("F_v", "T_vip", "E"), ("F_s", "T_std", "E"))}
</bpmn:process>""")
    app, human = default_role(d, "P", "application"), default_role(d, "P", "human")
    cases.append(case("bpmn-exclusive-gateway-after-a-task", "27.4", "import_bpmn",
                      "An exclusive gateway right after a task is the task's routing: its flows leave the task, FEEL and tool conditions become AWA conditions, and its default is the task's default edge.",
                      bpmn=xml, expect={"documents": [workflow(d, "P", "Order routing", roles=[app, human],
        activities=[act(d, "T_check", "Check order", app["id"], "application"), act(d, "T_approve", "Approve", human["id"], "human"),
                    act(d, "T_vip", "VIP handling", app["id"], "application"), act(d, "T_std", "Standard", app["id"], "application")],
        edges=[edge(d, "F1", "S", "T_check"),
               edge(d, "F_big", "T_check", "T_approve", condition="amount > 1000 && !flagged", label="big"),
               edge(d, "F_vip", "T_check", "T_vip", condition='tier == "gold"'),
               edge(d, "F_std", "T_check", "T_std", is_default=True),
               edge(d, "F_a", "T_approve", "E"), edge(d, "F_v", "T_vip", "E"), edge(d, "F_s", "T_std", "E")],
        events=[ev(d, "S", "S", "start"), ev(d, "E", "E", "end")])]}))

    d = "Definitions_and"
    xml = bpmn(d, f"""<bpmn:collaboration id="C"><bpmn:participant id="Pool" name="Parallel checks" processRef="P"/></bpmn:collaboration>
<bpmn:process id="P">
<bpmn:startEvent id="S"/>
<bpmn:parallelGateway id="Gs" name="Split"/>
<bpmn:serviceTask id="T_a" name="Check identity"/>
<bpmn:serviceTask id="T_b" name="Check credit"/>
<bpmn:parallelGateway id="Gj"/>
<bpmn:serviceTask id="T_c" name="Decide"/>
<bpmn:endEvent id="E"/>
{flows(("F1", "S", "Gs"), ("F2", "Gs", "T_a"), ("F3", "Gs", "T_b"), ("F4", "T_a", "Gj"), ("F5", "T_b", "Gj"), ("F6", "Gj", "T_c"), ("F7", "T_c", "E"))}
</bpmn:process>""")
    app = default_role(d, "P", "application")
    cases.append(case("bpmn-parallel-gateways", "27.4", "import_bpmn",
                      "A diverging parallel gateway is an intermediate event that splits; a converging one before a task is that task's join \"all\". An unnamed process takes its participant's name.",
                      bpmn=xml, expect={"documents": [workflow(d, "P", "Parallel checks", roles=[app],
        activities=[act(d, "T_a", "Check identity", app["id"], "application"), act(d, "T_b", "Check credit", app["id"], "application"),
                    act(d, "T_c", "Decide", app["id"], "application", join="all")],
        edges=[edge(d, "F1", "S", "Gs"), edge(d, "F2", "Gs", "T_a"), edge(d, "F3", "Gs", "T_b"), edge(d, "F4", "T_a", "T_c"),
               edge(d, "F5", "T_b", "T_c"), edge(d, "F7", "T_c", "E")],
        events=[ev(d, "S", "S", "start"), ev(d, "Gs", "Split", "intermediate", **{"bpmn:gateway": "parallel"}), ev(d, "E", "E", "end")])]}))

    d = "Definitions_or"
    xml = bpmn(d, f"""<bpmn:process id="P" name="Claim checks">
<bpmn:startEvent id="S"/>
<bpmn:serviceTask id="T_in" name="Assess"/>
<bpmn:inclusiveGateway id="G" name="Which checks?" default="F_none"/>
<bpmn:serviceTask id="T_med" name="Medical check"/>
<bpmn:serviceTask id="T_veh" name="Vehicle check"/>
<bpmn:serviceTask id="T_none" name="Basic check"/>
<bpmn:inclusiveGateway id="J" name="Checks done"/>
<bpmn:serviceTask id="T_out" name="Decide"/>
<bpmn:endEvent id="E"/>
{flows(("F1", "S", "T_in"), ("F2", "T_in", "G"),
       ("F_med", "G", "T_med", ' name="injury"', cond("injury = true")),
       ("F_veh", "G", "T_veh", "", cond("vehicle_damage = true")),
       ("F_none", "G", "T_none"),
       ("F_m", "T_med", "J"), ("F_v", "T_veh", "J"), ("F_n", "T_none", "J"), ("F_o", "J", "T_out"), ("F_e", "T_out", "E"))}
</bpmn:process>""")
    app = default_role(d, "P", "application")
    guard = lambda f, label: ev(d, "G", f"Which checks?: {label}", "intermediate") | {"id": aid(d, "G", f"#guard:{f}")}
    merge = lambda f, label: ev(d, "J", f"Checks done: {label}", "intermediate") | {"id": aid(d, "J", f"#merge:{f}")}
    gen = lambda base, suffix, source, target, **extra: {"id": aid(d, base, suffix), "source_id": source, "target_id": target, **extra}
    g_med, g_veh, g_none = aid(d, "G", "#guard:F_med"), aid(d, "G", "#guard:F_veh"), aid(d, "G", "#guard:F_none")
    m_med, m_veh, m_none = aid(d, "J", "#merge:F_med"), aid(d, "J", "#merge:F_veh"), aid(d, "J", "#merge:F_none")
    cases.append(case("bpmn-inclusive-gateway", "27.4", "import_bpmn",
                      "An inclusive split becomes a parallel split into guards that take or skip their branch, and every branch meets the matching join through a merge, so the join waits for exactly one token per branch.",
                      bpmn=xml, expect={"documents": [workflow(d, "P", "Claim checks", roles=[app],
        activities=[act(d, "T_in", "Assess", app["id"], "application"), act(d, "T_med", "Medical check", app["id"], "application"),
                    act(d, "T_veh", "Vehicle check", app["id"], "application"), act(d, "T_none", "Basic check", app["id"], "application"),
                    act(d, "T_out", "Decide", app["id"], "application")],
        edges=[edge(d, "F1", "S", "T_in"), edge(d, "F2", "T_in", "G"),
               {"id": aid(d, "F_med"), "source_id": g_med, "target_id": aid(d, "T_med"), "condition": "injury == true", "label": "injury"},
               {"id": aid(d, "F_veh"), "source_id": g_veh, "target_id": aid(d, "T_veh"), "condition": "vehicle_damage == true"},
               {"id": aid(d, "F_none"), "source_id": g_none, "target_id": aid(d, "T_none"), "condition": "!(injury == true) && !(vehicle_damage == true)"},
               {"id": aid(d, "F_m"), "source_id": aid(d, "T_med"), "target_id": m_med},
               {"id": aid(d, "F_v"), "source_id": aid(d, "T_veh"), "target_id": m_veh},
               {"id": aid(d, "F_n"), "source_id": aid(d, "T_none"), "target_id": m_none},
               edge(d, "F_o", "J", "T_out"), edge(d, "F_e", "T_out", "E"),
               gen("J", "#merged:F_med", m_med, aid(d, "J")), gen("J", "#merged:F_veh", m_veh, aid(d, "J")), gen("J", "#merged:F_none", m_none, aid(d, "J")),
               gen("G", "#branch:F_med", aid(d, "G"), g_med), gen("G", "#skip:F_med", g_med, m_med, is_default=True),
               gen("G", "#branch:F_veh", aid(d, "G"), g_veh), gen("G", "#skip:F_veh", g_veh, m_veh, is_default=True),
               gen("G", "#branch:F_none", aid(d, "G"), g_none), gen("G", "#skip:F_none", g_none, m_none, is_default=True)],
        events=[ev(d, "S", "S", "start"), ev(d, "G", "Which checks?", "intermediate", **{"bpmn:gateway": "inclusive"}),
                guard("F_med", "injury"), guard("F_veh", "F_veh"), guard("F_none", "F_none"),
                ev(d, "J", "Checks done", "intermediate", join="all", **{"bpmn:gateway": "inclusive"}),
                merge("F_med", "injury"), merge("F_veh", "F_veh"), merge("F_none", "F_none"),
                ev(d, "E", "E", "end")])]}))

    d = "Definitions_ebg"
    xml = bpmn(d, f"""<bpmn:message id="Msg_order" name="order.placed"/>
<bpmn:message id="Msg_pay" name="payment.received"/>
<bpmn:process id="P" name="Payment">
<bpmn:startEvent id="S" name="Order placed"><bpmn:messageEventDefinition id="MED_1" messageRef="Msg_order"/></bpmn:startEvent>
<bpmn:serviceTask id="T_req" name="Request payment"/>
<bpmn:eventBasedGateway id="EBG"/>
<bpmn:intermediateCatchEvent id="C_pay" name="Payment received"><bpmn:messageEventDefinition id="MED_2" messageRef="Msg_pay"/></bpmn:intermediateCatchEvent>
<bpmn:intermediateCatchEvent id="C_to" name="Two days"><bpmn:timerEventDefinition id="TED_1"><bpmn:timeDuration xsi:type="bpmn:tFormalExpression">P2D</bpmn:timeDuration></bpmn:timerEventDefinition></bpmn:intermediateCatchEvent>
<bpmn:serviceTask id="T_ship" name="Ship"/>
<bpmn:serviceTask id="T_cancel" name="Cancel order"/>
<bpmn:endEvent id="E1"/>
<bpmn:endEvent id="E2"/>
{flows(("F1", "S", "T_req"), ("F2", "T_req", "EBG"), ("F3", "EBG", "C_pay"), ("F4", "EBG", "C_to"),
       ("F5", "C_pay", "T_ship"), ("F6", "C_to", "T_cancel"), ("F7", "T_ship", "E1"), ("F8", "T_cancel", "E2"))}
</bpmn:process>""")
    app = default_role(d, "P", "application")
    cases.append(case("bpmn-event-based-gateway-is-a-wait-with-a-timeout", "27.5", "import_bpmn",
                      "An event-based gateway before one message and one timer is one AWA wait whose timeout takes the timer's path. A message start event names the business event that starts a run.",
                      bpmn=xml, expect={"documents": [workflow(d, "P", "Payment", roles=[app],
        activities=[act(d, "T_req", "Request payment", app["id"], "application"), act(d, "T_ship", "Ship", app["id"], "application"),
                    act(d, "T_cancel", "Cancel order", app["id"], "application")],
        edges=[edge(d, "F1", "S", "T_req"), edge(d, "F2", "T_req", "C_pay"), edge(d, "F5", "C_pay", "T_ship"), edge(d, "F6", "C_pay", "T_cancel"),
               edge(d, "F7", "T_ship", "E1"), edge(d, "F8", "T_cancel", "E2")],
        events=[ev(d, "S", "Order placed", "start", event_definition={"name": "order.placed"}),
                ev(d, "C_pay", "Payment received", "message", event_definition={"name": "payment.received", "timeout": "P2D", "timeout_edge_id": aid(d, "F6")}),
                ev(d, "E1", "E1", "end"), ev(d, "E2", "E2", "end")])]}))

    d = "Definitions_events"
    xml = bpmn(d, f"""<bpmn:message id="Msg_q" name="quote.sent"/>
<bpmn:message id="Msg_a" name="quote.answered"/>
<bpmn:message id="Msg_done" name="quote.done"/>
<bpmn:signal id="Sig" name="quote.closed"/>
<bpmn:error id="Err_1" name="Quote expired" errorCode="QUOTE_EXPIRED"/>
<bpmn:process id="P" name="Quote">
<bpmn:startEvent id="S"/>
<bpmn:sendTask id="T_send" name="Send quote" messageRef="Msg_q"/>
<bpmn:receiveTask id="R" name="Wait for answer" messageRef="Msg_a"/>
<bpmn:boundaryEvent id="B" attachedToRef="R"><bpmn:timerEventDefinition id="TED_b"><bpmn:timeDuration xsi:type="bpmn:tFormalExpression">P3D</bpmn:timeDuration></bpmn:timerEventDefinition></bpmn:boundaryEvent>
<bpmn:intermediateThrowEvent id="Th" name="Close quote"><bpmn:signalEventDefinition id="SED_1" signalRef="Sig"/></bpmn:intermediateThrowEvent>
<bpmn:intermediateCatchEvent id="W" name="Cool-off"><bpmn:timerEventDefinition id="TED_w"><bpmn:timeDuration xsi:type="bpmn:tFormalExpression">PT1H</bpmn:timeDuration></bpmn:timerEventDefinition></bpmn:intermediateCatchEvent>
<bpmn:endEvent id="E" name="Done"><bpmn:messageEventDefinition id="MED_e" messageRef="Msg_done"/></bpmn:endEvent>
<bpmn:endEvent id="Err" name="Expired"><bpmn:errorEventDefinition id="EED_1" errorRef="Err_1"/></bpmn:endEvent>
{flows(("F1", "S", "T_send"), ("F2", "T_send", "R"), ("F3", "R", "Th"), ("F4", "Th", "W"), ("F5", "W", "E"), ("F_b", "B", "Err"))}
</bpmn:process>""")
    cases.append(case("bpmn-events-send-and-receive-tasks", "27.5", "import_bpmn",
                      "Send and receive tasks are message events that publish and wait; a timer on a receive task is the wait's timeout; signal and message throw events publish; a message end event publishes; an error end event is an AWA error event.",
                      bpmn=xml, expect={"documents": [workflow(d, "P", "Quote", activities=[],
        edges=[edge(d, "F1", "S", "T_send"), edge(d, "F2", "T_send", "R"), edge(d, "F3", "R", "Th"), edge(d, "F4", "Th", "W"),
               edge(d, "F5", "W", "E"), edge(d, "F_b", "R", "Err")],
        events=[ev(d, "S", "S", "start"),
                ev(d, "T_send", "Send quote", "message", event_definition={"name": "quote.sent", "mode": "publish"}),
                ev(d, "R", "Wait for answer", "message", event_definition={"name": "quote.answered", "timeout": "P3D", "timeout_edge_id": aid(d, "F_b")}),
                ev(d, "Th", "Close quote", "signal", event_definition={"name": "quote.closed", "mode": "publish"}),
                ev(d, "W", "Cool-off", "timer", event_definition={"duration": "PT1H"}),
                ev(d, "E", "Done", "message", event_definition={"name": "quote.done", "mode": "publish"}),
                ev(d, "Err", "Expired", "error", event_definition={"name": "QUOTE_EXPIRED"})])]}))

    d = "Definitions_brt"
    dd = "Definitions_risk"
    xml = bpmn(d, f"""<bpmn:process id="P" name="Risk">
<bpmn:startEvent id="S"/>
<bpmn:serviceTask id="T_collect" name="Collect facts"/>
<bpmn:businessRuleTask id="BR" name="Assess risk" camunda:decisionRef="Decision_risk"/>
<bpmn:exclusiveGateway id="G" name="Risk?" default="F_auto"/>
<bpmn:userTask id="T_manual" name="Manual review"/>
<bpmn:serviceTask id="T_auto" name="Automatic approval"/>
<bpmn:endEvent id="E"/>
{flows(("F1", "S", "T_collect"), ("F2", "T_collect", "BR"), ("F3", "BR", "G"),
       ("F_manual", "G", "T_manual", "", cond('risk = "high"')), ("F_auto", "G", "T_auto"), ("F6", "T_manual", "E"), ("F7", "T_auto", "E"))}
</bpmn:process>""", ' xmlns:camunda="http://camunda.org/schema/1.0/bpmn"')
    table_xml = dmn(dd, """<decision id="Decision_risk" name="Risk">
<decisionTable id="DT" hitPolicy="FIRST">
<input id="I1" label="Amount"><inputExpression id="IE1" typeRef="number"><text>amount</text></inputExpression></input>
<input id="I2"><inputExpression id="IE2" typeRef="string"><text>country</text></inputExpression><inputValues id="IV2"><text>"FR","DE"</text></inputValues></input>
<output id="O1" name="risk" typeRef="string"><outputValues id="OV1"><text>"high","low"</text></outputValues></output>
<rule id="R1"><inputEntry id="R1I1"><text>&gt;= 10000</text></inputEntry><inputEntry id="R1I2"><text>-</text></inputEntry><outputEntry id="R1O1"><text>"high"</text></outputEntry></rule>
<rule id="R2"><inputEntry id="R2I1"><text>[1000..10000)</text></inputEntry><inputEntry id="R2I2"><text>not("FR")</text></inputEntry><outputEntry id="R2O1"><text>"high"</text></outputEntry></rule>
<rule id="R3"><inputEntry id="R3I1"><text>-</text></inputEntry><inputEntry id="R3I2"><text></text></inputEntry><outputEntry id="R3O1"><text>"low"</text></outputEntry></rule>
</decisionTable>
</decision>""")
    app, human = default_role(d, "P", "application"), default_role(d, "P", "human")
    risk_table = {"hit_policy": "first",
                  "inputs": [{"name": "amount", "label": "Amount", "type": "number"},
                             {"name": "country", "type": "string", "allowed_values": ["FR", "DE"]}],
                  "outputs": [{"name": "risk", "type": "string", "allowed_values": ["high", "low"]}],
                  "rules": [{"input_entries": [">= 10000", "-"], "output_entries": ["high"]},
                            {"input_entries": ["[1000..10000)", 'not("FR")'], "output_entries": ["high"]},
                            {"input_entries": ["-", "-"], "output_entries": ["low"]}]}
    cases.append(case("bpmn-business-rule-task-with-its-dmn-decision", "27.6", "import_bpmn",
                      "A business rule task names its DMN decision (here with Camunda's attribute) and becomes a decision node with the decision's table. The gateway after it reads the decision's output and stays a gateway.",
                      bpmn=xml, dmn=[table_xml], expect={"documents": [workflow(d, "P", "Risk", roles=[app, human],
        activities=[act(d, "T_collect", "Collect facts", app["id"], "application"), act(d, "T_manual", "Manual review", human["id"], "human"),
                    act(d, "T_auto", "Automatic approval", app["id"], "application")],
        edges=[edge(d, "F1", "S", "T_collect"), edge(d, "F2", "T_collect", "BR"), edge(d, "F3", "BR", "G"),
               edge(d, "F_manual", "G", "T_manual", condition='risk == "high"'), edge(d, "F_auto", "G", "T_auto", is_default=True),
               edge(d, "F6", "T_manual", "E"), edge(d, "F7", "T_auto", "E")],
        events=[ev(d, "S", "S", "start"), ev(d, "G", "Risk?", "intermediate", **{"bpmn:gateway": "exclusive"}), ev(d, "E", "E", "end")],
        decision_nodes=[{"id": aid(d, "BR"), "name": "Assess risk", "decision_table": risk_table, "default_output_edge_id": aid(d, "F3")}])]}))

    cases.append(case("bpmn-business-rule-task-without-its-decision", "27.6", "import_bpmn",
                      "Without the DMN document, the business rule task is decided by an external decision engine named dmn, with one option per outgoing flow.",
                      bpmn=xml, expect={"documents": [workflow(d, "P", "Risk", roles=[app, human],
        activities=[act(d, "T_collect", "Collect facts", app["id"], "application"), act(d, "T_manual", "Manual review", human["id"], "human"),
                    act(d, "T_auto", "Automatic approval", app["id"], "application")],
        edges=[edge(d, "F1", "S", "T_collect"), edge(d, "F2", "T_collect", "BR"), edge(d, "F3", "BR", "G"),
               edge(d, "F_manual", "G", "T_manual", condition='risk == "high"'), edge(d, "F_auto", "G", "T_auto", is_default=True),
               edge(d, "F6", "T_manual", "E"), edge(d, "F7", "T_auto", "E")],
        events=[ev(d, "S", "S", "start"), ev(d, "G", "Risk?", "intermediate", **{"bpmn:gateway": "exclusive"}), ev(d, "E", "E", "end")],
        decision_nodes=[{"id": aid(d, "BR"), "name": "Assess risk",
                         "decision_engine": {"name": "dmn", "ruleset": "Decision_risk", "options": [{"id": "F3", "output_edge_id": aid(d, "F3")}]},
                         "default_output_edge_id": aid(d, "F3")}])]}))

    d = "Definitions_sub"
    xml = bpmn(d, f"""<bpmn:process id="P_main" name="Claim">
<bpmn:startEvent id="S"/>
<bpmn:subProcess id="SP" name="Collect documents">
<bpmn:startEvent id="S2"/>
<bpmn:userTask id="T_upload" name="Upload documents"/>
<bpmn:endEvent id="E2"/>
{flows(("G1", "S2", "T_upload"), ("G2", "T_upload", "E2"))}
</bpmn:subProcess>
<bpmn:callActivity id="CA" name="Run checks" calledElement="P_check"/>
<bpmn:endEvent id="E"/>
{flows(("F1", "S", "SP"), ("F2", "SP", "CA"), ("F3", "CA", "E"))}
</bpmn:process>
<bpmn:process id="P_check" name="Checks">
<bpmn:startEvent id="S3"/>
<bpmn:serviceTask id="T_check" name="Check"/>
<bpmn:endEvent id="E3"/>
{flows(("H1", "S3", "T_check"), ("H2", "T_check", "E3"))}
</bpmn:process>""")
    main_app = default_role(d, "P_main", "application")
    cases.append(case("bpmn-subprocess-and-call-activity", "27.3", "import_bpmn",
                      "An embedded subprocess and a call activity are expandable activities. The subprocess's content is a workflow of its own; the call activity names the process it calls. Processes come first, then subprocesses.",
                      bpmn=xml, expect={"documents": [
        workflow(d, "P_main", "Claim", roles=[main_app],
                 activities=[act(d, "SP", "Collect documents", main_app["id"], "application", is_expandable=True, expansion_workflow_id=aid(d, "SP", "#workflow")),
                             act(d, "CA", "Run checks", main_app["id"], "application", is_expandable=True, expansion_workflow_id=aid(d, "P_check"))],
                 edges=[edge(d, "F1", "S", "SP"), edge(d, "F2", "SP", "CA"), edge(d, "F3", "CA", "E")],
                 events=[ev(d, "S", "S", "start"), ev(d, "E", "E", "end")]),
        workflow(d, "P_check", "Checks", roles=[default_role(d, "P_check", "application")],
                 activities=[act(d, "T_check", "Check", default_role(d, "P_check", "application")["id"], "application")],
                 edges=[edge(d, "H1", "S3", "T_check"), edge(d, "H2", "T_check", "E3")],
                 events=[ev(d, "S3", "S3", "start"), ev(d, "E3", "E3", "end")]),
        {"id": aid(d, "SP", "#workflow"), "name": "Collect documents", "version": "1.0.0", "awa_version": "1.1",
         "parent_workflow_id": aid(d, "P_main"), "expansion_activity_id": aid(d, "SP"),
         "roles": [default_role(d, "P_main", "human")],
         "activities": [act(d, "T_upload", "Upload documents", default_role(d, "P_main", "human")["id"], "human")],
         "edges": [edge(d, "G1", "S2", "T_upload"), edge(d, "G2", "T_upload", "E2")],
         "events": [ev(d, "S2", "S2", "start"), ev(d, "E2", "E2", "end")]}]}))

    d = "Definitions_data"
    xml = bpmn(d, f"""<bpmn:process id="P" name="Assessment">
<bpmn:dataObject id="DO_claim"/>
<bpmn:dataObjectReference id="DOR_claim" name="Claim form" dataObjectRef="DO_claim"/>
<bpmn:dataObject id="DO_report"/>
<bpmn:dataObjectReference id="DOR_report" name="Report" dataObjectRef="DO_report"/>
<bpmn:userTask id="T" name="Assess">
<bpmn:ioSpecification id="IO"><bpmn:dataInput id="DI_policy" name="policy"><bpmn:documentation>The policy in force</bpmn:documentation></bpmn:dataInput><bpmn:inputSet id="IS"><bpmn:dataInputRefs>DI_policy</bpmn:dataInputRefs></bpmn:inputSet><bpmn:outputSet id="OS"/></bpmn:ioSpecification>
<bpmn:dataInputAssociation id="DIA"><bpmn:sourceRef>DOR_claim</bpmn:sourceRef><bpmn:targetRef>DI_policy</bpmn:targetRef></bpmn:dataInputAssociation>
<bpmn:dataOutputAssociation id="DOA"><bpmn:targetRef>DOR_report</bpmn:targetRef></bpmn:dataOutputAssociation>
</bpmn:userTask>
</bpmn:process>""")
    human = default_role(d, "P", "human")
    cases.append(case("bpmn-data-objects", "27.3", "import_bpmn",
                      "Data inputs and outputs of a task, and data objects joined to it by data associations, are the activity's inputs and outputs.",
                      bpmn=xml, expect={"documents": [workflow(d, "P", "Assessment", roles=[human],
        activities=[act(d, "T", "Assess", human["id"], "human",
                        inputs=[{"name": "policy", "description": "The policy in force"}, {"name": "Claim form"}], outputs=[{"name": "Report"}])],
        edges=[])]}))

    d = "Definitions_comp"
    xml = bpmn(d, f"""<bpmn:process id="P" name="Booking">
<bpmn:startEvent id="S"/>
<bpmn:serviceTask id="T_book" name="Book hotel"/>
<bpmn:serviceTask id="T_pay" name="Charge card"/>
<bpmn:serviceTask id="T_cancel" name="Cancel hotel" isForCompensation="true"/>
<bpmn:boundaryEvent id="B" attachedToRef="T_book"><bpmn:compensateEventDefinition id="CED"/></bpmn:boundaryEvent>
<bpmn:endEvent id="E"/>
{flows(("F1", "S", "T_book"), ("F2", "T_book", "T_pay"), ("F3", "T_pay", "E"))}
<bpmn:association id="A" sourceRef="B" targetRef="T_cancel" associationDirection="One"/>
</bpmn:process>""")
    app = default_role(d, "P", "application")
    cases.append(case("bpmn-compensation-handler", "27.5", "import_bpmn",
                      "A compensation boundary event associated with another activity names that activity as the compensation handler.",
                      bpmn=xml, expect={"documents": [workflow(d, "P", "Booking", roles=[app],
        activities=[act(d, "T_book", "Book hotel", app["id"], "application", compensation={"activity_id": aid(d, "T_cancel")}),
                    act(d, "T_pay", "Charge card", app["id"], "application"), act(d, "T_cancel", "Cancel hotel", app["id"], "application")],
        edges=[edge(d, "F1", "S", "T_book"), edge(d, "F2", "T_book", "T_pay"), edge(d, "F3", "T_pay", "E")],
        events=[ev(d, "S", "S", "start"), ev(d, "E", "E", "end")])]}))
    return cases


def bpmn_refusal_cases() -> list[dict]:
    def process(body: str, extra: str = "") -> str:
        return bpmn("Definitions_refused", f'{extra}<bpmn:process id="P" name="Refused">\n{body}\n</bpmn:process>')

    simple_tail = flows(("F1", "S", "T"), ("F2", "T", "E"))
    refusals = [
        ("complex-gateway", "27.8", process('<bpmn:startEvent id="S"/><bpmn:complexGateway id="G1"/><bpmn:endEvent id="E"/>' + flows(("F1", "S", "G1"), ("F2", "G1", "E"))),
         'complexGateway "G1"', "A complex gateway's activation rule has no AWA counterpart."),
        ("transaction", "27.8", process('<bpmn:transaction id="TX" name="Pay"/>'), 'transaction "TX"', "AWA has no transactions."),
        ("terminate-end-event", "27.8", process('<bpmn:startEvent id="S"/><bpmn:endEvent id="E"><bpmn:terminateEventDefinition id="TD"/></bpmn:endEvent>' + flows(("F1", "S", "E"))),
         'endEvent "E".*terminate', "A terminate end event ends every branch; an AWA end event completes one token."),
        ("error-boundary-event", "27.8", process('<bpmn:startEvent id="S"/><bpmn:serviceTask id="T"/><bpmn:boundaryEvent id="B" attachedToRef="T"><bpmn:errorEventDefinition id="EED"/></bpmn:boundaryEvent><bpmn:endEvent id="E"/><bpmn:endEvent id="E2"/>' + simple_tail + flows(("F3", "B", "E2"))),
         'boundaryEvent "B".*error routing', "AWA has no error routing."),
        ("timer-at-a-date", "27.8", process('<bpmn:startEvent id="S"/><bpmn:intermediateCatchEvent id="W"><bpmn:timerEventDefinition id="TD"><bpmn:timeDate xsi:type="bpmn:tFormalExpression">2030-01-01T00:00:00Z</bpmn:timeDate></bpmn:timerEventDefinition></bpmn:intermediateCatchEvent><bpmn:endEvent id="E"/>' + flows(("F1", "S", "W"), ("F2", "W", "E"))),
         'intermediateCatchEvent "W".*date', "AWA timers wait for a duration."),
        ("timer-with-months", "27.8", process('<bpmn:startEvent id="S"/><bpmn:intermediateCatchEvent id="W"><bpmn:timerEventDefinition id="TD"><bpmn:timeDuration xsi:type="bpmn:tFormalExpression">P1M</bpmn:timeDuration></bpmn:timerEventDefinition></bpmn:intermediateCatchEvent><bpmn:endEvent id="E"/>' + flows(("F1", "S", "W"), ("F2", "W", "E"))),
         'intermediateCatchEvent "W".*P1M', "Months have no fixed length."),
        ("multi-instance-task", "27.8", process('<bpmn:startEvent id="S"/><bpmn:userTask id="T"><bpmn:multiInstanceLoopCharacteristics id="MI"/></bpmn:userTask><bpmn:endEvent id="E"/>' + simple_tail),
         'userTask "T".*multiple instances', "Loops and multiple instances have no AWA counterpart."),
        ("two-start-events", "27.8", process('<bpmn:startEvent id="S"/><bpmn:startEvent id="S_b"/><bpmn:serviceTask id="T"/><bpmn:endEvent id="E"/>' + simple_tail + flows(("F3", "S_b", "T"))),
         'startEvent "S_b".*one node', "A run starts at one node."),
        ("event-based-gateway-with-two-messages", "27.8", process('<bpmn:startEvent id="S"/><bpmn:eventBasedGateway id="G"/><bpmn:intermediateCatchEvent id="C1"><bpmn:messageEventDefinition id="M1"/></bpmn:intermediateCatchEvent><bpmn:intermediateCatchEvent id="C2"><bpmn:messageEventDefinition id="M2"/></bpmn:intermediateCatchEvent><bpmn:endEvent id="E"/>' + flows(("F1", "S", "G"), ("F2", "G", "C1"), ("F3", "G", "C2"), ("F4", "C1", "E"), ("F5", "C2", "E"))),
         'eventBasedGateway "G"', "An AWA wait is for one business event."),
        ("condition-with-arithmetic", "27.10", process('<bpmn:startEvent id="S"/><bpmn:exclusiveGateway id="G" default="F3"/><bpmn:serviceTask id="T"/><bpmn:endEvent id="E"/>' + flows(("F1", "S", "G"), ("F2", "G", "T", "", cond("amount * 2 &gt; 10")), ("F3", "G", "E"), ("F4", "T", "E"))),
         'sequenceFlow "F2".*amount \\* 2 > 10', "A condition with arithmetic cannot be expressed in AWA."),
        ("two-conditional-flows-leave-a-task", "27.4", process('<bpmn:startEvent id="S"/><bpmn:serviceTask id="T"/><bpmn:endEvent id="E1"/><bpmn:endEvent id="E2"/>' + flows(("F1", "S", "T"), ("F2", "T", "E1", "", cond("a = 1")), ("F3", "T", "E2", "", cond("b = 1")))),
         'serviceTask "T".*every conditional flow', "BPMN takes every conditional flow whose condition holds."),
        ("inclusive-join-without-split", "27.4", process('<bpmn:startEvent id="S"/><bpmn:parallelGateway id="G"/><bpmn:serviceTask id="A"/><bpmn:serviceTask id="B"/><bpmn:inclusiveGateway id="J"/><bpmn:endEvent id="E"/>' + flows(("F1", "S", "G"), ("F2", "G", "A"), ("F3", "G", "B"), ("F4", "A", "J"), ("F5", "B", "J"), ("F6", "J", "E"))),
         'inclusiveGateway "J"', "A converging inclusive gateway is imported only as the join of an inclusive split."),
        ("business-rule-task-with-two-flows", "27.6", process('<bpmn:startEvent id="S"/><bpmn:businessRuleTask id="BR"/><bpmn:endEvent id="E1"/><bpmn:endEvent id="E2"/>' + flows(("F1", "S", "BR"), ("F2", "BR", "E1"), ("F3", "BR", "E2"))),
         'businessRuleTask "BR"', "A business rule task with several outgoing flows would split the token."),
        ("unknown-awa-element", "27.7", process('<bpmn:startEvent id="S"><bpmn:extensionElements><awa:bogus>{}</awa:bogus></bpmn:extensionElements></bpmn:startEvent>'),
         "awa:bogus", "An importer refuses an awa: element it does not know."),
        ("awa-properties-not-json", "27.7", process('<bpmn:startEvent id="S"><bpmn:extensionElements><awa:properties>{not json</awa:properties></bpmn:extensionElements></bpmn:startEvent>'),
         "awa:properties.*not JSON", "An importer refuses an awa: element whose content is not JSON."),
        ("not-bpmn", "27.1", '<?xml version="1.0"?><notes><note>hello</note></notes>', "BPMN", "A document that is not BPMN is refused."),
    ]
    return [case(f"bpmn-refuses-{cid}", spec, "import_bpmn", description, bpmn=xml, expect={"error_matches": pattern})
            for cid, spec, xml, pattern, description in refusals]


# ---------------------------------------------------------------------------
# DMN import
# ---------------------------------------------------------------------------

def dmn_cases() -> list[dict]:
    cases = []
    d = "Definitions_entries"
    xml = dmn(d, """<decision id="Decision_terms" name="Terms">
<description>Terms of a loan.</description>
<decisionTable id="DT" hitPolicy="FIRST">
<input id="I1" label="Score"><inputExpression id="IE1" typeRef="integer"><text>score</text></inputExpression></input>
<input id="I2"><inputExpression id="IE2" typeRef="string"><text>segment</text></inputExpression></input>
<input id="I3"><inputExpression id="IE3" typeRef="date"><text>start date</text></inputExpression></input>
<output id="O1" name="rate" typeRef="double"/>
<output id="O2" name="note" label="Note" typeRef="string"/>
<rule id="R1"><description>Excellent</description><inputEntry id="a1"><text>[700..850]</text></inputEntry><inputEntry id="a2"><text>"gold","platinum"</text></inputEntry><inputEntry id="a3"><text>&gt;= date("2024-01-01")</text></inputEntry><outputEntry id="a4"><text>3.5</text></outputEntry><outputEntry id="a5"><text>"best rate"</text></outputEntry></rule>
<rule id="R2"><inputEntry id="b1"><text>]600..700[</text></inputEntry><inputEntry id="b2"><text>not("blocked")</text></inputEntry><inputEntry id="b3"><text>-</text></inputEntry><outputEntry id="b4"><text>4.5</text></outputEntry><outputEntry id="b5"><text>null</text></outputEntry></rule>
<rule id="R3"><inputEntry id="c1"><text>? &lt; 600</text></inputEntry><inputEntry id="c2"><text>starts with(?, "pro")</text></inputEntry><inputEntry id="c3"><text>not(null)</text></inputEntry><outputEntry id="c4"><text>6</text></outputEntry><outputEntry id="c5"><text>"review"</text></outputEntry></rule>
<rule id="R4"><inputEntry id="d1"><text>null</text></inputEntry><inputEntry id="d2"><text>contains(?, "x"), matches(?, "^a")</text></inputEntry><inputEntry id="d3"><text>= date("2025-06-30")</text></inputEntry><outputEntry id="d4"><text>0</text></outputEntry><outputEntry id="d5"><text>"it's"</text></outputEntry></rule>
</decisionTable>
</decision>""")
    cases.append(case("dmn-entries-types-and-outputs", "27.9", "import_dmn",
                      "A DMN decision table becomes an AWA decision table: hit policy, columns with their types, FEEL unary tests as AWA entries, FEEL literals as values.",
                      dmn=xml, expect={"decisions": [{"id": aid(d, "Decision_terms"), "name": "Terms", "description": "Terms of a loan.", "decision_table": {
                          "hit_policy": "first",
                          "inputs": [{"name": "score", "label": "Score", "type": "number"}, {"name": "segment", "type": "string"}, {"name": "start date", "type": "date"}],
                          "outputs": [{"name": "rate", "type": "number"}, {"name": "note", "label": "Note", "type": "string"}],
                          "rules": [
                              {"description": "Excellent", "input_entries": ["[700..850]", '"gold", "platinum"', '>= "2024-01-01"'], "output_entries": [3.5, "best rate"]},
                              {"input_entries": ["(600..700)", 'not("blocked")', "-"], "output_entries": [4.5, None]},
                              {"input_entries": ["< 600", 'starts with "pro"', "not null"], "output_entries": [6, "review"]},
                              {"input_entries": ["null", 'contains("x"), matches("^a")', '"2025-06-30"'], "output_entries": [0, "it's"]}]}}]}))

    d = "Definitions_priority"
    xml = dmn(d, """<decision id="Decision_p" name="Discount">
<decisionTable id="DT" hitPolicy="PRIORITY">
<input id="I1"><inputExpression id="IE1" typeRef="string"><text>tier</text></inputExpression></input>
<output id="O1" name="discount" typeRef="string"><outputValues id="OV"><text>"high","medium","none"</text></outputValues></output>
<rule id="R1"><inputEntry id="a"><text>-</text></inputEntry><outputEntry id="b"><text>"none"</text></outputEntry></rule>
<rule id="R2"><inputEntry id="c"><text>"gold"</text></inputEntry><outputEntry id="e"><text>"high"</text></outputEntry></rule>
<rule id="R3"><inputEntry id="f"><text>"silver"</text></inputEntry><outputEntry id="g"><text>"medium"</text></outputEntry></rule>
</decisionTable>
</decision>""")
    cases.append(case("dmn-priority-from-output-values", "27.9", "import_dmn",
                      "PRIORITY orders rules by their outputs' position in the output values; each rule gets the AWA priority that keeps that order.",
                      dmn=xml, expect={"decisions": [{"id": aid(d, "Decision_p"), "name": "Discount", "decision_table": {
                          "hit_policy": "priority", "inputs": [{"name": "tier", "type": "string"}],
                          "outputs": [{"name": "discount", "type": "string", "allowed_values": ["high", "medium", "none"]}],
                          "rules": [{"input_entries": ["-"], "output_entries": ["none"], "priority": 1},
                                    {"input_entries": ['"gold"'], "output_entries": ["high"], "priority": 3},
                                    {"input_entries": ['"silver"'], "output_entries": ["medium"], "priority": 2}]}}]}))

    d = "Definitions_old"
    rule = "_7a4c1e2b-3d5f-4a6b-8c9d-0e1f2a3b4c5d"
    xml = dmn(d, f"""<decision id="_0b9e7a1c-2d3e-4f50-8a6b-7c8d9e0f1a2b" name="Eligible">
<decisionTable id="DT">
<input id="I1"><inputExpression id="IE1" typeRef="number"><text>age</text></inputExpression></input>
<output id="O1" typeRef="boolean"/>
<rule id="{rule}"><inputEntry id="a"><text>&gt;= 18</text></inputEntry><outputEntry id="b"><text>true</text></outputEntry></rule>
</decisionTable>
</decision>""", namespace="http://www.omg.org/spec/DMN/20151101/dmn.xsd")
    cases.append(case("dmn-1-1-unique-by-default", "27.9", "import_dmn",
                      "DMN 1.1 is read; a table without a hit policy is UNIQUE; a single output without a name is named after the decision; identifiers _<uuid> give their UUID.",
                      dmn=xml, expect={"decisions": [{"id": "0b9e7a1c-2d3e-4f50-8a6b-7c8d9e0f1a2b", "name": "Eligible", "decision_table": {
                          "hit_policy": "unique", "inputs": [{"name": "age", "type": "number"}], "outputs": [{"name": "Eligible", "type": "boolean"}],
                          "rules": [{"id": "7a4c1e2b-3d5f-4a6b-8c9d-0e1f2a3b4c5d", "input_entries": [">= 18"], "output_entries": [True]}]}}]}))

    def table(hit: str, inp: str, entry: str, out: str = '"x"') -> str:
        return dmn("Definitions_refused", f"""<decision id="D1" name="Refused">
<decisionTable id="DT" {hit}>
<input id="I1"><inputExpression id="IE1" typeRef="number"><text>{inp}</text></inputExpression></input>
<output id="O1" name="o" typeRef="string"/>
<rule id="R1"><inputEntry id="a"><text>{entry}</text></inputEntry><outputEntry id="b"><text>{out}</text></outputEntry></rule>
</decisionTable>
</decision>""")

    for cid, xml, pattern, description in [
        ("output-order", table('hitPolicy="OUTPUT ORDER"', "a", "-"), "OUTPUT ORDER", "AWA does not sort outputs."),
        ("collect-sum", table('hitPolicy="COLLECT" aggregation="SUM"', "a", "-"), "COLLECT SUM", "AWA does not aggregate outputs."),
        ("input-path", table('hitPolicy="FIRST"', "applicant.age", "-"), "applicant\\.age", "An input names one property of the token data."),
        ("entry-with-a-name", table('hitPolicy="FIRST"', "a", "&gt; limit"), 'FEEL "> limit"', "An entry that compares with a variable is refused, quoting the expression."),
        ("entry-with-arithmetic", table('hitPolicy="FIRST"', "a", "&gt; 2 * 3"), 'FEEL "> 2 \\* 3"', "An entry with arithmetic is refused, quoting the expression."),
        ("output-expression", table('hitPolicy="FIRST"', "a", "-", "a + 1"), 'FEEL "a \\+ 1"', "An output entry that is an expression is refused."),
    ]:
        cases.append(case(f"dmn-refuses-{cid}", "27.9", "import_dmn", description, dmn=xml, expect={"error_matches": pattern}))
    return cases


# ---------------------------------------------------------------------------
# Round trips
# ---------------------------------------------------------------------------

def _u(name: str) -> str:
    return str(uuid.uuid5(INTERCHANGE_NS, f"round-trip:{name}"))


def round_trip_cases() -> list[dict]:
    u = _u
    roles = [
        {"id": u("clerk"), "name": "Clerk", "actor_type": "human", "description": "Handles claims"},
        {"id": u("agent"), "name": "Assessor", "actor_type": "ai_agent", "capabilities": ["assessment"],
         "ai_model_config": {"model_id": "tier:reasoning", "temperature": 0.2}},
        {"id": u("system"), "name": "Claims system", "actor_type": "application"},
    ]
    activities = [
        {"id": u("register"), "name": "Register", "role_id": u("system"), "actor_type": "application",
         "inputs": [{"name": "claim", "schema": {"type": "object"}}], "outputs": [{"name": "claim_id", "description": "The new claim"}],
         "retry": {"max_attempts": 3, "initial_delay": "PT1S"}, "context_bindings": [{"context_id": u("ctx"), "access_mode": "write"}]},
        {"id": u("assess"), "name": "Assess", "role_id": u("agent"), "actor_type": "ai_agent", "procedure": "Look at the photos.",
         "outcome_contract": {"postconditions": [{"name": "Positive", "expression": "cost >= 0"}], "on_violation": "escalate_human"},
         "verification": {"mode": "schema_only", "criteria": [{"id": u("crit"), "name": "Has cost", "description": "A cost is given", "type": "completeness", "expression": "cost exists"}]},
         "tools": [{"name": "price", "binding": {"kind": "http", "method": "GET", "url": "https://example.com/price"}}],
         "knowledge": {"types": ["strategy"]}, "acme:cost_centre": "C-12"},
        {"id": u("robot"), "name": "Photograph car", "role_id": u("nowhere"), "actor_type": "robot"},
        {"id": u("review"), "name": "Review", "role_id": u("clerk"), "actor_type": "human", "join": "all",
         "sla": {"target_time": "PT4H", "max_time": "P1D"}},
        {"id": u("pay"), "name": "Pay", "role_id": u("system"), "actor_type": "application", "compensation": {"activity_id": u("refund")}},
        {"id": u("refund"), "name": "Refund", "role_id": u("system"), "actor_type": "application"},
        {"id": u("sub"), "name": "Investigate", "role_id": u("clerk"), "actor_type": "human", "is_expandable": True, "expansion_workflow_id": u("other")},
        {"id": u("noop"), "name": "Note", "role_id": u("clerk"), "actor_type": "human", "is_expandable": False, "join": "any"},
    ]
    events = [
        {"id": u("start"), "name": "Claim in", "event_type": "start", "event_definition": {"name": "claim.submitted"}},
        {"id": u("wait"), "name": "Documents", "event_type": "message",
         "event_definition": {"name": "documents.uploaded", "correlation_key": "claim_id", "timeout": "P5D", "timeout_edge_id": u("e-wait-late")}},
        {"id": u("signal"), "name": "Stop", "event_type": "signal", "event_definition": {"name": "claims.stop", "mode": "wait"}},
        {"id": u("tell"), "name": "Paid", "event_type": "message", "event_definition": {"name": "claim.paid", "mode": "publish", "data": ["claim_id"]}},
        {"id": u("timer"), "name": "Cut-off", "event_type": "timer", "event_definition": {"duration": "PT1H"}},
        {"id": u("fail"), "name": "Rejected", "event_type": "error", "event_definition": {"name": "REJECTED"}},
        {"id": u("end"), "name": "Closed", "event_type": "end"},
    ]
    decisions = [
        {"id": u("route"), "name": "Route", "description": "Pick a path",
         "decision_table": {"hit_policy": "priority",
                            "inputs": [{"name": "cost", "type": "number"}, {"name": "kind", "type": "string", "allowed_values": ["car", "home"]},
                                       {"name": "on", "type": "date"}],
                            "outputs": [{"name": "path", "type": "string"}, {"name": "level", "type": "number"}],
                            "rules": [{"id": u("r1"), "description": "Big", "input_entries": ["> 1000", "car", '>= "2024-01-01"'], "output_entries": ["review", 2],
                                       "output_edge_id": u("e-route-review"), "priority": 2},
                                      {"input_entries": ["-", "in (car, home)", "-"], "output_entries": ["pay", {"a": [1, "x"]}],
                                       "output_edge_id": u("e-route-pay"), "priority": 1},
                                      {"input_entries": ["not in (\"x\", 'y\"z')", "!= car", "not null"], "output_entries": ["-10", None]}]},
         "default_output_edge_id": u("e-route-pay"),
         "decision_model": {"instructions": "Choose", "options": [{"id": "review", "description": "Look", "output_edge_id": u("e-route-review")},
                                                                 {"id": "pay", "description": "Pay", "output_edge_id": u("e-route-pay")}]}},
        {"id": u("engine"), "name": "Engine", "decision_engine": {"name": "drools", "options": [{"id": "only", "output_edge_id": u("e-engine")}]}},
    ]
    e = lambda name, source, target, **extra: {"id": u(name), "source_id": u(source), "target_id": u(target), **extra}
    edges = [
        e("e-start", "start", "register"),
        e("e-register-assess", "register", "assess", source_type="activity"),
        e("e-register-robot", "register", "robot", label="photos"),
        e("e-assess-review", "assess", "review", condition="cost > 100 && kind == car", label="costly"),
        e("e-assess-route", "assess", "route", condition="cost exists || typeof cost == number"),
        e("e-assess-default", "assess", "wait", is_default=True),
        e("e-robot-review", "robot", "review"),
        e("e-wait-review", "wait", "review"),
        e("e-wait-late", "wait", "fail", label="too late"),
        e("e-route-review", "route", "noop"),
        e("e-route-pay", "route", "pay"),
        e("e-noop-review", "noop", "review"),
        e("e-review-engine", "review", "engine", condition="!approved"),
        e("e-review-signal", "review", "signal", is_default=True),
        e("e-engine", "engine", "sub"),
        e("e-signal-timer", "signal", "timer"),
        e("e-timer-pay", "timer", "pay"),
        e("e-pay-tell", "pay", "tell"),
        e("e-tell-end", "tell", "end"),
        e("e-sub-end", "sub", "end", condition="done == true"),
        e("e-sub-fail", "sub", "fail", is_default=True),
    ]
    everything = {"$schema": "https://awa.io/schema/awa.schema.json", "id": u("workflow"), "name": "Everything", "version": "2.1.0",
                  "awa_version": "1.1", "description": "Every construct that crosses to BPMN and back", "roles": roles,
                  "activities": activities, "events": events, "decision_nodes": decisions, "edges": edges,
                  "contexts": [{"id": u("ctx"), "name": "Case file", "type": "document", "sync_pattern": "shared_state"}],
                  "sla": {"max_time": "P10D"}, "metadata": {"owner": "claims"}}
    plain = {"id": u("plain"), "name": "Plain", "version": "1.0.0",
             "activities": [{"id": u("p-a"), "name": "A", "role_id": u("p-role"), "actor_type": "human"},
                            {"id": u("p-b"), "name": "B", "role_id": u("p-role"), "actor_type": "ai_agent"}],
             "edges": [{"id": u("p-e"), "source_id": u("p-a"), "target_id": u("p-b")}],
             "events": [], "decision_nodes": []}
    return [
        case("round-trip-every-construct", "27.7", "round_trip",
             "A workflow with every construct that BPMN carries natively or in the awa: namespace: roles with model references, contexts, outcome contracts, verification, retry, tools, knowledge, joins, compensation, waits with timeouts, publishing, timers, error events, decisions with tables, models and engines, conditions FEEL can and cannot say, extension properties.",
             workflow=everything, expect={"round_trip": True}),
        case("round-trip-envelope-and-empty-lists", "27.7", "round_trip",
             "An envelope-form document, with empty lists and no roles, comes back the same.",
             workflow={"workflow": plain, "acme:note": "kept"}, expect={"round_trip": True}),
    ]


# ---------------------------------------------------------------------------
# Serverless Workflow
# ---------------------------------------------------------------------------

def serverless_workflow_cases() -> list[dict]:
    u = lambda name: str(uuid.uuid5(INTERCHANGE_NS, f"sw:{name}"))
    w = {"id": u("w"), "name": "Quote Request", "version": "1.2.0", "awa_version": "1.1", "description": "Answer a quote request.",
         "roles": [{"id": u("r"), "name": "Sales", "actor_type": "human"}],
         "activities": [
             {"id": u("price"), "name": "Price quote", "role_id": u("r"), "actor_type": "human"},
             {"id": u("check"), "name": "Check credit", "role_id": u("r"), "actor_type": "ai_agent",
              "retry": {"max_attempts": 3, "initial_delay": "PT2S"}, "verification": {"criteria": [{"id": u("crit"), "name": "ok", "description": "It is ok", "type": "accuracy", "expression": "ok"}]}},
         ],
         "events": [
             {"id": u("start"), "name": "Request in", "event_type": "start", "event_definition": {"name": "quote.requested"}},
             {"id": u("pause"), "name": "Pause", "event_type": "timer", "event_definition": {"duration": "PT1H"}},
             {"id": u("sent"), "name": "Quote sent", "event_type": "message", "event_definition": {"name": "quote.sent", "mode": "publish", "data": ["quote_id"]}},
             {"id": u("answer"), "name": "Answer", "event_type": "message",
              "event_definition": {"name": "quote.answered", "correlation_key": "quote_id", "timeout": "P7D", "timeout_edge_id": u("e-late")}},
             {"id": u("end"), "name": "Done", "event_type": "end"},
         ],
         "edges": [
             {"id": u("e1"), "source_id": u("start"), "target_id": u("price")},
             {"id": u("e2"), "source_id": u("price"), "target_id": u("check"), "condition": "amount > 1000", "label": "Large"},
             {"id": u("e3"), "source_id": u("price"), "target_id": u("pause"), "is_default": True},
             {"id": u("e4"), "source_id": u("check"), "target_id": u("pause")},
             {"id": u("e5"), "source_id": u("pause"), "target_id": u("sent")},
             {"id": u("e6"), "source_id": u("sent"), "target_id": u("answer")},
             {"id": u("e7"), "source_id": u("answer"), "target_id": u("end")},
             {"id": u("e-late"), "source_id": u("answer"), "target_id": u("end")},
         ]}
    request = lambda a, actor, role: {"request": {"emit": {"event": {"with": {
        "source": "https://awa.io", "type": "io.awa.activity.requested", "subject": u(a),
        "data": {"activity_id": u(a), "activity": {"price": "Price quote", "check": "Check credit"}[a], "actor_type": actor, "role_id": role}}}}}}
    complete = lambda a: {"complete": {"listen": {"to": {"one": {"with": {"type": "io.awa.activity.completed", "subject": u(a)}}}},
                                       "output": {"as": "${ $input + (.[0].data // .[0] // {}) }"}}}
    document = {
        "document": {"dsl": "1.0.0", "namespace": "awa", "name": "quote-request", "version": "1.2.0", "title": "Quote Request",
                     "summary": "Answer a quote request.", "metadata": {"awa_workflow_id": u("w"), "awa_version": "1.1"}},
        "schedule": {"on": {"one": {"with": {"type": "quote.requested"}}}},
        "do": [
            {"price-quote": {"do": [request("price", "human", u("r")), complete("price")], "then": "price-quote-route"}},
            {"price-quote-route": {"switch": [{"large": {"when": "${ .amount > 1000 }", "then": "check-credit"}}, {"default": {"then": "pause"}}]}},
            {"check-credit": {"try": [request("check", "ai_agent", u("r")), complete("check")],
                              "catch": {"retry": {"delay": "PT2S", "backoff": {"exponential": {}}, "limit": {"attempt": {"count": 3}}}},
                              "then": "pause"}},
            {"pause": {"wait": "PT1H", "then": "quote-sent"}},
            {"quote-sent": {"emit": {"event": {"with": {"source": "https://awa.io", "type": "quote.sent", "data": '${ {"quote_id": .quote_id} }'}}}, "then": "answer"}},
            {"answer": {"listen": {"to": {"one": {"with": {"type": "quote.answered"},
                                                   "correlate": {"key": {"from": "${ .data.quote_id }", "expect": "${ .quote_id }"}}}}},
                        "output": {"as": "${ $input + (.[0].data // .[0] // {}) }"}, "timeout": {"after": "P7D"}, "then": "end"}},
        ]}
    not_mapped = [
        {"property": "roles", "reason": "Serverless Workflow has no roles; the role of each activity is carried in the event that requests it"},
        {"node": "Check credit", "property": "verification", "reason": "Serverless Workflow has no acceptance verification of a task's output (section 7)"},
        {"node": "Answer", "property": "event_definition.timeout_edge_id", "reason": "when the wait runs out the task fails with a timeout error; the path the timeout edge takes is not followed"},
    ]
    return [case("serverless-workflow-export", "27.11", "export_serverless_workflow",
                 "Activities become a request and a wait for completion, conditions a switch in jq, retries a try, timers waits, publishing an emit, waits a listen with correlation and timeout; what does not map is listed.",
                 workflow=w, expect={"document": document, "not_mapped": not_mapped})]


# ---------------------------------------------------------------------------
# FEEL
# ---------------------------------------------------------------------------

def feel_tables() -> dict:
    return {
        "description": "FEEL translations of specification 27.10. unary: FEEL input entry to AWA entry. unary_export: AWA entry (in a column of the given type) to FEEL. conditions: BPMN condition to AWA condition. conditions_export: AWA condition to FEEL, null when it is written in AWA's language. The invalid lists must be refused.",
        "unary": [
            {"feel": "-", "awa": "-"}, {"feel": "", "awa": "-"},
            {"feel": "5", "awa": "5"}, {"feel": "-2.5", "awa": "-2.5"}, {"feel": ".5", "awa": "0.5"},
            {"feel": '"gold"', "awa": '"gold"'}, {"feel": '"say \\"hi\\""', "awa": "'say \"hi\"'"},
            {"feel": "true", "awa": "true"}, {"feel": "null", "awa": "null"}, {"feel": "not(null)", "awa": "not null"},
            {"feel": "? != null", "awa": "not null"},
            {"feel": "< 10", "awa": "< 10"}, {"feel": ">=10", "awa": ">= 10"}, {"feel": "!= 3", "awa": "!= 3"}, {"feel": "= 3", "awa": "3"},
            {"feel": "? > 2", "awa": "> 2"}, {"feel": "? = \"a\"", "awa": '"a"'},
            {"feel": "[1..5]", "awa": "[1..5]"}, {"feel": "(1..5)", "awa": "(1..5)"}, {"feel": "]1..5[", "awa": "(1..5)"}, {"feel": "[1..5[", "awa": "[1..5)"},
            {"feel": '"a", "b"', "awa": '"a", "b"'}, {"feel": "1, [5..9]", "awa": "1, [5..9]"},
            {"feel": 'not("a", "b")', "awa": 'not("a", "b")'}, {"feel": "not(< 3)", "awa": "not(< 3)"},
            {"feel": 'date("2024-01-31")', "awa": '"2024-01-31"'}, {"feel": '< date and time("2024-01-31T10:00:00Z")', "awa": '< "2024-01-31T10:00:00Z"'},
            {"feel": '[date("2024-01-01")..date("2024-12-31")]', "awa": '["2024-01-01".."2024-12-31"]'},
            {"feel": 'contains(?, "ab")', "awa": 'contains("ab")'}, {"feel": 'starts with(?, "x")', "awa": 'starts with "x"'},
            {"feel": 'ends with(?, "x")', "awa": 'ends with "x"'}, {"feel": 'matches(?, "^[0-9]+$")', "awa": 'matches("^[0-9]+$")'},
        ],
        "unary_invalid": ["> limit", "amount", "> 2 * 3", "[1, 2]", "{a: 1}", "count(?) > 1", "? > 1 and ? < 5", "upper case(?) = \"A\"",
                          '"unterminated', '"both \\" and \'"', "< null", "duration(\"P1D\")"],
        "unary_export": [
            {"awa": "-", "feel": "-"}, {"awa": "", "feel": "-"}, {"awa": "*", "feel": "-"},
            {"awa": "5", "feel": "5"}, {"awa": "gold", "feel": '"gold"'}, {"awa": "'say \"hi\"'", "feel": '"say \\"hi\\""'},
            {"awa": "true", "feel": "true"}, {"awa": "null", "feel": "null"}, {"awa": "not null", "feel": "not(null)"},
            {"awa": "== 5", "feel": "5"}, {"awa": "= 5", "feel": "5"}, {"awa": "!= 5", "feel": "not(5)"}, {"awa": "<> x", "feel": 'not("x")'},
            {"awa": ">= 10", "feel": ">= 10"}, {"awa": "[1..5)", "feel": "[1..5)"},
            {"awa": "in (a, b)", "feel": '"a", "b"'}, {"awa": "not in (1, 2)", "feel": "not(1, 2)"},
            {"awa": "1, not null", "feel": "1, ? != null"}, {"awa": "1, != 2", "feel": "1, ? != 2"}, {"awa": "3, not in (1, 2)", "feel": "3, (? != 1 and ? != 2)"},
            {"awa": "not(1, 2)", "feel": "not(1, 2)"},
            {"awa": 'contains("ab")', "feel": 'contains(?, "ab")'}, {"awa": 'starts with "x"', "feel": 'starts with(?, "x")'},
            {"awa": "ends with 'x'", "feel": 'ends with(?, "x")'}, {"awa": 'matches("^a")', "feel": 'matches(?, "^a")'},
            {"awa": '>= "2024-01-01"', "type": "date", "feel": '>= date("2024-01-01")'},
            {"awa": '"2024-01-01T10:00:00Z"', "type": "datetime", "feel": 'date and time("2024-01-01T10:00:00Z")'},
            {"awa": '"2024-01-01"', "type": "string", "feel": '"2024-01-01"'},
        ],
        "conditions": [
            {"bpmn": "amount > 1000", "awa": "amount > 1000"},
            {"bpmn": 'status = "approved"', "awa": 'status == "approved"'},
            {"bpmn": "a > 1 and (b < 2 or c = true)", "awa": "a > 1 && (b < 2 || c == true)"},
            {"bpmn": "not(flagged)", "awa": "!flagged"}, {"bpmn": "not(a = 1 or b = 2)", "awa": "!(a == 1 || b == 2)"},
            {"bpmn": "${approved}", "awa": "approved"}, {"bpmn": "#{score >= 0.5}", "awa": "score >= 0.5"},
            {"bpmn": "= order.total <= 10", "awa": "order.total <= 10"}, {"bpmn": "x === 'a' && y !== null", "awa": 'x == "a" && y != null'},
            {"bpmn": "x <> 3 || !y", "awa": "x != 3 || !y"}, {"bpmn": "count = .5", "awa": "count == 0.5"},
        ],
        "conditions_invalid": ["amount * 2 > 10", "a > b", "5 < amount", "upper(name) = \"A\"", "a >", "(a = 1", "a = 1 and", "x in [1, 2]",
                               "true", "a + 1 = 2"],
        "conditions_export": [
            {"awa": "amount > 1000", "feel": "amount > 1000"},
            {"awa": "status == approved", "feel": 'status = "approved"'},
            {"awa": "a > 1 && (b < 2 || c == true)", "feel": "a > 1 and (b < 2 or c = true)"},
            {"awa": "!(a == 1)", "feel": "not(a = 1)"}, {"awa": "x != null", "feel": "x != null"},
            {"awa": "x exists", "feel": None}, {"awa": "typeof x == string", "feel": None}, {"awa": "approved", "feel": None},
            {"awa": "a == 1 && flagged", "feel": None},
        ],
    }
