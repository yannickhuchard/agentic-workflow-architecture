package io.awa;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import io.awa.model.Workflow;
import io.awa.model.WorkflowEnvelope;
import io.awa.model.journey.Journey;
import org.junit.jupiter.api.DynamicTest;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.TestFactory;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.util.ArrayList;
import java.util.Iterator;
import java.util.List;
import java.util.Map;
import java.util.stream.Stream;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.junit.jupiter.api.Assertions.fail;

/**
 * Reads every workflow and journey document of the repository into the Java types,
 * writes it back, and requires the result to equal the input as a JSON tree:
 * every {@code *.awa.json} and {@code *.journey.json} under {@code examples/}, the
 * {@code workflow} of every case in {@code spec/conformance/execution/}, and the
 * {@code workflows} and {@code journeys} of every case in {@code spec/conformance/journeys/}.
 */
class RoundTripTest {

    /** Parses without the SDK's settings, so the comparison does not depend on them. */
    private static final ObjectMapper PLAIN = new ObjectMapper();

    static Path repositoryRoot() {
        String configured = System.getProperty("awa.repository.root");
        Path root = configured != null ? Paths.get(configured) : Paths.get("../..");
        return root.toAbsolutePath().normalize();
    }

    record Document(String name, String kind, JsonNode tree) {
    }

    static List<Document> documents() throws IOException {
        Path root = repositoryRoot();
        List<Document> documents = new ArrayList<>();
        try (Stream<Path> files = Files.walk(root.resolve("examples"))) {
            for (Path file : files.sorted().toList()) {
                String fileName = file.getFileName().toString();
                String name = root.relativize(file).toString();
                if (fileName.endsWith(".awa.json")) {
                    documents.add(new Document(name, "workflow", PLAIN.readTree(file.toFile())));
                } else if (fileName.endsWith(".journey.json")) {
                    documents.add(new Document(name, "journey", PLAIN.readTree(file.toFile())));
                }
            }
        }
        for (Path file : jsonFiles(root.resolve("spec/conformance/execution"))) {
            JsonNode testCase = PLAIN.readTree(file.toFile());
            documents.add(new Document(root.relativize(file) + "#workflow", "workflow", testCase.get("workflow")));
        }
        for (Path file : jsonFiles(root.resolve("spec/conformance/journeys"))) {
            JsonNode testCase = PLAIN.readTree(file.toFile());
            JsonNode workflows = testCase.path("workflows");
            for (int i = 0; i < workflows.size(); i++) {
                documents.add(new Document(root.relativize(file) + "#workflows[" + i + "]", "workflow", workflows.get(i)));
            }
            JsonNode journeys = testCase.path("journeys");
            for (int i = 0; i < journeys.size(); i++) {
                documents.add(new Document(root.relativize(file) + "#journeys[" + i + "]", "journey", journeys.get(i)));
            }
        }
        return documents;
    }

    private static List<Path> jsonFiles(Path directory) throws IOException {
        try (Stream<Path> files = Files.list(directory)) {
            return files.filter(f -> f.toString().endsWith(".json")).sorted().toList();
        }
    }

    /** Reads the document into the types and writes it back. */
    static JsonNode roundTrip(Document document) throws IOException {
        String written;
        if (document.kind().equals("journey")) {
            Journey journey = AwaDocuments.readJourney(document.tree());
            written = AwaDocuments.writeJourney(journey);
        } else if (AwaDocuments.isEnvelope(document.tree())) {
            WorkflowEnvelope envelope = AwaDocuments.readEnvelope(document.tree());
            written = AwaDocuments.writeEnvelope(envelope);
        } else {
            Workflow workflow = AwaDocuments.readWorkflow(document.tree());
            written = AwaDocuments.writeWorkflow(workflow);
        }
        return PLAIN.readTree(written);
    }

    @TestFactory
    Stream<DynamicTest> everyDocumentRoundTrips() throws IOException {
        return documents().stream().map(document -> DynamicTest.dynamicTest(document.name(), () -> {
            JsonNode output = roundTrip(document);
            if (!document.tree().equals(output)) {
                fail("Round trip changed " + document.name() + ": " + firstDifference("$", document.tree(), output));
            }
        }));
    }

    @Test
    void theDocumentSetIsComplete() throws IOException {
        List<Document> documents = documents();
        long workflows = documents.stream().filter(d -> d.kind().equals("workflow")).count();
        long journeys = documents.stream().filter(d -> d.kind().equals("journey")).count();
        assertTrue(workflows > 100, "expected the conformance workflows, found " + workflows);
        assertTrue(journeys > 20, "expected the example and conformance journeys, found " + journeys);
        int equal = 0;
        List<String> changed = new ArrayList<>();
        for (Document document : documents) {
            if (document.tree().equals(roundTrip(document))) {
                equal++;
            } else {
                changed.add(document.name());
            }
        }
        System.out.printf("AWA round trip: %d documents (%d workflows, %d journeys), %d equal%n",
                documents.size(), workflows, journeys, equal);
        assertEquals(List.of(), changed);
    }

    /** A description of the first place where two trees differ. */
    static String firstDifference(String path, JsonNode expected, JsonNode actual) {
        if (expected.equals(actual)) {
            return null;
        }
        if (expected.isObject() && actual.isObject()) {
            Iterator<Map.Entry<String, JsonNode>> fields = expected.fields();
            while (fields.hasNext()) {
                Map.Entry<String, JsonNode> field = fields.next();
                if (!actual.has(field.getKey())) {
                    return path + "." + field.getKey() + " was dropped";
                }
                String inner = firstDifference(path + "." + field.getKey(), field.getValue(), actual.get(field.getKey()));
                if (inner != null) {
                    return inner;
                }
            }
            Iterator<String> names = actual.fieldNames();
            while (names.hasNext()) {
                String name = names.next();
                if (!expected.has(name)) {
                    return path + "." + name + " was added: " + actual.get(name);
                }
            }
        }
        if (expected.isArray() && actual.isArray() && expected.size() == actual.size()) {
            for (int i = 0; i < expected.size(); i++) {
                String inner = firstDifference(path + "[" + i + "]", expected.get(i), actual.get(i));
                if (inner != null) {
                    return inner;
                }
            }
        }
        return path + ": expected " + expected + " (" + expected.getNodeType() + ") but was " + actual
                + " (" + actual.getNodeType() + ")";
    }

}
