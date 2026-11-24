package io.awa.model;

import com.fasterxml.jackson.annotation.JsonProperty;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotEmpty;
import jakarta.validation.constraints.NotNull;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.util.List;
import java.util.Map;

/**
 * A check applied at run time to what goes into or comes out of an AI agent or a tool,
 * and the action taken when it finds something (specification section 31,
 * {@code guardrail.schema.json}).
 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class Guardrail extends AwaObject {

    /** Unique among the guardrails of the document. */
    @NotBlank
    private String id;

    /** Carried by the record. */
    private String name;

    /** {@code input}, {@code output}, {@code tool_call}, {@code tool_result}. */
    @NotEmpty
    private List<String> stages;

    /** The check, by its {@code kind} (31.4); its other properties depend on the kind. */
    @NotNull
    private Map<String, Object> check;

    /** {@code block}, {@code redact}, {@code retry_with_feedback}, {@code escalate} or {@code warn} (31.5). */
    @NotBlank
    private String action;

    /** The actor types of the activities it applies to. Default: {@code ai_agent} only. Not used on a tool. */
    @JsonProperty("actor_types")
    private List<ActorType> actorTypes;

    /** At {@code tool_call} and {@code tool_result}: the tools it applies to, by name. Not used on a tool. */
    private List<String> tools;

    /** Paths within the value checked that text checks look at. Default: the whole value. */
    private List<String> fields;

    /** For {@code redact}: what replaces each match. Schema default: {@code [REDACTED:{category}]}. */
    private String replacement;
}
