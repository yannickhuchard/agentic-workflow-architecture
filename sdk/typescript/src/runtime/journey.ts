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
import { evaluate_expression } from './expression';
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
    /** Where the journey goes when the stage completes. Absent: the next stage in the list. Empty: the journey completes here. */
    transitions: z.array(z.object({ to: z.string(), condition: z.string().optional(), is_default: z.boolean().default(false) })).optional(),
});
export type JourneyStage = z.infer<typeof JourneyStageSchema>;

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
});
export type JourneyDefinition = z.infer<typeof JourneyDefinitionSchema>;

export type JourneyEventType =
    | 'journey.started' | 'journey.event_received'
    | 'journey.stage_entered' | 'journey.stage_completed' | 'journey.stalled'
    | 'journey.run_started' | 'journey.run_ended'
    | 'journey.goal_reached'
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
        }
    }

    // A stage may complete at once on entry, so this repeats; the bound stops a cycle of always-true stages
    for (let guard = 0; guard < definition.stages.length + 1; guard++) {
        const stage = definition.stages.find(s => s.id === instance.stage_id)!;
        if (!stage.complete_when || !safe(stage.complete_when, instance.data)) break;

        record_journey_event(instance, 'journey.stage_completed', time, { stage_name: stage.name, duration_ms: new Date(time).getTime() - new Date(instance.stage_entered_at).getTime() });

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
    record_journey_event(instance, 'journey.stalled', new Date(now).toISOString(), { stage_name: stage.name, max_duration: stage.max_duration, in_stage_ms: spent });
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
export function validate_journey(definition: JourneyDefinition, workflow_ids: Set<string> = new Set()): { path: string; message: string; code: string }[] {
    const errors: { path: string; message: string; code: string }[] = [];
    const ids = definition.stages.map(s => s.id);
    for (const id of new Set(ids.filter((s, i) => ids.indexOf(s) !== i))) errors.push({ path: 'stages', message: `Duplicate stage '${id}'`, code: 'duplicate_id' });
    const expression = (text: string | undefined, path: string) => {
        if (!text) return;
        try { evaluate_expression(text, {}); } catch (error) { errors.push({ path, message: error instanceof Error ? error.message : String(error), code: 'invalid_expression' }); }
    };
    const workflow = (id: string | undefined, path: string) => {
        if (id && workflow_ids.size && !workflow_ids.has(id)) errors.push({ path, message: `Workflow '${id}' is not registered`, code: 'invalid_reference' });
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
    if (!definition.triggers.some(t => t.starts_journey)) errors.push({ path: 'triggers', message: 'No trigger can start the journey: set starts_journey on at least one', code: 'invalid_journey' });
    return errors;
}
