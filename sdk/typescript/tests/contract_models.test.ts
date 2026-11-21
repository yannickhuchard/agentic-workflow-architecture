import { describe, it, expect } from 'vitest';
import http from 'http';
import type { AddressInfo } from 'net';
import { v4 as uuidv4 } from 'uuid';
import { WorkflowEngine } from '../src/runtime/workflow_engine';
import { FunctionModelProvider, ModelRegistry, OpenAICompatibleModelProvider } from '../src/runtime/models';
import { check_contract, outcome_of } from '../src/runtime/outcome_contract';
import { OutcomeContractSchema, Role } from '../src/types';
import { activity, edge, workflow, scripted, silent_logger } from './helpers';

const quiet = { sleep: async () => { }, execution_logger: silent_logger };
const contract = (c: unknown) => OutcomeContractSchema.parse(c);

describe('Outcome contract checks', () => {
    const c = contract({
        output_schema: { type: 'object', required: ['amount'], properties: { amount: { type: 'number' } } },
        postconditions: [{ name: 'positive', expression: 'amount > 0' }],
    });

    it('reports nothing when the outcome satisfies the contract', () => {
        expect(check_contract(c, { amount: 5 })).toEqual([]);
    });

    it('reports schema and postcondition violations separately', () => {
        expect(check_contract(c, { amount: 'x' }).map(v => v.kind)).toEqual(['output_schema', 'postcondition']);
        expect(check_contract(c, { amount: -1 }).map(v => v.name)).toEqual(['positive']);
    });

    it('is deterministic: the same outcome always gets the same result', () => {
        expect(check_contract(c, { amount: -1 })).toEqual(check_contract(c, { amount: -1 }));
    });

    it('takes the outcome from an object-valued output property', () => {
        expect(outcome_of({ output: { a: 1 }, status: 'done', usage: {} })).toEqual({ a: 1 });
        expect(outcome_of({ output: 'text', a: 1, _internal: 2 })).toEqual({ output: 'text', a: 1 });
    });
});

describe('Budgets', () => {
    it('fails an attempt that exceeds its duration budget', async () => {
        const a = activity('A', { outcome_contract: contract({ budgets: { max_duration: 'PT0.05S' } }) });
        const { actors } = scripted({ A: () => new Promise(resolve => setTimeout(() => resolve({ ok: true }), 400)) });
        const engine = new WorkflowEngine(workflow([a], []), { actors, ...quiet });
        await engine.start();
        expect(await engine.run()).toBe('failed');
        expect(engine.getTokens()[0].getData('_error_code')).toBe('TIMEOUT');
    });

    it('retries a timed-out attempt when the retry policy allows', async () => {
        const a = activity('A', {
            outcome_contract: contract({ budgets: { max_duration: 'PT0.05S' } }),
            retry: { max_attempts: 2, initial_delay: 'PT0S', jitter: false },
        });
        const { actors } = scripted({
            A: [() => new Promise(resolve => setTimeout(() => resolve({}), 400)), { ok: true }],
        });
        const engine = new WorkflowEngine(workflow([a], []), { actors, ...quiet });
        await engine.start();
        expect(await engine.run()).toBe('completed');
    });

    it('rejects an outcome that cost more tokens than budgeted, without retrying', async () => {
        const a = activity('A', { actor_type: 'ai_agent', outcome_contract: contract({ budgets: { max_tokens: 100, max_attempts: 5 } }) });
        const { actor, actors } = scripted({ A: { output: { ok: true }, usage: { input_tokens: 90, output_tokens: 40 } } });
        const engine = new WorkflowEngine(workflow([a], []), { actors, ...quiet });
        await engine.start();
        expect(await engine.run()).toBe('failed');
        expect(actor.count('A')).toBe(1);
        expect(String(engine.getTokens()[0].getData('_error'))).toMatch(/max_tokens: 130 tokens used, the budget is 100/);
    });
});

describe('Escalation to a human', () => {
    const build = () => {
        const assess = activity('Assess', {
            actor_type: 'ai_agent',
            outcome_contract: contract({
                postconditions: [{ name: 'decided', expression: 'decision exists' }],
                budgets: { max_attempts: 2 }, on_violation: 'escalate_human',
            }),
        });
        const next = activity('Next');
        const ai = scripted({ Assess: { output: { note: 'cannot tell' } } });
        const human = scripted({ Assess: { _requires_human_action: true, _human_task_id: 'task-1' } });
        const engine = new WorkflowEngine(workflow([assess, next], [edge(assess, next)]), {
            actors: { ai_agent: ai.actor, human: human.actor, application: ai.actor },
            wait_for_human_tasks: true, ...quiet,
        });
        return { engine, ai, human };
    };

    it('parks the token for a human after the automatic attempts are used up', async () => {
        const { engine, ai, human } = build();
        await engine.start();
        expect(await engine.run()).toBe('waiting_human');
        expect(ai.actor.count('Assess')).toBe(2);
        expect(human.actor.calls[0].inputs._escalation).toMatchObject({ code: 'CONTRACT_VIOLATION', rejected_outcome: { note: 'cannot tell' } });

        const token = engine.getTokens()[0];
        expect(await engine.resumeToken(token.id, { decision: 'approve' })).toBe(true);
        expect(await engine.run()).toBe('completed');
        expect(token.contextData.decision).toBe('approve');

        const events = await engine.getEvents();
        const escalation = events.find(e => e.type === 'meta.recorded' && e.data.subject === 'escalation')!;
        expect(String(escalation.data.rationale)).toMatch(/After 2 attempt/);
    });

    it('holds the human decision to the contract as well', async () => {
        const { engine } = build();
        await engine.start();
        await engine.run();
        const token = engine.getTokens()[0];
        expect(await engine.resumeToken(token.id, { comment: 'looks fine' })).toBe(false);
        expect(engine.getStatus()).toBe('failed');
        expect(token.getData('_error_code')).toBe('CONTRACT_VIOLATION');
    });
});

describe('Model binding', () => {
    const registry = () => new ModelRegistry()
        .register(new FunctionModelProvider('acme', () => 'a'))
        .register(new FunctionModelProvider('other', () => 'b'))
        .set_tier('fast', 'other:small-1');

    it('resolves the three forms of model reference', () => {
        const r = registry();
        expect(r.resolve('other:big-2').ref).toBe('other:big-2');
        expect(r.resolve('plain-model').ref).toBe('acme:plain-model'); // default provider: first registered
        expect(r.resolve('tier:fast')).toMatchObject({ ref: 'other:small-1', tier: 'fast' });
    });

    it('does not mistake a colon in a model name for a provider', () => {
        expect(registry().resolve('ft:custom:v2').ref).toBe('acme:ft:custom:v2');
    });

    it('fails clearly on an unmapped tier or when no provider exists', () => {
        expect(() => registry().resolve('tier:reasoning')).toThrow(/not mapped/);
        expect(() => new ModelRegistry().resolve('x')).toThrow(/No model provider/);
    });

    it('runs an agent and its judge on a non-Google provider chosen by tier', async () => {
        const roleId = uuidv4();
        const provider = new FunctionModelProvider('acme', request => request.prompt.includes('quality assurance judge')
            ? JSON.stringify({ results: [{ criterion_id: 1, passed: true, evidence: 'Decision present', confidence: 1 }], feedback: null })
            : JSON.stringify({
                reasoning: { plan: ['read', 'decide'], rationale: 'Low risk', alternatives_considered: ['reject'], confidence: 0.8 },
                output: { decision: 'approve' },
            }));
        const role = { id: roleId, name: 'Underwriter', actor_type: 'ai_agent', capabilities: [], is_embedded: false, mcp_tools: [], ai_model_config: { model_id: 'tier:reasoning' } } as Role;
        const a = activity('Underwrite', {
            actor_type: 'ai_agent', role_id: roleId,
            outcome_contract: contract({ postconditions: [{ name: 'decided', expression: 'decision exists' }] }),
            verification: {
                enabled: true, mode: 'ai_judge', max_retries: 0, retry_with_feedback: true, judge_temperature: 0, pass_threshold: 0.9,
                judge_model_id: 'tier:fast',
                criteria: [{ id: uuidv4(), name: 'Decision', description: 'A decision is given', type: 'completeness', weight: 1, required: true }],
            },
        });
        const engine = new WorkflowEngine(workflow([a], []), {
            roles: [role], model_providers: [provider],
            model_tiers: { reasoning: 'acme:big', fast: 'acme:small' }, ...quiet,
        });
        await engine.start({ applicant: 'x' });
        expect(await engine.run()).toBe('completed');

        expect(provider.requests.map(r => r.model)).toEqual(['big', 'small']);
        expect(engine.getTokens()[0].contextData.output).toEqual({ decision: 'approve' });

        const events = await engine.getEvents();
        expect(events.find(e => e.type === 'reasoning.recorded')!.data).toMatchObject({ rationale: 'Low risk', alternatives_considered: ['reject'] });
        const model = events.find(e => e.type === 'meta.recorded' && e.data.subject === 'model_selection')!;
        expect(model.data.decision).toBe('Use model acme:big');
        expect(String(model.data.rationale)).toMatch(/capability tier "reasoning"/);
    });

    it('talks to any OpenAI-compatible endpoint', async () => {
        let received: any;
        const server = http.createServer((req, res) => {
            let body = '';
            req.on('data', chunk => (body += chunk));
            req.on('end', () => {
                received = { url: req.url, auth: req.headers.authorization, body: JSON.parse(body) };
                res.setHeader('content-type', 'application/json');
                res.end(JSON.stringify({ choices: [{ message: { content: 'hello' } }], usage: { prompt_tokens: 7, completion_tokens: 2 } }));
            });
        }).listen(0);
        try {
            const provider = new OpenAICompatibleModelProvider({
                id: 'local', base_url: `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1/`, api_key: 'k',
            });
            const response = await provider.generate({ model: 'm', system: 'be brief', prompt: 'hi', temperature: 0 });
            expect(response).toEqual({ text: 'hello', usage: { input_tokens: 7, output_tokens: 2 } });
            expect(received.url).toBe('/v1/chat/completions');
            expect(received.auth).toBe('Bearer k');
            expect(received.body).toEqual({
                model: 'm', temperature: 0,
                messages: [{ role: 'system', content: 'be brief' }, { role: 'user', content: 'hi' }],
            });
        } finally {
            server.close();
        }
    });
});
