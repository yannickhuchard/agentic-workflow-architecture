import { Command } from 'commander';
import { GoogleGenerativeAI } from '@google/generative-ai';
import fs from 'fs/promises';
import path from 'path';

export const generateCommand = new Command('generate')
    .description('Generate an AWA workflow from a natural language prompt')
    .argument('<prompt>', 'Description of the workflow to generate')
    .option('-o, --output <file>', 'Output file name', 'workflow.awa.json')
    .option('-k, --key <key>', 'Gemini API Key')
    .action(async (prompt, options) => {
        const apiKey = options.key || process.env.GEMINI_API_KEY;
        if (!apiKey) {
            console.error('Error: Gemini API Key is required. Set GEMINI_API_KEY env var or use --key flag.');
            process.exit(1);
        }

        console.log(`🚀 Generating AWA workflow for: "${prompt}"...`);

        const genAI = new GoogleGenerativeAI(apiKey);
        const model = genAI.getGenerativeModel({ 
            model: 'gemini-3.1-pro-preview',
            generationConfig: { responseMimeType: "application/json" }
        });

        const systemInstruction = `
You are an expert architect for the Agentic Workflow Architecture (AWA) framework.
Your task is to generate a valid AWA Workflow JSON object based on a user's natural language description.

### AWA Specification Rules:
1. Every workflow MUST have: id (UUID), name, version (x.y.z), activities[], and edges[].
2. Actor Types: 'ai_agent', 'human', 'robot', 'application'.
3. Activities: MUST have id (UUID), name, role_id (UUID), and actor_type.
4. AI Agents: MUST have a 'verification' policy with at least one criterion if quality is important.
5. Edges: Connect activities via source_id and target_id. Use UUIDs.
6. Contexts: Define shared data objects (type: 'data', 'document', 'memory') used across activities.
7. UUIDs: Generate valid random UUIDs for all IDs.

### Output Format:
Respond ONLY with a valid JSON object matching the AWA Workflow schema.
`;

        try {
            const result = await model.generateContent({
                contents: [
                    { role: 'user', parts: [{ text: systemInstruction + "\n\nUser Request: " + prompt }] }
                ]
            });

            const responseText = result.response.text();
            
            // Validate it's JSON
            const workflowJson = JSON.parse(responseText);
            
            const outputPath = path.resolve(process.cwd(), options.output);
            await fs.writeFile(outputPath, JSON.stringify(workflowJson, null, 2));

            console.log(`✅ Success! Workflow generated and saved to: ${options.output}`);
            console.log(`Run it with: awa run ${options.output} --simulate`);

        } catch (error: unknown) {
            console.error('❌ Generation failed:', error instanceof Error ? error.message : String(error));
            process.exit(1);
        }
    });
