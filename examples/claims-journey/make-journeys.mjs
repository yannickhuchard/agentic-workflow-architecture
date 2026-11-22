// Runs six customers through the Motor Claim journey on a simulated clock and
// writes what happened: journeys.json here, and the same data as a script
// (tools/visualization/journey-sample.js) for a visualisation to load.
//
//   cd sdk/typescript && npm install && npm run build
//   node examples/claims-journey/make-journeys.mjs
//
// Actors, tools and the model are scripted, so no API key is needed. Each
// customer's story is chosen to show a different shape of journey.

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { AwaRuntime, parse_document, JourneyDefinitionSchema, FunctionModelProvider, business_event } from '../../sdk/typescript/dist/index.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const read = file => JSON.parse(fs.readFileSync(path.join(here, file), 'utf-8'));
const intake = parse_document(read('claim-intake.awa.json'));
const settlement = parse_document(read('../claims-settlement/claims-settlement.awa.json'));
const followUp = parse_document(read('customer-follow-up.awa.json'));
const journey = JourneyDefinitionSchema.parse(read('motor-claim.journey.json'));

const MIN = 60 * 1000, HOUR = 60 * MIN, DAY = 24 * HOUR;
let now = Date.parse('2026-09-01T08:00:00Z');
const spend = ms => { now += ms; };
/** The customer whose story is being played: scripted actors read it */
let story = {};

const model = (id, tier) => ({ id, provider: 'acme', requested: `tier:${tier}`, tier, source: 'role', temperature: 0.2 });
const pending = task => ({ _requires_human_action: true, _human_task_id: task });

const script = {
    // --- Claim intake ---
    'Register claim': () => { spend(40 * 1000); return { claim_id: story.claim_id, policy_number: story.policy }; },
    'Request documents': () => {
        spend(3 * MIN);
        return {
            output: { documents_requested: ['photos of the damage', 'police report', 'repair quote'], message: `Dear ${story.name}, to assess your claim we need photos of the damage, the police report and a repair quote.` },
            usage: { input_tokens: 540, output_tokens: 90 }, _model: model('writer-medium', 'balanced'),
            _reasoning: { plan: ['Check which documents the claim type needs', 'List only what is missing', 'Keep the message short'], rationale: 'A collision claim needs photos, a police report and a quote; none were attached.', confidence: 0.93 },
        };
    },
    'Send reminder': () => {
        spend(2 * MIN);
        return {
            output: { reminder_sent: true, message: `Dear ${story.name}, we are still waiting for your documents. Your claim will be closed in 5 days without them.` },
            usage: { input_tokens: 480, output_tokens: 70 }, _model: model('writer-medium', 'balanced'),
            _reasoning: { plan: ['State what is missing', 'State the deadline'], rationale: 'A reminder should say what happens next and when.', confidence: 0.9 },
        };
    },
    'Check completeness': () => { spend(20 * 1000); return { documents_complete: true }; },
    'Close as incomplete': () => { spend(20 * 1000); return { documents_complete: false, closed_reason: 'documents never received' }; },

    // --- Claims settlement ---
    'Assess damage': async (inputs, context) => {
        spend(4 * MIN);
        if (inputs._attempt === 1 && story.assess_stumbles) {
            return {
                output: { estimated_cost: `about ${story.cost} EUR`, severity: 'moderate', summary: 'Damage to the rear of the vehicle.' },
                usage: { input_tokens: 1840, output_tokens: 210 }, _model: model('assessor-large', 'reasoning'),
                _reasoning: { plan: ['Read the claim', 'Estimate the cost'], rationale: 'Estimated from the description alone.', confidence: 0.55 },
            };
        }
        const parts = await Promise.all(story.parts.map(part => context.tools.call('price_part', { part, vehicle: inputs.vehicle })));
        spend(3 * MIN);
        return {
            output: {
                estimated_cost: story.cost, severity: story.cost > 5000 ? 'severe' : 'moderate',
                summary: `${story.description} Parts priced from the repair catalogue; no structural damage found.`,
                parts: story.parts.map((part, i) => ({ part, cost: parts[i].result.price })),
            },
            usage: { input_tokens: 2010, output_tokens: 340 }, _model: model('assessor-large', 'reasoning'),
            _reasoning: {
                plan: ['Identify each damaged part', 'Price each part with the catalogue tool', 'Add labour and paint', 'Return the cost as a number'],
                rationale: `Itemised pricing gives a total of ${story.cost} EUR.`,
                alternatives_considered: ['Estimate from the description alone: rejected, the contract needs a numeric, itemised cost'], confidence: 0.88,
            },
        };
    },
    'Check fraud signals': (inputs) => {
        spend(2 * MIN);
        if (inputs._attempt === 1 && story.fraud_service_flaky) throw Object.assign(new Error('Fraud scoring service timed out'), { code: 'TIMEOUT' });
        return {
            output: { fraud_score: story.fraud, signals: story.fraud > 0.3 ? ['second claim in six months'] : [] },
            usage: { input_tokens: 950, output_tokens: 80 }, _model: model('classifier-small', 'fast'),
            _reasoning: { plan: ['Compare claim date with policy start', 'Check prior claims', 'Check the repairer'], rationale: story.fraud > 0.3 ? 'A second claim in six months raises the score a little.' : 'Long-standing policy, clean history.', confidence: 0.9 },
        };
    },
    'Verify policy cover': async (inputs, context) => {
        spend(1 * MIN);
        const policy = (await context.tools.call('get_policy', { policy_number: inputs.policy_number })).result;
        return { cover_confirmed: policy.status === 'active', excess: policy.excess };
    },
    'Consolidate findings': (inputs) => { spend(30 * 1000); return { settlement_amount: inputs.estimated_cost - inputs.excess, estimated_cost: inputs.estimated_cost }; },
    'Adjuster review': () => pending('adjuster-review'),
    'Investigate': () => pending('investigation'),
    'Reserve funds': (inputs) => { spend(1 * MIN); return { reservation_id: `RSV-${story.claim_id.slice(4)}`, reserved: inputs.settlement_amount }; },
    'Pay claimant': async (inputs, context) => {
        spend(2 * MIN);
        const transfer = await context.tools.call('transfer', { amount: inputs.reserved, reference: inputs.claim_id });
        if (!transfer.ok) throw Object.assign(new Error(`Bank rejected the transfer: ${transfer.result.error}`), { code: 'VALIDATION_ERROR' });
        return { payment_id: transfer.result.payment_id, paid: inputs.reserved };
    },
    'Notify claimant': (inputs) => {
        spend(2 * MIN);
        return {
            output: { message: `Dear ${story.name}, your claim ${story.claim_id} has been settled. EUR ${inputs.paid} has been paid to your account.` },
            usage: { input_tokens: 620, output_tokens: 95 }, _model: model('writer-medium', 'balanced'),
            _reasoning: { plan: ['State the outcome', 'State the amount'], rationale: 'A settlement notice should lead with the result.', confidence: 0.95 },
        };
    },
    'Release funds': () => { spend(1 * MIN); return { released: true }; },

    // --- Customer follow-up ---
    'Send survey': () => {
        spend(2 * MIN);
        return {
            output: { survey_sent: true, message: `Dear ${story.name}, how would you rate your claim experience, from 1 to 5?` },
            usage: { input_tokens: 400, output_tokens: 60 }, _model: model('writer-medium', 'balanced'),
            _reasoning: { plan: ['Ask one question', 'Make it easy to answer'], rationale: 'One question gets more answers than a long form.', confidence: 0.9 },
        };
    },
    'Thank customer': () => {
        spend(1 * MIN);
        return { output: { followed_up: true, message: `Thank you, ${story.name}. We are glad it went well.` }, usage: { input_tokens: 300, output_tokens: 40 }, _model: model('writer-medium', 'balanced') };
    },
    'Call back': () => pending('call-back'),
    'Record no response': () => { spend(10 * 1000); return { followed_up: true, no_response: true }; },
};
const actor = { execute: (activity, inputs, context) => script[activity.name](inputs, context) };

const runtime = new AwaRuntime({
    now: () => now,
    engine: {
        actors: { application: actor, ai_agent: actor, human: actor, robot: actor },
        wait_for_human_tasks: true,
        sleep: async ms => { spend(ms); },
        execution_logger: { log_execution: async () => { } },
        pricing_config: { input_token_cost_per_1k: 0.003, output_token_cost_per_1k: 0.015, currency: 'EUR', software_cost_per_execution: 0.001 },
        tools: {
            secrets: { CATALOGUE_KEY: 'demo-key' },
            executors: {
                http: async (binding, args) => {
                    spend(1500);
                    if (binding.url.includes('repair-catalogue')) return { status: 200, result: { part: args.part, price: story.prices[args.part], currency: 'EUR' } };
                    return { status: 200, result: { policy_number: args.policy_number, status: 'active', excess: 250, cover: 'comprehensive' } };
                },
                jsonrpc: async () => {
                    spend(2000);
                    if (story.payment_fails) throw Object.assign(new Error('RPC error -32010: account closed'), { code: 'TOOL_ERROR', status: -32010 });
                    return { status: 200, result: { payment_id: `PAY-${story.claim_id.slice(4)}`, state: 'settled' } };
                },
            },
        },
        model_providers: [new FunctionModelProvider('acme', () => {
            spend(4000);
            return JSON.stringify({ option: 'review', confidence: 0.84, rationale: 'The repair is costly and the fraud score is neither low nor high, so an adjuster should confirm before payment.' });
        })],
        model_tiers: { fast: 'acme:classifier-small', reasoning: 'acme:assessor-large', balanced: 'acme:writer-medium' },
    },
}).register_workflow(intake).register_workflow(settlement).register_workflow(followUp).register_journey(journey);

const say = (type, data, source = '/customer-portal') => runtime.publish(business_event(type, { customer_id: story.id, ...data }, { source, time: new Date(now).toISOString() }));
const waiting_human = () => runtime.list_runs().flatMap(run => run.getTokens().filter(t => t.status === 'waiting' && !t.getData('_awaiting_event')).map(token => ({ run, token })));
const answer_human = async (output) => { const [w] = waiting_human(); await runtime.resume(w.run.getRunId(), w.token.id, output); };

const customers = [
    {   // Everything goes as hoped
        id: 'cust-1041', name: 'J. Moreau', claim_id: 'CLM-2041', policy: 'POL-77310', start: 0,
        description: 'Hit from behind at a junction; rear bumper and tailgate damaged.', vehicle: '2021 hatchback',
        parts: ['rear bumper', 'tailgate'], prices: { 'rear bumper': 1150, tailgate: 1400 }, cost: 3200, fraud: 0.12, assess_stumbles: true, fraud_service_flaky: true,
        play: async () => {
            spend(1 * DAY + 3 * HOUR); await say('documents.uploaded', { documents: 3 });
            spend(2 * DAY); await say('survey.answered', { satisfaction: 5, comment: 'Quick and clear.' });
        },
    },
    {   // A large claim: the table has no rule for it, a model routes it to an adjuster, the customer ends up unhappy
        id: 'cust-2210', name: 'A. Okafor', claim_id: 'CLM-2044', policy: 'POL-51902', start: 1 * DAY,
        description: 'Side impact on a roundabout; both left doors and the sill damaged.', vehicle: '2023 estate',
        parts: ['front left door', 'rear left door'], prices: { 'front left door': 2900, 'rear left door': 2700 }, cost: 8200, fraud: 0.45,
        play: async () => {
            spend(6 * HOUR); await say('documents.uploaded', { documents: 3 });
            spend(3 * DAY); await answer_human({ approved: true, adjuster_note: 'Costs match the photos. Approved.' });
            spend(4 * DAY); await say('survey.answered', { satisfaction: 2, comment: 'It took too long to hear back.' });
            spend(1 * DAY); await answer_human({ followed_up: true, callback_outcome: 'Apologised for the delay; offered a courtesy car next time.' });
        },
    },
    {   // The documents never arrive: reminder, then closed, and the journey stalls
        id: 'cust-3387', name: 'L. Petit', claim_id: 'CLM-2047', policy: 'POL-20455', start: 2 * DAY,
        description: 'Scraped a bollard in a car park; front wing dented.', vehicle: '2019 saloon',
        parts: ['front wing'], prices: { 'front wing': 780 }, cost: 1100, fraud: 0.08,
        play: async () => { spend(5 * DAY + HOUR); await runtime.tick(); spend(5 * DAY + HOUR); await runtime.tick(); },
    },
    {   // The customer changes their mind while we wait for documents
        id: 'cust-4102', name: 'S. Lindqvist', claim_id: 'CLM-2050', policy: 'POL-88120', start: 3 * DAY,
        description: 'Windscreen cracked by a stone on the motorway.', vehicle: '2022 SUV',
        parts: ['windscreen'], prices: { windscreen: 640 }, cost: 800, fraud: 0.05,
        play: async () => { spend(2 * DAY); await say('claim.withdrawn', { reason: 'Repaired under the manufacturer warranty instead.' }); },
    },
    {   // The bank rejects the payment: the reserved funds are released and the journey is stuck
        id: 'cust-5519', name: 'R. Haddad', claim_id: 'CLM-2052', policy: 'POL-34077', start: 4 * DAY,
        description: 'Reversed into a gate post; rear bumper cracked.', vehicle: '2020 hatchback',
        parts: ['rear bumper'], prices: { 'rear bumper': 1150 }, cost: 1650, fraud: 0.1, payment_fails: true,
        play: async () => { spend(1 * DAY); await say('documents.uploaded', { documents: 2 }); spend(11 * DAY); await runtime.tick(); },
    },
    {   // Paid without trouble, then silence: the survey times out
        id: 'cust-6034', name: 'M. Castellano', claim_id: 'CLM-2055', policy: 'POL-66231', start: 5 * DAY,
        description: 'Hail damage to the bonnet and roof.', vehicle: '2018 coupé',
        parts: ['bonnet'], prices: { bonnet: 1900 }, cost: 2600, fraud: 0.15,
        play: async () => { spend(8 * HOUR); await say('documents.uploaded', { documents: 3 }); spend(14 * DAY + HOUR); await runtime.tick(); },
    },
];

const origin = now;
let latest = now;
for (const customer of customers) {
    story = customer;
    now = origin + customer.start;
    await say('claim.submitted', { name: customer.name, description: customer.description, vehicle: customer.vehicle });
    await customer.play();
    latest = Math.max(latest, now);
}
now = latest;

const instances = [];
for (const instance of runtime.list_journey_instances(journey.id)) {
    const bundle = await runtime.export_journey(instance.id);
    const customer = customers.find(c => c.id === instance.subject_key);
    instances.push({ subject_name: customer.name, summary: customer.description, instance: bundle.instance, runs: bundle.runs });
    const last = instance.events.at(-1);
    console.log(`${customer.name.padEnd(14)} ${instance.status.padEnd(10)} stage=${instance.stage_id.padEnd(12)} runs=${instance.runs.map(r => r.status).join(',').padEnd(34)} ${instance.stalled ? 'STALLED ' : ''}last=${last.type}`);
}

const sample = {
    as_of: new Date(now).toISOString(),
    definition: journey,
    workflows: [intake, settlement, followUp],
    analytics: runtime.analytics(journey.id),
    instances,
};
fs.writeFileSync(path.join(here, 'journeys.json'), JSON.stringify(sample, null, 1) + '\n');
fs.writeFileSync(path.join(here, '../../tools/visualization/journey-sample.js'),
    '// Generated by examples/claims-journey/make-journeys.mjs. Do not edit.\n' + `window.AWA_JOURNEY_SAMPLE = ${JSON.stringify(sample)};\n`);
const events = instances.reduce((n, i) => n + i.instance.events.length + i.runs.reduce((m, r) => m + r.events.length, 0), 0);
console.log(`\n${instances.length} journeys, ${events} events, funnel:`, JSON.stringify(sample.analytics.stages.map(s => `${s.stage_name}: ${s.entered} in, ${s.completed} on, ${s.active} here, ${s.stalled} stalled, ${s.abandoned} left`)));
