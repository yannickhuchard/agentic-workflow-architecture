package io.awa.model;

import com.fasterxml.jackson.annotation.JsonAnyGetter;
import com.fasterxml.jackson.annotation.JsonAnySetter;
import com.fasterxml.jackson.annotation.JsonAutoDetect;
import com.fasterxml.jackson.annotation.JsonIgnore;
import com.fasterxml.jackson.annotation.JsonInclude;
import lombok.EqualsAndHashCode;
import lombok.ToString;

import java.util.LinkedHashMap;
import java.util.Map;

/**
 * Base class of every object in an AWA document.
 *
 * <p>Specification section 4.4 requires a processor to preserve properties it does not
 * recognise when it rewrites a document. Every AWA type therefore keeps the properties
 * it does not model in {@link #getAdditionalProperties()}: they are collected when a
 * document is read and written back, after the modelled properties, when it is written.
 * Extension properties such as {@code "acme:cost_centre"} survive a round trip this way.
 *
 * <p>Jackson binds the fields of AWA types directly; getters and setters are not used
 * for serialization. A property that is absent from a document is {@code null} in
 * Java and is not written, so a document is written back with the properties it had,
 * and the schema default applies to those it lacks.
 */
@JsonAutoDetect(
        fieldVisibility = JsonAutoDetect.Visibility.ANY,
        getterVisibility = JsonAutoDetect.Visibility.NONE,
        isGetterVisibility = JsonAutoDetect.Visibility.NONE,
        setterVisibility = JsonAutoDetect.Visibility.NONE,
        creatorVisibility = JsonAutoDetect.Visibility.NONE)
@JsonInclude(JsonInclude.Include.NON_NULL)
@EqualsAndHashCode(callSuper = false)
@ToString(callSuper = false)
public abstract class AwaObject {

    @JsonIgnore
    private final Map<String, Object> additionalProperties = new LinkedHashMap<>();

    /**
     * Properties of this object that the data model does not define, in the order they
     * were read. The map is live: entries put into it are written with the object.
     */
    @JsonAnyGetter
    public Map<String, Object> getAdditionalProperties() {
        return additionalProperties;
    }

    @JsonAnySetter
    public void setAdditionalProperty(String name, Object value) {
        additionalProperties.put(name, value);
    }

    /** The value of a property the data model does not define, or {@code null}. */
    public Object getAdditionalProperty(String name) {
        return additionalProperties.get(name);
    }
}
