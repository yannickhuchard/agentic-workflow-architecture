package io.awa.model;

import com.fasterxml.jackson.annotation.JsonProperty;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.math.BigDecimal;
import java.util.List;

/**
 * Value stream mapping metrics of a workflow or an activity (specification section 8.6,
 * {@code analytics.schema.json}). Durations are ISO 8601 strings.
 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class Analytics extends AwaObject {

    @JsonProperty("process_time")
    private String processTime;

    @JsonProperty("cycle_time")
    private String cycleTime;

    @JsonProperty("lead_time")
    private String leadTime;

    @JsonProperty("wait_time")
    private String waitTime;

    @JsonProperty("value_added")
    private Boolean valueAdded;

    @JsonProperty("waste_categories")
    private List<WasteCategory> wasteCategories;

    private Cost cost;

    /** Between 0 and 1. */
    @JsonProperty("resource_utilization")
    private BigDecimal resourceUtilization;

    /** Between 0 and 1. */
    @JsonProperty("error_rate")
    private BigDecimal errorRate;

    private Throughput throughput;

    /** Share of time that is value-added, between 0 and 1. */
    @JsonProperty("process_cycle_efficiency")
    private BigDecimal processCycleEfficiency;

    /** Value stream mapping waste categories (DOWNTIME). */
    public enum WasteCategory {
        @JsonProperty("defects") DEFECTS,
        @JsonProperty("overproduction") OVERPRODUCTION,
        @JsonProperty("waiting") WAITING,
        @JsonProperty("non_utilized_talent") NON_UTILIZED_TALENT,
        @JsonProperty("transport") TRANSPORT,
        @JsonProperty("inventory") INVENTORY,
        @JsonProperty("motion") MOTION,
        @JsonProperty("extra_processing") EXTRA_PROCESSING
    }

    @Data
    @Builder
    @NoArgsConstructor
    @AllArgsConstructor
    public static class Cost extends AwaObject {
        private BigDecimal amount;

        /** ISO 4217 currency code. */
        private String currency;
    }

    @Data
    @Builder
    @NoArgsConstructor
    @AllArgsConstructor
    public static class Throughput extends AwaObject {
        private BigDecimal value;

        private String unit;

        private String period;
    }
}
