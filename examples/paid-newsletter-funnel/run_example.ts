import fs from 'fs/promises';
import path from 'path';
import { WorkflowEngine } from '../../sdk/typescript/src/runtime/workflow_engine';
import { ConsoleExecutionLogger } from '../../sdk/typescript/src/runtime/execution_logger';

async function main() {
    // Load the workflow from JSON
    const workflowPath = path.join(__dirname, 'workflow.awa.json');
    const json = JSON.parse(await fs.readFile(workflowPath, 'utf8'));
    
    // Extract the roles defined alongside the workflow
    const roles = json.roles || [];
    
    // Initialize the engine with the verbose flag enabled
    const engine = new WorkflowEngine(json, {
        geminiApiKey: process.env.GEMINI_API_KEY,
        roles: roles,
        verbose: true,
        execution_logger: new ConsoleExecutionLogger()
    });

    console.log('🚀 Starting Paid Newsletter Sales Funnel Automation...');
    console.log('Using mock prospect data for demonstration:\n');
    
    const prospectData = {
        prospect_name: 'Alice Johnson',
        prospect_email: 'alice@example.com',
        interests: ['AI strategy', 'machine learning', 'product management'],
        referral_source: 'LinkedIn organic'
    };
    
    console.log(JSON.stringify(prospectData, null, 2));
    console.log('\n=======================================================\n');

    // Start with the initial payload
    await engine.start(prospectData);

    // Keep executing until the workflow completes
    while (engine.getStatus() === 'running') {
        await engine.runStep();
    }

    console.log(`\n✅ Workflow finished with status: ${engine.getStatus()}`);
}

main().catch(console.error);
