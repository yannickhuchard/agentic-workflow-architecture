import { Activity } from '../../types';

export interface Actor {
    execute(activity: Activity, inputs: Record<string, unknown>): Promise<Record<string, unknown>>;
}
