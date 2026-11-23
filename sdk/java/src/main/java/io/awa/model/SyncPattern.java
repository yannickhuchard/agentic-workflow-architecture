package io.awa.model;

import com.fasterxml.jackson.annotation.JsonCreator;
import com.fasterxml.jackson.annotation.JsonValue;

/**
 * Sync patterns for shared contexts
 */
public enum SyncPattern {
    SHARED_STATE("shared_state"),
    MESSAGE_PASSING("message_passing"),
    BLACKBOARD("blackboard"),
    EVENT_SOURCING("event_sourcing");

    private final String value;

    SyncPattern(String value) {
        this.value = value;
    }

    @JsonValue
    public String getValue() {
        return value;
    }

    @JsonCreator
    public static SyncPattern fromValue(String value) {
        for (SyncPattern pattern : values()) {
            if (pattern.value.equals(value)) {
                return pattern;
            }
        }
        throw new IllegalArgumentException("Unknown sync pattern: " + value);
    }
}
