package io.awa.model;

import com.fasterxml.jackson.annotation.JsonProperty;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.util.UUID;

/**
 * A governance policy applied to an activity.
 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class Control extends AwaObject {

    @NotNull
    private UUID id;

    @NotBlank
    private String name;

    private String description;

    @NotNull
    private ControlType type;

    /** Executable policy expression. */
    private String expression;

    private Enforcement enforcement;

    public enum ControlType {
        @JsonProperty("authorization") AUTHORIZATION,
        @JsonProperty("validation") VALIDATION,
        @JsonProperty("audit") AUDIT,
        @JsonProperty("compliance") COMPLIANCE,
        @JsonProperty("security") SECURITY,
        @JsonProperty("rate_limit") RATE_LIMIT
    }

    public enum Enforcement {
        @JsonProperty("mandatory") MANDATORY,
        @JsonProperty("advisory") ADVISORY,
        @JsonProperty("informational") INFORMATIONAL
    }
}
