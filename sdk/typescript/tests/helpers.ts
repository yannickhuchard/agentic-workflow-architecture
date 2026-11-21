import { v4 as uuidv4 } from 'uuid';
import { Activity, Edge, Workflow } from '../src/types';
import { Actor } from '../src/runtime/actors/actor';

export function activity(name: string, overrides: Partial<Activity> = {}): Activity {
    return {
        id: uuidv4(),
        name,
        role_id: uuidv4(),
        actor_type: 'application',
        is_expandable: false,
        inputs: [],
        outputs: [],
        context_bindings: [],
        access_rights: [],
        programs: [],
        controls: [],
        skills: [],
        tool_requirements: [],
        ...overrides,
    } as Activity;
}

export function edge(source: { id: string }, target: { id: string }, overrides: Partial<Edge> = {}): Edge {
    return {
        id: uuidv4(),
        source_id: source.id,
        target_id: target.id,
        is_default: false,
        skills: [],
        tool_requirements: [],
        ...overrides,
    } as Edge;
}

export function workflow(activities: Activity[], edges: Edge[], overrides: Partial<Workflow> = {}): Workflow {
    return {
        id: uuidv4(),
        name: 'Test Workflow',
        version: '1.0.0',
        activities,
        edges,
        roles: [],
        events: [],
        decision_nodes: [],
        contexts: [],
        ...overrides,
    } as Workflow;
}

type Script = Record<string, unknown> | Error | ((inputs: Record<string, unknown>, attempt: number) => Record<string, unknown> | Promise<Record<string, unknown>>);

/**
 * Deterministic actor for tests. Outputs are scripted per activity name;
 * an array scripts successive attempts (the last entry repeats).
 */
export class ScriptedActor implements Actor {
    public calls: { activity: string; inputs: Record<string, unknown> }[] = [];
    private attempts = new Map<string, number>();

    constructor(private script: Record<string, Script | Script[]> = {}) { }

    async execute(act: Activity, inputs: Record<string, unknown>): Promise<Record<string, unknown>> {
        this.calls.push({ activity: act.name, inputs });
        const attempt = (this.attempts.get(act.name) || 0) + 1;
        this.attempts.set(act.name, attempt);

        const entry = this.script[act.name];
        if (entry === undefined) return { ok: true };
        const step = Array.isArray(entry) ? entry[Math.min(attempt, entry.length) - 1] : entry;
        if (step instanceof Error) throw step;
        if (typeof step === 'function') return step(inputs, attempt);
        return step;
    }

    count(name: string): number {
        return this.attempts.get(name) || 0;
    }
}

export function scripted(script: Record<string, Script | Script[]> = {}) {
    const actor = new ScriptedActor(script);
    return { actor, actors: { application: actor, ai_agent: actor, human: actor, robot: actor } };
}

export const silent_logger = { log_execution: async () => { } };
