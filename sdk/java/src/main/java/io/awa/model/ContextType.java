package io.awa.model;

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

    public String getValue() {
        return value;
    }

    public static ContextType fromValue(String value) {
        for (ContextType type : values()) {
            if (type.value.equals(value)) {
                return type;
            }
        }
        throw new IllegalArgumentException("Unknown context type: " + value);
    }
}
