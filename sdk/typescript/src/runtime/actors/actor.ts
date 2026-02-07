import { Activity } from '../../types';

export interface Actor {
    execute(activity: Activity, inputs: Record<string, any>): Promise<Record<string, any>>;
}
