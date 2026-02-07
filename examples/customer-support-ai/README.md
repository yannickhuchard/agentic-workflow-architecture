# Customer Support AI Workflow Example

This example demonstrates the latest AWA features including AI agents, skills, and tool requirements.

## Overview

A customer support workflow that uses an AI agent to analyze and categorize customer queries before routing them to the appropriate support team.

## Features Demonstrated

- **AI Agent Integration**: Uses Gemini AI to analyze customer queries
- **Skills**: Defines cognitive skills required for the AI agent
- **Tool Requirements**: Specifies external tools/APIs needed
- **Multi-Actor Workflow**: Combines application and AI agent actors
- **Sequential Flow**: Three-step process from query receipt to routing

## Workflow Structure

### Activities

1. **Receive Customer Query** (Application)
   - Captures incoming support requests
   - Outputs: customer query text

2. **Analyze and Categorize Query** (AI Agent)
   - Uses AI to understand customer intent
   - Categorizes into: Technical, Billing, General, or Urgent
   - Assigns priority: High, Medium, or Low
   - **Skills Required**: Customer Support Analysis (ai_context)
   - **Tools Required**: Knowledge Base API (rest_api)

3. **Route to Support Team** (Application)
   - Routes based on category and priority
   - Final step in the workflow

### Roles

- **Support System**: Automated application for ticket management
- **AI Support Analyst**: AI agent with NLU capabilities

## Running the Example

### Without AI (Simulation Mode)

```bash
awa run examples/customer-support-ai/workflow.awa.json --verbose
```

The workflow will complete but skip AI agent execution.

### With AI Agent

Set your Gemini API key:

```bash
export GEMINI_API_KEY=your_api_key_here
awa run examples/customer-support-ai/workflow.awa.json --verbose
```

Or pass it directly:

```bash
awa run examples/customer-support-ai/workflow.awa.json --key your_api_key --verbose
```

## Expected Output

```
Starting workflow: Customer Support Workflow with Skills (...)
Workflow started (Run ID: ...)
[SoftwareAgent] Executing activity: Receive Customer Query (...)
Step 1 completed.
Active tokens: 1
[AIAgent] Executing activity: Analyze and Categorize Query (...)
Step 2 completed.
Active tokens: 1
[SoftwareAgent] Executing activity: Route to Support Team (...)
Step 3 completed.
Active tokens: 0
Workflow finished with status: completed
```

## Key Concepts

### Skills vs Tool Requirements

- **Skills** (`skills`): Cognitive or competency requirements
  - AI Context: Knowledge domains, reasoning capabilities
  - Human Competency: Certifications, authority levels
  
- **Tool Requirements** (`tool_requirements`): Functional/technical dependencies
  - APIs, databases, MCP servers
  - Software packages, hardware interfaces

This semantic separation allows for better:
- Role matching
- Capability planning
- Resource allocation
- Training identification

## Extending the Example

Try modifying:
- Add more categories in the AI prompt
- Include decision nodes for routing logic
- Add context for maintaining conversation history
- Implement SLA tracking for response times
