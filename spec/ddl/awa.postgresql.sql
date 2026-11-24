-- Agentic Workflow Architecture (AWA) PostgreSQL DDL
-- Database schema for persisting AWA entities

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ============================================================================
-- ENUM TYPES
-- ============================================================================

CREATE TYPE actor_type AS ENUM ('human', 'ai_agent', 'robot', 'application');
CREATE TYPE access_mode AS ENUM ('read', 'write', 'read_write', 'subscribe', 'publish');
CREATE TYPE sync_pattern AS ENUM ('shared_state', 'message_passing', 'blackboard', 'event_sourcing');
CREATE TYPE context_type AS ENUM ('document', 'data', 'config', 'state', 'memory', 'artifact');
CREATE TYPE visibility AS ENUM ('private', 'workflow', 'collection', 'global');
CREATE TYPE permission AS ENUM ('read', 'write', 'execute', 'admin', 'delete', 'create');
CREATE TYPE resource_type AS ENUM ('system', 'api', 'database', 'file', 'service', 'secret');
CREATE TYPE access_direction AS ENUM ('requires', 'provisions');
CREATE TYPE hit_policy AS ENUM ('unique', 'first', 'priority', 'any', 'collect', 'rule_order');
CREATE TYPE waste_category AS ENUM ('defects', 'overproduction', 'waiting', 'non_utilized_talent', 'transport', 'inventory', 'motion', 'extra_processing');
CREATE TYPE node_type AS ENUM ('activity', 'event', 'decision');
CREATE TYPE control_type AS ENUM ('authorization', 'validation', 'audit', 'compliance', 'security', 'rate_limit');
CREATE TYPE enforcement AS ENUM ('mandatory', 'advisory', 'informational');
CREATE TYPE system_type AS ENUM ('erp', 'crm', 'hrm', 'scm', 'custom', 'saas', 'database', 'messaging', 'storage');
CREATE TYPE machine_type AS ENUM ('robot', 'sensor', 'actuator', 'printer', 'scanner', 'vehicle', 'camera', 'conveyor');
CREATE TYPE lifecycle AS ENUM ('transient', 'persistent', 'cached');

-- Visualization enums
CREATE TYPE view_type AS ENUM ('2d', '3d');
CREATE TYPE layout_algorithm AS ENUM ('dagre', 'elk', 'd3_hierarchy', 'manual');
CREATE TYPE layout_direction AS ENUM ('tb', 'bt', 'lr', 'rl');
CREATE TYPE lane_orientation AS ENUM ('horizontal', 'vertical');
CREATE TYPE curve_type AS ENUM ('bezier', 'step', 'smoothstep', 'straight');
CREATE TYPE node_shape AS ENUM ('rectangle', 'rounded', 'circle', 'diamond', 'hexagon', 'cylinder', 'cube', 'sphere');

-- ============================================================================
-- CORE TABLES
-- ============================================================================

-- Organizations
CREATE TABLE organizations (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name VARCHAR(255) NOT NULL,
    description TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Roles
CREATE TABLE roles (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name VARCHAR(255) NOT NULL,
    description TEXT,
    actor_type actor_type NOT NULL,
    organization_id UUID REFERENCES organizations(id),
    capabilities TEXT[],
    is_embedded BOOLEAN DEFAULT FALSE,
    ai_model_config JSONB,
    mcp_tools JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Systems (Technology Catalog)
CREATE TABLE systems (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name VARCHAR(255) NOT NULL,
    vendor VARCHAR(255),
    version VARCHAR(50),
    type system_type NOT NULL,
    description TEXT,
    base_url TEXT,
    auth_config JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Endpoints
CREATE TABLE endpoints (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    system_id UUID REFERENCES systems(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    url TEXT NOT NULL,
    method VARCHAR(20),
    auth_type VARCHAR(50),
    openapi_ref TEXT,
    request_schema JSONB,
    response_schema JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Machines
CREATE TABLE machines (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name VARCHAR(255) NOT NULL,
    type machine_type NOT NULL,
    manufacturer VARCHAR(255),
    model VARCHAR(255),
    serial_number VARCHAR(255),
    location TEXT,
    protocol VARCHAR(50),
    connection_string TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Collections
CREATE TABLE collections (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name VARCHAR(255) NOT NULL,
    description TEXT,
    owner_id UUID,
    organization_id UUID REFERENCES organizations(id),
    tags TEXT[],
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Workflows
CREATE TABLE workflows (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name VARCHAR(255) NOT NULL,
    version VARCHAR(50) NOT NULL,
    description TEXT,
    owner_id UUID,
    organization_id UUID REFERENCES organizations(id),
    parent_workflow_id UUID REFERENCES workflows(id),
    expansion_activity_id UUID,
    sla JSONB,
    analytics JSONB,
    metadata JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(name, version)
);

-- Collection-Workflow junction table
CREATE TABLE collection_workflows (
    collection_id UUID REFERENCES collections(id) ON DELETE CASCADE,
    workflow_id UUID REFERENCES workflows(id) ON DELETE CASCADE,
    added_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (collection_id, workflow_id)
);

-- Activities
CREATE TABLE activities (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    workflow_id UUID NOT NULL REFERENCES workflows(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    description TEXT,
    role_id UUID REFERENCES roles(id),
    actor_type actor_type NOT NULL,
    system_id UUID REFERENCES systems(id),
    machine_id UUID REFERENCES machines(id),
    endpoint_id UUID REFERENCES endpoints(id),
    organization_id UUID REFERENCES organizations(id),
    inputs JSONB DEFAULT '[]',
    outputs JSONB DEFAULT '[]',
    programs JSONB DEFAULT '[]',
    controls JSONB DEFAULT '[]',
    sla JSONB,
    analytics JSONB,
    is_expandable BOOLEAN DEFAULT FALSE,
    expansion_workflow_id UUID REFERENCES workflows(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Edges
CREATE TABLE edges (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    workflow_id UUID NOT NULL REFERENCES workflows(id) ON DELETE CASCADE,
    source_id UUID NOT NULL,
    target_id UUID NOT NULL,
    source_type node_type,
    target_type node_type,
    condition TEXT,
    label VARCHAR(255),
    is_default BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Events
CREATE TABLE events (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    workflow_id UUID NOT NULL REFERENCES workflows(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    description TEXT,
    event_type VARCHAR(50) NOT NULL,
    event_definition JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Decision Nodes
CREATE TABLE decision_nodes (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    workflow_id UUID NOT NULL REFERENCES workflows(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    description TEXT,
    decision_table JSONB NOT NULL,
    default_output_edge_id UUID REFERENCES edges(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Contexts
CREATE TABLE contexts (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name VARCHAR(255) NOT NULL,
    description TEXT,
    type context_type NOT NULL,
    schema JSONB,
    initial_value JSONB,
    sync_pattern sync_pattern NOT NULL,
    visibility visibility DEFAULT 'workflow',
    owner_workflow_id UUID REFERENCES workflows(id) ON DELETE CASCADE,
    collection_id UUID REFERENCES collections(id),
    lifecycle lifecycle DEFAULT 'persistent',
    ttl_seconds BIGINT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Context Bindings
CREATE TABLE context_bindings (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    context_id UUID NOT NULL REFERENCES contexts(id) ON DELETE CASCADE,
    activity_id UUID NOT NULL REFERENCES activities(id) ON DELETE CASCADE,
    access_mode access_mode NOT NULL,
    required BOOLEAN DEFAULT TRUE,
    transform_on_read TEXT,
    transform_on_write TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(context_id, activity_id)
);

-- Access Rights
CREATE TABLE access_rights (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name VARCHAR(255) NOT NULL,
    description TEXT,
    activity_id UUID REFERENCES activities(id) ON DELETE CASCADE,
    direction access_direction NOT NULL,
    resource_type resource_type NOT NULL,
    resource_id TEXT,
    permission permission NOT NULL,
    scope TEXT,
    conditions JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================================
-- INDEXES FOR QUERYABILITY
-- ============================================================================

-- Workflows
CREATE INDEX idx_workflows_owner ON workflows(owner_id);
CREATE INDEX idx_workflows_organization ON workflows(organization_id);
CREATE INDEX idx_workflows_parent ON workflows(parent_workflow_id);
CREATE INDEX idx_workflows_name ON workflows(name);

-- Activities
CREATE INDEX idx_activities_workflow ON activities(workflow_id);
CREATE INDEX idx_activities_actor_type ON activities(actor_type);
CREATE INDEX idx_activities_role ON activities(role_id);
CREATE INDEX idx_activities_system ON activities(system_id);
CREATE INDEX idx_activities_machine ON activities(machine_id);
CREATE INDEX idx_activities_organization ON activities(organization_id);

-- Edges
CREATE INDEX idx_edges_workflow ON edges(workflow_id);
CREATE INDEX idx_edges_source ON edges(source_id);
CREATE INDEX idx_edges_target ON edges(target_id);

-- Contexts
CREATE INDEX idx_contexts_workflow ON contexts(owner_workflow_id);
CREATE INDEX idx_contexts_type ON contexts(type);
CREATE INDEX idx_contexts_sync_pattern ON contexts(sync_pattern);
CREATE INDEX idx_contexts_visibility ON contexts(visibility);

-- Context Bindings
CREATE INDEX idx_context_bindings_context ON context_bindings(context_id);
CREATE INDEX idx_context_bindings_activity ON context_bindings(activity_id);
CREATE INDEX idx_context_bindings_access_mode ON context_bindings(access_mode);

-- Access Rights
CREATE INDEX idx_access_rights_activity ON access_rights(activity_id);
CREATE INDEX idx_access_rights_direction ON access_rights(direction);
CREATE INDEX idx_access_rights_permission ON access_rights(permission);
CREATE INDEX idx_access_rights_resource_type ON access_rights(resource_type);
CREATE INDEX idx_access_rights_resource_id ON access_rights(resource_id);

-- Systems & Technology
CREATE INDEX idx_systems_type ON systems(type);
CREATE INDEX idx_endpoints_system ON endpoints(system_id);
CREATE INDEX idx_machines_type ON machines(type);

-- Roles
CREATE INDEX idx_roles_actor_type ON roles(actor_type);
CREATE INDEX idx_roles_organization ON roles(organization_id);

-- Collections
CREATE INDEX idx_collections_owner ON collections(owner_id);
CREATE INDEX idx_collections_organization ON collections(organization_id);

-- ============================================================================
-- VIEWS FOR COMMON QUERIES
-- ============================================================================

-- View: All access rights with workflow information
CREATE VIEW v_workflow_access_rights AS
SELECT 
    ar.*,
    a.workflow_id,
    a.name as activity_name,
    a.actor_type as activity_actor_type,
    w.name as workflow_name,
    w.version as workflow_version
FROM access_rights ar
JOIN activities a ON ar.activity_id = a.id
JOIN workflows w ON a.workflow_id = w.id;

-- View: Context with all bound activities
CREATE VIEW v_context_activities AS
SELECT 
    c.*,
    cb.activity_id,
    cb.access_mode,
    a.name as activity_name,
    a.actor_type as activity_actor_type,
    a.workflow_id
FROM contexts c
JOIN context_bindings cb ON c.id = cb.context_id
JOIN activities a ON cb.activity_id = a.id;

-- View: Activities with their technology stack
CREATE VIEW v_activity_technology AS
SELECT 
    a.id as activity_id,
    a.name as activity_name,
    a.workflow_id,
    a.actor_type,
    s.id as system_id,
    s.name as system_name,
    s.type as system_type,
    m.id as machine_id,
    m.name as machine_name,
    m.type as machine_type,
    e.id as endpoint_id,
    e.name as endpoint_name,
    e.url as endpoint_url
FROM activities a
LEFT JOIN systems s ON a.system_id = s.id
LEFT JOIN machines m ON a.machine_id = m.id
LEFT JOIN endpoints e ON a.endpoint_id = e.id;

-- ============================================================================
-- FUNCTIONS
-- ============================================================================

-- Function to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Apply triggers to relevant tables
CREATE TRIGGER update_workflows_updated_at BEFORE UPDATE ON workflows FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_activities_updated_at BEFORE UPDATE ON activities FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_contexts_updated_at BEFORE UPDATE ON contexts FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_access_rights_updated_at BEFORE UPDATE ON access_rights FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_roles_updated_at BEFORE UPDATE ON roles FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_systems_updated_at BEFORE UPDATE ON systems FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_machines_updated_at BEFORE UPDATE ON machines FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_collections_updated_at BEFORE UPDATE ON collections FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_organizations_updated_at BEFORE UPDATE ON organizations FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ============================================================================
-- VISUALIZATION TABLES
-- ============================================================================

-- Visualizations
CREATE TABLE visualizations (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    workflow_id UUID NOT NULL REFERENCES workflows(id) ON DELETE CASCADE,
    name VARCHAR(255),
    description TEXT,
    is_default BOOLEAN DEFAULT FALSE,
    view_type view_type NOT NULL,
    engine VARCHAR(50) DEFAULT 'reactflow',
    layout_algorithm layout_algorithm DEFAULT 'dagre',
    layout_direction layout_direction DEFAULT 'lr',
    layout_config JSONB DEFAULT '{}',
    camera_settings JSONB DEFAULT '{}',
    animation_config JSONB DEFAULT '{}',
    theme JSONB DEFAULT '{}',
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Node Positions (2D and 3D)
CREATE TABLE node_positions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    visualization_id UUID NOT NULL REFERENCES visualizations(id) ON DELETE CASCADE,
    node_id UUID NOT NULL,
    node_type node_type NOT NULL,
    position_x DOUBLE PRECISION NOT NULL DEFAULT 0,
    position_y DOUBLE PRECISION NOT NULL DEFAULT 0,
    position_z DOUBLE PRECISION DEFAULT 0,
    width DOUBLE PRECISION,
    height DOUBLE PRECISION,
    depth DOUBLE PRECISION,
    rotation_x DOUBLE PRECISION DEFAULT 0,
    rotation_y DOUBLE PRECISION DEFAULT 0,
    rotation_z DOUBLE PRECISION DEFAULT 0,
    rotation_w DOUBLE PRECISION DEFAULT 1,
    scale_x DOUBLE PRECISION DEFAULT 1,
    scale_y DOUBLE PRECISION DEFAULT 1,
    scale_z DOUBLE PRECISION DEFAULT 1,
    z_index INTEGER DEFAULT 0,
    shape node_shape DEFAULT 'rectangle',
    style JSONB DEFAULT '{}',
    material JSONB DEFAULT '{}',
    visible BOOLEAN DEFAULT TRUE,
    collapsed BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(visualization_id, node_id)
);

-- Lanes (Swim lanes / Pools)
CREATE TABLE lanes (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    visualization_id UUID NOT NULL REFERENCES visualizations(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    label VARCHAR(255),
    description TEXT,
    orientation lane_orientation DEFAULT 'horizontal',
    order_index INTEGER DEFAULT 0,
    role_id UUID REFERENCES roles(id),
    organization_id UUID REFERENCES organizations(id),
    color VARCHAR(50),
    collapsed BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Lane Node Membership
CREATE TABLE lane_nodes (
    lane_id UUID NOT NULL REFERENCES lanes(id) ON DELETE CASCADE,
    node_id UUID NOT NULL,
    node_type node_type NOT NULL,
    PRIMARY KEY (lane_id, node_id)
);

-- Edge Routings
CREATE TABLE edge_routings (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    visualization_id UUID NOT NULL REFERENCES visualizations(id) ON DELETE CASCADE,
    edge_id UUID NOT NULL REFERENCES edges(id) ON DELETE CASCADE,
    curve_type curve_type DEFAULT 'bezier',
    control_points JSONB DEFAULT '[]',
    animated BOOLEAN DEFAULT FALSE,
    animation_speed DOUBLE PRECISION DEFAULT 1.0,
    style JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(visualization_id, edge_id)
);

-- ============================================================================
-- VISUALIZATION INDEXES
-- ============================================================================

CREATE INDEX idx_visualizations_workflow ON visualizations(workflow_id);
CREATE INDEX idx_visualizations_view_type ON visualizations(view_type);
CREATE INDEX idx_visualizations_is_default ON visualizations(is_default);

CREATE INDEX idx_node_positions_visualization ON node_positions(visualization_id);
CREATE INDEX idx_node_positions_node ON node_positions(node_id);
CREATE INDEX idx_node_positions_type ON node_positions(node_type);

CREATE INDEX idx_lanes_visualization ON lanes(visualization_id);
CREATE INDEX idx_lanes_role ON lanes(role_id);
CREATE INDEX idx_lanes_organization ON lanes(organization_id);

CREATE INDEX idx_lane_nodes_lane ON lane_nodes(lane_id);
CREATE INDEX idx_lane_nodes_node ON lane_nodes(node_id);

CREATE INDEX idx_edge_routings_visualization ON edge_routings(visualization_id);
CREATE INDEX idx_edge_routings_edge ON edge_routings(edge_id);

-- ============================================================================
-- VISUALIZATION VIEWS
-- ============================================================================

-- View: Full visualization with node count
CREATE VIEW v_visualization_summary AS
SELECT 
    v.id,
    v.workflow_id,
    v.name,
    v.view_type,
    v.engine,
    v.is_default,
    w.name as workflow_name,
    w.version as workflow_version,
    COUNT(DISTINCT np.id) as node_count,
    COUNT(DISTINCT l.id) as lane_count,
    COUNT(DISTINCT er.id) as edge_routing_count
FROM visualizations v
JOIN workflows w ON v.workflow_id = w.id
LEFT JOIN node_positions np ON v.id = np.visualization_id
LEFT JOIN lanes l ON v.id = l.visualization_id
LEFT JOIN edge_routings er ON v.id = er.visualization_id
GROUP BY v.id, w.name, w.version;

-- Apply triggers to visualization tables
CREATE TRIGGER update_visualizations_updated_at BEFORE UPDATE ON visualizations FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_node_positions_updated_at BEFORE UPDATE ON node_positions FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_lanes_updated_at BEFORE UPDATE ON lanes FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_edge_routings_updated_at BEFORE UPDATE ON edge_routings FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ============================================================================
-- AWA 1.1
-- ============================================================================
-- Informative projection of the JSON Schemas in spec/json-schema, which are
-- normative. Structured values (contracts, tools, policies) are kept as JSONB
-- in the shape those schemas define.

CREATE TYPE join_mode AS ENUM ('any', 'all');
CREATE TYPE trace_level AS ENUM ('execution', 'reasoning', 'meta');
CREATE TYPE run_status AS ENUM ('running', 'waiting_human', 'waiting_event', 'completed', 'failed', 'cancelled');
CREATE TYPE knowledge_type AS ENUM ('strategy', 'failure_pattern', 'decision_precedent', 'lesson');
CREATE TYPE knowledge_status AS ENUM ('draft', 'reviewed', 'deprecated');

-- Workflow document (specification sections 4 and 8)
ALTER TABLE workflows ADD COLUMN awa_version VARCHAR(10);

-- roles.ai_model_config.model_id holds a model reference, e.g. "tier:fast" (section 12)

ALTER TABLE activities
    ADD COLUMN procedure TEXT,
    ADD COLUMN verification JSONB,                        -- acceptance criteria (section 7)
    ADD COLUMN retry JSONB,                               -- retry policy (section 10)
    ADD COLUMN outcome_contract JSONB,                    -- schema, postconditions, budgets, escalation (section 11)
    ADD COLUMN join_mode join_mode NOT NULL DEFAULT 'any', -- "join" in the document (section 13.2)
    ADD COLUMN compensation_activity_id UUID REFERENCES activities(id), -- section 13.6
    ADD COLUMN tools JSONB NOT NULL DEFAULT '[]',         -- callable tools and their bindings (section 17)
    ADD COLUMN knowledge JSONB;                           -- knowledge binding (section 15.4)

ALTER TABLE events ADD COLUMN join_mode join_mode NOT NULL DEFAULT 'any';

-- A decision node has a table, an external engine, or a model (sections 5.5 and 16)
ALTER TABLE decision_nodes
    ALTER COLUMN decision_table DROP NOT NULL,
    ADD COLUMN decision_engine JSONB,
    ADD COLUMN decision_model JSONB,
    ADD CONSTRAINT decision_nodes_decided_by CHECK (
        (decision_table IS NOT NULL OR decision_engine IS NOT NULL OR decision_model IS NOT NULL)
        AND NOT (decision_table IS NOT NULL AND decision_engine IS NOT NULL)
    );

-- Runs and the execution journal (section 9)
CREATE TABLE runs (
    id UUID PRIMARY KEY,
    workflow_id UUID NOT NULL REFERENCES workflows(id),
    workflow_version VARCHAR(50),
    status run_status NOT NULL DEFAULT 'running',
    input JSONB,
    started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    ended_at TIMESTAMPTZ,
    checkpoint JSONB,                                     -- latest state, for recovery (section 10.3)
    checkpoint_at TIMESTAMPTZ
);

-- Append-only: rows are never updated or deleted
CREATE TABLE journal_events (
    run_id UUID NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
    seq INTEGER NOT NULL CHECK (seq >= 1),                -- position in the run, no gaps
    id UUID NOT NULL UNIQUE,
    spec_version VARCHAR(10) NOT NULL,
    time TIMESTAMPTZ NOT NULL,
    type VARCHAR(50) NOT NULL,                            -- e.g. activity.started, tool.invoked
    level trace_level NOT NULL DEFAULT 'execution',
    workflow_id UUID NOT NULL,
    token_id UUID,
    node_id UUID,
    node_name VARCHAR(255),
    attempt INTEGER CHECK (attempt >= 1),
    data JSONB NOT NULL DEFAULT '{}',
    PRIMARY KEY (run_id, seq)
);

CREATE INDEX idx_journal_events_type ON journal_events (type);
CREATE INDEX idx_journal_events_node ON journal_events (node_id);
CREATE INDEX idx_journal_events_time ON journal_events (time);
CREATE INDEX idx_runs_workflow ON runs (workflow_id, started_at DESC);

-- Tool calls, as recorded in the journal (section 17.5): what was called, when, and the link to what ran
CREATE VIEW tool_calls AS
SELECT
    invoked.run_id,
    invoked.node_id,
    invoked.node_name,
    invoked.attempt,
    invoked.data->>'call_id'                   AS call_id,
    invoked.data->>'tool'                      AS tool,
    invoked.data->>'link'                      AS link,
    invoked.data->'binding'->>'kind'           AS binding_kind,
    invoked.time                               AS invoked_at,
    finished.time                              AS finished_at,
    finished.type = 'tool.completed'           AS succeeded,
    finished.data->>'status'                   AS status,
    (finished.data->>'duration_ms')::INTEGER   AS duration_ms,
    finished.data->'error'->>'message'         AS error
FROM journal_events invoked
LEFT JOIN journal_events finished
    ON finished.run_id = invoked.run_id
   AND finished.type IN ('tool.completed', 'tool.failed')
   AND finished.data->>'call_id' = invoked.data->>'call_id'
WHERE invoked.type = 'tool.invoked';

-- Knowledge (section 15)
CREATE TABLE knowledge_entries (
    id VARCHAR(255) PRIMARY KEY,                          -- bundle path without ".md"
    type knowledge_type NOT NULL,
    title TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    tags TEXT[] NOT NULL DEFAULT '{}',
    workflow_id UUID,
    node_id UUID,
    node_name VARCHAR(255),
    status knowledge_status NOT NULL DEFAULT 'draft',
    observations INTEGER NOT NULL DEFAULT 1,
    counts JSONB NOT NULL DEFAULT '{}',
    latest JSONB NOT NULL DEFAULT '{}',
    reviewed_by VARCHAR(255),
    reviewed_at TIMESTAMPTZ,
    superseded_by VARCHAR(255) REFERENCES knowledge_entries(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CHECK (status <> 'reviewed' OR (reviewed_by IS NOT NULL AND reviewed_at IS NOT NULL))
);

-- The evidence behind each entry: which run, and which journal events
CREATE TABLE knowledge_sources (
    entry_id VARCHAR(255) NOT NULL REFERENCES knowledge_entries(id) ON DELETE CASCADE,
    run_id UUID NOT NULL,
    event_seqs INTEGER[] NOT NULL DEFAULT '{}',
    observed_at TIMESTAMPTZ NOT NULL,
    PRIMARY KEY (entry_id, run_id)
);

CREATE INDEX idx_knowledge_entries_scope ON knowledge_entries (workflow_id, node_id, status);

-- ============================================================================
-- Business events and journeys (sections 18 and 19)
-- ============================================================================

CREATE TYPE journey_status AS ENUM ('active', 'completed', 'abandoned');
CREATE TYPE touchpoint_direction AS ENUM ('inbound', 'outbound');
CREATE TYPE sentiment_basis AS ENUM ('measured', 'inferred');

-- Business events a host has taken in. The primary key is what makes delivery idempotent (18.3, 19.5).
CREATE TABLE business_events (
    id VARCHAR(255) PRIMARY KEY,
    source VARCHAR(500) NOT NULL,
    type VARCHAR(255) NOT NULL,
    subject VARCHAR(255),
    time TIMESTAMPTZ,
    data JSONB NOT NULL DEFAULT '{}',
    accepted_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_business_events_type ON business_events (type, accepted_at);

-- A journey definition is kept whole: stages, triggers, goals, exits, artefacts, touchpoints, sentiment (19.1)
CREATE TABLE journeys (
    id UUID PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    version VARCHAR(50) NOT NULL,
    subject_name VARCHAR(100) NOT NULL,
    subject_key VARCHAR(255) NOT NULL,                    -- path in event data that identifies one subject
    definition JSONB NOT NULL
);

CREATE TABLE journey_instances (
    id UUID PRIMARY KEY,
    journey_id UUID NOT NULL REFERENCES journeys(id),
    subject_key VARCHAR(255) NOT NULL,                    -- the value: the same in every journey of one subject (19.7)
    status journey_status NOT NULL DEFAULT 'active',
    stage_id VARCHAR(64) NOT NULL,
    stage_entered_at TIMESTAMPTZ NOT NULL,
    stalled BOOLEAN NOT NULL DEFAULT FALSE,
    sentiment NUMERIC(6, 2),                              -- current estimate of the subject's mood (19.9)
    goals_reached TEXT[] NOT NULL DEFAULT '{}',
    data JSONB NOT NULL DEFAULT '{}',
    started_at TIMESTAMPTZ NOT NULL,
    ended_at TIMESTAMPTZ
);
-- One active instance per subject and journey
CREATE UNIQUE INDEX idx_journey_instances_active ON journey_instances (journey_id, subject_key) WHERE status = 'active';
CREATE INDEX idx_journey_instances_subject ON journey_instances (subject_key, started_at);
CREATE INDEX idx_journey_instances_stalled ON journey_instances (journey_id, stage_id) WHERE stalled AND status = 'active';

-- The runs started on behalf of a journey. run_id is the only join between the two layers (19.4).
CREATE TABLE journey_runs (
    journey_instance_id UUID NOT NULL REFERENCES journey_instances(id) ON DELETE CASCADE,
    run_id UUID NOT NULL REFERENCES runs(id),
    stage_id VARCHAR(64) NOT NULL,
    caused_by_event VARCHAR(255) REFERENCES business_events(id),
    PRIMARY KEY (journey_instance_id, run_id)
);
CREATE UNIQUE INDEX idx_journey_runs_run ON journey_runs (run_id);

-- Append-only: rows are never updated or deleted
CREATE TABLE journey_events (
    journey_instance_id UUID NOT NULL REFERENCES journey_instances(id) ON DELETE CASCADE,
    seq INTEGER NOT NULL CHECK (seq >= 1),
    spec_version VARCHAR(10) NOT NULL,
    journey_id UUID NOT NULL,
    time TIMESTAMPTZ NOT NULL,
    type VARCHAR(50) NOT NULL,                            -- e.g. journey.stage_entered, journey.touchpoint
    stage_id VARCHAR(64),
    run_id UUID,
    data JSONB NOT NULL DEFAULT '{}',
    PRIMARY KEY (journey_instance_id, seq)
);
CREATE INDEX idx_journey_events_type ON journey_events (journey_id, type, time);

-- Touchpoints as they happened: who, over what, and what changed hands (19.8)
CREATE VIEW journey_touchpoints AS
SELECT e.journey_instance_id, e.seq, e.time, e.run_id,
       e.data->>'touchpoint_id'                       AS touchpoint_id,
       e.data->>'name'                                AS name,
       e.data->>'party'                               AS party,
       (e.data->>'direction')::touchpoint_direction   AS direction,
       e.data->>'channel'                             AS channel,
       e.data->>'technology'                          AS technology,
       e.data->'artefacts'                            AS artefacts
FROM journey_events e WHERE e.type = 'journey.touchpoint';

-- Every change of mood with its basis. A reader must be able to tell what was said from what was assumed (19.9).
CREATE VIEW journey_sentiment AS
SELECT e.journey_instance_id, e.seq, e.time,
       (e.data->>'value')::NUMERIC                    AS value,
       (e.data->>'previous')::NUMERIC                 AS previous,
       (e.data->>'basis')::sentiment_basis            AS basis,
       e.data->>'reason'                              AS reason
FROM journey_events e WHERE e.type = 'journey.sentiment_changed';

-- How subjects move from one journey to the next (19.7)
CREATE VIEW journey_transitions AS
SELECT a.journey_id AS from_journey_id, b.journey_id AS to_journey_id, COUNT(*) AS subjects
FROM journey_instances a
JOIN LATERAL (
    SELECT n.journey_id FROM journey_instances n
    WHERE n.subject_key = a.subject_key AND n.started_at > a.started_at
    ORDER BY n.started_at LIMIT 1
) b ON TRUE
GROUP BY a.journey_id, b.journey_id;


-- ============================================================================
-- Runtime store: hosts that share a store (section 29)
-- ============================================================================
-- What a host of journeys and runs keeps (19.10) when several hosts share one
-- PostgreSQL database. The SDKs create these tables themselves, by the same
-- statements, recording each migration in awa_runtime.migrations. They are in a
-- schema of their own, so that a database may also hold the tables above.
--
-- They follow the tables above for runs, journal events, business events,
-- journeys and their events, with three differences: documents and states are
-- kept whole as JSONB, as the SDKs read and write them; identifiers are TEXT,
-- since they come from documents; and each row carries what concurrent hosts
-- need: a partition key, a version, and when time next acts on it.
--
-- How hosts use them, per operation, in one transaction: hold each partition
-- the operation touches with pg_advisory_xact_lock(hashtextextended(
-- 'awa:' || partition_key, 0)); read the rows of those partitions; insert the
-- ids of the events accepted; write back changed rows WHERE version = the
-- version read; insert journal and journey events; commit. Deadlines are found
-- by due_at and their partitions taken with pg_try_advisory_xact_lock, skipping
-- those another host holds.

CREATE SCHEMA IF NOT EXISTS awa_runtime;
CREATE TABLE IF NOT EXISTS awa_runtime.migrations (
    version INTEGER PRIMARY KEY,
    description TEXT NOT NULL,
    applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    applied_by TEXT NOT NULL
);

-- The workflow and journey documents every host on the store registers, kept whole
CREATE TABLE awa_runtime.definitions (
    kind TEXT NOT NULL CHECK (kind IN ('workflow', 'journey')),
    id TEXT NOT NULL,
    name TEXT NOT NULL,
    version TEXT,
    document JSONB NOT NULL,
    added_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (kind, id)
);

-- Every business event a host has accepted. Inserting the id in the operation's transaction is what accepts
-- the event: the primary key makes a second acceptance, by any host, impossible (29.3).
CREATE TABLE awa_runtime.business_events (
    id TEXT PRIMARY KEY,
    source TEXT NOT NULL,
    type TEXT NOT NULL,
    subject TEXT,
    time TIMESTAMPTZ,
    data JSONB NOT NULL DEFAULT '{}',
    accepted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    accepted_by TEXT NOT NULL
);
CREATE INDEX business_events_type ON awa_runtime.business_events (type, accepted_at);

-- One row per journey instance. document is the instance whole (19.4); the columns beside it are what the
-- store finds instances by. partition_key is 'subject:<subject key>'; due_at is when a stage may outlast its
-- limit; version is the optimistic check every write is made against (29.2).
CREATE TABLE awa_runtime.journey_instances (
    id TEXT PRIMARY KEY,
    journey_id TEXT NOT NULL,
    subject_key TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('active', 'completed', 'abandoned')),
    stage_id TEXT NOT NULL,
    stalled BOOLEAN NOT NULL DEFAULT FALSE,
    started_at TIMESTAMPTZ NOT NULL,
    ended_at TIMESTAMPTZ,
    partition_key TEXT NOT NULL,
    due_at TIMESTAMPTZ,
    position BIGSERIAL NOT NULL,
    version INTEGER NOT NULL DEFAULT 1,
    document JSONB NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_by TEXT NOT NULL
);
CREATE UNIQUE INDEX journey_instances_active ON awa_runtime.journey_instances (journey_id, subject_key) WHERE status = 'active';
CREATE INDEX journey_instances_partition ON awa_runtime.journey_instances (partition_key);
CREATE INDEX journey_instances_due ON awa_runtime.journey_instances (due_at) WHERE due_at IS NOT NULL;

-- The record of each instance, one row per journey event, written with the instance: what the views of the
-- journey layer above read
CREATE TABLE awa_runtime.journey_events (
    journey_instance_id TEXT NOT NULL REFERENCES awa_runtime.journey_instances(id) DEFERRABLE INITIALLY DEFERRED,
    seq INTEGER NOT NULL CHECK (seq >= 1),
    spec_version TEXT NOT NULL,
    journey_id TEXT NOT NULL,
    time TIMESTAMPTZ NOT NULL,
    type TEXT NOT NULL,
    stage_id TEXT,
    run_id TEXT,
    data JSONB NOT NULL DEFAULT '{}',
    PRIMARY KEY (journey_instance_id, seq)
);
CREATE INDEX journey_events_type ON awa_runtime.journey_events (journey_id, type, time);

-- One row per run: the state it can be continued from (checkpoint, 10.3), the events it published that were not
-- yet accepted (outbox), and what the store finds it by: its partition (its journey's subject, or 'run:<id>'),
-- the events its waiting tokens wait for (waits_for, waits) and when time next acts on it (due_at)
CREATE TABLE awa_runtime.runs (
    id TEXT PRIMARY KEY,
    workflow_id TEXT NOT NULL,
    workflow_version TEXT,
    status TEXT NOT NULL,
    journey_instance_id TEXT REFERENCES awa_runtime.journey_instances(id) DEFERRABLE INITIALLY DEFERRED,
    partition_key TEXT NOT NULL,
    due_at TIMESTAMPTZ,
    waits_for TEXT[] NOT NULL DEFAULT '{}',
    waits JSONB NOT NULL DEFAULT '[]',
    outbox JSONB NOT NULL DEFAULT '[]',
    checkpoint JSONB NOT NULL,
    checkpoint_at TIMESTAMPTZ NOT NULL,
    started_at TIMESTAMPTZ NOT NULL,
    ended_at TIMESTAMPTZ,
    position BIGSERIAL NOT NULL,
    version INTEGER NOT NULL DEFAULT 1,
    updated_by TEXT NOT NULL
);
CREATE INDEX runs_partition ON awa_runtime.runs (partition_key) WHERE status NOT IN ('completed', 'failed', 'cancelled');
CREATE INDEX runs_waits_for ON awa_runtime.runs USING GIN (waits_for);
CREATE INDEX runs_due ON awa_runtime.runs (due_at) WHERE due_at IS NOT NULL;

-- The journal of each run (section 9), written in the same transaction as the run's state: never behind it,
-- never ahead of it, and numbered without a gap whichever host wrote which event
CREATE TABLE awa_runtime.journal_events (
    run_id TEXT NOT NULL REFERENCES awa_runtime.runs(id) DEFERRABLE INITIALLY DEFERRED,
    seq INTEGER NOT NULL CHECK (seq >= 1),
    id TEXT NOT NULL UNIQUE,
    spec_version TEXT NOT NULL,
    time TIMESTAMPTZ NOT NULL,
    type TEXT NOT NULL,
    level TEXT NOT NULL DEFAULT 'execution' CHECK (level IN ('execution', 'reasoning', 'meta')),
    workflow_id TEXT NOT NULL,
    token_id TEXT,
    node_id TEXT,
    node_name TEXT,
    attempt INTEGER CHECK (attempt >= 1),
    data JSONB NOT NULL DEFAULT '{}',
    PRIMARY KEY (run_id, seq)
);
CREATE INDEX journal_events_type ON awa_runtime.journal_events (type);
