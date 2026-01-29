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
