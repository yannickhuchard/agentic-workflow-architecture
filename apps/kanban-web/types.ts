export type HumanTaskStatus = 'pending' | 'assigned' | 'in_progress' | 'completed' | 'rejected' | 'expired';

export type HumanTaskPriority = 'low' | 'normal' | 'high' | 'critical';

export interface HumanTask {
    id: string;
    activity_id: string;
    activity_name: string;
    token_id: string;
    workflow_id: string;
    status: HumanTaskStatus;
    priority: HumanTaskPriority;
    assignee_id?: string;
    role_id: string;
    creator_id?: string;
    creator_type?: string;
    assigner_id?: string;
    assigner_type?: string;
    inputs: Record<string, any>;
    outputs?: Record<string, any>;
    created_at: string;
    updated_at: string;
    due_at?: string;
    completed_at?: string;
    description?: string;
    form_schema?: Record<string, any>;
    tags?: string[];
}
