package io.awa.model.journey;

import com.fasterxml.jackson.annotation.JsonProperty;
import io.awa.model.AwaObject;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.util.List;
import java.util.UUID;

/**
 * A stage of a journey (specification section 19.2).
 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class JourneyStage extends AwaObject {

    /** Pattern {@code ^[a-z0-9][a-z0-9_-]{0,63}$}. */
    @NotBlank
    private String id;

    @NotBlank
    private String name;

    private String description;

    /** Runs of these workflows belong to this stage. */
    private List<UUID> workflows;

    /** Started automatically when the stage is entered. */
    @JsonProperty("on_enter")
    private OnEnter onEnter;

    /** Condition expression over the journey's data; the stage is complete when it is true. */
    @JsonProperty("complete_when")
    private String completeWhen;

    /** A journey that stays longer in the stage is stalled. ISO 8601 duration. */
    @JsonProperty("max_duration")
    private String maxDuration;

    /** Who must act when the journey stalls in this stage: a team, a role or a person. */
    private String owner;

    /**
     * Where the journey goes when the stage completes. Absent: the next stage in the list.
     * Empty: the journey completes here.
     */
    private List<Transition> transitions;

    @Data
    @Builder
    @NoArgsConstructor
    @AllArgsConstructor
    public static class OnEnter extends AwaObject {
        @NotNull
        @JsonProperty("start_workflow")
        private UUID startWorkflow;
    }

    @Data
    @Builder
    @NoArgsConstructor
    @AllArgsConstructor
    public static class Transition extends AwaObject {
        /** Id of the stage entered. */
        @NotBlank
        private String to;

        private String condition;

        /** Schema default: false. */
        @JsonProperty("is_default")
        private Boolean isDefault;
    }
}
