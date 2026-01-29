"""
AWA Types - Pydantic models for all AWA entities
"""

from datetime import datetime
from enum import Enum
from typing import Any
from uuid import UUID

from pydantic import BaseModel, Field


# ============================================================================
# ENUMS
# ============================================================================


class ActorType(str, Enum):
    human = "human"
    ai_agent = "ai_agent"
    robot = "robot"
    application = "application"


class AccessMode(str, Enum):
    read = "read"
    write = "write"
    read_write = "read_write"
    subscribe = "subscribe"
    publish = "publish"


class SyncPattern(str, Enum):
    shared_state = "shared_state"
    message_passing = "message_passing"
    blackboard = "blackboard"
    event_sourcing = "event_sourcing"


class ContextType(str, Enum):
    document = "document"
    data = "data"
    config = "config"
    state = "state"
    memory = "memory"
    artifact = "artifact"


class Visibility(str, Enum):
    private = "private"
    workflow = "workflow"
    collection = "collection"
    global_ = "global"


class Permission(str, Enum):
    read = "read"
    write = "write"
    execute = "execute"
    admin = "admin"
    delete = "delete"
    create = "create"


class ResourceType(str, Enum):
    system = "system"
    api = "api"
    database = "database"
    file = "file"
    service = "service"
    secret = "secret"


class AccessDirection(str, Enum):
    requires = "requires"
    provisions = "provisions"


class HitPolicy(str, Enum):
    unique = "unique"
    first = "first"
    priority = "priority"
    any = "any"
    collect = "collect"
    rule_order = "rule_order"


class WasteCategory(str, Enum):
    defects = "defects"
    overproduction = "overproduction"
    waiting = "waiting"
    non_utilized_talent = "non_utilized_talent"
    transport = "transport"
    inventory = "inventory"
    motion = "motion"
    extra_processing = "extra_processing"


class NodeType(str, Enum):
    activity = "activity"
    event = "event"
    decision = "decision"


class ControlType(str, Enum):
    authorization = "authorization"
    validation = "validation"
    audit = "audit"
    compliance = "compliance"
    security = "security"
    rate_limit = "rate_limit"


class Enforcement(str, Enum):
    mandatory = "mandatory"
    advisory = "advisory"
    informational = "informational"


class Lifecycle(str, Enum):
    transient = "transient"
    persistent = "persistent"
    cached = "cached"


# ============================================================================
# ENTITY MODELS
# ============================================================================


class DataObject(BaseModel):
    name: str
    description: str | None = None
    schema_: dict[str, Any] | None = Field(default=None, alias="schema")
    required: bool = True


class Parameter(BaseModel):
    name: str
    type: str
    required: bool = True
    default: Any | None = None


class Program(BaseModel):
    id: UUID
    name: str
    language: str
    code: str | None = None
    code_uri: str | None = None
    parameters: list[Parameter] = Field(default_factory=list)
    mcp_server: str | None = None


class Control(BaseModel):
    id: UUID
    name: str
    description: str | None = None
    type: ControlType
    expression: str | None = None
    enforcement: Enforcement


class Transforms(BaseModel):
    on_read: str | None = None
    on_write: str | None = None


class ContextBinding(BaseModel):
    id: UUID | None = None
    context_id: UUID
    activity_id: UUID | None = None
    access_mode: AccessMode
    required: bool = True
    transforms: Transforms | None = None


class AccessRight(BaseModel):
    id: UUID
    name: str
    description: str | None = None
    activity_id: UUID | None = None
    direction: AccessDirection
    resource_type: ResourceType
    resource_id: str | None = None
    permission: Permission
    scope: str | None = None
    conditions: dict[str, Any] | None = None


class Context(BaseModel):
    id: UUID
    name: str
    description: str | None = None
    type: ContextType
    schema_: dict[str, Any] | None = Field(default=None, alias="schema")
    initial_value: Any | None = None
    sync_pattern: SyncPattern
    visibility: Visibility = Visibility.workflow
    owner_workflow_id: UUID | None = None
    lifecycle: Lifecycle = Lifecycle.persistent
    ttl: str | None = None


class Cost(BaseModel):
    amount: float
    currency: str


class Throughput(BaseModel):
    value: float
    unit: str
    period: str | None = None


class EscalationPolicy(BaseModel):
    warning_threshold: str | None = None
    warning_action: str | None = None
    breach_action: str | None = None
    notify_roles: list[UUID] = Field(default_factory=list)


class SLAMetric(BaseModel):
    name: str
    target: float
    unit: str | None = None
    comparison: str | None = None


class SLA(BaseModel):
    id: UUID | None = None
    name: str | None = None
    target_time: str | None = None
    max_time: str | None = None
    escalation_policy: EscalationPolicy | None = None
    metrics: list[SLAMetric] = Field(default_factory=list)


class Analytics(BaseModel):
    process_time: str | None = None
    cycle_time: str | None = None
    lead_time: str | None = None
    wait_time: str | None = None
    value_added: bool | None = None
    waste_categories: list[WasteCategory] = Field(default_factory=list)
    cost: Cost | None = None
    resource_utilization: float | None = None
    error_rate: float | None = None
    throughput: Throughput | None = None
    process_cycle_efficiency: float | None = None


class Activity(BaseModel):
    id: UUID
    name: str
    description: str | None = None
    role_id: UUID
    actor_type: ActorType
    system_id: UUID | None = None
    machine_id: UUID | None = None
    endpoint_id: UUID | None = None
    organization_id: UUID | None = None
    inputs: list[DataObject] = Field(default_factory=list)
    outputs: list[DataObject] = Field(default_factory=list)
    context_bindings: list[ContextBinding] = Field(default_factory=list)
    access_rights: list[AccessRight] = Field(default_factory=list)
    programs: list[Program] = Field(default_factory=list)
    controls: list[Control] = Field(default_factory=list)
    sla: SLA | None = None
    analytics: Analytics | None = None
    is_expandable: bool = False
    expansion_workflow_id: UUID | None = None


class Edge(BaseModel):
    id: UUID
    source_id: UUID
    target_id: UUID
    source_type: NodeType | None = None
    target_type: NodeType | None = None
    condition: str | None = None
    label: str | None = None
    is_default: bool = False


class Event(BaseModel):
    id: UUID
    name: str
    description: str | None = None
    event_type: str
    event_definition: dict[str, Any] | None = None


class TableColumn(BaseModel):
    name: str
    label: str | None = None
    type: str
    allowed_values: list[Any] | None = None


class DecisionRule(BaseModel):
    id: UUID | None = None
    description: str | None = None
    input_entries: list[str]
    output_entries: list[Any]
    output_edge_id: UUID | None = None


class DecisionTable(BaseModel):
    hit_policy: HitPolicy
    inputs: list[TableColumn]
    outputs: list[TableColumn]
    rules: list[DecisionRule]


class DecisionNode(BaseModel):
    id: UUID
    name: str
    description: str | None = None
    decision_table: DecisionTable
    default_output_edge_id: UUID | None = None


class Workflow(BaseModel):
    id: UUID
    name: str
    version: str
    description: str | None = None
    owner_id: UUID | None = None
    organization_id: UUID | None = None
    parent_workflow_id: UUID | None = None
    expansion_activity_id: UUID | None = None
    activities: list[Activity]
    edges: list[Edge]
    events: list[Event] = Field(default_factory=list)
    decision_nodes: list[DecisionNode] = Field(default_factory=list)
    contexts: list[Context] = Field(default_factory=list)
    sla: SLA | None = None
    analytics: Analytics | None = None
    metadata: dict[str, Any] | None = None
    created_at: datetime | None = None
    updated_at: datetime | None = None


class AIModelConfig(BaseModel):
    model_id: str | None = None
    temperature: float | None = None
    max_tokens: int | None = None
    system_prompt: str | None = None


class MCPTool(BaseModel):
    server_name: str
    tool_name: str


class Role(BaseModel):
    id: UUID
    name: str
    description: str | None = None
    actor_type: ActorType
    organization_id: UUID | None = None
    capabilities: list[str] = Field(default_factory=list)
    is_embedded: bool = False
    ai_model_config: AIModelConfig | None = None
    mcp_tools: list[MCPTool] = Field(default_factory=list)


class System(BaseModel):
    id: UUID
    name: str
    vendor: str | None = None
    version: str | None = None
    type: str
    description: str | None = None
    base_url: str | None = None
    auth_config: dict[str, Any] | None = None


class Machine(BaseModel):
    id: UUID
    name: str
    type: str
    manufacturer: str | None = None
    model: str | None = None
    serial_number: str | None = None
    location: str | None = None
    protocol: str | None = None
    connection_string: str | None = None


class Endpoint(BaseModel):
    id: UUID
    name: str
    url: str
    method: str | None = None
    auth_type: str | None = None
    openapi_ref: str | None = None
    request_schema: dict[str, Any] | None = None
    response_schema: dict[str, Any] | None = None


class Collection(BaseModel):
    id: UUID
    name: str
    description: str | None = None
    workflow_ids: list[UUID] = Field(default_factory=list)
    shared_contexts: list[Context] = Field(default_factory=list)
    owner_id: UUID | None = None
    organization_id: UUID | None = None
    tags: list[str] = Field(default_factory=list)
    created_at: datetime | None = None
    updated_at: datetime | None = None


# ============================================================================
# VISUALIZATION TYPES (RE-EXPORT)
# ============================================================================

from awa.types.visualization import (
    ViewType,
    LayoutAlgorithm,
    LayoutDirection,
    LaneOrientation,
    CurveType,
    NodeShape,
    CameraType,
    AnimationEasing,
    VisualizationEngine,
    Vector2D,
    Vector3D,
    Quaternion,
    NodeStyle2D,
    NodeMaterial3D,
    NodePosition2D,
    NodePosition3D,
    EdgeStyle,
    EdgeRouting,
    Lane,
    AutoLayoutConfig,
    CameraSettings2D,
    CameraSettings3D,
    AnimationConfig,
    ThemeConfig,
    VisualizationConfig,
)

