/**
 * awa validate: the command line check of workflow and journey documents.
 */
import { describe, it, expect } from 'vitest';
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
