/**
 * AWA State Persistence
 * Workflow state serialization, checkpointing, and resume functionality
 */

import { UUID, Workflow } from '../types';
import { Token, TokenStatus } from './token';
import { get_logger, Logger } from '../server/logger';

/**
 * Serialized workflow state
 */
export interface WorkflowState {
    /** State format version */
    version: '1.0';
    /** Workflow definition ID */
    workflow_id: UUID;
    /** Workflow name */
    workflow_name: string;
    /** Workflow version */
    workflow_version: string;
    /** Current engine status */
    engine_status: string;
    /** Serialized tokens */
    tokens: SerializedToken[];
    /** Context data snapshot */
    contexts: Record<UUID, unknown>;
    /** Checkpoint timestamp */
    checkpoint_at: string;
    /** Metadata */
    metadata?: Record<string, unknown>;
}

/**
 * Serialized token state
 */
export interface SerializedToken {
    id: UUID;
    activity_id: UUID;
    status: TokenStatus;
    context_data: Record<string, unknown>;
    created_at: string;
    updated_at: string;
}

/**
 * Persistence adapter interface
 * Implement this to use different storage backends
 */
export interface PersistenceAdapter {
    /** Save workflow state */
    save(workflow_id: UUID, state: WorkflowState): Promise<void>;
    /** Load workflow state */
    load(workflow_id: UUID): Promise<WorkflowState | null>;
    /** Delete workflow state */
    delete(workflow_id: UUID): Promise<void>;
    /** List all saved workflow states */
    list(): Promise<UUID[]>;
}

/**
 * In-memory persistence adapter (for development/testing)
 */
export class InMemoryPersistenceAdapter implements PersistenceAdapter {
    private storage: Map<UUID, WorkflowState> = new Map();

    async save(workflow_id: UUID, state: WorkflowState): Promise<void> {
        this.storage.set(workflow_id, state);
    }

    async load(workflow_id: UUID): Promise<WorkflowState | null> {
        return this.storage.get(workflow_id) || null;
    }

    async delete(workflow_id: UUID): Promise<void> {
        this.storage.delete(workflow_id);
    }

    async list(): Promise<UUID[]> {
        return Array.from(this.storage.keys());
    }
}

/**
 * File-based persistence adapter
 */
export class FilePersistenceAdapter implements PersistenceAdapter {
    private directory: string;
    private fs: typeof import('fs/promises') | null = null;
    private path: typeof import('path') | null = null;

    constructor(directory: string) {
        this.directory = directory;
    }

    private async ensure_deps(): Promise<void> {
        if (!this.fs) {
            this.fs = await import('fs/promises');
            this.path = await import('path');
        }
    }

    private state_path(workflow_id: UUID): string {
        return this.path!.join(this.directory, `${workflow_id}.state.json`);
    }

    async save(workflow_id: UUID, state: WorkflowState): Promise<void> {
        await this.ensure_deps();
        await this.fs!.mkdir(this.directory, { recursive: true });
        await this.fs!.writeFile(
            this.state_path(workflow_id),
            JSON.stringify(state, null, 2),
            'utf-8'
        );
    }

    async load(workflow_id: UUID): Promise<WorkflowState | null> {
        await this.ensure_deps();
        try {
            const content = await this.fs!.readFile(this.state_path(workflow_id), 'utf-8');
            return JSON.parse(content) as WorkflowState;
        } catch (error) {
            if ((error as any).code === 'ENOENT') {
                return null;
            }
            throw error;
        }
    }

    async delete(workflow_id: UUID): Promise<void> {
        await this.ensure_deps();
        try {
            await this.fs!.unlink(this.state_path(workflow_id));
        } catch (error) {
            if ((error as any).code !== 'ENOENT') {
                throw error;
            }
        }
    }

    async list(): Promise<UUID[]> {
        await this.ensure_deps();
        try {
            const files = await this.fs!.readdir(this.directory);
            return files
                .filter(f => f.endsWith('.state.json'))
                .map(f => f.replace('.state.json', ''));
        } catch (error) {
            if ((error as any).code === 'ENOENT') {
                return [];
            }
            throw error;
        }
    }
}

/**
 * Serialize a token for persistence
 */
export function serialize_token(token: Token): SerializedToken {
    return {
        id: token.id,
        activity_id: token.activityId,
        status: token.status,
        context_data: token.contextData,
        created_at: token.createdAt.toISOString(),
        updated_at: token.updatedAt.toISOString()
    };
}

/**
 * Deserialize a token from persistence
 */
export function deserialize_token(data: SerializedToken, workflow_id: UUID): Token {
    const token = new Token(
        data.activity_id,
        data.context_data,
        undefined,  // parentTokenId
        workflow_id
    );
    // Manually restore the original ID since Token constructor generates a new one
    (token as any).id = data.id;
    token.updateStatus(data.status);
    return token;
}

/**
 * Workflow checkpoint manager
 */
export class CheckpointManager {
    private adapter: PersistenceAdapter;
    private logger: Logger;
    private auto_checkpoint_interval?: number;

    constructor(adapter: PersistenceAdapter, logger?: Logger) {
        this.adapter = adapter;
        this.logger = logger || get_logger();
    }

    /**
     * Create a checkpoint of the current workflow state
     */
    async checkpoint(
        workflow: Workflow,
        engine_status: string,
        tokens: Token[],
        contexts: Record<UUID, unknown>,
        metadata?: Record<string, unknown>
    ): Promise<WorkflowState> {
        const state: WorkflowState = {
            version: '1.0',
            workflow_id: workflow.id,
            workflow_name: workflow.name,
            workflow_version: workflow.version,
            engine_status,
            tokens: tokens.map(serialize_token),
            contexts,
            checkpoint_at: new Date().toISOString(),
            metadata
        };

        await this.adapter.save(workflow.id, state);

        this.logger.info('Workflow checkpoint created', {
            workflow_id: workflow.id,
            token_count: tokens.length,
            engine_status
        });

        return state;
    }

    /**
     * Load a workflow checkpoint
     */
    async load(workflow_id: UUID): Promise<WorkflowState | null> {
        const state = await this.adapter.load(workflow_id);

        if (state) {
            this.logger.info('Workflow checkpoint loaded', {
                workflow_id,
                checkpoint_at: state.checkpoint_at,
                token_count: state.tokens.length
            });
        }

        return state;
    }

    /**
     * Delete a workflow checkpoint
     */
    async delete(workflow_id: UUID): Promise<void> {
        await this.adapter.delete(workflow_id);
        this.logger.info('Workflow checkpoint deleted', { workflow_id });
    }

    /**
     * List all checkpointed workflows
     */
    async list(): Promise<UUID[]> {
        return this.adapter.list();
    }

    /**
     * Restore tokens from a checkpoint
     */
    restore_tokens(state: WorkflowState): Token[] {
        return state.tokens.map(t => deserialize_token(t, state.workflow_id));
    }

    /**
     * Enable auto-checkpointing at intervals
     */
    enable_auto_checkpoint(
        interval_ms: number,
        get_state: () => Promise<{ workflow: Workflow; engine_status: string; tokens: Token[]; contexts: Record<UUID, unknown> }>
    ): void {
        this.disable_auto_checkpoint();

        this.auto_checkpoint_interval = setInterval(async () => {
            try {
                const { workflow, engine_status, tokens, contexts } = await get_state();
                if (engine_status === 'running' || engine_status === 'waiting_human') {
                    await this.checkpoint(workflow, engine_status, tokens, contexts);
                }
            } catch (error) {
                this.logger.error('Auto-checkpoint failed', error);
            }
        }, interval_ms) as unknown as number;

        this.logger.info('Auto-checkpoint enabled', { interval_ms });
    }

    /**
     * Disable auto-checkpointing
     */
    disable_auto_checkpoint(): void {
        if (this.auto_checkpoint_interval) {
            clearInterval(this.auto_checkpoint_interval);
            this.auto_checkpoint_interval = undefined;
            this.logger.info('Auto-checkpoint disabled');
        }
    }
}

// Global checkpoint manager
let global_checkpoint_manager: CheckpointManager | undefined;

/**
 * Get the global checkpoint manager
 */
export function get_checkpoint_manager(): CheckpointManager {
    if (!global_checkpoint_manager) {
        global_checkpoint_manager = new CheckpointManager(new InMemoryPersistenceAdapter());
    }
    return global_checkpoint_manager;
}

/**
 * Set a custom checkpoint manager
 */
export function set_checkpoint_manager(manager: CheckpointManager): void {
    global_checkpoint_manager = manager;
}

/**
 * Create a file-based checkpoint manager
 */
export function create_file_checkpoint_manager(directory: string, logger?: Logger): CheckpointManager {
    return new CheckpointManager(new FilePersistenceAdapter(directory), logger);
}
