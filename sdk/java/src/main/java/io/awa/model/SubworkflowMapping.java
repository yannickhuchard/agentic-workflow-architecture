package io.awa.model;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.util.Map;

/**
 * How a call activity's child run is given its input and how its output becomes the
 * activity's outcome (specification 24.1, {@code activity.schema.json} property {@code subworkflow}).
 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class SubworkflowMapping extends AwaObject {

    /** Each property of the child run's input, with the path in the parent token's data it is read from. */
    private Map<String, String> input;

    /** Each property of the activity's outcome, with the path in the child run's output it is read from. */
    private Map<String, String> output;
}
