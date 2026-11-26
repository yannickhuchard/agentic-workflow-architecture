"""
AWA (Agentic Workflow Architecture) Python SDK
"""

from awa.types import (
    ActorType,
    AccessMode,
    SyncPattern,
    ContextType,
    Visibility,
    Permission,
    ResourceType,
    AccessDirection,
    HitPolicy,
    WasteCategory,
    NodeType,
    Workflow,
    Activity,
    Edge,
    Event,
    Context,
    ContextBinding,
    KnowledgeBinding,
    AccessRight,
    DecisionNode,
    DecisionTable,
    DecisionModel,
    DecisionOption,
    ToolDefinition,
    ToolBinding,
    Guardrail,
    Role,
    System,
    Machine,
    Endpoint,
    SLA,
    Analytics,
    Program,
    Control,
    DataObject,
    Collection,
    HumanTask,
    WorkflowExecution,
)
from awa.builder import WorkflowBuilder, workflow
from awa.validator import (
    validate_workflow,
    validate_activity,
    validate_context,
    validate_workflow_integrity,
    ValidationResult,
    ValidationError,
)
from awa.runtime import (
    Token,
    TokenStatus,
    ContextManager,
    WorkflowEngine,
    EngineStatus,
    TaskService,
    ExecutionService,
    ToolRunner,
    ToolOptions,
    ModelRegistry,
    ModelRouter,
    FunctionModelProvider,
    OpenAICompatibleModelProvider,
)
from awa.runtime.business_event import business_event
from awa.runtime.journey import JourneyDefinition, parse_journey
from awa.runtime.runtime_host import AwaRuntime, InMemoryRuntimeStore, FileRuntimeStore, open_runtime_directory
from awa.runtime.postgres_store import PostgresRuntimeStore, open_runtime_store
from awa.runtime.kpi import MEASURES, compute_measures, measures_to_openmetrics
from awa.runtime.telemetry import journey_spans, run_spans, spans_to_otlp_json, spans_to_otlp_protobuf
from awa.runtime.telemetry_export import OtlpHttpExporter, telemetry_from_env
from awa.runtime.knowledge import KnowledgeBase
from awa.runtime.counterfactual import counterfactual_replay, render_counterfactual_report
from awa.runtime.migration import as_migrated, compare_versions, plan_migration
from awa.runtime.evidence import compute_evidence, render_evidence_html, render_evidence_markdown
from awa.runtime.evaluation import build_dataset, evaluate_dataset, render_evaluation_report
from awa.runtime.shadow import ShadowRunner
from awa.runtime.authorization import (
    AuthorizationError, PolicyDecider, load_authorization, validate_policy, principal_from_claims, principal_named,
)
from awa.runtime.guardrails import GuardrailSet

__version__ = "2.0.0"
__all__ = [
    # Enums
    "ActorType",
    "AccessMode",
    "SyncPattern",
    "ContextType",
    "Visibility",
    "Permission",
    "ResourceType",
    "AccessDirection",
    "HitPolicy",
    "WasteCategory",
    "NodeType",
    # Entities
    "Workflow",
    "Activity",
    "Edge",
    "Event",
    "Context",
    "ContextBinding",
    "AccessRight",
    "DecisionNode",
    "DecisionTable",
    "DecisionModel",
    "DecisionOption",
    "ToolDefinition",
    "ToolBinding",
    "Role",
    "System",
    "Machine",
    "Endpoint",
    "SLA",
    "Analytics",
    "Program",
    "Control",
    "DataObject",
    "Collection",
    "HumanTask",
    "WorkflowExecution",
    # Builder
    "WorkflowBuilder",
    "workflow",
    # Validator
    "validate_workflow",
    "validate_activity",
    "validate_context",
    "validate_workflow_integrity",
    "ValidationResult",
    "ValidationError",
    # Runtime
    "Token",
    "TokenStatus",
    "ContextManager",
    "WorkflowEngine",
    "EngineStatus",
    "TaskService",
    "ExecutionService",
    # Tools and model binding
    "ToolRunner",
    "ToolOptions",
    "ModelRegistry",
    "ModelRouter",
    "FunctionModelProvider",
    "OpenAICompatibleModelProvider",
    # Knowledge and counterfactual replay
    "KnowledgeBase",
    "KnowledgeBinding",
    "counterfactual_replay",
    "as_migrated",
    "compare_versions",
    "plan_migration",
    "render_counterfactual_report",
    # Business events, journeys and measures
    "business_event",
    "JourneyDefinition",
    "parse_journey",
    "AwaRuntime",
    "InMemoryRuntimeStore",
    "FileRuntimeStore",
    "open_runtime_directory",
    "PostgresRuntimeStore",
    "open_runtime_store",
    "MEASURES",
    "compute_measures",
    "measures_to_openmetrics",
    # Evidence, evaluation from journals and shadow runs
    "compute_evidence",
    "render_evidence_markdown",
    "render_evidence_html",
    "build_dataset",
    "evaluate_dataset",
    "render_evaluation_report",
    "ShadowRunner",
    # Identity and authorization (specification 30)
    "AuthorizationError", "PolicyDecider", "load_authorization", "validate_policy", "principal_from_claims", "principal_named",
    # Guardrails on what goes into and comes out of agents and tools (specification 31)
    "Guardrail",
    "GuardrailSet",
    "run_spans",
    "journey_spans",
    "spans_to_otlp_json",
    "spans_to_otlp_protobuf",
    "OtlpHttpExporter",
    "telemetry_from_env",
]

