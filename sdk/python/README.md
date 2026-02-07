# AWA Python SDK

Python SDK for Agentic Workflow Architecture (AWA).

## Installation

```bash
pip install awa
```

## Usage

```python
from awa import workflow

# Build a workflow
my_workflow = (
    workflow("My Workflow", "1.0.0")
    .description("A simple workflow")
    .activity("Start", {"actor_type": "application", "role_id": "system"})
    .build()
)

# Run a workflow
from awa.runtime import WorkflowEngine

engine = WorkflowEngine(my_workflow)
result = engine.run()
print(result)
```

## Features

- **Built-in VSM & Analytics**: Real-time tracking of DOWNTIME waste (Waiting, Defects) and process metrics.
- **Fluent Builder API**: Construct complex workflows with a clean Pythonic interface.
- **Gemini AI Integration**: First-class support for AI agents.
- **REST API Support**: Optional server mode via FastAPI.
