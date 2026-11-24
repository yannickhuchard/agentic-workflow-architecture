"""
AWA Runtime Module
Token and workflow execution support
"""

from .token import Token, TokenStatus
from .context_manager import ContextManager
from .workflow_engine import WorkflowEngine, EngineStatus
from .logger import Logger, get_logger, create_logger_from_env
from .retry import RetryConfig, DeadLetterQueue, get_dead_letter_queue, with_retry
from .services.task_service import TaskService, ExecutionService
from .journal import JournalWriter, InMemoryJournalStore, FileJournalStore, parse_journal
from .checkpoint import InMemoryCheckpointStore, FileCheckpointStore
from .verification import VerificationEngine
from .tools import ToolRunner, ToolOptions, ToolResult, ToolExecution, ToolError, ActorContext, tool_link
from .models import (
    ModelRegistry, ModelRouter, ModelRequest, ModelResponse, ModelError, RouteAttempt,
    FunctionModelProvider, OpenAICompatibleModelProvider, ollama_provider,
)
from .decision_model import decide_with_model, parse_vote
from .business_event import business_event
from .journey import (
    JourneyDefinition, parse_journey, validate_journey, journey_analytics, journey_transitions,
)
from .runtime_host import (
    AwaRuntime, InMemoryRuntimeStore, FileRuntimeStore, open_runtime_directory, add_definition, simulated_actors,
)
from .kpi import MEASURES, compute_measures, measures_to_openmetrics
from .context_manager import ContextError
from .knowledge import KnowledgeBase, distill, guidance
from .counterfactual import ReplayResult, compare_runs, counterfactual_replay, render_counterfactual_report
from .evidence import compute_evidence, render_evidence_html, render_evidence_markdown, unresolved_citations
from .evaluation import build_dataset, evaluate_dataset, render_evaluation_report
from .shadow import ShadowRunner

__all__ = [
    "Token",
    "TokenStatus",
    "ContextManager",
    "WorkflowEngine",
    "EngineStatus",
    "Logger",
    "get_logger",
    "create_logger_from_env",
    "RetryConfig",
    "DeadLetterQueue",
    "get_dead_letter_queue",
    "with_retry",
    "TaskService",
    "ExecutionService",
    "JournalWriter",
    "InMemoryJournalStore",
    "FileJournalStore",
    "parse_journal",
    "InMemoryCheckpointStore",
    "FileCheckpointStore",
    "VerificationEngine",
    "ToolRunner",
    "ToolOptions",
    "ToolResult",
    "ToolExecution",
    "ToolError",
    "ActorContext",
    "tool_link",
    "ModelRegistry",
    "ModelRouter",
    "ModelRequest",
    "ModelResponse",
    "ModelError",
    "RouteAttempt",
    "FunctionModelProvider",
    "OpenAICompatibleModelProvider",
    "ollama_provider",
    "decide_with_model",
    "parse_vote",
    "business_event",
    "JourneyDefinition",
    "parse_journey",
    "validate_journey",
    "journey_analytics",
    "journey_transitions",
    "AwaRuntime",
    "InMemoryRuntimeStore",
    "FileRuntimeStore",
    "open_runtime_directory",
    "add_definition",
    "simulated_actors",
    "MEASURES",
    "compute_measures",
    "measures_to_openmetrics",
    "ContextError",
    "KnowledgeBase",
    "distill",
    "guidance",
    "ReplayResult",
    "compare_runs",
    "counterfactual_replay",
    "render_counterfactual_report",
    "compute_evidence",
    "render_evidence_markdown",
    "render_evidence_html",
    "unresolved_citations",
    "build_dataset",
    "evaluate_dataset",
    "render_evaluation_report",
    "ShadowRunner",
]
