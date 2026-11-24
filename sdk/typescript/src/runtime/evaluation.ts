/**
 * Evaluation from journals (specification section 33)
 *
 * Every visit of a run to an AI activity is a labelled example: the input the
 * agent was given, and the outcome that was accepted (by its outcome contract,
 * by verification, or by a person to whom it was escalated), or the fact that
 * it was rejected. `build_dataset` turns journals into such cases.
 * `evaluate_dataset` performs each case again under a candidate workflow or
 * model, through counterfactual replay (section 20): the agent runs again, and
 * the tools it calls answer as they did when the case was recorded. It reports,
 * per activity, how often the candidate's outcomes are accepted, and the cases
 * the candidate loses or wins against the recording.
 */

import { Activity, Workflow } from '../types';
import { counterfactual_replay } from './counterfactual';
import { JournalEvent, canonical_json, public_payload } from './journal';
import { WorkflowEngineOptions } from './workflow_engine';

type Json = Record<string, any>;

export interface EvaluationToolCall { tool: string; arguments: unknown; ok: boolean; status?: unknown; result?: unknown; error?: string }
export interface EvaluationRejection { attempt: number; code: string | null; terms: string[] }

/** One labelled case: a line of a dataset file (spec/json-schema/evaluation-case.schema.json) */
export interface EvaluationCase {
    id: string;
    workflow_id: string;
    workflow_version: string | null;
    run_id: string;
    activity_id: string;
    activity_name: string;
    input: Json;
    label: 'accepted' | 'rejected';
    /** Who accepted the outcome: its contract, verification, a person it was escalated to, or nothing that checks */
    accepted_by?: 'contract' | 'verification' | 'person' | 'unchecked';
    /** What rejected the visit's last attempt */
    rejected_by?: 'contract' | 'verification' | 'error';
    outcome?: unknown;
    attempts: number;
    rejections: EvaluationRejection[];
    tool_calls: EvaluationToolCall[];
    /** The sequence numbers of the journal records the case was built from */
    sources: number[];
}

export interface DatasetResult {
    cases: EvaluationCase[];
    /** Visits to AI activities that could not become cases, and why */
    skipped: { run_id: string; activity_name: string; reason: string }[];
}

const outcome_of_output = (output: unknown): unknown => {
    if (!output || typeof output !== 'object') return output;
    const inner = (output as Record<string, unknown>).output;
    // What an actor reports about its work beside the outcome is not part of it (11.1)
    const rest = Object.fromEntries(Object.entries(output as Record<string, unknown>).filter(([k]) => k !== 'output' && k !== 'usage' && k !== 'status'));
    if (inner && typeof inner === 'object' && !Array.isArray(inner)) return inner;
    return inner === undefined ? public_payload(rest) : { output: inner, ...public_payload(rest) };
};
const held = (value: unknown) => value !== undefined && !(value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length === 1 && typeof (value as Json).sha256 === 'string');
const term_name = (v: unknown) => typeof v === 'string' ? v : String((v as Json)?.name ?? (v as Json)?.path ?? (v as Json)?.message ?? '');

/** Build evaluation cases from journals. Events of several runs may be mixed; each run is read in sequence order. */
export function build_dataset(events: JournalEvent[]): DatasetResult {
    const by_run = new Map<string, JournalEvent[]>();
    for (const e of events) { if (!by_run.has(e.run_id)) by_run.set(e.run_id, []); by_run.get(e.run_id)!.push(e); }
    const cases: EvaluationCase[] = [], skipped: DatasetResult['skipped'] = [];

    for (const [run_id, unsorted] of by_run) {
        const journal = [...unsorted].sort((a, b) => a.seq - b.seq);
        const started = journal.find(e => e.type === 'run.started');
        type Visit = { node_id: string; token_id?: string; name: string; events: JournalEvent[]; last_attempt: number; ended?: 'accepted' | 'rejected'; ai: boolean };
        const visits: Visit[] = [];
        const open = new Map<string, Visit>();
        for (const e of journal) {
            if (!e.node_id) continue;
            const key = `${e.token_id || ''}|${e.node_id}`;
            let visit = open.get(key);
            if (e.type === 'activity.started') {
                const attempt = e.attempt ?? 1;
                if (!visit || attempt <= visit.last_attempt) {
                    visit = { node_id: e.node_id, token_id: e.token_id, name: e.node_name || e.node_id, events: [], last_attempt: 0, ai: (e.data as Json)?.actor_type === 'ai_agent' };
                    visits.push(visit);
                    open.set(key, visit);
                }
                visit.last_attempt = attempt;
            }
            if (!visit) continue;
            visit.events.push(e);
            if (e.type === 'activity.completed') { visit.ended = 'accepted'; open.delete(key); }
            else if (e.type === 'token.failed' || e.type === 'activity.dead_lettered') { visit.ended = 'rejected'; open.delete(key); }
        }

        const count = new Map<string, number>();
        for (const visit of visits) {
            const n = (count.get(visit.node_id) || 0) + 1;
            count.set(visit.node_id, n);
            if (!visit.ai) continue;
            const skip = (reason: string) => skipped.push({ run_id, activity_name: visit.name, reason });
            if (!visit.ended) { skip('the visit had not ended when the journal was written'); continue; }
            const first = visit.events.find(e => e.type === 'activity.started')!;
            const input = (first.data as Json).input;
            if (!held(input)) { skip('the journal does not hold the input (payload mode "hash" or "none")'); continue; }
            const completed = visit.events.find(e => e.type === 'activity.completed');
            if (completed && !held((completed.data as Json).output)) { skip('the journal does not hold the outcome (payload mode "hash" or "none")'); continue; }

            const at = (type: string, attempt?: number) => visit.events.filter(e => e.type === type && (attempt === undefined || e.attempt === attempt));
            const failed = at('activity.failed');
            const rejections: EvaluationRejection[] = failed.map(f => {
                const contract = at('contract.checked', f.attempt).filter(c => (c.data as Json).passed === false).pop();
                const verification = at('verification.completed', f.attempt).filter(v => (v.data as Json).verdict !== 'pass').pop();
                const terms = contract ? ((contract.data as Json).violations || []).map(term_name)
                    : verification ? ((verification.data as Json).criteria || []).filter((c: Json) => c.passed === false).map((c: Json) => String(c.criterion_name ?? c.name ?? c.criterion_id))
                        : [];
                return { attempt: f.attempt ?? 1, code: ((f.data as Json).error?.code as string) ?? null, terms };
            });
            const calls: EvaluationToolCall[] = [];
            for (const invoked of at('tool.invoked')) {
                const call_id = (invoked.data as Json).call_id;
                const end = visit.events.find(e => (e.type === 'tool.completed' || e.type === 'tool.failed') && (e.data as Json).call_id === call_id);
                const d = (end?.data || {}) as Json;
                calls.push(end?.type === 'tool.completed'
                    ? { tool: (invoked.data as Json).tool, arguments: (invoked.data as Json).arguments, ok: true, ...(d.status !== undefined ? { status: d.status } : {}), result: d.result }
                    : { tool: (invoked.data as Json).tool, arguments: (invoked.data as Json).arguments, ok: false, ...(d.status !== undefined ? { status: d.status } : {}), error: d.error?.message ?? 'no result was recorded' });
            }
            const used = new Set(['activity.started', 'activity.completed', 'activity.failed', 'contract.checked', 'verification.completed', 'contract.escalated', 'tool.invoked', 'tool.completed', 'tool.failed', 'token.failed', 'activity.dead_lettered']);
            const base = {
                id: `${run_id}:${visit.node_id}:${n}`, workflow_id: first.workflow_id, workflow_version: ((started?.data as Json)?.workflow_version as string) ?? null,
                run_id, activity_id: visit.node_id, activity_name: visit.name, input: input as Json,
            };
            const rest = { attempts: visit.last_attempt, rejections, tool_calls: calls, sources: visit.events.filter(e => used.has(e.type)).map(e => e.seq) };
            if (completed) {
                const final = completed.attempt;
                const accepted_by = at('contract.escalated').length ? 'person'
                    : at('verification.completed', final).some(v => (v.data as Json).verdict === 'pass') ? 'verification'
                        : at('contract.checked', final).some(c => (c.data as Json).passed === true) ? 'contract' : 'unchecked';
                cases.push({ ...base, label: 'accepted', accepted_by, outcome: outcome_of_output((completed.data as Json).output), ...rest });
            } else {
                const code = rejections[rejections.length - 1]?.code;
                cases.push({ ...base, label: 'rejected', rejected_by: code === 'CONTRACT_VIOLATION' ? 'contract' : code === 'VERIFICATION_FAILED' ? 'verification' : 'error', ...rest });
            }
        }
    }
    return { cases, skipped };
}

export interface EvaluationOptions {
    /** The workflow to evaluate instead of the one the cases were recorded with. Activities are matched by id. */
    candidate?: Workflow;
    /** Engine options for the candidate: model providers and tiers, roles, or the ai_agent actor */
    engine?: WorkflowEngineOptions;
    /** Further engine options for one case, merged over `engine` */
    engine_for_case?: (c: EvaluationCase) => WorkflowEngineOptions | undefined;
}

export interface CaseResult {
    case_id: string;
    activity_id: string;
    activity_name: string;
    recorded: 'accepted' | 'rejected';
    candidate: 'accepted' | 'rejected';
    attempts: number;
    /** The candidate's last outcome met the contract: null when the activity has no contract or no outcome was checked */
    contract_passed: boolean | null;
    verification_passed: boolean | null;
    /** The candidate's accepted outcome equals the recorded one: null unless both were accepted */
    same_outcome: boolean | null;
    change: 'same' | 'improved' | 'regressed';
    error?: string;
    unrecorded: string[];
}

export interface Rate { value: number | null; n: number }
export interface ActivityScore {
    activity_id: string;
    activity_name: string;
    cases: number;
    recorded_rate: Rate;
    pass_rate: Rate;
    contract_pass_rate: Rate;
    verification_pass_rate: Rate;
    same_outcome_rate: Rate;
    regressions: string[];
    improvements: string[];
}

export interface EvaluationReport {
    spec_version: '1.1';
    workflow: { id: string; name: string };
    candidate: { id: string; name: string; version: string };
    cases: number;
    evaluated: number;
    skipped: { case_id: string; reason: string }[];
    totals: { recorded_rate: Rate; pass_rate: Rate; contract_pass_rate: Rate; verification_pass_rate: Rate };
    activities: ActivityScore[];
    regressions: { case_id: string; activity_name: string; reason: string }[];
    improvements: { case_id: string; activity_name: string; reason: string }[];
    results: CaseResult[];
}

const rate = (part: number, whole: number): Rate => ({ value: whole ? part / whole : null, n: whole });

/** The workflow reduced to one activity, so that a case exercises that activity alone */
function isolate(workflow: Workflow, activity: Activity): Workflow {
    return {
        ...workflow,
        activities: [{
            ...activity,
            context_bindings: [], knowledge: undefined, sla: undefined, join: undefined, compensation: undefined,
            // A person is not asked in an evaluation: an outcome the contract would escalate is rejected
            ...(activity.outcome_contract ? { outcome_contract: { ...activity.outcome_contract, on_violation: 'fail' as const } } : {}),
        }],
        edges: [], events: [], decision_nodes: [], contexts: [], sla: undefined,
    };
}

/** A journal that holds exactly what the case recorded: its input, its tool calls, and its result */
function case_journal(c: EvaluationCase, workflow: Workflow): JournalEvent[] {
    const events: JournalEvent[] = [];
    const time = new Date(0).toISOString();
    const add = (type: JournalEvent['type'], data: Json, at_node = true) => events.push({
        spec_version: '1.1', id: `${c.id}#${events.length + 1}`, run_id: c.run_id, seq: events.length + 1, time, type, level: 'execution', workflow_id: workflow.id,
        ...(at_node ? { node_id: c.activity_id, node_name: c.activity_name, attempt: 1, token_id: 'case' } : {}), data,
    });
    add('run.started', { workflow_name: workflow.name, workflow_version: c.workflow_version, input: c.input }, false);
    add('activity.started', { actor_type: 'ai_agent', input: c.input });
    c.tool_calls.forEach((call, i) => {
        add('tool.invoked', { call_id: `call-${i}`, tool: call.tool, arguments: call.arguments });
        add(call.ok ? 'tool.completed' : 'tool.failed', call.ok ? { call_id: `call-${i}`, tool: call.tool, status: call.status, result: call.result } : { call_id: `call-${i}`, tool: call.tool, invoked: true, error: { message: call.error } });
    });
    if (c.label === 'accepted') {
        add('activity.completed', { actor_type: 'ai_agent', output: c.outcome });
        add('run.completed', {}, false);
    } else {
        add('activity.failed', { error: { code: c.rejections[c.rejections.length - 1]?.code ?? null } });
        add('run.failed', {}, false);
    }
    return events;
}

/** Perform every case again under the candidate and score the outcomes against contracts and verification */
export async function evaluate_dataset(workflow: Workflow, cases: EvaluationCase[], options: EvaluationOptions = {}): Promise<EvaluationReport> {
    const candidate = options.candidate || workflow;
    const results: CaseResult[] = [];
    const skipped: EvaluationReport['skipped'] = [];

    for (const c of cases) {
        if (c.workflow_id !== workflow.id) { skipped.push({ case_id: c.id, reason: `recorded with workflow ${c.workflow_id}, not ${workflow.id}` }); continue; }
        const recorded_activity = workflow.activities.find(a => a.id === c.activity_id);
        const activity = candidate.activities.find(a => a.id === c.activity_id);
        if (!activity || !recorded_activity) { skipped.push({ case_id: c.id, reason: `the ${activity ? 'recorded workflow' : 'candidate'} has no activity ${c.activity_id} ("${c.activity_name}")` }); continue; }

        const extra = options.engine_for_case?.(c) || {};
        const engine: WorkflowEngineOptions = { ...options.engine, ...extra, actors: { ...options.engine?.actors, ...extra.actors } };
        const { report, events } = await counterfactual_replay(isolate(workflow, recorded_activity), case_journal(c, workflow), {
            candidate: isolate(candidate, activity), ai: 'live', engine,
        });
        const at = (type: string) => events.filter(e => e.type === type && e.node_id === c.activity_id);
        const completed = at('activity.completed').pop();
        const contracts = at('contract.checked'), verifications = at('verification.completed');
        const outcome = completed ? outcome_of_output((completed.data as Json).output) : undefined;
        const accepted = !!completed;
        const change = c.label === 'accepted' && !accepted ? 'regressed' : c.label === 'rejected' && accepted ? 'improved' : 'same';
        const failure = at('activity.failed').pop();
        results.push({
            case_id: c.id, activity_id: c.activity_id, activity_name: activity.name,
            recorded: c.label, candidate: accepted ? 'accepted' : 'rejected',
            attempts: at('activity.started').length,
            contract_passed: contracts.length ? (contracts[contracts.length - 1].data as Json).passed === true : null,
            verification_passed: verifications.length ? (verifications[verifications.length - 1].data as Json).verdict === 'pass' : null,
            same_outcome: c.label === 'accepted' && accepted ? canonical_json(outcome) === canonical_json(c.outcome) : null,
            change,
            ...(!accepted && failure ? { error: `${(failure.data as Json).error?.code || 'ERROR'}: ${(failure.data as Json).error?.message || ''}`.trim() } : {}),
            unrecorded: report.unrecorded,
        });
    }

    const groups = new Map<string, CaseResult[]>();
    for (const r of results) { if (!groups.has(r.activity_id)) groups.set(r.activity_id, []); groups.get(r.activity_id)!.push(r); }
    const score = (list: CaseResult[]) => {
        const contract = list.filter(r => r.contract_passed !== null), verification = list.filter(r => r.verification_passed !== null), both = list.filter(r => r.same_outcome !== null);
        return {
            recorded_rate: rate(list.filter(r => r.recorded === 'accepted').length, list.length),
            pass_rate: rate(list.filter(r => r.candidate === 'accepted').length, list.length),
            contract_pass_rate: rate(contract.filter(r => r.contract_passed).length, contract.length),
            verification_pass_rate: rate(verification.filter(r => r.verification_passed).length, verification.length),
            same_outcome_rate: rate(both.filter(r => r.same_outcome).length, both.length),
        };
    };
    const reason = (r: CaseResult) => r.change === 'regressed'
        ? `accepted when recorded; the candidate's outcome was rejected${r.error ? ` (${r.error})` : ''}`
        : 'rejected when recorded; the candidate\'s outcome was accepted';
    const activities: ActivityScore[] = [...groups.entries()].map(([activity_id, list]) => ({
        activity_id, activity_name: list[0].activity_name, cases: list.length, ...score(list),
        regressions: list.filter(r => r.change === 'regressed').map(r => r.case_id),
        improvements: list.filter(r => r.change === 'improved').map(r => r.case_id),
    }));
    const totals = score(results);
    return {
        spec_version: '1.1',
        workflow: { id: workflow.id, name: workflow.name },
        candidate: { id: candidate.id, name: candidate.name, version: candidate.version },
        cases: cases.length, evaluated: results.length, skipped,
        totals: { recorded_rate: totals.recorded_rate, pass_rate: totals.pass_rate, contract_pass_rate: totals.contract_pass_rate, verification_pass_rate: totals.verification_pass_rate },
        activities,
        regressions: results.filter(r => r.change === 'regressed').map(r => ({ case_id: r.case_id, activity_name: r.activity_name, reason: reason(r) })),
        improvements: results.filter(r => r.change === 'improved').map(r => ({ case_id: r.case_id, activity_name: r.activity_name, reason: reason(r) })),
        results,
    };
}

/** A dataset as JSON Lines, one case per line */
export function dataset_to_jsonl(cases: EvaluationCase[]): string {
    return cases.map(c => JSON.stringify(c)).join('\n') + (cases.length ? '\n' : '');
}
export function parse_dataset(content: string): EvaluationCase[] {
    return content.split('\n').filter(line => line.trim()).map(line => JSON.parse(line) as EvaluationCase);
}

const percent = (r: Rate) => r.value === null ? 'no value' : `${Math.round(r.value * 100)}% of ${r.n}`;

/** The report as Markdown */
export function render_evaluation_report(report: EvaluationReport): string {
    const out: string[] = [];
    out.push(`# Evaluation: ${report.candidate.name} ${report.candidate.version}`, '');
    out.push(report.regressions.length ? `**The candidate loses ${report.regressions.length} case(s) that were accepted when recorded.**`
        : report.improvements.length ? '**The candidate loses no recorded case and wins at least one.**' : '**The candidate gets the same cases accepted as the recording.**', '');
    out.push(`${report.evaluated} of ${report.cases} case(s) evaluated against the outcome contracts and verification of ${report.candidate.name}. Each case's AI activity ran again; the tools it called answered as recorded.`, '');
    out.push('| Activity | Cases | Accepted when recorded | Accepted now | Contract met | Verification passed | Same outcome | Regressions | Improvements |', '|---|---|---|---|---|---|---|---|---|');
    for (const a of report.activities) {
        out.push(`| ${a.activity_name} | ${a.cases} | ${percent(a.recorded_rate)} | ${percent(a.pass_rate)} | ${percent(a.contract_pass_rate)} | ${percent(a.verification_pass_rate)} | ${percent(a.same_outcome_rate)} | ${a.regressions.length} | ${a.improvements.length} |`);
    }
    out.push('');
    const list = (title: string, items: { case_id: string; activity_name: string; reason: string }[]) => {
        if (!items.length) return;
        out.push(`## ${title}`, '', ...items.map(i => `- ${i.activity_name}, case ${i.case_id}: ${i.reason}`), '');
    };
    list('Regressions', report.regressions);
    list('Improvements', report.improvements);
    if (report.skipped.length) out.push('## Not evaluated', '', ...report.skipped.map(s => `- ${s.case_id}: ${s.reason}`), '');
    return out.join('\n');
}
