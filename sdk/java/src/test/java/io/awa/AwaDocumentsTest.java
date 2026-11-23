package io.awa;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import io.awa.model.ActorType;
import io.awa.model.DecisionNode;
import io.awa.model.EventDefinition;
import io.awa.model.EventType;
import io.awa.model.ToolBinding;
import io.awa.model.Workflow;
import io.awa.model.WorkflowEnvelope;
import io.awa.model.journey.Journey;
import io.awa.model.journey.Sentiment;
import io.awa.model.journey.Touchpoint;
import org.junit.jupiter.api.Test;

import java.math.BigDecimal;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertInstanceOf;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

class AwaDocumentsTest {

    private static final ObjectMapper PLAIN = new ObjectMapper();

    private static final String WORKFLOW = """
            {
              "id": "9de0062a-77f7-5ab6-b76b-e007f4d82180",
              "name": "w", "version": "1.0.0", "awa_version": "1.1",
              "acme:cost_centre": "CC-12",
              "activities": [{
                "id": "ae5dfd28-2e22-53c2-be4a-915b5ec2889b", "name": "A",
                "role_id": "55ac96fe-892b-5966-b1e9-20c336ab1b5b", "actor_type": "ai_agent",
                "acme:owner": {"team": "claims", "weights": [1, 2.50, 1e3]},
                "tools": [{"name": "price", "binding": {"kind": "grpc", "endpoint": "pricing:443",
                           "service": "Pricing", "method": "Quote", "acme:tls": true}}],
                "verification": {"criteria": [{"id": "3511990c-8474-5c0e-b65e-96203715b0b0", "name": "c",
                                 "description": "d", "type": "format"}], "pass_threshold": 0.90}
              }],
              "edges": [],
              "events": [{"id": "114b52ad-222a-5ba6-8813-6290d856effa", "name": "Wait", "event_type": "message",
                          "event_definition": {"name": "documents.uploaded", "mode": "wait",
                                               "correlation_key": "claim_id", "timeout": "P14D",
                                               "acme:topic": "docs"}}],
              "decision_nodes": [{"id": "0b8bd1c2-3e47-5a43-a34d-2f1e9b0b4c11", "name": "Route",
                "decision_engine": {"name": "drools", "options": [{"id": "pay",
                                    "output_edge_id": "114b52ad-222a-5ba6-8813-6290d856effa"}]}}]
            }
            """;

    @Test
    void unknownPropertiesSurviveAtEveryLevel() throws Exception {
        Workflow workflow = AwaDocuments.readWorkflow(WORKFLOW);
        assertEquals("CC-12", workflow.getAdditionalProperty("acme:cost_centre"));
        assertTrue(workflow.getActivities().get(0).getAdditionalProperties().containsKey("acme:owner"));
        ToolBinding binding = workflow.getActivities().get(0).getTools().get(0).getBinding();
        assertEquals(Boolean.TRUE, binding.getAdditionalProperty("acme:tls"));
        assertEquals("docs", workflow.getEvents().get(0).getEventDefinition().getAdditionalProperty("acme:topic"));

        JsonNode written = PLAIN.readTree(AwaDocuments.writeWorkflow(workflow));
        assertEquals(PLAIN.readTree(WORKFLOW), written);
    }

    @Test
    void numbersAreWrittenAsTheyWereRead() throws Exception {
        Workflow workflow = AwaDocuments.readWorkflow(WORKFLOW);
        assertEquals(new BigDecimal("0.90"), workflow.getActivities().get(0).getVerification().getPassThreshold());
        String written = AwaDocuments.writeWorkflow(workflow);
        assertTrue(written.contains("0.90"), written);
        assertTrue(written.contains("2.50"), written);
    }

    @Test
    void typedFieldsAreBound() {
        Workflow workflow = AwaDocuments.readWorkflow(WORKFLOW);
        assertEquals(ActorType.AI_AGENT, workflow.getActivities().get(0).getActorType());
        ToolBinding.Grpc grpc = assertInstanceOf(ToolBinding.Grpc.class,
                workflow.getActivities().get(0).getTools().get(0).getBinding());
        assertEquals("Quote", grpc.getMethod());
        assertEquals("grpc", grpc.kind());
        assertEquals(EventType.MESSAGE, workflow.getEvents().get(0).getEventType());
        EventDefinition definition = workflow.getEvents().get(0).getEventDefinition();
        assertEquals(EventDefinition.Mode.WAIT, definition.getMode());
        assertEquals("claim_id", definition.getCorrelationKey());
        DecisionNode.DecisionEngine engine = workflow.getDecisionNodes().get(0).getDecisionEngine();
        assertEquals("pay", engine.getOptions().get(0).getId());
        assertNull(workflow.getContexts(), "an absent list stays absent");
    }

    @Test
    void bothDocumentFormsAreRead() {
        String envelope = "{\"$schema\": \"https://awa.io/schema/awa.schema.json\", \"workflow\": " + WORKFLOW + "}";
        assertEquals("w", AwaDocuments.readWorkflow(envelope).getName());
        WorkflowEnvelope read = AwaDocuments.readEnvelope(envelope);
        assertEquals("https://awa.io/schema/awa.schema.json", read.getSchema());
        assertEquals(AwaDocuments.readWorkflow(WORKFLOW), read.getWorkflow());
        assertThrows(IllegalArgumentException.class, () -> AwaDocuments.readEnvelope(WORKFLOW));
    }

    @Test
    void badDocumentsAreRefused() {
        assertThrows(AwaDocuments.AwaDocumentException.class, () -> AwaDocuments.readWorkflow("{"));
        assertThrows(AwaDocuments.AwaDocumentException.class,
                () -> AwaDocuments.readWorkflow(WORKFLOW.replace("\"ai_agent\"", "\"wizard\"")));
        assertThrows(AwaDocuments.AwaDocumentException.class,
                () -> AwaDocuments.readWorkflow(WORKFLOW.replace("\"kind\": \"grpc\"", "\"kind\": \"carrier-pigeon\"")));
        assertThrows(AwaDocuments.AwaDocumentException.class, () -> AwaDocuments.readWorkflow("[]"));
    }

    @Test
    void journeysAreRead() {
        Journey journey = AwaDocuments.readJourney("""
                {"id": "6f1f0d3e-3c1b-5d1e-9a51-6c1f6f0f1a2b", "name": "Claim", "version": "1.0.0",
                 "subject": {"name": "customer", "key": "customer_id"},
                 "stages": [{"id": "open", "name": "Open", "owner": "claims-team", "max_duration": "P3D"}],
                 "touchpoints": [{"id": "form", "name": "Claim form", "direction": "inbound", "channel": "web",
                                  "on": {"event": "claim.reported"}, "exchanges": [{"artefact": "claim-form"}]}],
                 "sentiment": {"min": -2, "max": 2, "rules": [{"on": "waited", "longer_than": "P2D", "change": -1}]}}
                """);
        assertEquals("claims-team", journey.getStages().get(0).getOwner());
        assertEquals("P3D", journey.getStages().get(0).getMaxDuration());
        assertEquals(Touchpoint.Direction.INBOUND, journey.getTouchpoints().get(0).getDirection());
        assertEquals(Sentiment.Occasion.WAITED, journey.getSentiment().getRules().get(0).getOn());
        assertEquals(0, new BigDecimal(-1).compareTo(journey.getSentiment().getRules().get(0).getChange()));
        assertEquals(Map.of(), journey.getAdditionalProperties());
    }

    @Test
    void visualizationsAreKept() throws Exception {
        String json = """
                {"id": "9de0062a-77f7-5ab6-b76b-e007f4d82180", "name": "w", "version": "1.0.0",
                 "activities": [], "edges": [],
                 "visualization": {"id": "a1b2c3d4-0001-4000-8000-000000000001",
                   "workflow_id": "9de0062a-77f7-5ab6-b76b-e007f4d82180", "view_type": "2d", "engine": "reactflow",
                   "is_default": true,
                   "auto_layout": {"algorithm": "elk", "direction": "lr", "node_spacing": 60},
                   "node_positions_2d": [{"node_id": "ae5dfd28-2e22-53c2-be4a-915b5ec2889b", "node_type": "activity",
                                          "position": {"x": 10, "y": 20.5}, "z_index": 2, "shape": "rounded"}],
                   "camera_3d": {"type": "arc_rotate", "fov": 45},
                   "theme": {"background_color": "#FFFFFF", "font": "Inter"},
                   "created_at": "2026-01-01T00:00:00.000Z"},
                 "alternate_visualizations": [{"id": "a1b2c3d4-0001-4000-8000-000000000002",
                   "workflow_id": "9de0062a-77f7-5ab6-b76b-e007f4d82180", "view_type": "3d"}]}
                """;
        Workflow workflow = AwaDocuments.readWorkflow(json);
        assertEquals(2, workflow.getVisualization().getNodePositions2d().get(0).getZIndex());
        assertEquals("Inter", workflow.getVisualization().getTheme().getAdditionalProperty("font"));
        assertEquals(PLAIN.readTree(json), PLAIN.readTree(AwaDocuments.writeWorkflow(workflow)));
    }
}
