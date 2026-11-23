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
 * A permission an activity requires or provisions (specification section 8.5).
 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class AccessRight extends AwaObject {

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
