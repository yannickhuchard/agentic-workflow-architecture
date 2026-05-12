import { describe, it, expect, vi, beforeEach } from 'vitest';
import { WorkflowEngine } from '../src/runtime/workflow_engine';
import { VerificationEngine } from '../src/runtime/verification_engine';
import { Workflow, Activity, Role, ActorType, VerificationPolicy } from '../src/types';
import { v4 as uuidv4 } from 'uuid';

// Mock @google/generative-ai
const mockGenerateContent = vi.fn();
const mockGetGenerativeModel = vi.fn(() => ({
    generateContent: mockGenerateContent
}));

vi.mock('@google/generative-ai', () => {
    return {
        GoogleGenerativeAI: vi.fn(() => ({
            getGenerativeModel: mockGetGenerativeModel
        }))
    };
});

// ============================================================================
// Helper Functions
// ============================================================================

function createVerificationPolicy(overrides: Partial<VerificationPolicy> = {}): VerificationPolicy {
    return {
        enabled: true,
        mode: 'ai_judge',
        criteria: [
            {
                id: uuidv4(),
                name: 'Completeness',
                description: 'The output must contain all required fields',
                type: 'completeness',
                weight: 1,
                required: true,
            },
            {
                id: uuidv4(),
                name: 'Accuracy',
                description: 'The output must be factually accurate',
                type: 'accuracy',
                weight: 0.8,
                required: false,
            }
        ],
        max_retries: 2,
        retry_with_feedback: true,
        judge_model_id: 'gemini-2.5-flash',
        judge_temperature: 0.1,
        pass_threshold: 0.9,
        ...overrides,
    };
}

function createWorkflowWithVerification(
    verification?: VerificationPolicy,
    actorType: ActorType = 'ai_agent'
): { workflow: Workflow; roleId: string; activityId: string } {
    const roleId = uuidv4();
    const activityId = uuidv4();

    const workflow: Workflow = {
        id: uuidv4(),
        name: 'Verified Workflow',
        version: '1.0.0',
        activities: [
            {
                id: activityId,
                name: 'Verified Activity',
                description: 'An activity with verification',
                actor_type: actorType,
                role_id: roleId,
                inputs: [],
                outputs: [],
                context_bindings: [],
                access_rights: [],
                programs: [],
                controls: [],
                skills: [],
                tool_requirements: [],
                is_expandable: false,
                verification,
            }
        ],
        edges: [],
        contexts: [],
        events: [],
        decision_nodes: [],
    };

    return { workflow, roleId, activityId };
}

function createRole(id: string): Role {
    return {
        id,
        name: 'Test AI Role',
        actor_type: 'ai_agent',
        capabilities: ['Summarization'],
        ai_model_config: {
            model_id: 'gemini-2.5-flash',
            temperature: 0.5,
        },
        mcp_tools: [],
        is_embedded: false,
    };
}

/** Mock a Gemini response for the AI agent execution */
function mockAgentResponse(data: Record<string, unknown>) {
    mockGenerateContent.mockResolvedValueOnce({
        response: {
            text: () => JSON.stringify(data),
            usageMetadata: { promptTokenCount: 100, candidatesTokenCount: 50 },
        }
    });
}

/** Mock a Gemini response for the AI judge verification */
function mockJudgeVerdict(results: Array<{ criterion_id: number; passed: boolean; evidence: string; confidence: number }>, feedback?: string) {
    mockGenerateContent.mockResolvedValueOnce({
        response: {
            text: () => JSON.stringify({ results, feedback: feedback || null }),
            usageMetadata: { promptTokenCount: 200, candidatesTokenCount: 80 },
        }
    });
}

// ============================================================================
// Tests
// ============================================================================

describe('Verification Engine Unit', () => {
    let engine: VerificationEngine;

    beforeEach(() => {
        vi.clearAllMocks();
        engine = new VerificationEngine({ gemini_api_key: 'test-key', verbose: true });
    });

    it('should compute deterministic SHA-256 output hash', () => {
        const output = { result: 'hello', score: 42 };
        const hash1 = engine.compute_output_hash(output);
        const hash2 = engine.compute_output_hash(output);

        expect(hash1).toBe(hash2);
        expect(hash1).toHaveLength(64); // SHA-256 hex length
    });

    it('should produce different hashes for different outputs', () => {
        const hash1 = engine.compute_output_hash({ a: 1 });
        const hash2 = engine.compute_output_hash({ a: 2 });

        expect(hash1).not.toBe(hash2);
    });

    it('should generate corrective feedback from a failed verification record', () => {
        const feedback = engine.generate_corrective_feedback({
            id: uuidv4(),
            activity_id: uuidv4(),
            attempt: 1,
            verdict: 'fail',
            criteria_results: [
                { criterion_id: uuidv4(), criterion_name: 'Completeness', passed: false, evidence: 'Missing summary field' },
                { criterion_id: uuidv4(), criterion_name: 'Accuracy', passed: true, evidence: 'Data is accurate' },
            ],
            overall_score: 0.5,
            feedback: 'Must include summary field',
            verified_at: new Date().toISOString(),
            duration_ms: 100,
            output_hash: 'abc123',
        });

        expect(feedback).toContain('VERIFICATION FAILED');
        expect(feedback).toContain('attempt 1');
        expect(feedback).toContain('50%');
        expect(feedback).toContain('❌ FAIL');
        expect(feedback).toContain('✅ PASS');
        expect(feedback).toContain('Missing summary field');
    });

    it('should verify with schema_only mode using expressions', async () => {
        const activity: Activity = {
            id: uuidv4(),
            name: 'Schema Test',
            actor_type: 'application',
            role_id: uuidv4(),
            inputs: [],
            outputs: [],
            context_bindings: [],
            access_rights: [],
            programs: [],
            controls: [],
            skills: [],
            tool_requirements: [],
            is_expandable: false,
            verification: createVerificationPolicy({
                mode: 'schema_only',
                criteria: [
                    { id: uuidv4(), name: 'Has result', description: 'result key must exist', type: 'format', expression: 'result exists', weight: 1, required: true },
                    { id: uuidv4(), name: 'Has status', description: 'status key type is string', type: 'format', expression: 'typeof status == string', weight: 1, required: true },
                ],
            }),
        };

        // Output with both keys
        const record = await engine.verify(
            activity,
            {},
            { result: 'done', status: 'ok' },
            1
        );

        expect(record.verdict).toBe('pass');
        expect(record.overall_score).toBe(1);
        expect(record.criteria_results).toHaveLength(2);
        expect(record.output_hash).toHaveLength(64);
    });

    it('should fail schema_only verification when expression evaluates to false', async () => {
        const activity: Activity = {
            id: uuidv4(),
            name: 'Schema Fail Test',
            actor_type: 'application',
            role_id: uuidv4(),
            inputs: [],
            outputs: [],
            context_bindings: [],
            access_rights: [],
            programs: [],
            controls: [],
            skills: [],
            tool_requirements: [],
            is_expandable: false,
            verification: createVerificationPolicy({
                mode: 'schema_only',
                criteria: [
                    { id: uuidv4(), name: 'Has missing_key', description: 'must have missing_key', type: 'format', expression: 'missing_key exists', weight: 1, required: true },
                ],
            }),
        };

        const record = await engine.verify(
            activity,
            {},
            { other_key: 'value' },
            1
        );

        expect(record.verdict).toBe('fail');
        expect(record.criteria_results[0].passed).toBe(false);
    });
});

describe('Verification in Workflow Engine', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('should execute without verification when no policy is set', async () => {
        const { workflow, roleId } = createWorkflowWithVerification(undefined);
        const role = createRole(roleId);

        // Single agent call, no judge call
        mockAgentResponse({ result: 'done' });

        const engine = new WorkflowEngine(workflow, {
            geminiApiKey: 'test-key',
            roles: [role],
        });

        await engine.start({});
        await engine.runStep();

        const tokens = engine.getTokens();
        expect(tokens[0].status).toBe('completed');
        // Only 1 Gemini call (the agent, no judge)
        expect(mockGenerateContent).toHaveBeenCalledTimes(1);
        // No verification records
        expect(tokens[0].contextData._verification_records).toBeUndefined();
    });

    it('should pass verification on first attempt and include records', async () => {
        const policy = createVerificationPolicy();
        const { workflow, roleId } = createWorkflowWithVerification(policy);
        const role = createRole(roleId);

        // 1st call: AI agent execution
        mockAgentResponse({ summary: 'The quarterly report...', key_metrics: [1, 2, 3] });

        // 2nd call: AI judge verdict — all pass
        mockJudgeVerdict([
            { criterion_id: 1, passed: true, evidence: 'All fields present', confidence: 0.95 },
            { criterion_id: 2, passed: true, evidence: 'Data matches source', confidence: 0.90 },
        ]);

        const engine = new WorkflowEngine(workflow, {
            geminiApiKey: 'test-key',
            roles: [role],
            verbose: true,
        });

        await engine.start({});
        await engine.runStep();

        const tokens = engine.getTokens();
        expect(tokens[0].status).toBe('completed');

        // 2 Gemini calls: agent + judge
        expect(mockGenerateContent).toHaveBeenCalledTimes(2);

        // Verification records present
        const records = tokens[0].contextData._verification_records as Array<Record<string, unknown>>;
        expect(records).toBeDefined();
        expect(records).toHaveLength(1);
        expect(records[0].verdict).toBe('pass');
    });

    it('should retry on verification failure and pass on second attempt', async () => {
        const policy = createVerificationPolicy({ max_retries: 2 });
        const { workflow, roleId } = createWorkflowWithVerification(policy);
        const role = createRole(roleId);

        // Attempt 1: Agent output (incomplete)
        mockAgentResponse({ partial: 'data' });

        // Attempt 1: Judge fails it
        mockJudgeVerdict([
            { criterion_id: 1, passed: false, evidence: 'Missing required fields', confidence: 0.95 },
            { criterion_id: 2, passed: true, evidence: 'Partial data is accurate', confidence: 0.85 },
        ], 'Please include all required output fields including summary.');

        // Attempt 2: Agent retries with feedback (complete output)
        mockAgentResponse({ summary: 'Complete report', metrics: [1, 2, 3] });

        // Attempt 2: Judge passes it
        mockJudgeVerdict([
            { criterion_id: 1, passed: true, evidence: 'All fields now present', confidence: 0.98 },
            { criterion_id: 2, passed: true, evidence: 'Accurate data', confidence: 0.92 },
        ]);

        const engine = new WorkflowEngine(workflow, {
            geminiApiKey: 'test-key',
            roles: [role],
            verbose: true,
        });

        await engine.start({});
        await engine.runStep();

        const tokens = engine.getTokens();
        expect(tokens[0].status).toBe('completed');

        // 4 Gemini calls: agent1 + judge1 + agent2 + judge2
        expect(mockGenerateContent).toHaveBeenCalledTimes(4);

        // Should have 2 verification records
        const records = tokens[0].contextData._verification_records as Array<Record<string, unknown>>;
        expect(records).toHaveLength(2);
        expect(records[0].verdict).toBe('fail');
        expect(records[1].verdict).toBe('pass');
    });

    it('should fail token when all verification retries are exhausted', async () => {
        const policy = createVerificationPolicy({ max_retries: 1 }); // 1 retry = 2 attempts total
        const { workflow, roleId } = createWorkflowWithVerification(policy);
        const role = createRole(roleId);

        // Attempt 1: bad output
        mockAgentResponse({ wrong: 'output' });
        mockJudgeVerdict([
            { criterion_id: 1, passed: false, evidence: 'Missing fields', confidence: 0.9 },
            { criterion_id: 2, passed: false, evidence: 'Inaccurate', confidence: 0.8 },
        ], 'Fix everything');

        // Attempt 2: still bad
        mockAgentResponse({ still_wrong: true });
        mockJudgeVerdict([
            { criterion_id: 1, passed: false, evidence: 'Still missing', confidence: 0.95 },
            { criterion_id: 2, passed: false, evidence: 'Still inaccurate', confidence: 0.85 },
        ], 'Still not correct');

        const engine = new WorkflowEngine(workflow, {
            geminiApiKey: 'test-key',
            roles: [role],
            verbose: true,
        });

        await engine.start({});
        await engine.runStep();

        const tokens = engine.getTokens();
        expect(tokens[0].status).toBe('failed');

        // Error should mention verification
        expect(tokens[0].contextData._error).toContain('Verification failed');

        // Should have 2 records, both failed
        const records = tokens[0].contextData._verification_records as Array<Record<string, unknown>>;
        expect(records).toHaveLength(2);
        expect(records[0].verdict).toBe('fail');
        expect(records[1].verdict).toBe('fail');
    });

    it('should not retry non-AI actors on verification failure', async () => {
        const policy = createVerificationPolicy({
            mode: 'schema_only',
            max_retries: 3,
            criteria: [
                { id: uuidv4(), name: 'Has data', description: 'must have data key', type: 'format', expression: 'data exists', weight: 1, required: true },
            ],
        });

        // Use application actor type
        const { workflow } = createWorkflowWithVerification(policy, 'application');

        const engine = new WorkflowEngine(workflow, { verbose: true });

        await engine.start({});
        await engine.runStep();

        const tokens = engine.getTokens();

        // SoftwareAgent output doesn't have 'data' key in the exact format expected
        // It produces { status: 200, data: {...}, message: '...' } so it should actually pass
        // The key 'data' exists in SoftwareAgent output
        const records = tokens[0].contextData._verification_records as Array<Record<string, unknown>>;
        expect(records).toBeDefined();
        // Should only have 1 attempt (no retry for non-AI actors)
        expect(records).toHaveLength(1);
    });

    it('should globally disable verification via engine options', async () => {
        const policy = createVerificationPolicy();
        const { workflow, roleId } = createWorkflowWithVerification(policy);
        const role = createRole(roleId);

        mockAgentResponse({ result: 'output without verification' });

        const engine = new WorkflowEngine(workflow, {
            geminiApiKey: 'test-key',
            roles: [role],
            verification_enabled: false, // Globally disabled
        });

        await engine.start({});
        await engine.runStep();

        const tokens = engine.getTokens();
        expect(tokens[0].status).toBe('completed');
        // Only 1 call — no judge
        expect(mockGenerateContent).toHaveBeenCalledTimes(1);
        expect(tokens[0].contextData._verification_records).toBeUndefined();
    });

    it('should inject corrective feedback into AI agent prompt on retry', async () => {
        const policy = createVerificationPolicy({ max_retries: 1 });
        const { workflow, roleId } = createWorkflowWithVerification(policy);
        const role = createRole(roleId);

        // Attempt 1
        mockAgentResponse({ incomplete: true });
        mockJudgeVerdict([
            { criterion_id: 1, passed: false, evidence: 'Output is incomplete', confidence: 0.9 },
            { criterion_id: 2, passed: true, evidence: 'Accurate though', confidence: 0.8 },
        ], 'Please include the summary field');

        // Attempt 2 — check that feedback was injected
        mockAgentResponse({ summary: 'Now complete' });
        mockJudgeVerdict([
            { criterion_id: 1, passed: true, evidence: 'Now complete', confidence: 0.95 },
            { criterion_id: 2, passed: true, evidence: 'Still accurate', confidence: 0.85 },
        ]);

        const engine = new WorkflowEngine(workflow, {
            geminiApiKey: 'test-key',
            roles: [role],
            verbose: true,
        });

        await engine.start({});
        await engine.runStep();

        // Check the 3rd Gemini call (2nd agent execution) contains verification feedback
        expect(mockGenerateContent).toHaveBeenCalledTimes(4);
        const retryPrompt = mockGenerateContent.mock.calls[2][0].contents[0].parts[0].text;
        expect(retryPrompt).toContain('Previous Attempt Failed Verification');
        expect(retryPrompt).toContain('VERIFICATION FAILED');
    });
});

describe('pass_threshold behavior', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('should pass when score meets 90% threshold', async () => {
        const engine = new VerificationEngine({ gemini_api_key: 'test-key' });

        // Create activity with 10 optional criteria, 9 pass
        const criteria = Array.from({ length: 10 }, (_, i) => ({
            id: uuidv4(),
            name: `Criterion ${i + 1}`,
            description: `Test criterion ${i + 1}`,
            type: 'completeness' as const,
            weight: 1,
            required: false, // All optional
        }));

        const activity: Activity = {
            id: uuidv4(),
            name: 'Threshold Test',
            actor_type: 'ai_agent',
            role_id: uuidv4(),
            inputs: [],
            outputs: [],
            context_bindings: [],
            access_rights: [],
            programs: [],
            controls: [],
            skills: [],
            tool_requirements: [],
            is_expandable: false,
            verification: {
                enabled: true,
                mode: 'schema_only',
                criteria,
                max_retries: 0,
                retry_with_feedback: false,
                judge_model_id: 'gemini-2.5-flash',
                judge_temperature: 0.1,
                pass_threshold: 0.9,
            },
        };

        // All criteria have simple truthy expression check
        // Set all 10 as simple existence checks
        activity.verification!.criteria = activity.verification!.criteria.map((c, i) => ({
            ...c,
            expression: `field_${i} exists`,
        }));

        // Output has 9 of 10 fields — should pass at 90% threshold
        const output: Record<string, unknown> = {};
        for (let i = 0; i < 9; i++) {
            output[`field_${i}`] = `value_${i}`;
        }
        // field_9 is missing

        const record = await engine.verify(activity, {}, output, 1);
        expect(record.overall_score).toBe(0.9);
        expect(record.verdict).toBe('pass');
    });

    it('should fail when required criterion fails even if score exceeds threshold', async () => {
        const engine = new VerificationEngine({ gemini_api_key: 'test-key' });

        const activity: Activity = {
            id: uuidv4(),
            name: 'Required Fail Test',
            actor_type: 'ai_agent',
            role_id: uuidv4(),
            inputs: [],
            outputs: [],
            context_bindings: [],
            access_rights: [],
            programs: [],
            controls: [],
            skills: [],
            tool_requirements: [],
            is_expandable: false,
            verification: {
                enabled: true,
                mode: 'schema_only',
                criteria: [
                    { id: uuidv4(), name: 'Required field', description: 'Must have x', type: 'completeness', expression: 'x exists', weight: 0.1, required: true },
                    { id: uuidv4(), name: 'Optional field', description: 'Nice to have y', type: 'completeness', expression: 'y exists', weight: 0.9, required: false },
                ],
                max_retries: 0,
                retry_with_feedback: false,
                judge_model_id: 'gemini-2.5-flash',
                judge_temperature: 0.1,
                pass_threshold: 0.5, // Low threshold
            },
        };

        // Has y but not x — high score (0.9) but required criterion fails
        const record = await engine.verify(activity, {}, { y: 'present' }, 1);

        expect(record.overall_score).toBe(0.9);
        expect(record.verdict).toBe('fail'); // Required criterion overrides threshold
    });
});
