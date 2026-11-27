import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { bundle_widget, assert_self_contained, WIDGETS, widget_html } from '../src/widgets.js';
import { RELEASE } from '../src/sdk.js';

const temp = t => { const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'awa-mcp-widget-')); t.after(() => fs.rmSync(dir, { recursive: true, force: true })); return dir; };
const page = body => `<!doctype html><html><head><title>t</title></head><body>${body}</body></html>`;

test('bundle_widget inlines local scripts in place, drops what it is told to, and adds styles and scripts', t => {
    const dir = temp(t);
    fs.writeFileSync(path.join(dir, 'a.js'), 'window.A = "</script><script>alert(1)";');
    fs.writeFileSync(path.join(dir, 'sample.js'), 'window.SAMPLE = 1;');
    fs.writeFileSync(path.join(dir, 'bridge.js'), 'window.V = "__AWA_WIDGET_VERSION__"; window.M = "__MODE__";');
    fs.writeFileSync(path.join(dir, 'extra.css'), 'body { color: red; }');
    fs.writeFileSync(path.join(dir, 'view.html'), page('<header>h</header><script src="a.js"></script><script src="sample.js"></script><script>window.INLINE = 1;</script>'));
    const html = bundle_widget({ html: path.join(dir, 'view.html'), drop: ['sample.js'], styles: [path.join(dir, 'extra.css')], scripts: [path.join(dir, 'bridge.js')], replace: { __MODE__: 'run' } });
    assert.ok(html.includes('window.A = "<\\/script><script>alert(1)";'), 'a closing script tag inside inlined code is escaped');
    assert.equal(html.includes('SAMPLE'), false);
    assert.ok(html.includes(`window.V = "${RELEASE}"; window.M = "run";`));
    assert.ok(html.indexOf('does not use the network') < html.indexOf('window.A'), 'the network is closed before any view code runs');
    assert.ok(html.indexOf('does not use the network') > html.indexOf('<head>') && html.indexOf('does not use the network') < html.indexOf('<header>'));
    assert.ok(html.indexOf('color: red') < html.indexOf('</head>') && html.indexOf('window.V') > html.indexOf('window.INLINE'));
    assert.equal((html.match(/<\/script>/g) || []).length, 4, 'four script elements end: the prelude, a.js, the inline script and the bridge');
});

test('bundle_widget refuses anything that would load from elsewhere', t => {
    const dir = temp(t);
    const make = body => { const file = path.join(dir, `v${Math.random()}.html`); fs.writeFileSync(file, page(body)); return file; };
    assert.throws(() => bundle_widget({ html: make('<script src="https://cdn.example/x.js"></script>') }), /self-contained/);
    assert.throws(() => bundle_widget({ html: make('<script src="//cdn.example/x.js"></script>') }), /self-contained/);
    assert.throws(() => bundle_widget({ html: make('<script src="../outside.js"></script>') }), /outside its directory/);
    for (const markup of ['<link rel="stylesheet" href="https://fonts.example/a.css">', '<img src="https://example.com/a.png">', '<iframe src="https://example.com"></iframe>', '<style>@import url(a.css);</style>', '<style>body{background:url(https://example.com/a.png)}</style>', '<script src=x.js async></script>'])
        assert.throws(() => bundle_widget({ html: make(markup) }), /not self-contained|ENOENT/, markup);
    assert.doesNotThrow(() => assert_self_contained(page('<img src="data:image/png;base64,AAAA"><a href="#">x</a><svg xmlns="http://www.w3.org/2000/svg"></svg>')));
});

test('every widget is one self-contained document built from its view, with the bridge and without sample data', () => {
    for (const [name, widget] of Object.entries(WIDGETS)) {
        const html = widget_html(name);
        assert.doesNotThrow(() => assert_self_contained(html, name));
        assert.ok(html.includes('window.AWA_HOST'), `${name} has the host bridge`);
        assert.ok(html.includes("'ui/initialize'") && html.includes('ui/notifications/tool-result') && html.includes('openai:set_globals'));
        assert.equal(/__AWA_WIDGET_[A-Z]+__/.test(html), false, `${name} has an unfilled placeholder`);
        assert.equal(html.includes('AWA_SAMPLES = ['), false, `${name} carries replay sample data`);
        assert.equal(html.includes('window.AWA_STORY ='), false, `${name} carries journey sample data`);
        assert.ok(html.length < 400_000, `${name} is ${html.length} bytes`);
        assert.ok(fs.existsSync(widget.bundle.html));
        assert.equal(widget_html(name), html, 'bundled once');
    }
    assert.ok(widget_html('journeys').includes('window.AWA_show = show'), 'the journey view exposes the hook the bridge calls');
    assert.ok(widget_html('run').includes('window.AWAReplay ='), 'the replay view exposes the hook the bridge calls');
    assert.ok(widget_html('workflow').includes("var MODE = 'workflow'") && widget_html('run').includes("var MODE = 'run'"));
    assert.ok(widget_html('dashboard').includes('window.AWA_dashboard_show = show') && widget_html('dashboard').includes('AWA_MEASURES'), 'the dashboard carries the hook the bridge calls and the code that computes the measures');
    assert.ok(!widget_html('dashboard').includes('window.AWA_PORTFOLIO ='), 'and no sample record');
    for (const name of Object.keys(WIDGETS)) assert.ok(widget_html(name).includes('window.AWA_set_brand = setBrand') && widget_html(name).includes('root.AWA_brand = api'), `${name} can take a brand`);
    assert.ok(widget_html('journeys').includes('root.AWA_GLOSSARY = glossary'), 'the journey view carries its glossary');
    assert.throws(() => widget_html('nothing'), /Unknown widget/);
});
