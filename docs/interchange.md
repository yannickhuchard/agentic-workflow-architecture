# AWA and the formats organisations already use

This note is informative. The normative rules for reading and writing BPMN, DMN and Serverless Workflow are in section 27 of the [specification](specification.md); this note compares AWA with those formats and with the frameworks people use to build agents, so that you can tell what crosses over, what does not, and which tool fits which job.

The short version:

| | Mapped by AWA | What it is best at | What AWA adds |
|---|---|---|---|
| BPMN 2.0 | Import and export, lossless from AWA | Process modelling that business and IT share, with a standard notation and mature modellers | Actors that are AI agents, outcome contracts, verification, tools, model routing, knowledge, a specified execution journal |
| DMN 1.x | Import and export of decision tables | Rules owned by the business, in tables with a standard expression language (FEEL) | Decisions that a model can finish when no rule matches, within enumerated options |
| CNCF Serverless Workflow 1.0 | Export, with a list of what does not map | Running service orchestration on any compliant runtime | Human and AI work as first-class activities, contracts, knowledge, journeys |
| Arazzo 1.0 | Not mapped | Describing sequences of API calls against OpenAPI documents | Everything beyond calling APIs: people, agents, decisions, waiting, compensation |
| Agent frameworks (LangGraph, CrewAI, vendor agent SDKs) | Not mapped | Writing the agent itself in code: its loop, its memory, its tools | A declarative, portable description of the work around the agent, and a record of it |

## BPMN 2.0

**What maps.** A BPMN process is an AWA workflow. Lanes are roles; user, manual and plain tasks are human activities; service and script tasks are application activities; an `awa:actorType` attribute marks an AI agent's or a robot's task. Exclusive gateways become AWA's routing (first true condition, then the default); parallel gateways become splits and `join: "all"`; inclusive gateways are encoded with guards and merges so that the join waits exactly for the branches taken; an event-based gateway before one message and one timer becomes a wait with a timeout. Start, end, message, signal, timer and error events, send and receive tasks, call activities, embedded subprocesses, data objects and compensation handlers all have a place (27.3 to 27.6).

**From AWA to BPMN nothing is lost.** What BPMN has no element for (outcome contracts, verification policies, retry, tools, contexts and their bindings, model references, service levels, knowledge) travels in BPMN's `extensionElements`, in the `awa:` namespace published as [`spec/xsd/awa-interchange.xsd`](../spec/xsd/awa-interchange.xsd). An exporter writes there only what the BPMN elements do not already say, and every export is checked by reading it back. Every workflow under `examples/` makes the round trip in both SDKs.

**What BPMN has that AWA lacks.** Error and escalation boundary events (alternative paths when an activity fails or must be escalated), non-interrupting events, event subprocesses, transactions and cancellation, terminate end events, complex gateways, loops and multi-instance activities, timers at a date or on a cycle, and collaboration semantics between pools (message flows, choreographies, conversations). These are refused on import with the reason (27.8), because importing them as something that behaves differently would be worse than not importing them. Some have an AWA way of saying a similar thing: a condition on the activity's result instead of an error boundary, an outcome contract that escalates to a person instead of an escalation event, an edge back with a condition instead of a loop.

**What AWA has that BPMN lacks.** BPMN says *who* performs a task and *what kind* of task it is; it does not say what must be true of the result. AWA's outcome contracts and verification fail closed, so an agent's answer that does not meet them never moves the work on. AWA routes model calls by capability tier with fallbacks, runs tools through one runner that records every call, distils what runs teach into reviewed knowledge, and specifies the journal an engine writes, which makes runs replayable and comparable across engines. BPMN execution semantics are those of each engine; AWA's are specified and tested by a conformance suite.

## DMN 1.x

**What maps.** A DMN decision table is an AWA decision table: hit policies `UNIQUE`, `FIRST`, `PRIORITY`, `ANY`, `COLLECT` and `RULE ORDER`; inputs, outputs and their types; rules. FEEL unary tests are translated into AWA's entry language: comparisons, ranges, lists, negation, `null`, dates, and `contains`, `starts with`, `ends with` and `matches` (27.10).

**What DMN has that AWA lacks.** The full FEEL language (arithmetic, functions, contexts, quantifiers), decision requirement graphs linking decisions, business knowledge models and decision services, literal-expression decisions, `OUTPUT ORDER` and aggregations of `COLLECT`. A table whose entries use FEEL that AWA cannot express is refused with the expression quoted. An organisation that holds its rules in a DMN engine can keep them there and plug the engine into AWA as an external decision engine (5.5.4).

**What AWA has that DMN lacks.** A decision can be finished by a model when no rule matches, choosing among enumerated options with a stated confidence (section 16), and every decision is journalled with the rule or option that decided it. AWA's entry language is smaller than FEEL on purpose: every engine evaluates it the same way.

## CNCF Serverless Workflow 1.0

**What maps.** The export writes each activity as a request event and a wait for its completion, so that whoever performs it (a person, an agent, a robot, a service) can answer; conditional edges become a `switch` in jq; parallel splits a `fork`; timers `wait`; publishing an event `emit`; waiting `listen` with correlation and a timeout; retry policies `try` with exponential backoff; first-hit decision tables a `switch` with one case per rule (27.11).

**What Serverless Workflow has that AWA lacks.** Concrete calls to HTTP, OpenAPI, AsyncAPI, gRPC and containers as tasks of the workflow, data transformation with jq at every step, authentication policies, and a growing set of runtimes. AWA calls interfaces through an agent's tools and an application actor rather than as workflow steps.

**What does not map, and is listed by the export.** Roles, outcome contracts, verification, tools, knowledge, contexts, service levels, compensation, model decisions, external decision engines, decision tables other than first hit (and their outputs), and the path a timed-out wait takes. Serverless Workflow is block-structured, so parallel branches that meet before their join are refused.

## Arazzo 1.0

Arazzo, from the OpenAPI Initiative, describes sequences of calls to APIs described by OpenAPI documents: each step names an operation, its parameters, success criteria, outputs, and what to do on success or failure (go to a step, retry, end).

**Overlap.** An Arazzo workflow is close to a chain of AWA application activities whose tools are bound to OpenAPI operations, with success criteria like AWA postconditions and `onFailure: retry` like an AWA retry policy. AWA's tool bindings name the interface they call and can point at its OpenAPI document.

**Differences.** Arazzo is about APIs alone: it has no people, agents, decisions over business rules, waiting for business events, compensation, or journeys, and it does not specify a journal. AWA does not describe API call sequences at the level of request parameters and runtime expressions; an agent or application actor does that work. The two are complementary: an Arazzo document can describe how an application activity is carried out. No mapping is provided.

## Agent frameworks

LangGraph, CrewAI and the agent SDKs that model vendors publish (for example the OpenAI Agents SDK and Google's Agent Development Kit) are libraries for writing agents in code.

| | LangGraph | CrewAI | Vendor agent SDKs | AWA |
|---|---|---|---|---|
| Unit of work | A node: a function over shared state | A task assigned to an agent with a role | A run of one agent, with handoffs to others | An activity performed by a human, AI agent, robot or application |
| Control flow | A graph with conditional edges, cycles, checkpoints, interrupts for a person | Sequential or hierarchical processes; flows with routers | The agent loop; handoffs; guardrails | A specified graph: routing, decisions, parallel joins, events, timers, compensation |
| Persons in the loop | Interrupt and resume | A task flagged for human input | Tool approvals | First-class human activities, tasks that wait, escalation from a contract |
| Result guarantees | What the code checks | Expected output, guardrail functions | Output types, guardrails | Outcome contracts and verification, failing closed |
| Record | Checkpoints of state; traces through a separate service | Logs and traces | Traces | A specified execution journal, replay and counterfactual replay |
| Portability | Code in one language and library | Code in one library | Code against one vendor's API | A JSON document, two SDKs held to one conformance suite |

**What the frameworks have that AWA lacks.** The inside of an agent: its prompting, memory, planning loop, streaming, the fine control a programmer has over each step, and large ecosystems of integrations. AWA deliberately leaves the strategy free ("fixed outcome, free strategy") and does not prescribe how an agent reasons.

**What AWA has that the frameworks lack.** A declarative document that people who do not write code can read and change; the same document run by different engines with the same results; work shared between people, agents, robots and systems as equals; contracts on the result instead of on the steps; and a record that is part of the standard. An agent built with any of these frameworks can be the actor behind an AWA `ai_agent` activity.

No mapping is provided: these are programs, not documents, and a translation would be a code generator for each framework rather than an interchange format.

## Using the commands

```bash
awa export bpmn claims-settlement.awa.json          # claims-settlement.bpmn and claims-settlement.dmn
awa import bpmn claims-settlement.bpmn              # reads claims-settlement.dmn beside it
awa import bpmn process.bpmn --dmn rules.dmn -o process.awa.json
awa import dmn rules.dmn                            # rules.decisions.json: AWA decision nodes
awa export dmn order-processing.awa.json
awa export serverless-workflow policy-renewal.awa.json   # policy-renewal.sw.yaml, and what does not map
```

The TypeScript SDK reads and writes with `bpmn-moddle`, `dmn-moddle` and `@serverlessworkflow/sdk`, which are optional: install them where you use these commands. The Python SDK uses only the standard library.
