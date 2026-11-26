/**
 * Evidence (specification section 32)
 *
 * An evidence report says, for a period and a set of workflows, what ran, which
 * models decided what, what people decided, what was checked and with what
 * result, what was refused, what failed and was undone, which outside systems
 * were called, how data was journalled, which records are held, and what the
 * guardrails found. Every
 * statement is computed from journals and journey records, never estimated,
 * and cites the records it rests on: a run id and sequence numbers, or a
 * journey instance and sequence numbers.
 *
 * Each part names the provisions it can serve as evidence for: articles of the
 * EU AI Act (Regulation (EU) 2024/1689), functions of the NIST AI Risk
 * Management Framework and clauses of ISO/IEC 42001. The report is evidence a
 * deployer can use. It does not certify compliance with anything.
 *
 * This file depends on nothing, so that a host, a command and a page can share it.
 */

type Json = Record<string, any>;

export interface EvidenceEvent { type: string; time: string; seq: number; run_id?: string; token_id?: string; node_id?: string; node_name?: string; attempt?: number; stage_id?: string; data?: Json }
export interface EvidenceRun { run_id: string; workflow_id: string; stage_id?: string; events: EvidenceEvent[] }
export interface EvidenceInstance { id: string; journey_id: string; subject_key: string; status: string; started_at: string; ended_at?: string; events?: (EvidenceEvent & { journey_instance_id?: string })[] }
/** What the report is computed from: a portfolio as a host exports it (19.10), and runs that belong to no journey */
export interface EvidenceInput {
    as_of?: string;
    workflows?: { id: string; name: string; version?: string; activities?: { id: string; name: string; actor_type?: string }[] }[];
    journeys?: { definition: { id: string; name: string }; instances: { instance: EvidenceInstance; runs: EvidenceRun[] }[] }[];
    runs?: EvidenceRun[];
}
export interface EvidenceOptions {
    /** Keep runs and journeys started at or after this instant */
    from?: string;
    /** Keep runs and journeys started before this instant */
    to?: string;
    /** Keep only runs of these workflows, and the journeys that have one */
    workflow_ids?: string[];
}

export type Citation = { run_id: string; seq: number[] } | { journey_instance_id: string; seq: number[] };
export interface EvidenceStatement { kind: string; text: string; facts: Json; citations: Citation[] }
export type EvidencePartId = 'operation' | 'models' | 'oversight' | 'outcomes' | 'refusals' | 'failures' | 'compensations' | 'service_levels' | 'tools' | 'data' | 'retention' | 'guardrails';
export interface EvidencePart { id: EvidencePartId; title: string; question: string; serves: string[]; summary: Json; statements: EvidenceStatement[] }
export interface FrameworkReference { id: string; label: string; title: string }
export interface EvidenceFramework { id: string; name: string; references: FrameworkReference[] }
export interface EvidenceReport {
    spec_version: '1.1';
    report: 'evidence';
    as_of: string;
    period: { from: string | null; to: string | null };
    scope: { workflows: { workflow_id: string; name: string; versions: string[]; runs: number; child_runs: number }[]; journeys: { journey_id: string; name: string; instances: number }[] };
    notice: string;
    frameworks: EvidenceFramework[];
    parts: EvidencePart[];
}

export const EVIDENCE_NOTICE = 'This report is evidence computed from the execution journals and journey records listed in it. Every statement cites the records it rests on. '
    + 'It is not a certification, an audit opinion or a conformity assessment: it does not establish that any system, deployer or provider complies with the EU AI Act, the NIST AI RMF, ISO/IEC 42001 or any other framework. '
    + 'Whether these records meet an obligation depends on the system, its intended purpose, its risk classification and the applicable law, which this report does not assess.';

const ref = (id: string, label: string, title: string): FrameworkReference => ({ id, label, title });

/** The frameworks a part can serve, and the provisions it names. The mapping is informative (32.4). */
export const EVIDENCE_FRAMEWORKS: EvidenceFramework[] = [
    {
        id: 'eu-ai-act', name: 'Regulation (EU) 2024/1689 (AI Act)', references: [
            ref('eu-ai-act:12(1)', 'Art. 12(1)', 'Record-keeping: automatic recording of events over the lifetime of the system'),
            ref('eu-ai-act:12(2)', 'Art. 12(2)', 'Logging that enables identifying situations of risk, post-market monitoring and monitoring of operation'),
            ref('eu-ai-act:12(3)(d)', 'Art. 12(3)(d)', 'For the systems of Annex III point 1(a): logging that identifies the natural persons involved in verifying the results'),
            ref('eu-ai-act:13(3)(b)', 'Art. 13(3)(b)', 'Information to deployers on characteristics, capabilities and limitations of performance, including accuracy'),
            ref('eu-ai-act:13(3)(d)', 'Art. 13(3)(d)', 'Information to deployers on the human oversight measures'),
            ref('eu-ai-act:13(3)(f)', 'Art. 13(3)(f)', 'Information to deployers on how to collect, store and interpret the logs'),
            ref('eu-ai-act:14(4)', 'Art. 14(4)', 'Human oversight: monitoring, interpreting, disregarding, overriding or reversing outputs, and interrupting the system'),
            ref('eu-ai-act:14(5)', 'Art. 14(5)', 'For the systems of Annex III point 1(a): no action on a result unless separately verified and confirmed by at least two natural persons'),
            ref('eu-ai-act:15(1)', 'Art. 15(1)', 'An appropriate level of accuracy and robustness'),
            ref('eu-ai-act:15(3)', 'Art. 15(3)', 'Levels of accuracy and the relevant metrics'),
            ref('eu-ai-act:15(4)', 'Art. 15(4)', 'Resilience to errors, faults and inconsistencies; fail-safe plans'),
            ref('eu-ai-act:15(5)', 'Art. 15(5)', 'Cybersecurity: resilience against attempts by unauthorised third parties to alter use, outputs or performance, inputs designed to manipulate the model included'),
            ref('eu-ai-act:26(2)', 'Art. 26(2)', 'Deployers assign human oversight to persons with the competence and authority'),
            ref('eu-ai-act:26(5)', 'Art. 26(5)', 'Deployers monitor the operation of the system'),
            ref('eu-ai-act:26(6)', 'Art. 26(6)', 'Deployers keep the automatically generated logs under their control for an appropriate period of at least six months, unless other law provides otherwise'),
        ],
    },
    {
        id: 'nist-ai-rmf', name: 'NIST AI Risk Management Framework 1.0 (NIST AI 100-1)', references: [
            ref('nist-ai-rmf:GOVERN', 'GOVERN', 'Policies, accountability and human oversight'),
            ref('nist-ai-rmf:MAP', 'MAP', 'Context, and dependencies on third parties'),
            ref('nist-ai-rmf:MEASURE', 'MEASURE', 'Measuring and monitoring trustworthiness, in production included'),
            ref('nist-ai-rmf:MANAGE', 'MANAGE', 'Responding to and recovering from errors and incidents'),
        ],
    },
    {
        id: 'iso-iec-42001', name: 'ISO/IEC 42001:2023 (AI management system)', references: [
            ref('iso-iec-42001:9.1', 'Clause 9.1', 'Monitoring, measurement, analysis and evaluation'),
            ref('iso-iec-42001:A.3', 'Annex A.3', 'Internal organization: roles and responsibilities for AI'),
            ref('iso-iec-42001:A.6', 'Annex A.6', 'AI system life cycle, event logs included'),
            ref('iso-iec-42001:A.7', 'Annex A.7', 'Data for AI systems'),
            ref('iso-iec-42001:A.9', 'Annex A.9', 'Use of AI systems'),
            ref('iso-iec-42001:A.10', 'Annex A.10', 'Third-party and customer relationships'),
        ],
    },
];

/** Each part, the question it answers and what it can serve as evidence for */
export const EVIDENCE_PARTS: { id: EvidencePartId; title: string; question: string; serves: string[] }[] = [
    { id: 'operation', title: 'What ran', question: 'Which runs and journeys took place in the period, with which workflow versions, and how did each end?', serves: ['eu-ai-act:12(1)', 'eu-ai-act:12(2)', 'eu-ai-act:26(5)', 'nist-ai-rmf:MEASURE', 'iso-iec-42001:9.1', 'iso-iec-42001:A.6'] },
    { id: 'models', title: 'Models and what they decided', question: 'Which models, as named by their providers, served which activities and decisions, and where did a route fall back?', serves: ['eu-ai-act:12(2)', 'eu-ai-act:13(3)(b)', 'nist-ai-rmf:MAP', 'nist-ai-rmf:MEASURE', 'iso-iec-42001:A.6'] },
    { id: 'oversight', title: 'Human oversight', question: 'Who decided what, how many people approved, what was escalated to them, where did a person decide in place of an automated outcome, where were duties kept apart, and which runs were stopped?', serves: ['eu-ai-act:12(3)(d)', 'eu-ai-act:13(3)(d)', 'eu-ai-act:14(4)', 'eu-ai-act:14(5)', 'eu-ai-act:26(2)', 'nist-ai-rmf:GOVERN', 'nist-ai-rmf:MANAGE', 'iso-iec-42001:A.3', 'iso-iec-42001:A.9'] },
    { id: 'outcomes', title: 'Outcome contracts and verification', question: 'Which outcomes were checked against their contracts and verified, and with what result?', serves: ['eu-ai-act:13(3)(b)', 'eu-ai-act:15(1)', 'eu-ai-act:15(3)', 'nist-ai-rmf:MEASURE', 'iso-iec-42001:9.1'] },
    { id: 'refusals', title: 'Refusals', question: 'What did the engine refuse to do before it happened, to whom, and under which rule or guardrail?', serves: ['eu-ai-act:12(2)', 'eu-ai-act:15(4)', 'eu-ai-act:15(5)', 'nist-ai-rmf:GOVERN', 'nist-ai-rmf:MANAGE', 'iso-iec-42001:A.6'] },
    { id: 'failures', title: 'Failures', question: 'Which attempts, tool calls, runs and journeys failed or stalled, and why?', serves: ['eu-ai-act:12(2)', 'eu-ai-act:15(4)', 'eu-ai-act:26(5)', 'nist-ai-rmf:MANAGE', 'iso-iec-42001:A.6'] },
    { id: 'compensations', title: 'Compensations', question: 'Which completed work was undone after a failure, and did undoing it succeed?', serves: ['eu-ai-act:15(4)', 'nist-ai-rmf:MANAGE'] },
    { id: 'service_levels', title: 'Service levels', question: 'Where did work take longer than was promised?', serves: ['eu-ai-act:12(2)', 'eu-ai-act:26(5)', 'nist-ai-rmf:MEASURE', 'nist-ai-rmf:MANAGE'] },
    { id: 'tools', title: 'Tool calls by target', question: 'Which outside systems were called, how often, and with what result?', serves: ['eu-ai-act:12(2)', 'eu-ai-act:26(5)', 'nist-ai-rmf:MAP', 'iso-iec-42001:A.10'] },
    { id: 'data', title: 'Data handled', question: 'How were inputs, outputs, tool arguments and results journalled, and which shared contexts were read and written?', serves: ['eu-ai-act:12(1)', 'eu-ai-act:26(6)', 'nist-ai-rmf:GOVERN', 'iso-iec-42001:A.7'] },
    { id: 'retention', title: 'The records themselves', question: 'Which records does this report rest on, over what span, and are they complete?', serves: ['eu-ai-act:12(1)', 'eu-ai-act:13(3)(f)', 'eu-ai-act:26(6)', 'nist-ai-rmf:GOVERN', 'iso-iec-42001:A.6'] },
    // Last, so that every part before it keeps its place (32.1)
    { id: 'guardrails', title: 'Guardrails', question: 'What did the guardrails find in what reached and left the agents and tools, at which stage, and what did they do about it?', serves: ['eu-ai-act:12(2)', 'eu-ai-act:14(4)', 'eu-ai-act:15(4)', 'eu-ai-act:15(5)', 'nist-ai-rmf:MEASURE', 'nist-ai-rmf:MANAGE', 'iso-iec-42001:A.6', 'iso-iec-42001:A.7'] },
];

const ms = (iso?: string) => (iso ? new Date(iso).getTime() : NaN);
const short = (id: string) => (id.length > 8 ? id.slice(0, 8) : id);
const uniq = <T>(values: T[]) => [...new Set(values)];
const PAYLOAD_FIELDS: Record<string, string> = { 'run.started': 'input', 'activity.started': 'input', 'activity.completed': 'output', 'tool.invoked': 'arguments', 'tool.completed': 'result' };
const END_TYPES = new Set(['run.completed', 'run.failed', 'run.cancelled']);
/** Why a decision denied (30.3), in words */
const DENIED: Record<string, (rule: string | null) => string> = {
    no_rule: () => 'no rule allows it', rule: rule => `rule ${rule} denies it`, separation_of_duties: rule => `the separation of duties ${rule}`,
    four_eyes: rule => `the four-eyes rule ${rule}`, decider_error: () => 'the decider failed, and the engine failed closed',
};
const GUARDRAIL_ACTIONS = ['block', 'redact', 'retry_with_feedback', 'escalate', 'warn'];
const GUARDRAIL_STAGES = ['input', 'output', 'tool_call', 'tool_result'];

/** A principal as the journal names it: its id and kind only (30.6) */
function principal_of(value: unknown): { id: string; kind: string | null } | null {
    if (!value || typeof value !== 'object' || (value as Json).id === undefined || (value as Json).id === null) return null;
    return { id: String((value as Json).id), kind: (value as Json).kind ?? null };
}

/** Counts by key, the keys in sorted order */
function counted(keys: string[]): Record<string, number> {
    const counts: Record<string, number> = {};
    for (const k of [...keys].sort()) counts[k] = (counts[k] || 0) + 1;
    return counts;
}

/** Citations grouped by run or journey instance, each with its sequence numbers in order */
function cite(...refs: (EvidenceEvent & { journey_instance_id?: string } | undefined)[]): Citation[] {
    const runs = new Map<string, Set<number>>(), journeys = new Map<string, Set<number>>();
    for (const e of refs) {
        if (!e) continue;
        const [map, key] = e.journey_instance_id ? [journeys, e.journey_instance_id] : [runs, e.run_id || ''];
        if (!map.has(key)) map.set(key, new Set());
        map.get(key)!.add(e.seq);
    }
    const sorted = (s: Set<number>) => [...s].sort((a, b) => a - b);
    return [
        ...[...runs.entries()].map(([run_id, s]) => ({ run_id, seq: sorted(s) })),
        ...[...journeys.entries()].map(([journey_instance_id, s]) => ({ journey_instance_id, seq: sorted(s) })),
    ];
}

/** The kind of payload a journalled value is: the value itself, its hash, or nothing (9.4) */
function payload_kind(value: unknown): 'full' | 'hash' | 'none' {
    if (value === undefined) return 'none';
    if (value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length === 1 && typeof (value as Json).sha256 === 'string') return 'hash';
    return 'full';
}

interface KeptRun { run: EvidenceRun; events: EvidenceEvent[]; started: EvidenceEvent | undefined; ended: EvidenceEvent | undefined; start: number; name: string; version: string | null; journey_instance_id: string | null; depth: number; parent_run_id: string | null; root_run_id: string | null }

function by_code(codes: string[]) {
    const counts = new Map<string, number>();
    for (const code of codes) counts.set(code, (counts.get(code) || 0) + 1);
    return [...counts.entries()].map(([code, count]) => ({ code, count })).sort((a, b) => b.count - a.count || a.code.localeCompare(b.code));
}

const duration = (value: number) => value < 1000 ? `${Math.round(value)} ms` : value < 90_000 ? `${Math.round(value / 1000)} s` : value < 90 * 60_000 ? `${Math.round(value / 60_000)} min` : value < 48 * 3_600_000 ? `${(value / 3_600_000).toFixed(1)} h` : `${(value / 86_400_000).toFixed(1)} days`;

/** Compute the evidence report of section 32 from what was recorded */
export function compute_evidence(input: EvidenceInput, options: EvidenceOptions = {}): EvidenceReport {
    const from = options.from ? ms(options.from) : -Infinity, to = options.to ? ms(options.to) : Infinity;
    const within = (iso?: string) => { const t = ms(iso); return Number.isNaN(t) ? from === -Infinity && to === Infinity : t >= from && t < to; };
    const wanted = options.workflow_ids?.length ? new Set(options.workflow_ids) : undefined;
    const catalogue = new Map<string, { name: string; version?: string; actor_types: Map<string, string> }>();
    for (const w of input.workflows || []) catalogue.set(w.id, { name: w.name, version: w.version, actor_types: new Map((w.activities || []).map(a => [a.id, a.actor_type || ''])) });

    // Every run once, with the journey instance it belongs to
    const owner = new Map<string, string>();
    const all = new Map<string, EvidenceRun>();
    for (const j of input.journeys || []) for (const row of j.instances) for (const r of row.runs) { all.set(r.run_id, r); owner.set(r.run_id, row.instance.id); }
    for (const r of input.runs || []) if (!all.has(r.run_id)) all.set(r.run_id, r);

    // A child run (section 24) is kept with the run of depth 0 above it: the period is that run's,
    // and a child run is kept for its own workflow or for that run's (32.1)
    const first_of = (run: EvidenceRun) => run.events.find(e => e.type === 'run.started') || [...run.events].sort((a, b) => a.seq - b.seq)[0];
    const parent_of = (run: EvidenceRun): Json | undefined => {
        const parent = run.events.find(e => e.type === 'run.started')?.data?.parent;
        return parent && typeof parent === 'object' && parent.run_id ? parent : undefined;
    };
    const root_of = (run: EvidenceRun): EvidenceRun | undefined => {
        const parent = parent_of(run);
        return parent ? all.get(String(parent.root_run_id ?? parent.run_id)) : undefined;
    };
    const runs: KeptRun[] = [];
    for (const run of all.values()) {
        const root = root_of(run);
        if (wanted && !wanted.has(run.workflow_id) && !(root && wanted.has(root.workflow_id))) continue;
        if (!within(first_of(root || run)?.time)) continue;
        const events = [...run.events].map(e => ({ ...e, run_id: e.run_id || run.run_id })).sort((a, b) => a.seq - b.seq);
        const started = events.find(e => e.type === 'run.started');
        const parent = parent_of(run);
        runs.push({
            run, events, started, ended: [...events].reverse().find(e => END_TYPES.has(e.type)), start: ms((started || events[0])?.time),
            name: started?.data?.workflow_name || catalogue.get(run.workflow_id)?.name || run.workflow_id,
            version: started?.data?.workflow_version ?? catalogue.get(run.workflow_id)?.version ?? null,
            journey_instance_id: owner.get(run.run_id) ?? null,
            depth: parent ? Number(started?.data?.depth ?? 1) : Number(started?.data?.depth ?? 0),
            parent_run_id: parent ? String(parent.run_id) : null,
            root_run_id: parent ? String(parent.root_run_id ?? parent.run_id) : null,
        });
    }
    runs.sort((a, b) => (a.start - b.start) || a.run.run_id.localeCompare(b.run.run_id));
    const kept_runs = new Set(runs.map(r => r.run.run_id));

    const instances: { journey_id: string; name: string; instance: EvidenceInstance; events: (EvidenceEvent & { journey_instance_id: string })[] }[] = [];
    for (const j of input.journeys || []) for (const row of j.instances) {
        if (!within(row.instance.started_at)) continue;
        if (wanted && !row.runs.some(r => kept_runs.has(r.run_id))) continue;
        instances.push({ journey_id: j.definition.id, name: j.definition.name, instance: row.instance, events: (row.instance.events || []).map(e => ({ ...e, journey_instance_id: row.instance.id })).sort((a, b) => a.seq - b.seq) });
    }
    instances.sort((a, b) => (ms(a.instance.started_at) - ms(b.instance.started_at)) || a.instance.id.localeCompare(b.instance.id));

    const every = runs.flatMap(r => r.events.map(e => ({ e, r })));
    const of = (...types: string[]) => every.filter(x => types.includes(x.e.type));
    const node = (e: EvidenceEvent) => e.node_name || e.node_id || '';
    const actor_type = (r: KeptRun, e: EvidenceEvent) => e.data?.actor_type || catalogue.get(r.run.workflow_id)?.actor_types.get(e.node_id || '') || '';
    const statement = (kind: string, text: string, facts: Json, citations: Citation[]): EvidenceStatement => ({ kind, text, facts, citations });

    // --- What ran --------------------------------------------------------------
    const status_of = (r: KeptRun) => !r.ended ? 'in_progress' : r.ended.type === 'run.completed' ? 'completed' : r.ended.type === 'run.failed' ? 'failed' : 'cancelled';
    const operation: EvidenceStatement[] = runs.map(r => {
        const status = status_of(r);
        const started_at = (r.started || r.events[0])?.time ?? null;
        const principal = principal_of(r.started?.data?.principal);
        return statement('run',
            `Run ${short(r.run.run_id)} of "${r.name}"${r.version ? ` version ${r.version}` : ''}${r.parent_run_id ? `, a child run of run ${short(r.parent_run_id)} at depth ${r.depth},` : ''} started at ${started_at}${principal ? ` by ${principal.id}` : ''}${status === 'in_progress' ? ' and had not ended when recorded' : ` and ${status === 'completed' ? 'completed' : status === 'failed' ? 'failed' : 'was cancelled'} at ${r.ended!.time}`}.`,
            {
                run_id: r.run.run_id, workflow_id: r.run.workflow_id, workflow_name: r.name, workflow_version: r.version, status, started_at, ended_at: r.ended?.time ?? null, journey_instance_id: r.journey_instance_id,
                principal, depth: r.depth, parent_run_id: r.parent_run_id, root_run_id: r.root_run_id,
            },
            cite(r.started, r.ended));
    });
    for (const i of instances) {
        const start = i.events.find(e => e.type === 'journey.started');
        const end = [...i.events].reverse().find(e => e.type === 'journey.completed' || e.type === 'journey.abandoned');
        operation.push(statement('journey',
            `Journey "${i.name}" of subject ${i.instance.subject_key} started at ${i.instance.started_at} and ${i.instance.status === 'active' ? 'was in progress when recorded' : `was ${i.instance.status} at ${i.instance.ended_at ?? end?.time}`}.`,
            { journey_id: i.journey_id, journey_instance_id: i.instance.id, subject_key: i.instance.subject_key, status: i.instance.status, started_at: i.instance.started_at, ended_at: i.instance.ended_at ?? null },
            cite(start, end)));
    }
    // A run moved to another version of its workflow (spec 25.5): the migration is a statement of its own
    const migrations = every.filter(x => x.e.type === 'run.migrated');
    for (const { e } of migrations) {
        const tokens = (Array.isArray(e.data?.tokens) ? e.data!.tokens : []) as { outcome?: string }[];
        const facts = {
            run_id: e.run_id, from_version: e.data?.from_version ?? null, to_version: e.data?.to_version ?? null,
            tokens_kept: tokens.filter(t => t.outcome === 'kept').length, tokens_restarted: tokens.filter(t => t.outcome === 'restarted').length,
            data_changes: Array.isArray(e.data?.data_changes) ? e.data!.data_changes.length : 0,
            principal: principal_of(e.data?.principal),
        };
        operation.push(statement('migration',
            `Run ${short(e.run_id!)} was moved from version ${facts.from_version} to version ${facts.to_version} at ${e.time}${facts.principal ? ` by ${facts.principal.id}` : ''}: ${facts.tokens_kept} token(s) kept their wait, ${facts.tokens_restarted} started afresh, ${facts.data_changes} change(s) to data.`,
            facts, cite(e)));
    }
    // Who was allowed to do what, where the journal records it (30.6)
    const decisions = every.filter(x => x.e.type === 'authorization.decided');
    const decision_facts = (e: EvidenceEvent) => ({
        run_id: e.run_id, node_name: node(e) || null, action: e.data?.action ?? null, principal: principal_of(e.data?.principal),
        resource: e.data?.resource && typeof e.data.resource === 'object' ? e.data.resource : null, rule: e.data?.rule ?? null, reason: e.data?.reason ?? null,
    });
    const allowed = decisions.filter(x => x.e.data?.decision === 'allow');
    for (const { e } of allowed) {
        const f = decision_facts(e);
        const approval = e.data?.approval && typeof e.data.approval === 'object' ? { given: e.data.approval.given ?? null, required: e.data.approval.required ?? null } : null;
        operation.push(statement('authorization_allowed',
            `${f.principal?.id ?? 'An unnamed principal'} was allowed the action ${f.action}${f.node_name ? ` at "${f.node_name}"` : ''} in run ${short(e.run_id!)}${f.rule ? ` by rule ${f.rule}` : ''}${approval ? ` (approval ${approval.given} of ${approval.required})` : ''}.`,
            { run_id: f.run_id, node_name: f.node_name, action: f.action, principal: f.principal, resource: f.resource, rule: f.rule, approval }, cite(e)));
    }
    const workflows_scope = uniq(runs.map(r => r.run.workflow_id)).map(id => {
        const mine = runs.filter(r => r.run.workflow_id === id);
        const moved_to = migrations.filter(x => x.r.run.workflow_id === id).map(x => x.e.data?.to_version as string | undefined);
        return { workflow_id: id, name: mine[0].name, versions: uniq([...mine.map(r => r.version), ...moved_to].filter((v): v is string => !!v)).sort(), runs: mine.length, child_runs: mine.filter(r => r.parent_run_id).length };
    });
    const count_status = (s: string) => runs.filter(r => status_of(r) === s).length;
    const child_runs = runs.filter(r => r.parent_run_id).length;
    const kinds = (statements: EvidenceStatement[], kind: string) => statements.filter(s => s.kind === kind).length;

    // --- Models ----------------------------------------------------------------
    const selections = of('meta.recorded').filter(x => x.e.data?.subject === 'model_selection' && x.e.data?.model);
    const models = new Map<string, { facts: Json; events: EvidenceEvent[] }>();
    for (const { e } of selections) {
        const m = e.data!.model;
        const key = `${m.provider ?? ''}|${m.id}|${e.node_id || ''}`;
        if (!models.has(key)) models.set(key, { facts: { provider: m.provider ?? null, model: m.id, requested: m.requested ?? null, tier: m.tier ?? null, node_id: e.node_id ?? null, node_name: node(e) }, events: [] });
        models.get(key)!.events.push(e);
    }
    const model_statements: EvidenceStatement[] = [...models.values()]
        .sort((a, b) => `${a.facts.provider}:${a.facts.model}:${a.facts.node_name}`.localeCompare(`${b.facts.provider}:${b.facts.model}:${b.facts.node_name}`))
        .map(({ facts, events }) => statement('model',
            `${facts.provider ? `${facts.provider}:` : ''}${facts.model} served "${facts.node_name}" ${events.length} time${events.length === 1 ? '' : 's'}${facts.requested ? `, requested as ${facts.requested}` : ''}.`,
            { ...facts, uses: events.length }, cite(...events)));
    for (const { e } of of('meta.recorded').filter(x => x.e.data?.subject === 'model_route')) {
        model_statements.push(statement('route', `At "${node(e)}" in run ${short(e.run_id!)}: ${e.data?.decision}. ${e.data?.rationale || ''}`.trim(), { run_id: e.run_id, node_name: node(e), decision: e.data?.decision ?? null }, cite(e)));
    }
    for (const { e } of of('decision.evaluated').filter(x => x.e.data?.method === 'model')) {
        const option = e.data?.model?.option ?? null, confidence = e.data?.model?.confidence ?? null;
        model_statements.push(statement('model_decision', `A model decided "${node(e)}" in run ${short(e.run_id!)}: option ${option}${confidence !== null ? ` with a stated confidence of ${confidence}` : ''}.`, { run_id: e.run_id, node_name: node(e), option, confidence }, cite(e)));
    }

    // --- What guardrails found (31.7): never what they matched, which the record does not hold --
    const triggered = of('guardrail.triggered');
    const guardrail_facts = (e: EvidenceEvent) => {
        const findings = (Array.isArray(e.data?.findings) ? e.data!.findings : []) as Json[];
        const by_category = counted(findings.map(f => String(f?.category ?? 'unknown')));
        const categories = Array.isArray(e.data?.categories) ? (e.data!.categories as unknown[]).map(String).sort() : Object.keys(by_category);
        return {
            run_id: e.run_id, node_name: node(e) || null, attempt: e.attempt ?? null, guardrail_id: e.data?.guardrail_id ?? null, name: e.data?.name ?? null,
            source: e.data?.source ?? null, stage: e.data?.stage ?? null, check: e.data?.check ?? null, action: e.data?.action ?? null,
            categories, findings: findings.length, by_category, tool: e.data?.tool ?? null, failed_closed: e.data?.error !== undefined && e.data?.error !== null,
        };
    };
    const ACTED: Record<string, string> = { block: 'blocked it', redact: 'redacted what it found', retry_with_feedback: 'had the agent try again with feedback', escalate: 'handed the activity to a person', warn: 'recorded a warning' };
    const guardrail_text = (e: EvidenceEvent) => {
        const f = guardrail_facts(e);
        const where = `${f.stage === 'tool_call' || f.stage === 'tool_result' ? `${f.stage === 'tool_call' ? 'a call to' : 'the result of'} ${f.tool ?? 'a tool'} by ` : `the ${f.stage} of `}"${f.node_name}"${f.attempt ? ` at attempt ${f.attempt}` : ''} in run ${short(e.run_id!)}`;
        return f.failed_closed
            ? `Guardrail "${f.name ?? f.guardrail_id}" (${f.check}) could not carry out its check on ${where}, and blocked it.`
            : `Guardrail "${f.name ?? f.guardrail_id}" (${f.check}) found ${f.categories.join(', ') || 'something'} (${f.findings} finding${f.findings === 1 ? '' : 's'}) in ${where}, and ${ACTED[String(f.action)] ?? `acted: ${f.action}`}.`;
    };
    const guardrail_statements = triggered.map(({ e }) => statement('guardrail', guardrail_text(e), guardrail_facts(e), cite(e)));

    // --- Human oversight -------------------------------------------------------
    const oversight: EvidenceStatement[] = [];
    let overrides = 0;
    for (const r of runs) {
        for (const done of r.events.filter(e => e.type === 'activity.completed')) {
            const same = (e: EvidenceEvent) => e.node_id === done.node_id && e.token_id === done.token_id && e.seq < done.seq;
            const last_start = [...r.events].reverse().find(e => e.type === 'activity.started' && same(e));
            const visit = r.events.filter(e => same(e) && (!last_start || e.seq > last_start.seq));
            const escalated = visit.find(e => e.type === 'contract.escalated');
            const guarded = visit.find(e => e.type === 'guardrail.triggered' && e.data?.action === 'escalate');
            if (!escalated && !guarded && actor_type(r, done) !== 'human') continue;
            // An override: a person decided in place of an outcome that was rejected
            if (escalated || guarded?.data?.stage === 'output') overrides++;
            const related = visit.filter(e => e.type === 'token.waiting' || e.type === 'token.resumed' || e.type === 'contract.escalated' || (e.type === 'contract.checked' && e.data?.decided_by === 'human')
                || (e.type === 'guardrail.triggered' && e.data?.action === 'escalate')
                || (e.type === 'authorization.decided' && e.data?.decision === 'allow' && (e.data?.action === 'complete_task' || e.data?.action === 'approve')));
            const resumed = related.find(e => e.type === 'token.resumed');
            const principal = principal_of(done.data?.principal) ?? principal_of(resumed?.data?.principal);
            const approvals = (Array.isArray(done.data?.approvals) ? done.data!.approvals : []).map(principal_of).filter((p: unknown): p is { id: string; kind: string | null } => !!p);
            const approvers = uniq(approvals.map(p => p.id)).length;
            const last_approval = [...related].reverse().find(e => e.type === 'authorization.decided' && e.data?.approval && typeof e.data.approval === 'object');
            const approvals_required = last_approval?.data?.approval?.required ?? null;
            const escalated_by = escalated ? 'contract' : guarded ? 'guardrail' : null;
            oversight.push(statement('human_decision',
                `A person decided "${node(done)}" in run ${short(r.run.run_id)} at ${done.time}${principal ? ` (${principal.id})` : ''}${escalated ? ', in place of an outcome that was rejected and escalated to them' : guarded ? `, escalated to them by a guardrail at stage ${guarded.data?.stage}` : ''}${approvals.length ? `, approved by ${uniq(approvals.map(p => p.id)).join(' and ')} (${approvers} distinct approver${approvers === 1 ? '' : 's'}${approvals_required !== null ? ` of ${approvals_required} required` : ''})` : ''}${resumed?.data?.waited_ms !== undefined ? `, after a wait of ${duration(Number(resumed.data.waited_ms))}` : ''}.`,
                { run_id: r.run.run_id, node_name: node(done), escalated: escalated_by !== null, escalated_by, decided_at: done.time, principal, approvals, approvers, approvals_required }, cite(...related, done)));
        }
    }
    for (const { e } of of('contract.escalated')) oversight.push(statement('escalation', `"${node(e)}" in run ${short(e.run_id!)} was escalated to a person (${e.data?.code}): ${e.data?.message}`, { run_id: e.run_id, node_name: node(e), code: e.data?.code ?? null }, cite(e)));
    for (const { e } of triggered.filter(x => x.e.data?.action === 'escalate')) oversight.push(statement('guardrail_escalation', guardrail_text(e), guardrail_facts(e), cite(e)));
    const separations = decisions.filter(x => x.e.data?.decision === 'deny' && (x.e.data?.reason === 'separation_of_duties' || x.e.data?.reason === 'four_eyes'));
    for (const { e } of separations) {
        const f = decision_facts(e);
        oversight.push(statement('separation_of_duties',
            `${f.principal?.id ?? 'An unnamed principal'} was refused the action ${f.action}${f.node_name ? ` at "${f.node_name}"` : ''} in run ${short(e.run_id!)}: ${f.reason === 'four_eyes' ? `under the four-eyes rule ${f.rule}, each approval must come from another person` : `the separation of duties ${f.rule} keeps this apart from what they did in the run`}.`,
            { run_id: f.run_id, node_name: f.node_name, action: f.action, principal: f.principal, rule: f.rule, reason: f.reason }, cite(e)));
    }
    for (const { e } of of('run.cancelled')) oversight.push(statement('cancellation', `Run ${short(e.run_id!)} was stopped: ${e.data?.reason || 'no reason recorded'}.`, { run_id: e.run_id, reason: e.data?.reason ?? null }, cite(e)));

    // --- Outcome contracts and verification ------------------------------------
    const contracts = of('contract.checked'), verifications = of('verification.completed');
    const term = (v: unknown) => typeof v === 'string' ? v : String((v as Json)?.name ?? (v as Json)?.path ?? (v as Json)?.message ?? '');
    const outcomes: EvidenceStatement[] = [
        ...contracts.map(({ e }) => {
            const violations = (e.data?.violations || []).map(term);
            const decided_by = e.data?.decided_by || 'engine';
            return statement('contract',
                `The outcome contract of "${node(e)}" ${e.data?.passed ? 'held' : `was violated (${violations.join('; ')})`} at attempt ${e.attempt ?? '?'} of run ${short(e.run_id!)}${decided_by === 'human' ? '; the outcome was a person\'s' : ''}.`,
                { run_id: e.run_id, node_name: node(e), attempt: e.attempt ?? null, passed: e.data?.passed === true, violations, decided_by }, cite(e));
        }),
        ...verifications.map(({ e }) => statement('verification',
            `Verification (${e.data?.mode}) of "${node(e)}" at attempt ${e.attempt ?? '?'} of run ${short(e.run_id!)}: ${e.data?.verdict}${typeof e.data?.score === 'number' ? `, score ${e.data.score}` : ''}.`,
            { run_id: e.run_id, node_name: node(e), attempt: e.attempt ?? null, mode: e.data?.mode ?? null, verdict: e.data?.verdict ?? null, score: typeof e.data?.score === 'number' ? e.data.score : null }, cite(e))),
    ];
    const per_activity = new Map<string, { node_name: string; contracts: number; contracts_passed: number; verifications: number; verifications_passed: number }>();
    const tally = (e: EvidenceEvent) => { const k = node(e); if (!per_activity.has(k)) per_activity.set(k, { node_name: k, contracts: 0, contracts_passed: 0, verifications: 0, verifications_passed: 0 }); return per_activity.get(k)!; };
    for (const { e } of contracts) { const t = tally(e); t.contracts++; if (e.data?.passed === true) t.contracts_passed++; }
    for (const { e } of verifications) { const t = tally(e); t.verifications++; if (e.data?.verdict === 'pass') t.verifications_passed++; }

    // --- Refusals and failures -------------------------------------------------
    const refused = of('tool.failed').filter(x => x.e.data?.invoked === false);
    const refusals: EvidenceStatement[] = [
        ...refused.map(({ e }) => statement('tool_refused', `A call to ${e.data?.tool} at "${node(e)}" in run ${short(e.run_id!)} was refused before it ran (${e.data?.error?.code}): ${e.data?.error?.message}`,
            { run_id: e.run_id, node_name: node(e), tool: e.data?.tool ?? null, link: e.data?.link ?? null, code: e.data?.error?.code ?? null }, cite(e))),
        ...of('context.denied').map(({ e }) => statement('context_denied', `A write to the context "${e.data?.context_name}" by "${node(e)}" in run ${short(e.run_id!)} was refused: ${e.data?.reason}.`,
            { run_id: e.run_id, node_name: node(e), context_name: e.data?.context_name ?? null, reason: e.data?.reason ?? null }, cite(e))),
        ...decisions.filter(x => x.e.data?.decision === 'deny').map(({ e }) => {
            const f = decision_facts(e);
            return statement('authorization_denied',
                `${f.principal?.id ?? 'An unnamed principal'}${f.principal?.kind ? ` (${f.principal.kind})` : ''} was refused the action ${f.action}${f.node_name ? ` at "${f.node_name}"` : ''} in run ${short(e.run_id!)}: ${DENIED[String(f.reason)]?.(f.rule) ?? `${f.reason}`}.`,
                f, cite(e));
        }),
        ...triggered.filter(x => x.e.data?.action === 'block').map(({ e }) => statement('guardrail_blocked', guardrail_text(e), guardrail_facts(e), cite(e))),
    ];
    const failed_tools = of('tool.failed').filter(x => x.e.data?.invoked !== false);
    const stalls = instances.flatMap(i => i.events.filter(e => e.type === 'journey.stalled').map(e => ({ e, i })));
    const failures: EvidenceStatement[] = [
        ...of('activity.failed').map(({ e }) => statement('attempt_failed', `Attempt ${e.attempt ?? '?'} of "${node(e)}" in run ${short(e.run_id!)} failed (${e.data?.error?.code || 'no code'}): ${e.data?.error?.message || ''}`.trim(),
            { run_id: e.run_id, node_name: node(e), attempt: e.attempt ?? null, code: e.data?.error?.code ?? null }, cite(e))),
        ...of('activity.dead_lettered').map(({ e }) => statement('dead_letter', `"${node(e)}" in run ${short(e.run_id!)} was dead-lettered after ${e.data?.attempts ?? '?'} attempts.`,
            { run_id: e.run_id, node_name: node(e), attempts: e.data?.attempts ?? null }, cite(e))),
        ...failed_tools.map(({ e }) => statement('tool_failed', `A call to ${e.data?.tool} at "${node(e)}" in run ${short(e.run_id!)} failed (${e.data?.error?.code || 'no code'}).`,
            { run_id: e.run_id, node_name: node(e), tool: e.data?.tool ?? null, link: e.data?.link ?? null, code: e.data?.error?.code ?? null }, cite(e))),
        ...of('run.failed').map(({ e }) => statement('run_failed', `Run ${short(e.run_id!)} failed.`, { run_id: e.run_id }, cite(e))),
        ...stalls.map(({ e, i }) => statement('journey_stalled', `The journey "${i.name}" of subject ${i.instance.subject_key} stalled in stage ${e.stage_id}${e.data?.reason ? `: ${e.data.reason}` : ''}.`,
            { journey_instance_id: i.instance.id, stage_id: e.stage_id ?? null, run_id: e.run_id ?? null }, cite(e))),
    ];

    // --- Compensations and service levels -------------------------------------
    const compensations = of('activity.compensated', 'activity.compensation_failed').map(({ e }) => {
        const succeeded = e.type === 'activity.compensated';
        const compensates = e.data?.compensates_activity_name || e.data?.compensates_activity_id || null;
        return statement('compensation', `"${compensates}" in run ${short(e.run_id!)} ${succeeded ? 'was undone' : 'could not be undone'} by "${node(e)}".`,
            { run_id: e.run_id, node_name: node(e), compensates, succeeded }, cite(e));
    });
    const service_levels = of('sla.warning', 'sla.breached').map(({ e }) => {
        const level = e.type === 'sla.breached' ? 'breach' : 'warning';
        const limit = level === 'breach' ? e.data?.max_time : e.data?.threshold;
        return statement('sla', `${e.data?.scope === 'workflow' ? `Run ${short(e.run_id!)}` : `"${node(e)}" in run ${short(e.run_id!)}`} ${level === 'breach' ? 'breached its service level' : 'passed its point of warning'} after ${duration(Number(e.data?.elapsed_ms) || 0)} (limit ${limit}).`,
            { run_id: e.run_id, node_name: e.node_id ? node(e) : null, level, scope: e.data?.scope ?? null, elapsed_ms: e.data?.elapsed_ms ?? null, limit: limit ?? null, action: e.data?.action ?? null }, cite(e));
    });

    // --- Tool calls by target --------------------------------------------------
    const targets = new Map<string, { link: string; tools: Set<string>; calls: number; completed: number; failed: number; refused: number; events: EvidenceEvent[] }>();
    for (const r of runs) {
        const links = new Map<string, string>();
        for (const e of r.events) {
            if (e.type !== 'tool.invoked' && e.type !== 'tool.completed' && e.type !== 'tool.failed') continue;
            const link = e.data?.link || links.get(e.data?.call_id) || `tool:${e.data?.tool}`;
            if (e.data?.call_id) links.set(e.data.call_id, link);
            if (!targets.has(link)) targets.set(link, { link, tools: new Set(), calls: 0, completed: 0, failed: 0, refused: 0, events: [] });
            const t = targets.get(link)!;
            if (e.data?.tool) t.tools.add(e.data.tool);
            t.events.push(e);
            if (e.type === 'tool.invoked') t.calls++;
            else if (e.type === 'tool.completed') t.completed++;
            else if (e.data?.invoked === false) t.refused++;
            else t.failed++;
        }
    }
    const tool_statements = [...targets.values()].sort((a, b) => a.link.localeCompare(b.link)).map(t => statement('target',
        `${t.link}: ${t.calls} call${t.calls === 1 ? '' : 's'} by ${[...t.tools].sort().join(', ')}; ${t.completed} completed, ${t.failed} failed, ${t.refused} refused.`,
        { link: t.link, tools: [...t.tools].sort(), calls: t.calls, completed: t.completed, failed: t.failed, refused: t.refused }, cite(...t.events)));

    // --- Data handled ----------------------------------------------------------
    const payloads = { full: 0, hash: 0, none: 0 };
    const runs_by_mode = { full: 0, hash: 0, none: 0, mixed: 0 };
    const data: EvidenceStatement[] = [];
    for (const r of runs) {
        const counts = { full: 0, hash: 0, none: 0 };
        const carriers = r.events.filter(e => PAYLOAD_FIELDS[e.type]);
        for (const e of carriers) counts[payload_kind(e.data?.[PAYLOAD_FIELDS[e.type]])]++;
        if (!carriers.length) continue;
        const modes = (['full', 'hash', 'none'] as const).filter(m => counts[m] > 0);
        const mode = modes.length === 1 ? modes[0] : 'mixed';
        runs_by_mode[mode]++;
        for (const m of ['full', 'hash', 'none'] as const) payloads[m] += counts[m];
        data.push(statement('run_payloads',
            mode === 'mixed' ? `Run ${short(r.run.run_id)} journalled ${counts.full} payload(s) in full, ${counts.hash} as a hash and ${counts.none} not at all.`
                : `Run ${short(r.run.run_id)} journalled its ${carriers.length} payload(s) ${mode === 'full' ? 'in full' : mode === 'hash' ? 'as SHA-256 hashes only' : 'not at all'}.`,
            { run_id: r.run.run_id, mode, ...counts }, cite(...carriers)));
    }
    const contexts = new Map<string, { reads: number; writes: number; denied: number; events: EvidenceEvent[] }>();
    const context = (name: string) => { if (!contexts.has(name)) contexts.set(name, { reads: 0, writes: 0, denied: 0, events: [] }); return contexts.get(name)!; };
    for (const { e } of of('context.read', 'context.written', 'context.denied')) {
        if (e.type === 'context.read') { for (const c of e.data?.contexts || []) { const x = context(String(c.context_name)); x.reads++; x.events.push(e); } }
        else { const x = context(String(e.data?.context_name ?? '(not named)')); if (e.type === 'context.written') x.writes++; else x.denied++; x.events.push(e); }
    }
    for (const [name, c] of [...contexts.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
        data.push(statement('context', `The context "${name}" was given to activities ${c.reads} time(s), written ${c.writes} time(s) and refused ${c.denied} write(s); the journal holds hashes of its values, not the values.`,
            { context_name: name, reads: c.reads, writes: c.writes, denied: c.denied }, cite(...c.events)));
    }

    // --- The records themselves ------------------------------------------------
    const records = [...runs.flatMap(r => r.events), ...instances.flatMap(i => i.events)].filter(e => Number.isFinite(ms(e.time)));
    // The oldest and the newest records, every one of them where several share the instant
    const first_time = Math.min(...records.map(e => ms(e.time))), last_time = Math.max(...records.map(e => ms(e.time)));
    const oldest = records.find(e => ms(e.time) === first_time), newest = records.find(e => ms(e.time) === last_time);
    const at_the_ends = records.filter(e => ms(e.time) === first_time || ms(e.time) === last_time);
    const as_of = input.as_of || new Date().toISOString();
    const journey_events = instances.reduce((a, i) => a + i.events.length, 0);
    const event_count = runs.reduce((a, r) => a + r.events.length, 0);
    const retention: EvidenceStatement[] = [];
    if (oldest && newest) {
        retention.push(statement('held',
            `The report rests on ${event_count} journal record(s) of ${runs.length} run(s)${child_runs ? `, ${child_runs} of them child runs,` : ''} and ${journey_events} record(s) of ${instances.length} journey(s), from ${oldest.time} to ${newest.time}.`,
            { runs: runs.length, child_runs, events: event_count, journey_instances: instances.length, journey_events, oldest_record: oldest.time, newest_record: newest.time }, cite(...at_the_ends)));
    }
    let runs_with_gaps = 0;
    for (const r of runs) {
        const present = new Set(r.events.map(e => e.seq));
        const last = Math.max(0, ...present);
        const missing: number[] = [];
        for (let s = 1; s <= last; s++) if (!present.has(s)) missing.push(s);
        if (!missing.length && r.started) continue;
        runs_with_gaps++;
        const around = missing.flatMap(s => [r.events.filter(e => e.seq < s).pop(), r.events.find(e => e.seq > s)]);
        retention.push(statement('gap',
            `The journal of run ${short(r.run.run_id)} is incomplete: ${missing.length ? `record(s) ${missing.join(', ')} are missing` : ''}${missing.length && !r.started ? ' and ' : ''}${!r.started ? 'it has no run.started' : ''}.`,
            { run_id: r.run.run_id, missing, starts: !!r.started }, cite(...(around.some(Boolean) ? around : [r.events[0]]))));
    }

    const times = [...runs.map(r => r.start), ...instances.map(i => ms(i.instance.started_at))].filter(t => Number.isFinite(t));
    const part = (id: EvidencePartId, summary: Json, statements: EvidenceStatement[]): EvidencePart => {
        const p = EVIDENCE_PARTS.find(x => x.id === id)!;
        return { id, title: p.title, question: p.question, serves: p.serves, summary, statements };
    };
    return {
        spec_version: '1.1', report: 'evidence', as_of,
        period: { from: options.from || (times.length ? new Date(Math.min(...times)).toISOString() : null), to: options.to || (times.length ? new Date(Math.max(...times)).toISOString() : null) },
        scope: {
            workflows: workflows_scope,
            journeys: uniq(instances.map(i => i.journey_id)).map(id => ({ journey_id: id, name: instances.find(i => i.journey_id === id)!.name, instances: instances.filter(i => i.journey_id === id).length })),
        },
        notice: EVIDENCE_NOTICE,
        frameworks: EVIDENCE_FRAMEWORKS,
        parts: [
            part('operation', { runs: runs.length, completed: count_status('completed'), failed: count_status('failed'), cancelled: count_status('cancelled'), in_progress: count_status('in_progress'), child_runs: child_runs, journeys: instances.length, migrations: migrations.length, authorizations_allowed: allowed.length, workflows: workflows_scope }, operation),
            part('models', { models: uniq([...models.values()].map(m => `${m.facts.provider ? `${m.facts.provider}:` : ''}${m.facts.model}`)).sort(), selections: selections.length, routes: model_statements.filter(s => s.kind === 'route').length, model_decisions: model_statements.filter(s => s.kind === 'model_decision').length }, model_statements),
            part('oversight', {
                human_decisions: kinds(oversight, 'human_decision'), overrides, escalations: kinds(oversight, 'escalation'), guardrail_escalations: kinds(oversight, 'guardrail_escalation'),
                four_eyes: oversight.filter(s => s.kind === 'human_decision' && s.facts.approvals.length > 0).length, separation_of_duties: kinds(oversight, 'separation_of_duties'), cancellations: kinds(oversight, 'cancellation'),
            }, oversight),
            part('outcomes', { contracts: contracts.length, contracts_passed: contracts.filter(x => x.e.data?.passed === true).length, verifications: verifications.length, verifications_passed: verifications.filter(x => x.e.data?.verdict === 'pass').length, activities: [...per_activity.values()] }, outcomes),
            part('refusals', {
                refusals: refusals.length, tool_calls: refused.length, context_writes: kinds(refusals, 'context_denied'), authorization: kinds(refusals, 'authorization_denied'), guardrails: kinds(refusals, 'guardrail_blocked'),
                by_code: by_code(refused.map(x => String(x.e.data?.error?.code ?? 'UNKNOWN'))), authorization_by_reason: counted(refusals.filter(s => s.kind === 'authorization_denied').map(s => String(s.facts.reason ?? 'unknown'))),
            }, refusals),
            part('failures', { attempts_failed: failures.filter(s => s.kind === 'attempt_failed').length, dead_letters: failures.filter(s => s.kind === 'dead_letter').length, tool_failures: failed_tools.length, runs_failed: failures.filter(s => s.kind === 'run_failed').length, journeys_stalled: stalls.length, by_code: by_code(failures.filter(s => s.kind === 'attempt_failed').map(s => String(s.facts.code ?? 'UNKNOWN'))) }, failures),
            part('compensations', { compensations: compensations.length, failed: compensations.filter(s => !s.facts.succeeded).length }, compensations),
            part('service_levels', { warnings: service_levels.filter(s => s.facts.level === 'warning').length, breaches: service_levels.filter(s => s.facts.level === 'breach').length }, service_levels),
            part('tools', { targets: targets.size, calls: tool_statements.reduce((a, s) => a + s.facts.calls, 0), completed: tool_statements.reduce((a, s) => a + s.facts.completed, 0), failed: tool_statements.reduce((a, s) => a + s.facts.failed, 0), refused: tool_statements.reduce((a, s) => a + s.facts.refused, 0) }, tool_statements),
            part('data', { runs_by_mode, payloads }, data),
            part('retention', { runs: runs.length, child_runs, events: event_count, journey_instances: instances.length, journey_events, oldest_record: oldest?.time ?? null, newest_record: newest?.time ?? null, held_for_ms: oldest ? Math.max(0, ms(as_of) - ms(oldest.time)) : null, runs_with_gaps }, retention),
            part('guardrails', {
                triggered: triggered.length, guardrails: uniq(triggered.map(x => String(x.e.data?.guardrail_id ?? ''))).length,
                by_action: Object.fromEntries(GUARDRAIL_ACTIONS.map(a => [a, triggered.filter(x => x.e.data?.action === a).length])),
                by_stage: Object.fromEntries(GUARDRAIL_STAGES.map(st => [st, triggered.filter(x => x.e.data?.stage === st).length])),
                by_check: counted(triggered.map(x => String(x.e.data?.check ?? 'unknown'))),
                by_category: counted(guardrail_statements.flatMap(s => Object.entries(s.facts.by_category as Record<string, number>).flatMap(([c, n]) => Array(n).fill(c)))),
                failed_closed: guardrail_statements.filter(s => s.facts.failed_closed).length,
            }, guardrail_statements),
        ],
    };
}

/** Every citation of a report that does not point at a record of the input: an empty list for a sound report */
export function unresolved_citations(report: EvidenceReport, input: EvidenceInput): string[] {
    const runs = new Map<string, Set<number>>(), journeys = new Map<string, Set<number>>();
    for (const j of input.journeys || []) for (const row of j.instances) {
        journeys.set(row.instance.id, new Set((row.instance.events || []).map(e => e.seq)));
        for (const r of row.runs) runs.set(r.run_id, new Set(r.events.map(e => e.seq)));
    }
    for (const r of input.runs || []) if (!runs.has(r.run_id)) runs.set(r.run_id, new Set(r.events.map(e => e.seq)));
    const missing: string[] = [];
    for (const p of report.parts) for (const s of p.statements) for (const c of s.citations) {
        const [key, seqs] = 'run_id' in c ? [`run ${c.run_id}`, runs.get(c.run_id)] : [`journey ${c.journey_instance_id}`, journeys.get(c.journey_instance_id)];
        if (!c.seq.length) missing.push(`${p.id}/${s.kind}: ${key} with no sequence number`);
        for (const seq of c.seq) if (!seqs?.has(seq)) missing.push(`${p.id}/${s.kind}: ${key} #${seq}`);
    }
    return missing;
}

const label_of = (id: string) => EVIDENCE_FRAMEWORKS.flatMap(f => f.references.map(r => ({ f, r }))).find(x => x.r.id === id);
function serves_text(ids: string[]): string {
    return EVIDENCE_FRAMEWORKS.map(f => {
        const mine = ids.map(label_of).filter(x => x && x.f.id === f.id).map(x => x!.r.label);
        return mine.length ? `${f.id === 'eu-ai-act' ? 'EU AI Act' : f.id === 'nist-ai-rmf' ? 'NIST AI RMF' : 'ISO/IEC 42001'} ${mine.join(', ')}` : '';
    }).filter(Boolean).join('; ');
}
function citation_text(citations: Citation[]): string {
    return citations.map(c => 'run_id' in c ? `run ${short(c.run_id)} #${c.seq.join(', #')}` : `journey ${short(c.journey_instance_id)} #${c.seq.join(', #')}`).join('; ');
}
function summary_lines(summary: Json): string[] {
    return Object.entries(summary).filter(([, v]) => v === null || typeof v !== 'object' || Array.isArray(v) && v.every(x => typeof x !== 'object'))
        .map(([k, v]) => `${k.replace(/_/g, ' ')}: ${Array.isArray(v) ? (v.length ? v.join(', ') : 'none') : v === null ? 'none' : v}`)
        .concat(Object.entries(summary).filter(([, v]) => v && typeof v === 'object' && !Array.isArray(v)).map(([k, v]) => `${k.replace(/_/g, ' ')}: ${Object.entries(v as Json).map(([a, b]) => `${a} ${b}`).join(', ')}`));
}

/** The report as Markdown, for a person to read */
export function render_evidence_markdown(report: EvidenceReport): string {
    const out: string[] = [];
    const escape = (text: string) => String(text).replace(/\|/g, '\\|').replace(/\n/g, ' ');
    out.push('# Evidence report', '');
    out.push(`As of ${report.as_of}. Period: ${report.period.from ?? 'the beginning of the records'} to ${report.period.to ?? 'the end of the records'}.`, '');
    out.push(`> ${report.notice}`, '');
    out.push('## Scope', '');
    if (report.scope.workflows.length) {
        out.push('| Workflow | Versions | Runs | Of which child runs |', '|---|---|---|---|');
        for (const w of report.scope.workflows) out.push(`| ${escape(w.name)} | ${w.versions.join(', ') || 'not recorded'} | ${w.runs} | ${w.child_runs ?? 0} |`);
        out.push('');
    } else out.push('No run falls within the period.', '');
    for (const j of report.scope.journeys) out.push(`- Journey "${j.name}": ${j.instances} instance(s)`);
    if (report.scope.journeys.length) out.push('');
    out.push('Each statement cites the journal records it rests on: "run 1a2b3c4d #5" is the record with sequence number 5 in the journal of the run whose id begins 1a2b3c4d.', '');
    report.parts.forEach((p, n) => {
        out.push(`## ${n + 1}. ${p.title}`, '', `*${p.question}*`, '', `Can serve as evidence for: ${serves_text(p.serves)}.`, '');
        for (const line of summary_lines(p.summary)) out.push(`- ${line}`);
        out.push('');
        if (!p.statements.length) { out.push('Nothing recorded.', ''); return; }
        out.push('| Statement | Records |', '|---|---|');
        for (const s of p.statements) out.push(`| ${escape(s.text)} | ${citation_text(s.citations)} |`);
        out.push('');
    });
    out.push('## The frameworks named', '');
    for (const f of report.frameworks) {
        out.push(`**${f.name}**`, '');
        for (const r of f.references) out.push(`- ${r.label}: ${r.title}`);
        out.push('');
    }
    out.push('The mapping from parts to provisions says which obligations a record is relevant to. It does not say that an obligation is met.', '');
    return out.join('\n');
}

/** The report as one self-contained HTML page */
export function render_evidence_html(report: EvidenceReport): string {
    const h = (text: unknown) => String(text ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    const parts = report.parts.map((p, n) => `
<section id="${h(p.id)}">
  <h2>${n + 1}. ${h(p.title)}</h2>
  <p class="question">${h(p.question)}</p>
  <p class="serves">Can serve as evidence for: ${h(serves_text(p.serves))}.</p>
  <ul class="summary">${summary_lines(p.summary).map(l => `<li>${h(l)}</li>`).join('')}</ul>
  ${p.statements.length ? `<table><thead><tr><th>Statement</th><th>Records</th></tr></thead><tbody>${p.statements.map(s => `<tr><td>${h(s.text)}</td><td class="cite">${h(citation_text(s.citations))}</td></tr>`).join('')}</tbody></table>` : '<p>Nothing recorded.</p>'}
</section>`).join('\n');
    return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Evidence report</title>
<style>
:root { --fg: #1d1d1f; --muted: #5f6368; --line: #d9dce1; --bg: #ffffff; --note: #f4f6f8; }
@media (prefers-color-scheme: dark) { :root { --fg: #e8eaed; --muted: #a0a4aa; --line: #3c4043; --bg: #17181a; --note: #222427; } }
body { font: 15px/1.5 system-ui, sans-serif; color: var(--fg); background: var(--bg); max-width: 1100px; margin: 0 auto; padding: 24px 16px; }
h1 { font-size: 1.6em; margin-bottom: 4px; } h2 { font-size: 1.2em; margin-top: 2em; border-bottom: 1px solid var(--line); padding-bottom: 4px; }
.notice { background: var(--note); border-left: 4px solid var(--muted); padding: 10px 14px; }
.question { font-style: italic; color: var(--muted); } .serves { color: var(--muted); font-size: 0.92em; }
table { border-collapse: collapse; width: 100%; font-size: 0.92em; } th, td { text-align: left; vertical-align: top; border-bottom: 1px solid var(--line); padding: 6px 8px; }
td.cite { font-family: ui-monospace, monospace; font-size: 0.85em; white-space: nowrap; color: var(--muted); }
</style>
</head>
<body>
<h1>Evidence report</h1>
<p>As of ${h(report.as_of)}. Period: ${h(report.period.from ?? 'the beginning of the records')} to ${h(report.period.to ?? 'the end of the records')}.</p>
<p class="notice">${h(report.notice)}</p>
<h2>Scope</h2>
${report.scope.workflows.length ? `<table><thead><tr><th>Workflow</th><th>Versions</th><th>Runs</th><th>Of which child runs</th></tr></thead><tbody>${report.scope.workflows.map(w => `<tr><td>${h(w.name)}</td><td>${h(w.versions.join(', ') || 'not recorded')}</td><td>${w.runs}</td><td>${w.child_runs ?? 0}</td></tr>`).join('')}</tbody></table>` : '<p>No run falls within the period.</p>'}
${report.scope.journeys.length ? `<ul>${report.scope.journeys.map(j => `<li>Journey "${h(j.name)}": ${j.instances} instance(s)</li>`).join('')}</ul>` : ''}
<p class="serves">Each statement cites the journal records it rests on: "run 1a2b3c4d #5" is the record with sequence number 5 in the journal of the run whose id begins 1a2b3c4d.</p>
${parts}
<h2>The frameworks named</h2>
${report.frameworks.map(f => `<h3>${h(f.name)}</h3><ul>${f.references.map(r => `<li>${h(r.label)}: ${h(r.title)}</li>`).join('')}</ul>`).join('\n')}
<p>The mapping from parts to provisions says which obligations a record is relevant to. It does not say that an obligation is met.</p>
</body>
</html>
`;
}
