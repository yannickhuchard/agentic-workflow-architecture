package io.awa.model;

import com.fasterxml.jackson.annotation.JsonCreator;
import com.fasterxml.jackson.annotation.JsonValue;

/**
 * Visibility levels for contexts
 */
public enum Visibility {
    PRIVATE("private"),
    WORKFLOW("workflow"),
    COLLECTION("collection"),
    GLOBAL("global");

    private final String value;

    Visibility(String value) {
        this.value = value;
    }

    @JsonValue
    public String getValue() {
        return value;
    }

    @JsonCreator
    public static Visibility fromValue(String value) {
        for (Visibility v : values()) {
            if (v.value.equals(value)) {
                return v;
            }
        }
        throw new IllegalArgumentException("Unknown visibility: " + value);
    }
}
