"""
AWA Types - Pydantic models for all AWA entities
"""

from datetime import datetime
from enum import Enum
from typing import Any, Literal
from uuid import UUID

from pydantic import BaseModel, Field, model_validator


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


class RetryPolicy(BaseModel):
    """What the engine does when the actor raises an error (specification 10.1)"""
    max_attempts: int | None = Field(default=None, ge=1, le=20)
    initial_delay: str | None = None
    max_delay: str | None = None
    backoff_multiplier: float | None = Field(default=None, ge=1)
    jitter: bool | None = None
    non_retryable_errors: list[str] | None = None


class VerificationCriterion(BaseModel):
    id: UUID
    name: str
    description: str
    type: Literal["completeness", "accuracy", "format", "compliance", "custom"]
    expression: str | None = None
    weight: float = Field(default=1, ge=0, le=1)
    required: bool = True


class VerificationPolicy(BaseModel):
    """Acceptance verification applied to an activity's output (specification 7)"""
    enabled: bool = True
    mode: Literal["ai_judge", "schema_only", "custom"] = "ai_judge"
    criteria: list[VerificationCriterion] = Field(min_length=1)
    max_retries: int = Field(default=3, ge=0, le=10)
    retry_with_feedback: bool = True
    output_schema: dict[str, Any] | None = None
    judge_model_id: str | None = None
    judge_temperature: float = Field(default=0.1, ge=0, le=1)
    pass_threshold: float = Field(default=0.9, ge=0, le=1)


class ToolBinding(BaseModel):
    """
    What a tool runs (specification 17.2). `kind` says which of the other
    fields apply: http (method, url, headers), command (command, args),
    jsonrpc (endpoint, method), grpc (endpoint, service, method),
    mcp (server, tool) or function (name).
    """
    kind: Literal["http", "command", "jsonrpc", "grpc", "mcp", "function"]
    method: str | None = None
    url: str | None = None
    headers: dict[str, str] | None = None
    command: str | None = None
    args: list[str] | None = None
    endpoint: str | None = None
    service: str | None = None
    server: str | None = None
    tool: str | None = None
    name: str | None = None

    @model_validator(mode="after")
    def _fields_of_kind(self) -> "ToolBinding":
        required = {
            "http": ("url",), "command": ("command",), "jsonrpc": ("endpoint", "method"),
            "grpc": ("endpoint", "service", "method"), "mcp": ("server", "tool"), "function": ("name",),
        }[self.kind]
        missing = [name for name in required if getattr(self, name) is None]
        if missing:
            raise ValueError(f'A "{self.kind}" binding needs {", ".join(missing)}')
        if self.kind == "http":
            self.method = (self.method or "GET").upper()
            if self.method not in ("GET", "POST", "PUT", "PATCH", "DELETE", "HEAD"):
                raise ValueError(f'Unsupported HTTP method "{self.method}"')
        return self


class ToolDefinition(BaseModel):
    """A function an actor may call while performing an activity (specification 17.1)"""
    name: str = Field(pattern=r"^[A-Za-z_][A-Za-z0-9_-]{0,63}$")
    description: str | None = None
    parameters: dict[str, Any] | None = None
    binding: ToolBinding
    documentation: str | None = None
    timeout: str | None = None


class Postcondition(BaseModel):
    id: UUID | None = None
    name: str
    description: str | None = None
    expression: str


class ContractBudgets(BaseModel):
    max_attempts: int | None = Field(default=None, ge=1, le=50)
    max_duration: str | None = None
    max_tokens: int | None = Field(default=None, ge=1)
    max_tool_calls: int | None = Field(default=None, ge=0)


class OutcomeContract(BaseModel):
    """What must be true of an activity's outcome (specification 11)"""
    output_schema: dict[str, Any] | None = None
    postconditions: list[Postcondition] = Field(default_factory=list)
    budgets: ContractBudgets | None = None
    on_violation: Literal["fail", "escalate_human"] = "fail"


class Compensation(BaseModel):
    """The activity that undoes this one if the run later fails (specification 13.6)"""
    activity_id: UUID


class KnowledgeBinding(BaseModel):
    """Which knowledge entries an activity's actor is given when it executes (specification 15.4)"""
    types: list[Literal["strategy", "failure_pattern", "decision_precedent", "lesson"]] | None = None
    tags: list[str] | None = None
    max_entries: int | None = Field(default=None, ge=1, le=20)
    min_status: Literal["draft", "reviewed"] | None = None


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
    retry: RetryPolicy | None = None
    verification: VerificationPolicy | None = None
    outcome_contract: OutcomeContract | None = None
    tools: list[ToolDefinition] = Field(default_factory=list)
    compensation: Compensation | None = None
    knowledge: KnowledgeBinding | None = None
    join: Literal["any", "all"] = "any"


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
    join: Literal["any", "all"] = "any"


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
    priority: float | None = None


class DecisionTable(BaseModel):
    hit_policy: HitPolicy
    inputs: list[TableColumn]
    outputs: list[TableColumn]
    rules: list[DecisionRule]


class DecisionOption(BaseModel):
    """One of the only decisions a model, or an external engine, may make"""
    id: str = Field(pattern=r"^[A-Za-z0-9_-]{1,64}$")
    description: str | None = None
    output_edge_id: UUID


class DecisionModel(BaseModel):
    """A language model that decides at a decision node, within enumerated options (specification 16.1)"""
    model: str | None = None
    instructions: str
    options: list[DecisionOption] = Field(min_length=2)
    inputs: list[str] | None = None
    strategy: Literal["table_first", "model"] | None = None
    min_confidence: float = Field(default=0, ge=0, le=1)
    output: str | None = Field(default=None, pattern=r"^[A-Za-z]\w*$")
    votes: int = Field(default=1, ge=1, le=9)
    temperature: float | None = Field(default=None, ge=0, le=2)

    @model_validator(mode="after")
    def _options_are_described(self) -> "DecisionModel":
        if any(option.description is None for option in self.options):
            raise ValueError("Every option of a decision model needs a description")
        return self


class DecisionEngineBinding(BaseModel):
    """An external decision engine consulted instead of a table (specification 5.5.4)"""
    name: str
    ruleset: str | None = None
    options: list[DecisionOption] = Field(min_length=1)
    inputs: list[str] | None = None
    config: dict[str, Any] | None = None


class DecisionNode(BaseModel):
    id: UUID
    name: str
    description: str | None = None
    decision_table: DecisionTable | None = None
    decision_engine: DecisionEngineBinding | None = None
    decision_model: DecisionModel | None = None
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


class HumanTask(BaseModel):
    id: UUID
    activity_id: UUID
    activity_name: str
    token_id: UUID
    workflow_id: UUID
    status: str = "pending"
    priority: str = "normal"
    assignee_id: str | None = None
    role_id: UUID
    creator_id: str | None = None
    creator_type: ActorType | None = None
    assigner_id: str | None = None
    assigner_type: ActorType | None = None
    inputs: dict[str, Any]
    outputs: dict[str, Any] | None = None
    created_at: datetime
    updated_at: datetime
    due_at: datetime | None = None
    completed_at: datetime | None = None
    description: str | None = None
    form_schema: dict[str, Any] | None = None
    tags: list[str] | None = None


class WorkflowExecution(BaseModel):
    id: UUID
    workflow_id: UUID
    workflow_name: str
    status: str
    started_at: datetime
    completed_at: datetime
    duration_ms: int
    input_tokens: int = 0
    output_tokens: int = 0
    total_tokens: int = 0
    execution_cost: float = 0.0
    currency: str = "USD"
    steps_count: int = 0
    user_id: str | None = None
    metadata: dict[str, Any] | None = None


class JournalEvent(BaseModel):
    """One entry in the append-only execution journal of a run (specification 9.1)"""
    spec_version: str
    id: UUID
    run_id: UUID
    seq: int = Field(ge=1)
    time: datetime
    type: str
    level: Literal["execution", "reasoning", "meta"] = "execution"
    workflow_id: UUID
    token_id: UUID | None = None
    node_id: UUID | None = None
    node_name: str | None = None
    attempt: int | None = Field(default=None, ge=1)
    data: dict[str, Any] = Field(default_factory=dict)


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

