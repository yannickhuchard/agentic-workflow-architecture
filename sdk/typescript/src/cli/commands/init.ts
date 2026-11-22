import { Command } from 'commander';
import fs from 'fs/promises';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';

export const initCommand = new Command('init')
    .description('Initialize a new AWA project with a sample workflow')
    .action(async () => {
        console.log('📦 Initializing new AWA project...');

        const workflowId = uuidv4();
        const analyzeActivityId = uuidv4();
        const reviewActivityId = uuidv4();
        const analystRoleId = uuidv4();
        const managerRoleId = uuidv4();
        const criterionId = uuidv4();
        const edgeId = uuidv4();
        const endEventId = uuidv4();
        const contextId = uuidv4();

        const workflowTemplate = {
            id: workflowId,
            name: "Customer Feedback Analysis",
            version: "1.0.0",
            description: "AI analyzes sentiment and a Human reviews high-priority items.",
            activities: [
                {
                    id: analyzeActivityId,
                    name: "Analyze Sentiment",
                    role_id: analystRoleId,
                    actor_type: "ai_agent",
                    description: "Determine sentiment score (0-1) and extract key topics.",
                    verification: {
                        enabled: true,
                        mode: "ai_judge",
                        criteria: [
                            {
                                id: criterionId,
                                name: "Sentiment Score Present",
                                description: "Output must contain a 'sentiment_score' numeric field.",
                                type: "completeness",
                                required: true
                            }
                        ]
                    }
                },
                {
                    id: reviewActivityId,
                    name: "Human Review",
                    role_id: managerRoleId,
                    actor_type: "human",
                    description: "Review negative feedback and assign to a team."
                }
            ],
            edges: [
                {
                    id: edgeId,
                    source_id: analyzeActivityId,
                    target_id: reviewActivityId,
                    condition: "sentiment_score < 0.3"
                },
                {
                    // Without a default, feedback that is not negative would have no route and the run would fail
                    id: uuidv4(),
                    source_id: analyzeActivityId,
                    target_id: endEventId,
                    is_default: true
                }
            ],
            events: [
                {
                    id: endEventId,
                    name: "No action needed",
                    event_type: "end"
                }
            ],
            contexts: [
                {
                    id: contextId,
                    name: "Customer Data",
                    type: "data",
                    sync_pattern: "shared_state"
                }
            ]
        };

        const envTemplate = "GEMINI_API_KEY=your_api_key_here\n";

        try {
            await fs.writeFile(path.join(process.cwd(), 'workflow.awa.json'), JSON.stringify(workflowTemplate, null, 2));
            await fs.writeFile(path.join(process.cwd(), '.env'), envTemplate);

            console.log('✅ Created: workflow.awa.json (Sample Workflow)');
            console.log('✅ Created: .env (API Key Template)');
            console.log('\nNext steps:');
            console.log('1. Add your Gemini API Key to .env');
            console.log('2. Run the sample workflow: awa run workflow.awa.json --simulate');
        } catch (error: unknown) {
            console.error('❌ Scaffolding failed:', error instanceof Error ? error.message : String(error));
        }
    });
