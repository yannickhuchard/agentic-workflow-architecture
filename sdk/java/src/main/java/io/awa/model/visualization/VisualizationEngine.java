package io.awa.model.visualization;

import com.fasterxml.jackson.annotation.JsonCreator;
import com.fasterxml.jackson.annotation.JsonValue;

/**
 * Visualization rendering engine
 */
public enum VisualizationEngine {
    REACTFLOW("reactflow"),
    BABYLONJS("babylonjs"),
    CUSTOM("custom");

    private final String value;

    VisualizationEngine(String value) {
        this.value = value;
    }

    @JsonValue
    public String getValue() {
        return value;
    }

    @JsonCreator
    public static VisualizationEngine fromValue(String value) {
        for (VisualizationEngine engine : values()) {
            if (engine.value.equals(value)) {
                return engine;
            }
        }
        throw new IllegalArgumentException("Unknown VisualizationEngine: " + value);
    }
}
