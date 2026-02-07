# Release Notes - AWA Visualization Layer

| Date | Time | Change Description | Breaking Change |
|------|------|-------------------|-----------------|
| 2026-01-29 | 21:55 | Initial release of AWA Visualization Layer with JSON Schema, PostgreSQL DDL, and TypeScript/Python/Java SDK types. | No |
| 2026-01-29 | 22:30 | Implementation of `awa-viz.js` supporting ReactFlow (2D) and Babylon.js (3D). | No |
| 2026-01-30 | 00:15 | Enhanced `awa-viz.js` with Execution Metrics, Bottleneck Detection, and Work Transfer Visualization. | No |
| 2026-01-30 | 00:20 | Updated examples with realistic metrics and transfer data. Added rich detail panels and analytics dashboard. | No |
| 2026-01-30 | 00:30 | SDK v1.1.0: Fixed missing arrows in custom nodes by adding Handle components. Enhanced logging. Added detailed Bank Account Opening workflow example. | No |
| 2026-01-30 | 19:15 | Added Skills concept to Activities and Edges. Introduced `SkillType`, `SkillBinding`, and mandatory `id` for skills. Added demonstration example. | No |
| 2026-01-30 | 19:50 | Moved AWA Visualization to global `tools/visualization` and added dynamic JSON loading features (File Upload, Code Editor). | No |
| 2026-02-07 | 17:28 | Created comprehensive AWA framework skill file (`skills/SKILL.md`) following Anthropic's skill creation guidelines. Added installation instructions for Claude Code, Cursor AI, and Google Antigravity. Covers SDK, CLI, API, visualization, workflow building, and best practices. | No |
| 2026-02-07 | 18:00 | **Phase 1 Core Runtime Completion**: Added `decision_evaluator.ts` with FEEL expression support and 6 DMN hit policies. Implemented `human_agent.ts` with `HumanTaskQueue` for pause/resume. Created `robot_agent.ts` with simulation mode. Rewrote `workflow_engine.ts` with full actor/decision integration. Added 3 new test files (66 tests total). | No |
| 2026-02-07 | 18:02 | **Documentation Update**: Updated `SKILL.md` with Runtime Execution section (WorkflowEngine usage, options, statuses), expanded Actor Types with runtime implementations (HumanAgent, RobotAgent), comprehensive FEEL expression syntax for Decision Nodes, all 6 DMN hit policies, and Human Task Management examples. | No |
