package io.awa.model;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.util.ArrayList;
import java.util.List;
import java.util.UUID;

/**
 * SLA entity - service level agreements
 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class SLA {

    private UUID id;
    private String name;
    private String targetTime;
    private String maxTime;
    private EscalationPolicy escalationPolicy;
    @Builder.Default
    private List<SLAMetric> metrics = new ArrayList<>();

    @Data
    @Builder
    @NoArgsConstructor
    @AllArgsConstructor
    public static class EscalationPolicy {
        private String warningThreshold;
        private String warningAction;
        private String breachAction;
        @Builder.Default
        private List<UUID> notifyRoles = new ArrayList<>();
    }

    @Data
    @Builder
    @NoArgsConstructor
    @AllArgsConstructor
    public static class SLAMetric {
        private String name;
        private Double target;
        private String unit;
        private String comparison;
    }
}
