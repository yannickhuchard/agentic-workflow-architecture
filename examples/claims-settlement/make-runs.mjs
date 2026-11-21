// Produces the sample runs of this example: their journals, their recipes,
// and the sample data for tools/visualization/replay.html.
//
//   cd sdk/typescript && npm install && npm run build
//   node examples/claims-settlement/make-runs.mjs
//
// The actors are scripted, so no API key is needed and the runs are repeatable
// in shape. An AI agent's first damage assessment deliberately breaks its
// outcome contract, and the first fraud check times out, to show recovery.

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { WorkflowEngine, parse_document, FileJournalStore, parse_journal, compile_recipe, KnowledgeBase } from '../../sdk/typescript/dist/index.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const workflow = parse_document(JSON.parse(fs.readFileSync(path.join(here, 'claims-settlement.awa.json'), 'utf-8')));
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const model = (id, tier) => ({ id, provider: 'acme', requested: `tier:${tier}`, tier, source: 'role', temperature: 0.2 });

function actors(scenario) {
    const script = {
        'Register claim': async () => { await wait(250); return { claim_id: 'CLM-2041', policy_number: 'POL-77310' }; },

        'Assess damage': async (inputs) => {
            await wait(900);
            if (inputs._attempt === 1) {
                return {
                    output: { estimated_cost: 'about 3,200 EUR', severity: 'moderate', summary: 'Rear bumper and tailgate damaged.' },
                    usage: { input_tokens: 1840, output_tokens: 210 }, _model: model('assessor-large', 'reasoning'),
                    _reasoning: {
                        plan: ['Read the claim description', 'List damaged parts', 'Estimate the cost'],
                        rationale: 'Rear-end collision at low speed; the damage is limited to the bumper and tailgate.',
                        alternatives_considered: ['Total loss: rejected, the chassis is intact'], confidence: 0.6,
                    },
                };
            }
            return {
                output: {
                    estimated_cost: 3200, severity: 'moderate',
                    summary: 'Low-speed rear-end collision. Rear bumper and tailgate need replacing; no structural damage.',
                    parts: [{ part: 'rear bumper', cost: 1150 }, { part: 'tailgate', cost: 1400 }, { part: 'labour and paint', cost: 650 }],
                },
                usage: { input_tokens: 2010, output_tokens: 340 }, _model: model('assessor-large', 'reasoning'),
                _reasoning: {
                    plan: ['Re-read the contract feedback', 'Price each part from the repair catalogue', 'Sum parts and labour', 'Return the cost as a number'],
                    rationale: 'The first answer gave the cost as text. Itemising the parts gives a numeric total of 3,200 EUR and satisfies the schema.',
                    alternatives_considered: ['Repair rather than replace the tailgate: rejected, the crease runs through the lock housing'], confidence: 0.86,
                },
            };
        },

        'Check fraud signals': async (inputs) => {
            await wait(600);
            if (inputs._attempt === 1) throw Object.assign(new Error('Fraud scoring service timed out'), { code: 'TIMEOUT' });
            return {
                output: { fraud_score: scenario.fraud_score, signals: scenario.fraud_score > 0.5 ? ['claim filed 3 days after policy start'] : [] },
                usage: { input_tokens: 950, output_tokens: 80 }, _model: model('classifier-small', 'fast'),
                _reasoning: {
                    plan: ['Compare claim date with policy start', 'Check prior claims', 'Check repairer against watchlist'],
                    rationale: scenario.fraud_score > 0.5 ? 'The claim was filed days after the policy started.' : 'Policy held for four years, one prior claim, repairer not on the watchlist.',
                    confidence: 0.9,
                },
            };
        },

        'Verify policy cover': async () => { await wait(400); return { cover_confirmed: true, excess: 250 }; },
        'Consolidate findings': async (inputs) => {
            await wait(200);
            return { settlement_amount: inputs.estimated_cost - inputs.excess };
        },
        'Reserve funds': async (inputs) => { await wait(300); return { reservation_id: 'RSV-90112', reserved: inputs.settlement_amount }; },
        'Pay claimant': async (inputs) => {
            await wait(500);
            if (scenario.payment_fails) throw Object.assign(new Error('Bank rejected the transfer: account closed'), { code: 'VALIDATION_ERROR' });
            return { payment_id: 'PAY-55018', paid: inputs.reserved };
        },
        'Notify claimant': async () => {
            await wait(700);
            return {
                output: { message: 'Your claim CLM-2041 has been settled. EUR 2,950 has been paid to your account.' },
                usage: { input_tokens: 620, output_tokens: 95 }, _model: model('writer-medium', 'balanced'),
                _reasoning: { plan: ['State the outcome', 'State the amount', 'Keep it short'], rationale: 'A settlement notice should lead with the result.', confidence: 0.95 },
            };
        },
        'Release funds': async () => { await wait(300); return { released: true, reservation_id: 'RSV-90112' }; },
        'Adjuster review': async () => ({ approved: true }),
        'Investigate': async () => ({ investigation_opened: true }),
    };
    const actor = { execute: (activity, inputs) => script[activity.name](inputs) };
    return { application: actor, ai_agent: actor, human: actor, robot: actor };
}

async function run(name, scenario) {
    const file = path.join(here, 'runs', `${name}.journal.jsonl`);
    fs.rmSync(file, { force: true });
    const engine = new WorkflowEngine(workflow, {
        actors: actors(scenario),
        journal: new FileJournalStore(file),
        execution_logger: { log_execution: async () => { } },
        pricing_config: { input_token_cost_per_1k: 0.003, output_token_cost_per_1k: 0.015, currency: 'EUR', software_cost_per_execution: 0.001 },
    });
    await engine.start({ claimant: 'J. Moreau', description: 'Hit from behind at a junction; rear bumper and tailgate damaged.', vehicle: '2021 hatchback' });
    const status = await engine.run();
    const events = parse_journal(fs.readFileSync(file, 'utf-8'));
    console.log(`${name}: ${status}, ${events.length} events`);
    return { name, status, events };
}

const completed = await run('completed', { fraud_score: 0.12 });
const failed = await run('failed-and-compensated', { fraud_score: 0.12, payment_fails: true });

fs.writeFileSync(path.join(here, 'RECIPE.md'), compile_recipe(workflow, completed.events) + '\n');
fs.writeFileSync(path.join(here, 'runs', 'failed-and-compensated.recipe.md'),
    compile_recipe(workflow, failed.events, { include_definition: false }) + '\n');

// Knowledge distilled from both runs, with the damage-assessment entries
// reviewed, exported as an Open Knowledge Format bundle.
const knowledge = new KnowledgeBase();
knowledge.ingest(workflow, completed.events);
knowledge.ingest(workflow, failed.events);
for (const entry of knowledge.list()) {
    if (entry.scope.node_name === 'Assess damage') knowledge.review(entry.id, 'claims-lead');
}
fs.rmSync(path.join(here, 'knowledge'), { recursive: true, force: true });
const written = await knowledge.export_okf(path.join(here, 'knowledge'), { title: 'Motor claim settlement knowledge' });
console.log(`knowledge: ${knowledge.list().length} entries, ${written} files`);

const samples = [
    { name: 'Motor claim: settled', workflow, events: completed.events },
    { name: 'Motor claim: payment failed, funds released', workflow, events: failed.events },
];
fs.writeFileSync(path.join(here, '../../tools/visualization/replay-sample.js'),
    '// Generated by examples/claims-settlement/make-runs.mjs. Do not edit.\n'
    + `window.AWA_SAMPLES = ${JSON.stringify(samples)};\n`);
