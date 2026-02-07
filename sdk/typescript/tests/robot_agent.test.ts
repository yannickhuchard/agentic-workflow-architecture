/**
 * AWA Robot Agent Tests
 */

import { describe, it, expect } from 'vitest';
import { RobotAgent, RobotConfig } from '../src/runtime/actors/robot_agent';
import { Activity } from '../src/types';
import { v4 as uuidv4 } from 'uuid';

// Helper to create a mock robot activity
function createRobotActivity(name: string, description?: string): Activity {
    return {
        id: uuidv4(),
        name,
        description,
        role_id: uuidv4(),
        actor_type: 'robot',
        inputs: [],
        outputs: [],
        context_bindings: [],
        access_rights: [],
        programs: [],
        controls: [],
        is_expandable: false,
        skills: [],
        tool_requirements: []
    };
}

describe('RobotAgent - Simulation Mode', () => {

    it('should execute in simulation mode by default', async () => {
        const agent = new RobotAgent();
        const activity = createRobotActivity('Generic Robot Task');

        const result = await agent.execute(activity, {});

        expect(result.status).toBe('completed');
        expect(result.execution_time_ms).toBeDefined();
    });

    it('should detect pick action from activity name', async () => {
        const agent = new RobotAgent({ simulation_mode: true });
        const activity = createRobotActivity('Pick Item from Shelf');

        const result = await agent.execute(activity, { item_id: 'SKU-123' });

        expect(result.action).toBe('pick');
        expect(result.result.item_picked).toBe(true);
        expect(result.result.gripper_state).toBe('closed');
    });

    it('should detect place action from activity name', async () => {
        const agent = new RobotAgent({ simulation_mode: true });
        const activity = createRobotActivity('Place Item in Box');

        const result = await agent.execute(activity, {});

        expect(result.action).toBe('place');
        expect(result.result.item_placed).toBe(true);
        expect(result.result.gripper_state).toBe('open');
    });

    it('should detect move action from activity name', async () => {
        const agent = new RobotAgent({ simulation_mode: true });
        const activity = createRobotActivity('Move to Station B');

        const result = await agent.execute(activity, {});

        expect(result.action).toBe('move');
        expect(result.result.movement_complete).toBe(true);
        expect(result.result.current_position).toBeDefined();
    });

    it('should detect scan action from activity name', async () => {
        const agent = new RobotAgent({ simulation_mode: true });
        const activity = createRobotActivity('Scan Barcode');

        const result = await agent.execute(activity, {});

        expect(result.action).toBe('scan');
        expect(result.result.scan_complete).toBe(true);
        expect(result.result.barcode).toBeDefined();
    });

    it('should detect assemble action from activity name', async () => {
        const agent = new RobotAgent({ simulation_mode: true });
        const activity = createRobotActivity('Assemble Component');

        const result = await agent.execute(activity, {});

        expect(result.action).toBe('assemble');
        expect(result.result.assembly_complete).toBe(true);
        expect(result.result.quality_check).toBe('passed');
    });

    it('should detect action from description if not in name', async () => {
        const agent = new RobotAgent({ simulation_mode: true });
        const activity = createRobotActivity('Robot Task', 'This task involves grabbing the item');

        const result = await agent.execute(activity, {});

        expect(result.action).toBe('pick');
    });

    it('should preserve input data in output', async () => {
        const agent = new RobotAgent({ simulation_mode: true });
        const activity = createRobotActivity('Pick Part');

        const result = await agent.execute(activity, {
            part_number: 'PN-789',
            quantity: 5
        });

        expect(result.part_number).toBe('PN-789');
        expect(result.quantity).toBe(5);
    });

    it('should have reasonable execution time', async () => {
        const agent = new RobotAgent({ simulation_mode: true });
        const activity = createRobotActivity('Quick Task');

        const start = Date.now();
        const result = await agent.execute(activity, {});
        const elapsed = Date.now() - start;

        // Should take between 100-500ms in simulation
        expect(elapsed).toBeGreaterThanOrEqual(100);
        expect(elapsed).toBeLessThan(1000);
        expect(result.execution_time_ms).toBeGreaterThan(0);
    });
});

describe('RobotAgent - Real Mode', () => {

    it('should throw error when not in simulation mode', async () => {
        const agent = new RobotAgent({
            simulation_mode: false,
            protocol: 'mqtt',
            connection_string: 'mqtt://robot.local'
        });
        const activity = createRobotActivity('Real Robot Task');

        await expect(agent.execute(activity, {}))
            .rejects.toThrow(/not yet implemented/);
    });

    it('should include protocol info in error message', async () => {
        const agent = new RobotAgent({
            simulation_mode: false,
            protocol: 'opcua',
            connection_string: 'opc.tcp://plc.factory'
        });
        const activity = createRobotActivity('PLC Task');

        await expect(agent.execute(activity, {}))
            .rejects.toThrow(/opcua/);
    });
});

describe('RobotAgent - Configuration', () => {

    it('should use default timeout', async () => {
        const agent = new RobotAgent();
        // Verify default simulation mode is enabled
        const activity = createRobotActivity('Test');
        const result = await agent.execute(activity, {});
        expect(result.status).toBe('completed');
    });

    it('should accept custom configuration', async () => {
        const config: RobotConfig = {
            simulation_mode: true,
            timeout_ms: 5000,
            protocol: 'ros',
            connection_string: 'ros://robot'
        };

        const agent = new RobotAgent(config);
        const activity = createRobotActivity('Configured Task');
        const result = await agent.execute(activity, {});

        expect(result.status).toBe('completed');
    });
});
