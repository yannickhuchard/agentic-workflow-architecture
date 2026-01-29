---
trigger: always_on
---

CODING-01: always use snake case for all data attributes, function names and variable names for consistency (where applicable and do not mix with camelCase).
CODING-02: Use a configuration file to store the global variables and the elements that must/should be configurable, and reuse configuration variable at all occasions.
CODING-03: Use explicit and non-ambiguous configuration variable names.
CODING-04: Avoid to use "Any" type in Typescript where possible
CODING-05: modularize as much as possible the functions in dedicated files (for each) to increase the maintainability of the code.
CODING-06: Each Feature (defined functional scope in the app) MUST be isolated/modularized in a dedicated directory so that when the code is touched/updated, it focuses the changes in focused location.
CODING-07: IMPORTANT!!! This platform is deployed in production therefore any breaking change in the data model will imply data migration --> avoid as much as possible, but if it is necessary: 1) assess the nature of the breaking change, 2) ask the confirmation to the user first detailing exactly the nature of the breaking change prior to changing the data model, 3) alsways document clearly the nature of the breaking change in the release_notes.md
CODING-08: when implementing, forese each step of the e2e flow to ensure full success of implementation.