import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { WorkflowEngine } from '../src/runtime/workflow_engine';
import { compile_recipe, required_levels } from '../src/runtime/recipe';
import { parse_journal } from '../src/runtime/journal';
import { parse_document } from '../src/validator';
import { OutcomeContractSchema } from '../src/types';
import { activity, edge, workflow, scripted, silent_logger } from './helpers';

const quiet = { sleep: async () => { }, execution_logger: silent_logger };

async function sample_run() {
    const undo = activity('Release stock');
    const reserve = activity('Reserve stock', { description: 'Hold the items for this order.', compensation: { activity_id: undo.id } });
    const price = activity('Price order', {
        actor_type: 'ai_agent',
        outcome_contract: OutcomeContractSchema.parse({
            output_schema: { type: 'object', required: ['total'], properties: { total: { type: 'number', minimum: 0 } } },
            postconditions: [{ name: 'Not free', expression: 'total > 0' }],
            budgets: { max_attempts: 3 },
        }),
    });
    const ship = activity('Ship', { retry: { max_attempts: 2, initial_delay: 'PT0S', jitter: false } });
    const hold = activity('Hold for review');
    const wf = workflow([reserve, price, ship, hold, undo], [
        edge(reserve, price), edge(price, ship, { condition: 'total < 1000' }), edge(price, hold, { is_default: true }),
    ], { description: 'Fulfil an order.' });
    const { actors } = scripted({
        'Reserve stock': { reservation: 'r-1' },
        'Price order': [
            { output: { total: 'forty' }, _reasoning: { plan: ['guess'], rationale: 'Estimated from memory', confidence: 0.3 } },
            { output: { total: 40 }, _reasoning: { plan: ['look up price list', 'sum lines'], rationale: 'Summed the price list', alternatives_considered: ['estimate: rejected as inexact'], confidence: 0.9 } },
        ],
        Ship: [Object.assign(new Error('carrier timeout'), { code: 'TIMEOUT' }), { tracking: 't-9' }],
    });
    const engine = new WorkflowEngine(wf, { actors, ...quiet });
    await engine.start({ order: 'o-1' });
    const status = await engine.run();
    return { wf, status, events: await engine.getEvents() };
}

describe('Recipe compiler', () => {
    it('explains what to build, what happened and how failures were resolved', async () => {
        const { wf, status, events } = await sample_run();
        expect(status).toBe('completed');
        const recipe = compile_recipe(wf, events);

        // the six sections and the appendix
        for (const heading of ['## 1. What this workflow achieves', '## 2. What you need before you start',
            '## 3. Build it, step by step', '## 4. Wire the flow', '## 5. What this run taught', '## 6. Check your build',
            '## Appendix: workflow definition']) {
            expect(recipe).toContain(heading);
        }

        // the contract, as build instructions
        expect(recipe).toContain('`total`: number, required, minimum 0');
        expect(recipe).toContain('Not free: `total > 0`');

        // what the run did, attempt by attempt, with reasoning and engine decisions
        expect(recipe).toMatch(/Attempt 1: rejected: Outcome contract violated/);
        expect(recipe).toContain('Plan the actor reported: look up price list → sum lines');
        expect(recipe).toContain('Alternatives it rejected: estimate: rejected as inexact');
        expect(recipe).toMatch(/Engine decision \(contract_retry\)/);
        expect(recipe).toMatch(/Engine decision \(retry\): Retry after 0 ms/);

        // routing actually taken, and steps not reached are still documented
        expect(recipe).toContain('when `total < 1000`: go to **Ship** (taken in this run)');
        expect(recipe).toContain('### Step 4: Hold for review (not reached in this run)');

        // lessons
        expect(recipe).toMatch(/\*\*Ship\*\*, attempt 1: carrier timeout \(TIMEOUT\)\.\n {2}- Resolution: accepted on attempt 2\./);

        // the appendix is the definition itself: the recipe alone rebuilds the workflow
        const appendix = recipe.slice(recipe.indexOf('## Appendix: workflow definition'));
        const definition = JSON.parse(appendix.slice(appendix.indexOf('```json') + 7, appendix.lastIndexOf('```')));
        expect(parse_document(definition)).toEqual(wf);
    });

    it('is deterministic', async () => {
        const { wf, events } = await sample_run();
        expect(compile_recipe(wf, events)).toBe(compile_recipe(wf, [...events].reverse()));
    });

    it('can leave out payloads and the definition', async () => {
        const { wf, events } = await sample_run();
        const recipe = compile_recipe(wf, events, { include_payloads: false, include_definition: false });
        expect(recipe).not.toContain('Accepted outcome:');
        expect(recipe).not.toContain('## Appendix');
        expect(recipe).not.toContain('r-1');
    });

    it('describes a failed run and its compensation', async () => {
        const undo = activity('Release stock');
        const reserve = activity('Reserve stock', { compensation: { activity_id: undo.id } });
        const ship = activity('Ship');
        const wf = workflow([reserve, ship, undo], [edge(reserve, ship)]);
        const engine = new WorkflowEngine(wf, { ...scripted({ Ship: new Error('no carrier') }), ...quiet });
        await engine.start();
        await engine.run();
        const recipe = compile_recipe(wf, await engine.getEvents());
        expect(recipe).toMatch(/which failed in/);
        expect(recipe).toContain('**Reserve stock** was undone by Release stock.');
        expect(recipe).toContain('The run failed at **Ship**: no carrier');
        expect(recipe).toContain('- **If the run later fails**: undone by **Release stock**');
    });

    it('works from the definition alone', async () => {
        const { wf } = await sample_run();
        const recipe = compile_recipe(wf, []);
        expect(recipe).toContain('no run journal was supplied');
        expect(recipe).toContain('### Step 1: Reserve stock');
    });

    it('derives the conformance levels a workflow needs', async () => {
        const { wf } = await sample_run();
        expect(required_levels(wf)).toEqual(['document', 'core', 'resilient', 'contract', 'flow']);
    });

    it('matches the published claims-settlement example', () => {
        const dir = path.resolve(__dirname, '../../../examples/claims-settlement');
        const wf = parse_document(JSON.parse(fs.readFileSync(path.join(dir, 'claims-settlement.awa.json'), 'utf-8')));
        const events = parse_journal(fs.readFileSync(path.join(dir, 'runs/completed.journal.jsonl'), 'utf-8'));
        expect(compile_recipe(wf, events) + '\n').toBe(fs.readFileSync(path.join(dir, 'RECIPE.md'), 'utf-8'));
    });
});
