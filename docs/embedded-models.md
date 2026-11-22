# Embedded models

The `embedded` provider runs an open-source model inside the engine's own process, with [Transformers.js](https://huggingface.co/docs/transformers.js) and ONNX weights. There is no server to run and no API key, and no data leaves the machine.

```bash
npm install @huggingface/transformers
```

```bash
awa run workflow.awa.json --providers embedded
```

In code:

```ts
import { WorkflowEngine, EmbeddedModelProvider } from 'agentic-workflow-architecture';

const engine = new WorkflowEngine(workflow, {
    model_providers: [new EmbeddedModelProvider()],
    model_tiers: { fast: 'embedded:default' },
});
```

A model reference is `embedded:default` or `embedded:<Hugging Face model id>`, for any model that publishes ONNX weights.

## Without network access

Weights are downloaded on first use and cached. To run offline, download the model once and point the provider at the directory that holds it:

```ts
new EmbeddedModelProvider({ local_path: '/opt/awa/models' });
// expects /opt/awa/models/HuggingFaceTB/SmolLM2-360M-Instruct/{config.json, tokenizer.json, tokenizer_config.json, generation_config.json, onnx/model_q4.onnx}
```

With the CLI, set `AWA_EMBEDDED_MODELS` to that directory, and `AWA_EMBEDDED_MODEL` to change the default model.

## What it is good for, measured

These figures come from running the provider on 4 CPU cores, no GPU, with 4-bit weights (`q4`). The task was a two-option routing decision ("pay small routine claims, send large or unusual ones to review") over 12 cases, using the engine's decision prompt. Twelve cases is a small sample: read the accuracy column as an indication, not a benchmark.

| Model | Weights | Time per decision | Valid replies | Correct |
|---|---|---|---|---|
| `HuggingFaceTB/SmolLM2-360M-Instruct` (default) | 388 MB | about 0.9 s | 12 of 12 | 6 of 12 |
| `onnx-community/Qwen2.5-0.5B-Instruct` | 786 MB | about 2.1 s | 12 of 12 | 6 of 12 |
| `HuggingFaceTB/SmolLM2-1.7B-Instruct` | 1.4 GB | about 5.9 s | 12 of 12 | 9 of 12 |

The default model used about 1 GB of memory once loaded.

What this shows:

- **Every model followed the reply format.** All replies were valid JSON naming one of the offered options, so the engine could always read them.
- **Models under 1B parameters did not judge.** Each gave the same option for every case, which is what 6 of 12 means here. Do not rely on them for decisions that need judgement.
- **The 1.7B model judged better but not well**, and is six times slower.

## Recommendations

- Use a decision table for every case you can state as a rule, and a model only for the rest (`strategy: table_first`, the default when a decision has a table).
- For judgement, prefer a 3B to 4B open-source model served by [Ollama](https://ollama.com) (`--providers ollama`), or a hosted model, and keep the embedded model as the last fallback of a tier: `fast: ['ollama:…', 'embedded:default']`. The workflow then keeps running when nothing else is reachable.
- When an embedded model does decide, set `min_confidence` and a `default_output_edge_id` that leads to a person, so a weak decision is not acted on.
- Embedded models do not call tools. The router never selects one for a request that carries tools.
- Test your own decisions on your own cases before relying on any small model.
