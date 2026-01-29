package io.awa.model;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.util.Map;
import java.util.UUID;

/**
 * Event entity - workflow events (start, end, intermediate)
 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class Event {

    private UUID id;
    private String name;
    private String description;
    private String eventType;
    private Map<String, Object> eventDefinition;
}
