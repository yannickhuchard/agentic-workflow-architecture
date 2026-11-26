package io.awa.model;

import com.fasterxml.jackson.annotation.JsonProperty;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.math.BigDecimal;
import java.util.List;
import java.util.UUID;

/**
 * A role that activities are performed by ({@code role.schema.json}).
 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class Role extends AwaObject {

    @NotNull
    private UUID id;

    @NotBlank
    private String name;

    private String description;

    /** Default actor type for this role. */
    @NotNull
    @JsonProperty("actor_type")
    private ActorType actorType;

    @JsonProperty("organization_id")
    private UUID organizationId;

    private List<String> capabilities;

    /** If true, the definition is inline in the workflow. Schema default: false. */
    @JsonProperty("is_embedded")
    private Boolean isEmbedded;

    @JsonProperty("ai_model_config")
    private AiModelConfig aiModelConfig;

    @JsonProperty("mcp_tools")
    private List<McpTool> mcpTools;

    /** The agent, reached over A2A, that performs the activities of this role (section 28). */
    private A2AAgent a2a;

    /** Guardrails on the activities of this role and their tool calls (section 31). */
    private List<Guardrail> guardrails;

    /** Model configuration for {@code ai_agent} roles (specification section 12). */
    @Data
    @Builder
    @NoArgsConstructor
    @AllArgsConstructor
    public static class AiModelConfig extends AwaObject {
        /** Model reference: {@code tier:<name>}, {@code <provider>:<model>} or {@code <model>}. */
        @JsonProperty("model_id")
        private String modelId;

        private BigDecimal temperature;

        @JsonProperty("max_tokens")
        private Integer maxTokens;

        @JsonProperty("system_prompt")
        private String systemPrompt;
    }

    /** An MCP tool available to the role. */
    @Data
    @Builder
    @NoArgsConstructor
    @AllArgsConstructor
    public static class McpTool extends AwaObject {
        @JsonProperty("server_name")
        private String serverName;

        @JsonProperty("tool_name")
        private String toolName;
    }
}
