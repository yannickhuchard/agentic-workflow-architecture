package io.awa.model.visualization;

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

    public String getValue() {
        return value;
    }

    public static LayoutAlgorithm fromValue(String value) {
        for (LayoutAlgorithm algo : values()) {
            if (algo.value.equals(value)) {
                return algo;
            }
        }
        throw new IllegalArgumentException("Unknown LayoutAlgorithm: " + value);
    }
}
