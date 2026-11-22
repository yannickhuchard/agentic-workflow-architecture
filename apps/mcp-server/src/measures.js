// The measures of journeys and workflows (specification section 21) for the
// dashboard widget: what the page needs of a record, and a summary a model can read.
import { load_sdk } from './sdk.js';

const pick = (object, keys) => Object.fromEntries(keys.filter(k => object && object[k] !== undefined).map(k => [k, object[k]]));
const text = (value, max = 120) => (typeof value === 'string' ? value.slice(0, max) : value);
const RUN_DATA = ['actor_type', 'duration_ms', 'usage', 'cost', 'currency', 'input_tokens', 'output_tokens', 'tool', 'passed', 'verdict', 'method', 'used_default', 'waited_ms', 'workflow_name', 'reason'];
const JOURNEY_DATA = ['sentiment', 'basis', 'channel', 'direction', 'technology', 'reason', 'max_duration', 'owner', 'stage_name'];
const JOURNEY_EVENTS = new Set(['journey.started', 'journey.stalled', 'journey.touchpoint', 'journey.sentiment_changed']);
const NOT_MEASURED = /^(token\.(created|moved|completed|joined|failed|cancelled|waiting)|meta\.|reasoning\.|timer\.|run\.(waiting|resumed)|event\.published)/;

/**
 * A portfolio reduced to what the measures read: no input, output, reasoning or tool
 * result leaves the server for the widget, only what happened, when, and how it ended.
 */
export function measured_record(portfolio) {
    return {
        as_of: portfolio.as_of,
        workflows: (portfolio.workflows || []).map(w => ({ id: w.id, name: text(w.name), activities: (w.activities || []).map(a => pick(a, ['id', 'name', 'actor_type'])) })),
        transitions: (portfolio.transitions || []).map(t => pick(t, ['from', 'to', 'count'])),
        journeys: portfolio.journeys.map(j => ({
            definition: { ...pick(j.definition, ['id', 'name', 'goals', 'sentiment']), stages: j.definition.stages.map(s => pick(s, ['id', 'name', 'owner', 'max_duration'])) },
            instances: j.instances.map(r => ({
                ...(r.subject_name ? { subject_name: text(r.subject_name, 80) } : {}),
                instance: {
                    ...pick(r.instance, ['id', 'journey_id', 'subject_key', 'status', 'stage_id', 'stage_entered_at', 'stalled', 'started_at', 'ended_at', 'goals_reached', 'sentiment', 'stage_history']),
                    events: r.instance.events.filter(e => e && JOURNEY_EVENTS.has(e.type)).map(e => ({ ...pick(e, ['type', 'time', 'stage_id']), data: { ...pick(e.data, JOURNEY_DATA), ...(Array.isArray(e.data?.artefacts) ? { artefacts: e.data.artefacts.map(a => pick(a, ['kind'])) } : {}) } })),
                },
                runs: r.runs.filter(run => run && Array.isArray(run.events)).map(run => ({
                    ...pick(run, ['run_id', 'workflow_id', 'stage_id']),
                    events: run.events.filter(e => e && typeof e.type === 'string' && !NOT_MEASURED.test(e.type)).map(e => ({ ...pick(e, ['type', 'time', 'node_id', 'node_name']), data: { ...pick(e.data, RUN_DATA), ...(e.data?.error ? { error: pick(e.data.error, ['code']) } : {}) } })),
                })),
            })),
        })),
    };
}

const value = (measures, id) => (measures[id] && measures[id].value !== null ? { value: Number(Number(measures[id].value).toPrecision(4)), of: measures[id].n } : null);

/** The report computed by the SDK, and the part of it worth a model's attention */
export async function measure(record, options = {}) {
    const { compute_measures } = await load_sdk();
    const report = compute_measures(record, options);
    const keys = (measures, ids) => Object.fromEntries(ids.map(id => [id, value(measures, id)]));
    const summary = {
        as_of: report.as_of, period: report.period, currency: report.currency,
        note: 'Each measure is { value, of }: "of" is the number it was computed over. null means there was nothing to compute it from, which is not zero. Rates are between 0 and 1, durations in milliseconds. A rate over fewer than ten is an anecdote: quote the count.',
        totals: keys(report.totals, ['journey.started', 'journey.active', 'journey.completion_rate', 'journey.abandonment_rate', 'journey.goal_attainment', 'journey.stalled_now', 'journey.cost_per_journey', 'workflow.runs', 'workflow.success_rate', 'workflow.first_pass_yield', 'workflow.lead_time_median_ms', 'workflow.process_time_median_ms', 'workflow.automation_rate', 'workflow.cost']),
        needs_someone_now: report.attention.slice(0, 20).map(a => ({ customer: text(a.subject_name || a.subject_key, 80), journey: text(a.journey_name), stage: text(a.stage_name), owner: a.owner ? text(a.owner) : null, waiting_ms: a.waiting_ms, reason: text(a.reason, 200) })),
        journeys: report.journeys.slice(0, 20).map(j => ({
            name: text(j.name),
            ...keys(j.measures, ['journey.started', 'journey.completion_rate', 'journey.abandonment_rate', 'journey.stall_rate', 'journey.goal_attainment', 'journey.duration_median_ms', 'journey.mood_end', 'journey.mood_measured_share']),
            stages: j.stages.map(s => ({ name: text(s.name), owner: s.owner ? text(s.owner) : null, ...keys(s.measures, ['stage.entered', 'stage.conversion', 'stage.duration_median_ms', 'stage.breach_rate', 'stage.abandoned', 'stage.stalled_now']) })),
        })),
        workflows: report.workflows.slice(0, 20).map(w => ({
            name: text(w.name),
            ...keys(w.measures, ['workflow.runs', 'workflow.success_rate', 'workflow.first_pass_yield', 'workflow.lead_time_median_ms', 'workflow.flow_efficiency', 'workflow.event_timeout_rate', 'workflow.human_wait_median_ms', 'workflow.tool_failure_rate', 'workflow.cost_per_run']),
            failing_steps: w.activities.filter(a => a.measures['activity.failure_rate'].value).map(a => ({ name: text(a.name), ...keys(a.measures, ['activity.failure_rate']) })),
            errors: w.errors,
        })),
    };
    return { report, summary };
}
