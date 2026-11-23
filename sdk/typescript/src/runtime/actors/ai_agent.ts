import { DEFAULT_AI_MODEL_ID } from '../model_config';
import { ChatMessage, ModelRegistry, ModelRouter, GoogleModelProvider, RouteAttempt } from '../models';
import { ActorContext } from './actor';
import { Activity, Role } from '../../types';
import { Actor } from './actor';

export class AIAgent implements Actor {
    private models: ModelRegistry;
    private router: ModelRouter;
    private role?: Role;
    private defaultModelId: string;
    private simulate: boolean;

    /**
     * @param apiKey Gemini API key. Used only when no model registry is given.
     * @param models Registry of model providers. If absent, a registry holding
     *               the Google provider is created from `apiKey`.
     */
    constructor(apiKey: string, role?: Role, defaultModelId: string = DEFAULT_AI_MODEL_ID, simulate: boolean = false, models?: ModelRegistry) {
        this.models = models || new ModelRegistry().register(new GoogleModelProvider(apiKey)).fill_standard_tiers();
        this.router = new ModelRouter(this.models);
        this.role = role;
        this.defaultModelId = defaultModelId;
        this.simulate = simulate;
    }

    async execute(activity: Activity, inputs: Record<string, unknown>, context?: ActorContext): Promise<Record<string, unknown>> {
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

        // Resolve the model reference: role > engine default
        const modelRef = this.role?.ai_model_config?.model_id || this.defaultModelId;

        const systemPrompt = this.generateSystemPrompt(activity, !!context?.tools?.specs.length);
        const userMessage = this.generateUserMessage(activity, inputs);
        const temperature = this.role?.ai_model_config?.temperature ?? 0.2;
        const tools = context?.tools;

        try {
            // The conversation: the model may ask for tools any number of times
            // before it answers. Every tool call goes through the engine's runner.
            const messages: ChatMessage[] = [{ role: 'system', content: systemPrompt }, { role: 'user', content: userMessage }];
            const usage = { input_tokens: 0, output_tokens: 0 };
            let route: RouteAttempt[] = [];
            let routed;

            for (;;) {
                routed = await this.router.generate(modelRef, {
                    // A single turn is sent as system + prompt, the simplest form a
                    // provider can receive; the message list is used once there are tool results.
                    ...(messages.length === 2 ? { system: systemPrompt, prompt: userMessage } : { messages }),
                    ...(tools?.specs.length ? { tools: tools.specs } : {}),
                    temperature,
                    max_output_tokens: this.role?.ai_model_config?.max_tokens ?? 1024,
                });
                usage.input_tokens += routed.response.usage.input_tokens;
                usage.output_tokens += routed.response.usage.output_tokens;
                route = routed.route;

                const calls = routed.response.tool_calls || [];
                if (!tools || calls.length === 0) break;

                messages.push({ role: 'assistant', content: routed.response.text, tool_calls: calls, provider_state: routed.response.provider_state });
                for (const call of calls) {
                    const result = await tools.call(call.name, call.arguments, call.id);
                    messages.push({ role: 'tool', tool_call_id: call.id, name: call.name, content: result.content });
                    if (!result.ok && (result.result as { code?: string })?.code === 'TOOL_BUDGET_EXCEEDED') {
                        throw Object.assign(new Error((result.result as { error: string }).error), { code: 'TOOL_BUDGET_EXCEEDED' });
                    }
                }
            }

            const resolved = routed.model;
            const response = { text: routed.response.text, usage };
            const responseText = response.text;

            // Attempt to parse JSON if the response looks like JSON
            const jsonMatch = responseText.match(/\{[\s\S]*\}/);
            let output: unknown = responseText;
            let reasoning: unknown;
            let contextWrites: unknown;
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
                // What the model writes to contexts goes to the engine, which checks it against the bindings (22.3)
                contextWrites = (output as { _context_writes?: unknown })._context_writes;
                output = (output as { output: unknown }).output;
            }

            return {
                output,
                ...(contextWrites !== undefined ? { _context_writes: contextWrites } : {}),
                ...(reasoning && typeof reasoning === 'object' ? { _reasoning: reasoning } : {}),
                _model: {
                    id: resolved.model,
                    provider: resolved.provider.id,
                    requested: modelRef,
                    ...(resolved.tier ? { tier: resolved.tier } : {}),
                    source: this.role?.ai_model_config?.model_id ? 'role' : 'engine_default',
                    temperature,
                    route,
                },
                status: 'complex_completed',
                usage: response.usage
            };


        } catch (error: unknown) {
            console.error('[AIAgent] Execution failed:', error);
            const code = (error as { code?: unknown })?.code;
            throw Object.assign(
                new Error(`AIAgent execution failed: ${error instanceof Error ? error.message : String(error)}`),
                typeof code === 'string' ? { code } : {});
        }
    }

    private generateSystemPrompt(activity: Activity, hasTools = false): string {
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

        if (hasTools) {
            lines.push('\nYou have tools. Call them when you need facts or need something done; do not guess what a tool could tell you.');
            lines.push('When you have what you need, give your final answer in the format below.');
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

        // Reviewed knowledge from earlier runs of this activity
        if (Array.isArray(inputs._knowledge) && inputs._knowledge.length > 0) {
            lines.push('## Knowledge from earlier runs');
            lines.push('Use this where it helps. It describes what worked and what was rejected before.\n');
            for (const entry of inputs._knowledge as { title: string; guidance: string }[]) {
                lines.push(`- ${entry.title}: ${entry.guidance}`);
            }
            lines.push('');
        }

        // The contexts the activity is bound to read (22.2): given to the model as what it may read, apart from the run's data
        const contexts = inputs._contexts as Record<string, unknown> | undefined;
        if (contexts && typeof contexts === 'object' && Object.keys(contexts).length > 0) {
            lines.push('## Shared contexts');
            lines.push('Read-only here. To change one your activity may write, return it under "_context_writes" beside "output", by context name.\n');
            lines.push(JSON.stringify(contexts, null, 2));
            lines.push('');
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
