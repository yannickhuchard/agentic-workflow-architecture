# Skills Demonstration Scenario

This example demonstrates how to use the `skills` property in AWA to define competency and capability requirements for AI Agents and Human actors.

## Scenario: Loan Application

The process consists of two main activities:

1.  **Analyze Credit Risk (AI Agent)**:
    *   **Required Skills**:
        *   `Financial Risk Assessment` (AI Context): The agent must have the context/knowledge to understand financial data.
        *   `Credit Report Parsing` (Tool Proficiency): The agent must be proficient in using the specific tool for fetching credit reports.

2.  **Approve Loan Limit (Human Manager)**:
    *   **Required Skills**:
        *   `Loan Approval Authority Level 2` (Human Competency): The human user must hold the appropriate authority level to approve the transaction.

## Key Concepts

*   **AI Context Skills**: Define the domain knowledge or "system instructions" required for an AI model to perform the task effectively.
*   **Tool Proficiency**: Explicitly lists the tools the agent must be able to use, which can be mapped to MCP servers or API capabilities.
*   **Human Competency**: Defines organizational requirements, certifications, or authority levels needed for human tasks, useful for routing work in worklists.
