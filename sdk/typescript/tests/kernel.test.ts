import { describe, it, expect, beforeEach } from 'vitest';
import { Token, ContextManager, WorkflowEngine } from '../src/runtime';
import { Workflow, Activity, Context, Edge } from '../src/types';
import { v4 as uuidv4 } from 'uuid';
import { vi } from 'vitest';

// Mock HumanAgent to avoid DB calls
vi.mock('../src/runtime/actors/human_agent', () => {
    return {
        HumanAgent: vi.fn().mockImplementation((options) => ({
            execute: vi.fn().mockResolvedValue({
                output: 'Human Output',
                status: 'completed',
                _human_task_id: 'mock-task-id',
                _human_task_status: 'pending',
                _requires_human_action: false
            })
        }))
    };
});

// ============================================================================
// HELPER FUNCTIONS & MOCKS
// ============================================================================

const createMockActivity = (name: string): Activity => ({
    id: uuidv4(),
    name,
    role_id: uuidv4(),
    actor_type: 'human',
    is_expandable: false,
    inputs: [],
    outputs: [],
    context_bindings: [],
    access_rights: [],
    programs: [],
    controls: [],
    skills: [],
    tool_requirements: []
});

const createMockContext = (name: string, initialValue?: any): Context => ({
    id: uuidv4(),
    name,
    type: 'data',
    sync_pattern: 'shared_state',
    visibility: 'workflow',
    lifecycle: 'persistent',
    initial_value: initialValue
});

// ============================================================================
// TEST SUITE
// ============================================================================

describe('AWA Core Kernel Suite', () => {

    // ------------------------------------------------------------------------
    // TOKEN TESTS
    // ------------------------------------------------------------------------
    describe('Token Logic', () => {
        const activityId = uuidv4();

        it('should correctly initialize a new token', () => {
            const initialData = { user: 'alice', role: 'admin' };
            const token = new Token(activityId, initialData);

            expect(token.id).toBeDefined();
            expect(token.activityId).toBe(activityId);
            expect(token.status).toBe('active');
            expect(token.getData('user')).toBe('alice');
            expect(token.history).toHaveLength(1);
            expect(token.history[0]).toMatchObject({
                nodeId: activityId,
                action: 'created'
            });
        });

        it('should track movement history accurately', () => {
            const token = new Token(activityId);
            const nextActivityId = uuidv4();

            token.move(nextActivityId);

            expect(token.activityId).toBe(nextActivityId);
            expect(token.history).toHaveLength(3);

            expect(token.history[0].action).toBe('created');
            expect(token.history[1].nodeId).toBe(activityId);
            expect(token.history[1].action).toBe('exited');
            expect(token.history[2].nodeId).toBe(nextActivityId);
            expect(token.history[2].action).toBe('entered');
        });

        it('should handle data merging', () => {
            const token = new Token(activityId, { a: 1 });
            token.mergeData({ b: 2 });
            expect(token.contextData).toEqual({ a: 1, b: 2 });

            token.mergeData({ a: 3 });
            expect(token.contextData).toEqual({ a: 3, b: 2 });
        });

        it('should manage status transitions', () => {
            const token = new Token(activityId);
            token.updateStatus('waiting');
            expect(token.status).toBe('waiting');
            expect(token.history.at(-1)?.action).toBe('status_change:waiting');

            token.updateStatus('completed');
            expect(token.status).toBe('completed');
            expect(token.history.at(-1)?.action).toBe('status_change:completed');
        });
    });

    // ------------------------------------------------------------------------
    // CONTEXT MANAGER TESTS
    // ------------------------------------------------------------------------
    describe('Context Manager Persistence', () => {
        let manager: ContextManager;
        const ctxDef = createMockContext('UserProfile', { name: 'Unknown', age: 0 });

        beforeEach(() => {
            manager = new ContextManager();
            manager.register(ctxDef);
        });

        it('should initialize context with deep copy of initial value', () => {
            const val = manager.get(ctxDef.id);
            expect(val).toEqual({ name: 'Unknown', age: 0 });
        });

        it('should not allow access to non-existent context', () => {
            const randomId = uuidv4();
            expect(() => manager.get(randomId)).toThrow(/not found/);
        });

        it('should update context partially', () => {
            manager.update(ctxDef.id, { name: 'Alice' });
            expect(manager.get(ctxDef.id)).toEqual({ name: 'Alice', age: 0 });
        });

        it('should replace context value entirely', () => {
            manager.set(ctxDef.id, { foo: 'bar' });
            expect(manager.get(ctxDef.id)).toEqual({ foo: 'bar' });
        });

        it('should delete context', () => {
            manager.delete(ctxDef.id);
            expect(() => manager.get(ctxDef.id)).toThrow(/not found/);
        });
    });

    // ------------------------------------------------------------------------
    // WORKFLOW ENGINE TESTS
    // ------------------------------------------------------------------------
    describe('Workflow Engine Orchestration', () => {

        const startAct = createMockActivity('Start');
        const processAct = createMockActivity('Process');
        const endAct = createMockActivity('End');

        const edges: Edge[] = [
            { id: uuidv4(), source_id: startAct.id, target_id: processAct.id, is_default: true, skills: [], tool_requirements: [] },
            { id: uuidv4(), source_id: processAct.id, target_id: endAct.id, is_default: true, skills: [], tool_requirements: [] }
        ];

        const workflow: Workflow = {
            id: uuidv4(),
            name: 'Linear Process',
            version: '1.0.0',
            activities: [startAct, processAct, endAct],
            edges: edges,
            events: [],
            decision_nodes: [],
            contexts: []
        };

        it('should validate workflow on initialization', () => {
            const invalidWorkflow = { ...workflow, edges: [...edges, { id: uuidv4(), source_id: startAct.id, target_id: uuidv4(), is_default: true, skills: [], tool_requirements: [] }] };
            expect(() => new WorkflowEngine(invalidWorkflow)).toThrow(/Invalid workflow definition/);
        });

        it('should identify the correct start node (no incoming edges)', async () => {
            const engine = new WorkflowEngine(workflow);
            await engine.start();

            const tokens = engine.getTokens();
            expect(tokens).toHaveLength(1);
            expect(tokens[0].activityId).toBe(startAct.id);
        });

        it('should execute a full lifecycle correctly', async () => {
            const engine = new WorkflowEngine(workflow);
            await engine.start();

            // Expected Path: Start -> Process -> End -> Complete

            // Step 1: Start -> Process
            await engine.runStep();
            expect(engine.getTokens()[0].activityId).toBe(processAct.id);
            expect(engine.getStatus()).toBe('running');

            // Step 2: Process -> End
            await engine.runStep();
            expect(engine.getTokens()[0].activityId).toBe(endAct.id);

            // Step 3: End -> (No outgoing) -> Completed
            await engine.runStep();
            expect(engine.getTokens()[0].status).toBe('completed');
            expect(engine.getStatus()).toBe('completed');
        });

        it('should prevent starting an already running engine', async () => {
            const engine = new WorkflowEngine(workflow);
            await engine.start();
            await expect(engine.start()).rejects.toThrow('Workflow is already running');
        });

        it('should handle workflows with disconnected components gracefully', async () => {
            const lonelyNode = createMockActivity('Lonely');
            const mixedWorkflow = {
                ...workflow,
                activities: [...workflow.activities, lonelyNode]
            };

            const engine = new WorkflowEngine(mixedWorkflow);
            await engine.start();

            const tokens = engine.getTokens();
            expect(tokens[0].activityId).toBe(startAct.id);

            await engine.runStep();
            await engine.runStep();
            await engine.runStep();

            expect(engine.getStatus()).toBe('completed');
            expect(tokens[0].history.find(h => h.nodeId === lonelyNode.id)).toBeUndefined();
        });

        it('should initialize engine with global context data', async () => {
            const ctx = createMockContext('GlobalConfig', { theme: 'dark' });
            const wfWithCtx = { ...workflow, contexts: [ctx] };

            const engine = new WorkflowEngine(wfWithCtx);
            const val = engine.getContext(ctx.id);
            expect(val).toEqual({ theme: 'dark' });
        });
    });
});
