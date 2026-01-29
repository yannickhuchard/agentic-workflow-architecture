package io.awa.model;

import com.fasterxml.jackson.annotation.JsonProperty;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.util.ArrayList;
import java.util.List;
import java.util.UUID;

/**
 * Activity entity representing a unit of work in the workflow
 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class Activity {

    @NotNull
    private UUID id;

    @NotBlank
    private String name;

    private String description;

    @NotNull
    @JsonProperty("role_id")
    private UUID roleId;

    @NotNull
    @JsonProperty("actor_type")
    private ActorType actorType;

    @JsonProperty("system_id")
    private UUID systemId;

    @JsonProperty("machine_id")
    private UUID machineId;

    @JsonProperty("endpoint_id")
    private UUID endpointId;

    @JsonProperty("organization_id")
    private UUID organizationId;

    @Builder.Default
    private List<DataObject> inputs = new ArrayList<>();

    @Builder.Default
    private List<DataObject> outputs = new ArrayList<>();

    @JsonProperty("context_bindings")
    @Builder.Default
    private List<ContextBinding> contextBindings = new ArrayList<>();

    @JsonProperty("access_rights")
    @Builder.Default
    private List<AccessRight> accessRights = new ArrayList<>();

    @Builder.Default
    private List<Program> programs = new ArrayList<>();

    @Builder.Default
    private List<Control> controls = new ArrayList<>();

    private SLA sla;

    private Analytics analytics;

    @JsonProperty("is_expandable")
    @Builder.Default
    private boolean expandable = false;

    @JsonProperty("expansion_workflow_id")
    private UUID expansionWorkflowId;
}
