/**
 * A diagram (BPMNDI) for an exported BPMN document, so that modelling tools can draw it.
 * Columns follow the flow from left to right; each lane is a row. Informative only: an
 * importer ignores diagrams.
 */
const COLUMN = 170;
const SLOT = 120;
const POOL_LABEL = 30;
const LANE_LABEL = 30;
const MARGIN = 40;

function size(el: any): { w: number; h: number } {
    const type: string = el.$type;
    if (type.endsWith('Gateway')) return { w: 50, h: 50 };
    if (type.endsWith('Event')) return { w: 36, h: 36 };
    return { w: 100, h: 80 };
}

interface Box { x: number; y: number; w: number; h: number }

export function lay_out(moddle: any, definitions: any): void {
    const collaboration = (definitions.rootElements || []).find((r: any) => r.$type === 'bpmn:Collaboration');
    if (!collaboration) return;
    const plane_elements: any[] = [];
    const bounds = (b: Box) => moddle.create('dc:Bounds', { x: Math.round(b.x), y: Math.round(b.y), width: b.w, height: b.h });
    const point = (x: number, y: number) => moddle.create('dc:Point', { x: Math.round(x), y: Math.round(y) });
    let pool_y = 0;

    for (const participant of collaboration.participants || []) {
        const process = participant.processRef;
        const elements: any[] = process.flowElements || [];
        const flows = elements.filter(e => e.$type === 'bpmn:SequenceFlow');
        const nodes = elements.filter(e => e.$type !== 'bpmn:SequenceFlow' && e.$type !== 'bpmn:BoundaryEvent');
        const boundaries = elements.filter(e => e.$type === 'bpmn:BoundaryEvent');
        const node_of = (el: any) => (el.$type === 'bpmn:BoundaryEvent' ? el.attachedToRef : el);
        const out = new Map<any, any[]>(nodes.map(n => [n, []]));
        for (const f of flows) out.get(node_of(f.sourceRef))?.push(f);

        // Back edges, found by a depth-first walk from the nodes nothing leads to
        const back = new Set<any>();
        const state = new Map<any, number>();
        const targets = new Set(flows.map(f => f.targetRef));
        const visit = (n: any) => {
            state.set(n, 1);
            for (const f of out.get(n) || []) {
                const t = f.targetRef;
                if (state.get(t) === 1) back.add(f);
                else if (!state.has(t)) visit(t);
            }
            state.set(n, 2);
        };
        for (const n of nodes.filter(n => !targets.has(n))) if (!state.has(n)) visit(n);
        for (const n of nodes) if (!state.has(n)) visit(n);

        // Longest path from a source gives the column
        const rank = new Map<any, number>(nodes.map(n => [n, 0]));
        for (let pass = 0; pass < nodes.length; pass++) {
            let changed = false;
            for (const f of flows) {
                if (back.has(f)) continue;
                const s = node_of(f.sourceRef), t = f.targetRef;
                const r = (rank.get(s) || 0) + 1;
                if (r > (rank.get(t) || 0)) { rank.set(t, r); changed = true; }
            }
            if (!changed) break;
        }

        // Rows: one per top-level lane; a node outside every lane joins a neighbour's
        const lanes: any[] = process.laneSets?.[0]?.lanes || [];
        const row = new Map<any, number>();
        const mark = (lane: any, index: number) => {
            for (const n of lane.flowNodeRef || []) row.set(n, index);
            for (const child of lane.childLaneSet?.lanes || []) mark(child, index);
        };
        lanes.forEach(mark);
        for (let pass = 0; pass < 3; pass++) {
            for (const f of flows) {
                const s = node_of(f.sourceRef), t = f.targetRef;
                if (!row.has(t) && row.has(s)) row.set(t, row.get(s)!);
                if (!row.has(s) && row.has(t)) row.set(s, row.get(t)!);
            }
        }
        const rows = Math.max(1, lanes.length);
        const slots = new Map<string, number>();
        const slot_of = new Map<any, number>();
        for (const n of nodes) {
            const key = `${row.get(n) ?? 0}:${rank.get(n)}`;
            const s = slots.get(key) || 0;
            slot_of.set(n, s);
            slots.set(key, s + 1);
        }
        const heights = Array.from({ length: rows }, (_, r) => Math.max(1, ...[...slots.entries()].filter(([k]) => Number(k.split(':')[0]) === r).map(([, v]) => v)) * SLOT + MARGIN);
        const tops = heights.map((_, r) => pool_y + heights.slice(0, r).reduce((a, b) => a + b, 0));
        const columns = Math.max(0, ...nodes.map(n => rank.get(n) || 0)) + 1;
        const width = POOL_LABEL + LANE_LABEL + MARGIN + columns * COLUMN;
        const pool_height = heights.reduce((a, b) => a + b, 0);

        const box = new Map<any, Box>();
        for (const n of nodes) {
            const { w, h } = size(n);
            const cx = POOL_LABEL + LANE_LABEL + MARGIN + (rank.get(n) || 0) * COLUMN + COLUMN / 2 - MARGIN / 2;
            const cy = tops[row.get(n) ?? 0] + MARGIN / 2 + (slot_of.get(n) || 0) * SLOT + SLOT / 2;
            box.set(n, { x: cx - w / 2, y: cy - h / 2, w, h });
        }
        boundaries.forEach((b, i) => {
            const host = box.get(b.attachedToRef);
            if (host) box.set(b, { x: host.x + host.w - 30 - i * 40, y: host.y + host.h - 18, w: 36, h: 36 });
        });

        plane_elements.push(moddle.create('bpmndi:BPMNShape', { id: `${participant.id}_di`, bpmnElement: participant, isHorizontal: true, bounds: bounds({ x: 0, y: pool_y, w: width, h: pool_height }) }));
        lanes.forEach((lane, r) => {
            plane_elements.push(moddle.create('bpmndi:BPMNShape', { id: `${lane.id}_di`, bpmnElement: lane, isHorizontal: true, bounds: bounds({ x: POOL_LABEL, y: tops[r], w: width - POOL_LABEL, h: heights[r] }) }));
        });
        for (const [el, b] of box) {
            const shape = moddle.create('bpmndi:BPMNShape', { id: `${el.id}_di`, bpmnElement: el, bounds: bounds(b) });
            if (el.$type === 'bpmn:ExclusiveGateway') shape.isMarkerVisible = true;
            plane_elements.push(shape);
        }
        const bottom = pool_y + pool_height - 10;
        for (const f of flows) {
            const s = box.get(f.sourceRef), t = box.get(f.targetRef);
            if (!s || !t) continue;
            const sy = s.y + s.h / 2, ty = t.y + t.h / 2;
            let points: [number, number][];
            if (f.sourceRef.$type === 'bpmn:BoundaryEvent') {
                points = [[s.x + s.w / 2, s.y + s.h], [s.x + s.w / 2, ty], [t.x, ty]];
            } else if (back.has(f) || t.x <= s.x) {
                points = [[s.x + s.w / 2, s.y + s.h], [s.x + s.w / 2, bottom], [t.x + t.w / 2, bottom], [t.x + t.w / 2, t.y + t.h]];
            } else if (Math.abs(sy - ty) < 1) {
                points = [[s.x + s.w, sy], [t.x, ty]];
            } else {
                const mid = (s.x + s.w + t.x) / 2;
                points = [[s.x + s.w, sy], [mid, sy], [mid, ty], [t.x, ty]];
            }
            plane_elements.push(moddle.create('bpmndi:BPMNEdge', { id: `${f.id}_di`, bpmnElement: f, waypoint: points.map(([x, y]) => point(x, y)) }));
        }
        pool_y += pool_height + MARGIN;
    }
    const plane = moddle.create('bpmndi:BPMNPlane', { id: `BPMNPlane_${collaboration.id}`, bpmnElement: collaboration, planeElement: plane_elements });
    definitions.diagrams = [moddle.create('bpmndi:BPMNDiagram', { id: `BPMNDiagram_${collaboration.id}`, plane })];
}
