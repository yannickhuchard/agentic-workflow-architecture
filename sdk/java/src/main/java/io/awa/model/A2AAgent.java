package io.awa.model;

import com.fasterxml.jackson.annotation.JsonProperty;
import jakarta.validation.constraints.NotBlank;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.util.Map;

/**
 * An agent reached over the Agent2Agent protocol (A2A 1.0) that performs an activity
 * (specification section 28, {@code activity.schema.json#/$defs/a2a_agent}).
 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class A2AAgent extends AwaObject {

    /** URL of the agent's card. */
    @NotBlank
    @JsonProperty("agent_card")
    private String agentCard;

    /** Id of the skill on the card the work is for. */
    private String skill;

    /** {@code wait} (schema default) or {@code fail}: what happens when the agent asks for input (28.6). */
    @JsonProperty("on_input_required")
    private String onInputRequired;

    /** Headers sent with every request to the agent; {@code {{secret:NAME}}} is replaced by a deployment secret. Never journalled. */
    private Map<String, String> headers;
}
