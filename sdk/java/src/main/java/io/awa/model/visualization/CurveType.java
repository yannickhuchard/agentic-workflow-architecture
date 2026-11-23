package io.awa.model.visualization;

import com.fasterxml.jackson.annotation.JsonCreator;
import com.fasterxml.jackson.annotation.JsonValue;

/**
 * Curve type for edge rendering
 */
public enum CurveType {
    BEZIER("bezier"),
    STEP("step"),
    SMOOTHSTEP("smoothstep"),
    STRAIGHT("straight");

    private final String value;

    CurveType(String value) {
        this.value = value;
    }

    @JsonValue
    public String getValue() {
        return value;
    }

    @JsonCreator
    public static CurveType fromValue(String value) {
        for (CurveType type : values()) {
            if (type.value.equals(value)) {
                return type;
            }
        }
        throw new IllegalArgumentException("Unknown CurveType: " + value);
    }
}
