package io.awa.model.visualization;

import com.fasterxml.jackson.annotation.JsonProperty;
import io.awa.model.AwaObject;
import io.awa.model.NodeType;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.math.BigDecimal;
import java.util.List;
import java.util.Map;
import java.util.UUID;

/**
 * A visualization of a workflow, 2D or 3D ({@code visualization.schema.json#/$defs/visualization_config}).
 * Rendering is not part of this SDK; this type only holds the configuration.
 * Timestamps are kept as the strings the document holds.
 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class VisualizationConfig extends AwaObject {

    private UUID id;

    @JsonProperty("workflow_id")
    private UUID workflowId;

    private String name;

    private String description;

    @JsonProperty("is_default")
    private Boolean isDefault;

    @JsonProperty("view_type")
    private ViewType viewType;

    private VisualizationEngine engine;

    @JsonProperty("auto_layout")
    private AutoLayoutConfig autoLayout;

    @JsonProperty("node_positions_2d")
    private List<NodePosition2D> nodePositions2d;

    @JsonProperty("node_positions_3d")
    private List<NodePosition3D> nodePositions3d;

    @JsonProperty("edge_routings")
    private List<EdgeRouting> edgeRoutings;

    private List<Lane> lanes;

    @JsonProperty("camera_2d")
    private CameraSettings2D camera2d;

    @JsonProperty("camera_3d")
    private CameraSettings3D camera3d;

    private AnimationConfig animation;

    private ThemeConfig theme;

    private Map<String, Object> metadata;

    @JsonProperty("created_at")
    private String createdAt;

    @JsonProperty("updated_at")
    private String updatedAt;

    public VisualizationConfig(UUID id, UUID workflowId, ViewType viewType) {
        this.id = id;
        this.workflowId = workflowId;
        this.viewType = viewType;
    }

    /** A point in two dimensions. */
    @Data
    @Builder
    @NoArgsConstructor
    @AllArgsConstructor
    public static class Vector2D extends AwaObject {
        private BigDecimal x;

        private BigDecimal y;
    }

    /** A point or a scale in three dimensions. */
    @Data
    @Builder
    @NoArgsConstructor
    @AllArgsConstructor
    public static class Vector3D extends AwaObject {
        private BigDecimal x;

        private BigDecimal y;

        private BigDecimal z;
    }

    /** A rotation. */
    @Data
    @Builder
    @NoArgsConstructor
    @AllArgsConstructor
    public static class Quaternion extends AwaObject {
        private BigDecimal x;

        private BigDecimal y;

        private BigDecimal z;

        private BigDecimal w;
    }

    /** Where a node is drawn in a 2D view. */
    @Data
    @Builder
    @NoArgsConstructor
    @AllArgsConstructor
    public static class NodePosition2D extends AwaObject {
        private UUID id;

        @JsonProperty("node_id")
        private UUID nodeId;

        @JsonProperty("node_type")
        private NodeType nodeType;

        private Vector2D position;

        private BigDecimal width;

        private BigDecimal height;

        @JsonProperty("z_index")
        private Integer zIndex;

        private NodeShape shape;

        private Map<String, Object> style;

        private Boolean collapsed;
    }

    /** Where a node is drawn in a 3D view. */
    @Data
    @Builder
    @NoArgsConstructor
    @AllArgsConstructor
    public static class NodePosition3D extends AwaObject {
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

        private Boolean visible;
    }

    /** How an edge is drawn. */
    @Data
    @Builder
    @NoArgsConstructor
    @AllArgsConstructor
    public static class EdgeRouting extends AwaObject {
        private UUID id;

        @JsonProperty("edge_id")
        private UUID edgeId;

        @JsonProperty("curve_type")
        private CurveType curveType;

        @JsonProperty("control_points_2d")
        private List<Vector2D> controlPoints2d;

        @JsonProperty("control_points_3d")
        private List<Vector3D> controlPoints3d;

        private Boolean animated;

        @JsonProperty("animation_speed")
        private BigDecimal animationSpeed;

        private Map<String, Object> style;
    }

    /** A swim lane. */
    @Data
    @Builder
    @NoArgsConstructor
    @AllArgsConstructor
    public static class Lane extends AwaObject {
        private UUID id;

        private String name;

        private String label;

        private String description;

        private LaneOrientation orientation;

        @JsonProperty("order_index")
        private Integer orderIndex;

        @JsonProperty("node_ids")
        private List<UUID> nodeIds;

        @JsonProperty("role_id")
        private UUID roleId;

        @JsonProperty("organization_id")
        private UUID organizationId;

        /** CSS colour, hex or rgba. */
        private String color;

        private Boolean collapsed;
    }

    /** Automatic layout settings. */
    @Data
    @Builder
    @NoArgsConstructor
    @AllArgsConstructor
    public static class AutoLayoutConfig extends AwaObject {
        private LayoutAlgorithm algorithm;

        private LayoutDirection direction;

        @JsonProperty("node_spacing")
        private BigDecimal nodeSpacing;

        @JsonProperty("rank_spacing")
        private BigDecimal rankSpacing;

        @JsonProperty("edge_spacing")
        private BigDecimal edgeSpacing;

        /** One of ul, ur, dl, dr. */
        private String align;

        @JsonProperty("elk_options")
        private Map<String, Object> elkOptions;

        @JsonProperty("respect_lanes")
        private Boolean respectLanes;
    }

    /** Camera of a 2D view. */
    @Data
    @Builder
    @NoArgsConstructor
    @AllArgsConstructor
    public static class CameraSettings2D extends AwaObject {
        private Vector2D center;

        private BigDecimal zoom;

        @JsonProperty("min_zoom")
        private BigDecimal minZoom;

        @JsonProperty("max_zoom")
        private BigDecimal maxZoom;

        @JsonProperty("fit_view")
        private Boolean fitView;

        @JsonProperty("fit_padding")
        private BigDecimal fitPadding;
    }

    /** Camera of a 3D view. */
    @Data
    @Builder
    @NoArgsConstructor
    @AllArgsConstructor
    public static class CameraSettings3D extends AwaObject {
        private CameraType type;

        private Vector3D position;

        private Vector3D target;

        private BigDecimal fov;

        @JsonProperty("near_clip")
        private BigDecimal nearClip;

        @JsonProperty("far_clip")
        private BigDecimal farClip;

        private BigDecimal alpha;

        private BigDecimal beta;

        private BigDecimal radius;
    }

    /** Animation settings. */
    @Data
    @Builder
    @NoArgsConstructor
    @AllArgsConstructor
    public static class AnimationConfig extends AwaObject {
        private Boolean enabled;

        /** Milliseconds. */
        @JsonProperty("transition_duration")
        private Integer transitionDuration;

        private AnimationEasing easing;

        @JsonProperty("edge_flow_enabled")
        private Boolean edgeFlowEnabled;

        @JsonProperty("edge_flow_speed")
        private BigDecimal edgeFlowSpeed;

        @JsonProperty("highlight_active_path")
        private Boolean highlightActivePath;

        @JsonProperty("playback_speed")
        private BigDecimal playbackSpeed;
    }

    /** Visual theme. Other theme properties are kept in the additional properties. */
    @Data
    @Builder
    @NoArgsConstructor
    @AllArgsConstructor
    public static class ThemeConfig extends AwaObject {
        @JsonProperty("background_color")
        private String backgroundColor;

        @JsonProperty("grid_enabled")
        private Boolean gridEnabled;

        @JsonProperty("grid_size")
        private BigDecimal gridSize;

        @JsonProperty("grid_color")
        private String gridColor;

        @JsonProperty("minimap_enabled")
        private Boolean minimapEnabled;

        @JsonProperty("controls_enabled")
        private Boolean controlsEnabled;
    }
}
