"""
A diagram (BPMNDI) for an exported BPMN document, so that modelling tools can draw it.
Columns follow the flow from left to right; each lane is a row. Informative only: an
importer ignores diagrams. Python port of sdk/typescript/src/interchange/bpmn_layout.ts.
"""

from __future__ import annotations

import xml.etree.ElementTree as ET

from awa.interchange.common import BPMN_MODEL_NAMESPACE, BPMNDI_NAMESPACE, DC_NAMESPACE, DI_NAMESPACE

COLUMN, SLOT, POOL_LABEL, LANE_LABEL, MARGIN = 170, 120, 30, 30, 40


def _q(name: str) -> str:
    return f"{{{BPMN_MODEL_NAMESPACE}}}{name}"


def _local(tag: str) -> str:
    return tag.rsplit("}", 1)[-1]


def _size(el: ET.Element) -> tuple[int, int]:
    name = _local(el.tag)
    if name.endswith("Gateway"):
        return 50, 50
    if name.endswith("Event"):
        return 36, 36
    return 100, 80


def lay_out(root: ET.Element) -> None:
    collaboration = root.find(_q("collaboration"))
    if collaboration is None:
        return
    processes = {p.get("id"): p for p in root.findall(_q("process"))}
    diagram = ET.SubElement(root, f"{{{BPMNDI_NAMESPACE}}}BPMNDiagram", {"id": f"BPMNDiagram_{collaboration.get('id')}"})
    plane = ET.SubElement(diagram, f"{{{BPMNDI_NAMESPACE}}}BPMNPlane", {"id": f"BPMNPlane_{collaboration.get('id')}", "bpmnElement": collaboration.get("id")})

    def shape(el_id: str, x: float, y: float, w: int, h: int, **attrs: str) -> None:
        s = ET.SubElement(plane, f"{{{BPMNDI_NAMESPACE}}}BPMNShape", {"id": f"{el_id}_di", "bpmnElement": el_id, **attrs})
        ET.SubElement(s, f"{{{DC_NAMESPACE}}}Bounds", {"x": str(round(x)), "y": str(round(y)), "width": str(w), "height": str(h)})

    pool_y = 0
    for participant in collaboration.findall(_q("participant")):
        process = processes.get(participant.get("processRef"))
        if process is None:
            continue
        flows = process.findall(_q("sequenceFlow"))
        children = [c for c in process if _local(c.tag) not in ("sequenceFlow", "documentation", "extensionElements", "laneSet", "association", "boundaryEvent")]
        boundaries = process.findall(_q("boundaryEvent"))
        by_id = {c.get("id"): c for c in children + boundaries}
        host = {b.get("id"): b.get("attachedToRef") for b in boundaries}
        node_of = lambda el_id: host.get(el_id, el_id)  # noqa: E731
        nodes = [c.get("id") for c in children]
        out: dict[str, list[ET.Element]] = {n: [] for n in nodes}
        for f in flows:
            out.setdefault(node_of(f.get("sourceRef")), []).append(f)

        back: set[str] = set()
        state: dict[str, int] = {}
        targets = {f.get("targetRef") for f in flows}

        def visit(n: str) -> None:
            stack = [(n, iter(out.get(n, [])))]
            state[n] = 1
            while stack:
                current, edges = stack[-1]
                advanced = False
                for f in edges:
                    t = f.get("targetRef")
                    if state.get(t) == 1:
                        back.add(f.get("id"))
                    elif t not in state:
                        state[t] = 1
                        stack.append((t, iter(out.get(t, []))))
                        advanced = True
                        break
                if not advanced:
                    state[current] = 2
                    stack.pop()

        for n in [n for n in nodes if n not in targets] + nodes:
            if n not in state:
                visit(n)

        rank = {n: 0 for n in nodes}
        for _ in range(len(nodes)):
            changed = False
            for f in flows:
                if f.get("id") in back:
                    continue
                s, t = node_of(f.get("sourceRef")), f.get("targetRef")
                r = rank.get(s, 0) + 1
                if r > rank.get(t, 0):
                    rank[t] = r
                    changed = True
            if not changed:
                break

        lane_set = process.find(_q("laneSet"))
        lanes = lane_set.findall(_q("lane")) if lane_set is not None else []
        row: dict[str, int] = {}

        def mark(lane: ET.Element, index: int) -> None:
            for ref in lane.findall(_q("flowNodeRef")):
                row[ref.text] = index
            child = lane.find(_q("childLaneSet"))
            if child is not None:
                for sub in child.findall(_q("lane")):
                    mark(sub, index)

        for i, lane in enumerate(lanes):
            mark(lane, i)
        for _ in range(3):
            for f in flows:
                s, t = node_of(f.get("sourceRef")), f.get("targetRef")
                if t not in row and s in row:
                    row[t] = row[s]
                if s not in row and t in row:
                    row[s] = row[t]
        rows = max(1, len(lanes))
        slots: dict[tuple[int, int], int] = {}
        slot_of: dict[str, int] = {}
        for n in nodes:
            key = (row.get(n, 0), rank.get(n, 0))
            slot_of[n] = slots.get(key, 0)
            slots[key] = slot_of[n] + 1
        heights = [max([1] + [v for (r, _), v in slots.items() if r == i]) * SLOT + MARGIN for i in range(rows)]
        tops = [pool_y + sum(heights[:i]) for i in range(rows)]
        columns = max([0] + [rank.get(n, 0) for n in nodes]) + 1
        width = POOL_LABEL + LANE_LABEL + MARGIN + columns * COLUMN
        pool_height = sum(heights)

        box: dict[str, tuple[float, float, int, int]] = {}
        for n in nodes:
            w, h = _size(by_id[n])
            cx = POOL_LABEL + LANE_LABEL + MARGIN + rank.get(n, 0) * COLUMN + COLUMN / 2 - MARGIN / 2
            cy = tops[row.get(n, 0)] + MARGIN / 2 + slot_of[n] * SLOT + SLOT / 2
            box[n] = (cx - w / 2, cy - h / 2, w, h)
        for i, b in enumerate(boundaries):
            hb = box.get(b.get("attachedToRef"))
            if hb:
                box[b.get("id")] = (hb[0] + hb[2] - 30 - i * 40, hb[1] + hb[3] - 18, 36, 36)

        shape(participant.get("id"), 0, pool_y, width, pool_height, isHorizontal="true")
        for i, lane in enumerate(lanes):
            shape(lane.get("id"), POOL_LABEL, tops[i], width - POOL_LABEL, heights[i], isHorizontal="true")
        for el_id, (x, y, w, h) in box.items():
            extra = {"isMarkerVisible": "true"} if _local(by_id[el_id].tag) == "exclusiveGateway" else {}
            shape(el_id, x, y, w, h, **extra)
        bottom = pool_y + pool_height - 10
        for f in flows:
            s, t = box.get(f.get("sourceRef")), box.get(f.get("targetRef"))
            if not s or not t:
                continue
            sy, ty = s[1] + s[3] / 2, t[1] + t[3] / 2
            if f.get("sourceRef") in host:
                points = [(s[0] + s[2] / 2, s[1] + s[3]), (s[0] + s[2] / 2, ty), (t[0], ty)]
            elif f.get("id") in back or t[0] <= s[0]:
                points = [(s[0] + s[2] / 2, s[1] + s[3]), (s[0] + s[2] / 2, bottom), (t[0] + t[2] / 2, bottom), (t[0] + t[2] / 2, t[1] + t[3])]
            elif abs(sy - ty) < 1:
                points = [(s[0] + s[2], sy), (t[0], ty)]
            else:
                mid = (s[0] + s[2] + t[0]) / 2
                points = [(s[0] + s[2], sy), (mid, sy), (mid, ty), (t[0], ty)]
            edge = ET.SubElement(plane, f"{{{BPMNDI_NAMESPACE}}}BPMNEdge", {"id": f"{f.get('id')}_di", "bpmnElement": f.get("id")})
            for x, y in points:
                ET.SubElement(edge, f"{{{DI_NAMESPACE}}}waypoint", {"x": str(round(x)), "y": str(round(y))})
        pool_y += pool_height + MARGIN
