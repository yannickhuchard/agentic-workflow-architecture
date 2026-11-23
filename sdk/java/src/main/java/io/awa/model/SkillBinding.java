package io.awa.model;

import com.fasterxml.jackson.annotation.JsonProperty;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.util.UUID;

/**
 * Knowledge or competency required to perform an activity or traverse an edge
 * ({@code awa.schema.json#/$defs/skill_binding}).
 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class SkillBinding extends AwaObject {

    @NotNull
    private UUID id;

    @NotBlank
    private String name;

    @NotNull
    private SkillType type;

    private String description;

    @JsonProperty("min_level")
    private String minLevel;

    /** External reference URI. */
    private String reference;

    public enum SkillType {
        @JsonProperty("ai_context") AI_CONTEXT,
        @JsonProperty("human_competency") HUMAN_COMPETENCY
    }
}
