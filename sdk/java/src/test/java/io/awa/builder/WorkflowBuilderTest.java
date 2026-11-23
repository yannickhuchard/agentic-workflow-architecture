package io.awa.builder;

import com.fasterxml.jackson.databind.JsonNode;
import io.awa.AwaDocuments;
import io.awa.model.AccessMode;
import io.awa.model.ActorType;
import io.awa.model.ContextBinding;
import io.awa.model.ContextType;
import io.awa.model.OutcomeContract;
import io.awa.model.RetryPolicy;
import io.awa.model.SyncPattern;
import io.awa.model.Tool;
import io.awa.model.ToolBinding;
import io.awa.model.Workflow;
import org.junit.jupiter.api.Test;

import java.util.List;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

class WorkflowBuilderTest {

    private static final UUID ROLE = UUID.fromString("55ac96fe-892b-5966-b1e9-20c336ab1b5b");

    @Test
    void targetsAwa11ByDefault() {
        Workflow workflow = WorkflowBuilder.workflow("w").activity("A", ROLE, ActorType.APPLICATION).build();
        assertEquals("1.1", workflow.getAwaVersion());
        assertEquals("1.0.0", workflow.getVersion());
        assertEquals("1.1", AwaDocuments.toTree(workflow).get("awa_version").asText());
    }

    @Test
    void awaVersionCanBeChangedOrLeftOut() {
        Workflow older = WorkflowBuilder.workflow("w").awaVersion("1.0").build();
        assertEquals("1.0", older.getAwaVersion());
        Workflow none = WorkflowBuilder.workflow("w").awaVersion(null).build();
        assertFalse(AwaDocuments.toTree(none).has("awa_version"));
    }

    @Test
    void existingMethodsStillBuildAConnectedWorkflow() {
        UUID owner = UUID.randomUUID();
        WorkflowBuilder builder = WorkflowBuilder.workflow("Orders", "2.1.0")
                .description("Order handling")
                .owner(owner)
                .context("order", ContextType.DATA, SyncPattern.SHARED_STATE)
                .activity("Receive", ROLE, ActorType.HUMAN)
                .activityWithSystem("Check", ROLE, ActorType.APPLICATION, UUID.randomUUID())
                .edge("Receive", "Check")
                .edge("Check", "Receive", "valid = false")
                .metadata("team", "ops");
        Workflow workflow = builder.build();

        assertEquals(2, workflow.getActivities().size());
        assertEquals(2, workflow.getEdges().size());
        assertEquals(builder.getActivity("Receive").getId(), workflow.getEdges().get(0).getSourceId());
        assertEquals("valid = false", workflow.getEdges().get(1).getCondition());
        assertEquals(workflow.getId(), builder.getContext("order").getOwnerWorkflowId());
        assertEquals(owner, workflow.getOwnerId());
        assertEquals("ops", workflow.getMetadata().get("team"));
        assertNotNull(workflow.getCreatedAt());
        // Lists that SDK 1.x initialised are still there to add to
        assertTrue(builder.getActivity("Receive").getInputs().isEmpty());
        assertTrue(workflow.getEvents().isEmpty());
        assertThrows(IllegalArgumentException.class, () -> builder.edge("Receive", "Missing"));
    }

    @Test
    void buildsTheNewActivityFields() {
        Tool lookup = Tool.builder()
                .name("lookup_customer")
                .description("Finds a customer by id")
                .binding(ToolBinding.Http.builder().method(ToolBinding.HttpMethod.GET)
                        .url("https://crm.example.com/customers/{id}").build())
                .timeout("PT10S")
                .build();
        Workflow workflow = WorkflowBuilder.workflow("Support")
                .context("case", ContextType.STATE, SyncPattern.BLACKBOARD)
                .activity("Answer", ROLE, ActorType.AI_AGENT)
                .procedure("Answer", "1. Read the case. 2. Reply.")
                .bindContext("Answer", "case", AccessMode.READ_WRITE)
                .bindContext("Answer", "case", AccessMode.READ, false,
                        ContextBinding.Transforms.builder().onRead("summary").build())
                .retry("Answer", RetryPolicy.builder().maxAttempts(3).initialDelay("PT2S")
                        .nonRetryableErrors(List.of("INVALID_INPUT")).build())
                .postcondition("Answer", "has reply", "reply != null")
                .tool("Answer", lookup)
                .tool("Answer", Tool.builder().name("notify")
                        .binding(ToolBinding.Mcp.builder().server("mail").tool("send").build()).build())
                .build();

        JsonNode activity = AwaDocuments.toTree(workflow).get("activities").get(0);
        assertEquals("1. Read the case. 2. Reply.", activity.get("procedure").asText());

        JsonNode bindings = activity.get("context_bindings");
        assertEquals(workflow.getContexts().get(0).getId().toString(), bindings.get(0).get("context_id").asText());
        assertEquals("read_write", bindings.get(0).get("access_mode").asText());
        assertFalse(bindings.get(0).has("required"), "the schema default is left implicit");
        assertFalse(bindings.get(1).get("required").asBoolean());
        assertEquals("summary", bindings.get(1).get("transforms").get("on_read").asText());

        assertEquals(3, activity.get("retry").get("max_attempts").asInt());
        assertEquals("INVALID_INPUT", activity.get("retry").get("non_retryable_errors").get(0).asText());

        JsonNode postcondition = activity.get("outcome_contract").get("postconditions").get(0);
        assertEquals("reply != null", postcondition.get("expression").asText());

        JsonNode tools = activity.get("tools");
        assertEquals("http", tools.get(0).get("binding").get("kind").asText());
        assertEquals("GET", tools.get(0).get("binding").get("method").asText());
        assertEquals("mcp", tools.get(1).get("binding").get("kind").asText());
        assertEquals("send", tools.get(1).get("binding").get("tool").asText());
    }

    @Test
    void outcomeContractAndDefaultEdge() {
        OutcomeContract contract = OutcomeContract.builder()
                .budgets(OutcomeContract.Budgets.builder().maxAttempts(4).maxToolCalls(8).maxDuration("PT1M").build())
                .onViolation(OutcomeContract.OnViolation.ESCALATE_HUMAN)
                .build();
        Workflow workflow = WorkflowBuilder.workflow("w")
                .activity("A", ROLE, ActorType.AI_AGENT)
                .activity("B", ROLE, ActorType.HUMAN)
                .outcomeContract("A", contract)
                .defaultEdge("A", "B")
                .build();
        JsonNode tree = AwaDocuments.toTree(workflow);
        assertEquals("escalate_human", tree.at("/activities/0/outcome_contract/on_violation").asText());
        assertEquals(8, tree.at("/activities/0/outcome_contract/budgets/max_tool_calls").asInt());
        assertTrue(tree.at("/edges/0/is_default").asBoolean());
        assertThrows(IllegalArgumentException.class, () -> WorkflowBuilder.workflow("w").retry("Missing", 2));
    }

    @Test
    void aBuiltWorkflowReadsBackEqual() {
        WorkflowBuilder builder = WorkflowBuilder.workflow("w");
        UUID role = builder.addRole("Agent", ActorType.AI_AGENT);
        Workflow workflow = builder
                .context("notes", ContextType.MEMORY, SyncPattern.EVENT_SOURCING)
                .activity("A", role, ActorType.AI_AGENT)
                .bindContext("A", "notes", AccessMode.WRITE)
                .tool("A", Tool.builder().name("run").binding(ToolBinding.Command.builder()
                        .command("echo").args(List.of("{text}")).build()).build())
                .retry("A", 2)
                .build();
        Workflow read = AwaDocuments.readWorkflow(AwaDocuments.writeWorkflow(workflow));
        assertEquals(workflow, read);
        assertEquals(role, read.getRoles().get(0).getId());
    }
}
