"""
AWA Workflow Builder - Fluent API for constructing workflows
"""

from datetime import datetime
from typing import Any
from uuid import uuid4

from awa.types import (
    AccessMode,
    AccessRight,
    AccessDirection,
    Activity,
    ActorType,
    Analytics,
    Context,
    ContextBinding,
    ContextType,
    Edge,
    Permission,
    ResourceType,
    SLA,
    SyncPattern,
    Visibility,
    Workflow,
)


class WorkflowBuilder:
    """Fluent builder for constructing AWA workflows."""

    def __init__(self, name: str, version: str = "1.0.0"):
        self._workflow_id = uuid4()
        self._name = name
        self._version = version
        self._description: str | None = None
        self._owner_id: str | None = None
        self._organization_id: str | None = None
        self._activities: list[Activity] = []
        self._edges: list[Edge] = []
        self._contexts: list[Context] = []
        self._activity_map: dict[str, Activity] = {}
        self._context_map: dict[str, Context] = {}
        self._sla: SLA | None = None
        self._analytics: Analytics | None = None
        self._metadata: dict[str, Any] = {}

    def description(self, description: str) -> "WorkflowBuilder":
        """Set workflow description."""
        self._description = description
        return self

    def owner(self, owner_id: str) -> "WorkflowBuilder":
        """Set workflow owner."""
        self._owner_id = owner_id
        return self

    def organization(self, organization_id: str) -> "WorkflowBuilder":
        """Set owning organization."""
        self._organization_id = organization_id
        return self

    def context(
        self,
        name: str,
        *,
        type: ContextType,
        sync_pattern: SyncPattern,
        description: str | None = None,
        schema: dict[str, Any] | None = None,
        initial_value: Any | None = None,
        visibility: Visibility = Visibility.workflow,
    ) -> "WorkflowBuilder":
        """Add a context for agent collaboration."""
        ctx = Context(
            id=uuid4(),
            name=name,
            type=type,
            sync_pattern=sync_pattern,
            description=description,
            schema=schema,
            initial_value=initial_value,
            visibility=visibility,
            owner_workflow_id=self._workflow_id,
        )
        self._contexts.append(ctx)
        self._context_map[name] = ctx
        return self

    def activity(
        self,
        name: str,
        *,
        role_id: str,
        actor_type: ActorType,
        description: str | None = None,
        system_id: str | None = None,
        machine_id: str | None = None,
        endpoint_id: str | None = None,
        organization_id: str | None = None,
        contexts: list[tuple[str, AccessMode]] | None = None,
        access_rights: list[tuple[str, Permission]] | None = None,
        sla: SLA | None = None,
        analytics: Analytics | None = None,
    ) -> "WorkflowBuilder":
        """Add an activity to the workflow."""
        activity_id = uuid4()

        context_bindings: list[ContextBinding] = []
        if contexts:
            for ctx_name, access_mode in contexts:
                ctx = self._context_map.get(ctx_name)
                if ctx:
                    binding = ContextBinding(
                        id=uuid4(),
                        context_id=ctx.id,
                        activity_id=activity_id,
                        access_mode=access_mode,
                        required=True,
                    )
                    context_bindings.append(binding)

        ar_list: list[AccessRight] = []
        if access_rights:
            for resource_id, permission in access_rights:
                ar = AccessRight(
                    id=uuid4(),
                    name=f"access_{resource_id}",
                    activity_id=activity_id,
                    direction=AccessDirection.requires,
                    resource_type=ResourceType.database,
                    resource_id=resource_id,
                    permission=permission,
                )
                ar_list.append(ar)

        act = Activity(
            id=activity_id,
            name=name,
            description=description,
            role_id=uuid4() if not role_id.startswith("-") else uuid4(),
            actor_type=actor_type,
            system_id=uuid4() if system_id else None,
            machine_id=uuid4() if machine_id else None,
            endpoint_id=uuid4() if endpoint_id else None,
            organization_id=uuid4() if organization_id else None,
            context_bindings=context_bindings,
            access_rights=ar_list,
            sla=sla,
            analytics=analytics,
        )
        self._activities.append(act)
        self._activity_map[name] = act
        return self

    def edge(
        self,
        source_name: str,
        target_name: str,
        *,
        condition: str | None = None,
        label: str | None = None,
    ) -> "WorkflowBuilder":
        """Add an edge between two activities."""
        source = self._activity_map.get(source_name)
        target = self._activity_map.get(target_name)

        if not source:
            raise ValueError(f"Source activity '{source_name}' not found")
        if not target:
            raise ValueError(f"Target activity '{target_name}' not found")

        edge = Edge(
            id=uuid4(),
            source_id=source.id,
            target_id=target.id,
            source_type="activity",
            target_type="activity",
            condition=condition,
            label=label,
            is_default=False,
        )
        self._edges.append(edge)
        return self

    def sla(self, sla: SLA) -> "WorkflowBuilder":
        """Set workflow-level SLA."""
        self._sla = sla
        return self

    def analytics(self, analytics: Analytics) -> "WorkflowBuilder":
        """Set workflow-level analytics."""
        self._analytics = analytics
        return self

    def metadata(self, key: str, value: Any) -> "WorkflowBuilder":
        """Add metadata."""
        self._metadata[key] = value
        return self

    def build(self) -> Workflow:
        """Build and return the workflow."""
        now = datetime.utcnow()
        return Workflow(
            id=self._workflow_id,
            name=self._name,
            version=self._version,
            description=self._description,
            owner_id=uuid4() if self._owner_id else None,
            organization_id=uuid4() if self._organization_id else None,
            activities=self._activities,
            edges=self._edges,
            contexts=self._contexts,
            sla=self._sla,
            analytics=self._analytics,
            metadata=self._metadata if self._metadata else None,
            created_at=now,
            updated_at=now,
        )

    def get_activity(self, name: str) -> Activity | None:
        """Get activity by name."""
        return self._activity_map.get(name)

    def get_context(self, name: str) -> Context | None:
        """Get context by name."""
        return self._context_map.get(name)


def workflow(name: str, version: str = "1.0.0") -> WorkflowBuilder:
    """Create a new workflow builder."""
    return WorkflowBuilder(name, version)
