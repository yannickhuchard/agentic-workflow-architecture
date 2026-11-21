/**
 * AWA Model Binding (specification section 12)
 *
 * Workflows name models by reference; the engine resolves a reference to a
 * provider at run time. Nothing in a workflow document or in the engine core
 * depends on a particular vendor.
 *
 * A model reference is one of:
 *   "tier:<name>"          a capability tier the deployment maps to a model
 *   "<provider>:<model>"   a specific model of a registered provider
 *   "<model>"              a model of the default provider
 */

import { GoogleGenerativeAI } from '@google/generative-ai';

/** A function the model may ask to have called */
export interface ToolSpec {
    name: string;
    description?: string;
    /** JSON Schema of the arguments object */
    parameters: Record<string, unknown>;
}

/** A model's request to call a tool */
export interface ToolCall {
    id: string;
    name: string;
    arguments: Record<string, unknown>;
}

export type ChatMessage =
    | { role: 'system' | 'user'; content: string }
    | {
        role: 'assistant'; content: string; tool_calls?: ToolCall[];
        /** Opaque data the provider returned with this turn and needs back to continue it */
        provider_state?: unknown;
    }
    | { role: 'tool'; tool_call_id: string; name: string; content: string };

/**
 * One request in the unified format. Every provider adapter translates this
 * to its vendor's API and back, so callers never see a vendor format.
 */
export interface ModelRequest {
    /** Provider-specific model name, already resolved */
    model: string;
    /** Standing instructions for the model */
    system?: string;
    /** The request, when the conversation is a single user turn */
    prompt?: string;
    /** The conversation, when there is more than one turn. Takes precedence over `prompt`. */
    messages?: ChatMessage[];
    /** Tools the model may call */
    tools?: ToolSpec[];
    /** Ask for a JSON object as the reply */
    json?: boolean;
    temperature?: number;
    max_output_tokens?: number;
}

export interface ModelResponse {
    text: string;
    tool_calls?: ToolCall[];
    usage: { input_tokens: number; output_tokens: number };
    /** Opaque continuation data; put it on the assistant message when replying with tool results */
    provider_state?: unknown;
}

export interface ModelProvider {
    /** Provider identifier used in model references, e.g. "google" */
    readonly id: string;
    /** What the provider can do. Absent means text generation only. */
    readonly capabilities?: { tools?: boolean };
    generate(request: ModelRequest): Promise<ModelResponse>;
}

export interface ResolvedModel {
    provider: ModelProvider;
    model: string;
    /** Canonical reference: "<provider>:<model>" */
    ref: string;
    /** The tier the reference went through, if any */
    tier?: string;
}

/** The conversation of a request: its messages, or its system and prompt as two turns */
export function request_messages(request: ModelRequest): ChatMessage[] {
    const turns: ChatMessage[] = request.messages
        ? [...request.messages]
        : [{ role: 'user', content: request.prompt || '' }];
    if (request.system && !turns.some(m => m.role === 'system')) turns.unshift({ role: 'system', content: request.system });
    return turns;
}

/** Capability tiers every deployment SHOULD map (specification 12.2) */
export const STANDARD_TIERS = ['reasoning', 'balanced', 'fast'] as const;

export class ModelRegistry {
    private providers = new Map<string, ModelProvider>();
    private tiers = new Map<string, string[]>();
    private default_provider?: string;

    register(provider: ModelProvider, options: { default?: boolean } = {}): this {
        this.providers.set(provider.id, provider);
        if (options.default || !this.default_provider) this.default_provider = provider.id;
        return this;
    }

    /**
     * Map a tier to a model reference, or to an ordered list of them. With a
     * list the router uses the first that can serve the request and falls back
     * to the next if a provider fails, e.g.
     * set_tier('fast', ['google:gemini-3.8-flash', 'ollama:qwen3:4b', 'embedded:default'])
     */
    set_tier(tier: string, ref: string | string[]): this {
        const refs = Array.isArray(ref) ? ref : [ref];
        if (refs.length === 0) throw new Error(`Model tier "${tier}" needs at least one model reference`);
        this.tiers.set(tier, refs);
        return this;
    }

    set_default_provider(id: string): this {
        this.default_provider = id;
        return this;
    }

    has_providers(): boolean {
        return this.providers.size > 0;
    }

    private resolve_direct(target: string, origin: string, tier?: string): ResolvedModel {
        const colon = target.indexOf(':');
        const named = colon > 0 ? target.slice(0, colon) : undefined;
        // "ft:custom:v2" style names contain a colon but no provider; only treat the
        // part before ":" as a provider when one is registered under that name.
        const is_provider = !!named && this.providers.has(named);
        const provider = this.providers.get(is_provider ? named! : this.default_provider || '');
        if (!provider) {
            throw Object.assign(new Error(`No model provider is registered for "${origin}"`), { code: 'VALIDATION_ERROR' });
        }
        const model = is_provider ? target.slice(colon + 1) : target;
        return { provider, model, ref: `${provider.id}:${model}`, ...(tier ? { tier } : {}) };
    }

    /**
     * Every model a reference can resolve to, in order of preference.
     * Candidates whose provider is not registered are left out, so one tier
     * map can serve deployments with different providers.
     */
    candidates(ref: string): ResolvedModel[] {
        if (!ref.startsWith('tier:')) return [this.resolve_direct(ref, ref)];

        const tier = ref.slice(5);
        const mapped = this.tiers.get(tier);
        if (!mapped) {
            throw Object.assign(new Error(`Model tier "${tier}" is not mapped to a model in this deployment`), { code: 'VALIDATION_ERROR' });
        }
        const resolved: ResolvedModel[] = [];
        for (const target of mapped) {
            if (target.startsWith('tier:')) {
                throw Object.assign(new Error(`Model tier "${tier}" must map to a model, not to another tier`), { code: 'VALIDATION_ERROR' });
            }
            const colon = target.indexOf(':');
            const named = colon > 0 ? target.slice(0, colon) : undefined;
            if (mapped.length > 1 && named && !this.providers.has(named) && /^[a-z][a-z0-9_-]*$/.test(named)) continue;
            resolved.push(this.resolve_direct(target, ref, tier));
        }
        if (resolved.length === 0) {
            throw Object.assign(new Error(`No provider is registered for any model of tier "${tier}" (${mapped.join(', ')})`), { code: 'VALIDATION_ERROR' });
        }
        return resolved;
    }

    /** The preferred model for a reference */
    resolve(ref: string): ResolvedModel {
        return this.candidates(ref)[0];
    }
}

export interface RouteAttempt {
    ref: string;
    outcome: 'used' | 'skipped' | 'failed';
    reason?: string;
}

export interface RoutedResponse {
    response: ModelResponse;
    model: ResolvedModel;
    /** Every candidate considered, in order, and what happened to it */
    route: RouteAttempt[];
}

/**
 * The single entry point for calling a model (specification 12.5).
 * Given a model reference and a request in the unified format, the router
 * picks the first candidate able to serve it, and falls back to the next
 * when a provider fails. It reports the route it took.
 */
export class ModelRouter {
    constructor(private registry: ModelRegistry) { }

    async generate(ref: string, request: Omit<ModelRequest, 'model'>): Promise<RoutedResponse> {
        const route: RouteAttempt[] = [];
        const needs_tools = !!request.tools?.length;
        let last_error: unknown;

        for (const candidate of this.registry.candidates(ref)) {
            if (needs_tools && !candidate.provider.capabilities?.tools) {
                route.push({ ref: candidate.ref, outcome: 'skipped', reason: 'provider cannot call tools' });
                continue;
            }
            try {
                const response = await candidate.provider.generate({ ...request, model: candidate.model });
                route.push({ ref: candidate.ref, outcome: 'used' });
                return { response, model: candidate, route };
            } catch (error) {
                last_error = error;
                const code = (error as { code?: string })?.code;
                route.push({ ref: candidate.ref, outcome: 'failed', reason: `${code ? `${code}: ` : ''}${error instanceof Error ? error.message : String(error)}` });
                // A request the provider judged invalid will be invalid for the next one too
                if (code === 'VALIDATION_ERROR') break;
            }
        }

        const summary = route.map(r => `${r.ref} ${r.outcome}${r.reason ? ` (${r.reason})` : ''}`).join('; ');
        const code = (last_error as { code?: string })?.code || (last_error ? 'PROVIDER_ERROR' : 'VALIDATION_ERROR');
        throw Object.assign(new Error(`No model could serve "${ref}": ${summary}`), { code, route });
    }
}

const estimate_tokens = (text: string) => Math.ceil(text.length / 4);

function http_error(provider: string, status: number, detail: string): Error {
    const code = status === 401 ? 'AUTHENTICATION_ERROR'
        : status === 403 ? 'PERMISSION_DENIED'
            : status === 404 ? 'NOT_FOUND'
                : status === 400 || status === 422 ? 'VALIDATION_ERROR'
                    : status === 429 ? 'RATE_LIMITED'
                        : 'PROVIDER_ERROR';
    return Object.assign(new Error(`Model provider "${provider}" returned HTTP ${status}${detail ? `: ${detail.slice(0, 300)}` : ''}`), { code, status });
}

function parse_arguments(raw: unknown): Record<string, unknown> {
    if (raw && typeof raw === 'object') return raw as Record<string, unknown>;
    try {
        const parsed = JSON.parse(String(raw || '{}'));
        return parsed && typeof parsed === 'object' ? parsed : {};
    } catch {
        return {};
    }
}

/**
 * Any service that implements the OpenAI-style `POST /chat/completions`
 * endpoint, including its tool-calling fields. That covers most hosted
 * gateways and every common way of serving open-source models: Ollama,
 * llama.cpp server, vLLM, LM Studio, LocalAI, Hugging Face TGI.
 */
export class OpenAICompatibleModelProvider implements ModelProvider {
    readonly id: string;
    readonly capabilities: { tools: boolean };
    private base_url: string;
    private api_key?: string;

    constructor(config: { id: string; base_url: string; api_key?: string; tools?: boolean }) {
        this.id = config.id;
        this.base_url = config.base_url.replace(/\/+$/, '');
        this.api_key = config.api_key;
        this.capabilities = { tools: config.tools !== false };
    }

    async generate(request: ModelRequest): Promise<ModelResponse> {
        const messages = request_messages(request).map(message => {
            if (message.role === 'tool') return { role: 'tool', tool_call_id: message.tool_call_id, content: message.content };
            if (message.role === 'assistant') {
                // Re-send the provider's own message untouched: it may carry fields this
                // adapter does not know (for example reasoning signatures) that the
                // provider needs back in order to continue the turn.
                if (message.provider_state) return message.provider_state;
                return {
                    role: 'assistant', content: message.content,
                    ...(message.tool_calls?.length ? {
                        tool_calls: message.tool_calls.map(call => ({
                            id: call.id, type: 'function', function: { name: call.name, arguments: JSON.stringify(call.arguments) },
                        })),
                    } : {}),
                };
            }
            return { role: message.role, content: message.content };
        });

        const response = await fetch(`${this.base_url}/chat/completions`, {
            method: 'POST',
            headers: {
                'content-type': 'application/json',
                ...(this.api_key ? { authorization: `Bearer ${this.api_key}` } : {}),
            },
            body: JSON.stringify({
                model: request.model,
                messages,
                ...(request.tools?.length ? {
                    tools: request.tools.map(tool => ({
                        type: 'function', function: { name: tool.name, description: tool.description, parameters: tool.parameters },
                    })),
                } : {}),
                ...(request.json ? { response_format: { type: 'json_object' } } : {}),
                ...(request.temperature !== undefined ? { temperature: request.temperature } : {}),
                ...(request.max_output_tokens !== undefined ? { max_tokens: request.max_output_tokens } : {}),
            }),
        });

        if (!response.ok) throw http_error(this.id, response.status, await response.text().catch(() => ''));

        const body = await response.json() as {
            choices?: { message?: { content?: string | null; tool_calls?: { id?: string; function?: { name?: string; arguments?: unknown } }[] } }[];
            usage?: { prompt_tokens?: number; completion_tokens?: number };
        };
        const message = body.choices?.[0]?.message;
        const tool_calls = (message?.tool_calls || []).map((call, index) => ({
            id: call.id || `call_${index}`,
            name: call.function?.name || '',
            arguments: parse_arguments(call.function?.arguments),
        }));
        return {
            text: message?.content || '',
            ...(tool_calls.length ? { tool_calls, provider_state: message } : {}),
            usage: {
                input_tokens: body.usage?.prompt_tokens || 0,
                output_tokens: body.usage?.completion_tokens || 0,
            },
        };
    }
}

/**
 * OpenAI, through the Responses API (`POST /responses`), which its current
 * models use for tool calling.
 */
export class OpenAIModelProvider implements ModelProvider {
    readonly id: string;
    readonly capabilities = { tools: true };
    private base_url: string;
    private api_key: string;
    /** Set once a model has refused a sampling parameter, so it is not sent again */
    private no_temperature = new Set<string>();

    constructor(config: { api_key: string; id?: string; base_url?: string }) {
        this.id = config.id || 'openai';
        this.api_key = config.api_key;
        this.base_url = (config.base_url || 'https://api.openai.com/v1').replace(/\/+$/, '');
    }

    async generate(request: ModelRequest): Promise<ModelResponse> {
        const turns = request_messages(request);
        const instructions = turns.filter(m => m.role === 'system').map(m => m.content).join('\n\n');
        const input: unknown[] = [];
        for (const message of turns) {
            if (message.role === 'system') continue;
            if (message.role === 'tool') {
                input.push({ type: 'function_call_output', call_id: message.tool_call_id, output: message.content });
            } else if (message.role === 'assistant') {
                // The output items of the earlier response, returned as they were
                if (Array.isArray(message.provider_state)) input.push(...message.provider_state);
                else {
                    if (message.content) input.push({ role: 'assistant', content: message.content });
                    for (const call of message.tool_calls || []) {
                        input.push({ type: 'function_call', call_id: call.id, name: call.name, arguments: JSON.stringify(call.arguments) });
                    }
                }
            } else {
                input.push({ role: 'user', content: message.content });
            }
        }

        const send = (with_temperature: boolean) => fetch(`${this.base_url}/responses`, {
            method: 'POST',
            headers: { 'content-type': 'application/json', authorization: `Bearer ${this.api_key}` },
            body: JSON.stringify({
                model: request.model,
                input,
                ...(instructions ? { instructions } : {}),
                ...(request.tools?.length ? {
                    tools: request.tools.map(tool => ({ type: 'function', name: tool.name, description: tool.description, parameters: tool.parameters })),
                } : {}),
                ...(request.json ? { text: { format: { type: 'json_object' } } } : {}),
                ...(with_temperature && request.temperature !== undefined ? { temperature: request.temperature } : {}),
                ...(request.max_output_tokens !== undefined ? { max_output_tokens: request.max_output_tokens } : {}),
            }),
        });

        let response = await send(!this.no_temperature.has(request.model));
        if (response.status === 400 && request.temperature !== undefined && !this.no_temperature.has(request.model)) {
            const detail = await response.text().catch(() => '');
            if (!/temperature/i.test(detail)) throw http_error(this.id, 400, detail);
            // Some model families fix their own sampling and reject the parameter
            this.no_temperature.add(request.model);
            response = await send(false);
        }
        if (!response.ok) throw http_error(this.id, response.status, await response.text().catch(() => ''));

        const body = await response.json() as {
            output?: { type?: string; call_id?: string; name?: string; arguments?: unknown; content?: { type?: string; text?: string }[] }[];
            usage?: { input_tokens?: number; output_tokens?: number };
        };
        const output = body.output || [];
        const text = output.filter(item => item.type === 'message')
            .flatMap(item => item.content || []).filter(part => part.type === 'output_text').map(part => part.text || '').join('');
        const tool_calls = output.filter(item => item.type === 'function_call').map((item, index) => ({
            id: item.call_id || `call_${index}`, name: item.name || '', arguments: parse_arguments(item.arguments),
        }));
        return {
            text,
            ...(tool_calls.length ? { tool_calls, provider_state: output } : {}),
            usage: { input_tokens: body.usage?.input_tokens || 0, output_tokens: body.usage?.output_tokens || 0 },
        };
    }
}

/** Google Gemini */
export class GoogleModelProvider implements ModelProvider {
    readonly id = 'google';
    readonly capabilities = { tools: true };
    private client: GoogleGenerativeAI;
    private compatible: OpenAICompatibleModelProvider;

    constructor(api_key: string, options: { openai_base_url?: string } = {}) {
        this.client = new GoogleGenerativeAI(api_key);
        this.compatible = new OpenAICompatibleModelProvider({
            id: 'google', api_key,
            base_url: options.openai_base_url || 'https://generativelanguage.googleapis.com/v1beta/openai',
        });
    }

    async generate(request: ModelRequest): Promise<ModelResponse> {
        const turns = request_messages(request);
        // Tool conversations go through Gemini's OpenAI-compatible endpoint, so that
        // one adapter carries tool calls, and whatever the model attaches to them, for
        // every vendor. Plain generation uses the Gemini SDK.
        if (request.tools?.length || turns.some(m => m.role === 'tool' || m.role === 'assistant')) {
            return this.compatible.generate(request);
        }

        const model = this.client.getGenerativeModel({ model: request.model });
        const result = await model.generateContent({
            contents: [{ role: 'user', parts: [{ text: turns.map(m => m.content).join('\n\n') }] }],
            generationConfig: {
                temperature: request.temperature,
                maxOutputTokens: request.max_output_tokens,
                ...(request.json ? { responseMimeType: 'application/json' } : {}),
            },
        });
        return {
            text: result.response.text(),
            usage: {
                input_tokens: result.response.usageMetadata?.promptTokenCount || 0,
                output_tokens: result.response.usageMetadata?.candidatesTokenCount || 0,
            },
        };
    }
}

/** Open-source models served by a local Ollama (https://ollama.com), through its OpenAI-compatible endpoint */
export function ollama_provider(config: { base_url?: string; id?: string; tools?: boolean } = {}): OpenAICompatibleModelProvider {
    return new OpenAICompatibleModelProvider({
        id: config.id || 'ollama',
        base_url: config.base_url || 'http://localhost:11434/v1',
        tools: config.tools,
    });
}

type TextGenerator = (messages: { role: string; content: string }[], options: Record<string, unknown>) => Promise<unknown>;

/**
 * A small open-source model running inside the engine's own process: no
 * server, no API key, no data leaving the machine. Suited to the simple,
 * high-volume calls of a workflow: classification, routing decisions and
 * judging. It does not call tools.
 *
 * Runs ONNX models with Transformers.js. Install the optional dependency
 * `@huggingface/transformers`; the model weights are downloaded on first use
 * and cached, or read from `local_path` for air-gapped deployments.
 */
export class EmbeddedModelProvider implements ModelProvider {
    static readonly DEFAULT_MODEL = 'HuggingFaceTB/SmolLM2-360M-Instruct';
    readonly id: string;
    readonly capabilities = { tools: false };
    private generators = new Map<string, Promise<TextGenerator>>();

    constructor(private config: {
        id?: string;
        /** Model used for the reference "embedded:default" */
        default_model?: string;
        /** Weight format, e.g. "q4" (4-bit, smallest), "q8", "fp32". Default "q4". */
        dtype?: string;
        /** Directory holding the model files, for use without network access */
        local_path?: string;
        /** Replaces Transformers.js. Receives the model name and returns a chat generator. */
        load?: (model: string) => Promise<TextGenerator>;
    } = {}) {
        this.id = config.id || 'embedded';
    }

    private generator(model: string): Promise<TextGenerator> {
        if (!this.generators.has(model)) {
            this.generators.set(model, (this.config.load || this.load_transformers.bind(this))(model));
        }
        return this.generators.get(model)!;
    }

    private async load_transformers(model: string): Promise<TextGenerator> {
        let library: any;
        try {
            // Optional dependency, resolved at run time so the SDK installs without it
            const name = '@huggingface/transformers';
            library = await import(name);
        } catch {
            throw Object.assign(
                new Error('The embedded model provider needs the optional package "@huggingface/transformers". Install it with: npm install @huggingface/transformers'),
                { code: 'VALIDATION_ERROR' });
        }
        if (this.config.local_path) {
            library.env.localModelPath = this.config.local_path;
            library.env.allowRemoteModels = false;
        }
        return library.pipeline('text-generation', model, { dtype: this.config.dtype || 'q4' });
    }

    async generate(request: ModelRequest): Promise<ModelResponse> {
        const model = request.model === 'default' ? (this.config.default_model || EmbeddedModelProvider.DEFAULT_MODEL) : request.model;
        const generate = await this.generator(model);
        const turns = request_messages(request)
            .filter((m): m is Extract<ChatMessage, { role: 'system' | 'user' }> | Extract<ChatMessage, { role: 'assistant' }> => m.role !== 'tool')
            .map(m => ({ role: m.role, content: m.content }));
        if (request.json) {
            turns[turns.length - 1].content += '\n\nReply with a single JSON object and nothing else.';
        }
        const temperature = request.temperature ?? 0;
        const output = await generate(turns, {
            max_new_tokens: request.max_output_tokens ?? 256,
            do_sample: temperature > 0,
            ...(temperature > 0 ? { temperature } : {}),
            return_full_text: false,
        }) as { generated_text?: string | { role: string; content: string }[] }[];

        const generated = output?.[0]?.generated_text;
        const text = Array.isArray(generated) ? String(generated[generated.length - 1]?.content ?? '') : String(generated ?? '');
        return {
            text,
            // Transformers.js does not report token counts; these are estimates
            usage: { input_tokens: estimate_tokens(turns.map(t => t.content).join(' ')), output_tokens: estimate_tokens(text) },
        };
    }
}

/** A provider driven by a function. For tests and for deterministic stand-ins. */
export class FunctionModelProvider implements ModelProvider {
    public requests: ModelRequest[] = [];
    readonly capabilities: { tools: boolean };

    constructor(
        readonly id: string,
        private fn: (request: ModelRequest) => string | Partial<ModelResponse> | Promise<string | Partial<ModelResponse>>,
        options: { tools?: boolean } = {},
    ) {
        this.capabilities = { tools: options.tools !== false };
    }

    async generate(request: ModelRequest): Promise<ModelResponse> {
        this.requests.push(request);
        const result = await this.fn(request);
        const response = typeof result === 'string' ? { text: result } : result;
        const text = response.text || '';
        const prompt = request_messages(request).map(m => m.content).join(' ');
        return {
            text,
            ...(response.tool_calls?.length ? { tool_calls: response.tool_calls, provider_state: response.provider_state } : {}),
            usage: response.usage || { input_tokens: estimate_tokens(prompt), output_tokens: estimate_tokens(text) },
        };
    }
}

/**
 * Model names for the standard tiers, per provider, as published in
 * November 2026. Model line-ups change often: treat these as a starting
 * point and set your own with `model_tiers`.
 */
export const TIER_PRESETS: Record<string, Record<(typeof STANDARD_TIERS)[number], string>> = {
    google: { reasoning: 'google:gemini-4-hydrogen', balanced: 'google:gemini-3.8-flash', fast: 'google:gemini-3.5-flash-lite' },
    openai: { reasoning: 'openai:gpt-6.2-astra', balanced: 'openai:gpt-6.1-terra', fast: 'openai:gpt-6-luna' },
    ollama: { reasoning: 'ollama:qwen3:14b', balanced: 'ollama:phi4-mini', fast: 'ollama:gemma3:1b' },
    embedded: { reasoning: 'embedded:default', balanced: 'embedded:default', fast: 'embedded:default' },
};

/**
 * Tier map that prefers the providers in the order given and falls back down
 * the list, e.g. tier_fallbacks(['google', 'ollama', 'embedded']).
 */
export function tier_fallbacks(providers: string[]): Record<string, string[]> {
    const tiers: Record<string, string[]> = {};
    for (const tier of STANDARD_TIERS) {
        tiers[tier] = providers.filter(p => TIER_PRESETS[p]).map(p => TIER_PRESETS[p][tier]);
    }
    return tiers;
}
