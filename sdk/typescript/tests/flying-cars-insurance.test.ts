import { describe, it, expect, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as dotenv from 'dotenv';
import { WorkflowEngine } from '../src/runtime/workflow_engine';
import { TaskService } from '../src/runtime/services/task_service';
import { db } from '../src/runtime/persistence/db';
import { parse_workflow } from '../src/validator';

// Load env variables
dotenv.config({ path: path.resolve(__dirname, '../../../.env') });

// Mock @google/generative-ai to return realistic eVTOL insurance data
const mockGenerateContent = vi.fn();
const mockGetGenerativeModel = vi.fn(() => ({
    generateContent: mockGenerateContent
}));

vi.mock('@google/generative-ai', () => {
    return {
        GoogleGenerativeAI: vi.fn(() => ({
            getGenerativeModel: mockGetGenerativeModel
        }))
    };
});

// Queue of mock responses for our 8 AI steps (5 executions + 3 verifications)
const mockResponses = [
    // Step 1: Market Research Agent
    {
      research_findings: "eVTOL vehicles represent a revolution in urban mobility. Key components include high-density lithium-sulfur batteries, distributed electric propulsion, and automated flight envelope controls. Primary risks include battery thermal runaway in hot climates, structural rotor hub failures, and GPS/radar spoofing vulnerabilities in high-density urban areas.",
      safety_concerns: "High risks of battery thermal runaway during rapid charging cycles. Suspension of operations during severe wind gusts (>25 kts) is critical due to tilt-rotor control limitations. Urban vertiport structural and liability exposure is unmeasured.",
      regulatory_requirements: "FAA certification requires adherence to Part 21.17(b) special conditions for eVTOL. Operational regulations require pilots to have a commercial license with specialized type rating and a minimum of 500 flight command hours."
    },
    // Step 1: Market Research AI Judge
    {
      results: [
        { criterion_id: 1, passed: true, evidence: "Explicitly covers eVTOL technology and UAM industry constraints.", confidence: 0.98 },
        { criterion_id: 2, passed: true, evidence: "Documents thermal runaway battery risks and FAA Part 21.17(b) airworthiness regulations.", confidence: 0.95 }
      ],
      feedback: null
    },
    // Step 2: Coverage Design Agent
    {
      coverages: "Hull Damage (All-risks ground, hover, and flight protection up to $1.5M valuation), Aviation Liability (Third-party and passenger liability up to $25M limit per occurrence), Cyber & Ransomware Risk (Covers software flight control override and ground station data breach), and Vertiport Premises Liability (Injuries occurring during boarding/deplaning at vertiports).",
      exclusions: "Excludes flight operations inside unapproved airspaces, pilot flight hour violations, uncertified battery replacements, and extreme weather flights.",
      liability_limits: "Hull valuation: $1,500,000 per aircraft. Passenger/Third-party liability limit: $25,000,000 per occurrence."
    },
    // Step 2: Coverage Design AI Judge
    {
      results: [
        { criterion_id: 1, passed: true, evidence: "Bespoke coverages designed for Hull, Aviation Liability, Cyber Risk, and Vertiport Premises Liability.", confidence: 0.99 }
      ],
      feedback: null
    },
    // Step 3: Underwriting Rules Agent
    {
      underwriting_guidelines: "1. Mandatory battery telemetry streaming to ground underwriting system. 2. Operations restricted to certified vertiports with automated firefighting. 3. Flights forbidden in forecasted icing or wind speeds > 25 knots.",
      pilot_requirements: "Pilots must hold a commercial pilot certificate with a certified eVTOL type rating and show a minimum of 500 hours of flight command time.",
      risk_grading_criteria: "Low Risk: Pilot hours > 1000h, fleet age < 2 years, full telemetry sync. Medium Risk: Pilot hours 500-1000h, fleet age 2-5 years. Critical Risk: Pilot hours < 500h, battery health < 85%, telemetry loss."
    },
    // Step 3: Underwriting Rules AI Judge
    {
      results: [
        { criterion_id: 1, passed: true, evidence: "Establishes pilot licensing, eVTOL type rating, and a 500-hour minimum flight standard.", confidence: 0.96 }
      ],
      feedback: null
    },
    // Step 4: Draft Offering Agent
    {
      proposal_document: "COMMERCIAL INSURANCE PROPOSAL\n\nClient: SkyTaxi UAM Corp\nAircraft Type: Multi-rotor eVTOL (15 aircraft)\nHull Valuation: $1,500,000 per aircraft\nLiability Limit: $25,000,000 per occurrence\nCoverages: Hull, Third-Party Liability, Passenger Liability, Cyber Risk, Vertiport Premises\nUnderwriting Terms: Minimum 500 pilot hours, mandatory battery telemetry sync, vertiport wind limits.\nAnnual Premium Quote: $450,000 USD",
      quoted_premium: "$450,000 USD Annual"
    },
    // Step 5: Generate IPID Agent
    {
      ipid_document: "# INSURANCE PRODUCT INFORMATION DOCUMENT (IPID)\n\n**Product:** eVTOL commercial fleet insurance\n\n### What is Insured?\n- Physical damage to flying cars (Hull) up to $1.5M\n- Passenger bodily injury and third-party property damage up to $25M\n- Cyber hijack and software failures\n\n### What is Not Insured?\n- Uncertified pilots or violations of FAA operational bounds\n- Unapproved battery cell upgrades\n- Flight operations during storm warnings\n\n### Are there any restrictions?\n- Minimum 500 pilot hours\n- Operational geofence bounds apply"
    }
];

describe('Flying Cars Insurance Workflow Test', () => {
    it('should successfully execute the full eVTOL insurance product design process', async () => {
        console.log("\n================================================================================");
        console.log("             RUNNING FLYING CARS INSURANCE PRODUCT DESIGN WORKFLOW              ");
        console.log("================================================================================\n");

        // Set up the mock generator implementation
        let responseIndex = 0;
        mockGenerateContent.mockImplementation(() => {
            const res = mockResponses[responseIndex++];
            return Promise.resolve({
                response: {
                    text: () => JSON.stringify(res),
                    usageMetadata: { promptTokenCount: 200, candidatesTokenCount: 100 }
                }
            });
        });

        // Load workflow definition
        const workflowPath = path.resolve(__dirname, '../../../examples/flying-cars-insurance/flying-cars-insurance.awa.json');
        const content = fs.readFileSync(workflowPath, 'utf-8');
        const rawWorkflow = JSON.parse(content);
        const workflow = parse_workflow(rawWorkflow);

        expect(workflow).toBeDefined();
        expect(workflow.name).toBe("Flying Cars Insurance Product Design Workflow");

        // Initialize engine with simulation mode DISABLED
        // We set simulate: false so that we can test real human task creations in SQLite database,
        // while the AI agent parts will use our mocked GoogleGenerativeAI client.
        const engine = new WorkflowEngine(workflow, {
            gemini_api_key: 'mock-test-key-since-ai-is-mocked',
            default_ai_model_id: 'gemini-3-flash-preview',
            simulate: false, 
            verbose: true,
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

        // Start execution
        const tokenId = await engine.start({
            target_client: "SkyTaxi UAM Corp",
            vehicle_type: "eVTOL (Electric Vertical Takeoff & Landing)",
            propulsion_system: "Multi-rotor electric with redundant battery packs",
            intended_use: "Urban air taxi passenger transport services",
            requested_liability_limit: "25,000,000 USD per occurrence",
            hull_valuation: "1,500,000 USD per aircraft",
            fleet_size: 15
        });

        expect(tokenId).toBeDefined();

        let steps = 0;
        const maxSteps = 20;

        // Run until completed or failed
        while ((engine.getStatus() === 'running' || engine.getStatus() === 'waiting_human') && steps < maxSteps) {
            const currentStatus = engine.getStatus();

            if (currentStatus === 'waiting_human') {
                console.log("\n[TEST] Engine is waiting for Human sign-off. Intercepting Chief Underwriter...");
                
                // Fetch the pending task from TaskService
                const pendingTasks = await TaskService.list({ status: 'pending' });
                const matchingTask = pendingTasks.find(t => t.token_id === tokenId);

                expect(matchingTask).toBeDefined();
                console.log(`[TEST] Found human task in DB: ${matchingTask!.activity_name} (${matchingTask!.id})`);

                const signoffData = {
                    sign_off_status: "approved",
                    sign_off_date: new Date().toISOString(),
                    chief_underwriter_comments: "Offering approved. The coverage terms satisfy the risk criteria, pilot hour standards are appropriate (500h min), and the battery telemetry maintenance requirements are well integrated. Quoted premium reflects risk profile."
                };

                // Introduce a small wait to register a non-zero wait time in telemetry
                await new Promise(resolve => setTimeout(resolve, 1500));

                // Complete the task via TaskService
                await TaskService.complete(matchingTask!.id, signoffData);
                console.log("[TEST] Completed human task in database.");

                // Resume the workflow in the engine
                const resumed = await engine.resumeToken(tokenId, signoffData);
                expect(resumed).toBe(true);
                console.log("[TEST] Workflow resumed successfully.");
            } else {
                console.log(`[TEST] Running Step ${steps + 1}...`);
                await engine.runStep();
                steps++;
            }

            await new Promise(resolve => setTimeout(resolve, 200)); // Quick sleep
        }

        expect(engine.getStatus()).toBe('completed');
        console.log(`\n[TEST] Workflow finished with status: ${engine.getStatus()}`);

        const tokens = engine.getTokens();
        const finalToken = tokens.find(t => t.id === tokenId);
        expect(finalToken).toBeDefined();
        expect(finalToken!.status).toBe('completed');

        const data = finalToken!.contextData;
        expect(data.sign_off_status).toBe('approved');

        // Verify namespaced activities are stored and not overwritten
        expect(data.activities).toBeDefined();
        const activities = data.activities as Record<string, any>;
        for (const activity of workflow.activities) {
            expect(activities[activity.id]).toBeDefined();
            expect(activities[activity.id].output).toBeDefined();
        }

        // Print Telemetry and VSM metrics for analysis
        console.log("\n--------------------------------------------------------------------------------");
        console.log("                         VSM PERFORMANCE METRICS ANALYSES                       ");
        console.log("--------------------------------------------------------------------------------");

        let totalProcessTime = 0;
        let totalWaitTime = 0;
        const wasteCategories = new Set<string>();

        finalToken!.history.forEach(item => {
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

        console.log(`- Active Process Time: ${(totalProcessTime / 1000).toFixed(3)}s`);
        console.log(`- Human Waiting Time (Time paused for human sign-off): ${(totalWaitTime / 1000).toFixed(3)}s`);
        console.log(`- Total Lead Time (End-to-end duration): ${(totalLeadTime / 1000).toFixed(3)}s`);
        console.log(`- Process Cycle Efficiency (PCE): ${pce.toFixed(2)}%`);
        console.log(`- Wastes Detected: ${wasteCategories.size > 0 ? Array.from(wasteCategories).join(', ') : 'None'}`);

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

        console.log(`- AI-as-Judge Verifications: ${passedVerifications} tasks passed (${verificationAttempts} total judge attempts)`);
        console.log("================================================================================\n");

        await db.$disconnect();
    }, 60000); // 60s timeout
});

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
