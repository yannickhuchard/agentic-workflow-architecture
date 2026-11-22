import { describe, it, expect } from 'vitest';
import { randomUUID as uuidv4 } from 'crypto';
import { WorkflowEngine } from '../src/runtime/workflow_engine';
import { counterfactual_replay, render_counterfactual_report } from '../src/runtime/counterfactual';
import { FunctionModelProvider, ModelRequest } from '../src/runtime/models';
import { business_event } from '../src/runtime/business_event';
import { DecisionModelSchema, DecisionNode, OutcomeContractSchema, ToolDefinitionSchema, Workflow } from '../src';
import { activity, edge, workflow, scripted, silent_logger } from './helpers';

const quiet = { sleep: async () => { }, execution_logger: silent_logger };
const reply = (output: unknown, rationale = 'because') => JSON.stringify({ reasoning: { plan: ['think'], rationale }, output });

/**
 * Intake (application) -> Assess (AI, contract: cost is a number) -> Triage (model decision) -> Pay | Review (applications)
 */
function fixture() {
    const intake = activity('Intake');
    const assess = activity('Assess', {
        actor_type: 'ai_agent',
        outcome_contract: OutcomeContractSchema.parse({ postconditions: [{ name: 'Cost is a number', expression: 'typeof cost == number' }], budgets: { max_attempts: 3 } }),
    });
    const pay = activity('Pay'); const review = activity('Review');
    const id = uuidv4();
    const toPay = edge({ id }, pay); const toReview = edge({ id }, review);
    const triage = {
        id, name: 'Triage',
        decision_model: DecisionModelSchema.parse({
            instructions: 'Pay small claims, review large ones.',
            options: [{ id: 'pay', description: 'small', output_edge_id: toPay.id }, { id: 'review', description: 'large', output_edge_id: toReview.id }],
            inputs: ['cost'],
        }),
    } as DecisionNode;
    const wf = workflow([intake, assess, pay, review], [edge(intake, assess), edge(assess, { id }), toPay, toReview], { decision_nodes: [triage], name: 'Claims' });
    return { wf, assess, pay, review };
}

/** A model that gets the cost wrong first, then right, and routes to pay */
const hesitant = () => {
    let n = 0;
    return new FunctionModelProvider('acme', (request: ModelRequest) => {
        if (request.prompt?.includes('Decision: Triage')) return '{"option":"pay","confidence":0.9,"rationale":"small"}';
        return ++n === 1 ? reply({ cost: 'about 300' }) : reply({ cost: 300 });
    });
};
const sure = (cost: unknown = 300, option = 'pay') => new FunctionModelProvider('acme', (request: ModelRequest) =>
    request.prompt?.includes('Decision: Triage') ? `{"option":"${option}","confidence":0.95,"rationale":"clear"}` : reply({ cost }));

async function baseline(wf: Workflow, provider = hesitant()) {
    const s = scripted({ Intake: { claim_id: 'C-1' }, Pay: { paid: true }, Review: { reviewed: true } });
    const engine = new WorkflowEngine(wf, { actors: { application: s.actor }, model_providers: [provider], ...quiet });
    await engine.start({ customer: 'x' });
    const status = await engine.run();
    return { status, events: await engine.getEvents() };
}

describe('Counterfactual replay', () => {
    it('reproduces the recorded run exactly when nothing is changed and AI outputs are replayed', async () => {
        const { wf } = fixture();
        const recorded = await baseline(wf);
        expect(recorded.status).toBe('completed');

        const { report, status } = await counterfactual_replay(wf, recorded.events, { ai: 'recorded' });
        expect(status).toBe('completed');
        expect(report.same_status).toBe(true);
        expect(report.same_path).toBe(true);
        expect(report.regressions).toEqual([]);
        expect(report.unrecorded).toEqual([]);
        // Replayed results are accepted at once; that must not be reported as an improvement
        expect(report.nodes.every(n => n.verdict === 'same')).toBe(true);
        expect(report.improvements).toEqual([]);
        expect(render_counterfactual_report(report)).toContain('**The candidate behaves exactly as recorded.**');
    });

    it('shows that a better model needs fewer attempts, holding everything else as recorded', async () => {
        const { wf } = fixture();
        const recorded = await baseline(wf);
        const better = sure();
        const { report } = await counterfactual_replay(wf, recorded.events, { engine: { model_providers: [better] } });

        const assess = report.nodes.find(n => n.node_name === 'Assess')!;
        expect(assess).toMatchObject({ verdict: 'improved', baseline: { attempts: 2, accepted: true }, candidate: { attempts: 1, accepted: true } });
        expect(report.improvements).toEqual(['Assess: Accepted in 1 attempt(s), down from 2.']);
        expect(report.regressions).toEqual([]);
        expect(report.same_path).toBe(true);
        expect(report.baseline.attempts).toBe(4);
        expect(report.candidate.attempts).toBe(3);
        // Applications were not run again: their recorded results were supplied
        expect(report.nodes.find(n => n.node_name === 'Pay')!.candidate.outcome).toEqual({ paid: true });
        expect(render_counterfactual_report(report)).toContain('**The candidate is better, with no regressions.**');
    });

    it('shows that a worse model regresses, and that the run now fails', async () => {
        const { wf } = fixture();
        const recorded = await baseline(wf);
        const { report, status } = await counterfactual_replay(wf, recorded.events, { engine: { model_providers: [sure('unknown')] } });
        expect(status).toBe('failed');
        expect(report.same_status).toBe(false);
        expect(report.nodes.find(n => n.node_name === 'Assess')!.verdict).toBe('regressed');
        expect(report.regressions.join(' ')).toMatch(/Assess: Accepted in the recorded run, not in the candidate/);
        expect(report.regressions.join(' ')).toMatch(/The run failed; the recorded run completed/);
        expect(report.nodes.find(n => n.node_name === 'Pay')!.verdict).toBe('only_baseline');
    });

    it('tests a tightened contract against recorded AI outputs, with no model at all', async () => {
        const { wf, assess } = fixture();
        const recorded = await baseline(wf);
        const stricter: Workflow = JSON.parse(JSON.stringify(wf));
        stricter.activities.find(a => a.id === assess.id)!.outcome_contract!.postconditions.push({ name: 'Under the limit', expression: 'cost < 200' });

        const { report } = await counterfactual_replay(wf, recorded.events, { candidate: stricter, ai: 'recorded' });
        expect(report.ai).toBe('recorded');
        expect(report.candidate.status).toBe('failed');
        expect(report.regressions[0]).toMatch(/Assess: Accepted in the recorded run, not in the candidate: Outcome contract violated: Under the limit/);
    });

    it('reports where the paths part, and what could not be replayed beyond that point', async () => {
        const { wf } = fixture();
        const recorded = await baseline(wf);
        const { report, status } = await counterfactual_replay(wf, recorded.events, { engine: { model_providers: [sure(300, 'review')] } });

        expect(report.same_path).toBe(false);
        expect(report.divergence).toEqual({ after: 'Triage', baseline_next: 'Pay', candidate_next: 'Review' });
        expect(report.nodes.find(n => n.node_name === 'Triage')).toMatchObject({ verdict: 'changed', baseline: { decision: { choice: 'pay' } }, candidate: { decision: { choice: 'review' } } });
        // "Review" never ran in the recorded run, so there is nothing to supply: the replay says so rather than inventing a result
        expect(report.unrecorded).toEqual(['activity "Review"']);
        expect(status).toBe('failed');
        expect(render_counterfactual_report(report)).toMatch(/After \*\*Triage\*\*, the recorded run went to \*\*Pay\*\* and the candidate to \*\*Review\*\*/);
    });

    it('replays recorded tool results instead of calling the tools again', async () => {
        const tool = ToolDefinitionSchema.parse({
            name: 'price', parameters: { type: 'object', properties: { part: { type: 'string' } } },
            binding: { kind: 'http', url: 'http://127.0.0.1:1/never/{part}' },
        });
        const a = activity('Quote', { actor_type: 'ai_agent', tools: [tool] });
        const wf = workflow([a], []);
        const agent = () => new FunctionModelProvider('acme', (request: ModelRequest) => {
            const results = (request.messages || []).filter(m => m.role === 'tool');
            return results.length ? reply({ total: JSON.parse(results[0].content).price }) : { text: '', tool_calls: [{ id: 'c1', name: 'price', arguments: { part: 'bumper' } }] };
        });
        const live = new WorkflowEngine(wf, { model_providers: [agent()], tools: { executors: { http: async () => ({ status: 200, result: { price: 1150 } }) } }, ...quiet });
        await live.start();
        expect(await live.run()).toBe('completed');

        // The replay has no executor for the tool and the URL is unreachable: the result can only come from the journal
        const { report, events } = await counterfactual_replay(wf, await live.getEvents(), { engine: { model_providers: [agent()] } });
        expect(report.candidate.status).toBe('completed');
        expect(events.find(e => e.type === 'tool.completed')!.data.result).toEqual({ price: 1150 });
        expect(report.nodes[0]).toMatchObject({ verdict: 'same', candidate: { tool_calls: 1, outcome: { total: 1150 } } });
    });

    it('redelivers the business events the recorded run received', async () => {
        const ask = activity('Ask'); const done = activity('Done');
        const wait = { id: uuidv4(), name: 'Reply', event_type: 'message', event_definition: { name: 'customer.replied' } };
        const wf = workflow([ask, done], [edge(ask, wait), edge(wait, done)], { events: [wait] });
        const engine = new WorkflowEngine(wf, { ...scripted({ Done: { closed: true } }), ...quiet });
        await engine.start();
        await engine.run();
        await engine.deliverEvent(business_event('customer.replied', { answer: 'yes' }));
        await engine.run();

        const { report, status } = await counterfactual_replay(wf, await engine.getEvents(), { ai: 'recorded' });
        expect(status).toBe('completed');
        expect(report.same_path).toBe(true);
    });

    it('refuses a journal that does not hold the outputs', async () => {
        const a = activity('A');
        const engine = new WorkflowEngine(workflow([a], []), { ...scripted({ A: { secret: 1 } }), ...quiet, journal_payloads: 'hash' });
        await engine.start();
        await engine.run();
        await expect(counterfactual_replay(engine.getWorkflow(), await engine.getEvents())).rejects.toThrow(/payload mode "full"/);
    });
});
