package io.awa;

import io.awa.model.AwaObject;
import org.junit.jupiter.api.Test;

import java.lang.reflect.Field;
import java.lang.reflect.Modifier;
import java.util.Collection;
import java.util.IdentityHashMap;
import java.util.Map;
import java.util.Set;
import java.util.TreeMap;
import java.util.TreeSet;

import static org.junit.jupiter.api.Assertions.assertEquals;

/**
 * Checks that the round trip owes nothing to the catch-all for unknown properties where
 * the specification defines a property: every property of the repository's documents is
 * bound to a field, except those listed here, which no schema defines.
 */
class ModelCoverageTest {

    /** Properties found in the documents that the JSON Schemas do not define, by owning type. */
    private static final Map<String, Set<String>> NOT_IN_THE_SCHEMAS = Map.of(
            "Workflow", Set.of("$schema"));

    @Test
    void everySpecifiedPropertyIsModelled() throws Exception {
        Map<String, Set<String>> unmodelled = new TreeMap<>();
        for (RoundTripTest.Document document : RoundTripTest.documents()) {
            Object read = document.kind().equals("journey")
                    ? AwaDocuments.readJourney(document.tree())
                    : AwaDocuments.isEnvelope(document.tree())
                    ? AwaDocuments.readEnvelope(document.tree())
                    : AwaDocuments.readWorkflow(document.tree());
            collect(read, unmodelled, new IdentityHashMap<>());
        }
        Map<String, Set<String>> expected = new TreeMap<>();
        NOT_IN_THE_SCHEMAS.forEach((type, names) -> expected.put(type, new TreeSet<>(names)));
        assertEquals(expected, unmodelled);
    }

    private static void collect(Object value, Map<String, Set<String>> found, IdentityHashMap<Object, Boolean> seen)
            throws IllegalAccessException {
        if (value == null || seen.put(value, Boolean.TRUE) != null) {
            return;
        }
        if (value instanceof Collection<?> collection) {
            for (Object item : collection) {
                collect(item, found, seen);
            }
            return;
        }
        if (!(value instanceof AwaObject object)) {
            return;
        }
        if (!object.getAdditionalProperties().isEmpty()) {
            String type = value.getClass().getName().replaceFirst("^.*\\.", "");
            found.computeIfAbsent(type, k -> new TreeSet<>()).addAll(object.getAdditionalProperties().keySet());
        }
        for (Class<?> c = value.getClass(); c != AwaObject.class; c = c.getSuperclass()) {
            for (Field field : c.getDeclaredFields()) {
                if (Modifier.isStatic(field.getModifiers())) {
                    continue;
                }
                field.setAccessible(true);
                collect(field.get(value), found, seen);
            }
        }
    }
}
