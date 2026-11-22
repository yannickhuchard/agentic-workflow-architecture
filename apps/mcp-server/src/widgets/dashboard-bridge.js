// Connects tools/visualization/dashboard.html to the MCP Apps host: the record
// a tool measured arrives in the tool result and is handed to the page's own show().
(function () {
    'use strict';
    window.AWA_EMBEDDED = true;                 // no journey view sits beside this page
    var msg = document.getElementById('msg'), shown = false;
    function say(text) { msg.textContent = text; msg.hidden = !text; }
    function first_text(result) { var c = (result.content || []).find(function (x) { return x && typeof x.text === 'string'; }); return c ? c.text : 'The tool failed.'; }
    say('Waiting for the measures from the conversation…');
    // A record cannot be opened from a file here, and there is no page to go to
    ['open', 'tojourney'].forEach(function (id) { var el = document.getElementById(id); if (el) el.hidden = true; });

    var host = window.AWA_HOST.connect({
        name: 'awa-dashboard',
        onResult: function (result) {
            if (!result) return;
            if (result.isError) { if (!shown) say(first_text(result)); return; }
            var awa = (result._meta && result._meta.awa) || (result.structuredContent && result.structuredContent.awa);
            if (!awa || awa.view !== 'dashboard' || !awa.record) return;
            try { window.AWA_dashboard_show(awa.record, typeof awa.source === 'string' ? awa.source : 'simulated', '', awa.period && typeof awa.period === 'object' ? awa.period : undefined); shown = true; }
            catch (error) { say('These measures could not be shown: ' + error.message); }
        },
        // The page has its own light and dark; the host says which
        onContext: function (context) { if (context.theme === 'light' || context.theme === 'dark') document.documentElement.dataset.theme = context.theme; },
        onError: function (error) { if (!shown) say(error.message); },
        preferredHeight: function () { return Math.min(Math.max(420, document.documentElement.scrollHeight), 1400); },
    });

    // "Open the journey" has no page to open here: tell the model which customer the reader chose
    window.AWA_open_journey = function (journey, index, instance) {
        host.tell({ view: 'dashboard', chosen: { customer: String(instance.subject_key).slice(0, 80), journey_index: journey, status: String(instance.status).slice(0, 40) }, hint: 'The reader asked to open this customer\'s journey. Show it with show_journeys or load_claims_example.' });
        var note = document.getElementById('source'); if (note) note.textContent = 'Ask in the conversation to open the journey of ' + String(instance.subject_key).slice(0, 80);
    };
})();
