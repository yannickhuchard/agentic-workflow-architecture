package io.awa.model;

import com.fasterxml.jackson.annotation.JsonProperty;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

/**
 * The envelope form of an AWA document (specification section 4.1): an object whose
 * {@code workflow} property holds the workflow. Other properties of the envelope, such as
 * {@code collection}, are kept in {@link #getAdditionalProperties()}.
 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class WorkflowEnvelope extends AwaObject {

    @JsonProperty("$schema")
    private String schema;

    private Workflow workflow;
}
