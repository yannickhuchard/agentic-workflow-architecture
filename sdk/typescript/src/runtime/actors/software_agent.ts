import { Activity } from '../../types';
import { Actor } from './actor';

export class SoftwareAgent implements Actor {
    async execute(activity: Activity, inputs: Record<string, any>): Promise<Record<string, any>> {
        console.log(`[SoftwareAgent] Executing activity: ${activity.name} (${activity.id})`);

        // Check for programs to execute
        if (activity.programs && activity.programs.length > 0) {
            for (const program of activity.programs) {
                if (program.language === 'rest_api') {
                    return this.executeRestApi(program, inputs);
                }
                // TODO: specific handlers for other languages (python, typescript, etc.)
                // For now, we only support REST API calls or simulated execution
            }
        }

        // Default behavior if no program or unsupported program: return inputs as outputs (pass-through)
        // or a simulated success message
        return {
            status: 'success',
            message: 'Executed via SoftwareAgent',
            ...inputs
        };
    }

    private async executeRestApi(program: any, inputs: Record<string, any>): Promise<Record<string, any>> {
        console.log(`[SoftwareAgent] Executing REST API: ${program.name}`);

        // This is a placeholder for actual REST API execution logic
        // In a real implementation, we would parse the code_uri or code to get the URL/method
        // and mapped inputs to the request body/params.

        // For now, we simulate a successful call
        return {
            status: 200,
            data: {
                mock_response: "from_rest_api",
                inputs_received: inputs
            }
        };
    }
}
