package io.awa.model.journey;

import com.fasterxml.jackson.annotation.JsonProperty;
import io.awa.model.AwaObject;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

/**
 * A business event that ends a journey early.
 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class JourneyExit extends AwaObject {

    @NotBlank
    private String event;

    @NotNull
    private Outcome outcome;

    private String reason;

    public enum Outcome {
        @JsonProperty("completed") COMPLETED,
        @JsonProperty("abandoned") ABANDONED
    }
}
