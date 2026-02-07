import { v4 as uuidv4 } from 'uuid';
import { UUID } from '../types';

export type TokenStatus = 'active' | 'completed' | 'failed' | 'waiting' | 'cancelled';

export interface TokenHistoryEntry {
    nodeId: UUID;
    timestamp: Date;
    action: string;
    metrics?: Record<string, number>;
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

    public move(nextActivityId: UUID): void {
        this.addToHistory(this.activityId, 'exited');
        this.activityId = nextActivityId;
        this.status = 'active'; // Reset status to active when moving
        this.updatedAt = new Date();
        this.addToHistory(nextActivityId, 'entered');
    }

    public updateStatus(status: TokenStatus): void {
        this.status = status;
        this.updatedAt = new Date();
        this.addToHistory(this.activityId, `status_change:${status}`);
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

    private addToHistory(nodeId: UUID, action: string, metrics?: Record<string, number>): void {
        this.history.push({
            nodeId,
            timestamp: new Date(),
            action,
            metrics
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
