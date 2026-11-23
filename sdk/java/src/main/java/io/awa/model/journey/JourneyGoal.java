package io.awa.model.journey;

import io.awa.model.AwaObject;
import jakarta.validation.constraints.NotBlank;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

/**
 * An outcome worth tracking: a condition expression over the journey's data.
 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class JourneyGoal extends AwaObject {

    @NotBlank
    private String id;

    @NotBlank
    private String name;

    @NotBlank
    private String expression;
}
