# Agentic Workflow Architecture (AWA)

> **A system for a new way to automate enterprise workflow in the agentic era, natively made to work with AI.**

AWA is a next-generation specification and framework designed to build, run, and visualize **AI-native business processes**. It moves beyond traditional BPMN by treating **AI Agents** as first-class citizens alongside humans, robots, and software systems.

---

## What is AWA?

In the age of Generative AI, traditional workflows are too rigid. Agents need **autonomy**, **context**, and **tools**.

**AWA (Agentic Workflow Architecture)** provides the standard for defining queryable, maintainable, and intelligent workflows where:
- **AI Agents** reason and use tools (MCP) to complete tasks.
- **Humans** are loop-in for critical decisions and approvals.
- **Robots** execute physical world actions.
- **Systems** handle high-speed deterministic processing.

It solves the "Black Box" problem of AI agents by providing a **structured, observable, and queryable** backbone for agent orchestration.

---

## Capabilities

- **First-Class AI Agents**: Native support for LLM-backed actors with specific personas, tool proficiencies (MCP), and context awareness.
- **Context-Aware Memory**: Shared state, message passing, and blackboard patterns for multi-agent collaboration.
- **Value Stream Intelligence**: Built-in Lean/Six Sigma analytics that automatically detect waste (DOWNTIME) and track value-added time.
- **Human-in-the-Loop**: Seamless handoffs to humans for approvals, reviews, and complex decision-making via a dedicated Kanban interface.
- **Queryable Architecture**: The entire workflow is a queryable graph. Ask "Which steps involve high-risk financial data?" or "Show me all activities performed by Gemini 3.0 Pro".

---

## Features

- **AI-Native Runtime**: Built-in support for the latest **Gemini 3 series** (3.1 Pro, 3 Flash, 3.1 Flash-Lite) with hierarchical model configuration.
- **Multi-Actor Support**: Orchestrate Humans, AI Agents, Robots, and Applications in a single flow.
- **Smart Decision Nodes**: DMN-inspired decision tables with FEEL expression support for complex business logic.
- **Visualizations**:
    - **2D/3D Diagrams**: ReactFlow and Babylon.js rendering.
    - **Kanban Board**: Real-time task management for human actors.
- **Production Ready**:
    - **Resilience**: Automatic retries and Dead Letter Queues (DLQ).
    - **Security**: RBAC (Role-Based Access Control) with JWT and API Keys.
    - **Persistence**: Checkpointing and state restoration (PostgreSQL/File).
- **Polyglot SDKs**: Full support for **TypeScript** and **Python**.

---

## Quick Start (TypeScript)

### 1. Install

```bash
npm install -g agentic-workflow-architecture
```

### 2. Define and Run

```typescript
import { WorkflowEngine, workflow } from 'agentic-workflow-architecture';

const orderProcess = workflow('Order Fulfillment', '1.0.0')
  .addActivity({
    name: 'Analyze Data',
    role_id: 'ai-analyst',
    actor_type: 'ai_agent'
  })
  .build();

const engine = new WorkflowEngine(orderProcess, {
  gemini_api_key: process.env.GEMINI_API_KEY,
  default_ai_model_id: 'gemini-3-flash-preview' // Documentation-verified default
});

await engine.run();
```

```bash
# Run with verbose logging
npx awa run workflow.awa.json --verbose --key YOUR_GEMINI_API_KEY
```

---

## Architecture

AWA is built on a modular architecture designed for scalability and observability.

```mermaid
graph TD
    User["User / Client"] --> API["Operational API"]
    API --> Engine["Workflow Engine"]
    
    subgraph "Execution Layer"
        Engine --> Human["Human Task Queue"]
        Engine --> AI["AI Agent Runner"]
        Engine --> Robot["Robot Simulator"]
        Engine --> App["App/System Runner"]
    end
    
    subgraph "Intelligence"
        AI --> LLM["LLM Models (Gemini/Claude)"]
        AI --> Tools["MCP Tools"]
    end
    
    subgraph "Persistence & Analytics"
        Engine --> DB[("State Store")]
        Engine --> VSM["VSM Analytics"]
    end
```

---

## Project Structure

The repository is organized into SDKs, Specifications, and Applications.

| Directory | Description |
|-----------|-------------|
| `sdk/typescript` | Core **TypeScript SDK** and CLI tools. |
| `sdk/python` | **Python SDK** for data science and AI engineers. |
| `apps/kanban-web` | **Kanban Web App** (Next.js) for human task management. |
| `spec/` | Official specifications (JSON Schema, OpenAPI, Avro, DDL). |
| `examples/` | End-to-end examples (Insurance, Retail, Banking). |

---

## Kanban Web Application

AWA includes a modern **Kanban Web Application** for managing human tasks. It provides:

- **Real-time Updates**: Tasks appear instantly as agents assign them.
- **Rich Task Details**: View full context, actor metadata, and input/output data in a responsive modal.
- **Visual Cues**: Distinct visual styles for tasks created by AI Agents, Robots, or Systems.

To use the Kanban app, clone the repository and run it locally:

```bash
git clone https://github.com/yannickhuchard/agentic-workflow-architecture.git
cd agentic-workflow-architecture/apps/kanban-web
npm install
npm run dev
# Open http://localhost:3000
```

---

## Documentation & Resources

- **[Skill Definition](SKILL.md)**: Comprehensive guide for AI assistants.
- **[CLI Guide](sdk/typescript/docs/cli-guide.md)**: Command-line reference.
- **[API Reference](sdk/typescript/docs/operational-api.md)**: REST API documentation.
- **[Examples](examples/)**: Explore real-world use cases like Insurance Claims and Retail Distribution.

---

## License

Apache 2.0

## Authors

- [Yannick HUCHARD](https://yannickhuchard.com)