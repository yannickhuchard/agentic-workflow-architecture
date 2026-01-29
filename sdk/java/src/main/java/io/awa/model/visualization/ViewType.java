package io.awa.model.visualization;

/**
 * View type for 2D or 3D visualization
 */
public enum ViewType {
    DIMENSION_2D("2d"),
    DIMENSION_3D("3d");

    private final String value;

    ViewType(String value) {
        this.value = value;
    }

    public String getValue() {
        return value;
    }

    public static ViewType fromValue(String value) {
        for (ViewType type : values()) {
            if (type.value.equals(value)) {
                return type;
            }
        }
        throw new IllegalArgumentException("Unknown ViewType: " + value);
    }
}
