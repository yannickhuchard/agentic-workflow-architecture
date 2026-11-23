package io.awa.model;

import com.fasterxml.jackson.annotation.JsonProperty;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.math.BigDecimal;
import java.util.UUID;

/**
 * One criterion of a {@link VerificationPolicy} (specification section 7).
 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class VerificationCriterion extends AwaObject {

    @NotNull
    private UUID id;

    @NotBlank
    private String name;

    /** What must be true of the output, in natural language. */
    @NotBlank
    private String description;

    @NotNull
    private CriterionType type;

    /** Condition expression evaluated against the output. Required for deterministic verification. */
    private String expression;

    /** Between 0 and 1. Schema default: 1. */
    private BigDecimal weight;

    /** If true, failing this criterion fails verification regardless of score. Schema default: true. */
    private Boolean required;

    public enum CriterionType {
        @JsonProperty("completeness") COMPLETENESS,
        @JsonProperty("accuracy") ACCURACY,
        @JsonProperty("format") FORMAT,
        @JsonProperty("compliance") COMPLIANCE,
        @JsonProperty("custom") CUSTOM
    }
}
