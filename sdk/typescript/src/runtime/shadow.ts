/**
 * Shadow runs (specification section 33.5)
 *
 * A host may run a candidate workflow or model beside production. Each time a
 * production run ends, its shadow performs the same run under the candidate:
 * the same input, the same business events in the same order, and, in place
 * of every tool, person, application and robot, the results production
 * recorded. Only the candidate's AI agents, model decisions and judges run.
 * Nothing the shadow does reaches the outside world: no tool runs, no person
 * is asked, no business event is published, nothing is learnt from it. Its
 * journal is then compared with production's (section 20.3), and the measures
 * of section 21 are computed for both.
 */

import { Workflow } from '../types';
import { counterfactual_replay, CounterfactualReport } from './counterfactual';
import { JournalEvent } from './journal';
import { compute_measures, Measure } from './kpi';
import { WorkflowEngine, WorkflowEngineOptions } from './workflow_engine';

export interface ShadowOptions {
    /** The candidate workflow for each production workflow id. Nodes that are the same keep their ids. */
    candidates?: Record<string, Workflow>;
    /** The production workflows to shadow. Default: those with a candidate, or every workflow when only `engine` is given. */
    workflow_ids?: string[];
    /**
     * Engine options for the shadow: model providers and tiers, roles, the default model, verification,
     * knowledge to read, or the actor that performs AI agents. Everything else is ignored, so that a
     * shadow can never be given a way to act: tools, other actors, event sinks and stores are not taken.
     */
    engine?: WorkflowEngineOptions;
    /** live (default): the candidate's AI agents run. recorded: production's AI outputs are replayed too, to test a changed contract or rule. */
    ai?: 'live' | 'recorded';
    /** Told of each comparison as it is made */
    on_comparison?: (comparison: ShadowComparison) => void | Promise<void>;
}

export interface ShadowComparison {
    production_run_id: string;
    shadow_run_id: string | null;
    workflow_id: string;
    candidate: { id: string; name: string; version: string };
    compared_at: string;
    production_status: string;
    shadow_status: string;
    /** The runs part: their status, their path or the verdict of a node differ */
    parted: boolean;
    report: CounterfactualReport | null;
    /** Why there is no shadow, when it could not be run */
    error?: string;
}

export interface ShadowReport {
    spec_version: '1.1';
    as_of: string;
    workflows: { workflow_id: string; name: string; candidate: string; runs: number; parted: number; production: Record<string, Measure>; shadow: Record<string, Measure> }[];
    /** Every production run compared, with whether its shadow parted from it */
    runs: { production_run_id: string; shadow_run_id: string | null; workflow_id: string; production_status: string; shadow_status: string; parted: boolean; regressions: string[]; improvements: string[]; unrecorded: string[]; divergence?: CounterfactualReport['divergence']; error?: string }[];
    /** The production runs whose shadow parted from them */
    parted: string[];
}

/** Engine options a shadow may take: none of them lets it act on the world */
const SAFE_KEYS = ['gemini_api_key', 'default_ai_model_id', 'roles', 'verification_enabled', 'verification_model_id', 'model_providers', 'default_model_provider', 'model_tiers', 'pricing_config', 'decision_engines', 'knowledge', 'journal_payloads', 'retry'] as const;

/** A cancelled run is not shadowed: what ended it was decided outside the run, and a shadow cannot be told it */
const ENDED = new Set(['completed', 'failed']);

export class ShadowRunner {
    private done = new Map<string, ShadowComparison>();
    private journals = new Map<string, { production: JournalEvent[]; shadow: JournalEvent[] }>();

    constructor(private options: ShadowOptions, private now: () => number = Date.now) { }

    /** Whether runs of this workflow have a shadow */
    shadows(workflow_id: string): boolean {
        if (this.options.workflow_ids) return this.options.workflow_ids.includes(workflow_id);
        if (this.options.candidates) return workflow_id in this.options.candidates;
        return !!this.options.engine;
    }

    /** Called by the host when a production run has made progress. A run that has ended is shadowed once. */
    async settled(production: WorkflowEngine): Promise<ShadowComparison | undefined> {
        const run_id = production.getRunId();
        const workflow = production.getWorkflow();
        if (!ENDED.has(production.getStatus()) || this.done.has(run_id) || !this.shadows(workflow.id)) return undefined;
        const candidate = this.options.candidates?.[workflow.id] || workflow;
        const recorded = await production.getEvents();
        const base: Omit<ShadowComparison, 'shadow_run_id' | 'shadow_status' | 'parted' | 'report'> = {
            production_run_id: run_id, workflow_id: workflow.id, candidate: { id: candidate.id, name: candidate.name, version: candidate.version },
            compared_at: new Date(this.now()).toISOString(), production_status: production.getStatus(),
        };
        let comparison: ShadowComparison;
        try {
            const engine: WorkflowEngineOptions = {};
            for (const key of SAFE_KEYS) if (this.options.engine?.[key] !== undefined) (engine as Record<string, unknown>)[key] = this.options.engine[key];
            if (this.options.engine?.actors?.ai_agent) engine.actors = { ai_agent: this.options.engine.actors.ai_agent };
            const { report, events, status } = await counterfactual_replay(workflow, recorded, { candidate, ai: this.options.ai || 'live', engine: { ...engine, learn: false } });
            this.journals.set(run_id, { production: recorded, shadow: events });
            const parted = !report.same_status || !report.same_path || report.nodes.some(n => n.verdict !== 'same');
            comparison = { ...base, shadow_run_id: events[0]?.run_id ?? null, shadow_status: status, parted, report };
        } catch (error) {
            // A shadow that cannot run is recorded as such. It never touches production.
            comparison = { ...base, shadow_run_id: null, shadow_status: 'not_run', parted: true, report: null, error: error instanceof Error ? error.message : String(error) };
        }
        this.done.set(run_id, comparison);
        try { await this.options.on_comparison?.(comparison); } catch { /* a listener must not break the host */ }
        return comparison;
    }

    comparisons(): ShadowComparison[] { return [...this.done.values()]; }

    /** The journal of the shadow of a production run */
    shadow_journal(production_run_id: string): JournalEvent[] | undefined { return this.journals.get(production_run_id)?.shadow; }

    /** The measures of section 21 for production and for its shadow, and the runs where they part */
    report(): ShadowReport {
        const comparisons = this.comparisons();
        const workflows = [...new Set(comparisons.map(c => c.workflow_id))].map(workflow_id => {
            const mine = comparisons.filter(c => c.workflow_id === workflow_id);
            const pairs = mine.map(c => this.journals.get(c.production_run_id)).filter((p): p is { production: JournalEvent[]; shadow: JournalEvent[] } => !!p);
            const measures = (journals: JournalEvent[][]) => compute_measures({ runs: journals.filter(j => j.length).map(events => ({ run_id: events[0].run_id, workflow_id, events })) }).workflows[0]?.measures || {};
            const first = pairs[0]?.production.find(e => e.type === 'run.started');
            return {
                workflow_id, name: (first?.data.workflow_name as string) || workflow_id, candidate: `${mine[0].candidate.name} ${mine[0].candidate.version}`,
                runs: mine.length, parted: mine.filter(c => c.parted).length,
                production: measures(pairs.map(p => p.production)), shadow: measures(pairs.map(p => p.shadow)),
            };
        });
        return {
            spec_version: '1.1', as_of: new Date(this.now()).toISOString(), workflows,
            runs: comparisons.map(c => ({
                production_run_id: c.production_run_id, shadow_run_id: c.shadow_run_id, workflow_id: c.workflow_id,
                production_status: c.production_status, shadow_status: c.shadow_status, parted: c.parted,
                regressions: c.report?.regressions || [], improvements: c.report?.improvements || [], unrecorded: c.report?.unrecorded || [],
                ...(c.report?.divergence ? { divergence: c.report.divergence } : {}), ...(c.error ? { error: c.error } : {}),
            })),
            parted: comparisons.filter(c => c.parted).map(c => c.production_run_id),
        };
    }
}
