import * as fs from 'fs';
import * as path from 'path';
import * as dotenv from 'dotenv';
import { WorkflowEngine } from '../../sdk/typescript/src/runtime/workflow_engine';
import { TaskService } from '../../sdk/typescript/src/runtime/services/task_service';
import { db } from '../../sdk/typescript/src/runtime/persistence/db';
import { parse_workflow } from '../../sdk/typescript/src/validator';

// Load environment variables from the workspace root .env
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

async function run() {
    console.log("================================================================================");
    console.log("             AWA WORKFLOW RUNNER: FLYING CARS INSURANCE PRODUCT DESIGN          ");
    console.log("================================================================================\n");

    // Load workflow definition
    const workflowPath = path.resolve(__dirname, './flying-cars-insurance.awa.json');
    const content = fs.readFileSync(workflowPath, 'utf-8');
    const rawWorkflow = JSON.parse(content);
    const workflow = parse_workflow(rawWorkflow);

    console.log(`Loaded Workflow: "${workflow.name}" (v${workflow.version})`);

    // Check for Gemini API key
    let apiKey = process.env.GEMINI_API_KEY;
    let isSimulation = false;

    if (!apiKey || apiKey === 'your_api_key_here') {
        console.log("⚠️  No valid GEMINI_API_KEY found in .env. Running in SIMULATION MODE.");
        isSimulation = true;
        apiKey = 'mock-api-key';
    } else {
        console.log("🚀 Valid GEMINI_API_KEY found. Running in REAL AI MODE with Gemini 3 Flash.");
    }

    // Initialize the AWA Workflow Engine
    const engine = new WorkflowEngine(workflow, {
        gemini_api_key: apiKey,
        default_ai_model_id: 'gemini-3-flash-preview',
        simulate: isSimulation,
        verbose: true,
        wait_for_human_tasks: true,
        pricing_config: {
            input_token_cost_per_1k: 0.000075, // $0.075 / million
            output_token_cost_per_1k: 0.0003,  // $0.30 / million
            currency: 'USD',
            human_cost_per_hour: 75.0,
            robot_cost_per_hour: 0,
            software_cost_per_execution: 0.01
        }
    });

    console.log("\nStarting workflow execution...");
    
    // Start workflow with initial market context inputs
    const tokenId = await engine.start({
        target_client: "SkyTaxi UAM Corp",
        vehicle_type: "eVTOL (Electric Vertical Takeoff & Landing)",
        propulsion_system: "Multi-rotor electric with redundant battery packs",
        intended_use: "Urban air taxi passenger transport services",
        requested_liability_limit: "25,000,000 USD per occurrence",
        hull_valuation: "1,500,000 USD per aircraft",
        fleet_size: 15
    });

    console.log(`Token created: ${tokenId}\n`);

    let steps = 0;
    const maxSteps = 20;

    // Execution loop
    while ((engine.getStatus() === 'running' || engine.getStatus() === 'waiting_human') && steps < maxSteps) {
        const currentStatus = engine.getStatus();

        if (currentStatus === 'waiting_human') {
            console.log("\n--------------------------------------------------------------------------------");
            console.log("[RUNNER] Engine status: waiting_human. Intercepting Chief Underwriter Sign-Off.");
            console.log("--------------------------------------------------------------------------------");

            // Query pending human tasks from database
            const pendingTasks = await TaskService.list({ status: 'pending' });
            const matchingTask = pendingTasks.find(t => t.token_id === tokenId);

            if (matchingTask) {
                console.log(`\n[RUNNER] Found pending task in SQLite DB:`);
                console.log(`  - Task ID: ${matchingTask.id}`);
                console.log(`  - Task Name: ${matchingTask.activity_name}`);
                console.log(`  - Role ID Required: ${matchingTask.role_id}`);
                console.log(`  - Assigned To: ${matchingTask.assignee_id || 'Unassigned'}`);
                
                // Show inputs gathered so far
                console.log(`\n[RUNNER] Reviewing draft deliverables passed to Underwriter:`);
                console.log(`  * Client: ${matchingTask.inputs.target_client}`);
                console.log(`  * Quoted Premium: ${matchingTask.inputs.quoted_premium || 'TBD'}`);
                
                if (matchingTask.inputs.ipid_document) {
                    console.log(`  * IPID Preview (first 150 chars):\n    ${String(matchingTask.inputs.ipid_document).substring(0, 150).replace(/\n/g, '\n    ')}...`);
                }

                // Simulate/execute human review & sign-off
                console.log(`\n[RUNNER] Completing human sign-off via TaskService...`);
                const signoffData = {
                    sign_off_status: "approved",
                    sign_off_date: new Date().toISOString(),
                    chief_underwriter_comments: "Offering approved. The coverage terms satisfy the risk criteria, pilot hour standards are appropriate (500h min), and the battery telemetry maintenance requirements are well integrated. Quoted premium reflects risk profile."
                };

                await TaskService.complete(matchingTask.id, signoffData);
                console.log("[RUNNER] Task marked COMPLETED in database.");

                // Resume the engine with the human outputs
                console.log("[RUNNER] Resuming token in engine...");
                const resumed = await engine.resumeToken(tokenId, signoffData);
                console.log(`[RUNNER] Resume status: ${resumed ? 'SUCCESS' : 'FAILED'}`);
            } else {
                console.log("[RUNNER] No pending tasks found matching token ID. Running engine resume fallback.");
                await engine.resumeToken(tokenId, {
                    sign_off_status: "approved",
                    sign_off_date: new Date().toISOString(),
                    chief_underwriter_comments: "Auto-approved via fallback review."
                });
            }
        } else {
            console.log(`[RUNNER] Running Step ${steps + 1}...`);
            await engine.runStep();
            steps++;
        }

        // Small wait between steps for readability and logging
        await new Promise(resolve => setTimeout(resolve, 800));
    }

    console.log("\n================================================================================");
    console.log(`Workflow finished. Final engine status: ${engine.getStatus()}`);
    console.log("================================================================================\n");

    // Fetch the token and context to print final results
    const tokens = engine.getTokens();
    const finalToken = tokens.find(t => t.id === tokenId);

    if (finalToken) {
        const data = finalToken.contextData;

        // Print key deliverables
        console.log("--------------------------------------------------------------------------------");
        console.log("                         COMPILED PRODUCT DELIVERABLES                         ");
        console.log("--------------------------------------------------------------------------------");

        const activities = (data.activities || {}) as Record<string, any>;
        
        // Find activity IDs dynamically from names to query outputs
        const researchAct = workflow.activities.find(a => a.name === "Research & Market Analysis");
        const coverageAct = workflow.activities.find(a => a.name === "Design Coverage & Guarantees");
        const rulesAct = workflow.activities.find(a => a.name === "Establish Underwriting Rules");
        const proposalAct = workflow.activities.find(a => a.name === "Draft Offering Proposal");
        const ipidAct = workflow.activities.find(a => a.name === "Generate IPID Document");
        const signoffAct = workflow.activities.find(a => a.name === "Final Underwriter Sign-Off");

        const researchOut = researchAct ? activities[researchAct.id]?.output : null;
        const coverageOut = coverageAct ? activities[coverageAct.id]?.output : null;
        const rulesOut = rulesAct ? activities[rulesAct.id]?.output : null;
        const proposalOut = proposalAct ? activities[proposalAct.id]?.output : null;
        const ipidOut = ipidAct ? activities[ipidAct.id]?.output : null;
        const signoffOut = signoffAct ? activities[signoffAct.id]?.output : null;

        console.log(`\n1. RESEARCH & MARKET RISK SUMMARY:`);
        if (researchOut && researchOut.research_findings) {
            console.log(`  * Research: ${researchOut.research_findings}`);
            console.log(`  * Safety Concerns: ${researchOut.safety_concerns}`);
        } else {
            console.log(data.research_findings ? String(data.research_findings).substring(0, 500) + "...\n" : "N/A");
        }
        
        console.log(`\n2. COVERAGES & LIABILITY LIMITS DESIGNED:`);
        if (coverageOut && coverageOut.coverages) {
            console.log(`  * Limits: ${coverageOut.liability_limits}`);
            console.log(`  * Coverages: ${coverageOut.coverages}`);
        } else {
            console.log(`  * Limits: ${data.liability_limits || 'N/A'}`);
            console.log(data.coverages ? String(data.coverages).substring(0, 500) + "...\n" : "N/A");
        }
        
        console.log(`\n3. UNDERWRITING GUIDELINES:`);
        if (rulesOut && rulesOut.underwriting_guidelines) {
            console.log(`  * Guidelines: ${rulesOut.underwriting_guidelines}`);
            console.log(`  * Pilot Req: ${rulesOut.pilot_requirements}`);
        } else {
            console.log(data.underwriting_guidelines ? String(data.underwriting_guidelines).substring(0, 500) + "...\n" : "N/A");
        }
        
        console.log(`\n4. QUOTED ANNUAL PREMIUM:`);
        if (proposalOut && proposalOut.quoted_premium) {
            console.log(`  * Premium: ${proposalOut.quoted_premium}`);
        } else {
            console.log(`  * Premium: ${data.quoted_premium || 'N/A'}`);
        }
        
        console.log(`\n5. IPID DOCUMENT SUMMARY (Customer-facing):`);
        if (ipidOut && ipidOut.ipid_document) {
            console.log(String(ipidOut.ipid_document).substring(0, 500) + "...\n");
        } else {
            console.log(data.ipid_document ? String(data.ipid_document).substring(0, 500) + "...\n" : "N/A");
        }
        
        console.log(`\n6. CHIEF UNDERWRITER SIGN-OFF:`);
        if (signoffOut) {
            console.log(`  * Status: ${signoffOut.sign_off_status}`);
            console.log(`  * Date: ${signoffOut.sign_off_date}`);
            console.log(`  * Comments: ${signoffOut.chief_underwriter_comments}`);
        } else {
            console.log(`  * Status: ${data.sign_off_status}`);
            console.log(`  * Date: ${data.sign_off_date}`);
            console.log(`  * Comments: ${data.chief_underwriter_comments}`);
        }

        console.log("\n--------------------------------------------------------------------------------");
        console.log("                RAW NAMESPACED ACTIVITIES STATE (context.activities)            ");
        console.log("--------------------------------------------------------------------------------");
        console.log(JSON.stringify(activities, null, 2));

        // Print Telemetry and Value Stream Mapping (VSM) Metrics
        console.log("\n--------------------------------------------------------------------------------");
        console.log("                      AWA PROCESS TELEMETRY & VSM METRICS                       ");
        console.log("--------------------------------------------------------------------------------");

        // Gather metrics from token history
        let totalProcessTime = 0;
        let totalWaitTime = 0;
        const wasteCategories = new Set<string>();

        // Step through history to collect analytics
        finalToken.history.forEach(item => {
            if (item.analytics) {
                if (item.analytics.process_time) {
                    totalProcessTime += parseISODurationToMs(item.analytics.process_time);
                }
                if (item.analytics.wait_time) {
                    totalWaitTime += parseISODurationToMs(item.analytics.wait_time);
                }
                if (item.analytics.waste_categories) {
                    item.analytics.waste_categories.forEach(w => wasteCategories.add(w));
                }
            }
        });

        const totalLeadTime = totalProcessTime + totalWaitTime;
        const pce = totalLeadTime > 0 ? (totalProcessTime / totalLeadTime) * 100 : 0;

        console.log(`- Total Process Time (Active work): ${(totalProcessTime / 1000).toFixed(2)} seconds`);
        console.log(`- Total Wait Time (Human-in-the-loop): ${(totalWaitTime / 1000).toFixed(2)} seconds`);
        console.log(`- Total Lead Time (End-to-end): ${(totalLeadTime / 1000).toFixed(2)} seconds`);
        console.log(`- Process Cycle Efficiency (PCE): ${pce.toFixed(2)}%`);
        console.log(`- Waste Categories Detected: ${wasteCategories.size > 0 ? Array.from(wasteCategories).join(', ') : 'None (100% Value-Added)'}`);

        // Extract Verification Loops metadata
        let verificationAttempts = 0;
        let passedVerifications = 0;

        Object.values(activities).forEach((act: any) => {
            if (act.output && act.output._verification_records) {
                const records = act.output._verification_records;
                verificationAttempts += records.length;
                if (records.some((r: any) => r.verdict === 'pass')) {
                    passedVerifications++;
                }
            }
        });

        console.log(`- AI-as-Judge Verifications: ${passedVerifications} tasks passed verification (${verificationAttempts} total judge attempts)`);
    }

    // Disconnect DB client cleanly
    await db.$disconnect();
    console.log("\nPrisma database disconnected. Execution finished successfully.");
}

// Simple ISO-8601 duration parser for telemetry calculations
function parseISODurationToMs(duration: string): number {
    // AWA uses duration utility format like "PT0.583S"
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

run().catch(async (err) => {
    console.error("FATAL: Execution failed with error:", err);
    await db.$disconnect();
    process.exit(1);
});
