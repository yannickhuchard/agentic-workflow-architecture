// Connects tools/visualization/replay.html to the MCP Apps host. The same view
// serves two tools: a workflow definition (the graph and what moves through it)
// and a simulated run replayed over that graph.
(function () {
    'use strict';
    var MODE = '__AWA_WIDGET_MODE__';            // "workflow" or "run"
    var $ = function (id) { return document.getElementById(id); };
    var esc = function (v) { return String(v === undefined || v === null ? '' : v).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); };
    var list = function (items) { return Array.isArray(items) ? items : []; };
    var loaded = null;
    document.body.dataset.awaMode = MODE;

    // What the standalone page offers for opening files does not apply here
    $('title').textContent = MODE === 'run' ? 'Waiting for a simulated run…' : 'Waiting for a workflow…';
    var box = document.querySelector('#drop .box');
    box.replaceChildren();
    var heading = document.createElement('h2'), note = document.createElement('p'), error = document.createElement('p');
    heading.textContent = MODE === 'run' ? 'Simulated run' : 'Workflow';
    note.className = 'muted'; note.id = 'awa-wait'; note.textContent = 'Waiting for data from the conversation…';
    error.id = 'error'; error.setAttribute('role', 'alert');
    box.append(heading, note, error);
    function fail(text) { $('drop').hidden = false; $('awa-wait').textContent = ''; $('error').textContent = text; }

    // A fourth tab: the data that moves through the workflow
    var tab = document.createElement('button');
    tab.setAttribute('role', 'tab'); tab.id = 'tab-data'; tab.setAttribute('aria-selected', 'false'); tab.setAttribute('aria-controls', 'pane-data'); tab.textContent = 'Data';
    var pane = document.createElement('div');
    pane.className = 'pane'; pane.id = 'pane-data'; pane.setAttribute('role', 'tabpanel'); pane.setAttribute('aria-labelledby', 'tab-data');
    document.querySelector('.tabs').append(tab);
    document.querySelector('aside').append(pane);
    function show_data(on) {
        tab.setAttribute('aria-selected', String(on)); pane.classList.toggle('active', on);
        if (on) ['step', 'node', 'log'].forEach(function (name) { $('tab-' + name).setAttribute('aria-selected', 'false'); $('pane-' + name).classList.remove('active'); });
    }
    tab.addEventListener('click', function () { show_data(true); });
    ['step', 'node', 'log'].forEach(function (name) { $('tab-' + name).addEventListener('click', function () { show_data(false); }); });
    // Selecting a node opens the view's own Node tab
    $('nodes').addEventListener('click', function () { show_data(false); }, true);
    $('nodes').addEventListener('keydown', function (ev) { if (ev.key === 'Enter' || ev.key === ' ') show_data(false); }, true);

    // The view describes a node as part of a run. For a definition there is no run: drop its run status and the remark that nothing happened yet.
    new MutationObserver(function () {
        if (document.body.dataset.awaMode !== 'workflow') return;
        $('pane-node').querySelectorAll('dt').forEach(function (dt) { if (dt.textContent === 'Status') { if (dt.nextElementSibling) dt.nextElementSibling.remove(); dt.remove(); } });
        $('pane-node').querySelectorAll('p.muted').forEach(function (p) { if (/^Nothing has happened here yet/.test(p.textContent)) p.remove(); });
    }).observe($('pane-node'), { childList: true });
    if (MODE === 'workflow') document.querySelector('header h1').textContent = 'AWA Workflow';

    var expand = document.createElement('button');
    expand.className = 'btn'; expand.id = 'awa-expand'; expand.type = 'button'; expand.textContent = 'Expand';
    document.querySelector('header').append(expand);

    function chips(items) { return list(items).length ? list(items).map(function (i) { return '<span class="awa-chip">' + esc(i) + '</span>'; }).join(' ') : '<span class="muted">none</span>'; }
    function render_data(data, summary) {
        var out = '';
        if (summary) {
            out += '<h2>Simulated run: ' + esc(summary.status) + '</h2><p class="muted">Tools and models were simulated; nothing was executed.</p><dl>';
            out += '<dt>Path</dt><dd>' + (list(summary.path).map(esc).join(' → ') || 'nothing ran') + '</dd>';
            list(summary.decisions).forEach(function (d) { out += '<dt>' + esc(d.decision) + '</dt><dd>' + esc(d.rule || d.option || d.reason || (d.used_default ? 'default edge' : '')) + (d.outputs ? ' <code>' + esc(JSON.stringify(d.outputs)) + '</code>' : '') + '</dd>'; });
            if (list(summary.waiting_for).length) out += '<dt>Waiting for</dt><dd>' + list(summary.waiting_for).map(function (w) { return esc(w.event) + ' at ' + esc(w.at); }).join(', ') + '</dd>';
            list(summary.failures).forEach(function (f) { out += '<dt>Failed</dt><dd>' + esc(f.at) + ': ' + esc(f.message) + '</dd>'; });
            if (summary.cost) out += '<dt>Cost</dt><dd>' + esc(summary.cost.amount) + ' ' + esc(summary.cost.currency) + ' (from the rates given)</dd>';
            if (summary.stopped) out += '<dt>Stopped</dt><dd>' + esc(summary.stopped) + '</dd>';
            out += '</dl>';
        }
        if (!data) { pane.innerHTML = out; return; }
        var c = data.counts || {};
        out += (summary ? '<h3>The workflow</h3>' : '') + '<h2>' + esc(data.workflow && data.workflow.name) + '</h2>';
        if (data.workflow && data.workflow.description) out += '<p class="muted">' + esc(data.workflow.description) + '</p>';
        var count = function (n, one, many) { return esc(n) + ' ' + (n === 1 ? one : many); };
        out += '<p>' + [count(c.activities, 'activity', 'activities'), count(c.decisions, 'decision', 'decisions'), count(c.events, 'event', 'events'), count(c.roles, 'role', 'roles'), count(c.contexts, 'context', 'contexts')].join(', ') + '</p>';
        out += '<h3>Roles and actors</h3>';
        out += list(data.roles).length ? '<ul>' + list(data.roles).map(function (r) { return '<li><b>' + esc(r.name) + '</b> <span class="tag execution">' + esc(r.actor_type) + '</span>' + (r.model ? ' <span class="muted">model ' + esc(r.model) + '</span>' : '') + '<br><span class="muted">' + (list(r.activities).map(esc).join(', ') || 'no activity') + '</span></li>'; }).join('') + '</ul>' : '<p class="muted">The workflow defines no role.</p>';
        out += '<h3>Data that moves</h3>';
        out += list(data.data).length ? '<table class="awa-table"><thead><tr><th>Data</th><th>Produced by</th><th>Used by</th></tr></thead><tbody>' + list(data.data).map(function (d) { return '<tr><td><code>' + esc(d.name) + '</code></td><td>' + (list(d.produced_by).map(esc).join(', ') || '<span class="muted">given to the run</span>') + '</td><td>' + (list(d.consumed_by).map(esc).join(', ') || '<span class="muted">nobody</span>') + '</td></tr>'; }).join('') + '</tbody></table>' : '<p class="muted">No activity declares inputs or outputs.</p>';
        out += '<h3>Contexts</h3>';
        out += list(data.contexts).length ? '<ul>' + list(data.contexts).map(function (x) { return '<li><b>' + esc(x.name) + '</b> <span class="tag execution">' + esc(x.type) + '</span> <span class="muted">' + esc(x.sync_pattern) + ', visible to ' + esc(x.visibility) + '</span><br>read by ' + chips(x.read_by) + '<br>written by ' + chips(x.written_by) + '</li>'; }).join('') + '</ul>' : '<p class="muted">The workflow defines no shared context.</p>';
        out += '<h3>Activities</h3>';
        out += list(data.activities).map(function (a) {
            var rows = '<dt>Actor</dt><dd>' + esc(a.actor_type) + (a.role ? ', as ' + esc(a.role) : '') + '</dd>';
            rows += '<dt>Takes in</dt><dd>' + chips(list(a.inputs).map(function (i) { return i.name + (i.required ? '' : ' (optional)'); })) + '</dd>';
            rows += '<dt>Gives out</dt><dd>' + chips(list(a.outputs).map(function (i) { return i.name + (i.required ? '' : ' (optional)'); })) + '</dd>';
            if (list(a.contexts).length) rows += '<dt>Contexts</dt><dd>' + list(a.contexts).map(function (b) { return esc(b.context) + ' <span class="muted">(' + esc(b.access) + ')</span>'; }).join(', ') + '</dd>';
            if (list(a.access).length) rows += '<dt>Access</dt><dd>' + list(a.access).map(function (r) { return esc(r.permission) + ' on ' + esc(r.resource_type) + (r.resource ? ' ' + esc(r.resource) : '') + ' <span class="muted">(' + esc(r.direction) + (r.scope ? ', ' + esc(r.scope) : '') + ')</span>'; }).join('<br>') + '</dd>';
            if (list(a.tools).length) rows += '<dt>Tools</dt><dd>' + list(a.tools).map(function (t) { return '<code>' + esc(t.name) + '</code> <span class="muted">' + esc(t.runs) + ' (never executed here)</span>'; }).join('<br>') + '</dd>';
            return '<div class="attempt"><div class="head"><span>' + esc(a.name) + '</span></div><dl>' + rows + '</dl></div>';
        }).join('');
        if (list(data.events).length) out += '<h3>Events</h3><ul>' + list(data.events).map(function (e) { return '<li><b>' + esc(e.name) + '</b> <span class="muted">' + esc(e.type) + (e.business_event ? ', ' + esc(e.mode || 'wait') + ' ' + esc(e.business_event) : '') + (e.duration ? ', ' + esc(e.duration) : '') + (e.timeout ? ', times out after ' + esc(e.timeout) : '') + '</span></li>'; }).join('') + '</ul>';
        if (list(data.decisions).length) out += '<h3>Decisions</h3><ul>' + list(data.decisions).map(function (d) { return '<li><b>' + esc(d.name) + '</b> <span class="muted">' + list(d.decided_by).map(esc).join(', then ') + (d.rules ? ', ' + esc(d.rules) + ' rules on ' + list(d.inputs).map(esc).join(', ') : '') + '</span></li>'; }).join('') + '</ul>';
        pane.innerHTML = out;
    }

    // A company's brand, given inline with the tool call: its colours, fonts and logo (a data: URL); nothing is fetched
    function brand(awa) { try { if (awa && awa.brand && window.AWA_set_brand) window.AWA_set_brand(awa.brand, { data_only: true, network: false }); } catch (error) { console.warn('The brand could not be applied: ' + error.message); } }
    function update(result) {
        if (!result) return;
        if (result.isError) { var c = (result.content || []).find(function (x) { return x && typeof x.text === 'string'; }); fail(c ? c.text : 'The tool failed.'); return; }
        var awa = (result._meta && result._meta.awa) || (result.structuredContent && result.structuredContent.awa);
        if (!awa || (awa.view !== 'workflow' && awa.view !== 'run') || !awa.workflow) return;
        brand(awa);
        try {
            var journal = awa.view === 'run' && Array.isArray(awa.journal) ? awa.journal : [];
            window.AWAReplay.load(awa.workflow, journal, awa.view === 'run' ? 'Simulated' : undefined);
            document.body.dataset.awaMode = awa.view;
            render_data(awa.data, awa.view === 'run' ? awa.summary : undefined);
            if (awa.view === 'run') { window.AWAReplay.seek(window.AWAReplay.length); show_data(false); $('tab-step').click(); }
            else show_data(true);
            loaded = awa;
            // The view lays the graph out for the size of its stage: lay it out again once the frame has its height
            setTimeout(function () { window.dispatchEvent(new Event('resize')); }, 60);
        } catch (problem) { fail('This could not be shown: ' + problem.message); }
    }

    var host = window.AWA_HOST.connect({
        name: MODE === 'run' ? 'awa-run-replay' : 'awa-workflow-graph', onResult: update, onError: function (problem) { if (!loaded) fail(problem.message); },
        preferredHeight: function (width) { return width < 760 ? 720 : 600; },
    });
    expand.onclick = function () { host.toggleFullscreen().catch(function () { }); };

    // Tell the model which node the reader selected
    var timer;
    $('nodes').addEventListener('click', function (ev) {
        var node = ev.target.closest && ev.target.closest('.node');
        if (!node || !loaded) return;
        clearTimeout(timer);
        timer = setTimeout(function () {
            var heading2 = document.querySelector('#pane-node h2');
            if (heading2) host.tell({ view: loaded.view, workflow: String(loaded.workflow.name).slice(0, 120), selected_node: heading2.textContent.slice(0, 120) });
        }, 300);
    });
})();
