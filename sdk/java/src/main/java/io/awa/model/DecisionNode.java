package io.awa.model;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.util.List;
import java.util.UUID;

/**
 * DecisionNode - decision table logic
 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class DecisionNode {

    private UUID id;
    private String name;
    private String description;
    private DecisionTable decisionTable;
    private UUID defaultOutputEdgeId;

    @Data
    @Builder
    @NoArgsConstructor
    @AllArgsConstructor
    public static class DecisionTable {
        private HitPolicy hitPolicy;
        private List<TableColumn> inputs;
        private List<TableColumn> outputs;
        private List<DecisionRule> rules;
    }

    @Data
    @Builder
    @NoArgsConstructor
    @AllArgsConstructor
    public static class TableColumn {
        private String name;
        private String label;
        private String type;
        private List<Object> allowedValues;
    }

    @Data
    @Builder
    @NoArgsConstructor
    @AllArgsConstructor
    public static class DecisionRule {
        private UUID id;
        private String description;
        private List<String> inputEntries;
        private List<Object> outputEntries;
        private UUID outputEdgeId;
    }

    public enum HitPolicy {
        UNIQUE, FIRST, PRIORITY, ANY, COLLECT, RULE_ORDER
    }
}
