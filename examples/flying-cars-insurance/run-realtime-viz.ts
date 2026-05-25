import * as fs from 'fs';
import * as path from 'path';
import * as dotenv from 'dotenv';
import express from 'express';
import cors from 'cors';
import { exec } from 'child_process';
import { WorkflowEngine, EngineStatus } from '../../sdk/typescript/src/runtime/workflow_engine';
import { TaskService } from '../../sdk/typescript/src/runtime/services/task_service';
import { db } from '../../sdk/typescript/src/runtime/persistence/db';
import { parse_workflow } from '../../sdk/typescript/src/validator';

// Load environment variables
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const PORT = 3002;
const app = express();
app.use(cors());
app.use(express.json());

// Load workflow definition
const workflowPath = path.resolve(__dirname, './flying-cars-insurance.awa.json');
const content = fs.readFileSync(workflowPath, 'utf-8');
const rawWorkflow = JSON.parse(content);
const workflow = parse_workflow(rawWorkflow);

// Define visual configurations for awa-viz
const visualizationConfig = {
    id: "viz-flying-cars",
    workflow_id: workflow.id,
    name: workflow.name,
    description: workflow.description,
    is_default: true,
    view_type: "2d",
    engine: "reactflow",
    lanes: [
        { id: "lane-analyst", name: "e77bb28b-b8c7-4eb9-bf55-cb09a1de8852", label: "Market Analyst (AI)", color: "#1e1e38", order_index: 0 },
        { id: "lane-designer", name: "d20e7df6-c11c-4b6f-85ff-a700142bc3c5", label: "Product Designer (AI)", color: "#1e293b", order_index: 1 },
        { id: "lane-underwriter", name: "a911e3b2-9d3b-489d-bdff-c081e289e685", label: "Risk Underwriter (AI)", color: "#1c1917", order_index: 2 },
        { id: "lane-officer", name: "92e1e3b2-7bb3-4eef-bdfe-3e0e7a1de999", label: "Commercial Officer (AI)", color: "#1e293b", order_index: 3 },
        { id: "lane-chief", name: "c4d9e3b1-9bb4-4ddf-bdde-3e0e7a1de000", label: "Chief Underwriter (Human)", color: "#2e1042", order_index: 4 }
    ],
    node_positions_2d: [
        { id: "node-analyst", node_id: "e0c7df6c-11cc-4b6f-85ff-a700142bc3c0", lane: "e77bb28b-b8c7-4eb9-bf55-cb09a1de8852", node_type: "activity", position: { x: 100, y: 0 } },
        { id: "node-designer", node_id: "e0c7df6c-11cc-4b6f-85ff-a700142bc3c1", lane: "d20e7df6-c11c-4b6f-85ff-a700142bc3c5", node_type: "activity", position: { x: 400, y: 0 } },
        { id: "node-underwriter", node_id: "e0c7df6c-11cc-4b6f-85ff-a700142bc3c2", lane: "a911e3b2-9d3b-489d-bdff-c081e289e685", node_type: "activity", position: { x: 700, y: 0 } },
        { id: "node-proposal", node_id: "e0c7df6c-11cc-4b6f-85ff-a700142bc3c3", lane: "92e1e3b2-7bb3-4eef-bdfe-3e0e7a1de999", node_type: "activity", position: { x: 1000, y: 0 } },
        { id: "node-ipid", node_id: "e0c7df6c-11cc-4b6f-85ff-a700142bc3c4", lane: "92e1e3b2-7bb3-4eef-bdfe-3e0e7a1de999", node_type: "activity", position: { x: 1300, y: 0 } },
        { id: "node-chief", node_id: "e0c7df6c-11cc-4b6f-85ff-a700142bc3c5", lane: "c4d9e3b1-9bb4-4ddf-bdde-3e0e7a1de000", node_type: "activity", position: { x: 1600, y: 0 } }
    ],
    edge_routings: [
        { id: "e1", source: "e0c7df6c-11cc-4b6f-85ff-a700142bc3c0", target: "e0c7df6c-11cc-4b6f-85ff-a700142bc3c1", edge_id: "edge-e0c7df6c-11cc-4b6f-85ff-a700142bc3c0-to-e0c7df6c-11cc-4b6f-85ff-a700142bc3c1", curve_type: "smoothstep" },
        { id: "e2", source: "e0c7df6c-11cc-4b6f-85ff-a700142bc3c1", target: "e0c7df6c-11cc-4b6f-85ff-a700142bc3c2", edge_id: "edge-e0c7df6c-11cc-4b6f-85ff-a700142bc3c1-to-e0c7df6c-11cc-4b6f-85ff-a700142bc3c2", curve_type: "smoothstep" },
        { id: "e3", source: "e0c7df6c-11cc-4b6f-85ff-a700142bc3c2", target: "e0c7df6c-11cc-4b6f-85ff-a700142bc3c3", edge_id: "edge-e0c7df6c-11cc-4b6f-85ff-a700142bc3c2-to-e0c7df6c-11cc-4b6f-85ff-a700142bc3c3", curve_type: "smoothstep" },
        { id: "e4", source: "e0c7df6c-11cc-4b6f-85ff-a700142bc3c3", target: "e0c7df6c-11cc-4b6f-85ff-a700142bc3c4", edge_id: "edge-e0c7df6c-11cc-4b6f-85ff-a700142bc3c3-to-e0c7df6c-11cc-4b6f-85ff-a700142bc3c4", curve_type: "smoothstep" },
        { id: "e5", source: "e0c7df6c-11cc-4b6f-85ff-a700142bc3c4", target: "e0c7df6c-11cc-4b6f-85ff-a700142bc3c5", edge_id: "edge-e0c7df6c-11cc-4b6f-85ff-a700142bc3c4-to-e0c7df6c-11cc-4b6f-85ff-a700142bc3c5", curve_type: "smoothstep" }
    ]
};

// Global visual tracking state
let liveStatus: EngineStatus = 'idle';
const completedNodeIds: string[] = [];
const nodeDurations: Record<string, number> = {};
const logs: string[] = ["System initialized. Awaiting engine start..."];
let currentEngine: WorkflowEngine | null = null;
let currentTokenId = "";
let humanTaskApproved = false;

// 1. Setup Static routes
const visualizationHtmlPath = path.resolve(__dirname, '../../tools/visualization/live.html');
const awaVizJsPath = path.resolve(__dirname, '../../sdk/javascript/awa-viz.js');

app.get('/', (req, res) => {
    res.sendFile(visualizationHtmlPath);
});

app.get('/sdk/javascript/awa-viz.js', (req, res) => {
    res.sendFile(awaVizJsPath);
});

// 2. Setup API routes
app.get('/api/status', (req, res) => {
    if (!currentEngine) {
        return res.json({
            status: 'idle',
            tokens: [],
            completedNodeIds: [],
            nodeDurations: {},
            logs: logs,
            visualization: visualizationConfig,
            workflow: workflow,
            activitiesState: {},
            telemetry: { processTime: 0, waitTime: 0, leadTime: 0, pce: 100, verificationAttempts: 0, passedVerifications: 0 }
        });
    }

    const tokens = currentEngine.getTokens();
    const activeToken = tokens.find(t => t.id === currentTokenId);

    // Compute live telemetry
    let processTimeMs = 0;
    let waitTimeMs = 0;
    let verificationAttempts = 0;
    let passedVerifications = 0;
    const activitiesState: Record<string, any> = {};

    if (activeToken) {
        const activities = (activeToken.contextData.activities || {}) as Record<string, any>;
        Object.entries(activities).forEach(([actId, actData]: [string, any]) => {
            activitiesState[actId] = actData;

            if (actData.output) {
                if (actData.output._verification_records) {
                    const records = actData.output._verification_records;
                    verificationAttempts += records.length;
                    if (records.some((r: any) => r.verdict === 'pass')) {
                        passedVerifications++;
                    }
                }
            }
        });

        activeToken.history.forEach(item => {
            if (item.analytics) {
                if (item.analytics.process_time) {
                    processTimeMs += parseISODurationToMs(item.analytics.process_time);
                }
                if (item.analytics.wait_time) {
                    waitTimeMs += parseISODurationToMs(item.analytics.wait_time);
                }
            }
        });
    }

    const leadTimeMs = processTimeMs + waitTimeMs;
    const pce = leadTimeMs > 0 ? (processTimeMs / leadTimeMs) * 100 : 100;

    res.json({
        status: currentEngine.getStatus(),
        tokens: tokens.map(t => ({
            id: t.id,
            activityId: t.activityId,
            status: t.status
        })),
        completedNodeIds,
        nodeDurations,
        logs: logs,
        visualization: visualizationConfig,
        workflow: workflow,
        activitiesState,
        telemetry: {
            processTime: processTimeMs,
            waitTime: waitTimeMs,
            leadTime: leadTimeMs,
            pce,
            verificationAttempts,
            passedVerifications
        }
    });
});

app.post('/api/approve', async (req, res) => {
    try {
        humanTaskApproved = true;
        res.json({ success: true });
    } catch (err: any) {
        res.status(500).json({ error: err.message });
    }
});

// Helper: duration parser
function parseISODurationToMs(duration: string): number {
    const match = duration.match(/PT?(\d+(?:\.\d+)?)(S|M|H|D)/);
    if (!match) return 0;
    const value = parseFloat(match[1]);
    const unit = match[2];
    switch (unit) {
        case 'S': return value * 1000;
        case 'M': return value * 60 * 1000;
        case 'H': return value * 60 * 60 * 1000;
        case 'D': return value * 24 * 60 * 60 * 1000;
        default: return 0;
    }
}

// 3. Execution function
async function runWorkflow() {
    let apiKey = process.env.GEMINI_API_KEY;
    let isSimulation = false;

    if (!apiKey || apiKey === 'your_api_key_here') {
        logs.push("⚠️ No valid GEMINI_API_KEY found in .env. Running in SIMULATION MODE.");
        isSimulation = true;
        apiKey = 'mock-api-key';
    } else {
        logs.push("🚀 Valid GEMINI_API_KEY found. Running in REAL AI MODE with Gemini 3 Flash.");
    }

    const engine = new WorkflowEngine(workflow, {
        gemini_api_key: apiKey,
        default_ai_model_id: 'gemini-3-flash-preview',
        simulate: isSimulation,
        verbose: false,
        wait_for_human_tasks: true,
        pricing_config: {
            input_token_cost_per_1k: 0.000075,
            output_token_cost_per_1k: 0.0003,
            currency: 'USD',
            human_cost_per_hour: 75.0,
            robot_cost_per_hour: 0,
            software_cost_per_execution: 0.01
        }
    });

    currentEngine = engine;
    
    logs.push("Starting workflow execution...");
    const tokenId = await engine.start({
        target_client: "SkyTaxi UAM Corp",
        vehicle_type: "eVTOL (Electric Vertical Takeoff & Landing)",
        propulsion_system: "Multi-rotor electric with redundant battery packs",
        intended_use: "Urban air taxi passenger transport services",
        requested_liability_limit: "25,000,000 USD per occurrence",
        hull_valuation: "1,500,000 USD per aircraft",
        fleet_size: 15
    });
    currentTokenId = tokenId;
    logs.push(`Token created: ${tokenId}`);

    // Wait a couple of seconds for the browser visualizer to load
    await new Promise(resolve => setTimeout(resolve, 4000));

    let steps = 0;
    const maxSteps = 20;

    while ((engine.getStatus() === 'running' || engine.getStatus() === 'waiting_human') && steps < maxSteps) {
        const currentStatus = engine.getStatus();

        if (currentStatus === 'waiting_human') {
            logs.push("\n[ENGINE] Status: Awaiting Human sign-off...");
            logs.push("Please review details on the Right Sidebar and click 'Approve & Sign Off'.");

            // Query database for pending task to show its details
            const pendingTasks = await TaskService.list({ status: 'pending' });
            const matchingTask = pendingTasks.find(t => t.token_id === tokenId);
            if (matchingTask) {
                logs.push(`Pending task ID found: ${matchingTask.id}`);
            }

            // Loop checking if the user clicked the button
            while (!humanTaskApproved) {
                await new Promise(resolve => setTimeout(resolve, 500));
            }

            logs.push("Completing human sign-off via TaskService...");
            const signoffData = {
                sign_off_status: "approved",
                sign_off_date: new Date().toISOString(),
                chief_underwriter_comments: "Offering approved. The coverage terms satisfy risk criteria and battery telemetry requirements."
            };

            if (matchingTask) {
                await TaskService.complete(matchingTask.id, signoffData);
            }
            logs.push("Resuming token in engine...");
            await engine.resumeToken(tokenId, signoffData);
            logs.push("Token resumed successfully.");
        } else {
            const tokens = engine.getTokens();
            const activeToken = tokens.find(t => t.id === tokenId);
            const activeNodeId = activeToken?.activityId;
            const activeActivityName = activeNodeId ? workflow.activities.find(a => a.id === activeNodeId)?.name : 'Unknown';

            logs.push(`[ENGINE] Running Step ${steps + 1}: executing "${activeActivityName}"...`);
            
            const stepStartTime = Date.now();
            await engine.runStep();
            
            if (activeNodeId) {
                completedNodeIds.push(activeNodeId);
                nodeDurations[activeNodeId] = Date.now() - stepStartTime;
                logs.push(`PASSED: "${activeActivityName}" completed in ${(nodeDurations[activeNodeId]/1000).toFixed(2)}s`);
            }
            steps++;
        }

        await new Promise(resolve => setTimeout(resolve, 2500));
    }

    logs.push("==========================================================");
    logs.push(`Workflow finished. Final status: ${engine.getStatus()}`);
    logs.push("==========================================================");
    
    // Print summary to console as well
    console.log(`\nWorkflow Execution Completed with status: ${engine.getStatus()}`);
    await db.$disconnect();
}

// 4. Start HTTP Server
app.listen(PORT, () => {
    console.log(`\n=============================================================`);
    console.log(`AWA Real-Time Visualizer running at http://localhost:${PORT}`);
    console.log(`=============================================================\n`);
    
    // Auto-launch default browser
    const url = `http://localhost:${PORT}`;
    const startCmd = process.platform === 'darwin' ? `open "${url}"` :
                     process.platform === 'win32' ? `start "" "${url}"` :
                     `xdg-open "${url}"`;
    exec(startCmd);

    // Run the workflow in the background
    runWorkflow().catch(async (err) => {
        console.error("FATAL: Workflow run failed:", err);
        await db.$disconnect();
    });
});
