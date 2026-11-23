package io.awa.model;

import com.fasterxml.jackson.annotation.JsonProperty;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.util.List;
import java.util.UUID;

/**
 * Executable code bound to an activity.
 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class Program extends AwaObject {

    @NotNull
    private UUID id;

    @NotBlank
    private String name;

    /**
     * One of python, typescript, javascript, java, sql, mcp_tool, rest_api, graphql, shell.
     */
    @NotBlank
    private String language;

    /** Inline code. */
    private String code;

    /** External code reference. */
    @JsonProperty("code_uri")
    private String codeUri;

    private List<Parameter> parameters;

    /** MCP server name, for language {@code mcp_tool}. */
    @JsonProperty("mcp_server")
    private String mcpServer;

    @Data
    @Builder
    @NoArgsConstructor
    @AllArgsConstructor
    public static class Parameter extends AwaObject {
        @NotBlank
        private String name;

        @NotBlank
        private String type;

        /** Schema default: true. */
        private Boolean required;

        @JsonProperty("default")
        private Object defaultValue;
    }
}
