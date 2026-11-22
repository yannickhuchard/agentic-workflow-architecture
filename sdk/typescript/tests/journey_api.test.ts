/**
 * Journeys over HTTP and from a runtime directory (specification 19.10).
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { AddressInfo } from 'net';
import { Server } from 'http';
import { createServer } from '../src/server';
import { set_journey_runtime } from '../src/server/routes/journeys';
import { AwaRuntime, add_definition, open_runtime_directory } from '../src/runtime/runtime';
import { silent_logger } from './helpers';

const EXAMPLE = path.resolve(__dirname, '../../../examples/claims-journey');
const read = (name: string) => JSON.parse(fs.readFileSync(path.join(EXAMPLE, name), 'utf-8'));
const engine = { simulate: true, simulated_outputs: read('simulation.json'), execution_logger: silent_logger, sleep: async () => { } };

describe('Journey API', () => {
    let server: Server, base: string;
    const call = async (method: string, route: string, body?: unknown) => {
        const response = await fetch(`${base}/api/v1/journeys${route}`, { method, headers: { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
        return { status: response.status, body: await response.json() as any };
    };
    beforeAll(async () => {
        set_journey_runtime(new AwaRuntime({ engine }));
        server = createServer({ request_logging: false }).listen(0);
        await new Promise(resolve => server.once('listening', resolve));
        base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    });
    afterAll(async () => { set_journey_runtime(undefined); await new Promise(resolve => server.close(resolve)); });

    it('registers definitions, takes in events and reports the journey', async () => {
        expect((await call('POST', '/definitions', read('policy-purchase.journey.json'))).status).toBe(400);   // its workflow is not there yet
        expect((await call('POST', '/definitions', read('policy-purchase.awa.json'))).body).toMatchObject({ kind: 'workflow', name: 'Policy Purchase' });
        expect((await call('POST', '/definitions', read('policy-purchase.journey.json'))).body).toMatchObject({ kind: 'journey' });

        const first = await call('POST', '/events', { id: 'evt-1', type: 'quote.requested', source: '/portal', data: { customer_id: 'c-1', vehicle: 'estate' } });
        expect(first.status).toBe(202);
        expect(first.body).toMatchObject({ event_id: 'evt-1', accepted: true });
        expect(first.body.started_runs).toHaveLength(1);
        expect((await call('POST', '/events', { id: 'evt-1', type: 'quote.requested', data: { customer_id: 'c-1' } })).body.accepted).toBe(false);
        expect((await call('POST', '/events', { data: {} })).status).toBe(400);

        for (const [type, data] of [['quote.accepted', { quote_accepted: true }], ['contract.signed', { signed: true }], ['payment.received', { amount: 600 }]] as const) {
            expect((await call('POST', '/events', { type, data: { customer_id: 'c-1', ...data } })).body.resumed_runs).toHaveLength(1);
        }
        const instances = (await call('GET', '/instances?subject=c-1')).body;
        expect(instances).toHaveLength(1);
        expect(instances[0]).toMatchObject({ status: 'completed', goals_reached: ['covered'], sentiment: 1 });
        expect((await call('GET', '/instances?stalled=true')).body).toEqual([]);

        const bundle = (await call('GET', `/instances/${instances[0].id}`)).body;
        expect(bundle.instance.events.filter((e: any) => e.type === 'journey.touchpoint')).toHaveLength(8);
        expect(bundle.runs[0].events.at(-1).type).toBe('run.completed');
        expect((await call('GET', '/instances/nope')).status).toBe(404);

        const journeys = (await call('GET', '/')).body;
        expect(journeys[0]).toMatchObject({ name: 'Policy Purchase', analytics: { total: 1, completed: 1, goals: { covered: 1 } } });
        const portfolio = (await call('GET', '/portfolio')).body;
        expect(portfolio.journeys[0].instances).toHaveLength(1);
        expect(portfolio.workflows.map((w: any) => w.name)).toEqual(['Policy Purchase']);
        expect((await call('GET', '/transitions')).body).toEqual([]);
    });

    it('reports the measures of what was recorded, as data and for a metrics system', async () => {
        const report = await (await fetch(`${base}/api/v1/measures`)).json() as any;
        expect(report.journeys[0]).toMatchObject({ name: 'Policy Purchase', measures: { 'journey.started': { value: 1, n: 1 }, 'journey.completion_rate': { value: 1, n: 1 }, 'journey.goal_attainment': { value: 1 } } });
        expect(report.workflows[0].measures['workflow.success_rate']).toEqual({ value: 1, n: 1 });
        expect(report.workflows[0].measures['workflow.tool_failure_rate']).toEqual({ value: null, n: 0 });   // no tool was called: no rate, not zero
        const none = await (await fetch(`${base}/api/v1/measures?from=2999-01-01T00:00:00Z`)).json() as any;
        expect(none.journeys[0].measures['journey.completion_rate']).toEqual({ value: null, n: 0 });
        expect((await fetch(`${base}/api/v1/measures?from=yesterday`)).status).toBe(400);

        const scraped = await fetch(`${base}/api/v1/measures?format=openmetrics`);
        expect(scraped.headers.get('content-type')).toContain('application/openmetrics-text');
        const text = await scraped.text();
        expect(text).toContain('# TYPE awa_journey_completion_rate gauge');
        expect(text).toContain('awa_journey_completion_rate{journey="Policy Purchase"} 1');
        expect(text).not.toContain('awa_workflow_tool_failure_rate');
        expect(text.endsWith('# EOF\n')).toBe(true);
        const definitions = await (await fetch(`${base}/api/v1/measures/definitions`)).json() as any[];
        expect(definitions.find(d => d.id === 'workflow.first_pass_yield')).toMatchObject({ unit: 'ratio', better: 'higher' });
    });

    it('lets time pass on request', async () => {
        await call('POST', '/events', { type: 'quote.requested', data: { customer_id: 'c-2' } });
        const later = await call('POST', '/tick', { at: new Date(Date.now() + 8 * 24 * 3600 * 1000).toISOString() });
        expect(later.body.timed_out_runs).toHaveLength(1);                       // the quote expired: the planned path, not a failure
        expect((await call('GET', '/instances?subject=c-2')).body[0].runs[0].status).toBe('completed');
    });
});

describe('A runtime directory', () => {
    it('is opened by one process after another, each carrying on from the last', async () => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'awa-dir-'));
        expect(await add_definition(dir, read('policy-purchase.awa.json'))).toMatchObject({ kind: 'workflow' });
        expect(await add_definition(dir, read('policy-purchase.journey.json'))).toMatchObject({ kind: 'journey' });

        const { business_event } = await import('../src/runtime/business_event');
        const first = await open_runtime_directory(dir, { engine });
        await first.publish(business_event('quote.requested', { customer_id: 'c-7' }, { id: 'q-7' }));

        const second = await open_runtime_directory(dir, { engine });
        expect((await second.publish(business_event('quote.requested', { customer_id: 'c-7' }, { id: 'q-7' }))).accepted).toBe(false);
        await second.publish(business_event('quote.accepted', { customer_id: 'c-7', quote_accepted: true }));

        const third = await open_runtime_directory(dir, { engine });
        const instance = third.list_journey_instances()[0];
        expect(instance.stage_id).toBe('contracted');
        // The journal is on disk too: one file, one unbroken sequence across three processes
        const events = (await third.export_journey(instance.id)).runs[0].events;
        expect(events.map(e => e.seq)).toEqual(events.map((_, i) => i + 1));
        expect(events.filter(e => e.type === 'run.resumed').length).toBeGreaterThanOrEqual(2);
        expect(fs.readdirSync(path.join(dir, 'journals'))).toHaveLength(1);
    });

    it('is held by one host at a time, and a lock left by a dead process is taken over', async () => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'awa-lock-'));
        await add_definition(dir, read('policy-purchase.awa.json'));
        // Another live process holds it: this test's parent
        fs.writeFileSync(path.join(dir, 'runtime.lock'), String(process.ppid));
        await expect(open_runtime_directory(dir, { engine })).rejects.toThrow(/in use by process/);
        // A process that no longer exists left its lock behind
        fs.writeFileSync(path.join(dir, 'runtime.lock'), '2147483646');
        const runtime = await open_runtime_directory(dir, { engine });
        expect(fs.readFileSync(path.join(dir, 'runtime.lock'), 'utf-8')).toBe(String(process.pid));
        await runtime.close();
        expect(fs.existsSync(path.join(dir, 'runtime.lock'))).toBe(false);

        // Closing twice is safe: the second call must not take away the lock a later opening holds
        const later = await open_runtime_directory(dir, { engine });
        await runtime.close();
        expect(fs.readFileSync(path.join(dir, 'runtime.lock'), 'utf-8')).toBe(String(process.pid));
        await later.close();
        expect(fs.existsSync(path.join(dir, 'runtime.lock'))).toBe(false);

        // A lock that names no process is not taken for one left behind: it may be a lock being written by something else
        fs.writeFileSync(path.join(dir, 'runtime.lock'), '');
        await expect(open_runtime_directory(dir, { engine })).rejects.toThrow(/names no process/);
        expect(fs.readdirSync(dir).filter(f => f.startsWith('runtime.lock'))).toEqual(['runtime.lock']);      // nothing written aside is left
    });
});

describe('The views that come with the SDK', () => {
    it('writes the measures page as one file that carries the record and cannot be broken out of', async () => {
        const { measures_page, view_directory } = await import('../src/runtime/views');
        expect(fs.existsSync(path.join(view_directory(), 'journey.html'))).toBe(true);
        const record = { as_of: '2026-01-01T00:00:00Z', journeys: [{ definition: { id: 'j', name: '</script><script>alert(1)</script>', stages: [] }, instances: [] }] };
        const page = measures_page(record, { source: '</script>' });
        expect(page).not.toContain('src="awa-kpis.js"');
        expect(page).not.toContain('</script><script>alert(1)');
        expect(page).toContain('\\u003c/script>\\u003cscript>alert(1)');
        expect(page.match(/<script>/g)).toHaveLength(3);          // the measures, the record, the page's own
        expect(page.match(/<\/script>/g)).toHaveLength(3);
    });

    it('is served by the server', async () => {
        const server = createServer({ request_logging: false }).listen(0);
        await new Promise(resolve => server.once('listening', resolve));
        const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
        const page = await fetch(`${base}/views/dashboard.html`);
        expect(page.status).toBe(200);
        expect(page.headers.get('content-type')).toContain('text/html');
        expect((await fetch(`${base}/views/awa-kpis.js`)).status).toBe(200);
        expect((await fetch(`${base}/views/../package.json`)).status).toBe(404);
        await new Promise(resolve => server.close(resolve));
    });
});
