package io.awa.model.visualization;

import com.fasterxml.jackson.annotation.JsonCreator;
import com.fasterxml.jackson.annotation.JsonValue;

/**
 * Layout direction for auto-layout algorithms
 */
public enum LayoutDirection {
    TB("tb"), // top-bottom
    BT("bt"), // bottom-top
    LR("lr"), // left-right
    RL("rl"); // right-left

    private final String value;

    LayoutDirection(String value) {
        this.value = value;
    }

    @JsonValue
    public String getValue() {
        return value;
    }

    @JsonCreator
    public static LayoutDirection fromValue(String value) {
        for (LayoutDirection dir : values()) {
            if (dir.value.equals(value)) {
                return dir;
            }
        }
        throw new IllegalArgumentException("Unknown LayoutDirection: " + value);
    }
}
