import { Router } from 'express';
import { WorkflowEngine } from '../../runtime/workflow_engine';
import { parse_workflow } from '../../validator';
import fs from 'fs/promises';
import path from 'path';

export const workflowRouter = Router();

// Run a workflow by file path
workflowRouter.post('/run', async (req, res) => {
    try {
        const { filePath, apiKey } = req.body;

        if (!filePath) {
            return res.status(400).json({ error: 'filePath is required' });
        }

        const absolutePath = path.resolve(process.cwd(), filePath);
        const content = await fs.readFile(absolutePath, 'utf-8');
        const workflowRaw = JSON.parse(content);

        const workflow = parse_workflow(workflowRaw);
        if (!workflow) {
            return res.status(400).json({ error: 'Invalid workflow definition' });
        }

        const key = apiKey || process.env.GEMINI_API_KEY;
        const engine = new WorkflowEngine(workflow, { geminiApiKey: key });

        const runId = await engine.start();

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

    } catch (error: any) {
        console.error('Error running workflow:', error);
        res.status(500).json({ error: error.message });
    }
});

// TODO: specific endpoints to check status using runId if we persiste state.
// Since WorkflowEngine is in-memory for now, we can lost it if not stored.
// For Phase 3, we just trigger.
