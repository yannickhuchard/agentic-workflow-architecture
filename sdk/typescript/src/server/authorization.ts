/**
 * Authorization on the Operational API (specification 30.4)
 *
 * Authentication says who a caller is; this says what they may do. A caller's
 * principal comes from the request: the claims of its JWT, or the principal
 * its API key stands for; an unauthenticated caller is `anonymous`. Under a
 * policy, every route that starts a run, completes, assigns or claims a task,
 * answers an agent, publishes an event or reads a journal asks the policy
 * first, and answers 403 with code FORBIDDEN when it says no. Without a
 * policy nothing is checked here, and authentication works as before.
 */

import { Request, Response } from 'express';
import {
    ANONYMOUS_PRINCIPAL, AuthorizationAction, AuthorizationDecision, AuthorizationError, AuthorizationOptions,
    AuthorizationResource, Principal, decide, is_enforced, principal_from_claims, principal_named, principal_ref,
} from '../runtime/authorization';
import { AuthUser } from './auth';
import { get_logger } from './logger';

let configured: AuthorizationOptions | undefined;

/** The deployment's authorization for every route of this process. createServer sets it from its config */
export function set_server_authorization(options: AuthorizationOptions | undefined): void { configured = options; }
export function server_authorization(): AuthorizationOptions | undefined { return configured; }

/** The principal of an authenticated user (30.1) */
export function principal_of_user(user: AuthUser): Principal {
    if (user.claims) return principal_from_claims(user.claims);
    return {
        id: user.id, kind: user.kind || 'application',
        attributes: { ...(user.attributes || {}), roles: [user.role], permissions: user.permissions },
    };
}

/** Who makes the request: its authenticated principal, else anonymous */
export function request_principal(req: Request): Principal {
    return req.user ? principal_of_user(req.user) : ANONYMOUS_PRINCIPAL;
}

/** The answer to a refused request */
export function forbidden(res: Response, error: { message: string; decision: AuthorizationDecision; action: AuthorizationAction }, principal?: Principal): Response {
    return res.status(403).json({
        error: 'Forbidden', code: 'FORBIDDEN', message: error.message,
        decision: { action: error.action, ...error.decision, ...(principal ? { principal: principal_ref(principal) } : {}) },
    });
}

/**
 * Ask the policy before a route acts. Answers 403 and returns false on a denial, which is logged: a request
 * refused here belongs to no run, so its denial has no journal to go to. Returns true without a policy.
 */
export async function authorize_request(req: Request, res: Response, action: AuthorizationAction, resource: AuthorizationResource,
    run: Record<string, unknown> = {}, principal: Principal = request_principal(req)): Promise<boolean> {
    const options = configured;
    if (!is_enforced(options)) return true;
    const decision = await decide(options!, { action, principal, resource, run, history: { performed: [] } });
    if (decision.decision === 'allow') return true;
    get_logger().warn('Request refused by the authorization policy', { action, principal: principal.id, rule: decision.rule, reason: decision.reason, resource });
    forbidden(res, new AuthorizationError(decision.message || `${action} is not allowed to ${principal.id}`, decision, action), principal);
    return false;
}

/** A principal a request names by id, such as the assignee of a task: the deployment's entry, or a person */
export function named_principal(id: string): Principal {
    return principal_named(configured, id);
}

/** The resource of a task in the task queue */
export function task_resource(task: { id: string; workflow_id: string; activity_id: string; activity_name: string; role_id: string }): AuthorizationResource {
    return { workflow_id: task.workflow_id, activity_id: task.activity_id, activity_name: task.activity_name, role_id: task.role_id, task_id: task.id };
}

export { AuthorizationError };
