package io.awa.model;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.util.ArrayList;
import java.util.List;
import java.util.UUID;

/**
 * Program - executable code bound to an activity
 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class Program {

    private UUID id;
    private String name;
    private String language;
    private String code;
    private String codeUri;
    @Builder.Default
    private List<Parameter> parameters = new ArrayList<>();
    private String mcpServer;

    @Data
    @Builder
    @NoArgsConstructor
    @AllArgsConstructor
    public static class Parameter {
        private String name;
        private String type;
        @Builder.Default
        private boolean required = true;
        private Object defaultValue;
    }
}
