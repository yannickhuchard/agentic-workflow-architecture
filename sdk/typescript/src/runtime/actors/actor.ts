import { Activity } from '../../types';
import type { ToolRunner } from '../tools';

/** What the engine gives an actor besides the activity and its inputs */
export interface ActorContext {
    /** The tools declared on the activity. Every call through it is checked, executed and journalled. */
    tools?: ToolRunner;
}

export interface Actor {
    execute(activity: Activity, inputs: Record<string, unknown>, context?: ActorContext): Promise<Record<string, unknown>>;
}
