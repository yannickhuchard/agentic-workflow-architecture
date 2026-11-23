/**
 * AWA Verification Engine
 * Provable verification of activity outputs against acceptance criteria.
 * Supports AI-as-judge, schema-only validation, and custom verification modes.
 */

import { DEFAULT_AI_MODEL_ID } from './model_config';
import { ModelRegistry, GoogleModelProvider } from './models';
import { hash_payload } from './journal';
import { randomUUID as uuidv4 } from 'crypto';
import { evaluate_expression } from './expression';
import {
    Activity,
    VerificationPolicy,
    VerificationCriterion,
    VerificationRecord,
    VerificationCriterionResult,
    VerificationVerdict,
} from '../types';

/** Configuration for the VerificationEngine */
export interface VerificationEngineConfig {
    /** Gemini API key for AI judge mode */
    gemini_api_key?: string;
    /** Override model ID for all verifications */
    default_model_id?: string;
    /** Enable verbose logging */
    verbose?: boolean;
    /** Run in simulation mode (mocks all verifications as pass) */
    simulate?: boolean;
    /** Registry of model providers. If absent, the Google provider is used with gemini_api_key. */
    models?: ModelRegistry;
}

/** Internal result from judging a single attempt */
interface JudgeResult {
    criteria_results: VerificationCriterionResult[];
    overall_score: number;
    verdict: VerificationVerdict;
    feedback: string;
    judge_tokens?: { input: number; output: number };
}

export class VerificationEngine {
    private config: VerificationEngineConfig;

    constructor(config: VerificationEngineConfig = {}) {
        this.config = config;
    }

    private log(message: string): void {
        if (this.config.verbose) {
            console.log(`[VerificationEngine] ${message}`);
        }
    }

    /**
     * Verify an activity's output against its verification policy.
     * Returns a VerificationRecord with the verdict, evidence, and feedback.
     */
    public async verify(
        activity: Activity,
        inputs: Record<string, unknown>,
        output: Record<string, unknown>,
        attempt: number
    ): Promise<VerificationRecord> {
        const policy = activity.verification;
        if (!policy || !policy.enabled) {
            throw new Error('Verification called on activity without enabled verification policy');
        }

        const startTime = Date.now();
        this.log(`Verifying activity "${activity.name}" (attempt ${attempt})`);

        let judgeResult: JudgeResult;

        if (this.config.simulate) {
            judgeResult = {
                criteria_results: (policy.criteria || []).map(c => ({
                    criterion_id: c.id,
                    criterion_name: c.name,
                    passed: true,
                    evidence: 'Simulated pass',
                    confidence: 1.0,
                })),
                overall_score: 1.0,
                verdict: 'pass',
                feedback: 'Simulation mode: verification automatically passed',
            };
        } else {
            switch (policy.mode) {
                case 'ai_judge':
                    judgeResult = await this.verify_with_ai_judge(policy, activity, inputs, output);
                    break;
                case 'schema_only':
                    judgeResult = this.verify_with_schema(policy, output);
                    break;
                case 'custom':
                    // Fail closed: never substitute a weaker check for the one requested
                    throw new Error('Verification mode "custom" has no registered verifier');
                default:
                    throw new Error(`Unknown verification mode: ${policy.mode}`);
            }
        }

        const durationMs = Date.now() - startTime;
        const outputHash = this.compute_output_hash(output);

        const record: VerificationRecord = {
            id: uuidv4(),
            activity_id: activity.id,
            attempt,
            verdict: judgeResult.verdict,
            criteria_results: judgeResult.criteria_results,
            overall_score: judgeResult.overall_score,
            feedback: judgeResult.feedback,
            verified_at: new Date().toISOString(),
            duration_ms: durationMs,
            judge_tokens: judgeResult.judge_tokens,
            output_hash: outputHash,
        };

        this.log(`Verdict: ${record.verdict} (score: ${record.overall_score.toFixed(2)}, hash: ${outputHash.slice(0, 12)}...)`);
        return record;
    }

    /**
     * AI-as-Judge verification using Gemini
     */
    private async verify_with_ai_judge(
        policy: VerificationPolicy,
        activity: Activity,
        inputs: Record<string, unknown>,
        output: Record<string, unknown>
    ): Promise<JudgeResult> {
        const models = this.config.models?.has_providers()
            ? this.config.models
            : this.config.gemini_api_key
                ? new ModelRegistry().register(new GoogleModelProvider(this.config.gemini_api_key))
                : undefined;
        if (!models) {
            throw new Error('Gemini API key required for AI judge verification mode');
        }

        // Resolve the judge model reference: policy > engine default
        const modelRef = policy.judge_model_id || this.config.default_model_id || DEFAULT_AI_MODEL_ID;
        const resolved = models.resolve(modelRef);

        const prompt = this.generate_judge_prompt(policy.criteria, activity, inputs, output);

        this.log(`Calling AI judge (model: ${resolved.ref}, criteria: ${policy.criteria.length})`);

        const response = await resolved.provider.generate({
            model: resolved.model,
            prompt,
            temperature: policy.judge_temperature,
            max_output_tokens: 2048,
        });

        const responseText = response.text;
        const judgeTokens = { input: response.usage.input_tokens, output: response.usage.output_tokens };

        // Parse the judge's structured response
        const criteriaResults = this.parse_judge_response(responseText, policy.criteria);

        // Compute overall score and verdict
        return this.compute_verdict(criteriaResults, policy, judgeTokens);
    }

    /**
     * Schema-only verification using output_schema definition
     */
    private verify_with_schema(
        policy: VerificationPolicy,
        output: Record<string, unknown>
    ): JudgeResult {
        const criteriaResults: VerificationCriterionResult[] = [];

        for (const criterion of policy.criteria) {
            let passed = false;
            let evidence = '';

            if (criterion.expression) {
                // Simple property-existence and type checks
                try {
                    passed = this.evaluate_expression(criterion.expression, output);
                    evidence = passed
                        ? `Expression "${criterion.expression}" evaluated to true`
                        : `Expression "${criterion.expression}" evaluated to false`;
                } catch (error: unknown) {
                    const message = error instanceof Error ? error.message : String(error);
                    evidence = `Expression evaluation error: ${message}`;
                    passed = false;
                }
            } else {
                // Fail closed: a criterion that cannot be checked deterministically is not met
                passed = false;
                evidence = 'Criterion has no expression; schema_only mode cannot evaluate it';
            }

            criteriaResults.push({
                criterion_id: criterion.id,
                criterion_name: criterion.name,
                passed,
                evidence,
                confidence: 1.0, // Schema checks are deterministic
            });
        }

        return this.compute_verdict(criteriaResults, policy);
    }

    /** Evaluate an AWA condition expression against the output */
    private evaluate_expression(expression: string, output: Record<string, unknown>): boolean {
        return evaluate_expression(expression, output);
    }

    /**
     * Generate the AI judge prompt
     */
    private generate_judge_prompt(
        criteria: VerificationCriterion[],
        activity: Activity,
        inputs: Record<string, unknown>,
        output: Record<string, unknown>
    ): string {
        const criteriaSection = criteria
            .map((c, i) => {
                const reqLabel = c.required ? '[REQUIRED]' : '[OPTIONAL]';
                const weightLabel = c.weight < 1 ? ` (weight: ${c.weight})` : '';
                return `${i + 1}. **${c.name}** (${c.type}) ${reqLabel}${weightLabel}\n   ${c.description}`;
            })
            .join('\n');

        return `You are a strict quality assurance judge for an automated workflow system. Your job is to verify whether an agent's output meets the defined acceptance criteria.

## Activity
- **Name**: ${activity.name}
- **Description**: ${activity.description || 'N/A'}
- **Actor Type**: ${activity.actor_type}

## Acceptance Criteria
${criteriaSection}

## Agent Input (Context)
\`\`\`json
${JSON.stringify(this.sanitize_internal_fields(inputs), null, 2)}
\`\`\`

## Agent Output (To Verify)
\`\`\`json
${JSON.stringify(output, null, 2)}
\`\`\`

## Instructions
For EACH criterion above, evaluate whether the agent's output satisfies it. Respond with a JSON object containing:
- \`results\`: an array with one entry per criterion, each having:
  - \`criterion_id\`: the criterion number (1-indexed)
  - \`passed\`: boolean
  - \`evidence\`: string explaining your reasoning (1-2 sentences)
  - \`confidence\`: number between 0 and 1
- \`feedback\`: if any criterion failed, provide specific corrective instructions the agent should follow to fix the output. If all passed, set to null.

Respond ONLY with a valid JSON object, no markdown formatting.`;
    }

    /**
     * Parse the AI judge's response into structured criteria results
     */
    private parse_judge_response(
        responseText: string,
        criteria: VerificationCriterion[]
    ): VerificationCriterionResult[] {
        // Extract JSON from response
        const jsonMatch = responseText.match(/\{[\s\S]*\}/);
        if (!jsonMatch) {
            this.log(`Failed to parse judge response as JSON, treating as full fail`);
            return criteria.map(c => ({
                criterion_id: c.id,
                criterion_name: c.name,
                passed: false,
                evidence: 'Judge response was not valid JSON',
                confidence: 0,
            }));
        }

        try {
            const parsed = JSON.parse(jsonMatch[0]) as {
                results?: Array<{
                    criterion_id?: number;
                    passed?: boolean;
                    evidence?: string;
                    confidence?: number;
                }>;
                feedback?: string;
            };

            if (!parsed.results || !Array.isArray(parsed.results)) {
                throw new Error('Missing results array in judge response');
            }

            return criteria.map((criterion, index) => {
                const judgeResult = parsed.results?.find(r => r.criterion_id === index + 1)
                    || parsed.results?.[index];

                return {
                    criterion_id: criterion.id,
                    criterion_name: criterion.name,
                    passed: judgeResult?.passed ?? false,
                    evidence: judgeResult?.evidence || 'No evidence provided by judge',
                    confidence: judgeResult?.confidence ?? 0.5,
                };
            });
        } catch (error: unknown) {
            const message = error instanceof Error ? error.message : String(error);
            this.log(`Error parsing judge response: ${message}`);
            return criteria.map(c => ({
                criterion_id: c.id,
                criterion_name: c.name,
                passed: false,
                evidence: `Parse error: ${message}`,
                confidence: 0,
            }));
        }
    }

    /**
     * Compute verdict from criteria results using the policy's pass threshold and weights
     */
    private compute_verdict(
        criteriaResults: VerificationCriterionResult[],
        policy: VerificationPolicy,
        judgeTokens?: { input: number; output: number }
    ): JudgeResult {
        // Check required criteria first — any required fail = overall fail
        const criteria = policy.criteria;
        let allRequiredPass = true;
        for (let i = 0; i < criteriaResults.length; i++) {
            const criterion = criteria[i];
            if (criterion && criterion.required && !criteriaResults[i].passed) {
                allRequiredPass = false;
            }
        }

        // Compute weighted score
        let totalWeight = 0;
        let weightedScore = 0;
        for (let i = 0; i < criteriaResults.length; i++) {
            const weight = criteria[i]?.weight ?? 1;
            totalWeight += weight;
            if (criteriaResults[i].passed) {
                weightedScore += weight;
            }
        }

        const overallScore = totalWeight > 0 ? weightedScore / totalWeight : 0;
        const passesThreshold = overallScore >= policy.pass_threshold;
        const verdict: VerificationVerdict = (allRequiredPass && passesThreshold) ? 'pass' : 'fail';

        // Generate feedback from failures
        const failedCriteria = criteriaResults.filter(r => !r.passed);
        const feedback = failedCriteria.length > 0
            ? `The following criteria were not met:\n${failedCriteria.map(f =>
                `- ${f.criterion_name}: ${f.evidence}`
            ).join('\n')}`
            : undefined;

        return {
            criteria_results: criteriaResults,
            overall_score: overallScore,
            verdict,
            feedback: feedback || '',
            judge_tokens: judgeTokens,
        };
    }

    /**
     * Compute SHA-256 hash of the output for tamper-proof verification records
     */
    public compute_output_hash(output: Record<string, unknown>): string {
        return hash_payload(output);
    }

    /**
     * Generate corrective feedback string for injection into retry prompts
     */
    public generate_corrective_feedback(record: VerificationRecord): string {
        const lines: string[] = [
            `VERIFICATION FAILED (attempt ${record.attempt}, score: ${(record.overall_score * 100).toFixed(0)}%)`,
            '',
        ];

        for (const result of record.criteria_results) {
            const status = result.passed ? '✅ PASS' : '❌ FAIL';
            lines.push(`${status} — ${result.criterion_name}: ${result.evidence}`);
        }

        if (record.feedback) {
            lines.push('');
            lines.push('Corrective instructions:');
            lines.push(record.feedback);
        }

        return lines.join('\n');
    }

    /**
     * Remove internal AWA metadata fields (prefixed with _) from inputs
     * before including them in the judge prompt, to reduce noise.
     */
    private sanitize_internal_fields(data: Record<string, unknown>): Record<string, unknown> {
        const sanitized: Record<string, unknown> = {};
        for (const [key, value] of Object.entries(data)) {
            if (!key.startsWith('_')) {
                sanitized[key] = value;
            }
        }
        return sanitized;
    }
}
