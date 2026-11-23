package io.awa.model;

import com.fasterxml.jackson.annotation.JsonProperty;
import com.fasterxml.jackson.annotation.JsonSubTypes;
import com.fasterxml.jackson.annotation.JsonTypeInfo;
import jakarta.validation.constraints.NotBlank;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.util.List;
import java.util.Map;

/**
 * What runs when a {@link Tool} is called (specification section 17.2). The {@code kind}
 * property selects the subtype. A binding whose {@code kind} is not one of the six the
 * specification defines is refused when read.
 */
@JsonTypeInfo(use = JsonTypeInfo.Id.NAME, include = JsonTypeInfo.As.PROPERTY, property = "kind")
@JsonSubTypes({
        @JsonSubTypes.Type(value = ToolBinding.Http.class, name = "http"),
        @JsonSubTypes.Type(value = ToolBinding.Command.class, name = "command"),
        @JsonSubTypes.Type(value = ToolBinding.JsonRpc.class, name = "jsonrpc"),
        @JsonSubTypes.Type(value = ToolBinding.Grpc.class, name = "grpc"),
        @JsonSubTypes.Type(value = ToolBinding.Mcp.class, name = "mcp"),
        @JsonSubTypes.Type(value = ToolBinding.Function.class, name = "function")
})
public abstract class ToolBinding extends AwaObject {

    /** The value of the {@code kind} property. */
    public abstract String kind();

    /** An HTTP request. {@code {name}} in the URL is replaced by the argument of that name. */
    @Data
    @Builder
    @NoArgsConstructor
    @AllArgsConstructor
    public static class Http extends ToolBinding {
        /** Schema default: GET. */
        private HttpMethod method;

        @NotBlank
        private String url;

        /** Request headers. {@code {{secret:NAME}}} is replaced by a secret the deployment supplies. */
        private Map<String, String> headers;

        @Override
        public String kind() {
            return "http";
        }
    }

    public enum HttpMethod {
        @JsonProperty("GET") GET,
        @JsonProperty("POST") POST,
        @JsonProperty("PUT") PUT,
        @JsonProperty("PATCH") PATCH,
        @JsonProperty("DELETE") DELETE,
        @JsonProperty("HEAD") HEAD
    }

    /** A program, run without a shell, only if the deployment allows it. */
    @Data
    @Builder
    @NoArgsConstructor
    @AllArgsConstructor
    public static class Command extends ToolBinding {
        @NotBlank
        private String command;

        /** Arguments. {@code {name}} is replaced by the argument of that name. */
        private List<String> args;

        @Override
        public String kind() {
            return "command";
        }
    }

    /** A JSON-RPC method. */
    @Data
    @Builder
    @NoArgsConstructor
    @AllArgsConstructor
    public static class JsonRpc extends ToolBinding {
        @NotBlank
        private String endpoint;

        @NotBlank
        private String method;

        @Override
        public String kind() {
            return "jsonrpc";
        }
    }

    /** A gRPC method. */
    @Data
    @Builder
    @NoArgsConstructor
    @AllArgsConstructor
    public static class Grpc extends ToolBinding {
        @NotBlank
        private String endpoint;

        @NotBlank
        private String service;

        @NotBlank
        private String method;

        @Override
        public String kind() {
            return "grpc";
        }
    }

    /** A tool of an MCP server. */
    @Data
    @Builder
    @NoArgsConstructor
    @AllArgsConstructor
    public static class Mcp extends ToolBinding {
        @NotBlank
        private String server;

        @NotBlank
        private String tool;

        @Override
        public String kind() {
            return "mcp";
        }
    }

    /** A handler registered with the engine. */
    @Data
    @Builder
    @NoArgsConstructor
    @AllArgsConstructor
    public static class Function extends ToolBinding {
        @NotBlank
        private String name;

        @Override
        public String kind() {
            return "function";
        }
    }
}
