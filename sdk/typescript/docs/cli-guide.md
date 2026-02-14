# AWA CLI - Installation & User Guide

A comprehensive guide to installing and using the AWA (Agentic Workflow Architecture) CLI tool.

---

## Table of Contents
1. [Installation](#installation)
2. [Quick Start](#quick-start)
3. [Commands Reference](#commands-reference)
4. [Examples](#examples)
   - [Simple Workflows](#simple-workflows)
   - [Intermediate Workflows](#intermediate-workflows)
   - [Advanced Workflows](#advanced-workflows)
5. [Troubleshooting](#troubleshooting)

---

## Installation

### Option 1: Global Installation (Recommended)

Install the AWA CLI globally to use it anywhere on your system:

```bash
npm install -g agentic-workflow-architecture
```

After installation, verify it's working:

```bash
awa --version
```

### Option 2: Local Installation

Install in a project:

```bash
npm install agentic-workflow-architecture
```

Then run using npx:

```bash
npx awa --version
```

### Option 3: Development Setup (from source)

If you're working with the AWA repository:

```bash
cd sdk/typescript
npm install
npm run build
npm link
```

This makes the `awa` command available globally during development.

---

## Quick Start

Create a simple workflow file `hello.awa.json`:

```json
{
  "id": "550e8400-e29b-41d4-a716-446655440000",
  "name": "Hello World Workflow",
  "version": "1.0.0",
  "activities": [
    {
      "id": "550e8400-e29b-41d4-a716-446655440001",
      "name": "Greet",
      "actor_type": "application",
      "role_id": "550e8400-e29b-41d4-a716-446655440003",
      "inputs": [],
      "outputs": []
    }
  ],
  "edges": [],
  "roles": [
    {
      "id": "550e8400-e29b-41d4-a716-446655440003",
      "name": "System",
      "actor_type": "application"
    }
  ],
  "contexts": []
}
```

Run it:

```bash
awa run hello.awa.json
```

---

## Commands Reference

### `awa run <file>`

Execute a workflow file.

**Options:**
- `-v, --verbose` - Enable verbose output with step-by-step execution details
- `-k, --key <key>` - Provide Gemini API key (for AI agents)

**Examples:**
```bash
# Basic execution
awa run workflow.awa.json

# With verbose output
awa run workflow.awa.json --verbose

# With API key
awa run workflow.awa.json --key YOUR_GEMINI_API_KEY
```

### `awa serve`

Start the AWA REST API server.

**Options:**
- `-p, --port <port>` - Port to listen on (default: 3000)

**Examples:**
```bash
# Start on default port (3000)
awa serve

# Start on custom port
awa serve --port 8080
```

### `awa --version`

Display the installed version.

### `awa --help`

Display help information.

---

## Examples

### Simple Workflows

#### Example 1: Single Activity

A minimal workflow with one activity:

```json
{
  "id": "a1b2c3d4-e5f6-4a5b-8c9d-0e1f2a3b4c5d",
  "name": "Single Task",
  "version": "1.0.0",
  "activities": [
    {
      "id": "act-001",
      "name": "Process Data",
      "actor_type": "application",
      "role_id": "role-001",
      "inputs": [],
      "outputs": []
    }
  ],
  "edges": [],
  "roles": [
    {
      "id": "role-001",
      "name": "Data Processor",
      "actor_type": "application"
    }
  ],
  "contexts": []
}
```

Run:
```bash
awa run single-task.awa.json
```

#### Example 2: Sequential Workflow

Two activities in sequence:

```json
{
  "id": "b2c3d4e5-f6a7-4b5c-9d0e-1f2a3b4c5d6e",
  "name": "Sequential Workflow",
  "version": "1.0.0",
  "activities": [
    {
      "id": "act-001",
      "name": "Receive Order",
      "actor_type": "application",
      "role_id": "role-001",
      "inputs": [],
      "outputs": [{"name": "order_id", "schema": {"type": "string"}}]
    },
    {
      "id": "act-002",
      "name": "Process Payment",
      "actor_type": "application",
      "role_id": "role-001",
      "inputs": [{"name": "order_id", "schema": {"type": "string"}}],
      "outputs": []
    }
  ],
  "edges": [
    {
      "id": "edge-001",
      "source_id": "act-001",
      "target_id": "act-002"
    }
  ],
  "roles": [
    {
      "id": "role-001",
      "name": "Order System",
      "actor_type": "application"
    }
  ],
  "contexts": []
}
```

Run with verbose output to see each step:
```bash
awa run sequential.awa.json --verbose
```

### Intermediate Workflows

#### Example 3: Multi-Actor Workflow

Workflow with both application and AI agents:

```json
{
  "id": "c3d4e5f6-a7b8-4c5d-0e1f-2a3b4c5d6e7f",
  "name": "Customer Support Workflow",
  "version": "1.0.0",
  "activities": [
    {
      "id": "act-001",
      "name": "Receive Customer Query",
      "actor_type": "application",
      "role_id": "role-app",
      "inputs": [],
      "outputs": [{"name": "query", "schema": {"type": "string"}}]
    },
    {
      "id": "act-002",
      "name": "Analyze Query",
      "actor_type": "ai_agent",
      "role_id": "role-ai",
      "inputs": [{"name": "query", "schema": {"type": "string"}}],
      "outputs": [{"name": "category", "schema": {"type": "string"}}]
    },
    {
      "id": "act-003",
      "name": "Send Response",
      "actor_type": "application",
      "role_id": "role-app",
      "inputs": [{"name": "category", "schema": {"type": "string"}}],
      "outputs": []
    }
  ],
  "edges": [
    {"id": "e1", "source_id": "act-001", "target_id": "act-002"},
    {"id": "e2", "source_id": "act-002", "target_id": "act-003"}
  ],
  "roles": [
    {
      "id": "role-app",
      "name": "Support System",
      "actor_type": "application"
    },
    {
      "id": "role-ai",
      "name": "AI Analyst",
      "actor_type": "ai_agent",
      "ai_model_config": {
        "model_id": "gemini-2.5-flash",
        "temperature": 0.7,
        "system_prompt": "You are a customer support analyst."
      }
    }
  ],
  "contexts": []
}
```

Run with API key:
```bash
export GEMINI_API_KEY=your_api_key_here
awa run customer-support.awa.json --verbose
```

#### Example 4: Workflow with Contexts

Using shared context between activities:

```json
{
  "id": "d4e5f6a7-b8c9-4d0e-1f2a-3b4c5d6e7f8a",
  "name": "Order Processing with Context",
  "version": "1.0.0",
  "activities": [
    {
      "id": "act-001",
      "name": "Create Order",
      "actor_type": "application",
      "role_id": "role-001",
      "inputs": [],
      "outputs": [],
      "context_bindings": [
        {
          "context_id": "ctx-order",
          "access_mode": "write"
        }
      ]
    },
    {
      "id": "act-002",
      "name": "Validate Order",
      "actor_type": "application",
      "role_id": "role-001",
      "inputs": [],
      "outputs": [],
      "context_bindings": [
        {
          "context_id": "ctx-order",
          "access_mode": "read_write"
        }
      ]
    }
  ],
  "edges": [
    {"id": "e1", "source_id": "act-001", "target_id": "act-002"}
  ],
  "contexts": [
    {
      "id": "ctx-order",
      "name": "Order Data",
      "type": "state",
      "sync_pattern": "shared_state",
      "visibility": "workflow",
      "initial_value": {}
    }
  ],
  "roles": [
    {
      "id": "role-001",
      "name": "Order System",
      "actor_type": "application"
    }
  ]
}
```

### Advanced Workflows

#### Example 5: Complex E-commerce Workflow

For a complete example, see the `examples/` folder in the repository:

```bash
# Bank account opening workflow
awa run examples/bank-account-opening/workflow.awa.json --verbose

# Insurance claim processing
awa run examples/insurance-claim/workflow.awa.json --verbose

# Skills demonstration
awa run examples/skills-demonstration/scenario.awa.json --verbose
```

---

## Troubleshooting

### Common Issues

**Error: "Invalid uuid"**
- Ensure all IDs in your workflow are valid UUIDs (format: `xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx`)
- Use online UUID generators or `uuidgen` command

**Error: "Expected array, received object"**
- Check that `inputs` and `outputs` are arrays, not objects
- Correct: `"inputs": []` or `"inputs": [{"name": "field"}]`
- Incorrect: `"inputs": {}`

**Error: "Gemini API Key required for AI Agent"**
- Set the environment variable: `export GEMINI_API_KEY=your_key`
- Or pass via CLI: `awa run workflow.awa.json --key your_key`

**Error: "filePath is required" (API)**
- Ensure you're sending proper JSON in the request body
- Check Content-Type header is set to `application/json`

### Getting Help

```bash
# View CLI help
awa --help

# View command-specific help
awa run --help
awa serve --help
```

### Environment Variables

- `GEMINI_API_KEY` - Your Gemini API key for AI agents

---

## Next Steps

- Explore the [spec](../../spec) folder for complete schema definitions
- Check out [examples](../../examples) for more workflow patterns
- Read the [Operational API Guide](./operational-api.md) for REST API details
- Visit the [AWA Documentation](../../docs) for architecture details
