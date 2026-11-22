import { describe, it, expect } from 'vitest';
import { v4 as uuidv4 } from 'uuid';
import { WorkflowEngine } from '../src/runtime/workflow_engine';
import { AwaRuntime } from '../src/runtime/runtime';
import { BusinessEvent, business_event } from '../src/runtime/business_event';
import { JourneyDefinitionSchema, validate_journey } from '../src/runtime/journey';
import { InMemoryPersistenceAdapter } from '../src/runtime/persistence';
import { InMemoryJournalStore } from '../src/runtime/journal';
import { validate_workflow_integrity } from '../src/validator';
import { activity, edge, workflow, scripted, silent_logger } from './helpers';

const quiet = { sleep: async () => { }, execution_logger: silent_logger };
const HOUR = 3600 * 1000;
const ev = (name: string, event_type: string, definition: Record<string, unknown> = {}) =>
    ({ id: uuidv4(), name, event_type, event_definition: definition });

describe('Waiting for a business event', () => {
    function build(definition: Record<string, unknown> = {}, withTimeoutPath = false) {
        const ask = activity('Ask customer'); const proceed = activity('Proceed'); const chase = activity('Chase');
        const reply = ev('Customer replied', 'message', { name: 'customer.replied', correlation_key: 'case_id', ...definition });
        const toProceed = edge(reply, proceed); const toChase = edge(reply, chase);
        if (withTimeoutPath) (reply.event_definition as Record<string, unknown>).timeout_edge_id = toChase.id;
        const wf = workflow([ask, proceed, chase], [edge(ask, reply), toProceed, ...(withTimeoutPath ? [toChase] : [])], { events: [reply] });
        const s = scripted({ 'Ask customer': { case_id: 'C-1' } });
        return { wf, s, reply };
    }

    it('holds the token until an event with the matching correlation arrives, then continues with its data', async () => {
        const { wf, s } = build();
        const engine = new WorkflowEngine(wf, { actors: s.actors, ...quiet });
        await engine.start();
        expect(await engine.run()).toBe('waiting_event');

        expect(await engine.deliverEvent(business_event('customer.replied', { case_id: 'OTHER', answer: 'no' }))).toBe(0);
        expect(await engine.deliverEvent(business_event('something.else', { case_id: 'C-1' }))).toBe(0);
        expect(engine.getStatus()).toBe('waiting_event');

        const reply = business_event('customer.replied', { case_id: 'C-1', answer: 'yes' }, { source: '/crm' });
        expect(await engine.deliverEvent(reply)).toBe(1);
        expect(await engine.run()).toBe('completed');
        expect(s.actor.calls.map(c => c.activity)).toEqual(['Ask customer', 'Proceed']);
        expect(s.actor.calls[1].inputs.answer).toBe('yes');

        const events = await engine.getEvents();
        expect(events.find(e => e.type === 'event.waiting')!.data).toMatchObject({ name: 'customer.replied', correlation_key: 'case_id', correlation_value: 'C-1' });
        expect(events.find(e => e.type === 'event.received')!.data).toMatchObject({ event_id: reply.id, source: '/crm', data: { answer: 'yes' } });
        expect(events.find(e => e.type === 'run.waiting')!.data.waiting_for).toBe('event');
    });

    it('ignores a redelivery of an event it has already consumed', async () => {
        const first = activity('First'); const second = activity('Second');
        const a = ev('A', 'message', { name: 'ping' }); const b = ev('B', 'message', { name: 'ping' });
        const wf = workflow([first, second], [edge(first, a), edge(a, second), edge(second, b)], { events: [a, b] });
        const engine = new WorkflowEngine(wf, { ...scripted(), ...quiet });
        await engine.start();
        await engine.run();
        const ping = business_event('ping');
        expect(await engine.deliverEvent(ping)).toBe(1);
        expect(await engine.run()).toBe('waiting_event');   // now waiting at B for another ping
        expect(await engine.deliverEvent(ping)).toBe(0);    // the same occurrence does not count twice
        expect(await engine.deliverEvent(business_event('ping'))).toBe(1);
        expect(await engine.run()).toBe('completed');
    });

    it('takes the timeout edge when the wait runs out, and only then', async () => {
        let now = Date.parse('2026-01-01T00:00:00Z');
        const { wf, s } = build({ timeout: 'P3D' }, true);
        const engine = new WorkflowEngine(wf, { actors: s.actors, ...quiet, now: () => now });
        await engine.start();
        await engine.run();
        expect(engine.nextEventDeadline()).toBe(now + 72 * HOUR);

        expect(await engine.expireEvents(now + 71 * HOUR)).toBe(0);
        expect(await engine.expireEvents(now + 73 * HOUR)).toBe(1);
        expect(await engine.run()).toBe('completed');
        expect(s.actor.calls.map(c => c.activity)).toEqual(['Ask customer', 'Chase']);
        const events = await engine.getEvents();
        expect(events.map(e => e.type)).toContain('event.timed_out');
        expect(events.filter(e => e.type === 'token.moved').at(-1)!.data.reason).toBe('timeout');
    });

    it('does not follow the timeout edge when the event arrives in time', async () => {
        const { wf, s } = build({ timeout: 'P3D' }, true);
        const engine = new WorkflowEngine(wf, { actors: s.actors, ...quiet });
        await engine.start();
        await engine.run();
        await engine.deliverEvent(business_event('customer.replied', { case_id: 'C-1' }));
        expect(await engine.run()).toBe('completed');
        expect(s.actor.calls.map(c => c.activity)).toEqual(['Ask customer', 'Proceed']); // not a parallel split to Chase
    });

    it('fails the token when the wait runs out and there is no timeout edge', async () => {
        const { wf, s } = build({ timeout: 'PT1H' });
        const engine = new WorkflowEngine(wf, { actors: s.actors, ...quiet });
        await engine.start();
        await engine.run();
        await engine.expireEvents(Date.now() + 2 * HOUR);
        expect(await engine.run()).toBe('failed');
        expect(engine.getTokens()[0].getData('_error_code')).toBe('EVENT_TIMEOUT');
    });

    it('delivers a signal to every token waiting for it', async () => {
        const a = activity('A'); const b = activity('B'); const c = activity('C'); const d = activity('D');
        const s1 = ev('Go 1', 'signal', { name: 'market.opened' }); const s2 = ev('Go 2', 'signal', { name: 'market.opened' });
        const wf = workflow([a, b, c, d], [edge(a, s1), edge(a, s2), edge(s1, b), edge(s2, c), edge(b, d)], { events: [s1, s2] });
        const s = scripted();
        const engine = new WorkflowEngine(wf, { actors: s.actors, ...quiet });
        await engine.start();
        expect(await engine.run()).toBe('waiting_event');
        expect(await engine.deliverEvent(business_event('market.opened'))).toBe(2);
        expect(await engine.run()).toBe('completed');
        expect(s.actor.calls.map(call => call.activity).sort()).toEqual(['A', 'B', 'C', 'D']);
    });

    it('keeps the deadline and the consumed events across a restart', async () => {
        let now = Date.parse('2026-01-01T00:00:00Z');
        const { wf, s } = build({ timeout: 'P3D' }, true);
        const checkpoint = new InMemoryPersistenceAdapter(); const journal = new InMemoryJournalStore();
        const first = new WorkflowEngine(wf, { actors: s.actors, ...quiet, now: () => now, checkpoint, journal });
        await first.start();
        await first.run();

        now += 24 * HOUR;
        const second = WorkflowEngine.restore(wf, (await checkpoint.load(first.getRunId()))!, { actors: s.actors, ...quiet, now: () => now, checkpoint, journal });
        expect(second.getStatus()).toBe('waiting_event');
        expect(second.nextEventDeadline()).toBe(Date.parse('2026-01-04T00:00:00Z')); // three days from the original wait, not from the restart
        await second.deliverEvent(business_event('customer.replied', { case_id: 'C-1' }));
        expect(await second.run()).toBe('completed');
    });
});

describe('Publishing a business event', () => {
    const build = () => {
        const a = activity('Settle');
        const out = ev('Claim settled', 'message', { name: 'claim.settled', mode: 'publish', data: ['claim_id', 'amount'] });
        return workflow([a], [edge(a, out)], { events: [out] });
    };

    it('records the event in the journal, then hands it to the sink with a stable id', async () => {
        const sent: BusinessEvent[] = [];
        const engine = new WorkflowEngine(build(), { ...scripted({ Settle: { claim_id: 'C-9', amount: 250, internal_note: 'x' } }), ...quiet, event_sink: e => { sent.push(e); } });
        await engine.start();
        expect(await engine.run()).toBe('completed');
        expect(sent).toHaveLength(1);
        expect(sent[0]).toMatchObject({ specversion: '1.0', type: 'claim.settled', source: `urn:awa:run:${engine.getRunId()}`, data: { claim_id: 'C-9', amount: 250 } });
        expect(sent[0].data).not.toHaveProperty('internal_note'); // only the listed properties leave
        const published = (await engine.getEvents()).find(e => e.type === 'event.published')!;
        expect(published.data).toMatchObject({ event_id: sent[0].id, name: 'claim.settled', delivered: true });
        expect(sent[0].id).toBe(`${engine.getRunId()}:${build().events.length ? published.node_id : ''}:1`);
    });

    it('fails the token if the sink refuses the event', async () => {
        const engine = new WorkflowEngine(build(), { ...scripted(), ...quiet, event_sink: () => { throw new Error('broker down'); } });
        await engine.start();
        expect(await engine.run()).toBe('failed');
        expect(engine.getTokens()[0].getData('_error_code')).toBe('EVENT_PUBLISH_FAILED');
    });

    it('rejects an event with no name, or a timeout edge that does not leave it', () => {
        const a = activity('A'); const b = activity('B');
        const bad = ev('Wait', 'message', { timeout: 'soon', timeout_edge_id: uuidv4() });
        const codes = validate_workflow_integrity(workflow([a, b], [edge(a, bad), edge(bad, b)], { events: [bad] })).errors.map(e => e.code);
        expect(codes).toEqual(['invalid_event', 'invalid_event', 'invalid_reference']);
    });
});

describe('Journeys', () => {
    /** A claim journey: reported -> assessed -> settled, across three workflows and a customer reply */
    function setup() {
        let now = Date.parse('2026-03-01T09:00:00Z');
        const register = activity('Register claim');
        const intake = workflow([register], [], { name: 'Claim intake' });

        const assess = activity('Assess damage'); const offer = activity('Make offer');
        const accepted = ev('Offer answered', 'message', { name: 'offer.answered', correlation_key: 'customer_id', timeout: 'P7D' });
        const assessment = workflow([assess, offer], [edge(assess, offer), edge(offer, accepted)], { name: 'Assessment', events: [accepted] });

        const pay = activity('Pay claimant');
        const payout = workflow([pay], [], { name: 'Payout' });

        const journey = JourneyDefinitionSchema.parse({
            id: uuidv4(), name: 'Motor claim', version: '1.0.0',
            subject: { name: 'customer', key: 'customer_id' },
            stages: [
                { id: 'reported', name: 'Reported', workflows: [intake.id], complete_when: 'claim_id exists', max_duration: 'P1D' },
                { id: 'assessed', name: 'Assessed', on_enter: { start_workflow: assessment.id }, complete_when: 'offer_accepted exists', max_duration: 'P10D',
                  transitions: [{ to: 'settled', condition: 'offer_accepted == true' }, { to: 'disputed', is_default: true }] },
                { id: 'settled', name: 'Settled', on_enter: { start_workflow: payout.id }, complete_when: 'paid == true', transitions: [] },
                { id: 'disputed', name: 'Disputed' },
            ],
            triggers: [{ event: 'claim.submitted', starts_journey: true, start_workflow: intake.id }],
            goals: [{ id: 'paid', name: 'Claimant paid', expression: 'paid == true' }],
            exits: [{ event: 'claim.withdrawn', outcome: 'abandoned', reason: 'Customer withdrew the claim' }],
        });

        const s = scripted({
            'Register claim': { claim_id: 'CLM-1' }, 'Assess damage': { estimated_cost: 900 }, 'Make offer': { offer: 850 }, 'Pay claimant': { paid: true },
        });
        const runtime = new AwaRuntime({ engine: { actors: s.actors, ...quiet }, now: () => now })
            .register_workflow(intake).register_workflow(assessment).register_workflow(payout).register_journey(journey);
        return { runtime, journey, s, intake, assessment, payout, advance: (ms: number) => { now += ms; } };
    }
    const submitted = (customer = 'cust-7') => business_event('claim.submitted', { customer_id: customer, description: 'Rear-ended' }, { source: '/portal' });

    it('carries one subject through stages, starting the runs each stage needs and learning from each run', async () => {
        const { runtime, journey, s, advance } = setup();

        const started = await runtime.publish(submitted());
        const instance = runtime.get_journey_instance(started.journeys[0])!;
        // The intake run completed, which completed "Reported", which entered "Assessed" and started its workflow,
        // which is now waiting for the customer.
        expect(instance.stage_id).toBe('assessed');
        expect(instance.data).toMatchObject({ customer_id: 'cust-7', claim_id: 'CLM-1' });
        expect(instance.runs.map(r => `${r.workflow_name}:${r.status}`)).toEqual(['Claim intake:completed', 'Assessment:waiting_event']);

        advance(2 * 24 * HOUR);
        const answered = await runtime.publish(business_event('offer.answered', { customer_id: 'cust-7', offer_accepted: true }, { source: '/portal' }));
        expect(answered.resumed_runs).toHaveLength(1);

        expect(instance.status).toBe('completed');
        expect(instance.stage_history.map(h => h.stage_id)).toEqual(['reported', 'assessed', 'settled']);
        expect(instance.goals_reached).toEqual(['paid']);
        expect(instance.runs.map(r => r.workflow_name)).toEqual(['Claim intake', 'Assessment', 'Payout']);
        expect(s.actor.calls.map(c => c.activity)).toEqual(['Register claim', 'Assess damage', 'Make offer', 'Pay claimant']);
        // Later runs start with what earlier ones established
        expect(s.actor.calls.find(c => c.activity === 'Pay claimant')!.inputs).toMatchObject({ claim_id: 'CLM-1', offer: 850, offer_accepted: true });

        expect(instance.events.map(e => e.type)).toEqual([
            'journey.started', 'journey.stage_entered', 'journey.event_received',
            'journey.run_started', 'journey.run_ended', 'journey.stage_completed', 'journey.stage_entered',
            // the customer's answer is recorded before the run it wakes ends: the record reads in causal order
            'journey.run_started', 'journey.event_received', 'journey.run_ended', 'journey.stage_completed', 'journey.stage_entered',
            'journey.run_started', 'journey.run_ended', 'journey.goal_reached', 'journey.stage_completed', 'journey.completed',
        ]);
        expect(instance.events.map(e => e.seq)).toEqual(instance.events.map((_, i) => i + 1));
        // Each run-level journey event links to that run's own journal
        const bundle = await runtime.export_journey(instance.id);
        expect(bundle.runs.map(r => r.events.at(-1)!.type)).toEqual(['run.completed', 'run.completed', 'run.completed']);
        expect(bundle.workflows.map(w => w.name).sort()).toEqual(['Assessment', 'Claim intake', 'Payout']);
        expect(journey.stages).toHaveLength(4);
    });

    it('routes to another stage when the transition condition says so', async () => {
        const { runtime } = setup();
        const { journeys } = await runtime.publish(submitted());
        await runtime.publish(business_event('offer.answered', { customer_id: 'cust-7', offer_accepted: false }));
        const instance = runtime.get_journey_instance(journeys[0])!;
        expect(instance.stage_id).toBe('disputed');
        expect(instance.status).toBe('active');
    });

    it('keeps subjects apart, and ignores a duplicate event', async () => {
        const { runtime, journey } = setup();
        const first = submitted('cust-1');
        await runtime.publish(first);
        expect((await runtime.publish(first)).accepted).toBe(false);
        await runtime.publish(submitted('cust-2'));
        await runtime.publish(business_event('offer.answered', { customer_id: 'cust-2', offer_accepted: true }));
        const by_subject = Object.fromEntries(runtime.list_journey_instances(journey.id).map(i => [i.subject_key, i.status]));
        expect(by_subject).toEqual({ 'cust-1': 'active', 'cust-2': 'completed' });
    });

    it('marks a journey stalled when it outstays a stage, and times out the run that was waiting', async () => {
        const { runtime, advance } = setup();
        const { journeys } = await runtime.publish(submitted());
        const instance = runtime.get_journey_instance(journeys[0])!;
        advance(8 * 24 * HOUR);
        const first = await runtime.tick();
        expect(first.timed_out_runs).toHaveLength(1);   // the 7-day wait for the customer ran out
        expect(instance.runs[1].status).toBe('failed'); // no timeout edge in this workflow
        advance(3 * 24 * HOUR);
        expect((await runtime.tick()).stalled_journeys).toEqual([instance.id]);
        expect(instance.stalled).toBe(true);
        expect(instance.events.at(-1)!.type).toBe('journey.stalled');
        expect((await runtime.tick()).stalled_journeys).toEqual([]); // reported once
    });

    it('ends on an exit event', async () => {
        const { runtime } = setup();
        const { journeys } = await runtime.publish(submitted());
        await runtime.publish(business_event('claim.withdrawn', { customer_id: 'cust-7' }));
        const instance = runtime.get_journey_instance(journeys[0])!;
        expect(instance.status).toBe('abandoned');
        expect(instance.events.at(-1)).toMatchObject({ type: 'journey.abandoned', data: { reason: 'Customer withdrew the claim' } });
        // The run that was still waiting for the customer is withdrawn, not left to time out
        const statuses = instance.runs.map(r => runtime.get_run(r.run_id)!.getStatus());
        expect(statuses).toContain('cancelled');
        expect(statuses.every(status => status === 'completed' || status === 'cancelled')).toBe(true);
        expect(instance.events.at(-2)).toMatchObject({ type: 'journey.run_ended', data: { status: 'cancelled' } });
        expect((await runtime.tick(Date.now() + 365 * 24 * 3600 * 1000)).timed_out_runs).toEqual([]);
    });

    it('reports the funnel: who entered each stage, went on, is waiting, or dropped out', async () => {
        const { runtime, journey } = setup();
        await runtime.publish(submitted('a')); await runtime.publish(submitted('b')); await runtime.publish(submitted('c'));
        await runtime.publish(business_event('offer.answered', { customer_id: 'a', offer_accepted: true }));
        await runtime.publish(business_event('claim.withdrawn', { customer_id: 'c' }));
        const funnel = runtime.analytics(journey.id);
        expect(funnel).toMatchObject({ total: 3, completed: 1, abandoned: 1, active: 1, goals: { paid: 1 } });
        const stage = (id: string) => funnel.stages.find(s => s.stage_id === id)!;
        expect(stage('reported')).toMatchObject({ entered: 3, completed: 3, conversion: 1 });
        expect(stage('assessed')).toMatchObject({ entered: 3, completed: 1, active: 1, abandoned: 1 });
        expect(stage('settled')).toMatchObject({ entered: 1, completed: 1 });
    });

    it('starts a workflow from its start event when no journey is involved', async () => {
        const a = activity('Handle');
        const start = ev('Order placed', 'start', { name: 'order.placed' });
        const wf = workflow([a], [edge(start, a)], { events: [start] });
        const s = scripted();
        const runtime = new AwaRuntime({ engine: { actors: s.actors, ...quiet } }).register_workflow(wf);
        const result = await runtime.publish(business_event('order.placed', { order_id: 'o-1' }));
        expect(result.started_runs).toHaveLength(1);
        expect(s.actor.calls[0].inputs.order_id).toBe('o-1');
        expect(runtime.get_run(result.started_runs[0])!.getStatus()).toBe('completed');
    });

    it('rejects a journey that cannot start, names a missing stage, or has a bad expression', () => {
        const bad = JourneyDefinitionSchema.parse({
            id: uuidv4(), name: 'Bad', version: '1.0.0', subject: { name: 'customer', key: 'id' },
            stages: [{ id: 'one', name: 'One', complete_when: 'x >>> 1', transitions: [{ to: 'nowhere' }] }],
            triggers: [{ event: 'e' }],
        });
        expect(validate_journey(bad).map(e => e.code).sort()).toEqual(['invalid_expression', 'invalid_journey', 'invalid_reference']);
    });
});

describe('Cancelling a run (spec 5.8)', () => {
    it('withdraws waiting tokens, undoes completed work and refuses later events', async () => {
        const release = activity('Release');
        const reserve = activity('Reserve', { compensation: { activity_id: release.id } });
        const wait = { id: uuidv4(), name: 'Confirmed', event_type: 'message' as const, event_definition: { name: 'order.confirmed' } };
        const wf = workflow([reserve, release], [edge(reserve, wait)], { events: [wait] });
        const ran: string[] = [];
        const actor = { execute: async (a: { name: string }) => { ran.push(a.name); return {}; } };
        const engine = new WorkflowEngine(wf, {
            actors: { application: actor, ai_agent: actor, human: actor, robot: actor } as never,
            execution_logger: silent_logger,
        });
        await engine.start();
        expect(await engine.run()).toBe('waiting_event');

        expect(await engine.cancel('order replaced')).toBe(true);
        expect(engine.getStatus()).toBe('cancelled');
        expect(ran).toEqual(['Reserve', 'Release']);
        const types = (await engine.getEvents()).map(e => e.type);
        expect(types).toContain('token.cancelled');
        expect(types.at(-1)).toBe('run.cancelled');

        expect(await engine.deliverEvent(business_event('order.confirmed', {}))).toBe(0);
        expect(await engine.cancel('again')).toBe(false);
    });
});
