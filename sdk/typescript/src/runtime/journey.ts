/**
 * AWA Journeys (specification section 19)
 *
 * A workflow run is one piece of work. A journey is the longer story those
 * pieces belong to: one subject (a customer, a claim, an order) moving through
 * stages over days or months, driven by business events, with many runs along
 * the way.
 *
 * This module holds the journey document, the state of one journey, and the
 * rules that move it. It does no I/O; the runtime drives it.
 */

import { z } from 'zod';
import { Duration, UUID } from '../types';
import { evaluate_expression, resolve_path } from './expression';
import { parse_iso_duration } from './duration_utils';

export const JourneyStageSchema = z.object({
    id: z.string().regex(/^[a-z0-9][a-z0-9_-]{0,63}$/),
    name: z.string(),
    description: z.string().optional(),
    /** Runs of these workflows belong to this stage */
    workflows: z.array(UUID).default([]),
    /** Started automatically when the stage is entered */
    on_enter: z.object({ start_workflow: UUID }).optional(),
    /** The stage is complete when this is true of the journey's data */
    complete_when: z.string().optional(),
    /** A journey that stays longer in the stage is stalled */
    max_duration: Duration.optional(),
    /** Who must act when the journey stalls in this stage: a team, a role or a person, as the organisation names them */
    owner: z.string().optional(),
    /** Where the journey goes when the stage completes. Absent: the next stage in the list. Empty: the journey completes here. */
    transitions: z.array(z.object({ to: z.string(), condition: z.string().optional(), is_default: z.boolean().default(false) })).optional(),
});
export type JourneyStage = z.infer<typeof JourneyStageSchema>;

const Slug = z.string().regex(/^[a-z0-9][a-z0-9_-]{0,63}$/);

/**
 * A kind of thing that changes hands in the journey, named as the business
 * names it: a contract, an attestation, an invoice, a receipt, a certificate.
 * `kind` is an open vocabulary; the listed values are the recommended ones.
 */
export const ARTEFACT_KINDS = ['contract', 'attestation', 'invoice', 'receipt', 'certificate', 'quote', 'form', 'evidence', 'notice', 'order', 'report', 'survey'] as const;
export const JourneyArtefactSchema = z.object({
    id: Slug,
    name: z.string(),
    kind: z.string(),
    description: z.string().optional(),
});
export type JourneyArtefact = z.infer<typeof JourneyArtefactSchema>;

/** A moment at which the organisation and someone else are in contact, and what carries it */
export const TouchpointSchema = z.object({
    id: Slug,
    name: z.string(),
    /** Who is on the other side: "subject" (the default) or the name of a third party, e.g. "bank" */
    party: z.string().default('subject'),
    /** inbound: the party acts towards the organisation. outbound: the organisation acts towards the party. */
    direction: z.enum(['inbound', 'outbound']),
    /** How the contact is made, e.g. web, email, phone, sms, app, post, api, in_person */
    channel: z.string(),
    /** The system that carries it, e.g. "Customer portal", "Payments RPC" */
    technology: z.string().optional(),
    /** What makes the touchpoint happen: a business event, the completion of an activity, or a tool call */
    on: z.object({ event: z.string().optional(), activity: z.string().optional(), tool: z.string().optional() })
        .refine(on => [on.event, on.activity, on.tool].filter(Boolean).length === 1, 'A touchpoint names exactly one of event, activity or tool'),
    /** What changes hands. `reference` is a path in the data of the occasion that identifies the particular document. */
    exchanges: z.array(z.object({ artefact: Slug, reference: z.string().optional() })).default([]),
});
export type Touchpoint = z.infer<typeof TouchpointSchema>;

/**
 * How the subject's mood is estimated. A value is either measured (the subject
 * said so, and a rule reads it from an event) or inferred (the authors of the
 * journey wrote a rule that moves it). The record says which, every time.
 */
export const SentimentSchema = z.object({
    min: z.number().default(-2),
    max: z.number().default(2),
    initial: z.number().default(0),
    /** A new journey begins with the mood the subject's previous journey ended with */
    carry_over: z.boolean().default(true),
    rules: z.array(z.object({
        on: z.enum(['event', 'touchpoint', 'goal_reached', 'stage_completed', 'stalled', 'run_failed', 'waited']),
        /** Narrow the rule: the event type, touchpoint id, goal id or stage id it applies to */
        event: z.string().optional(), touchpoint: z.string().optional(), goal: z.string().optional(), stage: z.string().optional(),
        /** waited: the subject acted and heard nothing for longer than this */
        longer_than: Duration.optional(),
        /** Measured: read the value at `path` in the occasion's data, given on the scale `from`, onto the journey's scale */
        measure: z.object({ path: z.string(), from: z.tuple([z.number(), z.number()]) }).optional(),
        /** Inferred: move the mood by this much */
        change: z.number().optional(),
        reason: z.string().optional(),
    }).refine(rule => (rule.measure === undefined) !== (rule.change === undefined), 'A sentiment rule has either measure or change')).default([]),
});
export type Sentiment = z.infer<typeof SentimentSchema>;

export const JourneyDefinitionSchema = z.object({
    id: UUID,
    name: z.string(),
    version: z.string().regex(/^\d+\.\d+\.\d+$/),
    awa_version: z.string().optional(),
    description: z.string().optional(),
    /** Whose journey it is, and the property that identifies them in events and run data */
    subject: z.object({ name: z.string(), key: z.string() }),
    stages: z.array(JourneyStageSchema).min(1),
    /** What a business event does to the journey */
    triggers: z.array(z.object({
        event: z.string(),
        /** The event may begin a journey for a subject that has none */
        starts_journey: z.boolean().default(false),
        enter_stage: z.string().optional(),
        start_workflow: UUID.optional(),
    })).default([]),
    /** Outcomes worth tracking, each true or false of the journey's data */
    goals: z.array(z.object({ id: z.string(), name: z.string(), expression: z.string() })).default([]),
    /** Events that end the journey early */
    exits: z.array(z.object({ event: z.string(), outcome: z.enum(['completed', 'abandoned']), reason: z.string().optional() })).default([]),
    /** Run data properties copied into the journey's data when a run ends. Absent: all. */
    collect: z.array(z.string()).optional(),
    /** The kinds of thing that change hands */
    artefacts: z.array(JourneyArtefactSchema).default([]),
    /** The moments of contact, with their channel, technology and what is exchanged */
    touchpoints: z.array(TouchpointSchema).default([]),
    /** How the subject's mood is estimated */
    sentiment: SentimentSchema.optional(),
});
export type JourneyDefinition = z.infer<typeof JourneyDefinitionSchema>;

export type JourneyEventType =
    | 'journey.started' | 'journey.event_received'
    | 'journey.stage_entered' | 'journey.stage_completed' | 'journey.stalled'
    | 'journey.run_started' | 'journey.run_ended'
    | 'journey.goal_reached'
    | 'journey.touchpoint' | 'journey.sentiment_changed'
    | 'journey.completed' | 'journey.abandoned';

/** One entry in the record of a journey. Same shape of envelope as a run's journal event. */
export interface JourneyEvent {
    spec_version: string;
    journey_instance_id: string;
    journey_id: string;
    seq: number;
    time: string;
    type: JourneyEventType;
    stage_id?: string;
    /** The run concerned, which links this event to that run's own journal */
    run_id?: string;
    data: Record<string, unknown>;
}

export interface JourneyRunRef {
    run_id: string;
    workflow_id: string;
    workflow_name: string;
    stage_id: string;
    status: string;
    started_at: string;
    ended_at?: string;
    /** The business event that started the run, if one did */
    caused_by_event?: string;
}

export interface JourneyInstance {
    id: string;
    journey_id: string;
    subject_key: string;
    status: 'active' | 'completed' | 'abandoned';
    stage_id: string;
    stage_entered_at: string;
    stalled: boolean;
    /** Facts accumulated from events and runs */
    data: Record<string, unknown>;
    goals_reached: string[];
    /** The current estimate of the subject's mood, when the journey defines sentiment */
    sentiment?: number;
    /** When the subject last acted without having heard back since; drives the `waited` rule */
    awaiting_reply_since?: string;
    runs: JourneyRunRef[];
    stage_history: { stage_id: string; entered_at: string; left_at?: string }[];
    started_at: string;
    ended_at?: string;
    events: JourneyEvent[];
}

const safe = (expression: string, data: Record<string, unknown>): boolean => {
    try { return evaluate_expression(expression, data); } catch { return false; }
};

export function new_journey_instance(definition: JourneyDefinition, id: string, subject_key: string, time: string): JourneyInstance {
    return {
        id, journey_id: definition.id, subject_key, status: 'active',
        stage_id: definition.stages[0].id, stage_entered_at: time, stalled: false,
        data: {}, goals_reached: [], runs: [], stage_history: [], started_at: time, events: [],
        ...(definition.sentiment ? { sentiment: definition.sentiment.initial } : {}),
    };
}

export function record_journey_event(
    instance: JourneyInstance, type: JourneyEventType, time: string, data: Record<string, unknown> = {}, extra: { stage_id?: string; run_id?: string } = {},
): JourneyEvent {
    const event: JourneyEvent = {
        spec_version: '1.1', journey_instance_id: instance.id, journey_id: instance.journey_id,
        seq: instance.events.length + 1, time, type,
        stage_id: extra.stage_id ?? instance.stage_id, ...(extra.run_id ? { run_id: extra.run_id } : {}), data,
    };
    instance.events.push(event);
    return event;
}

/** Move the journey into a stage. Returns the workflow to start there, if the stage names one. */
export function enter_stage(definition: JourneyDefinition, instance: JourneyInstance, stage_id: string, time: string, reason: string): UUID | undefined {
    const stage = definition.stages.find(s => s.id === stage_id);
    if (!stage) throw new Error(`Journey "${definition.name}" has no stage "${stage_id}"`);
    const open = instance.stage_history.find(h => !h.left_at);
    if (open) open.left_at = time;
    instance.stage_id = stage.id;
    instance.stage_entered_at = time;
    instance.stalled = false;
    instance.stage_history.push({ stage_id: stage.id, entered_at: time });
    record_journey_event(instance, 'journey.stage_entered', time, { stage_name: stage.name, reason }, { stage_id: stage.id });
    return stage.on_enter?.start_workflow;
}

export interface SentimentOccasion {
    on: 'event' | 'touchpoint' | 'goal_reached' | 'stage_completed' | 'stalled' | 'run_failed' | 'waited';
    event?: string; touchpoint?: string; goal?: string; stage?: string;
    /** The data of the occasion, for a rule that measures */
    data?: Record<string, unknown>;
    /** waited: how long, in milliseconds */
    waited_ms?: number;
}

/**
 * Let what just happened move the estimate of the subject's mood (spec 19.9).
 * Every rule that matches applies, in order. Each change is recorded with its
 * basis, so that a reader can tell what the subject said from what was assumed.
 */
export function apply_sentiment(definition: JourneyDefinition, instance: JourneyInstance, time: string, occasion: SentimentOccasion): void {
    const sentiment = definition.sentiment;
    if (!sentiment || instance.sentiment === undefined) return;
    for (const rule of sentiment.rules) {
        if (rule.on !== occasion.on) continue;
        if ((rule.event && rule.event !== occasion.event) || (rule.touchpoint && rule.touchpoint !== occasion.touchpoint)
            || (rule.goal && rule.goal !== occasion.goal) || (rule.stage && rule.stage !== occasion.stage)) continue;
        if (rule.on === 'waited' && (!rule.longer_than || (occasion.waited_ms ?? 0) <= parse_iso_duration(rule.longer_than))) continue;

        const previous: number = instance.sentiment;
        let value: number;
        if (rule.measure) {
            const raw = Number(resolve_path(occasion.data || {}, rule.measure.path));
            if (Number.isNaN(raw)) continue;
            const [low, high] = rule.measure.from;
            value = sentiment.min + (raw - low) / (high - low) * (sentiment.max - sentiment.min);
        } else {
            value = previous + (rule.change ?? 0);
        }
        value = Math.min(sentiment.max, Math.max(sentiment.min, Math.round(value * 100) / 100));
        if (value === previous && !rule.measure) continue;
        instance.sentiment = value;
        record_journey_event(instance, 'journey.sentiment_changed', time, {
            value, previous, basis: rule.measure ? 'measured' : 'inferred',
            ...(rule.reason ? { reason: rule.reason } : {}), on: occasion.on,
        });
    }
}

/** The touchpoints an occasion realises */
export function touchpoints_for(definition: JourneyDefinition, occasion: { event?: string; activity?: string; tool?: string }): Touchpoint[] {
    return definition.touchpoints.filter(t =>
        (occasion.event !== undefined && t.on.event === occasion.event)
        || (occasion.activity !== undefined && t.on.activity === occasion.activity)
        || (occasion.tool !== undefined && t.on.tool === occasion.tool));
}

/**
 * Record that a touchpoint took place (spec 19.8): who was in contact, over
 * what channel and technology, and what changed hands.
 */
export function record_touchpoint(
    definition: JourneyDefinition, instance: JourneyInstance, touchpoint: Touchpoint, time: string,
    context: { data?: Record<string, unknown>; run_id?: string; event_id?: string; link?: string } = {},
): JourneyEvent {
    const artefacts = touchpoint.exchanges.map(exchange => {
        const artefact = definition.artefacts.find(a => a.id === exchange.artefact);
        const reference = exchange.reference ? resolve_path(context.data || {}, exchange.reference) : undefined;
        return { id: exchange.artefact, name: artefact?.name ?? exchange.artefact, kind: artefact?.kind ?? 'unknown', ...(reference !== undefined && reference !== null ? { reference: String(reference) } : {}) };
    });
    const to_subject = touchpoint.party === 'subject';

    // The subject acted and heard nothing for a while: that wait is felt when the reply comes
    if (to_subject && touchpoint.direction === 'outbound' && instance.awaiting_reply_since) {
        const waited_ms = new Date(time).getTime() - new Date(instance.awaiting_reply_since).getTime();
        instance.awaiting_reply_since = undefined;
        apply_sentiment(definition, instance, time, { on: 'waited', waited_ms });
    }
    if (to_subject && touchpoint.direction === 'inbound' && !instance.awaiting_reply_since) instance.awaiting_reply_since = time;

    const event = record_journey_event(instance, 'journey.touchpoint', time, {
        touchpoint_id: touchpoint.id, name: touchpoint.name, party: touchpoint.party, direction: touchpoint.direction,
        channel: touchpoint.channel, ...(touchpoint.technology ? { technology: touchpoint.technology } : {}),
        artefacts, ...(context.event_id ? { event_id: context.event_id } : {}), ...(context.link ? { link: context.link } : {}),
    }, context.run_id ? { run_id: context.run_id } : {});
    apply_sentiment(definition, instance, time, { on: 'touchpoint', touchpoint: touchpoint.id, data: context.data });
    return event;
}

/** How subjects move from one journey to the next: for each pair, how many did */
export function journey_transitions(instances: JourneyInstance[]): { from: string; to: string; count: number; subjects: string[] }[] {
    const by_subject = new Map<string, JourneyInstance[]>();
    for (const instance of instances) by_subject.set(instance.subject_key, [...(by_subject.get(instance.subject_key) || []), instance]);
    const pairs = new Map<string, { from: string; to: string; count: number; subjects: string[] }>();
    for (const [subject, list] of by_subject) {
        list.sort((a, b) => a.started_at.localeCompare(b.started_at));
        for (let i = 1; i < list.length; i++) {
            const key = `${list[i - 1].journey_id}>${list[i].journey_id}`;
            const pair = pairs.get(key) || { from: list[i - 1].journey_id, to: list[i].journey_id, count: 0, subjects: [] };
            pair.count++; pair.subjects.push(subject);
            pairs.set(key, pair);
        }
    }
    return [...pairs.values()];
}

/**
 * Apply the journey's rules to its current data: record goals newly reached,
 * and complete the current stage if its condition holds, moving to the next.
 * Returns the workflows to start as a result.
 */
export function advance_journey(definition: JourneyDefinition, instance: JourneyInstance, time: string): UUID[] {
    const to_start: UUID[] = [];
    if (instance.status !== 'active') return to_start;

    for (const goal of definition.goals) {
        if (!instance.goals_reached.includes(goal.id) && safe(goal.expression, instance.data)) {
            instance.goals_reached.push(goal.id);
            record_journey_event(instance, 'journey.goal_reached', time, { goal_id: goal.id, goal_name: goal.name });
            apply_sentiment(definition, instance, time, { on: 'goal_reached', goal: goal.id });
        }
    }

    // A stage may complete at once on entry, so this repeats; the bound stops a cycle of always-true stages
    for (let guard = 0; guard < definition.stages.length + 1; guard++) {
        const stage = definition.stages.find(s => s.id === instance.stage_id)!;
        if (!stage.complete_when || !safe(stage.complete_when, instance.data)) break;

        record_journey_event(instance, 'journey.stage_completed', time, { stage_name: stage.name, duration_ms: new Date(time).getTime() - new Date(instance.stage_entered_at).getTime() });
        apply_sentiment(definition, instance, time, { on: 'stage_completed', stage: stage.id });

        const index = definition.stages.indexOf(stage);
        const transitions = stage.transitions;
        const next = transitions
            ? (transitions.find(t => t.condition && safe(t.condition, instance.data)) || transitions.find(t => t.is_default) || transitions.find(t => !t.condition))?.to
            : definition.stages[index + 1]?.id;

        if (!next) {
            const open = instance.stage_history.find(h => !h.left_at);
            if (open) open.left_at = time;
            instance.status = 'completed';
            instance.ended_at = time;
            record_journey_event(instance, 'journey.completed', time, { goals_reached: instance.goals_reached });
            break;
        }
        const workflow = enter_stage(definition, instance, next, time, `stage "${stage.name}" completed`);
        if (workflow) to_start.push(workflow);
    }
    return to_start;
}

/** Mark the journey stalled if it has been in its stage longer than the stage allows */
export function check_stalled(definition: JourneyDefinition, instance: JourneyInstance, now: number): boolean {
    if (instance.status !== 'active' || instance.stalled) return false;
    const stage = definition.stages.find(s => s.id === instance.stage_id);
    if (!stage?.max_duration) return false;
    const limit = parse_iso_duration(stage.max_duration);
    const spent = now - new Date(instance.stage_entered_at).getTime();
    if (spent <= limit) return false;
    instance.stalled = true;
    record_journey_event(instance, 'journey.stalled', new Date(now).toISOString(), { stage_name: stage.name, max_duration: stage.max_duration, in_stage_ms: spent, ...(stage.owner ? { owner: stage.owner } : {}) });
    apply_sentiment(definition, instance, new Date(now).toISOString(), { on: 'stalled', stage: stage.id });
    return true;
}

export interface StageAnalytics {
    stage_id: string;
    stage_name: string;
    /** Journeys that entered the stage */
    entered: number;
    /** Journeys that left it for another stage or completed the journey from it */
    completed: number;
    /** Journeys in it now */
    active: number;
    stalled: number;
    /** Journeys that ended in it without completing */
    abandoned: number;
    /** Median time spent by the journeys that completed it, in milliseconds */
    median_duration_ms?: number;
    /** completed / entered */
    conversion?: number;
}

/** The funnel of a journey: for each stage, how many came in, went on, are waiting, stalled or dropped out */
export function journey_analytics(definition: JourneyDefinition, instances: JourneyInstance[]): { total: number; completed: number; abandoned: number; active: number; goals: Record<string, number>; stages: StageAnalytics[] } {
    const mine = instances.filter(i => i.journey_id === definition.id);
    const stages = definition.stages.map(stage => {
        const visits = mine.flatMap(i => i.stage_history.filter(h => h.stage_id === stage.id).map(h => ({ i, h })));
        const journeys = new Set(visits.map(v => v.i.id));
        const here = mine.filter(i => i.stage_id === stage.id);
        const done = visits.filter(v => v.h.left_at && !(v.i.status === 'abandoned' && v.i.stage_id === stage.id && v.h === v.i.stage_history[v.i.stage_history.length - 1]));
        const durations = done.map(v => new Date(v.h.left_at!).getTime() - new Date(v.h.entered_at).getTime()).sort((a, b) => a - b);
        const completed = new Set(done.map(v => v.i.id)).size;
        return {
            stage_id: stage.id, stage_name: stage.name,
            entered: journeys.size, completed,
            active: here.filter(i => i.status === 'active').length,
            stalled: here.filter(i => i.status === 'active' && i.stalled).length,
            abandoned: here.filter(i => i.status === 'abandoned').length,
            ...(durations.length ? { median_duration_ms: durations[Math.floor((durations.length - 1) / 2)] } : {}),
            ...(journeys.size ? { conversion: completed / journeys.size } : {}),
        };
    });
    return {
        total: mine.length,
        completed: mine.filter(i => i.status === 'completed').length,
        abandoned: mine.filter(i => i.status === 'abandoned').length,
        active: mine.filter(i => i.status === 'active').length,
        goals: Object.fromEntries(definition.goals.map(g => [g.id, mine.filter(i => i.goals_reached.includes(g.id)).length])),
        stages,
    };
}

/** Check a journey document beyond its schema: stages, expressions and references */
export function validate_journey(definition: JourneyDefinition, workflow_ids: Set<string> = new Set(), strict = false): { path: string; message: string; code: string }[] {
    const errors: { path: string; message: string; code: string }[] = [];
    const ids = definition.stages.map(s => s.id);
    for (const id of new Set(ids.filter((s, i) => ids.indexOf(s) !== i))) errors.push({ path: 'stages', message: `Duplicate stage '${id}'`, code: 'duplicate_id' });
    const expression = (text: string | undefined, path: string) => {
        if (!text) return;
        try { evaluate_expression(text, {}); } catch (error) { errors.push({ path, message: error instanceof Error ? error.message : String(error), code: 'invalid_expression' }); }
    };
    const workflow = (id: string | undefined, path: string) => {
        if (id && (strict || workflow_ids.size) && !workflow_ids.has(id)) errors.push({ path, message: `Workflow '${id}' is not registered`, code: 'invalid_reference' });
    };
    for (const stage of definition.stages) {
        expression(stage.complete_when, `stages[${stage.id}].complete_when`);
        workflow(stage.on_enter?.start_workflow, `stages[${stage.id}].on_enter`);
        stage.workflows.forEach(w => workflow(w, `stages[${stage.id}].workflows`));
        for (const t of stage.transitions || []) {
            if (!ids.includes(t.to)) errors.push({ path: `stages[${stage.id}].transitions`, message: `Stage '${t.to}' not found`, code: 'invalid_reference' });
            expression(t.condition, `stages[${stage.id}].transitions`);
        }
    }
    for (const trigger of definition.triggers) {
        if (trigger.enter_stage && !ids.includes(trigger.enter_stage)) errors.push({ path: `triggers[${trigger.event}]`, message: `Stage '${trigger.enter_stage}' not found`, code: 'invalid_reference' });
        workflow(trigger.start_workflow, `triggers[${trigger.event}]`);
    }
    for (const goal of definition.goals) expression(goal.expression, `goals[${goal.id}]`);
    const artefact_ids = new Set(definition.artefacts.map(a => a.id));
    const touchpoint_ids = definition.touchpoints.map(t => t.id);
    for (const id of new Set(touchpoint_ids.filter((t, i) => touchpoint_ids.indexOf(t) !== i))) errors.push({ path: 'touchpoints', message: `Duplicate touchpoint '${id}'`, code: 'duplicate_id' });
    for (const touchpoint of definition.touchpoints) {
        for (const exchange of touchpoint.exchanges) {
            if (!artefact_ids.has(exchange.artefact)) errors.push({ path: `touchpoints[${touchpoint.id}].exchanges`, message: `Artefact '${exchange.artefact}' not found`, code: 'invalid_reference' });
        }
    }
    for (const [i, rule] of (definition.sentiment?.rules || []).entries()) {
        const path = `sentiment.rules[${i}]`;
        if (rule.touchpoint && !touchpoint_ids.includes(rule.touchpoint)) errors.push({ path, message: `Touchpoint '${rule.touchpoint}' not found`, code: 'invalid_reference' });
        if (rule.goal && !definition.goals.some(g => g.id === rule.goal)) errors.push({ path, message: `Goal '${rule.goal}' not found`, code: 'invalid_reference' });
        if (rule.stage && !ids.includes(rule.stage)) errors.push({ path, message: `Stage '${rule.stage}' not found`, code: 'invalid_reference' });
        if (rule.on === 'waited' && !rule.longer_than) errors.push({ path, message: 'A "waited" rule needs longer_than', code: 'invalid_journey' });
    }
    if (!definition.triggers.some(t => t.starts_journey)) errors.push({ path: 'triggers', message: 'No trigger can start the journey: set starts_journey on at least one', code: 'invalid_journey' });
    return errors;
}
