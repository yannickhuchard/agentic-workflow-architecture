// The reference adapters of the electricity onboarding example: one small HTTP server that stands in
// for every system the workflow calls (INTEGRATION.md lists them), with plausible, deterministic answers.
// It needs nothing beyond Node.
//
//   node examples/electricity-onboarding/adapters/mock-server.mjs [--port 4545]
//
// The tools of the workflows point at http://localhost:4545. Port 0 picks a free port; the first line
// written to standard output says where the server listens. A utility replaces each route with its own
// system and changes the tool's URL (README.md, "Taking it into production").
//
// What a lookup returns for an applicant, a metering point or a document named in scenarios/*.json is
// that scenario's `world`; anything else gets a default derived from the identifier, so the answers are
// the same every time for the same request.

import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const here = path.dirname(fileURLToPath(import.meta.url));
export const DEFAULT_PORT = 4545;

/** The scenarios' worlds, by application id and by metering point id */
function load_worlds(directory = path.join(here, '../scenarios')) {
    const by_application = new Map(), by_metering_point = new Map(), documents = new Map();
    for (const file of fs.readdirSync(directory).filter(f => /^[a-z]-.*\.json$/.test(f)).sort()) {
        const scenario = JSON.parse(fs.readFileSync(path.join(directory, file), 'utf-8'));
        const world = scenario.world || {};
        by_application.set(scenario.application.application_id, { application: scenario.application, world });
        by_metering_point.set(scenario.application.metering_point_id, world.metering_point);
        for (const [id, document] of Object.entries(world.documents || {})) documents.set(id, document);
    }
    return { by_application, by_metering_point, documents };
}

/** The digits an identifier ends with: APP-24002, C-24002 and CT-24002 all give 24002 */
const number_of = id => (String(id ?? '').match(/(\d+)(?!.*\d)/) || [, '00000'])[1];
/** A small stable hash, for defaults */
const hash = text => [...String(text)].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7);
const round2 = n => Math.round(n * 100) / 100;
const day = (offset_days) => new Date(Date.now() + offset_days * 86_400_000).toISOString().slice(0, 10);

// Tariff catalogue: unit rates and standing charges in EUR. EXAMPLE FIGURES, not any market's prices.
const PLANS = {
    fixed_12: { unit_rate: 0.292, standing_per_day: 0.42, label: 'Fixed price, 12 months' },
    fixed_24: { unit_rate: 0.301, standing_per_day: 0.42, label: 'Fixed price, 24 months' },
    variable: { unit_rate: 0.284, standing_per_day: 0.45, label: 'Variable price' },
    time_of_use: { unit_rate: 0.262, standing_per_day: 0.47, label: 'Time of use (smart meter)' },
    ev: { unit_rate: 0.251, standing_per_day: 0.49, label: 'Electric vehicle' },
    prosumer: { unit_rate: 0.279, standing_per_day: 0.47, label: 'Prosumer (import and export)' },
};
const SOURCE_PREMIUM = { renewable_100: 0.012, local_community: 0.02, low_carbon_mix: 0.004, standard_mix: 0 };
const REGION_FACTOR = { 'north-west': 1.0, 'south-west': 1.02, 'north-east': 0.99, 'south-east': 1.04, east: 1.01, midlands: 1.0 };
const EXPORT_TARIFF = { solar: 0.082, wind: 0.082, heat_and_power: 0.071, geothermal: 0.075, small_hydro: 0.076, other: 0.06 };
const DOCUMENT_FIELDS = {
    proof_of_identity: { kind: 'identity card', expires_on: '2031-08-31' },
    proof_of_address: { kind: 'tenancy agreement' },
    direct_debit_mandate: { signed: true, account_holder_matches: true },
    installer_certificate: { installer_accredited: true },
    compliance_certificate: { standard: 'grid connection code for generators', compliant: true },
    commissioning_report: { protection_tested: true },
    installation_ownership: { owner_matches_applicant: true },
};

/**
 * The adapters as a function of a request, without a network: what make-runs.mjs and the tests call.
 * Returns { status, body }. Requests to routes that take a key must carry one (authorization or x-api-key).
 */
export function create_adapters(worlds = load_worlds()) {
    const world_of = application_id => worlds.by_application.get(application_id)?.world || {};
    const keyed = headers => !!(headers.authorization || headers['x-api-key']);
    const ok = body => ({ status: 200, body });
    const created = body => ({ status: 201, body });
    const problem = (status, message) => ({ status, body: { error: message } });

    const routes = [
        ['POST', /^\/crm\/v1\/customers$/, (_m, body) => created({ customer_id: `C-${number_of(body.application_id)}`, status: 'prospect', application_id: body.application_id })],
        ['POST', /^\/crm\/v1\/customers\/([^/]+)\/activation$/, (m, body) => ok({ customer_id: m[1], status: 'active', activated_at: body.supply_start_date || day(0) })],
        ['POST', /^\/notifications\/v1\/messages$/, (_m, body) => created({ message_id: `MSG-${number_of(body.application_id)}-${(hash(`${body.template}|${body.channel}`) % 9000) + 1000}`, channel: body.channel, status: 'queued' })],
        ['POST', /^\/documents\/v1\/extractions$/, (_m, body) => {
            const known = worlds.documents.get(body.file_id) || {};
            const type = known.document_type || body.document_type;
            const legible = known.legible !== false;
            return ok({
                file_id: body.file_id, document_type: type, legible,
                fields: legible ? { ...(DOCUMENT_FIELDS[type] || {}), ...(known.fields || {}) } : {},
                text: known.text ?? (legible ? `${type.replace(/_/g, ' ')} for application ${body.application_id || ''}`.trim() : ''),
                pages: known.pages || 1,
            });
        }],
        ['POST', /^\/credit\/v1\/checks$/, (_m, body) => {
            const credit = world_of(body.application_id).credit;
            const h = hash(`${body.first_name}|${body.last_name}|${body.date_of_birth}`);
            const d = credit || { credit_band: 'ABC'[h % 3], score: 640 + (h % 200), outstanding_debt_eur: 0, identity_result: 'verified' };
            return ok({ reference: `CB-${number_of(body.application_id)}`, ...d });
        }],
        ['GET', /^\/registry\/v1\/metering-points\/([^/]+)$/, m => {
            const id = decodeURIComponent(m[1]);
            const known = worlds.by_metering_point.get(id);
            if (!known && !/^MP-/.test(id)) return problem(404, `No metering point ${id}`);
            const h = hash(id);
            return ok({ metering_point_id: id, ...(known || { meter_type: h % 2 ? 'smart' : 'standard', smart_meter: h % 2 === 1, current_supplier: 'Northgrid Energy', connection_capacity_kva: 13.8, region: 'midlands', grid_operator: 'Central Grid', phases: 1 }) });
        }],
        ['POST', /^\/registry\/v1\/switches$/, (_m, body) => created({ switch_id: `SW-${number_of(body.customer_id)}`, status: 'requested', metering_point_id: body.metering_point_id, expected_switch_date: day(14) })],
        ['GET', /^\/tariffs\/v1\/plans\/([^/]+)\/estimate$/, (m, _b, query) => {
            const plan = PLANS[m[1]];
            if (!plan) return problem(404, `No plan ${m[1]}`);
            const kwh = Number(query.get('annual_consumption_kwh')) || 3000;
            const rate = (plan.unit_rate + (SOURCE_PREMIUM[query.get('electricity_source')] || 0)) * (REGION_FACTOR[query.get('region')] || 1);
            return ok({ plan: m[1], label: plan.label, annual_consumption_kwh: kwh, unit_rate_eur_per_kwh: round2(rate * 1000) / 1000, standing_charge_eur_per_day: plan.standing_per_day, estimated_annual_cost_eur: Math.round(kwh * rate + 365 * plan.standing_per_day), currency: 'EUR' });
        }],
        ['POST', /^\/grid\/v1\/notifications$/, (_m, body) => created({ notification_id: `GN-${number_of(body.metering_point_id)}`, status: 'accepted', technology: body.technology, capacity_kw: body.capacity_kw })],
        ['POST', /^\/contracts\/v1\/contracts$/, (_m, body) => created({ contract_id: `CT-${number_of(body.application_id)}`, contract_url: `http://localhost:${DEFAULT_PORT}/contracts/v1/contracts/CT-${number_of(body.application_id)}.pdf`, cooling_off_days: 14, status: 'sent_for_signature' })],
    ];

    const rpc = {
        'meterdata.register_export': p => ({ export_registration_id: `EXP-${number_of(p.metering_point_id)}`, export_meter_id: `EM-${number_of(p.metering_point_id)}`, approved_export_kw: p.approved_export_kw, export_tariff_eur_per_kwh: EXPORT_TARIFF[p.technology] ?? EXPORT_TARIFF.other }),
        'billing.create_account': p => ({ account_id: `ACC-${number_of(p.customer_id)}`, mandate_id: `MDT-${number_of(p.mandate_reference || p.customer_id)}`, mandate_status: 'active', billing_day: p.billing_day ?? 1 }),
        'billing.collect_deposit': p => ({ deposit_id: `DEP-${number_of(p.account_id)}`, amount_eur: p.amount_eur, status: 'collected' }),
        'billing.cancel_account': p => ({ account_id: p.account_id, status: 'cancelled', mandate_status: 'cancelled' }),
        'billing.refund_deposit': p => ({ refund_id: `REF-${number_of(p.deposit_id)}`, amount_eur: p.amount_eur, status: 'refunded' }),
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
