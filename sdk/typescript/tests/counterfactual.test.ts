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

    it('ends the waits as the recorded run ended them, in the order it ended them', async () => {
        // The first wait times out, a reminder goes, and the documents arrive at the second wait: the event must not end the first
        const ask = activity('Ask'), chase = activity('Chase'), check = activity('Check');
        const first = { id: uuidv4(), name: 'Uploaded', event_type: 'message', event_definition: { name: 'documents.uploaded', timeout: 'P2D' } } as Workflow['events'][number];
        const again = { id: uuidv4(), name: 'Uploaded after reminder', event_type: 'message', event_definition: { name: 'documents.uploaded' } } as Workflow['events'][number];
        const late = edge(first, chase);
        (first.event_definition as { timeout_edge_id?: string }).timeout_edge_id = late.id;
        const wf = workflow([ask, chase, check], [edge(ask, first), edge(first, check), late, edge(chase, again), edge(again, check)], { events: [first, again] });
        const engine = new WorkflowEngine(wf, { ...scripted({ Check: { checked: true } }), ...quiet });
        await engine.start();
        expect(await engine.run()).toBe('waiting_event');
        expect(await engine.expireEvents(Number.MAX_SAFE_INTEGER)).toBe(1);
        expect(await engine.run()).toBe('waiting_event');
        await engine.deliverEvent(business_event('documents.uploaded', { files: 3 }));
        expect(await engine.run()).toBe('completed');

        const { report, status } = await counterfactual_replay(wf, await engine.getEvents(), { ai: 'recorded' });
        expect(status).toBe('completed');
        expect(report.same_path, JSON.stringify(report.divergence)).toBe(true);
        expect(report.nodes.every(n => n.verdict === 'same'), report.nodes.map(n => `${n.node_name} ${n.verdict}`).join(', ')).toBe(true);
    });

    it('expires only the wait the recorded run timed out, when parallel branches wait with different deadlines', async () => {
        // Branch A times out after one day; branch B receives its event later, before its own ten-day deadline
        const ask = activity('Ask'), lateA = activity('Late A'), gotA = activity('Got A'), lateB = activity('Late B'), gotB = activity('Got B');
        const a = { id: uuidv4(), name: 'Reply A', event_type: 'message', event_definition: { name: 'a.replied', timeout: 'P1D' } } as Workflow['events'][number];
        const b = { id: uuidv4(), name: 'Reply B', event_type: 'message', event_definition: { name: 'b.replied', timeout: 'P10D' } } as Workflow['events'][number];
        const timeoutA = edge(a, lateA), timeoutB = edge(b, lateB);
        (a.event_definition as { timeout_edge_id?: string }).timeout_edge_id = timeoutA.id;
        (b.event_definition as { timeout_edge_id?: string }).timeout_edge_id = timeoutB.id;
        const wf = workflow([ask, lateA, gotA, lateB, gotB], [edge(ask, a), edge(ask, b), timeoutA, edge(a, gotA), timeoutB, edge(b, gotB)], { events: [a, b] });
        const engine = new WorkflowEngine(wf, { ...scripted({}), ...quiet });
        await engine.start();
        expect(await engine.run()).toBe('waiting_event');
        expect(await engine.expireEvents(Date.now() + 2 * 86400000)).toBe(1);
        expect(await engine.run()).toBe('waiting_event');
        await engine.deliverEvent(business_event('b.replied', { ok: true }));
        expect(await engine.run()).toBe('completed');
        const recorded = await engine.getEvents();
        expect(recorded.filter(e => e.type === 'activity.completed').map(e => e.node_name).sort()).toEqual(['Ask', 'Got B', 'Late A']);

        const { report, status, events } = await counterfactual_replay(wf, recorded, { ai: 'recorded' });
        expect(status).toBe('completed');
        expect(events.filter(e => e.type === 'event.timed_out').length).toBe(1);
        expect(report.same_path, JSON.stringify(report.divergence)).toBe(true);
        expect(report.nodes.every(n => n.verdict === 'same'), report.nodes.map(n => `${n.node_name} ${n.verdict}`).join(', ')).toBe(true);
    });

    it('withdraws the run where the recorded run was withdrawn, and compares what compensation undid', async () => {
        const refund = activity('Refund', { tools: [ToolDefinitionSchema.parse({ name: 'refund', binding: { kind: 'function', name: 'refund' } })] });
        const pay = activity('Pay', { compensation: { activity_id: refund.id } }), done = activity('Done');
        const wait = { id: uuidv4(), name: 'Reply', event_type: 'message', event_definition: { name: 'customer.replied' } } as Workflow['events'][number];
        const wf = workflow([pay, done, refund], [edge(pay, wait), edge(wait, done)], { events: [wait] });
        const actor = {
            execute: async (a: { name: string }, _i: unknown, context?: { tools?: { call: (n: string, a: Record<string, unknown>) => Promise<unknown> } }) => {
                if (a.name === 'Refund') { await context!.tools!.call('refund', { amount: 150 }); return { refunded: true }; }
                return { paid: 150 };
            },
        };
        const engine = new WorkflowEngine(wf, { actors: { application: actor }, tools: { handlers: { refund: () => ({ ok: true }) } }, ...quiet });
        await engine.start();
        expect(await engine.run()).toBe('waiting_event');
        expect(await engine.cancel('the customer withdrew')).toBe(true);

        const { report, status, events } = await counterfactual_replay(wf, await engine.getEvents(), { ai: 'recorded' });
        expect(status).toBe('cancelled');
        expect(events.find(e => e.type === 'run.cancelled')?.data.reason).toBe('the customer withdrew');
        expect(report.baseline.status).toBe('cancelled');
        expect(report.same_status && report.same_path && report.regressions.length === 0 && report.unrecorded.length === 0, JSON.stringify([report.regressions, report.unrecorded])).toBe(true);
        expect(report.nodes.find(n => n.node_name === 'Refund')).toMatchObject({ verdict: 'same', baseline: { accepted: true }, candidate: { accepted: true } });
    });

    it('restores what recorded activities wrote to contexts, so an activity that reads them runs as recorded', async () => {
        const profile = { id: uuidv4(), name: 'customer_profile', type: 'data' as const, sync_pattern: 'shared_state' as const };
        const register = activity('Register', { context_bindings: [{ context_id: profile.id, access_mode: 'write' as const }] });
        const verify = activity('Verify', { actor_type: 'ai_agent', context_bindings: [{ context_id: profile.id, access_mode: 'read' as const }] });
        const wf = workflow([register, verify], [edge(register, verify)], { contexts: [profile] as Workflow['contexts'] });
        const given: unknown[] = [];
        const actor = {
            execute: async (a: { name: string }, inputs: Record<string, unknown>) => {
                if (a.name === 'Register') return { customer_id: 'C-1', _context_writes: { customer_profile: { name: 'Lena', segment: 'household' } } };
                given.push(inputs._contexts);
                return { output: { documents_valid: true }, usage: { input_tokens: 1, output_tokens: 1 } };
            },
        };
        const engine = new WorkflowEngine(wf, { actors: { application: actor, ai_agent: actor }, ...quiet });
        await engine.start({});
        expect(await engine.run()).toBe('completed');
        const events = await engine.getEvents();
        expect(events.find(e => e.type === 'context.written')?.data.written).toEqual({ name: 'Lena', segment: 'household' });

        const recorded = await counterfactual_replay(wf, events, { ai: 'recorded' });
        expect(recorded.status, recorded.report.regressions.join('; ')).toBe('completed');
        expect(recorded.report.same_path && recorded.report.regressions.length === 0 && recorded.report.nodes.every(n => n.verdict === 'same')).toBe(true);
        expect(recorded.events.find(e => e.type === 'context.read')?.data.contexts).toMatchObject([{ context_name: 'customer_profile', present: true }]);

        // With live AI, the agent that runs again is given the context the recorded application wrote
        const live = await counterfactual_replay(wf, events, { ai: 'live', engine: { ...quiet, actors: { ai_agent: actor } } });
        expect(live.status).toBe('completed');
        expect(given.at(-1)).toEqual({ customer_profile: { name: 'Lena', segment: 'household' } });
    });

    it('refuses a journal that does not hold the outputs', async () => {
        const a = activity('A');
        const engine = new WorkflowEngine(workflow([a], []), { ...scripted({ A: { secret: 1 } }), ...quiet, journal_payloads: 'hash' });
        await engine.start();
        await engine.run();
        await expect(counterfactual_replay(engine.getWorkflow(), await engine.getEvents())).rejects.toThrow(/payload mode "full"/);
    });
});
