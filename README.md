# Agentic Workflow Architecture (AWA)

**The specification standard for AI-native, queryable workflow architecture.**

AWA is a next-generation business process specification designed for the age of AI agents. It builds upon BPMN, BPEL, and DMN concepts while being natively designed for:

- 🤖 **AI Agents** - First-class support for AI agent actors with MCP tools
- 🔍 **Queryability** - Rich querying across workflows, activities, and access rights  
- 📊 **Value Stream Mapping** - Built-in analytics with DOWNTIME waste categories
- 🔗 **Context Sharing** - Explicit shared state patterns for multi-agent collaboration
- 🔐 **Access Rights** - Declarative permissions with requires/provisions semantics

## Quick Start

### TypeScript

```typescript
import { workflow, query } from '@awa/sdk';

// Build a workflow
const orderProcess = workflow('Order Processing', '1.0.0')
  .description('AI-assisted order fulfillment')
  .context('order_data', { type: 'data', sync_pattern: 'shared_state' })
  .activity('Receive Order', {
    role_id: 'customer-service-agent',
    actor_type: 'ai_agent',
    contexts: [{ id: 'order_data', access_mode: 'write' }]
  })
  .activity('Validate Order', {
    role_id: 'validation-agent', 
    actor_type: 'ai_agent',
    contexts: [{ id: 'order_data', access_mode: 'read' }]
  })
  .edge('Receive Order', 'Validate Order')
  .build();

// Query the workflow
const aiActivities = query(orderProcess)
  .activities()
  .by_actor_type('ai_agent')
  .list();
```

### Python

```python
from awa import workflow, ActorType, ContextType, SyncPattern, AccessMode

# Build a workflow
order_process = (
    workflow("Order Processing", "1.0.0")
    .description("AI-assisted order fulfillment")
    .context("order_data", type=ContextType.DATA, sync_pattern=SyncPattern.SHARED_STATE)
    .activity(
        "Receive Order",
        role_id="customer-service-agent",
        actor_type=ActorType.AI_AGENT,
        contexts=[("order_data", AccessMode.WRITE)]
    )
    .activity(
        "Validate Order",
        role_id="validation-agent",
        actor_type=ActorType.AI_AGENT,
        contexts=[("order_data", AccessMode.READ)]
    )
    .edge("Receive Order", "Validate Order")
    .build()
)
```

### Java

```java
import io.awa.builder.WorkflowBuilder;
import io.awa.model.*;

Workflow orderProcess = WorkflowBuilder.workflow("Order Processing", "1.0.0")
    .description("AI-assisted order fulfillment")
    .context("order_data", ContextType.DATA, SyncPattern.SHARED_STATE)
    .activity("Receive Order", agentRoleId, ActorType.AI_AGENT)
    .activity("Validate Order", validatorRoleId, ActorType.AI_AGENT)
    .edge("Receive Order", "Validate Order")
    .build();
```

## Specification Files

| Format | Location | Description |
|--------|----------|-------------|
| JSON Schema | `spec/json-schema/` | Full schema definitions |
| Avro | `spec/avro/` | Event streaming schemas |
| OpenAPI 3.1 | `spec/openapi/` | REST API specification |
| GraphQL | `spec/graphql/` | Graph query API |
| PostgreSQL | `spec/ddl/` | Database persistence |

## Core Concepts

### Actor Types

| Type | Description |
|------|-------------|
| `human` | Human user actor |
| `ai_agent` | AI/LLM-based agent |
| `robot` | Physical/industrial robot |
| `application` | Software application/system |

### Context Sync Patterns

| Pattern | Use Case |
|---------|----------|
| `shared_state` | Agents read/write shared mutable state |
| `message_passing` | Agents send messages through context |
| `blackboard` | Classic AI blackboard architecture |
| `event_sourcing` | Immutable event log pattern |

### Access Modes

| Mode | Description |
|------|-------------|
| `read` | Read-only access |
| `write` | Write-only access |
| `read_write` | Full access |
| `subscribe` | Event subscription |
| `publish` | Event publishing |

### Permissions

| Permission | Description |
|------------|-------------|
| `read` | Read access |
| `write` | Write/update access |
| `execute` | Execute access |
| `admin` | Administrative access |
| `delete` | Delete access |
| `create` | Create access |

## Visualization Layer (Optional)

AWA includes an **optional visualization layer** for 2D and 3D workflow rendering, supporting static diagrams and animated flow execution.

### Key Features

- **2D Visualization** - ReactFlow compatible with auto-layout (Dagre, ELK)
- **3D Visualization** - Babylon.js compatible for immersive workflow views
- **Swim Lanes** - Organize activities by role or organization
- **Auto-Layout** - Automatic graph layout with configurable algorithms
- **Alternate Views** - Multiple visualization configurations per workflow
- **Animation** - Animated edge flow and execution path highlighting

### Technology Recommendations

| Dimension | Engine | Layout Algorithms |
|-----------|--------|-------------------|
| 2D | ReactFlow | Dagre, ELK, D3 Hierarchy |
| 3D | Babylon.js | Manual positioning |

### Schema Files

- `spec/json-schema/visualization.schema.json` - Complete visualization configuration
- `spec/avro/visualization_event.avsc` - Event streaming for real-time updates
- `spec/ddl/awa.postgresql.sql` - Database tables for persistence

### Usage Example

```json
{
  "visualization": {
    "id": "viz-001",
    "workflow_id": "workflow-001",
    "view_type": "2d",
    "engine": "reactflow",
    "auto_layout": {
      "algorithm": "dagre",
      "direction": "lr",
      "node_spacing": 50,
      "rank_spacing": 100
    },
    "lanes": [
      {
        "id": "lane-customer",
        "name": "Customer",
        "role_id": "role-customer",
        "orientation": "horizontal"
      }
    ],
    "animation": {
      "enabled": true,
      "edge_flow_enabled": true,
      "highlight_active_path": true
    }
  }
}
```

## SDKs

- **JavaScript/Browser**: `sdk/javascript/` - AWA Visualization Library (ReactFlow + Babylon.js)
- **TypeScript/Node.js**: `sdk/typescript/`
- **Python**: `sdk/python/`
- **Java**: `sdk/java/`

## Examples

See the `examples/` directory for complete workflow examples:

- [Order Processing](examples/order-processing.awa.json) - AI-assisted order fulfillment
- [Insurance Claims Management](examples/insurance-claims-management.awa.json) - 95% automated claims workflow

### Visualization Examples

| Example | Type | JSON Config | HTML Demo |
|---------|------|-------------|-----------|
| 2D Swimlanes | ReactFlow + Dagre | [JSON](examples/visualization-2d-swimlanes.json) | [HTML](examples/visualization-2d-swimlanes.html) |
| 2D ELK Hierarchy | ReactFlow + ELK | [JSON](examples/visualization-2d-elk-hierarchy.json) | [HTML](examples/visualization-2d-elk-hierarchy.html) |
| 3D Spatial | Babylon.js | [JSON](examples/visualization-3d-spatial.json) | [HTML](examples/visualization-3d-spatial.html) |
| 3D Pipeline | Babylon.js | [JSON](examples/visualization-3d-pipeline.json) | [HTML](examples/visualization-3d-pipeline.html) |

## License

Apache 2.0
