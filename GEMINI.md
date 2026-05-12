# Agentic Workflow Architecture (AWA)

A next-generation specification and framework for building, running, and visualizing **AI-native business processes**.

## Project Overview

AWA orchestrates **AI Agents**, **Humans**, **Robots**, and **Legacy Systems** in a unified, observable framework. It treats AI as a first-class citizen with autonomy, shared context (blackboard pattern), and explicit quality controls via an "AI-as-Judge" verification loop.

### Core Architecture
- **Orchestration Engine**: Manages token-based execution and state transitions.
- **Verification Loop**: Uses AI (Gemini 3.1) to verify task outputs against acceptance criteria.
- **Telemetry & VSM**: Automatically tracks Process/Cycle Time and detects DOWNTIME waste categories.
- **Shared Context**: Multi-agent collaboration via patterns like `shared_state` and `blackboard`.

### Technology Stack
- **SDKs**: TypeScript (Node.js) and Python.
- **AI**: Google Gemini (Default: `gemini-3-flash-preview`).
- **Persistence**: Prisma (TypeScript) and Pydantic (Python).
- **Web App**: Next.js (Kanban board for human tasks).

---

## Building and Running

### TypeScript SDK (`sdk/typescript`)
- **Build**: `npm run build` (uses `tsup`)
- **Development**: `npm run dev` (watch mode)
- **Database**: 
  - `npm run db:generate` (Prisma client)
  - `npm run db:push` (Sync schema to SQLite/PostgreSQL)
- **Test**: `npm run test` (Vitest)
- **Lint**: `npm run lint`

### Python SDK (`sdk/python`)
- **Install**: `pip install -e .[dev,ai,web]`
- **Test**: `pytest`
- **Lint**: `ruff check .`
- **Typecheck**: `mypy .`

### Kanban Web App (`apps/kanban-web`)
- **Dev**: `npm run dev`
- **Build**: `npm run build`
- **Start**: `npm run start`

---

## Development Conventions

### Agentic Patterns
- **AI-as-Judge**: Always define `VerificationPolicy` for AI-agent activities to ensure output quality.
- **Hierarchical Models**: Use the appropriate Gemini model for the task (Pro for reasoning, Flash for speed, Flash-Lite for simple verification).
- **Lean Analytics**: Every activity should be analyzed for its "Value Added" status to feed the VSM telemetry.

### Coding Standards
- **TypeScript**: Use Zod schemas for runtime validation (defined in `src/types`).
- **Observability**: Ensure all activity transitions are logged via `ExecutionLogger`.
- **Modularity**: Keep actor logic decoupled from the core `WorkflowEngine`.

### Specification First
- Any changes to the core entities must be reflected in `docs/specification.md` and the JSON schemas in `spec/json-schema`.
