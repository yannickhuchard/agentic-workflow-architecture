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

export interface ModelRequest {
    /** Provider-specific model name, already resolved */
    model: string;
    /** Standing instructions for the model */
    system?: string;
    /** The request */
    prompt: string;
    temperature?: number;
    max_output_tokens?: number;
}

export interface ModelResponse {
    text: string;
    usage: { input_tokens: number; output_tokens: number };
}

export interface ModelProvider {
    /** Provider identifier used in model references, e.g. "google" */
    readonly id: string;
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

/** Capability tiers every deployment SHOULD map (specification 12.2) */
export const STANDARD_TIERS = ['reasoning', 'balanced', 'fast'] as const;

export class ModelRegistry {
    private providers = new Map<string, ModelProvider>();
    private tiers = new Map<string, string>();
    private default_provider?: string;

    register(provider: ModelProvider, options: { default?: boolean } = {}): this {
        this.providers.set(provider.id, provider);
        if (options.default || !this.default_provider) this.default_provider = provider.id;
        return this;
    }

    /** Map a tier name to a model reference, e.g. set_tier('fast', 'google:gemini-3.1-flash-lite') */
    set_tier(tier: string, ref: string): this {
        this.tiers.set(tier, ref);
        return this;
    }

    set_default_provider(id: string): this {
        this.default_provider = id;
        return this;
    }

    has_providers(): boolean {
        return this.providers.size > 0;
    }

    resolve(ref: string): ResolvedModel {
        let tier: string | undefined;
        let target = ref;

        if (target.startsWith('tier:')) {
            tier = target.slice(5);
            const mapped = this.tiers.get(tier);
            if (!mapped) {
                throw Object.assign(new Error(`Model tier "${tier}" is not mapped to a model in this deployment`), { code: 'VALIDATION_ERROR' });
            }
            if (mapped.startsWith('tier:')) {
                throw Object.assign(new Error(`Model tier "${tier}" must map to a model, not to another tier`), { code: 'VALIDATION_ERROR' });
            }
            target = mapped;
        }

        const colon = target.indexOf(':');
        const named = colon > 0 ? target.slice(0, colon) : undefined;
        // "models/gemini-x" style names contain no provider prefix; only treat the
        // part before ":" as a provider when one is registered under that name.
        const provider_id = named && this.providers.has(named) ? named : this.default_provider;
        const model = named && this.providers.has(named) ? target.slice(colon + 1) : target;

        const provider = provider_id ? this.providers.get(provider_id) : undefined;
        if (!provider) {
            throw Object.assign(
                new Error(`No model provider is registered for "${ref}"`), { code: 'VALIDATION_ERROR' });
        }
        return { provider, model, ref: `${provider.id}:${model}`, ...(tier ? { tier } : {}) };
    }
}

/** Google Gemini, through the @google/generative-ai SDK */
export class GoogleModelProvider implements ModelProvider {
    readonly id = 'google';
    private client: GoogleGenerativeAI;

    constructor(api_key: string) {
        this.client = new GoogleGenerativeAI(api_key);
    }

    async generate(request: ModelRequest): Promise<ModelResponse> {
        const model = this.client.getGenerativeModel({ model: request.model });
        const text = request.system ? `${request.system}\n\n${request.prompt}` : request.prompt;
        const result = await model.generateContent({
            contents: [{ role: 'user', parts: [{ text }] }],
            generationConfig: {
                temperature: request.temperature,
                maxOutputTokens: request.max_output_tokens,
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

/**
 * Any service that implements the OpenAI-style `POST /chat/completions`
 * endpoint: hosted APIs, gateways, and local model servers.
 */
export class OpenAICompatibleModelProvider implements ModelProvider {
    readonly id: string;
    private base_url: string;
    private api_key?: string;

    constructor(config: { id: string; base_url: string; api_key?: string }) {
        this.id = config.id;
        this.base_url = config.base_url.replace(/\/+$/, '');
        this.api_key = config.api_key;
    }

    async generate(request: ModelRequest): Promise<ModelResponse> {
        const response = await fetch(`${this.base_url}/chat/completions`, {
            method: 'POST',
            headers: {
                'content-type': 'application/json',
                ...(this.api_key ? { authorization: `Bearer ${this.api_key}` } : {}),
            },
            body: JSON.stringify({
                model: request.model,
                messages: [
                    ...(request.system ? [{ role: 'system', content: request.system }] : []),
                    { role: 'user', content: request.prompt },
                ],
                ...(request.temperature !== undefined ? { temperature: request.temperature } : {}),
                ...(request.max_output_tokens !== undefined ? { max_tokens: request.max_output_tokens } : {}),
            }),
        });

        if (!response.ok) {
            const code = response.status === 401 ? 'AUTHENTICATION_ERROR'
                : response.status === 403 ? 'PERMISSION_DENIED'
                    : response.status === 404 ? 'NOT_FOUND'
                        : response.status === 400 || response.status === 422 ? 'VALIDATION_ERROR'
                            : 'PROVIDER_ERROR';
            throw Object.assign(new Error(`Model provider "${this.id}" returned HTTP ${response.status}`), { code });
        }

        const body = await response.json() as {
            choices?: { message?: { content?: string } }[];
            usage?: { prompt_tokens?: number; completion_tokens?: number };
        };
        return {
            text: body.choices?.[0]?.message?.content || '',
            usage: {
                input_tokens: body.usage?.prompt_tokens || 0,
                output_tokens: body.usage?.completion_tokens || 0,
            },
        };
    }
}

/** A provider driven by a function. For tests and for deterministic stand-ins. */
export class FunctionModelProvider implements ModelProvider {
    public requests: ModelRequest[] = [];

    constructor(readonly id: string, private fn: (request: ModelRequest) => string | Promise<string>) { }

    async generate(request: ModelRequest): Promise<ModelResponse> {
        this.requests.push(request);
        const text = await this.fn(request);
        return { text, usage: { input_tokens: Math.ceil(request.prompt.length / 4), output_tokens: Math.ceil(text.length / 4) } };
    }
}
