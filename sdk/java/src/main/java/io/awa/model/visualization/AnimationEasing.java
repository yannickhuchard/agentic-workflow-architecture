package io.awa.model.visualization;

/**
 * Animation easing function
 */
public enum AnimationEasing {
    LINEAR("linear"),
    EASE("ease"),
    EASE_IN("ease_in"),
    EASE_OUT("ease_out"),
    EASE_IN_OUT("ease_in_out"),
    BOUNCE("bounce"),
    ELASTIC("elastic");

    private final String value;

    AnimationEasing(String value) {
        this.value = value;
    }

    public String getValue() {
        return value;
    }

    public static AnimationEasing fromValue(String value) {
        for (AnimationEasing easing : values()) {
            if (easing.value.equals(value)) {
                return easing;
            }
        }
        throw new IllegalArgumentException("Unknown AnimationEasing: " + value);
    }
}
