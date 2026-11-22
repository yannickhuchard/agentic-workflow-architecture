// Widgets: each is one self-contained HTML resource built from a view in
// tools/visualization, with the MCP Apps bridge added. Nothing in a widget
// loads from the network.
//
// To add a widget, add one entry to WIDGETS (see README.md, "Adding a widget").
import fs from 'node:fs';
import path from 'node:path';
import { PACKAGE_ROOT, VIEWS_DIR, RELEASE } from './sdk.js';

const WIDGET_SOURCES = path.join(PACKAGE_ROOT, 'src/widgets');
const NETWORK_OFF = path.join(WIDGET_SOURCES, 'network-off.js');
const inline_script = code => `<script>${code.replace(/<\/script/gi, '<\\/script')}</script>`;
const inline_style = css => `<style>${css.replace(/<\/style/gi, '<\\/style')}</style>`;

/**
 * Turn an HTML file and the local scripts it refers to into one self-contained document.
 *
 * @param options.html     path of the HTML file
 * @param options.drop     file names of <script src> to leave out (sample data, for example)
 * @param options.prelude  JavaScript files to run first, at the start of <head>. Default: the script that closes the network
 * @param options.styles   CSS files to add at the end of <head>
 * @param options.scripts  JavaScript files to add at the end of <body>, in order
 * @param options.replace  { "__TOKEN__": "value" } replaced in the added scripts
 * @returns the HTML text. Throws if anything in it would still load from somewhere else.
 */
export function bundle_widget({ html, drop = [], prelude = [NETWORK_OFF], styles = [], scripts = [], replace = {} }) {
    const directory = path.dirname(html);
    let document = fs.readFileSync(html, 'utf8');
    // Local scripts are inlined in place, so that load order is unchanged
    document = document.replace(/<script\b([^>]*)\bsrc=(["'])([^"']+)\2([^>]*)>\s*<\/script>/gi, (tag, before, quote, src) => {
        if (/^[a-z][a-z0-9+.-]*:|^\/\//i.test(src)) throw new Error(`${path.basename(html)} loads a script from ${src}: a widget must be self-contained`);
        const file = path.resolve(directory, src);
        if (!file.startsWith(directory + path.sep)) throw new Error(`${path.basename(html)} loads a script outside its directory: ${src}`);
        if (drop.includes(path.basename(file))) return '';
        return inline_script(fs.readFileSync(file, 'utf8'));
    });
    const fill = text => Object.entries({ __AWA_WIDGET_VERSION__: RELEASE, ...replace }).reduce((out, [token, value]) => out.split(token).join(String(value)), text);
    const added_styles = styles.map(file => inline_style(fs.readFileSync(file, 'utf8'))).join('');
    const added_scripts = scripts.map(file => inline_script(fill(fs.readFileSync(file, 'utf8')))).join('');
    const first = prelude.map(file => inline_script(fs.readFileSync(file, 'utf8'))).join('');
    if (!/<head(\s[^>]*)?>/i.test(document) || !/<\/head>/i.test(document) || !/<\/body>/i.test(document)) throw new Error(`${path.basename(html)} needs a <head> and a <body>`);
    document = document.replace(/<head(\s[^>]*)?>/i, tag => `${tag}${first}`).replace(/<\/head>/i, () => `${added_styles}</head>`).replace(/<\/body>(?![\s\S]*<\/body>)/i, () => `${added_scripts}</body>`);
    assert_self_contained(document, path.basename(html));
    return document;
}

/** Refuse markup that would make the browser fetch something */
export function assert_self_contained(document, name = 'widget') {
    const checks = [
        [/<script\b[^>]*\bsrc\s*=/i, 'a script loaded by address'],
        [/<link\b[^>]*\bhref\s*=/i, 'a linked resource'],
        [/<(?:img|iframe|video|audio|source|embed|object)\b[^>]*\b(?:src|data)\s*=\s*["']?(?!data:|["']?\s*\+|\$\{)[a-z/.]/i, 'an embedded resource loaded by address'],
        [/@import\b/i, 'a CSS import'],
        [/url\(\s*["']?(?:https?:)?\/\//i, 'a CSS resource loaded by address'],
    ];
    for (const [pattern, what] of checks) if (pattern.test(document)) throw new Error(`${name} is not self-contained: it has ${what}`);
}

const view = file => path.join(VIEWS_DIR, file);
const own = file => path.join(WIDGET_SOURCES, file);

/**
 * The widgets the server offers. `uri` is versioned: change the suffix when the
 * HTML changes in a way hosts must not serve from cache.
 */
export const WIDGETS = {
    journeys: {
        uri: 'ui://awa/journeys-v1.html',
        description: 'Customer journeys at four heights: all journeys, one journey on calendar time, one customer\'s journey with mood, touchpoints and what changed hands, and the workflow run behind any moment. Shows simulated or exported records; it executes nothing.',
        bundle: { html: view('journey.html'), drop: ['journey-story.js', 'journey-story-builder.js'], styles: [own('journey.css')], scripts: [own('host-bridge.js'), own('journey-bridge.js')] },
    },
    workflow: {
        uri: 'ui://awa/workflow-graph-v1.html',
        description: 'An AWA workflow as a graph: activities with their actor type and role, decisions, events and edges, with the data each activity takes in and gives out, the contexts it reads and writes, and the access it needs. A definition view; it executes nothing.',
        bundle: { html: view('replay.html'), drop: ['replay-sample.js'], styles: [own('workflow.css')], scripts: [own('host-bridge.js'), own('workflow-bridge.js')], replace: { __AWA_WIDGET_MODE__: 'workflow' } },
    },
    run: {
        uri: 'ui://awa/run-replay-v1.html',
        description: 'A simulated run of an AWA workflow replayed over its graph from the execution journal: the path taken, decisions, waits, simulated tool calls and failures, step by step. Simulation only; no tool, model or command was executed.',
        bundle: { html: view('replay.html'), drop: ['replay-sample.js'], styles: [own('workflow.css')], scripts: [own('host-bridge.js'), own('workflow-bridge.js')], replace: { __AWA_WIDGET_MODE__: 'run' } },
    },
    // DASHBOARD PLACEHOLDER --------------------------------------------------------------
    // tools/visualization/dashboard.html is not in the repository yet. When it is, add:
    //
    // dashboard: {
    //     uri: 'ui://awa/dashboard-v1.html',
    //     description: 'Key figures of journeys and runs: ...',
    //     bundle: { html: view('dashboard.html'), drop: [/* sample data scripts */], styles: [], scripts: [own('host-bridge.js'), own('dashboard-bridge.js')] },
    // },
    //
    // then write src/widgets/dashboard-bridge.js (copy journey-bridge.js: it is 40 lines) and
    // enable the show_dashboard tool marked "DASHBOARD PLACEHOLDER" in src/server.js.
    // -------------------------------------------------------------------------------------
};

const cache = new Map();
/** The HTML of a widget, bundled once per process */
export function widget_html(name) {
    if (!cache.has(name)) {
        const widget = WIDGETS[name];
        if (!widget) throw new Error(`Unknown widget "${name}"`);
        cache.set(name, bundle_widget(widget.bundle));
    }
    return cache.get(name);
}
