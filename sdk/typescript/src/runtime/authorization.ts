/**
 * Identity and authorization (specification section 30)
 *
 * Who performs an activity, completes a person's task or starts a run is a
 * principal: a person, an AI agent, a robot, an application or a service,
 * with an id, a kind and attributes. The deployment gives the principals of
 * agents, tools and agents reached over A2A; an authenticated request gives
 * those of people and callers. A declarative policy in the deployment, with
 * deny-overrides and default deny, decides whether a principal may take an
 * action on a resource. Separation of duties and four-eyes approvals are
 * first-class rules. Every denial is journalled as `authorization.decided`.
 *
 * The built-in policy is the reference decider. A deployment may plug in
 * another (an external policy engine) through the Decider interface; the
 * engine enforces and records its decisions the same way.
 */

import { A2AAgent, Activity, Role, ToolDefinition, Workflow } from '../types';
import { evaluate_expression, validate_expression } from './expression';
import { JournalEventInput } from './journal';

export const PRINCIPAL_KINDS = ['person', 'ai_agent', 'robot', 'application', 'service'] as const;
export type PrincipalKind = typeof PRINCIPAL_KINDS[number];

/** Who acts (30.1) */
export interface Principal {
    id: string;
    kind: PrincipalKind;
    name?: string;
    /** Roles, groups, clearance, department, and anything else a policy may test */
    attributes?: Record<string, unknown>;
}

/** A principal the deployment gives to the agents, robots and applications that perform activities (30.1) */
export interface AgentIdentity extends Principal {
    /** What the identity acts for: activities and roles by id or name, actor types, A2A agent card URLs */
    acts_for?: { activities?: string[]; roles?: string[]; actor_types?: string[]; agents?: string[] };
    /** Headers sent with the identity's HTTP tool calls and A2A requests. `{{secret:NAME}}` is replaced as in 17.2. Never journalled */
    credentials?: Record<string, string>;
}

export const AUTHORIZATION_ACTIONS = [
    'start_run', 'perform_activity', 'call_tool', 'reach_agent', 'claim_task', 'assign_task',
    'complete_task', 'approve', 'answer_agent', 'publish_event', 'cancel_run', 'read_journal', 'migrate_run',
] as const;
export type AuthorizationAction = typeof AUTHORIZATION_ACTIONS[number];

export interface SubjectMatch {
    ids?: string[];
    kinds?: PrincipalKind[];
    /** Any of these is among the principal's `roles` attribute */
    roles?: string[];
    /** Any of these is among the principal's `groups` attribute */
    groups?: string[];
    /** For each attribute, the value it must have, or a list of values any of which will do */
    attributes?: Record<string, unknown>;
}

export interface ResourceMatch {
    workflows?: string[];
    activities?: string[];
    roles?: string[];
    tools?: string[];
    agents?: string[];
    classifications?: string[];
}

export interface PolicyRule {
    id: string;
    description?: string;
    effect: 'allow' | 'deny';
    actions: (AuthorizationAction | '*')[];
    subject?: SubjectMatch;
    resource?: ResourceMatch;
    /** A condition expression (section 6) over `principal`, `resource`, `run` and `action` */
    condition?: string;
}

/** A principal who performed one activity of the set in a run may not perform another of the set in that run (30.3) */
export interface SeparationOfDuties {
    id: string;
    description?: string;
    activities: string[];
    /** Default: perform_activity, complete_task, approve */
    actions?: AuthorizationAction[];
    /** The principal who started the run counts as having performed an activity of the set */
    includes_starter?: boolean;
}

/** An activity that completes only when this many distinct principals have approved it (30.3) */
export interface FourEyes {
    id: string;
    description?: string;
    activities: string[];
    approvals: number;
}

export interface AuthorizationPolicy {
    rules?: PolicyRule[];
    separation_of_duties?: SeparationOfDuties[];
    four_eyes?: FourEyes[];
}

/** What an action is taken on (30.2) */
export interface AuthorizationResource {
    workflow_id?: string;
    workflow_name?: string;
    run_id?: string;
    activity_id?: string;
    activity_name?: string;
    role_id?: string;
    role_name?: string;
    tool?: string;
    link?: string;
    agent?: string;
    classification?: string;
    task_id?: string;
    event_type?: string;
}

/** What the run has on record that separation of duties and four-eyes rules need */
export interface AuthorizationHistory {
    /** The principal who started the run */
    started_by?: string;
    /** Activities completed in the run, with the principals who performed them */
    performed: { activity_id: string; activity_name?: string; principal_ids: string[] }[];
    /** The principals who have already approved the task at hand (four eyes) */
    approvals?: string[];
}

export interface AuthorizationRequest {
    action: AuthorizationAction;
    principal: Principal;
    resource: AuthorizationResource;
    /** The run's data (the token's data, or the input of a run being started) */
    run: Record<string, unknown>;
    history: AuthorizationHistory;
}

export type DecisionReason = 'rule' | 'no_rule' | 'separation_of_duties' | 'four_eyes' | 'decider_error';

export interface AuthorizationDecision {
    decision: 'allow' | 'deny';
    /** The rule that decided, or null when none did (default deny) */
    rule: string | null;
    reason: DecisionReason;
    message?: string;
}

/** What decides (30.7). The built-in policy is one; an external policy engine can be another. */
export interface Decider {
    decide(request: AuthorizationRequest): AuthorizationDecision | Promise<AuthorizationDecision>;
}

export interface AuthorizationOptions {
    /** The policy. When present, everything it does not allow is denied */
    policy?: AuthorizationPolicy;
    /** Replaces the built-in policy as the decider. The engine still enforces and records */
    decider?: Decider;
    /** Identities of agents, robots and applications, and a directory of people by id */
    principals?: AgentIdentity[];
    /** Data classification of workflows and activities, by id or name */
    classifications?: Record<string, string>;
    /** Journal allows as well as denials. Default false */
    record_allows?: boolean;
    /** The principal of what the host does on its own account. Default { id: "host", kind: "service" } */
    host_principal?: Principal;
}

export const ANONYMOUS_PRINCIPAL: Principal = Object.freeze({ id: 'anonymous', kind: 'application' }) as Principal;
export const HOST_PRINCIPAL: Principal = Object.freeze({ id: 'host', kind: 'service' }) as Principal;

const KIND_OF_ACTOR: Record<string, PrincipalKind> = { human: 'person', ai_agent: 'ai_agent', robot: 'robot', application: 'application' };
const SOD_ACTIONS: AuthorizationAction[] = ['perform_activity', 'complete_task', 'approve'];

/** A denial. Its code is FORBIDDEN; it carries the decision */
export class AuthorizationError extends Error {
    readonly code = 'FORBIDDEN';
    constructor(message: string, public readonly decision: AuthorizationDecision, public readonly action: AuthorizationAction) {
        super(message);
        this.name = 'AuthorizationError';
    }
}

/** The part of a principal that is journalled: never its attributes (30.6) */
export function principal_ref(principal: Principal): { id: string; kind: PrincipalKind } {
    return { id: principal.id, kind: principal.kind };
}

// ----------------------------------------------------------------------
// Validation
// ----------------------------------------------------------------------

const is_strings = (value: unknown) => Array.isArray(value) && value.every(v => typeof v === 'string');

function unknown_keys(where: string, value: Record<string, unknown>, keys: string[], errors: string[]): void {
    for (const key of Object.keys(value)) if (!keys.includes(key)) errors.push(`${where}: unknown property "${key}"`);
}

function check_principal(where: string, p: Record<string, unknown>, errors: string[], identity: boolean): void {
    if (!p || typeof p !== 'object') { errors.push(`${where}: must be an object`); return; }
    unknown_keys(where, p, identity ? ['id', 'kind', 'name', 'attributes', 'acts_for', 'credentials'] : ['id', 'kind', 'name', 'attributes'], errors);
    if (typeof p.id !== 'string' || !p.id) errors.push(`${where}: "id" is required`);
    if (!PRINCIPAL_KINDS.includes(p.kind as PrincipalKind)) errors.push(`${where}: "kind" must be one of ${PRINCIPAL_KINDS.join(', ')}`);
    if (p.attributes !== undefined && (typeof p.attributes !== 'object' || p.attributes === null || Array.isArray(p.attributes))) errors.push(`${where}: "attributes" must be an object`);
    if (identity && p.acts_for !== undefined) {
        const acts = p.acts_for as Record<string, unknown>;
        unknown_keys(`${where}.acts_for`, acts, ['activities', 'roles', 'actor_types', 'agents'], errors);
        for (const [key, value] of Object.entries(acts)) if (!is_strings(value)) errors.push(`${where}.acts_for.${key}: must be a list of strings`);
    }
    if (identity && p.credentials !== undefined && (typeof p.credentials !== 'object' || !Object.values(p.credentials as object).every(v => typeof v === 'string'))) {
        errors.push(`${where}.credentials: must map header names to text`);
    }
}

/** Problems with a policy, each naming where it is. Empty when the policy is valid */
export function validate_policy(policy: unknown): string[] {
    const errors: string[] = [];
    if (!policy || typeof policy !== 'object' || Array.isArray(policy)) return ['policy: must be an object'];
    const p = policy as Record<string, unknown>;
    unknown_keys('policy', p, ['rules', 'separation_of_duties', 'four_eyes'], errors);
    const ids = new Set<string>();
    const id_of = (where: string, value: unknown) => {
        if (typeof value !== 'string' || !value) errors.push(`${where}: "id" is required`);
        else if (ids.has(value)) errors.push(`${where}: id "${value}" is used twice`);
        else ids.add(value);
    };
    const list = (key: string) => {
        const value = p[key];
        if (value === undefined) return [];
        if (!Array.isArray(value)) { errors.push(`policy.${key}: must be a list`); return []; }
        return value as Record<string, unknown>[];
    };
    list('rules').forEach((rule, i) => {
        const where = `policy.rules[${i}]`;
        if (!rule || typeof rule !== 'object') { errors.push(`${where}: must be an object`); return; }
        unknown_keys(where, rule, ['id', 'description', 'effect', 'actions', 'subject', 'resource', 'condition'], errors);
        id_of(where, rule.id);
        if (rule.effect !== 'allow' && rule.effect !== 'deny') errors.push(`${where}: "effect" must be "allow" or "deny"`);
        if (!is_strings(rule.actions) || (rule.actions as string[]).length === 0) errors.push(`${where}: "actions" must be a non-empty list`);
        else for (const action of rule.actions as string[]) if (action !== '*' && !AUTHORIZATION_ACTIONS.includes(action as AuthorizationAction)) errors.push(`${where}: unknown action "${action}"`);
        if (rule.subject !== undefined) {
            const s = rule.subject as Record<string, unknown>;
            unknown_keys(`${where}.subject`, s, ['ids', 'kinds', 'roles', 'groups', 'attributes'], errors);
            for (const key of ['ids', 'kinds', 'roles', 'groups']) if (s[key] !== undefined && !is_strings(s[key])) errors.push(`${where}.subject.${key}: must be a list of strings`);
            for (const kind of (is_strings(s.kinds) ? s.kinds as string[] : [])) if (!PRINCIPAL_KINDS.includes(kind as PrincipalKind)) errors.push(`${where}.subject.kinds: unknown kind "${kind}"`);
            if (s.attributes !== undefined && (typeof s.attributes !== 'object' || s.attributes === null || Array.isArray(s.attributes))) errors.push(`${where}.subject.attributes: must be an object`);
        }
        if (rule.resource !== undefined) {
            const r = rule.resource as Record<string, unknown>;
            unknown_keys(`${where}.resource`, r, ['workflows', 'activities', 'roles', 'tools', 'agents', 'classifications'], errors);
            for (const [key, value] of Object.entries(r)) if (!is_strings(value)) errors.push(`${where}.resource.${key}: must be a list of strings`);
        }
        if (rule.condition !== undefined) {
            const checked = typeof rule.condition === 'string' ? validate_expression(rule.condition) : { valid: false, error: 'must be text' };
            if (!checked.valid) errors.push(`${where}.condition: ${checked.error}`);
        }
    });
    list('separation_of_duties').forEach((sod, i) => {
        const where = `policy.separation_of_duties[${i}]`;
        if (!sod || typeof sod !== 'object') { errors.push(`${where}: must be an object`); return; }
        unknown_keys(where, sod, ['id', 'description', 'activities', 'actions', 'includes_starter'], errors);
        id_of(where, sod.id);
        const starter = sod.includes_starter === true;
        if (!is_strings(sod.activities) || (sod.activities as string[]).length < (starter ? 1 : 2)) errors.push(`${where}: "activities" must list at least ${starter ? 'one activity' : 'two activities'}`);
        if (sod.actions !== undefined && (!is_strings(sod.actions) || !(sod.actions as string[]).every(a => SOD_ACTIONS.includes(a as AuthorizationAction)))) errors.push(`${where}: "actions" may only list ${SOD_ACTIONS.join(', ')}`);
        if (sod.includes_starter !== undefined && typeof sod.includes_starter !== 'boolean') errors.push(`${where}: "includes_starter" must be true or false`);
    });
    list('four_eyes').forEach((rule, i) => {
        const where = `policy.four_eyes[${i}]`;
        if (!rule || typeof rule !== 'object') { errors.push(`${where}: must be an object`); return; }
        unknown_keys(where, rule, ['id', 'description', 'activities', 'approvals'], errors);
        id_of(where, rule.id);
        if (!is_strings(rule.activities) || (rule.activities as string[]).length === 0) errors.push(`${where}: "activities" must be a non-empty list`);
        if (!Number.isInteger(rule.approvals) || (rule.approvals as number) < 2) errors.push(`${where}: "approvals" must be a whole number of at least 2`);
    });
    return errors;
}

/** Read the `authorization` section of a deployment (30.2). Throws, naming every problem, when it is not valid */
export function load_authorization(raw: unknown): AuthorizationOptions {
    if (raw === undefined || raw === null) return {};
    if (typeof raw !== 'object' || Array.isArray(raw)) throw new Error('authorization: must be an object');
    const r = raw as Record<string, unknown>;
    const errors: string[] = [];
    unknown_keys('authorization', r, ['policy', 'principals', 'classifications', 'record_allows', 'host_principal'], errors);
    if (r.policy !== undefined) errors.push(...validate_policy(r.policy));
    if (r.principals !== undefined) {
        if (!Array.isArray(r.principals)) errors.push('authorization.principals: must be a list');
        else {
            const seen = new Set<string>();
            r.principals.forEach((p, i) => {
                check_principal(`authorization.principals[${i}]`, p as Record<string, unknown>, errors, true);
                const id = (p as { id?: string })?.id;
                if (id && seen.has(id)) errors.push(`authorization.principals[${i}]: id "${id}" is used twice`);
                if (id) seen.add(id);
            });
        }
    }
    if (r.classifications !== undefined && (typeof r.classifications !== 'object' || !Object.values(r.classifications as object).every(v => typeof v === 'string'))) {
        errors.push('authorization.classifications: must map workflow and activity ids or names to text');
    }
    if (r.record_allows !== undefined && typeof r.record_allows !== 'boolean') errors.push('authorization.record_allows: must be true or false');
    if (r.host_principal !== undefined) check_principal('authorization.host_principal', r.host_principal as Record<string, unknown>, errors, false);
    if (errors.length) throw new Error(`Invalid authorization: ${errors.join('; ')}`);
    return r as AuthorizationOptions;
}

// ----------------------------------------------------------------------
// The built-in policy (the reference decider)
// ----------------------------------------------------------------------

const as_list = (value: unknown): unknown[] => (value === undefined || value === null ? [] : Array.isArray(value) ? value : [value]);
const names = (...values: (string | undefined)[]) => values.filter((v): v is string => typeof v === 'string');
const listed = (list: string[] | undefined, ...values: (string | undefined)[]) => list === undefined || names(...values).some(v => list.includes(v));
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

function subject_matches(subject: SubjectMatch | undefined, principal: Principal): boolean {
    if (!subject) return true;
    const attributes = principal.attributes || {};
    if (subject.ids && !subject.ids.includes(principal.id)) return false;
    if (subject.kinds && !subject.kinds.includes(principal.kind)) return false;
    if (subject.roles && !as_list(attributes.roles).some(r => subject.roles!.includes(r as string))) return false;
    if (subject.groups && !as_list(attributes.groups).some(g => subject.groups!.includes(g as string))) return false;
    for (const [name, wanted] of Object.entries(subject.attributes || {})) {
        const have = as_list(attributes[name]);
        if (!as_list(wanted).some(w => have.some(h => same(h, w)))) return false;
    }
    return true;
}

function resource_matches(match: ResourceMatch | undefined, r: AuthorizationResource): boolean {
    if (!match) return true;
    return listed(match.workflows, r.workflow_id, r.workflow_name)
        && listed(match.activities, r.activity_id, r.activity_name)
        && listed(match.roles, r.role_id, r.role_name)
        && listed(match.tools, r.tool)
        && listed(match.agents, r.agent)
        && listed(match.classifications, r.classification);
}

/** What a condition is evaluated against (30.2) */
export function condition_data(request: AuthorizationRequest): Record<string, unknown> {
    const { principal } = request;
    return {
        principal: { id: principal.id, kind: principal.kind, ...(principal.name ? { name: principal.name } : {}), attributes: principal.attributes || {} },
        resource: request.resource,
        run: request.run,
        action: request.action,
    };
}

const names_activity = (entry: string, id?: string, name?: string) => entry === id || entry === name;

/** The built-in policy: deny-overrides, default deny (30.3) */
export class PolicyDecider implements Decider {
    constructor(private policy: AuthorizationPolicy) { }

    decide(request: AuthorizationRequest): AuthorizationDecision {
        const { action, principal, resource } = request;
        const allows: string[] = [];
        const denies: { id: string; reason: DecisionReason; message: string }[] = [];
        const data = condition_data(request);

        for (const rule of this.policy.rules || []) {
            if (!rule.actions.includes('*') && !rule.actions.includes(action)) continue;
            if (!subject_matches(rule.subject, principal) || !resource_matches(rule.resource, resource)) continue;
            if (rule.condition && !evaluate_expression(rule.condition, data)) continue;
            if (rule.effect === 'deny') denies.push({ id: rule.id, reason: 'rule', message: `Rule "${rule.id}" denies ${action} to ${principal.id}` });
            else allows.push(rule.id);
        }

        for (const sod of this.policy.separation_of_duties || []) {
            if (!(sod.actions || SOD_ACTIONS).includes(action)) continue;
            if (!sod.activities.some(a => names_activity(a, resource.activity_id, resource.activity_name))) continue;
            const others = sod.activities.filter(a => !names_activity(a, resource.activity_id, resource.activity_name));
            const did = request.history.performed.find(p => p.principal_ids.includes(principal.id)
                && others.some(a => names_activity(a, p.activity_id, p.activity_name)));
            if (did) {
                denies.push({ id: sod.id, reason: 'separation_of_duties', message: `${principal.id} performed "${did.activity_name || did.activity_id}" in this run, and separation of duties "${sod.id}" forbids them to ${action} "${resource.activity_name || resource.activity_id}"` });
            } else if (sod.includes_starter && request.history.started_by === principal.id) {
                denies.push({ id: sod.id, reason: 'separation_of_duties', message: `${principal.id} started this run, and separation of duties "${sod.id}" forbids them to ${action} "${resource.activity_name || resource.activity_id}"` });
            }
        }

        if (action === 'approve') {
            for (const rule of this.policy.four_eyes || []) {
                if (!rule.activities.some(a => names_activity(a, resource.activity_id, resource.activity_name))) continue;
                if ((request.history.approvals || []).includes(principal.id)) {
                    denies.push({ id: rule.id, reason: 'four_eyes', message: `${principal.id} has already approved "${resource.activity_name || resource.activity_id}"; four-eyes rule "${rule.id}" needs ${rule.approvals} distinct approvers` });
                }
            }
        }

        if (denies.length) return { decision: 'deny', rule: denies[0].id, reason: denies[0].reason, message: denies[0].message };
        if (allows.length) return { decision: 'allow', rule: allows[0], reason: 'rule' };
        return { decision: 'deny', rule: null, reason: 'no_rule', message: `No rule allows ${action} to ${principal.id}` };
    }
}

/** The four-eyes rule that applies to an activity, if any */
export function four_eyes_for(policy: AuthorizationPolicy | undefined, activity: { id: string; name?: string }): FourEyes | undefined {
    return (policy?.four_eyes || []).find(rule => rule.activities.some(a => names_activity(a, activity.id, activity.name)));
}

// ----------------------------------------------------------------------
// Principals
// ----------------------------------------------------------------------

/**
 * The principal that performs an activity whose actor is not a person waiting for a task (30.1): the first identity
 * that acts for the activity, then for its A2A agent, then for its role, then for its actor type. Without one,
 * the agent's card URL for an agent over A2A, otherwise `<actor_type>:<role_id>`, with no attributes.
 */
export function performer_of(identities: AgentIdentity[], activity: Activity, role?: Role, agent?: string): AgentIdentity {
    const by = (key: 'activities' | 'agents' | 'roles' | 'actor_types', ...values: (string | undefined)[]) =>
        identities.find(p => (p.acts_for?.[key] || []).some(v => names(...values).includes(v)));
    return by('activities', activity.id, activity.name)
        || (agent ? by('agents', agent) : undefined)
        || by('roles', activity.role_id, role?.name)
        || by('actor_types', activity.actor_type)
        || (agent ? { id: agent, kind: 'ai_agent' } : { id: `${activity.actor_type}:${activity.role_id}`, kind: KIND_OF_ACTOR[activity.actor_type] || 'application' });
}

/** A principal named only by id: the deployment's entry for it, or a person with no attributes */
export function principal_named(options: AuthorizationOptions | undefined, id: string, kind: PrincipalKind = 'person'): Principal {
    const known = (options?.principals || []).find(p => p.id === id);
    return known ? { id: known.id, kind: known.kind, ...(known.name ? { name: known.name } : {}), attributes: known.attributes || {} } : { id, kind };
}

const REGISTERED_CLAIMS = new Set(['iss', 'sub', 'aud', 'exp', 'nbf', 'iat', 'jti', 'kind', 'name', 'role', 'roles']);

/**
 * The principal of a request authenticated by a JWT (30.1): `sub` is the id; `kind` the kind (default person);
 * `roles` and `role` the roles; every other claim but the registered ones an attribute of the same name.
 */
export function principal_from_claims(claims: Record<string, unknown>): Principal {
    const attributes: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(claims)) if (!REGISTERED_CLAIMS.has(key)) attributes[key] = value;
    const roles = [...as_list(claims.roles), ...as_list(claims.role)].filter(r => typeof r === 'string');
    if (roles.length) attributes.roles = [...new Set(roles)];
    const kind = PRINCIPAL_KINDS.includes(claims.kind as PrincipalKind) ? claims.kind as PrincipalKind : 'person';
    return { id: String(claims.sub), kind, ...(typeof claims.name === 'string' ? { name: claims.name } : {}), attributes };
}

export function classification_of(options: AuthorizationOptions, workflow: Workflow, activity?: Activity): string | undefined {
    const c = options.classifications || {};
    return (activity && (c[activity.id] ?? c[activity.name])) ?? c[workflow.id] ?? c[workflow.name];
}

/** The resource of an action on a workflow or one of its activities */
export function resource_of(options: AuthorizationOptions, workflow: Workflow, activity?: Activity, role?: Role, extra: AuthorizationResource = {}): AuthorizationResource {
    const classification = classification_of(options, workflow, activity);
    const resource: AuthorizationResource = {
        workflow_id: workflow.id, workflow_name: workflow.name,
        ...(activity ? { activity_id: activity.id, activity_name: activity.name, role_id: activity.role_id } : {}),
        ...(role?.name ? { role_name: role.name } : {}),
        ...(classification !== undefined ? { classification } : {}),
        ...extra,
    };
    return resource;
}

/** Decide, failing closed: a decider that throws or answers something other than a decision denies (30.7) */
export async function decide(options: AuthorizationOptions, request: AuthorizationRequest): Promise<AuthorizationDecision> {
    const decider: Decider = options.decider || new PolicyDecider(options.policy || {});
    try {
        const answer = await decider.decide(request);
        if (!answer || (answer.decision !== 'allow' && answer.decision !== 'deny')) throw new Error('the decider gave no decision');
        return { decision: answer.decision, rule: answer.rule ?? null, reason: answer.reason || (answer.rule ? 'rule' : 'no_rule'), ...(answer.message ? { message: answer.message } : {}) };
    } catch (error) {
        return { decision: 'deny', rule: null, reason: 'decider_error', message: `The decider failed: ${error instanceof Error ? error.message : String(error)}` };
    }
}

/** Whether the options carry something that decides: then everything not allowed is denied */
export function is_enforced(options: AuthorizationOptions | undefined): boolean {
    return !!(options && (options.policy || options.decider));
}

// ----------------------------------------------------------------------
// One run's enforcement points (30.4)
// ----------------------------------------------------------------------

type Ref = { token_id?: string; node_id?: string; node_name?: string; attempt?: number };

export interface RunAuthorizationHost {
    workflow: Workflow;
    roles: Map<string, Role>;
    record: (event: JournalEventInput) => void;
    /** The activities completed in the run and in the runs it is one record with (its child runs and their parents, 24), with who performed them */
    performed: () => { activity_id: string; activity_name?: string; principal_ids?: string[] }[];
}

/** The engine's side of authorization: one per run */
export class RunAuthorization {
    constructor(public readonly options: AuthorizationOptions, private host: RunAuthorizationHost) {
        // A policy given in code is held to the same rules as one read from a deployment file (30.2)
        const errors = options.policy !== undefined ? validate_policy(options.policy) : [];
        if (errors.length) throw new Error(`Invalid authorization: ${errors.join('; ')}`);
    }

    get enforced(): boolean { return is_enforced(this.options); }

    get host_principal(): Principal { return this.options.host_principal || HOST_PRINCIPAL; }

    history(data: Record<string, unknown>, approvals?: string[]): AuthorizationHistory {
        const started = data._started_by as { id?: string } | undefined;
        return {
            ...(started?.id ? { started_by: started.id } : {}),
            performed: this.host.performed().filter(p => (p.principal_ids || []).length > 0).map(p => ({
                activity_id: p.activity_id,
                activity_name: p.activity_name ?? this.host.workflow.activities.find(a => a.id === p.activity_id)?.name,
                principal_ids: p.principal_ids || [],
            })),
            ...(approvals ? { approvals } : {}),
        };
    }

    resource(activity?: Activity, extra: AuthorizationResource = {}): AuthorizationResource {
        return resource_of(this.options, this.host.workflow, activity, activity ? this.host.roles.get(activity.role_id) : undefined, extra);
    }

    /**
     * Decide and record: a denial is always journalled, an allow when the deployment asks, an approval always (30.6).
     * Without a policy or a decider everything is allowed and nothing is recorded.
     */
    async decide(action: AuthorizationAction, principal: Principal, resource: AuthorizationResource, run: Record<string, unknown>,
        history: AuthorizationHistory, ref: Ref = {}, approval?: { required: number }): Promise<AuthorizationDecision> {
        if (!this.enforced) return { decision: 'allow', rule: null, reason: 'no_rule' };
        const decision = await decide(this.options, { action, principal, resource, run, history });
        const given = approval && decision.decision === 'allow' ? (history.approvals || []).length + 1 : undefined;
        if (decision.decision === 'deny' || this.options.record_allows || given !== undefined) {
            this.host.record({
                type: 'authorization.decided', ...ref,
                data: {
                    action, decision: decision.decision, principal: principal_ref(principal), resource,
                    ...(decision.rule ? { rule: decision.rule } : {}), reason: decision.reason, ...(decision.message ? { message: decision.message } : {}),
                    ...(given !== undefined ? { approval: { given, required: approval!.required } } : {}),
                },
            });
        }
        return decision;
    }

    /** Decide, and throw AuthorizationError on a denial */
    async require(action: AuthorizationAction, principal: Principal, resource: AuthorizationResource, run: Record<string, unknown>,
        history: AuthorizationHistory, ref: Ref = {}): Promise<void> {
        const decision = await this.decide(action, principal, resource, run, history, ref);
        if (decision.decision === 'deny') throw new AuthorizationError(decision.message || `${action} is not allowed to ${principal.id}`, decision, action);
    }

    /** Before a run starts: who starts it, refused when the policy says no. Nothing is recorded: there is no run yet */
    async start(input: Record<string, unknown>, principal: Principal | undefined): Promise<Principal> {
        const starter = principal || this.host_principal;
        if (!this.enforced) return starter;
        const decision = await decide(this.options, { action: 'start_run', principal: starter, resource: this.resource(), run: input, history: { performed: [] } });
        if (decision.decision === 'deny') throw new AuthorizationError(decision.message || `start_run is not allowed to ${starter.id}`, decision, 'start_run');
        return starter;
    }

    /** The identity that performs an activity, or undefined when a person will (the check is then at completion) */
    performer(activity: Activity, agent?: A2AAgent): AgentIdentity | undefined {
        if (!agent && activity.actor_type === 'human') return undefined;
        return performer_of(this.options.principals || [], activity, this.host.roles.get(activity.role_id), agent?.agent_card);
    }

    /** Before the first attempt of an activity an agent, robot or application performs: perform_activity, and reach_agent for an agent over A2A */
    async before_activity(activity: Activity, agent: A2AAgent | undefined, data: Record<string, unknown>, ref: Ref): Promise<AgentIdentity | undefined> {
        const performer = this.performer(activity, agent);
        if (!performer) return undefined;
        await this.require('perform_activity', performer, this.resource(activity), data, this.history(data), ref);
        if (agent) await this.require('reach_agent', performer, this.resource(activity, { agent: agent.agent_card }), data, this.history(data), ref);
        return performer;
    }

    /** The identity's credentials added to the headers of its HTTP tools; they replace a header of the same name (30.1) */
    tools_for(tools: ToolDefinition[], performer: AgentIdentity | undefined): ToolDefinition[] {
        if (!performer?.credentials) return tools;
        return tools.map(tool => tool.binding.kind === 'http'
            ? { ...tool, binding: { ...tool.binding, headers: { ...lowercase(tool.binding.headers || {}), ...lowercase(performer.credentials!) } } }
            : tool);
    }

    /** The identity's credentials added to the headers sent to an agent over A2A */
    agent_for(activity: Activity, agent: A2AAgent): A2AAgent {
        const performer = this.performer(activity, agent);
        if (!performer?.credentials) return agent;
        return { ...agent, headers: { ...lowercase(agent.headers || {}), ...lowercase(performer.credentials) } };
    }

    /** What a tool runner asks before a call runs (17.3 step 3, 30.4) */
    tool_check(activity: Activity, performer: Principal | undefined, data: Record<string, unknown>, ref: Ref) {
        return async (call: { tool: string; link?: string }): Promise<{ allowed: boolean; message?: string }> => {
            if (!this.enforced) return { allowed: true };
            const principal = performer || this.host_principal;
            const decision = await this.decide('call_tool', principal, this.resource(activity, { tool: call.tool, ...(call.link ? { link: call.link } : {}) }), data, this.history(data), ref);
            return decision.decision === 'allow' ? { allowed: true } : { allowed: false, message: decision.message };
        };
    }

    /**
     * Before a person's answer is taken (30.4): complete_task, or approve under a four-eyes rule. Throws on a denial.
     * Under a four-eyes rule an allowed approval is kept on the token until enough distinct principals have approved;
     * `pending` is then true and the token keeps waiting.
     */
    async before_completion(activity: Activity, data: Record<string, unknown>, output: Record<string, unknown>, principal: Principal | undefined, ref: Ref):
        Promise<{ principal: Principal; output: Record<string, unknown>; approvals?: { id: string; kind: PrincipalKind }[]; pending: boolean; kept?: unknown }> {
        const who = principal || this.host_principal;
        const rule = this.enforced ? four_eyes_for(this.options.policy, activity) : undefined;
        if (!rule) {
            await this.require('complete_task', who, this.resource(activity), data, this.history(data), ref);
            return { principal: who, output, pending: false };
        }
        const kept = (data._approvals as { principal: { id: string; kind: PrincipalKind }; output: Record<string, unknown> }[] | undefined) || [];
        const history = this.history(data, kept.map(a => a.principal.id));
        const decision = await this.decide('approve', who, this.resource(activity), data, history, ref, { required: rule.approvals });
        if (decision.decision === 'deny') throw new AuthorizationError(decision.message || `approve is not allowed to ${who.id}`, decision, 'approve');
        const approvals = [...kept, { principal: principal_ref(who), output }];
        if (approvals.length < rule.approvals) return { principal: who, output, pending: true, kept: approvals };
        return {
            principal: who, pending: false,
            output: Object.assign({}, ...approvals.map(a => a.output)),
            approvals: approvals.map(a => a.principal),
        };
    }
}

function lowercase(headers: Record<string, string>): Record<string, string> {
    return Object.fromEntries(Object.entries(headers).map(([name, value]) => [name.toLowerCase(), value]));
}
