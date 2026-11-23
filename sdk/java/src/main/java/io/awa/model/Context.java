package io.awa.model;

import com.fasterxml.jackson.annotation.JsonProperty;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.util.Map;
import java.util.UUID;

/**
 * Shared data that actors collaborate through (specification sections 8.4 and 22,
 * {@code context.schema.json}).
 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class Context extends AwaObject {

    @NotNull
    private UUID id;

    @NotBlank
    private String name;

    /** Purpose and usage, for the actors. */
    private String description;

    @NotNull
    private ContextType type;

    /** JSON Schema of the context's value. A write that does not satisfy it is refused. */
    private Map<String, Object> schema;

    /** Initial value: any JSON value. */
    @JsonProperty("initial_value")
    private Object initialValue;

    @NotNull
    @JsonProperty("sync_pattern")
    private SyncPattern syncPattern;

    /** Schema default: {@link Visibility#WORKFLOW}. */
    private Visibility visibility;

    @JsonProperty("owner_workflow_id")
    private UUID ownerWorkflowId;

    /** Schema default: {@link Lifecycle#PERSISTENT}. */
    private Lifecycle lifecycle;

    /** Time to live of a transient context, as an ISO 8601 duration. */
    private String ttl;
}
