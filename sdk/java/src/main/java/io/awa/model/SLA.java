package io.awa.model;

import com.fasterxml.jackson.annotation.JsonProperty;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.math.BigDecimal;
import java.util.List;
import java.util.UUID;

/**
 * Service level of a workflow run or of an activity (specification section 23,
 * {@code sla.schema.json}). Durations are ISO 8601 strings.
 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class SLA extends AwaObject {

    private UUID id;

    private String name;

    /** Target completion time. Missing it is a warning. */
    @JsonProperty("target_time")
    private String targetTime;

    /** Maximum allowed time. Exceeding it is a breach. */
    @JsonProperty("max_time")
    private String maxTime;

    @JsonProperty("escalation_policy")
    private EscalationPolicy escalationPolicy;

    private List<SLAMetric> metrics;

    /** What happens as the time limit approaches and when it is breached (section 23.3). */
    @Data
    @Builder
    @NoArgsConstructor
    @AllArgsConstructor
    public static class EscalationPolicy extends AwaObject {
        @JsonProperty("warning_threshold")
        private String warningThreshold;

        @JsonProperty("warning_action")
        private String warningAction;

        /** For example {@code fail}, which stops work that is still waited for. */
        @JsonProperty("breach_action")
        private String breachAction;

        /** Roles to notify. */
        @JsonProperty("notify_roles")
        private List<UUID> notifyRoles;
    }

    @Data
    @Builder
    @NoArgsConstructor
    @AllArgsConstructor
    public static class SLAMetric extends AwaObject {
        @NotBlank
        private String name;

        @NotNull
        private BigDecimal target;

        private String unit;

        private Comparison comparison;
    }

    public enum Comparison {
        @JsonProperty("lt") LT,
        @JsonProperty("lte") LTE,
        @JsonProperty("eq") EQ,
        @JsonProperty("gte") GTE,
        @JsonProperty("gt") GT
    }
}
