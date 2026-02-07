# Retail Distribution Order Fulfillment Workflow

A comprehensive, production-ready agentic workflow for retail distribution order fulfillment.

## Overview

This workflow demonstrates an end-to-end order fulfillment process with **12 activities** and **2 decision nodes**, showcasing the full capabilities of the AWA specification for retail distribution.

## Workflow Statistics

- **Activities**: 12
- **Decision Nodes**: 2 (with decision tables)
- **Actor Types**: 5 (Application, AI Agent, Robot, Human)
- **Roles**: 5 distinct roles
- **Edges**: 16 transitions
- **Contexts**: 1 shared state

## Process Flow

### Phase 1: Order Validation (Activities 1-3)

1. **Receive Customer Order** (Application)
   - Captures order details, customer info, items, and delivery address

2. **Validate Customer Credit** (AI Agent)
   - AI-powered credit risk assessment
   - Evaluates payment history and creditworthiness
   - **Skill**: Credit Risk Assessment
   - Outputs: credit approval, limit, risk score

3. **Decision: Credit Approval**
   - **Rule 1**: If approved AND risk_score < 30 → Proceed
   - **Rule 2**: If not approved OR risk_score > 30 → Reject order

### Phase 2: Inventory Management (Activities 3-4)

3. **Check Inventory Availability** (Application)
   - Verifies stock across all warehouses
   - Identifies available locations

4. **Decision: Inventory Availability**
   - **Rule 1**: If full stock available → Proceed to fulfillment
   - **Rule 2**: If no stock or partial only → Backorder/notify customer

5. **Reserve Inventory** (Application)
   - Locks inventory for the order
   - Creates reservation ID

### Phase 3: Logistics Optimization (Activity 5)

6. **Optimize Delivery Route** (AI Agent)
   - AI-powered route optimization
   - **Skill**: Logistics Optimization
   - **Tool**: Maps and Routing API
   - Selects optimal warehouse and calculates delivery time/cost

### Phase 4: Warehouse Operations (Activities 6-8)

7. **Pick Items from Warehouse** (Robot)
   - Automated or robotic picking
   - Scans and collects items

8. **Quality Control Inspection** (Human)
   - Manual quality inspection
   - **Skill**: Quality Inspection Certification (Level 2)
   - Checks for defects and accuracy

9. **Package Order** (Application)
   - Packages items with appropriate materials
   - Records weight and dimensions

### Phase 5: Shipping & Notification (Activities 9-12)

10. **Generate Shipping Label** (Application)
    - Creates label and tracking number
    - Assigns carrier

11. **Dispatch to Carrier** (Application)
    - Hands off to shipping carrier
    - Records dispatch time

12. **Send Customer Notification** (Application)
    - Notifies customer with tracking info

13. **Update Order Status** (Application)
    - Marks order as shipped in system

## Actor Types Demonstrated

| Actor Type | Count | Examples |
|------------|-------|----------|
| Application | 7 | Order system, inventory, packaging |
| AI Agent | 2 | Credit analysis, logistics optimization |
| Robot | 1 | Warehouse picking robot |
| Human | 1 | Quality inspector |

## Decision Logic

### Decision 1: Credit Approval

```
IF credit_approved = true AND risk_score < 30
  THEN proceed to inventory check
ELSE
  THEN reject order and update status
```

### Decision 2: Inventory Availability

```
IF stock_available = true AND partial_fulfillment = false
  THEN proceed to reserve inventory
ELSE
  THEN backorder and notify customer
```

## Running the Workflow

### Basic Execution (Simulation Mode)

```bash
awa run examples/retail-distribution/workflow.awa.json --verbose
```

This runs without AI agents (simulation mode).

### With AI Agents

```bash
export GEMINI_API_KEY=your_api_key
awa run examples/retail-distribution/workflow.awa.json --verbose
```

The AI agents will:
- **Credit Analysis AI**: Evaluate customer creditworthiness
- **Logistics Optimizer AI**: Determine optimal delivery routes

## Key Features

### 1. Multi-Actor Collaboration
- Seamless handoffs between applications, AI, robots, and humans
- Each actor type handles tasks suited to its capabilities

### 2. Decision-Driven Routing
- Business rules encoded in decision tables
- Automatic routing based on credit and inventory status

### 3. Skills & Tool Requirements
- **Skills**: Cognitive capabilities (credit analysis, logistics optimization)
- **Tools**: External dependencies (Maps API, Knowledge Base)

### 4. Shared Context
- Order data context maintains state across all activities
- Enables data sharing between actors

### 5. Quality Gates
- Human quality inspection ensures accuracy
- Credit validation prevents bad debt

## Business Value

- **Automation**: 10 of 12 steps fully automated
- **AI Enhancement**: Credit risk and logistics optimization
- **Quality Assurance**: Human oversight at critical points
- **Flexibility**: Decision nodes enable dynamic routing
- **Traceability**: Complete audit trail through workflow

## Extending the Workflow

### Add More Decision Points
- Payment method routing
- Express vs. standard shipping
- International vs. domestic handling

### Add Analytics
- SLA tracking for each activity
- Cost analysis per order
- Throughput metrics

### Add Error Handling
- Retry logic for failed API calls
- Escalation paths for quality failures
- Compensation flows for cancellations

## Production Considerations

1. **API Integration**: Connect to real credit bureaus, inventory systems
2. **Robot Integration**: Interface with actual warehouse automation
3. **Human Task Queues**: Implement task management for quality inspectors
4. **Event Streaming**: Publish events for real-time tracking
5. **Monitoring**: Add observability for each activity
