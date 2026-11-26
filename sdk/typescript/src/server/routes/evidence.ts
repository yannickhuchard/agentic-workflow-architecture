import { Router } from 'express';
import { compute_evidence, EvidenceInput, render_evidence_html, render_evidence_markdown } from '../../runtime/evidence';
import { journey_runtime } from './journeys';

/**
 * Evidence (specification section 32): the report computed from what the host
 * behind /api/v1/journeys recorded, as JSON, Markdown or HTML.
 *
 *   GET /api/v1/evidence?from=&to=&workflow_id=&workflow_id=&format=json|md|html
 */
export const evidenceRouter = Router();
const text = (value: unknown) => (typeof value === 'string' && value ? value : undefined);

evidenceRouter.get('/', async (req, res) => {
    try {
        const from = text(req.query.from), to = text(req.query.to);
        for (const instant of [from, to]) if (instant && Number.isNaN(new Date(instant).getTime())) { res.status(400).json({ error: `Not an instant: ${instant}` }); return; }
        const format = text(req.query.format) || 'json';
        if (!['json', 'md', 'html'].includes(format)) { res.status(400).json({ error: 'format must be json, md or html' }); return; }
        const ids = ([] as unknown[]).concat(req.query.workflow_id ?? []).map(text).filter((v): v is string => !!v);

        const host = await journey_runtime();
        const portfolio = await host.export_portfolio();
        // Runs that belong to no journey are part of the record too
        const in_journeys = new Set(portfolio.journeys.flatMap(j => j.instances.flatMap(i => i.runs.map(r => r.run_id))));
        const runs = [];
        for (const engine of host.list_runs()) {
            if (in_journeys.has(engine.getRunId())) continue;
            runs.push({ run_id: engine.getRunId(), workflow_id: engine.getWorkflow().id, events: await engine.getEvents() });
            // Its child runs (24.7), each with its own journal
            for (const child of engine.getSubworkflowRuns()) {
                if (!in_journeys.has(child.run_id)) runs.push({ run_id: child.run_id, workflow_id: child.workflow_id, events: await engine.getSubworkflowEvents(child.run_id) });
            }
        }
        const input: EvidenceInput = { ...(portfolio as unknown as EvidenceInput), runs };
        const report = compute_evidence(input, { from, to, workflow_ids: ids.length ? ids : undefined });
        if (format === 'md') res.type('text/markdown; charset=utf-8').send(render_evidence_markdown(report));
        else if (format === 'html') res.type('text/html; charset=utf-8').send(render_evidence_html(report));
        else res.json(report);
    } catch (error) { res.status(500).json({ error: error instanceof Error ? error.message : String(error) }); }
});
