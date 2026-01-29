---
trigger: always_on
---

UI-001: When an UI action is to delete something (note, CV, picture, etc.), the confirmation pattern MUST be a modal in the UI framework technology (using the design style of the application) - NOT the basic HTML alert.
UI-002: Modularize the Web Components fulfilling a function to one Webcomponent per source code file to isolate it and maintain the code in an easier and sustainable way. 
UI-003: do not use native alert, use Modals for alerts from the ShadCN UI library using the design style of the platform
UI-004: DO NOT change an existing UI unless it is explicitly requested by the user. The goal is to build incrementally, in a stable manner and avoid the AI model to change the visual aspect of the UI if it has not been explicitly requested. In case of doubt, ask the user.
UI-005: All pages MUST follow and reuse the same design system (color schemes, icon styles, fonts, animation style, motion design style, effects, layout, transitions, etc.) to ensure homogeneity of the user experience. Do not neither introduce nor invent UI design style unless it is explicitly requested by the user.
UI-006: Enforce typed data in UI components wherever possible to ensure data quality from the data capture (i.e. bind it to existing reference data & typed data)