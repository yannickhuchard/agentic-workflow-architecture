/**
 * AWA (Agentic Workflow Architecture) TypeScript Types
 * Generated from JSON Schema specification
 */

import { z } from 'zod';

// ============================================================================
// ENUMS
// ============================================================================

export const ActorType = z.enum(['human', 'ai_agent', 'robot', 'application']);
export type ActorType = z.infer<typeof ActorType>;

export const AccessMode = z.enum(['read', 'write', 'read_write', 'subscribe', 'publish']);
export type AccessMode = z.infer<typeof AccessMode>;

export const SyncPattern = z.enum(['shared_state', 'message_passing', 'blackboard', 'event_sourcing']);
export type SyncPattern = z.infer<typeof SyncPattern>;

export const ContextType = z.enum(['document', 'data', 'config', 'state', 'memory', 'artifact']);
export type ContextType = z.infer<typeof ContextType>;

export const Visibility = z.enum(['private', 'workflow', 'collection', 'global']);
export type Visibility = z.infer<typeof Visibility>;

export const Permission = z.enum(['read', 'write', 'execute', 'admin', 'delete', 'create']);
export type Permission = z.infer<typeof Permission>;

export const ResourceType = z.enum(['system', 'api', 'database', 'file', 'service', 'secret']);
export type ResourceType = z.infer<typeof ResourceType>;

export const AccessDirection = z.enum(['requires', 'provisions']);
export type AccessDirection = z.infer<typeof AccessDirection>;

export const HitPolicy = z.enum(['unique', 'first', 'priority', 'any', 'collect', 'rule_order']);
export type HitPolicy = z.infer<typeof HitPolicy>;

export const WasteCategory = z.enum([
    'defects', 'overproduction', 'waiting', 'non_utilized_talent',
    'transport', 'inventory', 'motion', 'extra_processing'
]);
export type WasteCategory = z.infer<typeof WasteCategory>;

export const NodeType = z.enum(['activity', 'event', 'decision']);
export type NodeType = z.infer<typeof NodeType>;

export const ControlType = z.enum(['authorization', 'validation', 'audit', 'compliance', 'security', 'rate_limit']);
export type ControlType = z.infer<typeof ControlType>;

export const Enforcement = z.enum(['mandatory', 'advisory', 'informational']);
export type Enforcement = z.infer<typeof Enforcement>;

export const Lifecycle = z.enum(['transient', 'persistent', 'cached']);
export type Lifecycle = z.infer<typeof Lifecycle>;

export const SkillType = z.enum(['ai_context', 'human_competency']);
export type SkillType = z.infer<typeof SkillType>;

export const ToolRequirementType = z.enum(['mcp', 'rest_api', 'graphql', 'grpc', 'software_package', 'hardware_interface']);
export type ToolRequirementType = z.infer<typeof ToolRequirementType>;

// ============================================================================
// COMMON TYPES
// ============================================================================

export const UUID = z.string().uuid();
export type UUID = z.infer<typeof UUID>;

export const Duration = z.string().regex(/^P(?:\d+Y)?(?:\d+M)?(?:\d+W)?(?:\d+D)?(?:T(?:\d+H)?(?:\d+M)?(?:\d+(?:\.\d+)?S)?)?$/);
export type Duration = z.infer<typeof Duration>;

export const DateTimeTz = z.string().datetime();
export type DateTimeTz = z.infer<typeof DateTimeTz>;

// ============================================================================
// ENTITY SCHEMAS
// ============================================================================

export const SkillBindingSchema = z.object({
    id: UUID,
    name: z.string(),
    type: SkillType,
    description: z.string().optional(),
    min_level: z.string().optional(),
    reference: z.string().url().optional(),
});
export type SkillBinding = z.infer<typeof SkillBindingSchema>;

export const ToolRequirementSchema = z.object({
    id: UUID,
    name: z.string(),
    type: ToolRequirementType,
    description: z.string().optional(),
    version: z.string().optional(),
    reference: z.string().url().optional(),
});
export type ToolRequirement = z.infer<typeof ToolRequirementSchema>;

export const DataObjectSchema = z.object({
    name: z.string(),
    description: z.string().optional(),
    schema: z.record(z.unknown()).optional(),
    required: z.boolean().default(true),
});
export type DataObject = z.infer<typeof DataObjectSchema>;

export const ParameterSchema = z.object({
    name: z.string(),
    type: z.string(),
    required: z.boolean().default(true),
    default: z.unknown().optional(),
});
export type Parameter = z.infer<typeof ParameterSchema>;

export const ProgramSchema = z.object({
    id: UUID,
    name: z.string(),
    language: z.enum(['python', 'typescript', 'javascript', 'java', 'sql', 'mcp_tool', 'rest_api', 'graphql', 'shell']),
    code: z.string().optional(),
    code_uri: z.string().url().optional(),
    parameters: z.array(ParameterSchema).default([]),
    mcp_server: z.string().optional(),
});
export type Program = z.infer<typeof ProgramSchema>;

export const ControlSchema = z.object({
    id: UUID,
    name: z.string(),
    description: z.string().optional(),
    type: ControlType,
    expression: z.string().optional(),
    enforcement: Enforcement,
});
export type Control = z.infer<typeof ControlSchema>;

export const ContextBindingSchema = z.object({
    id: UUID.optional(),
    context_id: UUID,
    activity_id: UUID.optional(),
    access_mode: AccessMode,
    required: z.boolean().default(true),
    transforms: z.object({
        on_read: z.string().optional(),
        on_write: z.string().optional(),
    }).optional(),
});
export type ContextBinding = z.infer<typeof ContextBindingSchema>;

export const AccessRightSchema = z.object({
    id: UUID,
    name: z.string(),
    description: z.string().optional(),
    activity_id: UUID.optional(),
    direction: AccessDirection,
    resource_type: ResourceType,
    resource_id: z.string().optional(),
    permission: Permission,
    scope: z.string().optional(),
    conditions: z.record(z.unknown()).optional(),
});
export type AccessRight = z.infer<typeof AccessRightSchema>;

export const ContextSchema = z.object({
    id: UUID,
    name: z.string(),
    description: z.string().optional(),
    type: ContextType,
    schema: z.record(z.unknown()).optional(),
    initial_value: z.unknown().optional(),
    sync_pattern: SyncPattern,
    visibility: Visibility.default('workflow'),
    owner_workflow_id: UUID.optional(),
    lifecycle: Lifecycle.default('persistent'),
    ttl: Duration.optional(),
});
export type Context = z.infer<typeof ContextSchema>;

export const SLASchema = z.object({
    id: UUID.optional(),
    name: z.string().optional(),
    target_time: Duration.optional(),
    max_time: Duration.optional(),
    escalation_policy: z.object({
        warning_threshold: Duration.optional(),
        warning_action: z.string().optional(),
        breach_action: z.string().optional(),
        notify_roles: z.array(UUID).optional(),
    }).optional(),
    metrics: z.array(z.object({
        name: z.string(),
        target: z.number(),
        unit: z.string().optional(),
        comparison: z.enum(['lt', 'lte', 'eq', 'gte', 'gt']).optional(),
    })).optional(),
});
export type SLA = z.infer<typeof SLASchema>;

export const AnalyticsSchema = z.object({
    process_time: Duration.optional(),
    cycle_time: Duration.optional(),
    lead_time: Duration.optional(),
    wait_time: Duration.optional(),
    value_added: z.boolean().optional(),
    waste_categories: z.array(WasteCategory).optional(),
    cost: z.object({
        amount: z.number(),
        currency: z.string().length(3),
    }).optional(),
    resource_utilization: z.number().min(0).max(1).optional(),
    error_rate: z.number().min(0).max(1).optional(),
    throughput: z.object({
        value: z.number(),
        unit: z.string(),
        period: Duration.optional(),
    }).optional(),
    process_cycle_efficiency: z.number().min(0).max(1).optional(),
});
export type Analytics = z.infer<typeof AnalyticsSchema>;

export const ActivitySchema = z.object({
    id: UUID,
    name: z.string(),
    description: z.string().optional(),
    role_id: UUID,
    actor_type: ActorType,
    system_id: UUID.optional(),
    machine_id: UUID.optional(),
    endpoint_id: UUID.optional(),
    organization_id: UUID.optional(),
    inputs: z.array(DataObjectSchema).default([]),
    outputs: z.array(DataObjectSchema).default([]),
    context_bindings: z.array(ContextBindingSchema).default([]),
    access_rights: z.array(AccessRightSchema).default([]),
    programs: z.array(ProgramSchema).default([]),
    controls: z.array(ControlSchema).default([]),
    sla: SLASchema.optional(),
    analytics: AnalyticsSchema.optional(),
    is_expandable: z.boolean().default(false),
    expansion_workflow_id: UUID.optional(),
    skills: z.array(SkillBindingSchema).default([]),
    tool_requirements: z.array(ToolRequirementSchema).default([]),
});
export type Activity = z.infer<typeof ActivitySchema>;

export const EdgeSchema = z.object({
    id: UUID,
    source_id: UUID,
    target_id: UUID,
    source_type: NodeType.optional(),
    target_type: NodeType.optional(),
    condition: z.string().optional(),
    label: z.string().optional(),
    is_default: z.boolean().default(false),
    skills: z.array(SkillBindingSchema).default([]),
    tool_requirements: z.array(ToolRequirementSchema).default([]),
});
export type Edge = z.infer<typeof EdgeSchema>;

export const EventSchema = z.object({
    id: UUID,
    name: z.string(),
    description: z.string().optional(),
    event_type: z.string(),
    event_definition: z.record(z.unknown()).optional(),
});
export type Event = z.infer<typeof EventSchema>;

export const DecisionRuleSchema = z.object({
    id: UUID.optional(),
    description: z.string().optional(),
    input_entries: z.array(z.string()),
    output_entries: z.array(z.unknown()),
    output_edge_id: UUID.optional(),
});
export type DecisionRule = z.infer<typeof DecisionRuleSchema>;

export const TableColumnSchema = z.object({
    name: z.string(),
    label: z.string().optional(),
    type: z.enum(['string', 'number', 'boolean', 'date', 'datetime']),
    allowed_values: z.array(z.unknown()).optional(),
});
export type TableColumn = z.infer<typeof TableColumnSchema>;

export const DecisionTableSchema = z.object({
    hit_policy: HitPolicy,
    inputs: z.array(TableColumnSchema).min(1),
    outputs: z.array(TableColumnSchema).min(1),
    rules: z.array(DecisionRuleSchema),
});
export type DecisionTable = z.infer<typeof DecisionTableSchema>;

export const DecisionNodeSchema = z.object({
    id: UUID,
    name: z.string(),
    description: z.string().optional(),
    decision_table: DecisionTableSchema,
    default_output_edge_id: UUID.optional(),
});
export type DecisionNode = z.infer<typeof DecisionNodeSchema>;

export const WorkflowSchema = z.object({
    id: UUID,
    name: z.string(),
    version: z.string().regex(/^\d+\.\d+\.\d+$/),
    description: z.string().optional(),
    owner_id: UUID.optional(),
    organization_id: UUID.optional(),
    parent_workflow_id: UUID.optional(),
    expansion_activity_id: UUID.optional(),
    activities: z.array(ActivitySchema),
    edges: z.array(EdgeSchema),
    events: z.array(EventSchema).default([]),
    decision_nodes: z.array(DecisionNodeSchema).default([]),
    contexts: z.array(ContextSchema).default([]),
    sla: SLASchema.optional(),
    analytics: AnalyticsSchema.optional(),
    metadata: z.record(z.unknown()).optional(),
    created_at: DateTimeTz.optional(),
    updated_at: DateTimeTz.optional(),
});
export type Workflow = z.infer<typeof WorkflowSchema>;

export const CollectionSchema = z.object({
    id: UUID,
    name: z.string(),
    description: z.string().optional(),
    workflow_ids: z.array(UUID).default([]),
    shared_contexts: z.array(ContextSchema).default([]),
    owner_id: UUID.optional(),
    organization_id: UUID.optional(),
    tags: z.array(z.string()).default([]),
    created_at: DateTimeTz.optional(),
    updated_at: DateTimeTz.optional(),
});
export type Collection = z.infer<typeof CollectionSchema>;

export const RoleSchema = z.object({
    id: UUID,
    name: z.string(),
    description: z.string().optional(),
    actor_type: ActorType,
    organization_id: UUID.optional(),
    capabilities: z.array(z.string()).default([]),
    is_embedded: z.boolean().default(false),
    ai_model_config: z.object({
        model_id: z.string().optional(),
        temperature: z.number().min(0).max(2).optional(),
        max_tokens: z.number().optional(),
        system_prompt: z.string().optional(),
    }).optional(),
    mcp_tools: z.array(z.object({
        server_name: z.string(),
        tool_name: z.string(),
    })).default([]),
});
export type Role = z.infer<typeof RoleSchema>;

export const SystemSchema = z.object({
    id: UUID,
    name: z.string(),
    vendor: z.string().optional(),
    version: z.string().optional(),
    type: z.enum(['erp', 'crm', 'hrm', 'scm', 'custom', 'saas', 'database', 'messaging', 'storage']),
    description: z.string().optional(),
    base_url: z.string().url().optional(),
    auth_config: z.record(z.unknown()).optional(),
});
export type System = z.infer<typeof SystemSchema>;

export const MachineSchema = z.object({
    id: UUID,
    name: z.string(),
    type: z.enum(['robot', 'sensor', 'actuator', 'printer', 'scanner', 'vehicle', 'camera', 'conveyor']),
    manufacturer: z.string().optional(),
    model: z.string().optional(),
    serial_number: z.string().optional(),
    location: z.string().optional(),
    protocol: z.enum(['mqtt', 'opcua', 'modbus', 'http', 'grpc', 'ros']).optional(),
    connection_string: z.string().optional(),
});
export type Machine = z.infer<typeof MachineSchema>;

export const EndpointSchema = z.object({
    id: UUID,
    name: z.string(),
    url: z.string(),
    method: z.enum(['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'GRPC', 'WEBSOCKET', 'GRAPHQL']).optional(),
    auth_type: z.enum(['none', 'api_key', 'oauth2', 'jwt', 'basic', 'mtls']).optional(),
    openapi_ref: z.string().optional(),
    request_schema: z.record(z.unknown()).optional(),
    response_schema: z.record(z.unknown()).optional(),
});
export type Endpoint = z.infer<typeof EndpointSchema>;

// ============================================================================
// VISUALIZATION TYPES (RE-EXPORT)
// ============================================================================

export * from './visualization';

