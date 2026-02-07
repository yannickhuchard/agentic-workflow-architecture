---
name: agentic-workflow-architecture
description: Expert guide for working with the Agentic Workflow Architecture (AWA) framework. Use this skill when users need to create, edit, validate, execute, or visualize AI-native workflow processes using AWA's SDK (TypeScript & Python), CLI, API, or visualization tools. This skill covers workflow building with the fluent API, running workflows via CLI, triggering workflows via REST API, creating workflow JSON files, understanding AWA concepts (actors, contexts, skills, access rights, decision nodes), and rendering workflow diagrams.
Sync: Updated for Phase 3 (Python SDK Parity)
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
   - Compress the `skills/agentic-workflow-architecture` folder into a ZIP file
   - Ensure the `agentic-workflow-architecture` folder is at the root of the ZIP
   - The ZIP structure should be: `agentic-workflow-architecture/SKILL.md`

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
- Building workflows programmatically with the TypeScript or Python SDK
- Running workflows via the CLI or REST API
- Validating workflow definitions
- Visualizing workflows in 2D or 3D
- Querying workflows for analytics or access rights
- Implementing multi-actor processes (human, AI agent, robot, application)

## Core Concepts

### Actor Types

AWA supports four actor types for activities, each with runtime implementation:

| Actor Type | Description | Runtime Implementation |
|------------|-------------|------------------------|
| `human` | Human user | `HumanAgent` - Creates tasks in queue, supports pause/resume |
| `ai_agent` | AI/LLM-based agent | `AIAgent` - Uses Gemini API for intelligent processing |
| `robot` | Physical/industrial robot | `RobotAgent` - Simulation mode with action inference |
| `application` | Software application/system | `SoftwareAgent` - Executes programs and API calls |

#### Human Actor (HumanAgent)

Human activities create tasks in the `HumanTaskQueue` with:
- **Priority levels**: `critical`, `high`, `normal`, `low`
- **Lifecycle**: pending → assigned → in_progress → completed/rejected
- **Async waiting**: Engine can pause token until human completes task

#### Robot Actor (RobotAgent)

Robot activities run in **simulation mode** by default. The agent infers action types from activity names:

| Keywords | Action | Simulated Output |
|----------|--------|------------------|
| pick, grab, grasp | `pick` | gripper_state: closed |
| place, drop, release | `place` | gripper_state: open |
| move, transport | `move` | current_position: {x,y,z} |
| scan, read, identify | `scan` | barcode: SIM-... |
| assemble, attach | `assemble` | quality_check: passed |

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

- `.build()` - Return the complete workflow object

## Using the Python SDK

### Installation

```bash
# Project installation
pip install awa

# With optional dependencies
pip install "awa[ai,web,dev]"
```

### Building Workflows Programmatically

```python
from awa import workflow, ActorType, SyncPattern

result = (
    workflow("Order Processing", "1.0.0")
    .description("AI-assisted order fulfillment")
    .context("order_data", 
        type="data", 
        sync_pattern=SyncPattern.shared_state
    )
    .activity("Receive Order",
        role_id="customer-service-agent",
        actor_type=ActorType.ai_agent
    )
    .edge("Receive Order", "Process Order")
    .build()
)
```

### Key Builder Methods

The Python SDK follows the same fluent API pattern as the TypeScript SDK:
- `.description(text)`
- `.context(name, **kwargs)`
- `.activity(name, **kwargs)`
- `.edge(source, target, **kwargs)`
- `.build()`

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
| `awa serve` | Start REST API server | `-p, --port <port>`, `--jwt-secret <secret>`, `--api-key <key:role>`, `--rate-limit <max>`, `--no-auth` |
| `awa --version` | Display version | - |
| `awa --help` | Display help | - |

**Serve Command Examples:**
```bash
# Basic (no auth)
awa serve --port 8080

# With JWT authentication
awa serve --jwt-secret my-secret-key

# With API keys
awa serve --api-key abc123:admin --api-key xyz789:user

# With rate limiting (100 req/min)
awa serve --rate-limit 100
```


## Runtime Execution

The `WorkflowEngine` executes workflow definitions with full actor and decision support.

### Basic Usage

```typescript
import { WorkflowEngine } from '@awa/sdk';

const engine = new WorkflowEngine(workflow, {
  gemini_api_key: 'your-api-key',  // Required for AI agents
  verbose: true,                    // Enable execution logging
  wait_for_human_tasks: false       // Don't block on human tasks
});

// Start workflow with initial data
const tokenId = await engine.start({ orderId: 'ORD-123' });

// Run to completion
const status = await engine.run();
console.log('Final status:', status);

// Get token data
const tokens = engine.getTokens();
console.log('Results:', tokens[0].contextData);
```

### Engine Options

| Option | Type | Description |
|--------|------|-------------|
| `gemini_api_key` | string | API key for AI agent execution |
| `roles` | Role[] | Role definitions with AI model configs |
| `robot_config` | RobotConfig | Robot connection settings |
| `human_task_queue` | HumanTaskQueue | Custom task queue instance |
| `wait_for_human_tasks` | boolean | Block until human tasks complete |
| `verbose` | boolean | Enable detailed logging |

### Engine Statuses

| Status | Description |
|--------|-------------|
| `idle` | Engine created, not started |
| `running` | Actively processing tokens |
| `waiting_human` | Paused, waiting for human task |
| `completed` | All tokens finished |
| `failed` | Token encountered error |
| `paused` | Manually paused |

### Human Task Management

```typescript
// Get the task queue
const queue = engine.getHumanTaskQueue();

// List pending tasks for a role
const tasks = queue.get_pending_by_role(roleId);

// Complete a task
queue.complete(taskId, { approved: true, notes: 'Looks good' });

// Resume paused token after human action
engine.resumeToken(tokenId, { approved: true });
```

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

### Human Tasks API

Manage human-in-the-loop tasks via REST:

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/v1/tasks` | GET | List all tasks (filter by `role_id`, `assignee`) |
| `/api/v1/tasks/pending` | GET | Pending tasks (filter by `role_id`) |
| `/api/v1/tasks/:id` | GET | Get specific task |
| `/api/v1/tasks/:id/assign` | POST | Assign task to user (`user_id` in body) |
| `/api/v1/tasks/:id/complete` | POST | Complete task (`result` in body) |
| `/api/v1/tasks/:id/reject` | POST | Reject task (`reason` in body) |
| `/api/v1/tasks/queue/stats` | GET | Queue statistics |

**Example - Complete Human Task:**
```bash
curl -X POST http://localhost:3000/api/v1/tasks/task-uuid/complete \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer your-jwt-token" \
  -d '{ "result": { "approved": true, "notes": "Looks good" } }'
```

## Production Infrastructure

### Structured Logging

AWA provides JSON-structured logging with correlation IDs for distributed tracing:

```typescript
import { get_logger, Logger } from '@awa/sdk';

// Get global logger
const logger = get_logger();

// Set correlation ID for request tracing
logger.set_correlation_id('req-123');

// Create child logger with additional context
const child = logger.child({ workflow_id: 'wf-1', activity: 'Process Order' });
child.info('Processing started', { step: 1 });

// Output (JSON format):
// {"level":"info","message":"Processing started","step":1,"workflow_id":"wf-1","correlation_id":"req-123","timestamp":"..."}
```

**Environment Variables:**
| Variable | Default | Description |
|----------|---------|-------------|
| `LOG_LEVEL` | `info` | Minimum level: debug, info, warn, error |
| `LOG_FORMAT` | `json` | Output: `json` or `text` |
| `LOG_TIMESTAMPS` | `true` | Include ISO timestamps |

### API Authentication

AWA supports JWT tokens and API keys with RBAC:

```typescript
import { createServer, create_jwt } from '@awa/sdk';

const app = createServer({
  auth: {
    enabled: true,
    jwt_secret: process.env.JWT_SECRET,
    api_keys: {
      'api-key-123': { id: 'user-1', role: 'admin', permissions: ['*'] },
      'readonly-key': { id: 'user-2', role: 'viewer', permissions: ['workflows:read'] }
    },
    public_paths: ['/health']
  },
  rate_limit: {
    window_ms: 60000,   // 1 minute
    max_requests: 100
  }
});

// Create JWT token
const token = create_jwt({ sub: 'user-id', role: 'admin', permissions: ['*'] }, secret);
```

**Using Authentication in Requests:**
```bash
# JWT Bearer Token
curl -H "Authorization: Bearer eyJhbGciOiJI..." http://localhost:3000/api/v1/workflows

# API Key
curl -H "X-API-Key: api-key-123" http://localhost:3000/api/v1/workflows
```

**RBAC Middleware:**
```typescript
import { require_role, require_permission } from '@awa/sdk';

// Require specific role
app.use('/admin', require_role('admin'));

// Require specific permissions
app.use('/workflows', require_permission('workflows:read', 'workflows:write'));
```

### Error Recovery with Retry

Automatic retry with exponential backoff for transient failures:

```typescript
import { with_retry, DeadLetterQueue } from '@awa/sdk';

// Wrap risky operations
const result = await with_retry(
  () => callExternalAPI(),
  {
    max_retries: 3,
    initial_delay_ms: 1000,
    max_delay_ms: 30000,
    backoff_multiplier: 2,
    jitter: true  // Prevents thundering herd
  }
);

// Non-retryable errors (automatically detected):
// - Validation errors
// - Authentication failures
// - Invalid input/configuration
```

**Dead Letter Queue for Failed Tokens:**
```typescript
const dlq = new DeadLetterQueue();

// Add failed token
dlq.add(token, workflowId, activityId, error, { attempt: 3, started_at: Date.now() });

// Query failed tokens
const failedTokens = dlq.list_by_workflow('wf-123');
const stats = dlq.stats();  // { total, by_workflow, by_activity }
```

### State Persistence

Checkpoint workflow state for resume after failures:

```typescript
import { CheckpointManager, FilePersistenceAdapter, InMemoryPersistenceAdapter } from '@awa/sdk';

// Create checkpoint manager (file-based for production)
const manager = new CheckpointManager(
  new FilePersistenceAdapter('./checkpoints')
);

// Create checkpoint
await manager.checkpoint(workflow, 'running', tokens, contexts);

// Resume from checkpoint
const state = await manager.load('workflow-id');
const restoredTokens = manager.restore_tokens(state);

// Auto-checkpoint every 30 seconds
manager.enable_auto_checkpoint(30000, async () => ({
  workflow, engine_status, tokens, contexts
}));
```

**Persistence Adapters:**
| Adapter | Use Case |
|---------|----------|
| `InMemoryPersistenceAdapter` | Development, testing |
| `FilePersistenceAdapter` | Single-server production |
| Custom adapter | Cloud storage (implement `PersistenceAdapter` interface) |

### Value Stream Mapping (VSM) & Analytics

AWA provides built-in tracking for Lean optimization and Value Stream Mapping:

| Metric | Description | Automatic Tracking |
|--------|-------------|--------------------|
| `process_time` | Time spent executing the activity | Yes (all actors) |
| `wait_time` | Time spent waiting for human/external action | Yes (Human task pause/resume) |
| `lead_time` | Total elapsed time for the step (process + wait) | Yes |
| `value_added` | Whether the step adds value for the customer | From activity definition |
| `waste_categories` | Identified DOWNTIME waste (Waiting, Defects) | Yes (Automatic detection) |

#### Waste Category Detection (DOWNTIME)

The engine automatically tags waste in the token history:
- **`waiting`**: Added when a token enters `waiting` status (e.g., human-in-the-loop).
- **`defects`**: Added when an activity fails or throws an exception.

#### Accessing Analytics

Analytics are stored in the token's history for each step transition:

```typescript
const tokens = engine.getTokens();
const history = tokens[0].history;
const lastStep = history.find(h => h.action === 'exited');
console.log('Waste detected:', lastStep.analytics.waste_categories);
```

---

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

Decision nodes enable conditional routing using DMN-inspired decision tables with **FEEL expression support**.

#### FEEL Expression Syntax

The runtime `DecisionEvaluator` supports:

| Expression | Example | Description |
|------------|---------|-------------|
| Wildcard | `-`, `*` | Matches anything |
| Comparison | `>=80`, `<100`, `!=0` | Numeric comparisons |
| Range (inclusive) | `[50..70]` | Value between 50 and 70 |
| Range (exclusive) | `(0..100)` | Value between 0 and 100 (exclusive) |
| List membership | `in("a","b","c")` | Value in list |
| Not in list | `not in("x","y")` | Value not in list |
| String literal | `"approved"` | Exact string match |
| Boolean | `true`, `false` | Boolean literals |
| Null check | `null`, `not null` | Null/undefined check |
| Contains | `contains("substr")` | String contains |

#### Hit Policies

All 6 DMN hit policies are implemented:

| Policy | Behavior |
|--------|----------|
| `unique` | Only one rule can match |
| `first` | Return first matching rule |
| `priority` | Rules sorted by priority |
| `any` | All matches must have same output |
| `collect` | Collect all matching outputs |
| `rule_order` | Return in rule definition order |

#### Decision Table Example

```json
{
  "decision_nodes": [
    {
      "id": "uuid-decision",
      "name": "Credit Approval Decision",
      "decision_table": {
        "hit_policy": "first",
        "inputs": [
          { "name": "credit_score", "type": "number" },
          { "name": "income", "type": "number" }
        ],
        "outputs": [
          { "name": "decision", "type": "string" }
        ],
        "rules": [
          {
            "input_entries": [">=700", ">=50000"],
            "output_entries": ["approved"],
            "output_edge_id": "uuid-edge-approved"
          },
          {
            "input_entries": [">=600", ">=75000"],
            "output_entries": ["approved"],
            "output_edge_id": "uuid-edge-approved"
          },
          {
            "input_entries": ["-", "-"],
            "output_entries": ["manual_review"],
            "output_edge_id": "uuid-edge-review"
          }
        ]
      },
      "default_output_edge_id": "uuid-edge-rejected"
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
