package io.awa.model;

import com.fasterxml.jackson.annotation.JsonProperty;
import io.awa.model.visualization.VisualizationConfig;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.util.List;
import java.util.Map;
import java.util.UUID;

/**
 * A workflow: a directed graph of activities, events and decision nodes
 * (specification section 8.1, {@code workflow.schema.json}).
 *
 * <p>Absent properties are {@code null}. Timestamps are kept as the strings the document
 * holds (ISO 8601 date-time with offset), so that they are written back unchanged.
 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class Workflow extends AwaObject {

    /** The specification version this SDK reads and writes. */
    public static final String AWA_VERSION = "1.1";

    @NotNull
    private UUID id;

    @NotBlank
    private String name;

    /** Semantic version of this workflow, e.g. {@code 1.0.0}. */
    @NotBlank
    private String version;

    /** Version of the AWA specification the document targets, e.g. {@code 1.1}. */
    @JsonProperty("awa_version")
    private String awaVersion;

    private String description;

    @JsonProperty("owner_id")
    private UUID ownerId;

    @JsonProperty("organization_id")
    private UUID organizationId;

    @JsonProperty("parent_workflow_id")
    private UUID parentWorkflowId;

    @JsonProperty("expansion_activity_id")
    private UUID expansionActivityId;

    /** Roles referenced by activities. A deployment may supply or override them. */
    private List<Role> roles;

    @NotNull
    private List<Activity> activities;

    @NotNull
    private List<Edge> edges;

    private List<Event> events;

    @JsonProperty("decision_nodes")
    private List<DecisionNode> decisionNodes;

    private List<Context> contexts;

    /** Service level of the run as a whole (section 23). */
    private SLA sla;

    private Analytics analytics;

    private Map<String, Object> metadata;

    /** Default visualization configuration. */
    private VisualizationConfig visualization;

    @JsonProperty("alternate_visualizations")
    private List<VisualizationConfig> alternateVisualizations;

    @JsonProperty("created_at")
    private String createdAt;

    @JsonProperty("updated_at")
    private String updatedAt;

    /** Guardrails on every activity of the workflow (section 31). */
    private List<Guardrail> guardrails;
}
