import { Router } from 'express';
import path from 'path';
import { readFileSync } from 'fs';
import { BusinessEvent, business_event } from '../../runtime/business_event';
import { AwaRuntime, add_definition, is_journey_document, open_runtime_directory } from '../../runtime/runtime';
import { JourneyDefinitionSchema } from '../../runtime/journey';
import { parse_document } from '../../validator';
import { compute_measures, measures_to_openmetrics, MEASURES } from '../../runtime/kpi';

/**
 * Journeys over HTTP (specification 19). With AWA_DATA_DIR set, definitions,
 * journeys and journals are kept in that directory and survive a restart;
 * without it they live in this process.
 */
export const journeyRouter = Router();

let runtime: Promise<AwaRuntime> | undefined;
/** The runtime behind the routes. A host may supply its own, e.g. with real actors configured. */
export function set_journey_runtime(instance: AwaRuntime | undefined): void { runtime = instance ? Promise.resolve(instance) : undefined; }
const directory = () => process.env.AWA_DATA_DIR ? path.resolve(process.env.AWA_DATA_DIR) : undefined;
function host(): Promise<AwaRuntime> {
    if (!runtime) {
        // AWA_SIMULATE=1 runs activities without calling models or tools; AWA_SIMULATED_OUTPUTS names a file saying what each returns
        const simulated = process.env.AWA_SIMULATED_OUTPUTS ? JSON.parse(readFileSync(path.resolve(process.env.AWA_SIMULATED_OUTPUTS), 'utf-8')) : undefined;
        const engine = { wait_for_human_tasks: true, execution_logger: { log_execution: async () => { } }, ...(process.env.AWA_SIMULATE === '1' ? { simulate: true, simulated_outputs: simulated } : {}) };
        runtime = directory() ? open_runtime_directory(directory()!, { engine }) : Promise.resolve(new AwaRuntime({ engine }));
    }
    return runtime;
}
/** The runtime behind these routes, for other routes that read what it recorded */
export const journey_runtime = (): Promise<AwaRuntime> => host();
const problem = (error: unknown) => ({ error: error instanceof Error ? error.message : String(error) });
const summary = (i: ReturnType<AwaRuntime['list_journey_instances']>[number]) => ({
    id: i.id, journey_id: i.journey_id, subject_key: i.subject_key, status: i.status, stalled: i.stalled, stage_id: i.stage_id,
    goals_reached: i.goals_reached, sentiment: i.sentiment, started_at: i.started_at, ended_at: i.ended_at, runs: i.runs,
});

// Register a workflow or a journey. Workflows a journey names must be registered first.
journeyRouter.post('/definitions', async (req, res) => {
    try {
        const h = await host(), document = req.body;
        if (is_journey_document(document)) h.register_journey(JourneyDefinitionSchema.parse(document));
        else h.register_workflow(parse_document(document));
        if (directory()) await add_definition(directory()!, document);
        res.status(201).json({ kind: is_journey_document(document) ? 'journey' : 'workflow', id: document.id, name: document.name });
    } catch (error) { res.status(400).json(problem(error)); }
});

journeyRouter.get('/', async (_req, res) => {
    const h = await host();
    res.json(h.list_journeys().map(j => ({ id: j.id, name: j.name, version: j.version, description: j.description, stages: j.stages.map(s => ({ id: s.id, name: s.name })), analytics: h.analytics(j.id) })));
});

// Take in a business event (CloudEvents 1.0). The same id twice has no further effect.
journeyRouter.post('/events', async (req, res) => {
    try {
        const body = req.body as Partial<BusinessEvent>;
        if (!body.type) return res.status(400).json({ error: 'type is required' });
        const event = business_event(body.type, (body.data || {}) as Record<string, unknown>, { ...(body.id ? { id: body.id } : {}), source: body.source || '/api', ...(body.subject ? { subject: body.subject } : {}), ...(body.time ? { time: body.time } : {}) });
        res.status(202).json({ event_id: event.id, ...(await (await host()).publish(event)) });
    } catch (error) { res.status(500).json(problem(error)); }
});

// Let time pass: deadlines take effect, journeys that outstayed a stage are marked stalled
journeyRouter.post('/tick', async (req, res) => {
    try { res.json(await (await host()).tick(req.body?.at ? Date.parse(req.body.at) : undefined)); } catch (error) { res.status(500).json(problem(error)); }
});

journeyRouter.post('/runs/:run_id/tokens/:token_id/resume', async (req, res) => {
    try {
        const resumed = await (await host()).resume(req.params.run_id, req.params.token_id, req.body || {});
        res.status(resumed ? 200 : 404).json({ resumed });
    } catch (error) { res.status(500).json(problem(error)); }
});

journeyRouter.get('/instances', async (req, res) => {
    const h = await host();
    const { journey_id, subject, stalled } = req.query as Record<string, string | undefined>;
    res.json(h.list_journey_instances(journey_id).filter(i => (!subject || i.subject_key === subject) && (stalled === undefined || (i.stalled && i.status === 'active') === (stalled !== 'false'))).map(summary));
});

// One journey with its whole record and the journal of each of its runs
journeyRouter.get('/instances/:id', async (req, res) => {
    try { res.json(await (await host()).export_journey(req.params.id)); } catch (error) { res.status(404).json(problem(error)); }
});

journeyRouter.get('/transitions', async (_req, res) => { res.json((await host()).transitions()); });

// Everything, in the form tools/visualization/journey.html loads
journeyRouter.get('/portfolio', async (_req, res) => {
    try { res.json(await (await host()).export_portfolio()); } catch (error) { res.status(500).json(problem(error)); }
});

/** Measures (specification section 21): the report as data, or in the OpenMetrics text format for a metrics system to scrape */
export const measuresRouter = Router();
const text = (value: unknown) => (typeof value === 'string' && value ? value : undefined);
measuresRouter.get('/', async (req, res) => {
    try {
        const from = text(req.query.from), to = text(req.query.to);
        for (const instant of [from, to]) if (instant && Number.isNaN(new Date(instant).getTime())) { res.status(400).json({ error: `Not an instant: ${instant}` }); return; }
        const report = compute_measures(await (await host()).export_portfolio(), { from, to, journey_id: text(req.query.journey_id), workflow_id: text(req.query.workflow_id) });
        if (req.query.format === 'openmetrics') res.type('application/openmetrics-text; version=1.0.0; charset=utf-8').send(measures_to_openmetrics(report));
        else res.json(report);
    } catch (error) { res.status(500).json(problem(error)); }
});
measuresRouter.get('/definitions', (_req, res) => { res.json(MEASURES); });
