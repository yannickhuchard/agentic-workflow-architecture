package io.awa.model;

import com.fasterxml.jackson.annotation.JsonCreator;
import com.fasterxml.jackson.annotation.JsonValue;

/**
 * Access direction for access rights
 */
public enum AccessDirection {
    REQUIRES("requires"),
    PROVISIONS("provisions");

    private final String value;

    AccessDirection(String value) {
        this.value = value;
    }

    @JsonValue
    public String getValue() {
        return value;
    }

    @JsonCreator
    public static AccessDirection fromValue(String value) {
        for (AccessDirection d : values()) {
            if (d.value.equals(value)) {
                return d;
            }
        }
        throw new IllegalArgumentException("Unknown access direction: " + value);
    }
}
