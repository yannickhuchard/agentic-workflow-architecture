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
import { WorkflowState } from './persistence';
import { WorkflowEngine, WorkflowEngineOptions } from './workflow_engine';
import { ShadowOptions, ShadowRunner } from './shadow';
import { JourneyTelemetry, TelemetrySetting, resolve_telemetry } from './telemetry_export';
import fs from 'fs/promises';
import { rmSync } from 'fs';
import path from 'path';

export interface RuntimeOptions {
    /** Options given to every run the runtime starts */
    engine?: WorkflowEngineOptions;
    /** The current time in milliseconds. Tests replace it to move time forward. */
    now?: () => number;
    /** Where the runtime keeps what it knows, so that another process can carry on (spec 19.10). Without it, everything is in memory. */
    store?: RuntimeStore;
    /** Run a candidate workflow or model beside production, compared as runs end (spec 33.5) */
    shadow?: ShadowOptions;
    /** Where the spans of journeys and of the runs they start go (spec 26): an exporter, or `{ endpoint, headers, payloads }`. Runs take it unless `engine.telemetry` says otherwise. */
    telemetry?: TelemetrySetting;
}

/** Everything a host must keep to carry on after a restart: journeys, runs, and which events it has already taken in */
export interface RuntimeState {
    version: '1';
    saved_at: string;
    instances: JourneyInstance[];
    runs: { run_id: string; workflow_id: string; journey_instance_id?: string; state: WorkflowState }[];
    seen_events: string[];
    outbox: Record<string, BusinessEvent[]>;
}

export interface RuntimeStore {
    save(state: RuntimeState): Promise<void>;
    load(): Promise<RuntimeState | null>;
}

export class InMemoryRuntimeStore implements RuntimeStore {
    private state: string | null = null;
    async save(state: RuntimeState): Promise<void> { this.state = JSON.stringify(state); }
    async load(): Promise<RuntimeState | null> { return this.state ? JSON.parse(this.state) : null; }
}

/** Keeps the runtime's state in one JSON file, replaced atomically on every save */
export class FileRuntimeStore implements RuntimeStore {
    constructor(private file: string) { }
    async save(state: RuntimeState): Promise<void> {
        await fs.mkdir(path.dirname(this.file), { recursive: true });
        const temporary = `${this.file}.${process.pid}.tmp`;
        await fs.writeFile(temporary, JSON.stringify(state));
        await fs.rename(temporary, this.file);
    }
    async load(): Promise<RuntimeState | null> {
        try { return JSON.parse(await fs.readFile(this.file, 'utf-8')); } catch (error) {
            if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
            throw error;
        }
    }
}

/** Several journeys with everything recorded about them: what a view of journeys reads */
export interface PortfolioBundle {
    as_of: string;
    workflows: Workflow[];
    transitions: { from: string; to: string; count: number; subjects: string[] }[];
    journeys: { definition: JourneyDefinition; analytics: ReturnType<typeof journey_analytics>; instances: { instance: JourneyInstance; runs: JourneyBundle['runs'] }[] }[];
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
    /** Release whatever the runtime holds outside the process, such as the lock on its directory. Safe to call more than once. */
    close: () => Promise<void> = async () => { };
    /** run id -> events the run published, taken in when the run next settles */
    private outbox = new Map<string, BusinessEvent[]>();
    /** journey id -> the business event types that concern it */
    private concerns = new Map<string, Set<string>>();

    /** The shadow of production, when the runtime was given one (spec 33.5) */
    readonly shadow?: ShadowRunner;

    private journey_telemetry?: JourneyTelemetry;
    private run_telemetry?: TelemetrySetting;

    constructor(private options: RuntimeOptions = {}) {
        if (options.shadow) this.shadow = new ShadowRunner(options.shadow, () => this.now());
        const telemetry = resolve_telemetry(options.telemetry);
        if (telemetry) {
            this.run_telemetry = { exporter: telemetry.exporter, payloads: telemetry.payloads };
            this.journey_telemetry = new JourneyTelemetry(telemetry.exporter, telemetry.payloads);
        }
    }

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
        const errors = validate_journey(definition, new Set(this.workflows.keys()), true);
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

    /** One operation of the host. When the outermost one ends, what the runtime knows is saved. */
    private depth = 0;
    private async op<T>(work: () => Promise<T>): Promise<T> {
        this.depth++;
        try { return await work(); } finally {
            this.depth--;
            if (this.depth === 0) await this.save();
        }
    }

    /** Write the runtime's state to its store. Called after every operation; a host may also call it. */
    async save(): Promise<void> {
        // Journals first: a state that names a journal position must never be ahead of the journal
        await Promise.all([...this.runs.values()].map(engine => engine.flush()));
        this.journey_telemetry?.observe(this.instances.values());
        if (!this.options.store) return;
        await this.options.store.save({
            version: '1', saved_at: this.time(),
            instances: [...this.instances.values()],
            runs: [...this.runs.values()].map(engine => ({ run_id: engine.getRunId(), workflow_id: engine.getWorkflow().id, journey_instance_id: this.run_journey.get(engine.getRunId()), state: engine.snapshot() })),
            seen_events: [...this.seen_events],
            outbox: Object.fromEntries(this.outbox),
        });
    }

    /**
     * Take up where a previous process left off (spec 19.10). Call after the
     * workflows and journeys are registered. Runs that were in the middle of an
     * activity execute it again, so activities are executed at least once (10.3).
     */
    async recover(): Promise<{ instances: number; runs: number; continued: string[] }> {
        const state = await this.options.store?.load();
        if (!state) return { instances: 0, runs: 0, continued: [] };

        // Everything is rebuilt aside first. A recovery that cannot complete throws here, before
        // anything is taken over or saved: the state on record stays exactly as it was (spec 19.10).
        const missing = state.runs.filter(saved => !this.workflows.has(saved.workflow_id));
        if (missing.length) throw new Error(`Cannot recover: ${missing.map(m => `run ${m.run_id} needs workflow ${m.workflow_id}`).join('; ')}, which is not registered. Nothing was changed.`);
        const instances = new Map(state.instances.map(i => [i.id, i]));
        const engines: { saved: RuntimeState['runs'][number]; engine: WorkflowEngine }[] = [];
        for (const saved of state.runs) {
            engines.push({ saved, engine: await WorkflowEngine.recover(this.workflows.get(saved.workflow_id)!, saved.state, this.engine_options(() => saved.run_id)) });
        }

        return this.op(async () => {
            this.instances = instances;
            this.journey_telemetry?.prime(instances.values());
            this.seen_events = new Set(state.seen_events);
            this.outbox = new Map(Object.entries(state.outbox || {}));
            const continued: string[] = [];
            for (const { saved, engine } of engines) {
                this.runs.set(saved.run_id, engine);
                const instance = this.instances.get(saved.journey_instance_id || '');
                if (instance) {
                    this.run_journey.set(saved.run_id, instance.id);
                    this.watch(engine, this.journeys.get(instance.journey_id)!, instance, saved.run_id);
                }
            }
            for (const { saved, engine } of engines) {
                if (engine.getStatus() === 'running') { continued.push(saved.run_id); await engine.run(); }
                await this.sync(engine);
            }
            return { instances: this.instances.size, runs: this.runs.size, continued };
        });
    }

    private engine_options(run_id: () => string): WorkflowEngineOptions {
        const outer_sink = this.options.engine?.event_sink;
        return {
            ...(this.run_telemetry ? { telemetry: this.run_telemetry } : {}),
            ...this.options.engine, now: this.options.now,
            event_sink: async event => { this.outbox.set(run_id(), [...(this.outbox.get(run_id()) || []), event]); await outer_sink?.(event); },
        };
    }

    /** What a run does towards the outside world shows on its journey as touchpoints (spec 19.8) */
    private watch(engine: WorkflowEngine, definition: JourneyDefinition, instance: JourneyInstance, run_id: string): void {
        if (!definition.touchpoints.length) return;
        engine.onEvent(event => {
            const d = event.data as Record<string, unknown>;
            const output = d.output as Record<string, unknown> | undefined;
            const occasion = event.type === 'activity.completed' ? { activity: event.node_name, data: (output?.output && typeof output.output === 'object' ? output.output : output) as Record<string, unknown> | undefined }
                : event.type === 'tool.completed' ? { tool: d.tool as string, data: d.result as Record<string, unknown> | undefined, link: d.link as string | undefined }
                    : event.type === 'event.published' ? { event: d.name as string, data: d.data as Record<string, unknown> | undefined, event_id: d.event_id as string | undefined }
                        : undefined;
            if (!occasion) return;
            for (const touchpoint of touchpoints_for(definition, occasion)) {
                if (occasion.event && touchpoint.direction !== 'outbound') continue;
                record_touchpoint(definition, instance, touchpoint, event.time, { data: occasion.data, run_id, event_id: (occasion as { event_id?: string }).event_id, link: (occasion as { link?: string }).link });
            }
        });
    }

    /** Start a run. With a journey instance, the run belongs to that journey. */
    async start(workflow_id: UUID, input: Record<string, unknown> = {}, journey?: { instance: JourneyInstance; caused_by_event?: string }): Promise<WorkflowEngine> {
        return this.op(async () => {
            const workflow = this.workflows.get(workflow_id);
            if (!workflow) throw new Error(`Workflow ${workflow_id} is not registered`);
            // The engine's options need its run id, which exists only once the engine does
            const made: { engine?: WorkflowEngine } = {};
            const engine = new WorkflowEngine(workflow, this.engine_options(() => made.engine!.getRunId()));
            made.engine = engine;
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
                this.watch(engine, definition, journey.instance, ref.run_id);
            }

            await engine.start(input);
            await engine.run();
            await this.sync(engine);
            return engine;
        });
    }

    /** After a run has made progress: if it ended, fold its result into its journey and move the journey on */
    private async sync(engine: WorkflowEngine): Promise<void> {
        await this.shadow?.settled(engine);
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
            record_journey_event(instance, 'journey.stalled', time, { stage_name: stage?.name, reason: `the ${ref.workflow_name} workflow failed`, ...(stage?.owner ? { owner: stage.owner } : {}) }, { run_id: ref.run_id });
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
        return this.op(() => this.take_in(event));
    }

    private async take_in(event: BusinessEvent): Promise<PublishResult> {
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
        return this.op(() => this.pass_time(now));
    }

    private async pass_time(now: number): Promise<{ timed_out_runs: string[]; stalled_journeys: string[] }> {
        const timed_out_runs: string[] = [];
        for (const engine of this.runs.values()) {
            if (await engine.expireEvents(now) > 0) {
                timed_out_runs.push(engine.getRunId());
                await engine.run();
                await this.sync(engine);
            }
            // Work that waits is compared with its service levels on the same schedule (spec 23.2)
            const levels = await engine.checkServiceLevels(now);
            if (levels.failed > 0) await engine.run();
            if (levels.failed > 0 || levels.breaches > 0 || levels.warnings > 0) await this.sync(engine);
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
        return this.op(async () => {
            const resumed = await engine.resumeToken(token_id, output);
            await engine.run();
            await this.sync(engine);
            return resumed;
        });
    }

    /** Every journey with everything recorded about it, for a view or an audit */
    async export_portfolio(): Promise<PortfolioBundle> {
        const journeys = [];
        for (const definition of this.journeys.values()) {
            const instances = [];
            for (const instance of this.list_journey_instances(definition.id)) instances.push({ instance, runs: (await this.export_journey(instance.id)).runs });
            journeys.push({ definition, analytics: journey_analytics(definition, this.list_journey_instances(definition.id)), instances });
        }
        return { as_of: this.time(), workflows: [...this.workflows.values()], transitions: this.transitions(), journeys };
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

/**
 * A runtime that lives in a directory: definitions, state and journals side by
 * side, so that a command line, a server or a scheduled job can each open it,
 * do one thing and leave it for the next.
 *
 *   <dir>/definitions/*.json   workflows and journeys
 *   <dir>/runtime.json         journeys, runs, events already taken in
 *   <dir>/journals/            one journal per run
 */
export async function open_runtime_directory(directory: string, options: RuntimeOptions = {}): Promise<AwaRuntime> {
    const { parse_document } = await import('../validator');
    const { JourneyDefinitionSchema } = await import('./journey');
    const { FileJournalStore } = await import('./journal');
    const definitions = path.join(directory, 'definitions');
    await fs.mkdir(definitions, { recursive: true });
    const release = await lock_directory(directory);
    const runtime = new AwaRuntime({
        ...options,
        store: options.store || new FileRuntimeStore(path.join(directory, 'runtime.json')),
        engine: { journal: new FileJournalStore(path.join(directory, 'journals')), ...options.engine },
    });
    const documents = [];
    for (const name of (await fs.readdir(definitions)).filter(n => n.endsWith('.json')).sort()) documents.push(JSON.parse(await fs.readFile(path.join(definitions, name), 'utf-8')));
    // Workflows first: a journey is checked against the workflows it names
    for (const document of documents.filter(d => !is_journey_document(d))) runtime.register_workflow(parse_document(document));
    for (const document of documents.filter(is_journey_document)) runtime.register_journey(JourneyDefinitionSchema.parse(document));
    try { await runtime.recover(); } catch (error) { await release(); throw error; }
    runtime.close = release;
    return runtime;
}

const held = new Map<string, number>();
/**
 * One host at a time on a runtime directory: two processes that each loaded the state and each
 * saved it would lose one another's work. The lock is a file naming the process that holds it.
 * A lock left by a process that no longer exists is taken over. Within one process the lock is
 * counted, so that a program may open the directory more than once in turn.
 */
async function lock_directory(directory: string): Promise<() => Promise<void>> {
    const file = path.join(directory, 'runtime.lock');
    let released = false;
    // Each opening releases once: a second call must not take away a lock that a later opening holds
    const release = async () => {
        if (released) return;
        released = true;
        const left = (held.get(file) || 1) - 1;
        if (left > 0) { held.set(file, left); return; }
        held.delete(file);
        await fs.rm(file, { force: true });
    };
    if (held.has(file)) { held.set(file, held.get(file)! + 1); return release; }

    // The lock is written aside and linked into place, so that it never exists without naming its owner:
    // another host can then never mistake a lock that is being taken for one left behind.
    const mine = `${file}.${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2)}`;
    await fs.writeFile(mine, String(process.pid));
    try {
        for (let attempt = 0; attempt < 3; attempt++) {
            try {
                await fs.link(mine, file);
                if ((await fs.readFile(file, 'utf-8')) !== String(process.pid)) continue;     // taken over in the same instant: start again
                held.set(file, 1);
                process.once('exit', () => { try { if (held.has(file)) rmSync(file, { force: true }); } catch { /* leaving */ } });
                return release;
            } catch (error) {
                if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
                const text = await fs.readFile(file, 'utf-8').catch(() => null);
                if (text === null) continue;                                                // released meanwhile
                const pid = Number(text);
                if (!Number.isInteger(pid) || pid <= 0) throw new Error(`The runtime directory ${directory} holds a lock that names no process (${file}). If no host is running, remove that file.`);
                let alive = false;
                try { process.kill(pid, 0); alive = true; } catch (probe) { alive = (probe as NodeJS.ErrnoException).code === 'EPERM'; }
                if (alive) throw new Error(`The runtime directory ${directory} is in use by process ${pid}. One host at a time: stop it, or talk to it over HTTP.`);
                // Left behind by a process that is gone. Remove it only if it is still that lock.
                if ((await fs.readFile(file, 'utf-8').catch(() => null)) === text) await fs.rm(file, { force: true });
            }
        }
    } finally {
        await fs.rm(mine, { force: true });
    }
    throw new Error(`Could not lock the runtime directory ${directory}`);
}

/** A journey has stages and a subject; a workflow has activities */
export function is_journey_document(document: unknown): boolean {
    const d = document as Record<string, unknown>;
    return !!d && Array.isArray(d.stages) && typeof d.subject === 'object';
}

/** Add a workflow or a journey to a runtime directory. Returns what it was. */
export async function add_definition(directory: string, document: Record<string, unknown>): Promise<{ kind: 'workflow' | 'journey'; id: string; name: string }> {
    const { parse_document } = await import('../validator');
    const { JourneyDefinitionSchema } = await import('./journey');
    const journey = is_journey_document(document);
    const parsed = journey ? JourneyDefinitionSchema.parse(document) : parse_document(document);
    await fs.mkdir(path.join(directory, 'definitions'), { recursive: true });
    await fs.writeFile(path.join(directory, 'definitions', `${journey ? 'journey' : 'workflow'}-${parsed.id}.json`), JSON.stringify(document, null, 2) + '\n');
    return { kind: journey ? 'journey' : 'workflow', id: parsed.id, name: parsed.name };
}
