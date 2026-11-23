package io.awa.model;

import com.fasterxml.jackson.annotation.JsonProperty;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotEmpty;
import jakarta.validation.constraints.NotNull;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.math.BigDecimal;
import java.util.List;
import java.util.Map;
import java.util.UUID;

/**
 * A decision gateway (specification sections 5.5 and 16, {@code decision.schema.json}).
 * A node has a decision table, an external decision engine or a decision model; a table
 * and an engine are not combined.
 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class DecisionNode extends AwaObject {

    @NotNull
    private UUID id;

    @NotBlank
    private String name;

    private String description;

    @JsonProperty("decision_table")
    private DecisionTable decisionTable;

    /** Edge taken if no rule matches. */
    @JsonProperty("default_output_edge_id")
    private UUID defaultOutputEdgeId;

    /** Lets a language model decide, within enumerated options (section 16). */
    @JsonProperty("decision_model")
    private DecisionModel decisionModel;

    /** Consults an external decision engine the deployment registers (section 5.5.4). */
    @JsonProperty("decision_engine")
    private DecisionEngine decisionEngine;

    @Data
    @Builder
    @NoArgsConstructor
    @AllArgsConstructor
    public static class DecisionTable extends AwaObject {
        @NotNull
        @JsonProperty("hit_policy")
        private HitPolicy hitPolicy;

        @NotEmpty
        private List<TableColumn> inputs;

        @NotEmpty
        private List<TableColumn> outputs;

        @NotNull
        private List<DecisionRule> rules;
    }

    @Data
    @Builder
    @NoArgsConstructor
    @AllArgsConstructor
    public static class TableColumn extends AwaObject {
        @NotBlank
        private String name;

        private String label;

        /** One of string, number, boolean, date, datetime. */
        @NotBlank
        private String type;

        @JsonProperty("allowed_values")
        private List<Object> allowedValues;
    }

    @Data
    @Builder
    @NoArgsConstructor
    @AllArgsConstructor
    public static class DecisionRule extends AwaObject {
        private UUID id;

        private String description;

        /** One entry per input column (section 5.5.1). */
        @NotNull
        @JsonProperty("input_entries")
        private List<String> inputEntries;

        /** One value or expression per output column. */
        @NotNull
        @JsonProperty("output_entries")
        private List<Object> outputEntries;

        /** Edge to follow when the rule matches. */
        @JsonProperty("output_edge_id")
        private UUID outputEdgeId;

        /** For hit policy priority: the matching rule with the highest value decides. Schema default: 0. */
        private BigDecimal priority;
    }

    /** DMN hit policy (section 5.5.2). */
    public enum HitPolicy {
        @JsonProperty("unique") UNIQUE,
        @JsonProperty("first") FIRST,
        @JsonProperty("priority") PRIORITY,
        @JsonProperty("any") ANY,
        @JsonProperty("collect") COLLECT,
        @JsonProperty("rule_order") RULE_ORDER
    }

    /**
     * One of the possible decisions of a decision model or a decision engine. Its id
     * matches {@code ^[A-Za-z0-9_-]{1,64}$}. The description is required for a decision
     * model and optional for an engine.
     */
    @Data
    @Builder
    @NoArgsConstructor
    @AllArgsConstructor
    public static class DecisionOption extends AwaObject {
        @NotBlank
        private String id;

        /** When this option applies. */
        private String description;

        /** Edge taken when the option is chosen. It must leave this node. */
        @NotNull
        @JsonProperty("output_edge_id")
        private UUID outputEdgeId;
    }

    /** A language model decides within enumerated options (section 16). */
    @Data
    @Builder
    @NoArgsConstructor
    @AllArgsConstructor
    public static class DecisionModel extends AwaObject {
        /** Model reference (section 12). Absent: the engine default. */
        private String model;

        /** How to decide, in natural language. */
        @NotBlank
        private String instructions;

        /** At least two. */
        @NotEmpty
        private List<DecisionOption> options;

        /** Token data properties the model is shown. Absent: all. */
        private List<String> inputs;

        /** Absent: table_first when the node has a table, otherwise model. */
        private Strategy strategy;

        /** A decision whose confidence is lower, or not stated, is no decision. Schema default: 0. */
        @JsonProperty("min_confidence")
        private BigDecimal minConfidence;

        /** Independent samples; the option with a strict majority is taken. 1 to 9; schema default 1. */
        private Integer votes;

        /** Between 0 and 2. */
        private BigDecimal temperature;

        /** Token data property that receives the id of the chosen option. */
        private String output;
    }

    public enum Strategy {
        /** Ask the model only when no rule of the table matches. */
        @JsonProperty("table_first") TABLE_FIRST,
        /** Always ask the model. */
        @JsonProperty("model") MODEL
    }

    /** An external decision engine the deployment registers (section 5.5.4). */
    @Data
    @Builder
    @NoArgsConstructor
    @AllArgsConstructor
    public static class DecisionEngine extends AwaObject {
        /** The engine, as registered by the deployment, e.g. {@code drools}. */
        @NotBlank
        private String name;

        /** What the engine should evaluate. Its meaning is the engine's. */
        private String ruleset;

        /** At least one. */
        @NotEmpty
        private List<DecisionOption> options;

        /** Token data properties the engine is given. Absent: all. */
        private List<String> inputs;

        private Map<String, Object> config;
    }
}
