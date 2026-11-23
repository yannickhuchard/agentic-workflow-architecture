package io.awa.model.journey;

import io.awa.model.AwaObject;
import jakarta.validation.constraints.NotBlank;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

/**
 * A kind of thing that changes hands in the journey, named as the business names it
 * (specification section 19.8).
 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class JourneyArtefact extends AwaObject {

    /** Pattern {@code ^[a-z0-9][a-z0-9_-]{0,63}$}. */
    @NotBlank
    private String id;

    @NotBlank
    private String name;

    /**
     * A business concept, not a file format. An open vocabulary; recommended values are
     * contract, attestation, invoice, receipt, certificate, quote, form, evidence, notice,
     * order, report and survey.
     */
    @NotBlank
    private String kind;

    private String description;
}
