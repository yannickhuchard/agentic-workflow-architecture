---
name: agentic-workflow-architecture
description: Expert guide for working with the Agentic Workflow Architecture (AWA) framework. Use this skill when users need to create, edit, validate, execute, or visualize AI-native workflow processes using AWA's SDK (TypeScript & Python), CLI, API, or visualization tools. This skill covers workflow building with the fluent API, running workflows via CLI, triggering workflows via REST API, creating workflow JSON files, understanding AWA concepts (actors, contexts, skills, access rights, decision nodes), and rendering workflow diagrams.
Sync: Updated for AWA 1.1 (normative specification, outcome contracts, model routing, tools with MCP and gRPC, agents over A2A, identity and authorization, guardrails, journal, knowledge)
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

## AWA 1.1: what the engine requires

AWA 1.1 has a normative specification (`docs/specification.md`) and a conformance suite (`spec/conformance`). The engine is stricter than 1.0. A workflow written to the rules below runs; one that ignores them fails on purpose instead of guessing. The TypeScript SDK implements everything in this section. The Python SDK implements routing, decision tables and validation; the rest is TypeScript only.

### Rules that make a workflow fail if you break them

1. **Give every choice a way out.** If a node's outgoing edges all have conditions and none is true, the token fails with `NO_ROUTE`. Add an edge with `"is_default": true`, usually to an end event:

   ```json
   "edges": [
     { "id": "…", "source_id": "<analyze>", "target_id": "<review>", "condition": "sentiment_score < 0.3" },
     { "id": "…", "source_id": "<analyze>", "target_id": "<done>", "is_default": true }
   ],
   "events": [ { "id": "<done>", "name": "No action needed", "event_type": "end" } ]
   ```

2. **Several edges without conditions from one node are a parallel split**, not a list of alternatives. Use conditions (plus a default) for a choice. To bring parallel branches back together, set `"join": "all"` on the activity where they meet.
3. **Conditions use one expression language**: `path op literal` with `== != > >= < <=`, combined with `&&`, `||`, `!` and parentheses, plus `path exists` and `typeof path == type`. Paths may be dotted (`order.total`). An invalid condition is rejected when the workflow loads.
4. **A failed token fails the run.** Do not expect `completed` when an activity raised.
5. **Verification fails closed.** An output that was not verified as `pass` is rejected. A `schema_only` criterion needs an `expression`.
6. **Decision tables are strict.** With hit policy `unique` or `any`, overlapping rules that disagree fail the token (`DECISION_CONFLICT`). Each rule needs exactly one entry per input column. Use `first` when order should decide.
7. **Simulated activities return no business data.** A workflow whose routing depends on data needs `awa run --simulate --outputs simulation.json`, where the file gives what each activity returns by name.

### Outcome contracts: fix the result, leave the strategy free

Put what must be true of an AI agent's result on the activity. The engine checks it deterministically, re-runs the agent with the violated terms as feedback, and can hand over to a person.

```json
"outcome_contract": {
  "output_schema": { "type": "object", "required": ["estimated_cost"], "properties": { "estimated_cost": { "type": "number", "minimum": 0 } } },
  "postconditions": [ { "name": "Within authority", "expression": "estimated_cost <= 50000" } ],
  "budgets": { "max_attempts": 3, "max_duration": "PT30S", "max_tokens": 20000, "max_tool_calls": 8 },
  "on_violation": "escalate_human"
}
```

Other per-activity settings: `retry` (`max_attempts`, `initial_delay`, `backoff_multiplier`), `compensation` (`{ "activity_id": … }`, an activity with no incoming edge that undoes this one if the run later fails), `join`.

### Roles and models

Define roles in the workflow (`"roles": [...]`) and name models by capability tier, not by vendor:

```json
{ "id": "…", "name": "Damage assessor", "actor_type": "ai_agent", "ai_model_config": { "model_id": "tier:reasoning", "temperature": 0.2 } }
```

Tiers are `tier:reasoning`, `tier:balanced`, `tier:fast`. The deployment maps them: `awa run workflow.awa.json --providers google,openai,ollama,embedded` (each tier falls back down the list). `embedded` runs a small open-source model in-process; it follows formats but judges poorly, so keep it last (`docs/embedded-models.md`).

### Decisions

A decision node is decided by a table, by an external rule engine, or by a model, and a model may back up the first two.

- **Table entries**: `-` (any), `> 100`, `[50..70)`, `"FR", "DE"` (any of), `not(< 18, > 99)`, `in("a", "b")`, `null`, `contains("x")`. Outputs become token data, so a later condition or decision can use them.
- **Model decision**: the model must choose one of the options you list. With a table present, the model is asked only when no rule matches.

```json
"decision_model": {
  "model": "tier:fast",
  "instructions": "Prefer review when the cost is high or the fraud score is middling.",
  "options": [
    { "id": "auto", "description": "Routine, pay without review", "output_edge_id": "<edge to Reserve funds>" },
    { "id": "review", "description": "An adjuster should look first", "output_edge_id": "<edge to Adjuster review>" }
  ],
  "inputs": ["fraud_score", "estimated_cost"],
  "min_confidence": 0.6
}
```

Always give such a node a `default_output_edge_id` that leads to a person: it is taken when the model gives no valid decision.

### Tools

Declare what an agent may call on the activity. Every call is journalled with the time, arguments, result and a link to what ran.

```json
"tools": [ {
  "name": "price_part",
  "description": "Price of a replacement part from the repair catalogue.",
  "parameters": { "type": "object", "required": ["part"], "properties": { "part": { "type": "string" } } },
  "binding": { "kind": "http", "method": "GET", "url": "https://catalogue.example/v2/parts/{part}/price", "headers": { "authorization": "Bearer {{secret:CATALOGUE_KEY}}" } }
} ]
```

Binding kinds: `http`, `command` (needs `--allow-commands`), `jsonrpc`, `function`, `mcp` and `grpc`. An `mcp` binding (`{ "kind": "mcp", "server": "docs", "tool": "search" }`) names a server the deployment declares in its deployment file (`awa run --deployment deployment.json`, under `tools.mcp_servers`): a program, which also needs `allow_commands`, or a Streamable HTTP address. A `grpc` binding makes one unary call, described by the deployment's `.proto` files or by server reflection, over TLS unless the deployment allows plaintext for the host.

### Agents over A2A

An activity can be performed by an agent reached over the Agent2Agent protocol 1.0. Name its agent card on the role or the activity:

```json
{ "id": "…", "name": "Fraud screen", "actor_type": "ai_agent", "a2a": { "agent_card": "https://fraud.example/.well-known/agent-card.json" } }
```

The agent gets the activity and its data as a message; its artifacts become the output, held to the outcome contract and verification like any actor's. If the agent asks for input, the run waits (`waiting_human`) until the host answers with `answerAgent` (`answer_agent` in Python). Agents are held to the deployment's allowed hosts; in simulation nothing is called. `awa serve --a2a workflow.awa.json` offers a workflow to other agents, with its card at `/.well-known/agent-card.json`.

### Who may do what (identity and authorization)

Roles in the document say what kind of actor performs an activity; the deployment says who, and whether they may (specification section 30). Put the policy in the deployment file, never in the workflow document:

```json
{ "authorization": {
    "principals": [{ "id": "agent:assessor", "kind": "ai_agent", "attributes": { "roles": ["underwriter"] }, "acts_for": { "roles": ["Underwriter"] } }],
    "policy": {
      "rules": [{ "id": "underwriters", "effect": "allow", "actions": ["perform_activity", "call_tool"], "subject": { "roles": ["underwriter"] } },
                { "id": "managers", "effect": "allow", "actions": ["start_run", "complete_task", "approve"], "subject": { "roles": ["manager"] }, "condition": "run.amount < 50000" }],
      "separation_of_duties": [{ "id": "maker-checker", "activities": ["Submit", "Approve"] }],
      "four_eyes": [{ "id": "two-approvers", "activities": ["Approve"], "approvals": 2 }] } } }
```

Under a policy what no rule allows is denied, and a denial wins over an allow. Actions: `start_run`, `perform_activity`, `reach_agent`, `call_tool`, `claim_task`, `assign_task`, `complete_task`, `approve`, `answer_agent`, `publish_event`, `read_journal`, `cancel_run`, `migrate_run`. A refusal fails with `FORBIDDEN` (a refused tool call is returned to the agent; a refused answer leaves the task waiting) and is journalled as `authorization.decided`; `run.started`, `activity.started`, `activity.completed` and `token.resumed` name their `principal`. People come from the request (JWT claims, API keys); runs started without a principal are started by the host (`{"id": "host", "kind": "service"}`), which a policy must allow too. `awa run --deployment d.json --as alice`, `awa serve --deployment d.json`, `awa task complete <id> --deployment d.json --as bob`. An external policy engine plugs in as `authorization.decider` in code.

### Guardrails

Put guardrails on what goes into and comes out of agents and tools (specification section 31). Declare them in `guardrails` on the workflow, a role, an activity or a tool; a deployment adds its own (`guardrails` in the deployment file), which run first and cannot be removed by a document.

```json
"guardrails": [
  { "id": "…", "name": "No personal data out", "stages": ["output", "tool_call"], "check": { "kind": "personal_data" }, "action": "redact" },
  { "id": "…", "name": "Injection in data", "stages": ["input"], "check": { "kind": "prompt_injection" }, "action": "block" },
  { "id": "…", "name": "Known decisions", "stages": ["output"], "check": { "kind": "allowed_values", "path": "decision", "values": ["approve", "refer"] }, "action": "retry_with_feedback" }
]
```

Stages: `input` (what the actor is given), `output` (before the outcome contract and verification), `tool_call`, `tool_result`. Checks: `personal_data`, `deny_list`, `prompt_injection`, `size`, `json_schema`, `allowed_values`, `topic` (condition expressions), `model` (a guard model; the engine default unless a reference is named) and `classifier` (registered by the deployment). Actions: `block` (`GUARDRAIL_BLOCKED`), `redact`, `retry_with_feedback` (output only), `escalate` (to a person; input and output) and `warn`; a guardrail on a tool takes only `tool_call` and `tool_result`. The journal records `guardrail.triggered` with positions and categories, never the matched text. Pattern lists are a floor, not a defence: bound what an agent can do with tools, permissions and contracts.

### After a run: journal, recipe, replay, knowledge

```bash
awa run workflow.awa.json --journal run.journal.jsonl
awa recipe workflow.awa.json run.journal.jsonl -o RECIPE.md
awa knowledge ingest workflow.awa.json run.journal.jsonl
awa knowledge review all --by <name>
awa knowledge export knowledge/
```

- The **journal** records every step at three levels: what happened, the agent's reported reasoning, and the engine's own decisions.
- The **recipe** explains how to rebuild the workflow from scratch and what the run did.
- **Replay**: open `tools/visualization/replay.html` and drop the workflow and journal on it.
- **Knowledge** is distilled from journals, accumulates across runs, reaches agents only after a person reviews it (the activity opts in with `"knowledge": {}`), and exports as an Open Knowledge Format bundle.

A complete worked example is `examples/claims-settlement`.

### BPMN, DMN and Serverless Workflow

```bash
awa import bpmn process.bpmn --dmn rules.dmn -o process.awa.json   # a BPMN 2.0 process from a modeller
awa export bpmn workflow.awa.json      # workflow.bpmn (+ workflow.dmn); importing it gives the same document
awa export serverless-workflow workflow.awa.json   # CNCF Serverless Workflow 1.0, and what does not map
```

- Task types give actor types (user/manual task: human; service/script task: application). Mark an AI agent's task with `awa:actorType="ai_agent"` (namespace `https://awa.io/schema/interchange/1.1`). Lanes are roles.
- A business rule task names its DMN decision (`awa:decisionRef`, or Camunda's `decisionRef`); without the DMN file it becomes an external decision engine named `dmn`.
- The import refuses, with the element and the reason, what AWA cannot run the same way: complex gateways, transactions, terminate end events, error and escalation boundary events, loops and multi-instance tasks, timers at a date, FEEL with names or arithmetic. Rework those in the BPMN before importing (specification 27.8).
- Comparison with BPMN, DMN, Serverless Workflow, Arazzo and agent frameworks: `docs/interchange.md`.

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
| `shared_state` | A write replaces the value | Order data shared across activities |
| `message_passing` | A write is appended to the list of messages | Event-driven communication |
| `blackboard` | A write (an object) is merged into the value: a later writer does not erase an earlier one | Multi-agent problem solving |
| `event_sourcing` | A write is appended to the log | Audit trails, event replay |

The engine enforces these (specification section 22): see "Contexts and service levels" below.

### Access Modes

| Mode | Description |
|------|-------------|
| `read` | The activity is given the context's value |
| `write` | The activity may write to it, and is not given it |
| `read_write` | Both |
| `subscribe` | Given, as `read` |
| `publish` | May write, as `write` |

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
pip install agentic-workflow-architecture

# With the HTTP server, and the tools for development
pip install "agentic-workflow-architecture[web,dev]"
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

The Python SDK passes every conformance level and has the same commands as the TypeScript one (`awa run`, `validate`, `journey`, `migrate`, `measures`, `replay`, `evidence`, `eval`, `knowledge`, `task`, `telemetry`, `serve`), with the same options. It has no recipe, Open Knowledge Format exchange, Google or embedded provider, or views.

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

# Offer a workflow to other agents over A2A, under a deployment's permissions
awa serve --a2a workflow.awa.json --deployment deployment.json
```

### CLI Commands Reference

| Command | Description | Options |
|---------|-------------|---------|
| `awa validate <files...>` | Check workflow and journey documents; a journey against the workflows given beside it | `--json` |
| `awa run <file>` | Execute a workflow file | `-v, --verbose`, `-k, --key <key>`, `-s, --simulate`, `--outputs <file>`, `-p, --providers <list>`, `-j, --journal <file>`, `-c, --checkpoint-dir <dir>`, `-i, --input <json>`, `--allow-commands [list]` |
| `awa recipe <workflow> [journal]` | Compile a build-from-scratch recipe | `-o, --output <file>`, `--no-definition`, `--no-payloads` |
| `awa knowledge <ingest\|list\|review\|deprecate\|export\|import>` | Build, review and exchange knowledge | `--kb <file>` |
| `awa journey <add\|publish\|tick\|resume\|list\|show\|analytics\|export>` | Journeys in a runtime directory, or a shared PostgreSQL store | `--dir <dir>`, `--store <url>` (or `AWA_RUNTIME_STORE`), `--simulate`, `--outputs <file>` |
| `awa migrate <check\|plan\|apply>` | Compare versions of a workflow, and move runs at rest to another version by a plan (section 25) | `--dir`, `--store`, `--plan <file>`, `--to <version>`, `--from <version>` (check), `--json` |
| `awa measures` | The measures of journeys and workflows | `--dir`, `--file`, `--from`, `--to`, `--json`, `--openmetrics`, `--html <file>`, `--list` |
| `awa telemetry export <workflow> <journal>` | A recorded run as OpenTelemetry traces; also `journeys` and `measures` | `--endpoint <url>`, `--file <out.json>`, `--protocol`, `--header k=v`, `--service-name`, `--payloads` |
| `awa replay <workflow> <journal>` | Counterfactual replay; exit status 2 on a regression | `--candidate <file>`, `--ai live\|recorded`, `-o`, `--json` |
| `awa evidence <sources...>` | An evidence report from journals and journey records, every statement citing its records | `--from`, `--to`, `--workflow <id or name...>`, `--as-of`, `--format json\|md\|html`, `-o` |
| `awa eval <build\|run>` | Evaluation datasets from journals; a candidate scored against one, exit status 2 on a regression | `build <journals...> -o`; `run <workflow> <dataset> --candidate <file> --providers <list> --json -o` |
| `awa task <list\|show\|assign\|complete\|reject>` | Human tasks in the task database | - |
| `awa import <bpmn\|dmn> <file>` | Read a BPMN 2.0 process or DMN decision tables into AWA | `--dmn <files...>`, `-o, --output <file>` |
| `awa export <bpmn\|dmn\|serverless-workflow> <files...>` | Write BPMN 2.0 (+ DMN), DMN, or CNCF Serverless Workflow | `-o, --output <file>`, `--no-diagram`, `--format yaml\|json` |
| `awa init` / `awa generate <prompt>` | Create a starter workflow / generate one from a description | - |
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
| `completed` | Every token completed |
| `failed` | At least one token failed. The other tokens are cancelled and compensation handlers run |
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

## Business Events, Journeys and Counterfactual Replay

**Wait for a business event** with a `message` event node (a `signal` reaches every waiting token):

```json
{ "id": "…", "name": "Documents uploaded", "event_type": "message",
  "event_definition": { "name": "documents.uploaded", "correlation_key": "customer_id",
                        "timeout": "P5D", "timeout_edge_id": "<edge taken when nothing arrives>" } }
```

Without a `timeout_edge_id` a timeout fails the token (`EVENT_TIMEOUT`). `"mode": "publish"` publishes instead of waiting; `data` lists the token paths to publish.

**Host many runs and journeys** with `AwaRuntime`:

```typescript
const runtime = new AwaRuntime({ engine: { /* WorkflowEngine options */ } })
    .register_workflow(intake).register_workflow(settlement).register_journey(journey);
await runtime.publish(business_event('claim.submitted', { customer_id: 'c-1' }));  // starts journey and run
await runtime.publish(business_event('documents.uploaded', { customer_id: 'c-1' })); // wakes the waiting run
await runtime.tick();                       // lets deadlines pass
runtime.analytics(journey.id);              // funnel per stage
```

A journey (`spec/json-schema/journey.schema.json`) has `subject.key`, `stages` (`complete_when`, `max_duration`, `on_enter.start_workflow`, `transitions`), `triggers`, `goals` and `exits`. See `examples/claims-journey`.

A journey can also declare its **touchpoints**, **what changes hands** and the customer's **mood** (specification 19.8, 19.9):

```json
"artefacts":   [{ "id": "insurance-contract", "name": "Insurance contract", "kind": "contract" }],
"touchpoints": [{ "id": "contract-signed", "name": "Signs the contract", "direction": "inbound", "channel": "web",
                  "technology": "E-signature service", "on": { "event": "contract.signed" },
                  "exchanges": [{ "artefact": "insurance-contract", "reference": "contract_id" }] }],
"sentiment":   { "rules": [{ "on": "waited", "longer_than": "P2D", "change": -1, "reason": "waited more than two days" },
                           { "on": "event", "event": "survey.answered", "measure": { "path": "satisfaction", "from": [1, 5] } }] }
```

`on` is one of `event`, `activity` (an activity name) or `tool` (a tool name). Every mood change is recorded as `measured` or `inferred`. `runtime.transitions()` reports how subjects move between journeys. View it all with `tools/visualization/journey.html`.

Journeys are durable. Keep them in a runtime directory and work on it from any process:

```bash
awa journey add intake.awa.json claim.journey.json     # definitions
awa journey publish claim.submitted -d '{"customer_id":"c-1"}'
awa journey tick                                       # let deadlines pass; run on a schedule
awa journey list --stalled
awa journey export -o portfolio.json                   # opens in tools/visualization/journey.html
```

```typescript
const runtime = await open_runtime_directory('.awa');  // recovers journeys and waiting runs
```

Over HTTP: `AWA_DATA_DIR=.awa awa serve`, then `POST /api/v1/journeys/events`, `GET /api/v1/journeys/portfolio`.

A runtime directory belongs to one host at a time. For several hosts (servers on several machines, scheduled jobs, commands) keep journeys in a **shared PostgreSQL store** instead (specification section 29). Each operation holds only the subjects it touches, an event id is accepted once across all hosts, and a host that dies leaves nothing half done. TypeScript and Python hosts can share one store. It needs `npm install pg` (or the Python extra `postgres`); the store creates its tables, in schema `awa_runtime`, itself.

```bash
export AWA_RUNTIME_STORE=postgres://awa@db.internal/awa   # not AWA_DATABASE_URL, which is the task database
awa journey add intake.awa.json claim.journey.json        # definitions go into the store
awa serve --port 3000                                      # the same on every machine; or --store <url>
```

```typescript
const runtime = await open_runtime_store(process.env.AWA_RUNTIME_STORE!);  // registers the store's definitions
await runtime.publish(event);       // one transaction, holding only this subject
await runtime.refresh();            // read the whole store, as every host left it
```

**Changing a workflow while runs are in flight** (specification section 25). Give the new document the same `id` and a higher `version` and add it: every version is kept, runs under way stay on the version they started on, new runs (and those journeys start) take the newest. Nothing moves by itself. To move a run that is at rest (waiting for a person, an event, an agent, a timer or a join), write a plan and check it first:

```bash
awa migrate check <workflow_id>                     # per waiting step of the old version: compatible, needs_mapping (with candidates) or impossible; and which runs can move
awa migrate plan <run_id> --plan plan.json          # dry run; exit 2 with every reason when it would be refused
awa migrate apply <run_id> --plan plan.json         # one change, recorded as run.migrated
```

```json
{ "to_version": "2.0.0", "nodes": { "<old node id>": "<new node id>" }, "restart": ["<old node id>"],
  "data": [{ "set": "currency", "value": "EUR" }, { "set": "priority", "expression": "amount > 1000" }, { "remove": "legacy_code" }] }
```

- Keep node ids for steps that stay the same: the identity mapping then moves runs without a plan.
- A waiting token is kept only where its wait still means something: a person's task at an activity of the same actor type, an event wait at a node waiting for the same event and correlation, a timer at a timer, a join at a join. Otherwise map it elsewhere, or list it in `restart` to withdraw the wait and start the step afresh.
- A run in the middle of an activity is refused (`run_in_activity`): wait for it to come to rest.
- `runtime.migrate(run_id, plan, { dry_run })`, `runtime.check_migration(workflow_id)`; HTTP `POST /api/v1/journeys/runs/{run_id}/migrate[?dry_run=true]`, `POST /api/v1/journeys/migrations/check`.

**Counterfactual replay** answers "what if this run had used another model or rule":

```bash
awa replay workflow.awa.json run.jsonl --candidate changed.awa.json --ai recorded   # exit 2 on regression
```

### Contexts and service levels (specification sections 22 and 23)

Context bindings are enforced. An actor is given, under `inputs._contexts`, the contexts its activity is bound to read (`read`, `read_write`, `subscribe`) and no other. It writes by returning `_context_writes: { "<context name>": value }`, which needs a binding that allows writing (`write`, `read_write`, `publish`) and must match the context's `schema`. `shared_state` replaces the value, `blackboard` merges, `event_sourcing` and `message_passing` append.

- A required context with no value fails the activity with `CONTEXT_MISSING`. Give the context an `initial_value`, make sure an earlier activity writes it, or set `required: false` on the binding.
- A write without a binding fails with `CONTEXT_ACCESS_DENIED`; one the schema refuses with `CONTEXT_INVALID`.
- In a simulation, script the writes: `{ "Receive order": { "contexts": { "Order": { "total": 240 } } } }`.

An `sla` on an activity or a workflow is compared with the time the work takes, waits and retries included: `sla.warning` past `target_time` (or `escalation_policy.warning_threshold`), `sla.breached` past `max_time`. Work that finished late stands. With `escalation_policy.breach_action: "fail"`, work still waited for fails with `SLA_BREACH`. `runtime.tick()` and `engine.checkServiceLevels()` check what is waiting.

### Measures (specification section 21)

What an organisation asks of its journeys and workflows, computed from the record: completion, abandonment and stall rates, goal attainment, time per stage and stages that outlasted their time, mood and how much of it was measured, success rate, right first time, lead time against work time, waits for customers and for people, tool failures, decisions by method, tokens and cost.

```bash
awa measures --dir .awa                 # for people
awa measures --dir .awa --json          # the report
awa measures --file portfolio.json --from 2026-09-01T00:00:00Z
awa measures --list                     # every measure with its rule
```

```typescript
import { compute_measures } from 'agentic-workflow-architecture';
const report = compute_measures(await runtime.export_portfolio(), { journey_id });
report.journeys[0].measures['journey.completion_rate'];   // { value: 0.5, n: 6 }
report.attention;                                         // who is stuck, in which stage, and its owner
```

A measure is `{ value, n }`: `n` is what it was computed over, and `value` is `null`, never 0, when that is nothing. `GET /api/v1/measures` serves the report and `?format=openmetrics` gives it to a metrics system (`?format=otlp` as OpenTelemetry gauges). `tools/visualization/dashboard.html` shows it (`?live=http://localhost:3000` reads a running server). Give a stage an `owner` so that a stalled journey names who must act.

### Telemetry (specification section 26)

Every run and journey can be watched in OpenTelemetry. A run is one trace: a span for the run (`invoke_workflow`), each attempt (`invoke_agent` for an AI agent), each tool call (`execute_tool`), each model call (`chat`, with provider, model and token usage in the generative AI conventions), each decision and each wait; everything else in the journal is a span event. A journey is one trace whose run spans link to the runs' traces. Trace and span ids are derived from the run id, so the spans sent live and those exported later from the journal are the same, in either SDK.

```bash
OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318 awa run workflow.awa.json      # spans leave as the run proceeds
awa telemetry export workflow.awa.json run.journal.jsonl --endpoint http://localhost:4318
awa telemetry export workflow.awa.json run.journal.jsonl --file run.otlp.json   # OTLP/JSON
```

```typescript
import { OtlpHttpExporter, WorkflowEngine } from 'agentic-workflow-architecture';
const exporter = new OtlpHttpExporter({ traces_url: 'http://localhost:4318/v1/traces' });
const engine = new WorkflowEngine(workflow, { telemetry: exporter });   // or { telemetry: { endpoint, headers, payloads } }
```

Telemetry never holds up or fails a run: a backend that is down costs dropped spans, counted and reported, and the journal can send them again. Inputs, outputs and tool arguments go on spans only with `payloads: true` (or `AWA_TELEMETRY_PAYLOADS=true`). `awa serve` and `awa journey` honour the same `OTEL_*` variables.

### Evidence, evaluation and shadow runs (specification sections 32 and 33)

**Evidence** for regulators and auditors, computed from the record: what ran, which models decided what, every human decision, override and escalation, every contract and verification result, refusals, failures, compensations, service level breaches, tool calls by target, data by payload mode, and the records held. Each statement cites the journal records it rests on (run id and `seq`); each part names the EU AI Act articles (12, 13, 14, 15, 26), NIST AI RMF functions and ISO/IEC 42001 clauses it can serve. Say it as the report does: evidence a deployer can use, **not a certification of compliance**.

```bash
awa evidence .awa --from 2026-09-01 --to 2026-10-01 --format html -o evidence.html   # also md (default) or json
```

**Evaluation** turns recorded runs into a dataset, one case per visit to an AI activity (its input; the outcome accepted by contract, verification or a person, or what rejected it), and scores a candidate against it per activity, through counterfactual replay: tools answer as recorded.

```bash
awa eval build runs/*.jsonl -o dataset.jsonl
awa eval run claims.awa.json dataset.jsonl --candidate changed.awa.json --providers ollama   # exit 2 on a regression
```

**Shadow runs**: `new AwaRuntime({ ..., shadow: { candidates: { [workflow.id]: candidate }, engine: { model_providers, model_tiers } } })`. Each production run that ends is replayed under the candidate; tools, people and other actors never run. `runtime.shadow.report()` gives the measures of both and the runs where they part.

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
5. **Follow the 1.1 rules above**: a default edge for every choice, no accidental parallel splits, valid condition expressions

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

## Web Interface (Kanban)
 
The **Kanban Web Application** (`apps/kanban-web`) provides a human-centric interface for managing tasks generated by the workflow engine.
 
### Features
 
- **Real-time Board**: Drag-and-drop interface for managing task status (`pending` -> `assigned` -> `in_progress` -> `complete`).
- **Task Detail Dialog**: A comprehensive modal view (replaces the previous side sheet) displaying:
    - **Actor Metadata**: Clearly identifies who created the task (AI Agent, Robot, System) and who it is assigned to.
    - **Timestamps**: Creation, update, due, and completion times.
    - **Data Payloads**: Full JSON view of task inputs and outputs.
- **Visual Differentiation**: Task cards use distinct border colors and backgrounds to indicate the actor type:
    - 🟣 **AI Agent**: Purple theme
    - 🟠 **Robot**: Orange theme
    - 🔵 **Application**: Blue theme
    - 🟢 **Human**: Green/Neutral theme
 
### Running the App
 
```bash
cd apps/kanban-web
npm run dev
# Access at http://localhost:3000
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

**`CONTEXT_MISSING`**
- An activity is bound to read a context that has no value. Have an earlier activity write it, give the context an `initial_value`, or set `required: false` on the binding. In a simulation, script the write: `{ "Receive order": { "contexts": { "Order": { ... } } } }`

**`CONTEXT_ACCESS_DENIED`, `CONTEXT_INVALID`**
- The activity wrote to a context it has no binding to write, or a value its schema refuses.

**`NO_ROUTE` in a simulation**
- A condition read data no activity produced: script the activity's `output` in the simulation file.

**`SLA_BREACH`**
- Work still waited for passed its service level, whose `breach_action` is `fail`.

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
    "model_id": "tier:balanced",
    "temperature": 0.2,
    "system_prompt": "You are a customer support analyst."
  }
}
```

## References

- **Main README**: `README.md` - Quick start and overview
- **CLI Guide**: `sdk/typescript/docs/cli-guide.md` - Complete CLI documentation
- **API Guide**: `sdk/typescript/docs/operational-api.md` - REST API reference
- **Specification**: `docs/specification.md` - The normative AWA 1.1 specification
- **Conformance suite**: `spec/conformance/` - What it means to implement AWA
- **Embedded models**: `docs/embedded-models.md` - What small in-process models can and cannot do
- **Examples**: `examples/` - Working workflow examples
- **Schemas**: `spec/json-schema/` - JSON Schema definitions
