package io.awa.model;

import com.fasterxml.jackson.annotation.JsonProperty;
import jakarta.validation.constraints.NotNull;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.util.UUID;

/**
 * Edge entity - connection between nodes in the workflow graph
 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class Edge {

    @NotNull
    private UUID id;

    @NotNull
    @JsonProperty("source_id")
    private UUID sourceId;

    @NotNull
    @JsonProperty("target_id")
    private UUID targetId;

    @JsonProperty("source_type")
    private NodeType sourceType;

    @JsonProperty("target_type")
    private NodeType targetType;

    private String condition;

    private String label;

    @JsonProperty("is_default")
    @Builder.Default
    private boolean isDefault = false;
}
