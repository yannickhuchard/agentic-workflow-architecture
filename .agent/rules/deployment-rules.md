---
trigger: always_on
---

DPLY-002: deploy assets sequentially to maximize success of deployment (not chained command in a single command line)
DPLY-003: deploy firebase function, or API function, one by one, using its name - never in bulk; Only deploy what has been changed.
DPLY-004: ALWAYS, for each deployed change, document clearly and briefly in understandble human language the nature of the change and you MUST indicate if breaking changes are introduces and you MUST indicate the date and time of the change in the release_notes.md file; Each record is on a single line in a tabular format (to display as a table)