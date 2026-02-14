# Release Notes

## [1.0.1] - 2026-02-14

### New Features
- **Workflow Cost Tracking**: Implemented comprehensive cost tracking for workflow executions.
    - AI Token tracking (Input/Output tokens) using Gemini `usageMetadata`.
    - Generic cost calculation for Human (hourly), Robot (hourly), and Application (per execution) actors.
    - `WorkflowExecution` database model for persisting execution metrics.
    - CLI support for displaying execution costs.

### Bug Fixes
- Fixed VSM and Analytics tracking regressions.
- Resolved Actor execution test failures.
- Fixed Kernel and Runtime test UUID mismatches.
