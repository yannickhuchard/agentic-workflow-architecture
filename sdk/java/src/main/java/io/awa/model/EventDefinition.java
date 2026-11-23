package io.awa.model;

import com.fasterxml.jackson.annotation.JsonProperty;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.util.List;
import java.util.UUID;

/**
 * Type-specific settings of an {@link Event}.
 *
 * <ul>
 *   <li>timer: {@code duration} (section 13.5).</li>
 *   <li>start: optionally {@code name}, the business event type that starts a run (section 18.4).</li>
 *   <li>message and signal: {@code name}, {@code mode}, {@code correlation_key}, {@code timeout},
 *       {@code timeout_edge_id} and, for publishing, {@code data} (sections 18.2 and 18.3).</li>
 * </ul>
 *
 * Other settings are kept in {@link #getAdditionalProperties()}.
 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class EventDefinition extends AwaObject {

    /** The business event type published, waited for, or that starts the run. */
    private String name;

    /** Absent: {@link Mode#WAIT}. */
    private Mode mode;

    /** For a message: path read in the token's data and in the event's data; the two must be equal. */
    @JsonProperty("correlation_key")
    private String correlationKey;

    /** ISO 8601 duration after which a wait times out. */
    private String timeout;

    /** The edge a token takes when the wait times out. */
    @JsonProperty("timeout_edge_id")
    private UUID timeoutEdgeId;

    /** Paths in the token's data whose values a published event carries. */
    private List<String> data;

    /** ISO 8601 duration a timer event holds the token. */
    private String duration;

    public enum Mode {
        /** Hold the token until a matching business event is delivered. */
        @JsonProperty("wait") WAIT,
        /** Publish a business event; the token is not held. */
        @JsonProperty("publish") PUBLISH
    }
}
