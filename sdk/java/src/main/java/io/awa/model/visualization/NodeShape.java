package io.awa.model.visualization;

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

    public String getValue() {
        return value;
    }

    public static NodeShape fromValue(String value) {
        for (NodeShape shape : values()) {
            if (shape.value.equals(value)) {
                return shape;
            }
        }
        throw new IllegalArgumentException("Unknown NodeShape: " + value);
    }
}
