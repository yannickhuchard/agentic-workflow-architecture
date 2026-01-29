package io.awa.model;

/**
 * Permission types for access rights
 */
public enum Permission {
    READ("read"),
    WRITE("write"),
    EXECUTE("execute"),
    ADMIN("admin"),
    DELETE("delete"),
    CREATE("create");

    private final String value;

    Permission(String value) {
        this.value = value;
    }

    public String getValue() {
        return value;
    }

    public static Permission fromValue(String value) {
        for (Permission perm : values()) {
            if (perm.value.equals(value)) {
                return perm;
            }
        }
        throw new IllegalArgumentException("Unknown permission: " + value);
    }
}
