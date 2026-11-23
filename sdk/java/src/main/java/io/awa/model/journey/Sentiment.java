package io.awa.model.journey;

import com.fasterxml.jackson.annotation.JsonProperty;
import io.awa.model.AwaObject;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.math.BigDecimal;
import java.util.List;

/**
 * How the subject's mood is estimated (specification section 19.9). A value is measured
 * (a rule reads it from what the subject said) or inferred (a rule moves it).
 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class Sentiment extends AwaObject {

    /** Schema default: -2. */
    private BigDecimal min;

    /** Schema default: 2. */
    private BigDecimal max;

    /** Schema default: 0. */
    private BigDecimal initial;

    /** A new journey begins with the mood the subject's previous journey ended with. Schema default: true. */
    @JsonProperty("carry_over")
    private Boolean carryOver;

    private List<Rule> rules;

    /** A rule has either {@code measure} or {@code change}. */
    @Data
    @Builder
    @NoArgsConstructor
    @AllArgsConstructor
    public static class Rule extends AwaObject {
        @NotNull
        private Occasion on;

        /** Narrows the rule to this event type. */
        private String event;

        /** Narrows the rule to this touchpoint id. */
        private String touchpoint;

        /** Narrows the rule to this goal id. */
        private String goal;

        /** Narrows the rule to this stage id. */
        private String stage;

        /** For {@code waited}: the subject acted and heard nothing for longer than this ISO 8601 duration. */
        @JsonProperty("longer_than")
        private String longerThan;

        /** Measured: read a value from the occasion's data. */
        private Measure measure;

        /** Inferred: move the mood by this much. */
        private BigDecimal change;

        private String reason;
    }

    public enum Occasion {
        @JsonProperty("event") EVENT,
        @JsonProperty("touchpoint") TOUCHPOINT,
        @JsonProperty("goal_reached") GOAL_REACHED,
        @JsonProperty("stage_completed") STAGE_COMPLETED,
        @JsonProperty("stalled") STALLED,
        @JsonProperty("run_failed") RUN_FAILED,
        @JsonProperty("waited") WAITED
    }

    /** Reads the value at {@code path}, given on the scale {@code from}, onto the journey's scale. */
    @Data
    @Builder
    @NoArgsConstructor
    @AllArgsConstructor
    public static class Measure extends AwaObject {
        @NotBlank
        private String path;

        /** Lowest and highest value of the scale the value is given on. */
        @NotNull
        @Size(min = 2, max = 2)
        private List<BigDecimal> from;
    }
}
