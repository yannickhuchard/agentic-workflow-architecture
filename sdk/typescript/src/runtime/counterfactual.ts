/**
 * AWA Counterfactual Replay (specification section 20)
 *
 * Re-runs a recorded run with something changed (a model, a prompt, a
 * contract, a decision rule) while holding the rest of the world exactly as
 * it was recorded, then compares the two runs. Every journal thereby becomes
 * a regression test: "had we used this instead, what would have happened?"
 *
 * What is held fixed, taken from the baseline journal: the run's input, the
 * results of activities performed by applications, robots and people, the
 * results of tool calls, the business events received, and the passing of
 * time. What runs again: AI agents, model decisions and judges, under the
 * candidate configuration.
 */

import { Activity, Workflow } from '../types';
import { Actor } from './actors/actor';
import { business_event } from './business_event';
import { JournalEvent, canonical_json, hash_payload } from './journal';
import { ToolExecutor } from './tools';
import { EngineStatus, WorkflowEngine, WorkflowEngineOptions } from './workflow_engine';
import { as_migrated } from './migration';

export interface CounterfactualOptions {
    /** The workflow to run instead of the recorded one. Node ids must be kept for nodes that are the same. */
    candidate?: Workflow;
    /** Engine options for the candidate run: model providers, tiers, roles, knowledge */
    engine?: WorkflowEngineOptions;
    /**
     * live (default): AI agents run again under the candidate configuration.
     * recorded: their recorded outputs are replayed too, which isolates the effect
     * of a changed contract, criterion or routing rule and needs no model at all.
     */
    ai?: 'live' | 'recorded';
}

export interface NodeSide {
    reached: boolean;
    accepted: boolean;
    attempts: number;
    outcome?: unknown;
    outcome_hash?: string;
    error?: string;
    decision?: { method?: string; choice?: string };
    tool_calls: number;
    tokens: number;
}

export type NodeVerdict = 'same' | 'improved' | 'regressed' | 'changed' | 'only_baseline' | 'only_candidate';

export interface NodeComparison {
    node_id: string;
    node_name: string;
    verdict: NodeVerdict;
    notes: string[];
    baseline: NodeSide;
    candidate: NodeSide;
}

export interface RunTotals {
    run_id: string;
    status: string;
    duration_ms?: number;
    attempts: number;
    tokens: number;
    cost?: number;
    path: string[];
}

export interface CounterfactualReport {
    workflow: string;
    ai: 'live' | 'recorded';
    baseline: RunTotals;
    candidate: RunTotals;
    same_status: boolean;
    same_path: boolean;
    /** Where the two runs first went different ways */
    divergence?: { after: string; baseline_next: string; candidate_next: string };
    regressions: string[];
    improvements: string[];
    /** Activities and tool calls the candidate needed that the baseline never performed, so no result could be supplied */
    unrecorded: string[];
    nodes: NodeComparison[];
}

class Unrecorded extends Error {
    public readonly code = 'REPLAY_UNRECORDED';
}

const outcome_of_output = (output: unknown): unknown => {
    if (!output || typeof output !== 'object') return output;
    const { output: inner, usage, status, ...rest } = output as Record<string, unknown>;
    if (inner && typeof inner === 'object' && !Array.isArray(inner)) return inner;
    return inner === undefined ? rest : { output: inner, ...rest };
};

function require_payloads(events: JournalEvent[]): void {
    const hidden = events.find(e => e.type === 'activity.completed' && (e.data.output === undefined || (e.data.output as { sha256?: string })?.sha256));
    if (hidden) {
        throw new Error('This journal does not hold activity outputs (payload mode "hash" or "none"), so the run cannot be replayed. Record with payload mode "full".');
    }
}

/** What the journal says happened at each node */
function summarise(workflow: Workflow, events: JournalEvent[]): { nodes: Map<string, NodeSide>; totals: RunTotals } {
    const names = new Map<string, string>([
        ...workflow.activities.map(a => [a.id, a.name] as [string, string]),
        ...workflow.events.map(e => [e.id, e.name] as [string, string]),
        ...workflow.decision_nodes.map(d => [d.id, d.name] as [string, string]),
    ]);
    const nodes = new Map<string, NodeSide>();
    const at = (id: string) => {
        if (!nodes.has(id)) nodes.set(id, { reached: true, accepted: false, attempts: 0, tool_calls: 0, tokens: 0 });
        return nodes.get(id)!;
    };
    const path: string[] = [];
    const usage = (u: unknown) => ((u as { input_tokens?: number })?.input_tokens || 0) + ((u as { output_tokens?: number })?.output_tokens || 0);

    for (const event of [...events].sort((a, b) => a.seq - b.seq)) {
        const d = event.data;
        if (event.type === 'token.moved') {
            path.push(`${names.get(d.from_node_id as string) || d.from_node_id} → ${names.get(d.to_node_id as string) || d.to_node_id}`);
            at(d.to_node_id as string);
            continue;
        }
        if (!event.node_id || event.type.startsWith('activity.compensat')) continue;
        const node = at(event.node_id);
        switch (event.type) {
            case 'activity.started': node.attempts++; break;
            case 'activity.completed':
                node.accepted = true;
                node.outcome = outcome_of_output(d.output);
                node.outcome_hash = hash_payload(node.outcome);
                node.tokens += usage(d.usage);
                node.error = undefined;
                break;
            case 'activity.failed': node.error = (d.error as { message?: string })?.message; break;
            case 'token.failed': node.error = (d.error as { message?: string })?.message; node.accepted = false; break;
            case 'tool.invoked': node.tool_calls++; break;
            case 'decision.evaluated': {
                const model = d.model as { option?: string; usage?: unknown } | undefined;
                const engine = d.engine as { option?: string } | undefined;
                const rules = (d.matched_rules as { index: number }[]) || [];
                node.accepted = d.method !== 'none';
                node.decision = {
                    method: d.method as string,
                    choice: d.method === 'model' ? model?.option : d.method === 'engine' ? engine?.option
                        : d.method === 'table' ? `rule ${rules.map(r => r.index + 1).join(', ')}` : String(d.method),
                };
                node.tokens += usage(model?.usage);
                node.outcome_hash = hash_payload([d.edge_id ?? null]);
                break;
            }
            case 'event.received': case 'timer.fired': case 'event.published': node.accepted = true; break;
        }
    }
    const ended = events.find(e => e.type === 'run.completed' || e.type === 'run.failed');
    return {
        nodes,
        totals: {
            run_id: events[0]?.run_id || '',
            status: ended ? (ended.type === 'run.completed' ? 'completed' : 'failed') : 'unfinished',
            duration_ms: ended?.data.duration_ms as number | undefined,
            attempts: events.filter(e => e.type === 'activity.started').length,
            tokens: [...nodes.values()].reduce((sum, n) => sum + n.tokens, 0),
            cost: ended?.data.cost as number | undefined,
            path,
        },
    };
}

/** Compare two journals of the same workflow, node by node */
export function compare_runs(
    workflow: Workflow, baseline: JournalEvent[], candidate: JournalEvent[],
    ai: 'live' | 'recorded' = 'live', unrecorded: string[] = [],
    /** Nodes whose results were supplied from the recording. Their attempt counts say nothing about the candidate. */
    replayed: Set<string> = new Set(),
): CounterfactualReport {
    const b = summarise(workflow, baseline), c = summarise(workflow, candidate);
    const name = new Map<string, string>([
        ...workflow.activities.map(a => [a.id, a.name] as [string, string]),
        ...workflow.events.map(e => [e.id, e.name] as [string, string]),
        ...workflow.decision_nodes.map(d => [d.id, d.name] as [string, string]),
    ]);
    const absent: NodeSide = { reached: false, accepted: false, attempts: 0, tool_calls: 0, tokens: 0 };
    const nodes: NodeComparison[] = [];

    for (const id of new Set([...b.nodes.keys(), ...c.nodes.keys()])) {
        if (!name.has(id)) continue;
        const base = b.nodes.get(id) || absent, cand = c.nodes.get(id) || absent;
        const notes: string[] = [];
        let verdict: NodeVerdict = 'same';

        if (!cand.reached) { verdict = 'only_baseline'; notes.push('The candidate run did not reach this step.'); }
        else if (!base.reached) { verdict = 'only_candidate'; notes.push('The recorded run did not reach this step.'); }
        else {
            if (base.accepted && !cand.accepted) { verdict = 'regressed'; notes.push(`Accepted in the recorded run, not in the candidate${cand.error ? `: ${cand.error}` : ''}.`); }
            else if (!base.accepted && cand.accepted) { verdict = 'improved'; notes.push('Not accepted in the recorded run, accepted in the candidate.'); }
            else if (base.decision && cand.decision && (base.decision.choice !== cand.decision.choice || base.outcome_hash !== cand.outcome_hash)) {
                verdict = 'changed';
                notes.push(`Decision changed from ${base.decision.choice} (${base.decision.method}) to ${cand.decision.choice} (${cand.decision.method}).`);
            } else {
                if (replayed.has(id)) { /* a replayed result is accepted at once; that is not an improvement */ }
                else if (cand.attempts < base.attempts) { verdict = 'improved'; notes.push(`Accepted in ${cand.attempts} attempt(s), down from ${base.attempts}.`); }
                else if (cand.attempts > base.attempts) { verdict = 'regressed'; notes.push(`Needed ${cand.attempts} attempt(s), up from ${base.attempts}.`); }
                if (base.outcome_hash !== cand.outcome_hash && !base.decision) {
                    if (verdict === 'same') verdict = 'changed';
                    notes.push('The accepted outcome differs.');
                }
            }
            if (cand.tool_calls !== base.tool_calls) notes.push(`Tool calls: ${base.tool_calls} recorded, ${cand.tool_calls} in the candidate.`);
            if (!replayed.has(id) && cand.tokens !== base.tokens && (cand.tokens || base.tokens)) notes.push(`Model tokens: ${base.tokens} recorded, ${cand.tokens} in the candidate.`);
        }
        nodes.push({ node_id: id, node_name: name.get(id)!, verdict, notes, baseline: base, candidate: cand });
    }

    let divergence: CounterfactualReport['divergence'];
    for (let i = 0; i < Math.max(b.totals.path.length, c.totals.path.length); i++) {
        if (b.totals.path[i] !== c.totals.path[i]) {
            const [after] = (b.totals.path[i] || c.totals.path[i]).split(' → ');
            divergence = { after, baseline_next: b.totals.path[i]?.split(' → ')[1] || '(the run ended)', candidate_next: c.totals.path[i]?.split(' → ')[1] || '(the run ended)' };
            break;
        }
    }
    const same_path = canonical_json([...b.totals.path].sort()) === canonical_json([...c.totals.path].sort());

    return {
        workflow: workflow.name, ai,
        baseline: b.totals, candidate: c.totals,
        same_status: b.totals.status === c.totals.status,
        same_path,
        ...(same_path ? {} : { divergence }),
        regressions: nodes.filter(n => n.verdict === 'regressed').map(n => `${n.node_name}: ${n.notes[0]}`)
            .concat(b.totals.status === 'completed' && c.totals.status !== 'completed' ? [`The run ${c.totals.status === 'failed' ? 'failed' : 'did not finish'}; the recorded run completed.`] : []),
        improvements: nodes.filter(n => n.verdict === 'improved').map(n => `${n.node_name}: ${n.notes[0]}`)
            .concat(b.totals.status !== 'completed' && c.totals.status === 'completed' ? ['The run completed; the recorded run did not.'] : []),
        unrecorded,
        nodes,
    };
}

/**
 * Replay a recorded run under a candidate configuration and compare.
 * Returns the report and the candidate run's own journal.
 */
export async function counterfactual_replay(
    workflow: Workflow,
    baseline: JournalEvent[],
    options: CounterfactualOptions = {},
): Promise<{ report: CounterfactualReport; events: JournalEvent[]; status: EngineStatus }> {
    // A run moved to another version is matched node by node as its migrations mapped it (spec 25.5)
    const recorded = as_migrated(baseline);
    require_payloads(recorded);
    const ai = options.ai || 'live';
    const candidate = options.candidate || workflow;
    const unrecorded: string[] = [];

    // --- the recorded world ----------------------------------------------
    const outputs = new Map<string, Record<string, unknown>[]>();
    for (const event of recorded) {
        if ((event.type === 'activity.completed' || event.type === 'activity.compensated') && event.node_id) {
            outputs.set(event.node_id, [...(outputs.get(event.node_id) || []), (event.data.output || {}) as Record<string, unknown>]);
        }
    }
    const tool_results = new Map<string, { ok: boolean; status?: unknown; result?: unknown; error?: string }[]>();
    const invoked = new Map<string, JournalEvent>();
    for (const event of recorded) {
        if (event.type === 'tool.invoked') invoked.set(event.data.call_id as string, event);
        if (event.type === 'tool.completed' || event.type === 'tool.failed') {
            const call = invoked.get(event.data.call_id as string);
            if (!call) continue;
            const key = `${call.data.tool}:${canonical_json(call.data.arguments)}`;
            tool_results.set(key, [...(tool_results.get(key) || []), event.type === 'tool.completed'
                ? { ok: true, status: event.data.status, result: event.data.result }
                : { ok: false, status: event.data.status, error: (event.data.error as { message?: string })?.message }]);
        }
    }
    const decisions = new Map<string, { option?: string; confidence?: number }[]>();
    for (const event of recorded) {
        if (event.type === 'decision.evaluated' && event.node_id && event.data.model) {
            const model = event.data.model as { option?: string; confidence?: number };
            decisions.set(event.node_id, [...(decisions.get(event.node_id) || []), { option: model.option, confidence: model.confidence }]);
        }
    }
    const received = recorded.filter(e => e.type === 'event.received');
    const timeouts = recorded.filter(e => e.type === 'event.timed_out').length;

    const recorded_actor: Actor = {
        execute: async (activity: Activity) => {
            const queue = outputs.get(activity.id);
            if (!queue || queue.length === 0) {
                unrecorded.push(`activity "${activity.name}"`);
                throw new Unrecorded(`"${activity.name}" was not performed in the recorded run, so there is no result to replay`);
            }
            // The last recorded result repeats if the candidate visits the step more often
            return queue.length > 1 ? queue.shift()! : queue[0];
        },
    };
    const recorded_tool: ToolExecutor = async (binding, args) => {
        const tool = [...candidate.activities.flatMap(a => a.tools || [])].find(t => t.binding === binding);
        const key = `${tool?.name}:${canonical_json(args)}`;
        const queue = tool_results.get(key);
        if (!queue || queue.length === 0) {
            unrecorded.push(`tool call ${tool?.name}(${JSON.stringify(args)})`);
            throw Object.assign(new Error(`No recorded result for ${tool?.name} with these arguments`), { code: 'REPLAY_UNRECORDED' });
        }
        const hit = queue.length > 1 ? queue.shift()! : queue[0];
        if (!hit.ok) throw Object.assign(new Error(hit.error || 'The recorded call failed'), { code: 'TOOL_ERROR', status: hit.status });
        return { status: hit.status as number | string | undefined, result: hit.result };
    };

    // --- the candidate run ------------------------------------------------
    const started = recorded.find(e => e.type === 'run.started');
    const engine = new WorkflowEngine(candidate, {
        ...options.engine,
        simulate: false,
        // With recorded AI, the choices models made at decision nodes are replayed as well
        ...(ai === 'recorded' ? {
            model_decision_override: node => {
                const queue = decisions.get(node.id);
                if (!queue || queue.length === 0) return undefined;
                return queue.length > 1 ? queue.shift() : queue[0];
            },
        } : {}),
        wait_for_human_tasks: false,
        // A call activity's result is held as recorded: no child run is started (24.7)
        subworkflows: { ...options.engine?.subworkflows, actor: recorded_actor },
        sleep: async () => { },
        execution_logger: options.engine?.execution_logger || { log_execution: async () => { } },
        actors: {
            application: recorded_actor, human: recorded_actor, robot: recorded_actor,
            ...(ai === 'recorded' ? { ai_agent: recorded_actor } : {}),
            ...(options.engine?.actors || {}),
        },
        tools: {
            ...(options.engine?.tools || {}),
            executors: { http: recorded_tool, command: recorded_tool, jsonrpc: recorded_tool, grpc: recorded_tool, mcp: recorded_tool, function: recorded_tool, ...(options.engine?.tools?.executors || {}) },
            allow_commands: true,
            allowed_hosts: undefined,
        },
    });

    await engine.start((started?.data.input || {}) as Record<string, unknown>);
    let status = await engine.run();
    let remaining_timeouts = timeouts;
    let next = 0;
    while (status === 'waiting_event') {
        // Give the candidate the events the recorded run received, in order, then its timeouts
        let progressed = false;
        while (next < received.length && !progressed) {
            const e = received[next++];
            progressed = await engine.deliverEvent(business_event(e.data.name as string, (e.data.data || {}) as Record<string, unknown>, { source: e.data.source as string })) > 0;
        }
        if (!progressed && remaining_timeouts > 0) {
            remaining_timeouts--;
            progressed = await engine.expireEvents(Number.MAX_SAFE_INTEGER) > 0;
        }
        if (!progressed) {
            unrecorded.push('a business event the candidate run waited for');
            break;
        }
        status = await engine.run();
    }

    const events = await engine.getEvents();
    const replayed = new Set(candidate.activities.filter(a => ai === 'recorded' || a.actor_type !== 'ai_agent').map(a => a.id));
    return { report: compare_runs(candidate, recorded, events, ai, [...new Set(unrecorded)], replayed), events, status };
}

const ms = (value?: number) => (value === undefined ? 'n/a' : value < 1000 ? `${Math.round(value)} ms` : `${(value / 1000).toFixed(1)} s`);

/** The report as Markdown */
export function render_counterfactual_report(report: CounterfactualReport): string {
    const out: string[] = [];
    const verdict = report.regressions.length ? 'The candidate is worse on at least one step.'
        : report.improvements.length ? 'The candidate is better, with no regressions.'
            : report.same_status && report.same_path && report.nodes.every(n => n.verdict === 'same') ? 'The candidate behaves exactly as recorded.'
                : 'The candidate behaves differently, with no step worse than recorded.';
    out.push(`# Counterfactual replay: ${report.workflow}`, '', `**${verdict}**`, '');
    out.push(report.ai === 'live'
        ? 'AI agents, model decisions and judges ran again under the candidate configuration. Everything else was held as recorded.'
        : 'Recorded AI outputs were replayed too, so only the changed contracts, criteria and rules could make a difference.', '');
    out.push('| | Recorded | Candidate |', '|---|---|---|');
    out.push(`| Outcome | ${report.baseline.status} | ${report.candidate.status} |`);
    if (report.ai === 'live') {
        out.push(`| Attempts | ${report.baseline.attempts} | ${report.candidate.attempts} |`);
        out.push(`| Model tokens | ${report.baseline.tokens} | ${report.candidate.tokens} |`);
    }
    out.push(`| Duration | ${ms(report.baseline.duration_ms)} | ${ms(report.candidate.duration_ms)} (replayed, without real waiting) |`, '');

    if (!report.same_path && report.divergence) {
        out.push(`**The runs took different paths.** After **${report.divergence.after}**, the recorded run went to **${report.divergence.baseline_next}** and the candidate to **${report.divergence.candidate_next}**.`, '');
    } else {
        out.push('Both runs took the same path.', '');
    }
    const list = (title: string, items: string[]) => { if (items.length) out.push(`## ${title}`, '', ...items.map(i => `- ${i}`), ''); };
    list('Regressions', report.regressions);
    list('Improvements', report.improvements);
    list('Could not be replayed', report.unrecorded.map(u => `No recorded result for ${u}. The candidate went somewhere the recorded run never did.`));

    out.push('## Step by step', '', '| Step | Verdict | Recorded | Candidate | Notes |', '|---|---|---|---|---|');
    const side = (s: NodeSide) => !s.reached ? 'not reached'
        : s.decision ? `${s.decision.choice} (${s.decision.method})`
            : `${s.accepted ? 'accepted' : 'not accepted'}${s.attempts ? `, ${s.attempts} attempt${s.attempts === 1 ? '' : 's'}` : ''}`;
    for (const node of report.nodes) {
        out.push(`| ${node.node_name} | ${node.verdict.replace('_', ' ')} | ${side(node.baseline)} | ${side(node.candidate)} | ${node.notes.join(' ').replace(/\|/g, '\\|')} |`);
    }
    out.push('');
    return out.join('\n');
}
