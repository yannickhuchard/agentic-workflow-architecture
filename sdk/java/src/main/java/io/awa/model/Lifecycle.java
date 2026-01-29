package io.awa.model;

/**
 * Lifecycle for contexts
 */
public enum Lifecycle {
    TRANSIENT("transient"),
    PERSISTENT("persistent"),
    CACHED("cached");

    private final String value;

    Lifecycle(String value) {
        this.value = value;
    }

    public String getValue() {
        return value;
    }

    public static Lifecycle fromValue(String value) {
        for (Lifecycle l : values()) {
            if (l.value.equals(value)) {
                return l;
            }
        }
        throw new IllegalArgumentException("Unknown lifecycle: " + value);
    }
}
