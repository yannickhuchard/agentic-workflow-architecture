package io.awa.model;

/**
 * Node types in the workflow graph
 */
public enum NodeType {
    ACTIVITY("activity"),
    EVENT("event"),
    DECISION("decision");

    private final String value;

    NodeType(String value) {
        this.value = value;
    }

    public String getValue() {
        return value;
    }

    public static NodeType fromValue(String value) {
        for (NodeType t : values()) {
            if (t.value.equals(value)) {
                return t;
            }
        }
        throw new IllegalArgumentException("Unknown node type: " + value);
    }
}
