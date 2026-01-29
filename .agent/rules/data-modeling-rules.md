---
trigger: always_on
---

DM-001: always perform data model first in the folder /datamodel
DM-002: data model is model in a Entity Relationship format
DM-003: use DDL for Postgresql database to instanciate the data model in a SQL format
DM-004: use JSON Schema to instantiate the data model for API and code
DM-005: for dates use Datetime with Timezone, unless it is explicitly specified otherwise
DM-006: data entities always have an id