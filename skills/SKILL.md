---
name: agentic-workflow-architecture
description: Expert guide for working with the Agentic Workflow Architecture (AWA) framework. Use this skill when users need to create, edit, validate, execute, or visualize AI-native workflow processes using AWA's SDK, CLI, API, or visualization tools. This skill covers workflow building with the fluent TypeScript API, running workflows via CLI, triggering workflows via REST API, creating workflow JSON files, understanding AWA concepts (actors, contexts, skills, access rights, decision nodes), and rendering workflow diagrams.
---

# Agentic Workflow Architecture (AWA) Skill

AWA is a next-generation business process specification designed for AI-native workflows. It extends BPMN/BPEL/DMN concepts with first-class support for AI agents, multi-agent collaboration, queryable architecture, and value stream analytics.

## Installing This Skill

This skill can be installed in various AI-powered development environments:

### Claude Code (Web Interface)

1. **Enable Skills Feature:**
   - Navigate to **Settings** in your Claude.ai account
   - Go to **Capabilities** section
   - Enable "Code execution and file creation"
   - Toggle on **Skills** (Team/Enterprise plans require admin enablement)

2. **Package the Skill:**
   - Compress the `skills` folder into a ZIP file
   - Ensure the skill folder is at the root of the ZIP (not in a subfolder)
   - The ZIP should contain `SKILL.md` at the root level

3. **Upload the Skill:**
   - Return to **Settings** > **Capabilities**
   - In the **Skills** section, click **Upload skill**
   - Drag and drop your ZIP file or browse to select it
   - Claude will validate and install the skill

4. **Activate:**
   - Toggle the skill on in your skills list
   - The skill will now be available for use

### Claude Code (CLI Tool)

For developers using Claude Code CLI:

**Personal Skills (Global):**
```bash
# Copy skill to personal skills directory
cp -r skills/agentic-workflow-architecture ~/.claude/skills/
```

**Project Skills (Version Controlled):**
```bash
# Copy skill to project directory
mkdir -p .claude/skills
cp -r skills/agentic-workflow-architecture .claude/skills/
```

**Reload Skills:**
```bash
# After adding skills, reload them
/reload-skills
```

### Cursor AI

1. **Project-Level Installation:**
   ```bash
   # Create Cursor skills directory
   mkdir -p .cursor/skills
   
   # Copy the AWA skill
   cp -r skills/agentic-workflow-architecture .cursor/skills/
   ```

2. **Global Installation:**
   ```bash
   # Copy to global Cursor skills directory
   mkdir -p ~/.cursor/skills
   cp -r skills/agentic-workflow-architecture ~/.cursor/skills/
   ```

3. **Using .cursorrules (Alternative):**
   - Create `.cursorrules` file in project root
   - Add project-specific AWA rules and context

4. **Import from GitHub:**
   - Open Cursor Settings
   - Navigate to **Rules** > **Project Rules**
   - Click **Add Rule** > **Remote Rule (Github)**
   - Enter the GitHub repository URL for this skill

5. **Manual Invocation:**
   - Type `/` in Agent chat
   - Search for "agentic-workflow-architecture"
   - Select the skill to invoke it

### Google Antigravity

1. **Install via Terminal:**
   ```bash
   # If the skill is available on GitHub, use the install command
   # (Replace with actual GitHub URL when available)
   # Paste the command in Antigravity terminal
   ```

2. **Manual Installation:**
   
   **Global Skills:**
   ```bash
   # Copy to global skills directory
   mkdir -p ~/.antigravity/skills
   cp -r skills/agentic-workflow-architecture ~/.antigravity/skills/
   ```
   
   **Workspace Skills (Project-Specific):**
   ```bash
   # Copy to workspace skills directory
   mkdir -p .antigravity/skills
   cp -r skills/agentic-workflow-architecture .antigravity/skills/
   ```

3. **Invoke the Skill:**
   - In the Antigravity chat interface, type `@agentic-workflow-architecture`
   - The AI agent will load the skill and become an AWA expert

### Verification

After installation, verify the skill is working by asking the AI:
- "How do I create an AWA workflow using the TypeScript SDK?"
- "What are the four actor types in AWA?"
- "How do I run an AWA workflow using the CLI?"

The AI should respond with detailed, AWA-specific guidance.

## When to Use This Skill

Use this skill when working with:
- Creating or modifying agentic workflows
- Building workflows programmatically with the TypeScript SDK
- Running workflows via the CLI or REST API
- Validating workflow definitions
- Visualizing workflows in 2D or 3D
- Querying workflows for analytics or access rights
- Implementing multi-actor processes (human, AI agent, robot, application)

## Core Concepts

### Actor Types

AWA supports four actor types for activities:

| Actor Type | Description | Use Case |
|------------|-------------|----------|
| `human` | Human user | Manual tasks, approvals, quality inspection |
| `ai_agent` | AI/LLM-based agent | Credit analysis, route optimization, content generation |
| `robot` | Physical/industrial robot | Warehouse picking, assembly, physical automation |
| `application` | Software application/system | API calls, database operations, system integration |

### Skills

Skills define competency and capability requirements for actors:

| Skill Type | Description | Example |
|------------|-------------|---------|
| `ai_context` | Domain knowledge/system instruction for AI | "Financial Risk Assessment" |
| `tool_proficiency` | Capability to use specific tools (MCP, API) | "Credit Bureau API" |
| `human_competency` | Qualification, authority, certification | "Loan Approval Authority Level 2" |

### Context Sync Patterns

Contexts enable multi-agent collaboration:

| Pattern | Description | Use Case |
|---------|-------------|----------|
| `shared_state` | Direct read/write to shared mutable state | Order data shared across activities |
| `message_passing` | Agents send messages through context | Event-driven communication |
| `blackboard` | Classic AI blackboard architecture | Multi-agent problem solving |
| `event_sourcing` | Immutable event log pattern | Audit trails, event replay |

### Access Modes

| Mode | Description |
|------|-------------|
| `read` | Read-only access |
| `write` | Write-only access |
| `read_write` | Full access |
| `subscribe` | Event subscription |
| `publish` | Event publishing |

## Using the TypeScript SDK

### Installation

```bash
# Global installation (recommended for CLI)
npm install -g @awa/sdk

# Project installation
npm install @awa/sdk
```

### Building Workflows Programmatically

```typescript
import { workflow } from '@awa/sdk';

const orderProcess = workflow('Order Processing', '1.0.0')
  .description('AI-assisted order fulfillment')
  .context('order_data', { 
    type: 'data', 
    sync_pattern: 'shared_state' 
  })
  .activity('Receive Order', {
    role_id: 'customer-service-agent',
    actor_type: 'ai_agent',
    contexts: [{ id: 'order_data', access_mode: 'write' }]
  })
  .activity('Validate Order', {
    role_id: 'validation-agent', 
    actor_type: 'ai_agent',
    contexts: [{ id: 'order_data', access_mode: 'read' }]
  })
  .edge('Receive Order', 'Validate Order')
  .build();
```

### Key Builder Methods

- `.description(text)` - Set workflow description
- `.context(name, config)` - Add shared context for collaboration
- `.activity(name, config)` - Add activity with actor type and role
- `.edge(source, target, options?)` - Connect activities
- `.sla(config)` - Set service level agreement
- `.analytics(config)` - Add value stream metrics
- `.metadata(key, value)` - Add extensible metadata
- `.build()` - Return the complete workflow object

## Using the CLI

### Running Workflows

```bash
# Basic execution
awa run workflow.awa.json

# With verbose output (shows step-by-step execution)
awa run workflow.awa.json --verbose

# With API key for AI agents
awa run workflow.awa.json --key YOUR_GEMINI_API_KEY

# Or use environment variable
export GEMINI_API_KEY=your_api_key
awa run workflow.awa.json --verbose
```

### Starting the API Server

```bash
# Default port (3000)
awa serve

# Custom port
awa serve --port 8080
```

### CLI Commands Reference

| Command | Description | Options |
|---------|-------------|---------|
| `awa run <file>` | Execute a workflow file | `-v, --verbose`, `-k, --key <key>` |
| `awa serve` | Start REST API server | `-p, --port <port>` |
| `awa --version` | Display version | - |
| `awa --help` | Display help | - |

## Using the REST API

### Trigger Workflow Execution

```bash
curl -X POST http://localhost:3000/api/v1/workflows/run \
  -H "Content-Type: application/json" \
  -d '{
    "filePath": "./workflow.awa.json",
    "apiKey": "optional-gemini-api-key"
  }'
```

**Response:**
```json
{
  "runId": "uuid-...",
  "status": "running",
  "message": "Workflow started"
}
```

## Creating Workflow JSON Files

### Minimal Workflow Structure

```json
{
  "id": "550e8400-e29b-41d4-a716-446655440000",
  "name": "Workflow Name",
  "version": "1.0.0",
  "activities": [
    {
      "id": "550e8400-e29b-41d4-a716-446655440001",
      "name": "Activity Name",
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
      "name": "Role Name",
      "actor_type": "application"
    }
  ],
  "contexts": []
}
```

### Important Rules

1. **All IDs must be valid UUIDs** (format: `xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx`)
2. **inputs and outputs must be arrays**, not objects
3. **Edges connect activities** via `source_id` and `target_id`
4. **Roles define actor capabilities** and must match `actor_type`

### Activity with Skills and Tools

```json
{
  "id": "uuid-activity",
  "name": "Analyze Credit Risk",
  "role_id": "uuid-role",
  "actor_type": "ai_agent",
  "description": "AI agent analyzes risk using domain context and specific API tools",
  "skills": [
    {
      "id": "uuid-skill",
      "name": "Financial Risk Assessment",
      "type": "ai_context",
      "description": "Knowledge of financial statement analysis and credit scoring models",
      "reference": "https://skills.awa.io/ai/finance/risk-assessment"
    }
  ],
  "tool_requirements": [
    {
      "id": "uuid-tool",
      "name": "Credit Bureau API",
      "type": "rest_api",
      "description": "Interface for fetching live credit reports",
      "reference": "https://api.awa.io/docs/credit-bureau"
    }
  ]
}
```

### Decision Nodes

Decision nodes enable conditional routing:

```json
{
  "decision_nodes": [
    {
      "id": "uuid-decision",
      "name": "Credit Approval Decision",
      "decision_logic": {
        "hit_policy": "first",
        "rules": [
          {
            "id": "uuid-rule-1",
            "conditions": [
              {
                "input_expression": "credit_approved",
                "operator": "equals",
                "value": true
              },
              {
                "input_expression": "risk_score",
                "operator": "less_than",
                "value": 30
              }
            ],
            "output": "approved"
          }
        ]
      }
    }
  ]
}
```

## Visualization

AWA includes optional 2D and 3D visualization capabilities.

### 2D Visualization (ReactFlow)

Supports auto-layout algorithms:
- **Dagre** - Hierarchical layout
- **ELK** - Eclipse Layout Kernel

### 3D Visualization (Babylon.js)

For immersive workflow views with spatial positioning.

### Visualization Features

- **Swim Lanes** - Organize activities by role or organization
- **Auto-Layout** - Automatic graph layout with configurable algorithms
- **Alternate Views** - Multiple visualization configurations per workflow
- **Animation** - Animated edge flow and execution path highlighting

### Example Visualization Config

```json
{
  "visualization": {
    "id": "viz-001",
    "workflow_id": "workflow-001",
    "view_type": "2d",
    "engine": "reactflow",
    "auto_layout": {
      "algorithm": "dagre",
      "direction": "lr",
      "node_spacing": 50,
      "rank_spacing": 100
    },
    "animation": {
      "enabled": true,
      "edge_flow_enabled": true,
      "highlight_active_path": true
    }
  }
}
```

## Specification Formats

AWA workflows can be serialized to multiple formats:

| Format | Location | Use Case |
|--------|----------|----------|
| JSON Schema | `spec/json-schema/` | Schema validation |
| Avro | `spec/avro/` | Event streaming (Kafka) |
| OpenAPI 3.1 | `spec/openapi/` | REST API specification |
| GraphQL | `spec/graphql/` | Graph query API |
| PostgreSQL DDL | `spec/ddl/` | Database persistence |

## Common Patterns

### Multi-Actor Workflow

Combine different actor types for optimal task assignment:

```typescript
workflow('Customer Support', '1.0.0')
  .activity('Receive Query', {
    actor_type: 'application',
    role_id: 'support-system'
  })
  .activity('Analyze Query', {
    actor_type: 'ai_agent',
    role_id: 'ai-analyst'
  })
  .activity('Quality Check', {
    actor_type: 'human',
    role_id: 'supervisor'
  })
  .edge('Receive Query', 'Analyze Query')
  .edge('Analyze Query', 'Quality Check')
  .build();
```

### Shared Context Pattern

Enable data sharing across activities:

```typescript
workflow('Order Processing', '1.0.0')
  .context('order_data', {
    type: 'data',
    sync_pattern: 'shared_state',
    visibility: 'workflow'
  })
  .activity('Create Order', {
    actor_type: 'application',
    role_id: 'order-system',
    contexts: [{ id: 'order_data', access_mode: 'write' }]
  })
  .activity('Validate Order', {
    actor_type: 'ai_agent',
    role_id: 'validator',
    contexts: [{ id: 'order_data', access_mode: 'read_write' }]
  })
  .build();
```

## Troubleshooting

### Common Errors

**"Invalid uuid"**
- Ensure all IDs are valid UUIDs
- Use online UUID generators or `uuidgen` command

**"Expected array, received object"**
- Check that `inputs` and `outputs` are arrays: `[]` not `{}`

**"Gemini API Key required for AI Agent"**
- Set environment variable: `export GEMINI_API_KEY=your_key`
- Or pass via CLI: `awa run workflow.awa.json --key your_key`

**"filePath is required" (API)**
- Ensure JSON body includes `filePath` field
- Check `Content-Type: application/json` header is set

## Value Stream Analytics

AWA includes built-in analytics for process optimization:

### Metrics

- `process_time` - Time spent actively working
- `cycle_time` - Total time from start to finish
- `lead_time` - Time from request to delivery
- `wait_time` - Time spent waiting
- `value_added` - Is this activity value-added?
- `process_cycle_efficiency` - % of value-added time

### DOWNTIME Waste Categories

- `defects` - Errors requiring rework
- `overproduction` - Producing more than needed
- `waiting` - Idle time
- `non_utilized_talent` - Underutilized skills
- `transport` - Unnecessary movement
- `inventory` - Excess inventory
- `motion` - Unnecessary actions
- `extra_processing` - Over-processing

## Examples

AWA includes comprehensive examples in the `examples/` directory:

- **order-processing** - AI-assisted order fulfillment
- **insurance-claims-management** - 95% automated claims workflow
- **retail-distribution** - 12-activity order fulfillment with decision nodes
- **customer-support-ai** - Multi-actor customer support
- **skills-demonstration** - Skills and tool requirements example
- **bank-account-opening** - Sequential workflow with multiple actors

Run examples:
```bash
awa run examples/retail-distribution/workflow.awa.json --verbose
awa run examples/skills-demonstration/scenario.awa.json --verbose
```

## Best Practices

1. **Use descriptive names** for activities, contexts, and roles
2. **Assign appropriate actor types** based on task nature
3. **Define skills explicitly** for AI agents and humans
4. **Use shared contexts** for multi-agent collaboration
5. **Add SLAs** for time-sensitive activities
6. **Include analytics** for process optimization
7. **Validate workflows** before deployment
8. **Use decision nodes** for business rule routing
9. **Document tool requirements** for external dependencies
10. **Version workflows** using semantic versioning

## AI Model Configuration

When using AI agents, configure the model in the role definition:

```json
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
```

## References

- **Main README**: `README.md` - Quick start and overview
- **CLI Guide**: `sdk/typescript/docs/cli-guide.md` - Complete CLI documentation
- **API Guide**: `sdk/typescript/docs/operational-api.md` - REST API reference
- **Specification**: `docs/specification.md` - Full AWA specification
- **Examples**: `examples/` - Working workflow examples
- **Schemas**: `spec/json-schema/` - JSON Schema definitions
