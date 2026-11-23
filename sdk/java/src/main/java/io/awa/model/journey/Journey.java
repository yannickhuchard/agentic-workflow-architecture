package io.awa.model.journey;

import com.fasterxml.jackson.annotation.JsonProperty;
import io.awa.model.AwaObject;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotEmpty;
import jakarta.validation.constraints.NotNull;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.util.List;
import java.util.UUID;

/**
 * A journey document: the longer story that workflow runs belong to, one subject moving
 * through stages, driven by business events (specification section 19,
 * {@code journey.schema.json}). A journey is a separate document from the workflows
 * whose runs it follows.
 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class Journey extends AwaObject {

    @NotNull
    private UUID id;

    @NotBlank
    private String name;

    /** Semantic version of this journey. */
    @NotBlank
    private String version;

    @JsonProperty("awa_version")
    private String awaVersion;

    private String description;

    /** Whose journey it is. */
    @NotNull
    private JourneySubject subject;

    @NotEmpty
    private List<JourneyStage> stages;

    /** What a business event does to the journey. */
    private List<JourneyTrigger> triggers;

    /** Outcomes worth tracking, each true or false of the journey's data. */
    private List<JourneyGoal> goals;

    /** Events that end the journey early. */
    private List<JourneyExit> exits;

    /** Run data properties copied into the journey's data when a run ends. Absent: all. */
    private List<String> collect;

    /** The kinds of thing that change hands (section 19.8). */
    private List<JourneyArtefact> artefacts;

    /** The moments of contact (section 19.8). */
    private List<Touchpoint> touchpoints;

    /** How the subject's mood is estimated (section 19.9). */
    private Sentiment sentiment;
}
