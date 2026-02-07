/**
 * AWA Retry and Persistence Tests
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
    calculate_retry_delay,
    is_retryable_error,
    with_retry,
    DeadLetterQueue,
    DEFAULT_RETRY_CONFIG,
    RetryConfig
} from '../src/runtime/retry';
import {
    InMemoryPersistenceAdapter,
    CheckpointManager,
    serialize_token,
    deserialize_token,
    WorkflowState
} from '../src/runtime/persistence';
import { Token } from '../src/runtime/token';

describe('Retry Logic', () => {
    describe('calculate_retry_delay', () => {
        const config: RetryConfig = {
            max_retries: 3,
            initial_delay_ms: 1000,
            max_delay_ms: 30000,
            backoff_multiplier: 2,
            jitter: false
        };

        it('should calculate exponential delay', () => {
            expect(calculate_retry_delay(config, 0)).toBe(1000);
            expect(calculate_retry_delay(config, 1)).toBe(2000);
            expect(calculate_retry_delay(config, 2)).toBe(4000);
            expect(calculate_retry_delay(config, 3)).toBe(8000);
        });

        it('should cap at max delay', () => {
            const delay = calculate_retry_delay(config, 10);
            expect(delay).toBe(30000);
        });

        it('should add jitter when enabled', () => {
            const jitterConfig = { ...config, jitter: true };
            const delays = Array.from({ length: 10 }, () =>
                calculate_retry_delay(jitterConfig, 1)
            );
            // With jitter, not all delays should be identical
            const uniqueDelays = new Set(delays);
            expect(uniqueDelays.size).toBeGreaterThan(1);
        });
    });

    describe('is_retryable_error', () => {
        it('should identify retryable errors', () => {
            const error = new Error('Connection timeout');
            expect(is_retryable_error(error, DEFAULT_RETRY_CONFIG)).toBe(true);
        });

        it('should identify non-retryable validation errors', () => {
            const error = new Error('Validation failed');
            expect(is_retryable_error(error, DEFAULT_RETRY_CONFIG)).toBe(false);
        });

        it('should identify non-retryable by error code', () => {
            const error: any = new Error('Some error');
            error.code = 'VALIDATION_ERROR';
            expect(is_retryable_error(error, DEFAULT_RETRY_CONFIG)).toBe(false);
        });
    });

    describe('with_retry', () => {
        it('should succeed on first attempt', async () => {
            const fn = vi.fn().mockResolvedValue('success');
            const result = await with_retry(fn, { max_retries: 3 });

            expect(result).toBe('success');
            expect(fn).toHaveBeenCalledTimes(1);
        });

        it('should retry on failure and eventually succeed', async () => {
            const fn = vi.fn()
                .mockRejectedValueOnce(new Error('fail 1'))
                .mockRejectedValueOnce(new Error('fail 2'))
                .mockResolvedValue('success');

            const result = await with_retry(fn, {
                max_retries: 3,
                initial_delay_ms: 10,
                backoff_multiplier: 1
            });

            expect(result).toBe('success');
            expect(fn).toHaveBeenCalledTimes(3);
        });

        it('should throw after max retries', async () => {
            const fn = vi.fn().mockRejectedValue(new Error('always fails'));

            await expect(with_retry(fn, {
                max_retries: 2,
                initial_delay_ms: 10
            })).rejects.toThrow('always fails');

            expect(fn).toHaveBeenCalledTimes(3); // initial + 2 retries
        });

        it('should not retry non-retryable errors', async () => {
            const fn = vi.fn().mockRejectedValue(new Error('Invalid input'));

            await expect(with_retry(fn, { max_retries: 3 })).rejects.toThrow('Invalid');
            expect(fn).toHaveBeenCalledTimes(1);
        });
    });
});

describe('Dead Letter Queue', () => {
    let dlq: DeadLetterQueue;

    beforeEach(() => {
        dlq = new DeadLetterQueue();
    });

    it('should add entries', () => {
        const token = new Token('activity-1', { data: 'test' });

        dlq.add(
            token,
            'workflow-1',
            'activity-1',
            new Error('Failed'),
            { attempt: 3, started_at: Date.now() }
        );

        const entry = dlq.get(token.id);
        expect(entry).toBeDefined();
        expect(entry?.workflow_id).toBe('workflow-1');
        expect(entry?.error.message).toBe('Failed');
    });

    it('should list entries by workflow', () => {
        dlq.add(new Token('a1', {}), 'wf-1', 'a1', new Error('e1'), { attempt: 1, started_at: Date.now() });
        dlq.add(new Token('a2', {}), 'wf-1', 'a2', new Error('e2'), { attempt: 1, started_at: Date.now() });
        dlq.add(new Token('a3', {}), 'wf-2', 'a3', new Error('e3'), { attempt: 1, started_at: Date.now() });

        const wf1Entries = dlq.list_by_workflow('wf-1');
        expect(wf1Entries).toHaveLength(2);
    });

    it('should provide stats', () => {
        dlq.add(new Token('a1', {}), 'wf-1', 'a1', new Error('e1'), { attempt: 1, started_at: Date.now() });
        dlq.add(new Token('a2', {}), 'wf-2', 'a2', new Error('e2'), { attempt: 1, started_at: Date.now() });

        const stats = dlq.stats();
        expect(stats.total).toBe(2);
        expect(stats.by_workflow['wf-1']).toBe(1);
        expect(stats.by_workflow['wf-2']).toBe(1);
    });
});

describe('Persistence', () => {
    describe('InMemoryPersistenceAdapter', () => {
        it('should save and load state', async () => {
            const adapter = new InMemoryPersistenceAdapter();
            const state: WorkflowState = {
                version: '1.0',
                workflow_id: 'wf-1',
                workflow_name: 'Test Workflow',
                workflow_version: '1.0.0',
                engine_status: 'running',
                tokens: [],
                contexts: {},
                checkpoint_at: new Date().toISOString()
            };

            await adapter.save('wf-1', state);
            const loaded = await adapter.load('wf-1');

            expect(loaded).toEqual(state);
        });

        it('should return null for non-existent state', async () => {
            const adapter = new InMemoryPersistenceAdapter();
            const loaded = await adapter.load('non-existent');
            expect(loaded).toBeNull();
        });

        it('should list all saved states', async () => {
            const adapter = new InMemoryPersistenceAdapter();
            const state: WorkflowState = {
                version: '1.0',
                workflow_id: 'wf-1',
                workflow_name: 'Test',
                workflow_version: '1.0.0',
                engine_status: 'running',
                tokens: [],
                contexts: {},
                checkpoint_at: new Date().toISOString()
            };

            await adapter.save('wf-1', state);
            await adapter.save('wf-2', { ...state, workflow_id: 'wf-2' });

            const list = await adapter.list();
            expect(list).toHaveLength(2);
            expect(list).toContain('wf-1');
            expect(list).toContain('wf-2');
        });
    });

    describe('Token Serialization', () => {
        it('should serialize and deserialize tokens', () => {
            const original = new Token('activity-1', { foo: 'bar', num: 42 });
            original.updateStatus('active');

            const serialized = serialize_token(original);
            expect(serialized.id).toBe(original.id);
            expect(serialized.activity_id).toBe('activity-1');
            expect(serialized.status).toBe('active');
            expect(serialized.context_data).toEqual({ foo: 'bar', num: 42 });

            const deserialized = deserialize_token(serialized, 'wf-1');
            expect(deserialized.id).toBe(original.id);
            expect(deserialized.activityId).toBe('activity-1');
            expect(deserialized.contextData).toEqual({ foo: 'bar', num: 42 });
        });
    });

    describe('CheckpointManager', () => {
        it('should create and load checkpoints', async () => {
            const adapter = new InMemoryPersistenceAdapter();
            const manager = new CheckpointManager(adapter);

            const workflow = {
                id: 'wf-123',
                name: 'Test Workflow',
                version: '1.0.0',
                activities: [],
                edges: [],
                roles: [],
                contexts: [],
                events: [],
                decision_nodes: []
            };

            const tokens = [
                new Token('a1', { step: 1 }),
                new Token('a2', { step: 2 })
            ];

            await manager.checkpoint(workflow as any, 'running', tokens, { ctx1: 'value' });

            const loaded = await manager.load('wf-123');
            expect(loaded).not.toBeNull();
            expect(loaded?.workflow_name).toBe('Test Workflow');
            expect(loaded?.tokens).toHaveLength(2);
        });

        it('should restore tokens from checkpoint', async () => {
            const adapter = new InMemoryPersistenceAdapter();
            const manager = new CheckpointManager(adapter);

            const workflow = {
                id: 'wf-456',
                name: 'Test',
                version: '1.0.0',
                activities: [],
                edges: [],
                roles: [],
                contexts: [],
                events: [],
                decision_nodes: []
            };

            const tokens = [new Token('a1', { data: 'test' })];
            await manager.checkpoint(workflow as any, 'running', tokens, {});

            const state = await manager.load('wf-456');
            const restored = manager.restore_tokens(state!);

            expect(restored).toHaveLength(1);
            expect(restored[0].contextData).toEqual({ data: 'test' });
        });
    });
});
