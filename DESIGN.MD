# Agentic Workflow Architecture (AWA) Visual Design System

This document outlines the visual standards, color harmony, layout metrics, and interactive paradigms of the AWA Process Visualization layer.

## Design Philosophy

The AWA visualizer is designed to be **AI-Native**, **Highly Observable**, and **Visually Premium**. It follows a dark theme archetype designed to fit modern SaaS and technical environments. It emphasizes state changes clearly so that users can instantly identify where execution is running, where human bottlenecks are waiting, and which paths are traversed.

---

## 1. Color Palette & State Tokens

AWA uses harmonious color tokens linked to activity execution states. Do not use generic browser colors.

| State | CSS Token | Border Color / Accent | Visual Meaning |
| :--- | :--- | :--- | :--- |
| **RUNNING** | `#a855f7` | Glowing Purple (Pulse) | Active token processing on this node |
| **WAITING** | `#fbbf24` | Amber / Bright Gold | Paused execution, awaiting human review/approval |
| **DONE** | `#10b981` | Emerald Green | Successfully executed and verified |
| **QUEUE** | `#6b7280` | Slate Gray | Queued or idle step not yet reached |

### Theme Colors
- **Canvas Background**: `#0b0f19` (Deep dark slate/blue)
- **Swimlane Background**: `rgba(15, 23, 42, 0.6)`
- **Card Background**: `#1e293b` (Slate-800)
- **Text Primary**: `#ffffff`
- **Text Secondary**: `#9ca3af`
- **Telemetry Sidebar**: `#111827` (Slate-950) with borders of `rgba(255, 255, 255, 0.08)`

---

## 2. Card Component Metrics

Custom cards must render as a single, self-contained rounded element to avoid overlapping ReactFlow container borders.

- **Card Dimensions**: Width `210px`, Height `85px`
- **Border Radius**: `8px`
- **Left Status Accent**: `4px` solid border reflecting the active status color
- **Shadow Effects**:
  - Running: `0 0 15px rgba(168, 85, 247, 0.4)` (purple glow)
  - Other: `0 4px 12px rgba(0, 0, 0, 0.15)`
- **Typography Layout**:
  - **Actor Badge (Top Left)**: 9px semi-bold, uppercase (e.g. `🤖 AI AGENT`, `👤 HUMAN`, `💻 SYSTEM`)
  - **Status Badge (Top Right)**: 9px bold, matching status color (e.g. `⚡ RUNNING`, `✅ DONE`)
  - **Title (Center)**: 11px extra-bold white (`#ffffff`), left-aligned, max 2 lines with text-overflow ellipsis
  - **Footer (Bottom)**: 9px slate-grey, displaying dynamic execution time (e.g. `⏱️ 1.51s`) and optionally SLA thresholds

---

## 3. Connectors & Edges

Edges represent the flow of work between activities and contain telemetry indicators.

- **Curve Types**: `smoothstep` (default) or `step`
- **Edge Traversal Styling**:
  - **Traversed**: `#10b981` (emerald green), stroke width `3px`, animated dashing
  - **Untraversed**: `#4b5563` (slate gray), stroke width `1.5px`, static
- **Bottlenecks / Alerts**: `#ff4d4f` (red), stroke width `4px`, animated dashing
- **Work Transfer Labels**: Text prefixed with type icons (e.g. `🔁 Request-Reply`, `🔔 Notification`)

---

## 4. Handles & ReactFlow Setup

Handles are required on both sides for correct connection layout rendering:

- **Target Handle (Left)**: Semicircle input handle styled with the current node state color, width `8px`, height `8px`, overlapping the border (`left: -4px`).
- **Source Handle (Right)**: Semicircle output handle styled with the current node state color, width `8px`, height `8px`, overlapping the border (`right: -4px`).
- **Handle Border**: `1.5px solid #ffffff` to stand out cleanly.

---

## 5. Interaction Paradigms

1. **Selection Isolation**: Clicking a card applies a glowing border (`#818cf8`) and publishes event data.
2. **Propagated Callbacks**: Node clicks trigger options-provided callbacks:
   - `opts.onNodeClick(nodeId, node)`
   - `opts.onEdgeClick(edgeId, edge)`
3. **Optional Details Sidebar**: The floating details panel must respect `opts.showDetailsPanel !== false` to avoid overlapping double-inspection bars when using custom sidebar details panels (like in `live.html`).
