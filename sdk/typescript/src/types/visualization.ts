/**
 * AWA Visualization Types
 * TypeScript types for 2D and 3D workflow visualization
 */

import { z } from 'zod';

// ============================================================================
// VISUALIZATION ENUMS
// ============================================================================

export const ViewType = z.enum(['2d', '3d']);
export type ViewType = z.infer<typeof ViewType>;

export const LayoutAlgorithm = z.enum(['dagre', 'elk', 'd3_hierarchy', 'manual']);
export type LayoutAlgorithm = z.infer<typeof LayoutAlgorithm>;

export const LayoutDirection = z.enum(['tb', 'bt', 'lr', 'rl']);
export type LayoutDirection = z.infer<typeof LayoutDirection>;

export const LaneOrientation = z.enum(['horizontal', 'vertical']);
export type LaneOrientation = z.infer<typeof LaneOrientation>;

export const CurveType = z.enum(['bezier', 'step', 'smoothstep', 'straight']);
export type CurveType = z.infer<typeof CurveType>;

export const NodeShape = z.enum(['rectangle', 'rounded', 'circle', 'diamond', 'hexagon', 'cylinder', 'cube', 'sphere']);
export type NodeShape = z.infer<typeof NodeShape>;

export const CameraType = z.enum(['arc_rotate', 'free', 'follow', 'fly']);
export type CameraType = z.infer<typeof CameraType>;

export const AnimationEasing = z.enum(['linear', 'ease', 'ease_in', 'ease_out', 'ease_in_out', 'bounce', 'elastic']);
export type AnimationEasing = z.infer<typeof AnimationEasing>;

export const VisualizationEngine = z.enum(['reactflow', 'babylonjs', 'custom']);
export type VisualizationEngine = z.infer<typeof VisualizationEngine>;

// ============================================================================
// BASIC TYPES
// ============================================================================

export const Vector2DSchema = z.object({
    x: z.number(),
    y: z.number(),
});
export type Vector2D = z.infer<typeof Vector2DSchema>;

export const Vector3DSchema = z.object({
    x: z.number(),
    y: z.number(),
    z: z.number(),
});
export type Vector3D = z.infer<typeof Vector3DSchema>;

export const QuaternionSchema = z.object({
    x: z.number(),
    y: z.number(),
    z: z.number(),
    w: z.number(),
});
export type Quaternion = z.infer<typeof QuaternionSchema>;

export const ColorSchema = z.string().regex(/^#([A-Fa-f0-9]{6}|[A-Fa-f0-9]{8})$|^rgba?\(/);
export type Color = z.infer<typeof ColorSchema>;

// ============================================================================
// NODE POSITION SCHEMAS
// ============================================================================

export const NodeStyle2DSchema = z.object({
    background_color: ColorSchema.optional(),
    border_color: ColorSchema.optional(),
    border_width: z.number().optional(),
    border_radius: z.number().optional(),
    opacity: z.number().min(0).max(1).optional(),
}).passthrough();
export type NodeStyle2D = z.infer<typeof NodeStyle2DSchema>;

export const NodeMaterial3DSchema = z.object({
    diffuse_color: ColorSchema.optional(),
    emissive_color: ColorSchema.optional(),
    alpha: z.number().min(0).max(1).optional(),
    metallic: z.number().min(0).max(1).optional(),
    roughness: z.number().min(0).max(1).optional(),
}).passthrough();
export type NodeMaterial3D = z.infer<typeof NodeMaterial3DSchema>;

export const NodePosition2DSchema = z.object({
    id: z.string().uuid().optional(),
    node_id: z.string().uuid(),
    node_type: z.enum(['activity', 'event', 'decision']),
    position: Vector2DSchema,
    width: z.number().min(0).optional(),
    height: z.number().min(0).optional(),
    z_index: z.number().int().optional(),
    shape: NodeShape.optional(),
    style: NodeStyle2DSchema.optional(),
    collapsed: z.boolean().default(false),
});
export type NodePosition2D = z.infer<typeof NodePosition2DSchema>;

export const NodePosition3DSchema = z.object({
    id: z.string().uuid().optional(),
    node_id: z.string().uuid(),
    node_type: z.enum(['activity', 'event', 'decision']),
    position: Vector3DSchema,
    rotation: QuaternionSchema.optional(),
    scale: Vector3DSchema.optional(),
    shape: NodeShape.optional(),
    material: NodeMaterial3DSchema.optional(),
    visible: z.boolean().default(true),
});
export type NodePosition3D = z.infer<typeof NodePosition3DSchema>;

// ============================================================================
// EDGE ROUTING SCHEMA
// ============================================================================

export const EdgeStyleSchema = z.object({
    stroke_color: ColorSchema.optional(),
    stroke_width: z.number().optional(),
    stroke_dasharray: z.string().optional(),
    marker_start: z.string().optional(),
    marker_end: z.string().optional(),
}).passthrough();
export type EdgeStyle = z.infer<typeof EdgeStyleSchema>;

export const EdgeRoutingSchema = z.object({
    id: z.string().uuid().optional(),
    edge_id: z.string().uuid(),
    curve_type: CurveType.default('bezier'),
    control_points_2d: z.array(Vector2DSchema).optional(),
    control_points_3d: z.array(Vector3DSchema).optional(),
    animated: z.boolean().default(false),
    animation_speed: z.number().min(0).optional(),
    style: EdgeStyleSchema.optional(),
});
export type EdgeRouting = z.infer<typeof EdgeRoutingSchema>;

// ============================================================================
// LANE SCHEMA
// ============================================================================

export const LaneSchema = z.object({
    id: z.string().uuid(),
    name: z.string(),
    label: z.string().optional(),
    description: z.string().optional(),
    orientation: LaneOrientation.default('horizontal'),
    order_index: z.number().int().optional(),
    node_ids: z.array(z.string().uuid()).default([]),
    role_id: z.string().uuid().optional(),
    organization_id: z.string().uuid().optional(),
    color: ColorSchema.optional(),
    collapsed: z.boolean().default(false),
});
export type Lane = z.infer<typeof LaneSchema>;

// ============================================================================
// AUTO-LAYOUT CONFIG
// ============================================================================

export const AutoLayoutConfigSchema = z.object({
    algorithm: LayoutAlgorithm.default('dagre'),
    direction: LayoutDirection.default('lr'),
    node_spacing: z.number().min(0).default(50),
    rank_spacing: z.number().min(0).default(100),
    edge_spacing: z.number().min(0).default(10),
    align: z.enum(['ul', 'ur', 'dl', 'dr']).optional(),
    elk_options: z.record(z.unknown()).optional(),
    respect_lanes: z.boolean().default(true),
});
export type AutoLayoutConfig = z.infer<typeof AutoLayoutConfigSchema>;

// ============================================================================
// CAMERA SETTINGS
// ============================================================================

export const CameraSettings2DSchema = z.object({
    center: Vector2DSchema.optional(),
    zoom: z.number().min(0.1).max(10).default(1),
    min_zoom: z.number().min(0.1).default(0.1),
    max_zoom: z.number().max(10).default(4),
    fit_view: z.boolean().default(true),
    fit_padding: z.number().default(50),
});
export type CameraSettings2D = z.infer<typeof CameraSettings2DSchema>;

export const CameraSettings3DSchema = z.object({
    type: CameraType.default('arc_rotate'),
    position: Vector3DSchema.optional(),
    target: Vector3DSchema.optional(),
    fov: z.number().min(10).max(120).default(45),
    near_clip: z.number().min(0.01).default(0.1),
    far_clip: z.number().default(1000),
    alpha: z.number().optional(),
    beta: z.number().optional(),
    radius: z.number().optional(),
});
export type CameraSettings3D = z.infer<typeof CameraSettings3DSchema>;

// ============================================================================
// ANIMATION CONFIG
// ============================================================================

export const AnimationConfigSchema = z.object({
    enabled: z.boolean().default(true),
    transition_duration: z.number().int().min(0).default(300),
    easing: AnimationEasing.default('ease_in_out'),
    edge_flow_enabled: z.boolean().default(false),
    edge_flow_speed: z.number().default(1),
    highlight_active_path: z.boolean().default(true),
    playback_speed: z.number().min(0.1).max(10).default(1),
});
export type AnimationConfig = z.infer<typeof AnimationConfigSchema>;

// ============================================================================
// THEME CONFIG
// ============================================================================

export const ThemeConfigSchema = z.object({
    background_color: ColorSchema.optional(),
    grid_enabled: z.boolean().default(true),
    grid_size: z.number().default(20),
    grid_color: ColorSchema.optional(),
    minimap_enabled: z.boolean().default(true),
    controls_enabled: z.boolean().default(true),
}).passthrough();
export type ThemeConfig = z.infer<typeof ThemeConfigSchema>;

// ============================================================================
// VISUALIZATION CONFIG (MAIN ENTITY)
// ============================================================================

export const VisualizationConfigSchema = z.object({
    id: z.string().uuid(),
    workflow_id: z.string().uuid(),
    name: z.string().optional(),
    description: z.string().optional(),
    is_default: z.boolean().default(false),
    view_type: ViewType,
    engine: VisualizationEngine.optional(),
    auto_layout: AutoLayoutConfigSchema.optional(),
    node_positions_2d: z.array(NodePosition2DSchema).default([]),
    node_positions_3d: z.array(NodePosition3DSchema).default([]),
    edge_routings: z.array(EdgeRoutingSchema).default([]),
    lanes: z.array(LaneSchema).default([]),
    camera_2d: CameraSettings2DSchema.optional(),
    camera_3d: CameraSettings3DSchema.optional(),
    animation: AnimationConfigSchema.optional(),
    theme: ThemeConfigSchema.optional(),
    metadata: z.record(z.unknown()).optional(),
    created_at: z.string().datetime().optional(),
    updated_at: z.string().datetime().optional(),
});
export type VisualizationConfig = z.infer<typeof VisualizationConfigSchema>;

// ============================================================================
// REACTFLOW CONVERSION HELPERS (Type definitions)
// ============================================================================

/**
 * ReactFlow-compatible node type for 2D visualization
 */
export interface ReactFlowNode {
    id: string;
    type?: string;
    position: { x: number; y: number };
    data: {
        label: string;
        [key: string]: unknown;
    };
    style?: Record<string, unknown>;
    width?: number;
    height?: number;
    zIndex?: number;
    parentNode?: string;
}

/**
 * ReactFlow-compatible edge type for 2D visualization
 */
export interface ReactFlowEdge {
    id: string;
    source: string;
    target: string;
    type?: 'default' | 'straight' | 'step' | 'smoothstep' | 'bezier';
    animated?: boolean;
    style?: Record<string, unknown>;
    label?: string;
    markerEnd?: string;
}

// ============================================================================
// BABYLON.JS CONVERSION HELPERS (Type definitions)
// ============================================================================

/**
 * Babylon.js-compatible mesh position type for 3D visualization
 */
export interface BabylonMeshPosition {
    name: string;
    position: { x: number; y: number; z: number };
    rotation?: { x: number; y: number; z: number; w: number };
    scaling?: { x: number; y: number; z: number };
    metadata?: Record<string, unknown>;
}

/**
 * Babylon.js camera configuration
 */
export interface BabylonCameraConfig {
    type: 'ArcRotateCamera' | 'FreeCamera' | 'FollowCamera' | 'FlyCamera';
    position?: { x: number; y: number; z: number };
    target?: { x: number; y: number; z: number };
    alpha?: number;
    beta?: number;
    radius?: number;
    fov?: number;
}
