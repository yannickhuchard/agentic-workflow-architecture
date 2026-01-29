package io.awa.model;

import com.fasterxml.jackson.annotation.JsonProperty;
import jakarta.validation.constraints.NotNull;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.util.Map;
import java.util.UUID;

/**
 * Context entity for shared data/artifacts between agents
 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class Context {

    @NotNull
    private UUID id;

    @NotNull
    private String name;

    private String description;

    @NotNull
    private ContextType type;

    private Map<String, Object> schema;

    @JsonProperty("initial_value")
    private Object initialValue;

    @NotNull
    @JsonProperty("sync_pattern")
    private SyncPattern syncPattern;

    @Builder.Default
    private Visibility visibility = Visibility.WORKFLOW;

    @JsonProperty("owner_workflow_id")
    private UUID ownerWorkflowId;

    @Builder.Default
    private Lifecycle lifecycle = Lifecycle.PERSISTENT;

    private String ttl;
}
