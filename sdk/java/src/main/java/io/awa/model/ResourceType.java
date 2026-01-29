package io.awa.model;

/**
 * Resource types for access rights
 */
public enum ResourceType {
    SYSTEM("system"),
    API("api"),
    DATABASE("database"),
    FILE("file"),
    SERVICE("service"),
    SECRET("secret");

    private final String value;

    ResourceType(String value) {
        this.value = value;
    }

    public String getValue() {
        return value;
    }

    public static ResourceType fromValue(String value) {
        for (ResourceType t : values()) {
            if (t.value.equals(value)) {
                return t;
            }
        }
        throw new IllegalArgumentException("Unknown resource type: " + value);
    }
}
