package io.awa.model;

import com.fasterxml.jackson.annotation.JsonProperty;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.util.UUID;

/**
 * A tool or interface required to perform an activity or traverse an edge
 * ({@code awa.schema.json#/$defs/tool_requirement}). This declares a requirement; an
 * executable tool the actor calls is a {@link Tool}.
 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class ToolRequirement extends AwaObject {

    @NotNull
    private UUID id;

    @NotBlank
    private String name;

    @NotNull
    private ToolRequirementType type;

    private String description;

    /** Specific version or range required. */
    private String version;

    /** Reference to the interface, e.g. an OpenAPI document or MCP configuration. */
    private String reference;

    public enum ToolRequirementType {
        @JsonProperty("mcp") MCP,
        @JsonProperty("rest_api") REST_API,
        @JsonProperty("graphql") GRAPHQL,
        @JsonProperty("grpc") GRPC,
        @JsonProperty("software_package") SOFTWARE_PACKAGE,
        @JsonProperty("hardware_interface") HARDWARE_INTERFACE
    }
}
