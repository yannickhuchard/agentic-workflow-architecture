/**
 * AWA SDK - Agentic Workflow Architecture
 * TypeScript/Node.js SDK
 */

// Types
export * from './types';

// Runtime
export * from './runtime';

// Builder
export { WorkflowBuilder, workflow, type ActivityConfig, type ContextConfig } from './builder';

// Validator
export {
    validate_workflow,
    validate_activity,
    validate_context,
    parse_workflow,
    parse_activity,
    parse_context,
    validate_workflow_integrity,
    type ValidationResult,
    type ValidationError,
} from './validator';

// Query
export {
    WorkflowQuery,
    ActivityQuery,
    ContextQuery,
    AccessRightQuery,
    ContextBindingQuery,
    query,
} from './client/query';
