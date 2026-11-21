import { GoogleGenerativeAI } from '@google/generative-ai';
import { Activity, Role } from '../../types';
import { Actor } from './actor';

export class AIAgent implements Actor {
    private genAI: GoogleGenerativeAI;
    private role?: Role;
    private defaultModelId: string;
    private simulate: boolean;

    constructor(apiKey: string, role?: Role, defaultModelId: string = 'gemini-3.1-flash', simulate: boolean = false) {
        this.genAI = new GoogleGenerativeAI(apiKey);
        this.role = role;
        this.defaultModelId = defaultModelId;
        this.simulate = simulate;
    }

    async execute(activity: Activity, inputs: Record<string, unknown>): Promise<Record<string, unknown>> {
        console.log(`[AIAgent] Executing activity: ${activity.name} (${activity.id})`);

        if (this.simulate) {
            console.log(`[AIAgent] SIMULATION: Mocking AI response for "${activity.name}"`);
            // Add simulated delay (1.5s) to represent agent latency for telemetry and visualization polling
            await new Promise(resolve => setTimeout(resolve, 1500));
            return {
                output: { _mocked: true, status: "simulated" },
                status: 'complex_completed',
                usage: { input_tokens: 0, output_tokens: 0 }
            };
        }

        // Resolve model ID: Role config > constructor default > fallback
        const modelId = this.role?.ai_model_config?.model_id || this.defaultModelId;
        const model = this.genAI.getGenerativeModel({ model: modelId });

        const systemPrompt = this.generateSystemPrompt(activity);
        const userMessage = this.generateUserMessage(activity, inputs);

        try {
            // Retrieve config from role if available, otherwise default
            const generationConfig = {
                temperature: this.role?.ai_model_config?.temperature ?? 0.7,
                maxOutputTokens: this.role?.ai_model_config?.max_tokens ?? 1024,
            };

            const result = await model.generateContent({
                contents: [
                    { role: 'user', parts: [{ text: systemPrompt + "\n\n" + userMessage }] }
                ],
                generationConfig
            });

            const responseText = result.response.text();

            // Attempt to parse JSON if the response looks like JSON
            const jsonMatch = responseText.match(/\{[\s\S]*\}/);
            let output: unknown = responseText;
            let reasoning: unknown;
            if (jsonMatch) {
                try {
                    output = JSON.parse(jsonMatch[0]);
                } catch (e) {
                    // ignore
                }
            }

            // The agent was asked for { reasoning, output }. Separate the two so the
            // engine can journal the reasoning and pass only the output downstream.
            if (output && typeof output === 'object' && 'reasoning' in output && 'output' in output) {
                reasoning = (output as { reasoning: unknown }).reasoning;
                output = (output as { output: unknown }).output;
            }

            return {
                output,
                ...(reasoning && typeof reasoning === 'object' ? { _reasoning: reasoning } : {}),
                _model: {
                    id: modelId,
                    provider: 'google',
                    source: this.role?.ai_model_config?.model_id ? 'role' : 'engine_default',
                    temperature: generationConfig.temperature,
                },
                status: 'complex_completed',
                usage: {
                    input_tokens: result.response.usageMetadata?.promptTokenCount || 0,
                    output_tokens: result.response.usageMetadata?.candidatesTokenCount || 0,
                }
            };


        } catch (error: unknown) {
            console.error('[AIAgent] Execution failed:', error);
            throw new Error(`AIAgent execution failed: ${error instanceof Error ? error.message : String(error)}`);
        }
    }

    private generateSystemPrompt(activity: Activity): string {
        const lines: string[] = [];

        // 1. Role Identity
        if (this.role) {
            lines.push(`You are a ${this.role.name}.`);
            if (this.role.description) {
                lines.push(this.role.description);
            }
            if (this.role.capabilities && this.role.capabilities.length > 0) {
                lines.push(` Your capabilities are: ${this.role.capabilities.join(', ')}.`);
            }
        } else {
            lines.push('You are an intelligent AI agent.');
        }

        // 2. Activity Context
        lines.push(`\nYou are responding to a request to perform the activity: "${activity.name}".`);
        if (activity.description) {
            lines.push(`Description: ${activity.description}`);
        }

        if (activity.procedure) {
            lines.push(`Procedure: ${activity.procedure}`);
        }

        // 3. Output Format Instruction
        lines.push('\nRespond with a single JSON object that has exactly two properties:');
        lines.push('- "reasoning": an object with "plan" (array of the steps you took), "rationale" (why this result is right),');
        lines.push('  "alternatives_considered" (array of approaches you rejected and why) and "confidence" (number from 0 to 1).');
        lines.push('- "output": the result of the activity. Use a JSON object if the activity implies structured data, otherwise a string.');

        return lines.join('\n');
    }

    private generateUserMessage(activity: Activity, inputs: Record<string, unknown>): string {
        const lines: string[] = [];

        // Inject verification corrective feedback from previous failed attempt
        if (inputs._verification_feedback) {
            lines.push('## ⚠️ IMPORTANT: Previous Attempt Failed Verification');
            lines.push('Your previous output did NOT pass quality verification.');
            lines.push('You MUST correct your output based on the following feedback:\n');
            lines.push(String(inputs._verification_feedback));
            lines.push(`\nThis is attempt #${inputs._verification_attempt || 'unknown'}. Please ensure your output fully satisfies ALL criteria.\n`);
        }

        // Filter out internal AWA fields from displayed context
        const displayInputs: Record<string, unknown> = {};
        for (const [key, value] of Object.entries(inputs)) {
            if (!key.startsWith('_')) {
                displayInputs[key] = value;
            }
        }

        lines.push('## Input Context');
        if (Object.keys(displayInputs).length > 0) {
            lines.push(JSON.stringify(displayInputs, null, 2));
        } else {
            lines.push('No specific input data provided.');
        }

        if (activity.controls && activity.controls.length > 0) {
            lines.push('\n## Controls & Constraints');
            activity.controls.forEach(c => {
                lines.push(`- ${c.name}: ${c.description || ''} (${c.enforcement})`);
            });
        }

        // Inject verification criteria as explicit instructions
        if (activity.verification && activity.verification.enabled && activity.verification.criteria.length > 0) {
            lines.push('\n## Acceptance Criteria (Your output will be verified against these)');
            activity.verification.criteria.forEach((c, i) => {
                const reqLabel = c.required ? '[REQUIRED]' : '[OPTIONAL]';
                lines.push(`${i + 1}. ${c.name} ${reqLabel}: ${c.description}`);
            });
        }

        lines.push('\nBased on the above, please perform the activity and generate the output.');

        return lines.join('\n');
    }
}
