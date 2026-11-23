package io.awa.model;

import com.fasterxml.jackson.annotation.JsonProperty;

/**
 * Type of a workflow event ({@code awa.schema.json#/$defs/event_type}).
 */
public enum EventType {
    @JsonProperty("start") START,
    @JsonProperty("intermediate") INTERMEDIATE,
    @JsonProperty("end") END,
    @JsonProperty("timer") TIMER,
    @JsonProperty("message") MESSAGE,
    @JsonProperty("error") ERROR,
    @JsonProperty("signal") SIGNAL,
    @JsonProperty("conditional") CONDITIONAL
}
