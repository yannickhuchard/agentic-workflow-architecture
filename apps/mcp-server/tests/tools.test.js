import { test } from 'node:test';
import assert from 'node:assert/strict';
import { z } from 'zod';
import { connect, call, read, text_of, workflow, id } from './helpers.js';
import { WIDGETS } from '../src/widgets.js';
import { LIMITS } from '../src/limits.js';
import { json_problem, duration_ms } from '../src/schemas.js';

const settlement = () => read('examples/claims-settlement/claims-settlement.awa.json');
const purchase = () => read('examples/claims-journey/policy-purchase.awa.json');
const purchase_journey = () => read('examples/claims-journey/policy-purchase.journey.json');
const outputs = () => read('examples/claims-journey/simulation.json');
/** The arguments are refused before the tool runs: as a protocol error, or as an error result, depending on the SDK */
async function refuses(promise, pattern, message) {
    let text;
    try { const result = await promise; assert.equal(result.isError, true, message || 'the call was accepted'); text = text_of(result); }
    catch (error) { if (error.code === 'ERR_ASSERTION') throw error; text = error.message; }
    assert.match(text, /Invalid arguments|Input validation/, message);
    assert.match(text, pattern, message);
}
const TOOLS = ['validate_document', 'show_workflow', 'simulate_workflow', 'show_journeys', 'simulate_journey', 'load_claims_example', 'show_dashboard', 'make_dossier'];

test('discovery: tools, annotations, security schemes, widget metadata and resources', async t => {
    const client = await connect(t);
    const { tools } = await client.listTools();
    assert.deepEqual(tools.map(x => x.name), TOOLS);
    for (const tool of tools) {
        assert.match(tool.name, /^[a-z]+(_[a-z]+)+$/);
        assert.deepEqual(tool.annotations, { readOnlyHint: true, destructiveHint: false, openWorldHint: false });
        assert.deepEqual(tool._meta.securitySchemes, [{ type: 'noauth' }]);
        assert.equal(tool.inputSchema.type, 'object');
        assert.equal(tool.inputSchema.additionalProperties, false, `${tool.name} accepts unknown properties`);
        assert.ok(tool.title && tool.description.length > 60);
    }
    // The SDK's client drops fields it does not know. ChatGPT reads a top-level securitySchemes: read the list as sent.
    const raw = await client.request({ method: 'tools/list' }, z.object({ tools: z.array(z.looseObject({})) }));
    for (const tool of raw.tools) assert.deepEqual(tool.securitySchemes, [{ type: 'noauth' }], `${tool.name} declares no top-level security scheme`);
    const uris = Object.values(WIDGETS).map(w => w.uri);
    for (const name of TOOLS.filter(n => n !== 'validate_document' && n !== 'make_dossier')) {
        const meta = tools.find(x => x.name === name)._meta;
        assert.ok(uris.includes(meta.ui.resourceUri));
        assert.equal(meta['openai/outputTemplate'], meta.ui.resourceUri);
        assert.equal(meta['openai/widgetAccessible'], true);
        assert.ok(meta['openai/toolInvocation/invoking'] && meta['openai/toolInvocation/invoked']);
    }
    assert.equal(tools.find(x => x.name === 'validate_document')._meta.ui, undefined);
    assert.equal(tools.find(x => x.name === 'make_dossier')._meta.ui, undefined);


    const { resources } = await client.listResources();
    assert.deepEqual(resources.map(r => r.uri).sort(), [...uris].sort());
    for (const uri of uris) {
        assert.match(uri, /^ui:\/\/awa\/[a-z-]+-v\d+\.html$/);
        const { contents: [content] } = await client.readResource({ uri });
        assert.equal(content.mimeType, 'text/html;profile=mcp-app');
        assert.deepEqual(content._meta.ui.csp, { connectDomains: [], resourceDomains: [] });
        assert.deepEqual(content._meta['openai/widgetCSP'], { connect_domains: [], resource_domains: [] });
        assert.ok(content._meta['openai/widgetDescription'].length > 40);
        assert.match(content.text, /^<!doctype html>/i);
    }
    assert.match(client.getInstructions(), /simulat/i);
});

test('a widget domain is declared only when configured, and only as an https origin', async t => {
    const { createMcpServer } = await import('../src/server.js');
    const { Client } = await import('@modelcontextprotocol/sdk/client/index.js');
    const { InMemoryTransport } = await import('@modelcontextprotocol/sdk/inMemory.js');
    const server = await createMcpServer({ widget_domain: 'https://widgets.example.org' });
    const [a, b] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: 't', version: '1' });
    await server.connect(a); await client.connect(b);
    t.after(() => client.close());
    const meta = (await client.readResource({ uri: 'ui://awa/journeys-v3.html' })).contents[0]._meta;
    assert.equal(meta.ui.domain, 'https://widgets.example.org'); assert.equal(meta['openai/widgetDomain'], 'https://widgets.example.org');
    assert.deepEqual(meta.ui.csp, { connectDomains: [], resourceDomains: [] });
    await assert.rejects(createMcpServer({ widget_domain: 'http://widgets.example.org' }), /https origin/);
    await assert.rejects(createMcpServer({ widget_domain: 'https://widgets.example.org/path' }), /https origin/);
    const plain = (await (await connect(t)).readResource({ uri: 'ui://awa/journeys-v3.html' })).contents[0]._meta;
    assert.equal('domain' in plain.ui, false); assert.equal('openai/widgetDomain' in plain, false);
});

test('validate_document: a valid workflow, a broken one in plain words, a journey with and without its workflows', async t => {
    const client = await connect(t);
    const ok = await call(client, 'validate_document', { document: settlement() });
    assert.equal(ok.structuredContent.valid, true); assert.equal(ok.structuredContent.kind, 'workflow');
    assert.equal(ok.structuredContent.parsed, undefined, 'the parsed document is not echoed back');

    const wrapped = await call(client, 'validate_document', { document: { workflow: settlement() } });
    assert.equal(wrapped.structuredContent.valid, true, 'the envelope form { workflow } is accepted');

    const bad = await call(client, 'validate_document', { document: { name: 'Broken', activities: [{ name: 'Pick' }], edges: [] } });
    assert.equal(bad.isError, undefined, 'an invalid document is an answer, not a tool error');
    assert.equal(bad.structuredContent.valid, false);
    const problems = bad.structuredContent.problems.map(p => `${p.where} ${p.problem}`);
    assert.ok(problems.some(p => /activity "Pick", role_id is missing/.test(p)), problems.join(' | '));
    assert.ok(problems.some(p => /actor_type must be one of "human", "ai_agent", "robot", "application"/.test(p)));
    assert.match(text_of(bad), /is not valid\. \d+ problems?:/);

    const dangling = settlement(); dangling.edges[0].target_id = id();
    const integrity = await call(client, 'validate_document', { document: dangling });
    assert.equal(integrity.structuredContent.valid, false);
    assert.ok(integrity.structuredContent.problems.some(p => p.code === 'invalid_reference'));

    const expression = settlement(); expression.edges.find(e => e.condition).condition = 'a ===';
    assert.ok((await call(client, 'validate_document', { document: expression })).structuredContent.problems.some(p => p.code === 'invalid_expression'));

    const alone = await call(client, 'validate_document', { document: purchase_journey() });
    assert.equal(alone.structuredContent.kind, 'journey'); assert.equal(alone.structuredContent.valid, true);
    assert.ok(alone.structuredContent.warnings.some(w => w.code === 'workflows_not_given'));
    const together = await call(client, 'validate_document', { document: purchase_journey(), workflows: [purchase()] });
    assert.equal(together.structuredContent.valid, true); assert.equal(together.structuredContent.warnings.length, 0);
    const wrong = await call(client, 'validate_document', { document: purchase_journey(), workflows: [settlement()] });
    assert.equal(wrong.structuredContent.valid, false, 'a journey that refers to a workflow that was not given is reported');

    const unknown = await call(client, 'validate_document', { document: { hello: 'world' } });
    assert.equal(unknown.structuredContent.kind, 'unknown'); assert.equal(unknown.structuredContent.valid, false);
});

test('show_workflow: the data view names actors, roles, contexts, access and data items', async t => {
    const client = await connect(t);
    const orders = read('examples/order-processing/order-processing.awa.json');
    const result = await call(client, 'show_workflow', { workflow: orders });
    const data = result.structuredContent;
    assert.equal(data.counts.activities, orders.activities.length);
    assert.ok(data.contexts.length === orders.contexts.length && data.contexts.some(c => c.read_by.length || c.written_by.length));
    assert.ok(data.activities.some(a => a.access.length) && data.activities.every(a => a.actor_type));
    assert.ok(data.roles.every(r => r.actor_type) && Object.keys(data.actor_types).length >= 2);
    assert.equal(result._meta.awa.view, 'workflow');
    assert.equal(result._meta.awa.workflow.id, orders.id);
    assert.match(text_of(result), /activities, .*decision/);

    const retail = await call(client, 'show_workflow', { workflow: read('examples/retail-distribution/workflow.awa.json') });
    assert.ok(retail.structuredContent.data.some(d => d.produced_by.length && d.consumed_by.length), 'data produced by one activity and used by another is linked');

    const invalid = await call(client, 'show_workflow', { workflow: { name: 'x', activities: [], edges: 'no' } });
    assert.equal(invalid.isError, true); assert.match(text_of(invalid), /not valid/);
    const journey = await call(client, 'show_workflow', { workflow: purchase_journey() });
    assert.equal(journey.isError, true); assert.match(text_of(journey), /not an AWA workflow/);
});

test('simulate_workflow: a scripted run completes; an unscripted one says what to supply; waits, events and cost', async t => {
    const client = await connect(t);
    const done = await call(client, 'simulate_workflow', {
        workflow: settlement(), simulated_outputs: read('examples/claims-settlement/simulation.json'), let_waits_time_out: true,
        pricing: { currency: 'EUR', software_cost_per_execution: 0.5 },
    });
    const s = done.structuredContent;
    assert.equal(s.simulated, true); assert.equal(s.status, 'completed');
    assert.deepEqual(s.path.slice(0, 2), ['Register claim', 'Assess damage']);
    assert.equal(s.decisions[0].decision, 'Settlement route'); assert.equal(s.decisions[0].rule, 'Small and clean');
    assert.ok(s.tool_calls.length && s.tool_calls.every(c => c.simulated));
    assert.equal(s.cost.currency, 'EUR'); assert.ok(s.cost.amount > 0, 'cost is computed from the rates given');
    assert.equal(done._meta.awa.view, 'run'); assert.equal(done._meta.awa.journal.length, s.journal_events);
    assert.equal(done._meta.awa.journal[0].data.simulate, true, 'the journal itself records that the run is simulated');
    assert.match(text_of(done), /^Simulated run of Motor Claim Settlement: completed/);
    assert.match(text_of(done), /nothing was executed/);

    const bare = await call(client, 'simulate_workflow', { workflow: settlement() });
    assert.equal(bare.structuredContent.status, 'failed');
    assert.equal(bare.structuredContent.failures[0].code, 'CONTRACT_VIOLATION');
    assert.match(bare.structuredContent.hint, /simulated_outputs/);
    assert.equal(bare.structuredContent.cost, undefined, 'no cost without rates');

    const waiting = await call(client, 'simulate_workflow', { workflow: purchase(), input: { customer_id: 'c-1' }, simulated_outputs: outputs() });
    assert.equal(waiting.structuredContent.status, 'waiting_event');
    assert.equal(waiting.structuredContent.waiting_for[0].event, 'quote.accepted');

    const events = [['quote.accepted', { quote_accepted: true }], ['contract.signed', { signed: true }], ['payment.received', { amount: 600 }]]
        .map(([type, data]) => ({ type, data: { customer_id: 'c-1', ...data }, after: 'PT1H' }));
    const through = await call(client, 'simulate_workflow', { workflow: purchase(), input: { customer_id: 'c-1' }, simulated_outputs: outputs(), events, start_time: '2026-03-02T09:00:00Z' });
    assert.equal(through.structuredContent.status, 'completed');
    assert.deepEqual(through.structuredContent.events_delivered, events.map(e => e.type));
    assert.equal(through._meta.awa.journal[0].time, '2026-03-02T09:00:00.000Z', 'the simulated clock starts where asked');

    const expired = await call(client, 'simulate_workflow', { workflow: purchase(), input: { customer_id: 'c-1' }, simulated_outputs: outputs(), let_waits_time_out: true });
    assert.ok(expired.structuredContent.waits_timed_out >= 1); assert.notEqual(expired.structuredContent.status, 'waiting_event');

    const scripted_failure = await call(client, 'simulate_workflow', { workflow: workflow([{ name: 'Call bank' }]), simulated_outputs: { 'Call bank': { error: 'Bank is down', code: 'TIMEOUT' } } });
    assert.equal(scripted_failure.structuredContent.status, 'failed'); assert.match(scripted_failure.structuredContent.failures[0].message, /Bank is down/);
});

test('simulate_journey and show_journeys: events move journeys; nothing starts without a starting event; a portfolio is shown as given', async t => {
    const client = await connect(t);
    const args = {
        journeys: [purchase_journey()], workflows: [purchase()], simulated_outputs: outputs(), start_time: '2026-03-02T09:00:00Z',
        events: [
            { type: 'quote.requested', data: { customer_id: 'c-1', name: 'Ada' } },
            { type: 'quote.requested', data: { customer_id: 'c-2', name: 'Ben' }, after: 'PT1H' },
            { type: 'quote.accepted', data: { customer_id: 'c-1', quote_accepted: true }, at: '2026-03-02T15:00:00Z' },
        ],
    };
    const simulated = await call(client, 'simulate_journey', { ...args, then_wait: 'P10D' });
    const s = simulated.structuredContent;
    assert.equal(s.simulated, true); assert.equal(s.journeys.length, 1);
    assert.deepEqual(s.journeys[0].customers.map(c => c.name), ['Ada', 'Ben']);
    assert.deepEqual(s.events_played.map(e => [e.type, e.time, e.started_runs, e.resumed_runs]), [
        ['quote.requested', '2026-03-02T09:00:00.000Z', 1, 0], ['quote.requested', '2026-03-02T10:00:00.000Z', 1, 0], ['quote.accepted', '2026-03-02T15:00:00.000Z', 0, 1]]);
    assert.match(s.journeys[0].customers[1].outcome, /stalled/i, 'ten simulated days later the customer who never answered is stalled');
    assert.equal(simulated._meta.awa.view, 'journeys'); assert.equal(simulated._meta.awa.source, 'simulated');
    assert.ok(simulated._meta.awa.story.journeys[0].instances[0].beats.length > 5);
    assert.match(text_of(simulated), /^Simulated: 1 journey, 2 journey records/);

    const shown = await call(client, 'show_journeys', args);
    assert.equal(shown.structuredContent.journeys[0].customers.length, 2);

    const nothing = await call(client, 'show_journeys', { journeys: [purchase_journey()], workflows: [purchase()], events: [{ type: 'quote.accepted', data: { customer_id: 'c-1' } }] });
    assert.equal(nothing.structuredContent.journeys.length, 0); assert.match(text_of(nothing), /No journey has started/);
    assert.equal(nothing._meta.awa.story.journeys.length, 0);

    const duplicate = await call(client, 'simulate_journey', { ...args, events: [{ type: 'quote.requested', data: { customer_id: 'c-1' }, id: 'e-1' }, { type: 'quote.requested', data: { customer_id: 'c-1' }, id: 'e-1' }] });
    assert.deepEqual(duplicate.structuredContent.events_played.map(e => e.accepted), [true, false], 'the same event id is taken in once');

    const missing = await call(client, 'simulate_journey', { journeys: [purchase_journey()], workflows: [settlement()], events: args.events });
    assert.equal(missing.isError, true); assert.match(text_of(missing), /Journey 1 is not valid/);

    const both = await call(client, 'show_journeys', { portfolio: { journeys: [], workflows: [] }, journeys: [purchase_journey()], workflows: [purchase()] });
    assert.equal(both.isError, true);
    const neither = await call(client, 'show_journeys', {});
    assert.equal(neither.isError, true);
    const not_portfolio = await call(client, 'show_journeys', { portfolio: { journeys: [{ definition: {}, instances: 3 }], workflows: [] } });
    assert.equal(not_portfolio.isError, true); assert.match(text_of(not_portfolio), /not a journey portfolio export/);
    const garbage = await call(client, 'show_journeys', { portfolio: { journeys: [{ definition: { stages: [] }, instances: [{ instance: { subject_key: 'x', events: [{}], runs: [{}], data: {} }, runs: [{ events: 'no' }] }] }], workflows: [{}] } });
    assert.ok(garbage.isError === true || garbage.structuredContent, 'a malformed portfolio gives an error or an empty view, never a crash');
});

test('load_claims_example: the bundled example, marked fictional, and its documents work with the other tools', async t => {
    const client = await connect(t);
    const example = await call(client, 'load_claims_example');
    assert.equal(example.structuredContent.fictional, true);
    assert.deepEqual(example.structuredContent.journeys.map(j => [j.name, j.customers.length]), [['Policy Purchase', 6], ['Motor Claim', 6], ['Policy Renewal', 6]]);
    assert.equal(example._meta.awa.story.journeys.length, 3);
    assert.match(text_of(example), /fictional/);
    for (const name of example.structuredContent.documents.filter(n => /workflow$/.test(n))) {
        const document = (await call(client, 'load_claims_example', { document: name })).structuredContent.document.content;
        assert.equal((await call(client, 'validate_document', { document })).structuredContent.valid, true, name);
    }
    const journey = (await call(client, 'load_claims_example', { document: 'policy-purchase.journey' })).structuredContent.document.content;
    const wf = (await call(client, 'load_claims_example', { document: 'policy-purchase.workflow' })).structuredContent.document.content;
    const sim = (await call(client, 'load_claims_example', { document: 'simulated-outputs' })).structuredContent.document.content;
    const played = await call(client, 'simulate_journey', { journeys: [journey], workflows: [wf], simulated_outputs: sim, events: [{ type: 'quote.requested', data: { customer_id: 'c-1' } }] });
    assert.equal(played.structuredContent.journeys[0].customers.length, 1);
    await refuses(call(client, 'load_claims_example', { document: '../../package.json' }), /Invalid arguments|Invalid option/);
});

test('inputs are strict and bounded', async t => {
    const client = await connect(t);
    await refuses(call(client, 'show_workflow', { workflow: settlement(), extra: true }), /Unrecognized key/);
    await refuses(call(client, 'show_workflow', {}), /Invalid arguments/);
    await refuses(call(client, 'show_workflow', { workflow: 'https://example.com/workflow.json' }), /Invalid arguments/, 'a document is given inline, never by address');
    await refuses(call(client, 'simulate_workflow', { workflow: settlement(), simulated_outputs: { A: { output: {}, run: 'rm -rf' } } }), /Unrecognized key/);
    await refuses(call(client, 'simulate_workflow', { workflow: settlement(), events: [{ type: 'a b' }] }), /event type/i);
    await refuses(call(client, 'simulate_workflow', { workflow: settlement(), pricing: { currency: 'euros' } }), /Invalid arguments/);
    await refuses(call(client, 'simulate_journey', { journeys: [purchase_journey()], workflows: [purchase()], events: [] }), /Invalid arguments/);
    await refuses(call(client, 'simulate_journey', { journeys: [purchase_journey()], workflows: [purchase()], events: Array.from({ length: LIMITS.events + 1 }, () => ({ type: 'x' })) }), /Invalid arguments/);
    await refuses(call(client, 'simulate_journey', { journeys: [purchase_journey()], workflows: Array.from({ length: LIMITS.workflows + 1 }, purchase), events: [{ type: 'x' }] }), /Invalid arguments/);
    await refuses(call(client, 'simulate_journey', { journeys: [purchase_journey()], workflows: [purchase()], events: [{ type: 'x', after: '1 hour' }] }), /ISO 8601 duration/);

    const big = settlement(); big.description = 'x'.repeat(LIMITS.document_bytes);
    await refuses(call(client, 'validate_document', { document: big }), /the limit is 400 kB/);
    let deep = {}; const top = deep; for (let i = 0; i < LIMITS.json_depth + 5; i++) { deep.child = {}; deep = deep.child; }
    await refuses(call(client, 'validate_document', { document: { ...settlement(), metadata: top } }), /nested more than/);
    const polluted = { ...settlement(), metadata: JSON.parse('{"a":{"__proto__":{"polluted":true}}}') };
    await refuses(call(client, 'validate_document', { document: polluted }), /__proto__/);
    assert.equal({}.polluted, undefined);

    assert.equal(json_problem({ a: [1, { b: 2 }] }, 1000), undefined);
    assert.match(json_problem({ a: 'x'.repeat(2000) }, 1000), /limit/);
    assert.equal(duration_ms('P1DT2H3M4.5S'), ((24 + 2) * 3600 + 3 * 60 + 4.5) * 1000); assert.equal(duration_ms('P2W'), 14 * 86400000);
});

test('nothing is kept between calls or between servers', async t => {
    const client = await connect(t);
    const args = { journeys: [purchase_journey()], workflows: [purchase()], simulated_outputs: outputs(), events: [{ type: 'quote.requested', data: { customer_id: 'c-1', name: 'Ada' }, id: 'only-once' }] };
    const first = await call(client, 'simulate_journey', args);
    const second = await call(client, 'simulate_journey', args);
    assert.deepEqual(second.structuredContent.events_played.map(e => e.accepted), [true], 'an event id seen in an earlier call is new again: no runtime survives a call');
    assert.equal(second.structuredContent.journeys[0].customers.length, 1, 'records of an earlier call do not accumulate');
    assert.notEqual(first._meta.awa.story.journeys[0].instances[0].runs[0].run_id, second._meta.awa.story.journeys[0].instances[0].runs[0].run_id);
    // A follow-up event for a journey started in an earlier call finds nothing
    const later = await call(client, 'simulate_journey', { ...args, events: [{ type: 'quote.accepted', data: { customer_id: 'c-1', quote_accepted: true } }] });
    assert.equal(later.structuredContent.journeys.length, 0);
    const other = await connect(t);
    assert.equal((await call(other, 'show_journeys', { journeys: args.journeys, workflows: args.workflows })).structuredContent.journeys.length, 0);
});

test('show_dashboard: measures of the example, of a simulation and of a portfolio; nothing but what the measures read leaves the server', async t => {
    const client = await connect(t);
    const example = await call(client, 'show_dashboard', { use_claims_example: true });
    const s = example.structuredContent;
    assert.equal(s.simulated, true);
    assert.deepEqual(s.totals['journey.started'], { value: 18, of: 18 });
    assert.equal(s.needs_someone_now.length, 2);
    assert.equal(s.journeys.length, 3); assert.equal(s.workflows.length, 5);
    assert.match(text_of(example), /18 journeys and 25 runs \(simulated\)/);
    assert.match(text_of(example), /Quote counts with rates/);
    const record = example._meta.awa.record;
    assert.equal(example._meta.awa.view, 'dashboard');
    // The widget is given what happened and when, never what was said: no input, output, reasoning or tool result
    const sent = JSON.stringify(record);
    for (const word of ['"input"', '"output"', '"result"', '"rationale"', '"plan"', '"arguments"', '"binding"']) assert.ok(!sent.includes(word), `${word} is not sent to the widget`);
    assert.ok(sent.length < 200_000, `the record sent is small (${sent.length} bytes)`);

    const simulated = await call(client, 'show_dashboard', {
        journeys: [purchase_journey()], workflows: [purchase()], simulated_outputs: outputs(), start_time: '2026-03-02T09:00:00Z', then_wait: 'P10D',
        events: [{ type: 'quote.requested', data: { customer_id: 'c-1', name: 'Ada' } }, { type: 'quote.requested', data: { customer_id: 'c-2', name: 'Ben' }, after: 'PT1H' }],
    });
    assert.deepEqual(simulated.structuredContent.totals['journey.started'], { value: 2, of: 2 });
    assert.equal(simulated.structuredContent.totals['journey.completion_rate'].value, 0);
    assert.equal(simulated.structuredContent.journeys[0]['journey.duration_median_ms'], null, 'nothing completed: no value, not zero');

    const later = await call(client, 'show_dashboard', { use_claims_example: true, from: '2999-01-01T00:00:00Z' });
    assert.match(text_of(later), /nothing to measure/);
    assert.deepEqual(later._meta.awa.period, { from: '2999-01-01T00:00:00Z' }, 'the widget is given the period the tool was asked for');
    assert.equal(example._meta.awa.period, undefined);
    const none = await call(client, 'show_dashboard', {});
    assert.equal(none.isError, true); assert.match(text_of(none), /exactly one of/);
    const two = await call(client, 'show_dashboard', { use_claims_example: true, portfolio: { journeys: [], workflows: [] } });
    assert.equal(two.isError, true);
    const not = await call(client, 'show_dashboard', { portfolio: { hello: 1 } });
    assert.equal(not.isError, true); assert.match(text_of(not), /not a journey portfolio export/);
});

test('a brand: a DESIGN.md text or a brand.json goes to the view as given, checked; a logo by address and an unreadable brand are refused', async t => {
    const client = await connect(t);
    const design = '---\nname: Valoria Life\ncolors:\n  primary: "#0E7C66"\n  surface: "#F6F7FB"\n  on-surface: "#0F172A"\n  error: oklch(0.6 0.2 25)\ntypography:\n  headline-lg: { fontFamily: Space Grotesk }\nrounded:\n  md: 8px\n---\n# Valoria Life\n';
    const shown = await call(client, 'show_dashboard', { use_claims_example: true, brand: design });
    assert.equal(shown.isError, undefined, text_of(shown));
    assert.equal(shown._meta.awa.brand, design, 'the view is given the brand as it was sent');
    assert.equal(shown.structuredContent.brand.name, 'Valoria Life');
    assert.ok(shown.structuredContent.brand.warnings.some(w => /colors\.error/.test(w)), 'a colour the view cannot read is reported, with its token');
    const logo = 'data:image/svg+xml;base64,' + Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 8 8"><rect width="8" height="8" fill="#0E7C66"/></svg>').toString('base64');
    const json = { name: 'Valoria Life', logo, colors: { primary: '#0E7C66', surface: '#F6F7FB' }, mode: 'light' };
    for (const [tool, args] of [['load_claims_example', {}], ['show_workflow', { workflow: settlement() }], ['simulate_workflow', { workflow: settlement() }]]) {
        const result = await call(client, tool, { ...args, brand: json });
        assert.equal(result.isError, undefined, `${tool}: ${text_of(result)}`);
        assert.deepEqual(result._meta.awa.brand, json, `${tool} passes the brand to its view`);
    }
    const plain = await call(client, 'load_claims_example', {});
    assert.equal(plain._meta.awa.brand, undefined); assert.equal(plain.structuredContent.brand, undefined);
    const remote = await call(client, 'show_dashboard', { use_claims_example: true, brand: { ...json, logo: 'https://example.com/logo.svg' } });
    assert.equal(remote.isError, true); assert.match(text_of(remote), /logo must be a data: URL/);
    const broken = await call(client, 'show_dashboard', { use_claims_example: true, brand: '{ not json' });
    assert.equal(broken.isError, true); assert.match(text_of(broken), /could not be read/);
    await refuses(call(client, 'show_dashboard', { use_claims_example: true, brand: { __proto__: null, constructor: 1 } }), /constructor/);
    const { tools } = await client.listTools();
    for (const name of TOOLS.filter(n => n !== 'validate_document' && n !== 'make_dossier')) {
        const tool = tools.find(x => x.name === name);
        assert.ok(tool.inputSchema.properties.brand && /DESIGN\.md/.test(tool.description), `${name} takes a brand and says so`);
        assert.deepEqual(tool.annotations, { readOnlyHint: true, destructiveHint: false, openWorldHint: false });
    }
});

test('simulate_workflow: context bindings are enforced; a script may write contexts, and a missing one is explained', async t => {
    const client = await connect(t);
    const orders = read('examples/order-processing/order-processing.awa.json');
    const scripted = await call(client, 'simulate_workflow', { workflow: orders, simulated_outputs: read('examples/order-processing/simulation.json') });
    assert.equal(scripted.structuredContent.status, 'completed');
    const journal = scripted._meta.awa.journal.map(e => e.type);
    assert.ok(journal.includes('context.written') && journal.includes('context.read'));
    // Without the script that writes the order, the activity that must read it cannot start
    const outputs = read('examples/order-processing/simulation.json');
    delete outputs['Receive Order'];
    const bare = await call(client, 'simulate_workflow', { workflow: orders, simulated_outputs: outputs });
    assert.equal(bare.structuredContent.status, 'failed');
    assert.equal(bare.structuredContent.failures[0].code, 'CONTEXT_MISSING');
    assert.match(bare.structuredContent.context_hint, /initial_value/);
    // A write the bindings do not allow is refused by the engine, in a simulation as anywhere
    const denied = await call(client, 'simulate_workflow', { workflow: orders, simulated_outputs: { ...read('examples/order-processing/simulation.json'), 'Notify Customer': { contexts: { 'Order Data': { status: 'tampered' } } } } });
    assert.equal(denied.structuredContent.failures[0].code, 'CONTEXT_ACCESS_DENIED');
});

test('make_dossier: the HTML dossier of the example, a client edition that names no one else, and refusals', async t => {
    const client = await connect(t);
    const made = await call(client, 'make_dossier', { use_claims_example: true });
    const html = made.content.find(c => c.type === 'resource').resource;
    assert.equal(html.mimeType, 'text/html');
    assert.match(html.text, /^<!doctype html>/);
    assert.ok(!/<script[^>]*\ssrc=/i.test(html.text), 'the dossier loads no script from anywhere');
    assert.ok(made.structuredContent.sentences > 3 && made.structuredContent.references >= made.structuredContent.sentences);
    const portfolio = read('examples/claims-journey/journeys.json');
    const key = portfolio.journeys[0].instances[0].instance.subject_key;
    const mine = await call(client, 'make_dossier', { portfolio, edition: 'client', customer: key });
    assert.equal(mine.structuredContent.edition, 'client');
    assert.equal(mine.structuredContent.personas.length, 1);
    const none = await call(client, 'make_dossier', {});
    assert.equal(none.isError, true);
    assert.match(text_of(none), /portfolio, or use_claims_example/);
});
