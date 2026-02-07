import { GoogleGenerativeAI } from '@google/generative-ai';
import { Activity, Role } from '../../types';
import { Actor } from './actor';

export class AIAgent implements Actor {
    private genAI: GoogleGenerativeAI;
    private model: any;
    private role?: Role;

    constructor(apiKey: string, role?: Role) {
        this.genAI = new GoogleGenerativeAI(apiKey);
        // Using Gemini 2.5 Flash as requested
        this.model = this.genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });
        this.role = role;
    }

    async execute(activity: Activity, inputs: Record<string, any>): Promise<Record<string, any>> {
        console.log(`[AIAgent] Executing activity: ${activity.name} (${activity.id})`);

        const systemPrompt = this.generateSystemPrompt(activity);
        const userMessage = this.generateUserMessage(activity, inputs);

        try {
            // Retrieve config from role if available, otherwise default
            const generationConfig = {
                temperature: this.role?.ai_model_config?.temperature ?? 0.7,
                maxOutputTokens: this.role?.ai_model_config?.max_tokens ?? 1024,
            };

            const result = await this.model.generateContent({
                contents: [
                    { role: 'user', parts: [{ text: systemPrompt + "\n\n" + userMessage }] }
                ],
                // Note: System instructions are supported in newer API versions, 
                // but combining into prompt is a safe fallback for all client versions.
                // If the client supports systemInstruction, we could use that.
                // generationConfig: generationConfig
            });

            const responseText = result.response.text();

            // Attempt to parse JSON if the response looks like JSON
            try {
                const jsonMatch = responseText.match(/\{[\s\S]*\}/);
                if (jsonMatch) {
                    return JSON.parse(jsonMatch[0]);
                }
            } catch (e) {
                // Ignore parse error, return text
            }

            return {
                output: responseText,
                status: 'complex_completed'
            };

        } catch (error: any) {
            console.error('[AIAgent] Execution failed:', error);
            throw new Error(`AIAgent execution failed: ${error.message}`);
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

        // 3. Output Format Instruction
        lines.push('\nPlease provide your output in a structured JSON format if the activity implies structured data, otherwise provide a clear textual response.');

        return lines.join('\n');
    }

    private generateUserMessage(activity: Activity, inputs: Record<string, any>): string {
        const lines: string[] = [];

        lines.push('## Input Context');
        if (Object.keys(inputs).length > 0) {
            lines.push(JSON.stringify(inputs, null, 2));
        } else {
            lines.push('No specific input data provided.');
        }

        if (activity.controls && activity.controls.length > 0) {
            lines.push('\n## Controls & Constraints');
            activity.controls.forEach(c => {
                lines.push(`- ${c.name}: ${c.description || ''} (${c.enforcement})`);
            });
        }

        lines.push('\nBased on the above, please perform the activity and generate the output.');

        return lines.join('\n');
    }
}
