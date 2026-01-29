package io.awa.model;

import com.fasterxml.jackson.annotation.JsonProperty;
import jakarta.validation.constraints.NotNull;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.util.UUID;

/**
 * ContextBinding entity - defines how an activity interacts with a context
 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class ContextBinding {

    private UUID id;

    @NotNull
    @JsonProperty("context_id")
    private UUID contextId;

    @JsonProperty("activity_id")
    private UUID activityId;

    @NotNull
    @JsonProperty("access_mode")
    private AccessMode accessMode;

    @Builder.Default
    private boolean required = true;

    private Transforms transforms;

    @Data
    @Builder
    @NoArgsConstructor
    @AllArgsConstructor
    public static class Transforms {
        @JsonProperty("on_read")
        private String onRead;

        @JsonProperty("on_write")
        private String onWrite;
    }
}
