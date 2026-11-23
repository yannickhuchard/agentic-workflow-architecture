/**
 * awa validate: the command line check of workflow and journey documents.
 */
import { describe, it, expect, vi } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { check_documents } from '../src/cli/commands/validate';

const example = (file: string) => path.resolve(__dirname, '../../../examples', file);

describe('awa validate', () => {
    it('accepts valid workflows and a journey given with its workflows', async () => {
        const { results, journey_references_checked } = await check_documents([example('claims-journey/policy-purchase.journey.json'), example('claims-journey/policy-purchase.awa.json')]);
        expect(journey_references_checked).toBe(true);
        expect(results.map(r => [r.kind, r.valid])).toEqual([['workflow', true], ['journey', true]]);
    });

    it('reports a journey whose workflows are not among those given, a broken workflow and a file that is not JSON', async () => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'awa-validate-'));
        fs.writeFileSync(path.join(dir, 'broken.json'), JSON.stringify({ name: 'Broken', activities: [{ name: 'A' }], edges: [] }));
        fs.writeFileSync(path.join(dir, 'text.json'), 'not json');
        const { results } = await check_documents([example('claims-journey/motor-claim.journey.json'), example('claims-journey/policy-purchase.awa.json'), path.join(dir, 'broken.json'), path.join(dir, 'text.json')]);
        expect(results.find(r => r.kind === 'journey')).toMatchObject({ valid: false, name: 'Motor Claim' });
        expect(results.find(r => r.name === 'Broken')!.errors.map(e => e.path)).toContain('activities.0.actor_type');
        expect(results.find(r => r.kind === 'unknown')).toMatchObject({ valid: false, errors: [{ code: 'invalid_json' }] });
    });

    it('checks only what a journey says of itself when no workflow is given', async () => {
        const { results, journey_references_checked } = await check_documents([example('claims-journey/motor-claim.journey.json')]);
        expect(journey_references_checked).toBe(false);
        expect(results[0]).toMatchObject({ kind: 'journey', valid: true });
    });
});

describe('The configured models', () => {
    it('keep the Google presets Google model names, whatever reference the default model is set to', async () => {
        vi.resetModules();
        vi.stubEnv('AWA_DEFAULT_AI_MODEL_ID', 'tier:balanced');
        try {
            const { DEFAULT_AI_MODEL_ID } = await import('../src/runtime/model_config');
            const { TIER_PRESETS } = await import('../src/runtime/models');
            const config = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../src/config.json'), 'utf-8'));
            expect(DEFAULT_AI_MODEL_ID).toBe('tier:balanced');
            expect(TIER_PRESETS.google.balanced).toBe(`google:${config.default_ai_model_id}`);
            expect(Object.values(TIER_PRESETS.google).every(ref => /^google:[^:]+$/.test(ref))).toBe(true);
        } finally {
            vi.unstubAllEnvs();
            vi.resetModules();
        }
    });

    it('read the default model from the configuration file', async () => {
        const { DEFAULT_AI_MODEL_ID, GOOGLE_TIER_MODELS } = await import('../src/runtime/model_config');
        const config = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../src/config.json'), 'utf-8'));
        if (!process.env.AWA_DEFAULT_AI_MODEL_ID) expect(DEFAULT_AI_MODEL_ID).toBe(config.default_ai_model_id);
        expect(GOOGLE_TIER_MODELS.balanced).toBe(process.env.AWA_GOOGLE_BALANCED_MODEL || config.default_ai_model_id);
    });
});
