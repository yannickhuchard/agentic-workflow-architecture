/**
 * The models this SDK uses when a document names none, in one place.
 *
 * They are configuration, read from src/config.json, and each can be overridden
 * with an environment variable. Nothing else in the SDK writes a model name.
 */
import config from '../config.json';

const env = (name: string) => (typeof process !== 'undefined' && process.env ? process.env[name] : undefined) || undefined;

/** The model an AI agent, a judge or a model decision uses when nothing names another. AWA_DEFAULT_AI_MODEL_ID overrides it */
export const DEFAULT_AI_MODEL_ID: string = env('AWA_DEFAULT_AI_MODEL_ID') || config.default_ai_model_id;

/** The models of the Google provider for the standard tiers, from the models the configuration makes available */
export const GOOGLE_TIER_MODELS = {
    reasoning: env('AWA_GOOGLE_REASONING_MODEL') || config.available_models['gemini-3.1-pro'],
    balanced: DEFAULT_AI_MODEL_ID,
    fast: env('AWA_GOOGLE_FAST_MODEL') || config.available_models['gemini-3.1-flash-lite'],
};
