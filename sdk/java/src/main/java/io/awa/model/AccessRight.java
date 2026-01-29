package io.awa.model;

import com.fasterxml.jackson.annotation.JsonProperty;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.util.Map;
import java.util.UUID;

/**
 * AccessRight entity - explicit permission declarations
 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class AccessRight {

    @NotNull
    private UUID id;

    @NotBlank
    private String name;

    private String description;

    @JsonProperty("activity_id")
    private UUID activityId;

    @NotNull
    private AccessDirection direction;

    @NotNull
    @JsonProperty("resource_type")
    private ResourceType resourceType;

    @JsonProperty("resource_id")
    private String resourceId;

    @NotNull
    private Permission permission;

    private String scope;

    private Map<String, Object> conditions;
}
