package io.awa.model;

import com.fasterxml.jackson.annotation.JsonCreator;
import com.fasterxml.jackson.annotation.JsonValue;

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

    @JsonValue
    public String getValue() {
        return value;
    }

    @JsonCreator
    public static AccessMode fromValue(String value) {
        for (AccessMode mode : values()) {
            if (mode.value.equals(value)) {
                return mode;
            }
        }
        throw new IllegalArgumentException("Unknown access mode: " + value);
    }
}
