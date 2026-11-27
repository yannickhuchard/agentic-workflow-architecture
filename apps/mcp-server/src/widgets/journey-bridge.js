// Connects tools/visualization/journey.html to the MCP Apps host: the story a
// tool built arrives in the tool result and is handed to the view's own show().
(function () {
    'use strict';
    var none = document.getElementById('none');
    var story = null;
    function say(text) { none.textContent = text; none.hidden = !text; }
    function first_text(result) { var c = (result.content || []).find(function (x) { return x && typeof x.text === 'string'; }); return c ? c.text : 'The tool failed.'; }
    say('Waiting for journeys from the conversation…');

    // A company's brand, given inline with the tool call: its colours, fonts and logo (a data: URL); nothing is fetched
    function brand(awa) { try { if (awa && awa.brand && window.AWA_set_brand) window.AWA_set_brand(awa.brand, { data_only: true, network: false }); } catch (error) { console.warn('The brand could not be applied: ' + error.message); } }
    function update(result) {
        if (!result) return;
        if (result.isError) { say(first_text(result)); return; }
        var awa = (result._meta && result._meta.awa) || (result.structuredContent && result.structuredContent.awa);
        if (!awa || awa.view !== 'journeys') return;
        brand(awa);
        if (!awa.story || !Array.isArray(awa.story.journeys) || !awa.story.journeys.length) { story = null; say(typeof awa.empty === 'string' ? awa.empty : 'No journey has started yet: no event that begins a journey was played.'); return; }
        story = awa.story;
        // The view reads its place from the address when it is shown a record. A new result starts at the top, not where the last one was left.
        try { if (location.hash) location.replace('#'); } catch (ignored) { /* an address that cannot be changed carries no place */ }
        try { window.AWA_show(story, typeof awa.source === 'string' ? awa.source : 'simulated', false, true); }
        catch (error) { story = null; say('These journeys could not be shown: ' + error.message); }
    }

    // The journey view is drawn on a 1440 by 900 stage and scaled to its frame
    var host = window.AWA_HOST.connect({
        name: 'awa-journeys', onResult: update, onError: function (error) { if (!story) say(error.message); },
        preferredHeight: function (width) { return Math.max(320, width * 900 / 1440); },
    });

    var expand = document.createElement('button');
    expand.className = 'crumb'; expand.id = 'awa-expand'; expand.type = 'button'; expand.textContent = 'Expand';
    expand.style.borderColor = 'rgba(255,255,255,.16)';
    expand.onclick = function () { host.toggleFullscreen().catch(function () { }); };
    document.getElementById('top').insertBefore(expand, document.getElementById('switch'));

    // The address of the view carries the place (#level/journey/customer/run/position): tell the model where the reader is
    var timer;
    window.addEventListener('hashchange', function () {
        clearTimeout(timer);
        if (!story) return;
        timer = setTimeout(function () {
            var parts = location.hash.slice(1).split('/'), journey = story.journeys[Number(parts[1])];
            if (!journey) return;
            var customer = parts[0] === 'story' || parts[0] === 'run' ? journey.instances[Number(parts[2])] : undefined;
            host.tell({ view: 'journeys', level: String(parts[0]).slice(0, 12), journey: String(journey.name).slice(0, 120), customer: customer ? String(customer.name).slice(0, 80) : undefined });
        }, 400);
    });
})();
