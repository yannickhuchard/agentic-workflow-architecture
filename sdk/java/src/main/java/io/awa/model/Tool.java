package io.awa.model;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.util.Map;

/**
 * A function the actor may call while performing an activity, bound to what it runs
 * (specification section 17, {@code activity.schema.json#/$defs/tool}).
 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class Tool extends AwaObject {

    /** Name the actor calls the tool by; unique within the activity. Pattern {@code ^[A-Za-z_][A-Za-z0-9_-]{0,63}$}. */
    @NotBlank
    private String name;

    /** What the tool does and when to use it. Shown to the model. */
    private String description;

    /** JSON Schema of the arguments object. */
    private Map<String, Object> parameters;

    /** What actually runs when the tool is called. */
    @NotNull
    private ToolBinding binding;

    /** Where the underlying interface is documented, e.g. an OpenAPI document. */
    private String documentation;

    /** ISO 8601 duration. Schema default: PT30S. */
    private String timeout;

    /** Guardrails on this tool's calls and results (section 31). */
    private java.util.List<Guardrail> guardrails;
}
