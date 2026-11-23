package io.awa.model;

import com.fasterxml.jackson.annotation.JsonProperty;
import jakarta.validation.constraints.NotBlank;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.util.List;
import java.util.Map;
import java.util.UUID;

/**
 * What must be true of an activity's outcome, whatever strategy the actor used
 * (specification section 11).
 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class OutcomeContract extends AwaObject {

    /** JSON Schema (2020-12) the outcome must validate against. */
    @JsonProperty("output_schema")
    private Map<String, Object> outputSchema;

    private List<Postcondition> postconditions;

    private Budgets budgets;

    /** What happens when the outcome is rejected and no automatic attempt remains. Schema default: fail. */
    @JsonProperty("on_violation")
    private OnViolation onViolation;

    public enum OnViolation {
        @JsonProperty("fail") FAIL,
        @JsonProperty("escalate_human") ESCALATE_HUMAN
    }

    /** A condition expression that must be true of the outcome. */
    @Data
    @Builder
    @NoArgsConstructor
    @AllArgsConstructor
    public static class Postcondition extends AwaObject {
        private UUID id;

        @NotBlank
        private String name;

        private String description;

        @NotBlank
        private String expression;
    }

    /** Limits on one visit of the activity (section 11.4). */
    @Data
    @Builder
    @NoArgsConstructor
    @AllArgsConstructor
    public static class Budgets extends AwaObject {
        /** Most executions of the actor for one visit, for any reason; between 1 and 50. */
        @JsonProperty("max_attempts")
        private Integer maxAttempts;

        /** Longest a single attempt may take, as an ISO 8601 duration. */
        @JsonProperty("max_duration")
        private String maxDuration;

        /** Most model tokens, input plus output, the visit may consume, judge tokens included. */
        @JsonProperty("max_tokens")
        private Long maxTokens;

        /** Most tool calls allowed in one attempt. Schema default: 16. */
        @JsonProperty("max_tool_calls")
        private Integer maxToolCalls;
    }
}
