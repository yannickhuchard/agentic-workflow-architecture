package io.awa.model;

import com.fasterxml.jackson.annotation.JsonProperty;
import jakarta.validation.constraints.NotEmpty;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.math.BigDecimal;
import java.util.List;
import java.util.Map;

/**
 * Acceptance verification applied to an activity's output (specification section 7).
 * An output that is not verified as {@code pass} is rejected.
 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class VerificationPolicy extends AwaObject {

    /** Schema default: true. */
    private Boolean enabled;

    /** Schema default: {@link Mode#AI_JUDGE}. */
    private Mode mode;

    @NotEmpty
    private List<VerificationCriterion> criteria;

    /** Between 0 and 10. Schema default: 3. */
    @JsonProperty("max_retries")
    private Integer maxRetries;

    /** Feed the failed criteria back to an {@code ai_agent} actor on retry. Schema default: true. */
    @JsonProperty("retry_with_feedback")
    private Boolean retryWithFeedback;

    /** JSON Schema the output must satisfy. */
    @JsonProperty("output_schema")
    private Map<String, Object> outputSchema;

    /** Model reference for the judge (section 12). Absent: the engine default. */
    @JsonProperty("judge_model_id")
    private String judgeModelId;

    /** Between 0 and 1. Schema default: 0.1. */
    @JsonProperty("judge_temperature")
    private BigDecimal judgeTemperature;

    /** Between 0 and 1. Schema default: 0.9. */
    @JsonProperty("pass_threshold")
    private BigDecimal passThreshold;

    public enum Mode {
        /** A model evaluates each criterion. */
        @JsonProperty("ai_judge") AI_JUDGE,
        /** Only criterion expressions are evaluated, deterministically. */
        @JsonProperty("schema_only") SCHEMA_ONLY,
        /** A verifier registered with the engine. */
        @JsonProperty("custom") CUSTOM
    }
}
