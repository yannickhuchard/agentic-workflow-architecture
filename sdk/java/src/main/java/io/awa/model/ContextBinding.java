package io.awa.model;

import com.fasterxml.jackson.annotation.JsonProperty;
import jakarta.validation.constraints.NotNull;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.util.UUID;

/**
 * How an activity reads or writes a context (specification section 22,
 * {@code context.schema.json#/$defs/context_binding}).
 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class ContextBinding extends AwaObject {

    private UUID id;

    @NotNull
    @JsonProperty("context_id")
    private UUID contextId;

    @JsonProperty("activity_id")
    private UUID activityId;

    @NotNull
    @JsonProperty("access_mode")
    private AccessMode accessMode;

    /**
     * Whether the context must hold a value before the activity runs. A required context
     * that nothing has written fails the activity with {@code CONTEXT_MISSING}.
     * Schema default: true.
     */
    private Boolean required;

    private Transforms transforms;

    /** Transformation expressions applied when the context is read or written. */
    @Data
    @Builder
    @NoArgsConstructor
    @AllArgsConstructor
    public static class Transforms extends AwaObject {
        @JsonProperty("on_read")
        private String onRead;

        @JsonProperty("on_write")
        private String onWrite;
    }
}
