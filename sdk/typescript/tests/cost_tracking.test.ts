import { describe, it, expect, vi, beforeEach } from 'vitest';
import { WorkflowEngine } from '../src/runtime/workflow_engine';
import { AIAgent } from '../src/runtime/actors/ai_agent';
import { SoftwareAgent } from '../src/runtime/actors/software_agent';
import { HumanAgent } from '../src/runtime/actors/human_agent';
import { RobotAgent } from '../src/runtime/actors/robot_agent';
import { Workflow, Activity, ActorType, AccessMode, SyncPattern, ContextType, AccessDirection, ResourceType, Permission } from '../src/types';
import { ExecutionLogger } from '../src/runtime/execution_logger';

// Mock Actors
vi.mock('../src/runtime/actors/ai_agent', () => {
    return {
        AIAgent: vi.fn().mockImplementation(() => ({
            execute: vi.fn().mockResolvedValue({
                output: 'Mock Output',
                status: 'completed',
                usage: {
                    input_tokens: 100,
                    output_tokens: 50
                }
            })
        }))
    };
});

vi.mock('../src/runtime/actors/software_agent', () => {
    return {
        SoftwareAgent: vi.fn().mockImplementation(() => ({
            execute: vi.fn().mockResolvedValue({
                output: 'App Output',
                status: 'completed'
            })
        }))
    };
});

vi.mock('../src/runtime/actors/human_agent', () => {
    return {
        HumanAgent: vi.fn().mockImplementation(() => ({
            execute: vi.fn().mockImplementation(async () => {
                // Simulate delay
                await new Promise(resolve => setTimeout(resolve, 10));
                return {
                    output: 'Human Output',
                    status: 'completed'
                };
            })
        }))
    };
});

vi.mock('../src/runtime/actors/robot_agent', () => {
    return {
        RobotAgent: vi.fn().mockImplementation(() => ({
            execute: vi.fn().mockImplementation(async () => {
                // Simulate delay
                await new Promise(resolve => setTimeout(resolve, 10));
                return {
                    output: 'Robot Output',
                    status: 'completed'
                };
            })
        }))
    };
});


describe('Cost Tracking', () => {
    let mockLogger: ExecutionLogger;
    let workflow: Workflow;

    beforeEach(() => {
        mockLogger = {
            log_execution: vi.fn().mockResolvedValue(undefined)
        };

        const activityBase = {
            inputs: [],
            outputs: [],
            context_bindings: [],
            access_rights: [],
            programs: [],
            controls: [],
            skills: [],
            tool_requirements: []
        };

        workflow = {
            id: '550e8400-e29b-41d4-a716-446655440000',
            name: 'Test Workflow',
            version: '1.0.0',
            activities: [
                {
                    ...activityBase,
                    id: 'act-ai',
                    name: 'AI Activity',
                    role_id: 'role-ai',
                    actor_type: ActorType.enum.ai_agent,
                },
                {
                    ...activityBase,
                    id: 'act-human',
                    name: 'Human Activity',
                    role_id: 'role-human',
                    actor_type: ActorType.enum.human,
                },
                {
                    ...activityBase,
                    id: 'act-robot',
                    name: 'Robot Activity',
                    role_id: 'role-robot',
                    actor_type: ActorType.enum.robot,
                },
                {
                    ...activityBase,
                    id: 'act-app',
                    name: 'App Activity',
                    role_id: 'role-app',
                    actor_type: ActorType.enum.application,
                }
            ],
            edges: [
                { id: 'e1', source_id: 'act-ai', target_id: 'act-human', is_default: true, skills: [], tool_requirements: [] },
                { id: 'e2', source_id: 'act-human', target_id: 'act-robot', is_default: true, skills: [], tool_requirements: [] },
                { id: 'e3', source_id: 'act-robot', target_id: 'act-app', is_default: true, skills: [], tool_requirements: [] }
            ],
            contexts: [],
            decision_nodes: [],
            events: []
        };
    });

    it('should calculate cost correctly for various actors', async () => {
        const pricingConfig = {
            input_token_cost_per_1k: 0.002, // $0.002 per 1k input
            output_token_cost_per_1k: 0.005, // $0.005 per 1k output
            currency: 'USD',
            human_cost_per_hour: 50, // $50/hr
            robot_cost_per_hour: 10, // $10/hr
            software_cost_per_execution: 0.01 // $0.01 per execution
        };

        const engine = new WorkflowEngine(workflow, {
            gemini_api_key: 'test-key',
            execution_logger: mockLogger,
            pricing_config: pricingConfig,
            roles: [
                { id: 'role-ai', name: 'AI Role', actor_type: ActorType.enum.ai_agent },
                { id: 'role-human', name: 'Human Role', actor_type: ActorType.enum.human },
                { id: 'role-robot', name: 'Robot Role', actor_type: ActorType.enum.robot },
                { id: 'role-app', name: 'App Role', actor_type: ActorType.enum.application }
            ]
        });

        await engine.start();
        await engine.run();

        expect(mockLogger.log_execution).toHaveBeenCalled();
        const metrics = (mockLogger.log_execution as any).mock.calls[0][0];

        // AI Cost: (100/1000)*0.002 + (50/1000)*0.005 = 0.0002 + 0.00025 = 0.00045
        // App Cost: 0.01
        // Human Cost: > 0 (since duration > 0)
        // Robot Cost: > 0 (since duration > 0)

        expect(metrics.execution_cost).toBeGreaterThan(0.01045);
        expect(metrics.execution_cost).toBeLessThan(1); // Sanity check

        expect(metrics.input_tokens).toBe(100);
        expect(metrics.output_tokens).toBe(50);
        expect(metrics.steps_count).toBe(4);
    });
});
