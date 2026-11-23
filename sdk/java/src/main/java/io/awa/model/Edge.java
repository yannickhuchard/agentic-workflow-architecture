package io.awa.model;

import com.fasterxml.jackson.annotation.JsonProperty;
import jakarta.validation.constraints.NotNull;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.util.List;
import java.util.UUID;

/**
 * A directed connection between two nodes of a workflow (specification section 8.3).
 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class Edge extends AwaObject {

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

    /** Condition expression (section 6). */
    private String condition;

    private String label;

    /** Taken when no condition is true. Schema default: false. */
    @JsonProperty("is_default")
    private Boolean isDefault;

    /** Skills required to traverse this edge. */
    private List<SkillBinding> skills;

    /** Tools required to traverse this edge. */
    @JsonProperty("tool_requirements")
    private List<ToolRequirement> toolRequirements;
}
