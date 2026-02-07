import { v4 as uuidv4 } from 'uuid';
import { UUID, Analytics } from '../types';
import { calculate_duration } from './duration_utils';

export type TokenStatus = 'active' | 'completed' | 'failed' | 'waiting' | 'cancelled';

export interface TokenHistoryEntry {
    nodeId: UUID;
    timestamp: Date;
    action: string;
    metrics?: Record<string, number>;
    analytics?: Analytics;
}

export class Token {
    public id: UUID;
    public activityId: UUID;
    public status: TokenStatus;
    public contextData: Record<string, any>;
    public history: TokenHistoryEntry[];
    public parentTokenId?: UUID;
    public workflowId?: UUID;
    public createdAt: Date;
    public updatedAt: Date;

    constructor(
        activityId: UUID,
        initialData: Record<string, any> = {},
        parentTokenId?: UUID,
        workflowId?: UUID
    ) {
        this.id = uuidv4();
        this.activityId = activityId;
        this.status = 'active';
        this.contextData = { ...initialData };
        this.history = [];
        this.parentTokenId = parentTokenId;
        this.workflowId = workflowId;
        this.createdAt = new Date();
        this.updatedAt = new Date();

        this.addToHistory(activityId, 'created');
    }

    public move(nextActivityId: UUID, analytics?: Analytics): void {
        this.addToHistory(this.activityId, 'exited', undefined, analytics);
        this.activityId = nextActivityId;
        this.status = 'active'; // Reset status to active when moving
        this.updatedAt = new Date();
        this.addToHistory(nextActivityId, 'entered');
    }

    public updateStatus(status: TokenStatus, analytics?: Analytics): void {
        this.status = status;
        this.updatedAt = new Date();
        this.addToHistory(this.activityId, `status_change:${status}`, undefined, analytics);
    }

    public setData(key: string, value: any): void {
        this.contextData[key] = value;
        this.updatedAt = new Date();
    }

    public getData(key: string): any {
        return this.contextData[key];
    }

    public mergeData(data: Record<string, any>): void {
        this.contextData = { ...this.contextData, ...data };
        this.updatedAt = new Date();
    }

    private addToHistory(nodeId: UUID, action: string, metrics?: Record<string, number>, analytics?: Analytics): void {
        this.history.push({
            nodeId,
            timestamp: new Date(),
            action,
            metrics,
            analytics
        });
    }

    public toJSON(): Record<string, any> {
        return {
            id: this.id,
            activityId: this.activityId,
            status: this.status,
            contextData: this.contextData,
            history: this.history,
            parentTokenId: this.parentTokenId,
            workflowId: this.workflowId,
            createdAt: this.createdAt.toISOString(),
            updatedAt: this.updatedAt.toISOString()
        };
    }
}
