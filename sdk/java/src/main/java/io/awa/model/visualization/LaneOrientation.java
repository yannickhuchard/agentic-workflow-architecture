package io.awa.model.visualization;

import com.fasterxml.jackson.annotation.JsonCreator;
import com.fasterxml.jackson.annotation.JsonValue;

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

    @JsonValue
    public String getValue() {
        return value;
    }

    @JsonCreator
    public static LaneOrientation fromValue(String value) {
        for (LaneOrientation orientation : values()) {
            if (orientation.value.equals(value)) {
                return orientation;
            }
        }
        throw new IllegalArgumentException("Unknown LaneOrientation: " + value);
    }
}
