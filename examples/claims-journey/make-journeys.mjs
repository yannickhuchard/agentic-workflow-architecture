// Plays six customers through three journeys on a simulated clock: buying a
// motor policy, making a claim on it, and the renewal a year later. Writes what
// happened to journeys.json: every journey record and every run's journal.
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
const purchase = parse_document(read('policy-purchase.awa.json'));
const renewal = parse_document(read('policy-renewal.awa.json'));
const journeys = ['policy-purchase', 'motor-claim', 'policy-renewal'].map(name => JourneyDefinitionSchema.parse(read(`${name}.journey.json`)));

const MIN = 60 * 1000, HOUR = 60 * MIN, DAY = 24 * HOUR;
let now = Date.parse('2026-03-02T09:00:00Z');
const spend = ms => { now += ms; };
/** The customer whose story is being played: scripted actors read it */
let story = {};

const model = (id, tier) => ({ id, provider: 'acme', requested: `tier:${tier}`, tier, source: 'role', temperature: 0.2 });
const pending = task => ({ _requires_human_action: true, _human_task_id: task });

const agent = (output, tier, model_id, rationale, plan) => ({ output, usage: { input_tokens: 480, output_tokens: 80 }, _model: model(model_id, tier), _reasoning: { plan, rationale, confidence: 0.9 } });

const script = {
    // --- Policy purchase ---
    'Prepare quote': () => {
        spend(5 * MIN);
        return agent({ quote_id: `Q-${story.n}`, premium: story.premium, message: `Dear ${story.name}, comprehensive cover for your ${story.vehicle} is EUR ${story.premium} a year. The quote is valid for 7 days.` },
            'reasoning', 'assessor-large', `Priced from the vehicle and ${story.history}.`, ['Read the vehicle and the driver history', 'Apply the tariff', 'State the price and how long it holds']);
    },
    'Send contract': () => { spend(2 * MIN); return { contract_id: `CT-${story.n}`, message: `Dear ${story.name}, your insurance contract is ready to sign.` }; },
    'Send invoice': () => { spend(1 * MIN); return { invoice_id: `INV-${story.n}`, amount_due: story.premium, message: `Dear ${story.name}, please pay EUR ${story.premium} to start your cover.` }; },
    'Issue certificate': () => { spend(2 * MIN); return { receipt_id: `RC-${story.n}`, certificate_id: `CERT-${story.n}`, policy_number: story.policy, covered: true, message: `Dear ${story.name}, you are covered. Your receipt and certificate of insurance are attached.` }; },
    'Expire quote': () => { spend(20 * 1000); return { covered: false, quote_expired: true }; },

    // --- Policy renewal ---
    'Send renewal offer': (inputs) => {
        spend(3 * MIN);
        const change = Number(inputs.premium_change_percent), premium = Math.round(story.premium * (1 + change / 100));
        return agent({ renewal_offer_sent: true, invoice_id: `INV-R${story.n}`, new_premium: premium, message: `Dear ${story.name}, your cover ends in 30 days. To renew, the premium is EUR ${premium} (${change > 0 ? '+' : ''}${change}%: ${inputs.terms_reason}).` },
            'balanced', 'writer-medium', 'A renewal offer should give the price and the reason for any change.', ['State when cover ends', 'State the new premium', 'Give the reason for the change']);
    },
    'Send last reminder': () => { spend(2 * MIN); return agent({ reminder_sent: true, message: `Dear ${story.name}, your cover ends in 9 days. Pay the renewal to stay insured.` }, 'balanced', 'writer-medium', 'A last reminder should say what is lost and when.', ['State the date cover ends', 'State what to do']); },
    'Issue renewal certificate': () => { spend(2 * MIN); return { receipt_id: `RC-R${story.n}`, certificate_id: `CERT-R${story.n}`, renewed: true, message: `Dear ${story.name}, your policy is renewed. Your receipt and new certificate are attached.` }; },
    'Lapse policy': () => { spend(1 * MIN); return { renewed: false, lapsed: true, message: `Dear ${story.name}, your motor cover has ended because the renewal was not paid.` }; },

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
});
for (const workflow of [purchase, intake, settlement, followUp, renewal]) runtime.register_workflow(workflow);
for (const journey of journeys) runtime.register_journey(journey);

const say = (type, data = {}, source = '/customer-portal') => runtime.publish(business_event(type, { customer_id: story.id, ...data }, { source, time: new Date(now).toISOString() }));
const waiting_human = () => runtime.list_runs().flatMap(run => run.getTokens().filter(t => t.status === 'waiting' && !t.getData('_awaiting_event')).map(token => ({ run, token })));
const answer_human = async (output) => { const [w] = waiting_human(); await runtime.resume(w.run.getRunId(), w.token.id, output); };

const customers = [
    {   // Everything goes as hoped, three times
        id: 'cust-1041', n: '1041', name: 'J. Moreau', persona: 'Organised commuter. Answers the same day and expects the same.', claim_id: 'CLM-2041', policy: 'POL-77310', start: 0,
        premium: 640, history: 'eight years without a claim',
        description: 'Hit from behind at a junction; rear bumper and tailgate damaged.', vehicle: '2021 hatchback',
        parts: ['rear bumper', 'tailgate'], prices: { 'rear bumper': 1150, tailgate: 1400 }, cost: 3200, fraud: 0.12, assess_stumbles: true, fraud_service_flaky: true,
        buy: async () => { spend(2 * HOUR); await accept(); spend(1 * DAY); await sign(); spend(3 * HOUR); await pay(); },
        play: async () => {
            spend(1 * DAY + 3 * HOUR); await say('documents.uploaded', { documents: 3 });
            spend(2 * DAY); await say('survey.answered', { satisfaction: 5, comment: 'Quick and clear.' });
        },
        claims_paid: 1, last_satisfaction: 5,
        renew: async () => { spend(2 * DAY); await say('renewal.paid', { renewal_paid: true }, '/payment-gateway'); },
    },
    {   // A large claim: no rule covers it, a model sends it to an adjuster, the wait costs the customer
        id: 'cust-2210', n: '2210', name: 'A. Okafor', persona: 'Busy contractor who needs the car for work. Every day without it costs money.', claim_id: 'CLM-2044', policy: 'POL-51902', start: 1 * DAY,
        premium: 910, history: 'a new driver record in this country',
        description: 'Side impact on a roundabout; both left doors and the sill damaged.', vehicle: '2023 estate',
        parts: ['front left door', 'rear left door'], prices: { 'front left door': 2900, 'rear left door': 2700 }, cost: 8200, fraud: 0.45,
        buy: async () => { spend(20 * MIN); await accept(); spend(1 * HOUR); await sign(); spend(10 * MIN); await pay(); },
        play: async () => {
            spend(6 * HOUR); await say('documents.uploaded', { documents: 3 });
            spend(3 * DAY); await answer_human({ approved: true, adjuster_note: 'Costs match the photos. Approved.' });
            spend(4 * DAY); await say('survey.answered', { satisfaction: 2, comment: 'It took too long to hear back.' });
            spend(1 * DAY); await answer_human({ followed_up: true, callback_outcome: 'Apologised for the delay; offered a courtesy car next time.' });
        },
        claims_paid: 1, last_satisfaction: 2,
        // Offered a goodwill discount, and still leaves: the renewal goes unpaid and the policy lapses
        renew: async () => { spend(21 * DAY + HOUR); await runtime.tick(); spend(9 * DAY + HOUR); await runtime.tick(); },
    },
    {   // Slow with paperwork: the claim documents never arrive
        id: 'cust-3387', n: '3387', name: 'L. Petit', persona: 'Retired, not at ease online. Prefers a letter or a call to a portal.', claim_id: 'CLM-2047', policy: 'POL-20455', start: 2 * DAY,
        premium: 520, history: 'forty years of driving, one small claim',
        description: 'Scraped a bollard in a car park; front wing dented.', vehicle: '2019 saloon',
        parts: ['front wing'], prices: { 'front wing': 780 }, cost: 1100, fraud: 0.08,
        buy: async () => { spend(1 * DAY); await accept(); spend(4 * DAY); await sign(); spend(1 * DAY); await pay(); },
        play: async () => { spend(5 * DAY + HOUR); await runtime.tick(); spend(5 * DAY + HOUR); await runtime.tick(); },
        claims_paid: 0,
        renew: async () => { spend(21 * DAY + HOUR); await runtime.tick(); spend(3 * DAY); await say('renewal.paid', { renewal_paid: true }, '/payment-gateway'); },
    },
    {   // Changes their mind about the claim; stays a customer
        id: 'cust-4102', n: '4102', name: 'S. Lindqvist', persona: 'Compares everything first. Uses the cheapest route, including the warranty.', claim_id: 'CLM-2050', policy: 'POL-88120', start: 3 * DAY,
        premium: 780, history: 'three years without a claim',
        description: 'Windscreen cracked by a stone on the motorway.', vehicle: '2022 SUV',
        parts: ['windscreen'], prices: { windscreen: 640 }, cost: 800, fraud: 0.05,
        buy: async () => { spend(3 * HOUR); await accept(); spend(2 * HOUR); await sign(); spend(3 * DAY); await pay(); },
        play: async () => { spend(2 * DAY); await say('claim.withdrawn', { reason: 'Repaired under the manufacturer warranty instead.' }); },
        claims_paid: 0,
        renew: async () => { spend(1 * DAY); await say('renewal.paid', { renewal_paid: true }, '/payment-gateway'); },
    },
    {   // The bank rejects the claim payment; nobody puts it right; the customer cancels
        id: 'cust-5519', n: '5519', name: 'R. Haddad', persona: 'Changed bank during the year. Does not chase; votes with their feet.', claim_id: 'CLM-2052', policy: 'POL-34077', start: 4 * DAY,
        premium: 560, history: 'five years without a claim',
        description: 'Reversed into a gate post; rear bumper cracked.', vehicle: '2020 hatchback',
        parts: ['rear bumper'], prices: { 'rear bumper': 1150 }, cost: 1650, fraud: 0.1, payment_fails: true,
        buy: async () => { spend(1 * HOUR); await accept(); spend(1 * DAY); await sign(); spend(2 * HOUR); await pay(); },
        play: async () => { spend(1 * DAY); await say('documents.uploaded', { documents: 2 }); spend(11 * DAY); await runtime.tick(); },
        claims_paid: 0,
        renew: async () => { spend(4 * DAY); await say('policy.cancelled', { reason: 'Still not paid for the claim made in September.' }, '/contact-centre'); },
    },
    {   // Takes their time over everything, says little, stays
        id: 'cust-6034', n: '6034', name: 'M. Castellano', persona: 'Owner of a cherished coupé. Decides slowly and ignores surveys.', claim_id: 'CLM-2055', policy: 'POL-66231', start: 5 * DAY,
        premium: 1150, history: 'a high-value vehicle and a clean record',
        description: 'Hail damage to the bonnet and roof.', vehicle: '2018 coupé',
        parts: ['bonnet'], prices: { bonnet: 1900 }, cost: 2600, fraud: 0.15,
        buy: async () => { spend(6 * DAY); await accept(); spend(1 * DAY); await sign(); spend(1 * DAY); await pay(); },
        play: async () => { spend(8 * HOUR); await say('documents.uploaded', { documents: 3 }); spend(14 * DAY + HOUR); await runtime.tick(); },
        claims_paid: 1,
        renew: async () => { spend(10 * DAY); await say('renewal.paid', { renewal_paid: true }, '/payment-gateway'); },
    },
];
const accept = () => say('quote.accepted', { quote_accepted: true, quote_id: `Q-${story.n}` });
const sign = () => say('contract.signed', { signed: true, contract_id: `CT-${story.n}` }, '/e-signature');
const pay = () => say('payment.received', { amount: story.premium }, '/payment-gateway');

// Three chapters of each customer's life with the insurer, months apart
const chapters = [
    { at: '2026-03-02T09:00:00Z', begin: c => say('quote.requested', { name: c.name, vehicle: c.vehicle }), then: c => c.buy() },
    { at: '2026-09-01T08:00:00Z', begin: c => say('claim.submitted', { name: c.name, description: c.description, vehicle: c.vehicle, policy_number: c.policy }), then: c => c.play() },
    { at: '2027-02-01T08:00:00Z', begin: c => say('renewal.due', { name: c.name, policy_number: c.policy, premium: c.premium, claims_paid: c.claims_paid, ...(c.last_satisfaction ? { last_satisfaction: c.last_satisfaction } : {}) }, '/policy-administration'), then: c => c.renew() },
];
let latest = now;
for (const chapter of chapters) {
    for (const customer of customers) {
        story = customer;
        now = Date.parse(chapter.at) + customer.start;
        await chapter.begin(customer);
        await chapter.then(customer);
        latest = Math.max(latest, now);
    }
}
now = latest;

const sample = {
    as_of: new Date(now).toISOString(),
    customers: customers.map(c => ({ id: c.id, name: c.name, persona: c.persona, vehicle: c.vehicle })),
    workflows: [purchase, intake, settlement, followUp, renewal],
    transitions: runtime.transitions(),
    journeys: [],
};
let events = 0;
for (const journey of journeys) {
    const instances = [];
    for (const instance of runtime.list_journey_instances(journey.id)) {
        const bundle = await runtime.export_journey(instance.id);
        const customer = customers.find(c => c.id === instance.subject_key);
        instances.push({ subject_name: customer.name, summary: journey.name === 'Motor Claim' ? customer.description : journey.name === 'Policy Purchase' ? `Comprehensive cover for a ${customer.vehicle}.` : `Renewal of policy ${customer.policy}.`, instance: bundle.instance, runs: bundle.runs });
        events += instance.events.length + bundle.runs.reduce((n, r) => n + r.events.length, 0);
        console.log(`${journey.name.padEnd(16)} ${customer.name.padEnd(14)} ${instance.status.padEnd(10)} stage=${instance.stage_id.padEnd(12)} mood=${String(instance.sentiment).padEnd(5)} touchpoints=${String(instance.events.filter(e => e.type === 'journey.touchpoint').length).padEnd(3)} ${instance.stalled ? 'STALLED ' : ''}runs=${instance.runs.map(r => r.status).join(',')}`);
    }
    sample.journeys.push({ definition: journey, analytics: runtime.analytics(journey.id), instances });
}
fs.writeFileSync(path.join(here, 'journeys.json'), JSON.stringify(sample, null, 1) + '\n');
console.log(`\n${sample.journeys.reduce((n, j) => n + j.instances.length, 0)} journeys of ${customers.length} customers, ${events} events`);
console.log('moves between journeys:', sample.transitions.map(t => `${journeys.find(j => j.id === t.from).name} -> ${journeys.find(j => j.id === t.to).name}: ${t.count}`).join('; '));
