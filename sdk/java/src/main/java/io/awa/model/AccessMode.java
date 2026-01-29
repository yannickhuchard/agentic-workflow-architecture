package io.awa.model;

/**
 * Access modes for context bindings
 */
public enum AccessMode {
    READ("read"),
    WRITE("write"),
    READ_WRITE("read_write"),
    SUBSCRIBE("subscribe"),
    PUBLISH("publish");

    private final String value;

    AccessMode(String value) {
        this.value = value;
    }

    public String getValue() {
        return value;
    }

    public static AccessMode fromValue(String value) {
        for (AccessMode mode : values()) {
            if (mode.value.equals(value)) {
                return mode;
            }
        }
        throw new IllegalArgumentException("Unknown access mode: " + value);
    }
}
