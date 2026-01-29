package io.awa.model.visualization;

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

    public String getValue() {
        return value;
    }

    public static LayoutDirection fromValue(String value) {
        for (LayoutDirection dir : values()) {
            if (dir.value.equals(value)) {
                return dir;
            }
        }
        throw new IllegalArgumentException("Unknown LayoutDirection: " + value);
    }
}
