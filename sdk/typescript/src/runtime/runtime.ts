/**
 * AWA Runtime (specification sections 18 and 19)
 *
 * Hosts many runs and the journeys they belong to, and is the one place
 * business events enter. For each event it: ignores it if already seen,
 * hands it to the runs waiting for it, starts the runs it triggers, and
 * moves the journeys it concerns.
 */

import { randomUUID } from 'crypto';
import { UUID, Workflow } from '../types';
import { BusinessEvent } from './business_event';
import { resolve_path } from './expression';
import { JournalEvent, public_payload } from './journal';
import {
    JourneyDefinition, JourneyInstance, advance_journey, check_stalled, enter_stage,
    apply_sentiment, journey_analytics, journey_transitions, new_journey_instance, record_journey_event, record_touchpoint, touchpoints_for, validate_journey,
} from './journey';
import { WorkflowEngine, WorkflowEngineOptions } from './workflow_engine';

export interface RuntimeOptions {
    /** Options given to every run the runtime starts */
    engine?: WorkflowEngineOptions;
    /** The current time in milliseconds. Tests replace it to move time forward. */
    now?: () => number;
}

export interface PublishResult {
    /** False when the event id had been seen before; nothing else happened */
    accepted: boolean;
    /** Runs in which a waiting token continued */
    resumed_runs: string[];
    /** Runs the event started */
    started_runs: string[];
    /** Journey instances the event concerned */
    journeys: string[];
}

/** Everything about one journey, for a visualisation or an audit: its definition, its record, and the journal of each of its runs */
export interface JourneyBundle {
    definition: JourneyDefinition;
    instance: JourneyInstance;
    workflows: Workflow[];
    runs: { run_id: string; workflow_id: string; stage_id: string; events: JournalEvent[] }[];
}

export class AwaRuntime {
    private workflows = new Map<string, Workflow>();
    private journeys = new Map<string, JourneyDefinition>();
    private instances = new Map<string, JourneyInstance>();
    private runs = new Map<string, WorkflowEngine>();
    /** run id -> journey instance id */
    private run_journey = new Map<string, string>();
    private seen_events = new Set<string>();
    /** run id -> events the run published, taken in when the run next settles */
    private outbox = new Map<string, BusinessEvent[]>();
    /** journey id -> the business event types that concern it */
    private concerns = new Map<string, Set<string>>();

    constructor(private options: RuntimeOptions = {}) { }

    private now(): number {
        return this.options.now ? this.options.now() : Date.now();
    }
    private time(): string {
        return new Date(this.now()).toISOString();
    }

    register_workflow(workflow: Workflow): this {
        this.workflows.set(workflow.id, workflow);
        return this;
    }

    register_journey(definition: JourneyDefinition): this {
        const errors = validate_journey(definition, new Set(this.workflows.keys()));
        if (errors.length) throw new Error(`Invalid journey "${definition.name}": ${errors.map(e => e.message).join('; ')}`);
        this.journeys.set(definition.id, definition);
        // An event concerns a journey that names it, or whose workflows wait for it
        const types = new Set<string>([
            ...definition.triggers.map(t => t.event), ...definition.exits.map(e => e.event),
            ...definition.touchpoints.map(t => t.on.event).filter((t): t is string => !!t),
            ...(definition.sentiment?.rules || []).map(r => r.event).filter((t): t is string => !!t),
        ]);
        const workflow_ids = [...definition.stages.flatMap(s => [...s.workflows, ...(s.on_enter ? [s.on_enter.start_workflow] : [])]), ...definition.triggers.map(t => t.start_workflow)];
        for (const id of workflow_ids) {
            for (const event of (id && this.workflows.get(id)?.events) || []) {
                const name = (event.event_definition as { name?: string } | undefined)?.name;
                if (name) types.add(name);
            }
        }
        this.concerns.set(definition.id, types);
        return this;
    }

    get_run(run_id: string): WorkflowEngine | undefined { return this.runs.get(run_id); }
    list_runs(): WorkflowEngine[] { return [...this.runs.values()]; }
    get_journey_instance(id: string): JourneyInstance | undefined { return this.instances.get(id); }
    list_journey_instances(journey_id?: string): JourneyInstance[] {
        return [...this.instances.values()].filter(i => !journey_id || i.journey_id === journey_id);
    }
    find_journey_instance(journey_id: string, subject_key: string): JourneyInstance | undefined {
        return this.list_journey_instances(journey_id).find(i => i.subject_key === subject_key && i.status === 'active');
    }
    analytics(journey_id: string) {
        const definition = this.journeys.get(journey_id);
        if (!definition) throw new Error(`Journey ${journey_id} is not registered`);
        return journey_analytics(definition, this.list_journey_instances(journey_id));
    }

    /** Start a run. With a journey instance, the run belongs to that journey. */
    async start(workflow_id: UUID, input: Record<string, unknown> = {}, journey?: { instance: JourneyInstance; caused_by_event?: string }): Promise<WorkflowEngine> {
        const workflow = this.workflows.get(workflow_id);
        if (!workflow) throw new Error(`Workflow ${workflow_id} is not registered`);
        const outer_sink = this.options.engine?.event_sink;
        const engine = new WorkflowEngine(workflow, {
            ...this.options.engine, now: this.options.now,
            event_sink: async event => { this.outbox.set(run_id(), [...(this.outbox.get(run_id()) || []), event]); await outer_sink?.(event); },
        });
        const run_id = () => engine.getRunId();
        this.runs.set(engine.getRunId(), engine);

        if (journey) {
            const definition = this.journeys.get(journey.instance.journey_id)!;
            const stage = definition.stages.find(s => s.workflows.includes(workflow_id) || s.on_enter?.start_workflow === workflow_id);
            const ref = {
                run_id: engine.getRunId(), workflow_id, workflow_name: workflow.name,
                stage_id: stage?.id || journey.instance.stage_id, status: 'running', started_at: this.time(),
                ...(journey.caused_by_event ? { caused_by_event: journey.caused_by_event } : {}),
            };
            journey.instance.runs.push(ref);
            this.run_journey.set(ref.run_id, journey.instance.id);
            record_journey_event(journey.instance, 'journey.run_started', ref.started_at,
                { workflow_id, workflow_name: workflow.name, caused_by_event: journey.caused_by_event }, { run_id: ref.run_id, stage_id: ref.stage_id });
            // What the run does towards the outside world shows on the journey as touchpoints (spec 19.8)
            const instance = journey.instance;
            if (definition.touchpoints.length) engine.onEvent(event => {
                const d = event.data as Record<string, unknown>;
                const output = d.output as Record<string, unknown> | undefined;
                const occasion = event.type === 'activity.completed' ? { activity: event.node_name, data: (output?.output && typeof output.output === 'object' ? output.output : output) as Record<string, unknown> | undefined }
                    : event.type === 'tool.completed' ? { tool: d.tool as string, data: d.result as Record<string, unknown> | undefined, link: d.link as string | undefined }
                        : event.type === 'event.published' ? { event: d.name as string, data: d.data as Record<string, unknown> | undefined, event_id: d.event_id as string | undefined }
                            : undefined;
                if (!occasion) return;
                for (const touchpoint of touchpoints_for(definition, occasion)) {
                    if (occasion.event && touchpoint.direction !== 'outbound') continue;
                    record_touchpoint(definition, instance, touchpoint, event.time, { data: occasion.data, run_id: ref.run_id, event_id: (occasion as { event_id?: string }).event_id, link: (occasion as { link?: string }).link });
                }
            });
        }

        await engine.start(input);
        await engine.run();
        await this.sync(engine);
        return engine;
    }

    /** After a run has made progress: if it ended, fold its result into its journey and move the journey on */
    private async sync(engine: WorkflowEngine): Promise<void> {
        // What the run announced is taken in now that it has settled: after its own ending is recorded, before anything follows from it (spec 19.5)
        const flush = async () => { const events = this.outbox.get(engine.getRunId()) || []; this.outbox.delete(engine.getRunId()); for (const event of events) await this.publish(event); };
        const instance = this.instances.get(this.run_journey.get(engine.getRunId()) || '');
        if (!instance) return flush();
        const ref = instance.runs.find(r => r.run_id === engine.getRunId())!;
        const status = engine.getStatus();
        if (ref.status === status) return flush();
        ref.status = status;
        if (status !== 'completed' && status !== 'failed' && status !== 'cancelled') return flush();

        const definition = this.journeys.get(instance.journey_id)!;
        const time = this.time();
        ref.ended_at = time;
        if (status === 'completed') {
            // What the run established becomes part of what the journey knows
            for (const token of engine.getTokens().filter(t => t.status === 'completed')) {
                const facts = public_payload(token.contextData);
                const { decisions, ...rest } = facts;
                const kept = definition.collect ? Object.fromEntries(definition.collect.filter(k => k in rest).map(k => [k, rest[k]])) : rest;
                instance.data = { ...instance.data, ...kept };
            }
        }
        record_journey_event(instance, 'journey.run_ended', time,
            { workflow_name: ref.workflow_name, status, ...(status === 'failed' ? { error: engine.getTokens().find(t => t.status === 'failed')?.getData('_error') } : {}) },
            { run_id: ref.run_id, stage_id: ref.stage_id });
        // A failed run leaves the subject where they were, with nobody working for them (spec 19.5)
        if (status === 'failed' && instance.status === 'active' && !instance.stalled) {
            instance.stalled = true;
            const stage = definition.stages.find(s => s.id === instance.stage_id);
            record_journey_event(instance, 'journey.stalled', time, { stage_name: stage?.name, reason: `the ${ref.workflow_name} workflow failed` }, { run_id: ref.run_id });
            apply_sentiment(definition, instance, time, { on: 'run_failed', stage: instance.stage_id });
            apply_sentiment(definition, instance, time, { on: 'stalled', stage: instance.stage_id });
        }
        await flush();
        await this.progress(definition, instance, time);
    }

    /** An event from outside is an inbound touchpoint where the journey says so, and may move the mood */
    private touch(definition: JourneyDefinition, instance: JourneyInstance, event: BusinessEvent, time: string): void {
        if (event.source.startsWith('urn:awa:run:')) return; // told by the run that published it
        const data = (event.data || {}) as Record<string, unknown>;
        for (const touchpoint of touchpoints_for(definition, { event: event.type })) {
            if (touchpoint.direction === 'inbound') record_touchpoint(definition, instance, touchpoint, time, { data, event_id: event.id });
        }
        apply_sentiment(definition, instance, time, { on: 'event', event: event.type, data });
    }

    /** How subjects move from one journey to the next, across every journey registered */
    transitions() {
        return journey_transitions([...this.instances.values()]);
    }
    list_journeys(): JourneyDefinition[] { return [...this.journeys.values()]; }

    private async progress(definition: JourneyDefinition, instance: JourneyInstance, time: string, caused_by_event?: string): Promise<void> {
        for (const workflow_id of advance_journey(definition, instance, time)) {
            await this.start(workflow_id, { ...instance.data }, { instance, caused_by_event });
        }
    }

    /**
     * Take in a business event. Safe to call again with the same event: an id
     * already seen is ignored.
     */
    async publish(event: BusinessEvent): Promise<PublishResult> {
        const result: PublishResult = { accepted: false, resumed_runs: [], started_runs: [], journeys: [] };
        if (this.seen_events.has(event.id)) return result;
        this.seen_events.add(event.id);
        result.accepted = true;
        const data = event.data || {};
        const time = this.time();

        // 1. The event becomes part of the story of every journey it concerns before anything
        //    reacts to it, so that the record reads in causal order
        const recorded = new Set<string>();
        for (const definition of this.journeys.values()) {
            const key = resolve_path(data, definition.subject.key) ?? event.subject;
            if (key === undefined || key === null) continue;
            const instance = this.find_journey_instance(definition.id, String(key));
            if (!instance || !this.concerns.get(definition.id)?.has(event.type)) continue;
            instance.data = { ...instance.data, ...public_payload(data) };
            record_journey_event(instance, 'journey.event_received', time, { event_id: event.id, name: event.type, source: event.source, data });
            this.touch(definition, instance, event, time);
            recorded.add(instance.id);
        }

        // 2. Runs waiting for this event
        for (const engine of this.runs.values()) {
            if (await engine.deliverEvent(event) > 0) {
                result.resumed_runs.push(engine.getRunId());
                await engine.run();
                await this.sync(engine);
            }
        }

        // 3. Journeys the event concerns
        const in_journey = new Set<string>();
        for (const definition of this.journeys.values()) {
            const key = resolve_path(data, definition.subject.key) ?? event.subject;
            if (key === undefined || key === null) continue;
            const subject_key = String(key);
            let instance = this.find_journey_instance(definition.id, subject_key);
            const triggers = definition.triggers.filter(t => t.event === event.type);
            const exit = definition.exits.find(e => e.event === event.type);
            // An event about a subject already on its journey is part of that journey's story,
            // whether or not a rule reacts to it
            if (!triggers.length && !exit && !(instance && this.concerns.get(definition.id)?.has(event.type))) continue;

            if (!instance) {
                if (!triggers.some(t => t.starts_journey)) continue;
                instance = new_journey_instance(definition, randomUUID(), subject_key, time);
                // The subject brings the mood their last journey left them in
                const before = definition.sentiment?.carry_over
                    ? [...this.instances.values()].filter(i => i.subject_key === subject_key && i.sentiment !== undefined).sort((a, b) => a.started_at.localeCompare(b.started_at)).pop()
                    : undefined;
                if (before) instance.sentiment = Math.min(definition.sentiment!.max, Math.max(definition.sentiment!.min, before.sentiment!));
                this.instances.set(instance.id, instance);
                record_journey_event(instance, 'journey.started', time, {
                    subject: definition.subject.name, subject_key, journey_name: definition.name,
                    ...(instance.sentiment !== undefined ? { sentiment: instance.sentiment } : {}), ...(before ? { sentiment_carried_from: before.id } : {}),
                });
                enter_stage(definition, instance, definition.stages[0].id, time, 'journey started');
            }
            result.journeys.push(instance.id);
            if (!recorded.has(instance.id)) {
                instance.data = { ...instance.data, ...public_payload(data) };
                record_journey_event(instance, 'journey.event_received', time, { event_id: event.id, name: event.type, source: event.source, data });
                this.touch(definition, instance, event, time);
            }

            if (exit) {
                const open = instance.stage_history.find(h => !h.left_at);
                if (open) open.left_at = time;
                instance.status = exit.outcome;
                instance.ended_at = time;
                // Work still under way for a subject that has left is withdrawn, not left to time out
                for (const ref of instance.runs) {
                    const engine = this.runs.get(ref.run_id);
                    if (engine && await engine.cancel(`journey ${exit.outcome}: ${exit.reason || event.type}`)) await this.sync(engine);
                }
                record_journey_event(instance, exit.outcome === 'completed' ? 'journey.completed' : 'journey.abandoned', time, { reason: exit.reason || event.type, event_id: event.id });
                continue;
            }

            for (const trigger of triggers) {
                if (trigger.enter_stage && trigger.enter_stage !== instance.stage_id) {
                    const workflow_id = enter_stage(definition, instance, trigger.enter_stage, time, `event "${event.type}"`);
                    if (workflow_id) {
                        const run = await this.start(workflow_id, { ...instance.data }, { instance, caused_by_event: event.id });
                        result.started_runs.push(run.getRunId());
                        in_journey.add(workflow_id);
                    }
                }
                if (trigger.start_workflow) {
                    const run = await this.start(trigger.start_workflow, { ...instance.data }, { instance, caused_by_event: event.id });
                    result.started_runs.push(run.getRunId());
                    in_journey.add(trigger.start_workflow);
                }
            }
            await this.progress(definition, instance, time, event.id);
        }

        // 4. Workflows that start on this event and were not started as part of a journey
        for (const workflow of this.workflows.values()) {
            if (in_journey.has(workflow.id)) continue;
            const start = workflow.events.find(e => e.event_type === 'start' && (e.event_definition as { name?: string } | undefined)?.name === event.type);
            if (!start) continue;
            const run = await this.start(workflow.id, { ...public_payload(data) });
            result.started_runs.push(run.getRunId());
        }

        return result;
    }

    /**
     * Let time act: time out event waits whose deadline has passed, and mark
     * journeys that have stayed too long in a stage as stalled.
     */
    async tick(now: number = this.now()): Promise<{ timed_out_runs: string[]; stalled_journeys: string[] }> {
        const timed_out_runs: string[] = [];
        for (const engine of this.runs.values()) {
            if (await engine.expireEvents(now) > 0) {
                timed_out_runs.push(engine.getRunId());
                await engine.run();
                await this.sync(engine);
            }
        }
        const stalled_journeys: string[] = [];
        for (const instance of this.instances.values()) {
            if (check_stalled(this.journeys.get(instance.journey_id)!, instance, now)) stalled_journeys.push(instance.id);
        }
        return { timed_out_runs, stalled_journeys };
    }

    /** A person completed a task in one of the runs */
    async resume(run_id: string, token_id: string, output: Record<string, unknown>): Promise<boolean> {
        const engine = this.runs.get(run_id);
        if (!engine) return false;
        const resumed = await engine.resumeToken(token_id, output);
        await engine.run();
        await this.sync(engine);
        return resumed;
    }

    async export_journey(instance_id: string): Promise<JourneyBundle> {
        const instance = this.instances.get(instance_id);
        if (!instance) throw new Error(`Journey instance ${instance_id} not found`);
        const definition = this.journeys.get(instance.journey_id)!;
        const runs = [];
        for (const ref of instance.runs) {
            const engine = this.runs.get(ref.run_id);
            runs.push({ run_id: ref.run_id, workflow_id: ref.workflow_id, stage_id: ref.stage_id, events: engine ? await engine.getEvents() : [] });
        }
        const workflow_ids = new Set(instance.runs.map(r => r.workflow_id));
        return { definition, instance, workflows: [...workflow_ids].map(id => this.workflows.get(id)!).filter(Boolean), runs };
    }
}
