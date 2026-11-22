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
});
