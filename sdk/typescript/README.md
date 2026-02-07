# AWA TypeScript SDK

The official TypeScript SDK for the Agentic Workflow Architecture (AWA).

## 📦 Installation

### Global Installation (Recommended for CLI)

```bash
npm install -g @awa/sdk
```

After installation, the `awa` command will be available globally:

```bash
awa --version
```

### Project Installation

```bash
npm install @awa/sdk
```

### Development from Source

```bash
cd sdk/typescript
npm install
npm run build
npm link
```

## 🚀 Quick Start

### Using the CLI

Create a workflow file `hello.awa.json`:

```json
{
  "id": "550e8400-e29b-41d4-a716-446655440000",
  "name": "Hello World",
  "version": "1.0.0",
  "activities": [
    {
      "id": "550e8400-e29b-41d4-a716-446655440001",
      "name": "Greet",
      "actor_type": "application",
      "role_id": "550e8400-e29b-41d4-a716-446655440003",
      "inputs": [],
      "outputs": []
    }
  ],
  "edges": [],
  "roles": [
    {
      "id": "550e8400-e29b-41d4-a716-446655440003",
      "name": "System",
      "actor_type": "application"
    }
  ],
  "contexts": []
}
```

Run it:

```bash
awa run hello.awa.json
```

### Using Programmatically

```typescript
import { WorkflowEngine, parse_workflow } from '@awa/sdk';
import fs from 'fs/promises';

// Load and parse workflow
const content = await fs.readFile('workflow.awa.json', 'utf-8');
const workflow = parse_workflow(JSON.parse(content));

// Initialize engine
const engine = new WorkflowEngine(workflow, {
  geminiApiKey: process.env.GEMINI_API_KEY
});

// Execute workflow
await engine.start();
while (engine.getStatus() === 'running') {
  await engine.runStep();
}

console.log('Workflow completed!');
```

## 📖 Features

- **✅ Workflow Runtime**: Execute AWA workflows with a robust engine
- **🔨 Workflow Builder**: Fluent API to construct workflows programmatically
- **🔍 Validation**: Validate workflow schemas against the AWA specification
- **⚡ CLI Tool**: Command-line interface for running workflows
- **🌐 REST API**: HTTP server for triggering workflows remotely
- **📊 VSM & Analytics**: Real-time tracking of DOWNTIME waste and process metrics

## 🛠️ CLI Commands

### Run a Workflow

```bash
# Basic execution
awa run workflow.awa.json

# With verbose output
awa run workflow.awa.json --verbose

# With API key for AI agents
awa run workflow.awa.json --key YOUR_GEMINI_API_KEY
```

### Start API Server

```bash
# Default port (3000)
awa serve

# Custom port
awa serve --port 8080
```

Then trigger workflows via HTTP:

```bash
curl -X POST http://localhost:3000/api/v1/workflows/run \
  -H "Content-Type: application/json" \
  -d '{"filePath": "./workflow.awa.json"}'
```

## 📚 Documentation

- **[CLI Guide](./docs/cli-guide.md)** - Complete installation and usage guide with examples
- **[Operational API](./docs/operational-api.md)** - REST API documentation
- **[AWA Specification](../../spec)** - Full schema definitions

## 🎯 Examples

Check out the `examples` folder for sample workflows:

```bash
# Simple sequential workflow
awa run ../../examples/bank-account-opening/workflow.awa.json

# AI-powered workflow
awa run ../../examples/skills-demonstration/scenario.awa.json --verbose
```

## 🔑 Environment Variables

- `GEMINI_API_KEY` - Required for workflows using AI agents

## 📄 License

Apache-2.0

