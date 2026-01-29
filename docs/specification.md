# AWA Specification

This document provides a comprehensive overview of the Agentic Workflow Architecture (AWA) specification.

## Table of Contents

1. [Overview](#overview)
2. [Core Entities](#core-entities)
3. [Context Management](#context-management)
4. [Access Rights](#access-rights)
5. [Decision Tables](#decision-tables)
6. [Value Stream Mapping](#value-stream-mapping)
7. [Multi-Format Support](#multi-format-support)

## Overview

AWA is a specification for defining, executing, and analyzing business workflows in the age of AI agents. It extends traditional BPMN concepts with:

- **First-class AI agent support**: Activities can be performed by `human`, `ai_agent`, `robot`, or `application` actors
- **Shared context patterns**: Explicit mechanisms for multi-agent collaboration
- **Access right declarations**: Declarative `requires` and `provisions` semantics
- **Built-in analytics**: Value stream mapping with DOWNTIME waste categories

## Core Entities

### Workflow

A workflow is a directed graph of activities, events, and decision nodes.

| Field | Type | Description |
|-------|------|-------------|
| `id` | UUID | Unique identifier |
| `name` | string | Workflow name |
| `version` | string | Semantic version (e.g., "1.0.0") |
| `description` | string | Optional description |
| `activities` | Activity[] | List of activities |
| `edges` | Edge[] | Connections between nodes |
| `contexts` | Context[] | Shared contexts |
| `decision_nodes` | DecisionNode[] | Decision logic |
| `sla` | SLA | Service level agreement |
| `analytics` | Analytics | Value stream metrics |

### Activity

An activity represents a unit of work performed by an actor.

| Field | Type | Description |
|-------|------|-------------|
| `id` | UUID | Unique identifier |
| `name` | string | Activity name |
| `description` | string | Natural language description (AI-elicitable) |
| `role_id` | UUID | Reference to role definition |
| `actor_type` | ActorType | `human`, `ai_agent`, `robot`, `application` |
| `system_id` | UUID | Optional reference to System |
| `machine_id` | UUID | Optional reference to Machine |
| `context_bindings` | ContextBinding[] | How activity accesses contexts |
| `access_rights` | AccessRight[] | Required/provisioned permissions |
| `programs` | Program[] | Executable code/MCP tools |
| `controls` | Control[] | Compliance policies |
| `sla` | SLA | Activity-level SLA |
| `analytics` | Analytics | Activity-level metrics |

### Edge

Edges connect nodes in the workflow graph.

| Field | Type | Description |
|-------|------|-------------|
| `id` | UUID | Unique identifier |
| `source_id` | UUID | Source node ID |
| `target_id` | UUID | Target node ID |
| `source_type` | NodeType | `activity`, `event`, `decision` |
| `target_type` | NodeType | `activity`, `event`, `decision` |
| `condition` | string | Optional conditional expression |
| `is_default` | boolean | Default path from decision |

## Context Management

Contexts enable multi-agent collaboration through shared data.

### Context Types

| Type | Description |
|------|-------------|
| `document` | Shared documents |
| `data` | Structured data objects |
| `config` | Configuration state |
| `state` | Workflow state |
| `memory` | Agent memory/reasoning |
| `artifact` | Generated artifacts |

### Sync Patterns

| Pattern | Description |
|---------|-------------|
| `shared_state` | Direct read/write to shared state |
| `message_passing` | Message-based communication |
| `blackboard` | Classic AI blackboard pattern |
| `event_sourcing` | Immutable event log |

### Context Bindings

Activities bind to contexts with specific access modes:

| Mode | Description |
|------|-------------|
| `read` | Read-only access |
| `write` | Write-only access |
| `read_write` | Full access |
| `subscribe` | Receive updates |
| `publish` | Send updates |

## Access Rights

Access rights declare what permissions an activity requires or provisions.

### Direction

| Direction | Description |
|-----------|-------------|
| `requires` | Activity needs this permission |
| `provisions` | Activity grants this permission |

### Resource Types

| Type | Description |
|------|-------------|
| `system` | Enterprise system (ERP, CRM) |
| `api` | External API |
| `database` | Database table/collection |
| `file` | File system resource |
| `service` | Internal service |
| `secret` | Secrets/credentials |

### Permissions

| Permission | Description |
|------------|-------------|
| `read` | Read access |
| `write` | Update access |
| `execute` | Execute access |
| `admin` | Administrative access |
| `delete` | Delete access |
| `create` | Create access |

## Decision Tables

AWA uses DMN-inspired decision tables for routing logic.

### Hit Policies

| Policy | Description |
|--------|-------------|
| `unique` | Only one rule can match |
| `first` | First matching rule wins |
| `priority` | Highest priority rule wins |
| `any` | All matching rules must agree |
| `collect` | Collect all matching outputs |
| `rule_order` | Evaluate in order, collect all |

## Value Stream Mapping

AWA includes built-in analytics for process analysis.

### Metrics

| Metric | Description |
|--------|-------------|
| `process_time` | Time spent actively working |
| `cycle_time` | Total time from start to finish |
| `lead_time` | Time from request to delivery |
| `wait_time` | Time spent waiting |
| `value_added` | Is this activity value-added? |
| `process_cycle_efficiency` | % of value-added time |

### DOWNTIME Waste Categories

| Category | Description |
|----------|-------------|
| `defects` | Errors requiring rework |
| `overproduction` | Producing more than needed |
| `waiting` | Idle time |
| `non_utilized_talent` | Underutilized skills |
| `transport` | Unnecessary movement |
| `inventory` | Excess inventory |
| `motion` | Unnecessary actions |
| `extra_processing` | Over-processing |

## Multi-Format Support

AWA specifications can be serialized to multiple formats:

| Format | Use Case |
|--------|----------|
| JSON Schema | Schema validation |
| Avro | Event streaming (Kafka) |
| OpenAPI 3.1 | REST API |
| GraphQL | Graph queries |
| PostgreSQL DDL | Relational persistence |

## SDKs

Official SDKs are available for:

- TypeScript/Node.js
- Python
- Java

See the `sdk/` directory for implementation details.
