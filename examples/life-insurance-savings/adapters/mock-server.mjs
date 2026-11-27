// The reference adapters of the workplace pension savings example: one small HTTP server that stands in
// for every system the workflows call (INTEGRATION.md lists them), with plausible, deterministic answers.
// It needs nothing beyond Node.
//
//   node examples/life-insurance-savings/adapters/mock-server.mjs [--port 4560]
//
// The tools of the workflows point at http://localhost:4560. Port 0 picks a free port; the first line
// written to standard output says where the server listens. An insurer replaces each route with its own
// system and changes the tool's URL (README.md, "Taking it into production").
//
// The adapters keep no state: what a lookup returns for an employee or a document named in scenarios/*.json
// is that scenario's `world`; anything else gets a default derived from the identifier, so the answers are
// the same every time for the same request. Where a real system would remember a total (the premiums paid in
// the year), the caller passes the total so far.
//
// The insurer, the employer, the custodian bank, the funds and the people are fictional. The fund figures
// (summary risk indicators, fees, returns) are EXAMPLES, not any fund's.

import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const here = path.dirname(fileURLToPath(import.meta.url));
export const DEFAULT_PORT = 4560;

/** The scenarios' worlds, by enrolment id, and the documents they name */
function load_worlds(directory = path.join(here, '../scenarios')) {
    const by_enrolment = new Map(), documents = new Map();
    for (const file of fs.readdirSync(directory).filter(f => /^[a-z]-.*\.json$/.test(f)).sort()) {
        const scenario = JSON.parse(fs.readFileSync(path.join(directory, file), 'utf-8'));
        const world = scenario.world || {};
        by_enrolment.set(scenario.invitation.enrolment_id, world);
        for (const [id, document] of Object.entries(world.documents || {})) documents.set(id, document);
    }
    return { by_enrolment, documents };
}

/** The digits an identifier ends with: ENR-26001, VL-26001 and DED-26001 all give 26001 */
const number_of = id => (String(id ?? '').match(/(\d+)(?!.*\d)/) || [, '00000'])[1];
/** A small stable hash, for defaults */
const hash = text => [...String(text)].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7);
const round1 = n => Math.round(n * 10) / 10;
const round2 = n => Math.round(n * 100) / 100;
const day = offset_days => new Date(Date.now() + offset_days * 86_400_000).toISOString().slice(0, 10);
const month = () => new Date(Date.now()).toISOString().slice(0, 7);

export const CUSTODIAN = 'Banque Ardenne de Dépôt S.A. (fictional custodian bank)';

/** The plan Valoria Life runs for Kestrel Engineering. The tax figures are those of the decision table "Deduction rules" (FACTS.md). */
const PLANS = {
    'KES-PENSION-111BIS': {
        plan_id: 'KES-PENSION-111BIS', product: 'Valoria Pension Plan', insurer: 'Valoria Life S.A. (fictional)', employer: 'Kestrel Engineering S.à r.l. (fictional)',
        contract_type: 'pension_savings', tax_article: 'Art. 111bis LIR', deduction_ceiling_eur: 4500, ceiling_from_tax_year: 2026, ceiling_basis: 'per taxpayer',
        minimum_duration_years: 10, payout_from_age: 60, payout_until_age: 75, subscription_before_age: 65,
        entry_fee_pct: 0, management_fee_pct_per_year: 0.85, right_to_cancel_days: 30, refund_on_cancellation: 'every premium paid, in full',
        custodian_bank: CUSTODIAN, supervisor: 'Commissariat aux Assurances',
        investment_risk: 'The value of unit-linked funds goes up and down; the return is not guaranteed and the employee bears the investment risk.',
    },
};

// The plan's fund range: EXAMPLE figures. SRI is the summary risk indicator of each fund's key information document, 1 to 7.
export const FUNDS = {
    'VL-MM-EUR': { name: 'Valoria Euro Money Market', sri: 1, sfdr_article: 8, ongoing_charges_pct: 0.25 },
    'VL-BOND-EUR': { name: 'Valoria Euro Government Bonds', sri: 2, sfdr_article: 6, ongoing_charges_pct: 0.35 },
    'VL-BOND-GREEN': { name: 'Valoria Green Bonds', sri: 3, sfdr_article: 9, ongoing_charges_pct: 0.45 },
    'VL-MIX-BAL': { name: 'Valoria Balanced Multi-Asset', sri: 3, sfdr_article: 8, ongoing_charges_pct: 0.75 },
    'VL-EQ-WORLD-ESG': { name: 'Valoria World Equity ESG', sri: 4, sfdr_article: 8, ongoing_charges_pct: 0.65 },
    'VL-EQ-EUROPE': { name: 'Valoria Europe Equity', sri: 4, sfdr_article: 6, ongoing_charges_pct: 0.7 },
    'VL-EQ-CLIMATE': { name: 'Valoria Climate Transition Equity', sri: 5, sfdr_article: 9, ongoing_charges_pct: 0.85 },
    'VL-EQ-EM': { name: 'Valoria Emerging Markets Equity', sri: 5, sfdr_article: 6, ongoing_charges_pct: 0.9 },
    'VL-EQ-TECH': { name: 'Valoria Global Technology Equity', sri: 6, sfdr_article: 6, ongoing_charges_pct: 0.95 },
};
export const MODEL_PORTFOLIOS = {
    cautious: [{ fund_id: 'VL-MM-EUR', percent: 30 }, { fund_id: 'VL-BOND-EUR', percent: 70 }],
    moderate: [{ fund_id: 'VL-BOND-EUR', percent: 30 }, { fund_id: 'VL-BOND-GREEN', percent: 40 }, { fund_id: 'VL-MIX-BAL', percent: 30 }],
    balanced: [{ fund_id: 'VL-BOND-GREEN', percent: 30 }, { fund_id: 'VL-MIX-BAL', percent: 30 }, { fund_id: 'VL-EQ-WORLD-ESG', percent: 40 }],
    dynamic: [{ fund_id: 'VL-EQ-WORLD-ESG', percent: 50 }, { fund_id: 'VL-EQ-CLIMATE', percent: 30 }, { fund_id: 'VL-EQ-EUROPE', percent: 20 }],
};
const kid_of = fund_id => ({ fund_id, kid_id: `KID-${fund_id}-2026`, kid_url: `https://funds.valoria-life.example/kid/${fund_id}-2026.pdf` });
/** Weighted summary risk indicator of an allocation, to one decimal */
export const portfolio_sri = allocation => round1(allocation.reduce((sum, a) => sum + (FUNDS[a.fund_id]?.sri ?? 7) * a.percent, 0) / Math.max(1, allocation.reduce((s, a) => s + a.percent, 0)));

// Formats of tax identification numbers the self-certification check knows. EXAMPLES of format checks only.
const TIN_FORMATS = { LU: /^\d{13}$/, FR: /^[0-3]\d{12}$/, BE: /^\d{11}$/, DE: /^\d{11}$/ };
const DOCUMENT_FIELDS = {
    identity_card: { kind: 'identity card', expires_on: '2031-05-31' },
    passport: { kind: 'passport', expires_on: '2032-09-30' },
    proof_of_address: { kind: 'utility bill' },
};

/**
 * The adapters as a function of a request, without a network: what make-runs.mjs and the tests call.
 * Returns { status, body }. Requests to routes that take a key must carry one (authorization or x-api-key).
 */
export function create_adapters(worlds = load_worlds()) {
    const world_of = id => worlds.by_enrolment.get(`ENR-${number_of(id)}`) || {};
    const keyed = headers => !!(headers.authorization || headers['x-api-key']);
    const ok = body => ({ status: 200, body });
    const created = body => ({ status: 201, body });
    const problem = (status, message) => ({ status, body: { error: message } });

    const routes = [
        ['POST', /^\/policy-admin\/v1\/enrolments$/, (_m, body) => created({ enrolment_id: body.enrolment_id, prospect_id: `P-${number_of(body.enrolment_id)}`, status: 'invited', invitation_open_until: day(28) })],
        ['POST', /^\/portal\/v1\/notifications$/, (_m, body) => created({ message_id: `MSG-${number_of(body.enrolment_id)}-${(hash(`${body.template}|${body.channel}|${body.subject || ''}`) % 9000) + 1000}`, channel: body.channel, status: 'delivered' })],
        ['GET', /^\/policy-admin\/v1\/plans\/([^/]+)$/, m => {
            const plan = PLANS[decodeURIComponent(m[1])];
            return plan ? ok(plan) : problem(404, `No plan ${m[1]}`);
        }],
        ['POST', /^\/advice\/v1\/appointments$/, (_m, body) => created({ appointment_id: `APT-${number_of(body.enrolment_id)}`, slot: body.preferred_slot || `${day(2)}T09:30:00Z`, video_link: `https://meet.valoria-life.example/${number_of(body.enrolment_id)}`, status: 'booked' })],
        ['POST', /^\/portal\/v1\/questionnaires$/, (_m, body) => created({ questionnaire_id: `Q-${number_of(body.enrolment_id)}`, sections: ['demands_and_needs', 'knowledge_and_experience', 'financial_situation', 'objectives', 'sustainability_preferences'], open_until: day(14) })],
        ['POST', /^\/policy-admin\/v1\/enrolments\/([^/]+)\/profile$/, (m, body) => created({ profile_reference: `PRF-${number_of(m[1])}`, risk_profile: body.risk_profile, max_sri: body.max_sri, recorded_on: day(0) })],
        ['GET', /^\/funds\/v1\/plans\/([^/]+)\/funds$/, (m, _b, query) => {
            if (!PLANS[decodeURIComponent(m[1])]) return problem(404, `No plan ${m[1]}`);
            const max = Number(query.get('max_sri')) || 7;
            const funds = Object.entries(FUNDS).map(([fund_id, f]) => ({ fund_id, ...f, within_profile: f.sri <= max, ...kid_of(fund_id) }));
            const portfolios = Object.entries(MODEL_PORTFOLIOS).map(([id, allocation]) => ({ model_portfolio: id, allocation, portfolio_sri: portfolio_sri(allocation), within_profile: portfolio_sri(allocation) <= max }));
            return ok({ plan_id: decodeURIComponent(m[1]), funds, model_portfolios: portfolios });
        }],
        ['POST', /^\/funds\/v1\/suitability-checks$/, (_m, body) => {
            const allocation = body.allocation || [];
            const unknown = allocation.filter(a => !FUNDS[a.fund_id]).map(a => a.fund_id);
            if (unknown.length) return problem(422, `Not in the plan's range: ${unknown.join(', ')}`);
            const sri = portfolio_sri(allocation);
            return ok({ portfolio_sri: sri, max_sri: body.max_sri, sri_excess: round1(sri - body.max_sri), kids_delivered: true,
                funds: allocation.map(a => ({ ...a, sri: FUNDS[a.fund_id].sri, ...kid_of(a.fund_id) })), allocation_total: allocation.reduce((s, a) => s + a.percent, 0) });
        }],
        ['POST', /^\/documents\/v1\/extractions$/, (_m, body) => {
            const known = worlds.documents.get(body.file_id) || {};
            const type = known.document_type || body.document_type;
            const legible = known.legible !== false;
            return ok({ file_id: body.file_id, document_type: type, legible, fields: legible ? { ...(DOCUMENT_FIELDS[type] || {}), ...(known.fields || {}) } : {},
                text: known.text ?? (legible ? `${type.replace(/_/g, ' ')} for enrolment ${body.enrolment_id || ''}`.trim() : ''), pages: known.pages || 1 });
        }],
        ['POST', /^\/screening\/v1\/screenings$/, (_m, body) => {
            const known = world_of(body.enrolment_id).screening;
            return ok({ screening_reference: `SCR-${number_of(body.enrolment_id)}`, result: 'clear', lists: ['pep', 'sanctions', 'adverse_media'], matches: [], ...(known || {}) });
        }],
        ['POST', /^\/kyc\/v1\/self-certifications\/validations$/, (_m, body) => {
            const residences = body.self_certification?.tax_residences || [];
            const problems = residences.filter(r => !(TIN_FORMATS[r.country] || /^.+$/).test(String(r.tin || ''))).map(r => `${r.country}: the tax identification number does not have the expected format`);
            if (!residences.length) problems.push('No country of tax residence');
            return ok({ self_certification_valid: problems.length === 0, problems, us_person: body.self_certification?.us_person === true,
                tax_residences: residences.map(r => r.country), crs_reportable: residences.some(r => r.country !== 'LU') });
        }],
        ['POST', /^\/kyc\/v1\/files$/, (_m, body) => created({ kyc_file_id: `KYC-${number_of(body.enrolment_id)}`, outcome: body.outcome, cdd_level: body.cdd_level, review_due: day(body.cdd_level === 'enhanced' ? 365 : 365 * 3) })],
        ['POST', /^\/esign\/v1\/envelopes$/, (_m, body) => created({ envelope_id: `ENV-${number_of(body.enrolment_id)}`, documents: body.documents, status: 'sent', signing_url: `https://sign.valoria-life.example/${number_of(body.enrolment_id)}` })],
        ['POST', /^\/policy-admin\/v1\/policies$/, (_m, body) => created({ policy_id: `VL-${number_of(body.enrolment_id)}`, status: 'issued', issued_on: day(0), custody_account: `CUST-${number_of(body.enrolment_id)}`, custodian_bank: CUSTODIAN })],
        ['POST', /^\/policy-admin\/v1\/policies\/([^/]+)\/cancellation$/, m => ok({ policy_id: decodeURIComponent(m[1]), status: 'cancelled_from_start', cancelled_on: day(0) })],
        ['POST', /^\/policy-admin\/v1\/policies\/([^/]+)\/premiums$/, (m, body) => created({ premium_id: `PRM-${number_of(m[1])}-${body.period}`, policy_id: decodeURIComponent(m[1]), period: body.period, amount_eur: body.amount_eur,
            tax_year: Number(String(body.period).slice(0, 4)), paid_to_date_eur: round2((body.paid_before_eur || 0) + body.amount_eur) })],
        ['POST', /^\/policy-admin\/v1\/refunds$/, (_m, body) => created({ refund_id: `REF-${number_of(body.policy_id)}`, amount_eur: body.amount_eur, status: 'paid', paid_on: day(0) })],
        ['POST', /^\/policy-admin\/v1\/policies\/([^/]+)\/beneficiary-clause$/, m => ok({ policy_id: decodeURIComponent(m[1]), clause_version: 2, status: 'replaced' })],
        ['POST', /^\/tax\/v1\/deduction-computations$/, (_m, body) => {
            const articles = [body.articles].flat(), ceilings = [body.ceilings_eur].flat(), bases = [body.bases].flat();
            const premiums = body.premiums_eur || 0, planned = (body.monthly_contribution_eur || 0) * (body.months_remaining || 0);
            const lines = articles.map((article, i) => {
                const ceiling = (ceilings[i] || 0) * (bases[i] === 'per_household_member' ? (body.household_members || 1) : 1);
                // The premiums of this plan fall under the first article the table names for its contract
                const own = i === 0 ? premiums : 0, projected = i === 0 ? premiums + planned : 0;
                return { article, ceiling_eur: ceiling, premiums_eur: own, deductible_eur: Math.min(own, ceiling), projected_deductible_eur: Math.min(projected, ceiling), shortfall_eur: Math.max(0, ceiling - projected) };
            });
            const first = lines[0] || { article: null, ceiling_eur: 0, deductible_eur: 0, projected_deductible_eur: 0, shortfall_eur: 0 };
            return ok({ tax_year: body.tax_year, lines, article: first.article, ceiling_eur: first.ceiling_eur, premiums_eur: premiums, projected_premiums_eur: premiums + planned,
                deductible_eur: first.deductible_eur, projected_deductible_eur: first.projected_deductible_eur, shortfall_eur: first.shortfall_eur });
        }],
        ['POST', /^\/tax-certificates\/v1\/certificates$/, (_m, body) => created({ certificate_id: `TC-${body.tax_year}-${number_of(body.policy_id)}`, tax_year: body.tax_year, article: body.article,
            premiums_eur: body.premiums_eur, deductible_eur: body.deductible_eur, issued_on: day(0), document_url: `https://portal.valoria-life.example/certificates/TC-${body.tax_year}-${number_of(body.policy_id)}.pdf` })],
    ];

    const rpc = {
        'payroll.create_deduction': p => ({ deduction_id: `DED-${number_of(p.policy_id)}`, employee_number: p.employee_number, monthly_amount_eur: p.monthly_amount_eur, first_period: month(), status: 'active' }),
        'payroll.stop_deduction': p => ({ deduction_id: p.deduction_id, status: 'stopped', stopped_on: day(0) }),
        'payroll.schedule_one_off': p => ({ one_off_id: `ONE-${number_of(p.policy_id)}-${month()}`, amount_eur: p.amount_eur, period: month(), status: 'scheduled' }),
        'custody.place_order': p => ({ order_id: `ORD-${number_of(p.policy_id)}-${p.period || month()}`, amount_eur: p.amount_eur, status: 'executed', custodian_bank: CUSTODIAN,
            lines: (p.allocation || []).map(a => ({ fund_id: a.fund_id, amount_eur: round2(p.amount_eur * a.percent / 100) })) }),
        'custody.redeem_all': p => ({ redemption_id: `RED-${number_of(p.policy_id)}`, status: 'executed', custodian_bank: CUSTODIAN }),
        'custody.switch': p => ({ switch_id: `SWT-${number_of(p.policy_id)}-${month()}`, allocation: p.allocation, portfolio_sri: portfolio_sri(p.allocation || []), status: 'executed' }),
        'custody.get_position': p => {
            const known = world_of(p.policy_id).position || {};
            const premiums = p.premiums_eur || 0;
            const performance = known.performance_pct ?? round1(((hash(p.policy_id) % 90) - 30) / 10);
            return { policy_id: p.policy_id, as_of: day(0), premiums_eur: premiums, value_eur: round2(premiums * (1 + performance / 100)), performance_pct: performance,
                drift_pp: known.drift_pp ?? round1((hash(`${p.policy_id}|drift`) % 40) / 10), custodian_bank: CUSTODIAN };
        },
    };

    /** One request: method, path with query, lower-case headers, parsed JSON body */
    return function handle(method, url, headers = {}, body = {}) {
        const { pathname, searchParams } = new URL(url, 'http://adapters');
        if (method === 'GET' && pathname === '/health') return ok({ status: 'ok' });
        if (method === 'POST' && /\/rpc$/.test(pathname)) {
            const call = rpc[body?.method];
            if (!call) return ok({ jsonrpc: '2.0', id: body?.id ?? null, error: { code: -32601, message: `Method not found: ${body?.method}` } });
            return ok({ jsonrpc: '2.0', id: body.id ?? null, result: call(body.params || {}) });
        }
        for (const [verb, pattern, answer] of routes) {
            const match = pathname.match(pattern);
            if (!match || verb !== method) continue;
            if (!keyed(headers)) return problem(401, 'This adapter expects an authorization or x-api-key header');
            return answer(match, body || {}, searchParams);
        }
        return problem(404, `No route ${method} ${pathname}`);
    };
}

/** Start the adapters on a port (0: any free port). Resolves to the http.Server once it listens. */
export function start_adapters(port = DEFAULT_PORT, host = '127.0.0.1') {
    const handle = create_adapters();
    const server = http.createServer((req, res) => {
        let text = '';
        req.on('data', chunk => { text += chunk; });
        req.on('end', () => {
            let body = {};
            try { body = text ? JSON.parse(text) : {}; } catch { body = {}; }
            const answer = handle(req.method, req.url, req.headers, body);
            res.writeHead(answer.status, { 'content-type': 'application/json' });
            res.end(JSON.stringify(answer.body));
        });
    });
    return new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(port, host, () => resolve(server));
    });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    const at = process.argv.indexOf('--port');
    const server = await start_adapters(at > 0 ? Number(process.argv[at + 1]) : DEFAULT_PORT);
    console.log(`AWA reference adapters listening on http://localhost:${server.address().port}`);
    const stop = () => server.close(() => process.exit(0));
    process.on('SIGINT', stop);
    process.on('SIGTERM', stop);
}
