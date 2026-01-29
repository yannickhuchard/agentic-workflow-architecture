package io.awa.model;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.util.Map;

/**
 * DataObject - inputs/outputs for activities
 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class DataObject {

    private String name;
    private String description;
    private Map<String, Object> schema;
    @Builder.Default
    private boolean required = true;
}
