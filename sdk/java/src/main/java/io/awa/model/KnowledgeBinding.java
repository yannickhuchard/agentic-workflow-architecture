package io.awa.model;

import com.fasterxml.jackson.annotation.JsonProperty;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.util.List;

/**
 * Asks the engine to give the actor knowledge distilled from earlier runs of the activity
 * (specification section 15.4).
 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class KnowledgeBinding extends AwaObject {

    /** Kinds of entry given. Schema default: strategy and failure_pattern. */
    private List<KnowledgeType> types;

    /** Only entries carrying at least one of these tags. */
    private List<String> tags;

    /** Between 1 and 20. Schema default: 5. */
    @JsonProperty("max_entries")
    private Integer maxEntries;

    /** Schema default: {@link MinStatus#REVIEWED}. */
    @JsonProperty("min_status")
    private MinStatus minStatus;

    public enum KnowledgeType {
        @JsonProperty("strategy") STRATEGY,
        @JsonProperty("failure_pattern") FAILURE_PATTERN,
        @JsonProperty("decision_precedent") DECISION_PRECEDENT,
        @JsonProperty("lesson") LESSON
    }

    public enum MinStatus {
        /** Unreviewed entries as well. */
        @JsonProperty("draft") DRAFT,
        /** Only entries a person has reviewed. */
        @JsonProperty("reviewed") REVIEWED
    }
}
