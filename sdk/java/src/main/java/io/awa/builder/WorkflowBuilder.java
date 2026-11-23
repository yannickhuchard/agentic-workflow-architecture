package io.awa.builder;

import io.awa.model.AccessMode;
import io.awa.model.Activity;
import io.awa.model.ActorType;
import io.awa.model.Analytics;
import io.awa.model.Context;
import io.awa.model.ContextBinding;
import io.awa.model.ContextType;
import io.awa.model.Edge;
import io.awa.model.Lifecycle;
import io.awa.model.NodeType;
import io.awa.model.OutcomeContract;
import io.awa.model.RetryPolicy;
import io.awa.model.Role;
import io.awa.model.SLA;
import io.awa.model.SyncPattern;
import io.awa.model.Tool;
import io.awa.model.Visibility;
import io.awa.model.Workflow;

import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

/**
 * Fluent builder for constructing AWA workflows by hand.
 *
 * <p>Activities and contexts are referred to by name while building. The workflow gets
 * {@code awa_version} {@value Workflow#AWA_VERSION} unless {@link #awaVersion(String)} says
 * otherwise. Building does not validate the workflow.
 */
public class WorkflowBuilder {

    private UUID workflowId;
    private final String name;
    private final String version;
    private String awaVersion = Workflow.AWA_VERSION;
    private String description;
    private UUID ownerId;
    private UUID organizationId;
    private final List<Role> roles = new ArrayList<>();
    private final List<Activity> activities = new ArrayList<>();
    private final List<Edge> edges = new ArrayList<>();
    private final List<Context> contexts = new ArrayList<>();
    private final Map<String, Activity> activityMap = new HashMap<>();
    private final Map<String, Context> contextMap = new HashMap<>();
    private SLA sla;
    private Analytics analytics;
    private final Map<String, Object> metadata = new LinkedHashMap<>();

    public WorkflowBuilder(String name, String version) {
        this.workflowId = UUID.randomUUID();
        this.name = name;
        this.version = version;
    }

    public static WorkflowBuilder workflow(String name) {
        return new WorkflowBuilder(name, "1.0.0");
    }

    public static WorkflowBuilder workflow(String name, String version) {
        return new WorkflowBuilder(name, version);
    }

    /** Uses this id instead of a random one. */
    public WorkflowBuilder id(UUID id) {
        this.workflowId = id;
        for (Context context : contexts) {
            context.setOwnerWorkflowId(id);
        }
        return this;
    }

    /** The specification version the workflow targets. Default {@value Workflow#AWA_VERSION}; null leaves it out. */
    public WorkflowBuilder awaVersion(String awaVersion) {
        this.awaVersion = awaVersion;
        return this;
    }

    public WorkflowBuilder description(String description) {
        this.description = description;
        return this;
    }

    public WorkflowBuilder owner(UUID ownerId) {
        this.ownerId = ownerId;
        return this;
    }

    public WorkflowBuilder organization(UUID organizationId) {
        this.organizationId = organizationId;
        return this;
    }

    /** Adds a role to the workflow's {@code roles}. */
    public WorkflowBuilder role(Role role) {
        roles.add(role);
        return this;
    }

    /** Adds a role with a random id and returns that id, for use in {@link #activity}. */
    public UUID addRole(String name, ActorType actorType) {
        Role role = Role.builder().id(UUID.randomUUID()).name(name).actorType(actorType).build();
        roles.add(role);
        return role.getId();
    }

    public WorkflowBuilder context(String name, ContextType type, SyncPattern syncPattern) {
        Context context = Context.builder()
                .id(UUID.randomUUID())
                .name(name)
                .type(type)
                .syncPattern(syncPattern)
                .visibility(Visibility.WORKFLOW)
                .ownerWorkflowId(workflowId)
                .lifecycle(Lifecycle.PERSISTENT)
                .build();
        contexts.add(context);
        contextMap.put(name, context);
        return this;
    }

    public WorkflowBuilder activity(String name, UUID roleId, ActorType actorType) {
        Activity activity = newActivity(name, roleId, actorType)
                .build();
        activities.add(activity);
        activityMap.put(name, activity);
        return this;
    }

    public WorkflowBuilder activityWithSystem(String name, UUID roleId, ActorType actorType, UUID systemId) {
        Activity activity = newActivity(name, roleId, actorType)
                .systemId(systemId)
                .build();
        activities.add(activity);
        activityMap.put(name, activity);
        return this;
    }

    /** Sets how the named activity is performed, step by step. */
    public WorkflowBuilder procedure(String activityName, String procedure) {
        requireActivity(activityName).setProcedure(procedure);
        return this;
    }

    /**
     * Binds the named activity to the named context (section 22). The binding is
     * required, the schema default.
     */
    public WorkflowBuilder bindContext(String activityName, String contextName, AccessMode accessMode) {
        return bindContext(activityName, contextName, accessMode, null, null);
    }

    /** Binds the named activity to the named context, stating whether the context must hold a value. */
    public WorkflowBuilder bindContext(String activityName, String contextName, AccessMode accessMode, boolean required) {
        return bindContext(activityName, contextName, accessMode, required, null);
    }

    /**
     * Binds the named activity to the named context.
     *
     * @param required   whether the context must hold a value before the activity runs; null leaves it out
     * @param transforms expressions applied on read and on write; null for none
     */
    public WorkflowBuilder bindContext(String activityName, String contextName, AccessMode accessMode,
                                       Boolean required, ContextBinding.Transforms transforms) {
        Activity activity = requireActivity(activityName);
        Context context = contextMap.get(contextName);
        if (context == null) {
            throw new IllegalArgumentException("Context '" + contextName + "' not found");
        }
        ContextBinding binding = ContextBinding.builder()
                .contextId(context.getId())
                .accessMode(accessMode)
                .required(required)
                .transforms(transforms)
                .build();
        if (activity.getContextBindings() == null) {
            activity.setContextBindings(new ArrayList<>());
        }
        activity.getContextBindings().add(binding);
        return this;
    }

    /** Sets the retry policy of the named activity (section 10.1). */
    public WorkflowBuilder retry(String activityName, RetryPolicy retry) {
        requireActivity(activityName).setRetry(retry);
        return this;
    }

    /**
     * Retries the named activity up to {@code maxAttempts} executions in all, with the
     * schema's default delays.
     */
    public WorkflowBuilder retry(String activityName, int maxAttempts) {
        return retry(activityName, RetryPolicy.builder().maxAttempts(maxAttempts).build());
    }

    /** Sets the outcome contract of the named activity (section 11). */
    public WorkflowBuilder outcomeContract(String activityName, OutcomeContract contract) {
        requireActivity(activityName).setOutcomeContract(contract);
        return this;
    }

    /** Adds a postcondition to the outcome contract of the named activity, creating the contract if needed. */
    public WorkflowBuilder postcondition(String activityName, String name, String expression) {
        Activity activity = requireActivity(activityName);
        if (activity.getOutcomeContract() == null) {
            activity.setOutcomeContract(new OutcomeContract());
        }
        OutcomeContract contract = activity.getOutcomeContract();
        if (contract.getPostconditions() == null) {
            contract.setPostconditions(new ArrayList<>());
        }
        contract.getPostconditions().add(OutcomeContract.Postcondition.builder().name(name).expression(expression).build());
        return this;
    }

    /** Adds a tool the actor of the named activity may call (section 17). */
    public WorkflowBuilder tool(String activityName, Tool tool) {
        Activity activity = requireActivity(activityName);
        if (activity.getTools() == null) {
            activity.setTools(new ArrayList<>());
        }
        activity.getTools().add(tool);
        return this;
    }

    public WorkflowBuilder edge(String sourceName, String targetName) {
        return addEdge(sourceName, targetName, null);
    }

    public WorkflowBuilder edge(String sourceName, String targetName, String condition) {
        return addEdge(sourceName, targetName, condition);
    }

    /** Adds the edge taken from the source when no condition is true. */
    public WorkflowBuilder defaultEdge(String sourceName, String targetName) {
        addEdge(sourceName, targetName, null);
        edges.get(edges.size() - 1).setIsDefault(true);
        return this;
    }

    private WorkflowBuilder addEdge(String sourceName, String targetName, String condition) {
        Activity source = activityMap.get(sourceName);
        Activity target = activityMap.get(targetName);

        if (source == null) {
            throw new IllegalArgumentException("Source activity '" + sourceName + "' not found");
        }
        if (target == null) {
            throw new IllegalArgumentException("Target activity '" + targetName + "' not found");
        }

        Edge edge = Edge.builder()
                .id(UUID.randomUUID())
                .sourceId(source.getId())
                .targetId(target.getId())
                .sourceType(NodeType.ACTIVITY)
                .targetType(NodeType.ACTIVITY)
                .condition(condition)
                .build();
        edges.add(edge);
        return this;
    }

    public WorkflowBuilder sla(SLA sla) {
        this.sla = sla;
        return this;
    }

    public WorkflowBuilder analytics(Analytics analytics) {
        this.analytics = analytics;
        return this;
    }

    public WorkflowBuilder metadata(String key, Object value) {
        this.metadata.put(key, value);
        return this;
    }

    /**
     * Builds the workflow. {@code created_at} and {@code updated_at} are set to the
     * current time. As in SDK 1.x, {@code events}, {@code decision_nodes},
     * {@code contexts} and {@code metadata} are present even when empty; {@code roles}
     * is left out when no role was added.
     */
    public Workflow build() {
        String now = Instant.now().truncatedTo(ChronoUnit.MILLIS).toString();
        return Workflow.builder()
                .id(workflowId)
                .name(name)
                .version(version)
                .awaVersion(awaVersion)
                .description(description)
                .ownerId(ownerId)
                .organizationId(organizationId)
                .roles(roles.isEmpty() ? null : new ArrayList<>(roles))
                .activities(new ArrayList<>(activities))
                .edges(new ArrayList<>(edges))
                .events(new ArrayList<>())
                .decisionNodes(new ArrayList<>())
                .contexts(new ArrayList<>(contexts))
                .sla(sla)
                .analytics(analytics)
                .metadata(new LinkedHashMap<>(metadata))
                .createdAt(now)
                .updatedAt(now)
                .build();
    }

    public Activity getActivity(String name) {
        return activityMap.get(name);
    }

    public Context getContext(String name) {
        return contextMap.get(name);
    }

    /**
     * An activity whose list properties are empty rather than absent, as in SDK 1.x, so
     * that callers can add to them through {@link #getActivity(String)}.
     */
    private static Activity.ActivityBuilder newActivity(String name, UUID roleId, ActorType actorType) {
        return Activity.builder()
                .id(UUID.randomUUID())
                .name(name)
                .roleId(roleId)
                .actorType(actorType)
                .inputs(new ArrayList<>())
                .outputs(new ArrayList<>())
                .contextBindings(new ArrayList<>())
                .accessRights(new ArrayList<>())
                .programs(new ArrayList<>())
                .controls(new ArrayList<>());
    }

    private Activity requireActivity(String activityName) {
        Activity activity = activityMap.get(activityName);
        if (activity == null) {
            throw new IllegalArgumentException("Activity '" + activityName + "' not found");
        }
        return activity;
    }
}
