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
