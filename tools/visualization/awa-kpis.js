// Generated from sdk/typescript/src/runtime/kpi.ts by npm run build:measures. Do not edit.
"use strict";
var AWA_MEASURES = (() => {
  var __defProp = Object.defineProperty;
  var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
  var __getOwnPropNames = Object.getOwnPropertyNames;
  var __hasOwnProp = Object.prototype.hasOwnProperty;
  var __export = (target, all) => {
    for (var name in all)
      __defProp(target, name, { get: all[name], enumerable: true });
  };
  var __copyProps = (to, from, except, desc) => {
    if (from && typeof from === "object" || typeof from === "function") {
      for (let key of __getOwnPropNames(from))
        if (!__hasOwnProp.call(to, key) && key !== except)
          __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
    }
    return to;
  };
  var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

  // src/runtime/kpi.ts
  var kpi_exports = {};
  __export(kpi_exports, {
    MEASURES: () => MEASURES,
    compute_measures: () => compute_measures,
    measures_to_openmetrics: () => measures_to_openmetrics
  });
  var M = (id, name, scope, unit, better, definition) => ({ id, name, scope, unit, better, definition });
  var MEASURES = [
    M("journey.started", "Journeys started", "journey", "count", "neither", "Journey instances started in the period."),
    M("journey.active", "Journeys in progress", "journey", "count", "neither", "Journey instances neither completed nor abandoned."),
    M("journey.completion_rate", "Completion rate", "journey", "ratio", "higher", "Completed instances divided by started instances."),
    M("journey.abandonment_rate", "Abandonment rate", "journey", "ratio", "lower", "Abandoned instances divided by started instances."),
    M("journey.stall_rate", "Stall rate", "journey", "ratio", "lower", "Instances that stalled at least once divided by started instances."),
    M("journey.stalled_now", "Stalled now", "journey", "count", "lower", "Instances in progress that are stalled."),
    M("journey.goal_attainment", "Goal attainment", "journey", "ratio", "higher", "Instances that reached every goal of the journey divided by started instances. A journey without goals has no value."),
    M("journey.duration_median_ms", "Time to complete, median", "journey", "ms", "lower", "Median time from start to end of completed instances."),
    M("journey.duration_p90_ms", "Time to complete, 90th percentile", "journey", "ms", "lower", "Nearest-rank 90th percentile of the time from start to end of completed instances."),
    M("journey.mood_end", "Mood at the end", "journey", "score", "higher", "Mean of the last mood of ended instances, on the scale of the journey."),
    M("journey.mood_change", "Change of mood", "journey", "score", "higher", "Mean of the last mood minus the first mood of ended instances."),
    M("journey.mood_measured_share", "Mood that was measured", "journey", "ratio", "higher", "Changes of mood whose basis is measured divided by all changes of mood. The rest is inferred by rule."),
    M("journey.touchpoints_per_journey", "Touchpoints per journey", "journey", "count", "neither", "Touchpoints recorded divided by started instances."),
    M("journey.runs_per_journey", "Runs per journey", "journey", "count", "neither", "Workflow runs started for the journey divided by started instances."),
    M("journey.cost_per_journey", "Cost per journey", "journey", "currency", "lower", "Cost recorded by the ended runs of the journey divided by started instances."),
    M("stage.entered", "Entered", "stage", "count", "neither", "Instances that entered the stage."),
    M("stage.conversion", "Conversion", "stage", "ratio", "higher", "Instances that completed the stage divided by instances that entered it."),
    M("stage.duration_median_ms", "Time in stage, median", "stage", "ms", "lower", "Median time between entering and completing the stage."),
    M("stage.breach_rate", "Outlasted its time", "stage", "ratio", "lower", "Instances that stalled in the stage divided by instances that entered it."),
    M("stage.active", "In the stage now", "stage", "count", "neither", "Instances in progress whose current stage this is."),
    M("stage.stalled_now", "Stalled now", "stage", "count", "lower", "Instances in progress, in this stage, that are stalled."),
    M("stage.abandoned", "Abandoned here", "stage", "count", "lower", "Instances abandoned while in the stage."),
    M("workflow.runs", "Runs", "workflow", "count", "neither", "Runs started."),
    M("workflow.in_progress", "Runs in progress", "workflow", "count", "neither", "Runs with no run.completed, run.failed or run.cancelled."),
    M("workflow.success_rate", "Success rate", "workflow", "ratio", "higher", "Completed runs divided by ended runs."),
    M("workflow.failure_rate", "Failure rate", "workflow", "ratio", "lower", "Failed runs divided by ended runs."),
    M("workflow.cancel_rate", "Cancelled", "workflow", "ratio", "lower", "Cancelled runs divided by ended runs."),
    M("workflow.first_pass_yield", "Right first time", "workflow", "ratio", "higher", "Runs completed with no failed attempt, retry, dead letter or compensation divided by ended runs."),
    M("workflow.lead_time_median_ms", "Lead time, median", "workflow", "ms", "lower", "Median time from run.started to the end of ended runs."),
    M("workflow.lead_time_p90_ms", "Lead time, 90th percentile", "workflow", "ms", "lower", "Nearest-rank 90th percentile of the same."),
    M("workflow.process_time_median_ms", "Work time, median", "workflow", "ms", "lower", "Median over ended runs of the summed duration of their activity attempts."),
    M("workflow.flow_efficiency", "Flow efficiency", "workflow", "ratio", "higher", "Summed work time divided by summed lead time of ended runs, at most 1. The rest is waiting."),
    M("workflow.event_wait_median_ms", "Wait for an awaited event, median", "workflow", "ms", "lower", "Median time between event.waiting and the event.received that answered it."),
    M("workflow.event_timeout_rate", "Awaited events that never came", "workflow", "ratio", "lower", "event.timed_out divided by waits that ended, by an event or by a timeout."),
    M("workflow.human_wait_median_ms", "Wait for a person, median", "workflow", "ms", "lower", "Median waited_ms of token.resumed after a human task."),
    M("workflow.automation_rate", "Done without a person", "workflow", "ratio", "neither", "Completed activities whose actor is not human divided by completed activities."),
    M("workflow.retries", "Retries", "workflow", "count", "lower", "activity.retry_scheduled events."),
    M("workflow.dead_letters", "Dead letters", "workflow", "count", "lower", "activity.dead_lettered events."),
    M("workflow.compensations", "Compensations", "workflow", "count", "lower", "activity.compensated events."),
    M("workflow.tool_calls", "Tool calls", "workflow", "count", "neither", "tool.invoked events."),
    M("workflow.tool_failure_rate", "Tool calls that failed", "workflow", "ratio", "lower", "tool.failed divided by tool.completed plus tool.failed."),
    M("workflow.contract_pass_rate", "Outcome contracts met", "workflow", "ratio", "higher", "contract.checked that passed divided by all contract.checked."),
    M("workflow.verification_pass_rate", "Verifications passed", "workflow", "ratio", "higher", "verification.completed with verdict pass divided by all verification.completed."),
    M("workflow.decisions", "Decisions", "workflow", "count", "neither", "decision.evaluated events."),
    M("workflow.decision_default_rate", "Decisions that fell to the default", "workflow", "ratio", "lower", "Decisions that used the default edge divided by all decisions."),
    M("workflow.model_decision_share", "Decisions made by a model", "workflow", "ratio", "neither", "Decisions whose method is model divided by all decisions."),
    M("workflow.input_tokens", "Input tokens", "workflow", "tokens", "neither", "Input tokens recorded by ended runs."),
    M("workflow.output_tokens", "Output tokens", "workflow", "tokens", "neither", "Output tokens recorded by ended runs."),
    M("workflow.cost", "Cost", "workflow", "currency", "lower", "Cost recorded by ended runs."),
    M("workflow.cost_per_run", "Cost per run", "workflow", "currency", "lower", "Cost divided by ended runs."),
    M("activity.attempts", "Attempts", "activity", "count", "neither", "activity.started events."),
    M("activity.failure_rate", "Attempts that failed", "activity", "ratio", "lower", "activity.failed divided by attempts that ended."),
    M("activity.duration_median_ms", "Duration, median", "activity", "ms", "lower", "Median duration_ms of completed attempts."),
    M("activity.tokens", "Tokens", "activity", "tokens", "neither", "Input plus output tokens of completed attempts.")
  ];
  var ms = (iso) => iso ? new Date(iso).getTime() : NaN;
  var count = (n) => ({ value: n, n });
  var ratio = (part, whole) => ({ value: whole ? part / whole : null, n: whole });
  var total = (value, n) => ({ value: n ? value : null, n });
  function percentile(values, p) {
    const sorted = values.filter((v) => Number.isFinite(v)).sort((a, b) => a - b);
    return { value: sorted.length ? sorted[Math.max(0, Math.ceil(p * sorted.length) - 1)] : null, n: sorted.length };
  }
  var median = (values) => percentile(values, 0.5);
  var mean = (values) => ({ value: values.length ? values.reduce((a, b) => a + b, 0) / values.length : null, n: values.length });
  var bump = (map, key, by = 1) => map.set(key, (map.get(key) || 0) + by);
  function run_facts(run) {
    var _a, _b, _c, _d, _e;
    const events = run.events;
    const first = events.find((e) => e.type === "run.started") || events[0];
    const last = [...events].reverse().find((e) => e.type === "run.completed" || e.type === "run.failed" || e.type === "run.cancelled");
    const started = ms(first == null ? void 0 : first.time);
    const ended = last ? ms(last.time) : null;
    const status = !last ? "in_progress" : last.type === "run.completed" ? "completed" : last.type === "run.failed" ? "failed" : "cancelled";
    let work = 0;
    let clean = status === "completed";
    for (const e of events) {
      if (e.type === "activity.completed" || e.type === "activity.failed") work += Number((_a = e.data) == null ? void 0 : _a.duration_ms) || 0;
      if (e.type === "activity.failed" || e.type === "activity.retry_scheduled" || e.type === "activity.dead_lettered" || e.type === "activity.compensated") clean = false;
    }
    return {
      run,
      started,
      ended,
      status,
      lead: ended === null ? null : Math.max(0, ended - started),
      work,
      clean,
      cost: Number((_b = last == null ? void 0 : last.data) == null ? void 0 : _b.cost) || 0,
      currency: ((_c = last == null ? void 0 : last.data) == null ? void 0 : _c.currency) || null,
      input_tokens: Number((_d = last == null ? void 0 : last.data) == null ? void 0 : _d.input_tokens) || 0,
      output_tokens: Number((_e = last == null ? void 0 : last.data) == null ? void 0 : _e.output_tokens) || 0
    };
  }
  function workflow_measures(id, name, facts, activity_catalogue) {
    var _a, _b, _c, _d, _e, _f, _g, _h, _i, _j, _k;
    const ended = facts.filter((f) => f.status !== "in_progress");
    const by = (status) => facts.filter((f) => f.status === status).length;
    const events = facts.flatMap((f) => f.run.events);
    const of = (type) => events.filter((e) => e.type === type);
    const event_waits = [];
    let timeouts = 0;
    for (const f of facts) {
      const open = /* @__PURE__ */ new Map();
      for (const e of f.run.events) {
        const key = e.node_id || "";
        if (e.type === "event.waiting") open.set(key, ms(e.time));
        else if (e.type === "event.received" && open.has(key)) {
          event_waits.push(ms(e.time) - open.get(key));
          open.delete(key);
        } else if (e.type === "event.timed_out" && open.has(key)) {
          timeouts++;
          open.delete(key);
        }
      }
    }
    const human_waits = of("token.resumed").map((e) => {
      var _a2;
      return Number((_a2 = e.data) == null ? void 0 : _a2.waited_ms);
    }).filter((v) => Number.isFinite(v));
    const done = of("activity.completed");
    const automated = done.filter((e) => {
      var _a2, _b2;
      return (((_a2 = e.data) == null ? void 0 : _a2.actor_type) || ((_b2 = activity_catalogue.get(e.node_id || "")) == null ? void 0 : _b2.actor_type)) !== "human";
    }).length;
    const tool_done = of("tool.completed").length, tool_failed = of("tool.failed").length;
    const contracts = of("contract.checked"), verifications = of("verification.completed"), decisions = of("decision.evaluated");
    const lead_sum = ended.reduce((a, f) => a + (f.lead || 0), 0), work_sum = ended.reduce((a, f) => a + f.work, 0);
    const cost = ended.reduce((a, f) => a + f.cost, 0);
    const measures = {
      "workflow.runs": count(facts.length),
      "workflow.in_progress": count(by("in_progress")),
      "workflow.success_rate": ratio(by("completed"), ended.length),
      "workflow.failure_rate": ratio(by("failed"), ended.length),
      "workflow.cancel_rate": ratio(by("cancelled"), ended.length),
      "workflow.first_pass_yield": ratio(ended.filter((f) => f.clean).length, ended.length),
      "workflow.lead_time_median_ms": median(ended.map((f) => f.lead)),
      "workflow.lead_time_p90_ms": percentile(ended.map((f) => f.lead), 0.9),
      "workflow.process_time_median_ms": median(ended.map((f) => f.work)),
      "workflow.flow_efficiency": { value: lead_sum ? Math.min(1, work_sum / lead_sum) : null, n: ended.length },
      "workflow.event_wait_median_ms": median(event_waits),
      "workflow.event_timeout_rate": ratio(timeouts, event_waits.length + timeouts),
      "workflow.human_wait_median_ms": median(human_waits),
      "workflow.automation_rate": ratio(automated, done.length),
      "workflow.retries": count(of("activity.retry_scheduled").length),
      "workflow.dead_letters": count(of("activity.dead_lettered").length),
      "workflow.compensations": count(of("activity.compensated").length),
      "workflow.tool_calls": count(of("tool.invoked").length),
      "workflow.tool_failure_rate": ratio(tool_failed, tool_done + tool_failed),
      "workflow.contract_pass_rate": ratio(contracts.filter((e) => {
        var _a2;
        return ((_a2 = e.data) == null ? void 0 : _a2.passed) === true;
      }).length, contracts.length),
      "workflow.verification_pass_rate": ratio(verifications.filter((e) => {
        var _a2;
        return ((_a2 = e.data) == null ? void 0 : _a2.verdict) === "pass";
      }).length, verifications.length),
      "workflow.decisions": count(decisions.length),
      "workflow.decision_default_rate": ratio(decisions.filter((e) => {
        var _a2, _b2;
        return ((_a2 = e.data) == null ? void 0 : _a2.used_default) === true || ((_b2 = e.data) == null ? void 0 : _b2.method) === "default";
      }).length, decisions.length),
      "workflow.model_decision_share": ratio(decisions.filter((e) => {
        var _a2;
        return ((_a2 = e.data) == null ? void 0 : _a2.method) === "model";
      }).length, decisions.length),
      "workflow.input_tokens": total(ended.reduce((a, f) => a + f.input_tokens, 0), ended.length),
      "workflow.output_tokens": total(ended.reduce((a, f) => a + f.output_tokens, 0), ended.length),
      "workflow.cost": total(cost, ended.length),
      "workflow.cost_per_run": { value: ended.length ? cost / ended.length : null, n: ended.length }
    };
    const activities = /* @__PURE__ */ new Map();
    const activity = (e) => {
      var _a2, _b2, _c2;
      const key = e.node_id || e.node_name || "";
      if (!activities.has(key)) activities.set(key, { name: e.node_name || ((_a2 = activity_catalogue.get(key)) == null ? void 0 : _a2.name) || key, actor_type: (_b2 = activity_catalogue.get(key)) == null ? void 0 : _b2.actor_type, attempts: 0, failed: 0, ended: 0, durations: [], tokens: 0 });
      const a = activities.get(key);
      if ((_c2 = e.data) == null ? void 0 : _c2.actor_type) a.actor_type = e.data.actor_type;
      return a;
    };
    for (const e of events) {
      if (e.type === "activity.started") activity(e).attempts++;
      else if (e.type === "activity.failed") {
        const a = activity(e);
        a.failed++;
        a.ended++;
      } else if (e.type === "activity.completed") {
        const a = activity(e);
        a.ended++;
        if (Number.isFinite(Number((_a = e.data) == null ? void 0 : _a.duration_ms))) a.durations.push(Number(e.data.duration_ms));
        a.tokens += (Number((_c = (_b = e.data) == null ? void 0 : _b.usage) == null ? void 0 : _c.input_tokens) || 0) + (Number((_e = (_d = e.data) == null ? void 0 : _d.usage) == null ? void 0 : _e.output_tokens) || 0);
      }
    }
    const decision_nodes = /* @__PURE__ */ new Map();
    for (const e of decisions) {
      const key = e.node_id || e.node_name || "";
      if (!decision_nodes.has(key)) decision_nodes.set(key, { node_id: key, name: e.node_name || key, evaluations: 0, table: 0, model: 0, engine: 0, default: 0, none: 0 });
      const d = decision_nodes.get(key);
      d.evaluations++;
      const method = ((_f = e.data) == null ? void 0 : _f.used_default) === true ? "default" : String(((_g = e.data) == null ? void 0 : _g.method) || "none");
      if (method === "table" || method === "model" || method === "engine" || method === "default" || method === "none") d[method]++;
    }
    const tools = /* @__PURE__ */ new Map();
    for (const e of events) {
      if (e.type !== "tool.invoked" && e.type !== "tool.completed" && e.type !== "tool.failed") continue;
      const key = String(((_h = e.data) == null ? void 0 : _h.tool) || "unnamed");
      if (!tools.has(key)) tools.set(key, { calls: 0, failures: 0, durations: [] });
      const t = tools.get(key);
      if (e.type === "tool.invoked") t.calls++;
      else if (e.type === "tool.failed") t.failures++;
      else if (Number.isFinite(Number((_i = e.data) == null ? void 0 : _i.duration_ms))) t.durations.push(Number(e.data.duration_ms));
    }
    const errors = /* @__PURE__ */ new Map();
    for (const e of of("activity.failed")) bump(errors, String(((_k = (_j = e.data) == null ? void 0 : _j.error) == null ? void 0 : _k.code) || "UNKNOWN"));
    return {
      workflow_id: id,
      name,
      measures,
      activities: [...activities.entries()].map(([activity_id, a]) => ({
        activity_id,
        name: a.name,
        ...a.actor_type ? { actor_type: a.actor_type } : {},
        measures: {
          "activity.attempts": count(a.attempts),
          "activity.failure_rate": ratio(a.failed, a.ended),
          "activity.duration_median_ms": median(a.durations),
          "activity.tokens": total(a.tokens, a.durations.length)
        }
      })),
      decisions: [...decision_nodes.values()],
      tools: [...tools.entries()].map(([tool, t]) => ({ tool, calls: t.calls, failures: t.failures, duration_median_ms: median(t.durations).value })).sort((a, b) => b.calls - a.calls),
      errors: [...errors.entries()].map(([code, n]) => ({ code, count: n })).sort((a, b) => b.count - a.count)
    };
  }
  function journey_measures(definition, rows, facts_of) {
    const instances = rows.map((r) => r.instance);
    const started = instances.length;
    const completed = instances.filter((i) => i.status === "completed");
    const ended = instances.filter((i) => i.status === "completed" || i.status === "abandoned");
    const events = instances.flatMap((i) => i.events || []);
    const goals = definition.goals || [];
    const durations = completed.filter((i) => i.ended_at).map((i) => ms(i.ended_at) - ms(i.started_at));
    const follows_mood = !!definition.sentiment;
    const first_mood = (i) => {
      var _a, _b, _c, _d;
      const start = (_b = (_a = (i.events || []).find((e) => e.type === "journey.started")) == null ? void 0 : _a.data) == null ? void 0 : _b.sentiment;
      return typeof start === "number" ? start : (_d = (_c = definition.sentiment) == null ? void 0 : _c.initial) != null ? _d : 0;
    };
    const mooded = follows_mood ? ended.filter((i) => typeof i.sentiment === "number") : [];
    const changes = events.filter((e) => e.type === "journey.sentiment_changed");
    const runs = rows.flatMap((r) => r.runs).map(facts_of);
    const ended_runs = runs.filter((f) => f.status !== "in_progress");
    return {
      "journey.started": count(started),
      "journey.active": count(instances.filter((i) => i.status === "active").length),
      "journey.completion_rate": ratio(completed.length, started),
      "journey.abandonment_rate": ratio(instances.filter((i) => i.status === "abandoned").length, started),
      "journey.stall_rate": ratio(instances.filter((i) => (i.events || []).some((e) => e.type === "journey.stalled")).length, started),
      "journey.stalled_now": count(instances.filter((i) => i.status === "active" && i.stalled).length),
      "journey.goal_attainment": goals.length ? ratio(instances.filter((i) => goals.every((g) => (i.goals_reached || []).includes(g.id))).length, started) : { value: null, n: 0 },
      "journey.duration_median_ms": median(durations),
      "journey.duration_p90_ms": percentile(durations, 0.9),
      "journey.mood_end": mean(mooded.map((i) => i.sentiment)),
      "journey.mood_change": mean(mooded.map((i) => i.sentiment - first_mood(i))),
      "journey.mood_measured_share": ratio(changes.filter((e) => {
        var _a;
        return ((_a = e.data) == null ? void 0 : _a.basis) === "measured";
      }).length, changes.length),
      "journey.touchpoints_per_journey": { value: started ? events.filter((e) => e.type === "journey.touchpoint").length / started : null, n: started },
      "journey.runs_per_journey": { value: started ? runs.length / started : null, n: started },
      "journey.cost_per_journey": { value: started && ended_runs.length ? ended_runs.reduce((a, f) => a + f.cost, 0) / started : null, n: started }
    };
  }
  function stage_measures(definition, instances) {
    return definition.stages.map((stage) => {
      const visits = instances.flatMap((i) => (i.stage_history || []).filter((h) => h.stage_id === stage.id).map((h) => ({ i, h })));
      const entered = new Set(visits.map((v) => v.i.id)).size;
      const here = instances.filter((i) => i.stage_id === stage.id);
      const done = visits.filter((v) => v.h.left_at && !(v.i.status === "abandoned" && v.i.stage_id === stage.id && v.h === v.i.stage_history[v.i.stage_history.length - 1]));
      const stalled = instances.filter((i) => (i.events || []).some((e) => e.type === "journey.stalled" && e.stage_id === stage.id)).length;
      return {
        stage_id: stage.id,
        name: stage.name,
        ...stage.owner ? { owner: stage.owner } : {},
        ...stage.max_duration ? { max_duration: stage.max_duration } : {},
        measures: {
          "stage.entered": count(entered),
          "stage.conversion": ratio(new Set(done.map((v) => v.i.id)).size, entered),
          "stage.duration_median_ms": median(done.map((v) => ms(v.h.left_at) - ms(v.h.entered_at))),
          "stage.breach_rate": ratio(stalled, entered),
          "stage.active": count(here.filter((i) => i.status === "active").length),
          "stage.stalled_now": count(here.filter((i) => i.status === "active" && i.stalled).length),
          "stage.abandoned": count(here.filter((i) => i.status === "abandoned").length)
        }
      };
    });
  }
  var DAY = 864e5;
  function bucket_start(time, bucket) {
    const d = new Date(time);
    if (bucket === "month") return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1);
    const day = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
    return bucket === "day" ? day : day - (d.getUTCDay() + 6) % 7 * DAY;
  }
  function next_bucket(start, bucket) {
    if (bucket === "day") return start + DAY;
    if (bucket === "week") return start + 7 * DAY;
    const d = new Date(start);
    return Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1);
  }
  function compute_measures(input, options = {}) {
    var _a;
    const from = options.from ? ms(options.from) : -Infinity, to = options.to ? ms(options.to) : Infinity;
    const within = (iso) => {
      const t = ms(iso);
      return Number.isNaN(t) ? from === -Infinity && to === Infinity : t >= from && t < to;
    };
    const keep_workflow = (id) => !options.workflow_id || options.workflow_id === id;
    const journeys = (input.journeys || []).filter((j) => !options.journey_id || j.definition.id === options.journey_id).map((j) => ({ definition: j.definition, rows: j.instances.filter((r) => within(r.instance.started_at)) }));
    const cache = /* @__PURE__ */ new Map();
    const facts_of = (run) => {
      if (!cache.has(run)) cache.set(run, run_facts(run));
      return cache.get(run);
    };
    const journey_runs = journeys.flatMap((j) => j.rows.flatMap((r) => r.runs));
    const loose_runs = options.journey_id ? [] : (input.runs || []).filter((r) => {
      var _a2;
      return within((_a2 = r.events.find((e) => e.type === "run.started") || r.events[0]) == null ? void 0 : _a2.time);
    });
    const all_runs = [...journey_runs, ...loose_runs].filter((r) => keep_workflow(r.workflow_id));
    const names = new Map((input.workflows || []).map((w) => [w.id, w.name]));
    const catalogue = /* @__PURE__ */ new Map();
    for (const w of input.workflows || []) for (const a of w.activities || []) catalogue.set(a.id, { name: a.name, actor_type: a.actor_type });
    const by_workflow = /* @__PURE__ */ new Map();
    for (const run of all_runs) {
      if (!by_workflow.has(run.workflow_id)) by_workflow.set(run.workflow_id, []);
      by_workflow.get(run.workflow_id).push(facts_of(run));
    }
    const workflow_name = (id, facts) => {
      var _a2, _b, _c;
      return names.get(id) || ((_c = (_b = (_a2 = facts[0]) == null ? void 0 : _a2.run.events.find((e) => e.type === "run.started")) == null ? void 0 : _b.data) == null ? void 0 : _c.workflow_name) || id;
    };
    const workflows = [...by_workflow.entries()].map(([id, facts]) => workflow_measures(id, workflow_name(id, facts), facts, catalogue));
    const journey_names = new Map((input.journeys || []).map((j) => [j.definition.id, j.definition.name]));
    const journey_reports = journeys.map(({ definition, rows }) => {
      var _a2, _b, _c, _d, _e, _f, _g;
      const instances2 = rows.map((r) => r.instance);
      const events = instances2.flatMap((i) => i.events || []);
      const channels = /* @__PURE__ */ new Map();
      const technologies = /* @__PURE__ */ new Map(), artefacts = /* @__PURE__ */ new Map();
      for (const e of events) {
        if (e.type !== "journey.touchpoint") continue;
        const channel = String(((_a2 = e.data) == null ? void 0 : _a2.channel) || "unnamed");
        if (!channels.has(channel)) channels.set(channel, { touchpoints: 0, inbound: 0, outbound: 0 });
        const c = channels.get(channel);
        c.touchpoints++;
        if (((_b = e.data) == null ? void 0 : _b.direction) === "inbound") c.inbound++;
        else if (((_c = e.data) == null ? void 0 : _c.direction) === "outbound") c.outbound++;
        if ((_d = e.data) == null ? void 0 : _d.technology) bump(technologies, String(e.data.technology));
        for (const a of ((_e = e.data) == null ? void 0 : _e.artefacts) || []) bump(artefacts, String(a.kind || a.name || "unnamed"));
      }
      const changes = events.filter((e) => e.type === "journey.sentiment_changed");
      const spread = /* @__PURE__ */ new Map();
      for (const i of instances2) if ((i.status === "completed" || i.status === "abandoned") && typeof i.sentiment === "number") spread.set(i.sentiment, (spread.get(i.sentiment) || 0) + 1);
      const goals = definition.goals || [];
      return {
        journey_id: definition.id,
        name: definition.name,
        measures: journey_measures(definition, rows, facts_of),
        goals: goals.map((g) => {
          const reached = instances2.filter((i) => (i.goals_reached || []).includes(g.id)).length;
          return { goal_id: g.id, name: g.name, reached, rate: instances2.length ? reached / instances2.length : null };
        }),
        stages: stage_measures(definition, instances2),
        channels: [...channels.entries()].map(([channel, c]) => ({ channel, ...c })).sort((a, b) => b.touchpoints - a.touchpoints),
        technologies: [...technologies.entries()].map(([technology, n]) => ({ technology, touchpoints: n })).sort((a, b) => b.touchpoints - a.touchpoints),
        artefacts: [...artefacts.entries()].map(([kind, n]) => ({ kind, count: n })).sort((a, b) => b.count - a.count),
        ...definition.sentiment ? {
          mood: {
            min: (_f = definition.sentiment.min) != null ? _f : -2,
            max: (_g = definition.sentiment.max) != null ? _g : 2,
            ended: [...spread.entries()].map(([value, n]) => ({ value, count: n })).sort((a, b) => a.value - b.value),
            measured_changes: changes.filter((e) => {
              var _a3;
              return ((_a3 = e.data) == null ? void 0 : _a3.basis) === "measured";
            }).length,
            inferred_changes: changes.filter((e) => {
              var _a3;
              return ((_a3 = e.data) == null ? void 0 : _a3.basis) !== "measured";
            }).length
          }
        } : {},
        leads_to: (input.transitions || []).filter((t) => t.from === definition.id).map((t) => ({ journey_id: t.to, name: journey_names.get(t.to) || t.to, count: t.count }))
      };
    });
    const every_row = journeys.flatMap((j) => j.rows);
    const all = journeys.length ? journey_measures({ id: "", name: "", stages: [], goals: [], sentiment: journeys.some((j) => j.definition.sentiment) ? {} : void 0 }, every_row, facts_of) : {};
    if (journeys.length) {
      const with_goals = journeys.filter((j) => (j.definition.goals || []).length);
      const reached = with_goals.reduce((a, j) => a + j.rows.filter((r) => j.definition.goals.every((g) => (r.instance.goals_reached || []).includes(g.id))).length, 0);
      all["journey.goal_attainment"] = ratio(reached, with_goals.reduce((a, j) => a + j.rows.length, 0));
      const moods = journeys.filter((j) => j.definition.sentiment).flatMap((j) => j.rows.map((r) => r.instance).filter((i) => (i.status === "completed" || i.status === "abandoned") && typeof i.sentiment === "number").map((i) => {
        var _a2, _b, _c;
        const start = (_b = (_a2 = (i.events || []).find((e) => e.type === "journey.started")) == null ? void 0 : _a2.data) == null ? void 0 : _b.sentiment;
        return { end: i.sentiment, change: i.sentiment - (typeof start === "number" ? start : (_c = j.definition.sentiment.initial) != null ? _c : 0) };
      }));
      all["journey.mood_end"] = mean(moods.map((m) => m.end));
      all["journey.mood_change"] = mean(moods.map((m) => m.change));
    }
    const every_run = workflow_measures("", "", all_runs.map(facts_of), catalogue).measures;
    const as_of = input.as_of || (/* @__PURE__ */ new Date()).toISOString();
    const attention = journeys.flatMap(({ definition, rows }) => rows.filter((r) => r.instance.status === "active" && r.instance.stalled).map((r) => {
      var _a2, _b;
      const i = r.instance;
      const stage = definition.stages.find((s) => s.id === i.stage_id);
      const stall = [...i.events || []].reverse().find((e) => e.type === "journey.stalled");
      const since = i.stage_entered_at || (stall == null ? void 0 : stall.time) || i.started_at;
      return {
        journey_id: definition.id,
        journey_name: definition.name,
        instance_id: i.id,
        subject_key: i.subject_key,
        ...r.subject_name ? { subject_name: r.subject_name } : {},
        stage_id: i.stage_id,
        stage_name: (stage == null ? void 0 : stage.name) || i.stage_id,
        ...(stage == null ? void 0 : stage.owner) ? { owner: stage.owner } : {},
        since,
        waiting_ms: Math.max(0, ms(as_of) - ms(since)),
        reason: ((_a2 = stall == null ? void 0 : stall.data) == null ? void 0 : _a2.reason) || (((_b = stall == null ? void 0 : stall.data) == null ? void 0 : _b.max_duration) ? `longer in the stage than the ${stall.data.max_duration} it is given` : "stalled")
      };
    })).sort((a, b) => b.waiting_ms - a.waiting_ms);
    const instances = every_row.map((r) => r.instance);
    const run_list = all_runs.map(facts_of);
    const times = [...instances.flatMap((i) => [ms(i.started_at), ms(i.ended_at)]), ...run_list.flatMap((f) => {
      var _a2;
      return [f.started, (_a2 = f.ended) != null ? _a2 : NaN];
    })].filter((t) => Number.isFinite(t));
    const first = times.length ? Math.min(...times) : NaN, last = times.length ? Math.max(...times) : NaN;
    const span = last - first;
    const bucket = !(span > 45 * DAY) ? "day" : span > 400 * DAY ? "month" : "week";
    const points = [];
    if (times.length) {
      const index = /* @__PURE__ */ new Map();
      for (let t = bucket_start(first, bucket); t <= last; t = next_bucket(t, bucket)) index.set(t, { start: new Date(t).toISOString(), journeys_started: 0, journeys_completed: 0, journeys_abandoned: 0, runs_ended: 0, runs_failed: 0, cost: 0, mood: null, moods: [] });
      const at = (t) => index.get(bucket_start(t, bucket));
      for (const i of instances) {
        const s = at(ms(i.started_at));
        if (s) s.journeys_started++;
        if (!i.ended_at) continue;
        const e = at(ms(i.ended_at));
        if (!e) continue;
        if (i.status === "completed") e.journeys_completed++;
        else if (i.status === "abandoned") e.journeys_abandoned++;
        if (typeof i.sentiment === "number") e.moods.push(i.sentiment);
      }
      for (const f of run_list) {
        if (f.ended === null) continue;
        const e = at(f.ended);
        if (!e) continue;
        e.runs_ended++;
        if (f.status === "failed") e.runs_failed++;
        e.cost += f.cost;
      }
      for (const p of index.values()) {
        const { moods, ...point } = p;
        points.push({ ...point, mood: mean(moods).value });
      }
    }
    return {
      spec_version: "1.1",
      as_of,
      period: { from: options.from || (Number.isFinite(first) ? new Date(first).toISOString() : null), to: options.to || (Number.isFinite(last) ? new Date(last).toISOString() : null) },
      currency: ((_a = run_list.find((f) => f.currency)) == null ? void 0 : _a.currency) || null,
      totals: { ...all, ...every_run },
      journeys: journey_reports,
      workflows,
      attention,
      series: { bucket, points }
    };
  }
  function measures_to_openmetrics(report) {
    const label = (text) => String(text).replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n");
    const samples = /* @__PURE__ */ new Map();
    const add = (id, labels, measure) => {
      if (measure.value === null || !Number.isFinite(measure.value)) return;
      const name = "awa_" + id.replace(/\./g, "_");
      const text = Object.entries(labels).map(([k, v]) => `${k}="${label(v)}"`).join(",");
      if (!samples.has(id)) samples.set(id, []);
      samples.get(id).push(`${name}${text ? `{${text}}` : ""} ${measure.value}`);
    };
    for (const j of report.journeys) {
      for (const [id, m] of Object.entries(j.measures)) add(id, { journey: j.name }, m);
      for (const s of j.stages) for (const [id, m] of Object.entries(s.measures)) add(id, { journey: j.name, stage: s.name }, m);
    }
    for (const w of report.workflows) {
      for (const [id, m] of Object.entries(w.measures)) add(id, { workflow: w.name }, m);
      for (const a of w.activities) for (const [id, m] of Object.entries(a.measures)) add(id, { workflow: w.name, activity: a.name }, m);
    }
    const lines = [];
    for (const definition of MEASURES) {
      const rows = samples.get(definition.id);
      if (!rows) continue;
      const name = "awa_" + definition.id.replace(/\./g, "_");
      lines.push(`# TYPE ${name} gauge`, `# HELP ${name} ${definition.name}. ${definition.definition}`, ...rows);
    }
    lines.push("# EOF");
    return lines.join("\n") + "\n";
  }
  return __toCommonJS(kpi_exports);
})();
