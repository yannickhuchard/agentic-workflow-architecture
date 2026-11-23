package io.awa.model.visualization;

import com.fasterxml.jackson.annotation.JsonCreator;
import com.fasterxml.jackson.annotation.JsonValue;

/**
 * Auto-layout algorithm selection
 */
public enum LayoutAlgorithm {
    DAGRE("dagre"),
    ELK("elk"),
    D3_HIERARCHY("d3_hierarchy"),
    MANUAL("manual");

    private final String value;

    LayoutAlgorithm(String value) {
        this.value = value;
    }

    @JsonValue
    public String getValue() {
        return value;
    }

    @JsonCreator
    public static LayoutAlgorithm fromValue(String value) {
        for (LayoutAlgorithm algo : values()) {
            if (algo.value.equals(value)) {
                return algo;
            }
        }
        throw new IllegalArgumentException("Unknown LayoutAlgorithm: " + value);
    }
}
