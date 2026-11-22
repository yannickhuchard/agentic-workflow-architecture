// The AWA MCP server: tools that validate, show and simulate AWA workflows and
// journeys, and the MCP Apps widgets that show the results.
//
// Stateless: every document arrives inline with the call, and nothing is kept
// when the call returns. Simulation only: see src/simulation.js.
import { z } from 'zod';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { registerAppResource, registerAppTool, RESOURCE_MIME_TYPE } from '@modelcontextprotocol/ext-apps/server';
import { RELEASE } from './sdk.js';
import { LIMITS } from './limits.js';
import * as S from './schemas.js';
import { WIDGETS, widget_html } from './widgets.js';
import { DocumentError, validate_document, require_workflow, require_journey, require_portfolio, workflow_data_view, run_summary, build_story, story_summary, sentences } from './awa.js';
import { simulate_workflow_run, simulate_journeys } from './simulation.js';
import { EXAMPLE_DOCUMENTS, example_document, example_story } from './example.js';

export const SERVER_NAME = 'awa-workflows';
export const INSTRUCTIONS = [
    'AWA (Agentic Workflow Architecture) documents describe workflows (activities done by people, AI agents, robots and applications, with decisions, events and the data that moves) and customer journeys (stages, business events, touchpoints, mood).',
    'Pass documents inline as JSON. Nothing is stored between calls.',
    'Everything this server runs is a simulation: no tool, command, HTTP call, model or production system is ever called. Say "simulated" when you report a run or a journey, and never present a simulated result as something that happened.',
    'A simulated activity returns no business data unless you script it with simulated_outputs. When a run stops with NO_ROUTE or CONTRACT_VIOLATION, supply outputs for the named activities and simulate again.',
    'Validate a document before showing or simulating it when the user wrote or edited it. Report problems in the plain words the tool returns.',
    'If the user has no document yet, call load_claims_example.',
].join(' ');

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

function journeys_result(story, played, extra = {}) {
    const summary = story_summary(story);
    const customers = summary.journeys.reduce((n, j) => n + j.customers.length, 0);
    const empty = 'No journey has started: none of the events played is one that begins a journey (a trigger with starts_journey), or its data lacks the property that identifies the subject.';
    const text = summary.journeys.length
        ? `Simulated: ${plural(summary.journeys.length, 'journey')}, ${plural(customers, 'journey record')}. ${summary.journeys.map(j => `${j.name}: ${j.customers.map(c => `${c.name} (${c.outcome || 'under way'})`).join(', ')}`).join('. ')}. Tools and models were simulated; nothing was executed.`
        : empty;
    return text_result(text, { simulated: true, ...summary, ...(played ? { events_played: played } : {}), ...extra },
        { awa: { view: 'journeys', story, source: 'simulated', ...(summary.journeys.length ? {} : { empty }) } });
}

export async function createMcpServer() {
    const server = new McpServer({ name: SERVER_NAME, version: RELEASE }, { instructions: INSTRUCTIONS });
    const definitions = [];

    for (const [name, widget] of Object.entries(WIDGETS)) {
        registerAppResource(server, `awa-${name}`, widget.uri, { description: widget.description }, async () => ({
            contents: [{
                uri: widget.uri, mimeType: RESOURCE_MIME_TYPE, text: widget_html(name),
                _meta: {
                    ui: { prefersBorder: true, csp: { connectDomains: [], resourceDomains: [] } },
                    'openai/widgetPrefersBorder': true, 'openai/widgetCSP': { connect_domains: [], resource_domains: [] },
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
        { workflow: S.json_document('The workflow').describe('The workflow document, as JSON.') },
        async args => {
            const workflow = await require_workflow(args.workflow);
            const data = workflow_data_view(workflow);
            const c = data.counts;
            const text = `${data.workflow.name} v${data.workflow.version}: ${`${c.activities} ${c.activities === 1 ? "activity" : "activities"}`}, ${plural(c.decisions, 'decision')}, ${plural(c.events, 'event')}, ${plural(c.roles, 'role')}, ${plural(c.contexts, 'context')}. Actors: ${Object.entries(data.actor_types).map(([t, n]) => `${n} ${t}`).join(', ') || 'none'}. ${plural(data.data.length, 'named data item')} move between activities.`;
            return text_result(text, data, { awa: { view: 'workflow', workflow, data } });
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
        },
        async args => {
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
            return text_result(text, summary, { awa: { view: 'run', workflow, journal: run.events, summary, data: workflow_data_view(workflow) } });
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
        },
        async args => {
            if (args.portfolio) {
                if (args.journeys || args.workflows || args.events) throw new DocumentError('Give either a portfolio, or journeys with workflows and events, not both.');
                const story = build_story(require_portfolio(args.portfolio));
                const summary = story_summary(story);
                const customers = summary.journeys.reduce((n, j) => n + j.customers.length, 0);
                const empty = 'This portfolio holds no journey record yet.';
                return text_result(summary.journeys.length ? `From the portfolio given: ${plural(summary.journeys.length, 'journey')}, ${plural(customers, 'journey record')}. ${summary.journeys.map(j => `${j.name}: ${j.customers.map(c => `${c.name} (${c.outcome || 'under way'})`).join(', ')}`).join('. ')}.` : empty,
                    { simulated: false, source: 'portfolio given by the caller', ...summary }, { awa: { view: 'journeys', story, source: 'portfolio', ...(summary.journeys.length ? {} : { empty }) } });
            }
            if (!args.journeys || !args.workflows) throw new DocumentError('Give a portfolio, or both journeys and workflows (with the events to play).');
            const { story, result } = await play(args);
            return journeys_result(story, result.played, result.stopped ? { stopped: result.stopped } : {});
        }, { widget: 'journeys', invoking: 'Opening the journey view…', invoked: 'Journeys shown' });

    tool('simulate_journey', 'Simulate customer journeys',
        'Play a list of business events through an in-memory AWA runtime in simulation and show the result in the journey view: which journeys start, the stages they pass, the runs they start, waits that run out, touchpoints and mood. Each event may carry the simulated time at which it happens. Simulation only: no tool, model or external system is called; the runtime is discarded when the call returns. Returns what each event did.',
        {
            ...journey_inputs,
            events: z.array(S.journey_event).min(1).max(LIMITS.events).describe('The business events to play, in order. The first is usually the one that begins a journey.'),
            simulated_tool_results: S.simulated_tool_results.optional(),
            then_wait: S.iso_duration.optional().describe('Simulated time to let pass after the last event, so that deadlines run out and stalled journeys show.'),
            pricing: S.pricing.optional(),
        },
        async args => {
            const { story, result } = await play(args);
            return journeys_result(story, result.played, {
                ...(result.stopped ? { stopped: result.stopped } : {}),
                ...(result.commands_not_called.length ? { commands_not_called: result.commands_not_called } : {}),
                runs: result.portfolio.journeys.flatMap(j => j.instances.flatMap(i => i.instance.runs.map(r => ({ journey: String(j.definition.name).slice(0, 120), subject: String(i.instance.subject_key).slice(0, 80), workflow: String(r.workflow_name).slice(0, 120), status: String(r.status).slice(0, 40) })))).slice(0, 200),
            });
        }, { widget: 'journeys', invoking: 'Simulating the journeys…', invoked: 'Simulated journeys ready' });

    const example_names = Object.keys(EXAMPLE_DOCUMENTS);
    tool('load_claims_example', 'Load the claims example',
        'Open the example bundled with AWA: six fictional customers who buy a motor policy, make a claim and come up for renewal, across three journeys and five workflows. The records were produced by a scripted simulation; no customer or claim is real. Shows the journey view. Pass document to also get one of the example\'s documents as JSON, to show, validate or simulate it with the other tools.',
        { document: z.enum(example_names).optional().describe('One document of the example to return as JSON.') },
        async args => {
            const story = example_story();
            const summary = story_summary(story);
            const document = args.document ? example_document(args.document) : undefined;
            return text_result(`The bundled claims example (fictional, produced by a scripted simulation): ${summary.journeys.map(j => `${j.name} with ${plural(j.customers.length, 'customer')}`).join(', ')}. Documents available with the document argument: ${example_names.join(', ')}.${args.document ? ` The document "${args.document}" is in the structured content.` : ''}`,
                { example: 'claims-journey', simulated: true, fictional: true, ...summary, documents: example_names, ...(document ? { document: { name: args.document, content: document } } : {}) },
                { awa: { view: 'journeys', story, source: 'example: six customers, three journeys (fictional)' } });
        }, { widget: 'journeys', invoking: 'Loading the claims example…', invoked: 'Claims example shown' });

    // DASHBOARD PLACEHOLDER ------------------------------------------------------------------
    // show_dashboard is not registered yet: tools/visualization/dashboard.html and the KPI
    // function of the SDK are being written. To wire it in:
    //   1. add the "dashboard" entry to WIDGETS in src/widgets.js (the commented block there);
    //   2. write src/widgets/dashboard-bridge.js, which hands result._meta.awa to the view;
    //   3. uncomment and complete the tool below; add it to tests/tools.test.js and to
    //      scripts/verify-widgets.mjs (one entry in CASES).
    //
    // tool('show_dashboard', 'Show journey and run figures',
    //     'Show key figures computed from a portfolio export or from simulated journeys. Simulation or records given by the caller; nothing is executed or stored.',
    //     { portfolio: S.portfolio.describe('A portfolio export.') },
    //     async args => {
    //         const { compute_kpis } = await load_sdk();                    // the SDK's KPI function, once it is exported
    //         const kpis = compute_kpis(require_portfolio(args.portfolio));
    //         return text_result('…one sentence a model can read…', kpis, { awa: { view: 'dashboard', kpis } });
    //     }, { widget: 'dashboard', invoking: 'Computing the figures…', invoked: 'Dashboard shown' });
    // -----------------------------------------------------------------------------------------

    // The SDK serialises only the standard fields of a tool. ChatGPT also reads a
    // top-level securitySchemes, so the list is published from our own definitions.
    server.server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: definitions }));
    return server;
}
