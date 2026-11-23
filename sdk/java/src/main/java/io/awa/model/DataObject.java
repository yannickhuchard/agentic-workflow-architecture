package io.awa.model;

import jakarta.validation.constraints.NotBlank;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.util.Map;

/**
 * Declared input or output data of an activity.
 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class DataObject extends AwaObject {

    @NotBlank
    private String name;

    private String description;

    /** JSON Schema of the data object. */
    private Map<String, Object> schema;

    /** Schema default: true. */
    private Boolean required;
}
