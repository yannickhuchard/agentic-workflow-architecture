import { Router } from 'express';
import { WorkflowEngine } from '../../runtime/workflow_engine';
import { parse_document } from '../../validator';
import { FileJournalStore, JournalEvent } from '../../runtime/journal';
import { shared_telemetry_from_env } from '../../runtime/telemetry_export';
import fs from 'fs/promises';
import path from 'path';

export const workflowRouter = Router();

/** Runs started by this server process, by run id */
const runs = new Map<string, WorkflowEngine>();
const MAX_TRACKED_RUNS = 200;

function track(engine: WorkflowEngine): void {
    runs.set(engine.getRunId(), engine);
    if (runs.size > MAX_TRACKED_RUNS) {
        runs.delete(runs.keys().next().value as string);
    }
}

// Run a workflow by file path
workflowRouter.post('/run', async (req, res) => {
    try {
        const { filePath, apiKey } = req.body;

        if (!filePath) {
            return res.status(400).json({ error: 'filePath is required' });
        }

        // Only workflow files inside the configured workflows directory may be run
        const workflowsDir = path.resolve(process.env.AWA_WORKFLOWS_DIR || process.cwd());
        const absolutePath = path.resolve(workflowsDir, filePath);
        const relative = path.relative(workflowsDir, absolutePath);
        if (relative.startsWith('..') || path.isAbsolute(relative) || !absolutePath.endsWith('.json')) {
            return res.status(400).json({ error: 'filePath must be a .json file inside the workflows directory' });
        }
        const content = await fs.readFile(absolutePath, 'utf-8');
        const workflowRaw = JSON.parse(content);

        const workflow = parse_document(workflowRaw);
        if (!workflow) {
            return res.status(400).json({ error: 'Invalid workflow definition' });
        }

        const key = apiKey || process.env.GEMINI_API_KEY;
        const engine = new WorkflowEngine(workflow, {
            gemini_api_key: key,
            simulate: req.body.simulate === true,
            journal: process.env.AWA_JOURNAL_DIR ? new FileJournalStore(process.env.AWA_JOURNAL_DIR) : undefined,
            telemetry: shared_telemetry_from_env(),
        });
        track(engine);

        await engine.start(req.body.input || {});
        const runId = engine.getRunId();

        // Run in background? Or wait? 
        // For an Operational API, usually we return runId and let client poll status.
        // implementing basic background run

        (async () => {
            try {
                while (engine.getStatus() === 'running') {
                    await engine.runStep();
                    await new Promise(resolve => setTimeout(resolve, 100));
                }
            } catch (err) {
                console.error(`Background run ${runId} failed:`, err);
            }
        })();

        res.json({
            runId,
            status: engine.getStatus(),
            message: 'Workflow started'
        });

    } catch (error: unknown) {
        console.error('Error running workflow:', error);
        const message = error instanceof Error ? error.message : String(error);
        res.status(500).json({ error: message });
    }
});

// Deliver a business event (CloudEvents 1.0 JSON) to the runs this server is hosting.
// Runs waiting for an event of this type, with matching correlation, continue.
workflowRouter.post('/events', async (req, res) => {
    const event = req.body;
    if (!event || typeof event.type !== 'string' || typeof event.id !== 'string') {
        return res.status(400).json({ error: 'A CloudEvents event with "id" and "type" is required' });
    }
    const resumed: string[] = [];
    for (const engine of runs.values()) {
        if (await engine.deliverEvent({ specversion: '1.0', source: '/http', ...event }) > 0) {
            resumed.push(engine.getRunId());
            // Continue the run in the background, as for a newly started one
            (async () => {
                try {
                    while (engine.getStatus() === 'running') await engine.runStep();
                } catch (err) {
                    console.error(`Run ${engine.getRunId()} failed after event ${event.id}:`, err);
                }
            })();
        }
    }
    res.status(202).json({ event_id: event.id, resumed_runs: resumed });
});

// Status of a run
workflowRouter.get('/runs/:runId', (req, res) => {
    const engine = runs.get(req.params.runId);
    if (!engine) return res.status(404).json({ error: 'Run not found' });
    res.json({
        runId: engine.getRunId(),
        workflowId: engine.getWorkflow().id,
        status: engine.getStatus(),
        tokens: engine.getTokens().map(t => ({ id: t.id, node_id: t.activityId, status: t.status })),
    });
});

// The tokens of a run waiting for input an agent over A2A asked for, with what it asked (spec 28.6)
workflowRouter.get('/runs/:runId/agent-requests', (req, res) => {
    const engine = runs.get(req.params.runId);
    if (!engine) return res.status(404).json({ error: 'Run not found' });
    res.json(engine.getAgentRequests());
});

// Give an agent the input it asked for: { "input": <object or text> }. The run goes on in the background.
workflowRouter.post('/runs/:runId/tokens/:tokenId/agent-input', async (req, res) => {
    const engine = runs.get(req.params.runId);
    if (!engine) return res.status(404).json({ error: 'Run not found' });
    const input = req.body?.input;
    if (input === null || (typeof input !== 'string' && (typeof input !== 'object' || Array.isArray(input)))) {
        return res.status(400).json({ error: 'An "input" object or text is required' });
    }
    if (!await engine.answerAgent(req.params.tokenId, input)) return res.status(409).json({ error: 'That token is not waiting for an agent\'s input' });
    (async () => {
        try {
            while (engine.getStatus() === 'running') await engine.runStep();
        } catch (err) {
            console.error(`Run ${engine.getRunId()} failed after agent input:`, err);
        }
    })();
    res.json({ runId: engine.getRunId(), status: engine.getStatus() });
});

// The workflow definition of a run, for visualisers
workflowRouter.get('/runs/:runId/workflow', (req, res) => {
    const engine = runs.get(req.params.runId);
    if (!engine) return res.status(404).json({ error: 'Run not found' });
    res.json(engine.getWorkflow());
});

// Journal of a run. `?after=<seq>` returns only later events.
workflowRouter.get('/runs/:runId/events', async (req, res) => {
    const engine = runs.get(req.params.runId);
    if (!engine) return res.status(404).json({ error: 'Run not found' });
    res.json(await engine.getEvents(Number(req.query.after) || 0));
});

// Live journal as Server-Sent Events. Replays from `?after=<seq>` (or the
// Last-Event-ID header), then streams new events as they are recorded.
workflowRouter.get('/runs/:runId/events/stream', async (req, res) => {
    const engine = runs.get(req.params.runId);
    if (!engine) return res.status(404).json({ error: 'Run not found' });

    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });

    let lastSent = Number(req.query.after) || Number(req.headers['last-event-id']) || 0;
    const send = (event: JournalEvent) => {
        if (event.seq <= lastSent) return;
        lastSent = event.seq;
        res.write(`id: ${event.seq}\nevent: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
    };

    // Subscribe first and buffer, so no event falls between the replay and the live stream
    const buffered: JournalEvent[] = [];
    let replaying = true;
    const unsubscribe = engine.onEvent(event => (replaying ? buffered.push(event) : send(event)));

    for (const event of await engine.getEvents(lastSent)) send(event);
    replaying = false;
    for (const event of buffered) send(event);

    req.on('close', unsubscribe);
});
