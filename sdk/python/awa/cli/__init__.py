"""
AWA CLI
Command-line interface for running AWA workflows
"""

import argparse
import json
import sys
from pathlib import Path

from awa import __version__
from awa.types import Workflow
from awa.runtime import WorkflowEngine


def main() -> int:
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
    
    # Run command
    run_parser = subparsers.add_parser("run", help="Execute a workflow file")
    run_parser.add_argument("file", help="Workflow JSON file path")
    run_parser.add_argument(
        "--verbose", "-v",
        action="store_true",
        help="Enable verbose output"
    )
    run_parser.add_argument(
        "--key", "-k",
        help="Gemini API key for AI agents"
    )
    
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
    
    args = parser.parse_args()
    
    if args.command == "run":
        return run_workflow(args)
    elif args.command == "validate":
        return validate_workflow_cmd(args)
    elif args.command == "serve":
        return serve_api(args)
    else:
        parser.print_help()
        return 0


def run_workflow(args: argparse.Namespace) -> int:
    """Run a workflow from file"""
    try:
        file_path = Path(args.file)
        if not file_path.exists():
            print(f"Error: File not found: {file_path}", file=sys.stderr)
            return 1
        
        with open(file_path, "r", encoding="utf-8") as f:
            data = json.load(f)
        
        workflow = Workflow(**data)
        
        engine = WorkflowEngine(
            workflow=workflow,
            gemini_api_key=args.key,
            verbose=args.verbose
        )
        
        result = engine.run()
        
        print(json.dumps(result, indent=2, default=str))
        return 0
        
    except Exception as e:
        print(f"Error: {e}", file=sys.stderr)
        return 1


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
