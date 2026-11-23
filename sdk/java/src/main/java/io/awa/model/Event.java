package io.awa.model;

import com.fasterxml.jackson.annotation.JsonProperty;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.util.UUID;

/**
 * A start, intermediate, end, timer, message, error, signal or conditional event
 * (specification sections 13.4, 13.5 and 18).
 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class Event extends AwaObject {

    @NotNull
    private UUID id;

    @NotBlank
    private String name;

    private String description;

    @NotNull
    @JsonProperty("event_type")
    private EventType eventType;

    /** Type-specific settings. */
    @JsonProperty("event_definition")
    private EventDefinition eventDefinition;

    /** As for activities. Schema default: {@link JoinMode#ANY}. */
    private JoinMode join;
}
