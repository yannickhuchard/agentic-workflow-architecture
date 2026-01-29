package io.awa.model;

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

    public String getValue() {
        return value;
    }

    public static AccessDirection fromValue(String value) {
        for (AccessDirection d : values()) {
            if (d.value.equals(value)) {
                return d;
            }
        }
        throw new IllegalArgumentException("Unknown access direction: " + value);
    }
}
