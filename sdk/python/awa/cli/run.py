"""
awa run: execute a workflow file, as the reference command line does.

Model providers are named with --providers, in order of preference. Each
capability tier (reasoning, balanced, fast) falls back down that list. The
reference maps each provider's tiers to the models of its TIER_PRESETS; this
SDK ships no presets, because it names no models, so the model behind each
tier is read from the environment: AWA_<PROVIDER>_MODEL_<TIER> (for example
AWA_OLLAMA_MODEL_FAST), or AWA_<PROVIDER>_MODEL for every tier of that
provider. A tier none of them names is "<first provider>:default" (12.3).
"""

import argparse
import json
import os
import sys
from pathlib import Path
from typing import Any

from awa.runtime.checkpoint import FileCheckpointStore
from awa.runtime.journal import FileJournalStore
from awa.runtime.models import STANDARD_TIERS, OpenAICompatibleModelProvider, ollama_provider
from awa.runtime.token import TokenStatus
from awa.types import Workflow
from awa.validator import validate_workflow_integrity

KNOWN_PROVIDERS = ("openai", "ollama")
# Providers of the reference SDK that this SDK does not have
MISSING_PROVIDERS = {
    "google": "the Python SDK has no Google model provider",
    "embedded": "the Python SDK has no embedded model provider",
}
# The example rates the reference command line prices a run at
PRICING = {"input_token_cost_per_1k": 0.0001, "output_token_cost_per_1k": 0.0004, "currency": "USD"}


class _JournalFile(FileJournalStore):
    """Every event of the run in the one file named, whatever its extension"""

    def _file_for(self, run_id: str) -> str:
        return self.location


def read_workflow(file: str) -> Workflow:
    document = json.loads(Path(file).read_text(encoding="utf-8"))
    inner = document["workflow"] if isinstance(document, dict) and "workflow" in document and "activities" not in document else document
    return Workflow.model_validate(inner)


def model_options(names: list[str], environ: "os._Environ[str] | dict[str, str] | None" = None) -> dict[str, Any]:
    """The engine options for the model providers named, in order of preference"""
    env = os.environ if environ is None else environ
    providers: list[Any] = []
    for name in names:
        if name in MISSING_PROVIDERS:
            raise ValueError(f'Provider "{name}" is not available: {MISSING_PROVIDERS[name]}. '
                             f'Use {" or ".join(KNOWN_PROVIDERS)}')
        if name == "openai":
            key = env.get("OPENAI_API_KEY")
            if not key:
                raise ValueError('Provider "openai" needs OPENAI_API_KEY')
            providers.append(OpenAICompatibleModelProvider("openai", "https://api.openai.com/v1", api_key=key))
        elif name == "ollama":
            providers.append(ollama_provider(env.get("OLLAMA_BASE_URL") or "http://localhost:11434/v1"))
        else:
            raise ValueError(f'Unknown provider "{name}". Use {" or ".join(KNOWN_PROVIDERS)}')
    if not providers:
        return {}

    tiers: dict[str, list[str]] = {}
    for tier in STANDARD_TIERS:
        refs = []
        for name in names:
            model = env.get(f"AWA_{name.upper()}_MODEL_{tier.upper()}") or env.get(f"AWA_{name.upper()}_MODEL")
            if model:
                refs.append(f"{name}:{model}")
        if refs:
            tiers[tier] = refs
    if not tiers:
        print(f'Note: no model is named for any capability tier, so each is "{names[0]}:default". Set '
              f"AWA_{names[0].upper()}_MODEL or AWA_{names[0].upper()}_MODEL_<TIER>, unless every role names its model.",
              file=sys.stderr)
    return {
        "model_providers": providers,
        "default_model_provider": names[0],
        "model_tiers": tiers,
        # With providers named, a model that is not named is the balanced tier of those providers, as the reference does
        "default_ai_model_id": "tier:balanced",
    }


def _allow_commands(value: Any) -> bool | list[str]:
    if value is None:
        return False
    if value is True or value == "all":
        return True
    return [part.strip() for part in str(value).split(",") if part.strip()]


def _metrics(workflow: Workflow, engine: Any) -> None:
    """The end-of-run metrics, printed as the reference's console execution logger prints them"""
    finished = [e for e in engine.get_events() if e["type"] in ("run.completed", "run.failed")]
    data = finished[-1]["data"] if finished else {}
    total = int(data.get("input_tokens") or 0) + int(data.get("output_tokens") or 0)
    print("--- Workflow Execution Metrics ---")
    print(f"Workflow: {workflow.name} ({workflow.id})")
    print(f"Status: {engine.status.value}")
    print(f"Duration: {data.get('duration_ms', 0)}ms")
    print(f"Steps: {data.get('steps', 0)}")
    print(f"Tokens: {total} (In: {data.get('input_tokens', 0)}, Out: {data.get('output_tokens', 0)})")
    print(f"Cost: {data.get('currency', 'USD')} {float(data.get('cost') or 0):.6f}")
    print("----------------------------------")


def run_command(args: argparse.Namespace) -> int:
    from awa.runtime.workflow_engine import EngineStatus, WorkflowEngine

    try:
        file_path = Path(args.file)
        if not file_path.exists():
            raise ValueError(f"File not found: {file_path}")
        workflow = read_workflow(str(file_path))
        integrity = validate_workflow_integrity(workflow)
        if not integrity.valid:
            raise ValueError("Invalid workflow: " + "; ".join(e.message for e in integrity.errors))
        initial = json.loads(args.input) if args.input else {}
        if not isinstance(initial, dict):
            raise ValueError("--input must be a JSON object")
        names = [n.strip() for n in (args.providers or "").split(",") if n.strip()]
        # What the workflow may reach (specification 17.4, 28.2)
        from awa.cli.deployment import load_deployment
        deployment = load_deployment(args.deployment) if args.deployment else {"tools": {}, "a2a": {}}

        options: dict[str, Any] = {
            **model_options(names),
            "simulate": bool(args.simulate),
            "tools": {**deployment["tools"], "allow_commands": _allow_commands(args.allow_commands)
                      if args.allow_commands is not None else deployment["tools"].get("allow_commands", False)},
            "a2a": deployment["a2a"],
            "pricing_config": dict(PRICING),
            # The execution record goes to the database only when asked; otherwise it is printed
            "log_execution": bool(args.db),
            "verbose": bool(args.verbose),
        }
        if args.outputs:
            options["simulated_outputs"] = json.loads(Path(args.outputs).read_text(encoding="utf-8"))
        if args.journal:
            options["journal"] = _JournalFile(str(Path(args.journal).resolve()))
        if args.checkpoint_dir:
            options["checkpoint"] = FileCheckpointStore(str(Path(args.checkpoint_dir).resolve()))

        print(f"Starting workflow: {workflow.name} ({workflow.id})")
        if args.simulate:
            print("Running in SIMULATION MODE. No real API calls will be made.")

        # OTEL_EXPORTER_OTLP_ENDPOINT and its family send the run's spans as it proceeds (specification 26.11)
        from awa.runtime.telemetry_export import shared_telemetry_from_env
        telemetry = shared_telemetry_from_env()
        if telemetry:
            options["telemetry"] = telemetry
        engine = WorkflowEngine(workflow, gemini_api_key=args.key, options=options)
        engine.start(initial)
        print(f"Workflow started (Run ID: {engine.run_id})")
        steps = 0
        while engine.status == EngineStatus.RUNNING:
            engine.run_step()
            steps += 1
            if args.verbose:
                print(f"Step {steps} completed.")
                print(f"Active tokens: {sum(1 for t in engine.tokens if t.status == TokenStatus.ACTIVE)}")

        status = engine.status
        if telemetry:
            # Spans still queued leave before the command ends; this waits at most the export timeout
            telemetry["exporter"].flush()
        if not args.db and status in (EngineStatus.COMPLETED, EngineStatus.FAILED):
            _metrics(workflow, engine)
        print(f"Workflow finished with status: {status.value}")
        if args.journal:
            print(f"Journal written to {args.journal}")

        if status == EngineStatus.FAILED:
            failed = [t for t in engine.tokens if t.status == TokenStatus.FAILED]
            for token in failed:
                print(f"Failed: {token.get_data('_error')}", file=sys.stderr)
            if args.simulate and any(t.get_data("_error_code") in ("NO_ROUTE", "CONTRACT_VIOLATION") for t in failed):
                print("Simulated activities return no business data unless you supply it. "
                      "Use --outputs <file> to say what each activity returns.", file=sys.stderr)
            print("Workflow failed.", file=sys.stderr)
            return 1
        return 0
    except Exception as error:
        print(f"Error running workflow: {error}", file=sys.stderr)
        if getattr(args, "verbose", False):
            import traceback
            traceback.print_exc()
        return 1


def add_parser(subparsers: Any) -> None:
    parser = subparsers.add_parser(
        "run", help="Run a workflow file",
        description="Run a workflow file. Model providers: " + ", ".join(KNOWN_PROVIDERS) + ". "
                    "openai reads OPENAI_API_KEY; ollama reads OLLAMA_BASE_URL (default http://localhost:11434/v1), "
                    "which can point at any OpenAI-compatible server. The model behind each capability tier is read from "
                    "AWA_<PROVIDER>_MODEL_<TIER> or AWA_<PROVIDER>_MODEL. The google and embedded providers of the "
                    "TypeScript SDK are not available in Python.")
    parser.add_argument("file", help="Path to the .awa.json file")
    parser.add_argument("-v", "--verbose", action="store_true", help="Enable verbose output")
    parser.add_argument("-k", "--key", help="Gemini API key. Accepted for compatibility; the Python SDK has no Google provider")
    parser.add_argument("--db", action="store_true", help="Log execution to database")
    parser.add_argument("-s", "--simulate", action="store_true", help="Run in simulation mode (no real API calls)")
    parser.add_argument("-p", "--providers", metavar="LIST",
                        help="Model providers in order of preference, comma separated: openai, ollama. "
                             "Each capability tier falls back down the list")
    parser.add_argument("--allow-commands", nargs="?", const=True, default=None, metavar="LIST",
                        help="Let tools run commands on this machine: all, or a comma-separated list of program names")
    parser.add_argument("--deployment", metavar="FILE",
                        help="JSON file saying what the workflow may reach: tools.allow_commands, tools.allowed_hosts, "
                             "tools.mcp_servers, tools.grpc, a2a")
    parser.add_argument("--outputs", metavar="FILE",
                        help="With --simulate: JSON file giving what each activity returns, by activity name")
    parser.add_argument("-j", "--journal", metavar="FILE", help="Write the execution journal to this .jsonl file")
    parser.add_argument("-c", "--checkpoint-dir", metavar="DIR",
                        help="Checkpoint the run state to this directory after every step")
    parser.add_argument("-i", "--input", metavar="JSON", help="Initial data for the run, as a JSON object")
    parser.set_defaults(handler=run_command)
