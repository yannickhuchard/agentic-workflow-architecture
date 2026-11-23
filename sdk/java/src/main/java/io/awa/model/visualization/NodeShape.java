package io.awa.model.visualization;

import com.fasterxml.jackson.annotation.JsonCreator;
import com.fasterxml.jackson.annotation.JsonValue;

/**
 * Node shape for visualization
 */
public enum NodeShape {
    RECTANGLE("rectangle"),
    ROUNDED("rounded"),
    CIRCLE("circle"),
    DIAMOND("diamond"),
    HEXAGON("hexagon"),
    CYLINDER("cylinder"),
    CUBE("cube"),
    SPHERE("sphere");

    private final String value;

    NodeShape(String value) {
        this.value = value;
    }

    @JsonValue
    public String getValue() {
        return value;
    }

    @JsonCreator
    public static NodeShape fromValue(String value) {
        for (NodeShape shape : values()) {
            if (shape.value.equals(value)) {
                return shape;
            }
        }
        throw new IllegalArgumentException("Unknown NodeShape: " + value);
    }
}
