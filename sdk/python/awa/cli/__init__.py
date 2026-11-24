"""
AWA CLI
Command-line interface for running AWA workflows
"""

import argparse
import json
import os
import sys
from pathlib import Path

from awa import __version__
from awa.types import Workflow


def main(argv: list[str] | None = None) -> int:
    """Main CLI entry point"""
    parser = argparse.ArgumentParser(
        prog="awa",
        description="Agentic Workflow Architecture CLI"
    )
    parser.add_argument(
        "--version", "-V",
        action="version",
        version=f"awa {__version__}"
    )
    
    subparsers = parser.add_subparsers(dest="command", help="Commands")
    
    # Validate command
    validate_parser = subparsers.add_parser("validate", help="Validate a workflow file")
    validate_parser.add_argument("file", help="Workflow JSON file path")
    
    # Serve command
    serve_parser = subparsers.add_parser("serve", help="Start the Operational API server")
    serve_parser.add_argument(
        "--port", "-p",
        type=int,
        default=3000,
        help="Port to listen on (default: 3000)"
    )
    serve_parser.add_argument(
        "--host",
        default="0.0.0.0",
        help="Host to bind to (default: 0.0.0.0)"
    )
    serve_parser.add_argument("--a2a", action="append", default=[], metavar="FILE",
                              help="Offer this workflow to other agents over A2A (can be repeated)")
    serve_parser.add_argument("--public-url", metavar="URL",
                              help="The address callers reach this server at, written in agent cards. Default: taken from each request")
    serve_parser.add_argument("--deployment", metavar="FILE",
                              help="JSON file saying what the workflows may reach: tools.allow_commands, tools.allowed_hosts, "
                                   "tools.mcp_servers, tools.grpc, a2a")
    serve_parser.add_argument(
        "--store",
        help="Keep journeys and runs in this PostgreSQL runtime store, which several servers may share (default: $AWA_RUNTIME_STORE)"
    )
    
    # Journeys kept in a runtime directory, the measures of what was recorded, and counterfactual replay
    from awa.cli import journey as journey_commands, measures as measures_command, replay as replay_command
    from awa.cli import knowledge as knowledge_commands, run as run_command, task as task_commands
    from awa.cli import evaluate as evaluate_commands, evidence as evidence_command
    from awa.cli import telemetry as telemetry_commands
    run_command.add_parser(subparsers)
    task_commands.add_parser(subparsers)
    knowledge_commands.add_parser(subparsers)
    journey_commands.add_parser(subparsers)
    measures_command.add_parser(subparsers)
    replay_command.add_parser(subparsers)
    evidence_command.add_parser(subparsers)
    evaluate_commands.add_parser(subparsers)
    telemetry_commands.add_parser(subparsers)

    args = parser.parse_args(argv)

    if args.command == "validate":
        return validate_workflow_cmd(args)
    elif args.command == "serve":
        return serve_api(args)
    elif getattr(args, "handler", None):
        return args.handler(args)
    else:
        parser.print_help()
        return 0


def validate_workflow_cmd(args: argparse.Namespace) -> int:
    """Validate a workflow file"""
    from awa.validator import validate_workflow as validate, validate_workflow_integrity
    
    try:
        file_path = Path(args.file)
        if not file_path.exists():
            print(f"Error: File not found: {file_path}", file=sys.stderr)
            return 1
        
        with open(file_path, "r", encoding="utf-8") as f:
            data = json.load(f)
        
        workflow = Workflow(**data)
        
        # Run validation
        result = validate(workflow)
        
        if result.valid:
            print(f"✓ Workflow is valid: {workflow.name}")
            
            # Check integrity
            if validate_workflow_integrity(workflow):
                print("✓ Workflow integrity check passed")
            else:
                print("⚠ Workflow integrity issues found")
            
            return 0
        else:
            print(f"✗ Workflow validation failed:")
            for error in result.errors:
                print(f"  - {error.path}: {error.message}")
            return 1
            
    except Exception as e:
        print(f"Error: {e}", file=sys.stderr)
        return 1


def serve_api(args: argparse.Namespace) -> int:
    """Start the Operational API server"""
    try:
        import uvicorn
        from awa.server import app

        # Workflows offered over A2A run under the deployment's permissions, like any other run (28.8)
        if args.a2a:
            import os
            from fastapi import Depends
            from awa.cli.deployment import load_deployment
            from awa.runtime.journal import FileJournalStore
            from awa.server import AUTH_ENABLED, rate_limiter
            from awa.server.a2a import mount_a2a
            deployment = load_deployment(args.deployment) if args.deployment else {"tools": {}, "a2a": {}}

            def engine_options() -> dict:
                journal_dir = os.environ.get("AWA_JOURNAL_DIR")
                return {"tools": deployment["tools"], "a2a": deployment["a2a"],
                        **({"journal": FileJournalStore(journal_dir)} if journal_dir else {})}
            from awa.cli.run import read_workflow
            offered = [read_workflow(file) for file in args.a2a]
            mount_a2a(app, offered, engine_options=engine_options, public_url=args.public_url,
                      authenticated=AUTH_ENABLED, dependencies=[Depends(rate_limiter)])
            for workflow in offered:
                print(f"  A2A agent \"{workflow.name}\": {args.public_url or f'http://{args.host}:{args.port}'}/a2a/{workflow.id}/.well-known/agent-card.json")

        # The routes read the store from the environment, as a server started without this option would
        if getattr(args, "store", None):
            os.environ["AWA_RUNTIME_STORE"] = args.store
            print("  Journeys: kept in the shared runtime store")

        print(f"Starting AWA Operational API on http://{args.host}:{args.port}")
        uvicorn.run(app, host=args.host, port=args.port)
        return 0
    except ImportError:
        print("Error: 'fastapi' and 'uvicorn' are required for this command.", file=sys.stderr)
        print("Install them with: pip install 'awa[web]'", file=sys.stderr)
        return 1
    except Exception as e:
        print(f"Error: {e}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
