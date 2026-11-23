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
 * A unit of work in a workflow (specification section 8.2, {@code activity.schema.json}).
 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class Activity extends AwaObject {

    @NotNull
    private UUID id;

    @NotBlank
    private String name;

    /** What the activity does and why. */
    private String description;

    /** How to perform the activity, step by step. */
    private String procedure;

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

    private List<DataObject> inputs;

    private List<DataObject> outputs;

    /** Contexts the activity reads or writes (section 22). */
    @JsonProperty("context_bindings")
    private List<ContextBinding> contextBindings;

    @JsonProperty("access_rights")
    private List<AccessRight> accessRights;

    private List<Program> programs;

    private List<Control> controls;

    /** Activity-level service level (section 23). */
    private SLA sla;

    private Analytics analytics;

    /** Whether the activity can be expanded to a sub-workflow. Schema default: false. */
    @JsonProperty("is_expandable")
    private Boolean expandable;

    @JsonProperty("expansion_workflow_id")
    private UUID expansionWorkflowId;

    private List<SkillBinding> skills;

    @JsonProperty("tool_requirements")
    private List<ToolRequirement> toolRequirements;

    /** Acceptance verification of the output (section 7). */
    private VerificationPolicy verification;

    /** What the engine does when the actor raises an error (section 10.1). */
    private RetryPolicy retry;

    /** What must be true of the outcome (section 11). */
    @JsonProperty("outcome_contract")
    private OutcomeContract outcomeContract;

    /** Schema default: {@link JoinMode#ANY} (section 13.2). */
    private JoinMode join;

    /** The activity that undoes this one if the run later fails (section 13.6). */
    private Compensation compensation;

    /** Which knowledge from earlier runs the actor is given (section 15.4). */
    private KnowledgeBinding knowledge;

    /** Functions the actor may call while performing the activity (section 17). */
    private List<Tool> tools;

    /** How to undo an activity (section 13.6). */
    @Data
    @Builder
    @NoArgsConstructor
    @AllArgsConstructor
    public static class Compensation extends AwaObject {
        /** Activity that undoes this one. It must not be the target of any edge. */
        @NotNull
        @JsonProperty("activity_id")
        private UUID activityId;
    }
}
