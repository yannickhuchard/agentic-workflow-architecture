import { describe, it, expect, beforeEach } from 'vitest';
import { WorkflowEngine } from '../src/runtime/workflow_engine';
import { Token } from '../src/runtime/token';
import { Workflow, Activity } from '../src/types';
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
                _requires_human_action: true // Always return this for non-blocking simulation
            })
        }))
    };
});

describe('VSM & Analytics Tracking', () => {
    let workflow: Workflow;
    let activity1Id: string;
    let activity2Id: string;

    beforeEach(() => {
        activity1Id = uuidv4();
        activity2Id = uuidv4();

        workflow = {
            id: uuidv4(),
            name: 'VSM Test Workflow',
            version: '1.0.0',
            activities: [
                {
                    id: activity1Id,
                    name: 'Activity 1',
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
                },
                {
                    id: activity2Id,
                    name: 'Activity 2',
                    role_id: uuidv4(),
                    actor_type: 'application',
                    is_expandable: false,
                    inputs: [],
                    outputs: [],
                    context_bindings: [],
                    access_rights: [],
                    programs: [],
                    controls: [],
                    skills: [],
                    tool_requirements: []
                }
            ],
            edges: [
                {
                    id: uuidv4(),
                    source_id: activity1Id,
                    target_id: activity2Id,
                    is_default: true,
                    skills: [],
                    tool_requirements: []
                }
            ],
            events: [],
            decision_nodes: [],
            contexts: []
        } as Workflow;
    });

    it('should track process_time and lead_time for activities', async () => {
        const engine = new WorkflowEngine(workflow, { wait_for_human_tasks: false });
        await engine.start();

        // Execute Activity 1 (Human, non-blocking)
        await engine.runStep();

        const token = engine.getTokens()[0];
        const lastHistory = token.history.find(h => h.action === 'exited' && h.nodeId === activity1Id);

        expect(lastHistory?.analytics).toBeDefined();
        expect(lastHistory?.analytics?.process_time).toMatch(/^PT/);
        expect(lastHistory?.analytics?.lead_time).toBe(lastHistory?.analytics?.process_time);
    });

    it('should track waiting waste for human tasks when wait_for_human_tasks is true', async () => {
        const engine = new WorkflowEngine(workflow, { wait_for_human_tasks: true });
        await engine.start();

        // Activity 1 is human. Execution will pause.
        // We use a promise to run runStep so it doesn't block the test
        const stepPromise = engine.runStep();

        // Wait a bit to ensure it entered the waiting state
        await new Promise(r => setTimeout(r, 100));

        let token = engine.getTokens()[0];
        expect(token.status).toBe('waiting');

        const waitingEntry = token.history.find(h => h.action === 'status_change:waiting');
        expect(waitingEntry?.analytics?.waste_categories).toContain('waiting');

        // Now resume the token
        engine.resumeToken(token.id, { approved: true });

        // Now runStep should finish
        await stepPromise;

        token = engine.getTokens()[0];
        expect(token.status).toBe('active');

        const resumedEntry = token.history.find(h => h.action === 'status_change:active');
        expect(resumedEntry?.analytics?.wait_time).toMatch(/^PT/);
        expect(resumedEntry?.analytics?.waste_categories).toContain('waiting');
    });

    it('should track defects waste when activity fails', async () => {
        // Force a failure by disabling simulation mode for robot config
        workflow.activities[1].actor_type = 'robot';

        const engine = new WorkflowEngine(workflow, {
            wait_for_human_tasks: false,
            robot_config: { simulation_mode: false }
        });
        await engine.start();

        // Step 1: Activity 1 (Human, moves to Activity 2)
        await engine.runStep();

        // Step 2: Activity 2 (Robot, will fail because no connection info and simulation is off)
        await engine.runStep();

        const token = engine.getTokens()[0];
        expect(token.status).toBe('failed');

        const failedEntry = token.history.find(h => h.action === 'status_change:failed');
        expect(failedEntry?.analytics?.waste_categories).toContain('defects');
        expect(failedEntry?.analytics?.error_rate).toBe(1);
    });

    it('should respect value_added flag from activity definition', async () => {
        // Set Activity 2 to non-value-added
        workflow.activities[1].analytics = { value_added: false };

        const engine = new WorkflowEngine(workflow, { wait_for_human_tasks: false });
        await engine.start();

        // Execute Activity 1
        await engine.runStep();
        // Execute Activity 2
        await engine.runStep();

        const token = engine.getTokens()[0];
        // console.log('Token History:', JSON.stringify(token.history, null, 2));

        const activity2Exit = token.history.find(h => h.action === 'status_change:completed' && h.nodeId === activity2Id);
        expect(activity2Exit).toBeDefined();
        expect(activity2Exit?.analytics?.value_added).toBe(false);

        const activity1Exit = token.history.find(h => h.action === 'exited' && h.nodeId === activity1Id);
        expect(activity1Exit).toBeDefined();
        expect(activity1Exit?.analytics?.value_added).toBe(true); // Default
    });

    it('should accumulate analytics in token history across multiple steps', async () => {
        const engine = new WorkflowEngine(workflow, { wait_for_human_tasks: false });
        await engine.start();

        await engine.runStep(); // Activity 1
        await engine.runStep(); // Activity 2
        await engine.runStep(); // Completion

        const token = engine.getTokens()[0];
        const analyticsEntries = token.history.filter(h => h.analytics !== undefined);

        // Expected entries: 
        // 1. exited Activity 1 (process_time)
        // 2. exited Activity 2 (process_time)
        // 3. status_change:completed (if we passed analytics there - wait, I did pass it to advanceToken which calls updateStatus('completed', analytics))
        expect(analyticsEntries.length).toBeGreaterThanOrEqual(2);
    });

    it('should precisely track wait_time in resumeToken', async () => {
        const engine = new WorkflowEngine(workflow, { wait_for_human_tasks: true });
        await engine.start();

        const stepPromise = engine.runStep(); // Human Activity 1
        await new Promise(r => setTimeout(r, 200)); // Wait 200ms

        const token = engine.getTokens()[0];
        engine.resumeToken(token.id, { ok: true });
        await stepPromise;

        const resumedEntry = token.history.find(h => h.action === 'status_change:active');
        // It's hard to be exact but it should be > PT0S and likely PT0.2S
        expect(resumedEntry?.analytics?.wait_time).toMatch(/PT0\.[2-9]S|PT[1-9]/);
    });
});
