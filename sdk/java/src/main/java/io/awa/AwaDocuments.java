package io.awa;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.DeserializationFeature;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.SerializationFeature;
import com.fasterxml.jackson.databind.cfg.JsonNodeFeature;
import com.fasterxml.jackson.databind.json.JsonMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import io.awa.model.Workflow;
import io.awa.model.WorkflowEnvelope;
import io.awa.model.journey.Journey;

import java.io.IOException;
import java.io.InputStream;
import java.io.UncheckedIOException;
import java.nio.file.Files;
import java.nio.file.Path;

/**
 * Reads and writes AWA documents: workflows (specification section 4) and journeys
 * (section 19).
 *
 * <p>A workflow document comes in two forms (section 4.1). In the workflow form the
 * object is the workflow; in the envelope form it has a {@code workflow} property and no
 * {@code activities} of its own. {@link #readWorkflow(String)} accepts both and returns
 * the workflow; {@link #readEnvelope(String)} keeps the envelope.
 *
 * <p>Reading does not validate a document against the JSON Schemas or check its
 * integrity (section 4.3); it fails only on JSON that cannot be bound to the types, for
 * example an unknown enum value or an identifier that is not a UUID. Properties the types
 * do not define are kept and written back (section 4.4).
 */
public final class AwaDocuments {

    private static final ObjectMapper MAPPER = JsonMapper.builder()
            .enable(SerializationFeature.INDENT_OUTPUT)
            .disable(SerializationFeature.FAIL_ON_EMPTY_BEANS)
            // Keep decimal numbers exactly as written, in typed fields and in free-form values
            .enable(DeserializationFeature.USE_BIG_DECIMAL_FOR_FLOATS)
            .disable(JsonNodeFeature.STRIP_TRAILING_BIGDECIMAL_ZEROES)
            .build();

    private AwaDocuments() {
    }

    /**
     * The mapper used to read and write documents. It is shared: copy it with
     * {@link ObjectMapper#copy()} before changing its configuration.
     */
    public static ObjectMapper mapper() {
        return MAPPER;
    }

    // ------------------------------------------------------------------ workflows

    /** Reads a workflow from a document in workflow form or envelope form. */
    public static Workflow readWorkflow(String json) {
        return readWorkflow(parse(json));
    }

    public static Workflow readWorkflow(Path file) {
        return readWorkflow(parse(file));
    }

    public static Workflow readWorkflow(InputStream in) {
        return readWorkflow(parse(in));
    }

    public static Workflow readWorkflow(JsonNode document) {
        JsonNode workflow = isEnvelope(document) ? document.get("workflow") : document;
        return convert(workflow, Workflow.class);
    }

    /** Reads a document in envelope form. */
    public static WorkflowEnvelope readEnvelope(String json) {
        return readEnvelope(parse(json));
    }

    public static WorkflowEnvelope readEnvelope(Path file) {
        return readEnvelope(parse(file));
    }

    public static WorkflowEnvelope readEnvelope(JsonNode document) {
        if (!isEnvelope(document)) {
            throw new IllegalArgumentException("Not an envelope: the document has no 'workflow' object, or has 'activities'");
        }
        return convert(document, WorkflowEnvelope.class);
    }

    /**
     * Whether a document is in envelope form: an object with a {@code workflow} object
     * and no {@code activities} property.
     */
    public static boolean isEnvelope(JsonNode document) {
        return document != null && document.isObject()
                && document.path("workflow").isObject()
                && !document.has("activities");
    }

    /** Writes a workflow in workflow form, indented. */
    public static String writeWorkflow(Workflow workflow) {
        return write(workflow);
    }

    public static void writeWorkflow(Workflow workflow, Path file) {
        write(workflow, file);
    }

    public static String writeEnvelope(WorkflowEnvelope envelope) {
        return write(envelope);
    }

    // ------------------------------------------------------------------ journeys

    public static Journey readJourney(String json) {
        return readJourney(parse(json));
    }

    public static Journey readJourney(Path file) {
        return readJourney(parse(file));
    }

    public static Journey readJourney(InputStream in) {
        return readJourney(parse(in));
    }

    public static Journey readJourney(JsonNode document) {
        return convert(document, Journey.class);
    }

    public static String writeJourney(Journey journey) {
        return write(journey);
    }

    public static void writeJourney(Journey journey, Path file) {
        write(journey, file);
    }

    // ------------------------------------------------------------------ trees

    /** The JSON tree of a workflow, journey, envelope or any other AWA object. */
    public static ObjectNode toTree(Object document) {
        return MAPPER.valueToTree(document);
    }

    // ------------------------------------------------------------------ internals

    private static JsonNode parse(String json) {
        try {
            return MAPPER.readTree(json);
        } catch (JsonProcessingException e) {
            throw new AwaDocumentException("Not valid JSON: " + e.getOriginalMessage(), e);
        }
    }

    private static JsonNode parse(Path file) {
        try (InputStream in = Files.newInputStream(file)) {
            return MAPPER.readTree(in);
        } catch (JsonProcessingException e) {
            throw new AwaDocumentException(file + " is not valid JSON: " + e.getOriginalMessage(), e);
        } catch (IOException e) {
            throw new UncheckedIOException(e);
        }
    }

    private static JsonNode parse(InputStream in) {
        try {
            return MAPPER.readTree(in);
        } catch (JsonProcessingException e) {
            throw new AwaDocumentException("Not valid JSON: " + e.getOriginalMessage(), e);
        } catch (IOException e) {
            throw new UncheckedIOException(e);
        }
    }

    private static <T> T convert(JsonNode node, Class<T> type) {
        if (node == null || !node.isObject()) {
            throw new AwaDocumentException("A " + type.getSimpleName() + " document must be a JSON object", null);
        }
        try {
            return MAPPER.treeToValue(node, type);
        } catch (JsonProcessingException e) {
            throw new AwaDocumentException("Cannot read " + type.getSimpleName() + ": " + e.getOriginalMessage()
                    + " at " + e.getLocation(), e);
        }
    }

    private static String write(Object value) {
        try {
            return MAPPER.writeValueAsString(value);
        } catch (JsonProcessingException e) {
            throw new AwaDocumentException("Cannot write " + value.getClass().getSimpleName() + ": " + e.getOriginalMessage(), e);
        }
    }

    private static void write(Object value, Path file) {
        try {
            Files.writeString(file, write(value) + System.lineSeparator());
        } catch (IOException e) {
            throw new UncheckedIOException(e);
        }
    }

    /** A document that is not JSON, or that cannot be bound to the AWA types. */
    public static final class AwaDocumentException extends RuntimeException {
        public AwaDocumentException(String message, Throwable cause) {
            super(message, cause);
        }
    }
}
