
import { describe, it, expect, beforeEach } from 'vitest';
import { Token, ContextManager, WorkflowEngine } from '../src/runtime';
import { Workflow, Activity, Context } from '../src/types';
import { v4 as uuidv4 } from 'uuid';

// Mock Data
const mockActivity1: Activity = {
    id: uuidv4(),
    name: 'Start Activity',
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
};

const mockActivity2: Activity = {
    id: uuidv4(),
    name: 'End Activity',
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
};


const mockContext: Context = {
    id: uuidv4(),
    name: 'TestContext',
    type: 'data',
    sync_pattern: 'shared_state',
    visibility: 'workflow',
    lifecycle: 'persistent',
    initial_value: { count: 0 }
};

const mockWorkflow: Workflow = {
    id: uuidv4(),
    name: 'Test Workflow',
    version: '1.0.0',
    activities: [mockActivity1, mockActivity2],
    edges: [
        {
            id: uuidv4(),
            source_id: mockActivity1.id,
            target_id: mockActivity2.id,
            is_default: true,
            skills: [],
            tool_requirements: []
        }
    ],
    events: [],
    decision_nodes: [],
    contexts: [mockContext]
};

describe('Core Kernel Runtime', () => {

    describe('Token', () => {
        it('should initialize with correct state', () => {
            const token = new Token(mockActivity1.id, { foo: 'bar' });
            expect(token.id).toBeDefined();
            expect(token.activityId).toBe(mockActivity1.id);
            expect(token.status).toBe('active');
            expect(token.contextData).toEqual({ foo: 'bar' });
            expect(token.history).toHaveLength(1);
            expect(token.history[0].action).toBe('created');
        });

        it('should move to next activity and update history', () => {
            const token = new Token(mockActivity1.id);
            token.move(mockActivity2.id);
            expect(token.activityId).toBe(mockActivity2.id);
            expect(token.history).toHaveLength(3); // created, exited, entered
            expect(token.history[1].action).toBe('exited');
            expect(token.history[2].action).toBe('entered');
        });

        it('should update status and data', () => {
            const token = new Token(mockActivity1.id);
            token.updateStatus('completed');
            expect(token.status).toBe('completed');

            token.setData('key', 'value');
            expect(token.getData('key')).toBe('value');
        });
    });

    describe('ContextManager', () => {
        let manager: ContextManager;

        beforeEach(() => {
            manager = new ContextManager();
        });

        it('should register and retrieve context definition', () => {
            manager.register(mockContext);
            const def = manager.getContextDefinition(mockContext.id);
            expect(def).toBeDefined();
            expect(def?.name).toBe('TestContext');
        });

        it('should get and set values', () => {
            manager.register(mockContext);
            // Initial value check
            expect(manager.get(mockContext.id)).toEqual({ count: 0 });

            // Set new value
            manager.set(mockContext.id, { count: 1 });
            expect(manager.get(mockContext.id)).toEqual({ count: 1 });
        });

        it('should update partial values', () => {
            manager.register(mockContext);
            manager.update(mockContext.id, { newField: 'test' });
            expect(manager.get(mockContext.id)).toEqual({ count: 0, newField: 'test' });
        });

        it('should throw error for unknown context', () => {
            expect(() => manager.get(uuidv4())).toThrow();
        });
    });

    describe('WorkflowEngine', () => {
        it('should initialize successfully', () => {
            const engine = new WorkflowEngine(mockWorkflow);
            expect(engine.getStatus()).toBe('idle');
        });

        it('should start workflow at correct node', async () => {
            const engine = new WorkflowEngine(mockWorkflow);
            await engine.start();
            const tokens = engine.getTokens();
            expect(tokens).toHaveLength(1);
            expect(tokens[0].activityId).toBe(mockActivity1.id);
            expect(engine.getStatus()).toBe('running');
        });

        it('should execute step and move token', async () => {
            const engine = new WorkflowEngine(mockWorkflow);
            await engine.start();

            // Step 1: Move from Activity 1 to Activity 2
            await engine.runStep();
            let tokens = engine.getTokens();
            expect(tokens[0].activityId).toBe(mockActivity2.id);

            // Step 2: Activity 2 has no outgoing edges -> Complete
            await engine.runStep();
            tokens = engine.getTokens();
            expect(tokens[0].status).toBe('completed');
            expect(engine.getStatus()).toBe('completed');
        });

        it('should initialize contexts from workflow definition', () => {
            const engine = new WorkflowEngine(mockWorkflow);
            const ctxValue = engine.getContext(mockContext.id);
            expect(ctxValue).toEqual({ count: 0 });
        });
    });
});
