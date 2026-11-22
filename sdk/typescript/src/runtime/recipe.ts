/**
 * AWA Recipe Compiler (specification section 14)
 *
 * Condenses a workflow definition and the journal of one run into a single
 * document that explains how to build that workflow from scratch: what is
 * needed, each step and what it must produce, how the steps are wired, what
 * went wrong on the way and how it was resolved, and how to check the result.
 *
 * Compilation is deterministic: the same workflow and journal always give
 * the same document.
 */

import { Activity, DecisionNode, Edge, Workflow } from '../types';
import { JournalEvent } from './journal';

export interface RecipeOptions {
    /** Append the full workflow definition, so the recipe alone suffices to rebuild it. Default true. */
    include_definition?: boolean;
    /** Include payload samples (inputs and accepted outputs) where the journal holds them. Default true. */
    include_payloads?: boolean;
}

interface Attempt {
    attempt: number;
    started?: JournalEvent;
    ended?: JournalEvent;
    verification?: JournalEvent;
    contract?: JournalEvent;
    reasoning?: JournalEvent;
    meta: JournalEvent[];
    tools: JournalEvent[];
}

interface NodeTrace {
    node_id: string;
    order: number;
    attempts: Attempt[];
    events: JournalEvent[];
}

const code = (value: unknown) => '`' + String(value).replace(/`/g, "'") + '`';
const json_block = (value: unknown) => '```json\n' + JSON.stringify(value, null, 2) + '\n```';
const one_line = (text: unknown) => String(text ?? '').replace(/\s+/g, ' ').trim();
const cell = (text: unknown) => one_line(text).replace(/\|/g, '\\|');
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

function ms(value: unknown): string {
    const n = Number(value);
    if (!Number.isFinite(n)) return 'unknown';
    if (n < 1000) return `${Math.round(n)} ms`;
    if (n < 60000) return `${(n / 1000).toFixed(1)} s`;
    return `${Math.floor(n / 60000)} min ${Math.round((n % 60000) / 1000)} s`;
}

/** The outcome within a journalled result: its object-valued `output`, else the result without usage figures */
function outcome_view(result: unknown): unknown {
    if (!result || typeof result !== 'object') return result;
    const { output, usage, status, ...rest } = result as Record<string, unknown>;
    if (output && typeof output === 'object' && !Array.isArray(output)) return output;
    return output === undefined ? rest : { output, ...rest };
}

/** Group journal events by node, in the order nodes were first reached */
function trace_nodes(events: JournalEvent[]): Map<string, NodeTrace> {
    const traces = new Map<string, NodeTrace>();
    const at = (event: JournalEvent): NodeTrace => {
        const id = event.node_id as string;
        if (!traces.has(id)) traces.set(id, { node_id: id, order: traces.size + 1, attempts: [], events: [] });
        return traces.get(id)!;
    };

    for (const event of events) {
        if (!event.node_id) continue;
        if (['activity.compensated', 'activity.compensation_failed', 'token.created', 'token.moved'].includes(event.type)) continue;
        const trace = at(event);
        trace.events.push(event);

        if (!event.attempt) continue;
        let attempt = [...trace.attempts].reverse().find(a => a.attempt === event.attempt);
        if (!attempt || event.type === 'activity.started') {
            attempt = { attempt: event.attempt, meta: [], tools: [] };
            trace.attempts.push(attempt);
        }
        switch (event.type) {
            case 'activity.started': attempt.started = event; break;
            case 'activity.completed':
            case 'activity.failed': attempt.ended = event; break;
            case 'verification.completed': attempt.verification = event; break;
            case 'contract.checked': attempt.contract = attempt.contract || event; break;
            case 'reasoning.recorded': attempt.reasoning = event; break;
            case 'meta.recorded': attempt.meta.push(event); break;
            case 'tool.invoked':
            case 'tool.completed':
            case 'tool.failed': attempt.tools.push(event); break;
        }
    }

    return traces;
}

function schema_summary(schema: Record<string, unknown>): string[] {
    const lines: string[] = [];
    const properties = (schema.properties || {}) as Record<string, Record<string, unknown>>;
    const required = new Set((schema.required as string[]) || []);
    for (const [name, definition] of Object.entries(properties)) {
        const constraints = Object.entries(definition)
            .filter(([key]) => !['type', 'description', 'properties', 'items'].includes(key))
            .map(([key, value]) => `${key} ${JSON.stringify(value)}`);
        lines.push(`  - ${code(name)}: ${definition.type || 'any'}${required.has(name) ? ', required' : ''}`
            + `${constraints.length ? `, ${constraints.join(', ')}` : ''}`
            + `${definition.description ? `. ${one_line(definition.description)}` : ''}`);
    }
    return lines;
}

/** The conformance levels an engine needs in order to run this workflow as specified */
export function required_levels(workflow: Workflow): string[] {
    const levels = new Set(['document', 'core']);
    const fan_out = new Map<string, number>();
    for (const edge of workflow.edges) {
        if (!edge.condition && !edge.is_default) fan_out.set(edge.source_id, (fan_out.get(edge.source_id) || 0) + 1);
    }
    if (workflow.decision_nodes.length > 0) levels.add('decision');
    if (workflow.decision_nodes.some(d => d.decision_model)) levels.add('model-decision');
    if (workflow.activities.some(a => (a.tools || []).length > 0)) levels.add('tools');
    if (workflow.activities.some(a => a.verification?.enabled)) levels.add('verified');
    if (workflow.activities.some(a => a.retry)) levels.add('resilient');
    if (workflow.activities.some(a => a.outcome_contract)) levels.add('contract');
    if (workflow.events.length > 0 || [...fan_out.values()].some(n => n > 1)
        || workflow.activities.some(a => a.join === 'all' || a.compensation)) levels.add('flow');
    if (workflow.activities.some(a => (a as Activity & { knowledge?: unknown }).knowledge)) levels.add('learning');
    return [...levels];
}

export function compile_recipe(workflow: Workflow, events: JournalEvent[], options: RecipeOptions = {}): string {
    const include_definition = options.include_definition !== false;
    const include_payloads = options.include_payloads !== false;
    const sorted = [...events].sort((a, b) => a.seq - b.seq);
    const traces = trace_nodes(sorted);

    const activities = new Map(workflow.activities.map(a => [a.id, a]));
    const decisions = new Map(workflow.decision_nodes.map(d => [d.id, d]));
    const workflow_events = new Map(workflow.events.map(e => [e.id, e]));
    const name_of = (id: string) =>
        activities.get(id)?.name || decisions.get(id)?.name || workflow_events.get(id)?.name || id;
    const outgoing = (id: string) => workflow.edges.filter(e => e.source_id === id);
    const handlers = new Set(workflow.activities.map(a => a.compensation?.activity_id).filter(Boolean) as string[]);

    const started = sorted.find(e => e.type === 'run.started');
    const ended = [...sorted].reverse().find(e => e.type === 'run.completed' || e.type === 'run.failed');
    const status = ended ? (ended.type === 'run.completed' ? 'completed' : 'failed') : 'not finished';
    const models = sorted.filter(e => e.type === 'meta.recorded' && e.data.subject === 'model_selection');
    const moves = sorted.filter(e => e.type === 'token.moved');
    const taken = new Set(moves.map(e => e.data.edge_id as string));
    const out: string[] = [];
    const push = (...lines: string[]) => out.push(...lines);

    // ---------------------------------------------------------------- header
    push(`# Recipe: ${workflow.name}`, '');
    push(`Workflow version ${workflow.version}, AWA specification ${workflow.awa_version || sorted[0]?.spec_version || '1.1'}.`);
    if (started) {
        push(`Compiled from run ${code(started.run_id)}, which ${status === 'not finished' ? 'has not finished' : status}`
            + `${ended ? ` in ${ms(ended.data.duration_ms)}` : ''}. The journal holds ${plural(sorted.length, 'event')}.`);
    } else {
        push('Compiled from the workflow definition alone: no run journal was supplied, so sections describing what happened are empty.');
    }
    push('');
    push('This document explains how to build this workflow from scratch and what one real run of it did. '
        + 'Sections 2 to 4 are the build instructions. Section 5 is what the run taught. Section 6 is how to check your build.', '');

    // -------------------------------------------------------------- purpose
    push('## 1. What this workflow achieves', '');
    push(workflow.description ? one_line(workflow.description) : '_The workflow has no description._', '');
    if (ended) {
        const accepted = sorted.filter(e => e.type === 'activity.completed').length;
        const attempts = sorted.filter(e => e.type === 'activity.started').length;
        push('| In this run | |', '|---|---|');
        push(`| Outcome | ${status} |`);
        push(`| Duration | ${ms(ended.data.duration_ms)} |`);
        push(`| Activities accepted | ${accepted} |`);
        push(`| Attempts made | ${attempts}${attempts > accepted ? ` (${attempts - accepted} rejected or errored)` : ''} |`);
        if (Number(ended.data.input_tokens) + Number(ended.data.output_tokens) > 0) {
            push(`| Model tokens | ${ended.data.input_tokens} in, ${ended.data.output_tokens} out |`);
        }
        if (Number(ended.data.cost) > 0) push(`| Cost | ${ended.data.currency} ${Number(ended.data.cost).toFixed(4)} |`);
        push('');
    }

    // -------------------------------------------------------- prerequisites
    push('## 2. What you need before you start', '');

    push('### Actors', '');
    const roles = new Map(workflow.roles.map(r => [r.id, r]));
    const role_name = (id: string) => roles.get(id)?.name || code(id);
    push('| Role | Actor type | Performs | Notes |', '|---|---|---|---|');
    const by_role = new Map<string, Activity[]>();
    for (const activity of workflow.activities) {
        const key = `${activity.role_id}|${activity.actor_type}`;
        by_role.set(key, [...(by_role.get(key) || []), activity]);
    }
    for (const [key, list] of by_role) {
        const [role_id, actor_type] = key.split('|');
        const role = roles.get(role_id);
        const notes = [
            role?.description,
            role?.ai_model_config?.model_id ? `model ${code(role.ai_model_config.model_id)}` : '',
            role?.capabilities.length ? `capabilities: ${role.capabilities.join(', ')}` : '',
        ].filter(Boolean).join('. ');
        push(`| ${cell(role_name(role_id))} | ${actor_type} | ${list.map(a => cell(a.name)).join(', ')} | ${cell(notes)} |`);
    }
    push('');

    if (models.length > 0) {
        push('### Models', '');
        push('Map each reference to a model of similar capability in your deployment.', '');
        push('| Used by | Reference in the document | Resolved to in this run |', '|---|---|---|');
        const seen = new Set<string>();
        for (const event of models) {
            const model = event.data.model as { id?: string; provider?: string; requested?: string; temperature?: number };
            const row = `| ${cell(event.node_name || name_of(event.node_id as string))} | ${code(model.requested || model.id)} `
                + `| ${code(`${model.provider}:${model.id}`)}${model.temperature !== undefined ? `, temperature ${model.temperature}` : ''} |`;
            if (!seen.has(row)) { seen.add(row); push(row); }
        }
        push('');
    }

    const tools = workflow.activities.flatMap(a => [
        ...a.tool_requirements.map(t => ({ activity: a.name, kind: `tool (${t.type})`, name: t.name, detail: t.description || t.reference || '' })),
        ...a.programs.map(p => ({ activity: a.name, kind: `program (${p.language})`, name: p.name, detail: p.mcp_server ? `MCP server ${p.mcp_server}` : p.code_uri || '' })),
        ...a.skills.map(s => ({ activity: a.name, kind: `skill (${s.type})`, name: s.name, detail: s.description || '' })),
    ]);
    if (tools.length > 0) {
        push('### Tools, programs and skills', '');
        push('| Activity | Kind | Name | Detail |', '|---|---|---|---|');
        for (const tool of tools) push(`| ${cell(tool.activity)} | ${tool.kind} | ${cell(tool.name)} | ${cell(tool.detail)} |`);
        push('');
    }

    const callable = workflow.activities.flatMap(a => (a.tools || []).map(t => ({ activity: a.name, tool: t })));
    if (callable.length > 0) {
        push('### Callable tools', '');
        push('Each tool an actor may call, and what it runs. Provide every target before running the workflow.', '');
        push('| Activity | Tool | Runs | What it does |', '|---|---|---|---|');
        for (const { activity, tool } of callable) {
            push(`| ${cell(activity)} | ${code(tool.name)} | ${cell(binding_text(tool.binding))} | ${cell(tool.description || '')}${tool.documentation ? ` ([docs](${tool.documentation}))` : ''} |`);
        }
        push('');
    }

    if (workflow.contexts.length > 0) {
        push('### Shared contexts', '');
        push('| Context | Type | Sync pattern | Used by |', '|---|---|---|---|');
        for (const context of workflow.contexts) {
            const users = workflow.activities
                .filter(a => a.context_bindings.some(b => b.context_id === context.id))
                .map(a => `${a.name} (${a.context_bindings.find(b => b.context_id === context.id)!.access_mode})`);
            push(`| ${cell(context.name)} | ${context.type} | ${context.sync_pattern} | ${cell(users.join(', ') || 'no activity')} |`);
        }
        push('');
    }

    const rights = workflow.activities.flatMap(a => a.access_rights.map(r => ({ activity: a.name, ...r })));
    if (rights.length > 0) {
        push('### Access rights', '');
        push('| Activity | Direction | Permission | Resource |', '|---|---|---|---|');
        for (const right of rights) {
            push(`| ${cell(right.activity)} | ${right.direction} | ${right.permission} | ${right.resource_type} ${cell(right.resource_id || right.name)} |`);
        }
        push('');
    }

    const levels = required_levels(workflow);
    push('### Engine', '');
    push(`An AWA engine that claims these conformance levels: ${levels.map(code).join(', ')}.`, '');

    // ---------------------------------------------------------------- steps
    push('## 3. Build it, step by step', '');
    push('Steps are in the order this run reached them. Steps the run did not reach follow, marked as such.', '');

    const reached = [...traces.values()].sort((a, b) => a.order - b.order).map(t => t.node_id);
    const node_ids = [
        ...workflow.events.map(e => e.id), ...workflow.activities.map(a => a.id), ...workflow.decision_nodes.map(d => d.id),
    ];
    const ordered = [...reached.filter(id => node_ids.includes(id)), ...node_ids.filter(id => !reached.includes(id))];

    const routing_lines = (id: string): string[] => {
        const edges = outgoing(id);
        if (edges.length === 0) return ['- **Then**: the flow ends here.'];
        const describe = (edge: Edge) => {
            const how = edge.condition ? `when ${code(edge.condition)}` : edge.is_default ? 'otherwise (default)' : 'always';
            return `  - ${how}: go to **${name_of(edge.target_id)}**${started ? (taken.has(edge.id) ? ' (taken in this run)' : ' (not taken in this run)') : ''}`;
        };
        const parallel = edges.filter(e => !e.condition && !e.is_default).length > 1;
        return [`- **Then**${parallel ? ' (in parallel)' : ''}:`, ...edges.map(describe)];
    };

    let step = 0;
    for (const id of ordered) {
        step++;
        const trace = traces.get(id);
        const not_reached = started && !trace ? ' (not reached in this run)' : '';
        const activity = activities.get(id);
        const decision = decisions.get(id);
        const event = workflow_events.get(id);

        if (activity) {
            const role = handlers.has(id) ? ' compensation handler' : '';
            push(`### Step ${step}: ${activity.name}${not_reached}`, '');
            push(`- **Kind**: activity${role}, performed by ${code(activity.actor_type)}, role ${role_name(activity.role_id)}`);
            if (activity.description) push(`- **Purpose**: ${one_line(activity.description)}`);
            if (activity.procedure) push(`- **Procedure**: ${one_line(activity.procedure)}`);
            if (activity.inputs.length > 0) {
                push(`- **Declared inputs**: ${activity.inputs.map(i => `${code(i.name)}${i.required ? '' : ' (optional)'}`).join(', ')}`);
            }
            if (activity.outputs.length > 0) {
                push(`- **Declared outputs**: ${activity.outputs.map(o => code(o.name)).join(', ')}`);
            }
            if ((activity.tools || []).length > 0) {
                push(`- **Tools it may call**: ${(activity.tools || []).map(t => `${code(t.name)} (${binding_text(t.binding)})`).join('; ')}`);
            }
            if (activity.join === 'all') push('- **Join**: waits for a token on every incoming edge, then runs once with their merged data');

            const contract = activity.outcome_contract;
            if (contract) {
                push('- **Must produce** (outcome contract):');
                if (contract.output_schema) {
                    push('  - an outcome matching this schema:');
                    push(...schema_summary(contract.output_schema as Record<string, unknown>).map(line => `  ${line}`));
                }
                for (const condition of contract.postconditions) {
                    push(`  - ${one_line(condition.name)}: ${code(condition.expression)}`);
                }
                const budgets = contract.budgets || {};
                const limits = [
                    budgets.max_attempts !== undefined ? `at most ${plural(budgets.max_attempts, 'attempt')}` : '',
                    budgets.max_duration ? `each attempt within ${budgets.max_duration}` : '',
                    budgets.max_tokens !== undefined ? `at most ${budgets.max_tokens} model tokens` : '',
                ].filter(Boolean);
                if (limits.length) push(`  - budget: ${limits.join(', ')}`);
                push(`  - if the outcome is still rejected: ${contract.on_violation === 'escalate_human' ? 'hand it to a human' : 'fail the activity'}`);
            }

            const policy = activity.verification;
            if (policy?.enabled) {
                push(`- **Acceptance criteria** (verification by ${code(policy.mode)}, pass at ${Math.round(policy.pass_threshold * 100)}%, `
                    + `up to ${plural(policy.max_retries, 'retry')}):`);
                for (const criterion of policy.criteria) {
                    push(`  - ${one_line(criterion.name)}${criterion.required ? ' (required)' : ''}: ${one_line(criterion.description)}`
                        + `${criterion.expression ? ` Checked as ${code(criterion.expression)}.` : ''}`);
                }
            }

            if (activity.retry) {
                push(`- **On error**: up to ${plural(activity.retry.max_attempts || 1, 'attempt')}`
                    + `${activity.retry.initial_delay ? `, first delay ${activity.retry.initial_delay}` : ''}`
                    + `${activity.retry.backoff_multiplier ? `, backoff ×${activity.retry.backoff_multiplier}` : ''}`);
            }
            if (activity.compensation) {
                push(`- **If the run later fails**: undone by **${name_of(activity.compensation.activity_id)}**`);
            }
            if (activity.controls.length > 0) {
                push(`- **Controls**: ${activity.controls.map(c => `${one_line(c.name)} (${c.enforcement})`).join(', ')}`);
            }
            if (!handlers.has(id)) push(...routing_lines(id));

            if (trace) {
                push('', '**In this run**', '');
                for (const attempt of trace.attempts) {
                    const end = attempt.ended;
                    const result = !end ? 'did not finish'
                        : end.type === 'activity.completed' ? `accepted${end.data.duration_ms !== undefined ? ` (the activity took ${ms(end.data.duration_ms)} in all)` : ''}`
                            : `${(end.data.error as { code?: string })?.code === 'VERIFICATION_FAILED' || (end.data.error as { code?: string })?.code === 'CONTRACT_VIOLATION' ? 'rejected' : 'errored'}: `
                            + `${one_line((end.data.error as { message?: string })?.message)}`;
                    push(`- Attempt ${attempt.attempt}: ${result}`);

                    const model = attempt.meta.find(m => m.data.subject === 'model_selection');
                    if (model) push(`  - Model: ${one_line(model.data.decision)}. ${one_line(model.data.rationale)}`);

                    const reasoning = attempt.reasoning?.data;
                    if (reasoning) {
                        if (Array.isArray(reasoning.plan) && reasoning.plan.length) {
                            push(`  - Plan the actor reported: ${(reasoning.plan as unknown[]).map(one_line).join(' → ')}`);
                        }
                        if (reasoning.rationale) push(`  - Rationale: ${one_line(reasoning.rationale)}`);
                        if (Array.isArray(reasoning.alternatives_considered) && reasoning.alternatives_considered.length) {
                            push(`  - Alternatives it rejected: ${(reasoning.alternatives_considered as unknown[]).map(one_line).join('; ')}`);
                        }
                        if (reasoning.confidence !== undefined) push(`  - Confidence it reported: ${reasoning.confidence}`);
                    }

                    for (const invoked of attempt.tools.filter(e => e.type === 'tool.invoked')) {
                        const end = attempt.tools.find(e => e.type !== 'tool.invoked' && e.data.call_id === invoked.data.call_id);
                        const outcome = !end ? 'no result recorded'
                            : end.type === 'tool.completed' ? `returned${end.data.status !== undefined ? ` ${end.data.status}` : ''} in ${ms(end.data.duration_ms)}`
                                : `failed: ${one_line((end.data.error as { message?: string })?.message)}`;
                        push(`  - Tool call at ${invoked.time}: ${code(invoked.data.tool)} → ${one_line(invoked.data.link)} `
                            + `(${one_line((invoked.data.binding as { kind?: string })?.kind)}), ${outcome}`
                            + `${include_payloads && invoked.data.arguments !== undefined ? `. Arguments: ${code(JSON.stringify(invoked.data.arguments))}` : ''}`);
                    }
                    for (const refused of attempt.tools.filter(e => e.type === 'tool.failed' && e.data.invoked === false)) {
                        push(`  - Tool call at ${refused.time}: ${code(refused.data.tool)} was not run: ${one_line((refused.data.error as { message?: string })?.message)}`);
                    }
                    if (attempt.contract) {
                        const violations = (attempt.contract.data.violations as { message: string }[]) || [];
                        push(`  - Contract: ${attempt.contract.data.passed ? 'held' : `violated (${violations.map(v => one_line(v.message)).join('; ')})`}`);
                    }
                    if (attempt.verification) {
                        const v = attempt.verification.data;
                        push(`  - Verification: ${v.verdict}, score ${Math.round(Number(v.score) * 100)}%`);
                        for (const c of (v.criteria as { criterion_name: string; passed: boolean; evidence: string }[]) || []) {
                            push(`    - ${c.passed ? 'met' : 'not met'}: ${one_line(c.criterion_name)}. ${one_line(c.evidence)}`);
                        }
                    }
                    for (const meta of attempt.meta.filter(m => m.data.subject !== 'model_selection')) {
                        push(`  - Engine decision (${meta.data.subject}): ${one_line(meta.data.decision)}. ${one_line(meta.data.rationale)}`);
                    }
                }

                const waited = trace.events.find(e => e.type === 'token.waiting');
                if (waited) push(`- The token waited here for a human (${one_line(waited.data.reason)}).`);
                const escalated = trace.events.find(e => e.type === 'contract.escalated');
                if (escalated) push(`- Escalated to a human: ${one_line(escalated.data.message)}`);

                const accepted = [...trace.events].reverse().find(e => e.type === 'activity.completed');
                if (accepted && include_payloads && accepted.data.output !== undefined) {
                    push('', 'Accepted outcome:', '', json_block(outcome_view(accepted.data.output)));
                }
            }
            push('');
            continue;
        }

        if (decision) {
            push(`### Step ${step}: ${decision.name}${not_reached}`, '');
const table = decision.decision_table, model = decision.decision_model;
            const strategy = model ? (model.strategy || (table ? 'table_first' : 'model')) : 'table';
            const external = decision.decision_engine;
            if (external) {
                push(`- **External engine**: ${code(external.name)}${external.ruleset ? `, rule set ${code(external.ruleset)}` : ''}. `
                    + `It must return one of: ${external.options.map(o => code(o.id)).join(', ')}. Register an engine under this name before running.`);
            }
            push(`- **Kind**: decision, decided by ${external && !model ? 'an external decision engine' : external ? 'an external decision engine first, and by a model when it gives no decision'
                : strategy === 'table' ? `a decision table (hit policy ${code(table!.hit_policy)})`
                : strategy === 'model' ? 'a model' : 'a decision table first, and by a model when no rule matches'}`);
            if (decision.description) push(`- **Purpose**: ${one_line(decision.description)}`);
            if (table) push('', ...decision_table(decision, name_of, workflow), '');
            if (model) {
                push(`- **Model**: ${code(model.model || 'engine default')}${model.votes > 1 ? `, ${model.votes} votes, majority decides` : ''}`
                    + `${model.min_confidence > 0 ? `, confidence of at least ${model.min_confidence} required` : ''}`);
                push(`- **Instructions to the model**: ${one_line(model.instructions)}`);
                push('- **Options the model must choose from**:');
                for (const option of model.options) {
                    const edge = workflow.edges.find(e => e.id === option.output_edge_id);
                    push(`  - ${code(option.id)}: ${one_line(option.description)}${edge ? ` Goes to **${name_of(edge.target_id)}**.` : ''}`);
                }
                const fallback = workflow.edges.find(e => e.id === decision.default_output_edge_id);
                push(`- **If the model gives no valid decision**: ${fallback ? `go to **${name_of(fallback.target_id)}**` : 'the token fails'}`, '');
            }
            const evaluated = trace?.events.filter(e => e.type === 'decision.evaluated') || [];
            if (evaluated.length) {
                push('**In this run**', '');
                for (const e of evaluated) {
                    const rules = (e.data.matched_rules as { index: number }[]) || [];
                    const target = workflow.edges.find(edge => edge.id === e.data.edge_id);
                    const m = e.data.model as { option?: string; confidence?: number; no_decision_reason?: string; votes?: unknown[] } | undefined;
                    const eng = e.data.engine as { name?: string; option?: string; fired_rules?: string[]; explanation?: string } | undefined;
                    const how = e.data.conflict ? `the rules conflict (${one_line(e.data.conflict)})`
                        : e.data.method === 'engine' ? `engine ${code(eng?.name)} decided ${code(eng?.option)}${eng?.fired_rules?.length ? `, rules fired: ${eng.fired_rules.join(', ')}` : ''}${eng?.explanation ? `. ${one_line(eng.explanation)}` : ''}`
                        : e.data.method === 'model'
                        ? `the model chose ${code(m?.option)}${m?.confidence !== undefined ? ` with confidence ${Number(m.confidence).toFixed(2)}` : ''}${(m?.votes?.length || 0) > 1 ? ` (${m!.votes!.length} votes)` : ''}`
                        : rules.length ? `rule ${rules.map(r => r.index + 1).join(', ')} matched`
                            : m?.no_decision_reason ? `no rule matched and the model gave no decision (${one_line(m.no_decision_reason)})` : 'no rule matched';
                    const why = trace?.events.find(x => x.type === 'reasoning.recorded' && x.seq < e.seq && x.seq > e.seq - 4);
                    push(`- Inputs ${code(JSON.stringify(e.data.inputs))}: ${how}${why && e.data.method === 'model' ? `. Its stated reason: ${one_line(why.data.rationale)}` : ''}`
                        + `${e.data.used_default ? ', default edge used' : ''}`
                        + `${target ? `, routed to **${name_of(target.target_id)}**` : ', no route'}`);
                }
                push('');
            }
            continue;
        }

        if (event) {
            push(`### Step ${step}: ${event.name}${not_reached}`, '');
            const duration = event.event_type === 'timer' ? `, holds the token for ${event.event_definition?.duration}` : '';
            push(`- **Kind**: ${event.event_type} event${duration}`);
            if (event.description) push(`- **Purpose**: ${one_line(event.description)}`);
            if (event.event_type !== 'end') push(...routing_lines(id));
            push('');
        }
    }

    // --------------------------------------------------------------- wiring
    push('## 4. Wire the flow', '');
    push('| From | To | Taken when |' + (started ? ' In this run |' : ''), '|---|---|---|' + (started ? '---|' : ''));
    for (const edge of workflow.edges) {
        const when = edge.condition ? code(edge.condition) : edge.is_default ? 'no other condition holds (default)'
            : decisions.has(edge.source_id) ? 'the decision selects it' : 'always';
        push(`| ${cell(name_of(edge.source_id))} | ${cell(name_of(edge.target_id))} | ${when} |`
            + (started ? ` ${taken.has(edge.id) ? `taken ${moves.filter(m => m.data.edge_id === edge.id).length}×` : 'not taken'} |` : ''));
    }
    push('');
    push('```mermaid', 'flowchart LR');
    const mermaid_id = (id: string) => `n${id.replace(/-/g, '').slice(0, 12)}`;
    const label = (id: string) => name_of(id).replace(/["[\]{}()]/g, ' ');
    for (const id of node_ids) {
        const shape = decisions.has(id) ? `{"${label(id)}"}` : workflow_events.has(id) ? `(("${label(id)}"))` : `["${label(id)}"]`;
        push(`    ${mermaid_id(id)}${shape}`);
    }
    for (const edge of workflow.edges) {
        const text = edge.condition ? `|"${edge.condition.replace(/"/g, "'")}"|` : edge.is_default ? '|default|' : '';
        push(`    ${mermaid_id(edge.source_id)} -->${text} ${mermaid_id(edge.target_id)}`);
    }
    for (const activity of workflow.activities) {
        if (activity.compensation) push(`    ${mermaid_id(activity.id)} -.->|undone by| ${mermaid_id(activity.compensation.activity_id)}`);
    }
    push('```', '');

    // ------------------------------------------------------------- lessons
    push('## 5. What this run taught', '');
    const lessons: string[] = [];
    for (const trace of [...traces.values()].sort((a, b) => a.order - b.order)) {
        const name = name_of(trace.node_id);
        const failures = trace.attempts.filter(a => a.ended?.type === 'activity.failed');
        if (failures.length === 0) continue;
        const accepted = trace.attempts.some(a => a.ended?.type === 'activity.completed');
        for (const failure of failures) {
            const error = failure.ended!.data.error as { message?: string; code?: string };
            lessons.push(`- **${name}**, attempt ${failure.attempt}: ${one_line(error?.message)}`
                + `${error?.code ? ` (${error.code})` : ''}.`);
        }
        const escalated = trace.events.some(e => e.type === 'contract.escalated');
        lessons.push(`  - Resolution: ${accepted
            ? `accepted on attempt ${trace.attempts.find(a => a.ended?.type === 'activity.completed')!.attempt}${escalated ? ', by a human after escalation' : ''}.`
            : escalated ? 'handed to a human.' : 'none. The activity failed.'}`);
    }
    for (const event of sorted.filter(e => e.type === 'activity.compensated' || e.type === 'activity.compensation_failed')) {
        lessons.push(`- **${one_line(event.data.compensates_activity_name)}** was ${event.type === 'activity.compensated'
            ? `undone by ${one_line(event.node_name)}` : `NOT undone: ${one_line(event.node_name)} failed (${one_line((event.data.error as { message?: string })?.message)})`}.`);
    }
    const cancelled = sorted.filter(e => e.type === 'token.cancelled').length;
    if (cancelled) lessons.push(`- ${plural(cancelled, 'token')} on other branches ${cancelled === 1 ? 'was' : 'were'} cancelled when the run failed.`);
    if (ended?.type === 'run.failed') {
        for (const error of (ended.data.errors as { node_id: string; message: string }[]) || []) {
            lessons.push(`- The run failed at **${name_of(error.node_id)}**: ${one_line(error.message)}`);
        }
    }
    push(...(lessons.length ? lessons : [started
        ? '_Nothing went wrong: every attempt in this run was accepted first time._'
        : '_No run journal was supplied._']), '');

    // --------------------------------------------------------------- verify
    push('## 6. Check your build', '');
    push('1. Save the definition in the appendix as a `.awa.json` file and validate it: schema validation, then integrity validation (specification 4.3).');
    push(`2. Run it on an engine claiming ${levels.map(code).join(', ')}, with a journal:`, '',
        '   ```bash', '   awa run workflow.awa.json --journal run.journal.jsonl', '   ```', '');
    push(`3. Expect the run status ${code(status === 'not finished' ? 'completed' : status)}${started ? ', as in the run this recipe was compiled from' : ''}.`);
    const contracted = workflow.activities.filter(a => a.outcome_contract || a.verification?.enabled);
    if (contracted.length) {
        push(`4. Expect every accepted outcome of ${contracted.map(a => `**${a.name}**`).join(', ')} to satisfy its contract and acceptance criteria. `
            + 'An AI agent may take a different route from the one recorded here; the outcome must still pass the same checks.');
    }
    push(`${contracted.length ? 5 : 4}. Compile a recipe from your own run and compare sections 3 and 5 with this document.`, '');

    if (started && include_payloads && started.data.input !== undefined) {
        push('The run was started with this input:', '', json_block(started.data.input), '');
    }

    // ------------------------------------------------------------ appendix
    if (include_definition) {
        push('## Appendix: workflow definition', '', json_block(workflow), '');
    }

    return out.join('\n');
}

function binding_text(binding: { kind: string } & Record<string, unknown>): string {
    switch (binding.kind) {
        case 'http': return `HTTP ${binding.method || 'GET'} ${binding.url}`;
        case 'command': return `command \`${[binding.command, ...((binding.args as string[]) || [])].join(' ')}\``;
        case 'jsonrpc': return `JSON-RPC ${binding.method} at ${binding.endpoint}`;
        case 'grpc': return `gRPC ${binding.service}/${binding.method} at ${binding.endpoint}`;
        case 'mcp': return `MCP tool ${binding.tool} on server ${binding.server}`;
        default: return `function ${binding.name}`;
    }
}

function decision_table(decision: DecisionNode, name_of: (id: string) => string, workflow: Workflow): string[] {
    const table = decision.decision_table!;
    const target = (edge_id?: string) => {
        const edge = workflow.edges.find(e => e.id === edge_id);
        return edge ? name_of(edge.target_id) : '';
    };
    const lines = [
        `| # | ${table.inputs.map(i => cell(i.label || i.name)).join(' | ')} | ${table.outputs.map(o => cell(o.label || o.name)).join(' | ')} | Go to |`,
        `|---|${table.inputs.map(() => '---').join('|')}|${table.outputs.map(() => '---').join('|')}|---|`,
    ];
    table.rules.forEach((rule, index) => {
        lines.push(`| ${index + 1} | ${rule.input_entries.map(e => code(e || '-')).join(' | ')} `
            + `| ${rule.output_entries.map(o => cell(JSON.stringify(o))).join(' | ')} | ${cell(target(rule.output_edge_id))} |`);
    });
    if (decision.default_output_edge_id) {
        lines.push(`| default | ${table.inputs.map(() => 'anything else').join(' | ')} | ${table.outputs.map(() => '').join(' | ')} | ${cell(target(decision.default_output_edge_id))} |`);
    }
    return lines;
}
