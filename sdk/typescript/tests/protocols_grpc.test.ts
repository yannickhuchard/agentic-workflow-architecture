/**
 * The built-in gRPC executor (specification 17.8), against a server the tests start
 * on localhost, described by a .proto file or by the server's reflection service.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import path from 'path';
import * as grpc from '@grpc/grpc-js';
import * as loader from '@grpc/proto-loader';
import { ReflectionService } from '@grpc/reflection';
import { ToolRunner, ToolOptions } from '../src/runtime/tools';
import { ToolSessions } from '../src/runtime/protocols/sessions';
import { JournalEventInput } from '../src/runtime/journal';
import { ToolDefinitionSchema, ToolDefinition } from '../src/types';

const PROTO = path.join(__dirname, 'fixtures/protocols/pricing.proto');

let server: grpc.Server;
let address = '';
let calls = 0;

beforeAll(async () => {
    const definition = loader.loadSync(PROTO, { keepCase: true, longs: String, enums: String, defaults: true });
    const pricing = (grpc.loadPackageDefinition(definition) as any).pricing;
    server = new grpc.Server();
    server.addService(pricing.Quotes.service, {
        Get: (call: any, callback: grpc.sendUnaryData<unknown>) => {
            calls++;
            const { sku, quantity } = call.request;
            if (sku === 'missing') return callback({ code: grpc.status.NOT_FOUND, details: `No price for ${sku}` } as grpc.ServiceError);
            if (sku === 'slow') { setTimeout(() => callback(null, { sku }), 1000); return; }
            callback(null, { sku, total_cents: String(1999 * quantity), currency: 'USD', notes: ['list price'], ...(quantity > 1 ? { detail: { source: 'catalogue' } } : {}) });
        },
        Watch: (call: any) => call.end(),
    });
    new ReflectionService(definition).addToServer(server);
    const port = await new Promise<number>((resolve, reject) => server.bindAsync('127.0.0.1:0', grpc.ServerCredentials.createInsecure(), (error, p) => (error ? reject(error) : resolve(p))));
    address = `127.0.0.1:${port}`;
});
afterAll(() => { server?.forceShutdown(); });

const tool = (method = 'Get', timeout?: string, endpoint?: string): ToolDefinition =>
    ToolDefinitionSchema.parse({ name: `quote_${method.toLowerCase()}`, binding: { kind: 'grpc', endpoint: endpoint || address, service: 'pricing.Quotes', method }, ...(timeout ? { timeout } : {}) });

function runner(tools: ToolDefinition[], options: ToolOptions, simulate = false) {
    const events: JournalEventInput[] = [];
    return { run: new ToolRunner(tools, options, e => events.push(e), v => v, { max_calls: 20, simulate }), events };
}

describe('gRPC tools', () => {
    it('makes a unary call described by a .proto file, with proto field names and defaults', async () => {
        const { run, events } = runner([tool()], { grpc: { protos: [PROTO], plaintext_hosts: ['127.0.0.1'] } });
        const result = await run.call('quote_get', { sku: 'S-1', quantity: 1 });
        expect(result.ok).toBe(true);
        // 64-bit integers as strings, enumerations by name, repeated and scalar fields present, an unset message absent
        expect(result.result).toEqual({ sku: 'S-1', total_cents: '1999', currency: 'USD', notes: ['list price'], discounted: false });
        expect(events.find(e => e.type === 'tool.completed')!.data).toMatchObject({ status: 'OK', link: `grpc://${address}/pricing.Quotes/Get` });
    });

    it('learns the service from the server by reflection when no file describes it', async () => {
        const { run } = runner([tool()], { grpc: { plaintext_hosts: [address] } });
        expect((await run.call('quote_get', { sku: 'S-2', quantity: 2 })).result).toMatchObject({ sku: 'S-2', total_cents: '3998', detail: { source: 'catalogue' } });
    });

    it('fails when reflection is off and no file describes the service', async () => {
        const { run } = runner([tool()], { grpc: { reflection: false, plaintext_hosts: [address] } });
        expect((await run.call('quote_get', { sku: 'S-2' })).result).toMatchObject({ code: 'VALIDATION_ERROR' });
    });

    it('maps status codes, and the deadline to TIMEOUT', async () => {
        const { run, events } = runner([tool()], { grpc: { protos: [PROTO], plaintext_hosts: ['127.0.0.1'] } });
        expect((await run.call('quote_get', { sku: 'missing' })).result).toMatchObject({ code: 'TOOL_ERROR', error: 'No price for missing' });
        expect(events.find(e => e.type === 'tool.failed')!.data).toMatchObject({ status: 'NOT_FOUND', invoked: true });
        const slow = runner([ToolDefinitionSchema.parse({ name: 'slow', timeout: 'PT0.2S', binding: { kind: 'grpc', endpoint: address, service: 'pricing.Quotes', method: 'Get' } })],
            { grpc: { protos: [PROTO], plaintext_hosts: ['127.0.0.1'] } });
        expect((await slow.run.call('slow', { sku: 'slow' })).result).toMatchObject({ code: 'TIMEOUT' });
    });

    it('refuses streaming methods', async () => {
        const { run } = runner([tool('Watch')], { grpc: { protos: [PROTO], plaintext_hosts: ['127.0.0.1'] } });
        expect((await run.call('quote_watch', { sku: 'S-1' })).result).toMatchObject({ code: 'VALIDATION_ERROR', error: expect.stringMatching(/streaming/) });
    });

    it('uses TLS unless the deployment allows plaintext for the host', async () => {
        const before = calls;
        const { run, events } = runner([tool('Get', 'PT2S')], { grpc: { protos: [PROTO] } });
        const result = await run.call('quote_get', { sku: 'S-1', quantity: 1 });
        expect(result.result).toMatchObject({ code: 'TOOL_ERROR' });
        expect(events.find(e => e.type === 'tool.failed')!.data).toMatchObject({ status: 'UNAVAILABLE' });
        expect(calls).toBe(before);
    });

    it('refuses an endpoint the list of hosts does not include, before anything is called', async () => {
        const before = calls;
        const { run, events } = runner([tool()], { allowed_hosts: ['api.example.com'], grpc: { protos: [PROTO], plaintext_hosts: ['127.0.0.1'] } });
        expect((await run.call('quote_get', { sku: 'S-1' })).result).toMatchObject({ code: 'PERMISSION_DENIED' });
        expect(events.map(e => e.type)).toEqual(['tool.failed']);
        expect(calls).toBe(before);
        const allowed = runner([tool()], { allowed_hosts: [address], grpc: { protos: [PROTO], plaintext_hosts: ['127.0.0.1'] } });
        expect((await allowed.run.call('quote_get', { sku: 'S-1', quantity: 1 })).ok).toBe(true);
    });

    it('calls nothing in simulation', async () => {
        const before = calls;
        const { run } = runner([tool()], { grpc: { protos: [PROTO], plaintext_hosts: ['127.0.0.1'] }, simulated_results: { quote_get: { sku: 'sim' } } }, true);
        expect((await run.call('quote_get', { sku: 'S-1' })).result).toEqual({ sku: 'sim' });
        expect(calls).toBe(before);
    });

    it('keeps one channel for the calls of a run', async () => {
        const sessions = new ToolSessions();
        const { run } = runner([tool()], { sessions, grpc: { plaintext_hosts: ['127.0.0.1'] } });
        await run.call('quote_get', { sku: 'S-1', quantity: 1 });
        await run.call('quote_get', { sku: 'S-2', quantity: 1 });
        expect(sessions.size).toBe(1);
        await sessions.close();
    });
});
