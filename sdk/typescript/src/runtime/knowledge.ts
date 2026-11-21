/**
 * AWA Knowledge Layer (specification section 15)
 *
 * Turns run journals into knowledge that compounds: each run adds evidence to
 * entries that already exist instead of creating duplicates, every entry
 * points back to the runs it came from, and only entries a person has
 * reviewed are given to actors by default.
 *
 * Knowledge is exchanged as an Open Knowledge Format (OKF) v0.3 bundle: a
 * directory of Markdown files with YAML frontmatter.
 */

import YAML from 'yaml';
import { Activity, Workflow } from '../types';
import { JournalEvent } from './journal';

export const OKF_VERSION = '0.3';

export type KnowledgeType = 'strategy' | 'failure_pattern' | 'decision_precedent' | 'lesson';
export type KnowledgeStatus = 'draft' | 'reviewed' | 'deprecated';

export interface KnowledgeSource {
    run_id: string;
    /** Sequence numbers of the journal events the entry was distilled from */
    event_seqs: number[];
    observed_at: string;
}

export interface KnowledgeEntry {
    /** Path of the entry within a bundle, without ".md". Also its OKF concept id. */
    id: string;
    type: KnowledgeType;
    title: string;
    /** One line: what the entry tells you */
    description: string;
    tags: string[];
    scope: { workflow_id?: string; workflow_name?: string; node_id?: string; node_name?: string };
    status: KnowledgeStatus;
    /** Number of runs that contributed evidence */
    observations: number;
    /** Counters that add up across runs */
    counts: Record<string, number>;
    /** Facts from the most recent contributing run */
    latest: Record<string, unknown>;
    sources: KnowledgeSource[];
    created_at: string;
    updated_at: string;
    reviewed_by?: string;
    reviewed_at?: string;
    superseded_by?: string;
}

/** Which entries an activity is given when it executes */
export interface KnowledgeBinding {
    types?: KnowledgeType[];
    tags?: string[];
    max_entries?: number;
    min_status?: 'draft' | 'reviewed';
}

type Candidate = Omit<KnowledgeEntry, 'status' | 'observations' | 'sources' | 'created_at' | 'updated_at'> & { event_seqs: number[] };

const DIRECTORY: Record<KnowledgeType, string> = {
    strategy: 'strategies',
    failure_pattern: 'failure-patterns',
    decision_precedent: 'decision-precedents',
    lesson: 'lessons',
};
const OKF_TYPE: Record<KnowledgeType, string> = {
    strategy: 'Strategy',
    failure_pattern: 'Failure Pattern',
    decision_precedent: 'Decision Precedent',
    lesson: 'Lesson',
};
const SECTION: Record<KnowledgeType, string> = {
    strategy: 'Strategies',
    failure_pattern: 'Failure patterns',
    decision_precedent: 'Decision precedents',
    lesson: 'Lessons',
};
const MAX_SOURCES = 50;

const slug = (text: string) => text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'x';
const one_line = (text: unknown) => String(text ?? '').replace(/\s+/g, ' ').trim();
const percent = (part: number, whole: number) => (whole > 0 ? `${Math.round((part / whole) * 100)}%` : 'n/a');

/** OKF asks producers to quote timestamps so that no YAML parser reads them as anything but strings */
const quote_timestamps = (yaml: string) =>
    yaml.replace(/^(\s*(?:- )?(?:at|last_modified|x-awa-created-at): )(\d{4}-\d{2}-\d{2}T[\d:.]+Z)$/gm, '$1"$2"');

// ---------------------------------------------------------------- distillation

/**
 * Distil the journal of one run into candidate knowledge entries.
 * Deterministic and model-free: the same journal always yields the same
 * candidates, and every candidate cites the events it came from.
 */
export function distill(workflow: Workflow, events: JournalEvent[]): Candidate[] {
    const sorted = [...events].sort((a, b) => a.seq - b.seq);
    const wf = { workflow_id: workflow.id, workflow_name: workflow.name };
    const wf_slug = slug(workflow.name);
    const candidates: Candidate[] = [];
    const node_events = new Map<string, JournalEvent[]>();
    for (const event of sorted) {
        if (!event.node_id) continue;
        node_events.set(event.node_id, [...(node_events.get(event.node_id) || []), event]);
    }

    for (const activity of workflow.activities) {
        const here = node_events.get(activity.id) || [];
        const scope = { ...wf, node_id: activity.id, node_name: activity.name };
        const base = `${wf_slug}-${slug(activity.name)}`;
        const accepted = here.find(e => e.type === 'activity.completed');
        const failures = here.filter(e => e.type === 'activity.failed');
        const escalated = here.some(e => e.type === 'contract.escalated');

        // Strategy: how the accepted attempt went about the work
        const reasoning = accepted && [...here].reverse().find(e => e.type === 'reasoning.recorded' && e.attempt === accepted.attempt);
        if (accepted && reasoning) {
            const model = here.find(e => e.type === 'meta.recorded' && e.data.subject === 'model_selection');
            candidates.push({
                id: `${DIRECTORY.strategy}/${base}`,
                type: 'strategy',
                title: `How to ${activity.name.charAt(0).toLowerCase()}${activity.name.slice(1)}`,
                description: `The approach whose outcome was accepted for "${activity.name}".`,
                tags: [activity.actor_type, wf_slug],
                scope,
                counts: { accepted_runs: 1, accepted_first_attempt: (accepted.attempt || 1) === 1 ? 1 : 0, attempts: accepted.attempt || 1 },
                latest: {
                    plan: reasoning.data.plan,
                    rationale: reasoning.data.rationale,
                    alternatives_considered: reasoning.data.alternatives_considered,
                    confidence: reasoning.data.confidence,
                    model: (model?.data.model as { requested?: string } | undefined)?.requested,
                },
                event_seqs: [reasoning.seq, accepted.seq],
            });
        }

        // Failure patterns: what went wrong here, and what resolved it
        for (const failure of failures) {
            const error = (failure.data.error || {}) as { message?: string; code?: string };
            const code = error.code || 'ERROR';
            const check = here.find(e => e.attempt === failure.attempt
                && (code === 'CONTRACT_VIOLATION' ? e.type === 'contract.checked' : e.type === 'verification.completed'));
            const terms = code === 'CONTRACT_VIOLATION'
                ? ((check?.data.violations as { name: string }[]) || []).map(v => v.name)
                : code === 'VERIFICATION_FAILED'
                    ? ((check?.data.criteria as { criterion_name: string; passed: boolean }[]) || []).filter(c => !c.passed).map(c => c.criterion_name)
                    : [];
            const signature = terms.length ? terms.slice().sort().join('+') : one_line(error.message).replace(/\d+/g, 'N');
            const next = here.find(e => e.type === 'activity.started' && (e.attempt || 0) === (failure.attempt || 0) + 1);
            const resolution = !accepted ? (escalated ? 'escalated' : 'unresolved')
                : escalated ? 'escalated' : next?.data.feedback ? 'retry_with_feedback' : 'retry';
            candidates.push({
                id: `${DIRECTORY.failure_pattern}/${base}-${slug(code)}-${slug(signature)}`.slice(0, 140),
                type: 'failure_pattern',
                title: `${activity.name}: ${code.toLowerCase().replace(/_/g, ' ')}${terms.length ? ` (${terms.join(', ')})` : ''}`,
                description: `"${activity.name}" was rejected or raised: ${one_line(error.message).slice(0, 140)}`,
                tags: [activity.actor_type, wf_slug, code.toLowerCase()],
                scope,
                counts: { occurrences: 1, [`resolved_by_${resolution}`]: 1 },
                latest: { code, terms, message: error.message, feedback: next?.data.feedback, resolution },
                event_seqs: [failure.seq, ...(check ? [check.seq] : [])],
            });
        }
    }

    // Decision precedents: which rule a set of inputs matched
    for (const decision of workflow.decision_nodes) {
        for (const event of (node_events.get(decision.id) || []).filter(e => e.type === 'decision.evaluated')) {
            const rules = (event.data.matched_rules as { index: number; input_entries: string[] }[]) || [];
            const rule = rules[0];
            const edge = workflow.edges.find(e => e.id === event.data.edge_id);
            const target = edge && [...workflow.activities, ...workflow.events, ...workflow.decision_nodes].find(n => n.id === edge.target_id);
            const label = rule ? `rule ${rule.index + 1}` : 'default';
            candidates.push({
                id: `${DIRECTORY.decision_precedent}/${wf_slug}-${slug(decision.name)}-${slug(label)}`,
                type: 'decision_precedent',
                title: `${decision.name}: ${label}${target ? ` routes to ${target.name}` : ''}`,
                description: `Inputs that matched ${label} of "${decision.name}"${target ? ` and were routed to "${target.name}"` : ''}.`,
                tags: ['decision', wf_slug],
                scope: { ...wf, node_id: decision.id, node_name: decision.name },
                counts: { occurrences: 1 },
                latest: { rule: rule ? rule.index + 1 : null, input_entries: rule?.input_entries, inputs: event.data.inputs, route: target?.name },
                event_seqs: [event.seq],
            });
        }
    }

    // Lessons: why a run failed, and whether its effects were undone
    const failed = sorted.find(e => e.type === 'run.failed');
    if (failed) {
        const token = sorted.find(e => e.type === 'token.failed');
        const error = (token?.data.error || {}) as { message?: string; code?: string };
        const compensation = (failed.data.compensation || { attempted: 0, succeeded: 0 }) as { attempted: number; succeeded: number };
        const at = token?.node_name || 'unknown step';
        candidates.push({
            id: `${DIRECTORY.lesson}/${wf_slug}-failed-at-${slug(at)}-${slug(error.code || one_line(error.message).replace(/\d+/g, 'N'))}`.slice(0, 140),
            type: 'lesson',
            title: `${workflow.name} fails at ${at}${error.code ? ` (${error.code})` : ''}`,
            description: `The run failed at "${at}": ${one_line(error.message).slice(0, 140)}`,
            tags: ['run-failure', wf_slug],
            scope: { ...wf, node_id: token?.node_id, node_name: token?.node_name },
            counts: { occurrences: 1, compensations_attempted: compensation.attempted, compensations_succeeded: compensation.succeeded },
            latest: { code: error.code, message: error.message },
            event_seqs: [...(token ? [token.seq] : []), failed.seq],
        });
    }

    return candidates;
}

// --------------------------------------------------------------------- content

/** The body of an entry, as Markdown. Rendered from the entry's data, so it stays current as evidence accrues. */
export function render_body(entry: KnowledgeEntry, all?: Map<string, KnowledgeEntry>): string {
    const lines: string[] = [];
    const c = entry.counts, l = entry.latest;
    const list = (items: unknown) => (Array.isArray(items) ? items.map(i => `${one_line(i)}`) : []);

    if (entry.type === 'strategy') {
        lines.push(`Across ${entry.observations} run(s), the outcome of **${entry.scope.node_name}** was accepted ${c.accepted_runs || 0} time(s), `
            + `${percent(c.accepted_first_attempt || 0, c.accepted_runs || 0)} of them on the first attempt `
            + `(${((c.attempts || 0) / Math.max(1, c.accepted_runs || 0)).toFixed(1)} attempts on average).`, '');
        if (list(l.plan).length) lines.push('## Approach that was accepted most recently', '', ...list(l.plan).map((step, i) => `${i + 1}. ${step}`), '');
        if (l.rationale) lines.push('## Why it works', '', one_line(l.rationale), '');
        if (list(l.alternatives_considered).length) lines.push('## Approaches that were rejected', '', ...list(l.alternatives_considered).map(a => `- ${a}`), '');
        if (l.model) lines.push(`Model reference used: \`${l.model}\`.`, '');
        lines.push('The approach is the actor\'s own account of its work, recorded with its output.', '');
    } else if (entry.type === 'failure_pattern') {
        lines.push(`Seen ${c.occurrences || 0} time(s) across ${entry.observations} run(s) at **${entry.scope.node_name}**.`, '');
        lines.push('## What goes wrong', '', one_line(l.message), '');
        if (list(l.terms).length) lines.push('Terms not met:', '', ...list(l.terms).map(t => `- ${t}`), '');
        lines.push('## How it was resolved', '');
        const resolved: [string, string][] = [
            ['resolved_by_retry_with_feedback', 'Re-executed with corrective feedback, then accepted'],
            ['resolved_by_retry', 'Retried after an error, then accepted'],
            ['resolved_by_escalated', 'Escalated to a human'],
            ['resolved_by_unresolved', 'Not resolved: the activity failed'],
        ];
        for (const [key, text] of resolved) if (c[key]) lines.push(`- ${text}: ${c[key]} time(s)`);
        lines.push('');
        if (l.feedback) lines.push('## Feedback that led to an accepted outcome', '', '```', String(l.feedback), '```', '');
    } else if (entry.type === 'decision_precedent') {
        lines.push(`Matched ${c.occurrences || 0} time(s) across ${entry.observations} run(s).`, '');
        if (l.input_entries) lines.push(`Rule entries: ${list(l.input_entries).map(e => `\`${e}\``).join(', ')}.`, '');
        lines.push('Most recent inputs:', '', '```json', JSON.stringify(l.inputs ?? {}, null, 2), '```', '');
        if (l.route) lines.push(`Routed to **${l.route}**.`, '');
    } else {
        lines.push(`Seen ${c.occurrences || 0} time(s).`, '', '## Cause', '', one_line(l.message), '');
        if (c.compensations_attempted) {
            lines.push('## Effects undone', '', `${c.compensations_succeeded || 0} of ${c.compensations_attempted} compensations succeeded.`
                + `${(c.compensations_succeeded || 0) < c.compensations_attempted ? ' Some effects were NOT undone and need attention.' : ''}`, '');
        }
    }

    // Link related entries about the same node
    const related = [...(all?.values() || [])].filter(e => e.id !== entry.id && e.scope.node_id && e.scope.node_id === entry.scope.node_id && e.status !== 'deprecated');
    if (related.length) lines.push('## Related', '', ...related.map(e => `- [${e.title}](/${e.id}.md)`), '');

    return lines.join('\n').trimEnd() + '\n';
}

/** A short instruction for an actor, derived from an entry */
export function guidance(entry: KnowledgeEntry): string {
    const l = entry.latest;
    if (entry.type === 'strategy') {
        const plan = Array.isArray(l.plan) ? (l.plan as unknown[]).map(one_line).join('; ') : '';
        return `An approach accepted before: ${plan}${l.rationale ? `. Why: ${one_line(l.rationale)}` : ''}`;
    }
    if (entry.type === 'failure_pattern') {
        const terms = Array.isArray(l.terms) && l.terms.length ? ` Make sure these hold: ${(l.terms as unknown[]).map(one_line).join(', ')}.` : '';
        return `Earlier outcomes were rejected here (${entry.counts.occurrences || 1}×): ${one_line(l.message)}.${terms}`;
    }
    return `${entry.title}. ${entry.description}`;
}

// ---------------------------------------------------------------- knowledge base

export class KnowledgeBase {
    private entries = new Map<string, KnowledgeEntry>();
    private ingested = new Set<string>();
    private log: { date: string; action: 'Creation' | 'Update' | 'Review' | 'Deprecation'; id: string; text: string }[] = [];

    /**
     * Add the evidence of one run. Entries that already exist gain an
     * observation and a source; new ones are created as drafts. A run that
     * was already ingested changes nothing, so ingesting is safe to repeat.
     */
    ingest(workflow: Workflow, events: JournalEvent[]): { run_id?: string; created: string[]; updated: string[]; skipped: boolean } {
        const run_id = events[0]?.run_id;
        if (!run_id || this.ingested.has(run_id)) return { run_id, created: [], updated: [], skipped: true };
        this.ingested.add(run_id);

        const observed_at = [...events].sort((a, b) => b.seq - a.seq)[0].time;
        const created: string[] = [], updated: string[] = [];
        const seen = new Set<string>();

        for (const candidate of distill(workflow, events)) {
            const { event_seqs, ...fields } = candidate;
            const existing = this.entries.get(candidate.id);
            if (!existing) {
                this.entries.set(candidate.id, {
                    ...fields, status: 'draft', observations: 1,
                    sources: [{ run_id, event_seqs, observed_at }], created_at: observed_at, updated_at: observed_at,
                });
                created.push(candidate.id);
                seen.add(candidate.id);
                this.log.push({ date: observed_at.slice(0, 10), action: 'Creation', id: candidate.id, text: `Distilled from run ${run_id}.` });
                continue;
            }
            for (const [key, value] of Object.entries(candidate.counts)) existing.counts[key] = (existing.counts[key] || 0) + value;
            existing.latest = candidate.latest;
            existing.title = candidate.title;
            existing.description = candidate.description;
            existing.updated_at = observed_at;
            const source = existing.sources.find(s => s.run_id === run_id);
            if (source) {
                source.event_seqs = [...new Set([...source.event_seqs, ...event_seqs])].sort((a, b) => a - b);
            } else {
                existing.sources = [...existing.sources, { run_id, event_seqs, observed_at }].slice(-MAX_SOURCES);
            }
            if (!seen.has(candidate.id)) {
                existing.observations++;
                seen.add(candidate.id);
                updated.push(candidate.id);
                this.log.push({ date: observed_at.slice(0, 10), action: 'Update', id: candidate.id, text: `Evidence added from run ${run_id} (${existing.observations} runs).` });
            }
        }
        return { run_id, created, updated, skipped: false };
    }

    get(id: string): KnowledgeEntry | undefined { return this.entries.get(id); }

    list(filter: { type?: KnowledgeType; status?: KnowledgeStatus } = {}): KnowledgeEntry[] {
        return [...this.entries.values()]
            .filter(e => (!filter.type || e.type === filter.type) && (!filter.status || e.status === filter.status))
            .sort((a, b) => a.id.localeCompare(b.id));
    }

    /** Record that a person has reviewed an entry. Only reviewed entries reach actors by default. */
    review(id: string, reviewer: string, at: string = new Date().toISOString()): KnowledgeEntry {
        const entry = this.require(id);
        entry.status = 'reviewed';
        entry.reviewed_by = reviewer;
        entry.reviewed_at = at;
        this.log.push({ date: at.slice(0, 10), action: 'Review', id, text: `Reviewed by ${reviewer}.` });
        return entry;
    }

    deprecate(id: string, superseded_by?: string, at: string = new Date().toISOString()): KnowledgeEntry {
        const entry = this.require(id);
        if (superseded_by) this.require(superseded_by);
        entry.status = 'deprecated';
        entry.superseded_by = superseded_by;
        this.log.push({ date: at.slice(0, 10), action: 'Deprecation', id, text: superseded_by ? `Superseded by ${superseded_by}.` : 'Deprecated.' });
        return entry;
    }

    private require(id: string): KnowledgeEntry {
        const entry = this.entries.get(id);
        if (!entry) throw new Error(`Knowledge entry "${id}" not found`);
        return entry;
    }

    /** The entries an activity is given: about that activity, not deprecated, reviewed unless the binding says otherwise */
    retrieve(workflow: Workflow, activity: Activity, binding: KnowledgeBinding = {}): KnowledgeEntry[] {
        const types = binding.types || ['strategy', 'failure_pattern'];
        const allow_draft = binding.min_status === 'draft';
        return [...this.entries.values()]
            .filter(e => e.scope.workflow_id === workflow.id && e.scope.node_id === activity.id)
            .filter(e => types.includes(e.type))
            .filter(e => e.status === 'reviewed' || (allow_draft && e.status === 'draft'))
            .filter(e => !binding.tags?.length || binding.tags.some(tag => e.tags.includes(tag)))
            .sort((a, b) => Number(b.status === 'reviewed') - Number(a.status === 'reviewed')
                || b.observations - a.observations || a.id.localeCompare(b.id))
            .slice(0, binding.max_entries ?? 5);
    }

    // ------------------------------------------------------------- persistence

    to_json(): Record<string, unknown> {
        return { awa_knowledge: '1.1', entries: this.list(), ingested_runs: [...this.ingested], log: this.log };
    }

    static from_json(data: Record<string, unknown>): KnowledgeBase {
        const kb = new KnowledgeBase();
        for (const entry of (data.entries as KnowledgeEntry[]) || []) kb.entries.set(entry.id, entry);
        kb.ingested = new Set((data.ingested_runs as string[]) || []);
        kb.log = (data.log as KnowledgeBase['log']) || [];
        return kb;
    }

    async save(file: string): Promise<void> {
        const fs = await import('fs/promises');
        const path = await import('path');
        await fs.mkdir(path.dirname(file), { recursive: true });
        await fs.writeFile(file, JSON.stringify(this.to_json(), null, 2) + '\n', 'utf-8');
    }

    static async load(file: string): Promise<KnowledgeBase> {
        const fs = await import('fs/promises');
        try {
            return KnowledgeBase.from_json(JSON.parse(await fs.readFile(file, 'utf-8')));
        } catch (error) {
            if ((error as NodeJS.ErrnoException).code === 'ENOENT') return new KnowledgeBase();
            throw error;
        }
    }

    // ----------------------------------------------------------------- OKF

    /** The files of an OKF v0.3 bundle, as a map from path to content */
    to_okf(options: { title?: string; description?: string; license?: string } = {}): Map<string, string> {
        const files = new Map<string, string>();
        const entries = this.list();
        const by_id = new Map(entries.map(e => [e.id, e]));

        for (const entry of entries) {
            const frontmatter: Record<string, unknown> = {
                type: OKF_TYPE[entry.type],
                title: entry.title,
                description: entry.description,
                ...(entry.scope.workflow_id
                    ? { resource: `urn:awa:workflow:${entry.scope.workflow_id}${entry.scope.node_id ? `:node:${entry.scope.node_id}` : ''}` }
                    : {}),
                tags: entry.tags,
                status: entry.status === 'reviewed' ? 'stable' : entry.status,
                ...(entry.superseded_by ? { superseded_by: `/${entry.superseded_by}.md` } : {}),
                generated: { by: 'agent:awa-distiller', at: entry.updated_at },
                ...(entry.reviewed_by && entry.reviewed_at
                    ? { verified: [{ by: /^[a-z]+:/.test(entry.reviewed_by) ? entry.reviewed_by : `human:${entry.reviewed_by}`, at: entry.reviewed_at }] }
                    : {}),
                sources: entry.sources.map(source => ({
                    id: `run-${source.run_id.slice(0, 8)}`,
                    resource: `urn:awa:run:${source.run_id}`,
                    title: `Run ${source.run_id}, journal events ${source.event_seqs.join(', ')}`,
                    last_modified: source.observed_at,
                    'x-awa-event-seqs': source.event_seqs,
                })),
                'x-awa-entry-type': entry.type,
                'x-awa-observations': entry.observations,
                'x-awa-scope': entry.scope,
                'x-awa-counts': entry.counts,
                'x-awa-latest': entry.latest,
                'x-awa-created-at': entry.created_at,
            };
            files.set(`${entry.id}.md`, `---\n${quote_timestamps(YAML.stringify(frontmatter, { lineWidth: 0 }))}---\n\n# ${entry.title}\n\n${render_body(entry, by_id)}`);
        }

        // Subdirectory indexes, then the bundle root index
        const root: string[] = [];
        for (const type of Object.keys(DIRECTORY) as KnowledgeType[]) {
            const of_type = entries.filter(e => e.type === type);
            if (!of_type.length) continue;
            const dir = DIRECTORY[type];
            files.set(`${dir}/index.md`, `# ${SECTION[type]}\n\n${of_type
                .map(e => `* [${e.title}](${e.id.slice(dir.length + 1)}.md) - ${one_line(e.description)}`).join('\n')}\n`);
            root.push(`* [${SECTION[type]}](${dir}/) - ${of_type.length} ${of_type.length === 1 ? 'entry' : 'entries'}`);
        }
        const root_frontmatter = {
            okf_version: OKF_VERSION,
            title: options.title || 'AWA knowledge base',
            description: options.description || 'Knowledge distilled from AWA workflow runs: accepted strategies, failure patterns, decision precedents and lessons.',
            ...(options.license ? { license: options.license } : {}),
            'x-awa-ingested-runs': [...this.ingested],
        };
        files.set('index.md', `---\n${YAML.stringify(root_frontmatter, { lineWidth: 0, defaultStringType: 'PLAIN', defaultKeyType: 'PLAIN' })
            .replace(/^okf_version: .*$/m, `okf_version: "${OKF_VERSION}"`)}---\n\n# Knowledge\n\n${root.join('\n')}\n`);

        // Change log, newest date first
        const dates = [...new Set(this.log.map(l => l.date))].sort().reverse();
        files.set('log.md', `# Directory Update Log\n\n${dates.map(date => `## ${date}\n\n${this.log.filter(l => l.date === date)
            .map(l => `* **${l.action}**: [${by_id.get(l.id)?.title || l.id}](${l.id}.md). ${l.text}`).join('\n')}`).join('\n\n')}\n`);

        return files;
    }

    /** Write the knowledge base as an OKF bundle directory */
    async export_okf(directory: string, options: { title?: string; description?: string; license?: string } = {}): Promise<number> {
        const fs = await import('fs/promises');
        const path = await import('path');
        const files = this.to_okf(options);
        for (const [file, content] of files) {
            const target = path.join(directory, file);
            await fs.mkdir(path.dirname(target), { recursive: true });
            await fs.writeFile(target, content, 'utf-8');
        }
        return files.size;
    }

    /**
     * Read an OKF bundle. Concepts written by AWA are restored exactly.
     * Concepts from other producers are imported as reviewed-or-draft lessons
     * with their text preserved, so foreign knowledge can still be consulted.
     */
    static from_okf(files: Map<string, string>): KnowledgeBase {
        const kb = new KnowledgeBase();
        const frontmatter_of = (content: string): { data: Record<string, unknown>; body: string } | undefined => {
            if (!content.startsWith('---\n')) return undefined;
            const end = content.indexOf('\n---', 3);
            if (end < 0) return undefined;
            const data = YAML.parse(content.slice(4, end + 1));
            return data && typeof data === 'object' && !Array.isArray(data)
                ? { data, body: content.slice(content.indexOf('\n', end + 1) + 1) } : undefined;
        };

        for (const [file, content] of files) {
            const name = file.split('/').pop() as string;
            if (!file.endsWith('.md') || name.startsWith('.')) continue;
            if (name === 'index.md' || name === 'log.md') {
                if (file === 'index.md') {
                    const root = frontmatter_of(content);
                    kb.ingested = new Set((root?.data['x-awa-ingested-runs'] as string[]) || []);
                }
                continue;
            }
            const parsed = frontmatter_of(content);
            if (!parsed || !parsed.data.type) continue; // not a concept (OKF 3.2)
            const d = parsed.data;
            const generated = (d.generated || {}) as { at?: string };
            const verified = (Array.isArray(d.verified) ? d.verified : d.verified ? [d.verified] : []) as { by: string; at: string }[];
            const status: KnowledgeStatus = d.status === 'deprecated' ? 'deprecated' : d.status === 'draft' ? 'draft'
                : d.status === undefined || d.status === 'stable' ? 'reviewed' : 'draft';
            const native = typeof d['x-awa-entry-type'] === 'string';
            const sources = ((d.sources as Record<string, unknown>[]) || []).filter(s => String(s.resource).startsWith('urn:awa:run:'));
            kb.entries.set(file.slice(0, -3), {
                id: file.slice(0, -3),
                type: native ? d['x-awa-entry-type'] as KnowledgeType : 'lesson',
                title: String(d.title || name.slice(0, -3)),
                description: String(d.description || ''),
                tags: (d.tags as string[]) || [],
                scope: (d['x-awa-scope'] as KnowledgeEntry['scope']) || {},
                status: native && status === 'reviewed' && !verified.length ? 'draft' : status,
                observations: Number(d['x-awa-observations'] ?? sources.length),
                counts: (d['x-awa-counts'] as Record<string, number>) || {},
                latest: (d['x-awa-latest'] as Record<string, unknown>) || { message: parsed.body.trim() },
                sources: sources.map(s => ({
                    run_id: String(s.resource).slice('urn:awa:run:'.length),
                    event_seqs: (s['x-awa-event-seqs'] as number[]) || [],
                    observed_at: String(s.last_modified || ''),
                })),
                created_at: String(d['x-awa-created-at'] || generated.at || ''),
                updated_at: String(generated.at || ''),
                ...(verified[0] ? { reviewed_by: verified[0].by.replace(/^human:/, ''), reviewed_at: verified[0].at } : {}),
                ...(d.superseded_by ? { superseded_by: String(d.superseded_by).replace(/^\//, '').replace(/\.md$/, '') } : {}),
            });
        }
        return kb;
    }

    static async import_okf(directory: string): Promise<KnowledgeBase> {
        const fs = await import('fs/promises');
        const path = await import('path');
        const files = new Map<string, string>();
        const walk = async (dir: string, prefix: string): Promise<void> => {
            for (const item of await fs.readdir(dir, { withFileTypes: true })) {
                if (item.name.startsWith('.')) continue;
                if (item.isDirectory()) await walk(path.join(dir, item.name), `${prefix}${item.name}/`);
                else if (item.name.endsWith('.md')) files.set(`${prefix}${item.name}`, await fs.readFile(path.join(dir, item.name), 'utf-8'));
            }
        };
        await walk(directory, '');
        return KnowledgeBase.from_okf(files);
    }
}
