import { Activity } from '../../types';
import type { ToolRunner } from '../tools';
import type { JournalEventInput } from '../journal';

/** What the engine gives an actor besides the activity and its inputs */
export interface ActorContext {
    /** The tools declared on the activity. Every call through it is checked, executed and journalled. */
    tools?: ToolRunner;
    /** Journals an event of this attempt; the engine adds the token, the node and the attempt */
    record?: (event: Pick<JournalEventInput, 'type' | 'data' | 'level'>) => void;
    /** Applies the journal's payload mode (9.4) to a value before it is journalled */
    payload?: (value: unknown) => unknown;
    /** The `seq` of the attempt's `activity.started` in the run's journal */
    attempt_seq?: number;
}

export interface Actor {
    execute(activity: Activity, inputs: Record<string, unknown>, context?: ActorContext): Promise<Record<string, unknown>>;
}
