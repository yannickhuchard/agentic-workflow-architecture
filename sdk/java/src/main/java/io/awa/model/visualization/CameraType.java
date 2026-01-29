package io.awa.model.visualization;

/**
 * Camera type for 3D visualization
 */
public enum CameraType {
    ARC_ROTATE("arc_rotate"),
    FREE("free"),
    FOLLOW("follow"),
    FLY("fly");

    private final String value;

    CameraType(String value) {
        this.value = value;
    }

    public String getValue() {
        return value;
    }

    public static CameraType fromValue(String value) {
        for (CameraType type : values()) {
            if (type.value.equals(value)) {
                return type;
            }
        }
        throw new IllegalArgumentException("Unknown CameraType: " + value);
    }
}
