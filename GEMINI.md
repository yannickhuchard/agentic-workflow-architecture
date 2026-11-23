# Agentic Workflow Architecture (AWA)

Context for AI coding assistants working in this repository. The specification is [`docs/specification.md`](docs/specification.md); what it means to implement it is [`spec/conformance`](spec/conformance).

## Project overview

AWA is a specification (1.1) for business workflows in which AI agents, people, robots and applications work side by side, with reference implementations. Its principle is **fixed outcome, free strategy**: an agent may reach a result by different means each time, so AWA fixes what must be true of the result (outcome contracts, verification), records how it was reached (the journal), and refuses results it cannot verify.

Layers: workflows (activities, decisions, events, parallel flow), outcome contracts and verification, resilience (retry, checkpoints, recovery), model routing by capability tier, model decisions, tools, contexts and service levels, business events, journeys of customers across workflows, measures, counterfactual replay, knowledge.

## Repository

| Path | What |
|---|---|
| `docs/specification.md` | The normative text |
| `spec/json-schema` | Normative JSON Schemas |
| `spec/conformance` | Language-neutral cases; `generate.py` writes them |
| `spec/openapi`, `spec/graphql`, `spec/avro`, `spec/ddl` | Informative projections |
| `sdk/typescript` | The reference implementation and the `awa` command (npm `agentic-workflow-architecture`) |
| `sdk/python` | The Python SDK, at every conformance level (PyPI `agentic-workflow-architecture`, imported as `awa`) |
| `sdk/java` | A data model of AWA documents, without an engine |
| `tools/visualization` | Run replay, journey view, measures page |
| `apps/mcp-server`, `plugins/awa` | MCP server with embedded views, and its ChatGPT plugin package |
| `apps/kanban-web` | Kanban board for human tasks (Next.js) |
| `examples/` | Examples; `claims-settlement` and `claims-journey` show most of the specification |

## Building and testing

### TypeScript SDK (`sdk/typescript`)
- Install: `npm ci && npx prisma generate`
- Test: `npx vitest run`
- Typecheck and lint: `npm run typecheck`, `npm run lint`
- Build: `npm run build` (also copies the views into the package); `npm run build:measures` rebuilds `tools/visualization/awa-kpis.js`

### Python SDK (`sdk/python`)
- Install: `pip install -e ".[dev,web]"`
- Test: `pytest -q`
- Lint and types: `ruff check .`, `mypy .`

### Specification and generated files
- `python3 spec/conformance/generate.py` after changing a case; CI fails if the committed cases differ.
- `python3 docs/build-guides.py` after changing a guide; CI fails if the HTML differs.

### Kanban web app (`apps/kanban-web`)
- `npm run dev`, `npm run build`

## Development conventions

- **Specification first.** A change to what an engine does goes into `docs/specification.md`, the JSON Schemas and, where it can be tested without an implementation, a conformance case. Both SDKs must then pass every case of every level they claim, with none skipped.
- **Both SDKs.** The TypeScript SDK is the reference; the Python SDK follows it. A change to one is made to the other, or the gap is written down in `sdk/python/README.md`.
- **Models are configuration.** The default model is `default_ai_model_id` in `sdk/typescript/src/config.json` (see `.agent/rules/ai-rules.md`), read by `src/runtime/model_config.ts` and overridable with `AWA_DEFAULT_AI_MODEL_ID`: every default of the SDK (agent, judge, model decision, `awa generate`) comes from it. Documents may name a capability tier (`tier:reasoning`, `tier:balanced`, `tier:fast`) instead of a model; `TIER_PRESETS` in `src/runtime/models.ts` maps tiers for each provider, the Google row from the same configuration.
- **Outcome contracts.** Give AI agent activities an outcome contract, and a verification policy where judgement is needed.
- **Simulation.** Examples ship a `simulation.json` so that they run with `--simulate`, including the context writes their activities require.
- **TypeScript.** Zod schemas for runtime validation (`src/types`); actor logic kept out of the `WorkflowEngine`.
- **Plain words.** Documentation and messages say what happens in plain, precise English.
