# Operational API: Training Guide

This guide provides a comprehensive, step-by-step walkthrough of the Agentic Workflow Architecture (AWA) Operational API.
The Operational API consists of two main components:
1.  **AWA CLI (`awa`)**: A command-line interface to execute workflows directly.
2.  **AWA REST API**: A server that allows triggering workflows via HTTP requests.

---

## 1. Installation

To use the Operational API, you need to have the `@awa/sdk` package built and installed.

### Prerequisites
- Node.js (v18 or higher)
- npm

### Setup
If you are working within the AWA repository:
```bash
cd sdk/typescript
npm install
npm run build
```

This will compile the TypeScript code into the `dist` directory, making the `awa` command available.

---

## 2. Using the CLI (`awa`)

The CLI is the primary tool for testing and running workflows manually.

### Basic Usage
To run a workflow defined in a `.awa.json` file:

```bash
node dist/cli/index.js run <path-to-workflow-file>
```

### Options
- `--verbose, -v`: Enable verbose output to see step-by-step execution details.
- `--key, -k <key>`: Provide your Gemini API Key directly (or use `GEMINI_API_KEY` env var).

### Example
Let's run a simple test workflow.

1.  **Create a workflow file** (e.g., `my-workflow.awa.json`). Ensure all IDs are valid UUIDs.
    ```json
    {
      "id": "550e8400-e29b-41d4-a716-446655440000",
      "name": "Demo Workflow",
      "version": "1.0.0",
      "activities": [
        {
          "id": "550e8400-e29b-41d4-a716-446655440001",
          "actor_type": "application", 
          "name": "Hello",
          "role_id": "550e8400-e29b-41d4-a716-446655440003",
          "inputs": [],
          "outputs": []
        }
      ],
      "edges": [],
      "roles": [{ "id": "550e8400-e29b-41d4-a716-446655440003", "name": "System", "actor_type": "application" }],
      "contexts": []
    }
    ```

2.  **Run the workflow**:
    ```bash
    node dist/cli/index.js run my-workflow.awa.json --verbose
    ```

3.  **Expected Output**:
    ```
    Starting workflow: Demo Workflow (...)
    Workflow started (Run ID: ...)
    Step 1 completed.
    Active tokens: 0
    Workflow finished with status: completed
    ```

---

## 3. Using the REST API

The REST API allows external systems to trigger AWA workflows.

### Starting the Server
To start the API server:

```bash
node dist/cli/index.js serve --port 3000
```
*Output: `AWA Operational API running on http://localhost:3000`*

### Endpoints

#### `POST /api/v1/workflows/run`
Triggers a workflow execution.

**Headers**:
- `Content-Type: application/json`

**Body**:
```json
{
  "filePath": "./examples/skills-demonstration/scenario.awa.json",
  "apiKey": "optional-gemini-api-key"
}
```

**Response**:
```json
{
  "runId": "uuid-...",
  "status": "running",
  "message": "Workflow started"
}
```

### Example Request (curl)
```bash
curl -X POST http://localhost:3000/api/v1/workflows/run \
  -H "Content-Type: application/json" \
  -d '{"filePath": "./tests/fixtures/simple-workflow.awa.json"}'
```

---

## 4. Troubleshooting

- **Error: `filePath is required`**: ensuring you are sending the JSON body correctly.
- **Error: `Invalid workflow definition`**: The JSON file provided does not match the AWA schema (e.g., invalid UUIDs).
- **Error: `Gemini API Key required`**: If your workflow uses AI Agents, you must provide an API key via environment variable or request body.

---

## 5. Next Steps
- Explore the `examples` folder for more complex workflows.
- Integrate the REST API into your frontend or other microservices.
