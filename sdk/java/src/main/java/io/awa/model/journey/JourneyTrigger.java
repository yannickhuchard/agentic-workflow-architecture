package io.awa.model.journey;

import com.fasterxml.jackson.annotation.JsonProperty;
import io.awa.model.AwaObject;
import jakarta.validation.constraints.NotBlank;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.util.UUID;

/**
 * What a business event does to a journey (specification section 19.3).
 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class JourneyTrigger extends AwaObject {

    /** Business event type. */
    @NotBlank
    private String event;

    /** The event may begin a journey for a subject that has none. Schema default: false. */
    @JsonProperty("starts_journey")
    private Boolean startsJourney;

    @JsonProperty("enter_stage")
    private String enterStage;

    @JsonProperty("start_workflow")
    private UUID startWorkflow;
}
