/**
 * What the deployment lets the runs of this server reach, and the guardrails it
 * adds to every run (specification 17.4, 28.2, 31.1): given to every engine the
 * routes create, so that HTTP runs, journeys and A2A runs work under the same
 * permissions. createServer sets it from its config.
 */
import { WorkflowEngineOptions } from '../runtime/workflow_engine';

export type ServerDeployment = Pick<WorkflowEngineOptions, 'tools' | 'a2a' | 'guardrails'>;

let configured: ServerDeployment | undefined;

export function set_server_deployment(deployment: ServerDeployment | undefined): void { configured = deployment; }

/** The engine options the deployment gives every run of this server; empty without a deployment */
export function server_deployment_options(): ServerDeployment {
    if (!configured) return {};
    return {
        ...(configured.tools ? { tools: configured.tools } : {}),
        ...(configured.a2a ? { a2a: configured.a2a } : {}),
        ...(configured.guardrails?.length ? { guardrails: configured.guardrails } : {}),
    };
}
