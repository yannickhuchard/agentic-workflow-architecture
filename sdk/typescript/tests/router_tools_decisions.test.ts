import { describe, it, expect, afterEach } from 'vitest';
import http from 'http';
import { createRequire } from 'module';
import type { AddressInfo } from 'net';
import { randomUUID as uuidv4 } from 'crypto';
import { WorkflowEngine } from '../src/runtime/workflow_engine';
import {
    EmbeddedModelProvider, FunctionModelProvider, ModelRegistry, ModelRequest, ModelRouter,
    OpenAICompatibleModelProvider, OpenAIModelProvider, tier_fallbacks,
} from '../src/runtime/models';
import { ToolRunner, tool_link } from '../src/runtime/tools';
import { parse_vote } from '../src/runtime/decision_model';
import { compile_recipe } from '../src/runtime/recipe';
import { validate_workflow_integrity } from '../src/validator';
import { DecisionModelSchema, DecisionNode, JournalEvent, ToolDefinition, ToolDefinitionSchema } from '../src';
import { activity, edge, workflow, scripted, silent_logger } from './helpers';

const quiet = { sleep: async () => { }, execution_logger: silent_logger };
const servers: http.Server[] = [];
afterEach(() => { while (servers.length) servers.pop()!.close(); });

/** A local HTTP server that records requests and answers with what `reply` returns */
function stub(reply: (request: { method: string; url: string; headers: http.IncomingHttpHeaders; body: any }, n: number) => { status?: number; json?: unknown; text?: string }) {
    const requests: { method: string; url: string; headers: http.IncomingHttpHeaders; body: any }[] = [];
    const server = http.createServer((req, res) => {
        let raw = '';
        req.on('data', chunk => (raw += chunk));
        req.on('end', () => {
            const request = { method: req.method!, url: req.url!, headers: req.headers, body: raw ? JSON.parse(raw) : undefined };
            requests.push(request);
            const answer = reply(request, requests.length);
            res.statusCode = answer.status || 200;
            res.setHeader('content-type', answer.text !== undefined ? 'text/plain' : 'application/json');
            res.end(answer.text !== undefined ? answer.text : JSON.stringify(answer.json ?? {}));
        });
    }).listen(0);
    servers.push(server);
    return { base: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, requests };
}

// ----------------------------------------------------------------------------
describe('Model router', () => {
    const failing = (id: string, code?: string) => new FunctionModelProvider(id, () => { throw Object.assign(new Error(`${id} is down`), code ? { code } : {}); });

    it('uses the first candidate of a tier and reports the route', async () => {
        const registry = new ModelRegistry().register(new FunctionModelProvider('a', () => 'from a')).register(new FunctionModelProvider('b', () => 'from b'))
            .set_tier('fast', ['a:m1', 'b:m2']);
        const routed = await new ModelRouter(registry).generate('tier:fast', { prompt: 'hi' });
        expect(routed.response.text).toBe('from a');
        expect(routed.model).toMatchObject({ ref: 'a:m1', tier: 'fast' });
        expect(routed.route).toEqual([{ ref: 'a:m1', outcome: 'used' }]);
    });

    it('falls back to the next candidate when a provider fails', async () => {
        const registry = new ModelRegistry().register(failing('cloud', 'RATE_LIMITED')).register(new FunctionModelProvider('local', () => 'from local'))
            .set_tier('fast', ['cloud:big', 'local:small']);
        const routed = await new ModelRouter(registry).generate('tier:fast', { prompt: 'hi' });
        expect(routed.response.text).toBe('from local');
        expect(routed.route.map(r => `${r.ref} ${r.outcome}`)).toEqual(['cloud:big failed', 'local:small used']);
        expect(routed.route[0].reason).toMatch(/RATE_LIMITED: cloud is down/);
    });

    it('skips providers that cannot call tools when the request has tools', async () => {
        const registry = new ModelRegistry()
            .register(new FunctionModelProvider('tiny', () => 'no tools here', { tools: false }))
            .register(new FunctionModelProvider('capable', () => 'ok'))
            .set_tier('fast', ['tiny:m', 'capable:m']);
        const router = new ModelRouter(registry);
        const tools = [{ name: 'lookup', parameters: { type: 'object' } }];
        expect((await router.generate('tier:fast', { prompt: 'x', tools })).route.map(r => r.outcome)).toEqual(['skipped', 'used']);
        expect((await router.generate('tier:fast', { prompt: 'x' })).model.ref).toBe('tiny:m'); // without tools the small model serves
    });

    it('leaves out tier candidates whose provider is not registered', () => {
        const registry = new ModelRegistry().register(new FunctionModelProvider('ollama', () => 'x'));
        for (const [tier, refs] of Object.entries(tier_fallbacks(['google', 'openai', 'ollama', 'embedded']))) registry.set_tier(tier, refs);
        expect(registry.candidates('tier:fast').map(c => c.provider.id)).toEqual(['ollama']);
    });

    it('fails with the whole route when no candidate can serve', async () => {
        const registry = new ModelRegistry().register(failing('a')).register(failing('b')).set_tier('fast', ['a:m', 'b:m']);
        await expect(new ModelRouter(registry).generate('tier:fast', { prompt: 'x' }))
            .rejects.toMatchObject({ code: 'PROVIDER_ERROR', route: [{ outcome: 'failed' }, { outcome: 'failed' }] });
    });

    it('does not try further candidates after a provider rejects the request as invalid', async () => {
        const second = new FunctionModelProvider('b', () => 'never');
        const registry = new ModelRegistry().register(failing('a', 'VALIDATION_ERROR')).register(second).set_tier('fast', ['a:m', 'b:m']);
        await expect(new ModelRouter(registry).generate('tier:fast', { prompt: 'x' })).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
        expect(second.requests).toHaveLength(0);
    });
});

// ----------------------------------------------------------------------------
describe('Provider adapters', () => {
    const tools = [{ name: 'get_policy', description: 'Look up a policy', parameters: { type: 'object', properties: { number: { type: 'string' } } } }];

    it('OpenAI-compatible: sends tools, reads tool calls, and returns the provider\'s own message when continuing', async () => {
        const assistant = {
            role: 'assistant', content: null,
            tool_calls: [{ id: 'c1', type: 'function', function: { name: 'get_policy', arguments: '{"number":"P-1"}' }, extra_content: { vendor: { signature: 'abc' } } }],
        };
        const server = stub((_, n) => n === 1
            ? { json: { choices: [{ message: assistant }], usage: { prompt_tokens: 10, completion_tokens: 4 } } }
            : { json: { choices: [{ message: { role: 'assistant', content: 'Covered.' } }], usage: { prompt_tokens: 20, completion_tokens: 2 } } });
        const provider = new OpenAICompatibleModelProvider({ id: 'local', base_url: `${server.base}/v1`, api_key: 'k' });

        const first = await provider.generate({ model: 'm', system: 's', prompt: 'Is P-1 covered?', tools, temperature: 0 });
        expect(first.tool_calls).toEqual([{ id: 'c1', name: 'get_policy', arguments: { number: 'P-1' } }]);
        expect(server.requests[0].body.tools[0]).toEqual({ type: 'function', function: tools[0] });

        const second = await provider.generate({
            model: 'm', tools,
            messages: [
                { role: 'system', content: 's' }, { role: 'user', content: 'Is P-1 covered?' },
                { role: 'assistant', content: first.text, tool_calls: first.tool_calls, provider_state: first.provider_state },
                { role: 'tool', tool_call_id: 'c1', name: 'get_policy', content: '{"covered":true}' },
            ],
        });
        expect(second.text).toBe('Covered.');
        const sent = server.requests[1].body.messages;
        expect(sent[2]).toEqual(assistant); // vendor-specific fields survive the round trip
        expect(sent[3]).toEqual({ role: 'tool', tool_call_id: 'c1', content: '{"covered":true}' });
    });

    it('OpenAI: uses the Responses API, with flat tool definitions and function_call_output items', async () => {
        const output = [{ type: 'reasoning', id: 'r1' }, { type: 'function_call', call_id: 'call_9', name: 'get_policy', arguments: '{"number":"P-1"}' }];
        const server = stub((_, n) => n === 1
            ? { json: { output, usage: { input_tokens: 11, output_tokens: 5 } } }
            : { json: { output: [{ type: 'message', content: [{ type: 'output_text', text: 'Covered.' }] }], usage: { input_tokens: 21, output_tokens: 2 } } });
        const provider = new OpenAIModelProvider({ api_key: 'sk', base_url: `${server.base}/v1` });

        const first = await provider.generate({ model: 'gpt-x', system: 'Be exact.', prompt: 'Is P-1 covered?', tools });
        expect(server.requests[0].url).toBe('/v1/responses');
        expect(server.requests[0].headers.authorization).toBe('Bearer sk');
        expect(server.requests[0].body).toMatchObject({
            model: 'gpt-x', instructions: 'Be exact.', input: [{ role: 'user', content: 'Is P-1 covered?' }],
            tools: [{ type: 'function', name: 'get_policy', description: 'Look up a policy', parameters: tools[0].parameters }],
        });
        expect(first.tool_calls).toEqual([{ id: 'call_9', name: 'get_policy', arguments: { number: 'P-1' } }]);
        expect(first.usage).toEqual({ input_tokens: 11, output_tokens: 5 });

        const second = await provider.generate({
            model: 'gpt-x', tools,
            messages: [
                { role: 'system', content: 'Be exact.' }, { role: 'user', content: 'Is P-1 covered?' },
                { role: 'assistant', content: '', tool_calls: first.tool_calls, provider_state: first.provider_state },
                { role: 'tool', tool_call_id: 'call_9', name: 'get_policy', content: '{"covered":true}' },
            ],
        });
        expect(second.text).toBe('Covered.');
        expect(server.requests[1].body.input).toEqual([
            { role: 'user', content: 'Is P-1 covered?' }, ...output,
            { type: 'function_call_output', call_id: 'call_9', output: '{"covered":true}' },
        ]);
    });

    it('OpenAI: drops temperature for a model that rejects it, and remembers', async () => {
        const server = stub(request => request.body.temperature !== undefined
            ? { status: 400, json: { error: { message: "Unsupported parameter: 'temperature'" } } }
            : { json: { output: [{ type: 'message', content: [{ type: 'output_text', text: 'ok' }] }] } });
        const provider = new OpenAIModelProvider({ api_key: 'sk', base_url: server.base });
        expect((await provider.generate({ model: 'r', prompt: 'x', temperature: 0 })).text).toBe('ok');
        expect((await provider.generate({ model: 'r', prompt: 'y', temperature: 0 })).text).toBe('ok');
        expect(server.requests.map(r => 'temperature' in r.body)).toEqual([true, false, false]);
    });

    it('maps HTTP failures to error codes', async () => {
        const server = stub(() => ({ status: 429, json: { error: 'slow down' } }));
        await expect(new OpenAICompatibleModelProvider({ id: 'x', base_url: server.base }).generate({ model: 'm', prompt: 'p' }))
            .rejects.toMatchObject({ code: 'RATE_LIMITED', status: 429 });
    });

    it('embedded: runs a model in-process through a loaded generator, without tools', async () => {
        const seen: { model: string; messages: { role: string; content: string }[]; options: Record<string, unknown> }[] = [];
        const provider = new EmbeddedModelProvider({
            load: async model => async (messages, options) => {
                seen.push({ model, messages, options });
                return [{ generated_text: [...messages, { role: 'assistant', content: '{"option":"approve"}' }] }];
            },
        });
        expect(provider.capabilities.tools).toBe(false);
        const response = await provider.generate({ model: 'default', system: 'Decide.', prompt: 'Claim of 40 EUR', json: true });
        expect(response.text).toBe('{"option":"approve"}');
        expect(seen[0].model).toBe(EmbeddedModelProvider.DEFAULT_MODEL);
        expect(seen[0].messages[0]).toEqual({ role: 'system', content: 'Decide.' });
        expect(seen[0].messages[1].content).toMatch(/Claim of 40 EUR[\s\S]*single JSON object/);
        expect(seen[0].options).toMatchObject({ do_sample: false, return_full_text: false });
        await provider.generate({ model: 'default', prompt: 'again' });
        expect(seen).toHaveLength(2); // the model is loaded once and reused
    });

    // Only meaningful where the optional runtime is absent, as it is in CI
    const runtime_installed = (() => { try { createRequire(import.meta.url).resolve('@huggingface/transformers'); return true; } catch { return false; } })();
    (runtime_installed ? it.skip : it)('embedded: says what to install when the optional runtime is missing', async () => {
        await expect(new EmbeddedModelProvider().generate({ model: 'default', prompt: 'x' }))
            .rejects.toThrow(/@huggingface\/transformers/);
    });
});

// ----------------------------------------------------------------------------
describe('Tools', () => {
    const def = (tool: unknown): ToolDefinition => ToolDefinitionSchema.parse(tool);
    const runner = (tools: ToolDefinition[], options = {}, limits = {}) => {
        const events: { type: string; data: Record<string, any> }[] = [];
        const run = new ToolRunner(tools, options, e => events.push(e as any), v => v, { max_calls: 16, simulate: false, ...limits });
        return { run, events };
    };

    it('calls an HTTP API: path from arguments, the rest as query, and journals the link without secrets', async () => {
        const server = stub(() => ({ json: { status: 'active', excess: 250 } }));
        const tool = def({
            name: 'get_policy', description: 'Look up a policy',
            parameters: { type: 'object', required: ['number'], properties: { number: { type: 'string' }, fields: { type: 'string' } } },
            binding: { kind: 'http', method: 'GET', url: `${server.base}/policies/{number}`, headers: { authorization: 'Bearer {{secret:POLICY_KEY}}' } },
            documentation: 'https://example.com/openapi.json',
        });
        const { run, events } = runner([tool], { secrets: { POLICY_KEY: 's3cret' } });
        const result = await run.call('get_policy', { number: 'POL 7/7', fields: 'status' }, 'call-1');

        expect(result).toMatchObject({ ok: true, result: { status: 'active', excess: 250 } });
        expect(server.requests[0]).toMatchObject({ method: 'GET', url: '/policies/POL%207%2F7?fields=status' });
        expect(server.requests[0].headers.authorization).toBe('Bearer s3cret');

        expect(events.map(e => e.type)).toEqual(['tool.invoked', 'tool.completed']);
        expect(events[0].data).toMatchObject({
            call_id: 'call-1', tool: 'get_policy', link: `${server.base}/policies/POL%207%2F7`,
            binding: { kind: 'http', method: 'GET', url_template: `${server.base}/policies/{number}` },
            documentation: 'https://example.com/openapi.json', arguments: { number: 'POL 7/7', fields: 'status' },
        });
        expect(events[1].data).toMatchObject({ call_id: 'call-1', status: 200, result: { status: 'active', excess: 250 } });
        expect(JSON.stringify(events)).not.toContain('s3cret');
    });

    it('sends remaining arguments as a JSON body for POST', async () => {
        const server = stub(() => ({ status: 201, json: { id: 'r-1' } }));
        const { run, events } = runner([def({ name: 'reserve', binding: { kind: 'http', method: 'POST', url: `${server.base}/accounts/{account}/reservations` } })]);
        await run.call('reserve', { account: 'a1', amount: 40 });
        expect(server.requests[0]).toMatchObject({ method: 'POST', url: '/accounts/a1/reservations', body: { amount: 40 } });
        expect(events[1].data.status).toBe(201);
    });

    it('calls a JSON-RPC method', async () => {
        const server = stub(request => ({ json: { jsonrpc: '2.0', id: request.body.id, result: { rate: 1.08 } } }));
        const { run, events } = runner([def({ name: 'fx', binding: { kind: 'jsonrpc', endpoint: `${server.base}/rpc`, method: 'rates.get' } })]);
        expect((await run.call('fx', { pair: 'EURUSD' })).result).toEqual({ rate: 1.08 });
        expect(server.requests[0].body).toMatchObject({ jsonrpc: '2.0', method: 'rates.get', params: { pair: 'EURUSD' } });
        expect(events[0].data.link).toBe(`${server.base}/rpc#rates.get`);
    });

    it('refuses commands unless the deployment allows them, then runs them without a shell', async () => {
        const tool = def({ name: 'say', binding: { kind: 'command', command: 'echo', args: ['{text}'] } });
        const denied = runner([tool]);
        const refused = await denied.run.call('say', { text: 'hi; rm -rf /' });
        expect(refused).toMatchObject({ ok: false, result: { code: 'PERMISSION_DENIED' } });
        expect(denied.events.map(e => e.type)).toEqual(['tool.failed']);
        expect(denied.events[0].data.invoked).toBe(false);

        const allowed = runner([tool], { allow_commands: ['echo'] });
        const result = await allowed.run.call('say', { text: 'hi; echo injected' });
        expect(result.result).toBe('hi; echo injected'); // one argument, not interpreted by a shell
        expect(allowed.events[0].data).toMatchObject({ link: 'command:echo', binding: { kind: 'command', command: 'echo', args: ['hi; echo injected'] } });
        expect(allowed.events[1].data.status).toBe(0);
    });

    it('survives a command that exits without reading the arguments it was sent', async () => {
        // "true" exits at once; the arguments are far larger than a pipe holds, so writing them meets a closed pipe
        const { run, events } = runner([def({ name: 'noop', binding: { kind: 'command', command: 'true' } })], { allow_commands: ['true'] });
        const errors: unknown[] = [];
        const caught = (error: unknown) => errors.push(error);
        process.on('uncaughtException', caught);
        try {
            const result = await run.call('noop', { blob: 'x'.repeat(2 * 1024 * 1024) });
            await new Promise(resolve => setTimeout(resolve, 100));
            expect(result.ok).toBe(true);
            expect(events.map(e => e.type)).toEqual(['tool.invoked', 'tool.completed']);
            expect(errors).toEqual([]);
        } finally { process.off('uncaughtException', caught); }
    });

    it('restricts hosts when the deployment lists them', async () => {
        const { run } = runner([def({ name: 'x', binding: { kind: 'http', url: 'https://elsewhere.example/api' } })], { allowed_hosts: ['api.internal'] });
        expect(await run.call('x', {})).toMatchObject({ ok: false, result: { code: 'PERMISSION_DENIED' } });
    });

    it('holds redirects to the allowed hosts, keeps secrets from following one elsewhere, and reaches web addresses only', async () => {
        const seen: { host: string; auth?: string }[] = [];
        const other = http.createServer((req, res) => { seen.push({ host: 'other', auth: req.headers['x-api-key'] as string }); res.writeHead(200, { 'content-type': 'application/json' }).end('{"from":"other"}'); }).listen(0, '127.0.0.1');
        await new Promise(resolve => other.once('listening', resolve));
        const other_host = `127.0.0.1:${(other.address() as any).port}`;
        const first = http.createServer((req, res) => { seen.push({ host: 'first', auth: req.headers['x-api-key'] as string }); res.writeHead(302, { location: `http://${other_host}/landed` }).end(); }).listen(0, '127.0.0.1');
        await new Promise(resolve => first.once('listening', resolve));
        const first_host = `127.0.0.1:${(first.address() as any).port}`;
        const tool = def({ name: 'get', binding: { kind: 'http', url: `http://${first_host}/start`, headers: { 'x-api-key': '{{secret:KEY}}' } } });
        try {
            // The redirect leads to a host the deployment does not allow: refused, and never reached
            const strict = runner([tool], { allowed_hosts: [first_host], secrets: { KEY: 's3cret' } });
            expect(await strict.run.call('get', {})).toMatchObject({ ok: false, result: { code: 'PERMISSION_DENIED' } });
            expect(seen.map(s => s.host)).toEqual(['first']);
            // Allowed: followed, but the header that carries the secret does not go to the other origin
            seen.length = 0;
            const open = runner([tool], { allowed_hosts: [first_host, other_host], secrets: { KEY: 's3cret' } });
            expect(await open.run.call('get', {})).toMatchObject({ ok: true, result: { from: 'other' } });
            expect(seen).toEqual([{ host: 'first', auth: 's3cret' }, { host: 'other', auth: undefined }]);
            // A reply larger than the deployment allows fails the call
            const small = runner([def({ name: 'big', binding: { kind: 'http', url: `http://${other_host}/` } })], { max_output_bytes: 4 });
            expect(await small.run.call('big', {})).toMatchObject({ ok: false, result: { code: 'TOOL_ERROR' } });
        } finally { first.close(); other.close(); }

        for (const url of ['file:///etc/hostname', 'data:text/plain,hello', 'ftp://example.org/x']) {
            const { run, events } = runner([def({ name: 'x', binding: { kind: 'http', url } })]);
            expect(await run.call('x', {}), url).toMatchObject({ ok: false, result: { code: 'VALIDATION_ERROR' } });
            expect(events.at(-1)).toMatchObject({ type: 'tool.failed', data: { invoked: false } });
        }
        const rpc = runner([def({ name: 'r', binding: { kind: 'jsonrpc', endpoint: 'file:///etc/passwd', method: 'm' } })]);
        expect(await rpc.run.call('r', {})).toMatchObject({ ok: false, result: { code: 'VALIDATION_ERROR' } });
    });

    it('journals a binding as declared, not as filled, unless payloads are journalled in full', async () => {
        const tool = def({ name: 'lookup', parameters: { type: 'object', properties: { name: { type: 'string' } } }, binding: { kind: 'function', name: 'lookup' } });
        const cmd = def({ name: 'grep', parameters: { type: 'object', properties: { name: { type: 'string' } } }, binding: { kind: 'command', command: 'echo', args: ['{name}'] } });
        const events: any[] = [];
        const hashed = new ToolRunner([tool, cmd], { handlers: { lookup: () => 'ok' }, allow_commands: true }, e => events.push(e), () => ({ sha256: 'x' }), { max_calls: 16, simulate: false });
        await hashed.call('grep', { name: 'Ada Lovelace' });
        expect(JSON.stringify(events)).not.toContain('Ada Lovelace');
        expect(events.find(e => e.type === 'tool.invoked').data.binding).toMatchObject({ kind: 'command', command: 'echo', args: ['{name}'] });
        expect(tool_link({ kind: 'grpc', endpoint: 'ledger.internal:443', service: 'Ledger', method: 'Post' } as any, {})).toBe('grpc://ledger.internal:443/Ledger/Post');
        expect(tool_link({ kind: 'grpc', endpoint: 'dns://ledger.internal:443', service: 'Ledger', method: 'Post' } as any, {})).toBe('grpc://ledger.internal:443/Ledger/Post');
    });

    it('checks arguments against the schema before anything runs', async () => {
        const handler = { calls: 0 };
        const tool = def({ name: 'pay', parameters: { type: 'object', required: ['amount'], properties: { amount: { type: 'number' } } }, binding: { kind: 'function', name: 'pay' } });
        const { run, events } = runner([tool], { handlers: { pay: () => { handler.calls++; return 'paid'; } } });
        expect(await run.call('pay', { amount: 'lots' })).toMatchObject({ ok: false, result: { code: 'VALIDATION_ERROR' } });
        expect(handler.calls).toBe(0);
        expect(events[0]).toMatchObject({ type: 'tool.failed', data: { invoked: false } });
        expect((await run.call('pay', { amount: 5 })).result).toBe('paid');
    });

    it('reports unknown tools, missing executors, exhausted budgets and timeouts as failures the caller can read', async () => {
        const slow = def({ name: 'slow', timeout: 'PT0.05S', binding: { kind: 'function', name: 'slow' } });
        const viaMcp = def({ name: 'search', binding: { kind: 'mcp', server: 'docs', tool: 'search' } });
        const { run, events } = runner([slow, viaMcp], {
            executors: { function: () => new Promise(resolve => setTimeout(() => resolve({ result: 1 }), 500)) },
        }, { max_calls: 3 });

        expect((await run.call('nope', {})).result).toMatchObject({ code: 'UNKNOWN_TOOL' });
        // The engine has an MCP executor (17.7), but a binding reaches only a server the deployment declares
        expect((await run.call('search', { q: 'x' })).result).toMatchObject({ code: 'PERMISSION_DENIED', error: expect.stringMatching(/declares no MCP server "docs"/) });
        expect((await run.call('slow', {})).result).toMatchObject({ code: 'TIMEOUT' });
        expect((await run.call('slow', {})).result).toMatchObject({ code: 'TOOL_BUDGET_EXCEEDED' });
        expect(events.find(e => e.data.tool === 'search' && e.type === 'tool.failed')!.data).toMatchObject({ link: 'mcp://docs/search', invoked: false });
    });

    it('applies the tool timeout to registered function handlers', async () => {
        const tool = def({ name: 'slow', timeout: 'PT0.05S', binding: { kind: 'function', name: 'slow' } });
        const { run, events } = runner([tool], { handlers: { slow: () => new Promise(() => { /* never resolves */ }) } });
        expect((await run.call('slow', {})).result).toMatchObject({ code: 'TIMEOUT' });
        expect(events.map(e => e.type)).toEqual(['tool.invoked', 'tool.failed']);
    });

    it('uses a registered executor for kinds the engine does not implement', async () => {
        const { run } = runner([def({ name: 'quote', binding: { kind: 'grpc', endpoint: 'pricing:443', service: 'pricing.Quotes', method: 'Get' } })], {
            executors: { grpc: async (binding, args) => ({ status: 'OK', result: { binding: binding.kind, echoed: args } }) },
        });
        expect((await run.call('quote', { sku: 's1' })).result).toEqual({ binding: 'grpc', echoed: { sku: 's1' } });
    });

    it('gives every kind of binding a link', () => {
        const link = (binding: unknown) => tool_link(ToolDefinitionSchema.parse({ name: 't', binding }).binding, { id: 7 });
        expect(link({ kind: 'http', url: 'https://api.example.com/items/{id}' })).toBe('https://api.example.com/items/7');
        expect(link({ kind: 'grpc', endpoint: 'dns:///pricing:443', service: 'pricing.Quotes', method: 'Get' })).toBe('grpc://pricing:443/pricing.Quotes/Get');
        expect(link({ kind: 'function', name: 'lookup' })).toBe('function:lookup');
    });

    it('rejects two tools with the same name on one activity', () => {
        const tool = def({ name: 'dup', binding: { kind: 'function', name: 'f' } });
        const a = activity('A', { tools: [tool, tool] });
        expect(validate_workflow_integrity(workflow([a], [])).errors.map(e => e.code)).toEqual(['duplicate_id']);
    });
});

// ----------------------------------------------------------------------------
describe('An agent using tools', () => {
    async function run_agent(options = {}) {
        const server = stub(() => ({ json: { status: 'active', excess: 250 } }));
        const tools = [
            ToolDefinitionSchema.parse({
                name: 'get_policy', description: 'Look up a policy by number',
                parameters: { type: 'object', required: ['number'], properties: { number: { type: 'string' } } },
                binding: { kind: 'http', url: `${server.base}/policies/{number}` },
            }),
            ToolDefinitionSchema.parse({ name: 'price_part', binding: { kind: 'function', name: 'price_part' } }),
        ];
        const a = activity('Assess claim', { actor_type: 'ai_agent', tools });
        const provider = new FunctionModelProvider('acme', (request: ModelRequest) => {
            const turns = request.messages || [];
            if (!turns.some(m => m.role === 'tool')) {
                return { text: '', tool_calls: [{ id: 'c1', name: 'get_policy', arguments: { number: 'POL-1' } }, { id: 'c2', name: 'price_part', arguments: { part: 'bumper' } }] };
            }
            const results = turns.filter(m => m.role === 'tool').map(m => m.content);
            return JSON.stringify({ reasoning: { plan: ['look up policy', 'price part'], rationale: 'Policy active' }, output: { covered: true, seen: results } });
        });
        const engine = new WorkflowEngine(workflow([a], []), {
            model_providers: [provider], tools: { handlers: { price_part: () => ({ price: 1150 }) } }, ...quiet, ...options,
        });
        await engine.start({ claim: 'c-1' });
        const status = await engine.run();
        return { status, events: await engine.getEvents(), provider, server, engine, wf: engine.getWorkflow() };
    }

    it('gives the model the tools, runs what it calls, feeds results back, and journals each call with time and link', async () => {
        const { status, events, provider, server, engine } = await run_agent();
        expect(status).toBe('completed');

        // The model was offered both tools, and got both results back
        expect(provider.requests[0].tools!.map(t => t.name)).toEqual(['get_policy', 'price_part']);
        const tool_turns = provider.requests[1].messages!.filter(m => m.role === 'tool');
        expect(tool_turns.map(m => m.content)).toEqual(['{"status":"active","excess":250}', '{"price":1150}']);
        expect(engine.getTokens()[0].contextData.covered).toBe(true);

        const tool_events = events.filter(e => e.type.startsWith('tool.'));
        expect(tool_events.map(e => e.type)).toEqual(['tool.invoked', 'tool.completed', 'tool.invoked', 'tool.completed']);
        for (const event of tool_events) {
            expect(event.node_name).toBe('Assess claim');
            expect(event.attempt).toBe(1);
            expect(new Date(event.time).getTime()).toBeGreaterThan(0); // when
        }
        expect(tool_events[0].data).toMatchObject({ tool: 'get_policy', link: `${server.base}/policies/POL-1`, binding: { kind: 'http', method: 'GET' } });
        expect(tool_events[2].data).toMatchObject({ tool: 'price_part', link: 'function:price_part' });
        // Tool events sit inside the attempt: after it started, before it was accepted
        const seq = (type: string) => events.find(e => e.type === type)!.seq;
        expect(seq('activity.started')).toBeLessThan(tool_events[0].seq);
        expect(tool_events[3].seq).toBeLessThan(seq('activity.completed'));
    });

    it('shows the calls in the recipe', async () => {
        const { wf, events, server } = await run_agent();
        const recipe = compile_recipe(wf, events);
        expect(recipe).toContain('### Callable tools');
        expect(recipe).toContain(`| Assess claim | \`get_policy\` | HTTP GET ${server.base}/policies/{number} |`);
        expect(recipe).toMatch(/Tool call at \d{4}-\d\d-\d\dT[\d:.]+Z: `get_policy` → http:\/\/127\.0\.0\.1:\d+\/policies\/POL-1 \(http\), returned 200 in/);
        expect(recipe).toMatch(/Tool call at .*`price_part` → function:price_part \(function\), returned in/);
    });

    it('does not call out in simulation mode, and says so in the journal', async () => {
        const tool = ToolDefinitionSchema.parse({ name: 'get_policy', binding: { kind: 'http', url: 'http://127.0.0.1:1/never' } });
        const a = activity('A', { tools: [tool] });
        const events: JournalEvent[] = [];
        const engine = new WorkflowEngine(workflow([a], []), {
            simulate: true, tools: { simulated_results: { get_policy: { status: 'active' } } }, ...quiet,
            actors: { application: { execute: async (_a, _i, context) => ({ policy: (await context!.tools!.call('get_policy', {})).result }) } },
        });
        engine.onEvent(e => events.push(e));
        await engine.start();
        expect(await engine.run()).toBe('completed');
        expect(engine.getTokens()[0].contextData.policy).toEqual({ status: 'active' });
        expect(events.find(e => e.type === 'tool.invoked')!.data.simulated).toBe(true);
    });

    it('stops an agent that keeps calling tools past its budget', async () => {
        const tool = ToolDefinitionSchema.parse({ name: 'loop', binding: { kind: 'function', name: 'loop' } });
        const a = activity('A', { actor_type: 'ai_agent', tools: [tool], outcome_contract: { postconditions: [], on_violation: 'fail', budgets: { max_tool_calls: 3 } } });
        const provider = new FunctionModelProvider('acme', () => ({ text: '', tool_calls: [{ id: uuidv4(), name: 'loop', arguments: {} }] }));
        const engine = new WorkflowEngine(workflow([a], []), { model_providers: [provider], tools: { handlers: { loop: () => 'again' } }, ...quiet });
        await engine.start();
        expect(await engine.run()).toBe('failed');
        expect(String(engine.getTokens()[0].getData('_error'))).toMatch(/Tool call budget of 3 exceeded/);
    });
});

// ----------------------------------------------------------------------------
describe('Model decisions', () => {
    function build(model: Record<string, unknown>, opts: { table?: boolean; fallback?: boolean } = {}) {
        const intake = activity('Intake'); const pay = activity('Pay'); const review = activity('Review'); const manual = activity('Manual');
        const id = uuidv4();
        const toPay = edge({ id }, pay); const toReview = edge({ id }, review); const toManual = edge({ id }, manual);
        const node = {
            id, name: 'Triage', description: 'Route the claim.',
            ...(opts.table ? {
                decision_table: {
                    hit_policy: 'first', inputs: [{ name: 'amount', type: 'number' }], outputs: [{ name: 'route', type: 'string' }],
                    rules: [{ input_entries: ['< 100'], output_entries: ['pay'], output_edge_id: toPay.id }],
                },
            } : {}),
            decision_model: DecisionModelSchema.parse({
                instructions: 'Pay simple, clearly covered claims. Send anything unusual to review.',
                options: [
                    { id: 'pay', description: 'Simple and covered', output_edge_id: toPay.id },
                    { id: 'review', description: 'Unusual or unclear', output_edge_id: toReview.id },
                ],
                inputs: ['amount', 'description'],
                ...model,
            }),
            ...(opts.fallback !== false ? { default_output_edge_id: toManual.id } : {}),
        } as DecisionNode;
        return workflow([intake, pay, review, manual], [edge(intake, { id }), toPay, toReview, toManual], { decision_nodes: [node] });
    }

    async function decide(wf: ReturnType<typeof build>, replies: (string | Error)[], data: Record<string, unknown> = { amount: 900, description: 'Hail damage to roof' }) {
        let n = 0;
        const provider = new FunctionModelProvider('acme', () => {
            const reply = replies[Math.min(n++, replies.length - 1)];
            if (reply instanceof Error) throw reply;
            return reply;
        });
        const s = scripted({ Intake: data });
        const engine = new WorkflowEngine(wf, { actors: s.actors, model_providers: [provider], model_tiers: { fast: 'acme:small' }, ...quiet });
        await engine.start();
        const status = await engine.run();
        const events = await engine.getEvents();
        return { status, visited: s.actor.calls.map(c => c.activity), provider, events, decision: events.find(e => e.type === 'decision.evaluated')!.data as Record<string, any> };
    }
    const answer = (option: string, confidence = 0.9, rationale = 'Looks routine.') => JSON.stringify({ option, confidence, rationale });

    it('routes along the option the model chooses, and records how it decided', async () => {
        const r = await decide(build({ model: 'tier:fast' }), [answer('review', 0.82, 'Roof damage needs an inspection.')]);
        expect(r.status).toBe('completed');
        expect(r.visited).toEqual(['Intake', 'Review']);
        expect(r.decision).toMatchObject({ method: 'model', strategy: 'model', matched: true, outputs: { option: 'review', confidence: 0.82 }, model: { option: 'review' } });

        // The model saw only the listed facts and the enumerated options
        const request = r.provider.requests[0];
        expect(request.model).toBe('small');
        expect(request.json).toBe(true);
        expect(request.temperature).toBe(0);
        expect(request.prompt).toContain('- pay: Simple and covered');
        expect(request.prompt).toContain('- amount: 900');
        expect(request.prompt).toMatch(/Reply with JSON like \{"option": "<pay or review>"/);

        expect(r.events.find(e => e.type === 'reasoning.recorded')!.data).toMatchObject({ source: 'decision_model', rationale: 'Roof damage needs an inspection.' });
        expect(r.events.find(e => e.type === 'meta.recorded' && e.data.subject === 'model_selection')!.data.decision).toBe('Use model acme:small');
    });

    it('with a table, asks the model only when no rule matches', async () => {
        const small = await decide(build({}, { table: true }), [answer('review')], { amount: 40 });
        expect(small.visited).toEqual(['Intake', 'Pay']);
        expect(small.decision.method).toBe('table');
        expect(small.provider.requests).toHaveLength(0); // deterministic rule decided; no model call

        const large = await decide(build({}, { table: true }), [answer('review')], { amount: 4000 });
        expect(large.visited).toEqual(['Intake', 'Review']);
        expect(large.decision).toMatchObject({ method: 'model', strategy: 'table_first' });
    });

    it('treats an option that was not offered as no decision, and takes the default edge', async () => {
        const r = await decide(build({}), [answer('approve_everything')]);
        expect(r.visited).toEqual(['Intake', 'Manual']);
        expect(r.decision).toMatchObject({ method: 'default', used_default: true, matched: false });
        expect(r.decision.model.no_decision_reason).toMatch(/not one of the options/);
    });

    it('requires the stated confidence when a minimum is set', async () => {
        expect((await decide(build({ min_confidence: 0.8 }), [answer('pay', 0.55)])).visited).toEqual(['Intake', 'Manual']);
        expect((await decide(build({ min_confidence: 0.8 }), [answer('pay', 0.95)])).visited).toEqual(['Intake', 'Pay']);
        expect((await decide(build({ min_confidence: 0.8 }), ['pay'])).decision.model.no_decision_reason).toMatch(/was not stated/);
    });

    it('takes a strict majority of several votes', async () => {
        const majority = await decide(build({ votes: 3 }), [answer('pay'), answer('review'), answer('pay')]);
        expect(majority.visited).toEqual(['Intake', 'Pay']);
        expect(majority.provider.requests).toHaveLength(3);
        expect(majority.provider.requests[0].temperature).toBe(0.7); // samples must be independent
        expect(majority.decision.model.votes.map((v: any) => v.option)).toEqual(['pay', 'review', 'pay']);

        const split = await decide(build({ votes: 3 }), [answer('pay'), answer('review'), 'gibberish']);
        expect(split.visited).toEqual(['Intake', 'Manual']);
        expect(split.decision.model.no_decision_reason).toMatch(/no option has a majority/);
    });

    it('fails the token when there is no decision and no default edge', async () => {
        const r = await decide(build({}, { fallback: false }), [new Error('model offline')]);
        expect(r.status).toBe('failed');
        expect(r.visited).toEqual(['Intake']);
    });

    it('accepts a plain reply that names exactly one option, as small models often give', () => {
        const model = DecisionModelSchema.parse({
            instructions: 'x', options: [
                { id: 'pay', description: 'a', output_edge_id: uuidv4() }, { id: 'review', description: 'b', output_edge_id: uuidv4() }],
        });
        expect(parse_vote('I would choose review because it is unusual.', model)).toMatchObject({ option: 'review' });
        expect(parse_vote('Either pay or review.', model).invalid).toMatch(/more than one/);
        expect(parse_vote('{"option": "pay", "confidence": 0.7, "rationale": "ok"}', model)).toEqual({ option: 'pay', confidence: 0.7, rationale: 'ok' });
        expect(parse_vote('```json\n{"option":"prepay"}\n```', model).invalid).toMatch(/not one of the options/);
        expect(parse_vote('no idea', model).invalid).toBeTruthy();
    });

    it('falls back along the tier when the first model is unavailable, and journals the route', async () => {
        const wf = build({ model: 'tier:fast' });
        const cloud = new FunctionModelProvider('cloud', () => { throw Object.assign(new Error('quota exhausted'), { code: 'RATE_LIMITED' }); });
        const embedded = new EmbeddedModelProvider({ load: async () => async () => [{ generated_text: answer('pay') }] });
        const s = scripted({ Intake: { amount: 20, description: 'Windscreen chip' } });
        const engine = new WorkflowEngine(wf, {
            actors: s.actors, model_providers: [cloud, embedded], model_tiers: { fast: ['cloud:big', 'embedded:default'] }, ...quiet,
        });
        await engine.start();
        expect(await engine.run()).toBe('completed');
        expect(s.actor.calls.map(c => c.activity)).toEqual(['Intake', 'Pay']);
        const route = (await engine.getEvents()).find(e => e.type === 'meta.recorded' && e.data.subject === 'model_route')!;
        expect(route.data.decision).toBe("Route to embedded:default");
        expect(String(route.data.rationale)).toMatch(/cloud:big was tried and failed: RATE_LIMITED: quota exhausted/);
    });

    it('can be scripted in simulation mode', async () => {
        const wf = build({});
        const engine = new WorkflowEngine(wf, { simulate: true, simulated_outputs: { Intake: { output: { amount: 5 } }, Triage: { output: { option: 'review', confidence: 1 } } }, ...quiet });
        await engine.start();
        expect(await engine.run()).toBe('completed');
        expect((await engine.getEvents()).filter(e => e.type === 'token.moved').at(-1)!.node_name).toBe('Review');
    });

    it('rejects options that do not leave the decision node', () => {
        const wf = build({});
        wf.decision_nodes[0].decision_model!.options[0].output_edge_id = wf.edges[0].id; // an edge into the node, not out of it
        expect(validate_workflow_integrity(wf).errors.map(e => e.code)).toContain('invalid_reference');
    });
});
