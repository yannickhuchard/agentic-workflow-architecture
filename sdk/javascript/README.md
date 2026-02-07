# AWA Visualization Library

A unified JavaScript library for rendering AWA (Agentic Workflow Architecture) workflows in 2D and 3D.

## Features

- **2D Rendering** - ReactFlow-based visualization with Dagre/ELK auto-layout
- **3D Rendering** - Babylon.js-based visualization with PBR materials
- **Unified API** - Single `AWAViz.render()` function auto-detects view type
- **No Build Required** - Vanilla JS that works with CDN dependencies

## Installation

### CDN (Recommended for quick start)

```html
<!-- 2D Dependencies (ReactFlow 11) -->
<script src="https://unpkg.com/react@17/umd/react.production.min.js" crossorigin></script>
<script src="https://unpkg.com/react-dom@17/umd/react-dom.production.min.js" crossorigin></script>
<script src="https://cdn.jsdelivr.net/npm/reactflow@11/dist/umd/index.min.js"></script>
<link href="https://cdn.jsdelivr.net/npm/reactflow@11/dist/style.css" rel="stylesheet" />

<!-- 3D Dependencies (Babylon.js) -->
<script src="https://cdn.babylonjs.com/babylon.js"></script>
<script src="https://cdn.babylonjs.com/materialsLibrary/babylonjs.materials.min.js"></script>

<!-- AWA Visualization Library -->
<script src="path/to/awa-viz.js"></script>
```

> **Note:** We use **ReactFlow 11** (not 12+) for stable UMD/CDN compatibility. ReactFlow 12+ requires ES modules and has JSX runtime issues with UMD bundles.

### npm

```bash
npm install @awa/visualization
```

## Quick Start

### 2D Visualization

```html
<div id="container" style="width: 100%; height: 500px;"></div>
<script>
const vizConfig = {
  visualization: {
    view_type: "2d",
    node_positions_2d: [
      { node_id: "start", position: { x: 0, y: 0 }, width: 150, height: 60, 
        style: { background_color: "#4CAF50", border_color: "#2E7D32" }},
      { node_id: "process", position: { x: 200, y: 0 }, width: 150, height: 60,
        style: { background_color: "#2196F3", border_color: "#1565C0" }}
    ],
    edge_routings: [
      { edge_id: "edge-start-to-process", curve_type: "smoothstep", animated: true,
        style: { stroke_color: "#666", stroke_width: 2 }}
    ]
  }
};

AWAViz.render(document.getElementById('container'), vizConfig);
</script>
```

### 3D Visualization

```html
<canvas id="canvas" style="width: 100%; height: 500px;"></canvas>
<script>
const vizConfig = {
  visualization: {
    view_type: "3d",
    node_positions_3d: [
      { node_id: "start", position: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 },
        shape: "sphere", material: { diffuse_color: "#4CAF50", metallic: 0.3 }},
      { node_id: "process", position: { x: 5, y: 0, z: 0 }, scale: { x: 2, y: 1, z: 1 },
        shape: "cube", material: { diffuse_color: "#2196F3", metallic: 0.2 }}
    ],
    camera_3d: { alpha: 1.2, beta: 1.1, radius: 15, target: { x: 2.5, y: 0, z: 0 }}
  }
};

AWAViz.render(document.getElementById('canvas'), vizConfig);
</script>
```

## API Reference

### `AWAViz.render(container, visualization, options)`

Renders a visualization to the given container.

| Parameter | Type | Description |
|-----------|------|-------------|
| container | HTMLElement | DOM element (div for 2D, canvas for 3D) |
| visualization | Object | AWA visualization config object |
| options | Object | Optional rendering options |

**Options (2D):**
- `fitView` (boolean) - Auto-fit to container, default: true
- `showMinimap` (boolean) - Show minimap, default: true
- `showControls` (boolean) - Show zoom controls, default: true
- `showBackground` (boolean) - Show grid background, default: true

**Options (3D):**
- `enableGlow` (boolean) - Enable glow layer, default: true
- `enableFog` (boolean) - Enable fog effect, default: false
- `enableGrid` (boolean) - Show ground grid, default: true
- `autoAnimate` (boolean) - Enable node animation, default: true

### `AWAViz.createPage(container, visualization, options)`

Creates a complete visualization page with header and controls.

### `AWAViz.renderers.ReactFlow2D`

Direct access to 2D renderer for advanced usage.

### `AWAViz.renderers.Babylon3D`

Direct access to 3D renderer for advanced usage.

## Examples

See the `examples/` directory for complete working examples:

- `examples/visualization-swimlanes/visualization-2d-swimlanes.html` - Horizontal swim lanes with Dagre
- `examples/visualization-elk-hierarchy/visualization-2d-elk-hierarchy.html` - Top-to-bottom ELK layout
- `examples/visualization-3d-spatial/visualization-3d-spatial.html` - Layered 3D with PBR materials
- `examples/visualization-3d-pipeline/visualization-3d-pipeline.html` - Cylinder pipeline with glow/fog

## License

Apache-2.0
