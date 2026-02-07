"""
AWA Visualization Types - Pydantic models for 2D/3D workflow visualization
"""

from datetime import datetime
from enum import Enum
from typing import Any
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field


# ============================================================================
# VISUALIZATION ENUMS
# ============================================================================


class ViewType(str, Enum):
    dimension_2d = "2d"
    dimension_3d = "3d"


class LayoutAlgorithm(str, Enum):
    dagre = "dagre"
    elk = "elk"
    d3_hierarchy = "d3_hierarchy"
    manual = "manual"


class LayoutDirection(str, Enum):
    tb = "tb"  # top-bottom
    bt = "bt"  # bottom-top
    lr = "lr"  # left-right
    rl = "rl"  # right-left


class LaneOrientation(str, Enum):
    horizontal = "horizontal"
    vertical = "vertical"


class CurveType(str, Enum):
    bezier = "bezier"
    step = "step"
    smoothstep = "smoothstep"
    straight = "straight"


class NodeShape(str, Enum):
    rectangle = "rectangle"
    rounded = "rounded"
    circle = "circle"
    diamond = "diamond"
    hexagon = "hexagon"
    cylinder = "cylinder"
    cube = "cube"
    sphere = "sphere"


class CameraType(str, Enum):
    arc_rotate = "arc_rotate"
    free = "free"
    follow = "follow"
    fly = "fly"


class AnimationEasing(str, Enum):
    linear = "linear"
    ease = "ease"
    ease_in = "ease_in"
    ease_out = "ease_out"
    ease_in_out = "ease_in_out"
    bounce = "bounce"
    elastic = "elastic"


class VisualizationEngine(str, Enum):
    reactflow = "reactflow"
    babylonjs = "babylonjs"
    custom = "custom"


# ============================================================================
# BASIC TYPES
# ============================================================================


class Vector2D(BaseModel):
    x: float
    y: float


class Vector3D(BaseModel):
    x: float
    y: float
    z: float


class Quaternion(BaseModel):
    x: float
    y: float
    z: float
    w: float


# ============================================================================
# NODE POSITION MODELS
# ============================================================================


class NodeStyle2D(BaseModel):
    background_color: str | None = None
    border_color: str | None = None
    border_width: float | None = None
    border_radius: float | None = None
    opacity: float | None = Field(default=None, ge=0, le=1)

    model_config = ConfigDict(extra="allow")


class NodeMaterial3D(BaseModel):
    diffuse_color: str | None = None
    emissive_color: str | None = None
    alpha: float | None = Field(default=None, ge=0, le=1)
    metallic: float | None = Field(default=None, ge=0, le=1)
    roughness: float | None = Field(default=None, ge=0, le=1)

    model_config = ConfigDict(extra="allow")


class NodePosition2D(BaseModel):
    id: UUID | None = None
    node_id: UUID
    node_type: str  # 'activity', 'event', 'decision'
    position: Vector2D
    width: float | None = Field(default=None, ge=0)
    height: float | None = Field(default=None, ge=0)
    z_index: int | None = None
    shape: NodeShape | None = None
    style: NodeStyle2D | None = None
    collapsed: bool = False


class NodePosition3D(BaseModel):
    id: UUID | None = None
    node_id: UUID
    node_type: str  # 'activity', 'event', 'decision'
    position: Vector3D
    rotation: Quaternion | None = None
    scale: Vector3D | None = None
    shape: NodeShape | None = None
    material: NodeMaterial3D | None = None
    visible: bool = True


# ============================================================================
# EDGE ROUTING
# ============================================================================


class EdgeStyle(BaseModel):
    stroke_color: str | None = None
    stroke_width: float | None = None
    stroke_dasharray: str | None = None
    marker_start: str | None = None
    marker_end: str | None = None

    model_config = ConfigDict(extra="allow")


class EdgeRouting(BaseModel):
    id: UUID | None = None
    edge_id: UUID
    curve_type: CurveType = CurveType.bezier
    control_points_2d: list[Vector2D] = Field(default_factory=list)
    control_points_3d: list[Vector3D] = Field(default_factory=list)
    animated: bool = False
    animation_speed: float | None = Field(default=None, ge=0)
    style: EdgeStyle | None = None


# ============================================================================
# LANE (SWIMLANE / POOL)
# ============================================================================


class Lane(BaseModel):
    id: UUID
    name: str
    label: str | None = None
    description: str | None = None
    orientation: LaneOrientation = LaneOrientation.horizontal
    order_index: int | None = None
    node_ids: list[UUID] = Field(default_factory=list)
    role_id: UUID | None = None
    organization_id: UUID | None = None
    color: str | None = None
    collapsed: bool = False


# ============================================================================
# AUTO-LAYOUT CONFIG
# ============================================================================


class AutoLayoutConfig(BaseModel):
    algorithm: LayoutAlgorithm = LayoutAlgorithm.dagre
    direction: LayoutDirection = LayoutDirection.lr
    node_spacing: float = Field(default=50, ge=0)
    rank_spacing: float = Field(default=100, ge=0)
    edge_spacing: float = Field(default=10, ge=0)
    align: str | None = None  # 'ul', 'ur', 'dl', 'dr'
    elk_options: dict[str, Any] | None = None
    respect_lanes: bool = True


# ============================================================================
# CAMERA SETTINGS
# ============================================================================


class CameraSettings2D(BaseModel):
    center: Vector2D | None = None
    zoom: float = Field(default=1, ge=0.1, le=10)
    min_zoom: float = Field(default=0.1, ge=0.1)
    max_zoom: float = Field(default=4, le=10)
    fit_view: bool = True
    fit_padding: float = 50


class CameraSettings3D(BaseModel):
    type: CameraType = CameraType.arc_rotate
    position: Vector3D | None = None
    target: Vector3D | None = None
    fov: float = Field(default=45, ge=10, le=120)
    near_clip: float = Field(default=0.1, ge=0.01)
    far_clip: float = 1000
    alpha: float | None = None
    beta: float | None = None
    radius: float | None = None


# ============================================================================
# ANIMATION CONFIG
# ============================================================================


class AnimationConfig(BaseModel):
    enabled: bool = True
    transition_duration: int = Field(default=300, ge=0)
    easing: AnimationEasing = AnimationEasing.ease_in_out
    edge_flow_enabled: bool = False
    edge_flow_speed: float = 1
    highlight_active_path: bool = True
    playback_speed: float = Field(default=1, ge=0.1, le=10)


# ============================================================================
# THEME CONFIG
# ============================================================================


class ThemeConfig(BaseModel):
    background_color: str | None = None
    grid_enabled: bool = True
    grid_size: float = 20
    grid_color: str | None = None
    minimap_enabled: bool = True
    controls_enabled: bool = True

    model_config = ConfigDict(extra="allow")


# ============================================================================
# VISUALIZATION CONFIG (MAIN ENTITY)
# ============================================================================


class VisualizationConfig(BaseModel):
    id: UUID
    workflow_id: UUID
    name: str | None = None
    description: str | None = None
    is_default: bool = False
    view_type: ViewType
    engine: VisualizationEngine | None = None
    auto_layout: AutoLayoutConfig | None = None
    node_positions_2d: list[NodePosition2D] = Field(default_factory=list)
    node_positions_3d: list[NodePosition3D] = Field(default_factory=list)
    edge_routings: list[EdgeRouting] = Field(default_factory=list)
    lanes: list[Lane] = Field(default_factory=list)
    camera_2d: CameraSettings2D | None = None
    camera_3d: CameraSettings3D | None = None
    animation: AnimationConfig | None = None
    theme: ThemeConfig | None = None
    metadata: dict[str, Any] | None = None
    created_at: datetime | None = None
    updated_at: datetime | None = None
