#!/usr/bin/env python3
"""Writes the HTML guides in this directory from the text below, so that the six
pages share one shell and one navigation. Run: python3 docs/build-guides.py

The normative text is docs/specification.md. These guides introduce it; where
they disagree with it, the specification is right and the guide needs fixing."""
import html
import pathlib

HERE = pathlib.Path(__file__).parent
SDK, SPEC = "2.0.0", "1.1"
REPO = "https://github.com/yannickhuchard/agentic-workflow-architecture"

NAV = [
    ("Start", [("getting-started.html", "Introduction"), ("installation-guide.html", "Installation")]),
    ("Build", [("developer-guide.html", "Developer guide"), ("data-model-guide.html", "Data model")]),
    ("Design", [("abpm-guide.html", "For process owners"), ("architect-guide.html", "For architects")]),
    ("See", [("playground.html", "Playground"), ("../tools/visualization/journey.html", "Journey view"), ("../tools/visualization/dashboard.html", "Measures"), ("../tools/visualization/replay.html", "Run replay")]),
]


def code(text, lang="bash"):
    return f'<pre><code class="language-{lang}">{html.escape(text.strip())}</code></pre>'


def table(head, rows):
    cell = lambda tag, cells: "<tr>" + "".join(f"<{tag}>{c}</{tag}>" for c in cells) + "</tr>"
    return '<div style="overflow-x:auto"><table>' + cell("th", head) + "".join(cell("td", r) for r in rows) + "</table></div>"


def cards(items):
    return '<div class="card-grid">' + "".join(f'<div class="card"><h3>{t}</h3><p>{d}</p></div>' for t, d in items) + "</div>"


def page(file, title, lead, sections):
    nav = ""
    for heading, links in NAV:
        nav += f'<div class="nav-section"><div class="nav-section-title">{heading}</div><ul class="nav-links">'
        for href, label in links:
            nav += f'<li><a href="{href}" class="nav-link{" active" if href == file else ""}">{label}</a></li>'
            if href == file:
                nav += "".join(f'<li><a href="#{sid}" class="nav-link" style="padding-left:28px;font-size:0.85em">{st}</a></li>' for sid, st, _ in sections)
        nav += "</ul></div>"
    body = "".join(f'<section id="{sid}"><h2>{st}</h2>{content}</section>' for sid, st, content in sections)
    (HERE / file).write_text(f'''<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>{title} | AWA</title>
    <link rel="preconnect" href="https://fonts.googleapis.com">
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
    <link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&family=Outfit:wght@400;600;800&display=swap" rel="stylesheet">
    <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.8.0/styles/github-dark.min.css">
    <link rel="stylesheet" href="style.css">
    <style>table {{ border-collapse: collapse; width: 100%; margin: 1rem 0; font-size: 0.92em; }} th, td {{ text-align: left; vertical-align: top; padding: 8px 12px; border-bottom: 1px solid rgba(128,128,128,.25); }} th {{ font-weight: 600; }}</style>
</head>
<body>
    <button class="theme-toggle" title="Toggle theme" aria-label="Toggle theme">&#9728;</button>
    <div class="app-container">
        <aside class="sidebar">
            <div class="logo"><div class="logo-icon"></div><span>AWA</span></div>
            <div class="search-container"><input type="text" class="search-input" placeholder="Search guides..." aria-label="Search guides"></div>
            {nav}
        </aside>
        <main class="main-content">
            <header class="content-header">
                <span class="badge">Specification {SPEC} &middot; SDK {SDK}</span>
                <h1 class="hero-title">{title}</h1>
                <p class="hero-desc">{lead}</p>
            </header>
            {body}
            <section><p style="opacity:.7;font-size:.9em">The normative text is the <a href="{REPO}/blob/main/docs/specification.md">specification</a>. Where this guide and the specification disagree, the specification is right.</p></section>
        </main>
    </div>
    <script src="https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.8.0/highlight.min.js"></script>
    <script src="main.js"></script>
    <script>hljs.highlightAll();</script>
</body>
</html>
''')


spec = lambda n, text=None: f'<a href="{REPO}/blob/main/docs/specification.md">{text or f"section {n}"}</a>'

# --------------------------------------------------------------------------- getting started
page("getting-started.html", "Workflows where the outcome is fixed and the strategy is free",
     "AWA is a specification for workflows carried out by AI agents, people, robots and applications together. An agent may reach a result by different means each time, so AWA fixes what must be true of the result, records how it was reached, and refuses results it cannot verify.",
     [("what", "What AWA is", f'''
<p>Three things, kept apart on purpose:</p>
{cards([("A specification", f"Version {SPEC}. Twenty sections saying what a workflow document means and what an engine must do with it. Written with MUST and MAY."),
        ("A conformance suite", "Language-neutral cases: a workflow, scripted actors, the outcome an engine must produce. An implementation claims a level only if it passes every case at that level."),
        ("Reference implementations", f"TypeScript SDK {SDK} passes every level. The Python SDK passes every level too. Java has a data model of the 1.1 documents, without an engine.")])}
<p>The specification and the SDKs are versioned separately: the specification says what a document means, an SDK version says what its API promises.</p>'''),
      ("layers", "What it gives you", table(["Layer", "In one sentence"], [
          ["Document", "A workflow as JSON: activities, actors, roles, edges, decision tables, events."],
          ["Flow", "Sequence, conditional routing, parallel split and join, timers, compensation, cancellation."],
          ["Decisions", "Decision tables with a specified entry language and strict hit policies; a model may decide, within options the workflow lists."],
          ["Outcome contracts", "Per activity: output schema, postconditions, budgets, escalation to a person. Checked deterministically, failing closed."],
          ["Resilience", "Retry with backoff, dead letters, checkpoints, recovery in another process, idempotency keys."],
          ["Journal", "An append-only record of every run: what happened, the actor's reasoning, the engine's own decisions."],
          ["Tools", "HTTP, command, JSON-RPC, gRPC, MCP and function calls, each journalled with a link to what ran."],
          ["Agents over A2A", "An agent elsewhere, reached over the Agent2Agent protocol, can perform an activity under the same contract, verification and record; a workflow can be offered to other agents."],
          ["Business events", "Workflows publish events and wait for them, with correlation and a deadline that has its own path."],
          ["Journeys", "The life of a customer across several workflows: stages, goals, touchpoints, what changes hands, and an estimate of mood that always says whether it was measured or inferred."],
          ["Explanation", "A replay, a recipe that explains how to rebuild the workflow, and counterfactual replay: what would this run have done under another model or rule?"],
          ["Knowledge", "Strategies and failure patterns distilled from runs, reviewed by people, exported as an Open Knowledge Format bundle."],
          ["Evidence and evaluation", "A report for regulators computed from the record, every statement citing its records; evaluation datasets built from recorded runs; a candidate run in the shadow of production."]])),
      ("first-run", "A first run", f'''
<p>From a clone of the repository, with Node.js 20 or later:</p>
{code("cd sdk/typescript && npm install && npm run build")}
<p>Run an example without any API key. <code>--simulate</code> replaces models and tools; <code>--outputs</code> says what each activity returns:</p>
{code("node sdk/typescript/dist/cli/index.js run examples/claims-settlement/claims-settlement.awa.json --simulate --outputs examples/claims-settlement/simulation.json --journal run.journal.jsonl")}
<p>Then turn the journal into a document that explains how to build that workflow from scratch:</p>
{code("node sdk/typescript/dist/cli/index.js recipe examples/claims-settlement/claims-settlement.awa.json run.journal.jsonl -o RECIPE.md")}
<p>To see a run, open <a href="../tools/visualization/replay.html">the run replay</a>. To see six customers through a year of journeys, open <a href="../tools/visualization/journey.html">the journey view</a>.</p>'''),
      ("who", "Where to go next", cards([
          ("You write software", 'The <a href="developer-guide.html">developer guide</a>: engine, journal, contracts, events, journeys, tools, the HTTP interface.'),
          ("You own a process", 'The guide <a href="abpm-guide.html">for process owners</a>: what you can fix, what you can see, how to change a model safely.'),
          ("You design the system", 'The guide <a href="architect-guide.html">for architects</a>: layers, durability, conformance levels, and what AWA does not enforce.')]))])

# --------------------------------------------------------------------------- installation
page("installation-guide.html", "Installation", "What you need, how to build, and how to check that your installation behaves as the specification says.",
     [("typescript", "TypeScript SDK and the command line", f'''
<p>Node.js 20 or later.</p>
{code("git clone " + REPO + ".git\ncd agentic-workflow-architecture/sdk/typescript\nnpm install\nnpm run build")}
<p>The command line is then <code>node dist/cli/index.js</code>, or <code>awa</code> after <code>npm link</code>.</p>
<p>The package name on npm is <code>agentic-workflow-architecture</code>. Check which version is published before relying on it: what this guide describes is SDK {SDK}.</p>
{table(["Command", "What it does"], [
    ["<code>awa run</code>", "Run a workflow file; keep its journal and checkpoints"],
    ["<code>awa journey</code>", "Journeys kept in a runtime directory, or with <code>--store</code> in a PostgreSQL store several hosts share: add definitions, take in events, let time pass, list, show, export"],
    ["<code>awa measures</code>", "The measures of journeys and workflows, computed from what was recorded"],
    ["<code>awa telemetry</code>", "Recorded runs, journeys and measures as OpenTelemetry traces and metrics"],
    ["<code>awa replay</code>", "Counterfactual replay of a recorded run"],
    ["<code>awa evidence</code>", "An evidence report from journals and journey records: evidence a deployer can use, not a certification"],
    ["<code>awa eval</code>", "Build an evaluation dataset from journals, and score a candidate against it"],
    ["<code>awa recipe</code>", "Compile a workflow and a journal into a build-from-scratch recipe"],
    ["<code>awa knowledge</code>", "Distil, review and exchange knowledge from journals"],
    ["<code>awa serve</code>", "The HTTP interface"],
    ["<code>awa task</code>", "Human tasks: list, assign, complete"],
    ["<code>awa init</code>, <code>awa generate</code>", "Start a project; draft a workflow from a description"]])}'''),
      ("python", "Python SDK", f'''
<p>Python 3.10 or later.</p>
{code("cd sdk/python\npip install -e '.[dev,web]'\npytest -q")}
<p>The Python SDK passes every conformance level, as the reference does: the engine rules, tools, model routing and model decisions, journeys, measures, replay, contexts, service levels, telemetry, agents over A2A, evidence and evaluation. Install it with <code>pip install agentic-workflow-architecture</code>; the package you import is <code>awa</code>. Its built-in AI agent calls no model: supply your own actor, or an OpenAI-compatible provider. It has no recipe and no Open Knowledge Format exchange.</p>'''),
      ("models", "Model providers", f'''
<p>Activities name a capability tier (<code>tier:fast</code>, <code>tier:balanced</code>, <code>tier:reasoning</code>), not a vendor. A deployment maps each tier to providers in order of preference; when one fails the next is tried.</p>
{table(["Provider", "Needs"], [["google", "<code>GEMINI_API_KEY</code>"], ["openai", "<code>OPENAI_API_KEY</code>"], ["ollama", "A running Ollama; <code>OLLAMA_BASE_URL</code> if not on localhost"],
                                 ["embedded", "<code>npm install @huggingface/transformers</code>. A small open-source model in-process: no server, no key"]])}
{code("awa run workflow.awa.json --providers google,ollama,embedded --journal run.journal.jsonl")}
<p>Small embedded models follow a reply format well and judge poorly. Measurements are in <a href="{REPO}/blob/main/docs/embedded-models.md">embedded-models.md</a>.</p>'''),
      ("server", "The HTTP interface", f'''
{code("AWA_DATA_DIR=./.awa awa serve --port 3000 --api-key mykey:admin")}
{table(["Variable", "Effect"], [
    ["<code>AWA_DATA_DIR</code>", "Journeys, their runs and journals are kept in this directory and survive a restart. Without it they live in the process"],
    ["<code>AWA_RUNTIME_STORE</code>", "A PostgreSQL URL: journeys, runs and journals are kept in that database, and several servers may share it (also <code>--store</code>). Not to be confused with <code>AWA_DATABASE_URL</code>, the database of tasks for people"],
    ["<code>AWA_WORKFLOWS_DIR</code>", "The only directory from which <code>POST /workflows/run</code> will run a file"],
    ["<code>AWA_SIMULATE=1</code>, <code>AWA_SIMULATED_OUTPUTS</code>", "Run activities without calling models or tools"],
    ["<code>JWT_SECRET</code>", "Accept signed tokens as well as API keys"]])}
<p>The interface is described in <a href="{REPO}/blob/main/spec/openapi/awa-api.yaml">spec/openapi/awa-api.yaml</a>.</p>'''),
      ("check", "Check conformance", f'''
<p>The conformance suite is what "implements AWA" means. Run it against either SDK:</p>
{code("cd sdk/typescript && npx vitest run tests/conformance.test.ts")}
{code("cd sdk/python && pytest tests/test_conformance.py -rs")}
<p>Cases at levels an SDK does not claim are reported as skipped, never hidden.</p>''')])

# --------------------------------------------------------------------------- developer guide
page("developer-guide.html", "Developer guide", "The parts of the SDK you will use, each with the smallest example that works. Every example is TypeScript; the engine parts exist in Python under the same names in snake case.",
     [("engine", "Run a workflow", f'''
{code("""
import fs from 'fs';
import { WorkflowEngine, parse_document, FileJournalStore } from 'agentic-workflow-architecture';

const workflow = parse_document(JSON.parse(fs.readFileSync('workflow.awa.json', 'utf-8')));
const engine = new WorkflowEngine(workflow, { journal: new FileJournalStore('journals') });

await engine.start({ claim_id: 'CLM-1' });
const status = await engine.run();     // completed | failed | waiting_human | waiting_event
""", "typescript")}
<p>A run with a failed token is <code>failed</code>, never <code>completed</code>. A choice with no true condition and no default edge fails with <code>NO_ROUTE</code>: the engine does not guess.</p>'''),
      ("contracts", "Say what must be true of a result", f'''
<p>An outcome contract belongs to an activity. It is checked after every attempt, deterministically, and a result that breaks it is refused.</p>
{code("""
{ "name": "Assess damage", "actor_type": "ai_agent",
  "outcome_contract": {
    "output_schema": { "type": "object", "required": ["estimated_cost"], "properties": { "estimated_cost": { "type": "number" } } },
    "postconditions": [{ "name": "Within authority", "expression": "estimated_cost <= 50000" }],
    "budgets": { "max_tokens": 6000, "max_tool_calls": 4 },
    "on_violation": "escalate_human" },
  "retry": { "max_attempts": 3 } }
""", "json")}'''),
      ("journal", "Read what happened", f'''
<p>Every run writes a journal: one JSON object per line, numbered from 1 without gaps. Three levels: what happened (<code>execution</code>), the actor's own account of its approach (<code>reasoning</code>), and the engine's decisions, such as which model it chose (<code>meta</code>).</p>
{code("""
for (const event of await engine.getEvents()) console.log(event.seq, event.type, event.node_name);
engine.onEvent(event => { /* live */ });
""", "typescript")}'''),
      ("events", "Wait for the outside world", f'''
<p>A <code>message</code> event holds a token until a business event arrives. Give it a deadline and a path for the deadline; without that path, a timeout fails the token rather than letting the run hang or carry on as if the event had come.</p>
{code("""
{ "name": "Documents uploaded", "event_type": "message",
  "event_definition": { "name": "documents.uploaded", "correlation_key": "customer_id",
                        "timeout": "P5D", "timeout_edge_id": "<edge taken when nothing arrives>" } }
""", "json")}
{code("""
await engine.deliverEvent(business_event('documents.uploaded', { customer_id: 'c-1' }));
await engine.expireEvents();           // deadlines that have passed take effect
""", "typescript")}'''),
      ("journeys", "Journeys that outlive the process", f'''
<p>A journey is the life of one subject across several workflows. <code>AwaRuntime</code> hosts journeys and their runs behind one entry point for events, and keeps its state so that another process can carry on.</p>
{code("""
import { open_runtime_directory, business_event } from 'agentic-workflow-architecture';

const runtime = await open_runtime_directory('.awa');        // definitions, state and journals side by side
await runtime.publish(business_event('claim.submitted', { customer_id: 'c-1' }));
await runtime.tick();                                         // let deadlines pass; call on a schedule
const everything = await runtime.export_portfolio();          // what the journey view loads
""", "typescript")}
<p>The same from the command line, each command a separate process:</p>
{code("""
awa journey add intake.awa.json claim.journey.json
awa journey publish claim.submitted -d '{"customer_id":"c-1"}'
awa journey tick
awa journey list --stalled
awa journey show c-1
awa journey export -o portfolio.json
""")}
<p>A journey may also declare its touchpoints, what changes hands and how mood is estimated; see the <a href="data-model-guide.html#journeys">data model</a>. Only one process at a time may hold a runtime directory: a second is refused while the first is alive, and talks to it over HTTP instead.</p>'''),
      ("contexts", "Contexts and service levels", f'''
<p>A context is something activities share beside the data that flows along edges. An activity reaches one only through a binding, and the engine upholds it: the actor is given the contexts it is bound to read and no other, and a write needs a binding that allows it and must match the context's schema.</p>
{code("""
{{
  "contexts": [{{ "id": "...", "name": "Order", "type": "data", "sync_pattern": "shared_state", "schema": {{ "type": "object", "required": ["total"] }} }}],
  "activities": [
    {{ "name": "Receive order", "context_bindings": [{{ "context_id": "...", "access_mode": "write" }}] }},
    {{ "name": "Price order",   "context_bindings": [{{ "context_id": "...", "access_mode": "read" }}] }}
  ]
}}
""", "json")}
{code("""
// In an actor: what it was given, and what it writes
const order = inputs._contexts.Order;                      // only contexts bound for reading
return {{ priced: true, _context_writes: {{ Order: {{ ...order, total: 240 }} }} }};
""", "typescript")}
<p>A required context that nothing has written fails the activity with <code>CONTEXT_MISSING</code> before its actor is called; a write without a binding fails with <code>CONTEXT_ACCESS_DENIED</code>. <code>shared_state</code> replaces the value, <code>blackboard</code> merges into it, <code>event_sourcing</code> and <code>message_passing</code> append. In a simulation, script the writes: <code>{{"Receive order": {{"contexts": {{"Order": {{"total": 240}}}}}}}}</code>.</p>
<p>A service level (<code>sla</code> on an activity or a workflow) is compared with the time the work takes, waits and retries included. Past <code>target_time</code> the engine journals <code>sla.warning</code>, past <code>max_time</code> <code>sla.breached</code>, once each. Work that finished late stands. With <code>escalation_policy.breach_action: "fail"</code>, work still waited for fails with <code>SLA_BREACH</code>. A host checks waiting work whenever it lets time pass:</p>
{code("""
await runtime.tick();                       // event deadlines and service levels of what is waiting
await engine.checkServiceLevels();          // the same for one engine: {{ warnings, breaches, failed }}
""", "typescript")}'''),
      ("measures", "Measures", f'''
<p>Specification section 21 fixes what is measured of journeys, stages, workflows and activities, so that two implementations report the same numbers from the same record. A measure is a value and the number it was computed over; it has no value, rather than zero, when there is nothing to compute it from.</p>
{code("""
import { compute_measures, measures_to_openmetrics } from 'agentic-workflow-architecture';

const report = compute_measures(await runtime.export_portfolio(), { from: '2026-09-01T00:00:00Z' });
report.journeys[0].measures['journey.completion_rate'];     // { value: 0.5, n: 6 }
report.workflows[0].measures['workflow.first_pass_yield'];  // runs right first time
report.attention;                                           // who is stuck, where, since when, and whose it is
measures_to_openmetrics(report);                            // for a metrics system to scrape
""", "typescript")}
{code("""
awa measures                      # for people
awa measures --json               # the report
awa measures --list               # every measure with its rule
curl localhost:3000/api/v1/measures?format=openmetrics
""")}
<p>Give a stage an <code>owner</code> and a stalled journey names who must act. The <a href="../tools/visualization/dashboard.html">measures page</a> shows the report and opens any number into the customers behind it; it follows a running server with <code>?live=http://localhost:3000</code>.</p>'''),
      ("telemetry", "Telemetry", f'''
<p>Specification section 26 makes every run and journey visible in OpenTelemetry. A run is one trace: a span for the run, each attempt, each tool call, each model call (provider, model and token usage, in the generative AI semantic conventions), each decision and each wait; the rest of the journal becomes span events. A journey is one trace whose run spans link to the runs' traces. Trace and span ids are derived from the run id, so what is sent live and what is exported later from the journal are the same spans, whichever SDK produced them.</p>
{code("""
import { OtlpHttpExporter, WorkflowEngine } from 'agentic-workflow-architecture';

const exporter = new OtlpHttpExporter({ traces_url: 'http://localhost:4318/v1/traces' });
const engine = new WorkflowEngine(workflow, { telemetry: exporter });  // or { telemetry: { endpoint, headers, payloads } }
""", "typescript")}
{code("""
OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318 awa run claim.awa.json    # spans leave as the run proceeds
awa telemetry export claim.awa.json run.journal.jsonl --file run.otlp.json  # a recorded run, as OTLP/JSON
""")}
<p>Telemetry never holds up or fails a run: spans are sent in the background, and a backend that is down costs dropped spans, counted and reported, which the journal can send again. Inputs, outputs and tool arguments go on spans only when the deployment opts in. Measures can be sent as OpenTelemetry gauges too.</p>'''),
      ("tools", "Tools", f'''
<p>An activity lists the tools its actor may call. Every call goes through one runner, which refuses unknown tools, invalid arguments and calls over budget, applies the deployment's permissions, and journals the call with a link to what ran.</p>
{code("""
{ "name": "get_policy", "description": "Look up a policy by number",
  "parameters": { "type": "object", "required": ["number"], "properties": { "number": { "type": "string" } } },
  "binding": { "kind": "http", "url": "https://policies.example/api/policies/{number}" } }
""", "json")}
<p>Command bindings do not run unless the deployment allows commands. The default is to allow none.</p>
<p>The engine reaches MCP servers and gRPC services itself. An <code>mcp</code> binding names a server the deployment declares, a program (held to the same permission as commands) or a Streamable HTTP address; a <code>grpc</code> binding makes one unary call, described by the deployment's <code>.proto</code> files or by server reflection, over TLS unless the deployment allows plaintext for the host. Connections are kept for the run and closed when it ends.</p>
{code("""
awa run workflow.awa.json --deployment deployment.json
""")}
<p>An activity can also be performed by an agent reached over the Agent2Agent protocol (A2A 1.0): name its agent card in the role's or the activity's <code>a2a</code>. The engine sends the activity and its data as a message, follows the task, and holds the reply to the outcome contract like any actor's; an agent that asks for input makes the run wait for the host's answer. <code>awa serve --a2a workflow.awa.json</code> offers a workflow to other agents.</p>'''),
      ("replay", "Change a model without guessing", f'''
<p>Counterfactual replay runs a recorded run again with something changed, holding everything else as it was recorded: the input, what applications and people returned, tool results, events and time.</p>
{code("awa replay workflow.awa.json run.journal.jsonl --candidate changed.awa.json --ai recorded")}
<p>It exits with status 2 on a regression, so a folder of recorded journals is a regression suite for a change of model, prompt, contract or rule. A step the baseline never performed is reported as unrecorded; nothing is invented and no real call is made.</p>'''),
      ("evaluation", "Evaluate a candidate on recorded work", f'''
<p>Every visit to an AI activity is a labelled example: what the agent was given, and the outcome its contract, its verification or a person accepted, or what rejected it. Build a dataset from journals and score a candidate model or workflow against it, per activity:</p>
{code("awa eval build runs/*.jsonl -o dataset.jsonl\nawa eval run workflow.awa.json dataset.jsonl --candidate changed.awa.json --providers ollama")}
<p>The tools the candidate calls answer as they did when the case was recorded. The command exits with status 2 when the candidate loses a case the recording had accepted. A host can also run a candidate in the <em>shadow</em> of production: each run that ends is replayed under the candidate, nothing it does reaches the outside world, and the host reports where the two part.</p>'''),
      ("evidence", "Evidence for regulators", f'''
<p>An evidence report gathers, for a period and a set of workflows, what ran, which models decided what, every human decision and escalation, every contract and verification result, refusals, failures, compensations, tool calls by target, how data was journalled, and the records held. Every statement cites the journal records it rests on, and each part names the EU AI Act articles, NIST AI RMF functions and ISO/IEC 42001 clauses it can serve.</p>
{code("awa evidence .awa --from 2026-09-01 --to 2026-10-01 --format html -o evidence.html")}
<p>It is evidence a deployer can use. It is not a certification of compliance, and it says so.</p>'''),
      ("http", "Over HTTP", table(["Request", "Does"], [
          ["<code>POST /api/v1/workflows/run</code>", "Run a workflow file"],
          ["<code>GET /api/v1/workflows/runs/{id}/events</code>", "The journal of a run; <code>/events/stream</code> for Server-Sent Events"],
          ["<code>POST /api/v1/journeys/definitions</code>", "Register a workflow or a journey"],
          ["<code>POST /api/v1/journeys/events</code>", "Take in a business event (CloudEvents 1.0). The same id twice has no further effect"],
          ["<code>POST /api/v1/journeys/tick</code>", "Let time pass"],
          ["<code>GET /api/v1/journeys/instances</code>", "Journey instances; <code>?stalled=true</code> for those that need someone to act"],
          ["<code>GET /api/v1/journeys/portfolio</code>", "Everything recorded, as the journey view loads it"],
          ["<code>GET /api/v1/evidence</code>", "The evidence report of what was recorded; <code>?format=md</code> or <code>html</code> for a document"]]))])

# --------------------------------------------------------------------------- data model
page("data-model-guide.html", "Data model", "The things AWA names, what each is for, and where each is defined. The JSON Schemas in spec/json-schema are normative; OpenAPI, GraphQL, Avro and the PostgreSQL DDL are projections of them.",
     [("workflow", "Workflow", table(["Thing", "What it is"], [
         ["Workflow", "Activities, edges, decision nodes, events and roles, with an <code>awa_version</code>"],
         ["Activity", "One unit of work, performed by one kind of actor: <code>human</code>, <code>ai_agent</code>, <code>robot</code> or <code>application</code>"],
         ["Edge", "Where a token may go next. With a <code>condition</code> it is a choice; several edges without one are a parallel split"],
         ["Decision node", "A choice made by a decision table, an external rule engine, a model within listed options, or a table first and a model for what no rule covers"],
         ["Event", "<code>start</code>, <code>end</code>, <code>timer</code>, and <code>message</code> or <code>signal</code>, which publish a business event or wait for one"],
         ["Role", "Who performs activities; for an AI role, which model, named by capability tier"]])),
      ("activity", "What an activity can carry", table(["Property", "Purpose"], [
          ["<code>outcome_contract</code>", "What must be true of the result: schema, postconditions, budgets, what to do on a violation"],
          ["<code>verification</code>", "Acceptance criteria judged by schema, by a model or by a custom check; fails closed"],
          ["<code>retry</code>", "How often and how patiently to try again"],
          ["<code>compensation</code>", "The activity that undoes this one if the run later fails or is cancelled"],
          ["<code>tools</code>", "The tools the actor may call, each with a binding"],
          ["<code>knowledge</code>", "Whether reviewed knowledge from earlier runs is given to the actor"],
          ["<code>join</code>", "<code>all</code> to wait for every incoming branch"]])),
      ("run", "Run", table(["Thing", "What it is"], [
          ["Run", "One execution of a workflow. Status: <code>running</code>, <code>waiting_human</code>, <code>waiting_event</code>, <code>completed</code>, <code>failed</code>, <code>cancelled</code>"],
          ["Token", "A position in the run. A parallel split makes more; a join merges them"],
          ["Journal event", "One entry in the run's append-only record. Schema: <code>journal-event.schema.json</code>"],
          ["Checkpoint", "The state from which another process can continue the run"]])),
      ("journeys", "Journey", f'''{table(["Thing", "What it is"], [
          ["Business event", "A statement that something happened, in CloudEvents 1.0 form. Its <code>type</code> is the name workflows and journeys refer to"],
          ["Journey", "Stages a subject passes through, the workflows that serve each, triggers, goals and exits"],
          ["Journey instance", "One subject on one journey, with its record. Joined to its runs by <code>run_id</code> and to the subject's other journeys by the subject key"],
          ["Artefact", "A kind of thing that changes hands, as the business names it: contract, attestation, invoice, receipt, certificate. A business concept, not a file format"],
          ["Touchpoint", "A moment of contact: party, direction, channel, technology, and the artefacts exchanged. Realised by an event, an activity or a tool call"],
          ["Mood", "An estimate that changes only by declared rules. Every change is recorded as <code>measured</code> (the subject said so) or <code>inferred</code> (the authors assumed so)"]])}
{code("""
"artefacts":   [{ "id": "insurance-contract", "name": "Insurance contract", "kind": "contract" }],
"touchpoints": [{ "id": "contract-signed", "name": "Signs the contract", "direction": "inbound", "channel": "web",
                  "technology": "E-signature service", "on": { "event": "contract.signed" },
                  "exchanges": [{ "artefact": "insurance-contract", "reference": "contract_id" }] }],
"sentiment":   { "rules": [{ "on": "waited", "longer_than": "P2D", "change": -1, "reason": "waited more than two days" },
                           { "on": "event", "event": "survey.answered", "measure": { "path": "satisfaction", "from": [1, 5] } }] }
""", "json")}'''),
      ("formats", "Formats", table(["Format", "File", "Status"], [
          ["JSON Schema", "<code>spec/json-schema/</code>", "Normative"],
          ["OpenAPI 3.1", "<code>spec/openapi/awa-api.yaml</code>", "Describes the reference HTTP interface"],
          ["GraphQL", "<code>spec/graphql/awa.graphql</code>", "Informative"],
          ["Avro", "<code>spec/avro/</code>", "Informative; for journals and events on a stream"],
          ["PostgreSQL DDL", "<code>spec/ddl/awa.postgresql.sql</code>", "Informative; loads into PostgreSQL 16"]]))])

# --------------------------------------------------------------------------- process owners
page("abpm-guide.html", "For process owners", "What changes when part of your process is done by an AI agent, what you can still fix, and what you can see.",
     [("principle", "Fix the outcome, free the strategy", '''
<p>A person follows a procedure. A program follows it exactly. An AI agent reaches the result its own way, and not the same way twice. Writing a longer procedure does not change that.</p>
<p>So AWA asks you for something else: say what must be true of the result. The estimate is a number. It is within the adjuster's authority. Every damaged part is priced. The agent is then free in how it gets there, and a result that does not meet what you said is refused, retried, or handed to a person. You decide which.</p>'''),
      ("decide", "Decisions you can read", '''
<p>Routine cases are decided by a table you can read and sign off: rows of conditions, one outcome each, and a declared policy for what happens when two rows match. The cases no row covers can go to a model, which may only choose among options you listed. If its answer is not one of them, or it is not confident enough, the case takes the default path. The engine never invents a route.</p>'''),
      ("journeys", "The customer's journey, not just your process", '''
<p>A customer does not experience a process. They experience a year: they buy, they claim, they renew. A journey in AWA is that year, made of stages with a time allowed for each, goals, and the ways a customer can leave.</p>
<p>It records where the customer and your organisation meet, over which channel and system, and what changed hands: the contract, the invoice, the receipt, the certificate. It also carries an estimate of how the customer feels. That estimate is the one thing here that could mislead, so every point on it says whether the customer told you (a survey answer) or whether a rule of yours assumed it (a long wait is felt). A view of a journey has to show the difference.</p>
<p>Why look at several journeys at once: in the example, a claim is paid in full and its journey completes. The three-day wait in the middle shows up five months later, in another journey, as a policy that is not renewed.</p>
<p><a href="../tools/visualization/journey.html">Open the journey view.</a></p>'''),
      ("stalled", "Knowing who is stuck", '''
<p>A stage that lasts longer than you allowed is marked stalled. So is a stage whose workflow failed. A stalled journey is not a failed one: it is a customer nobody is working for, and a reason for a person to look. <code>awa journey list --stalled</code> lists them.</p>'''),
      ("change", "Changing a model or a rule", '''
<p>Before you change a model, a prompt, a contract or a decision rule, replay your recorded runs under the change. Everything else is held as it was recorded. You get, per run and per step: the same, changed, improved, regressed. A run that used to complete and no longer does is a regression, and the command says so with its exit status.</p>'''),
      ("waste", "Where the time goes", '''
<p>The engine measures process time, waiting time and lead time per step, and classifies waste by the DOWNTIME categories. In a journey most of the time is waiting, and most of that is waiting for the customer or for a person: the view states those gaps in words rather than drawing them to scale.</p>''')])

# --------------------------------------------------------------------------- architects
page("architect-guide.html", "For architects", "How AWA is put together, what it guarantees, and what it leaves to you.",
     [("layers", "Engine and host", '''
<p>An <strong>engine</strong> runs one workflow run. It never opens a connection to a broker and never watches the clock: it is told when an event has arrived and when a deadline has passed. A <strong>host</strong> runs engines, receives business events from wherever they come, hands them to the runs that wait, and moves journeys. A run that waits two weeks costs nothing while it waits.</p>
<p>This separation is deliberate. It is what lets the same engine sit behind a command line, an HTTP server or a scheduled job, and it is the seam along which the engine could be reimplemented in another language without touching hosts.</p>'''),
      ("durability", "What survives a restart", table(["State", "Kept as"], [
          ["A run", "A checkpoint after every step, from which another process continues under the same run id"],
          ["A run's journal", "Append-only, one file per run, numbered without gaps across restarts"],
          ["Journeys", "Every instance with its record"],
          ["Events already accepted", "Their ids, so that redelivery has no further effect"],
          ["Events runs have published", "An outbox, accepted as soon as the publishing run settles"]]) + f'''
<p>Activities are executed at least once: a run that stopped in the middle of an activity performs it again. Each attempt carries an idempotency key so that an activity with effects can be made safe to repeat.</p>
<p>The reference host keeps all this in one of two stores. A <strong>runtime directory</strong> of files belongs to one host at a time: a second is refused while the first is alive. A <strong>PostgreSQL store</strong> is shared: any number of hosts, in any number of processes and machines, open it and take any work (section 29).</p>
<p>On a shared store each operation of a host (taking in an event, letting time pass, completing a task) is one transaction. It holds the partitions it touches, one per subject and one per run outside a journey, and others wait for them; work on different subjects goes on at once. An event's id is recorded in the same transaction, under a primary key, so no event is taken twice; rows are written back at the version read; a host that dies releases what it held when its connection drops, and one that hangs when its lease runs out, with nothing of its operation kept. The outcome is that of one host doing everything one operation at a time, and the TypeScript and Python SDKs share one store.</p>
{code("awa journey add claim.awa.json claim.journey.json --store postgres://awa@db/awa")}
{code("AWA_RUNTIME_STORE=postgres://awa@db/awa awa serve --port 3000   # on as many machines as you like")}
<p>Install the optional database client first: <code>npm install pg</code>, or <code>pip install "agentic-workflow-architecture[postgres]"</code>.</p>'''),
      ("conformance", "Conformance levels", table(["Level", "Section", "TypeScript", "Python"], [
          ["document, core, decision", "4 to 6", "yes", "yes"], ["verified, contract", "7, 11", "yes", "yes"], ["recorded, resilient", "9, 10", "yes", "yes"],
          ["routing", "12", "yes", "yes"], ["flow, events", "13, 18", "yes", "yes"], ["knowledge", "15", "yes", "yes"],
          ["model_decision, tools", "16, 17", "yes", "yes"], ["journeys, replay", "19, 20", "yes", "yes"],
          ["measures", "21", "yes", "yes"], ["contexts, service_levels", "22, 23", "yes", "yes"], ["telemetry", "26", "yes", "yes"], ["shared_store", "29", "yes, with PostgreSQL", "yes, with PostgreSQL"], ["a2a", "28", "yes", "yes"]]) + '''
<p>Each level has language-neutral cases in <code>spec/conformance</code>; both SDKs run every case of every level, none skipped. What the cases cannot reach (live model providers, Open Knowledge Format exchange, the recipe) is fixed by each SDK's own tests.</p>'''),
      ("security", "What may run", '''
<p>A workflow document can name any URL, program or agent. What actually runs is the deployment's decision: command bindings need explicit permission, and so do MCP servers the engine would start; HTTP, JSON-RPC, MCP and gRPC bindings and A2A agents can be restricted to listed hosts; an MCP binding reaches only a server the deployment declares; and secrets are substituted at call time and never journalled. The link to what ran is always journalled, even when payloads are hashed or omitted. In simulation nothing is called.</p>'''),
      ("not", "What AWA does not do", '''
<ul>
<li><strong>Access rights to external resources are declared, not enforced.</strong> The document states them and they can be queried. Context bindings (section 22) and service levels (section 23) are enforced; the permissions of tools are the deployment's (section 17.4).</li>
<li><strong>No streaming calls.</strong> gRPC tools make unary calls; an agent offered over A2A answers requests, without streaming or push notifications.</li>
<li><strong>No broker.</strong> Events enter and leave through the host. Connecting Kafka, a queue or a webhook is the host's job.</li>
<li><strong>One subject at a time.</strong> Hosts on a shared store share the work across subjects; the operations on one subject run one after another. Activities still run at least once, and the database's own replication is yours.</li>
<li><strong>Model providers have not all been exercised against live services</strong> in the reference tests; they are tested against stubs.</li>
</ul>''')])

print("wrote 6 guides")
