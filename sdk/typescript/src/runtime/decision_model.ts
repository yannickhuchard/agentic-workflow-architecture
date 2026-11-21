/**
 * AWA Model Decisions (specification section 16)
 *
 * A decision node may be decided by a language model instead of, or after, a
 * decision table. The model's freedom is bounded: it must pick exactly one of
 * the options the workflow enumerates, its answer is validated, and anything
 * else (an unknown option, low confidence, no majority, a model failure) is
 * "no decision", which takes the node's default edge or fails the token.
 */

import { DecisionModel, DecisionNode } from '../types';
import { ModelRouter, RouteAttempt } from './models';

export interface ModelVote {
    option?: string;
    confidence?: number;
    rationale?: string;
    /** Why the vote does not count, if it does not */
    invalid?: string;
    model?: string;
}

export interface ModelDecision {
    /** The option decided, or undefined for "no decision" */
    option?: string;
    edge_id?: string;
    confidence?: number;
    rationale?: string;
    /** Why there is no decision */
    reason?: string;
    votes: ModelVote[];
    model?: { provider: string; id: string; requested: string; tier?: string };
    route: RouteAttempt[];
    usage: { input_tokens: number; output_tokens: number };
}

export function decision_prompt(node: DecisionNode, model: DecisionModel, inputs: Record<string, unknown>): { system: string; prompt: string } {
    const system = [
        'You decide which route a workflow takes. Choose exactly one of the listed options.',
        'Reply with a single JSON object and nothing else, with these properties:',
        '- "option": the id of the option you choose, copied exactly',
        '- "confidence": a number from 0 to 1',
        '- "rationale": one or two sentences saying why',
    ].join('\n');
    const prompt = [
        `Decision: ${node.name}`,
        ...(node.description ? [node.description] : []),
        '',
        'Instructions:',
        model.instructions,
        '',
        'Options:',
        ...model.options.map(option => `- ${option.id}: ${option.description}`),
        '',
        'Facts:',
        JSON.stringify(inputs, null, 2),
    ].join('\n');
    return { system, prompt };
}

/** Read one model reply as a vote. Never throws: an unusable reply is an invalid vote. */
export function parse_vote(text: string, model: DecisionModel): ModelVote {
    const ids = model.options.map(option => option.id);
    const match = text.match(/\{[\s\S]*\}/);
    if (match) {
        try {
            const parsed = JSON.parse(match[0]) as { option?: unknown; confidence?: unknown; rationale?: unknown };
            const option = typeof parsed.option === 'string' ? parsed.option.trim() : undefined;
            const confidence = typeof parsed.confidence === 'number' && parsed.confidence >= 0 && parsed.confidence <= 1 ? parsed.confidence : undefined;
            const rationale = typeof parsed.rationale === 'string' ? parsed.rationale : undefined;
            if (option && ids.includes(option)) return { option, confidence, rationale };
            return { invalid: option ? `"${option}" is not one of the options` : 'the reply names no option', confidence, rationale };
        } catch {
            // fall through: small models often produce almost-JSON
        }
    }
    // A reply that is not JSON still counts if it names exactly one option
    const named = ids.filter(id => new RegExp(`(^|[^A-Za-z0-9_-])${id.replace(/[-]/g, '\\-')}($|[^A-Za-z0-9_-])`).test(text));
    if (named.length === 1) return { option: named[0], rationale: text.trim().slice(0, 300) };
    return { invalid: named.length > 1 ? 'the reply names more than one option' : 'the reply is not valid JSON and names no option' };
}

/**
 * Ask a model to decide. `votes` independent samples are taken; the decision
 * is the option with a strict majority of all votes, provided the mean
 * confidence of the votes for it reaches `min_confidence`.
 */
export async function decide_with_model(
    node: DecisionNode,
    data: Record<string, unknown>,
    router: ModelRouter,
    default_model: string,
): Promise<ModelDecision> {
    const model = node.decision_model!;
    const inputs = model.inputs
        ? Object.fromEntries(model.inputs.map(name => [name, data[name]]))
        : Object.fromEntries(Object.entries(data).filter(([key]) => !key.startsWith('_') && key !== 'activities'));
    const { system, prompt } = decision_prompt(node, model, inputs);
    const requested = model.model || default_model;
    const votes: ModelVote[] = [];
    const usage = { input_tokens: 0, output_tokens: 0 };
    let route: RouteAttempt[] = [];
    let served: ModelDecision['model'];

    for (let i = 0; i < model.votes; i++) {
        try {
            const routed = await router.generate(requested, {
                system, prompt, json: true,
                // One sample should be as repeatable as possible; several need to be independent
                temperature: model.temperature ?? (model.votes > 1 ? 0.7 : 0),
                max_output_tokens: 300,
            });
            usage.input_tokens += routed.response.usage.input_tokens;
            usage.output_tokens += routed.response.usage.output_tokens;
            route = routed.route;
            served = { provider: routed.model.provider.id, id: routed.model.model, requested, ...(routed.model.tier ? { tier: routed.model.tier } : {}) };
            votes.push({ ...parse_vote(routed.response.text, model), model: routed.model.ref });
        } catch (error) {
            route = (error as { route?: RouteAttempt[] })?.route || route;
            votes.push({ invalid: `the model could not be reached: ${error instanceof Error ? error.message : String(error)}` });
        }
    }

    const base = { votes, model: served, route, usage };
    const tally = new Map<string, ModelVote[]>();
    for (const vote of votes) if (vote.option) tally.set(vote.option, [...(tally.get(vote.option) || []), vote]);
    const [winner, supporters] = [...tally.entries()].sort((a, b) => b[1].length - a[1].length)[0] || [];

    if (!winner || !supporters) {
        return { ...base, reason: votes[0]?.invalid || 'no valid vote' };
    }
    if (supporters.length * 2 <= votes.length) {
        return { ...base, reason: `no option has a majority (${[...tally].map(([id, v]) => `${id}: ${v.length}`).join(', ')} of ${votes.length} votes)` };
    }
    const stated = supporters.map(v => v.confidence).filter((c): c is number => c !== undefined);
    const confidence = stated.length ? stated.reduce((a, b) => a + b, 0) / stated.length : undefined;
    if (model.min_confidence > 0 && (confidence === undefined || confidence < model.min_confidence)) {
        return {
            ...base, confidence, rationale: supporters[0].rationale,
            reason: `confidence ${confidence === undefined ? 'was not stated' : confidence.toFixed(2)} is below the required ${model.min_confidence}`,
        };
    }
    return {
        ...base, option: winner, confidence, rationale: supporters[0].rationale,
        edge_id: model.options.find(option => option.id === winner)!.output_edge_id,
    };
}
