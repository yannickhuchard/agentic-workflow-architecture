package io.awa.model;

import com.fasterxml.jackson.annotation.JsonProperty;

/**
 * How tokens arriving over several incoming edges are treated (specification section 13.2).
 */
public enum JoinMode {
    /** Each token executes the node. The default. */
    @JsonProperty("any") ANY,
    /** The engine waits for a token on every incoming edge, merges them and executes the node once. */
    @JsonProperty("all") ALL
}
