package io.awa.model;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.util.UUID;

/**
 * Control - compliance/policy rules for activities
 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class Control {

    private UUID id;
    private String name;
    private String description;
    private ControlType type;
    private String expression;
    private Enforcement enforcement;

    public enum ControlType {
        AUTHORIZATION, VALIDATION, AUDIT, COMPLIANCE, SECURITY, RATE_LIMIT
    }

    public enum Enforcement {
        MANDATORY, ADVISORY, INFORMATIONAL
    }
}
