// Every bound the server puts on what an untrusted conversation can ask of it.
export const LIMITS = Object.freeze({
    /** One workflow or journey document, as JSON text */
    document_bytes: 400_000,
    /** A portfolio export (journeys with their records and run journals), as JSON text */
    portfolio_bytes: 900_000,
    /** Nesting depth of any JSON value in the arguments */
    json_depth: 48,
    workflows: 12,
    journeys: 6,
    /** Business events played in one simulation */
    events: 100,
    /** Engine steps in one run */
    steps: 400,
    /** Tokens alive or finished in one run */
    tokens: 200,
    /** Journal events returned for one run */
    journal_events: 4000,
    /** Wall-clock time of one simulation, in milliseconds */
    wall_ms: 8000,
    /** HTTP request body */
    http_body_bytes: 1_000_000,
    /** Problems reported by one validation */
    problems: 60,
});
