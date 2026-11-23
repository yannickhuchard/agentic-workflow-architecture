package io.awa.model;

import com.fasterxml.jackson.annotation.JsonProperty;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.math.BigDecimal;
import java.util.List;

/**
 * What the engine does when the actor of an activity raises an error
 * (specification section 10.1). Durations are ISO 8601 strings.
 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class RetryPolicy extends AwaObject {

    /** Total executions allowed, including the first; between 1 and 20. Schema default: 1. */
    @JsonProperty("max_attempts")
    private Integer maxAttempts;

    /** Delay before the second attempt. Schema default: PT1S. */
    @JsonProperty("initial_delay")
    private String initialDelay;

    /** Upper bound on the delay between attempts. Schema default: PT30S. */
    @JsonProperty("max_delay")
    private String maxDelay;

    /** Factor applied to the delay after each failed attempt; at least 1. Schema default: 2. */
    @JsonProperty("backoff_multiplier")
    private BigDecimal backoffMultiplier;

    /** Vary each delay randomly by up to 25%. Schema default: true. */
    private Boolean jitter;

    /** Error codes that end the activity immediately. */
    @JsonProperty("non_retryable_errors")
    private List<String> nonRetryableErrors;
}
