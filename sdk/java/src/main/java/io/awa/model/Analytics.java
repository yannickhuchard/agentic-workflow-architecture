package io.awa.model;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.util.ArrayList;
import java.util.List;

/**
 * Analytics - value stream mapping metrics
 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class Analytics {

    private String processTime;
    private String cycleTime;
    private String leadTime;
    private String waitTime;
    private Boolean valueAdded;
    @Builder.Default
    private List<WasteCategory> wasteCategories = new ArrayList<>();
    private Cost cost;
    private Double resourceUtilization;
    private Double errorRate;
    private Throughput throughput;
    private Double processCycleEfficiency;

    public enum WasteCategory {
        DEFECTS, OVERPRODUCTION, WAITING, NON_UTILIZED_TALENT,
        TRANSPORT, INVENTORY, MOTION, EXTRA_PROCESSING
    }

    @Data
    @Builder
    @NoArgsConstructor
    @AllArgsConstructor
    public static class Cost {
        private Double amount;
        private String currency;
    }

    @Data
    @Builder
    @NoArgsConstructor
    @AllArgsConstructor
    public static class Throughput {
        private Double value;
        private String unit;
        private String period;
    }
}
