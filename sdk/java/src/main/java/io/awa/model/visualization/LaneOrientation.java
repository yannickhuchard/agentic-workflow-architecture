package io.awa.model.visualization;

/**
 * Lane orientation (horizontal or vertical swimlanes)
 */
public enum LaneOrientation {
    HORIZONTAL("horizontal"),
    VERTICAL("vertical");

    private final String value;

    LaneOrientation(String value) {
        this.value = value;
    }

    public String getValue() {
        return value;
    }

    public static LaneOrientation fromValue(String value) {
        for (LaneOrientation orientation : values()) {
            if (orientation.value.equals(value)) {
                return orientation;
            }
        }
        throw new IllegalArgumentException("Unknown LaneOrientation: " + value);
    }
}
