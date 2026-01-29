package io.awa.model;

import com.fasterxml.jackson.annotation.JsonProperty;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.time.OffsetDateTime;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

/**
 * Workflow entity representing a directed graph of agentic activities
 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class Workflow {

    @NotNull
    private UUID id;

    @NotBlank
    private String name;

    @NotBlank
    private String version;

    private String description;

    @JsonProperty("owner_id")
    private UUID ownerId;

    @JsonProperty("organization_id")
    private UUID organizationId;

    @JsonProperty("parent_workflow_id")
    private UUID parentWorkflowId;

    @JsonProperty("expansion_activity_id")
    private UUID expansionActivityId;

    @NotNull
    @Builder.Default
    private List<Activity> activities = new ArrayList<>();

    @NotNull
    @Builder.Default
    private List<Edge> edges = new ArrayList<>();

    @Builder.Default
    private List<Event> events = new ArrayList<>();

    @JsonProperty("decision_nodes")
    @Builder.Default
    private List<DecisionNode> decisionNodes = new ArrayList<>();

    @Builder.Default
    private List<Context> contexts = new ArrayList<>();

    private SLA sla;

    private Analytics analytics;

    @Builder.Default
    private Map<String, Object> metadata = new HashMap<>();

    @JsonProperty("created_at")
    private OffsetDateTime createdAt;

    @JsonProperty("updated_at")
    private OffsetDateTime updatedAt;
}
