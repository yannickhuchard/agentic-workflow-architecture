// Verifies the server and its widgets end to end without a ChatGPT or Claude
// account: an MCP client lists and calls every tool, then each widget is loaded
// in Chromium inside a fake MCP Apps host, the tool result is delivered through
// the bridge, and the script checks what is drawn.
//
//   NODE_PATH=$(npm root -g) node scripts/verify-widgets.mjs [--output <dir>] [--serve-only]
//
// The widget is served with the strict Content-Security-Policy a host applies
// (no network at all) in an iframe sandboxed without same-origin access.
// This checks the bridge protocol against a test host. It is not a test inside
// ChatGPT or Claude.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createMcpServer } from '../src/server.js';
import { WIDGETS } from '../src/widgets.js';
import { REPOSITORY_ROOT } from '../src/sdk.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const option = (key, fallback) => { const i = args.indexOf(key); return i < 0 ? fallback : args[i + 1]; };
const output = path.resolve(option('--output', path.join(here, '../artifacts/verify')));
fs.mkdirSync(output, { recursive: true });
const read = file => JSON.parse(fs.readFileSync(path.join(REPOSITORY_ROOT, file), 'utf8'));

const results = [];
const check = (ok, what) => { results.push({ ok: !!ok, what }); console.log(`${ok ? 'ok  ' : 'FAIL'}  ${what}`); };

// ------------------------------------------------------------------ 1. the server, through an MCP client
const server = await createMcpServer();
const [a, b] = InMemoryTransport.createLinkedPair();
const client = new Client({ name: 'awa-verify', version: '1.0.0' });
await server.connect(a); await client.connect(b);

const tools = (await client.listTools()).tools;
const resources = (await client.listResources()).resources;
const EXPECTED_TOOLS = ['validate_document', 'show_workflow', 'simulate_workflow', 'show_journeys', 'simulate_journey', 'load_claims_example', 'show_dashboard', 'make_dossier'];
check(JSON.stringify(tools.map(t => t.name)) === JSON.stringify(EXPECTED_TOOLS), `the server lists ${EXPECTED_TOOLS.length} tools: ${tools.map(t => t.name).join(', ')}`);
check(tools.every(t => t.annotations?.readOnlyHint === true && t.annotations.destructiveHint === false && t.annotations.openWorldHint === false), 'every tool is annotated read-only, not destructive, closed world');
check(tools.every(t => t.inputSchema?.additionalProperties === false), 'every tool has a strict input schema');
check(JSON.stringify(resources.map(r => r.uri).sort()) === JSON.stringify(Object.values(WIDGETS).map(w => w.uri).sort()), `the server lists ${resources.length} UI resources: ${resources.map(r => r.uri).join(', ')}`);
const widget_html = {};
for (const [name, widget] of Object.entries(WIDGETS)) {
    const content = (await client.readResource({ uri: widget.uri })).contents[0];
    widget_html[name] = content.text;
    check(content.mimeType === 'text/html;profile=mcp-app' && content._meta.ui.csp.connectDomains.length === 0 && content._meta.ui.csp.resourceDomains.length === 0 && content._meta['openai/widgetCSP'].connect_domains.length === 0,
        `${widget.uri} is an MCP Apps resource that declares no network domain (${(content.text.length / 1024).toFixed(0)} kB)`);
    check(tools.some(t => t._meta?.ui?.resourceUri === widget.uri && t._meta['openai/outputTemplate'] === widget.uri), `a tool shows its result in ${widget.uri}`);
}

const HOSTILE = '<img src=x onerror="window.__awa_xss=1">"><script>window.__awa_xss=1</script>';
const purchase = read('examples/claims-journey/policy-purchase.awa.json'), purchase_journey = read('examples/claims-journey/policy-purchase.journey.json');
const outputs = read('examples/claims-journey/simulation.json');
const settlement = read('examples/claims-settlement/claims-settlement.awa.json'), settlement_outputs = read('examples/claims-settlement/simulation.json');
const orders = read('examples/order-processing/order-processing.awa.json');
const journey_events = [
    { type: 'quote.requested', data: { customer_id: 'c-1', name: 'Ada' } },
    { type: 'quote.requested', data: { customer_id: 'c-2', name: 'Ben' }, after: 'PT1H' },
    { type: 'quote.accepted', data: { customer_id: 'c-1', quote_accepted: true }, after: 'PT2H' },
    { type: 'contract.signed', data: { customer_id: 'c-1', signed: true }, after: 'P1D' },
    { type: 'payment.received', data: { customer_id: 'c-1', amount: 600 }, after: 'P1D' },
];
const journey_args = { journeys: [purchase_journey], workflows: [purchase], simulated_outputs: outputs, start_time: '2026-03-02T09:00:00Z', events: journey_events };
// Every free-text field of a document made hostile. Tool names are left alone: the schema restricts them to identifiers.
const hostile = value => JSON.parse(JSON.stringify(value), function (key, v) { return ['name', 'description', 'label', 'procedure'].includes(key) && typeof v === 'string' && !(key === 'name' && this.binding) ? `${v} ${HOSTILE}` : v; });
// A portfolio as a host exports it: here taken from an in-memory simulation, the same shape "awa journey export" writes
const { simulate_journeys } = await import('../src/simulation.js');
const { require_workflow, require_journey } = await import('../src/awa.js');
const exported = (await simulate_journeys([await require_workflow(purchase)], [await require_journey(purchase_journey, [await require_workflow(purchase)])],
    [{ type: 'quote.requested', data: { customer_id: 'c-9', name: 'Zoe' } }], { outputs, start_time: Date.parse('2026-03-02T09:00:00Z') })).portfolio;

// A company's brand, inline as the server takes it: the fictional Valoria Life, its logo as a data: URL
const brands = path.join(REPOSITORY_ROOT, 'tools/visualization/brands');
const valoria_logo = 'data:image/svg+xml;base64,' + fs.readFileSync(path.join(brands, 'valoria-life.svg')).toString('base64');
const valoria_design = fs.readFileSync(path.join(brands, 'valoria-life.DESIGN.md'), 'utf8').replace(/^logo: .*$/m, `logo: "${valoria_logo}"`).replace(/^logo_dark: .*\n/m, '');
const valoria_json = { ...JSON.parse(fs.readFileSync(path.join(brands, 'valoria-life.brand.json'), 'utf8')), logo: valoria_logo, logo_dark: undefined };
const CALLS = {
    validate_ok: ['validate_document', { document: settlement }],
    validate_bad: ['validate_document', { document: { name: 'Broken', activities: [{ name: 'A' }], edges: [] } }],
    workflow: ['show_workflow', { workflow: orders }],
    workflow_hostile: ['show_workflow', { workflow: hostile(orders) }],
    run: ['simulate_workflow', { workflow: settlement, simulated_outputs: settlement_outputs, let_waits_time_out: true, pricing: { currency: 'EUR', input_token_cost_per_1k: 0.1, output_token_cost_per_1k: 0.4 } }],
    run_unscripted: ['simulate_workflow', { workflow: settlement }],
    run_hostile: ['simulate_workflow', { workflow: hostile(settlement), simulated_outputs: Object.fromEntries(Object.entries(settlement_outputs).map(([k, v]) => [`${k} ${HOSTILE}`, v])), let_waits_time_out: true }],
    journeys_example: ['load_claims_example', {}],
    journeys_simulated: ['simulate_journey', { ...journey_args, then_wait: 'P10D' }],
    journeys_from_documents: ['show_journeys', journey_args],
    journeys_from_portfolio: ['show_journeys', { portfolio: exported }],
    dashboard_example: ['show_dashboard', { use_claims_example: true }],
    dossier_example: ['make_dossier', { use_claims_example: true }],
    dashboard_branded: ['show_dashboard', { use_claims_example: true, brand: valoria_design }],
    journeys_branded: ['load_claims_example', { brand: JSON.parse(JSON.stringify(valoria_json)) }],
    run_branded: ['simulate_workflow', { workflow: settlement, simulated_outputs: settlement_outputs, let_waits_time_out: true, brand: JSON.parse(JSON.stringify(valoria_json)) }],
    dashboard_simulated: ['show_dashboard', { ...journey_args, then_wait: 'P10D' }],
    dashboard_hostile: ['show_dashboard', { journeys: [hostile(purchase_journey)], workflows: [hostile(purchase)], start_time: '2026-03-02T09:00:00Z', then_wait: 'P10D',
        events: [{ type: 'quote.requested', data: { customer_id: `c-1 ${HOSTILE}`, name: `Eve ${HOSTILE}` } }] }],
    journeys_empty: ['show_journeys', { journeys: [purchase_journey], workflows: [purchase] }],
    journeys_hostile: ['simulate_journey', { journeys: [hostile(purchase_journey)], workflows: [hostile(purchase)], start_time: '2026-03-02T09:00:00Z',
        simulated_outputs: Object.fromEntries(Object.entries(outputs).map(([k, v]) => [`${k} ${HOSTILE}`, { output: { ...v.output, message: HOSTILE } }])),
        events: [{ type: 'quote.requested', data: { customer_id: `c-1 ${HOSTILE}`, name: `Eve ${HOSTILE}`, vehicle: HOSTILE } }, { type: 'quote.accepted', data: { customer_id: `c-1 ${HOSTILE}`, quote_accepted: true, note: HOSTILE }, after: 'PT2H' }] }],
};
const R = {};
for (const [key, [name, input]] of Object.entries(CALLS)) R[key] = await client.callTool({ name, arguments: input });
check(Object.values(R).every(r => !r.isError), `every tool answers without error (${Object.keys(CALLS).length} calls covering all ${EXPECTED_TOOLS.length} tools)`);
for (const [key, r] of Object.entries(R)) if (r.isError) console.log(`      ${key}: ${r.content[0].text}`);
check(new Set(Object.values(CALLS).map(c => c[0])).size === EXPECTED_TOOLS.length, 'each tool is called at least once');
check(R.validate_ok.structuredContent.valid === true && R.validate_bad.structuredContent.valid === false && R.validate_bad.structuredContent.problems.length >= 3, `validate_document accepts a valid workflow and reports ${R.validate_bad.structuredContent.problems.length} problems of a broken one in words`);
check(R.run.structuredContent.status === 'completed' && R.run.structuredContent.simulated === true && R.run.structuredContent.path.length >= 8 && R.run.structuredContent.decisions.length === 1, `simulate_workflow completes the scripted run: ${R.run.structuredContent.path.length} nodes on the path, 1 decision, cost ${R.run.structuredContent.cost?.amount} ${R.run.structuredContent.cost?.currency}`);
check(R.run_unscripted.structuredContent.status === 'failed' && /simulated_outputs/.test(R.run_unscripted.structuredContent.hint || ''), 'an unscripted run stops and says which outputs to supply');
check(R.run.structuredContent.tool_calls.length > 0 && R.run.structuredContent.tool_calls.every(t => t.simulated === true), `the run's ${R.run.structuredContent.tool_calls.length} tool calls are all recorded as simulated`);
check(R.journeys_example.structuredContent.journeys.length === 3 && R.journeys_simulated.structuredContent.journeys[0].customers.length === 2, 'the example has 3 journeys; the simulated journey has 2 customers');
await client.close();

// ------------------------------------------------------------------ 2. a fake MCP Apps host
const CSP = "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; connect-src 'none'; frame-ancestors 'self'";
const harness = (widget, theme, max_height) => `<!doctype html><html><head><meta charset="utf-8"><title>Fake MCP Apps host: ${widget}</title></head>
<body style="margin:0;background:${theme === 'light' ? '#fff' : '#222'}"><iframe id="app" title="AWA widget" sandbox="allow-scripts" src="/widget/${widget}" style="border:0;width:100%;height:${max_height}px;display:block"></iframe><script>
const frame = document.getElementById('app'), log = window.HOST_LOG = { initialize: null, initialized: false, sizes: [], display: [], context: [], calls: [], other: [], from_widget: [], from_host: [] };
let mode = 'inline';
const post = message => { log.from_host.push(message.method ? { method: message.method } : { result_of: message.result_of }); delete message.result_of; frame.contentWindow.postMessage(message, '*'); };
window.deliver = result => post({ jsonrpc: '2.0', method: 'ui/notifications/tool-result', params: result });
window.setContext = context => post({ jsonrpc: '2.0', method: 'ui/notifications/host-context-changed', params: context });
window.addEventListener('message', event => {
    if (event.source !== frame.contentWindow) return;
    const m = event.data; if (!m || m.jsonrpc !== '2.0') return;
    if (m.method) log.from_widget.push({ method: m.method, params: m.params, request: m.id !== undefined });
    const answer = result => event.source.postMessage({ jsonrpc: '2.0', id: m.id, result }, '*');
    if (m.method === 'ui/initialize') { log.initialize = m.params; answer({ protocolVersion: '2026-01-26', hostInfo: { name: 'AWA verification host', version: '1' }, hostCapabilities: {}, hostContext: { theme: '${theme}', displayMode: 'inline', availableDisplayModes: ['inline', 'fullscreen'], containerDimensions: { maxHeight: ${max_height} } } }); }
    else if (m.method === 'ui/notifications/initialized') log.initialized = true;
    else if (m.method === 'ui/notifications/size-changed') { log.sizes.push(m.params.height); if (mode === 'inline') frame.style.height = m.params.height + 'px'; }
    else if (m.method === 'ui/request-display-mode') { mode = m.params.mode; log.display.push(mode); frame.style.height = mode === 'fullscreen' ? innerHeight + 'px' : frame.style.height; answer({ mode }); window.setContext({ displayMode: mode, containerDimensions: { maxHeight: mode === 'fullscreen' ? innerHeight : ${max_height} } }); }
    else if (m.method === 'ui/update-model-context') { log.context.push(m.params); answer({}); }
    else if (m.method === 'tools/call') { log.calls.push(m.params); answer({ content: [{ type: 'text', text: 'not implemented by the test host' }], isError: true }); }
    else log.other.push(m.method);
});
</script></body></html>`;
const traps = [];
const web = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://localhost');
    // The widget served without any Content-Security-Policy, to check that it stays off the network by itself
    const bare = /^\/bare\/(\w+)$/.exec(url.pathname)?.[1];
    if (bare && widget_html[bare]) { res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); res.end(widget_html[bare]); return; }
    if (url.pathname.startsWith('/trap')) { traps.push(req.url); res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }); res.end('{}'); return; }
    const widget = /^\/widget\/(\w+)$/.exec(url.pathname)?.[1], host = /^\/host\/(\w+)$/.exec(url.pathname)?.[1];
    if (widget && widget_html[widget]) { res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Content-Security-Policy': CSP }); res.end(widget_html[widget]); }
    else if (host && widget_html[host]) { res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); res.end(harness(host, url.searchParams.get('theme') === 'light' ? 'light' : 'dark', Number(url.searchParams.get('max')) || 640)); }
    else { res.writeHead(404).end(); }
});
await new Promise(resolve => web.listen(Number(option('--port', 0)), '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${web.address().port}`;
if (args.includes('--serve-only')) {
    console.log(`\nFake MCP Apps host: ${Object.keys(WIDGETS).map(w => `${origin}/host/${w}`).join('  ')}\nIn the page's console: deliver(<tool result>) hands a result to the widget.`);
} else {
    const { chromium } = createRequire(import.meta.url)(option('--playwright-module', 'playwright'));
    const browser = await chromium.launch();
    const problems = [], requests = [];
    const open = async (widget, { theme = 'dark', max = 640, width = 1280, height = 900 } = {}) => {
        const page = await browser.newPage({ viewport: { width, height } });
        page.on('pageerror', error => problems.push(`${widget}: ${error.message}`));
        page.on('console', message => { if (message.type() === 'error') problems.push(`${widget}: console: ${message.text()}`); });
        page.on('request', request => requests.push(request.url()));
        await page.goto(`${origin}/host/${widget}?theme=${theme}&max=${max}`);
        await page.waitForFunction(() => window.HOST_LOG.initialized, null, { timeout: 10000 });
        return { page, frame: page.frameLocator('#app'), app: page.frames().find(f => f.url().includes('/widget/')) };
    };
    const deliver = (page, result) => page.evaluate(r => window.deliver(r), result);
    const settle = page => page.waitForTimeout(900);
    const shot = (page, name) => page.screenshot({ path: path.join(output, `${name}.png`) });
    // Every message a widget sent is checked against the schemas published with the MCP Apps SDK
    const apps = await import('@modelcontextprotocol/ext-apps');
    const SCHEMAS = { 'ui/initialize': apps.McpUiInitializeRequestSchema, 'ui/notifications/initialized': apps.McpUiInitializedNotificationSchema, 'ui/notifications/size-changed': apps.McpUiSizeChangedNotificationSchema, 'ui/request-display-mode': apps.McpUiRequestDisplayModeRequestSchema, 'ui/update-model-context': apps.McpUiUpdateModelContextRequestSchema };
    const sent = { count: 0, methods: new Set(), invalid: [] };
    const conformance = async page => {
        for (const m of (await page.evaluate(() => (window.HOST_LOG ? window.HOST_LOG.from_widget : [])))) {
            sent.count++; sent.methods.add(m.method);
            const schema = SCHEMAS[m.method];
            if (!schema) sent.invalid.push(`${m.method}: not a message this check knows`);
            else { const parsed = schema.safeParse({ method: m.method, params: m.params }); if (!parsed.success) sent.invalid.push(`${m.method}: ${JSON.stringify(parsed.error.issues).slice(0, 200)}`); }
        }
    };
    const no_injection = async (app, what) => {
        const found = await app.evaluate(() => ({ flag: window.__awa_xss, images: document.querySelectorAll('img').length, scripts: [...document.querySelectorAll('script')].filter(s => /__awa_xss=1<|^window\.__awa_xss/.test(s.textContent.trim())).length, handlers: document.querySelectorAll('[onerror]').length }));
        check(found.flag === undefined && found.images === 0 && found.scripts === 0 && found.handlers === 0, `${what}: hostile names and values are shown as text, not markup (${JSON.stringify(found)})`);
    };

    try {
        // --- journeys: the bundled example, at every height
        {
            const { page, frame, app } = await open('journeys', { max: 800 });
            check((await frame.locator('#none').innerText()).includes('Waiting for journeys'), 'journeys: before a result arrives the widget says it is waiting');
            await deliver(page, R.journeys_example); await settle(page);
            check(await frame.locator('.jcard').count() === 3 && await frame.locator('.pcell').count() === 18, 'journeys: the example draws 3 journeys and 18 customer cells');
            check((await frame.locator('#source').innerText()).includes('fictional'), 'journeys: the source line says the example is fictional');
            await shot(page, 'journeys-example-atlas');
            await frame.locator('[data-open-j="1"]').click(); await settle(page);
            check(await frame.locator('.lane').count() === 6, 'journeys: one journey shows a lane per customer');
            await frame.locator('[data-lane="1"]').click(); await settle(page);
            check((await frame.locator('#crumbs').innerText()).includes('A. Okafor') && await frame.locator('.rowl').count() > 10, 'journeys: a customer\'s journey shows mood, touchpoint and exchange rows');
            await shot(page, 'journeys-example-customer');
            await app.evaluate(() => { const s = document.getElementById('scrub'); s.value = s.max; s.dispatchEvent(new Event('input')); }); await settle(page);
            await frame.locator('.rbl[data-run="0"]').click(); await settle(page);
            check(await frame.locator('.nd').count() > 5 && (await frame.locator('#evidence').innerText()).includes('Journal record'), 'journeys: the run behind a moment shows its graph and journal evidence');
            await shot(page, 'journeys-example-run');
            await page.waitForTimeout(600);
            const log = await page.evaluate(() => window.HOST_LOG);
            check(log.initialize?.appInfo?.name === 'awa-journeys' && log.initialize.protocolVersion === '2026-01-26', 'journeys: the widget initialises the bridge (ui/initialize, then initialized)');
            check(log.sizes.length > 0 && log.sizes.every(h => h <= 800 && h >= 240), `journeys: the height it asks for stays within the host's maximum of 800 (${[...new Set(log.sizes)].join(', ')})`);
            check(log.context.some(c => c.structuredContent?.view === 'journeys' && c.structuredContent.customer === 'A. Okafor'), 'journeys: navigation is reported to the model with ui/update-model-context');
            await frame.locator('#awa-expand').click(); await settle(page);
            const after = await page.evaluate(() => window.HOST_LOG);
            check(after.display[0] === 'fullscreen' && await app.evaluate(() => document.documentElement.dataset.awaDisplay) === 'fullscreen', 'journeys: Expand asks the host for fullscreen and the widget follows the new display mode');
            const box = await app.evaluate(() => { const r = document.getElementById('fit').getBoundingClientRect(); return { w: r.width, h: r.height, iw: innerWidth, ih: innerHeight }; });
            check(box.w <= box.iw + 1 && box.h <= box.ih + 1, `journeys: in fullscreen the stage fits its frame (${Math.round(box.w)}x${Math.round(box.h)} in ${box.iw}x${box.ih})`);
            await shot(page, 'journeys-example-fullscreen');
            // the Recommendations tab, from the recommendations the tool computed beside the story
            const expected = createRequire(import.meta.url)(path.join(REPOSITORY_ROOT, 'tools/visualization/awa-recommendations.js')).compute(JSON.parse(fs.readFileSync(path.join(REPOSITORY_ROOT, 'examples/claims-journey/journeys.json'), 'utf8')), {});
            await frame.locator('#b-recs').click(); await settle(page);
            const shown_name = await app.evaluate(() => document.querySelector('#crumbs .crumb.on').textContent);
            const first = expected.journeys.find(j => j.name === shown_name) || expected.journeys[0];
            check(await frame.locator('.rcard').count() === first.recommendations.length && (await frame.locator('#b-recs').innerText()).includes(String(first.recommendations.length)),
                `journeys: the Recommendations tab shows the ${first.recommendations.length} recommendations the tool computed for ${first.name}`);
            if (first.recommendations.length) {
                await frame.locator('.rcard').first().click(); await settle(page);
                check(await frame.locator('#rpanel.open h2').innerText() === first.recommendations[0].title, 'journeys: a recommendation opens its panel');
                await shot(page, 'journeys-example-recommendations');
                await page.keyboard.press('Escape'); await settle(page);
                check(!(await frame.locator('#rpanel.open').count()), 'journeys: Escape closes the panel');
            }
            await conformance(page); await page.close();
        }
        // --- journeys: simulated, from documents, from a portfolio, empty, hostile, light theme, narrow
        {
            const { page, frame, app } = await open('journeys', { theme: 'light', max: 560 });
            await deliver(page, R.journeys_simulated); await settle(page);
            check(await frame.locator('.jcard').count() === 1 && await frame.locator('.pcell').count() === 2 && (await frame.locator('.pname').first().innerText()).includes('Ada'), 'journeys: a simulated journey draws 1 journey and 2 customers, named from the events');
            check((await frame.locator('#source').innerText()).includes('simulated'), 'journeys: the source line says the record is simulated');
            await frame.locator('.pcell').first().click(); await settle(page);
            check(await frame.locator('.g').count() >= 8, 'journeys: the simulated journey is told as beats');
            await shot(page, 'journeys-simulated-light-host');
            check(await app.evaluate(() => document.documentElement.dataset.awaTheme) === 'light', 'journeys: the host theme is received (the journey stage itself stays dark by design)');
            await deliver(page, R.journeys_from_documents); await settle(page);
            check(await frame.locator('.pcell').count() === 2, 'journeys: show_journeys with documents and events draws the same journey');
            await deliver(page, R.journeys_from_portfolio); await settle(page);
            check(await frame.locator('.pcell').count() === 1 && (await frame.locator('.pname').first().innerText()).includes('Zoe'), 'journeys: show_journeys with a portfolio export draws its record');
            await deliver(page, R.journeys_empty); await settle(page);
            check((await frame.locator('#none').innerText()).includes('No journey has started'), 'journeys: with no starting event the widget explains that nothing started');
            await deliver(page, R.journeys_hostile); await settle(page);
            check(await frame.locator('.pcell').count() === 1, 'journeys: a record with hostile names is drawn');
            await frame.locator('.pcell').first().click(); await settle(page);
            await no_injection(app, 'journeys, customer height');
            if (await frame.locator('.rbl[data-run="0"]').count()) { await frame.locator('.rbl[data-run="0"]').click(); await settle(page); }
            await no_injection(app, 'journeys, run height');
            await shot(page, 'journeys-hostile');
            await deliver(page, { isError: true, content: [{ type: 'text', text: `Workflow 1 is not valid ${HOSTILE}` }] }); await settle(page);
            check((await frame.locator('#none').innerText()).includes('Workflow 1 is not valid'), 'journeys: a tool error is shown as text');
            await no_injection(app, 'journeys, error');
            await conformance(page); await page.close();
        }
        {
            const { page, frame, app } = await open('journeys', { width: 390, height: 780, max: 500 });
            await deliver(page, R.journeys_simulated); await settle(page);
            const box = await app.evaluate(() => ({ scroll: document.documentElement.scrollWidth, inner: innerWidth }));
            check(await frame.locator('.jcard').count() === 1 && box.scroll <= box.inner + 1, `journeys: at 390 px wide the stage scales to the frame without overflow (${box.scroll} in ${box.inner})`);
            await shot(page, 'journeys-narrow');
            await conformance(page); await page.close();
        }
        // --- workflow graph
        for (const theme of ['dark', 'light']) {
            const { page, frame, app } = await open('workflow', { theme, max: 640 });
            if (theme === 'dark') check((await frame.locator('#drop').innerText()).includes('Waiting for data'), 'workflow: before a result arrives the widget says it is waiting');
            await deliver(page, R.workflow); await settle(page);
            const expected = orders.activities.length + (orders.events || []).length + (orders.decision_nodes || []).length;
            check(await frame.locator('.node').count() === expected, `workflow (${theme}): the graph draws ${expected} nodes`);
            const data = await frame.locator('#pane-data').innerText();
            check(await frame.locator('#pane-data.active').count() === 1 && /Roles and actors/i.test(data) && /Contexts/i.test(data) && /read by/i.test(data) && /Access/i.test(data), `workflow (${theme}): the Data tab lists roles, contexts with readers and writers, and access`);
            check(!(await frame.locator('footer').isVisible()) && !(await frame.locator('#tab-log').isVisible()), `workflow (${theme}): a definition has no timeline and no journal tab`);
            const background = await app.evaluate(() => getComputedStyle(document.body).backgroundColor);
            check(theme === 'light' ? background === 'rgb(248, 250, 252)' : background === 'rgb(11, 15, 25)', `workflow (${theme}): the widget takes the host's ${theme} theme (${background})`);
            await frame.locator('.node rect.body').nth(2).click(); await settle(page);
            const node = await frame.locator('#pane-node').innerText();
            check(await frame.locator('#pane-node.active h2').count() === 1 && !/Status|QUEUED|Nothing has happened/i.test(node) && (await frame.locator('header h1').innerText()) === 'AWA Workflow', `workflow (${theme}): selecting a node opens its description, without any run status`);
            await shot(page, `workflow-${theme}`);
            if (theme === 'dark') {
                await page.waitForTimeout(500);
                const log = await page.evaluate(() => window.HOST_LOG);
                check(log.initialize?.appInfo?.name === 'awa-workflow-graph' && log.sizes.every(h => h <= 640), `workflow: bridge initialised; height asked within the maximum of 640 (${[...new Set(log.sizes)].join(', ')})`);
                check(log.context.some(c => c.structuredContent?.selected_node), 'workflow: the selected node is reported to the model');
                await frame.locator('#awa-expand').click(); await settle(page);
                check((await page.evaluate(() => window.HOST_LOG)).display[0] === 'fullscreen', 'workflow: Expand asks the host for fullscreen');
                await deliver(page, R.workflow_hostile); await settle(page);
                await frame.locator('#tab-data').click(); await settle(page);
                check(await frame.locator('.node').count() === expected, 'workflow: a workflow with hostile names is drawn');
                await no_injection(app, 'workflow, data tab');
                await frame.locator('.node rect.body').nth(1).click(); await settle(page);
                await no_injection(app, 'workflow, node tab');
                await shot(page, 'workflow-hostile');
            }
            await conformance(page); await page.close();
        }
        // --- run replay
        {
            const { page, frame, app } = await open('run', { max: 700 });
            await deliver(page, R.run); await settle(page);
            const total = R.run._meta.awa.journal.length;
            check(await frame.locator('.node.s-done').count() >= 8 && await app.evaluate(() => window.AWAReplay.length) === total && await app.evaluate(() => window.AWAReplay.position) === total, `run: the replay holds all ${total} journal events and opens at the end, with the nodes on the path done`);
            check((await frame.locator('#title').innerText()).includes('Simulated'), 'run: the title says the run is simulated');
            check(await frame.locator('footer').isVisible() && await frame.locator('#marks i').count() > 0, 'run: the timeline shows marks for tool calls and decisions');
            await frame.locator('#tab-data').click(); await settle(page);
            const data = await frame.locator('#pane-data').innerText();
            check(/Simulated run: completed/i.test(data) && /nothing was executed/i.test(data) && /Small and clean/.test(data), 'run: the Data tab summarises the simulated run: status, path and the decision rule that matched');
            await shot(page, 'run-end');
            await frame.locator('#first').click(); await settle(page);
            check(await app.evaluate(() => window.AWAReplay.position) === 0 && await frame.locator('.node.s-done').count() === 0, 'run: going to the start shows nothing done yet');
            for (let i = 0; i < 14; i++) await frame.locator('#next').click();
            await settle(page);
            check(await app.evaluate(() => window.AWAReplay.position) === 14 && (await frame.locator('#pane-step').innerText()).length > 20, 'run: stepping forward advances the replay and describes the step');
            await frame.locator('#tab-log').click(); await settle(page);
            check(await frame.locator('#log li').count() === total, `run: the Journal tab lists the ${total} events`);
            await shot(page, 'run-step');
            await deliver(page, R.run_unscripted); await settle(page);
            check(await frame.locator('.node.s-failed').count() >= 1, 'run: an unscripted run shows where it failed');
            await deliver(page, R.run_hostile); await settle(page);
            await frame.locator('#tab-log').click(); await settle(page);
            await no_injection(app, 'run, journal tab');
            await frame.locator('.node rect.body').nth(3).click(); await settle(page);
            await no_injection(app, 'run, node tab');
            await frame.locator('#tab-data').click(); await settle(page);
            await no_injection(app, 'run, data tab');
            await deliver(page, { isError: true, content: [{ type: 'text', text: `The workflow is not valid ${HOSTILE}` }] }); await settle(page);
            check((await frame.locator('#error').innerText()).includes('The workflow is not valid'), 'run: a tool error is shown as text');
            await no_injection(app, 'run, error');
            await conformance(page); await page.close();
        }
        {
            const { page, frame, app } = await open('run', { width: 390, height: 780, max: 720, theme: 'light' });
            await deliver(page, R.run); await settle(page);
            const box = await app.evaluate(() => ({ scroll: document.documentElement.scrollWidth, inner: innerWidth }));
            check(await frame.locator('.node').count() > 10 && box.scroll <= box.inner + 1, `run: at 390 px wide the layout stacks without horizontal overflow (${box.scroll} in ${box.inner})`);
            await shot(page, 'run-narrow-light');
            await conformance(page); await page.close();
        }
        // --- a company's brand, given inline: colours, name and logo, and nothing fetched
        for (const [widget, key] of [['dashboard', 'dashboard_branded'], ['journeys', 'journeys_branded'], ['run', 'run_branded']]) {
            const { page, frame, app } = await open(widget, { theme: 'dark', max: 900 });
            await deliver(page, R[key]); await settle(page);
            const look = await app.evaluate(() => {
                const img = document.querySelector('#brandmark img');
                return { bg: getComputedStyle(document.body).backgroundColor, accent: getComputedStyle(document.documentElement).getPropertyValue('--accent').trim(), name: (document.querySelector('#brandmark .awa-brand-n') || {}).textContent,
                    logo: img ? img.src.startsWith('data:image/svg+xml') && img.complete && img.naturalWidth > 0 : false, links: document.querySelectorAll('link[href]').length };
            });
            check(look.bg === 'rgb(246, 247, 251)' && look.accent === '#0e7c66' && look.name === 'Valoria Life' && look.logo && look.links === 0,
                `${widget}: a brand given with the tool call (${key === 'dashboard_branded' ? 'DESIGN.md' : 'brand.json'}) colours the widget and shows the name and the data: logo, and loads no font (${JSON.stringify(look)})`);
            await frame.locator('body').waitFor();
            await shot(page, `${widget}-branded`);
            await conformance(page); await page.close();
        }
        // --- dashboard
        for (const theme of ['dark', 'light']) {
            const { page, frame, app } = await open('dashboard', { theme, max: 900 });
            await deliver(page, R.dashboard_example); await settle(page);
            const tiles = (await frame.locator('#tiles').innerText()).replace(/\s+/g, ' ');
            check(/Journeys started 18/.test(tiles) && await frame.locator('#attention .row').count() === 2 && await frame.locator('#journeys .item').count() === 3 && await frame.locator('#workflows .item').count() === 5, `dashboard (${theme}): the example's measures are drawn: 18 journeys, 2 customers stuck, 3 journeys, 5 workflows`);
            check(await app.evaluate(() => document.documentElement.dataset.theme) === theme, `dashboard (${theme}): the page takes the host's theme`);
            check(await frame.locator('#open').isHidden() && await frame.locator('#tojourney').isHidden() && await frame.locator('a[href*="journey.html"]:visible').count() === 0, `dashboard (${theme}): nothing points to a page or a file that is not there`);
            if (theme === 'dark') {
                await frame.locator('#journeys .item', { hasText: 'Motor Claim' }).locator('.seg .c-stuck').click();
                check(await frame.locator('#ev-list li').count() === 2, 'dashboard: a number opens the customers behind it');
                await frame.locator('#ev-list [data-go]').first().click(); await page.waitForTimeout(300);
                const told = await page.evaluate(() => window.HOST_LOG.context.length);
                check(told > 0 && /Ask in the conversation/.test(await frame.locator('#source').innerText()), 'dashboard: "Open the journey" tells the model which customer was chosen');
                await frame.locator('#ev-x').click();
                await frame.locator('#workflows [data-open]').nth(2).click();
                check(/Pay claimant/.test(await frame.locator('#workflows .detail').innerText()), 'dashboard: a workflow opens into its steps');
            }
            await shot(page, `dashboard-${theme}`);
            await conformance(page); await page.close();
        }
        {
            const { page, frame, app } = await open('dashboard', { width: 390, height: 780, max: 700, theme: 'light' });
            await deliver(page, R.dashboard_simulated); await settle(page);
            const box = await app.evaluate(() => ({ scroll: document.documentElement.scrollWidth, inner: innerWidth }));
            check(/Journeys started 2/.test((await frame.locator('#tiles').innerText()).replace(/\s+/g, ' ')) && box.scroll <= box.inner + 1, `dashboard: a simulated record at 390 px wide, without horizontal overflow (${box.scroll} in ${box.inner})`);
            await deliver(page, R.dashboard_hostile); await settle(page);
            for (const toggle of await frame.locator('[data-open]').all()) await toggle.click().catch(() => { });
            await frame.locator('#journeys .n').first().click().catch(() => { });
            check(await app.evaluate(() => !window.__awa_xss && !document.querySelector('#main img, #main script, #ev img, #ev script')) && /<img src=x/.test(await frame.locator('body').innerText()), 'dashboard: hostile names are shown as text; no element is created and no script runs');
            await shot(page, 'dashboard-narrow');
            await conformance(page); await page.close();
        }
        // --- the views can load a record from an address when opened as pages; a widget must not, even where no policy forbids it
        {
            const page = await browser.newPage({ viewport: { width: 1000, height: 700 } });
            const local = [];
            page.on('pageerror', error => local.push(error.message));
            await page.goto(`${origin}/bare/journeys?live=${encodeURIComponent(`${origin}/trap/live`)}&data=${encodeURIComponent(`${origin}/trap/data`)}`); await page.waitForTimeout(1200);
            await page.goto(`${origin}/bare/run?run=${encodeURIComponent(`${origin}/trap/run`)}`); await page.waitForTimeout(1200);
            await page.goto(`${origin}/bare/workflow?workflow=${encodeURIComponent(`${origin}/trap/workflow`)}&journal=${encodeURIComponent(`${origin}/trap/journal`)}`); await page.waitForTimeout(1200);
            const tried = await page.evaluate(async trap => { const out = []; try { await fetch(trap); out.push('fetch'); } catch { /* refused */ } for (const name of ['XMLHttpRequest', 'EventSource', 'WebSocket']) { try { new window[name](trap); out.push(name); } catch { /* refused */ } } return out; }, `${origin}/trap/direct`);
            check(traps.length === 0 && tried.length === 0 && local.length === 0, `served without any Content-Security-Policy and asked by address (?live, ?data, ?run, ?workflow) to load from a server, the widgets make no request (${traps.length} reached it${local.length ? `; errors: ${local.join(' | ')}` : ''})`);
            await conformance(page); await page.close();
        }
        // --- ChatGPT globals instead of the JSON-RPC bridge
        {
            const page = await browser.newPage({ viewport: { width: 1100, height: 700 } });
            page.on('pageerror', error => problems.push(`openai globals: ${error.message}`));
            page.on('request', request => requests.push(request.url()));
            const heights = [];
            await page.exposeFunction('reportHeight', h => heights.push(h));
            await page.addInitScript(result => { window.openai = { toolOutput: result.structuredContent, toolResponseMetadata: result._meta, theme: 'light', displayMode: 'inline', maxHeight: 520, notifyIntrinsicHeight: h => window.reportHeight(h), requestDisplayMode: async p => p, callTool: async () => ({}) }; }, R.workflow);
            await page.goto(`${origin}/widget/workflow`); await settle(page);
            check(await page.locator('.node').count() > 5 && await page.evaluate(() => document.documentElement.dataset.awaTheme) === 'light' && heights.length > 0 && heights.every(h => h <= 520),
                `window.openai: with ChatGPT's globals and no JSON-RPC host the widget still draws, takes the theme and reports a height within maxHeight (${[...new Set(heights)].join(', ')})`);
            await conformance(page); await page.close();
        }
        check(sent.invalid.length === 0 && Object.keys(SCHEMAS).every(method => sent.methods.has(method)), `all ${sent.count} messages the widgets sent (${[...sent.methods].join(', ')}) are valid against the MCP Apps SDK's schemas${sent.invalid.length ? `: ${sent.invalid.slice(0, 4).join(' | ')}` : ''}`);
        check(apps.McpUiInitializeResultSchema.safeParse({ protocolVersion: '2026-01-26', hostInfo: { name: 'AWA verification host', version: '1' }, hostCapabilities: {}, hostContext: { theme: 'dark', displayMode: 'inline', availableDisplayModes: ['inline', 'fullscreen'], containerDimensions: { maxHeight: 640 } } }).success
            && apps.McpUiToolResultNotificationSchema.safeParse({ method: 'ui/notifications/tool-result', params: R.run }).success
            && apps.McpUiResourceMetaSchema.safeParse({ prefersBorder: true, csp: { connectDomains: [], resourceDomains: [] } }).success, 'what the test host answers, a real tool result and the resource metadata are valid against the same schemas');
        check(problems.length === 0, `no page error and no console error in any widget${problems.length ? `: ${problems.slice(0, 6).join(' | ')}` : ''}`);
        const outside = requests.filter(url => !url.startsWith(origin));
        const inside = [...new Set(requests.map(url => new URL(url).pathname.replace(/^\/(host|widget)\/.*/, '/$1')))];
        check(traps.length === 0, 'nothing reached the trap address of the test server during the whole run');
        check(outside.length === 0 && inside.every(p => p === '/host' || p === '/widget'), `no network request beyond the host page and the widget document itself (${requests.length} requests, ${outside.length} elsewhere)`);
    } finally { await browser.close(); }
}
if (!args.includes('--serve-only')) {
    await new Promise(resolve => web.close(resolve));
    const failed = results.filter(r => !r.ok);
    fs.writeFileSync(path.join(output, 'verification.json'), JSON.stringify({ passed: failed.length === 0, checks: results.length, failed: failed.length, results, note: 'A fake MCP Apps host in Chromium. Not a test inside ChatGPT or Claude.' }, null, 2));
    console.log(`\n${results.length - failed.length} of ${results.length} checks passed${failed.length ? `; ${failed.length} failed` : ''}. Screenshots: ${output}`);
    process.exit(failed.length ? 1 : 0);
}
