package io.awa.model;

import com.fasterxml.jackson.annotation.JsonCreator;
import com.fasterxml.jackson.annotation.JsonValue;

/**
 * Context types for shared data
 */
public enum ContextType {
    DOCUMENT("document"),
    DATA("data"),
    CONFIG("config"),
    STATE("state"),
    MEMORY("memory"),
    ARTIFACT("artifact");

    private final String value;

    ContextType(String value) {
        this.value = value;
    }

    @JsonValue
    public String getValue() {
        return value;
    }

    @JsonCreator
    public static ContextType fromValue(String value) {
        for (ContextType type : values()) {
            if (type.value.equals(value)) {
                return type;
            }
        }
        throw new IllegalArgumentException("Unknown context type: " + value);
    }
}
