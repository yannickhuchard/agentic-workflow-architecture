package io.awa.model.visualization;

import com.fasterxml.jackson.annotation.JsonProperty;
import io.awa.model.NodeType;

import java.time.Instant;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

/**
 * Complete visualization configuration for AWA workflows.
 * Supports 2D (ReactFlow) and 3D (Babylon.js) rendering.
 */
public class VisualizationConfig {
    private UUID id;

    @JsonProperty("workflow_id")
    private UUID workflowId;

    private String name;
    private String description;

    @JsonProperty("is_default")
    private boolean isDefault = false;

    @JsonProperty("view_type")
    private ViewType viewType;

    private VisualizationEngine engine;

    @JsonProperty("auto_layout")
    private AutoLayoutConfig autoLayout;

    @JsonProperty("node_positions_2d")
    private List<NodePosition2D> nodePositions2d = new ArrayList<>();

    @JsonProperty("node_positions_3d")
    private List<NodePosition3D> nodePositions3d = new ArrayList<>();

    @JsonProperty("edge_routings")
    private List<EdgeRouting> edgeRoutings = new ArrayList<>();

    private List<Lane> lanes = new ArrayList<>();

    @JsonProperty("camera_2d")
    private CameraSettings2D camera2d;

    @JsonProperty("camera_3d")
    private CameraSettings3D camera3d;

    private AnimationConfig animation;
    private ThemeConfig theme;
    private Map<String, Object> metadata = new HashMap<>();

    @JsonProperty("created_at")
    private Instant createdAt;

    @JsonProperty("updated_at")
    private Instant updatedAt;

    // Constructors
    public VisualizationConfig() {
    }

    public VisualizationConfig(UUID id, UUID workflowId, ViewType viewType) {
        this.id = id;
        this.workflowId = workflowId;
        this.viewType = viewType;
    }

    // Getters and Setters
    public UUID getId() {
        return id;
    }

    public void setId(UUID id) {
        this.id = id;
    }

    public UUID getWorkflowId() {
        return workflowId;
    }

    public void setWorkflowId(UUID workflowId) {
        this.workflowId = workflowId;
    }

    public String getName() {
        return name;
    }

    public void setName(String name) {
        this.name = name;
    }

    public String getDescription() {
        return description;
    }

    public void setDescription(String description) {
        this.description = description;
    }

    public boolean isDefault() {
        return isDefault;
    }

    public void setDefault(boolean isDefault) {
        this.isDefault = isDefault;
    }

    public ViewType getViewType() {
        return viewType;
    }

    public void setViewType(ViewType viewType) {
        this.viewType = viewType;
    }

    public VisualizationEngine getEngine() {
        return engine;
    }

    public void setEngine(VisualizationEngine engine) {
        this.engine = engine;
    }

    public AutoLayoutConfig getAutoLayout() {
        return autoLayout;
    }

    public void setAutoLayout(AutoLayoutConfig autoLayout) {
        this.autoLayout = autoLayout;
    }

    public List<NodePosition2D> getNodePositions2d() {
        return nodePositions2d;
    }

    public void setNodePositions2d(List<NodePosition2D> nodePositions2d) {
        this.nodePositions2d = nodePositions2d;
    }

    public List<NodePosition3D> getNodePositions3d() {
        return nodePositions3d;
    }

    public void setNodePositions3d(List<NodePosition3D> nodePositions3d) {
        this.nodePositions3d = nodePositions3d;
    }

    public List<EdgeRouting> getEdgeRoutings() {
        return edgeRoutings;
    }

    public void setEdgeRoutings(List<EdgeRouting> edgeRoutings) {
        this.edgeRoutings = edgeRoutings;
    }

    public List<Lane> getLanes() {
        return lanes;
    }

    public void setLanes(List<Lane> lanes) {
        this.lanes = lanes;
    }

    public CameraSettings2D getCamera2d() {
        return camera2d;
    }

    public void setCamera2d(CameraSettings2D camera2d) {
        this.camera2d = camera2d;
    }

    public CameraSettings3D getCamera3d() {
        return camera3d;
    }

    public void setCamera3d(CameraSettings3D camera3d) {
        this.camera3d = camera3d;
    }

    public AnimationConfig getAnimation() {
        return animation;
    }

    public void setAnimation(AnimationConfig animation) {
        this.animation = animation;
    }

    public ThemeConfig getTheme() {
        return theme;
    }

    public void setTheme(ThemeConfig theme) {
        this.theme = theme;
    }

    public Map<String, Object> getMetadata() {
        return metadata;
    }

    public void setMetadata(Map<String, Object> metadata) {
        this.metadata = metadata;
    }

    public Instant getCreatedAt() {
        return createdAt;
    }

    public void setCreatedAt(Instant createdAt) {
        this.createdAt = createdAt;
    }

    public Instant getUpdatedAt() {
        return updatedAt;
    }

    public void setUpdatedAt(Instant updatedAt) {
        this.updatedAt = updatedAt;
    }

    // Inner classes for embedded types

    public static class Vector2D {
        private double x;
        private double y;

        public Vector2D() {
        }

        public Vector2D(double x, double y) {
            this.x = x;
            this.y = y;
        }

        public double getX() {
            return x;
        }

        public void setX(double x) {
            this.x = x;
        }

        public double getY() {
            return y;
        }

        public void setY(double y) {
            this.y = y;
        }
    }

    public static class Vector3D {
        private double x;
        private double y;
        private double z;

        public Vector3D() {
        }

        public Vector3D(double x, double y, double z) {
            this.x = x;
            this.y = y;
            this.z = z;
        }

        public double getX() {
            return x;
        }

        public void setX(double x) {
            this.x = x;
        }

        public double getY() {
            return y;
        }

        public void setY(double y) {
            this.y = y;
        }

        public double getZ() {
            return z;
        }

        public void setZ(double z) {
            this.z = z;
        }
    }

    public static class Quaternion {
        private double x;
        private double y;
        private double z;
        private double w;

        public Quaternion() {
            this.w = 1.0;
        }

        public Quaternion(double x, double y, double z, double w) {
            this.x = x;
            this.y = y;
            this.z = z;
            this.w = w;
        }

        public double getX() {
            return x;
        }

        public void setX(double x) {
            this.x = x;
        }

        public double getY() {
            return y;
        }

        public void setY(double y) {
            this.y = y;
        }

        public double getZ() {
            return z;
        }

        public void setZ(double z) {
            this.z = z;
        }

        public double getW() {
            return w;
        }

        public void setW(double w) {
            this.w = w;
        }
    }

    public static class NodePosition2D {
        private UUID id;
        @JsonProperty("node_id")
        private UUID nodeId;
        @JsonProperty("node_type")
        private NodeType nodeType;
        private Vector2D position;
        private Double width;
        private Double height;
        @JsonProperty("z_index")
        private Integer zIndex;
        private NodeShape shape;
        private Map<String, Object> style;
        private boolean collapsed = false;

        public UUID getId() {
            return id;
        }

        public void setId(UUID id) {
            this.id = id;
        }

        public UUID getNodeId() {
            return nodeId;
        }

        public void setNodeId(UUID nodeId) {
            this.nodeId = nodeId;
        }

        public NodeType getNodeType() {
            return nodeType;
        }

        public void setNodeType(NodeType nodeType) {
            this.nodeType = nodeType;
        }

        public Vector2D getPosition() {
            return position;
        }

        public void setPosition(Vector2D position) {
            this.position = position;
        }

        public Double getWidth() {
            return width;
        }

        public void setWidth(Double width) {
            this.width = width;
        }

        public Double getHeight() {
            return height;
        }

        public void setHeight(Double height) {
            this.height = height;
        }

        public Integer getZIndex() {
            return zIndex;
        }

        public void setZIndex(Integer zIndex) {
            this.zIndex = zIndex;
        }

        public NodeShape getShape() {
            return shape;
        }

        public void setShape(NodeShape shape) {
            this.shape = shape;
        }

        public Map<String, Object> getStyle() {
            return style;
        }

        public void setStyle(Map<String, Object> style) {
            this.style = style;
        }

        public boolean isCollapsed() {
            return collapsed;
        }

        public void setCollapsed(boolean collapsed) {
            this.collapsed = collapsed;
        }
    }

    public static class NodePosition3D {
        private UUID id;
        @JsonProperty("node_id")
        private UUID nodeId;
        @JsonProperty("node_type")
        private NodeType nodeType;
        private Vector3D position;
        private Quaternion rotation;
        private Vector3D scale;
        private NodeShape shape;
        private Map<String, Object> material;
        private boolean visible = true;

        public UUID getId() {
            return id;
        }

        public void setId(UUID id) {
            this.id = id;
        }

        public UUID getNodeId() {
            return nodeId;
        }

        public void setNodeId(UUID nodeId) {
            this.nodeId = nodeId;
        }

        public NodeType getNodeType() {
            return nodeType;
        }

        public void setNodeType(NodeType nodeType) {
            this.nodeType = nodeType;
        }

        public Vector3D getPosition() {
            return position;
        }

        public void setPosition(Vector3D position) {
            this.position = position;
        }

        public Quaternion getRotation() {
            return rotation;
        }

        public void setRotation(Quaternion rotation) {
            this.rotation = rotation;
        }

        public Vector3D getScale() {
            return scale;
        }

        public void setScale(Vector3D scale) {
            this.scale = scale;
        }

        public NodeShape getShape() {
            return shape;
        }

        public void setShape(NodeShape shape) {
            this.shape = shape;
        }

        public Map<String, Object> getMaterial() {
            return material;
        }

        public void setMaterial(Map<String, Object> material) {
            this.material = material;
        }

        public boolean isVisible() {
            return visible;
        }

        public void setVisible(boolean visible) {
            this.visible = visible;
        }
    }

    public static class EdgeRouting {
        private UUID id;
        @JsonProperty("edge_id")
        private UUID edgeId;
        @JsonProperty("curve_type")
        private CurveType curveType = CurveType.BEZIER;
        @JsonProperty("control_points_2d")
        private List<Vector2D> controlPoints2d = new ArrayList<>();
        @JsonProperty("control_points_3d")
        private List<Vector3D> controlPoints3d = new ArrayList<>();
        private boolean animated = false;
        @JsonProperty("animation_speed")
        private Double animationSpeed;
        private Map<String, Object> style;

        public UUID getId() {
            return id;
        }

        public void setId(UUID id) {
            this.id = id;
        }

        public UUID getEdgeId() {
            return edgeId;
        }

        public void setEdgeId(UUID edgeId) {
            this.edgeId = edgeId;
        }

        public CurveType getCurveType() {
            return curveType;
        }

        public void setCurveType(CurveType curveType) {
            this.curveType = curveType;
        }

        public List<Vector2D> getControlPoints2d() {
            return controlPoints2d;
        }

        public void setControlPoints2d(List<Vector2D> controlPoints2d) {
            this.controlPoints2d = controlPoints2d;
        }

        public List<Vector3D> getControlPoints3d() {
            return controlPoints3d;
        }

        public void setControlPoints3d(List<Vector3D> controlPoints3d) {
            this.controlPoints3d = controlPoints3d;
        }

        public boolean isAnimated() {
            return animated;
        }

        public void setAnimated(boolean animated) {
            this.animated = animated;
        }

        public Double getAnimationSpeed() {
            return animationSpeed;
        }

        public void setAnimationSpeed(Double animationSpeed) {
            this.animationSpeed = animationSpeed;
        }

        public Map<String, Object> getStyle() {
            return style;
        }

        public void setStyle(Map<String, Object> style) {
            this.style = style;
        }
    }

    public static class Lane {
        private UUID id;
        private String name;
        private String label;
        private String description;
        private LaneOrientation orientation = LaneOrientation.HORIZONTAL;
        @JsonProperty("order_index")
        private Integer orderIndex;
        @JsonProperty("node_ids")
        private List<UUID> nodeIds = new ArrayList<>();
        @JsonProperty("role_id")
        private UUID roleId;
        @JsonProperty("organization_id")
        private UUID organizationId;
        private String color;
        private boolean collapsed = false;

        public UUID getId() {
            return id;
        }

        public void setId(UUID id) {
            this.id = id;
        }

        public String getName() {
            return name;
        }

        public void setName(String name) {
            this.name = name;
        }

        public String getLabel() {
            return label;
        }

        public void setLabel(String label) {
            this.label = label;
        }

        public String getDescription() {
            return description;
        }

        public void setDescription(String description) {
            this.description = description;
        }

        public LaneOrientation getOrientation() {
            return orientation;
        }

        public void setOrientation(LaneOrientation orientation) {
            this.orientation = orientation;
        }

        public Integer getOrderIndex() {
            return orderIndex;
        }

        public void setOrderIndex(Integer orderIndex) {
            this.orderIndex = orderIndex;
        }

        public List<UUID> getNodeIds() {
            return nodeIds;
        }

        public void setNodeIds(List<UUID> nodeIds) {
            this.nodeIds = nodeIds;
        }

        public UUID getRoleId() {
            return roleId;
        }

        public void setRoleId(UUID roleId) {
            this.roleId = roleId;
        }

        public UUID getOrganizationId() {
            return organizationId;
        }

        public void setOrganizationId(UUID organizationId) {
            this.organizationId = organizationId;
        }

        public String getColor() {
            return color;
        }

        public void setColor(String color) {
            this.color = color;
        }

        public boolean isCollapsed() {
            return collapsed;
        }

        public void setCollapsed(boolean collapsed) {
            this.collapsed = collapsed;
        }
    }

    public static class AutoLayoutConfig {
        private LayoutAlgorithm algorithm = LayoutAlgorithm.DAGRE;
        private LayoutDirection direction = LayoutDirection.LR;
        @JsonProperty("node_spacing")
        private double nodeSpacing = 50;
        @JsonProperty("rank_spacing")
        private double rankSpacing = 100;
        @JsonProperty("edge_spacing")
        private double edgeSpacing = 10;
        private String align;
        @JsonProperty("elk_options")
        private Map<String, Object> elkOptions;
        @JsonProperty("respect_lanes")
        private boolean respectLanes = true;

        public LayoutAlgorithm getAlgorithm() {
            return algorithm;
        }

        public void setAlgorithm(LayoutAlgorithm algorithm) {
            this.algorithm = algorithm;
        }

        public LayoutDirection getDirection() {
            return direction;
        }

        public void setDirection(LayoutDirection direction) {
            this.direction = direction;
        }

        public double getNodeSpacing() {
            return nodeSpacing;
        }

        public void setNodeSpacing(double nodeSpacing) {
            this.nodeSpacing = nodeSpacing;
        }

        public double getRankSpacing() {
            return rankSpacing;
        }

        public void setRankSpacing(double rankSpacing) {
            this.rankSpacing = rankSpacing;
        }

        public double getEdgeSpacing() {
            return edgeSpacing;
        }

        public void setEdgeSpacing(double edgeSpacing) {
            this.edgeSpacing = edgeSpacing;
        }

        public String getAlign() {
            return align;
        }

        public void setAlign(String align) {
            this.align = align;
        }

        public Map<String, Object> getElkOptions() {
            return elkOptions;
        }

        public void setElkOptions(Map<String, Object> elkOptions) {
            this.elkOptions = elkOptions;
        }

        public boolean isRespectLanes() {
            return respectLanes;
        }

        public void setRespectLanes(boolean respectLanes) {
            this.respectLanes = respectLanes;
        }
    }

    public static class CameraSettings2D {
        private Vector2D center;
        private double zoom = 1.0;
        @JsonProperty("min_zoom")
        private double minZoom = 0.1;
        @JsonProperty("max_zoom")
        private double maxZoom = 4.0;
        @JsonProperty("fit_view")
        private boolean fitView = true;
        @JsonProperty("fit_padding")
        private double fitPadding = 50;

        public Vector2D getCenter() {
            return center;
        }

        public void setCenter(Vector2D center) {
            this.center = center;
        }

        public double getZoom() {
            return zoom;
        }

        public void setZoom(double zoom) {
            this.zoom = zoom;
        }

        public double getMinZoom() {
            return minZoom;
        }

        public void setMinZoom(double minZoom) {
            this.minZoom = minZoom;
        }

        public double getMaxZoom() {
            return maxZoom;
        }

        public void setMaxZoom(double maxZoom) {
            this.maxZoom = maxZoom;
        }

        public boolean isFitView() {
            return fitView;
        }

        public void setFitView(boolean fitView) {
            this.fitView = fitView;
        }

        public double getFitPadding() {
            return fitPadding;
        }

        public void setFitPadding(double fitPadding) {
            this.fitPadding = fitPadding;
        }
    }

    public static class CameraSettings3D {
        private CameraType type = CameraType.ARC_ROTATE;
        private Vector3D position;
        private Vector3D target;
        private double fov = 45;
        @JsonProperty("near_clip")
        private double nearClip = 0.1;
        @JsonProperty("far_clip")
        private double farClip = 1000;
        private Double alpha;
        private Double beta;
        private Double radius;

        public CameraType getType() {
            return type;
        }

        public void setType(CameraType type) {
            this.type = type;
        }

        public Vector3D getPosition() {
            return position;
        }

        public void setPosition(Vector3D position) {
            this.position = position;
        }

        public Vector3D getTarget() {
            return target;
        }

        public void setTarget(Vector3D target) {
            this.target = target;
        }

        public double getFov() {
            return fov;
        }

        public void setFov(double fov) {
            this.fov = fov;
        }

        public double getNearClip() {
            return nearClip;
        }

        public void setNearClip(double nearClip) {
            this.nearClip = nearClip;
        }

        public double getFarClip() {
            return farClip;
        }

        public void setFarClip(double farClip) {
            this.farClip = farClip;
        }

        public Double getAlpha() {
            return alpha;
        }

        public void setAlpha(Double alpha) {
            this.alpha = alpha;
        }

        public Double getBeta() {
            return beta;
        }

        public void setBeta(Double beta) {
            this.beta = beta;
        }

        public Double getRadius() {
            return radius;
        }

        public void setRadius(Double radius) {
            this.radius = radius;
        }
    }

    public static class AnimationConfig {
        private boolean enabled = true;
        @JsonProperty("transition_duration")
        private int transitionDuration = 300;
        private AnimationEasing easing = AnimationEasing.EASE_IN_OUT;
        @JsonProperty("edge_flow_enabled")
        private boolean edgeFlowEnabled = false;
        @JsonProperty("edge_flow_speed")
        private double edgeFlowSpeed = 1.0;
        @JsonProperty("highlight_active_path")
        private boolean highlightActivePath = true;
        @JsonProperty("playback_speed")
        private double playbackSpeed = 1.0;

        public boolean isEnabled() {
            return enabled;
        }

        public void setEnabled(boolean enabled) {
            this.enabled = enabled;
        }

        public int getTransitionDuration() {
            return transitionDuration;
        }

        public void setTransitionDuration(int transitionDuration) {
            this.transitionDuration = transitionDuration;
        }

        public AnimationEasing getEasing() {
            return easing;
        }

        public void setEasing(AnimationEasing easing) {
            this.easing = easing;
        }

        public boolean isEdgeFlowEnabled() {
            return edgeFlowEnabled;
        }

        public void setEdgeFlowEnabled(boolean edgeFlowEnabled) {
            this.edgeFlowEnabled = edgeFlowEnabled;
        }

        public double getEdgeFlowSpeed() {
            return edgeFlowSpeed;
        }

        public void setEdgeFlowSpeed(double edgeFlowSpeed) {
            this.edgeFlowSpeed = edgeFlowSpeed;
        }

        public boolean isHighlightActivePath() {
            return highlightActivePath;
        }

        public void setHighlightActivePath(boolean highlightActivePath) {
            this.highlightActivePath = highlightActivePath;
        }

        public double getPlaybackSpeed() {
            return playbackSpeed;
        }

        public void setPlaybackSpeed(double playbackSpeed) {
            this.playbackSpeed = playbackSpeed;
        }
    }

    public static class ThemeConfig {
        @JsonProperty("background_color")
        private String backgroundColor;
        @JsonProperty("grid_enabled")
        private boolean gridEnabled = true;
        @JsonProperty("grid_size")
        private double gridSize = 20;
        @JsonProperty("grid_color")
        private String gridColor;
        @JsonProperty("minimap_enabled")
        private boolean minimapEnabled = true;
        @JsonProperty("controls_enabled")
        private boolean controlsEnabled = true;

        public String getBackgroundColor() {
            return backgroundColor;
        }

        public void setBackgroundColor(String backgroundColor) {
            this.backgroundColor = backgroundColor;
        }

        public boolean isGridEnabled() {
            return gridEnabled;
        }

        public void setGridEnabled(boolean gridEnabled) {
            this.gridEnabled = gridEnabled;
        }

        public double getGridSize() {
            return gridSize;
        }

        public void setGridSize(double gridSize) {
            this.gridSize = gridSize;
        }

        public String getGridColor() {
            return gridColor;
        }

        public void setGridColor(String gridColor) {
            this.gridColor = gridColor;
        }

        public boolean isMinimapEnabled() {
            return minimapEnabled;
        }

        public void setMinimapEnabled(boolean minimapEnabled) {
            this.minimapEnabled = minimapEnabled;
        }

        public boolean isControlsEnabled() {
            return controlsEnabled;
        }

        public void setControlsEnabled(boolean controlsEnabled) {
            this.controlsEnabled = controlsEnabled;
        }
    }
}
