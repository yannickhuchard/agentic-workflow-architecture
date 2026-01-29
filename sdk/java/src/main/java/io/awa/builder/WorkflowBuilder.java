package io.awa.builder;

import io.awa.model.*;

import java.time.OffsetDateTime;
import java.util.*;

/**
 * Fluent builder for constructing AWA workflows
 */
public class WorkflowBuilder {

    private final UUID workflowId;
    private final String name;
    private final String version;
    private String description;
    private UUID ownerId;
    private UUID organizationId;
    private final List<Activity> activities = new ArrayList<>();
    private final List<Edge> edges = new ArrayList<>();
    private final List<Context> contexts = new ArrayList<>();
    private final Map<String, Activity> activityMap = new HashMap<>();
    private final Map<String, Context> contextMap = new HashMap<>();
    private SLA sla;
    private Analytics analytics;
    private final Map<String, Object> metadata = new HashMap<>();

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
        Activity activity = Activity.builder()
                .id(UUID.randomUUID())
                .name(name)
                .roleId(roleId)
                .actorType(actorType)
                .build();
        activities.add(activity);
        activityMap.put(name, activity);
        return this;
    }

    public WorkflowBuilder activityWithSystem(String name, UUID roleId, ActorType actorType, UUID systemId) {
        Activity activity = Activity.builder()
                .id(UUID.randomUUID())
                .name(name)
                .roleId(roleId)
                .actorType(actorType)
                .systemId(systemId)
                .build();
        activities.add(activity);
        activityMap.put(name, activity);
        return this;
    }

    public WorkflowBuilder edge(String sourceName, String targetName) {
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
                .build();
        edges.add(edge);
        return this;
    }

    public WorkflowBuilder edge(String sourceName, String targetName, String condition) {
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

    public Workflow build() {
        OffsetDateTime now = OffsetDateTime.now();
        return Workflow.builder()
                .id(workflowId)
                .name(name)
                .version(version)
                .description(description)
                .ownerId(ownerId)
                .organizationId(organizationId)
                .activities(new ArrayList<>(activities))
                .edges(new ArrayList<>(edges))
                .contexts(new ArrayList<>(contexts))
                .sla(sla)
                .analytics(analytics)
                .metadata(new HashMap<>(metadata))
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
}
