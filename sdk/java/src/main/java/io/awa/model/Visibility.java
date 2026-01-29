package io.awa.model;

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

    public String getValue() {
        return value;
    }

    public static Visibility fromValue(String value) {
        for (Visibility v : values()) {
            if (v.value.equals(value)) {
                return v;
            }
        }
        throw new IllegalArgumentException("Unknown visibility: " + value);
    }
}
