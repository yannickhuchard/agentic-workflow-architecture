# AWA Java SDK

A Java data model for documents of the Agentic Workflow Architecture (AWA), specification 1.1:
types to read, build and write workflows and journeys. Version 2.0.0, in step with the
TypeScript and Python SDKs.

The SDK has no engine. It does not run workflows, evaluate conditions, call models or tools,
or host journeys. It does not validate documents against the JSON Schemas or check their
integrity (specification section 4.3) either. Use the TypeScript or Python SDK for those.

## What it contains

| Package | Contents |
|---|---|
| `io.awa` | `AwaDocuments`: read and write workflow documents (workflow form and envelope form, section 4.1) and journey documents |
| `io.awa.model` | `Workflow`, `WorkflowEnvelope`, `Role`, `Activity`, `Edge`, `Event` and `EventDefinition`, `DecisionNode` (decision tables, decision models, external decision engines), `Context`, `ContextBinding`, `SLA`, `Analytics`, `VerificationPolicy`, `RetryPolicy`, `OutcomeContract`, `Tool` and `ToolBinding` (http, command, jsonrpc, grpc, mcp, function), `KnowledgeBinding`, `SkillBinding`, `ToolRequirement`, and their enums |
| `io.awa.model.journey` | `Journey` and its parts: `JourneySubject`, `JourneyStage`, `JourneyTrigger`, `JourneyGoal`, `JourneyExit`, `JourneyArtefact`, `Touchpoint`, `Sentiment` |
| `io.awa.model.visualization` | `VisualizationConfig`, the `visualization` and `alternate_visualizations` of a workflow |
| `io.awa.builder` | `WorkflowBuilder`, to build a workflow by hand |

JSON property names are those of the specification (snake_case). Java names are camelCase.

## Reading and writing

```java
Workflow workflow = AwaDocuments.readWorkflow(Path.of("order-processing.awa.json"));
Journey journey = AwaDocuments.readJourney(Path.of("motor-claim.journey.json"));

String json = AwaDocuments.writeWorkflow(workflow);
```

A document is written back as it was read:

- A property that is absent from the document is `null` in Java and is not written. The
  schema default applies to it; the SDK does not fill defaults in.
- Properties the types do not define, such as extension properties like `acme:cost_centre`
  (section 4.4), are kept in `getAdditionalProperties()` of the object they belong to and
  are written back.
- Decimal numbers are `BigDecimal` and are written with the digits they were read with.
  Timestamps and durations are strings, written unchanged.
- Identifiers are `java.util.UUID`. A UUID written in upper case is written back in lower case.

Reading fails with `AwaDocuments.AwaDocumentException` on JSON that cannot be bound to the
types: an enum value the specification does not define, an identifier that is not a UUID,
or a tool binding of an unknown `kind`.

## Building

```java
WorkflowBuilder builder = WorkflowBuilder.workflow("Support", "1.0.0");
UUID agent = builder.addRole("Support agent", ActorType.AI_AGENT);
Workflow workflow = builder
        .context("case", ContextType.STATE, SyncPattern.BLACKBOARD)
        .activity("Answer", agent, ActorType.AI_AGENT)
        .bindContext("Answer", "case", AccessMode.READ_WRITE)
        .retry("Answer", 3)
        .postcondition("Answer", "has a reply", "reply != null")
        .tool("Answer", Tool.builder()
                .name("lookup_customer")
                .binding(ToolBinding.Http.builder().url("https://crm.example.com/customers/{id}").build())
                .build())
        .build();
```

The built workflow has `awa_version` `"1.1"` unless `awaVersion(...)` says otherwise. The
methods of the 1.x builder are unchanged.

## Changes from 1.x

- Absent properties are `null` instead of empty lists or defaults, except in workflows made
  by `WorkflowBuilder`, which initialises the same lists as before.
- `created_at` and `updated_at` are strings instead of `OffsetDateTime`.
- Decimal numbers are `BigDecimal` instead of `Double`.
- `Event.eventDefinition` is an `EventDefinition` instead of a map.
- Enums are written with the specification's values (`ai_agent`, not `AI_AGENT`).

## Build and test

Requires Java 17 or later and Maven.

```sh
cd sdk/java
mvn test
```

The tests read every `*.awa.json` and `*.journey.json` under `examples/`, the workflow of
every case in `spec/conformance/execution/`, and the workflows and journeys of every case in
`spec/conformance/journeys/`, write each back, and require the result to equal the input as
a JSON tree. They read these files from the repository, so run them from a checkout.
