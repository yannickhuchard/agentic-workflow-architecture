// The AWA MCP server: tools that validate, show and simulate AWA workflows and
// journeys, and the MCP Apps widgets that show the results.
//
// Stateless: every document arrives inline with the call, and nothing is kept
// when the call returns. Simulation only: see src/simulation.js.
import { z } from 'zod';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { registerAppResource, registerAppTool, RESOURCE_MIME_TYPE } from '@modelcontextprotocol/ext-apps/server';
import { RELEASE, brand_module, dossier_modules } from './sdk.js';
import { LIMITS } from './limits.js';
import * as S from './schemas.js';
import { WIDGETS, widget_html } from './widgets.js';
import { DocumentError, validate_document, require_workflow, require_journey, require_portfolio, workflow_data_view, run_summary, build_story, story_summary, sentences, recommend } from './awa.js';
import { simulate_workflow_run, simulate_journeys } from './simulation.js';
import { EXAMPLE_DOCUMENTS, example_document, example_story, example_portfolio } from './example.js';
import { measured_record, measure } from './measures.js';

export const SERVER_NAME = 'awa-workflows';
export const INSTRUCTIONS = [
    'AWA (Agentic Workflow Architecture) documents describe workflows (activities done by people, AI agents, robots and applications, with decisions, events and the data that moves) and customer journeys (stages, business events, touchpoints, mood).',
    'Pass documents inline as JSON. Nothing is stored between calls.',
    'Everything this server runs is a simulation: no tool, command, HTTP call, model or production system is ever called. Say "simulated" when you report a run or a journey, and never present a simulated result as something that happened.',
    'A simulated activity returns no business data unless you script it with simulated_outputs. When a run stops with NO_ROUTE or CONTRACT_VIOLATION, supply outputs for the named activities and simulate again.',
    'Validate a document before showing or simulating it when the user wrote or edited it. Report problems in the plain words the tool returns.',
    'If the user has no document yet, call load_claims_example.',
].join(' ');

/**
 * A brand given to a tool, checked as the view will read it: refused when it cannot be read or its logo is not a data: URL.
 * Returns undefined without a brand, else { brand: what the view is given, warnings: what the view will leave out or adjust }.
 */
function brand_of(given) {
    if (given === undefined) return undefined;
    const B = brand_module(), read = B.read_brand(given, { data_only: true });
    if (read.invalid) throw new DocumentError(`The brand could not be read: ${read.warnings.join(' ')}`);
    const logo = read.warnings.find(w => /must be a data: URL/.test(w));
    if (logo) throw new DocumentError(`The brand's ${logo.split(' ')[0]} must be a data: URL (such as data:image/svg+xml;base64,...): this server reaches no network, and neither does the view.`);
    const warnings = [...read.warnings, ...B.palette(read, { prefers_dark: true }).warnings].map(w => String(w).slice(0, 300)).slice(0, 20);
    return { brand: given, name: read.name, warnings };
}
/** The parts of a result a brand adds: in the summary, its name and what was adjusted; for the view, the brand itself */
const with_brand = (branded, structured, meta) => (branded
    ? [{ ...structured, brand: { name: branded.name || null, warnings: branded.warnings } }, { ...meta, awa: { ...meta.awa, brand: branded.brand } }]
    : [structured, meta]);

const text_result = (text, structuredContent, meta) => ({ content: [{ type: 'text', text }], ...(structuredContent ? { structuredContent } : {}), ...(meta ? { _meta: meta } : {}) });
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

/** Journeys built from documents and events, or an explanation of why there is nothing to show */
async function play(args) {
    const workflows = [];
    for (const [i, document] of args.workflows.entries()) workflows.push(await require_workflow(document, `Workflow ${i + 1}`));
    if (new Set(workflows.map(w => w.id)).size !== workflows.length) throw new DocumentError('Two of the workflows have the same id.');
    const journeys = [];
    for (const [i, document] of args.journeys.entries()) journeys.push(await require_journey(document, workflows, `Journey ${i + 1}`));
    if (new Set(journeys.map(j => j.id)).size !== journeys.length) throw new DocumentError('Two of the journeys have the same id.');
    const start = args.start_time ? Date.parse(args.start_time) : Date.now();
    const events = (args.events || []).map(e => ({ type: e.type, data: e.data, id: e.id, at: e.at ? Date.parse(e.at) : undefined, after_ms: S.duration_ms(e.after) }));
    const outputs = scripted(args.simulated_outputs);
    const result = await simulate_journeys(workflows, journeys, events, {
        outputs, tool_results: args.simulated_tool_results, pricing: args.pricing, start_time: start, end_after_ms: S.duration_ms(args.then_wait),
    });
    const has_instances = result.portfolio.journeys.some(j => j.instances.length);
    const story = has_instances ? build_story(result.portfolio) : { journeys: [] };
    return { result, story, journeys, workflows };
}

/** simulated_outputs as the engine reads them: durations in milliseconds */
function scripted(outputs) {
    if (!outputs) return undefined;
    const step = s => ({ ...s, ...(s.duration ? { duration_ms: S.duration_ms(s.duration) } : {}) });
    return Object.fromEntries(Object.entries(outputs).map(([name, entry]) => [name, { ...step(entry), ...(entry.attempts ? { attempts: entry.attempts.map(step) } : {}) }]));
}

function journeys_result(story, played, extra = {}, branded, portfolio) {
    const summary = story_summary(story);
    const customers = summary.journeys.reduce((n, j) => n + j.customers.length, 0);
    const empty = 'No journey has started: none of the events played is one that begins a journey (a trigger with starts_journey), or its data lacks the property that identifies the subject.';
    const text = summary.journeys.length
        ? `Simulated: ${plural(summary.journeys.length, 'journey')}, ${plural(customers, 'journey record')}. ${summary.journeys.map(j => `${j.name}: ${j.customers.map(c => `${c.name} (${c.outcome || 'under way'})`).join(', ')}`).join('. ')}. Tools and models were simulated; nothing was executed.`
        : empty;
    return text_result(text, ...with_brand(branded, { simulated: true, ...summary, ...(played ? { events_played: played } : {}), ...extra },
        { awa: { view: 'journeys', story, source: 'simulated', ...(summary.journeys.length && portfolio ? { recommendations: recommend(portfolio) } : {}), ...(summary.journeys.length ? {} : { empty }) } }));
}

/**
 * @param options.widget_domain  an https origin declared as the widgets' own domain (_meta.ui.domain). Unset by default;
 *                               set AWA_MCP_WIDGET_DOMAIN if the directory asks for one at submission.
 */
export async function createMcpServer({ widget_domain = process.env.AWA_MCP_WIDGET_DOMAIN } = {}) {
    if (widget_domain !== undefined && widget_domain !== '') {
        let origin; try { origin = new URL(widget_domain); } catch { /* refused below */ }
        if (!origin || origin.protocol !== 'https:' || origin.origin !== widget_domain) throw new Error('AWA_MCP_WIDGET_DOMAIN must be an https origin, such as https://widgets.example.org');
    }
    const domain = widget_domain ? { domain: widget_domain } : {};
    const server = new McpServer({ name: SERVER_NAME, version: RELEASE }, { instructions: INSTRUCTIONS });
    const definitions = [];

    for (const [name, widget] of Object.entries(WIDGETS)) {
        registerAppResource(server, `awa-${name}`, widget.uri, { description: widget.description }, async () => ({
            contents: [{
                uri: widget.uri, mimeType: RESOURCE_MIME_TYPE, text: widget_html(name),
                _meta: {
                    ui: { prefersBorder: true, ...domain, csp: { connectDomains: [], resourceDomains: [] } },
                    'openai/widgetPrefersBorder': true, 'openai/widgetCSP': { connect_domains: [], resource_domains: [] },
                    ...(widget_domain ? { 'openai/widgetDomain': widget_domain } : {}),
                    'openai/widgetDescription': widget.description,
                },
            }],
        }));
    }

    /**
     * Register a tool.
     * @param options.widget   name of the widget in WIDGETS that shows the result, if any
     * @param options.invoking, options.invoked   status lines a host shows while the tool runs and after
     */
    function tool(name, title, description, shape, handler, { widget, invoking, invoked } = {}) {
        const securitySchemes = [{ type: 'noauth' }];
        if (shape.brand) description += ' Pass brand (a DESIGN.md text or a brand.json, with any logo as a data: URL) to show the view in a company\'s colours, fonts and logo; the colours of states keep their meaning.';
        const input = z.strictObject(shape);
        const resourceUri = widget ? WIDGETS[widget].uri : undefined;
        const config = {
            title, description, inputSchema: input,
            // Every tool computes from its arguments and keeps nothing: no data is written, nothing outside the process is reached
            annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
            _meta: {
                securitySchemes,
                ...(widget ? { ui: { resourceUri }, 'openai/outputTemplate': resourceUri, 'openai/widgetAccessible': true, 'openai/toolInvocation/invoking': invoking, 'openai/toolInvocation/invoked': invoked } : {}),
            },
        };
        definitions.push({ name, title, description, inputSchema: z.toJSONSchema(input, { io: 'input' }), annotations: config.annotations, securitySchemes, _meta: config._meta });
        registerAppTool(server, name, config, async args => {
            try { return await handler(args); }
            catch (error) {
                const known = error instanceof DocumentError || error?.name === 'SimulationLimitError';
                return { isError: true, content: [{ type: 'text', text: known ? error.message : `The request could not be completed: ${String(error?.message || error).slice(0, 600)}` }] };
            }
        });
    }

    tool('validate_document', 'Validate an AWA document',
        'Check one AWA workflow or journey document against the AWA schema and its integrity rules (references, condition expressions, durations, decision tables). Returns each problem in plain words with where it is. For a journey, pass the workflows it refers to so that those references are checked. Reads only its arguments; stores nothing.',
        {
            document: S.json_document().describe('The workflow or journey document, as JSON. A workflow may be bare or wrapped as { "workflow": { ... } }.'),
            workflows: S.workflows.optional().describe('For a journey: the workflow documents it refers to.'),
        },
        async args => {
            const related = [];
            for (const [i, document] of (args.workflows || []).entries()) related.push(await require_workflow(document, `Workflow ${i + 1}`));
            const { parsed, ...result } = await validate_document(args.document, related);
            const subject = `${result.kind === 'unknown' ? 'The document' : `The ${result.kind}${result.name ? ` "${result.name}"` : ''}`}`;
            const text = result.valid
                ? `${subject} is valid.${result.warnings.length ? ` ${plural(result.warnings.length, 'remark')}: ${sentences(result.warnings)}` : ''}`
                : `${subject} is not valid. ${plural(result.problems.length + (result.more_problems || 0), 'problem')}: ${sentences(result.problems)}`;
            return text_result(text, result);
        });

    tool('show_workflow', 'Show a workflow and its data',
        'Show an AWA workflow as a graph: activities with their actor type (human, AI agent, robot, application) and role, decisions, events and edges, and the data that moves: what each activity takes in and gives out, the contexts it reads and writes, and the access it needs. A view of the definition only; nothing runs. Returns the same facts as structured content.',
        { workflow: S.json_document('The workflow').describe('The workflow document, as JSON.'), brand: S.brand.optional() },
        async args => {
            const branded = brand_of(args.brand);
            const workflow = await require_workflow(args.workflow);
            const data = workflow_data_view(workflow);
            const c = data.counts;
            const text = `${data.workflow.name} v${data.workflow.version}: ${`${c.activities} ${c.activities === 1 ? "activity" : "activities"}`}, ${plural(c.decisions, 'decision')}, ${plural(c.events, 'event')}, ${plural(c.roles, 'role')}, ${plural(c.contexts, 'context')}. Actors: ${Object.entries(data.actor_types).map(([t, n]) => `${n} ${t}`).join(', ') || 'none'}. ${plural(data.data.length, 'named data item')} move between activities.`;
            return text_result(text, ...with_brand(branded, data, { awa: { view: 'workflow', workflow, data } }));
        }, { widget: 'workflow', invoking: 'Drawing the workflow…', invoked: 'Workflow shown' });

    tool('simulate_workflow', 'Simulate a workflow run',
        'Run an AWA workflow once in simulation and replay it: the path taken, decisions, waits, simulated tool calls, failures and, if you give rates, a computed cost. Simulation only: no tool binding (HTTP, MCP, command or other), model or external system is called, and nothing is stored. Activities return what you script in simulated_outputs and nothing otherwise, so a run whose conditions read business data stops with NO_ROUTE or CONTRACT_VIOLATION until you supply it. A run that waits for a business event continues when you list that event in events.',
        {
            workflow: S.json_document('The workflow').describe('The workflow document, as JSON.'),
            input: S.json_document('The input', 50_000).optional().describe('The data the run starts with.'),
            simulated_outputs: S.simulated_outputs.optional(),
            simulated_tool_results: S.simulated_tool_results.optional(),
            events: z.array(S.run_event).max(LIMITS.events).optional().describe('Business events delivered, in order, each time the run waits for an event.'),
            let_waits_time_out: z.boolean().default(false).describe('When the run waits for an event that is not in events: true lets the wait run out on the simulated clock; false leaves the run waiting.'),
            pricing: S.pricing.optional(),
            start_time: S.iso_time.optional().describe('Where the simulated clock starts. Default: now.'),
            brand: S.brand.optional(),
        },
        async args => {
            const branded = brand_of(args.brand);
            const workflow = await require_workflow(args.workflow);
            const run = await simulate_workflow_run(workflow, {
                input: args.input, outputs: scripted(args.simulated_outputs), tool_results: args.simulated_tool_results,
                events: (args.events || []).map(e => ({ type: e.type, data: e.data, after_ms: S.duration_ms(e.after) })),
                let_waits_time_out: args.let_waits_time_out, pricing: args.pricing, start_time: args.start_time ? Date.parse(args.start_time) : undefined,
            });
            const summary = run_summary(workflow, run);
            const status = { completed: 'completed', failed: 'failed', waiting_event: 'is waiting for an event', waiting_human: 'is waiting for a person', stopped: 'was stopped', cancelled: 'was cancelled' }[summary.status] || summary.status;
            const text = `Simulated run of ${summary.workflow}: ${status} after ${plural(summary.steps, 'step')}. Path: ${summary.path.join(' → ') || 'nothing ran'}.`
                + (summary.failures.length ? ` Failed at ${summary.failures.map(f => `${f.at} (${f.code || 'error'}): ${f.message}`).join('; ')}.` : '')
                + (summary.waiting_for.length ? ` Waiting for ${summary.waiting_for.map(w => w.event).join(', ')}.` : '')
                + (summary.stopped ? ` ${summary.stopped}` : '')
                + (summary.hint ? ` ${summary.hint}` : '')
                + ' Tools and models were simulated; nothing was executed.';
            return text_result(text, ...with_brand(branded, summary, { awa: { view: 'run', workflow, journal: run.events, summary, data: workflow_data_view(workflow) } }));
        }, { widget: 'run', invoking: 'Simulating the run…', invoked: 'Simulated run ready' });

    const journey_inputs = {
        journeys: S.journeys.describe('The journey documents, as JSON.'),
        workflows: S.workflows.describe('The workflow documents the journeys refer to, as JSON.'),
        simulated_outputs: S.simulated_outputs.optional(),
        start_time: S.iso_time.optional().describe('Where the simulated clock starts. Default: now.'),
    };

    tool('show_journeys', 'Show customer journeys',
        'Show customer journeys in the journey view: every journey with its stages, each customer on calendar time, one customer\'s journey with mood, touchpoints and what changed hands, and the workflow run behind any moment. Give either a portfolio export (the JSON written by "awa journey export" or AwaRuntime.export_portfolio()), or journey and workflow documents with the business events to play, which are then simulated. Nothing is executed or stored.',
        {
            portfolio: S.portfolio.optional().describe('A portfolio export. Use this or journeys with workflows, not both.'),
            journeys: journey_inputs.journeys.optional(), workflows: journey_inputs.workflows.optional(),
            events: z.array(S.journey_event).max(LIMITS.events).optional().describe('With journeys and workflows: the business events to play, in order.'),
            simulated_outputs: journey_inputs.simulated_outputs, start_time: journey_inputs.start_time,
            brand: S.brand.optional(),
        },
        async args => {
            const branded = brand_of(args.brand);
            if (args.portfolio) {
                if (args.journeys || args.workflows || args.events) throw new DocumentError('Give either a portfolio, or journeys with workflows and events, not both.');
                const portfolio = require_portfolio(args.portfolio), story = build_story(portfolio);
                const summary = story_summary(story);
                const customers = summary.journeys.reduce((n, j) => n + j.customers.length, 0);
                const empty = 'This portfolio holds no journey record yet.';
                return text_result(summary.journeys.length ? `From the portfolio given: ${plural(summary.journeys.length, 'journey')}, ${plural(customers, 'journey record')}. ${summary.journeys.map(j => `${j.name}: ${j.customers.map(c => `${c.name} (${c.outcome || 'under way'})`).join(', ')}`).join('. ')}.` : empty,
                    ...with_brand(branded, { simulated: false, source: 'portfolio given by the caller', ...summary }, { awa: { view: 'journeys', story, source: 'portfolio', ...(summary.journeys.length ? { recommendations: recommend(portfolio) } : { empty }) } }));
            }
            if (!args.journeys || !args.workflows) throw new DocumentError('Give a portfolio, or both journeys and workflows (with the events to play).');
            const { story, result } = await play(args);
            return journeys_result(story, result.played, result.stopped ? { stopped: result.stopped } : {}, branded, result.portfolio);
        }, { widget: 'journeys', invoking: 'Opening the journey view…', invoked: 'Journeys shown' });

    tool('simulate_journey', 'Simulate customer journeys',
        'Play a list of business events through an in-memory AWA runtime in simulation and show the result in the journey view: which journeys start, the stages they pass, the runs they start, waits that run out, touchpoints and mood. Each event may carry the simulated time at which it happens. Simulation only: no tool, model or external system is called; the runtime is discarded when the call returns. Returns what each event did.',
        {
            ...journey_inputs,
            events: z.array(S.journey_event).min(1).max(LIMITS.events).describe('The business events to play, in order. The first is usually the one that begins a journey.'),
            simulated_tool_results: S.simulated_tool_results.optional(),
            then_wait: S.iso_duration.optional().describe('Simulated time to let pass after the last event, so that deadlines run out and stalled journeys show.'),
            pricing: S.pricing.optional(),
            brand: S.brand.optional(),
        },
        async args => {
            const branded = brand_of(args.brand);
            const { story, result } = await play(args);
            return journeys_result(story, result.played, {
                ...(result.stopped ? { stopped: result.stopped } : {}),
                ...(result.commands_not_called.length ? { commands_not_called: result.commands_not_called } : {}),
                runs: result.portfolio.journeys.flatMap(j => j.instances.flatMap(i => i.instance.runs.map(r => ({ journey: String(j.definition.name).slice(0, 120), subject: String(i.instance.subject_key).slice(0, 80), workflow: String(r.workflow_name).slice(0, 120), status: String(r.status).slice(0, 40) })))).slice(0, 200),
            }, branded, result.portfolio);
        }, { widget: 'journeys', invoking: 'Simulating the journeys…', invoked: 'Simulated journeys ready' });

    const example_names = Object.keys(EXAMPLE_DOCUMENTS);
    tool('load_claims_example', 'Load the claims example',
        'Open the example bundled with AWA: six fictional customers who buy a motor policy, make a claim and come up for renewal, across three journeys and five workflows. The records were produced by a scripted simulation; no customer or claim is real. Shows the journey view. Pass document to also get one of the example\'s documents as JSON, to show, validate or simulate it with the other tools.',
        { document: z.enum(example_names).optional().describe('One document of the example to return as JSON.'), brand: S.brand.optional() },
        async args => {
            const branded = brand_of(args.brand);
            const story = example_story();
            const summary = story_summary(story);
            const document = args.document ? example_document(args.document) : undefined;
            return text_result(`The bundled claims example (fictional, produced by a scripted simulation): ${summary.journeys.map(j => `${j.name} with ${plural(j.customers.length, 'customer')}`).join(', ')}. Documents available with the document argument: ${example_names.join(', ')}.${args.document ? ` The document "${args.document}" is in the structured content.` : ''}`,
                ...with_brand(branded, { example: 'claims-journey', simulated: true, fictional: true, ...summary, documents: example_names, ...(document ? { document: { name: args.document, content: document } } : {}) },
                    { awa: { view: 'journeys', story, source: 'example: six customers, three journeys (fictional)', recommendations: recommend(example_portfolio()) } }));
        }, { widget: 'journeys', invoking: 'Loading the claims example…', invoked: 'Claims example shown' });

    tool('show_dashboard', 'Show the measures dashboard',
        'Show the measures of journeys and workflows as a dashboard (AWA specification section 21): who is stuck and who is to act, completion, abandonment and goal attainment per journey with its stages, mood and how much of it was measured, and per workflow the success rate, right first time, lead time against work time, waits, tool failures, decisions and cost. Give a portfolio export, or journey and workflow documents with business events to simulate first, or use_claims_example for the bundled fictional example. Each measure comes with the number it was computed over; null means nothing to compute it from. Nothing is executed or stored.',
        {
            portfolio: S.portfolio.optional().describe('A portfolio export (the JSON written by "awa journey export"). Use this, or journeys with workflows and events, or use_claims_example.'),
            journeys: journey_inputs.journeys.optional(), workflows: journey_inputs.workflows.optional(),
            events: z.array(S.journey_event).max(LIMITS.events).optional().describe('With journeys and workflows: the business events to simulate, in order.'),
            simulated_outputs: journey_inputs.simulated_outputs, start_time: journey_inputs.start_time,
            then_wait: S.iso_duration.optional().describe('With events: simulated time to let pass after the last one, so that deadlines run out and stuck journeys show.'),
            use_claims_example: z.boolean().optional().describe('Measure the bundled fictional claims example.'),
            from: S.iso_time.optional().describe('Keep journeys and runs started at or after this instant.'),
            to: S.iso_time.optional().describe('Keep journeys and runs started before this instant.'),
            brand: S.brand.optional(),
        },
        async args => {
            const branded = brand_of(args.brand);
            const given = [args.portfolio, args.journeys || args.workflows || args.events, args.use_claims_example].filter(Boolean).length;
            if (given !== 1) throw new DocumentError('Give exactly one of: a portfolio; journeys with workflows and events; use_claims_example.');
            let portfolio, source, simulated;
            if (args.portfolio) { portfolio = require_portfolio(args.portfolio); source = 'portfolio given in the conversation'; simulated = false; }
            else if (args.use_claims_example) { portfolio = require_portfolio(example_portfolio()); source = 'example: six customers, three journeys (fictional)'; simulated = true; }
            else {
                if (!args.journeys || !args.workflows) throw new DocumentError('Give both journeys and workflows, with the events to simulate.');
                portfolio = (await play(args)).result.portfolio; source = 'simulated in this conversation'; simulated = true;
            }
            const record = measured_record(portfolio);
            const { summary } = await measure(record, { from: args.from, to: args.to });
            const t = summary.totals, n = t['journey.started']?.value || 0, done = t['journey.completion_rate'];
            const sentence = n
                ? `Measures of ${plural(n, 'journey')} and ${plural(t['workflow.runs']?.value || 0, 'run')}${simulated ? ' (simulated)' : ''}: ${done ? `${Math.round(done.value * done.of)} of ${done.of} reached the end` : 'none has ended'}; ${summary.needs_someone_now.length ? `${plural(summary.needs_someone_now.length, 'customer')} stuck (${summary.needs_someone_now.slice(0, 3).map(a => `${a.customer} in ${a.stage}${a.owner ? `, owner ${a.owner}` : ', no owner named'}`).join('; ')})` : 'nobody is stuck'}. Quote counts with rates: these are over few.`
                : 'There is nothing to measure yet: no journey has started in what was given.';
            return text_result(sentence, ...with_brand(branded, { simulated, source, ...summary }, { awa: { view: 'dashboard', record, source, ...(args.from || args.to ? { period: { ...(args.from ? { from: args.from } : {}), ...(args.to ? { to: args.to } : {}) } } : {}) } }));
        }, { widget: 'dashboard', invoking: 'Computing the measures…', invoked: 'Measures shown' });

    tool('make_dossier', 'Make the dossier of a journey',
        'Make the dossier of a journey record as one self-contained HTML document: the customers\' stories in their own voice (every sentence citing the journal records it rests on), the journey at a glance, the work behind it, the analysis and the recommendations ranked by impact over effort, with the evidence report\'s mapping when one is given. A professional edition has every customer, the internal cost and the agents\' internals; a client edition keeps one customer\'s own story and leaves out the rest. Give a portfolio export, or use_claims_example. The document is returned as an HTML resource; nothing is stored or fetched. PDF and DOCX come from the command line: awa dossier --format pdf,docx.',
        {
            portfolio: S.portfolio.optional().describe('A portfolio export (the JSON written by "awa journey export").'),
            use_claims_example: z.boolean().optional().describe('Make the dossier of the bundled fictional claims example.'),
            options: z.record(z.string(), z.unknown()).optional().describe('The journey view\'s options: subject_name, glossary, recommendations (thresholds, wording, rules), dossier (subject, lead, say, facts, personas). Paths to other files are not read.'),
            edition: z.enum(['professional', 'client']).optional().describe('professional (default) or client.'),
            customer: z.string().max(200).optional().describe('With edition client: the customer, by subject key or name.'),
            evidence: z.record(z.string(), z.unknown()).optional().describe('An evidence report (awa evidence --format json), for the appendix.'),
            brand: S.brand.optional(),
        },
        async args => {
            const branded = brand_of(args.brand);
            if (!!args.portfolio === !!args.use_claims_example) throw new DocumentError('Give a portfolio, or use_claims_example.');
            const portfolio = args.portfolio ? require_portfolio(args.portfolio) : require_portfolio(example_portfolio());
            if (!portfolio.journeys.some(j => j.instances.length)) throw new DocumentError('This portfolio holds no journey record yet: there is nothing to tell.');
            const options = { ...(args.options || {}) };
            if (options.recommendations && typeof options.recommendations === 'object' && typeof options.recommendations.replays === 'string') options.recommendations = { ...options.recommendations, replays: {} };
            delete options.brand;
            const { model: D, html: HTML } = dossier_modules();
            let model;
            try { model = D.build(portfolio, options, { edition: args.edition || 'professional', customer: args.customer, evidence: args.evidence, source: args.portfolio ? 'a portfolio given in the conversation' : 'the bundled claims example (fictional)' }); }
            catch (error) { throw new DocumentError(`The dossier could not be made: ${error.message}`); }
            const theme = D.theme(branded ? brand_module().read_brand(args.brand, { data_only: true }) : null);
            const html = HTML.render(model, { theme });
            const text = `${model.meta.title} (${model.edition} edition): ${model.personas.map(p => p.name).join(' and ')} told in their own voice (${model.stats.sentences} sentences, ${model.stats.references} journal references), ${model.recommendations.list.length} recommendation${model.recommendations.list.length === 1 ? '' : 's'}. The HTML document is attached. A person should approve it before it is issued.`;
            return {
                content: [{ type: 'text', text }, { type: 'resource', resource: { uri: `awa://dossier/${encodeURIComponent(model.meta.journey)}.${model.edition}.html`, mimeType: 'text/html', text: html } }],
                structuredContent: { title: model.meta.title, edition: model.edition, personas: model.personas.map(p => p.name), sentences: model.stats.sentences, references: model.stats.references,
                    recommendations: model.recommendations.list.map(r => ({ rank: r.rank, title: r.title, method: r.method })), bytes: Buffer.byteLength(html), ...(branded ? { brand: { name: branded.name, warnings: branded.warnings } } : {}) },
            };
        }, { invoking: 'Making the dossier…', invoked: 'Dossier made' });

    // The SDK serialises only the standard fields of a tool. ChatGPT also reads a
    // top-level securitySchemes, so the list is published from our own definitions.
    server.server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: definitions }));
    return server;
}
