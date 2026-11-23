package io.awa.model.journey;

import io.awa.model.AwaObject;
import jakarta.validation.constraints.NotBlank;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

/**
 * Whose journey it is, and the property that identifies the subject in event data and run data.
 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class JourneySubject extends AwaObject {

    /** What the subject is, e.g. {@code customer}. */
    @NotBlank
    private String name;

    /** The property that identifies the subject, e.g. {@code customer_id}. */
    @NotBlank
    private String key;
}
