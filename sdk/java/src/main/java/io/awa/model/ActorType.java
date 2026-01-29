package io.awa.model;

/**
 * Actor types for AWA activities
 */
public enum ActorType {
    HUMAN("human"),
    AI_AGENT("ai_agent"),
    ROBOT("robot"),
    APPLICATION("application");

    private final String value;

    ActorType(String value) {
        this.value = value;
    }

    public String getValue() {
        return value;
    }

    public static ActorType fromValue(String value) {
        for (ActorType type : values()) {
            if (type.value.equals(value)) {
                return type;
            }
        }
        throw new IllegalArgumentException("Unknown actor type: " + value);
    }
}
