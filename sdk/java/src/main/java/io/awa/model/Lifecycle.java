package io.awa.model;

import com.fasterxml.jackson.annotation.JsonCreator;
import com.fasterxml.jackson.annotation.JsonValue;

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

    @JsonValue
    public String getValue() {
        return value;
    }

    @JsonCreator
    public static Lifecycle fromValue(String value) {
        for (Lifecycle l : values()) {
            if (l.value.equals(value)) {
                return l;
            }
        }
        throw new IllegalArgumentException("Unknown lifecycle: " + value);
    }
}
