// The bundled claims example: six customers through three journeys (purchase,
// claim, renewal), from examples/claims-journey. Read-only files of this repository.
import fs from 'node:fs';
import path from 'node:path';
import { EXAMPLE_DIR, REPOSITORY_ROOT } from './sdk.js';

const read = file => JSON.parse(fs.readFileSync(file, 'utf8'));

/** The documents of the example, by the name a caller may ask for */
export const EXAMPLE_DOCUMENTS = {
    'policy-purchase.journey': path.join(EXAMPLE_DIR, 'policy-purchase.journey.json'),
    'motor-claim.journey': path.join(EXAMPLE_DIR, 'motor-claim.journey.json'),
    'policy-renewal.journey': path.join(EXAMPLE_DIR, 'policy-renewal.journey.json'),
    'policy-purchase.workflow': path.join(EXAMPLE_DIR, 'policy-purchase.awa.json'),
    'claim-intake.workflow': path.join(EXAMPLE_DIR, 'claim-intake.awa.json'),
    'claims-settlement.workflow': path.join(REPOSITORY_ROOT, 'examples/claims-settlement/claims-settlement.awa.json'),
    'customer-follow-up.workflow': path.join(EXAMPLE_DIR, 'customer-follow-up.awa.json'),
    'policy-renewal.workflow': path.join(EXAMPLE_DIR, 'policy-renewal.awa.json'),
    /** What each activity returns in a simulation of these workflows */
    'simulated-outputs': path.join(EXAMPLE_DIR, 'simulation.json'),
    'claims-settlement.simulated-outputs': path.join(REPOSITORY_ROOT, 'examples/claims-settlement/simulation.json'),
};

let story;
/** The example's story as examples/claims-journey/make-story.mjs wrote it, with its hand-made layouts and sentences */
export function example_story() {
    if (!story) story = read(path.join(EXAMPLE_DIR, 'story.json'));
    return story;
}
export const example_document = name => read(EXAMPLE_DOCUMENTS[name]);
