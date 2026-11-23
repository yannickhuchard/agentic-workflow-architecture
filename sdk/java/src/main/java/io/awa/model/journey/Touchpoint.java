package io.awa.model.journey;

import com.fasterxml.jackson.annotation.JsonProperty;
import io.awa.model.AwaObject;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.util.List;

/**
 * A moment at which the organisation and someone else are in contact, and what carries it
 * (specification section 19.8).
 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class Touchpoint extends AwaObject {

    /** Pattern {@code ^[a-z0-9][a-z0-9_-]{0,63}$}. */
    @NotBlank
    private String id;

    @NotBlank
    private String name;

    /** Who is on the other side: {@code subject} (the schema default) or a third party, e.g. {@code bank}. */
    private String party;

    @NotNull
    private Direction direction;

    /** How the contact is made, e.g. web, email, phone, sms, app, post, api, in_person. */
    @NotBlank
    private String channel;

    /** The system that carries it. */
    private String technology;

    /** What makes the touchpoint happen. Names exactly one of event, activity or tool. */
    @NotNull
    private On on;

    /** What changes hands. */
    private List<Exchange> exchanges;

    public enum Direction {
        /** The party acts towards the organisation. */
        @JsonProperty("inbound") INBOUND,
        /** The organisation acts towards the party. */
        @JsonProperty("outbound") OUTBOUND
    }

    @Data
    @Builder
    @NoArgsConstructor
    @AllArgsConstructor
    public static class On extends AwaObject {
        /** A business event type. */
        private String event;

        /** The completion of an activity. */
        private String activity;

        /** A tool call. */
        private String tool;
    }

    @Data
    @Builder
    @NoArgsConstructor
    @AllArgsConstructor
    public static class Exchange extends AwaObject {
        /** Id of a {@link JourneyArtefact}. */
        @NotBlank
        private String artefact;

        /** Path in the data of the occasion that identifies the particular document. */
        private String reference;
    }
}
